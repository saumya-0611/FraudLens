# Two-minute FraudLens security demo

Run from the repo root in PowerShell. Install the backend lockfile dependencies beforehand and start the named disposable PostgreSQL instance using [the verification setup](attack_tests/README.md). Use a fresh database for each demonstration. Begin recording before running the demo commands.

| Time | Show | Explain |
|---|---|---|
| 0:00–0:35 | Run `node security/verify-postgres.cjs`. Point to the five failed login checks, the lock and the recovery check. | PostgreSQL counts failures atomically. The fifth failure locks the synthetic account for 15 minutes. The demo sets the test lock's expiry to the past so you can show recovery immediately. |
| 0:35–0:55 | In the same output, show the VIEWER denial. | The signed cookie identifies the caller. The current database role controls the API. Valid login plus insufficient access gives 403. |
| 0:55–1:20 | Run `npm.cmd --prefix backend test -- --silent jwt.test.js -t 'expired token is rejected'`. | The JWT verifier requires a current signed token. An expired session cannot authenticate. |
| 1:20–2:00 | Point to the successful audit verification, then run `npm.cmd --prefix backend test -- --silent auditIntegrity.test.js -t 'rejects invalid stored content'`. | Each row records the previous hash and its own content hash. The test alters only an in-memory fixture and checks that the verifier reports the first mismatch. |

The API signs a short-lived JWT and sets an HttpOnly cookie. Passwords stay in PostgreSQL as bcrypt hashes. The API looks up current user status and role each time, and sockets recheck before sending alerts. Kafka carries events internally. The ML service checks an internal token and verifies the artifact digest before loading a model. The audit chain exposes inconsistencies with recorded hashes. An independent checkpoint is needed to prove a chain's tail was preserved.

After the demo, stop only the disposable container you created, clear `DATABASE_URL` from this shell and use a fresh container for the next rehearsal. For the recorded evidence, show PASS lines and status codes. Keep connection strings, passwords and cookies off screen.
