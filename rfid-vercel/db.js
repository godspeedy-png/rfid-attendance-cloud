// Connects to your Neon Postgres database.
// DATABASE_URL is added automatically by the Neon integration on Vercel.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,                    // small pool: serverless functions open many instances
  idleTimeoutMillis: 10000
});

// Without this, a dropped idle connection would crash the function
pool.on('error', () => {});

module.exports = {
  query: (text, params) => pool.query(text, params)
};
