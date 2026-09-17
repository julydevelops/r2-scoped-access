import { describe, expect, it } from "vitest";
import { deploymentConfigIssues } from "../scripts/check-deploy-config";

const policy = JSON.stringify({
	version: 1,
	domains: [{ id: "RESEARCH", buckets: ["research-data"] }],
	roles: {
		reader: [{ bucket: "research-data", prefixes: ["datasets/"], permission: "read", maxTtlSeconds: 900 }],
	},
	assignments: [{ group: "Research", roles: ["reader"] }],
});

const configured = `{
	"name": "r2-scoped-access",
	"alias": { "policy-document": "./policy.json" },
	"workers_dev": true,
	"vars": {
		"CF_ACCOUNT_ID": "11111111111111111111111111111111",
		"ACCESS_TEAM_DOMAIN": "example.cloudflareaccess.com",
		"ACCESS_AUD": "application-audience"
	},
	"secrets": { "required": ["PARENT_RESEARCH_AKID", "PARENT_RESEARCH_SECRET"] },
	"d1_databases": [{
		"binding": "AUDIT_DB",
		"database_id": "11111111-1111-1111-1111-111111111111",
	}],
}`;

describe("deployment configuration preflight", () => {
	it("accepts configured JSONC and a valid policy", () => {
		expect(deploymentConfigIssues(`// deployment\n${configured}`, policy)).toEqual([]);
	});

	it("does not accept a required alias that exists only in a comment", () => {
		const wrongAlias = configured.replace(
			'"alias": { "policy-document": "./policy.json" },',
			'"alias": { "policy-document": "./policy.example.json" }, // "policy-document": "./policy.json"',
		);
		expect(deploymentConfigIssues(wrongAlias, policy)).toContain('set alias.policy-document to "./policy.json"');
	});

	it("rejects missing runtime configuration and policy", () => {
		expect(deploymentConfigIssues("{}", null)).toEqual([
			"set vars.CF_ACCOUNT_ID to a 32-character account ID",
			"set vars.ACCESS_TEAM_DOMAIN to a cloudflareaccess.com team domain",
			"set vars.ACCESS_AUD to the Access application audience",
			'set alias.policy-document to "./policy.json"',
			"configure the AUDIT_DB binding with a non-placeholder database ID",
			"enable workers_dev or configure a non-example route",
			"create policy.json from policy.example.json",
		]);
	});

	it("validates policy structure and parent secret declarations", () => {
		expect(deploymentConfigIssues(configured, '{ "version": 2 }')).toContain(
			"validate policy.json: policy version must be 1",
		);
		const withoutSecrets = configured.replace('"PARENT_RESEARCH_SECRET"', '"UNRELATED_SECRET"');
		expect(deploymentConfigIssues(withoutSecrets, policy)).toContain(
			"declare PARENT_RESEARCH_SECRET in secrets.required",
		);
	});
});
