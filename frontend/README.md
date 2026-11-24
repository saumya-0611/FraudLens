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

## Quality commands

```powershell
cd frontend
npm.cmd run lint
npm.cmd run build
npm.cmd run preview
```

The package currently has lint and build scripts but no standalone frontend test script. The mock-mode screenshots currently present are in `evidence/mock-mode/`; they are demonstration captures and may not reflect the latest UI changes.

## Screens

- `/` — login
- `/home` — public landing page
- `/dashboard` — monitoring summary, health, latency, trends, and recent alerts
- `/transactions` — filters, pagination, and transaction detail
- `/alerts` — ADMIN and ANALYST review and resolution
- `/admin/users`, `/admin/audit-logs`, `/admin/models` — ADMIN tools
