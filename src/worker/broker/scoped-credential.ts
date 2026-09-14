import type { Context } from "hono";
import type { ErrorResponse } from "../../shared/api-types";
import { parentFor } from "../config/parent-tokens";
import {
	actionsFor,
	authorize,
	authorizeBucket,
	clampTtl,
	type Permission,
	type ResolvedGrant,
} from "../domain/policy";
import { json } from "../http/responses";
import type { R2Failure } from "../services/r2";
import { mintCredentials, type R2Action, type TempCredentials } from "../services/temp-credentials";
import type { AuditAction } from "../services/audit";
import type { AppEnv } from "../types";

/**
 * The policy enforcement point.
 *
 * Every route that touches R2 runs the same five steps: authorize against the
 * caller's grants, clamp the TTL to what the grant permits, derive the exact S3
 * action list, mint a credential from the trust domain's parent token, and
 * audit the decision. Repeating that inline per route is how a denial stops
 * being logged or a write grant quietly starts carrying delete, so it lives
 * here once and the routes supply only what differs.
 *
 * The parent token is never used to serve a request. It only signs a narrower
 * child, which means R2 enforces the prefix and action scope independently of
 * this application's own authorization code. A bug in `domain/policy` degrades
 * to no access rather than wrong access.
 */

interface BaseRequest {
	action: AuditAction;
	bucket: string;
	permission: Permission;
	/** Requested lifetime. Clamped down to the grant's ceiling, never up. */
	ttlSeconds?: number;
	/** Honoured only if every contributing grant also sets `allowDelete`. */
	includeDelete?: boolean;
	/** Returned to the caller when no grant covers the request. */
	denyMessage: string;
	/** Recorded against the denial in the audit log. */
	denyDetail: string;
}

export interface PathRequest extends BaseRequest {
	/** The object key, or the prefix being listed. */
	path: string;
}

export type BucketRequest = BaseRequest;

/**
 * A minted credential plus the audit calls that must accompany its use.
 *
 * `granted` and `failed` are exposed instead of being run automatically because
 * the outcome is only known after R2 answers, and the R2 call belongs to the
 * route. `failed` returns the response so that the audit write cannot be
 * skipped on the way to producing it.
 */
export interface ScopedCredential {
	ok: true;
	grant: ResolvedGrant;
	/** Roles that contributed. More than one only for bucket-wide requests. */
	roles: string[];
	/** Prefixes actually placed on the credential. */
	prefixes: string[];
	ttlSeconds: number;
	actions: readonly R2Action[];
	credentials: TempCredentials;
	/**
	 * Records that the capability was exercised, before the outcome is known.
	 * Used for writes, where losing the isolate mid-upload must still leave
	 * evidence rather than nothing.
	 */
	intent(detail: string): Promise<void>;
	granted(detail?: string | null): Promise<void>;
	failed(failure: R2Failure): Promise<Response>;
}

export interface ScopedDenial {
	ok: false;
	response: Response;
}

export type ScopedResult = ScopedCredential | ScopedDenial;

type AppContext = Context<AppEnv>;

/** Authorizes one path and mints a credential narrowed to exactly that path. */
export async function mintForPath(c: AppContext, request: PathRequest): Promise<ScopedResult> {
	const decision = authorize(c.var.grants, {
		bucket: request.bucket,
		path: request.path,
		permission: request.permission,
	});
	if (decision === undefined) return await deny(c, request, request.path);

	return await mint(c, request, {
		grant: decision.grant,
		roles: [decision.grant.role],
		prefixes: decision.prefixes,
		allowDelete: decision.grant.allowDelete === true,
		path: request.path,
	});
}

/**
 * Authorizes every prefix the caller holds in one bucket and mints a single
 * credential covering all of them.
 *
 * Strictly wider than `mintForPath`, so it is opt-in. `authorizeBucket` takes
 * the minimum TTL and requires unanimous `allowDelete` across contributing
 * grants, because one credential carries one action list across all its paths.
 */
export async function mintForBucket(c: AppContext, request: BucketRequest): Promise<ScopedResult> {
	const resolved = authorizeBucket(c.var.grants, request.bucket, request.permission);
	if (resolved === undefined) return await deny(c, request, undefined);

	const grant: ResolvedGrant = {
		bucket: request.bucket,
		prefixes: resolved.prefixes,
		permission: resolved.permission,
		maxTtlSeconds: resolved.maxTtlSeconds,
		allowDelete: resolved.allowDelete,
		domainId: resolved.domainId,
		// The audit row records the union that produced the credential, so the
		// contributing roles are joined rather than one being chosen.
		role: resolved.roles.join("+"),
	};

	return await mint(c, request, {
		grant,
		roles: resolved.roles,
		prefixes: resolved.prefixes,
		allowDelete: resolved.allowDelete,
		path: undefined,
	});
}

async function deny(c: AppContext, request: BaseRequest, path: string | undefined): Promise<ScopedDenial> {
	await c.var.audit(request.action, "denied", request.denyDetail, {
		bucket: request.bucket,
		...(path === undefined ? {} : { path }),
		permission: request.permission,
	});
	return { ok: false, response: json({ error: request.denyMessage } satisfies ErrorResponse, 403) };
}

interface Resolution {
	grant: ResolvedGrant;
	roles: string[];
	prefixes: string[];
	allowDelete: boolean;
	path: string | undefined;
}

async function mint(
	c: AppContext,
	request: BaseRequest,
	resolution: Resolution,
): Promise<ScopedCredential> {
	const ttlSeconds = clampTtl(request.ttlSeconds, resolution.grant);
	const actions = actionsFor(
		request.permission,
		resolution.allowDelete && request.includeDelete === true,
	);
	const credentials = await mintCredentials(parentFor(c.env, resolution.grant.domainId), {
		accountId: c.env.CF_ACCOUNT_ID,
		bucket: request.bucket,
		ttlSeconds,
		actions,
		prefixes: resolution.prefixes,
	});

	const common = {
		bucket: request.bucket,
		...(resolution.path === undefined ? {} : { path: resolution.path }),
		permission: request.permission,
		grant: resolution.grant,
		prefixes: resolution.prefixes,
	};

	return {
		ok: true,
		grant: resolution.grant,
		roles: resolution.roles,
		prefixes: resolution.prefixes,
		ttlSeconds,
		actions,
		credentials,
		intent: async (detail) => {
			await c.var.audit("put-intent", "granted", detail, { ...common, ttlSeconds, actions });
		},
		granted: async (detail = null) => {
			await c.var.audit(request.action, "granted", detail, { ...common, ttlSeconds, actions });
		},
		failed: async (failure) => {
			await c.var.audit(request.action, "error", failure.message, common);
			return json({ error: failure.message, kind: failure.kind } satisfies ErrorResponse, failure.status);
		},
	};
}
