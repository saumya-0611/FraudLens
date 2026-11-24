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
const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));

export default function AnalyzeTransaction() {
  const mockMode = import.meta.env.VITE_USE_MOCKS === "true";
  const [form, setForm] = useState(emptyForm);
  const [phase, setPhase] = useState("idle");
  const [transactionId, setTransactionId] = useState("");
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const initialLookup = useRef(false);
  const submissionLock = useRef(false);

  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));

  const findStoredResult = useCallback(async (id) => {
    if (!id) return;
    setPhase("processing");
    setMessage("Accepted for scoring. Waiting for the persisted transaction result…");

    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (attempt > 0) await wait(2000);
      try {
        const detail = await request(`/api/transactions/${encodeURIComponent(id)}`);
        if (detail.risk_category && detail.risk_category !== "PENDING" && detail.fraud_probability != null) {
          const probability = Number(detail.fraud_probability);
          if (!Number.isFinite(probability) || probability < 0 || probability > 1 || !["LEGITIMATE", "SUSPICIOUS", "HIGH_RISK"].includes(detail.risk_category)) {
            setPhase("error");
            setMessage("The backend returned an invalid stored prediction. No score is displayed.");
            return;
          }
          setResult(detail);
          setPhase("complete");
          setMessage("Prediction loaded from the stored transaction record.");
          return;
        }
      } catch (error) {
        if (error?.code !== "NOT_FOUND") {
          setPhase("error");
          setMessage(errorMessage(error, "Could not retrieve the transaction result."));
          return;
        }
      }
      setMessage(`Transaction accepted; waiting for the backend to persist a score (${attempt + 1}/30)…`);
    }

    setPhase("pending");
    setMessage("The backend accepted this transaction, but no stored prediction is available yet. You can check again later.");
  }, []);

  const requestedId = searchParams.get("transaction");
  useEffect(() => {
    if (!requestedId || initialLookup.current) return;
    initialLookup.current = true;
    setTransactionId(requestedId);
    void findStoredResult(requestedId);
  }, [requestedId, findStoredResult]);

  function startNewAnalysis() {
    setSearchParams({});
    setTransactionId("");
    setResult(null);
    setMessage("");
    setPhase("idle");
    setForm({ ...emptyForm, tx_time: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) });
    initialLookup.current = false;
  }

  async function submit(event) {
    event.preventDefault();
    if (mockMode || transactionId || submissionLock.current) return;
    submissionLock.current = true;
    setMessage("");
    setResult(null);
    setPhase("submitting");
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
      setTransactionId(transaction.transaction_id);
      initialLookup.current = true;
      setSearchParams({ transaction: transaction.transaction_id }, { replace: true });
      if (form.merchant.trim()) transaction.merchant = form.merchant.trim();
      for (const name of optionalNumbers) {
        if (form[name] !== "") transaction[name] = Number(form[name]);
      }

      const accepted = await request("/api/transactions", {
        method: "POST",
        body: JSON.stringify(transaction),
      });
      if (accepted?.status !== "ACCEPTED" || accepted.transaction_id !== currentSubmissionId) {
        throw { code: "INVALID_RESPONSE", message: "The ingestion API returned an unexpected acceptance response." };
      }
      await findStoredResult(accepted.transaction_id);
    } catch (error) {
      if (error?.code === "BACKEND_UNAVAILABLE" && currentSubmissionId) {
        setPhase("pending");
        setMessage("The connection failed before acceptance could be confirmed. Checking this transaction ID; do not submit it again.");
        void findStoredResult(currentSubmissionId);
        return;
      }
      setPhase("error");
      setMessage(errorMessage(error, "Transaction submission failed."));
    } finally {
      submissionLock.current = false;
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
        {phase === "complete" ? <CheckCircle2 size={19} /> : phase === "submitting" || phase === "processing" ? <LoaderCircle className="analysis-spin" size={19} /> : <AlertTriangle size={19} />}
        <div><strong>{phase === "complete" ? "Analysis complete" : phase === "pending" ? "Scoring still pending" : phase === "error" ? "Analysis could not be completed" : "Processing transaction"}</strong><p>{message}</p>{transactionId && <small>Transaction ID: {transactionId}</small>}{phase === "pending" && <button className="button secondary" type="button" onClick={() => void findStoredResult(transactionId)}>Check again</button>}{["pending", "complete", "error"].includes(phase) && <button className="button secondary" type="button" onClick={startNewAnalysis}>Start another analysis</button>}</div>
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
