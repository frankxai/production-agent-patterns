import { describe, expect, it } from "vitest";

import {
  RUN_RECEIPT_VERSION,
  RUN_REQUEST_VERSION,
  RUNTIME_RESULT_VERSION,
  runRequestSchema,
  runtimeResultSchema,
  type UnsignedRunReceipt,
} from "../src";
import { canonicalJson, sha256Digest, signRunReceipt, verifyRunReceipt } from "../src/integrity";

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

  it("signs and verifies a receipt and detects changes", () => {
    const receipt: UnsignedRunReceipt = {
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

    const signed = signRunReceipt(receipt, "s".repeat(64), "test-key");
    expect(verifyRunReceipt(signed, "s".repeat(64))).toBe(true);
    expect(
      verifyRunReceipt(
        { ...signed, metrics: { ...signed.metrics, durationMs: 9 } },
        "s".repeat(64),
      ),
    ).toBe(false);
  });
});
