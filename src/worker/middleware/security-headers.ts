import { createMiddleware } from "hono/factory";
import { PRIVATE_RESPONSE_HEADERS } from "../http/responses";
import type { AppEnv } from "../types";

/**
 * Applies the private-response headers on the way out.
 *
 * Route handlers already set them via `json()` and `downloadHeaders()`. This
 * runs outermost so that responses no handler produced, framework 404s and
 * unhandled errors included, cannot be cached or content-sniffed either.
 */
export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
	await next();
	for (const [name, value] of Object.entries(PRIVATE_RESPONSE_HEADERS)) {
		c.res.headers.set(name, value);
	}
});
