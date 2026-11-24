# Two-minute FraudLens security demo

Prepare a fresh disposable PostgreSQL container and the fixture schema before recording. Use the [Task 02 runtime setup](task02-status.md#disposable-runtime-setup) and run `node security/verify-postgres.cjs` with its verification database URL. The backend binds to loopback, sends prediction requests to a synthetic HTTP fixture and uses real PostgreSQL and WebSocket connections.

| Time | Show | Explain |
| --- | --- | --- |
| 0:00–0:35 | Point to the five failed logins and 15-minute lockout. | PostgreSQL counts failures atomically. The fixture alone advances the lockout expiry to demonstrate recovery. The generic failure covers unknown users too. |
| 0:35–1:05 | Show the signature-integrity and expired-session checks, plus VIEWER and ANALYST denial on administrative routes. | A modified signature or expired token returns 401. A valid session still needs the current database role and active status. |
| 1:05–1:25 | Show masked transaction and WebSocket data and the foreign-origin rejection. | Only the masked account value is returned. Socket access requires an exact allowed origin and a current session. |
| 1:25–2:00 | Show the successful audit CLI check and the fixture mismatch followed by rollback. | The verifier identified the first changed row. The transaction rollback preserved the original rows, and the intact chain passed verification again. |

The Task 02 rehearsal completed in 2.2 seconds after container and schema preparation. Use the presentation time to explain what each result verifies. Display only status codes and PASS lines. Avoid showing connection strings, cookies, token values or raw account references. Stop the named disposable container after the demo.
