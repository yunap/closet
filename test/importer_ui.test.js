// Spec 31 Phase 3 — source contracts for the import UI and its entry points.
// Pins: the UI's tag approval carries the explicit approve flag (the cost-gate contract
// end to end), decisions cover the four review actions, dropped-item counts and the
// ffmpeg hint are surfaced, the wizard done-step hands off to /import, and the
// wardrobe header links in.
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

const read = p => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

test('import UI honors the cost gate and surfaces every drop count', () => {
  const src = read('src/views/WardrobeImport.jsx')
  assert.match(src, /\/tag`, \{ approve: true \}/, 'tagging is sent only with the explicit approval flag')
  assert.match(src, /estimatedTagUsd/, 'preflight estimate shown before approval')
  for (const action of ['accept', 'merge', 'reject', 'skip']) assert.ok(src.includes(`'${action}'`), `review action ${action}`)
  assert.match(src, /videosSkippedNoFfmpeg/, 'no-ffmpeg drop count surfaced')
  assert.match(src, /ffmpegHint/, 'install hint surfaced')
  assert.match(src, /seedCalibration/, 'calibration seeding toggle wired')
  assert.match(src, /calibrationSeedDefault/, 'server-decided seeding default respected')
})

test('app shell and entry points wire the importer', () => {
  const app = read('src/App.jsx')
  assert.match(app, /path="\/import"\s+element=\{<WardrobeImport \/>\}/)
  const wizard = read('src/views/Onboarding.jsx')
  assert.match(wizard, /finish\('\/import'\)/, 'wizard done-step hands off to the importer')
  const inventory = read('src/views/PieceInventory.jsx')
  assert.match(inventory, /navigate\('\/import'\)/, 'wardrobe header links to the importer')
})
