import { AwsClient } from "aws4fetch";
import { s3Endpoint, type TempCredentials } from "./temp-credentials";

/**
 * All object access goes through a freshly minted, scoped credential. The parent
 * token is never used to serve a user request, so enforcement lives in R2 rather
 * than only in this app's policy code. A bug here degrades to "no access", not
 * "wrong access".
 */

export interface ListEntry {
	key: string;
	size: number;
	lastModified: string;
}

export interface ListResult {
	prefix: string;
	folders: string[];
	objects: ListEntry[];
	truncated: boolean;
	continuationToken?: string;
}

/** Distinguishes rejected credentials from an out-of-scope request. */
export type R2Failure =
	| { kind: "revoked"; status: 401; message: string }
	| { kind: "forbidden"; status: 403; message: string }
	| { kind: "notFound"; status: 404; message: string }
	| { kind: "other"; status: number; message: string };

export function classify(status: number, body: string): R2Failure {
	const code = body.match(/<Code>(.*?)<\/Code>/)?.[1] ?? "";
	if (status === 401) {
		return {
			kind: "revoked",
			status: 401,
			message: "Credential rejected. The parent token for this trust domain has been revoked or rotated.",
		};
	}
	if (status === 403) {
		return {
			kind: "forbidden",
			status: 403,
			message: `Not entitled to that path (${code || "AccessDenied"}).`,
		};
	}
	if (status === 404) {
		return { kind: "notFound", status: 404, message: "No such object." };
	}
	return { kind: "other", status, message: code || `R2 returned ${status}` };
}

function client(credentials: TempCredentials): AwsClient {
	return new AwsClient({
		accessKeyId: credentials.accessKeyId,
		secretAccessKey: credentials.secretAccessKey,
		sessionToken: credentials.sessionToken,
		service: "s3",
		region: "auto",
	});
}

function text(xml: string, tag: string): string[] {
	return [...xml.matchAll(new RegExp(`<${tag}>(.*?)</${tag}>`, "g"))].map((m) => decodeXml(m[1] ?? ""));
}

function decodeXml(value: string): string {
	return value
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'")
		.replaceAll("&amp;", "&");
}

/**
 * Lists one level under `prefix`.
 *
 * `prefix` is always sent explicitly because the credential itself is scoped to
 * the policy-defined prefix tree.
 */
export async function listObjects(
	credentials: TempCredentials,
	accountId: string,
	bucket: string,
	prefix: string,
	limit = 200,
	continuationToken?: string,
): Promise<ListResult | R2Failure> {
	const url = new URL(`${s3Endpoint(accountId)}/${bucket}`);
	url.searchParams.set("list-type", "2");
	url.searchParams.set("prefix", prefix);
	url.searchParams.set("delimiter", "/");
	url.searchParams.set("max-keys", String(limit));
	if (continuationToken !== undefined && continuationToken !== "") {
		url.searchParams.set("continuation-token", continuationToken);
	}

	const response = await client(credentials).fetch(url.toString());
	const body = await response.text();
	if (!response.ok) return classify(response.status, body);

	const keys = text(body, "Key");
	const sizes = text(body, "Size");
	const modified = text(body, "LastModified");

	const objects: ListEntry[] = keys.map((key, index) => ({
		key,
		size: Number(sizes[index] ?? 0),
		lastModified: modified[index] ?? "",
	}));

	const nextContinuationToken = text(body, "NextContinuationToken")[0];
	return {
		prefix,
		folders: text(body, "Prefix").filter((p) => p !== prefix),
		objects: objects.filter((o) => o.key !== prefix),
		truncated: body.includes("<IsTruncated>true</IsTruncated>"),
		...(nextContinuationToken === undefined ? {} : { continuationToken: nextContinuationToken }),
	};
}

export async function getObject(
	credentials: TempCredentials,
	accountId: string,
	bucket: string,
	key: string,
): Promise<Response | R2Failure> {
	const response = await client(credentials).fetch(`${s3Endpoint(accountId)}/${bucket}/${encodeKey(key)}`);
	if (!response.ok) return classify(response.status, await response.text());
	return response;
}

export async function putObject(
	credentials: TempCredentials,
	accountId: string,
	bucket: string,
	key: string,
	body: ReadableStream | ArrayBuffer,
	contentType: string | null,
): Promise<{ ok: true } | R2Failure> {
	const headers = new Headers();
	if (contentType !== null) headers.set("Content-Type", contentType);
	const response = await client(credentials).fetch(`${s3Endpoint(accountId)}/${bucket}/${encodeKey(key)}`, {
		method: "PUT",
		body,
		headers,
	});
	if (!response.ok) return classify(response.status, await response.text());
	return { ok: true };
}

export function isFailure(value: unknown): value is R2Failure {
	return typeof value === "object" && value !== null && "kind" in value && "status" in value;
}

function encodeKey(key: string): string {
	return key
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}
