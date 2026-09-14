import policyDocument from "../../../policy.json";
import { validatePolicy, type Policy } from "../domain/policy";

/**
 * The policy document is validated once at module load rather than per request.
 *
 * A malformed policy is a deployment fault, so it must fail loudly and
 * uniformly instead of producing a different error depending on which route was
 * hit first. Validation cannot throw at module scope, because that would make
 * the Worker fail to start with no route able to explain why, so the failure is
 * captured and reported by `policyGuard`.
 */

export const policy = policyDocument as Policy;

export const policyValidationError: string | null = (() => {
	try {
		validatePolicy(policy);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
})();
