// Live-QA fix (thread_1788421510368): the plan path now receives thermal evidence.
//
// The band arc migrated ranking, adequacy and search evidence, and none of them is on the path a
// trip request takes. The model was handed "you must add a removable layer" plus a roster with no
// thermal signal, and put a down puffer on all seven cards of a 65/48 October week.
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
const { thermalFitPieceAdvisory, slotThermalDemandLabel } = await import('../styling-engine/outfitSetPlanner.js')
const { resolveExposureContext } = await import('../styling-engine/exposure.js')
const { requiredThermalBand } = await import('../styling-engine/thermalDemand.js')
const { validateUserWeather, resolveWeatherContext } = await import('../styling-engine/weather.js')

const W = (h, l) => ({ ...resolveWeatherContext({ userWeather: validateUserWeather({ high_f: h, low_f: l }) }).temperature })
const EXP = (w, activity = 'walking', environment = 'outdoor') => resolveExposureContext({ activity, environment }, w)
const PUFFER = { id: 1, category: 'outerwear', fabric_weight: 'heavy', insulating_layer_materials: ['down'], sleeve_length: 'long' }
const TRENCH = { id: 2, category: 'outerwear', fabric_weight: 'medium', fiber_content: ['cotton'], insulating_layer_materials: [], interior_construction: 'full_lining', sleeve_length: 'long' }

test('the puffer is marked discouraged on a 65/48 city day', () => {
  // The exact conditions of the live failure.
  const w = W(65, 48)
  const a = thermalFitPieceAdvisory(PUFFER, w, EXP(w))
  assert.equal(a.tier, 'discouraged')
  assert.match(a.reason, /warmer than these conditions/)
})

test('a proportionate layer is marked preferred in the same slot', () => {
  const w = W(65, 48)
  assert.equal(thermalFitPieceAdvisory(TRENCH, w, EXP(w)).tier, 'preferred')
})

test('the ordering reverses when it is genuinely cold', () => {
  const w = W(30, 20)
  assert.notEqual(thermalFitPieceAdvisory(PUFFER, w, EXP(w, 'none')).tier, 'discouraged')
})

test('the slot states how much warmth the conditions call for', () => {
  // The removable-layer requirement only ever said a layer was needed, never how much.
  assert.match(slotThermalDemandLabel(EXP(W(65, 48))), /moderate/)
  assert.equal(slotThermalDemandLabel(null), '', 'silent when the band has no opinion')
})

test('exertion reaches the plan path — a hike and a stroll do not resolve alike', () => {
  // Compared at the SAME environment. An earlier version of this test compared hiking/outdoor with
  // none/indoor, which both land on `light` by different routes — a coincidence, not a signal.
  const w = W(65, 48)
  const sedentary = slotThermalDemandLabel(EXP(w, 'none'))
  const walking = slotThermalDemandLabel(EXP(w, 'walking'))
  const hiking = slotThermalDemandLabel(EXP(w, 'hiking'))
  assert.notEqual(sedentary, walking)
  assert.notEqual(walking, hiking)
  assert.match(sedentary, /warm/)
  assert.match(walking, /moderate/)
  assert.match(hiking, /light/)

  // And an indoor destination is its own question, not an exertion one.
  assert.match(slotThermalDemandLabel(EXP(w, 'none', 'indoor')), /light/)
})

test('evidence, never a gate — shoes and accessories stay out of it', () => {
  // Nothing here excludes a piece: a supply-poor slot keeps whatever it has (§5.5, §19.1).
  const w = W(65, 48)
  assert.equal(thermalFitPieceAdvisory({ category: 'shoes', fabric_weight: 'heavy' }, w, EXP(w)).tier, 'neutral')
  const unplaceable = { category: 'outerwear', fabric_weight: 'medium', fiber_content: ['unknown'] }
  assert.equal(thermalFitPieceAdvisory(unplaceable, w, EXP(w)).tier, 'neutral', 'unknown stays neutral, not discouraged')
})

test('the layer requirement no longer says only that a layer is needed', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'styling-engine/outfitEnvironmentalAdequacy.js'), 'utf8')
  assert.match(src, /match the layer to the conditions rather than reaching for the warmest one available/)
  // And it must NOT restate a demand level: the roster owns that number, computed with the slot's
  // activity, which adequacy does not receive. Two numbers that can disagree are worse than one.
  assert.ok(!/roughly \$\{demand\.level\}/.test(src))
})

// ── Calendar season — a separate axis (exposure-conditions-spec §6) ──────────────────────────
const { seasonFitPieceAdvisory } = await import('../styling-engine/outfitSetPlanner.js')

test('a warm-season piece is flagged on an October trip', () => {
  // Live QA (thread_1788422794114): five outfits of five used a season=warm bottom in October.
  // Every piece carries the tag; nothing read it.
  const pant = { name: 'textured mauve relaxed pants', season: 'warm' }
  const a = seasonFitPieceAdvisory(pant, 'fall')
  assert.equal(a.tier, 'discouraged')
  assert.match(a.reason, /warm-season/)
})

test('season is one-directional and never a gate', () => {
  // An out-of-season piece is flagged; an in-season one earns nothing. A warm-season linen shirt on
  // an unusually hot October day stays wearable — it is marked, not removed.
  assert.equal(seasonFitPieceAdvisory({ season: 'cool' }, 'fall').tier, 'neutral')
  assert.equal(seasonFitPieceAdvisory({ season: 'year-round' }, 'fall').tier, 'neutral')
  assert.equal(seasonFitPieceAdvisory({ season: 'warm' }, 'summer').tier, 'neutral')
  assert.equal(seasonFitPieceAdvisory({ season: 'cool' }, 'summer').tier, 'discouraged')
})

test('season is NOT derived from the thermal band', () => {
  // §6's boundary: October at 70°F does not become summer. This must read the calendar and the
  // piece's own tag, never a demand level.
  assert.equal(seasonFitPieceAdvisory({ season: 'warm' }, 'fall').tier,
    seasonFitPieceAdvisory({ season: 'warm' }, 'winter').tier,
    'the verdict does not change with how cold it is')
  assert.equal(seasonFitPieceAdvisory({ season: 'warm' }, '').tier, 'neutral', 'no calendar, no claim')
})

// Distance, not direction. A distance-blind tier put straight-leg denim (one step over a `light`
// hiking demand at 65°F) in the same bucket as a down puffer three steps over — thread_1788425468666.
test('thermal tiers grade by distance in both directions', () => {
  const hike = W(65, 48)
  const hikeExp = EXP(hike, 'hiking')
  const DENIM = { id: 3, category: 'bottom', fabric_weight: 'medium', fiber_content: ['cotton'], subcategory: 'jeans' }
  const TEE = { id: 4, category: 'top', fabric_weight: 'light', fiber_content: ['cotton'], sleeve_length: 'short' }

  // One step over: a real preference, not a warning.
  const denim = thermalFitPieceAdvisory(DENIM, hike, hikeExp)
  assert.equal(denim.tier, 'workable', 'denim one step over a light demand must not be discouraged')
  // Three steps over: the failure this whole arc exists for.
  const puffer = thermalFitPieceAdvisory(PUFFER, hike, hikeExp)
  assert.equal(puffer.tier, 'discouraged')
  // The two must not be indistinguishable — that was the defect.
  assert.notEqual(denim.tier, puffer.tier)
  assert.ok(puffer.score < denim.score, 'further out must score worse')
  // Well matched stays preferred.
  assert.equal(thermalFitPieceAdvisory(TEE, hike, hikeExp).tier, 'preferred')
})

// The exertion discount belongs to the BASE. Applying it to the outer layer sizes the jacket for
// the middle of the climb — the one moment the jacket is off. thread_1788425468666: 65/48°F October,
// hiking shifted a `warm` demand down two steps to `light`, and the only `light` outerwear in the
// wardrobe is a sheer shrug, two knit cardigans and a technical hoodie. The engine recommended the
// hoodie for an October nature walk and ranked every real jacket below it.
const HOODIE = { id: 5, category: 'outerwear', fabric_weight: 'light', fiber_content: ['polyester'], interior_construction: 'unlined', sleeve_length: 'long' }
const FLEECE = { id: 6, category: 'outerwear', fabric_weight: 'medium', fiber_content: ['polyester'], fabric_category: 'fleece', interior_construction: 'unlined', sleeve_length: 'long' }

test('a hike does not get a lighter layer than a walk in the same weather', () => {
  const w = W(65, 48)
  const hike = requiredThermalBand(EXP(w, 'hiking'))
  const walk = requiredThermalBand(EXP(w, 'walking'))
  // The base legitimately differs — a hiker generates more heat.
  assert.notEqual(hike.level, walk.level)
  // The layer must not: both take it off at the same trailhead.
  assert.equal(hike.layer.level, walk.layer.level, 'the removable layer answers to the stops, not the pace')
})

test('an October nature walk prefers a real jacket over a technical hoodie', () => {
  const w = W(65, 48)
  const hikeExp = EXP(w, 'hiking')
  assert.equal(thermalFitPieceAdvisory(TRENCH, w, hikeExp).tier, 'preferred')
  assert.equal(thermalFitPieceAdvisory(HOODIE, w, hikeExp).tier, 'workable',
    'the lightest layer in the wardrobe must not lead an October hike')
  assert.ok(thermalFitPieceAdvisory(TRENCH, w, hikeExp).score > thermalFitPieceAdvisory(HOODIE, w, hikeExp).score)
  // And the fix must not walk the puffer back in.
  assert.equal(thermalFitPieceAdvisory(PUFFER, w, hikeExp).tier, 'discouraged')
})

test('an indoor destination sizes the coat for the trip, not the gallery', () => {
  const w = W(65, 48)
  const museum = EXP(w, 'walking', 'indoor')
  const demand = requiredThermalBand(museum)
  // The base is excused by the heated room; the layer is not.
  assert.equal(demand.level, 'light')
  assert.equal(demand.layer.level, 'moderate')
  // Level and range must come from the same band — returning transit's level beside the slot's
  // range measured distance from one band's centre against another band's edges.
  assert.ok(demand.layer.range.includes(demand.layer.level))
  assert.equal(thermalFitPieceAdvisory(TRENCH, w, museum).tier, 'preferred')
  assert.equal(thermalFitPieceAdvisory(FLEECE, w, museum).tier, 'workable')
})

// Selection, not ordering, decides the roster. thread_1788427130315 offered four outer layers per
// slot and not one was a real jacket — orderByThermalFit was sorting a bag already emptied of them.
test('roster selection offers thermally appropriate layers, not the lightest ones', async () => {
  const { selectPlanWorkbenchPieces } = await import('../styling-engine/outfitSetPlanner.js')
  const { wardrobeCategoryGroup } = await import('../styling-engine/attributes.js')
  const w = W(65, 48)
  const exposure = EXP(w, 'hiking')
  const pool = [
    PUFFER, TRENCH,
    { id: 10, category: 'outerwear', fabric_weight: 'light', fiber_content: ['acrylic'], interior_construction: 'unlined' },
    { id: 11, category: 'outerwear', fabric_weight: 'light', fiber_content: ['nylon'], interior_construction: 'unlined' },
    { id: 12, category: 'outerwear', fabric_weight: 'light', fiber_content: ['polyester'], interior_construction: 'unlined' },
    { id: 13, category: 'outerwear', fabric_weight: 'medium', fiber_content: ['wool'], interior_construction: 'full_lining' },
  ]
  const slot = { label: 'Nature Walks', activity: 'hiking', environment: 'outdoor', occasion: 'casual', stylingContext: { occasion: 'casual', calendarSeason: 'fall' } }
  const selected = selectPlanWorkbenchPieces(pool, slot, { weatherProfile: w, exposure, calendarSeason: 'fall' })
    .pieces.filter(p => wardrobeCategoryGroup(p) === 'outerwear')
  const ids = selected.map(p => Number(p.id))
  // The outerwear quota is 4 — the two proportionate layers must make the cut, ahead of three
  // interchangeable light ones.
  assert.ok(ids.includes(2), 'the trench must be offered')
  assert.ok(ids.includes(13), 'the lined wool jacket must be offered')
  const scoreOf = p => thermalFitPieceAdvisory(p, w, exposure).score
  assert.ok(scoreOf(TRENCH) > scoreOf(pool[2]), 'a proportionate layer must outrank a light one here')
})

// An indoor destination excuses the BASE, never the trip (§5.7). resolveSlotWeather stores the
// outside temperature under transit* and omits highF/lowF, so reading only highF/lowF declared the
// conditions UNKNOWN and silenced the whole thermal model on museum days.
test('an indoor slot still knows the weather it travels through', () => {
  const t = W(65, 48)
  const indoorProfile = {
    isHot: false, isCold: false, isIndoor: true,
    transitIsCold: t.isCold, transitHighF: t.highF, transitLowF: t.lowF, weatherSource: t.source,
  }
  const exposure = resolveExposureContext({ activity: 'walking', environment: 'indoor' }, indoorProfile)
  assert.equal(exposure.conditions.known, true, 'the trip has known weather even when the destination is heated')
  const demand = requiredThermalBand(exposure)
  assert.equal(demand.level, 'light', 'the heated base stays light')
  assert.equal(demand.layer.level, 'moderate', 'the coat answers to the walk there')
  assert.equal(thermalFitPieceAdvisory(PUFFER, indoorProfile, exposure).tier, 'discouraged',
    'a museum day must have something to say about a down puffer')
})

// ─── THE MODEL CONTRACT (docs/model-facing-signal-inventory.md) ────────────────────────────────
//
// The inventory's finding 1: 19 of 25 model-facing signals were derived judgments, and the garment
// thermal facts behind them were in no payload at all. A verdict the model cannot check is the
// wrong interface even when the verdict is right. These tests pin the boundary in both directions.

const SUN_HOODIE = {
  id: 990358, name: 'navy technical hoodie', category: 'outerwear',
  fabric_weight: 'light', fabric_category: 'technical/performance',
  fiber_content: ['polyester', 'spandex', 'unknown'], sleeve_length: 'long',
  season: 'year-round', reads_as: 'simple technical hoodie',
  // Both absent in the real record — nobody ever asked.
  insulating_layer_materials: null, interior_construction: null,
}

test('the catalog line carries the facts needed to judge the sun hoodie', async () => {
  const { buildPlanSlotWorkbench } = await import('../styling-engine/outfitSetPlanner.js')
  const { thermalFactsForPieceLine } = await import('../styling-engine/rules.js')
  // The five facts that separate a UPF shell from a transitional jacket. Without them the model is
  // told a warmth level and cannot tell which garment produced it. Behavioral, not a source grep —
  // this function is shared with search_wardrobe (docs/search-propose-signal-inventory.md), so a
  // source-text check against outfitSetPlanner.js would no longer even find its definition.
  const line = thermalFactsForPieceLine(SUN_HOODIE)
  for (const fact of ['warmth:', 'insulation:', 'season:', 'removable:']) {
    assert.ok(line.includes(fact), `the fact channel must state ${fact}`)
  }
  assert.ok(typeof buildPlanSlotWorkbench === 'function')
})

test('unrecorded insulation is not reported as verified-none', async () => {
  const { thermalMaterialVerdict } = await import('../styling-engine/attributes.js')
  // 23 of this wardrobe's outerwear pieces have never been asked; 7 are verified empty. Collapsing
  // the two would turn an honest gap into a confident wrong fact — the whole point of §5 of
  // material-role-representation-spec.md.
  assert.equal(thermalMaterialVerdict(SUN_HOODIE), 'unknown')
  assert.equal(thermalMaterialVerdict({ ...SUN_HOODIE, insulating_layer_materials: [] }), 'non_insulating')
  assert.equal(thermalMaterialVerdict({ ...SUN_HOODIE, insulating_layer_materials: ['down'] }), 'insulating')
})

test('no thermal or season verdict crosses into the model contract', () => {
  const src = fs.readFileSync(new URL('../styling-engine/outfitSetPlanner.js', import.meta.url), 'utf8')
  const payload = src.slice(src.indexOf('function planPieceAssessments'), src.indexOf('function idSetForPieces'))
  assert.ok(!payload.includes('thermal_fit'), 'thermal_fit is a derived styling judgment')
  assert.ok(!payload.includes('season_fit'), 'season_fit is a derived styling judgment')
  const workbench = src.slice(src.indexOf('workbenchSlots.push({'), src.indexOf('slot._modelWorkbench = {'))
  // The field, not the word — the comment explaining its removal legitimately names it.
  assert.ok(!workbench.includes('thermal_demand:'), 'the slot states conditions, not a warmth target')
  assert.ok(workbench.includes('exposure_conditions'), 'the slot must still state its conditions')
  // The instructions must not carry text whose purpose is obedience to a removed verdict.
  const instructions = src.slice(src.indexOf('const workbenchInstructions'), src.indexOf('].filter(Boolean).join', src.indexOf('const workbenchInstructions')))
  for (const gone of ['piece_assessments', 'thermal_fit', 'wrong by AMOUNT', 'aligned index-for-index']) {
    assert.ok(!instructions.includes(gone), `instruction text "${gone}" belongs to the removed contract`)
  }
})

test('conditions are stated as a range, and absent when unknown', async () => {
  const { slotExposureConditions } = await import('../styling-engine/outfitSetPlanner.js')
  const text = slotExposureConditions(EXP(W(65, 48), 'hiking'))
  assert.match(text, /54-65°F likely exposure/)
  assert.match(text, /hiking/)
  assert.match(text, /estimated window/)
  // No conditions is an empty field, never an invented range.
  assert.equal(slotExposureConditions(EXP({}, 'hiking')), '')
})

test('selection preserves thermal range, and degrades when the wardrobe cannot', async () => {
  const { selectPlanWorkbenchPieces } = await import('../styling-engine/outfitSetPlanner.js')
  const { wardrobeCategoryGroup } = await import('../styling-engine/attributes.js')
  const { garmentWarmthLevel } = await import('../styling-engine/garmentWarmth.js')
  const w = W(65, 48)
  const slot = { label: 'Nature Walks', activity: 'hiking', environment: 'outdoor', occasion: 'casual', stylingContext: { occasion: 'casual', calendarSeason: 'fall' } }
  const pick = pool => selectPlanWorkbenchPieces(pool, slot, { weatherProfile: w, exposure: EXP(w, 'hiking'), calendarSeason: 'fall' })
    .pieces.filter(p => wardrobeCategoryGroup(p) === 'outerwear')

  // A wardrobe that HAS a range must offer one: both Vienna failures were a slot holding only one
  // kind of layer, which forces the model's hand whichever kind it is.
  const varied = [
    PUFFER, TRENCH, SUN_HOODIE,
    { id: 20, category: 'outerwear', fabric_weight: 'medium', fiber_content: ['wool'], interior_construction: 'full_lining' },
    { id: 21, category: 'outerwear', fabric_weight: 'light', fiber_content: ['acrylic'], interior_construction: 'unlined' },
    { id: 22, category: 'outerwear', fabric_weight: 'light', fiber_content: ['nylon'], interior_construction: 'unlined' },
  ]
  const levels = new Set(pick(varied).map(p => garmentWarmthLevel(p) || 'unknown'))
  assert.ok(levels.size >= 3, `expected a spread of warmth levels, got ${[...levels].join()}`)

  // A wardrobe that does NOT must not have variety manufactured for it — this is a diversity
  // mechanism, not a quota.
  const flat = [1, 2, 3, 4, 5].map(id => ({ id: id + 30, category: 'outerwear', fabric_weight: 'light', fiber_content: ['acrylic'], interior_construction: 'unlined' }))
  const flatLevels = new Set(pick(flat).map(p => garmentWarmthLevel(p) || 'unknown'))
  assert.equal(flatLevels.size, 1)
  assert.ok(pick(flat).length > 0, 'a single-level wardrobe still fills the quota')
})
