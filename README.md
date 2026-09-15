# R2 Access Broker

A deploy-your-own Cloudflare Worker that gives people short-lived, least-privilege access to R2 without assigning account-wide R2 roles.

Users authenticate through Cloudflare Access, browse only the prefixes granted by policy, and can issue temporary S3 credentials for CLI or SDK work. Credential issuance and browser-mediated object activity are written to D1.

> [!IMPORTANT]
> This is a reference implementation, not a native R2 IAM feature. It governs the S3 API path it provides. It does not restrict R2 bindings, public bucket URLs, existing API tokens, or users who retain broad R2 or Workers deployment permissions.

## Why this exists

Cloudflare account roles grant `Cloudflare R2 Read` or `Cloudflare R2 Admin` across every bucket. R2 API tokens can be limited to specific buckets, and temporary credentials can narrow that authority further to explicit S3 actions and object prefixes.

This project combines those primitives into a governed access path for human users:

- Cloudflare Access supplies the authenticated email and identity-provider groups.
- `policy.json` maps those identities to bucket and prefix grants.
- A bucket-scoped parent R2 token signs short-lived child credentials.
- R2 enforces the child credential's bucket, actions, prefixes, and expiry.
- D1 records who requested which capability and when.

## Architecture

```text
Browser
  -> hostname-based Cloudflare Access
  -> React application on Workers Static Assets
  -> /api/* Worker
       -> verify Access JWT
       -> evaluate policy
       -> sign temporary R2 credential
       -> R2 S3 API
       -> D1 audit log
```

The production deployment uses a hostname-based Access application. Workers Static Assets run behind an internal router that does not propagate `ctx.access` to the Worker, so API routes verify the Access assertion using `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. Local development uses Wrangler's simulated `ctx.access` identity.

See [Architecture](docs/architecture.md) and [Threat model](docs/threat-model.md) before using this with sensitive data.

## Security properties

- Deny by default: no matching email or group means no grants.
- One parent token per trust domain limits the impact of a policy bug.
- Child credentials cannot exceed their parent's bucket or permission scope.
- Read-only is the credential UI default.
- Write does not include delete unless policy allows it and the user explicitly requests it.
- Credential responses and downloads are marked `no-store`.
- Objects always download as attachments and cannot render active content on the application origin.
- The D1 audit binding is required. Credential responses are withheld if their audit event cannot be stored.
- Revoking a parent token invalidates every child derived from it.

Temporary credentials remain bearer tokens. Anyone holding all three credential values can use their granted authority until expiry.

## Stack

- Cloudflare Workers and Workers Static Assets
- Hono for API routing and middleware, Zod for request contracts
- React 19, Vite, and Tailwind CSS
- Cloudflare Access for identity
- R2 temporary credentials with local JWT signing
- D1 for audit records
- TypeScript and Vitest

## Quick start

Prerequisites: Node.js 22, an R2-enabled Cloudflare account, Zero Trust, and an identity provider connected to Access.

```sh
npm install
```

1. Copy `policy.example.json` to `policy.json`, then edit your trust domains, roles, and assignments. `policy.json` is untracked because it names real identity-provider groups and bucket prefixes.
2. Create one account-owned R2 token per trust domain. Use `Object Read & Write` and scope it only to that domain's buckets.
3. Create a D1 database and replace the placeholder `database_id` in `wrangler.jsonc`.
4. Replace the account and Access placeholders in `wrangler.jsonc`.
5. Set each `PARENT_<DOMAIN>_AKID` and `PARENT_<DOMAIN>_SECRET` with `wrangler secret put`.
6. Protect the deployment hostname with a self-hosted Cloudflare Access application.
7. Apply migrations and deploy.

```sh
npm run db:migrate
npm run deploy
```

The complete procedure and acceptance checklist are in [Deployment](docs/deployment.md).

## Local development

Copy `policy.example.json` to `policy.json` and `.dev.vars.example` to `.dev.vars`, add development parent credentials, and set the bucket-owning account ID in `wrangler.dev.jsonc`. Then run the API and client in separate terminals:

```sh
npm run db:migrate:local
npm run dev:api
```

```sh
npm run dev
```

Vite serves the client at `http://localhost:5173` and proxies `/api` to Wrangler at `http://localhost:8787`. Change the simulated identity in `wrangler.dev.jsonc` to test other policy assignments.

## Import existing account members

Use the account-member importer to bootstrap direct email assignments. It performs a dry run unless `--write` is present and requires you to choose existing app roles explicitly:

```sh
export CLOUDFLARE_ACCOUNT_ID=<ACCOUNT_ID>
export CLOUDFLARE_API_TOKEN=<API_TOKEN_WITH_MEMBER_READ_ACCESS>
npm run policy:import-members -- --roles research-reader
```

Review the proposed emails, then update the policy. The write command fetches the members again, prints the exact write set, and requires typing `yes` before changing the file:

```sh
npm run policy:import-members -- --roles research-reader --write
npm test
npm run deploy
```

The importer reads accepted Cloudflare account members. It checks for concurrent policy edits immediately before replacement and fails if an API member lacks an email. It does not translate broad dashboard roles into bucket or prefix grants, alter group assignments, modify existing email assignments, remove departed users, or deploy. Prefer IdP group assignments for ongoing access management; use direct email imports for migration and exceptions. See [Deployment](docs/deployment.md#import-existing-account-members) for options and the rollout sequence.

## Commands

```sh
npm run dev             # React client with /api proxy
npm run dev:api         # Worker with local Access identity and D1
npm test                # unit and route tests
npm run typecheck       # strict TypeScript
npm run types:check     # generated Worker binding types
npm run policy:import-members -- --help
npm run build           # production client build
npm run db:migrate      # apply remote D1 migrations
npm run deploy          # build and deploy
```

## Project layout

| Path | Purpose |
| --- | --- |
| `src/client/` | React application and API client |
| `src/shared/` | Browser-safe API contracts |
| `src/worker/index.ts` | Worker entry point |
| `src/worker/app.ts` | Hono app: middleware order, route mounting, error mapping |
| `src/worker/middleware/` | Request id, policy guard, identity, audit context |
| `src/worker/routes/` | Route handlers and request schemas |
| `src/worker/broker/` | Authorize, mint, and audit in one enforcement point |
| `src/worker/auth/` | Cloudflare Access identity resolution |
| `src/worker/domain/` | Policy validation and authorization |
| `src/worker/services/` | R2, temporary credentials, and audit services |
| `src/worker/config/` | Policy loading, parent token lookup, request limits |
| `src/worker/http/` | Response headers, error mapping, body validation |
| `migrations/` | Versioned D1 schema |
| `docs/` | Architecture, deployment, operations, and threat model |

The Worker is layered so each direction of dependency is one-way. `domain/`
holds pure policy logic with no I/O. `services/` wraps the outside world: R2,
D1, and credential signing. `broker/` composes them into the single
authorize-mint-audit sequence every data route runs. `routes/` only parses
input and shapes responses, and imports nothing from `services/` that it does
not go through `broker/` to reach.

## Current limits

- One credential is bound to one bucket.
- All buckets must currently belong to one Cloudflare account.
- Browser listings are paginated in batches of 200.
- Browser uploads are limited to 100 MB. Use temporary S3 credentials for larger objects.
- Policy changes require a deployment.
- This release supports human Access identities, not Access service-token principals.
- Child credentials cannot be revoked individually. Revoke the parent token to invalidate the domain.
- D1 records broker activity, not subsequent S3 requests made directly with issued credentials.
- This release supports only buckets in R2's default jurisdiction.

## License

Apache-2.0. See [LICENSE](LICENSE).
