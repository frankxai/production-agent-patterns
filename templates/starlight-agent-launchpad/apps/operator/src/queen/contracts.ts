import { z } from "zod";

export const QUEEN_VERSION = "starlight.queen.v1" as const;
export const brandSchema = z.enum(["starlight", "gencreator", "arcanea"]);
const shortText = z.string().trim().min(1).max(500);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const evidenceRefSchema = z.object({
  uri: z.string().url().max(2048).refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Evidence must use credential-free HTTPS"),
  sha256: digestSchema,
}).strict();

export const missionInputSchema = z.object({
  brand: brandSchema,
  objective: shortText,
  ownerMandate: shortText,
  acceptanceCriteria: z.array(shortText).min(1).max(6),
  evidence: z.array(evidenceRefSchema).max(12).default([]),
  assumptions: z.array(shortText).max(6).default([]),
  budgetUsd: z.number().finite().min(0).max(100).default(0),
  repositories: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/)).min(1).max(4),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export const evidenceInputSchema = z.object({
  brand: brandSchema,
  missionId: z.uuid(),
  statement: shortText,
  kind: z.enum(["observation", "hypothesis", "decision", "lesson", "artifact"]),
  sources: z.array(evidenceRefSchema).min(1).max(8),
  supersedes: z.uuid().optional(),
  executionReceiptId: z.uuid().optional(),
}).strict();

export const queenRecordSchema = z.object({
  schemaVersion: z.literal(QUEEN_VERSION),
  recordId: z.uuid(),
  idempotencyKey: z.string().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/),
  kind: z.enum(["mission", "evidence"]),
  brand: brandSchema,
  actor: z.literal("authenticated-owner"),
  requestDigest: digestSchema,
  createdAt: z.string().datetime({ offset: true }),
  payload: z.record(z.string(), z.json()),
  signature: z.object({
    algorithm: z.literal("hmac-sha256"),
    keyId: z.string().min(1).max(120),
    value: digestSchema,
  }).strict(),
}).strict();

export type Brand = z.infer<typeof brandSchema>;
export type MissionInput = z.infer<typeof missionInputSchema>;
export type EvidenceInput = z.infer<typeof evidenceInputSchema>;
export type QueenRecord = z.infer<typeof queenRecordSchema>;
