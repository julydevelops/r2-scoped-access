# AGENTS.md

Instructions for AI coding agents working on this codebase.

## Project Overview

R2 Access Broker is a deploy-your-own Cloudflare Worker that provides short-lived, least-privilege R2 access without granting account-wide R2 roles. Users authenticate via Cloudflare Access, receive only the prefixes allowed by policy, and can issue temporary S3 credentials for CLI/SDK use. All activity is audited to D1.

This is a reference implementation, not a native R2 IAM feature. It governs one S3 API path; it does not restrict R2 bindings, public bucket URLs, existing API tokens, or users with broad deployment permissions.

## Architecture

```
Browser
  -> hostname-based Cloudflare Access
  -> React app on Workers Static Assets
  -> /api/* Worker
       -> verify Access JWT
       -> evaluate policy.json
       -> sign temporary R2 credential (local JWT)
       -> R2 S3 API
       -> D1 audit log
```

Key constraint: Workers Static Assets do not propagate `ctx.access`, so API routes verify the Access assertion using `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` environment variables.

## Tech Stack

- Cloudflare Workers with Workers Static Assets
- Hono for API routing and middleware
- Zod for request validation (`@hono/zod-validator`)
- React 19, Vite, Tailwind CSS (client)
- Cloudflare Access for identity
- R2 temporary credentials via local JWT signing
- D1 for audit records
- TypeScript, Vitest

## Worker Layering

Dependencies run one way only. Do not introduce an import that reverses one of
these arrows.

```
routes/  ->  broker/  ->  services/  ->  (R2, D1, crypto)
   |            |
   |            +------>  domain/     (pure, no I/O)
   |
   +---------->  http/, config/, middleware/
```

- `domain/` is pure policy logic: validation, grant resolution, authorization,
  action lists, TTL clamping. No I/O, no framework types.
- `services/` are adapters over the outside world. They do not make policy
  decisions.
- `broker/` is the single policy enforcement point. Every route that touches R2
  goes through it, which is what keeps authorize, mint, and audit inseparable.
- `routes/` parse input and shape responses. A route must not call
  `mintCredentials` or `parentFor` directly.
- `middleware/` establishes request id, policy validity, identity, grants, and
  the bound audit writer before any handler runs.

## Key Files

| Path | Purpose |
|------|---------|
| `src/worker/index.ts` | Worker entry point, ~20 lines |
| `src/worker/app.ts` | Hono app: middleware order, route mounting, `onError`, `notFound` |
| `src/worker/types.ts` | `AppEnv` bindings and context variables |
| `src/worker/middleware/` | Request id, policy guard, identity, audit context |
| `src/worker/routes/` | Route handlers, one module per resource |
| `src/worker/routes/schemas.ts` | Zod request contracts and their error messages |
| `src/worker/broker/scoped-credential.ts` | Authorize, clamp TTL, mint, audit |
| `src/worker/config/policy.ts` | Policy load and boot-time validation result |
| `src/worker/config/parent-tokens.ts` | `PARENT_<ID>_*` secret lookup, `ConfigError` |
| `src/worker/config/limits.ts` | Body, upload, page size, and inline TTL bounds |
| `src/worker/http/responses.ts` | `json()`, `downloadHeaders()`, private headers |
| `src/worker/http/errors.ts` | `RequestError` and the error-to-status mapper |
| `src/worker/http/validation.ts` | Body limit, JSON body guard, schema error hook |
| `src/worker/auth/access.ts` | Cloudflare Access JWT verification |
| `src/worker/domain/policy.ts` | Policy validation, grant resolution, authorization |
| `src/worker/services/temp-credentials.ts` | R2 temporary credential minting via local JWT |
| `src/worker/services/audit.ts` | D1 audit write and scoped read |
| `src/worker/services/r2.ts` | R2 S3 API operations |
| `src/client/` | React application |
| `src/shared/` | Browser-safe API contracts |
| `policy.json` | Trust domains, roles, grants, assignments |
| `wrangler.jsonc` | Production Worker configuration |
| `wrangler.dev.jsonc` | Local development configuration |
| `migrations/` | D1 schema migrations |

## Policy Model

The policy is deny-by-default. Key concepts:

1. **Trust Domain**: owns a set of buckets and exactly one parent R2 token. Child credentials cannot exceed the parent's bucket scope. Configured in `policy.domains`.

2. **Role**: a named set of grants. Each grant specifies bucket, prefixes, permission (read/write), maxTtlSeconds, and optionally allowDelete. Configured in `policy.roles`.

3. **Assignment**: maps an email or Access group to roles. Configured in `policy.assignments`.

4. **Auditors**: groups/emails that may read audit logs for all principals. Everyone else sees only their own rows. Configured in `policy.auditors`.

## R2 Temporary Credentials

This project uses local JWT signing to mint R2 temporary credentials. This allows explicit S3 action lists, including write credentials that deliberately omit deletion.

Key functions in `src/worker/services/temp-credentials.ts`:
- `mintCredentials()`: signs a JWT with the parent token's secret to create child credentials
- Actions are explicit (`GetObject`, `PutObject`, etc.), not coarse scopes

Cloudflare docs: https://developers.cloudflare.com/r2/api/s3/temporary-credentials/

## Commands

```sh
npm run dev             # React client with /api proxy
npm run dev:api         # Worker with local Access identity and D1
npm test                # unit and route tests (Vitest)
npm run typecheck       # strict TypeScript
npm run types:check     # generated Worker binding types
npm run build           # production client build
npm run db:migrate      # apply remote D1 migrations
npm run db:migrate:local # apply local D1 migrations
npm run deploy          # build and deploy
npm run policy:import-members -- --roles <role> [--write]
```

## Development Workflow

1. Copy `policy.example.json` to `policy.json` (untracked deployment data) and `.dev.vars.example` to `.dev.vars`, then add development parent credentials
2. Set the bucket-owning account ID in `wrangler.dev.jsonc`
3. Run `npm run db:migrate:local` to set up local D1
4. Start the API: `npm run dev:api` (port 8787)
5. Start the client: `npm run dev` (port 5173, proxies /api to 8787)
6. Edit identity in `wrangler.dev.jsonc` to test different policy assignments

## Testing

All tests are in `test/`. Run with `npm test`.

Tests cover:
- Policy validation edge cases (`policy.test.ts`)
- Grant resolution and authorization logic (`access.test.ts`)
- Access assertion verification (`access-hostname.test.ts`)
- Credential minting (`temp-credentials.test.ts`)
- Credential issuance routes (`credential-route.test.ts`)
- Browsing and object transfer routes (`object-route.test.ts`)
- Audit read scoping and its SQL projection (`audit-route.test.ts`)
- Audit write durability (`audit.test.ts`)
- Error-to-status mapping and response headers (`error-mapping.test.ts`, `worker-response.test.ts`)
- Import script logic (`import-members.test.ts`)

When modifying authorization or credential logic, ensure tests pass before deploying.

## Security Considerations

1. **Deny by default**: no matching email/group means no grants
2. **Parent token containment**: child credentials cannot exceed parent's bucket or permission scope
3. **Delete is opt-in**: `allowDelete` must be explicitly set; write grants do not include delete by default
4. **Audit required**: credential responses are withheld if the audit event cannot be stored
5. **No-store headers**: credential responses and downloads are marked `no-store`
6. **Attachment downloads**: objects download as attachments, never render active content on the app origin
7. **Path normalization**: traversal and control characters are rejected before signing

## Cloudflare Documentation References

Always check the latest Cloudflare docs for API changes:

- R2 Temporary Credentials: https://developers.cloudflare.com/r2/api/s3/temporary-credentials/
- R2 API Tokens: https://developers.cloudflare.com/r2/api/tokens/
- D1 Worker API: https://developers.cloudflare.com/d1/worker-api/
- D1 Migrations: https://developers.cloudflare.com/d1/reference/migrations/
- Workers Configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
- Cloudflare Access: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

## Common Tasks

### Adding a new bucket

1. Add the bucket to the appropriate domain in `policy.json`
2. Ensure the parent token for that domain has access to the bucket
3. Create roles with grants for the bucket
4. Assign roles to groups/emails
5. Run tests and deploy

### Modifying grant permissions

1. Edit the role in `policy.json`
2. `allowDelete` is separate from write permission
3. `maxTtlSeconds` caps credential lifetime (max 604800 = 7 days)
4. Run tests to validate policy structure

### Adding an API route

1. Add the handler to the matching module in `src/worker/routes/`, or create a
   new one and mount it in `src/worker/app.ts`
2. Identity, grants, request id, and the audit writer are already on the
   context: read `c.var.identity`, `c.var.grants`, `c.var.requestId`,
   `c.var.audit`. Do not call `resolveIdentity()` or `resolveGrants()` again
3. If the route touches R2, call `mintForPath()` or `mintForBucket()` from
   `src/worker/broker/scoped-credential.ts`. Never call `mintCredentials()` or
   `parentFor()` from a route: the broker is what guarantees the denial, the
   TTL clamp, and the audit record all happen
4. Validate input with a Zod schema in `src/worker/routes/schemas.ts` and the
   `firstIssue` hook, so failures return the standard error envelope
5. Type the response against `src/shared/api-types.ts` with `satisfies`, so a
   server change that breaks the client fails the typecheck
6. Throw for failures rather than building error responses. `app.onError` owns
   the error-to-status mapping
7. Add tests in `test/`

### Adding a new kind of error

Add the class next to the code that throws it, then add one branch to
`toErrorResponse` in `src/worker/http/errors.ts` and one assertion to
`test/error-mapping.test.ts`. Do not map statuses inside a route.

### Debugging credential issues

1. Check the audit log (D1) for denied actions and details
2. Verify the parent token has the required bucket permissions
3. Confirm the policy assignment matches the Access identity (email/groups)
4. Check that prefixes in the grant cover the requested path
