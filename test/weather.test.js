process.env.NODE_ENV = 'test'

import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  getCurrentWeatherProfile, getWeatherProfileForPlan, _clearWeatherCachesForTests, serializeWeatherProfile, restoreWeatherProfile,
  validateUserWeather, validateWeatherEstimate, classifyTemperatureRange, resolveWeatherContext, resolveWeatherForRequest,
  serializeResolvedWeatherContext, restoreResolvedWeatherContext, normalizedWeatherLocationIdentity,
} from '../styling-engine/weather.js'

test('resolved weather physics round-trips independently from display season text', () => {
  const stored = serializeWeatherProfile({ weatherSource: 'live', highF: 78, lowF: 56, isHot: false, isCold: false, isExtremeHeat: false })
  assert.deepEqual(stored, { source: 'live', high_f: 78, low_f: 56, is_hot: false, is_cold: false, is_extreme_heat: false })
  assert.deepEqual(restoreWeatherProfile(stored), { weatherSource: 'live', highF: 78, lowF: 56, isHot: false, isCold: false, isExtremeHeat: false })
})

test('weather location identity normalizes punctuation, case, and US state names without conflating different places', () => {
  assert.equal(normalizedWeatherLocationIdentity('Vienna VA'), 'vienna va')
  assert.equal(normalizedWeatherLocationIdentity('Vienna, Virginia'), 'vienna va')
  assert.equal(normalizedWeatherLocationIdentity('VIENNA, VA'), 'vienna va')
  assert.notEqual(normalizedWeatherLocationIdentity('Vienna, Virginia'), normalizedWeatherLocationIdentity('Cambria, CA'))
})
import { profileRuleFit } from '../styling-engine/rules.js'

// Spec 4: live weather. Same output contract as weatherProfileFromContext ({isHot, isCold}), plus a
// weatherSource tag. Every test here injects its own fetchImpl — the module is designed to skip live
// resolution entirely under NODE_ENV=test unless a custom fetchImpl is passed, so these tests never
// depend on real network access.

beforeEach(() => {
  _clearWeatherCachesForTests()
})

function makeMockFetch({ geocodeResults = [{ latitude: 45.52, longitude: -122.68 }], highs = [85], lows = [60] } = {}) {
  let calls = 0
  const fetchImpl = async (url) => {
    calls += 1
    if (url.includes('geocoding-api')) {
      return { ok: true, json: async () => ({ results: geocodeResults }) }
    }
    return { ok: true, json: async () => ({ daily: { temperature_2m_max: highs, temperature_2m_min: lows } }) }
  }
  fetchImpl.callCount = () => calls
  return fetchImpl
}

test('getCurrentWeatherProfile resolves live weather via geocode + forecast and classifies hot correctly', async () => {
  const fetchImpl = makeMockFetch({ highs: [88], lows: [62] })
  const profile = await getCurrentWeatherProfile({ date: new Date('2026-07-15'), location: 'Portland, OR', fetchImpl })
  assert.equal(profile.weatherSource, 'live')
  assert.equal(profile.isHot, true)
  assert.equal(profile.isCold, false)
  assert.equal(profile.highF, 88)
  assert.equal(profile.lowF, 62)
})

test('getCurrentWeatherProfile classifies cold correctly', async () => {
  const fetchImpl = makeMockFetch({ highs: [38], lows: [22] })
  const profile = await getCurrentWeatherProfile({ date: new Date('2026-01-10'), location: 'Portland, OR', fetchImpl })
  assert.equal(profile.weatherSource, 'live')
  assert.equal(profile.isCold, true)
  assert.equal(profile.isHot, false)
})

test('getCurrentWeatherProfile preserves a mild forecast range for downstream styling judgment', async () => {
  const fetchImpl = makeMockFetch({ highs: [69], lows: [55] })
  const profile = await getCurrentWeatherProfile({ date: new Date('2026-08-22'), location: 'Sausalito, CA', fetchImpl })
  assert.equal(profile.weatherSource, 'live')
  assert.equal(profile.isHot, false)
  assert.equal(profile.isCold, false)
  assert.equal(profile.highF, 69)
  assert.equal(profile.lowF, 55)
})

test('getCurrentWeatherProfile falls back to the heuristic when no location is given', async () => {
  const fetchImpl = makeMockFetch()
  const profile = await getCurrentWeatherProfile({ season: 'highs 90F', fetchImpl })
  assert.equal(profile.weatherSource, 'heuristic')
  assert.equal(profile.isHot, true)
  assert.equal(fetchImpl.callCount(), 0, 'no network call should be attempted without a location')
})

test('getCurrentWeatherProfile stays neutral and observable when a named location cannot be resolved', async () => {
  const fetchImpl = makeMockFetch({ geocodeResults: [] })
  const profile = await getCurrentWeatherProfile({ season: 'cold', location: 'Nowhereville', fetchImpl })
  assert.equal(profile.weatherSource, 'unavailable')
  assert.equal(profile.weatherFailure, 'location_or_forecast_not_found')
  assert.equal(profile.isCold, false)
  assert.equal(profile.isHot, false)
})

// 2026-07-10: confirmed live against the real Open-Meteo API that "Walnut Creek, CA" (a completely
// natural way to type a US home location) returns zero geocode results, while "Walnut Creek" alone
// resolves correctly — this silently fell back to the heuristic guess with no error surfaced. Mock
// here reproduces that exact shape: the full "city, state" query fails, the city-only retry succeeds.
test('getCurrentWeatherProfile retries geocoding with just the city when a "City, ST" query returns nothing', async () => {
  let calls = 0
  const fetchImpl = async (url) => {
    calls += 1
    if (url.includes('geocoding-api')) {
      if (url.includes('walnut%20creek%2C%20ca')) return { ok: true, json: async () => ({ results: [] }) }
      if (url.includes('walnut%20creek')) return { ok: true, json: async () => ({ results: [{ latitude: 37.9, longitude: -122.06 }] }) }
      return { ok: true, json: async () => ({ results: [] }) }
    }
    return { ok: true, json: async () => ({ daily: { temperature_2m_max: [88], temperature_2m_min: [60] } }) }
  }
  const profile = await getCurrentWeatherProfile({ date: new Date('2026-07-15'), location: 'Walnut Creek, CA', fetchImpl })
  assert.equal(profile.weatherSource, 'live', 'should resolve live weather via the city-only retry, not fall back to the heuristic')
  assert.equal(profile.isHot, true)
  assert.equal(calls, 3, 'two geocode attempts (full string, then city-only) plus one forecast call')
})

test('getCurrentWeatherProfile stays neutral and observable when a named-location request throws', async () => {
  const fetchImpl = async () => { throw new Error('network down') }
  const profile = await getCurrentWeatherProfile({ season: 'hot', location: 'Portland, OR', fetchImpl })
  assert.equal(profile.weatherSource, 'unavailable')
  assert.equal(profile.weatherFailure, 'weather_request_failed')
  assert.equal(profile.isHot, false)
  assert.equal(profile.isCold, false)
})

test('getCurrentWeatherProfile stays neutral when the named-location forecast response is not ok', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('geocoding-api')) return { ok: true, json: async () => ({ results: [{ latitude: 1, longitude: 1 }] }) }
    return { ok: false }
  }
  const profile = await getCurrentWeatherProfile({ season: 'cold', location: 'Portland, OR', fetchImpl })
  assert.equal(profile.weatherSource, 'unavailable')
  assert.equal(profile.isCold, false)
})

test('under NODE_ENV=test, live resolution is skipped when no fetchImpl is injected (never hits real network)', async () => {
  const profile = await getCurrentWeatherProfile({ season: 'hot', location: 'Portland, OR' })
  assert.equal(profile.weatherSource, 'heuristic')
})

test('caching: two calls for the same date/location hit the mock fetch only once each (geocode + forecast)', async () => {
  const fetchImpl = makeMockFetch({ highs: [90], lows: [65] })
  const date = new Date('2026-08-01')
  await getCurrentWeatherProfile({ date, location: 'Austin, TX', fetchImpl })
  await getCurrentWeatherProfile({ date, location: 'Austin, TX', fetchImpl })
  assert.equal(fetchImpl.callCount(), 2, 'geocode + forecast should each be fetched once, not twice')
})

test('getWeatherProfileForPlan aggregates a multi-day range and allows both isHot and isCold for a wide swing', async () => {
  const fetchImpl = makeMockFetch({ highs: [90, 55], lows: [60, 30] })
  const profile = await getWeatherProfileForPlan({
    dateRange: { start: new Date('2026-03-01'), end: new Date('2026-03-05') },
    location: 'Denver, CO',
    fetchImpl
  })
  assert.equal(profile.weatherSource, 'live')
  assert.equal(profile.isHot, true)
  assert.equal(profile.isCold, true)
})

test('getWeatherProfileForPlan falls back to the heuristic without a start date', async () => {
  const fetchImpl = makeMockFetch()
  const profile = await getWeatherProfileForPlan({ dateRange: {}, location: 'Denver, CO', season: 'cold', fetchImpl })
  assert.equal(profile.weatherSource, 'heuristic')
})

// ============================================================================
// Structured weather context — docs/future-trip-weather-estimate-spec.md §9
// "Contract and validation" (1-5) and "Resolution and provenance" (6-14)
// ============================================================================

test('validateWeatherEstimate: 65/45 validates; invalid shapes are rejected', () => {
  assert.deepEqual(validateWeatherEstimate({ high_f: 65, low_f: 45 }), { highF: 65, lowF: 45, precipitation: null, wind: null })
  assert.equal(validateWeatherEstimate(null), null)
  assert.equal(validateWeatherEstimate({}), null, 'missing endpoints')
  assert.equal(validateWeatherEstimate({ high_f: 40, low_f: 65 }), null, 'high below low')
  assert.equal(validateWeatherEstimate({ high_f: 'warm', low_f: 45 }), null, 'non-finite')
  assert.equal(validateWeatherEstimate({ high_f: 500, low_f: 400 }), null, 'out of range')
  assert.equal(validateWeatherEstimate({ high_f: -200, low_f: -250 }), null, 'out of range, cold side')
  // Regression: Number(null) is 0 and Number("65") is 65 — a coercing check
  // silently accepted {high_f:null, low_f:null} as a real 0°F/0°F reading,
  // and a model-hallucinated string "65" as a real number. The tool schema
  // types these fields as JSON `number`; the executor must actually enforce
  // it, not just declare it.
  assert.equal(validateWeatherEstimate({ high_f: null, low_f: null }), null, 'null must not coerce to 0°F')
  assert.equal(validateWeatherEstimate({ high_f: '65', low_f: '45' }), null, 'a numeric string is not a number')
  assert.deepEqual(validateWeatherEstimate({ high_f: 65, low_f: 45, precipitation: 'rain', wind: 'windy' }), { highF: 65, lowF: 45, precipitation: 'rain', wind: 'windy' })
  assert.equal(validateWeatherEstimate({ high_f: 65, low_f: 45, precipitation: 'sunny' }), null, 'invalid enum')
})

test('validateUserWeather: numeric range, single temperature, and qualitative band all validate', () => {
  assert.deepEqual(validateUserWeather({ high_f: 65, low_f: 45 }), { temperature: { highF: 65, lowF: 45, band: null }, precipitation: null, wind: null })
  assert.deepEqual(validateUserWeather({ high_f: 70, low_f: 70 }), { temperature: { highF: 70, lowF: 70, band: null }, precipitation: null, wind: null })
  assert.deepEqual(validateUserWeather({ temperature_band: 'cold' }), { temperature: { highF: null, lowF: null, band: 'cold' }, precipitation: null, wind: null })
  assert.deepEqual(validateUserWeather({ precipitation: 'rain' }), { temperature: null, precipitation: 'rain', wind: null })
})

test('validateUserWeather rejects range+band together, incomplete ranges, empty objects, and invalid enums', () => {
  assert.equal(validateUserWeather({ high_f: 65, low_f: 45, temperature_band: 'cold' }), null, 'range and band together')
  assert.equal(validateUserWeather({ high_f: 65 }), null, 'incomplete numeric range')
  assert.equal(validateUserWeather({}), null, 'empty object')
  assert.equal(validateUserWeather(null), null)
  assert.equal(validateUserWeather({ temperature_band: 'freezing' }), null, 'invalid band enum')
  assert.equal(validateUserWeather({ precipitation: 'sunny' }), null, 'invalid precipitation enum')
  assert.equal(validateUserWeather({ wind: 'gale' }), null, 'invalid wind enum')
  assert.equal(validateUserWeather({ high_f: null, low_f: null }), null, 'null must not coerce to 0°F')
  assert.equal(validateUserWeather({ high_f: '65', low_f: '45' }), null, 'a numeric string is not a number')
})

test('Celsius has no execution-boundary representation: the validators only ever accept Fahrenheit fields', () => {
  // Celsius conversion is a model-translation responsibility (spec §4.1); the
  // executor schema has no celsius field for a caller to even pass one through.
  assert.equal(validateWeatherEstimate({ high_c: 18, low_c: 5 }), null, 'a celsius-named field is not a recognized shape at all')
  assert.equal(validateUserWeather({ high_c: 18, low_c: 5 }), null)
})

test('classifyTemperatureRange: exclusive vs non-exclusive, and a 90/40 range is both hot and cold non-exclusively', () => {
  assert.deepEqual(classifyTemperatureRange({ highF: 65, lowF: 45 }), { isHot: false, isCold: true })
  assert.deepEqual(classifyTemperatureRange({ highF: 90, lowF: 85 }, { exclusive: true }), { isHot: true, isCold: false })
  const wide = classifyTemperatureRange({ highF: 90, lowF: 40 }, { exclusive: false })
  assert.equal(wide.isHot, true)
  assert.equal(wide.isCold, true, 'a 90/40 multi-day range is both hot and cold, not neutral')
  const wideExclusive = classifyTemperatureRange({ highF: 90, lowF: 40 }, { exclusive: true })
  assert.equal(wideExclusive.isHot, false)
  assert.equal(wideExclusive.isCold, false, 'exclusive mode still collapses a genuinely wide single-context range — callers must opt into non-exclusive for a range')
})

test('resolveWeatherContext: user temperature overrides live temperature', () => {
  const context = resolveWeatherContext({
    userWeather: { temperature: { highF: 50, lowF: 38, band: null }, precipitation: null, wind: null },
    liveWeather: { weatherSource: 'live', highF: 65, lowF: 45, isHot: false, isCold: true },
  })
  assert.equal(context.temperature.source, 'stated_user')
  assert.equal(context.temperature.highF, 50)
  assert.equal(context.overallSource, 'stated_user')
})

test('resolveWeatherContext: user precipitation plus live temperature produces mixed provenance without erasing temperature', () => {
  const context = resolveWeatherContext({
    userWeather: { temperature: null, precipitation: 'rain', wind: null },
    liveWeather: { weatherSource: 'live', highF: 65, lowF: 45, isHot: false, isCold: true },
  })
  assert.equal(context.temperature.source, 'live')
  assert.equal(context.temperature.highF, 65)
  assert.equal(context.precipitation.source, 'stated_user')
  assert.equal(context.precipitation.value, 'rain')
  assert.equal(context.overallSource, 'mixed')
})

// Regression: 'unknown' is a valid PRECIPITATION_VALUES/WIND_VALUES enum
// member and is a truthy string, so a naive `if (userValue)` check let a
// user_weather field explicitly set to 'unknown' win the field-level
// precedence outright — silently erasing a real, known value from a
// lower-precedence source. 'unknown' means "this field wasn't actually
// stated," and must fall through instead.
test('resolveWeatherContext: a user precipitation of "unknown" does not override a real model_estimate value', () => {
  const context = resolveWeatherContext({
    userWeather: { temperature: null, precipitation: 'unknown', wind: null },
    modelEstimate: { highF: 65, lowF: 45, precipitation: 'rain', wind: null },
  })
  assert.equal(context.precipitation.value, 'rain', '"unknown" must fall through to the real model_estimate value')
  assert.equal(context.precipitation.source, 'model_estimate')
})

test('resolveWeatherContext: live temperature overrides the model estimate', () => {
  const context = resolveWeatherContext({
    liveWeather: { weatherSource: 'live', highF: 65, lowF: 45, isHot: false, isCold: true },
    modelEstimate: { highF: 90, lowF: 80, precipitation: null, wind: null },
  })
  assert.equal(context.temperature.source, 'live')
  assert.equal(context.temperature.highF, 65)
})

test('resolveWeatherContext: unavailable live weather falls back to the model estimate', () => {
  const context = resolveWeatherContext({
    liveWeather: { weatherSource: 'unavailable' },
    modelEstimate: { highF: 65, lowF: 45, precipitation: null, wind: null },
  })
  assert.equal(context.temperature.source, 'model_estimate')
  assert.equal(context.temperature.isCold, true)
  assert.equal(context.status, 'resolved')
})

test('resolveWeatherContext: a 90/40 model-estimate range is both hot and cold, never neutral', () => {
  const context = resolveWeatherContext({ modelEstimate: { highF: 90, lowF: 40, precipitation: null, wind: null } })
  assert.equal(context.temperature.isHot, true)
  assert.equal(context.temperature.isCold, true)
})

test('resolveWeatherContext: unavailable live weather with no estimate stays unavailable, never mild', () => {
  const context = resolveWeatherContext({ liveWeather: { weatherSource: 'unavailable' } })
  assert.equal(context.status, 'unavailable')
  assert.equal(context.temperature.source, 'unavailable')
  assert.equal(context.temperature.isHot, false)
  assert.equal(context.temperature.isCold, false)
})

test('resolveWeatherContext: a qualitative user band maps deterministically and outranks live numbers', () => {
  const context = resolveWeatherContext({
    userWeather: { temperature: { highF: null, lowF: null, band: 'cold' }, precipitation: null, wind: null },
    liveWeather: { weatherSource: 'live', highF: 65, lowF: 45, isHot: false, isCold: false },
  })
  assert.equal(context.temperature.source, 'stated_user')
  assert.equal(context.temperature.isCold, true)
  assert.equal(context.temperature.isHot, false)
  assert.equal(context.temperature.highF, null, 'a qualitative band carries no numeric value of its own')
})

test('resolveWeatherContext round-trips through serialize/restore', () => {
  const context = resolveWeatherContext({
    modelEstimate: { highF: 65, lowF: 45, precipitation: 'unknown', wind: 'unknown' },
    location: 'Vienna, Virginia',
    dateRange: { start: '2026-10-12', end: '2026-10-18' },
  })
  const stored = serializeResolvedWeatherContext(context)
  const restored = restoreResolvedWeatherContext(stored)
  assert.deepEqual(restored, context)
})

test('resolveWeatherForRequest: plan weather inherits only to matching-location/date slots (binding lives in the caller, this proves the primitive)', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ results: [] }) })
  const vienna = await resolveWeatherForRequest({
    location: 'Vienna, Virginia',
    dateRange: { start: '2026-10-12', end: '2026-10-18' },
    modelEstimate: { highF: 65, lowF: 45, precipitation: null, wind: null },
    fetchImpl,
  })
  assert.equal(vienna.status, 'resolved')
  assert.equal(vienna.temperature.source, 'model_estimate')
})

test('resolveWeatherForRequest: no named location/date retains the existing heuristic behavior as a ranking no-op', async () => {
  const fetchImpl = async () => { throw new Error('must not be called without a destination') }
  const context = await resolveWeatherForRequest({ location: '', dateRange: null, season: 'highs 90F', fetchImpl })
  assert.equal(context.temperature.source, 'heuristic')
  assert.equal(context.temperature.isHot, true)
})

test('contract parity: profileRuleFit behaves identically given a live vs heuristic profile with the same isHot/isCold', () => {
  const piece = { id: 1, category: 'top', fabric_category: 'wool' }
  const mergedRules = { prohibited_materials_warm: ['wool'] }
  const liveProfile = { isHot: true, isCold: false, weatherSource: 'live' }
  const heuristicProfile = { isHot: true, isCold: false, weatherSource: 'heuristic' }
  const liveFit = profileRuleFit(piece, mergedRules, { weatherProfile: liveProfile })
  const heuristicFit = profileRuleFit(piece, mergedRules, { weatherProfile: heuristicProfile })
  assert.deepEqual(liveFit, heuristicFit)
})
