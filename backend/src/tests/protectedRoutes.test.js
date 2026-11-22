const request = require('supertest');
const { sessionCookie } = require('./fixtures/session');

jest.mock('../config/db', () => require('./fixtures/session').mockDatabase(jest.fn()));
jest.mock('../kafka/producer', () => ({ publishTransaction: jest.fn() }));

const app = require('../app');
const { publishTransaction } = require('../kafka/producer');

const adminEndpoints = [
  ['get', '/api/users'],
  ['post', '/api/users'],
  ['patch', '/api/users/101'],
  ['get', '/api/audit-logs'],
  ['get', '/api/models'],
  ['post', '/api/models/drift-check'],
  ['post', '/api/models/retrain'],
  ['post', '/api/models/v1/activate'],
];

const alerts = [
  ['get', '/api/alerts'],
  ['patch', '/api/alerts/1'],
];

const ingestion = '/api/transactions';
const transaction = {
  transaction_id: 'tx-1',
  account_ref: 'test-account-0034',
  amount: 75,
  tx_time: '2026-11-20T03:12:45Z',
  category: 'retail',
};

beforeEach(() => {
  process.env.SERVICE_TOKEN = 'fraudlens-protected-routes-test-token';
  publishTransaction.mockClear();
});

test.each([
  ...adminEndpoints,
  ...alerts,
  ['get', '/api/auth/me'],
  ['post', '/api/auth/logout'],
  ['get', '/api/dashboard/summary'],
  ['get', '/api/dashboard/trends'],
  ['get', '/api/transactions'],
  ['get', '/api/transactions/tx-1'],
  ['post', ingestion],
])('%s %s denies requests without a session', async (method, url) => {
  const res = await request(app)[method](url);
  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe('UNAUTHENTICATED');
  expect(res.body.error.request_id).toBe(res.headers['x-request-id']);
});

describe.each(['VIEWER', 'ANALYST'])('%s access', (role) => {
  test.each([...adminEndpoints, ['post', ingestion]])('%s %s returns 403', async (method, url) => {
    const res = await request(app)[method](url).set('Cookie', sessionCookie(role));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

test.each(alerts)('VIEWER cannot %s %s', async (method, url) => {
  const res = await request(app)[method](url).set('Cookie', sessionCookie('VIEWER'));
  expect(res.status).toBe(403);
});

test('an invalid service token requires an authenticated ADMIN session', async () => {
  const post = () => request(app).post(ingestion)
    .set('X-Service-Token', 'invalid-token')
    .send(transaction);

  expect((await post()).status).toBe(401);
  expect(publishTransaction).not.toHaveBeenCalled();

  expect((await post().set('Cookie', sessionCookie('ADMIN'))).status).toBe(202);
  expect(publishTransaction).toHaveBeenCalledWith(transaction);
});

test('a service token requires a configured value', async () => {
  delete process.env.SERVICE_TOKEN;
  const res = await request(app).post(ingestion)
    .set('X-Service-Token', 'fraudlens-protected-routes-test-token')
    .send(transaction);
  expect(res.status).toBe(401);
  expect(publishTransaction).not.toHaveBeenCalled();
});

test('unexpected transaction fields and out-of-range coordinates fail validation', async () => {
  const res = await request(app).post(ingestion)
    .set('X-Service-Token', process.env.SERVICE_TOKEN)
    .send({ ...transaction, lat: 91, unexpected: 'secret-value' });
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  expect(res.body.error.fields).toEqual(expect.arrayContaining([
    expect.objectContaining({ field: 'body.lat' }),
  ]));
  expect(res.text).not.toContain('secret-value');
  expect(publishTransaction).not.toHaveBeenCalled();
});
