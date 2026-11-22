jest.mock('../kafka/producer', () => ({
  publishTransaction: jest.fn().mockResolvedValue(undefined),
  disconnectProducer: jest.fn(),
}));

jest.mock('../config/db', () => require('./fixtures/session').mockDatabase(jest.fn()));

const request = require('supertest');
const app = require('../app');
const { publishTransaction } = require('../kafka/producer');
const { routeQuery: query } = require('../config/db');
const { sessionCookie } = require('./fixtures/session');
const SERVICE_TOKEN = 'fraudlens-test-only-service-token';
let cookie;

describe('Transaction Route Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SERVICE_TOKEN = SERVICE_TOKEN;
    cookie = sessionCookie('VIEWER');
  });

  test('POST /api/transactions publishes transaction and returns 202', async () => {
    const transaction = {
      transaction_id: 'tx-test-001',
      account_ref: 'account-123456',
      amount: 125.5,
      tx_time: '2026-11-18T14:00:00.000Z',
      category: 'retail',
    };

    const response = await request(app)
      .post('/api/transactions')
      .set('X-Service-Token', SERVICE_TOKEN)
      .send(transaction);

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      transaction_id: 'tx-test-001',
      status: 'ACCEPTED',
    });
    expect(response.body).not.toHaveProperty('account_ref');
    expect(JSON.stringify(response.body)).not.toContain('account-123456');

    expect(publishTransaction).toHaveBeenCalledWith(transaction);
  });

  test('GET /api/transactions returns paginated and masked transactions', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ total: '1' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          transaction_id: 'tx-test-003',
          account_ref: 'account-123456',
          amount: '250.00',
          category: 'retail',
          merchant: 'Test Store',
          tx_time: '2026-11-21T10:00:00.000Z',
          risk_category: 'PENDING',
          fraud_probability: null,
          is_anomaly: false,
          model_version: null,
          alert_id: null,
          alert_state: null,
          alert_resolution: null,
        }],
      });

    const response = await request(app)
      .get('/api/transactions?page=1&page_size=20').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.page).toBe(1);
    expect(response.body.page_size).toBe(20);
    expect(response.body.total).toBe(1);
    expect(response.body.items).toHaveLength(1);

    expect(response.body.items[0].account_masked).toBe('XXXX-3456');
    expect(response.body.items[0].risk_category).toBe('PENDING');
    expect(response.body.items[0].fraud_probability).toBeNull();
    expect(response.body.items[0]).not.toHaveProperty('account_ref');

    expect(query).toHaveBeenCalledTimes(2);
  });

  test('GET /api/transactions/:id returns transaction details with masked account', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        transaction_id: 'tx-test-004',
        account_ref: 'account-123456',
        amount: '500.00',
        category: 'retail',
        merchant: 'Test Store',
        tx_time: '2026-11-21T10:00:00.000Z',
        ingested_at: '2026-11-21T10:01:00.000Z',
        risk_category: 'HIGH_RISK',
        fraud_probability: 0.95,
        anomaly_score: 0.8,
        is_anomaly: true,
        top_reasons: ['Unusual transaction amount'],
        features: { amount: 500 },
        model_version: 'v1',
        scored_at: '2026-11-21T10:02:00.000Z',
        alert_id: 1,
        alert_state: 'NEW',
        alert_resolution: null,
        alert_created_at: '2026-11-21T10:02:00.000Z',
        alert_updated_at: '2026-11-21T10:02:00.000Z',
      }],
    });

    const response = await request(app)
      .get('/api/transactions/tx-test-004').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.transaction_id).toBe('tx-test-004');
    expect(response.body.account_masked).toBe('XXXX-3456');
    expect(response.body).not.toHaveProperty('account_ref');
    expect(response.body.risk_category).toBe('HIGH_RISK');
    expect(response.body.top_reasons).toEqual(['Unusual transaction amount']);
    expect(response.body.alert.state).toBe('NEW');
  });

  test('GET /api/transactions/:id returns 404 when transaction is missing', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .get('/api/transactions/unknown-transaction').set('Cookie', cookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
