# FraudLens Free Cloud Deployment Guide (Vercel + Render + UptimeRobot)

Deploy FraudLens live for **\$0/month** using the exact **Vercel + Render + UptimeRobot** architecture (same workflow as BhashaFlow), with zero manual SQL steps.

---

## 1. Architecture on Render Free + Vercel Free

```text
Browser (HTTPS)
   │
   ▼
Vercel Free (React + Vite SPA, frontend/vercel.json)
   ├── /api/* , /health , /ready , /api-docs*  ──► Render Free Web Service: fraudlens-backend (Express)
   │                                         ├── Applies the base database schema at startup
   │                                         ├── PIPELINE_MODE=inline (13 features + 50-tx lookback)
   │                                         ├── Calls ML /predict (X-Internal-Token) ──► Render Free Web Service: fraudlens-ml-service (FastAPI XGBoost + Isolation Forest)
   │                                         └── PostgreSQL 16 ──────────────────────────► Render Free Postgres (or Neon.tech free forever)
   └── Live Alerts: automatic 5s HTTPS polling fallback on Vercel (native WSS on Docker/Caddy VM)

UptimeRobot Free (5-minute pings):
   ├── GET https://<your-backend>.onrender.com/health      (keeps Backend warm 24/7)
   └── GET https://<your-ml-service>.onrender.com/health   (keeps ML Service warm 24/7)
```

> **Why every security check works on Vercel + Render:**
> Because [frontend/vercel.json](file:///e:/FraudLens/frontend/vercel.json) rewrites `/api/:path*` to Render, the browser only talks to **one origin** (`https://<your-app>.vercel.app`). That preserves `Sec-Fetch-Site: same-origin` CSRF protection and `httpOnly; Secure; SameSite=Lax` JWT cookies (`fl_token`). And `fraudlens-ml-service` has `/docs` disabled and requires `X-Internal-Token` for inference and model management.

---

## 2. Step-by-Step Deployment

### Step A — Deploy Backend, ML Service & PostgreSQL on Render (`render.yaml`)
1. Go to **Render Dashboard** → **New +** → **Blueprint**.
2. Connect your GitHub repository (`saumya-0611/FraudLens`, branch `main`).
3. Render detects [render.yaml](file:///e:/FraudLens/render.yaml) and shows 3 **Free** resources:
   - `fraudlens-db` (PostgreSQL 16, Free)
   - `fraudlens-ml-service` (Docker Web Service, Free)
   - `fraudlens-backend` (Docker Web Service, Free)
4. Fill in the prompted `sync: false` environment variables (never start any secret/password with `change_me`):
   - `INTERNAL_ML_TOKEN` — **must be identical** in both `fraudlens-ml-service` and `fraudlens-backend` (e.g., 32+ random chars)
   - `SERVICE_TOKEN` — strong random token for `simulator/replay.py`
   - `WS_ALLOWED_ORIGINS` — your Vercel URL (e.g. `https://fraudlens.vercel.app`; you can update this right after Step B)
5. Click **Apply**.
   - The backend applies its base schema before accepting requests. Render uses `/ready` for deployment checks. The ML service reports readiness after verifying and loading an artifact and checking that its internal token is configured.
6. Copy your exact live Render URLs once green:
   - Backend: `https://<your-backend>.onrender.com`
   - ML Service: `https://<your-ml-service>.onrender.com`

> **Tip for permanent storage beyond 30 days:** Render Free PostgreSQL expires after 30 days. For a permanent free database, create a free PostgreSQL 16 database on **Neon.tech**, paste its `DATABASE_URL` into both `fraudlens-backend` and `fraudlens-ml-service`, and set `DATABASE_SSL=true`.

7. Provision initial users once from an authorized environment with network access to the target database. Set the target `DATABASE_URL`, `JWT_SECRET`, and distinct `SEED_ADMIN_PASSWORD`, `SEED_ANALYST_PASSWORD`, and `SEED_VIEWER_PASSWORD` in that process environment using your secret store. Use the database provider’s required TLS settings.

   ```bash
   npm --prefix backend ci
   npm --prefix backend run seed
   ```

   The seed command creates only missing accounts. Use the simulator for demo data. If a previous deployment used publicly documented example passwords, rotate them before enabling access.

---

### Step B — Deploy Frontend on Vercel (`frontend/vercel.json`)
1. If your Render backend URL is different from `https://fraudlens-backend.onrender.com`, update the destination hostname in [frontend/vercel.json](file:///e:/FraudLens/frontend/vercel.json) and push to GitHub.
2. Go to **Vercel Dashboard** → **Add New…** → **Project** → import `saumya-0611/FraudLens`.
3. Set **Root Directory** to `frontend` (Framework Preset: **Vite**).
4. Add Environment Variable:
   - `VITE_USE_MOCKS` = `false`
5. Click **Deploy**.
6. Copy your Vercel URL (e.g. `https://fraudlens-xyz.vercel.app`) and set `WS_ALLOWED_ORIGINS=https://fraudlens-xyz.vercel.app` in Render `fraudlens-backend` → **Environment**.

---

### Step C — Keep Both Render Services Warm 24/7 with UptimeRobot
Add **two** HTTP(s) monitors in UptimeRobot (5-minute interval):
1. `https://<your-backend>.onrender.com/health` (expects `200 OK`, `{"status":"ok"}`)
2. `https://<your-ml-service>.onrender.com/health` (expects `200 OK`, `{"status":"ok","model_version":"v1"}`)

Both services stay awake with fast responses for live demos and teammates.

---

### Step D — Stream Live Transactions Into Your Cloud Deployment
From your laptop, run the simulator directly against your live Vercel or Render URL:
```powershell
$env:SERVICE_TOKEN = "<your-render-SERVICE_TOKEN>"
python simulator/replay.py --url "https://<your-app>.vercel.app/api/transactions" --tps 5 --limit 40 --fraud-boost 0.15
```
Open `https://<your-app>.vercel.app/home` (public landing page) or `https://<your-app>.vercel.app/` (sign in as `admin`, `analyst`, or `viewer`) — new transactions score live through `fraudlens-ml-service`, appear on `/dashboard` and `/transactions` with top-3 SHAP reasons, and raise live alerts on `/alerts`.

---

## 3. Want Full Kafka + PySpark + Native WSS on a Single VM Instead?
See [deploy/SINGLE_VM_CADDY.md](file:///e:/FraudLens/deploy/SINGLE_VM_CADDY.md) for the single-VM `docker-compose.prod.yml` + Caddy automatic HTTPS deployment.
