import type { AuditResponse, AuditRow } from "../../shared/api-types";
import { Badge, ErrorNotice } from "../components";
import { formatCapability } from "../utils";

interface ActivityViewProps {
	activity: AuditResponse | null;
	error: string | null;
	loading: boolean;
	onRefresh: () => void;
}

export function ActivityView({ activity, error, loading, onRefresh }: ActivityViewProps): React.JSX.Element {
	return (
		<section className="panel overflow-hidden">
			<div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 p-5 sm:px-6">
				<div>
					<h3 className="section-title">Access events</h3>
					<p className="mt-1 text-xs text-slate-500">
						{activity?.scope === "all" ? "All principals" : "Your activity only"}
					</p>
				</div>
				<button type="button" className="button-secondary" onClick={onRefresh} disabled={loading}>
					Refresh
				</button>
			</div>

			{error !== null ? (
				<div className="m-5">
					<ErrorNotice error={error} />
				</div>
			) : activity === null ? (
				<p className="p-10 text-center text-sm text-slate-500">Loading activity...</p>
			) : (
				<ActivityTable rows={activity.rows} showPrincipal={activity.scope === "all"} />
			)}
		</section>
	);
}

interface ActivityTableProps {
	rows: AuditRow[];
	showPrincipal: boolean;
}

function ActivityTable({ rows, showPrincipal }: ActivityTableProps): React.JSX.Element {
	if (rows.length === 0) {
		return <p className="p-10 text-center text-sm text-slate-500">No events recorded yet.</p>;
	}

	return (
		<div className="overflow-x-auto">
			<table className="w-full min-w-[820px] text-left text-xs">
				<thead className="border-b border-white/8 bg-white/[0.025] text-[10px] uppercase tracking-[0.16em] text-slate-600">
					<tr>
						<th className="px-5 py-3">Time</th>
						{showPrincipal && <th className="px-5 py-3">Principal</th>}
						<th className="px-5 py-3">Result</th>
						<th className="px-5 py-3">Action</th>
						<th className="px-5 py-3">Scope</th>
						<th className="px-5 py-3">Capability</th>
						<th className="px-5 py-3">Request</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-white/6">
					{rows.map((row) => (
						<ActivityRow key={`${row.request_id}:${row.action}`} row={row} showPrincipal={showPrincipal} />
					))}
				</tbody>
			</table>
		</div>
	);
}

interface ActivityRowProps {
	row: AuditRow;
	showPrincipal: boolean;
}

function ActivityRow({ row, showPrincipal }: ActivityRowProps): React.JSX.Element {
	const outcomeTone = row.outcome === "granted" ? "read" : row.outcome === "denied" ? "danger" : "write";

	return (
		<tr className="text-slate-400 hover:bg-white/[0.02]">
			<td className="whitespace-nowrap px-5 py-4">{new Date(row.ts).toLocaleString()}</td>
			{showPrincipal && <td className="px-5 py-4">{row.email}</td>}
			<td className="px-5 py-4">
				<Badge tone={outcomeTone}>{row.outcome}</Badge>
			</td>
			<td className="px-5 py-4 text-slate-200">{row.action}</td>
			<td className="max-w-[250px] px-5 py-4 font-mono">
				{row.bucket === null ? "-" : `${row.bucket}/${row.path ?? ""}`}
			</td>
			<td className="px-5 py-4">{formatCapability(row.actions)}</td>
			<td className="px-5 py-4 font-mono text-slate-600">{row.request_id.slice(0, 8)}</td>
		</tr>
	);
}
