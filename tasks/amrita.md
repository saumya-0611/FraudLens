# Amrita

Frontend. Owns the React transaction screens, navigation, public landing page, and authenticated alert presentation.

## P0

### A1

- [ ] **Add an ADMIN manual transaction flow** · Implemented. Chromium fixtures, lint and build passed. The live inline Selenium rehearsal remains pending.
- **Goal** — Add manual entry through the existing transaction UI and cookie-authenticated API client. Show acknowledgement and pending states while the backend is processing. Render the persisted score, explanation, model version, and masked account from the detail API when available. Use a bounded refresh or explicit retry, and keep the transaction ID available after reload.
- **Files** — `frontend/src/pages/Transactions.jsx`, `frontend/src/components/PageState.jsx`, `frontend/src/services/api.js` if needed, and `tests/selenium/test_fraudlens_e2e.py` for the new local browser case.
- **Dependencies** — Riya [R1](riya.md#r1) and Lead [L1](lead.md#l1) provide pending/scored readback. Shivansh [S1](shivansh.md#s1) confirms the role boundary. Lead [L2](lead.md#l2) runs the real-ML rehearsal.
- **Acceptance** — Run `npm.cmd --prefix frontend run lint`, `npm.cmd --prefix frontend run build`, and `python -m pytest -q tests/selenium/test_fraudlens_e2e.py -k manual_transaction` after adding the browser case. Against an approved loopback stack with mocks disabled, submit synthetic data as ADMIN, observe a pending or accepted state without score fields, observe a score only after the detail endpoint returns it, reload and see the same result with a masked account, and verify ANALYST and VIEWER have no submission action. Record the local run and exit codes.
- **Evidence** — The current transaction screen reads lists and details and renders pending rows. The existing app mounts that screen and already has an ADMIN-only backend POST contract. [Screen](../frontend/src/pages/Transactions.jsx#L23) · [App route](../frontend/src/App.jsx#L348) · [POST contract](../docs/CONTRACTS.md#L319)

### A2

- [ ] **Show the actual alert connection state** · Implemented and verified in Chromium fixtures and authenticated socket integration. The complete Selenium suite remains pending.
- **Goal** — Report socket connection, successful HTTP refresh, and unavailable states accurately. A role without alert polling permission stays unavailable when the socket is down. Keep alerts tied to actual received or persisted alert data.
- **Files** — `frontend/src/hooks/useAlertSocket.js`, `frontend/src/layouts/DashboardLayout.jsx`, and `tests/selenium/test_fraudlens_e2e.py` for the new status checks.
- **Dependencies** — Shivansh [S1](shivansh.md#s1) confirms role permissions and Lead [L2](lead.md#l2) supplies a real local high-risk event for rehearsal.
- **Acceptance** — Run frontend lint and build, then `python -m pytest -q tests/selenium/test_fraudlens_e2e.py -k alert_connection` after adding the cases. On loopback, check successful socket connection, failed socket for VIEWER, and success/failure of the permitted polling fallback for ADMIN or ANALYST. A real or clearly labelled fixture event appears once in the appropriate test. The disconnected VIEWER screen shows no live indicator and makes no restricted polling request.
- **Evidence** — The fallback sets `Live` before returning for roles that cannot poll, and the layout uses `Live` to light the status indicator. The alert REST endpoint is restricted to ADMIN and ANALYST. [Fallback](../frontend/src/hooks/useAlertSocket.js#L42) · [Layout](../frontend/src/layouts/DashboardLayout.jsx#L68) · [Access contract](../docs/CONTRACTS.md#L322)

## P1

### A3

- [ ] **Align visitor-facing claims with the demonstrated mode** · Copy updated to describe the configured mode and fixture evidence. Final release rehearsal remains pending.
- **Goal** — Describe the mode actually exercised for the demo. Describe Kafka/Spark as the streaming architecture where relevant, and label synthetic demo data. Verify dashboard status and monitoring copy against the source of each displayed value.
- **Files** — `frontend/src/pages/LandingPage.jsx`, `frontend/src/pages/Dashboard.jsx`, and `docs/demo-script.md` jointly with Lead if wording needs synchronization.
- **Dependencies** — Lead [L2](lead.md#l2) provides evidence for the local inline mode. Cite [L4](lead.md#l4) before presenting streaming as demonstrated.
- **Acceptance** — Run `npm.cmd --prefix frontend run lint` and `npm.cmd --prefix frontend run build`. Open `/home` and `/dashboard` in the approved loopback setup with production mocks disabled. Record a checklist mapping each pipeline, live-data, and metric claim to observed mode/API evidence or a clear synthetic/unavailable label. Check that public copy makes no unverified deployment claim.
- **Evidence** — The landing page presents Kafka/streaming and live monitoring, while the checked-in Render blueprint selects inline. The dashboard reads summary and alert data and uses live-monitoring copy. The public deployment itself remains unverified. [Landing copy](../frontend/src/pages/LandingPage.jsx#L5) · [Dashboard](../frontend/src/pages/Dashboard.jsx#L35) · [Render blueprint](../render.yaml#L56)
