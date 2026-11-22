# FraudLens C1–C14 implementation status

Initial source audit on 23 November 2026 against `40ccb57`. The status below describes the starting point. See the linked evidence report for the Phase 2 verification outcome.

| Task and required behavior | Initial status | Source and existing coverage | Gap and planned verification | Environment |
|---|---|---|---|---|
| C1. Expiring HS256 JWT and secure cookie attributes | IMPLEMENTED BUT INCOMPLETELY TESTED | `utils/jwt.js`, `auth.routes.js`, `jwt.test.js`, `authRoutes.test.js` | Rerun regressions and assert Secure cookie behavior | Jest, HTTPS deployment check separately |
| C2. Current active user and role on each protected request | IMPLEMENTED BUT INCOMPLETELY TESTED | `authenticate.js`, `authorize.js`, `authMiddleware.test.js`, `protectedRoutes.test.js`, `alertSocket.test.js` | Rerun route and socket regressions and distinguish 401/403 from live deployment evidence | Jest with explicit DB fixtures, PostgreSQL for live check |
| C3. bcrypt login, lockout, rate limit, logout and current session | IMPLEMENTED BUT INCOMPLETELY TESTED | `auth.routes.js`, `authRoutes.test.js`, `authRateLimit.test.js` | Rerun regressions and verify SQL-backed lock/reset in a disposable database if available | Jest, optional Docker/PostgreSQL |
| C4. Explicit, idempotent bcrypt seed | IMPLEMENTED BUT INCOMPLETELY TESTED | `scripts/seed.js`, earlier disposable DB run, no committed tests | Cover missing configuration, existing users, successful bcrypt inserts and DB failures with `seed.test.js` | Jest, PostgreSQL for actual insert |
| C5. Six Zod request schemas | PARTIALLY IMPLEMENTED | `schemas.js`, `validate.js`, `protectedRoutes.test.js`, route tests | Cover malformed shapes, boundary values, protected fields and password limits. Validate audit query separately | Jest |
| C6. Serialized audit writes and hash verification | IMPLEMENTED BUT INCOMPLETELY TESTED | `auditLogger.js`, `verify_audit_chain.js`; prior isolated DB evidence | Cover hash order, genesis, chaining, rollback and CLI exit status. Review audit data and proxy IP handling | Jest; PostgreSQL for concurrent advisory-lock proof |
| C7. Configured service token or active ADMIN | IMPLEMENTED BUT INCOMPLETELY TESTED | `serviceAuth.js`, transaction and protected route tests | Explicitly reject blank configuration and assert service token/current role paths | Jest |
| C8. ADMIN users and audit log APIs | PARTIALLY IMPLEMENTED | `users.routes.js`, `audit.routes.js`, `protectedRoutes.test.js` | Validate audit filters, bounded paging and hash flag. Add CRUD and query tests | Jest; PostgreSQL for live SQL |
| C9. HTTP, request limits, SQL, cookies and account masking | PARTIALLY IMPLEMENTED | `app.js`, protected routes, `health.test.js`, socket and transaction tests | Disable framework header, bound API traffic while preserving service load, review CSRF and masking, add hardening tests | Jest; proxy/browser and load validation separate |
| C10. Internal auth, artifact integrity, secret policy and CI audits | PARTIALLY IMPLEMENTED | ML auth and digest code, Compose, existing ML tests and general CI | Remove known ML token fallback, verify model hashes with synthetic data, add policy and scanner workflow, attempt dependency audits | Python, registry access, CI runner |
| C11. Architecture-based STRIDE model | MISSING | `docs/CONTRACTS.md` and code references | Write and review `security/threat-model.md` | Source review |
| C12. Security verification evidence | PARTIALLY IMPLEMENTED | Existing Jest security suites, empty `security/attack_tests/` | Run defensive contract regressions and record measured results; identify unavailable deployment checks | Jest, optional Docker/PostgreSQL/browser |
| C13. Two-minute demo and safe recovery guide | MISSING | Team task and demo notes | Prepare demo guide using disposable credentials and fixtures; record rehearsal limits | Jest and optional demo stack |
| C14. Kubernetes manifests and policy validation | PARTIALLY IMPLEMENTED | `deploy/k8s/` has deployments, secrets and policies | Fix Postgres image/schema bootstrapping, reduce injected secrets, validate selectors/ports, document Minikube with policy-capable CNI | YAML parser, API server for kubectl validation, CNI for runtime enforcement |

Backend paths in the table are relative to `backend/src` unless otherwise indicated. Run the full backend suite with `npm.cmd --prefix backend test -- --silent`.

## Final verification

| Task | Final status | Evidence and remaining work |
|---|---|---|
| C1 | COMPLETE AND VERIFIED | JWT verifier regressions, Secure cookie configuration in Jest, HttpOnly/SameSite in Chrome. Production TLS remains a deployment check. |
| C2 | COMPLETE AND VERIFIED | PostgreSQL-backed REST and WebSocket session checks plus route-level role fixtures. |
| C3 | COMPLETE AND VERIFIED | Five concurrent failures locked the disposable account, expiry reset it, and login throttling, logout and `/me` passed. |
| C4 | COMPLETE AND VERIFIED | Real bcrypt seeding and idempotent reseeding, with unit checks for missing configuration and DB failure. |
| C5 | COMPLETE AND VERIFIED | Zod 4.6.7 schema boundaries, malformed shapes and protected fields covered. |
| C6 | COMPLETE AND VERIFIED | Exact hash order, mismatches and rollback covered in Jest. Real PostgreSQL verified 24 rows including 12 concurrent writes. Independent tail checkpoints are a remaining operational safeguard. |
| C7 | COMPLETE AND VERIFIED | Configured token, blank/invalid configuration and current-role authorization tested. Kafka delivery and service throughput are outside the auth check. |
| C8 | COMPLETE AND VERIFIED | Validated audit filters and hashes, user CRUD, self-protection and no sensitive user fields. PostgreSQL role/status changes affected live sessions. |
| C9 | IMPLEMENTED BUT INCOMPLETELY TESTED | Response, request limits, CSRF/WS browser checks and masking verified in unit tests or Chrome. Production proxy attribution, distributed quotas and ingestion throughput remain. |
| C10 | IMPLEMENTED BUT INCOMPLETELY TESTED | ML authentication, artifact integrity, local Python/npm audits, secret scan and Compose port review passed. Hosted workflow and production credential isolation remain. |
| C11 | COMPLETE AND VERIFIED | STRIDE model reviewed against source, manifests and observed boundaries. |
| C12 | PARTIALLY IMPLEMENTED | Defensive unit and live evidence covers the contract. Live exploit-reproduction cases remain outside the delivered harnesses. |
| C13 | PARTIALLY IMPLEMENTED | Two-minute guide and safe fixture commands checked. The demo uses an expired-token negative and synthetic audit inconsistency. |
| C14 | IMPLEMENTED BUT INCOMPLETELY TESTED | Four static checks, 15 dry-run resources and live Calico fixture checks passed. Full FraudLens workload rollout on Minikube remains. |

See the [measured evidence and exact commands](../docs/test-reports/security-report.md) and [viva guide](demo-guide.md).
