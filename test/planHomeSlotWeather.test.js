// A plan slot spent at home has no outside weather (2026-10-30, thread_1793331990443). "Mornings at
// Home" was declared `indoor` and labelled "indoor; transit: mornings 48–63°F"; the shortlist read
// the outdoor low as the morning's temperature and chose cashmere "to keep warm". `environment:
// 'home'` keeps every indoor behaviour except the way there and back, which does not exist.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-home-slot-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const {
  normalizePlanSlots, resolveSlotWeather, slotExposureConditions,
  serializeTripRequirementSlot, restoreTripRequirementSlot,
} = await import('../styling-engine/outfitSetPlanner.js')
const { resolveExposureContext } = await import('../styling-engine/exposure.js')
const { _clearWeatherCachesForTests } = await import('../styling-engine/weather.js')

const mornings = environment => normalizePlanSlots([{
  label: 'Mornings at Home', occasion: 'casual', activity: 'none', environment, count: 3,
  time_window: { period: 'morning' }, best_for: 'Relaxed morning hosting and coffee at home with guests',
}], {
  dateRange: { start: '2026-10-29', end: '2026-11-01' },
  fallbackLocation: 'Walnut Creek, CA',
})[0]

// Cold outside, so a transit reading would be unmistakable.
const coldMorningFetch = async url => {
  if (url.includes('geocoding-api')) return { ok: true, json: async () => ({ results: [{ latitude: 37.9, longitude: -122.06 }] }) }
  const days = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']
  if (url.includes('hourly=')) {
    const time = days.flatMap(d => Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`))
    return { ok: true, json: async () => ({ hourly: { time, temperature_2m: time.map(() => 45), precipitation: time.map(() => 0) } }) }
  }
  return { ok: true, json: async () => ({ daily: { time: days, temperature_2m_max: days.map(() => 50), temperature_2m_min: days.map(() => 40) } }) }
}

test("a 'home' slot is an indoor slot that knows it is at home", () => {
  const slot = mornings('home')
  assert.equal(slot.environment, 'indoor')
  assert.equal(slot.statedWeather, 'indoor')
  assert.equal(slot.atHome, true)
  assert.equal(mornings('indoor').atHome, undefined, "an ordinary indoor slot is unchanged")
})

test("a 'home' slot gets no outside weather and looks nothing up", async () => {
  _clearWeatherCachesForTests?.()
  const slot = mornings('home')
  const { profile, label, timeSensitivity } = await resolveSlotWeather(slot, {
    dateRange: { start: '2026-10-29', end: '2026-11-01' },
    location: 'Walnut Creek, CA',
    fetchImpl: async () => { throw new Error('an at-home slot must not fetch weather') },
  })
  assert.doesNotMatch(label, /transit|°F/)
  assert.match(label, /at home/)
  assert.equal(profile.isIndoor, true)
  assert.equal(profile.isCold, false)
  for (const key of ['highF', 'lowF', 'transitHighF', 'transitLowF', 'transitIsCold']) {
    assert.equal(profile[key], undefined, `${key} must be absent`)
  }
  // plan_outfit_set stops a plan whose slot weather is 'unavailable'; an at-home slot must not.
  assert.notEqual(profile.resolvedWeatherContext.status, 'unavailable')
  assert.equal(timeSensitivity.status, 'not_material')
  const exposure = resolveExposureContext({ activity: slot.activity, environment: slot.environment }, profile)
  assert.equal(slotExposureConditions(exposure), '', 'the composer is not handed an outdoor range for the room')
})

test("the same slot declared 'indoor' still carries the outdoor transit weather", async () => {
  _clearWeatherCachesForTests?.()
  const { label, profile } = await resolveSlotWeather(mornings('indoor'), {
    dateRange: { start: '2026-10-29', end: '2026-11-01' },
    location: 'Walnut Creek, CA',
    fetchImpl: coldMorningFetch,
  })
  assert.match(label, /^indoor; transit: /)
  assert.ok(Number.isFinite(profile.transitLowF))
})

test("an at-home slot ignores the plan's stated outside weather it inherits", async () => {
  const slot = { ...mornings('home'), userWeather: { high_f: 50, low_f: 40 } }
  const { label, profile } = await resolveSlotWeather(slot, {
    dateRange: { start: '2026-10-29', end: '2026-11-01' },
    location: 'Walnut Creek, CA',
    fetchImpl: coldMorningFetch,
  })
  assert.doesNotMatch(label, /°F/)
  assert.equal(profile.isCold, false)
})

test('atHome survives the persisted requirement-slot round trip', () => {
  const restored = restoreTripRequirementSlot(serializeTripRequirementSlot(mornings('home')))
  assert.equal(restored.atHome, true)
  assert.equal(restoreTripRequirementSlot(serializeTripRequirementSlot(mornings('indoor'))).atHome, undefined)
})
