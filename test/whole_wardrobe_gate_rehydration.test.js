import test from 'node:test'
import assert from 'node:assert/strict'
import { locallyGateWholeWardrobeOutfits, normalizeWholeWardrobeOutfitObject, sanitizeWholeWardrobeOutfitProse } from '../styling-engine/rules.js'

// Spec 29 Part 1 regression test — runs the REAL production sequence (DB-shaped full pieces ->
// normalizeWholeWardrobeOutfitObject -> locallyGateWholeWardrobeOutfits), the exact chain
// /evaluate-piece uses (routes/ai.js:~1804, ~1816), instead of hand-building already-full outfit
// objects the way test/formality_gate.test.js and test/spec9_advisor_mode_precompose_fallbacks.test.js
// do. Those fixtures bypass normalizeWholeWardrobeOutfitObject's trim entirely, which is why the P0
// bug had zero coverage. Must be verified RED against pre-fix code before the fix lands.

const base = {
  status: 'active',
  colors: [],
  occasions: ['casual'],
  styling_rules_learned: [],
  pairs_well_with: [],
  tried_and_rejected: [],
  style_profile_json: {},
  photo: null,
  worn_photo: null
}

test('locallyGateWholeWardrobeOutfits rehydrates trimmed pieces so register-ceiling and footwear gates actually fire', () => {
  // A dressy top under a 'casual' occasion (register_ceiling: 'everyday') must trip the register gate.
  const dressyTop = { ...base, id: 301, name: 'silk cami top', category: 'top', formality: 'dressy' }
  const flatShoe = { ...base, id: 302, name: 'canvas slip shoe', category: 'shoes', formality: 'everyday', heel_height: 'flat', walk_support: 'high' }
  const everydayBottom = { ...base, id: 303, name: 'cotton trousers', category: 'bottom', formality: 'everyday' }

  // A high heel under a 'walking' activity profile (excluded_heel_heights includes 'high') must
  // trip the footwear-comfort gate. Neither other piece here is dressy, so this outfit isolates
  // the footwear check from the register check above.
  const everydayTop = { ...base, id: 304, name: 'cotton tee', category: 'top', formality: 'everyday' }
  const highHeel = { ...base, id: 305, name: 'pointed pump', category: 'shoes', formality: 'everyday', heel_height: 'high', walk_support: 'low' }
  const everydayBottom2 = { ...base, id: 306, name: 'denim trousers', category: 'bottom', formality: 'everyday' }

  const candidatePieces = [dressyTop, flatShoe, everydayBottom, everydayTop, highHeel, everydayBottom2]

  // The model/route only ever hands back id references (or already-normalized outfits); the route
  // resolves them against the full candidate pool and then calls normalizeWholeWardrobeOutfitObject,
  // which is where the trim to {id, name, category, photo, worn_photo} happens today.
  const registerViolation = normalizeWholeWardrobeOutfitObject(
    { label: 'Register violation', pieceIds: [301, 303, 302] },
    candidatePieces
  )
  const footwearViolation = normalizeWholeWardrobeOutfitObject(
    { label: 'Footwear violation', pieceIds: [304, 306, 305] },
    candidatePieces
  )

  // Sanity check that the fixture really does reproduce the trimmed shape the bug depends on —
  // if this ever fails, normalizeWholeWardrobeOutfitObject's trim behavior changed and this test
  // needs to be revisited, not silently left green for the wrong reason.
  assert.equal(registerViolation.pieces.every(p => p.formality === undefined), true)
  assert.equal(footwearViolation.pieces.every(p => p.heel_height === undefined), true)

  // Mirrors the real /evaluate-piece call: mode 'advisor', no repair override, candidatePieces is
  // the full allowed-pieces pool.
  // 2026-09-13: the subject here is REHYDRATION — that a trimmed card's pieces get their formality
  // and heel_height back so the gates can see them at all. An inferred ceiling now ranks instead of
  // gating, so the register half is driven with a stated maximum; otherwise this would be asserting
  // the old gate semantics rather than the rehydration it exists for.
  const gated = locallyGateWholeWardrobeOutfits([registerViolation, footwearViolation], 5, {
    mode: 'advisor',
    requireShoes: true,
    applyDiversity: false,
    candidatePieces,
    occasion: 'casual',
    activity: 'walking',
    request: 'nothing dressy please'
  })

  const registerOutfit = gated.outfits.find(o => o.label === 'Register violation')
  const footwearOutfit = gated.outfits.find(o => o.label === 'Footwear violation')

  assert.ok(registerOutfit, 'the register-violating outfit should still be returned in advisor mode, flagged not silently dropped')
  assert.ok(footwearOutfit, 'the footwear-violating outfit should still be returned in advisor mode, flagged not silently dropped')

  const registerFlags = (registerOutfit.systemFlags || []).map(f => f.message).join(' | ')
  const footwearFlags = (footwearOutfit.systemFlags || []).map(f => f.message).join(' | ')

  // Pre-fix: formality/heel_height are undefined on the trimmed pieces, so profileRuleFit resolves
  // both to tier 'unknown' instead of 'prohibited', producing a generic
  // "Not yet tagged for this gate ... verify manually" flag instead of a real exclusion warning.
  assert.match(registerFlags, /exceeds everyday ceiling/, 'register ceiling must actually fire on the dressy piece, not degrade to "not yet tagged"')
  assert.doesNotMatch(registerFlags, /not yet tagged/i)

  assert.match(footwearFlags, /heel unsuitable/, 'footwear comfort must actually fire on the high heel, not degrade to "not yet tagged"')
  assert.doesNotMatch(footwearFlags, /not yet tagged/i)
})

// 2026-08-14: normalizeWholeWardrobeOutfitObject is a field-by-field whitelist, not a spread — a
// new field the model returns (e.g. styling_instructions, the whole-wardrobe visual composer's
// authoritative garment-relationship mechanics field) is silently dropped here unless explicitly
// carried through, the same class of gap the trim above already causes for gate-relevant fields.
test('normalizeWholeWardrobeOutfitObject preserves explicit renderer instructions without inferring them from silhouette', () => {
  const dressyTop = { ...base, id: 301, name: 'silk cami top', category: 'top', formality: 'dressy' }
  const flatShoe = { ...base, id: 302, name: 'canvas slip shoe', category: 'shoes', formality: 'everyday', heel_height: 'flat', walk_support: 'high' }
  const everydayBottom = { ...base, id: 303, name: 'cotton trousers', category: 'bottom', formality: 'everyday' }
  const candidatePieces = [dressyTop, flatShoe, everydayBottom]

  const withMechanics = normalizeWholeWardrobeOutfitObject(
    { label: 'With mechanics', pieceIds: [301, 303, 302], styling_instructions: 'Leave the top untucked over the trousers.' },
    candidatePieces
  )
  assert.equal(withMechanics.stylingInstructions, 'Leave the top untucked over the trousers.')

  const withoutMechanics = normalizeWholeWardrobeOutfitObject(
    { label: 'Without mechanics', pieceIds: [301, 303, 302], silhouette: 'compact top over wide trousers' },
    candidatePieces
  )
  assert.equal(withoutMechanics.stylingInstructions, '')
})

test('composer prose integrity withholds deliberation and IDs outside the final card without another model call', () => {
  const outfit = {
    label: 'Final card',
    pieceIds: [301, 302, 303],
    pieces: [
      { id: 301, name: 'cream top' },
      { id: 302, name: 'olive pants' },
      { id: 303, name: 'grey sneakers' }
    ],
    reason: 'Wait — rebuilding. Checking available tops: ID 999. Using it despite the recently-shown list.'
  }
  const sanitized = sanitizeWholeWardrobeOutfitProse(outfit)
  assert.match(sanitized.reason, /original explanation was withheld/)
  assert.deepEqual(sanitized.proseIntegrityIssues, [
    'reason: exposed composer deliberation',
    'reason: cited IDs outside final card: 999'
  ])
  assert.match(sanitized.resolutionNote, /review the final garment combination/)
})

test('a false silhouette does not overwrite separate explicit renderer instructions', () => {
  const candidatePieces = [
    { ...base, id: 311, name: 'black top', category: 'top' },
    { ...base, id: 312, name: 'apple skirt', category: 'bottom', bottom_subtype: 'skirt', length_hits_at: 'midi' },
    { ...base, id: 313, name: 'black mules', category: 'shoes' }
  ]
  const normalized = normalizeWholeWardrobeOutfitObject({
    label: 'Wrong silhouette',
    pieceIds: [311, 312, 313],
    silhouette: 'fitted top over wide-leg trousers',
    styling_instructions: 'Wear the top fully over the skirt waistband.',
    reason: 'The black top lets the apple skirt lead.'
  }, candidatePieces)
  const sanitized = sanitizeWholeWardrobeOutfitProse(normalized)
  assert.equal(sanitized.stylingInstructions, 'Wear the top fully over the skirt waistband.')
})

test('composer prose integrity preserves a clean explanation tied to final IDs', () => {
  const outfit = {
    pieceIds: [301, 302, 303],
    pieces: [{ id: 301, name: 'cream top' }, { id: 302, name: 'olive pants' }, { id: 303, name: 'grey sneakers' }],
    reason: 'The cream texture softens the olive utility line, while sneakers keep the look grounded for movement.'
  }
  assert.equal(sanitizeWholeWardrobeOutfitProse(outfit), outfit)
})

test('composer prose integrity withholds a silhouette that calls a skirt trousers', () => {
  const outfit = {
    pieceIds: [301, 302, 303],
    pieces: [
      { id: 301, name: 'black top', category: 'top', bottomKind: null },
      { id: 302, name: 'apple skirt', category: 'bottom', bottomKind: 'skirt-midi' },
      { id: 303, name: 'black mules', category: 'shoes', bottomKind: null }
    ],
    silhouette: 'fitted dark top over wide-leg trouser, clean vertical column',
    reason: 'The black top lets the apple skirt lead.'
  }
  const sanitized = sanitizeWholeWardrobeOutfitProse(outfit)
  assert.equal(sanitized.reason, outfit.reason, 'a correct reason remains intact')
  assert.match(sanitized.silhouette, /withheld because it did not match/)
  assert.match(sanitized.proseIntegrityIssues.join(' '), /silhouette: named a bottom category/)
})

test('composer prose integrity removes recent-memory deliberation from watchFor independently', () => {
  const outfit = {
    reason: 'The red graphic and brown twill make a clear warm color story.',
    watchFor: 'The red tee has been recently shown — justified here as the clearest option.',
    stylingInstructions: '',
    pieceIds: [350, 214],
    pieces: [{ id: 350, name: 'red graphic tee' }, { id: 214, name: 'black canvas sneakers' }]
  }
  const sanitized = sanitizeWholeWardrobeOutfitProse(outfit)
  assert.equal(sanitized.reason, outfit.reason)
  assert.equal(sanitized.watchFor, 'none')
  assert.match(sanitized.proseIntegrityIssues.join(' '), /watchFor: exposed composer deliberation/)
})

test('composer prose integrity preserves legitimate imperative wear instructions', () => {
  const outfit = {
    reason: 'The belt gives the open layer a deliberate center.',
    watchFor: 'none',
    stylingInstructions: 'You must use the belt over the cardigan, not beneath it; wait until the cardigan is on before fastening it.',
    pieceIds: [401, 402],
    pieces: [{ id: 401, name: 'cardigan' }, { id: 402, name: 'belt' }]
  }
  assert.equal(sanitizeWholeWardrobeOutfitProse(outfit), outfit)
})

// ─── the endpoint evaluator, through the whole-wardrobe gate ───────────────────────────────────
//
// Concern 3 review: the shared primitive's semantics live in test/thermalAdequacyMigration. What
// this pins is the WIRING of the Whole Wardrobe flow — that `locallyGateWholeWardrobeOutfits`
// passes its resolved weatherProfile into the shared Contract C stage, that rehydration restores
// the thermal facts the trimmed card lost, and that the verdict comes back as a card annotation.
import { resolveWeatherContext, validateUserWeather } from '../styling-engine/weather.js'

// Exact finding texts, so these pin WHICH finding fired rather than prose several findings satisfy.
// Codes do not survive into `systemFlags` or the gate's rejection reasons — both carry messages —
// so the message is the identity available at this layer.
const SEVERE_CAPACITY_MESSAGE = 'the outer layer is outdoor-capable, but the layers under it are light enough that this outfit carries little insulation for sustained cold — if no owned piece can satisfy this, say so as a wardrobe gap rather than resubmitting — re-plan at a milder context or accept the disclosed shortfall'
const COLD_END_SHORTFALL_MESSAGE = 'no way of wearing this outfit carries enough warmth for the cold end of these conditions'

test('WHOLE WARDROBE: the endpoint evaluator runs on the gate weather and its verdict reaches the card', () => {
  const lightTee = { ...base, id: 401, name: 'light cotton tee', category: 'top', formality: 'everyday', fabric_weight: 'light', fiber_content: ['cotton'], sleeve_length: 'long' }
  const woolSweater = { ...base, id: 402, name: 'wool sweater', category: 'top', formality: 'everyday', fabric_weight: 'heavy', fiber_content: ['wool'], sleeve_length: 'long' }
  const denim = { ...base, id: 403, name: 'denim trousers', category: 'bottom', formality: 'everyday', fabric_weight: 'medium', fabric_category: 'denim', fiber_content: ['denim'], length_hits_at: 'ankle' }
  const boots = { ...base, id: 404, name: 'leather boots', category: 'shoes', formality: 'everyday', shoe_type: 'boot', heel_height: 'flat', walk_support: 'high', fabric_category: 'leather' }
  const shell = { ...base, id: 405, name: 'rain shell', category: 'outerwear', formality: 'everyday', fabric_weight: 'light', fiber_content: ['polyester'], sleeve_length: 'long', weather_protection: ['rain'] }
  const candidatePieces = [lightTee, woolSweater, denim, boots, shell]

  const weatherProfile = resolveWeatherContext({ userWeather: validateUserWeather({ high_f: 35, low_f: 25 }) }).temperature
  const gateFor = topId => {
    const card = normalizeWholeWardrobeOutfitObject({ label: `card ${topId}`, pieceIds: [topId, 403, 404, 405] }, candidatePieces)
    // The trim is the whole reason rehydration matters here: the card the gate receives carries no
    // fabric_weight at all, so a gate that judged the card as given would see no thermal facts.
    assert.equal(card.pieces.every(piece => piece.fabric_weight === undefined), true)
    const gated = locallyGateWholeWardrobeOutfits([card], 5, {
      mode: 'advisor', requireShoes: true, applyDiversity: false,
      candidatePieces, occasion: 'casual', weatherProfile,
    })
    const outfit = gated.outfits.find(o => o.label === `card ${topId}`)
    return { outfit, rejected: gated.rejected, flags: (outfit?.systemFlags || []).map(f => f.message) }
  }

  // DISPOSITION AND FINDING BOTH PINNED. 35/25 with a light base under a light shell is a known
  // substantial severe-cold shortfall — an ERROR, so this card must be REJECTED by the gate rather
  // than shipped with a note. "Rejected or annotated" would let a later severity downgrade keep
  // this test green while the flow quietly started delivering the card.
  const tooLight = gateFor(401)
  assert.equal(tooLight.outfit, undefined, 'a hard severe-cold shortfall is rejected, not annotated')
  const rejection = JSON.stringify(tooLight.rejected)
  assert.ok(rejection.includes(SEVERE_CAPACITY_MESSAGE),
    `the rejection carries the severe-cold capacity finding verbatim: ${rejection}`)

  // The control: same weather, same shell, a base that answers the cold end — delivered, and with
  // neither thermal finding attached.
  const adequate = gateFor(402)
  assert.ok(adequate.outfit, 'the adequate card survives the gate')
  assert.ok(!adequate.flags.includes(SEVERE_CAPACITY_MESSAGE) && !adequate.flags.includes(COLD_END_SHORTFALL_MESSAGE),
    `an adequate card carries neither thermal finding: ${JSON.stringify(adequate.flags)}`)
})

test('WHOLE WARDROBE: the structured activity reaches the evaluator — same weather, same garments, hiking is not sedentary', () => {
  // The gate already receives `activity`; it used to drop it on the way into the weather context,
  // so exertion resolved to `unknown` and no shift applied. At 45/35 that is not a ranking nudge:
  // the cold endpoint moves from `very warm` (sedentary) to `moderate` (hiking), two taxonomy
  // levels, which is the difference between a substantial shortfall and a comfortable fit.
  const lightTee = { ...base, id: 411, name: 'light cotton tee', category: 'top', formality: 'everyday', fabric_weight: 'light', fiber_content: ['cotton'], sleeve_length: 'long' }
  const denim = { ...base, id: 412, name: 'denim trousers', category: 'bottom', formality: 'everyday', fabric_weight: 'medium', fabric_category: 'denim', fiber_content: ['denim'], length_hits_at: 'ankle' }
  const boots = { ...base, id: 413, name: 'trail boots', category: 'shoes', formality: 'everyday', shoe_type: 'boot', heel_height: 'flat', walk_support: 'high', fabric_category: 'leather' }
  const shell = { ...base, id: 414, name: 'rain shell', category: 'outerwear', formality: 'everyday', fabric_weight: 'light', fiber_content: ['polyester'], sleeve_length: 'long', weather_protection: ['rain'] }
  const candidatePieces = [lightTee, denim, boots, shell]
  const weatherProfile = resolveWeatherContext({ userWeather: validateUserWeather({ high_f: 45, low_f: 35 }) }).temperature

  const gateWith = activity => {
    const card = normalizeWholeWardrobeOutfitObject({ label: 'Trail card', pieceIds: [411, 412, 413, 414] }, candidatePieces)
    const gated = locallyGateWholeWardrobeOutfits([card], 5, {
      mode: 'advisor', requireShoes: true, applyDiversity: false,
      candidatePieces, occasion: 'casual', weatherProfile, activity,
    })
    const outfit = gated.outfits.find(o => o.label === 'Trail card')
    return {
      delivered: Boolean(outfit),
      text: ((outfit?.systemFlags || []).map(f => f.message).join(' | ')) + JSON.stringify(gated.rejected),
    }
  }

  const sedentary = gateWith('none')
  assert.equal(sedentary.delivered, false, 'sedentary at 45/35: a light base under a shell is rejected outright')
  assert.ok(sedentary.text.includes(SEVERE_CAPACITY_MESSAGE),
    `and rejected for the severe-cold capacity finding specifically: ${sedentary.text}`)

  const hiking = gateWith('hiking')
  assert.equal(hiking.delivered, true, 'the same card, the same weather, delivered for hiking')
  assert.ok(!hiking.text.includes(SEVERE_CAPACITY_MESSAGE) && !hiking.text.includes(COLD_END_SHORTFALL_MESSAGE),
    `and with neither thermal finding attached: ${hiking.text}`)
})

// USER-FACING PRIMARY (owner ruling 2026-09-13). A Whole Wardrobe card the gate rejects becomes a
// diagnostic card whose `rejectionReason` is this reason. Several typed thermal errors can describe
// one shortfall; the owner reads the approved primary, and the typed findings stay on the validation.
test('locallyGateWholeWardrobeOutfits rejects with one primary thermal explanation', async () => {
  const { resolveWeatherContext, validateUserWeather } = await import('../styling-engine/weather.js')
  const { evaluateWearableOutfit } = await import('../styling-engine/outfitValidation.js')
  const { ENVIRONMENTAL_ADEQUACY_CODES: C } = await import('../styling-engine/outfitEnvironmentalAdequacy.js')
  const weatherProfile = {
    ...resolveWeatherContext({ userWeather: validateUserWeather({ high_f: 45, low_f: 35 }) }).temperature,
    coldPresenceRequirement: { state: 'required' },
  }
  const tee = { ...base, id: 401, name: 'cotton long sleeve tee', category: 'top', formality: 'everyday', fabric_weight: 'medium', fiber_content: ['cotton'], sleeve_length: 'long' }
  const trousers = { ...base, id: 402, name: 'cotton trousers', category: 'bottom', formality: 'everyday', fabric_weight: 'medium', fiber_content: ['cotton'] }
  const boots = { ...base, id: 403, name: 'leather boots', category: 'shoes', formality: 'everyday', heel_height: 'flat', walk_support: 'high' }
  const jacket = { ...base, id: 404, name: 'unlined cotton jacket', category: 'outerwear', formality: 'everyday', fabric_weight: 'medium', fabric_category: 'cotton', fiber_content: ['cotton'], insulating_layer_materials: [], interior_construction: 'unlined', weather_protection: ['wind'], sleeve_length: 'long', opacity: 'opaque' }
  const candidatePieces = [tee, trousers, boots, jacket]

  const typed = evaluateWearableOutfit(
    [{ ...tee, role: 'primary_top' }, { ...trousers, role: 'primary_bottom' }, { ...boots, role: 'shoes' }, { ...jacket, role: 'outerwear' }],
    { requireShoes: true, weatherContext: { weatherProfile, activity: 'none' } },
  )
  const typedCodes = typed.hardFindings.map(finding => finding.code)
  assert.ok(typedCodes.includes(C.NO_WARM_LAYER_FOR_COLD) && typedCodes.includes(C.THERMAL_CAPACITY_SHORT_WITHOUT_INSULATION_EVIDENCE),
    `both typed errors exist: ${JSON.stringify(typedCodes)}`)

  const card = normalizeWholeWardrobeOutfitObject({ label: 'Cotton jacket card', pieceIds: [401, 402, 403, 404] }, candidatePieces)
  const gated = locallyGateWholeWardrobeOutfits([card], 1, { mode: 'advisor', applyDiversity: false, candidatePieces, occasion: 'casual', weatherProfile, activity: 'none' })
  assert.equal(gated.outfits.length, 0)
  const noWarm = typed.hardFindings.find(finding => finding.code === C.NO_WARM_LAYER_FOR_COLD).message
  const adjacent = typed.hardFindings.find(finding => finding.code === C.THERMAL_CAPACITY_SHORT_WITHOUT_INSULATION_EVIDENCE).message
  assert.equal(gated.rejected[0].reason, noWarm, 'the owner-facing reason is the approved primary')
  assert.ok(!gated.rejected[0].reason.includes(adjacent), 'the lower-precedence thermal error is not repeated to the owner')
})

// thread_1789526496845, card "Olive Mock Neck and Corduroy Pants": watchFor read "Mixing olive and
// emerald requires confidence in saturated earth tones" — a color-boldness remark, not body-shape
// framing — and the body-shape-language check fired anyway on the bare word "confidence", then
// claimed "Removed body-shape framing from the explanation" while the scrub function only ever
// touched `reason`, which had nothing to scrub. Two bugs: an over-broad trigger word, and a flag
// whose claim did not match what (if anything) actually changed.
test('language-flag check: a color-confidence remark is not body-shape framing, and the flag never claims a removal that did not happen', () => {
  const olive = { ...base, id: 601, name: 'olive textured mock neck top', category: 'top', formality: 'everyday' }
  const corduroy = { ...base, id: 602, name: 'emerald corduroy straight pants', category: 'bottom', formality: 'everyday' }
  const shoe = { ...base, id: 603, name: 'suede wedge ankle boot', category: 'shoes', formality: 'everyday', heel_height: 'low', walk_support: 'high' }
  const candidatePieces = [olive, corduroy, shoe]

  const card = normalizeWholeWardrobeOutfitObject({
    label: 'Olive Mock Neck and Corduroy Pants',
    pieceIds: [601, 602, 603],
    reason: 'Olive textured mock neck top provides cozy warmth paired with emerald corduroy straight pants, creating a rich tonal autumn palette.',
    watchFor: 'Mixing olive and emerald requires confidence in saturated earth tones.',
  }, candidatePieces)

  const gated = locallyGateWholeWardrobeOutfits([card], 1, {
    mode: 'advisor', applyDiversity: false, candidatePieces, occasion: 'casual', activity: 'none',
  })
  const outfit = gated.outfits.find(o => o.label === 'Olive Mock Neck and Corduroy Pants')
  assert.ok(outfit, 'the card survives advisor mode')
  assert.equal(outfit.watchFor, 'Mixing olive and emerald requires confidence in saturated earth tones.',
    'a color-confidence remark is not body-shape framing and must not be scrubbed')
  assert.equal(outfit.reason, card.reason, 'reason is untouched')
  assert.ok(!(outfit.systemFlags || []).some(f => f.type === 'language'),
    `no language flag fires on a non-body-shape remark: ${JSON.stringify(outfit.systemFlags)}`)

  // Second half: when the pattern DOES genuinely appear, but only in watchFor (not reason or the
  // label), the flag must scrub the field that actually contains it and only claim removal when
  // one occurred. (The label deliberately avoids the trigger words themselves — this test is about
  // watchFor-only detection, not about the label-emptying edge case a self-matching label would add.)
  const flattering = normalizeWholeWardrobeOutfitObject({
    label: 'Ribbed Column',
    pieceIds: [601, 602, 603],
    reason: 'Olive textured mock neck top provides cozy warmth paired with emerald corduroy straight pants.',
    watchFor: 'This silhouette is very flattering and elongating for city walking.',
  }, candidatePieces)
  const gatedFlattering = locallyGateWholeWardrobeOutfits([flattering], 1, {
    mode: 'advisor', applyDiversity: false, candidatePieces, occasion: 'casual', activity: 'none',
  })
  const flatteringOutfit = gatedFlattering.outfits.find(o => o.label === 'Ribbed Column')
  assert.ok(flatteringOutfit, 'the card survives advisor mode')
  assert.equal(flatteringOutfit.reason, flattering.reason, 'reason had nothing to scrub and is untouched')
  assert.equal(flatteringOutfit.watchFor, '', 'the offending sentence is removed from the field that actually carried it')
  assert.ok((flatteringOutfit.systemFlags || []).some(f => f.type === 'language' && f.message.includes('Removed body-shape framing')),
    'the flag fires only now, when a sentence was genuinely removed')

  // Third half (item 4, consistency): the SAME pattern landing in `label` alone is now scrubbed
  // too, not just detected-and-ignored — detection and scrub cover the same field set.
  const labelOnly = normalizeWholeWardrobeOutfitObject({
    label: 'A flattering column look',
    pieceIds: [601, 602, 603],
    reason: 'Olive textured mock neck top provides cozy warmth paired with emerald corduroy straight pants.',
    watchFor: 'Great for a casual afternoon.',
  }, candidatePieces)
  const gatedLabelOnly = locallyGateWholeWardrobeOutfits([labelOnly], 1, {
    mode: 'advisor', applyDiversity: false, candidatePieces, occasion: 'casual', activity: 'none',
  })
  const labelOnlyOutfit = gatedLabelOnly.outfits[0]
  assert.ok(labelOnlyOutfit, 'the card survives advisor mode')
  assert.equal(labelOnlyOutfit.label, '', 'the label itself is scrubbed when it is the field that carried the flagged language')
  assert.equal(labelOnlyOutfit.watchFor, labelOnly.watchFor, 'an untouched field is left alone')
  assert.ok((labelOnlyOutfit.systemFlags || []).some(f => f.type === 'language'),
    'the flag fires because the label genuinely changed')
})

