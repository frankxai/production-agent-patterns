import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RUNTIME_REQUEST_VERSION,
  RUNTIME_RESULT_VERSION,
  type RuntimeRequest,
} from "@starlight/launchpad-contracts";

import { HttpRuntimeAdapter } from "../src/adapters/http";

const request = {
  schemaVersion: RUNTIME_REQUEST_VERSION,
  runId: "872219bd-754d-4405-a11f-5e3db650ef44",
  correlationId: "corr-http-adapter-0001",
  idempotencyKey: "idem-http-adapter-0001",
  workflow: "research-brief",
  input: { brief: "Test the bounded runtime boundary." },
  context: { requestedBy: "test-suite", source: "api", tags: ["contract"] },
} satisfies RuntimeRequest;

describe("HTTP runtime adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses a valid streamed runtime response", async () => {
    const expected = {
      schemaVersion: RUNTIME_RESULT_VERSION,
      status: "accepted" as const,
      summary: "Bounded response accepted — including split UTF-8 🚀",
      artifacts: [],
    };
    const encoded = new TextEncoder().encode(JSON.stringify(expected));
    const splitAt = encoded.indexOf(0xf0) + 2;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, splitAt));
        controller.enqueue(encoded.slice(splitAt));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(stream, { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );

    const result = await new HttpRuntimeAdapter(
      "https://runtime.example.com/v1/runs",
      "runtime-secret",
      5_000,
    ).execute(request);

    expect(result).toEqual(expected);
  });

  it("cancels and aborts a chunked response once the byte cap is crossed", async () => {
    let cancelled = false;
    let suppliedSignal: AbortSignal | null | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(70_000));
        controller.enqueue(new Uint8Array(70_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        suppliedSignal = init?.signal;
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
        });
      }),
    );

    await expect(
      new HttpRuntimeAdapter(
        "https://runtime.example.com/v1/runs",
        "runtime-secret",
        5_000,
      ).execute(request),
    ).rejects.toMatchObject({
      code: "invalid_runtime_result",
      message: "The runtime response exceeded the size limit",
    });
    expect(cancelled).toBe(true);
    expect(suppliedSignal?.aborted).toBe(true);
  });
});
