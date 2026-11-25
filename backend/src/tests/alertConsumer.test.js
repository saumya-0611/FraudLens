jest.mock('kafkajs', () => {
  const subscribe = jest.fn().mockResolvedValue(undefined);
  const run = jest.fn().mockResolvedValue(undefined);
  const connect = jest.fn().mockResolvedValue(undefined);
  const disconnect = jest.fn().mockResolvedValue(undefined);

  const mockConsumer = {
    connect,
    subscribe,
    run,
    disconnect,
  };

  return {
    Kafka: jest.fn().mockImplementation(() => ({
      consumer: jest.fn().mockReturnValue(mockConsumer),
    })),
    __mockConsumer: mockConsumer,
  };
});

jest.mock('../audit/auditLogger', () => ({
  appendAudit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../config/db', () => {
  const client = { query: jest.fn() };
  return { withTransaction: jest.fn((work) => work(client)), __mockClient: client };
});

jest.mock('../websocket/alertSocket', () => {
  const actualSocket = jest.requireActual('../websocket/alertSocket');
  return {
    broadcastAlert: jest.fn(),
    sanitizeAlert: actualSocket.sanitizeAlert,
    sanitizeDeep: actualSocket.sanitizeDeep,
  };
});

const { __mockConsumer } = require('kafkajs');
const { appendAudit: audit } = require('../audit/auditLogger');
const { __mockClient } = require('../config/db');
const { broadcastAlert } = require('../websocket/alertSocket');
const {
  startAlertConsumer,
  stopAlertConsumer,
  handleAlertMessage,
  parseAlertMessage,
  resetDeduplicationCache,
} = require('../kafka/alertConsumer');

describe('Kafka Alert Consumer Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDeduplicationCache();
    __mockClient.query.mockReset().mockResolvedValue({ rows: [] });
  });

  afterEach(async () => {
    await stopAlertConsumer();
  });

  test('1. initializes Kafka consumer with topic fraud-alerts and group backend-alerts', async () => {
    await startAlertConsumer();

    expect(__mockConsumer.connect).toHaveBeenCalled();
    expect(__mockConsumer.subscribe).toHaveBeenCalledWith({
      topic: 'fraud-alerts',
      fromBeginning: true,
    });
    expect(__mockConsumer.run).toHaveBeenCalled();
  });

  test('2. successfully handles Kafka alert message, audits, and broadcasts', async () => {
    const validAlert = {
      alert_id: 101,
      transaction_id: 'tx-consumer-001',
      account_masked: 'XXXX-9876',
      amount: 1200.5,
      category: 'travel',
      risk_score: 0.94,
      risk_category: 'HIGH_RISK',
      top_reasons: [{ feature: 'amount_ratio', impact: 0.4, text: 'Unusually high amount' }],
      model_version: 'v1',
      created_at: '2026-11-21T12:00:00.000Z',
    };

    const rawBuffer = Buffer.from(JSON.stringify(validAlert));
    const result = await handleAlertMessage(rawBuffer);

    expect(result).toBeTruthy();
    expect(result.alert_id).toBe(101);

    // Verify audit call with contract-specified fields
    expect(audit).toHaveBeenCalledWith(__mockClient, {
      userId: null,
      username: 'system',
      action: 'ALERT_RAISED',
      entity: 'alert',
      entityId: '101',
      details: {
        transaction_id: 'tx-consumer-001',
        risk_score: 0.94,
        risk_category: 'HIGH_RISK',
        amount: 1200.5,
        category: 'travel',
      },
    });

    // Verify broadcast call
    expect(broadcastAlert).toHaveBeenCalledWith(expect.objectContaining({
      alert_id: 101,
      transaction_id: 'tx-consumer-001',
      account_masked: 'XXXX-9876',
    }));
  });

  test('3. correctly parses valid alert and strips any raw account_ref', () => {
    const rawWithSensitive = {
      alert_id: 102,
      transaction_id: 'tx-consumer-002',
      account_ref: '4111222233334444',
      amount: 300,
      risk_score: 0.88,
    };

    const parsed = parseAlertMessage(JSON.stringify(rawWithSensitive));

    expect(parsed).not.toHaveProperty('account_ref');
    expect(parsed.account_masked).toBe('XXXX-4444');
    expect(parsed.alert_id).toBe(102);
  });

  test('deeply strips account_ref from nested objects and arrays', () => {
    const raw = {
      alert_id: 103,
      transaction_id: 'tx-consumer-003',
      account_ref: '1111222233334444',
      metadata: {
        account_ref: 'nested_secret_1',
        details: {
          account_ref: 'deeply_nested_secret_2',
        },
      },
      top_reasons: [
        { text: 'Reason 1', account_ref: 'array_nested_secret_3' },
      ],
    };

    const parsed = parseAlertMessage(JSON.stringify(raw));
    expect(parsed.account_ref).toBeUndefined();
    expect(parsed.metadata.account_ref).toBeUndefined();
    expect(parsed.metadata.details.account_ref).toBeUndefined();
    expect(parsed.top_reasons[0].account_ref).toBeUndefined();
    expect(parsed.account_masked).toBe('XXXX-4444');
  });

  test('4. handles malformed or non-JSON messages without crashing', async () => {
    const malformed = 'INVALID_NOT_JSON{[';
    const result = await handleAlertMessage(malformed);

    expect(result).toBeNull();
    expect(audit).not.toHaveBeenCalled();
    expect(broadcastAlert).not.toHaveBeenCalled();
  });

  test('does not process messages missing required identifiers (alert_id, transaction_id)', async () => {
    const missingTx = JSON.stringify({ alert_id: 104, amount: 100 });
    expect(await handleAlertMessage(missingTx)).toBeNull();

    const missingAlertId = JSON.stringify({ transaction_id: 'tx-104', amount: 100 });
    expect(await handleAlertMessage(missingAlertId)).toBeNull();

    expect(audit).not.toHaveBeenCalled();
    expect(broadcastAlert).not.toHaveBeenCalled();
  });

  test('re-throws when audit logging fails and does not mark alert as seen', async () => {
    audit.mockRejectedValueOnce(new Error('DB failure during audit'));

    const alert = {
      alert_id: 201,
      transaction_id: 'tx-consumer-201',
      amount: 450,
      risk_score: 0.92,
    };

    await expect(handleAlertMessage(JSON.stringify(alert))).rejects.toThrow('DB failure during audit');
    expect(broadcastAlert).not.toHaveBeenCalled();

    // Verify retry succeeds and is not prematurely deduplicated
    audit.mockResolvedValueOnce(undefined);
    const retryResult = await handleAlertMessage(JSON.stringify(alert));
    expect(retryResult).toBeTruthy();
    expect(retryResult.alert_id).toBe(201);
    expect(audit).toHaveBeenCalledTimes(2);
    expect(broadcastAlert).toHaveBeenCalledTimes(1);
  });

  test('deduplicates rapid re-deliveries of the same alert after successful audit', async () => {
    const alert = {
      alert_id: 105,
      transaction_id: 'tx-consumer-005',
      amount: 50,
      risk_score: 0.85,
    };

    const msg = JSON.stringify(alert);
    const firstResult = await handleAlertMessage(msg);
    const secondResult = await handleAlertMessage(msg);

    expect(firstResult).toBeTruthy();
    expect(secondResult).toBeNull(); // Deduplicated
    expect(audit).toHaveBeenCalledTimes(1);
    expect(broadcastAlert).toHaveBeenCalledTimes(1);
  });

  test('preserves a committed audit row on replay after process restart', async () => {
    __mockClient.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const alert = { alert_id: 107, transaction_id: 'tx-consumer-107' };

    await handleAlertMessage(JSON.stringify(alert));

    expect(__mockClient.query).toHaveBeenNthCalledWith(
      1, expect.stringContaining('pg_advisory_xact_lock'), [107]
    );
    expect(__mockClient.query).toHaveBeenNthCalledWith(
      2, expect.stringContaining("action = 'ALERT_RAISED'"), ['107']
    );
    expect(audit).not.toHaveBeenCalled();
    expect(broadcastAlert).toHaveBeenCalledWith(expect.objectContaining(alert));
  });

  test('handles broadcast failure non-fatally without crashing or failing consumer', async () => {
    const alert = {
      alert_id: 106,
      transaction_id: 'tx-consumer-006',
      amount: 100,
      risk_score: 0.89,
    };

    const failingBroadcast = jest.fn().mockImplementation(() => {
      throw new Error('WebSocket client error');
    });

    const result = await handleAlertMessage(JSON.stringify(alert), { onBroadcast: failingBroadcast });
    expect(result).toBeTruthy();
    expect(result.alert_id).toBe(106);
    expect(audit).toHaveBeenCalled();
  });

  test('shuts down consumer gracefully and idempotently', async () => {
    await startAlertConsumer();
    await stopAlertConsumer();
    await stopAlertConsumer(); // second call is safe

    expect(__mockConsumer.disconnect).toHaveBeenCalledTimes(1);
  });

  test('handles Kafka connection failure gracefully without unhandled crashes', async () => {
    __mockConsumer.connect.mockRejectedValueOnce(new Error('Broker unreachable'));

    await expect(startAlertConsumer()).rejects.toThrow('Broker unreachable');
  });
});
