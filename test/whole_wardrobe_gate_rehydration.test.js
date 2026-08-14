import test from 'node:test'
import assert from 'node:assert/strict'
import { locallyGateWholeWardrobeOutfits, normalizeWholeWardrobeOutfitObject } from '../styling-engine/rules.js'

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
  const gated = locallyGateWholeWardrobeOutfits([registerViolation, footwearViolation], 5, {
    mode: 'advisor',
    requireShoes: true,
    applyDiversity: false,
    candidatePieces,
    occasion: 'casual',
    activity: 'walking'
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
test('normalizeWholeWardrobeOutfitObject carries styling_instructions through from the model output, and defaults to empty when absent', () => {
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
    { label: 'Without mechanics', pieceIds: [301, 303, 302] },
    candidatePieces
  )
  assert.equal(withoutMechanics.stylingInstructions, '')
})
