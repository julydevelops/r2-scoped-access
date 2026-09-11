import { afterEach, describe, expect, it, vi } from "vitest";

const jose = vi.hoisted(() => ({
	verify: vi.fn(async () => ({ payload: { email: "reader@example.com" } })),
}));

vi.mock("jose", () => ({
	createRemoteJWKSet: vi.fn(() => ({ key: "mock-jwks" })),
	jwtVerify: jose.verify,
}));

import { resolveIdentity } from "../src/worker/auth/access";

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
});
