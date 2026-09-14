/**
 * Request and response limits, named so that the reason for each bound lives
 * next to the number rather than inline at the call site.
 */

/**
 * Cap on JSON request bodies. Credential requests are a handful of short
 * fields, so anything larger is malformed or hostile and is rejected before
 * being buffered.
 */
export const MAX_JSON_BODY_BYTES = 16_384;

/**
 * Cap on browser-proxied uploads. Larger objects should go direct to R2 with a
 * vended credential rather than through the Worker, which would otherwise pay
 * CPU and wall time proportional to the object size.
 */
export const MAX_BROWSER_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * TTL for credentials the Worker mints for its own immediate use. The
 * credential is consumed within the request, so it only has to outlive one R2
 * round trip. Still clamped by the grant's `maxTtlSeconds`.
 */
export const INLINE_TTL_SECONDS = 60;

/** Objects returned per `GET /api/objects` page. */
export const LIST_PAGE_SIZE = 200;

/** Audit rows returned per `GET /api/audit` page. */
export const AUDIT_PAGE_SIZE = 100;
