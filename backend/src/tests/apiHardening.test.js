const request = require('supertest');

jest.mock('../config/db', () => require('./fixtures/session').mockDatabase(jest.fn()));
jest.mock('../kafka/producer', () => ({ publishTransaction: jest.fn() }));

const app = require('../app');
const { hasServiceToken } = require('../middleware/serviceAuth');
const { publishTransaction } = require('../kafka/producer');

test('response has request ID and Helmet headers without the framework header', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.headers['x-request-id']).toMatch(/^r-/);
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-powered-by']).toBeUndefined();
  expect(res.headers['access-control-allow-origin']).toBeUndefined();
});

test.each(['cross-site', 'same-site'])('foreign browser writes are denied (%s)', async (site) => {
  const res = await request(app).post('/api/auth/logout').set('Sec-Fetch-Site', site);
  expect(res.status).toBe(403);
  expect(res.body.error.request_id).toBe(res.headers['x-request-id']);
});

test('invalid JSON and oversized requests produce safe contract errors', async () => {
  for (const [body, status] of [['{', 400], [JSON.stringify({ fixture: 'x'.repeat(103_000) }), 413]]) {
    const res = await request(app).post('/api/auth/login').type('json').send(body);
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: {
      code: 'VALIDATION_ERROR', message: expect.any(String), request_id: res.headers['x-request-id'],
    } });
  }
});

test.each([undefined, '', ' ', 'change_me_service_token'])('invalid token configuration is disabled (%s)', (value) => {
  if (value === undefined) delete process.env.SERVICE_TOKEN;
  else process.env.SERVICE_TOKEN = value;
  try {
    expect(hasServiceToken({ get: () => value })).toBe(false);
  } finally {
    delete process.env.SERVICE_TOKEN;
  }
});

test('verified ingestion service traffic is exempt from browser API quotas', async () => {
  process.env.SERVICE_TOKEN = 'phase-2-test-ingestion-token';
  try {
    const res = await request(app).post('/api/transactions')
      .set('X-Service-Token', process.env.SERVICE_TOKEN).send({
        transaction_id: 'fixture-tx', account_ref: 'fixture-account',
        amount: 50, category: 'retail', tx_time: '2026-11-23T12:00:00Z',
      });
    expect(res.status).toBe(202);
    expect(res.headers.ratelimit).toBeUndefined();
    expect(publishTransaction).toHaveBeenCalledTimes(1);
  } finally {
    delete process.env.SERVICE_TOKEN;
  }
});
