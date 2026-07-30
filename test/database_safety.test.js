import test from 'node:test'
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  assertDefaultDatabaseAccess,
  createRotatingSqliteBackup,
} from '../lib/databaseSafety.js'

test('standalone callers cannot open the default live database implicitly', () => {
  assert.throws(
    () => assertDefaultDatabaseAccess({
      explicitDbPath: '',
      allowLiveDb: '',
      entrypoint: '/tmp/evening_probe.mjs',
      serverPath: path.join(process.cwd(), 'server.js'),
    }),
    /Refusing to open the live wardrobe database/
  )
})

test('server entrypoint and explicit database paths are allowed', () => {
  const serverPath = path.join(process.cwd(), 'server.js')
  assert.doesNotThrow(() => assertDefaultDatabaseAccess({
    explicitDbPath: '',
    allowLiveDb: '',
    entrypoint: serverPath,
    serverPath,
  }))
  assert.doesNotThrow(() => assertDefaultDatabaseAccess({
    explicitDbPath: '/tmp/isolated.db',
    allowLiveDb: '',
    entrypoint: '/tmp/probe.mjs',
    serverPath,
  }))
})

test('the exact standalone db.js probe pattern fails before it can delete pieces', () => {
  const env = { ...process.env }
  delete env.WARDROBE_DB_PATH
  delete env.WARDROBE_ALLOW_LIVE_DB
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e',
      "const { db } = await import('./db.js'); db.prepare('DELETE FROM pieces').run()"],
    { cwd: process.cwd(), env, encoding: 'utf8' }
  )
  assert.notStrictEqual(result.status, 0)
  assert.match(result.stderr, /Refusing to open the live wardrobe database/)
})

test('an explicit isolated database remains available to standalone scripts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-safe-db-'))
  const dbPath = path.join(root, 'wardrobe.db')
  const env = {
    ...process.env,
    WARDROBE_DB_PATH: dbPath,
    WARDROBE_UPLOADS_DIR: path.join(root, 'uploads'),
  }
  delete env.WARDROBE_ALLOW_LIVE_DB
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e',
      "const { db } = await import('./db.js'); console.log(db.prepare('SELECT COUNT(*) AS n FROM pieces').get().n)"],
    { cwd: process.cwd(), env, encoding: 'utf8' }
  )
  assert.strictEqual(result.status, 0, result.stderr)
  assert.match(result.stdout, /0/)
})

test('rotating backups are valid SQLite snapshots and retain only the newest files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-backup-'))
  const dbPath = path.join(root, 'wardrobe.db')
  const backupDir = path.join(root, 'backups')
  const db = new Database(dbPath)
  db.exec("CREATE TABLE pieces (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO pieces (name) VALUES ('kept')")

  try {
    for (const iso of [
      '2026-07-30T01:00:00.000Z',
      '2026-07-30T02:00:00.000Z',
      '2026-07-30T03:00:00.000Z',
    ]) {
      createRotatingSqliteBackup(db, {
        dbPath,
        backupDir,
        now: new Date(iso),
        retain: 2,
      })
    }
  } finally {
    db.close()
  }

  const backups = fs.readdirSync(backupDir).sort()
  assert.deepStrictEqual(backups, [
    'wardrobe-2026-07-30T02-00-00.000Z.db',
    'wardrobe-2026-07-30T03-00-00.000Z.db',
  ])
  const restored = new Database(path.join(backupDir, backups[1]), { readonly: true })
  try {
    assert.deepStrictEqual(restored.prepare('SELECT id, name FROM pieces').all(), [{ id: 1, name: 'kept' }])
    assert.strictEqual(restored.pragma('integrity_check', { simple: true }), 'ok')
  } finally {
    restored.close()
  }
})
