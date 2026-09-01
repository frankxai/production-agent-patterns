import { randomUUID } from "node:crypto";

import { runReceiptSchema, type RunReceipt } from "@starlight/launchpad-contracts";
import { Pool } from "pg";

import type { ReceiptStore, ReservationResult } from "./types";

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS launchpad_run_receipts (
    idempotency_key TEXT PRIMARY KEY,
    run_id UUID NOT NULL,
    workflow TEXT NOT NULL,
    input_digest CHAR(64) NOT NULL,
    owner_token UUID NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'completed')),
    receipt_id UUID UNIQUE,
    receipt JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
      (state = 'pending' AND receipt_id IS NULL AND receipt IS NULL)
      OR (state = 'completed' AND receipt_id IS NOT NULL AND receipt IS NOT NULL)
    )
  );
  CREATE INDEX IF NOT EXISTS launchpad_run_receipts_updated_at_idx
    ON launchpad_run_receipts (updated_at DESC);
`;

interface ReceiptRow {
  state: "pending" | "completed";
  workflow: string;
  input_digest: string;
  receipt: unknown | null;
}

export class PostgresReceiptStore implements ReceiptStore {
  readonly kind = "postgres" as const;
  readonly durable = true;
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
  }

  async initialize(migrate: boolean): Promise<void> {
    if (migrate) {
      await this.pool.query(MIGRATION_SQL);
    }
    await this.pool.query("SELECT 1");
  }

  async health(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async reserve(
    idempotencyKey: string,
    runId: string,
    workflow: string,
    inputDigest: string,
    leaseMs: number,
  ): Promise<ReservationResult> {
    const token = randomUUID();
    const inserted = await this.pool.query<ReceiptRow>(
      `INSERT INTO launchpad_run_receipts
        (idempotency_key, run_id, workflow, input_digest, owner_token, state)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING state, workflow, input_digest, receipt`,
      [idempotencyKey, runId, workflow, inputDigest, token],
    );
    if (inserted.rowCount === 1) {
      return { state: "reserved", token };
    }

    const existing = await this.pool.query<ReceiptRow>(
      "SELECT state, workflow, input_digest, receipt FROM launchpad_run_receipts WHERE idempotency_key = $1",
      [idempotencyKey],
    );
    const row = existing.rows[0];
    if (row?.state === "completed" && row.receipt) {
      return { state: "completed", receipt: runReceiptSchema.parse(row.receipt) };
    }

    const claimed = await this.pool.query(
      `UPDATE launchpad_run_receipts
       SET run_id = $2, workflow = $3, input_digest = $4, owner_token = $5, updated_at = NOW()
       WHERE idempotency_key = $1
         AND state = 'pending'
         AND updated_at < NOW() - ($6::double precision * INTERVAL '1 millisecond')
       RETURNING idempotency_key`,
      [idempotencyKey, runId, workflow, inputDigest, token, leaseMs],
    );
    return claimed.rowCount === 1
      ? { state: "reserved", token }
      : {
          state: "pending",
          workflow: row?.workflow ?? "unknown",
          inputDigest: row?.input_digest ?? "unknown",
        };
  }

  async complete(
    idempotencyKey: string,
    reservationToken: string,
    receipt: RunReceipt,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE launchpad_run_receipts
       SET state = 'completed', receipt_id = $3, receipt = $4::jsonb, updated_at = NOW()
       WHERE idempotency_key = $1 AND owner_token = $2 AND state = 'pending'`,
      [idempotencyKey, reservationToken, receipt.receiptId, JSON.stringify(receipt)],
    );
    if (result.rowCount !== 1) {
      throw new Error("The idempotency reservation is no longer owned by this run");
    }
  }

  async findByReceiptId(receiptId: string): Promise<RunReceipt | null> {
    const result = await this.pool.query<{ receipt: unknown }>(
      "SELECT receipt FROM launchpad_run_receipts WHERE receipt_id = $1 AND state = 'completed'",
      [receiptId],
    );
    const row = result.rows[0];
    return row ? runReceiptSchema.parse(row.receipt) : null;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export async function migrateDatabase(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await pool.query(MIGRATION_SQL);
  } finally {
    await pool.end();
  }
}
