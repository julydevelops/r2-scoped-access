import { useEffect, useState } from "react";
import { ErrorNotice, PageHeader, Sidebar } from "./components";
import { useAudit, useCredential, useFileBrowser, useIdentity, useIdentityDetails } from "./hooks";
import type { View } from "./types";
import { ActivityView, CredentialsView, FilesView, IdentityView } from "./views";

export function App(): React.JSX.Element {
	const [view, setView] = useState<View>("files");

	// Core identity and entitlements
	const { me, roots, error: bootError, loading: bootLoading } = useIdentity();

	// File browser state
	const initialRoot = roots[0] ?? null;
	const fileBrowser = useFileBrowser(initialRoot);

	// Credential form state
	const credential = useCredential({
		entitlements: me?.entitlements ?? [],
		bucket: fileBrowser.selected?.entitlement.bucket ?? "",
		prefix: fileBrowser.prefix,
		maxPermission: fileBrowser.listing?.maxPermission,
	});

	// Audit log (only fetches when view is active)
	const audit = useAudit(view === "activity");

	// Identity details for troubleshooting (only fetches when view is active)
	const identityDetails = useIdentityDetails(view === "identity");

	// Clear credential when navigating away from credentials view
	useEffect(() => {
		if (view !== "credentials") {
			credential.clearCredential();
		}
	}, [view]);

	// Reset credential form when selection changes
	useEffect(() => {
		credential.resetForm();
	}, [fileBrowser.selected, fileBrowser.prefix]);

	// Handle root selection with credential reset
	function handleSelectRoot(root: typeof initialRoot): void {
		if (root === null) return;
		fileBrowser.selectRoot(root);
	}

	// Handle browse with credential reset
	function handleBrowse(nextPrefix: string): void {
		fileBrowser.browse(nextPrefix);
	}

	// Boot error state
	if (bootError !== null) {
		return (
			<main className="mx-auto flex min-h-screen max-w-xl items-center px-6">
				<ErrorNotice error={bootError} />
			</main>
		);
	}

	// Loading state
	if (bootLoading || me === null) {
		return (
			<main className="grid min-h-screen place-items-center text-sm uppercase tracking-[0.22em] text-slate-400">
				Establishing secure session
			</main>
		);
	}

	return (
		<div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
			<Sidebar
				email={me.email}
				grantCount={me.entitlements.length}
				currentView={view}
				onViewChange={setView}
			/>

			<main className="min-w-0 px-5 py-8 sm:px-8 lg:px-12 lg:py-11 xl:px-16">
				<PageHeader view={view} />

				{view === "files" && (
					<FilesView
						roots={roots}
						selected={fileBrowser.selected}
						prefix={fileBrowser.prefix}
						listing={fileBrowser.listing}
						listingError={fileBrowser.listingError}
						loading={fileBrowser.loading}
						onSelectRoot={handleSelectRoot}
						onBrowse={handleBrowse}
						onLoadMore={fileBrowser.loadMore}
						onRefresh={fileBrowser.refresh}
						onNavigate={setView}
					/>
				)}

				{view === "credentials" && (
					<CredentialsView
						selected={fileBrowser.selected}
						prefix={fileBrowser.prefix}
						entitlements={me.entitlements}
						permission={credential.permission}
						setPermission={credential.setPermission}
						ttl={credential.ttl}
						setTtl={credential.setTtl}
						allPrefixes={credential.allPrefixes}
						setAllPrefixes={credential.setAllPrefixes}
						includeDelete={credential.includeDelete}
						setIncludeDelete={credential.setIncludeDelete}
						reviewing={credential.reviewing}
						setReviewing={credential.setReviewing}
						issuing={credential.issuing}
						credential={credential.credential}
						credentialError={credential.credentialError}
						remaining={credential.remaining}
						writeAvailable={credential.writeAvailable}
						deleteAvailable={credential.deleteAvailable}
						scopePrefixes={credential.scopePrefixes}
						previewMaxTtl={credential.previewMaxTtl}
						effectiveTtl={credential.effectiveTtl}
						onIssue={credential.issueCredential}
						onClear={credential.clearCredential}
					/>
				)}

				{view === "activity" && (
					<ActivityView
						activity={audit.activity}
						error={audit.error}
						loading={audit.loading}
						onRefresh={audit.refresh}
					/>
				)}

				{view === "identity" && (
					<IdentityView
						identity={identityDetails.identity}
						error={identityDetails.error}
						loading={identityDetails.loading}
					/>
				)}
			</main>
		</div>
	);
}

// Re-export utilities that tests depend on
export { credentialScopePrefixes, credentialMaxTtl, credentialDeleteAvailable } from "./utils";
