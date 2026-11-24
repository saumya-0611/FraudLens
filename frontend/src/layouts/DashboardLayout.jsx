
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import {
    LayoutDashboard,
    ArrowLeftRight,
    ShieldAlert,
    Users,
    ScrollText,
    BrainCircuit,
    LogOut,
    ShieldCheck,
    Activity,
    Menu,
    X,
} from "lucide-react";

import { useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { useAlertSocket } from "../hooks/useAlertSocket";
import "./DashboardLayout.css";

const navigation = [
    {
        label: "Overview",
        path: "/dashboard",
        icon: LayoutDashboard,
        roles: ["ADMIN", "ANALYST", "VIEWER"],
    },
    {
        label: "Transactions",
        path: "/transactions",
        icon: ArrowLeftRight,
        roles: ["ADMIN", "ANALYST", "VIEWER"],
    },
    {
        label: "Fraud Alerts",
        path: "/alerts",
        icon: ShieldAlert,
        roles: ["ADMIN", "ANALYST"],
    },
    {
        label: "Users",
        path: "/admin/users",
        icon: Users,
        roles: ["ADMIN"],
    },
    {
        label: "Audit Logs",
        path: "/admin/audit-logs",
        icon: ScrollText,
        roles: ["ADMIN"],
    },
    {
        label: "Models",
        path: "/admin/models",
        icon: BrainCircuit,
        roles: ["ADMIN"],
    },
];

function DashboardLayout() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const [menuOpen, setMenuOpen] = useState(false);
    const [logoutError, setLogoutError] = useState("");
    const mockMode = import.meta.env.VITE_USE_MOCKS === "true";
    const { status: alertSocketStatus, toasts } = useAlertSocket({ enabled: Boolean(user) && !mockMode });

    useEffect(() => {
        if (!menuOpen) return undefined;
        const closeOnEscape = event => {
            if (event.key === "Escape") setMenuOpen(false);
        };
        document.addEventListener("keydown", closeOnEscape);
        return () => document.removeEventListener("keydown", closeOnEscape);
    }, [menuOpen]);

    const visibleNavigation = navigation.filter((item) =>
        item.roles.includes(user?.role)
    );

    async function handleLogout() {
        setLogoutError("");

        try {
            await logout();
            navigate("/", { replace: true });
        } catch {
            setLogoutError("Unable to sign out. Please try again.");
        }
    }

    return (
        <div className="dashboard-shell">

            {/* Mobile menu button */}
            <button
                className="mobile-menu-button"
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label={menuOpen ? "Close navigation" : "Open navigation"}
                aria-expanded={menuOpen}
                aria-controls="primary-navigation"
            >
                {menuOpen ? <X size={21} /> : <Menu size={21} />}
            </button>

            {/* Sidebar */}
            {menuOpen && (
                <button
                    className="sidebar-backdrop"
                    type="button"
                    aria-label="Close navigation"
                    onClick={() => setMenuOpen(false)}
                />
            )}
            <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>

                <div className="sidebar-brand">
                    <div className="brand-mark">
                        <ShieldCheck size={23} />
                    </div>

                    <div>
                        <h2>
                            Fraud<span>Lens</span>
                        </h2>
                        <p>INTELLIGENCE PLATFORM</p>
                    </div>
                </div>

                <div className="sidebar-section-label">
                    WORKSPACE
                </div>

                <nav className="sidebar-navigation" id="primary-navigation" aria-label="Workspace">
                    {visibleNavigation.map((item) => {
                        const Icon = item.icon;

                        return (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                end={item.path === "/dashboard"}
                                onClick={() => setMenuOpen(false)}
                                className={({ isActive }) =>
                                    `sidebar-link ${isActive ? "active" : ""}`
                                }
                            >
                                <Icon size={19} strokeWidth={1.8} />
                                <span>{item.label}</span>
                            </NavLink>
                        );
                    })}
                </nav>

                <div className="sidebar-bottom">

                    <div className="system-status">
                        <span className={`status-dot ${mockMode ? "status-mock" : alertSocketStatus === "Connected" ? "online" : "offline"}`} />

                        <div>
                            <strong>Live alerts</strong>
                            <small>{mockMode ? "Disabled in mock mode" : alertSocketStatus}</small>
                        </div>
                    </div>

                    <div className="sidebar-divider" />

                    <button
                        className="sidebar-utility"
                        type="button"
                        onClick={handleLogout}
                    >
                        <LogOut size={18} />
                        <span>Sign out</span>
                    </button>

                    {logoutError && (
                        <small role="alert">{logoutError}</small>
                    )}

                    <div className="sidebar-user">
                        <div className="user-avatar">
                            {user?.username?.charAt(0).toUpperCase()}
                        </div>

                        <div className="user-details">
                            <strong>{user?.username}</strong>
                            <small>{user?.role}</small>
                        </div>

                        <Activity
                            size={17}
                            className="user-activity"
                        />
                    </div>

                </div>
            </aside>

            {/* Main content */}
            <main className="dashboard-main">

                <header className="dashboard-topbar">
                    <div>
                        <span className="topbar-eyebrow">
                            FRAUD MONITORING
                        </span>
                        <p>Real-Time Financial Intelligence</p>
                    </div>

                    <div className="topbar-profile">
                        <span className="socket-status"><i className={alertSocketStatus === "Connected" ? "online" : "offline"}/>Alerts {alertSocketStatus}</span>
                        <span className="topbar-role">{user?.role}</span>
                    </div>
                </header>

                <section className="dashboard-content">
                    <Outlet />
                </section>

            </main>

            <div className="toast-stack" aria-live="polite">{toasts.map(toast => <div className="toast" role="status" key={toast.id}><span aria-hidden="true">⚠</span>{toast.text}</div>)}</div>

        </div>
    );
}

export default DashboardLayout;
