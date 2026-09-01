import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  RUN_REQUEST_VERSION,
  runReceiptSchema,
  type RunReceipt,
} from "@starlight/launchpad-contracts";
import { verifyRunReceipt } from "@starlight/launchpad-contracts/integrity";

import type { OperatorConfig } from "../src/config";
import { buildOperator } from "../src/server";
import { MemoryReceiptStore } from "../src/store/memory";
import type { ReceiptStore, ReservationResult } from "../src/store/types";

class TamperingReceiptStore implements ReceiptStore {
  readonly kind = "memory" as const;
  readonly durable = false;
  readonly inner = new MemoryReceiptStore();
  tamper = false;

  initialize(migrate: boolean) {
    return this.inner.initialize(migrate);
  }

  health() {
    return this.inner.health();
  }

  async reserve(
    idempotencyKey: string,
    runId: string,
    workflow: string,
    inputDigest: string,
    leaseMs: number,
  ): Promise<ReservationResult> {
    const result = await this.inner.reserve(
      idempotencyKey,
      runId,
      workflow,
      inputDigest,
      leaseMs,
    );
    if (this.tamper && result.state === "completed") {
      return { state: "completed", receipt: this.tamperReceipt(result.receipt) };
    }
    return result;
  }

  complete(idempotencyKey: string, reservationToken: string, receipt: RunReceipt) {
    return this.inner.complete(idempotencyKey, reservationToken, receipt);
  }

  async findByReceiptId(receiptId: string): Promise<RunReceipt | null> {
    const receipt = await this.inner.findByReceiptId(receiptId);
    return receipt && this.tamper ? this.tamperReceipt(receipt) : receipt;
  }

  close() {
    return this.inner.close();
  }

  private tamperReceipt(receipt: RunReceipt): RunReceipt {
    return runReceiptSchema.parse({
      ...receipt,
      metrics: { ...receipt.metrics, durationMs: receipt.metrics.durationMs + 1 },
    });
  }
}

const operatorKey = "o".repeat(64);
const signingSecret = "s".repeat(64);

const config: OperatorConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 4_100,
  operatorApiKey: operatorKey,
  receiptSigningSecret: signingSecret,
  receiptSigningKeyId: "test-v1",
  runtimeAdapter: "mock",
  allowMockRuntime: true,
  runtimeTimeoutMs: 5_000,
  migrateOnStart: false,
  idempotencyLeaseMs: 30_000,
  allowedWorkflows: new Set(["research-brief"]),
  rateLimitMax: 100,
  rateLimitWindow: "1 minute",
  trustProxy: false,
};

const requestBody = {
  schemaVersion: RUN_REQUEST_VERSION,
  workflow: "research-brief",
  input: { brief: "Map the production boundary for a research workflow." },
  context: { requestedBy: "test-suite", source: "api", tags: ["contract"] },
};

describe("launchpad operator", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildOperator({ config });
  });

  afterEach(async () => {
    await app.close();
  });

  it("keeps health public and minimal", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-correlation-id"]).toBeTruthy();
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "starlight-launchpad-operator",
    });
    expect(response.body).not.toContain("memory");
    expect(response.body).not.toContain(operatorKey);
  });

  it("protects architecture and omits infrastructure coordinates", async () => {
    const denied = await app.inject({ method: "GET", url: "/v1/architecture" });
    expect(denied.statusCode).toBe(401);

    const response = await app.inject({
      method: "GET",
      url: "/v1/architecture",
      headers: { authorization: `Bearer ${operatorKey}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runtime: { adapter: "mock", configured: true },
      receiptStore: { kind: "memory", durable: false },
    });
    expect(response.body).not.toContain("railway.internal");
    expect(response.body).not.toContain(operatorKey);
  });

  it("creates a signed simulation receipt and replays it idempotently", async () => {
    const headers = {
      authorization: `Bearer ${operatorKey}`,
      "content-type": "application/json",
      "idempotency-key": "idem-run-0001",
      "x-correlation-id": "corr-run-0001",
    };
    const first = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload: requestBody,
    });
    expect(first.statusCode).toBe(201);
    expect(first.headers["x-correlation-id"]).toBe("corr-run-0001");

    const receipt = runReceiptSchema.parse(first.json());
    expect(receipt).toMatchObject({
      correlationId: "corr-run-0001",
      idempotencyKey: "idem-run-0001",
      workflow: "research-brief",
      status: "accepted",
      mode: "simulation",
      adapter: "mock",
    });
    expect(verifyRunReceipt(receipt, signingSecret)).toBe(true);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload: requestBody,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["x-idempotent-replay"]).toBe("true");
    expect(replay.json()).toEqual(receipt);
  });

  it("protects receipt retrieval", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: {
        authorization: `Bearer ${operatorKey}`,
        "content-type": "application/json",
        "idempotency-key": "idem-receipt-0001",
      },
      payload: requestBody,
    });
    const receipt = runReceiptSchema.parse(created.json());

    const denied = await app.inject({
      method: "GET",
      url: `/v1/receipts/${receipt.receiptId}`,
    });
    expect(denied.statusCode).toBe(401);

    const found = await app.inject({
      method: "GET",
      url: `/v1/receipts/${receipt.receiptId}`,
      headers: { authorization: `Bearer ${operatorKey}` },
    });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toEqual(receipt);
  });

  it("rejects an idempotency key reused for different input", async () => {
    const headers = {
      authorization: `Bearer ${operatorKey}`,
      "content-type": "application/json",
      "idempotency-key": "idem-conflict-0001",
    };
    const first = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload: requestBody,
    });
    expect(first.statusCode).toBe(201);

    const conflict = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload: {
        ...requestBody,
        input: { brief: "A different run must never inherit the original receipt." },
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: "idempotency_key_conflict" });
  });

  it("fails closed when stored receipt content no longer matches its signature", async () => {
    await app.close();
    const store = new TamperingReceiptStore();
    app = await buildOperator({ config, store });

    const headers = {
      authorization: `Bearer ${operatorKey}`,
      "content-type": "application/json",
      "idempotency-key": "idem-integrity-0001",
    };
    const created = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload: requestBody,
    });
    const receipt = runReceiptSchema.parse(created.json());
    store.tamper = true;

    const replay = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload: requestBody,
    });
    expect(replay.statusCode).toBe(500);
    expect(replay.json()).toMatchObject({ error: "receipt_integrity_failure" });

    const retrieval = await app.inject({
      method: "GET",
      url: `/v1/receipts/${receipt.receiptId}`,
      headers: { authorization: `Bearer ${operatorKey}` },
    });
    expect(retrieval.statusCode).toBe(500);
    expect(retrieval.json()).toMatchObject({ error: "receipt_integrity_failure" });
  });

  it("rejects unknown workflows before the adapter boundary", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: {
        authorization: `Bearer ${operatorKey}`,
        "content-type": "application/json",
        "idempotency-key": "idem-denied-0001",
      },
      payload: { ...requestBody, workflow: "unreviewed-workflow" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "workflow_not_allowed" });
  });
});
