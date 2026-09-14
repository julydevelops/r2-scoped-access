import { createMiddleware } from "hono/factory";
import type { Permission, ResolvedGrant } from "../domain/policy";
import { auditFromGrant, record, type AuditAction, type AuditOutcome } from "../services/audit";
import type { AppEnv } from "../types";

/**
 * Binds the audit writer to the current identity and request id.
 *
 * Handlers should not have to restate who is acting or which request they are
 * serving on every call; those are properties of the request, not of the event.
 * What remains is only what the handler actually knows.
 */

export interface AuditFields {
	bucket?: string;
	path?: string;
	permission?: Permission;
	ttlSeconds?: number;
	/** Supplies the domain and role columns. */
	grant?: ResolvedGrant;
	/** The prefixes put on the credential, which may be narrower than the grant. */
	prefixes?: string[];
	/** The exact S3 action list put on the credential. */
	actions?: readonly string[];
}

export type AuditFn = (
	action: AuditAction,
	outcome: AuditOutcome,
	detail: string | null,
	fields?: AuditFields,
) => Promise<void>;

export const auditContext = createMiddleware<AppEnv>(async (c, next) => {
	const { identity, requestId } = c.var;

	// Awaited rather than deferred to `waitUntil`: a write that fails must be
	// able to withhold the response, which is only possible while the handler is
	// still running.
	const audit: AuditFn = async (action, outcome, detail, fields = {}) => {
		await record(
			c.env.AUDIT_DB,
			auditFromGrant(
				{
					identity,
					action,
					bucket: fields.bucket ?? null,
					path: fields.path ?? null,
					permission: fields.permission ?? null,
					ttlSeconds: fields.ttlSeconds ?? null,
					outcome,
					detail,
					requestId,
				},
				fields.grant,
				fields.prefixes,
				fields.actions,
			),
		);
	};

	c.set("audit", audit);
	await next();
});
