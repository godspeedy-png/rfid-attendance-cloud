// Run this when the database needs new columns (for example after adding student logins):
//   node migrate.js
// It keeps all your students and attendance. It does not touch your admin login.
try { process.loadEnvFile('.env'); } catch (e) {}

if (!process.env.DATABASE_URL) {
  console.log('DATABASE_URL was not found. Run: vercel env pull .env   (then try again)');
  process.exit(1);
}

const db = require('./db');

db.query(require('./schema'))
  .then(() => { console.log('Database is up to date.'); process.exit(0); })
  .catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
