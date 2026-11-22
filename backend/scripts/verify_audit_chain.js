// Verify the SHA-256 hash chain in PostgreSQL audit_logs (C6, CONTRACTS section 3).
const { query, pool } = require('../src/config/db');
const { computeEntryHash, GENESIS_HASH } = require('../src/audit/auditLogger');

async function main() {
  try {
    const res = await query(
      `SELECT id, event_time, username, action, entity, entity_id, details, prev_hash, entry_hash
       FROM audit_logs ORDER BY id ASC`
    );
    let expectedPrev = GENESIS_HASH;
    for (const row of res.rows) {
      const actualPrev = String(row.prev_hash || '').trim();
      if (actualPrev !== expectedPrev) {
        console.error(`[audit:verify] BROKEN CHAIN at id=${row.id}: prev_hash mismatch`);
        process.exitCode = 1;
        return;
      }
      const computed = computeEntryHash(
        expectedPrev, row.event_time.toISOString(), row.username, row.action,
        row.entity, row.entity_id, row.details
      );
      if (computed !== row.entry_hash.trim()) {
        console.error(`[audit:verify] BROKEN CHAIN at id=${row.id}: entry_hash mismatch`);
        process.exitCode = 1;
        return;
      }
      expectedPrev = computed;
    }
    console.log(`[audit:verify] OK — verified ${res.rows.length} hash-chained audit rows.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[audit:verify] Failed:', err.message);
  process.exit(1);
});
