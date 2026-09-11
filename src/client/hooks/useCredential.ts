import { useEffect, useState } from "react";
import type { CredentialResponse, Entitlement, Permission } from "../../shared/api-types";
import { api, errorMessage } from "../api";
import { credentialDeleteAvailable, credentialMaxTtl, credentialScopePrefixes } from "../utils";

interface UseCredentialOptions {
	entitlements: readonly Entitlement[];
	bucket: string;
	prefix: string;
	maxPermission: Permission | undefined;
}

interface UseCredentialResult {
	// Form state
	permission: Permission;
	setPermission: (p: Permission) => void;
	ttl: number;
	setTtl: (t: number) => void;
	allPrefixes: boolean;
	setAllPrefixes: (v: boolean) => void;
	includeDelete: boolean;
	setIncludeDelete: (v: boolean) => void;

	// Review/issue state
	reviewing: boolean;
	setReviewing: (v: boolean) => void;
	issuing: boolean;
	credential: CredentialResponse | null;
	credentialError: string | null;
	remaining: number;

	// Computed
	writeAvailable: boolean;
	deleteAvailable: boolean;
	scopePrefixes: string[];
	previewMaxTtl: number;
	effectiveTtl: number;

	// Actions
	issueCredential: () => Promise<void>;
	clearCredential: () => void;
	resetForm: () => void;
}

/**
 * Manages credential request form state, issuance, and active credential countdown.
 */
export function useCredential({ entitlements, bucket, prefix, maxPermission }: UseCredentialOptions): UseCredentialResult {
	const [permission, setPermission] = useState<Permission>("read");
	const [ttl, setTtl] = useState(900);
	const [allPrefixes, setAllPrefixes] = useState(false);
	const [includeDelete, setIncludeDelete] = useState(false);
	const [reviewing, setReviewing] = useState(false);
	const [issuing, setIssuing] = useState(false);
	const [credential, setCredential] = useState<CredentialResponse | null>(null);
	const [credentialError, setCredentialError] = useState<string | null>(null);
	const [remaining, setRemaining] = useState(0);

	// Computed values
	const writeAvailable = maxPermission === "write";
	const deleteAvailable = credentialDeleteAvailable(entitlements, bucket, prefix, permission, allPrefixes);
	const scopePrefixes = credentialScopePrefixes(entitlements, bucket, prefix, permission, allPrefixes);
	const previewMaxTtl = credentialMaxTtl(entitlements, bucket, prefix, permission, allPrefixes) ?? ttl;
	const effectiveTtl = Math.min(ttl, previewMaxTtl);

	// Countdown timer for active credential
	useEffect(() => {
		if (credential === null) return;

		const update = () => {
			const seconds = Math.max(0, Math.ceil((Date.parse(credential.expiresAt) - Date.now()) / 1000));
			setRemaining(seconds);
			if (seconds === 0) setCredential(null);
		};
		update();
		const timer = window.setInterval(update, 1000);
		return () => window.clearInterval(timer);
	}, [credential]);

	async function issueCredential(): Promise<void> {
		if (bucket === "") return;

		setIssuing(true);
		setCredentialError(null);

		try {
			const result = await api<CredentialResponse>("/api/credentials", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					bucket,
					prefix,
					permission,
					ttlSeconds: ttl,
					allPrefixes,
					includeDelete,
				}),
			});
			setCredential(result);
			setReviewing(false);
		} catch (err) {
			setCredentialError(errorMessage(err));
		} finally {
			setIssuing(false);
		}
	}

	function clearCredential(): void {
		setCredential(null);
	}

	function resetForm(): void {
		setReviewing(false);
		setCredential(null);
		setAllPrefixes(false);
		setIncludeDelete(false);
	}

	return {
		permission,
		setPermission,
		ttl,
		setTtl,
		allPrefixes,
		setAllPrefixes,
		includeDelete,
		setIncludeDelete,
		reviewing,
		setReviewing,
		issuing,
		credential,
		credentialError,
		remaining,
		writeAvailable,
		deleteAvailable,
		scopePrefixes,
		previewMaxTtl,
		effectiveTtl,
		issueCredential,
		clearCredential,
		resetForm,
	};
}
