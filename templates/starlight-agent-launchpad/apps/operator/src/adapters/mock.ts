import { RUNTIME_RESULT_VERSION, type RuntimeResult } from "@starlight/launchpad-contracts";

import type { RuntimeAdapter } from "./types";

export class MockRuntimeAdapter implements RuntimeAdapter {
  readonly kind = "mock" as const;
  readonly mode = "simulation" as const;

  async execute(): Promise<RuntimeResult> {
    return Promise.resolve({
      schemaVersion: RUNTIME_RESULT_VERSION,
      status: "accepted",
      summary:
        "Simulation accepted the validated request. Configure and contract-test an HTTP runtime before treating this as agent execution.",
      artifacts: [],
    });
  }
}
