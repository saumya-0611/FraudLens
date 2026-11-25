import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, LoaderCircle, ScanSearch, ShieldCheck } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { request } from "../services/api";
import { errorMessage, localTime } from "../services/format";
import { RiskBadge } from "../components/PageState";
import "./AnalyzeTransaction.css";

const emptyForm = {
  account_ref: "",
  amount: "",
  tx_time: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
  category: "",
  merchant: "",
  lat: "",
  lon: "",
  merch_lat: "",
  merch_lon: "",
  customer_age: "",
};

const optionalNumbers = ["lat", "lon", "merch_lat", "merch_lon", "customer_age"];
const statusTitles = {
  submitting: "Submitting transaction",
  confirming: "Confirming submission",
  unconfirmed: "Submission unconfirmed",
  processing: "Processing transaction",
  pending: "Scoring still pending",
  error: "Analysis could not be completed",
  complete: "Analysis complete",
};
const idleStatus = { id: "", phase: "idle", message: "" };

function waitForNextLookup(signal) {
  return new Promise(resolve => {
    const finish = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, 2000);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export default function AnalyzeTransaction() {
  const mockMode = import.meta.env.VITE_USE_MOCKS === "true";
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState(idleStatus);
  const [storedResult, setStoredResult] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const transactionId = searchParams.get("transaction") || "";
  const result = storedResult?.transaction_id === transactionId ? storedResult : null;
  const { phase, message } = status.id === transactionId ? status : idleStatus;
  const activeRequest = useRef(null);
  const localSubmission = useRef(null);
  const confirmedTransaction = useRef(null);

  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));

  const findStoredResult = useCallback(async (id) => {
    if (!id) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const { signal } = controller;
    const isConfirmed = () => confirmedTransaction.current === id;
    const report = (phase, message) => setStatus({ id, phase, message });
    report(isConfirmed() ? "processing" : "confirming", isConfirmed()
      ? "Accepted for scoring. Waiting for the stored result."
      : "Checking whether the backend stored this transaction ID.");

    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (attempt > 0) await waitForNextLookup(signal);
        if (signal.aborted) return;

        let detail;
        try {
          detail = await request(`/api/transactions/${encodeURIComponent(id)}`, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          });
        } catch (error) {
          if (signal.aborted) return;
          if (error?.code !== "NOT_FOUND" && error?.code !== "BACKEND_UNAVAILABLE" && !(error?.status >= 500)) {
            report("error", errorMessage(error, "Could not retrieve the transaction result."));
            return;
          }
        }
        if (signal.aborted) return;
        if (detail?.transaction_id === id) {
          confirmedTransaction.current = id;
        }
        if (detail?.transaction_id === id && detail.risk_category !== "PENDING" && detail.fraud_probability != null) {
          const probability = Number(detail.fraud_probability);
          if (!Number.isFinite(probability) || probability < 0 || probability > 1 || !["LEGITIMATE", "SUSPICIOUS", "HIGH_RISK"].includes(detail.risk_category)) {
            report("error", "The backend returned an invalid stored prediction. No score is displayed.");
            return;
          }
          setStoredResult(detail);
          report("complete", "Prediction loaded from the stored transaction record.");
          return;
        }
        report(isConfirmed() ? "processing" : "confirming", isConfirmed()
          ? `Transaction accepted; waiting for the backend to persist a score (${attempt + 1}/30)…`
          : `Checking for a stored transaction (${attempt + 1}/30)…`);
      }

      report(isConfirmed() ? "pending" : "unconfirmed", isConfirmed()
        ? "The backend accepted this transaction. A stored prediction is still pending."
        : "The backend has not confirmed this transaction. Check the same ID again before submitting another analysis.");
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, []);

  useEffect(() => {
    if (transactionId && transactionId === localSubmission.current) return;
    localSubmission.current = null;
    confirmedTransaction.current = null;
    activeRequest.current?.abort();
    if (!transactionId) return;
    const lookup = window.setTimeout(() => void findStoredResult(transactionId), 0);
    return () => window.clearTimeout(lookup);
  }, [transactionId, findStoredResult]);

  useEffect(() => () => activeRequest.current?.abort(), []);

  function startNewAnalysis() {
    activeRequest.current?.abort();
    localSubmission.current = null;
    confirmedTransaction.current = null;
    setSearchParams({});
    setStoredResult(null);
    setStatus(idleStatus);
    setForm({ ...emptyForm, tx_time: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) });
  }

  async function submit(event) {
    event.preventDefault();
    if (mockMode || transactionId || activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    const { signal } = controller;
    setStoredResult(null);
    setStatus({ id: "", phase: "submitting", message: "" });
    let currentSubmissionId = transactionId;

    try {
      const transaction = {
        transaction_id: globalThis.crypto.randomUUID(),
        account_ref: form.account_ref.trim(),
        amount: Number(form.amount),
        tx_time: new Date(form.tx_time).toISOString(),
        category: form.category.trim(),
      };
      currentSubmissionId = transaction.transaction_id;
      setStatus({ id: currentSubmissionId, phase: "submitting", message: "" });
      localSubmission.current = transaction.transaction_id;
      setSearchParams({ transaction: transaction.transaction_id }, { replace: true });
      if (form.merchant.trim()) transaction.merchant = form.merchant.trim();
      for (const name of optionalNumbers) {
        if (form[name] !== "") transaction[name] = Number(form[name]);
      }

      const accepted = await request("/api/transactions", {
        method: "POST",
        body: JSON.stringify(transaction),
        expectedStatus: 202,
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      });
      if (signal.aborted) return;
      if (accepted?.status === "ACCEPTED" && accepted.transaction_id === currentSubmissionId) {
        confirmedTransaction.current = currentSubmissionId;
      }
      await findStoredResult(currentSubmissionId);
    } catch (error) {
      if (signal.aborted) return;
      if (currentSubmissionId && (["BACKEND_UNAVAILABLE", "UNEXPECTED_STATUS"].includes(error?.code) || error?.status >= 500)) {
        await findStoredResult(currentSubmissionId);
        return;
      }
      setStatus({ id: currentSubmissionId, phase: "error", message: errorMessage(error, "Transaction submission failed.") });
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }

  return (
    <div className="page-stack analysis-page">
      <header className="page-heading">
        <div className="analysis-title"><span className="admin-page-icon"><ScanSearch size={21} /></span><div><span className="eyebrow">TRANSACTION WORKSPACE</span><h1>Analyse Transaction</h1><p>Submit a transaction to the configured FraudLens scoring pipeline.</p></div></div>
      </header>

      {mockMode && <div className="analysis-notice" role="status"><AlertTriangle size={18} /><p>Mock mode is enabled. Genuine model scoring requires the real backend; submission is disabled here to avoid presenting mock values as predictions.</p></div>}

      <section className="panel analysis-form-panel">
        <div className="section-heading"><div><h2>Transaction details</h2><p>Required fields follow the backend ingestion schema. Location and age are optional.</p></div></div>
        <form className="analysis-form" onSubmit={submit}>
          <label>Account reference <span>Required</span><input name="account_ref" value={form.account_ref} onChange={update} maxLength={64} autoComplete="off" required aria-describedby="account-help" /><small id="account-help">Sent to the backend for account history features. Read APIs return a masked value.</small></label>
          <label>Amount <span>Required</span><input name="amount" type="number" min="0" max="10000000" step="0.01" value={form.amount} onChange={update} required /></label>
          <label>Transaction time <span>Required</span><input name="tx_time" type="datetime-local" value={form.tx_time} onChange={update} required /></label>
          <label>Category <span>Required</span><input name="category" value={form.category} onChange={update} maxLength={50} placeholder="e.g. shopping_net" required /></label>
          <label>Merchant <small>Optional</small><input name="merchant" value={form.merchant} onChange={update} maxLength={120} /></label>
          <label>Customer age <small>Optional</small><input name="customer_age" type="number" min="0" max="32767" step="1" value={form.customer_age} onChange={update} /></label>
          <fieldset className="analysis-location"><legend>Location coordinates <small>Optional; all four values are needed for distance scoring</small></legend>
            <label>Customer latitude<input name="lat" type="number" min="-90" max="90" step="any" value={form.lat} onChange={update} /></label>
            <label>Customer longitude<input name="lon" type="number" min="-180" max="180" step="any" value={form.lon} onChange={update} /></label>
            <label>Merchant latitude<input name="merch_lat" type="number" min="-90" max="90" step="any" value={form.merch_lat} onChange={update} /></label>
            <label>Merchant longitude<input name="merch_lon" type="number" min="-180" max="180" step="any" value={form.merch_lon} onChange={update} /></label>
          </fieldset>
          <div className="analysis-form-footer"><p><ShieldCheck size={16} /> Submitted through the authenticated API; no browser-held service token is used.</p><button className="button primary" type="submit" disabled={mockMode || Boolean(transactionId) || phase === "submitting" || phase === "processing"}>{phase === "submitting" ? <><LoaderCircle className="analysis-spin" size={16} />Submitting…</> : <>Analyse transaction <ArrowRight size={16} /></>}</button></div>
        </form>
      </section>

      {message && <section className={`panel analysis-status ${phase}`} role={phase === "error" ? "alert" : "status"} aria-live="polite">
        {phase === "complete" ? <CheckCircle2 size={19} /> : ["submitting", "confirming", "processing"].includes(phase) ? <LoaderCircle className="analysis-spin" size={19} /> : <AlertTriangle size={19} />}
        <div>
          <strong>{statusTitles[phase]}</strong>
          <p>{message}</p>
          {transactionId && <small>Transaction ID: {transactionId}</small>}
          {["pending", "unconfirmed"].includes(phase) && (
            <button className="button secondary" type="button" onClick={() => void findStoredResult(transactionId)}>Check again</button>
          )}
          {["pending", "unconfirmed", "complete", "error"].includes(phase) && (
            <button className="button secondary" type="button" onClick={startNewAnalysis}>Start another analysis</button>
          )}
        </div>
      </section>}

      {result && <section className="panel analysis-result">
        <div className="section-heading"><div><span className="eyebrow">STORED MODEL OUTPUT</span><h2>Prediction result</h2></div><RiskBadge value={result.risk_category} /></div>
        <div className="analysis-metrics"><div><span>Fraud probability</span><strong>{(Number(result.fraud_probability) * 100).toFixed(1)}%</strong></div><div><span>Anomaly detected</span><strong>{result.is_anomaly ? "Yes" : "No"}</strong></div><div><span>Model version</span><strong>{result.model_version || "Not supplied"}</strong></div><div><span>Scored at</span><strong>{result.scored_at ? localTime(result.scored_at) : "Not supplied"}</strong></div></div>
        <div className="analysis-result-detail"><h3>Explanation</h3>{result.top_reasons?.length ? <ul className="reason-list">{result.top_reasons.map((item, index) => <li key={`${item.feature || "reason"}-${index}`}>{item.text}{item.impact != null && <small>Impact: {Number(item.impact).toFixed(3)}</small>}</li>)}</ul> : <p>The backend did not supply explanation data for this result.</p>}</div>
        <div className="analysis-result-footer"><span>Transaction {result.transaction_id} · {result.account_masked} · {Number(result.amount).toFixed(2)}</span><Link className="button secondary" to={`/transactions?transaction=${encodeURIComponent(result.transaction_id)}`}>Open stored details <ArrowRight size={15} /></Link>{result.alert?.alert_id && <Link className="button secondary" to="/alerts">Review alert {result.alert.alert_id}</Link>}</div>
      </section>}
    </div>
  );
}
