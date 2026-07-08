import test from 'node:test'
import assert from 'node:assert/strict'
import { db, parsePiece } from '../db.js'
import { compatibilityScoreForSelectedItem, scoreWholeWardrobeCandidate, filterWholeWardrobePiecesForGeneration, wholeWardrobePieceTrustDecision, buildVisualComposerRoster, pieceOccasionCompatible, repairWholeWardrobeOutfit, weatherProfileFromContext, weatherFitForPiece, getMergedProfileRules, profileRuleFit } from '../styling-engine/rules.js'
import { bottomKind, fabricWeight, pieceBareness, pieceCoverage, pieceFabricWeight } from '../styling-engine/attributes.js'
import { resolveOccasionProfile } from '../styling-engine/occasions.js'
import { resolveActivityProfile } from '../styling-engine/footwear-comfort.js'

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

test('weatherProfileFromContext treats indoor season as weather-agnostic even with hot mood text', () => {
  const hotMood = weatherProfileFromContext({ season: 'indoor', mood: 'hot date night vibes' })
  assert.deepEqual(hotMood, { isHot: false, isCold: false })

  const indoorOnly = weatherProfileFromContext({ season: 'indoor' })
  assert.deepEqual(indoorOnly, { isHot: false, isCold: false })
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
    sleeve_type: 'sleeveless'
  }
  const woolGauze = {
    id: 7102,
    name: 'light wool gauze tank',
    category: 'top',
    photo: 'img.jpg',
    fabric_weight: 'light',
    fiber_content: ['wool'],
    sleeve_type: 'sleeveless'
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
  const heavyTurtleneck = { id: 1001, name: 'Heavy Turtleneck', category: 'top', fabric_weight: 'heavy', sleeve_type: 'long' }
  const heavyJeans = { id: 1002, name: 'Heavy Jeans', category: 'bottom', fabric_weight: 'heavy', style_profile_json: { bottom_kind: 'pants' } }
  const lightShorts = { id: 1003, name: 'Linen Shorts', category: 'bottom', fabric_weight: 'light', style_profile_json: { bottom_kind: 'shorts' } }

  const hotOptions = { mood: 'it is really hot', season: 'current season' }

  // 1. Heavy fabrics & insulating coverages should be penalized in hot weather
  const heavyRes = scoreWholeWardrobeCandidate([heavyTurtleneck, heavyJeans], hotOptions)
  assert.ok(heavyRes.reasons.includes('hot weather: heavy fabric'), 'Must penalize heavy fabric')
  assert.ok(heavyRes.reasons.includes('hot weather: insulating coverage'), 'Must penalize insulating coverage')

  // 2. Light fabrics should be boosted in hot weather
  const lightRes = scoreWholeWardrobeCandidate([lightShorts], hotOptions)
  assert.ok(lightRes.reasons.includes('hot weather: lightweight fabric'), 'Must boost lightweight fabric')
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

  // 5. Medium/heavy full-insulating bottoms (like jeans) should be prohibited in hot weather (hard weather filter)
  const whiteJeans = { id: 9914, name: 'white slim crop jeans', category: 'bottom', fabric_weight: 'medium', reads_as: 'slim cropped jeans', style_profile_json: { coverage: 'full-insulating' } }
  const resJeans = wholeWardrobePieceTrustDecision(whiteJeans, { ...options, weatherProfile: { isHot: true, isCold: false } })
  assert.equal(resJeans.allowed, false, 'Slim crop jeans should be prohibited in hot weather')
  assert.ok(resJeans.reasons.includes('hot weather: insulating piece'), 'Should report hot weather: insulating piece')
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

  // Test 3: Taupe suede ankle boots piece ID 200 is absent from the hiking visual roster
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const allowedRes = filterWholeWardrobePiecesForGeneration(allPieces, { occasion: 'casual', request: 'hiking' })
  const allowedIds = allowedRes.allowedPieces.map(p => Number(p.id))
  assert.ok(allowedIds.includes(200), 'Taupe suede ankle boots (ID 200) can remain in the broad pre-roster pool for diagnostics')
  const hikingRosterPieces = allowedRes.allowedPieces.map(piece => (
    Number(piece.id) === 200 ? { ...piece, formality: 'everyday' } : piece
  ))
  const hikingRoster = buildVisualComposerRoster(hikingRosterPieces, {
    occasion: 'casual',
    activity: 'hiking',
    maxImages: 90
  })
  const hikingRosterIds = hikingRoster.roster.map(p => Number(p.id))
  assert.ok(!hikingRosterIds.includes(200), 'Taupe suede ankle boots (ID 200) must be absent from the hiking visual roster')
  assert.match(
    hikingRoster.excluded.find(item => Number(item.pieceId) === 200)?.reason || '',
    /^footwear: .* unsuitable for Hiking \/ Outdoor active|^activity: not tagged for Hiking \/ Outdoor active/
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
