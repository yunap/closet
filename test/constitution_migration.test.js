// Spec 32 — migration semantics for the constitution/profile storage.
// The dangerous case this pins: a BRAND-NEW database acquires the 'seeded' sentinel on its
// first boot, so on its second boot it would look "pre-existing" — the constitution_migrated
// marker must prevent it from ever receiving the legacy owner constitution. Conversely, a
// genuinely pre-existing DB (has 'seeded', predates the constitution tables) must receive the
// legacy rows exactly once, with 'migration' history rows.
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { LEGACY_CONSTITUTION } from '../styling-engine/constitutionSeed.js'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'constitution-migration-'))

function bootDb(dbPath) {
  const env = {
    ...process.env,
    WARDROBE_DB_PATH: dbPath,
    WARDROBE_UPLOADS_DIR: path.join(tmpRoot, 'uploads')
  }
  const result = spawnSync(process.execPath, ['-e', "import('./db.js').then(() => process.exit(0))"], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8'
  })
  assert.strictEqual(result.status, 0, `db.js boot failed: ${result.stderr}`)
}

test('fresh DB never receives the legacy constitution, even on a second boot', () => {
  const dbPath = path.join(tmpRoot, 'fresh.db')
  bootDb(dbPath)
  bootDb(dbPath)
  const db = new Database(dbPath, { readonly: true })
  const layers = db.prepare('SELECT COUNT(*) AS n FROM style_constitution').get().n
  const marker = db.prepare("SELECT value FROM app_meta WHERE key = 'constitution_migrated'").get()?.value
  const profileName = db.prepare("SELECT value FROM app_meta WHERE key = 'profile_display_name'").get()
  db.close()
  assert.strictEqual(layers, 0, 'fresh DB must have no constitution rows (generic defaults apply)')
  assert.strictEqual(marker, 'fresh')
  assert.strictEqual(profileName, undefined, 'fresh DB must have no seeded profile name')
})

test('pre-existing DB receives the legacy constitution exactly once', () => {
  const dbPath = path.join(tmpRoot, 'preexisting.db')
  // Simulate a pre-spec-32 database: app_meta with the 'seeded' sentinel, no constitution tables.
  const setup = new Database(dbPath)
  setup.exec("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO app_meta (key, value) VALUES ('seeded', 'true')")
  setup.close()

  bootDb(dbPath)
  bootDb(dbPath)

  const db = new Database(dbPath, { readonly: true })
  const rows = db.prepare('SELECT layer, body FROM style_constitution ORDER BY layer').all()
  const history = db.prepare("SELECT COUNT(*) AS n FROM constitution_history WHERE source = 'migration'").get().n
  const marker = db.prepare("SELECT value FROM app_meta WHERE key = 'constitution_migrated'").get()?.value
  const profileName = db.prepare("SELECT value FROM app_meta WHERE key = 'profile_display_name'").get()?.value
  db.close()

  const expectedLayers = Object.keys(LEGACY_CONSTITUTION).sort()
  assert.deepStrictEqual(rows.map(r => r.layer).sort(), expectedLayers)
  for (const row of rows) {
    assert.strictEqual(row.body, LEGACY_CONSTITUTION[row.layer], `verbatim seed for ${row.layer}`)
  }
  assert.strictEqual(history, expectedLayers.length, 'one migration history row per layer, once')
  assert.strictEqual(marker, 'legacy-seeded')
  assert.strictEqual(profileName, 'Yuna')
})
