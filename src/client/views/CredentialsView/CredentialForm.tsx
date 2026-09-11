import type { Permission } from "../../../shared/api-types";
import { formatDuration } from "../../utils";

interface CredentialFormProps {
	bucket: string;
	prefix: string;
	permission: Permission;
	setPermission: (p: Permission) => void;
	ttl: number;
	setTtl: (t: number) => void;
	allPrefixes: boolean;
	setAllPrefixes: (v: boolean) => void;
	includeDelete: boolean;
	setIncludeDelete: (v: boolean) => void;
	writeAvailable: boolean;
	deleteAvailable: boolean;
	previewMaxTtl: number;
	onReview: () => void;
}

export function CredentialForm({
	bucket,
	prefix,
	permission,
	setPermission,
	ttl,
	setTtl,
	allPrefixes,
	setAllPrefixes,
	includeDelete,
	setIncludeDelete,
	writeAvailable,
	deleteAvailable,
	previewMaxTtl,
	onReview,
}: CredentialFormProps): React.JSX.Element {
	const ttlOptions = [...new Set([Math.min(300, previewMaxTtl), 300, 900, 1800, 3600])].filter(
		(seconds) => seconds > 0 && seconds <= previewMaxTtl,
	);

	return (
		<>
			<h3 className="section-title">Request temporary access</h3>
			<p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
				Credentials are bearer tokens. Choose the narrowest scope and shortest lifetime that completes the task.
			</p>

			<div className="mt-7 space-y-6">
				<div>
					<label className="field-label" htmlFor="credential-scope">
						Scope
					</label>
					<div
						id="credential-scope"
						className="mt-2 rounded-xl border border-white/10 bg-black/15 p-4 font-mono text-sm text-slate-200"
					>
						s3://{bucket}/{prefix}
					</div>
				</div>

				<fieldset>
					<legend className="field-label">Capability</legend>
					<div className="mt-2 grid gap-3 sm:grid-cols-2">
						<label className={`choice ${permission === "read" ? "choice-active" : ""}`}>
							<input
								type="radio"
								name="permission"
								value="read"
								checked={permission === "read"}
								onChange={() => {
									setPermission("read");
									setIncludeDelete(false);
								}}
							/>
							<span>
								<strong>Read only</strong>
								<small>Browse and download objects</small>
							</span>
						</label>
						<label
							className={`choice ${permission === "write" ? "choice-active" : ""} ${!writeAvailable ? "opacity-40" : ""}`}
						>
							<input
								type="radio"
								name="permission"
								value="write"
								checked={permission === "write"}
								disabled={!writeAvailable}
								onChange={() => setPermission("write")}
							/>
							<span>
								<strong>Read and write</strong>
								<small>Upload and overwrite objects</small>
							</span>
						</label>
					</div>
				</fieldset>

				<div className="grid gap-5 sm:grid-cols-2">
					<label className="field-label">
						Lifetime
						<select
							className="field mt-2 w-full normal-case tracking-normal"
							value={ttl}
							onChange={(event) => setTtl(Number(event.target.value))}
						>
							{ttlOptions.map((seconds) => (
								<option key={seconds} value={seconds}>
									{formatDuration(seconds)}
								</option>
							))}
						</select>
					</label>
					<div>
						<p className="field-label">Policy maximum</p>
						<p className="mt-3 text-sm text-slate-300">{formatDuration(previewMaxTtl)}</p>
					</div>
				</div>

				<label className="flex items-start gap-3 rounded-xl border border-white/8 p-4 text-sm text-slate-300">
					<input
						type="checkbox"
						className="mt-1 accent-orange-400"
						checked={allPrefixes}
						onChange={(event) => {
							setAllPrefixes(event.target.checked);
							setIncludeDelete(false);
						}}
					/>
					<span>
						<strong className="block text-white">Include every eligible prefix in this bucket</strong>
						<span className="mt-1 block text-xs leading-5 text-slate-500">
							This broadens the credential beyond the prefix currently open.
						</span>
					</span>
				</label>

				{deleteAvailable && (
					<label className="flex items-start gap-3 rounded-xl border border-rose-300/25 bg-rose-300/7 p-4 text-sm text-rose-100">
						<input
							type="checkbox"
							className="mt-1 accent-rose-400"
							checked={includeDelete}
							onChange={(event) => setIncludeDelete(event.target.checked)}
						/>
						<span>
							<strong className="block">Include permanent deletion</strong>
							<span className="mt-1 block text-xs leading-5 text-rose-100/65">
								Deletion cannot be undone. It is withheld unless you select this option.
							</span>
						</span>
					</label>
				)}

				<button type="button" className="button-primary" onClick={onReview}>
					Review request
				</button>
			</div>
		</>
	);
}
