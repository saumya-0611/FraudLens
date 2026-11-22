# FraudLens Cloud Deployment Guide (Vercel + Render + Nginx HTTPS)

Adaptable from the team's BhashaFlow cloud architecture (`Vercel Frontend -> Render Backend -> Render ML Service -> Managed PostgreSQL + Upstash/Confluent Kafka`):

---

## 1. Cloud Architecture Overview

```text
Vercel Frontend (React + Vite SPA, HTTPS)
  ├── /api/* rewrite ──► Render Backend (Node.js / Express :5000, HTTPS)
  │                        ├── Internal Private Network ──► Render ML Service (FastAPI :8000)
  │                        ├── Kafka SASL/TLS ────────────► Confluent Cloud / Redpanda Serverless
  │                        └── PostgreSQL SSL ────────────► Render Managed PostgreSQL 16
  └── WebSocket (/ws/alerts) ─────────────────────────────► Render Backend WebSocket Server
```

By using [deploy/vercel.json](file:///e:/FraudLens/deploy/vercel.json) to proxy `/api/:path*` to `https://fraudlens-backend.onrender.com/api/:path*`, the browser sees a **single HTTPS origin**, so `httpOnly` JWT cookies (`fl_token`) and relative `/api/...` paths in `frontend/src/services/api.js` work identically in local Docker, Nginx HTTPS, and Vercel/Render cloud deployments.

---

## 2. Step-by-Step Cloud Deployment

### A. Backend, ML Service & PostgreSQL on Render ([render.yaml](file:///e:/FraudLens/render.yaml))
1. In the Render Dashboard, click **New -> Blueprint** and connect `https://github.com/saumya-0611/FraudLens`.
2. Render automatically reads [render.yaml](file:///e:/FraudLens/render.yaml) and provisions:
   - `fraudlens-db` (PostgreSQL 16 — run `psql $DATABASE_URL -f database/init.sql` once).
   - `fraudlens-ml-service` (Internal FastAPI service with `GET /health` & `HEAD /health`).
   - `fraudlens-backend` (Public Express API with `GET /health` for UptimeRobot 5-minute keep-alive pings).
   - `fraudlens-streaming` (PySpark / Kafka streaming worker).

### B. Frontend on Vercel ([deploy/vercel.json](file:///e:/FraudLens/deploy/vercel.json))
1. Import `saumya-0611/FraudLens` into Vercel with **Root Directory** = `frontend`.
2. Copy `deploy/vercel.json` into `frontend/vercel.json` (updating `fraudlens-backend.onrender.com` to your Render backend hostname).
3. Deploy — Vercel provides automatic **HTTPS (TLS 1.3)** and edge CDN caching.
