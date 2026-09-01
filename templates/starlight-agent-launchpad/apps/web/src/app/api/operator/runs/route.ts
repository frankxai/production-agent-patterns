import { runRequestSchema } from "@starlight/launchpad-contracts";

import { callOperator, proxyJson } from "@/lib/operator";
import { guardCockpitRequest, unavailableResponse } from "@/lib/route-guards";

export const dynamic = "force-dynamic";

const HEADER_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_REQUEST_BYTES = 48_000;

export async function POST(request: Request): Promise<Response> {
  const guard = guardCockpitRequest(request, true);
  if (!guard.ok) {
    return guard.response;
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !HEADER_PATTERN.test(idempotencyKey)) {
    return Response.json(
      { error: "invalid_idempotency_key" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) {
    return Response.json(
      { error: "request_too_large" },
      { status: 413, headers: { "cache-control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json(
      { error: "invalid_json" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const parsed = runRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
    return proxyJson(
      await callOperator(guard.config, "/v1/runs", {
        method: "POST",
        body: parsed.data,
        correlationId,
        idempotencyKey,
      }),
    );
  } catch {
    return unavailableResponse();
  }
}
