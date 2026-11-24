jest.mock('../config/db', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
jest.mock('../config/env', () => ({ mlServiceUrl: 'http://127.0.0.1:1', internalMlToken: 'fixture' }));
jest.mock('../audit/auditLogger', () => ({ appendAudit: jest.fn() }));
jest.mock('../websocket/alertSocket', () => ({ broadcastAlert: jest.fn() }));

const { query, pool } = require('../config/db');
const { appendAudit } = require('../audit/auditLogger');
const { broadcastAlert } = require('../websocket/alertSocket');
const { acceptTransactionInline, scoreTransactionInline } = require('../pipeline/inlineScorer');

const tx = {
  transaction_id: 'fixture', account_ref: 'synthetic-1234', amount: '125.50',
  tx_time: '2026-11-25T02:00:00Z', category: 'shopping_net', ingested_at: '2026-11-25T02:00:00Z',
};
const prediction = {
  transaction_id: tx.transaction_id, fraud_probability: 0.94, anomaly_score: 0.31, is_anomaly: true,
  top_reasons: [{ feature: 'amount', text: 'Fixture amount', impact: 0.5 }],
};
const payload = { model_version: 'fixture-v2', predictions: [prediction] };
const client = { query: jest.fn(), release: jest.fn() };
const acceptedFetch = global.fetch;

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  global.fetch = jest.fn();
  query.mockResolvedValueOnce({ rows: [tx] }).mockResolvedValue({ rows: [] });
  pool.connect.mockResolvedValue(client);
  client.query.mockImplementation(async (sql) => {
    if (sql.includes('INSERT INTO fraud_results')) return { rows: [{ fraud_probability: 0.94, risk_category: 'HIGH_RISK' }] };
    if (sql.includes('INSERT INTO alerts')) return { rows: [{ alert_id: 3, created_at: new Date(tx.tx_time) }] };
    return { rows: [] };
  });
});

afterEach(() => {
  global.fetch = acceptedFetch;
  jest.restoreAllMocks();
});

test('durable acceptance inserts once using the established transaction key', async () => {
  await acceptTransactionInline(tx);
  expect(query).toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO transactions[\s\S]+ON CONFLICT \(transaction_id\) DO NOTHING/),
    expect.arrayContaining([tx.transaction_id, tx.account_ref, tx.ingested_at]));
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each([
  ['network unavailable', () => Promise.reject(new Error('ECONNREFUSED'))],
  ['timed out', () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
  ['HTTP error', async () => ({ ok: false, status: 503 })],
  ['malformed JSON', async () => ({ ok: true, json: async () => { throw new SyntaxError(); } })],
  ['missing version', async () => Response.json({ predictions: [prediction] })],
  ['empty predictions', async () => Response.json({ ...payload, predictions: [] })],
  ['wrong transaction', async () => Response.json({ ...payload, predictions: [{ ...prediction, transaction_id: 'other' }] })],
  ['coerced probability', async () => Response.json({ ...payload, predictions: [{ ...prediction, fraud_probability: '0.9' }] })],
  ['out-of-range probability', async () => Response.json({ ...payload, predictions: [{ ...prediction, fraud_probability: 2 }] })],
  ['missing anomaly score', async () => Response.json({ ...payload, predictions: [{ ...prediction, anomaly_score: null }] })],
  ['coerced anomaly flag', async () => Response.json({ ...payload, predictions: [{ ...prediction, is_anomaly: 'false' }] })],
  ['invalid reasons', async () => Response.json({ ...payload, predictions: [{ ...prediction, top_reasons: ['fake'] }] })],
])('%s leaves the accepted transaction pending and emits no score or alert', async (_name, response) => {
  global.fetch.mockImplementationOnce(response);
  await scoreTransactionInline(tx.transaction_id);
  expect(pool.connect).not.toHaveBeenCalled();
  expect(appendAudit).not.toHaveBeenCalled();
  expect(broadcastAlert).not.toHaveBeenCalled();
});

test('persists exact validated output using canonical 13 features and commits before broadcast', async () => {
  global.fetch.mockResolvedValueOnce(Response.json(payload));
  await scoreTransactionInline(tx.transaction_id);
  const [url, config] = global.fetch.mock.calls[0];
  expect(url).toBe('http://127.0.0.1:1/predict');
  const { instances: [instance] } = JSON.parse(config.body);
  expect(instance.transaction_id).toBe(tx.transaction_id);
  expect(instance.features.amount).toBe(125.5);
  expect(Object.keys(instance.features)).toHaveLength(13);
  expect(client.query.mock.calls[1][1]).toEqual([
    tx.transaction_id, 0.94, 0.31, true, 'HIGH_RISK', JSON.stringify(prediction.top_reasons),
    JSON.stringify(instance.features), 'fixture-v2',
  ]);
  expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  expect(appendAudit).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'ALERT_RAISED' }));
  expect(broadcastAlert).toHaveBeenCalledWith(expect.objectContaining({ account_masked: 'XXXX-1234', alert_id: 3 }));
  expect(client.query.mock.invocationCallOrder.at(-1)).toBeLessThan(broadcastAlert.mock.invocationCallOrder[0]);
});

test('a concurrent loser cannot insert an alert, append audit, or broadcast', async () => {
  client.query.mockResolvedValue({ rows: [] });
  global.fetch.mockResolvedValueOnce(Response.json(payload));
  await scoreTransactionInline(tx.transaction_id);
  expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', expect.stringContaining('INSERT INTO fraud_results'), 'COMMIT']);
  expect(appendAudit).not.toHaveBeenCalled();
  expect(broadcastAlert).not.toHaveBeenCalled();
});

test('an already scored transaction does not make another inference call', async () => {
  query.mockReset().mockResolvedValueOnce({ rows: [{ ...tx, scored: true }] });
  await scoreTransactionInline(tx.transaction_id);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('a failed alert audit rolls back the score and alert together without publishing', async () => {
  global.fetch.mockResolvedValueOnce(Response.json(payload));
  appendAudit.mockRejectedValueOnce(new Error('fixture audit failure'));
  await expect(scoreTransactionInline(tx.transaction_id)).rejects.toThrow('fixture audit failure');
  expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(client.release).toHaveBeenCalledTimes(1);
  expect(broadcastAlert).not.toHaveBeenCalled();
});
