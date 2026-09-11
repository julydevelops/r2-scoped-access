import { SignJWT } from "jose";

/**
 * R2 temporary credentials via local JWT signing.
 *
 * Local signing allows explicit S3 action lists, including write credentials
 * that deliberately omit deletion, while retaining a bucket-scoped parent.
 */

export type R2Scope =
	| "object-read-only"
	| "object-read-write"
	| "admin-read-only"
	| "admin-read-write";

export type R2Action =
	| "HeadObject"
	| "GetObject"
	| "GetBucketLocation"
	| "ListObjectsV1"
	| "ListObjectsV2"
	| "ListMultipartUploads"
	| "ListParts"
	| "PutObject"
	| "DeleteObject"
	| "DeleteObjects"
	| "CopyObject"
	| "CreateMultipartUpload"
	| "UploadPart"
	| "UploadPartCopy"
	| "AbortMultipartUpload"
	| "CompleteMultipartUpload";

export interface TempCredentials {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken: string;
	expiresAt: string;
}

export interface ParentToken {
	accessKeyId: string;
	secretAccessKey: string;
}

export interface MintOptions {
	accountId: string;
	bucket: string;
	ttlSeconds: number;
	/** Mutually exclusive with `actions`. */
	scope?: R2Scope;
	/** Mutually exclusive with `scope`. Local signing only. */
	actions?: readonly R2Action[];
	prefixes?: readonly string[];
	objects?: readonly string[];
}

export const MAX_TTL_SECONDS = 604_800;

export class MintError extends Error {}

interface JwtClaims {
	bucket: string;
	scope?: R2Scope;
	actions?: readonly R2Action[];
	paths?: { prefixPaths: readonly string[]; objectPaths: readonly string[] };
}

function toHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function base64(input: string): string {
	const bytes = new TextEncoder().encode(input);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

export function s3Endpoint(accountId: string): string {
	return `https://${accountId}.r2.cloudflarestorage.com`;
}

export async function mintCredentials(
	parent: ParentToken,
	options: MintOptions,
): Promise<TempCredentials> {
	const { accountId, bucket, ttlSeconds, scope, actions, prefixes, objects } = options;

	if (scope !== undefined && actions !== undefined) {
		throw new MintError("`scope` and `actions` are mutually exclusive");
	}
	if (scope === undefined && (actions === undefined || actions.length === 0)) {
		throw new MintError("one of `scope` or a non-empty `actions` is required");
	}
	if (ttlSeconds <= 0 || ttlSeconds > MAX_TTL_SECONDS) {
		throw new MintError(`ttlSeconds must be between 1 and ${MAX_TTL_SECONDS}`);
	}

	const claims: JwtClaims = { bucket };
	if (scope !== undefined) claims.scope = scope;
	if (actions !== undefined) claims.actions = actions;
	if (prefixes !== undefined || objects !== undefined) {
		claims.paths = { prefixPaths: prefixes ?? [], objectPaths: objects ?? [] };
	}

	const host = new URL(s3Endpoint(accountId)).host;
	const jwt = await new SignJWT({ ...claims })
		.setProtectedHeader({ alg: "HS256", typ: "JWT" })
		.setSubject(accountId)
		.setIssuer(parent.accessKeyId)
		.setAudience(host)
		.setIssuedAt()
		.setExpirationTime(`${ttlSeconds}s`)
		.sign(new TextEncoder().encode(parent.secretAccessKey));

	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jwt));

	return {
		// The parent access key ID is reused as the temporary access key ID.
		accessKeyId: parent.accessKeyId,
		secretAccessKey: toHex(digest),
		sessionToken: base64(`jwt/${jwt}`),
		expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
	};
}
