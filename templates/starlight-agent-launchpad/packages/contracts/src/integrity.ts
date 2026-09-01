import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  runReceiptSchema,
  type RunReceipt,
  type UnsignedRunReceipt,
} from "./index";

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

function normalize(value: unknown): CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot contain non-finite numbers");
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }

  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256Digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function signRunReceipt(
  receipt: UnsignedRunReceipt,
  secret: string,
  keyId: string,
): RunReceipt {
  const value = createHmac("sha256", secret).update(canonicalJson(receipt)).digest("hex");
  return runReceiptSchema.parse({
    ...receipt,
    signature: { algorithm: "hmac-sha256", keyId, value },
  });
}

export function verifyRunReceipt(receipt: RunReceipt, secret: string): boolean {
  const { signature, ...unsigned } = runReceiptSchema.parse(receipt);
  const expected = createHmac("sha256", secret).update(canonicalJson(unsigned)).digest();
  const actual = Buffer.from(signature.value, "hex");
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}
