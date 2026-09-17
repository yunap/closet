// Activity time windows & material exposure sensitivity (spec 2026-09-17). Extends the trip planner
// so an outdoor slot's stated/inferred time_window resolves against genuinely sampled hourly weather
// (not the day's full envelope or the waking-window estimate derived from it), and a slot with NO
// stated time_window gets checked for whether the omission creates material physical uncertainty
// (a >=2-level PET shift, a precipitation divergence, or a severe-cold-requirement divergence across
// the three canonical dayparts) before any roster or card is composed.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-time-windows-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { db } = await import('../db.js')
const { executeTool } = await import('../styling-engine/tools.js')
const { resolveSlotTimeSensitivity, resolveSlotWeather, normalizePlanSlots } = await import('../styling-engine/outfitSetPlanner.js')
const { _clearWeatherCachesForTests } = await import('../styling-engine/weather.js')

// Same mock-hourly-fetch shape as test/weather.test.js, duplicated locally (that file isolates its
// own DB path before any import resolves, so importing its helper here would risk import-order
// hazards per docs/database-safety.md).
function makeMockHourlyFetch({ date = '2026-09-19', hours = {}, defaultTemp = 60, rainHours = [], geocodeFails = false } = {}) {
  const times = []
  const temps = []
  const precip = []
  for (let h = 0; h < 24; h += 1) {
    times.push(`${date}T${String(h).padStart(2, '0')}:00`)
    temps.push(Number.isFinite(hours[h]) ? hours[h] : defaultTemp)
    precip.push(rainHours.includes(h) ? 1.2 : 0)
  }
  const dailyHigh = Math.max(...temps)
  const dailyLow = Math.min(...temps)
  return async url => {
    if (url.includes('geocoding-api')) {
      return geocodeFails
        ? { ok: true, json: async () => ({ results: [] }) }
        : { ok: true, json: async () => ({ results: [{ latitude: 39.74, longitude: -104.99 }] }) }
    }
    // plan_outfit_set's own always-on weather pre-check (tools.js) resolves the ordinary DAILY
    // range for every slot regardless of time_window -- this mock must answer both query shapes
    // against the same underlying hours, or that pre-check sees no data and stops the call before
    // resolveSlotTimeSensitivity's hourly-only comparison ever runs.
    if (url.includes('hourly=')) {
      return { ok: true, json: async () => ({ hourly: { time: times, temperature_2m: temps, precipitation: precip } }) }
    }
    return { ok: true, json: async () => ({ daily: { temperature_2m_max: [dailyHigh], temperature_2m_min: [dailyLow] } }) }
  }
}

function insertPiece(overrides = {}) {
  const piece = {
    name: 'test piece', category: 'top', colors: [], occasions: ['casual', 'city', 'outdoor'],
    season: 'year-round', notes: '', status: 'active', recommendation_status: 'trusted',
    fit_confidence: 'high', role_permission: 'auto', occasion_permissions: [], engine_notes: '',
    photo: null, worn_photo: null, pattern_type: 'solid', pattern_scale: 'none',
    pattern_complexity: 'solid', reads_as: '', silhouette: '', fabric_category: '',
    fabric_weight: 'light', fiber_content: [], formality: 'everyday', sleeve_length: '',
    length_hits_at: '', heel_height: null, walk_support: null, toe_shape: null, shoe_type: null,
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
    ...overrides,
  }
  return db.prepare(`
    INSERT INTO pieces (
      name, category, colors, occasions, season, notes, status,
      recommendation_status, fit_confidence, role_permission, occasion_permissions,
      engine_notes, photo, worn_photo, pattern_type, pattern_scale,
      pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content,
      formality, sleeve_length, length_hits_at, heel_height, walk_support, toe_shape, shoe_type, style_profile_json
    ) VALUES (
      @name, @category, @colors, @occasions, @season, @notes, @status,
      @recommendation_status, @fit_confidence, @role_permission, @occasion_permissions,
      @engine_notes, @photo, @worn_photo, @pattern_type, @pattern_scale,
      @pattern_complexity, @reads_as, @silhouette, @fabric_category, @fabric_weight, @fiber_content,
      @formality, @sleeve_length, @length_hits_at, @heel_height, @walk_support, @toe_shape, @shoe_type, @style_profile_json
    )
  `).run({
    ...piece,
    colors: JSON.stringify(piece.colors),
    occasions: JSON.stringify(piece.occasions),
    occasion_permissions: JSON.stringify(piece.occasion_permissions),
    fiber_content: JSON.stringify(piece.fiber_content),
    style_profile_json: JSON.stringify(piece.style_profile_json),
  }).lastInsertRowid
}

test.beforeEach(() => { _clearWeatherCachesForTests() })

// ─── resolveSlotWeather: explicit time_window resolves hourly (spec Test 1) ────────────────────

test('resolveSlotWeather resolves an explicit time_window against sliced hourly data, not the day\'s full envelope', async () => {
  const fetchImpl = makeMockHourlyFetch({
    date: '2026-09-19',
    hours: { 8: 58, 9: 60, 10: 63, 11: 66, 12: 78, 13: 88, 14: 94, 15: 92, 16: 85 },
  })
  const [slot] = normalizePlanSlots([{
    label: 'Mountain Hike', occasion: 'casual', activity: 'hiking', environment: 'outdoor',
    date: '2026-09-19', location: 'Denver, CO', time_window: { period: 'morning' },
  }])
  const { profile, label } = await resolveSlotWeather(slot, { location: 'Denver, CO', fetchImpl })
  assert.equal(profile.weatherSource, 'live_hourly')
  assert.equal(profile.highF, 66, 'the morning window\'s own high, not the day\'s 94°F afternoon spike')
  assert.equal(profile.lowF, 58)
  assert.equal(profile.resolvedWeatherContext.temperature.source, 'live_hourly')
  assert.match(label, /live hourly forecast/)
})

test('resolveSlotWeather falls back to the ordinary daily/waking-window path when a slot has no time_window', async () => {
  const fetchImpl = makeMockHourlyFetch({ date: '2026-09-19', hours: { 12: 90 } })
  const [slot] = normalizePlanSlots([{
    label: 'Mountain Hike', occasion: 'casual', activity: 'hiking', environment: 'outdoor',
    date: '2026-09-19', location: 'Denver, CO',
  }])
  const { profile } = await resolveSlotWeather(slot, { location: 'Denver, CO', fetchImpl })
  assert.notEqual(profile.weatherSource, 'live_hourly', 'no time_window means no hourly slicing -- this must be a pure no-op for every slot that doesn\'t opt in')
})

test('resolveSlotWeather does not use the hourly path for an indoor slot even with a stated time_window', async () => {
  const fetchImpl = makeMockHourlyFetch({ date: '2026-09-19', hours: { 12: 90 } })
  const [slot] = normalizePlanSlots([{
    label: 'Museum', occasion: 'city', activity: 'none', environment: 'indoor',
    date: '2026-09-19', location: 'Denver, CO', time_window: { period: 'midday' },
  }])
  const { profile } = await resolveSlotWeather(slot, { location: 'Denver, CO', fetchImpl })
  assert.notEqual(profile.weatherSource, 'live_hourly', 'an indoor destination\'s base is climate-controlled -- time_window only ever concerns actual outdoor exposure')
})

// ─── resolveSlotTimeSensitivity: the materiality verdict (spec §6, Tests 2-5) ──────────────────

test('resolveSlotTimeSensitivity: an 89°F/35°F diurnal swing is material (the stress test)', async () => {
  // Hiking's exertion discount (EXERTION_SHIFT.hiking = -2) suppresses the PET-band shift at
  // milder ranges -- a genuinely cold mountain-morning low is needed to clear the 2-level
  // threshold even after the discount (verified against the real thermal model, not asserted).
  const fetchImpl = makeMockHourlyFetch({
    date: '2026-09-19',
    hours: { 9: 35, 10: 37, 11: 40, 14: 89, 15: 87, 18: 55, 19: 52 },
  })
  const [slot] = normalizePlanSlots([{
    label: 'Mountain Hike', occasion: 'casual', activity: 'hiking', environment: 'outdoor',
    date: '2026-09-19', location: 'Denver, CO',
  }])
  const result = await resolveSlotTimeSensitivity(slot, { location: 'Denver, CO', fetchImpl })
  assert.equal(result.status, 'material')
  assert.match(result.divergenceReason, /thermal demand spans/)
  assert.ok(result.evidence.morning && result.evidence.afternoon && result.evidence.evening)
})

test('resolveSlotTimeSensitivity: a 70°F/60°F swing is not material (normal clothing flexibility covers it)', async () => {
  const fetchImpl = makeMockHourlyFetch({
    date: '2026-09-19',
    hours: { 9: 60, 10: 61, 11: 62, 14: 70, 15: 69, 18: 65, 19: 64 },
  })
  const [slot] = normalizePlanSlots([{
    label: 'City Walk', occasion: 'city', activity: 'walking', environment: 'outdoor',
    date: '2026-09-19', location: 'Denver, CO',
  }])
  const result = await resolveSlotTimeSensitivity(slot, { location: 'Denver, CO', fetchImpl })
  assert.equal(result.status, 'not_material')
})

test('resolveSlotTimeSensitivity: an indoor slot is never material regardless of the outdoor swing', async () => {
  const fetchImpl = makeMockHourlyFetch({
    date: '2026-09-19',
    hours: { 9: 50, 14: 88 },
  })
  const [slot] = normalizePlanSlots([{
    label: 'Museum', occasion: 'city', activity: 'none', environment: 'indoor',
    date: '2026-09-19', location: 'Denver, CO',
  }])
  const result = await resolveSlotTimeSensitivity(slot, { location: 'Denver, CO', fetchImpl })
  assert.equal(result.status, 'not_material')
})

test('resolveSlotTimeSensitivity: a slot that already states its own time_window has nothing left to disambiguate', async () => {
  const fetchImpl = makeMockHourlyFetch({ date: '2026-09-19', hours: { 9: 55, 14: 89 } })
  const [slot] = normalizePlanSlots([{
    label: 'Mountain Hike', occasion: 'casual', activity: 'hiking', environment: 'outdoor',
    date: '2026-09-19', location: 'Denver, CO', time_window: { period: 'morning' },
  }])
  const result = await resolveSlotTimeSensitivity(slot, { location: 'Denver, CO', fetchImpl })
  assert.equal(result.status, 'not_material')
})

test('resolveSlotTimeSensitivity: no hourly coverage (far-term trip) degrades to unknown, never fabricates a verdict', async () => {
  const noHourly = async url => (url.includes('geocoding-api')
    ? { ok: true, json: async () => ({ results: [{ latitude: 1, longitude: 1 }] }) }
    : { ok: false })
  const [slot] = normalizePlanSlots([{
    label: 'Mountain Hike', occasion: 'casual', activity: 'hiking', environment: 'outdoor',
    date: '2099-01-01', location: 'Denver, CO',
  }])
  const result = await resolveSlotTimeSensitivity(slot, { location: 'Denver, CO', fetchImpl: noHourly })
  assert.equal(result.status, 'unknown')
})

test('resolveSlotTimeSensitivity: a precipitation divergence alone is material even at a stable thermal band', async () => {
  const fetchImpl = makeMockHourlyFetch({
    date: '2026-09-19',
    hours: { 9: 62, 10: 62, 14: 64, 15: 64, 18: 61, 19: 61 },
    rainHours: [18, 19],
  })
  const [slot] = normalizePlanSlots([{
    label: 'Coastal Walk', occasion: 'casual', activity: 'walking', environment: 'outdoor',
    date: '2026-09-19', location: 'Denver, CO',
  }])
  const result = await resolveSlotTimeSensitivity(slot, { location: 'Denver, CO', fetchImpl })
  assert.equal(result.status, 'material')
  assert.match(result.divergenceReason, /rain is expected/)
})

// ─── The conversational seam: plan_outfit_set pauses before composing (spec §7) ────────────────

test('plan_outfit_set returns clarification_recommended and never calls the roster chooser when a slot is materially time-sensitive', async () => {
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'trail top' })
  insertPiece({ category: 'bottom', name: 'trail pants' })
  insertPiece({ category: 'shoes', name: 'trail shoes', heel_height: 'flat', walk_support: 'high' })

  const fetchImpl = makeMockHourlyFetch({
    date: '2026-09-19',
    hours: { 9: 35, 10: 37, 14: 89, 15: 87, 18: 55 },
  })
  let chooseTripRosterCalled = false
  const toolContext = {
    declaredIntent: { want: 'cards' },
    generatedOutfits: [],
    question: 'a hike in Denver',
    location: 'Denver, CO',
    weatherFetchImpl: fetchImpl,
    chooseTripRoster: async () => { chooseTripRosterCalled = true; return { roster_piece_ids: [] } },
  }
  const result = await executeTool('plan_outfit_set', {
    plan_kind: 'trip',
    slots: [{ label: 'Mountain Hike', occasion: 'casual', activity: 'hiking', environment: 'outdoor', date: '2026-09-19', count: 1 }],
  }, toolContext)

  assert.equal(result.status, 'clarification_recommended')
  assert.equal(result.reason, 'material_time_sensitivity')
  assert.equal(result.slot, 'Mountain Hike')
  assert.match(result.message, /ONE natural, concise question/)
  assert.equal(chooseTripRosterCalled, false, 'no roster selection call may run before the user answers -- that is the entire point of pausing here')
  assert.deepEqual(toolContext.generatedOutfits, [])
})

test('plan_outfit_set proceeds normally through all phases once the slot carries an answered time_window', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'trail top' })
  const bottomId = insertPiece({ category: 'bottom', name: 'trail pants' })
  const shoeId = insertPiece({ category: 'shoes', name: 'trail shoes', heel_height: 'flat', walk_support: 'high' })
  // The morning window's own low (55°F) is under COOL_LOW_F, so the roster-level cold-layer check
  // now correctly requires a qualifying layer for this slot -- a real consequence of resolving
  // against the sliced hourly window instead of the day's full envelope, not a test artifact.
  insertPiece({ category: 'outerwear', name: 'trail jacket', fabric_weight: 'heavy' })

  const fetchImpl = makeMockHourlyFetch({
    date: '2026-09-19',
    hours: { 9: 55, 10: 56, 14: 89, 15: 87, 18: 68 },
  })
  const toolContext = {
    declaredIntent: { want: 'cards' },
    generatedOutfits: [],
    question: 'a morning hike in Denver',
    location: 'Denver, CO',
    weatherFetchImpl: fetchImpl,
    chooseTripRoster: async ({ bench }) => ({ roster_piece_ids: bench.map(p => Number(p.id)) }),
    composeTripPlanOnce: async workbench => [{
      slot_id: workbench.slots[0].id, piece_ids: [topId, bottomId, shoeId], title: 'Morning Trail Look', reason: 'r'
    }],
  }
  const result = await executeTool('plan_outfit_set', {
    plan_kind: 'trip',
    slots: [{
      label: 'Mountain Hike', occasion: 'casual', activity: 'hiking', environment: 'outdoor',
      date: '2026-09-19', count: 1, time_window: { period: 'morning' },
    }],
  }, toolContext)

  assert.equal(result.status, 'success', 'an answered time_window resolves the ambiguity -- composition must proceed on the same turn')
  assert.equal(toolContext.generatedOutfits.length, 1)
})

test('plan_outfit_set proceeds normally when no slot is materially time-sensitive (moderate swing, no clarification)', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'city top' })
  const bottomId = insertPiece({ category: 'bottom', name: 'city bottom' })
  const shoeId = insertPiece({ category: 'shoes', name: 'city shoes', heel_height: 'flat', walk_support: 'high' })
  // The estimated waking low for this 60/70°F range still sits under COOL_LOW_F, so the roster
  // needs a qualifying layer even though the swing itself is not material enough to pause on.
  insertPiece({ category: 'outerwear', name: 'city jacket', fabric_weight: 'heavy' })

  const fetchImpl = makeMockHourlyFetch({
    date: '2026-09-19',
    hours: { 9: 60, 14: 70, 18: 64 },
  })
  const toolContext = {
    declaredIntent: { want: 'cards' },
    generatedOutfits: [],
    question: 'a walk around the city',
    location: 'Denver, CO',
    weatherFetchImpl: fetchImpl,
    chooseTripRoster: async ({ bench }) => ({ roster_piece_ids: bench.map(p => Number(p.id)) }),
    composeTripPlanOnce: async workbench => [{
      slot_id: workbench.slots[0].id, piece_ids: [topId, bottomId, shoeId], title: 'City Walk Look', reason: 'r'
    }],
  }
  const result = await executeTool('plan_outfit_set', {
    plan_kind: 'trip',
    slots: [{ label: 'City Walk', occasion: 'city', activity: 'walking', environment: 'outdoor', date: '2026-09-19', count: 1 }],
  }, toolContext)

  assert.equal(result.status, 'success')
  assert.equal(toolContext.generatedOutfits.length, 1)
})
