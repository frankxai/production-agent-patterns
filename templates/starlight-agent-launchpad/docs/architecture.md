# Architecture

## Decision

Vercel owns the human experience and the browser-facing security boundary. Railway owns the long-running operator and durable receipt ledger. The agent runtime remains replaceable behind a narrow request/result contract.

| Plane | Responsibility | Must not own |
|---|---|---|
| Vercel cockpit | Human access check, same-origin enforcement, request shaping, receipt display | Railway secrets, direct runtime calls from the browser |
| Railway operator | API authentication, allowlist, idempotency, adapter call, signed receipt | User interface, provider-specific business logic |
| PostgreSQL | Idempotency and durable receipts | Runtime secrets or raw log streams |
| Agent runtime | Execute one named workflow and return a bounded result contract | Public browser authentication, receipt authority |

## Runtime request

The generic HTTP adapter sends the validated `starlight.run-request.v1` body to the fixed `AGENT_RUNTIME_URL`, adding only:

- `Authorization: Bearer <AGENT_RUNTIME_API_KEY>`
- `Idempotency-Key`
- `x-correlation-id`

The runtime must return `starlight.runtime-result.v1`. Arbitrary provider responses are rejected rather than stored.

## Adapter status

| Adapter | Code status | Claim boundary |
|---|---|---|
| Mock | Implemented and tested | Deterministic local simulation; never presented as model output |
| Generic HTTP | Implemented and contract-tested | Compatible only when the target implements the versioned request/result contract |
| n8n webhook | Design seam only | Add a dedicated mapper, webhook authentication, replay policy, and fixture tests before enabling |
| Hermes runtime | Design seam only | Define and test an explicit Hermes profile/tool/result adapter before making any compatibility claim |

Do not point `AGENT_RUNTIME_URL` at an existing n8n webhook and assume compatibility. The first n8n release must add an adapter that maps the launchpad request to one named workflow, validates its callback result, and records a clean-install receipt.

## Public/private network boundary

The Vercel Route Handler calls a public Railway HTTPS domain with a server-only token. Railway private domains are intentionally not referenced because they are unavailable from Vercel. A future Railway-hosted worker can use private networking, but that is a different topology and must get its own blueprint.

## Failure semantics

- A duplicate idempotency key bound to the same workflow and input digest returns the original receipt and never calls the runtime twice. Reuse with different work returns `idempotency_key_conflict`, including while the first run is pending.
- A runtime timeout or invalid response produces a persisted `failed` receipt with a generic public summary and a correlation ID.
- `/health` returns `503` when the receipt store is unavailable.
- Receipt lookup and replay re-verify the HMAC and fail closed when stored content has changed.
- The operator refuses production startup without PostgreSQL, strong operator/signing secrets, and an enabled runtime adapter.

The candidate starts with one operator replica. PostgreSQL makes idempotency and receipts shareable when scale-out is later justified, but high-availability claims require load, failover, and migration evidence first.
