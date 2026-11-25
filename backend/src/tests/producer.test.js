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
const { acceptTransactionInline } = require('../pipeline/inlineScorer');
const { wakeInlineWorker } = require('../pipeline/inlineWorker');

jest.mock('../pipeline/inlineScorer', () => ({
  acceptTransactionInline: jest.fn(),
  startInlineHeartbeat: jest.fn(),
  stopInlineHeartbeat: jest.fn(),
}));
jest.mock('../pipeline/inlineWorker', () => ({
  wakeInlineWorker: jest.fn(),
  startInlineWorker: jest.fn(),
  stopInlineWorker: jest.fn(),
}));

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

describe('Inline producer', () => {
  const transaction = { transaction_id: 'inline-fixture', account_ref: 'synthetic-ref' };
  const previousMode = process.env.PIPELINE_MODE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PIPELINE_MODE = 'inline';
  });

  afterEach(() => {
    if (previousMode === undefined) delete process.env.PIPELINE_MODE;
    else process.env.PIPELINE_MODE = previousMode;
  });

  test('waits for durable database intake before waking the worker', async () => {
    let committed;
    acceptTransactionInline.mockImplementationOnce(() => new Promise(resolve => { committed = resolve; }));
    const submission = publishTransaction(transaction);
    expect(wakeInlineWorker).not.toHaveBeenCalled();
    committed();
    await submission;
    expect(acceptTransactionInline).toHaveBeenCalledWith(expect.objectContaining(transaction));
    expect(wakeInlineWorker).toHaveBeenCalledTimes(1);
    expect(__mock.send).not.toHaveBeenCalled();
  });

  test('propagates an intake failure before acknowledging', async () => {
    acceptTransactionInline.mockRejectedValueOnce(new Error('fixture database unavailable'));
    await expect(publishTransaction(transaction)).rejects.toThrow('fixture database unavailable');
    expect(wakeInlineWorker).not.toHaveBeenCalled();
  });
});
