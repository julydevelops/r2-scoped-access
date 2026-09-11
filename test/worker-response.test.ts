import { describe, expect, it } from "vitest";
import worker, { downloadHeaders, json } from "../src/worker/index";

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

const ctx = {
	access: {
		aud: "test-audience",
		getIdentity: async () => ({ email: "researcher@example.com", groups: [{ id: "1", name: "Research" }] }),
	},
} satisfies Pick<ExecutionContext, "access">;

describe("private responses", () => {
	it("prevents API responses from being cached or content-sniffed", async () => {
		const response = json({ ok: true });
		expect(response.headers.get("Cache-Control")).toBe("no-store, private");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
	});

	it("forces object content to download instead of rendering on the application origin", () => {
		const headers = downloadHeaders("uploads/report' final.html", "42");
		expect(headers.get("Content-Type")).toBe("application/octet-stream");
		expect(headers.get("Content-Disposition")).toContain("attachment;");
		expect(headers.get("Content-Disposition")).toContain("report%27%20final.html");
		expect(headers.get("Content-Length")).toBe("42");
	});
});

describe("worker routes", () => {
	it("returns the Access identity and resolved grants from /api/me", async () => {
		const response = await worker.fetch(new Request("https://example.com/api/me"), env, ctx);
		const payload = await response.json<{ email: string; entitlements: unknown[] }>();
		expect(response.status).toBe(200);
		expect(payload.email).toBe("researcher@example.com");
		expect(payload.entitlements).toHaveLength(2);
	});

	it("keeps unknown API paths as no-store JSON errors", async () => {
		const response = await worker.fetch(new Request("https://example.com/api/missing"), env, ctx);
		expect(response.status).toBe(404);
		expect(response.headers.get("Cache-Control")).toBe("no-store, private");
	});
});
