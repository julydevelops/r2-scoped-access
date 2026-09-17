import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JWSSignatureVerificationFailed, JWKSTimeout } from "jose/errors";

const jose = vi.hoisted(() => ({
	verify: vi.fn(async () => ({ payload: { email: "reader@example.com" } })),
}));

vi.mock("jose", () => ({
	createRemoteJWKSet: vi.fn(() => ({ key: "mock-jwks" })),
	jwtVerify: jose.verify,
}));

import { AccessConfigError, AccessUnavailableError, IdentityError, resolveIdentity } from "../src/worker/auth/access";

beforeEach(() => {
	jose.verify.mockReset();
	jose.verify.mockResolvedValue({ payload: { email: "reader@example.com" } });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("hostname Access identity", () => {
	it("verifies the app token and retrieves the complete identity", async () => {
		const identityLookup = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
			email: "reader@example.com",
			groups: [{ id: "group-1", name: "Research", email: "research@example.com" }],
		}));
		const identity = await resolveIdentity(
			new Request("https://r2-access.example.com/api/me", {
				headers: { "Cf-Access-Jwt-Assertion": "signed-app-token" },
			}),
			{},
			{ teamDomain: "example.cloudflareaccess.com", aud: "app-audience" },
		);

		expect(jose.verify).toHaveBeenCalledWith(
			"signed-app-token",
			expect.anything(),
			{ issuer: "https://example.cloudflareaccess.com", audience: "app-audience" },
		);
		expect(identityLookup).toHaveBeenCalledWith(
			"https://example.cloudflareaccess.com/cdn-cgi/access/get-identity",
			{ headers: { Cookie: "CF_Authorization=signed-app-token" } },
		);
		expect(identity.groups).toEqual(["Research", "research@example.com"]);
	});

	it("treats a JWKS timeout as an Access service failure", async () => {
		jose.verify.mockRejectedValueOnce(new JWKSTimeout());

		await expect(resolveIdentity(
			new Request("https://r2-access.example.com/api/me", {
				headers: { "Cf-Access-Jwt-Assertion": "signed-app-token" },
			}),
			{},
			{ teamDomain: "example.cloudflareaccess.com", aud: "app-audience" },
		)).rejects.toBeInstanceOf(AccessUnavailableError);
	});

	it("treats an invalid signature as a caller authentication failure", async () => {
		jose.verify.mockRejectedValueOnce(new JWSSignatureVerificationFailed());

		await expect(resolveIdentity(
			new Request("https://r2-access.example.com/api/me", {
				headers: { "Cf-Access-Jwt-Assertion": "invalid-app-token" },
			}),
			{},
			{ teamDomain: "example.cloudflareaccess.com", aud: "app-audience" },
		)).rejects.toBeInstanceOf(IdentityError);
	});

	it("treats an identity endpoint outage as an Access service failure", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));

		await expect(resolveIdentity(
			new Request("https://r2-access.example.com/api/me", {
				headers: { "Cf-Access-Jwt-Assertion": "signed-app-token" },
			}),
			{},
			{ teamDomain: "example.cloudflareaccess.com", aud: "app-audience" },
		)).rejects.toBeInstanceOf(AccessUnavailableError);
	});

	it("treats an invalid identity response as an Access service failure", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not-json", { status: 200 }));

		await expect(resolveIdentity(
			new Request("https://r2-access.example.com/api/me", {
				headers: { "Cf-Access-Jwt-Assertion": "signed-app-token" },
			}),
			{},
			{ teamDomain: "example.cloudflareaccess.com", aud: "app-audience" },
		)).rejects.toBeInstanceOf(AccessUnavailableError);
	});

	it("treats identity endpoint rejection as a caller authentication failure", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));

		await expect(resolveIdentity(
			new Request("https://r2-access.example.com/api/me", {
				headers: { "Cf-Access-Jwt-Assertion": "signed-app-token" },
			}),
			{},
			{ teamDomain: "example.cloudflareaccess.com", aud: "app-audience" },
		)).rejects.toBeInstanceOf(IdentityError);
	});

	it("treats a placeholder audience as deployment configuration failure", async () => {
		await expect(resolveIdentity(
			new Request("https://r2-access.example.com/api/me", {
				headers: { "Cf-Access-Jwt-Assertion": "signed-app-token" },
			}),
			{},
			{ teamDomain: "example.cloudflareaccess.com", aud: "replace-with-access-audience" },
		)).rejects.toBeInstanceOf(AccessConfigError);
	});
});
