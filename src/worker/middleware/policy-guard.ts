import { createMiddleware } from "hono/factory";
import type { ErrorResponse } from "../../shared/api-types";
import { policyValidationError } from "../config/policy";
import { json } from "../http/responses";
import type { AppEnv } from "../types";

/**
 * Refuses every request while `policy.json` is invalid.
 *
 * This runs ahead of identity resolution on purpose. An unparseable policy
 * means the deny-by-default model cannot be evaluated at all, and a broker that
 * cannot evaluate its policy must not authenticate anyone into a partially
 * understood ruleset.
 */
export const policyGuard = createMiddleware<AppEnv>(async (c, next) => {
	if (policyValidationError !== null) {
		return json(
			{
				error: `policy is invalid: ${policyValidationError}`,
				requestId: c.var.requestId,
			} satisfies ErrorResponse,
			500,
		);
	}
	await next();
});
