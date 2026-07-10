process.env.NODE_ENV = 'test'

import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { getCurrentWeatherProfile, getWeatherProfileForPlan, _clearWeatherCachesForTests } from '../styling-engine/weather.js'
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
})

test('getCurrentWeatherProfile classifies cold correctly', async () => {
  const fetchImpl = makeMockFetch({ highs: [38], lows: [22] })
  const profile = await getCurrentWeatherProfile({ date: new Date('2026-01-10'), location: 'Portland, OR', fetchImpl })
  assert.equal(profile.weatherSource, 'live')
  assert.equal(profile.isCold, true)
  assert.equal(profile.isHot, false)
})

test('getCurrentWeatherProfile falls back to the heuristic when no location is given', async () => {
  const fetchImpl = makeMockFetch()
  const profile = await getCurrentWeatherProfile({ season: 'highs 90F', fetchImpl })
  assert.equal(profile.weatherSource, 'heuristic')
  assert.equal(profile.isHot, true)
  assert.equal(fetchImpl.callCount(), 0, 'no network call should be attempted without a location')
})

test('getCurrentWeatherProfile falls back to the heuristic when geocoding finds nothing, without throwing', async () => {
  const fetchImpl = makeMockFetch({ geocodeResults: [] })
  const profile = await getCurrentWeatherProfile({ season: 'cold', location: 'Nowhereville', fetchImpl })
  assert.equal(profile.weatherSource, 'heuristic')
  assert.equal(profile.isCold, true)
})

test('getCurrentWeatherProfile falls back to the heuristic when the fetch throws, without throwing', async () => {
  const fetchImpl = async () => { throw new Error('network down') }
  const profile = await getCurrentWeatherProfile({ season: 'hot', location: 'Portland, OR', fetchImpl })
  assert.equal(profile.weatherSource, 'heuristic')
  assert.equal(profile.isHot, true)
})

test('getCurrentWeatherProfile falls back to the heuristic when the forecast response is not ok', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('geocoding-api')) return { ok: true, json: async () => ({ results: [{ latitude: 1, longitude: 1 }] }) }
    return { ok: false }
  }
  const profile = await getCurrentWeatherProfile({ season: 'cold', location: 'Portland, OR', fetchImpl })
  assert.equal(profile.weatherSource, 'heuristic')
  assert.equal(profile.isCold, true)
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

test('contract parity: profileRuleFit behaves identically given a live vs heuristic profile with the same isHot/isCold', () => {
  const piece = { id: 1, category: 'top', fabric_category: 'wool' }
  const mergedRules = { prohibited_materials_warm: ['wool'] }
  const liveProfile = { isHot: true, isCold: false, weatherSource: 'live' }
  const heuristicProfile = { isHot: true, isCold: false, weatherSource: 'heuristic' }
  const liveFit = profileRuleFit(piece, mergedRules, { weatherProfile: liveProfile })
  const heuristicFit = profileRuleFit(piece, mergedRules, { weatherProfile: heuristicProfile })
  assert.deepEqual(liveFit, heuristicFit)
})
