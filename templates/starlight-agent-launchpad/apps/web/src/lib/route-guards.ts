import { loadWebProxyConfig, type WebProxyConfig } from "./config";
import { hasCockpitAccess, hasExpectedOrigin } from "./security";

export type GuardResult =
  | { ok: true; config: WebProxyConfig }
  | { ok: false; response: Response };

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export function guardCockpitRequest(request: Request, requireOrigin = false): GuardResult {
  let config: WebProxyConfig;
  try {
    config = loadWebProxyConfig();
  } catch {
    return { ok: false, response: jsonError(503, "operator_proxy_not_configured") };
  }
  if (!hasCockpitAccess(request, config)) {
    return { ok: false, response: jsonError(401, "cockpit_access_denied") };
  }
  if (requireOrigin && !hasExpectedOrigin(request, config)) {
    return { ok: false, response: jsonError(403, "origin_denied") };
  }
  return { ok: true, config };
}

export function unavailableResponse(): Response {
  return jsonError(502, "operator_unavailable");
}
