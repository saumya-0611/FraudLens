const http = require('http');
const path = require('path');
require('../backend/node_modules/dotenv').config({ path: path.resolve(__dirname, '../.env') });

process.env.PORT = '5055';
process.env.PIPELINE_MODE = 'inline';

const app = require('../backend/src/app');
const server = http.createServer(app);

function doRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function testAppE2E() {
  console.log('--- STARTING BACKEND APP WITH NEON POSTGRES ---');
  await new Promise((resolve) => server.listen(5055, resolve));
  console.log('✓ Backend app listening on port 5055');

  try {
    // 1. Health check
    console.log('\n[E2E 1/4] GET /health (Database ping to Neon)...');
    const health = await doRequest({ host: 'localhost', port: 5055, path: '/health', method: 'GET' });
    console.log('Status:', health.status, 'Body:', health.body);
    if (health.status !== 200) throw new Error('Health check failed');

    // 2. Login test
    console.log('\n[E2E 2/4] POST /api/auth/login (Neon users query & bcrypt verify)...');
    const loginPayload = JSON.stringify({ username: 'admin', password: process.env.SEED_ADMIN_PASSWORD || 'FlAdmin#2026!Secure' });
    const loginRes = await doRequest({
      host: 'localhost',
      port: 5055,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(loginPayload)
      }
    }, loginPayload);
    console.log('Status:', loginRes.status, 'Body:', loginRes.body);
    if (loginRes.status !== 200) throw new Error('Login failed');

    // Extract cookie
    const cookie = loginRes.headers['set-cookie'] ? loginRes.headers['set-cookie'][0].split(';')[0] : '';
    console.log('✓ Received auth cookie from backend');

    // 3. Alerts fetch test
    console.log('\n[E2E 3/4] GET /api/alerts (Neon alerts table query)...');
    const alertsRes = await doRequest({
      host: 'localhost',
      port: 5055,
      path: '/api/alerts?page=1&limit=5',
      method: 'GET',
      headers: { 'Cookie': cookie }
    });
    console.log('Status:', alertsRes.status, 'Body snippet:', alertsRes.body.slice(0, 200) + '...');
    if (alertsRes.status !== 200) throw new Error('Fetch alerts failed');

    // 4. Ingest inline transaction test
    console.log('\n[E2E 4/4] POST /api/transactions (Neon transaction write & inline scoring)...');
    const txPayload = JSON.stringify({
      transaction_id: `neon-inline-${Date.now()}`,
      account_ref: '4532015112830366',
      amount: 420.50,
      category: 'shopping_net',
      merchant: 'Neon_E2E_Test',
      tx_time: new Date().toISOString(),
      customer_age: 29
    });
    const txRes = await doRequest({
      host: 'localhost',
      port: 5055,
      path: '/api/transactions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(txPayload),
        'X-Service-Token': process.env.SERVICE_TOKEN || 'fl_service_token_simulator_2026'
      }
    }, txPayload);
    console.log('Status:', txRes.status, 'Body:', txRes.body);
    if (txRes.status !== 202) throw new Error('Transaction ingestion failed');

    console.log('\n✓ ALL LIVE HTTP API TESTS ON NEON PASSED SUCCESSFULLY');
  } finally {
    server.close();
    console.log('✓ Backend app server closed cleanly');
  }
}

testAppE2E()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('E2E HTTP Test Failed:', e);
    process.exit(1);
  });
