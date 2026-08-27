// Sleeve-shape taxonomy migration (2026-08-26): the old fashion-name enum
// (fitted|straight|relaxed|puff|bishop|bell|flutter|raglan|dolman|other|unknown) is replaced by a
// functional sleeve-volume taxonomy. This pins the deterministic DB migration in db.js: which old
// values translate automatically, which are left untouched for manual review, manual-override
// preservation, sleeveless cleanup, and idempotency — using the isolated-temp-DB boot pattern from
// test/constitution_migration.test.js so this never touches the owner's real wardrobe.db (see
// docs/database-safety.md).
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sleeve-taxonomy-migration-'))

function bootDb(dbPath) {
  const env = { ...process.env, WARDROBE_DB_PATH: dbPath, WARDROBE_UPLOADS_DIR: path.join(tmpRoot, 'uploads') }
  const result = spawnSync(process.execPath, ['-e', "import('./db.js').then(m => { m.db.prepare('SELECT 1').get(); process.exit(0) })"], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8'
  })
  assert.strictEqual(result.status, 0, `db.js boot failed: ${result.stderr}`)
}

test('deterministic sleeve_shape values migrate to the functional taxonomy; manual status and confidence survive', () => {
  const dbPath = path.join(tmpRoot, 'deterministic.db')
  bootDb(dbPath) // create schema

  const db = new Database(dbPath)
  const insert = db.prepare(`
    INSERT INTO pieces (name, category, sleeve_length, sleeve_shape, manual_overrides, style_profile_json)
    VALUES (?, 'top', 'long', ?, ?, ?)
  `)
  const manualConfidence = JSON.stringify({ _confidence: { sleeve_shape: 'manual' } })
  const ids = {
    fitted: insert.run('fitted piece', 'fitted', '[]', '{}').lastInsertRowid,
    straight: insert.run('straight piece', 'straight', '[]', '{}').lastInsertRowid,
    puff: insert.run('puff piece', 'puff', '[]', '{}').lastInsertRowid,
    bishop: insert.run('bishop piece', 'bishop', '[]', '{}').lastInsertRowid,
    bell: insert.run('bell piece', 'bell', '[]', '{}').lastInsertRowid,
    flutter: insert.run('flutter piece', 'flutter', '[]', '{}').lastInsertRowid,
    dolman: insert.run('dolman piece', 'dolman', '[]', '{}').lastInsertRowid,
    other: insert.run('other piece', 'other', '[]', '{}').lastInsertRowid,
    unknown: insert.run('unknown piece', 'unknown', '[]', '{}').lastInsertRowid,
    manualDolman: insert.run('manual dolman piece', 'dolman', '["sleeve_shape"]', manualConfidence).lastInsertRowid,
  }
  db.close()

  bootDb(dbPath) // second boot runs the migration against the rows just inserted

  const verify = new Database(dbPath, { readonly: true })
  const shapeOf = id => verify.prepare('SELECT sleeve_shape FROM pieces WHERE id = ?').get(id).sleeve_shape

  assert.equal(shapeOf(ids.fitted), 'fitted')
  assert.equal(shapeOf(ids.straight), 'straight')
  assert.equal(shapeOf(ids.puff), 'puff_shoulder')
  assert.equal(shapeOf(ids.bishop), 'voluminous')
  assert.equal(shapeOf(ids.bell), 'flared')
  assert.equal(shapeOf(ids.flutter), 'flared')
  assert.equal(shapeOf(ids.dolman), 'deep_armhole')
  // other/unknown are already valid in the new taxonomy — left as-is, not remapped to anything else.
  assert.equal(shapeOf(ids.other), 'other')
  assert.equal(shapeOf(ids.unknown), 'unknown')

  // Manual status and confidence are untouched by the value translation.
  const manualRow = verify.prepare('SELECT sleeve_shape, manual_overrides, style_profile_json FROM pieces WHERE id = ?').get(ids.manualDolman)
  assert.equal(manualRow.sleeve_shape, 'deep_armhole')
  assert.ok(JSON.parse(manualRow.manual_overrides).includes('sleeve_shape'))
  assert.equal(JSON.parse(manualRow.style_profile_json)._confidence.sleeve_shape, 'manual')
  verify.close()
})

test('relaxed and raglan are not automatically remapped; they are queued for manual review instead', () => {
  const dbPath = path.join(tmpRoot, 'ambiguous.db')
  bootDb(dbPath)

  const db = new Database(dbPath)
  const insert = db.prepare(`INSERT INTO pieces (name, category, sleeve_length, sleeve_shape) VALUES (?, 'top', 'long', ?)`)
  const relaxedId = insert.run('relaxed piece', 'relaxed').lastInsertRowid
  const raglanId = insert.run('raglan piece', 'raglan').lastInsertRowid
  db.close()

  bootDb(dbPath)

  const verify = new Database(dbPath, { readonly: true })
  assert.equal(verify.prepare('SELECT sleeve_shape FROM pieces WHERE id = ?').get(relaxedId).sleeve_shape, 'relaxed')
  assert.equal(verify.prepare('SELECT sleeve_shape FROM pieces WHERE id = ?').get(raglanId).sleeve_shape, 'raglan')

  const reviewTodos = verify.prepare(`
    SELECT linked_piece_id, field, source_type FROM todos
    WHERE type = 'retag-suggestion' AND source_type = 'sleeve-taxonomy-migration' AND completed = 0
  `).all()
  const flaggedIds = new Set(reviewTodos.map(row => row.linked_piece_id))
  assert.ok(flaggedIds.has(Number(relaxedId)))
  assert.ok(flaggedIds.has(Number(raglanId)))
  assert.ok(reviewTodos.every(row => row.field === 'sleeve_shape'))
  verify.close()
})

test('sleeveless pieces have sleeve_shape cleared to NULL, not left stale or set to unknown', () => {
  const dbPath = path.join(tmpRoot, 'sleeveless.db')
  bootDb(dbPath)

  const db = new Database(dbPath)
  const insert = db.prepare(`INSERT INTO pieces (name, category, sleeve_length, sleeve_shape) VALUES (?, 'top', 'sleeveless', ?)`)
  const staleId = insert.run('stale-shape sleeveless piece', 'fitted').lastInsertRowid
  db.close()

  bootDb(dbPath)

  const verify = new Database(dbPath, { readonly: true })
  assert.equal(verify.prepare('SELECT sleeve_shape FROM pieces WHERE id = ?').get(staleId).sleeve_shape, null)
  verify.close()
})

test('migration is idempotent: a third boot does not re-translate already-migrated values or duplicate review todos', () => {
  const dbPath = path.join(tmpRoot, 'idempotent.db')
  bootDb(dbPath)

  const db = new Database(dbPath)
  const insert = db.prepare(`INSERT INTO pieces (name, category, sleeve_length, sleeve_shape) VALUES (?, 'top', 'long', ?)`)
  const bishopId = insert.run('bishop piece', 'bishop').lastInsertRowid
  const relaxedId = insert.run('relaxed piece', 'relaxed').lastInsertRowid
  db.close()

  bootDb(dbPath)
  bootDb(dbPath)
  bootDb(dbPath)

  const verify = new Database(dbPath, { readonly: true })
  assert.equal(verify.prepare('SELECT sleeve_shape FROM pieces WHERE id = ?').get(bishopId).sleeve_shape, 'voluminous')
  const reviewCount = verify.prepare(`
    SELECT COUNT(*) AS n FROM todos
    WHERE type = 'retag-suggestion' AND source_type = 'sleeve-taxonomy-migration' AND linked_piece_id = ?
  `).get(relaxedId).n
  assert.equal(reviewCount, 1, 'repeated boots must not duplicate the review todo')
  verify.close()
})
