const http = require('http');
const env = require('./config/env');
const app = require('./app');

// Plain http.Server (not app.listen) so the WebSocket server (B5) can attach to it later.
const server = http.createServer(app);

server.listen(env.port, () => {
  console.log(`FraudLens backend listening on port ${env.port}`);
});

// Stop cleanly on docker stop / Ctrl+C.
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = server;