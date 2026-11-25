# FraudLens frontend

React and Vite application for transaction monitoring, fraud alerts, and administrator tools. The UI uses the Aurora design tokens in `src/index.css` and follows the API definitions in `../docs/CONTRACTS.md`.

## Run locally

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

The local URL is normally `http://localhost:5173`. To use the demonstration data, set `VITE_USE_MOCKS=true` in `.env.local` before starting Vite. Mock-only accounts are `admin` / `admin123`, `analyst` / `analyst123`, and `viewer` / `viewer123`. Mock users, alert changes, and model actions are held in memory; they reset when the app reloads. Mock retraining uses fixture outcomes and does not train a model. Mock mode has no WebSocket server.

## Real backend mode

Set these values in `.env.local`, then restart Vite:

```dotenv
VITE_USE_MOCKS=false
VITE_PROXY_TARGET=http://localhost:5000
```

The frontend sends relative `/api/...` requests with `credentials: "include"`. Vite forwards `/api` and `/ws` to the configured backend target. Browser code never reads or stores the authentication cookie or a token. Network failures display a backend connection message; the app does not fall back to mock data. Production builds reject `VITE_USE_MOCKS=true`.

The Vite proxy is for local development. A production reverse proxy must send `/api` and `/ws` to the backend, preserve cookie forwarding and WebSocket upgrades, and serve `index.html` for client routes such as `/home`, `/dashboard`, and `/transactions` so direct refresh works.

## Customer workflow and integrations

- `/home` is the public overview; `/` remains the existing sign-in page.
- After authentication, **Data sources** opens `/integrations` for the current API contract, request example and processing-mode guidance. `/api-docs` opens the backend Swagger UI when it is available on the same host.
- **Analyse Transaction** and **Import transactions** are ADMIN-only. Analysts and viewers can read transaction data according to their existing role permissions; VIEWER stays read-only.
- The ingestion request is the documented `POST /api/transactions` API. A browser ADMIN session uses the existing httpOnly cookie. The browser does not receive or send `X-Service-Token`; that mechanism is for authorized server-to-server clients.
- A `202 ACCEPTED` response is an acknowledgement, not a prediction. The import page polls only the persisted transaction detail endpoint. It limits submission and polling to three concurrent requests, allows stopping future work, stores only transaction references in session storage, and does not resend requests with uncertain outcomes.
- CSV import is limited to 5 MB and 500 data rows. It previews and validates the contract fields, supports column mapping and cell correction, detects repeated IDs, and excludes invalid rows. XLSX files are not supported because this frontend has no approved workbook parser dependency. Excel files must be safely converted to CSV before import.
- Downloadable examples in `public/templates/` are synthetic inputs only. They contain no expected fraud labels or predictions.
- Transaction exports include fields returned by the authorized API, use masked account references, mark pending results, and neutralize formula-leading values. Filtered export follows the API's 100-row paging limit and caps a download at 10,000 records; the page reports truncation rather than implying the export is complete.

## Product and model boundaries

FraudLens receives transaction features for inference. Historical labeled training data is used by the model-training process; the fraud label is not part of a new transaction submission. The documented serving feature set contains 13 values, with the backend/streaming service deriving history and time features. The frontend sends only the transaction fields listed in the API contract.

The ML service documents XGBoost fraud probability, Isolation Forest anomaly scoring, and SHAP-style feature contributions. A stored prediction and its explanation are shown only when returned by the backend. `202 ACCEPTED` or `PENDING` never becomes a browser-generated score.

The platform supports an inline backend-to-ML path and a Kafka/Spark streaming path. The current frontend displays mode-specific evidence only from API responses; mock-mode service indicators say **SIMULATED**. This frontend cannot prove which mode a deployed service is running. See the repository simulator instructions in `../docs/demo-script.md`; the simulator has no browser `Run` endpoint in this app.

Roles follow the API contract: ADMIN manages users/models, imports and submits transactions; ANALYST investigates alerts and reads transactions; VIEWER is read-only. Account references are masked in API read responses. This shared application does not provide tenant isolation, customer-specific API keys, direct bank/UPI connections, or automatic payment blocking. These require separate backend/security work.

Google and LinkedIn sign-in remain dependent on their configured backend providers. GitHub is shown as unavailable because no GitHub OAuth provider is configured. Public self-registration and password recovery are not provided by the current backend contract.

## Quality commands

```powershell
cd frontend
npm.cmd run lint
npm.cmd run test
npm.cmd run build
npm.cmd run preview
```

`npm.cmd run test` runs the dependency-free Node test suite for CSV parsing, contract validation and safe exports. Selenium browser fixtures live under `../tests/selenium/`; they use controlled API/socket responses and are not real backend or ML integration tests. The mock-mode screenshots currently present are in `evidence/mock-mode/`; they are demonstration captures and may not reflect the latest UI changes.

## Screens

- `/` — login
- `/home` — public landing page
- `/dashboard` — monitoring summary, health, latency, trends, and recent alerts
- `/transactions` — filters, pagination, and transaction detail
- `/integrations` — API and data-source guidance for authenticated users
- `/imports` — ADMIN-only CSV preview, validation, batch submission, persisted result checks, and export
- `/alerts` — ADMIN and ANALYST review and resolution
- `/admin/users`, `/admin/audit-logs`, `/admin/models` — ADMIN tools
