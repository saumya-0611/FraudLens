# Riya

Backend and data science. Owns the transaction API, PostgreSQL read/write behavior in the backend, and the interpretation of transaction features and risk thresholds.

## P0

### R1

- [x] **Verify accepted, pending, and scored transaction readback** · Passed using the disposable PostgreSQL lifecycle check on 25 November 2026.
- **Goal** — Keep `POST /api/transactions` as a `202 ACCEPTED` acknowledgement. Make the same ID readable as `PENDING` with a null score when it is stored without a result, then return the persisted result and masked account after scoring. Keep the unknown-ID `404` and existing input validation.
- **Files** — `backend/src/routes/transactions.routes.js`, `backend/src/validation/schemas.js` if needed, and `backend/src/tests/transactions.test.js`.
- **Dependencies** — Lead [L1](lead.md#l1) supplies the durable unscored transaction. Shivansh [S1](shivansh.md#s1) verifies the authorization and masking boundaries in parallel. Amrita [A1](amrita.md#a1) consumes this API behavior.
- **Acceptance** — Run `npm.cmd --prefix backend test -- --runTestsByPath src/tests/transactions.test.js`. Assert accepted POST returns the ID and no probability, invalid input produces `400` without publishing, pending GET returns a null score and no score-derived alert, and scored GET after API re-read returns persisted values with `account_masked`. Assert raw account references are absent and unknown IDs return `404`.
- **Evidence** — Contract §§2 and 8 specify masking, `202`, and `PENDING`. The route already uses a left join and pending fallback, and the current route tests mock the database. [Contract](../docs/CONTRACTS.md#L319) · [Readback route](../backend/src/routes/transactions.routes.js#L137) · [Transaction tests](../backend/src/tests/transactions.test.js#L16) · [Baseline](STATUS.md#offline-checks)

### R2

- [x] **Keep retries consistent with the persisted decision** · Passed scorer regressions and concurrent intake, restart recovery, and replay checks on 25 November 2026.
- **Goal** — Make an accepted transaction ID safe to retry after an outage and after success. Keep the first committed score authoritative. Create an alert only for a persisted high-risk result and publish the alert notification only for a newly created alert. Coordinate the write transaction with Lead.
- **Files** — `backend/src/pipeline/inlineScorer.js`, `backend/src/config/db.js` if a transaction helper is needed, and planned `backend/src/tests/inlineScorer.test.js`. Check `database/init.sql` constraints before proposing a schema change.
- **Dependencies** — Lead [L1](lead.md#l1) lands failure semantics first and owns the local runtime check in [L2](lead.md#l2).
- **Acceptance** — Run `npm.cmd --prefix backend test -- --runTestsByPath src/tests/inlineScorer.test.js` after adding the regression cases. On the approved disposable PostgreSQL instance, repeat a synthetic ID after a transient ML failure, submit concurrent copies of a high-risk case, and replay a scored ID with a different fixture result. Verify one transaction, at most one score and one alert per ID, recovery from pending, and no alert or notification from a replay that conflicts with the persisted decision. Save the row and event counts with the run command and exit code.
- **Evidence** — The scorer inserts the transaction, score, and alert independently and classifies each attempt before using conflict-safe inserts. A mocked replay left the first `LEGITIMATE` score in place and attempted an alert on the second response. [Score insert](../backend/src/pipeline/inlineScorer.js#L223) · [Alert insert](../backend/src/pipeline/inlineScorer.js#L241) · [Unique constraints](../database/init.sql#L33) · [Baseline](STATUS.md#offline-checks)
