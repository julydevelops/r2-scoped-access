# Deployment

## 1. Design trust domains

A trust domain is a set of buckets sharing one parent R2 token. Use separate domains where a policy bug must not cross a data boundary, such as research and production.

Every bucket must belong to exactly one domain. Domain IDs use letters, numbers, and underscores because they become secret-name suffixes.

## 2. Create parent tokens

For each domain, open **R2 object storage > Manage API Tokens** and create an account API token. This release supports buckets in R2's default jurisdiction; jurisdictional buckets require a different S3 endpoint and JWT audience.

- Permission: `Object Read & Write`.
- Buckets: select only the buckets in that trust domain.
- Do not choose all buckets.

Store the Access Key ID and Secret Access Key. The secret is shown once.

## 3. Configure policy

Edit `policy.json`:

```json
{
  "version": 1,
  "domains": [{ "id": "RESEARCH", "buckets": ["research-data"] }],
  "roles": {
    "research-reader": [{
      "bucket": "research-data",
      "prefixes": ["datasets/"],
      "permission": "read",
      "maxTtlSeconds": 3600
    }]
  },
  "assignments": [{
    "group": "r2-research@example.com",
    "roles": ["research-reader"]
  }]
}
```

Use `prefixes: [""]` only when a role should reach the whole bucket. `allowDelete` is valid only on a write grant and merely makes delete available. The user must still request delete explicitly.

Prefer stable identity-provider group emails over mutable display names. Group strings match exactly and fail closed when casing differs. User email assignments match case-insensitively. Direct email assignments are useful for contractors or break-glass access.

### Import existing account members

For an initial migration, the importer can fetch Cloudflare account members and append one direct email assignment per new member. Create an account-scoped API token with `Account Settings Read` and keep it in your shell environment, not in `.dev.vars` or Worker secrets:

```sh
export CLOUDFLARE_ACCOUNT_ID=<ACCOUNT_ID>
export CLOUDFLARE_API_TOKEN=<API_TOKEN_WITH_MEMBER_READ_ACCESS>
npm run policy:import-members -- --roles research-reader
```

The first run is a preview. Every proposed member receives the named app roles, so inspect the complete list before writing. The write command fetches members again, prints the exact write set, and requires typing `yes`:

```sh
npm run policy:import-members -- --roles research-reader --write
```

Use comma-separated role names to grant more than one role, for example `--roles research-reader,research-writer`. Accepted members are imported by default. Use `--status pending` to inspect pending invitations or `--status all` to include accepted and pending members; rejected members are never imported. Use `--account-id` or `--policy` to override their defaults.

The command preserves all group assignments and skips existing email assignments case-insensitively. It fails closed if a member lacks an email and checks for concurrent policy edits immediately before replacement. It never derives app roles from dashboard roles because account-level R2 permissions contain no bucket or prefix intent. It also does not remove assignments for people absent from the account. Review the resulting diff, run tests, deploy, verify app access, and only then remove broad dashboard R2 permissions.

## 4. Create D1

```sh
npx wrangler d1 create r2-scoped-access-audit
```

Replace the placeholder `database_id` in `wrangler.jsonc`, then apply migrations:

```sh
npm run db:migrate
```

Audit rows contain user email addresses plus requested bucket and object paths. Choose an appropriate D1 location, retention period, and export policy before storing production activity.

## 5. Configure Wrangler

Set these values in `wrangler.jsonc`:

- `CF_ACCOUNT_ID`: account that owns the R2 buckets.
- `ACCESS_TEAM_DOMAIN`: for example, `example.cloudflareaccess.com`.
- `ACCESS_AUD`: audience tag of the hostname-based Access application.
- `database_id`: D1 database created above.

Replace the example Worker Custom Domain route with your deployment hostname:

```jsonc
"routes": [{ "pattern": "r2-access.example.com", "custom_domain": true }]
```

## 6. Store parent secrets

The domain `RESEARCH` maps to `PARENT_RESEARCH_AKID` and `PARENT_RESEARCH_SECRET`. Keep every domain's names synchronized with `secrets.required` in both Wrangler configuration files. This declaration validates names and generates types; it does not upload secret values.

Prepare an untracked JSON file outside the repository containing all parent pairs, then upload them in one operation:

```sh
npx wrangler secret bulk /secure/path/r2-access-secrets.json
```

Use the JSON shape `{ "PARENT_RESEARCH_AKID": "...", "PARENT_RESEARCH_SECRET": "..." }`, adding both keys for every domain. Restrict access to the file and remove it after upload. Bulk upload avoids deploying a mismatched access-key and secret pair.

## 7. Configure hostname Access

Create a self-hosted Access application for the exact deployment hostname. Restrict its login methods to the identity provider that supplies the groups used in policy.

The Worker validates the application JWT and then calls the Access `get-identity` endpoint for the complete identity. This avoids relying on optional JWT custom group claims, which Access may trim to fit cookie limits. The application must receive the `CF_Authorization` cookie and be able to reach `<team>.cloudflareaccess.com`.

Do not rely on Worker-level `ctx.access` with this production build. Workers Static Assets do not propagate that context to the Worker API. The hostname application assertion is verified by `src/worker/auth/access.ts`.

## 8. Deploy

```sh
npm test
npm run typecheck
npm run build
npm run deploy
```

Deploy does not enable Access automatically. Confirm the hostname shows an Access login before continuing.

## 9. Acceptance tests

- A user with no broad Cloudflare R2 role can browse only their granted prefix.
- Listing a sibling prefix returns `403`.
- A credential for domain A cannot access a bucket in domain B.
- Read credentials cannot upload or delete.
- Write credentials can upload but cannot delete by default.
- Delete works only when policy and the credential request both allow it.
- A requested TTL above policy is clamped.
- Revoking a parent token invalidates its active child credentials.
- A non-auditor sees only their own events.
- An auditor sees all principals.
- Uploaded HTML downloads as an attachment and does not render on the application origin.
- Credential and object responses contain `Cache-Control: no-store`.

## 10. Close bypass paths

The application is only useful if broader paths are addressed:

- Remove `Cloudflare R2 Admin` and `Cloudflare R2 Read` from governed users.
- Inventory and prune account-owned and user-owned R2 API tokens.
- Disable public access where it is not intended.
- Restrict who can deploy Workers with R2 bindings.
- Keep a documented break-glass path during rollout.
