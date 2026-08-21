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
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')

const { app, db, userUploadsDir } = await import('../server.js')
const { resolveComfortFootwearConstraint, applyComfortFootwearRepair } = await import('../styling-engine/footwear-comfort.js')
const { generateWholeWardrobeOutfitsVisualInternal, generateOutfitsForPieceInternal } = await import('../routes/ai.js')
const { parsePiece } = await import('../db.js')
const { OCCASION_PROFILES } = await import('../styling-engine/occasions.js')

function resetTables() {
  for (const table of ['outfits', 'outfit_pieces', 'pieces', 'saved_boards', 'stylist_feedback']) {
    db.prepare(`DELETE FROM ${table}`).run()
  }
}

async function makeImage(filename, color = '#222222') {
  if (!fs.existsSync(userUploadsDir())) fs.mkdirSync(userUploadsDir(), { recursive: true })
  await sharp({
    create: { width: 120, height: 160, channels: 3, background: color }
  }).png().toFile(path.join(userUploadsDir(), filename))
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
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, fabric_weight, fiber_content, style_profile_json)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?)
  `).run('black tee', 'top', JSON.stringify(['black']), topPhoto, 'quiet dark neutral top', 'light', '["cotton"]', '{"coverage":"normal","bareness":"normal"}').lastInsertRowid

  const bottomId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, fabric_weight, fiber_content, style_profile_json)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?)
  `).run('blue jeans', 'bottom', JSON.stringify(['blue']), bottomPhoto, 'classic denim blue jeans bottom', 'light', '["cotton"]', '{"coverage":"normal","bareness":"normal"}').lastInsertRowid

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

  if (text.includes('personal visual stylist agent') || text.includes('whole-wardrobe outfit composer') || text.includes("personal stylist. You are looking at photos")) {
    return {
      outfits: [{
        label: 'Mock whole-wardrobe outfit',
        strength: 'signature',
        dominantDirection: 'structure with shoe',
        silhouette: 'controlled top over lower line',
        bestFor: 'evening',
        pieceIds: [seeded.top, seeded.bottom, seeded.sneaker],
        pieces: [
          { id: seeded.top, name: 'black tee', category: 'top' },
          { id: seeded.bottom, name: 'blue jeans', category: 'bottom' },
          { id: seeded.sneaker, name: 'canvas sneakers', category: 'shoes' }
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
    { mood: 'lots of walking', expectedMatch: false },
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

test('1b. Negated free-text activity does not activate walking or hiking constraints', () => {
  assert.equal(resolveComfortFootwearConstraint({
    request: 'Style this for warm weather. No special walking requirement.'
  }), null)
  assert.equal(resolveComfortFootwearConstraint({
    request: 'This does not need much walking.'
  }), null)
  assert.equal(resolveComfortFootwearConstraint({
    request: 'Dinner, not hiking.'
  }), null)

  assert.equal(
    resolveComfortFootwearConstraint({ request: 'No museum; lots of walking downtown.' })?.reason,
    'all-day walking comfort'
  )
  assert.equal(
    resolveComfortFootwearConstraint({ activity: 'walking', request: 'No special walking requirement.' })?.reason,
    'all-day walking comfort'
  )
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

test('4. walking remains de-conflated while city register ceiling is separate from comfort rules', () => {
  const walkProfile = OCCASION_PROFILES.find(p => p.id === 'walking')
  assert.equal(walkProfile, undefined, 'No walking occasion profile should be created in occasions.js')

  const cityProfile = OCCASION_PROFILES.find(p => p.id === 'city_smart_casual')
  assert.ok(cityProfile, 'City profile should exist')
  assert.equal(cityProfile.register_ceiling, 'elevated')
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

test('8. Plumbing: generateWholeWardrobeOutfitsVisualInternal propagates activity parameter', async () => {
  let capturedSystem = null
  let capturedMessages = null
  const defaultHandler = globalThis.__WARDROBE_AI_TEST_HANDLER__
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = (args) => {
    capturedSystem = args.system
    capturedMessages = args.messages
    return defaultHandler(args)
  }

  try {
    const result = await generateWholeWardrobeOutfitsVisualInternal({
      occasion: 'evening',
      season: 'current season',
      activity: 'walking',
      limit: 2
    })

    assert.ok(Array.isArray(result.structuredOutfits))

    assert.ok(capturedMessages, 'AI must have been called')
    const userText = Array.isArray(capturedMessages[0].content)
      ? capturedMessages[0].content.map(part => part?.text || '').join('\n')
      : String(capturedMessages[0].content || '')
    assert.ok(userText.includes('Activity: walking'), 'The prompt must contain Activity: walking')
    assert.ok(userText.includes('All-day walking: avoid stilettos, high heels, pumps, delicate sandals, and warm-weather boots'), 'The prompt must contain walking guidance')
  } finally {
    globalThis.__WARDROBE_AI_TEST_HANDLER__ = defaultHandler
  }
})

test('9. Whole-wardrobe clash critic drops a questionable outfit its own prose rationalized but the photos would not', async () => {
  // Two loud-pattern pieces in the same outfit is what makes this "questionable" enough to spend
  // the critic call on — see wholeWardrobeOutfitLooksQuestionable.
  db.prepare('UPDATE pieces SET pattern_complexity = ? WHERE id = ?').run('loud', seeded.top)
  db.prepare('UPDATE pieces SET pattern_complexity = ? WHERE id = ?').run('loud', seeded.bottom)

  const defaultHandler = globalThis.__WARDROBE_AI_TEST_HANDLER__
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = (args) => {
    const text = String(args.system || '')
    if (text.includes('second stylist reviewing outfits')) {
      return { flagged: [{ index: 0, reason: 'two competing prints fight in the photo despite the shared warm palette' }] }
    }
    return defaultHandler(args)
  }

  try {
    const result = await generateWholeWardrobeOutfitsVisualInternal({
      occasion: 'casual',
      season: 'current season',
      limit: 1
    })

    assert.ok(Array.isArray(result.structuredOutfits))
    // The critic's flag must actually remove the outfit from the model-accepted pool, whatever
    // the pipeline does afterward (backfill from local candidates, or a diagnostic card) to make
    // up the requested count — that downstream behavior is exercised by other tests.
    assert.equal(result.debug.finalSelection.visuallyRejectedCount, 1)
    assert.ok(result.debug.finalSelection.visualClashReview.flaggedCount >= 1)
    assert.deepEqual(result.debug.finalSelection.visuallyRejectedReasons, {
      'visual critic: two competing prints fight in the photo despite the shared warm palette': 1
    })
  } finally {
    globalThis.__WARDROBE_AI_TEST_HANDLER__ = defaultHandler
  }
})

test('9b. Whole-wardrobe clash critic leaves outfits alone when it does not flag anything', async () => {
  db.prepare('UPDATE pieces SET pattern_complexity = ? WHERE id = ?').run('loud', seeded.top)
  db.prepare('UPDATE pieces SET pattern_complexity = ? WHERE id = ?').run('loud', seeded.bottom)
  const result = await generateWholeWardrobeOutfitsVisualInternal({
    occasion: 'casual',
    season: 'current season',
    limit: 1
  })
  assert.equal(result.debug.finalSelection.visuallyRejectedCount, 0)
  assert.ok(result.structuredOutfits.some(outfit => !outfit.broken))
})

test('9c. Whole-wardrobe clash critic is skipped entirely for an outfit with no pattern-clash signal', async () => {
  const defaultHandler = globalThis.__WARDROBE_AI_TEST_HANDLER__
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = (args) => {
    const text = String(args.system || '')
    assert.ok(!text.includes('second stylist reviewing outfits'), 'the clash critic must not be called for a plain solid-color outfit')
    return defaultHandler(args)
  }
  try {
    const result = await generateWholeWardrobeOutfitsVisualInternal({
      occasion: 'casual',
      season: 'current season',
      limit: 1
    })
    assert.equal(result.debug.finalSelection.visualClashReview.reviewedCount, 0)
    assert.equal(result.debug.finalSelection.visualClashReview.skippedNotQuestionable, 1)
  } finally {
    globalThis.__WARDROBE_AI_TEST_HANDLER__ = defaultHandler
  }
})

test('bounded whole-wardrobe execution honors live weather and adaptive image sizing end to end', async () => {
  // Force one garment into the complex branch; the remaining photographed fixtures stay plain.
  db.prepare('UPDATE pieces SET formality = ?').run('everyday')
  db.prepare('UPDATE pieces SET pattern_complexity = ? WHERE id = ?').run('loud', seeded.top)
  const liveWeather = {
    isHot: false,
    isCold: false,
    highF: 78,
    lowF: 56,
    weatherSource: 'live'
  }

  const result = await generateWholeWardrobeOutfitsVisualInternal({
    occasion: 'casual',
    season: 'summer; mild weather; forecast high 78°F, low 56°F',
    mood: 'relaxed',
    activity: 'walking',
    question: 'Outdoor farmers market in Larkspur',
    limit: 2,
    resolvedWeatherProfile: liveWeather,
    adaptiveVisualDetail: true
  })

  assert.deepEqual(result.debug.weatherProfile, liveWeather)
  assert.equal(result.debug.weatherProfile.isHot, false, 'summer text must not override live 78°F physics')
  assert.equal(result.debug.adaptiveVisualDetail, true)
  assert.equal(result.debug.thumbPx, null)
  assert.ok((result.debug.imageSizeCounts['800'] || 0) >= 1, 'complex photographed pieces should receive 800px evidence')
  assert.ok((result.debug.imageSizeCounts['448'] || 0) >= 1, 'plain photographed pieces should receive 448px evidence')
  assert.equal(result.debug.imageSizeCounts['768'] || 0, 0, 'adaptive bounded execution must not silently use the fixed 768px path')
  assert.equal(
    Object.values(result.debug.imageSizeCounts).reduce((sum, count) => sum + count, 0),
    result.debug.shownPieceCount
  )
})

// docs/activity-and-roster-spec.md Part 1 — the activity must be able to become 'hiking'.
// Live case (thread_1786908272853): the model declared `walking` for a nature walk while its own
// prose said "if the trail has any rocky or uneven sections", and only the structured value reaches
// the gates. resolveActivityProfile used to return immediately on a supplied activity, so nothing
// downstream could correct it.
test('a nature walk escalates to hiking, and escalation is one-directional', async () => {
  const { resolveActivityProfile } = await import('../styling-engine/footwear-comfort.js')
  const id = opts => resolveActivityProfile(opts)?.id ?? null

  // Owner ruling 2026-08-17: "it's not climbing a mountain hike, but it's a hike."
  assert.equal(id({ activity: 'none', request: 'nature walk today at San Anselmo, CA' }), 'hiking')
  // The declared activity no longer ends the question — text may escalate it.
  assert.equal(id({ activity: 'walking', request: 'nature walk today at San Anselmo, CA' }), 'hiking')
  assert.equal(id({ activity: 'walking', request: 'a walk on the trail' }), 'hiking')

  // ONE-DIRECTIONAL: text may lift walking -> hiking, never lower hiking -> walking. The failure is
  // asymmetric — treating a city walk as a hike costs comfortable shoes nobody needed; treating a
  // hike as a city walk costs grip on a trail.
  assert.equal(id({ activity: 'hiking', request: 'a gentle walk around the city' }), 'hiking')
  assert.equal(id({ activity: 'walking', request: 'a walk around the city' }), 'walking')

  // An explicit denial blocks escalation (hasAffirmedActivityKeyword's negation handling).
  assert.equal(id({ activity: 'walking', request: 'just a gentle stroll on a paved path, no hiking' }), 'walking')

  // mood is the vibe axis, not an activity channel — unchanged.
  assert.equal(id({ activity: 'none', mood: 'lots of walking' }), null)
  assert.equal(id({ activity: 'none', request: 'dinner downtown' }), null)
})

// §5.4(2) + §5.0 — this app has per-user databases, so a rule may not assume a well-tagged wardrobe.
test('an activity tag requirement discourages rather than starves', async () => {
  const { profileRuleFit, getMergedProfileRules } = await import('../styling-engine/rules.js')
  const { resolveActivityProfile } = await import('../styling-engine/footwear-comfort.js')
  const { resolveOccasionProfile } = await import('../styling-engine/occasions.js')
  const op = resolveOccasionProfile('casual', '')
  const ap = resolveActivityProfile({ activity: 'hiking' })
  const merged = getMergedProfileRules(op, ap)
  const fit = piece => profileRuleFit(piece, merged, { weatherProfile: {}, occasionProfile: op, activityProfile: ap })

  const outdoorTop = { category: 'top', name: 'graphic tee', occasions: ['casual', 'outdoor'], formality: 'everyday' }
  // Cotton, not silk: hiking discourages silk on MATERIAL grounds, which reaches the piece first
  // and is the better reason. This fixture has to isolate the tag rule.
  const cityTop = { category: 'top', name: 'cotton city shell', occasions: ['city'], formality: 'everyday', fabric_category: 'cotton' }

  // Discouraged, NOT prohibited: a hard gate here would contradict the 2026-06-12 ratification that
  // a day dress stays allowed for outdoor-active, and would make the roster depend on how
  // thoroughly this particular user tagged their wardrobe.
  assert.notEqual(fit(outdoorTop).tier, 'discouraged')
  // The tag rule is the LAST word: it must not pre-empt a hard gate. An earlier revision returned
  // from it before the register ceiling and silently un-suppressed 45 elevated pieces in the
  // composer — measured against a recorded live run.
  const elevatedUntagged = { category: 'top', name: 'cotton blouse', occasions: ['city'], formality: 'dressy', fabric_category: 'cotton' }
  const withCeiling = profileRuleFit(elevatedUntagged, merged,
    { weatherProfile: {}, occasionProfile: op, activityProfile: ap, registerCeiling: 'everyday' })
  assert.equal(withCeiling.tier, 'prohibited', 'the register ceiling still wins over the tag discouragement')
  assert.match(withCeiling.label, /exceeds everyday ceiling/)
  assert.equal(fit(cityTop).tier, 'discouraged')
  assert.match(fit(cityTop).label, /not tagged for/)
  assert.notEqual(fit(cityTop).tier, 'prohibited', 'an untagged wardrobe must not be starved of tops')
})
