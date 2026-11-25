
const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { createHash } = require('node:crypto');

jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('../audit/auditLogger', () => ({
  audit: jest.fn().mockResolvedValue(undefined),
}));
// Bypass IP rate limiting in route unit tests.
// The production limiter remains active and will be tested separately.
jest.mock('express-rate-limit', () => {
  return jest.fn(() => (req, res, next) => next());
});

const { query } = require('../config/db');
const authRoutes = require('../routes/auth.routes');
const { signToken } = require('../utils/jwt');
const { audit } = require('../audit/auditLogger');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.id = 'r-c3test';
  next();
});
app.use('/api/auth', authRoutes);
app.use((err, req, res, next) => {
  res.status(500).json({
    error: {
      code: 'SERVER_ERROR',
      message: 'Internal server error.',
      request_id: req.id,
    },
  });
});

const SECRET = 'fraudlens-test-only-secret-32-characters-long';
const PASSWORD = 'ValidPassword123!';

let user;

beforeAll(async () => {
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_EXPIRES_IN = '2h';
  process.env.COOKIE_SECURE = 'false';

  user = {
    id: 5,
    username: 'testuser',
    password_hash: await bcrypt.hash(PASSWORD, 4),
    role: 'ANALYST',
    status: 'ACTIVE',
    failed_attempts: 0,
    locked_until: null,
  };
});

beforeEach(() => {
  user.failed_attempts = 0;
  user.locked_until = null;
  user.status = 'ACTIVE';

  jest.clearAllMocks();
  query.mockReset();

  query.mockImplementation(async (sql, params) => {
    if (sql.includes('WHERE username = $1')) {
      return {
        rows: params[0] === user.username ? [{ ...user }] : [],
      };
    }

      if (
          sql.includes('SET failed_attempts =') &&
          !sql.includes('SET failed_attempts = 0')
          ) {
      if (user.locked_until && user.locked_until > new Date()) {
        return { rows: [], rowCount: 0 };
      }

      if (user.locked_until) {
        user.failed_attempts = 0;
      }

      user.failed_attempts += 1;

      if (user.failed_attempts >= 5) {
        user.locked_until = new Date(Date.now() + 15 * 60 * 1000);
      }

      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('SET failed_attempts = 0')) {
      if (user.status !== 'ACTIVE' ||
          (user.locked_until && user.locked_until > new Date())) {
        return { rows: [] };
      }

      user.failed_attempts = 0;
      user.locked_until = null;

      return {
        rows: [{
          id: user.id,
          username: user.username,
          role: user.role,
        }],
      };
    }

    if (sql.includes('WHERE id = $1')) {
      return { rows: [{ ...user }] };
    }

    return { rows: [] };
  });
});

describe('C3 authentication routes', () => {
  test('valid login returns 200 and httpOnly cookie', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('testuser');
    expect(res.body.role).toBe('ANALYST');
    expect(res.body.expires_in).toBeGreaterThan(0);
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(res.headers['set-cookie'][0]).toMatch(/SameSite=Lax/);
    expect(res.body).not.toHaveProperty('token');
  });

  test('the HTTPS configuration adds Secure and uses the configured JWT lifetime', async () => {
    const originalSecure = process.env.COOKIE_SECURE;
    const originalExpiry = process.env.JWT_EXPIRES_IN;
    process.env.COOKIE_SECURE = 'true';
    process.env.JWT_EXPIRES_IN = '5m';
    try {
      const res = await request(app).post('/api/auth/login')
        .send({ username: 'testuser', password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.expires_in).toBe(300);
      expect(res.headers['set-cookie'][0]).toMatch(/; Secure(?:;|$)/);
      expect(res.headers['set-cookie'][0]).toMatch(/; Max-Age=300(?:;|$)/);
    } finally {
      process.env.COOKIE_SECURE = originalSecure;
      process.env.JWT_EXPIRES_IN = originalExpiry;
    }
  });

  test('wrong password returns generic 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(user.failed_attempts).toBe(1);
  });

  test('a matching legacy SHA-256 password is rejected', async () => {
    const bcryptHash = user.password_hash;
    user.password_hash = createHash('sha256').update(`fraudlens:${PASSWORD}`).digest('hex');
    try {
      const res = await request(app).post('/api/auth/login')
        .send({ username: user.username, password: PASSWORD });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(res.headers['set-cookie']).toBeUndefined();
    } finally {
      user.password_hash = bcryptHash;
    }
  });

  test('unknown username receives same generic response', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'unknownuser', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.error.message).toBe('Invalid username or password.');
  });

  test('five failed attempts lock the account', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'wrong' });

      expect(res.status).toBe(401);
    }

    expect(user.failed_attempts).toBe(5);
    expect(user.locked_until).toBeInstanceOf(Date);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: PASSWORD });

    expect(res.status).toBe(401);
  });

  test('successful login resets failed attempts', async () => {
    user.failed_attempts = 3;

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(user.failed_attempts).toBe(0);
  });

  test('disabled account cannot login', async () => {
    user.status = 'DISABLED';

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: PASSWORD });

    expect(res.status).toBe(401);
  });

  test('malformed login input returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'ab', password: PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('GET /me returns current user', async () => {
    const token = signToken(user);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `fl_token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      username: 'testuser',
      role: 'ANALYST',
    });
  });

  test('GET /me returns a session display name without changing the local username or role', async () => {
    const token = signToken({ ...user, display_name: '  Test\n  Person\u202e  ' });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `fl_token=${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      username: 'testuser',
      role: 'ANALYST',
      display_name: 'Test Person',
    });
  });

  test('logout clears cookie and returns 204', async () => {
    const token = signToken(user);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `fl_token=${token}`);

    expect(res.status).toBe(204);
    expect(res.headers['set-cookie'][0]).toMatch(/fl_token=/);
    expect(res.headers['set-cookie'][0]).toMatch(/Expires=/);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LOGOUT' })
    );
  });

  test('unauthenticated GET /me returns 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});
