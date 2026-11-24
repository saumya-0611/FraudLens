// One shared connection pool for the whole backend.
const { Pool } = require('pg');
const env = require('./env');

const poolConfig = { connectionString: env.databaseUrl, max: 10 };
if (env.databaseSsl || (typeof env.databaseUrl === 'string' && env.databaseUrl.includes('sslmode=require'))) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

// Direct (unpooled) connection for schema bootstrap and migrations (Neon best practice)
let unpooledPool = pool;
if (env.databaseUrlUnpooled && env.databaseUrlUnpooled !== env.databaseUrl) {
  const unpooledConfig = { connectionString: env.databaseUrlUnpooled, max: 5 };
  if (env.databaseSsl || (typeof env.databaseUrlUnpooled === 'string' && env.databaseUrlUnpooled.includes('sslmode=require'))) {
    unpooledConfig.ssl = { rejectUnauthorized: false };
  }
  unpooledPool = new Pool(unpooledConfig);
  unpooledPool.on('error', (err) => console.error('Unexpected unpooled PG error:', err.message));
}

// Idle clients can emit errors (e.g. DB restarts). Log instead of crashing.
pool.on('error', (err) => console.error('Unexpected PG pool error:', err.message));

// Parameterised queries only: query('SELECT ... WHERE id = $1', [id])
const query = (text, params) => pool.query(text, params);
const unpooledQuery = (text, params) => unpooledPool.query(text, params);

module.exports = { pool, query, unpooledPool, unpooledQuery };