import test from 'node:test'
import assert from 'node:assert'
import {
  evaluateOuterwearCapability,
  OUTERWEAR_CAPABILITY_CODES,
} from '../styling-engine/outerwearCapability.js'
import { pieceWeatherScores } from '../styling-engine/rules.js'

// Contract B of docs/outerwear-weather-consolidation-spec.md. These fixtures are the spec's §16
// acceptance set: the orthogonality table, the missing-metadata rule, and the eligibility boundary
// that an `insufficient` verdict is evidence rather than an exclusion.

const outer = (o) => ({ category: 'outerwear', ...o })

const CASHMERE_CARDIGAN = outer({
  id: 1, name: 'heavy cashmere cardigan', outerwear_role: 'indoor_layer',
  fabric_weight: 'heavy', fiber_content: ['cashmere'], weather_protection: [],
})
const RAIN_SHELL = outer({
  id: 2, name: 'light rain shell', outerwear_role: 'protective_shell',
  fabric_weight: 'light', fiber_content: ['polyester'], weather_protection: ['rain'],
})
const WOOL_COAT = outer({
  id: 3, name: 'heavy wool coat', outerwear_role: 'cold_weather_outerwear',
  fabric_weight: 'heavy', fiber_content: ['wool'], weather_protection: [],
})
const WINDBREAKER = outer({
  id: 4, name: 'windbreaker', outerwear_role: 'protective_shell',
  fabric_weight: 'light', fiber_content: ['nylon'], weather_protection: ['wind'],
})
const UNTAGGED_LINED_JACKET = outer({
  id: 5, name: 'substantial lined jacket', fabric_weight: 'heavy', fiber_content: ['wool'],
})

// --- Contract A / Contract B orthogonality -------------------------------------------------
// The spec's central claim: thermal warmth and outerwear function are independent axes. Assert it
// against the REAL thermal owner, not a restatement of this module's own logic — if these two ever
// collapse into one another, this is the test that fails.

test('a heavy cashmere cardigan is thermally warm AND an indoor layer — both facts hold at once', () => {
  const thermal = pieceWeatherScores(CASHMERE_CARDIGAN)
  assert.ok(thermal.cold > 0, 'the thermal owner must still see real cold-weather value here')

  const capability = evaluateOuterwearCapability(CASHMERE_CARDIGAN, { requireOutdoorLayer: true })
  assert.equal(capability.verdict, 'insufficient')
  assert.deepEqual(capability.findings.map(f => f.code), [OUTERWEAR_CAPABILITY_CODES.INDOOR_ROLE_INSUFFICIENT])
})

test('a light rain shell is thermally light AND carries real rain capability', () => {
  const thermal = pieceWeatherScores(RAIN_SHELL)
  const cardiganCold = pieceWeatherScores(CASHMERE_CARDIGAN).cold
  assert.ok(thermal.cold < cardiganCold, 'a shell must not read as warm as a heavy cashmere cardigan')
  assert.ok(thermal.cold < 0, 'the thermal owner sees a light shell as actively unhelpful in cold')

  assert.equal(evaluateOuterwearCapability(RAIN_SHELL, { requiredHazards: ['rain'] }).verdict, 'pass')
  assert.equal(evaluateOuterwearCapability(RAIN_SHELL, { requireOutdoorLayer: true }).verdict, 'pass')
})

test('a heavy wool coat is cold-weather outerwear with no automatic rain protection', () => {
  assert.equal(evaluateOuterwearCapability(WOOL_COAT, { requireOutdoorLayer: true }).verdict, 'pass')
  const rain = evaluateOuterwearCapability(WOOL_COAT, { requiredHazards: ['rain'] })
  assert.equal(rain.verdict, 'insufficient')
  assert.deepEqual(rain.findings.map(f => f.code), [OUTERWEAR_CAPABILITY_CODES.RAIN_MISSING])
})

test('a windbreaker covers wind but not rain — the two hazards never imply each other', () => {
  assert.equal(evaluateOuterwearCapability(WINDBREAKER, { requiredHazards: ['wind'] }).verdict, 'pass')
  const rain = evaluateOuterwearCapability(WINDBREAKER, { requiredHazards: ['rain'] })
  assert.equal(rain.verdict, 'insufficient')
  assert.deepEqual(rain.findings.map(f => f.code), [OUTERWEAR_CAPABILITY_CODES.RAIN_MISSING])
})

test('a protective shell satisfies the outdoor-layer requirement without implying warmth', () => {
  // Contract C's job is to notice the shell needs insulation underneath. Contract B's job is only
  // to say the shell is a legitimate outer layer — it must not reach for thermal reasoning here.
  assert.equal(evaluateOuterwearCapability(WINDBREAKER, { requireOutdoorLayer: true }).verdict, 'pass')
})

// --- Missing metadata is unknown, never invalidity ------------------------------------------

test('an untagged outerwear piece is unknown, not insufficient', () => {
  const result = evaluateOuterwearCapability(UNTAGGED_LINED_JACKET, { requireOutdoorLayer: true })
  assert.equal(result.verdict, 'unknown')
  assert.deepEqual(result.findings.map(f => f.code), [OUTERWEAR_CAPABILITY_CODES.UNKNOWN])
  assert.equal(result.evidence.capabilityTagged, false)
})

test('an unrecognized stored role reads as unknown rather than as trusted data', () => {
  const result = evaluateOuterwearCapability(outer({ outerwear_role: 'weatherproof' }), { requireOutdoorLayer: true })
  assert.equal(result.verdict, 'unknown')
})

test('a non-outerwear piece carrying a stray role is unknown, never a pass', () => {
  const strayTop = { category: 'top', outerwear_role: 'cold_weather_outerwear', weather_protection: ['rain'] }
  const result = evaluateOuterwearCapability(strayTop, { requireOutdoorLayer: true, requiredHazards: ['rain'] })
  assert.equal(result.verdict, 'unknown')
})

test('an empty weather_protection on an UNTAGGED piece is not evidence of absent protection', () => {
  // The column defaults to '[]', so absence of a hazard only means something once the piece has
  // actually been through capability tagging. Live audit 2026-08-31 found a real piece in this
  // state, so this distinction is load-bearing, not theoretical.
  const result = evaluateOuterwearCapability(UNTAGGED_LINED_JACKET, { requiredHazards: ['rain'] })
  assert.equal(result.verdict, 'unknown')
  assert.ok(!result.findings.some(f => f.code === OUTERWEAR_CAPABILITY_CODES.RAIN_MISSING))
})

test('an empty weather_protection on a TAGGED piece IS evidence of absent protection', () => {
  const result = evaluateOuterwearCapability(WOOL_COAT, { requiredHazards: ['rain', 'wind'] })
  assert.equal(result.verdict, 'insufficient')
  assert.deepEqual(result.findings.map(f => f.code).sort(),
    [OUTERWEAR_CAPABILITY_CODES.RAIN_MISSING, OUTERWEAR_CAPABILITY_CODES.WIND_MISSING].sort())
})

// --- Requirement discipline ------------------------------------------------------------------

test('with no requirement asked, every piece passes — this module never volunteers a verdict', () => {
  for (const piece of [CASHMERE_CARDIGAN, RAIN_SHELL, WOOL_COAT, WINDBREAKER]) {
    assert.equal(evaluateOuterwearCapability(piece, {}).verdict, 'pass', piece.name)
  }
  // An untagged piece with nothing asked of it produces no noise either.
  const quiet = evaluateOuterwearCapability(UNTAGGED_LINED_JACKET, {})
  assert.equal(quiet.verdict, 'unknown')
  assert.deepEqual(quiet.findings, [])
})

test('unrecognized hazards in the requirement are ignored rather than failing the piece', () => {
  const result = evaluateOuterwearCapability(WOOL_COAT, { requiredHazards: ['snow', 'cold', null] })
  assert.equal(result.verdict, 'pass')
})

test('the verdict is deterministic and carries no flow labels or prose beyond its reason', () => {
  const a = evaluateOuterwearCapability(CASHMERE_CARDIGAN, { requireOutdoorLayer: true })
  const b = evaluateOuterwearCapability(CASHMERE_CARDIGAN, { requireOutdoorLayer: true })
  assert.deepEqual(a, b)
  for (const finding of a.findings) {
    assert.deepEqual(Object.keys(finding).sort(), ['code', 'dimension', 'evidence', 'reason'])
  }
})

// --- The eligibility boundary ([A2]) ---------------------------------------------------------

test('every piece that cannot do the job alone still reports evidence, not exclusion', () => {
  // Slice C consumes these findings; none of them may become a pool rejection. This test pins the
  // shape that makes that possible: an `insufficient` verdict always names WHY, so a caller can
  // treat it as ranking/annotation input instead of a gate.
  const cases = [
    [CASHMERE_CARDIGAN, { requireOutdoorLayer: true }],
    [RAIN_SHELL, { requiredHazards: ['wind'] }],
    [WOOL_COAT, { requiredHazards: ['rain'] }],
  ]
  for (const [piece, requirement] of cases) {
    const result = evaluateOuterwearCapability(piece, requirement)
    assert.equal(result.verdict, 'insufficient', piece.name)
    assert.ok(result.findings.length > 0, `${piece.name} must explain itself`)
    assert.ok(result.findings.every(f => f.code && f.dimension && f.reason), piece.name)
  }
})
