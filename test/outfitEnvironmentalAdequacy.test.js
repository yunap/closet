import test from 'node:test'
import assert from 'node:assert'
import {
  evaluateOutfitEnvironmentalAdequacy,
  ENVIRONMENTAL_ADEQUACY_CODES as C,
} from '../styling-engine/outfitEnvironmentalAdequacy.js'
import { evaluateWearableOutfit } from '../styling-engine/outfitValidation.js'
import {
  resolveWeatherContext,
  serializeResolvedWeatherContext,
  restoreResolvedWeatherContext,
} from '../styling-engine/weather.js'

// Contract C — Slice D of docs/outerwear-weather-consolidation-spec.md.

const top = (extra = {}) => ({ id: 10, category: 'top', name: 'knit top', sleeve_length: 'long', fabric_weight: 'medium', ...extra })
const bottom = () => ({ id: 11, category: 'bottom', name: 'trousers', fabric_weight: 'medium' })
const shoes = () => ({ id: 12, category: 'shoes', name: 'boots', shoe_type: 'boot' })
const CARDIGAN = { id: 20, category: 'outerwear', name: 'cashmere cardigan', outerwear_role: 'indoor_layer', fabric_weight: 'heavy', fiber_content: ['cashmere'], sleeve_length: 'long', weather_protection: [] }
const WOOL_COAT = { id: 21, category: 'outerwear', name: 'wool coat', outerwear_role: 'cold_weather_outerwear', fabric_weight: 'heavy', fiber_content: ['wool'], sleeve_length: 'long', weather_protection: [] }
const RAIN_SHELL = { id: 22, category: 'outerwear', name: 'rain shell', outerwear_role: 'protective_shell', fabric_weight: 'light', fiber_content: ['polyester'], sleeve_length: 'long', weather_protection: ['rain'] }
const SLEEVELESS_VEST = { id: 23, category: 'outerwear', name: 'quilted vest', outerwear_role: 'transition_layer', fabric_weight: 'medium', sleeve_length: 'sleeveless', sleeve_type: 'sleeveless', weather_protection: [] }
const UNTAGGED_COAT = { id: 24, category: 'outerwear', name: 'unlined coat', fabric_weight: 'light', sleeve_length: 'long' }

const codes = (r) => r.findings.map(f => f.code)
const hardCodes = (r) => r.hardFindings.map(f => f.code)

// --- no context, no verdict ------------------------------------------------------------------

test('without resolved weather context the verdict is inapplicable and silent', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes()], {})
  assert.equal(result.applicable, false)
  assert.deepEqual(result.findings, [])
})

// --- [A3] cold severity: isCold stays a floor ---------------------------------------------------

test('MILD cold: an indoor layer alone is NOT a hard failure', () => {
  // cold-severity-spec.md pins isCold as a minimum-warmth floor. A cashmere cardigan on a chilly
  // evening is a correct answer, and this slice must not turn every cool day into a coat mandate.
  const result = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), CARDIGAN], {
    weatherProfile: { isCold: true },
  })
  assert.deepEqual(hardCodes(result), [])
})

test('MILD cold: the migrated minimum-warmth floor still fires, with its original wording', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes()], {
    weatherProfile: { isCold: true },
  })
  assert.deepEqual(hardCodes(result), [C.NO_WARM_LAYER_FOR_COLD])
  assert.equal(result.hardFindings[0].message, 'no warm layer for cold weather',
    'the migrated floor keeps its exact message so no consumer behaviour changes')
})

test('MILD cold: a heavy main still satisfies the floor without any layer — unchanged allowance', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'heavy' }), bottom(), shoes()], {
    weatherProfile: { isCold: true },
  })
  assert.deepEqual(hardCodes(result), [])
})

test('SEVERE cold: an indoor layer alone IS a hard failure', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), CARDIGAN], {
    weatherProfile: { isCold: true, isColdSevere: true },
  })
  assert.deepEqual(hardCodes(result), [C.INDOOR_LAYER_ONLY_FOR_SEVERE_COLD])
})

test('SEVERE cold: a genuine cold-weather coat passes', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), WOOL_COAT], {
    weatherProfile: { isCold: true, isColdSevere: true },
  })
  assert.deepEqual(hardCodes(result), [])
})

test('SEVERE cold: cold_weather_outerwear is not the only route — a shell over insulation passes', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'heavy', fiber_content: ['wool'] }), bottom(), shoes(), RAIN_SHELL], {
    weatherProfile: { isCold: true, isColdSevere: true },
  })
  assert.deepEqual(hardCodes(result), [], 'the system is adequate even though the outer layer is thermally light')
})

test('SEVERE cold: an indoor destination does not demand outdoor outerwear', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), CARDIGAN], {
    weatherProfile: { isCold: true, isColdSevere: true }, environment: 'indoor',
  })
  assert.deepEqual(hardCodes(result), [])
})

// --- missing metadata is never hard invalidity (acceptance criterion 8) --------------------------

test('an untagged outer layer is never a hard failure, however thin its recorded fabric', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), UNTAGGED_COAT], {
    weatherProfile: { isCold: true, isColdSevere: true },
  })
  assert.deepEqual(hardCodes(result), [])
  assert.ok(codes(result).includes(C.CAPABILITY_UNKNOWN), 'it should still be disclosed as unjudgeable')
})

// --- [R2] the transit branch, both meanings -----------------------------------------------------

test('cold transit: the migrated sleeve-bearing floor still fires on a sleeveless layer', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), SLEEVELESS_VEST], {
    weatherProfile: { transitIsCold: true },
  })
  assert.ok(hardCodes(result).includes(C.NO_TRANSIT_LAYER_FOR_COLD))
})

test('cold transit: a sleeved layer satisfies the floor', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), CARDIGAN], {
    weatherProfile: { transitIsCold: true },
  })
  assert.deepEqual(hardCodes(result), [])
})

test('SEVERE cold transit: sleeve-bearing is necessary but NOT sufficient', () => {
  // This is the distinction the old Boolean(layer)/sleeve check could not draw: the cardigan has
  // sleeves and is removable, and still is not outdoor outerwear.
  const result = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), CARDIGAN], {
    weatherProfile: { transitIsCold: true, transitIsColdSevere: true },
  })
  assert.deepEqual(hardCodes(result), [C.TRANSIT_LAYER_NOT_OUTDOOR_CAPABLE])
})

// --- rain / exposure ----------------------------------------------------------------------------

test('rain alone does not require a rain-protective coat', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), WOOL_COAT], {
    weatherProfile: { isRainy: true },
  })
  assert.deepEqual(codes(result), [], 'a passing mention of rain is not meaningful wet exposure')
})

test('wet exposure without rain capability is ADVISORY, never a hard rejection', () => {
  // §6: rain must not mechanically require a rain-protective coat. isWetExposure only means wet
  // conditions were mentioned, and rain capability is tagged on 1 of 31 real outerwear pieces — a
  // hard rule would reject nearly every outfit whenever rain comes up.
  const result = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), WOOL_COAT], {
    weatherProfile: { isWetExposure: true },
  })
  assert.deepEqual(hardCodes(result), [])
  assert.ok(codes(result).includes(C.RAIN_PROTECTION_MISSING))
})

test('the same exposure softens to advisory for an indoor destination', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), WOOL_COAT], {
    weatherProfile: { isWetExposure: true }, environment: 'indoor',
  })
  assert.deepEqual(hardCodes(result), [])
  assert.ok(codes(result).includes(C.RAIN_PROTECTION_MISSING))
})

test('a rain shell satisfies wet exposure', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'heavy', fiber_content: ['wool'] }), bottom(), shoes(), RAIN_SHELL], {
    weatherProfile: { isWetExposure: true },
  })
  assert.deepEqual(hardCodes(result), [])
})

// --- [R3] unsatisfiable findings name a legal move ----------------------------------------------

test('every new hard environmental finding names the escape hatch', () => {
  // submit_plan_outfits already had to learn this once for register floors: a rejection the
  // wardrobe cannot satisfy must not leave the model resubmitting forever.
  const cases = [
    [[top(), bottom(), shoes(), CARDIGAN], { weatherProfile: { isCold: true, isColdSevere: true } }],
    [[top(), bottom(), shoes()], { weatherProfile: { isCold: true, isColdSevere: true } }],
  ]
  for (const [pieces, context] of cases) {
    const result = evaluateOutfitEnvironmentalAdequacy(pieces, context)
    // The migrated floor can fire alongside and deliberately carries no remedy (it is always
    // satisfiable) — see the next test. Only the new, supply-sensitive findings must name a move.
    const MIGRATED_FLOOR = [C.NO_WARM_LAYER_FOR_COLD, C.NO_TRANSIT_LAYER_FOR_COLD]
    const supplySensitive = result.hardFindings.filter(f => !MIGRATED_FLOOR.includes(f.code))
    assert.ok(supplySensitive.length > 0)
    for (const f of supplySensitive) {
      assert.match(f.message, /wardrobe gap|re-plan|accept the disclosed shortfall/,
        `finding ${f.code} must name a legal move`)
    }
  }
})

test('the migrated floor deliberately does NOT carry the escape hatch', () => {
  // It is always satisfiable — any layer or a heavy main clears it — so appending supply advice
  // there would be noise, and would change a message consumers already depend on.
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes()], {
    weatherProfile: { isCold: true },
  })
  assert.equal(result.hardFindings[0].message, 'no warm layer for cold weather')
})

// --- composition through the aggregator ---------------------------------------------------------

test('evaluateWearableOutfit stays silent without weatherContext and composes with it', () => {
  const pieces = [top(), bottom(), shoes(), CARDIGAN]
  const bare = evaluateWearableOutfit(pieces, { requireShoes: true })
  assert.ok(!bare.evidence.includedStages.includes('environment'))
  assert.deepEqual(bare.hardFindings, [])

  const withContext = evaluateWearableOutfit(pieces, {
    requireShoes: true,
    weatherContext: { weatherProfile: { isCold: true, isColdSevere: true } },
  })
  assert.ok(withContext.evidence.includedStages.includes('environment'))
  assert.deepEqual(withContext.hardFindings.map(f => f.code), [C.INDOOR_LAYER_ONLY_FOR_SEVERE_COLD])
  assert.equal(withContext.hardValid, false)
})

// --- [R1] severity actually survives the real plumbing -------------------------------------------

test('isColdSevere survives resolveWeatherContext and its serialize/restore round trip', () => {
  // The [R1] failure mode is a flag that exists in a hand-built fixture and is undefined in
  // production. Assert the real resolver and the real persistence shape, not a literal.
  const context = resolveWeatherContext({
    modelEstimate: { highF: 55, lowF: 40, precipitation: 'unknown', wind: 'unknown' },
    location: 'Vienna, Virginia',
    dateRange: { start: '2026-10-12', end: '2026-10-18' },
  })
  assert.equal(context.temperature.isCold, true)
  assert.equal(context.temperature.isColdSevere, true, '40F low is severe cold by the ratified <=45F rule')

  const restored = restoreResolvedWeatherContext(serializeResolvedWeatherContext(context))
  assert.equal(restored.temperature.isColdSevere, true, 'severity must survive persistence, not just resolution')
})

test('a mild band does not manufacture severity', () => {
  const context = resolveWeatherContext({
    modelEstimate: { highF: 72, lowF: 58, precipitation: 'unknown', wind: 'unknown' },
    location: 'Vienna, Virginia',
    dateRange: { start: '2026-10-12', end: '2026-10-18' },
  })
  assert.equal(context.temperature.isCold, false)
  assert.equal(context.temperature.isColdSevere, false)
})
