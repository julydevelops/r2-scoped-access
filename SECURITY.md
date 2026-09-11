# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting feature for the repository, or contact the repository owner privately if that feature is unavailable.

Include the affected route or component, reproduction steps, impact, and any suggested mitigation. Do not include live credentials, account identifiers, customer names, or object data.

## Scope

Security reports about authentication bypass, policy bypass, credential disclosure, cross-prefix or cross-bucket access, active-content execution, audit visibility, or unsafe defaults are in scope.

This reference project is provided without a hosted service or security SLA. Adopters are responsible for their Cloudflare account configuration, identity provider, Access policy, R2 tokens, D1 retention, and rollout controls.

Read [docs/threat-model.md](docs/threat-model.md) for explicit guarantees and non-goals.
