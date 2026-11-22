const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');

const seeds = [
  ['admin', 'ADMIN', 'SEED_ADMIN_PASSWORD'],
  ['analyst', 'ANALYST', 'SEED_ANALYST_PASSWORD'],
  ['viewer', 'VIEWER', 'SEED_VIEWER_PASSWORD'],
];

async function seedUsers() {
  const { rows } = await pool.query(
    'SELECT username FROM users WHERE username = ANY($1)',
    [seeds.map(([username]) => username)]
  );
  const existing = new Set(rows.map(({ username }) => username));
  const pending = seeds.filter(([username]) => !existing.has(username));
  const passwords = pending.map(([, , key]) => {
    const password = process.env[key];
    if (!password || password.trim().length < 10 || Buffer.byteLength(password) > 72 ||
        /^(?:change_me.*|(?:admin|analyst|viewer)123)$/i.test(password.trim())) {
      throw new Error(`${key} must be a unique, strong password of 10 characters or more and at most 72 bytes.`);
    }
    return password;
  });
  if (new Set(passwords).size !== passwords.length) {
    throw new Error('Each new seed account requires a distinct password.');
  }

  for (const [index, [username, role]] of pending.entries()) {
    const hash = await bcrypt.hash(passwords[index], 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, role, status)
       VALUES ($1, $2, $3, 'ACTIVE')
       ON CONFLICT (username) DO NOTHING`,
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

module.exports = { main };
