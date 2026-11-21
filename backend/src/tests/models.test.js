jest.mock('../audit/auditLogger', () => ({
  audit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../middleware/authenticate', () => {
  return jest.fn((req, res, next) => {
    const roleHeader = req.headers['x-test-role'];
    if (roleHeader === 'UNAUTHENTICATED') {
      return res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required.',
          request_id: req.id,
        },
      });
    }
    req.user = {
      id: 1,
      username: 'admin-user',
      role: roleHeader || 'ADMIN',
    };
    next();
  });
});

jest.mock('../middleware/authorize', () => {
  return jest.fn((...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have access to this resource.',
          request_id: req.id,
        },
      });
    }
    next();
  });
});

const request = require('supertest');
const env = require('../config/env');
const app = require('../app');
const { audit } = require('../audit/auditLogger');
const authorize = require('../middleware/authorize');

describe('Models Route Proxy Tests (B6)', () => {
  const originalFetch = global.fetch;

  beforeAll(() => {
    env.internalMlToken = 'test-secret-internal-token';
  });

  beforeEach(() => {
    global.fetch = jest.fn();
    audit.mockClear();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test('1. ADMIN can access GET /api/models', async () => {
    const mockData = {
      active_version: 'v1',
      model_versions: [
        { version: 'v1', status: 'ACTIVE', metrics: { pr_auc: 0.96 } },
      ],
      latest_drift: { status: 'OK', psi_score: 0.04 },
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockData,
    });

    const res = await request(app).get('/api/models');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockData);
  });

  test('2. Non-ADMIN cannot access model endpoints (returns 403 FORBIDDEN)', async () => {
    const endpoints = [
      { method: 'get', url: '/api/models' },
      { method: 'post', url: '/api/models/drift-check' },
      { method: 'post', url: '/api/models/retrain' },
      { method: 'post', url: '/api/models/v1/activate' },
    ];

    for (const ep of endpoints) {
      const res = await request(app)[ep.method](ep.url).set('x-test-role', 'ANALYST');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }

    // Unauthenticated request returns 401 UNAUTHENTICATED
    const unauthRes = await request(app).get('/api/models').set('x-test-role', 'UNAUTHENTICATED');
    expect(unauthRes.status).toBe(401);
    expect(unauthRes.body.error.code).toBe('UNAUTHENTICATED');

    // Verify authorize was configured for ADMIN
    expect(authorize).toHaveBeenCalledWith('ADMIN');
  });

  test('3. GET /api/models correctly proxies to ML service GET /models', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ active_version: 'v1' }),
    });

    const res = await request(app).get('/api/models');

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      `${env.mlServiceUrl}/models`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'X-Internal-Token': 'test-secret-internal-token',
        }),
      })
    );
  });

  test('4. POST /api/models/drift-check correctly proxies to /drift/check and audits', async () => {
    const driftResult = {
      model_version: 'v1',
      psi_score: 0.08,
      status: 'OK',
      sample_size: 1000,
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => driftResult,
    });

    const res = await request(app)
      .post('/api/models/drift-check')
      .send({ sample_size: 1000 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(driftResult);

    expect(global.fetch).toHaveBeenCalledWith(
      `${env.mlServiceUrl}/drift/check`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Internal-Token': 'test-secret-internal-token',
        }),
        body: JSON.stringify({ sample_size: 1000 }),
      })
    );

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MODEL_DRIFT_CHECK',
        entity: 'model',
        entityId: 'v1',
        details: expect.objectContaining({
          sample_size: 1000,
          psi_score: 0.08,
          status: 'OK',
        }),
      })
    );
  });

  test('5. POST /api/models/retrain correctly proxies to /retrain', async () => {
    const retrainResult = {
      version: 'v2',
      status: 'VALIDATED',
      metrics: { pr_auc: 0.97, roc_auc: 0.99 },
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => retrainResult,
    });

    const res = await request(app)
      .post('/api/models/retrain')
      .send({ note: 'Scheduled monthly retrain' });

    expect(global.fetch).toHaveBeenCalledWith(
      `${env.mlServiceUrl}/retrain`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ note: 'Scheduled monthly retrain' }),
      })
    );
  });

  test('6. Retrain uses a 30-second timeout', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ version: 'v2', status: 'VALIDATED' }),
    });

    await request(app).post('/api/models/retrain').send({});

    expect(timeoutSpy).toHaveBeenCalledWith(30000);
    timeoutSpy.mockRestore();
  });

  test('7. Retrain returns HTTP 202 on successful acceptance and records audit', async () => {
    const retrainResult = {
      version: 'v2',
      status: 'VALIDATED',
      metrics: { pr_auc: 0.97 },
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200, // Upstream ML service returned 200 OK
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => retrainResult,
    });

    const res = await request(app)
      .post('/api/models/retrain')
      .send({});

    // Backend contract requires HTTP 202
    expect(res.status).toBe(202);
    expect(res.body).toEqual(retrainResult);

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MODEL_RETRAIN',
        entity: 'model',
        entityId: 'v2',
        details: expect.objectContaining({
          version: 'v2',
          status: 'VALIDATED',
        }),
      })
    );
  });

  test('8. Activate uses correct upstream endpoint /models/{version}/activate and audits', async () => {
    const activateResult = {
      version: 'v2',
      status: 'ACTIVE',
      activated_at: '2026-11-21T18:00:00.000Z',
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => activateResult,
    });

    const res = await request(app)
      .post('/api/models/v2/activate')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual(activateResult);

    expect(global.fetch).toHaveBeenCalledWith(
      `${env.mlServiceUrl}/models/v2/activate`,
      expect.objectContaining({
        method: 'POST',
      })
    );

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MODEL_ACTIVATED',
        entity: 'model',
        entityId: 'v2',
      })
    );
  });

  test('validates version path parameter and rejects invalid identifiers', async () => {
    const res = await request(app).post('/api/models/invalid!@version$/activate');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('10. Handles ML service unavailable (503) and timeout (504)', async () => {
    // 1. Connection error / ECONNREFUSED
    global.fetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:8000'));

    const unavailableRes = await request(app).get('/api/models');
    expect(unavailableRes.status).toBe(503);
    expect(unavailableRes.body.error.code).toBe('SERVER_ERROR');

    // 2. Timeout error
    const timeoutErr = new Error('The operation was aborted');
    timeoutErr.name = 'TimeoutError';
    global.fetch.mockRejectedValueOnce(timeoutErr);

    const timeoutRes = await request(app).post('/api/models/retrain').send({});
    expect(timeoutRes.status).toBe(504);
    expect(timeoutRes.body.error.code).toBe('SERVER_ERROR');
  });

  test('11. Preserves meaningful upstream error status codes and response bodies', async () => {
    // 404 Model Not Found
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ detail: 'Model version v99 does not exist' }),
    });

    const notFoundRes = await request(app).post('/api/models/v99/activate');
    expect(notFoundRes.status).toBe(404);
    expect(notFoundRes.body).toEqual({ detail: 'Model version v99 does not exist' });
    expect(audit).not.toHaveBeenCalled();

    // 409 Conflict (e.g. Model not validated)
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ detail: 'Cannot activate model with status REJECTED' }),
    });

    const conflictRes = await request(app).post('/api/models/v3/activate');
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body).toEqual({ detail: 'Cannot activate model with status REJECTED' });
  });

  test('12. Internal token is forwarded to upstream but never leaked, and account_ref is stripped', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/json',
        'x-internal-token': 'should-not-leak',
      }),
      json: async () => ({
        version: 'v1',
        account_ref: '4111222233334444',
        details: { account_ref: 'nested_secret' },
        safe_data: 'ok',
      }),
    });

    const res = await request(app).get('/api/models');

    // Token was forwarded upstream
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Internal-Token': 'test-secret-internal-token',
        }),
      })
    );

    // Token is NOT in response headers or response body
    expect(res.headers).not.toHaveProperty('x-internal-token');
    expect(JSON.stringify(res.body)).not.toContain('test-secret-internal-token');

    // account_ref is deeply stripped
    expect(res.body).not.toHaveProperty('account_ref');
    expect(res.body.details).not.toHaveProperty('account_ref');
    expect(res.body.safe_data).toBe('ok');
  });
});
