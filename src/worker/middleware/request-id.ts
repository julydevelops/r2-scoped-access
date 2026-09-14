import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

/**
 * Correlates a log line, an audit row, and the error body the caller sees.
 *
 * Error responses deliberately carry generic messages, so the request id is the
 * only way to connect a user's report to the audit trail.
 */
export const requestId = createMiddleware<AppEnv>(async (c, next) => {
	c.set("requestId", crypto.randomUUID());
	await next();
});
