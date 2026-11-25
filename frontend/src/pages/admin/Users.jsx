import { useCallback, useEffect, useState } from "react";
import { UserRoundPlus, UsersRound } from "lucide-react";
import { request } from "../../services/api";
import { errorMessage, localTime } from "../../services/format";
import { Empty, ErrorState, Loading, Modal, StateBadge } from "../../components/PageState";

const initialForm = { username: "", password: "", role: "VIEWER" };

export default function Users() {
    const [users, setUsers] = useState(null);
    const [error, setError] = useState("");
    const [dialog, setDialog] = useState(false);
    const [form, setForm] = useState(initialForm);
    const [formError, setFormError] = useState("");
    const [saving, setSaving] = useState(false);
    const [savingUserId, setSavingUserId] = useState(null);

    const load = useCallback(() => request("/api/users")
        .then(result => {
            setUsers(result.items || []);
            setError("");
        })
        .catch(requestError => setError(errorMessage(requestError, "Could not load users."))), []);

    useEffect(() => { void load(); }, [load]);

    const patch = async (user, changes) => {
        setError("");
        setSavingUserId(user.id);
        try {
            await request(`/api/users/${user.id}`, {
                method: "PATCH",
                body: JSON.stringify(changes),
            });
            await load();
        } catch (requestError) {
            setError(errorMessage(requestError, "Could not update user."));
        } finally {
            setSavingUserId(null);
        }
    };

    const create = async event => {
        event.preventDefault();
        setFormError("");
        if (form.password.length < 10) {
            setFormError("Password must be at least 10 characters.");
            return;
        }

        setSaving(true);
        try {
            await request("/api/users", { method: "POST", body: JSON.stringify(form) });
            setDialog(false);
            setForm(initialForm);
            await load();
        } catch (requestError) {
            setFormError(errorMessage(requestError, "Could not create user."));
        } finally {
            setSaving(false);
        }
    };

    if (users === null && !error) return <Loading label="Loading users…" />;

    return (
        <div className="page-stack">
            <header className="page-heading">
                <div className="admin-page-title">
                    <span className="admin-page-icon" aria-hidden="true"><UsersRound size={20} /></span>
                    <div>
                        <span className="eyebrow">ADMINISTRATION</span>
                        <h1>User management</h1>
                        <p>Create accounts and manage access roles.</p>
                    </div>
                </div>
                <button className="button" onClick={() => { setDialog(true); setFormError(""); }}>
                    <UserRoundPlus size={16} aria-hidden="true" /> Add user
                </button>
            </header>

            {error ? <ErrorState message={error} onRetry={load} /> : users.length ? (
                <div className="table-wrap panel">
                    <table>
                        <thead><tr><th>Username</th><th>Role</th><th>Status</th><th>Created</th><th>Change role</th><th>Access</th></tr></thead>
                        <tbody>
                            {users.map(user => {
                                const busy = savingUserId === user.id;
                                return (
                                    <tr key={user.id}>
                                        <td>{user.username}</td>
                                        <td>{user.role}</td>
                                        <td><StateBadge value={user.status} /></td>
                                        <td>{localTime(user.created_at)}</td>
                                        <td>
                                            <label className="sr-only" htmlFor={`role-${user.id}`}>Role for {user.username}</label>
                                            <select
                                                id={`role-${user.id}`}
                                                value={user.role}
                                                disabled={busy}
                                                onChange={event => void patch(user, { role: event.target.value })}
                                            >
                                                <option>ADMIN</option><option>ANALYST</option><option>VIEWER</option>
                                            </select>
                                        </td>
                                        <td>
                                            <button
                                                className="button secondary small"
                                                disabled={busy}
                                                onClick={() => void patch(user, { status: user.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })}
                                            >
                                                {busy ? "Saving…" : user.status === "ACTIVE" ? "Disable" : "Enable"}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : <Empty>No users found.</Empty>}

            {dialog && (
                <Modal title="Add user" onClose={() => setDialog(false)}>
                    <form className="form-stack" onSubmit={create}>
                        <label>Username<input required maxLength="50" autoComplete="off" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} /></label>
                        <label>Password<input required type="password" autoComplete="new-password" minLength={10} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></label>
                        <label>Role<select value={form.role} onChange={event => setForm({ ...form, role: event.target.value })}><option>ADMIN</option><option>ANALYST</option><option>VIEWER</option></select></label>
                        {formError && <div className="inline-notice error" role="alert">{formError}</div>}
                        <div className="modal-actions">
                            <button type="button" className="button secondary" onClick={() => setDialog(false)}>Cancel</button>
                            <button className="button" disabled={saving}>{saving ? "Creating…" : "Create user"}</button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
}
