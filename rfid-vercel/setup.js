// Run this ONCE on your PC: creates the tables in your Neon database and your admin login.
//   node setup.js
const readline = require('readline');
const crypto = require('crypto');

try { process.loadEnvFile('.env'); } catch (e) {}

if (!process.env.DATABASE_URL) {
  console.log('DATABASE_URL was not found. Run: vercel env pull .env   (then try again)');
  process.exit(1);
}

const db = require('./db');

const SCHEMA = require('./schema');

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

(async () => {
  await db.query(SCHEMA);
  console.log('Tables are ready.');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const username = (await ask(rl, 'Choose an admin username: ')).trim();
  const password = await ask(rl, 'Choose a password (at least 8 characters): ');
  rl.close();

  if (!username || password.length < 8) {
    console.log('The username is required and the password needs at least 8 characters. Run it again.');
    process.exit(1);
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  await db.query(
    `INSERT INTO admins (username, salt, hash) VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET salt = $2, hash = $3`,
    [username, salt, hash]
  );
  console.log('Admin saved: ' + username);
  process.exit(0);
})().catch(e => {
  console.error('Setup failed:', e.message);
  process.exit(1);
});
