process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = process.env.WARDROBE_DB_PATH || `/tmp/composer-weather-${process.pid}.db`

import test from 'node:test'
import assert from 'node:assert'
import { createStylingContextResolver } from '../styling-engine/stylingContext.js'

// docs/stated-weather-authority-findings.md §6 option 3. The Visual Composer had no structured
// weather input at all, so a temperature typed into Mood or Styling request reached only the
// heuristic path — which ranks BELOW live weather. These pin the fix at the layer that decides it.

// A live resolver that always succeeds with a mild, dry day. This is the whole point: the failures
// happened precisely BECAUSE live weather was available and plausible.
const MILD_LIVE = async () => ({
  status: 'resolved',
  location: 'Walnut Creek, CA',
  dateRange: null,
  temperature: { highF: 68.9, lowF: 57.6, band: null, isHot: false, isCold: false, isColdSevere: false, isExtremeHeat: false, source: 'live' },
  precipitation: { value: 'unknown', source: 'unavailable' },
  wind: { value: 'unknown', source: 'unavailable' },
  overallSource: 'live',
})

const resolve = (explicitRequest) => createStylingContextResolver({ weatherResolver: MILD_LIVE })({
  explicitRequest: { occasion: 'casual', season: 'current season', location: 'Walnut Creek, CA', date: new Date('2026-09-01T12:00:00Z'), ...explicitRequest },
  policy: { allowLiveWeather: true, requireOccasion: false },
})

test('a temperature typed into the styling request STILL loses to live weather', async () => {
  // Unchanged and deliberate: future-trip-weather-estimate-spec.md §3.1 forbids prose from becoming
  // weather authority. This test exists so the reason the fix had to be a structured field is
  // recorded, not rediscovered.
  const context = await resolve({ requestText: 'chilly evening, about 38°F, dinner nearby' })
  assert.equal(context.weatherProfile.isCold, false, 'prose does not and must not win')
})

test('a structured userWeather range beats an available live forecast', async () => {
  const context = await resolve({ userWeather: { high_f: 42, low_f: 38 } })
  assert.equal(context.weatherProfile.isCold, true)
  assert.equal(context.weatherProfile.isColdSevere, true, '38°F low is severe cold by the ratified <=45°F rule')
})

test('a mild structured range does not manufacture cold', async () => {
  const context = await resolve({ userWeather: { high_f: 72, low_f: 58 } })
  assert.equal(context.weatherProfile.isCold, false)
  assert.equal(Boolean(context.weatherProfile.isColdSevere), false)
})

test('with no structured weather the composer resolves exactly as before', async () => {
  const context = await resolve({})
  assert.equal(context.weatherProfile.isCold, false)
})
