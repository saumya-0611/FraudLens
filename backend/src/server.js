const http = require('http');
const env = require('./config/env');
const app = require('./app');
const { initAlertSocket, closeAlertSocket } = require('./websocket/alertSocket');
const { startAlertConsumer, stopAlertConsumer } = require('./kafka/alertConsumer');
const { connectProducer, disconnectProducer } = require('./kafka/producer');
const { query } = require('./config/db');
const { ensureSchema } = require('../scripts/bootstrapSchema');
const { seedUsers } = require('../scripts/seed');
const { seedSampleData } = require('../scripts/seed_sample_data');

// Plain http.Server (not app.listen) so the WebSocket server (B5) attaches to it.
const server = http.createServer(app);

// Attach WebSocket server on /ws/alerts
initAlertSocket(server);

const inlineMode = (process.env.PIPELINE_MODE || env.pipelineMode || 'kafka').toLowerCase() === 'inline';

server.listen(env.port, () => {
  console.log(`FraudLens backend listening on port ${env.port} (pipeline=${inlineMode ? 'inline' : 'kafka'})`);
  if (env.nodeEnv !== 'test') {
    ensureSchema()
      .then(() => query("DELETE FROM users WHERE password_hash !~ '^\\$2[aby]\\$'"))
      .then(() => seedUsers())
      .then(async () => {
        if (process.env.AUTO_SEED_SAMPLE === 'true') {
          const { rows } = await query('SELECT COUNT(*)::int AS cnt FROM transactions');
          if (Number(rows?.[0]?.cnt || 0) === 0) {
            await seedSampleData(60);
          }
        }
      })
      .catch((err) => {
        console.error('[Bootstrap] Initial schema/seed warning:', err.message);
      });

    connectProducer().catch((err) => {
      console.error('[Kafka] Producer initial connect warning:', err.message);
    });

    if (!inlineMode) {
      startAlertConsumer().catch((err) => {
        console.error('[Kafka] Alert consumer failed to start:', err.message);
      });
    }
  }
});

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
