import { loadWebProxyConfig } from "@/lib/config";
import { callOperator, proxyJson } from "@/lib/operator";
import { unavailableResponse } from "@/lib/route-guards";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const config = loadWebProxyConfig();
    return proxyJson(await callOperator(config, "/health"));
  } catch {
    return unavailableResponse();
  }
}
