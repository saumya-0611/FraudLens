// Seed default FraudLens users (admin, analyst, viewer) into PostgreSQL (C4).
const { ensureSeedUsers } = require('../src/routes/auth.routes');
const { pool } = require('../src/config/db');

async function main() {
  try {
    await ensureSeedUsers();
    console.log('[seed] Default users (admin, analyst, viewer) seeded successfully.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[seed] Failed:', err.message);
  process.exit(1);
});
