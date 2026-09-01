import type { OperatorConfig } from "../config";
import { MemoryReceiptStore } from "./memory";
import { PostgresReceiptStore } from "./postgres";
import type { ReceiptStore } from "./types";

export function createReceiptStore(config: OperatorConfig): ReceiptStore {
  return config.databaseUrl
    ? new PostgresReceiptStore(config.databaseUrl)
    : new MemoryReceiptStore();
}

export type { ReceiptStore, ReservationResult } from "./types";
