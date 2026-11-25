// Read-only schema checks against an approved disposable loopback PostgreSQL instance.
const { approvedDatabase } = require('./proofConfig');

async function main() {
  let config;
  try {
    config = approvedDatabase(process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  let client;
  try {
    const { Client } = require('../backend/node_modules/pg');
    client = new Client({
      ...config,
      ssl: false,
      sslnegotiation: 'postgres',
      replication: 'false',
      application_name: 'fraudlens-read-only-proof',
      options: '-c default_transaction_read_only=on',
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      query_timeout: 6000,
    });
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const { rows: [metadata] } = await client.query(`
      SELECT current_database() AS database,
             current_setting('transaction_read_only') AS read_only,
             to_regclass('public.users') IS NOT NULL AS users,
             to_regclass('public.transactions') IS NOT NULL AS transactions,
             to_regclass('public.fraud_results') IS NOT NULL AS fraud_results,
             to_regclass('public.alerts') IS NOT NULL AS alerts,
             to_regclass('public.audit_logs') IS NOT NULL AS audit_logs,
             to_regclass('public.oauth_identities') IS NOT NULL
               AND to_regclass('public.oauth_attempts') IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM pg_attribute
                 WHERE attrelid = to_regclass('public.users') AND attname = 'password_hash'
                   AND NOT attnotnull AND NOT attisdropped
               ) AS oauth_schema_ready
    `);
    if (metadata.database !== config.database || metadata.read_only !== 'on') {
      console.error('Database proof refused an unexpected database or writable transaction.');
      process.exitCode = 1;
    } else if (!['users', 'transactions', 'fraud_results', 'alerts', 'audit_logs'].every((table) => metadata[table])) {
      console.error('Database proof failed because required FraudLens relations are missing.');
      process.exitCode = 1;
    } else {
      console.log('Disposable PostgreSQL schema check passed in a read-only transaction.');
      console.log('OAuth schema prerequisites present: ' + (metadata.oauth_schema_ready ? 'yes' : 'no') + '.');
    }
    await client.query('ROLLBACK');
  } catch {
    console.error('Database proof failed. Check the approved loopback PostgreSQL instance and explicit credentials.');
    process.exitCode = 1;
  } finally {
    // Closing the session also rolls back any transaction still open after an error.
    await client?.end().catch(() => {
      console.error('Database proof could not close its PostgreSQL session cleanly.');
      process.exitCode = 1;
    });
  }
}

void main();
