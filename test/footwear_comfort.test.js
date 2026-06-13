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

  seeded = {
    top: topId,
    bottom: bottomId,
    stiletto: stilettoId,
    blockHeel: blockHeelId,
    sneaker: sneakerId,
    kittenHeel: kittenHeelId
  }
}

beforeEach(async () => {
  await seedWardrobe()
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
