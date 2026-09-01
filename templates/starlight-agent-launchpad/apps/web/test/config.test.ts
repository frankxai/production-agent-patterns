import { describe, expect, it } from "vitest";

import { loadWebProxyConfig } from "../src/lib/config";
import { hasCockpitAccess, hasExpectedOrigin } from "../src/lib/security";

const baseEnvironment = {
  NODE_ENV: "test",
  RAILWAY_API_URL: "https://operator.example.com",
  RAILWAY_API_TOKEN: "r".repeat(64),
  COCKPIT_ACCESS_TOKEN: "c".repeat(64),
  APP_ORIGIN: "https://launchpad.example.com",
} as const;

describe("web proxy configuration", () => {
  it("rejects Railway private networking because Vercel cannot reach it", () => {
    expect(() =>
      loadWebProxyConfig({
        ...baseEnvironment,
        RAILWAY_API_URL: "http://operator.railway.internal",
      }),
    ).toThrow("public HTTPS domain reachable from Vercel");
  });

  it("requires HTTPS origins in production", () => {
    expect(() =>
      loadWebProxyConfig({
        ...baseEnvironment,
        NODE_ENV: "production",
        APP_ORIGIN: "http://launchpad.example.com",
      }),
    ).toThrow("APP_ORIGIN must use HTTPS in production");
  });

  it("rejects operator URL path drift", () => {
    expect(() =>
      loadWebProxyConfig({
        ...baseEnvironment,
        RAILWAY_API_URL: "https://operator.example.com/unexpected-path",
      }),
    ).toThrow("RAILWAY_API_URL must not include a path");
  });

  it("checks cockpit access and exact mutation origin", () => {
    const config = loadWebProxyConfig(baseEnvironment);
    const request = new Request("https://launchpad.example.com/api/operator/runs", {
      method: "POST",
      headers: {
        origin: "https://launchpad.example.com",
        "x-starlight-access-token": "c".repeat(64),
      },
    });
    expect(hasCockpitAccess(request, config)).toBe(true);
    expect(hasExpectedOrigin(request, config)).toBe(true);

    const hostile = new Request("https://launchpad.example.com/api/operator/runs", {
      method: "POST",
      headers: {
        origin: "https://launchpad.example.com.attacker.invalid",
        "x-starlight-access-token": "c".repeat(64),
      },
    });
    expect(hasExpectedOrigin(hostile, config)).toBe(false);
  });
});
