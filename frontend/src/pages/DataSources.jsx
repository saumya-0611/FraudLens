import { useState } from "react";
import { ArrowRight, BookOpen, Check, Clipboard, Database, FileUp, LockKeyhole, Radio, Workflow } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import "./ProductPages.css";

const transactionExample = {
  transaction_id: "demo-tx-001",
  account_ref: "demo-account-1001",
  amount: 125.5,
  tx_time: "2026-11-20T03:12:45Z",
  category: "shopping_net",
  merchant: "Example Merchant",
  lat: 36.0788,
  lon: -81.1781,
  merch_lat: 36.011293,
  merch_lon: -82.048315,
  customer_age: 34,
};

const fetchExample = `const response = await fetch("/api/transactions", {
  method: "POST",
  credentials: "include", // uses the existing httpOnly login cookie
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(${JSON.stringify(transactionExample, null, 2).replace(/^/gm, "  ")}),
});
// An ADMIN session receives HTTP 202, not a prediction:
// { "transaction_id": "demo-tx-001", "status": "ACCEPTED" }`;

function CopyBlock({ value, label }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  async function copy() {
    setError("");
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Copy is unavailable here. Select and copy the example text.");
    }
  }
  return (
    <div className="code-block">
      <div className="code-block-toolbar"><span>{label}</span><button type="button" className="button secondary" onClick={copy}><span aria-hidden="true">{copied ? <Check size={15} /> : <Clipboard size={15} />}</span>{copied ? "Copied" : "Copy"}</button></div>
      <pre><code>{value}</code></pre>
      {error && <p className="copy-error" role="status">{error}</p>}
    </div>
  );
}

export default function DataSources() {
  const { user } = useAuth();
  const mockMode = import.meta.env.VITE_USE_MOCKS === "true";
  const isAdmin = user?.role === "ADMIN";

  return (
    <div className="page-stack product-page data-sources-page">
      <header className="page-heading"><div><span className="eyebrow">CONNECT YOUR WORKFLOW</span><h1>Data sources & integrations</h1><p>Use the documented transaction interface with explicit account and role controls.</p></div></header>
      <div className={`product-mode-note ${mockMode ? "simulated" : ""}`} role="status">
        <Radio size={18} aria-hidden="true" />
        <p><strong>{mockMode ? "Mock demonstration mode" : "Real API mode configured"}</strong><br />{mockMode ? "This workspace uses synthetic fixture responses. Transaction submission and import are disabled; no real service is connected by this label." : "API status is not implied by this page. Requests use same-origin paths and require a valid backend session."}</p>
      </div>

      <section className="panel product-section">
        <div className="product-section-heading"><span className="product-icon"><FileUp size={20} /></span><div><h2>Manual transaction analysis</h2><p>Submit one transaction through the existing transaction flow.</p></div></div>
        <p>The request needs a transaction ID, account reference, amount, timezone-aware transaction timestamp, and category. The ingestion endpoint acknowledges acceptance first. Open the stored transaction details to see whether the configured scorer has persisted a prediction.</p>
        <div className="product-actions">
          {isAdmin ? <Link className="button primary" to="/analyse">Analyse a transaction <ArrowRight size={16} /></Link> : <span className="role-note"><LockKeyhole size={15} /> Submission is ADMIN-only.</span>}
          {isAdmin && <Link className="button secondary" to="/imports">Import CSV transactions</Link>}
        </div>
      </section>

      <section className="panel product-section">
        <div className="product-section-heading"><span className="product-icon"><Database size={20} /></span><div><h2>REST API ingestion</h2><p>Same-origin API; the browser uses the signed-in session cookie.</p></div></div>
        <div className="endpoint-line"><span className="method-post">POST</span><code>/api/transactions</code><span>ADMIN session or server-side service token</span></div>
        <p>The frontend uses an authenticated ADMIN cookie session. Authorized server integrations such as the repository simulator may use the configured <code>X-Service-Token</code> header; never put that token in browser code. Public customer-specific credentials and tenant isolation are not implemented.</p>
        <h3>Supported transaction fields</h3>
        <div className="table-wrap product-table-wrap"><table><thead><tr><th>Field</th><th>Requirement</th><th>Contract constraint</th></tr></thead><tbody>
          <tr><td><code>transaction_id</code></td><td>Required</td><td>1–64 characters; stable unique reference</td></tr>
          <tr><td><code>account_ref</code></td><td>Required</td><td>1–64 characters; returned to the browser only as a masked account</td></tr>
          <tr><td><code>amount</code></td><td>Required</td><td>Number from 0 to 10,000,000</td></tr>
          <tr><td><code>tx_time</code></td><td>Required</td><td>ISO-8601 datetime with timezone</td></tr>
          <tr><td><code>category</code></td><td>Required</td><td>1–50 characters</td></tr>
          <tr><td><code>merchant</code></td><td>Optional</td><td>At most 120 characters</td></tr>
          <tr><td><code>lat, lon, merch_lat, merch_lon</code></td><td>Optional</td><td>Latitude -90…90, longitude -180…180</td></tr>
          <tr><td><code>customer_age</code></td><td>Optional</td><td>Whole number 0…32767</td></tr>
        </tbody></table></div>
        <p className="product-note">The backend derives ingestion time and history-based features. The training label is not an inference input. Send the contract fields only; do not include <code>ingested_at</code> or an <code>is_fraud</code> label.</p>
        <CopyBlock label="Synthetic documentation example — not a live request" value={fetchExample} />
        <div className="response-examples"><article><h3>Acceptance response (documented)</h3><pre><code>{`HTTP 202 Accepted\n{ "transaction_id": "demo-tx-001", "status": "ACCEPTED" }`}</code></pre></article><article><h3>Prediction state</h3><p>Acceptance is not a score. Read <code>GET /api/transactions/{"{transaction_id}"}</code> for persisted details. While the scorer is working, the API can report <code>PENDING</code> with a null probability. The UI must not invent a result.</p></article></div>
        <div className="product-actions"><a className="button secondary" href="/api-docs" target="_blank" rel="noreferrer"><BookOpen size={16} /> Open Swagger API docs</a><a className="text-link" href="/api-docs/openapi.json" target="_blank" rel="noreferrer">Open the OpenAPI specification</a></div>
      </section>

      <section className="panel product-section">
        <div className="product-section-heading"><span className="product-icon"><Workflow size={20} /></span><div><h2>Simulator and processing modes</h2><p>Architecture depends on the deployment’s configured pipeline.</p></div></div>
        <p>The repository simulator is a command-line tool at <code>simulator/replay.py</code>. This frontend has no supported browser simulator endpoint or run action. For a disposable local environment, follow the instructions in the repository file <code>docs/demo-script.md</code> and configure its service token server-side. Do not run replay traffic against production.</p>
        <ul className="product-list"><li><strong>Inline mode:</strong> backend persists a pending transaction and calls the internal ML service; the UI sees only stored API results.</li><li><strong>Kafka/Spark mode:</strong> backend publishes to Kafka and the streaming worker processes transactions; the UI does not assume this mode is active.</li><li><strong>Training and inference:</strong> historical labeled data trains/evaluates model artifacts. New transactions are inference inputs; the training label is not sent with them.</li></ul>
      </section>

      <section className="panel product-section">
        <div className="product-section-heading"><span className="product-icon"><FileUp size={20} /></span><div><h2>CSV files</h2><p>Review and validate supported transaction rows before submitting.</p></div></div>
        <p>The importer currently supports the documented FraudLens CSV fields. A generic bank statement is not automatically compatible with the model schema and needs explicit column mapping and data cleanup.</p>
        <div className="product-actions">{isAdmin ? <Link className="button primary" to="/imports">Open transaction CSV import <ArrowRight size={16} /></Link> : <span className="role-note"><LockKeyhole size={15} /> Import is ADMIN-only.</span>}<a className="text-link" href="/templates/fraudlens-synthetic-sample.csv" download>Download a synthetic sample</a></div>
        <p className="product-note">XLSX parsing is unavailable because the frontend has no approved spreadsheet parser dependency. Convert to CSV or request an approved dependency before importing Excel workbooks.</p>
      </section>

      <section className="panel product-section">
        <div className="product-section-heading"><span className="product-icon"><LockKeyhole size={20} /></span><div><h2>Available and planned integrations</h2><p>Current API capabilities are separate from roadmap items.</p></div></div>
        <div className="integration-status-grid"><div><strong>Available in this project</strong><ul><li>Cookie-authenticated REST API</li><li>Repository transaction replay simulator</li><li>Authenticated alert WebSocket</li></ul></div><div><strong>Not implemented as customer connectors</strong><ul><li>Direct bank, card, or UPI account access</li><li>Customer-specific API key issuance and rotation</li><li>Tenant workspaces and cross-customer data isolation</li><li>Customer-configurable webhooks</li></ul></div></div>
        <p className="product-note">FraudLens is not presented here as a multi-tenant SaaS product and does not automatically access customer phones or financial accounts. It reports risk and alert information; it does not automatically block payments.</p>
      </section>
    </div>
  );
}
