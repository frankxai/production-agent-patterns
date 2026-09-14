import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sha256Digest, verifyRunReceipt } from "@starlight/launchpad-contracts/integrity";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { OperatorConfig } from "../config";
import { validIdempotencyKey } from "../security";
import type { ReceiptStore } from "../store";
import { brandSchema, evidenceInputSchema, missionInputSchema, QUEEN_VERSION, type QueenRecord } from "./contracts";
import { courtCatalog } from "./court";
import { planMission, validateMissionScope } from "./planner";
import { signQueenRecord, verifyQueenRecord, type QueenStore } from "./store";

export interface QueenDependencies {
  config: OperatorConfig;
  store: QueenStore;
  receipts: ReceiptStore;
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

export async function registerQueenRoutes(app: FastifyInstance, dependencies: QueenDependencies) {
  const { config, store, receipts, authenticate } = dependencies;
  const protectedRoute = { preHandler: authenticate, bodyLimit: 24 * 1024 };

  function assertIntegrity(record: QueenRecord): QueenRecord {
    if (!verifyQueenRecord(record, config)) throw new Error("Queen record integrity verification failed");
    return record;
  }

  async function replay(key: string, digest: string, reply: FastifyReply): Promise<boolean> {
    const record = await store.getByKey(key);
    if (!record) return false;
    assertIntegrity(record);
    if (record.idempotencyKey !== key) throw new Error("Queen idempotency identity mismatch");
    if (record.requestDigest !== digest) {
      await reply.status(409).send({ error: "idempotency_key_conflict" });
    } else {
      reply.header("x-idempotent-replay", "true");
      await reply.send(record);
    }
    return true;
  }

  async function append(key: string, record: QueenRecord, reply: FastifyReply) {
    const saved = await store.append(key, record);
    assertIntegrity(saved.record);
    if (saved.record.requestDigest !== record.requestDigest) return reply.status(409).send({ error: "idempotency_key_conflict" });
    if (!saved.inserted) reply.header("x-idempotent-replay", "true");
    return reply.status(saved.inserted ? 201 : 200).send(saved.record);
  }

  app.get("/queen", async (_request, reply) => {
    const page = await readFile(new URL("../public/queen.html", import.meta.url), "utf8").catch(() =>
      readFile(new URL("../../public/queen.html", import.meta.url), "utf8"));
    return reply.type("text/html; charset=utf-8").send(page);
  });

  app.get("/v1/queen", async (_request, reply) => reply.send({
    ...courtCatalog(),
    memory: { durable: store.durable, scope: "brand-and-mission", claims: "draft-until-reviewed" },
    modelDispatch: "not_configured",
    runtimeBoundary: "Existing /v1/runs remains separately authenticated; Queen coordination does not dispatch it.",
    routes: { catalog: "/v1/queen", missions: "/v1/queen/missions", evidence: "/v1/queen/evidence", chronicle: "/v1/queen/chronicle" },
  }));

  const intake = async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.headers["idempotency-key"];
    if (!validIdempotencyKey(key)) return reply.status(400).send({ error: "invalid_idempotency_key" });
    const parsed = missionInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_mission", issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
    const digest = sha256Digest({ operation: "queen-mission", input: parsed.data });
    const storageKey = `queen:mission:${key}`;
    if (await replay(storageKey, digest, reply)) return reply;
    const scopeError = validateMissionScope(parsed.data);
    if (scopeError) return reply.status(403).send({ error: scopeError });
    const record = signQueenRecord({
      schemaVersion: QUEEN_VERSION,
      recordId: randomUUID(),
      idempotencyKey: storageKey,
      kind: "mission",
      brand: parsed.data.brand,
      actor: "authenticated-owner",
      requestDigest: digest,
      createdAt: new Date().toISOString(),
      payload: JSON.parse(JSON.stringify(planMission(parsed.data))) as QueenRecord["payload"],
    }, config);
    return append(storageKey, record, reply);
  };
  app.post("/v1/queen/missions", protectedRoute, intake);
  app.post("/v1/queen/intake", protectedRoute, intake);

  app.post("/v1/queen/evidence", protectedRoute, async (request, reply) => {
    const key = request.headers["idempotency-key"];
    if (!validIdempotencyKey(key)) return reply.status(400).send({ error: "invalid_idempotency_key" });
    const parsed = evidenceInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_evidence" });
    const input = parsed.data;
    const digest = sha256Digest({ operation: "queen-evidence", input });
    const storageKey = `queen:evidence:${key}`;
    if (await replay(storageKey, digest, reply)) return reply;
    const mission = await store.get(input.missionId);
    if (!mission || assertIntegrity(mission).kind !== "mission" || mission.brand !== input.brand) return reply.status(404).send({ error: "mission_not_found_in_scope" });
    if (input.supersedes) {
      const previous = await store.get(input.supersedes);
      if (!previous || assertIntegrity(previous).kind !== "evidence" || previous.brand !== input.brand || previous.payload.missionId !== input.missionId) return reply.status(403).send({ error: "supersession_outside_mission_scope" });
    }
    let artifactReceiptLinked = false;
    if (input.executionReceiptId) {
      const receipt = await receipts.findByReceiptId(input.executionReceiptId);
      if (!receipt || !verifyRunReceipt(receipt, config.receiptVerificationKeys) || receipt.mode !== "runtime" || receipt.status !== "accepted") return reply.status(422).send({ error: "execution_receipt_not_accepted_runtime_evidence" });
      artifactReceiptLinked = input.sources.some((source) => receipt.result?.artifacts.some((artifact) => artifact.uri === source.uri && artifact.sha256 === source.sha256));
      if (!artifactReceiptLinked) return reply.status(422).send({ error: "execution_receipt_artifact_mismatch" });
    }
    const record = signQueenRecord({
      schemaVersion: QUEEN_VERSION,
      recordId: randomUUID(),
      idempotencyKey: storageKey,
      kind: "evidence",
      brand: input.brand,
      actor: "authenticated-owner",
      requestDigest: digest,
      createdAt: new Date().toISOString(),
      payload: JSON.parse(JSON.stringify({ ...input, state: "draft", epistemicStatus: "owner-supplied-source-reference", sourcesFetched: false, contentHashesVerified: false, artifactReceiptLinked, semanticTruthVerified: false, missionExecutionVerified: false })) as QueenRecord["payload"],
    }, config);
    return append(storageKey, record, reply);
  });

  for (const [route, kind] of [["missions", "mission"], ["evidence", "evidence"]] as const) {
    app.get(`/v1/queen/${route}/:id`, protectedRoute, async (request, reply) => {
      const parsed = z.object({ id: z.uuid() }).strict().safeParse(request.params);
      if (!parsed.success) return reply.status(400).send({ error: "invalid_record_id" });
      const record = await store.get(parsed.data.id);
      if (record && assertIntegrity(record).recordId !== parsed.data.id) throw new Error("Queen record identity mismatch");
      if (!record || assertIntegrity(record).kind !== kind) return reply.status(404).send({ error: "record_not_found" });
      return reply.send(record);
    });
  }

  app.get("/v1/queen/chronicle", protectedRoute, async (request, reply) => {
    const parsed = z.object({ brand: brandSchema, limit: z.coerce.number().int().min(1).max(100).default(25) }).strict().safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_chronicle_scope" });
    const records = (await store.list(parsed.data.brand, parsed.data.limit)).map(assertIntegrity);
    if (records.some((record) => record.brand !== parsed.data.brand)) throw new Error("Queen chronicle scope mismatch");
    return reply.send({ schemaVersion: "starlight.chronicle.v1", brand: parsed.data.brand, records, claimsVerified: false });
  });
}
