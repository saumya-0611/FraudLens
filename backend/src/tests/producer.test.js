jest.mock('../pipeline/inlineScorer', () => ({
  acceptTransactionInline: jest.fn(), scoreTransactionInline: jest.fn(),
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

const { publishTransaction } = require('../kafka/producer');
const { __mock } = require('kafkajs');

describe('Kafka Producer Tests', () => {
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
    expect(new Date(messageValue.ingested_at).toISOString())
      .toBe(messageValue.ingested_at);
  });
});

describe('inline routing', () => {
  const { acceptTransactionInline, scoreTransactionInline } = require('../pipeline/inlineScorer');
  const transaction = { transaction_id: 'inline-fixture' };
  let previousMode;

  beforeEach(() => {
    previousMode = process.env.PIPELINE_MODE;
    process.env.PIPELINE_MODE = 'inline';
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (previousMode === undefined) delete process.env.PIPELINE_MODE;
    else process.env.PIPELINE_MODE = previousMode;
  });

  test('waits for durable acceptance before acknowledging and schedules one score without Kafka', async () => {
    let persisted;
    acceptTransactionInline.mockReturnValueOnce(new Promise((resolve) => { persisted = resolve; }));
    scoreTransactionInline.mockResolvedValueOnce(undefined);
    const acknowledgement = jest.fn();
    const request = publishTransaction(transaction).then(acknowledgement);
    expect(acceptTransactionInline).toHaveBeenCalledWith(expect.objectContaining(transaction));
    expect(acknowledgement).not.toHaveBeenCalled();
    expect(scoreTransactionInline).not.toHaveBeenCalled();
    persisted();
    await request;
    await new Promise(setImmediate);
    expect(scoreTransactionInline).toHaveBeenCalledTimes(1);
    expect(scoreTransactionInline).toHaveBeenCalledWith(transaction.transaction_id);
    expect(__mock.connect).not.toHaveBeenCalled();
    expect(__mock.send).not.toHaveBeenCalled();
  });

  test('failed persistence rejects acceptance and never schedules a score', async () => {
    acceptTransactionInline.mockRejectedValueOnce(new Error('fixture database failure'));
    await expect(publishTransaction(transaction)).rejects.toThrow('fixture database failure');
    await new Promise(setImmediate);
    expect(scoreTransactionInline).not.toHaveBeenCalled();
    expect(__mock.send).not.toHaveBeenCalled();
  });
});
