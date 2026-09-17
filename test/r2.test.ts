import { afterEach, describe, expect, it, vi } from "vitest";
import { classify, putObject } from "../src/worker/services/r2";
import type { TempCredentials } from "../src/worker/services/temp-credentials";

const credentials: TempCredentials = {
	accessKeyId: "temporary-key",
	secretAccessKey: "temporary-secret",
	sessionToken: "temporary-session",
	expiresAt: "2026-09-17T12:00:00.000Z",
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("R2 error classification", () => {
	it.each([
		[401, "Unauthorized", "authentication", "R2 rejected the credential (Unauthorized)."],
		[403, "ExpiredRequest", "authentication", "The signed R2 request has expired."],
		[403, "SignatureDoesNotMatch", "authentication", "R2 rejected the request signature."],
		[403, "AccessDenied", "forbidden", "R2 denied that operation or path."],
		[403, "ObjectLockedByBucketPolicy", "forbidden", "The object is protected by an R2 bucket lock rule."],
		[403, "NotEntitled", "other", "The account is not entitled to this R2 operation."],
		[404, "NoSuchBucket", "notFound", "No such bucket."],
		[404, "NoSuchKey", "notFound", "No such object."],
	] as const)("maps %s %s without guessing the cause", (status, code, kind, message) => {
		expect(classify(status, `<Error><Code>${code}</Code></Error>`)).toEqual({ kind, status, message });
	});

	it("uses a neutral fallback for an unrecognized forbidden response", () => {
		expect(classify(403, "")).toEqual({
			kind: "forbidden",
			status: 403,
			message: "R2 denied the request.",
		});
	});
});

describe("R2 uploads", () => {
	it("forwards an enforced Content-Length and disables automatic retries", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const request = input instanceof Request ? input : new Request(input);
			expect(request.headers.get("Content-Length")).toBe("3");
			expect(await request.text()).toBe("abc");
			return new Response("<Error><Code>InternalError</Code></Error>", { status: 500 });
		});

		const result = await putObject(
			credentials,
			"account-id",
			"bucket",
			"prefix/object.txt",
			new TextEncoder().encode("abc").buffer,
			"text/plain",
			3,
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ kind: "other", status: 500, message: "InternalError" });
	});

	it("streams an incoming request body without buffering it", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const request = input instanceof Request ? input : new Request(input);
			expect(await request.text()).toBe("abcdef");
			return new Response(null, { status: 200 });
		});
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("abc"));
				controller.enqueue(new TextEncoder().encode("def"));
				controller.close();
			},
		});

		await expect(putObject(
			credentials,
			"account-id",
			"bucket",
			"prefix/object.txt",
			body,
			"text/plain",
			6,
		)).resolves.toEqual({ ok: true });
	});

	it("rejects a body shorter than its declared Content-Length", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const request = input instanceof Request ? input : new Request(input);
			await request.arrayBuffer();
			return new Response(null, { status: 200 });
		});

		await expect(putObject(
			credentials,
			"account-id",
			"bucket",
			"prefix/object.txt",
			new TextEncoder().encode("abc").buffer,
			"text/plain",
			4,
		)).rejects.toThrow();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
