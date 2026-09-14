import { PGlite } from "@electric-sql/pglite";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { runMigrations, LATEST_SCHEMA_VERSION } from "../src/store/postgres";
import { PostgresQueenStore, signQueenRecord, verifyQueenRecord, type QueenDatabase } from "../src/queen/store";
import { sha256Digest } from "@starlight/launchpad-contracts/integrity";
import type { QueenRecord } from "../src/queen/contracts";

const config = loadConfig({ NODE_ENV: "test", OPERATOR_API_KEY: "o".repeat(64), RECEIPT_SIGNING_SECRET: "s".repeat(64), RUNTIME_ADAPTER: "mock", ALLOW_MOCK_RUNTIME: "true" });
let db: PGlite;
let store: PostgresQueenStore;
let driver: QueenDatabase;

function record(brand: QueenRecord["brand"] = "starlight", idempotencyKey = "postgres-queen-1") {
  return signQueenRecord({ schemaVersion: "starlight.queen.v1", recordId: randomUUID(), idempotencyKey, kind: "mission", brand, actor: "authenticated-owner", requestDigest: sha256Digest({ brand }), createdAt: new Date().toISOString(), payload: { state: "planned", arbitraryText: "'); DROP TABLE launchpad_queen_records;--" } }, config);
}

describe("Queen PostgreSQL additive migration and immutable records", () => {
  beforeAll(async () => {
    db = new PGlite();
    driver = {
      async query(sql, values) {
        // pg permits multiple statements without parameters; PGlite exposes that via exec.
        if (!values && sql.includes("CREATE TABLE")) {
          const results = await db.exec(sql);
          return { rows: results.at(-1)?.rows as Record<string, unknown>[] ?? [] };
        }
        return db.query(sql, values);
      },
      async end() {},
    };
    await runMigrations(driver as unknown as PoolClient);
    store = new PostgresQueenStore(driver);
  }, 30000);
  afterAll(async () => { await db.close(); });

  it("runs actual transactional migrations idempotently and preserves existing receipts", async () => {
    expect(LATEST_SCHEMA_VERSION).toBe(2);
    await db.query("INSERT INTO launchpad_run_receipts (idempotency_key, run_id, workflow, request_digest, owner_token, state) VALUES ($1,$2,$3,$4,$5,'pending')", ["legacy-preserved", randomUUID(), "research-brief", "a".repeat(64), randomUUID()]);
    // Recreate the deployed v1 upgrade boundary, preserving its existing row.
    await db.exec("DROP TABLE launchpad_queen_records; DELETE FROM launchpad_schema_migrations WHERE version = 2;");
    await runMigrations(driver as unknown as PoolClient);
    await runMigrations(driver as unknown as PoolClient);
    const versions = await db.query<{ version: number }>("SELECT version FROM launchpad_schema_migrations ORDER BY version");
    expect(versions.rows.map((row) => row.version)).toEqual([1, 2]);
    expect((await db.query("SELECT * FROM launchpad_run_receipts WHERE idempotency_key='legacy-preserved'")).rows).toHaveLength(1);
  });

  it("round-trips signatures, prevents overwrite and scopes chronicle reads", async () => {
    const first = record();
    const saved = await store.append("postgres-queen-1", first);
    expect(saved.inserted).toBe(true);
    expect(await store.get(first.recordId)).toEqual(first);
    expect(verifyQueenRecord((await store.get(first.recordId))!, config)).toBe(true);
    const changed = record();
    const replay = await store.append("postgres-queen-1", changed);
    expect(replay.inserted).toBe(false);
    expect(replay.record).toEqual(first);
    expect(await store.get(changed.recordId)).toBeNull();
    const otherBrand = record("arcanea", "postgres-queen-2");
    await store.append("postgres-queen-2", otherBrand);
    expect(await store.list("starlight", 10)).toEqual([first]);
    expect(await store.list("arcanea", 10)).toEqual([otherBrand]);
  });

  it("allows exactly one insert during concurrent replay and preserves JSON text safely", async () => {
    const candidate = record("gencreator", "postgres-concurrent");
    const results = await Promise.all(Array.from({ length: 4 }, () => store.append("postgres-concurrent", candidate)));
    expect(results.filter((result) => result.inserted)).toHaveLength(1);
    expect((await store.get(candidate.recordId))?.payload.arbitraryText).toBe(candidate.payload.arbitraryText);
    expect(await store.getByKey("postgres-concurrent")).toEqual(candidate);
    await db.query("UPDATE launchpad_queen_records SET idempotency_key = 'reassigned-key' WHERE record_id = $1", [candidate.recordId]);
    await expect(store.getByKey("reassigned-key")).rejects.toThrow("metadata failed integrity");
  });


  it("fails closed when unsigned query metadata contradicts signed content", async () => {
    const candidate = record("starlight", "postgres-metadata-tamper");
    await store.append("postgres-metadata-tamper", candidate);
    await db.query("UPDATE launchpad_queen_records SET brand = 'arcanea' WHERE record_id = $1", [candidate.recordId]);
    await expect(store.list("arcanea", 100)).rejects.toThrow("metadata failed integrity");
    await db.query("UPDATE launchpad_queen_records SET brand = 'starlight', request_digest = $2 WHERE record_id = $1", [candidate.recordId, "b".repeat(64)]);
    await expect(store.get(candidate.recordId)).rejects.toThrow("metadata failed integrity");
    await db.query("UPDATE launchpad_queen_records SET request_digest = $2, record_id = $3 WHERE record_id = $1", [candidate.recordId, candidate.requestDigest, randomUUID()]);
    await expect(store.getByKey("postgres-metadata-tamper")).rejects.toThrow("metadata failed integrity");
  });

  it("detects changed signed content and supports key rotation", async () => {
    const candidate = record("starlight", "postgres-tamper");
    await store.append("postgres-tamper", candidate);
    await db.query("UPDATE launchpad_queen_records SET record = jsonb_set(record, '{payload,state}', '\"executed\"'::jsonb) WHERE record_id = $1", [candidate.recordId]);
    const tampered = (await store.get(candidate.recordId))!;
    expect(verifyQueenRecord(tampered, config)).toBe(false);
    const rotated = { ...config, receiptSigningSecret: "r".repeat(64), receiptSigningKeyId: "rotated", receiptVerificationKeys: { ...config.receiptVerificationKeys, rotated: "r".repeat(64) } };
    expect(verifyQueenRecord(candidate, rotated)).toBe(true);
  });
});
