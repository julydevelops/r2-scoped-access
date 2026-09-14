import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import type { ErrorResponse, ObjectsResponse } from "../../shared/api-types";
import { mintForPath } from "../broker/scoped-credential";
import { INLINE_TTL_SECONDS, LIST_PAGE_SIZE, MAX_BROWSER_UPLOAD_BYTES } from "../config/limits";
import { maxPermissionFor, normalisePath } from "../domain/policy";
import { downloadHeaders } from "../http/responses";
import { firstIssue } from "../http/validation";
import { getObject, isFailure, listObjects, putObject } from "../services/r2";
import type { AppEnv } from "../types";
import { listQuerySchema, objectQuerySchema } from "./schemas";

/**
 * Browsing and single-object transfer.
 *
 * These routes mint a credential for their own immediate use and discard it, so
 * the TTL is only long enough for one R2 round trip. Anything the user needs to
 * keep is issued through `/api/credentials` instead.
 */

export const objectRoutes = new Hono<AppEnv>()
	.get("/objects", zValidator("query", listQuerySchema, firstIssue), async (c) => {
		const { bucket, prefix, cursor } = c.req.valid("query");

		const scoped = await mintForPath(c, {
			action: "list",
			bucket,
			path: prefix,
			permission: "read",
			ttlSeconds: INLINE_TTL_SECONDS,
			denyDetail: "no grant covers this prefix",
			denyMessage: "Not entitled to that prefix.",
		});
		if (!scoped.ok) return scoped.response;

		const result = await listObjects(
			scoped.credentials,
			c.env.CF_ACCOUNT_ID,
			bucket,
			prefix,
			LIST_PAGE_SIZE,
			cursor,
		);
		if (isFailure(result)) return await scoped.failed(result);
		await scoped.granted();

		return c.json({
			...result,
			// Lets the client cap its permission selector to what policy would
			// actually grant here, instead of offering a level guaranteed to 403.
			maxPermission: maxPermissionFor(c.var.grants, bucket, prefix) ?? "read",
		} satisfies ObjectsResponse);
	})

	.get("/object", zValidator("query", objectQuerySchema, firstIssue), async (c) => {
		const { bucket, key } = c.req.valid("query");
		if (normalisePath(key) === undefined) return await rejectKey(c, "get", bucket, key);

		const scoped = await mintForPath(c, {
			action: "get",
			bucket,
			path: key,
			permission: "read",
			ttlSeconds: INLINE_TTL_SECONDS,
			denyDetail: "no grant covers this key",
			denyMessage: "Not entitled to read that key.",
		});
		if (!scoped.ok) return scoped.response;

		const result = await getObject(scoped.credentials, c.env.CF_ACCOUNT_ID, bucket, key);
		if (isFailure(result)) return await scoped.failed(result);
		await scoped.granted();

		return new Response(result.body, {
			headers: downloadHeaders(key, result.headers.get("Content-Length")),
		});
	})

	.put("/object", zValidator("query", objectQuerySchema, firstIssue), async (c) => {
		const { bucket, key } = c.req.valid("query");

		// Size is checked before authorization: it is a property of the request,
		// not of the caller, and rejecting here avoids signing a credential for an
		// upload that was never going to be accepted.
		const lengthHeader = c.req.header("Content-Length");
		const contentLength = lengthHeader === undefined ? Number.NaN : Number(lengthHeader);
		if (!Number.isInteger(contentLength) || contentLength < 0) {
			await c.var.audit("put", "denied", "missing or invalid Content-Length", {
				bucket,
				path: key,
				permission: "write",
			});
			return c.json(
				{ error: "Browser uploads require a valid Content-Length header." } satisfies ErrorResponse,
				411,
			);
		}
		if (contentLength > MAX_BROWSER_UPLOAD_BYTES) {
			await c.var.audit("put", "denied", "browser upload exceeded 100 MB", {
				bucket,
				path: key,
				permission: "write",
			});
			return c.json(
				{
					error: "Browser uploads are limited to 100 MB. Use temporary S3 credentials for larger objects.",
				} satisfies ErrorResponse,
				413,
			);
		}

		if (normalisePath(key) === undefined) return await rejectKey(c, "put", bucket, key);

		const scoped = await mintForPath(c, {
			action: "put",
			bucket,
			path: key,
			permission: "write",
			ttlSeconds: INLINE_TTL_SECONDS,
			denyDetail: "no grant covers this key",
			denyMessage: "Not entitled to write that key.",
		});
		if (!scoped.ok) return scoped.response;

		// Recorded before the write leaves the isolate. If this request dies
		// mid-upload the object may still exist, so the log has to show that write
		// capability was exercised rather than showing nothing at all.
		await scoped.intent("pending R2 response");

		const result = await putObject(
			scoped.credentials,
			c.env.CF_ACCOUNT_ID,
			bucket,
			key,
			c.req.raw.body ?? new ArrayBuffer(0),
			c.req.header("Content-Type") ?? null,
		);
		if (isFailure(result)) return await scoped.failed(result);
		await scoped.granted();

		return c.json({ ok: true, key });
	});

/**
 * Traversal and control characters are refused before anything is signed.
 *
 * R2 would reject these too, but a request that never reaches R2 cannot be
 * mis-signed, and this keeps traversal attempts out of the audit log as
 * authorized events.
 */
async function rejectKey(c: Context<AppEnv>, action: "get" | "put", bucket: string, key: string): Promise<Response> {
	await c.var.audit(action, "denied", "rejected path", {
		bucket,
		path: key,
		permission: action === "put" ? "write" : "read",
	});
	return c.json({ error: "Invalid object key." } satisfies ErrorResponse, 400);
}
