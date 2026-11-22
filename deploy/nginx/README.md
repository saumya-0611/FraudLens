# FraudLens Nginx Reverse Proxy & HTTPS TLS Termination (`deploy/nginx/`)

Provides an Nginx gateway with **HTTP -> HTTPS (301)** redirection, **TLS 1.2/1.3** termination, security headers (`HSTS`, `X-Frame-Options`, `X-Content-Type-Options`), `/api/*` reverse proxying, `/ws/alerts` WebSocket upgrade, and `/swagger/` OpenAPI documentation hosting.

## Quick Start
```bash
# 1. Generate self-signed local TLS cert (deploy/nginx/certs/fraudlens.crt & .key)
bash deploy/nginx/generate-certs.sh

# 2. Run Nginx HTTPS gateway container on https://localhost:8443
docker run --rm -d --name fraudlens-nginx \
  --network fraudlens_fraudlens-net \
  -p 8088:80 -p 8443:443 \
  -v "$(pwd)/deploy/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$(pwd)/deploy/nginx/certs:/etc/nginx/certs:ro" \
  -v "$(pwd)/docs/swagger:/usr/share/nginx/html/swagger:ro" \
  nginx:1.27-alpine
```
