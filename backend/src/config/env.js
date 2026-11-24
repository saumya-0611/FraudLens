// Loads environment variables once. Everything else imports from here.
const path = require('path');
// Local (no docker) runs read the .env in the repo root. In docker, compose injects the variables.
// dotenv never overwrites variables that already exist.
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const rawMlUrl = (process.env.ML_SERVICE_URL || 'http://localhost:8000').trim();
const mlServiceUrl = /^https?:\/\//i.test(rawMlUrl) ? rawMlUrl : `https://${rawMlUrl}`;

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: process.env.DATABASE_SSL === 'true',
  pipelineMode: (process.env.PIPELINE_MODE || 'kafka').toLowerCase(),
  kafkaBrokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  mlServiceUrl,
  internalMlToken: process.env.INTERNAL_ML_TOKEN,
  serviceToken: process.env.SERVICE_TOKEN,
  jwtSecret: process.env.JWT_SECRET,
};

// Fail fast if a required secret is missing (skipped under Jest).
if (env.nodeEnv !== 'test') {
  const required = { DATABASE_URL: env.databaseUrl, JWT_SECRET: env.jwtSecret };
  const missing = Object.keys(required).filter((k) => !required[k]);
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

module.exports = env;