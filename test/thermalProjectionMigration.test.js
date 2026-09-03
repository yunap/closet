// §8 step 5 — projection surfaces read the band, not a binary threshold.
//
// The other half of the composition problem: not only ranking the right garments, but ensuring the
// model consistently RECEIVES graded thermal context instead of hearing nothing below a threshold.
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
const { weatherFitForPiece } = await import('../styling-engine/rules.js')
const { requiredThermalBand } = await import('../styling-engine/thermalDemand.js')
const { resolveExposureContext } = await import('../styling-engine/exposure.js')
const { validateUserWeather, resolveWeatherContext } = await import('../styling-engine/weather.js')

const W = (high_f, low_f) => ({ ...resolveWeatherContext({ userWeather: validateUserWeather({ high_f, low_f }) }).temperature })
const read = f => fs.readFileSync(path.join(process.cwd(), f), 'utf8')

test('search evidence is attached where the old gate was silent', () => {
  // tools.js gated weatherFit on `isHot || isCold`. At 65/47 neither fires, so search results
  // carried no thermal evidence and the model composed with nothing to go on — §6's defect on the
  // evidence side. THIS, not isWeatherFiltered, was the real binary.
  const jacket = { category: 'outerwear', fabric_weight: 'medium', fiber_content: ['cotton'], insulating_layer_materials: [], sleeve_length: 'long' }
  const w = W(65, 47)
  assert.equal(w.isCold, false, 'the legacy flag is genuinely false here')
  assert.ok(weatherFitForPiece(jacket, w).adjustments.length > 0, 'yet the band has an opinion')

  const src = read('styling-engine/tools.js')
  assert.ok(!src.includes('if (resolvedWeather.isHot || resolvedWeather.isCold) {'),
    'the binary evidence gate must be gone')
})

test('the coarse label is computed FROM the band, and only the blind spot moves', () => {
  // §3.8: a coarse word is legitimate, but it must be derived from the band rather than from a
  // parallel flag. Every other tier must stay where it was — this migration closes a gap, it does
  // not broaden the tiers (the §21 mistake, avoided).
  const label = (h, l) => {
    const w = W(h, l)
    const d = requiredThermalBand(resolveExposureContext({}, w))
    const cold = d.level === 'very warm' ? 'cold weather' : d.level === 'warm' ? 'cool weather' : null
    return w.isExtremeHeat ? 'extreme hot weather' : (w.isHot ? 'hot weather' : (cold || 'mild weather'))
  }
  assert.equal(label(75, 60), 'mild weather', 'unchanged')
  assert.equal(label(55, 45), 'cool weather', 'unchanged')
  assert.equal(label(38, 30), 'cold weather', 'unchanged')
  assert.equal(label(65, 47), 'cool weather', 'THE BLIND SPOT: legacy said "mild weather" here')
})

test('heat is untouched — this arc migrated the cold side only', () => {
  const src = read('styling-engine/tools.js')
  assert.ok(src.includes("resolvedWeather.isHot ? 'hot weather'"), 'the hot branch still reads isHot')
  assert.ok(src.includes('isExtremeHeat'), 'and extreme heat is unchanged')
})

test('the disclosure tracks whether weather actually shaped the roster', () => {
  // routes/ai.js told the model "everything shown is weather-optimized" only when a flag fired, so
  // on a 65/47 day the roster WAS weather-scored and the model was told it was not.
  const src = read('routes/ai.js')
  assert.ok(!src.includes('const isWeatherFiltered = weatherProfile.isHot || weatherProfile.isCold'),
    'the flag-only disclosure must be gone')
  assert.ok(src.includes('weatherDemand.level'), 'it now tracks the band')
})

test('no projection invents a thermal claim where the band is silent', () => {
  // Unknown stays unknown on the evidence side too: a garment the placement cannot position
  // contributes no adjustment, so it receives no label rather than a neutral-looking one.
  const unplaceable = { category: 'outerwear', fabric_weight: 'medium', fiber_content: ['unknown'] }
  assert.equal(weatherFitForPiece(unplaceable, W(65, 47)).adjustments.length, 0)
  // And with no temperature at all, nothing is claimed.
  assert.equal(weatherFitForPiece({ category: 'top', fabric_weight: 'light' }, { isCold: true }).score, 0)
})
