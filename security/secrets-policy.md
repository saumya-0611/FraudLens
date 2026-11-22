# FraudLens secrets policy

Keep real credentials in a restricted local `.env`, a CI secret store, or the deployment secret manager. Commit only `.env.example` and `deploy/k8s/secrets.example.yaml`. Treat environment dumps, request headers, database URLs, and deployment YAML generated with real values as sensitive. Frontend `VITE_*` variables are public build or runtime configuration.

| Secret | Consumers | Rotation |
|---|---|---|
| `JWT_SECRET` | Backend replicas | Generate a fresh random value of at least 32 characters. Update every backend replica together. Existing sessions expire immediately when backend verification uses the new key. |
| `SERVICE_TOKEN` | Simulator and backend ingestion | Update both ends together, then verify a synthetic ingestion event. |
| `INTERNAL_ML_TOKEN` | Backend, streaming, ML service | Update all three together. Missing, blank and example tokens fail closed at the ML service. |
| PostgreSQL password and `DATABASE_URL` | Database and services that connect to it | Rotate at the database first as part of a coordinated cutover and refresh dependent connection pools. Keep an independent backup. Use separate least-privilege credentials in production. |
| `SEED_*_PASSWORD` | Explicit backend seed command | Supply only for provisioning missing users. Remove from the provisioning environment afterward. Use a verified reset for an existing account and retain its identity. |
| Optional webhook signing secret | Stream sender and configured receiver | Coordinate both ends before resuming delivery. Restrict sender and receiver configuration to their workloads. |

Use TLS and set `COOKIE_SECURE=true` for HTTPS deployments. Preserve SameSite and HttpOnly on the session cookie. Deploy with a trusted proxy configuration that strips or replaces untrusted forwarding headers. Kubernetes Secrets need restricted RBAC and encryption at rest where supported. The cluster example limits which secrets each workload receives. Keep registry/model storage private and restrict who can publish models and change their expected digest.

If a real secret is exposed, revoke or rotate it promptly and involve the repository or deployment owners. Preserve access logs for investigation. Review recent uses of the secret and invalidate affected sessions. A Git cleanup is a separate coordinated operation. Secret scanning and passing dependency audits are additional checks and have known coverage limits.

The CI gate audits the two committed npm lockfiles at high severity and resolves ML requirements with strict collection. Registry errors and vulnerability findings surface as failures. The ML dependency set has pinned direct dependencies and is still subject to changes in transitive dependency resolution.
