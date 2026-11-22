const { createHash } = require('node:crypto');

jest.mock('../config/db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn(), end: jest.fn() },
}));

const { audit, GENESIS_HASH, computeEntryHash } = require('../audit/auditLogger');
const { firstMismatch, main } = require('../../scripts/verify_audit_chain');
const { query, pool } = require('../config/db');
let client;

beforeEach(() => {
  jest.resetAllMocks();
  client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
  pool.connect.mockResolvedValue(client);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

function row(id, previous, details = { state: 'NEW' }) {
  const event_time = new Date('2026-11-23T00:00:00Z');
  const action = 'ALERT_RAISED';
  return {
    id, event_time, action, username: 'system', entity: 'alert', entity_id: '21',
    details, prev_hash: previous,
    entry_hash: computeEntryHash(previous, event_time.toISOString(), 'system', action, 'alert', '21', details),
  };
}

test('the first write locks before reading the chain and hashes the exact contract fields', async () => {
  await audit({
    action: 'ALERT_RAISED', username: 'system', entity: 'alert', entityId: '21',
    details: { z: 1, a: { state: 'NEW', password: 'fixture', account_ref: 'fixture' } },
    req: { ip: '127.0.0.1', headers: { 'x-forwarded-for': '192.0.2.1' } },
  });
  const [[begin], [lock], [read], [insert, params], [commit]] = client.query.mock.calls;
  expect(begin).toBe('BEGIN');
  expect(lock).toBe('SELECT pg_advisory_xact_lock(42)');
  expect(read).toMatch(/ORDER BY id DESC/);
  expect(insert).toMatch(/INSERT INTO audit_logs/);
  expect(commit).toBe('COMMIT');
  const [timestamp, , username, action, entity, id, details, ip, previous, hash] = params;
  expect(JSON.parse(details)).toEqual({ z: 1, a: { state: 'NEW' } });
  expect(ip).toBe('127.0.0.1');
  expect(previous).toBe('0'.repeat(64));
  expect(hash).toBe(createHash('sha256').update(
    previous + timestamp + username + action + entity + id + '{"a":{"state":"NEW"},"z":1}'
  ).digest('hex'));
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('a failed write rolls back, releases the client, and records a safe error', async () => {
  client.query.mockImplementation(async (sql) => {
    if (sql.startsWith('INSERT')) throw Object.assign(new Error('sensitive DB detail'), { code: '23514' });
    return { rows: [] };
  });
  await expect(audit({ action: 'USER_UPDATED' })).resolves.toBeUndefined();
  expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(client.release).toHaveBeenCalledTimes(1);
  expect(console.error).toHaveBeenCalledWith('[AUDIT] Write failed:', 'USER_UPDATED', '23514');
});

test('the writer links a new event to the previous hash', async () => {
  const prior = row(1, GENESIS_HASH);
  client.query.mockImplementation(async (sql) => ({
    rows: sql.startsWith('SELECT entry_hash') ? [{ entry_hash: prior.entry_hash }] : [],
  }));
  await audit({ action: 'LOGIN_SUCCESS' });
  expect(client.query.mock.calls[3][1][8]).toBe(prior.entry_hash);
});

test('verifier accepts chained rows and returns success for the CLI', async () => {
  const first = row(1, GENESIS_HASH, { z: 1, a: 2 });
  const second = row(2, first.entry_hash);
  query.mockResolvedValue({ rows: [{ ...first, details: { a: 2, z: 1 } }, second] });
  await expect(main()).resolves.toBe(0);
  expect(pool.end).toHaveBeenCalled();
});

test('verifier rejects invalid stored content and returns a failure for the CLI', async () => {
  const first = row(1, GENESIS_HASH);
  query.mockResolvedValue({ rows: [{ ...first, details: { state: 'RESOLVED' } }] });
  await expect(main()).resolves.toBe(1);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('id=1: entry_hash mismatch'));
});

test('verifier rejects broken links and missing interior records', () => {
  const first = row(1, GENESIS_HASH);
  const second = row(2, first.entry_hash);
  const third = row(3, second.entry_hash);
  expect(firstMismatch([first, third])).toEqual({ id: 3, field: 'prev_hash' });
  expect(firstMismatch([third, second, first])).toEqual({ id: 3, field: 'prev_hash' });
});
