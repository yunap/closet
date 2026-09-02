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
//
// REWRITTEN 2026-09-02. These tests used to assert that `outerwear_role` reached every model-facing
// surface. The field is retired (docs/outerwear-role-ontology-spec.md), and legacy values are not
// merely obsolete but actively misleading — `indoor_layer` was over-applied to technical jackets.
// So the file now pins the INVERSE invariant on the same four surfaces: the role never reaches a
// model or a cache key, while weather_protection still does.

const COAT = {
  id: 1, name: 'wool coat', category: 'outerwear', outerwear_role: 'cold_weather_outerwear',
  weather_protection: ['rain', 'wind'], fabric_category: 'wool', fabric_weight: 'heavy',
}
const CARDIGAN = { id: 2, name: 'cashmere cardigan', category: 'outerwear', outerwear_role: 'indoor_layer', weather_protection: [] }
const UNTAGGED = { id: 3, name: 'unlined jacket', category: 'outerwear' }
const TEE = { id: 4, name: 'silk tee', category: 'top', outerwear_role: 'cold_weather_outerwear', weather_protection: ['rain'] }

test('weather protection is worded in exactly one place, and the retired role nowhere', () => {
  assert.deepEqual(outerwearCapabilityDisplay(COAT), { protection: 'rain/wind' })
  assert.deepEqual(outerwearCapabilityDisplay(CARDIGAN), { protection: null })
  assert.deepEqual(outerwearCapabilityDisplay(UNTAGGED), { protection: null })
  assert.ok(!('role' in outerwearCapabilityDisplay(COAT)), 'the display helper must not expose a role at all')
})

test('the retired role reaches no model-facing surface, on a piece that still stores one', () => {
  // COAT and CARDIGAN both carry legacy outerwear_role values in storage. Every projection must
  // ignore them — this is the invariant that makes the retirement real rather than nominal.
  const surfaces = {
    'manifest line': buildWardrobeManifestLine(COAT),
    'truth text': buildWardrobePieceTruthText(COAT),
    'plan workbench line': planWorkbenchPieceLine(COAT),
    'manifest line (cardigan)': buildWardrobeManifestLine(CARDIGAN),
    'truth text (cardigan)': buildWardrobePieceTruthText(CARDIGAN),
    'plan workbench line (cardigan)': planWorkbenchPieceLine(CARDIGAN),
  }
  for (const [name, text] of Object.entries(surfaces)) {
    assert.doesNotMatch(String(text), /outerwear.?role/i, `${name} still projects the retired role`)
    assert.doesNotMatch(String(text), /indoor.?layer|transition.?layer|protective.?shell|cold.?weather.?outerwear/i,
      `${name} still projects a retired role VALUE`)
  }
  const row = wardrobeTruthRow(COAT)
  assert.ok(!('outerwear_role' in row), 'the tool row still carries the retired field')
})

test('the plan workbench cache identity no longer includes the retired role', () => {
  // It participated in cache semantics, so two pieces differing only by a legacy role used to key
  // differently. Pinned because a stale cache would outlive the field itself.
  const line = planWorkbenchPieceLine(COAT)
  assert.doesNotMatch(line, /outerwear_role:/)
  assert.match(line, /weather_protection:rain\/wind/)
})

test('weather protection still reaches every surface it did before', () => {
  assert.match(buildWardrobeManifestLine(COAT), /protects against rain\/wind/)
  assert.match(buildWardrobePieceTruthText(COAT), /weather protection: rain\/wind/)
  assert.match(planWorkbenchPieceLine(COAT), /weather_protection:rain\/wind/)
  assert.deepEqual(wardrobeTruthRow(COAT).weather_protection, ['rain', 'wind'])
})

test('an untagged outerwear piece prints no capability clause rather than an empty label', () => {
  assert.doesNotMatch(buildWardrobeManifestLine(UNTAGGED), /outerwear role|protects against/)
  assert.doesNotMatch(buildWardrobePieceTruthText(UNTAGGED), /outerwear role|weather protection/)
  assert.doesNotMatch(planWorkbenchPieceLine(UNTAGGED), /outerwear_role|weather_protection/)
})

test('a stray legacy role on a non-outerwear piece never reaches the model', () => {
  assert.doesNotMatch(buildWardrobeManifestLine(TEE), /outerwear role|cold.?weather.?outerwear/i)
  assert.doesNotMatch(buildWardrobePieceTruthText(TEE), /outerwear role|cold.?weather.?outerwear/i)
})
