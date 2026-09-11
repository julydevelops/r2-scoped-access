import { describe, expect, it } from "vitest";
import { mergeMemberAssignments, type PolicyAssignment } from "../scripts/import-members-core";

describe("account member policy import", () => {
	it("adds normalized, deduplicated email assignments in stable order", () => {
		const result = mergeMemberAssignments(
			[{ group: "Research", roles: ["research-reader"] }],
			[" Z@example.com ", "a@example.com", "A@example.com"],
			["production-reader"],
		);

		expect(result.added).toEqual([
			{ email: "a@example.com", roles: ["production-reader"] },
			{ email: "z@example.com", roles: ["production-reader"] },
		]);
		expect(result.assignments[0]).toEqual({ group: "Research", roles: ["research-reader"] });
	});

	it("preserves and skips existing direct email assignments case-insensitively", () => {
		const assignments: PolicyAssignment[] = [
			{ email: "Existing@Example.com", roles: ["research-reader"] },
		];
		const result = mergeMemberAssignments(assignments, ["existing@example.com"], ["production-reader"]);

		expect(result.assignments).toEqual(assignments);
		expect(result.added).toEqual([]);
		expect(result.skippedEmails).toEqual(["existing@example.com"]);
	});
});
