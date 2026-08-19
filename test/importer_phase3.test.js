// Spec 31 Phase 3 — cost gate, bulk tagging, and review gate contracts.
// Pins: the expensive tier CANNOT run without explicit preflight approval (acceptance
// criterion), merge clusters are never tagged (no wasted spend), accept creates a
// PROVISIONAL piece with allowlisted tag fields + evidence rows, merge attaches
// permanent evidence and fills an empty worn_photo, reject/skip finalize without
// writes, and calibration seeding defaults ON for a fresh library and seeds only
// worn evidence when enabled.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-importer3-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.ANTHROPIC_API_KEY = ''
process.env.OPENAI_API_KEY = ''
process.env.WARDROBE_FFMPEG_BIN = path.join(tmpRoot, 'no-such-ffmpeg')

const { app } = await import('../server.js')
const { db } = await import('../db.js')

const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
const baseUrl = `http://127.0.0.1:${server.address().port}`

after(async () => {
  await new Promise(resolve => server.close(resolve))
})

const makeJpeg = async (color) => {
  const patch = await sharp({ create: { width: 200, height: 300, channels: 3, background: '#101020' } }).jpeg().toBuffer()
  return sharp({ create: { width: 800, height: 800, channels: 3, background: color } })
    .composite([{ input: patch, left: 100, top: 120 }]).jpeg().toBuffer()
}

const post = async (route, body) => {
  const res = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  })
  return { status: res.status, body: await res.json() }
}
const getJson = async (route) => (await fetch(`${baseUrl}${route}`)).json()

// Build a session that is fully matched: two new-piece clusters (one worn, one
// garment-only) and one merge cluster targeting a seeded existing piece.
async function buildMatchedSession() {
  const photoName = `existing-${Date.now()}.jpg`
  // Spec 33 Part 1: uploads dir creation is now lazy (per-user, on first access via
  // userUploadsDir()) rather than an eager side effect of importing db.js.
  fs.mkdirSync(path.join(tmpRoot, 'uploads'), { recursive: true })
  fs.writeFileSync(path.join(tmpRoot, 'uploads', photoName), await makeJpeg('#223355'))
  const existingId = db.prepare("INSERT INTO pieces (name, category, photo, status) VALUES ('owned navy top', 'top', ?, 'active')").run(photoName).lastInsertRowid

  const { sessionId } = await (await fetch(`${baseUrl}/api/import/sessions`, { method: 'POST' })).json()
  const form = new FormData()
  for (const name of ['worn.jpg', 'hanger.jpg', 'match.jpg']) form.append('files', new Blob([await makeJpeg('#b8b0a0')]), name)
  await fetch(`${baseUrl}/api/import/sessions/${sessionId}/files`, { method: 'POST', body: form })

  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [
    () => ({ classifications: [
      { index: 1, kind: 'worn_outfit' }, { index: 2, kind: 'garment_only' }, { index: 3, kind: 'worn_outfit' }
    ] })
  ]
  await post(`/api/import/sessions/${sessionId}/classify`)
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [
    () => ({ garments: [{ box: { x: 100, y: 100, w: 500, h: 600 }, category: 'top', color: 'rust', descriptor: 'rust ribbed tank' }] }),
    () => ({ garments: [{ box: { x: 100, y: 100, w: 500, h: 600 }, category: 'bottom', color: 'olive', descriptor: 'olive cargo pants' }] }),
    () => ({ garments: [{ box: { x: 100, y: 100, w: 500, h: 600 }, category: 'top', color: 'navy', descriptor: 'navy knit top' }] })
  ]
  await post(`/api/import/sessions/${sessionId}/detect`)
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = []
  await post(`/api/import/sessions/${sessionId}/cluster`)
  // Note: the olive cargo cluster consumes NO match call — there are no existing
  // 'bottom' pieces with photos, and candidate-less clusters skip adjudication.
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [
    () => ({ match_index: null }), // rust tank (top) → new piece
    () => ({ match_index: 1 })     // navy knit (top) → merge with existing
  ]
  await post(`/api/import/sessions/${sessionId}/match-existing`)
  return { sessionId, existingId }
}

test('full pipeline: preflight prices new pieces only; tag gate refuses without approval', async () => {
  const { sessionId } = await buildMatchedSession()

  const preflight = await getJson(`/api/import/sessions/${sessionId}/preflight`)
  assert.equal(preflight.newPieceClusters, 2, JSON.stringify(preflight))
  assert.equal(preflight.mergeClusters, 1)
  assert.ok(preflight.estimatedTagUsd > 0)

  const refused = await post(`/api/import/sessions/${sessionId}/tag`, {})
  assert.equal(refused.status, 400)
  assert.match(refused.body.error, /preflight approval/)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM import_clusters WHERE session_id = ? AND tags_json IS NOT NULL").get(sessionId).n, 0, 'no tagging happened without approval')

  // Approved tagging: two full-model tagger calls (merge cluster skips tagging).
  const taggerCalls = []
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [
    ({ system }) => { taggerCalls.push(system); return { name: 'rust ribbed tank top', category: 'top', colors: ['rust'], occasions: ['casual'], season: 'warm', formality: 'everyday', reads_as: 'casual ribbed tank', tagger_version: 'test-tagger' } },
    ({ system }) => { taggerCalls.push(system); return { name: 'olive cargo pants', category: 'bottom', colors: ['olive'], occasions: ['casual', 'outdoor'], season: 'year-round', formality: 'everyday' } }
  ]
  const tagResult = await post(`/api/import/sessions/${sessionId}/tag`, { approve: true })
  assert.equal(tagResult.body.tagged, 2, JSON.stringify(tagResult.body))
  assert.equal(taggerCalls.length, 2, 'merge cluster must not consume a tagging call')

  const queue = await getJson(`/api/import/sessions/${sessionId}/review-queue`)
  assert.equal(queue.calibrationSeedDefault, true, 'fresh calibration library defaults seeding ON')
  assert.equal(queue.queue.length, 3)
  const mergeEntry = queue.queue.find(entry => entry.mergeTarget)
  assert.equal(mergeEntry.mergeTarget.name, 'owned navy top')

  // Review: accept the rust tank (with calibration seeding), reject the cargo,
  // merge the navy knit into the existing piece.
  const acceptEntry = queue.queue.find(entry => entry.descriptor === 'rust ribbed tank')
  const rejectEntry = queue.queue.find(entry => entry.descriptor === 'olive cargo pants')
  const review = await post(`/api/import/sessions/${sessionId}/review`, {
    seedCalibration: true,
    decisions: [
      { clusterId: acceptEntry.id, action: 'accept' },
      { clusterId: rejectEntry.id, action: 'reject' },
      { clusterId: mergeEntry.id, action: 'merge' }
    ]
  })
  assert.equal(review.body.remaining, 0)

  // Accept: provisional piece with allowlisted tags, photo, worn_photo, evidence.
  const accepted = review.body.results.find(r => r.outcome === 'accepted')
  const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(accepted.pieceId)
  assert.equal(piece.name, 'rust ribbed tank top')
  assert.equal(piece.tag_state, 'provisional', 'imported pieces land provisional — the trust ladder is the only path up')
  assert.equal(piece.formality, 'everyday')
  assert.ok(piece.photo && fs.existsSync(path.join(tmpRoot, 'uploads', piece.photo)))
  assert.ok(piece.worn_photo, 'canonical from a worn image fills worn_photo')
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM piece_import_evidence WHERE piece_id = ?').get(accepted.pieceId).n >= 1)

  // Merge: evidence attached to the existing piece; empty worn_photo filled.
  const merged = review.body.results.find(r => r.outcome === 'merged')
  const target = db.prepare('SELECT * FROM pieces WHERE id = ?').get(merged.pieceId)
  assert.equal(target.name, 'owned navy top')
  assert.ok(target.worn_photo, 'merge fills empty worn_photo from worn evidence')
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM piece_import_evidence WHERE piece_id = ?').get(merged.pieceId).n >= 1)

  // Reject: no piece created for the cargo cluster.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pieces WHERE name LIKE '%cargo%'").get().n, 0)

  // Calibration seeding: worn evidence rows only (accept had 1 worn member; merge had 1).
  const calibration = db.prepare("SELECT * FROM calibration_images WHERE source = 'import'").all()
  assert.ok(calibration.length >= 2, `worn evidence seeded calibration (got ${calibration.length})`)

  const status = await getJson(`/api/import/sessions/${sessionId}`)
  assert.equal(status.status, 'reviewed')
})

test('calibration seeding stays opt-out once a curated library exists', async () => {
  // The previous test seeded calibration rows — the default must now be OFF.
  const { sessionId } = await buildMatchedSession()
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [
    () => ({ name: 'x', category: 'top' }),
    () => ({ name: 'y', category: 'bottom' })
  ]
  await post(`/api/import/sessions/${sessionId}/tag`, { approve: true })
  const queue = await getJson(`/api/import/sessions/${sessionId}/review-queue`)
  assert.equal(queue.calibrationSeedDefault, false, 'curated calibration library flips the default OFF (owner ruling)')
})

test('failed-crop worn garment stores the photo once: worn_photo set, hanger photo empty', async () => {
  const { sessionId } = await buildMatchedSession()
  // Mark every canonical crop as failed verification before tagging/accept.
  db.prepare('UPDATE import_garments SET crop_ok = 0 WHERE session_id = ?').run(sessionId)
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [
    () => ({ name: 'fallback tank', category: 'top' }),
    () => ({ name: 'fallback cargo', category: 'bottom' })
  ]
  await post(`/api/import/sessions/${sessionId}/tag`, { approve: true })
  const queue = await getJson(`/api/import/sessions/${sessionId}/review-queue`)
  const tank = queue.queue.find(entry => entry.descriptor === 'rust ribbed tank')
  assert.equal(tank.cropOk, false, 'review card labeled as full photo')
  const review = await post(`/api/import/sessions/${sessionId}/review`, {
    decisions: [{ clusterId: tank.id, action: 'accept' }]
  })
  const accepted = review.body.results.find(r => r.outcome === 'accepted')
  const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(accepted.pieceId)
  assert.ok(piece.worn_photo, 'worn photo stored (source was a worn outfit photo)')
  assert.equal(piece.photo, null, 'no duplicate hanger photo — same image not stored twice')
})

test('reviewer overrides beat model tags: corrected name and category land on the piece', async () => {
  const { sessionId } = await buildMatchedSession()
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [
    // The model misreads the garment (the occluded-waist dress case).
    () => ({ name: 'navy denim midi skirt', category: 'bottom' }),
    () => ({ name: 'olive cargo pants', category: 'bottom' })
  ]
  await post(`/api/import/sessions/${sessionId}/tag`, { approve: true })
  const queue = await getJson(`/api/import/sessions/${sessionId}/review-queue`)
  const entry = queue.queue.find(e => e.proposedName === 'navy denim midi skirt')
  const review = await post(`/api/import/sessions/${sessionId}/review`, {
    decisions: [{ clusterId: entry.id, action: 'accept', name: 'navy denim midi dress', category: 'dress' }]
  })
  const accepted = review.body.results.find(r => r.outcome === 'accepted')
  const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(accepted.pieceId)
  assert.equal(piece.name, 'navy denim midi dress')
  assert.equal(piece.category, 'dress')
})
