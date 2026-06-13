const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: process.env.DB_PORT,
});

pool.connect()
  .then(() => console.log('✅ Analytics pool connected'))
  .catch((err) => console.error('❌ Analytics pool error:', err.message));

module.exports = pool;
