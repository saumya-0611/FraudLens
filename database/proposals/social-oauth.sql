-- PROPOSAL ONLY. Requires explicit approval before applying.
BEGIN;

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE oauth_identities (
  issuer TEXT COLLATE "C" NOT NULL,
  subject VARCHAR(255) COLLATE "C" NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject),
  UNIQUE (user_id, issuer)
);

CREATE TABLE oauth_attempts (
  state_hash CHAR(64) PRIMARY KEY,
  browser_hash CHAR(64) NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'linkedin')),
  nonce TEXT NOT NULL,
  code_verifier TEXT,
  link_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  link_session_hash CHAR(64),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '10 minutes'),
  CHECK ((link_user_id IS NULL) = (link_session_hash IS NULL))
);
CREATE INDEX idx_oauth_attempts_expiry ON oauth_attempts (expires_at);

COMMIT;
