# Queen council service

The existing Railway operator now hosts a public court and private coordination records. This release performs deterministic mission planning and evidence recording. It does not dispatch model workers, install an agent scheduler, or replace the existing `/v1/runs` runtime boundary.

## Routes

| Route | Access | Result |
| --- | --- | --- |
| `GET /queen` | Public | Responsive court, role explorer and clearly labeled original story |
| `GET /v1/queen` | Public | Versioned roles, embedded skill instructions and explicit capability status |
| `POST /v1/queen/missions` | Operator bearer + idempotency key | Signed, immutable mission plan |
| `POST /v1/queen/evidence` | Operator bearer + idempotency key | Draft source references and superseding corrections |
| `GET /v1/queen/missions/:id` | Operator bearer | Signed mission record |
| `GET /v1/queen/evidence/:id` | Operator bearer | Signed evidence record |
| `GET /v1/queen/chronicle?brand=starlight&limit=25` | Operator bearer | Brand-scoped records; maximum 100 |

This is a single-operator service. One operator key controls the configured brands; brand partitioning is not multi-tenant authentication. Keep the key in the host's secret store, never in public browser code. The public page makes no authenticated requests.

## Mission contract

```json
{
  "brand": "starlight",
  "objective": "Prove one bounded maker/checker workflow against an existing repository task.",
  "ownerMandate": "Prepare a scoped plan for the Starlight delivery week.",
  "acceptanceCriteria": ["The exact artifact has a separate review and inspectable evidence."],
  "repositories": ["frankxai/Starlight-Intelligence-System"],
  "assumptions": ["The existing host remains responsible for admission."],
  "evidence": [],
  "budgetUsd": 0,
  "expiresAt": "2026-09-21T23:59:00Z"
}
```

Send a unique `Idempotency-Key` header; replay of identical input returns the same signed record, and reuse with different input returns 409. Expiry must fall within the next 31 days. `ownerMandate` records provenance and purpose; it cannot mint new permissions. The plan has `mayExecute:false`, `authorizedSpendUsd:0`, and explicit worker/review blockers. The supplied budget is a planning ceiling, not a spending grant.

Records pin skill instructions and their hashes. Source URLs and content hashes are caller-supplied references; the service does not fetch them or certify semantic truth. A matching accepted runtime artifact receipt sets `artifactReceiptLinked`; `missionExecutionVerified` remains false because an artifact match alone cannot establish mission execution.

## Deployment and recovery

Retain the existing service, environment, PostgreSQL connection, signing keys, authentication and runtime adapter. The operator build already emits `apps/operator/dist/migrate.js`. Use `node apps/operator/dist/migrate.js` as Railway's pre-deploy command, then the existing `npm run start:operator`. Migration 2 creates only `launchpad_queen_records` and its index inside the existing transaction/advisory lock. Existing receipts remain intact.

Readiness requires the migration and table. Roll back application code to the previous deployed commit if startup or smoke checks fail; leave the additive table in place. Do not roll back by deleting data. Run `/health`, `/queen`, `/v1/queen` smoke checks and verify private routes return 401 without a bearer token. Authenticated live checks require the existing operator credential; unit and PostgreSQL integration tests use synthetic local credentials.

Validation commands: `npm run test --workspace @starlight/launchpad-operator`, `npm run typecheck --workspace @starlight/launchpad-operator`, `npm run build:operator`.

## Execution connection

The SIS Queen session component is proposed in [SIS PR 160](https://github.com/frankxai/Starlight-Intelligence-System/pull/160). It runs a bounded maker/checker session using actual process adapters and context compilation, with admission supplied by the host. Durable admission and runtime activation remain under [starlight-swarm issue 15](https://github.com/frankxai/starlight-swarm/issues/15). This service does not implicitly connect either component.

The Queen is the existing `starlight-orchestrator` coordination identity. Hermes, Sage, Weaver, Architect and Sentinel retain their roles. Public character histories are proposed Starlight fiction; they do not amend Arcanea canon or claim model consciousness.

Built on SIP — Starlight Intelligence Protocol v1.1.1.
