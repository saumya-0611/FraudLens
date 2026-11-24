const { randomBytes } = require('node:crypto');
const { pool, query } = require('../config/db');

async function ready() {
  const { rows: [row] } = await query(
    `SELECT to_regclass('oauth_identities') IS NOT NULL
        AND to_regclass('oauth_attempts') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM pg_attribute
          WHERE attrelid = to_regclass('users') AND attname = 'password_hash'
            AND NOT attnotnull AND NOT attisdropped
        ) AS ready`
  );
  return row?.ready === true;
}

async function saveAttempt(attempt) {
  await query('DELETE FROM oauth_attempts WHERE expires_at <= now()');
  await query(
    `INSERT INTO oauth_attempts
       (state_hash, browser_hash, provider, nonce, code_verifier, link_user_id, link_session_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [attempt.stateHash, attempt.browserHash, attempt.provider,
      attempt.nonce, attempt.verifier, attempt.linkUserId, attempt.linkSessionHash]
  );
}

async function consumeAttempt(stateHash, browserHash, provider) {
  const { rows: [attempt] } = await query(
    `DELETE FROM oauth_attempts
     WHERE state_hash = $1 AND browser_hash = $2 AND provider = $3 AND expires_at > now()
     RETURNING nonce, code_verifier, link_user_id, link_session_hash`,
    [stateHash, browserHash, provider]
  );
  return attempt;
}

async function resolveIdentity({ issuer, subject }, linkUserId = null) {
  const connection = await pool.connect();
  let discarded = false;
  try {
    await connection.query('BEGIN');
    const outcome = await findOrCreate(connection, issuer, subject, linkUserId);
    await connection.query('COMMIT');
    return outcome;
  } catch (error) {
    try {
      await connection.query('ROLLBACK');
    } catch (rollbackError) {
      discarded = true;
      connection.release(rollbackError);
      throw error;
    }
    throw error;
  } finally {
    // A failed rollback discards the connection before releasing it back to the pool.
    if (!discarded) connection.release();
  }
}

async function findOrCreate(connection, issuer, subject, linkUserId) {
  // Serialize the absent-row case across backend processes. The unique key is
  // the final backstop. Rollback also removes a new user if mapping fails.
  await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
    [JSON.stringify([issuer, subject])]);
  const { rows: [linked] } = await connection.query(
    `SELECT u.id, u.username, u.role, u.status FROM oauth_identities AS identity
     JOIN users AS u ON u.id = identity.user_id
     WHERE identity.issuer = $1 AND identity.subject = $2 FOR UPDATE OF u`,
    [issuer, subject]
  );
  if (linked) {
    if (linkUserId !== null && linked.id !== linkUserId) return { kind: 'conflict' };
    if (linked.status !== 'ACTIVE') return { kind: 'disabled' };
    return { kind: linkUserId === null ? 'login' : 'already_linked', user: linked };
  }

  if (linkUserId !== null) {
    const { rows: [user] } = await connection.query(
      'SELECT id, username, role, status FROM users WHERE id = $1 FOR UPDATE', [linkUserId]);
    if (user?.status !== 'ACTIVE') return { kind: 'disabled' };
    const result = await connection.query(
      'INSERT INTO oauth_identities (issuer, subject, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [issuer, subject, user.id]
    );
    return result.rowCount === 1 ? { kind: 'linked', user } : { kind: 'conflict' };
  }

  for (let retry = 0; retry < 3; retry += 1) {
    const username = 'social-' + randomBytes(16).toString('hex');
    const { rows: [user] } = await connection.query(
      `INSERT INTO users (username, password_hash, role, status)
       VALUES ($1, NULL, 'VIEWER', 'ACTIVE') ON CONFLICT (username) DO NOTHING
       RETURNING id, username, role, status`, [username]);
    if (!user) continue;
    await connection.query('INSERT INTO oauth_identities (issuer, subject, user_id) VALUES ($1, $2, $3)',
      [issuer, subject, user.id]);
    return { kind: 'registered', user };
  }
  throw new Error('Unable to allocate a social username.');
}

module.exports = { ready, saveAttempt, consumeAttempt, resolveIdentity };
