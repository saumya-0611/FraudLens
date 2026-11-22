jest.mock('../audit/auditLogger', () => ({
  audit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../config/db', () => require('./fixtures/session').mockDatabase(jest.fn()));

const request = require('supertest');
const env = require('../config/env');
const app = require('../app');
const { audit } = require('../audit/auditLogger');
const { sessionCookie } = require('./fixtures/session');
let adminCookie;

describe('Models Route Proxy Tests (B6)', () => {
  const originalFetch = global.fetch;

  beforeAll(() => {
    env.internalMlToken = 'test-secret-internal-token';
  });

  beforeEach(() => {
    global.fetch = jest.fn();
    adminCookie = sessionCookie('ADMIN');
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

    const res = await request(app).get('/api/models').set('Cookie', adminCookie);

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
      const res = await request(app)[ep.method](ep.url).set('Cookie', sessionCookie('ANALYST'));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }

    // Unauthenticated request returns 401 UNAUTHENTICATED
    const unauthRes = await request(app).get('/api/models');
    expect(unauthRes.status).toBe(401);
    expect(unauthRes.body.error.code).toBe('UNAUTHENTICATED');

  });

  test('3. GET /api/models correctly proxies to ML service GET /models', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ active_version: 'v1' }),
    });

    const res = await request(app).get('/api/models').set('Cookie', adminCookie);

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
      sample_size: 25,
    };

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => driftResult,
    });

    const res = await request(app)
      .post('/api/models/drift-check').set('Cookie', adminCookie)
      .send({ sample_size: 25 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(driftResult);

    expect(global.fetch).toHaveBeenCalledWith(
      `${env.mlServiceUrl}/drift/check?sample_size=25`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Internal-Token': 'test-secret-internal-token',
        }),
      })
    );

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MODEL_DRIFT_CHECK',
        entity: 'model',
        entityId: 'v1',
        details: expect.objectContaining({
          sample_size: 25,
          psi_score: 0.08,
          status: 'OK',
        }),
      })
    );
  });

  test('drift check preserves the upstream default without a sample size', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ model_version: 'v1', sample_size: 1000 }),
    });
    const res = await request(app).post('/api/models/drift-check').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(global.fetch.mock.calls[0][0]).toBe(`${env.mlServiceUrl}/drift/check`);
  });

  test.each([0, -1, 1.5, 10001, '25', null])('rejects invalid drift sample size %p', async (sampleSize) => {
    const res = await request(app).post('/api/models/drift-check').set('Cookie', adminCookie)
      .send({ sample_size: sampleSize });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(global.fetch).not.toHaveBeenCalled();
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
      .post('/api/models/retrain').set('Cookie', adminCookie)
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

    await request(app).post('/api/models/retrain').set('Cookie', adminCookie).send({});

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
      .post('/api/models/retrain').set('Cookie', adminCookie)
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
      .post('/api/models/v2/activate').set('Cookie', adminCookie)
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
    const res = await request(app).post('/api/models/invalid!@version$/activate').set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('10. Handles ML service unavailable (503) and timeout (504)', async () => {
    // 1. Connection error / ECONNREFUSED
    global.fetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:8000'));

    const unavailableRes = await request(app).get('/api/models').set('Cookie', adminCookie);
    expect(unavailableRes.status).toBe(503);
    expect(unavailableRes.body.error.code).toBe('SERVER_ERROR');

    // 2. Timeout error
    const timeoutErr = new Error('The operation was aborted');
    timeoutErr.name = 'TimeoutError';
    global.fetch.mockRejectedValueOnce(timeoutErr);

    const timeoutRes = await request(app).post('/api/models/retrain').set('Cookie', adminCookie).send({});
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

    const notFoundRes = await request(app).post('/api/models/v99/activate').set('Cookie', adminCookie);
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

    const conflictRes = await request(app).post('/api/models/v3/activate').set('Cookie', adminCookie);
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

    const res = await request(app).get('/api/models').set('Cookie', adminCookie);

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
