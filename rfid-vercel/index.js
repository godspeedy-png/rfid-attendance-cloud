const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const SESSION_SECRET = process.env.SESSION_SECRET || '';
const SCAN_KEY = process.env.SCAN_KEY || '';
const SESSION_MS = 8 * 60 * 60 * 1000;   // stay logged in for 8 hours
const MAX_ATTEMPTS = 5;                  // wrong passwords before lockout
const LOCK_MS = 15 * 60 * 1000;          // lockout length: 15 minutes

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '4mb' }));  // Vercel allows request bodies up to about 4.5 MB

// ---------- THE WEB PAGES ----------
// The pages are read here with fixed file names, so Vercel always includes them with the server,
// even when its own static-file serving does not pick up the public folder.
function tryRead(read) {
  try { return read(); } catch (e) { return null; }
}
const FILES = {
  indexHtml:     tryRead(() => fs.readFileSync(path.join(__dirname, 'public', 'index.html'))),
  studentHtml:   tryRead(() => fs.readFileSync(path.join(__dirname, 'public', 'student.html'))),
  studentPwHtml: tryRead(() => fs.readFileSync(path.join(__dirname, 'public', 'student-passwords.html'))),
  manifest:      tryRead(() => fs.readFileSync(path.join(__dirname, 'public', 'manifest.json'))),
  serviceWorker: tryRead(() => fs.readFileSync(path.join(__dirname, 'public', 'sw.js'))),
  icon192:       tryRead(() => fs.readFileSync(path.join(__dirname, 'public', 'icon-192.png'))),
  icon512:       tryRead(() => fs.readFileSync(path.join(__dirname, 'public', 'icon-512.png')))
};

function sendFile(res, data, type, name) {
  if (!data) {
    return res.status(404).type('html').send(
      '<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<body style="font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;line-height:1.5">' +
      '<h2>The server is running, but <code>public/' + name + '</code> is not in this deployment.</h2>' +
      '<p>Check your GitHub repository. The file must be at exactly <b>public/' + name + '</b> ' +
      '(a folder called <code>public</code>, in lowercase, at the top level of the repository). ' +
      'When you add it, Vercel rebuilds by itself.</p>' +
      '<p>To see which files the server found, open <a href="/api/health">/api/health</a>.</p></body>'
    );
  }
  res.type(type).send(data);
}

app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    server: 'running',
    filesFound: {
      'public/index.html': !!FILES.indexHtml,
      'public/student.html': !!FILES.studentHtml,
      'public/student-passwords.html': !!FILES.studentPwHtml,
      'public/manifest.json': !!FILES.manifest,
      'public/sw.js': !!FILES.serviceWorker,
      'public/icon-192.png': !!FILES.icon192,
      'public/icon-512.png': !!FILES.icon512
    },
    settingsFound: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      SESSION_SECRET: !!process.env.SESSION_SECRET,
      SCAN_KEY: !!process.env.SCAN_KEY,
      APP_TIMEZONE: !!process.env.APP_TIMEZONE
    }
  });
});

app.get(['/', '/index.html'], (req, res) => sendFile(res, FILES.indexHtml, 'html', 'index.html'));
app.get('/student.html', (req, res) => sendFile(res, FILES.studentHtml, 'html', 'student.html'));
app.get('/student-passwords.html', (req, res) => sendFile(res, FILES.studentPwHtml, 'html', 'student-passwords.html'));
app.get('/manifest.json', (req, res) => sendFile(res, FILES.manifest, 'application/manifest+json', 'manifest.json'));
app.get('/sw.js', (req, res) => sendFile(res, FILES.serviceWorker, 'application/javascript', 'sw.js'));
app.get('/icon-192.png', (req, res) => sendFile(res, FILES.icon192, 'image/png', 'icon-192.png'));
app.get('/icon-512.png', (req, res) => sendFile(res, FILES.icon512, 'image/png', 'icon-512.png'));

app.use(express.static('public'));        // anything else in the public folder

// ---------- HELPERS ----------

// Today's date and time in YOUR timezone (set APP_TIMEZONE, e.g. Africa/Accra)
function nowParts() {
  const tz = process.env.APP_TIMEZONE || 'UTC';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return {
    date: get('year') + '-' + get('month') + '-' + get('day'),
    time: get('hour') + ':' + get('minute') + ':' + get('second')
  };
}

function clientIp(req) {
  return String(req.headers['x-real-ip'] || req.ip || 'unknown');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function isDuplicate(e) {
  return e && e.code === '23505';   // Postgres "unique violation"
}

// ----- Login sessions kept in a signed cookie (no server memory needed) -----
// Admins and students use DIFFERENT cookies and DIFFERENT roles, so a student can never act as an admin.
const STUDENT_SESSION_MS = 4 * 60 * 60 * 1000;   // students stay logged in for 4 hours
const STUDENT_MIN_PASSWORD = 6;

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function makeToken(role, subject, lifetimeMs) {
  const payload = Buffer.from(JSON.stringify({ r: role, s: subject, e: Date.now() + lifetimeMs })).toString('base64url');
  return payload + '.' + sign(payload);
}

function readToken(token, role) {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.r !== role) return null;          // wrong kind of login for this door
    return data.e > Date.now() ? data : null;
  } catch (e) {
    return null;
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}

function setCookie(req, res, name, value, maxAgeSeconds) {
  let cookie = name + '=' + value + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAgeSeconds;
  if (req.secure) cookie += '; Secure';
  res.setHeader('Set-Cookie', cookie);
}

function currentUser(req) {          // admin
  const data = readToken(getCookie(req, 'session'), 'admin');
  return data ? data.s : null;
}

function currentStudentPk(req) {     // student
  const data = readToken(getCookie(req, 'student'), 'student');
  return data ? data.s : null;
}

// ----- Login lockout (shared by the student login) -----
async function isLocked(key) {
  const rec = (await db.query('SELECT locked_until FROM login_attempts WHERE ip = $1', [key])).rows[0];
  return !!rec && Number(rec.locked_until) > Date.now();
}

async function recordFailure(key) {
  const now = Date.now();
  const rec = (await db.query('SELECT count, locked_until FROM login_attempts WHERE ip = $1', [key])).rows[0];
  let count = rec ? rec.count : 0;
  if (rec && Number(rec.locked_until) !== 0 && Number(rec.locked_until) <= now) count = 0;
  count += 1;
  const lockedUntil = count >= MAX_ATTEMPTS ? now + LOCK_MS : 0;
  await db.query(
    `INSERT INTO login_attempts (ip, count, locked_until) VALUES ($1, $2, $3)
     ON CONFLICT (ip) DO UPDATE SET count = $2, locked_until = $3`,
    [key, count, lockedUntil]
  );
}

async function clearFailures(key) {
  await db.query('DELETE FROM login_attempts WHERE ip = $1', [key]);
}

// Remember the latest scan so the website can show it live
async function rememberScan(info) {
  try {
    await db.query(
      `INSERT INTO last_scan (id, n, data) VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET n = $1, data = $2`,
      [Date.now(), JSON.stringify(info)]
    );
  } catch (e) { /* never let this break a scan */ }
}

// ---------- SETUP CHECK ----------
app.use('/api', (req, res, next) => {
  if (!process.env.DATABASE_URL || !SESSION_SECRET) {
    return res.status(500).json({ error: 'Server is not configured: DATABASE_URL and SESSION_SECRET must be set' });
  }
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ---------- LOGIN (open routes) ----------
app.post('/api/login', async (req, res) => {
  const ip = clientIp(req);
  const now = Date.now();

  const rec = (await db.query('SELECT count, locked_until FROM login_attempts WHERE ip = $1', [ip])).rows[0];
  if (rec && Number(rec.locked_until) > now) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }

  const username = String(req.body.username || '');
  const password = String(req.body.password || '');

  const admin = (await db.query('SELECT username, salt, hash FROM admins WHERE username = $1', [username])).rows[0];
  let ok = false;
  if (admin) {
    const given = crypto.scryptSync(password, admin.salt, 64);
    const real = Buffer.from(admin.hash, 'hex');
    ok = given.length === real.length && crypto.timingSafeEqual(given, real);
  }

  if (!ok) {
    let count = rec ? rec.count : 0;
    if (rec && Number(rec.locked_until) !== 0 && Number(rec.locked_until) <= now) count = 0;  // old lockout expired
    count += 1;
    const lockedUntil = count >= MAX_ATTEMPTS ? now + LOCK_MS : 0;
    await db.query(
      `INSERT INTO login_attempts (ip, count, locked_until) VALUES ($1, $2, $3)
       ON CONFLICT (ip) DO UPDATE SET count = $2, locked_until = $3`,
      [ip, count, lockedUntil]
    );
    return res.status(401).json({ error: 'Wrong username or password' });
  }

  await db.query('DELETE FROM login_attempts WHERE ip = $1', [ip]);
  setCookie(req, res, 'session', makeToken('admin', admin.username, SESSION_MS), SESSION_MS / 1000);
  res.json({ ok: true, username: admin.username });
});

app.post('/api/logout', (req, res) => {
  setCookie(req, res, 'session', '', 0);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  res.json({ loggedIn: !!user, username: user });
});

// ---------- STUDENT LOGIN (open routes; students only ever see their own records) ----------
app.post('/api/student/login', async (req, res) => {
  const sid = String(req.body.studentId || '').trim();
  const password = String(req.body.password || '');
  if (!sid || !password) {
    return res.status(400).json({ error: 'Enter your student ID and password' });
  }

  const ipKey = 'student-ip:' + clientIp(req);
  const acctKey = 'student:' + sid.toLowerCase();
  if (await isLocked(ipKey) || await isLocked(acctKey)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }

  const st = (await db.query(
    'SELECT pk, pw_salt, pw_hash FROM students WHERE student_id = $1', [sid]
  )).rows[0];

  let ok = false;
  if (st && st.pw_hash && st.pw_salt) {
    const given = crypto.scryptSync(password, st.pw_salt, 64);
    const real = Buffer.from(st.pw_hash, 'hex');
    ok = given.length === real.length && crypto.timingSafeEqual(given, real);
  } else {
    crypto.scryptSync(password, 'no-such-student-salt', 64);   // same work, so timing does not reveal who exists
  }

  if (!ok) {
    await recordFailure(ipKey);
    await recordFailure(acctKey);
    return res.status(401).json({ error: 'Wrong student ID or password' });
  }

  await clearFailures(ipKey);
  await clearFailures(acctKey);
  setCookie(req, res, 'student', makeToken('student', st.pk, STUDENT_SESSION_MS), STUDENT_SESSION_MS / 1000);
  res.json({ ok: true });
});

app.post('/api/student/logout', (req, res) => {
  setCookie(req, res, 'student', '', 0);
  res.json({ ok: true });
});

// Everything a logged-in student may see: their OWN details and attendance, nothing else.
// The student is taken from the signed cookie, never from anything the browser sends.
app.get('/api/student/me', async (req, res) => {
  const pk = currentStudentPk(req);
  if (!pk) return res.json({ loggedIn: false });

  const st = (await db.query(
    'SELECT name, student_id, course, photo FROM students WHERE pk = $1', [pk]
  )).rows[0];
  if (!st) return res.json({ loggedIn: false });

  const records = (await db.query(
    'SELECT date, time, status FROM attendance WHERE student_pk = $1 ORDER BY date DESC, time DESC', [pk]
  )).rows;

  const count = s => records.filter(r => r.status === s).length;
  const present = count('Present');
  const late = count('Late');
  const absent = count('Absent');
  const daysRecorded = present + late + absent;

  res.json({
    loggedIn: true,
    student: { name: st.name, studentId: st.student_id, course: st.course, photo: st.photo },
    stats: {
      present: present, late: late, absent: absent, daysRecorded: daysRecorded,
      rate: daysRecorded ? Math.round(((present + late) / daysRecorded) * 100) : 0
    },
    records: records
  });
});

// ---------- THE LOCK ----------
// Everything under /api needs a login, except scans that carry the secret reader key.
app.use('/api', (req, res, next) => {
  if (req.method === 'POST' && req.path === '/scan' &&
      SCAN_KEY && safeEqual(req.headers['x-scan-key'] || '', SCAN_KEY)) {
    return next();
  }
  if (!currentUser(req)) {
    return res.status(401).json({ error: 'Please log in' });
  }
  next();
});

// ---------- STUDENTS ----------
const STUDENT_COLS = 'pk, name, student_id AS id, uid, course, photo, (pw_hash IS NOT NULL) AS has_password';

app.get('/api/students', async (req, res) => {
  const r = await db.query('SELECT ' + STUDENT_COLS + ' FROM students ORDER BY name');
  res.json(r.rows);
});

app.post('/api/students', async (req, res) => {
  const { name, id, uid, course, photo } = req.body;
  if (!name || !id || !uid) {
    return res.status(400).json({ error: 'name, id and uid are required' });
  }
  try {
    const r = await db.query(
      `INSERT INTO students (name, student_id, uid, course, photo)
       VALUES ($1, $2, $3, $4, $5) RETURNING pk`,
      [String(name).trim(), String(id).trim(), String(uid).trim().toUpperCase(), course || 'N/A', photo || null]
    );
    res.status(201).json({ pk: r.rows[0].pk });
  } catch (e) {
    if (isDuplicate(e)) return res.status(409).json({ error: 'Student ID or RFID UID already exists' });
    throw e;
  }
});

app.put('/api/students/:pk', async (req, res) => {
  const pk = parseInt(req.params.pk, 10);
  if (!Number.isInteger(pk)) return res.status(404).json({ error: 'Student not found' });
  const { name, id, uid, course, photo } = req.body;
  if (!name || !id || !uid) {
    return res.status(400).json({ error: 'name, id and uid are required' });
  }
  try {
    const r = await db.query(
      `UPDATE students SET name = $1, student_id = $2, uid = $3, course = $4, photo = $5
       WHERE pk = $6`,
      [String(name).trim(), String(id).trim(), String(uid).trim().toUpperCase(), course || 'N/A', photo || null, pk]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Student not found' });
    res.json({ ok: true });
  } catch (e) {
    if (isDuplicate(e)) return res.status(409).json({ error: 'Student ID or RFID UID already exists' });
    throw e;
  }
});

app.put('/api/students/:pk/password', async (req, res) => {
  const pk = parseInt(req.params.pk, 10);
  if (!Number.isInteger(pk)) return res.status(404).json({ error: 'Student not found' });
  const password = String(req.body.password || '');
  if (password.length < STUDENT_MIN_PASSWORD) {
    return res.status(400).json({ error: 'Password must be at least ' + STUDENT_MIN_PASSWORD + ' characters' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  const r = await db.query('UPDATE students SET pw_salt = $1, pw_hash = $2 WHERE pk = $3', [salt, hash, pk]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Student not found' });
  res.json({ ok: true });
});

app.delete('/api/students/:pk', async (req, res) => {
  const pk = parseInt(req.params.pk, 10);
  if (!Number.isInteger(pk)) return res.status(404).json({ error: 'Student not found' });
  const r = await db.query('DELETE FROM students WHERE pk = $1', [pk]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Student not found' });
  res.json({ ok: true });
});

// ---------- THE RFID SCAN ----------
app.post('/api/scan', async (req, res) => {
  const uid = String(req.body.uid || '').trim().toUpperCase();
  const device = String(req.body.device || 'RFID Reader #1').slice(0, 60);
  if (!uid) {
    return res.status(400).json({ error: 'uid is required' });
  }

  const { date, time } = nowParts();

  // Remember that the reader is alive
  await db.query(
    `INSERT INTO devices (name, status, last_seen) VALUES ($1, 'online', $2)
     ON CONFLICT (name) DO UPDATE SET status = 'online', last_seen = $2`,
    [device, date + ' ' + time]
  );

  // Who owns this card?
  const student = (await db.query(
    'SELECT pk, name, student_id, course, photo FROM students WHERE uid = $1', [uid]
  )).rows[0];

  if (!student) {
    await rememberScan({ result: 'unknown', uid: uid });
    return res.status(404).json({ error: 'Unknown card', uid });
  }

  const details = {
    name: student.name,
    studentId: student.student_id,
    course: student.course,
    photo: student.photo
  };

  const existing = (await db.query(
    'SELECT id, status FROM attendance WHERE student_pk = $1 AND date = $2', [student.pk, date]
  )).rows[0];

  if (existing && existing.status !== 'Absent') {
    await rememberScan(Object.assign({ result: 'duplicate' }, details));
    return res.status(409).json({ error: student.name + ' already marked present today' });
  }

  if (existing) {
    // Was marked Absent earlier, now arrived: switch to Present
    await db.query("UPDATE attendance SET status = 'Present', time = $1 WHERE id = $2", [time, existing.id]);
  } else {
    const ins = await db.query(
      `INSERT INTO attendance (student_pk, date, time, status) VALUES ($1, $2, $3, 'Present')
       ON CONFLICT (student_pk, date) DO NOTHING`,
      [student.pk, date, time]
    );
    if (ins.rowCount === 0) {
      await rememberScan(Object.assign({ result: 'duplicate' }, details));
      return res.status(409).json({ error: student.name + ' already marked present today' });
    }
  }

  await rememberScan(Object.assign({ result: 'ok' }, details));
  res.status(201).json({ ok: true, name: student.name });
});

// The website asks: "has there been a new scan since the last one I saw?"
app.get('/api/last-scan', async (req, res) => {
  const row = (await db.query('SELECT n, data FROM last_scan WHERE id = 1')).rows[0];
  if (!row) return res.json({ n: 0 });
  const n = Number(row.n);
  if (Number(req.query.since) === n) return res.json({ n });
  res.json(Object.assign({ n }, JSON.parse(row.data)));
});

// ---------- ATTENDANCE, STATS, DEVICES ----------
app.get('/api/attendance', async (req, res) => {
  const r = await db.query(
    `SELECT a.id, s.name, s.uid, a.date, a.time, a.status
     FROM attendance a JOIN students s ON s.pk = a.student_pk
     ORDER BY a.date DESC, a.time DESC`
  );
  res.json(r.rows);
});

app.get('/api/stats', async (req, res) => {
  const { date } = nowParts();
  const r = await db.query(
    `SELECT (SELECT COUNT(*) FROM students)::int AS total,
            (SELECT COUNT(*) FROM attendance WHERE date = $1 AND status IN ('Present', 'Late'))::int AS present`,
    [date]
  );
  const total = r.rows[0].total;
  const present = r.rows[0].present;
  res.json({
    total: total,
    present: present,
    absent: Math.max(0, total - present),
    rate: total ? Math.round((present / total) * 100) : 0
  });
});

app.get('/api/devices', async (req, res) => {
  const r = await db.query('SELECT name AS device, status, last_seen AS last FROM devices ORDER BY name');
  res.json(r.rows);
});

// Mark everyone who did not scan today as Absent
app.post('/api/close-day', async (req, res) => {
  const { date, time } = nowParts();
  const r = await db.query(
    `INSERT INTO attendance (student_pk, date, time, status)
     SELECT pk, $1::text, $2::text, 'Absent' FROM students
     WHERE pk NOT IN (SELECT student_pk FROM attendance WHERE date = $1::text)`,
    [date, time]
  );
  res.json({ ok: true, markedAbsent: r.rowCount });
});

// ---------- CSV EXPORT ----------
app.get('/api/export.csv', async (req, res) => {
  const date = String(req.query.date || '');
  const status = String(req.query.status || 'all');

  const r = await db.query(
    `SELECT s.name, s.student_id, s.uid, s.course, a.date, a.time, a.status
     FROM attendance a JOIN students s ON s.pk = a.student_pk
     WHERE ($1::text = '' OR a.date = $1::text) AND ($2::text = 'all' OR a.status = $2::text)
     ORDER BY a.date DESC, a.time DESC`,
    [date, status]
  );

  // Quote every value; neutralise a leading = + - @ so Excel never runs it as a formula
  function cell(value) {
    let text = String(value == null ? '' : value);
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  const lines = [['Name', 'Student ID', 'RFID UID', 'Course', 'Date', 'Time', 'Status'].map(cell).join(',')];
  r.rows.forEach(row => {
    lines.push([row.name, row.student_id, row.uid, row.course, row.date, row.time, row.status].map(cell).join(','));
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="attendance.csv"');
  res.send('\uFEFF' + lines.join('\r\n'));
});

// ---------- ERRORS ----------
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Server error' });
});

module.exports = app;

// Running on your own PC: node index.js
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('Server running at http://localhost:' + port));
}
