import { z } from "zod";

const webEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  RAILWAY_API_URL: z.string().url(),
  RAILWAY_API_TOKEN: z.string().min(32),
  COCKPIT_ACCESS_TOKEN: z.string().min(32),
  APP_ORIGIN: z.string().url(),
  OPERATOR_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(65_000),
});

export interface WebProxyConfig {
  nodeEnv: "development" | "test" | "production";
  railwayApiUrl: string;
  railwayApiToken: string;
  cockpitAccessToken: string;
  appOrigin: string;
  operatorTimeoutMs: number;
}

function validateOrigin(raw: string, field: string, production: boolean): string {
  const url = new URL(raw);
  if (url.username || url.password || url.hash || url.search) {
    throw new Error(`${field} must be an origin without credentials, query, or fragment`);
  }
  if (url.pathname !== "/") {
    throw new Error(`${field} must not include a path`);
  }
  if (production && url.protocol !== "https:") {
    throw new Error(`${field} must use HTTPS in production`);
  }
  return url.origin;
}

export function loadWebProxyConfig(environment: NodeJS.ProcessEnv = process.env): WebProxyConfig {
  const parsed = webEnvironmentSchema.parse(environment);
  const production = parsed.NODE_ENV === "production";
  const railwayUrl = new URL(parsed.RAILWAY_API_URL);
  if (railwayUrl.hostname.endsWith(".railway.internal")) {
    throw new Error("RAILWAY_API_URL must be a public HTTPS domain reachable from Vercel");
  }
  const railwayApiUrl = validateOrigin(parsed.RAILWAY_API_URL, "RAILWAY_API_URL", production);
  const appOrigin = validateOrigin(parsed.APP_ORIGIN, "APP_ORIGIN", production);

  return {
    nodeEnv: parsed.NODE_ENV,
    railwayApiUrl,
    railwayApiToken: parsed.RAILWAY_API_TOKEN,
    cockpitAccessToken: parsed.COCKPIT_ACCESS_TOKEN,
    appOrigin,
    operatorTimeoutMs: parsed.OPERATOR_TIMEOUT_MS,
  };
}
