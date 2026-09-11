import { describe, expect, it } from "vitest";
import { readGroups } from "../src/worker/auth/access";
import { resolveGrants, type Policy } from "../src/worker/domain/policy";

describe("readGroups", () => {
	it("returns [] when the identity carries no groups", () => {
		expect(readGroups({ email: "a@b.c" })).toEqual([]);
		expect(readGroups({ email: "a@b.c", groups: [] })).toEqual([]);
	});

	it("passes through a flat string array, as wrangler dev supplies locally", () => {
		expect(readGroups({ groups: ["Research", "SRE"] })).toEqual(["Research", "SRE"]);
	});

	it("emits both name and email for object-shaped groups from a real IdP", () => {
		const groups = [
			{ id: "1", name: "R2 Research", email: "r2-research@company.com" },
			{ id: "2", name: "R2 Prod", email: "r2-prod@company.com" },
		];
		const result = readGroups({ groups });
		expect(result).toContain("R2 Research");
		expect(result).toContain("r2-research@company.com");
		expect(result).toContain("R2 Prod");
		expect(result).toContain("r2-prod@company.com");
	});

	it("tolerates a group object that has a name but no email", () => {
		expect(readGroups({ groups: [{ id: "1", name: "Research" }] })).toEqual(["Research"]);
	});

	it("dedupes repeated group strings", () => {
		const groups = [
			{ id: "1", name: "Research", email: "research@company.com" },
			{ id: "2", name: "Research", email: "research@company.com" },
		];
		expect(readGroups({ groups })).toEqual(["Research", "research@company.com"]);
	});

	it("reads a comma-separated string claim", () => {
		expect(readGroups({ custom: { groups: "Research, SRE ,Storage-Admin" } })).toEqual([
			"Research",
			"SRE",
			"Storage-Admin",
		]);
	});

	it("falls back through custom.groups and custom.group", () => {
		expect(readGroups({ custom: { groups: ["Research"] } })).toEqual(["Research"]);
		expect(readGroups({ custom: { group: ["SRE"] } })).toEqual(["SRE"]);
	});

	it("reads groups from a full get-identity response", () => {
		expect(readGroups({ idp: { groups: ["Research", "SRE"] } })).toEqual(["Research", "SRE"]);
	});

	it("skips an empty top-level groups array and reads the custom claim instead", () => {
		expect(readGroups({ groups: [], custom: { groups: ["Research"] } })).toEqual(["Research"]);
	});
});

describe("group matching end to end", () => {
	const policy: Policy = {
		version: 1,
		domains: [{ id: "RESEARCH", buckets: ["research-data"] }],
		roles: {
			"research-reader": [
				{ bucket: "research-data", prefixes: ["datasets/"], permission: "read", maxTtlSeconds: 3600 },
			],
		},
		// Policy authored against the stable group email, not the mutable display name.
		assignments: [{ group: "r2-research@company.com", roles: ["research-reader"] }],
	};

	it("grants access when policy matches the group email an IdP sends", () => {
		const groups = readGroups({
			groups: [{ id: "1", name: "Research Team (display)", email: "r2-research@company.com" }],
		});
		const grants = resolveGrants(policy, { email: "someone@company.com", groups });
		expect(grants.map((g) => g.bucket)).toEqual(["research-data"]);
	});

	it("also grants when policy matches the display name instead", () => {
		const namePolicy: Policy = {
			...policy,
			assignments: [{ group: "Research Team (display)", roles: ["research-reader"] }],
		};
		const groups = readGroups({
			groups: [{ id: "1", name: "Research Team (display)", email: "r2-research@company.com" }],
		});
		expect(resolveGrants(namePolicy, { email: "x@company.com", groups })).toHaveLength(1);
	});

	it("denies by default when neither name nor email is named in policy", () => {
		const groups = readGroups({
			groups: [{ id: "9", name: "Unrelated", email: "unrelated@company.com" }],
		});
		expect(resolveGrants(policy, { email: "x@company.com", groups })).toEqual([]);
	});
});
