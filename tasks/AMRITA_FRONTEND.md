# TASKS: AMRITA (Frontend)

**Branch prefix:** `amrita/`  **Presentation:** Fri 27 Nov 2026
**Read first:** `docs/CONTRACTS.md` (the law), `TEAMMATE.md` (workflow)

---

## CURRENT STATUS & WHAT IS LEFT FOR FINAL SUBMISSION (Updated 22 Nov 2026)

### Already Completed by Amrita (On `origin/dev` @ `298b99a` & `origin/amrita/frontend-skeleton`)
- **F1 (Project Setup & Layout)**: Vite + React + Tailwind config, `frontend/vite.config.js` (`/api` and `/ws` dev proxy to backend), `frontend/Dockerfile`, `src/layouts/DashboardLayout.jsx` (dark theme + role-filtered sidebar for `ADMIN`, `ANALYST`, `VIEWER`).
- **F2 (API Layer & Mocks)**: `src/services/api.js` (`credentials: "include"` wrapper), `src/mocks/mockApi.js`, and 8 mock JSON payloads (`alerts.json`, `transactions.json`, `transaction-details.json`, `dashboard-summary.json`, `dashboard-trends.json`, `users.json`, etc.).
- **F3 (Authentication & Route Protection)**: `src/context/AuthContext.jsx`, `src/routes/ProtectedRoute.jsx`, and the `LoginPage` UI in `src/App.jsx`.

### What Is LEFT for Amrita Before Final Submission (CRITICAL PATH)
Right now in `src/App.jsx`, all logged-in routes (`/dashboard`, `/transactions`, `/alerts`, `/admin/users`, `/admin/audit-logs`, `/admin/models`) render a placeholder `<PreviewPage />`. You need to replace `<PreviewPage />` with the actual screens using your `src/services/api.js` functions:

1. **F4 — Dashboard Page (`src/pages/Dashboard.jsx`)**:
   - **System Status Bar**: Show `system_status` (`backend`, `database`, `kafka`, `ml_service`, `streaming`) with green/red dot + `UP`/`DOWN` text.
   - **5 Summary KPI Cards**: `total_transactions`, `legitimate`, `suspicious`, `high_risk`, `open_alerts`, plus `latency_ms` (`score_p50`, `score_p95`, `alert_p95`). Auto-refresh every 5 seconds.
   - **60-Minute Trend Chart**: Use `recharts` (`AreaChart` or `LineChart`) plotting `points` (`minute`, `total`, `flagged`) from `GET /api/dashboard/trends?minutes=60`.
   - **Active Model & Drift Chip**: Display `active_model.version` and `active_model.drift_status` (`OK` / `WARNING` / `DRIFT`).
   - **Recent Alerts List**: Clickable rows opening the alert/transaction detail view.
2. **F5 — Real-Time WebSocket Alert Hook & Toast (`src/hooks/useAlertSocket.js`)**:
   - Connect to `ws(s)://${window.location.host}/ws/alerts` with auto-reconnect backoff.
   - On `{"type": "NEW_ALERT", "alert": ...}`, display a prominent toast notification (`"New HIGH-RISK alert: XXXX-2095 ($1,850.00)"`) with both icon and text, and refresh the dashboard/alerts state.
3. **F6 — Transactions Page & Explainable AI Drawer (`src/pages/Transactions.jsx`)**:
   - Filter bar (`risk` dropdown, `from`/`to` dates, `q` search box) + paginated table (`tx_time`, `account_masked`, `amount`, `category`, `merchant`, `risk_category` badge, `fraud_probability`).
   - Clicking a row calls `GET /api/transactions/:id` and opens a details drawer displaying:
     - **Why Flagged (`top_reasons`)**: Bullet list of the top 3 SHAP/XGBoost feature reasons (`text` + `impact`).
     - **13 Features (`features`)**: Collapsible key-value grid, `model_version`, `is_anomaly`, and linked `alert` state.
4. **F7 — Alerts Management Page (`src/pages/Alerts.jsx`, `ADMIN` & `ANALYST` only)**:
   - Paginated alerts table filtered by `state` (`NEW`, `UNDER_REVIEW`, `RESOLVED`).
   - Action buttons/dropdown to move `NEW -> UNDER_REVIEW -> RESOLVED`.
   - Choosing `RESOLVED` must open a modal forcing the analyst to pick **`CONFIRMED_FRAUD`** or **`FALSE_POSITIVE`** before calling `PATCH /api/alerts/:id`. Show a clear error toast if the server returns `409 CONFLICT`.
5. **F8 — Admin Pages (`src/pages/admin/Users.jsx`, `AuditLogs.jsx`, `Models.jsx`, `ADMIN` only)**:
   - `Users.jsx`: List users (`GET /api/users`), "Add User" form (`POST /api/users`), and role/status toggle (`PATCH /api/users/:id`).
   - `AuditLogs.jsx`: Paginated table (`GET /api/audit-logs`) with `action` and `username` filters.
   - `Models.jsx`: Model versions table (`GET /api/models` showing `version`, `status`, `pr_auc`, `sha256`), latest PSI drift card, and action buttons for **Run Drift Check** (`POST /api/models/drift-check`), **Retrain Candidate** (`POST /api/models/retrain`), and **Activate** (`POST /api/models/:version/activate`, enabled when `status === 'VALIDATED'`).
6. **F9, F10 & Selenium E2E Readiness**:
   - Keep standard form labels/placeholders (`Username`, `Password`, `Sign In`) so our **Selenium E2E test suite (`tests/selenium/test_fraudlens_e2e.py`)** passes against your UI.
   - Take clean screenshots of every screen for the final report and replace the old BhashaFlow slides in the team PPT with FraudLens slides.

---

## Starter prompt for your AI helper (paste this first)

> You are my pair-programmer on the FraudLens capstone (presentation 27 Nov 2026). Read `docs/CONTRACTS.md` and this task file completely before writing code.
> I own ONLY the `frontend/` folder. Do not edit any other folder. Never change CONTRACTS.md; if an API field or endpoint looks wrong or missing, stop and tell me.
> Stack: React + Vite + Tailwind CSS, react-router, recharts for charts. Plain JavaScript (JSX) is fine.
> The frontend calls only relative paths (`/api/...`, `/ws/alerts`) and Vite's dev proxy forwards them to the backend. Authentication is an httpOnly cookie, so use `fetch(..., { credentials: "include" })` and never store tokens in JavaScript.
> Build against mock data first (`VITE_USE_MOCKS=true`), with mocks that match the CONTRACTS JSON exactly, then switch to the real backend.
> Dark theme. Risk is shown by colour AND text label (green LEGITIMATE, amber SUSPICIOUS, red HIGH RISK). Keep the code simple and commented because I must explain it in a viva.
> Work task by task in the given order. After each task, give me the run command, a quick test, and a git commit message.

## Your folder
`frontend/` only. Layout: `src/pages/` (and `src/pages/admin/`), `components/`, `context/`, `hooks/`, `services/`, `mocks/`, `routes/`.

## What the backend gives you
Everything is in CONTRACTS section 8. Important facts:
- Account numbers arrive already masked (`account_masked`). Never try to show a full number.
- Unscored transactions have `risk_category: "PENDING"`.
- Alert states: `NEW`, `UNDER_REVIEW`, `RESOLVED`; resolving needs `resolution` = `CONFIRMED_FRAUD` or `FALSE_POSITIVE`.
- Errors always look like `{ "error": { "code", "message", "request_id" } }`.
- Roles: `ADMIN`, `ANALYST`, `VIEWER` (permission table in CONTRACTS section 2).
- Until the real backend is running, Riya provides `backend/scripts/seed_sample_data.js` to fill the DB with sample rows.

---

## Tasks

**F1. Project setup (Mon 16 Nov, push by night).** Vite + React, Tailwind, react-router. `vite.config.js` with a dev proxy: `/api` and `/ws` -> `process.env.VITE_PROXY_TARGET` (default `http://localhost:5000`, `ws: true` for `/ws`). `Dockerfile` that runs `npm run dev -- --host 0.0.0.0 --port 5173`. Layout with sidebar + top bar, dark theme. Branch `amrita/frontend-skeleton`.

**F2. API layer and mocks (Mon-Tue).** `src/services/api.js`: one `request(path, options)` wrapper (JSON, `credentials: "include"`, throws the parsed error object; on 401 redirect to `/login`). `src/mocks/*.json` + a mock switch so every function returns mock data when `VITE_USE_MOCKS=true`. Mock data must copy the CONTRACTS examples (include a mix of risk categories and alert states).

**F3. Auth (Tue 17 Nov).** `context/AuthContext.jsx` (calls `GET /api/auth/me` on load; holds `{username, role}`), `pages/Login.jsx` (username, password, Sign In; show the server's error message; no registration link because accounts are created by an admin), `routes/ProtectedRoute.jsx` (redirect to login if not authenticated; "Not allowed" page on wrong role). Sidebar items depend on role (VIEWER sees Dashboard + Transactions only; ANALYST adds Alerts; ADMIN adds Admin).

**F4. Dashboard (Tue 17 - Wed 18 Nov).** `pages/Dashboard.jsx`:
- System status bar (backend, database, kafka, ml_service, streaming; green/red dot + text UP/DOWN).
- Summary cards: total, suspicious, high-risk, open alerts. Auto-refresh every 5 s.
- Trend chart (recharts line/area: total vs flagged per minute, last 60 min).
- Recent alerts list (click opens the alert/transaction details).
- Active model + drift status chip.
- **Toast** for each new alert (see F5).
M1 (Wed 18): switch off mocks for the dashboard and see real data.

**F5. Live alerts (Wed 18 Nov).** `hooks/useAlertSocket.js`: connect to `ws://<host>/ws/alerts` (use `location.host` and `wss` when the page is https), reconnect with backoff, parse `{type:"NEW_ALERT", alert}`; on message show a toast "New HIGH-RISK alert: XXXX-2095, 1850.00" and refresh the alert list. Toast must not rely on colour alone (include text and an icon).

**F6. Transactions (Thu 19 Nov).** `pages/Transactions.jsx`: filter bar (risk, date range, search), table (time, masked account, amount, category, risk badge, score), paging, row click opens a **details panel** with all fields, `top_reasons` as a readable list ("Why flagged"), `features` in a collapsed section, model version, timestamps, and the alert block.

**F7. Alerts (Fri 20 Nov, ADMIN/ANALYST only).** `pages/Alerts.jsx`: list with risk score, state badge, time; status dropdown (NEW / UNDER REVIEW / RESOLVED). Choosing RESOLVED opens a small dialog that forces the choice **Confirmed fraud / False positive** before calling `PATCH /api/alerts/:id`. Handle 409 (already resolved) with a clear message. Optimistic update is optional; correctness first.

**F8. Admin (Sat 21 - Sun 22 Nov, ADMIN only).**
- `pages/admin/Users.jsx`: table, Add User dialog (username, password, role), enable/disable, change role. Show validation errors from the API.
- `pages/admin/AuditLogs.jsx`: table with filters (action, username), paging.
- `pages/admin/Models.jsx`: version table (status badge, metrics such as PR-AUC), drift status card with PSI value, buttons **Run drift check**, **Start retraining** (show spinner; result VALIDATED/REJECTED), **Activate** (enabled only for VALIDATED). Confirm dialogs for retrain and activate.

**F9. Quality pass (Mon 23 Nov = feature freeze).** Loading, empty and error states on every page; responsive layout (works on a phone-width screen); keyboard focus visible; labels on form fields; text contrast; no console errors. Add `frontend/README.md` (how to run, how to switch mocks).

**F10. Evidence and help (Tue 24 - Wed 25 Nov).** Take clean screenshots of every screen (for the report). Then help the team with the **presentation deck**: the current PPT contains slides from another project (BhashaFlow: grievance routing, different team); replace them with FraudLens content: problem, architecture, tech stack, pipeline flow, screens, team roles by specialization, results, and demo. (Ask the lead for the final numbers.)

---

## Rules specific to you
- Never hard-code `http://localhost:5000`. Always use relative paths.
- Never store anything sensitive in `localStorage`. The session is the cookie.
- If the API is missing something you need, message the lead; do not invent fields.
- Sort and format times in the user's local time zone for display; the API always sends UTC.

## Acceptance checklist
- [ ] Works with mocks and with the real backend (only an env switch changes)
- [ ] Role-based menu and route protection; VIEWER cannot open Alerts or Admin pages
- [ ] Live toast appears within a few seconds of a new HIGH-RISK alert
- [ ] Resolve flow forces Confirmed fraud / False positive
- [ ] Admin screens: users, audit logs, models (drift check, retrain, activate)
- [ ] Screenshots saved for the report; PR checklist from `TEAMMATE.md` completed for every PR
