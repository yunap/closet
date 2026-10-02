// Stage 1 experiment contract (scratch/ab_stage1_preregistration.json): the checks the harness and the
// blind sheet share, the card body the sheet renders, and the pre-registered per-attempt outcomes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewEligibility, userVisibleCard, renderVisibleCardBody, attemptOutcomes, scoreStage1, providerNetworkEnv, captureIntegrity } from '../scratch/ab_stage1_contract.mjs'

const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
const count = (haystack, needle) => haystack.split(needle).length - 1

test('SHEET: an empty reason still shows styling instructions and watchFor, and flags render once', () => {
  const visible = userVisibleCard({ label: 'Coast walk', strength: 'strong', reason: '', stylingInstructions: 'Tuck the shirt', watchFor: 'Wind at the coast', systemFlags: [{ type: 'Note', message: 'flag shown once' }] }, 0)
  const html = renderVisibleCardBody(visible, '', esc)
  assert.match(html, /Why this outfit/)
  assert.match(html, /How to wear it:<\/strong> Tuck the shirt/)
  assert.match(html, /Watch:<\/strong> Wind at the coast/)
  assert.equal(count(html, 'flag shown once'), 1)
  assert.equal(visible.badge, 'Strong alternative')
})

test('SHEET: no reason, instructions or watchFor means no empty "Why this outfit" block; watchFor "none" is hidden', () => {
  const html = renderVisibleCardBody(userVisibleCard({ label: 'Plain', reason: '', stylingInstructions: '', watchFor: 'none' }, 0), '', esc)
  assert.doesNotMatch(html, /Why this outfit/)
})

test('SHEET: a Needs-review card stays visible with the product treatment, and its hidden fields stay hidden', () => {
  const visible = userVisibleCard({ label: 'Attempt', broken: true, retryPending: true, rejectionReason: 'no outer layer', reason: 'Layered look. Rejected because raw text', stylingInstructions: 'tuck', watchFor: 'wind', systemFlags: [{ type: 'Note', message: 'debug flag' }] }, 2)
  const html = renderVisibleCardBody(visible, '', esc)
  assert.equal(visible.needsReview, true)
  assert.match(html, /needs review/)
  assert.match(html, /What didn't clear:<\/strong> no outer layer/)
  assert.match(html, /Layered look\./)
  assert.doesNotMatch(html, /Rejected because|How to wear it|debug flag/)
})

test('CONDITIONS: identical temperatures and location are required, and misrouting excludes the pair', () => {
  const one = { technicalOk: true, routing: { routerProfile: 'single_outfit', executedProfile: 'single_outfit' }, resolvedWeather: { highF: 65, lowF: 50, location: 'Walnut Creek, CA' } }
  const bundle = { technicalOk: true, resolvedWeather: { highF: 65, lowF: 50, location: 'Walnut Creek, CA' } }
  assert.equal(reviewEligibility(one, bundle).eligible, true)
  assert.deepEqual(reviewEligibility(one, { ...bundle, resolvedWeather: { ...bundle.resolvedWeather, lowF: 48 } }).reasons, ['lowF differs (one 50, bundle 48)'])
  assert.equal(reviewEligibility({ ...one, resolvedWeather: { ...one.resolvedWeather, location: 'Oakland, CA' } }, bundle).eligible, false)
  assert.equal(reviewEligibility({ ...one, routing: { routerProfile: 'full_stylist', executedProfile: 'full_stylist' } }, bundle).eligible, false)
  // Zero cards is an outcome, not an exclusion: the pair stays on the sheet.
  assert.equal(reviewEligibility({ ...one, response: { cards: [] } }, bundle).eligible, true)
})

const rated = (position, weatherAdequacy, styleIntent, wouldWear) => ({ position, weatherAdequacy, styleIntent, wouldWear, notes: '' })
const key = {
  scenario: 'S1', seed: 'abcd1234', preregistrationSha256: 'hash',
  includedReplicates: [{ replicate: 1 }, { replicate: 2 }], excludedReplicates: [],
  cards: [
    { position: 1, arm: 'one', replicate: 1, needsReview: false },
    { position: 2, arm: 'bundle', replicate: 1, needsReview: false },
    { position: 3, arm: 'bundle', replicate: 1, needsReview: true },
    { position: 4, arm: 'bundle', replicate: 2, needsReview: false },
  ],
}
const ratings = { seed: 'abcd1234', preregistrationSha256: 'hash', strongestPosition: 2, wouldWearStrongest: 'yes',
  cards: [rated(1, 4, 3, 'yes'), rated(2, 5, 2, 'no'), rated(3, 1, 4, 'yes'), rated(4, 3, 3, 'yes')] }

test('OUTCOMES: each rating item is scored separately per arm and replicate, Needs-review cards included', () => {
  const result = scoreStage1(ratings, key)
  const bundle1 = result.attempts.find(a => a.arm === 'bundle' && a.replicate === 1)
  assert.deepEqual({ ...bundle1 }, { scenario: 'S1', replicate: 1, arm: 'bundle', visibleCards: 2, readyCards: 1, needsReviewCards: 1, computable: true,
    meanWeather: 3, meanStyle: 3, wouldWearProportion: 0.5, bestWeather: 5, bestStyle: 4 })
  const r1 = result.comparisons.find(c => c.replicate === 1)
  assert.deepEqual(r1.primary, { meanWeather: 1, meanStyle: 0, wouldWearProportion: 0.5 })
  assert.deepEqual(r1.secondary, { bestWeather: -1, bestStyle: -1 })
  assert.equal(result.descriptiveStrongestPick.usedInComparisons, false)
})

test('OUTCOMES: a zero-card attempt is not computable and is never imputed; the other arm is still scored', () => {
  const result = scoreStage1(ratings, key)
  const one2 = result.attempts.find(a => a.arm === 'one' && a.replicate === 2)
  assert.equal(one2.computable, false)
  assert.equal(one2.meanWeather, null)
  const r2 = result.comparisons.find(c => c.replicate === 2)
  assert.deepEqual(r2.notComputable, ['one-outfit attempt produced no displayable card'])
  assert.deepEqual(r2.primary, { meanWeather: null, meanStyle: null, wouldWearProportion: null })
  assert.equal(result.attempts.find(a => a.arm === 'bundle' && a.replicate === 2).meanWeather, 3)
  assert.equal(attemptOutcomes([]).reason, 'zero displayable cards')
})

test('OUTCOMES: scoring refuses unrated cards and a mismatched sheet', () => {
  assert.throws(() => scoreStage1({ ...ratings, cards: ratings.cards.slice(1) }, key), /unrated positions: 1/)
  assert.throws(() => scoreStage1({ ...ratings, cards: [rated(1, 4, 3, ''), ...ratings.cards.slice(1)] }, key), /unrated positions: 1/)
  assert.throws(() => scoreStage1({ ...ratings, seed: 'other' }, key), /does not match sealed key/)
})

test('PROVIDER NETWORK: granted only to an approved live run; absent in preflight and in the ordinary suite', () => {
  // npm test: this very process runs without the permission.
  assert.equal(process.env.WARDROBE_ALLOW_TEST_PROVIDER_NETWORK, undefined)
  const inherited = { NODE_ENV: 'test', WARDROBE_ALLOW_TEST_PROVIDER_NETWORK: 'true' }
  // Preflight: removed even when the parent environment carries it.
  assert.equal('WARDROBE_ALLOW_TEST_PROVIDER_NETWORK' in providerNetworkEnv(inherited, { mode: 'preflight', approved: false }), false)
  assert.equal('WARDROBE_ALLOW_TEST_PROVIDER_NETWORK' in providerNetworkEnv(inherited, { mode: 'preflight', approved: true }), false)
  // Live without approval: refused outright.
  assert.throws(() => providerNetworkEnv({}, { mode: 'live', approved: false }), /--approved/)
  // Approved live run: granted.
  assert.equal(providerNetworkEnv({}, { mode: 'live', approved: true }).WARDROBE_ALLOW_TEST_PROVIDER_NETWORK, 'true')
})

test('CAPTURE INTEGRITY: a technically successful live attempt with an incomplete capture is a reported failure', () => {
  const complete = { technicalOk: true, arm: 'one', capture: { calls: 4, callsComplete: 4, toolLoopTurns: 3, toolLoopTurnsComplete: 3, recordsWithoutCallId: 0 } }
  assert.deepEqual(captureIntegrity(complete, 'live'), { assessed: true, ok: true, reasons: [] })
  const missingWire = { ...complete, capture: { ...complete.capture, callsComplete: 3 } }
  assert.deepEqual(captureIntegrity(missingWire, 'live').reasons, ['1 of 4 calls lack a normalized, wire or output record'])
  assert.equal(captureIntegrity({ technicalOk: true, arm: 'bundle', capture: { calls: 0 } }, 'live').ok, false)
  assert.equal(captureIntegrity({ ...complete, capture: { ...complete.capture, recordsWithoutCallId: 2 } }, 'live').ok, false)
  assert.equal(captureIntegrity({ ...complete, technicalOk: false }, 'live').assessed, false)
  assert.equal(captureIntegrity(complete, 'preflight').assessed, false)
})

