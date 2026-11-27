// The database tables. Safe to run again and again: it only adds what is missing.
module.exports = `
  CREATE TABLE IF NOT EXISTS students (
    pk              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    student_id      TEXT NOT NULL UNIQUE,
    uid             TEXT UNIQUE,
    course          TEXT DEFAULT 'N/A',
    photo           TEXT,
    pw_salt         TEXT,
    pw_hash         TEXT,
    status          TEXT NOT NULL DEFAULT 'approved',
    self_registered BOOLEAN NOT NULL DEFAULT FALSE
  );
  ALTER TABLE students ADD COLUMN IF NOT EXISTS pw_salt TEXT;
  ALTER TABLE students ADD COLUMN IF NOT EXISTS pw_hash TEXT;
  ALTER TABLE students ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
  ALTER TABLE students ADD COLUMN IF NOT EXISTS self_registered BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE students ALTER COLUMN uid DROP NOT NULL;
  CREATE TABLE IF NOT EXISTS signup_log (
    id         SERIAL PRIMARY KEY,
    ip         TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS attendance (
    id         SERIAL PRIMARY KEY,
    student_pk INTEGER NOT NULL REFERENCES students(pk) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    time       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'Present',
    UNIQUE (student_pk, date)
  );
  CREATE TABLE IF NOT EXISTS devices (
    name      TEXT PRIMARY KEY,
    status    TEXT NOT NULL DEFAULT 'online',
    last_seen TEXT
  );
  CREATE TABLE IF NOT EXISTS admins (
    username TEXT PRIMARY KEY,
    salt     TEXT NOT NULL,
    hash     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_attempts (
    ip           TEXT PRIMARY KEY,
    count        INTEGER NOT NULL,
    locked_until BIGINT NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS last_scan (
    id   INTEGER PRIMARY KEY,
    n    BIGINT NOT NULL,
    data TEXT NOT NULL
  );
`;
