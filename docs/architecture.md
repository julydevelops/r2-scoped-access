# Architecture

## Request path

The React client and Worker API deploy together using Workers Static Assets. Static files are served by Cloudflare's assets router. Requests matching `/api/*` run the Worker first.

Production identity comes from a hostname-based Cloudflare Access application:

1. Access authenticates the browser before either assets or API routes are served.
2. The Worker reads `Cf-Access-Jwt-Assertion`, or the `CF_Authorization` cookie as a fallback.
3. The assertion is verified against the Access team's JWKS, issuer, and application audience.
4. The application token is sent to the Access `get-identity` endpoint to retrieve the complete identity, including groups that may not fit in JWT custom claims.
5. Email and identity-provider groups are flattened into policy inputs.

Worker-level Access exposes `ctx.access`, but Workers Static Assets do not propagate that context through their internal router. The production configuration therefore uses hostname Access and explicit JWT verification. `ctx.access` remains supported for Wrangler local development and deployments that serve no Static Assets.

## Authorization model

`policy.json` has four layers:

- A trust domain owns one or more buckets and maps to one parent R2 token.
- A role contains bucket, prefix, permission, delete, and maximum-TTL grants.
- An assignment maps one Access email or group to one or more roles.
- Auditors may read rows belonging to other principals. Everyone may read their own rows.

Every bucket belongs to exactly one trust domain. The Worker validates the complete policy before serving API requests.

## Credential enforcement

Temporary credentials are signed locally using the parent R2 token's secret access key. The JWT names exactly one bucket, an explicit S3 action list, allowed prefixes, and an expiration.

The Worker then derives the temporary secret access key from the signed JWT and returns the parent access key ID, derived secret, and encoded session token. This is the local-signing contract documented by R2.

R2, not only this application, enforces the resulting credential. A credential cannot exceed its parent token's permission or bucket scope.

## Delete semantics

R2's coarse `object-read-write` scope includes deletion. This project signs explicit action lists instead:

- Read: list, head, and get actions.
- Write: read actions plus put, copy, and multipart upload actions.
- Delete: `DeleteObject` and `DeleteObjects`, added only when policy allows deletion and the caller explicitly requests it.

One action list applies uniformly to every prefix in a credential. The application cannot safely combine a read-only prefix and a writable prefix into one writable credential.

## Audit semantics

The D1 binding is required. Each event records identity, operation, requested path, granted prefixes, exact action list, TTL, role, trust domain, outcome, and request ID.

Audit inserts run before credential responses are returned. Mutations first write an intent event, then append the R2 result. An unresolved intent identifies an operation whose final result could not be recorded. If D1 rejects an intent insert, the Worker does not send the mutation to R2. Workers Logs contain redacted operational metadata, not a second copy of identity and object paths.

The broker cannot observe S3 requests that a caller makes directly with issued temporary credentials. The issuance row records the exact delegated capability; separate telemetry is required if each direct S3 request must be recorded.

## Browser security

- React renders untrusted object names and audit values as text.
- No route uses `dangerouslySetInnerHTML`.
- Object responses use `Content-Disposition: attachment` and `application/octet-stream`.
- Private API and object responses use `Cache-Control: no-store, private`.
- Static responses set CSP, frame, referrer, permissions, and MIME-sniffing protections through `public/_headers`.
- Credentials exist only in React memory and are automatically removed at expiry.
