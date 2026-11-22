
const express = require('express');
const request = require('supertest');

jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('../audit/auditLogger', () => ({
  audit: jest.fn().mockResolvedValue(undefined),
}));

// IMPORTANT:
// Do not mock express-rate-limit in this file.
// We want to test the real limiter.

const authRoutes = require('../routes/auth.routes');

const app = express();

app.use(express.json());

app.use((req, res, next) => {
  req.id = 'r-rate-test';
  next();
});

app.use('/api/auth', authRoutes);

describe('C3 login rate limiting', () => {
  test('11th login attempt within one minute returns 429', async () => {
    const statuses = [];

    for (let i = 0; i < 11; i += 1) {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'ab',
          password: 'invalid',
        });

      statuses.push(response.status);
    }

    // The first ten requests pass the rate limiter.
    // Route-level validation rejects their malformed usernames.
    expect(statuses.slice(0, 10)).toEqual(
      Array(10).fill(400)
    );

    // The eleventh request must be blocked by the limiter.
    expect(statuses[10]).toBe(429);
  });
});
