import { useState } from "react";
import type { Entitlement } from "../../shared/api-types";
import { api, errorMessage } from "../api";
import { Badge, ErrorNotice } from "../components";
import type { RootAccess, View } from "../types";
import { formatBytes, formatDuration } from "../utils";

interface FilesViewProps {
	roots: RootAccess[];
	selected: RootAccess | null;
	prefix: string;
	listing: {
		folders: string[];
		objects: Array<{ key: string; size: number; lastModified: string }>;
		truncated: boolean;
		continuationToken?: string;
		maxPermission: "read" | "write";
	} | null;
	listingError: string | null;
	loading: boolean;
	onSelectRoot: (root: RootAccess) => void;
	onBrowse: (prefix: string) => void;
	onLoadMore: () => Promise<void>;
	onRefresh: () => void;
	onNavigate: (view: View) => void;
}

export function FilesView({
	roots,
	selected,
	prefix,
	listing,
	listingError,
	loading,
	onSelectRoot,
	onBrowse,
	onLoadMore,
	onRefresh,
	onNavigate,
}: FilesViewProps): React.JSX.Element {
	return (
		<div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
			<AccessScopesPanel
				roots={roots}
				selected={selected}
				onSelectRoot={onSelectRoot}
				onNavigate={onNavigate}
			/>
			<FileListingPanel
				selected={selected}
				prefix={prefix}
				listing={listing}
				listingError={listingError}
				loading={loading}
				onBrowse={onBrowse}
				onLoadMore={onLoadMore}
				onRefresh={onRefresh}
				onNavigate={onNavigate}
			/>
		</div>
	);
}

interface AccessScopesPanelProps {
	roots: RootAccess[];
	selected: RootAccess | null;
	onSelectRoot: (root: RootAccess) => void;
	onNavigate: (view: View) => void;
}

function AccessScopesPanel({ roots, selected, onSelectRoot, onNavigate }: AccessScopesPanelProps): React.JSX.Element {
	return (
		<section className="panel p-5">
			<div className="flex items-center justify-between">
				<h3 className="section-title">Your access</h3>
				<span className="text-xs text-slate-500">
					{roots.length} scope{roots.length === 1 ? "" : "s"}
				</span>
			</div>

			{roots.length === 0 ? (
				<div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/8 p-4 text-sm text-amber-100">
					<p className="font-semibold">No policy grant matches this identity.</p>
					<button type="button" className="mt-3 underline" onClick={() => onNavigate("identity")}>
						Inspect identity details
					</button>
				</div>
			) : (
				<div className="mt-4 space-y-2">
					{roots.map((root) => (
						<RootButton
							key={root.id}
							root={root}
							isSelected={selected?.id === root.id}
							onClick={() => onSelectRoot(root)}
						/>
					))}
				</div>
			)}
		</section>
	);
}

interface RootButtonProps {
	root: RootAccess;
	isSelected: boolean;
	onClick: () => void;
}

function RootButton({ root, isSelected, onClick }: RootButtonProps): React.JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full rounded-xl border p-4 text-left transition ${
				isSelected ? "border-orange-300/45 bg-orange-300/8" : "border-white/8 bg-black/10 hover:border-white/20"
			}`}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold text-white">{root.entitlement.bucket}</p>
					<p className="mt-1 truncate font-mono text-xs text-slate-400">/{root.rootPrefix || ""}</p>
				</div>
				<Badge tone={root.entitlement.permission === "write" ? "write" : "read"}>
					{root.entitlement.permission}
				</Badge>
			</div>
			<div className="mt-3 flex gap-2 text-[11px] text-slate-500">
				<span>{root.entitlement.domain}</span>
				<span>/</span>
				<span>max {formatDuration(root.entitlement.maxTtlSeconds)}</span>
			</div>
		</button>
	);
}

interface FileListingPanelProps {
	selected: RootAccess | null;
	prefix: string;
	listing: FilesViewProps["listing"];
	listingError: string | null;
	loading: boolean;
	onBrowse: (prefix: string) => void;
	onLoadMore: () => Promise<void>;
	onRefresh: () => void;
	onNavigate: (view: View) => void;
}

function FileListingPanel({
	selected,
	prefix,
	listing,
	listingError,
	loading,
	onBrowse,
	onLoadMore,
	onRefresh,
	onNavigate,
}: FileListingPanelProps): React.JSX.Element {
	if (selected === null) {
		return (
			<section className="panel min-w-0 p-5 sm:p-6">
				<p className="text-sm text-slate-500">Select an entitlement to browse.</p>
			</section>
		);
	}

	return (
		<section className="panel min-w-0 p-5 sm:p-6">
			<BreadcrumbBar
				bucket={selected.entitlement.bucket}
				rootPrefix={selected.rootPrefix}
				prefix={prefix}
				onBrowse={onBrowse}
				onNavigate={onNavigate}
			/>

			{listingError !== null && (
				<div className="mt-5">
					<ErrorNotice error={listingError} />
				</div>
			)}

			{loading && listing === null ? (
				<p className="py-12 text-center text-sm text-slate-500">Loading objects...</p>
			) : (
				listing !== null && (
					<ObjectList
						bucket={selected.entitlement.bucket}
						prefix={prefix}
						folders={listing.folders}
						objects={listing.objects}
						truncated={listing.truncated}
						loading={loading}
						onBrowse={onBrowse}
						onLoadMore={onLoadMore}
					/>
				)
			)}

			{listing?.maxPermission === "write" && (
				<UploadSection bucket={selected.entitlement.bucket} prefix={prefix} onRefresh={onRefresh} />
			)}
		</section>
	);
}

interface BreadcrumbBarProps {
	bucket: string;
	rootPrefix: string;
	prefix: string;
	onBrowse: (prefix: string) => void;
	onNavigate: (view: View) => void;
}

function BreadcrumbBar({ bucket, rootPrefix, prefix, onBrowse, onNavigate }: BreadcrumbBarProps): React.JSX.Element {
	const segments = prefix.slice(rootPrefix.length).split("/").filter(Boolean);

	return (
		<div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/8 pb-5">
			<div className="min-w-0">
				<p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Current prefix</p>
				<div className="mt-2 flex flex-wrap items-center gap-1 font-mono text-sm text-slate-200">
					<button type="button" className="crumb" onClick={() => onBrowse(rootPrefix)}>
						{bucket}
					</button>
					{segments.map((segment, index) => {
						const nextPrefix = rootPrefix + `${segments.slice(0, index + 1).join("/")}/`;
						return (
							<span key={nextPrefix} className="flex items-center gap-1">
								<span className="text-slate-600">/</span>
								<button type="button" className="crumb" onClick={() => onBrowse(nextPrefix)}>
									{segment}
								</button>
							</span>
						);
					})}
				</div>
			</div>
			<button type="button" className="button-secondary" onClick={() => onNavigate("credentials")}>
				Issue credentials
			</button>
		</div>
	);
}

interface ObjectListProps {
	bucket: string;
	prefix: string;
	folders: string[];
	objects: Array<{ key: string; size: number; lastModified: string }>;
	truncated: boolean;
	loading: boolean;
	onBrowse: (prefix: string) => void;
	onLoadMore: () => Promise<void>;
}

function ObjectList({
	bucket,
	prefix,
	folders,
	objects,
	truncated,
	loading,
	onBrowse,
	onLoadMore,
}: ObjectListProps): React.JSX.Element {
	return (
		<div className="mt-4 overflow-hidden rounded-xl border border-white/8">
			<div className="hidden grid-cols-[1fr_110px_160px] border-b border-white/8 bg-white/[0.025] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600 sm:grid">
				<span>Name</span>
				<span>Size</span>
				<span>Modified</span>
			</div>

			{folders.map((folder) => (
				<button
					key={folder}
					type="button"
					onClick={() => onBrowse(folder)}
					className="file-row w-full text-left"
				>
					<span className="flex min-w-0 items-center gap-3">
						<span className="file-mark">D</span>
						<span className="truncate font-mono text-sm text-slate-200">{folder.slice(prefix.length)}</span>
					</span>
					<span className="text-xs text-slate-600">Directory</span>
					<span />
				</button>
			))}

			{objects.map((object) => (
				<a
					key={object.key}
					href={`/api/object?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(object.key)}`}
					download
					className="file-row"
				>
					<span className="flex min-w-0 items-center gap-3">
						<span className="file-mark text-orange-100">F</span>
						<span className="truncate font-mono text-sm text-slate-200">{object.key.slice(prefix.length)}</span>
					</span>
					<span className="text-xs text-slate-500">{formatBytes(object.size)}</span>
					<span className="text-xs text-slate-500">
						{object.lastModified ? new Date(object.lastModified).toLocaleString() : "-"}
					</span>
				</a>
			))}

			{folders.length === 0 && objects.length === 0 && (
				<p className="px-4 py-12 text-center text-sm text-slate-500">This prefix is empty.</p>
			)}

			{truncated && (
				<div className="border-t border-white/8 p-3 text-center">
					<button type="button" className="button-secondary" onClick={() => void onLoadMore()} disabled={loading}>
						Load more
					</button>
				</div>
			)}
		</div>
	);
}

interface UploadSectionProps {
	bucket: string;
	prefix: string;
	onRefresh: () => void;
}

function UploadSection({ bucket, prefix, onRefresh }: UploadSectionProps): React.JSX.Element {
	const [uploadFile, setUploadFile] = useState<File | null>(null);
	const [uploadKey, setUploadKey] = useState("");
	const [uploadStatus, setUploadStatus] = useState<string | null>(null);

	async function upload(): Promise<void> {
		if (uploadFile === null || uploadKey === "") return;

		setUploadStatus("Uploading...");
		try {
			await api<{ ok: true }>(
				`/api/object?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(uploadKey)}`,
				{
					method: "PUT",
					body: uploadFile,
					headers: { "Content-Type": uploadFile.type || "application/octet-stream" },
				},
			);
			setUploadStatus(`Uploaded ${uploadFile.name}.`);
			setUploadFile(null);
			setUploadKey("");
			onRefresh();
		} catch (error) {
			setUploadStatus(errorMessage(error));
		}
	}

	return (
		<div className="mt-6 rounded-xl border border-white/8 bg-black/10 p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="section-title">Upload object</h3>
				<span className="text-xs text-slate-500">100 MB browser limit</span>
			</div>
			<div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
				<input
					type="file"
					className="field"
					onChange={(event) => {
						const file = event.target.files?.[0] ?? null;
						setUploadFile(file);
						setUploadKey(file === null ? "" : `${prefix}${file.name}`);
					}}
				/>
				<button
					type="button"
					className="button-primary"
					disabled={uploadFile === null || uploadKey === ""}
					onClick={() => void upload()}
				>
					Upload
				</button>
			</div>
			{uploadFile !== null && (
				<label className="mt-3 block text-xs text-slate-400">
					Object key
					<input
						className="field mt-1.5 w-full font-mono"
						value={uploadKey}
						onChange={(event) => setUploadKey(event.target.value)}
					/>
				</label>
			)}
			{uploadStatus !== null && <p className="mt-3 text-xs text-slate-400">{uploadStatus}</p>}
		</div>
	);
}
