import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Isolated per-run DB (spec 21 Part 1) — this file used to import `db.js`
// (and rules.js, which imports db.js transitively) statically, which meant
// it read/wrote the developer's real wardrobe.db. The env vars must land
// before those modules evaluate, so those imports are dynamic and come
// after this.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-visual-composer-roster-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { buildVisualComposerRoster } = await import('../styling-engine/rules.js')
const { db } = await import('../db.js')

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
    occasion: 'travel',
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
    // Lightweight linen pants
    { id: 4, name: 'Linen Wide Pants', category: 'bottom', photo: 'img.jpg', fabric_category: 'linen', fabric_weight: 'light', fiber_content: ['linen'], style_profile_json: { bottom_kind: 'pants' } },
    // Heavy coat
    { id: 2, name: 'Heavy Coat', category: 'outerwear', photo: 'img.jpg', fabric_weight: 'heavy' },
    // Pants
    { id: 3, name: 'Jeans', category: 'bottom', photo: 'img.jpg', fabric_weight: 'medium', style_profile_json: { bottom_kind: 'pants', coverage: 'full-insulating' } }
  ]

  const { roster, excluded } = buildVisualComposerRoster(pieces, {
    occasion: 'travel',
    weatherProfile: { isCold: true },
    maxImages: 90
  })

  const rosterIds = roster.map(p => p.id)

  // 1. Assert shorts (ID 1) is excluded
  assert.ok(!rosterIds.includes(1), 'Shorts (ID 1) must be excluded in cold weather')
  // 2. Lightweight linen pants (ID 4) must be excluded
  assert.ok(!rosterIds.includes(4), 'Lightweight linen pants (ID 4) must be excluded in cold weather')
  // 3. Heavy coat (ID 2) must remain
  assert.ok(rosterIds.includes(2), 'Heavy Coat (ID 2) must remain in cold weather')
  // 4. Medium pants (ID 3) must remain
  assert.ok(rosterIds.includes(3), 'Pants (ID 3) must remain')

  const exp1 = excluded.find(e => e.pieceId === 1)
  assert.equal(exp1.reason, 'cold weather: shorts')
  const exp4 = excluded.find(e => e.pieceId === 4)
  assert.equal(exp4.reason, 'cold weather: lightweight linen bottom')
})

test('Visual Composer Roster - No weather no-op check', () => {
  const pieces = [
    { id: 1, name: 'Heavy Coat', category: 'outerwear', photo: 'img.jpg', fabric_weight: 'heavy' },
    { id: 2, name: 'Linen Shorts', category: 'bottom', photo: 'img.jpg', style_profile_json: { bottom_kind: 'shorts' } },
    { id: 3, name: 'Gold Ring', category: 'accessory', photo: 'img.jpg' },
    { id: 4, name: 'No Photo Piece', category: 'top', photo: null, worn_photo: null }
  ]

  const { roster, excluded } = buildVisualComposerRoster(pieces, {
    occasion: 'travel',
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
    occasion: 'travel',
    includeAccessories: false
  })
  assert.ok(!res1.roster.some(p => p.id === 1), 'Accessory must be excluded by default')

  // With includeAccessories: true
  const res2 = buildVisualComposerRoster(pieces, {
    occasion: 'travel',
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
    occasion: 'travel',
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
    occasion: 'travel',
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

test('Visual Composer Roster - hard image cap preserves one complete outfit path', () => {
  const pieces = [
    { id: 1, name: 'Top A', category: 'top', photo: 'img.jpg', formality: 'everyday' },
    { id: 2, name: 'Top B', category: 'top', photo: 'img.jpg', formality: 'everyday' },
    { id: 3, name: 'Top C', category: 'top', photo: 'img.jpg', formality: 'everyday' },
    { id: 4, name: 'Bottom', category: 'bottom', photo: 'img.jpg', formality: 'everyday' },
    { id: 5, name: 'Shoes', category: 'shoes', photo: 'img.jpg', formality: 'everyday' },
  ]
  const { roster, debug } = buildVisualComposerRoster(pieces, {
    occasion: 'casual',
    maxImages: 3,
  })

  assert.equal(roster.length, 3)
  assert.deepEqual(new Set(roster.map(piece => piece.category)), new Set(['top', 'bottom', 'shoes']))
  assert.equal(debug.coverageReport.complete, true)
  assert.deepEqual(debug.structureCoverageGaps, [])
})

test('Visual Composer Roster - impossible complete supply is surfaced without overflowing the cap', () => {
  const pieces = [
    { id: 1, name: 'Top A', category: 'top', photo: 'img.jpg', formality: 'everyday' },
    { id: 2, name: 'Top B', category: 'top', photo: 'img.jpg', formality: 'everyday' },
  ]
  const { roster, debug } = buildVisualComposerRoster(pieces, { occasion: 'casual', maxImages: 1 })
  assert.equal(roster.length, 0, 'the prior category-cap result is preserved when supply itself cannot form a look')
  assert.equal(debug.coverageReport.complete, false)
  assert.deepEqual(debug.structureCoverageGaps, ['required_structure_unavailable'])
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
    occasion: 'travel',
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
    occasion: 'travel',
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

test('Visual Composer Roster - register ceiling excludes above-register pieces before model composition', () => {
  const pieces = [
    { id: 1, name: 'Everyday Tee', category: 'top', photo: 'img.jpg', formality: 'everyday' },
    { id: 2, name: 'Elevated Trouser', category: 'bottom', photo: 'img.jpg', formality: 'elevated' },
    { id: 3, name: 'Dressy Mule', category: 'shoes', photo: 'img.jpg', formality: 'dressy' }
  ]

  const { roster, excluded, debug } = buildVisualComposerRoster(pieces, {
    occasion: 'city',
    request: 'not dressy',
    maxImages: 90
  })

  assert.deepEqual(roster.map(piece => piece.id).sort((a, b) => a - b), [1, 2])
  assert.equal(debug.registerCeiling, 'elevated')
  assert.deepEqual(debug.formalityIntent.avoid, ['dressy'])
  assert.equal(
    excluded.find(item => item.pieceId === 3)?.reason,
    'register: dressy exceeds elevated ceiling'
  )
  assert.equal(debug.excludedCounts['register: dressy exceeds elevated ceiling'], 1)
})

test('Visual Composer Roster - history bonuses cannot rescue above-ceiling pieces', () => {
  const dressy = { id: 990101, name: 'Favorite Dressy Mule', category: 'shoes', photo: 'img.jpg', formality: 'dressy' }
  const elevated = { id: 990102, name: 'Elevated Loafer', category: 'shoes', photo: 'img.jpg', formality: 'elevated' }
  db.prepare('DELETE FROM outfit_pieces WHERE piece_id IN (?, ?)').run(dressy.id, elevated.id)
  db.prepare('DELETE FROM pieces WHERE id IN (?, ?)').run(dressy.id, elevated.id)
  db.prepare('INSERT INTO pieces (id, name, category, photo, formality, status) VALUES (?, ?, ?, ?, ?, ?)').run(dressy.id, dressy.name, dressy.category, dressy.photo, dressy.formality, 'active')
  db.prepare('INSERT INTO pieces (id, name, category, photo, formality, status) VALUES (?, ?, ?, ?, ?, ?)').run(elevated.id, elevated.name, elevated.category, elevated.photo, elevated.formality, 'active')
  const outfit = db.prepare("INSERT INTO outfits (name, occasion, favorite) VALUES ('register ceiling fixture', 'city', 1)").run()
  db.prepare('INSERT INTO outfit_pieces (outfit_id, piece_id) VALUES (?, ?)').run(outfit.lastInsertRowid, dressy.id)

  try {
    const { roster, excluded } = buildVisualComposerRoster([dressy, elevated], {
      occasion: 'city',
      request: 'not dressy',
      maxImages: 90
    })

    assert.deepEqual(roster.map(piece => piece.id), [elevated.id])
    assert.equal(
      excluded.find(item => item.pieceId === dressy.id)?.reason,
      'register: dressy exceeds elevated ceiling'
    )
  } finally {
    db.prepare('DELETE FROM outfit_pieces WHERE outfit_id = ?').run(outfit.lastInsertRowid)
    db.prepare('DELETE FROM outfits WHERE id = ?').run(outfit.lastInsertRowid)
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?)').run(dressy.id, elevated.id)
  }
})

test('Visual Composer Roster - active register ceiling requires formality metadata', () => {
  const missing = { id: 990201, name: 'Mystery Top', category: 'top', photo: 'img.jpg' }
  db.prepare('DELETE FROM todos WHERE linked_piece_id = ?').run(missing.id)
  db.prepare('DELETE FROM pieces WHERE id = ?').run(missing.id)
  db.prepare('INSERT INTO pieces (id, name, category, photo, status) VALUES (?, ?, ?, ?, ?)').run(missing.id, missing.name, missing.category, missing.photo, 'active')

  try {
    const inactive = buildVisualComposerRoster([missing], {
      occasion: 'travel',
      maxImages: 90
    })
    assert.deepEqual(inactive.roster.map(piece => piece.id), [missing.id])
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM todos WHERE type = 'metadata' AND linked_piece_id = ?").get(missing.id).count, 0)

    const active = buildVisualComposerRoster([missing], {
      occasion: 'city',
      request: 'not dressy',
      maxImages: 90
    })
    assert.deepEqual(active.roster, [])
    assert.equal(active.excluded.find(item => item.pieceId === missing.id)?.reason, 'metadata missing: formality (register gate active)')
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM todos WHERE type = 'metadata' AND linked_piece_id = ? AND description LIKE ?").get(missing.id, '%missing formality%').count, 1)

    buildVisualComposerRoster([missing], {
      occasion: 'city',
      request: 'not dressy',
      maxImages: 90
    })
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM todos WHERE type = 'metadata' AND linked_piece_id = ? AND description LIKE ?").get(missing.id, '%missing formality%').count, 1)
  } finally {
    db.prepare('DELETE FROM todos WHERE linked_piece_id = ?').run(missing.id)
    db.prepare('DELETE FROM pieces WHERE id = ?').run(missing.id)
  }
})

test('Visual Composer Roster - formality score orders same-register survivors at category cut', () => {
  const pieces = [
    { id: 1, name: 'Everyday Top', category: 'top', photo: 'img.jpg', formality: 'everyday' },
    { id: 2, name: 'Lounge Top', category: 'top', photo: 'img.jpg', formality: 'lounge' }
  ]
  for (let id = 3; id <= 12; id++) {
    pieces.push({ id, name: `Everyday Bottom ${id}`, category: 'bottom', photo: 'img.jpg', formality: 'everyday' })
  }

  const { roster, excluded, debug } = buildVisualComposerRoster(pieces, {
    occasion: 'city',
    request: 'more everyday',
    maxImages: 5
  })

  assert.ok(roster.some(piece => piece.id === 1))
  assert.ok(!roster.some(piece => piece.id === 2))
  assert.equal(excluded.find(item => item.pieceId === 2)?.reason, 'roster cap: category limit')
  assert.ok(debug.relevanceAdjustments[1].some(reason => reason.includes('matches request')))
  assert.ok(debug.relevanceAdjustments[2].some(reason => reason.includes('near everyday')))
})

test('Visual Composer Roster - outdoor daytime social enforces elevated target when slot coverage is sufficient', () => {
  const pieces = [
    { id: 991401, name: 'Everyday Graphic Tee', category: 'top', photo: 'img.jpg', formality: 'everyday' },
    { id: 991402, name: 'Elevated Linen Blouse A', category: 'top', photo: 'img.jpg', formality: 'elevated' },
    { id: 991403, name: 'Elevated Linen Blouse B', category: 'top', photo: 'img.jpg', formality: 'elevated' },
    { id: 991404, name: 'Elevated Linen Blouse C', category: 'top', photo: 'img.jpg', formality: 'elevated' },
    { id: 991405, name: 'Elevated Linen Blouse D', category: 'top', photo: 'img.jpg', formality: 'elevated' },
    { id: 991406, name: 'Everyday Cotton Shorts', category: 'bottom', photo: 'img.jpg', formality: 'everyday' },
    { id: 991407, name: 'Elevated Skirt A', category: 'bottom', photo: 'img.jpg', formality: 'elevated' },
    { id: 991408, name: 'Elevated Skirt B', category: 'bottom', photo: 'img.jpg', formality: 'elevated' },
    { id: 991409, name: 'Elevated Shorts C', category: 'bottom', photo: 'img.jpg', formality: 'elevated' },
    { id: 991410, name: 'Everyday Walking Loafers', category: 'shoes', photo: 'img.jpg', formality: 'everyday', heel_height: 'flat', walk_support: 'high' },
    { id: 991411, name: 'Elevated Loafer A', category: 'shoes', photo: 'img.jpg', formality: 'elevated', heel_height: 'flat', walk_support: 'high' },
    { id: 991412, name: 'Elevated Flat B', category: 'shoes', photo: 'img.jpg', formality: 'elevated', heel_height: 'flat', walk_support: 'high' },
    { id: 991413, name: 'Lounge Errand Sneaker', category: 'shoes', photo: 'img.jpg', formality: 'lounge', heel_height: 'flat', walk_support: 'high' },
    { id: 991414, name: 'Mesh Athletic Sneakers', category: 'shoes', photo: 'img.jpg', formality: 'everyday', heel_height: 'flat', walk_support: 'high', reads_as: 'athletic walking sneakers' }
  ]

  const { roster, excluded, debug } = buildVisualComposerRoster(pieces, {
    occasion: 'outdoor_daytime_social',
    activity: 'walking',
    maxImages: 90
  })

  assert.equal(debug.registerTarget, 'elevated')
  assert.deepEqual(debug.registerTargetCoverageGaps, [])
  assert.deepEqual(debug.registerTargetEnforcedGroups.sort(), ['bottom', 'shoes', 'top'])
  assert.ok(!roster.some(piece => piece.id === 991401), 'everyday top should not reach the model when elevated top coverage exists')
  assert.ok(!roster.some(piece => piece.id === 991406), 'everyday bottom should not reach the model when elevated bottom coverage exists')
  assert.ok(roster.some(piece => piece.id === 991410), 'everyday walking shoes should remain available when walking is selected')
  assert.ok(!roster.some(piece => piece.id === 991413), 'lounge shoes should not reach the model for elevated walking occasions')
  assert.ok(!roster.some(piece => piece.id === 991414), 'athletic sneakers should not reach the model for polished outdoor daytime social walking')
  assert.equal(excluded.find(item => item.pieceId === 991401)?.reason, 'register: everyday below elevated target')
  assert.equal(excluded.find(item => item.pieceId === 991406)?.reason, 'register: everyday below elevated target')
  assert.equal(excluded.find(item => item.pieceId === 991413)?.reason, 'register: lounge below polished walking target')
  assert.equal(excluded.find(item => item.pieceId === 991414)?.reason, 'footwear: athletic unsuitable for polished walking target')
})

test('Visual Composer Roster - outdoor daytime social target degrades when elevated slot coverage is thin', () => {
  const pieces = [
    { id: 991421, name: 'Everyday Graphic Tee', category: 'top', photo: 'img.jpg', formality: 'everyday' },
    { id: 991422, name: 'Elevated Linen Blouse A', category: 'top', photo: 'img.jpg', formality: 'elevated' },
    { id: 991423, name: 'Everyday Cotton Shorts', category: 'bottom', photo: 'img.jpg', formality: 'everyday' },
    { id: 991424, name: 'Elevated Skirt A', category: 'bottom', photo: 'img.jpg', formality: 'elevated' },
    { id: 991425, name: 'Everyday Strap Sandals', category: 'shoes', photo: 'img.jpg', formality: 'everyday', heel_height: 'flat', walk_support: 'medium' },
    { id: 991426, name: 'Elevated Loafer A', category: 'shoes', photo: 'img.jpg', formality: 'elevated', heel_height: 'flat', walk_support: 'high' }
  ]

  const { roster, debug } = buildVisualComposerRoster(pieces, {
    occasion: 'outdoor_daytime_social',
    activity: 'walking',
    maxImages: 90
  })

  assert.equal(debug.registerTarget, 'elevated')
  assert.deepEqual(debug.registerTargetCoverageGaps.sort(), ['bottom', 'top'])
  assert.deepEqual(debug.registerTargetEnforcedGroups, ['shoes'])
  assert.ok(roster.some(piece => piece.id === 991421), 'everyday top should remain available when elevated top coverage is thin')
  assert.ok(roster.some(piece => piece.id === 991423), 'everyday bottom should remain available when elevated bottom coverage is thin')
  assert.ok(roster.some(piece => piece.id === 991425), 'everyday shoe should remain available when elevated shoe coverage is thin')
})

test('Visual Composer Roster - walking activity excludes low-support flat sandals', () => {
  const strapSandals = {
    id: 990301,
    name: 'Brown leather strap sandals',
    category: 'shoes',
    photo: 'img.jpg',
    formality: 'everyday',
    heel_height: 'flat',
    walk_support: 'low'
  }
  const sneakers = {
    id: 990302,
    name: 'Trail sneakers',
    category: 'shoes',
    photo: 'img.jpg',
    formality: 'everyday',
    heel_height: 'flat',
    walk_support: 'high'
  }

  const { roster, excluded, debug } = buildVisualComposerRoster([strapSandals, sneakers], {
    occasion: 'casual',
    activity: 'walking',
    maxImages: 90
  })

  assert.deepEqual(roster.map(piece => piece.id), [sneakers.id])
  assert.equal(
    excluded.find(item => item.pieceId === strapSandals.id)?.reason,
    'footwear: low support unsuitable for Lots of walking'
  )
  assert.equal(debug.excludedCounts['footwear: low support unsuitable for Lots of walking'], 1)
})

test('Visual Composer Roster - walking excludes mid heels but no activity leaves them available', () => {
  const midHeel = {
    id: 990311,
    name: 'Everyday mid heel',
    category: 'shoes',
    photo: 'img.jpg',
    formality: 'everyday',
    heel_height: 'mid',
    walk_support: 'medium'
  }

  const walking = buildVisualComposerRoster([midHeel], {
    occasion: 'travel',
    activity: 'walking',
    maxImages: 90
  })
  assert.deepEqual(walking.roster, [])
  assert.equal(
    walking.excluded.find(item => item.pieceId === midHeel.id)?.reason,
    'footwear: mid heel unsuitable for Lots of walking'
  )

  const noActivity = buildVisualComposerRoster([midHeel], {
    occasion: 'travel',
    activity: 'none',
    maxImages: 90
  })
  assert.deepEqual(noActivity.roster.map(piece => piece.id), [midHeel.id])
})

test('Visual Composer Roster - athletic shoes survive walking and hiking activity gates', () => {
  const athletic = {
    id: 990321,
    name: 'Light grey knit athletic shoes',
    category: 'shoes',
    photo: 'img.jpg',
    formality: 'everyday',
    heel_height: 'flat',
    walk_support: 'high'
  }

  const walking = buildVisualComposerRoster([athletic], {
    occasion: 'travel',
    activity: 'walking',
    maxImages: 90
  })
  const hiking = buildVisualComposerRoster([athletic], {
    occasion: 'travel',
    activity: 'hiking',
    maxImages: 90
  })

  assert.deepEqual(walking.roster.map(piece => piece.id), [athletic.id])
  assert.deepEqual(hiking.roster.map(piece => piece.id), [athletic.id])
})

test('Visual Composer Roster - medium walk support survives walking but not hiking', () => {
  const mediumSupportFlat = {
    id: 990331,
    name: 'Medium support flat',
    category: 'shoes',
    photo: 'img.jpg',
    formality: 'everyday',
    heel_height: 'flat',
    walk_support: 'medium'
  }

  const walking = buildVisualComposerRoster([mediumSupportFlat], {
    occasion: 'travel',
    activity: 'walking',
    maxImages: 90
  })
  const hiking = buildVisualComposerRoster([mediumSupportFlat], {
    occasion: 'travel',
    activity: 'hiking',
    maxImages: 90
  })

  assert.deepEqual(walking.roster.map(piece => piece.id), [mediumSupportFlat.id])
  assert.deepEqual(hiking.roster, [])
  assert.equal(
    hiking.excluded.find(item => item.pieceId === mediumSupportFlat.id)?.reason,
    'footwear: medium support unsuitable for Hiking / Outdoor active'
  )
})

test('Visual Composer Roster - active footwear gate requires comfort metadata only when both shoe enums are missing', () => {
  const missing = { id: 990341, name: 'Mystery walking shoe', category: 'shoes', photo: 'img.jpg' }
  const onlyHeel = { id: 990342, name: 'Partial low heel shoe', category: 'shoes', photo: 'img.jpg', heel_height: 'low' }
  const onlySupport = { id: 990343, name: 'Partial low support shoe', category: 'shoes', photo: 'img.jpg', walk_support: 'low' }

  for (const piece of [missing, onlyHeel, onlySupport]) {
    db.prepare('DELETE FROM todos WHERE linked_piece_id = ?').run(piece.id)
    db.prepare('DELETE FROM pieces WHERE id = ?').run(piece.id)
    db.prepare('INSERT INTO pieces (id, name, category, photo, heel_height, walk_support, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      piece.id,
      piece.name,
      piece.category,
      piece.photo,
      piece.heel_height || null,
      piece.walk_support || null,
      'active'
    )
  }

  try {
    const inactive = buildVisualComposerRoster([missing], {
      occasion: 'travel',
      activity: 'none',
      maxImages: 90
    })
    assert.deepEqual(inactive.roster.map(piece => piece.id), [missing.id])
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM todos WHERE type = 'metadata' AND linked_piece_id = ?").get(missing.id).count, 0)

    const activeMissing = buildVisualComposerRoster([missing], {
      occasion: 'travel',
      activity: 'walking',
      maxImages: 90
    })
    assert.deepEqual(activeMissing.roster, [])
    assert.equal(activeMissing.excluded.find(item => item.pieceId === missing.id)?.reason, 'metadata missing: footwear comfort (activity gate active)')
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM todos WHERE type = 'metadata' AND linked_piece_id = ? AND description LIKE ?").get(missing.id, '%missing footwear-comfort%').count, 1)

    buildVisualComposerRoster([missing], {
      occasion: 'travel',
      activity: 'walking',
      maxImages: 90
    })
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM todos WHERE type = 'metadata' AND linked_piece_id = ? AND description LIKE ?").get(missing.id, '%missing footwear-comfort%').count, 1)

    const partialHeel = buildVisualComposerRoster([onlyHeel], {
      occasion: 'travel',
      activity: 'walking',
      maxImages: 90
    })
    assert.deepEqual(partialHeel.roster.map(piece => piece.id), [onlyHeel.id])
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM todos WHERE type = 'metadata' AND linked_piece_id = ?").get(onlyHeel.id).count, 0)

    const partialSupport = buildVisualComposerRoster([onlySupport], {
      occasion: 'travel',
      activity: 'walking',
      maxImages: 90
    })
    assert.deepEqual(partialSupport.roster, [])
    assert.equal(partialSupport.excluded.find(item => item.pieceId === onlySupport.id)?.reason, 'footwear: low support unsuitable for Lots of walking')
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM todos WHERE type = 'metadata' AND linked_piece_id = ?").get(onlySupport.id).count, 0)
  } finally {
    for (const piece of [missing, onlyHeel, onlySupport]) {
      db.prepare('DELETE FROM todos WHERE linked_piece_id = ?').run(piece.id)
      db.prepare('DELETE FROM pieces WHERE id = ?').run(piece.id)
    }
  }
})

test('Visual Composer Roster - register and footwear activity gates coexist without masking each other', () => {
  const pieces = [
    { id: 990351, name: 'Casual tee', category: 'top', photo: 'img.jpg', formality: 'everyday' },
    { id: 990352, name: 'Dressy flat', category: 'shoes', photo: 'img.jpg', formality: 'dressy', heel_height: 'flat', walk_support: 'high' },
    { id: 990353, name: 'Everyday mid heel', category: 'shoes', photo: 'img.jpg', formality: 'everyday', heel_height: 'mid', walk_support: 'medium' }
  ]

  const { roster, excluded, debug } = buildVisualComposerRoster(pieces, {
    occasion: 'casual',
    activity: 'walking',
    maxImages: 90
  })

  assert.deepEqual(roster.map(piece => piece.id), [990351])
  assert.equal(excluded.find(item => item.pieceId === 990352)?.reason, 'register: dressy exceeds everyday ceiling')
  assert.equal(excluded.find(item => item.pieceId === 990353)?.reason, 'footwear: mid heel unsuitable for Lots of walking')
  assert.equal(debug.excludedCounts['register: dressy exceeds everyday ceiling'], 1)
  assert.equal(debug.excludedCounts['footwear: mid heel unsuitable for Lots of walking'], 1)
})

test('Visual Composer Roster - footwear activity gate ignores non-shoes and selected shoes', () => {
  const topWithShoeFields = {
    id: 990361,
    name: 'Top with nonsense shoe metadata',
    category: 'top',
    photo: 'img.jpg',
    heel_height: 'high',
    walk_support: 'low'
  }
  const selectedMidHeel = {
    id: 990362,
    name: 'Selected mid heel',
    category: 'shoes',
    photo: 'img.jpg',
    heel_height: 'mid',
    walk_support: 'low'
  }

  const { roster, excluded } = buildVisualComposerRoster([topWithShoeFields, selectedMidHeel], {
    occasion: 'travel',
    activity: 'walking',
    selectedPieceId: selectedMidHeel.id,
    maxImages: 90
  })

  assert.deepEqual(roster.map(piece => piece.id).sort((a, b) => a - b), [topWithShoeFields.id, selectedMidHeel.id])
  assert.equal(excluded.length, 0)
})

test('Visual Composer Roster - hiking activity enforces curated outdoor occasion tags when slot coverage is sufficient', () => {
  const tops = [
    { id: 991001, name: 'Outdoor tee 1', category: 'top', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor'] },
    { id: 991002, name: 'Outdoor tee 2', category: 'top', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor active'] },
    { id: 991003, name: 'Outdoor tee 3', category: 'top', photo: 'img.jpg', formality: 'everyday', occasions: ['hiking'] }
  ]
  const bottoms = [
    { id: 991011, name: 'Olive cargo drawstring shorts', category: 'bottom', photo: 'img.jpg', formality: 'everyday', occasions: ['casual', 'outdoor'] },
    { id: 991012, name: 'Outdoor pants 2', category: 'bottom', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor'] },
    { id: 991013, name: 'Outdoor pants 3', category: 'bottom', photo: 'img.jpg', formality: 'everyday', occasions: ['hiking'] },
    { id: 991014, name: 'City corduroy pants', category: 'bottom', photo: 'img.jpg', formality: 'everyday', occasions: ['casual', 'city'] }
  ]
  const shoes = [
    { id: 991021, name: 'Trail sneaker 1', category: 'shoes', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor'], heel_height: 'flat', walk_support: 'high' },
    { id: 991022, name: 'Trail sneaker 2', category: 'shoes', photo: 'img.jpg', formality: 'everyday', occasions: ['hiking'], heel_height: 'flat', walk_support: 'high' }
  ]

  const { roster, excluded, debug } = buildVisualComposerRoster([...tops, ...bottoms, ...shoes], {
    occasion: 'casual',
    activity: 'hiking',
    maxImages: 90
  })

  assert.ok(roster.some(piece => piece.id === 991011))
  assert.ok(!roster.some(piece => piece.id === 991014))
  assert.equal(excluded.find(item => item.pieceId === 991014)?.reason, 'activity: not tagged for Hiking / Outdoor active')
  assert.deepEqual(debug.activityCoverageGaps, [])
  assert.deepEqual(debug.activityTagEnforcedGroups.sort(), ['bottom', 'shoes', 'top'])
})

test('Visual Composer Roster - hiking activity degrades thin top coverage while enforcing covered slots', () => {
  const pieces = [
    { id: 991101, name: 'Only outdoor tee', category: 'top', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor'] },
    { id: 991102, name: 'City tee allowed by degradation', category: 'top', photo: 'img.jpg', formality: 'everyday', occasions: ['city'] },
    { id: 991111, name: 'Outdoor bottom 1', category: 'bottom', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor'] },
    { id: 991112, name: 'Outdoor bottom 2', category: 'bottom', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor'] },
    { id: 991113, name: 'Outdoor bottom 3', category: 'bottom', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor'] },
    { id: 991114, name: 'City bottom excluded', category: 'bottom', photo: 'img.jpg', formality: 'everyday', occasions: ['city'] },
    { id: 991121, name: 'Trail sneaker 1', category: 'shoes', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor'], heel_height: 'flat', walk_support: 'high' },
    { id: 991122, name: 'Trail sneaker 2', category: 'shoes', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor'], heel_height: 'flat', walk_support: 'high' }
  ]

  const { roster, excluded, debug } = buildVisualComposerRoster(pieces, {
    occasion: 'casual',
    activity: 'hiking',
    maxImages: 90
  })

  assert.ok(roster.some(piece => piece.id === 991102), 'thin top coverage should leave non-outdoor tops visible')
  assert.ok(!roster.some(piece => piece.id === 991114), 'covered bottom slot should still enforce outdoor tags')
  assert.equal(excluded.find(item => item.pieceId === 991114)?.reason, 'activity: not tagged for Hiking / Outdoor active')
  assert.deepEqual(debug.activityCoverageGaps, ['top'])
  assert.deepEqual(debug.activityTagEnforcedGroups.sort(), ['bottom', 'shoes'])
})

test('Visual Composer Roster - walking has no curated occasion tag activity gate', () => {
  const cityShoe = { id: 991201, name: 'City walking flat', category: 'shoes', photo: 'img.jpg', formality: 'everyday', occasions: ['city'], heel_height: 'flat', walk_support: 'high' }

  const { roster, excluded, debug } = buildVisualComposerRoster([cityShoe], {
    occasion: 'casual',
    activity: 'walking',
    maxImages: 90
  })

  assert.deepEqual(roster.map(piece => piece.id), [cityShoe.id])
  assert.equal(excluded.some(item => /activity: not tagged/.test(item.reason)), false)
  assert.deepEqual(debug.activityCoverageGaps, [])
  assert.deepEqual(debug.activityTagEnforcedGroups, [])
})

test('Visual Composer Roster - empty occasions are excluded under enforced hiking slots without metadata todo', () => {
  const pieces = [
    { id: 991301, name: 'Outdoor top 1', category: 'top', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor'] },
    { id: 991302, name: 'Outdoor top 2', category: 'top', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor'] },
    { id: 991303, name: 'Outdoor top 3', category: 'top', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor'] },
    { id: 991304, name: 'Empty occasion top', category: 'top', photo: 'img.jpg', formality: 'everyday', occasions: [] },
    { id: 991311, name: 'Outdoor bottom 1', category: 'bottom', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor'] },
    { id: 991312, name: 'Outdoor bottom 2', category: 'bottom', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor'] },
    { id: 991313, name: 'Outdoor bottom 3', category: 'bottom', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor'] },
    { id: 991321, name: 'Trail sneaker 1', category: 'shoes', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor'], heel_height: 'flat', walk_support: 'high' },
    { id: 991322, name: 'Trail sneaker 2', category: 'shoes', photo: 'img.jpg', formality: 'everyday', occasions: ['outdoor'], heel_height: 'flat', walk_support: 'high' }
  ]
  db.prepare('DELETE FROM todos WHERE linked_piece_id = ?').run(991304)

  const { roster, excluded } = buildVisualComposerRoster(pieces, {
    occasion: 'casual',
    activity: 'hiking',
    maxImages: 90
  })

  assert.ok(!roster.some(piece => piece.id === 991304))
  assert.equal(excluded.find(item => item.pieceId === 991304)?.reason, 'activity: not tagged for Hiking / Outdoor active')
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM todos WHERE linked_piece_id = ?").get(991304).count, 0)
})
