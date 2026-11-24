const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const path = require('node:path');

jest.mock('../config/db', () => ({ pool: { query: jest.fn(), end: jest.fn() } }));

const { pool } = require('../config/db');
const { main, seedUsers } = require('../../scripts/seed');

const keys = ['SEED_ADMIN_PASSWORD', 'SEED_ANALYST_PASSWORD', 'SEED_VIEWER_PASSWORD'];
const passwords = ['Fixture-Admin-Only7', 'Fixture-Analyst-Only8', 'Fixture-Viewer-Only9'];

beforeEach(() => {
  jest.resetAllMocks();
  keys.forEach((key, i) => { process.env[key] = passwords[i]; });
  pool.query.mockResolvedValue({ rows: [] });
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  keys.forEach((key) => { delete process.env[key]; });
  jest.restoreAllMocks();
});

test('seeds three roles with bcrypt cost 10 and a no-overwrite insert', async () => {
  await main();
  expect(pool.query).toHaveBeenCalledTimes(4);
  for (const [i, role] of ['ADMIN', 'ANALYST', 'VIEWER'].entries()) {
    const [sql, [username, hash, insertedRole]] = pool.query.mock.calls[i + 1];
    expect(username).toBe(role.toLowerCase());
    expect(insertedRole).toBe(role);
    expect(sql).toContain('ON CONFLICT (username) DO NOTHING');
    expect(bcrypt.getRounds(hash)).toBe(10);
    expect(await bcrypt.compare(passwords[i], hash)).toBe(true);
  }
  expect(JSON.stringify(console.log.mock.calls)).not.toContain(passwords[0]);
  expect(pool.end).toHaveBeenCalledTimes(1);
});

test('missing required configuration prevents all inserts and closes the pool', async () => {
  delete process.env.SEED_ANALYST_PASSWORD;
  await expect(main()).rejects.toThrow('SEED_ANALYST_PASSWORD');
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(pool.end).toHaveBeenCalledTimes(1);
});

test('existing users are skipped without requiring their passwords', async () => {
  keys.forEach((key) => { delete process.env[key]; });
  pool.query.mockResolvedValue({
    rows: ['admin', 'analyst', 'viewer'].map((username) => ({ username })),
  });
  await main();
  expect(pool.query).toHaveBeenCalledTimes(1);
});

test('a database error still closes the pool', async () => {
  pool.query.mockRejectedValue(new Error('DB unavailable'));
  await expect(main()).rejects.toThrow('DB unavailable');
  expect(pool.end).toHaveBeenCalledTimes(1);
});

test.each([
  ['empty', () => ''],
  ['whitespace', () => '   '],
  ['placeholder', () => 'REPLACE_WITH_STRONG_ANALYST_PASSWORD'],
  ['weak', () => 'AAAAAAAAAAA1!'],
  ['over bcrypt byte limit', () => 'é'.repeat(37)],
  ['documented default', () => {
    const example = fs.readFileSync(path.resolve(__dirname, '../../../.env.example'), 'utf8');
    return /^SEED_ANALYST_PASSWORD=(.+)$/m.exec(example)[1];
  }],
])('rejects a missing account password that is %s before any inserts', async (_label, value) => {
  process.env.SEED_ANALYST_PASSWORD = value();
  await expect(main()).rejects.toThrow('SEED_ANALYST_PASSWORD');
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(pool.end).toHaveBeenCalledTimes(1);
});

test('rejects reuse across new seed accounts before any inserts', async () => {
  process.env.SEED_VIEWER_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
  await expect(main()).rejects.toThrow('distinct password');
  expect(pool.query).toHaveBeenCalledTimes(1);
});

function modelAccounts(initialRows = []) {
  const accounts = new Map(initialRows.map((row) => [row.username, row]));
  const insertAttempts = [];
  pool.query.mockImplementation(async (sql, [usernamesOrName, passwordHash, role]) => {
    if (sql.startsWith('SELECT username')) {
      return { rows: usernamesOrName.filter((name) => accounts.has(name)).map((username) => ({ username })) };
    }
    expect(sql).toContain('ON CONFLICT (username) DO NOTHING');
    const username = usernamesOrName;
    insertAttempts.push(username);
    if (!accounts.has(username)) accounts.set(username, { username, password_hash: passwordHash, role });
    return { rows: [] };
  });
  return { accounts, insertAttempts };
}

test('leaves disabled, reassigned, and social-only seed usernames unchanged', async () => {
  const rows = [
    { username: 'admin', role: 'ADMIN', status: 'DISABLED', password_hash: 'fixture-admin-hash', failed_attempts: 3 },
    { username: 'analyst', role: 'VIEWER', status: 'ACTIVE', password_hash: 'fixture-analyst-hash' },
    { username: 'viewer', role: 'VIEWER', status: 'ACTIVE', password_hash: null },
  ];
  const { accounts, insertAttempts } = modelAccounts(rows);
  keys.forEach((key) => { delete process.env[key]; });
  await seedUsers();
  expect([...accounts.values()]).toEqual(rows);
  expect(insertAttempts).toEqual([]);
  expect(pool.end).not.toHaveBeenCalled();
});

test('a second run skips all accounts without needing the original credentials', async () => {
  const { accounts, insertAttempts } = modelAccounts();
  await seedUsers();
  const afterFirstRun = [...accounts.values()];
  keys.forEach((key) => { delete process.env[key]; });
  await seedUsers();
  expect(afterFirstRun).toHaveLength(3);
  expect([...accounts.values()]).toEqual(afterFirstRun);
  expect(insertAttempts).toEqual(['admin', 'analyst', 'viewer']);
});

test('concurrent reads of initially missing accounts leave one insert winner per username', async () => {
  const { accounts, insertAttempts } = modelAccounts();
  await Promise.all([seedUsers(), seedUsers()]);
  expect(pool.query.mock.calls.slice(0, 2).every(([sql]) => sql.startsWith('SELECT username'))).toBe(true);
  expect(insertAttempts.sort()).toEqual(['admin', 'admin', 'analyst', 'analyst', 'viewer', 'viewer']);
  expect(accounts.size).toBe(3);
});

test('an insert failure propagates and closes the CLI pool', async () => {
  pool.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('insert failed'));
  await expect(main()).rejects.toThrow('insert failed');
  expect(pool.query).toHaveBeenCalledTimes(2);
  expect(pool.end).toHaveBeenCalledTimes(1);
});
