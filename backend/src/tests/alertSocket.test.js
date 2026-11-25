const http = require('http');
const { once } = require('node:events');
const WebSocket = require('ws');
const {
  initAlertSocket,
  broadcastAlert,
  sanitizeAlert,
  sanitizeDeep,
  closeAlertSocket,
  getWebSocketServer,
} = require('../websocket/alertSocket');
const { sessionCookie, users } = require('./fixtures/session');

jest.mock('../config/db', () => require('./fixtures/session').mockDatabase(jest.fn()));

describe('WebSocket Alert Socket Tests', () => {
  let server;
  let port;
  const localOrigin = 'http://localhost:5173';
  const configuredOrigins = process.env.WS_ALLOWED_ORIGINS;

  beforeEach((done) => {
    jest.clearAllMocks();
    delete process.env.WS_ALLOWED_ORIGINS;
    server = http.createServer((req, res) => res.end('ok'));
    initAlertSocket(server);
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterEach((done) => {
    closeAlertSocket();
    if (configuredOrigins === undefined) delete process.env.WS_ALLOWED_ORIGINS;
    else process.env.WS_ALLOWED_ORIGINS = configuredOrigins;
    server.close(done);
  });

  test('5. connects authenticated client successfully to /ws/alerts', (done) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws/alerts`, {
      origin: localOrigin,
      headers: { cookie: sessionCookie('ANALYST') },
    });

    client.on('open', () => {
      client.close();
      done();
    });

    client.on('error', (err) => {
      done(err);
    });
  });

  test('sends an authenticated-ready frame only after validating the session', async () => {
    const client = connect({ origin: localOrigin, headers: { cookie: sessionCookie('ANALYST') } });
    try {
      const framePromise = once(client, 'message');
      await once(client, 'open');
      const [frame] = await framePromise;
      expect(JSON.parse(frame.toString())).toEqual({ type: 'READY' });
      const [accepted] = getWebSocketServer().clients;
      expect(await accepted.sessionReady).toMatchObject({ role: 'ANALYST' });
    } finally {
      client.terminate();
    }
  });

  test('rejects unauthenticated client with 4401 Unauthorized code', (done) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws/alerts`, { origin: localOrigin });

    client.on('close', (code, reason) => {
      expect(code).toBe(4401);
      expect(reason.toString()).toBe('Unauthorized');
      done();
    });

    client.on('error', () => {
      // Handled cleanly
    });
  });

  function connect(options) {
    return new WebSocket(`ws://127.0.0.1:${port}/ws/alerts`, options);
  }

  test('accepts an explicitly configured production HTTPS origin', async () => {
    const origin = 'https://fraudlens.example.test:8443';
    process.env.WS_ALLOWED_ORIGINS = origin;
    initAlertSocket(server);
    const client = connect({ origin, headers: { cookie: sessionCookie('VIEWER') } });
    try {
      await once(client, 'open');
      const [accepted] = getWebSocketServer().clients;
      expect(await accepted.sessionReady).toMatchObject({ role: 'VIEWER' });
    } finally {
      client.terminate();
    }
  });

  test.each([
    ['foreign origin', 'https://foreign.example.test'],
    ['unapproved same-site origin on another port', 'http://localhost:5174'],
    ['unapproved scheme', 'https://localhost:5173'],
    ['missing Origin', undefined],
  ])('rejects a valid session with %s at the HTTP upgrade', async (_label, origin) => {
    const client = connect({ origin, headers: { cookie: sessionCookie('VIEWER'), 'Sec-Fetch-Site': 'same-origin' } });
    const [, response] = await once(client, 'unexpected-response');
    response.resume();
    expect(response.statusCode).toBe(403);
    expect(getWebSocketServer().clients.size).toBe(0);
  });

  test('an approved origin still requires a valid JWT', async () => {
    const client = connect({ origin: localOrigin, headers: { cookie: 'fl_token=invalid' } });
    const received = jest.fn();
    client.on('message', received);
    expect((await once(client, 'close'))[0]).toBe(4401);
    expect(received).not.toHaveBeenCalled();
  });

  test('an approved origin still requires an active account', async () => {
    const viewer = users.find(({ role }) => role === 'VIEWER');
    viewer.status = 'DISABLED';
    try {
      const client = connect({ origin: localOrigin, headers: { cookie: sessionCookie('VIEWER') } });
      expect((await once(client, 'close'))[0]).toBe(4401);
    } finally {
      viewer.status = 'ACTIVE';
    }
  });

  test('stops sending alerts after the connected account is disabled', async () => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws/alerts`, {
      origin: localOrigin,
      headers: { cookie: sessionCookie('VIEWER') },
    });
    const received = jest.fn();
    client.on('message', (data) => {
      if (JSON.parse(data.toString()).type === 'NEW_ALERT') received();
    });
    const closed = new Promise((resolve) => client.once('close', resolve));
    const viewer = users.find(({ role }) => role === 'VIEWER');
    try {
      await new Promise((resolve, reject) => {
        client.once('open', resolve);
        client.once('error', reject);
      });
      await Array.from(getWebSocketServer().clients)[0].sessionReady;
      viewer.status = 'DISABLED';
      await broadcastAlert({ alert_id: 15 });
      expect(await closed).toBe(4401);
      expect(received).not.toHaveBeenCalled();
    } finally {
      viewer.status = 'ACTIVE';
      client.terminate();
    }
  });

  test('disconnects a socket when the authenticated role changes', async () => {
    const client = connect({ origin: localOrigin, headers: { cookie: sessionCookie('VIEWER') } });
    const viewer = users.find(({ role }) => role === 'VIEWER');
    const originalRole = viewer.role;
    try {
      const framePromise = once(client, 'message');
      await once(client, 'open');
      await framePromise; // authenticated READY
      const closed = once(client, 'close');
      viewer.role = 'ANALYST';
      await broadcastAlert({ alert_id: 991 });
      const [code, reason] = await closed;
      expect(code).toBe(4403);
      expect(reason.toString()).toBe('Session changed');
    } finally {
      viewer.role = originalRole;
      client.terminate();
    }
  });

  test('6. handles client disconnection cleanly', (done) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws/alerts`, {
      origin: localOrigin,
      headers: { cookie: sessionCookie('ADMIN') },
    });

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
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws/alerts`, {
      origin: localOrigin,
      headers: { cookie: sessionCookie('VIEWER') },
    });

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
      if (parsed.type === 'READY') return;
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
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws/alerts`, {
      origin: localOrigin,
      headers: { cookie: sessionCookie('ANALYST') },
    });

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
      if (parsed.type === 'READY') return;
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
