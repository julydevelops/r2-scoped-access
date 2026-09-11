import { navItems, type View } from "../../types";

interface PageHeaderProps {
	view: View;
}

export function PageHeader({ view }: PageHeaderProps): React.JSX.Element {
	const title = navItems.find((item) => item.id === view)?.label ?? "";

	return (
		<header className="mb-9 flex flex-wrap items-end justify-between gap-4">
			<div>
				<p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Least privilege workspace</p>
				<h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
					{title}
				</h2>
			</div>
			<div className="rounded-full border border-emerald-300/15 bg-emerald-300/8 px-3 py-1.5 text-xs font-medium text-emerald-100">
				Access verified
			</div>
		</header>
	);
}
