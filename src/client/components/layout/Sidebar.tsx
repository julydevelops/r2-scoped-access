import { navItems, type View } from "../../types";

interface SidebarProps {
	email: string;
	grantCount: number;
	currentView: View;
	onViewChange: (view: View) => void;
}

export function Sidebar({ email, grantCount, currentView, onViewChange }: SidebarProps): React.JSX.Element {
	return (
		<aside className="border-b border-white/8 bg-[#0a111c] px-5 py-5 lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0 lg:px-6 lg:py-8">
			<div className="flex items-center justify-between lg:block">
				<div>
					<p className="text-[10px] font-bold uppercase tracking-[0.28em] text-orange-300">Cloudflare R2</p>
					<h1 className="mt-1 font-display text-xl font-semibold text-white">Access broker</h1>
				</div>
				<div
					className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_20px_#6ee7b7]"
					title="Authenticated"
				/>
			</div>

			<nav
				className="mt-5 flex gap-2 overflow-x-auto pb-1 lg:mt-12 lg:block lg:space-y-2"
				aria-label="Primary navigation"
			>
				{navItems.map((item) => (
					<button
						key={item.id}
						type="button"
						onClick={() => onViewChange(item.id)}
						aria-current={currentView === item.id ? "page" : undefined}
						className={`min-w-fit rounded-xl px-4 py-3 text-left transition lg:w-full ${
							currentView === item.id
								? "bg-white text-slate-950"
								: "text-slate-400 hover:bg-white/5 hover:text-white"
						}`}
					>
						<span className="block text-[9px] font-bold uppercase tracking-[0.2em] opacity-55">
							{item.eyebrow}
						</span>
						<span className="mt-0.5 block text-sm font-semibold">{item.label}</span>
					</button>
				))}
			</nav>

			<div className="mt-8 hidden border-t border-white/8 pt-5 lg:block">
				<p className="truncate text-sm font-medium text-slate-200">{email}</p>
				<p className="mt-1 text-xs text-slate-500">
					{grantCount} policy grant{grantCount === 1 ? "" : "s"}
				</p>
			</div>
		</aside>
	);
}
