import type { RuntimeRequest, RuntimeResult } from "@starlight/launchpad-contracts";

export type AdapterFailureCode =
  | "runtime_timeout"
  | "runtime_unavailable"
  | "invalid_runtime_result";

export class AdapterFailure extends Error {
  readonly code: AdapterFailureCode;

  constructor(code: AdapterFailureCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AdapterFailure";
    this.code = code;
  }
}

export interface RuntimeAdapter {
  readonly kind: "mock" | "http";
  readonly mode: "simulation" | "runtime";
  execute(request: RuntimeRequest): Promise<RuntimeResult>;
}
