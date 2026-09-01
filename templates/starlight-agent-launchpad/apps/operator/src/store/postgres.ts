import { randomUUID } from "node:crypto";

import { runReceiptSchema, type RunReceipt } from "@starlight/launchpad-contracts";
import { Pool, type PoolClient } from "pg";

import type { ReceiptStore, ReservationResult } from "./types";

const MIGRATION_LOCK_ID = 2_041_501_731;

const BOOTSTRAP_MIGRATIONS_SQL = `
  CREATE TABLE IF NOT EXISTS launchpad_schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS launchpad_run_receipts (
        idempotency_key TEXT PRIMARY KEY,
        run_id UUID NOT NULL,
        workflow TEXT NOT NULL,
        request_digest CHAR(64) NOT NULL,
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

      -- Fail closed when upgrading an unpublished pre-versioned candidate schema.
      -- Its input-only digest cannot be promoted to a full request fingerprint.
      DO $migration$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'launchpad_run_receipts'
            AND column_name = 'input_digest'
        ) THEN
          IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'launchpad_run_receipts'
              AND column_name = 'request_digest'
          ) THEN
            ALTER TABLE launchpad_run_receipts ADD COLUMN request_digest CHAR(64);
          END IF;
          UPDATE launchpad_run_receipts
          SET request_digest = repeat('g', 64)
          WHERE request_digest IS NULL;
          ALTER TABLE launchpad_run_receipts ALTER COLUMN request_digest SET NOT NULL;
          ALTER TABLE launchpad_run_receipts DROP COLUMN input_digest;
        END IF;
      END
      $migration$;

      CREATE INDEX IF NOT EXISTS launchpad_run_receipts_updated_at_idx
        ON launchpad_run_receipts (updated_at DESC);
    `,
  },
] as const;

export const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

interface ReceiptRow {
  state: "pending" | "completed";
  workflow: string;
  request_digest: string;
  receipt: unknown | null;
}

async function runMigrations(client: PoolClient): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(BOOTSTRAP_MIGRATIONS_SQL);
    const applied = await client.query<{ version: number }>(
      "SELECT version FROM launchpad_schema_migrations",
    );
    const appliedVersions = new Set(applied.rows.map(({ version }) => version));

    for (const migration of MIGRATIONS) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }
      await client.query(migration.sql);
      await client.query("INSERT INTO launchpad_schema_migrations (version) VALUES ($1)", [
        migration.version,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function hasLatestSchema(queryable: Pool | PoolClient): Promise<boolean> {
  const relations = await queryable.query<{
    receipt_table: string | null;
    migrations_table: string | null;
  }>(
    `SELECT
       to_regclass('launchpad_run_receipts')::text AS receipt_table,
       to_regclass('launchpad_schema_migrations')::text AS migrations_table`,
  );
  if (!relations.rows[0]?.receipt_table || !relations.rows[0]?.migrations_table) {
    return false;
  }

  const result = await queryable.query<{ ready: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM launchpad_schema_migrations WHERE version = $1)
       AND EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'launchpad_run_receipts'
           AND column_name = 'request_digest'
           AND is_nullable = 'NO'
       ) AS ready`,
    [LATEST_SCHEMA_VERSION],
  );
  return result.rows[0]?.ready === true;
}

export class PostgresReceiptStore implements ReceiptStore {
  readonly kind = "postgres" as const;
  readonly durable = true;
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      query_timeout: 5_000,
      application_name: "starlight-agent-launchpad",
    });
  }

  async initialize(migrate: boolean): Promise<void> {
    if (migrate) {
      const client = await this.pool.connect();
      try {
        await runMigrations(client);
      } finally {
        client.release();
      }
    }
    if (!(await hasLatestSchema(this.pool))) {
      throw new Error(
        `Receipt database schema is not ready at version ${LATEST_SCHEMA_VERSION}; run the migration command`,
      );
    }
  }

  async health(): Promise<boolean> {
    try {
      return await hasLatestSchema(this.pool);
    } catch {
      return false;
    }
  }

  async reserve(
    idempotencyKey: string,
    runId: string,
    workflow: string,
    requestDigest: string,
    leaseMs: number,
  ): Promise<ReservationResult> {
    const token = randomUUID();
    const inserted = await this.pool.query<ReceiptRow>(
      `INSERT INTO launchpad_run_receipts
        (idempotency_key, run_id, workflow, request_digest, owner_token, state)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING state, workflow, request_digest, receipt`,
      [idempotencyKey, runId, workflow, requestDigest, token],
    );
    if (inserted.rowCount === 1) {
      return { state: "reserved", token };
    }

    const existing = await this.pool.query<ReceiptRow>(
      "SELECT state, workflow, request_digest, receipt FROM launchpad_run_receipts WHERE idempotency_key = $1",
      [idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) {
      throw new Error("The idempotency reservation disappeared while it was being inspected");
    }
    if (row.workflow !== workflow || row.request_digest !== requestDigest) {
      return {
        state: "conflict",
        workflow: row.workflow,
        requestDigest: row.request_digest,
      };
    }
    if (row.state === "completed" && row.receipt) {
      return { state: "completed", receipt: runReceiptSchema.parse(row.receipt) };
    }

    const claimed = await this.pool.query(
      `UPDATE launchpad_run_receipts
       SET run_id = $2, owner_token = $5, updated_at = NOW()
       WHERE idempotency_key = $1
         AND state = 'pending'
         AND workflow = $3
         AND request_digest = $4
         AND updated_at < NOW() - ($6::double precision * INTERVAL '1 millisecond')
       RETURNING idempotency_key`,
      [idempotencyKey, runId, workflow, requestDigest, token, leaseMs],
    );
    return claimed.rowCount === 1
      ? { state: "reserved", token }
      : {
          state: "pending",
          workflow: row.workflow,
          requestDigest: row.request_digest,
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
       WHERE idempotency_key = $1
         AND owner_token = $2
         AND state = 'pending'
         AND workflow = $5
         AND request_digest = $6`,
      [
        idempotencyKey,
        reservationToken,
        receipt.receiptId,
        JSON.stringify(receipt),
        receipt.workflow,
        receipt.requestDigest,
      ],
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
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5_000,
    query_timeout: 30_000,
    application_name: "starlight-agent-launchpad-migration",
  });
  try {
    const client = await pool.connect();
    try {
      await runMigrations(client);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
