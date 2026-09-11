import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PET_BANDS,
  PET_BAND_ORDER,
  classifyPetTemperature,
  classifyPetRange,
  petBandToThermalDemand,
  COLD_THRESHOLD_F,
  SEVERE_COLD_THRESHOLD_F,
  COOL_LAYER_THRESHOLD_F,
  WARM_THRESHOLD_F,
  HOT_THRESHOLD_F,
} from '../styling-engine/biometeorology.js'

test('PET_BANDS covers all 7 thermal stress bands with contiguous boundaries', () => {
  assert.strictEqual(PET_BAND_ORDER.length, 7)
  for (let i = 0; i < PET_BAND_ORDER.length - 1; i++) {
    const current = PET_BAND_ORDER[i]
    const next = PET_BAND_ORDER[i + 1]
    assert.strictEqual(current.maxF, next.minF, `Discontinuity between ${current.key} and ${next.key}`)
    assert.strictEqual(current.maxC, next.minC, `Celsius discontinuity between ${current.key} and ${next.key}`)
  }
})

test('classifyPetTemperature maps representative temperatures to accurate bands', () => {
  assert.strictEqual(classifyPetTemperature(28)?.key, 'very_cold')
  assert.strictEqual(classifyPetTemperature(38)?.key, 'very_cold')
  assert.strictEqual(classifyPetTemperature(39)?.key, 'cold')
  assert.strictEqual(classifyPetTemperature(45)?.key, 'cold')
  assert.strictEqual(classifyPetTemperature(46)?.key, 'cool')
  assert.strictEqual(classifyPetTemperature(54)?.key, 'cool')
  assert.strictEqual(classifyPetTemperature(55)?.key, 'slightly_cool')
  assert.strictEqual(classifyPetTemperature(56)?.key, 'slightly_cool')
  assert.strictEqual(classifyPetTemperature(63)?.key, 'slightly_cool')
  assert.strictEqual(classifyPetTemperature(64)?.key, 'comfortable')
  assert.strictEqual(classifyPetTemperature(72)?.key, 'comfortable')
  assert.strictEqual(classifyPetTemperature(73)?.key, 'slightly_warm')
  assert.strictEqual(classifyPetTemperature(83)?.key, 'slightly_warm')
  assert.strictEqual(classifyPetTemperature(84)?.key, 'hot')
  assert.strictEqual(classifyPetTemperature(95)?.key, 'hot')
})

test('classifyPetRange evaluates mutual exclusivity and band flags', () => {
  // 56°F single reading: Slightly Cool band, demands cool layer, not hot, not cold
  const sc56 = classifyPetRange({ highF: 56, lowF: 56 })
  assert.strictEqual(sc56.isHot, false)
  assert.strictEqual(sc56.isCold, false)
  assert.strictEqual(sc56.needsRemovableCoolLayer, true)
  assert.strictEqual(sc56.highBand.key, 'slightly_cool')

  // 42°F single reading: Cold band (< 46°F), isCold true
  const c42 = classifyPetRange({ highF: 42, lowF: 42 })
  assert.strictEqual(c42.isHot, false)
  assert.strictEqual(c42.isCold, true)
  assert.strictEqual(c42.isColdSevere, false)

  // 32°F single reading: Very Cold band (< 39°F), isCold true and isColdSevere true
  const vc32 = classifyPetRange({ highF: 32, lowF: 32 })
  assert.strictEqual(vc32.isCold, true)
  assert.strictEqual(vc32.isColdSevere, true)

  // 90°F / 40°F wide trip range (non-exclusive): both isHot and isCold true
  const wide = classifyPetRange({ highF: 90, lowF: 40 }, { exclusive: false })
  assert.strictEqual(wide.isHot, true)
  assert.strictEqual(wide.isCold, true)

  // 102°F: Extreme heat flag
  const extreme = classifyPetRange({ highF: 102, lowF: 78 })
  assert.strictEqual(extreme.isExtremeHeat, true)
})

test('petBandToThermalDemand maps bands to the 5-tier thermal scale', () => {
  assert.strictEqual(petBandToThermalDemand('very_cold'), 'very warm')
  assert.strictEqual(petBandToThermalDemand('cold'), 'warm')
  assert.strictEqual(petBandToThermalDemand('cool'), 'warm')
  assert.strictEqual(petBandToThermalDemand('slightly_cool'), 'moderate')
  assert.strictEqual(petBandToThermalDemand('comfortable'), 'light')
  assert.strictEqual(petBandToThermalDemand('slightly_warm'), 'very light')
  assert.strictEqual(petBandToThermalDemand('hot'), 'very light')
})

test('SEDENTARY_DEMAND_F matches Matzarakis PET temperature tiers', async () => {
  const { SEDENTARY_DEMAND_F } = await import('../styling-engine/biometeorology.js')
  assert.strictEqual(SEDENTARY_DEMAND_F[0].level, 'very light')
  assert.strictEqual(SEDENTARY_DEMAND_F[0].atOrAbove, 73)
  assert.strictEqual(SEDENTARY_DEMAND_F[1].level, 'light')
  assert.strictEqual(SEDENTARY_DEMAND_F[1].atOrAbove, 64)
  assert.strictEqual(SEDENTARY_DEMAND_F[2].level, 'moderate')
  assert.strictEqual(SEDENTARY_DEMAND_F[2].atOrAbove, 55)
  assert.strictEqual(SEDENTARY_DEMAND_F[3].level, 'warm')
  assert.strictEqual(SEDENTARY_DEMAND_F[3].atOrAbove, 39)
  assert.strictEqual(SEDENTARY_DEMAND_F[4].level, 'very warm')
})

