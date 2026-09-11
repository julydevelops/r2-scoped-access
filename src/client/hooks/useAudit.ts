import { useCallback, useEffect, useState } from "react";
import type { AuditResponse } from "../../shared/api-types";
import { api, errorMessage } from "../api";

interface UseAuditResult {
	activity: AuditResponse | null;
	error: string | null;
	loading: boolean;
	refresh: () => void;
}

/**
 * Fetches audit log from /api/audit.
 * Only fetches when `enabled` is true (i.e., when the activity view is active).
 */
export function useAudit(enabled: boolean): UseAuditResult {
	const [activity, setActivity] = useState<AuditResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [refreshCounter, setRefreshCounter] = useState(0);

	useEffect(() => {
		if (!enabled) return;

		setLoading(true);
		setError(null);

		const controller = new AbortController();
		api<AuditResponse>("/api/audit", { signal: controller.signal })
			.then((response) => {
				setActivity(response);
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
	}, [enabled, refreshCounter]);

	const refresh = useCallback(() => {
		setActivity(null);
		setRefreshCounter((c) => c + 1);
	}, []);

	return { activity, error, loading, refresh };
}
