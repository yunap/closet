import test from 'node:test'
import assert from 'node:assert/strict'
import { isOutfitStructurallyValid, locallyGateWholeWardrobeOutfits } from '../styling-engine/rules.js'

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
  const candidatePieces = [
    { id: 1, name: 'Cotton Dress', category: 'dress' },
    { id: 2, name: 'Leather Boots', category: 'shoes' },
    { id: 3, name: 'Jeans', category: 'bottom' },
    { id: 4, name: 'Sneakers', category: 'shoes' },
    { id: 5, name: 'Loafers', category: 'shoes' }
  ]

  const outfits = [
    // Valid dress outfit
    {
      label: 'Valid Dress Outfit',
      pieceIds: [1, 2],
      pieces: [
        { id: 1, name: 'Cotton Dress', category: 'dress' },
        { id: 2, name: 'Leather Boots', category: 'shoes' }
      ]
    },
    // Invalid: no top, two shoes (the bug reported by user)
    {
      label: 'Buggy Outfit',
      pieceIds: [3, 4, 5],
      pieces: [
        { id: 3, name: 'Jeans', category: 'bottom' },
        { id: 4, name: 'Sneakers', category: 'shoes' },
        { id: 5, name: 'Loafers', category: 'shoes' }
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
