import { startTransition, useEffect, useState } from "react";
import type { ObjectsResponse } from "../../shared/api-types";
import { api, errorMessage } from "../api";
import type { RootAccess } from "../types";

interface UseFileBrowserResult {
	selected: RootAccess | null;
	prefix: string;
	listing: ObjectsResponse | null;
	listingError: string | null;
	loading: boolean;
	selectRoot: (root: RootAccess) => void;
	browse: (nextPrefix: string) => void;
	loadMore: () => Promise<void>;
	refresh: () => void;
}

/**
 * Manages file browser state: selected root, current prefix, and object listing.
 * Handles fetching, pagination, and navigation.
 */
export function useFileBrowser(initialRoot: RootAccess | null): UseFileBrowserResult {
	const [selected, setSelected] = useState<RootAccess | null>(initialRoot);
	const [prefix, setPrefix] = useState(initialRoot?.rootPrefix ?? "");
	const [listing, setListing] = useState<ObjectsResponse | null>(null);
	const [listingError, setListingError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [refreshCounter, setRefreshCounter] = useState(0);

	// Sync with initialRoot when it changes (e.g., after identity loads)
	useEffect(() => {
		if (initialRoot !== null && selected === null) {
			setSelected(initialRoot);
			setPrefix(initialRoot.rootPrefix);
		}
	}, [initialRoot, selected]);

	// Fetch listing when selection, prefix, or refresh changes
	useEffect(() => {
		if (selected === null) return;

		const controller = new AbortController();
		setLoading(true);
		setListingError(null);

		const query = new URLSearchParams({ bucket: selected.entitlement.bucket, prefix });
		api<ObjectsResponse>(`/api/objects?${query}`, { signal: controller.signal })
			.then((response) => {
				setListing(response);
			})
			.catch((err: unknown) => {
				if (!controller.signal.aborted) {
					setListingError(errorMessage(err));
				}
			})
			.finally(() => {
				if (!controller.signal.aborted) {
					setLoading(false);
				}
			});

		return () => controller.abort();
	}, [selected, prefix, refreshCounter]);

	function selectRoot(root: RootAccess): void {
		startTransition(() => {
			setSelected(root);
			setPrefix(root.rootPrefix);
			setListing(null);
		});
	}

	function browse(nextPrefix: string): void {
		startTransition(() => {
			setPrefix(nextPrefix);
			setListing(null);
		});
	}

	async function loadMore(): Promise<void> {
		if (selected === null || listing?.continuationToken === undefined) return;

		setLoading(true);
		try {
			const query = new URLSearchParams({
				bucket: selected.entitlement.bucket,
				prefix,
				cursor: listing.continuationToken,
			});
			const next = await api<ObjectsResponse>(`/api/objects?${query}`);
			setListing({
				...next,
				folders: [...new Set([...listing.folders, ...next.folders])],
				objects: [...listing.objects, ...next.objects],
			});
		} catch (err) {
			setListingError(errorMessage(err));
		} finally {
			setLoading(false);
		}
	}

	function refresh(): void {
		setRefreshCounter((c) => c + 1);
	}

	return {
		selected,
		prefix,
		listing,
		listingError,
		loading,
		selectRoot,
		browse,
		loadMore,
		refresh,
	};
}
