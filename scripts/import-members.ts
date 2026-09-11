import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { mergeMemberAssignments, type PolicyAssignment } from "./import-members-core.ts";

interface Options {
	accountId: string;
	policyPath: string;
	roles: string[];
	status: "accepted" | "pending" | "all";
	write: boolean;
}

interface PolicyDocument {
	version: unknown;
	roles: Record<string, unknown>;
	assignments: PolicyAssignment[];
	[key: string]: unknown;
}

const HELP = `Import Cloudflare account members into policy.json as direct email assignments.

Usage:
  npm run policy:import-members -- --roles <role[,role...]> [options]

Options:
  --roles <names>       App roles to assign to each newly imported member (required)
  --account-id <id>     Cloudflare account ID; defaults to CLOUDFLARE_ACCOUNT_ID or CF_ACCOUNT_ID
  --policy <path>       Policy file to read and optionally update (default: policy.json)
  --status <status>     accepted, pending, or all (default: accepted)
  --write               Confirm and atomically update the policy; otherwise perform a dry run
  --help                 Show this help

Authentication:
  Set CLOUDFLARE_API_TOKEN to an API token that can list account members.
`;

function takeValue(args: string[], index: number, flag: string): string {
	const value = args[index + 1];
	if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
	return value;
}

function parseOptions(args: string[], env: NodeJS.ProcessEnv): Options | null {
	let accountId = env["CLOUDFLARE_ACCOUNT_ID"] ?? env["CF_ACCOUNT_ID"] ?? "";
	let policyPath = "policy.json";
	let roles: string[] = [];
	let status: Options["status"] = "accepted";
	let write = false;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--help":
				return null;
			case "--write":
				write = true;
				break;
			case "--account-id":
				accountId = takeValue(args, index, arg);
				index += 1;
				break;
			case "--policy":
				policyPath = takeValue(args, index, arg);
				index += 1;
				break;
			case "--roles":
				roles = takeValue(args, index, arg).split(",").map((role) => role.trim()).filter((role) => role !== "");
				index += 1;
				break;
			case "--status": {
				const value = takeValue(args, index, arg);
				if (value !== "accepted" && value !== "pending" && value !== "all") {
					throw new Error("--status must be accepted, pending, or all");
				}
				status = value;
				index += 1;
				break;
			}
			default:
				throw new Error(`unknown option: ${arg}`);
		}
	}

	if (!/^[a-f0-9]{32}$/i.test(accountId)) {
		throw new Error("set a valid account ID with --account-id, CLOUDFLARE_ACCOUNT_ID, or CF_ACCOUNT_ID");
	}
	if (roles.length === 0) throw new Error("--roles must name at least one app role");
	return { accountId, policyPath: resolve(policyPath), roles: [...new Set(roles)], status, write };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePolicy(input: string): PolicyDocument {
	const parsed: unknown = JSON.parse(input);
	if (!isRecord(parsed) || !isRecord(parsed["roles"]) || !Array.isArray(parsed["assignments"])) {
		throw new Error("policy must define a roles object and assignments array");
	}
	for (const assignment of parsed["assignments"]) {
		if (!isRecord(assignment) || !Array.isArray(assignment["roles"]) || !assignment["roles"].every((role) => typeof role === "string")) {
			throw new Error("policy contains an invalid assignment");
		}
	}
	return parsed as PolicyDocument;
}

function apiErrors(value: unknown): string {
	if (!Array.isArray(value)) return "unknown API error";
	const messages = value.flatMap((error) => isRecord(error) && typeof error["message"] === "string" ? [error["message"]] : []);
	return messages.join("; ") || "unknown API error";
}

function memberEmail(value: unknown, page: number): string {
	if (!isRecord(value)) throw new Error(`member page ${page} contains a malformed entry`);
	if (typeof value["email"] === "string") return value["email"];
	const user = value["user"];
	if (isRecord(user) && typeof user["email"] === "string") return user["email"];
	const id = typeof value["id"] === "string" ? value["id"] : "unknown ID";
	throw new Error(`account member ${id} on page ${page} has no email; no policy was changed`);
}

async function listMemberEmailsForStatus(accountId: string, token: string, status: "accepted" | "pending"): Promise<string[]> {
	const emails: string[] = [];
	for (let page = 1; ; page += 1) {
		const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/members`);
		url.searchParams.set("page", String(page));
		url.searchParams.set("per_page", "50");
		url.searchParams.set("order", "user.email");
		url.searchParams.set("direction", "asc");
		url.searchParams.set("status", status);

		const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
		const body: unknown = await response.json().catch(() => null);
		const result = isRecord(body) ? body["result"] : undefined;
		if (!response.ok || !isRecord(body) || body["success"] !== true || (result !== null && !Array.isArray(result))) {
			const errors = isRecord(body) ? apiErrors(body["errors"]) : `HTTP ${response.status}`;
			throw new Error(`Cloudflare member lookup failed: ${errors}`);
		}

		const members = result ?? [];
		for (const member of members) {
			if (isRecord(member) && typeof member["status"] === "string" && member["status"] !== status) {
				throw new Error(`Cloudflare returned a ${member["status"]} member while filtering for ${status}`);
			}
			const email = memberEmail(member, page);
			if (email === "") throw new Error(`member page ${page} contains an empty email; no policy was changed`);
			emails.push(email);
		}
		if (members.length < 50) break;
	}
	return emails;
}

async function listMemberEmails(accountId: string, token: string, status: Options["status"]): Promise<string[]> {
	if (status !== "all") return listMemberEmailsForStatus(accountId, token, status);
	const accepted = await listMemberEmailsForStatus(accountId, token, "accepted");
	const pending = await listMemberEmailsForStatus(accountId, token, "pending");
	return [...accepted, ...pending];
}

async function confirmWrite(): Promise<boolean> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error("--write requires an interactive terminal so the exact assignments can be confirmed");
	}
	const prompt = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return (await prompt.question('Type "yes" to write these exact assignments: ')).trim().toLowerCase() === "yes";
	} finally {
		prompt.close();
	}
}

async function writePolicy(path: string, policy: PolicyDocument, original: string): Promise<void> {
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	const file = await stat(path);
	try {
		await writeFile(temporaryPath, `${JSON.stringify(policy, null, "\t")}\n`, { flag: "wx", mode: file.mode & 0o777 });
		if (await readFile(path, "utf8") !== original) {
			throw new Error("policy changed during the import; review it and run the command again");
		}
		await rename(temporaryPath, path);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

export async function main(args = process.argv.slice(2), env = process.env): Promise<void> {
	const options = parseOptions(args, env);
	if (options === null) {
		process.stdout.write(HELP);
		return;
	}
	const token = env["CLOUDFLARE_API_TOKEN"];
	if (token === undefined || token === "") throw new Error("CLOUDFLARE_API_TOKEN is required");

	const originalPolicy = await readFile(options.policyPath, "utf8");
	const policy = parsePolicy(originalPolicy);
	const unknownRoles = options.roles.filter((role) => !Object.hasOwn(policy.roles, role));
	if (unknownRoles.length > 0) throw new Error(`unknown app role(s): ${unknownRoles.join(", ")}`);

	const emails = await listMemberEmails(options.accountId, token, options.status);
	const result = mergeMemberAssignments(policy.assignments, emails, options.roles);
	const statusLabel = options.status === "all" ? "accepted or pending" : options.status;
	process.stdout.write(`Fetched ${emails.length} ${statusLabel} account member(s).\n`);
	process.stdout.write(`New assignments: ${result.added.length}; existing email assignments skipped: ${result.skippedEmails.length}.\n`);
	for (const assignment of result.added) process.stdout.write(`  + ${assignment.email} -> ${assignment.roles.join(", ")}\n`);

	if (!options.write) {
		process.stdout.write("Dry run only. Repeat with --write to fetch and confirm the exact write set.\n");
		return;
	}
	if (result.added.length === 0) {
		process.stdout.write("No new assignments to write.\n");
		return;
	}
	if (!await confirmWrite()) {
		process.stdout.write("Cancelled; policy was not changed.\n");
		return;
	}
	policy.assignments = result.assignments;
	await writePolicy(options.policyPath, policy, originalPolicy);
	process.stdout.write(`Updated ${options.policyPath}. Validate and deploy the policy before removing dashboard R2 roles.\n`);
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
	main().catch((error: unknown) => {
		process.stderr.write(`Policy import failed: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
