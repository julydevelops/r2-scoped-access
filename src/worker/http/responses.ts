/**
 * Response construction for a broker that hands out credentials and object
 * bytes. Both are private by definition, so the headers are part of the
 * contract rather than a hardening afterthought.
 */

/** Applied to every response, including 404s and unhandled errors. */
export const PRIVATE_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
	"Cache-Control": "no-store, private",
	"X-Content-Type-Options": "nosniff",
};

export function json(body: unknown, status = 200): Response {
	return Response.json(body, { status, headers: { ...PRIVATE_RESPONSE_HEADERS } });
}

function safeFilename(key: string): string {
	const filename = key.split("/").filter(Boolean).at(-1) ?? "download";
	return encodeURIComponent(filename).replaceAll("'", "%27");
}

/**
 * Forces object content to download rather than render.
 *
 * Object bytes are attacker-controlled and would otherwise execute on the app
 * origin, which is the same origin that holds the Access session. The declared
 * content type is discarded in favour of `application/octet-stream` for the
 * same reason.
 */
export function downloadHeaders(key: string, contentLength: string | null): Headers {
	const headers = new Headers({
		...PRIVATE_RESPONSE_HEADERS,
		"Content-Disposition": `attachment; filename*=UTF-8''${safeFilename(key)}`,
		"Content-Type": "application/octet-stream",
	});
	if (contentLength !== null) headers.set("Content-Length", contentLength);
	return headers;
}
