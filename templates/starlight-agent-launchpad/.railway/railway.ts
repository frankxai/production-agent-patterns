import {
  defineRailway,
  github,
  group,
  postgres,
  project,
  service,
} from "railway/iac";

/**
 * Railway desired state for the operator data plane.
 *
 * This intentionally deploys no website. The website belongs on Vercel and
 * calls the operator through an authenticated, public HTTPS Railway domain.
 * Generate a marketplace template only after this project passes clean-install
 * and rollback tests.
 */
export default defineRailway((context) => {
  const production = context.isEnvironment("production");
  const receipts = postgres("launchpad-receipts");

  const operator = service("launchpad-operator", {
    source: github("frankxai/production-agent-patterns", {
      branch: "main",
      rootDirectory: "templates/starlight-agent-launchpad",
    }),
    build: "npm run build:operator",
    start: "npm run start:operator",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    // Scale only after measured latency/availability evidence justifies the cost.
    replicas: 1,
    env: {
      NODE_ENV: production ? "production" : "development",
      DATABASE_URL: receipts.env.DATABASE_URL,
      OPERATOR_API_KEY: context.shared.LAUNCHPAD_OPERATOR_API_KEY,
      RECEIPT_SIGNING_SECRET: context.shared.LAUNCHPAD_RECEIPT_SIGNING_SECRET,
      RECEIPT_SIGNING_KEY_ID: "launchpad-v1",
      RUNTIME_ADAPTER: "mock",
      // The initial deployment is an explicitly labelled simulator. Change the
      // adapter to http after its target passes the shared contract tests.
      ALLOW_MOCK_RUNTIME: "true",
      MIGRATE_ON_START: "true",
      ALLOWED_WORKFLOWS: "research-brief",
      RUNTIME_TIMEOUT_MS: "60000",
      RATE_LIMIT_MAX: "60",
      RATE_LIMIT_WINDOW: "1 minute",
      TRUST_PROXY: "true",
    },
  });

  return project("starlight-agent-launchpad", {
    resources: [group("Operator plane", [operator, receipts])],
  });
});
