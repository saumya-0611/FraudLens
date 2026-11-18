# FraudLens DevOps Guide: Docker, Jenkins & Ngrok (`deploy/`)

This folder adapts our team's **BhashaFlow** DevOps workflow (Docker Compose + Jenkins Pre-Flight Gatekeeper + Ngrok tunnels) to the **FraudLens** architecture defined in `docs/CONTRACTS.md`.

---

## 1. How FraudLens Differs from BhashaFlow (and What Stays the Same)

| Aspect | BhashaFlow (Old Project) | FraudLens (Current Capstone) |
|---|---|---|
| **Frontend -> Backend** | `VITE_BACKEND_URL` baked at build time + CORS whitelist | Relative paths (`/api/...`, `/ws/alerts`) via **Vite proxy** (`VITE_PROXY_TARGET=http://backend:5000`). Same origin = zero CORS issues, `httpOnly` cookie (`fl_token`) works automatically |
| **AI / ML Engine** | FastAPI on Render (`AI_ENGINE_URL`, `GET /` & `HEAD /`) | FastAPI `ml-service:8000` (internal Docker network only, `GET /health` & `HEAD /health`, protected by `X-Internal-Token`) |
| **Streaming & Messaging** | Direct REST calls | **Kafka KRaft** (`transactions-raw`, `transactions-dlq`, `fraud-alerts`) + **PySpark Structured Streaming** (`streaming`) |
| **Database** | MongoDB Atlas | **PostgreSQL 16** initialized automatically from `database/init.sql` |
| **Jenkins Role** | Pre-flight Docker gatekeeper on offset ports (`4000`, `6000`, `9000`) | Pre-flight Docker gatekeeper (`deploy/Jenkinsfile`) on offset ports (`6173`, `6000`) with project namespace `fraudlens_ci` |
| **Ngrok Role** | Local tunnel for demo/webhook | Single tunnel on port `5173` exposes the entire app (because Vite proxies `/api` and `/ws/alerts` to `backend:5000`), or port `8080` for GitHub -> Jenkins webhooks |

---

## 2. Daily Docker Commands

```bash
# First time only: create local .env from template
cp .env.example .env

# Build and start the core stack (Postgres, Kafka + Topics, ML Service, Backend, Streaming)
docker compose up --build -d postgres kafka kafka-init ml-service backend streaming

# Once Amrita merges frontend/Dockerfile, bring up everything:
docker compose up --build

# Check container health and logs
docker compose ps
docker compose logs -f ml-service streaming backend
```

Always pass `--build` after pulling new code, changing `requirements.txt` / `package.json`, or modifying `.env`.

---

## 3. Jenkins Pre-Flight Gatekeeper (`deploy/Jenkinsfile`)

Just like in BhashaFlow, Jenkins runs on offset ports so a CI build never clashes with your active development containers:

| Service | Dev Port | Jenkins Pre-Flight Port |
|---|---|---|
| Frontend | `http://localhost:5173` | `http://localhost:6173` (`FRONTEND_HOST_PORT=6173`) |
| Backend | `http://localhost:5000` | `http://localhost:6000` (`BACKEND_HOST_PORT=6000`) |
| ML Service | Internal `:8000` | Internal `:8000` (tested via `docker compose exec`) |

To configure Jenkins:
1. Create a **Pipeline** job in Jenkins pointing to this GitHub repository.
2. Set **Script Path** to `deploy/Jenkinsfile`.
3. Enable **GitHub hook trigger for GITScm polling**.

---

## 4. Ngrok Setup (GitHub Webhooks & Live Demo Sharing)

### A. Triggering Local Jenkins from GitHub Push
1. Start Ngrok on your Jenkins port (default `8080`):
   ```bash
   ngrok http 8080
   ```
2. Copy the HTTPS forwarding URL (e.g., `https://xxxx.ngrok-free.app`).
3. In GitHub -> **Settings -> Webhooks -> Add webhook**:
   - **Payload URL**: `https://xxxx.ngrok-free.app/github-webhook/`
   - **Content type**: `application/json`
   - **Events**: `Just the push event` and `Pull requests`.

### B. Sharing the Live FraudLens Demo Externally
Because FraudLens uses the Vite proxy for `/api` and `/ws/alerts`, you only need **one** Ngrok tunnel on port `5173`:
```bash
ngrok http 5173
```
Anyone opening the Ngrok HTTPS URL gets the React UI, REST API calls, `httpOnly` JWT cookies, and real-time WebSocket fraud alert toasts through the same origin.
