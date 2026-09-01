import { LaunchpadConsole } from "@/components/launchpad-console";

function BoundaryMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="brand-mark">
      <path d="M8 24h32M24 8v32" />
      <circle cx="24" cy="24" r="9" />
      <circle cx="24" cy="24" r="2.5" />
    </svg>
  );
}

export default function Home() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Starlight Agent Launchpad home">
          <BoundaryMark />
          <span>Starlight</span>
          <span className="brand-product">Agent Launchpad</span>
        </a>
        <a className="header-link" href="#architecture">
          Inspect boundary <span aria-hidden="true">↘</span>
        </a>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">Contract candidate · v0.1</p>
            <h1 id="hero-title">
              Put a clean boundary between your website and your agent.
            </h1>
            <p className="hero-intro">
              A deployment can return 200 while exposing its runtime key, accepting the same job
              twice, or losing the evidence of what ran. Launchpad separates the public cockpit
              from the operator, requires idempotency, and returns a signed receipt for every run.
            </p>
            <div className="hero-actions">
              <a className="primary-link" href="#console">
                Open the cockpit <span aria-hidden="true">↓</span>
              </a>
              <p>Start in declared simulation mode. Connect a runtime only after it passes the contract.</p>
            </div>
          </div>

          <div className="boundary-card" aria-label="Launchpad trust boundary">
            <div className="boundary-heading">
              <span>Trust boundary</span>
              <span className="live-label"><i /> observable</span>
            </div>
            <ol className="boundary-flow">
              <li>
                <span className="node-index">01</span>
                <div><strong>Browser</strong><small>human intent only</small></div>
              </li>
              <li>
                <span className="node-index">02</span>
                <div><strong>Vercel BFF</strong><small>access + origin gate</small></div>
              </li>
              <li>
                <span className="node-index">03</span>
                <div><strong>Railway operator</strong><small>auth + idempotency</small></div>
              </li>
              <li>
                <span className="node-index">04</span>
                <div><strong>Runtime adapter</strong><small>explicit contract</small></div>
              </li>
            </ol>
            <div className="boundary-footer">
              <span>Result</span>
              <strong>Signed run receipt</strong>
            </div>
          </div>
        </section>

        <LaunchpadConsole />

        <section className="architecture-section" id="architecture" aria-labelledby="architecture-title">
          <div className="section-heading">
            <p className="eyebrow">Architecture posture</p>
            <h2 id="architecture-title">Each plane owns one kind of authority.</h2>
          </div>
          <div className="principle-grid">
            <article>
              <span>Experience plane</span>
              <h3>Vercel speaks to people.</h3>
              <p>The browser submits intent to a same-origin Route Handler. Railway coordinates never enter the client bundle.</p>
            </article>
            <article>
              <span>Operator plane</span>
              <h3>Railway speaks to runtimes.</h3>
              <p>The public API authenticates every control route, restricts workflows, and records one outcome per idempotency key.</p>
            </article>
            <article>
              <span>Evidence plane</span>
              <h3>Receipts outlive the request.</h3>
              <p>PostgreSQL holds a bounded, signed record. It proves what the operator recorded—not that a model claim is true.</p>
            </article>
          </div>
          <div className="adapter-note">
            <div>
              <span className="note-kicker">Integration truth</span>
              <p>
                Mock and generic HTTP adapters exist. n8n and Hermes remain documented adapter
                targets until their mappings, authentication, failure semantics, and clean installs
                are tested.
              </p>
            </div>
            <a href="https://github.com/frankxai/production-agent-patterns/tree/agent/codex/starlight-agent-launchpad-v1/templates/starlight-agent-launchpad">
              Inspect candidate source <span aria-hidden="true">↗</span>
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <span>Starlight Agent Launchpad</span>
        <span>Outcome → run → receipt</span>
      </footer>
    </div>
  );
}
