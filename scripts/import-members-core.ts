export interface PolicyAssignment {
	email?: string;
	group?: string;
	roles: string[];
}

export interface MergeResult {
	assignments: PolicyAssignment[];
	added: PolicyAssignment[];
	skippedEmails: string[];
}

export function mergeMemberAssignments(
	assignments: readonly PolicyAssignment[],
	emails: readonly string[],
	roles: readonly string[],
): MergeResult {
	const existingEmails = new Set(
		assignments.flatMap((assignment) => assignment.email === undefined ? [] : [assignment.email.toLowerCase()]),
	);
	const candidates = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter((email) => email !== ""))].sort();
	const added: PolicyAssignment[] = [];
	const skippedEmails: string[] = [];

	for (const email of candidates) {
		if (existingEmails.has(email)) {
			skippedEmails.push(email);
			continue;
		}
		added.push({ email, roles: [...roles] });
	}

	return { assignments: [...assignments, ...added], added, skippedEmails };
}
