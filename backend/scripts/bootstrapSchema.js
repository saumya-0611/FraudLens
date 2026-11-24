// Idempotent schema bootstrap for managed cloud PostgreSQL (e.g. Render / Neon)
// Matches database/init.sql (CONTRACTS.md Section 3) 1:1 with IF NOT EXISTS guards.
const { unpooledQuery, query } = require('../src/config/db');
const runQuery = unpooledQuery || query;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id               SERIAL PRIMARY KEY,
    username         VARCHAR(50) UNIQUE NOT NULL,
    password_hash    TEXT NOT NULL,
    role             VARCHAR(10) NOT NULL CHECK (role IN ('ADMIN','ANALYST','VIEWER')),
    status           VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
    failed_attempts  INT NOT NULL DEFAULT 0,
    locked_until     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    transaction_id   VARCHAR(64) PRIMARY KEY,
    account_ref      VARCHAR(64) NOT NULL,
    amount           NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    tx_time          TIMESTAMPTZ NOT NULL,
    category         VARCHAR(50) NOT NULL,
    merchant         VARCHAR(120),
    lat              DOUBLE PRECISION,
    lon              DOUBLE PRECISION,
    merch_lat        DOUBLE PRECISION,
    merch_lon        DOUBLE PRECISION,
    customer_age     SMALLINT,
    ingested_at      TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tx_account_time ON transactions (account_ref, tx_time)`,
  `CREATE INDEX IF NOT EXISTS idx_tx_time ON transactions (tx_time DESC)`,
  `CREATE TABLE IF NOT EXISTS fraud_results (
    transaction_id    VARCHAR(64) PRIMARY KEY REFERENCES transactions(transaction_id),
    fraud_probability REAL NOT NULL,
    anomaly_score     REAL,
    is_anomaly        BOOLEAN NOT NULL DEFAULT false,
    risk_category     VARCHAR(12) NOT NULL CHECK (risk_category IN ('LEGITIMATE','SUSPICIOUS','HIGH_RISK')),
    top_reasons       JSONB NOT NULL DEFAULT '[]',
    features          JSONB NOT NULL DEFAULT '{}',
    model_version     VARCHAR(30) NOT NULL,
    scored_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fr_category ON fraud_results (risk_category)`,
  `CREATE INDEX IF NOT EXISTS idx_fr_scored ON fraud_results (scored_at DESC)`,
  `CREATE TABLE IF NOT EXISTS alerts (
    alert_id        SERIAL PRIMARY KEY,
    transaction_id  VARCHAR(64) UNIQUE NOT NULL REFERENCES transactions(transaction_id),
    risk_score      REAL NOT NULL,
    state           VARCHAR(15) NOT NULL DEFAULT 'NEW' CHECK (state IN ('NEW','UNDER_REVIEW','RESOLVED')),
    resolution      VARCHAR(15) CHECK (resolution IN ('CONFIRMED_FRAUD','FALSE_POSITIVE')),
    resolved_by     INT REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (state <> 'RESOLVED' OR resolution IS NOT NULL)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_state ON alerts (state, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    event_time  TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id     INT,
    username    VARCHAR(50),
    action      VARCHAR(40) NOT NULL,
    entity      VARCHAR(40),
    entity_id   VARCHAR(64),
    details     JSONB NOT NULL DEFAULT '{}',
    ip          TEXT,
    prev_hash   CHAR(64) NOT NULL,
    entry_hash  CHAR(64) NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs (event_time DESC)`,
  `CREATE TABLE IF NOT EXISTS model_versions (
    version        VARCHAR(30) PRIMARY KEY,
    algorithm      VARCHAR(60) NOT NULL,
    metrics        JSONB NOT NULL DEFAULT '{}',
    status         VARCHAR(12) NOT NULL CHECK (status IN ('CANDIDATE','VALIDATED','REJECTED','ACTIVE','RETIRED')),
    artifact_path  TEXT NOT NULL,
    sha256         CHAR(64) NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at   TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS drift_reports (
    id             SERIAL PRIMARY KEY,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    model_version  VARCHAR(30) NOT NULL,
    psi_score      REAL NOT NULL,
    psi_features   JSONB NOT NULL DEFAULT '{}',
    status         VARCHAR(8) NOT NULL CHECK (status IN ('OK','WARNING','DRIFT')),
    sample_size    INT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS service_heartbeats (
    service    VARCHAR(30) PRIMARY KEY,
    last_seen  TIMESTAMPTZ NOT NULL
  )`,
];

async function ensureSchema() {
  for (const stmt of SCHEMA_STATEMENTS) {
    await runQuery(stmt);
  }
}

if (require.main === module) {
  ensureSchema()
    .then(() => {
      console.log('Schema bootstrap completed successfully on Neon PostgreSQL.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Schema bootstrap failed:', err);
      process.exit(1);
    });
}

module.exports = { ensureSchema };
