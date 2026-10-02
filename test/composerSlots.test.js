// ATOMIC STRUCTURED COMPOSER OUTPUT (owner ruling 2026-09-13): the slot contract must preserve every
// construction the shared evaluator already accepts, and must neither derive nor insert anything.
import test from 'node:test'
import assert from 'node:assert/strict'
import { COMPOSER_SLOTS, composerOutfitCountCheck, composerOutfitSlotsSchema, resolveComposerSlotOutfit, withSlotFindings } from '../styling-engine/composerSlots.js'
import { evaluateWearableOutfit } from '../styling-engine/outfitValidation.js'

const P = {
  top: { id: 1, name: 'fitted knit top', category: 'top' },
  shirt: { id: 2, name: 'open overshirt', category: 'top' },
  bottom: { id: 3, name: 'straight trousers', category: 'bottom' },
  jeans: { id: 4, name: 'dark jeans', category: 'bottom' },
  dress: { id: 5, name: 'slip dress', category: 'dress' },
  cardigan: { id: 6, name: 'long cardigan', category: 'outerwear' },
  coat: { id: 7, name: 'wool coat', category: 'outerwear' },
  shoes: { id: 8, name: 'loafers', category: 'shoes' },
}
const roster = Object.values(P)
const card = ({ top = null, bottom = null, dress = null, middle = null, outer = null, shoes = null }) => ({
  label: 'card', base_top_id: top, bottom_id: bottom, dress_id: dress, middle_layer_id: middle, outer_layer_id: outer, shoes_id: shoes,
})

function evaluate(outfit, options = {}) {
  const resolved = resolveComposerSlotOutfit(outfit, roster, options)
  const byCategory = withSlotFindings(evaluateWearableOutfit(resolved.pieces, { requireShoes: true }), resolved.slotFindings)
  const byRole = withSlotFindings(evaluateWearableOutfit(resolved.pieces, { requireShoes: true, roleAware: true, includeLayerDirections: true }), resolved.slotFindings)
  return { resolved, byCategory, byRole }
}

const VALID_CONSTRUCTIONS = [
  ['top + bottom', card({ top: P.top.id, bottom: P.bottom.id, shoes: P.shoes.id }), { 1: 'primary_top', 3: 'primary_bottom', 8: 'shoes' }],
  ['dress alone', card({ dress: P.dress.id, shoes: P.shoes.id }), { 5: 'dress', 8: 'shoes' }],
  ['top intentionally under a dress', card({ top: P.top.id, dress: P.dress.id, shoes: P.shoes.id }), { 1: 'layer_top', 5: 'dress', 8: 'shoes' }],
  ['top-category middle layer over a top', card({ top: P.top.id, bottom: P.bottom.id, middle: P.shirt.id, shoes: P.shoes.id }), { 1: 'primary_top', 2: 'layer_top' }],
  ['outerwear-category middle layer over a top', card({ top: P.top.id, bottom: P.bottom.id, middle: P.cardigan.id, shoes: P.shoes.id }), { 6: 'layer_top' }],
  ['middle layer over a dress', card({ dress: P.dress.id, middle: P.cardigan.id, shoes: P.shoes.id }), { 5: 'dress', 6: 'layer_top' }],
  ['outer coat over top + bottom', card({ top: P.top.id, bottom: P.bottom.id, outer: P.coat.id, shoes: P.shoes.id }), { 7: 'outerwear' }],
  ['outer coat over a dress', card({ dress: P.dress.id, outer: P.coat.id, shoes: P.shoes.id }), { 7: 'outerwear' }],
  ['outer coat over a top under a dress', card({ top: P.top.id, dress: P.dress.id, outer: P.coat.id, shoes: P.shoes.id }), { 1: 'layer_top', 7: 'outerwear' }],
  ['middle layer plus outer coat over top + bottom', card({ top: P.top.id, bottom: P.bottom.id, middle: P.cardigan.id, outer: P.coat.id, shoes: P.shoes.id }), { 6: 'layer_top', 7: 'outerwear' }],
  ['middle layer plus outer coat over a dress', card({ dress: P.dress.id, middle: P.shirt.id, outer: P.coat.id, shoes: P.shoes.id }), { 2: 'layer_top', 7: 'outerwear' }],
]

for (const [name, outfit, expectedRoles] of VALID_CONSTRUCTIONS) {
  test(`SLOT CONTRACT preserves a valid construction: ${name}`, () => {
    const { resolved, byCategory, byRole } = evaluate(outfit)
    assert.deepEqual(resolved.slotFindings, [], 'no slot finding')
    assert.equal(byCategory.hardValid, true, `category evaluator: ${JSON.stringify(byCategory.hardFindings)}`)
    assert.equal(byRole.hardValid, true, `role-aware evaluator: ${JSON.stringify(byRole.hardFindings)}`)
    const roles = Object.fromEntries(resolved.pieces.map(piece => [piece.id, piece.role]))
    for (const [id, role] of Object.entries(expectedRoles)) assert.equal(roles[id], role, `piece ${id} states ${role}`)
  })
}

test('SLOT CONTRACT: the schema is IDs only, every slot required and nullable, nothing else admitted', () => {
  const item = composerOutfitSlotsSchema({ minOutfits: 5 }).properties.outfits.items
  assert.equal(item.additionalProperties, false)
  for (const { key } of COMPOSER_SLOTS) {
    assert.deepEqual(item.properties[key], { type: ['integer', 'null'] })
    assert.ok(item.required.includes(key), `${key} is required`)
  }
  assert.ok(!('pieces' in item.properties) && !('pieceIds' in item.properties), 'no free piece array')
  assert.ok(!Object.keys(item.properties).some(key => /name|role|gap/i.test(key)), 'no garment name, role or gap field')
})

test('SLOT CONTRACT: a missing shoe is an empty slot and a hard finding — no gap flag, nothing filled in', () => {
  const { resolved, byCategory } = evaluate(card({ top: P.top.id, bottom: P.bottom.id }))
  assert.deepEqual(resolved.pieces.map(piece => piece.id), [P.top.id, P.bottom.id])
  assert.equal(byCategory.hardValid, false)
  assert.equal(byCategory.primaryFinding.code, 'missing_shoes')
  assert.equal(byCategory.hardFindings.filter(finding => finding.code === 'missing_shoes').length, 1, 'reported once, not twice')
})

test('SLOT CONTRACT: invalid shapes that remain representable are reported, never repaired', () => {
  const cases = [
    ['dress plus bottom', card({ dress: P.dress.id, bottom: P.bottom.id, shoes: P.shoes.id }), 'dress_with_bottom'],
    ['bottom with no top or dress', card({ bottom: P.bottom.id, shoes: P.shoes.id }), 'missing_top_or_dress'],
    ['top with no bottom or dress', card({ top: P.top.id, shoes: P.shoes.id }), 'missing_bottom'],
    ['a bottom in the top slot', card({ top: P.jeans.id, bottom: P.bottom.id, shoes: P.shoes.id }), 'slot_category_mismatch'],
    ['a coat in the top slot', card({ top: P.coat.id, bottom: P.bottom.id, shoes: P.shoes.id }), 'slot_category_mismatch'],
    ['a top in the outer slot', card({ top: P.top.id, bottom: P.bottom.id, outer: P.shirt.id, shoes: P.shoes.id }), 'slot_category_mismatch'],
    ['one garment in two slots', card({ top: P.top.id, bottom: P.bottom.id, middle: P.top.id, shoes: P.shoes.id }), 'duplicate_slot_piece'],
    ['an ID outside the roster', card({ top: P.top.id, bottom: 999, shoes: P.shoes.id }), 'unknown_piece_id'],
    ['a non-ID value', card({ top: P.top.id, bottom: 'dark jeans', shoes: P.shoes.id }), 'invalid_slot_value'],
    // Currently invalid under the shared evaluator (four upper-body pieces) and still invalid here.
    ['top under a dress plus middle plus outer', card({ top: P.top.id, dress: P.dress.id, middle: P.cardigan.id, outer: P.coat.id, shoes: P.shoes.id }), 'too_many_upper_layers'],
  ]
  for (const [name, outfit, code] of cases) {
    const { byCategory } = evaluate(outfit)
    assert.equal(byCategory.hardValid, false, name)
    assert.ok(byCategory.hardFindings.some(finding => finding.code === code), `${name}: expected ${code}, got ${JSON.stringify(byCategory.hardFindings.map(finding => finding.code))}`)
  }
})

test('SLOT CONTRACT: a misplaced garment stays on the card with no role, and no role is derived for it', () => {
  const { resolved } = evaluate(card({ top: P.jeans.id, bottom: P.bottom.id, shoes: P.shoes.id }))
  assert.equal(resolved.pieces.find(piece => piece.id === P.jeans.id).role, null)
  assert.deepEqual(resolved.modelSlots, { base_top_id: P.jeans.id, bottom_id: P.bottom.id, dress_id: null, middle_layer_id: null, outer_layer_id: null, shoes_id: P.shoes.id })
})

test('SLOT CONTRACT: the selected anchor is required, reported first when absent, and never inserted', () => {
  const absent = evaluate(card({ top: P.top.id, bottom: P.bottom.id, shoes: P.shoes.id }), { requiredPieceId: P.dress.id })
  assert.equal(absent.byCategory.primaryFinding.code, 'missing_selected_anchor')
  assert.ok(!absent.resolved.pieces.some(piece => piece.id === P.dress.id))
  const present = evaluate(card({ top: P.top.id, bottom: P.bottom.id, shoes: P.shoes.id }), { requiredPieceId: P.bottom.id })
  assert.equal(present.byCategory.hardValid, true)
})

test('SLOT CONTRACT: the requested outfit count is in the schema and checked locally on every provider', () => {
  const exact = composerOutfitSlotsSchema({ minOutfits: 5 }).properties.outfits
  assert.equal(exact.minItems, 5)
  assert.equal(exact.maxItems, 5)
  const range = composerOutfitSlotsSchema({ minOutfits: 3, maxOutfits: 4 }).properties.outfits
  assert.deepEqual([range.minItems, range.maxItems], [3, 4])
  assert.deepEqual(composerOutfitCountCheck({ outfits: [{}, {}] }, { minOutfits: 5 }), { minOutfits: 5, maxOutfits: 5, returned: 2, withinRequest: false })
  assert.equal(composerOutfitCountCheck({ outfits: [{}, {}, {}] }, { minOutfits: 3, maxOutfits: 4 }).withinRequest, true)
  assert.equal(composerOutfitCountCheck({ outfits: new Array(6).fill({}) }, { minOutfits: 5 }).withinRequest, false)
  assert.equal(composerOutfitCountCheck(null, { minOutfits: 1 }).returned, 0)
})

