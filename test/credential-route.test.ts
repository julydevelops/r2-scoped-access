import { describe, expect, it, vi } from "vitest";

vi.mock("../src/worker/services/audit", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/worker/services/audit")>();
	return { ...actual, record: vi.fn(async () => undefined) };
});

import type { CredentialResponse } from "../src/shared/api-types";
import worker from "../src/worker/index";

const unusedAuditDb: D1Database = {
	prepare: () => { throw new Error("not used"); },
	batch: () => { throw new Error("not used"); },
	exec: () => { throw new Error("not used"); },
	withSession: () => { throw new Error("not used"); },
	dump: () => { throw new Error("not used"); },
};

const env: Env & Record<`PARENT_${string}_${"AKID" | "SECRET"}`, string> = {
	AUDIT_DB: unusedAuditDb,
	CF_ACCOUNT_ID: "replace-with-account-id",
	ACCESS_TEAM_DOMAIN: "replace-with-team.cloudflareaccess.com",
	ACCESS_AUD: "replace-with-access-audience",
	PARENT_RESEARCH_AKID: "research-key",
	PARENT_RESEARCH_SECRET: "research-secret",
	PARENT_PRODUCTION_AKID: "production-key",
	PARENT_PRODUCTION_SECRET: "production-secret",
};

const ctx = {
	access: {
		aud: "test-audience",
		getIdentity: async () => ({ email: "operator@example.com", groups: [{ id: "1", name: "Storage-Admin" }] }),
	},
} satisfies Pick<ExecutionContext, "access">;

const researchCtx = {
	access: {
		aud: "test-audience",
		getIdentity: async () => ({ email: "researcher@example.com", groups: [{ id: "2", name: "Research" }] }),
	},
} satisfies Pick<ExecutionContext, "access">;

async function issue(includeDelete: boolean): Promise<CredentialResponse> {
	const response = await worker.fetch(
		new Request("https://example.com/api/credentials", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				bucket: "demo-production",
				prefix: "",
				permission: "write",
				ttlSeconds: 300,
				includeDelete,
			}),
		}),
		env,
		ctx,
	);
	expect(response.status).toBe(200);
	return response.json<CredentialResponse>();
}

describe("credential issuance", () => {
	it("withholds delete unless the caller explicitly requests it", async () => {
		const credential = await issue(false);
		expect(credential.canWrite).toBe(true);
		expect(credential.canDelete).toBe(false);
		expect(credential.actions).not.toContain("DeleteObject");
	});

	it("includes delete only when both policy and the caller allow it", async () => {
		const credential = await issue(true);
		expect(credential.canDelete).toBe(true);
		expect(credential.actions).toContain("DeleteObject");
	});

	it("narrows a credential to the nested prefix the caller reviewed", async () => {
		const response = await worker.fetch(
			new Request("https://example.com/api/credentials", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					bucket: "demo-research",
					prefix: "scratch/run-42/",
					permission: "write",
					ttlSeconds: 300,
				}),
			}),
			env,
			researchCtx,
		);
		const credential = await response.json<CredentialResponse>();
		expect(response.status).toBe(200);
		expect(credential.prefixes).toEqual(["scratch/run-42/"]);
	});

	it("rejects malformed credential options instead of coercing them", async () => {
		const response = await worker.fetch(
			new Request("https://example.com/api/credentials", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ bucket: "demo-research", prefix: 42, permission: "write" }),
			}),
			env,
			researchCtx,
		);
		expect(response.status).toBe(400);
		expect(await response.json<{ error: string }>()).toMatchObject({ error: "prefix must be a string." });
	});

	it("rejects a non-positive requested TTL instead of substituting the default", async () => {
		const response = await worker.fetch(
			new Request("https://example.com/api/credentials", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ bucket: "demo-research", prefix: "scratch/", ttlSeconds: 0 }),
			}),
			env,
			researchCtx,
		);
		expect(response.status).toBe(400);
		expect(await response.json<{ error: string }>()).toMatchObject({ error: "ttlSeconds must be a positive integer." });
	});
});
