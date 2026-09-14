import type { ErrorResponse } from "../../shared/api-types";
import { IdentityError } from "../auth/access";
import { ConfigError } from "../config/parent-tokens";
import { AuditError } from "../services/audit";
import { MintError } from "../services/temp-credentials";
import { json } from "./responses";

/** A malformed or unacceptable request. Always the caller's fault. */
export class RequestError extends Error {}

/**
 * The single place a thrown error becomes a status code.
 *
 * Keeping this as one exhaustive mapping means a new route cannot invent its
 * own translation, and the distinction that matters most stays visible: a
 * failure to record the audit event is a 503 rather than a success, because the
 * response is withheld instead of being served unlogged.
 */
export function toErrorResponse(error: unknown, requestId: string): Response {
	if (error instanceof ConfigError) {
		return json({ error: `Server misconfigured: ${error.message}.`, requestId } satisfies ErrorResponse, 503);
	}
	if (error instanceof AuditError) {
		return json(
			{ error: "The audit record could not be stored, so the response was withheld.", requestId } satisfies ErrorResponse,
			503,
		);
	}
	if (error instanceof MintError) {
		return json({ error: `Credential request rejected: ${error.message}`, requestId } satisfies ErrorResponse, 400);
	}
	if (error instanceof RequestError) {
		return json({ error: error.message, requestId } satisfies ErrorResponse, 400);
	}
	if (error instanceof IdentityError) {
		return json({ error: error.message, requestId } satisfies ErrorResponse, 401);
	}
	return json({ error: "An unexpected error occurred.", requestId } satisfies ErrorResponse, 500);
}
