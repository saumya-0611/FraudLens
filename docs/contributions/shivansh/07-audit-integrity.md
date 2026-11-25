# Audit integrity and verification

FraudLens records authentication events, authorization denials, user changes, and selected alert events. It needs evidence that retained audit records have stayed internally consistent under concurrent writes.

## Hash-chain construction

The writer acquires a PostgreSQL transaction-scoped advisory lock before reading the last hash and appending the next event. The first event uses an all-zero genesis hash. Each SHA-256 entry incorporates the previous hash, UTC timestamp, username, action, entity type, entity ID and canonical JSON details. Object keys are sorted so PostgreSQL JSONB key ordering does not alter verification. The writer omits recognized credential and account-reference keys from details. Callers still need to keep secrets out of event text and other fields. [Audit writer](../../../backend/src/audit/auditLogger.js)

The admin audit API uses validated filters and returns stored hashes only when requested. The CLI reads rows in ID order, recomputes both links and content hashes, and exits nonzero on the first mismatch or a read failure. Inline alert scoring can reuse the append operation in its own transaction. The Kafka consumer also checks for an existing alert audit to avoid duplicating that event on replay. [Audit API](../../../backend/src/routes/audit.routes.js) · [Verifier](../../../backend/scripts/verify_audit_chain.js) · [Inline scorer](../../../backend/src/pipeline/inlineScorer.js) · [Kafka alert consumer](../../../backend/src/kafka/alertConsumer.js)

## Evidence and limits

Shivansh contributed audit hardening and redaction in `687e8f4` and `c73f466` and transaction-bound audit reuse in `d44cb70`. Saumya’s earlier PostgreSQL backend and Riya’s alert transport are shared foundations. Tests exercise changed content, links and rollback. The prior disposable report records twelve concurrent appends in a verified 24-row chain. [Audit tests](../../../backend/src/tests/auditIntegrity.test.js) · [Recorded evidence](../../../docs/test-reports/security-report.md)

This is a consistency check on the retained chain. A valid prefix remains valid after tail deletion, and a privileged actor able to rewrite and rehash all rows could reconstruct a consistent chain. An independent protected checkpoint is needed for stronger evidence of tail or whole-chain preservation. The digest covers the specified fields and does not cover every database column.
