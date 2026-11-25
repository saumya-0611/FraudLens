const { Kafka, logLevel } = require('kafkajs');
const env = require('../config/env');

const kafka = new Kafka({
  clientId: 'fraudlens-readiness',
  brokers: env.kafkaBrokers,
  connectionTimeout: 1000,
  requestTimeout: 1000,
  retry: { retries: 0 },
  logLevel: logLevel.NOTHING,
});
const requiredTopics = ['transactions-raw', 'fraud-alerts'];
let inflight;

async function probe() {
  const admin = kafka.admin();
  try {
    await admin.connect();
    const { topics } = await admin.fetchTopicMetadata({ topics: requiredTopics });
    return requiredTopics.every((name) => topics.some((topic) => (
      topic.name === name &&
      topic.partitions.length > 0 &&
      topic.partitions.every((partition) => partition.leader >= 0)
    )));
  } catch {
    return false;
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

function checkKafkaReadiness() {
  if (!inflight) inflight = probe().finally(() => { inflight = undefined; });
  return inflight;
}

module.exports = { checkKafkaReadiness };
