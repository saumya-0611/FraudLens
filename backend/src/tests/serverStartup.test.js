const mockServer = {
  once: jest.fn(),
  removeListener: jest.fn(),
  listen: jest.fn((_port, callback) => callback()),
};
const mockEnsureSchema = jest.fn().mockResolvedValue(undefined);
const mockSeedUsers = jest.fn();
const mockSeedSampleData = jest.fn();
const mockQuery = jest.fn();
const mockConnectProducer = jest.fn().mockResolvedValue(undefined);
const mockStartAlertConsumer = jest.fn().mockResolvedValue(undefined);

jest.mock('http', () => ({ createServer: jest.fn(() => mockServer) }));
jest.mock('../app', () => ({}));
jest.mock('../config/env', () => ({ port: 5000, nodeEnv: 'development', pipelineMode: 'inline' }));
jest.mock('../config/db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../websocket/alertSocket', () => ({ initAlertSocket: jest.fn(), closeAlertSocket: jest.fn() }));
jest.mock('../kafka/alertConsumer', () => ({
  startAlertConsumer: (...args) => mockStartAlertConsumer(...args),
  stopAlertConsumer: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../kafka/producer', () => ({
  connectProducer: (...args) => mockConnectProducer(...args),
  disconnectProducer: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../scripts/bootstrapSchema', () => ({ ensureSchema: (...args) => mockEnsureSchema(...args) }));
jest.mock('../../scripts/seed', () => ({ seedUsers: (...args) => mockSeedUsers(...args) }));
jest.mock('../../scripts/seed_sample_data', () => ({ seedSampleData: (...args) => mockSeedSampleData(...args) }));

const server = require('../server');

beforeEach(() => jest.clearAllMocks());

test('waits for safe schema bootstrap and never seeds or deletes account/sample data on startup', async () => {
  let finishBootstrap;
  mockEnsureSchema.mockImplementationOnce(() => new Promise((resolve) => { finishBootstrap = resolve; }));
  const starting = server.startServer();
  expect(mockServer.listen).not.toHaveBeenCalled();
  finishBootstrap();
  await starting;

  expect(mockEnsureSchema).toHaveBeenCalledTimes(1);
  expect(mockServer.listen).toHaveBeenCalledWith(5000, expect.any(Function));
  expect(mockSeedUsers).not.toHaveBeenCalled();
  expect(mockSeedSampleData).not.toHaveBeenCalled();
  expect(mockQuery).not.toHaveBeenCalled();
  expect(mockConnectProducer).toHaveBeenCalledTimes(1);
  expect(mockStartAlertConsumer).not.toHaveBeenCalled();
});

test('does not accept connections when schema bootstrap fails', async () => {
  mockEnsureSchema.mockRejectedValueOnce(new Error('database unavailable'));
  await expect(server.startServer()).rejects.toThrow('database unavailable');
  expect(mockServer.listen).not.toHaveBeenCalled();
  expect(mockConnectProducer).not.toHaveBeenCalled();
});
