// Slice 3 of docs/thermal-comfort-band-spec.md §9.1 — requiredThermalBand.
// These are §12.1's pinned cases, run end to end through exposure.js → requiredThermalBand →
// compareThermalFit. Production adequacy consumes the same contract.
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { resolveExposureContext } from '../styling-engine/exposure.js'
import { requiredThermalBand, requiredThermalEndpointBands, compareThermalFit } from '../styling-engine/thermalDemand.js'

const W = (highF, lowF, source = 'model_estimate') => ({ temperature: { highF, lowF, source }, wind: { value: 'calm' } })
const demandFor = (slot, weather) => requiredThermalBand(resolveExposureContext(slot, weather))
const OUTDOOR = a => ({ activity: a, environment: 'outdoor' })

test('row 1 — 65/45 museum day: a cardigan beats a puffer', () => {
  // The Vienna defect, resolved at the model level. The puffer is not excluded; it is out-ranked.
  const d = demandFor(OUTDOOR('walking'), W(65, 45))
  const puffer = compareThermalFit('very warm', d)
  const cardigan = compareThermalFit('warm', d)
  assert.equal(puffer.fit, 'adequate', 'coarse conditions keep the warmer edge inside uncertainty')
  assert.equal(cardigan.fit, 'adequate')
  assert.ok(Math.abs(cardigan.distance) < Math.abs(puffer.distance), 'the cardigan is nearer the target')
})

test('row 3 — genuinely cold: the ordering reverses on conditions alone', () => {
  // §12.1: rows 1 and 3 are the puffer incident and its inverse, and the representation must flip
  // between them with no change other than the weather.
  const d = demandFor(OUTDOOR('none'), W(30, 20))
  const puffer = compareThermalFit('very warm', d)
  const cardigan = compareThermalFit('warm', d)
  assert.equal(puffer.distance, 0, 'the puffer is now on target')
  assert.ok(cardigan.distance < 0, 'and the cardigan now falls short of it')
})

test('row 4 — ordinary walking earns no warmth credit; genuine exertion does', () => {
  // Owner correction 2026-09-07: sightseeing is not exercise and usually means longer outdoor
  // exposure. Hiking remains genuinely exertive; walking remains useful to footwear policy only.
  const at = a => demandFor(OUTDOOR(a), W(40, 28)).level
  assert.equal(at('none'), 'very warm')
  assert.equal(at('walking'), 'very warm')
  assert.equal(at('hiking'), 'moderate')

  // unknown is NOT none: absent exertion is not an assertion of stillness.
  assert.equal(demandFor({ environment: 'outdoor' }, W(40, 28)).exertionApplied, 'unknown')
  assert.equal(demandFor({ environment: 'outdoor' }, W(40, 28)).level, at('none'),
    'unknown shifts nothing, but it is recorded as unknown rather than claimed as none')
})

test('Santa Fe 60→48°F sightseeing still requires warm clothing', () => {
  const d = demandFor(OUTDOOR('walking'), W(60, 48, 'stated_user'))
  assert.equal(d.level, 'warm')
  assert.deepEqual(d.range, ['warm', 'warm'])
})

test('a stated 60→48°F exposure exposes separate warm and cold endpoint demands', () => {
  const endpoints = requiredThermalEndpointBands(
    resolveExposureContext(OUTDOOR('walking'), W(60, 48, 'stated_user')))
  assert.equal(endpoints.warm.level, 'moderate')
  assert.equal(endpoints.cold.level, 'warm')
  assert.equal(endpoints.certain, true)
})

test('row 5 — overshoot is a ranking signal, never an exclusion', () => {
  // A wardrobe whose only layer is a heavy coat still gets dressed (§5.5).
  const d = demandFor(OUTDOOR('walking'), W(70, 58))
  const f = compareThermalFit('very warm', d)
  assert.ok(f.fit.includes('overshoot'))
  assert.notEqual(f.fit, 'excluded')
  assert.ok(Number.isFinite(f.distance), 'it still reports a usable ranking distance')
})

test('row 6 — unknown garment evidence stays unknown, never neutral', () => {
  const d = demandFor(OUTDOOR('walking'), W(65, 45))
  assert.deepEqual(compareThermalFit(null, d), { fit: 'unknown', steps: null, distance: null })
})

test('coarse conditions are consumed as uncertainty, not measurement', () => {
  // §5.8. The failure this prevents is replacing "47°F is falsely precise" with "53.3°F is falsely
  // precise" — the same defect one step to the right.
  const d = demandFor(OUTDOOR('walking'), W(65, 47))
  assert.equal(d.certain, false)
  assert.equal(d.basis, 'seasonal_waking_window_estimate')
  assert.notDeepEqual(d.range[0], d.range[1], 'a coarse window must span more than one level')
})

test('a stated-user range is preserved as encountered exposure, not rewritten as a daily trough', () => {
  const exposure = resolveExposureContext(OUTDOOR('none'), W(60, 48, 'stated_user'))
  assert.equal(exposure.conditions.wakingLowF, 48)
  assert.equal(exposure.conditions.wakingHighF, 60)
  assert.equal(exposure.conditions.conditionsSource, 'stated_user_exposure_range')
  assert.equal(exposure.conditions.coarse, false)
  const demand = requiredThermalBand(exposure)
  assert.equal(demand.level, 'warm')
  assert.deepEqual(demand.range, ['warm', 'warm'])
})

test('an indoor destination excuses the base, never the trip', () => {
  // §5.7, and the inverse of the Vienna error: a first version gave the heated restaurant's BASE
  // the outdoor demand, over-dressing it exactly as the 47°F trough over-dressed the museum.
  const d = demandFor({ activity: 'none', environment: 'indoor' }, W(65, 47))
  assert.equal(d.level, 'light', 'the base is an indoor-comfort problem')
  assert.ok(d.transit, 'and the transit window keeps its own demand')
  assert.equal(d.transit.level, 'warm')
})

test('no conditions means no demand', () => {
  const d = requiredThermalBand(resolveExposureContext({ activity: 'walking' }, null))
  assert.equal(d.level, null)
  assert.equal(d.basis, 'no_conditions')
  assert.equal(compareThermalFit('warm', d).fit, 'unknown')
})

test('very warm is a bounded ceiling — no tier above it, no numeric distance', () => {
  // §15.5. The anchors cannot support granularity above the verified range, so the demand side must
  // not invent `very warm+`, an "extreme" tier, or a clo distance.
  const src = fs.readFileSync(path.join(process.cwd(), 'styling-engine/thermalDemand.js'), 'utf8')
  const live = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
  for (const banned of ['very warm+', 'extreme', 'clo']) {
    assert.ok(!live.includes(banned), `the demand side must not introduce ${banned}`)
  }
  const d = demandFor(OUTDOOR('none'), W(-20, -40))
  assert.equal(d.level, 'very warm', 'arbitrarily cold still tops out at the ceiling')
  assert.equal(compareThermalFit('very warm', d).fit, 'adequate')
})

// thread_1789526496845 (reopened a second time): converting the ambiguous daily-forecast case into
// a qualitative temperature_band threw away real numeric evidence — the demand went completely
// silent (level: null everywhere), which is not the same thing as fixing the timing defect. The
// corrected design keeps the exact numbers and adds `scope` (weather.js's validateUserWeather,
// carried through resolveTemperatureField into exposure.js's resolveConditions): 'exposure_window'
// (the default, and the only prior behavior) keeps the certain, verbatim treatment: 'daily_forecast'
// routes the SAME numbers through the identical waking-window estimate a live/model-estimated daily
// envelope already gets — real numeric demand, explicitly uncertain (`certain: false`, a WIDENED
// acceptable range around the level, not a narrowed single-value one).
//
// Demonstrated for the wardrobe's shearling coat (996868), which the roster's category-cap reserve
// (styling-engine/rules.js) sorts and cuts by thermal DISTANCE from the demand: under the certain
// exposure_window scope, `very warm` measurably overshoots a narrow `[warm, warm]` demand — exactly
// the mechanism that excluded it. Under daily_forecast scope, the demand level is still `warm` (the
// numeric evidence is not discarded), but the uncertainty widens the acceptable range to
// `[moderate, very warm]`, so the very warm coat now reads `adequate` — it is no longer penalized as
// though the daily low were a certain temperature during the outing.
test('daily_forecast scope keeps real numeric thermal demand but widens the acceptable range instead of certifying a narrow one', () => {
  const exposureWindow = demandFor(OUTDOOR('walking'), { temperature: { highF: 50, lowF: 40, source: 'stated_user', scope: 'exposure_window' }, wind: { value: 'calm' } })
  assert.equal(exposureWindow.level, 'warm', 'an exposure-window-scoped stated range resolves a real demand level')
  assert.equal(exposureWindow.certain, true, 'and the exposure/ranking engine treats it as certain, per the ratified verbatim contract for a genuinely outing-scoped statement')
  assert.equal(compareThermalFit('very warm', exposureWindow).fit, 'overshoot',
    'a very warm coat measurably overshoots this certain, narrow demand — the mechanism behind 996868\'s exclusion, correct when the range really is the outing\'s own temperature')

  const dailyForecast = demandFor(OUTDOOR('walking'), { temperature: { highF: 50, lowF: 40, source: 'stated_user', scope: 'daily_forecast' }, wind: { value: 'calm' } })
  assert.equal(dailyForecast.level, 'warm', 'the SAME real numeric demand level is preserved — this is not "no thermal opinion"')
  assert.equal(dailyForecast.certain, false, 'but not certified as certain, exactly like a live/model-estimated daily envelope')
  assert.deepEqual(dailyForecast.range, ['moderate', 'very warm'], 'uncertainty widens the acceptable range rather than narrowing to a single value')
  assert.equal(compareThermalFit('very warm', dailyForecast).fit, 'adequate',
    'the very warm coat is no longer overshoot-excluded — the daily low is no longer treated as a certain outing temperature')
})

test('exposure is a named required input, not a weather blob', () => {
  // §9.1. Passing a bare forecast here is how a 5am trough came to size a museum visit.
  const src = fs.readFileSync(path.join(process.cwd(), 'styling-engine/thermalDemand.js'), 'utf8')
  const live = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
  assert.ok(!live.includes('dailyLowF'), 'the demand must never read the 24-hour trough')
  assert.ok(live.includes('wakingLowF'), 'it reads the exposure window')
  for (const banned of ['isCold', 'needsRemovableCoolLayer', 'pieceWeatherScores']) {
    assert.ok(!live.includes(banned), `must not consume ${banned}`)
  }
})
