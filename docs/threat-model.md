# Threat model

## Goal

Allow authenticated people to browse authorized R2 prefixes and obtain short-lived S3 credentials without granting them account-wide R2 roles or long-lived R2 API tokens.

## Trust boundaries

- Cloudflare Access authenticates users and supplies email and groups.
- The Worker evaluates application policy and holds parent token secrets.
- R2 enforces child credential scope.
- D1 stores the application audit trail.
- A trust domain's parent token is the containment boundary for its buckets.

## Protected against

- An authenticated user requesting a bucket or prefix not granted by policy.
- A read grant being used to write or delete objects.
- A normal write grant silently including permanent deletion.
- A child credential exceeding the parent token's bucket or permission scope.
- Path traversal and control characters being signed into a credential.
- R2 object content executing as HTML on the application origin.
- Credentials being stored in browser persistence or HTTP caches by this application.
- Non-auditors reading other principals' audit rows.

## Not protected against

- A user who retains `Cloudflare R2 Admin` or `Cloudflare R2 Read` account roles.
- A user who can deploy a Worker with an R2 binding to a sensitive bucket.
- Existing account-owned or user-owned R2 API tokens.
- Public `r2.dev` URLs or custom domains.
- Presigned URLs issued before access is removed.
- Compromise of a parent token, Worker secret access, Access administrator, or Cloudflare account administrator.
- A compromised endpoint stealing temporary credentials from clipboard or process environment.
- Complete per-request auditing after temporary credentials leave the broker.

The Cloudflare account is the hard isolation boundary for Worker bindings. Put sensitive buckets in a separate account if people who deploy Workers must be unable to bind them.

## Security assumptions

- Every parent token is account-owned, uses `Object Read & Write`, and is scoped only to its trust domain's buckets.
- Broad R2 roles are removed from users routed through this application.
- Workers deployment rights are treated as equivalent to access to every bound resource in the account.
- Access uses a trusted identity provider and a session duration appropriate to the organization.
- Policy assignments use stable group identifiers, such as group email addresses where available.
- Parent credentials never leave Worker secrets.
- D1 retention and export policies meet the adopter's audit requirements.

## Failure behavior

- Missing or invalid Access identity returns `401`.
- A policy denial returns `403`.
- A revoked parent credential is distinguished from a policy denial.
- Missing parent secrets or unavailable audit storage return `503`.
- Unexpected failures return a generic `500` with a request ID, while details remain in Workers Logs.

## Rollout checklist

- Remove broad R2 roles for governed users.
- Inventory and revoke unnecessary R2 API tokens.
- Disable public access on non-public buckets.
- Restrict Workers deployment permissions.
- Test cross-domain denial in both directions.
- Test read, write, delete, prefix, TTL, and parent-revocation behavior.
- Verify non-auditor and auditor log visibility.
