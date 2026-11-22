# FraudLens frontend

The frontend is a React and Vite dashboard for reviewing fraud monitoring activity. It uses the API contract in `../docs/CONTRACTS.md`, with role based navigation for ADMIN, ANALYST and VIEWER accounts.

## Install and run

From PowerShell:

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). The demo mock accounts are `admin` / `admin123`, `analyst` / `analyst123` and `viewer` / `viewer123`. These are frontend mock credentials only.

## Mock mode

`frontend/.env.local` can contain:

```dotenv
VITE_USE_MOCKS=true
VITE_PROXY_TARGET=http://localhost:5000
```

Mock mode reads the sample JSON in `src/mocks/` and simulates the documented routes in `src/mocks/mockApi.js`. Alert state and created users stay in memory until a page refresh. Mock mode does not simulate a WebSocket server, so its alert socket status remains disconnected.

## Real backend mode

Set `VITE_USE_MOCKS=false` in `frontend/.env.local`, set `VITE_PROXY_TARGET` to the backend address reachable by the Vite dev server (normally `http://localhost:5000`), and start the backend plus its required services. Restart Vite after changing environment values. The frontend sends relative `/api/...` requests with cookies and opens `/ws/alerts` on the same host; JavaScript never reads or stores the auth cookie.

## Production build

```powershell
cd frontend
npm.cmd ci
npm.cmd run build
npm.cmd run preview
```

`npm.cmd run lint` runs Oxlint. The production build output is written to `frontend/dist/`.

## Frontend screens

- **Overview:** platform service status, summary figures, 60-minute activity chart, recent alerts and model drift status.
- **Transactions:** risk, date and text filters, paging, plus a transaction detail panel with model reasons and features.
- **Fraud alerts:** ADMIN and ANALYST case review with the documented resolution choices.
- **User management, audit logs and model management:** ADMIN-only access controls and model operations.

## Suggested presentation outline

Use verified project results from the team reports; do not infer accuracy, latency or throughput from demo data.

1. Problem: financial transaction fraud creates a need for timely, explainable review.
2. Proposed system: FraudLens monitors transactions and surfaces risk and alert context.
3. Architecture: React/Vite frontend, Express API, PostgreSQL, Kafka, Spark streaming and internal FastAPI model service.
4. Technology stack: list the technologies above and the libraries used by each service.
5. Transaction flow: simulator or source → API → Kafka → streaming feature calculation → ML scoring → database and fraud alert → dashboard/WebSocket.
6. Frontend walkthrough: sign in by role, inspect overview, open a transaction, review an alert and show admin screens.
7. Team roles: Lead (AI/ML, DevOps and streaming), Riya (backend routes and data science), Amrita (React frontend), Shivansh (security, authentication and audit).
8. Results: insert confirmed model evaluation, drift, security and load-test results from the team's reports.
9. Demo and limitations: demonstrate a seeded transaction/alert flow and identify any services or endpoints not yet integrated.

## Manual walkthrough

1. Run Vite in mock mode and sign in as `admin` to visit all pages.
2. Open Transactions, filter for HIGH_RISK and open TXN-1001; inspect “Why flagged” and the collapsed feature list. Open TXN-1004 to see a pending result.
3. Open Fraud Alerts, move a NEW alert to UNDER_REVIEW, then resolve it and choose a resolution.
4. In Users, create an account and toggle its status. In Audit Logs, filter by action or username. In Models, run the mock drift/retrain/activate flows.
5. Sign out and sign in as `viewer`; confirm only Overview and Transactions are available.

Screenshots should be captured from the running app after the team confirms the final demo data. No screenshots are checked in by this implementation because this environment has no browser capture runtime.
