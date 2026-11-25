const { Kafka } = require('kafkajs');
const env = require('../config/env');
const {
  scoreTransactionInline,
  persistPendingTransaction,
  startInlineHeartbeat,
  stopInlineHeartbeat,
} = require('../pipeline/inlineScorer');

const isInlineMode = () => (process.env.PIPELINE_MODE || env.pipelineMode || 'kafka').toLowerCase() === 'inline';

const kafka = new Kafka({
  clientId: 'fraudlens-backend',
  brokers: env.kafkaBrokers,
});

const producer = kafka.producer();
const inlineTasks = new Map();
const INLINE_RETRY_DELAYS_MS = [1000, 5000, 15000];

let connected = false;
let connecting = null;
let inlineStopping = false;

function scheduleInlineScore(message, attempt = 0, delay = 0) {
  const transactionId = String(message.transaction_id);
  if (inlineStopping || inlineTasks.has(transactionId)) return;
  const timer = setTimeout(() => {
    const task = scoreTransactionInline(message)
      .then((outcome) => {
        if (outcome?.pending && attempt < INLINE_RETRY_DELAYS_MS.length && !inlineStopping) {
          inlineTasks.delete(transactionId);
          scheduleInlineScore(message, attempt + 1, INLINE_RETRY_DELAYS_MS[attempt]);
        }
      })
      .catch((err) => {
        console.error('[InlineScorer] Transaction processing failed:', err.message);
        if (attempt < INLINE_RETRY_DELAYS_MS.length && !inlineStopping) {
          inlineTasks.delete(transactionId);
          scheduleInlineScore(message, attempt + 1, INLINE_RETRY_DELAYS_MS[attempt]);
        }
      })
      .finally(() => {
        if (inlineTasks.get(transactionId) === task) inlineTasks.delete(transactionId);
      });
    inlineTasks.set(transactionId, task);
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
  inlineTasks.set(transactionId, timer);
}

async function connectProducer() {
  if (isInlineMode()) {
    inlineStopping = false;
    connected = true;
    startInlineHeartbeat();
    return;
  }
  if (connected) return;

  if (!connecting) {
    connecting = producer.connect()
      .then(() => {
        connected = true;
      })
      .catch((error) => {
        connecting = null;
        throw error;
      });
  }

  await connecting;
}

async function publishTransaction(transaction) {
  const message = {
    ...transaction,
    ingested_at: new Date().toISOString(),
  };

  if (isInlineMode()) {
    inlineStopping = false;
    connected = true;
    await persistPendingTransaction(message);
    // Persist first; scoring and bounded transient retries run after the 202 response path.
    scheduleInlineScore(message);
    return;
  }

  await connectProducer();

  await producer.send({
    topic: 'transactions-raw',
    messages: [
      {
        key: String(transaction.account_ref),
        value: JSON.stringify(message),
      },
    ],
  });
}

async function disconnectProducer() {
  if (isInlineMode()) {
    inlineStopping = true;
    inlineTasks.forEach((task) => {
      if (!(task instanceof Promise)) clearTimeout(task);
    });
    inlineTasks.clear();
    stopInlineHeartbeat();
    connected = false;
    return;
  }
  if (connected) {
    await producer.disconnect();
    connected = false;
    connecting = null;
  }
}

function isProducerConnected() {
  return connected || isInlineMode();
}

module.exports = {
  connectProducer,
  publishTransaction,
  disconnectProducer,
  isProducerConnected,
};
