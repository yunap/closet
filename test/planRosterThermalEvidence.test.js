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

test('ids and assessments share one order', () => {
  // A first version ordered the ids and left the assessments alone, so assessment[i] no longer
  // described allowed_piece_ids[i] — a silent mismatch in the payload this fix exists to trust.
  const src = fs.readFileSync(path.join(process.cwd(), 'styling-engine/outfitSetPlanner.js'), 'utf8')
  assert.match(src, /allowed_piece_ids: thermallyOrdered\.map/)
  assert.match(src, /piece_assessments: thermallyOrdered\.map/)
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

test('the two advisories stay separate in the payload', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'styling-engine/outfitSetPlanner.js'), 'utf8')
  assert.match(src, /thermal_fit: thermalFitPieceAdvisory/)
  assert.match(src, /season_fit: seasonFitPieceAdvisory/)
  // seasonFitPieceAdvisory must not consult any thermal value.
  const fn = src.slice(src.indexOf('export function seasonFitPieceAdvisory'))
    .slice(0, src.slice(src.indexOf('export function seasonFitPieceAdvisory')).indexOf('\n}\n'))
  for (const banned of ['requiredThermalBand', 'weatherFitForPiece', 'garmentWarmthLevel', 'weatherProfile']) {
    assert.ok(!fn.includes(banned), `season must not read ${banned}`)
  }
})

// The payload carried piece_assessments long before anything told the model the field existed.
// Delivering correct evidence in an undocumented field is the same as not delivering it —
// thread_1788424519744 put an engine-`discouraged` puffer on four of six 65/48°F looks.
test('the workbench documents the assessment payload and its tier vocabulary', async () => {
  const { buildPlanSlotWorkbench } = await import('../styling-engine/outfitSetPlanner.js')
  const src = fs.readFileSync(new URL('../styling-engine/outfitSetPlanner.js', import.meta.url), 'utf8')
  const instructions = src.slice(src.indexOf('const workbenchInstructions'), src.indexOf('].filter(Boolean).join', src.indexOf('const workbenchInstructions')))
  for (const term of ['piece_assessments', 'thermal_fit', 'season_fit', 'thermal_demand', 'calendar_season']) {
    assert.ok(instructions.includes(term), `workbench instructions must name ${term}`)
  }
  // Each tier the advisories can emit must be defined where every slot sees it, not only in the
  // extreme-heat branch that used to be the sole definition site.
  for (const tier of ['preferred', 'workable', 'neutral', 'discouraged', 'prohibited']) {
    assert.ok(instructions.includes(`\`${tier}\``), `tier ${tier} must be defined in the shared instructions`)
  }
  assert.ok(typeof buildPlanSlotWorkbench === 'function')
})
