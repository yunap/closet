import test from 'node:test'
import assert from 'node:assert/strict'
import { buildVisualComposerRoster } from '../styling-engine/rules.js'

test('Visual Composer Roster - Hot weather filter ladder', () => {
  const pieces = [
    // Heavy outerwear
    { id: 1, name: 'Heavy Coat', category: 'outerwear', photo: 'img.jpg', fabric_weight: 'heavy' },
    // Light outerwear
    { id: 2, name: 'Light Jacket', category: 'outerwear', photo: 'img.jpg', fabric_weight: 'light' },
    // Medium outerwear 1
    { id: 3, name: 'Medium Jacket 1', category: 'outerwear', photo: 'img.jpg', fabric_weight: 'medium' },
    // Medium outerwear 2
    { id: 4, name: 'Medium Jacket 2', category: 'outerwear', photo: 'img.jpg', fabric_weight: 'medium' },
    // Medium outerwear 3
    { id: 5, name: 'Medium Jacket 3', category: 'outerwear', photo: 'img.jpg', fabric_weight: 'medium' },
    // Shorts
    { id: 6, name: 'Linen Shorts', category: 'bottom', photo: 'img.jpg', fabric_weight: 'light', style_profile_json: { bottom_kind: 'shorts' } },
    // Heavy top
    { id: 7, name: 'Heavy Top', category: 'top', photo: 'img.jpg', fabric_weight: 'heavy' },
    // Normal top
    { id: 8, name: 'Cotton Tee', category: 'top', photo: 'img.jpg', fabric_weight: 'light' }
  ]

  const { roster, excluded } = buildVisualComposerRoster(pieces, {
    occasion: 'casual',
    weatherProfile: { isHot: true },
    maxImages: 90
  })

  const rosterIds = roster.map(p => p.id)

  // 1. Assert heavy outerwear (ID 1) is excluded
  assert.ok(!rosterIds.includes(1), 'Heavy Coat (ID 1) must be excluded')
  // 2. Assert heavy top (ID 7) is excluded
  assert.ok(!rosterIds.includes(7), 'Heavy Top (ID 7) must be excluded')
  // 3. Shorts (ID 6) must be present (never excluded on hot side)
  assert.ok(rosterIds.includes(6), 'Linen Shorts (ID 6) must remain')

  // 4. Assert outerwear cap of 3 lightest (light jacket, medium jacket 1, medium jacket 2 - stably sorted by ID)
  // ID 5 (Medium Jacket 3) should be excluded due to the outerwear cap
  assert.ok(rosterIds.includes(2), 'Light Jacket (ID 2) must remain')
  assert.ok(rosterIds.includes(3), 'Medium Jacket 1 (ID 3) must remain')
  assert.ok(rosterIds.includes(4), 'Medium Jacket 2 (ID 4) must remain')
  assert.ok(!rosterIds.includes(5), 'Medium Jacket 3 (ID 5) must be capped')

  // Verify reasons
  const exp1 = excluded.find(e => e.pieceId === 1)
  assert.equal(exp1.reason, 'hot weather: insulating piece')
  const exp7 = excluded.find(e => e.pieceId === 7)
  assert.equal(exp7.reason, 'hot weather: insulating piece')
  const exp5 = excluded.find(e => e.pieceId === 5)
  assert.equal(exp5.reason, 'hot weather: outerwear cap')
})

test('Visual Composer Roster - Cold weather filter ladder', () => {
  const pieces = [
    // Shorts
    { id: 1, name: 'Linen Shorts', category: 'bottom', photo: 'img.jpg', fabric_weight: 'light', style_profile_json: { bottom_kind: 'shorts' } },
    // Heavy coat
    { id: 2, name: 'Heavy Coat', category: 'outerwear', photo: 'img.jpg', fabric_weight: 'heavy' },
    // Pants
    { id: 3, name: 'Jeans', category: 'bottom', photo: 'img.jpg', fabric_weight: 'medium', style_profile_json: { bottom_kind: 'pants', coverage: 'full-insulating' } }
  ]

  const { roster, excluded } = buildVisualComposerRoster(pieces, {
    occasion: 'casual',
    weatherProfile: { isCold: true },
    maxImages: 90
  })

  const rosterIds = roster.map(p => p.id)

  // 1. Assert shorts (ID 1) is excluded
  assert.ok(!rosterIds.includes(1), 'Shorts (ID 1) must be excluded in cold weather')
  // 2. Heavy coat (ID 2) must remain
  assert.ok(rosterIds.includes(2), 'Heavy Coat (ID 2) must remain in cold weather')
  // 3. Pants (ID 3) must remain
  assert.ok(rosterIds.includes(3), 'Pants (ID 3) must remain')

  const exp1 = excluded.find(e => e.pieceId === 1)
  assert.equal(exp1.reason, 'cold weather: shorts')
})

test('Visual Composer Roster - No weather no-op check', () => {
  const pieces = [
    { id: 1, name: 'Heavy Coat', category: 'outerwear', photo: 'img.jpg', fabric_weight: 'heavy' },
    { id: 2, name: 'Linen Shorts', category: 'bottom', photo: 'img.jpg', style_profile_json: { bottom_kind: 'shorts' } },
    { id: 3, name: 'Gold Ring', category: 'accessory', photo: 'img.jpg' },
    { id: 4, name: 'No Photo Piece', category: 'top', photo: null, worn_photo: null }
  ]

  const { roster, excluded } = buildVisualComposerRoster(pieces, {
    occasion: 'casual',
    weatherProfile: {}, // no weather detected
    maxImages: 90
  })

  const rosterIds = roster.map(p => p.id)

  // Accessory (ID 3) and No Photo (ID 4) should be excluded
  assert.ok(!rosterIds.includes(3), 'Accessory must be excluded')
  assert.ok(!rosterIds.includes(4), 'No photo piece must be excluded')

  // Heavy coat and shorts must remain (no weather filtering no-op)
  assert.ok(rosterIds.includes(1), 'Heavy coat remains')
  assert.ok(rosterIds.includes(2), 'Shorts remain')

  assert.equal(excluded.find(e => e.pieceId === 3).reason, 'accessories excluded from visual composer')
  assert.equal(excluded.find(e => e.pieceId === 4).reason, 'no photo')
})

test('Visual Composer Roster - Accessories override check', () => {
  const pieces = [
    { id: 1, name: 'Gold Ring', category: 'accessory', photo: 'img.jpg' },
    { id: 2, name: 'Cotton Tee', category: 'top', photo: 'img.jpg' }
  ]

  // With default (includeAccessories: false)
  const res1 = buildVisualComposerRoster(pieces, {
    occasion: 'casual',
    includeAccessories: false
  })
  assert.ok(!res1.roster.some(p => p.id === 1), 'Accessory must be excluded by default')

  // With includeAccessories: true
  const res2 = buildVisualComposerRoster(pieces, {
    occasion: 'casual',
    includeAccessories: true
  })
  assert.ok(res2.roster.some(p => p.id === 1), 'Accessory must be included when includeAccessories: true')
})

test('Visual Composer Roster - Category and global budget ceilings', () => {
  // Construct a synthetic 181-piece wardrobe:
  // 100 tops, 50 bottoms, 31 shoes
  const pieces = []
  for (let i = 1; i <= 100; i++) {
    pieces.push({ id: i, name: `Top ${i}`, category: 'top', photo: 'img.jpg' })
  }
  for (let i = 101; i <= 150; i++) {
    pieces.push({ id: i, name: `Bottom ${i - 100}`, category: 'bottom', photo: 'img.jpg' })
  }
  for (let i = 151; i <= 181; i++) {
    pieces.push({ id: i, name: `Shoes ${i - 150}`, category: 'shoes', photo: 'img.jpg' })
  }

  // We set maxImages = 90
  const { roster, excluded, debug } = buildVisualComposerRoster(pieces, {
    occasion: 'casual',
    maxImages: 90
  })

  // Assert roster count <= 90
  assert.ok(roster.length <= 90, `Roster count (${roster.length}) must be <= 90`)

  // Under maxImages = 90 (scaled down ceilings from sum 93):
  // Tops ceiling: Math.floor(30 * (90/93)) = 29
  // Bottoms ceiling: Math.floor(25 * (90/93)) = 24
  // Shoes ceiling: Math.floor(15 * (90/93)) = 14
  // Sum of scaled ceilings = 29 + 24 + 14 = 67
  const tops = roster.filter(p => p.category === 'top')
  const bottoms = roster.filter(p => p.category === 'bottom')
  const shoes = roster.filter(p => p.category === 'shoes')

  assert.equal(tops.length, 29, `Should have exactly 29 tops, got ${tops.length}`)
  assert.equal(bottoms.length, 24, `Should have exactly 24 bottoms, got ${bottoms.length}`)
  assert.equal(shoes.length, 14, `Should have exactly 14 shoes, got ${shoes.length}`)

  // Total count = 29 + 24 + 14 = 67
  assert.equal(roster.length, 67)
  
  // Verify that debug categoryCounts matches
  assert.equal(debug.categoryCounts.top, 29)
  assert.equal(debug.categoryCounts.bottom, 24)
  assert.equal(debug.categoryCounts.shoes, 14)
})

test('Visual Composer Roster - debug reports exact cap cuts and slot coverage', () => {
  const pieces = []
  let id = 1
  for (let i = 1; i <= 35; i++, id++) {
    pieces.push({ id, name: `Top ${i}`, category: 'top', photo: 'img.jpg', fabric_weight: i <= 30 ? 'light' : 'heavy' })
  }
  for (let i = 1; i <= 25; i++, id++) {
    pieces.push({ id, name: `Bottom ${i}`, category: 'bottom', photo: 'img.jpg', fabric_weight: 'light' })
  }
  for (let i = 1; i <= 15; i++, id++) {
    pieces.push({ id, name: `Shoes ${i}`, category: 'shoes', photo: 'img.jpg' })
  }
  for (let i = 1; i <= 10; i++, id++) {
    pieces.push({ id, name: `Dress ${i}`, category: 'dress', photo: 'img.jpg', fabric_weight: 'light' })
  }
  for (let i = 1; i <= 8; i++, id++) {
    pieces.push({ id, name: `Outerwear ${i}`, category: 'outerwear', photo: 'img.jpg', fabric_weight: 'light' })
  }
  for (let i = 1; i <= 5; i++, id++) {
    pieces.push({ id, name: `Accessory ${i}`, category: 'accessory', photo: 'img.jpg' })
  }

  const { roster, debug } = buildVisualComposerRoster(pieces, {
    occasion: 'casual',
    maxImages: 93,
    includeAccessories: true
  })

  assert.equal(debug.postGatePoolSize, 98)
  assert.equal(debug.capApplied, true)
  assert.equal(debug.capCutPieces.length, 5)
  assert.equal(roster.length, 93)
  assert.deepEqual(debug.slotCoverage, {
    top: 30,
    bottom: 25,
    dress: 10,
    shoes: 15,
    outerwear: 8,
    accessory: 5
  })
  for (const piece of debug.capCutPieces) {
    assert.equal(typeof piece.id, 'number')
    assert.equal(typeof piece.name, 'string')
    assert.equal(typeof piece.score, 'number')
    assert.ok(Array.isArray(piece.topReasons))
    assert.ok(piece.topReasons.length > 0)
  }
})

test('Visual Composer Roster - Determinism and stable tie-breaking', () => {
  const pieces = [
    { id: 4, name: 'Top 4', category: 'top', photo: 'img.jpg' },
    { id: 2, name: 'Top 2', category: 'top', photo: 'img.jpg' },
    { id: 3, name: 'Top 3', category: 'top', photo: 'img.jpg' },
    { id: 1, name: 'Top 1', category: 'top', photo: 'img.jpg' }
  ]
  // Add 10 bottoms to exceed maxImages = 10 and trigger category limits
  for (let i = 11; i <= 20; i++) {
    pieces.push({ id: i, name: `Bottom ${i}`, category: 'bottom', photo: 'img.jpg' })
  }

  const { roster, excluded } = buildVisualComposerRoster(pieces, {
    occasion: 'casual',
    maxImages: 10 // tops ceiling will be Math.floor(30 * 10 / 93) = 3
  })

  const rosterTops = roster.filter(p => p.category === 'top')
  const rosterTopsIds = rosterTops.map(p => p.id)

  assert.equal(rosterTops.length, 3, `Should have exactly 3 tops kept, got ${rosterTops.length}`)
  assert.deepEqual(rosterTopsIds.sort(), [1, 2, 3])
  assert.ok(!rosterTopsIds.includes(4))
  
  const exp4 = excluded.find(e => e.pieceId === 4)
  assert.ok(exp4, 'Top 4 must be excluded')
  assert.equal(exp4.reason, 'roster cap: category limit')
})

test('Visual Composer Roster - Selected pieces bypass limits and filters', () => {
  const pieces = [
    // Top without photo (normally excluded in Step 1) but marked as selected
    { id: 1, name: 'Selected No Photo Top', category: 'top', photo: null, selected: true },
    // Accessory (normally excluded in Step 2) but marked as selected
    { id: 2, name: 'Selected Accessory', category: 'accessory', photo: 'img.jpg', isAnchor: true },
    // Heavy outerwear in hot weather (normally excluded in Step 3) but passed via selectedPieceId
    { id: 3, name: 'Selected Heavy Outerwear', category: 'outerwear', photo: 'img.jpg', fabric_weight: 'heavy' },
    // Excess top that would normally be trimmed in Step 4
    { id: 4, name: 'Selected Excess Top', category: 'top', photo: 'img.jpg', fabric_weight: 'light', selected: true },
    { id: 5, name: 'Normal Top 1', category: 'top', photo: 'img.jpg', fabric_weight: 'light' },
    { id: 6, name: 'Normal Top 2', category: 'top', photo: 'img.jpg', fabric_weight: 'light' },
    { id: 7, name: 'Normal Top 3', category: 'top', photo: 'img.jpg', fabric_weight: 'light' }
  ]

  const { roster } = buildVisualComposerRoster(pieces, {
    occasion: 'casual',
    weatherProfile: { isHot: true },
    maxImages: 10,
    selectedPieceId: 3
  })

  const rosterIds = roster.map(p => p.id)

  // ID 1 (no photo but selected) must remain
  assert.ok(rosterIds.includes(1), 'Selected no-photo top must remain')
  // ID 2 (accessory but selected/isAnchor) must remain
  assert.ok(rosterIds.includes(2), 'Selected accessory must remain')
  // ID 3 (heavy outerwear in hot weather but selected via option) must remain
  assert.ok(rosterIds.includes(3), 'Selected heavy outerwear must remain')
  // ID 4 (excess top but selected) must remain
  assert.ok(rosterIds.includes(4), 'Selected excess top must remain')
})
