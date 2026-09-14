import { app } from "./app";

/**
 * Worker entry point.
 *
 * Deliberately thin: everything of substance lives in `app.ts` and the modules
 * it composes, so that the deployment surface is one line and the application
 * can be exercised without going through a `fetch` handler.
 */

export { downloadHeaders, json } from "./http/responses";

export default {
	/**
	 * `ctx` is narrowed to `access` because that is the only part this Worker
	 * consumes. Audit writes are awaited rather than deferred to `waitUntil`, so
	 * that a failed write can still withhold the response. Declaring the weaker
	 * requirement keeps that property checkable rather than conventional.
	 */
	async fetch(request: Request, env: Env, ctx: Pick<ExecutionContext, "access">): Promise<Response> {
		return await app.fetch(request, env, ctx as ExecutionContext);
	},
} satisfies ExportedHandler<Env>;
