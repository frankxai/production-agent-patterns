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

The generic HTTP adapter maps the validated `starlight.run-request.v1` into a `starlight.runtime-request.v1` body and sends it to the fixed `AGENT_RUNTIME_URL`, adding only:

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

- An idempotency key is permanently bound to the SHA-256 digest of the full canonical validated request: schema version, workflow, input, and context. A completed retry of the same request returns the stored receipt; any changed bound field returns `idempotency_key_conflict`, including while the first run is pending or after its lease expires.
- Concurrent retries of the same pending request receive `run_in_progress`. If the operator crashes after calling the runtime but before storing the receipt, the same request may be attempted again after its lease expires. This is at-least-once crash recovery, so the downstream runtime must honor the forwarded `Idempotency-Key` before applying irreversible side effects.
- Startup requires the idempotency lease to exceed the runtime timeout by more than 30 seconds. This prevents a normally slow in-flight call from being reclaimed; it does not remove the crash-recovery limitation.
- A runtime timeout or invalid response produces a persisted `failed` receipt with a generic public summary and a correlation ID.
- `/health` returns the versioned `starlight.health.v1` readiness schema and responds `503` when the receipt store is unavailable or its expected PostgreSQL schema migration is missing. Readiness does not probe a separately operated runtime.
- Receipt lookup and replay re-verify the HMAC envelope—including algorithm, key ID, and receipt body—against the configured current-plus-legacy keyring and fail closed when stored content has changed or the key ID is unknown.
- The operator refuses production startup without PostgreSQL, strong operator/signing secrets, and an enabled runtime adapter.

The candidate starts with one operator replica. PostgreSQL makes idempotency and receipts shareable when scale-out is later justified, but high-availability claims require load, failover, and migration evidence first.
