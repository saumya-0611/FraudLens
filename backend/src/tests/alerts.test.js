jest.mock('../config/db', () => require('./fixtures/session').mockDatabase(jest.fn()));

const request = require('supertest');
const app = require('../app');
const { routeQuery: query } = require('../config/db');
const { sessionCookie, users } = require('./fixtures/session');
let cookie;

describe('Alerts Route Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cookie = sessionCookie('ANALYST');
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
      .get('/api/alerts?page=1&page_size=20').set('Cookie', cookie);

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
      .patch('/api/alerts/1').set('Cookie', cookie)
      .send({ state: 'UNDER_REVIEW' });

    expect(response.status).toBe(200);
    expect(response.body.state).toBe('UNDER_REVIEW');
    expect(response.body).not.toHaveProperty('account_ref');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]).toEqual([expect.stringContaining('AND state = $5'), ['UNDER_REVIEW', null, null, '1', 'NEW']]);
  });

  test('PATCH returns a conflict when another update wins the state transition', async () => {
    query.mockResolvedValueOnce({ rows: [{ alert_id: 1, state: 'NEW' }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .patch('/api/alerts/1').set('Cookie', cookie)
      .send({ state: 'RESOLVED', resolution: 'FALSE_POSITIVE' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
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
          resolved_by: users.find(({ role }) => role === 'ANALYST').id,
        }],
      });

    const response = await request(app)
      .patch('/api/alerts/1').set('Cookie', cookie)
      .send({
        state: 'RESOLVED',
        resolution: 'CONFIRMED_FRAUD',
      });

    expect(response.status).toBe(200);
    expect(response.body.state).toBe('RESOLVED');
    expect(response.body.resolution).toBe('CONFIRMED_FRAUD');
    expect(query.mock.calls[1][1][2]).toBe(response.body.resolved_by);
    expect(response.body).not.toHaveProperty('account_ref');
  });

  test('PATCH /api/alerts/:id rejects an already resolved alert', async () => {
    query.mockResolvedValueOnce({
      rows: [{ alert_id: 1, state: 'RESOLVED' }],
    });

    const response = await request(app)
      .patch('/api/alerts/1').set('Cookie', cookie)
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
      .patch('/api/alerts/2').set('Cookie', cookie)
      .send({ state: 'UNDER_REVIEW' });

    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty('account_ref');
    expect(JSON.stringify(response.body)).not.toContain('account_ref');
    expect(response.body.alert_id).toBe(2);
    expect(response.body.state).toBe('UNDER_REVIEW');
  });
});
