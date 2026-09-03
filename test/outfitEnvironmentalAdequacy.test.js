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

// --- a thin base under a real outer layer: two tiers, split by evidence --------------------------

test('SEVERE cold: a MEASURED thin base under a good coat is a hard finding', () => {
  // Live "Trail Tee, Pants & Puffer": a light warm-season tee and light warm-season track pants
  // under a winter puffer. The shortfall was detected (systemCold 4 against a floor of 12) and was
  // advisory, so it never rendered and the card shipped. Every base piece is tagged, so this is a
  // measurement, not a gap.
  const tee = top({ fabric_weight: 'light', fiber_content: ['cotton'], sleeve_length: 'short' })
  const trackPants = { id: 11, category: 'bottom', name: 'track pants', fabric_weight: 'light', fiber_content: ['polyester'] }
  const result = evaluateOutfitEnvironmentalAdequacy([tee, trackPants, shoes(), WOOL_COAT], {
    weatherProfile: { isCold: true, isColdSevere: true },
  })
  assert.deepEqual(hardCodes(result), [C.THERMAL_CAPACITY_INSUFFICIENT])
  assert.match(result.hardFindings[0].message, /wardrobe gap|re-plan/, 'a supply-sensitive finding names a legal move')
})

test('SEVERE cold: an UNMEASURED base under the same coat stays advisory', () => {
  // The distinction acceptance criterion 8 turns on. Nothing is known about these garments, so the
  // low total is absence of evidence rather than evidence of absence.
  const result = evaluateOutfitEnvironmentalAdequacy(
    [{ id: 10, category: 'top', name: 'untagged top' }, { id: 11, category: 'bottom', name: 'untagged bottom' }, shoes(), RAIN_SHELL],
    { weatherProfile: { isCold: true, isColdSevere: true } },
  )
  assert.deepEqual(hardCodes(result), [])
  assert.ok(codes(result).includes(C.THERMAL_CAPACITY_INSUFFICIENT))
})

test('SEVERE cold: a measured but genuinely warm base passes', () => {
  // The split must not turn "fully tagged" into "suspicious" — a tagged heavy base clears the floor.
  const result = evaluateOutfitEnvironmentalAdequacy(
    [top({ fabric_weight: 'heavy', fiber_content: ['wool'] }), bottom(), shoes(), RAIN_SHELL],
    { weatherProfile: { isCold: true, isColdSevere: true } },
  )
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
  // Fixture changed 2026-09-01: it was 55/40, asserted severe "because the 40F low is <= 45F". That
  // rule was wrong for a range and has been replaced — severity now comes from the daytime HIGH,
  // since the low occurs before dawn. This test's subject is PERSISTENCE, so it keeps a genuinely
  // severe range and the round-trip assertion is unchanged.
  const context = resolveWeatherContext({
    modelEstimate: { highF: 42, lowF: 38, precipitation: 'unknown', wind: 'unknown' },
    location: 'Vienna, Virginia',
    dateRange: { start: '2026-10-12', end: '2026-10-18' },
  })
  assert.equal(context.temperature.isCold, true)
  assert.equal(context.temperature.isColdSevere, true, 'a 42F high never gets out of cold')

  const restored = restoreResolvedWeatherContext(serializeResolvedWeatherContext(context))
  assert.equal(restored.temperature.isColdSevere, true, 'severity must survive persistence, not just resolution')
})

test('a warm day with a cold pre-dawn low is NOT severe cold', () => {
  // The live defect: a 65F/45F week-long trip resolved as severe cold because the LOW touched 45,
  // which put a puffer coat in all five cards including a 65F city walk. The low happens while the
  // wearer is asleep; the high is what they are dressed for.
  const context = resolveWeatherContext({
    modelEstimate: { highF: 65, lowF: 45, precipitation: 'unknown', wind: 'unknown' },
    location: 'Vienna, Virginia',
    dateRange: { start: '2026-10-12', end: '2026-10-19' },
  })
  assert.equal(context.temperature.isCold, true, 'the minimum-warmth floor still applies — a 45F morning wants a layer')
  assert.equal(context.temperature.isColdSevere, false, 'but "heavy is what you actually want" must not fire')
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

// --- needsRemovableCoolLayer (docs/cool-weather-tier-spec.md) -----------------------------------

test('COOL: an outfit with no layer at all is a hard finding', () => {
  // The live defect: a 65F/48F October day produced no weather handling whatsoever, because isCold
  // needs lowF <= 45. Both Sightseeing cards shipped with no outer layer; one was a sleeveless tank.
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes()], {
    weatherProfile: { needsRemovableCoolLayer: true },
  })
  assert.deepEqual(hardCodes(result), [C.NO_REMOVABLE_COOL_LAYER])
  assert.match(result.hardFindings[0].message, /wardrobe gap|re-plan/, 'supply-sensitive findings name a legal move')
})

test('COOL: any layer satisfies it — an indoor_layer cardigan counts', () => {
  // This tier asks for removable coverage, not outdoor capability. An indoor_layer is a perfectly
  // good answer to "it gets cool at dusk"; requiring outdoor capability is the severe tier's job.
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes(), CARDIGAN], {
    weatherProfile: { needsRemovableCoolLayer: true },
  })
  assert.deepEqual(hardCodes(result), [])
})

test('COOL: a WARM BASE does not satisfy it — removability is the point', () => {
  // On a 72F/55F day, accepting a heavy long-sleeved top would approve an outfit that is too warm
  // through the 72F afternoon AND still has nothing to add at dusk. The base may stay mild; what is
  // required is something to put on.
  const result = evaluateOutfitEnvironmentalAdequacy(
    [top({ fabric_weight: 'heavy', fiber_content: ['wool'], sleeve_length: 'long' }), bottom(), shoes()],
    { weatherProfile: { needsRemovableCoolLayer: true } },
  )
  assert.deepEqual(hardCodes(result), [C.NO_REMOVABLE_COOL_LAYER])
})

test('COOL: silent on a genuinely warm day', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes()], {
    weatherProfile: {},
  })
  assert.deepEqual(codes(result), [])
})

test('COOL: does not double-fire with the isCold floor', () => {
  // Below 45F the minimum-warmth floor already owns this outfit, and it accepts a heavy main where
  // this tier would not. Two findings for one outfit would be noise, so the tiers stay disjoint by
  // construction until §8's isCold consumer audit unifies them.
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes()], {
    weatherProfile: { needsRemovableCoolLayer: true, isCold: true },
  })
  assert.deepEqual(hardCodes(result), [C.NO_WARM_LAYER_FOR_COLD])
})

test('COOL: an indoor destination needs no layer for the destination itself', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes()], {
    weatherProfile: { needsRemovableCoolLayer: true }, environment: 'indoor',
  })
  assert.deepEqual(hardCodes(result), [])
})

test('the signal survives real resolution and its persistence round trip', () => {
  // [R1]'s lesson: propagate at the source and assert against the real resolver, not a literal.
  const context = resolveWeatherContext({
    modelEstimate: { highF: 65, lowF: 48, precipitation: 'unknown', wind: 'unknown' },
    location: 'Vienna, Virginia',
    dateRange: { start: '2026-10-12', end: '2026-10-19' },
  })
  assert.equal(context.temperature.isCold, false, '48F clears the isCold cliff — this is the blind spot')
  assert.equal(context.temperature.needsRemovableCoolLayer, true)

  const restored = restoreResolvedWeatherContext(serializeResolvedWeatherContext(context))
  assert.equal(restored.temperature.needsRemovableCoolLayer, true)
})

test('a genuinely warm day does not manufacture a cool-layer requirement', () => {
  const context = resolveWeatherContext({
    modelEstimate: { highF: 85, lowF: 68, precipitation: 'unknown', wind: 'unknown' },
    location: 'Vienna, Virginia',
    dateRange: { start: '2026-07-12', end: '2026-07-19' },
  })
  assert.equal(context.temperature.needsRemovableCoolLayer, false)
})

test('COOL TRANSIT: an indoor destination excuses the base, never the trip there', () => {
  // Live: `museum` and `gallery` classify as indoor, so the outdoor cool branch skips those slots.
  // With nothing reading transitNeedsRemovableCoolLayer, two Museum Visits cards shipped as a bare
  // dress plus shoes for a 48F walk to and from the building.
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes()], {
    weatherProfile: { isIndoor: true, transitNeedsRemovableCoolLayer: true }, environment: 'indoor',
  })
  assert.deepEqual(hardCodes(result), [C.NO_REMOVABLE_COOL_LAYER_FOR_TRANSIT])
})

test('COOL TRANSIT: any layer satisfies it — including a sleeveless one', () => {
  // The gradient is deliberate: cool transit asks for something to put on, cold transit asks for
  // something that covers your arms. A vest is a legitimate answer to a 50F walk to dinner.
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes(), SLEEVELESS_VEST], {
    weatherProfile: { isIndoor: true, transitNeedsRemovableCoolLayer: true }, environment: 'indoor',
  })
  assert.deepEqual(hardCodes(result), [])
})

test('COOL TRANSIT: does not double-fire with the cold-transit floor', () => {
  // Below 45F the cold-transit floor already owns it AND demands more (sleeve-bearing), so the
  // cool tier stands down rather than adding a second, weaker finding for the same outfit.
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes()], {
    weatherProfile: { isIndoor: true, transitIsCold: true, transitNeedsRemovableCoolLayer: true }, environment: 'indoor',
  })
  assert.deepEqual(hardCodes(result), [C.NO_TRANSIT_LAYER_FOR_COLD])
})

test('COOL TRANSIT: silent when the trip itself is warm', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes()], {
    weatherProfile: { isIndoor: true }, environment: 'indoor',
  })
  assert.deepEqual(codes(result), [])
})

test('COOL: a see-through layer does not satisfy the tier', () => {
  // Live regression of my own making: `!layers.length` is Boolean(layer) — the exact shortcut §7 of
  // the consolidation spec deletes from the cold branch, reintroduced one tier up. Two cards
  // satisfied "you need something to put on" with a semi_sheer shrug scoring -8.
  const shrug = { id: 30, category: 'outerwear', name: 'sheer shrug', outerwear_role: 'indoor_layer', fabric_weight: 'light', opacity: 'semi_sheer', fiber_content: ['polyester'] }
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes(), shrug], {
    weatherProfile: { needsRemovableCoolLayer: true },
  })
  assert.deepEqual(hardCodes(result), [C.COOL_LAYER_IS_SEE_THROUGH])
})

test('COOL: a cardigan satisfies it, and so does a light opaque jacket', () => {
  // The bar is see-through-ness, not a thermal cutoff. A light unlined jacket scores BELOW a sheer
  // shrug is not true — it scores -2 against the shrug's -8 — and any threshold excluding the shrug
  // would also exclude the jacket, which is reasonable cool-evening outerwear.
  const lightJacket = { id: 32, category: 'outerwear', name: 'light cotton jacket', fabric_weight: 'light', opacity: 'opaque', fiber_content: ['cotton'], sleeve_length: 'long' }
  const jacketResult = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes(), lightJacket], {
    weatherProfile: { needsRemovableCoolLayer: true },
  })
  assert.deepEqual(hardCodes(jacketResult), [])
})

test('COOL: a cardigan satisfies it', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes(), CARDIGAN], {
    weatherProfile: { needsRemovableCoolLayer: true },
  })
  assert.deepEqual(hardCodes(result), [])
})

test('COOL: a layer with UNSET opacity counts as adequate', () => {
  // Criterion 8 again. Unknown is not inadequate, and treating it so is the mistake this arc has
  // already made twice.
  const untagged = { id: 31, category: 'outerwear', name: 'untagged jacket' }
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes(), untagged], {
    weatherProfile: { needsRemovableCoolLayer: true },
  })
  assert.deepEqual(hardCodes(result), [])
})

test('COOL TRANSIT: the adequacy bar applies there too', () => {
  const shrug = { id: 30, category: 'outerwear', name: 'sheer shrug', fabric_weight: 'light', opacity: 'semi_sheer', fiber_content: ['polyester'] }
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes(), shrug], {
    weatherProfile: { isIndoor: true, transitNeedsRemovableCoolLayer: true }, environment: 'indoor',
  })
  assert.deepEqual(hardCodes(result), [C.COOL_LAYER_IS_SEE_THROUGH])
})

// --- piece.season corroboration (docs/piece-season-as-weather-evidence.md) -----------------------

const warmTop = (id = 40) => ({ id, category: 'top', name: 'summer tee', fabric_weight: 'light', season: 'warm' })
const warmBottom = (id = 41) => ({ id, category: 'bottom', name: 'linen pants', fabric_weight: 'light', season: 'warm' })
const neutralTop = (id = 42) => ({ id, category: 'top', name: 'knit top', fabric_weight: 'light', season: 'year-round' })
const neutralBottom = (id = 43) => ({ id, category: 'bottom', name: 'trousers', fabric_weight: 'light', season: 'year-round' })

test('season NEVER creates a finding — a warm-season base with a real layer is fine', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([warmTop(), warmBottom(), shoes(), CARDIGAN], {
    weatherProfile: { needsRemovableCoolLayer: true },
  })
  assert.deepEqual(codes(result), [], 'no physical shortfall, so nothing for season to corroborate')
})

test('season corroborates a shortfall the physical rule already found', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([warmTop(), warmBottom(), shoes()], {
    weatherProfile: { needsRemovableCoolLayer: true },
  })
  assert.deepEqual(hardCodes(result), [C.NO_REMOVABLE_COOL_LAYER])
  assert.match(result.hardFindings[0].message, /tagged as warm-season clothing/)
  assert.equal(result.evidence.baseIsWarmSeasonOnly, true)
})

test('THE CONTROL: the same shortfall fires without season corroboration', () => {
  // This is what keeps the evidence hierarchy honest. Swap the season tags for `year-round` and the
  // finding is identical in code and severity — only the explanatory clause disappears. Delete the
  // corroboration entirely and every finding still fires.
  const withSeason = evaluateOutfitEnvironmentalAdequacy([warmTop(), warmBottom(), shoes()], {
    weatherProfile: { needsRemovableCoolLayer: true },
  })
  const withoutSeason = evaluateOutfitEnvironmentalAdequacy([neutralTop(), neutralBottom(), shoes()], {
    weatherProfile: { needsRemovableCoolLayer: true },
  })
  assert.deepEqual(hardCodes(withoutSeason), hardCodes(withSeason), 'same code')
  assert.equal(withoutSeason.hardFindings[0].severity, withSeason.hardFindings[0].severity, 'same severity')
  assert.doesNotMatch(withoutSeason.hardFindings[0].message, /warm-season/)
  assert.ok(!withoutSeason.evidence.baseIsWarmSeasonOnly)
})

test('a MIXED base does not corroborate — every piece must be warm-season', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([warmTop(), neutralBottom(), shoes()], {
    weatherProfile: { needsRemovableCoolLayer: true },
  })
  assert.deepEqual(hardCodes(result), [C.NO_REMOVABLE_COOL_LAYER])
  assert.doesNotMatch(result.hardFindings[0].message, /warm-season/)
})

test('season corroboration reaches the transit finding too', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([warmTop(), warmBottom(), shoes()], {
    weatherProfile: { isIndoor: true, transitNeedsRemovableCoolLayer: true }, environment: 'indoor',
  })
  assert.deepEqual(hardCodes(result), [C.NO_REMOVABLE_COOL_LAYER_FOR_TRANSIT])
  assert.match(result.hardFindings[0].message, /tagged as warm-season clothing/)
})

test('season does not leak into the cold or severe tiers', () => {
  // Those tiers have better physical evidence and were deliberately left alone; the corroboration
  // is scoped to the cool tier only.
  const result = evaluateOutfitEnvironmentalAdequacy([warmTop(), warmBottom(), shoes()], {
    weatherProfile: { isCold: true },
  })
  assert.deepEqual(hardCodes(result), [C.NO_WARM_LAYER_FOR_COLD])
  assert.doesNotMatch(result.hardFindings[0].message, /warm-season/)
})
