process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = process.env.WARDROBE_DB_PATH || `/tmp/capsule-retention-${process.pid}.db`

import test from 'node:test'
import assert from 'node:assert'
import {
  _isCapsuleIndoorKnitLayerForTests as isCapsuleIndoorKnitLayer,
  _isCapsuleColdTransitionLayerForTests as isCapsuleColdTransitionLayer,
} from '../styling-engine/outfitSetPlanner.js'

// Slice F / [A6] of docs/outerwear-weather-consolidation-spec.md.
//
// These two predicates were audited as candidates for replacement by outerwear_role and KEPT,
// because the substitution failed parity over the real wardrobe. This file pins the two divergences
// that decided it, so a later "consolidation" that swaps garmentKind for the role enum fails here
// instead of silently changing what a winter capsule can be built from.

const p = (extra) => ({ category: 'outerwear', formality: 'everyday', ...extra })

const MEDIUM_CARDIGAN = p({ id: 1, name: 'striped knit cardigan', fabric_weight: 'medium', outerwear_role: 'indoor_layer' })
const TRENCH = p({ id: 2, name: 'cream trench coat with belt', fabric_weight: 'medium', outerwear_role: 'transition_layer' })
const LEATHER_COAT = p({ id: 3, name: 'brown long leather coat', fabric_weight: 'heavy', fiber_content: ['leather'], outerwear_role: 'transition_layer' })
const FLEECE_COAT = p({ id: 4, name: 'plaid fleece coat', fabric_weight: 'heavy', fiber_content: ['polyester', 'fleece'], outerwear_role: 'transition_layer' })

test('a medium cardigan is the indoor knit layer', () => {
  assert.equal(isCapsuleIndoorKnitLayer(MEDIUM_CARDIGAN), true)
})

test('a transition_layer COAT is not an indoor knit layer, whatever its role says', () => {
  // The measured failure: a role-based substitution admitted both of these, because the tagger
  // legitimately files substantial coats as transition_layer. The rule's own prose forbids it —
  // "a coat or puffer does not satisfy the indoor-layer requirement" — so garmentKind stays.
  assert.equal(isCapsuleIndoorKnitLayer(TRENCH), false)
  assert.equal(isCapsuleIndoorKnitLayer(LEATHER_COAT), false)
})

test('a transition_layer coat still counts as a cold transition layer', () => {
  // The opposite measured failure: narrowing this to cold_weather_outerwear took the real
  // wardrobe's pool from 8 pieces to 1, leaving a winter capsule one possible cold layer.
  assert.equal(isCapsuleColdTransitionLayer(FLEECE_COAT), true)
  assert.equal(isCapsuleColdTransitionLayer(LEATHER_COAT), true)
})

test('the two winter jobs stay distinct — no piece is silently both', () => {
  assert.equal(isCapsuleColdTransitionLayer(MEDIUM_CARDIGAN), false)
  assert.equal(isCapsuleIndoorKnitLayer(FLEECE_COAT), false)
})
