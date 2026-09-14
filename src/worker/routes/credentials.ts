import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { CredentialResponse } from "../../shared/api-types";
import { mintForBucket, mintForPath, type ScopedResult } from "../broker/scoped-credential";
import { firstIssue, jsonBodyLimit, requireJsonBody } from "../http/validation";
import { s3Endpoint, type TempCredentials } from "../services/temp-credentials";
import type { AppEnv } from "../types";
import { credentialRequestSchema } from "./schemas";

/**
 * Issues a temporary S3 credential for direct CLI and SDK use.
 *
 * This is the one route whose response the caller keeps, so it is also the only
 * route where the requested TTL and the delete flag matter. Both are ceilings
 * the policy imposes, never floors the caller can raise: `clampTtl` only
 * narrows, and `includeDelete` is honoured solely where the grant already
 * permits it.
 */
export const credentialRoutes = new Hono<AppEnv>().post(
	"/credentials",
	jsonBodyLimit,
	requireJsonBody,
	zValidator("json", credentialRequestSchema, firstIssue),
	async (c) => {
		const { bucket, prefix, permission, ttlSeconds, allPrefixes, includeDelete } = c.req.valid("json");

		const scoped: ScopedResult = allPrefixes
			? await mintForBucket(c, {
					action: "vend",
					bucket,
					permission,
					ttlSeconds,
					includeDelete,
					denyDetail: "no grant in this bucket reaches that permission",
					denyMessage: `Not entitled to ${permission} anywhere in ${bucket}.`,
				})
			: await mintForPath(c, {
					action: "vend",
					bucket,
					path: prefix,
					permission,
					ttlSeconds,
					includeDelete,
					denyDetail: "no grant covers this prefix",
					denyMessage: `Not entitled to ${permission} under that prefix.`,
				});
		if (!scoped.ok) return scoped.response;

		await scoped.granted(allPrefixes ? "unioned across prefixes" : null);

		const endpoint = s3Endpoint(c.env.CF_ACCOUNT_ID);
		return c.json({
			bucket,
			prefixes: scoped.prefixes,
			permission,
			roles: scoped.roles,
			unioned: allPrefixes,
			actions: [...scoped.actions],
			// Derived from the action list rather than from the requested
			// permission, so the UI can only advertise what was actually signed.
			canRead: scoped.actions.includes("GetObject"),
			canWrite: scoped.actions.includes("PutObject"),
			canDelete: scoped.actions.includes("DeleteObject"),
			expiresAt: scoped.credentials.expiresAt,
			endpoint,
			credentials: {
				AWS_ACCESS_KEY_ID: scoped.credentials.accessKeyId,
				AWS_SECRET_ACCESS_KEY: scoped.credentials.secretAccessKey,
				AWS_SESSION_TOKEN: scoped.credentials.sessionToken,
			},
			shell: shellSnippet({
				credentials: scoped.credentials,
				endpoint,
				bucket,
				prefix: scoped.prefixes[0] ?? "",
			}),
		} satisfies CredentialResponse);
	},
);

interface ShellSnippet {
	credentials: TempCredentials;
	endpoint: string;
	bucket: string;
	prefix: string;
}

/**
 * A paste-ready environment block.
 *
 * The example command is left commented out deliberately: pasting this should
 * configure a shell, not perform an R2 operation the user did not ask for.
 */
function shellSnippet({ credentials, endpoint, bucket, prefix }: ShellSnippet): string {
	return [
		`export AWS_ACCESS_KEY_ID=${credentials.accessKeyId}`,
		`export AWS_SECRET_ACCESS_KEY=${credentials.secretAccessKey}`,
		`export AWS_SESSION_TOKEN=${credentials.sessionToken}`,
		"export AWS_DEFAULT_REGION=auto",
		`# aws s3 ls s3://${bucket}/${prefix} --endpoint-url ${endpoint}`,
	].join("\n");
}
