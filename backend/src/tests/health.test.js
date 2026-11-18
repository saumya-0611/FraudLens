const request = require('supertest');
const app = require('../app');

describe('B1 Backend Health Tests', () => {
  test('GET /health returns 200 and status ok', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
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
