import {
  runtimeResultSchema,
  type RuntimeRequest,
  type RuntimeResult,
} from "@starlight/launchpad-contracts";

import { AdapterFailure, type RuntimeAdapter } from "./types";

const MAX_RUNTIME_RESPONSE_BYTES = 128_000;

export class HttpRuntimeAdapter implements RuntimeAdapter {
  readonly kind = "http" as const;
  readonly mode = "runtime" as const;

  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  async execute(request: RuntimeRequest): Promise<RuntimeResult> {
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": request.idempotencyKey,
          "x-correlation-id": request.correlationId,
        },
        body: JSON.stringify(request),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new AdapterFailure("runtime_timeout", "The configured runtime timed out", { cause: error });
      }
      throw new AdapterFailure("runtime_unavailable", "The configured runtime was unavailable", {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new AdapterFailure("runtime_unavailable", `The configured runtime returned HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_RUNTIME_RESPONSE_BYTES) {
      throw new AdapterFailure("invalid_runtime_result", "The runtime response exceeded the size limit");
    }

    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_RUNTIME_RESPONSE_BYTES) {
      throw new AdapterFailure("invalid_runtime_result", "The runtime response exceeded the size limit");
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch (error) {
      throw new AdapterFailure("invalid_runtime_result", "The runtime did not return JSON", {
        cause: error,
      });
    }

    const parsed = runtimeResultSchema.safeParse(body);
    if (!parsed.success) {
      throw new AdapterFailure("invalid_runtime_result", "The runtime result failed contract validation");
    }
    return parsed.data;
  }
}
