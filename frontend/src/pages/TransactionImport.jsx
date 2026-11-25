import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, Download, FileUp, Play, ShieldAlert, Square, UploadCloud } from "lucide-react";
import { Empty, Modal } from "../components/PageState";
import { useAuth } from "../hooks/useAuth";
import { request } from "../services/api";
import { downloadCsv, transactionsToCsv } from "../services/csvExport";
import { createTemplateCsv, initialColumnMapping, MAX_IMPORT_BYTES, parseCsv, REQUIRED_TRANSACTION_FIELDS, TRANSACTION_FIELDS, validateTransactionRows } from "../services/csvTransactions";
import { errorMessage } from "../services/format";
import "./ProductPages.css";
import "./TransactionImport.css";

const MAX_CONCURRENT_REQUESTS = 3;
const POLL_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 2000;
const VALID_RISKS = new Set(["LEGITIMATE", "SUSPICIOUS", "HIGH_RISK"]);

function readKnownSessionIds() {
  const ids = new Set();
  try {
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith("fraudlens-import-")) continue;
      const rows = JSON.parse(sessionStorage.getItem(key) || "[]");
      if (Array.isArray(rows)) rows.forEach(row => { if (typeof row?.transaction_id === "string") ids.add(row.transaction_id); });
    }
  } catch { /* Session references are a convenience, not a required storage service. */ }
  return ids;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function resultFromDetail(detail) {
  if (detail?.risk_category === "PENDING" || detail?.fraud_probability == null) return { status: "PENDING", detail };
  const probability = Number(detail.fraud_probability);
  if (!VALID_RISKS.has(detail.risk_category) || !Number.isFinite(probability) || probability < 0 || probability > 1 || typeof detail.is_anomaly !== "boolean" || typeof detail.model_version !== "string" || !detail.model_version.trim()) {
    return { status: "FAILED", message: "The stored response did not match the documented prediction fields." };
  }
  return { status: "SCORED", detail };
}

function resultLabel(status) {
  return ({ READY: "Ready", SUBMITTING: "Submitting", ACCEPTED: "Accepted", PENDING: "Pending", SCORED: "Scored", FAILED: "Failed", CHECK_REQUIRED: "Acceptance unknown", CHECKING: "Checking" })[status] || status;
}

export default function TransactionImport() {
  const mockMode = import.meta.env.VITE_USE_MOCKS === "true";
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [headers, setHeaders] = useState([]);
  const [sourceRows, setSourceRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [edits, setEdits] = useState({});
  const [runStates, setRunStates] = useState({});
  const [knownIds, setKnownIds] = useState(readKnownSessionIds);
  const [batchId, setBatchId] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const [exportError, setExportError] = useState("");
  const [restoredRows, setRestoredRows] = useState([]);
  const abortRef = useRef(null);
  const cancelledRef = useRef(false);
  const runStatesRef = useRef({});
  const initialBatch = useRef(new URLSearchParams(window.location.search).get("batch"));

  const preview = useMemo(() => validateTransactionRows(sourceRows, mapping, edits).map(row => {
    const priorReference = knownIds.has(row.payload.transaction_id);
    return priorReference ? { ...row, errors: [...row.errors, "This transaction ID already appears in a saved browser batch."] } : row;
  }), [sourceRows, mapping, edits, knownIds]);
  const validRows = preview.filter(row => row.errors.length === 0);
  const invalidRows = preview.length - validRows.length;
  const results = useMemo(() => preview.map(row => ({
    ...row,
    status: runStates[row.rowNumber]?.status || row.status,
    message: runStates[row.rowNumber]?.message || "",
    detail: runStates[row.rowNumber]?.detail || null,
  })), [preview, runStates]);
  const processed = Object.values(runStates).filter(row => ["ACCEPTED", "PENDING", "SCORED", "FAILED", "CHECK_REQUIRED"].includes(row.status)).length;
  const currentBatch = batchId || searchParams.get("batch") || "";

  const persistReferences = useCallback((id, rows) => {
    if (!id) return;
    const references = rows.map(row => ({ transaction_id: row.payload.transaction_id, status: row.status }));
    try { sessionStorage.setItem(`fraudlens-import-${id}`, JSON.stringify(references)); } catch { /* Session storage is optional; the URL batch reference remains. */ }
  }, []);

  function setRowState(rowNumber, value) {
    const next = {
      ...runStatesRef.current,
      [rowNumber]: { ...runStatesRef.current[rowNumber], ...value },
    };
    runStatesRef.current = next;
    setRunStates(next);
  }

  useEffect(() => {
    if (!currentBatch) return;
    const references = results.filter(row => row.payload?.transaction_id).map(row => ({ transaction_id: row.payload.transaction_id, status: runStates[row.rowNumber]?.status || row.status }));
    if (references.length) {
      try { sessionStorage.setItem(`fraudlens-import-${currentBatch}`, JSON.stringify(references)); } catch { /* Browsing still works without session storage. */ }
    }
  }, [currentBatch, results, runStates]);

  const refreshStoredRows = useCallback(async (rows, signal) => {
    const updates = {};
    for (let offset = 0; offset < rows.length; offset += MAX_CONCURRENT_REQUESTS) {
      if (signal?.aborted) break;
      const group = rows.slice(offset, offset + MAX_CONCURRENT_REQUESTS);
      await Promise.all(group.map(async row => {
        try {
          const detail = await request(`/api/transactions/${encodeURIComponent(row.transaction_id)}`, { signal });
          updates[row.transaction_id] = resultFromDetail(detail);
        } catch (error) {
          updates[row.transaction_id] = { status: error?.code === "NOT_FOUND" ? "CHECK_REQUIRED" : row.status || "CHECK_REQUIRED", message: errorMessage(error, "Stored status could not be retrieved.") };
        }
      }));
    }
    return updates;
  }, []);

  useEffect(() => {
    const id = initialBatch.current;
    if (!id) return undefined;
    setBatchId(id);
    let active = true;
    const controller = new AbortController();
    let references = [];
    try {
      const parsed = JSON.parse(sessionStorage.getItem(`fraudlens-import-${id}`) || "[]");
      if (Array.isArray(parsed)) references = parsed.filter(item => typeof item?.transaction_id === "string" && item.transaction_id.length <= 64);
    } catch { references = []; }
    if (!references.length) {
      setStatusMessage("No transaction references are saved for this batch in this browser session.");
      return () => controller.abort();
    }
    const checkingStates = Object.fromEntries(references.map((row, index) => [index + 2, { status: "CHECKING", message: "Checking stored transaction status.", transactionId: row.transaction_id }]));
    runStatesRef.current = checkingStates;
    setRunStates(checkingStates);
    setRestoredRows(references);
    const restore = async () => {
      const updates = await refreshStoredRows(references, controller.signal);
      if (!active) return;
      const restoredStates = {};
      references.forEach((reference, index) => {
        const result = updates[reference.transaction_id] || { status: "CHECK_REQUIRED", message: "Status is not available." };
        restoredStates[index + 2] = { ...result, status: result.status === "SCORED" || result.status === "FAILED" ? result.status : result.status === "PENDING" ? "PENDING" : "CHECK_REQUIRED", transactionId: reference.transaction_id };
      });
      runStatesRef.current = restoredStates;
      setRunStates(restoredStates);
      setStatusMessage("Restored transaction references only. Prediction values shown below come from the detail API.");
    };
    void restore();
    return () => { active = false; controller.abort(); };
  }, [refreshStoredRows]);

  useEffect(() => () => {
    cancelledRef.current = true;
    abortRef.current?.abort();
  }, []);

  async function acceptFile(file) {
    if (running) return;
    setParseError("");
    setSearchParams({});
    setStatusMessage("");
    setExportError("");
    setFileName(file?.name || "");
    setHeaders([]); setSourceRows([]); setMapping({}); setEdits({}); setRunStates({}); setBatchId("");
    runStatesRef.current = {};
    setRestoredRows([]);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      setParseError("Only CSV files are supported. Excel (.xlsx) parsing is unavailable in this build.");
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setParseError("The selected file exceeds the 5 MB import limit.");
      return;
    }
    try {
      const parsed = parseCsv(await file.text());
      setHeaders(parsed.headers);
      setSourceRows(parsed.rows);
      setMapping(initialColumnMapping(parsed.headers));
      if (parsed.headers.includes("ingested_at") || parsed.headers.includes("is_fraud")) {
        setStatusMessage("Columns such as ingested_at and is_fraud are not ingestion inputs and will not be sent.");
      }
    } catch (error) {
      setParseError(error.message || "Could not read the selected CSV file.");
    }
  }

  function editCell(rowNumber, field, value) {
    setEdits(current => ({ ...current, [rowNumber]: { ...current[rowNumber], [field]: value } }));
  }

  async function checkOne(rowNumber, transactionId) {
    setRowState(rowNumber, { status: "CHECKING", transactionId });
    try {
      const detail = await request(`/api/transactions/${encodeURIComponent(transactionId)}`);
      setRowState(rowNumber, { ...resultFromDetail(detail), transactionId });
    } catch (error) {
      setRowState(rowNumber, { status: "CHECK_REQUIRED", transactionId, message: errorMessage(error, "Could not verify this transaction. No resubmission was made.") });
    }
  }

  async function submitBatch() {
    setConfirmOpen(false);
    if (mockMode || user?.role !== "ADMIN" || !validRows.length || running) return;
    const id = globalThis.crypto.randomUUID();
    const controller = new AbortController();
    abortRef.current = controller;
    cancelledRef.current = false;
    setCancelled(false); setRunning(true); setBatchId(id); setStatusMessage("Submitting validated rows in groups of three. Accepted rows are not cancellable.");
    setSearchParams({ batch: id });
    const initial = Object.fromEntries(validRows.map(row => [row.rowNumber, { status: "READY", transactionId: row.payload.transaction_id }]));
    runStatesRef.current = initial;
    setRunStates(initial);
    persistReferences(id, validRows.map(row => ({ ...row, status: "READY" })));

    // Check persisted records before submission to reduce accidental duplicate IDs.
    for (let offset = 0; offset < validRows.length; offset += MAX_CONCURRENT_REQUESTS) {
      if (cancelledRef.current) break;
      const group = validRows.slice(offset, offset + MAX_CONCURRENT_REQUESTS);
      await Promise.all(group.map(async row => {
        setRowState(row.rowNumber, { status: "CHECKING", transactionId: row.payload.transaction_id });
        try {
          await request(`/api/transactions/${encodeURIComponent(row.payload.transaction_id)}`, { signal: controller.signal });
          setRowState(row.rowNumber, { status: "FAILED", transactionId: row.payload.transaction_id, message: "A transaction with this ID already exists; it was not submitted again." });
        } catch (error) {
          if (error?.code === "NOT_FOUND") setRowState(row.rowNumber, { status: "READY", transactionId: row.payload.transaction_id });
          else setRowState(row.rowNumber, { status: "CHECK_REQUIRED", transactionId: row.payload.transaction_id, message: errorMessage(error, "Could not verify whether this transaction ID already exists; it was not submitted.") });
        }
      }));
    }

    const postOne = async row => {
      if (cancelledRef.current) return;
      setRowState(row.rowNumber, { status: "SUBMITTING", transactionId: row.payload.transaction_id });
      try {
        const response = await request("/api/transactions", { method: "POST", signal: controller.signal, body: JSON.stringify(row.payload) });
        if (response?.status !== "ACCEPTED" || response.transaction_id !== row.payload.transaction_id) {
          throw { code: "INVALID_RESPONSE", message: "The API response did not confirm acceptance for this transaction ID." };
        }
        setRowState(row.rowNumber, { status: "ACCEPTED", transactionId: row.payload.transaction_id });
      } catch (error) {
        const uncertain = error?.code === "BACKEND_UNAVAILABLE" || error?.name === "AbortError";
        setRowState(row.rowNumber, { status: uncertain ? "CHECK_REQUIRED" : "FAILED", transactionId: row.payload.transaction_id, message: uncertain ? "The request outcome is unknown. Check the stored transaction before considering another submission." : errorMessage(error, "The API did not accept this row.") });
      }
    };

    try {
      const readyRows = validRows.filter(row => runStatesRef.current[row.rowNumber]?.status === "READY");
      for (let offset = 0; offset < readyRows.length; offset += MAX_CONCURRENT_REQUESTS) {
        if (cancelledRef.current) break;
        await Promise.all(readyRows.slice(offset, offset + MAX_CONCURRENT_REQUESTS).map(postOne));
      }

      if (!cancelledRef.current) {
        const acceptedRows = validRows.filter(row => runStatesRef.current[row.rowNumber]?.status === "ACCEPTED");
        for (let attempt = 0; attempt < POLL_ATTEMPTS && acceptedRows.some(row => ["ACCEPTED", "PENDING"].includes(runStatesRef.current[row.rowNumber]?.status)); attempt += 1) {
          await sleep(POLL_INTERVAL_MS, controller.signal);
          if (cancelledRef.current) break;
          const pollRows = acceptedRows.filter(row => ["ACCEPTED", "PENDING"].includes(runStatesRef.current[row.rowNumber]?.status));
          for (let offset = 0; offset < pollRows.length; offset += MAX_CONCURRENT_REQUESTS) {
            if (cancelledRef.current) break;
            const group = pollRows.slice(offset, offset + MAX_CONCURRENT_REQUESTS);
            await Promise.all(group.map(async row => {
              try {
                const detail = await request(`/api/transactions/${encodeURIComponent(row.payload.transaction_id)}`, { signal: controller.signal });
                setRowState(row.rowNumber, { ...resultFromDetail(detail), transactionId: row.payload.transaction_id });
              } catch (error) {
                if (error?.code !== "NOT_FOUND") setRowState(row.rowNumber, { status: "CHECK_REQUIRED", transactionId: row.payload.transaction_id, message: errorMessage(error, "Stored result could not be retrieved.") });
              }
            }));
          }
        }
      }
    } catch (error) {
      if (error?.name !== "AbortError") setStatusMessage(errorMessage(error, "Batch processing stopped."));
    } finally {
      setRunning(false);
      abortRef.current = null;
      if (cancelledRef.current) setCancelled(true);
      const refs = validRows.map(row => ({ ...row, status: runStatesRef.current[row.rowNumber]?.status || "CHECK_REQUIRED" }));
      persistReferences(id, refs);
      setKnownIds(current => new Set([...current, ...validRows.map(row => row.payload.transaction_id)]));
      if (cancelledRef.current) setStatusMessage("Stopped further submissions and polling. Some in-flight requests may already have been accepted; check their transaction IDs before retrying.");
      else {
        const counts = Object.values(runStatesRef.current).reduce((summary, row) => {
          summary[row.status] = (summary[row.status] || 0) + 1;
          return summary;
        }, {});
        setStatusMessage(`Batch results: ${counts.SCORED || 0} scored, ${counts.PENDING || 0} pending, ${counts.ACCEPTED || 0} accepted without a stored score, ${counts.FAILED || 0} failed or duplicate, ${counts.CHECK_REQUIRED || 0} need a status check. ${invalidRows} invalid row${invalidRows === 1 ? " was" : "s were"} excluded. Scores come only from stored API responses.`);
      }
    }
  }

  function stopBatch() {
    cancelledRef.current = true;
    setCancelled(true);
    abortRef.current?.abort();
  }

  function downloadTemplate() {
    downloadCsv("fraudlens-transaction-template.csv", createTemplateCsv());
  }

  function exportBatch() {
    const records = [...new Map([
      ...results.filter(row => row.detail).map(row => [row.detail.transaction_id, row.detail]),
      ...Object.values(runStatesRef.current).filter(row => row.detail).map(row => [row.detail.transaction_id, row.detail]),
    ]).values()];
    if (!records.length) { setExportError("No persisted transaction details are available to export yet."); return; }
    setExportError("");
    downloadCsv(`fraudlens-batch-${currentBatch || "results"}.csv`, transactionsToCsv(records));
  }

  if (user?.role !== "ADMIN") return <div className="panel state" role="alert">Only ADMIN users can access transaction imports.</div>;

  return (
    <div className="page-stack product-page import-page">
      <header className="page-heading"><div><span className="eyebrow">ADMIN TRANSACTION TOOLS</span><h1>Import transactions</h1><p>Validate a FraudLens CSV before sending each row to the existing ingestion API.</p></div><button type="button" className="button secondary" onClick={downloadTemplate}><Download size={16} /> Download synthetic CSV template</button></header>
      {mockMode && <div className="product-mode-note simulated" role="alert"><ShieldAlert size={18} /><p><strong>Import disabled in mock mode.</strong><br />Mock fixtures are for UI demonstration only. Switch explicitly to real API mode and use an approved disposable backend for write testing.</p></div>}
      {exportError && <div className="inline-notice error" role="alert">{exportError}</div>}
      <section className="panel import-panel">
        <div className="product-section-heading"><span className="product-icon"><UploadCloud size={20} /></span><div><h2>Select a transaction CSV</h2><p>CSV only · maximum 5 MB · maximum 500 rows per file</p></div></div>
        <label className={`drop-zone ${dragging ? "dragging" : ""}`} onDragOver={event => { event.preventDefault(); if (!running) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void acceptFile(event.dataTransfer.files?.[0]); }}>
          <FileUp size={24} aria-hidden="true" />
          <span>Drop a CSV here or <u>choose a file</u></span>
          <small>Spreadsheet cells are parsed as text and rendered as text; workbook files are not accepted.</small>
          <input type="file" accept=".csv,text/csv" aria-label="Choose transaction CSV" disabled={running} onChange={event => { void acceptFile(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        {fileName && <p className="import-file-name">Selected: <strong>{fileName}</strong></p>}
        {parseError && <div className="inline-notice error" role="alert">{parseError}</div>}
        {statusMessage && <div className="inline-notice" role="status">{statusMessage}</div>}
        <p className="product-note">Required: <code>transaction_id</code>, <code>account_ref</code>, <code>amount</code>, timezone-aware <code>tx_time</code>, <code>category</code>. Optional: merchant, four coordinates and customer age. The server remains the final validator.</p>
      </section>

      {headers.length > 0 && (
        <section className="panel import-panel">
          <div className="section-heading"><div><h2>Map and review columns</h2><p>Map each API field to a source column. Unsupported columns will not be sent.</p></div><span className="import-count">{sourceRows.length} rows</span></div>
          <div className="mapping-grid">{TRANSACTION_FIELDS.map(field => <label key={field}>{field}{REQUIRED_TRANSACTION_FIELDS.includes(field) && <span className="required-label">Required</span>}<select value={mapping[field] ?? ""} onChange={event => setMapping(current => ({ ...current, [field]: event.target.value }))}><option value="">Not mapped</option>{headers.map((header, index) => <option key={`${index}-${header}`} value={String(index)}>{header}</option>)}</select></label>)}</div>
          {invalidRows > 0 && <div className="inline-notice error" role="status">{invalidRows} row{invalidRows === 1 ? "" : "s"} have validation errors. Edit the preview values or mapping before submission. Valid rows can be submitted separately.</div>}
          <div className="table-wrap import-preview-wrap"><table><thead><tr><th>CSV row</th>{TRANSACTION_FIELDS.map(field => <th key={field}>{field}</th>)}<th>Validation / status</th></tr></thead><tbody>
            {results.map(row => <tr key={row.rowNumber}>
              <td>{row.rowNumber}</td>
              {TRANSACTION_FIELDS.map(field => <td key={field}>{mapping[field] ? <input aria-label={`CSV row ${row.rowNumber} ${field}`} value={row.raw[field] ?? ""} disabled={running} onChange={event => editCell(row.rowNumber, field, event.target.value)} /> : <span className="unmapped-value">—</span>}</td>)}
              <td className="import-row-status">{row.errors.length ? <span className="row-errors"><AlertCircle size={15} />{row.errors.join(" ")}</span> : <span className={`row-state ${row.status.toLowerCase()}`}>{row.status === "SCORED" ? <CheckCircle2 size={14} /> : null}{resultLabel(row.status)}</span>}{row.message && <small>{row.message}</small>}{row.detail && <div className="import-result-detail">{row.detail.risk_category === "PENDING" || row.detail.fraud_probability == null ? "No persisted score yet." : `${row.detail.risk_category} · ${(Number(row.detail.fraud_probability) * 100).toFixed(1)}% · ${row.detail.model_version || "model version unavailable"}`}{row.detail.account_masked && <small>{row.detail.account_masked}</small>}</div>}{["PENDING", "ACCEPTED", "CHECK_REQUIRED"].includes(row.status) && (row.payload.transaction_id || runStates[row.rowNumber]?.transactionId) && <button type="button" className="text-link" disabled={running} onClick={() => void checkOne(row.rowNumber, row.payload.transaction_id || runStates[row.rowNumber]?.transactionId)}>Check status</button>}</td>
            </tr>)}
          </tbody></table></div>
          <div className="import-actions"><span>{validRows.length} valid · {invalidRows} invalid · max {MAX_CONCURRENT_REQUESTS} concurrent requests</span><div>{running ? <button type="button" className="button danger" onClick={stopBatch}><Square size={15} /> Stop further work</button> : <button type="button" className="button primary" disabled={mockMode || !validRows.length || !headers.length} onClick={() => setConfirmOpen(true)}><Play size={15} /> Submit {validRows.length} valid rows</button>}{results.some(row => row.detail) && <button type="button" className="button secondary" onClick={exportBatch}><Download size={15} /> Export available results</button>}</div></div>
          {running && <div className="import-progress" role="status"><span>Progress: {processed} of {validRows.length} rows have an API outcome</span><progress max={validRows.length || 1} value={processed} /></div>}
          {cancelled && <p className="product-note">Cancellation stops additional requests and polling. It cannot roll back a transaction already accepted by the backend.</p>}
          {exportError && <p className="copy-error" role="alert">{exportError}</p>}
        </section>
      )}

      {headers.length === 0 && restoredRows.length > 0 && <section className="panel import-panel"><div className="section-heading"><div><h2>Restored batch references</h2><p>Only IDs are retained between page loads. Displayed result fields come from authorized transaction-detail responses.</p></div><button type="button" className="button secondary" onClick={exportBatch}><Download size={15} /> Export available results</button></div><div className="table-wrap import-preview-wrap"><table><thead><tr><th>Transaction ID</th><th>Status</th><th>Stored result</th><th>Action</th></tr></thead><tbody>{restoredRows.map((row,index)=>{const state=runStates[index+2]||{};return <tr key={row.transaction_id}><td>{row.transaction_id}</td><td>{resultLabel(state.status||row.status)}</td><td>{state.detail ? (state.detail.fraud_probability == null ? "No score stored" : `${state.detail.risk_category} · ${(Number(state.detail.fraud_probability)*100).toFixed(1)}%`) : state.message||"Not loaded"}{state.detail?.account_masked&&<small>{state.detail.account_masked}</small>}</td><td><button type="button" className="text-link" onClick={()=>void checkOne(index+2,row.transaction_id)}>Check status</button></td></tr>})}</tbody></table></div></section>}

      {!headers.length && !parseError && <Empty>Choose a CSV to see field mapping, validation, and a safe pre-submission preview.</Empty>}

      {confirmOpen && <Modal title="Confirm transaction import" onClose={() => setConfirmOpen(false)}><p>You are about to submit {validRows.length} validated transaction{validRows.length === 1 ? "" : "s"} using the authenticated ADMIN session. {invalidRows} invalid row{invalidRows === 1 ? "" : "s"} will be excluded. Acceptance is not a prediction; scoring may remain pending.</p><p>Each request uses the existing <code>POST /api/transactions</code> contract. No real import is sent in mock mode.</p><div className="modal-actions"><button className="button secondary" type="button" onClick={() => setConfirmOpen(false)}>Review more</button><button className="button primary" type="button" onClick={() => void submitBatch()} disabled={mockMode}><Play size={15} /> Submit validated rows</button></div></Modal>}
    </div>
  );
}
