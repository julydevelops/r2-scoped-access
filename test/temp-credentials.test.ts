import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAX_TTL_SECONDS, MintError, mintCredentials, s3Endpoint } from "../src/worker/services/temp-credentials";

const parent = { accessKeyId: "parent-akid", secretAccessKey: "parent-secret" };
const accountId = "00000000000000000000000000000000";

function decode(sessionToken: string): { header: unknown; claims: Record<string, unknown>; jwt: string } {
	const raw = Buffer.from(sessionToken, "base64").toString();
	expect(raw.startsWith("jwt/")).toBe(true);
	const jwt = raw.slice(4);
	const [header, payload] = jwt.split(".");
	return {
		header: JSON.parse(Buffer.from(header ?? "", "base64url").toString()),
		claims: JSON.parse(Buffer.from(payload ?? "", "base64url").toString()),
		jwt,
	};
}

describe("mintCredentials", () => {
	it("reuses the parent access key id, per the signing contract", async () => {
		const creds = await mintCredentials(parent, {
			accountId,
			bucket: "b",
			ttlSeconds: 900,
			scope: "object-read-only",
		});
		expect(creds.accessKeyId).toBe(parent.accessKeyId);
	});

	it("derives the secret as the sha256 hex digest of the signed jwt", async () => {
		const creds = await mintCredentials(parent, {
			accountId,
			bucket: "b",
			ttlSeconds: 900,
			scope: "object-read-only",
		});
		const { jwt } = decode(creds.sessionToken);
		expect(creds.secretAccessKey).toBe(createHash("sha256").update(jwt).digest("hex"));
	});

	it("signs HS256 with the account as subject and the S3 host as audience", async () => {
		const creds = await mintCredentials(parent, {
			accountId,
			bucket: "b",
			ttlSeconds: 900,
			scope: "object-read-only",
		});
		const { header, claims } = decode(creds.sessionToken);
		expect(header).toMatchObject({ alg: "HS256", typ: "JWT" });
		expect(claims["sub"]).toBe(accountId);
		expect(claims["iss"]).toBe(parent.accessKeyId);
		expect(claims["aud"]).toBe(new URL(s3Endpoint(accountId)).host);
	});

	it("carries prefix scoping through to the claims", async () => {
		const creds = await mintCredentials(parent, {
			accountId,
			bucket: "b",
			ttlSeconds: 900,
			scope: "object-read-only",
			prefixes: ["allowed/"],
		});
		expect(decode(creds.sessionToken).claims["paths"]).toEqual({
			prefixPaths: ["allowed/"],
			objectPaths: [],
		});
	});

	it("refuses to send scope and actions together", async () => {
		await expect(
			mintCredentials(parent, {
				accountId,
				bucket: "b",
				ttlSeconds: 900,
				scope: "object-read-only",
				actions: ["GetObject"],
			}),
		).rejects.toThrow(MintError);
	});

	it("requires one of scope or actions", async () => {
		await expect(
			mintCredentials(parent, { accountId, bucket: "b", ttlSeconds: 900 }),
		).rejects.toThrow(/required/);
	});

	it("rejects a ttl beyond the 7 day maximum", async () => {
		await expect(
			mintCredentials(parent, {
				accountId,
				bucket: "b",
				ttlSeconds: MAX_TTL_SECONDS + 1,
				scope: "object-read-only",
			}),
		).rejects.toThrow(MintError);
	});

	it("emits actions-only credentials when actions are supplied alone", async () => {
		const creds = await mintCredentials(parent, {
			accountId,
			bucket: "b",
			ttlSeconds: 900,
			actions: ["GetObject", "HeadObject"],
		});
		const { claims } = decode(creds.sessionToken);
		expect(claims["actions"]).toEqual(["GetObject", "HeadObject"]);
		expect(claims["scope"]).toBeUndefined();
	});
});
