import type { ErrorResponse } from "../shared/api-types";

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly kind?: ErrorResponse["kind"],
		readonly requestId?: string,
	) {
		super(message);
	}
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, {
		...init,
		headers: {
			Accept: "application/json",
			...init?.headers,
		},
	});
	const payload = (await response.json().catch(() => ({ error: "The server returned an invalid response." }))) as
		| T
		| ErrorResponse;
	if (!response.ok) {
		const error = payload as ErrorResponse;
		throw new ApiError(error.error, response.status, error.kind, error.requestId);
	}
	return payload as T;
}

export function errorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		return error.requestId === undefined ? error.message : `${error.message} Request ${error.requestId}.`;
	}
	return error instanceof Error ? error.message : "The request failed.";
}
