const WebSocket = require('ws');
const { getSessionUser } = require('../middleware/authenticate');
const { parseOrigin, configuredWebSocketOrigins } = require('../middleware/browserRequest');
const { maskAccount, stripAccountReferences: sanitizeDeep } = require('../utils/mask');

let wss = null;
let pingInterval = null;

/**
 * Sanitizes an alert payload to guarantee account_ref is NEVER exposed (even nested).
 */
function sanitizeAlert(alert) {
  if (!alert || typeof alert !== 'object') return {};

  let masked = alert.account_masked;
  if (!masked && alert.account_ref) {
    masked = maskAccount(alert.account_ref);
  }

  const cleaned = sanitizeDeep(alert);

  if (masked) {
    cleaned.account_masked = masked;
  } else if (!cleaned.account_masked) {
    cleaned.account_masked = 'XXXX-XXXX';
  }

  return cleaned;
}

/**
 * Initializes the WebSocket server attached to the HTTP server on path /ws/alerts.
 * Enforces the same cookie and active-account checks as REST.
 * Idempotent: closes any existing instance before re-initializing.
 */
function initAlertSocket(server) {
  const allowedOrigins = configuredWebSocketOrigins();
  if (wss) {
    closeAlertSocket();
  }

  const socketServer = new WebSocket.Server({
    server,
    path: '/ws/alerts',
    verifyClient({ req }, done) {
      done(allowedOrigins.has(parseOrigin(req.headers.origin)), 403, 'Forbidden origin');
    },
  });
  wss = socketServer;

  socketServer.on('connection', (ws, req) => {
    ws.on('error', (err) => {
      console.error('[AlertSocket] Client error:', err.message);
    });

    ws.sessionRequest = { headers: { cookie: req.headers.cookie } };
    ws.sessionReady = checkSession(ws).then((user) => {
      if (!user || ws.readyState !== WebSocket.OPEN) return null;
      sendFrame(ws, JSON.stringify({ type: 'READY' }));
      return user;
    });
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });

  // Keep-alive heartbeat: ping every 30 seconds
  const heartbeat = setInterval(() => {
    for (const ws of socketServer.clients) {
      if (ws.isAlive === false) ws.terminate();
      else if (!ws.heartbeatPending && ws.readyState === WebSocket.OPEN) void validateAndPing(ws);
    }
  }, 30000);
  heartbeat.unref();
  pingInterval = heartbeat;

  socketServer.on('close', () => {
    clearInterval(heartbeat);
    if (pingInterval === heartbeat) pingInterval = null;
  });

  return socketServer;
}

function sendFrame(ws, frame) {
  ws.send(frame, (error) => {
    if (error) console.error('[AlertSocket] Client send failed:', error.message);
  });
}

async function validateAndPing(ws) {
  ws.heartbeatPending = true;
  try {
    if (await ws.sessionReady && await checkSession(ws) && ws.readyState === WebSocket.OPEN) {
      ws.isAlive = false;
      ws.ping();
    }
  } catch (error) {
    console.error('[AlertSocket] Heartbeat failed:', error.message);
    ws.terminate();
  } finally {
    ws.heartbeatPending = false;
  }
}

async function checkSession(ws) {
  try {
    const user = await getSessionUser(ws.sessionRequest);
    if (!user) {
      ws.close(4401, 'Unauthorized');
      return null;
    }
    if (ws.authenticatedUser &&
        (String(ws.authenticatedUser.id) !== String(user.id) || ws.authenticatedUser.role !== user.role)) {
      ws.close(4403, 'Session changed');
      return null;
    }
    ws.authenticatedUser = user;
    return user;
  } catch (error) {
    console.error('[AlertSocket] Session check failed:', error.message);
    ws.close(1011, 'Session check failed');
  }
  return null;
}

/**
 * Broadcasts a new alert to all open, authenticated WebSocket clients.
 * Message shape matches CONTRACTS: {"type":"NEW_ALERT","alert":<message>}
 */
async function broadcastAlert(alert) {
  if (!wss || !wss.clients) return;

  const sanitized = sanitizeAlert(alert);
  const payload = JSON.stringify({
    type: 'NEW_ALERT',
    alert: sanitized,
  });

  await Promise.all(Array.from(wss.clients, async (client) => {
    if (await client.sessionReady && client.readyState === WebSocket.OPEN &&
        await checkSession(client) && client.readyState === WebSocket.OPEN) {
      try {
        sendFrame(client, payload);
      } catch (err) {
        console.error('[AlertSocket] Broadcast error to client:', err.message);
      }
    }
  }));
}

/**
 * Gracefully shuts down the WebSocket server and clears the heartbeat interval.
 */
function closeAlertSocket() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  if (wss) {
    try {
      wss.clients.forEach((client) => {
        try {
          client.terminate();
        } catch (e) {}
      });
      wss.close();
    } catch (err) {
      console.error('[AlertSocket] Error closing WebSocket server:', err.message);
    } finally {
      wss = null;
    }
  }
}

function getWebSocketServer() {
  return wss;
}

module.exports = {
  initAlertSocket,
  broadcastAlert,
  sanitizeAlert,
  sanitizeDeep,
  closeAlertSocket,
  getWebSocketServer,
};
