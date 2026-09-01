import { createHash, timingSafeEqual } from "node:crypto";

import type { WebProxyConfig } from "./config";

export const COCKPIT_ACCESS_HEADER = "x-starlight-access-token";

function secureEqual(received: string, expected: string): boolean {
  const receivedDigest = createHash("sha256").update(received).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
}

export function hasCockpitAccess(request: Request, config: WebProxyConfig): boolean {
  const received = request.headers.get(COCKPIT_ACCESS_HEADER);
  return Boolean(received && secureEqual(received, config.cockpitAccessToken));
}

export function hasExpectedOrigin(request: Request, config: WebProxyConfig): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }
  try {
    return new URL(origin).origin === config.appOrigin;
  } catch {
    return false;
  }
}
