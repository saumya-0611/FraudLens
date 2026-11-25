# Authenticated alert WebSockets

Real-time alerts can disclose transaction information to any browser that receives them. FraudLens must validate the socket origin and account before sending alert data, then respond to account changes while the socket remains open.

## Upgrade and session checks

`/ws/alerts` accepts only a parsed Origin that exactly matches the configured allowlist. A missing or unapproved Origin produces HTTP `403` at upgrade. An allowed Origin still requires a valid session cookie and an active account. The server emits `READY` after authentication. A missing, invalid or disabled session closes with `4401`. A subsequent role or account-identity change closes with `4403`. Current code rechecks the session before broadcasting and during the heartbeat. [Browser origin policy](../../../backend/src/middleware/browserRequest.js) · [Alert socket](../../../backend/src/websocket/alertSocket.js)

Each alert is sanitized before it is encoded. The shared helper recursively removes fields named `account_ref`. The transmitted account label uses `account_masked`, with a safe fallback if no account reference is available. Active users can receive masked socket alerts, while REST investigation has a separate ADMIN/ANALYST guard. [Masking helper](../../../backend/src/utils/mask.js) · [Alert REST routes](../../../backend/src/routes/alerts.routes.js)

## Attribution and evidence

Riya contributed Kafka alert delivery and the initial WebSocket path in `7b53e60`. Shivansh added the exact Origin and request trust rules in `eab94b6` and related masking and verification work. Amrita and Saumya integrated later authenticated socket readiness and client status handling. The socket tests cover readiness, Origin denial, invalid and changed sessions, and nested masking. The Chrome fixture used a real socket and a synthetic alert. [Socket tests](../../../backend/src/tests/alertSocket.test.js) · [Browser evidence harness](../../../security/verify-browser.cjs)

The source and local tests do not establish that a hosted proxy forwards upgrades. Hosted ingress must preserve its approved HTTPS and WebSocket behavior, cookie attributes, and exact Origin configuration. [Nginx runbook](../../../deploy/nginx/README.md)
