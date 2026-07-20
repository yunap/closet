// Spec 33 Part 3 — adopt-db.js: copies an existing wardrobe.db + uploads/ pair in as a
// new account, verified content-identical, refusing to adopt the same source twice.
// WARDROBE_USERS_DIR isolates this test's per-user files under a tmp root; WARDROBE_
// DB_PATH is deliberately NOT set (that would collapse every userId onto one shared
// file — the als-context test uses the same non-default-userId-only pattern).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-adopt-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_USERS_DIR = path.join(tmpRoot, 'users')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')

const { adoptDatabase } = await import('../scripts/adopt-db.js')
const { createUser } = await import('../lib/systemDb.js')

// Burn user #1 so every adopted user in this file lands on a non-default id — id 1 would
// otherwise fall through db.js's DEFAULT_USER_ID legacy-path branch instead of the
// per-user data/users/{id} path this test means to exercise.
createUser('placeholder-burns-id-1@example.com', 'irrelevant-password')

function buildSourceInstance(name, pieceName) {
  const dir = path.join(tmpRoot, 'source-' + name)
  fs.mkdirSync(dir, { recursive: true })
  const dbPath = path.join(dir, 'wardrobe.db')
  const uploadsDir = path.join(dir, 'uploads')
  fs.mkdirSync(uploadsDir)
  fs.writeFileSync(path.join(uploadsDir, 'photo.jpg'), 'fake-jpeg-bytes')

  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE pieces (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL, photo TEXT);
  `)
  db.prepare("INSERT INTO pieces (name, category, photo) VALUES (?, 'top', 'photo.jpg')").run(pieceName)
  db.close()
  return { dbPath, uploadsDir }
}

test('adopts a source instance as a new user, content-identical, migrated in place', () => {
  const { dbPath, uploadsDir } = buildSourceInstance('a', 'the source piece')
  const result = adoptDatabase({ sourceDbPath: dbPath, sourceUploadsDir: uploadsDir, email: 'adopted-a@example.com', password: 'longenoughpw' })

  assert.notEqual(result.userId, 1, 'sanity: did not fall through to DEFAULT_USER_ID')

  const dest = new Database(result.dbPath, { readonly: true })
  const piece = dest.prepare('SELECT * FROM pieces').get()
  assert.equal(piece.name, 'the source piece')
  dest.close()

  assert.ok(fs.existsSync(path.join(result.uploadsDir, 'photo.jpg')), 'uploads copied alongside the db')

  // db.js's own bootstrap ran in place (getDbForUser) — later columns/tables it expects exist.
  const migrated = new Database(result.dbPath, { readonly: true })
  const tables = migrated.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  assert.ok(tables.includes('style_constitution'), 'idempotent migrations ran against the adopted file')
  migrated.close()
})

test('refuses to adopt the same source twice', () => {
  const { dbPath, uploadsDir } = buildSourceInstance('b', 'piece b')
  adoptDatabase({ sourceDbPath: dbPath, sourceUploadsDir: uploadsDir, email: 'adopted-b1@example.com', password: 'longenoughpw' })

  assert.throws(
    () => adoptDatabase({ sourceDbPath: dbPath, sourceUploadsDir: uploadsDir, email: 'adopted-b2@example.com', password: 'longenoughpw' }),
    /already adopted/
  )
})

test('refuses a duplicate email', () => {
  const first = buildSourceInstance('c1', 'piece c1')
  adoptDatabase({ sourceDbPath: first.dbPath, sourceUploadsDir: first.uploadsDir, email: 'dupe@example.com', password: 'longenoughpw' })

  const second = buildSourceInstance('c2', 'piece c2')
  assert.throws(
    () => adoptDatabase({ sourceDbPath: second.dbPath, sourceUploadsDir: second.uploadsDir, email: 'dupe@example.com', password: 'longenoughpw' }),
    /already exists/
  )
})

test('a missing source database is rejected cleanly', () => {
  assert.throws(
    () => adoptDatabase({ sourceDbPath: path.join(tmpRoot, 'nope.db'), email: 'nobody@example.com', password: 'longenoughpw' }),
    /No database found/
  )
})
