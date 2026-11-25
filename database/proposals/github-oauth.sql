-- PROPOSAL ONLY. Apply after social-oauth.sql with explicit database-owner approval.
BEGIN;

ALTER TABLE oauth_attempts
  DROP CONSTRAINT oauth_attempts_provider_check,
  ALTER COLUMN nonce DROP NOT NULL,
  ADD CONSTRAINT oauth_attempts_provider_protocol_check CHECK (
    (provider IN ('google', 'linkedin') AND nonce IS NOT NULL)
    OR (provider = 'github' AND nonce IS NULL
        AND code_verifier IS NOT NULL AND code_verifier ~ '^[A-Za-z0-9_-]{43}$')
  );

COMMIT;

-- Operational rollback: disable GitHub by clearing its three backend variables.
-- Keep this compatible constraint and retain users, attempts, sessions and identities.
