import { describe, expect, it } from "vitest";

import {
  RUN_RECEIPT_VERSION,
  RUN_REQUEST_VERSION,
  RUNTIME_RESULT_VERSION,
  healthResponseSchema,
  runRequestSchema,
  runtimeResultSchema,
  type UnsignedRunReceipt,
} from "../src";
import { canonicalJson, sha256Digest, signRunReceipt, verifyRunReceipt } from "../src/integrity";

function makeUnsignedReceipt(): UnsignedRunReceipt {
  return {
    schemaVersion: RUN_RECEIPT_VERSION,
    receiptId: "6a1adf0d-e377-4a2b-bd04-b015a8ebd4f5",
    runId: "ebdf349c-669a-4198-9878-6d8a6860a232",
    correlationId: "corr-test-0001",
    idempotencyKey: "idem-test-0001",
    workflow: "research-brief",
    status: "accepted",
    mode: "simulation",
    adapter: "mock",
    inputDigest: sha256Digest({ brief: "Test" }),
    requestDigest: sha256Digest({
      schemaVersion: RUN_REQUEST_VERSION,
      workflow: "research-brief",
      input: { brief: "Test" },
      context: { source: "cockpit", tags: [] },
    }),
    result: {
      schemaVersion: RUNTIME_RESULT_VERSION,
      status: "accepted",
      summary: "Simulation completed.",
      artifacts: [],
    },
    metrics: { durationMs: 4 },
    createdAt: "2026-09-01T00:00:00.000Z",
    completedAt: "2026-09-01T00:00:00.004Z",
  };
}

describe("launchpad contracts", () => {
  it("rejects unknown request fields and non-kebab workflow names", () => {
    expect(() =>
      runRequestSchema.parse({
        schemaVersion: RUN_REQUEST_VERSION,
        workflow: "Research Brief",
        input: { brief: "A bounded research question" },
        context: { source: "cockpit", tags: [] },
        injected: true,
      }),
    ).toThrow();
  });

  it("canonicalizes objects independently of property order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
    expect(sha256Digest({ a: 1, b: 2 })).toBe(sha256Digest({ b: 2, a: 1 }));
  });

  it("rejects non-HTTPS runtime artifact references", () => {
    expect(() =>
      runtimeResultSchema.parse({
        schemaVersion: RUNTIME_RESULT_VERSION,
        status: "accepted",
        summary: "Unsafe artifact scheme",
        artifacts: [{ kind: "link", label: "unsafe", uri: "javascript:alert(1)" }],
      }),
    ).toThrow("Artifact URIs must use HTTPS");
  });

  it("keeps readiness on a strict versioned public contract", () => {
    expect(
      healthResponseSchema.parse({
        schemaVersion: "starlight.health.v1",
        status: "ok",
        service: "starlight-launchpad-operator",
        version: "0.1.0",
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
    ).toMatchObject({ status: "ok" });
    expect(() =>
      healthResponseSchema.parse({
        status: "ok",
        service: "starlight-launchpad-operator",
        version: "0.1.0",
        timestamp: "2026-09-01T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("signs and verifies a receipt and detects changes", () => {
    const receipt = makeUnsignedReceipt();

    const signed = signRunReceipt(receipt, "s".repeat(64), "test-key");
    expect(verifyRunReceipt(signed, { "test-key": "s".repeat(64) })).toBe(true);
    expect(
      verifyRunReceipt(
        { ...signed, metrics: { ...signed.metrics, durationMs: 9 } },
        { "test-key": "s".repeat(64) },
      ),
    ).toBe(false);
  });

  it("verifies receipts signed by a legacy key in the explicit keyring", () => {
    const receipt = makeUnsignedReceipt();

    const legacySecret = "l".repeat(64);
    const signed = signRunReceipt(receipt, legacySecret, "legacy-2026-08");

    expect(
      verifyRunReceipt(signed, {
        "current-2026-09": "c".repeat(64),
        "legacy-2026-08": legacySecret,
      }),
    ).toBe(true);
  });

  it("rejects an unknown or authenticated-key-id change", () => {
    const receipt = makeUnsignedReceipt();

    const sharedSecret = "s".repeat(64);
    const signed = signRunReceipt(receipt, sharedSecret, "original-key");
    const changedKeyId = {
      ...signed,
      signature: { ...signed.signature, keyId: "renamed-key" },
    };

    expect(verifyRunReceipt(signed, { "renamed-key": sharedSecret })).toBe(false);
    expect(
      verifyRunReceipt(changedKeyId, {
        "original-key": sharedSecret,
        "renamed-key": sharedSecret,
      }),
    ).toBe(false);
  });
});
