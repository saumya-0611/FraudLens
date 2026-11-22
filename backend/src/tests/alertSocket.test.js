const http = require('http');
const WebSocket = require('ws');
const {
  initAlertSocket,
  broadcastAlert,
  sanitizeAlert,
  sanitizeDeep,
  closeAlertSocket,
  getWebSocketServer,
} = require('../websocket/alertSocket');
const { verifyRequestCookie } = require('../utils/jwt');

jest.mock('../utils/jwt', () => ({
  verifyRequestCookie: jest.fn(),
}));

describe('WebSocket Alert Socket Tests', () => {
  let server;
  let port;

  beforeEach((done) => {
    jest.clearAllMocks();
    server = http.createServer((req, res) => res.end('ok'));
    initAlertSocket(server);
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterEach((done) => {
    closeAlertSocket();
    server.close(done);
  });

  test('5. connects authenticated client successfully to /ws/alerts', (done) => {
    verifyRequestCookie.mockReturnValue({
      id: 1,
      username: 'analyst1',
      role: 'ANALYST',
    });

    const client = new WebSocket(`ws://127.0.0.1:${port}/ws/alerts`, {
      headers: { cookie: 'fl_token=valid-jwt-token' },
    });

    client.on('open', () => {
      expect(verifyRequestCookie).toHaveBeenCalled();
      client.close();
      done();
    });

    client.on('error', (err) => {
      done(err);
    });
  });

  test('rejects unauthenticated client with 4401 Unauthorized code', (done) => {
    verifyRequestCookie.mockReturnValue(null);

    const client = new WebSocket(`ws://127.0.0.1:${port}/ws/alerts`);

    client.on('close', (code, reason) => {
      expect(code).toBe(4401);
      expect(reason.toString()).toBe('Unauthorized');
      done();
    });

    client.on('error', () => {
      // Handled cleanly
    });
  });

  test('6. handles client disconnection cleanly', (done) => {
    verifyRequestCookie.mockReturnValue({ id: 2, username: 'admin1', role: 'ADMIN' });

    const client = new WebSocket(`ws://127.0.0.1:${port}/ws/alerts`);

    client.on('open', () => {
      const wss = getWebSocketServer();
      expect(wss.clients.size).toBe(1);

      client.close();
    });

    client.on('close', () => {
      setTimeout(() => {
        const wss = getWebSocketServer();
        expect(wss ? wss.clients.size : 0).toBe(0);
        done();
      }, 50);
    });
  });

  test('7. broadcasts alert to connected authenticated clients in CONTRACTS format', (done) => {
    verifyRequestCookie.mockReturnValue({ id: 3, username: 'viewer1', role: 'VIEWER' });

    const client = new WebSocket(`ws://127.0.0.1:${port}/ws/alerts`);

    const testAlert = {
      alert_id: 201,
      transaction_id: 'tx-ws-001',
      account_masked: 'XXXX-5555',
      amount: 750.0,
      category: 'entertainment',
      risk_score: 0.91,
      risk_category: 'HIGH_RISK',
      top_reasons: [{ feature: 'hour', text: 'Late night activity', impact: 0.35 }],
      model_version: 'v1',
      created_at: '2026-11-21T15:00:00.000Z',
    };

    client.on('open', () => {
      broadcastAlert(testAlert);
    });

    client.on('message', (data) => {
      const parsed = JSON.parse(data.toString());
      expect(parsed).toEqual({
        type: 'NEW_ALERT',
        alert: testAlert,
      });
      client.close();
      done();
    });
  });

  test('sanitizeAlert removes raw account_ref and provides account_masked', () => {
    const rawAlert = {
      alert_id: 202,
      account_ref: '5555666677778888',
      amount: 100,
    };

    const sanitized = sanitizeAlert(rawAlert);

    expect(sanitized).not.toHaveProperty('account_ref');
    expect(sanitized.account_masked).toBe('XXXX-8888');
  });

  test('sanitizeDeep strips nested account_ref at any depth', () => {
    const nestedData = {
      account_ref: 'top_level_secret',
      info: {
        account_ref: 'nested_secret',
        list: [
          { account_ref: 'array_nested_secret', safe_val: 'ok' },
        ],
      },
      safe: 123,
    };

    const sanitized = sanitizeDeep(nestedData);
    expect(sanitized.account_ref).toBeUndefined();
    expect(sanitized.info.account_ref).toBeUndefined();
    expect(sanitized.info.list[0].account_ref).toBeUndefined();
    expect(sanitized.info.list[0].safe_val).toBe('ok');
    expect(sanitized.safe).toBe(123);
  });

  test('broadcastAlert strips deeply nested account_ref before transmission', (done) => {
    verifyRequestCookie.mockReturnValue({ id: 4, username: 'analyst2', role: 'ANALYST' });

    const client = new WebSocket(`ws://127.0.0.1:${port}/ws/alerts`);

    const rawAlertWithNestedSecret = {
      alert_id: 203,
      transaction_id: 'tx-ws-203',
      account_ref: '1234567890123456',
      details: {
        account_ref: 'deep_secret',
      },
    };

    client.on('open', () => {
      broadcastAlert(rawAlertWithNestedSecret);
    });

    client.on('message', (data) => {
      const parsed = JSON.parse(data.toString());
      expect(parsed.type).toBe('NEW_ALERT');
      expect(parsed.alert.account_ref).toBeUndefined();
      expect(parsed.alert.details.account_ref).toBeUndefined();
      expect(parsed.alert.account_masked).toBe('XXXX-3456');
      client.close();
      done();
    });
  });

  test('initAlertSocket is idempotent and replaces prior server instance cleanly', () => {
    const initialWss = getWebSocketServer();
    expect(initialWss).toBeTruthy();

    initAlertSocket(server);
    const secondWss = getWebSocketServer();
    expect(secondWss).toBeTruthy();
    expect(secondWss).not.toBe(initialWss);
  });

  test('closeAlertSocket shuts down server and terminates active clients', () => {
    const wss = getWebSocketServer();
    expect(wss).toBeTruthy();

    closeAlertSocket();

    expect(getWebSocketServer()).toBeNull();
  });
});
