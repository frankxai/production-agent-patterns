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
| Duplicate execution | Required idempotency key backed by a unique PostgreSQL constraint |
| Oversized or arbitrary payloads | Fastify body limit plus strict Zod schemas and bounded strings/arrays |
| Secret leakage in logs/errors | Fastify redaction, generic client failures, correlation IDs |
| Receipt alteration | Canonical SHA-256 input digest and HMAC-signed receipt |
| Internal topology disclosure | Minimal public health response; authenticated architecture response omits hosts and credentials |

## Explicit limits

The shared-secret cockpit gate is suitable for a single-operator starter, not multi-tenant identity. Before adding users, replace it with an identity provider, per-tenant authorization, distributed rate limiting, and a tenant key on every receipt row. Vercel Firewall or an equivalent edge control should front public production deployments.
