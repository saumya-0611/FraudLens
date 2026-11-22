"""
webhook_receiver.py - HMAC-SHA256 Signed Fraud Alert & Drift Webhook Dispatcher/Receiver.

Demonstrates FraudLens WebHook integration:
1. `send_signed_webhook(url, event_type, payload, secret)` signs outbound JSON webhooks
   with `X-FraudLens-Signature: sha256=<hmac>` and `X-FraudLens-Event: <event_type>`.
2. `verify_webhook_signature(raw_body, signature_header, secret)` verifies authenticity
   in constant time (`hmac.compare_digest`).
3. Includes a lightweight HTTP webhook receiver (`python deploy/webhooks/webhook_receiver.py`)
   on port 9099 for testing live alert/drift webhook delivery during the demo.
"""
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from typing import Any, Dict

import httpx


def compute_signature(raw_body: bytes, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def verify_webhook_signature(raw_body: bytes, signature_header: str, secret: str) -> bool:
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = compute_signature(raw_body, secret)
    return hmac.compare_digest(signature_header.encode("utf-8"), expected.encode("utf-8"))


def send_signed_webhook(
    url: str,
    event_type: str,
    payload: Dict[str, Any],
    secret: str | None = None,
) -> int:
    """Send an HMAC-SHA256 signed webhook POST request."""
    webhook_secret = secret or os.getenv("WEBHOOK_SECRET", "change_me_service_token")
    body_bytes = json.dumps({"event": event_type, "data": payload}).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "X-FraudLens-Event": event_type,
        "X-FraudLens-Signature": compute_signature(body_bytes, webhook_secret),
    }
    res = httpx.post(url, content=body_bytes, headers=headers, timeout=5.0)
    return res.status_code


class WebhookHandler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length)
        sig = self.headers.get("X-FraudLens-Signature", "")
        event = self.headers.get("X-FraudLens-Event", "UNKNOWN")
        secret = os.getenv("WEBHOOK_SECRET", "change_me_service_token")

        if not verify_webhook_signature(raw_body, sig, secret):
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b'{"status":"invalid_signature"}')
            return

        print(f"[webhook-receiver] Verified {event}: {raw_body.decode('utf-8')}")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"received"}')


def test_webhook_signing_and_verification():
    secret = "test_webhook_secret_key"
    body = json.dumps({"event": "HIGH_RISK_ALERT", "alert_id": 17, "account_masked": "XXXX-2095"}).encode("utf-8")
    sig = compute_signature(body, secret)
    assert verify_webhook_signature(body, sig, secret) is True
    assert verify_webhook_signature(body + b"tamper", sig, secret) is False
    assert verify_webhook_signature(body, "sha256=invalid", secret) is False


if __name__ == "__main__":
    test_webhook_signing_and_verification()
    port = int(os.getenv("WEBHOOK_RECEIVER_PORT", "9099"))
    print(f"[webhook-receiver] Self-test passed. Listening on http://0.0.0.0:{port}/webhooks/fraudlens ...")
    HTTPServer(("0.0.0.0", port), WebhookHandler).serve_forever()
