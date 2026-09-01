import { z } from "zod";

import { callOperator, proxyJson } from "@/lib/operator";
import { guardCockpitRequest, unavailableResponse } from "@/lib/route-guards";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ receiptId: string }> },
): Promise<Response> {
  const guard = guardCockpitRequest(request);
  if (!guard.ok) {
    return guard.response;
  }
  const parsed = z.uuid().safeParse((await context.params).receiptId);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_receipt_id" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    return proxyJson(await callOperator(guard.config, `/v1/receipts/${parsed.data}`));
  } catch {
    return unavailableResponse();
  }
}
