import type { ParentToken } from "../services/temp-credentials";

/**
 * Parent R2 token lookup.
 *
 * Each trust domain in `policy.json` owns exactly one parent token, supplied as
 * the secret pair `PARENT_<ID>_AKID` / `PARENT_<ID>_SECRET`. The domain id is
 * validated at boot against `[A-Za-z0-9_]+` by `validatePolicy`, so the binding
 * name is derived rather than enumerated.
 */

/** A deployment problem, not a caller problem. Surfaces as 503, never 4xx. */
export class ConfigError extends Error {}

export function parentFor(env: Env, domainId: string): ParentToken {
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
