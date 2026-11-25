import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, BadgeCheck, BellRing, CircleAlert, ShieldAlert } from "lucide-react";
import { request } from "../services/api";
import { errorMessage, localTime } from "../services/format";
import { Empty, ErrorState, Loading, StateBadge } from "../components/PageState";
import { useAuth } from "../hooks/useAuth";

const serviceNames = ["backend", "database", "kafka", "ml_service", "streaming"];
const latencyMetrics = [
  ["Scoring p50", "score_p50"],
  ["Scoring p95", "score_p95"],
  ["Alert p95", "alert_p95"],
];

function formatTrendMinute(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatMetric(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : "—";
}

function formatLatency(value) {
  const formatted = formatMetric(value);
  return formatted === "—" ? formatted : `${formatted} ms`;
}

export default function Dashboard() {
  const mockMode = import.meta.env.VITE_USE_MOCKS === "true";
  const [summary, setSummary] = useState(null);
  const [trends, setTrends] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState("");
  const { user } = useAuth();
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      const alertRequest = ["ADMIN", "ANALYST"].includes(user?.role)
        ? request("/api/alerts?page=1&page_size=5").then(result => result.items || [])
        : request("/api/transactions?risk=HIGH_RISK&page=1&page_size=5").then(result =>
            (result.items || []).filter(row => row.alert).map(row => ({
              alert_id: row.alert.alert_id,
              transaction_id: row.transaction_id,
              account_masked: row.account_masked,
              amount: row.amount,
              category: row.category,
              created_at: row.tx_time,
              state: row.alert.state,
            })),
          );

      const [summaryResult, trendResult, alertItems] = await Promise.all([
        request("/api/dashboard/summary"),
        request("/api/dashboard/trends?minutes=60"),
        alertRequest,
      ]);
      setSummary(summaryResult);
      setTrends(trendResult.points || []);
      setAlerts(alertItems);
      setError("");
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not load dashboard data."));
    }
  }, [user]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    const handleNewAlert = () => void refresh();
    window.addEventListener("fraudlens:new-alert", handleNewAlert);
    return () => window.removeEventListener("fraudlens:new-alert", handleNewAlert);
  }, [refresh]);

  if (!summary && !error) return <Loading label="Loading dashboard…" />;
  if (!summary && error) return <ErrorState message={error} onRetry={refresh} />;

  const systems = summary.system_status || {};
  const cards = [
    ["Total transactions", summary.total_transactions, "total", Activity],
    ["Legitimate", summary.legitimate, "legitimate", BadgeCheck],
    ["Suspicious", summary.suspicious, "suspicious", CircleAlert],
    ["High risk", summary.high_risk, "high-risk", ShieldAlert],
    ["Open alerts", summary.open_alerts, "open-alerts", BellRing],
  ];

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">{mockMode ? "SYNTHETIC DEMO DATA" : "BACKEND-REPORTED DATA"}</span>
          <h1>Overview</h1>
          <p>Transaction activity and service health reported by the configured backend.</p>
        </div>
      </header>
      <p className="dashboard-data-note" role="note">Service health below comes from the dashboard API and is separate from this browser’s connection. The configured backend may include seeded demonstration records.</p>
      {error && <ErrorState message={error} onRetry={refresh} />}

      <section className="status-strip" aria-label="System status">
        {serviceNames.map(name => {
          const serviceStatus = systems[name];
          const statusLabel = serviceStatus === "UP" || serviceStatus === "DOWN" ? serviceStatus : "UNKNOWN";
          return (
            <div className="status-item" key={name}>
              <i className={statusLabel === "UP" ? "online" : statusLabel === "DOWN" ? "offline" : ""} aria-hidden="true" />
              <span>{name.replace("_", " ")}</span>
              <strong>{statusLabel}</strong>
            </div>
          );
        })}
      </section>

      <section className="stat-grid" aria-label="Transaction summary">
          {cards.map(([label, value, tone, Icon]) => (
          <article className={`stat-card panel ${tone}`} key={label}>
            <div className="stat-card-heading">
              <span>{label}</span>
              <span className="stat-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.8} /></span>
            </div>
            <strong>{formatMetric(value)}</strong>
          </article>
        ))}
      </section>

      <section className="panel latency-panel" aria-label="Latency metrics">
        <h2>Processing latency</h2>
        <div className="latency-grid">
          {latencyMetrics.map(([label, key]) => (
            <div key={key}>
              <span>{label}</span>
              <strong>{formatLatency(summary.latency_ms?.[key])}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="panel chart-panel">
        <div className="section-heading">
          <div>
            <h2>Transaction trend</h2>
            <p>Per-minute volume over the last 60 minutes</p>
          </div>
          <span className="chart-legend"><i /> Total <i className="flagged-dot" /> Flagged</span>
        </div>
        {trends.length ? (
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trends}>
                <defs>
                  <linearGradient id="totalFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity={0.26} />
                    <stop offset="95%" stopColor="var(--brand-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border-default)" strokeDasharray="4 4" />
                <XAxis dataKey="minute" tickFormatter={formatTrendMinute} minTickGap={28} stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
                <YAxis width={38} stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)", borderRadius: 8, color: "var(--text-primary)" }} />
                <Area type="monotone" dataKey="total" name="Total" stroke="var(--brand-primary)" fill="url(#totalFill)" />
                <Area type="monotone" dataKey="flagged" name="Flagged" stroke="var(--accent-danger)" fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : <Empty>No trend points are available yet.</Empty>}
      </section>

      <section className="lower-grid">
        <article className="panel">
          <div className="section-heading">
            <div><h2>Recent alerts</h2><p>Latest high-risk activity</p></div>
            {["ADMIN", "ANALYST"].includes(user?.role) && (
              <button className="text-link" onClick={() => navigate("/alerts")}>View all</button>
            )}
          </div>
          {alerts.length ? (
            <div className="recent-list">
              {alerts.map(alert => (
                <button
                  className="recent-row"
                  key={alert.alert_id}
                  onClick={() => navigate(`/transactions?transaction=${encodeURIComponent(alert.transaction_id)}`)}
                >
                  <span className="recent-icon" aria-hidden="true">!</span>
                  <span className="recent-main">
                    <strong>{alert.account_masked} · {alert.transaction_id}</strong>
                    <small>{alert.category || "Transaction"} · {localTime(alert.created_at)} · {Number(alert.amount).toFixed(2)}</small>
                  </span>
                  <StateBadge value={alert.state} />
                </button>
              ))}
            </div>
          ) : <Empty>No recent alerts available.</Empty>}
        </article>

        <article className="panel model-card">
          <div className="section-heading"><div><h2>Active model</h2><p>Current scoring configuration</p></div></div>
          <strong className="model-version">{summary.active_model?.version || "—"}</strong>
          <div className="model-meta"><span>Drift status</span><StateBadge value={summary.active_model?.drift_status} /></div>
          <small>Backend snapshot updated {localTime(summary.updated_at)}</small>
        </article>
      </section>
    </div>
  );
}
