process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = process.env.WARDROBE_DB_PATH || `/tmp/mesh-footwear-${process.pid}.db`

import test from 'node:test'
import assert from 'node:assert'
import {
  pieceHasVentilatedFootwearMaterial,
  pieceHasWetSensitiveFootwearMaterial,
} from '../styling-engine/attributes.js'
import { wholeWardrobePieceTrustDecision } from '../styling-engine/rules.js'

// Owner ruling 2026-09-01. outerwear-weather-capability-spec.md §8 deferred the mesh question
// pending "a separate evidence/ruling"; two live freeform turns supplied it — 42°F raining and
// 38°F "walking around the city all afternoon" both put mesh athletic sneakers on. fabric_category
// is in the wardrobe manifest, so the model saw 'mesh' both times and chose it anyway.

const shoe = (extra) => ({ id: 1, category: 'shoes', name: 'test shoe', shoe_type: 'sneaker', toe_shape: 'almond', ...extra })
const MESH = shoe({ name: 'grey orange mesh athletic sneakers', fabric_category: 'mesh', fiber_content: ['polyester', 'nylon'] })
const MESH_BY_FIBER = shoe({ name: 'knit runners', fabric_category: 'textile', fiber_content: ['mesh'] })
const LEATHER_BOOT = shoe({ name: 'leather ankle boots', shoe_type: 'boot', fabric_category: 'leather', fiber_content: ['leather'] })
const CANVAS = shoe({ name: 'canvas sneakers', fabric_category: 'canvas', fiber_content: ['cotton'] })
const SANDAL = shoe({ name: 'flat sandals', shoe_type: 'sandal', toe_shape: 'open_toe', fabric_category: 'leather' })
const MESH_TOP = { id: 9, category: 'top', name: 'mesh overlay top', fabric_category: 'mesh' }

const reasons = (piece, weatherProfile) => wholeWardrobePieceTrustDecision(piece, { weatherProfile }).reasons

// --- readers ------------------------------------------------------------------------------------

test('the absorbent class is every permeable fibre upper, not a mesh special case', () => {
  // Widened 2026-09-01 after a second incident: a "38°F and raining, walking for hours" turn picked
  // `taupe knit lace-up sneakers` — a visibly flyknit trainer tagged `woven` — right after the
  // mesh-only rule shipped. The rule had caught the instance, not the class. This is a claim about
  // garment physics, so it is asserted per material rather than per wardrobe.
  const shoe = (fabric_category) => ({ category: 'shoes', fabric_category, fiber_content: [] })
  for (const material of ['canvas', 'suede', 'nubuck', 'mesh', 'knit', 'woven', 'textile']) {
    assert.equal(pieceHasWetSensitiveFootwearMaterial(shoe(material)), true, material)
  }
  // Not permeable, or genuinely ambiguous. `synthetic` covers both a coated waterproof upper and a
  // soft textile one, so treating it as absorbent would reject shoes that are fine in rain; `other`
  // and unset are unknown, and unknown is not inadequacy.
  for (const material of ['leather', 'patent', 'rubber', 'synthetic', 'other', '']) {
    assert.equal(pieceHasWetSensitiveFootwearMaterial(shoe(material)), false, material || '(unset)')
  }
})

test('the ventilated class is narrower — soaking and venting are different properties', () => {
  const shoe = (fabric_category) => ({ category: 'shoes', fabric_category, fiber_content: [] })
  for (const material of ['mesh', 'knit']) {
    assert.equal(pieceHasVentilatedFootwearMaterial(shoe(material)), true, material)
  }
  // Canvas and suede soak but do not vent, so they are absorbent without being cold-inappropriate.
  for (const material of ['canvas', 'suede', 'woven', 'textile', 'leather']) {
    assert.equal(pieceHasVentilatedFootwearMaterial(shoe(material)), false, material)
  }
})

test('mesh is both wet-sensitive and ventilated; canvas and suede are only wet-sensitive', () => {
  assert.equal(pieceHasWetSensitiveFootwearMaterial(MESH), true)
  assert.equal(pieceHasVentilatedFootwearMaterial(MESH), true)
  // Canvas soaks but does not vent — the two lists are deliberately different sizes, because they
  // answer different physical questions.
  assert.equal(pieceHasWetSensitiveFootwearMaterial(CANVAS), true)
  assert.equal(pieceHasVentilatedFootwearMaterial(CANVAS), false)
  assert.equal(pieceHasWetSensitiveFootwearMaterial(LEATHER_BOOT), false)
  assert.equal(pieceHasVentilatedFootwearMaterial(LEATHER_BOOT), false)
})

test('both readers are category-gated — a mesh TOP is not footwear', () => {
  assert.equal(pieceHasWetSensitiveFootwearMaterial(MESH_TOP), false)
  assert.equal(pieceHasVentilatedFootwearMaterial(MESH_TOP), false)
})

test('mesh is read from fiber_content as well as fabric_category', () => {
  assert.equal(pieceHasVentilatedFootwearMaterial(MESH_BY_FIBER), true)
})

// --- the cold rule is gated on SEVERITY, not on any cold ------------------------------------------

test('mesh footwear survives MILD cold', () => {
  // The whole point of the severity split: mesh sneakers on a chilly 55°F day are a fine answer,
  // and widening the existing open-toe rule would have pulled four walkable shoes out of every
  // cool turn.
  assert.deepEqual(reasons(MESH, { isCold: true }), [])
})

test('mesh footwear is excluded in SEVERE cold', () => {
  assert.deepEqual(reasons(MESH, { isCold: true, isColdSevere: true }), ['severe cold: ventilated/mesh footwear'])
})

test('mesh footwear is excluded for severe cold TRANSIT to an indoor destination', () => {
  // An indoor base may stay light, but the shoes still make the walk there.
  assert.deepEqual(reasons(MESH, { transitIsCold: true, transitIsColdSevere: true }), ['severe cold: ventilated/mesh footwear'])
})

test('non-ventilated footwear is untouched in severe cold', () => {
  assert.deepEqual(reasons(LEATHER_BOOT, { isCold: true, isColdSevere: true }), [])
  assert.deepEqual(reasons(CANVAS, { isCold: true, isColdSevere: true }), [])
})

// --- the wet rule -------------------------------------------------------------------------------

test('mesh footwear is excluded on wet exposure', () => {
  assert.deepEqual(reasons(MESH, { isWetExposure: true }), ['wet exposure: absorbent footwear material'])
})

test('a cold rainy day excludes mesh on both grounds', () => {
  assert.deepEqual(reasons(MESH, { isCold: true, isColdSevere: true, isWetExposure: true }).sort(), [
    'severe cold: ventilated/mesh footwear',
    'wet exposure: absorbent footwear material',
  ].sort())
})

// --- the pre-existing open-toe rule is unchanged --------------------------------------------------

test('the open-toe rule still fires on ANY cold, mild included', () => {
  // Unlike mesh, an open-toe sandal is unsafe at any cold — that asymmetry is deliberate and this
  // ruling must not quietly narrow it to severe.
  assert.deepEqual(reasons(SANDAL, { isCold: true }), ['cold weather: open-toe/warm-weather footwear'])
})
