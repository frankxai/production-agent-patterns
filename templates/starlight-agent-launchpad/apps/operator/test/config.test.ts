import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config";

const baseEnvironment = {
  NODE_ENV: "test",
  OPERATOR_API_KEY: "o".repeat(64),
  RECEIPT_SIGNING_SECRET: "r".repeat(64),
  ALLOW_MOCK_RUNTIME: "true",
} as const;

describe("operator configuration", () => {
  it("requires durable storage in production", () => {
    expect(() => loadConfig({ ...baseEnvironment, NODE_ENV: "production" })).toThrow(
      "DATABASE_URL is required in production",
    );
  });

  it("requires an explicit mock opt-in", () => {
    expect(() => loadConfig({ ...baseEnvironment, ALLOW_MOCK_RUNTIME: "false" })).toThrow(
      "Mock execution must be explicitly enabled",
    );
  });

  it("rejects insecure public runtime URLs", () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        RUNTIME_ADAPTER: "http",
        AGENT_RUNTIME_URL: "http://runtime.example.com/v1/runs",
        AGENT_RUNTIME_API_KEY: "a".repeat(32),
      }),
    ).toThrow("AGENT_RUNTIME_URL must use HTTPS");
  });

  it("rejects runtime URL query strings", () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        RUNTIME_ADAPTER: "http",
        AGENT_RUNTIME_URL: "https://runtime.example.com/v1/runs?token=must-not-live-here",
        AGENT_RUNTIME_API_KEY: "a".repeat(32),
      }),
    ).toThrow("must not contain credentials, a query, or a fragment");
  });

  it("accepts Railway private networking for a co-located runtime", () => {
    const config = loadConfig({
      ...baseEnvironment,
      RUNTIME_ADAPTER: "http",
      AGENT_RUNTIME_URL: "http://runtime.railway.internal/v1/runs",
      AGENT_RUNTIME_API_KEY: "a".repeat(32),
    });
    expect(config.agentRuntimeUrl).toContain(".railway.internal");
  });

  it("accepts the clean Railway simulation profile after shared secrets resolve", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      OPERATOR_API_KEY: "o".repeat(64),
      RECEIPT_SIGNING_SECRET: "r".repeat(64),
      DATABASE_URL: "postgresql://launchpad:secret@postgres.railway.internal:5432/railway",
      RUNTIME_ADAPTER: "mock",
      ALLOW_MOCK_RUNTIME: "true",
      MIGRATE_ON_START: "true",
    });
    expect(config).toMatchObject({
      nodeEnv: "production",
      runtimeAdapter: "mock",
      allowMockRuntime: true,
      migrateOnStart: true,
    });
  });
});
