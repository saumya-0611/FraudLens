
import { lazy, Suspense, useState } from "react";
import {
    Routes,
    Route,
    Navigate,
    useNavigate,
} from "react-router-dom";

import DashboardLayout from "./layouts/DashboardLayout";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./routes/ProtectedRoute";
import { useAuth } from "./hooks/useAuth";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Transactions = lazy(() => import("./pages/Transactions"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Users = lazy(() => import("./pages/admin/Users"));
const AuditLogs = lazy(() => import("./pages/admin/AuditLogs"));
const Models = lazy(() => import("./pages/admin/Models"));

import "./App.css";

// ------------------------------------
// LOGIN PAGE
// ------------------------------------

function LoginPage() {
    const [showPassword, setShowPassword] = useState(false);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const { login, user, loading } = useAuth();
    const navigate = useNavigate();

    // Handle login form submission.
    const handleLogin = async (event) => {
        event.preventDefault();
        setMessage("");

        if (!username.trim() || !password) {
            setMessage("Please enter your username and password.");
            return;
        }

        setSubmitting(true);

        try {
            await login(username.trim(), password);

            // Open the dashboard after successful login.
            navigate("/dashboard", { replace: true });
        } catch (error) {
            setMessage(
                error.message ||
                "Login failed. Please check your credentials."
            );
        } finally {
            setSubmitting(false);
        }
    };

    // These buttons are visual demo placeholders; no OAuth flow is connected.
    const handleSocialLogin = (provider) => {
        setMessage(`${provider} sign-in is a demo placeholder; OAuth is not connected.`);
    };

    // Wait until the existing session check finishes.
    if (loading) {
        return (
            <main className="login-page">
                <p>Checking your session...</p>
            </main>
        );
    }

    // If already logged in, go directly to the dashboard.
    if (user) {
        return <Navigate to="/dashboard" replace />;
    }

    return (
        <main className="login-page">
            <div className="ambient ambient-one" />
            <div className="ambient ambient-two" />

            <nav className="topbar">
                <a className="brand" href="/" aria-label="Fraud Lens home">
                    <span className="brand-mark">
                        <svg viewBox="0 0 32 32" fill="none">
                            <path
                                d="M16 3L27 8V15C27 22 22.5 27 16 30C9.5 27 5 22 5 15V8L16 3Z"
                                stroke="currentColor"
                                strokeWidth="2"
                            />
                            <path
                                d="M11 16L14.5 19.5L21.5 12"
                                stroke="currentColor"
                                strokeWidth="2.3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </span>

                    <span>
                        FRAUD<span className="brand-light">LENS</span>
                    </span>
                </a>

                <span className="topbar-label">
                    INTELLIGENT FRAUD MONITORING
                </span>
            </nav>

            <section className="login-layout">
                <div className="intro-panel">
                    <div className="eyebrow">
                        <span className="status-dot" />
                        REAL-TIME FINANCIAL SECURITY
                    </div>

                    <h1>
                        See the risk.
                        <br />
                        <span>Before it happens.</span>
                    </h1>

                    <p className="intro-description">
                        Intelligent transaction monitoring that helps you
                        identify suspicious activity, understand risk and
                        protect financial operations.
                    </p>

                    <div className="visual-area">
                        <div className="orbit orbit-one" />
                        <div className="orbit orbit-two" />
                        <div className="orbit orbit-three" />

                        <div className="security-core">
                            <svg viewBox="0 0 100 100" fill="none">
                                <path
                                    d="M50 9L82 23V45C82 65 69 81 50 91C31 81 18 65 18 45V23L50 9Z"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                />
                                <path
                                    d="M35 49L45 59L66 38"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        </div>

                        <div className="floating-tag tag-one">
                            <span className="tag-dot purple-dot" />
                            Intelligent detection
                        </div>

                        <div className="floating-tag tag-two">
                            <span className="tag-dot green-dot" />
                            Risk monitoring
                        </div>
                    </div>

                    <div className="intro-footer">
                        <span>AI-POWERED ANALYTICS</span>
                        <span>•</span>
                        <span>SECURE MONITORING</span>
                        <span>•</span>
                        <span>REAL-TIME INSIGHTS</span>
                    </div>
                </div>

                <div className="form-panel">
                    <div className="form-card">
                        <div className="mobile-brand">FRAUD LENS</div>

                        <div className="form-heading">
                            <span className="form-kicker">WELCOME BACK</span>
                            <h2>Sign in to your account</h2>
                            <p>
                                Enter your credentials to access your dashboard.
                            </p>
                        </div>

                        <form onSubmit={handleLogin}>
                            <div className="input-group">
                                <label htmlFor="username">Username</label>

                                <input
                                    id="username"
                                    type="text"
                                    placeholder="Enter your username"
                                    value={username}
                                    onChange={(event) =>
                                        setUsername(event.target.value)
                                    }
                                    autoComplete="username"
                                />
                            </div>

                            <div className="input-group">
                                <div className="label-row">
                                    <label htmlFor="password">Password</label>

                                    <span className="text-button">
                                        Contact your administrator for password help
                                    </span>
                                </div>

                                <div className="password-wrapper">
                                    <input
                                        id="password"
                                        type={showPassword ? "text" : "password"}
                                        placeholder="Enter your password"
                                        value={password}
                                        onChange={(event) =>
                                            setPassword(event.target.value)
                                        }
                                        autoComplete="current-password"
                                    />

                                    <button
                                        type="button"
                                        className="password-toggle"
                                        onClick={() =>
                                            setShowPassword(!showPassword)
                                        }
                                        aria-label={
                                            showPassword
                                                ? "Hide password"
                                                : "Show password"
                                        }
                                    >
                                        {showPassword ? "Hide" : "Show"}
                                    </button>
                                </div>
                            </div>

                            <button
                                className="submit-button"
                                type="submit"
                                disabled={submitting}
                            >
                                {submitting ? "Signing in..." : "Sign in"}
                                <span>→</span>
                            </button>

                            {message && (
                                <div className="form-message" role="status">
                                    {message}
                                </div>
                            )}
                        </form>

                        <div className="divider">
                            <span />
                            <p>DEMO PLACEHOLDERS · OAUTH NOT CONNECTED</p>
                            <span />
                        </div>

                        <div className="social-grid">
                            <button type="button" onClick={() => handleSocialLogin("Google")}>
                                <span className="social-icon google-icon">G</span>Google
                            </button>
                            <button type="button" onClick={() => handleSocialLogin("GitHub")}>
                                <span className="social-icon github-icon">GH</span>GitHub
                            </button>
                            <button type="button" onClick={() => handleSocialLogin("Facebook")}>
                                <span className="social-icon facebook-icon">f</span>Facebook
                            </button>
                            <button type="button" onClick={() => handleSocialLogin("X")}>
                                <span className="social-icon x-icon">𝕏</span>X
                            </button>
                        </div>

                        <p className="account-note">
                            Access is provided by your Fraud Lens administrator.
                        </p>
                    </div>

                    <p className="copyright">
                        © 2026 Fraud Lens. All rights reserved.
                    </p>
                </div>
            </section>
        </main>
    );
}

// ------------------------------------
// TEMPORARY PAGE CONTENT
// ------------------------------------

// ------------------------------------
// APPLICATION ROUTES
// ------------------------------------

function AppRoutes() {
    return (
        <Suspense fallback={<div className="preview-page">Loading workspace…</div>}>
        <Routes>
            {/* Public login page */}
            <Route path="/" element={<LoginPage />} />

            {/* All authenticated users */}
            <Route element={<ProtectedRoute />}>
                <Route element={<DashboardLayout />}>
                    <Route
                        path="/dashboard"
                        element={<Dashboard />}
                    />

                    <Route
                        path="/transactions"
                        element={<Transactions />}
                    />

                    {/* ADMIN and ANALYST only */}
                    <Route
                        element={
                            <ProtectedRoute
                                allowedRoles={["ADMIN", "ANALYST"]}
                            />
                        }
                    >
                        <Route
                            path="/alerts"
                            element={
                                <Alerts />
                            }
                        />
                    </Route>

                    {/* ADMIN only */}
                    <Route
                        element={
                            <ProtectedRoute
                                allowedRoles={["ADMIN"]}
                            />
                        }
                    >
                        <Route
                            path="/admin/users"
                            element={
                                <Users />
                            }
                        />

                        <Route
                            path="/admin/audit-logs"
                            element={
                                <AuditLogs />
                            }
                        />

                        <Route
                            path="/admin/models"
                            element={
                                <Models />
                            }
                        />
                    </Route>
                </Route>
            </Route>

            {/* Redirect unknown URLs */}
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
    );
}

// ------------------------------------
// ROOT APPLICATION
// ------------------------------------

function App() {
    return (
        <AuthProvider>
            <AppRoutes />
        </AuthProvider>
    );
}

export default App;
