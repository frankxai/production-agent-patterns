import { randomUUID } from "node:crypto";

import type { RunReceipt } from "@starlight/launchpad-contracts";

import type { ReceiptStore, ReservationResult } from "./types";

interface Entry {
  token: string;
  updatedAt: number;
  workflow: string;
  inputDigest: string;
  receipt?: RunReceipt;
}

export class MemoryReceiptStore implements ReceiptStore {
  readonly kind = "memory" as const;
  readonly durable = false;
  private readonly entries = new Map<string, Entry>();

  async initialize(_migrate: boolean): Promise<void> {
    return Promise.resolve();
  }

  async health(): Promise<boolean> {
    return Promise.resolve(true);
  }

  async reserve(
    idempotencyKey: string,
    _runId: string,
    workflow: string,
    inputDigest: string,
    leaseMs: number,
  ): Promise<ReservationResult> {
    const existing = this.entries.get(idempotencyKey);
    if (existing?.receipt) {
      return { state: "completed", receipt: existing.receipt };
    }
    if (existing && Date.now() - existing.updatedAt < leaseMs) {
      return {
        state: "pending",
        workflow: existing.workflow,
        inputDigest: existing.inputDigest,
      };
    }

    const token = randomUUID();
    this.entries.set(idempotencyKey, {
      token,
      updatedAt: Date.now(),
      workflow,
      inputDigest,
    });
    return { state: "reserved", token };
  }

  async complete(
    idempotencyKey: string,
    reservationToken: string,
    receipt: RunReceipt,
  ): Promise<void> {
    const existing = this.entries.get(idempotencyKey);
    if (!existing || existing.token !== reservationToken) {
      throw new Error("The idempotency reservation is no longer owned by this run");
    }
    this.entries.set(idempotencyKey, {
      token: reservationToken,
      updatedAt: Date.now(),
      workflow: receipt.workflow,
      inputDigest: receipt.inputDigest,
      receipt,
    });
  }

  async findByReceiptId(receiptId: string): Promise<RunReceipt | null> {
    for (const entry of this.entries.values()) {
      if (entry.receipt?.receiptId === receiptId) {
        return entry.receipt;
      }
    }
    return null;
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }
}
