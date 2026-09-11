import policyDocument from "../../policy.json";
import { IdentityError, resolveIdentity } from "./auth/access";
import {
	actionsFor,
	authorize,
	authorizeBucket,
	clampTtl,
	isAuditor,
	maxPermissionFor,
	normalisePath,
	resolveGrants,
	validatePolicy,
	type Identity,
	type Permission,
	type Policy,
	type ResolvedGrant,
} from "./domain/policy";
import { AuditError, auditFromGrant, record, type AuditOutcome } from "./services/audit";
import { getObject, isFailure, listObjects, putObject } from "./services/r2";
import { mintCredentials, MintError, s3Endpoint, type ParentToken } from "./services/temp-credentials";

const policy = policyDocument as Policy;
const policyValidationError = (() => {
	try {
		validatePolicy(policy);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
})();

export class ConfigError extends Error {}
export class RequestError extends Error {}

function parentFor(env: Env, domainId: string): ParentToken {
	const accessKeyId: unknown = Reflect.get(env, `PARENT_${domainId}_AKID`);
	const secretAccessKey: unknown = Reflect.get(env, `PARENT_${domainId}_SECRET`);
	if (typeof accessKeyId !== "string" || accessKeyId === "") {
		throw new ConfigError(`PARENT_${domainId}_AKID is not set`);
	}
	if (typeof secretAccessKey !== "string" || secretAccessKey === "") {
		throw new ConfigError(`PARENT_${domainId}_SECRET is not set`);
	}
	return { accessKeyId, secretAccessKey };
}

export function json(body: unknown, status = 200): Response {
	return Response.json(body, {
		status,
		headers: {
			"Cache-Control": "no-store, private",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

function entitlements(grants: readonly ResolvedGrant[]) {
	return grants.map((grant) => ({
		bucket: grant.bucket,
		prefixes: grant.prefixes,
		permission: grant.permission,
		allowDelete: grant.allowDelete === true,
		maxTtlSeconds: grant.maxTtlSeconds,
		domain: grant.domainId,
		role: grant.role,
	}));
}

function safeFilename(key: string): string {
	const filename = key.split("/").filter(Boolean).at(-1) ?? "download";
	return encodeURIComponent(filename).replaceAll("'", "%27");
}

export function downloadHeaders(key: string, contentLength: string | null): Headers {
	const headers = new Headers({
		"Cache-Control": "no-store, private",
		"Content-Disposition": `attachment; filename*=UTF-8''${safeFilename(key)}`,
		"Content-Type": "application/octet-stream",
		"X-Content-Type-Options": "nosniff",
	});
	if (contentLength !== null) headers.set("Content-Length", contentLength);
	return headers;
}

async function readJsonBody<T>(request: Request, maxBytes = 16_384): Promise<T> {
	if (request.body === null) throw new RequestError("A JSON request body is required.");
	const reader = request.body.getReader();
	const decoder = new TextDecoder();
	let total = 0;
	let text = "";
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) break;
		total += chunk.value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new RequestError(`JSON request bodies are limited to ${maxBytes} bytes.`);
		}
		text += decoder.decode(chunk.value, { stream: true });
	}
	text += decoder.decode();
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new RequestError("The request body must be valid JSON.");
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: Pick<ExecutionContext, "access">): Promise<Response> {
		const requestId = crypto.randomUUID();
		const url = new URL(request.url);

		if (!url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
		if (policyValidationError !== null) {
			return json({ error: `policy is invalid: ${policyValidationError}`, requestId }, 500);
		}

		let identity: Identity;
		try {
			identity = await resolveIdentity(request, ctx, {
				teamDomain: env.ACCESS_TEAM_DOMAIN,
				aud: env.ACCESS_AUD,
			});
		} catch (error) {
			if (error instanceof IdentityError) return json({ error: error.message, requestId }, 401);
			const message = error instanceof Error ? error.message : String(error);
			console.error(JSON.stringify({ message: "identity resolution failed", error: message, requestId }));
			return json({ error: "Identity could not be resolved.", requestId }, 500);
		}

		const grants = resolveGrants(policy, identity);
		const audit = async (
			action: string,
			outcome: AuditOutcome,
			detail: string | null,
			fields: {
				bucket?: string;
				path?: string;
				permission?: Permission;
				ttlSeconds?: number;
				grant?: ResolvedGrant;
				prefixes?: string[];
				actions?: readonly string[];
			} = {},
		): Promise<void> => {
			await record(
				env.AUDIT_DB,
				auditFromGrant(
					{
						identity,
						action,
						bucket: fields.bucket ?? null,
						path: fields.path ?? null,
						permission: fields.permission ?? null,
						ttlSeconds: fields.ttlSeconds ?? null,
						outcome,
						detail,
						requestId,
					},
					fields.grant,
					fields.prefixes,
					fields.actions,
				),
			);
		};

		try {
			if (url.pathname === "/api/me" && request.method === "GET") {
				return json({
					email: identity.email,
					groups: identity.groups,
					isAuditor: isAuditor(policy, identity),
					entitlements: entitlements(grants),
				});
			}

			if (url.pathname === "/api/identity" && request.method === "GET") {
				await audit("identity-read", "granted", grants.length === 0 ? "no grants resolved" : null);
				return json({
					email: identity.email,
					groups: identity.groups,
					isAuditor: isAuditor(policy, identity),
					entitlements: entitlements(grants),
				});
			}

			if (url.pathname === "/api/objects" && request.method === "GET") {
				const bucket = url.searchParams.get("bucket") ?? "";
				const prefix = url.searchParams.get("prefix") ?? "";
				const cursor = url.searchParams.get("cursor") ?? undefined;
				const decision = authorize(grants, { bucket, path: prefix, permission: "read" });
				if (decision === undefined) {
					await audit("list", "denied", "no grant covers this prefix", { bucket, path: prefix, permission: "read" });
					return json({ error: "Not entitled to that prefix." }, 403);
				}

				const ttl = clampTtl(60, decision.grant);
				const actions = actionsFor("read");
				const credentials = await mintCredentials(parentFor(env, decision.grant.domainId), {
					accountId: env.CF_ACCOUNT_ID,
					bucket,
					ttlSeconds: ttl,
					actions,
					prefixes: decision.prefixes,
				});
				const result = await listObjects(credentials, env.CF_ACCOUNT_ID, bucket, prefix, 200, cursor);
				if (isFailure(result)) {
					await audit("list", "error", result.message, {
						bucket,
						path: prefix,
						permission: "read",
						grant: decision.grant,
						prefixes: decision.prefixes,
					});
					return json({ error: result.message, kind: result.kind }, result.status);
				}
				await audit("list", "granted", null, {
					bucket,
					path: prefix,
					permission: "read",
					ttlSeconds: ttl,
					grant: decision.grant,
					prefixes: decision.prefixes,
					actions,
				});
				return json({ ...result, maxPermission: maxPermissionFor(grants, bucket, prefix) ?? "read" });
			}

			if (url.pathname === "/api/object" && (request.method === "GET" || request.method === "PUT")) {
				const bucket = url.searchParams.get("bucket") ?? "";
				const key = url.searchParams.get("key") ?? "";
				const permission: Permission = request.method === "PUT" ? "write" : "read";
				if (normalisePath(key) === undefined) {
					await audit(permission === "write" ? "put" : "get", "denied", "rejected path", { bucket, path: key, permission });
					return json({ error: "Invalid object key." }, 400);
				}

				const decision = authorize(grants, { bucket, path: key, permission });
				if (decision === undefined) {
					await audit(permission === "write" ? "put" : "get", "denied", "no grant covers this key", { bucket, path: key, permission });
					return json({ error: `Not entitled to ${permission} that key.` }, 403);
				}
				if (request.method === "PUT") {
					const lengthHeader = request.headers.get("Content-Length");
					const contentLength = lengthHeader === null ? Number.NaN : Number(lengthHeader);
					if (!Number.isInteger(contentLength) || contentLength < 0) {
						await audit("put", "denied", "missing or invalid Content-Length", { bucket, path: key, permission, grant: decision.grant });
						return json({ error: "Browser uploads require a valid Content-Length header." }, 411);
					}
					if (contentLength > 100 * 1024 * 1024) {
						await audit("put", "denied", "browser upload exceeded 100 MB", { bucket, path: key, permission, grant: decision.grant });
						return json({ error: "Browser uploads are limited to 100 MB. Use temporary S3 credentials for larger objects." }, 413);
					}
				}

				const ttl = clampTtl(60, decision.grant);
				const actions = actionsFor(permission, false);
				const credentials = await mintCredentials(parentFor(env, decision.grant.domainId), {
					accountId: env.CF_ACCOUNT_ID,
					bucket,
					ttlSeconds: ttl,
					actions,
					prefixes: decision.prefixes,
				});

				if (request.method === "GET") {
					const result = await getObject(credentials, env.CF_ACCOUNT_ID, bucket, key);
					if (isFailure(result)) {
						await audit("get", "error", result.message, { bucket, path: key, permission, grant: decision.grant, prefixes: decision.prefixes });
						return json({ error: result.message, kind: result.kind }, result.status);
					}
					await audit("get", "granted", null, { bucket, path: key, permission, ttlSeconds: ttl, grant: decision.grant, prefixes: decision.prefixes });
					return new Response(result.body, {
						headers: downloadHeaders(key, result.headers.get("Content-Length")),
					});
				}

				await audit("put-intent", "granted", "pending R2 response", {
					bucket,
					path: key,
					permission,
					ttlSeconds: ttl,
					grant: decision.grant,
					prefixes: decision.prefixes,
					actions,
				});
				const result = await putObject(
					credentials,
					env.CF_ACCOUNT_ID,
					bucket,
					key,
					request.body ?? new ArrayBuffer(0),
					request.headers.get("Content-Type"),
				);
				if (isFailure(result)) {
					await audit("put", "error", result.message, { bucket, path: key, permission, grant: decision.grant, prefixes: decision.prefixes });
					return json({ error: result.message, kind: result.kind }, result.status);
				}
				await audit("put", "granted", null, { bucket, path: key, permission, ttlSeconds: ttl, grant: decision.grant, prefixes: decision.prefixes, actions });
				return json({ ok: true, key });
			}

			if (url.pathname === "/api/credentials" && request.method === "POST") {
				const body = await readJsonBody<{
					bucket?: string;
					prefix?: string;
					permission?: Permission;
					ttlSeconds?: number;
					allPrefixes?: boolean;
					includeDelete?: boolean;
				}>(request);
				if (body.bucket !== undefined && typeof body.bucket !== "string") throw new RequestError("bucket must be a string.");
				if (body.prefix !== undefined && typeof body.prefix !== "string") throw new RequestError("prefix must be a string.");
				if (body.permission !== undefined && body.permission !== "read" && body.permission !== "write") {
					throw new RequestError('permission must be "read" or "write".');
				}
				if (body.ttlSeconds !== undefined && (!Number.isSafeInteger(body.ttlSeconds) || body.ttlSeconds <= 0)) {
					throw new RequestError("ttlSeconds must be a positive integer.");
				}
				if (body.allPrefixes !== undefined && typeof body.allPrefixes !== "boolean") throw new RequestError("allPrefixes must be a boolean.");
				if (body.includeDelete !== undefined && typeof body.includeDelete !== "boolean") throw new RequestError("includeDelete must be a boolean.");
				const bucket = body.bucket ?? "";
				const prefix = body.prefix ?? "";
				const permission: Permission = body.permission === "write" ? "write" : "read";
				const allPrefixes = body.allPrefixes === true;
				const resolved = allPrefixes
					? authorizeBucket(grants, bucket, permission)
					: (() => {
							const decision = authorize(grants, { bucket, path: prefix, permission });
							if (decision === undefined) return undefined;
							return {
								prefixes: decision.prefixes,
								permission,
								allowDelete: decision.grant.allowDelete === true,
								maxTtlSeconds: decision.grant.maxTtlSeconds,
								domainId: decision.grant.domainId,
								roles: [decision.grant.role],
							};
						})();

				if (resolved === undefined) {
					const detail = allPrefixes ? "no grant in this bucket reaches that permission" : "no grant covers this prefix";
					await audit("vend", "denied", detail, { bucket, path: prefix, permission });
					return json({ error: allPrefixes ? `Not entitled to ${permission} anywhere in ${bucket}.` : `Not entitled to ${permission} under that prefix.` }, 403);
				}

				const effectiveGrant: ResolvedGrant = {
					bucket,
					prefixes: resolved.prefixes,
					permission: resolved.permission,
					maxTtlSeconds: resolved.maxTtlSeconds,
					allowDelete: resolved.allowDelete,
					domainId: resolved.domainId,
					role: resolved.roles.join("+"),
				};
				const ttl = clampTtl(body.ttlSeconds, effectiveGrant);
				const actions = actionsFor(permission, resolved.allowDelete && body.includeDelete === true);
				const credentials = await mintCredentials(parentFor(env, resolved.domainId), {
					accountId: env.CF_ACCOUNT_ID,
					bucket,
					ttlSeconds: ttl,
					actions,
					prefixes: resolved.prefixes,
				});
				await audit("vend", "granted", allPrefixes ? "unioned across prefixes" : null, {
					bucket,
					path: allPrefixes ? undefined : prefix,
					permission,
					ttlSeconds: ttl,
					actions,
					grant: effectiveGrant,
					prefixes: resolved.prefixes,
				});

				return json({
					bucket,
					prefixes: resolved.prefixes,
					permission,
					roles: resolved.roles,
					unioned: allPrefixes,
					actions,
					canRead: actions.includes("GetObject"),
					canWrite: actions.includes("PutObject"),
					canDelete: actions.includes("DeleteObject"),
					expiresAt: credentials.expiresAt,
					endpoint: s3Endpoint(env.CF_ACCOUNT_ID),
					credentials: {
						AWS_ACCESS_KEY_ID: credentials.accessKeyId,
						AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
						AWS_SESSION_TOKEN: credentials.sessionToken,
					},
					shell: [
						`export AWS_ACCESS_KEY_ID=${credentials.accessKeyId}`,
						`export AWS_SECRET_ACCESS_KEY=${credentials.secretAccessKey}`,
						`export AWS_SESSION_TOKEN=${credentials.sessionToken}`,
						"export AWS_DEFAULT_REGION=auto",
						`# aws s3 ls s3://${bucket}/${resolved.prefixes[0] ?? ""} --endpoint-url ${s3Endpoint(env.CF_ACCOUNT_ID)}`,
					].join("\n"),
				});
			}

			if (url.pathname === "/api/audit" && request.method === "GET") {
				const scopeToSelf = !isAuditor(policy, identity);
				const columns = "ts, email, action, bucket, path, permission, prefixes, actions, ttl_seconds, domain_id, role, outcome, detail, request_id";
				const statement = scopeToSelf
					? env.AUDIT_DB.prepare(`SELECT ${columns} FROM audit_log WHERE email = ?1 COLLATE NOCASE ORDER BY id DESC LIMIT 100`).bind(identity.email)
					: env.AUDIT_DB.prepare(`SELECT ${columns} FROM audit_log ORDER BY id DESC LIMIT 100`);
				const rows = await statement.all();
				await audit("audit-read", "granted", scopeToSelf ? "own rows only" : "all principals");
				return json({ scope: scopeToSelf ? "self" : "all", rows: rows.results });
			}

			return json({ error: "not found" }, 404);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(JSON.stringify({ message: "request failed", error: message, requestId, path: url.pathname }));
			if (error instanceof ConfigError) {
				return json({ error: `Server misconfigured: ${error.message}.`, requestId }, 503);
			}
			if (error instanceof AuditError) {
				return json({ error: "The audit record could not be stored, so the response was withheld.", requestId }, 503);
			}
			if (error instanceof MintError) return json({ error: `Credential request rejected: ${error.message}`, requestId }, 400);
			if (error instanceof RequestError) return json({ error: error.message, requestId }, 400);
			return json({ error: "An unexpected error occurred.", requestId }, 500);
		}
	},
} satisfies ExportedHandler<Env>;
