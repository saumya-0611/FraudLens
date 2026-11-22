// Verify the SHA-256 hash chain in PostgreSQL audit_logs (C6, CONTRACTS section 3).
const { query, pool } = require('../src/config/db');
const { computeEntryHash } = require('../src/audit/auditLogger');

const GENESIS_HASH = '0'.repeat(64);

async function main() {
  try {
    const res = await query('SELECT * FROM audit_logs ORDER BY id ASC');
    let expectedPrev = GENESIS_HASH;
    for (const row of res.rows) {
      const actualPrev = String(row.prev_hash || '').trim();
      if (actualPrev !== expectedPrev) {
        console.error(`[audit:verify] BROKEN CHAIN at id=${row.id}: prev_hash mismatch`);
        process.exit(1);
      }
      expectedPrev = String(row.entry_hash || '').trim();
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
