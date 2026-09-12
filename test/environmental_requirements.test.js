import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { resolveColdLayerPresenceRequirement } from '../styling-engine/environmentalRequirements.js'
import { evaluateOutfitEnvironmentalAdequacy, ENVIRONMENTAL_ADEQUACY_CODES } from '../styling-engine/outfitEnvironmentalAdequacy.js'
import { resolveWeatherForRequest } from '../styling-engine/weather.js'
import { resolveStylingContext } from '../styling-engine/stylingContext.js'

test('44°F vs 45°F continuity: ordinary outdoor exposure produces recommended advisory for both without 1-degree cliff', () => {
  const at44 = resolveColdLayerPresenceRequirement({
    exposureMode: 'outdoor',
    exertion: 'low',
    conditions: { known: true, wakingLowF: 44, wakingHighF: 50 },
  })
  const at45 = resolveColdLayerPresenceRequirement({
    exposureMode: 'outdoor',
    exertion: 'low',
    conditions: { known: true, wakingLowF: 45, wakingHighF: 50 },
  })

  assert.equal(at44.state, 'recommended')
  assert.equal(at45.state, 'recommended')
  assert.equal(at44.applies, false, 'ordinary cold does not hard-gate')
  assert.equal(at45.applies, false, 'ordinary cold does not hard-gate')

  // Under Contract C, neither produces a hard NO_WARM_LAYER_FOR_COLD error:
  const lightweightPieces = [
    { id: 1, name: 'Cotton Tee', category: 'top', fabric_weight: 'light' },
    { id: 2, name: 'Chinos', category: 'bottom', fabric_weight: 'medium' },
  ]

  const result44 = evaluateOutfitEnvironmentalAdequacy(lightweightPieces, {
    weatherProfile: { coldPresenceRequirement: at44 },
    environment: 'outdoor',
  })
  const result45 = evaluateOutfitEnvironmentalAdequacy(lightweightPieces, {
    weatherProfile: { coldPresenceRequirement: at45 },
    environment: 'outdoor',
  })

  const hasHardError44 = result44.findings.some(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.NO_WARM_LAYER_FOR_COLD)
  const hasHardError45 = result45.findings.some(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.NO_WARM_LAYER_FOR_COLD)
  assert.equal(hasHardError44, false, '44°F must not produce hard NO_WARM_LAYER_FOR_COLD')
  assert.equal(hasHardError45, false, '45°F must not produce hard NO_WARM_LAYER_FOR_COLD')

  const hasAdvisory44 = result44.findings.some(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.WARM_LAYER_RECOMMENDED)
  const hasAdvisory45 = result45.findings.some(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.WARM_LAYER_RECOMMENDED)
  assert.equal(hasAdvisory44, true, '44°F produces advisory WARM_LAYER_RECOMMENDED')
  assert.equal(hasAdvisory45, true, '45°F produces advisory WARM_LAYER_RECOMMENDED')
})

test('65°F high / 45°F low preserves mild active outdoor relaxation as recommended advisory', () => {
  const viennaExposure = resolveColdLayerPresenceRequirement({
    exposureMode: 'outdoor',
    exertion: 'moderate',
    conditions: { known: true, wakingLowF: 45, wakingHighF: 65 },
  })
  assert.equal(viennaExposure.state, 'recommended')
  assert.equal(viennaExposure.applies, false)
})

test('verified severe cold outdoor exposure produces required hard gate', () => {
  const severeColdExposure = resolveColdLayerPresenceRequirement({
    exposureMode: 'outdoor',
    exertion: 'low',
    conditions: { known: true, wakingLowF: 20, wakingHighF: 35 },
    severeColdEvidence: { applies: true, basis: 'numeric_range', source: 'live' },
  })
  assert.equal(severeColdExposure.state, 'required')
  assert.equal(severeColdExposure.applies, true)

  const lightweightPieces = [
    { id: 1, name: 'Cotton Tee', category: 'top', fabric_weight: 'light' },
    { id: 2, name: 'Chinos', category: 'bottom', fabric_weight: 'medium' },
  ]
  const result = evaluateOutfitEnvironmentalAdequacy(lightweightPieces, {
    weatherProfile: { coldPresenceRequirement: severeColdExposure },
    environment: 'outdoor',
  })
  const hardError = result.findings.find(f => f.code === ENVIRONMENTAL_ADEQUACY_CODES.NO_WARM_LAYER_FOR_COLD)
  assert.ok(hardError, 'severe cold outdoor exposure must produce hard NO_WARM_LAYER_FOR_COLD')
  assert.equal(hardError.severity, 'error')
})

test('unknown weather conditions return state unknown with zero findings', () => {
  const unknownExposure = resolveColdLayerPresenceRequirement({
    exposureMode: 'outdoor',
    exertion: 'low',
    conditions: { known: false, wakingLowF: null, wakingHighF: null },
  })
  assert.equal(unknownExposure.state, 'unknown')
  assert.equal(unknownExposure.applies, false)

  const result = evaluateOutfitEnvironmentalAdequacy([], {
    weatherProfile: { coldPresenceRequirement: unknownExposure },
    environment: 'outdoor',
  })
  assert.equal(result.findings.length, 0, 'unknown conditions produce zero findings')
})

test('indoor destination base returns state not_needed', () => {
  const indoorExposure = resolveColdLayerPresenceRequirement({
    exposureMode: 'indoor_destination',
    exertion: 'low',
    conditions: { known: true, wakingLowF: 30, wakingHighF: 40 },
    severeColdEvidence: { applies: true, basis: 'numeric_range', source: 'live' },
  })
  assert.equal(indoorExposure.state, 'not_needed')
  assert.equal(indoorExposure.applies, false)

  const result = evaluateOutfitEnvironmentalAdequacy([], {
    weatherProfile: { coldPresenceRequirement: indoorExposure },
    environment: 'indoor',
  })
  assert.equal(result.findings.length, 0, 'indoor destination produces zero presence findings')
})

test('active code census: zero occurrences of deleted master booleans', () => {
  const banned = [
    'requiresOuterwear',
    'transitRequiresOuterwear',
    'requiresWarmLayerForColdExposure',
    'computeRequiresWarmLayerForColdExposure',
  ]
  const dirs = ['styling-engine', 'routes']
  const offenders = []

  for (const dir of dirs) {
    const fullDir = path.resolve(dir)
    const files = fs.readdirSync(fullDir, { recursive: true })
    for (const file of files) {
      if (!file.endsWith('.js') && !file.endsWith('.mjs')) continue
      const filePath = path.join(fullDir, file)
      const content = fs.readFileSync(filePath, 'utf8')
      for (const term of banned) {
        if (content.includes(term)) {
          offenders.push(`${path.relative(process.cwd(), filePath)}: contains ${term}`)
        }
      }
    }
  }

  assert.deepEqual(offenders, [], `Banned master booleans found in active code:\n${offenders.join('\n')}`)
})

test('qualitative cold band resolved through weather resolver produces advisory recommended and isSevereCold false', async () => {
  const resolvedWeather = await resolveWeatherForRequest({
    userWeather: { temperature_band: 'cold' }
  })
  assert.equal(resolvedWeather.temperature.band, 'cold')
  assert.equal(resolvedWeather.temperature.isCold, true)
  assert.equal(resolvedWeather.temperature.isColdSevere, false)

  const stylingContext = await resolveStylingContext({
    explicitRequest: {
      userWeather: { temperature_band: 'cold' },
      activity: 'hiking',
    }
  })

  const req = stylingContext.weatherProfile?.coldPresenceRequirement
  assert.ok(req, 'coldPresenceRequirement should be attached to stylingContext.weatherProfile')
  assert.equal(req.evidence.exposureMode, 'sustained_outdoor')
  assert.equal(req.evidence.isSevereCold, false)
  assert.equal(req.state, 'recommended')
  assert.equal(req.applies, false)
})

test('daytime high 46°F produces recommended advisory, 45°F produces required hard gate', async () => {
  const context46 = await resolveStylingContext({
    explicitRequest: {
      userWeather: { high_f: 46, low_f: 38 },
      activity: 'hiking',
    }
  })
  const req46 = context46.weatherProfile?.coldPresenceRequirement
  assert.equal(req46.evidence.isSevereCold, false)
  assert.equal(req46.state, 'recommended')
  assert.equal(req46.applies, false)

  const context45 = await resolveStylingContext({
    explicitRequest: {
      userWeather: { high_f: 45, low_f: 38 },
      activity: 'hiking',
    }
  })
  const req45 = context45.weatherProfile?.coldPresenceRequirement
  assert.equal(req45.evidence.isSevereCold, true)
  assert.equal(req45.state, 'required')
  assert.equal(req45.applies, true)
})

test('explicit severe cold terms produce state required', async () => {
  for (const term of ['blizzard', 'freezing', 'sub-zero']) {
    const context = await resolveStylingContext({
      explicitRequest: {
        statedWeather: `severe ${term} conditions`,
        activity: 'walking',
      }
    })
    const req = context.weatherProfile?.coldPresenceRequirement
    assert.ok(req, `coldPresenceRequirement should exist for ${term}`)
    assert.equal(req.evidence.isSevereCold, true, `${term} must trigger isSevereCold`)
    assert.equal(req.state, 'required', `${term} must produce state required`)
    assert.equal(req.applies, true, `${term} must apply as a hard gate`)
  }
})

