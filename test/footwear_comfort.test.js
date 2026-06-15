process.env.NODE_ENV = 'test'
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-comfort-'))
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { app, db, uploadsDir } = await import('../server.js')
const { resolveComfortFootwearConstraint, applyComfortFootwearRepair } = await import('../styling-engine/footwear-comfort.js')
const { generateWholeWardrobeOutfitsInternal, generateOutfitsForPieceInternal } = await import('../routes/ai.js')
const { parsePiece } = await import('../db.js')
const { OCCASION_PROFILES } = await import('../styling-engine/occasions.js')

function resetTables() {
  for (const table of ['outfits', 'outfit_pieces', 'pieces', 'saved_boards', 'stylist_feedback']) {
    db.prepare(`DELETE FROM ${table}`).run()
  }
}

async function makeImage(filename, color = '#222222') {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })
  await sharp({
    create: { width: 120, height: 160, channels: 3, background: color }
  }).png().toFile(path.join(uploadsDir, filename))
  return filename
}

let seeded = {}
async function seedWardrobe() {
  resetTables()
  
  const topPhoto = await makeImage('top.png', '#222222')
  const bottomPhoto = await makeImage('bottom.png', '#444444')
  const shoe1Photo = await makeImage('shoe1.png', '#111111')
  const shoe2Photo = await makeImage('shoe2.png', '#222222')
  const shoe3Photo = await makeImage('shoe3.png', '#333333')
  const shoe4Photo = await makeImage('shoe4.png', '#444444')
  const bootPhoto = await makeImage('boot.png', '#6f4d34')

  const topId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as)
    VALUES (?, ?, 'active', ?, ?, ?)
  `).run('black tee', 'top', JSON.stringify(['black']), topPhoto, 'quiet dark neutral top').lastInsertRowid

  const bottomId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as)
    VALUES (?, ?, 'active', ?, ?, ?)
  `).run('blue jeans', 'bottom', JSON.stringify(['blue']), bottomPhoto, 'classic denim blue jeans bottom').lastInsertRowid

  const stilettoId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as)
    VALUES (?, ?, 'active', ?, ?, ?)
  `).run('pointed stiletto heels', 'shoes', JSON.stringify(['black']), shoe1Photo, 'formal high pointed stiletto heels').lastInsertRowid

  const blockHeelId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as)
    VALUES (?, ?, 'active', ?, ?, ?)
  `).run('low block heels', 'shoes', JSON.stringify(['brown']), shoe2Photo, 'comfortable low block heels').lastInsertRowid

  const sneakerId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as)
    VALUES (?, ?, 'active', ?, ?, ?)
  `).run('canvas sneakers', 'shoes', JSON.stringify(['white']), shoe3Photo, 'casual white canvas sneakers flats').lastInsertRowid

  const kittenHeelId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as)
    VALUES (?, ?, 'active', ?, ?, ?)
  `).run('kitten heels', 'shoes', JSON.stringify(['pink']), shoe4Photo, 'pink delicate kitten heels').lastInsertRowid

  const ankleBootId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as)
    VALUES (?, ?, 'active', ?, ?, ?)
  `).run('brown ankle boots', 'shoes', JSON.stringify(['brown']), bootPhoto, 'brown leather ankle boots').lastInsertRowid

  seeded = {
    top: topId,
    bottom: bottomId,
    stiletto: stilettoId,
    blockHeel: blockHeelId,
    sneaker: sneakerId,
    kittenHeel: kittenHeelId,
    ankleBoot: ankleBootId
  }
}

function mockAiHandler({ system, messages }) {
  const text = String(system || '')
  
  if (text.includes('Outfit Composer') || text.includes('Outfit Gate') || text.includes('style_selected_item')) {
    return {
      outfits: [{
        label: 'Mock selected-piece outfit',
        strength: 'signature',
        dominantDirection: 'selected garment with quiet support',
        silhouette: 'selected garment with controlled support pieces',
        bestFor: 'evening',
        pieceIds: [seeded.bottom, seeded.top, seeded.stiletto],
        pieces: [
          { id: seeded.bottom, name: 'blue jeans', category: 'bottom' },
          { id: seeded.top, name: 'black tee', category: 'top' },
          { id: seeded.stiletto, name: 'pointed stiletto heels', category: 'shoes' }
        ],
        reason: 'The selected garment is supported by quiet pieces.',
        watchFor: 'Keep grounding visible.',
      }],
      rejected: [],
      skip: '',
      saveableLearning: 'mock selected-piece learning',
    }
  }

  if (text.includes('personal visual stylist agent') || text.includes('whole-wardrobe outfit composer') || text.includes("You are Yuna's personal stylist. You are looking at photos")) {
    return {
      outfits: [{
        label: 'Mock whole-wardrobe outfit',
        strength: 'signature',
        dominantDirection: 'structure with shoe',
        silhouette: 'controlled top over lower line',
        bestFor: 'evening',
        pieceIds: [seeded.top, seeded.bottom, seeded.stiletto],
        pieces: [
          { id: seeded.top, name: 'black tee', category: 'top' },
          { id: seeded.bottom, name: 'blue jeans', category: 'bottom' },
          { id: seeded.stiletto, name: 'pointed stiletto heels', category: 'shoes' }
        ],
        reason: 'Styling mock reason.',
        watchFor: 'Keep the shoe visible.',
      }],
      rejected: [],
      skip: '',
      saveableLearning: 'mock whole-wardrobe learning',
    }
  }

  return 'Mock stylist answer with generated outfit context.'
}

beforeEach(async () => {
  await seedWardrobe()
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = mockAiHandler
})

afterEach(() => {
  delete globalThis.__WARDROBE_AI_TEST_HANDLER__
})

test('1. Intent detection resolves comfort constraint on walking/feet keywords', () => {
  const cases = [
    { occasion: 'city walking', expectedMatch: true },
    { mood: 'lots of walking', expectedMatch: true },
    { request: 'on my feet all day', expectedMatch: true },
    { request: 'walking around the city', expectedMatch: true },
    { occasion: 'city', expectedMatch: false },
    { occasion: 'dinner', expectedMatch: false },
    { occasion: 'office', expectedMatch: false },
    { occasion: 'brunch', expectedMatch: false },
    { occasion: 'evening', expectedMatch: false }
  ]

  for (const c of cases) {
    const res = resolveComfortFootwearConstraint({
      occasion: c.occasion,
      mood: c.mood,
      request: c.request
    })
    if (c.expectedMatch) {
      assert.ok(res, `Should resolve comfort constraint for occasion="${c.occasion}" mood="${c.mood}" request="${c.request}"`)
      assert.equal(res.reason, 'all-day walking comfort')
      assert.ok(res.discouraged_footwear.includes('stiletto'))
      assert.ok(res.keep_footwear.includes('low block heel'))
    } else {
      assert.equal(res, null, `Should NOT resolve comfort constraint for occasion="${c.occasion}"`)
    }
  }
})

test('2. applyComfortFootwearRepair swaps stiletto heels but keeps block heels & sneakers', () => {
  const constraint = resolveComfortFootwearConstraint({ request: 'lots of walking' })
  assert.ok(constraint)

  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const topPiece = allPieces.find(p => p.id === seeded.top)
  const bottomPiece = allPieces.find(p => p.id === seeded.bottom)
  const stilettoPiece = allPieces.find(p => p.id === seeded.stiletto)
  const blockHeelPiece = allPieces.find(p => p.id === seeded.blockHeel)
  const sneakerPiece = allPieces.find(p => p.id === seeded.sneaker)

  // Case A: Outfit with stiletto heels -> should be swapped
  const stilettoOutfit = {
    label: 'Test Outfit',
    pieceIds: [seeded.top, seeded.bottom, seeded.stiletto],
    pieces: [topPiece, bottomPiece, stilettoPiece]
  }

  const repairedA = applyComfortFootwearRepair(stilettoOutfit, allPieces, constraint, { occasion: 'casual' })
  assert.equal(repairedA.pieceIds.indexOf(seeded.stiletto), -1, 'Stiletto shoe must be swapped out of pieceIds')
  const newShoeId = repairedA.pieceIds.find(id => id !== seeded.top && id !== seeded.bottom)
  assert.notEqual(Number(newShoeId), Number(seeded.stiletto), 'Stiletto shoe must be swapped out')
  assert.ok(Number(newShoeId) === Number(seeded.blockHeel) || Number(newShoeId) === Number(seeded.sneaker), 'Must be swapped to a comfortable shoe')
  assert.ok(repairedA.watchFor.includes('swapped for all-day walking comfort'))

  // Case B: Outfit with block heels -> should NOT be swapped (low block heel is protected)
  const blockHeelOutfit = {
    label: 'Test Outfit 2',
    pieceIds: [seeded.top, seeded.bottom, seeded.blockHeel],
    pieces: [topPiece, bottomPiece, blockHeelPiece]
  }
  const repairedB = applyComfortFootwearRepair(blockHeelOutfit, allPieces, constraint, { occasion: 'casual' })
  assert.deepEqual(repairedB.pieceIds, [seeded.top, seeded.bottom, seeded.blockHeel], 'Block heels should remain untouched')

  // Case C: Idempotency check -> running again on repaired outfit is a no-op
  const repairedAgain = applyComfortFootwearRepair(repairedA, allPieces, constraint, { occasion: 'casual' })
  assert.deepEqual(repairedAgain, repairedA, 'Running comfort repair twice should be a no-op')
})

test('2b. applyComfortFootwearRepair swaps boots for warm-weather walking', () => {
  const constraint = resolveComfortFootwearConstraint({ activity: 'walking' })
  assert.ok(constraint)

  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const topPiece = allPieces.find(p => p.id === seeded.top)
  const bottomPiece = allPieces.find(p => p.id === seeded.bottom)
  const bootPiece = allPieces.find(p => p.id === seeded.ankleBoot)

  const bootOutfit = {
    label: 'Warm Walk With Boots',
    pieceIds: [seeded.top, seeded.bottom, seeded.ankleBoot],
    pieces: [topPiece, bottomPiece, bootPiece],
    watchFor: 'none'
  }

  const repairedWarm = applyComfortFootwearRepair(bootOutfit, allPieces, constraint, {
    occasion: 'casual',
    activity: 'walking',
    weatherProfile: { isHot: true, isCold: false }
  })
  assert.equal(repairedWarm.pieceIds.includes(seeded.ankleBoot), false, 'Warm walking should swap ankle boots')
  assert.ok(repairedWarm.watchFor.includes('swapped for all-day walking comfort'))

  const repairedNeutral = applyComfortFootwearRepair(bootOutfit, allPieces, constraint, {
    occasion: 'casual',
    activity: 'walking',
    weatherProfile: { isHot: false, isCold: false }
  })
  assert.deepEqual(repairedNeutral.pieceIds, bootOutfit.pieceIds, 'Neutral/cool walking can keep boots')
})

test('3. Kitten-heel asymmetry: kitten heels are swapped on walk intent but left untouched on long events', () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const topPiece = allPieces.find(p => p.id === seeded.top)
  const bottomPiece = allPieces.find(p => p.id === seeded.bottom)
  const kittenPiece = allPieces.find(p => p.id === seeded.kittenHeel)

  const outfit = {
    label: 'Test Kitten Heel Outfit',
    pieceIds: [seeded.top, seeded.bottom, seeded.kittenHeel],
    pieces: [topPiece, bottomPiece, kittenPiece]
  }

  // Under walking intent -> kitten heels should be swapped out
  const walkConstraint = resolveComfortFootwearConstraint({ request: 'walking around' })
  const walkRepaired = applyComfortFootwearRepair(outfit, allPieces, walkConstraint, { occasion: 'casual' })
  const shoeId = walkRepaired.pieceIds.find(id => id !== seeded.top && id !== seeded.bottom)
  assert.notEqual(Number(shoeId), Number(seeded.kittenHeel), 'Kitten heels must be swapped out under walking intent')

  // Under long event/dinner -> constraint is null -> kitten heels are left untouched
  const dinnerConstraint = resolveComfortFootwearConstraint({ occasion: 'dinner' })
  assert.equal(dinnerConstraint, null)
  const dinnerRepaired = applyComfortFootwearRepair(outfit, allPieces, dinnerConstraint, { occasion: 'dinner' })
  assert.deepEqual(dinnerRepaired.pieceIds, [seeded.top, seeded.bottom, seeded.kittenHeel], 'Kitten heels should remain untouched for dinner')
})

test('4. occasions.js remains completely unmodified', () => {
  const walkProfile = OCCASION_PROFILES.find(p => p.id === 'walking')
  assert.equal(walkProfile, undefined, 'No walking occasion profile should be created in occasions.js')

  const cityProfile = OCCASION_PROFILES.find(p => p.id === 'city_smart_casual')
  assert.ok(cityProfile, 'City profile should exist')
  assert.deepEqual(cityProfile.rules, {
    discouraged_footwear: ["athletic running shoe", "athletic running shoes"],
    preferred_materials: ["tailored linen", "structured denim", "cardigans", "light outerwear"],
    preferred_footwear: ["loafers", "slip-ons", "low block heels", "clean leather sneakers"]
  }, 'city_smart_casual rules must remain untouched')
})

test('5. walking is completely de-conflated and removed from occasion lists in StylistChat.jsx', () => {
  const filePath = path.join(import.meta.dirname || 'src/components', '../src/components/StylistChat.jsx')
  const content = fs.readFileSync(filePath, 'utf8')
  
  // Assert OCCASION_OPTIONS exists and does not contain walking
  const occasionOptionsMatch = content.match(/const\s+OCCASION_OPTIONS\s*=\s*\[([\s\S]*?)\]/)
  assert.ok(occasionOptionsMatch, 'OCCASION_OPTIONS must be defined in StylistChat.jsx')
  const optionsText = occasionOptionsMatch[1]
  assert.ok(!optionsText.includes('walking'), 'OCCASION_OPTIONS must not contain walking')

  // Assert there is no other hardcoded occasion list containing 'walking'
  const hardcodedSelects = content.match(/<select[^>]*>[\s\S]*?<option[^>]*value="walking"[^>]*>[\s\S]*?<\/select>/)
  assert.equal(hardcodedSelects, null, 'No <select> element should contain walking as a hardcoded option')
})

test('6. Structured activity precedence: activity="walking" triggers constraint, activity="none" acts as no-op', () => {
  // Case A: activity = 'walking', others empty -> matches
  const resWalk = resolveComfortFootwearConstraint({ activity: 'walking' })
  assert.ok(resWalk)
  assert.equal(resWalk.reason, 'all-day walking comfort')

  // Case B: activity = 'none', others empty -> null
  const resNone = resolveComfortFootwearConstraint({ activity: 'none' })
  assert.equal(resNone, null)

  // Case C: activity = 'none', but request has keywords -> fallback still matches
  const resFallback = resolveComfortFootwearConstraint({ activity: 'none', request: 'lots of walking' })
  assert.ok(resFallback)
  assert.equal(resFallback.reason, 'all-day walking comfort')
})

test('7. Plumbing: activity parameter propagates through the generateOutfitsForPieceInternal pipeline', async () => {
  const result = await generateOutfitsForPieceInternal({
    pieceId: seeded.stiletto,
    occasion: 'evening',
    season: 'current season',
    activity: 'walking'
  })

  assert.ok(result.structuredOutfits.length > 0)
  for (const outfit of result.structuredOutfits) {
    const shoe = outfit.pieces.find(p => p.category === 'shoes')
    assert.notEqual(Number(shoe.id), Number(seeded.stiletto), 'Stilettos must be swapped out when activity is walking')
    assert.ok(outfit.watchFor.includes('swapped for all-day walking comfort'))
  }
})

test('8. Plumbing: generateWholeWardrobeOutfitsInternal propagates activity parameter', async () => {
  let capturedSystem = null
  let capturedMessages = null
  const defaultHandler = globalThis.__WARDROBE_AI_TEST_HANDLER__
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = (args) => {
    capturedSystem = args.system
    capturedMessages = args.messages
    return defaultHandler(args)
  }

  try {
    const result = await generateWholeWardrobeOutfitsInternal({
      occasion: 'evening',
      season: 'current season',
      activity: 'walking',
      limit: 2
    })

    assert.ok(result.structuredOutfits.length > 0)
    for (const outfit of result.structuredOutfits) {
      const shoe = outfit.pieces.find(p => p.category === 'shoes')
      if (shoe) {
        assert.notEqual(Number(shoe.id), Number(seeded.stiletto), 'Stilettos must be swapped out when activity is walking')
        assert.ok(outfit.watchFor.includes('swapped for all-day walking comfort'))
      }
    }

    assert.ok(capturedMessages, 'AI must have been called')
    const userText = capturedMessages[0].content
    assert.ok(userText.includes('Activity: walking'), 'The prompt must contain Activity: walking')
    assert.ok(userText.includes('All-day walking: avoid stilettos, high heels, pumps, delicate sandals, and warm-weather boots'), 'The prompt must contain walking guidance')
  } finally {
    globalThis.__WARDROBE_AI_TEST_HANDLER__ = defaultHandler
  }
})
