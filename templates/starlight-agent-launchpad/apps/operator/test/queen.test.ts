import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../src/config";
import { buildOperator } from "../src/server";
import { MemoryQueenStore, verifyQueenRecord } from "../src/queen/store";
import { MemoryReceiptStore } from "../src/store/memory";
import { queenRecordSchema } from "../src/queen/contracts";
import { signRunReceipt, sha256Digest } from "@starlight/launchpad-contracts/integrity";

const config = loadConfig({ NODE_ENV: "test", OPERATOR_API_KEY: "o".repeat(64), RECEIPT_SIGNING_SECRET: "s".repeat(64), RUNTIME_ADAPTER: "mock", ALLOW_MOCK_RUNTIME: "true" });
const body = () => ({
  brand: "starlight", objective: "Build a bounded working specimen", ownerMandate: "Owner authorizes preparation and evidence capture only",
  acceptanceCriteria: ["Artifact demonstrates the agreed behavior"], evidence: [], assumptions: ["Current branch must be inspected"], budgetUsd: 5,
  repositories: ["frankxai/Starlight-Intelligence-System"], expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});
const headers = (key = "queen-test-00001") => ({ authorization: `Bearer ${config.operatorApiKey}`, "idempotency-key": key });
let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

describe("Queen coordination boundary", () => {
  it("exposes honest public capabilities without secrets or invented workers", async () => {
    app = await buildOperator({ config });
    const catalog = await app.inject({ method: "GET", url: "/v1/queen" });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json()).toMatchObject({ coordination: "deterministic", autonomousExecution: false, continuousWorkers: false, modelDispatch: "not_configured" });
    expect(catalog.json().roles.every((role: { instancesRunning: number }) => role.instancesRunning === 0)).toBe(true);
    expect(catalog.body).not.toContain(config.operatorApiKey);
    expect(catalog.body).not.toContain(config.receiptSigningSecret);
  });

  it("authenticates every private read and write before mutation", async () => {
    app = await buildOperator({ config });
    for (const route of ["/v1/queen/missions", "/v1/queen/intake", "/v1/queen/evidence"]) {
      expect((await app.inject({ method: "POST", url: route, payload: body() })).statusCode).toBe(401);
    }
    for (const route of ["/v1/queen/chronicle?brand=starlight", `/v1/queen/missions/${randomUUID()}`, `/v1/queen/evidence/${randomUUID()}`]) {
      expect((await app.inject({ method: "GET", url: route })).statusCode).toBe(401);
    }
  });

  it("persists a skill-equipped plan once and rejects conflicting replays", async () => {
    app = await buildOperator({ config });
    const payload = body();
    const request = { method: "POST" as const, url: "/v1/queen/missions", headers: headers(), payload };
    const created = await app.inject(request);
    expect(created.statusCode).toBe(201);
    const record = queenRecordSchema.parse(created.json());
    expect(verifyQueenRecord(record, config)).toBe(true);
    expect(record.payload).toMatchObject({ state: "planned", authority: { mayExecute: false }, budget: { spentUsd: 0, authorizedSpendUsd: 0 } });
    const tasks = record.payload.tasks as { role: string; reviewer: string; effectsAuthorized: boolean }[];
    expect(tasks).toHaveLength(5);
    expect(tasks.every((task) => task.role !== task.reviewer && !task.effectsAuthorized)).toBe(true);
    expect((record.payload.skills as unknown[]).length).toBeGreaterThan(0);
    const replay = await app.inject(request);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["x-idempotent-replay"]).toBe("true");
    expect(replay.json()).toEqual(created.json());
    const conflict = await app.inject({ ...request, payload: { ...payload, objective: "Different objective" } });
    expect(conflict.statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: `/v1/queen/missions/${record.recordId}`, headers: headers() })).json()).toEqual(record);
  });

  it("deduplicates concurrent identical intakes", async () => {
    app = await buildOperator({ config });
    const payload = body();
    const results = await Promise.all(Array.from({ length: 4 }, () => app!.inject({ method: "POST", url: "/v1/queen/missions", headers: headers(), payload })));
    expect(results.filter((result) => result.statusCode === 201)).toHaveLength(1);
    expect(new Set(results.map((result) => result.json().recordId)).size).toBe(1);
  });

  it("rejects scope escalation, expired mandates, excessive budgets and identity forgery", async () => {
    app = await buildOperator({ config });
    const base = body();
    for (const [change, status] of [
      [{ repositories: ["other-owner/private-repo"] }, 403],
      [{ expiresAt: "2000-01-01T00:00:00.000Z" }, 403],
      [{ budgetUsd: 101 }, 400],
      [{ actor: "king" }, 400],
      [{ objective: "x".repeat(501) }, 400],
    ] as const) {
      const result = await app.inject({ method: "POST", url: "/v1/queen/missions", headers: headers(), payload: { ...base, ...change } });
      expect(result.statusCode).toBe(status);
    }
    const oversized = await app.inject({ method: "POST", url: "/v1/queen/missions", headers: headers(), payload: { ...base, objective: "x".repeat(25000) } });
    expect(oversized.statusCode).toBe(413);
    const invalid = await app.inject({ method: "POST", url: "/v1/queen/missions", headers: { ...headers(), "idempotency-key": "bad" }, payload: base });
    expect(invalid.statusCode).toBe(400);
  });

  it("keeps evidence draft, immutable, brand-scoped and bounded in the chronicle", async () => {
    app = await buildOperator({ config });
    const mission = (await app.inject({ method: "POST", url: "/v1/queen/missions", headers: headers(), payload: body() })).json();
    const evidence = { brand: "starlight", missionId: mission.recordId, statement: "Candidate observation", kind: "observation", sources: [{ uri: "https://example.com/source", sha256: "a".repeat(64) }] };
    const created = await app.inject({ method: "POST", url: "/v1/queen/evidence", headers: headers("queen-evidence-001"), payload: evidence });
    expect(created.statusCode).toBe(201);
    expect(created.json().payload).toMatchObject({ state: "draft", sourcesFetched: false, semanticTruthVerified: false });
    const forged = await app.inject({ method: "POST", url: "/v1/queen/evidence", headers: headers("queen-evidence-002"), payload: { ...evidence, state: "verified" } });
    expect(forged.statusCode).toBe(400);
    const crossBrand = await app.inject({ method: "POST", url: "/v1/queen/evidence", headers: headers("queen-evidence-003"), payload: { ...evidence, brand: "arcanea" } });
    expect(crossBrand.statusCode).toBe(404);
    const correction = await app.inject({ method: "POST", url: "/v1/queen/evidence", headers: headers("queen-evidence-004"), payload: { ...evidence, statement: "Corrected observation", supersedes: created.json().recordId } });
    expect(correction.statusCode).toBe(201);
    const original = await app.inject({ method: "GET", url: `/v1/queen/evidence/${created.json().recordId}`, headers: headers() });
    expect(original.json().payload.statement).toBe("Candidate observation");
    const chronicle = await app.inject({ method: "GET", url: "/v1/queen/chronicle?brand=starlight&limit=2", headers: headers() });
    expect(chronicle.json().records).toHaveLength(2);
    const other = await app.inject({ method: "GET", url: "/v1/queen/chronicle?brand=arcanea", headers: headers() });
    expect(other.json().records).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/v1/queen/chronicle?brand=starlight&limit=101", headers: headers() })).statusCode).toBe(400);
  });

  it("rejects missing execution evidence and links exact accepted runtime artifacts without claiming truth", async () => {
    const receipts = new MemoryReceiptStore();
    app = await buildOperator({ config, store: receipts });
    const mission = (await app.inject({ method: "POST", url: "/v1/queen/missions", headers: headers(), payload: body() })).json();
    const source = { uri: "https://example.com/artifact", sha256: "b".repeat(64) };
    const evidence = { brand: "starlight", missionId: mission.recordId, statement: "Artifact generated", kind: "artifact", sources: [source], executionReceiptId: randomUUID() };
    expect((await app.inject({ method: "POST", url: "/v1/queen/evidence", headers: headers("queen-runtime-link-1"), payload: evidence })).statusCode).toBe(422);
    const id = randomUUID();
    const digest = sha256Digest({});
    const reservation = await receipts.reserve("runtime-artifact-key", id, "research-brief", digest, 180000);
    if (reservation.state !== "reserved") throw new Error("test reservation failed");
    const receipt = signRunReceipt({ schemaVersion: "starlight.run-receipt.v1", receiptId: evidence.executionReceiptId, runId: id, correlationId: "queen-correlation", idempotencyKey: "runtime-artifact-key", workflow: "research-brief", status: "accepted", mode: "runtime", adapter: "http", inputDigest: digest, requestDigest: digest, result: { schemaVersion: "starlight.runtime-result.v1", status: "accepted", summary: "Real runtime fixture", artifacts: [{ ...source, kind: "document", label: "Artifact" }] }, metrics: { durationMs: 3 }, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() }, config.receiptSigningSecret, config.receiptSigningKeyId);
    await receipts.complete("runtime-artifact-key", reservation.token, receipt);
    const linked = await app.inject({ method: "POST", url: "/v1/queen/evidence", headers: headers("queen-runtime-link-2"), payload: evidence });
    expect(linked.statusCode).toBe(201);
    expect(linked.json().payload).toMatchObject({ artifactReceiptLinked: true, missionExecutionVerified: false, semanticTruthVerified: false, state: "draft" });
    const mismatch = await app.inject({ method: "POST", url: "/v1/queen/evidence", headers: headers("queen-runtime-link-3"), payload: { ...evidence, sources: [{ ...source, sha256: "a".repeat(64) }] } });
    expect(mismatch.statusCode).toBe(422);
  });

  it("fails closed on memory tampering", async () => {
    class TamperedStore extends MemoryQueenStore {
      tamper = false;
      override async get(id: string) {
        const record = await super.get(id);
        if (record && this.tamper) record.payload.state = "executed";
        return record;
      }
    }
    const queenStore = new TamperedStore();
    app = await buildOperator({ config, queenStore });
    const mission = (await app.inject({ method: "POST", url: "/v1/queen/missions", headers: headers(), payload: body() })).json();
    queenStore.tamper = true;
    const result = await app.inject({ method: "GET", url: `/v1/queen/missions/${mission.recordId}`, headers: headers() });
    expect(result.statusCode).toBe(500);
    expect(result.body).not.toContain("executed");
  });
});
