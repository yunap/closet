process.env.NODE_ENV = 'test'
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-walkable-divergence-'))
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { app, db, uploadsDir } = await import('../server.js')
const { resolveActivityProfile } = await import('../styling-engine/footwear-comfort.js')
const { resolveFormalityIntent, buildVisualComposerRoster, formalityFitForPiece } = await import('../styling-engine/rules.js')
const { WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM } = await import('../styling-engine/prompts.js')
const { generateWholeWardrobeOutfitsVisualInternal } = await import('../routes/ai.js')
const { parsePiece } = await import('../db.js')

function resetTables() {
  for (const table of ['outfits', 'outfit_pieces', 'pieces', 'saved_boards', 'stylist_feedback', 'generation_runs']) {
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

  const topId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, fabric_weight, fiber_content, style_profile_json, formality)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, 'everyday')
  `).run('black tee', 'top', JSON.stringify(['black']), topPhoto, 'quiet dark neutral top', 'light', '["cotton"]', '{"coverage":"normal","bareness":"normal"}').lastInsertRowid

  const bottomId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, fabric_weight, fiber_content, style_profile_json, formality)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, 'everyday')
  `).run('blue jeans', 'bottom', JSON.stringify(['blue']), bottomPhoto, 'classic denim blue jeans bottom', 'light', '["cotton"]', '{"coverage":"normal","bareness":"normal"}').lastInsertRowid

  const sandalId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, walk_support, heel_height, formality)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, 'everyday')
  `).run('strap sandals', 'shoes', JSON.stringify(['brown']), shoe1Photo, 'delicate thin strap sandals', 'low', 'flat').lastInsertRowid

  const sneakerId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, walk_support, heel_height, formality)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, 'everyday')
  `).run('sneakers', 'shoes', JSON.stringify(['white']), shoe2Photo, 'highly supportive walking sneakers', 'high', 'flat').lastInsertRowid

  seeded = {
    top: topId,
    bottom: bottomId,
    sandal: sandalId,
    sneaker: sneakerId
  }
}

let aiCalls = []
function mockAiHandler({ system, messages }) {
  aiCalls.push({ system, messages })
  return {
    outfits: [{
      label: 'Mock walk outfit',
      strength: 'signature',
      dominantDirection: 'walk comfort',
      silhouette: 'top over bottom',
      bestFor: 'casual walking',
      pieceIds: [seeded.top, seeded.bottom, seeded.sneaker],
      pieces: [
        { id: seeded.top, name: 'black tee', category: 'top' },
        { id: seeded.bottom, name: 'blue jeans', category: 'bottom' },
        { id: seeded.sneaker, name: 'sneakers', category: 'shoes' }
      ],
      reason: 'Supportive walking outfit.',
      watchFor: 'none'
    }],
    rejected: [],
    skip: '',
    saveableLearning: 'mock learning'
  }
}

beforeEach(async () => {
  await seedWardrobe()
  aiCalls = []
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = mockAiHandler
})

afterEach(() => {
  delete globalThis.__WARDROBE_AI_TEST_HANDLER__
})

test('1. resolveActivityProfile and the rules.js walkable flag agree on walking keywords', () => {
  const walkingPhrases = ['walk my dog', 'walk', 'walking', 'stroll', 'hike']
  for (const phrase of walkingPhrases) {
    const act = resolveActivityProfile({ request: phrase })
    assert.ok(act, `Should resolve activity for "${phrase}"`)
    assert.ok(act.id === 'walking' || act.id === 'hiking', `Activity for "${phrase}" should be walking/hiking`)

    const form = resolveFormalityIntent({ request: phrase })
    assert.equal(form.walkable, true, `Formality intent walkable flag should be true for "${phrase}"`)
  }
})

test('2. Soft walkability score applies when walking is request-inferred', () => {
  const allowedPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  
  const { roster } = buildVisualComposerRoster(allowedPieces, {
    occasion: 'city',
    request: 'walk my dog'
  })

  const sandal = roster.find(p => p.id === seeded.sandal)
  const sneaker = roster.find(p => p.id === seeded.sneaker)

  assert.ok(sandal, 'Sandal should be in the roster')
  assert.ok(sneaker, 'Sneaker should be in the roster')

  const formalityIntent = resolveFormalityIntent({
    occasion: 'city',
    request: 'walk my dog'
  })

  const sandalResult = formalityFitForPiece(sandal, {
    occasion: 'city',
    request: 'walk my dog',
    formalityIntent
  })

  const sneakerResult = formalityFitForPiece(sneaker, {
    occasion: 'city',
    request: 'walk my dog',
    formalityIntent
  })

  const sandalPenalized = sandalResult.adjustments.some(adj => adj.reason === 'register: not walkable enough')
  assert.equal(sandalPenalized, true, 'Low-support sandal should receive not walkable enough penalty')

  const sneakerBoosted = sneakerResult.adjustments.some(adj => adj.reason === 'register: walkable shoe')
  assert.equal(sneakerBoosted, true, 'High-support sneaker should receive walkable shoe boost')
})

test('3. Hard walking gate does NOT exclude low-support shoes when comfort intent is request-inferred', () => {
  const allowedPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  
  const { roster, excluded } = buildVisualComposerRoster(allowedPieces, {
    occasion: 'city',
    request: 'walk my dog' // Inferred walkable comfort
  })

  const sandalInRoster = roster.some(p => p.id === seeded.sandal)
  assert.equal(sandalInRoster, true, 'Sandal should survive gate and be in roster')

  const sandalExcluded = excluded.some(p => p.pieceId === seeded.sandal)
  assert.equal(sandalExcluded, false, 'Sandal should NOT be excluded')
})

test('4. mood does NOT resolve to walking activity or trigger walkable', () => {
  const allowedPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  
  const { debug } = buildVisualComposerRoster(allowedPieces, {
    occasion: 'city',
    mood: 'walk my dog' // Mood-only field
  })

  assert.equal(debug.walkable, false, 'Mood-only walk my dog should NOT set walkable true')
  assert.equal(debug.resolvedActivity, 'none', 'Mood-only walk my dog should not resolve an activity profile')

  const sandal = allowedPieces.find(p => p.id === seeded.sandal)
  const formalityIntent = resolveFormalityIntent({
    occasion: 'city',
    mood: 'walk my dog'
  })
  const sandalResult = formalityFitForPiece(sandal, {
    occasion: 'city',
    mood: 'walk my dog',
    formalityIntent
  })

  const sandalPenalized = sandalResult.adjustments.some(adj => adj.reason === 'register: not walkable enough')
  assert.equal(sandalPenalized, false, 'Sandal should NOT receive walkable penalty since mood is insulated')
})

test('5. Composer prompt string contains the exact-slot hard constraint and the escape clause', () => {
  assert.ok(WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM.includes('EXACTLY one top AND one bottom, OR exactly one dress'))
  assert.ok(WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM.includes('EXACTLY one pair of shoes'))
  assert.ok(WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM.includes("[missing wardrobe gap: category]"))
})

test('6. Diagnostic card payload in response and SQLite generation runs logging', async () => {
  const response = await generateWholeWardrobeOutfitsVisualInternal({
    occasion: 'city',
    season: 'current season',
    request: 'walk my dog',
    limit: 2
  })

  assert.ok(response.debug)
  assert.equal(response.debug.resolvedActivity, 'walking')
  assert.equal(response.debug.activitySource, 'inferred')
  assert.equal(response.debug.walkable, true)
  assert.ok(response.debug.rosterCounts)

  // Verify SQLite row was logged correctly with roster counts and activity source
  const run = db.prepare("SELECT * FROM generation_runs WHERE flow = 'whole_wardrobe_visual' ORDER BY id DESC LIMIT 1").get()
  assert.ok(run, 'Should have persisted a generation run')
  assert.equal(run.activity_source, 'inferred')
  
  const loggedRosterCounts = JSON.parse(run.roster_counts)
  assert.ok(loggedRosterCounts, 'Roster counts should be logged as JSON')
  assert.equal(loggedRosterCounts.shoes, 2)
  assert.equal(loggedRosterCounts.top, 1)
  assert.equal(loggedRosterCounts.bottom, 1)
})

test('7. No post-model-filtering regression: malformed cards still appear as diagnostic cards', async () => {
  // Set up AI handler returning one valid outfit and one malformed card (missing shoes)
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = () => {
    return {
      outfits: [{
        label: 'Valid model outfit',
        strength: 'strong',
        dominantDirection: 'city structure',
        silhouette: 'top over bottom',
        bestFor: 'city',
        pieceIds: [seeded.top, seeded.bottom, seeded.sneaker],
        reason: 'Complete model outfit',
        watchFor: 'none'
      }, {
        label: 'Model forgot shoes',
        strength: 'strong',
        dominantDirection: 'unfinished',
        silhouette: 'top over bottom',
        bestFor: 'city',
        pieceIds: [seeded.top, seeded.bottom], // no shoes
        reason: 'Broken outfit mock',
        watchFor: 'Missing shoes'
      }],
      rejected: [],
      skip: '',
      saveableLearning: ''
    }
  }

  const response = await generateWholeWardrobeOutfitsVisualInternal({
    occasion: 'city',
    season: 'current season',
    limit: 2 // Limit 2 so that we have space for the valid outfit and the diagnostic
  })

  const outfits = response.structuredOutfits
  assert.equal(outfits.length, 2)

  // The second outfit should be the model-rejected diagnostic card
  const brokenOutfit = outfits.find(o => o.label.includes('Model forgot shoes'))
  assert.ok(brokenOutfit, 'Should include the model-rejected diagnostic outfit')
  assert.equal(brokenOutfit.broken, true)
  assert.equal(brokenOutfit.source, 'model-rejected')
  assert.equal(brokenOutfit.rejectionReason, 'structural: missing shoes')
})
