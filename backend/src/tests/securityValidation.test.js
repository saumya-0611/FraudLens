const { createTransaction, alertPatch, listQuery, login, createUser, patchUser } = require('../validation/schemas');

const transaction = {
  transaction_id: 'fixture-101', account_ref: 'fixture-account', category: 'retail',
  amount: 10_000_000, tx_time: '2026-11-23T12:00:00Z', lat: -90, lon: 180, merch_lat: null,
};

test('transaction schema allows valid edge values and optional coordinates', () => {
  expect(createTransaction.safeParse({ body: transaction }).success).toBe(true);
  expect(createTransaction.safeParse({ body: { ...transaction, amount: 0 } }).success).toBe(true);
});

test.each([
  { amount: -1 }, { amount: Infinity }, { amount: '10' }, { amount: 10_000_001 },
  { lat: 91 }, { lon: -181 }, { merchant: {} }, { customer_age: -1 },
  { tx_time: '2026-02-30T12:00:00Z' }, { tx_time: '2026-11-23T12:00:00' },
  { transaction_id: '' }, { account_ref: '' }, { category: 'x'.repeat(51) },
  { ingested_at: '2026-11-23T12:00:00Z' },
])('transaction rejects invalid or managed fields %j', (change) => {
  expect(createTransaction.safeParse({ body: { ...transaction, ...change } }).success).toBe(false);
});

test('alert resolution and status must agree', () => {
  const good = { params: { id: '10' }, body: { state: 'RESOLVED', resolution: 'FALSE_POSITIVE' } };
  expect(alertPatch.safeParse(good).success).toBe(true);
  expect(alertPatch.safeParse({ ...good, body: { state: 'RESOLVED' } }).success).toBe(false);
  expect(alertPatch.safeParse({ ...good, body: { ...good.body, state: 'UNDER_REVIEW' } }).success).toBe(false);
});

test('query pagination, risk, and date boundaries are enforced', () => {
  const query = { page: '1', page_size: '100', risk: 'PENDING', from: '2026-11-23' };
  expect(listQuery.safeParse({ query }).success).toBe(true);
  for (const change of [{ page: '0' }, { page_size: '101' }, { page_size: ['10'] }, { from: '2026-13-01' }, { risk: 'NEW' }]) {
    expect(listQuery.safeParse({ query: { ...query, ...change } }).success).toBe(false);
  }
});

test('login and user schemas reject arrays, blank passwords, and managed fields', () => {
  const body = { username: 'test-user', password: 'fixture-only-12', role: 'VIEWER' };
  expect(login.safeParse({ body: [{ username: body.username, password: body.password }] }).success).toBe(false);
  expect(createUser.safeParse({ body }).success).toBe(true);
  expect(createUser.safeParse({ body: { ...body, password: ' '.repeat(10) } }).success).toBe(false);
  expect(createUser.safeParse({ body: { ...body, password: 'é'.repeat(37) } }).success).toBe(false);
  expect(createUser.safeParse({ body: { ...body, status: 'ACTIVE' } }).success).toBe(false);
  expect(patchUser.safeParse({ params: { id: '1' }, body: { role: 'ADMIN' } }).success).toBe(true);
  expect(patchUser.safeParse({ params: { id: '2147483648' }, body: { role: 'ADMIN' } }).success).toBe(false);
  expect(patchUser.safeParse({ params: { id: '1' }, body: { failed_attempts: 0 } }).success).toBe(false);
});
