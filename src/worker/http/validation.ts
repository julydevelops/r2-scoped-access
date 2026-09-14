import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import type { ErrorResponse } from "../../shared/api-types";
import { MAX_JSON_BODY_BYTES } from "../config/limits";
import type { AppEnv } from "../types";
import { RequestError } from "./errors";
import { json } from "./responses";

/**
 * Guards for JSON request bodies.
 *
 * Applied as explicit per-route middleware rather than globally, because the
 * object upload route streams an arbitrarily large body straight to R2 and must
 * not be buffered or size-checked by the same rules.
 */

/**
 * Rejects oversized bodies before they are buffered.
 *
 * Checks `Content-Length` first and otherwise counts bytes as they arrive, so a
 * chunked request cannot exhaust memory by omitting the header.
 */
export const jsonBodyLimit = bodyLimit({
	maxSize: MAX_JSON_BODY_BYTES,
	onError: (c) =>
		json(
			{
				error: `JSON request bodies are limited to ${MAX_JSON_BODY_BYTES} bytes.`,
				requestId: (c as Context<AppEnv>).var.requestId,
			} satisfies ErrorResponse,
			413,
		),
});

/**
 * Requires a JSON body to actually be present and declared as JSON.
 *
 * Hono's validator skips parsing entirely when the content type is not JSON,
 * which would let a body-less request satisfy a schema of all-optional fields.
 * Failing here keeps "you sent nothing" distinct from "what you sent was
 * wrong", and stops a request that was never parsed from being treated as one
 * that validated.
 */
export const requireJsonBody = createMiddleware<AppEnv>(async (c, next) => {
	if (c.req.raw.body === null) throw new RequestError("A JSON request body is required.");
	if (!/^application\/([a-z\-.]+\+)?json\b/i.test(c.req.header("Content-Type") ?? "")) {
		throw new RequestError("The request body must be declared as application/json.");
	}
	await next();
});

/**
 * Turns a schema failure into the API's standard error envelope.
 *
 * Only the first issue is reported, in schema declaration order, so the caller
 * is told about one concrete field instead of being handed a tree to interpret.
 * Throwing rather than responding routes it through the single error mapper, so
 * a validation failure carries the same shape and request id as every other
 * 4xx.
 */
export function firstIssue(result: {
	success: boolean;
	error?: { issues: readonly { message: string }[] };
}): void {
	if (result.success) return;
	throw new RequestError(result.error?.issues[0]?.message ?? "The request was not valid.");
}
