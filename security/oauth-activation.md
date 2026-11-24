# FraudLens Task 03 OAuth activation evidence

25 November 2026 IST. Local branch `shivansh/oauth-activation` starts at release-stabilization `92b9ac8069d3fbee1366006c07bbb3dec919ca7e`. The fetched integration refs were `origin/dev` at `8aae93c` and `origin/main` at `ed73a51`.

| Area | Readiness and evidence |
| --- | --- |
| Google | **BLOCKED for live sign-in.** The provider-shaped HTTPS fixture passed with the real OIDC library and PostgreSQL. Google advertised S256 and the test exchange verified the stored verifier. An approved Google web client and real test account are still required. [Google discovery](https://accounts.google.com/.well-known/openid-configuration) |
| LinkedIn | **BLOCKED for live sign-in.** The independent HTTPS fixture passed with LinkedIn’s issuer, token endpoint shape and signed ID token. The published metadata does not advertise PKCE for this web OIDC flow. An approved LinkedIn application with the OIDC product and real test account is still required. [LinkedIn discovery](https://www.linkedin.com/oauth/.well-known/openid-configuration) |
| HTTPS origin | The exact origin used for the green fixture run was `https://localhost:58688`, with callbacks `https://localhost:58688/api/auth/google/callback` and `https://localhost:58688/api/auth/linkedin/callback`. That was an ephemeral loopback listener. No approved provider-facing origin was configured or supplied. |
| Migration | **PASS on disposable PostgreSQL 16.** Task 03 authorized the existing SQL in a newly created fixture database. Before applying it, `password_hash` was NOT NULL and provider availability was false. Afterward it was nullable, both OAuth tables were ready, and the pre-existing password row matched exactly. The normal schema bootstrap also ran again. Both uniqueness constraints returned SQLSTATE `23505` for duplicate fixtures. A ten-minute attempt was checked and a manually expired disposable attempt failed before token exchange. The fixture container was removed. [Migration](../database/proposals/social-oauth.sql) |
| Activation | **Ready for code review.** Credentialed provider runs and approved ingress acceptance remain outstanding. Keep `SOCIAL_OAUTH_ENABLED=false` anywhere carrying shared business data until organization isolation and authorization are approved and verified. |

## Compatibility and observed gaps

- The production route, identity store, signed session, audit writer, and password login ran as written. Each provider created one ACTIVE VIEWER with a null password hash from concurrent callbacks. Subsequent sign-in reused the same row. Identical email and subject strings across providers resolved to distinct accounts through issuer/subject. A provider role claim could not grant access to the users API. An authenticated, exact-Origin linking request was the only tested route that attached a provider to the existing password account. Foreign or unauthenticated link requests were denied. [Runtime harness](verify-oauth.cjs)
- Both provider-shaped flows checked `/api/auth/me`, Secure/HttpOnly/SameSite=Lax sessions, no-store and no-referrer response headers, logout, expired attempts, nonce rejection, and disabled-account rejection with a previous session. The test sent a different HTTP Host and verified the configured callback stayed unchanged. Audit details contained only approved event metadata. These runs used generated signing keys and mocked provider token/JWKS HTTP responses.
- The built React app ran in Chrome over locally pinned HTTPS. It rendered both enabled provider buttons and the denied-consent message. The browser UI test did not visit a real provider. The HTTPS fixture served frontend and API on one origin directly, while proxy verification separately exercised Caddy’s logging failure path.
- The checked-in Caddy access log stripped code and state, while a genuine proxy error from an unavailable upstream logged both synthetic markers. The fix extends normalization to the runtime log and strips callback secrets and credential-bearing headers in both logs. After the fix two callback access records and two error records remained visible, with zero synthetic marker values. Caddy config validation passed. [Caddy config](../deploy/caddy/Caddyfile) · [Caddy runtime log options](https://caddyserver.com/docs/caddyfile/options#log)
- The production env template now includes a blank `OAUTH_PUBLIC_ORIGIN`. Nginx inherits its default request log format, which includes the request line, and requires its own callback log review before use. Vercel routes `/api/*` to Render, and the complete hosted log chain and WebSocket routing are unverified. Neither hosted path was exercised. [Env template](../.env.prod.example) · [Nginx config](../deploy/nginx/nginx.conf) · [Nginx log documentation](https://nginx.org/en/docs/http/ngx_http_log_module.html) · [Vercel rewrites](../frontend/vercel.json)

## Developer-console and backend configuration

1. Saumya approves one exact HTTPS origin for a test environment with disposable data. Verify that its browser, `/api` and both callback paths share the origin. Check TLS trust, callback query and credential redaction on normal and error paths at every proxy or telemetry layer, and the expected same-origin alert transport.
2. **Google.** In Google Auth Platform configure Branding, Audience and allowed test accounts as applicable. Create a Web application OAuth client and register the precise `<approved-origin>/api/auth/google/callback` URI. Supply `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` to the test backend. [Google OIDC setup](https://developers.google.com/identity/openid-connect/openid-connect#setting-up-oauth-20) · [Google Auth Platform consent setup](https://developers.google.com/workspace/guides/configure-oauth-consent)
3. **LinkedIn.** Request **Sign In with LinkedIn using OpenID Connect** in the application's Products tab. Verify the granted scopes include `openid profile email`. In the Auth tab register the exact `<approved-origin>/api/auth/linkedin/callback` URI. Supply `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` and `LINKEDIN_REDIRECT_URI` to the test backend. [LinkedIn OIDC product](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2) · [LinkedIn callback configuration](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
4. Inject credentials through a backend environment or secret store. Set `OAUTH_PUBLIC_ORIGIN` to the exact approved origin with no trailing slash, `COOKIE_SECURE=true`, and `WS_ALLOWED_ORIGINS` to include that origin. Use a separate random `JWT_SECRET` and an explicit disposable `DATABASE_URL`. Point `DATABASE_URL_UNPOOLED` at the same fixture or leave it empty. Set `SOCIAL_OAUTH_ENABLED=true` only in the isolated test environment. To test one provider independently, leave all three variables for the other provider empty. `/api/auth/providers` verifies configuration and schema availability. A true value does not prove credential validity.
5. For local Google loopback development using an approved Google client, the app accepts `OAUTH_PUBLIC_ORIGIN=http://localhost:5173` with `NODE_ENV=development` and `COOKIE_SECURE=false`. Its exact Google callback is `http://localhost:5173/api/auth/google/callback`. Keep LinkedIn settings empty for this HTTP configuration. Use `VITE_USE_MOCKS=false`, a local `VITE_PROXY_TARGET`, and the identical browser origin for alerts.
6. Run the real acceptance matrix for each provider after setup. Check first and later login, concurrent callback behavior, /api/auth/me, denied consent, logout, disabled-user denial, existing password login, and redacted logs. Capture only provider name, redacted user identifier, status and role. Review rollout authorization, tenant isolation and rollback separately before any shared enablement. Roll back by switching off the gate and retaining identity mappings and nullable hashes. [Rollout and rollback](social-oauth.md#release-and-rollback)

## Test commands and results

| Check | Command | Result |
| --- | --- | --- |
| Focused backend | `npm.cmd --prefix backend test -- --silent --runTestsByPath src/tests/oauthRoutes.test.js src/tests/oauthStore.test.js src/tests/authRoutes.test.js src/tests/authMiddleware.test.js src/tests/seed.test.js src/tests/server.test.js` | Exit 0. 53 Jest tests and 11 OIDC pretests. |
| Full backend | `npm.cmd --prefix backend test -- --silent` | Exit 0. 229 tests across 22 suites and 11 OIDC pretests. |
| Standalone fixtures | `node --test backend/src/tests/fixtures/oidc.node.cjs` and `node --test scripts/proofScripts.test.cjs` | Both exit 0. 11 OIDC and 3 proof tests. |
| Frontend | `npm.cmd --prefix frontend run lint` and `$env:VITE_USE_MOCKS='false'` followed by `npm.cmd --prefix frontend run build` | Both exit 0. |
| Disposable database, HTTPS and Chrome | `node security/verify-oauth.cjs` with the environment below | Exit 0. Both provider-shaped fixture flows passed. |
| Caddy | `caddy validate --config /etc/caddy/Caddyfile` in `caddy:2-alpine` and the synthetic requests below | Exit 0. Two access records, two proxy errors, zero marker leaks after the change. |
| Credentialed Google and LinkedIn | No approved origin or provider app credentials available in the worktree | Both NOT RUN. |

### Reproduce the disposable HTTPS verification

Use PowerShell from the branch root after the frontend build. Set the two executable paths to locally installed OpenSSL and Chrome as needed. The fixture certificate is scoped to this verification.

```powershell
$id = [guid]::NewGuid().ToString('N').Substring(0,16)
$name = "fraudlens-oauth-fixture-$id"
$db = "fraudlens_oauth_fixture_$id"
$tls = Join-Path ([IO.Path]::GetTempPath()) $name
New-Item -ItemType Directory -Path $tls -ErrorAction Stop | Out-Null
$env:FRAUDLENS_OAUTH_FIXTURE_CERT = Join-Path $tls 'cert.pem'
$env:FRAUDLENS_OAUTH_FIXTURE_KEY = Join-Path $tls 'key.pem'
$env:POSTGRES_PASSWORD = [guid]::NewGuid().ToString('N')
$env:FRAUDLENS_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$started = $false
$result = 1
try {
  & 'C:/Program Files/Git/usr/bin/openssl.exe' req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost -addext subjectAltName=DNS:localhost -keyout $env:FRAUDLENS_OAUTH_FIXTURE_KEY -out $env:FRAUDLENS_OAUTH_FIXTURE_CERT 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Fixture certificate generation failed.' }
  docker run --pull=never --rm -d --name $name -e POSTGRES_PASSWORD -e "POSTGRES_DB=$db" -p 127.0.0.1::5432 postgres:16 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Fixture PostgreSQL failed to start.' }
  $started = $true
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    docker exec $name pg_isready -h 127.0.0.1 -U postgres -d $db | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Fixture PostgreSQL readiness timed out.' }
  $binding = docker port $name 5432/tcp
  if ($binding -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'Unexpected fixture port binding.' }
  $port = $Matches[1]
  Get-Content -Raw database/init.sql | docker exec -i $name psql -qX -v ON_ERROR_STOP=1 -U postgres -d $db
  if ($LASTEXITCODE -ne 0) { throw 'Baseline schema failed.' }
  $env:FRAUDLENS_OAUTH_FIXTURE_DATABASE_URL = "postgresql://postgres:$($env:POSTGRES_PASSWORD)@127.0.0.1:$port/$db"
  node security/verify-oauth.cjs
  $result = $LASTEXITCODE
} finally {
  if ($started) {
    docker stop $name | Out-Null
    if ($LASTEXITCODE -ne 0) { $result = 1 } else { Write-Output 'Removed disposable OAuth database container.' }
  }
  Remove-Item -LiteralPath $env:FRAUDLENS_OAUTH_FIXTURE_CERT,$env:FRAUDLENS_OAUTH_FIXTURE_KEY -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $tls -ErrorAction SilentlyContinue
  Remove-Item Env:POSTGRES_PASSWORD,Env:FRAUDLENS_OAUTH_FIXTURE_DATABASE_URL,Env:FRAUDLENS_OAUTH_FIXTURE_CERT,Env:FRAUDLENS_OAUTH_FIXTURE_KEY -ErrorAction SilentlyContinue
}
if ($result -ne 0) { throw 'Disposable OAuth verification failed.' }
```

### Reproduce the Caddy error-log check

The disposable container has no upstream or external network. This forces the error path with synthetic markers only.

```powershell
$name = 'fraudlens-oauth-proxy-' + [guid]::NewGuid().ToString('N').Substring(0,16)
$config = (Resolve-Path 'deploy/caddy/Caddyfile').Path
docker run --pull=never --network none --rm -d --name $name --env SITE_ADDRESS=:80 --mount "type=bind,source=$config,target=/etc/caddy/Caddyfile,readonly" caddy:2-alpine | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Proxy fixture did not start.' }
try {
  Start-Sleep -Milliseconds 700
  foreach ($provider in @('google','linkedin')) {
    docker exec $name sh -c "wget -O /dev/null --header 'Referer: http://fixture.test/synthetic-task03-referer' --header 'X-Internal-Token: synthetic-task03-token' 'http://127.0.0.1/api/auth/$provider/callback?code=synthetic-task03-code&state=synthetic-task03-state&error_description=synthetic-task03-description&access_token=synthetic-task03-access' >/dev/null 2>&1; true"
    if ($LASTEXITCODE -ne 0) { throw 'Proxy fixture request failed to run.' }
  }
  $lines = @(docker logs $name 2>&1 | ForEach-Object { $_.ToString() })
  $records = @($lines | Where-Object { $_ -match '/api/auth/(google|linkedin)/callback' })
  $access = @($records | Where-Object { $_ -match '"logger":"http\.log\.access' })
  $errors = @($records | Where-Object { $_ -match '"logger":"http\.log\.error' })
  if ($access.Count -ne 2 -or $errors.Count -ne 2) { throw 'Expected two callback access and two error records.' }
  if (@($lines | Where-Object { $_ -match 'synthetic-task03-' }).Count -ne 0) { throw 'Callback fixture data found in proxy logs.' }
  Write-Output 'PASS: 2 access and 2 unavailable-upstream error records retained, 0 synthetic callback values logged.'
} finally {
  docker stop $name | Out-Null
}
```
