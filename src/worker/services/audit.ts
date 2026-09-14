import type { AuditRow } from "../../shared/api-types";
import type { Identity, ResolvedGrant } from "../domain/policy";

/**
 * Records authorized broker operations, policy denials, and credential issuance
 * at prefix granularity.
 *
 * Writes are mandatory. Failures are surfaced to the caller and log stream.
 */

export type AuditOutcome = "granted" | "denied" | "error";

/**
 * The closed set of auditable operations.
 *
 * Enumerated rather than left as `string` because the audit log is the artefact
 * this application exists to produce: a typo would silently create a new action
 * name that no report or query knows to look for.
 *
 * `put-intent` is recorded before the write reaches R2 and is the only action
 * that does not assert an outcome, so that a request which kills the isolate
 * mid-upload still leaves evidence that write capability was exercised.
 */
export type AuditAction =
	| "identity-read"
	| "audit-read"
	| "list"
	| "get"
	| "put-intent"
	| "put"
	| "vend";

export class AuditError extends Error {}

export interface AuditEvent {
	identity: Identity;
	action: AuditAction;
	bucket: string | null;
	path: string | null;
	permission: string | null;
	prefixes: string[] | null;
	/**
	 * The exact action list put on the credential. Recorded because "write" alone
	 * no longer tells you whether delete was included, and for a compliance log
	 * the granted capability is the fact that matters.
	 */
	actions: readonly string[] | null;
	ttlSeconds: number | null;
	domainId: string | null;
	role: string | null;
	outcome: AuditOutcome;
	detail: string | null;
	requestId: string;
}

export function auditFromGrant(
	base: Omit<AuditEvent, "domainId" | "role" | "prefixes" | "actions">,
	grant: ResolvedGrant | undefined,
	prefixes: string[] | undefined,
	actions: readonly string[] | undefined,
): AuditEvent {
	return {
		...base,
		domainId: grant?.domainId ?? null,
		role: grant?.role ?? null,
		prefixes: prefixes ?? null,
		actions: actions ?? null,
	};
}

export async function record(db: D1Database, event: AuditEvent): Promise<void> {
	const line = {
		ts: new Date().toISOString(),
		email: event.identity.email,
		action: event.action,
		bucket: event.bucket,
		path: event.path,
		permission: event.permission,
		prefixes: event.prefixes,
		actions: event.actions,
		ttl: event.ttlSeconds,
		domain: event.domainId,
		role: event.role,
		outcome: event.outcome,
		detail: event.detail,
		requestId: event.requestId,
	};
	console.log(JSON.stringify({
		audit: {
			action: line.action,
			outcome: line.outcome,
			domain: line.domain,
			requestId: line.requestId,
		},
	}));

	try {
		await db
			.prepare(
				`INSERT INTO audit_log
				 (ts, email, action, bucket, path, permission, prefixes, actions, ttl_seconds, domain_id, role, outcome, detail, request_id)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
			)
			.bind(
				line.ts,
				line.email,
				line.action,
				line.bucket,
				line.path,
				line.permission,
				line.prefixes === null ? null : JSON.stringify(line.prefixes),
				line.actions === null ? null : JSON.stringify(line.actions),
				line.ttl,
				line.domain,
				line.role,
				line.outcome,
				line.detail,
				line.requestId,
			)
			.run();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(JSON.stringify({ auditWriteFailed: message, requestId: event.requestId }));
		throw new AuditError(`audit write failed: ${message}`);
	}
}

/**
 * Columns exposed when reading the log back.
 *
 * Enumerated rather than selected with `*` so that adding an internal column to
 * the table, `id` included, cannot widen what the API returns. This list is the
 * projection that `AuditRow` in the shared contract describes.
 */
const READABLE_COLUMNS =
	"ts, email, action, bucket, path, permission, prefixes, actions, ttl_seconds, domain_id, role, outcome, detail, request_id";

export interface AuditQuery {
	/**
	 * Restricts the read to one principal's own rows. `null` reads every
	 * principal and is only reachable for policy-declared auditors.
	 */
	email: string | null;
	limit: number;
}

/**
 * Most recent rows first.
 *
 * Ordered by `id` rather than `ts` because `ts` is an application-supplied
 * ISO string and several events inside one request share it, while `id` is
 * monotonic and therefore gives a stable page boundary.
 */
export async function listRecent(db: D1Database, query: AuditQuery): Promise<AuditRow[]> {
	const statement =
		query.email === null
			? db.prepare(`SELECT ${READABLE_COLUMNS} FROM audit_log ORDER BY id DESC LIMIT ?1`).bind(query.limit)
			: db
					.prepare(
						`SELECT ${READABLE_COLUMNS} FROM audit_log WHERE email = ?1 COLLATE NOCASE ORDER BY id DESC LIMIT ?2`,
					)
					.bind(query.email, query.limit);

	const { results } = await statement.all<AuditRow>();
	return results;
}
