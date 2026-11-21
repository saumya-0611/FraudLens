jest.mock('../kafka/producer', () => ({
  publishTransaction: jest.fn().mockResolvedValue(undefined),
  disconnectProducer: jest.fn(),
}));

const request = require('supertest');
const app = require('../app');
const { publishTransaction } = require('../kafka/producer');

describe('B2 Transaction Route Tests', () => {
  test('POST /api/transactions publishes transaction and returns 202', async () => {
    const transaction = {
      transaction_id: 'tx-test-001',
      account_ref: 'account-123456',
      amount: 125.5,
      tx_time: '2026-11-18T14:00:00.000Z',
      category: 'retail',
    };

    const response = await request(app)
      .post('/api/transactions')
      .send(transaction);

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      transaction_id: 'tx-test-001',
      status: 'ACCEPTED',
    });

    expect(publishTransaction).toHaveBeenCalledWith(transaction);
  });
});
