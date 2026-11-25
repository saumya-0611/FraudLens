const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');

const SEED_ACCOUNTS = [
  ['admin', 'ADMIN', 'SEED_ADMIN_PASSWORD'],
  ['analyst', 'ANALYST', 'SEED_ANALYST_PASSWORD'],
  ['viewer', 'VIEWER', 'SEED_VIEWER_PASSWORD'],
];

async function seedUsers() {
  const existingResult = await pool.query(
    'SELECT username FROM users WHERE username = ANY($1::text[])',
    [SEED_ACCOUNTS.map(([username]) => username)]
  );
  const existing = new Set((existingResult.rows || []).map((row) => row.username));
  const missing = SEED_ACCOUNTS.filter(([username]) => !existing.has(username));

  for (const [username, , key] of missing) {
    const password = process.env[key];
    if (typeof password !== 'string' || password.trim().length === 0 || /^change_me/i.test(password.trim())) {
      throw new Error(`${key} is required to create the ${username} seed account.`);
    }
  }

  for (const [username, role, key] of missing) {
    const hash = await bcrypt.hash(process.env[key], 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, role, status)
       VALUES ($1, $2, $3, 'ACTIVE')
       ON CONFLICT (username) DO NOTHING`,
      [username, hash, role]
    );
  }

  return { created: missing.length, skipped: existing.size };
}

async function main() {
  try {
    const result = await seedUsers();
    console.log(`[seed] Initialization complete (${result.created} created, ${result.skipped} existing).`);
    return result;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[seed] Failed:', error.code || error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, seedUsers };
