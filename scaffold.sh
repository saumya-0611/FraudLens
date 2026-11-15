#!/usr/bin/env bash
# FraudLens scaffold. Run from the repo root (the fraudLens folder):  bash scaffold.sh
# Safe to re-run: it NEVER overwrites an existing file. Windows: run in Git Bash.
set -e

# ---------- folders (each gets a .gitkeep so Git tracks empty folders) ----------
dirs=(
  docs/test-reports tasks
  frontend/src/pages/admin frontend/src/components frontend/src/context frontend/src/hooks
  frontend/src/services frontend/src/mocks frontend/src/routes
  backend/scripts backend/src/config backend/src/routes backend/src/controllers
  backend/src/kafka backend/src/websocket backend/src/middleware backend/src/validation
  backend/src/audit backend/src/utils backend/src/tests
  ml-service/app/registry ml-service/app/retrain ml-service/app/drift ml-service/training
  ml-service/model_store ml-service/tests
  streaming/jobs
  shared/tests
  data-science/datasets data-science/notebooks data-science/drift data-science/evaluation
  database simulator
  security/attack_tests
  deploy/k8s
  .github/workflows
)
for d in "${dirs[@]}"; do
  mkdir -p "$d"
  [ -e "$d/.gitkeep" ] || touch "$d/.gitkeep"
done

# ---------- helper: create a file only if it does not exist ----------
write_if_missing() {
  if [ -e "$1" ]; then
    echo "skip    $1 (already exists)"
    cat > /dev/null
  else
    mkdir -p "$(dirname "$1")"
    cat > "$1"
    echo "created $1"
  fi
}

# ---------- .gitignore ----------
write_if_missing .gitignore <<'EOF'
# secrets
.env
*.pem
# node
node_modules/
dist/
build/
coverage/
# python
__pycache__/
*.pyc
.venv/
venv/
.ipynb_checkpoints/
# data and models (share via Kaggle/Drive, never Git)
data-science/datasets/*.csv
ml-service/model_store/*
!ml-service/model_store/.gitkeep
# misc
*.log
.DS_Store
pgdata/
spark-checkpoints/
EOF

# ---------- .env.example ----------
write_if_missing .env.example <<'EOF'
POSTGRES_USER=fraudlens
POSTGRES_PASSWORD=change_me
POSTGRES_DB=fraudlens
DATABASE_URL=postgresql://fraudlens:change_me@postgres:5432/fraudlens
KAFKA_BROKERS=kafka:9092
ML_SERVICE_URL=http://ml-service:8000
JWT_SECRET=change_me_long_random
JWT_EXPIRES_IN=2h
COOKIE_SECURE=false
SERVICE_TOKEN=change_me_service_token
INTERNAL_ML_TOKEN=change_me_internal_token
SEED_ADMIN_PASSWORD=change_me
SEED_ANALYST_PASSWORD=change_me
SEED_VIEWER_PASSWORD=change_me
VITE_PROXY_TARGET=http://backend:5000
EOF

# ---------- README ----------
write_if_missing README.md <<'EOF'
# FraudLens: Real-Time Financial Fraud Detection Platform
Capstone II, Team 34. Start with `TEAMMATE.md`, then `docs/CONTRACTS.md`, then your file in `tasks/`.

Quick start (once the lead has pushed docker-compose.yml):
    cp .env.example .env
    docker compose up --build
Frontend: http://localhost:5173   Backend: http://localhost:5000/health
EOF

# ---------- shared defaults ----------
write_if_missing shared/thresholds.json <<'EOF'
{ "high": 0.80, "low": 0.40, "notes": "PLACEHOLDER. Riya tunes these so HIGH_RISK is about 1-2% of test transactions." }
EOF

# ---------- backend STUBS (Shivansh replaces the implementation; export names must NOT change) ----------
write_if_missing backend/src/middleware/authenticate.js <<'EOF'
// STUB. Shivansh replaces with real cookie-JWT verification. Keep the export.
module.exports = function authenticate(req, res, next) {
  req.user = { id: 0, username: 'stub-admin', role: 'ADMIN' };
  next();
};
EOF

write_if_missing backend/src/middleware/authorize.js <<'EOF'
// STUB. Shivansh replaces: 403 when req.user.role is not in roles. Keep the export.
module.exports = (...roles) => (req, res, next) => next();
EOF

write_if_missing backend/src/middleware/validate.js <<'EOF'
// STUB. Shivansh replaces with zod validation of { body, query, params }. Keep the export.
module.exports = (schema) => (req, res, next) => next();
EOF

write_if_missing backend/src/middleware/serviceAuth.js <<'EOF'
// STUB. Shivansh replaces: valid X-Service-Token OR an ADMIN session. Keep the export.
module.exports = (req, res, next) => next();
EOF

write_if_missing backend/src/validation/schemas.js <<'EOF'
// STUB. Shivansh replaces each null with a zod schema. Keep the names.
module.exports = {
  createTransaction: null,
  alertPatch: null,
  listQuery: null,
  login: null,
  createUser: null,
  patchUser: null,
};
EOF

write_if_missing backend/src/utils/mask.js <<'EOF'
// Masking rule (CONTRACTS section 2): never return the full account_ref.
function maskAccount(ref) {
  return 'XXXX-' + String(ref || '').slice(-4);
}
function maskTransaction(row) {
  const { account_ref, ...rest } = row;
  return { ...rest, account_masked: maskAccount(account_ref) };
}
module.exports = { maskAccount, maskTransaction };
EOF

write_if_missing backend/src/utils/jwt.js <<'EOF'
// STUB. Shivansh replaces. verifyRequestCookie works on any request object, including the WebSocket upgrade request.
function signToken(user) { return 'stub-token'; }
function verifyRequestCookie(req) { return { id: 0, username: 'stub-admin', role: 'ADMIN' }; }
module.exports = { signToken, verifyRequestCookie };
EOF

write_if_missing backend/src/audit/auditLogger.js <<'EOF'
// STUB. Shivansh replaces with the hash-chained audit writer (CONTRACTS section 3). Keep the export.
async function audit(entry) {
  console.log('[AUDIT-STUB]', entry && entry.action);
}
module.exports = { audit };
EOF

for r in auth users audit; do
  write_if_missing "backend/src/routes/$r.routes.js" <<EOF
// STUB router for /api/$r (Shivansh implements). Mounted by server.js from day 1.
const router = require('express').Router();
module.exports = router;
EOF
done

echo ""
echo "Scaffold done. Next: git add . && git commit -m \"chore: project skeleton\" && git push"

