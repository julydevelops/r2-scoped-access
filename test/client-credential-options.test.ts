import { describe, expect, it } from "vitest";
import type { Entitlement } from "../src/shared/api-types";
import { credentialDeleteAvailable, credentialMaxTtl, credentialScopePrefixes } from "../src/client/App";

const entitlements: Entitlement[] = [
	{ bucket: "data", prefixes: ["datasets/"], permission: "read", allowDelete: false, maxTtlSeconds: 3600, domain: "DATA", role: "reader" },
	{ bucket: "data", prefixes: ["scratch/"], permission: "write", allowDelete: false, maxTtlSeconds: 900, domain: "DATA", role: "writer" },
	{ bucket: "data", prefixes: ["tmp/"], permission: "write", allowDelete: true, maxTtlSeconds: 300, domain: "DATA", role: "purger" },
];

describe("credential request options", () => {
	it("keeps the current prefix as the default least-privilege scope", () => {
		expect(credentialScopePrefixes(entitlements, "data", "datasets/2026/", "read", false)).toEqual(["datasets/2026/"]);
	});

	it("unions only prefixes eligible for the selected capability", () => {
		expect(credentialScopePrefixes(entitlements, "data", "scratch/", "write", true)).toEqual(["scratch/", "tmp/"]);
	});

	it("offers delete only where policy allows it", () => {
		expect(credentialDeleteAvailable(entitlements, "data", "tmp/session/", "write", false)).toBe(true);
		expect(credentialDeleteAvailable(entitlements, "data", "scratch/", "write", false)).toBe(false);
		expect(credentialDeleteAvailable(entitlements, "data", "tmp/", "read", false)).toBe(false);
	});

	it("withholds delete from a union if any contributing write grant forbids it", () => {
		expect(credentialDeleteAvailable(entitlements, "data", "tmp/", "write", true)).toBe(false);
	});

	it("uses the strictest TTL when prefixes are unioned", () => {
		expect(credentialMaxTtl(entitlements, "data", "datasets/", "read", true)).toBe(300);
		expect(credentialMaxTtl(entitlements, "data", "datasets/", "read", false)).toBe(3600);
	});
});
