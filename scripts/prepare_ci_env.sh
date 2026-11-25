#!/bin/sh
# Run from the root of a disposable CI checkout.
set -eu
umask 077

db_password=$(openssl rand -hex 24)
{
  sed -E '/^(POSTGRES_PASSWORD|POSTGRES_DB|DATABASE_URL|JWT_SECRET|SERVICE_TOKEN|INTERNAL_ML_TOKEN|SEED_ADMIN_PASSWORD|SEED_ANALYST_PASSWORD|SEED_VIEWER_PASSWORD)=/d' .env.example
  printf 'POSTGRES_PASSWORD=%s\n' "$db_password"
  printf 'POSTGRES_DB=fraudlens_ci\n'
  printf 'DATABASE_URL=postgresql://fraudlens:%s@postgres:5432/fraudlens_ci\n' "$db_password"
  printf 'JWT_SECRET=%s\n' "$(openssl rand -hex 32)"
  for key in SERVICE_TOKEN INTERNAL_ML_TOKEN SEED_ADMIN_PASSWORD SEED_ANALYST_PASSWORD SEED_VIEWER_PASSWORD; do
    printf '%s=%s\n' "$key" "$(openssl rand -hex 24)"
  done
  printf 'WS_ALLOWED_ORIGINS=http://127.0.0.1:5000\n'
  printf 'PIPELINE_MODE=%s\n' "${PIPELINE_MODE:-kafka}"
  printf 'STREAM_ENGINE=%s\n' "${STREAM_ENGINE:-spark}"
} > .env.ci
