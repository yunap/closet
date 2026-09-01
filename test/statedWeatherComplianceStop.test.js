process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = process.env.WARDROBE_DB_PATH || `/tmp/stated-weather-stop-${process.pid}.db`

import test from 'node:test'
import assert from 'node:assert'
import { requestStatesWeather } from '../styling-engine/tools.js'

// docs/stated-weather-authority-findings.md §6 option 1. This detector exists ONLY to refuse to
// proceed and hand translation back to the model — it never populates a weather value, which is
// what keeps it on the right side of future-trip-weather-estimate-spec.md §3.1.

test('detects an explicitly stated temperature', () => {
  for (const t of ['38°F and raining', '42F walking', '65 degrees', 'about 55 °F', 'it will be 30C']) {
    assert.equal(requestStatesWeather(t), true, t)
  }
})

test('detects an explicitly stated precipitation condition', () => {
  for (const t of ['it is raining', 'rainy all day', 'expect snow', 'sleet on the way', 'a light drizzle']) {
    assert.equal(requestStatesWeather(t), true, t)
  }
})

test('does NOT fire on style prose — the false-positive class §3.1 was written about', () => {
  // The prose-scanning repair this replaces died on exactly these: "warm colors", outfit counts,
  // and style adjectives. A detector that fires here would bounce ordinary styling requests.
  for (const t of [
    'warm colors please', 'I want cool tones', 'hot pink top', 'something warm for the evening',
    'chilly vibes', 'a cool relaxed look', 'build me 3 outfits', 'a 10-piece capsule',
  ]) {
    assert.equal(requestStatesWeather(t), false, t)
  }
})

test('does NOT fire on snow-as-garment', () => {
  // "snow boots" names a garment, not a condition — the same collision the adjectives above have.
  for (const t of ['my snow boots', 'snow pants for the trip', 'a snow jacket']) {
    assert.equal(requestStatesWeather(t), false, t)
  }
})

test('bare cool/cold adjectives are a deliberate false NEGATIVE', () => {
  // "chilly evening" is genuine weather, and it is deliberately not detected: adjectives collide
  // with style prose, and the cost of missing one is only that we fall back to today's behaviour.
  assert.equal(requestStatesWeather('chilly evening, dinner nearby'), false)
  assert.equal(requestStatesWeather('cold out today'), false)
})

test('is inert on empty or non-string input', () => {
  assert.equal(requestStatesWeather(''), false)
  assert.equal(requestStatesWeather(null), false)
  assert.equal(requestStatesWeather(undefined), false)
})
