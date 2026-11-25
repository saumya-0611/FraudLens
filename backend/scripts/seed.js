const bcrypt = require('bcryptjs');
const { createHash } = require('node:crypto');
const { pool } = require('../src/config/db');

const seeds = [
  ['admin', 'ADMIN', 'SEED_ADMIN_PASSWORD'],
  ['analyst', 'ANALYST', 'SEED_ANALYST_PASSWORD'],
  ['viewer', 'VIEWER', 'SEED_VIEWER_PASSWORD'],
];

// Fingerprints of the publicly documented seed defaults, normalized to lowercase.
const exampleFingerprints = new Set([
  '5a606ef63cb423c8e6a9c3b6e2801ba4a722c9d96746af460ae697b0927c86ca',
  '92a5d24c419321115a822ff78b7f859f0e81e89772e82ff595b198e8c653f0a2',
  '167da08a4a0a254298e549cb4c24a2df354def7d59b14cc80815b439437526ed',
]);
const placeholder = /^(?:<?(?:change[\s_-]*me|replace[\s_-]*(?:me|with)|your[\s_-]+|example|placeholder|password|qwerty|letmein)|(?:admin|analyst|viewer)[\d!]+$)/i;

class SeedConfigurationError extends Error {}

function readSeedPassword(key) {
  const password = process.env[key] ?? '';
  const normalized = password.trim();
  const fingerprint = createHash('sha256').update(normalized.toLowerCase()).digest('hex');
  const characterClasses = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}\s]/u]
    .filter((pattern) => pattern.test(normalized)).length;
  if ([...normalized].length < 12 || Buffer.byteLength(password) > 72 ||
      /[\u0000-\u001f\u007f]/.test(password) || new Set(normalized).size < 8 ||
      (normalized.length < 20 && characterClasses < 3) ||
      placeholder.test(normalized) || exampleFingerprints.has(fingerprint)) {
    throw new SeedConfigurationError(
      `${key} must be explicitly set to a strong, non-example password with at least 12 characters and at most 72 UTF-8 bytes.`
    );
  }
  return password;
}

async function seedUsers() {
  const { rows } = await pool.query(
    'SELECT username FROM users WHERE username = ANY($1)',
    [seeds.map(([username]) => username)]
  );
  const existing = new Set(rows.map(({ username }) => username));
  const pending = seeds.filter(([username]) => !existing.has(username));
  const passwords = pending.map(([, , key]) => readSeedPassword(key));
  if (new Set(passwords.map((password) => password.trim())).size !== passwords.length) {
    throw new SeedConfigurationError('Each new seed account requires a distinct password.');
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
    console.error('[seed] Failed:', error instanceof SeedConfigurationError
      ? error.message : 'Account provisioning failed.');
    process.exitCode = 1;
  });
}

module.exports = { main, seedUsers, SeedConfigurationError };
