import test from 'node:test'
import assert from 'node:assert'
import {
  evaluateOutfitEnvironmentalAdequacy,
  ENVIRONMENTAL_ADEQUACY_CODES as C,
  advisoryFindingsToSystemFlags,
  collapseWarmthAdvisoryFindings,
} from '../styling-engine/outfitEnvironmentalAdequacy.js'
import { evaluateWearableOutfit, evaluateLayerPairConstruction } from '../styling-engine/outfitValidation.js'
import {
  resolveWeatherContext,
  validateUserWeather,
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
const advisoryCodes = (r) => r.advisoryFindings.map(f => f.code)

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
    weatherProfile: { isCold: true, coldPresenceRequirement: { state: 'required' } },
  })
  assert.deepEqual(hardCodes(result), [])
})

test('MILD cold: the migrated minimum-warmth floor still fires, with its original wording', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes()], {
    weatherProfile: { isCold: true, coldPresenceRequirement: { state: 'required' } },
  })
  assert.deepEqual(hardCodes(result), [C.NO_WARM_LAYER_FOR_COLD])
  assert.equal(result.hardFindings[0].message, 'no warm layer for cold weather',
    'the migrated floor keeps its exact message so no consumer behaviour changes')
})

test('MILD cold: a heavy main still satisfies the floor without any layer — unchanged allowance', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'heavy' }), bottom(), shoes()], {
    weatherProfile: { isCold: true, coldPresenceRequirement: { state: 'required' } },
  })
  assert.deepEqual(hardCodes(result), [])
})

// thread_1788513419132: a live trip card passed this exact floor on a "thin UPF technical hoodie"
// purely because its category was 'outerwear' -- its own tagged facts (ultralight, explicitly
// uninsulated, explicitly unlined) said the opposite of "minimum warm layer." Deliberately does NOT
// use outerwear_role (docs/outerwear-role-ontology-spec.md: deprecated, no replacement tag, value
// must not be read as garment evidence) even though the real piece happened to carry
// outerwear_role: 'indoor_layer' -- the fix must stand on the other four facts alone.
const UPF_SUN_HOODIE = {
  id: 30, category: 'outerwear', name: 'thin UPF technical hoodie',
  fabric_weight: 'ultralight',
  insulating_layer_materials: [], // manually asserted empty -> thermalMaterialVerdict: non_insulating
  interior_construction: 'unlined', // manually asserted -> only a human can write this value
  weather_protection: [],
  fiber_content: ['polyester', 'spandex'],
  fabric_category: 'technical/performance',
  outerwear_role: 'indoor_layer', // present on the real piece; must NOT be why this test passes
}

test('MILD cold: an ultralight, uninsulated, unlined outerwear piece does NOT satisfy the minimum-warmth floor', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), UPF_SUN_HOODIE], {
    weatherProfile: { isCold: true, coldPresenceRequirement: { state: 'required' } },
  })
  assert.deepEqual(hardCodes(result), [C.NO_WARM_LAYER_FOR_COLD],
    'category alone must no longer override three converging negative facts')
})

test('MILD cold: any ONE negative fact alone is not enough -- convergence, not a single-field rule', () => {
  // Ultralight alone (construction and material both genuinely unknown, not asserted negative) must
  // not be penalized -- an ultralight rain shell or an ultralight piece nobody has fully tagged yet
  // is not automatically inadequate.
  const onlyUltralight = { id: 31, category: 'outerwear', name: 'untagged ultralight layer', fabric_weight: 'ultralight' }
  const result = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), onlyUltralight], {
    weatherProfile: { isCold: true, coldPresenceRequirement: { state: 'required' } },
  })
  assert.deepEqual(hardCodes(result), [], 'a single negative fact, with the rest unknown, must not hard-fail')
})

test('MILD cold: weather_protection does NOT rescue an ultralight, explicitly non-insulating, unlined shell', () => {
  // This function answers a WARMTH-presence question, not a protection question. A wind/rain shell
  // can be doing a real protective job while providing essentially no insulation -- passing it on
  // weather_protection alone would conflate this contract with the separate protection/capability
  // one (outerwearCapability.js). Its weather-protection value still matters there, just not here.
  const windShell = { ...UPF_SUN_HOODIE, id: 32, weather_protection: ['wind'] }
  const result = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), windShell], {
    weatherProfile: { isCold: true, coldPresenceRequirement: { state: 'required' } },
  })
  assert.deepEqual(hardCodes(result), [C.NO_WARM_LAYER_FOR_COLD],
    'weather_protection answers a different contract and must not cancel explicit thermal inadequacy')
})

test('MILD cold: full_lining cancels only the unlined vote it controls, flipping a borderline 2-signal case', () => {
  // Two negative facts (ultralight + unlined; material genuinely unknown, not asserted negative)
  // converge to inadequate.
  const ultralightUnlined = { id: 35, category: 'outerwear', name: 'thin unlined layer', fabric_weight: 'ultralight', interior_construction: 'unlined' }
  const unlinedResult = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), ultralightUnlined], {
    weatherProfile: { isCold: true, coldPresenceRequirement: { state: 'required' } },
  })
  assert.deepEqual(hardCodes(unlinedResult), [C.NO_WARM_LAYER_FOR_COLD],
    'sanity: two converging negative facts (ultralight + unlined) do fail the floor')

  // Replacing 'unlined' with an ordinary lining removes exactly that one vote, dropping back to a
  // single negative fact (ultralight) -- per prompts.js, an ordinary lining is explicitly NOT an
  // insulating layer, so it is not itself positive evidence; it only stops the unlined vote.
  const ultralightLined = { ...ultralightUnlined, id: 36, interior_construction: 'full_lining' }
  const linedResult = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), ultralightLined], {
    weatherProfile: { isCold: true, coldPresenceRequirement: { state: 'required' } },
  })
  assert.deepEqual(hardCodes(linedResult), [],
    'one remaining negative fact (ultralight alone) must not fail it -- construction cancelled its own vote, nothing more')
})

test('MILD cold: full_lining does not rescue a piece whose OTHER negative facts still independently converge', () => {
  // UPF_SUN_HOODIE with full_lining instead of unlined: the unlined vote is gone, but ultralight and
  // explicitly non-insulating still converge at 2 on their own -- construction is not a blanket
  // override, it only ever controls the one vote that is its own.
  const linedButThin = { ...UPF_SUN_HOODIE, id: 37, interior_construction: 'full_lining' }
  const result = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), linedButThin], {
    weatherProfile: { isCold: true, coldPresenceRequirement: { state: 'required' } },
  })
  assert.deepEqual(hardCodes(result), [C.NO_WARM_LAYER_FOR_COLD],
    'construction can only cancel the unlined vote -- it cannot rescue independently-converging negative facts')
})

test('MILD cold: outerwear_role value alone (indoor_layer, no other negative facts) must not fail the floor', () => {
  // Proves the fix does not secretly key on outerwear_role -- an indoor_layer-tagged piece with no
  // OTHER negative evidence stays adequate, exactly like it did before this fix (category presence).
  const indoorLayerOnly = { id: 33, category: 'outerwear', name: 'legacy-tagged layer', outerwear_role: 'indoor_layer' }
  const result = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), indoorLayerOnly], {
    weatherProfile: { isCold: true, coldPresenceRequirement: { state: 'required' } },
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

// --- a thin base under a real outer layer: two tiers, and the demand they need ------------------
//
// A NUMERIC PET ENDPOINT DECIDES AMOUNT; SEVERITY DECIDES WHETHER THE PHYSICAL RULES RUN (owner
// ruling 2026-09-12, second pass). A bare `isColdSevere` flag carries no temperature, so these
// fixtures pass a real range wherever the assertion is about how much warmth is enough — and the
// flag-only fixtures below assert the physical rules and the ABSENCE of an amount verdict.
const severeRange = (highF, lowF) =>
  resolveWeatherContext({ userWeather: validateUserWeather({ high_f: highF, low_f: lowF }) }).temperature

test('SEVERE cold: a MEASURED thin base under a good coat is NO LONGER a finding — recorded, not hidden', () => {
  // Live "Trail Tee, Pants & Puffer": a light warm-season tee and light warm-season track pants
  // under a winter puffer, at a real 35/25.
  //
  // 2026-09-12, Concern 3 — A DELIBERATE SEVERITY CHANGE, recorded rather than absorbed. Under the
  // retired additive floor this was a hard finding (systemCold 4 against a hand-set 12). Under the
  // endpoint evaluator the upper system reads `warm` against a `very warm` cold endpoint: ONE level
  // short, not two. The approved model says adjacency is a ranking preference and only a
  // substantial mismatch is a mechanical fault, so this can no longer be an error without
  // reintroducing the zero-tolerance cold endpoint that was rejected.
  //
  // An advisory tier for adjacent severe-cold shortfalls was written to keep this card disclosed,
  // and then removed: run against the real wardrobe it also fired on a quilted puffer over a
  // moderate sweater at 35/25, which is a well-dressed outfit. Keeping a note that misfires on
  // correct cards to preserve one true positive is the trade this arc keeps refusing. This card now
  // produces NO finding, and that is the owner-visible consequence of the migration.
  //
  // The part of the old verdict that does NOT survive: the light track pants. The floor summed
  // every piece, so thin trousers dragged the total down; the production authority is upper-body
  // only by owner ruling, and lower-body suitability remains audit evidence with no finding.
  const tee = top({ fabric_weight: 'light', fiber_content: ['cotton'], sleeve_length: 'short' })
  const trackPants = { id: 11, category: 'bottom', name: 'track pants', fabric_weight: 'light', fiber_content: ['polyester'] }
  const result = evaluateOutfitEnvironmentalAdequacy([tee, trackPants, shoes(), WOOL_COAT], {
    weatherProfile: severeRange(35, 25), environment: 'outdoor',
  })
  assert.equal(result.evidence.severeColdFit.target, 'very warm')
  assert.equal(result.evidence.severeColdFit.verdict, 'fits', 'the adjacency is still recorded as evidence')
  assert.equal(result.evidence.severeColdFit.bestDelta, -1)
  assert.deepEqual(hardCodes(result), [])
  assert.ok(!codes(result).includes(C.THERMAL_CAPACITY_INSUFFICIENT), 'no capacity finding at one level short')
})

test('SEVERE cold: a base that is SUBSTANTIALLY short under a good coat is still a hard finding', () => {
  // The hard tier survives where the evidence is substantial. A waterproof shell is outdoor-capable
  // by construction and thermally light, so a silk camisole under it leaves the upper system
  // several levels under the `very warm` cold endpoint — every configuration known, all short the
  // same way. This is the exact counterpart of "a shell over real insulation passes" above: same
  // shell, and the verdict turns on what is underneath it rather than on the shell's own tag.
  const camisole = top({ fabric_weight: 'light', fiber_content: ['silk'], sleeve_length: 'sleeveless' })
  const result = evaluateOutfitEnvironmentalAdequacy([camisole, bottom(), shoes(), RAIN_SHELL], {
    weatherProfile: severeRange(35, 25), environment: 'outdoor',
  })
  assert.equal(result.evidence.severeColdFit.verdict, 'substantial_shortfall')
  assert.ok(hardCodes(result).includes(C.THERMAL_CAPACITY_INSUFFICIENT))
  const capacity = result.hardFindings.find(f => f.code === C.THERMAL_CAPACITY_INSUFFICIENT)
  assert.match(capacity.message, /wardrobe gap|re-plan/, 'a supply-sensitive finding names a legal move')
})

test('SEVERE cold: an UNMEASURED base under the same coat stays advisory', () => {
  // The distinction acceptance criterion 8 turns on. Nothing is known about these garments, so the
  // configurations are `cannot_judge` — absence of evidence rather than evidence of absence.
  const result = evaluateOutfitEnvironmentalAdequacy(
    [{ id: 10, category: 'top', name: 'untagged top' }, { id: 11, category: 'bottom', name: 'untagged bottom' }, shoes(), RAIN_SHELL],
    { weatherProfile: severeRange(35, 25), environment: 'outdoor' },
  )
  assert.equal(result.evidence.severeColdFit.verdict, 'cannot_judge')
  assert.deepEqual(hardCodes(result), [])
  assert.ok(codes(result).includes(C.THERMAL_CAPACITY_INSUFFICIENT))
})

test('SEVERE cold: a measured but genuinely warm base passes', () => {
  // The split must not turn "fully tagged" into "suspicious" — a tagged heavy base under the same
  // shell reaches the endpoint.
  const result = evaluateOutfitEnvironmentalAdequacy(
    [top({ fabric_weight: 'heavy', fiber_content: ['wool'] }), bottom(), shoes(), RAIN_SHELL],
    { weatherProfile: severeRange(35, 25), environment: 'outdoor' },
  )
  assert.deepEqual(hardCodes(result), [])
})

// --- severity and the PET target are allowed to disagree ----------------------------------------

test('REGRESSION: 45/45 is SEVERE and its PET cold endpoint is `warm`, not `very warm`', () => {
  // The counterexample that retired the flag-derived demand level. `isColdSevere` means the daily
  // HIGH is at most 45F; it says nothing about the low, and a flat 45/45 day is severe with a cold
  // endpoint a full level below the one 35/25 produces. A constant `very warm` fallback graded this
  // day two levels too high, so an upper system merely ADJACENT to its real target could hard-fail.
  const flat = severeRange(45, 45)
  assert.equal(flat.isColdSevere, true, 'the classifier still fires — the high is at or below the threshold')

  const moderateBase = [top({ fabric_weight: 'medium', fiber_content: ['wool'] }), bottom(), shoes(), WOOL_COAT]
  const result = evaluateOutfitEnvironmentalAdequacy(moderateBase, { weatherProfile: flat, environment: 'outdoor' })
  assert.equal(result.evidence.severeColdFit.target, 'warm',
    'a severe day whose PET cold endpoint is a level below the one 35/25 produces')
  assert.equal(result.evidence.severeColdFit.target, result.evidence.endpointFit.coldTarget,
    'severe cold reads the same PET endpoint the ordinary amount question does — one target, two consumers')

  // And the outfit that would have been convicted by the retired constant is simply fine here.
  assert.deepEqual(hardCodes(result), [])
  assert.ok(!codes(result).includes(C.THERMAL_CAPACITY_INSUFFICIENT))

  // Same wardrobe, a genuinely colder severe day: the target rises and the evidence moves with it.
  const colder = evaluateOutfitEnvironmentalAdequacy(moderateBase, { weatherProfile: severeRange(35, 25), environment: 'outdoor' })
  assert.equal(colder.evidence.severeColdFit.target, 'very warm')
})

// --- the flag-only legacy shape: physical rules run, amount stays unjudged -----------------------

test('SEVERE cold: a bare severity flag runs every PHYSICAL rule and manufactures no demand level', () => {
  // Callers that carry `isColdSevere` without a temperature still get presence, outdoor capability
  // and transit coverage — those are construction questions, and severity is enough to ask them.
  // What they must NOT get is an invented thermal target.
  const flagOnly = { isCold: true, isColdSevere: true }

  const noLayer = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes()], { weatherProfile: flagOnly })
  assert.ok(hardCodes(noLayer).includes(C.NO_OUTDOOR_LAYER_FOR_SEVERE_COLD), 'presence still runs')

  const indoorLayer = evaluateOutfitEnvironmentalAdequacy([top(), bottom(), shoes(), CARDIGAN], { weatherProfile: flagOnly })
  assert.ok(hardCodes(indoorLayer).includes(C.INDOOR_LAYER_ONLY_FOR_SEVERE_COLD), 'outdoor capability still runs')

  // The tee-and-track-pants card, flag-only: no target, so no amount verdict in either direction.
  const tee = top({ fabric_weight: 'light', fiber_content: ['cotton'], sleeve_length: 'short' })
  const trackPants = { id: 11, category: 'bottom', name: 'track pants', fabric_weight: 'light', fiber_content: ['polyester'] }
  const thin = evaluateOutfitEnvironmentalAdequacy([tee, trackPants, shoes(), WOOL_COAT], { weatherProfile: flagOnly })
  assert.equal(thin.evidence.severeColdFit.target, null)
  assert.equal(thin.evidence.severeColdFit.verdict, 'no_target',
    'severity without a temperature leaves thermal amount unjudged rather than guessed')
  assert.deepEqual(hardCodes(thin), [])
  assert.ok(!codes(thin).includes(C.THERMAL_CAPACITY_INSUFFICIENT))

  // Even a camisole under a light shell — substantially short at any real severe range — produces
  // no amount finding without a temperature. The physical rules are what still speak.
  const camisole = top({ fabric_weight: 'light', fiber_content: ['silk'], sleeve_length: 'sleeveless' })
  const bare = evaluateOutfitEnvironmentalAdequacy([camisole, bottom(), shoes(), RAIN_SHELL], { weatherProfile: flagOnly })
  assert.equal(bare.evidence.severeColdFit.verdict, 'no_target')
  assert.ok(!codes(bare).includes(C.THERMAL_CAPACITY_INSUFFICIENT))
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
    weatherProfile: { isCold: true, coldPresenceRequirement: { state: 'required' } },
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

// thread_1788508369689 arc, product ruling "use B": a trip card's shared packed layer is not part
// of its visual identity, so structure/dependency/layer-direction checks must stay core-only while
// only the environmental-adequacy stage sees core-plus-layer as the effective worn outfit.
test('environmentPieces feeds only the environment stage; every other stage still evaluates the bare pieces', () => {
  const coreOnly = [top(), bottom(), shoes()]
  const withLayer = [...coreOnly, WOOL_COAT]

  const bareCore = evaluateWearableOutfit(coreOnly, {
    requireShoes: true,
    weatherContext: { weatherProfile: { isCold: true, coldPresenceRequirement: { state: 'required' } } },
  })
  assert.ok(bareCore.hardFindings.some(f => f.message === 'no warm layer for cold weather'),
    'sanity: the bare core alone must fail the cold floor')

  const withEnvironmentPieces = evaluateWearableOutfit(coreOnly, {
    requireShoes: true,
    weatherContext: { weatherProfile: { isCold: true, coldPresenceRequirement: { state: 'required' } } },
    environmentPieces: withLayer,
  })
  assert.ok(!withEnvironmentPieces.hardFindings.some(f => f.message === 'no warm layer for cold weather'),
    'the assigned layer, passed only via environmentPieces, must satisfy the cold floor')

  // Structure isn't affected by environmentPieces: a 4-piece outfit (WOOL_COAT included) would still
  // pass structure regardless, so prove non-effect a different way -- outfitStructure findings are
  // identical whether or not environmentPieces is supplied, since that stage always reads `pieces`.
  const withoutOverride = evaluateWearableOutfit(coreOnly, { requireShoes: true })
  assert.deepEqual(withEnvironmentPieces.stages.find(s => s.stage === 'structure').result,
    withoutOverride.stages.find(s => s.stage === 'structure').result,
    'structure must be computed from the bare pieces, never from environmentPieces')
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

test('COOL: an outfit with no layer at all is an advisory warning', () => {
  // The live defect: a 65F/48F October day produced no weather handling whatsoever, because isCold
  // needs lowF <= 45. Both Sightseeing cards shipped with no outer layer; one was a sleeveless tank.
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes()], {
    weatherProfile: { needsRemovableCoolLayer: true },
  })
  assert.deepEqual(hardCodes(result), [])
  assert.deepEqual(advisoryCodes(result), [C.NO_REMOVABLE_COOL_LAYER])
  assert.equal(result.advisoryFindings[0].severity, 'warning')
})

// SET LEVEL vs CARD LEVEL (docs/README.md: trip roster architecture). A card composed from an
// already roster-validated trip packing set must not have to re-carry a layer the set already has.
test('COOL: packingRosterHasLayer stands the per-card finding down entirely', () => {
  // packingRosterHasLayer is a resolvedContext-level field (a sibling of weatherProfile), the exact
  // shape outfitSetPlanner.js's weatherContext object passes — not part of the weather profile
  // itself, which describes conditions, not what was packed.
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes()], {
    weatherProfile: { needsRemovableCoolLayer: true }, packingRosterHasLayer: true,
  })
  assert.deepEqual(codes(result), [])
})

test('COOL TRANSIT: packingRosterHasLayer stands the transit finding down too', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes()], {
    weatherProfile: { isIndoor: true, transitNeedsRemovableCoolLayer: true }, environment: 'indoor', packingRosterHasLayer: true,
  })
  assert.deepEqual(codes(result), [])
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
  assert.deepEqual(hardCodes(result), [])
  assert.deepEqual(advisoryCodes(result), [C.NO_REMOVABLE_COOL_LAYER])
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
    weatherProfile: { needsRemovableCoolLayer: true, isCold: true, coldPresenceRequirement: { state: 'required' } },
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
  assert.deepEqual(hardCodes(result), [])
  assert.deepEqual(advisoryCodes(result), [C.NO_REMOVABLE_COOL_LAYER_FOR_TRANSIT])
  assert.equal(result.advisoryFindings[0].severity, 'warning')
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
  assert.deepEqual(hardCodes(result), [])
  assert.deepEqual(advisoryCodes(result), [C.COOL_LAYER_IS_SEE_THROUGH])
  assert.equal(result.advisoryFindings[0].severity, 'warning')
})

// docs/README.md: trip roster architecture, item 3 — adjudicated rather than left behind. This
// finding answers a physical-construction question (does the tagged opacity mean the garment
// provides meaningful coverage at all), not a thermal styling judgment, so it survives the
// facts-not-judgments pass and stays a hard finding — but it inherits the SET-level demotion too.
test('COOL: a card pairing a sheer layer with real protection packed elsewhere in the roster is not rejected', () => {
  // The owner's own example: a sheer layer may be perfectly legitimate aesthetically when the trip
  // roster separately contains real weather protection — the engine must not reject it merely
  // because it is not itself insulating.
  const shrug = { id: 30, category: 'outerwear', name: 'sheer shrug', outerwear_role: 'indoor_layer', fabric_weight: 'light', opacity: 'semi_sheer', fiber_content: ['polyester'] }
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes(), shrug], {
    weatherProfile: { needsRemovableCoolLayer: true }, packingRosterHasLayer: true,
  })
  assert.deepEqual(codes(result), [])
})

test('COOL: outside an active trip (no roster at all), a see-through layer produces an advisory warning', () => {
  // No regression to the ordinary, non-trip case: packingRosterHasLayer is simply absent/false, and
  // this finding behaves identically to the unmodified original.
  const shrug = { id: 30, category: 'outerwear', name: 'sheer shrug', outerwear_role: 'indoor_layer', fabric_weight: 'light', opacity: 'semi_sheer', fiber_content: ['polyester'] }
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes(), shrug], {
    weatherProfile: { needsRemovableCoolLayer: true },
  })
  assert.deepEqual(hardCodes(result), [])
  assert.deepEqual(advisoryCodes(result), [C.COOL_LAYER_IS_SEE_THROUGH])
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
  assert.deepEqual(hardCodes(result), [])
  assert.deepEqual(advisoryCodes(result), [C.COOL_LAYER_IS_SEE_THROUGH])
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
  assert.deepEqual(hardCodes(result), [])
  assert.deepEqual(advisoryCodes(result), [C.NO_REMOVABLE_COOL_LAYER])
  assert.match(result.advisoryFindings[0].message, /tagged as warm-season clothing/)
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
  assert.deepEqual(advisoryCodes(withoutSeason), advisoryCodes(withSeason), 'same code')
  assert.equal(withoutSeason.advisoryFindings[0].severity, withSeason.advisoryFindings[0].severity, 'same severity')
  assert.doesNotMatch(withoutSeason.advisoryFindings[0].message, /warm-season/)
  assert.ok(!withoutSeason.evidence.baseIsWarmSeasonOnly)
})

test('a MIXED base does not corroborate — every piece must be warm-season', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([warmTop(), neutralBottom(), shoes()], {
    weatherProfile: { needsRemovableCoolLayer: true },
  })
  assert.deepEqual(hardCodes(result), [])
  assert.deepEqual(advisoryCodes(result), [C.NO_REMOVABLE_COOL_LAYER])
  assert.doesNotMatch(result.advisoryFindings[0].message, /warm-season/)
})

test('season corroboration reaches the transit finding too', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([warmTop(), warmBottom(), shoes()], {
    weatherProfile: { isIndoor: true, transitNeedsRemovableCoolLayer: true }, environment: 'indoor',
  })
  assert.deepEqual(hardCodes(result), [])
  assert.deepEqual(advisoryCodes(result), [C.NO_REMOVABLE_COOL_LAYER_FOR_TRANSIT])
  assert.match(result.advisoryFindings[0].message, /tagged as warm-season clothing/)
})

test('season does not leak into the cold or severe tiers', () => {
  // Those tiers have better physical evidence and were deliberately left alone; the corroboration
  // is scoped to the cool tier only.
  const result = evaluateOutfitEnvironmentalAdequacy([warmTop(), warmBottom(), shoes()], {
    weatherProfile: { isCold: true, coldPresenceRequirement: { state: 'required' } },
  })
  assert.deepEqual(hardCodes(result), [C.NO_WARM_LAYER_FOR_COLD])
  assert.doesNotMatch(result.hardFindings[0].message, /warm-season/)
})

// --- one shortfall, one note (thread_1789174415595) ---------------------------------------------
//
// The engine keeps removability, presence and amount as separate findings on purpose. The card face
// must not: a layerless 65/46 day tripped all three and showed three chips saying the same thing.

// The live profile from that run, as resolveStylingContext produced it (65F high / 46F low,
// stated_user, sustained outdoor exposure) — the three overlapping findings need the presence
// requirement and the resolved context, not just the needsRemovableCoolLayer flag.
const WALNUT_CREEK_65_46 = {
  isHot: false,
  isCold: false,
  isColdSevere: false,
  isExtremeHeat: false,
  needsRemovableCoolLayer: true,
  highF: 65,
  lowF: 46,
  weatherSource: 'stated_user',
  resolvedWeatherContext: {
    status: 'resolved',
    location: 'Walnut Creek, CA',
    dateRange: null,
    temperature: { highF: 65, lowF: 46, band: null, isHot: false, isCold: false, isColdSevere: false, needsRemovableCoolLayer: true, isExtremeHeat: false, source: 'stated_user' },
    precipitation: { value: 'unknown', source: 'unavailable' },
    wind: { value: 'unknown', source: 'unavailable' },
    overallSource: 'stated_user',
  },
  coldPresenceRequirement: {
    state: 'recommended',
    applies: false,
    evidence: { wakingLowF: 46, wakingHighF: 65, exertion: 'none', exposureMode: 'sustained_outdoor', isSevereCold: false, severeBasis: null },
    rationale: 'ordinary cool/cold exposure with unknown duration (proposed advisory calibration)',
  },
}

test('CHIPS: a layerless cool day still produces every finding for diagnostics', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes()], {
    weatherProfile: WALNUT_CREEK_65_46,
  })
  const found = advisoryCodes(result)
  assert.ok(found.includes(C.NO_REMOVABLE_COOL_LAYER), `expected the removability finding, got ${found.join(', ')}`)
  assert.ok(found.includes(C.WARM_LAYER_RECOMMENDED), `expected the presence finding, got ${found.join(', ')}`)
  // The live run added THERMAL_UNDERSHOOT as a third; it needs a fully thermally-tagged base,
  // which these deliberately generic fixtures are not. Two overlapping notes is already the defect.
  assert.ok(found.length >= 2, `the overlapping family is what this collapse exists for, got ${found.join(', ')}`)
})

test('CHIPS: that same outfit shows ONE weather chip, not three', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fabric_weight: 'light' }), bottom(), shoes()], {
    weatherProfile: WALNUT_CREEK_65_46,
  })
  const flags = advisoryFindingsToSystemFlags(result.advisoryFindings)
  assert.equal(flags.length, 1, `three ways of saying one thing is the live defect, got ${JSON.stringify(flags)}`)
  assert.equal(flags[0].type, 'Weather note')
  assert.match(flags[0].message, /no layer to put on/)
})

test('CHIPS: the overlapping warmth family collapses to the most specific note', () => {
  const findings = [
    { code: C.WARM_LAYER_RECOMMENDED, message: 'a warm or midweight layer is recommended for cool weather' },
    { code: C.THERMAL_UNDERSHOOT, message: 'this outfit carries less warmth than the conditions call for' },
    { code: C.NO_REMOVABLE_COOL_LAYER, message: 'this outfit has no layer to put on for the cooler part of the day' },
  ]
  const flags = advisoryFindingsToSystemFlags(findings)
  assert.deepEqual(flags, [{ type: 'Weather note', message: 'this outfit has no layer to put on for the cooler part of the day' }])
})

test('CHIPS: an undershoot on an outfit that HAS a layer survives alone', () => {
  // The Outfit 1 case: a light jacket on a day that asks for a warm one. Nothing to collapse into,
  // so the amount note is the note.
  const flags = advisoryFindingsToSystemFlags([
    { code: C.THERMAL_UNDERSHOOT, message: 'this outfit carries less warmth than the conditions call for' },
  ])
  assert.deepEqual(flags, [{ type: 'Weather note', message: 'this outfit carries less warmth than the conditions call for' }])
})

test('CHIPS: non-warmth advisories pass through untouched', () => {
  const flags = advisoryFindingsToSystemFlags([
    { code: C.NO_REMOVABLE_COOL_LAYER, message: 'nothing to put on' },
    { code: C.WARM_LAYER_RECOMMENDED, message: 'a warm or midweight layer is recommended' },
    { code: C.RAIN_PROTECTION_MISSING, message: 'no layer here has tagged rain protection for wet conditions' },
    { code: C.THERMAL_OVERSHOOT, message: 'this outfit carries more warmth than the conditions call for' },
    { code: 'layer_direction_conflict', stage: 'layer_direction', message: 'sleeve geometry conflict' },
  ])
  assert.deepEqual(flags, [
    { type: 'Weather note', message: 'nothing to put on' },
    { type: 'Weather note', message: 'no layer here has tagged rain protection for wet conditions' },
    { type: 'Weather note', message: 'this outfit carries more warmth than the conditions call for' },
    { type: 'Fit note', message: 'sleeve geometry conflict' },
  ])
})

test('CHIPS: collapsing is display-only — the finding list itself is never mutated', () => {
  const findings = [
    { code: C.NO_REMOVABLE_COOL_LAYER, message: 'nothing to put on' },
    { code: C.WARM_LAYER_RECOMMENDED, message: 'a warm or midweight layer is recommended' },
  ]
  advisoryFindingsToSystemFlags(findings)
  assert.equal(findings.length, 2, 'the evaluator keeps its evidence; only the projection collapses')
  assert.deepEqual(collapseWarmthAdvisoryFindings([]), [])
})

// --- configuration revalidation, through the production path ------------------------------------

test('INTEGRATION: the chain rule reaches the production path, and reduced configurations are revalidated', () => {
  // 2026-09-13. This fixture used to assert that the composed outfit was `compatible` while the
  // vest-removed configuration was not — non-monotonic removal, which is why `wornConfigurations`
  // takes an injected validator. The chain rule subsumes that example: a voluminous sleeve under a
  // SLEEVELESS vest is still directly inside the coat sleeve, so the composed outfit is now
  // correctly rejected up front rather than only after the vest is hypothetically removed.
  //
  // Recorded rather than quietly re-pointed at a new fixture, because it is the honest result: for
  // SLEEVES, removal is now monotonic — the chain compares the base against every outer layer
  // whether or not a middle layer sits between them. The injected validator stays as the contract
  // (a configuration is a state someone can actually wear), and its filtering behaviour is pinned
  // with an explicit validator in test/thermalAdequacyMigration.test.js.
  const voluminousBlouse = {
    id: 70, name: 'voluminous-sleeve blouse', category: 'top', role: 'primary_top',
    sleeve_length: 'long', sleeve_shape: 'voluminous', fabric_weight: 'light', fiber_content: ['cotton'],
  }
  const vest = {
    id: 71, name: 'quilted vest', category: 'outerwear', role: 'layer_top',
    sleeve_length: 'sleeveless', sleeve_type: 'sleeveless', fabric_weight: 'medium', fiber_content: ['polyester'],
  }
  const structuredCoat = {
    id: 72, name: 'structured wool coat', category: 'outerwear', role: 'outerwear',
    sleeve_length: 'long', sleeve_shape: 'fitted', fabric_weight: 'heavy', fiber_content: ['wool'],
  }
  const pieces = [voluminousBlouse, vest, structuredCoat,
    { id: 73, name: 'trousers', category: 'bottom', role: 'primary_bottom', fabric_weight: 'medium' },
    { id: 74, name: 'boots', category: 'shoes', role: 'shoes', shoe_type: 'boot' }]

  const result = evaluateWearableOutfit(pieces, {
    roleAware: true,
    includeLayerDirections: true,
    weatherContext: { weatherProfile: severeRange(60, 48), environment: 'outdoor', activity: 'none' },
  })
  // Log-only since 2026-09-14: the geometry conflict is still computed through the aggregator, as shadow evidence only.
  assert.equal(result.hardValid, true, 'a sleeve-geometry verdict never makes the outfit invalid')
  const conflict = result.shadowFindings.find(finding => finding.code === 'layer_construction_sleeve_conflict')
  assert.ok(conflict, 'the sleeveless middle layer does not hide the blouse from the coat in the shadow evidence')
  assert.equal(conflict.evidence.originId, voluminousBlouse.id)
  assert.equal(conflict.evidence.outerId, structuredCoat.id)

  // And the weather stage still ran on the same call — the two contracts remain independent.
  assert.ok(result.stages.some(stage => stage.stage === 'environment'))
})

// --- adjacent severe-cold capacity without insulation evidence (owner ruling 2026-09-13) ----------
const LINED_TRENCH = { id: 30, category: 'outerwear', name: 'lined trench coat', fabric_weight: 'medium', fabric_category: 'cotton', fiber_content: ['cotton', 'polyester'], insulating_layer_materials: [], interior_construction: 'full_lining', weather_protection: ['wind'], sleeve_length: 'long', length_hits_at: 'knee', opacity: 'opaque' }
const cottonTee = () => top({ fiber_content: ['cotton'] })
const ADJ = C.THERMAL_CAPACITY_SHORT_WITHOUT_INSULATION_EVIDENCE
const ADJ_UNKNOWN = C.THERMAL_CAPACITY_INSULATION_EVIDENCE_UNKNOWN

test('ADJACENT SEVERE CAPACITY: tee + lined trench at 45/35 is one level short with no positive insulation evidence, and fails', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([cottonTee(), bottom(), shoes(), LINED_TRENCH], { weatherProfile: severeRange(45, 35), environment: 'outdoor' })
  assert.equal(result.evidence.severeColdFit.bestDelta, -1)
  assert.ok(hardCodes(result).includes(ADJ))
  const f = result.hardFindings.find(x => x.code === ADJ)
  assert.match(f.message, /no upper-body garment has positive cold-weather insulation evidence/)
  assert.doesNotMatch(f.message, /\bno insulation\b/, 'the classifier does not claim cotton carries no insulation')
})

test('ADJACENT SEVERE CAPACITY: a filled puffer one level short at 35/25 stays acceptable', () => {
  const puffer = { id: 31, category: 'outerwear', name: 'quilted puffer jacket', fabric_weight: 'medium', fiber_content: ['polyester', 'nylon'], insulating_layer_materials: ['polyester'], interior_construction: 'full_lining', weather_protection: ['wind'], sleeve_length: 'long' }
  const result = evaluateOutfitEnvironmentalAdequacy([cottonTee(), bottom(), shoes(), puffer], { weatherProfile: severeRange(35, 25), environment: 'outdoor' })
  assert.equal(result.evidence.severeColdFit.bestDelta, -1)
  assert.ok(!codes(result).includes(ADJ) && !codes(result).includes(ADJ_UNKNOWN))
  assert.deepEqual(hardCodes(result), [])
})

test('ADJACENT SEVERE CAPACITY: wool under the same protective trench supplies the evidence', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([top({ fiber_content: ['wool'] }), bottom(), shoes(), LINED_TRENCH], { weatherProfile: severeRange(45, 35), environment: 'outdoor' })
  assert.equal(result.evidence.severeColdFit.bestDelta, -1)
  assert.deepEqual(hardCodes(result), [])
  assert.ok(!codes(result).includes(ADJ_UNKNOWN))
})

test('ADJACENT SEVERE CAPACITY: unknown garment evidence is disclosed, never convicted', () => {
  // A placeable system one level short whose outer layer never answered the interior question: a warm
  // mock-neck cotton base under a light rain jacket with no recorded fill or "no fill" answer.
  const warmBase = top({ fabric_weight: 'heavy', fiber_content: ['cotton'], neckline: 'mock neck' })
  const rainJacket = { id: 33, category: 'outerwear', name: 'rain jacket', fabric_weight: 'light', fiber_content: ['polyester'], weather_protection: ['rain'], sleeve_length: 'long' }
  const result = evaluateOutfitEnvironmentalAdequacy([warmBase, bottom(), shoes(), rainJacket], { weatherProfile: severeRange(45, 35), environment: 'outdoor' })
  assert.equal(result.evidence.severeColdFit.bestDelta, -1)
  assert.deepEqual(hardCodes(result), [])
  assert.ok(advisoryCodes(result).includes(ADJ_UNKNOWN))
})

test('REGRESSION 45/45: a system that reaches its actual PET endpoint stays clean without wool or fill', () => {
  const flat = severeRange(45, 45)
  assert.equal(flat.isColdSevere, true)
  const result = evaluateOutfitEnvironmentalAdequacy([cottonTee(), bottom(), shoes(), LINED_TRENCH], { weatherProfile: flat, environment: 'outdoor' })
  assert.equal(result.evidence.severeColdFit.target, 'warm')
  assert.equal(result.evidence.severeColdFit.bestDelta, 0, 'the endpoint is met')
  assert.deepEqual(hardCodes(result), [])
  assert.ok(!codes(result).includes(ADJ) && !codes(result).includes(ADJ_UNKNOWN) && !codes(result).includes(C.THERMAL_CAPACITY_INSUFFICIENT))
})

test('REGRESSION severe flag without temperature: no new amount or capacity verdict', () => {
  const flagOnly = { isCold: true, isColdSevere: true }
  const result = evaluateOutfitEnvironmentalAdequacy([cottonTee(), bottom(), shoes(), LINED_TRENCH], { weatherProfile: flagOnly })
  assert.equal(result.evidence.severeColdFit.verdict, 'no_target')
  for (const code of [ADJ, ADJ_UNKNOWN, C.THERMAL_CAPACITY_INSUFFICIENT]) assert.ok(!codes(result).includes(code), `no ${code} without a temperature`)
})

test('user-facing thermal errors collapse to one primary explanation while every typed finding stays in the evaluation', async () => {
  const { collapseThermalErrorFindings } = await import('../styling-engine/outfitEnvironmentalAdequacy.js')
  // Through the shared evaluator, with the presence requirement the styling-context resolver attaches
  // to a verified severe outdoor exposure (resolveColdLayerPresenceRequirement) — without it the floor
  // has no requirement to enforce.
  const unlined = { ...LINED_TRENCH, id: 32, name: 'unlined cotton jacket', interior_construction: 'unlined', length_hits_at: 'hip' }
  const pieces = [
    { ...cottonTee(), role: 'primary_top' },
    { ...bottom(), role: 'primary_bottom' },
    { ...shoes(), role: 'shoes' },
    { ...unlined, role: 'outerwear' },
  ]
  const result = evaluateWearableOutfit(pieces, { requireShoes: true, roleAware: true, weatherContext: { weatherProfile: { ...severeRange(45, 35), coldPresenceRequirement: { state: 'required' } }, activity: 'none' } })
  assert.ok(hardCodes(result).includes(C.NO_WARM_LAYER_FOR_COLD) && hardCodes(result).includes(ADJ), `both typed errors are kept: ${JSON.stringify(hardCodes(result))}`)
  const shown = collapseThermalErrorFindings(result.hardFindings)
  assert.deepEqual(shown.map(f => f.code), [C.NO_WARM_LAYER_FOR_COLD])
})

test('ADJACENT SEVERE CAPACITY precedence: positive insulation evidence wins even when another garment is unknown', () => {
  // Decision order: any positive evidence -> this backstop passes; otherwise any unknown -> advisory;
  // otherwise -> hard. A warm wool mock-neck base under a light rain jacket whose interior was never
  // answered: one level short, one garment insulating, one unknown.
  const woolBase = top({ fabric_weight: 'heavy', fiber_content: ['wool'], neckline: 'mock neck' })
  const rainJacket = { id: 34, category: 'outerwear', name: 'rain jacket', fabric_weight: 'light', fiber_content: ['polyester'], weather_protection: ['rain'], sleeve_length: 'long' }
  const result = evaluateOutfitEnvironmentalAdequacy([woolBase, bottom(), shoes(), rainJacket], { weatherProfile: severeRange(45, 35), environment: 'outdoor' })
  assert.equal(result.evidence.severeColdFit.bestDelta, -1)
  assert.deepEqual(result.evidence.severeColdInsulation.map(entry => entry.evidence).sort(), ['insulating', 'unknown'])
  assert.ok(!codes(result).includes(ADJ), 'no hard backstop')
  assert.ok(!codes(result).includes(ADJ_UNKNOWN), 'and no unknown-evidence advisory either')
  assert.deepEqual(hardCodes(result), [])
})

test('primaryUserFacingFinding: structural order is kept and the thermal family shows only its approved primary', async () => {
  const { primaryUserFacingFinding, collapseThermalErrorFindings } = await import('../styling-engine/outfitEnvironmentalAdequacy.js')
  const f = code => ({ code, message: code })
  const order = [C.THERMAL_CAPACITY_SHORT_WITHOUT_INSULATION_EVIDENCE, C.THERMAL_CAPACITY_INSUFFICIENT, C.NO_WARM_LAYER_FOR_COLD, C.INDOOR_LAYER_ONLY_FOR_SEVERE_COLD, C.NO_OUTDOOR_LAYER_FOR_SEVERE_COLD]
  // Approved precedence, most fundamental first, whatever order the evaluator emitted them in.
  for (let i = order.length - 1; i >= 0; i--) {
    const present = order.slice(0, i + 1).map(f)
    assert.equal(primaryUserFacingFinding(present).code, order[i])
  }
  const structural = f('missing_shoes')
  assert.equal(primaryUserFacingFinding([structural, f(C.NO_WARM_LAYER_FOR_COLD), f(C.THERMAL_CAPACITY_SHORT_WITHOUT_INSULATION_EVIDENCE)]).code, 'missing_shoes')
  assert.deepEqual(collapseThermalErrorFindings([structural, f(C.THERMAL_CAPACITY_SHORT_WITHOUT_INSULATION_EVIDENCE), f(C.NO_WARM_LAYER_FOR_COLD)]).map(x => x.code),
    ['missing_shoes', C.NO_WARM_LAYER_FOR_COLD])
  assert.equal(primaryUserFacingFinding([]), null)
})

// thread_1789536455443 (2026-09-16, reopened): medium knit shirt + heavy trousers + boots + a
// medium-weight, fully-lined, wind-protective, NON-insulating trench, at 50/40°F exposure_window
// (certain). `propose_outfit` accepted this with ZERO findings, and owner review confirmed the
// outfit is genuinely NOT adequate for that outing (works to ~55°F). This is recorded here as an
// UNRESOLVED false negative, not a fixed one: `hasMinimumWarmLayer`'s presence/substance floor
// treats a full lining as legitimate substance evidence (2026-09-13 amendment) so the trench clears
// that low bar; the thermal-contribution bucket separately reads the whole system as `warm`, an
// EXACT match to the certain `warm` cold-end target (bestDelta 0, verdict 'fits'), so
// THERMAL_UNDERSHOOT never fires either. A dedicated "no outer layer carries recorded insulation"
// advisory was tried and reverted (2026-09-16 owner review): missing insulation is a per-garment
// fact, not independently a whole-outfit shortfall — it ignores warmth that can legitimately come
// from a medium insulating base, multiple garments together, or wind protection genuinely mattering
// at the exposure, and it manufactured a second verdict alongside the one below rather than fixing
// it. Re-tuning the floor or the bucket itself was ALSO tried (2026-09-13) and reverted for
// miscalibrating seven other real garments the other way. The evaluator's aggregated contribution
// for this system is measured here as `warm`/`fits` — genuinely overvalued relative to owner truth,
// and left that way pending a real calibration fix, not a workaround. The mitigation shipped
// instead gives the MODEL the complete construction facts and photographs so it can judge this
// itself, rather than manufacturing a second deterministic engine verdict.
test('KNOWN UNRESOLVED: a fully-lined, wind-protective, non-insulating trench at 50/40°F clears both the presence floor and the thermal-amount check, with no finding at all', () => {
  const trench = {
    id: 40, category: 'outerwear', name: 'cream trench coat', fabric_weight: 'medium',
    fiber_content: ['cotton', 'polyester'], insulating_layer_materials: [], interior_construction: 'full_lining',
    weather_protection: ['wind'], sleeve_length: 'long',
  }
  const weatherProfile = { ...severeRange(50, 40), coldPresenceRequirement: { state: 'recommended' } }
  const result = evaluateOutfitEnvironmentalAdequacy(
    [top({ fabric_weight: 'medium', fiber_content: ['cotton'] }), bottom(), shoes(), trench],
    { weatherProfile, environment: 'outdoor', activity: 'walking' },
  )
  assert.deepEqual(result.findings, [], 'STILL UNRESOLVED as of 2026-09-16: owner truth says this system is not adequate below ~55°F, and the evaluator currently disagrees with zero findings — do not treat this assertion passing as evidence the calibration is fixed')
})

test('NEUTRAL VERDICTS (experiment flag): the warm-layer advisory is stated as the recorded facts, not a recommendation', () => {
  const thinJacket = { id: 35, category: 'outerwear', name: 'unlined cotton jacket', fabric_weight: 'medium', fiber_content: ['cotton'], insulating_layer_materials: [], interior_construction: 'unlined', sleeve_length: 'long' }
  const weatherProfile = { ...severeRange(60, 48), coldPresenceRequirement: { state: 'recommended' } }
  const run = () => evaluateOutfitEnvironmentalAdequacy([top({ fiber_content: ['cotton'] }), bottom(), shoes(), thinJacket], { weatherProfile, environment: 'outdoor' })
    .findings.find(finding => finding.code === C.WARM_LAYER_RECOMMENDED)
  const production = run()
  assert.match(production.message, /recommended/)
  process.env.WARDROBE_EXPERIMENT_NEUTRAL_VERDICTS = 'true'
  try {
    const neutral = run()
    assert.equal(neutral.code, production.code, 'same typed finding, same severity')
    assert.equal(neutral.severity, production.severity)
    assert.doesNotMatch(neutral.message, /recommend/)
    assert.match(neutral.message, /at least two thin-construction facts/)
  } finally {
    delete process.env.WARDROBE_EXPERIMENT_NEUTRAL_VERDICTS
  }
})

