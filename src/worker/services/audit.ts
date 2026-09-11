import type { Identity, ResolvedGrant } from "../domain/policy";

/**
 * Records authorized broker operations, policy denials, and credential issuance
 * at prefix granularity.
 *
 * Writes are mandatory. Failures are surfaced to the caller and log stream.
 */

export type AuditOutcome = "granted" | "denied" | "error";

export class AuditError extends Error {}

export interface AuditEvent {
	identity: Identity;
	action: string;
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
