// §8 step 3 — outfit adequacy consumes the band for thermal AMOUNT.
// Removability, transit coverage and outdoor capability remain separate contracts (§2.1).
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
const { evaluateOutfitEnvironmentalAdequacy, ENVIRONMENTAL_ADEQUACY_CODES } = await import('../styling-engine/outfitEnvironmentalAdequacy.js')
const { validateUserWeather, resolveWeatherContext } = await import('../styling-engine/weather.js')

const W = (high_f, low_f) => ({ ...resolveWeatherContext({ userWeather: validateUserWeather({ high_f, low_f }) }).temperature })
const BASE = [
  { id: 1, category: 'top', fabric_weight: 'medium', fiber_content: ['cotton'], sleeve_length: 'long' },
  { id: 2, category: 'bottom', fabric_weight: 'medium', fabric_category: 'denim', fiber_content: ['denim'], length_hits_at: 'ankle' },
  { id: 3, category: 'shoes', fabric_category: 'leather' },
]
const PUFFER = { id: 4, category: 'outerwear', fabric_weight: 'heavy', insulating_layer_materials: ['down'], sleeve_length: 'long' }
const CARDIGAN = { id: 5, category: 'outerwear', fabric_weight: 'medium', fabric_category: 'knit', fiber_content: ['wool'], sleeve_length: 'long' }
const codes = (pieces, weather, environment = 'outdoor') =>
  (evaluateOutfitEnvironmentalAdequacy(pieces, { weatherProfile: weather, environment }).findings || [])
const has = (pieces, weather, code) => codes(pieces, weather).some(f => f.code === code)

test('overshoot is reported on a mild day, and only for the excessive outfit', () => {
  // layer-weight-ceiling.md recorded a puffer on mild museum days across five runs and two
  // providers. Nothing in the engine could state it until now.
  assert.ok(has([...BASE, PUFFER], W(72, 62), ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT))
  assert.ok(!has([...BASE, CARDIGAN], W(72, 62), ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT))
})

test('overshoot is ADVISORY — it never invalidates an outfit', () => {
  // §5.5: a wardrobe whose only layer is a heavy coat still gets dressed.
  const found = codes([...BASE, PUFFER], W(72, 62)).filter(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT)
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, 'advisory')
  assert.notEqual(found[0].severity, 'error')
})

test('a genuinely cold day flags neither garment as excessive', () => {
  assert.ok(!has([...BASE, PUFFER], W(30, 20), ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT))
  assert.ok(!has([...BASE, CARDIGAN], W(30, 20), ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT))
})

test('undershoot is advisory too — missing metadata never becomes hard invalidity', () => {
  // Acceptance criterion 8, and this was learned the hard way: as an error, a synthetic
  // "sleeved wool coat" tagged fabric_weight:light with no fibre content placed as `light`,
  // undershot a 65/45 day and hard-blocked plan submission. The PRESENCE gate
  // (NO_WARM_LAYER_FOR_COLD) keeps its authority; the band adds the graded AMOUNT.
  const src = fs.readFileSync(path.join(process.cwd(), 'styling-engine/outfitEnvironmentalAdequacy.js'), 'utf8')
  const block = src.slice(src.indexOf('THERMAL_UNDERSHOOT,'))
  assert.ok(block.slice(0, 400).includes("severity: 'advisory'"), 'undershoot must not be an error')
})

test('the unknown asymmetry: it silences undershoot, not overshoot', () => {
  // An unplaceable base could be secretly warm, so "too light" is the claim the missing data could
  // falsify. It cannot make a `very warm` coat LESS excessive, and requiring complete evidence would
  // silence overshoot on nearly every real outfit — a plain medium cotton top is itself unplaceable.
  const unplaceableBase = [{ id: 9, category: 'top', fabric_weight: 'medium', fiber_content: ['unknown'] }, BASE[1], BASE[2]]
  assert.ok(has([...unplaceableBase, PUFFER], W(72, 62), ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT),
    'overshoot still reported — it is carried by the placed layer')
  assert.ok(!has([...unplaceableBase, CARDIGAN], W(30, 20), ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_UNDERSHOOT),
    'undershoot stays silent when the base cannot be placed')
})

test('the neighbouring contracts are untouched', () => {
  // Removability, transit coverage and outdoor capability are different questions from "how much
  // insulation" and keep their own triggers (§2.1). This slice migrated the AMOUNT only.
  const src = fs.readFileSync(path.join(process.cwd(), 'styling-engine/outfitEnvironmentalAdequacy.js'), 'utf8')
  for (const kept of ['weather.needsRemovableCoolLayer', 'weather.transitNeedsRemovableCoolLayer',
                      'weather.transitIsCold', 'weather.isColdSevere']) {
    assert.ok(src.includes(kept), `${kept} must still drive its own contract`)
  }
})

test('semantic signals only — no reason-string matching', () => {
  // The ranking slice found a filter keyed on a reason STRING that silently stopped matching when
  // the band renamed it. Prose is not an API.
  const src = fs.readFileSync(path.join(process.cwd(), 'styling-engine/outfitEnvironmentalAdequacy.js'), 'utf8')
  const live = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
  assert.ok(!/adjustment\.reason\s*===/.test(live), 'no reason-string equality checks')
  assert.ok(live.includes('compareThermalFit'), 'the comparison comes from the band')
})
