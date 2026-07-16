// Step 6 (plan_outfit_set): the trip precompose's slot engine extracted into
// styling-engine/outfitSetPlanner.js and exposed as a model-callable tool.
// Covers: slot normalization (tool args → engine slots, outfit cap), the
// declared-intent gate, card/plan-line production with source
// 'plan_outfit_set', source locking, and cross-slot piece-reuse bookkeeping
// (no duplicate outfit keys within a set).

import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-plan-set-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { db } = await import('../db.js')
const { STYLIST_TOOLS, executeTool, sanitizePlanConstraintsForQuestion, coercePlanOutfitSetSlotsArg } = await import('../styling-engine/tools.js')
const { normalizePlanSlots, normalizePlanConstraints, selectCapsuleRoster, buildPlanSlotWorkbench, validateSubmittedPlanOutfits, assembleSubmittedPlanOutfits, describeOutfitStructureGap, PLAN_TOTAL_OUTFIT_CAP, planTotalOutfitCapForBudget } = await import('../styling-engine/outfitSetPlanner.js')
const { _clearWeatherCachesForTests } = await import('../styling-engine/weather.js')
const { parsePiece } = await import('../styling-engine/rules.js')
const { wardrobeCategoryGroup } = await import('../styling-engine/attributes.js')

// db.js's `dotenv/config` import (triggered above) fills in any env var not
// already set by this file — including WARDROBE_PLAN_COMPOSE from a local
// .env left in model mode for live testing. Force a known baseline so this
// suite's engine-mode tests are hermetic regardless of the developer's local
// environment or the process-wide default (spec 19 Part 4 flipped the
// default to 'model'); tests that specifically want model mode still set it
// themselves via the previousMode save/restore pattern below.
process.env.WARDROBE_PLAN_COMPOSE = 'engine'

const topIdsOf = outfits => outfits.flatMap(outfit => (outfit.pieces || []).filter(piece => wardrobeCategoryGroup(piece) === 'top').map(piece => Number(piece.id)))
const distinctPieceCount = outfits => new Set(outfits.flatMap(outfit => outfit.pieceIds || [])).size

function planOutfitSetSlotSchema() {
  const tool = STYLIST_TOOLS.find(entry => entry.name === 'plan_outfit_set')
  return tool?.input_schema?.properties?.slots?.items || {}
}

// A fetchImpl (injected the same way weather.test.js does) that returns a hot
// inland forecast for everything EXCEPT a coastal town, which comes back mild —
// the Paso-Robles-coast microclimate the per-slot weather work exists to catch.
function makePlanFetch() {
  let calls = 0
  const fetchImpl = async (url) => {
    calls += 1
    if (url.includes('geocoding-api')) {
      const isCoast = /cambria/.test(url)
      const coords = isCoast ? { latitude: 35.56, longitude: -121.08 } : { latitude: 35.63, longitude: -120.69 }
      return { ok: true, json: async () => ({ results: [coords] }) }
    }
    const isCoast = /latitude=35\.56/.test(url)
    const daily = isCoast
      ? { temperature_2m_max: [62], temperature_2m_min: [52] } // mild coast
      : { temperature_2m_max: [94], temperature_2m_min: [66] } // hot inland
    return { ok: true, json: async () => ({ daily }) }
  }
  fetchImpl.callCount = () => calls
  return fetchImpl
}

after(() => {
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

beforeEach(() => {
  db.prepare('DELETE FROM pieces').run()
  seedWardrobe()
})

test('plan_outfit_set slot schema declares environment and requires activity', () => {
  const schema = planOutfitSetSlotSchema()
  assert.deepEqual(schema.properties.environment.enum, ['indoor', 'outdoor', 'beach_coastal'])
  assert.ok(schema.required.includes('activity'))
  const submitTool = STYLIST_TOOLS.find(entry => entry.name === 'submit_plan_outfits')
  assert.ok(submitTool, 'submit_plan_outfits tool must exist for model-composition mode')
})

// Part 3 (spec 18): the live bad call was `slots: "[ {...} ],\n\"location\":
// \"Paso Robles, CA\", ..."` — the model flattened the WHOLE remaining args
// object into the slots string instead of sending a real array.
test('coercePlanOutfitSetSlotsArg recovers the verbatim live string into an array plus sibling keys', () => {
  const rawSlots = '[ { "label": "City Day", "occasion": "city", "activity": "walking", "count": 1 } ],\n"location": "Paso Robles, CA", "date_range": {"start": "2026-08-01", "end": "2026-08-03"}'
  const recovered = coercePlanOutfitSetSlotsArg(rawSlots)
  assert.ok(recovered, 'the flattened live shape must recover')
  assert.equal(recovered.slots.length, 1)
  assert.equal(recovered.slots[0].label, 'City Day')
  assert.equal(recovered.extra.location, 'Paso Robles, CA')
  assert.deepEqual(recovered.extra.date_range, { start: '2026-08-01', end: '2026-08-03' })
})

test('coercePlanOutfitSetSlotsArg passes a proper array straight through untouched', () => {
  assert.equal(coercePlanOutfitSetSlotsArg([{ label: 'City Day' }]), null, 'only strings are coerced; a real array is not this function\'s job')
  const recovered = coercePlanOutfitSetSlotsArg('[{"label":"City Day","occasion":"city","activity":"none","count":1}]')
  assert.ok(recovered)
  assert.deepEqual(recovered.slots, [{ label: 'City Day', occasion: 'city', activity: 'none', count: 1 }])
  assert.deepEqual(recovered.extra, {})
})

test('coercePlanOutfitSetSlotsArg returns null for an unrecoverable string', () => {
  assert.equal(coercePlanOutfitSetSlotsArg('not json at all'), null)
  assert.equal(coercePlanOutfitSetSlotsArg('{"not":"an array"}'), null)
})

test('plan_outfit_set recovers a flattened-string slots arg end to end and lets an explicitly-passed arg win over the recovered sibling', async () => {
  const rawSlots = '[ { "label": "City Day", "occasion": "city", "activity": "none", "count": 1 } ],\n"location": "Paso Robles, CA"'
  const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'one city day outfit' }
  const result = await executeTool('plan_outfit_set', {
    slots: rawSlots,
    location: 'Cambria, CA' // explicitly passed — must win over the recovered "Paso Robles, CA"
  }, toolContext)

  assert.notEqual(result.status, 'validation_error', `expected the string to recover into slots, got ${JSON.stringify(result)}`)
  assert.equal(result.status, 'slot_rosters')
  assert.equal(toolContext.pendingPlan.slots[0].label, 'City Day')

  const ids = idsForSlot(toolContext.pendingPlan.slots[0])
  const submitted = await executeTool('submit_plan_outfits', {
    outfits: [{
      slot_id: toolContext.pendingPlan.slots[0].id,
      piece_ids: [ids.get('top'), ids.get('bottom'), ids.get('shoes')],
    }]
  }, toolContext)

  assert.equal(submitted.status, 'success')
  assert.equal(toolContext.generatedOutfits.length, 1)
  assert.equal(toolContext.generatedOutfits[0].label, 'City Day')
})

function idsForSlot(slot = {}, offset = 0) {
  const byGroup = new Map()
  for (const piece of slot.allowedPieces || []) {
    const group = wardrobeCategoryGroup(piece)
    if (!byGroup.has(group)) byGroup.set(group, [])
    byGroup.get(group).push(Number(piece.id))
  }
  return new Map([...byGroup.entries()].map(([group, ids]) => [group, ids[Math.min(offset, ids.length - 1)]]))
}

test('plan_outfit_set model mode returns slot rosters and submit_plan_outfits creates cards', async () => {
  const previousMode = process.env.WARDROBE_PLAN_COMPOSE
  process.env.WARDROBE_PLAN_COMPOSE = 'model'
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'model mode cotton top', occasions: ['city', 'casual'], formality: 'everyday' })
  insertPiece({ category: 'bottom', name: 'model mode cotton pants', occasions: ['city', 'casual'], formality: 'everyday' })
  insertPiece({ category: 'shoes', name: 'model mode walking shoes', occasions: ['city', 'casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  try {
    const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'one city day outfit' }
    const workbench = await executeTool('plan_outfit_set', {
      slots: [{ label: 'City Day', occasion: 'city', activity: 'none', count: 1 }]
    }, toolContext)

    assert.equal(workbench.status, 'slot_rosters')
    assert.equal(toolContext.pendingPlan?.mode, 'model')
    assert.ok(workbench.piece_catalog.some(line => /ID \d+/.test(line)))
    assert.ok(workbench.slots[0].allowed_piece_ids.length > 0)
    assert.equal(workbench.slots[0].allowed_pieces, undefined)

    const ids = idsForSlot(toolContext.pendingPlan.slots[0])
    const submitted = await executeTool('submit_plan_outfits', {
      outfits: [{
        slot_id: toolContext.pendingPlan.slots[0].id,
        piece_ids: [ids.get('top'), ids.get('bottom'), ids.get('shoes')],
        title: 'Model Picked City Day',
        reason: 'A simple complete city formula.'
      }]
    }, toolContext)

    assert.equal(submitted.status, 'success')
    assert.equal(toolContext.pendingPlan, null)
    assert.equal(toolContext.source, 'plan_outfit_set')
    assert.equal(toolContext.sourceLocked, true)
    assert.equal(toolContext.generatedOutfits.length, 1)
    assert.equal(toolContext.generatedOutfits[0].source, 'plan_outfit_set')
    assert.equal(toolContext.generatedOutfits[0].composedBy, 'model')
    assert.equal(toolContext.generatedOutfits[0].label, 'City Day')
  } finally {
    if (previousMode === undefined) delete process.env.WARDROBE_PLAN_COMPOSE
    else process.env.WARDROBE_PLAN_COMPOSE = previousMode
  }
})

// --- Mode default flip (spec 19 Part 4) ----------------------------------------

test('plan_outfit_set defaults to model mode with no WARDROBE_PLAN_COMPOSE set', async () => {
  const previousMode = process.env.WARDROBE_PLAN_COMPOSE
  delete process.env.WARDROBE_PLAN_COMPOSE
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'default mode top', occasions: ['city', 'casual'], formality: 'everyday' })
  insertPiece({ category: 'bottom', name: 'default mode pants', occasions: ['city', 'casual'], formality: 'everyday' })
  insertPiece({ category: 'shoes', name: 'default mode shoes', occasions: ['city', 'casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  try {
    const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'one city day outfit' }
    const workbench = await executeTool('plan_outfit_set', {
      slots: [{ label: 'City Day', occasion: 'city', activity: 'none', count: 1 }]
    }, toolContext)

    assert.equal(workbench.status, 'slot_rosters', 'no env var set should default to model mode')
  } finally {
    if (previousMode === undefined) delete process.env.WARDROBE_PLAN_COMPOSE
    else process.env.WARDROBE_PLAN_COMPOSE = previousMode
  }
})

test('model plan slot workbench reports suppressed pieces from the generation gates', async () => {
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'hot day top', occasions: ['casual'], formality: 'everyday', fabric_weight: 'light' })
  insertPiece({ category: 'bottom', name: 'hot day pants', occasions: ['casual'], formality: 'everyday', fabric_weight: 'light' })
  insertPiece({ category: 'shoes', name: 'hot day flat shoes', occasions: ['casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  for (let i = 0; i < 5; i += 1) {
    insertPiece({ category: 'outerwear', name: `hot weather extra layer ${i}`, occasions: ['casual'], formality: 'everyday', fabric_weight: 'heavy' })
  }
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Hot Casual Day', occasion: 'casual', activity: 'none', count: 1, weather: 'hot, around 95F' },
  ])

  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'hot casual day' })
  const suppressedCount = Number.parseInt(workbench.slots[0].suppressed_note, 10)
  assert.ok(suppressedCount > 0, `suppressed note should report gated pieces, got "${workbench.slots[0].suppressed_note}"`)
})

test('model plan slot workbench force-includes a shared anchor that would fall past the cap', async () => {
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'bottom', name: 'anchor cap pants', occasions: ['city'], formality: 'everyday' })
  insertPiece({ category: 'shoes', name: 'anchor cap shoes', occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  for (let i = 0; i < 45; i += 1) {
    insertPiece({ category: 'top', name: `ordinary roster top ${i}`, occasions: ['city'], formality: 'everyday' })
  }
  const anchorId = insertPiece({ category: 'top', name: 'late shared anchor top', occasions: ['city'], formality: 'everyday' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'City Day', occasion: 'city', activity: 'none', count: 1, weather: 'indoor' },
  ])

  const workbench = await buildPlanSlotWorkbench(slots, {
    allPieces,
    question: 'build around the late top',
    constraints: { shared_anchor_ids: [anchorId] },
  })

  assert.equal(workbench.slots[0].allowed_piece_ids.length, 40)
  assert.ok(workbench.pendingPlan.slots[0].rosterIds.has(anchorId), 'late anchor must stay inside rosterIds despite the cap')
  assert.ok(workbench.slots[0].allowed_piece_ids.includes(Number(anchorId)), 'late anchor must be visible to the model')
  assert.ok(workbench.piece_catalog.some(line => line.includes(`ID ${anchorId}`)), 'late anchor details must be visible to the model')
  assert.ok(workbench.piece_catalog.some(line => line.includes('ordinary roster top 44')), 'the cap should not simply take the oldest first 40 pieces')
  assert.ok(workbench.pendingPlan.slots[0].gateAllowedIds.has(Number(anchorId)), 'anchor guarantee must use all gate-allowed IDs')
})

// Part 4 (spec 18): the spec-15 watch item's agreed escalation, now past its
// 3-run threshold (three live maximize-reuse packing runs used 16/18/20
// distinct pieces, only accessories repeating).
test('model plan slot workbench instructions push reuse when reuseMode is maximize, and never otherwise', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'City Day', occasion: 'city', activity: 'none', count: 1 },
  ])

  const maximizeWorkbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day', constraints: { reuse: 'maximize' } })
  assert.match(maximizeWorkbench.instructions, /Reuse is set to maximize.*repeat bottoms and shoes/)

  const defaultWorkbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day' })
  assert.doesNotMatch(defaultWorkbench.instructions, /Reuse is set to maximize/)

  const diversifyWorkbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day', constraints: { reuse: 'diversify' } })
  assert.doesNotMatch(diversifyWorkbench.instructions, /Reuse is set to maximize/)
})

// Part 5 (spec 18): live miss — a card described patterned Tropical pants
// (catalog: pattern floral, six colors) as "solid-base... muted print",
// fabricating past the catalog truth it already had.
test('model plan slot workbench instructions always include the pattern-truth line', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'City Day', occasion: 'city', activity: 'none', count: 1 },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day' })
  assert.match(workbench.instructions, /catalog's pattern and color fields are the truth about prints/)
})

// Part 3 (spec 19): live miss — a submitted card's reason said "Actually
// revising: emerald v-neck top + oatmeal textured elastic waist pants..."
// while piece_ids still carried the abstract midi dress the prose had just
// rejected. No mechanism (prose-vs-IDs consistency isn't mechanically
// checkable), so this pins the instruction is always present.
test('model plan slot workbench instructions always include the piece_ids-ARE-the-outfit line', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'City Day', occasion: 'city', activity: 'none', count: 1 },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day' })
  assert.match(workbench.instructions, /The piece_ids ARE the outfit/)
})

test('submit_plan_outfits accepts gate-allowed pieces that were not in the shown roster', async () => {
  db.prepare('DELETE FROM pieces').run()
  const bottomId = insertPiece({ category: 'bottom', name: 'hidden roster pants', occasions: ['city'], formality: 'everyday' })
  const shoesId = insertPiece({ category: 'shoes', name: 'hidden roster shoes', occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const topIds = []
  for (let i = 0; i < 45; i += 1) {
    topIds.push(insertPiece({ category: 'top', name: `hidden roster top ${i}`, occasions: ['city'], formality: 'everyday' }))
  }
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'City Day', occasion: 'city', activity: 'none', count: 1, weather: 'indoor' },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city outfit' })
  const hiddenTopId = Number(topIds[0])

  assert.ok(workbench.pendingPlan.slots[0].gateAllowedIds.has(hiddenTopId))
  assert.ok(!workbench.pendingPlan.slots[0].rosterIds.has(hiddenTopId), 'fixture needs an allowed top outside the shown roster')

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: workbench.pendingPlan.slots[0].id,
    piece_ids: [hiddenTopId, Number(bottomId), Number(shoesId)],
  }])

  assert.equal(result.failures.length, 0)
  assert.equal(result.accepted.length, 1)
})

test('submit_plan_outfits rejects gate-suppressed pieces with the gate reason', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'hot gate top', occasions: ['casual'], formality: 'everyday', fabric_weight: 'light' })
  const bottomId = insertPiece({ category: 'bottom', name: 'hot gate pants', occasions: ['casual'], formality: 'everyday', fabric_weight: 'light' })
  const shoesId = insertPiece({ category: 'shoes', name: 'hot gate shoes', occasions: ['casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const heavyLayerIds = []
  for (let i = 0; i < 5; i += 1) {
    heavyLayerIds.push(insertPiece({ category: 'outerwear', name: `heavy hot gate layer ${i}`, occasions: ['casual'], formality: 'everyday', fabric_weight: 'heavy' }))
  }
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Hot Casual Day', occasion: 'casual', activity: 'none', count: 1, weather: 'hot, around 95F' },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'hot casual day' })
  const suppressedLayerId = heavyLayerIds.map(Number).find(id => workbench.pendingPlan.slots[0].suppressedReasonsById.has(id))
  assert.ok(suppressedLayerId, 'fixture needs at least one gate-suppressed layer')

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: workbench.pendingPlan.slots[0].id,
    piece_ids: [Number(topId), Number(bottomId), Number(shoesId), suppressedLayerId],
  }])

  assert.equal(result.accepted.length, 0)
  assert.match(result.failures[0].reasons.join(' '), /failed this slot's gates/)
  assert.match(result.failures[0].reasons.join(' '), /hot weather|heavy/i)
})

// --- Register floor escape hatch + unfillability (spec 19 Part 1) -------------

test('a register-floor rejection always names the re-call escape hatch', async () => {
  db.prepare('DELETE FROM pieces').run()
  const dressyTopId = insertPiece({ category: 'top', name: 'dressy client top', occasions: ['city'], formality: 'dressy' })
  const dressyBottomId = insertPiece({ category: 'bottom', name: 'dressy client pants', occasions: ['city'], formality: 'dressy' })
  const dressyShoesId = insertPiece({ category: 'shoes', name: 'dressy client shoes', occasions: ['city'], formality: 'dressy', heel_height: 'flat', walk_support: 'high' })
  const everydayTopId = insertPiece({ category: 'top', name: 'everyday office top', occasions: ['city'], formality: 'everyday' })
  const everydayBottomId = insertPiece({ category: 'bottom', name: 'everyday office pants', occasions: ['city'], formality: 'everyday' })
  const everydayShoesId = insertPiece({ category: 'shoes', name: 'everyday office shoes', occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Client Presentation', occasion: 'city', activity: 'none', count: 1, weather: 'indoor', register: 'dressy' },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'client presentation day' })
  const slot = workbench.pendingPlan.slots[0]
  // Fixture needs a genuinely fillable dressy path so this case is NOT the
  // unfillable one — that's the next test.
  assert.ok(slot.gateAllowedIds.has(Number(dressyTopId)), 'the reconciled ceiling must let the dressy path through')
  assert.ok(slot.gateAllowedIds.has(Number(dressyBottomId)))
  assert.ok(slot.gateAllowedIds.has(Number(dressyShoesId)))

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(everydayTopId), Number(everydayBottomId), Number(everydayShoesId)],
  }])

  assert.equal(result.accepted.length, 0)
  const reasons = result.failures[0].reasons.join(' ')
  assert.match(reasons, /is below the dressy register floor/)
  assert.match(reasons, /re-call plan_outfit_set with just this slot at a lower register/)
  assert.doesNotMatch(reasons, /no combination in this slot's roster can meet/, 'a fillable path exists, so the stronger message must not fire')
})

test('an unfillable register floor states the stronger truth: no combination can meet it', async () => {
  db.prepare('DELETE FROM pieces').run()
  const everydayTopId = insertPiece({ category: 'top', name: 'plain office top', occasions: ['city'], formality: 'everyday' })
  const everydayBottomId = insertPiece({ category: 'bottom', name: 'plain office pants', occasions: ['city'], formality: 'everyday' })
  const everydayShoesId = insertPiece({ category: 'shoes', name: 'plain office shoes', occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Client Presentation', occasion: 'city', activity: 'none', count: 1, weather: 'indoor', register: 'dressy' },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'client presentation day' })
  const slot = workbench.pendingPlan.slots[0]

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(everydayTopId), Number(everydayBottomId), Number(everydayShoesId)],
  }])

  assert.equal(result.accepted.length, 0)
  const reasons = result.failures[0].reasons.join(' ')
  assert.match(reasons, /is below the dressy register floor/)
  assert.match(reasons, /re-call plan_outfit_set with just this slot at a lower register/)
  assert.match(reasons, /no combination in this slot's roster can meet the dressy floor/)
})

// --- Register ceiling reconciliation (spec 19 Part 2) -------------------------

test('a declared register above the occasion ceiling raises the effective ceiling (brunch repro)', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'elevated brunch top', occasions: ['casual'], formality: 'elevated' })
  const bottomId = insertPiece({ category: 'bottom', name: 'elevated brunch pants', occasions: ['casual'], formality: 'elevated' })
  const shoesId = insertPiece({ category: 'shoes', name: 'elevated brunch shoes', occasions: ['casual'], formality: 'elevated', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Farewell Brunch', occasion: 'casual', activity: 'none', count: 1, weather: 'indoor', register: 'elevated' },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'farewell brunch' })

  assert.equal(workbench.slots[0].register_ceiling, 'elevated')
  const gateAllowedIds = workbench.pendingPlan.slots[0].gateAllowedIds
  assert.ok(gateAllowedIds.has(Number(topId)), 'an elevated top must clear the reconciled ceiling')
  assert.ok(gateAllowedIds.has(Number(bottomId)), 'an elevated bottom must clear the reconciled ceiling')
  assert.ok(gateAllowedIds.has(Number(shoesId)), 'elevated shoes must clear the reconciled ceiling')
})

test('an undeclared register keeps today\'s occasion ceiling byte-identical', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const withRegister = normalizePlanSlots([{ label: 'City Day', occasion: 'casual', activity: 'none', count: 1, weather: 'indoor' }])
  const withoutOverride = await buildPlanSlotWorkbench(withRegister, { allPieces, question: 'city day' })
  assert.equal(withoutOverride.slots[0].register_ceiling, 'everyday')
})

test('effective register ceiling never drops below the effective floor across occasion x register combinations', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const rankOf = name => ({ lounge: 0, everyday: 1, elevated: 2, dressy: 3, formal: 4 }[name] ?? null)
  const occasions = ['casual', 'city', 'evening']
  const registers = ['', 'everyday', 'elevated', 'dressy', 'formal']
  const rawSlots = []
  for (const occasion of occasions) {
    for (const register of registers) {
      rawSlots.push({ label: `${occasion}-${register || 'none'}`, occasion, activity: 'none', count: 1, weather: 'indoor', register })
    }
  }
  const slots = normalizePlanSlots(rawSlots, { maxSlots: rawSlots.length, maxTotalOutfits: rawSlots.length })
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'register matrix' })
  for (const slot of workbench.slots) {
    const floorRank = rankOf(slot.register_floor)
    if (floorRank === null) continue
    const ceilingRank = rankOf(slot.register_ceiling)
    assert.ok(ceilingRank !== null && ceilingRank >= floorRank, `${slot.label}: ceiling "${slot.register_ceiling}" (${ceilingRank}) must be >= floor "${slot.register_floor}" (${floorRank})`)
  }
})

test('describeOutfitStructureGap reports the specific structural gap', () => {
  const topA = { id: 1, category: 'top' }
  const topB = { id: 2, category: 'top' }
  const bottomA = { id: 3, category: 'bottom' }
  const bottomB = { id: 4, category: 'bottom' }
  const dress = { id: 5, category: 'dress' }
  const shoesA = { id: 6, category: 'shoes' }
  const shoesB = { id: 7, category: 'shoes' }

  assert.equal(describeOutfitStructureGap([topA, bottomA]), 'missing shoes')
  assert.equal(describeOutfitStructureGap([topA, bottomA, shoesA, shoesB]), 'more than one shoe option was submitted')
  assert.equal(describeOutfitStructureGap([topA, bottomA, bottomB, shoesA]), 'more than one bottom was submitted')
  assert.equal(describeOutfitStructureGap([dress, bottomA, shoesA]), 'dress and bottom were both submitted')
  assert.equal(describeOutfitStructureGap([bottomA, shoesA]), 'missing top or dress')
  assert.equal(describeOutfitStructureGap([topA, topB, shoesA]), '2 tops were submitted without a bottom')
  assert.equal(describeOutfitStructureGap([topA, bottomA, shoesA]), '')
})

test('assembleSubmittedPlanOutfits reports model validation shortfalls as submitted-plan gaps', () => {
  const top = { id: 1, name: 'gap top', category: 'top' }
  const bottom = { id: 2, name: 'gap bottom', category: 'bottom' }
  const shoes = { id: 3, name: 'gap shoes', category: 'shoes' }
  const pendingPlan = {
    slots: [{
      id: 'winery_exploring',
      label: 'Winery Exploring',
      occasion: 'city',
      activity: 'walking',
      bestFor: 'walking around wineries',
      coverage: 'winery exploring',
      targetOutfits: 2,
      originalIndex: 0,
      allowedPieces: [top, bottom, shoes],
      gateAllowedIds: new Set([1, 2, 3]),
      weatherLabel: 'warm',
    }],
    constraints: { reuse: 'maximize', noRepeat: new Set(), pieceBudget: 0 },
    slotWeather: [],
    coverageGaps: [],
  }

  const outfits = assembleSubmittedPlanOutfits(pendingPlan, [{
    _slotId: 'winery_exploring',
    title: 'One valid winery look',
    reason: 'Only one made it through validation.',
    pieces: [top, bottom, shoes],
    pieceIds: [1, 2, 3],
    source: 'plan_outfit_set',
    composedBy: 'model',
  }])

  assert.equal(outfits[0].composedBy, 'model')
  assert.ok(outfits[0].tripPlanLines.some(line => line === '[coverage gap: "Winery Exploring" needed 2 looks but only 1 valid outfit was submitted — the other attempts failed validation]'), `expected model shortfall wording, got ${JSON.stringify(outfits[0].tripPlanLines)}`)
})

test('submit_plan_outfits merges validation failures and holds accepted outfits for resubmit', async () => {
  const previousMode = process.env.WARDROBE_PLAN_COMPOSE
  process.env.WARDROBE_PLAN_COMPOSE = 'model'
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'held top one', occasions: ['city', 'casual'] })
  insertPiece({ category: 'bottom', name: 'held bottom one', occasions: ['city', 'casual'] })
  insertPiece({ category: 'shoes', name: 'held shoes one', occasions: ['city', 'casual'], heel_height: 'flat', walk_support: 'high' })
  insertPiece({ category: 'top', name: 'held top two', occasions: ['casual', 'city'] })
  insertPiece({ category: 'bottom', name: 'held bottom two', occasions: ['casual', 'city'] })
  insertPiece({ category: 'shoes', name: 'held shoes two', occasions: ['casual', 'city'], heel_height: 'flat', walk_support: 'high' })
  try {
    const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'two simple outfits' }
    await executeTool('plan_outfit_set', {
      slots: [
        { label: 'City Day', occasion: 'city', activity: 'none', count: 1 },
        { label: 'Casual Day', occasion: 'casual', activity: 'none', count: 1 }
      ]
    }, toolContext)
    const firstSlot = toolContext.pendingPlan.slots[0]
    const secondSlot = toolContext.pendingPlan.slots[1]
    const firstIds = idsForSlot(firstSlot)
    const secondIds = idsForSlot(secondSlot, 1)
    const invalid = await executeTool('submit_plan_outfits', {
      outfits: [
        { slot_id: firstSlot.id, piece_ids: [firstIds.get('top'), firstIds.get('bottom'), firstIds.get('shoes')] },
        { slot_id: secondSlot.id, piece_ids: [secondIds.get('top'), 999999] }
      ]
    }, toolContext)

    assert.equal(invalid.status, 'validation_error')
    assert.equal(invalid.held_count, 1)
    assert.match(invalid.message, /not an active wardrobe piece for this plan/)
    assert.equal(toolContext.pendingPlan.heldOutfits.length, 1)
    assert.equal(toolContext.freeformDiagnostics.submitPlanValidationFails, 1)

    const fixed = await executeTool('submit_plan_outfits', {
      outfits: [
        { slot_id: secondSlot.id, piece_ids: [secondIds.get('top'), secondIds.get('bottom'), secondIds.get('shoes')] }
      ]
    }, toolContext)

    assert.equal(fixed.status, 'success')
    assert.equal(toolContext.generatedOutfits.length, 2)
  } finally {
    if (previousMode === undefined) delete process.env.WARDROBE_PLAN_COMPOSE
    else process.env.WARDROBE_PLAN_COMPOSE = previousMode
  }
})

test('submit_plan_outfits reports missing slots together with other validation failures', async () => {
  const previousMode = process.env.WARDROBE_PLAN_COMPOSE
  process.env.WARDROBE_PLAN_COMPOSE = 'model'
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'roundtrip top one', occasions: ['city', 'casual'] })
  insertPiece({ category: 'bottom', name: 'roundtrip bottom one', occasions: ['city', 'casual'] })
  insertPiece({ category: 'shoes', name: 'roundtrip shoes one', occasions: ['city', 'casual'], heel_height: 'flat', walk_support: 'high' })
  insertPiece({ category: 'top', name: 'roundtrip top two', occasions: ['city', 'casual'] })
  insertPiece({ category: 'bottom', name: 'roundtrip bottom two', occasions: ['city', 'casual'] })
  insertPiece({ category: 'shoes', name: 'roundtrip shoes two', occasions: ['city', 'casual'], heel_height: 'flat', walk_support: 'high' })
  try {
    const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'three simple outfits' }
    await executeTool('plan_outfit_set', {
      slots: [
        { label: 'City Day', occasion: 'city', activity: 'none', count: 1 },
        { label: 'Coastal Day', occasion: 'casual', activity: 'none', count: 1 },
        { label: 'Winery Day', occasion: 'city', activity: 'walking', count: 2 },
      ]
    }, toolContext)
    const citySlot = toolContext.pendingPlan.slots.find(slot => slot.label === 'City Day')
    const coastalSlot = toolContext.pendingPlan.slots.find(slot => slot.label === 'Coastal Day')
    const cityIds = idsForSlot(citySlot)

    const invalid = await executeTool('submit_plan_outfits', {
      outfits: [
        { slot_id: citySlot.id, piece_ids: [cityIds.get('top'), cityIds.get('bottom'), cityIds.get('shoes')] },
        { slot_id: coastalSlot.id, piece_ids: [999999] }
      ]
    }, toolContext)

    assert.equal(invalid.status, 'validation_error')
    assert.ok(invalid.failures.some(failure => failure.label === 'Coastal Day'), `expected coastal failure, got ${JSON.stringify(invalid.failures)}`)
    const missing = invalid.failures.find(failure => failure.label === 'Missing slots')
    assert.ok(missing, `missing slots should be merged with other failures, got ${JSON.stringify(invalid.failures)}`)
    assert.ok(missing.reasons.some(reason => /Winery Day still needs 2 outfits/.test(reason)), `expected winery shortfall in same response, got ${missing.reasons}`)
  } finally {
    if (previousMode === undefined) delete process.env.WARDROBE_PLAN_COMPOSE
    else process.env.WARDROBE_PLAN_COMPOSE = previousMode
  }
})

test('propose_outfit redirects while a model-mode pending plan awaits submission', async () => {
  const previousMode = process.env.WARDROBE_PLAN_COMPOSE
  process.env.WARDROBE_PLAN_COMPOSE = 'model'
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'redirect top', occasions: ['city'] })
  const bottomId = insertPiece({ category: 'bottom', name: 'redirect bottom', occasions: ['city'] })
  const shoesId = insertPiece({ category: 'shoes', name: 'redirect shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  try {
    const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'one city outfit', retrievedPieceIds: new Set([topId, bottomId, shoesId]) }
    await executeTool('plan_outfit_set', {
      slots: [{ label: 'City Day', occasion: 'city', activity: 'none', count: 1 }]
    }, toolContext)
    const result = await executeTool('propose_outfit', {
      label: 'Wrong path',
      pieces: [{ id: topId, role: 'primary_top' }, { id: bottomId, role: 'primary_bottom' }, { id: shoesId, role: 'shoes' }]
    }, toolContext)

    assert.equal(result.status, 'validation_error')
    assert.match(result.message, /submit_plan_outfits/)
  } finally {
    if (previousMode === undefined) delete process.env.WARDROBE_PLAN_COMPOSE
    else process.env.WARDROBE_PLAN_COMPOSE = previousMode
  }
})

function insertPiece(overrides = {}) {
  const piece = {
    name: 'test piece',
    category: 'top',
    colors: [],
    occasions: ['casual', 'city'],
    season: 'year-round',
    notes: '',
    status: 'active',
    recommendation_status: 'trusted',
    fit_confidence: 'high',
    role_permission: 'auto',
    occasion_permissions: [],
    engine_notes: '',
    photo: null,
    worn_photo: null,
    pattern_type: 'solid',
    pattern_scale: 'none',
    pattern_complexity: 'solid',
    reads_as: '',
    silhouette: '',
    fabric_category: '',
    fabric_weight: 'light',
    fiber_content: [],
    formality: 'everyday',
    length_hits_at: '',
    heel_height: null,
    walk_support: null,
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
    ...overrides,
  }
  return db.prepare(`
    INSERT INTO pieces (
      name, category, colors, occasions, season, notes, status,
      recommendation_status, fit_confidence, role_permission, occasion_permissions,
      engine_notes, photo, worn_photo, pattern_type, pattern_scale,
      pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content,
      formality, length_hits_at, heel_height, walk_support, style_profile_json
    ) VALUES (
      @name, @category, @colors, @occasions, @season, @notes, @status,
      @recommendation_status, @fit_confidence, @role_permission, @occasion_permissions,
      @engine_notes, @photo, @worn_photo, @pattern_type, @pattern_scale,
      @pattern_complexity, @reads_as, @silhouette, @fabric_category, @fabric_weight, @fiber_content,
      @formality, @length_hits_at, @heel_height, @walk_support, @style_profile_json
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

// Enough distinct tops/bottoms/shoes that two slots can compose different
// combinations; all light, trusted, and multi-occasion so gates stay open.
function seedWardrobe() {
  const tops = [
    { name: 'white cotton tee', reads_as: 'clean casual base', silhouette: 'relaxed', fabric_category: 'cotton' },
    { name: 'black silk blouse', reads_as: 'polished dark top', silhouette: 'fitted', fabric_category: 'silk', occasions: ['city', 'evening'] },
    { name: 'striped linen button shirt', reads_as: 'breezy structured shirt', silhouette: 'relaxed', fabric_category: 'linen' },
    { name: 'olive tank top', reads_as: 'simple warm-weather layer', silhouette: 'fitted', fabric_category: 'jersey' },
  ]
  const bottoms = [
    { name: 'light beige linen wide-leg pants', bottom_shape: 'wide_leg', fabric_category: 'linen' },
    { name: 'dark straight jeans', bottom_shape: 'straight', fabric_category: 'denim', occasions: ['casual', 'city', 'evening'] },
    { name: 'flowy midi skirt', bottom_shape: 'a_line_skirt', fabric_category: 'viscose', occasions: ['city', 'evening'] },
  ]
  const shoes = [
    { name: 'white leather sneakers', reads_as: 'walkable everyday sneaker' },
    { name: 'black block heel mules', reads_as: 'sharp dinner mule', occasions: ['city', 'evening'] },
    { name: 'tan ballet flats', reads_as: 'light walkable flat' },
  ]
  for (const top of tops) insertPiece({ category: 'top', colors: ['white'], ...top })
  for (const bottom of bottoms) {
    insertPiece({ category: 'bottom', colors: ['beige'], length_hits_at: 'full-length', ...bottom })
  }
  for (const shoe of shoes) insertPiece({ category: 'shoes', colors: ['white'], ...shoe })
  insertPiece({ category: 'outerwear', name: 'cream open cardigan', colors: ['cream'], fabric_category: 'knit', occasions: ['casual', 'city', 'evening'] })
}

test('normalizePlanSlots maps tool args to engine slots and caps the set size', () => {
  const slots = normalizePlanSlots([
    { label: 'Winery Days', occasion: 'outdoor_daytime_social', activity: 'walking', count: 3, weather: 'hot, highs 85F' },
    { label: 'Dinner Out', occasion: 'evening', count: 2 },
    { label: 'Coastal Day', occasion: 'casual', activity: 'walking', count: 3, weather: 'cool, around 60F', plan_note: 'bring a layer' },
    { label: 'Hike', occasion: 'casual', activity: 'hiking', count: 2 },
  ], { fallbackWeather: 'warm', tripSummary: { durationText: '5 days', dayBreakdown: '3 winery days, dinners out' } })

  assert.equal(slots.length, 4)
  assert.equal(slots[0].id, 'winery_days')
  assert.equal(slots[0].season, 'hot, highs 85F')
  assert.equal(slots[1].season, 'warm', 'slot without weather inherits the fallback')
  assert.equal(slots[2].planNote, 'bring a layer')
  assert.equal(slots[0].tripSummary.durationText, '5 days')
  const total = slots.reduce((sum, slot) => sum + slot.targetOutfits, 0)
  assert.ok(total <= PLAN_TOTAL_OUTFIT_CAP, `total outfits ${total} must respect the cap`)
  // Trimming eats from the END of the slot list, so early slots keep their counts.
  assert.equal(slots[0].targetOutfits, 3)

  // Slots without a usable label are dropped.
  assert.equal(normalizePlanSlots([{ occasion: 'casual' }]).length, 0)
})

test('normalizePlanSlots corrects contradictory casual dinner slots to evening', () => {
  const slots = normalizePlanSlots([
    { label: 'Casual Dinner', occasion: 'casual', activity: 'none', count: 2, best_for: 'relaxed dining out' },
    { label: 'Casual Dinner', occasion: 'city', activity: 'none', count: 1, best_for: 'relaxed dinner' },
    { label: 'Everyday Casual', occasion: 'casual', activity: 'none', count: 1, best_for: 'comfortable everyday wear' },
  ], { fallbackWeather: 'warm' })

  assert.equal(slots[0].occasion, 'evening')
  assert.equal(slots[1].occasion, 'evening')
  assert.equal(slots[2].occasion, 'casual')
})

test('normalizePlanSlots corrects beach slots misclassified as outdoor daytime social', () => {
  const slots = normalizePlanSlots([
    { label: 'Beach Day', occasion: 'outdoor_daytime_social', activity: 'none', count: 2, best_for: 'relaxed beach outings' },
    { label: 'Outdoor Market', occasion: 'outdoor_daytime_social', activity: 'none', count: 1, best_for: 'markets and fairs' },
  ], { fallbackWeather: 'warm' })

  assert.equal(slots[0].occasion, 'casual')
  assert.equal(slots[0].environment, 'beach_coastal')
  assert.equal(slots[1].occasion, 'outdoor_daytime_social')
  assert.equal(slots[1].environment, '')
})

test('normalizePlanSlots uses declared environment before coastal prose inference', () => {
  const diagnostics = {}
  const bump = field => { diagnostics[field] = (diagnostics[field] || 0) + 1 }
  const slots = normalizePlanSlots([
    { label: 'Quiet Resort Slot', occasion: 'outdoor_daytime_social', activity: 'none', environment: 'beach_coastal', count: 1, best_for: 'easy warm-weather day' },
    { label: 'Shoreline Viewing', occasion: 'outdoor_daytime_social', activity: 'none', environment: 'indoor', count: 1, best_for: 'climate-controlled waterfront slot' },
    { label: 'Pool Morning', occasion: 'outdoor_daytime_social', activity: 'none', count: 1, best_for: 'swimming and poolside reading' },
  ], { fallbackWeather: 'warm', onDiagnostic: bump })

  assert.equal(slots[0].environment, 'beach_coastal')
  assert.equal(slots[0].occasion, 'casual')
  assert.equal(slots[1].environment, 'indoor')
  assert.equal(slots[1].occasion, 'outdoor_daytime_social')
  assert.equal(slots[2].environment, 'beach_coastal')
  assert.equal(slots[2].occasion, 'casual')
  assert.deepEqual(diagnostics, { planSlotEnvironmentInferred: 1 })
})

test('normalizePlanSlots infers walking activity from slot prose when the model omits activity', () => {
  const diagnostics = {}
  const bump = field => { diagnostics[field] = (diagnostics[field] || 0) + 1 }
  const slots = normalizePlanSlots([
    { label: 'City Walking Days', occasion: 'city', count: 2, best_for: 'walking around the city' },
    { label: 'Gallery Visit', occasion: 'gallery / art event', count: 1, best_for: 'art gallery visit' },
    { label: 'Outdoor Market', occasion: 'outdoor_daytime_social', count: 1, best_for: 'exploring the market' },
    { label: 'Declared Wandering', occasion: 'city', activity: 'none', count: 1, best_for: 'walking around the city' },
  ], { fallbackWeather: 'cool mild weather', onDiagnostic: bump })

  assert.equal(slots[0].activity, 'walking')
  assert.equal(slots[1].activity, 'none')
  assert.equal(slots[2].activity, 'walking')
  assert.equal(slots[3].activity, 'none')
  assert.deepEqual(diagnostics, { planSlotActivityInferred: 2 })
})

test('plan_outfit_set is blocked until cards intent is declared', async () => {
  const toolContext = { declaredIntent: null }
  const result = await executeTool('plan_outfit_set', {
    slots: [{ label: 'City Days', occasion: 'city', activity: 'walking' }]
  }, toolContext)
  assert.equal(result.status, 'validation_error')
  assert.match(result.message, /declare_intent/)
  assert.equal(toolContext.freeformDiagnostics.composeWithoutDeclaredIntent, 1)
})

// --- Build step 3: per-slot live weather -----------------------------------

test('normalizePlanSlots carries location, date, and stated weather, inheriting the plan location', () => {
  const slots = normalizePlanSlots([
    { label: 'Client Day', occasion: 'work', date: '2026-07-23', weather: 'cool AM, warm PM' },
    { label: 'Coast Escape', occasion: 'casual', location: 'Cambria, CA' },
  ], { fallbackLocation: 'Portland, OR' })

  assert.equal(slots[0].date, '2026-07-23')
  assert.equal(slots[0].statedWeather, 'cool AM, warm PM')
  assert.equal(slots[0].season, 'cool AM, warm PM', 'stated weather also seeds the season text')
  assert.equal(slots[0].location, 'Portland, OR', 'a slot without a location inherits the plan location')
  assert.equal(slots[1].location, 'Cambria, CA', 'a slot location overrides the plan location')
  assert.equal(slots[1].statedWeather, '', 'no stated weather when none is given')
})

test('normalizePlanSlots does not treat echoed fallback weather as slot-stated weather', () => {
  const slots = normalizePlanSlots([
    { label: 'Coast Walk', occasion: 'city', activity: 'walking', location: 'Cambria, CA', weather: ' warm ' },
    { label: 'Indoor Dinner', occasion: 'evening', activity: 'none', location: 'Paso Robles, CA', weather: 'indoor' },
    { label: 'Cool Patio', occasion: 'city', activity: 'none', location: 'Cambria, CA', weather: 'cool and breezy' },
  ], { fallbackWeather: 'warm', fallbackLocation: 'Paso Robles, CA' })

  assert.equal(slots[0].statedWeather, '', 'fallback echo should still allow live slot forecast to win')
  assert.equal(slots[0].season, 'warm', 'fallback still seeds heuristic season text')
  assert.equal(slots[1].statedWeather, 'indoor', 'different explicit indoor weather should still win')
  assert.equal(slots[2].statedWeather, 'cool and breezy', 'different explicit slot weather should still win')
})

test('normalizePlanSlots treats environment enum in weather as a declared environment', () => {
  const diagnostics = {}
  const slots = normalizePlanSlots([
    { label: 'Coastal Day', occasion: 'outdoor_daytime_social', activity: 'none', location: 'Cambria, CA', weather: 'beach_coastal' },
  ], {
    fallbackWeather: 'warm',
    onDiagnostic: key => { diagnostics[key] = (diagnostics[key] || 0) + 1 }
  })

  assert.equal(slots[0].environment, 'beach_coastal')
  assert.equal(slots[0].occasion, 'casual')
  assert.equal(slots[0].statedWeather, '', 'environment enum in weather must not block live forecast as stated weather')
  assert.equal(slots[0].season, 'warm')
  assert.equal(diagnostics.planSlotEnvironmentInferred || 0, 0, 'weather enum should count as a declaration, not prose inference')
})

test('normalizePlanSlots keeps indoor weather when it was supplied as a weather enum', () => {
  const slots = normalizePlanSlots([
    { label: 'Nice Restaurants', occasion: 'evening', activity: 'none', location: 'Paso Robles, CA', weather: 'indoor' },
  ], { fallbackWeather: 'hot weather' })

  assert.equal(slots[0].environment, 'indoor')
  assert.equal(slots[0].statedWeather, 'indoor')
  assert.equal(slots[0].season, 'indoor')
})

test('normalizePlanSlots lets explicit indoor environment imply indoor weather', () => {
  const slots = normalizePlanSlots([
    { label: 'Smart Casual Brunch', occasion: 'smart casual', activity: 'none', environment: 'indoor', weather: 'indoor' },
    { label: 'Gallery Visit', occasion: 'gallery / art event', activity: 'none', environment: 'indoor' },
  ], { fallbackWeather: 'hot weather' })

  assert.equal(slots[0].environment, 'indoor')
  assert.equal(slots[0].statedWeather, 'indoor')
  assert.equal(slots[0].season, 'indoor')
  assert.equal(slots[1].environment, 'indoor')
  assert.equal(slots[1].statedWeather, 'indoor')
  assert.equal(slots[1].season, 'indoor')
})

test('normalizePlanSlots preserves beach-coastal contradiction handling for indoor weather', () => {
  const slots = normalizePlanSlots([
    { label: 'Beach Day', occasion: 'casual', activity: 'none', environment: 'beach_coastal', weather: 'indoor' },
    { label: 'Coastal Walk', occasion: 'casual', activity: 'none', location: 'Cambria, CA', weather: 'indoor' },
  ], { fallbackWeather: 'warm' })

  assert.equal(slots[0].environment, 'beach_coastal')
  assert.equal(slots[0].statedWeather, '')
  assert.equal(slots[1].environment, 'beach_coastal')
  assert.equal(slots[1].statedWeather, '')
})

test('normalizePlanSlots lets explicit outdoor environment beat indoor text defaults', () => {
  const slots = normalizePlanSlots([
    { label: 'Outdoor Office Picnic', occasion: 'city', activity: 'none', weather: 'outdoor' },
  ], { fallbackWeather: 'mild' })

  assert.equal(slots[0].environment, 'outdoor')
  assert.equal(slots[0].statedWeather, '')
  assert.equal(slots[0].season, 'mild')
})

test('normalizePlanSlots treats office and client-meeting slots as indoor when the model omits weather', () => {
  const slots = normalizePlanSlots([
    { label: 'Office Days', occasion: 'city', activity: 'none', count: 3 },
    { label: 'Client Meeting', occasion: 'smart casual', activity: 'none', count: 1 },
    { label: 'Nice Restaurants', occasion: 'evening', activity: 'none', count: 1 },
    { label: 'Outdoor Client Walk', occasion: 'city', activity: 'walking', count: 1 },
    { label: 'Winery Walk', occasion: 'outdoor_daytime_social', activity: 'walking', count: 1 },
  ], { fallbackWeather: 'hot', fallbackLocation: 'Walnut Creek, CA' })

  assert.equal(slots[0].statedWeather, 'indoor')
  assert.equal(slots[0].season, 'indoor')
  assert.equal(slots[1].statedWeather, 'indoor')
  assert.equal(slots[1].season, 'indoor')
  assert.equal(slots[2].statedWeather, 'indoor', 'plural restaurant labels should default indoor')
  assert.equal(slots[2].season, 'indoor')
  assert.equal(slots[3].statedWeather, '', 'walking/outdoor slots should still use live weather')
  assert.equal(slots[3].season, 'hot')
  assert.equal(slots[4].statedWeather, '', 'winery walking slots should still use live weather')
  assert.equal(slots[4].season, 'hot')
})

// Same owner ruling as #68 (register-escalation scorer), applied to the OFFICE
// scorer: print and hemline are NOT formality signals. The office scorer used
// to demote any 'botanical'/'floral'/'lace'/'resort'/'maxi' dress by NAME —
// wrongly penalizing a genuinely dressy, structured, silk piece for merely
// having a floral print. Judges by the piece's OWN formality tag and fabric
// instead: isolated dress-vs-dress so the result can't be explained away by
// stronger competing separates (unlike the fixture above, which always had
// strong separates available and would pass either way).
// --- Build step 4: reuse dial + per-category repeat rules + anchor exemption --

test('normalizePlanConstraints parses the reuse dial, maps category words, and applies the anchor / allow_repeat rules', () => {
  const c = normalizePlanConstraints({
    reuse: 'DIVERSIFY',
    no_repeat: ['tops', 'layers', 'shoes'],
    allow_repeat: ['shoes'],
    shared_anchor_ids: ['5', 5, 0, null, 12],
  })
  assert.equal(c.reuse, 'diversify')
  // tops -> top, layers -> outerwear, shoes dropped because allow_repeat wins.
  assert.deepEqual([...c.noRepeat].sort(), ['outerwear', 'top'])
  assert.deepEqual([...c.allowRepeat], ['shoes'])
  assert.deepEqual([...c.anchorIds].sort((a, b) => a - b), [5, 12])

  assert.equal(normalizePlanConstraints({ reuse: 'wild' }).reuse, '', 'an unknown reuse mode is ignored')
  assert.equal(normalizePlanConstraints({}).reuse, '')
  assert.equal(normalizePlanConstraints({}).noRepeat.size, 0)
})

// --- Build step 5: objective-driven plan report ------------------------------

const planLinesOf = outfits => outfits[0]?.tripPlanLines || []

test('normalizePlanConstraints parses a positive piece_budget and ignores junk', () => {
  assert.equal(normalizePlanConstraints({ piece_budget: 10 }).pieceBudget, 10)
  assert.equal(normalizePlanConstraints({ piece_budget: '12' }).pieceBudget, 12)
  assert.equal(normalizePlanConstraints({ piece_budget: 0 }).pieceBudget, 0)
  assert.equal(normalizePlanConstraints({ piece_budget: -3 }).pieceBudget, 0)
  assert.equal(normalizePlanConstraints({}).pieceBudget, 0)
})

test('sanitizePlanConstraintsForQuestion strips model-invented no_repeat from reusable capsules', () => {
  const invented = sanitizePlanConstraintsForQuestion(
    { reuse: 'maximize', piece_budget: 24, no_repeat: ['tops'], allow_repeat: ['shoes'] },
    'Build me a 24-piece summer capsule wardrobe: smart casual brunches, beach days, city outings, gallery visits, casual dinners, and outdoor markets.'
  )
  assert.deepEqual(invented, { reuse: 'maximize', piece_budget: 24, allow_repeat: ['shoes'] })

  const explicit = sanitizePlanConstraintsForQuestion(
    { reuse: 'maximize', piece_budget: 24, no_repeat: ['tops'], allow_repeat: ['shoes'] },
    'Build me a 24-piece summer capsule wardrobe, but do not repeat tops.'
  )
  assert.deepEqual(explicit, { reuse: 'maximize', piece_budget: 24, no_repeat: ['tops'], allow_repeat: ['shoes'] })
})

// --- Build step 7: parallel-path diagnostics ---------------------------------

// --- Slot register escalation (event weekends) --------------------------------

test('normalizePlanSlots normalizes the slot register and drops unknown values', () => {
  const slots = normalizePlanSlots([
    { label: 'Ceremony', occasion: 'evening', register: 'FORMAL' },
    { label: 'Rehearsal', occasion: 'evening', register: 'dressy' },
    { label: 'Brunch', occasion: 'smart casual', register: 'fancy' },
    { label: 'Hike', occasion: 'casual' },
  ])
  assert.equal(slots[0].register, 'formal')
  assert.equal(slots[1].register, 'dressy')
  assert.equal(slots[2].register, '', 'an unknown register value is dropped')
  assert.equal(slots[3].register, '', 'an omitted register is empty')
})

// --- composeOutfitSet quality fixes (capsule live test) ----------------------

// --- Register-down / athletic / summer-layer scorers (capsule live test 2) ---

// --- Path 1: real capsule builder (piece_budget enforcement) ----------------

test('selectCapsuleRoster curates within budget, covers categories, and includes shorts for summer', async () => {
  insertPiece({ category: 'bottom', name: 'beige cotton shorts', colors: ['beige'], occasions: ['casual', 'city'], fabric_category: 'cotton', fabric_weight: 'light', length_hits_at: 'above-knee' })
  insertPiece({ category: 'top', name: 'heavy wool turtleneck', colors: ['grey'], occasions: ['casual', 'city'], fabric_category: 'wool', fabric_weight: 'heavy' })
  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const roster = selectCapsuleRoster(pool, { budget: 10, isSummer: true })
  assert.ok(roster.length <= 10, `roster must stay within budget, got ${roster.length}`)
  const groups = new Set(roster.map(piece => wardrobeCategoryGroup(piece)))
  assert.ok(groups.has('top') && groups.has('bottom') && groups.has('shoes'), `roster needs category coverage, got ${[...groups]}`)
  const names = roster.map(piece => String(piece.name || '').toLowerCase())
  assert.ok(names.some(name => name.includes('shorts')), `a summer capsule roster should include shorts, got ${names}`)
  assert.ok(!names.some(name => name.includes('wool')), `a summer capsule roster should skip the wool turtleneck, got ${names}`)
})

test('selectCapsuleRoster de-duplicates near-identical pieces (not three black tees)', async () => {
  // Three near-identical black solid crew tees + one distinct top.
  for (const suffix of ['A', 'B', 'C']) {
    insertPiece({ category: 'top', name: `black crew tee ${suffix}`, colors: ['black'], reads_as: 'plain black tee', fabric_category: 'cotton', pattern_type: 'solid', occasions: ['casual', 'city'] })
  }
  insertPiece({ category: 'top', name: 'cream linen button shirt', colors: ['cream'], reads_as: 'breezy button shirt', fabric_category: 'linen', pattern_type: 'solid', occasions: ['casual', 'city'] })
  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const roster = selectCapsuleRoster(pool, { budget: 10, isSummer: true })
  const blackTees = roster.filter(piece => String(piece.name || '').toLowerCase().includes('black crew tee'))
  assert.ok(blackTees.length <= 1, `at most one near-identical black tee should make the roster, got ${blackTees.length}`)
})

test('selectCapsuleRoster reserves multiple elevated shoes for roomier mixed-register capsules', async () => {
  db.prepare("DELETE FROM pieces").run()
  for (const name of ['white cotton tee', 'olive cotton tank', 'graphic fruit stand tee', 'vibrant blue sleeveless top']) {
    insertPiece({ category: 'top', name, colors: ['white'], reads_as: 'easy everyday warm top', fabric_category: 'cotton', fabric_weight: 'light', formality: 'everyday', occasions: ['casual', 'city', 'outdoor_daytime_social'] })
  }
  for (const name of ['black silk blouse', 'white tie front blouse', 'large flowers floral print tank']) {
    insertPiece({ category: 'top', name, colors: ['black'], reads_as: 'polished elevated warm top', fabric_category: 'silk', fabric_weight: 'light', formality: 'elevated', occasions: ['city', 'smart casual', 'evening', 'gallery / art event'] })
  }
  for (const name of ['tan solid straight shorts', 'beige twill cargo capri pants', 'light beige linen wide-leg pants', 'Apple skirt']) {
    insertPiece({ category: 'bottom', name, colors: ['tan'], reads_as: 'warm weather bottom', bottom_shape: name.includes('skirt') ? 'a_line_skirt' : 'straight', fabric_category: 'linen', fabric_weight: 'light', formality: name.includes('Apple') ? 'elevated' : 'everyday', occasions: ['casual', 'city', 'outdoor_daytime_social', 'evening', 'gallery / art event'] })
  }
  insertPiece({ category: 'dress', name: 'blue botanical sleeveless dress', colors: ['blue'], reads_as: 'easy warm dress', fabric_category: 'rayon', fabric_weight: 'light', formality: 'everyday', occasions: ['casual', 'city'] })
  insertPiece({ category: 'shoes', name: 'navy canvas slip shoes', colors: ['navy'], reads_as: 'canvas slip shoes', formality: 'everyday', occasions: ['casual', 'city', 'outdoor_daytime_social'] })
  insertPiece({ category: 'shoes', name: 'taupe knit lace-up sneakers', colors: ['taupe'], reads_as: 'knit lace-up sneakers', formality: 'everyday', occasions: ['casual', 'city', 'outdoor_daytime_social'] })
  insertPiece({ category: 'shoes', name: 'white leather sneakers', colors: ['white'], reads_as: 'clean leather sneakers', formality: 'everyday', occasions: ['casual', 'city'] })
  insertPiece({ category: 'shoes', name: 'black suede lace-up shoes', colors: ['black'], reads_as: 'polished suede flats', formality: 'elevated', occasions: ['city', 'smart casual', 'evening', 'gallery / art event'] })
  insertPiece({ category: 'shoes', name: 'cream leather mules', colors: ['cream'], reads_as: 'polished leather mules', formality: 'elevated', occasions: ['city', 'smart casual', 'evening', 'gallery / art event'] })
  insertPiece({ category: 'shoes', name: 'navy low block heels', colors: ['navy'], reads_as: 'low block heels', formality: 'elevated', occasions: ['city', 'smart casual', 'evening', 'gallery / art event'] })

  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const cap = planTotalOutfitCapForBudget(24)
  const slots = normalizePlanSlots([
    { label: 'Smart Casual Brunch', occasion: 'smart casual', count: 2, weather: 'warm' },
    { label: 'Beach Day', occasion: 'casual', count: 1, weather: 'warm' },
    { label: 'Everyday City Outing', occasion: 'city', activity: 'walking', count: 3, weather: 'warm' },
    { label: 'Gallery Visit', occasion: 'gallery / art event', count: 1, weather: 'warm' },
    { label: 'Casual Dinner', occasion: 'casual', count: 2, weather: 'warm' },
    { label: 'Outdoor Market', occasion: 'outdoor_daytime_social', activity: 'walking', count: 2, weather: 'warm' },
  ], { fallbackWeather: 'warm', maxSlots: cap, maxTotalOutfits: cap })
  const roster = selectCapsuleRoster(pool, { budget: 24, isSummer: true, occasions: slots.map(slot => slot.occasion), slots })
  const rosterShoes = roster.filter(piece => wardrobeCategoryGroup(piece) === 'shoes')
  const elevatedShoes = rosterShoes.filter(piece => piece.formality === 'elevated')

  assert.equal(slots.find(slot => slot.label === 'Casual Dinner')?.occasion, 'evening')
  assert.ok(rosterShoes.length >= 4, `24-piece capsules should have room for more shoe variety, got ${rosterShoes.map(piece => piece.name)}`)
  assert.ok(elevatedShoes.length >= 3, `brunch/gallery/dinner demand should reserve multiple elevated shoes, got ${rosterShoes.map(piece => `${piece.name}:${piece.formality}`)}`)
})

test('selectCapsuleRoster leaves the roster unchanged when no demanding activity is present', async () => {
  db.prepare("DELETE FROM pieces").run()
  for (const name of ['white cotton tee', 'olive cotton tank', 'striped linen shirt']) {
    insertPiece({ category: 'top', name, colors: ['white'], reads_as: 'easy casual top', occasions: ['casual', 'city'], formality: 'everyday' })
  }
  for (const name of ['black cotton pants', 'linen wide-leg pants', 'denim straight jeans']) {
    insertPiece({ category: 'bottom', name, colors: ['black'], reads_as: 'easy casual bottom', occasions: ['casual', 'city'], formality: 'everyday' })
  }
  insertPiece({ category: 'dress', name: 'olive day dress', colors: ['olive'], reads_as: 'easy day dress', occasions: ['casual', 'city'], formality: 'everyday' })
  insertPiece({ category: 'outerwear', name: 'light cotton jacket', colors: ['navy'], reads_as: 'light casual jacket', occasions: ['casual', 'city'], formality: 'everyday' })
  insertPiece({ category: 'shoes', name: 'navy canvas flats', colors: ['navy'], reads_as: 'easy flats', occasions: ['casual', 'city'], formality: 'everyday', heel_height: 'flat', walk_support: 'medium' })
  insertPiece({ category: 'shoes', name: 'white city sneakers', colors: ['white'], reads_as: 'city sneakers', occasions: ['casual', 'city'], formality: 'everyday', heel_height: 'flat', walk_support: 'medium' })
  insertPiece({ category: 'shoes', name: 'black polished loafers', colors: ['black'], reads_as: 'polished loafers', occasions: ['city'], formality: 'elevated', heel_height: 'flat', walk_support: 'medium' })

  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const noActivitySlots = normalizePlanSlots([
    { label: 'Casual Day', occasion: 'casual', activity: 'none', count: 1 },
  ])
  const baseline = selectCapsuleRoster(pool, { budget: 8, isSummer: true, occasions: noActivitySlots.map(slot => slot.occasion), slots: [] })
  const withSlots = selectCapsuleRoster(pool, { budget: 8, isSummer: true, occasions: noActivitySlots.map(slot => slot.occasion), slots: noActivitySlots })

  assert.deepEqual(withSlots.map(piece => Number(piece.id)), baseline.map(piece => Number(piece.id)))
})

test('selectCapsuleRoster reserves activity-safe hiking footwear alongside elevated shoes', async () => {
  db.prepare("DELETE FROM pieces").run()
  for (const name of ['white cotton tee', 'olive cotton tank', 'striped linen shirt', 'black silk blouse']) {
    insertPiece({ category: 'top', name, colors: ['white'], reads_as: 'capsule top', occasions: ['casual', 'city', 'evening'], formality: name.includes('silk') ? 'elevated' : 'everyday' })
  }
  for (const name of ['black cotton pants', 'linen wide-leg pants', 'denim straight jeans', 'tailored black trousers']) {
    insertPiece({ category: 'bottom', name, colors: ['black'], reads_as: 'capsule bottom', occasions: ['casual', 'city', 'evening'], formality: name.includes('tailored') ? 'elevated' : 'everyday' })
  }
  insertPiece({ category: 'dress', name: 'olive day dress', colors: ['olive'], reads_as: 'easy day dress', occasions: ['casual', 'city'], formality: 'everyday' })
  insertPiece({ category: 'outerwear', name: 'light cotton jacket', colors: ['navy'], reads_as: 'light casual jacket', occasions: ['casual', 'city'], formality: 'everyday' })
  insertPiece({ category: 'shoes', name: 'black low heels', colors: ['black'], reads_as: 'polished low heels', occasions: ['city', 'evening'], formality: 'elevated', heel_height: 'low', walk_support: 'medium' })
  insertPiece({ category: 'shoes', name: 'cream leather mules', colors: ['cream'], reads_as: 'polished mules', occasions: ['city', 'evening'], formality: 'elevated', heel_height: 'low', walk_support: 'medium' })
  insertPiece({ category: 'shoes', name: 'navy canvas flats', colors: ['navy'], reads_as: 'easy flats', occasions: ['casual', 'city'], formality: 'everyday', heel_height: 'flat', walk_support: 'low' })
  insertPiece({ category: 'shoes', name: 'magenta trail sneakers', colors: ['magenta'], reads_as: 'trail sneakers', occasions: ['casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })

  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Morning Hike', occasion: 'casual', activity: 'hiking', count: 1 },
    { label: 'Dinner Out', occasion: 'evening', activity: 'none', count: 2 },
  ])
  const roster = selectCapsuleRoster(pool, { budget: 24, isSummer: true, occasions: slots.map(slot => slot.occasion), slots })
  const rosterNames = roster.map(piece => piece.name)
  const rosterShoes = roster.filter(piece => wardrobeCategoryGroup(piece) === 'shoes')

  assert.ok(rosterNames.includes('magenta trail sneakers'), `hiking demand should reserve a high-support flat shoe, got ${rosterShoes.map(piece => `${piece.name}:${piece.heel_height}/${piece.walk_support}`)}`)
  assert.ok(rosterShoes.some(piece => piece.formality === 'elevated'), `elevated shoe reserve should still hold, got ${rosterShoes.map(piece => `${piece.name}:${piece.formality}`)}`)
})

// Part 6 fixture: exactly the live decisive-probe shape — a slip-on that
// satisfies no shoe demand at all, a wedge that only satisfies the elevated
// floor, and an athletic sneaker that only satisfies activity demands (hiking
// AND walking at once). budget 10 -> capsuleQuotas gives quotas.shoes = 2, so
// the mountain-capsule bug (elevated-floor reserve evicting the shoe the
// activity reserve just installed) reproduces deterministically here.
function seedShoeReserveFixture() {
  db.prepare('DELETE FROM pieces').run()
  for (const name of ['white cotton tee', 'olive cotton tank', 'striped linen shirt']) {
    insertPiece({ category: 'top', name, colors: ['white'], reads_as: 'capsule top', occasions: ['casual', 'city', 'smart casual'], formality: 'everyday' })
  }
  for (const name of ['black cotton pants', 'linen wide-leg pants', 'denim straight jeans']) {
    insertPiece({ category: 'bottom', name, colors: ['black'], reads_as: 'capsule bottom', occasions: ['casual', 'city', 'smart casual'], formality: 'everyday' })
  }
  insertPiece({ category: 'dress', name: 'olive day dress', colors: ['olive'], reads_as: 'easy day dress', occasions: ['casual', 'city'], formality: 'everyday' })
  insertPiece({ category: 'outerwear', name: 'light cotton jacket', colors: ['navy'], reads_as: 'light casual jacket', occasions: ['casual', 'city'], formality: 'everyday' })
  insertPiece({ category: 'shoes', name: 'tan canvas slip-on shoes', colors: ['tan'], reads_as: 'easy slip-on shoes', occasions: ['casual', 'city'], formality: 'everyday', heel_height: 'flat', walk_support: 'medium' })
  insertPiece({ category: 'shoes', name: 'black wedge sandals', colors: ['black'], reads_as: 'polished wedge sandals', occasions: ['city', 'smart casual'], formality: 'elevated', heel_height: 'high', walk_support: 'medium' })
  insertPiece({ category: 'shoes', name: 'grey athletic trail sneakers', colors: ['grey'], reads_as: 'rugged trail sneakers', occasions: ['casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  return db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
}

test('capsule shoe reserve keeps BOTH a hiking-passing shoe and an elevated shoe instead of evicting one for the other', async () => {
  const pool = seedShoeReserveFixture()
  const slots = normalizePlanSlots([
    { label: 'Hike Day 1', occasion: 'casual', activity: 'hiking', count: 1 },
    { label: 'Hike Day 2', occasion: 'casual', activity: 'hiking', count: 1 },
    { label: 'Town Stroll', occasion: 'city', activity: 'walking', count: 1 },
    { label: 'Smart Casual Dinner', occasion: 'smart casual', count: 1 },
  ])
  const roster = selectCapsuleRoster(pool, { budget: 10, occasions: slots.map(slot => slot.occasion), slots })
  const rosterShoes = roster.filter(piece => wardrobeCategoryGroup(piece) === 'shoes')
  const rosterNames = rosterShoes.map(piece => piece.name)

  assert.ok(rosterNames.includes('grey athletic trail sneakers'), `hiking guarantee must survive the elevated-floor pass, got ${rosterNames}`)
  assert.ok(rosterShoes.some(piece => piece.formality === 'elevated'), `elevated guarantee must also hold, got ${rosterNames}`)
  assert.ok(!rosterNames.includes('tan canvas slip-on shoes'), `the zero-demand slip-on is the correct eviction, got ${rosterNames}`)
  assert.equal(roster.shoeReserveGaps, undefined, 'a 2-shoe quota comfortably covers hiking + elevated; no gap expected')
})

test('capsule shoe reserve without a demanding activity keeps today\'s elevated-only behavior', async () => {
  const pool = seedShoeReserveFixture()
  const slots = normalizePlanSlots([
    { label: 'Smart Casual Dinner', occasion: 'smart casual', count: 1 },
  ])
  const roster = selectCapsuleRoster(pool, { budget: 10, occasions: slots.map(slot => slot.occasion), slots })
  const rosterNames = roster.filter(piece => wardrobeCategoryGroup(piece) === 'shoes').map(piece => piece.name)

  assert.ok(rosterNames.includes('black wedge sandals'), `elevated reserve should still pick the wedge, got ${rosterNames}`)
})

test('capsule shoe reserve without an elevated demand keeps the Part 7 hiking-only behavior', async () => {
  const pool = seedShoeReserveFixture()
  const slots = normalizePlanSlots([
    { label: 'Hike Day 1', occasion: 'casual', activity: 'hiking', count: 1 },
    { label: 'Hike Day 2', occasion: 'casual', activity: 'hiking', count: 1 },
  ])
  const roster = selectCapsuleRoster(pool, { budget: 10, occasions: slots.map(slot => slot.occasion), slots })
  const rosterNames = roster.filter(piece => wardrobeCategoryGroup(piece) === 'shoes').map(piece => piece.name)

  assert.ok(rosterNames.includes('grey athletic trail sneakers'), `hiking reserve should still pick the trail sneaker, got ${rosterNames}`)
})

test('an over-constrained shoe quota keeps the best assignment and discloses the coverage gap instead of silently dropping a demand', async () => {
  db.prepare('DELETE FROM pieces').run()
  for (const name of ['white cotton tee', 'olive cotton tank', 'striped linen shirt']) {
    insertPiece({ category: 'top', name, colors: ['white'], reads_as: 'capsule top', occasions: ['casual', 'city', 'smart casual', 'evening'], formality: 'everyday' })
  }
  for (const name of ['black cotton pants', 'linen wide-leg pants', 'denim straight jeans']) {
    insertPiece({ category: 'bottom', name, colors: ['black'], reads_as: 'capsule bottom', occasions: ['casual', 'city', 'smart casual', 'evening'], formality: 'everyday' })
  }
  insertPiece({ category: 'dress', name: 'olive day dress', colors: ['olive'], reads_as: 'easy day dress', occasions: ['casual', 'city'], formality: 'everyday' })
  insertPiece({ category: 'outerwear', name: 'light cotton jacket', colors: ['navy'], reads_as: 'light casual jacket', occasions: ['casual', 'city'], formality: 'everyday' })
  insertPiece({ category: 'shoes', name: 'grey athletic trail sneakers', colors: ['grey'], reads_as: 'rugged trail sneakers', occasions: ['casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  insertPiece({ category: 'shoes', name: 'black wedge sandals', colors: ['black'], reads_as: 'polished wedge sandals', occasions: ['city', 'smart casual', 'evening'], formality: 'elevated', heel_height: 'high', walk_support: 'medium' })
  insertPiece({ category: 'shoes', name: 'cream block heel mules', colors: ['cream'], reads_as: 'polished block heel mules', occasions: ['city', 'smart casual', 'evening'], formality: 'elevated', heel_height: 'high', walk_support: 'medium' })

  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  // 1 hiking demand + 3 elevated-wanting slots (elevatedShoeLooks=3 -> required 2)
  // against a 2-shoe quota: 3 distinct demand-slots can never fit in 2 shoes.
  const slots = normalizePlanSlots([
    { label: 'Hike Day 1', occasion: 'casual', activity: 'hiking', count: 1 },
    { label: 'Hike Day 2', occasion: 'casual', activity: 'hiking', count: 1 },
    { label: 'Smart Casual Brunch', occasion: 'smart casual', count: 1 },
    { label: 'Gallery Visit', occasion: 'gallery / art event', count: 1 },
    { label: 'Dinner Out', occasion: 'evening', count: 1 },
  ])
  const roster = selectCapsuleRoster(pool, { budget: 10, occasions: slots.map(slot => slot.occasion), slots })
  const rosterShoes = roster.filter(piece => wardrobeCategoryGroup(piece) === 'shoes')

  assert.ok(rosterShoes.some(piece => piece.name === 'grey athletic trail sneakers'), `hiking is the narrower, single-shoe demand and should still be kept, got ${rosterShoes.map(piece => piece.name)}`)
  assert.ok(rosterShoes.some(piece => piece.formality === 'elevated'), `at least one elevated shoe should still be kept as the best assignment, got ${rosterShoes.map(piece => piece.name)}`)
  assert.ok(Array.isArray(roster.shoeReserveGaps) && roster.shoeReserveGaps.length, `an unfillable demand should be disclosed, not silently dropped, got ${JSON.stringify(roster.shoeReserveGaps)}`)
  assert.match(roster.shoeReserveGaps[0], /\[missing wardrobe gap:.*dressy\/elevated look/)
})

test('capsule pool rejection names the curated roster, not "active", when the piece is genuinely a real wardrobe item', async () => {
  const pool = seedShoeReserveFixture()
  const slots = normalizePlanSlots([
    { label: 'Smart Casual Dinner', occasion: 'smart casual', count: 1 },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces: pool, question: 'a 10-piece capsule', constraints: { piece_budget: 10 } })
  const rosterIds = new Set(workbench.slots[0].allowed_piece_ids)
  const outsideRosterPiece = pool.find(piece => !rosterIds.has(Number(piece.id)))
  assert.ok(outsideRosterPiece, 'fixture needs at least one active piece the curated roster excluded')

  const slot = workbench.pendingPlan.slots[0]
  const anyRosterIds = idsForSlot(slot)
  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(outsideRosterPiece.id), anyRosterIds.get('bottom'), anyRosterIds.get('shoes')],
  }])

  assert.equal(result.accepted.length, 0)
  assert.match(result.failures[0].reasons.join(' '), /outside this capsule's curated 10-piece roster/)
  assert.doesNotMatch(result.failures[0].reasons.join(' '), /not an active wardrobe piece/)
})

test('selectCapsuleRoster reserves enough everyday-compatible pieces for repeated casual capsule demand', async () => {
  db.prepare("DELETE FROM pieces").run()
  for (const name of ['ivory silk shell', 'navy silk blouse', 'cream satin camisole']) {
    insertPiece({ category: 'top', name, colors: ['ivory'], reads_as: 'polished elevated top', fabric_category: 'silk', fabric_weight: 'light', formality: 'elevated', occasions: ['casual', 'city'] })
  }
  for (const name of ['olive cotton tee', 'rust cotton tee']) {
    insertPiece({ category: 'top', name, colors: ['olive'], reads_as: 'easy everyday tee', fabric_category: 'cotton', fabric_weight: 'light', formality: 'everyday', occasions: ['casual', 'city'] })
  }
  for (const name of ['navy silk trousers', 'cream satin skirt', 'ivory draped pants']) {
    insertPiece({ category: 'bottom', name, colors: ['navy'], reads_as: 'polished elevated bottom', bottom_shape: 'straight', fabric_category: 'silk', fabric_weight: 'light', formality: 'elevated', occasions: ['casual', 'city'] })
  }
  for (const name of ['black cotton pants', 'denim straight jeans']) {
    insertPiece({ category: 'bottom', name, colors: ['black'], reads_as: 'easy everyday pants', bottom_shape: 'straight', fabric_category: 'cotton', fabric_weight: 'light', formality: 'everyday', occasions: ['casual', 'city'] })
  }
  insertPiece({ category: 'dress', name: 'olive cotton day dress', colors: ['olive'], reads_as: 'easy everyday dress', fabric_category: 'cotton', fabric_weight: 'light', formality: 'everyday', occasions: ['casual', 'city'] })
  insertPiece({ category: 'outerwear', name: 'navy technical hoodie', colors: ['navy'], reads_as: 'easy everyday hoodie', fabric_category: 'cotton', fabric_weight: 'light', formality: 'everyday', occasions: ['casual', 'city'] })
  insertPiece({ category: 'shoes', name: 'cream leather mules', colors: ['cream'], reads_as: 'polished mule', formality: 'elevated', occasions: ['casual', 'city'] })
  insertPiece({ category: 'shoes', name: 'navy low heels', colors: ['navy'], reads_as: 'polished low heel', formality: 'elevated', occasions: ['casual', 'city'] })
  insertPiece({ category: 'shoes', name: 'white canvas sneakers', colors: ['white'], reads_as: 'easy everyday sneakers', formality: 'everyday', occasions: ['casual', 'city'] })
  insertPiece({ category: 'shoes', name: 'tan canvas slip-ons', colors: ['tan'], reads_as: 'easy everyday slip ons', formality: 'everyday', occasions: ['casual', 'city'] })

  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Beach Day 1', occasion: 'casual', activity: 'none', count: 1 },
    { label: 'Beach Day 2', occasion: 'casual', activity: 'none', count: 1 },
    { label: 'City Outing 1', occasion: 'casual', activity: 'walking', count: 1 },
    { label: 'City Outing 2', occasion: 'casual', activity: 'walking', count: 1 },
  ])
  const roster = selectCapsuleRoster(pool, { budget: 10, isSummer: true, occasions: slots.map(slot => slot.occasion), slots })
  const everydayByGroup = group => roster.filter(piece => wardrobeCategoryGroup(piece) === group && piece.formality === 'everyday')

  assert.ok(everydayByGroup('top').length >= 2, `repeated casual demand needs multiple everyday tops, got ${roster.map(piece => piece.name)}`)
  assert.ok(everydayByGroup('bottom').length >= 2, `repeated casual demand needs multiple everyday bottoms, got ${roster.map(piece => piece.name)}`)
  assert.ok(everydayByGroup('shoes').length >= 2, `repeated casual demand needs multiple everyday shoes, got ${roster.map(piece => piece.name)}`)
  assert.ok(roster.length <= 10, `register reserves must stay inside the capsule budget, got ${roster.length}`)
})

test('beach coastal slot ignores contradictory indoor weather from the model', () => {
  const slots = normalizePlanSlots([
    { label: 'Beach Day', occasion: 'outdoor_daytime_social', activity: 'walking', count: 1, weather: 'indoor', best_for: 'spending time at the beach' },
  ], { fallbackWeather: 'hot weather' })

  assert.equal(slots[0].environment, 'beach_coastal')
  assert.equal(slots[0].statedWeather, '')
  assert.equal(slots[0].season, 'hot weather')
})

// --- Follow-up replan path diagnostics (step 8's second half) ----------------

// --- Per-slot coverage gaps (capsule review Point 2) --------------------------

// A slot the wardrobe can't fill used to just come back thin (fewer cards, no
// explanation) or entirely absent, with no deterministic signal for the model
// to notice or explain. These prove composeOutfitSet now surfaces an explicit
// "[missing wardrobe gap: ...]" plan line (the model's existing, established
// convention for gaps) for both the "not enough variety" and "nothing at all"
// cases, and stays silent when a slot IS fully covered.

// --- Shoe rotation + season-appropriate shoes (capsule deferred item) -------

// Live-test finding (2026-07-14): a 14-piece capsule composed with a single
// pair of shoes worn in every look. Root cause: reuse:'maximize' scored ANY
// already-used piece as reuse "savings," so once a shoe was picked, reusing it
// scored higher than any alternative shoe on every later pass and the roster's
// other shoe options never got picked at all. Packing-light reuse still makes
// sense for tops/bottoms/outerwear (fewer garments to carry); shoes aren't a
// packing cost (you bring the pair regardless) and repeating one pair across a
// whole capsule reads as an oversight. Fix: score 'maximize' reuse on non-shoe
// pieces only, and break ties toward whichever roster shoe has been used least.
// Owner correction (2026-07-14): an earlier framing of this same live-test
// finding assumed "suede" itself should be treated as a cold-weather signal.
// That was wrong — suede pumps and suede hiking boots both exist, and a
// material name alone says nothing about season. The wardrobe's own `season`
// tag ('warm'/'cool'/'year-round', set per piece by the owner) is the actual
// signal to use. Also proves the rehydration fix: candidate generation trims
// outfit.pieces to {id, name, category, photo, worn_photo} before scoring, so
// without rehydrating full pieces first, `shoe.season` would be undefined and
// this scorer could never fire regardless of which piece is "more correct."
// --- Plan-level total-outfit cap trim notice ---------------------------------

// Live-test finding (2026-07-14): a 5-slot capsule plan asked for 10 outfits
// total (3+2+2+2+1); PLAN_TOTAL_OUTFIT_CAP silently trimmed two slots down to
// 1 look each before composeOutfitSet ever ran, and NOTHING told the user or
// the model that 2 of the 10 requested outfits were dropped — not an error,
// not a plan line, nothing. This is a different cause from the coverage-gap
// lines (capsule review Point 2): those fire when the WARDROBE can't fill the
// (already-trimmed) count; this fires when the PLAN itself asked for more
// than the cap allows, regardless of what the wardrobe could have supplied.
test('normalizePlanSlots records the original count on a slot the total-outfit cap trims', () => {
  const slots = normalizePlanSlots([
    { label: 'Everyday City Outing', occasion: 'city', activity: 'walking', count: 3 },
    { label: 'Casual Evening Out', occasion: 'evening', activity: 'none', count: 2 },
    { label: 'Smart Casual Day', occasion: 'smart casual', activity: 'none', count: 2 },
    { label: 'Beach Day', occasion: 'outdoor_daytime_social', activity: 'none', count: 2 },
    { label: 'Gallery Visit', occasion: 'city', activity: 'walking', count: 1 },
  ], { fallbackWeather: 'warm' })

  const total = slots.reduce((sum, slot) => sum + slot.targetOutfits, 0)
  assert.equal(total, PLAN_TOTAL_OUTFIT_CAP, `trimmed total should land exactly on the cap, got ${total}`)

  const byLabel = Object.fromEntries(slots.map(slot => [slot.label, slot]))
  assert.equal(byLabel['Smart Casual Day'].targetOutfits, 1)
  assert.equal(byLabel['Smart Casual Day'].requestedOutfits, 2, 'the original ask must survive the trim for reporting')
  assert.equal(byLabel['Beach Day'].targetOutfits, 1)
  assert.equal(byLabel['Beach Day'].requestedOutfits, 2)
  // Untouched slots must NOT carry a requestedOutfits value — that field is
  // the trim signal itself; describePlanCapTrim treats its presence as "this
  // slot was cut," so a slot the cap never touched must not set it.
  assert.equal(byLabel['Everyday City Outing'].requestedOutfits, undefined)
  assert.equal(byLabel['Gallery Visit'].requestedOutfits, undefined)
})

test('normalizePlanSlots allows 8 one-look use cases and drops the 9th with disclosure metadata', () => {
  const slots = normalizePlanSlots([
    { label: 'Smart Casual 1', occasion: 'smart casual', count: 1 },
    { label: 'Smart Casual 2', occasion: 'smart casual', count: 1 },
    { label: 'Beach Day 1', occasion: 'casual', count: 1 },
    { label: 'Beach Day 2', occasion: 'casual', count: 1 },
    { label: 'City Outing 1', occasion: 'city', count: 1 },
    { label: 'City Outing 2', occasion: 'city', count: 1 },
    { label: 'Gallery Visit', occasion: 'gallery / art event', count: 1 },
    { label: 'Casual Dinner', occasion: 'evening', count: 1 },
    { label: 'Extra Museum Stop', occasion: 'city', count: 1 },
  ], { fallbackWeather: 'warm' })

  assert.equal(slots.length, PLAN_TOTAL_OUTFIT_CAP, '8 one-look slots should be attempted')
  assert.deepEqual(slots.map(slot => slot.label), [
    'Smart Casual 1',
    'Smart Casual 2',
    'Beach Day 1',
    'Beach Day 2',
    'City Outing 1',
    'City Outing 2',
    'Gallery Visit',
    'Casual Dinner',
  ])
  assert.deepEqual(slots.droppedSlotLabels, ['Extra Museum Stop'])
})

test('normalizePlanSlots lets larger seasonal capsules request more than 8 outfit cards', () => {
  const cap = planTotalOutfitCapForBudget(24)
  const slots = normalizePlanSlots([
    { label: 'Smart Casual Brunch', occasion: 'smart casual', count: 3, weather: 'indoor' },
    { label: 'Beach Day', occasion: 'outdoor_daytime_social', count: 2, weather: 'warm weather' },
    { label: 'City Outings', occasion: 'city', activity: 'walking', count: 3, weather: 'warm weather' },
    { label: 'Gallery Visits', occasion: 'gallery / art event', count: 2, weather: 'warm weather' },
    { label: 'Casual Dinners', occasion: 'evening', count: 2, weather: 'warm weather' },
    { label: 'Outdoor Markets', occasion: 'outdoor_daytime_social', count: 2, weather: 'warm weather' },
  ], {
    fallbackWeather: 'warm summer weather',
    maxSlots: cap,
    maxTotalOutfits: cap,
  })

  assert.equal(cap, 16)
  assert.equal(slots.reduce((sum, slot) => sum + slot.targetOutfits, 0), 14)
  assert.ok(slots.every(slot => !slot.requestedOutfits), `24-piece seasonal capsule should not hit the compact 8-card trim, got ${JSON.stringify(slots)}`)
})

