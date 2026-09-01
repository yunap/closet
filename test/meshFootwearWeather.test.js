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
