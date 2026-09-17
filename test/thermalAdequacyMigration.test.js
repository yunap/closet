// §8 step 3 — outfit adequacy consumes the band for thermal AMOUNT.
// Removability, transit coverage and outdoor capability remain separate contracts (§2.1).
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
const { evaluateOutfitEnvironmentalAdequacy, ENVIRONMENTAL_ADEQUACY_CODES } = await import('../styling-engine/outfitEnvironmentalAdequacy.js')
const { validateUserWeather, resolveWeatherContext } = await import('../styling-engine/weather.js')
const { outfitThermalContribution } = await import('../styling-engine/outfitThermalContribution.js')

const W = (high_f, low_f) => ({ ...resolveWeatherContext({ userWeather: validateUserWeather({ high_f, low_f }) }).temperature })
const BASE = [
  { id: 1, category: 'top', fabric_weight: 'medium', fiber_content: ['cotton'], sleeve_length: 'long' },
  { id: 2, category: 'bottom', fabric_weight: 'medium', fabric_category: 'denim', fiber_content: ['denim'], length_hits_at: 'ankle' },
  { id: 3, category: 'shoes', fabric_category: 'leather' },
]
const PUFFER = { id: 4, category: 'outerwear', fabric_weight: 'heavy', insulating_layer_materials: ['down'], sleeve_length: 'long' }
const CARDIGAN = { id: 5, category: 'outerwear', fabric_weight: 'medium', fabric_category: 'knit', fiber_content: ['wool'], sleeve_length: 'long' }
const codes = (pieces, weather, environment = 'outdoor') =>
  (evaluateOutfitEnvironmentalAdequacy(pieces, { weatherProfile: weather, environment }).findings || [])
const has = (pieces, weather, code) => codes(pieces, weather).some(f => f.code === code)

test('overshoot is judged across CONFIGURATIONS: a removable puffer is not a fault, a fixed heavy base is', () => {
  // 2026-09-12, Concern 2. layer-weight-ceiling.md's puffer-on-a-mild-museum-day is now answered by
  // RANKING, not by a finding: with the puffer off, what remains suits the warm end, so there is a
  // realistic worn state for the day. Excess that CANNOT come off is still reported.
  assert.ok(!has([...BASE, PUFFER], W(72, 62), ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT),
    'a layer the wearer can simply take off is not an excess finding')
  assert.ok(!has([...BASE, CARDIGAN], W(72, 62), ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT))

  // Non-removable excess: a heavy wool upper body with no layer to shed, two levels above the warm
  // endpoint's `light` target.
  const heavyWoolTop = { id: 30, category: 'top', fabric_weight: 'heavy', fiber_content: ['wool'], sleeve_length: 'long', neckline: 'mock_neck' }
  const found = codes([heavyWoolTop, BASE[1], BASE[2]], W(72, 62)).filter(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT)
  assert.equal(found.length, 1, 'warmth that remains in every wearable state is still reported')
  assert.equal(found[0].severity, 'advisory', '§5.5: overshoot ranks, it never invalidates')
})

test('a genuinely cold day flags neither garment as excessive', () => {
  assert.ok(!has([...BASE, PUFFER], W(30, 20), ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT))
  assert.ok(!has([...BASE, CARDIGAN], W(30, 20), ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT))
})

test('an ADJACENT shortfall is no longer a finding — the PET target ranks, it does not reject', () => {
  // A light base under a `moderate` trench: the upper system is `moderate`, one level under the 48F
  // cold target of `warm`. Under the approved model that is a ranking preference, not proof of
  // inadequacy, and the evidence still records it for ranking/debug. (The base is light because the
  // trench is no longer capped: over a moderate base it would reach the target outright.)
  const trench = { id: 8, category: 'outerwear', fabric_weight: 'medium', fiber_content: ['cotton'], insulating_layer_materials: [], interior_construction: 'full_lining', sleeve_length: 'long' }
  const lightBase = { ...BASE[0], fabric_weight: 'light' }
  const result = evaluateOutfitEnvironmentalAdequacy([lightBase, BASE[1], BASE[2], trench], {
    weatherProfile: W(60, 48), environment: 'outdoor', activity: 'none',
  })
  assert.ok(!result.findings.some(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_UNDERSHOOT))
  assert.equal(result.evidence.endpointFit.cold.verdict, 'fits')
  assert.equal(result.evidence.endpointFit.cold.adjacent, true)
  assert.equal(result.evidence.endpointFit.cold.direction, 'under')
})

test('undershoot stays advisory by default — missing metadata never becomes hard invalidity', () => {
  // Acceptance criterion 8, and this was learned the hard way: as an error, a synthetic
  // "sleeved wool coat" tagged fabric_weight:light with no fibre content placed as `light`,
  // undershot a 65/45 day and hard-blocked plan submission. The PRESENCE gate
  // (NO_WARM_LAYER_FOR_COLD) keeps its authority; the band adds the graded AMOUNT.
  // SUBSTANTIAL, not adjacent: a bare-cut light top with a light shell, two levels under a `warm`
  // cold endpoint. Adjacent shortfalls are ranking evidence (see the test above).
  const lightTop = { id: 8, category: 'top', fabric_weight: 'light', fiber_content: ['cotton'], sleeve_length: 'sleeveless' }
  const shell = { id: 9, category: 'outerwear', fabric_weight: 'light', fiber_content: ['nylon'], insulating_layer_materials: [], sleeve_length: 'long' }
  const result = evaluateOutfitEnvironmentalAdequacy([lightTop, BASE[1], BASE[2], shell], {
    weatherProfile: W(60, 48),
    environment: 'outdoor',
    activity: 'none',
  })
  const undershoot = result.findings.find(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_UNDERSHOOT)
  assert.equal(undershoot?.severity, 'advisory')
})

test('a certain stated exposure plus an explicitly required layer hard-blocks known thermal undershoot', () => {
  const lightTop = { id: 8, category: 'top', fabric_weight: 'light', fiber_content: ['cotton'], sleeve_length: 'sleeveless' }
  const shell = { id: 9, category: 'outerwear', fabric_weight: 'light', fiber_content: ['nylon'], insulating_layer_materials: [], sleeve_length: 'long' }
  const result = evaluateOutfitEnvironmentalAdequacy([lightTop, BASE[1], BASE[2], shell], {
    weatherProfile: W(60, 48),
    environment: 'outdoor',
    activity: 'none',
    requireThermalAdequacy: true,
  })
  const undershoot = result.findings.find(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_UNDERSHOOT)
  assert.equal(undershoot?.severity, 'error', 'the explicit contract still hard-blocks a SUBSTANTIAL shortfall')
})

test('a warm coat cannot hide a SUBSTANTIALLY under-warm upper body at the warm endpoint', () => {
  // Still the same contract — heavy trousers cannot make a thin upper body adequate once the coat
  // is off — but the threshold is now substantial rather than adjacent: a bare satin shell is two
  // levels under the 60F warm endpoint, where a `light` three-quarter-sleeve top would be one and
  // would rank rather than fail.
  const bareSatin = { id: 10, category: 'top', fabric_weight: 'light', fabric_category: 'satin', fiber_content: ['polyester'], sleeve_length: 'sleeveless' }
  const heavyPants = { id: 11, category: 'bottom', fabric_weight: 'heavy', fiber_content: ['polyester'], length_hits_at: 'full_length' }
  const result = evaluateOutfitEnvironmentalAdequacy([bareSatin, heavyPants, BASE[2], PUFFER], {
    weatherProfile: W(60, 48),
    environment: 'outdoor',
    activity: 'walking',
    requireThermalAdequacy: true,
  })
  const finding = result.findings.find(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.WARM_END_THERMAL_UNDERSHOOT)
  assert.equal(finding?.severity, 'error')
  assert.equal(result.evidence.endpointFit.warmTarget, 'moderate')
  assert.equal(result.evidence.endpointFit.warm.verdict, 'substantial_shortfall')
})

test('removing the coat may leave another 60°F-adequate layer underneath', () => {
  const satinTop = { id: 10, category: 'top', fabric_weight: 'light', fabric_category: 'satin', fiber_content: ['polyester'], sleeve_length: 'three_quarter' }
  const result = evaluateOutfitEnvironmentalAdequacy([...BASE.slice(1), satinTop, CARDIGAN, PUFFER], {
    weatherProfile: W(60, 48),
    environment: 'outdoor',
    activity: 'walking',
    requireThermalAdequacy: true,
  })
  assert.ok(!result.findings.some(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.WARM_END_THERMAL_UNDERSHOOT))
  assert.equal(result.evidence.endpointFit.warm.verdict, 'fits')
  assert.ok(result.evidence.endpointFit.configurations.some(configuration =>
    configuration.removedPieceId === PUFFER.id && Math.abs(configuration.warmDelta) <= 1),
    'a configuration with the coat off suits the warm end')
})

test('REGRESSION (owner-specified): moderate base + moderate middle after the outer comes off, at a `warm` warm endpoint', () => {
  // The exact fixture the owner asked for, and the one that makes Concerns 1 and 2 a single change:
  // the upper-body credit places moderate + moderate at `warm`, and the adjacent-aware classifier
  // then ACCEPTS the coat-off configuration. Under the shipped calculation the same configuration
  // read `moderate` against a `warm` warm endpoint and fired a hard WARM_END_THERMAL_UNDERSHOOT.
  // The complete requireThermalAdequacy result is checked, not just a coverage flag.
  const primary = { id: 40, role: 'primary_top', category: 'top', fabric_weight: 'medium', fiber_content: ['cotton'], sleeve_length: 'long' }
  const middle = { id: 41, role: 'layer_top', category: 'outerwear', fabric_weight: 'medium', fabric_category: 'knit', fiber_content: ['wool'], sleeve_length: 'long' }
  const outer = { id: 42, role: 'outerwear', category: 'outerwear', fabric_weight: 'heavy', insulating_layer_materials: ['down'], sleeve_length: 'long' }
  const result = evaluateOutfitEnvironmentalAdequacy([primary, BASE[1], BASE[2], middle, outer], {
    weatherProfile: W(52, 40),
    environment: 'outdoor',
    activity: 'none',
    requireThermalAdequacy: true,
  })
  assert.equal(result.evidence.endpointFit.warmTarget, 'warm', 'the warm endpoint itself targets `warm` here')
  const coatOff = result.evidence.endpointFit.configurations.find(configuration => configuration.removedPieceId === outer.id)
  assert.equal(coatOff.level, 'warm', 'moderate base + moderate middle now reads `warm` (Concern 1)')
  assert.equal(coatOff.warmDelta, 0, 'and lands ON the warm endpoint rather than one under it')
  assert.deepEqual(result.hardFindings.map(f => f.code), [],
    `no hard finding under the explicit contract: ${JSON.stringify(result.hardFindings.map(f => f.code))}`)
  assert.ok(!result.findings.some(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.WARM_END_THERMAL_UNDERSHOOT))
})

// 2026-09-12, Concern 2 review. UNKNOWN EVIDENCE CANNOT PROVE ANYTHING. A configuration whose
// garments could not all be placed neither fits nor fails — but a configuration that IS known and
// does fit settles the endpoint on its own, because that is a way of wearing the outfit that works.
const { evaluateEndpointFit, wornConfigurations } = await import('../styling-engine/outfitEnvironmentalAdequacy.js')
const UNPLACEABLE_TOP = { id: 40, category: 'top', fabric_weight: null, fabric_category: null, fiber_content: [] }
const LIGHT_JACKET = { id: 41, category: 'outerwear', fabric_weight: 'light', fabric_category: 'cotton', fiber_content: ['cotton'], insulating_layer_materials: [], sleeve_length: 'long' }

test('an unknown base under a KNOWN layer stays unknown, even though `upperWithLayer` returns a level', () => {
  const configurations = wornConfigurations([UNPLACEABLE_TOP, BASE[1], BASE[2], LIGHT_JACKET])
  const asComposed = configurations.find(configuration => configuration.removedPieceId === null)
  // The precondition this test exists to pin: the level is non-null, so `delta != null` alone would
  // have treated this as evidence.
  assert.notEqual(outfitThermalContribution(asComposed.pieces).upperWithLayer, null)

  const fit = evaluateEndpointFit([asComposed], 'warm', { upperOnly: true, endpoint: 'cold' })
  assert.equal(fit.verdict, 'cannot_judge')
  assert.equal(fit.entries[0].unknown, true)
  assert.equal(fit.best, null, 'nothing known means there is no best configuration either')
})

test('one known-and-substantially-wrong configuration cannot convict while another is unknown', () => {
  // Two removable layers. Shed both and what remains is known and two levels under the
  // `very warm` target; take the cardigan off instead and the unplaceable base leaves that state
  // unknown. A mechanical shortfall claim would be asserting something the data does not support.
  const configurations = [
    { removedPieceId: 'all_layers', pieces: [BASE[0], BASE[1], BASE[2]], valid: true },
    { removedPieceId: CARDIGAN.id, pieces: [UNPLACEABLE_TOP, BASE[1], BASE[2], PUFFER], valid: true },
  ]
  const fit = evaluateEndpointFit(configurations, 'very warm', { upperOnly: true, endpoint: 'cold' })
  assert.equal(fit.entries.filter(entry => entry.unknown).length, 1)
  assert.ok(fit.entries.some(entry => !entry.unknown && entry.delta <= -2), 'the known one really is substantially short')
  assert.equal(fit.verdict, 'cannot_judge', 'an unknown configuration could have been the one that fits')
})

test('a KNOWN fitting configuration proves fit alongside an unknown one', () => {
  const configurations = [
    { removedPieceId: null, pieces: [UNPLACEABLE_TOP, BASE[1], BASE[2], PUFFER], valid: true },
    { removedPieceId: PUFFER.id, pieces: [BASE[0], BASE[1], BASE[2], CARDIGAN], valid: true },
  ]
  const fit = evaluateEndpointFit(configurations, 'warm', { upperOnly: true, endpoint: 'cold' })
  assert.equal(fit.verdict, 'fits')
  assert.equal(fit.best.removedPieceId, PUFFER.id)
  assert.ok(fit.entries.some(entry => entry.unknown), 'the unknown configuration is still reported as evidence')
})

test('configurations are REVALIDATED: removing a middle layer while keeping the outer can be unwearable', () => {
  // Removal is not structurally monotonic. Dropping the cardigan puts the voluminous sleeve of the
  // base directly under the narrow structured sleeve of the coat — an adjacency the composed outfit
  // never had. The evaluator does not own that judgement; it asks the injected validator.
  const composed = [BASE[0], BASE[1], BASE[2], CARDIGAN, PUFFER]
  const unchecked = wornConfigurations(composed)
  assert.ok(unchecked.every(configuration => configuration.valid === true),
    'with no validator every configuration is valid — the old behaviour, now stated')

  const rejected = []
  const configurations = wornConfigurations(composed, {
    validateConfiguration: (pieces, configuration) => {
      if (configuration.removedPieceId !== CARDIGAN.id) return true
      rejected.push(pieces.map(piece => piece.id))
      return false
    },
  })
  assert.deepEqual(rejected, [[BASE[0].id, BASE[1].id, BASE[2].id, PUFFER.id]],
    'the validator is asked about the middle-layer removal with the outer layer retained')
  assert.equal(configurations.find(configuration => configuration.removedPieceId === CARDIGAN.id).valid, false)

  // ...and an unwearable configuration is excluded from the fit question entirely.
  const fit = evaluateEndpointFit(configurations, 'light', { upperOnly: true, endpoint: 'warm' })
  assert.ok(!fit.entries.some(entry => entry.removedPieceId === CARDIGAN.id),
    'it cannot prove fit or carry a failure')
  assert.ok(fit.entries.some(entry => entry.removedPieceId === 'all_layers'))
})

test('the unknown asymmetry: it silences undershoot, not overshoot', () => {
  // An unplaceable base could be secretly warm, so "too light" is the claim the missing data could
  // falsify. It cannot make a `very warm` coat LESS excessive, and requiring complete evidence would
  // silence overshoot on nearly every real outfit — a plain medium cotton top is itself unplaceable.
  const unplaceableBase = [{ id: 9, category: 'top', fabric_weight: 'medium', fiber_content: ['unknown'] }, BASE[1], BASE[2]]
  // 2026-09-12, Concern 2: with the puffer OFF — the state the warm end is judged in — the only
  // remaining upper garment is unplaceable, so there is nothing to claim in either direction. That
  // is the ratified "unknown proves neither fit nor failure", and it replaces the older asymmetry
  // where overshoot was read off the layer while it was still being worn.
  assert.ok(!has([...unplaceableBase, PUFFER], W(72, 62), ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT),
    'an unplaceable remaining upper body cannot be judged excessive')
  // With a placeable base the same day still reports genuine, non-removable excess.
  const heavyWoolTop = { id: 31, category: 'top', fabric_weight: 'heavy', fiber_content: ['wool'], sleeve_length: 'long', neckline: 'mock_neck' }
  assert.ok(has([heavyWoolTop, BASE[1], BASE[2]], W(72, 62), ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT),
    'positive evidence of excess that cannot come off is still reported')
  assert.ok(!has([...unplaceableBase, CARDIGAN], W(30, 20), ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_UNDERSHOOT),
    'undershoot stays silent when the base cannot be placed')
})

test('the neighbouring contracts are untouched', () => {
  // Removability, transit coverage and outdoor capability are different questions from "how much
  // insulation" and keep their own triggers (§2.1). This slice migrated the AMOUNT only.
  const src = fs.readFileSync(path.join(process.cwd(), 'styling-engine/outfitEnvironmentalAdequacy.js'), 'utf8')
  for (const kept of ['weather.needsRemovableCoolLayer', 'weather.transitNeedsRemovableCoolLayer',
                      'weather.transitIsCold', 'weather.isColdSevere']) {
    assert.ok(src.includes(kept), `${kept} must still drive its own contract`)
  }
})

test('semantic signals only — no reason-string matching', () => {
  // The ranking slice found a filter keyed on a reason STRING that silently stopped matching when
  // the band renamed it. Prose is not an API.
  const src = fs.readFileSync(path.join(process.cwd(), 'styling-engine/outfitEnvironmentalAdequacy.js'), 'utf8')
  const live = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
  assert.ok(!/adjustment\.reason\s*===/.test(live), 'no reason-string equality checks')
  assert.ok(live.includes('compareThermalFit'), 'the comparison comes from the band')
})

// --- cross-flow behaviour (approved plan, Concern 3) --------------------------------------------
// One evaluator now answers the amount question for every flow, so these assert the crossings
// rather than any single call site: forecast certainty, adjacency versus substantial mismatch,
// explicit layer requests, severe outdoor and transit, missing metadata, and no weather at all.

test('cross-flow: an EXACT stated range and a COARSE estimate ask the same question at different severity', () => {
  const pieces = [BASE[0], BASE[1], BASE[2]]
  const stated = evaluateOutfitEnvironmentalAdequacy(pieces, {
    weatherProfile: { ...W(38, 30), source: 'stated_user' },
    environment: 'outdoor', activity: 'none', requireThermalAdequacy: true,
  })
  const estimated = evaluateOutfitEnvironmentalAdequacy(pieces, {
    weatherProfile: { ...W(38, 30), source: 'model_estimate' },
    environment: 'outdoor', activity: 'none', requireThermalAdequacy: true,
  })
  const undershoot = result => (result.findings || []).find(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_UNDERSHOOT)
  assert.equal(undershoot(stated)?.severity, 'error', 'a certain range plus an explicit layer requirement hard-blocks')
  assert.equal(undershoot(estimated)?.severity, 'advisory', 'an uncertain forecast never hard-blocks on amount')
})

test('cross-flow: adjacent never becomes a finding; substantial does, in either direction', () => {
  // Adjacent under — one level below the 48F cold endpoint.
  const trench = { id: 8, category: 'outerwear', fabric_weight: 'medium', fiber_content: ['cotton'], insulating_layer_materials: [], interior_construction: 'full_lining', sleeve_length: 'long' }
  const adjacent = evaluateOutfitEnvironmentalAdequacy([...BASE, trench], { weatherProfile: W(60, 48), environment: 'outdoor', activity: 'none' })
  assert.deepEqual((adjacent.findings || []).map(f => f.code).filter(code =>
    code === ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_UNDERSHOOT || code === ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT), [])

  // Substantial under, and substantial over that cannot come off — the same evaluator, both ways.
  const camisole = { id: 50, category: 'top', fabric_weight: 'light', fiber_content: ['silk'], sleeve_length: 'sleeveless' }
  const short = evaluateOutfitEnvironmentalAdequacy([camisole, BASE[1], BASE[2]], { weatherProfile: W(38, 30), environment: 'outdoor', activity: 'none' })
  assert.ok((short.findings || []).some(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_UNDERSHOOT))
  const heavyWoolTop = { id: 51, category: 'top', fabric_weight: 'heavy', fiber_content: ['wool'], sleeve_length: 'long' }
  const over = evaluateOutfitEnvironmentalAdequacy([heavyWoolTop, BASE[1], BASE[2]], { weatherProfile: W(80, 70), environment: 'outdoor', activity: 'none' })
  assert.ok((over.findings || []).some(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT))
})

test('cross-flow: an explicit layer request is judged at BOTH endpoints', () => {
  // The freeform "I want a jacket" contract. A required removable layer creates two worn states, so
  // the same evaluator answers twice: enough warmth with it on, and still enough with it off.
  const camisole = { id: 50, category: 'top', fabric_weight: 'light', fiber_content: ['silk'], sleeve_length: 'sleeveless' }
  const context = {
    weatherProfile: { ...W(50, 42), source: 'stated_user' },
    environment: 'outdoor', activity: 'none', requireThermalAdequacy: true,
  }
  const codesFor = pieces => (evaluateOutfitEnvironmentalAdequacy(pieces, context).findings || []).map(f => f.code)

  assert.ok(codesFor([camisole, BASE[1], BASE[2]]).includes(ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_UNDERSHOOT),
    'no layer at all: substantially short at the cold end')
  assert.ok(codesFor([camisole, BASE[1], BASE[2], CARDIGAN]).includes(ENVIRONMENTAL_ADEQUACY_CODES.WARM_END_THERMAL_UNDERSHOOT),
    'layer added: the cold end is answered, and the bare camisole left behind is now the finding')
  assert.deepEqual(codesFor([BASE[0], BASE[1], BASE[2], CARDIGAN]), [],
    'an adequate base under the same layer satisfies both endpoints')
})

test('cross-flow: severe outdoor exposure and severe transit are separate contracts', () => {
  const severe = { ...W(40, 30), isCold: true, isColdSevere: true }
  const outdoor = evaluateOutfitEnvironmentalAdequacy([...BASE], { weatherProfile: severe, environment: 'outdoor' })
  assert.ok((outdoor.findings || []).some(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.NO_OUTDOOR_LAYER_FOR_SEVERE_COLD),
    'sustained exposure asks for an outdoor-capable layer')

  const transit = evaluateOutfitEnvironmentalAdequacy([...BASE], {
    weatherProfile: { transitIsCold: true, transitIsColdSevere: true }, environment: 'indoor',
  })
  assert.ok((transit.findings || []).some(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.NO_TRANSIT_LAYER_FOR_SEVERE_COLD),
    'an indoor destination still needs removable coverage for getting there')
  assert.ok(!(transit.findings || []).some(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_CAPACITY_INSUFFICIENT),
    'and the indoor base is never graded for sustained-exposure capacity')
})

test('cross-flow: missing metadata produces cannot_judge, never a mechanical fault', () => {
  // Severe cold, nothing tagged, and an untagged coat so the separate PRESENCE contract is
  // satisfied and only the amount question is under test.
  const untagged = [
    { id: 60, category: 'top', name: 'untagged top' },
    { id: 61, category: 'bottom', name: 'untagged bottom' },
    BASE[2],
    { id: 62, category: 'outerwear', name: 'untagged coat', sleeve_length: 'long' },
  ]
  const result = evaluateOutfitEnvironmentalAdequacy(untagged, { weatherProfile: W(38, 30), environment: 'outdoor', activity: 'none' })
  assert.equal(result.evidence.endpointFit.cold.verdict, 'cannot_judge')
  assert.equal(result.evidence.severeColdFit.verdict, 'cannot_judge')
  assert.ok(!(result.findings || []).some(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_UNDERSHOOT))
  assert.deepEqual((result.findings || []).map(f => f.code), [ENVIRONMENTAL_ADEQUACY_CODES.CAPABILITY_UNKNOWN],
    'the only output is an inability-to-judge advisory')
  assert.ok(!(result.hardFindings || []).length, 'absence of evidence is never hard invalidity')
})

test('cross-flow: with no weather context the whole contract is a no-op', () => {
  const result = evaluateOutfitEnvironmentalAdequacy([...BASE, PUFFER], {})
  assert.equal(result.applicable, false)
  assert.deepEqual(result.findings || [], [])
})
