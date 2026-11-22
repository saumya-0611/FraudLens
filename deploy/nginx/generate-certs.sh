#!/usr/bin/env bash
# Generate self-signed TLS certificate for local FraudLens Nginx HTTPS testing
# Usage: bash deploy/nginx/generate-certs.sh
set -e

CERT_DIR="$(cd "$(dirname "$0")" && pwd)/certs"
mkdir -p "$CERT_DIR"

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$CERT_DIR/fraudlens.key" \
  -out "$CERT_DIR/fraudlens.crt" \
  -subj "/C=IN/ST=UP/L=GreaterNoida/O=FraudLens-Team34/CN=localhost"

echo "Generated TLS certificate and key in $CERT_DIR"
