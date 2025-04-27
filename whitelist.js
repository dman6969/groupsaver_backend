// whitelist.js  – super-simple subscriber store (SQLite)
import Database from 'better-sqlite3';

// Creates file subs.db in project root (Render persists it)
const db = new Database('subs.db');

// Ensure table exists
db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    added  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// ---------- Helpers ----------
export const addEmail    = email => db.prepare(
  'INSERT OR IGNORE INTO users(email) VALUES(?)').run(email.toLowerCase());

export const removeEmail = email => db.prepare(
  'DELETE FROM users WHERE email=?').run(email.toLowerCase());

export const isAllowed   = email => !!db.prepare(
  'SELECT 1 FROM users WHERE email=?').get(email.toLowerCase());