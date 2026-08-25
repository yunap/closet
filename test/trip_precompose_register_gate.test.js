import test from 'node:test'
import assert from 'node:assert/strict'
import { wholeWardrobePieceTrustDecision } from '../styling-engine/rules.js'
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

test('wholeWardrobePieceTrustDecision excludes a dressy piece for a register-capped occasion with no opt-in needed', () => {
  const decision = wholeWardrobePieceTrustDecision(dressyPiece, { occasion: 'gallery / art event' })
  assert.equal(decision.allowed, false)
  assert.match(decision.reasons.join(' '), /dressy exceeds elevated ceiling/)
})

test('wholeWardrobePieceTrustDecision allows an everyday piece for the same register-capped occasion', () => {
  const decision = wholeWardrobePieceTrustDecision(everydayPiece, { occasion: 'gallery / art event' })
  assert.equal(decision.allowed, true)
})

test('wholeWardrobePieceTrustDecision accepts an already-resolved registerCeiling directly (no re-resolution needed)', () => {
  const decision = wholeWardrobePieceTrustDecision(dressyPiece, { occasion: 'gallery / art event', registerCeiling: 'elevated' })
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

test('shared automatic-use pool excludes the dressy piece with no opt-in needed', () => {
  const { allowedPieces, suppressedPieces } = generationPool([dressyPiece, everydayPiece], {
    occasion: 'gallery / art event'
  })
  assert.ok(!allowedPieces.some(p => p.id === dressyPiece.id), 'dressy piece must not appear in allowedPieces')
  assert.ok(allowedPieces.some(p => p.id === everydayPiece.id), 'everyday piece should still be allowed')
  assert.ok(suppressedPieces.some(p => p.id === dressyPiece.id), 'dressy piece should be recorded as suppressed with a reason')
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
