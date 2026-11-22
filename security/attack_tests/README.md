# Defensive security verification

Use the checked-in tests with synthetic accounts and data. Jest exercises real cookie verification, RBAC and route middleware. Its database and Kafka fixtures keep those tests independent of the running stack. The PostgreSQL check starts a loopback backend, uses real PostgreSQL and its advisory lock, and uses a WebSocket client. It publishes fixture alerts within the backend process.

```powershell
npm.cmd --prefix backend test -- --silent jwt.test.js authMiddleware.test.js authRoutes.test.js authRateLimit.test.js protectedRoutes.test.js apiHardening.test.js securityAdmin.test.js securityValidation.test.js auditIntegrity.test.js alertSocket.test.js transactions.test.js alerts.test.js
```

Use a fresh local PostgreSQL container for the integration check. The harness verifies the loopback address, exact database name and empty users/audit tables before creating fixtures. Use a freely chosen disposable password in the variables below.

```powershell
$fixturePassword = node -e "process.stdout.write(require('node:crypto').randomBytes(20).toString('hex'))"
docker run --rm -d --name fraudlens-security-demo -e "POSTGRES_PASSWORD=$fixturePassword" -e POSTGRES_DB=fraudlens_phase2_verification -p 127.0.0.1::5432 postgres:16
docker exec fraudlens-security-demo pg_isready -U postgres -d fraudlens_phase2_verification
```

Once PostgreSQL accepts connections, initialize and run the check.

```powershell
Get-Content -Raw database/init.sql | docker exec -i fraudlens-security-demo psql -U postgres -d fraudlens_phase2_verification -v ON_ERROR_STOP=1
$fixturePort = (docker port fraudlens-security-demo 5432).Split(':')[-1]
$env:DATABASE_URL = "postgresql://postgres:${fixturePassword}@127.0.0.1:$fixturePort/fraudlens_phase2_verification"
node security/verify-postgres.cjs
```

For the browser run, keep the container active and create a separate empty database. Build the frontend with live API mode and point `FRAUDLENS_CHROME` at your local Chrome executable. Set `FRAUDLENS_CAPTURE_EVIDENCE=1` if you want to refresh the VIEWER-denial screenshot.

```powershell
docker exec fraudlens-security-demo createdb -U postgres fraudlens_phase2_browser
Get-Content -Raw database/init.sql | docker exec -i fraudlens-security-demo psql -U postgres -d fraudlens_phase2_browser -v ON_ERROR_STOP=1
$env:DATABASE_URL = "postgresql://postgres:${fixturePassword}@127.0.0.1:$fixturePort/fraudlens_phase2_browser"
npm.cmd --prefix frontend run build
$env:FRAUDLENS_CHROME = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node security/verify-browser.cjs
```

After verification, shut down the disposable database.

```powershell
docker stop fraudlens-security-demo
Remove-Item Env:DATABASE_URL
```

Use a fresh instance for each rehearsal. The audit tests exercise inconsistent data in memory. Preserve audit history in shared environments. See [Phase 2 evidence](../../docs/test-reports/security-report.md) for results and outstanding checks.
