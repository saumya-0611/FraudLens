# Backend (Node + Express)

Run locally: `npm install`, copy `.env.example` to `.env` in the repo root, then `npm run dev`.
Check: `curl http://localhost:5000/health` returns `{"status":"ok"}`.
Test: `npm test`.
Docker: built by the root docker-compose.

## Authentication setup and existing accounts

Set `JWT_SECRET` to a randomly generated secret of at least 32 characters and replace the
example `SERVICE_TOKEN`. Set `COOKIE_SECURE=true` for HTTPS deployments. Run
`npm run seed` with explicit `SEED_*_PASSWORD` values to create missing accounts.
The seed command skips existing usernames.

Before upgrading an existing database, back it up and inventory affected usernames
without exporting their password hashes:

```sql
SELECT id, username, role, status
FROM users
WHERE password_hash ~ '^[0-9A-Fa-f]{64}$';
```

Arrange verified password resets for affected users through an existing bcrypt-backed
administrator using `PATCH /api/users/:id`. If every administrator is affected, have
the database owner perform an approved, one-time bcrypt reset for a verified admin
account first. Keep user IDs, roles, and statuses intact and clear the lockout fields
when replacing a password. For a fresh, disposable demo database, run the seed command
with new credentials. Rotate the JWT secret during the cutover to expire old sessions.

`npm run audit:verify` recomputes every hash. Older audit entries were hashed using
their original JSON key order, which JSONB can discard. A mismatch in that history
requires review against trusted records. Preserve the original hashes and record
the finding rather than rewriting the chain.

The login limiter uses Express's client IP and keeps counters in memory per backend
process. With a reverse proxy and default Express settings, proxied clients share
the proxy IP's quota. Per-client limits behind a proxy require deployment-specific
trusted proxy configuration that validates or replaces forwarded addresses.
