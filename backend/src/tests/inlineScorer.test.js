const mockDbState = {
  transactions: new Map(),
  results: new Map(),
  alerts: new Map(),
  query: jest.fn(),
  withTransaction: jest.fn(),
  chain: Promise.resolve(),
};

jest.mock('../config/db', () => ({
  query: (...args) => mockDbState.query(...args),
  withTransaction: (...args) => mockDbState.withTransaction(...args),
}));
jest.mock('../audit/auditLogger', () => ({ audit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../websocket/alertSocket', () => ({
  broadcastAlert: jest.fn().mockResolvedValue(undefined),
  sanitizeAlert: value => value,
}));

const { scoreTransactionInline, persistPendingTransaction, recoverPendingTransactions } = require('../pipeline/inlineScorer');
const { broadcastAlert } = require('../websocket/alertSocket');

const input = {
  transaction_id: 'fixture-transaction-1',
  account_ref: 'account-987654',
  amount: 850,
  tx_time: '2026-11-24T12:00:00.000Z',
  category: 'shopping_net',
  merchant: 'Fixture merchant',
  lat: 40.7,
  lon: -74,
  merch_lat: 40.71,
  merch_lon: -74.01,
  customer_age: 35,
  ingested_at: '2026-11-24T12:00:01.000Z',
};

function prediction(overrides = {}) {
  return {
    model_version: 'fixture-v1',
    predictions: [{
      transaction_id: input.transaction_id,
      fraud_probability: 0.91,
      anomaly_score: 0.72,
      is_anomaly: true,
      top_reasons: [{ feature: 'amount_ratio', impact: 0.4, text: 'Fixture explanation' }],
      ...overrides,
    }],
  };
}

function clientQuery(sql, params = []) {
  if (sql.includes('FROM transactions') && sql.includes('FOR UPDATE')) {
    const row = mockDbState.transactions.get(params[0]);
    return Promise.resolve({ rows: row ? [{ ...row }] : [] });
  }
  if (sql.includes('FROM fraud_results')) {
    const row = mockDbState.results.get(params[0]);
    return Promise.resolve({ rows: row ? [{ ...row }] : [] });
  }
  if (sql.includes('FROM transactions WHERE account_ref')) {
    const rows = [...mockDbState.transactions.values()]
      .filter(row => row.account_ref === params[0])
      .map(({ transaction_id, amount, tx_time }) => ({ transaction_id, amount, tx_time }));
    return Promise.resolve({ rows });
  }
  if (sql.includes('INSERT INTO fraud_results')) {
    if (mockDbState.results.has(params[0])) return Promise.resolve({ rows: [] });
    const result = {
      transaction_id: params[0], fraud_probability: params[1], anomaly_score: params[2],
      is_anomaly: params[3], risk_category: params[4], top_reasons: JSON.parse(params[5]),
      features: JSON.parse(params[6]), model_version: params[7],
    };
    mockDbState.results.set(params[0], result);
    return Promise.resolve({ rows: [{ transaction_id: params[0] }] });
  }
  if (sql.includes('INSERT INTO alerts')) {
    if (mockDbState.alerts.has(params[0])) return Promise.resolve({ rows: [] });
    const alert = { alert_id: mockDbState.alerts.size + 1, created_at: new Date(input.ingested_at) };
    mockDbState.alerts.set(params[0], alert);
    return Promise.resolve({ rows: [alert] });
  }
  return Promise.resolve({ rows: [] });
}

beforeEach(() => {
  mockDbState.transactions.clear();
  mockDbState.results.clear();
  mockDbState.alerts.clear();
  mockDbState.chain = Promise.resolve();
  mockDbState.query.mockImplementation(async (sql, params = []) => {
    if (sql.includes('LEFT JOIN fraud_results fr')) {
      return {
        rows: [...mockDbState.transactions.values()]
          .filter(row => !mockDbState.results.has(row.transaction_id))
          .slice(0, 10),
      };
    }
    if (sql.includes('INSERT INTO transactions')) {
      if (!mockDbState.transactions.has(params[0])) {
        mockDbState.transactions.set(params[0], {
          transaction_id: params[0], account_ref: params[1], amount: params[2],
          tx_time: params[3], category: params[4], merchant: params[5],
          lat: params[6], lon: params[7], merch_lat: params[8], merch_lon: params[9],
          customer_age: params[10], ingested_at: params[11],
        });
      }
    }
    return { rows: [] };
  });
  mockDbState.withTransaction.mockImplementation(async work => {
    const previous = mockDbState.chain;
    let release;
    mockDbState.chain = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      return await work({ query: clientQuery });
    } finally {
      release();
    }
  });
  global.fetch = jest.fn();
  jest.clearAllMocks();
});

afterEach(() => {
  delete global.fetch;
});

test('persists a durable unscored transaction before inference', async () => {
  await persistPendingTransaction(input);
  expect(mockDbState.transactions.get(input.transaction_id)).toMatchObject({
    transaction_id: input.transaction_id,
    amount: input.amount,
    ingested_at: input.ingested_at,
  });
  expect(mockDbState.results.size).toBe(0);
});

test('persists a validated genuine prediction and creates a masked alert atomically', async () => {
  await persistPendingTransaction(input);
  global.fetch.mockResolvedValue({ ok: true, json: async () => prediction() });

  const outcome = await scoreTransactionInline(input);

  expect(outcome.scored).toBe(true);
  expect(mockDbState.results.get(input.transaction_id)).toMatchObject({
    fraud_probability: 0.91,
    anomaly_score: 0.72,
    risk_category: 'HIGH_RISK',
    model_version: 'fixture-v1',
  });
  expect(mockDbState.results.get(input.transaction_id).features).toMatchObject({
    amount: 850,
    category_code: 11,
  });
  expect(mockDbState.alerts.size).toBe(1);
  expect(broadcastAlert).toHaveBeenCalledTimes(1);
  expect(broadcastAlert.mock.calls[0][0].account_masked).toBe('XXXX-7654');
  expect(JSON.stringify(broadcastAlert.mock.calls[0][0])).not.toContain(input.account_ref);
});

test.each([
  ['transport outage', () => Promise.reject(new Error('fixture outage'))],
  ['malformed prediction', () => Promise.resolve({ ok: true, json: async () => ({ model_version: 'fixture-v1', predictions: [] }) })],
  ['mismatched transaction id', () => Promise.resolve({ ok: true, json: async () => prediction({ transaction_id: 'other-id' }) })],
  ['out of range probability', () => Promise.resolve({ ok: true, json: async () => prediction({ fraud_probability: 1.7 }) })],
  ['non-success response', () => Promise.resolve({ ok: false, status: 503 })],
])('leaves the durable row pending without invented scores after %s', async (_name, response) => {
  await persistPendingTransaction(input);
  global.fetch.mockImplementation(response);

  const outcome = await scoreTransactionInline(input);

  expect(outcome).toEqual({ pending: true });
  expect(mockDbState.transactions.has(input.transaction_id)).toBe(true);
  expect(mockDbState.results.size).toBe(0);
  expect(mockDbState.alerts.size).toBe(0);
  expect(broadcastAlert).not.toHaveBeenCalled();
});

test('retries a pending ID after a transient outage and stores the real response', async () => {
  await persistPendingTransaction(input);
  global.fetch
    .mockRejectedValueOnce(new Error('temporary outage'))
    .mockResolvedValueOnce({ ok: true, json: async () => prediction({ fraud_probability: 0.22, is_anomaly: false }) });

  expect(await scoreTransactionInline(input)).toEqual({ pending: true });
  expect(await scoreTransactionInline(input)).toEqual({ scored: true, alert: null });
  expect(mockDbState.results.get(input.transaction_id).fraud_probability).toBe(0.22);
  expect(mockDbState.results.get(input.transaction_id).risk_category).toBe('LEGITIMATE');
  expect(mockDbState.alerts.size).toBe(0);
});

test('startup recovery revisits durable pending rows and stores a later valid result', async () => {
  await persistPendingTransaction(input);
  global.fetch.mockResolvedValue({ ok: true, json: async () => prediction({ fraud_probability: 0.62, is_anomaly: false }) });

  await recoverPendingTransactions();

  expect(mockDbState.results.get(input.transaction_id)).toMatchObject({
    fraud_probability: 0.62,
    risk_category: 'SUSPICIOUS',
  });
});

test('concurrent duplicate scoring keeps the first committed decision and emits one alert', async () => {
  await persistPendingTransaction(input);
  global.fetch.mockResolvedValue({ ok: true, json: async () => prediction() });

  await Promise.all([
    scoreTransactionInline(input),
    scoreTransactionInline({ ...input, amount: 1, category: 'food_dining' }),
  ]);

  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(mockDbState.results.get(input.transaction_id).fraud_probability).toBe(0.91);
  expect(mockDbState.alerts.size).toBe(1);
  expect(broadcastAlert).toHaveBeenCalledTimes(1);
});
