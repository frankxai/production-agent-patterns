"use client";

import {
  RUN_REQUEST_VERSION,
  architectureResponseSchema,
  runReceiptSchema,
  type ArchitectureResponse,
  type RunReceipt,
} from "@starlight/launchpad-contracts";
import { type FormEvent, useEffect, useState } from "react";

const ACCESS_HEADER = "x-starlight-access-token";

type HealthState = "checking" | "ready" | "unavailable";

function displayTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function LaunchpadConsole() {
  const [health, setHealth] = useState<HealthState>("checking");
  const [accessToken, setAccessToken] = useState("");
  const [brief, setBrief] = useState(
    "Map the production boundary for a research workflow and return an inspectable artifact.",
  );
  const [architecture, setArchitecture] = useState<ArchitectureResponse | null>(null);
  const [receipt, setReceipt] = useState<RunReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Enter the cockpit token to inspect the operator.");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/operator/health", { cache: "no-store", signal: controller.signal })
      .then((response) => setHealth(response.ok ? "ready" : "unavailable"))
      .catch(() => setHealth("unavailable"));
    return () => controller.abort();
  }, []);

  async function inspectArchitecture(): Promise<boolean> {
    if (!accessToken) {
      setMessage("The cockpit token is required.");
      return false;
    }
    const response = await fetch("/api/operator/architecture", {
      headers: { [ACCESS_HEADER]: accessToken },
      cache: "no-store",
    });
    const body: unknown = await response.json();
    const parsed = architectureResponseSchema.safeParse(body);
    if (!response.ok || !parsed.success) {
      setArchitecture(null);
      setMessage(response.status === 401 ? "The cockpit token was not accepted." : "The operator boundary is unavailable.");
      return false;
    }
    setArchitecture(parsed.data);
    setMessage(
      parsed.data.runtime.adapter === "mock"
        ? "Operator connected. Runs are explicitly simulated."
        : "HTTP adapter configured. Each run still validates the runtime result contract.",
    );
    return true;
  }

  async function submitRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (brief.trim().length < 12) {
      setMessage("Write a specific brief of at least 12 characters.");
      return;
    }

    setBusy(true);
    setReceipt(null);
    try {
      if (!architecture && !(await inspectArchitecture())) {
        return;
      }
      const idempotencyKey = crypto.randomUUID();
      const correlationId = crypto.randomUUID();
      const response = await fetch("/api/operator/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          "x-correlation-id": correlationId,
          [ACCESS_HEADER]: accessToken,
        },
        body: JSON.stringify({
          schemaVersion: RUN_REQUEST_VERSION,
          workflow: "research-brief",
          input: { brief: brief.trim() },
          context: { source: "cockpit", tags: ["launchpad"] },
        }),
      });
      const body: unknown = await response.json();
      const parsed = runReceiptSchema.safeParse(body);
      if (parsed.success) {
        setReceipt(parsed.data);
        setMessage(
          parsed.data.status === "failed"
            ? `Run failed safely. Use correlation ${parsed.data.correlationId} in operator logs.`
            : `Receipt ${parsed.data.receiptId.slice(0, 8)} recorded and signed.`,
        );
        return;
      }
      setMessage(response.status === 409 ? "An identical run is still in progress." : "The operator rejected the run before execution.");
    } catch {
      setMessage("The cockpit could not reach the operator.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="console-section" id="console" aria-labelledby="console-title">
      <div className="console-frame">
        <div className="console-topbar">
          <div>
            <span className="window-dot" />
            <span className="window-dot" />
            <span className="window-dot" />
            <span className="console-path">launchpad / operator</span>
          </div>
          <span className={`health-state health-${health}`}>
            <i /> {health}
          </span>
        </div>

        <div className="console-grid">
          <form className="run-panel" onSubmit={submitRun}>
            <div className="panel-heading">
              <div>
                <p className="panel-index">01 / Intent</p>
                <h2 id="console-title">Run one bounded workflow.</h2>
              </div>
              <span className="contract-chip">request.v1</span>
            </div>

            <label className="field-label" htmlFor="cockpit-token">
              Cockpit access token
            </label>
            <div className="token-row">
              <input
                id="cockpit-token"
                name="cockpit-token"
                type="password"
                value={accessToken}
                onChange={(event) => {
                  setAccessToken(event.target.value);
                  setArchitecture(null);
                }}
                autoComplete="current-password"
                placeholder="Kept in memory for this tab only"
              />
              <button type="button" className="secondary-button" onClick={() => void inspectArchitecture()}>
                Inspect
              </button>
            </div>

            <label className="field-label" htmlFor="run-brief">
              Research brief
            </label>
            <textarea
              id="run-brief"
              name="run-brief"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              maxLength={4_000}
              rows={6}
            />

            <div className="run-meta">
              <span>workflow / research-brief</span>
              <span>idempotency / generated</span>
            </div>
            <button className="run-button" type="submit" disabled={busy || health !== "ready"}>
              <span>{busy ? "Recording run…" : "Run and record receipt"}</span>
              <span aria-hidden="true">↗</span>
            </button>
            <p className="console-message" aria-live="polite">{message}</p>
          </form>

          <div className="receipt-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-index">02 / Evidence</p>
                <h2>Inspect the receipt.</h2>
              </div>
              <span className="contract-chip">receipt.v1</span>
            </div>

            {receipt ? (
              <div className="receipt-content">
                <div className="receipt-verdict">
                  <span className={`verdict-mark verdict-${receipt.status}`}>{receipt.status}</span>
                  <span>{receipt.mode}</span>
                </div>
                <dl className="receipt-facts">
                  <div><dt>Receipt</dt><dd>{receipt.receiptId}</dd></div>
                  <div><dt>Correlation</dt><dd>{receipt.correlationId}</dd></div>
                  <div><dt>Adapter</dt><dd>{receipt.adapter}</dd></div>
                  <div><dt>Duration</dt><dd>{receipt.metrics.durationMs} ms</dd></div>
                  <div><dt>Recorded</dt><dd>{displayTime(receipt.completedAt)}</dd></div>
                  <div><dt>Signature</dt><dd>{receipt.signature.value.slice(0, 16)}…</dd></div>
                </dl>
                <div className="receipt-summary">
                  <span>Outcome</span>
                  <p>{receipt.result?.summary ?? receipt.failure?.summary}</p>
                </div>
                <details>
                  <summary>Raw signed contract</summary>
                  <pre>{JSON.stringify(receipt, null, 2)}</pre>
                </details>
              </div>
            ) : (
              <div className="empty-receipt">
                <div className="receipt-orbit" aria-hidden="true"><i /><i /><i /></div>
                <p>No receipt yet.</p>
                <span>The operator will return evidence without returning its secrets.</span>
              </div>
            )}

            <div className="runtime-strip">
              <span>Active adapter</span>
              <strong>{architecture?.runtime.adapter ?? "locked"}</strong>
              <span className={architecture?.runtime.adapter === "mock" ? "simulation-label" : "runtime-label"}>
                {architecture?.runtime.adapter === "mock" ? "simulation" : architecture ? "runtime" : "inspect first"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
