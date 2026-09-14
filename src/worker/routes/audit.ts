import { Hono } from "hono";
import type { AuditResponse } from "../../shared/api-types";
import { AUDIT_PAGE_SIZE } from "../config/limits";
import { policy } from "../config/policy";
import { isAuditor } from "../domain/policy";
import { listRecent } from "../services/audit";
import type { AppEnv } from "../types";

/**
 * Reads the audit log back.
 *
 * Scope is decided here, not by the caller. The log contains other principals'
 * emails and other trust domains' bucket paths, which makes it the most
 * revealing endpoint in the application, so reading beyond your own rows is an
 * explicit grant in `policy.auditors`. Everyone can always read their own
 * history, because being unable to see what was issued in your name is worse
 * than the disclosure.
 *
 * The read is itself audited, including which scope was served.
 */
export const auditRoutes = new Hono<AppEnv>().get("/audit", async (c) => {
	const scopeToSelf = !isAuditor(policy, c.var.identity);

	const rows = await listRecent(c.env.AUDIT_DB, {
		email: scopeToSelf ? c.var.identity.email : null,
		limit: AUDIT_PAGE_SIZE,
	});

	await c.var.audit("audit-read", "granted", scopeToSelf ? "own rows only" : "all principals");

	return c.json({ scope: scopeToSelf ? "self" : "all", rows } satisfies AuditResponse);
});
