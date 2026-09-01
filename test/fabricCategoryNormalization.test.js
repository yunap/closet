process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = process.env.WARDROBE_DB_PATH || `/tmp/fabric-category-${process.pid}.db`

import test from 'node:test'
import assert from 'node:assert'
import { normalizeFabricCategory, applyTaggerResult } from '../styling-engine/taggerMerge.js'
import { pieceHasWetSensitiveFootwearMaterial } from '../styling-engine/attributes.js'

// fabric_category was the only tagged enum in taggerMerge with no normalizer. An out-of-list value
// was stored verbatim and failed OPEN on every material rule at once — the rules ask "is this value
// in my set?", and a value on no list never matches, silently.
//
// Found live 2026-09-01: a newly added shoe tagged `fabric_category: 'wool'` (a CLOTHING value the
// prompt forbids for footwear) passed the wet gate on a 38°F rainy walking turn.

test('a clothing value on a shoe is rejected — the live failure', () => {
  assert.equal(normalizeFabricCategory('wool', 'shoes'), null)
  assert.equal(normalizeFabricCategory('denim', 'shoes'), null)
  assert.equal(normalizeFabricCategory('cashmere', 'shoes'), null)
})

test('the same value is valid on a garment', () => {
  // The lists genuinely differ; this is not a global vocabulary.
  assert.equal(normalizeFabricCategory('wool', 'top'), 'wool')
  assert.equal(normalizeFabricCategory('wool', 'outerwear'), 'wool')
  // ...and the reverse: shoe-only values are not garment values.
  assert.equal(normalizeFabricCategory('textile', 'top'), null)
  assert.equal(normalizeFabricCategory('nubuck', 'dress'), null)
})

test('valid values pass through for each category group', () => {
  for (const v of ['leather', 'suede', 'nubuck', 'patent', 'canvas', 'mesh', 'knit', 'woven', 'synthetic', 'textile', 'rubber', 'other']) {
    assert.equal(normalizeFabricCategory(v, 'shoes'), v, v)
  }
  for (const v of ['pearl', 'enamel', 'straw', 'horn']) {
    assert.equal(normalizeFabricCategory(v, 'accessory'), v, v)
  }
  for (const v of ['jersey', 'ponte', 'boucle', 'technical/performance']) {
    assert.equal(normalizeFabricCategory(v, 'bottom'), v, v)
  }
})

test('a missing or unrecognized category falls back to the union, not to null', () => {
  // Guessing a category to validate against would be worse than accepting a value that is valid for
  // some category. This normalizer rejects values on NO list; it does not police category agreement.
  assert.equal(normalizeFabricCategory('wool', null), 'wool')
  assert.equal(normalizeFabricCategory('textile', ''), 'textile')
  assert.equal(normalizeFabricCategory('pearl', 'mystery'), 'pearl')
  assert.equal(normalizeFabricCategory('banana', null), null)
})

test('junk is rejected regardless of category', () => {
  for (const v of ['banana', 'Wool ', 42, null, undefined, '', {}]) {
    assert.equal(normalizeFabricCategory(v, 'shoes'), null, JSON.stringify(v))
  }
})

test('applyTaggerResult normalizes it, validating against the INCOMING category', () => {
  // A retag can change the category in the same patch, so the incoming value wins over the stored one.
  const existing = { id: 1, category: 'top', fabric_category: 'wool' }
  const merged = applyTaggerResult(existing, { category: 'shoes', fabric_category: 'wool' })
  assert.equal(merged.fabric_category, null, 'wool is not a shoes value once the piece becomes a shoe')

  const stays = applyTaggerResult({ id: 2, category: 'shoes' }, { fabric_category: 'mesh' })
  assert.equal(stays.fabric_category, 'mesh')
})

test('the end-to-end effect: an unknown value no longer fails open on the material gates', () => {
  // Before: `wool` on a shoe was stored and matched nothing, so the wet gate silently passed it.
  // After: it normalizes to null, which reads as unknown — still not absorbent, but now it is an
  // honest unknown rather than a value masquerading as a checked one.
  const badTag = { category: 'shoes', fabric_category: 'wool', fiber_content: [] }
  assert.equal(pieceHasWetSensitiveFootwearMaterial(badTag), false, 'unknown is not inadequacy')
  const merged = applyTaggerResult({ id: 3, category: 'shoes' }, { fabric_category: 'wool' })
  assert.equal(merged.fabric_category, null, 'and the bad value never reaches storage in the first place')
})
