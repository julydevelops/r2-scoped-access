import type { Permission } from "../../../shared/api-types";
import { ErrorNotice } from "../../components";
import { formatDuration } from "../../utils";

interface CredentialReviewProps {
	bucket: string;
	permission: Permission;
	includeDelete: boolean;
	effectiveTtl: number;
	scopePrefixes: string[];
	credentialError: string | null;
	issuing: boolean;
	onIssue: () => void;
	onBack: () => void;
}

export function CredentialReview({
	bucket,
	permission,
	includeDelete,
	effectiveTtl,
	scopePrefixes,
	credentialError,
	issuing,
	onIssue,
	onBack,
}: CredentialReviewProps): React.JSX.Element {
	const capabilityText =
		permission === "read"
			? "Read only"
			: includeDelete
				? "Read, write, and delete"
				: "Read and write, no delete";

	return (
		<div>
			<h3 className="section-title">Confirm exact access</h3>

			<div className="mt-5 space-y-5">
				<div>
					<p className="review-label">Capability</p>
					<p className="review-value">{capabilityText}</p>
				</div>
				<div>
					<p className="review-label">Lifetime</p>
					<p className="review-value">{formatDuration(effectiveTtl)}</p>
				</div>
				<div>
					<p className="review-label">Prefixes</p>
					<div className="mt-2 space-y-1">
						{scopePrefixes.map((scope) => (
							<p key={scope} className="break-all font-mono text-xs text-slate-300">
								s3://{bucket}/{scope}
							</p>
						))}
					</div>
				</div>
			</div>

			{credentialError !== null && (
				<div className="mt-5">
					<ErrorNotice error={credentialError} />
				</div>
			)}

			<button
				type="button"
				className={`mt-6 w-full ${includeDelete ? "button-danger" : "button-primary"}`}
				disabled={issuing}
				onClick={onIssue}
			>
				{issuing ? "Recording and issuing..." : includeDelete ? "Issue with delete" : "Issue credential"}
			</button>

			<button
				type="button"
				className="mt-3 w-full text-xs text-slate-500 hover:text-white"
				onClick={onBack}
			>
				Change request
			</button>
		</div>
	);
}
