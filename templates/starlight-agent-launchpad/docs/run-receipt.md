# Run receipt contract

Every completed, rejected, or failed run produces `starlight.run-receipt.v1`.

The receipt is evidence of what the operator accepted and recorded. It is not evidence that a model's answer is true.

## Integrity fields

- `receiptId`, `runId`, `correlationId`, and `idempotencyKey`
- exact `workflow`, adapter kind, and `simulation` or `runtime` mode
- SHA-256 digest of the canonical validated input
- bounded runtime result or generic failure summary
- measured operator duration; provider-reported metrics remain separately labelled
- creation/completion timestamps
- HMAC-SHA256 signature over the canonical receipt body, excluding `signature`

The implementation sorts object keys recursively before digesting or signing. Arrays retain order. The key ID identifies the signing key without disclosing it.

## Verification

Consumers with the signing secret can call `verifyRunReceipt(receipt, secret)` from `@starlight/launchpad-contracts`. Rotate the secret by changing `RECEIPT_SIGNING_KEY_ID`; preserve old keys wherever historical verification is required.

## Data posture

Runtime output is accepted only through the bounded `starlight.runtime-result.v1` schema. The starter does not ingest arbitrary logs, prompts, traces, or provider payloads into PostgreSQL. Workflow owners remain responsible for avoiding personal or regulated data in the input and summary fields.
