import test from 'node:test'
import assert from 'node:assert/strict'
import { wholeWardrobePieceTrustDecision, registerFitPieceAdvisory } from '../styling-engine/rules.js'
import { evaluateAutomaticUsePiecePool } from '../styling-engine/eligibility.js'

function generationPool(pieces, context) {
  const result = evaluateAutomaticUsePiecePool({ pieces, context, policy: { hotOuterwearCap: 3 } })
  return { allowedPieces: result.eligiblePieces, suppressedPieces: result.underlyingExcludedPieces }
}

// Spec 5 (superseded by spec 8, 2026-07-09): register-ceiling gate for the trip-precompose path.
// Originally opt-in (options.applyRegisterCeiling / options.registerCeiling), mirroring spec 1's
// mode-switch on profileRuleFit itself, so other callers of wholeWardrobePieceTrustDecision were
// unaffected unless they opted in. Spec 8 retired the opt-in: register-ceiling AND footwear-enum
// awareness are now unconditional for every caller of this function, matching the two other fully
// gated composition paths (search_wardrobe, buildVisualComposerRoster). These tests now assert the
// unconditional contract rather than the mode-switch.

const dressyPiece = { id: 501, category: 'top', formality: 'dressy' }
const everydayPiece = { id: 502, category: 'top', formality: 'everyday' }
const highHeelShoe = { id: 503, category: 'shoes', heel_height: 'high', walk_support: 'low' }
const flatShoe = { id: 504, category: 'shoes', heel_height: 'flat', walk_support: 'high' }

// 2026-09-13 owner ruling: an INFERRED ceiling is a preference, a STATED maximum is a constraint.
// This gate runs upstream of the composer roster and of `recoveryEligiblePieces`, so whatever it
// suppresses is unavailable to composition AND to repair — which is why it must carry the same
// distinction as every other consumer rather than inheriting the hard default.
test('wholeWardrobePieceTrustDecision keeps a one-rank-above piece for an INFERRED occasion ceiling', () => {
  const decision = wholeWardrobePieceTrustDecision(dressyPiece, { occasion: 'gallery / art event' })
  assert.equal(decision.allowed, true,
    'an occasion default is what the app expects of the occasion, not what the wearer will not wear')
  assert.ok(!decision.reasons.join(' ').includes('exceeds'),
    'and it is not reported as a register exclusion')
})

test('wholeWardrobePieceTrustDecision excludes the same piece when the wearer STATED a maximum', () => {
  const decision = wholeWardrobePieceTrustDecision(dressyPiece, {
    occasion: 'gallery / art event',
    request: 'nothing dressy please',
  })
  assert.equal(decision.allowed, false)
  assert.match(decision.reasons.join(' '), /exceeds/)
})

test('wholeWardrobePieceTrustDecision keeps TWO ranks above an inferred ceiling too, ranked far down', () => {
  // Final ruling 2026-09-13: no ordinal cutoff without a stated maximum. The one-step bound came
  // from the 2026-07-30 amendment capping the explicit-tag exemption — a ratified preference the
  // record itself marked for revisit — so it ranks rather than gates.
  const decision = wholeWardrobePieceTrustDecision(dressyPiece, { occasion: 'casual' })
  assert.equal(decision.allowed, true)
  const advisory = registerFitPieceAdvisory(dressyPiece, { registerCeiling: 'everyday', occasion: 'casual' })
  assert.equal(advisory.score, -9,
    'two ranks scales past one rank, then stops at the floor that keeps register under weather')
  assert.match(advisory.reason, /2 ranks above/)
})

test('wholeWardrobePieceTrustDecision allows an everyday piece for the same register-capped occasion', () => {
  const decision = wholeWardrobePieceTrustDecision(everydayPiece, { occasion: 'gallery / art event' })
  assert.equal(decision.allowed, true)
})

test('wholeWardrobePieceTrustDecision accepts an already-resolved registerCeiling directly (no re-resolution needed)', () => {
  const decision = wholeWardrobePieceTrustDecision(dressyPiece, { occasion: 'gallery / art event', registerCeiling: 'elevated', registerCeilingExplicit: true })
  assert.equal(decision.allowed, false)
})

test('wholeWardrobePieceTrustDecision excludes a high-heel, low-support shoe for a walking activity (footwear-enum gate, spec 8)', () => {
  const decision = wholeWardrobePieceTrustDecision(highHeelShoe, { occasion: 'city', activity: 'walking' })
  assert.equal(decision.allowed, false)
  assert.match(decision.reasons.join(' '), /heel unsuitable/)
})

test('wholeWardrobePieceTrustDecision allows a flat, high-support shoe for the same walking activity', () => {
  const decision = wholeWardrobePieceTrustDecision(flatShoe, { occasion: 'city', activity: 'walking' })
  assert.equal(decision.allowed, true)
})

test('shared automatic-use pool: inferred ceiling keeps the piece, stated maximum suppresses it', () => {
  // The pool is the upstream boundary for BOTH composition and repair, so the inferred/explicit
  // distinction has to hold here or nothing downstream can recover the piece.
  const inferred = generationPool([dressyPiece, everydayPiece], { occasion: 'gallery / art event' })
  assert.ok(inferred.allowedPieces.some(p => p.id === dressyPiece.id),
    'one rank above an inferred ceiling stays available to composition and repair')
  assert.ok(inferred.allowedPieces.some(p => p.id === everydayPiece.id))

  const stated = generationPool([dressyPiece, everydayPiece], {
    occasion: 'gallery / art event',
    request: 'nothing dressy please',
  })
  assert.ok(!stated.allowedPieces.some(p => p.id === dressyPiece.id), 'a stated maximum suppresses it')
  assert.ok(stated.suppressedPieces.some(p => p.id === dressyPiece.id), 'and records the reason')
  assert.ok(stated.allowedPieces.some(p => p.id === everydayPiece.id))
})

test('shared automatic-use pool excludes the high-heel shoe for a walking activity', () => {
  const { allowedPieces, suppressedPieces } = generationPool([highHeelShoe, flatShoe], {
    occasion: 'city',
    activity: 'walking'
  })
  assert.ok(!allowedPieces.some(p => p.id === highHeelShoe.id), 'high-heel shoe must not appear in allowedPieces for a walking activity')
  assert.ok(allowedPieces.some(p => p.id === flatShoe.id), 'flat shoe should still be allowed')
  assert.ok(suppressedPieces.some(p => p.id === highHeelShoe.id), 'high-heel shoe should be recorded as suppressed with a reason')
})
