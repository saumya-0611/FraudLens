// One shared connection pool for the whole backend.
const { Pool } = require('pg');
const env = require('./env');

const poolConfig = { connectionString: env.databaseUrl, max: 10 };
if (env.databaseSsl || (typeof env.databaseUrl === 'string' && env.databaseUrl.includes('sslmode=require'))) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

// Idle clients can emit errors (e.g. DB restarts). Log instead of crashing.
pool.on('error', (err) => console.error('Unexpected PG pool error:', err.message));

// Parameterised queries only: query('SELECT ... WHERE id = $1', [id])
const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };