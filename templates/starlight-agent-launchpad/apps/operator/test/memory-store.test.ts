import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RUN_RECEIPT_VERSION,
  RUNTIME_RESULT_VERSION,
  runReceiptSchema,
} from "@starlight/launchpad-contracts";

import { MemoryReceiptStore } from "../src/store/memory";

const digestA = "a".repeat(64);
const digestB = "b".repeat(64);

function receiptFor(requestDigest: string) {
  return runReceiptSchema.parse({
    schemaVersion: RUN_RECEIPT_VERSION,
    receiptId: "00000000-0000-4000-8000-000000000010",
    runId: "00000000-0000-4000-8000-000000000001",
    correlationId: "correlation-store-test",
    idempotencyKey: "idem-completed",
    workflow: "research",
    status: "accepted",
    mode: "simulation",
    adapter: "mock",
    inputDigest: "c".repeat(64),
    requestDigest,
    result: {
      schemaVersion: RUNTIME_RESULT_VERSION,
      status: "accepted",
      summary: "Stored test result",
      artifacts: [],
    },
    metrics: { durationMs: 1 },
    createdAt: "2026-09-01T00:00:00.000Z",
    completedAt: "2026-09-01T00:00:00.001Z",
    signature: {
      algorithm: "hmac-sha256",
      keyId: "test-key",
      value: "d".repeat(64),
    },
  });
}

describe("MemoryReceiptStore idempotency reservations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a request fingerprint mismatch while the original run is pending", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const store = new MemoryReceiptStore();

    await expect(
      store.reserve(
        "idem-pending",
        "00000000-0000-4000-8000-000000000001",
        "research",
        digestA,
        30_000,
      ),
    ).resolves.toMatchObject({ state: "reserved" });

    await expect(
      store.reserve(
        "idem-pending",
        "00000000-0000-4000-8000-000000000002",
        "publish",
        digestA,
        30_000,
      ),
    ).resolves.toEqual({ state: "conflict", workflow: "research", requestDigest: digestA });

    await expect(
      store.reserve(
        "idem-pending",
        "00000000-0000-4000-8000-000000000003",
        "research",
        digestA,
        30_000,
      ),
    ).resolves.toEqual({ state: "pending", workflow: "research", requestDigest: digestA });
  });

  it("never lets a stale mismatched request take over the original reservation", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const store = new MemoryReceiptStore();

    await store.reserve(
      "idem-stale-conflict",
      "00000000-0000-4000-8000-000000000001",
      "research",
      digestA,
      1_000,
    );
    now = 2_001;

    await expect(
      store.reserve(
        "idem-stale-conflict",
        "00000000-0000-4000-8000-000000000002",
        "research",
        digestB,
        1_000,
      ),
    ).resolves.toEqual({ state: "conflict", workflow: "research", requestDigest: digestA });

    await expect(
      store.reserve(
        "idem-stale-conflict",
        "00000000-0000-4000-8000-000000000003",
        "research",
        digestA,
        1_000,
      ),
    ).resolves.toMatchObject({ state: "reserved" });
  });

  it("allows stale takeover only when workflow and full request digest are identical", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const store = new MemoryReceiptStore();
    const first = await store.reserve(
      "idem-stale-same",
      "00000000-0000-4000-8000-000000000001",
      "research",
      digestA,
      1_000,
    );
    now = 2_001;
    const takeover = await store.reserve(
      "idem-stale-same",
      "00000000-0000-4000-8000-000000000002",
      "research",
      digestA,
      1_000,
    );

    expect(first).toMatchObject({ state: "reserved" });
    expect(takeover).toMatchObject({ state: "reserved" });
    if (first.state === "reserved" && takeover.state === "reserved") {
      expect(takeover.token).not.toBe(first.token);
    }
  });

  it("keeps a completed key permanently bound to its original request fingerprint", async () => {
    const store = new MemoryReceiptStore();
    const reservation = await store.reserve(
      "idem-completed",
      "00000000-0000-4000-8000-000000000001",
      "research",
      digestA,
      30_000,
    );
    expect(reservation.state).toBe("reserved");
    if (reservation.state !== "reserved") {
      throw new Error("Expected a new reservation");
    }
    const receipt = receiptFor(digestA);
    await store.complete("idem-completed", reservation.token, receipt);

    await expect(
      store.reserve(
        "idem-completed",
        "00000000-0000-4000-8000-000000000002",
        "research",
        digestB,
        30_000,
      ),
    ).resolves.toEqual({ state: "conflict", workflow: "research", requestDigest: digestA });

    await expect(
      store.reserve(
        "idem-completed",
        "00000000-0000-4000-8000-000000000003",
        "research",
        digestA,
        30_000,
      ),
    ).resolves.toEqual({ state: "completed", receipt });
  });
});
