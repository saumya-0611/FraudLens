const { Kafka } = require('kafkajs');
const env = require('../config/env');
const {
  scoreTransactionInline,
  startInlineHeartbeat,
  stopInlineHeartbeat,
} = require('../pipeline/inlineScorer');

const isInlineMode = () => (process.env.PIPELINE_MODE || env.pipelineMode || 'kafka').toLowerCase() === 'inline';

const kafka = new Kafka({
  clientId: 'fraudlens-backend',
  brokers: env.kafkaBrokers,
});

const producer = kafka.producer();

let connected = false;
let connecting = null;

async function connectProducer() {
  if (isInlineMode()) {
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
    connected = true;
    // Score asynchronously so POST /api/transactions returns 202 Accepted immediately
    setImmediate(() => {
      scoreTransactionInline(message).catch((err) => {
        console.error('[InlineScorer] Transaction processing failed:', err.message);
      });
    });
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
