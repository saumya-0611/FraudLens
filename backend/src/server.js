const http = require('http');
const env = require('./config/env');
const app = require('./app');
const { initAlertSocket, closeAlertSocket } = require('./websocket/alertSocket');
const { startAlertConsumer, stopAlertConsumer } = require('./kafka/alertConsumer');
const { connectProducer, disconnectProducer } = require('./kafka/producer');

// Plain http.Server (not app.listen) so the WebSocket server (B5) attaches to it.
const server = http.createServer(app);

// Attach WebSocket server on /ws/alerts
initAlertSocket(server);

server.listen(env.port, () => {
  console.log(`FraudLens backend listening on port ${env.port}`);
  if (env.nodeEnv !== 'test') {
    connectProducer().catch((err) => {
      console.error('[Kafka] Producer initial connect warning:', err.message);
    });
    startAlertConsumer().catch((err) => {
      console.error('[Kafka] Alert consumer failed to start:', err.message);
    });
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
