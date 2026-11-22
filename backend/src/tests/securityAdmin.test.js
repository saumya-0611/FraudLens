const request = require('supertest');
const bcrypt = require('bcryptjs');
const { sessionCookie, users } = require('./fixtures/session');

jest.mock('../config/db', () => require('./fixtures/session').mockDatabase(jest.fn()));
jest.mock('../audit/auditLogger', () => ({ audit: jest.fn() }));
jest.mock('../kafka/producer', () => ({ publishTransaction: jest.fn() }));

const app = require('../app');
const { routeQuery } = require('../config/db');
const { audit } = require('../audit/auditLogger');
const password = 'fixture-only-password';
const admin = () => request.agent(app).set('Cookie', sessionCookie('ADMIN'));

beforeEach(() => jest.resetAllMocks());

test('audit log filters and paging use bound values, with hashes omitted by default', async () => {
  routeQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] })
    .mockResolvedValueOnce({ rows: [{ id: '10', action: 'USER_UPDATED' }] });
  const res = await admin().get('/api/audit-logs')
    .query({ action: 'USER_UPDATED', username: 'test-admin', page: 2, page_size: 5 });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ items: [{ id: '10', action: 'USER_UPDATED' }], page: 2, page_size: 5, total: 1 });
  expect(routeQuery.mock.calls[1][0]).not.toMatch(/prev_hash|entry_hash/);
  expect(routeQuery.mock.calls[1][1]).toEqual(['USER_UPDATED', 'test-admin', 5, 5]);
});

test('audit hashes are selected only when explicitly requested', async () => {
  routeQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] })
    .mockResolvedValueOnce({ rows: [{ id: '10', prev_hash: 'a', entry_hash: 'b' }] });
  const res = await admin().get('/api/audit-logs?include_hash=true');
  expect(res.status).toBe(200);
  expect(routeQuery.mock.calls[1][0]).toMatch(/prev_hash, entry_hash/);
  expect(res.body.items[0]).toEqual({ id: '10', prev_hash: 'a', entry_hash: 'b' });
});

test.each(['page=0', 'page_size=101', 'include_hash=1', 'username[]=test-user', 'action[]=LOGIN_SUCCESS'])(
  'audit log rejects malformed filters (%s) before querying history',
  async (query) => {
    const res = await admin().get('/api/audit-logs?' + query);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(routeQuery).not.toHaveBeenCalled();
  }
);

test('user creation binds a bcrypt hash and audits the public fields', async () => {
  const body = { username: 'new-user', password, role: 'VIEWER' };
  routeQuery.mockResolvedValue({ rows: [{ id: 9, username: body.username, role: body.role, status: 'ACTIVE' }] });
  const res = await admin().post('/api/users').send(body);
  expect(res.status).toBe(201);
  expect(res.text).not.toContain(password);
  const [sql, [username, hash, role]] = routeQuery.mock.calls[0];
  expect(sql).toMatch(/VALUES \(\$1, \$2, \$3/);
  expect(username).toBe(body.username);
  expect(role).toBe(body.role);
  expect(await bcrypt.compare(password, hash)).toBe(true);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'USER_CREATED', details: { username: body.username, role },
  }));
});

test('user listing projects public columns and duplicate users return 409', async () => {
  routeQuery.mockResolvedValueOnce({ rows: [{ id: 9, username: 'existing-user', status: 'ACTIVE' }] })
    .mockRejectedValueOnce({ code: '23505' });
  expect((await admin().get('/api/users')).status).toBe(200);
  expect(routeQuery.mock.calls[0][0]).not.toContain('password_hash');
  const res = await admin().post('/api/users').send({ username: 'existing-user', password, role: 'VIEWER' });
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('CONFLICT');
});

test('administrators cannot demote or disable their own account', async () => {
  const { id } = users.find(({ role }) => role === 'ADMIN');
  for (const change of [{ role: 'VIEWER' }, { status: 'DISABLED' }]) {
    const res = await admin().patch('/api/users/' + id).send(change);
    expect(res.status).toBe(409);
  }
  expect(routeQuery).not.toHaveBeenCalled();
});

test('password updates reset lockout fields and emit an audit event', async () => {
  routeQuery.mockResolvedValue({ rows: [{ id: 9, role: 'VIEWER', status: 'ACTIVE' }] });
  const res = await admin().patch('/api/users/9').send({ password });
  expect(res.status).toBe(200);
  const [sql, params] = routeQuery.mock.calls[0];
  expect(sql).toMatch(/failed_attempts[\s\S]+locked_until/);
  expect(await bcrypt.compare(password, params[2])).toBe(true);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_UPDATED', entityId: '9' }));
});

test('protected fields and invalid values are rejected before writing', async () => {
  const res = await admin().post('/api/users').send({
    username: 'new-user', password, role: 'VIEWER', failed_attempts: 0,
  });
  expect(res.status).toBe(400);
  expect(res.text).not.toContain(password);
  expect(routeQuery).not.toHaveBeenCalled();
});
