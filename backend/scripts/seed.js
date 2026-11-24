const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');

const seeds = [
  ['admin', 'ADMIN', 'SEED_ADMIN_PASSWORD'],
  ['analyst', 'ANALYST', 'SEED_ANALYST_PASSWORD'],
  ['viewer', 'VIEWER', 'SEED_VIEWER_PASSWORD'],
];

async function seedUsers() {
  const seeds = [
    ['admin', 'ADMIN', 'SEED_ADMIN_PASSWORD'],
    ['analyst', 'ANALYST', 'SEED_ANALYST_PASSWORD'],
    ['viewer', 'VIEWER', 'SEED_VIEWER_PASSWORD'],
  ];

  for (const [username, role, key] of seeds) {
    const password = process.env[key] || (key === 'SEED_ADMIN_PASSWORD' ? 'FlAdmin#2026!Secure' : key === 'SEED_ANALYST_PASSWORD' ? 'FlAnalyst#2026!Safe' : 'FlViewer#2026!Read');
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, role, status)
       VALUES ($1, $2, $3, 'ACTIVE')
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, status = 'ACTIVE'`,
      [username, hash, role]
    );
  }
}

async function main() {
  try {
    await seedUsers();
    console.log('[seed] Finished. Existing accounts were skipped.');
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
