const request = require('supertest');
jest.mock('../config/db', () => ({ query: jest.fn() }));
jest.mock('../kafka/producer', () => ({ isProducerConnected: jest.fn() }));
jest.mock('../kafka/alertConsumer', () => ({ isConsumerRunning: jest.fn() }));
jest.mock('../utils/kafkaReadiness', () => ({ checkKafkaReadiness: jest.fn() }));

const env = require('../config/env');
const { query } = require('../config/db');
const { isProducerConnected } = require('../kafka/producer');
const { isConsumerRunning } = require('../kafka/alertConsumer');
const { checkKafkaReadiness } = require('../utils/kafkaReadiness');
const app = require('../app');

describe('B1 Backend Health Tests', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetAllMocks();
    env.pipelineMode = 'inline';
    env.mlServiceUrl = 'http://ml-service:8000';
    env.internalMlToken = 'fixture-internal-token';
    query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    checkKafkaReadiness.mockResolvedValue(true);
  });

  afterEach(() => { global.fetch = originalFetch; });

  test('GET /health returns 200 and status ok', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  test('inline readiness checks PostgreSQL and authenticated model readiness without Kafka', async () => {
    const response = await request(app).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ text: 'SELECT 1' }));
    expect(global.fetch).toHaveBeenCalledWith('http://ml-service:8000/ready', expect.objectContaining({
      method: 'HEAD',
      redirect: 'error',
      headers: { 'X-Internal-Token': 'fixture-internal-token' },
    }));
    expect(isProducerConnected).not.toHaveBeenCalled();
    expect(isConsumerRunning).not.toHaveBeenCalled();
    expect(checkKafkaReadiness).not.toHaveBeenCalled();
  });

  test('readiness returns a generic 503 for an unavailable database or ML service', async () => {
    query.mockRejectedValueOnce(new Error('private database diagnostic'));
    await request(app).get('/ready').expect(503, { status: 'unavailable' });
    global.fetch.mockResolvedValueOnce({ ok: false });
    await request(app).get('/ready').expect(503, { status: 'unavailable' });
    await request(app).get('/health').expect(200, { status: 'ok' });
  });

  test('an unset ML credential makes readiness fail without performing the upstream request', async () => {
    env.internalMlToken = undefined;
    await request(app).get('/ready').expect(503, { status: 'unavailable' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('Kafka readiness requires both the producer and the alert consumer', async () => {
    env.pipelineMode = 'kafka';
    isProducerConnected.mockReturnValue(true);
    isConsumerRunning.mockReturnValueOnce(false).mockReturnValue(true);

    await request(app).get('/ready').expect(503, { status: 'unavailable' });
    checkKafkaReadiness.mockResolvedValueOnce(false);
    await request(app).get('/ready').expect(503, { status: 'unavailable' });
    await request(app).get('/ready').expect(200, { status: 'ok' });
  });

  test('Unknown endpoint returns 404 with contract error', async () => {
    const response = await request(app).get('/this-route-does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toBeTruthy();
    expect(response.body.error.request_id).toBeTruthy();
  });

  test('Malformed JSON returns 400 VALIDATION_ERROR', async () => {
    const response = await request(app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"bad":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.request_id).toBeTruthy();
  });
});
