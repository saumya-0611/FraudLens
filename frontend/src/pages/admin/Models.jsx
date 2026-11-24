import { useCallback, useEffect, useState } from "react";
import { BrainCircuit, CirclePlay, RotateCw, ScanSearch } from "lucide-react";
import { request } from "../../services/api";
import { errorMessage, localTime } from "../../services/format";
import { Empty, ErrorState, Loading, Modal, StateBadge } from "../../components/PageState";

export default function Models() {
    const [data, setData] = useState(null);
    const [error, setError] = useState("");
    const [dialog, setDialog] = useState(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");

    const load = useCallback(() => request("/api/models")
        .then(result => { setData(result); setError(""); })
        .catch(requestError => setError(errorMessage(requestError, "Could not load models."))), []);

    useEffect(() => { void load(); }, [load]);

    const act = async () => {
        if (!dialog || busy) return;
        setBusy(true);
        setMessage("");
        try {
            let result;
            if (dialog.type === "drift") {
                result = await request("/api/models/drift-check", { method: "POST" });
                setMessage(`Drift check completed: ${result.status}.`);
            } else if (dialog.type === "retrain") {
                result = await request("/api/models/retrain", { method: "POST" });
                setMessage(`Retraining result: ${result.status}${result.version ? ` (${result.version})` : ""}.`);
            } else {
                result = await request(`/api/models/${encodeURIComponent(dialog.version)}/activate`, { method: "POST" });
                if (result?.status !== "ACTIVE" || result?.active_version !== dialog.version) {
                    throw new Error("The backend did not confirm model activation.");
                }
                setMessage(`Model ${result.active_version} is active.`);
            }
            setDialog(null);
            await load();
        } catch (requestError) {
            setMessage(errorMessage(requestError, "The model operation failed."));
        } finally {
            setBusy(false);
        }
    };

    if (!data && !error) return <Loading label="Loading model registry…" />;
    const models = data?.models || [];
    const drift = data?.latest_drift;

    return (
        <div className="page-stack">
            <header className="page-heading">
                <div className="admin-page-title">
                    <span className="admin-page-icon" aria-hidden="true"><BrainCircuit size={20} /></span>
                    <div>
                        <span className="eyebrow">ADMINISTRATION</span>
                        <h1>Model management</h1>
                        <p>Inspect model versions and run lifecycle operations.</p>
                    </div>
                </div>
            </header>

            {error ? <ErrorState message={error} onRetry={load} /> : (
                <>
                    <section className="panel drift-card">
                        <div>
                            <span className="eyebrow">LATEST DRIFT REPORT</span>
                            <h2>{drift?.status || "No report available"}</h2>
                            <p>{drift
                                ? `PSI score ${drift.psi_score} · sample size ${drift.sample_size} · ${localTime(drift.created_at)}`
                                : "Run a drift check to create a report."}</p>
                        </div>
                        <div className="action-row">
                            <button className="button secondary" onClick={() => setDialog({ type: "drift" })}>
                                <ScanSearch size={15} aria-hidden="true" /> Run drift check
                            </button>
                            <button className="button" onClick={() => setDialog({ type: "retrain" })}>
                                <RotateCw size={15} aria-hidden="true" /> Start retraining
                            </button>
                        </div>
                    </section>

                    {message && <div className="inline-notice" role="status">{message}</div>}

                    {models.length ? (
                        <div className="table-wrap panel">
                            <table className="model-table">
                                <thead><tr><th>Version</th><th>Algorithm</th><th>Status</th><th>PR-AUC</th><th>SHA-256</th><th>Created</th><th>Action</th></tr></thead>
                                <tbody>
                                    {models.map(model => (
                                        <tr key={model.version}>
                                            <td>{model.version}{model.version === data.active_version && <small className="cell-sub">Active</small>}</td>
                                            <td>{model.algorithm || "—"}</td>
                                            <td><StateBadge value={model.status} /></td>
                                            <td>{model.metrics?.pr_auc == null ? "—" : Number(model.metrics.pr_auc).toFixed(4)}</td>
                                            <td><code title={model.sha256 || "No digest supplied"}>{model.sha256 ? `${model.sha256.slice(0, 12)}…` : "—"}</code></td>
                                            <td>{localTime(model.created_at)}</td>
                                            <td>
                                                <button
                                                    className="button secondary small"
                                                    disabled={busy || model.status !== "VALIDATED"}
                                                    onClick={() => setDialog({ type: "activate", version: model.version })}
                                                >
                                                    <CirclePlay size={14} aria-hidden="true" /> Activate
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : <Empty>No model versions are available.</Empty>}
                </>
            )}

            {dialog && (
                <Modal
                    title={dialog.type === "activate" ? "Activate model" : dialog.type === "retrain" ? "Start retraining" : "Run drift check"}
                    onClose={() => !busy && setDialog(null)}
                >
                    <p>{dialog.type === "activate"
                        ? `Activate validated model ${dialog.version}?`
                        : dialog.type === "retrain"
                            ? "Start a model retraining job? This may take some time."
                            : "Run drift detection against the latest scored transactions?"}</p>
                    <div className="modal-actions">
                        <button className="button secondary" disabled={busy} onClick={() => setDialog(null)}>Cancel</button>
                        <button className="button" disabled={busy} onClick={() => void act()}>{busy ? "Working…" : "Confirm"}</button>
                    </div>
                </Modal>
            )}
        </div>
    );
}
