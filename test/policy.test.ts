import { describe, expect, it } from "vitest";
import {
	actionsFor,
	authorize,
	clampTtl,
	isAuditor,
	authorizeBucket,
	maxPermissionFor,
	normalisePath,
	PolicyError,
	READ_ACTIONS,
	resolveGrants,
	validatePolicy,
	WRITE_ACTIONS,
	type Grant,
	type Policy,
} from "../src/worker/domain/policy";

const policy: Policy = {
	version: 1,
	domains: [
		{ id: "RESEARCH", buckets: ["research-data"] },
		{ id: "PRODUCTION", buckets: ["prod-results"] },
	],
	roles: {
		"research-reader": [
			{ bucket: "research-data", prefixes: ["allowed/"], permission: "read", maxTtlSeconds: 3600 },
		],
		"research-writer": [
			{ bucket: "research-data", prefixes: ["allowed/"], permission: "write", maxTtlSeconds: 3600 },
		],
		"prod-reader": [
			{ bucket: "prod-results", prefixes: [""], permission: "read", maxTtlSeconds: 900 },
		],
	},
	assignments: [
		{ email: "reader@example.com", roles: ["research-reader"] },
		{ email: "writer@example.com", roles: ["research-writer"] },
		{ group: "SRE", roles: ["prod-reader"] },
	],
};

describe("resolveGrants", () => {
	it("denies by default when nothing matches", () => {
		expect(resolveGrants(policy, { email: "nobody@example.com", groups: [] })).toEqual([]);
	});

	it("matches on email case-insensitively", () => {
		const grants = resolveGrants(policy, { email: "READER@example.com", groups: [] });
		expect(grants).toHaveLength(1);
		expect(grants[0]?.bucket).toBe("research-data");
		expect(grants[0]?.domainId).toBe("RESEARCH");
	});

	it("matches group membership exactly", () => {
		const grants = resolveGrants(policy, { email: "x@example.com", groups: ["SRE"] });
		expect(grants.map((g) => g.bucket)).toEqual(["prod-results"]);
	});

	it("fails closed when group casing differs", () => {
		expect(resolveGrants(policy, { email: "x@example.com", groups: ["sre"] })).toEqual([]);
	});
});

describe("authorize", () => {
	const reader = resolveGrants(policy, { email: "reader@example.com", groups: [] });
	const writer = resolveGrants(policy, { email: "writer@example.com", groups: [] });

	it("allows reads inside a granted prefix", () => {
		expect(authorize(reader, { bucket: "research-data", path: "allowed/file.txt", permission: "read" }))
			.toMatchObject({ prefixes: ["allowed/file.txt"] });
	});

	it("denies reads outside the granted prefix", () => {
		expect(authorize(reader, { bucket: "research-data", path: "denied/file.txt", permission: "read" }))
			.toBeUndefined();
	});

	it("denies a prefix-adjacent key, matching R2's literal prefix semantics", () => {
		expect(authorize(reader, { bucket: "research-data", path: "allowedX/file.txt", permission: "read" }))
			.toBeUndefined();
	});

	it("does not satisfy a write request from a read grant", () => {
		expect(authorize(reader, { bucket: "research-data", path: "allowed/file.txt", permission: "write" }))
			.toBeUndefined();
		expect(authorize(writer, { bucket: "research-data", path: "allowed/file.txt", permission: "write" }))
			.toBeDefined();
	});

	it("does not leak across buckets", () => {
		expect(authorize(reader, { bucket: "prod-results", path: "allowed/file.txt", permission: "read" }))
			.toBeUndefined();
	});

	it("rejects traversal before anything is signed", () => {
		expect(authorize(reader, { bucket: "research-data", path: "allowed/../denied/f.txt", permission: "read" }))
			.toBeUndefined();
	});
});

describe("normalisePath", () => {
	it.each(["allowed/../denied", "/absolute", "allowed/%2e%2e/denied", "bad\u0000key"])(
		"rejects %s",
		(input) => expect(normalisePath(input)).toBeUndefined(),
	);

	it("accepts ordinary keys", () => {
		expect(normalisePath("allowed/nested/deep.txt")).toBe("allowed/nested/deep.txt");
	});
});

describe("validatePolicy", () => {
	it("accepts the reference policy", () => {
		expect(() => validatePolicy(policy)).not.toThrow();
	});

	it("rejects a bucket claimed by two domains, which would break containment", () => {
		const broken: Policy = {
			...policy,
			domains: [
				{ id: "RESEARCH", buckets: ["shared"] },
				{ id: "PRODUCTION", buckets: ["shared"] },
			],
			roles: { r: [{ bucket: "shared", prefixes: [""], permission: "read", maxTtlSeconds: 60 }] },
			assignments: [{ email: "a@b.c", roles: ["r"] }],
		};
		expect(() => validatePolicy(broken)).toThrow(PolicyError);
	});

	it("rejects a grant on a bucket no domain owns", () => {
		const broken: Policy = {
			...policy,
			roles: { r: [{ bucket: "orphan", prefixes: [""], permission: "read", maxTtlSeconds: 60 }] },
			assignments: [{ email: "a@b.c", roles: ["r"] }],
		};
		expect(() => validatePolicy(broken)).toThrow(/no domain owns/);
	});

	it("rejects an empty prefix list, which would produce an unlistable credential", () => {
		const broken: Policy = {
			...policy,
			roles: { r: [{ bucket: "research-data", prefixes: [], permission: "read", maxTtlSeconds: 60 }] },
			assignments: [{ email: "a@b.c", roles: ["r"] }],
		};
		expect(() => validatePolicy(broken)).toThrow(/no prefixes/);
	});

	it("rejects an assignment referencing an unknown role", () => {
		expect(() => validatePolicy({ ...policy, assignments: [{ email: "a@b.c", roles: ["ghost"] }] }))
			.toThrow(/unknown role/);
	});

	it("rejects malformed structural values with a policy error", () => {
		const malformed = { ...policy, domains: [null] } as unknown as Policy;
		expect(() => validatePolicy(malformed)).toThrow(PolicyError);
	});
});

describe("clampTtl", () => {
	const grant: Grant = { bucket: "b", prefixes: [""], permission: "read", maxTtlSeconds: 3600 };

	it("caps at the grant maximum", () => {
		expect(clampTtl(999_999, grant)).toBe(3600);
	});

	it("defaults to 900 when unspecified", () => {
		expect(clampTtl(undefined, grant)).toBe(900);
	});

	it("never defaults above the grant maximum", () => {
		expect(clampTtl(undefined, { ...grant, maxTtlSeconds: 300 })).toBe(300);
	});

	it("rejects nonsense", () => {
		expect(clampTtl(-5, grant)).toBe(900);
		expect(clampTtl(Number.NaN, grant)).toBe(900);
	});
});

describe("actionsFor", () => {
	it("grants no mutating action for a read permission", () => {
		const actions = actionsFor("read");
		expect(actions).toEqual(READ_ACTIONS);
		for (const forbidden of ["PutObject", "DeleteObject", "DeleteObjects", "CopyObject"]) {
			expect(actions).not.toContain(forbidden);
		}
	});

	it("grants put but never delete for a write permission by default", () => {
		const actions = actionsFor("write");
		expect(actions).toEqual(WRITE_ACTIONS);
		expect(actions).toContain("PutObject");
		expect(actions).not.toContain("DeleteObject");
		expect(actions).not.toContain("DeleteObjects");
	});

	it("grants delete only when the grant opted in", () => {
		const actions = actionsFor("write", true);
		expect(actions).toContain("PutObject");
		expect(actions).toContain("DeleteObject");
		expect(actions).toContain("DeleteObjects");
	});

	it("ignores allowDelete on a read permission", () => {
		expect(actionsFor("read", true)).toEqual(READ_ACTIONS);
	});

	it("always includes ListObjectsV2, since a credential that cannot list cannot browse", () => {
		expect(actionsFor("read")).toContain("ListObjectsV2");
		expect(actionsFor("write")).toContain("ListObjectsV2");
	});
});

describe("validatePolicy, delete and auditors", () => {
	it("rejects allowDelete on a read grant, which would read as permitted but do nothing", () => {
		expect(() =>
			validatePolicy({
				...policy,
				roles: {
					...policy.roles,
					"bad-role": [
						{ bucket: "research-data", prefixes: [""], permission: "read", maxTtlSeconds: 60, allowDelete: true },
					],
				},
			}),
		).toThrow(/allowDelete on a read grant/);
	});

	it("accepts allowDelete on a write grant", () => {
		expect(() =>
			validatePolicy({
				...policy,
				roles: {
					...policy.roles,
					"ok-role": [
						{ bucket: "research-data", prefixes: [""], permission: "write", maxTtlSeconds: 60, allowDelete: true },
					],
				},
			}),
		).not.toThrow();
	});

	it("rejects an auditors block that names nobody", () => {
		expect(() => validatePolicy({ ...policy, auditors: {} })).toThrow(/names nobody/);
		expect(() => validatePolicy({ ...policy, auditors: { groups: [], emails: [] } })).toThrow(/names nobody/);
	});
});

describe("isAuditor", () => {
	const withAuditors: Policy = {
		...policy,
		auditors: { groups: ["Storage-Admin"], emails: ["boss@example.com"] },
	};

	it("denies by default when no auditors are declared", () => {
		expect(isAuditor(policy, { email: "boss@example.com", groups: ["Storage-Admin"] })).toBe(false);
	});

	it("denies an ordinary user who holds grants", () => {
		expect(isAuditor(withAuditors, { email: "reader@example.com", groups: ["Research"] })).toBe(false);
	});

	it("allows a named email, case-insensitively", () => {
		expect(isAuditor(withAuditors, { email: "BOSS@Example.com", groups: [] })).toBe(true);
	});

	it("allows an exactly named group", () => {
		expect(isAuditor(withAuditors, { email: "x@y.z", groups: ["Storage-Admin"] })).toBe(true);
	});

	it("fails closed when auditor group casing differs", () => {
		expect(isAuditor(withAuditors, { email: "x@y.z", groups: ["storage-admin"] })).toBe(false);
	});
});

describe("maxPermissionFor", () => {
	const writer = resolveGrants(policy, { email: "writer@example.com", groups: [] });
	const reader = resolveGrants(policy, { email: "reader@example.com", groups: [] });

	it("reports write where a write grant covers the path", () => {
		expect(maxPermissionFor(writer, "research-data", "allowed/x")).toBe("write");
	});

	it("reports read where only a read grant covers the path", () => {
		expect(maxPermissionFor(reader, "research-data", "allowed/x")).toBe("read");
	});

	it("reports undefined outside every grant, so the UI offers nothing", () => {
		expect(maxPermissionFor(reader, "research-data", "denied/x")).toBeUndefined();
		expect(maxPermissionFor(reader, "prod-results", "")).toBeUndefined();
	});
});

describe("authorizeBucket", () => {
	const mixed: Policy = {
		...policy,
		roles: {
			reader: [{ bucket: "research-data", prefixes: ["datasets/"], permission: "read", maxTtlSeconds: 3600 }],
			writer: [{ bucket: "research-data", prefixes: ["scratch/"], permission: "write", maxTtlSeconds: 600 }],
			purger: [
				{ bucket: "research-data", prefixes: ["tmp/"], permission: "write", maxTtlSeconds: 300, allowDelete: true },
			],
		},
		assignments: [{ email: "multi@example.com", roles: ["reader", "writer", "purger"] }],
	};
	const grants = resolveGrants(mixed, { email: "multi@example.com", groups: [] });

	it("unions every prefix readable at read level, including write-granted ones", () => {
		const r = authorizeBucket(grants, "research-data", "read");
		expect(r?.prefixes).toEqual(["datasets/", "scratch/", "tmp/"]);
	});

	it("unions only write-capable prefixes at write level", () => {
		const r = authorizeBucket(grants, "research-data", "write");
		expect(r?.prefixes).toEqual(["scratch/", "tmp/"]);
	});

	it("withholds delete unless every contributing grant allows it", () => {
		// scratch/ has no allowDelete, so unioning it with tmp/ must not carry delete.
		expect(authorizeBucket(grants, "research-data", "write")?.allowDelete).toBe(false);
	});

	it("grants delete when every contributing grant allows it", () => {
		const onlyPurger = resolveGrants(
			{ ...mixed, assignments: [{ email: "multi@example.com", roles: ["purger"] }] },
			{ email: "multi@example.com", groups: [] },
		);
		expect(authorizeBucket(onlyPurger, "research-data", "write")?.allowDelete).toBe(true);
	});

	it("takes the minimum TTL, so unioning never extends a stricter grant", () => {
		expect(authorizeBucket(grants, "research-data", "read")?.maxTtlSeconds).toBe(300);
		expect(authorizeBucket(grants, "research-data", "write")?.maxTtlSeconds).toBe(300);
	});

	it("collapses to the whole bucket when a grant covers it", () => {
		const whole = resolveGrants(
			{
				...policy,
				roles: {
					a: [{ bucket: "research-data", prefixes: [""], permission: "read", maxTtlSeconds: 900 }],
					b: [{ bucket: "research-data", prefixes: ["narrow/"], permission: "read", maxTtlSeconds: 900 }],
				},
				assignments: [{ email: "m@e.com", roles: ["a", "b"] }],
			},
			{ email: "m@e.com", groups: [] },
		);
		expect(authorizeBucket(whole, "research-data", "read")?.prefixes).toEqual([""]);
	});

	it("names every contributing role, for the audit log", () => {
		expect(authorizeBucket(grants, "research-data", "read")?.roles).toEqual(["purger", "reader", "writer"]);
	});

	it("denies when no grant in the bucket reaches the level", () => {
		expect(authorizeBucket(grants, "prod-results", "read")).toBeUndefined();
		const readerOnly = resolveGrants(policy, { email: "reader@example.com", groups: [] });
		expect(authorizeBucket(readerOnly, "research-data", "write")).toBeUndefined();
	});
});
