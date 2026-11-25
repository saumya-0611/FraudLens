const { Kafka } = require('kafkajs');
const env = require('../config/env');
const { appendAudit } = require('../audit/auditLogger');
const { withTransaction } = require('../config/db');
const { broadcastAlert, sanitizeAlert } = require('../websocket/alertSocket');

const kafka = new Kafka({
  clientId: 'fraudlens-backend',
  brokers: env.kafkaBrokers,
});

const consumer = kafka.consumer({ groupId: 'backend-alerts' });

let isRunning = false;
let isStarting = false;
let isStopping = false;

// Bounded in-memory Set for deduplicating recent alert deliveries
const seenAlerts = new Set();
const MAX_DEDUP_SIZE = 5000;

function hasSeen(id) {
  if (!id) return false;
  return seenAlerts.has(String(id));
}

function markSeen(id) {
  if (!id) return;
  const strId = String(id);
  seenAlerts.add(strId);
  if (seenAlerts.size > MAX_DEDUP_SIZE) {
    const oldest = seenAlerts.values().next().value;
    seenAlerts.delete(oldest);
  }
}

function resetDeduplicationCache() {
  seenAlerts.clear();
}

/**
 * Safely parses and validates an alert message from Kafka against CONTRACTS.md Section 4.
 * Returns the deeply sanitized alert object or null if invalid.
 */
function parseAlertMessage(rawMessage) {
  if (!rawMessage) return null;

  let parsed;
  try {
    const str = typeof rawMessage === 'string'
      ? rawMessage
      : rawMessage.toString('utf8');
    parsed = JSON.parse(str);
  } catch (err) {
    console.warn('[AlertConsumer] Malformed JSON message:', err.message);
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const alertId = typeof parsed.alert_id === 'number' || typeof parsed.alert_id === 'string'
    ? Number(parsed.alert_id)
    : NaN;
  if (!Number.isInteger(alertId) || alertId <= 0 || alertId > 2147483647 ||
      typeof parsed.transaction_id !== 'string' || !parsed.transaction_id) {
    console.warn('[AlertConsumer] Missing required identifiers (alert_id, transaction_id)');
    return null;
  }

  // Deep sanitize to guarantee no account_ref exists in the alert object graph
  return sanitizeAlert(parsed);
}

async function auditAlertOnce(entry) {
  await withTransaction(async (client) => {
    // Separate the per-alert lock from appendAudit's single-key chain lock.
    await client.query('SELECT pg_advisory_xact_lock(2026, $1::integer)', [Number(entry.entityId)]);
    const result = await client.query(
      `SELECT 1 FROM audit_logs
       WHERE action = 'ALERT_RAISED' AND entity = 'alert' AND entity_id = $1
       LIMIT 1`,
      [entry.entityId]
    );
    if (result.rows.length === 0) await appendAudit(client, entry);
  });
}

/**
 * Processes a single alert event: validates, checks deduplication, writes audit, and broadcasts.
 * Throws on audit failure so Kafka can retry safely without losing audit rows.
 */
async function handleAlertMessage(
  rawMessage,
  { onBroadcast = broadcastAlert, onAudit = auditAlertOnce } = {}
) {
  const alert = parseAlertMessage(rawMessage);
  if (!alert) {
    return null;
  }

  const dedupKey = String(Number(alert.alert_id));

  // If already successfully processed and recorded, do not duplicate audit or broadcast
  if (hasSeen(dedupKey)) {
    return null;
  }

  // 1. Audit log MUST succeed first (CONTRACTS section 9: hash-chained row)
  if (typeof onAudit === 'function') {
    try {
      await onAudit({
        userId: null,
        username: 'system',
        action: 'ALERT_RAISED',
        entity: 'alert',
        entityId: dedupKey,
        details: {
          transaction_id: alert.transaction_id,
          risk_score: alert.risk_score,
          risk_category: alert.risk_category,
          amount: alert.amount,
          category: alert.category,
        },
      });
    } catch (auditErr) {
      console.error('[AlertConsumer] Audit logging failed; message will be retried by Kafka:', auditErr.message);
      // Re-throw so KafkaJS does not commit offset and will retry
      throw auditErr;
    }
  }

  // 2. Broadcast to all connected WebSocket clients (non-fatal if a client connection fails)
  if (typeof onBroadcast === 'function') {
    try {
      await onBroadcast(alert);
    } catch (broadcastErr) {
      console.error('[AlertConsumer] WebSocket broadcast failed:', broadcastErr.message);
    }
  }

  // 3. Mark as successfully processed ONLY AFTER audit succeeds
  markSeen(dedupKey);

  return alert;
}

/**
 * Connects and starts the Kafka alert consumer group. Idempotent.
 */
async function startAlertConsumer(options = {}) {
  if (isRunning || isStarting) return;
  isStarting = true;

  try {
    await consumer.connect();
    // Resume the committed group offset. A new group also needs alerts queued
    // before its first connection.
    await consumer.subscribe({ topic: 'fraud-alerts', fromBeginning: true });

    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message || !message.value) return;
        await handleAlertMessage(message.value, options);
      },
    });

    isRunning = true;
  } catch (err) {
    console.error('[AlertConsumer] Failed to connect or subscribe:', err.message);
    throw err;
  } finally {
    isStarting = false;
  }
}

/**
 * Disconnects and shuts down the consumer cleanly. Idempotent.
 */
async function stopAlertConsumer() {
  if (!isRunning && !isStarting) return;
  if (isStopping) return;
  isStopping = true;

  try {
    await consumer.disconnect();
  } catch (err) {
    console.error('[AlertConsumer] Error disconnecting consumer:', err.message);
    throw err;
  } finally {
    isRunning = false;
    isStarting = false;
    isStopping = false;
  }
}

function isConsumerRunning() {
  return isRunning;
}

module.exports = {
  consumer,
  startAlertConsumer,
  stopAlertConsumer,
  handleAlertMessage,
  parseAlertMessage,
  isConsumerRunning,
  hasSeen,
  markSeen,
  resetDeduplicationCache,
};
