const { Pool, types } = require('pg');
require('dotenv').config();

// OID 1082 = PostgreSQL DATE type. By default node-postgres parses this into
// a JS Date object at local midnight, which is then easy to accidentally
// shift by a day/month when later converted via toISOString() or rendered
// with timezone-aware locale methods. Returning the raw 'YYYY-MM-DD' string
// instead removes that entire class of timezone bugs for pure calendar dates.
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌  Database connection failed:', err.message);
  } else {
    console.log('✅  Connected to PostgreSQL');
    release();
  }
});

module.exports = pool;
