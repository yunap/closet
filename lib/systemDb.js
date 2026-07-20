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
      is_admin               INTEGER DEFAULT 0,
      status                 TEXT DEFAULT 'active',
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
    CREATE TABLE IF NOT EXISTS password_reset_codes (
      code       TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now')),
      used_at    TEXT
    );
    CREATE TABLE IF NOT EXISTS invite_requests (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT NOT NULL,
      note       TEXT DEFAULT '',
      status     TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      decided_at TEXT
    );
  `)
  // Additive migrations for pre-existing system.db files (the columns above only apply
  // to freshly-created tables).
  try { conn.exec('ALTER TABLE users ADD COLUMN operator_key_approved INTEGER DEFAULT 0') } catch {}
  try { conn.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0') } catch {}
  try { conn.exec('ALTER TABLE users ADD COLUMN status TEXT DEFAULT \'active\'') } catch {}
  // Spec 34: user #1 is the operator — always an admin. Hardcoded id 1 (not
  // DEFAULT_USER_ID) deliberately: this module has no lib/requestContext.js dependency,
  // same reasoning as isApprovedForOperatorKey's exemption below.
  conn.prepare('UPDATE users SET is_admin = 1 WHERE id = 1 AND is_admin = 0').run()
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
  // Spec 34: user #1 is always an admin. The boot-time migration in initSystemDb only
  // covers a system.db that ALREADY has a row for id 1 when this code first runs — a
  // brand-new system.db (fresh install, or every test file's isolated tmp db) creates
  // its id-1 row well after that one-shot migration already ran, so it needs its own
  // flag set here too.
  if (info.lastInsertRowid === 1) db.prepare('UPDATE users SET is_admin = 1 WHERE id = 1').run()
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
  // Spec 34: a disabled user's live sessions die on their next request — this is the
  // single call site every request already goes through (server.js), so no new wiring
  // is needed anywhere else to enforce it.
  const userStatus = db.prepare('SELECT status FROM users WHERE id = ?').get(session.user_id)?.status
  if (userStatus && userStatus !== 'active') {
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

export function listInvites() {
  return db.prepare(`
    SELECT invites.code, invites.created_at, invites.used_at,
           creator.email AS created_by_email,
           redeemer.email AS used_by_email
    FROM invites
    LEFT JOIN users AS creator  ON creator.id  = invites.created_by
    LEFT JOIN users AS redeemer ON redeemer.id = invites.used_by
    ORDER BY invites.created_at DESC
  `).all()
}

// Only an unused code can be revoked — a redeemed one already did its job and revoking
// it would strand the account it created, not "undo" anything.
export function revokeInvite(code) {
  return db.prepare('DELETE FROM invites WHERE code = ? AND used_by IS NULL').run(code).changes > 0
}

// ── Admin ──────────────────────────────────────────────────────────────────────
export function isAdmin(userId) {
  return Boolean(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId)?.is_admin)
}

export function countAdmins() {
  return db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n
}

export function setAdmin(userId, isAdminValue) {
  return db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdminValue ? 1 : 0, userId).changes > 0
}

export function setUserStatus(userId, status) {
  return db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, userId).changes > 0
}

// The system.db half of account deletion only — the caller (routes/admin.js) owns
// removing the per-user data directory, since this module deliberately has no
// knowledge of db.js's per-user file paths.
export function deleteUserAndSessions(userId) {
  return db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes > 0 // sessions cascade
}

export function listUsersForAdmin() {
  return db.prepare(`
    SELECT users.id, users.email, users.created_at, users.operator_key_approved, users.is_admin, users.status,
           COUNT(sessions.token_hash) AS session_count,
           MAX(sessions.last_seen) AS last_seen
    FROM users
    LEFT JOIN sessions ON sessions.user_id = users.id
    GROUP BY users.id
    ORDER BY users.created_at ASC
  `).all()
}

// ── Password reset (admin-issued, no email) ─────────────────────────────────────
export function createPasswordResetCode(userId) {
  const code = crypto.randomBytes(9).toString('base64url')
  db.prepare('INSERT INTO password_reset_codes (code, user_id) VALUES (?, ?)').run(code, userId)
  return code
}

export function redeemPasswordResetCode(code, newPassword) {
  const row = db.prepare('SELECT * FROM password_reset_codes WHERE code = ? AND used_at IS NULL').get(code)
  if (!row) return false
  db.transaction(() => {
    db.prepare('UPDATE password_reset_codes SET used_at = datetime(\'now\') WHERE code = ?').run(code)
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), row.user_id)
  })()
  return true
}

// ── Invite requests (spec 34 Part 3 — table + admin side ship in Part 4's PR; the
// public unauthenticated submission endpoint is a later PR) ────────────────────
export function listInviteRequests() {
  return db.prepare('SELECT * FROM invite_requests ORDER BY created_at DESC').all()
}

export function decideInviteRequest(id, status) {
  return db.prepare("UPDATE invite_requests SET status = ?, decided_at = datetime('now') WHERE id = ?").run(status, id).changes > 0
}

export { db, resolveSystemDbPath }
