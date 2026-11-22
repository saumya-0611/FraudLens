import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { request } from "../services/api";
import { localTime, errorMessage } from "../services/format";
import { Empty, ErrorState, Loading, RiskBadge, StateBadge } from "../components/PageState";
import { useAuth } from "../hooks/useAuth";

export default function Dashboard() {
  const [summary, setSummary] = useState(null), [trends, setTrends] = useState([]), [alerts, setAlerts] = useState([]), [error, setError] = useState("");
  const { user } = useAuth(); const navigate = useNavigate();
  const refresh = useCallback(() => Promise.all([
        request("/api/dashboard/summary"), request("/api/dashboard/trends?minutes=60"),
        ["ADMIN", "ANALYST"].includes(user?.role) ? request("/api/alerts?page=1&page_size=5") : request("/api/transactions?risk=HIGH_RISK&page=1&page_size=5").then(result => ({items:(result.items||[]).filter(row=>row.alert).map(row=>({...row.alert,transaction_id:row.transaction_id,account_masked:row.account_masked,amount:row.amount,risk_category:row.risk_category,activity_time:row.tx_time}))})),
      ]).then(([s, t, a]) => {
        setSummary(s); setTrends(t.points || []); setAlerts(a.items || []); setError("");
      }).catch(e => setError(errorMessage(e, "Could not load dashboard data."))), [user]);
  useEffect(() => { void refresh(); const timer = window.setInterval(refresh, 5000); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => { const handleNewAlert = () => refresh(); window.addEventListener("fraudlens:new-alert", handleNewAlert); return () => window.removeEventListener("fraudlens:new-alert", handleNewAlert); }, [refresh]);
  if (!summary && !error) return <Loading label="Loading dashboard…"/>;
  if (error && !summary) return <ErrorState message={error} onRetry={refresh}/>;
  const systems = summary?.system_status || {};
  return <div className="page-stack">
    <header className="page-heading"><div><span className="eyebrow">LIVE MONITORING</span><h1>Overview</h1><p>Transaction activity and platform health at a glance.</p></div></header>
    {error && <ErrorState message={error} onRetry={refresh}/>}
    <section className="status-strip" aria-label="System status">{["backend","database","kafka","ml_service","streaming"].map(key => { const up = systems[key] === "UP"; return <div className="status-item" key={key}><i className={up ? "online" : "offline"}/><span>{key.replace("_", " ")}</span><strong>{up ? "UP" : "DOWN"}</strong></div>; })}</section>
    <section className="stat-grid">{[["Total transactions",summary?.total_transactions,"activity"],["Suspicious",summary?.suspicious,"alert"],["High risk",summary?.high_risk,"danger"],["Open alerts",summary?.open_alerts,"purple"]].map(([label,value,tone])=><article className="stat-card panel" key={label}><span>{label}</span><strong className={tone}>{Number(value || 0).toLocaleString()}</strong></article>)}</section>
    <section className="panel chart-panel"><div className="section-heading"><div><h2>Transaction trend</h2><p>Per-minute volume over the last 60 minutes</p></div><span className="chart-legend"><i/> Total <i className="flagged-dot"/> Flagged</span></div>{trends.length ? <div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trends}><defs><linearGradient id="totalFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8a63e8" stopOpacity={0.32}/><stop offset="95%" stopColor="#8a63e8" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#292838" strokeDasharray="4 4"/><XAxis dataKey="minute" stroke="#858294" tick={{fontSize:11}}/><YAxis stroke="#858294" tick={{fontSize:11}}/><Tooltip contentStyle={{background:"#171621",border:"1px solid #343143",borderRadius:8}}/><Area type="monotone" dataKey="total" name="Total" stroke="#a98be8" fill="url(#totalFill)"/><Area type="monotone" dataKey="flagged" name="Flagged" stroke="#ef7180" fill="none"/></AreaChart></ResponsiveContainer></div> : <Empty>No trend points are available yet.</Empty>}</section>
    <section className="lower-grid"><article className="panel"><div className="section-heading"><div><h2>Recent alerts</h2><p>Latest high-risk activity</p></div>{["ADMIN","ANALYST"].includes(user?.role)&&<button className="text-link" onClick={()=>navigate("/alerts")}>View all</button>}</div>{alerts.length ? <div className="recent-list">{alerts.map(a=><button className="recent-row" key={a.alert_id} onClick={()=>navigate(`/transactions?transaction=${encodeURIComponent(a.transaction_id)}`)}><span className="recent-icon">!</span><span className="recent-main"><strong>{a.account_masked} · {a.transaction_id}</strong><small>{localTime(a.created_at||a.activity_time)} · {Number(a.amount).toFixed(2)}</small></span><RiskBadge value={a.risk_category}/><StateBadge value={a.state}/></button>)}</div> : <Empty>No recent alerts available.</Empty>}</article>
      <article className="panel model-card"><div className="section-heading"><div><h2>Active model</h2><p>Current scoring configuration</p></div></div><strong className="model-version">{summary?.active_model?.version || "—"}</strong><div className="model-meta"><span>Drift status</span><StateBadge value={summary?.active_model?.drift_status || "—"}/></div><small>Updated {localTime(summary?.updated_at)}</small></article></section>
  </div>;
}
