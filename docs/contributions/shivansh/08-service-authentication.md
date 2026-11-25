# Internal service authentication

FraudLens has two machine-to-machine trust boundaries. The backend must accept synthetic transaction ingestion from the simulator, and the ML service must accept prediction and management calls from authorized internal callers.

| Boundary | Header | Current control |
| --- | --- | --- |
| Simulator to Express ingestion | `X-Service-Token` | Compare the configured `SERVICE_TOKEN` using a length check and timing-safe byte comparison. Reject blank and known placeholder configuration. If the service credential is absent or invalid, require an authenticated ADMIN session. |
| Backend or streaming worker to FastAPI | `X-Internal-Token` | The FastAPI dependency rejects missing, blank, placeholder and mismatched settings and uses `hmac.compare_digest`. It protects prediction and model-management endpoints. The service health endpoint is public. |

The verified service identity bypasses the normal browser API and ingestion quotas for the designated ingestion POST. The request still goes through transaction validation. Backend model routes and inline scoring forward the internal ML token, and the streaming worker validates its configuration before connecting. [Ingestion authentication](../../../backend/src/middleware/serviceAuth.js) · [API limits](../../../backend/src/middleware/apiHardening.js) · [ML token guard](../../../ml-service/app/security.py) · [Backend model routes](../../../backend/src/routes/models.routes.js) · [Streaming configuration](../../../streaming/jobs/pipeline.py)

Shivansh contributed the ingestion guard in the security hardening series, updated ML authentication in `fec233e` and hardened streaming credential requirements in `92b9ac8`. Riya owns the ingestion and Kafka integration. Saumya manages ML service deployment and credential rotation. The tests cover invalid tokens, ADMIN fallback and protected ML endpoints. [Route fixtures](../../../backend/src/tests/protectedRoutes.test.js) · [HTTP hardening tests](../../../backend/src/tests/apiHardening.test.js) · [FastAPI security tests](../../../ml-service/tests/test_security.py)

These shared tokens establish service access within their defined boundaries. They do not identify a customer or tenant. The deployed services require approved secrets and protected transport. The historical limiter load check used a counted publisher fixture and did not measure broker throughput. [Secrets policy](../../../security/secrets-policy.md) · [Evidence report](../../../docs/test-reports/security-report.md)
