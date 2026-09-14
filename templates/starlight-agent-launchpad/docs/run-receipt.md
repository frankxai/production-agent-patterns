# Run receipt contract

Every completed, rejected, or failed run produces `starlight.run-receipt.v1`.

The receipt is evidence of what the operator accepted and recorded. It is not evidence that a model's answer is true.

## Integrity fields

- `receiptId`, `runId`, `correlationId`, and `idempotencyKey`
- exact `workflow`, adapter kind, and `simulation` or `runtime` mode
- SHA-256 digest of the canonical validated input
- SHA-256 digest of the full canonical validated request, including workflow, input, and context
- bounded runtime result or generic failure summary
- measured operator duration; provider-reported metrics remain separately labelled
- creation/completion timestamps
- HMAC-SHA256 signature over a canonical envelope containing the algorithm, key ID, and receipt body

The implementation sorts object keys recursively before digesting or signing. Arrays retain order. The authenticated key ID selects a verification key without disclosing it.

## Verification

Consumers with the verification keys can call `verifyRunReceipt(receipt, keyring)` from `@starlight/launchpad-contracts`, where `keyring` maps key IDs to secrets. The operator automatically includes the current `RECEIPT_SIGNING_KEY_ID` and `RECEIPT_SIGNING_SECRET`. During rotation, move the retired key into the optional `RECEIPT_VERIFICATION_KEYS` JSON object before changing the current pair; retain it only as long as historical receipt verification is required. Legacy secrets must be at least 32 characters and the operator accepts at most ten legacy keys.

HMAC provides shared-secret tamper evidence: a holder of the configured verification keys can detect receipt-store modification. It is not independent attestation or non-repudiation, because every holder of a signing secret can also produce a valid receipt.

## Data posture

Runtime output is accepted only through the bounded `starlight.runtime-result.v1` schema. The starter does not ingest arbitrary logs, prompts, traces, or provider payloads into PostgreSQL. Workflow owners remain responsible for avoiding personal or regulated data in the input and summary fields.
