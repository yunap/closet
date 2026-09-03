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
