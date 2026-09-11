export type BadgeTone = "neutral" | "read" | "write" | "danger";

const toneClasses: Record<BadgeTone, string> = {
	neutral: "border-white/12 bg-white/5 text-slate-300",
	read: "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
	write: "border-amber-300/25 bg-amber-300/10 text-amber-100",
	danger: "border-rose-300/25 bg-rose-300/10 text-rose-100",
};

interface BadgeProps {
	children: React.ReactNode;
	tone?: BadgeTone;
}

export function Badge({ children, tone = "neutral" }: BadgeProps): React.JSX.Element {
	return (
		<span
			className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${toneClasses[tone]}`}
		>
			{children}
		</span>
	);
}
