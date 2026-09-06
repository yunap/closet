// PR B acceptance — docs/thermal-comfort-band-spec.md §8 step 2 (ranking / model evidence).
//
// The migration's claim: thermal ranking runs from structured weather and requiredThermalBand, and
// NO `isCold` switch decides whether graded reasoning happens at all (§6's defect).
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
const { weatherFitForPiece } = await import('../styling-engine/rules.js')
const { validateUserWeather, resolveWeatherContext } = await import('../styling-engine/weather.js')
const { resolveExposureContext } = await import('../styling-engine/exposure.js')

const W = (high_f, low_f) => ({ ...resolveWeatherContext({ userWeather: validateUserWeather({ high_f, low_f }) }).temperature })
const G = {
  puffer: { category: 'outerwear', fabric_weight: 'heavy', insulating_layer_materials: ['down'], sleeve_length: 'long' },
  cardigan: { category: 'outerwear', fabric_weight: 'medium', fabric_category: 'knit', fiber_content: ['wool'], sleeve_length: 'long' },
  lightJacket: { category: 'outerwear', fabric_weight: 'medium', fiber_content: ['cotton'], insulating_layer_materials: [], sleeve_length: 'long' },
}
const score = (piece, weather, exposure) => weatherFitForPiece(piece, weather, exposure ? { exposure } : {}).score

test('Vienna 65/47 — a cardigan ranks ahead of the puffer', () => {
  // The failure this whole arc came from. `isCold` is FALSE at 65/47, so before the migration the
  // ranker said nothing about warmth and the puffer ranked like anything else.
  //
  // Regressed by docs/source-sensitive-insulating-credit-spec.md's fiber-credit fix: the cardigan
  // dropped from `warm` (an exact match to the `warm` demand, distance 0) to `moderate` — the SAME
  // bucket-index distance from `warm` (1 step) that the `very warm` puffer already sat on the other
  // side of, so both scored identically under the old symmetric distance formula. This is the equal-
  // bucket-distance, OPPOSITE-DIRECTION case docs/thermal-ranking-source-sensitivity-and-overshoot-
  // policy-spec.md's ranking primitive exists to break: at equal raw distance from the demand's
  // target, undershoot (cardigan, too light) must outrank overshoot (puffer, too warm) — every live
  // incident this arc has resolved was the reverse case wrongly winning, never the other way round.
  const w = W(65, 47)
  assert.ok(score(G.cardigan, w) > score(G.puffer, w), 'cardigan must out-rank the puffer')

  // With the slot's exposure known, cardigan and lightJacket both land in the demand's own target
  // bucket (both "adequate", zero bucket-index distance) -- the SAME-BUCKET case: lightJacket's raw
  // score sits closer to the target level's own center than cardigan's, so the light jacket still
  // leads even though compareThermalFit alone cannot tell the two apart.
  const museum = resolveExposureContext({ activity: 'walking', environment: 'outdoor' }, w)
  assert.ok(score(G.lightJacket, w, museum) > score(G.cardigan, w, museum))
  assert.ok(score(G.cardigan, w, museum) > score(G.puffer, w, museum))
})

test('genuinely cold 30/20 — the ordering reverses', () => {
  // SAME-BUCKET refinement, undershoot direction: cardigan and lightJacket are both `moderate`
  // (compareThermalFit alone ties them), but the cardigan's higher raw score sits closer to the
  // `very warm` demand than the plain cotton jacket's, so it ranks above it despite the identical
  // named bucket -- the exact invariant the source-sensitive insulating credit census established.
  const w = W(30, 20)
  assert.ok(score(G.puffer, w) > score(G.cardigan, w))
  assert.ok(score(G.cardigan, w) > score(G.lightJacket, w))
})

test('excessive undershoot floors at the same magnitude as excessive overshoot, never inverts', () => {
  // Neither direction should escape the -8 floor, and the floor must not silently favor one
  // direction over the other merely because it clamped first.
  const veryLightPiece = { category: 'outerwear', fabric_weight: 'ultralight', fiber_content: ['polyester'], insulating_layer_materials: [], sleeve_length: 'sleeveless' }
  const genuinelyCold = W(20, 5)
  const undershootFit = weatherFitForPiece(veryLightPiece, genuinelyCold)
  assert.equal(undershootFit.score, -8, 'a very light piece in genuinely cold conditions floors, not just scores low')
  assert.match(undershootFit.adjustments[0].reason, /garment very light/)

  const genuinelyHot = W(95, 85)
  const overshootFit = weatherFitForPiece(G.puffer, genuinelyHot)
  const thermalBandAdjustment = overshootFit.adjustments.find(a => a.reason.startsWith('thermal band'))
  assert.equal(thermalBandAdjustment.score, -8, 'a down puffer in genuinely hot conditions floors the same way')
})

test('at equal raw distance from the target, overshoot scores strictly worse than undershoot — the ranking-policy asymmetry, isolated', () => {
  // Two synthetic pieces placed to sit at an equal RAW distance either side of a `moderate` demand's
  // own center (1.5), isolated from every other adjustment this scoring path can add (no isHot/isCold
  // flags, no fabric-mass bonus) — this is the OVERSHOOT_RANKING_WEIGHT itself, not a side effect of
  // some other rule.
  const under = { category: 'outerwear', fabric_weight: 'light', fiber_content: ['cotton'], insulating_layer_materials: [], sleeve_length: 'long' } // raw 0.5, center 1.5 -> distance -1
  const over = { category: 'outerwear', fabric_weight: 'heavy', fiber_content: ['cotton'], insulating_layer_materials: [], sleeve_length: 'long' } // raw 2.5, center 1.5 -> distance +1
  const w = W(60, 56) // resolves to a `moderate` demand at this exposure-less call
  const underScore = score(under, w)
  const overScore = score(over, w)
  assert.ok(underScore > overScore, 'equal raw distance, opposite direction: undershoot must still rank above overshoot')
})

test('the puffer is never excluded for overshoot — it ranks low and stays available', () => {
  // §5.5: a wardrobe whose only layer is a heavy coat still gets dressed.
  const w = W(75, 62)
  const fit = weatherFitForPiece(G.puffer, w)
  assert.ok(Number.isFinite(fit.score), 'it still receives a score')
  assert.ok(fit.adjustments.length > 0, 'and a stated reason, rather than being dropped')
})

test('unknown stays unknown — no thermal opinion, not a good or bad one', () => {
  // A garment the placement cannot position, and a profile with no temperature, both yield silence.
  const unplaceable = { category: 'outerwear', fabric_weight: 'medium', fiber_content: ['unknown'] }
  assert.equal(weatherFitForPiece(unplaceable, W(40, 30)).score, 0)
  assert.equal(weatherFitForPiece(G.puffer, { isCold: true }).score, 0,
    'a flag-only profile carries no thermal authority')
})

test('no isCold switch decides whether graded thermal ranking runs', () => {
  // The §6 defect, asserted at source. Both migrated sites used to gate on the flag:
  //   weatherFitForPiece      `else if (weatherProfile?.isCold && cold !== 0)`
  //   piecePriorityForMission `if (weatherProfile && (isHot || isCold))`
  const src = fs.readFileSync(path.join(process.cwd(), 'styling-engine/rules.js'), 'utf8')
  const fn = src.slice(src.indexOf('export function weatherFitForPiece'))
    .slice(0, src.slice(src.indexOf('export function weatherFitForPiece')).indexOf('\n}\n'))
  const live = fn.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.ok(!live.includes('isCold'), 'weatherFitForPiece must not read isCold')
  assert.ok(live.includes('requiredThermalBand'), 'it reads the band')

  // Ranking reads `offset` (thermalRankingFit's continuous, overshoot-weighted refinement over
  // compareThermalFit's own `distance`), not merely `fit` — otherwise every garment inside the
  // uncertainty band scores identically and the band becomes an equivalence class (§16.2). Renamed
  // from `fit.distance` when thermalRankingFit was introduced
  // (docs/thermal-ranking-source-sensitivity-and-overshoot-policy-spec.md) to consolidate this
  // file's ranking formula with buildVisualComposerRoster's previously-independent one and to let
  // two garments in the same named bucket still rank apart by raw score.
  assert.ok(live.includes('fit.offset'), 'ranking must read the thermalRankingFit offset')
})

test('the light-bottom carve-out survives the reason-string rename', () => {
  // A latent defect the migration introduced and this pins: scoreWholeWardrobeCandidate filtered on
  // the literal reason 'cold weather: lightweight fabric', which the band renamed — so the filter
  // had silently stopped matching. It is now expressed against the band's own undershoot signal.
  const src = fs.readFileSync(path.join(process.cwd(), 'styling-engine/rules.js'), 'utf8')
  assert.ok(!src.includes("adjustment.reason === 'cold weather: lightweight fabric'"),
    'the dead reason-string filter must not survive')
  assert.ok(src.includes("String(adjustment.label || '').startsWith('lighter than')"),
    'the carve-out keys on the undershoot signal instead')
})
