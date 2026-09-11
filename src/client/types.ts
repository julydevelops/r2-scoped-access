import type { Entitlement } from "../shared/api-types";

export type View = "files" | "credentials" | "activity" | "identity";

export interface RootAccess {
	id: string;
	entitlement: Entitlement;
	rootPrefix: string;
}

export const navItems: Array<{ id: View; label: string; eyebrow: string }> = [
	{ id: "files", label: "Files", eyebrow: "Browse" },
	{ id: "credentials", label: "Credentials", eyebrow: "Temporary access" },
	{ id: "activity", label: "Activity", eyebrow: "Audit trail" },
	{ id: "identity", label: "Identity", eyebrow: "Troubleshoot" },
];
