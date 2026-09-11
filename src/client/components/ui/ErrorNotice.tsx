interface ErrorNoticeProps {
	error: string;
}

export function ErrorNotice({ error }: ErrorNoticeProps): React.JSX.Element {
	return (
		<div
			className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100"
			role="alert"
		>
			<p className="font-semibold">Request failed</p>
			<p className="mt-1 text-rose-100/75">{error}</p>
		</div>
	);
}
