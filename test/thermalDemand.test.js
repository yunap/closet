// Slice 3 of docs/thermal-comfort-band-spec.md §9.1 — requiredThermalBand.
// No production consumers (§8 step 1). These are §12.1's pinned cases, run end to end through
// exposure.js → requiredThermalBand → compareThermalFit.
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { resolveExposureContext } from '../styling-engine/exposure.js'
import { requiredThermalBand, compareThermalFit } from '../styling-engine/thermalDemand.js'

const W = (highF, lowF, source = 'model_estimate') => ({ temperature: { highF, lowF, source }, wind: { value: 'calm' } })
const demandFor = (slot, weather) => requiredThermalBand(resolveExposureContext(slot, weather))
const OUTDOOR = a => ({ activity: a, environment: 'outdoor' })

test('row 1 — 65/45 museum day: a cardigan beats a puffer', () => {
  // The Vienna defect, resolved at the model level. The puffer is not excluded; it is out-ranked.
  const d = demandFor(OUTDOOR('walking'), W(65, 45))
  const puffer = compareThermalFit('very warm', d)
  const cardigan = compareThermalFit('warm', d)
  assert.equal(puffer.fit, 'overshoot')
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

test('row 4 — exertion lowers required insulation at the same temperature', () => {
  // §11.1's finding from the cold-exercise literature, and the reason a hiker and a stationary
  // diner must not resolve to the same demand.
  const at = a => demandFor(OUTDOOR(a), W(40, 28)).level
  assert.equal(at('none'), 'very warm')
  assert.equal(at('walking'), 'warm')
  assert.equal(at('hiking'), 'moderate')

  // unknown is NOT none: absent exertion is not an assertion of stillness.
  assert.equal(demandFor({ environment: 'outdoor' }, W(40, 28)).exertionApplied, 'unknown')
  assert.equal(demandFor({ environment: 'outdoor' }, W(40, 28)).level, at('none'),
    'unknown shifts nothing, but it is recorded as unknown rather than claimed as none')
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
