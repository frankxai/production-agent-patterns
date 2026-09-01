import { afterEach, describe, expect, it, vi } from "vitest";

import type { WebProxyConfig } from "../src/lib/config";
import { BodyLimitError, callOperator, readBoundedRequestText } from "../src/lib/operator";

const config: WebProxyConfig = {
  nodeEnv: "test",
  railwayApiUrl: "https://operator.example.com",
  railwayApiToken: "r".repeat(64),
  cockpitAccessToken: "c".repeat(64),
  appOrigin: "https://launchpad.example.com",
  operatorTimeoutMs: 5_000,
};

describe("operator server proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("adds the Railway token only on the server-side operator request", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${config.railwayApiToken}`);
      expect(headers.get("x-correlation-id")).toBe("corr-proxy-0001");
      return new Response(JSON.stringify({ schemaVersion: "starlight.architecture.v1" }), {
        status: 200,
        headers: { "content-type": "application/json", "x-correlation-id": "corr-proxy-0001" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await callOperator(config, "/v1/architecture", {
      correlationId: "corr-proxy-0001",
    });
    expect(response.status).toBe(200);
    expect(response.correlationId).toBe("corr-proxy-0001");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://operator.example.com/v1/architecture");
  });

  it("does not send operator credentials to the public health endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        expect(new Headers(init?.headers).has("authorization")).toBe(false);
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }),
    );
    await callOperator(config, "/health");
  });

  it("rejects a caller-selected path outside the operator surface", async () => {
    await expect(callOperator(config, "https://attacker.invalid/collect")).rejects.toThrow(
      "outside the allowed surface",
    );
  });

  it("cancels and aborts a chunked operator response once the byte cap is crossed", async () => {
    let cancelled = false;
    let suppliedSignal: AbortSignal | null | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(140_000));
        controller.enqueue(new Uint8Array(140_000));
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

    await expect(callOperator(config, "/health")).rejects.toBeInstanceOf(BodyLimitError);
    expect(cancelled).toBe(true);
    expect(suppliedSignal?.aborted).toBe(true);
  });

  it("cancels an inbound request stream once its byte cap is crossed", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(32));
        controller.enqueue(new Uint8Array(32));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = {
      body: stream,
      headers: new Headers({ "transfer-encoding": "chunked" }),
    } as Request;

    await expect(readBoundedRequestText(request, 48)).rejects.toBeInstanceOf(BodyLimitError);
    expect(cancelled).toBe(true);
  });
});
