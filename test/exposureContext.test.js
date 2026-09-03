// docs/exposure-conditions-spec.md — Slice 2 acceptance.
//
// Case A is the acceptance case for the exposure-context plumbing: the owner READS the right
// contextual variables. It is NOT the Vienna fix — case B is, and case B needs step 4 (§4.4).
// A run where the hike and the dinner diverge while the museum is still sized against 47°F has
// passed A and failed B.
import test from 'node:test'
import assert from 'node:assert'
import { resolveExposureContext, exposureContextsDiffer, EXERTION_LEVELS, EXPOSURE_MODES } from '../styling-engine/exposure.js'
import { ACTIVITY_VALUES } from '../styling-engine/stylingIntent.js'

// The real Vienna forecast, and the real slot shapes the model declared on that turn.
const VIENNA = { temperature: { highF: 65, lowF: 47, source: 'model_estimate' }, wind: { value: 'calm' } }
const MUSEUM = { occasion: 'city', activity: 'walking', environment: 'outdoor' }
const HIKE = { occasion: 'casual', activity: 'hiking', environment: 'outdoor' }
const DINNER = { occasion: 'smart casual', activity: 'none', environment: 'indoor' }

test('A — same date, location and forecast, three slots, not identical', () => {
  const museum = resolveExposureContext(MUSEUM, VIENNA)
  const hike = resolveExposureContext(HIKE, VIENNA)
  const dinner = resolveExposureContext(DINNER, VIENNA)

  for (const [label, a, b] of [['museum/hike', museum, hike], ['museum/dinner', museum, dinner], ['hike/dinner', hike, dinner]]) {
    const { differ, reasons } = exposureContextsDiffer(a, b)
    assert.ok(differ, `${label} resolved identically — the Vienna defect, unfixed`)
    assert.ok(reasons.length, `${label} must say WHY it differs`)
  }

  // Divergence must come from the declared physical facts, not from an arbitrary per-occasion
  // constant (spec §9 case A). These three share a forecast and differ only on activity/environment.
  assert.equal(museum.exertion, 'walking')
  assert.equal(hike.exertion, 'hiking')
  assert.equal(dinner.exposureMode, 'indoor_destination')
  assert.deepEqual(
    [museum.conditions.highF, hike.conditions.highF, dinner.conditions.highF], [65, 65, 65],
    'the forecast is genuinely shared — the divergence is not smuggled in through the weather')
})

test('A is not case B — the conditions are still the coarse daily envelope', () => {
  // The guard against declaring victory early. Step 2 proves the variables are consumed; the
  // museum is STILL sized against a 47°F pre-dawn trough until step 4 replaces this.
  const museum = resolveExposureContext(MUSEUM, VIENNA)
  assert.equal(museum.conditions.coarse, true,
    'while coarse is true, case B is unfixed and no run may be reported as a fixed Vienna plan')
  assert.equal(museum.conditions.lowF, 47)
})

test('occasion never reaches the exposure context', () => {
  // §4.1: no semantic rules. "evening means an evening window", "museum means daytime" — an earlier
  // draft derived exposure from meanings, which invents a model Closet does not own.
  const a = resolveExposureContext({ activity: 'walking', environment: 'outdoor', occasion: 'evening' }, VIENNA)
  const b = resolveExposureContext({ activity: 'walking', environment: 'outdoor', occasion: 'city' }, VIENNA)
  assert.deepEqual(a, b, 'occasion must not change the resolved exposure')

  const src = fsRead('styling-engine/exposure.js')
  const live = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
  assert.ok(!live.some(l => /\boccasion\b/.test(l)), 'exposure.js must not read occasion at all')
})

test('unknown exertion is not none — the metabolic claim vs the absent answer', () => {
  // normalizeActivity returns 'none' for both "stationary" and "nobody said". As a thermal input
  // those are different claims, and collapsing them is the null-vs-[] defect on a new field.
  assert.equal(resolveExposureContext({ environment: 'outdoor' }, VIENNA).exertion, 'unknown')
  assert.equal(resolveExposureContext({ activity: '', environment: 'outdoor' }, VIENNA).exertion, 'unknown')
  assert.equal(resolveExposureContext({ activity: 'none', environment: 'outdoor' }, VIENNA).exertion, 'none')
  assert.equal(resolveExposureContext({ activity: 'sprinting', environment: 'outdoor' }, VIENNA).exertion, 'unknown',
    'off-vocabulary is unknown, never silently none')
  assert.ok(EXERTION_LEVELS.includes('unknown') && EXERTION_LEVELS.includes('none'))
})

test('F — absent context is explicitly unknown, never "outdoors, all day"', () => {
  const bare = resolveExposureContext({}, null)
  assert.equal(bare.exertion, 'unknown')
  assert.equal(bare.exposureMode, 'unknown')
  assert.equal(bare.conditions.known, false)
  assert.deepEqual(bare.unknownFields.sort(), ['conditions', 'duration', 'exertion', 'exposureMode'])
})

test('E — an indoor destination excuses the base, never the trip', () => {
  const dinner = resolveExposureContext(DINNER, VIENNA)
  assert.equal(dinner.exposureMode, 'indoor_destination')
  assert.equal(dinner.transit.applies, true)
  assert.equal(dinner.transit.conditions.lowF, 47, 'the transit window still carries real conditions')

  const outdoors = resolveExposureContext(MUSEUM, VIENNA)
  assert.equal(outdoors.transit.applies, false, 'an outdoor slot has no separate transit window')
})

test('duration is absent and stays absent', () => {
  // One of only three variables the standard input model wants that Closet has no field for.
  // Defaulting it to all-day would be inventing data (§2.2, §4.3).
  const c = resolveExposureContext(MUSEUM, VIENNA)
  assert.equal(c.duration, null)
  assert.ok(c.unknownFields.includes('duration'))
})

test('wind reaches the exposure context, which is more than it reaches today', () => {
  // §2.2: wind is resolved per turn and currently visible only to weather_protection, never to the
  // thermal model. Whether the band reads it is the band's call; establishing the pipe is this one's.
  const windy = resolveExposureContext(MUSEUM, { ...VIENNA, wind: { value: 'windy' } })
  assert.equal(windy.conditions.wind, 'windy')
  assert.equal(resolveExposureContext(MUSEUM, { temperature: { highF: 65, lowF: 47 } }).conditions.wind, 'unknown')
})

test('this module computes no warmth, no demand and no threshold', () => {
  // The ownership boundary. It resolves the exposure half of requiredThermalBand and hands it over;
  // the band, its scale and its thresholds belong to thermal-comfort-band-spec.md (spec §7).
  const src = fsRead('styling-engine/exposure.js')
  const live = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
  for (const banned of ['pieceWeatherScores', 'thermalMaterialVerdict', 'isCold', 'needsRemovableCoolLayer']) {
    assert.ok(!live.some(l => l.includes(banned)), `exposure.js must not reference ${banned}`)
  }
  // No Fahrenheit constants: a threshold here would be the fifth weather rule this arc exists to avoid.
  assert.ok(!live.some(l => /[<>]=?\s*\d{2}\b/.test(l) && /F\b|temp|cold|warm/i.test(l)),
    'exposure.js must contain no temperature threshold')
})

test('the vocabularies stay derived, not re-listed', () => {
  assert.deepEqual(EXERTION_LEVELS, ['unknown', ...ACTIVITY_VALUES],
    'exertion levels must derive from ACTIVITY_VALUES — widening the tagging vocabulary must widen this')
  assert.deepEqual(EXPOSURE_MODES, ['unknown', 'indoor_destination', 'sustained_outdoor'])
})

import fs from 'node:fs'
import path from 'node:path'
function fsRead(f) { return fs.readFileSync(path.join(process.cwd(), f), 'utf8') }
