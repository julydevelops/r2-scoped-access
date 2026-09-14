import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/worker/services/audit", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/worker/services/audit")>();
	return { ...actual, record: vi.fn(async () => undefined) };
});

import type { ErrorResponse } from "../src/shared/api-types";
import { AuditError, record } from "../src/worker/services/audit";
import worker from "../src/worker/index";

/**
 * Locks the translation from thrown error to status code.
 *
 * Every route funnels failures through one mapper, so these assertions are the
 * contract the client's error handling is written against. The audit case is
 * the one that matters most: it must fail closed with a 503 rather than serving
 * an unlogged success.
 */

const unusedAuditDb: D1Database = {
	prepare: () => { throw new Error("not used"); },
	batch: () => { throw new Error("not used"); },
	exec: () => { throw new Error("not used"); },
	withSession: () => { throw new Error("not used"); },
	dump: () => { throw new Error("not used"); },
};

const baseEnv: Env = {
	AUDIT_DB: unusedAuditDb,
	CF_ACCOUNT_ID: "replace-with-account-id",
	ACCESS_TEAM_DOMAIN: "replace-with-team.cloudflareaccess.com",
	ACCESS_AUD: "replace-with-access-audience",
	PARENT_RESEARCH_AKID: "research-key",
	PARENT_RESEARCH_SECRET: "research-secret",
	PARENT_PRODUCTION_AKID: "production-key",
	PARENT_PRODUCTION_SECRET: "production-secret",
};

function contextFor(email: string, groups: string[], aud = "test-audience"): Pick<ExecutionContext, "access"> {
	return {
		access: {
			aud,
			getIdentity: async () => ({ email, groups: groups.map((name, index) => ({ id: String(index), name })) }),
		},
	} as unknown as Pick<ExecutionContext, "access">;
}

const researcher = contextFor("researcher@example.com", ["Research"]);

function credentialRequest(body: unknown, init: RequestInit = {}): Request {
	return new Request("https://example.com/api/credentials", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		...init,
	});
}

beforeEach(() => {
	vi.mocked(record).mockReset();
	vi.mocked(record).mockImplementation(async () => undefined);
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("error mapping", () => {
	it("withholds the response when the audit write fails", async () => {
		vi.mocked(record).mockRejectedValueOnce(new AuditError("audit write failed: database unavailable"));
		const response = await worker.fetch(
			credentialRequest({ bucket: "demo-research", prefix: "scratch/", permission: "write" }),
			baseEnv,
			researcher,
		);
		const payload = await response.json<ErrorResponse>();
		expect(response.status).toBe(503);
		expect(payload.error).toBe("The audit record could not be stored, so the response was withheld.");
		expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("reports a missing parent token as a deployment fault, not a client error", async () => {
		const { PARENT_RESEARCH_SECRET: _omitted, ...withoutSecret } = baseEnv;
		const response = await worker.fetch(
			credentialRequest({ bucket: "demo-research", prefix: "scratch/", permission: "write" }),
			withoutSecret as Env,
			researcher,
		);
		expect(response.status).toBe(503);
		expect((await response.json<ErrorResponse>()).error).toBe(
			"Server misconfigured: PARENT_RESEARCH_SECRET is not set.",
		);
	});

	it("rejects a body that is not declared as JSON", async () => {
		const response = await worker.fetch(
			new Request("https://example.com/api/credentials", {
				method: "POST",
				headers: { "Content-Type": "text/plain" },
				body: "bucket=demo-research",
			}),
			baseEnv,
			researcher,
		);
		expect(response.status).toBe(400);
		expect((await response.json<ErrorResponse>()).error).toBe(
			"The request body must be declared as application/json.",
		);
	});

	it("rejects a JSON body larger than the limit before parsing it", async () => {
		const response = await worker.fetch(
			credentialRequest({ bucket: "demo-research", prefix: `${"a".repeat(20_000)}/` }),
			baseEnv,
			researcher,
		);
		expect(response.status).toBe(413);
		expect((await response.json<ErrorResponse>()).error).toBe("JSON request bodies are limited to 16384 bytes.");
	});

	it("rejects an Access assertion issued for a different application", async () => {
		const response = await worker.fetch(
			new Request("https://example.com/api/me"),
			// The generated Env narrows ACCESS_AUD to the placeholder in wrangler.jsonc,
			// so a realistic audience has to be substituted past that literal type.
			{ ...baseEnv, ACCESS_AUD: "the-real-audience" } as unknown as Env,
			contextFor("researcher@example.com", ["Research"], "some-other-audience"),
		);
		expect(response.status).toBe(401);
		expect((await response.json<ErrorResponse>()).error).toContain("different application audience");
	});

	it("keeps unknown API paths as no-store JSON errors", async () => {
		const response = await worker.fetch(new Request("https://example.com/api/missing"), baseEnv, researcher);
		expect(response.status).toBe(404);
		expect(response.headers.get("Cache-Control")).toBe("no-store, private");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect((await response.json<ErrorResponse>()).error).toBe("not found");
	});

	it("does not serve anything outside the API surface", async () => {
		const response = await worker.fetch(new Request("https://example.com/dashboard"), baseEnv, researcher);
		expect(response.status).toBe(404);
		expect(response.headers.get("Cache-Control")).toBe("no-store, private");
	});
});
