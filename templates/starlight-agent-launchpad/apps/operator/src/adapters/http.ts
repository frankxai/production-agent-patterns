import {
  runtimeResultSchema,
  type RuntimeRequest,
  type RuntimeResult,
} from "@starlight/launchpad-contracts";

import { AdapterFailure, type RuntimeAdapter } from "./types";

const MAX_RUNTIME_RESPONSE_BYTES = 128_000;

async function cancelBody(body: ReadableStream<Uint8Array> | null, reason: unknown): Promise<void> {
  try {
    await body?.cancel(reason);
  } catch {
    // The fetch implementation may already have cancelled the body after abort.
  }
}

async function readBoundedResponse(
  response: Response,
  controller: AbortController,
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_RUNTIME_RESPONSE_BYTES) {
    const failure = new AdapterFailure(
      "invalid_runtime_result",
      "The runtime response exceeded the size limit",
    );
    await cancelBody(response.body, failure);
    controller.abort(failure);
    throw failure;
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let raw = "";

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }

      byteCount += chunk.value.byteLength;
      if (byteCount > MAX_RUNTIME_RESPONSE_BYTES) {
        const failure = new AdapterFailure(
          "invalid_runtime_result",
          "The runtime response exceeded the size limit",
        );
        try {
          await reader.cancel(failure);
        } catch {
          // The fetch implementation may already have cancelled the reader.
        }
        controller.abort(failure);
        throw failure;
      }

      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    return raw;
  } finally {
    reader.releaseLock();
  }
}

export class HttpRuntimeAdapter implements RuntimeAdapter {
  readonly kind = "http" as const;
  readonly mode = "runtime" as const;

  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  async execute(request: RuntimeRequest): Promise<RuntimeResult> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("The runtime request timed out", "TimeoutError"));
    }, this.timeoutMs);

    try {
      const response = await fetch(this.url, {
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
        signal: controller.signal,
      });

      if (!response.ok) {
        await cancelBody(response.body, "runtime returned a non-success status");
        throw new AdapterFailure(
          "runtime_unavailable",
          `The configured runtime returned HTTP ${response.status}`,
        );
      }

      const raw = await readBoundedResponse(response, controller);

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
        throw new AdapterFailure(
          "invalid_runtime_result",
          "The runtime result failed contract validation",
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof AdapterFailure) {
        throw error;
      }
      if (timedOut) {
        throw new AdapterFailure("runtime_timeout", "The configured runtime timed out", {
          cause: error,
        });
      }
      throw new AdapterFailure("runtime_unavailable", "The configured runtime was unavailable", {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
