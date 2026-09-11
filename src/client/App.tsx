import { startTransition, useEffect, useState } from "react";
import type {
	AuditResponse,
	AuditRow,
	CredentialResponse,
	Entitlement,
	IdentityResponse,
	MeResponse,
	ObjectsResponse,
	Permission,
} from "../shared/api-types";
import { api, errorMessage } from "./api";

type View = "files" | "credentials" | "activity" | "identity";

interface RootAccess {
	id: string;
	entitlement: Entitlement;
	rootPrefix: string;
}

const navItems: Array<{ id: View; label: string; eyebrow: string }> = [
	{ id: "files", label: "Files", eyebrow: "Browse" },
	{ id: "credentials", label: "Credentials", eyebrow: "Temporary access" },
	{ id: "activity", label: "Activity", eyebrow: "Audit trail" },
	{ id: "identity", label: "Identity", eyebrow: "Troubleshoot" },
];

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatDuration(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function capability(actionsJson: string | null): string {
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

export function credentialScopePrefixes(
	entitlements: readonly Entitlement[],
	bucket: string,
	prefix: string,
	permission: Permission,
	allPrefixes: boolean,
): string[] {
	if (!allPrefixes) return [prefix];
	const prefixes = [...new Set(entitlements
		.filter((grant) => grant.bucket === bucket && (permission === "read" || grant.permission === "write"))
		.flatMap((grant) => grant.prefixes))];
	return prefixes.includes("") ? [""] : prefixes;
}

export function credentialMaxTtl(
	entitlements: readonly Entitlement[],
	bucket: string,
	prefix: string,
	permission: Permission,
	allPrefixes: boolean,
): number | undefined {
	const contributors = entitlements.filter((grant) =>
		grant.bucket === bucket &&
		(permission === "read" || grant.permission === "write") &&
		(allPrefixes || grant.prefixes.some((grantPrefix) => prefix.startsWith(grantPrefix))),
	);
	if (contributors.length === 0) return undefined;
	return allPrefixes ? Math.min(...contributors.map((grant) => grant.maxTtlSeconds)) : contributors[0]?.maxTtlSeconds;
}

export function credentialDeleteAvailable(
	entitlements: readonly Entitlement[],
	bucket: string,
	prefix: string,
	permission: Permission,
	allPrefixes: boolean,
): boolean {
	if (permission !== "write") return false;
	const writeGrants = entitlements.filter((grant) => grant.bucket === bucket && grant.permission === "write");
	return allPrefixes
		? writeGrants.length > 0 && writeGrants.every((grant) => grant.allowDelete)
		: writeGrants.some((grant) => grant.allowDelete && grant.prefixes.some((grantPrefix) => prefix.startsWith(grantPrefix)));
}

function ErrorNotice({ error }: { error: string }): React.JSX.Element {
	return (
		<div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100" role="alert">
			<p className="font-semibold">Request failed</p>
			<p className="mt-1 text-rose-100/75">{error}</p>
		</div>
	);
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "read" | "write" | "danger" }): React.JSX.Element {
	const tones = {
		neutral: "border-white/12 bg-white/5 text-slate-300",
		read: "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
		write: "border-amber-300/25 bg-amber-300/10 text-amber-100",
		danger: "border-rose-300/25 bg-rose-300/10 text-rose-100",
	};
	return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${tones[tone]}`}>{children}</span>;
}

export function App(): React.JSX.Element {
	const [view, setView] = useState<View>("files");
	const [me, setMe] = useState<MeResponse | null>(null);
	const [bootError, setBootError] = useState<string | null>(null);
	const [selected, setSelected] = useState<RootAccess | null>(null);
	const [prefix, setPrefix] = useState("");
	const [listing, setListing] = useState<ObjectsResponse | null>(null);
	const [listingError, setListingError] = useState<string | null>(null);
	const [loadingFiles, setLoadingFiles] = useState(false);
	const [fileRefresh, setFileRefresh] = useState(0);
	const [uploadFile, setUploadFile] = useState<File | null>(null);
	const [uploadKey, setUploadKey] = useState("");
	const [uploadStatus, setUploadStatus] = useState<string | null>(null);
	const [permission, setPermission] = useState<Permission>("read");
	const [ttl, setTtl] = useState(900);
	const [allPrefixes, setAllPrefixes] = useState(false);
	const [includeDelete, setIncludeDelete] = useState(false);
	const [reviewing, setReviewing] = useState(false);
	const [issuing, setIssuing] = useState(false);
	const [credential, setCredential] = useState<CredentialResponse | null>(null);
	const [credentialError, setCredentialError] = useState<string | null>(null);
	const [remaining, setRemaining] = useState(0);
	const [credentialTab, setCredentialTab] = useState<"cli" | "sdk">("cli");
	const [copied, setCopied] = useState<string | null>(null);
	const [activity, setActivity] = useState<AuditResponse | null>(null);
	const [activityError, setActivityError] = useState<string | null>(null);
	const [identity, setIdentity] = useState<IdentityResponse | null>(null);
	const [identityError, setIdentityError] = useState<string | null>(null);

	const roots: RootAccess[] = (me?.entitlements ?? []).flatMap((entitlement, entitlementIndex) =>
		entitlement.prefixes.map((rootPrefix, prefixIndex) => ({
			id: `${entitlementIndex}:${prefixIndex}`,
			entitlement,
			rootPrefix,
		})),
	);

	useEffect(() => {
		const controller = new AbortController();
		api<MeResponse>("/api/me", { signal: controller.signal })
			.then((response) => {
				setMe(response);
				const firstEntitlement = response.entitlements[0];
				const firstPrefix = firstEntitlement?.prefixes[0];
				if (firstEntitlement !== undefined && firstPrefix !== undefined) {
					setSelected({ id: "0:0", entitlement: firstEntitlement, rootPrefix: firstPrefix });
					setPrefix(firstPrefix);
				}
			})
			.catch((error: unknown) => {
				if (!controller.signal.aborted) setBootError(errorMessage(error));
			});
		return () => controller.abort();
	}, []);

	useEffect(() => {
		if (selected === null) return;
		const controller = new AbortController();
		setLoadingFiles(true);
		setListingError(null);
		const query = new URLSearchParams({ bucket: selected.entitlement.bucket, prefix });
		api<ObjectsResponse>(`/api/objects?${query}`, { signal: controller.signal })
			.then((response) => {
				setListing(response);
				setPermission("read");
				setTtl(Math.min(900, selected.entitlement.maxTtlSeconds));
			})
			.catch((error: unknown) => {
				if (!controller.signal.aborted) setListingError(errorMessage(error));
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoadingFiles(false);
			});
		return () => controller.abort();
	}, [selected, prefix, fileRefresh]);

	useEffect(() => {
		if (view !== "credentials") setCredential(null);
	}, [view]);

	useEffect(() => {
		if (credential === null) return;
		const update = () => {
			const seconds = Math.max(0, Math.ceil((Date.parse(credential.expiresAt) - Date.now()) / 1000));
			setRemaining(seconds);
			if (seconds === 0) setCredential(null);
		};
		update();
		const timer = window.setInterval(update, 1000);
		return () => window.clearInterval(timer);
	}, [credential]);

	useEffect(() => {
		if (view !== "activity") return;
		setActivityError(null);
		api<AuditResponse>("/api/audit")
			.then(setActivity)
			.catch((error: unknown) => setActivityError(errorMessage(error)));
	}, [view]);

	useEffect(() => {
		if (view !== "identity" || identity !== null) return;
		api<IdentityResponse>("/api/identity")
			.then(setIdentity)
			.catch((error: unknown) => setIdentityError(errorMessage(error)));
	}, [view, identity]);

	function selectRoot(root: RootAccess): void {
		startTransition(() => {
			setSelected(root);
			setPrefix(root.rootPrefix);
			setListing(null);
			setReviewing(false);
			setCredential(null);
			setAllPrefixes(false);
			setIncludeDelete(false);
		});
	}

	function browse(nextPrefix: string): void {
		startTransition(() => {
			setPrefix(nextPrefix);
			setListing(null);
			setReviewing(false);
			setCredential(null);
			setAllPrefixes(false);
			setIncludeDelete(false);
		});
	}

	async function loadMore(): Promise<void> {
		if (selected === null || listing?.continuationToken === undefined) return;
		setLoadingFiles(true);
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
		} catch (error) {
			setListingError(errorMessage(error));
		} finally {
			setLoadingFiles(false);
		}
	}

	async function upload(): Promise<void> {
		if (selected === null || uploadFile === null || uploadKey === "") return;
		setUploadStatus("Uploading...");
		try {
			await api<{ ok: true }>(
				`/api/object?bucket=${encodeURIComponent(selected.entitlement.bucket)}&key=${encodeURIComponent(uploadKey)}`,
				{
					method: "PUT",
					body: uploadFile,
					headers: { "Content-Type": uploadFile.type || "application/octet-stream" },
				},
			);
			setUploadStatus(`Uploaded ${uploadFile.name}.`);
			setUploadFile(null);
			setUploadKey("");
			setFileRefresh((value) => value + 1);
		} catch (error) {
			setUploadStatus(errorMessage(error));
		}
	}

	const writeAvailable = listing?.maxPermission === "write";
	const selectedBucket = selected?.entitlement.bucket ?? "";
	const deleteAvailable = credentialDeleteAvailable(me?.entitlements ?? [], selectedBucket, prefix, permission, allPrefixes);
	const scopePrefixes = credentialScopePrefixes(me?.entitlements ?? [], selectedBucket, prefix, permission, allPrefixes);
	const previewMaxTtl = credentialMaxTtl(me?.entitlements ?? [], selectedBucket, prefix, permission, allPrefixes) ?? ttl;
	const effectiveTtl = Math.min(ttl, previewMaxTtl);

	async function issueCredential(): Promise<void> {
		if (selected === null) return;
		setIssuing(true);
		setCredentialError(null);
		try {
			const result = await api<CredentialResponse>("/api/credentials", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					bucket: selected.entitlement.bucket,
					prefix,
					permission,
					ttlSeconds: ttl,
					allPrefixes,
					includeDelete,
				}),
			});
			setCredential(result);
			setReviewing(false);
		} catch (error) {
			setCredentialError(errorMessage(error));
		} finally {
			setIssuing(false);
		}
	}

	async function copy(label: string, value: string): Promise<void> {
		await navigator.clipboard.writeText(value);
		setCopied(label);
		window.setTimeout(() => setCopied(null), 1500);
	}

	const sdkExample = credential === null ? "" : `const client = new S3Client({\n  region: "auto",\n  endpoint: "${credential.endpoint}",\n  credentials: {\n    accessKeyId: process.env.AWS_ACCESS_KEY_ID,\n    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,\n    sessionToken: process.env.AWS_SESSION_TOKEN,\n  },\n});`;

	if (bootError !== null) {
		return <main className="mx-auto flex min-h-screen max-w-xl items-center px-6"><ErrorNotice error={bootError} /></main>;
	}
	if (me === null) {
		return <main className="grid min-h-screen place-items-center text-sm uppercase tracking-[0.22em] text-slate-400">Establishing secure session</main>;
	}

	return (
		<div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
		<aside className="border-b border-white/8 bg-[#0a111c] px-5 py-5 lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0 lg:px-6 lg:py-8">
			<div className="flex items-center justify-between lg:block">
				<div>
					<p className="text-[10px] font-bold uppercase tracking-[0.28em] text-orange-300">Cloudflare R2</p>
					<h1 className="mt-1 font-display text-xl font-semibold text-white">Access broker</h1>
				</div>
				<div className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_20px_#6ee7b7]" title="Authenticated" />
			</div>
			<nav className="mt-5 flex gap-2 overflow-x-auto pb-1 lg:mt-12 lg:block lg:space-y-2" aria-label="Primary navigation">
				{navItems.map((item) => (
					<button
						key={item.id}
						type="button"
						onClick={() => setView(item.id)}
						aria-current={view === item.id ? "page" : undefined}
						className={`min-w-fit rounded-xl px-4 py-3 text-left transition lg:w-full ${view === item.id ? "bg-white text-slate-950" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}
					>
						<span className="block text-[9px] font-bold uppercase tracking-[0.2em] opacity-55">{item.eyebrow}</span>
						<span className="mt-0.5 block text-sm font-semibold">{item.label}</span>
					</button>
				))}
			</nav>
			<div className="mt-8 hidden border-t border-white/8 pt-5 lg:block">
				<p className="truncate text-sm font-medium text-slate-200">{me.email}</p>
				<p className="mt-1 text-xs text-slate-500">{me.entitlements.length} policy grant{me.entitlements.length === 1 ? "" : "s"}</p>
			</div>
		</aside>

		<main className="min-w-0 px-5 py-8 sm:px-8 lg:px-12 lg:py-11 xl:px-16">
			<header className="mb-9 flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Least privilege workspace</p>
					<h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">{navItems.find((item) => item.id === view)?.label}</h2>
				</div>
				<div className="rounded-full border border-emerald-300/15 bg-emerald-300/8 px-3 py-1.5 text-xs font-medium text-emerald-100">Access verified</div>
			</header>

			{view === "files" && (
				<div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
					<section className="panel p-5">
						<div className="flex items-center justify-between">
							<h3 className="section-title">Your access</h3>
							<span className="text-xs text-slate-500">{roots.length} scope{roots.length === 1 ? "" : "s"}</span>
						</div>
						{roots.length === 0 ? (
							<div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/8 p-4 text-sm text-amber-100">
								<p className="font-semibold">No policy grant matches this identity.</p>
								<button type="button" className="mt-3 underline" onClick={() => setView("identity")}>Inspect identity details</button>
							</div>
						) : (
							<div className="mt-4 space-y-2">
								{roots.map((root) => (
									<button
										key={root.id}
										type="button"
										onClick={() => selectRoot(root)}
										className={`w-full rounded-xl border p-4 text-left transition ${selected?.id === root.id ? "border-orange-300/45 bg-orange-300/8" : "border-white/8 bg-black/10 hover:border-white/20"}`}
									>
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<p className="truncate text-sm font-semibold text-white">{root.entitlement.bucket}</p>
												<p className="mt-1 truncate font-mono text-xs text-slate-400">/{root.rootPrefix || ""}</p>
											</div>
											<Badge tone={root.entitlement.permission === "write" ? "write" : "read"}>{root.entitlement.permission}</Badge>
										</div>
										<div className="mt-3 flex gap-2 text-[11px] text-slate-500">
											<span>{root.entitlement.domain}</span><span>/</span><span>max {formatDuration(root.entitlement.maxTtlSeconds)}</span>
										</div>
									</button>
								))}
							</div>
						)}
					</section>

					<section className="panel min-w-0 p-5 sm:p-6">
						{selected === null ? <p className="text-sm text-slate-500">Select an entitlement to browse.</p> : (
							<>
								<div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/8 pb-5">
									<div className="min-w-0">
										<p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Current prefix</p>
										<div className="mt-2 flex flex-wrap items-center gap-1 font-mono text-sm text-slate-200">
											<button type="button" className="crumb" onClick={() => browse(selected.rootPrefix)}>{selected.entitlement.bucket}</button>
											{prefix.slice(selected.rootPrefix.length).split("/").filter(Boolean).map((segment, index, segments) => {
												const nextPrefix = selected.rootPrefix + `${segments.slice(0, index + 1).join("/")}/`;
												return <span key={nextPrefix} className="flex items-center gap-1"><span className="text-slate-600">/</span><button type="button" className="crumb" onClick={() => browse(nextPrefix)}>{segment}</button></span>;
											})}
										</div>
									</div>
									<button type="button" className="button-secondary" onClick={() => setView("credentials")}>Issue credentials</button>
								</div>
								{listingError !== null && <div className="mt-5"><ErrorNotice error={listingError} /></div>}
								{loadingFiles && listing === null ? <p className="py-12 text-center text-sm text-slate-500">Loading objects...</p> : listing !== null && (
									<div className="mt-4 overflow-hidden rounded-xl border border-white/8">
										<div className="hidden grid-cols-[1fr_110px_160px] border-b border-white/8 bg-white/[0.025] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600 sm:grid">
											<span>Name</span><span>Size</span><span>Modified</span>
										</div>
										{listing.folders.map((folder) => (
											<button key={folder} type="button" onClick={() => browse(folder)} className="file-row w-full text-left">
												<span className="flex min-w-0 items-center gap-3"><span className="file-mark">D</span><span className="truncate font-mono text-sm text-slate-200">{folder.slice(prefix.length)}</span></span>
												<span className="text-xs text-slate-600">Directory</span><span />
											</button>
										))}
										{listing.objects.map((object) => (
											<a
												key={object.key}
												href={`/api/object?bucket=${encodeURIComponent(selected.entitlement.bucket)}&key=${encodeURIComponent(object.key)}`}
												download
												className="file-row"
											>
												<span className="flex min-w-0 items-center gap-3"><span className="file-mark text-orange-100">F</span><span className="truncate font-mono text-sm text-slate-200">{object.key.slice(prefix.length)}</span></span>
												<span className="text-xs text-slate-500">{formatBytes(object.size)}</span>
												<span className="text-xs text-slate-500">{object.lastModified ? new Date(object.lastModified).toLocaleString() : "-"}</span>
											</a>
										))}
										{listing.folders.length === 0 && listing.objects.length === 0 && <p className="px-4 py-12 text-center text-sm text-slate-500">This prefix is empty.</p>}
										{listing.truncated && <div className="border-t border-white/8 p-3 text-center"><button type="button" className="button-secondary" onClick={() => void loadMore()} disabled={loadingFiles}>Load more</button></div>}
									</div>
								)}

								{writeAvailable && (
									<div className="mt-6 rounded-xl border border-white/8 bg-black/10 p-4">
										<div className="flex flex-wrap items-center justify-between gap-2"><h3 className="section-title">Upload object</h3><span className="text-xs text-slate-500">100 MB browser limit</span></div>
										<div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
											<input type="file" className="field" onChange={(event) => {
												const file = event.target.files?.[0] ?? null;
												setUploadFile(file);
												setUploadKey(file === null ? "" : `${prefix}${file.name}`);
											}} />
											<button type="button" className="button-primary" disabled={uploadFile === null || uploadKey === ""} onClick={() => void upload()}>Upload</button>
										</div>
										{uploadFile !== null && <label className="mt-3 block text-xs text-slate-400">Object key<input className="field mt-1.5 w-full font-mono" value={uploadKey} onChange={(event) => setUploadKey(event.target.value)} /></label>}
										{uploadStatus !== null && <p className="mt-3 text-xs text-slate-400">{uploadStatus}</p>}
									</div>
								)}
							</>
						)}
					</section>
				</div>
			)}

			{view === "credentials" && (
				<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
					<section className="panel p-5 sm:p-7">
						<h3 className="section-title">Request temporary access</h3>
						<p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Credentials are bearer tokens. Choose the narrowest scope and shortest lifetime that completes the task.</p>
						{selected === null ? <p className="mt-6 text-sm text-slate-500">Select a file scope first.</p> : (
							<div className="mt-7 space-y-6">
								<div>
									<label className="field-label" htmlFor="credential-scope">Scope</label>
									<div id="credential-scope" className="mt-2 rounded-xl border border-white/10 bg-black/15 p-4 font-mono text-sm text-slate-200">s3://{selected.entitlement.bucket}/{prefix}</div>
								</div>
								<fieldset>
									<legend className="field-label">Capability</legend>
									<div className="mt-2 grid gap-3 sm:grid-cols-2">
										<label className={`choice ${permission === "read" ? "choice-active" : ""}`}><input type="radio" name="permission" value="read" checked={permission === "read"} onChange={() => { setPermission("read"); setIncludeDelete(false); setReviewing(false); }} /><span><strong>Read only</strong><small>Browse and download objects</small></span></label>
										<label className={`choice ${permission === "write" ? "choice-active" : ""} ${!writeAvailable ? "opacity-40" : ""}`}><input type="radio" name="permission" value="write" checked={permission === "write"} disabled={!writeAvailable} onChange={() => { setPermission("write"); setReviewing(false); }} /><span><strong>Read and write</strong><small>Upload and overwrite objects</small></span></label>
									</div>
								</fieldset>
								<div className="grid gap-5 sm:grid-cols-2">
									<label className="field-label">Lifetime
										<select className="field mt-2 w-full normal-case tracking-normal" value={ttl} onChange={(event) => { setTtl(Number(event.target.value)); setReviewing(false); }}>
											{[...new Set([Math.min(300, previewMaxTtl), 300, 900, 1800, 3600])].filter((seconds) => seconds > 0 && seconds <= previewMaxTtl).map((seconds) => <option key={seconds} value={seconds}>{formatDuration(seconds)}</option>)}
										</select>
									</label>
									<div><p className="field-label">Policy maximum</p><p className="mt-3 text-sm text-slate-300">{formatDuration(previewMaxTtl)}</p></div>
								</div>
								<label className="flex items-start gap-3 rounded-xl border border-white/8 p-4 text-sm text-slate-300"><input type="checkbox" className="mt-1 accent-orange-400" checked={allPrefixes} onChange={(event) => { setAllPrefixes(event.target.checked); setIncludeDelete(false); setReviewing(false); }} /><span><strong className="block text-white">Include every eligible prefix in this bucket</strong><span className="mt-1 block text-xs leading-5 text-slate-500">This broadens the credential beyond the prefix currently open.</span></span></label>
								{deleteAvailable && <label className="flex items-start gap-3 rounded-xl border border-rose-300/25 bg-rose-300/7 p-4 text-sm text-rose-100"><input type="checkbox" className="mt-1 accent-rose-400" checked={includeDelete} onChange={(event) => { setIncludeDelete(event.target.checked); setReviewing(false); }} /><span><strong className="block">Include permanent deletion</strong><span className="mt-1 block text-xs leading-5 text-rose-100/65">Deletion cannot be undone. It is withheld unless you select this option.</span></span></label>}
								<button type="button" className="button-primary" onClick={() => setReviewing(true)}>Review request</button>
							</div>
						)}
					</section>

					<aside className="panel p-5 sm:p-6">
						{credential !== null ? (
							<div>
								<div className="flex items-start justify-between gap-3"><div><p className="section-title text-emerald-200">Credential active</p><p className="mt-2 font-display text-3xl text-white">{formatDuration(remaining)}</p></div><button type="button" className="text-xs text-slate-400 underline" onClick={() => setCredential(null)}>Clear now</button></div>
								<div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/8 p-3 text-xs leading-5 text-amber-100">Anyone who copies these values has the displayed access until expiry. They are never stored by this application.</div>
								<div className="mt-5 flex gap-2"><button type="button" className={`tab ${credentialTab === "cli" ? "tab-active" : ""}`} onClick={() => setCredentialTab("cli")}>CLI</button><button type="button" className={`tab ${credentialTab === "sdk" ? "tab-active" : ""}`} onClick={() => setCredentialTab("sdk")}>SDK</button></div>
								<pre className="code-block mt-3">{credentialTab === "cli" ? credential.shell : sdkExample}</pre>
								<button type="button" className="button-secondary mt-3 w-full" onClick={() => void copy(credentialTab, credentialTab === "cli" ? credential.shell : sdkExample)}>{copied === credentialTab ? "Copied" : `Copy ${credentialTab.toUpperCase()} snippet`}</button>
							</div>
						) : reviewing && selected !== null ? (
							<div>
								<h3 className="section-title">Confirm exact access</h3>
								<div className="mt-5 space-y-5">
									<div><p className="review-label">Capability</p><p className="review-value">{permission === "read" ? "Read only" : includeDelete ? "Read, write, and delete" : "Read and write, no delete"}</p></div>
									<div><p className="review-label">Lifetime</p><p className="review-value">{formatDuration(effectiveTtl)}</p></div>
									<div><p className="review-label">Prefixes</p><div className="mt-2 space-y-1">{scopePrefixes.map((scope) => <p key={scope} className="break-all font-mono text-xs text-slate-300">s3://{selected.entitlement.bucket}/{scope}</p>)}</div></div>
								</div>
								{credentialError !== null && <div className="mt-5"><ErrorNotice error={credentialError} /></div>}
								<button type="button" className={`mt-6 w-full ${includeDelete ? "button-danger" : "button-primary"}`} disabled={issuing} onClick={() => void issueCredential()}>{issuing ? "Recording and issuing..." : includeDelete ? "Issue with delete" : "Issue credential"}</button>
								<button type="button" className="mt-3 w-full text-xs text-slate-500 hover:text-white" onClick={() => setReviewing(false)}>Change request</button>
							</div>
						) : (
							<div><h3 className="section-title">Request summary</h3><p className="mt-4 text-sm leading-6 text-slate-500">Reviewing shows the exact paths, capabilities, and effective lifetime before any credential is created.</p></div>
						)}
					</aside>
				</div>
			)}

			{view === "activity" && (
				<section className="panel overflow-hidden">
					<div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 p-5 sm:px-6"><div><h3 className="section-title">Access events</h3><p className="mt-1 text-xs text-slate-500">{activity?.scope === "all" ? "All principals" : "Your activity only"}</p></div><button type="button" className="button-secondary" onClick={() => { setActivity(null); setView("files"); window.setTimeout(() => setView("activity"), 0); }}>Refresh</button></div>
					{activityError !== null ? <div className="m-5"><ErrorNotice error={activityError} /></div> : activity === null ? <p className="p-10 text-center text-sm text-slate-500">Loading activity...</p> : <ActivityTable rows={activity.rows} showPrincipal={activity.scope === "all"} />}
				</section>
			)}

			{view === "identity" && (
				<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
					<section className="panel p-5 sm:p-7">
						<h3 className="section-title">Policy identity</h3>
						<p className="mt-2 text-sm leading-6 text-slate-400">These are the values Cloudflare Access supplied and the policy matched.</p>
						{identityError !== null ? <div className="mt-5"><ErrorNotice error={identityError} /></div> : identity === null ? <p className="mt-6 text-sm text-slate-500">Loading identity...</p> : (
							<div className="mt-7 space-y-6">
								<div><p className="review-label">Email</p><p className="review-value font-mono">{identity.email}</p></div>
								<div><p className="review-label">Groups</p><div className="mt-2 flex flex-wrap gap-2">{identity.groups.length ? identity.groups.map((group) => <Badge key={group}>{group}</Badge>) : <span className="text-sm text-amber-200">No groups received</span>}</div></div>
								<div><p className="review-label">Resolved grants</p><p className="review-value">{identity.entitlements.length}</p></div>
							</div>
						)}
					</section>
					<aside className="panel p-5 sm:p-6"><h3 className="section-title">No access?</h3><ol className="mt-5 space-y-5 text-sm leading-6 text-slate-400"><li><strong className="text-slate-200">1. Check the login method.</strong><br />Use an identity provider that returns groups.</li><li><strong className="text-slate-200">2. Compare exact values.</strong><br />A group email or name must match an assignment in policy.json.</li><li><strong className="text-slate-200">3. Sign in again.</strong><br />Group changes appear after Access refreshes the identity session.</li></ol></aside>
				</div>
			)}
		</main>
		</div>
	);
}

function ActivityTable({ rows, showPrincipal }: { rows: AuditRow[]; showPrincipal: boolean }): React.JSX.Element {
	if (rows.length === 0) return <p className="p-10 text-center text-sm text-slate-500">No events recorded yet.</p>;
	return (
		<div className="overflow-x-auto">
			<table className="w-full min-w-[820px] text-left text-xs">
				<thead className="border-b border-white/8 bg-white/[0.025] text-[10px] uppercase tracking-[0.16em] text-slate-600"><tr><th className="px-5 py-3">Time</th>{showPrincipal && <th className="px-5 py-3">Principal</th>}<th className="px-5 py-3">Result</th><th className="px-5 py-3">Action</th><th className="px-5 py-3">Scope</th><th className="px-5 py-3">Capability</th><th className="px-5 py-3">Request</th></tr></thead>
				<tbody className="divide-y divide-white/6">{rows.map((row) => <tr key={`${row.request_id}:${row.action}`} className="text-slate-400 hover:bg-white/[0.02]"><td className="whitespace-nowrap px-5 py-4">{new Date(row.ts).toLocaleString()}</td>{showPrincipal && <td className="px-5 py-4">{row.email}</td>}<td className="px-5 py-4"><Badge tone={row.outcome === "granted" ? "read" : row.outcome === "denied" ? "danger" : "write"}>{row.outcome}</Badge></td><td className="px-5 py-4 text-slate-200">{row.action}</td><td className="max-w-[250px] px-5 py-4 font-mono">{row.bucket === null ? "-" : `${row.bucket}/${row.path ?? ""}`}</td><td className="px-5 py-4">{capability(row.actions)}</td><td className="px-5 py-4 font-mono text-slate-600">{row.request_id.slice(0, 8)}</td></tr>)}</tbody>
			</table>
		</div>
	);
}
