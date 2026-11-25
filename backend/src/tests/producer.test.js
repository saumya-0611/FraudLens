const mockInlineScorer = {
  score: jest.fn(),
  persist: jest.fn(),
  startHeartbeat: jest.fn(),
  stopHeartbeat: jest.fn(),
};

jest.mock('../pipeline/inlineScorer', () => ({
  scoreTransactionInline: (...args) => mockInlineScorer.score(...args),
  persistPendingTransaction: (...args) => mockInlineScorer.persist(...args),
  startInlineHeartbeat: (...args) => mockInlineScorer.startHeartbeat(...args),
  stopInlineHeartbeat: (...args) => mockInlineScorer.stopHeartbeat(...args),
}));

jest.mock('kafkajs', () => {
  const send = jest.fn().mockResolvedValue(undefined);
  const connect = jest.fn().mockResolvedValue(undefined);
  const disconnect = jest.fn().mockResolvedValue(undefined);

  return {
    Kafka: jest.fn().mockImplementation(() => ({
      producer: () => ({ send, connect, disconnect }),
    })),
    __mock: { send, connect, disconnect },
  };
});

const { publishTransaction, disconnectProducer } = require('../kafka/producer');
const { __mock } = require('kafkajs');

describe('Kafka Producer Tests', () => {
  beforeEach(() => jest.clearAllMocks());

  test('publishes transaction to correct topic with account key and timestamp', async () => {
    const transaction = {
      transaction_id: 'tx-test-002',
      account_ref: 'account-123456',
      amount: 250,
      tx_time: '2026-11-21T10:00:00.000Z',
      category: 'retail',
    };

    await publishTransaction(transaction);

    expect(__mock.connect).toHaveBeenCalled();
    const sentMessage = __mock.send.mock.calls[0][0];
    expect(sentMessage.topic).toBe('transactions-raw');
    expect(sentMessage.messages[0].key).toBe('account-123456');
    const messageValue = JSON.parse(sentMessage.messages[0].value);
    expect(messageValue.transaction_id).toBe('tx-test-002');
    expect(messageValue.ingested_at).toBeTruthy();
    expect(new Date(messageValue.ingested_at).toISOString()).toBe(messageValue.ingested_at);
  });

  test('inline mode persists pending data before scheduling scoring and skips Kafka', async () => {
    const previousMode = process.env.PIPELINE_MODE;
    process.env.PIPELINE_MODE = 'inline';
    const transaction = {
      transaction_id: 'tx-inline-pending',
      account_ref: 'account-123456',
      amount: 250,
      tx_time: '2026-11-21T10:00:00.000Z',
      category: 'retail',
    };
    mockInlineScorer.persist.mockResolvedValue(undefined);
    mockInlineScorer.score.mockResolvedValue({ pending: true });
    try {
      await publishTransaction(transaction);
      expect(mockInlineScorer.persist).toHaveBeenCalledTimes(1);
      expect(mockInlineScorer.score).not.toHaveBeenCalled();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockInlineScorer.score).toHaveBeenCalledTimes(1);
      expect(__mock.connect).not.toHaveBeenCalled();
      expect(__mock.send).not.toHaveBeenCalled();
    } finally {
      await disconnectProducer();
      if (previousMode === undefined) delete process.env.PIPELINE_MODE;
      else process.env.PIPELINE_MODE = previousMode;
    }
  });

  test('inline mode retries a transient scorer error a bounded number of times', async () => {
    const previousMode = process.env.PIPELINE_MODE;
    process.env.PIPELINE_MODE = 'inline';
    const transaction = {
      transaction_id: 'tx-inline-retry',
      account_ref: 'account-123456',
      amount: 250,
      tx_time: '2026-11-21T10:00:00.000Z',
      category: 'retail',
    };
    mockInlineScorer.persist.mockResolvedValue(undefined);
    mockInlineScorer.score
      .mockRejectedValueOnce(new Error('fixture transient failure'))
      .mockResolvedValueOnce({ scored: true });
    try {
      await publishTransaction(transaction);
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(mockInlineScorer.score).toHaveBeenCalledTimes(2);
    } finally {
      await disconnectProducer();
      if (previousMode === undefined) delete process.env.PIPELINE_MODE;
      else process.env.PIPELINE_MODE = previousMode;
    }
  });
});
