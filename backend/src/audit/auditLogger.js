// Hash-chained audit logger writing to PostgreSQL audit_logs (CONTRACTS section 3).
// Holds pg_advisory_xact_lock(42) inside a transaction so the chain never forks,
// and catches errors so audit logging never crashes a user request.
const crypto = require('crypto');
const { pool } = require('../config/db');

const GENESIS_HASH = '0'.repeat(64);

function computeEntryHash(prevHash, eventTimeIso, username, action, entity, entityId, details) {
  const payload =
    String(prevHash || GENESIS_HASH) +
    String(eventTimeIso || '') +
    String(username || '') +
    String(action || '') +
    String(entity || '') +
    String(entityId || '') +
    JSON.stringify(details || {});
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

async function audit(entry = {}) {
  const action = entry.action || 'UNKNOWN_ACTION';
  if (!pool || typeof pool.connect !== 'function') {
    return;
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(42)');

    const lastRes = await client.query(
      'SELECT entry_hash FROM audit_logs ORDER BY id DESC LIMIT 1'
    );
    const prevHash = lastRes.rows[0]?.entry_hash
      ? String(lastRes.rows[0].entry_hash).trim()
      : GENESIS_HASH;

    const eventTimeIso = new Date().toISOString();
    const userId =
      Number.isInteger(entry.userId) && entry.userId > 0 ? entry.userId : null;
    const username = entry.username || entry.req?.user?.username || 'system';
    const entity = entry.entity || null;
    const entityId = entry.entityId != null ? String(entry.entityId) : null;
    const details = entry.details || {};
    const ip =
      entry.req?.headers?.['x-forwarded-for'] ||
      entry.req?.socket?.remoteAddress ||
      null;

    const entryHash = computeEntryHash(
      prevHash,
      eventTimeIso,
      username,
      action,
      entity,
      entityId,
      details
    );

    await client.query(
      `INSERT INTO audit_logs (
         event_time, user_id, username, action, entity, entity_id, details, ip, prev_hash, entry_hash
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
      [
        eventTimeIso,
        userId,
        username,
        action,
        entity,
        entityId,
        JSON.stringify(details),
        ip,
        prevHash,
        entryHash,
      ]
    );
    await client.query('COMMIT');
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback error
      }
    }
    console.log('[AUDIT]', action, err.message);
  } finally {
    if (client) client.release();
  }
}

module.exports = { audit, computeEntryHash };
