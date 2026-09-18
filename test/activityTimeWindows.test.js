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

// ─── normalizePlanSlots: date inherits from the plan's date_range, and 'evening' occasion defaults
// its own time_window (thread_1789633862650) ────────────────────────────────────────────────────

// The plan_outfit_set schema's own `date` field description tells the model to "omit to inherit the
// plan date_range" -- the normal shape for a multi-day trip's activity slots, which describe a
// recurring use case (Winery Days, Nice Dinners) rather than one specific calendar day. Nothing
// actually performed that inheritance for the value resolveSlotWeather/resolveSlotTimeSensitivity
// key hourly resolution off: an omitted slot.date produced date: '' on the normalized slot, so both
// functions' `if (!day...)` guard fired unconditionally for every trip slot that followed the
// schema's own guidance -- hourly resolution and the materiality-driven clarification pause were
// both silently dead for exactly the shape a real multi-day trip takes.
test('normalizePlanSlots backfills date from the plan\'s date_range when a slot omits its own date', () => {
  const [slot] = normalizePlanSlots([{
    label: 'Nice Dinners', occasion: 'evening', activity: 'none', environment: 'indoor', count: 2,
  }], {
    dateRange: { start: '2026-09-19', end: '2026-09-22' },
    fallbackLocation: 'Paso Robles, CA',
  })
  assert.equal(slot.date, '2026-09-19', 'the trip\'s first day stands in, the same representative-day simplification tripSeasonEligiblePool already documents for calendar season')
})

test('normalizePlanSlots does not override a slot\'s own explicit date with the plan range', () => {
  const [slot] = normalizePlanSlots([{
    label: 'Nice Dinners', occasion: 'evening', activity: 'none', environment: 'indoor', count: 2, date: '2026-09-21',
  }], {
    dateRange: { start: '2026-09-19', end: '2026-09-22' },
  })
  assert.equal(slot.date, '2026-09-21')
})

// occasion: 'evening' is a structured field the model (or the label-based evening upgrade just above
// it in normalizePlanSlotOccasion) already declared -- reading it as evidence for the slot's own
// daypart is not the kind of prose inference the Activity Time Windows spec's "never inferred or
// defaulted by code" rule was written to forbid (owner correction, 2026-09-17). Deliberately narrow:
// only the literal 'evening' occasion defaults the literal 'evening' period; nothing else is inferred.
test('normalizePlanSlots defaults time_window to evening when the slot\'s own resolved occasion is evening', () => {
  const [slot] = normalizePlanSlots([{
    label: 'Nice Dinners', occasion: 'evening', activity: 'none', environment: 'indoor', count: 2,
  }], { dateRange: { start: '2026-09-19' } })
  assert.deepEqual(slot.timeWindow, { period: 'evening' })
})

test('normalizePlanSlots\' evening default also fires when the label alone upgrades occasion to evening (e.g. "casual" + "dinner")', () => {
  const [slot] = normalizePlanSlots([{
    label: 'Wine Country Dinners', occasion: 'casual', activity: 'none', environment: 'indoor', count: 2,
  }], { dateRange: { start: '2026-09-19' } })
  assert.equal(slot.occasion, 'evening')
  assert.deepEqual(slot.timeWindow, { period: 'evening' })
})

// The crux case: the plan_outfit_set schema's own occasion field carries a 2026-07-30 ratified
// rule -- "An ordinary restaurant dinner... is 'smart casual'... reserve 'evening' for genuinely
// dressier night-out use cases." normalizePlanSlotOccasion's upgrade only checks 'casual'/'city',
// never 'smart casual', so an ordinary Nice Dinners slot correctly following that ratified rule
// keeps occasion:'smart casual' -- and the evening default here is deliberately keyed on the
// slot's own label text (textLooksLikeEveningPlanSlot), not on its final resolved occasion, or this
// exact real-world case (an ordinary, correctly-occasioned vacation dinner) would be missed.
test('normalizePlanSlots\' evening default fires for an ordinary dinner correctly occasioned "smart casual" per the ratified occasion rule, independent of occasion', () => {
  const [slot] = normalizePlanSlots([{
    label: 'Nice Dinners', occasion: 'smart casual', activity: 'none', environment: 'indoor', count: 2,
  }], { dateRange: { start: '2026-09-19' } })
  assert.equal(slot.occasion, 'smart casual', 'occasion must NOT be silently escalated to evening -- that is a separate, ratified register decision')
  assert.deepEqual(slot.timeWindow, { period: 'evening' }, 'but timing still defaults from the label, since occasion and timing are different axes')
})

test('normalizePlanSlots never overrides an explicit time_window with the evening default', () => {
  const [slot] = normalizePlanSlots([{
    label: 'Nice Dinners', occasion: 'evening', activity: 'none', environment: 'indoor', count: 2,
    time_window: { period: 'midday' },
  }], { dateRange: { start: '2026-09-19' } })
  assert.deepEqual(slot.timeWindow, { period: 'midday' })
})

test('normalizePlanSlots does not default a time_window for a non-evening occasion', () => {
  const [slot] = normalizePlanSlots([{
    label: 'Museum', occasion: 'city', activity: 'none', environment: 'indoor', count: 1,
  }], { dateRange: { start: '2026-09-19' } })
  assert.equal(slot.timeWindow, null)
})

// End-to-end: the exact live incident's own shape, both fixes together -- date inherited from the
// plan range, occasion:'evening' defaulting its own time_window, and the hourly path now resolving
// an indoor slot's TRANSIT numbers instead of skipping straight to the flat daily envelope.
test('the live Paso Robles Nice Dinners slot resolves its own evening transit temperature end to end, with no explicit slot date and no stated time_window', async () => {
  const fetchImpl = makeMockHourlyFetch({
    date: '2026-09-19',
    hours: { 8: 65, 9: 68, 10: 70, 11: 72, 12: 88, 13: 91, 14: 93, 15: 95, 16: 92, 17: 65, 18: 60, 19: 57, 20: 55 },
  })
  const [slot] = normalizePlanSlots([{
    label: 'Nice Dinners', occasion: 'evening', activity: 'none', environment: 'indoor', count: 2,
  }], {
    dateRange: { start: '2026-09-19', end: '2026-09-22' },
    fallbackLocation: 'Paso Robles, CA',
  })
  const { profile, label } = await resolveSlotWeather(slot, { location: 'Paso Robles, CA', fetchImpl })
  assert.equal(profile.isIndoor, true)
  assert.equal(profile.weatherSource, 'live_hourly')
  assert.equal(profile.transitHighF, 65, 'the evening window\'s own high, not the day\'s 95°F afternoon peak')
  assert.equal(profile.transitLowF, 55)
  assert.equal(profile.transitNeedsRemovableCoolLayer, true)
  assert.match(label, /indoor; transit:.*live hourly forecast/)
})

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

// thread_1789633862650: an earlier version of this test asserted indoor slots never use the hourly
// path at all, on the reasoning "an indoor destination's base is climate-controlled -- time_window
// only ever concerns actual outdoor exposure." That reasoning conflated the BASE (genuinely climate-
// controlled) with the TRANSIT (genuinely outdoor, and exactly what hourly slicing exists to
// resolve) -- a live Nice Dinners slot inherited the day's full 95°F/55°F envelope as its transit
// temperature instead of the real ~55-65°F evening window as a direct result. The corrected
// contract: an indoor slot's BASE still reads permissive/climate-controlled (isCold: false), while
// its transit* fields now use the real hourly-sliced numbers, same as any outdoor slot's base would.
test('resolveSlotWeather uses the hourly path for an indoor slot\'s TRANSIT numbers when a time_window is stated', async () => {
  const fetchImpl = makeMockHourlyFetch({
    date: '2026-09-19',
    hours: { 8: 65, 9: 68, 10: 70, 11: 72, 14: 95, 15: 93, 18: 60, 19: 57, 20: 55 },
  })
  const [slot] = normalizePlanSlots([{
    label: 'Nice Dinners', occasion: 'evening', activity: 'none', environment: 'indoor',
    date: '2026-09-19', location: 'Paso Robles, CA', time_window: { period: 'evening' },
  }])
  const { profile, label } = await resolveSlotWeather(slot, { location: 'Paso Robles, CA', fetchImpl })
  assert.equal(profile.isIndoor, true)
  assert.equal(profile.isCold, false, 'the base stays climate-controlled/permissive regardless of the transit temperature')
  assert.equal(profile.weatherSource, 'live_hourly')
  assert.equal(profile.transitHighF, 60, 'the evening window\'s own high, not the day\'s 95°F afternoon spike')
  assert.equal(profile.transitLowF, 55)
  assert.equal(profile.transitNeedsRemovableCoolLayer, true)
  assert.match(label, /indoor; transit:.*live hourly forecast/)
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

test('resolveSlotTimeSensitivity: an active coastal hike with a comfortable 55°F to 69°F swing is not material', async () => {
  const fetchImpl = makeMockHourlyFetch({
    date: '2026-09-19',
    hours: { 8: 55, 11: 62, 12: 67, 14: 69, 17: 64, 20: 58 },
  })
  const [slot] = normalizePlanSlots([{
    label: 'Coastal Hike', occasion: 'casual', activity: 'hiking', environment: 'outdoor',
    date: '2026-09-19', location: 'Pismo Beach, CA',
  }])
  const result = await resolveSlotTimeSensitivity(slot, { location: 'Pismo Beach, CA', fetchImpl })
  assert.equal(result.status, 'not_material')
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

// thread_1789633862650: an indoor destination excuses the BASE, never the TRANSIT -- an earlier
// version of this test asserted indoor slots are "never material regardless of the outdoor swing",
// which is what let a real Nice Dinners slot (53°F evening transit vs a 95°F daytime peak) inherit
// the flat trip envelope silently instead of asking the user roughly when the outing happens. This
// modest swing genuinely does NOT clear the 2-level transit threshold -- that guarantee is real and
// worth keeping -- but it is a property of THESE numbers, not of "indoor" as a category. See the
// next test for the same slot shape with a genuinely material transit swing.
test('resolveSlotTimeSensitivity: an indoor slot with only a modest outdoor swing stays not_material', async () => {
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

// occasion: 'city' rather than 'evening' -- an 'evening' occasion now defaults its own time_window
// (see normalizePlanSlots' amendment below), which would make this slot ineligible for the
// materiality check in the first place (nothing left to disambiguate once time_window is set). This
// isolates the isIndoor-aware materiality logic itself, independent of that separate default.
test('resolveSlotTimeSensitivity: an indoor slot IS material when its genuine transit swing crosses the threshold (the live incident\'s own shape)', async () => {
  const fetchImpl = makeMockHourlyFetch({
    date: '2026-09-19',
    // Morning 65-72°F, afternoon 88-95°F, evening 55-65°F -- the reported Paso Robles shape. The
    // destination (a restaurant) is climate-controlled either way; the walk there and back is not.
    hours: { 8: 65, 9: 68, 10: 70, 11: 72, 12: 88, 13: 91, 14: 93, 15: 95, 16: 92, 17: 65, 18: 60, 19: 57, 20: 55 },
  })
  const [slot] = normalizePlanSlots([{
    label: 'Gallery Visit', occasion: 'city', activity: 'none', environment: 'indoor',
    date: '2026-09-19', location: 'Paso Robles, CA',
  }])
  const result = await resolveSlotTimeSensitivity(slot, { location: 'Paso Robles, CA', fetchImpl })
  assert.equal(result.status, 'material')
  assert.match(result.divergenceReason, /thermal demand spans/)
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
