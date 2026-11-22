# TASKS: SHIVANSH (Cyber Security)

**Branch prefix:** `shivansh/`  **Presentation:** Fri 27 Nov 2026
**Read first:** `docs/CONTRACTS.md` (the law), `TEAMMATE.md` (workflow)

---

## CURRENT STATUS & WHAT IS LEFT FOR FINAL SUBMISSION (Updated 22 Nov 2026)

### Already Completed by Shivansh (On `origin/shivansh/auth` @ `f5d6f81`)
- **C1 (`backend/src/utils/jwt.js` & `backend/src/tests/jwt.test.js`)**:
  - `signToken(user)` and `verifyRequestCookie(req)` with `HS256` algorithm pinning, duplicate `fl_token` cookie rejection, and 32+ character `JWT_SECRET` validation.
- **C2 (`backend/src/middleware/authenticate.js`, `authorize.js` & `backend/src/tests/authMiddleware.test.js`)**:
  - `authenticate` verifies cookie JWT AND queries PostgreSQL `users` table to ensure the user still exists and has `status === 'ACTIVE'`.
  - `authorize(...roles)` returns `403 FORBIDDEN` and logs an `ACCESS_DENIED` event via `auditLogger`.

### What Is LEFT for Shivansh Before Final Submission (CRITICAL PATH)
Because `C2` (`authenticate.js`) checks the real `fl_token` cookie and queries the `users` table in PostgreSQL, **nobody can log in once `shivansh/auth` is merged until `C3` (`auth.routes.js`) and `C4` (`seed.js`) are implemented!** Please complete these remaining tasks in order:

1. **C3 — Auth Routes (`backend/src/routes/auth.routes.js`)**:
   - `POST /api/auth/login`: Validate `{username, password}`, look up user in `users`, verify with `bcryptjs.compare` (run a dummy bcrypt compare when username is not found to prevent timing enumeration), return generic `401 INVALID_CREDENTIALS` on failure.
   - **Account Lockout**: Increment `failed_attempts` on failure; after 5 failures set `locked_until = now() + interval '15 minutes'`; reject locked accounts with generic `401 INVALID_CREDENTIALS`; reset `failed_attempts = 0, locked_until = NULL` on success.
   - Set `fl_token` cookie (`httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 2 * 3600 * 1000`), write `LOGIN_SUCCESS` / `LOGIN_FAILURE` audit log, return `200 {username, role, expires_in: 7200}`.
   - `POST /api/auth/logout`: Clear `fl_token` cookie, audit `LOGOUT`, return `204`.
   - `GET /api/auth/me`: Protected by `authenticate`, return `200 {username: req.user.username, role: req.user.role}`.
   - Add `express-rate-limit` on `/login` (10 req/min/IP -> `429 RATE_LIMITED`).
2. **C4 — User Seed Script (`backend/scripts/seed.js`)**:
   - Implement `npm run seed` in `backend/package.json` to insert `admin` (`ADMIN`), `analyst` (`ANALYST`), and `viewer` (`VIEWER`) into `users` with `bcryptjs.hash(password, 10)` from `SEED_ADMIN_PASSWORD`, `SEED_ANALYST_PASSWORD`, `SEED_VIEWER_PASSWORD` (`ON CONFLICT (username) DO NOTHING`).
3. **C5 — Input Validation (`backend/src/validation/schemas.js` & `backend/src/middleware/validate.js`)**:
   - Replace the `null` stubs in `schemas.js` with `zod` schemas (`createTransaction`, `alertPatch`, `listQuery`, `login`, `createUser`, `patchUser`) and implement `validate(schema)` returning `400 VALIDATION_ERROR`.
4. **C6 — Tamper-Evident Hash-Chained Audit Logger (`backend/src/audit/auditLogger.js` & `backend/scripts/verify_audit_chain.js`)**:
   - Inside a DB transaction holding `SELECT pg_advisory_xact_lock(42)`, fetch the previous row's `entry_hash` (`'0'.repeat(64)` for the first row), compute `entry_hash = SHA256(prev_hash + event_time_iso + username + action + entity + entity_id + JSON.stringify(details))`, and insert into `audit_logs` (catching errors so audit failures never crash a request).
   - Implement `backend/scripts/verify_audit_chain.js` (`npm run audit:verify`) to walk `audit_logs` in `id ASC` order and detect any modified row.
5. **C7 — Service Token Middleware (`backend/src/middleware/serviceAuth.js`)**:
   - Check header `X-Service-Token` against `process.env.SERVICE_TOKEN` using `crypto.timingSafeEqual`; if absent/invalid, fall through to `authenticate` + `authorize('ADMIN')`.
6. **C8 — Admin Users & Audit Routes (`backend/src/routes/users.routes.js` & `audit.routes.js`)**:
   - `GET /api/users`, `POST /api/users` (`201`, `409 CONFLICT` on duplicate username, audit `USER_CREATED`), `PATCH /api/users/:id` (prevent admin from disabling/demoting themselves, audit `USER_UPDATED`).
   - `GET /api/audit-logs` (paginated, filter by `action` and `username`, omit `prev_hash`/`entry_hash` unless `?include_hash=true`).
7. **C9–C14 — Security Docs, Attack Tests, CI Scan & Kubernetes Review**:
   - `security/secrets-policy.md` and `security/threat-model.md` (STRIDE table).
   - `.github/workflows/security-scan.yml` (`npm audit` + `pip-audit`).
   - `security/attack_tests/` (11 automated attack test cases) + `docs/test-reports/security-report.md`.
   - Review the Kubernetes & Zero-Trust `NetworkPolicy` manifests in `deploy/k8s/*.yaml` (`C14`).

---

## Starter prompt for your AI helper (paste this first)

> You are my pair-programmer on the FraudLens capstone (presentation 27 Nov 2026). Read `docs/CONTRACTS.md` and this task file completely before writing code.
> I own ONLY these files: `backend/src/middleware/`, `backend/src/validation/`, `backend/src/audit/`, `backend/src/utils/jwt.js`, `backend/src/utils/mask.js` (review only; already implemented),
> `backend/scripts/seed.js`, `backend/scripts/verify_audit_chain.js`, `backend/src/routes/auth.routes.js`, `users.routes.js`, `audit.routes.js`, `security/`, `deploy/k8s/`, and the security step in `.github/workflows/`.
> Do not edit other files. Never change CONTRACTS.md; if something looks wrong, stop and tell me.
> Backend is Node.js + Express (CommonJS). Use `bcryptjs` (pure-JS bcrypt), `jsonwebtoken`, `zod`, `helmet`, `express-rate-limit`, `cookie-parser`, `pg`.
> The skeleton contains STUB versions of my modules with the final export names. I replace the implementation and NEVER change the export names or signatures (see CONTRACTS section 9), because Riya's code already calls them.
> Keep the code simple and commented because I must explain it in a viva. Write a unit test for each task. After each task, give me the run command, the test, and a git commit message.

## Your scope in one sentence
Make the platform safe: authentication, authorization, input validation, masking, audit trail, service-to-service secrets, and then **prove** it with attack tests and a report.

Mapped SRS items: FR-01 (login), FR-02 (RBAC), FR-12 (audit), FR-13 (user management), data masking, Zero Trust (verify every request), secrets handling.

---

## Tasks

**C1. JWT and cookies (Mon 16 Nov).** `utils/jwt.js`:
`signToken(user)` (payload `{sub, username, role}`, expiry from `JWT_EXPIRES_IN`, secret from `JWT_SECRET`, algorithm fixed to HS256 and **verified with the algorithm pinned** so "alg: none" tokens are rejected), `verifyRequestCookie(req)` (parse the `fl_token` cookie from `req.headers.cookie`, so it also works for the WebSocket upgrade request; returns `{id, username, role}` or `null`).
Cookie options: `httpOnly: true`, `sameSite: "lax"`, `secure: process.env.COOKIE_SECURE === "true"`, `maxAge` matching the token. Write unit tests with a valid token, an expired token, a tampered token, and an `alg:none` token.

**C2. `authenticate` and `authorize` (Mon 16 Nov).** `middleware/authenticate.js` sets `req.user` or answers 401 `UNAUTHENTICATED`. It must also re-check that the user still exists and is `ACTIVE` (a disabled user must lose access even with an unexpired token; cache for a few seconds if needed). `middleware/authorize.js` returns 403 `FORBIDDEN` with a generic message and writes an `ACCESS_DENIED` audit event. (Zero Trust: every protected request goes through both.)

**C3. Login, logout, me (Tue 17 Nov).** `routes/auth.routes.js`:
- `POST /api/auth/login`: validate body, look up user, `bcryptjs.compare`; on failure return the same `INVALID_CREDENTIALS` 401 whether the user exists or not (also do a dummy compare for unknown users to keep timing similar). Lockout: after 5 failures set `locked_until = now + 15 min` (locked users also get the generic 401). Reset the counter on success. Audit `LOGIN_SUCCESS` / `LOGIN_FAILURE` (never log the password).
- `POST /api/auth/logout` (clears cookie, audit), `GET /api/auth/me`.
- Rate limit login: 10 requests per minute per IP -> 429 `RATE_LIMITED`.

**C4. Seed script (Tue 17 Nov).** `backend/scripts/seed.js` (`npm run seed`): create `admin`, `analyst`, `viewer` users with passwords from `SEED_*` env vars (bcrypt cost 10-12), skip if they already exist. Never print passwords.

**C5. Validation (Tue 17 - Wed 18 Nov, Riya needs it by Wed).** `validation/schemas.js` with zod schemas: `createTransaction` (required fields and types from CONTRACTS section 4, `amount` 0..1e7, `category` max 50 chars, ISO `tx_time`, lat/lon ranges, reject unknown extra fields), `alertPatch` (state enum; resolution required iff RESOLVED), `listQuery` (page >= 1, page_size 1..100, risk enum, dates), `login`, `createUser` (username 3-50 chars `[a-zA-Z0-9_.-]`, password min 10 chars, role enum), `patchUser`. `middleware/validate.js` returns 400 `VALIDATION_ERROR` with field messages and never echoes secrets back.

**C6. Audit logger with hash chain (Wed 18 Nov).** `audit/auditLogger.js`: `audit({req, userId, username, action, entity, entityId, details})` inserts one row in a transaction holding `pg_advisory_xact_lock(42)`, reads the latest `entry_hash` as `prev_hash` (64 zeros for the first row), computes `entry_hash` per CONTRACTS section 3, stores IP from `req`. It must never throw into the request path (catch and `console.error`). Add `npm run audit:verify` (`backend/scripts/verify_audit_chain.js`) that recomputes the chain and reports the first broken row. Test: edit a row manually in the DB and show the verifier detects it (great demo).

**C7. Service token (Wed 18 Nov).** `middleware/serviceAuth.js`: accept `X-Service-Token` equal to `SERVICE_TOKEN` using `crypto.timingSafeEqual`; otherwise fall through to `authenticate` + `authorize("ADMIN")`.

**C8. Users and audit routes (Thu 19 Nov).** `routes/users.routes.js` (ADMIN: list, create, patch role/status/password; hash passwords; 409 on duplicate username; audit `USER_CREATED`/`USER_UPDATED`; an admin cannot disable or demote themselves) and `routes/audit.routes.js` (ADMIN: filters `action`, `username`, paging; never returns `prev_hash`/`entry_hash` unless `?include_hash=true`).

**C9. Hardening (Fri 20 Nov).** Coordinate with Riya (she owns `server.js`; send her the exact lines): `helmet()`, `app.disable("x-powered-by")`, JSON body limit (for example 100 kb), global rate limit (for example 300 requests per minute per IP) and a stricter limit on `POST /api/transactions` (sized so the 100 TPS load test still passes for the service token; exempt valid service-token traffic or set a high limit), request id on every response/error. Confirm all SQL in the backend is parameterised (review Riya's PRs for string-built SQL).

**C10. Service-to-service security (Fri 20 - Sat 21 Nov).**
- Review the lead's `ml-service/app/security.py` (constant-time token check, 401 otherwise) and confirm only `frontend` and `backend` publish ports in `docker-compose.yml`.
- Model file integrity: the lead stores SHA-256 for each model artifact and verifies it at load; review it and test that a modified model file is refused.
- Write `security/secrets-policy.md`: where secrets live (`.env`, never in Git), how to rotate, what is in `.env.example`.
- Add a CI security step (`.github/workflows/security-scan.yml`): `npm audit --audit-level=high` for the backend and frontend, `pip-audit` for the ML service. Optional if time: `gitleaks` on the repo, `trivy` on built images.

**C11. Threat model (Sat 21 Nov).** `security/threat-model.md`: one diagram or list of assets, trust boundaries (browser / backend / internal network / data), and a table of threats by STRIDE category with the mitigation in this project and the requirement it maps to. Keep it to about 2 pages.

**C12. Attack tests with evidence (Sun 22 - Tue 24 Nov).** `security/attack_tests/` scripts (Node, Python or curl) run against the running stack. Minimum cases:
1. Brute force: 6 wrong passwords -> account locked / 429; same generic error for unknown user.
2. Token tampering: modify the JWT payload role to ADMIN -> 401.
3. `alg: none` token -> 401. Expired token -> 401.
4. Broken access control: VIEWER calls `PATCH /api/alerts/:id`, `GET /api/users`, `POST /api/models/retrain` -> 403; ANALYST calls admin routes -> 403.
5. Unauthenticated calls to every protected route -> 401.
6. Ingestion without or with a wrong service token -> 401/403.
7. SQL injection attempts in `q`, `risk`, `from` query params and in login fields -> 400 or no effect.
8. Oversized body and malformed JSON -> 400/413, no stack trace in the response.
9. Masking: scan responses of all list/detail endpoints for the raw `account_ref` -> must never appear.
10. Audit tamper: modify an audit row -> `audit:verify` reports it.
11. WebSocket without cookie -> rejected.
Record results (PASS/FAIL, request, response status) in `docs/test-reports/security-report.md`, plus screenshots. **Fix FAILs with the owners** and re-run. Honest "found and fixed" findings look better than "everything passed".

**C13. Presentation (Wed 25 - Thu 26 Nov).** Prepare a 2-minute live security demo: failed login lockout, tampered token rejected, VIEWER blocked from an admin API, audit chain verifier catching a modified row.

**C14. Kubernetes & Zero-Trust Network Manifests (Tue 24 - Wed 25 Nov, offloaded from Lead T4.3).** Create `deploy/k8s/*.yaml` to run the FraudLens images on Minikube/Kubernetes:
- `deploy/k8s/secrets.example.yaml`: Kubernetes `Secret` template mirroring `.env.example` (`JWT_SECRET`, `SERVICE_TOKEN`, `INTERNAL_ML_TOKEN`, `POSTGRES_PASSWORD`, etc. — never commit real secrets).
- `deploy/k8s/deployments-services.yaml`: `Deployment` + `Service` manifests for `postgres`, `kafka`, `ml-service`, `streaming`, `backend`, and `frontend` (only `frontend` [5173] and `backend` [5000] exposed as `NodePort`/`LoadBalancer`; all others `ClusterIP` only).
- `deploy/k8s/network-policy.yaml`: Zero-Trust Kubernetes `NetworkPolicy` restricting ingress to `ml-service:8000` (only from `backend` and `streaming` pods) and `postgres:5432` (only from `backend`, `streaming`, and `ml-service` pods).
- Add a brief `deploy/k8s/README.md` with `kubectl apply -f deploy/k8s/` and `kubectl apply --dry-run=client` verification commands. (If not deployed live on Minikube during the presentation, present honestly as "Kubernetes & Zero-Trust manifests prepared".)

---

## Order of days
Mon 16: C1, C2. Tue 17: C3, C4, start C5. Wed 18: C5 (to Riya), C6, C7 (**swap stubs on your branch; M1**). Thu 19: C8. Fri 20: C9. Fri-Sat: C10, C11. Sun-Tue: C12, C14. Wed-Thu: C13.

## Acceptance checklist
- [ ] All stubs replaced; export names and signatures unchanged
- [ ] Login lockout, generic errors, httpOnly cookie, pinned JWT algorithm
- [ ] RBAC matrix from CONTRACTS section 2 enforced and tested
- [ ] Hash-chained audit log + verifier; writes never crash a request
- [ ] No API returns `account_ref`; no secrets in Git
- [ ] `security/threat-model.md`, `docs/test-reports/security-report.md` with evidence, CI security scan
- [ ] `deploy/k8s/*.yaml` (Deployments, Services, Secrets example, Zero-Trust NetworkPolicy) prepared and syntax-validated
- [ ] PR checklist from `TEAMMATE.md` completed for every PR
