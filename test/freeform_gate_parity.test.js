import test from 'node:test'
import assert from 'node:assert/strict'
import {
  profileRuleFit,
  getMergedProfileRules,
  footwearComfortVerdict,
  registerCeilingVerdict
} from '../styling-engine/rules.js'
import { resolveActivityProfile } from '../styling-engine/footwear-comfort.js'
import { formalityRank } from '../styling-engine/attributes.js'

// Spec 1 (freeform gate parity): profileRuleFit gains an enum footwear gate and a register-ceiling
// gate, active only in "enum mode" — i.e. when the caller passes activityProfile / registerCeiling
// (search_wardrobe does). Composer-path callers pass neither and must be unchanged.

const hiking = () => resolveActivityProfile({ activity: 'hiking' }) // excluded_heel_heights: low/mid/high, excluded_walk_support: low/medium, register_ceiling: everyday

test('footwear: a high-heel shoe is prohibited for a walking activity (enum mode)', () => {
  const activityProfile = hiking()
  const mergedRules = getMergedProfileRules(null, activityProfile)
  const shoe = { id: 9001, category: 'shoes', heel_height: 'high', walk_support: 'low', formality: 'everyday' }
  const fit = profileRuleFit(shoe, mergedRules, { activityProfile })
  assert.equal(fit.tier, 'prohibited')
  assert.match(fit.label, /high heel unsuitable/)
})

test('footwear: untagged heel/support is surfaced as unknown under an active gate (not silently passed)', () => {
  const activityProfile = hiking()
  const shoe = { id: 9002, category: 'shoes', formality: 'everyday' } // no heel_height / walk_support
  const fit = profileRuleFit(shoe, {}, { activityProfile })
  assert.equal(fit.tier, 'unknown')
  assert.equal(fit.label, 'footwear comfort not tagged')
})

test('register: a piece above the everyday ceiling is prohibited', () => {
  const dressyTop = { id: 9003, category: 'top', formality: 'dressy' }
  const fit = profileRuleFit(dressyTop, {}, { registerCeiling: 'everyday' })
  assert.equal(fit.tier, 'prohibited')
  assert.match(fit.label, /dressy exceeds everyday ceiling/)
})

test('register: untagged formality is surfaced as unknown under an active ceiling', () => {
  const top = { id: 9004, category: 'top' } // no formality
  const fit = profileRuleFit(top, {}, { registerCeiling: 'everyday' })
  assert.equal(fit.tier, 'unknown')
  assert.equal(fit.label, 'formality not tagged')
})

test('register: a piece at or below the ceiling passes', () => {
  const everydayTop = { id: 9005, category: 'top', formality: 'everyday' }
  const fit = profileRuleFit(everydayTop, {}, { registerCeiling: 'everyday' })
  assert.equal(fit.tier, 'neutral')
})

test('precedence: a hard exclusion outranks an unknown from the other gate', () => {
  const activityProfile = hiking()
  // Footwear untagged (would be unknown) but formality exceeds the ceiling (exclude) → prohibited wins.
  const shoe = { id: 9006, category: 'shoes', formality: 'dressy' }
  const fit = profileRuleFit(shoe, {}, { activityProfile, registerCeiling: 'everyday' })
  assert.equal(fit.tier, 'prohibited')
})

test('mode-switch: composer-path callers (no activity/register context) are not enum-gated', () => {
  // The same high-heel + dressy piece that is prohibited in enum mode stays neutral when no
  // activityProfile/registerCeiling is passed — guaranteeing rules.js:1836 / rules.js:4077 are unchanged.
  const heelDressy = { id: 9007, category: 'shoes', heel_height: 'high', walk_support: 'low', formality: 'dressy' }
  const fit = profileRuleFit(heelDressy, {}, {})
  assert.equal(fit.tier, 'neutral')
})

// The shared verdict helpers are the single implementation the composer wrappers and profileRuleFit
// both call (one implementation, two consumers).
test('footwearComfortVerdict: pass / exclude / unknown', () => {
  assert.deepEqual(footwearComfortVerdict({ category: 'top' }, ['high'], ['low']), { verdict: 'pass' }) // not a shoe
  assert.deepEqual(footwearComfortVerdict({ category: 'shoes' }, [], []), { verdict: 'pass' }) // no exclusions active
  assert.deepEqual(footwearComfortVerdict({ category: 'shoes' }, ['high'], ['low']), { verdict: 'unknown' }) // untagged
  assert.deepEqual(footwearComfortVerdict({ category: 'shoes', heel_height: 'high' }, ['high'], []), { verdict: 'exclude', dimension: 'heel', value: 'high' })
  assert.deepEqual(footwearComfortVerdict({ category: 'shoes', walk_support: 'low' }, [], ['low']), { verdict: 'exclude', dimension: 'support', value: 'low' })
})

test('registerCeilingVerdict: pass / exclude / unknown / accessory-exempt', () => {
  const everyday = formalityRank('everyday')
  assert.deepEqual(registerCeilingVerdict({ category: 'top', formality: 'everyday' }, everyday), { verdict: 'pass' })
  assert.deepEqual(registerCeilingVerdict({ category: 'top', formality: 'dressy' }, everyday), { verdict: 'exclude', formality: 'dressy' })
  assert.deepEqual(registerCeilingVerdict({ category: 'top' }, everyday), { verdict: 'unknown' })
  assert.deepEqual(registerCeilingVerdict({ category: 'top', formality: 'dressy' }, null), { verdict: 'pass' }) // no ceiling
  assert.deepEqual(registerCeilingVerdict({ category: 'accessory', formality: 'dressy' }, everyday), { verdict: 'pass' }) // accessories exempt
})

// Owner ruling 2026-07-30 (live thread_1785380251549): the beige tailored linen
// shorts are tagged `occasions: casual` and were still refused from a casual
// slot by the profile's `everyday` ceiling. An explicit tag is a statement about
// that garment; a profile ceiling is a default for pieces nobody judged.
test('register: an explicit occasion tag exempts a piece from that occasion ceiling', () => {
  const elevatedTaggedCasual = { id: 9010, category: 'bottom', formality: 'elevated', occasions: ['casual', 'smart-casual'] }
  const everyday = formalityRank('everyday')

  assert.equal(registerCeilingVerdict(elevatedTaggedCasual, everyday).verdict, 'exclude')
  const exempt = registerCeilingVerdict(elevatedTaggedCasual, everyday, { occasion: 'casual' })
  assert.equal(exempt.verdict, 'pass')
  assert.equal(exempt.exemptedByExplicitTag, true)

  // …and it reaches the gate the composer actually consults.
  const fit = profileRuleFit(elevatedTaggedCasual, {}, {
    registerCeiling: 'everyday',
    occasionProfile: { id: 'casual', register_ceiling: 'everyday' },
  })
  assert.notEqual(fit.tier, 'prohibited')
})

// One step only — the exemption is a correction, not a hole.
test('register: the explicit-tag exemption does not stretch two registers', () => {
  const dressyTaggedCasual = { id: 9011, category: 'top', formality: 'dressy', occasions: ['casual'] }
  const verdict = registerCeilingVerdict(dressyTaggedCasual, formalityRank('everyday'), { occasion: 'casual' })
  assert.equal(verdict.verdict, 'exclude')
  assert.equal(verdict.formality, 'dressy')
})

// A piece not tagged for the requested occasion gets no exemption.
test('register: an untagged elevated piece is still blocked by the ceiling', () => {
  const elevatedUntagged = { id: 9012, category: 'top', formality: 'elevated', occasions: ['evening'] }
  const verdict = registerCeilingVerdict(elevatedUntagged, formalityRank('everyday'), { occasion: 'casual' })
  assert.equal(verdict.verdict, 'exclude')
})
