# Operations

## Rotate a parent token

1. Create a replacement account-owned R2 token with the same bucket scope.
2. Put both replacement values in an untracked, access-restricted file outside the repository.
3. Update the pair atomically with `npx wrangler secret bulk /secure/path/domain-secrets.json`.
4. Remove the temporary secrets file.
5. Verify new credential issuance.
6. Revoke the old token.

Revoking the old parent immediately invalidates children derived from it, even when their TTL has not expired.

## Emergency revoke

Revoke the affected trust domain's parent token. This disables every active child credential and prevents new credentials until replacement secrets are deployed.

## Add a user

Add the person to the identity-provider group named in `policy.json`. Access evaluates current group membership at sign-in. Direct email assignments require editing policy and deploying.

## Remove a user

Remove the person from the identity-provider group or disable their identity-provider account, then revoke active Access sessions if immediate removal is required. Existing temporary R2 credentials remain usable until expiry unless the trust domain's parent token is revoked.

The account-member importer is a bootstrap tool, not a synchronization or deprovisioning system. Re-running it only appends missing direct email assignments. Remove obsolete direct assignments from `policy.json`, deploy, and follow the session and temporary-credential revocation guidance above.

## Add a bucket

1. Add the bucket to exactly one trust domain.
2. Add grants referencing it.
3. Recreate or re-scope the domain's parent token to include the bucket.
4. Update parent secrets if the token changed.
5. Deploy and run cross-domain acceptance tests.

## Audit health

D1 is the authoritative application audit store. Workers Logs contain only action, outcome, trust domain, and request ID for diagnostics. Monitor Worker `503` rates, unresolved `put-intent` events, and `auditWriteFailed` log events. Set D1 retention or export procedures according to organizational requirements.

## Troubleshooting

| Symptom | Meaning | Action |
| --- | --- | --- |
| `401` | Access assertion is absent, invalid, or lacks email | Check hostname Access, audience, team domain, and login method |
| `403` | Identity is valid but policy does not cover the request | Inspect the Identity view and compare exact groups with policy |
| `503` missing parent | A domain secret is unset | Set both parent secrets for the named domain |
| `503` audit unavailable | D1 could not store the event | Check binding, migrations, D1 health, and Worker logs |
| R2 credential rejected after issuance | Parent token may be revoked or rotated | Check the domain's parent token and secrets |
