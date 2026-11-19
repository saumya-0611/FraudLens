
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('../audit/auditLogger', () => ({
  audit: jest.fn().mockResolvedValue(undefined),
}));

const { query } = require('../config/db');
const { signToken } = require('../utils/jwt');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const SECRET = 'fraudlens-test-only-secret-32-characters-long';

const users = {
  admin: {
    id: 1, username: 'admin', role: 'ADMIN', status: 'ACTIVE',
  },
  analyst: {
    id: 2, username: 'analyst', role: 'ANALYST', status: 'ACTIVE',
  },
  viewer: {
    id: 3, username: 'viewer', role: 'VIEWER', status: 'ACTIVE',
  },
};

const app = express();

app.use((req, res, next) => {
  req.id = 'r-c2test';
  next();
});

app.get(
  '/protected',
  authenticate,
  authorize('ADMIN', 'ANALYST', 'VIEWER'),
  (req, res) => res.json({ user: req.user })
);

app.get(
  '/admin',
  authenticate,
  authorize('ADMIN'),
  (req, res) => res.json({ success: true })
);

app.use((err, req, res, next) => {
  res.status(500).json({
    error: {
      code: 'SERVER_ERROR',
      message: 'Something went wrong on the server.',
      request_id: req.id,
    },
  });
});

function asUser(user) {
  return `fl_token=${signToken(user)}`;
}

beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_EXPIRES_IN = '2h';

  jest.clearAllMocks();
  query.mockReset();

  query.mockImplementation(async (_sql, params) => {
    const found = Object.values(users).find(
      (user) => user.id === params[0]
    );
    return { rows: found ? [{ ...found }] : [] };
  });
});

describe('C2 authentication and authorization', () => {
  test('missing cookie returns 401', async () => {
    const res = await request(app).get('/protected');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(query).not.toHaveBeenCalled();
  });

  test('invalid JWT returns 401', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Cookie', 'fl_token=invalid.jwt.token');

    expect(res.status).toBe(401);
  });

  test('active viewer can access permitted route', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Cookie', asUser(users.viewer));

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('VIEWER');
  });

  test('viewer cannot access admin route', async () => {
    const res = await request(app)
      .get('/admin')
      .set('Cookie', asUser(users.viewer));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('admin can access admin route', async () => {
    const res = await request(app)
      .get('/admin')
      .set('Cookie', asUser(users.admin));

    expect(res.status).toBe(200);
  });

  test('disabled user is denied access', async () => {
    query.mockResolvedValueOnce({
      rows: [{ ...users.admin, status: 'DISABLED' }],
    });

    const res = await request(app)
      .get('/admin')
      .set('Cookie', asUser(users.admin));

    expect(res.status).toBe(401);
  });

  test('deleted user is denied access', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/admin')
      .set('Cookie', asUser(users.admin));

    expect(res.status).toBe(401);
  });

  test('database role overrides old JWT role', async () => {
    query.mockResolvedValueOnce({
      rows: [{ ...users.admin, role: 'VIEWER' }],
    });

    const res = await request(app)
      .get('/admin')
      .set('Cookie', asUser(users.admin));

    expect(res.status).toBe(403);
  });

  test('database error is not treated as valid authentication', async () => {
    query.mockRejectedValueOnce(new Error('Database unavailable'));

    const res = await request(app)
      .get('/protected')
      .set('Cookie', asUser(users.admin));

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('SERVER_ERROR');
  });

  test('database lookup uses a parameterized query', async () => {
    await request(app)
      .get('/protected')
      .set('Cookie', asUser(users.viewer));

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1'),
      [users.viewer.id]
    );
  });
});
