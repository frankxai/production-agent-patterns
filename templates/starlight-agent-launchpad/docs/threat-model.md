# Threat model

## Protected assets

- Railway operator and agent-runtime credentials
- receipt signing secret
- run input and bounded result data
- idempotency and receipt integrity

## Controls

| Threat | Control |
|---|---|
| Browser learns Railway/runtime credentials | Server-only Next.js Route Handlers; no `NEXT_PUBLIC_` secrets |
| Cross-site run submission | Exact `Origin` enforcement on browser mutations |
| Public cockpit execution | Separate cockpit token checked before the Railway call |
| Direct Railway abuse | Constant-time bearer authentication and rate limiting |
| SSRF through user input | Operator and runtime URLs come only from validated environment configuration |
| Accidental duplicate submission | Idempotency key permanently bound to the full validated request digest and backed by a unique PostgreSQL constraint |
| Duplicate side effect after operator crash | At-least-once recovery is explicit; the runtime receives the same `Idempotency-Key` and must enforce it before irreversible work |
| Oversized or arbitrary payloads | Fastify body limit plus strict Zod schemas and bounded strings/arrays |
| Secret leakage in logs/errors | Fastify redaction, generic client failures, correlation IDs |
| Receipt alteration | Canonical request/input digests and HMAC over algorithm, key ID, and receipt body, verified with the current-plus-legacy keyring |
| Internal topology disclosure | Versioned minimal readiness response; authenticated architecture response omits hosts and credentials |

## Explicit limits

The shared-secret cockpit gate is suitable for a single-operator starter, not multi-tenant identity. Before adding users, replace it with an identity provider, per-tenant authorization, distributed rate limiting, and a tenant key on every receipt row. Vercel Firewall or an equivalent edge control should front public production deployments.

The receipt HMAC is shared-secret tamper evidence against storage modification, not independent attestation or non-repudiation. The operator and every verification-key holder are inside that trust boundary. Idempotency also does not promise exactly-once execution: after a crash and lease expiry the operator can call the runtime again, so the runtime must make the forwarded key authoritative for side effects.
