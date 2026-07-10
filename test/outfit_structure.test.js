import test from 'node:test'
import assert from 'node:assert/strict'
import { isOutfitStructurallyValid, locallyGateWholeWardrobeOutfits, inferOutfitArchetype, qualifiesWholeWardrobeMission } from '../styling-engine/rules.js'

test('isOutfitStructurallyValid - basic validation cases', () => {
  // 1. Valid separates: 1 top, 1 bottom, 1 shoe
  assert.ok(isOutfitStructurallyValid([
    { category: 'top', name: 'Cotton Tee' },
    { category: 'bottom', name: 'Jeans' },
    { category: 'shoes', name: 'Sneakers' }
  ]))

  // 2. Valid dress: 1 dress, 1 shoe
  assert.ok(isOutfitStructurallyValid([
    { category: 'dress', name: 'Sun Dress' },
    { category: 'shoes', name: 'Sandals' }
  ]))

  // 3. Dress + layering top is allowed
  assert.ok(isOutfitStructurallyValid([
    { category: 'dress', name: 'Sun Dress' },
    { category: 'top', name: 'Cardigan' },
    { category: 'shoes', name: 'Sandals' }
  ]))

  // 4. Dress + bottom is invalid
  assert.ok(!isOutfitStructurallyValid([
    { category: 'dress', name: 'Sun Dress' },
    { category: 'bottom', name: 'Jeans' },
    { category: 'shoes', name: 'Sandals' }
  ]))

  // 5. Two bottoms is invalid
  assert.ok(!isOutfitStructurallyValid([
    { category: 'top', name: 'Cotton Tee' },
    { category: 'bottom', name: 'Jeans' },
    { category: 'bottom', name: 'Shorts' },
    { category: 'shoes', name: 'Sneakers' }
  ]))

  // 6. Two pairs of shoes is invalid
  assert.ok(!isOutfitStructurallyValid([
    { category: 'top', name: 'Cotton Tee' },
    { category: 'bottom', name: 'Jeans' },
    { category: 'shoes', name: 'Sneakers' },
    { category: 'shoes', name: 'Loafers' }
  ]))

  // 7. No top is invalid for separates
  assert.ok(!isOutfitStructurallyValid([
    { category: 'bottom', name: 'Jeans' },
    { category: 'shoes', name: 'Sneakers' }
  ]))

  // 8. No shoes is invalid when requireShoes is true (default)
  assert.ok(!isOutfitStructurallyValid([
    { category: 'top', name: 'Cotton Tee' },
    { category: 'bottom', name: 'Jeans' }
  ]))

  // 9. No shoes is valid when requireShoes is false
  assert.ok(isOutfitStructurallyValid([
    { category: 'top', name: 'Cotton Tee' },
    { category: 'bottom', name: 'Jeans' }
  ], { requireShoes: false }))
})

test('locallyGateWholeWardrobeOutfits - filters invalid outfits', () => {
  // formality tagged on every piece so this test exercises only what it's named for (structural
  // validity), not spec 8's register-ceiling 'unknown' gate incidentally catching untagged fixtures.
  const candidatePieces = [
    { id: 1, name: 'Cotton Dress', category: 'dress', formality: 'everyday' },
    { id: 2, name: 'Leather Boots', category: 'shoes', formality: 'everyday' },
    { id: 3, name: 'Jeans', category: 'bottom', formality: 'everyday' },
    { id: 4, name: 'Sneakers', category: 'shoes', formality: 'everyday' },
    { id: 5, name: 'Loafers', category: 'shoes', formality: 'everyday' }
  ]

  const outfits = [
    // Valid dress outfit
    {
      label: 'Valid Dress Outfit',
      pieceIds: [1, 2],
      pieces: [
        { id: 1, name: 'Cotton Dress', category: 'dress', formality: 'everyday' },
        { id: 2, name: 'Leather Boots', category: 'shoes', formality: 'everyday' }
      ]
    },
    // Invalid: no top, two shoes (the bug reported by user)
    {
      label: 'Buggy Outfit',
      pieceIds: [3, 4, 5],
      pieces: [
        { id: 3, name: 'Jeans', category: 'bottom', formality: 'everyday' },
        { id: 4, name: 'Sneakers', category: 'shoes', formality: 'everyday' },
        { id: 5, name: 'Loafers', category: 'shoes', formality: 'everyday' }
      ]
    }
  ]

  const result = locallyGateWholeWardrobeOutfits(outfits, 5, {
    candidatePieces,
    requireShoes: true
  })

  assert.equal(result.outfits.length, 1)
  assert.equal(result.outfits[0].label, 'Grounded Dress Edit: standard wear')
  assert.ok(result.rejected.some(r => r.reason === 'not a complete wardrobe outfit'))
})

test('locallyGateWholeWardrobeOutfits advisor mode keeps but flags walking footwear caught by structured enums (spec 8)', () => {
  // Spec 8 (2026-07-09): this final profileRuleFit check previously had no activityProfile/
  // registerCeiling awareness at all — the walking-unsuitable shoe passed through completely
  // unflagged. Now it's caught, and — because this is advisor mode — kept with a caution flag
  // rather than dropped, same treatment as the function's other soft/subjective checks.
  const outfit = {
    label: 'Model Returned Walking Look',
    pieceIds: [1, 2, 3],
    pieces: [
      { id: 1, name: 'Cotton Tee', category: 'top' },
      { id: 2, name: 'Jeans', category: 'bottom' },
      { id: 3, name: 'Low-support sandals', category: 'shoes', heel_height: 'flat', walk_support: 'low' }
    ],
    reason: 'The model returned this complete outfit.'
  }
  const candidatePieces = outfit.pieces

  const result = locallyGateWholeWardrobeOutfits([outfit], 5, {
    mode: 'advisor',
    candidatePieces,
    occasion: 'travel',
    activity: 'walking',
    applyDiversity: false
  })

  assert.equal(result.outfits.length, 1)
  assert.deepEqual(result.outfits[0].pieceIds, outfit.pieceIds)
  assert.deepEqual(result.outfits[0].pieces, outfit.pieces)
  assert.equal(result.outfits[0].label, outfit.label)
  assert.ok(result.outfits[0].systemFlags?.some(f => f.type === 'occasion' && /support unsuitable/.test(f.message)))
  assert.deepEqual(result.rejected, [])
})

test('locallyGateWholeWardrobeOutfits non-advisor (gate) mode rejects the same walking-unsuitable footwear outright (spec 8)', () => {
  const outfit = {
    label: 'Model Returned Walking Look',
    pieceIds: [1, 2, 3],
    pieces: [
      { id: 1, name: 'Cotton Tee', category: 'top' },
      { id: 2, name: 'Jeans', category: 'bottom' },
      { id: 3, name: 'Low-support sandals', category: 'shoes', heel_height: 'flat', walk_support: 'low' }
    ],
    reason: 'The model returned this complete outfit.'
  }
  const candidatePieces = outfit.pieces

  const result = locallyGateWholeWardrobeOutfits([outfit], 5, {
    candidatePieces,
    occasion: 'travel',
    activity: 'walking',
    applyDiversity: false
  })

  assert.equal(result.outfits.length, 0)
  assert.ok(result.rejected.some(r => /support unsuitable/.test(r.reason)))
})

test('inferOutfitArchetype restricts dress archetypes to outfits containing a dress', () => {
  const candidatePieces = [
    { id: 1, name: 'Cotton Dress', category: 'dress' },
    { id: 2, name: 'Leather Boots', category: 'shoes' },
    { id: 3, name: 'Cotton Blouse', category: 'top' },
    { id: 4, name: 'Sage Pants', category: 'bottom' }
  ]

  // Separates outfit (no dress) -> must not match dress_grounded_sharp
  const separatesOutfit = { pieceIds: [3, 4, 2] }
  const arch1 = inferOutfitArchetype(separatesOutfit, candidatePieces)
  assert.notEqual(arch1.archetypeId, 'dress_grounded_sharp', 'Separates outfits must not match dress archetype')

  // Dress outfit (has dress) -> must match dress_grounded_sharp
  const dressOutfit = { pieceIds: [1, 2] }
  const arch2 = inferOutfitArchetype(dressOutfit, candidatePieces)
  assert.equal(arch2.archetypeId, 'dress_grounded_sharp', 'Dress outfits must match dress archetype')
})

test('inferOutfitArchetype abstains when no archetype earns a grounded role match', () => {
  const candidatePieces = [
    { id: 1, name: 'Plain Scarf', category: 'accessory', colors: ['white'], reads_as: 'plain cloth scarf' },
    { id: 2, name: 'Plain Belt', category: 'accessory', colors: ['beige'], reads_as: 'plain belt' },
    { id: 3, name: 'Plain Socks', category: 'accessory', colors: ['white'], reads_as: 'plain socks' }
  ]

  const arch = inferOutfitArchetype({ pieceIds: [1, 2, 3] }, candidatePieces)
  assert.equal(arch.archetypeId, null)
  assert.equal(arch.direction, '')
  assert.equal(arch.silhouette, '')
})

test('whole wardrobe mission qualification abstains from unearned labels', () => {
  const blackBeigeBrown = [
    { id: 1, category: 'top', colors: ['black'], reads_as: 'plain black cotton top', fabric_category: 'cotton', pattern_type: 'solid' },
    { id: 2, category: 'bottom', colors: ['beige'], reads_as: 'plain beige cotton pants', fabric_category: 'cotton', pattern_type: 'solid' },
    { id: 3, category: 'shoes', colors: ['brown'], reads_as: 'brown leather shoes', fabric_category: 'leather', pattern_type: 'solid' }
  ]
  assert.equal(qualifiesWholeWardrobeMission(blackBeigeBrown, 'monochrome_texture'), false)
  assert.equal(qualifiesWholeWardrobeMission(blackBeigeBrown, 'unexpected_pairing'), false)

  const tonalTexture = [
    { id: 4, category: 'top', colors: ['cream'], reads_as: 'cream ribbed knit shell', fabric_category: 'knit', pattern_type: 'solid' },
    { id: 5, category: 'bottom', colors: ['oatmeal'], reads_as: 'oatmeal linen trousers', fabric_category: 'linen', pattern_type: 'solid' },
    { id: 6, category: 'shoes', colors: ['tan'], reads_as: 'tan suede flats', fabric_category: 'suede', pattern_type: 'solid' }
  ]
  assert.equal(qualifiesWholeWardrobeMission(tonalTexture, 'monochrome_texture'), true)

  const controlledPrint = [
    { id: 7, category: 'top', colors: ['blue'], reads_as: 'blue botanical print blouse', fabric_category: 'cotton', pattern_type: 'botanical' },
    { id: 8, category: 'bottom', colors: ['black'], reads_as: 'black structured trousers', fabric_category: 'twill', pattern_type: 'solid' },
    { id: 9, category: 'shoes', colors: ['black'], reads_as: 'black leather loafers', fabric_category: 'leather', pattern_type: 'solid' }
  ]
  assert.equal(qualifiesWholeWardrobeMission(controlledPrint, 'controlled_print'), true)
})
