import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/worker/services/audit", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/worker/services/audit")>();
	return { ...actual, record: vi.fn(async () => undefined) };
});

import type { ErrorResponse } from "../src/shared/api-types";
import { record } from "../src/worker/services/audit";
import worker from "../src/worker/index";

/**
 * Route-level behaviour for browsing and object transfer.
 *
 * Every case here is refused before a credential is signed or R2 is contacted,
 * which is the property being asserted: the broker denies on its own policy and
 * on request well-formedness without needing a network round trip to find out.
 */

const unusedAuditDb: D1Database = {
	prepare: () => { throw new Error("not used"); },
	batch: () => { throw new Error("not used"); },
	exec: () => { throw new Error("not used"); },
	withSession: () => { throw new Error("not used"); },
	dump: () => { throw new Error("not used"); },
};

const env: Env = {
	AUDIT_DB: unusedAuditDb,
	CF_ACCOUNT_ID: "replace-with-account-id",
	ACCESS_TEAM_DOMAIN: "replace-with-team.cloudflareaccess.com",
	ACCESS_AUD: "replace-with-access-audience",
	PARENT_RESEARCH_AKID: "research-key",
	PARENT_RESEARCH_SECRET: "research-secret",
	PARENT_PRODUCTION_AKID: "production-key",
	PARENT_PRODUCTION_SECRET: "production-secret",
};

// Research holds read on datasets/ and write on scratch/ in demo-research only.
const researcher = {
	access: {
		aud: "test-audience",
		getIdentity: async () => ({ email: "researcher@example.com", groups: [{ id: "1", name: "Research" }] }),
	},
} as unknown as Pick<ExecutionContext, "access">;

function auditedActions(): { action: string; outcome: string; detail: string | null }[] {
	return vi.mocked(record).mock.calls.map(([, event]) => ({
		action: event.action,
		outcome: event.outcome,
		detail: event.detail,
	}));
}

beforeEach(() => {
	vi.mocked(record).mockReset();
	vi.mocked(record).mockImplementation(async () => undefined);
});

describe("listing", () => {
	it("denies a prefix no grant covers, and records the denial", async () => {
		const response = await worker.fetch(
			new Request("https://example.com/api/objects?bucket=demo-research&prefix=secrets/"),
			env,
			researcher,
		);
		expect(response.status).toBe(403);
		expect((await response.json<ErrorResponse>()).error).toBe("Not entitled to that prefix.");
		expect(auditedActions()).toEqual([
			{ action: "list", outcome: "denied", detail: "no grant covers this prefix" },
		]);
	});

	it("denies a bucket in a trust domain the caller has no grant in", async () => {
		const response = await worker.fetch(
			new Request("https://example.com/api/objects?bucket=demo-production&prefix="),
			env,
			researcher,
		);
		expect(response.status).toBe(403);
	});
});

describe("object transfer", () => {
	it("refuses a traversal key before signing anything", async () => {
		const response = await worker.fetch(
			new Request("https://example.com/api/object?bucket=demo-research&key=datasets/../../etc/passwd"),
			env,
			researcher,
		);
		expect(response.status).toBe(400);
		expect((await response.json<ErrorResponse>()).error).toBe("Invalid object key.");
		expect(auditedActions()).toEqual([{ action: "get", outcome: "denied", detail: "rejected path" }]);
	});

	it("refuses a write to a prefix the caller may only read", async () => {
		const response = await worker.fetch(
			new Request("https://example.com/api/object?bucket=demo-research&key=datasets/report.csv", {
				method: "PUT",
				headers: { "Content-Length": "3", "Content-Type": "text/csv" },
				body: "abc",
			}),
			env,
			researcher,
		);
		expect(response.status).toBe(403);
		expect((await response.json<ErrorResponse>()).error).toBe("Not entitled to write that key.");
	});

	it("requires a Content-Length so an upload size is known before authorizing", async () => {
		const streamed = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("abc"));
				controller.close();
			},
		});
		const response = await worker.fetch(
			new Request("https://example.com/api/object?bucket=demo-research&key=scratch/run-1/out.bin", {
				method: "PUT",
				body: streamed,
				// @ts-expect-error duplex is required for a streaming body but absent from the lib types
				duplex: "half",
			}),
			env,
			researcher,
		);
		expect(response.status).toBe(411);
		expect((await response.json<ErrorResponse>()).error).toBe(
			"Browser uploads require a valid Content-Length header.",
		);
		expect(auditedActions()).toEqual([
			{ action: "put", outcome: "denied", detail: "missing or invalid Content-Length" },
		]);
	});

	it("directs oversized uploads to temporary credentials instead of proxying them", async () => {
		const response = await worker.fetch(
			new Request("https://example.com/api/object?bucket=demo-research&key=scratch/run-1/big.bin", {
				method: "PUT",
				headers: { "Content-Length": String(200 * 1024 * 1024) },
				body: "abc",
			}),
			env,
			researcher,
		);
		expect(response.status).toBe(413);
		expect((await response.json<ErrorResponse>()).error).toContain("Use temporary S3 credentials");
		expect(auditedActions()).toEqual([
			{ action: "put", outcome: "denied", detail: "browser upload exceeded 100 MB" },
		]);
	});
});
