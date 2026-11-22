// Verify the SHA-256 hash chain in PostgreSQL audit_logs (C6, CONTRACTS section 3).
const { query, pool } = require('../src/config/db');
const { computeEntryHash, GENESIS_HASH } = require('../src/audit/auditLogger');

function firstMismatch(rows) {
  let expectedPrev = GENESIS_HASH;
  for (const row of rows) {
    if (row.prev_hash.trim() !== expectedPrev) {
      return { id: row.id, field: 'prev_hash' };
    }
    const computed = computeEntryHash(
      expectedPrev, row.event_time.toISOString(), row.username, row.action,
      row.entity, row.entity_id, row.details
    );
    if (computed !== row.entry_hash.trim()) {
      return { id: row.id, field: 'entry_hash' };
    }
    expectedPrev = computed;
  }
  return null;
}

async function main() {
  try {
    const { rows } = await query(
      `SELECT id, event_time, username, action, entity, entity_id, details, prev_hash, entry_hash
       FROM audit_logs ORDER BY id ASC`
    );
    const mismatch = firstMismatch(rows);
    if (mismatch) {
      console.error(`[audit:verify] BROKEN CHAIN at id=${mismatch.id}: ${mismatch.field} mismatch`);
      return 1;
    }
    console.log(`[audit:verify] OK — verified ${rows.length} hash-chained audit rows.`);
    return 0;
  } catch (error) {
    console.error('[audit:verify] Read failed:', error.code || error.name);
    return 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error('[audit:verify] Failed:', error.code || error.name);
    process.exitCode = 1;
  });
}

module.exports = { main, firstMismatch };
