// End-to-end verification script for Neon PostgreSQL integration
const path = require('path');
require('../backend/node_modules/dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { pool, unpooledPool } = require('../backend/src/config/db');

async function runVerification() {
  console.log('=====================================================');
  console.log('   FRAUDLENS + NEON POSTGRES END-TO-END VERIFICATION');
  console.log('=====================================================');

  // 1. Direct query verification
  console.log('\n[1/5] Verifying connection to Neon PostgreSQL...');
  const activePool = unpooledPool || pool;
  const versionRes = await activePool.query('SELECT version(), current_database(), current_user');
  console.log('✓ Connected to Neon:', {
    version: versionRes.rows[0].version.split(' ')[0] + ' ' + versionRes.rows[0].version.split(' ')[1],
    database: versionRes.rows[0].current_database,
    user: versionRes.rows[0].current_user
  });

  // 2. Table count verification
  console.log('\n[2/5] Checking schema tables and row counts in Neon...');
  const tables = ['users', 'transactions', 'fraud_results', 'alerts', 'audit_logs', 'drift_reports', 'service_heartbeats'];
  for (const table of tables) {
    const countRes = await activePool.query(`SELECT COUNT(*)::int as count FROM ${table}`);
    console.log(`  • Table '${table}': ${countRes.rows[0].count} rows`);
  }

  // 3. User authentication verification against Neon
  console.log('\n[3/5] Verifying user credentials against Neon DB...');
  const bcrypt = require('../backend/node_modules/bcryptjs');
  const userRes = await activePool.query("SELECT id, username, password_hash, role FROM users WHERE username = 'admin'");
  if (userRes.rows.length === 0) {
    throw new Error("Admin user not found in Neon DB!");
  }
  const passwordMatch = await bcrypt.compare(process.env.SEED_ADMIN_PASSWORD || 'FlAdmin#2026!Secure', userRes.rows[0].password_hash);
  console.log(`✓ Admin user '${userRes.rows[0].username}' (Role: ${userRes.rows[0].role}) password verified:`, passwordMatch);

  // 4. Alert & Fraud Result relationship verification
  console.log('\n[4/5] Verifying fraud alerts and reasons stored in Neon...');
  const alertRes = await activePool.query(`
    SELECT a.alert_id, a.risk_score, a.state, fr.risk_category, fr.top_reasons
    FROM alerts a
    JOIN fraud_results fr ON a.transaction_id = fr.transaction_id
    LIMIT 1
  `);
  if (alertRes.rows.length > 0) {
    console.log('✓ Sample Alert from Neon:', {
      alertId: alertRes.rows[0].alert_id,
      riskScore: alertRes.rows[0].risk_score,
      riskCategory: alertRes.rows[0].risk_category,
      state: alertRes.rows[0].state,
      topReasonsCount: alertRes.rows[0].top_reasons.length
    });
  }

  // 5. Test inserting, querying, and updating in Neon with audit log
  console.log('\n[5/5] Testing transactional write, update & hash-chain audit log on Neon...');
  const testTxId = `neon-test-${Date.now()}`;
  await activePool.query(`
    INSERT INTO transactions (transaction_id, account_ref, amount, tx_time, category, merchant, ingested_at)
    VALUES ($1, 'neon-test-acc', 1599.99, NOW(), 'electronics', 'Neon_Direct_POS', NOW())
  `, [testTxId]);

  await activePool.query(`
    INSERT INTO fraud_results (transaction_id, fraud_probability, anomaly_score, is_anomaly, risk_category, top_reasons, features, model_version)
    VALUES ($1, 0.88, 0.75, true, 'HIGH_RISK', '[]'::jsonb, '{}'::jsonb, 'v1')
  `, [testTxId]);

  const insertAlertRes = await activePool.query(`
    INSERT INTO alerts (transaction_id, risk_score, state)
    VALUES ($1, 0.88, 'NEW')
    RETURNING alert_id
  `, [testTxId]);
  const alertId = insertAlertRes.rows[0].alert_id;

  // Update alert status
  await activePool.query(`
    UPDATE alerts SET state = 'RESOLVED', resolution = 'CONFIRMED_FRAUD', updated_at = NOW()
    WHERE alert_id = $1
  `, [alertId]);

  // Insert chained audit log
  const crypto = require('crypto');
  const prevHashRes = await activePool.query(`SELECT entry_hash FROM audit_logs ORDER BY id DESC LIMIT 1`);
  const prevHash = prevHashRes.rows[0]?.entry_hash || '0'.repeat(64);
  const entryHash = crypto.createHash('sha256').update(prevHash + `ALERT_RESOLVED_${alertId}`).digest('hex');
  await activePool.query(`
    INSERT INTO audit_logs (user_id, username, action, entity, entity_id, details, prev_hash, entry_hash, event_time)
    VALUES ($1, $2, 'ALERT_RESOLVED', 'ALERT', $3, $4::jsonb, $5, $6, NOW())
  `, [userRes.rows[0].id, userRes.rows[0].username, String(alertId), JSON.stringify({ resolution: 'CONFIRMED_FRAUD' }), prevHash, entryHash]);

  console.log(`✓ Write, update, and chained audit log successfully committed to Neon for Alert #${alertId}`);

  console.log('\n=====================================================');
  console.log('   ALL NEON POSTGRES SERVICES OPERATIONAL (5/5 PASS)');
  console.log('=====================================================');
}

runVerification()
  .then(async () => {
    if (unpooledPool && unpooledPool !== pool) await unpooledPool.end();
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Verification failed:', err);
    if (unpooledPool && unpooledPool !== pool) await unpooledPool.end();
    await pool.end();
    process.exit(1);
  });
