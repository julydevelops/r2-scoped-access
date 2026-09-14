import { Hono } from "hono";
import type { ErrorResponse } from "../shared/api-types";
import { toErrorResponse } from "./http/errors";
import { json } from "./http/responses";
import { auditContext, identity, policyGuard, requestId, securityHeaders } from "./middleware";
import { auditRoutes, credentialRoutes, identityRoutes, objectRoutes } from "./routes";
import type { AppEnv } from "./types";

/**
 * The API surface.
 *
 * Only `/api/*` reaches this Worker; everything else is served by Workers
 * Static Assets ahead of it (`run_worker_first` in wrangler.jsonc). The base
 * path is declared here so route modules describe paths relative to the API
 * root and cannot drift from it.
 */
export const app = new Hono<AppEnv>().basePath("/api");

/**
 * Middleware order is load-bearing.
 *
 * `securityHeaders` is outermost so that responses no handler produced, 404s
 * and unhandled errors included, are still uncacheable. `requestId` precedes
 * everything that reports an error, since the id is the only handle a caller
 * can quote. `policyGuard` precedes `identity` because an unparseable policy
 * means the deny-by-default model cannot be evaluated, and nobody should be
 * authenticated into a ruleset the broker does not understand. `auditContext`
 * is last, because it binds the writer to an identity that must already exist.
 */
app.use("*", securityHeaders);
app.use("*", requestId);
app.use("*", policyGuard);
app.use("*", identity);
app.use("*", auditContext);

app.route("/", identityRoutes);
app.route("/", objectRoutes);
app.route("/", credentialRoutes);
app.route("/", auditRoutes);

/**
 * Unknown paths answer in the API's own error shape rather than Hono's default
 * text, so a client that mistypes a path gets something its error handling
 * already understands.
 */
app.notFound(() => json({ error: "not found" } satisfies ErrorResponse, 404));

/**
 * Nothing escapes without being logged and mapped.
 *
 * The response body stays deliberately generic while the log line carries the
 * detail, and the request id appears in both so the two can be joined without
 * exposing internals to the caller.
 */
app.onError((error, c) => {
	const id = c.var.requestId ?? "unknown";
	console.error(
		JSON.stringify({
			message: "request failed",
			error: error instanceof Error ? error.message : String(error),
			requestId: id,
			path: new URL(c.req.url).pathname,
		}),
	);
	return toErrorResponse(error, id);
});
