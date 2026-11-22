const WebSocket = require('ws');
const { getSessionUser } = require('../middleware/authenticate');
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
  if (wss) {
    closeAlertSocket();
  }

  wss = new WebSocket.Server({ server, path: '/ws/alerts' });

  wss.on('connection', (ws, req) => {
    ws.sessionRequest = { headers: { cookie: req.headers.cookie } };
    ws.sessionReady = checkSession(ws);
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('error', (err) => {
      console.error('[AlertSocket] Client error:', err.message);
    });
  });

  // Keep-alive heartbeat: ping every 30 seconds
  const heartbeat = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (err) {}
    });
  }, 30000);
  heartbeat.unref();
  pingInterval = heartbeat;

  wss.on('close', () => {
    clearInterval(heartbeat);
    if (pingInterval === heartbeat) pingInterval = null;
  });

  return wss;
}

async function checkSession(ws) {
  try {
    if (await getSessionUser(ws.sessionRequest)) return true;
    ws.close(4401, 'Unauthorized');
  } catch (error) {
    console.error('[AlertSocket] Session check failed:', error.message);
    ws.close(1011, 'Session check failed');
  }
  return false;
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
        client.send(payload);
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
