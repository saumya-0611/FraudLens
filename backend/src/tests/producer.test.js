jest.mock('kafkajs', () => {
  const send = jest.fn().mockResolvedValue([]);
  const connect = jest.fn().mockResolvedValue(undefined);
  const disconnect = jest.fn().mockResolvedValue(undefined);

  return {
    Kafka: jest.fn().mockImplementation(() => ({
      producer: () => ({ connect, send, disconnect }),
    })),
    __mock: { send, connect, disconnect },
  };
});

const { publishTransaction, disconnectProducer } = require('../kafka/producer');
const { __mock } = require('kafkajs');

describe('Kafka Producer Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('publishes transaction to correct topic with account key', async () => {
    const transaction = {
      transaction_id: 'tx-001',
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

    const value = JSON.parse(sentMessage.messages[0].value);

    expect(value.transaction_id).toBe('tx-001');
    expect(value.ingested_at).toBeTruthy();
    expect(new Date(value.ingested_at).toISOString()).toBe(value.ingested_at);
  });

  test('disconnects producer', async () => {
    await disconnectProducer();
    expect(__mock.disconnect).toHaveBeenCalled();
  });
});
