const http = require('http');
const env = require('./config/env');
const app = require('./app');
const { initAlertSocket, closeAlertSocket } = require('./websocket/alertSocket');
const { startAlertConsumer, stopAlertConsumer } = require('./kafka/alertConsumer');
const { connectProducer, disconnectProducer } = require('./kafka/producer');
const { ensureSchema } = require('../scripts/bootstrapSchema');

const server = http.createServer(app);
const mode = (process.env.PIPELINE_MODE || env.pipelineMode || 'kafka').toLowerCase();
const PIPELINE_RETRY_MS = 5000;
let isShuttingDown = false;
let pipelineRetry;

async function startPipeline() {
  if (isShuttingDown) return;
  const services = [connectProducer()];
  if (mode === 'kafka') services.push(startAlertConsumer());
  const results = await Promise.allSettled(services);
  if (isShuttingDown || results.every((result) => result.status === 'fulfilled')) return;
  console.warn('[Bootstrap] Pipeline initialization failed; retrying.');
  pipelineRetry = setTimeout(startPipeline, PIPELINE_RETRY_MS);
  pipelineRetry.unref();
}

async function startServer() {
  if (mode !== 'inline' && mode !== 'kafka') {
    throw Object.assign(new Error('PIPELINE_MODE must be inline or kafka.'), { code: 'INVALID_PIPELINE_MODE' });
  }
  if (env.nodeEnv !== 'test') await ensureSchema();
  initAlertSocket(server);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(env.port, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    closeAlertSocket();
    throw error;
  }

  console.log(`FraudLens backend listening on port ${env.port} (pipeline=${mode})`);
  if (env.nodeEnv !== 'test') void startPipeline();
  return server;
}

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  clearTimeout(pipelineRetry);
  const closed = new Promise((resolve) => server.close(resolve));
  closeAlertSocket();
  const results = await Promise.allSettled([stopAlertConsumer(), disconnectProducer(), closed]);
  if (results.some((result) => result.status === 'rejected')) {
    console.error('[Shutdown] One or more pipeline services did not close cleanly.');
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  startServer().catch((error) => {
    console.error('[Bootstrap] Backend startup failed:', error.code || error.name);
    process.exitCode = 1;
  });
}

module.exports = server;
module.exports.startServer = startServer;
