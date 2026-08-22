import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Isolated per-run DB (spec 21 Part 1) — this file used to import `db.js`
// statically, which meant it read/wrote the developer's real wardrobe.db.
// The env vars must land before `db.js` (and anything importing it, like
// rules.js) evaluates, so those imports are dynamic and come after this.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-hot-weather-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { db, parsePiece } = await import('../db.js')
const { seedDemoWardrobe } = await import('../demoWardrobe.js')
seedDemoWardrobe(db)
const { compatibilityScoreForSelectedItem, scoreWholeWardrobeCandidate, filterWholeWardrobePiecesForGeneration, wholeWardrobePieceTrustDecision, buildVisualComposerRoster, pieceOccasionCompatible, repairWholeWardrobeOutfit, weatherProfileFromContext, weatherFitForPiece, pieceHeatSuitability, pieceWeatherScores, getMergedProfileRules, profileRuleFit } = await import('../styling-engine/rules.js')
const { bottomKind, fabricWeight, pieceBareness, pieceCoverage, pieceFabricWeight, pieceWarmthTier, pieceHasOcclusiveFit, pieceFiberBreathability, pieceOcclusiveFitDegree } = await import('../styling-engine/attributes.js')
const { resolveOccasionProfile } = await import('../styling-engine/occasions.js')
const { resolveActivityProfile } = await import('../styling-engine/footwear-comfort.js')
const { ensureFixturePieces } = await import('./helpers/dbFixtures.js')

// These IDs mirror real pieces from the developer's personal wardrobe (the
// shapes this suite's regression tests are anchored on), seeded into this
// test's own isolated tmp DB rather than the developer's real wardrobe.db.
const cleanupHotWeatherFixtures = ensureFixturePieces([
  { id: 233, name: 'white octopus graphic t-shirt', category: 'top', status: 'active', occasions: '["casual"]', fabric_weight: 'light', formality: 'everyday', photo: 'fixture-233.jpg' },
  { id: 242, name: 'beige tailored linen shorts', category: 'bottom', status: 'active', occasions: '["casual"]', fabric_weight: 'light', reads_as: 'tailored linen shorts', formality: 'everyday', photo: 'fixture-242.jpg' },
  // A second hot-appropriate bottom so the ">= 2 hot-appropriate bottoms"
  // assertions hold on a DB whose only bottoms are these fixtures.
  { id: 700601, name: 'white cotton drawstring shorts', category: 'bottom', status: 'active', occasions: '["casual"]', fabric_weight: 'light', reads_as: 'cotton shorts', formality: 'everyday', photo: 'fixture-700601.jpg' },
  // Elevated suede ankle boots unsuitable for hiking on both heel/support
  // structure and register ceiling — the exact real-wardrobe piece this
  // suite's hiking-exclusion regression test is anchored on.
  { id: 200, name: 'taupe suede ankle boots', category: 'shoes', status: 'active', occasions: '["casual","city"]', formality: 'elevated', heel_height: 'low', walk_support: 'low', photo: 'fixture-200.jpg' },
  // Padding so the Visual Composer Roster test's category-cap/scoring path
  // (only reached once the survivor pool exceeds the production maxImages
  // default of 90) engages the same way it does against a real, large
  // wardrobe — deliberately NOT done by lowering maxImages in the test call,
  // since that would change the category quotas and could crowd the real
  // shorts fixtures out of a shrunk bottom-category cap in a real, large
  // wardrobe (verified: it did, in the real dev DB).
  ...Array.from({ length: 35 }, (_, i) => ({
    id: 700710 + i, name: `filler top ${i}`, category: 'top', status: 'active',
    occasions: '["casual"]', fabric_weight: 'light', formality: 'everyday', photo: `fixture-filler-top-${i}.jpg`
  })),
  ...Array.from({ length: 30 }, (_, i) => ({
    id: 700760 + i, name: `filler bottom ${i}`, category: 'bottom', status: 'active',
    occasions: '["casual"]', fabric_weight: 'medium', formality: 'everyday', photo: `fixture-filler-bottom-${i}.jpg`
  })),
  ...Array.from({ length: 15 }, (_, i) => ({
    id: 700800 + i, name: `filler shoes ${i}`, category: 'shoes', status: 'active',
    occasions: '["casual"]', heel_height: 'flat', walk_support: 'high', formality: 'everyday', photo: `fixture-filler-shoes-${i}.jpg`
  })),
  ...Array.from({ length: 12 }, (_, i) => ({
    id: 700820 + i, name: `filler dress ${i}`, category: 'dress', status: 'active',
    occasions: '["casual"]', fabric_weight: 'light', formality: 'everyday', photo: `fixture-filler-dress-${i}.jpg`
  }))
])
test.after(cleanupHotWeatherFixtures)

test('current season resolves to warm weather during June', () => {
  const june = weatherProfileFromContext({
    season: 'current season',
    currentDate: new Date('2026-06-15T12:00:00')
  })
  assert.equal(june.isHot, true)
  assert.equal(june.isCold, false)

  const january = weatherProfileFromContext({
    season: 'current season',
    currentDate: new Date('2026-01-15T12:00:00')
  })
  assert.equal(january.isHot, false)
  assert.equal(january.isCold, true)
})

test('weatherProfileFromContext and weatherFitForPiece handle numeric hot-weather ranges', () => {
  const weather = weatherProfileFromContext({ season: 'highs 80-90F and lows 54-60F' })
  assert.equal(weather.isHot, true)
  assert.equal(weather.isCold, false)

  const denim = { id: 1, name: 'Black Denim Jeans', category: 'bottom', fabric_category: 'denim', fabric_weight: 'heavy' }
  const linen = { id: 2, name: 'Linen Shorts', category: 'bottom', fabric_weight: 'light' }
  const denimFit = weatherFitForPiece(denim, weather)
  const linenFit = weatherFitForPiece(linen, weather)
  assert.ok(denimFit.score < 0)
  assert.equal(denimFit.label, 'heavy - too warm for the heat')
  assert.ok(linenFit.score > denimFit.score)
  assert.equal(linenFit.label, 'lightweight - good for heat')
})

test('weatherFitForPiece is neutral for shoes and accessories regardless of fabric_weight', () => {
  const cold = weatherProfileFromContext({ season: 'winter, 30F' })
  assert.equal(cold.isCold, true)
  const hot = weatherProfileFromContext({ season: 'highs 80-90F' })
  assert.equal(hot.isHot, true)

  // Real wardrobe data: "beige leather chunky heel sandals" is tagged fabric_weight: 'heavy' — a
  // real value describing shoe construction, not thermal insulation. Scoring it the same way as
  // a garment would rank an open-toe sandal as cold-weather-appropriate footwear.
  const heavySandal = { id: 1, name: 'chunky heel sandals', category: 'shoes', fabric_category: 'leather', fabric_weight: 'heavy' }
  const lightFlat = { id: 2, name: 'light canvas flats', category: 'shoes', fabric_weight: 'light' }
  const woolScarf = { id: 3, name: 'wool scarf', category: 'accessory', fabric_category: 'wool', fabric_weight: 'heavy', fiber_content: ['wool'] }

  for (const weather of [cold, hot]) {
    for (const piece of [heavySandal, lightFlat, woolScarf]) {
      const fit = weatherFitForPiece(piece, weather)
      assert.deepEqual(fit, { score: 0, label: 'neutral', adjustments: [] }, `${piece.name} in ${weather.isCold ? 'cold' : 'hot'} weather must be neutral`)
    }
  }

  // A garment in the same weight/material tier is unaffected — still scored normally.
  const woolSweater = { id: 4, name: 'wool sweater', category: 'top', fabric_category: 'wool', fabric_weight: 'heavy', fiber_content: ['wool'] }
  assert.ok(weatherFitForPiece(woolSweater, cold).score > 0)
  assert.ok(weatherFitForPiece(woolSweater, hot).score < 0)
})

test('weatherProfileFromContext treats indoor season as weather-agnostic even with hot mood text', () => {
  const hotMood = weatherProfileFromContext({ season: 'indoor', mood: 'hot date night vibes' })
  assert.deepEqual(hotMood, { isHot: false, isCold: false })

  const indoorOnly = weatherProfileFromContext({ season: 'indoor' })
  assert.deepEqual(indoorOnly, { isHot: false, isCold: false })
})

// --- Stated cool qualifiers beat season words (spec 24 Part 2) --------------
// Exact load-bearing fixtures from the spec: a bare season word ("summer")
// loses to a stated cool/foggy/rainy signal, but an explicit heat word keeps
// winning outright — the asymmetry is the point, and the third fixture pins
// it (must NOT regress to non-hot).

test('a bare season word loses to a stated cool signal: "cool coastal summer" is NOT hot (Point Reyes fog-walk miss)', () => {
  const profile = weatherProfileFromContext({ season: 'cool coastal summer' })
  assert.equal(profile.isHot, false)
  assert.equal(profile.isCold, true)
})

test('a bare season word loses to a stated cool/rain signal: "summer rain, cool mountain" is NOT hot, and rainy', () => {
  const profile = weatherProfileFromContext({ season: 'summer rain, cool mountain' })
  assert.equal(profile.isHot, false)
  assert.equal(profile.isCold, true)
  assert.equal(profile.isRainy, true)
})

test('an explicit heat word still wins over a cool qualifier: "hot days, cool evenings" stays hot (must not regress daytime slots)', () => {
  const profile = weatherProfileFromContext({ season: 'hot days, cool evenings' })
  assert.equal(profile.isHot, true)
  assert.equal(profile.isCold, false)
})

test('gate metadata helpers use structured fields without text guessing', () => {
  assert.equal(pieceFabricWeight({ fabric_weight: 'ultralight' }), 'light')

  const suggestiveNameOnly = {
    id: 7001,
    name: 'Sleeveless Wool Shell',
    category: 'top',
    reads_as: '',
    style_profile_json: {}
  }
  assert.equal(pieceFabricWeight(suggestiveNameOnly), null)
  assert.equal(pieceCoverage(suggestiveNameOnly), null)
  assert.equal(pieceBareness(suggestiveNameOnly), null)
})

test('hot visual roster excludes insulating fiber but keeps light wool gauze', () => {
  const woolShell = {
    id: 7101,
    name: 'cream wool shell',
    category: 'top',
    photo: 'img.jpg',
    fabric_weight: 'medium',
    fiber_content: ['wool'],
    sleeve_length: 'sleeveless'
  }
  const woolGauze = {
    id: 7102,
    name: 'light wool gauze tank',
    category: 'top',
    photo: 'img.jpg',
    fabric_weight: 'light',
    fiber_content: ['wool'],
    sleeve_length: 'sleeveless'
  }
  const res = buildVisualComposerRoster([woolShell, woolGauze], {
    occasion: 'travel',
    weatherProfile: { isHot: true, isCold: false },
    includeAccessories: true
  })
  assert.ok(res.excluded.some(item => item.pieceId === woolShell.id && item.reason === 'hot weather: insulating fiber'))
  assert.ok(res.roster.some(item => item.id === woolGauze.id))
})

test('active weather gate creates deduped metadata todos for missing fabric weight only when weather is active', () => {
  db.prepare("DELETE FROM todos WHERE type = 'metadata'").run()
  const insertedId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, status, photo, style_profile_json, fiber_content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('mystery summer top', 'top', '[]', '["casual"]', 'active', 'img.jpg', '{}', '["cotton"]').lastInsertRowid
  try {
    const missingWeight = parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(insertedId))

    const neutral = buildVisualComposerRoster([missingWeight], {
      occasion: 'travel',
      weatherProfile: null,
      includeAccessories: true
    })
    assert.ok(neutral.roster.some(item => item.id === missingWeight.id))
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM todos WHERE type = 'metadata'").get().count, 0)

    const hotOne = buildVisualComposerRoster([missingWeight], {
      occasion: 'travel',
      weatherProfile: { isHot: true, isCold: false },
      includeAccessories: true
    })
    assert.ok(hotOne.excluded.some(item => item.pieceId === missingWeight.id && item.reason === 'metadata missing: fabric_weight (weather gate active)'))
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM todos WHERE type = 'metadata' AND linked_piece_id = ? AND description LIKE ?").get(missingWeight.id, '%missing fabric_weight%').count, 1)

    buildVisualComposerRoster([missingWeight], {
      occasion: 'travel',
      weatherProfile: { isHot: true, isCold: false },
      includeAccessories: true
    })
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM todos WHERE type = 'metadata' AND linked_piece_id = ? AND description LIKE ?").get(missingWeight.id, '%missing fabric_weight%').count, 1)
  } finally {
    db.prepare('DELETE FROM todos WHERE linked_piece_id = ?').run(insertedId)
    db.prepare('DELETE FROM pieces WHERE id = ?').run(insertedId)
  }
})

test('activity footwear phrase lists no longer drive profileRuleFit hard gating', () => {
  const activityProfile = resolveActivityProfile({ activity: 'hiking' })
  const mergedRules = getMergedProfileRules(null, activityProfile)
  const heel = { id: 3, name: 'Black High Heel Pumps', category: 'shoes', occasions: ['casual'], reads_as: 'formal high heel pumps' }

  const fit = profileRuleFit(heel, mergedRules)
  assert.equal(fit.tier, 'neutral')

  const trust = wholeWardrobePieceTrustDecision(heel, { occasion: 'casual', activity: 'hiking' })
  assert.equal(trust.allowed, true)
  assert.equal(trust.reasons.some(reason => reason.includes('activity profile: prohibited footwear')), false)
})

test('Whale stripe tee hot weather recommendations include appropriate shorts/lightweight bottoms', () => {
  // Query all active pieces
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  
  const selectedPiece = allPieces.find(p => p.id === 1)
  assert.ok(selectedPiece, 'Whale stripe tee (ID 1) should exist')
  
  // Get bottom candidates for the top
  const candidates = allPieces.filter(p => p.id !== selectedPiece.id && p.category === 'bottom')
  
  const options = { occasion: 'casual', mood: 'it is really hot', weatherProfile: null }
  
  // Score and sort candidates
  const list = candidates.map(p => {
    const res = compatibilityScoreForSelectedItem(selectedPiece, p, options)
    return { piece: p, score: res.score, reasons: res.reasons || [] }
  })
  
  // Tie-breaker matches the sorting in the app
  const ranked = list.sort((a, b) => 
    b.score - a.score || 
    Number(b.piece.favorite) - Number(a.piece.favorite) || 
    String(a.piece.category).localeCompare(String(b.piece.category)) ||
    a.piece.id - b.piece.id
  )
  
  const top12 = ranked.slice(0, 12)
  const top12Ids = top12.map(x => x.piece.id)
  
  // 1. Assert beige tailored linen shorts (ID 242) is recommended in the top-12
  const hasBeigeShorts = top12Ids.includes(242)
  assert.ok(hasBeigeShorts, 'Beige tailored linen shorts (ID 242) must be in the top-12')
  
  // 2. Count shorts and lightweight skirts in the top-12
  const hotAppropriate = top12.filter(item => {
    const kind = bottomKind(item.piece)
    const weight = fabricWeight(item.piece)
    return kind === 'shorts' || kind === 'skirt-mini' || kind === 'skirt-midi' || weight === 'light'
  })
  
  assert.ok(hotAppropriate.length >= 2, `Should recommend >= 2 hot-appropriate bottoms, found ${hotAppropriate.length}`)
  
  // 3. Jeans carrying 'hot weather: insulating coverage' must not outnumber hot-appropriate bottoms
  const insulatingJeans = top12.filter(item => {
    const isInsulating = item.reasons.includes('hot weather: insulating coverage')
    const name = String(item.piece.name || '').toLowerCase()
    return isInsulating && (name.includes('jean') || name.includes('denim'))
  })
  
  assert.ok(insulatingJeans.length <= hotAppropriate.length, 
    `Insulating jeans (${insulatingJeans.length}) should not outnumber hot-appropriate bottoms (${hotAppropriate.length})`
  )
})

test('white octopus graphic t-shirt hot weather recommendations include appropriate shorts/lightweight bottoms', () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  
  const selectedPiece = allPieces.find(p => p.id === 233)
  assert.ok(selectedPiece, 'white octopus graphic t-shirt (ID 233) should exist')
  
  const candidates = allPieces.filter(p => p.id !== selectedPiece.id && p.category === 'bottom')
  
  const options = { occasion: 'casual', mood: 'it is really hot', weatherProfile: null }
  
  const list = candidates.map(p => {
    const res = compatibilityScoreForSelectedItem(selectedPiece, p, options)
    return { piece: p, score: res.score, reasons: res.reasons || [] }
  })
  
  const ranked = list.sort((a, b) => 
    b.score - a.score || 
    Number(b.piece.favorite) - Number(a.piece.favorite) || 
    String(a.piece.category).localeCompare(String(b.piece.category)) ||
    a.piece.id - b.piece.id
  )
  
  const top12 = ranked.slice(0, 12)
  const top12Ids = top12.map(x => x.piece.id)
  
  // Assert beige tailored linen shorts (ID 242) is recommended in the top-12
  const hasBeigeShorts = top12Ids.includes(242)
  assert.ok(hasBeigeShorts, 'Beige tailored linen shorts (ID 242) must be in the top-12 for graphic t-shirt')
  
  // Count shorts and lightweight skirts in the top-12
  const hotAppropriate = top12.filter(item => {
    const kind = bottomKind(item.piece)
    const weight = fabricWeight(item.piece)
    return kind === 'shorts' || kind === 'skirt-mini' || kind === 'skirt-midi' || weight === 'light'
  })
  
  assert.ok(hotAppropriate.length >= 2, `Should recommend >= 2 hot-appropriate bottoms, found ${hotAppropriate.length}`)
  
  // Jeans carrying 'hot weather: insulating coverage' must not outnumber hot-appropriate bottoms
  const insulatingJeans = top12.filter(item => {
    const isInsulating = item.reasons.includes('hot weather: insulating coverage')
    const name = String(item.piece.name || '').toLowerCase()
    return isInsulating && (name.includes('jean') || name.includes('denim'))
  })
  
  assert.ok(insulatingJeans.length <= hotAppropriate.length, 
    `Insulating jeans (${insulatingJeans.length}) should not outnumber hot-appropriate bottoms (${hotAppropriate.length})`
  )
})

test('scoreWholeWardrobeCandidate applies weather penalties and boosts correctly', () => {
  const heavyTurtleneck = { id: 1001, name: 'Heavy Turtleneck', category: 'top', fabric_weight: 'heavy', sleeve_length: 'long' }
  const heavyJeans = { id: 1002, name: 'Heavy Jeans', category: 'bottom', fabric_weight: 'heavy', style_profile_json: { bottom_kind: 'pants' } }
  const lightShorts = { id: 1003, name: 'Linen Shorts', category: 'bottom', fabric_weight: 'light', style_profile_json: { bottom_kind: 'shorts' } }

  const hotOptions = { mood: 'it is really hot', season: 'current season' }

  // 1. Heavy fabrics should be penalized in hot weather. Coverage no longer scores as its own
  // independent term (consolidated into pieceWarmthTier — see attributes.js): heavyTurtleneck's
  // directly-tagged fabric_weight: 'heavy' is authoritative on its own, so its long sleeves add no
  // separate "insulating coverage" penalty on top of the fabric-weight one.
  const heavyRes = scoreWholeWardrobeCandidate([heavyTurtleneck, heavyJeans], hotOptions)
  assert.ok(heavyRes.reasons.includes('hot weather: heavy fabric'), 'Must penalize heavy fabric')

  // 2. Light fabrics should be boosted in hot weather
  const lightRes = scoreWholeWardrobeCandidate([lightShorts], hotOptions)
  assert.ok(lightRes.reasons.includes('hot weather: lightweight fabric'), 'Must boost lightweight fabric')
})

test('scoreWholeWardrobeCandidate flags a heavy/insulating top paired with sandals on a day that is neither isHot nor isCold', () => {
  // Anchored on the real "Emerald Ground" incident: a live 76.4°F/57.3°F forecast reads as
  // neither isHot (>=80) nor isCold (<=45), so weatherFitForPiece never runs for it at all —
  // olive textured mock neck top + emerald corduroy pants + brown leather strap sandals sailed
  // through with zero warmth-consistency signal.
  const mildOptions = { weatherProfile: { isHot: false, isCold: false, highF: 76.4, lowF: 57.3 } }
  const knitTop = { id: 2001, name: 'olive textured mock neck top', category: 'top', fabric_weight: 'medium', fiber_content: ['wool'] }
  const corduroyPants = { id: 2002, name: 'emerald corduroy pants', category: 'bottom', fabric_weight: 'medium' }
  const strapSandals = { id: 2003, name: 'brown leather strap sandals', category: 'shoes' }

  const mismatched = scoreWholeWardrobeCandidate([knitTop, corduroyPants, strapSandals], mildOptions)
  assert.ok(
    mismatched.reasons.some(r => r.includes('heavy/insulating piece paired with bare warm-weather footwear')),
    `expected a warmth-consistency penalty, got reasons: ${mismatched.reasons.join('; ')}`
  )

  // A closed, non-bare shoe with the same top/bottom is not a contradiction — no penalty.
  const closedShoe = { id: 2004, name: 'brown leather loafers', category: 'shoes' }
  const consistent = scoreWholeWardrobeCandidate([knitTop, corduroyPants, closedShoe], mildOptions)
  assert.ok(
    !consistent.reasons.some(r => r.includes('bare warm-weather footwear')),
    `closed shoes must not trigger the check, got reasons: ${consistent.reasons.join('; ')}`
  )

  // A light, non-insulating top with sandals is a consistent warm-weather outfit — no penalty.
  const lightTop = { id: 2005, name: 'white cotton tee', category: 'top', fabric_weight: 'light' }
  const consistentWarm = scoreWholeWardrobeCandidate([lightTop, corduroyPants, strapSandals], mildOptions)
  assert.ok(
    !consistentWarm.reasons.some(r => r.includes('bare warm-weather footwear')),
    `light top + sandals must not trigger the check, got reasons: ${consistentWarm.reasons.join('; ')}`
  )

  // Cold days are exempt — a warm layer with sandals is a different (already-covered) problem.
  const coldOptions = { weatherProfile: { isHot: false, isCold: true, highF: 40, lowF: 28 } }
  const coldException = scoreWholeWardrobeCandidate([knitTop, corduroyPants, strapSandals], coldOptions)
  assert.ok(
    !coldException.reasons.some(r => r.includes('bare warm-weather footwear')),
    `cold weather must not trigger this specific check, got reasons: ${coldException.reasons.join('; ')}`
  )
})

test('scoreWholeWardrobeCandidate applies occasion mismatch penalty and outerwear hot-weather penalty correctly', () => {
  const casualOptions = { occasion: 'casual', mood: 'very hot outside', season: 'current season' }
  const eveningHeels = { id: 1004, name: 'Evening Heels', category: 'shoes', occasions: ['evening'] }
  const lightShorts = { id: 1003, name: 'Linen Shorts', category: 'bottom', fabric_weight: 'light', style_profile_json: { bottom_kind: 'shorts' } }
  const cardigan = { id: 1005, name: 'Light Cardigan', category: 'outerwear', fabric_weight: 'light' }

  // 1. Mismatching occasion (evening shoes for casual) gets a strong -60 penalty
  const occasionRes = scoreWholeWardrobeCandidate([eveningHeels, lightShorts], casualOptions)
  assert.ok(occasionRes.reasons.includes('Evening Heels is unsuitable for casual occasion'), 'Must apply occasion mismatch penalty')
  
  // 2. Outerwear gets a -30 penalty in hot weather
  const outerwearRes = scoreWholeWardrobeCandidate([lightShorts, cardigan], casualOptions)
  assert.ok(outerwearRes.reasons.includes('hot weather: penalize outerwear/layering'), 'Must apply outerwear penalty in hot weather')
})

test('filterWholeWardrobePiecesForGeneration and wholeWardrobePieceTrustDecision weather-aware filtering', () => {
  const pHeavy = { id: 9001, name: 'Heavy Wool Coat', category: 'outerwear', fabric_weight: 'heavy' }
  const pShorts = { id: 9002, name: 'Linen Shorts', category: 'bottom', fabric_weight: 'light', style_profile_json: { bottom_kind: 'shorts' } }
  const pLight = { id: 9003, name: 'Linen Shirt', category: 'top', fabric_weight: 'light' }
  const allPieces = [pHeavy, pShorts, pLight]

  // 1. Unfiltered / neutral weather
  const resNeutral = filterWholeWardrobePiecesForGeneration(allPieces, { weatherProfile: { isHot: false, isCold: false } })
  assert.equal(resNeutral.allowedPieces.length, 3, 'Should allow all pieces in neutral weather')

  // 2. Hot weather
  const resHot = filterWholeWardrobePiecesForGeneration(allPieces, { weatherProfile: { isHot: true, isCold: false } })
  const allowedHotIds = resHot.allowedPieces.map(p => p.id)
  assert.ok(!allowedHotIds.includes(9001), 'Heavy piece should be suppressed in hot weather')
  assert.ok(allowedHotIds.includes(9002), 'Shorts should be allowed in hot weather')
  assert.ok(allowedHotIds.includes(9003), 'Light shirt should be allowed in hot weather')
  
  const suppressedHeavy = resHot.suppressedPieces.find(p => p.id === 9001)
  assert.ok(suppressedHeavy, 'Heavy piece should be in suppressed list')
  assert.ok(suppressedHeavy.reasons.includes('hot weather: insulating piece'), 'Should have hot weather reason')

  // 3. Cold weather
  const resCold = filterWholeWardrobePiecesForGeneration(allPieces, { weatherProfile: { isHot: false, isCold: true } })
  const allowedColdIds = resCold.allowedPieces.map(p => p.id)
  assert.ok(!allowedColdIds.includes(9002), 'Shorts should be suppressed in cold weather')
  assert.ok(allowedColdIds.includes(9001), 'Coat should be allowed in cold weather')
  
  const suppressedShorts = resCold.suppressedPieces.find(p => p.id === 9002)
  assert.ok(suppressedShorts, 'Shorts should be in suppressed list')
  assert.ok(suppressedShorts.reasons.includes('cold weather: shorts'), 'Should have cold weather reason')
})

test('wet-exposure footwear gate uses structured material plus weather, environment, and activity', () => {
  const canvasSneakers = {
    id: 9010,
    name: 'ordinary casual sneakers',
    category: 'shoes',
    fabric_category: 'canvas',
    fiber_content: ['cotton'],
    heel_height: 'flat',
    walk_support: 'high',
  }
  const leatherSneakers = {
    ...canvasSneakers,
    id: 9011,
    name: 'weather-ready casual sneakers',
    fabric_category: 'leather',
    fiber_content: ['leather'],
  }

  const pointReyes = weatherProfileFromContext({
    mood: 'Point Reyes foggy beach walk',
    season: 'cool coastal summer',
  })
  assert.equal(pointReyes.isWetExposure, true)
  assert.equal(wholeWardrobePieceTrustDecision(canvasSneakers, {
    occasion: 'casual', activity: 'walking', weatherProfile: pointReyes,
  }).allowed, false)
  assert.equal(wholeWardrobePieceTrustDecision(leatherSneakers, {
    occasion: 'casual', activity: 'walking', weatherProfile: pointReyes,
  }).allowed, true)

  const ordinaryFog = weatherProfileFromContext({ mood: 'foggy city museum visit', season: 'cool' })
  assert.equal(ordinaryFog.isWetExposure, false, 'fog without coastal outdoor exposure is not a wet-footwear gate')
  assert.equal(wholeWardrobePieceTrustDecision(canvasSneakers, {
    occasion: 'city', weatherProfile: ordinaryFog,
  }).allowed, true)

  const dryWalk = weatherProfileFromContext({ mood: 'dry sunny beach walk', season: 'mild' })
  assert.equal(dryWalk.isWetExposure, false)
  assert.equal(wholeWardrobePieceTrustDecision(canvasSneakers, {
    occasion: 'casual', activity: 'walking', weatherProfile: dryWalk,
  }).allowed, true)
})

test('hot weather does not block normal medium-weight summer pants (composer parity)', () => {
  const hot = { occasion: 'casual', weatherProfile: { isHot: true, isCold: false } }

  // The live false positive: medium cotton cropped cargo pants are summer clothing.
  const cottonCargos = {
    id: 9101, name: 'blue cargo cropped pants', category: 'bottom',
    fabric_weight: 'medium', fabric_category: 'cotton', fiber_content: ['cotton'],
    style_profile_json: { coverage: 'normal' }
  }
  const resCargos = wholeWardrobePieceTrustDecision(cottonCargos, hot)
  assert.equal(resCargos.reasons.includes('hot weather: insulating piece'), false,
    'medium cotton pants must not be called insulating in hot weather')

  // Genuinely warm bottoms stay blocked.
  const heavyPants = { id: 9102, name: 'heavy canvas work pants', category: 'bottom', fabric_weight: 'heavy', style_profile_json: { coverage: 'normal' } }
  assert.ok(wholeWardrobePieceTrustDecision(heavyPants, hot).reasons.includes('hot weather: insulating piece'),
    'heavy pants remain blocked via the heavy-weight check')

  const woolTrousers = { id: 9103, name: 'wool trousers', category: 'bottom', fabric_weight: 'medium', fabric_category: 'wool', fiber_content: ['wool'], style_profile_json: { coverage: 'normal' } }
  assert.ok(wholeWardrobePieceTrustDecision(woolTrousers, hot).reasons.includes('hot weather: insulating fiber'),
    'warm-fiber pants remain blocked via the fiber check')

  const insulatedLeggings = { id: 9104, name: 'fleece-lined leggings', category: 'bottom', fabric_weight: 'medium', length_hits_at: 'full-length' }
  assert.ok(wholeWardrobePieceTrustDecision(insulatedLeggings, hot).reasons.includes('hot weather: insulating piece'),
    'full-coverage medium bottoms (derived full-insulating) remain blocked')
})

test('Visual Composer Roster weather-aware ranking and tiebreaker rotation', () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  
  // 1. Hot weather Visual Composer Roster check
  const hotRosterRes = buildVisualComposerRoster(allPieces, {
    occasion: 'travel',
    weatherProfile: { isHot: true, isCold: false }
  })

  const bottomShorts = hotRosterRes.roster.filter(p => p.category === 'bottom' && bottomKind(p) === 'shorts')
  assert.ok(bottomShorts.length >= 2, `Should have at least 2 shorts in hot weather visual composer bottoms, found ${bottomShorts.length}`)

  // Verify debug relevance adjustments exist and contain reasons for the shorts
  assert.ok(hotRosterRes.debug.relevanceAdjustments, 'relevanceAdjustments debug object should exist')
  for (const s of bottomShorts) {
    const adj = hotRosterRes.debug.relevanceAdjustments[s.id]
    assert.ok(adj && adj.some(r => r.includes('hot weather: shorts')), 'Should log hot weather shorts adjustment in debug')
  }

  // 2. Empty/Neutral weather no-op check: must be identical
  const emptyRosterRes = buildVisualComposerRoster(allPieces, {
    occasion: 'travel',
    weatherProfile: {}
  })
  const noWeatherRosterRes = buildVisualComposerRoster(allPieces, {
    occasion: 'travel',
    weatherProfile: null
  })
  
  const emptyIds = emptyRosterRes.roster.map(p => p.id)
  const noWeatherIds = noWeatherRosterRes.roster.map(p => p.id)
  assert.deepEqual(emptyIds, noWeatherIds, 'Roster output must be identical with empty vs null weatherProfile (no-op)')
})

test('resolveActivityProfile matches hiking and filters prohibited items', () => {
  const profile = resolveActivityProfile({ occasion: 'travel', request: 'hiking on a very hot day' })
  assert.ok(profile, 'Should resolve a profile')
  assert.equal(profile.id, 'hiking', 'Should match hiking')

  const silkTop = { id: 9901, name: 'Silk Top', category: 'top', reads_as: 'flowing silk top' }
  const muleShoes = { id: 9902, name: 'Black Mules', category: 'shoes', reads_as: 'casual slide mules' }
  const sneakers = { id: 9903, name: 'White Sneakers', category: 'shoes', reads_as: 'comfortable leather sneakers' }
  const cottonTee = { id: 9904, name: 'Cotton Tee', category: 'top', reads_as: 'plain cotton t-shirt' }

  const blackBlouse = { id: 9905, name: 'Black Blouse', category: 'top', reads_as: 'dressy crepe blouse' }

  // 1. Discouraged material (silk) should be allowed in trust decision, but carry score penalty
  const resSilk = wholeWardrobePieceTrustDecision(silkTop, { occasion: 'travel', request: 'hiking on a very hot day' })
  assert.equal(resSilk.allowed, true, 'Silk top should be allowed by trust decision (soft discouraged)')
  const scoredSilk = scoreWholeWardrobeCandidate([silkTop], { occasion: 'travel', request: 'hiking on a very hot day' })
  assert.ok(scoredSilk.reasons.includes('activity profile: discouraged material (silk)'), 'Should penalize discouraged material')

  // 2. Activity discouraged footwear phrase lists are prompt/repair vocabulary only, not scoring.
  const resMules = wholeWardrobePieceTrustDecision(muleShoes, { occasion: 'travel', request: 'hiking on a very hot day' })
  assert.equal(resMules.allowed, true, 'Mule shoes should be allowed by trust decision')
  const scoredMules = scoreWholeWardrobeCandidate([muleShoes], { occasion: 'travel', request: 'hiking on a very hot day' })
  const hasMulePenalty = scoredMules.reasons.includes('activity profile: discouraged footwear (mule)') ||
                         scoredMules.reasons.includes('activity profile: discouraged footwear (mules)');
  assert.equal(hasMulePenalty, false, 'Should not penalize activity footwear phrase lists')

  // 3. Sneakers should be allowed
  const resSneakers = wholeWardrobePieceTrustDecision(sneakers, { occasion: 'travel', request: 'hiking on a very hot day' })
  assert.equal(resSneakers.allowed, true, 'Sneakers should be allowed')

  // 4. Discouraged piece (blouse) should be allowed in trust decision, but carry score penalty
  const resBlouse = wholeWardrobePieceTrustDecision(blackBlouse, { occasion: 'travel', request: 'hiking on a very hot day' })
  assert.equal(resBlouse.allowed, true, 'Blouse should be allowed by trust decision (soft discouraged)')
  const scoredBlouse = scoreWholeWardrobeCandidate([blackBlouse], { occasion: 'travel', request: 'hiking on a very hot day' })
  assert.ok(scoredBlouse.reasons.includes('activity profile: discouraged piece (blouse)'), 'Should penalize discouraged piece')

  // 5. Preferred items should receive boosts in scoreWholeWardrobeCandidate
  const scored = scoreWholeWardrobeCandidate([sneakers, cottonTee], { occasion: 'travel', request: 'hiking on a very hot day' })
  assert.ok(scored.reasons.includes('activity profile: preferred material (cotton)'), 'Should boost cotton')
  assert.equal(scored.reasons.includes('activity profile: preferred footwear (sneakers)'), false, 'Should not boost activity footwear phrase lists')

  // 6. Test pieceOccasionCompatible normalization with dashes and underscores
  const athleticShoes = { id: 9906, name: 'Athletic Shoes', category: 'shoes', occasions: ['casual', 'outdoor', 'city'] }
  assert.equal(pieceOccasionCompatible(athleticShoes, 'outdoor_active'), true, 'Should match outdoor_active profile id with underscores')
  assert.equal(pieceOccasionCompatible(athleticShoes, 'outdoor-active'), true, 'Should match outdoor-active with dashes')
  assert.equal(pieceOccasionCompatible(athleticShoes, 'outdoor active'), true, 'Should match outdoor active with spaces')

  const smartCasualTop = { id: 9907, name: 'Silk Shell', category: 'top', occasions: ['smart casual'] }
  const eveningTop = { id: 9908, name: 'Sequined Top', category: 'top', occasions: ['evening'] }
  const mixedElevatedTop = { id: 9909, name: 'Satin Blouse', category: 'top', occasions: ['smart casual', 'evening'] }
  const outdoorTop = { id: 9910, name: 'Linen Camp Shirt', category: 'top', occasions: ['outdoor'] }
  const casualTop = { id: 9911, name: 'Cotton Tee', category: 'top', occasions: ['casual'] }
  assert.equal(pieceOccasionCompatible(smartCasualTop, 'casual'), true, 'Smart casual pieces should be casual-adjacent')
  assert.equal(pieceOccasionCompatible(eveningTop, 'casual'), false, 'Evening-only pieces should remain incompatible with casual')
  assert.equal(pieceOccasionCompatible(mixedElevatedTop, 'casual'), true, 'Mixed smart casual/evening pieces should be casual-adjacent through smart casual')
  assert.equal(pieceOccasionCompatible(eveningTop, 'gallery / art event'), true, 'Gallery/art event occasion compatibility should remain unchanged')
  assert.equal(pieceOccasionCompatible(outdoorTop, 'outdoor_daytime_social'), true, 'Outdoor daytime social should accept outdoor pieces')
  assert.equal(pieceOccasionCompatible(smartCasualTop, 'outdoor_daytime_social'), true, 'Outdoor daytime social should accept elevated daytime pieces')
  assert.equal(pieceOccasionCompatible(casualTop, 'outdoor_daytime_social'), false, 'Outdoor daytime social should not flatten to every casual piece')
})

test('outdoor_active rules resolved via activity and discourages day dresses, day skirts, and casual/fashion sandals (regression test)', () => {
  const options = { occasion: 'casual', request: 'hiking on a very hot day' }

  // 1. Midi dress should be allowed in trust decision but discouraged in scoring (revised: Yuna 2026-06-12 ratification revision)
  const midiDress = { id: 9910, name: 'green button down midi dress', category: 'dress', reads_as: 'button-up midi dress' }
  const resDress = wholeWardrobePieceTrustDecision(midiDress, options)
  assert.equal(resDress.allowed, true, 'Midi dress should be allowed in trust decision (revised: Yuna 2026-06-12 ratification revision)')
  const scoreDress = scoreWholeWardrobeCandidate([midiDress], options)
  assert.ok(scoreDress.reasons.includes('activity profile: discouraged piece (dress)'), 'Should report discouraged piece (dress)')

  // 2. Wedge sandal phrase matching is no longer a hard gate; structured heel/support fields own this.
  const wedgeSandals = { id: 9911, name: 'black stitched wedge sandals', category: 'shoes', reads_as: 'black wedge sandals' }
  const resWedge = wholeWardrobePieceTrustDecision(wedgeSandals, options)
  assert.equal(resWedge.allowed, true, 'Wedge sandals should not be prohibited by activity footwear phrases')
  assert.equal(resWedge.reasons.some(r => r.includes('prohibited footwear (wedge)')), false, 'Should not report prohibited footwear phrase')

  // 3. Tiered skirt should be allowed in trust decision but discouraged in scoring (revised: Yuna 2026-06-12 ratification revision)
  const tieredSkirt = { id: 9912, name: 'black cream botanical tiered midi skirt', category: 'bottom', reads_as: 'botanical tiered midi skirt' }
  const resSkirt = wholeWardrobePieceTrustDecision(tieredSkirt, options)
  assert.equal(resSkirt.allowed, true, 'Tiered skirt should be allowed in trust decision (revised: Yuna 2026-06-12 ratification revision)')
  const scoreSkirt = scoreWholeWardrobeCandidate([tieredSkirt], options)
  assert.ok(scoreSkirt.reasons.includes('activity profile: discouraged piece (skirt)'), 'Should report discouraged piece (skirt)')

  // 4. Flat leather strap sandal phrases should not be scored by activity phrase lists
  const leatherSandals = { id: 9913, name: 'brown leather strap sandals', category: 'shoes', reads_as: 'versatile casual sandal' }
  const resSandal = wholeWardrobePieceTrustDecision(leatherSandals, options)
  assert.equal(resSandal.allowed, true, 'Casual sandals should be allowed in trust decision')
  const scoreSandal = scoreWholeWardrobeCandidate([leatherSandals], options)
  assert.equal(scoreSandal.reasons.includes('activity profile: discouraged footwear (sandal)'), false, 'Should not report activity footwear phrase scoring')

  // 5. Medium/heavy FULL-COVERAGE bottoms should be prohibited in hot weather (hard weather filter).
  // 2026-07-12: previously this piece was "slim crop jeans" with a style_profile coverage field that
  // pieceCoverage() never reads — it only passed because ANY medium pants were hot-blocked, the same
  // overreach that rejected the user's cropped cotton cargos live. Owner ruling: cropped/medium summer
  // pants pass; full-length medium bottoms (derived full-insulating coverage) stay blocked.
  const whiteJeans = { id: 9914, name: 'white slim jeans', category: 'bottom', fabric_weight: 'medium', reads_as: 'slim full-length jeans', length_hits_at: 'full-length' }
  const resJeans = wholeWardrobePieceTrustDecision(whiteJeans, { ...options, weatherProfile: { isHot: true, isCold: false } })
  assert.equal(resJeans.allowed, false, 'Full-length medium jeans should be prohibited in hot weather')
  assert.ok(resJeans.reasons.includes('hot weather: insulating piece'), 'Should report hot weather: insulating piece')

  const cropJeans = { id: 9915, name: 'white slim crop jeans', category: 'bottom', fabric_weight: 'medium', reads_as: 'slim cropped jeans', length_hits_at: 'midi' }
  const resCrop = wholeWardrobePieceTrustDecision(cropJeans, { ...options, weatherProfile: { isHot: true, isCold: false } })
  assert.equal(resCrop.allowed, true, 'Cropped medium jeans are normal summer wear and must pass the hot gate')
})

test('Trail active outdoor profile additional constraints and repair tests', () => {
  // Test 1: Trust decision for skort and shorts (allowed) - ratified: Yuna 2026-06-12
  const skort = { id: 9920, name: 'active sports skort', category: 'bottom', reads_as: 'cotton blend active skort' }
  const shorts = { id: 9921, name: 'active utility shorts', category: 'bottom', reads_as: 'utility shorts' }
  const options = { occasion: 'casual', request: 'hiking' }
  
  const resSkort = wholeWardrobePieceTrustDecision(skort, options)
  assert.equal(resSkort.allowed, true, 'Skort should be allowed on trail')
  const resShorts = wholeWardrobePieceTrustDecision(shorts, options)
  assert.equal(resShorts.allowed, true, 'Shorts should be allowed on trail')

  // Test 2: Warm boots and suede penalty in scoring
  const ankleBoots = { id: 9922, name: 'leather ankle boots', category: 'shoes', reads_as: 'warm leather ankle boots' }
  const suedeSneakers = { id: 9923, name: 'suede sneakers', category: 'shoes', reads_as: 'suede athletic sneakers' }

  // Hot weather -> boot phrase list no longer scores; structured footwear gate owns activity suitability.
  const scoredBootsHot = scoreWholeWardrobeCandidate([ankleBoots], { occasion: 'casual', request: 'hiking on a hot day' })
  assert.equal(scoredBootsHot.reasons.includes('activity profile: discouraged footwear (ankle boots)'), false, 'Boot phrase list should not score in heat')
  
  // Normal weather -> boots not discouraged
  const scoredBootsNormal = scoreWholeWardrobeCandidate([ankleBoots], { occasion: 'casual', request: 'hiking' })
  assert.ok(!scoredBootsNormal.reasons.includes('activity profile: discouraged footwear (ankle boots)'), 'Boots should not be discouraged in cool weather')

  // Suede -> penalized regardless of weather
  const scoredSuedeNormal = scoreWholeWardrobeCandidate([suedeSneakers], { occasion: 'casual', request: 'hiking' })
  assert.ok(scoredSuedeNormal.reasons.includes('activity profile: discouraged material (suede)'), 'Suede should be discouraged in all weather')

  // Test 3: Taupe suede ankle boots piece ID 200 is absent from the hiking pre-roster pool AND
  // the hiking visual roster (spec 8, 2026-07-09: filterWholeWardrobePiecesForGeneration is now a
  // real gate everywhere, not a broad diagnostic-only pool — closes the gap where
  // composeOutfitSet (styling-engine/outfitSetPlanner.js, née buildLocalTripSlotOutfits)/the `/ask` fallback tier had no downstream re-gate to catch what this
  // pre-filter let through unfiltered).
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const allowedRes = filterWholeWardrobePiecesForGeneration(allPieces, { occasion: 'casual', request: 'hiking' })
  const allowedIds = allowedRes.allowedPieces.map(p => Number(p.id))
  assert.ok(!allowedIds.includes(200), 'Taupe suede ankle boots (ID 200) must be excluded from the hiking pre-roster pool')
  assert.match(
    allowedRes.suppressedPieces.find(item => Number(item.id) === 200)?.reasons.join(' ') || '',
    /heel unsuitable|support unsuitable/
  )
  // buildVisualComposerRoster's own independent gate (defense in depth, not relying on the
  // pre-filter above) also excludes it when given the full, unfiltered pool directly — here the
  // register-ceiling check catches it first (formality: elevated exceeds hiking's "everyday"
  // ceiling), ahead of the footwear-enum check that caught it in the pre-filter above.
  const hikingRoster = buildVisualComposerRoster(allPieces, {
    occasion: 'casual',
    activity: 'hiking',
    maxImages: 90
  })
  const hikingRosterIds = hikingRoster.roster.map(p => Number(p.id))
  assert.ok(!hikingRosterIds.includes(200), 'Taupe suede ankle boots (ID 200) must be absent from the hiking visual roster')
  assert.match(
    hikingRoster.excluded.find(item => Number(item.pieceId) === 200)?.reason || '',
    /^register: .* exceeds .* ceiling|^footwear: .* unsuitable for Hiking \/ Outdoor active|^activity: not tagged for Hiking \/ Outdoor active/
  )

  // Test 6: Footwear Gate and Repair
  // An outfit composed with canvas slip-ons is repaired to sneakers when sneakers are allowed
  const testPool = [
    { id: 10, name: 'Cotton Tee', category: 'top', reads_as: 'cotton tee shirt' },
    { id: 20, name: 'Linen Shorts', category: 'bottom', reads_as: 'linen shorts' },
    { id: 30, name: 'Canvas Slip-ons', category: 'shoes', reads_as: 'canvas slip-on loafers' },
    { id: 40, name: 'Trail Sneakers', category: 'shoes', reads_as: 'trail running sneakers', occasions: ['casual', 'outdoor'] }
  ]
  const mockOutfit = {
    label: 'Test Outfit',
    pieceIds: [10, 20, 30]
  }
  const repaired = repairWholeWardrobeOutfit(mockOutfit, testPool, 'casual', '', { activity: 'hiking' })
  assert.ok(repaired.pieceIds.includes(40), 'Should repair shoe to trail sneakers')
  assert.ok(!repaired.pieceIds.includes(30), 'Should swap out canvas slip-ons')

  // When no trail-capable shoe is in the pool, keep it but append watchFor warning
  const testPoolNoShoes = [
    { id: 10, name: 'Cotton Tee', category: 'top', reads_as: 'cotton tee shirt' },
    { id: 20, name: 'Linen Shorts', category: 'bottom', reads_as: 'linen shorts' },
    { id: 30, name: 'Canvas Slip-ons', category: 'shoes', reads_as: 'canvas slip-on loafers' }
  ]
  const repairedNoShoes = repairWholeWardrobeOutfit(mockOutfit, testPoolNoShoes, 'casual', '', { activity: 'hiking' })
  assert.ok(repairedNoShoes.pieceIds.includes(30), 'Should keep canvas slip-ons if no alternative exists')
  assert.ok(repairedNoShoes.watchFor.includes('footwear is not trail-rated — closest available match.'), 'Should append warning to watchFor')
})

test('pieceWarmthTier: fabric_weight + insulating fiber, the same two signals weatherFitForPiece weighs', () => {
  assert.equal(pieceWarmthTier({ fabric_weight: 'light', fiber_content: ['cotton'] }), 'light')
  assert.equal(pieceWarmthTier({ fabric_weight: 'medium', fiber_content: ['cotton'] }), 'medium')
  assert.equal(pieceWarmthTier({ fabric_weight: 'heavy', fiber_content: ['cotton'] }), 'heavy')
  // An insulating fiber bumps light up one tier — a lightweight wool knit still runs warmer
  // than a lightweight cotton one — but does not push past 'heavy'.
  assert.equal(pieceWarmthTier({ fabric_weight: 'light', fiber_content: ['wool'] }), 'medium')
  assert.equal(pieceWarmthTier({ fabric_weight: 'medium', fiber_content: ['cashmere'] }), 'heavy')
  assert.equal(pieceWarmthTier({ fabric_weight: 'heavy', fiber_content: ['wool'] }), 'heavy')
  // No fabric_weight tag but an insulating fiber is still a real warmth signal.
  assert.equal(pieceWarmthTier({ fiber_content: ['wool'] }), 'heavy')
  // Neither signal tagged -> an honest unknown, not a guess.
  assert.equal(pieceWarmthTier({}), null)
  assert.equal(pieceWarmthTier({ fiber_content: ['polyester'] }), null)
})

test('pieceWarmthTier: an insulating fabric_category counts even when fiber_content misses or contradicts it', () => {
  // Real wardrobe data: a wool cardigan tagged fiber_content ["unknown"], a fleece hoodie tagged
  // fiber_content ["cotton"] — fiber_content alone missed both. fabric_category is the more
  // reliable signal here and must count on its own.
  assert.equal(pieceWarmthTier({ fabric_weight: 'medium', fabric_category: 'wool', fiber_content: ['unknown'] }), 'heavy')
  assert.equal(pieceWarmthTier({ fabric_weight: 'medium', fabric_category: 'fleece', fiber_content: ['cotton'] }), 'heavy')
  assert.equal(pieceWarmthTier({ fabric_weight: 'medium', fabric_category: 'corduroy' }), 'heavy')
  // A non-insulating category with no fabric_weight tag stays unknown — fabric_category alone
  // isn't enough unless it's specifically an insulating one.
  assert.equal(pieceWarmthTier({ fabric_category: 'cotton' }), null)
})

test('pieceWarmthTier: a directly-tagged fabric_weight is the starting point — coverage adds nothing once it is known, but a bare cut still moves it', () => {
  // Owner ruling: hem/sleeve LENGTH data describes how much body area the fabric covers, not what
  // the fabric itself weighs. Once fabric_weight is directly tagged, full coverage does not
  // additionally promote a medium-weight piece to 'heavy' — this is the general fix for a real
  // regression that "ankle" alone did not fully resolve: a directly-tagged medium-weight piece was
  // still getting bumped to 'heavy' by maxi/floor/full-length coverage (real wardrobe piece 129:
  // twill wide-leg pants, fabric_weight: medium, length_hits_at: full_length — wrongly read as
  // 'heavy').
  assert.equal(pieceWarmthTier({ fabric_weight: 'light', sleeve_length: 'long' }), 'light')
  assert.equal(pieceWarmthTier({ fabric_weight: 'medium', length_hits_at: 'maxi' }), 'medium')
  assert.equal(pieceWarmthTier({ fabric_weight: 'medium', length_hits_at: 'full_length' }), 'medium')
  // 'mini' is bareness evidence (pieceBareness), not coverage — it's a bare cut, not a long hem,
  // so it moves the tier the same way sleeveless does: medium steps down to light.
  assert.equal(pieceWarmthTier({ fabric_weight: 'medium', length_hits_at: 'mini' }), 'light')
  // Insulating MATERIAL is still real, additional evidence fabric_weight alone can miss — it
  // keeps bumping a tier, capped at 'heavy'.
  assert.equal(pieceWarmthTier({ fabric_weight: 'heavy', fabric_category: 'wool', sleeve_length: 'long' }), 'heavy')
  // A bare CUT (as opposed to a long hem) is a different signal — unlike coverage, skin exposure
  // is real evidence about warmth even once fabric_weight is known, so it still steps the tier
  // down by one, same shape as the insulating-material bump but in the other direction. This is
  // the owner-flagged fix for the sleeveless-dress case: fabric_weight: medium alone does not mean
  // "warm" for a bare-cut garment.
  assert.equal(pieceWarmthTier({ fabric_weight: 'heavy', sleeve_length: 'sleeveless' }), 'medium')
  assert.equal(pieceWarmthTier({ fabric_weight: 'medium', sleeve_length: 'sleeveless' }), 'light')
  // Already at the floor/ceiling -> the step has nowhere further to go.
  assert.equal(pieceWarmthTier({ fabric_weight: 'light', sleeve_length: 'sleeveless' }), 'light')
  // Insulating material (+1) and a bare cut (-1) on the same piece roughly cancel: a medium wool
  // sleeveless dress is genuinely less warm than a medium wool long-sleeve top, but the wool still
  // keeps it from reading as merely 'light'.
  assert.equal(pieceWarmthTier({ fabric_weight: 'medium', fabric_category: 'wool', sleeve_length: 'sleeveless' }), 'medium')
  // A heavy sleeveless wool dress: the insulating-material bump (+1) and the bare-cut step (-1)
  // are computed together before clamping, so they net to zero here and it stays 'heavy' — already
  // at the ceiling, so there's no room left for the bump to register before the bare cut cancels
  // it. Still well short of 'light' — the wool keeps it far warmer than a bare unlined cotton
  // garment, which is the case that actually matters.
  assert.equal(pieceWarmthTier({ fabric_weight: 'heavy', fabric_category: 'wool', sleeve_length: 'sleeveless' }), 'heavy')
})

test('pieceWarmthTier: real-world dress example — fabric_weight medium does not mean warm when the cut is bare', () => {
  // Owner's exact pushback: "this dress weight is medium, but it does not make it warm." A
  // sleeveless medium-weight cotton dress with no insulating material should read as 'light', the
  // same as a light-weight non-bare piece — the bare cut is doing real thermal work here that
  // fabric_weight alone can't see.
  assert.equal(
    pieceWarmthTier({ category: 'dress', fabric_category: 'cotton', fabric_weight: 'medium', fiber_content: ['cotton'], sleeve_length: 'sleeveless' }),
    'light'
  )
  // Same fabric, long sleeves instead: no bare cut to pull it down, stays medium.
  assert.equal(
    pieceWarmthTier({ category: 'dress', fabric_category: 'cotton', fabric_weight: 'medium', fiber_content: ['cotton'], sleeve_length: 'long' }),
    'medium'
  )
  // A genuinely light fabric, sleeveless, maxi-length dress: nothing to bump it, stays light.
  assert.equal(
    pieceWarmthTier({ category: 'dress', fabric_category: 'linen', fabric_weight: 'light', fiber_content: ['linen'], sleeve_length: 'sleeveless', length_hits_at: 'maxi' }),
    'light'
  )
})

test('pieceWarmthTier: coverage/bareness are a weak, gap-filling fallback only when fabric_weight is completely untagged', () => {
  // With no fabric_weight and no insulating material at all, coverage/bareness become the only
  // available evidence — full coverage suggests at least moderate substance, a high-bareness cut
  // suggests light. Neither reaches 'heavy' on its own; that tier is reserved for a real material
  // signal (a direct fabric_weight: 'heavy' tag, or an insulating fiber/fabric_category).
  assert.equal(pieceWarmthTier({ sleeve_length: 'long' }), 'medium')
  assert.equal(pieceWarmthTier({ length_hits_at: 'maxi' }), 'medium')
  assert.equal(pieceWarmthTier({ length_hits_at: 'floor_length' }), 'medium')
  assert.equal(pieceWarmthTier({ sleeve_length: 'sleeveless' }), 'light')
  assert.equal(pieceWarmthTier({ length_hits_at: 'mini' }), 'light')
  // Neither coverage nor bareness tagged, and no weight/material signal either -> honest unknown.
  assert.equal(pieceWarmthTier({}), null)
})

test('pieceCoverage: physical coverage only — no warmth conclusion baked in, and ankle-length does not count', () => {
  // Owner ruling: hem length alone isn't warmth — a light silk ankle-length skirt is still not a
  // warm layer (needs stockings in winter), and 'ankle' is just where ordinary trousers end, not
  // an exceptional length. Only genuinely long coverage (floor-length, maxi, full-length) counts,
  // and the return value describes coverage, not an insulation verdict — callers that care about
  // warmth (pieceWarmthTier) decide what it means, weighed against the fabric.
  assert.equal(pieceCoverage({ length_hits_at: 'ankle' }), null)
  assert.equal(pieceCoverage({ length_hits_at: 'floor_length' }), 'full')
  assert.equal(pieceCoverage({ length_hits_at: 'maxi' }), 'full')
  assert.equal(pieceCoverage({ length_hits_at: 'full_length' }), 'full')
  assert.equal(pieceCoverage({ sleeve_length: 'long' }), 'full')
})

test('pieceBareness: length_hits_at bare-hemline check is scoped to values that actually mean short/exposing, not every category\'s vocabulary', () => {
  // Real regression: "light grey and brown knit cardigan" (piece 131, category outerwear) —
  // cashmere, fabric_weight: medium, length_hits_at: mid_thigh — read as bareness: 'high', which
  // cancelled out the insulating-material tier bump and landed it in "Versatile" instead of
  // "Good for cold". length_hits_at is a genuinely per-category vocabulary
  // (docs/garment-field-reference.md): 'mid_thigh' is valid ONLY for outerwear, where it means how
  // far DOWN a coat/cardigan extends (waist < hip < mid_thigh < knee) — the opposite direction from
  // bareness. A mid-thigh cardigan is longer/more covering than a hip-length one, not bare (real
  // data: piece 996760 "fleece coat", length_hits_at: mid_thigh — clearly a long, covering coat).
  assert.equal(pieceBareness({ category: 'outerwear', length_hits_at: 'mid_thigh' }), null)
  assert.equal(pieceBareness({ category: 'outerwear', length_hits_at: 'knee' }), null)
  // 'upper_thigh' isn't a valid length_hits_at value in any current category's schema — dead
  // legacy text, not a real bare-hemline signal.
  assert.equal(pieceBareness({ length_hits_at: 'upper_thigh' }), null)
  // 'mini' (dress/skirt) and 'shorts' (pants) remain real, current bare-hemline values.
  assert.equal(pieceBareness({ category: 'dress', length_hits_at: 'mini' }), 'high')
  assert.equal(pieceBareness({ category: 'bottom', length_hits_at: 'shorts' }), 'high')
})

test('pieceWarmthTier: real-data regression — cashmere cardigan (medium, mid_thigh outerwear length) reads warm, not cancelled out by a false bareness signal', () => {
  const cardigan = { category: 'outerwear', name: 'light grey and brown knit cardigan', fabric_category: 'cashmere', fabric_weight: 'medium', fiber_content: ['cashmere'], sleeve_length: 'long', neckline: 'none', length_hits_at: 'mid_thigh' }
  assert.equal(pieceWarmthTier(cardigan), 'heavy')
  assert.equal(pieceHeatSuitability(cardigan), 'cold')
})

test('pieceWarmthTier: real-data regression — cream wide-leg terry drawstring pants (cotton, medium, ankle) stays medium', () => {
  assert.equal(
    pieceWarmthTier({ category: 'bottom', name: 'cream wide-leg terry drawstring pants', fabric_category: 'cotton', fabric_weight: 'medium', fiber_content: ['cotton'], length_hits_at: 'ankle' }),
    'medium'
  )
})

test('pieceWarmthTier: real-data regression — beige pleated wide-leg pants (twill, medium, full_length) stays medium, not heavy', () => {
  // Piece 129: was landing in the "Heavy" warmth filter purely because length_hits_at:
  // 'full_length' triggered pieceCoverage's bump — nothing about the fabric (twill, medium
  // weight, cotton/unknown fiber) supports 'heavy'. This is the maxi/floor/full-length analog of
  // the ankle-length terry-pants fix above — general, not a second one-off patch.
  assert.equal(
    pieceWarmthTier({ category: 'bottom', name: 'beige pleated wide-leg pants', fabric_category: 'twill', fabric_weight: 'medium', fiber_content: ['cotton', 'unknown'], length_hits_at: 'full_length' }),
    'medium'
  )
})

test('pieceWarmthTier: shoes and accessories are always unknown, even with a tagged fabric_weight', () => {
  // Real wardrobe data: "beige leather chunky heel sandals" is tagged fabric_weight: 'heavy' —
  // a real value describing the shoe's construction/substance, not thermal insulation. An
  // open-toe sandal does not run warmer for being sturdily built, so reading fabric_weight for
  // footwear the same way as a garment put sandals in the "Heavy" warmth filter, which is wrong.
  assert.equal(pieceWarmthTier({ category: 'shoes', name: 'chunky heel sandals', fabric_weight: 'heavy', fabric_category: 'leather' }), null)
  assert.equal(pieceWarmthTier({ category: 'shoes', name: 'wool-lined winter boots', fabric_weight: 'heavy', fabric_category: 'wool' }), null)
  assert.equal(pieceWarmthTier({ category: 'accessory', name: 'wool scarf', fabric_weight: 'heavy', fabric_category: 'wool' }), null)
  // Garments in the same weight/material tier are unaffected.
  assert.equal(pieceWarmthTier({ category: 'top', name: 'wool sweater', fabric_weight: 'heavy', fabric_category: 'wool' }), 'heavy')
})

test('pieceHasOcclusiveFit: requires BOTH a close fit AND no natural fiber — a fitted cotton tee is not occlusive', () => {
  // Real regression in the other direction: piece 223 "ivory graphic print crew tee" is 100%
  // cotton, tagged fit_on_body: clings_stretchy (an ordinary fitted tee) — an earlier version of
  // this function flagged fit alone, which wrongly caught it and 25 other real cotton/knit
  // tops/bottoms, demoting plain hot-weather basics out of the "good for heat" bucket.
  assert.equal(pieceHasOcclusiveFit({ fit_on_body: 'clings_stretchy', fiber_content: ['cotton'] }), false)
  assert.equal(pieceHasOcclusiveFit({ fit_on_body: 'clings_stretchy', fiber_content: ['cotton', 'polyester'] }), false)
  assert.equal(pieceHasOcclusiveFit({ fit_on_body: 'clings_stretchy', fiber_content: ['viscose', 'spandex'] }), false)
  // No fiber_content and no fabric_category signal at all -> unknown, don't guess occlusive.
  assert.equal(pieceHasOcclusiveFit({ fit_on_body: 'clings_stretchy' }), false)

  // Fully synthetic fiber_content (no natural fiber at all) + a close fit -> occlusive.
  assert.equal(pieceHasOcclusiveFit({ fit_on_body: 'clings_stretchy', fiber_content: ['polyester', 'nylon', 'spandex'] }), true)
  assert.equal(pieceHasOcclusiveFit({ fit_on_body: 'clings_drapey', fiber_content: ['spandex'] }), true)
  // fabric_category: technical/performance is a fallback when fiber_content isn't tagged.
  assert.equal(pieceHasOcclusiveFit({ fit_on_body: 'clings_stretchy', fabric_category: 'technical/performance' }), true)

  // A loose/relaxed fit is never occlusive regardless of fabric.
  assert.equal(pieceHasOcclusiveFit({ fit_on_body: 'skims', fiber_content: ['polyester', 'nylon', 'spandex'] }), false)
  assert.equal(pieceHasOcclusiveFit({ fit_on_body: 'drapes', fiber_content: ['polyester'] }), false)
  assert.equal(pieceHasOcclusiveFit({ fit_on_body: 'hangs_straight' }), false)
  assert.equal(pieceHasOcclusiveFit({ fit_on_body: 'structured' }), false)
  assert.equal(pieceHasOcclusiveFit({}), false)
})

test('weatherFitForPiece: real-world regression — skin-tight technical leggings score below a loose light piece for heat', () => {
  // "floral botanical print active leggings" (real wardrobe piece 996784): fabric_weight: light,
  // fabric_category: technical/performance, fit_on_body: clings_stretchy, fully synthetic
  // fiber_content. Under the graded evidence-combination model (owner design charter — fabric
  // weight, breathability, and fit/air-space are independent, additive terms, not a single
  // boolean), the light-fabric credit (+8) is more than offset by the non-breathable fiber (-5)
  // and the occlusive fit acting on that same non-breathability (-6): net negative, genuinely
  // worse for heat than neutral, not just "loses a bonus." A loose, breathable light piece stacks
  // all three terms the other way and scores well above it.
  const leggings = { category: 'bottom', fabric_weight: 'light', fabric_category: 'technical/performance', fit_on_body: 'clings_stretchy', fiber_content: ['polyester', 'nylon', 'spandex'] }
  const looseLightTop = { category: 'top', fabric_weight: 'light', fabric_category: 'cotton', fit_on_body: 'drapes', fiber_content: ['cotton'] }
  const leggingsHot = weatherFitForPiece(leggings, { isHot: true }).score
  const looseTopHot = weatherFitForPiece(looseLightTop, { isHot: true }).score
  assert.ok(leggingsHot < 0, `expected leggings to score below neutral for heat, got ${leggingsHot}`)
  assert.ok(looseTopHot > 0, `expected the loose cotton top to score above neutral for heat, got ${looseTopHot}`)
  assert.ok(looseTopHot > leggingsHot + 10, 'the loose breathable piece must score well above the occlusive synthetic one')
  // Cold-weather scoring is untouched by fit_on_body/breathability — a light fabric still needs
  // layering in the cold regardless of how close it sits to skin or how it breathes.
  assert.ok(weatherFitForPiece(leggings, { isCold: true }).score < 0)
})

test('pieceHeatSuitability: a practical hot/cold/versatile readout built on weatherFitForPiece\'s own scores', () => {
  // Real regression: the leggings above were unambiguously bucketed "good for heat" by tier alone.
  // They now land as 'versatile' — not a claim that they're great for both extremes, just an
  // honest result once the occlusive fit costs them the hot-weather advantage without picking up
  // a cold-weather one either.
  const leggings = { category: 'bottom', fabric_weight: 'light', fabric_category: 'technical/performance', fit_on_body: 'clings_stretchy', fiber_content: ['polyester', 'nylon', 'spandex'] }
  assert.equal(pieceHeatSuitability(leggings), 'versatile')

  // A loose, light, non-insulating piece still reads as the clear hot-weather pick.
  assert.equal(pieceHeatSuitability({ category: 'top', fabric_weight: 'light', fit_on_body: 'drapes', fiber_content: ['cotton'] }), 'hot')

  // A heavy insulating piece reads as the clear cold-weather pick.
  assert.equal(pieceHeatSuitability({ category: 'top', fabric_weight: 'heavy', fabric_category: 'wool', fiber_content: ['wool'] }), 'cold')

  // A plain medium-weight piece with no strong signal either way is genuinely versatile — no
  // adjustments fire in either direction.
  assert.equal(pieceHeatSuitability({ category: 'top', fabric_weight: 'medium', fiber_content: ['cotton'] }), 'versatile')

  // A relaxed-fit, long-sleeve light rayon blouse: no bare-cut credit (it has sleeves), but still
  // clearly the better hot-weather pick than a medium/heavy piece — reads 'hot', just without the
  // extra bareness bonus a sleeveless light piece would additionally get.
  assert.equal(pieceHeatSuitability({ category: 'top', fabric_weight: 'light', fabric_category: 'rayon', fit_on_body: 'hangs_straight', sleeve_length: 'long', fiber_content: ['rayon'] }), 'hot')

  // A fitted cotton tee (real wardrobe piece 223 shape: cotton, fit_on_body: clings_stretchy)
  // is NOT occlusive — plain cotton still breathes fine when fitted — so it keeps the full hot
  // bonus and reads 'hot', not 'versatile'.
  assert.equal(pieceHeatSuitability({ category: 'top', fabric_weight: 'light', fabric_category: 'cotton', fit_on_body: 'clings_stretchy', fiber_content: ['cotton'] }), 'hot')

  // No warmth signal at all -> honest unknown, not a guess.
  assert.equal(pieceHeatSuitability({ category: 'top' }), null)

  // Shoes/accessories are out of scope, same as pieceWarmthTier/weatherFitForPiece.
  assert.equal(pieceHeatSuitability({ category: 'shoes', fabric_weight: 'heavy' }), null)
  assert.equal(pieceHeatSuitability({ category: 'accessory', fabric_weight: 'heavy' }), null)
})

test('pieceFiberBreathability: a graded ratio, not a name-based boolean — cotton/linen/rayon are not automatically breathable and polyester/nylon are not automatically unfriendly', () => {
  // Owner's design charter, explicit: "cotton/linen/rayon do not automatically mean breathable
  // or heat-safe... polyester/nylon do not automatically mean heat-unfriendly." This reads the
  // actual tagged fiber mix and returns a RATIO across whatever's known, not a name lookup.
  assert.equal(pieceFiberBreathability({ fiber_content: ['cotton'] }), 1)
  assert.equal(pieceFiberBreathability({ fiber_content: ['polyester'] }), -1)
  // A genuine blend lands in between rather than snapping to either extreme.
  assert.equal(pieceFiberBreathability({ fiber_content: ['cotton', 'polyester'] }), 0)
  assert.ok(pieceFiberBreathability({ fiber_content: ['cotton', 'cotton', 'polyester'] }) > 0, 'majority-natural blend should lean breathable, not neutral')
  // Untagged/unknown fiber_content is a real "no opinion", not a guess in either direction.
  assert.equal(pieceFiberBreathability({}), 0)
  assert.equal(pieceFiberBreathability({ fiber_content: ['unknown'] }), 0)
  // A material this function has no opinion on (e.g. metal, on a trim-heavy piece) doesn't count
  // as evidence either way.
  assert.equal(pieceFiberBreathability({ fiber_content: ['metal'] }), 0)
})

test('pieceOcclusiveFitDegree: graded by construction, with silhouette as a fallback where fit_on_body is untagged', () => {
  assert.equal(pieceOcclusiveFitDegree({ fit_on_body: 'clings_stretchy' }), 1)
  assert.equal(pieceOcclusiveFitDegree({ fit_on_body: 'clings_drapey' }), 0.6)
  assert.equal(pieceOcclusiveFitDegree({ fit_on_body: 'skims' }), 0.25)
  assert.equal(pieceOcclusiveFitDegree({ fit_on_body: 'drapes' }), 0)
  assert.equal(pieceOcclusiveFitDegree({ fit_on_body: 'hangs_straight' }), 0)
  // fit_on_body is sparsely tagged outside bottoms (docs/garment-field-reference.md field audit —
  // 35-52% for dress/outerwear/top vs 97% for bottom); silhouette carries the same "fitted vs
  // relaxed" information in its own vocabulary and is much better populated there (85-95%).
  assert.equal(pieceOcclusiveFitDegree({ silhouette: 'fitted' }), 0.6)
  assert.equal(pieceOcclusiveFitDegree({ silhouette: 'slim' }), 0.6)
  assert.equal(pieceOcclusiveFitDegree({ silhouette: 'relaxed' }), 0)
  // fit_on_body wins when both are tagged.
  assert.equal(pieceOcclusiveFitDegree({ fit_on_body: 'drapes', silhouette: 'fitted' }), 0)
  assert.equal(pieceOcclusiveFitDegree({}), 0)
})

test('pieceWeatherScores: graded, multi-factor evidence — no single property is sufficient on its own to declare a garment good or bad for heat/cold', () => {
  // Owner's design charter, point by point:

  // "fabric_weight: light does not automatically mean good for heat" — a light, fully-synthetic,
  // occlusive piece (the leggings shape) nets NEGATIVE for heat despite the light tag.
  const occlusiveSynthetic = { category: 'bottom', fabric_weight: 'light', fit_on_body: 'clings_stretchy', fiber_content: ['polyester', 'nylon', 'spandex'] }
  assert.ok(pieceWeatherScores(occlusiveSynthetic).heat < 0, 'light fabric_weight alone must not guarantee a positive heat score')

  // "fabric_weight: medium does not automatically mean mild/versatile" — a medium piece with a
  // clearly bare cut still leans toward heat, not a flat neutral/versatile default.
  const bareMedium = { category: 'top', fabric_weight: 'medium', sleeve_length: 'sleeveless' }
  assert.ok(pieceWeatherScores(bareMedium).heat > 0, 'medium fabric_weight + a bare cut must not be forced to a flat neutral score')

  // "close fit is relevant, but should not by itself make a garment occlusive" — a close-fitting
  // piece in breathable natural fiber gets no occlusion penalty (the fitted-cotton-tee case).
  const closeButBreathable = { category: 'top', fabric_weight: 'light', fit_on_body: 'clings_stretchy', fiber_content: ['cotton'] }
  const looseButSynthetic = { category: 'top', fabric_weight: 'light', fit_on_body: 'drapes', fiber_content: ['polyester'] }
  assert.ok(pieceWeatherScores(closeButBreathable).heat > pieceWeatherScores(looseButSynthetic).heat - 0.01,
    'a close breathable fit must not score worse for heat than a loose non-breathable one purely for being close')

  // "full coverage is relevant, but should not by itself make a garment warm" — full coverage on
  // a LIGHT fabric costs far less heat-score than the same coverage on a HEAVY fabric (graded by
  // mass, not a flat penalty), and a light full-coverage piece can still net positive for heat.
  const lightFullCoverage = { category: 'top', fabric_weight: 'light', sleeve_length: 'long', fiber_content: ['linen'] }
  const heavyFullCoverage = { category: 'top', fabric_weight: 'heavy', sleeve_length: 'long', fiber_content: ['wool'] }
  assert.ok(pieceWeatherScores(lightFullCoverage).heat > 0, 'light full-coverage linen must still net positive for heat')
  assert.ok(pieceWeatherScores(heavyFullCoverage).heat < pieceWeatherScores(lightFullCoverage).heat,
    'the same coverage costs more heat-score on a heavier fabric than a lighter one')

  // "exposed skin is relevant, but should not erase genuinely insulating material" — a sleeveless
  // wool piece still scores positive for cold (the insulating bump survives bareness pulling the
  // other way), even though a sleeveless non-insulating piece of the same weight would not.
  const sleevelessWool = { category: 'top', fabric_weight: 'medium', sleeve_length: 'sleeveless', fabric_category: 'wool', fiber_content: ['wool'] }
  const sleevelessCotton = { category: 'top', fabric_weight: 'medium', sleeve_length: 'sleeveless', fiber_content: ['cotton'] }
  assert.ok(pieceWeatherScores(sleevelessWool).cold > pieceWeatherScores(sleevelessCotton).cold,
    'exposed skin must not erase the insulating material bump entirely')

  // "polyester/nylon do not automatically mean heat-unfriendly" — a LOOSE synthetic piece (no
  // occlusive fit to combine with the non-breathability) still nets positive for heat if the
  // fabric itself is light, same direction as a loose natural-fiber piece of the same weight.
  const looseLightSynthetic = { category: 'top', fabric_weight: 'light', fit_on_body: 'drapes', fiber_content: ['polyester'] }
  assert.ok(pieceWeatherScores(looseLightSynthetic).heat > 0, 'a loose light synthetic piece must not be penalized to negative purely for fiber name')
})

test('wholeWardrobePieceTrustDecision and buildVisualComposerRoster share one hot-weather insulation model, with their pre-existing policy differences kept intentional and explicit', () => {
  // Model consolidation, not a policy change (owner instruction): both gates now read the same
  // hotWeatherInsulationReason() facts (fabric_weight, insulating material, coverage, neckline,
  // sleeves) instead of independently re-deriving them — but the two gates' OWN thresholds already
  // differed before this consolidation (the roster never checked dress/neckline/sleeve coverage or
  // applied the heavy-weight check outside outerwear/top), and that difference is preserved
  // verbatim, not silently widened or narrowed.
  const hot = { occasion: 'casual', weatherProfile: { isHot: true } }

  const rosterOptions = { occasion: 'casual', weatherProfile: { isHot: true }, maxImages: 90 }
  // formality/occasions/heel-support fields keep these fixtures past the roster's earlier,
  // unrelated register/footwear gates so the hot-weather insulation check is what's actually
  // being exercised below.
  const passesEarlierGates = { formality: 'everyday', occasions: ['casual'], photo: 'x.jpg' }

  // Case the two gates agree on: a heavy top is insulating everywhere.
  const heavyTop = { id: 1, category: 'top', name: 'heavy wool sweater', fabric_weight: 'heavy' }
  assert.equal(wholeWardrobePieceTrustDecision(heavyTop, hot).allowed, false)
  const rosterHeavyTop = buildVisualComposerRoster([{ ...heavyTop, ...passesEarlierGates }], rosterOptions)
  assert.equal(rosterHeavyTop.excluded.find(e => e.pieceId === 1)?.reason, 'hot weather: insulating piece', 'roster must also exclude a heavy top, for the same reason')

  // Case that has always differed: a heavy DRESS. trust-decision's heavy-weight check applies to
  // every non-shoe/accessory category; the roster's has only ever applied to outerwear/top.
  const heavyDress = { id: 2, category: 'dress', name: 'heavy wool dress', fabric_weight: 'heavy' }
  assert.equal(wholeWardrobePieceTrustDecision(heavyDress, hot).allowed, false, 'trust-decision rejects a heavy dress')
  const rosterHeavyDress = buildVisualComposerRoster([{ ...heavyDress, ...passesEarlierGates }], rosterOptions)
  assert.ok(rosterHeavyDress.roster.some(p => p.id === 2), 'roster has never rejected a heavy dress on weight alone — preserved, not a new gap')

  // Case that has always differed: a medium dress with a warm (turtleneck) neckline. trust-decision
  // checks upper-body coverage/neckline/sleeves; the roster never has.
  const turtleneckDress = { id: 3, category: 'dress', name: 'medium turtleneck dress', fabric_weight: 'medium', neckline: 'turtle' }
  assert.equal(wholeWardrobePieceTrustDecision(turtleneckDress, hot).allowed, false, 'trust-decision rejects a medium turtleneck dress in hot weather')
  const rosterTurtleneckDress = buildVisualComposerRoster([{ ...turtleneckDress, ...passesEarlierGates }], rosterOptions)
  assert.ok(rosterTurtleneckDress.roster.some(p => p.id === 3), 'roster has never checked neckline coverage — preserved, not a new gap')

  // Case that has always differed: an open-front cardigan with full coverage + warm neckline.
  // trust-decision exempts open-front layers from the coverage/neckline/sleeve checks; the roster
  // has no such exemption but also never runs those checks on tops in the first place, so a
  // MEDIUM open-front cardigan passes both — the exemption and the narrower roster policy land on
  // the same outcome here, which is exactly why the roster gate never needed an explicit exemption.
  const openFrontCardigan = { id: 4, category: 'top', name: 'open cardigan', reads_as: 'open-front cardigan', fabric_weight: 'medium', sleeve_length: 'long' }
  assert.equal(wholeWardrobePieceTrustDecision(openFrontCardigan, hot).allowed, true, 'trust-decision exempts an open-front cardigan from the sleeve-coverage check')
})
