import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { validatePolicy, type Policy } from "../src/worker/domain/policy.ts";

const CONFIG_PATH = ".wrangler.deploy.jsonc";
const POLICY_PATH = "policy.json";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function parseJsonc(input: string): unknown {
	let output = "";
	let inString = false;
	let escaped = false;
	let lineComment = false;
	let blockComment = false;

	for (let index = 0; index < input.length; index += 1) {
		const current = input[index] ?? "";
		const next = input[index + 1] ?? "";
		if (lineComment) {
			if (current === "\n" || current === "\r") {
				lineComment = false;
				output += current;
			}
			continue;
		}
		if (blockComment) {
			if (current === "*" && next === "/") {
				blockComment = false;
				index += 1;
			} else if (current === "\n" || current === "\r") {
				output += current;
			}
			continue;
		}
		if (inString) {
			output += current;
			if (escaped) escaped = false;
			else if (current === "\\") escaped = true;
			else if (current === '"') inString = false;
			continue;
		}
		if (current === '"') {
			inString = true;
			output += current;
		} else if (current === "/" && next === "/") {
			lineComment = true;
			index += 1;
		} else if (current === "/" && next === "*") {
			blockComment = true;
			index += 1;
		} else {
			output += current;
		}
	}

	let withoutTrailingCommas = "";
	inString = false;
	escaped = false;
	for (let index = 0; index < output.length; index += 1) {
		const current = output[index] ?? "";
		if (inString) {
			withoutTrailingCommas += current;
			if (escaped) escaped = false;
			else if (current === "\\") escaped = true;
			else if (current === '"') inString = false;
			continue;
		}
		if (current === '"') inString = true;
		if (current === ",") {
			let lookahead = index + 1;
			while (/\s/.test(output[lookahead] ?? "")) lookahead += 1;
			if (output[lookahead] === "}" || output[lookahead] === "]") continue;
		}
		withoutTrailingCommas += current;
	}

	return JSON.parse(withoutTrailingCommas);
}

export function deploymentConfigIssues(configSource: string, policySource: string | null): string[] {
	const issues: string[] = [];
	let config: JsonObject;
	try {
		const parsed = object(parseJsonc(configSource));
		if (parsed === undefined) throw new Error("root must be an object");
		config = parsed;
	} catch (error) {
		return [`parse ${CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`];
	}

	const vars = object(config["vars"]);
	const accountId = vars?.["CF_ACCOUNT_ID"];
	const teamDomain = vars?.["ACCESS_TEAM_DOMAIN"];
	const audience = vars?.["ACCESS_AUD"];
	if (typeof accountId !== "string" || !/^[a-f0-9]{32}$/i.test(accountId)) issues.push("set vars.CF_ACCOUNT_ID to a 32-character account ID");
	if (typeof teamDomain !== "string" || !/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(teamDomain)) {
		issues.push("set vars.ACCESS_TEAM_DOMAIN to a cloudflareaccess.com team domain");
	}
	if (typeof audience !== "string" || audience === "" || audience.startsWith("replace-with-")) {
		issues.push("set vars.ACCESS_AUD to the Access application audience");
	}

	const aliases = object(config["alias"]);
	if (aliases?.["policy-document"] !== "./policy.json") issues.push('set alias.policy-document to "./policy.json"');

	const databases = config["d1_databases"];
	const auditDb = Array.isArray(databases)
		? databases.map(object).find((database) => database?.["binding"] === "AUDIT_DB")
		: undefined;
	if (typeof auditDb?.["database_id"] !== "string" || !/^[a-f0-9-]{36}$/i.test(auditDb["database_id"]) || auditDb["database_id"] === "00000000-0000-0000-0000-000000000000") {
		issues.push("configure the AUDIT_DB binding with a non-placeholder database ID");
	}

	const routes = config["routes"];
	const hasRoute = Array.isArray(routes) && routes.some((route) => {
		const pattern = object(route)?.["pattern"];
		return typeof pattern === "string" && pattern !== "" && pattern !== "r2-access.example.com";
	});
	if (config["workers_dev"] !== true && !hasRoute) issues.push("enable workers_dev or configure a non-example route");

	if (policySource === null) {
		issues.push(`create ${POLICY_PATH} from policy.example.json`);
		return issues;
	}

	let policy: Policy;
	try {
		policy = JSON.parse(policySource) as Policy;
		validatePolicy(policy);
	} catch (error) {
		issues.push(`validate ${POLICY_PATH}: ${error instanceof Error ? error.message : String(error)}`);
		return issues;
	}

	const requiredSecrets = object(config["secrets"])?.["required"];
	const declaredSecrets = new Set(Array.isArray(requiredSecrets) ? requiredSecrets.filter((name): name is string => typeof name === "string") : []);
	for (const domain of policy.domains) {
		for (const suffix of ["AKID", "SECRET"]) {
			const name = `PARENT_${domain.id}_${suffix}`;
			if (!declaredSecrets.has(name)) issues.push(`declare ${name} in secrets.required`);
		}
	}
	return issues;
}

async function readOptional(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}

async function main(): Promise<void> {
	const config = await readOptional(CONFIG_PATH);
	if (config === null) throw new Error(`create ${CONFIG_PATH} from wrangler.jsonc`);
	const issues = deploymentConfigIssues(config, await readOptional(POLICY_PATH));
	if (issues.length > 0) throw new Error(issues.join("; "));
	process.stdout.write(`Deployment preflight passed for ${CONFIG_PATH} and ${POLICY_PATH}.\n`);
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
	main().catch((error: unknown) => {
		process.stderr.write(`Deployment preflight failed: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
