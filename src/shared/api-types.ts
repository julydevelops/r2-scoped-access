export type Permission = "read" | "write";

export interface Entitlement {
	bucket: string;
	prefixes: string[];
	permission: Permission;
	allowDelete: boolean;
	maxTtlSeconds: number;
	domain: string;
	role: string;
}

export interface MeResponse {
	email: string;
	groups: string[];
	isAuditor: boolean;
	entitlements: Entitlement[];
}

export interface ListEntry {
	key: string;
	size: number;
	lastModified: string;
}

export interface ObjectsResponse {
	prefix: string;
	folders: string[];
	objects: ListEntry[];
	truncated: boolean;
	continuationToken?: string;
	maxPermission: Permission;
}

export interface CredentialResponse {
	bucket: string;
	prefixes: string[];
	permission: Permission;
	roles: string[];
	unioned: boolean;
	actions: string[];
	canRead: boolean;
	canWrite: boolean;
	canDelete: boolean;
	expiresAt: string;
	endpoint: string;
	credentials: {
		AWS_ACCESS_KEY_ID: string;
		AWS_SECRET_ACCESS_KEY: string;
		AWS_SESSION_TOKEN: string;
	};
	shell: string;
}

export interface AuditRow {
	ts: string;
	email: string;
	action: string;
	bucket: string | null;
	path: string | null;
	permission: Permission | null;
	prefixes: string | null;
	actions: string | null;
	ttl_seconds: number | null;
	domain_id: string | null;
	role: string | null;
	outcome: "granted" | "denied" | "error";
	detail: string | null;
	request_id: string;
}

export interface AuditResponse {
	scope: "self" | "all";
	rows: AuditRow[];
}

export type IdentityResponse = MeResponse;

export interface ErrorResponse {
	error: string;
	kind?: "revoked" | "forbidden" | "notFound" | "other";
	requestId?: string;
}
