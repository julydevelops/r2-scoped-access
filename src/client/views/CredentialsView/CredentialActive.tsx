import { useState } from "react";
import type { CredentialResponse } from "../../../shared/api-types";
import { formatDuration } from "../../utils";

interface CredentialActiveProps {
	credential: CredentialResponse;
	remaining: number;
	onClear: () => void;
}

export function CredentialActive({ credential, remaining, onClear }: CredentialActiveProps): React.JSX.Element {
	const [tab, setTab] = useState<"cli" | "sdk">("cli");
	const [copied, setCopied] = useState<string | null>(null);

	const sdkExample = `const client = new S3Client({
  region: "auto",
  endpoint: "${credential.endpoint}",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  },
});`;

	async function copy(label: string, value: string): Promise<void> {
		await navigator.clipboard.writeText(value);
		setCopied(label);
		window.setTimeout(() => setCopied(null), 1500);
	}

	const snippet = tab === "cli" ? credential.shell : sdkExample;

	return (
		<div>
			<div className="flex items-start justify-between gap-3">
				<div>
					<p className="section-title text-emerald-200">Credential active</p>
					<p className="mt-2 font-display text-3xl text-white">{formatDuration(remaining)}</p>
				</div>
				<button type="button" className="text-xs text-slate-400 underline" onClick={onClear}>
					Clear now
				</button>
			</div>

			<div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/8 p-3 text-xs leading-5 text-amber-100">
				Anyone who copies these values has the displayed access until expiry. They are never stored by this
				application.
			</div>

			<div className="mt-5 flex gap-2">
				<button
					type="button"
					className={`tab ${tab === "cli" ? "tab-active" : ""}`}
					onClick={() => setTab("cli")}
				>
					CLI
				</button>
				<button
					type="button"
					className={`tab ${tab === "sdk" ? "tab-active" : ""}`}
					onClick={() => setTab("sdk")}
				>
					SDK
				</button>
			</div>

			<pre className="code-block mt-3">{snippet}</pre>

			<button
				type="button"
				className="button-secondary mt-3 w-full"
				onClick={() => void copy(tab, snippet)}
			>
				{copied === tab ? "Copied" : `Copy ${tab.toUpperCase()} snippet`}
			</button>
		</div>
	);
}
