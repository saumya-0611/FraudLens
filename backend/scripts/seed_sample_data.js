// Seed ~200 realistic sample rows into transactions, fraud_results, and alerts (Task B3)
// so the Frontend, Postman, and Swagger can be demonstrated even without running Kafka/Spark.
const { unpooledPool, pool } = require('../src/config/db');
const activePool = unpooledPool || pool;

const CATEGORIES = [
  'shopping_net', 'grocery_pos', 'gas_transport', 'misc_net',
  'shopping_pos', 'food_dining', 'entertainment', 'health_fitness',
];
const ACCOUNTS = [
  '2703186189652095', '4532015112830366', '6011000990139424', '378282246310005',
];

async function seedSampleData(count = 200) {
  const client = await activePool.connect();
  const now = Date.now();
  let insertedTx = 0;
  let insertedAlerts = 0;

  try {
    await client.query('BEGIN');
    for (let i = 1; i <= count; i++) {
      const txId = `sample-tx-${String(i).padStart(4, '0')}`;
      const accountRef = ACCOUNTS[i % ACCOUNTS.length];
      const isHighRisk = i % 15 === 0;
      const isSuspicious = !isHighRisk && i % 7 === 0;
      const amount = isHighRisk ? 2800 + (i * 17) : isSuspicious ? 620 + (i * 5) : 18.5 + (i % 90);
      const category = CATEGORIES[i % CATEGORIES.length];
      const merchant = isHighRisk ? 'fraud_Kutch LLC' : 'Local_Merchant_POS';
      const txTime = new Date(now - (count - i) * 30000).toISOString();
      const ingestedAt = new Date(now - (count - i) * 30000 + 120).toISOString();
      const scoredAt = new Date(now - (count - i) * 30000 + 840).toISOString();

      await client.query(
        `INSERT INTO transactions (
           transaction_id, account_ref, amount, tx_time, category, merchant,
           lat, lon, merch_lat, merch_lon, customer_age, ingested_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 36.0788, -81.1781, 36.5112, -82.0483, 34, $7)
         ON CONFLICT (transaction_id) DO NOTHING`,
        [txId, accountRef, amount.toFixed(2), txTime, category, merchant, ingestedAt]
      );
      insertedTx++;

      const prob = isHighRisk ? 0.94 : isSuspicious ? 0.54 : 0.03;
      const anom = isHighRisk ? 0.88 : isSuspicious ? 0.68 : 0.12;
      const isAnomaly = isHighRisk || isSuspicious;
      const riskCat = isHighRisk ? 'HIGH_RISK' : isSuspicious ? 'SUSPICIOUS' : 'LEGITIMATE';
      const reasons = isHighRisk
        ? [
            { feature: 'amount_ratio', impact: 0.42, text: "Amount is 38x this account's usual average" },
            { feature: 'amount', impact: 0.31, text: `High transaction amount ($${amount.toFixed(2)})` },
            { feature: 'distance_km', impact: 0.19, text: 'Merchant is 98.4 km away from customer location' },
          ]
        : [];

      await client.query(
        `INSERT INTO fraud_results (
           transaction_id, fraud_probability, anomaly_score, is_anomaly,
           risk_category, top_reasons, features, model_version, scored_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'v1', $8)
         ON CONFLICT (transaction_id) DO NOTHING`,
        [
          txId,
          prob,
          anom,
          isAnomaly,
          riskCat,
          JSON.stringify(reasons),
          JSON.stringify({ amount, amount_ratio: isHighRisk ? 38.0 : 1.2, hour: 3, is_night: isHighRisk ? 1 : 0 }),
          scoredAt,
        ]
      );

      if (isHighRisk) {
        await client.query(
          `INSERT INTO alerts (transaction_id, risk_score, state, created_at, updated_at)
           VALUES ($1, $2, 'NEW', $3, $3)
           ON CONFLICT (transaction_id) DO NOTHING`,
          [txId, prob, scoredAt]
        );
        insertedAlerts++;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log(`[seed:sample] Seeded ${insertedTx} sample transactions and ${insertedAlerts} HIGH_RISK alerts.`);
}

async function main() {
  try {
    await seedSampleData(200);
  } finally {
    await activePool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[seed:sample] Failed:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { seedSampleData };
