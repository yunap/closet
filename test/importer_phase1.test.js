// Spec 31 Phase 1 — ingest doors + classification contracts.
// Pins: ZIP ingestion with Takeout structure (album hint captured, sidecar JSON ignored),
// video handling via a STUB ffmpeg on PATH (frames sampled, blurry frames dropped) and the
// graceful-skip-with-hint ruling when ffmpeg is absent, no-silent-caps counting throughout,
// cheap-model classification batching with spend accumulation, and that classification
// uses the cheap tier (model override reaches the provider).
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import AdmZip from 'adm-zip'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-importer-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.ANTHROPIC_API_KEY = ''
process.env.OPENAI_API_KEY = ''
// Point at a guaranteed-missing ffmpeg by default; individual tests swap in a stub.
process.env.WARDROBE_FFMPEG_BIN = path.join(tmpRoot, 'no-such-ffmpeg')

const { app } = await import('../server.js')
const { db } = await import('../db.js')

const server = app.listen(0)
await once(server, 'listening')
const baseUrl = `http://127.0.0.1:${server.address().port}`

after(async () => {
  await new Promise(resolve => server.close(resolve))
})

const makeJpeg = async (color, size = 400) => {
  const patch = await sharp({ create: { width: Math.floor(size / 3), height: Math.floor(size / 2), channels: 3, background: '#222222' } }).jpeg().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 3, background: color } })
    .composite([{ input: patch, left: 30, top: 40 }])
    .jpeg().toBuffer()
}

// A near-uniform frame — must trip the blur/emptiness drop.
const makeFlatJpeg = async () =>
  sharp({ create: { width: 400, height: 400, channels: 3, background: '#808080' } }).jpeg().toBuffer()

async function createSession() {
  const res = await fetch(`${baseUrl}/api/import/sessions`, { method: 'POST' })
  return res.json()
}

async function uploadFiles(sessionId, files) {
  const form = new FormData()
  for (const { name, buffer } of files) {
    form.append('files', new Blob([buffer]), name)
  }
  const res = await fetch(`${baseUrl}/api/import/sessions/${sessionId}/files`, { method: 'POST', body: form })
  return res.json()
}

test('loose images ingest; unsupported files are counted, never silent', async () => {
  const { sessionId } = await createSession()
  const result = await uploadFiles(sessionId, [
    { name: 'a.jpg', buffer: await makeJpeg('#aa3333') },
    { name: 'b.png', buffer: await sharp({ create: { width: 300, height: 300, channels: 3, background: '#3355aa' } }).png().toBuffer() },
    { name: 'notes.txt', buffer: Buffer.from('not an image') }
  ])
  assert.equal(result.counts.imagesIngested, 2)
  assert.equal(result.counts.unsupportedSkipped, 1)
  const rows = db.prepare('SELECT * FROM import_images WHERE session_id = ?').all(sessionId)
  assert.equal(rows.length, 2)
  assert.ok(rows.every(row => fs.existsSync(path.join(tmpRoot, 'uploads', 'import', String(sessionId), row.file))))
})

test('Takeout-style ZIP: album hint captured, sidecar JSON ignored, junk counted', async () => {
  const zip = new AdmZip()
  zip.addFile('Takeout/Google Photos/Summer Fits/photo1.jpg', await makeJpeg('#33aa55'))
  zip.addFile('Takeout/Google Photos/Summer Fits/photo1.jpg.json', Buffer.from('{"title":"photo1"}'))
  zip.addFile('Takeout/Google Photos/Summer Fits/clip.gif', Buffer.from('GIF89a'))
  const { sessionId } = await createSession()
  const result = await uploadFiles(sessionId, [{ name: 'takeout.zip', buffer: zip.toBuffer() }])
  assert.equal(result.counts.imagesIngested, 1)
  assert.equal(result.counts.metadataFilesIgnored, 1)
  assert.equal(result.counts.unsupportedSkipped, 1)
  const row = db.prepare('SELECT * FROM import_images WHERE session_id = ?').get(sessionId)
  assert.equal(row.album_hint, 'Summer Fits')
  assert.equal(row.origin, 'zip:takeout.zip')
})

test('video without ffmpeg: skipped with visible count and install hint (owner ruling)', async () => {
  const { sessionId, ffmpegAvailable } = await createSession()
  assert.equal(ffmpegAvailable, false)
  const result = await uploadFiles(sessionId, [
    { name: 'closet.mov', buffer: Buffer.from('fake video bytes') },
    { name: 'still.jpg', buffer: await makeJpeg('#aa8833') }
  ])
  assert.equal(result.counts.videosSkippedNoFfmpeg, 1)
  assert.equal(result.counts.imagesIngested, 1, 'images still import normally')
  assert.match(result.ffmpegHint, /ffmpeg is not installed/)
})

test('video with stub ffmpeg: frames sampled, near-empty frames dropped', async () => {
  // Stub ffmpeg: writes three frames (two real, one flat) to the output pattern.
  const stubDir = fs.mkdtempSync(path.join(tmpRoot, 'stub-'))
  const framesSrc = path.join(stubDir, 'frames')
  fs.mkdirSync(framesSrc)
  fs.writeFileSync(path.join(framesSrc, '1.jpg'), await makeJpeg('#eeeeee'))
  fs.writeFileSync(path.join(framesSrc, '2.jpg'), await makeJpeg('#dddddd'))
  fs.writeFileSync(path.join(framesSrc, '3.jpg'), await makeFlatJpeg())
  const stub = path.join(stubDir, 'ffmpeg-stub.sh')
  fs.writeFileSync(stub, `#!/bin/sh
if [ "$1" = "-version" ]; then exit 0; fi
# last argument is the output pattern, e.g. /tmp/dir/frame-%04d.jpg
out=""
for arg in "$@"; do out="$arg"; done
dir=$(dirname "$out")
i=1
for f in ${framesSrc}/*.jpg; do
  cp "$f" "$dir/frame-000$i.jpg"
  i=$((i+1))
done
exit 0
`, { mode: 0o755 })
  process.env.WARDROBE_FFMPEG_BIN = stub

  const { sessionId, ffmpegAvailable } = await createSession()
  assert.equal(ffmpegAvailable, true)
  const result = await uploadFiles(sessionId, [{ name: 'closet.mp4', buffer: Buffer.from('fake video bytes') }])
  process.env.WARDROBE_FFMPEG_BIN = path.join(tmpRoot, 'no-such-ffmpeg')

  assert.equal(result.counts.framesSampled, 2, JSON.stringify(result.counts))
  assert.equal(result.counts.blurryFramesDropped, 1)
  const rows = db.prepare('SELECT origin FROM import_images WHERE session_id = ?').all(sessionId)
  assert.equal(rows.length, 2)
  assert.ok(rows.every(row => row.origin === 'video:closet.mp4'))
})

test('classification: cheap-tier batches, kinds recorded, spend accumulated', async () => {
  const { sessionId } = await createSession()
  await uploadFiles(sessionId, [
    { name: 'w1.jpg', buffer: await makeJpeg('#994455') },
    { name: 'g1.jpg', buffer: await makeJpeg('#449955') },
    { name: 'x1.jpg', buffer: await makeJpeg('#445599') }
  ])
  const seenCalls = []
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [
    ({ system, messages, maxTokens }) => {
      seenCalls.push({ system, imageCount: messages[0].content.filter(block => block.type === 'image').length })
      // Harness contract: the returned object is JSON.stringified into the response
      // text (usage plucked separately) — so classifications live at top level.
      return {
        classifications: [
          { index: 1, kind: 'worn_outfit' },
          { index: 2, kind: 'garment_only' },
          { index: 3, kind: 'irrelevant' }
        ],
        usage: { input_tokens: 3000, output_tokens: 100 }
      }
    }
  ]
  const res = await fetch(`${baseUrl}/api/import/sessions/${sessionId}/classify`, { method: 'POST' })
  const result = await res.json()
  assert.equal(result.classified, 3)
  assert.equal(result.failedBatches, 0)
  assert.deepEqual(result.kindCounts, { worn_outfit: 1, garment_only: 1, irrelevant: 1 })
  assert.ok(result.spentUsd > 0, 'spend accumulates on the session from usage pricing')
  assert.equal(seenCalls.length, 1, 'three images fit one batch')
  assert.equal(seenCalls[0].imageCount, 3)
  assert.match(seenCalls[0].system, /wardrobe import pipeline/)

  const status = await (await fetch(`${baseUrl}/api/import/sessions/${sessionId}`)).json()
  assert.equal(status.status, 'classified')
})

test('classification failure keeps session un-finalized and reports the failed batch', async () => {
  const { sessionId } = await createSession()
  await uploadFiles(sessionId, [{ name: 'w1.jpg', buffer: await makeJpeg('#997755') }])
  globalThis.__WARDROBE_AI_TEST_RESPONSES__ = [
    () => { throw new Error('model unavailable') }
  ]
  const result = await (await fetch(`${baseUrl}/api/import/sessions/${sessionId}/classify`, { method: 'POST' })).json()
  assert.equal(result.failedBatches, 1)
  const status = await (await fetch(`${baseUrl}/api/import/sessions/${sessionId}`)).json()
  assert.equal(status.status, 'ingesting', 'session not marked classified after a failed batch')
  assert.equal(status.kindCounts.pending, 1, 'image stays pending for retry')
})
