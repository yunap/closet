process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = process.env.WARDROBE_DB_PATH || `/tmp/mesh-footwear-${process.pid}.db`

import test from 'node:test'
import assert from 'node:assert'
import {
  pieceHasInsulatingMaterial,
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

test('the upper material is read from fabric_category ONLY, not fiber_content', () => {
  // Reversed 2026-09-01. This originally asserted fiber_content was also consulted — written before
  // fiber_content began carrying footwear LININGS, which made that a trap: a shearling-lined leather
  // boot would read as absorbent because of an interior the weather never touches. `mesh` was never
  // a valid fiber_content value anyway, so the case this pinned could not occur in real data.
  // The fixture is `fabric_category: 'textile'` with `fiber_content: ['mesh']`. Ventilation is
  // decided by the upper alone, so the stray fiber value is ignored — while the textile UPPER still
  // makes it absorbent. One fixture, both halves of the rule.
  assert.equal(pieceHasVentilatedFootwearMaterial(MESH_BY_FIBER), false)
  assert.equal(pieceHasWetSensitiveFootwearMaterial(MESH_BY_FIBER), true)
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

// --- footwear lining (2026-09-01) ---------------------------------------------------------------

test('a lined boot is excluded in hot weather once its lining is recorded', () => {
  // No code change enabled this: hotWeatherInsulationReason reads pieceHasInsulatingMaterial BEFORE
  // the shoe/accessory exemption, so the path has always been correct and simply never had data.
  // The tagger now records footwear linings in fiber_content, which is the only field available —
  // fabric_weight is null for shoes and fabric_category describes the upper.
  const hot = { isHot: true }
  const lined = { id: 1, category: 'shoes', name: 'shearling-lined boot', shoe_type: 'boot', fabric_category: 'leather', fiber_content: ['leather', 'wool'] }
  const plain = { id: 2, category: 'shoes', name: 'leather ankle boot', shoe_type: 'boot', fabric_category: 'leather', fiber_content: ['leather'] }
  assert.deepEqual(reasons(lined, hot), ['hot weather: insulating fiber'])
  assert.deepEqual(reasons(plain, hot), [], 'an unlined boot is not hot-excluded for being a boot')
})

test('a recorded lining does not make a shoe cold- or wet-inappropriate', () => {
  // Insulation is a separate axis from permeability. A shearling-lined leather boot is exactly what
  // severe cold and rain want, and must not be caught by the absorbent or ventilated rules.
  const lined = { id: 1, category: 'shoes', shoe_type: 'boot', fabric_category: 'leather', fiber_content: ['leather', 'wool'] }
  assert.deepEqual(reasons(lined, { isCold: true, isColdSevere: true }), [])
  assert.deepEqual(reasons(lined, { isWetExposure: true }), [])
})

// --- upper vs lining (2026-09-01) ---------------------------------------------------------------

test('a lining never makes a boot absorbent or ventilated — those readers see the UPPER only', () => {
  // fiber_content now carries footwear linings as well as upper material, so a reader that consults
  // it would call a shearling-lined leather boot "absorbent" because of an interior the weather
  // never touches — excluding the single best rain boot most wardrobes own. Latent when written
  // (no absorbent FIBER is in the list), removed before the next widening arms it.
  const linedLeather = { category: 'shoes', fabric_category: 'leather', fiber_content: ['leather', 'wool'] }
  const linedFleece = { category: 'shoes', fabric_category: 'leather', fiber_content: ['leather', 'fleece'] }
  for (const boot of [linedLeather, linedFleece]) {
    assert.equal(pieceHasWetSensitiveFootwearMaterial(boot), false, 'lining must not imply an absorbent upper')
    assert.equal(pieceHasVentilatedFootwearMaterial(boot), false, 'lining must not imply a ventilated upper')
  }
})

test('the insulating reader DOES read fiber_content — that is where linings live', () => {
  const lined = { category: 'shoes', fabric_category: 'leather', fiber_content: ['leather', 'wool'] }
  assert.equal(pieceHasInsulatingMaterial(lined), true)
  const unlined = { category: 'shoes', fabric_category: 'leather', fiber_content: ['leather'] }
  assert.equal(pieceHasInsulatingMaterial(unlined), false)
})

test('a wool-upper sneaker is absorbent via its construction tag, not its fiber', () => {
  // fabric_category for shoes is a CONSTRUCTION class, not a fiber — there is no `wool` value. A
  // wool-upper sneaker is `textile` or `knit`, with the fiber recorded in fiber_content. Both routes
  // to the correct verdict go through the construction tag.
  assert.equal(pieceHasWetSensitiveFootwearMaterial({ category: 'shoes', fabric_category: 'textile', fiber_content: ['wool'] }), true)
  assert.equal(pieceHasWetSensitiveFootwearMaterial({ category: 'shoes', fabric_category: 'knit', fiber_content: ['wool'] }), true)
})

test('open-toe footwear is excluded across the cool band, not just at isCold', () => {
  // Live: open-toe chunky-heel sandals on a 65F/48F October evening. The rule fired only at
  // isCold (<=45F), leaving the 46-55F band with no footwear rule at all.
  const sandal = { id: 40, category: 'shoes', name: 'strap sandals', shoe_type: 'sandal', toe_shape: 'open_toe', fabric_category: 'leather' }
  for (const wp of [{ needsRemovableCoolLayer: true }, { transitNeedsRemovableCoolLayer: true }, { isCold: true }]) {
    assert.deepEqual(reasons(sandal, wp), ['cold weather: open-toe/warm-weather footwear'], JSON.stringify(wp))
  }
  assert.deepEqual(reasons(sandal, { isHot: true }), [], 'and untouched on a warm day')
})

test('the cool band does NOT extend the mesh rule — bare toes and mesh are different problems', () => {
  // Mesh at 50F is fine; bare toes at 50F are not. The ventilated rule stays on severity.
  const mesh = { id: 41, category: 'shoes', name: 'mesh trainers', shoe_type: 'sneaker', toe_shape: 'almond', fabric_category: 'mesh' }
  assert.deepEqual(reasons(mesh, { needsRemovableCoolLayer: true }), [])
  assert.deepEqual(reasons(mesh, { isCold: true, isColdSevere: true }), ['severe cold: ventilated/mesh footwear'])
})
