const { Kafka } = require('kafkajs');
const env = require('../config/env');

const kafka = new Kafka({
  clientId: 'fraudlens-backend',
  brokers: env.kafkaBrokers,
});

const producer = kafka.producer();

let connected = false;
let connecting = null;

async function connectProducer() {
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
  await connectProducer();

  const message = {
    ...transaction,
    ingested_at: new Date().toISOString(),
  };

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
  if (connected) {
    await producer.disconnect();
    connected = false;
    connecting = null;
  }
}

module.exports = {
  publishTransaction,
  disconnectProducer,
};
