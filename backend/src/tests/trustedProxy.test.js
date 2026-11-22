const express = require('express');
const request = require('supertest');
const { apiLimiter } = require('../middleware/apiHardening');
const { configureTrustedProxy, discardMalformedForwarding } = require('../middleware/trustedProxy');

function fixture(trusted) {
  const app = express();
  configureTrustedProxy(app, trusted);
  app.use('/api', discardMalformedForwarding, apiLimiter);
  app.get('/api/dashboard/fixture', (req, res) => res.json({ ip: req.ip }));
  return request(app);
}

function read(client, forwarded) {
  const result = client.get('/api/dashboard/fixture');
  return forwarded === undefined ? result : result.set('X-Forwarded-For', forwarded);
}

test('nine dashboards behind the configured proxy each have an independent quota', async () => {
  const client = fixture('127.0.0.1');
  const results = await Promise.all(Array.from({ length: 9 }, async (_, index) => {
    const address = '192.0.2.' + (index + 1);
    let result;
    for (let call = 0; call < 36; call++) {
      result = await read(client, address);
      expect(result.status).toBe(200);
    }
    expect(result.body.ip).toBe(address);
    return result.headers.ratelimit;
  }));
  expect(results.every((value) => value.includes('remaining=264'))).toBe(true);
});

test('a normal client reaches 429 while an independent client continues', async () => {
  const client = fixture('127.0.0.1');
  const address = '192.0.2.20';
  for (let call = 0; call < 300; call++) {
    expect((await read(client, address)).status).toBe(200);
  }
  expect((await read(client, address)).status).toBe(429);
  expect((await read(client, '192.0.2.21')).status).toBe(200);
});

test('untrusted and malformed forwarding metadata stays on the socket quota', async () => {
  const direct = fixture('192.0.2.254');
  const first = await read(direct);
  const bogus = await read(direct, '192.0.2.100');
  expect(bogus.body.ip).toBe(first.body.ip);
  const proxy = fixture('127.0.0.1');
  const malformed = await read(proxy, 'invalid');
  expect(malformed.body.ip).toBe(first.body.ip);
  expect(malformed.headers.ratelimit).toContain('remaining=297');
});

test.each(['true', '0.0.0.0/0', '::/0', '127.0.0.1/33'])('rejects unsafe proxy configuration %s', (value) => {
  expect(() => configureTrustedProxy(express(), value)).toThrow('TRUSTED_PROXY_CIDRS');
});
