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
- React 19, Vite, Tailwind CSS (client)
- Cloudflare Access for identity
- R2 temporary credentials via local JWT signing
- D1 for audit records
- TypeScript, Vitest

## Key Files

| Path | Purpose |
|------|---------|
| `src/worker/index.ts` | API routes and response security |
| `src/worker/auth/access.ts` | Cloudflare Access JWT verification |
| `src/worker/domain/policy.ts` | Policy validation, grant resolution, authorization |
| `src/worker/services/temp-credentials.ts` | R2 temporary credential minting via local JWT |
| `src/worker/services/audit.ts` | D1 audit logging |
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

1. Copy `.dev.vars.example` to `.dev.vars` and add development parent credentials
2. Set the bucket-owning account ID in `wrangler.dev.jsonc`
3. Run `npm run db:migrate:local` to set up local D1
4. Start the API: `npm run dev:api` (port 8787)
5. Start the client: `npm run dev` (port 5173, proxies /api to 8787)
6. Edit identity in `wrangler.dev.jsonc` to test different policy assignments

## Testing

All tests are in `test/`. Run with `npm test`.

Tests cover:
- Policy validation edge cases
- Grant resolution and authorization logic
- Credential minting
- API route behavior
- Import script logic

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

1. Add the route handler in `src/worker/index.ts`
2. Use `resolveIdentity()` for authentication
3. Use `resolveGrants()` and `authorize()` for authorization
4. Always call `audit()` for granted and denied actions
5. Return responses via the `json()` helper for consistent headers
6. Add tests in `test/`

### Debugging credential issues

1. Check the audit log (D1) for denied actions and details
2. Verify the parent token has the required bucket permissions
3. Confirm the policy assignment matches the Access identity (email/groups)
4. Check that prefixes in the grant cover the requested path
