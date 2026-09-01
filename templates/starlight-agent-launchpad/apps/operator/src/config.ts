import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4_100),
    OPERATOR_API_KEY: z.string().min(32),
    RECEIPT_SIGNING_SECRET: z.string().min(32),
    RECEIPT_SIGNING_KEY_ID: z.string().min(1).max(120).default("launchpad-v1"),
    RUNTIME_ADAPTER: z.enum(["mock", "http"]).default("mock"),
    ALLOW_MOCK_RUNTIME: booleanFromString.default(false),
    AGENT_RUNTIME_URL: z.string().url().optional(),
    AGENT_RUNTIME_API_KEY: z.string().min(16).optional(),
    RUNTIME_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(60_000),
    DATABASE_URL: z.string().min(1).optional(),
    MIGRATE_ON_START: booleanFromString.default(false),
    IDEMPOTENCY_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(180),
    ALLOWED_WORKFLOWS: z.string().min(1).default("research-brief"),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(60),
    RATE_LIMIT_WINDOW: z.string().min(1).default("1 minute"),
    TRUST_PROXY: booleanFromString.default(false),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === "production" && !environment.DATABASE_URL) {
      context.addIssue({
        code: "custom",
        message: "DATABASE_URL is required in production",
        path: ["DATABASE_URL"],
      });
    }

    if (environment.RUNTIME_ADAPTER === "mock" && !environment.ALLOW_MOCK_RUNTIME) {
      context.addIssue({
        code: "custom",
        message: "Mock execution must be explicitly enabled",
        path: ["ALLOW_MOCK_RUNTIME"],
      });
    }

    if (environment.RUNTIME_ADAPTER === "http") {
      if (!environment.AGENT_RUNTIME_URL) {
        context.addIssue({
          code: "custom",
          message: "AGENT_RUNTIME_URL is required for the HTTP adapter",
          path: ["AGENT_RUNTIME_URL"],
        });
      }
      if (!environment.AGENT_RUNTIME_API_KEY) {
        context.addIssue({
          code: "custom",
          message: "AGENT_RUNTIME_API_KEY is required for the HTTP adapter",
          path: ["AGENT_RUNTIME_API_KEY"],
        });
      }
    }
  });

export type RuntimeAdapterKind = "mock" | "http";

export interface OperatorConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  operatorApiKey: string;
  receiptSigningSecret: string;
  receiptSigningKeyId: string;
  runtimeAdapter: RuntimeAdapterKind;
  allowMockRuntime: boolean;
  agentRuntimeUrl?: string;
  agentRuntimeApiKey?: string;
  runtimeTimeoutMs: number;
  databaseUrl?: string;
  migrateOnStart: boolean;
  idempotencyLeaseMs: number;
  allowedWorkflows: ReadonlySet<string>;
  rateLimitMax: number;
  rateLimitWindow: string;
  trustProxy: boolean;
}

function assertRuntimeUrl(rawUrl: string, nodeEnv: OperatorConfig["nodeEnv"]): void {
  const url = new URL(rawUrl);
  if (url.username || url.password || url.hash || url.search) {
    throw new Error("AGENT_RUNTIME_URL must not contain credentials, a query, or a fragment");
  }

  const privateRailway = url.hostname.endsWith(".railway.internal");
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (privateRailway || local))) {
    throw new Error(
      nodeEnv === "production"
        ? "AGENT_RUNTIME_URL must use HTTPS or Railway private networking"
        : "AGENT_RUNTIME_URL must use HTTPS, localhost HTTP, or Railway private networking",
    );
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): OperatorConfig {
  const parsed = environmentSchema.parse(environment);
  if (parsed.AGENT_RUNTIME_URL) {
    assertRuntimeUrl(parsed.AGENT_RUNTIME_URL, parsed.NODE_ENV);
  }

  const workflows = parsed.ALLOWED_WORKFLOWS.split(",")
    .map((workflow) => workflow.trim())
    .filter(Boolean);
  if (workflows.length === 0) {
    throw new Error("ALLOWED_WORKFLOWS must contain at least one workflow");
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    operatorApiKey: parsed.OPERATOR_API_KEY,
    receiptSigningSecret: parsed.RECEIPT_SIGNING_SECRET,
    receiptSigningKeyId: parsed.RECEIPT_SIGNING_KEY_ID,
    runtimeAdapter: parsed.RUNTIME_ADAPTER,
    allowMockRuntime: parsed.ALLOW_MOCK_RUNTIME,
    ...(parsed.AGENT_RUNTIME_URL ? { agentRuntimeUrl: parsed.AGENT_RUNTIME_URL } : {}),
    ...(parsed.AGENT_RUNTIME_API_KEY ? { agentRuntimeApiKey: parsed.AGENT_RUNTIME_API_KEY } : {}),
    runtimeTimeoutMs: parsed.RUNTIME_TIMEOUT_MS,
    ...(parsed.DATABASE_URL ? { databaseUrl: parsed.DATABASE_URL } : {}),
    migrateOnStart: parsed.MIGRATE_ON_START,
    idempotencyLeaseMs: parsed.IDEMPOTENCY_LEASE_SECONDS * 1_000,
    allowedWorkflows: new Set(workflows),
    rateLimitMax: parsed.RATE_LIMIT_MAX,
    rateLimitWindow: parsed.RATE_LIMIT_WINDOW,
    trustProxy: parsed.TRUST_PROXY,
  };
}
