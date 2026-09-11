export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function formatCapability(actionsJson: string | null): string {
	if (actionsJson === null) return "-";
	try {
		const actions = JSON.parse(actionsJson) as unknown;
		if (!Array.isArray(actions)) return "-";
		const capabilities = [
			actions.includes("GetObject") ? "read" : null,
			actions.includes("PutObject") ? "write" : null,
			actions.includes("DeleteObject") ? "delete" : null,
		].filter((value): value is string => value !== null);
		return capabilities.join(" + ") || "-";
	} catch {
		return "-";
	}
}
