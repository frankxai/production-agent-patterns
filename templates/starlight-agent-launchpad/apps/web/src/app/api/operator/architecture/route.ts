import { callOperator, proxyJson } from "@/lib/operator";
import { guardCockpitRequest, unavailableResponse } from "@/lib/route-guards";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const guard = guardCockpitRequest(request);
  if (!guard.ok) {
    return guard.response;
  }
  try {
    return proxyJson(await callOperator(guard.config, "/v1/architecture"));
  } catch {
    return unavailableResponse();
  }
}
