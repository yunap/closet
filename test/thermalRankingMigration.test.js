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
  const w = W(65, 47)
  assert.ok(score(G.cardigan, w) > score(G.puffer, w), 'cardigan must out-rank the puffer')

  // With the slot's exposure known, the separation sharpens and the light jacket leads.
  const museum = resolveExposureContext({ activity: 'walking', environment: 'outdoor' }, w)
  assert.ok(score(G.lightJacket, w, museum) > score(G.cardigan, w, museum))
  assert.ok(score(G.cardigan, w, museum) > score(G.puffer, w, museum))
})

test('genuinely cold 30/20 — the ordering reverses', () => {
  const w = W(30, 20)
  assert.ok(score(G.puffer, w) > score(G.cardigan, w))
  assert.ok(score(G.cardigan, w) > score(G.lightJacket, w))
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

  // Ranking reads `distance`, not merely `fit` — otherwise every garment inside the uncertainty
  // band scores identically and the band becomes an equivalence class (§16.2).
  assert.ok(live.includes('fit.distance'), 'ranking must read distance')
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
