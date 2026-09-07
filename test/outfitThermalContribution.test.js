// Slice 4 of docs/thermal-comfort-band-spec.md §9.2 — the six-point gate.
// No production consumers (§8 step 1).
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { outfitThermalContribution, outfitCoversRange } from '../styling-engine/outfitThermalContribution.js'
import { requiredThermalBand, compareThermalFit } from '../styling-engine/thermalDemand.js'
import { resolveExposureContext } from '../styling-engine/exposure.js'
import { WARMTH_LEVELS } from '../styling-engine/garmentWarmth.js'

const W = { temperature: { highF: 65, lowF: 45, source: 'model_estimate' }, wind: { value: 'calm' } }
const COLD = requiredThermalBand(resolveExposureContext({ activity: 'walking', environment: 'outdoor' }, W))
const WARM = { ...COLD, level: 'light', range: ['very light', 'moderate'] }
const cover = o => outfitCoversRange(outfitThermalContribution(o), COLD, WARM, compareThermalFit)

const P = {
  mildTop: { category: 'top', fabric_weight: 'light', fiber_content: ['cotton'], sleeve_length: 'long' },
  heavyTop: { category: 'top', fabric_weight: 'heavy', fiber_content: ['wool'], sleeve_length: 'long' },
  cardigan: { category: 'outerwear', fabric_weight: 'medium', fabric_category: 'knit', fiber_content: ['wool'], sleeve_length: 'long' },
  puffer: { category: 'outerwear', fabric_weight: 'heavy', insulating_layer_materials: ['down'], sleeve_length: 'long' },
  unplaceableTop: { category: 'top', fabric_weight: 'medium', fiber_content: ['unknown'] },
  shoes: { category: 'shoes', fabric_category: 'leather' },
}

test('gate 1 — row 2: a mild base plus a removable layer beats a permanently warm base', () => {
  // Not a bigger total — a RANGE the outfit can cover. The layered outfit answers the cold end with
  // the layer on and the warm end with it off; the permanently heavy one is stranded overshooting.
  assert.equal(cover([P.mildTop, P.cardigan]).adaptable, true)
  assert.equal(cover([P.heavyTop, P.puffer]).adaptable, false)

  // And the heavier outfit is NOT declared invalid — it simply loses on adaptability.
  const heavy = cover([P.heavyTop, P.puffer])
  assert.notEqual(heavy.coldEnd.fit, 'undershoot')
  assert.ok(String(heavy.warmEnd.fit).includes('overshoot'), 'it is stuck at the warm end, not banned')
})

test('gate 2 — base and removable warmth stay distinguishable', () => {
  const c = outfitThermalContribution([P.mildTop, P.cardigan])
  assert.equal(c.base, 'light')
  // Was `warm` before docs/source-sensitive-insulating-credit-spec.md's fiber-credit fix (a wool
  // knit cardigan with no recorded fill no longer earns the same +2 a genuinely filled coat gets).
  assert.equal(c.removable, 'moderate')
  assert.equal(c.hasRemovableLayer, true)
  assert.equal(outfitThermalContribution([P.heavyTop]).hasRemovableLayer, false)
})

test('gate 3 — ordinal levels are never numerically summed', () => {
  // `warm(3) + moderate(2) = 5` has no physical meaning. Summing indexes would be the ensemble
  // version of canonizing the old `cold` score.
  const c = outfitThermalContribution([P.mildTop, P.cardigan])
  assert.ok(WARMTH_LEVELS.includes(c.withLayer), 'the result is a LEVEL, not a number')

  // The combination is bounded by one ordinal step above the warmer component, never a sum.
  const idx = l => WARMTH_LEVELS.indexOf(l)
  assert.ok(idx(c.withLayer) <= idx('warm') + 1)

  // Two `warm` garments cannot produce anything beyond one step — and the ceiling holds (§15.5).
  const both = outfitThermalContribution([P.heavyTop, P.puffer])
  assert.equal(both.withLayer, 'very warm', 'the ceiling is bounded, with no tier above it')

  // The step turns on the WEAKER component: a light base under a cardigan must not reach the top.
  assert.notEqual(outfitThermalContribution([P.mildTop, P.cardigan]).withLayer, 'very warm')
})

test('gate 4 — unknown contribution is preserved, never coerced to zero', () => {
  // "known cardigan + unknown top" is not "known cardigan + very-light top".
  const c = outfitThermalContribution([P.unplaceableTop, P.cardigan])
  assert.equal(c.base, null, 'an unplaceable base is null, not a level')
  assert.equal(c.unknown.base, true)
  assert.ok(c.unknown.pieces.length >= 1)
  assert.equal(cover([P.unplaceableTop, P.cardigan]).unknownPresent, true)

  // Shoes are out of thermal scope — a different question, not an unknown.
  const withShoes = outfitThermalContribution([P.mildTop, P.cardigan, P.shoes])
  assert.equal(withShoes.unknown.base, false)
  assert.equal(withShoes.base, 'light')
})

test('gate 5 — the puffer stays usable when it is the only layer', () => {
  // §5.5: overshoot ranks, it never excludes. A wardrobe whose only layer is a heavy coat still
  // gets dressed.
  const r = cover([P.mildTop, P.puffer])
  assert.notEqual(r.coldEnd.fit, 'undershoot')
  assert.equal(outfitThermalContribution([P.mildTop, P.puffer]).removable, 'very warm')
})

test('gate 6 — no non-thermal semantics are absorbed into the thermal total', () => {
  // Rain, footwear, removability-as-policy and outdoor capability are independent contracts
  // (§2.1, and §7 of the exposure spec). ISO 9920 excludes rain from ensemble insulation too.
  const src = fs.readFileSync(path.join(process.cwd(), 'styling-engine/outfitThermalContribution.js'), 'utf8')
  const live = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
  for (const banned of ['weather_protection', 'rain', 'waterproof', 'shoe_type', 'walk_support',
                        'outerwear_role', 'isCold', 'needsRemovableCoolLayer', 'pieceWeatherScores']) {
    assert.ok(!live.includes(banned), `thermal contribution must not absorb ${banned}`)
  }
})
