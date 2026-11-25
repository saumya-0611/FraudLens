# FraudLens Single-VM Production Deployment Guide (Docker Compose + Caddy HTTPS)

Deploy the entire 6-service FraudLens stack (`PostgreSQL 16`, `Apache Kafka KRaft`, `PySpark Streaming`, `FastAPI XGBoost + Isolation Forest`, `Node.js/Express API + WebSockets`, and `React SPA`) onto a single Linux VM behind **Caddy** with automatic Let's Encrypt HTTPS.

Because Caddy serves the compiled frontend and proxies `/api/*`, `/ws/*`, `/health`, `/ready`, and `/api-docs*` on **one single HTTPS origin**, `httpOnly` JWT cookies, same-origin CSRF checks, live WebSocket alert toasts (`wss://`), and optional OIDC social sign-in all work out of the box with zero CORS workarounds.

---

## 1. Recommended VM Specs

- **OS:** Ubuntu 22.04 LTS or 24.04 LTS
- **RAM:** **4 GB** recommended for full PySpark (`STREAM_ENGINE=spark`), or **2 GB** with `STREAM_ENGINE=fallback` (Python Kafka consumer executing the exact same `pipeline.process_batch` logic)
- **Free/Low-Cost Options:** Oracle Cloud Always-Free ARM (up to 4 OCPU / 24 GB RAM), Azure for Students (\$100 credit), AWS EC2 `t3.medium`, DigitalOcean / Hetzner 4 GB Droplet
- **Firewall / Security Group Ports:** Allow inbound **TCP `22` (SSH)**, **`80` (HTTP/ACME)**, and **`443` (HTTPS)** only. Do **not** open `5000`, `5432`, `8000`, or `9092`.

---

## 2. Provision the VM (Ubuntu)

```bash
# 1. Install Docker Engine + Compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# 2. Configure firewall
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# 3. Clone repository
git clone https://github.com/saumya-0611/FraudLens.git
cd FraudLens
```

---

## 3. Configure `.env.prod` (Including Free HTTPS Without Buying a Domain)

If you own a domain, point an `A` record (e.g. `fraudlens.yourdomain.com`) to your VM's public IP.
If you **do not** own a domain, use **`<VM_PUBLIC_IP>.sslip.io`** (for example, `203.0.113.10.sslip.io`) — `sslip.io` automatically resolves to your VM IP, allowing Caddy to issue a **real, trusted Let's Encrypt HTTPS certificate for free**.

```bash
cp .env.prod.example .env.prod
```

Generate strong secrets and update `.env.prod`:

```bash
# Generate 3 unique secrets to paste into .env.prod
openssl rand -hex 32   # -> JWT_SECRET
openssl rand -hex 24   # -> SERVICE_TOKEN
openssl rand -hex 24   # -> INTERNAL_ML_TOKEN
```

Edit `.env.prod` (`nano .env.prod`) and set:
- `SITE_ADDRESS=<your-domain-or-IP.sslip.io>`
- `PUBLIC_ORIGIN=https://<your-domain-or-IP.sslip.io>`
- `ACME_EMAIL=<your-email>`
- `COOKIE_SECURE=true`
- `POSTGRES_PASSWORD` (and matching `DATABASE_URL`)
- `JWT_SECRET`, `SERVICE_TOKEN`, `INTERNAL_ML_TOKEN`
- `SEED_ADMIN_PASSWORD`, `SEED_ANALYST_PASSWORD`, `SEED_VIEWER_PASSWORD`
- `STREAM_ENGINE=spark` (on 4+ GB RAM) or `STREAM_ENGINE=fallback` (on 2 GB RAM)

> **Security Note:** `.env.prod` is git-ignored. Never reuse placeholder `change_me*` values — `backend` and `ml-service` fail closed if weak secrets are configured.

---

## 4. Launch Production Stack

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up --build -d
```

Watch startup and TLS certificate issuance:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f edge backend ml-service
```

Within ~30–60 seconds:
- Caddy obtains a Let's Encrypt certificate automatically.
- `ml-service` bootstraps and SHA-256-verifies `v1` (XGBoost + Isolation Forest).
- `backend` applies the schema, connects to PostgreSQL and Kafka, and becomes ready after verifying the ML connection.

Provision initial accounts explicitly once the backend is ready:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend npm run seed
```

The seed command creates only missing accounts.

---

## 5. Verify Public Access & Stream Live Transactions

1. **Public Health Check:**
   ```bash
   curl -fsS https://<SITE_ADDRESS>/ready
   # Expected: {"status":"ok"}
   ```
2. **Open in any browser worldwide:**
   - Landing page: `https://<SITE_ADDRESS>/home`
   - Console login: `https://<SITE_ADDRESS>/`
   - Swagger API docs: `https://<SITE_ADDRESS>/api-docs`
3. **Stream demo transactions into the live VM (from your laptop or the VM):**
   ```bash
   export SERVICE_TOKEN="<your-prod-SERVICE_TOKEN>"
   python simulator/replay.py \
     --url "https://<SITE_ADDRESS>/api/transactions" \
     --tps 5 --limit 50 --fraud-boost 0.15
   ```
4. **Trigger concept drift demo:**
   ```bash
   python simulator/replay.py \
     --url "https://<SITE_ADDRESS>/api/transactions" \
     --tps 10 --limit 40 --drift-mode
   ```
   Then log in as `admin`, open **Models**, click **Run drift check** → **Start retraining** → **Activate** the validated `v2` model with zero downtime.

---

## 6. Routine Operations

```bash
# Pull latest code and redeploy with minimal downtime
git pull origin main
docker compose -f docker-compose.prod.yml --env-file .env.prod up --build -d

# Backup PostgreSQL database
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U fraudlens fraudlens > fraudlens_backup_$(date +%F).sql
```
