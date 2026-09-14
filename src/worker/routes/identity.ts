import { Hono } from "hono";
import type { Entitlement, MeResponse } from "../../shared/api-types";
import { policy } from "../config/policy";
import { isAuditor, type Identity, type ResolvedGrant } from "../domain/policy";
import type { AppEnv } from "../types";

/**
 * What the caller is allowed to do, as resolved from `policy.json`.
 *
 * The client renders its whole navigation from this, so it is deliberately the
 * complete entitlement set rather than a summary: a UI that has to guess what
 * it may offer will either hide capability or offer a guaranteed 403.
 */
function entitlements(grants: readonly ResolvedGrant[]): Entitlement[] {
	return grants.map((grant) => ({
		bucket: grant.bucket,
		prefixes: grant.prefixes,
		permission: grant.permission,
		allowDelete: grant.allowDelete === true,
		maxTtlSeconds: grant.maxTtlSeconds,
		domain: grant.domainId,
		role: grant.role,
	}));
}

function present(identity: Identity, grants: readonly ResolvedGrant[]): MeResponse {
	return {
		email: identity.email,
		groups: identity.groups,
		isAuditor: isAuditor(policy, identity),
		entitlements: entitlements(grants),
	};
}

export const identityRoutes = new Hono<AppEnv>()
	/**
	 * Unaudited on purpose. This is the client's bootstrap and refresh call, so
	 * auditing it would bury real access events under UI noise without recording
	 * anything that is not already implied by the Access login.
	 */
	.get("/me", (c) => c.json(present(c.var.identity, c.var.grants)))

	/**
	 * The same payload, audited. Used by the troubleshooting view, where the
	 * question being asked is "what does the broker think I am", and a record
	 * that someone inspected their own entitlements is worth keeping.
	 */
	.get("/identity", async (c) => {
		const grants = c.var.grants;
		await c.var.audit("identity-read", "granted", grants.length === 0 ? "no grants resolved" : null);
		return c.json(present(c.var.identity, grants));
	});
