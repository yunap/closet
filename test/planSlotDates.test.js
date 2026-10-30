// A coordinated plan's slot states the days it happens, and gets one look per day (2026-10-30).
// Both runs of "guests staying from today through Sunday … outfits for the mornings"
// (thread_1793331707106, thread_1793331990443) planned three mornings with count 2, with the
// no-rotation sentence in the tool description in front of them.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-slot-dates-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { normalizePlanSlots } = await import('../styling-engine/outfitSetPlanner.js')
const { STYLIST_TOOLS } = await import('../styling-engine/tools.js')
const planOutfitSetSlotSchema = () => STYLIST_TOOLS.find(entry => entry.name === 'plan_outfit_set')?.input_schema?.properties?.slots?.items || {}
const { tripRosterSelectionUserText } = await import('../routes/ai.js')

const dateRange = { start: '2026-10-29', end: '2026-11-01' }
const normalize = (slots, planKind = 'coordinated_plan') => normalizePlanSlots(slots, { dateRange, planKind, fallbackLocation: 'Walnut Creek, CA' })

test('a coordinated-plan slot gets one look per date it states, and count does not override it', () => {
  const [mornings] = normalize([{
    label: 'Mornings at Home', occasion: 'casual', activity: 'none', environment: 'home', count: 2,
    dates: ['2026-10-31', '2026-10-30', '2026-11-01', '2026-10-30'],
  }])
  assert.equal(mornings.targetOutfits, 3)
  assert.deepEqual(mornings.dates, ['2026-10-30', '2026-10-31', '2026-11-01'], 'deduplicated and in order')
  assert.equal(mornings.requestedOutfits, undefined)
})

test('dates outside the plan or not real dates do not count', () => {
  const [slot] = normalize([{ label: 'Outings', occasion: 'city', activity: 'walking', count: 1, dates: ['2026-11-05', 'Saturday', '2026-10-30'] }])
  assert.deepEqual(slot.dates, ['2026-10-30'])
  assert.equal(slot.targetOutfits, 1)
})

test('a slot on one date is dated to it, so it takes that day\'s weather', () => {
  const [dinner] = normalize([{ label: 'Saturday Dinner', occasion: 'smart casual', activity: 'none', environment: 'indoor', dates: ['2026-10-31'] }])
  assert.equal(dinner.date, '2026-10-31')
  assert.equal(dinner.dateInherited, false)
})

test('more days than one use case shows: three looks, and the shortfall is recorded', () => {
  const [slot] = normalizePlanSlots([{
    label: 'Mornings at Home', occasion: 'casual', activity: 'none', environment: 'home',
    dates: ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'],
  }], { dateRange, planKind: 'coordinated_plan' })
  assert.equal(slot.targetOutfits, 3)
  assert.equal(slot.requestedOutfits, 4)
})

test('the plan total trim keeps a larger day count it already recorded', () => {
  const slots = normalizePlanSlots([
    { label: 'Mornings', occasion: 'casual', activity: 'none', environment: 'home', dates: ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'] },
    { label: 'Outings', occasion: 'city', activity: 'walking', count: 3 },
  ], { dateRange, planKind: 'coordinated_plan', maxTotalOutfits: 4 })
  assert.equal(slots[1].targetOutfits, 1)
  assert.equal(slots[0].requestedOutfits, 4)
})

test('without dates, or outside a coordinated plan, count works as before', () => {
  assert.equal(normalize([{ label: 'Hosting', occasion: 'casual', activity: 'none', count: 2 }])[0].targetOutfits, 2)
  const [trip] = normalize([{ label: 'Winery Days', occasion: 'casual', activity: 'walking', count: 2, dates: ['2026-10-29', '2026-10-30', '2026-10-31'] }], 'trip')
  assert.equal(trip.targetOutfits, 2)
  assert.equal(trip.dates, undefined)
})

test('the slot schema offers dates, and the shortlist sees a slot\'s days', () => {
  assert.equal(planOutfitSetSlotSchema().properties.dates.type, 'array')
  const slots = normalize([{ label: 'Mornings at Home', occasion: 'casual', activity: 'none', environment: 'home', dates: ['2026-10-30', '2026-10-31', '2026-11-01'] }])
  const text = tripRosterSelectionUserText({ bench: [], slots, dateRange, planKind: 'coordinated_plan' })
  assert.match(text, /Mornings at Home \([^)]*2026-10-30, 2026-10-31, 2026-11-01[^)]*\) — up to 3 outfits/)
})
