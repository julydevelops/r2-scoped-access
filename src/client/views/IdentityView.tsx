import type { IdentityResponse } from "../../shared/api-types";
import { Badge, ErrorNotice } from "../components";

interface IdentityViewProps {
	identity: IdentityResponse | null;
	error: string | null;
	loading: boolean;
}

export function IdentityView({ identity, error, loading }: IdentityViewProps): React.JSX.Element {
	return (
		<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
			<section className="panel p-5 sm:p-7">
				<h3 className="section-title">Policy identity</h3>
				<p className="mt-2 text-sm leading-6 text-slate-400">
					These are the values Cloudflare Access supplied and the policy matched.
				</p>

				{error !== null ? (
					<div className="mt-5">
						<ErrorNotice error={error} />
					</div>
				) : identity === null || loading ? (
					<p className="mt-6 text-sm text-slate-500">Loading identity...</p>
				) : (
					<IdentityDetails identity={identity} />
				)}
			</section>

			<aside className="panel p-5 sm:p-6">
				<TroubleshootingGuide />
			</aside>
		</div>
	);
}

interface IdentityDetailsProps {
	identity: IdentityResponse;
}

function IdentityDetails({ identity }: IdentityDetailsProps): React.JSX.Element {
	return (
		<div className="mt-7 space-y-6">
			<div>
				<p className="review-label">Email</p>
				<p className="review-value font-mono">{identity.email}</p>
			</div>
			<div>
				<p className="review-label">Groups</p>
				<div className="mt-2 flex flex-wrap gap-2">
					{identity.groups.length ? (
						identity.groups.map((group) => <Badge key={group}>{group}</Badge>)
					) : (
						<span className="text-sm text-amber-200">No groups received</span>
					)}
				</div>
			</div>
			<div>
				<p className="review-label">Resolved grants</p>
				<p className="review-value">{identity.entitlements.length}</p>
			</div>
		</div>
	);
}

function TroubleshootingGuide(): React.JSX.Element {
	return (
		<>
			<h3 className="section-title">No access?</h3>
			<ol className="mt-5 space-y-5 text-sm leading-6 text-slate-400">
				<li>
					<strong className="text-slate-200">1. Check the login method.</strong>
					<br />
					Use an identity provider that returns groups.
				</li>
				<li>
					<strong className="text-slate-200">2. Compare exact values.</strong>
					<br />
					A group email or name must match an assignment in policy.json.
				</li>
				<li>
					<strong className="text-slate-200">3. Sign in again.</strong>
					<br />
					Group changes appear after Access refreshes the identity session.
				</li>
			</ol>
		</>
	);
}
