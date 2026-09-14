import { createMiddleware } from "hono/factory";
import type { ErrorResponse } from "../../shared/api-types";
import { IdentityError, resolveIdentity } from "../auth/access";
import { policy } from "../config/policy";
import { resolveGrants } from "../domain/policy";
import { json } from "../http/responses";
import type { AppEnv } from "../types";

/**
 * Establishes who is calling and what they may reach, for every route.
 *
 * Identity comes from Cloudflare Access only, never from a request header, and
 * grants are resolved once here rather than per handler so that no route can
 * operate on a different view of the policy than the one that was audited.
 *
 * Failures are handled locally rather than thrown, because the two cases are
 * meaningfully different to an operator: a rejected assertion is the caller's
 * problem (401), while a broken Access configuration or an unreachable identity
 * endpoint is ours (500), and only the latter is worth a log line.
 */
export const identity = createMiddleware<AppEnv>(async (c, next) => {
	const requestId = c.var.requestId;
	try {
		// Workers Static Assets do not propagate `ctx.access` to the user Worker,
		// so `resolveIdentity` falls back to verifying the hostname Access
		// assertion when this is absent. See src/worker/auth/access.ts.
		const resolved = await resolveIdentity(c.req.raw, c.executionCtx as Pick<ExecutionContext, "access">, {
			teamDomain: c.env.ACCESS_TEAM_DOMAIN,
			aud: c.env.ACCESS_AUD,
		});
		c.set("identity", resolved);
		c.set("grants", resolveGrants(policy, resolved));
	} catch (error) {
		if (error instanceof IdentityError) {
			return json({ error: error.message, requestId } satisfies ErrorResponse, 401);
		}
		const message = error instanceof Error ? error.message : String(error);
		console.error(JSON.stringify({ message: "identity resolution failed", error: message, requestId }));
		return json({ error: "Identity could not be resolved.", requestId } satisfies ErrorResponse, 500);
	}

	await next();
});
