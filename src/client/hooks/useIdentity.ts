import { useEffect, useState } from "react";
import type { MeResponse } from "../../shared/api-types";
import { api, errorMessage } from "../api";
import type { RootAccess } from "../types";

interface UseIdentityResult {
	me: MeResponse | null;
	roots: RootAccess[];
	error: string | null;
	loading: boolean;
}

/**
 * Fetches the current user's identity and entitlements from /api/me.
 * Derives `roots` (flattened entitlement + prefix pairs) for easy iteration.
 */
export function useIdentity(): UseIdentityResult {
	const [me, setMe] = useState<MeResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const controller = new AbortController();
		api<MeResponse>("/api/me", { signal: controller.signal })
			.then((response) => {
				setMe(response);
				setLoading(false);
			})
			.catch((err: unknown) => {
				if (!controller.signal.aborted) {
					setError(errorMessage(err));
					setLoading(false);
				}
			});
		return () => controller.abort();
	}, []);

	const roots: RootAccess[] = (me?.entitlements ?? []).flatMap((entitlement, entitlementIndex) =>
		entitlement.prefixes.map((rootPrefix, prefixIndex) => ({
			id: `${entitlementIndex}:${prefixIndex}`,
			entitlement,
			rootPrefix,
		})),
	);

	return { me, roots, error, loading };
}
