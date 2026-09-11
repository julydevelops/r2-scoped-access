import type { CredentialResponse, Entitlement, Permission } from "../../../shared/api-types";
import type { RootAccess } from "../../types";
import { CredentialActive } from "./CredentialActive";
import { CredentialForm } from "./CredentialForm";
import { CredentialReview } from "./CredentialReview";

interface CredentialsViewProps {
	selected: RootAccess | null;
	prefix: string;
	entitlements: readonly Entitlement[];

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
	onIssue: () => Promise<void>;
	onClear: () => void;
}

export function CredentialsView({
	selected,
	prefix,
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
	onIssue,
	onClear,
}: CredentialsViewProps): React.JSX.Element {
	const bucket = selected?.entitlement.bucket ?? "";

	return (
		<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
			<section className="panel p-5 sm:p-7">
				{selected === null ? (
					<p className="text-sm text-slate-500">Select a file scope first.</p>
				) : (
					<CredentialForm
						bucket={bucket}
						prefix={prefix}
						permission={permission}
						setPermission={(p) => {
							setPermission(p);
							setReviewing(false);
						}}
						ttl={ttl}
						setTtl={(t) => {
							setTtl(t);
							setReviewing(false);
						}}
						allPrefixes={allPrefixes}
						setAllPrefixes={(v) => {
							setAllPrefixes(v);
							setReviewing(false);
						}}
						includeDelete={includeDelete}
						setIncludeDelete={(v) => {
							setIncludeDelete(v);
							setReviewing(false);
						}}
						writeAvailable={writeAvailable}
						deleteAvailable={deleteAvailable}
						previewMaxTtl={previewMaxTtl}
						onReview={() => setReviewing(true)}
					/>
				)}
			</section>

			<aside className="panel p-5 sm:p-6">
				{credential !== null ? (
					<CredentialActive credential={credential} remaining={remaining} onClear={onClear} />
				) : reviewing && selected !== null ? (
					<CredentialReview
						bucket={bucket}
						permission={permission}
						includeDelete={includeDelete}
						effectiveTtl={effectiveTtl}
						scopePrefixes={scopePrefixes}
						credentialError={credentialError}
						issuing={issuing}
						onIssue={() => void onIssue()}
						onBack={() => setReviewing(false)}
					/>
				) : (
					<RequestSummaryPlaceholder />
				)}
			</aside>
		</div>
	);
}

function RequestSummaryPlaceholder(): React.JSX.Element {
	return (
		<div>
			<h3 className="section-title">Request summary</h3>
			<p className="mt-4 text-sm leading-6 text-slate-500">
				Reviewing shows the exact paths, capabilities, and effective lifetime before any credential is created.
			</p>
		</div>
	);
}
