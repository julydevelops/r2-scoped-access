import { MAX_TTL_SECONDS, type R2Action, type R2Scope } from "../services/temp-credentials";

/**
 * Deny-by-default policy model.
 *
 * A trust domain owns a set of buckets and exactly one parent token. A child
 * credential cannot exceed its parent on either bucket scope or permission
 * class, so parent scope is a separate containment boundary from app policy.
 *
 * Every bucket must belong to exactly one domain. `validatePolicy` rejects
 * anything else at boot rather than at request time.
 */

export type Permission = "read" | "write";

export interface Grant {
	bucket: string;
	/** Prefixes this principal may reach. Use [""] to grant the whole bucket. */
	prefixes: string[];
	permission: Permission;
	maxTtlSeconds: number;
	/**
	 * Whether a write grant may also destroy objects. Defaults to false.
	 *
	 * This exists because R2's `object-read-write` scope bundles DeleteObject in
	 * with PutObject, so a grant meant to allow uploads was also handing out the
	 * ability to empty the prefix. Delete is the one operation with no undo, so it
	 * is opt-in per grant and the granted action list is recorded in the audit log.
	 */
	allowDelete?: boolean;
}

export interface TrustDomain {
	/** Suffix of the PARENT_<ID>_AKID / PARENT_<ID>_SECRET secret pair. */
	id: string;
	buckets: string[];
}

export interface Assignment {
	/** Matched against the Access identity email, case-insensitive. */
	email?: string;
	/** Matched against Access identity groups exactly. */
	group?: string;
	roles: string[];
}

/**
 * Who may read the audit log for principals other than themselves.
 *
 * The audit log is the compliance artefact this whole app exists to produce, and
 * it necessarily contains other people's emails and other domains' bucket paths.
 * Left open it is the most revealing endpoint in the app, so reading beyond your
 * own rows is an explicit grant. Everyone can always read their own history.
 */
export interface Auditors {
	groups?: string[];
	emails?: string[];
}

export interface Policy {
	version: number;
	domains: TrustDomain[];
	roles: Record<string, Grant[]>;
	assignments: Assignment[];
	auditors?: Auditors;
}

export interface Identity {
	email: string;
	groups: string[];
}

export interface ResolvedGrant extends Grant {
	domainId: string;
	role: string;
}

export class PolicyError extends Error {}

export function validatePolicy(policy: Policy): void {
	if (policy.version !== 1) throw new PolicyError("policy version must be 1");
	if (!Array.isArray(policy.domains) || !Array.isArray(policy.assignments) || typeof policy.roles !== "object" || policy.roles === null || Array.isArray(policy.roles)) {
		throw new PolicyError("policy must define domains, roles, and assignments");
	}

	const seen = new Map<string, string>();
	const domainIds = new Set<string>();
	for (const domain of policy.domains) {
		if (typeof domain !== "object" || domain === null) throw new PolicyError("domains must contain objects");
		if (typeof domain.id !== "string" || !/^[A-Za-z0-9_]+$/.test(domain.id)) {
			throw new PolicyError(`domain id "${domain.id}" must match [A-Za-z0-9_]+`);
		}
		if (domainIds.has(domain.id)) throw new PolicyError(`domain id "${domain.id}" is duplicated`);
		domainIds.add(domain.id);
		if (!Array.isArray(domain.buckets) || domain.buckets.length === 0) {
			throw new PolicyError(`domain "${domain.id}" must contain at least one bucket`);
		}
		for (const bucket of domain.buckets) {
			if (typeof bucket !== "string" || bucket === "") throw new PolicyError(`domain "${domain.id}" contains an invalid bucket name`);
			const existing = seen.get(bucket);
			if (existing !== undefined) {
				throw new PolicyError(
					`bucket "${bucket}" is claimed by domains "${existing}" and "${domain.id}"; containment requires exactly one`,
				);
			}
			seen.set(bucket, domain.id);
		}
	}

	for (const [role, grants] of Object.entries(policy.roles)) {
		if (role === "") throw new PolicyError("role names cannot be empty");
		if (!Array.isArray(grants) || grants.length === 0) throw new PolicyError(`role "${role}" must contain at least one grant`);
		for (const grant of grants) {
			if (typeof grant !== "object" || grant === null) throw new PolicyError(`role "${role}" must contain grant objects`);
			if (typeof grant.bucket !== "string" || grant.bucket === "") {
				throw new PolicyError(`role "${role}" contains an invalid bucket name`);
			}
			if (grant.permission !== "read" && grant.permission !== "write") {
				throw new PolicyError(`role "${role}" grant on "${grant.bucket}" has invalid permission`);
			}
			if (!Array.isArray(grant.prefixes) || grant.prefixes.some((prefix) => typeof prefix !== "string" || normalisePath(prefix) === undefined)) {
				throw new PolicyError(`role "${role}" grant on "${grant.bucket}" contains an invalid prefix`);
			}
			if (!seen.has(grant.bucket)) {
				throw new PolicyError(
					`role "${role}" grants bucket "${grant.bucket}", which no domain owns`,
				);
			}
			if (grant.prefixes.length === 0) {
				throw new PolicyError(
					`role "${role}" grant on "${grant.bucket}" has no prefixes; use [""] to mean the whole bucket`,
				);
			}
			if (!Number.isInteger(grant.maxTtlSeconds) || grant.maxTtlSeconds <= 0 || grant.maxTtlSeconds > MAX_TTL_SECONDS) {
				throw new PolicyError(`role "${role}" grant on "${grant.bucket}" must have an integer maxTtlSeconds between 1 and ${MAX_TTL_SECONDS}`);
			}
			// A read grant with allowDelete would silently do nothing, which is worse
			// than refusing to boot: it reads as though delete were permitted.
			if (grant.allowDelete === true && grant.permission !== "write") {
				throw new PolicyError(
					`role "${role}" grant on "${grant.bucket}" sets allowDelete on a ${grant.permission} grant; delete requires permission "write"`,
				);
			}
			if (grant.allowDelete !== undefined && typeof grant.allowDelete !== "boolean") {
				throw new PolicyError(`role "${role}" grant on "${grant.bucket}" has invalid allowDelete`);
			}
		}
	}

	for (const assignment of policy.assignments) {
		if (typeof assignment !== "object" || assignment === null) throw new PolicyError("assignments must contain objects");
		if ((assignment.email === undefined) === (assignment.group === undefined)) {
			throw new PolicyError("each assignment must set exactly one of `email` or `group`");
		}
		if (assignment.email !== undefined && (typeof assignment.email !== "string" || assignment.email === "")) {
			throw new PolicyError("assignment email must be a non-empty string");
		}
		if (assignment.group !== undefined && (typeof assignment.group !== "string" || assignment.group === "")) {
			throw new PolicyError("assignment group must be a non-empty string");
		}
		if (!Array.isArray(assignment.roles) || assignment.roles.length === 0) {
			throw new PolicyError("each assignment must reference at least one role");
		}
		for (const role of assignment.roles) {
			if (typeof role !== "string" || role === "" || policy.roles[role] === undefined) {
				throw new PolicyError(`assignment references unknown role "${role}"`);
			}
		}
	}

	const auditors = policy.auditors;
	if (auditors !== undefined) {
		if (typeof auditors !== "object" || auditors === null || Array.isArray(auditors)) {
			throw new PolicyError("auditors must be an object");
		}
		const groups = auditors.groups ?? [];
		const emails = auditors.emails ?? [];
		if (!Array.isArray(groups) || !groups.every((group) => typeof group === "string" && group !== "")) {
			throw new PolicyError("auditor groups must be non-empty strings");
		}
		if (!Array.isArray(emails) || !emails.every((email) => typeof email === "string" && email !== "")) {
			throw new PolicyError("auditor emails must be non-empty strings");
		}
		if (groups.length === 0 && emails.length === 0) {
			throw new PolicyError(
				"`auditors` is present but names nobody; remove it entirely to restrict everyone to their own rows",
			);
		}
	}
}

/**
 * Whether this identity may read audit rows belonging to other principals.
 * Deny by default, exactly like grants.
 */
export function isAuditor(policy: Policy, identity: Identity): boolean {
	const auditors = policy.auditors;
	if (auditors === undefined) return false;

	const email = identity.email.toLowerCase();
	if ((auditors.emails ?? []).some((e) => e.toLowerCase() === email)) return true;

	const groups = new Set(identity.groups);
	return (auditors.groups ?? []).some((group) => groups.has(group));
}

export function domainForBucket(policy: Policy, bucket: string): string | undefined {
	return policy.domains.find((d) => d.buckets.includes(bucket))?.id;
}

/** Every grant this identity holds. Deny by default: no match means no grants. */
export function resolveGrants(policy: Policy, identity: Identity): ResolvedGrant[] {
	const email = identity.email.toLowerCase();
	const groups = new Set(identity.groups);

	const roles = new Set<string>();
	for (const assignment of policy.assignments) {
		if (assignment.email !== undefined && assignment.email.toLowerCase() === email) {
			for (const role of assignment.roles) roles.add(role);
		}
		if (assignment.group !== undefined && groups.has(assignment.group)) {
			for (const role of assignment.roles) roles.add(role);
		}
	}

	const resolved: ResolvedGrant[] = [];
	for (const role of roles) {
		for (const grant of policy.roles[role] ?? []) {
			const domainId = domainForBucket(policy, grant.bucket);
			if (domainId === undefined) continue;
			resolved.push({ ...grant, domainId, role });
		}
	}
	return resolved;
}

export interface AccessRequest {
	bucket: string;
	/** Object key, or the prefix being listed. */
	path: string;
	permission: Permission;
}

export interface Authorization {
	grant: ResolvedGrant;
	/** The prefixes to put on the minted credential. Narrowed to what was asked for. */
	prefixes: string[];
}

/**
 * Returns the grant authorising this request, or undefined.
 *
 * A write request is not satisfied by a read grant. A path is authorised only if
 * it sits under one of the grant's prefixes. Prefix matching is literal, and
 * traversal-like paths are rejected before authorization.
 */
export function authorize(
	grants: readonly ResolvedGrant[],
	request: AccessRequest,
): Authorization | undefined {
	const normalised = normalisePath(request.path);
	if (normalised === undefined) return undefined;

	for (const grant of grants) {
		if (grant.bucket !== request.bucket) continue;
		if (request.permission === "write" && grant.permission !== "write") continue;

		const matching = grant.prefixes.filter((prefix) => normalised.startsWith(prefix));
		if (matching.length === 0) continue;

		return { grant, prefixes: [normalised] };
	}
	return undefined;
}

/**
 * The strongest permission this identity holds over `path`, or undefined.
 *
 * The UI uses this to cap its permission selector. Offering a level the policy
 * will refuse produces a guaranteed 403, and offering read when write is
 * available makes people under-privilege themselves and vend twice. Write
 * subsumes read, so there is never a reason to prefer read for the same prefix
 * other than deliberate caution.
 */
export function maxPermissionFor(
	grants: readonly ResolvedGrant[],
	bucket: string,
	path: string,
): Permission | undefined {
	if (authorize(grants, { bucket, path, permission: "write" }) !== undefined) return "write";
	if (authorize(grants, { bucket, path, permission: "read" }) !== undefined) return "read";
	return undefined;
}

export interface BucketAuthorization {
	prefixes: string[];
	permission: Permission;
	allowDelete: boolean;
	maxTtlSeconds: number;
	domainId: string;
	roles: string[];
}

/**
 * Every prefix in one bucket that this identity holds at `permission` or above,
 * collapsed into a single credential.
 *
 * This exists so that holding three read prefixes does not mean vending three
 * credentials. It is opt-in, because it is strictly wider than the prefix you
 * are looking at.
 *
 * Two conservative rules, both forced by the fact that an R2 credential applies
 * one action list across all of its paths:
 *
 * - `allowDelete` only if *every* contributing grant allows it. Otherwise a
 *   credential unioning a deletable prefix with a non-deletable one would carry
 *   delete into the latter.
 * - `maxTtlSeconds` is the *minimum* across contributing grants, so unioning can
 *   never extend the life a stricter grant intended.
 */
export function authorizeBucket(
	grants: readonly ResolvedGrant[],
	bucket: string,
	permission: Permission,
): BucketAuthorization | undefined {
	const contributing = grants.filter(
		(g) => g.bucket === bucket && (permission === "read" || g.permission === "write"),
	);
	if (contributing.length === 0) return undefined;

	const prefixes = [...new Set(contributing.flatMap((g) => g.prefixes))].sort();
	// A grant on the whole bucket makes every narrower prefix redundant.
	const collapsed = prefixes.includes("") ? [""] : prefixes;

	return {
		prefixes: collapsed,
		permission,
		allowDelete: permission === "write" && contributing.every((g) => g.allowDelete === true),
		maxTtlSeconds: Math.min(...contributing.map((g) => g.maxTtlSeconds)),
		domainId: contributing[0]!.domainId,
		roles: [...new Set(contributing.map((g) => g.role))].sort(),
	};
}

/**
 * Rejects traversal and control characters before anything is signed. R2 denies
 * these too, but a request that never reaches R2 cannot be mis-signed, and this
 * keeps traversal attempts out of the audit log as authorised events.
 */
export function normalisePath(path: string): string | undefined {
	if (path.includes("..")) return undefined;
	if (path.startsWith("/")) return undefined;
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f]/.test(path)) return undefined;
	let decoded: string;
	try {
		decoded = decodeURIComponent(path);
	} catch {
		return undefined;
	}
	if (decoded.includes("..")) return undefined;
	return path;
}

/**
 * Retained for the coarse scope names, but no longer used to mint. R2's
 * `object-read-write` bundles DeleteObject with PutObject, which made every write
 * grant a delete grant. `actionsFor` is the enforcement path; this is kept only
 * so the two vocabularies can still be compared in tests and logs.
 */
export function scopeFor(permission: Permission): R2Scope {
	return permission === "write" ? "object-read-write" : "object-read-only";
}

/** Everything needed to browse and download, and nothing that mutates. */
export const READ_ACTIONS: readonly R2Action[] = [
	"HeadObject",
	"GetObject",
	"GetBucketLocation",
	"ListObjectsV1",
	"ListObjectsV2",
	"ListMultipartUploads",
	"ListParts",
];

/** Read, plus creating and overwriting objects. Deliberately excludes delete. */
export const WRITE_ACTIONS: readonly R2Action[] = [
	...READ_ACTIONS,
	"PutObject",
	"CopyObject",
	"CreateMultipartUpload",
	"UploadPart",
	"UploadPartCopy",
	"AbortMultipartUpload",
	"CompleteMultipartUpload",
];

export const DELETE_ACTIONS: readonly R2Action[] = ["DeleteObject", "DeleteObjects"];

/**
 * The exact action list to put on a minted credential.
 *
 * Per-action scoping requires local JWT signing, which is what this app does
 * anyway. Using it instead of `scope` is what keeps a write grant from also
 * being a delete grant.
 */
export function actionsFor(permission: Permission, allowDelete = false): readonly R2Action[] {
	if (permission !== "write") return READ_ACTIONS;
	return allowDelete ? [...WRITE_ACTIONS, ...DELETE_ACTIONS] : WRITE_ACTIONS;
}

export function clampTtl(requested: number | undefined, grant: Grant): number {
	const fallback = Math.min(900, grant.maxTtlSeconds);
	if (requested === undefined || !Number.isFinite(requested) || requested <= 0) return fallback;
	return Math.min(Math.floor(requested), grant.maxTtlSeconds);
}
