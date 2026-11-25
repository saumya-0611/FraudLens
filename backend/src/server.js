const http = require('http');
const env = require('./config/env');
const app = require('./app');
const { initAlertSocket, closeAlertSocket } = require('./websocket/alertSocket');
const { startAlertConsumer, stopAlertConsumer } = require('./kafka/alertConsumer');
const { connectProducer, disconnectProducer } = require('./kafka/producer');
const { ensureSchema } = require('../scripts/bootstrapSchema');

// Plain http.Server (not app.listen) so the WebSocket server (B5) attaches to it.
const server = http.createServer(app);

// Attach WebSocket server on /ws/alerts
initAlertSocket(server);

const inlineMode = (process.env.PIPELINE_MODE || env.pipelineMode || 'kafka').toLowerCase() === 'inline';

async function startServer() {
  if (env.nodeEnv !== 'test') await ensureSchema();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.port, resolve);
  });
  console.log(`FraudLens backend listening on port ${env.port} (pipeline=${inlineMode ? 'inline' : 'kafka'})`);

  if (env.nodeEnv !== 'test') {
    connectProducer().catch((err) => {
      console.error('[Kafka] Producer initial connect warning:', err.message);
    });

    if (!inlineMode) {
      startAlertConsumer().catch((err) => {
        console.error('[Kafka] Alert consumer failed to start:', err.message);
      });
    }
  }
  return server;
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('[Bootstrap] Backend startup failed:', err.code || err.message);
    process.exitCode = 1;
  });
}

// Stop cleanly on docker stop / Ctrl+C.
let isShuttingDown = false;
const shutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  try {
    await stopAlertConsumer();
    await disconnectProducer();
  } catch (err) {
    console.error('[Shutdown] Error stopping alert consumer:', err.message);
  }
  closeAlertSocket();
  server.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = server;
module.exports.startServer = startServer;
