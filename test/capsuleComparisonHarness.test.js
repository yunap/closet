import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-comparison-harness-'))
const uploadsDir = path.join(root, 'uploads')
fs.mkdirSync(uploadsDir, { recursive: true })
process.env.WARDROBE_DB_PATH = path.join(root, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = uploadsDir

const {
  captureComparisonAnswer,
  comparisonAttempts,
  resetComparisonAttempts,
  renderRosterContactSheet
} = await import('../scratch/_capsule_model_chooser.js')

test('comparison capture preserves rejected answers, failures, duplicates and outside-bench ids', () => {
  const bench = [
    { id: 1, name: 'black top', category: 'top', colors: ['black'], photo: 'one.png' },
    { id: 2, name: 'cream skirt', category: 'bottom', colors: ['cream'], photo: 'two.png' }
  ]
  resetComparisonAttempts()
  captureComparisonAnswer(
    { attempt: 1, bench },
    { roster_piece_ids: [1, 1, 999] }
  )
  captureComparisonAnswer(
    { attempt: 2, bench, failures: [{ code: 'roster_size', message: 'wrong size' }] },
    { roster_piece_ids: [1, 2] }
  )

  assert.equal(comparisonAttempts.length, 2)
  assert.deepEqual(comparisonAttempts[0].rosterPieceIds, [1])
  assert.deepEqual(comparisonAttempts[0].duplicateIds, [1])
  assert.deepEqual(comparisonAttempts[0].outsideBenchIds, [999])
  assert.equal(comparisonAttempts[0].failures[0].code, 'roster_size')
  assert.deepEqual(comparisonAttempts[1].rosterPieceIds, [1, 2])
})

test('contact-sheet renderer writes a readable PNG without a provider call', async () => {
  await sharp({ create: { width: 80, height: 120, channels: 3, background: '#7a4d38' } })
    .png()
    .toFile(path.join(uploadsDir, 'one.png'))
  await sharp({ create: { width: 120, height: 80, channels: 3, background: '#e7dfcf' } })
    .png()
    .toFile(path.join(uploadsDir, 'two.png'))
  const outPath = path.join(root, 'comparison.png')

  await renderRosterContactSheet({
    roster: [
      { id: 1, name: 'black top', category: 'top', colors: ['black'], photo: 'one.png' },
      { id: 2, name: 'cream skirt', category: 'bottom', colors: ['cream'], photo: 'two.png' }
    ],
    label: 'Engine roster · offline test',
    outPath
  })

  const metadata = await sharp(outPath).metadata()
  assert.equal(metadata.format, 'png')
  assert.ok(metadata.width > 1000)
  assert.ok(metadata.height > 300)
  assert.ok(fs.statSync(outPath).size > 1000)
})
