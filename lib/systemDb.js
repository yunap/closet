// Spec 33 Part 2 — the one genuinely process-wide store. Unlike db.js (per-user, opened
// lazily via a Proxy), system.db holds only cross-user account/session/invite data, so a
// single always-open connection is correct here, not a workaround.
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function resolveSystemDbPath() {
  return process.env.WARDROBE_SYSTEM_DB_PATH || path.join(__dirname, '..', 'data', 'system.db')
}

function initSystemDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const conn = new Database(dbPath)
  conn.pragma('journal_mode = WAL')
  conn.pragma('foreign_keys = ON')
  conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      email                  TEXT NOT NULL UNIQUE,
      password_hash          TEXT NOT NULL,
      operator_key_approved  INTEGER DEFAULT 0,
      created_at             TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash       TEXT PRIMARY KEY,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_agent_label TEXT DEFAULT '',
      created_at       TEXT DEFAULT (datetime('now')),
      last_seen        TEXT DEFAULT (datetime('now')),
      expires_at       TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (
      code       TEXT PRIMARY KEY,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now')),
      used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      used_at    TEXT
    );
  `)
  // Additive migration for pre-existing system.db files (the column above only applies
  // to freshly-created tables).
  try { conn.exec('ALTER TABLE users ADD COLUMN operator_key_approved INTEGER DEFAULT 0') } catch {}
  return conn
}

const db = initSystemDb(resolveSystemDbPath())

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30-day sliding expiry

// ── Passwords ──────────────────────────────────────────────────────────────────
// Node's built-in scrypt — no new dependency. Stored as "saltHex:hashHex".
const SCRYPT_KEYLEN = 64

export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':')
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = crypto.scryptSync(password, salt, SCRYPT_KEYLEN)
  if (actual.length !== expected.length) return false
  return crypto.timingSafeEqual(actual, expected)
}

// ── Users ──────────────────────────────────────────────────────────────────────
export function createUser(email, password) {
  const password_hash = hashPassword(password)
  const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email.toLowerCase().trim(), password_hash)
  return { id: info.lastInsertRowid, email: email.toLowerCase().trim() }
}

export function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase().trim())
}

export function findUserById(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
}

// Owner ruling 2026-07-20: a new user does NOT ride on the operator's key by default —
// the operator has to explicitly approve them first (or they bring their own key).
// Only this flag governs it; DEFAULT_USER_ID's exemption (the operator IS the key's
// owner) is handled by the caller in lib/apiKeys.js, not here, so this module stays
// free of a lib/requestContext.js dependency.
export function isApprovedForOperatorKey(userId) {
  return Boolean(db.prepare('SELECT operator_key_approved FROM users WHERE id = ?').get(userId)?.operator_key_approved)
}

export function setOperatorKeyApproval(email, approved) {
  const info = db.prepare('UPDATE users SET operator_key_approved = ? WHERE email = ?').run(approved ? 1 : 0, String(email || '').toLowerCase().trim())
  return info.changes > 0
}

// ── Sessions ───────────────────────────────────────────────────────────────────
// Only a hash of the token ever touches disk — the raw token lives solely in the
// cookie, so a system.db leak alone can't be replayed into a live session.
function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

export function createSession(userId, userAgentLabel = '') {
  const rawToken = crypto.randomBytes(16).toString('hex') // 128-bit
  const tokenHash = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  db.prepare('INSERT INTO sessions (token_hash, user_id, user_agent_label, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash, userId, userAgentLabel, expiresAt)
  return rawToken
}

export function resolveSession(rawToken) {
  if (!rawToken) return null
  const tokenHash = hashToken(rawToken)
  const session = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash)
  if (!session) return null
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
    return null
  }
  const newExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  db.prepare("UPDATE sessions SET last_seen = datetime('now'), expires_at = ? WHERE token_hash = ?").run(newExpiresAt, tokenHash)
  return { ...session, tokenHash }
}

export function listSessions(userId) {
  return db.prepare('SELECT token_hash, user_agent_label, created_at, last_seen, expires_at FROM sessions WHERE user_id = ? ORDER BY last_seen DESC').all(userId)
}

export function revokeSessionByHash(tokenHash) {
  return db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash).changes > 0
}

export function revokeSessionByRawToken(rawToken) {
  return revokeSessionByHash(hashToken(rawToken))
}

export function revokeOtherSessions(userId, keepTokenHash) {
  return db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, keepTokenHash).changes
}

// ── Invites ────────────────────────────────────────────────────────────────────
export function createInvite(createdByUserId = null) {
  const code = crypto.randomBytes(9).toString('base64url') // 12 chars, URL-safe
  db.prepare('INSERT INTO invites (code, created_by) VALUES (?, ?)').run(code, createdByUserId)
  return code
}

// Single-use, atomically: only the caller whose UPDATE actually flips a row (changes > 0)
// consumed the code — a leaked/shared code can't be redeemed twice even under a race.
export function consumeInvite(code, usedByUserId) {
  const info = db.prepare("UPDATE invites SET used_by = ?, used_at = datetime('now') WHERE code = ? AND used_by IS NULL")
    .run(usedByUserId, code)
  return info.changes > 0
}

export { db, resolveSystemDbPath }
