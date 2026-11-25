const bcrypt = require('bcryptjs');

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

test('placeholder seed credentials are rejected before any account is inserted', async () => {
  process.env.SEED_ADMIN_PASSWORD = 'change_me';
  await expect(main()).rejects.toThrow('SEED_ADMIN_PASSWORD');
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

test('a repeated initialization preserves accounts created by the first run', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: ['admin', 'analyst', 'viewer'].map(username => ({ username })) });

  await seedUsers();
  await seedUsers();

  expect(pool.query).toHaveBeenCalledTimes(5);
  expect(pool.query.mock.calls[1][0]).toContain('ON CONFLICT (username) DO NOTHING');
  expect(pool.query.mock.calls[2][0]).toContain('ON CONFLICT (username) DO NOTHING');
  expect(pool.query.mock.calls[3][0]).toContain('ON CONFLICT (username) DO NOTHING');
});

test('a database error still closes the pool', async () => {
  pool.query.mockRejectedValue(new Error('DB unavailable'));
  await expect(main()).rejects.toThrow('DB unavailable');
  expect(pool.end).toHaveBeenCalledTimes(1);
});
