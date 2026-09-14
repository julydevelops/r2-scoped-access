import type { Identity, ResolvedGrant } from "./domain/policy";
import type { AuditFn } from "./middleware/audit";

/**
 * Everything the middleware chain establishes before a route handler runs.
 *
 * `identity` and `grants` are non-optional because no route is reachable
 * without passing through the identity middleware. A handler therefore cannot
 * accidentally read an unauthenticated context.
 */
export interface AppVariables {
	requestId: string;
	identity: Identity;
	grants: ResolvedGrant[];
	audit: AuditFn;
}

export interface AppEnv {
	Bindings: Env;
	Variables: AppVariables;
}
