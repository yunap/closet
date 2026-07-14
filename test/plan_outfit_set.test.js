// Step 6 (plan_outfit_set): the trip precompose's slot engine extracted into
// styling-engine/outfitSetPlanner.js and exposed as a model-callable tool.
// Covers: slot normalization (tool args → engine slots, outfit cap), the
// declared-intent gate, card/plan-line production with source
// 'plan_outfit_set', source locking, and cross-slot piece-reuse bookkeeping
// (no duplicate outfit keys within a set).

import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-plan-set-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { db } = await import('../db.js')
const { executeTool, classifyPlanPath, recordPlanPathDiagnostics } = await import('../styling-engine/tools.js')
const { composeOutfitSet, normalizePlanSlots, normalizePlanConstraints, PLAN_TOTAL_OUTFIT_CAP } = await import('../styling-engine/outfitSetPlanner.js')
const { _clearWeatherCachesForTests } = await import('../styling-engine/weather.js')
const { parsePiece } = await import('../styling-engine/rules.js')
const { wardrobeCategoryGroup } = await import('../styling-engine/attributes.js')

const topIdsOf = outfits => outfits.flatMap(outfit => (outfit.pieces || []).filter(piece => wardrobeCategoryGroup(piece) === 'top').map(piece => Number(piece.id)))
const distinctPieceCount = outfits => new Set(outfits.flatMap(outfit => outfit.pieceIds || [])).size

// A fetchImpl (injected the same way weather.test.js does) that returns a hot
// inland forecast for everything EXCEPT a coastal town, which comes back mild —
// the Paso-Robles-coast microclimate the per-slot weather work exists to catch.
function makePlanFetch() {
  let calls = 0
  const fetchImpl = async (url) => {
    calls += 1
    if (url.includes('geocoding-api')) {
      const isCoast = /cambria/.test(url)
      const coords = isCoast ? { latitude: 35.56, longitude: -121.08 } : { latitude: 35.63, longitude: -120.69 }
      return { ok: true, json: async () => ({ results: [coords] }) }
    }
    const isCoast = /latitude=35\.56/.test(url)
    const daily = isCoast
      ? { temperature_2m_max: [62], temperature_2m_min: [52] } // mild coast
      : { temperature_2m_max: [94], temperature_2m_min: [66] } // hot inland
    return { ok: true, json: async () => ({ daily }) }
  }
  fetchImpl.callCount = () => calls
  return fetchImpl
}

after(() => {
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

beforeEach(() => {
  db.prepare('DELETE FROM pieces').run()
  seedWardrobe()
})

function insertPiece(overrides = {}) {
  const piece = {
    name: 'test piece',
    category: 'top',
    colors: [],
    occasions: ['casual', 'city'],
    season: 'year-round',
    notes: '',
    status: 'active',
    recommendation_status: 'trusted',
    fit_confidence: 'high',
    role_permission: 'auto',
    occasion_permissions: [],
    engine_notes: '',
    photo: null,
    worn_photo: null,
    pattern_type: 'solid',
    pattern_scale: 'none',
    pattern_complexity: 'solid',
    reads_as: '',
    silhouette: '',
    fabric_category: '',
    fabric_weight: 'light',
    fiber_content: [],
    formality: 'everyday',
    length_hits_at: '',
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
    ...overrides,
  }
  return db.prepare(`
    INSERT INTO pieces (
      name, category, colors, occasions, season, notes, status,
      recommendation_status, fit_confidence, role_permission, occasion_permissions,
      engine_notes, photo, worn_photo, pattern_type, pattern_scale,
      pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content,
      formality, length_hits_at, style_profile_json
    ) VALUES (
      @name, @category, @colors, @occasions, @season, @notes, @status,
      @recommendation_status, @fit_confidence, @role_permission, @occasion_permissions,
      @engine_notes, @photo, @worn_photo, @pattern_type, @pattern_scale,
      @pattern_complexity, @reads_as, @silhouette, @fabric_category, @fabric_weight, @fiber_content,
      @formality, @length_hits_at, @style_profile_json
    )
  `).run({
    ...piece,
    colors: JSON.stringify(piece.colors),
    occasions: JSON.stringify(piece.occasions),
    occasion_permissions: JSON.stringify(piece.occasion_permissions),
    fiber_content: JSON.stringify(piece.fiber_content),
    style_profile_json: JSON.stringify(piece.style_profile_json),
  }).lastInsertRowid
}

// Enough distinct tops/bottoms/shoes that two slots can compose different
// combinations; all light, trusted, and multi-occasion so gates stay open.
function seedWardrobe() {
  const tops = [
    { name: 'white cotton tee', reads_as: 'clean casual base', silhouette: 'relaxed', fabric_category: 'cotton' },
    { name: 'black silk blouse', reads_as: 'polished dark top', silhouette: 'fitted', fabric_category: 'silk', occasions: ['city', 'evening'] },
    { name: 'striped linen button shirt', reads_as: 'breezy structured shirt', silhouette: 'relaxed', fabric_category: 'linen' },
    { name: 'olive tank top', reads_as: 'simple warm-weather layer', silhouette: 'fitted', fabric_category: 'jersey' },
  ]
  const bottoms = [
    { name: 'light beige linen wide-leg pants', bottom_shape: 'wide_leg', fabric_category: 'linen' },
    { name: 'dark straight jeans', bottom_shape: 'straight', fabric_category: 'denim', occasions: ['casual', 'city', 'evening'] },
    { name: 'flowy midi skirt', bottom_shape: 'a_line_skirt', fabric_category: 'viscose', occasions: ['city', 'evening'] },
  ]
  const shoes = [
    { name: 'white leather sneakers', reads_as: 'walkable everyday sneaker' },
    { name: 'black block heel mules', reads_as: 'sharp dinner mule', occasions: ['city', 'evening'] },
    { name: 'tan ballet flats', reads_as: 'light walkable flat' },
  ]
  for (const top of tops) insertPiece({ category: 'top', colors: ['white'], ...top })
  for (const bottom of bottoms) {
    insertPiece({ category: 'bottom', colors: ['beige'], length_hits_at: 'full-length', ...bottom })
  }
  for (const shoe of shoes) insertPiece({ category: 'shoes', colors: ['white'], ...shoe })
  insertPiece({ category: 'outerwear', name: 'cream open cardigan', colors: ['cream'], fabric_category: 'knit', occasions: ['casual', 'city', 'evening'] })
}

test('normalizePlanSlots maps tool args to engine slots and caps the set size', () => {
  const slots = normalizePlanSlots([
    { label: 'Winery Days', occasion: 'outdoor_daytime_social', activity: 'walking', count: 3, weather: 'hot, highs 85F' },
    { label: 'Dinner Out', occasion: 'evening', count: 2 },
    { label: 'Coastal Day', occasion: 'casual', activity: 'walking', count: 3, weather: 'cool, around 60F', plan_note: 'bring a layer' },
    { label: 'Hike', occasion: 'casual', activity: 'hiking', count: 2 },
  ], { fallbackWeather: 'warm', tripSummary: { durationText: '5 days', dayBreakdown: '3 winery days, dinners out' } })

  assert.equal(slots.length, 4)
  assert.equal(slots[0].id, 'winery_days')
  assert.equal(slots[0].season, 'hot, highs 85F')
  assert.equal(slots[1].season, 'warm', 'slot without weather inherits the fallback')
  assert.equal(slots[2].planNote, 'bring a layer')
  assert.equal(slots[0].tripSummary.durationText, '5 days')
  const total = slots.reduce((sum, slot) => sum + slot.targetOutfits, 0)
  assert.ok(total <= PLAN_TOTAL_OUTFIT_CAP, `total outfits ${total} must respect the cap`)
  // Trimming eats from the END of the slot list, so early slots keep their counts.
  assert.equal(slots[0].targetOutfits, 3)

  // Slots without a usable label are dropped.
  assert.equal(normalizePlanSlots([{ occasion: 'casual' }]).length, 0)
})

test('plan_outfit_set is blocked until cards intent is declared', async () => {
  const toolContext = { declaredIntent: null }
  const result = await executeTool('plan_outfit_set', {
    slots: [{ label: 'City Days', occasion: 'city', activity: 'walking' }]
  }, toolContext)
  assert.equal(result.status, 'validation_error')
  assert.match(result.message, /declare_intent/)
  assert.equal(toolContext.freeformDiagnostics.composeWithoutDeclaredIntent, 1)
})

test('plan_outfit_set composes a multi-slot set with plan lines, slot labels, and a locked source', async () => {
  const toolContext = {
    declaredIntent: { want: 'cards' },
    question: 'pack me outfits for 4 days in Lisbon',
    weather: 'warm, highs 78F',
  }
  const result = await executeTool('plan_outfit_set', {
    slots: [
      { label: 'City Days', occasion: 'city', activity: 'walking', count: 2 },
      { label: 'Dinner Out', occasion: 'evening', count: 1 },
    ],
    duration_text: '4 days',
    day_breakdown: '2 walking city days, dinners out'
  }, toolContext)

  assert.equal(result.status, 'success')
  assert.ok(Array.isArray(toolContext.generatedOutfits) && toolContext.generatedOutfits.length >= 2,
    'set should hold at least one card per slot')
  assert.equal(toolContext.source, 'plan_outfit_set')
  assert.equal(toolContext.sourceLocked, true)
  assert.equal(toolContext.freeformDiagnostics.planOutfitSetCalls, 1)

  const labels = new Set(toolContext.generatedOutfits.map(outfit => outfit.label))
  assert.ok(labels.has('City Days') && labels.has('Dinner Out'), `cards carry slot labels, got ${[...labels]}`)
  for (const outfit of toolContext.generatedOutfits) {
    assert.equal(outfit.source, 'plan_outfit_set')
    assert.ok(outfit.coveragePosition, 'each card carries its coverage position')
  }
  assert.ok(result.plan_lines.some(line => /Packing reuse/.test(line)), 'plan lines include the reuse report')
  assert.ok(result.plan_lines.some(line => /Plan length: 4 days/.test(line)), 'plan lines include the stated duration')
  assert.ok(result.outfit_summaries.every(summary => summary.slot && summary.pieceNames.length >= 3))
})

test('composeOutfitSet never repeats an exact outfit within a set and honors seed outfits', async () => {
  const { parsePiece } = await import('../styling-engine/rules.js')
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Day One', occasion: 'city', activity: 'walking', count: 2 },
    { label: 'Day Two', occasion: 'city', activity: 'walking', count: 2 },
  ], { fallbackWeather: 'warm' })

  const outfits = await composeOutfitSet({ slots, question: 'city trip', allPieces, source: 'plan_outfit_set' })
  assert.ok(outfits.length >= 2, 'two identical slots should still yield multiple outfits')
  const keys = outfits.map(outfit => (outfit.pieceIds || []).slice().sort((a, b) => a - b).join('|'))
  assert.equal(new Set(keys).size, keys.length, 'no two outfits in a set may share the exact same pieces')

  // Seeding with the first result must keep that exact combination out of a replan.
  const replanned = await composeOutfitSet({ slots, question: 'city trip', allPieces, seedOutfits: [outfits[0]], source: 'plan_outfit_set' })
  const replanKeys = replanned.map(outfit => (outfit.pieceIds || []).slice().sort((a, b) => a - b).join('|'))
  assert.ok(!replanKeys.includes(keys[0]), 'seeded outfit combination must not be re-served')
})

// --- Build step 3: per-slot live weather -----------------------------------

test('normalizePlanSlots carries location, date, and stated weather, inheriting the plan location', () => {
  const slots = normalizePlanSlots([
    { label: 'Client Day', occasion: 'work', date: '2026-07-23', weather: 'cool AM, warm PM' },
    { label: 'Coast Escape', occasion: 'casual', location: 'Cambria, CA' },
  ], { fallbackLocation: 'Portland, OR' })

  assert.equal(slots[0].date, '2026-07-23')
  assert.equal(slots[0].statedWeather, 'cool AM, warm PM')
  assert.equal(slots[0].season, 'cool AM, warm PM', 'stated weather also seeds the season text')
  assert.equal(slots[0].location, 'Portland, OR', 'a slot without a location inherits the plan location')
  assert.equal(slots[1].location, 'Cambria, CA', 'a slot location overrides the plan location')
  assert.equal(slots[1].statedWeather, '', 'no stated weather when none is given')
})

test('normalizePlanSlots treats office and client-meeting slots as indoor when the model omits weather', () => {
  const slots = normalizePlanSlots([
    { label: 'Office Days', occasion: 'city', activity: 'none', count: 3 },
    { label: 'Client Meeting', occasion: 'smart casual', activity: 'none', count: 1 },
    { label: 'Outdoor Client Walk', occasion: 'city', activity: 'walking', count: 1 },
  ], { fallbackWeather: 'hot', fallbackLocation: 'Walnut Creek, CA' })

  assert.equal(slots[0].statedWeather, 'indoor')
  assert.equal(slots[0].season, 'indoor')
  assert.equal(slots[1].statedWeather, 'indoor')
  assert.equal(slots[1].season, 'indoor')
  assert.equal(slots[2].statedWeather, '', 'walking/outdoor slots should still use live weather')
  assert.equal(slots[2].season, 'hot')
})

test('composeOutfitSet resolves each slot\'s own live forecast and states it per slot in the plan lines', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  _clearWeatherCachesForTests()
  const fetchImpl = makePlanFetch()
  const slots = normalizePlanSlots([
    { label: 'Winery Days', occasion: 'city', activity: 'walking', count: 1 },
    { label: 'Coastal Day', occasion: 'city', activity: 'walking', count: 1, location: 'Cambria, CA' },
  ], { fallbackWeather: 'hot, highs 92F', fallbackLocation: 'Paso Robles, CA' })

  const outfits = await composeOutfitSet({
    slots,
    question: '5 days in Paso Robles',
    allPieces,
    source: 'plan_outfit_set',
    dateRange: { start: '2026-07-20', end: '2026-07-24' },
    fetchImpl,
  })

  const weatherLine = (outfits[0].tripPlanLines || []).find(line => line.startsWith('Weather used:'))
  assert.ok(weatherLine, 'the plan lines carry a per-slot weather line')
  assert.match(weatherLine, /Winery Days — hot \(live forecast, Paso Robles, CA\)/)
  // The whole point: the coast slot's own mild forecast overrides the trip's
  // inherited "hot, highs 92F" season text — the microclimate the miss was about.
  assert.match(weatherLine, /Coastal Day — mild \(live forecast, Cambria, CA\)/)

  const coastCard = outfits.find(outfit => outfit.label === 'Coastal Day')
  assert.equal(coastCard.slotWeather, 'mild (live forecast, Cambria, CA)')
})

test('a slot with stated weather uses it verbatim and never calls the forecast', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  _clearWeatherCachesForTests()
  const fetchImpl = makePlanFetch()
  const slots = normalizePlanSlots([
    { label: 'Gallery Opening', occasion: 'evening', count: 1, weather: 'chilly, around 50F', location: 'Cambria, CA' },
  ], { fallbackLocation: 'Paso Robles, CA' })

  const outfits = await composeOutfitSet({
    slots,
    question: 'gallery night out',
    allPieces,
    source: 'plan_outfit_set',
    dateRange: { start: '2026-07-20' },
    fetchImpl,
  })

  assert.equal(fetchImpl.callCount(), 0, 'stated per-slot weather must short-circuit before any forecast fetch')
  const card = outfits.find(outfit => outfit.label === 'Gallery Opening')
  assert.equal(card.slotWeather, 'chilly, around 50F')
})

test('plan_outfit_set office slots use indoor weather even when a hot live forecast is available', async () => {
  const toolContext = {
    declaredIntent: { want: 'cards' },
    question: "I need to get dressed for five days at the office next week, and one of those days I'm meeting a client."
  }
  const result = await executeTool('plan_outfit_set', {
    slots: [
      { label: 'Office Days', occasion: 'city', activity: 'none', count: 2, best_for: 'everyday office wear' },
      { label: 'Client Meeting', occasion: 'smart casual', activity: 'none', count: 1, best_for: 'professional meet with a client' },
    ],
    constraints: { reuse: 'diversify', allow_repeat: ['shoes'] },
    location: 'Walnut Creek, CA',
    date_range: { start: '2026-07-20', end: '2026-07-24' },
    duration_text: '5 days',
    day_breakdown: '5 workdays at the office + one client meeting.'
  }, toolContext)

  assert.equal(result.status, 'success')
  assert.ok(result.plan_lines.some(line => /^Plan length: 5 days/.test(line)))
  const weatherLine = result.plan_lines.find(line => line.startsWith('Weather used:'))
  assert.match(weatherLine, /Office Days — indoor/)
  assert.match(weatherLine, /Client Meeting — indoor/)
  assert.doesNotMatch(weatherLine, /live forecast/)
})

test('client-meeting office plan prefers structured pieces over beachy dress and open-toe wedges', async () => {
  insertPiece({
    category: 'dress',
    name: 'botanical resort maxi dress',
    colors: ['green'],
    occasions: ['city', 'smart-casual'],
    reads_as: 'botanical floral resort maxi sleeveless',
    silhouette: 'flowing full skirt',
    fabric_category: 'viscose',
    formality: 'elevated'
  })
  insertPiece({
    category: 'dress',
    name: 'green button down midi dress',
    colors: ['green'],
    occasions: ['city', 'smart-casual'],
    reads_as: 'soft button down midi dress',
    silhouette: 'a line',
    fabric_category: 'viscose',
    formality: 'elevated'
  })
  insertPiece({
    category: 'dress',
    name: 'black lace floral midi dress',
    colors: ['black'],
    occasions: ['city', 'smart-casual'],
    reads_as: 'lace floral midi dress',
    silhouette: 'soft',
    fabric_category: 'lace',
    formality: 'elevated'
  })
  insertPiece({
    category: 'shoes',
    name: 'tan open toe cork wedge sandals',
    colors: ['tan'],
    occasions: ['city', 'smart-casual'],
    reads_as: 'open toe cork wedge sandals',
    formality: 'elevated'
  })
  insertPiece({
    category: 'top',
    name: 'navy silk button shirt',
    colors: ['navy'],
    occasions: ['city', 'smart-casual'],
    reads_as: 'polished tailored button shirt',
    silhouette: 'structured',
    fabric_category: 'silk',
    formality: 'elevated'
  })
  insertPiece({
    category: 'bottom',
    name: 'black tailored straight trousers',
    colors: ['black'],
    occasions: ['city', 'smart-casual'],
    reads_as: 'tailored office trouser',
    bottom_shape: 'straight',
    fabric_category: 'wool',
    formality: 'elevated'
  })
  insertPiece({
    category: 'shoes',
    name: 'black pointed leather flats',
    colors: ['black'],
    occasions: ['city', 'smart-casual'],
    reads_as: 'pointed leather office flats',
    formality: 'elevated'
  })

  const toolContext = {
    declaredIntent: { want: 'cards' },
    question: "I need to get dressed for five days at the office next week, and one of those days I'm meeting a client."
  }
  const result = await executeTool('plan_outfit_set', {
    slots: [{ label: 'Client Meeting', occasion: 'smart casual', activity: 'none', count: 1, weather: 'indoor', best_for: 'client meeting' }],
    constraints: { reuse: 'diversify', no_repeat: ['tops'] },
    duration_text: '1 day',
    day_breakdown: '1 client meeting'
  }, toolContext)

  assert.equal(result.status, 'success')
  const names = (toolContext.generatedOutfits[0]?.pieces || []).map(piece => piece.name)
  assert.ok(names.includes('navy silk button shirt') || names.includes('black tailored straight trousers'), `expected a structured office piece, got ${names.join(', ')}`)
  assert.ok(!names.includes('botanical resort maxi dress'), `beachy dress should not win client meeting: ${names.join(', ')}`)
  assert.ok(!names.includes('green button down midi dress'), `soft midi dress should not win client meeting: ${names.join(', ')}`)
  assert.ok(!names.includes('black lace floral midi dress'), `lace floral dress should not win client meeting: ${names.join(', ')}`)
  assert.ok(!names.includes('tan open toe cork wedge sandals'), `open-toe wedges should not win client meeting: ${names.join(', ')}`)
})

test('routine office plan demotes botanical and lace dress formulas when structured options exist', async () => {
  insertPiece({
    category: 'dress',
    name: 'colorful botanical print maxi dress',
    colors: ['green'],
    occasions: ['city', 'smart-casual'],
    reads_as: 'colorful botanical floral maxi dress',
    silhouette: 'flowing full skirt',
    fabric_category: 'viscose',
    formality: 'elevated'
  })
  insertPiece({
    category: 'dress',
    name: 'black lace floral midi dress',
    colors: ['black'],
    occasions: ['city', 'smart-casual'],
    reads_as: 'black lace floral midi dress',
    silhouette: 'soft',
    fabric_category: 'lace',
    formality: 'elevated'
  })
  insertPiece({
    category: 'top',
    name: 'navy silk button shirt',
    colors: ['navy'],
    occasions: ['city', 'smart-casual'],
    reads_as: 'polished tailored button shirt',
    silhouette: 'structured',
    fabric_category: 'silk',
    formality: 'elevated'
  })
  insertPiece({
    category: 'bottom',
    name: 'black tailored straight trousers',
    colors: ['black'],
    occasions: ['city', 'smart-casual'],
    reads_as: 'tailored office trouser',
    bottom_shape: 'straight',
    fabric_category: 'wool',
    formality: 'elevated'
  })
  insertPiece({
    category: 'shoes',
    name: 'black pointed leather flats',
    colors: ['black'],
    occasions: ['city', 'smart-casual'],
    reads_as: 'pointed leather office flats',
    formality: 'elevated'
  })

  const toolContext = {
    declaredIntent: { want: 'cards' },
    question: 'I need work outfits for regular office days.'
  }
  const result = await executeTool('plan_outfit_set', {
    slots: [{ label: 'Work Day', occasion: 'smart casual', activity: 'none', count: 1, weather: 'indoor', best_for: 'Regular Office Days' }],
    constraints: { reuse: 'diversify', no_repeat: ['tops'] },
    duration_text: '1 day',
    day_breakdown: '1 regular office day'
  }, toolContext)

  assert.equal(result.status, 'success')
  const names = (toolContext.generatedOutfits[0]?.pieces || []).map(piece => piece.name)
  assert.ok(names.includes('navy silk button shirt') || names.includes('black tailored straight trousers'), `expected a structured office piece, got ${names.join(', ')}`)
  assert.ok(!names.includes('colorful botanical print maxi dress'), `botanical maxi should not win routine office: ${names.join(', ')}`)
  assert.ok(!names.includes('black lace floral midi dress'), `lace floral dress should not win routine office: ${names.join(', ')}`)
})

// --- Build step 4: reuse dial + per-category repeat rules + anchor exemption --

test('normalizePlanConstraints parses the reuse dial, maps category words, and applies the anchor / allow_repeat rules', () => {
  const c = normalizePlanConstraints({
    reuse: 'DIVERSIFY',
    no_repeat: ['tops', 'layers', 'shoes'],
    allow_repeat: ['shoes'],
    shared_anchor_ids: ['5', 5, 0, null, 12],
  })
  assert.equal(c.reuse, 'diversify')
  // tops -> top, layers -> outerwear, shoes dropped because allow_repeat wins.
  assert.deepEqual([...c.noRepeat].sort(), ['outerwear', 'top'])
  assert.deepEqual([...c.allowRepeat], ['shoes'])
  assert.deepEqual([...c.anchorIds].sort((a, b) => a - b), [5, 12])

  assert.equal(normalizePlanConstraints({ reuse: 'wild' }).reuse, '', 'an unknown reuse mode is ignored')
  assert.equal(normalizePlanConstraints({}).reuse, '')
  assert.equal(normalizePlanConstraints({}).noRepeat.size, 0)
})

test('no_repeat forbids a category from repeating across the set (a work week never wears a top twice)', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Work Week', occasion: 'city', activity: 'none', count: 3 },
  ], { fallbackWeather: 'mild' })

  const outfits = await composeOutfitSet({
    slots,
    question: 'outfits for my work week',
    allPieces,
    source: 'plan_outfit_set',
    constraints: { reuse: 'diversify', no_repeat: ['tops'] },
  })

  assert.ok(outfits.length >= 2, 'a 3-count slot should yield multiple looks')
  const topIds = topIdsOf(outfits)
  assert.equal(new Set(topIds).size, topIds.length, `no top may repeat across the set, got ${topIds}`)
})

test('the reuse dial is signed: maximize uses no more distinct pieces than diversify', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Day 1', occasion: 'city', activity: 'walking', count: 2 },
    { label: 'Day 2', occasion: 'city', activity: 'walking', count: 2 },
  ], { fallbackWeather: 'warm' })

  const maximize = await composeOutfitSet({ slots, question: 'trip', allPieces, source: 'plan_outfit_set', constraints: { reuse: 'maximize' } })
  const diversify = await composeOutfitSet({ slots, question: 'trip', allPieces, source: 'plan_outfit_set', constraints: { reuse: 'diversify' } })

  assert.ok(maximize.length >= 2 && diversify.length >= 2)
  assert.ok(
    distinctPieceCount(maximize) <= distinctPieceCount(diversify),
    `maximize (${distinctPieceCount(maximize)} distinct) should pack no looser than diversify (${distinctPieceCount(diversify)} distinct)`
  )
})

test('shared_anchor_ids pins a piece across the set and exempts it from no_repeat', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const anchorId = Number(allPieces.find(piece => wardrobeCategoryGroup(piece) === 'top').id)
  const slots = normalizePlanSlots([
    { label: 'Around the New Top', occasion: 'city', activity: 'none', count: 3 },
  ], { fallbackWeather: 'mild' })

  const outfits = await composeOutfitSet({
    slots,
    question: 'build outfits around this top',
    allPieces,
    source: 'plan_outfit_set',
    // no_repeat on tops would normally forbid wearing the same top twice — the
    // anchor exemption is what lets the pinned top recur.
    constraints: { no_repeat: ['tops'], shared_anchor_ids: [anchorId] },
  })

  assert.ok(outfits.length >= 2)
  const withAnchor = outfits.filter(outfit => (outfit.pieceIds || []).includes(anchorId))
  assert.ok(withAnchor.length >= 2, `the anchor top should recur across the set despite no_repeat, appeared in ${withAnchor.length}`)
})

// --- Build step 5: objective-driven plan report ------------------------------

const planLinesOf = outfits => outfits[0]?.tripPlanLines || []

test('normalizePlanConstraints parses a positive piece_budget and ignores junk', () => {
  assert.equal(normalizePlanConstraints({ piece_budget: 10 }).pieceBudget, 10)
  assert.equal(normalizePlanConstraints({ piece_budget: '12' }).pieceBudget, 12)
  assert.equal(normalizePlanConstraints({ piece_budget: 0 }).pieceBudget, 0)
  assert.equal(normalizePlanConstraints({ piece_budget: -3 }).pieceBudget, 0)
  assert.equal(normalizePlanConstraints({}).pieceBudget, 0)
})

test('a piece_budget makes the report lead with the roster + combination count (capsule)', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Capsule', occasion: 'city', activity: 'none', count: 3 },
  ], { fallbackWeather: 'warm' })

  const withinBudget = await composeOutfitSet({ slots, question: '10-piece summer capsule', allPieces, source: 'plan_outfit_set', constraints: { reuse: 'maximize', piece_budget: 20 } })
  const lines = planLinesOf(withinBudget)
  assert.ok(lines.some(line => /^Piece roster \(\d+\):/.test(line)), `roster headline expected, got ${JSON.stringify(lines)}`)
  assert.ok(lines.some(line => /\d+ pieces → \d+ outfits?/.test(line)), 'combination count expected')
  assert.ok(lines.some(line => /Within the 20-piece budget\./.test(line)), 'budget status expected')
  assert.ok(!lines.some(line => /Packing reuse/.test(line)), 'roster mode must replace the packing headline')

  // A tiny budget flags the overage instead.
  const overBudget = await composeOutfitSet({ slots, question: 'capsule', allPieces, source: 'plan_outfit_set', constraints: { reuse: 'maximize', piece_budget: 2 } })
  assert.ok(planLinesOf(overBudget).some(line => /Over the 2-piece budget by \d+/.test(line)), 'over-budget flag expected')
})

test('a diversify / no_repeat plan reports the repeat schedule instead of packing reuse', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Work Week', occasion: 'city', activity: 'none', count: 3 },
  ], { fallbackWeather: 'mild' })

  const outfits = await composeOutfitSet({ slots, question: 'work week', allPieces, source: 'plan_outfit_set', constraints: { reuse: 'diversify', no_repeat: ['tops'] } })
  const lines = planLinesOf(outfits)
  assert.ok(lines.some(line => /Every look is distinct|Repeat schedule:/.test(line)), `schedule-mode line expected, got ${JSON.stringify(lines)}`)
  assert.ok(!lines.some(line => /Packing reuse/.test(line)), 'diversify must not use the packing headline')
})

test('the default (no objective constraints) keeps the packing-reuse headline', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'City Days', occasion: 'city', activity: 'walking', count: 2 },
  ], { fallbackWeather: 'warm' })

  const outfits = await composeOutfitSet({ slots, question: 'trip', allPieces, source: 'plan_outfit_set' })
  assert.ok(planLinesOf(outfits).some(line => /^Packing reuse:/.test(line)), 'default report should be the packing headline')
})

// --- Build step 7: parallel-path diagnostics ---------------------------------

test('classifyPlanPath maps the keyword-preroute / model-call signals to one outcome', () => {
  assert.equal(classifyPlanPath({ modelCalled: true, prerouteComposed: true }), 'both')
  assert.equal(classifyPlanPath({ modelCalled: true, prerouteComposed: false }), 'model_only')
  assert.equal(classifyPlanPath({ modelCalled: false, prerouteComposed: true }), 'preroute_only')
  assert.equal(classifyPlanPath({ modelCalled: false, prerouteComposed: false, keywordMatched: true }), 'planning_uncomposed')
  assert.equal(classifyPlanPath({}), 'not_planning')
})

test('recordPlanPathDiagnostics writes the per-turn signals, initializing diagnostics if needed', () => {
  // No diagnostics object yet and no model call: pre-route-only turn.
  const preroute = {}
  recordPlanPathDiagnostics(preroute, { keywordMatched: true, prerouteComposed: true })
  assert.equal(preroute.freeformDiagnostics.planKeywordMatched, 1)
  assert.equal(preroute.freeformDiagnostics.planPrerouteComposed, 1)
  assert.equal(preroute.freeformDiagnostics.planModelCalled, 0)
  assert.equal(preroute.freeformDiagnostics.planPathOutcome, 'preroute_only')

  // The model called plan_outfit_set and the regex did NOT compose — the
  // generalization win the step-8 retirement is gated on.
  const modelOnly = { freeformDiagnostics: { planOutfitSetCalls: 1 } }
  recordPlanPathDiagnostics(modelOnly, { keywordMatched: false, prerouteComposed: false })
  assert.equal(modelOnly.freeformDiagnostics.planModelCalled, 1)
  assert.equal(modelOnly.freeformDiagnostics.planPathOutcome, 'model_only')
})

test('a real plan_outfit_set tool call surfaces as model_only when no pre-route composed', async () => {
  const toolContext = { declaredIntent: { want: 'cards' }, question: 'outfits for my work week, Thursday is client-facing' }
  const result = await executeTool('plan_outfit_set', {
    slots: [{ label: 'Work Days', occasion: 'city', activity: 'none', count: 2 }],
  }, toolContext)
  assert.equal(result.status, 'success')
  recordPlanPathDiagnostics(toolContext, { keywordMatched: false, prerouteComposed: false })
  assert.equal(toolContext.freeformDiagnostics.planPathOutcome, 'model_only')
})

// --- Slot register escalation (event weekends) --------------------------------

test('normalizePlanSlots normalizes the slot register and drops unknown values', () => {
  const slots = normalizePlanSlots([
    { label: 'Ceremony', occasion: 'evening', register: 'FORMAL' },
    { label: 'Rehearsal', occasion: 'evening', register: 'dressy' },
    { label: 'Brunch', occasion: 'smart casual', register: 'fancy' },
    { label: 'Hike', occasion: 'casual' },
  ])
  assert.equal(slots[0].register, 'formal')
  assert.equal(slots[1].register, 'dressy')
  assert.equal(slots[2].register, '', 'an unknown register value is dropped')
  assert.equal(slots[3].register, '', 'an omitted register is empty')
})

test('a formal-register slot pushes denim and sneakers out of the composed set', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Wedding Ceremony', occasion: 'evening', count: 2, register: 'formal', weather: 'indoor' },
  ])
  const outfits = await composeOutfitSet({ slots, question: 'wedding ceremony', allPieces, source: 'plan_outfit_set' })
  assert.ok(outfits.length >= 1, 'the formal slot should still compose')
  const names = outfits.flatMap(outfit => (outfit.pieces || []).map(piece => String(piece.name || '').toLowerCase()))
  assert.ok(!names.some(name => name.includes('jean') || name.includes('denim')), `a formal slot should avoid denim, got ${names}`)
  assert.ok(!names.some(name => name.includes('sneaker')), `a formal slot should avoid sneakers, got ${names}`)
})

test('a formal slot judges a dress by fabric/formality, not print — a silk botanical maxi is kept, a jersey one demoted', async () => {
  // Print and hemline are NOT formality (owner ruling): a silk botanical maxi is
  // a dressy dress and must not be demoted for the words "botanical"/"maxi"; a
  // casual jersey dress is demoted by its fabric and everyday register.
  insertPiece({ category: 'dress', name: 'silk botanical maxi dress', colors: ['coral'], occasions: ['city', 'evening'], reads_as: 'dressy silk column', silhouette: 'column', fabric_category: 'silk', fabric_weight: 'light', formality: 'dressy', length_hits_at: 'maxi', pattern_type: 'botanical' })
  insertPiece({ category: 'dress', name: 'grey jersey tank dress', colors: ['grey'], occasions: ['city', 'evening'], reads_as: 'casual jersey', fabric_category: 'jersey', formality: 'everyday', length_hits_at: 'knee' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Wedding Ceremony', occasion: 'evening', count: 1, register: 'formal', weather: 'indoor' },
  ])
  const outfits = await composeOutfitSet({ slots, question: 'wedding ceremony', allPieces, source: 'plan_outfit_set' })
  assert.ok(outfits.length >= 1)
  const names = outfits.flatMap(outfit => (outfit.pieces || []).map(piece => String(piece.name || '').toLowerCase()))
  assert.ok(names.some(name => name.includes('silk botanical maxi')), `the silk botanical maxi is dressy — print/length must not demote it, got ${names}`)
  assert.ok(!names.some(name => name.includes('jersey')), `the casual jersey dress should be demoted by fabric/formality, got ${names}`)
})

// --- composeOutfitSet quality fixes (capsule live test) ----------------------

test('a summer plan discourages wool/heavy fabrics on an indoor (weather-neutral) slot', async () => {
  insertPiece({ category: 'dress', name: 'grey wool knit dress', colors: ['grey'], occasions: ['city', 'evening'], reads_as: 'warm wool knit', fabric_category: 'wool', fabric_weight: 'heavy', length_hits_at: 'knee' })
  insertPiece({ category: 'dress', name: 'coral silk slip dress', colors: ['coral'], occasions: ['city', 'evening'], reads_as: 'light silk', fabric_category: 'silk', fabric_weight: 'light', length_hits_at: 'knee' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Smart-Casual Evenings', occasion: 'evening', count: 1, weather: 'indoor', best_for: 'summer evening out' },
  ])
  const outfits = await composeOutfitSet({ slots, question: '10-piece summer capsule', allPieces, source: 'plan_outfit_set' })
  const names = outfits.flatMap(outfit => (outfit.pieces || []).map(piece => String(piece.name || '').toLowerCase()))
  assert.ok(!names.some(name => name.includes('wool')), `a summer plan should avoid the wool dress even on an indoor slot, got ${names}`)
})

test('an outdoor-active slot avoids leather loafers/flats and prefers sneakers', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Outdoor Adventures', occasion: 'casual', activity: 'walking', count: 1, best_for: 'park or market visits, enjoy the outdoors' },
  ])
  const outfits = await composeOutfitSet({ slots, question: 'summer outings', allPieces, source: 'plan_outfit_set' })
  const names = outfits.flatMap(outfit => (outfit.pieces || []).map(piece => String(piece.name || '').toLowerCase()))
  assert.ok(names.some(name => name.includes('sneaker')), `outdoor-active should prefer sneakers, got ${names}`)
  assert.ok(!names.some(name => name.includes('ballet') || name.includes('mule') || name.includes('loafer')), `outdoor-active should avoid dressy/city shoes, got ${names}`)
})

test('no outfit stacks an open-knit cardigan top under a cardigan layer (two cardigans)', async () => {
  insertPiece({ category: 'top', name: 'oatmeal knit buttoned cardigan top', colors: ['cream'], occasions: ['casual', 'city', 'evening'], reads_as: 'open knit cardigan worn as top', fabric_category: 'knit' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Casual City Days', occasion: 'city', activity: 'walking', count: 3, weather: 'cool evening' },
  ])
  const outfits = await composeOutfitSet({ slots, question: 'city days', allPieces, source: 'plan_outfit_set' })
  for (const outfit of outfits) {
    const names = (outfit.pieces || []).map(piece => String(piece.name || '').toLowerCase())
    const hasOpenKnitTop = names.some(name => name.includes('buttoned cardigan top'))
    const hasCardiganLayer = names.some(name => name.includes('open cardigan'))
    assert.ok(!(hasOpenKnitTop && hasCardiganLayer), `no outfit may stack two cardigans, got ${names}`)
  }
})

// --- Register-down / athletic / summer-layer scorers (capsule live test 2) ---

test('a casual day slot demotes a dressy piece (no dressy maxi on a casual city outing)', async () => {
  insertPiece({ category: 'dress', name: 'plum silk evening maxi', colors: ['plum'], occasions: ['casual', 'city', 'evening'], reads_as: 'dressy silk maxi', fabric_category: 'silk', formality: 'dressy', length_hits_at: 'maxi' })
  insertPiece({ category: 'dress', name: 'chambray cotton day dress', colors: ['blue'], occasions: ['casual', 'city'], reads_as: 'easy cotton day dress', fabric_category: 'cotton', formality: 'everyday', length_hits_at: 'knee' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'City Outing', occasion: 'city', activity: 'walking', count: 1, best_for: 'exploring the city' },
  ])
  const outfits = await composeOutfitSet({ slots, question: 'city outings', allPieces, source: 'plan_outfit_set' })
  const names = outfits.flatMap(outfit => (outfit.pieces || []).map(piece => String(piece.name || '').toLowerCase()))
  assert.ok(!names.some(name => name.includes('evening maxi')), `a casual day slot should demote the dressy maxi, got ${names}`)
})

test('a non-athletic slot demotes an athletic/sporty piece', async () => {
  insertPiece({ category: 'dress', name: 'navy athletic knit tank dress', colors: ['navy'], occasions: ['casual', 'city'], reads_as: 'sporty athletic performance dress', fabric_category: 'jersey', formality: 'everyday', length_hits_at: 'knee' })
  insertPiece({ category: 'dress', name: 'sage linen day dress', colors: ['green'], occasions: ['casual', 'city'], reads_as: 'easy linen day dress', fabric_category: 'linen', formality: 'everyday', length_hits_at: 'knee' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Everyday Casual', occasion: 'casual', activity: 'none', count: 1, best_for: 'comfortable everyday wear' },
  ])
  const outfits = await composeOutfitSet({ slots, question: 'everyday casual', allPieces, source: 'plan_outfit_set' })
  const names = outfits.flatMap(outfit => (outfit.pieces || []).map(piece => String(piece.name || '').toLowerCase()))
  assert.ok(!names.some(name => name.includes('athletic')), `an everyday slot should demote the athletic dress, got ${names}`)
})

test('a summer daytime slot does not add a superfluous layer', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Outdoor Event', occasion: 'outdoor_daytime_social', count: 2, weather: 'warm', best_for: 'summer festivals or markets' },
  ])
  const outfits = await composeOutfitSet({ slots, question: '10-piece summer capsule', allPieces, source: 'plan_outfit_set' })
  const names = outfits.flatMap(outfit => (outfit.pieces || []).map(piece => String(piece.name || '').toLowerCase()))
  assert.ok(!names.some(name => name.includes('cardigan')), `a summer daytime slot should not stack a cardigan, got ${names}`)
})
