import { describe, expect, it, vi } from "vitest";
import { AuditError, record, type AuditEvent } from "../src/worker/services/audit";

const event: AuditEvent = {
	identity: { email: "reader@example.com", groups: [] },
	action: "vend",
	bucket: "data",
	path: "datasets/",
	permission: "read",
	prefixes: ["datasets/"],
	actions: ["GetObject"],
	ttlSeconds: 300,
	domainId: "DATA",
	role: "reader",
	outcome: "granted",
	detail: null,
	requestId: "request-1",
};

const failingDb: D1Database = {
	prepare: () => { throw new Error("database unavailable"); },
	batch: () => { throw new Error("not used"); },
	exec: () => { throw new Error("not used"); },
	withSession: () => { throw new Error("not used"); },
	dump: () => { throw new Error("not used"); },
};

describe("audit durability", () => {
	it("fails closed when D1 cannot store an event", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(record(failingDb, event)).rejects.toBeInstanceOf(AuditError);
	});
});
