import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  RUN_REQUEST_VERSION,
  RUNTIME_RESULT_VERSION,
  runReceiptSchema,
  type RunReceipt,
  type RuntimeResult,
} from "@starlight/launchpad-contracts";
import { verifyRunReceipt } from "@starlight/launchpad-contracts/integrity";

import type { RuntimeAdapter } from "../src/adapters";
import type { OperatorConfig } from "../src/config";
import { buildOperator } from "../src/server";
import { MemoryReceiptStore } from "../src/store/memory";
import type { ReceiptStore, ReservationResult } from "../src/store/types";

class BlockingAdapter implements RuntimeAdapter {
  readonly kind = "mock" as const;
  readonly mode = "simulation" as const;
  calls = 0;

  private releaseExecution: ((result: RuntimeResult) => void) | undefined;
  private signalStarted: (() => void) | undefined;
  readonly started = new Promise<void>((resolve) => {
    this.signalStarted = resolve;
  });

  execute(): Promise<RuntimeResult> {
    this.calls += 1;
    this.signalStarted?.();
    if (this.calls > 1) {
      return Promise.resolve(this.result());
    }
    return new Promise<RuntimeResult>((resolve) => {
      this.releaseExecution = resolve;
    });
  }

  release(): void {
    if (!this.releaseExecution) {
      throw new Error("The blocking adapter has not started");
    }
    this.releaseExecution(this.result());
  }

  private result(): RuntimeResult {
    return {
      schemaVersion: RUNTIME_RESULT_VERSION,
      status: "accepted",
      summary: "The bounded test execution completed.",
      artifacts: [],
    };
  }
}

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
    requestDigest: string,
    leaseMs: number,
  ): Promise<ReservationResult> {
    const result = await this.inner.reserve(
      idempotencyKey,
      runId,
      workflow,
      requestDigest,
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
      signature: { ...receipt.signature, keyId: "attacker-controlled-key" },
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
  receiptVerificationKeys: { "test-v1": signingSecret },
  runtimeAdapter: "mock",
  allowMockRuntime: true,
  runtimeTimeoutMs: 5_000,
  migrateOnStart: false,
  idempotencyLeaseMs: 60_000,
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
      schemaVersion: "starlight.health.v1",
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
    expect(verifyRunReceipt(receipt, config.receiptVerificationKeys)).toBe(true);

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

  it("rejects a completed idempotency key reused with different context", async () => {
    const headers = {
      authorization: `Bearer ${operatorKey}`,
      "content-type": "application/json",
      "idempotency-key": "idem-context-conflict-0001",
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
        context: { ...requestBody.context, tags: ["different-context"] },
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: "idempotency_key_conflict" });
  });

  it("returns run_in_progress for the same pending request without double execution", async () => {
    await app.close();
    const adapter = new BlockingAdapter();
    app = await buildOperator({ config, adapter });
    const headers = {
      authorization: `Bearer ${operatorKey}`,
      "content-type": "application/json",
      "idempotency-key": "idem-pending-replay-0001",
    };

    const firstRun = app.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload: requestBody,
    });
    await adapter.started;

    const pending = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload: requestBody,
    });
    adapter.release();
    const completed = await firstRun;

    expect(pending.statusCode).toBe(409);
    expect(pending.json()).toMatchObject({ error: "run_in_progress" });
    expect(completed.statusCode).toBe(201);
    expect(adapter.calls).toBe(1);
  });

  it("rejects a pending idempotency key reused with different context", async () => {
    await app.close();
    const adapter = new BlockingAdapter();
    app = await buildOperator({ config, adapter });
    const headers = {
      authorization: `Bearer ${operatorKey}`,
      "content-type": "application/json",
      "idempotency-key": "idem-pending-conflict-0001",
    };

    const firstRun = app.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload: requestBody,
    });
    await adapter.started;

    const conflict = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers,
      payload: {
        ...requestBody,
        context: { ...requestBody.context, requestedBy: "another-caller" },
      },
    });
    adapter.release();
    const completed = await firstRun;

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: "idempotency_key_conflict" });
    expect(completed.statusCode).toBe(201);
    expect(adapter.calls).toBe(1);
  });

  it("fails closed when a stored receipt signature key ID is tampered", async () => {
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

  it("retrieves a legacy-key receipt after rotating the active signing key", async () => {
    await app.close();
    const store = new MemoryReceiptStore();
    const legacySecret = "l".repeat(64);
    const legacyKeyId = "legacy-v1";
    const legacyConfig: OperatorConfig = {
      ...config,
      receiptSigningSecret: legacySecret,
      receiptSigningKeyId: legacyKeyId,
      receiptVerificationKeys: { [legacyKeyId]: legacySecret },
    };
    app = await buildOperator({ config: legacyConfig, store });

    const created = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: {
        authorization: `Bearer ${operatorKey}`,
        "content-type": "application/json",
        "idempotency-key": "idem-legacy-receipt-0001",
      },
      payload: requestBody,
    });
    expect(created.statusCode).toBe(201);
    const legacyReceipt = runReceiptSchema.parse(created.json());
    expect(legacyReceipt.signature.keyId).toBe(legacyKeyId);

    await app.close();
    const rotatedConfig: OperatorConfig = {
      ...config,
      receiptVerificationKeys: {
        ...config.receiptVerificationKeys,
        [legacyKeyId]: legacySecret,
      },
    };
    app = await buildOperator({ config: rotatedConfig, store });

    const found = await app.inject({
      method: "GET",
      url: `/v1/receipts/${legacyReceipt.receiptId}`,
      headers: { authorization: `Bearer ${operatorKey}` },
    });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toEqual(legacyReceipt);
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
