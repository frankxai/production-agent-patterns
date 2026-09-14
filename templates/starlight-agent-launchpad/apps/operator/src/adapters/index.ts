import type { OperatorConfig } from "../config";
import { HttpRuntimeAdapter } from "./http";
import { MockRuntimeAdapter } from "./mock";
import type { RuntimeAdapter } from "./types";

export function createRuntimeAdapter(config: OperatorConfig): RuntimeAdapter {
  if (config.runtimeAdapter === "mock") {
    return new MockRuntimeAdapter();
  }

  if (!config.agentRuntimeUrl || !config.agentRuntimeApiKey) {
    throw new Error("The HTTP runtime adapter is not configured");
  }

  return new HttpRuntimeAdapter(
    config.agentRuntimeUrl,
    config.agentRuntimeApiKey,
    config.runtimeTimeoutMs,
  );
}

export { AdapterFailure } from "./types";
export type { RuntimeAdapter } from "./types";
