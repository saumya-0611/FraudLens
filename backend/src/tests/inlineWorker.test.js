jest.mock('../config/db', () => ({ query: jest.fn() }));
jest.mock('../pipeline/inlineScorer', () => ({ scoreTransactionInline: jest.fn() }));

const { query } = require('../config/db');
const { scoreTransactionInline } = require('../pipeline/inlineScorer');
const { startInlineWorker, stopInlineWorker } = require('../pipeline/inlineWorker');

afterEach(async () => {
  await stopInlineWorker();
  jest.resetAllMocks();
});

test('claims at most four due jobs and releases a failed job with backoff', async () => {
  query.mockResolvedValueOnce({ rows: [{ transaction_id: 'pending-fixture', attempts: 3 }] });
  query.mockResolvedValue({ rows: [] });
  scoreTransactionInline.mockResolvedValue(false);
  startInlineWorker();
  await stopInlineWorker();

  const [sql, [capacity, leaseSeconds, token]] = query.mock.calls[0];
  expect(sql).toContain('FOR UPDATE SKIP LOCKED');
  expect(capacity).toBe(4);
  expect(leaseSeconds).toBe(60);
  expect(query).toHaveBeenLastCalledWith(expect.stringContaining('lease_token = $2'), ['pending-fixture', token, 8]);
});

test('removes a completed job only for the matching lease', async () => {
  query.mockResolvedValueOnce({ rows: [{ transaction_id: 'scored-fixture', attempts: 1 }] });
  query.mockResolvedValue({ rows: [] });
  scoreTransactionInline.mockResolvedValue(true);
  startInlineWorker();
  await stopInlineWorker();

  const token = query.mock.calls[0][1][2];
  expect(query).toHaveBeenLastCalledWith(
    'DELETE FROM inline_scoring_jobs WHERE transaction_id = $1 AND lease_token = $2',
    ['scored-fixture', token]
  );
});
