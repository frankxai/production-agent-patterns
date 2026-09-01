import type { RunReceipt } from "@starlight/launchpad-contracts";

export type ReservationResult =
  | { state: "reserved"; token: string }
  | { state: "pending"; workflow: string; requestDigest: string }
  | { state: "completed"; receipt: RunReceipt }
  | { state: "conflict"; workflow: string; requestDigest: string };

export interface ReceiptStore {
  readonly kind: "memory" | "postgres";
  readonly durable: boolean;
  initialize(migrate: boolean): Promise<void>;
  health(): Promise<boolean>;
  reserve(
    idempotencyKey: string,
    runId: string,
    workflow: string,
    requestDigest: string,
    leaseMs: number,
  ): Promise<ReservationResult>;
  complete(idempotencyKey: string, reservationToken: string, receipt: RunReceipt): Promise<void>;
  findByReceiptId(receiptId: string): Promise<RunReceipt | null>;
  close(): Promise<void>;
}
