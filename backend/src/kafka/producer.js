const { Kafka } = require('kafkajs');
const env = require('../config/env');
const {
  acceptTransactionInline,
  startInlineHeartbeat,
  stopInlineHeartbeat,
} = require('../pipeline/inlineScorer');
const { startInlineWorker, stopInlineWorker, wakeInlineWorker } = require('../pipeline/inlineWorker');

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
    startInlineWorker();
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
    await acceptTransactionInline(message);
    wakeInlineWorker();
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
    await stopInlineWorker();
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
