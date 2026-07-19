// Spec 31 Phase 2 — detection, crops, and dedup clustering contracts.
// Pins: bbox detection produces real crop files (per-mille coords honored), invalid
// categories/boxes are counted not saved, clustering groups same-garment crops with the
// over-split fallback (model-dropped indexes become singleton clusters; failed sheets
// degrade to all-singletons), canonical crop = largest area, and merge-vs-existing
// proposes a merge only on a confident match (unsure = null = new-piece proposal).
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-importer2-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.ANTHROPIC_API_KEY = ''
process.env.OPENAI_API_KEY = ''
process.env.WARDROBE_FFMPEG_BIN = path.join(tmpRoot, 'no-such-ffmpeg')

const { app } = await import('../server.js')
const { db } = await import('../db.js')

const server = app.listen(0)
await once(server, 'listening')
const baseUrl = `http://127.0.0.1:${server.address().port}`

after(async () => {
  await new Promise(resolve => server.close(resolve))
})

const makeJpeg = async (color, size = 800) => {
  const patch = await sharp({ create: { width: 200, height: 300, channels: 3, background: '#1a1a2e' } }).jpeg().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 3, background: color } })
    .composite([{ input: patch, left: 100, top: 120 }])
    .jpeg().toBuffer()
}

async function createSession() {
  return (await fetch(`${baseUrl}/api/import/sessions`, { method: 'POST' })).json()
}

async function uploadImages(sessionId, names) {
  const form = new FormData()
  for (const name of names) form.append('files', new Blob([await makeJpeg('#c9c2b4')]), name)
  await fetch(`${baseUrl}/api/import/sessions/${sessionId}/files`, { method: 'POST', body: form })
}

function classifyAll(kind) {
  return ({ }) => ({ classifications: Array.from({ length: 20 }, (_, i) => ({ index: i + 1, kind })) })
}

const post = async (route) => (await fetch(`${baseUrl}${route}`, { method: 'POST' })).json()

test('detection: valid garments crop to files; junk boxes and categories are counted', async () => {
  const { sessionId } = await createSession()
  await uploadImages(sessionId, ['outfit1.jpg'])
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [classifyAll('worn_outfit')]
  await post(`/api/import/sessions/${sessionId}/classify`)

  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [
    () => ({ garments: [
      { box: { x: 100, y: 100, w: 400, h: 500 }, category: 'top', color: 'navy', descriptor: 'navy knit top' },
      { box: { x: 500, y: 550, w: 350, h: 400 }, category: 'bottom', color: 'cream', descriptor: 'cream wide-leg pants' },
      { box: { x: 0, y: 0, w: 900, h: 900 }, category: 'spaceship', color: 'x', descriptor: 'not a garment' },
      { box: { x: 10, y: 10, w: 5, h: 5 }, category: 'shoes', color: 'black', descriptor: 'tiny sliver' }
    ], usage: { input_tokens: 1500, output_tokens: 150 } })
  ]
  const result = await post(`/api/import/sessions/${sessionId}/detect`)
  assert.equal(result.garmentsDetected, 2, JSON.stringify(result))
  assert.equal(result.cropsRejected, 2)
  const garments = db.prepare('SELECT * FROM import_garments WHERE session_id = ?').all(sessionId)
  assert.equal(garments.length, 2)
  for (const garment of garments) {
    const cropPath = path.join(tmpRoot, 'uploads', 'import', String(sessionId), garment.crop_file)
    assert.ok(fs.existsSync(cropPath), 'crop file exists')
    const meta = await sharp(cropPath).metadata()
    assert.ok(meta.width > 40 && meta.height > 40)
  }
  assert.ok(result.spentUsd > 0)
})

test('clustering: same-garment crops group; dropped indexes become singletons (over-split)', async () => {
  const { sessionId } = await createSession()
  await uploadImages(sessionId, ['a.jpg', 'b.jpg', 'c.jpg'])
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [classifyAll('worn_outfit')]
  await post(`/api/import/sessions/${sessionId}/classify`)
  // One garment per image, same category+color bucket.
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [
    () => ({ garments: [{ box: { x: 100, y: 100, w: 500, h: 600 }, category: 'top', color: 'navy', descriptor: 'navy top A' }] }),
    () => ({ garments: [{ box: { x: 100, y: 100, w: 400, h: 500 }, category: 'top', color: 'navy', descriptor: 'navy top B' }] }),
    () => ({ garments: [{ box: { x: 100, y: 100, w: 300, h: 400 }, category: 'top', color: 'navy', descriptor: 'navy top C' }] })
  ]
  await post(`/api/import/sessions/${sessionId}/detect`)

  // Model groups crops 1+2 as the same garment and (deliberately) drops crop 3 from
  // its answer — the pipeline must singleton it rather than lose it.
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [
    () => ({ groups: [[1, 2]] })
  ]
  const result = await post(`/api/import/sessions/${sessionId}/cluster`)
  assert.equal(result.clustersCreated, 2, JSON.stringify(result))
  const clusters = db.prepare('SELECT * FROM import_clusters WHERE session_id = ? ORDER BY id').all(sessionId)
  assert.equal(clusters.length, 2)
  const members = db.prepare('SELECT cluster_id, COUNT(*) AS n FROM import_garments WHERE session_id = ? GROUP BY cluster_id ORDER BY n DESC').all(sessionId)
  assert.deepEqual(members.map(m => m.n), [2, 1])
  // Canonical = largest-area crop of the pair (garment A, 500x600 box).
  const pair = clusters.find(c => c.id === members[0].cluster_id)
  const canonical = db.prepare('SELECT descriptor FROM import_garments WHERE id = ?').get(pair.canonical_garment_id)
  assert.equal(canonical.descriptor, 'navy top A')
})

test('cluster sheet failure degrades to all singletons, session stays un-finalized', async () => {
  const { sessionId } = await createSession()
  await uploadImages(sessionId, ['d.jpg', 'e.jpg'])
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [classifyAll('garment_only')]
  await post(`/api/import/sessions/${sessionId}/classify`)
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [
    () => ({ garments: [{ box: { x: 100, y: 100, w: 500, h: 600 }, category: 'dress', color: 'olive', descriptor: 'olive dress 1' }] }),
    () => ({ garments: [{ box: { x: 100, y: 100, w: 500, h: 600 }, category: 'dress', color: 'olive', descriptor: 'olive dress 2' }] })
  ]
  await post(`/api/import/sessions/${sessionId}/detect`)
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [
    () => { throw new Error('model unavailable') }
  ]
  const result = await post(`/api/import/sessions/${sessionId}/cluster`)
  assert.equal(result.failedSheets, 1)
  assert.equal(result.clustersCreated, 2, 'failed sheet degrades to singletons — nothing lost')
  const status = await (await fetch(`${baseUrl}/api/import/sessions/${sessionId}`)).json()
  assert.notEqual(status.status, 'clustered')
})

test('merge-vs-existing: confident match proposes merge; unsure(null) leaves new-piece proposal', async () => {
  // Seed two existing wardrobe pieces with real photo files.
  const photoName = 'existing-navy-top.jpg'
  fs.writeFileSync(path.join(tmpRoot, 'uploads', photoName), await makeJpeg('#223355'))
  const insPiece = db.prepare("INSERT INTO pieces (name, category, photo, status) VALUES (?, 'top', ?, 'active')")
  const matched = insPiece.run('navy knit top (owned)', photoName).lastInsertRowid

  const { sessionId } = await createSession()
  await uploadImages(sessionId, ['m1.jpg', 'm2.jpg'])
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [classifyAll('worn_outfit')]
  await post(`/api/import/sessions/${sessionId}/classify`)
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [
    () => ({ garments: [{ box: { x: 100, y: 100, w: 500, h: 600 }, category: 'top', color: 'navy', descriptor: 'navy knit top' }] }),
    () => ({ garments: [{ box: { x: 100, y: 100, w: 500, h: 600 }, category: 'top', color: 'rust', descriptor: 'rust tee' }] })
  ]
  await post(`/api/import/sessions/${sessionId}/detect`)
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = []
  await post(`/api/import/sessions/${sessionId}/cluster`) // two buckets of one → no model calls

  // First cluster: confident match to existing piece 1. Second: unsure → null.
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [
    () => ({ match_index: 1 }),
    () => ({ match_index: null })
  ]
  const result = await post(`/api/import/sessions/${sessionId}/match-existing`)
  assert.equal(result.mergeProposals, 1, JSON.stringify(result))
  const clusters = db.prepare('SELECT * FROM import_clusters WHERE session_id = ? ORDER BY id').all(sessionId)
  const merged = clusters.filter(c => c.merge_target_piece_id !== null)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].merge_target_piece_id, matched)
  const status = await (await fetch(`${baseUrl}/api/import/sessions/${sessionId}`)).json()
  assert.equal(status.status, 'matched')
})
