import test from 'node:test'
import assert from 'node:assert/strict'
import { wholeWardrobePieceTrustDecision, filterWholeWardrobePiecesForGeneration } from '../styling-engine/rules.js'

// Spec 5: register-ceiling gate for the trip-precompose path. Confirmed live bug — a "dressy"-formality
// piece surfaced in a "gallery / art event" outfit (register_ceiling: "elevated"), because
// wholeWardrobePieceTrustDecision (used by buildLocalTripSlotOutfits via filterWholeWardrobePiecesForGeneration)
// never computed or passed registerCeiling into profileRuleFit. Fix is opt-in (options.applyRegisterCeiling /
// options.registerCeiling) — mirrors spec 1's mode-switch so the other two production callers
// (search_wardrobe's pre-filter, rankedComplementaryWardrobeFor) are unaffected unless they opt in too.

const dressyPiece = { id: 501, category: 'top', formality: 'dressy' }
const everydayPiece = { id: 502, category: 'top', formality: 'everyday' }

test('wholeWardrobePieceTrustDecision excludes a dressy piece for a register-capped occasion when applyRegisterCeiling is set', () => {
  const decision = wholeWardrobePieceTrustDecision(dressyPiece, { occasion: 'gallery / art event', applyRegisterCeiling: true })
  assert.equal(decision.allowed, false)
  assert.match(decision.reasons.join(' '), /dressy exceeds elevated ceiling/)
})

test('wholeWardrobePieceTrustDecision leaves the SAME piece/occasion unchanged without applyRegisterCeiling (mode-switch, no regression)', () => {
  const decision = wholeWardrobePieceTrustDecision(dressyPiece, { occasion: 'gallery / art event' })
  assert.equal(decision.allowed, true)
})

test('wholeWardrobePieceTrustDecision allows an everyday piece for the same register-capped occasion', () => {
  const decision = wholeWardrobePieceTrustDecision(everydayPiece, { occasion: 'gallery / art event', applyRegisterCeiling: true })
  assert.equal(decision.allowed, true)
})

test('wholeWardrobePieceTrustDecision accepts an already-resolved registerCeiling directly (no re-resolution needed)', () => {
  const decision = wholeWardrobePieceTrustDecision(dressyPiece, { occasion: 'gallery / art event', registerCeiling: 'elevated' })
  assert.equal(decision.allowed, false)
})

test('filterWholeWardrobePiecesForGeneration excludes the dressy piece from allowedPieces when applyRegisterCeiling is set', () => {
  const { allowedPieces, suppressedPieces } = filterWholeWardrobePiecesForGeneration([dressyPiece, everydayPiece], {
    occasion: 'gallery / art event',
    applyRegisterCeiling: true
  })
  assert.ok(!allowedPieces.some(p => p.id === dressyPiece.id), 'dressy piece must not appear in allowedPieces')
  assert.ok(allowedPieces.some(p => p.id === everydayPiece.id), 'everyday piece should still be allowed')
  assert.ok(suppressedPieces.some(p => p.id === dressyPiece.id), 'dressy piece should be recorded as suppressed with a reason')
})

test('filterWholeWardrobePiecesForGeneration keeps both pieces when applyRegisterCeiling is NOT set (existing behavior unchanged)', () => {
  const { allowedPieces } = filterWholeWardrobePiecesForGeneration([dressyPiece, everydayPiece], {
    occasion: 'gallery / art event'
  })
  assert.ok(allowedPieces.some(p => p.id === dressyPiece.id), 'without opt-in, existing callers see unchanged behavior')
})
