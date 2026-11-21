
import { NavLink, Outlet } from "react-router-dom";

import {
    LayoutDashboard,
    ArrowLeftRight,
    ShieldAlert,
    Users,
    ScrollText,
    BrainCircuit,
    Settings,
    LogOut,
    ShieldCheck,
    Activity,
    Menu,
    X,
} from "lucide-react";

import { useState } from "react";
import "./DashboardLayout.css";

// Navigation items available to each role.
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
    // Temporary display values until AuthContext is connected in F3.
    const user = {
        username: "Demo User",
        role: "VIEWER",
    };

    const [menuOpen, setMenuOpen] = useState(false);

    const visibleNavigation = navigation.filter((item) =>
        item.roles.includes(user.role)
    );

    return (
        <div className="dashboard-shell">

            {/* Mobile menu button */}
            <button
                className="mobile-menu-button"
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            >
                {menuOpen ? <X size={21} /> : <Menu size={21} />}
            </button>

            {/* Sidebar */}
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

                <nav className="sidebar-navigation">
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
                        <span className="status-dot" />

                        <div>
                            <strong>System status</strong>
                            <small>Awaiting live connection</small>
                        </div>
                    </div>

                    <div className="sidebar-divider" />

                    <button
                        className="sidebar-utility"
                        type="button"
                        disabled
                        title="Settings will be available later"
                    >
                        <Settings size={18} />
                        <span>Settings</span>
                    </button>

                    <button
                        className="sidebar-utility"
                        type="button"
                        onClick={() => {
                            // Logout will be connected to the API in F3.
                        }}
                    >
                        <LogOut size={18} />
                        <span>Sign out</span>
                    </button>

                    <div className="sidebar-user">
                        <div className="user-avatar">
                            {user.username.charAt(0).toUpperCase()}
                        </div>

                        <div className="user-details">
                            <strong>{user.username}</strong>
                            <small>{user.role}</small>
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
                        <span className="topbar-role">{user.role}</span>
                    </div>
                </header>

                <section className="dashboard-content">
                    <Outlet />
                </section>

            </main>

        </div>
    );
}

export default DashboardLayout;
