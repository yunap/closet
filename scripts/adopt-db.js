// Spec 33 Part 3 — general-purpose, not owner-only: adopts ANY existing single-user
// instance (a wardrobe.db + uploads/ pair) as a new account. Copies (never moves — the
// original is left in place as its own backup), verifies with a full content diff, and
// refuses to adopt the same source twice.
//
// Usage: node scripts/adopt-db.js --db <path> --uploads <dir> --email <email> --password <password>
// (--uploads is optional if the instance has no uploads directory)
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { createUser, findUserByEmail, db as systemDb } from '../lib/systemDb.js'
import { resolveDbPath, resolveUploadsDir, getDbForUser } from '../db.js'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i++ }
  }
  return args
}

function contentDiff(sourceDbPath, destDbPath) {
  const src = new Database(sourceDbPath, { readonly: true })
  const dst = new Database(destDbPath, { readonly: true })
  const tables = src.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  const mismatches = []
  for (const t of tables) {
    const a = JSON.stringify(src.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())
    const b = JSON.stringify(dst.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())
    if (a !== b) mismatches.push(t)
  }
  src.close()
  dst.close()
  return mismatches
}

// Exported so tests can exercise the real logic without spawning a subprocess.
export function adoptDatabase({ sourceDbPath, sourceUploadsDir, email, password }) {
  if (!fs.existsSync(sourceDbPath)) throw new Error(`No database found at ${sourceDbPath}`)
  if (findUserByEmail(email)) throw new Error(`An account with email ${email} already exists`)

  // Refuse to adopt the same source twice — the marker lives in the SOURCE db (not the
  // destination), so re-running against the same file refuses even if the resulting
  // account was later deleted, rather than silently minting a second account from it.
  const probe = new Database(sourceDbPath)
  let existingMarker
  try {
    existingMarker = probe.prepare("SELECT value FROM app_meta WHERE key = 'adopted_to_user'").get()
  } catch {
    existingMarker = undefined // no app_meta table at all — definitely not adopted yet
  }
  if (existingMarker) {
    probe.close()
    throw new Error(`${sourceDbPath} was already adopted as user #${existingMarker.value} — refusing to adopt it again`)
  }

  // Mandatory WAL checkpoint before copying (spec 32/33's own lesson: a raw file copy of
  // a live-WAL SQLite db can silently lose the most recent writes — live-verified
  // 2026-07-19 that a real test instance's -wal was 11x its main db file).
  probe.pragma('wal_checkpoint(TRUNCATE)')
  probe.close()

  const user = createUser(email, password)
  const destDbPath = resolveDbPath(user.id)
  const destUploadsDir = resolveUploadsDir(user.id)

  try {
    fs.mkdirSync(path.dirname(destDbPath), { recursive: true })
    fs.copyFileSync(sourceDbPath, destDbPath)

    if (sourceUploadsDir && fs.existsSync(sourceUploadsDir)) {
      fs.mkdirSync(path.dirname(destUploadsDir), { recursive: true })
      fs.cpSync(sourceUploadsDir, destUploadsDir, { recursive: true })
    }

    // Content diff BEFORE opening the destination through the app's own bootstrap — a
    // raw byte-level copy should already be an exact row-for-row match. Opening through
    // getDbForUser afterward is what a normal per-user first-open does (idempotent
    // migrations), so it runs after the proof that the copy itself was clean.
    const mismatches = contentDiff(sourceDbPath, destDbPath)
    if (mismatches.length) throw new Error(`Content mismatch after copy in table(s): ${mismatches.join(', ')}`)

    getDbForUser(user.id) // opens + runs db.js's normal (idempotent) migrations in place

    const markDb = new Database(sourceDbPath)
    markDb.exec("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)")
    markDb.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('adopted_to_user', ?)").run(String(user.id))
    markDb.close()

    return { userId: user.id, email: user.email, dbPath: destDbPath, uploadsDir: destUploadsDir }
  } catch (err) {
    // Roll back the half-created account/files rather than leave a broken user behind.
    try { fs.rmSync(path.dirname(destDbPath), { recursive: true, force: true }) } catch {}
    systemDb.prepare('DELETE FROM users WHERE id = ?').run(user.id)
    throw err
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { db: sourceDbPath, uploads: sourceUploadsDir, email, password } = parseArgs(process.argv.slice(2))
  if (!sourceDbPath || !email || !password) {
    console.error('Usage: node scripts/adopt-db.js --db <path> --uploads <dir> --email <email> --password <password>')
    process.exit(1)
  }
  try {
    const result = adoptDatabase({ sourceDbPath, sourceUploadsDir, email, password })
    console.log(`Adopted ${sourceDbPath} -> user #${result.userId} (${result.email}), verified byte-for-byte content match.`)
    console.log(`Original files left in place at ${sourceDbPath}${sourceUploadsDir ? ' and ' + sourceUploadsDir : ''} as a backup.`)
  } catch (err) {
    console.error('Adoption failed:', err.message)
    process.exit(1)
  }
}
