# Starlight Agent Launchpad

An inspectable deployment boundary for agent workflows: a Vercel cockpit, an authenticated Railway operator, PostgreSQL run receipts, and an explicit adapter seam for the runtime you actually operate.

The starter does **not** claim to ship Hermes or n8n. It runs in clearly labelled simulation mode locally, or forwards a versioned request to a compatible HTTP agent runtime. The n8n and Hermes integration shapes are documented as future adapters in [Architecture](docs/architecture.md); neither is represented as tested here.

## Boundary

```text
Browser
  -> Vercel Next.js Route Handler (cockpit token, same-origin check)
  -> public HTTPS Railway operator (server-only operator key)
  -> mock simulator OR explicit HTTP runtime adapter
  -> signed receipt in Railway PostgreSQL
```

The browser never receives the Railway operator URL, operator API key, runtime key, database URL, or receipt-signing secret.

## Run locally

```bash
npm ci
cp apps/operator/.env.example apps/operator/.env
cp apps/web/.env.example apps/web/.env.local
npm run dev:operator
npm run dev:web
```

Place the generated values as follows:

- Operator `OPERATOR_API_KEY` and web `RAILWAY_API_TOKEN`. These names are different sides of the same server-to-server credential.
- `COCKPIT_ACCESS_TOKEN` only in the web environment.
- `RECEIPT_SIGNING_SECRET` only in the operator environment.

The local operator defaults to `RUNTIME_ADAPTER=mock`. Every returned receipt declares `mode: "simulation"`; no model or workflow engine is implied.

## Deploy the operator to Railway

The canonical project definition is [.railway/railway.ts](.railway/railway.ts), using Railway Infrastructure as Code rather than single-service `railway.toml` config.

1. Create three independent 64-character secrets:

   ```bash
   openssl rand -hex 32 # OPERATOR_API_KEY
   openssl rand -hex 32 # RECEIPT_SIGNING_SECRET
   openssl rand -hex 32 # COCKPIT_ACCESS_TOKEN, used only on Vercel
   ```

2. Before applying the IaC, create project-level Railway Shared Variables named `LAUNCHPAD_OPERATOR_API_KEY` and `LAUNCHPAD_RECEIPT_SIGNING_SECRET`. Paste the first and second generated values respectively. The IaC references them through `context.shared`; no service needs to exist first. `RECEIPT_SIGNING_KEY_ID` names the current signing key, while optional `RECEIPT_VERIFICATION_KEYS` is a JSON object of retired key IDs and secrets retained only to verify historical receipts.
3. From this directory, link or initialize a Railway project. Run `railway config plan`, inspect the proposed PostgreSQL and operator resources, then run `railway config apply`.
4. Generate a public HTTPS Railway domain for `launchpad-operator`.
5. Set `RUNTIME_ADAPTER=http`, `ALLOW_MOCK_RUNTIME=false`, `AGENT_RUNTIME_URL`, and `AGENT_RUNTIME_API_KEY` on the operator only after a compatible runtime passes the contract tests.

The IaC source root is `templates/starlight-agent-launchpad`. A marketplace template is intentionally deferred: first deploy and test a real project, then use Railway's **Generate Template from Project** workflow.

The starter pins PostgreSQL to `postgres:16.15-bookworm` and uses one operator replica. Upgrade either only through an explicit plan, migration check, clean-install test, and rollback exercise.

## Deploy the cockpit to Vercel

Create a Vercel project with this repository and set its Root Directory to:

```text
templates/starlight-agent-launchpad
```

Set:

- `RAILWAY_API_URL`: the operator's public `https://...` Railway domain. A private `*.railway.internal` name cannot be reached from Vercel.
- `RAILWAY_API_TOKEN`: the same value as Railway `OPERATOR_API_KEY`; server-only.
- `COCKPIT_ACCESS_TOKEN`: a separate human access token; server-only.
- `APP_ORIGIN`: the exact Vercel production origin, such as `https://launchpad.example.com`.

The checked-in [vercel.json](vercel.json) builds only `apps/web` while retaining the workspace contract package.

## API surface

| Method | Route | Authentication | Purpose |
|---|---|---|---|
| `GET` | `/health` | Public | Minimal readiness; never returns internal hosts or secrets |
| `GET` | `/v1/architecture` | Bearer operator key | Versioned capabilities and active adapter kind |
| `POST` | `/v1/runs` | Bearer operator key + `Idempotency-Key` | Validate, execute, sign, and persist a run |
| `GET` | `/v1/receipts/:receiptId` | Bearer operator key | Retrieve one signed receipt |

All responses carry `x-correlation-id`. Run requests and receipts use schemas from `packages/contracts`. `/health` is a versioned readiness contract: a ready response means the receipt store is reachable and, for PostgreSQL, its expected schema migration is present. It does not certify that an external agent runtime is healthy.

## Execution and integrity boundaries

An idempotency key is permanently bound to the digest of the full validated run request, including workflow, input, and context. A completed retry of that same request returns the stored receipt; changing any bound field returns `idempotency_key_conflict`. If an operator process crashes after calling the runtime but before storing the receipt, an expired lease permits the same request to be attempted again. Execution is therefore **at least once after crash recovery**, not exactly once. A connected runtime must honor the forwarded `Idempotency-Key` before performing irreversible side effects.

Set `IDEMPOTENCY_LEASE_SECONDS` strictly greater than `RUNTIME_TIMEOUT_MS / 1000 + 30`; startup rejects a smaller margin so a normally slow runtime call cannot be reclaimed concurrently. The checked-in defaults are 180 seconds and 60 seconds respectively.

Receipts use HMAC-SHA256 over a canonical envelope containing the algorithm, key ID, and receipt body. The current key is assembled from `RECEIPT_SIGNING_KEY_ID` and `RECEIPT_SIGNING_SECRET`; `RECEIPT_VERIFICATION_KEYS` may retain up to ten legacy keys for rotation. This is shared-secret tamper evidence against receipt-store modification for parties that hold the operator's verification keys. It is not independent attestation or non-repudiation, because any key holder can create a valid signature.

```dotenv
RECEIPT_SIGNING_KEY_ID=launchpad-2026-09
RECEIPT_SIGNING_SECRET=<current-secret-at-least-32-characters>
RECEIPT_VERIFICATION_KEYS={"launchpad-2026-08":"<retired-secret-at-least-32-characters>"}
```

## Verification

```bash
npm run verify
```

The targeted CI workflow executes lint, typecheck, tests, operator build, and Next.js production build whenever this template changes.

## Documents

- [Architecture and adapter contract](docs/architecture.md)
- [Run receipt contract](docs/run-receipt.md)
- [Threat model](docs/threat-model.md)
- [Experience and visual-direction decision](docs/release-direction.md)
