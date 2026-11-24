import { useCallback, useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { request } from "../../services/api";
import { errorMessage, localTime } from "../../services/format";
import { Empty, ErrorState, Loading } from "../../components/PageState";

export default function AuditLogs() {
    const [action, setAction] = useState("");
    const [username, setUsername] = useState("");
    const [page, setPage] = useState(1);
    const [data, setData] = useState(null);
    const [error, setError] = useState("");

    const load = useCallback(() => {
        const query = new URLSearchParams({ page: String(page), page_size: "20" });
        if (action.trim()) query.set("action", action.trim());
        if (username.trim()) query.set("username", username.trim());
        return request(`/api/audit-logs?${query}`)
            .then(result => { setData(result); setError(""); })
            .catch(requestError => setError(errorMessage(requestError, "Could not load audit logs.")));
    }, [action, page, username]);

    useEffect(() => { void load(); }, [load]);

    if (!data && !error) return <Loading label="Loading audit logs…" />;

    return (
        <div className="page-stack">
            <header className="page-heading">
                <div className="admin-page-title">
                    <span className="admin-page-icon" aria-hidden="true"><ScrollText size={20} /></span>
                    <div>
                        <span className="eyebrow">ADMINISTRATION</span>
                        <h1>Audit logs</h1>
                        <p>Review recorded security and administration events.</p>
                    </div>
                </div>
            </header>

            <section className="panel filter-bar">
                <label>Action<input value={action} onChange={event => { setAction(event.target.value); setPage(1); }} placeholder="Filter by action" /></label>
                <label>Username<input value={username} onChange={event => { setUsername(event.target.value); setPage(1); }} placeholder="Exact username" /></label>
                <button className="button secondary" onClick={() => void load()}>Refresh</button>
            </section>

            {error ? <ErrorState message={error} onRetry={load} /> : data?.items?.length ? (
                <>
                    <div className="table-wrap panel">
                        <table>
                            <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Entity ID</th><th>Details</th></tr></thead>
                            <tbody>
                                {data.items.map((row, index) => (
                                    <tr key={row.id ?? `${row.event_time}-${index}`}>
                                        <td>{localTime(row.event_time)}</td>
                                        <td>{row.username || "System"}</td>
                                        <td>{row.action}</td>
                                        <td>{row.entity || "—"}</td>
                                        <td>{row.entity_id || "—"}</td>
                                        <td><details><summary>View details</summary><pre>{JSON.stringify(row.details || {}, null, 2)}</pre></details></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="pagination">
                        <span>{data.total} events · page {page}</span>
                        <div>
                            <button className="button secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button>
                            <button className="button secondary" disabled={page * data.page_size >= data.total} onClick={() => setPage(value => value + 1)}>Next</button>
                        </div>
                    </div>
                </>
            ) : <Empty>No audit events match these filters.</Empty>}
        </div>
    );
}
