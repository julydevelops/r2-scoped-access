import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Identity } from "../domain/policy";

/**
 * Identity comes from Cloudflare Access, never from a client-supplied header.
 *
 * Local testing uses `ctx.access.getIdentity()` through the `access.dev` block,
 * so there is no bypass header in this codebase.
 *
 * The JWKS path is retained only for the deployment shape where the Worker sits
 * behind a hostname-based Access application rather than a Worker-level one.
 *
 * Production uses the JWKS path because Workers Static Assets run behind an
 * internal router that does not pass `ctx.access` to the user Worker.
 */

export class IdentityError extends Error {}

interface AccessIdentity {
	email?: string;
	groups?: unknown;
	custom?: Record<string, unknown>;
	idp?: { groups?: unknown; group?: unknown };
}

interface AccessContext {
	aud: string;
	getIdentity(): Promise<AccessIdentity | null>;
}

type MaybeAccessContext = Pick<ExecutionContext, "access"> & { access?: AccessContext };

export interface AccessConfig {
	teamDomain?: string;
	aud?: string;
}

/**
 * Flattens whatever shape the identity provider used for groups into a flat list
 * of strings that policy.json can match exactly.
 *
 * `ctx.access.getIdentity()` returns groups as objects `{ id, name, email }`.
 * For each group we emit both `name` and `email`, because they are matchable but not
 * interchangeable:
 *
 * - `name` is the human display name, and for Google Workspace it is mutable.
 * - `email` (e.g. r2-research@company.com) is the stable unique identifier.
 *
 * Emitting both lets an admin write policy.json against whichever is stable in
 * their directory without having to know this app's internals. Local development
 * may supply groups as a flat string array, so both shapes are handled.
 */
export function readGroups(payload: AccessIdentity): string[] {
	const candidates: unknown[] = [
		payload.groups,
		payload.custom?.["groups"],
		payload.custom?.["group"],
		payload.idp?.groups,
		payload.idp?.group,
	];
	for (const candidate of candidates) {
		if (Array.isArray(candidate)) {
			const out: string[] = [];
			for (const g of candidate) {
				if (typeof g === "string") {
					if (g !== "") out.push(g);
				} else if (typeof g === "object" && g !== null) {
					const obj = g as { name?: unknown; email?: unknown };
					if (typeof obj.name === "string" && obj.name !== "") out.push(obj.name);
					if (typeof obj.email === "string" && obj.email !== "") out.push(obj.email);
				}
			}
			// An empty array here means "this candidate carried nothing usable",
			// so fall through to the next rather than returning [] prematurely.
			if (out.length > 0) return [...new Set(out)];
			continue;
		}
		if (typeof candidate === "string" && candidate.length > 0) {
			return [...new Set(candidate.split(",").map((g) => g.trim()).filter((g) => g !== ""))];
		}
	}
	return [];
}

export async function resolveIdentity(
	request: Request,
	ctx: Pick<ExecutionContext, "access">,
	config: AccessConfig,
): Promise<Identity> {
	const access = (ctx as MaybeAccessContext).access;
	if (access !== undefined) {
		if (config.aud !== undefined && !config.aud.startsWith("replace-with-") && access.aud !== config.aud) {
			throw new IdentityError("Access authenticated this request for a different application audience");
		}
		const identity = await access.getIdentity();
		const email = identity?.email;
		if (typeof email !== "string" || email.length === 0) {
			throw new IdentityError("Access authenticated the request but returned no email claim");
		}
		return { email, groups: readGroups({ email, groups: identity?.groups }) };
	}

	return await identityFromAssertion(request, config);
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function identityFromAssertion(request: Request, config: AccessConfig): Promise<Identity> {
	const { teamDomain, aud } = config;
	if (teamDomain === undefined || aud === undefined || teamDomain.startsWith("replace-with-")) {
		throw new IdentityError(
			"request did not come through Cloudflare Access, and no hostname-based Access application is configured",
		);
	}
	if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(teamDomain)) {
		throw new IdentityError("ACCESS_TEAM_DOMAIN must be a cloudflareaccess.com team domain");
	}

	const token =
		request.headers.get("Cf-Access-Jwt-Assertion") ??
		parseCookie(request.headers.get("Cookie"), "CF_Authorization");
	if (token === null || token === "") {
		throw new IdentityError("missing Access assertion; this Worker must sit behind Cloudflare Access");
	}

	const url = `https://${teamDomain}/cdn-cgi/access/certs`;
	let jwks = jwksCache.get(url);
	if (jwks === undefined) {
		jwks = createRemoteJWKSet(new URL(url));
		jwksCache.set(url, jwks);
	}

	try {
		const verified = await jwtVerify(token, jwks, {
			issuer: `https://${teamDomain}`,
			audience: aud,
		});
		const payload = verified.payload as AccessIdentity;
		const identityResponse = await fetch(`https://${teamDomain}/cdn-cgi/access/get-identity`, {
			headers: { Cookie: `CF_Authorization=${token}` },
		});
		if (!identityResponse.ok) {
			throw new IdentityError(`Access identity lookup failed with ${identityResponse.status}`);
		}
		const fullIdentity = await identityResponse.json<AccessIdentity>();
		const email = fullIdentity.email ?? payload.email;
		if (typeof email !== "string" || email.length === 0) {
			throw new IdentityError("Access assertion carries no email claim");
		}
		return { email, groups: readGroups(fullIdentity) };
	} catch (error) {
		if (error instanceof IdentityError) throw error;
		throw new IdentityError(`invalid Access assertion: ${(error as Error).message}`);
	}
}

function parseCookie(header: string | null, name: string): string | null {
	if (header === null) return null;
	for (const part of header.split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key === name) return rest.join("=");
	}
	return null;
}
