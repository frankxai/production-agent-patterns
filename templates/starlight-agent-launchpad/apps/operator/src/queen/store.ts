import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "@starlight/launchpad-contracts/integrity";
import { Pool } from "pg";
import type { OperatorConfig } from "../config";
import { queenRecordSchema, type Brand, type QueenRecord } from "./contracts";

export const QUEEN_MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS launchpad_queen_records (
    idempotency_key TEXT PRIMARY KEY,
    request_digest CHAR(64) NOT NULL,
    record_id UUID NOT NULL UNIQUE,
    brand TEXT NOT NULL CHECK (brand IN ('starlight', 'gencreator', 'arcanea')),
    kind TEXT NOT NULL CHECK (kind IN ('mission', 'evidence')),
    record JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS launchpad_queen_records_brand_time_idx
    ON launchpad_queen_records (brand, created_at DESC);
`;

export type UnsignedQueenRecord = Omit<QueenRecord, "signature">;
function signaturePayload(record: UnsignedQueenRecord, keyId: string) {
  return canonicalJson({ domain: "starlight.queen-record.v1", algorithm: "hmac-sha256", keyId, record });
}
export function signQueenRecord(record: UnsignedQueenRecord, config: OperatorConfig): QueenRecord {
  return queenRecordSchema.parse({ ...record, signature: {
    algorithm: "hmac-sha256",
    keyId: config.receiptSigningKeyId,
    value: createHmac("sha256", config.receiptSigningSecret).update(signaturePayload(record, config.receiptSigningKeyId)).digest("hex"),
  } });
}
export function verifyQueenRecord(record: QueenRecord, config: OperatorConfig): boolean {
  const parsed = queenRecordSchema.safeParse(record);
  if (!parsed.success) return false;
  const { signature, ...body } = parsed.data;
  if (!Object.prototype.hasOwnProperty.call(config.receiptVerificationKeys, signature.keyId)) return false;
  const secret = config.receiptVerificationKeys[signature.keyId];
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(signaturePayload(body, signature.keyId)).digest();
  const actual = Buffer.from(signature.value, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface QueenStore {
  readonly durable: boolean;
  getByKey(key: string): Promise<QueenRecord | null>;
  append(key: string, record: QueenRecord): Promise<{ inserted: boolean; record: QueenRecord }>;
  get(id: string): Promise<QueenRecord | null>;
  list(brand: Brand, limit: number): Promise<QueenRecord[]>;
  close(): Promise<void>;
}

export class MemoryQueenStore implements QueenStore {
  readonly durable = false;
  private readonly records = new Map<string, QueenRecord>();
  async getByKey(key: string) { return structuredClone(this.records.get(key) ?? null); }
  async append(key: string, record: QueenRecord) {
    if (record.idempotencyKey !== key) throw new Error("Queen idempotency identity mismatch");
    const previous = this.records.get(key);
    if (previous) return { inserted: false, record: structuredClone(previous) };
    this.records.set(key, structuredClone(record));
    return { inserted: true, record: structuredClone(record) };
  }
  async get(id: string) { return structuredClone([...this.records.values()].find((record) => record.recordId === id) ?? null); }
  async list(brand: Brand, limit: number) {
    return structuredClone([...this.records.values()].filter((record) => record.brand === brand).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit));
  }
  async close() {}
}

export interface QueenDatabase {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}
export class PostgresQueenStore implements QueenStore {
  readonly durable = true;
  private readonly db: QueenDatabase;
  constructor(database: string | QueenDatabase) {
    this.db = typeof database === "string" ? new Pool({ connectionString: database, max: 3, connectionTimeoutMillis: 5000, query_timeout: 5000, application_name: "starlight-queen-coordination" }) : database;
  }
  private read(row: Record<string, unknown> | undefined): QueenRecord | null {
    if (!row) return null;
    const record = queenRecordSchema.parse(row.record);
    if (row.idempotency_key !== record.idempotencyKey || row.record_id !== record.recordId || row.brand !== record.brand || row.kind !== record.kind || row.request_digest !== record.requestDigest) {
      throw new Error("Queen record index metadata failed integrity verification");
    }
    return record;
  }
  async getByKey(key: string) {
    return this.read((await this.db.query("SELECT idempotency_key, record_id, brand, kind, request_digest, record FROM launchpad_queen_records WHERE idempotency_key = $1", [key])).rows[0]);
  }
  async append(key: string, record: QueenRecord) {
    if (record.idempotencyKey !== key) throw new Error("Queen idempotency identity mismatch");
    const result = await this.db.query(
      "INSERT INTO launchpad_queen_records (idempotency_key, request_digest, record_id, brand, kind, record, created_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz) ON CONFLICT (idempotency_key) DO NOTHING RETURNING idempotency_key, record_id, brand, kind, request_digest, record",
      [key, record.requestDigest, record.recordId, record.brand, record.kind, JSON.stringify(record), record.createdAt],
    );
    const inserted = this.read(result.rows[0]);
    if (inserted) return { inserted: true, record: inserted };
    const previous = await this.getByKey(key);
    if (!previous) throw new Error("Queen idempotency record disappeared");
    return { inserted: false, record: previous };
  }
  async get(id: string) {
    const record = this.read((await this.db.query("SELECT idempotency_key, record_id, brand, kind, request_digest, record FROM launchpad_queen_records WHERE record_id = $1", [id])).rows[0]);
    if (record && record.recordId !== id) throw new Error("Queen record identity mismatch");
    return record;
  }
  async list(brand: Brand, limit: number) {
    const result = await this.db.query("SELECT idempotency_key, record_id, brand, kind, request_digest, record FROM launchpad_queen_records WHERE brand = $1 ORDER BY created_at DESC, record_id DESC LIMIT $2", [brand, limit]);
    return result.rows.map((row) => {
      const record = this.read(row);
      if (!record || record.brand !== brand) throw new Error("Queen chronicle scope mismatch");
      return record;
    });
  }
  async close() { await this.db.end(); }
}
