import { useEffect, useState } from "react";
import type { IdentityResponse } from "../../shared/api-types";
import { api, errorMessage } from "../api";

interface UseIdentityDetailsResult {
	identity: IdentityResponse | null;
	error: string | null;
	loading: boolean;
}

/**
 * Fetches detailed identity information from /api/identity for troubleshooting.
 * Only fetches when `enabled` is true (i.e., when the identity view is active).
 */
export function useIdentityDetails(enabled: boolean): UseIdentityDetailsResult {
	const [identity, setIdentity] = useState<IdentityResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!enabled || identity !== null) return;

		setLoading(true);
		setError(null);

		const controller = new AbortController();
		api<IdentityResponse>("/api/identity", { signal: controller.signal })
			.then((response) => {
				setIdentity(response);
			})
			.catch((err: unknown) => {
				if (!controller.signal.aborted) {
					setError(errorMessage(err));
				}
			})
			.finally(() => {
				if (!controller.signal.aborted) {
					setLoading(false);
				}
			});

		return () => controller.abort();
	}, [enabled, identity]);

	return { identity, error, loading };
}
