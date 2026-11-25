import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { request } from "../services/api";
import { errorMessage, localTime } from "../services/format";
import { Empty, ErrorState, Loading, Modal, RiskBadge } from "../components/PageState";
import { useAuth } from "../hooks/useAuth";

export default function Transactions() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("transaction");
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [risk, setRisk] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const { user } = useAuth();

  const load = useCallback(() => {
    const search = new URLSearchParams({ page: String(page), page_size: "20" });
    if (risk) search.set("risk", risk);
    if (query) {
      const maskedAccount = query.trim().match(/^x{4}[-\s]?(\d{4})$/i);
      search.set("q", maskedAccount ? maskedAccount[1] : query.trim());
    }
    if (from) search.set("from", new Date(from).toISOString());
    if (to) search.set("to", new Date(`${to}T23:59:59.999`).toISOString());

    return request(`/api/transactions?${search}`)
      .then(result => { setData(result); setError(""); })
      .catch(requestError => setError(errorMessage(requestError, "Could not load transactions.")));
  }, [page, risk, query, from, to]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = id => {
    setDetail(null);
    setDetailError("");
    setParams({ transaction: id });
  };

  useEffect(() => {
    if (!selectedId) return undefined;
    let active = true;
    request(`/api/transactions/${encodeURIComponent(selectedId)}`)
      .then(result => { if (active) setDetail(result); })
      .catch(requestError => {
        if (active) setDetailError(errorMessage(requestError, "Could not load transaction details."));
      });
    return () => { active = false; };
  }, [selectedId, detailAttempt]);

  const closeDetail = () => {
    setDetail(null);
    setParams({});
  };

  if (!data && !error) return <Loading label="Loading transactions…" />;

  const timestamps = detail?.timestamps || detail || {};
  const alertTimestamps = detail?.alert || {};
  const features = detail?.features || {};

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div><span className="eyebrow">ACTIVITY</span><h1>Transactions</h1><p>Review scored and pending transactions.</p></div>
        {user?.role === "ADMIN" && <Link className="button primary" to="/analyse">Analyse transaction</Link>}
      </header>

      <section className="panel filter-bar">
        <label>Risk category
          <select value={risk} onChange={event => { setRisk(event.target.value); setPage(1); }}>
            <option value="">All risks</option><option>LEGITIMATE</option><option>SUSPICIOUS</option><option>HIGH_RISK</option><option>PENDING</option>
          </select>
        </label>
        <label>From<input type="date" value={from} onChange={event => { setFrom(event.target.value); setPage(1); }} /></label>
        <label>To<input type="date" value={to} onChange={event => { setTo(event.target.value); setPage(1); }} /></label>
        <label className="search-field">Search
          <input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Transaction, account, merchant or category" />
        </label>
        <button className="button secondary" onClick={load}>Refresh</button>
      </section>

      {error ? <ErrorState message={error} onRetry={load} /> : data?.items?.length ? (
        <>
          <div className="table-wrap panel">
            <table>
              <thead><tr><th>Time</th><th>Account / transaction</th><th>Amount</th><th>Category</th><th>Merchant</th><th>Risk</th><th>Fraud score</th></tr></thead>
              <tbody>
                {data.items.map(row => (
                  <tr key={row.transaction_id} tabIndex="0" onClick={() => openDetail(row.transaction_id)} onKeyDown={event => event.key === "Enter" && openDetail(row.transaction_id)}>
                    <td>{localTime(row.tx_time)}</td><td>{row.account_masked}<small className="cell-sub">{row.transaction_id}</small></td><td>{Number(row.amount).toFixed(2)}</td>
                    <td>{row.category}</td><td>{row.merchant || "—"}</td><td><RiskBadge value={row.risk_category} /></td>
                    <td>{row.fraud_probability == null ? "—" : `${(row.fraud_probability * 100).toFixed(1)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>{data.total} transactions · page {data.page}</span>
            <div>
              <button className="button secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button>
              <button className="button secondary" disabled={page * data.page_size >= data.total} onClick={() => setPage(value => value + 1)}>Next</button>
            </div>
          </div>
        </>
      ) : <Empty>No transactions match these filters.</Empty>}

      {selectedId && (
        <Modal title="Transaction details" onClose={closeDetail}>
          {detailError ? (
            <ErrorState message={detailError} onRetry={() => { setDetailError(""); setDetail(null); setDetailAttempt(value => value + 1); }} />
          ) : !detail ? <Loading /> : (
            <div className="detail-grid">
              <p><b>Transaction</b><span>{detail.transaction_id}</span></p>
              <p><b>Account</b><span>{detail.account_masked}</span></p>
              <p><b>Amount</b><span>{detail.amount}</span></p>
              <p><b>Category</b><span>{detail.category}</span></p>
              <p><b>Merchant</b><span>{detail.merchant || "—"}</span></p>
              <p><b>Risk</b><RiskBadge value={detail.risk_category} /></p>
              <p><b>Fraud probability</b><span>{detail.fraud_probability == null ? "Unscored" : `${(detail.fraud_probability * 100).toFixed(1)}%`}</span></p>
              <p><b>Anomaly</b><span>{detail.is_anomaly === null || detail.is_anomaly === undefined ? "Pending" : detail.is_anomaly ? "Yes" : "No"}</span></p>
              <p><b>Model version</b><span>{detail.model_version || "—"}</span></p>
              <p><b>Transaction time</b><span>{localTime(timestamps.tx_time)}</span></p>
              <p><b>Scored at</b><span>{localTime(timestamps.scored_at)}</span></p>
              <p><b>Ingested at</b><span>{localTime(timestamps.ingested_at)}</span></p>
              <div className="detail-wide">
                <h3>Why flagged</h3>
                {detail.top_reasons?.length ? (
                  <ul className="reason-list">
                    {detail.top_reasons.map((reason, index) => (
                      <li key={reason.feature || index}>
                        {typeof reason === "string" ? reason : <>{reason.text}{reason.impact != null && <small>Impact: {Number(reason.impact).toFixed(3)}</small>}</>}
                      </li>
                    ))}
                  </ul>
                ) : <p>No model reasons supplied.</p>}
              </div>
              <details className="detail-wide">
                <summary>Features</summary>
                {Object.keys(features).length ? (
                  <dl className="feature-grid">
                    {Object.entries(features).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{String(value)}</dd></div>)}
                  </dl>
                ) : <p>No feature values supplied.</p>}
              </details>
              <div className="detail-wide alert-detail">
                <b>Alert</b>
                {detail.alert ? (
                  <span>{detail.alert.alert_id} · {detail.alert.state}{detail.alert.resolution && ` · ${detail.alert.resolution}`}
                    {alertTimestamps.created_at && ` · Created ${localTime(alertTimestamps.created_at)}`}
                  </span>
                ) : <span>No alert</span>}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
