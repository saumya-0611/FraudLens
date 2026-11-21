jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

const request = require('supertest');
const app = require('../app');
const { query } = require('../config/db');

describe('Alerts Route Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/alerts returns paginated alerts', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ total: '1' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          alert_id: 1,
          transaction_id: 'tx-alert-001',
          risk_score: 0.95,
          state: 'NEW',
          resolution: null,
          resolved_by: null,
          created_at: '2026-11-21T10:00:00.000Z',
          updated_at: '2026-11-21T10:00:00.000Z',
          account_ref: 'account-123456',
          amount: '500.00',
          category: 'retail',
          merchant: 'Test Store',
          tx_time: '2026-11-21T09:00:00.000Z',
        }],
      });

    const response = await request(app)
      .get('/api/alerts?page=1&page_size=20');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.page).toBe(1);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].alert_id).toBe(1);
    expect(response.body.items[0].account_masked).toBe('XXXX-3456');
    expect(response.body.items[0]).not.toHaveProperty('account_ref');
    expect(query).toHaveBeenCalledTimes(2);
  });

  test('PATCH /api/alerts/:id moves NEW alert to UNDER_REVIEW', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ alert_id: 1, state: 'NEW' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          alert_id: 1,
          transaction_id: 'tx-alert-001',
          risk_score: 0.95,
          state: 'UNDER_REVIEW',
          resolution: null,
          resolved_by: null,
        }],
      });

    const response = await request(app)
      .patch('/api/alerts/1')
      .send({ state: 'UNDER_REVIEW' });

    expect(response.status).toBe(200);
    expect(response.body.state).toBe('UNDER_REVIEW');
    expect(response.body).not.toHaveProperty('account_ref');
    expect(query).toHaveBeenCalledTimes(2);
  });

  test('PATCH /api/alerts/:id resolves alert with valid resolution', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ alert_id: 1, state: 'NEW' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          alert_id: 1,
          transaction_id: 'tx-alert-001',
          risk_score: 0.95,
          state: 'RESOLVED',
          resolution: 'CONFIRMED_FRAUD',
          resolved_by: 0,
        }],
      });

    const response = await request(app)
      .patch('/api/alerts/1')
      .send({
        state: 'RESOLVED',
        resolution: 'CONFIRMED_FRAUD',
      });

    expect(response.status).toBe(200);
    expect(response.body.state).toBe('RESOLVED');
    expect(response.body.resolution).toBe('CONFIRMED_FRAUD');
    expect(response.body).not.toHaveProperty('account_ref');
  });

  test('PATCH /api/alerts/:id rejects an already resolved alert', async () => {
    query.mockResolvedValueOnce({
      rows: [{ alert_id: 1, state: 'RESOLVED' }],
    });

    const response = await request(app)
      .patch('/api/alerts/1')
      .send({
        state: 'UNDER_REVIEW',
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('PATCH /api/alerts/:id response never leaks raw account_ref (B7 regression)', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ alert_id: 2, state: 'NEW' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          alert_id: 2,
          transaction_id: 'tx-alert-002',
          risk_score: 0.88,
          state: 'UNDER_REVIEW',
          resolution: null,
          resolved_by: null,
          created_at: '2026-11-21T11:00:00.000Z',
          updated_at: '2026-11-21T11:05:00.000Z',
        }],
      });

    const response = await request(app)
      .patch('/api/alerts/2')
      .send({ state: 'UNDER_REVIEW' });

    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty('account_ref');
    expect(JSON.stringify(response.body)).not.toContain('account_ref');
    expect(response.body.alert_id).toBe(2);
    expect(response.body.state).toBe('UNDER_REVIEW');
  });
});
