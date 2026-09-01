import { z } from "zod";

export const RUN_REQUEST_VERSION = "starlight.run-request.v1" as const;
export const RUNTIME_REQUEST_VERSION = "starlight.runtime-request.v1" as const;
export const RUNTIME_RESULT_VERSION = "starlight.runtime-result.v1" as const;
export const RUN_RECEIPT_VERSION = "starlight.run-receipt.v1" as const;
export const RECEIPT_SIGNATURE_ALGORITHM = "hmac-sha256" as const;
export const HEALTH_RESPONSE_VERSION = "starlight.health.v1" as const;

const workflowNameSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase kebab-case workflow name");

const safeLabelSchema = z.string().trim().min(1).max(160);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const runContextSchema = z
  .object({
    requestedBy: z.string().trim().min(1).max(120).optional(),
    source: z.enum(["cockpit", "api", "automation"]).default("cockpit"),
    tags: z.array(z.string().trim().min(1).max(48)).max(12).default([]),
  })
  .strict();

export const runRequestSchema = z
  .object({
    schemaVersion: z.literal(RUN_REQUEST_VERSION),
    workflow: workflowNameSchema,
    input: z.record(z.string().min(1).max(80), z.json()),
    context: runContextSchema.default({ source: "cockpit", tags: [] }),
  })
  .strict();

export const runtimeRequestSchema = z
  .object({
    schemaVersion: z.literal(RUNTIME_REQUEST_VERSION),
    runId: z.uuid(),
    correlationId: z.string().min(8).max(128),
    idempotencyKey: z.string().min(8).max(128),
    workflow: workflowNameSchema,
    input: z.record(z.string().min(1).max(80), z.json()),
    context: runContextSchema,
  })
  .strict();

export const artifactReferenceSchema = z
  .object({
    kind: z.enum(["document", "dataset", "image", "link", "other"]),
    label: safeLabelSchema,
    uri: z
      .string()
      .url()
      .max(2_048)
      .refine((value) => new URL(value).protocol === "https:", "Artifact URIs must use HTTPS"),
    sha256: sha256Schema.optional(),
  })
  .strict();

export const providerMetricsSchema = z
  .object({
    model: z.string().trim().min(1).max(120).optional(),
    tokensIn: z.number().int().nonnegative().optional(),
    tokensOut: z.number().int().nonnegative().optional(),
    costUsd: z.number().nonnegative().finite().optional(),
  })
  .strict();

export const runtimeResultSchema = z
  .object({
    schemaVersion: z.literal(RUNTIME_RESULT_VERSION),
    status: z.enum(["accepted", "rejected"]),
    summary: z.string().trim().min(1).max(2_000),
    artifacts: z.array(artifactReferenceSchema).max(20).default([]),
    metrics: providerMetricsSchema.optional(),
  })
  .strict();

export const unsignedRunReceiptSchema = z
  .object({
    schemaVersion: z.literal(RUN_RECEIPT_VERSION),
    receiptId: z.uuid(),
    runId: z.uuid(),
    correlationId: z.string().min(8).max(128),
    idempotencyKey: z.string().min(8).max(128),
    workflow: workflowNameSchema,
    status: z.enum(["accepted", "rejected", "failed"]),
    mode: z.enum(["simulation", "runtime"]),
    adapter: z.enum(["mock", "http"]),
    inputDigest: sha256Schema,
    requestDigest: sha256Schema,
    result: runtimeResultSchema.optional(),
    failure: z
      .object({
        code: z.enum(["runtime_timeout", "runtime_unavailable", "invalid_runtime_result"]),
        summary: z.string().trim().min(1).max(240),
      })
      .strict()
      .optional(),
    metrics: z
      .object({
        durationMs: z.number().int().nonnegative(),
        providerReported: providerMetricsSchema.optional(),
      })
      .strict(),
    createdAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.status === "failed" && !receipt.failure) {
      context.addIssue({
        code: "custom",
        message: "A failed receipt requires failure metadata",
        path: ["failure"],
      });
    }
    if (receipt.status !== "failed" && !receipt.result) {
      context.addIssue({
        code: "custom",
        message: "A completed receipt requires a runtime result",
        path: ["result"],
      });
    }
  });

export const receiptSignatureSchema = z
  .object({
    algorithm: z.literal(RECEIPT_SIGNATURE_ALGORITHM),
    keyId: z
      .string()
      .min(1)
      .max(120)
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
        "Receipt key IDs must use only letters, numbers, dot, underscore, colon, or hyphen",
      ),
    value: sha256Schema,
  })
  .strict();

export const runReceiptSchema = unsignedRunReceiptSchema.and(
  z.object({ signature: receiptSignatureSchema }).strict(),
);

export const healthResponseSchema = z
  .object({
    schemaVersion: z.literal(HEALTH_RESPONSE_VERSION),
    status: z.enum(["ok", "unavailable"]),
    service: z.literal("starlight-launchpad-operator"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    timestamp: z.string().datetime({ offset: true }),
  })
  .strict();

export const architectureResponseSchema = z
  .object({
    schemaVersion: z.literal("starlight.architecture.v1"),
    service: z.string().min(1).max(120),
    runtime: z.object({ adapter: z.enum(["mock", "http"]), configured: z.boolean() }).strict(),
    receiptStore: z.object({ kind: z.enum(["memory", "postgres"]), durable: z.boolean() }).strict(),
    capabilities: z
      .object({
        idempotentRuns: z.literal(true),
        signedReceipts: z.literal(true),
        receiptLookup: z.literal(true),
      })
      .strict(),
    contracts: z
      .object({
        runRequest: z.literal(RUN_REQUEST_VERSION),
        runtimeRequest: z.literal(RUNTIME_REQUEST_VERSION),
        runtimeResult: z.literal(RUNTIME_RESULT_VERSION),
        runReceipt: z.literal(RUN_RECEIPT_VERSION),
      })
      .strict(),
  })
  .strict();

export type RunRequest = z.infer<typeof runRequestSchema>;
export type RuntimeRequest = z.infer<typeof runtimeRequestSchema>;
export type RuntimeResult = z.infer<typeof runtimeResultSchema>;
export type UnsignedRunReceipt = z.infer<typeof unsignedRunReceiptSchema>;
export type RunReceipt = z.infer<typeof runReceiptSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ArchitectureResponse = z.infer<typeof architectureResponseSchema>;
