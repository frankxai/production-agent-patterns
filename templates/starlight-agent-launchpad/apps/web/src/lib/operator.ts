import type { WebProxyConfig } from "./config";

const MAX_OPERATOR_RESPONSE_BYTES = 256_000;

export class BodyLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BodyLimitError";
  }
}

interface BoundedTextOptions {
  maxBytes: number;
  declaredLength?: string | null;
  limitMessage: string;
  onLimit?: (error: BodyLimitError) => void;
}

async function cancelBody(body: ReadableStream<Uint8Array> | null, reason: unknown): Promise<void> {
  try {
    await body?.cancel(reason);
  } catch {
    // The runtime may already have cancelled the stream.
  }
}

async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  options: BoundedTextOptions,
): Promise<string> {
  const declaredLength = Number(options.declaredLength ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
    const error = new BodyLimitError(options.limitMessage);
    await cancelBody(body, error);
    options.onLimit?.(error);
    throw error;
  }

  if (!body) {
    return "";
  }

  const reader = body.getReader();
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
      if (byteCount > options.maxBytes) {
        const error = new BodyLimitError(options.limitMessage);
        try {
          await reader.cancel(error);
        } catch {
          // The runtime may already have cancelled the reader.
        }
        options.onLimit?.(error);
        throw error;
      }

      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    return raw;
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedRequestText(request: Request, maxBytes: number): Promise<string> {
  return readBoundedText(request.body, {
    maxBytes,
    declaredLength: request.headers.get("content-length"),
    limitMessage: "Request body exceeded the proxy limit",
  });
}

export interface OperatorResponse {
  status: number;
  body: unknown;
  correlationId: string | null;
  idempotentReplay: boolean;
}

export async function callOperator(
  config: WebProxyConfig,
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    correlationId?: string;
    idempotencyKey?: string;
  } = {},
): Promise<OperatorResponse> {
  if (!path.startsWith("/v1/") && path !== "/health") {
    throw new Error("Operator path is outside the allowed surface");
  }

  const headers = new Headers({ accept: "application/json" });
  if (path !== "/health") {
    headers.set("authorization", `Bearer ${config.railwayApiToken}`);
  }
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (options.correlationId) {
    headers.set("x-correlation-id", options.correlationId);
  }
  if (options.idempotencyKey) {
    headers.set("idempotency-key", options.idempotencyKey);
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("The operator request timed out", "TimeoutError")),
    config.operatorTimeoutMs,
  );

  let response: Response;
  let raw: string;
  try {
    response = await fetch(new URL(path, `${config.railwayApiUrl}/`), {
      method: options.method ?? "GET",
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    raw = await readBoundedText(response.body, {
      maxBytes: MAX_OPERATOR_RESPONSE_BYTES,
      declaredLength: response.headers.get("content-length"),
      limitMessage: "Operator response exceeded the proxy limit",
      onLimit: (error) => controller.abort(error),
    });
  } finally {
    clearTimeout(timeout);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error("Operator returned a non-JSON response");
  }

  return {
    status: response.status,
    body,
    correlationId: response.headers.get("x-correlation-id"),
    idempotentReplay: response.headers.get("x-idempotent-replay") === "true",
  };
}

export function proxyJson(response: OperatorResponse): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  if (response.correlationId) {
    headers.set("x-correlation-id", response.correlationId);
  }
  if (response.idempotentReplay) {
    headers.set("x-idempotent-replay", "true");
  }
  return new Response(JSON.stringify(response.body), { status: response.status, headers });
}
