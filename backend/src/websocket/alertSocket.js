const WebSocket = require('ws');
const { verifyRequestCookie } = require('../utils/jwt');
const { maskAccount } = require('../utils/mask');

let wss = null;
let pingInterval = null;

/**
 * Recursively strips account_ref from all levels of an object or array.
 */
function sanitizeDeep(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  if (obj instanceof Date || obj instanceof RegExp || (typeof Buffer !== 'undefined' && Buffer.isBuffer(obj))) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeDeep);
  }
  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'account_ref') {
      continue; // Strip at any level
    }
    cleaned[key] = typeof value === 'object' && value !== null
      ? sanitizeDeep(value)
      : value;
  }
  return cleaned;
}

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
 * Enforces authentication via verifyRequestCookie(req).
 * Idempotent: closes any existing instance before re-initializing.
 */
function initAlertSocket(server) {
  if (wss) {
    closeAlertSocket();
  }

  wss = new WebSocket.Server({ server, path: '/ws/alerts' });

  wss.on('connection', (ws, req) => {
    let user = null;
    try {
      user = verifyRequestCookie(req);
    } catch (err) {
      console.warn('[AlertSocket] Error verifying auth cookie:', err.message);
    }

    if (!user) {
      // CONTRACTS / Task B5 rule: close with code 4401 if unauthenticated
      ws.close(4401, 'Unauthorized');
      return;
    }

    ws.user = user;
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('error', (err) => {
      console.error('[AlertSocket] Client error:', err.message);
    });
  });

  // Keep-alive heartbeat: ping every 30 seconds
  pingInterval = setInterval(() => {
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
  if (typeof pingInterval.unref === 'function') {
    pingInterval.unref();
  }

  wss.on('close', () => {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  });

  return wss;
}

/**
 * Broadcasts a new alert to all open, authenticated WebSocket clients.
 * Message shape matches CONTRACTS: {"type":"NEW_ALERT","alert":<message>}
 */
function broadcastAlert(alert) {
  if (!wss || !wss.clients) return;

  const sanitized = sanitizeAlert(alert);
  const payload = JSON.stringify({
    type: 'NEW_ALERT',
    alert: sanitized,
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.user) {
      try {
        client.send(payload);
      } catch (err) {
        console.error('[AlertSocket] Broadcast error to client:', err.message);
      }
    }
  });
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
