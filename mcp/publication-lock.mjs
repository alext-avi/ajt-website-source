import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

function database(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, 'publication-lock.sqlite');
  const db = new DatabaseSync(filename);
  fs.chmodSync(filename, 0o600);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS publication_lock (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
      token TEXT NOT NULL, review TEXT NOT NULL, pid INTEGER NOT NULL,
      child_group INTEGER, started_at TEXT NOT NULL
    );`);
  return db;
}

function alive(pid, group = false) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(group && process.platform !== 'win32' ? -pid : pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}
const active = (lock) =>
  !!lock && (alive(lock.pid) || alive(lock.child_group, true));

export function publicationStatus(directory) {
  const db = database(directory);
  try {
    const lock = db.prepare('SELECT * FROM publication_lock').get();
    return { lock, active: active(lock) };
  } finally {
    db.close();
  }
}

export function acquirePublication(directory, review, pid = process.pid) {
  const db = database(directory);
  try {
    db.exec('BEGIN IMMEDIATE');
    const previous = db.prepare('SELECT * FROM publication_lock').get();
    if (active(previous))
      throw new Error(
        'Another publication is running. Wait for it to finish before publishing.',
      );
    const token = randomBytes(24).toString('hex');
    db.prepare('DELETE FROM publication_lock').run();
    db.prepare(
      'INSERT INTO publication_lock(singleton,token,review,pid,started_at) VALUES (1,?,?,?,?)',
    ).run(token, review, pid, new Date().toISOString());
    db.exec('COMMIT');
    return token;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}

export function trackPublicationChild(directory, token, pid) {
  const db = database(directory);
  try {
    const result = db
      .prepare('UPDATE publication_lock SET child_group=? WHERE token=?')
      .run(pid, token);
    if (result.changes !== 1) throw new Error('Publication lock was lost');
  } finally {
    db.close();
  }
}

export function releasePublication(directory, token) {
  const db = database(directory);
  try {
    db.prepare('DELETE FROM publication_lock WHERE token=?').run(token);
  } finally {
    db.close();
  }
}
