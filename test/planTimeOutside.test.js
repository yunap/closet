// time_outside on plan slots (2026-10-30, docs/plan-prompt-audit-2026-10-30.md ruling 5): "cooking, then perhaps a
// neighborhood walk" could only be planned as outdoor walking (thread_1793347659171), so the whole morning took the
// outdoor forecast. A home slot with brief time outside keeps the outdoor reading for that time only.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-time-outside-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { normalizePlanSlots, resolveSlotWeather, serializeTripRequirementSlot, restoreTripRequirementSlot } = await import('../styling-engine/outfitSetPlanner.js')
const { STYLIST_TOOLS } = await import('../styling-engine/tools.js')
const { _clearWeatherCachesForTests } = await import('../styling-engine/weather.js')

const dateRange = { start: '2026-10-30', end: '2026-11-01' }
const slotFor = (environment, timeOutside) => normalizePlanSlots([{
  label: 'Hosting', occasion: 'casual', activity: 'none', environment, count: 3,
  ...(timeOutside ? { time_outside: timeOutside } : {}),
}], { dateRange, fallbackLocation: 'Walnut Creek, CA' })[0]

const coolFetch = async url => {
  if (url.includes('geocoding-api')) return { ok: true, json: async () => ({ results: [{ latitude: 37.9, longitude: -122.06 }] }) }
  const days = ['2026-10-30', '2026-10-31', '2026-11-01']
  if (url.includes('hourly=')) {
    const time = days.flatMap(d => Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`))
    return { ok: true, json: async () => ({ hourly: { time, temperature_2m: time.map(() => 50), precipitation: time.map(() => 0) } }) }
  }
  return { ok: true, json: async () => ({ daily: { time: days, temperature_2m_max: days.map(() => 62), temperature_2m_min: days.map(() => 45) } }) }
}

test('time outside is set for indoor and home slots only, with defaults that keep today\'s behaviour', () => {
  assert.equal(slotFor('home', 'brief').timeOutside, 'brief')
  assert.equal(slotFor('home').timeOutside, 'none')
  assert.equal(slotFor('home', 'to_and_from').timeOutside, 'none', 'a home slot has no way there and back')
  assert.equal(slotFor('indoor').timeOutside, 'to_and_from')
  assert.equal(slotFor('indoor', 'none').timeOutside, 'none')
  assert.equal(slotFor('outdoor', 'brief').timeOutside, undefined)
})

test('a home slot with brief time outside gives the outdoor temperature for that time only', async () => {
  _clearWeatherCachesForTests?.()
  const { label, profile } = await resolveSlotWeather(slotFor('home', 'brief'), { dateRange, location: 'Walnut Creek, CA', fetchImpl: coolFetch })
  assert.match(label, /^mostly at home, the indoor temperature was not stated; time outside: brief, no set time — outdoors /)
  assert.match(label, /°F/)
  assert.equal(profile.isIndoor, true)
  assert.equal(profile.isCold, false, 'the look itself is not dressed for the outdoor reading')
  assert.ok(Number.isFinite(profile.transitLowF), 'the time outside keeps its reading')
})

test('an indoor slot with no time outside looks nothing up', async () => {
  const { label, profile } = await resolveSlotWeather(slotFor('indoor', 'none'), {
    dateRange, location: 'Walnut Creek, CA', fetchImpl: async () => { throw new Error('must not fetch') },
  })
  assert.equal(label, 'indoors, no time outside; the indoor temperature was not stated')
  assert.equal(profile.transitLowF, undefined)
})

test('time outside survives the persisted requirement-slot round trip, and the tool requires it', () => {
  assert.equal(restoreTripRequirementSlot(serializeTripRequirementSlot(slotFor('home', 'brief'))).timeOutside, 'brief')
  const items = STYLIST_TOOLS.find(tool => tool.name === 'plan_outfit_set').input_schema.properties.slots.items
  assert.ok(items.required.includes('time_outside'))
  assert.deepEqual(items.properties.time_outside.enum, ['none', 'brief', 'to_and_from'])
})
