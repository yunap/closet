import test from 'node:test'
import assert from 'node:assert/strict'

import { createStylingContextResolver, projectStylingApplicabilityContext } from '../styling-engine/stylingContext.js'
import { resolveCalendarSeason } from '../lib/seasonContext.js'

const fixedNow = new Date('2026-08-24T12:00:00-07:00')

test('styling context resolves intent by field and records lower-authority conflicts', async () => {
  const resolveStylingContext = createStylingContextResolver({
    weatherResolver: async () => ({ isHot: false, isCold: false, weatherSource: 'live' }),
  })
  const context = await resolveStylingContext({
    explicitRequest: {
      occasion: 'dinner',
      activity: 'walking',
      season: 'current season',
      mission: 'mix',
      location: 'Oakland, CA',
      requestText: 'Dinner after a nature walk',
      date: fixedNow,
    },
    actionArtifact: { occasion: 'casual', activity: 'none', season: 'winter' },
    establishedState: { occasion: 'travel', activity: 'hiking' },
  })

  assert.equal(context.occasion, 'evening')
  assert.equal(context.activity, 'walking', 'declared activity remains distinct from inference')
  assert.equal(context.resolvedActivity, 'hiking', 'request evidence may escalate walking to hiking')
  assert.equal(context.season, 'current season', 'request wording remains available to weather and UI policy')
  assert.equal(context.calendarSeason, 'summer', 'executable applicability receives a calendar season')
  assert.equal(context.provenanceByField.occasion.source, 'explicit_request')
  assert.equal(context.provenanceByField.activity.source, 'explicit_request')
  assert.equal(context.provenanceByField.activity.resolvedFromRequest, true)
  assert.equal(context.provenanceByField.calendarSeason.source, 'derived_from_resolved_season')
  assert.equal(context.applicabilityContext.season, 'summer')
  assert.deepEqual(context.conflicts.map(conflict => conflict.field).sort(), ['activity', 'occasion', 'season'])
})

test('applicability projection treats structured weather and equivalent prose-season shapes identically', () => {
  const currentDate = new Date('2026-07-15T12:00:00-07:00')
  assert.equal(resolveCalendarSeason('current season; mild weather; forecast high 72°F', currentDate), 'summer')
  assert.equal(resolveCalendarSeason('summer; hot weather', currentDate), 'summer')
  const context = projectStylingApplicabilityContext({
    occasion: 'city',
    activity: 'walking',
    season: 'current season; mild weather; forecast high 72°F',
    date: currentDate,
    weatherProfile: { isRainy: true, isWetExposure: true, isHot: false },
  })
  assert.equal(context.season, 'summer')
  assert.deepEqual(context.weather, { hot: false, cold: false, rainy: true, wet_exposure: true })
})

test('artifact intent wins when the current request does not override that field', async () => {
  const resolveStylingContext = createStylingContextResolver()
  const context = await resolveStylingContext({
    explicitRequest: { requestText: 'Show another option', date: fixedNow },
    actionArtifact: { occasion: 'gallery / art event', activity: 'walking', season: 'spring' },
    establishedState: { occasion: 'casual', activity: 'none', season: 'current season' },
    policy: { allowLiveWeather: false },
  })

  assert.equal(context.occasion, 'gallery / art event')
  assert.equal(context.activity, 'walking')
  assert.equal(context.season, 'spring')
  assert.equal(context.calendarSeason, 'spring')
  assert.equal(context.provenanceByField.occasion.source, 'action_artifact')
})

test('explicit stated weather wins without calling live weather', async () => {
  let calls = 0
  const resolveStylingContext = createStylingContextResolver({
    weatherResolver: async () => {
      calls += 1
      return { isHot: true, isCold: false, weatherSource: 'live' }
    },
  })
  const context = await resolveStylingContext({
    explicitRequest: {
      season: 'current season',
      statedWeather: 'rainy weather',
      location: 'Berkeley, CA',
      date: fixedNow,
    },
  })

  assert.equal(calls, 0)
  assert.equal(context.weatherProfile.weatherSource, 'stated')
  assert.equal(context.weatherProfile.isRainy, true)
  assert.equal(context.provenanceByField.weatherProfile.source, 'explicit_request.stated_weather')
})

test('live weather refreshes an older artifact snapshot for current season', async () => {
  const live = { isHot: false, isCold: true, highF: 51, lowF: 42, weatherSource: 'live' }
  const resolveStylingContext = createStylingContextResolver({ weatherResolver: async () => live })
  const context = await resolveStylingContext({
    actionArtifact: {
      season: 'current season',
      location: 'Seattle, WA',
      date: fixedNow,
      weatherProfile: { isHot: true, isCold: false, highF: 88, weatherSource: 'live' },
    },
  })

  assert.deepEqual(context.weatherProfile, live)
  assert.equal(context.provenanceByField.weatherProfile.source, 'live_weather')
})

test('saved weather snapshot is the fallback when a live refresh is unavailable', async () => {
  const saved = { isHot: true, isCold: false, highF: 84, weatherSource: 'live' }
  const resolveStylingContext = createStylingContextResolver({
    weatherResolver: async () => ({
      isHot: false,
      isCold: false,
      weatherSource: 'unavailable',
      weatherFailure: 'weather_request_failed',
    }),
  })
  const context = await resolveStylingContext({
    actionArtifact: {
      season: 'current season',
      location: 'Seattle, WA',
      date: fixedNow,
      weatherProfile: saved,
    },
  })

  assert.deepEqual(context.weatherProfile, saved)
  assert.equal(context.provenanceByField.weatherProfile.source, 'action_artifact.weather_profile')
  assert.equal(context.provenanceByField.weatherProfile.fallbackFrom, 'live_weather_unavailable')
})

test('explicit hypothetical season does not fetch or inherit an older weather snapshot', async () => {
  let calls = 0
  const resolveStylingContext = createStylingContextResolver({
    weatherResolver: async () => {
      calls += 1
      return { isHot: false, isCold: true, weatherSource: 'live' }
    },
  })
  const context = await resolveStylingContext({
    explicitRequest: { season: 'summer', date: fixedNow },
    actionArtifact: {
      season: 'current season',
      location: 'Seattle, WA',
      weatherProfile: { isHot: false, isCold: true, weatherSource: 'live' },
    },
  })

  assert.equal(calls, 0)
  assert.equal(context.weatherProfile.weatherSource, 'heuristic')
  assert.equal(context.weatherProfile.isHot, true)
})

test('a supplied current weather profile is preserved without another live lookup', async () => {
  let calls = 0
  const supplied = {
    isHot: false,
    isCold: false,
    highF: 78,
    lowF: 56,
    weatherSource: 'live',
  }
  const resolveStylingContext = createStylingContextResolver({
    weatherResolver: async () => {
      calls += 1
      return { isHot: true, isCold: false, weatherSource: 'live' }
    },
  })
  const context = await resolveStylingContext({
    explicitRequest: {
      season: 'current season',
      weatherProfile: supplied,
      location: 'Larkspur, CA',
      date: fixedNow,
    },
  })

  assert.equal(calls, 0)
  assert.deepEqual(context.weatherProfile, supplied)
  assert.equal(context.provenanceByField.weatherProfile.source, 'explicit_request.weather_profile')
})
