# FraudLens Nginx Reverse Proxy & HTTPS TLS Termination (`deploy/nginx/`)

Provides an Nginx gateway with **HTTP -> HTTPS (301)** redirection, **TLS 1.2/1.3** termination, security headers (`HSTS`, `X-Frame-Options`, `X-Content-Type-Options`), `/api/*` reverse proxying, `/ws/alerts` WebSocket upgrade, and `/swagger/` OpenAPI documentation hosting.

For `https://localhost:8443`, set `COOKIE_SECURE=true` and
`WS_ALLOWED_ORIGINS=https://localhost:8443` in the backend's local Compose `.env`.
For a deployment, list the exact public HTTPS origin or comma-separated origins,
including any non-default port. Keep API and WebSocket requests on the same public origin.
Restart the backend after changing the allowlist.

Proxy trust is off by default. To give different clients separate quotas behind Nginx,
set `TRUSTED_PROXY_CIDRS` to the verified immediate ingress proxy address or a dedicated
ingress-only CIDR. Restrict direct access to the backend listener. The checked-in Nginx
config substitutes its observed peer address for the incoming forwarded address.
If a load balancer sits in front of Nginx, the infrastructure owner must configure and
verify client IP attribution for those hops before relying on per-client quotas.
Quotas are in memory per backend process.

## Quick Start
```bash
# 1. Generate self-signed local TLS cert (deploy/nginx/certs/fraudlens.crt & .key)
bash deploy/nginx/generate-certs.sh

# 2. Run Nginx HTTPS gateway container on https://localhost:8443
docker run --rm -d --name fraudlens-nginx \
  --network fraudlens_fraudlens-net \
  -p 127.0.0.1:8088:80 -p 127.0.0.1:8443:443 \
  -v "$(pwd)/deploy/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$(pwd)/deploy/nginx/certs:/etc/nginx/certs:ro" \
  -v "$(pwd)/docs/swagger:/usr/share/nginx/html/swagger:ro" \
  nginx:1.27-alpine
```

## Local HTTPS smoke test

On an isolated Compose project, start the services and seed a disposable user first.
Use that project's network name in the gateway command above. Use your locally trusted
certificate or trust the test certificate in a disposable browser profile.

```bash
curl --fail --cacert deploy/nginx/certs/fraudlens.crt https://localhost:8443/health
curl --cacert deploy/nginx/certs/fraudlens.crt -s -o /dev/null -w '%{http_code}\n' \
  https://localhost:8443/api/auth/me
```

The health request returns 200 and the anonymous session request returns 401. Open
`https://localhost:8443` in the test browser, sign in and use Developer Tools to confirm
the `Secure`, `HttpOnly` and `SameSite=Lax` cookie and the HTTP 101 upgrade for
`wss://localhost:8443/ws/alerts`. Send one approved synthetic alert through the disposable
stack and verify the browser shows its masked account. Sign out and confirm the session
request returns 401 again.
