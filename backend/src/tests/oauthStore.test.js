jest.mock('../config/db', () => ({ pool: { connect: jest.fn() }, query: jest.fn() }));

const { pool, query } = require('../config/db');
const { consumeAttempt, resolveIdentity } = require('../auth/oauthStore');

beforeEach(() => jest.resetAllMocks());

test('a single statement consumes state using browser proof, provider and DB expiry', async () => {
  query.mockResolvedValue({ rows: [{ nonce: 'fixture' }] });
  expect(await consumeAttempt('state-hash', 'browser-hash', 'google')).toEqual({ nonce: 'fixture' });
  expect(query).toHaveBeenCalledWith(
    expect.stringMatching(/DELETE FROM oauth_attempts[\s\S]+browser_hash = \$2 AND provider = \$3 AND expires_at > now\(\)[\s\S]+RETURNING/),
    ['state-hash', 'browser-hash', 'google']
  );
});

test('independent registrations serialize by issuer and subject and cannot create duplicate users', async () => {
  const identities = new Map();
  const pendingLocks = new Map();
  let inserts = 0;
  pool.connect.mockImplementation(async () => {
    let unlock;
    let row;
    return {
      release: jest.fn(),
      query: async (sql, input) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          const key = input[0];
          const previous = pendingLocks.get(key);
          pendingLocks.set(key, new Promise((resolve) => { unlock = resolve; }));
          await previous;
        } else if (sql.includes('FROM oauth_identities')) {
          const found = identities.get(JSON.stringify(input));
          return { rows: found ? [found] : [] };
        } else if (sql.includes('INSERT INTO users')) {
          expect(sql).toContain("VALUES ($1, NULL, 'VIEWER', 'ACTIVE')");
          expect(input[0]).toMatch(/^social-[a-f0-9]{32}$/);
          row = { id: ++inserts, username: input[0], role: 'VIEWER', status: 'ACTIVE' };
          return { rows: [row] };
        } else if (sql.includes('INSERT INTO oauth_identities')) {
          expect(input[2]).toBe(row.id);
          identities.set(JSON.stringify(input.slice(0, 2)), row);
        } else if (sql === 'COMMIT') {
          unlock();
        }
        return { rows: [] };
      },
    };
  });
  const identity = { issuer: 'https://one.test', subject: 'same-subject' };
  const pair = await Promise.all([resolveIdentity(identity), resolveIdentity(identity)]);
  expect(pair.map(({ kind }) => kind).sort()).toEqual(['login', 'registered']);
  expect(pair[0].user.id).toBe(pair[1].user.id);
  const other = await resolveIdentity({ ...identity, issuer: 'https://two.test' });
  expect(other.kind).toBe('registered');
  expect(other.user.id).not.toBe(pair[0].user.id);
  expect(inserts).toBe(2);
});

test('a mapping error rolls back the new user and releases the connection', async () => {
  const connection = { query: jest.fn(), release: jest.fn() };
  pool.connect.mockResolvedValue(connection);
  connection.query.mockResolvedValueOnce({}).mockResolvedValueOnce({})
    .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 1 }] })
    .mockRejectedValueOnce(new Error('mapping failure')).mockResolvedValueOnce({});
  await expect(resolveIdentity({ issuer: 'issuer', subject: 'subject' })).rejects.toThrow('mapping failure');
  expect(connection.query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(connection.release).toHaveBeenCalledTimes(1);
});

test('a provider already linked to another local account stays with that account', async () => {
  const connection = { query: jest.fn(), release: jest.fn() };
  pool.connect.mockResolvedValue(connection);
  connection.query.mockResolvedValueOnce({}).mockResolvedValueOnce({})
    .mockResolvedValueOnce({ rows: [{ id: 1, status: 'ACTIVE', role: 'ADMIN' }] }).mockResolvedValueOnce({});
  expect(await resolveIdentity({ issuer: 'issuer', subject: 'subject' }, 2)).toEqual({ kind: 'conflict' });
  expect(connection.query).toHaveBeenCalledTimes(4);
});
