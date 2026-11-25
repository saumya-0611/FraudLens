jest.mock('../config/db', () => require('./fixtures/session').mockDatabase(jest.fn()));

jest.mock('../kafka/producer', () => ({
  publishTransaction: jest.fn(),
  disconnectProducer: jest.fn(),
  isProducerConnected: jest.fn().mockReturnValue(true),
}));

const request = require('supertest');
const app = require('../app');
const { routeQuery: query } = require('../config/db');
const { sessionCookie } = require('./fixtures/session');
let cookie;
const { isProducerConnected } = require('../kafka/producer');
const env = require('../config/env');
env.internalMlToken = 'fixture-dashboard-token';

describe('Dashboard Route Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cookie = sessionCookie('VIEWER');
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  afterAll(() => {
    delete global.fetch;
  });

  describe('GET /api/dashboard/summary', () => {
    test('1. returns correct summary statistics with actual counts and latencies', async () => {
      const recentHeartbeat = new Date(Date.now() - 10000).toISOString(); // 10s ago

      query
        // 1. txSql
        .mockResolvedValueOnce({
          rows: [
            {
              total_transactions: 120,
              total_amount: '15450.75',
              legitimate: 100,
              suspicious: 12,
              high_risk: 5,
              pending: 3,
              flagged_transactions: 17,
            },
          ],
        })
        // 2. alertSql
        .mockResolvedValueOnce({
          rows: [
            {
              total_alerts: 5,
              new_alerts: 2,
              alerts_under_review: 2,
              open_alerts: 4,
              resolved_alerts: 1,
            },
          ],
        })
        // 3. latencySql
        .mockResolvedValueOnce({
          rows: [
            {
              score_p50: 640.4,
              score_p95: 1450.6,
              alert_p95: 1900.0,
            },
          ],
        })
        // 4. modelSql
        .mockResolvedValueOnce({
          rows: [
            {
              version: 'v2',
              drift_status: 'WARNING',
            },
          ],
        })
        // 5. heartbeatSql
        .mockResolvedValueOnce({
          rows: [
            {
              last_seen: recentHeartbeat,
            },
          ],
        });

      const response = await request(app).get('/api/dashboard/summary').set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        total_transactions: 120,
        flagged_transactions: 17,
        legitimate: 100,
        suspicious: 12,
        high_risk: 5,
        pending: 3,
        total_alerts: 5,
        open_alerts: 4,
        new_alerts: 2,
        alerts_under_review: 2,
        resolved_alerts: 1,
        total_amount: 15450.75,
        latency_ms: {
          score_p50: 640,
          score_p95: 1451,
          alert_p95: 1900,
        },
        active_model: {
          version: 'v2',
          drift_status: 'WARNING',
        },
        system_status: {
          backend: 'UP',
          database: 'UP',
          kafka: 'UP',
          ml_service: 'UP',
          streaming: 'UP',
        },
        updated_at: expect.any(String),
      });

      // Ensure account_ref is NEVER exposed
      expect(response.body).not.toHaveProperty('account_ref');
      expect(JSON.stringify(response.body)).not.toContain('account_ref');
    });

    test('2. handles zero transactions and empty tables gracefully', async () => {
      isProducerConnected.mockReturnValueOnce(false);
      global.fetch = jest.fn().mockRejectedValue(new Error('ML offline'));

      query
        // 1. txSql empty
        .mockResolvedValueOnce({
          rows: [
            {
              total_transactions: 0,
              total_amount: '0',
              legitimate: 0,
              suspicious: 0,
              high_risk: 0,
              pending: 0,
              flagged_transactions: 0,
            },
          ],
        })
        // 2. alertSql empty
        .mockResolvedValueOnce({
          rows: [
            {
              total_alerts: 0,
              new_alerts: 0,
              alerts_under_review: 0,
              open_alerts: 0,
              resolved_alerts: 0,
            },
          ],
        })
        // 3. latencySql nulls
        .mockResolvedValueOnce({
          rows: [
            {
              score_p50: 0,
              score_p95: 0,
              alert_p95: 0,
            },
          ],
        })
        // 4. modelSql empty
        .mockResolvedValueOnce({
          rows: [],
        })
        // 5. heartbeatSql empty
        .mockResolvedValueOnce({
          rows: [],
        });

      const response = await request(app).get('/api/dashboard/summary').set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.body.total_transactions).toBe(0);
      expect(response.body.total_amount).toBe(0);
      expect(response.body.legitimate).toBe(0);
      expect(response.body.suspicious).toBe(0);
      expect(response.body.high_risk).toBe(0);
      expect(response.body.pending).toBe(0);
      expect(response.body.total_alerts).toBe(0);
      expect(response.body.open_alerts).toBe(0);
      expect(response.body.latency_ms).toEqual({
        score_p50: 0,
        score_p95: 0,
        alert_p95: 0,
      });
      // Fallback model defaults
      expect(response.body.active_model).toEqual({
        version: 'v1',
        drift_status: 'OK',
      });
      // Kafka, ML, Streaming should be DOWN
      expect(response.body.system_status).toEqual({
        backend: 'UP',
        database: 'UP',
        kafka: 'DOWN',
        ml_service: 'DOWN',
        streaming: 'DOWN',
      });
    });

    test('handles expired streaming heartbeat as DOWN (> 60s)', async () => {
      const oldHeartbeat = new Date(Date.now() - 75000).toISOString(); // 75s ago

      query
        .mockResolvedValueOnce({ rows: [{ total_transactions: 10, total_amount: '100' }] })
        .mockResolvedValueOnce({ rows: [{ total_alerts: 0 }] })
        .mockResolvedValueOnce({ rows: [{ score_p50: 0, score_p95: 0, alert_p95: 0 }] })
        .mockResolvedValueOnce({ rows: [{ version: 'v1', drift_status: 'OK' }] })
        .mockResolvedValueOnce({ rows: [{ last_seen: oldHeartbeat }] });

      const response = await request(app).get('/api/dashboard/summary').set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.body.system_status.streaming).toBe('DOWN');
    });
  });

  describe('GET /api/dashboard/trends', () => {
    test('3. returns minute-wise aggregated trend points in chronological order', async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            minute: '2026-11-21T10:00:00.000Z',
            total: 20,
            flagged: 5,
          },
          {
            minute: '2026-11-21T10:01:00.000Z',
            total: 15,
            flagged: 2,
          },
        ],
      });

      const response = await request(app).get('/api/dashboard/trends?minutes=30').set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        points: [
          {
            minute: '2026-11-21T10:00:00.000Z',
            total: 20,
            flagged: 5,
          },
          {
            minute: '2026-11-21T10:01:00.000Z',
            total: 15,
            flagged: 2,
          },
        ],
      });

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('date_trunc'),
        [30]
      );
      expect(JSON.stringify(response.body)).not.toContain('account_ref');
    });

    test('4. uses 60 minutes by default when minutes query param is omitted', async () => {
      query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/dashboard/trends').set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ points: [] });
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('date_trunc'),
        [60]
      );
    });

    test('5. rejects invalid minutes parameter with 400 VALIDATION_ERROR', async () => {
      // Negative minutes
      const resNeg = await request(app).get('/api/dashboard/trends?minutes=-10').set('Cookie', cookie);
      expect(resNeg.status).toBe(400);
      expect(resNeg.body.error.code).toBe('VALIDATION_ERROR');

      // Zero minutes
      const resZero = await request(app).get('/api/dashboard/trends?minutes=0').set('Cookie', cookie);
      expect(resZero.status).toBe(400);
      expect(resZero.body.error.code).toBe('VALIDATION_ERROR');

      // Non-integer string
      const resStr = await request(app).get('/api/dashboard/trends?minutes=abc').set('Cookie', cookie);
      expect(resStr.status).toBe(400);
      expect(resStr.body.error.code).toBe('VALIDATION_ERROR');

      // Floating point number
      const resFloat = await request(app).get('/api/dashboard/trends?minutes=12.5').set('Cookie', cookie);
      expect(resFloat.status).toBe(400);
      expect(resFloat.body.error.code).toBe('VALIDATION_ERROR');

      expect(query).not.toHaveBeenCalled();
    });

    test('6. handles an empty result when no transactions exist in window', async () => {
      query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/api/dashboard/trends?minutes=15').set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        points: [],
      });
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('date_trunc'),
        [15]
      );
    });

    test('7. aggregates by hour when minutes exceeds 180', async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            minute: '2026-11-25T12:00:00.000Z',
            total: 40,
            flagged: 6,
          },
        ],
      });

      const response = await request(app).get('/api/dashboard/trends?minutes=1440').set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.body.points).toEqual([
        {
          minute: '2026-11-25T12:00:00.000Z',
          total: 40,
          flagged: 6,
        },
      ]);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("date_trunc('hour'"),
        [1440]
      );
    });
  });
});
