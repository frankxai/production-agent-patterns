import { randomUUID } from "node:crypto";

import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import {
  RUN_RECEIPT_VERSION,
  RUNTIME_REQUEST_VERSION,
  architectureResponseSchema,
  healthResponseSchema,
  runRequestSchema,
  type RuntimeRequest,
  type UnsignedRunReceipt,
} from "@starlight/launchpad-contracts";
import {
  sha256Digest,
  signRunReceipt,
  verifyRunReceipt,
} from "@starlight/launchpad-contracts/integrity";
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { z } from "zod";

import { AdapterFailure, createRuntimeAdapter, type RuntimeAdapter } from "./adapters";
import type { OperatorConfig } from "./config";
import { bearerToken, correlationId, secureEqual, validIdempotencyKey } from "./security";
import { createReceiptStore, type ReceiptStore } from "./store";

interface RequestWithCorrelation extends FastifyRequest {
  launchpadCorrelationId: string;
}

export interface OperatorDependencies {
  config: OperatorConfig;
  adapter?: RuntimeAdapter;
  store?: ReceiptStore;
}

function requestCorrelationId(request: FastifyRequest): string {
  return (request as RequestWithCorrelation).launchpadCorrelationId;
}

function publicFailure(
  code: "runtime_timeout" | "runtime_unavailable" | "invalid_runtime_result",
): { code: typeof code; summary: string } {
  const summaries = {
    runtime_timeout: "The runtime did not complete before the operator deadline.",
    runtime_unavailable: "The runtime could not complete this request.",
    invalid_runtime_result: "The runtime returned a result that did not match the contract.",
  } as const;
  return { code, summary: summaries[code] };
}

function authenticate(config: OperatorConfig) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = bearerToken(request.headers.authorization);
    if (!token || !secureEqual(token, config.operatorApiKey)) {
      await reply.status(401).send({
        error: "unauthorized",
        correlationId: requestCorrelationId(request),
      });
    }
  };
}

export async function buildOperator(dependencies: OperatorDependencies): Promise<FastifyInstance> {
  const { config } = dependencies;
  const adapter = dependencies.adapter ?? createRuntimeAdapter(config);
  const store = dependencies.store ?? createReceiptStore(config);

  const app = Fastify({
    bodyLimit: 64 * 1024,
    logController: new LogController({
      disableRequestLogging: (request) => config.nodeEnv === "test" || request.url === "/health",
    }),
    logger:
      config.nodeEnv === "test"
        ? false
        : {
            level: config.nodeEnv === "production" ? "info" : "debug",
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.x-starlight-access-token",
                "operatorApiKey",
                "agentRuntimeApiKey",
                "receiptSigningSecret",
                "receiptVerificationKeys",
                "databaseUrl",
              ],
              censor: "[redacted]",
            },
          },
    trustProxy: config.trustProxy,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
  });

  app.addHook("onRequest", async (request, reply) => {
    const resolved = correlationId(request.headers["x-correlation-id"]);
    (request as RequestWithCorrelation).launchpadCorrelationId = resolved;
    reply.header("x-correlation-id", resolved);
    reply.header("cache-control", "no-store");
  });

  await store.initialize(config.migrateOnStart);

  app.get("/health", async (_request, reply) => {
    const ready = await store.health();
    const payload = healthResponseSchema.parse({
      schemaVersion: "starlight.health.v1",
      status: ready ? "ok" : "unavailable",
      service: "starlight-launchpad-operator",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
    return reply.status(ready ? 200 : 503).send(payload);
  });

  app.get(
    "/v1/architecture",
    { preHandler: authenticate(config) },
    async (_request, reply) => {
      const payload = architectureResponseSchema.parse({
        schemaVersion: "starlight.architecture.v1",
        service: "starlight-launchpad-operator",
        runtime: { adapter: adapter.kind, configured: true },
        receiptStore: { kind: store.kind, durable: store.durable },
        capabilities: {
          idempotentRuns: true,
          signedReceipts: true,
          receiptLookup: true,
        },
        contracts: {
          runRequest: "starlight.run-request.v1",
          runtimeRequest: "starlight.runtime-request.v1",
          runtimeResult: "starlight.runtime-result.v1",
          runReceipt: "starlight.run-receipt.v1",
        },
      });
      return reply.send(payload);
    },
  );

  app.post(
    "/v1/runs",
    { preHandler: authenticate(config) },
    async (request, reply) => {
      const currentCorrelationId = requestCorrelationId(request);
      const idempotencyKey = request.headers["idempotency-key"];
      if (!validIdempotencyKey(idempotencyKey)) {
        return reply.status(400).send({
          error: "invalid_idempotency_key",
          correlationId: currentCorrelationId,
        });
      }

      const parsedRequest = runRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.status(400).send({
          error: "invalid_request",
          issues: parsedRequest.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
          correlationId: currentCorrelationId,
        });
      }
      if (!config.allowedWorkflows.has(parsedRequest.data.workflow)) {
        return reply.status(403).send({
          error: "workflow_not_allowed",
          correlationId: currentCorrelationId,
        });
      }

      const runId = randomUUID();
      const inputDigest = sha256Digest(parsedRequest.data.input);
      const requestDigest = sha256Digest(parsedRequest.data);
      const reservation = await store.reserve(
        idempotencyKey,
        runId,
        parsedRequest.data.workflow,
        requestDigest,
        config.idempotencyLeaseMs,
      );
      if (reservation.state === "conflict") {
        return reply.status(409).send({
          error: "idempotency_key_conflict",
          correlationId: currentCorrelationId,
        });
      }
      if (reservation.state === "completed") {
        if (!verifyRunReceipt(reservation.receipt, config.receiptVerificationKeys)) {
          request.log.error(
            { receiptId: reservation.receipt.receiptId, correlationId: currentCorrelationId },
            "Stored receipt failed signature verification",
          );
          return reply.status(500).send({
            error: "receipt_integrity_failure",
            correlationId: currentCorrelationId,
          });
        }
        if (
          reservation.receipt.workflow !== parsedRequest.data.workflow ||
          reservation.receipt.requestDigest !== requestDigest
        ) {
          return reply.status(409).send({
            error: "idempotency_key_conflict",
            correlationId: currentCorrelationId,
          });
        }
        reply.header("x-idempotent-replay", "true");
        return reply.send(reservation.receipt);
      }
      if (reservation.state === "pending") {
        return reply.status(409).send({
          error: "run_in_progress",
          correlationId: currentCorrelationId,
        });
      }

      const createdAt = new Date();
      const runtimeRequest: RuntimeRequest = {
        schemaVersion: RUNTIME_REQUEST_VERSION,
        runId,
        correlationId: currentCorrelationId,
        idempotencyKey,
        workflow: parsedRequest.data.workflow,
        input: parsedRequest.data.input,
        context: parsedRequest.data.context,
      };

      let unsignedReceipt: UnsignedRunReceipt;
      try {
        const result = await adapter.execute(runtimeRequest);
        const completedAt = new Date();
        unsignedReceipt = {
          schemaVersion: RUN_RECEIPT_VERSION,
          receiptId: randomUUID(),
          runId,
          correlationId: currentCorrelationId,
          idempotencyKey,
          workflow: parsedRequest.data.workflow,
          status: result.status,
          mode: adapter.mode,
          adapter: adapter.kind,
          inputDigest,
          requestDigest,
          result,
          metrics: {
            durationMs: Math.max(0, completedAt.getTime() - createdAt.getTime()),
            ...(result.metrics ? { providerReported: result.metrics } : {}),
          },
          createdAt: createdAt.toISOString(),
          completedAt: completedAt.toISOString(),
        };
      } catch (error) {
        const completedAt = new Date();
        const code = error instanceof AdapterFailure ? error.code : "runtime_unavailable";
        request.log.warn({ err: error, correlationId: currentCorrelationId }, "Runtime execution failed");
        unsignedReceipt = {
          schemaVersion: RUN_RECEIPT_VERSION,
          receiptId: randomUUID(),
          runId,
          correlationId: currentCorrelationId,
          idempotencyKey,
          workflow: parsedRequest.data.workflow,
          status: "failed",
          mode: adapter.mode,
          adapter: adapter.kind,
          inputDigest,
          requestDigest,
          failure: publicFailure(code),
          metrics: { durationMs: Math.max(0, completedAt.getTime() - createdAt.getTime()) },
          createdAt: createdAt.toISOString(),
          completedAt: completedAt.toISOString(),
        };
      }

      const receipt = signRunReceipt(
        unsignedReceipt,
        config.receiptSigningSecret,
        config.receiptSigningKeyId,
      );
      await store.complete(idempotencyKey, reservation.token, receipt);

      return reply.status(receipt.status === "failed" ? 502 : 201).send(receipt);
    },
  );

  app.get(
    "/v1/receipts/:receiptId",
    { preHandler: authenticate(config) },
    async (request, reply) => {
      const parsedParams = z.object({ receiptId: z.uuid() }).safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send({
          error: "invalid_receipt_id",
          correlationId: requestCorrelationId(request),
        });
      }

      const receipt = await store.findByReceiptId(parsedParams.data.receiptId);
      if (!receipt) {
        return reply.status(404).send({
          error: "receipt_not_found",
          correlationId: requestCorrelationId(request),
        });
      }
      if (!verifyRunReceipt(receipt, config.receiptVerificationKeys)) {
        request.log.error(
          { receiptId: receipt.receiptId, correlationId: requestCorrelationId(request) },
          "Stored receipt failed signature verification",
        );
        return reply.status(500).send({
          error: "receipt_integrity_failure",
          correlationId: requestCorrelationId(request),
        });
      }
      return reply.send(receipt);
    },
  );

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, correlationId: requestCorrelationId(request) }, "Operator request failed");
    void reply.status(500).send({
      error: "internal_error",
      correlationId: requestCorrelationId(request),
    });
  });

  app.addHook("onClose", async () => {
    await store.close();
  });

  return app;
}
