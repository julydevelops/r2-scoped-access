import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/worker/services/audit", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/worker/services/audit")>();
	return { ...actual, record: vi.fn(async () => undefined) };
});

import type { AuditResponse } from "../src/shared/api-types";
import worker from "../src/worker/index";

/**
 * Who may read whose audit rows.
 *
 * Scope is decided from `policy.auditors`, never from the request, so the
 * assertions here are on the query the route issues rather than only on the
 * response body: a self-scoped read must carry the caller's email as a bound
 * parameter, and must not be reachable by asking for something else.
 */

interface CapturedQuery {
	sql: string;
	params: unknown[];
}

function recordingDb(captured: CapturedQuery[]): D1Database {
	const statement = (sql: string): D1PreparedStatement =>
		({
			bind: (...params: unknown[]) => {
				captured.push({ sql, params });
				return statement(sql);
			},
			all: async () => ({ results: [], success: true, meta: {} }),
		}) as unknown as D1PreparedStatement;

	return {
		prepare: (sql: string) => statement(sql),
		batch: () => { throw new Error("not used"); },
		exec: () => { throw new Error("not used"); },
		withSession: () => { throw new Error("not used"); },
		dump: () => { throw new Error("not used"); },
	} as unknown as D1Database;
}

let captured: CapturedQuery[] = [];

function envWith(db: D1Database): Env {
	return {
		AUDIT_DB: db,
		CF_ACCOUNT_ID: "replace-with-account-id",
		ACCESS_TEAM_DOMAIN: "replace-with-team.cloudflareaccess.com",
		ACCESS_AUD: "replace-with-access-audience",
		PARENT_RESEARCH_AKID: "research-key",
		PARENT_RESEARCH_SECRET: "research-secret",
		PARENT_PRODUCTION_AKID: "production-key",
		PARENT_PRODUCTION_SECRET: "production-secret",
	};
}

function contextFor(email: string, group: string): Pick<ExecutionContext, "access"> {
	return {
		access: {
			aud: "test-audience",
			getIdentity: async () => ({ email, groups: [{ id: "1", name: group }] }),
		},
	} as unknown as Pick<ExecutionContext, "access">;
}

async function read(context: Pick<ExecutionContext, "access">): Promise<{ status: number; body: AuditResponse }> {
	const response = await worker.fetch(
		new Request("https://example.com/api/audit"),
		envWith(recordingDb(captured)),
		context,
	);
	return { status: response.status, body: await response.json<AuditResponse>() };
}

beforeEach(() => {
	captured = [];
});

describe("audit log reads", () => {
	it("restricts a non-auditor to their own rows", async () => {
		const { status, body } = await read(contextFor("researcher@example.com", "Research"));
		expect(status).toBe(200);
		expect(body.scope).toBe("self");
		expect(captured).toHaveLength(1);
		expect(captured[0]?.sql).toContain("WHERE email = ?1 COLLATE NOCASE");
		expect(captured[0]?.params).toEqual(["researcher@example.com", 100]);
	});

	it("lets a policy-declared auditor group read every principal", async () => {
		const { status, body } = await read(contextFor("operator@example.com", "Storage-Admin"));
		expect(status).toBe(200);
		expect(body.scope).toBe("all");
		expect(captured[0]?.sql).not.toContain("WHERE");
		expect(captured[0]?.params).toEqual([100]);
	});

	it("never selects columns outside the published row shape", async () => {
		await read(contextFor("researcher@example.com", "Research"));
		expect(captured[0]?.sql).not.toContain("*");
		expect(captured[0]?.sql).not.toMatch(/\bid\b\s*,/);
		expect(captured[0]?.sql).toContain("LIMIT ?2");
	});
});
