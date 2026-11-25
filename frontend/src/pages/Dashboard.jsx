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
const TREND_RANGES = [
  { key: "60m", label: "60m", minutes: 60, stepMs: 60 * 1000, subtitle: "Per-minute volume over the last 60 minutes" },
  { key: "24h", label: "24h", minutes: 1440, stepMs: 60 * 60 * 1000, subtitle: "Hourly volume over the last 24 hours" },
  { key: "7d", label: "7d", minutes: 10080, stepMs: 60 * 60 * 1000, subtitle: "Hourly volume over the last 7 days" },
];

function formatTrendTick(value, rangeKey) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (rangeKey === "7d") {
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" });
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTrendTooltipLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeTrendSeries(points, range) {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (!points.every(point => !Number.isNaN(Date.parse(point.minute)))) {
    return points;
  }

  const { stepMs, minutes } = range;
  const byBucket = new Map();
  let minBucket = Infinity;
  let maxBucket = -Infinity;

  for (const point of points) {
    const bucketMs = Math.floor(Date.parse(point.minute) / stepMs) * stepMs;
    const prev = byBucket.get(bucketMs) || { total: 0, flagged: 0 };
    byBucket.set(bucketMs, {
      total: prev.total + Number(point.total || 0),
      flagged: prev.flagged + Number(point.flagged || 0),
    });
    if (bucketMs < minBucket) minBucket = bucketMs;
    if (bucketMs > maxBucket) maxBucket = bucketMs;
  }

  const nowBucket = Math.floor(Date.now() / stepMs) * stepMs;
  const endBucket = Math.max(nowBucket, maxBucket);
  const bucketCount = Math.max(2, Math.round((minutes * 60 * 1000) / stepMs));
  const startBucket = Math.min(endBucket - (bucketCount - 1) * stepMs, minBucket);

  const filled = [];
  for (let ts = startBucket; ts <= endBucket; ts += stepMs) {
    const entry = byBucket.get(ts);
    filled.push({
      minute: new Date(ts).toISOString(),
      total: entry ? entry.total : 0,
      flagged: entry ? entry.flagged : 0,
    });
  }
  return filled;
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
  const [trendRangeKey, setTrendRangeKey] = useState("60m");
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState("");
  const { user } = useAuth();
  const navigate = useNavigate();

  const activeRange = TREND_RANGES.find(item => item.key === trendRangeKey) || TREND_RANGES[0];

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
        request(`/api/dashboard/trends?minutes=${activeRange.minutes}`),
        alertRequest,
      ]);
      setSummary(summaryResult);
      setTrends(normalizeTrendSeries(trendResult.points || [], activeRange));
      setAlerts(alertItems);
      setError("");
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not load dashboard data."));
    }
  }, [user, activeRange]);

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
      <p className="dashboard-data-note" role="note">{mockMode ? "The values and service indicators below are synthetic mock fixtures; they do not show connected PostgreSQL, Kafka, Spark, or ML services." : "Service health below comes from the dashboard API and is separate from this browser’s connection. The configured backend may include seeded demonstration records."}</p>
      {error && <ErrorState message={error} onRetry={refresh} />}

      <section className="status-strip" aria-label="System status">
        {serviceNames.map(name => {
          const serviceStatus = systems[name];
          const statusLabel = mockMode ? "SIMULATED" : serviceStatus === "UP" || serviceStatus === "DOWN" ? serviceStatus : "UNKNOWN";
          return (
            <div className="status-item" key={name}>
              <i className={statusLabel === "UP" ? "online" : statusLabel === "DOWN" ? "offline" : statusLabel === "SIMULATED" ? "simulated" : ""} aria-hidden="true" />
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
            <p>{activeRange.subtitle}</p>
          </div>
          <div className="chart-controls">
            <div className="chart-range-group" role="group" aria-label="Trend time range">
              {TREND_RANGES.map(range => (
                <button
                  key={range.key}
                  type="button"
                  className={`chart-range-btn${range.key === activeRange.key ? " active" : ""}`}
                  aria-pressed={range.key === activeRange.key}
                  onClick={() => setTrendRangeKey(range.key)}
                >
                  {range.label}
                </button>
              ))}
            </div>
            <span className="chart-legend"><i /> Total <i className="flagged-dot" /> Flagged</span>
          </div>
        </div>
        {trends.length ? (
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
              <AreaChart data={trends} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="totalFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="var(--brand-primary)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="flaggedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-danger)" stopOpacity={0.24} />
                    <stop offset="95%" stopColor="var(--accent-danger)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border-default)" strokeDasharray="4 4" />
                <XAxis
                  dataKey="minute"
                  tickFormatter={value => formatTrendTick(value, activeRange.key)}
                  minTickGap={32}
                  stroke="var(--text-muted)"
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  width={38}
                  allowDecimals={false}
                  stroke="var(--text-muted)"
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  labelFormatter={formatTrendTooltipLabel}
                  contentStyle={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  name="Total"
                  stroke="var(--brand-primary)"
                  strokeWidth={2}
                  fill="url(#totalFill)"
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="flagged"
                  name="Flagged"
                  stroke="var(--accent-danger)"
                  strokeWidth={2}
                  fill="url(#flaggedFill)"
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Empty>
            <div>No trend points in the last {activeRange.label}.</div>
            {Number(summary.total_transactions) > 0 && activeRange.key !== "7d" && (
              <div className="chart-empty-action">
                <button type="button" className="button secondary small" onClick={() => setTrendRangeKey("7d")}>
                  Show last 7 days
                </button>
              </div>
            )}
          </Empty>
        )}
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
