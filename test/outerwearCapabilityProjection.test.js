process.env.NODE_ENV = 'test'
// tools.js reaches db.js transitively, so this file isolates the database before importing it —
// the hermeticity guard enforces this, and without it the import would run migrations against the
// owner's real wardrobe.db (docs/database-safety.md).
process.env.WARDROBE_DB_PATH = process.env.WARDROBE_DB_PATH
  || `${await import('node:os').then(m => m.tmpdir())}/outerwear-projection-${process.pid}.db`

import test from 'node:test'
import assert from 'node:assert'
import { buildWardrobeManifestLine, buildWardrobePieceTruthText } from '../src/utils/wardrobeAiContext.js'
import { wardrobeTruthRow } from '../styling-engine/tools.js'
import { _planWorkbenchPieceLineForTests as planWorkbenchPieceLine } from '../styling-engine/outfitSetPlanner.js'
import { outerwearCapabilityDisplay } from '../styling-engine/outerwearCapability.js'

// Slice E of docs/outerwear-weather-consolidation-spec.md — the canonical facts reach the model.

const COAT = {
  id: 1, name: 'wool coat', category: 'outerwear', outerwear_role: 'cold_weather_outerwear',
  weather_protection: ['rain', 'wind'], fabric_category: 'wool', fabric_weight: 'heavy',
}
const CARDIGAN = { id: 2, name: 'cashmere cardigan', category: 'outerwear', outerwear_role: 'indoor_layer', weather_protection: [] }
const UNTAGGED = { id: 3, name: 'unlined jacket', category: 'outerwear' }
const TEE = { id: 4, name: 'silk tee', category: 'top', outerwear_role: 'cold_weather_outerwear', weather_protection: ['rain'] }

test('the shared display helper is the only place these values are worded', () => {
  assert.deepEqual(outerwearCapabilityDisplay(COAT), { role: 'cold weather outerwear', protection: 'rain/wind' })
  assert.deepEqual(outerwearCapabilityDisplay(CARDIGAN), { role: 'indoor layer', protection: null })
  assert.deepEqual(outerwearCapabilityDisplay(UNTAGGED), { role: null, protection: null })
})

test('the manifest line carries capability — the one home for stable garment truth', () => {
  // docs/search-payload-spec.md option B: when the manifest is present, search rows carry only
  // per-request judgment. A fact that is not here is invisible on the common path.
  const line = buildWardrobeManifestLine(COAT)
  assert.match(line, /outerwear role cold weather outerwear/)
  assert.match(line, /protects against rain\/wind/)
})

test('the composing-prompt truth text carries capability', () => {
  const text = buildWardrobePieceTruthText(COAT)
  assert.match(text, /outerwear role: cold weather outerwear/)
  assert.match(text, /weather protection: rain\/wind/)
})

test('the above-cap truth row carries the raw canonical values', () => {
  const row = wardrobeTruthRow(COAT)
  assert.equal(row.outerwear_role, 'cold_weather_outerwear')
  assert.deepEqual(row.weather_protection, ['rain', 'wind'])
})

test('an indoor layer is projected as itself, with no gloss of what it implies', () => {
  const line = buildWardrobeManifestLine(CARDIGAN)
  assert.match(line, /outerwear role indoor layer/)
  assert.doesNotMatch(line, /protects against/, 'an empty hazard list prints no clause at all')
  // The projections must not editorialise — no "not suitable for", no "keep indoors", nothing that
  // duplicates Contract B's judgment in prose the code does not own.
  assert.doesNotMatch(line, /not suitable|indoors only|do not wear/i)
  assert.doesNotMatch(buildWardrobePieceTruthText(CARDIGAN), /not suitable|indoors only|do not wear/i)
})

test('an untagged outerwear piece prints no capability clause rather than an empty label', () => {
  assert.doesNotMatch(buildWardrobeManifestLine(UNTAGGED), /outerwear role|protects against/)
  assert.doesNotMatch(buildWardrobePieceTruthText(UNTAGGED), /outerwear role|weather protection/)
})

test('the plan workbench line carries capability through the same shared helper', () => {
  // The workbench writes its own compact key:value line instead of reusing the truth text, so it is
  // the one model-facing surface that had to be wired explicitly rather than inheriting.
  const line = planWorkbenchPieceLine(COAT)
  assert.match(line, /outerwear_role:cold_weather_outerwear/)
  assert.match(line, /weather_protection:rain\/wind/)
  assert.doesNotMatch(planWorkbenchPieceLine(UNTAGGED), /outerwear_role|weather_protection/)
  assert.doesNotMatch(planWorkbenchPieceLine(TEE), /outerwear_role|weather_protection/)
})

test('a stray role on a non-outerwear piece never reaches the model', () => {
  // The category gate lives in the readers, so every projection inherits it for free — which is the
  // point of routing all three through one helper.
  assert.doesNotMatch(buildWardrobeManifestLine(TEE), /outerwear role|protects against/)
  assert.doesNotMatch(buildWardrobePieceTruthText(TEE), /outerwear role|weather protection/)
})
