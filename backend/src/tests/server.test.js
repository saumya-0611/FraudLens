jest.mock('http', () => ({ createServer: jest.fn() }));
jest.mock('../app', () => jest.fn());
jest.mock('../config/env', () => ({ nodeEnv: 'development', pipelineMode: 'inline', port: 5000 }));
jest.mock('../config/db', () => ({ query: jest.fn() }));
jest.mock('../websocket/alertSocket', () => ({
  initAlertSocket: jest.fn(),
  closeAlertSocket: jest.fn(),
}));
jest.mock('../kafka/alertConsumer', () => ({
  startAlertConsumer: jest.fn().mockResolvedValue(),
  stopAlertConsumer: jest.fn().mockResolvedValue(),
}));
jest.mock('../kafka/producer', () => ({
  connectProducer: jest.fn().mockResolvedValue(),
  disconnectProducer: jest.fn().mockResolvedValue(),
}));
jest.mock('../../scripts/bootstrapSchema', () => ({ ensureSchema: jest.fn().mockResolvedValue() }));
jest.mock('../../scripts/seed', () => ({
  seedUsers: jest.fn().mockResolvedValue(),
  SeedConfigurationError: class extends Error {},
}));
jest.mock('../../scripts/seed_sample_data', () => ({ seedSampleData: jest.fn().mockResolvedValue() }));

let savedEnv;
beforeEach(() => {
  savedEnv = process.env;
  process.env = { ...process.env, AUTO_SEED_SAMPLE: 'false', PIPELINE_MODE: 'inline' };
});
afterEach(() => {
  process.env = savedEnv;
  jest.restoreAllMocks();
});

async function runStartup(diagnostic) {
  const probes = {};
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(process, 'on').mockImplementation(() => process);

  jest.isolateModules(() => {
    probes.server = { listen: jest.fn() };
    require('http').createServer.mockReturnValue(probes.server);
    probes.query = require('../config/db').query.mockImplementation(diagnostic);
    probes.ensureSchema = require('../../scripts/bootstrapSchema').ensureSchema;
    probes.seedUsers = require('../../scripts/seed').seedUsers;
    probes.seedSampleData = require('../../scripts/seed_sample_data').seedSampleData;
    probes.connectProducer = require('../kafka/producer').connectProducer;
    probes.startAlertConsumer = require('../kafka/alertConsumer').startAlertConsumer;
    require('../server');
  });

  const [[port, listening]] = probes.server.listen.mock.calls;
  expect(port).toBe(5000);
  listening();
  await new Promise(setImmediate);
  return { ...probes, warn };
}

test('startup diagnoses malformed hashes by count and never deletes accounts', async () => {
  const { ensureSchema, query, seedUsers, seedSampleData, connectProducer, startAlertConsumer, warn } =
    await runStartup(async () => ({ rows: [{ count: 2 }] }));
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0]).toMatch(/^SELECT COUNT\(\*\)::int AS count FROM users WHERE password_hash IS NOT NULL AND password_hash !~ \$1$/);
  expect(ensureSchema.mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[0]);
  expect(query.mock.invocationCallOrder[0]).toBeLessThan(seedUsers.mock.invocationCallOrder[0]);
  expect(warn.mock.calls).toEqual([['[Bootstrap] Accounts with malformed password hashes:', 2]]);
  expect(seedSampleData).not.toHaveBeenCalled();
  expect(connectProducer).toHaveBeenCalledTimes(1);
  expect(startAlertConsumer).not.toHaveBeenCalled();
});

test('diagnostic failure stays redacted and does not prevent seeding or sample bootstrap', async () => {
  process.env.AUTO_SEED_SAMPLE = 'true';
  const { query, seedUsers, seedSampleData, warn } = await runStartup(async (sql) => {
    if (sql.includes('FROM users')) throw new Error('sensitive fixture from database');
    return { rows: [{ cnt: 0 }] };
  });
  expect(query).toHaveBeenCalledTimes(2);
  expect(seedUsers).toHaveBeenCalledTimes(1);
  expect(seedSampleData).toHaveBeenCalledWith(60);
  expect(warn.mock.calls).toEqual([['[Bootstrap] Could not check for malformed password hashes.']]);
});
