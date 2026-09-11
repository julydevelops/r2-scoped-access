import type { Entitlement, Permission } from "../../shared/api-types";

/**
 * Computes the prefixes that will be included in a credential request.
 * When `allPrefixes` is true, unions all eligible prefixes in the bucket.
 */
export function credentialScopePrefixes(
	entitlements: readonly Entitlement[],
	bucket: string,
	prefix: string,
	permission: Permission,
	allPrefixes: boolean,
): string[] {
	if (!allPrefixes) return [prefix];
	const prefixes = [
		...new Set(
			entitlements
				.filter((grant) => grant.bucket === bucket && (permission === "read" || grant.permission === "write"))
				.flatMap((grant) => grant.prefixes),
		),
	];
	return prefixes.includes("") ? [""] : prefixes;
}

/**
 * Computes the maximum TTL available for a credential request.
 * When `allPrefixes` is true, returns the minimum across all contributing grants.
 */
export function credentialMaxTtl(
	entitlements: readonly Entitlement[],
	bucket: string,
	prefix: string,
	permission: Permission,
	allPrefixes: boolean,
): number | undefined {
	const contributors = entitlements.filter(
		(grant) =>
			grant.bucket === bucket &&
			(permission === "read" || grant.permission === "write") &&
			(allPrefixes || grant.prefixes.some((grantPrefix) => prefix.startsWith(grantPrefix))),
	);
	if (contributors.length === 0) return undefined;
	return allPrefixes
		? Math.min(...contributors.map((grant) => grant.maxTtlSeconds))
		: contributors[0]?.maxTtlSeconds;
}

/**
 * Determines if delete capability is available for a credential request.
 * When `allPrefixes` is true, all contributing write grants must allow delete.
 */
export function credentialDeleteAvailable(
	entitlements: readonly Entitlement[],
	bucket: string,
	prefix: string,
	permission: Permission,
	allPrefixes: boolean,
): boolean {
	if (permission !== "write") return false;
	const writeGrants = entitlements.filter((grant) => grant.bucket === bucket && grant.permission === "write");
	return allPrefixes
		? writeGrants.length > 0 && writeGrants.every((grant) => grant.allowDelete)
		: writeGrants.some(
				(grant) => grant.allowDelete && grant.prefixes.some((grantPrefix) => prefix.startsWith(grantPrefix)),
			);
}
