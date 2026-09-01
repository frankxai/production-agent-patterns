import { healthResponseSchema } from "@starlight/launchpad-contracts";

import { loadWebProxyConfig } from "@/lib/config";
import { callOperator, proxyJson } from "@/lib/operator";
import { unavailableResponse } from "@/lib/route-guards";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const config = loadWebProxyConfig();
    const response = await callOperator(config, "/health");
    const parsed = healthResponseSchema.safeParse(response.body);
    const statusMatches =
      parsed.success &&
      ((parsed.data.status === "ok" && response.status === 200) ||
        (parsed.data.status === "unavailable" && response.status === 503));
    if (!statusMatches) {
      return unavailableResponse();
    }
    return proxyJson(response);
  } catch {
    return unavailableResponse();
  }
}
