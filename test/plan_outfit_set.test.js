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
const { STYLIST_TOOLS, executeTool, sanitizePlanConstraintsForQuestion, coercePlanOutfitSetSlotsArg, coerceSubmitPlanOutfitsArg } = await import('../styling-engine/tools.js')
const { normalizePlanSlots, normalizePlanConstraints, selectCapsuleRoster, buildCapsuleBench, validateCapsuleRoster, capsuleOutfitCoreCapacity, allocateCapsuleRepresentativeRotation, describeCapsuleCompositionShortfall, buildRejectedCapsuleCards, describeCapsuleSupplyGap, extractStatedPalette, selectCapsuleRosterViaModel, capsuleRosterPostConditions, enforceCapsulePostConditions, buildPlanSlotWorkbench, validateSubmittedPlanOutfits, assembleSubmittedPlanOutfits, describeOutfitStructureGap, mergePendingPlanForReplan, PLAN_TOTAL_OUTFIT_CAP, planTotalOutfitCapForBudget, capsuleTotalOutfitCap, reasonRevisesMidSentence } = await import('../styling-engine/outfitSetPlanner.js')
const { _clearWeatherCachesForTests } = await import('../styling-engine/weather.js')
const { parsePiece } = await import('../styling-engine/rules.js')
const { wardrobeCategoryGroup, pieceFormality, formalityRank } = await import('../styling-engine/attributes.js')
const { replayStylistToolScript, stylistToolsForTurn } = await import('../styling-engine/provider.js')
const { capsulePlanCompositionSchema } = await import('../routes/ai.js')

const topIdsOf = outfits => outfits.flatMap(outfit => (outfit.pieces || []).filter(piece => wardrobeCategoryGroup(piece) === 'top').map(piece => Number(piece.id)))
const distinctPieceCount = outfits => new Set(outfits.flatMap(outfit => outfit.pieceIds || [])).size

function planOutfitSetSlotSchema() {
  const tool = STYLIST_TOOLS.find(entry => entry.name === 'plan_outfit_set')
  return tool?.input_schema?.properties?.slots?.items || {}
}

// Spec 26 Part 4: propose_outfit's season field must teach the indoor
// escape hatch (mirrors the plan-slot weather:'indoor' mechanism, which
// weatherProfileFromContext already honors on this path — rules.js).
test('propose_outfit tool schema teaches season:"indoor" for climate-controlled occasions', () => {
  const tool = STYLIST_TOOLS.find(entry => entry.name === 'propose_outfit')
  const seasonDescription = tool?.input_schema?.properties?.season?.description || ''
  assert.match(seasonDescription, /season:'indoor'/)
  assert.match(seasonDescription, /office, restaurant, meeting, gallery/)
})

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

test('coerceSubmitPlanOutfitsArg recovers the live JSON-encoded outfits array', () => {
  const encoded = JSON.stringify([{
    slot_id: 'casual_indoor',
    piece_ids: [1, 2, 3],
    title: 'Indoor look'
  }])
  assert.deepEqual(coerceSubmitPlanOutfitsArg(encoded), [{
    slot_id: 'casual_indoor',
    piece_ids: [1, 2, 3],
    title: 'Indoor look'
  }])
  assert.deepEqual(coerceSubmitPlanOutfitsArg([{ slot_id: 'already_array' }]), [{ slot_id: 'already_array' }])
  assert.equal(coerceSubmitPlanOutfitsArg('not json'), null)
})

test('provider-free replay exercises the complete capsule tool contract without an API key', async () => {
  const toolContext = {
    generatedOutfits: [],
    question: 'Build a 10-piece summer capsule for casual days',
    weather: 'warm'
  }
  const replay = await replayStylistToolScript({
    toolContext,
    steps: [
      { tool: 'declare_intent', args: { want: 'cards' } },
      {
        tool: 'plan_outfit_set',
        args: {
          slots: [{ label: 'Casual Days', occasion: 'casual', activity: 'none', count: 1 }],
          weather: 'warm',
          constraints: { reuse: 'maximize', piece_budget: 10 }
        }
      },
      {
        tool: 'submit_plan_outfits',
        args: ({ results }) => {
          const workbench = results.find(step => step.name === 'plan_outfit_set')?.result
          const slot = workbench.slots[0]
          const allowed = new Set(slot.allowed_piece_ids.map(Number))
          const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all()
            .map(parsePiece)
            .filter(piece => allowed.has(Number(piece.id)))
          const first = group => pieces.find(piece => wardrobeCategoryGroup(piece) === group)
          return {
            outfits: [{
              slot_id: slot.id,
              label: 'Replay Casual Look',
              piece_ids: [first('top')?.id, first('bottom')?.id, first('shoes')?.id].filter(Boolean),
              reason: 'A conventional solid casual combination for an offline contract replay.'
            }]
          }
        }
      },
      { final: 'Capsule replay complete.' }
    ]
  })

  assert.deepEqual(replay.results.map(step => step.name || step.type), [
    'declare_intent',
    'plan_outfit_set',
    'submit_plan_outfits',
    'final'
  ])
  const planResult = replay.results.find(step => step.name === 'plan_outfit_set').result
  const submitResult = replay.results.find(step => step.name === 'submit_plan_outfits').result
  assert.equal(planResult.status, 'slot_rosters')
  assert.equal(submitResult.status, 'success')
  assert.equal(toolContext.generatedOutfits.length, 1)
  const planLines = toolContext.generatedOutfits[0].tripPlanLines.join(' ')
  assert.match(planLines, /Piece roster \(\d+\)/, 'the report must describe the curated roster, not only pieces used by the displayed card')
  assert.match(planLines, /Roster capacity: \d+ distinct gate-valid outfit cores.*showing 1 representative look/)
  assert.equal(toolContext.freeformDiagnostics.providerIterations, 0)
})

test('an enforced capsule uses one injected atomic composition attempt and cannot enter the submit/replan loop', async () => {
  let compositionCalls = 0
  const toolContext = {
    declaredIntent: { want: 'cards' },
    generatedOutfits: [],
    question: 'Build a 10-piece summer capsule for casual days',
    weather: 'warm',
    composeCapsulePlanOnce: async workbench => {
      compositionCalls += 1
      const slot = workbench.slots[0]
      const allowed = new Set(slot.allowed_piece_ids.map(Number))
      const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all()
        .map(parsePiece)
        .filter(piece => allowed.has(Number(piece.id)))
      const first = group => pieces.find(piece => wardrobeCategoryGroup(piece) === group)
      return [{
        slot_id: slot.id,
        piece_ids: [first('top')?.id, first('bottom')?.id, first('shoes')?.id].filter(Boolean),
        title: 'Atomic Casual Look',
        reason: 'A complete conventional capsule formula.'
      }]
    }
  }

  const result = await executeTool('plan_outfit_set', {
    plan_kind: 'seasonal_capsule',
    slots: [{ label: 'Casual Days', occasion: 'casual', activity: 'none', environment: 'indoor', count: 1 }],
    weather: 'warm',
    constraints: { reuse: 'maximize', piece_budget: 10 }
  }, toolContext)

  assert.equal(result.status, 'success')
  assert.equal(result.bounded_composition, true)
  assert.equal(compositionCalls, 1)
  assert.equal(toolContext.generatedOutfits.length, 1)
  assert.equal(toolContext.pendingPlan, null)
  assert.equal(toolContext.freeformDiagnostics.submitPlanCalls, 1)

  const lateSubmit = await executeTool('submit_plan_outfits', { outfits: [] }, toolContext)
  assert.equal(lateSubmit.status, 'validation_error')
  assert.match(lateSubmit.message, /No pending plan rosters/)

  const retry = await executeTool('plan_outfit_set', {
    plan_kind: 'seasonal_capsule',
    slots: [{ label: 'Casual Days Again', occasion: 'casual', activity: 'none', count: 1 }],
    constraints: { reuse: 'maximize', piece_budget: 10 }
  }, toolContext)
  assert.equal(retry.status, 'validation_error')
  assert.match(retry.message, /already used its one bounded capsule-composition attempt/)
  assert.equal(compositionCalls, 1)
})

test('an empty atomic capsule result is an engine error and cannot masquerade as a successful zero-card plan', async () => {
  const toolContext = {
    declaredIntent: { want: 'cards' },
    generatedOutfits: [],
    question: 'I want a summer capsule',
    weather: 'warm',
    composeCapsulePlanOnce: async () => []
  }

  const result = await executeTool('plan_outfit_set', {
    plan_kind: 'seasonal_capsule',
    slots: [{ label: 'Everyday Summer', occasion: 'casual', activity: 'none', count: 2 }],
    weather: 'warm',
    constraints: { reuse: 'maximize', piece_budget: 10 }
  }, toolContext)

  assert.equal(result.status, 'error')
  assert.equal(result.bounded_composition, true)
  assert.match(result.message, /returned no outfits/)
  assert.match(result.message, /Do not build the capsule manually/)
  assert.equal(toolContext.capsuleAtomicCompleted, true)
  assert.deepEqual(stylistToolsForTurn(toolContext), [])
  assert.equal(toolContext.generatedOutfits.length, 0)
})

test('atomic capsule schema requires the complete target rotation instead of permitting an empty array', () => {
  const schema = capsulePlanCompositionSchema(12)
  assert.equal(schema.properties.outfits.minItems, 12)
  assert.equal(schema.properties.outfits.maxItems, 12)
  assert.deepEqual(schema.required, ['outfits'])
})

test('atomic capsule validation details stay in diagnostics instead of production plan notes', async () => {
  const toolContext = {
    declaredIntent: { want: 'cards' },
    generatedOutfits: [],
    question: 'Build a summer capsule',
    weather: 'warm',
    composeCapsulePlanOnce: async workbench => {
      const slot = workbench.slots[0]
      const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all()
        .map(parsePiece)
        .filter(piece => new Set(slot.allowed_piece_ids.map(Number)).has(Number(piece.id)))
      const first = group => pieces.find(piece => wardrobeCategoryGroup(piece) === group)
      return [{
        slot_id: slot.id,
        piece_ids: [first('top')?.id, first('bottom')?.id, first('shoes')?.id].filter(Boolean),
        title: 'One accepted look',
        reason: 'One valid representative look.'
      }]
    }
  }

  const result = await executeTool('plan_outfit_set', {
    plan_kind: 'seasonal_capsule',
    slots: [{ label: 'Everyday Summer', occasion: 'casual', activity: 'none', count: 2 }],
    weather: 'warm',
    constraints: { reuse: 'maximize', piece_budget: 10 }
  }, toolContext)

  assert.equal(result.status, 'success')
  assert.equal(toolContext.generatedOutfits.length, 1)
  assert.equal(toolContext.freeformDiagnostics.submitPlanValidationFails, 1)
  assert.doesNotMatch(result.message, /gap|failure|rejected|unfilled/i)
  assert.ok(!('validation_failures' in result))
  const publicNotes = toolContext.generatedOutfits[0].tripPlanLines.join(' ')
  assert.doesNotMatch(publicNotes, /\[(?:capsule|coverage) gap:/i)
  assert.doesNotMatch(publicNotes, /validation|bounded composition|unfilled/i)
})

test('an unnumbered seasonal capsule gets the owner-ruled 24-piece working ceiling', async () => {
  let capturedBudget = 0
  const toolContext = {
    declaredIntent: { want: 'cards' },
    generatedOutfits: [],
    question: 'I want a summer capsule',
    weather: 'summer',
    composeCapsulePlanOnce: async workbench => {
      capturedBudget = Number(workbench.constraints?.piece_budget) || 0
      const slot = workbench.slots[0]
      const allowed = new Set(slot.allowed_piece_ids.map(Number))
      const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all()
        .map(parsePiece)
        .filter(piece => allowed.has(Number(piece.id)))
      const first = group => pieces.find(piece => wardrobeCategoryGroup(piece) === group)
      return [{
        slot_id: slot.id,
        piece_ids: [first('top')?.id, first('bottom')?.id, first('shoes')?.id].filter(Boolean),
        title: 'Summer Core',
        reason: 'A conventional summer capsule formula.'
      }]
    }
  }

  const result = await executeTool('plan_outfit_set', {
    plan_kind: 'seasonal_capsule',
    slots: [{ label: 'Everyday Summer', occasion: 'casual', activity: 'none', count: 1 }]
  }, toolContext)

  assert.equal(result.status, 'success')
  assert.equal(capturedBudget, 24)
  assert.equal(toolContext.capsuleAtomicCompleted, true)
})

test('a budgeted trip remains on the trip workbench and never enters capsule composition', async () => {
  let compositionCalls = 0
  const toolContext = {
    declaredIntent: { want: 'cards' },
    generatedOutfits: [],
    question: 'Pack at most 12 pieces for a week in Tucson',
    weather: 'hot',
    composeCapsulePlanOnce: async () => {
      compositionCalls += 1
      return []
    }
  }

  const result = await executeTool('plan_outfit_set', {
    plan_kind: 'trip',
    slots: [{ label: 'Casual Days', occasion: 'casual', activity: 'walking', count: 2 }],
    constraints: { reuse: 'maximize', piece_budget: 12 }
  }, toolContext)

  assert.equal(result.status, 'slot_rosters')
  assert.equal(compositionCalls, 0)
  assert.equal(toolContext.capsuleAtomicAttempted, undefined)
  assert.equal(toolContext.pendingPlan.planKind, 'trip')
  assert.equal(toolContext.pendingPlan.isSeasonalCapsule, false)
  assert.deepEqual(toolContext.pendingPlan.capsuleRoster, [])
})

test('successful atomic capsule composition removes every tool from the final prose turn', () => {
  assert.ok(stylistToolsForTurn({}).length > 0)
  assert.deepEqual(stylistToolsForTurn({ capsuleAtomicCompleted: true }), [])
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
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'model mode cotton top', occasions: ['city', 'casual'], formality: 'everyday' })
  insertPiece({ category: 'bottom', name: 'model mode cotton pants', occasions: ['city', 'casual'], formality: 'everyday' })
  insertPiece({ category: 'shoes', name: 'model mode walking shoes', occasions: ['city', 'casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
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
})

test('casual indoor comfort wording cannot lower the structured casual ceiling to lounge', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'everyday indoor knit', occasions: ['casual'], formality: 'everyday' })
  const bottomId = insertPiece({ category: 'bottom', name: 'everyday indoor pants', occasions: ['casual'], formality: 'everyday' })
  const shoesId = insertPiece({ category: 'shoes', name: 'everyday indoor shoes', occasions: ['casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'winter capsule for casual indoor days' }

  const workbench = await executeTool('plan_outfit_set', {
    slots: [{
      label: 'Casual Indoor',
      occasion: 'casual',
      activity: 'none',
      weather: 'indoor',
      count: 1,
      best_for: 'Casual indoor days at home',
      plan_note: 'Comfort-first indoor base'
    }]
  }, toolContext)

  assert.equal(workbench.slots[0].register_ceiling, 'everyday')
  const allowed = new Set(workbench.slots[0].allowed_piece_ids)
  assert.ok(allowed.has(topId))
  assert.ok(allowed.has(bottomId))
  assert.ok(allowed.has(shoesId))
})

// --- Mode default flip (spec 19 Part 4) ----------------------------------------

test('plan_outfit_set defaults to model mode with no WARDROBE_PLAN_COMPOSE set', async () => {
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'default mode top', occasions: ['city', 'casual'], formality: 'everyday' })
  insertPiece({ category: 'bottom', name: 'default mode pants', occasions: ['city', 'casual'], formality: 'everyday' })
  insertPiece({ category: 'shoes', name: 'default mode shoes', occasions: ['city', 'casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'one city day outfit' }
  const workbench = await executeTool('plan_outfit_set', {
    slots: [{ label: 'City Day', occasion: 'city', activity: 'none', count: 1 }]
  }, toolContext)

  assert.equal(workbench.status, 'slot_rosters', 'no env var set should default to model mode')
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

// Weather provenance was invisible and inconsistent: a live forecast got a
// "(live forecast)" marker, but a heuristic guess — whether the coarse
// hot/cold/mild descriptor or the model's own free-text weather guess — got no
// marker at all, so both read with identical confidence in the plan lines the
// owner sees. Only the live branch should ever look authoritative.
test('plan slot weather label marks a heuristic guess as an estimate, not a live forecast', async () => {
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'weather label top', occasions: ['casual'], formality: 'everyday' })
  insertPiece({ category: 'bottom', name: 'weather label pants', occasions: ['casual'], formality: 'everyday' })
  insertPiece({ category: 'shoes', name: 'weather label shoes', occasions: ['casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)

  // No location/date resolves, so this is the generic-heuristic branch (falls
  // back to the coarse hot/cold/mild descriptor).
  const genericSlots = normalizePlanSlots([{ label: 'Desert Day', occasion: 'casual', activity: 'none', count: 1 }])
  const genericWorkbench = await buildPlanSlotWorkbench(genericSlots, { allPieces, question: 'a desert day' })
  assert.match(genericWorkbench.slots[0].weather_used, /\(estimated\)$/, `generic heuristic weather should be marked as an estimate, got "${genericWorkbench.slots[0].weather_used}"`)

  // Still heuristic (no location), but the model supplied its own weather
  // guess in prose — this is exactly the Tucson-plan case from the bugfix
  // spec: specific-sounding numbers with nothing behind them but the model's
  // own knowledge, previously indistinguishable from a real forecast.
  const wordedSlots = normalizePlanSlots([{ label: 'Desert Day', occasion: 'casual', activity: 'none', count: 1 }])
  wordedSlots[0].season = 'hot, highs 100-105F, sunny'
  const wordedWorkbench = await buildPlanSlotWorkbench(wordedSlots, { allPieces, question: 'a desert day' })
  assert.equal(wordedWorkbench.slots[0].weather_used, 'hot, highs 100-105F, sunny (estimated)', 'model-guessed weather text must also be marked as an estimate')

  // A real live forecast still gets its own distinct marker, not "(estimated)".
  const liveSlots = normalizePlanSlots([{ label: 'Coastal Day', occasion: 'casual', activity: 'none', count: 1, location: 'Cambria, CA' }])
  const liveWorkbench = await buildPlanSlotWorkbench(liveSlots, {
    allPieces,
    question: 'a coastal day',
    dateRange: { start: '2026-08-01', end: '2026-08-01' },
    fetchImpl: makePlanFetch()
  })
  assert.match(liveWorkbench.slots[0].weather_used, /\(live forecast, Cambria, CA\)$/, `live forecast should keep its own marker, got "${liveWorkbench.slots[0].weather_used}"`)
  assert.doesNotMatch(liveWorkbench.slots[0].weather_used, /\(estimated\)/, 'live forecast must not also carry the heuristic estimate marker')
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
// Part 3 (spec 23): the vibe-based wording still trended the wrong way (a
// follow-up re-run produced five different pairs of footwear across five
// outfits) — replaced with a checkable number.
test('model plan slot workbench instructions push reuse when reuseMode is maximize, and never otherwise', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'City Day', occasion: 'city', activity: 'none', count: 1 },
  ])

  const maximizeWorkbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day', constraints: { reuse: 'maximize' } })
  assert.match(maximizeWorkbench.instructions, /Reuse is set to maximize.*at most 3 pairs of shoes/)
  assert.match(maximizeWorkbench.instructions, /repeat bottoms across slots/)

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
  assert.match(reasons, /no piece meets the dressy register floor/)
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
  assert.match(reasons, /no piece meets the dressy register floor/)
  assert.match(reasons, /re-call plan_outfit_set with just this slot at a lower register/)
  assert.match(reasons, /no combination in this slot's roster can meet the dressy floor/)
})

// --- Register floor is an ANCHOR, not uniformity (spec 23 Part 2) -------------

test('a dressy anchor plus everyday supporting pieces clears the dressy floor on the first submit', async () => {
  db.prepare('DELETE FROM pieces').run()
  const blouseId = insertPiece({ category: 'top', name: 'silk blouse', occasions: ['city'], formality: 'dressy' })
  const trousersId = insertPiece({ category: 'bottom', name: 'everyday wide leg trousers', occasions: ['city'], formality: 'everyday' })
  const flatsId = insertPiece({ category: 'shoes', name: 'everyday flats', occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Thursday', occasion: 'city', activity: 'none', count: 1, register: 'dressy' },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'office week' })
  const slot = workbench.pendingPlan.slots[0]

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(blouseId), Number(trousersId), Number(flatsId)],
  }])

  assert.equal(result.failures.length, 0, `expected the dressy-anchor outfit to clear the floor, got ${JSON.stringify(result.failures)}`)
  assert.equal(result.accepted.length, 1)
})

test('an outfit with no floor-clearing main piece is still rejected, with the anchor wording', async () => {
  db.prepare('DELETE FROM pieces').run()
  const everydayTopId = insertPiece({ category: 'top', name: 'everyday top only', occasions: ['city'], formality: 'everyday' })
  const everydayBottomId = insertPiece({ category: 'bottom', name: 'everyday bottom only', occasions: ['city'], formality: 'everyday' })
  const dressyShoesId = insertPiece({ category: 'shoes', name: 'dressy shoes only', occasions: ['city'], formality: 'dressy', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Thursday', occasion: 'city', activity: 'none', count: 1, register: 'dressy' },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'office week' })
  const slot = workbench.pendingPlan.slots[0]

  // A dressy pair of shoes alone is not an anchor (shoes are excluded from
  // the anchor check) — no top/bottom/dress/outerwear here clears the floor.
  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(everydayTopId), Number(everydayBottomId), Number(dressyShoesId)],
  }])

  assert.equal(result.accepted.length, 0)
  const reasons = result.failures[0].reasons.join(' ')
  assert.match(reasons, /no piece meets the dressy register floor — include at least one dressy-or-better main piece/)
  assert.match(reasons, /re-call plan_outfit_set with just this slot at a lower register/)
})

test('an all-elevated outfit still fails a formal floor (ceremony guard unaffected)', async () => {
  db.prepare('DELETE FROM pieces').run()
  const elevatedTopId = insertPiece({ category: 'top', name: 'elevated evening top', occasions: ['evening'], formality: 'elevated' })
  const elevatedBottomId = insertPiece({ category: 'bottom', name: 'elevated evening pants', occasions: ['evening'], formality: 'elevated' })
  const elevatedShoesId = insertPiece({ category: 'shoes', name: 'elevated evening shoes', occasions: ['evening'], formality: 'elevated', heel_height: 'mid', walk_support: 'medium' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Ceremony', occasion: 'evening', activity: 'none', count: 1, register: 'formal' },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'wedding ceremony' })
  const slot = workbench.pendingPlan.slots[0]

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(elevatedTopId), Number(elevatedBottomId), Number(elevatedShoesId)],
  }])

  assert.equal(result.accepted.length, 0, 'all-elevated must not satisfy a formal floor even under anchor semantics')
  const reasons = result.failures[0].reasons.join(' ')
  assert.match(reasons, /no piece meets the formal register floor/)
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

test('model-composed plan titles survive assembly instead of being replaced by the slot label', () => {
  const pieces = [
    { id: 1, name: 'top', category: 'top' },
    { id: 2, name: 'pants', category: 'bottom' },
    { id: 3, name: 'shoes', category: 'shoes' }
  ]
  const assembled = assembleSubmittedPlanOutfits({
    slots: [{ id: 'casual_indoor', label: 'Casual Indoor', targetOutfits: 1, originalIndex: 0 }],
    constraints: {},
    slotWeather: []
  }, [{
    _slotId: 'casual_indoor',
    title: 'Olive Base Day',
    pieces,
    pieceIds: [1, 2, 3],
    reason: 'Authored reason.'
  }])
  assert.equal(assembled[0].title, 'Olive Base Day')
  assert.equal(assembled[0].label, 'Casual Indoor')
})

test('assembled capsule cards persist the bounded roster and slot context needed for one-call expansion', () => {
  const pieces = [
    { id: 1, name: 'top', category: 'top' },
    { id: 2, name: 'pants', category: 'bottom' },
    { id: 3, name: 'shoes', category: 'shoes' }
  ]
  const slot = {
    id: 'casual_indoor',
    label: 'Casual Indoor',
    occasion: 'casual',
    activity: 'none',
    environment: 'indoor',
    targetOutfits: 1,
    capsuleSlotCapacity: 1,
    originalIndex: 0,
    weatherLabel: 'indoor',
    weatherProfile: {},
    gateAllowedIds: new Set([1, 2, 3]),
  }
  const assembled = assembleSubmittedPlanOutfits({
    slots: [slot],
    constraints: { pieceBudget: 10 },
    slotWeather: [],
    capsuleRoster: pieces,
    capsuleCapacity: 4,
    isWinterCapsule: true,
  }, [{
    _slotId: slot.id,
    title: 'Indoor base',
    pieces,
    pieceIds: [1, 2, 3],
  }])

  assert.deepEqual(assembled[0].capsulePlanContext, {
    version: 1,
    piece_budget: 10,
    capacity: 4,
    roster_ids: [1, 2, 3],
    is_winter_capsule: true,
    slots: [{
      id: 'casual_indoor',
      label: 'Casual Indoor',
      occasion: 'casual',
      activity: 'none',
      environment: 'indoor',
      register: '',
      weather_label: 'indoor',
      weather_profile: {},
      core_capacity: 1,
      allowed_piece_ids: [1, 2, 3],
    }],
  })
})

test('capsule workbench states validator requirements before the model composes', async () => {
  const allPieces = [
    { id: 1, name: 'sleeveless base', category: 'top', sleeve_type: 'sleeveless', fabric_weight: 'medium', formality: 'everyday', occasions: ['casual'], status: 'active' },
    { id: 2, name: 'long sleeve top', category: 'top', sleeve_type: 'long', fabric_weight: 'medium', formality: 'everyday', occasions: ['casual'], status: 'active' },
    { id: 3, name: 'pants one', category: 'bottom', fabric_weight: 'medium', formality: 'everyday', occasions: ['casual'], status: 'active' },
    { id: 4, name: 'pants two', category: 'bottom', fabric_weight: 'medium', formality: 'everyday', occasions: ['casual'], status: 'active' },
    { id: 5, name: 'loafers', category: 'shoes', formality: 'everyday', occasions: ['casual'], status: 'active' },
    { id: 6, name: 'boots', category: 'shoes', formality: 'everyday', occasions: ['casual'], status: 'active' },
    { id: 7, name: 'warm cardigan', category: 'outerwear', reads_as: 'knit cardigan', fabric_weight: 'heavy', formality: 'everyday', occasions: ['casual'], status: 'active' },
    { id: 8, name: 'winter coat', category: 'outerwear', fabric_weight: 'heavy', formality: 'everyday', occasions: ['casual'], status: 'active' },
  ]
  const slots = [{
    id: 'casual_indoor',
    label: 'Casual Indoor',
    occasion: 'casual',
    activity: 'none',
    environment: 'indoor',
    weather: 'indoor',
    targetOutfits: 2,
    requestedOutfits: 2,
  }]
  const workbench = await buildPlanSlotWorkbench(slots, {
    allPieces,
    question: 'Build a 14-piece winter capsule and use reusable outerwear for transitions.',
    constraints: { piece_budget: 14, reuse: 'maximize' },
    planKind: 'seasonal_capsule',
  })
  const requirements = workbench.slots[0].submission_requirements.join(' ')

  assert.match(requirements, /exactly one top plus one bottom, OR one dress/)
  assert.match(requirements, /exactly one pair of shoes/)
  assert.match(requirements, /Outerwear never replaces the required top/)
  assert.match(requirements, /sleeveless top must include a medium\/heavy cardigan/)
  assert.match(requirements, /transition coverage/)
  assert.match(requirements, /at least two different eligible shoe pairs/)
})

// Task 1 (2026-07-28 capsule repro, thread_1785288370357): the atomic capsule
// composer validates once with no retry, and validateSubmittedPlanOutfits'
// activity-footwear exclusion (via footwearComfortVerdict) was never stated
// in submission_requirements — a walking slot could only discover "high heel
// unsuitable" by having a whole look rejected. Pin that the constraint is now
// stated in plain terms when a slot's resolved activity profile genuinely
// excludes something, and stays silent (a no-op) for a slot with no such
// activity, matching the brief's "must be a no-op otherwise" requirement.
test('capsule workbench states the activity-footwear requirement only for a slot whose activity profile excludes it', async () => {
  const allPieces = [
    { id: 1, name: 'top', category: 'top', formality: 'everyday', occasions: ['casual'], status: 'active' },
    { id: 2, name: 'bottom', category: 'bottom', formality: 'everyday', occasions: ['casual'], status: 'active' },
    { id: 3, name: 'sneakers', category: 'shoes', formality: 'everyday', occasions: ['casual'], status: 'active', heel_height: 'flat', walk_support: 'high' },
    { id: 4, name: 'block heels', category: 'shoes', formality: 'everyday', occasions: ['casual'], status: 'active', heel_height: 'mid', walk_support: 'low' },
  ]
  const slots = [
    { id: 'city_walk', label: 'City Walking Tour', occasion: 'casual', activity: 'walking', targetOutfits: 1, requestedOutfits: 1 },
    { id: 'home_day', label: 'Casual Indoor', occasion: 'casual', activity: 'none', bestFor: 'a relaxed day at home', targetOutfits: 1, requestedOutfits: 1 },
  ]
  const workbench = await buildPlanSlotWorkbench(slots, {
    allPieces,
    question: 'Plan a walking tour day and a relaxed day at home.',
    constraints: { piece_budget: 14, reuse: 'maximize' },
    planKind: 'seasonal_capsule',
  })
  const walkingRequirements = workbench.slots.find(slot => slot.id === 'city_walk').submission_requirements.join(' ')
  const homeRequirements = workbench.slots.find(slot => slot.id === 'home_day').submission_requirements.join(' ')

  assert.match(walkingRequirements, /activity profile \(Lots of walking\) excludes/, `walking slot must state the constraint, got: ${walkingRequirements}`)
  assert.doesNotMatch(homeRequirements, /activity profile/, `activity:'none' must be a no-op, got: ${homeRequirements}`)
})

// Task 1: "distinct main core" is enforced ACROSS THE WHOLE SET by
// validateSubmittedPlanOutfits (usedCoreKeys spans every slot's accepted
// looks), not per slot — a Nature Walk look was rejected for repeating a
// core used by a different slot even though Nature Walk's own stated
// requirements looked satisfied. Pin that the workbench now says so.
test('capsule workbench states the cross-slot distinct-core requirement', async () => {
  const allPieces = [
    { id: 1, name: 'top A', category: 'top', formality: 'everyday', occasions: ['casual'], status: 'active' },
    { id: 2, name: 'top B', category: 'top', formality: 'everyday', occasions: ['casual'], status: 'active' },
    { id: 3, name: 'bottom A', category: 'bottom', formality: 'everyday', occasions: ['casual'], status: 'active' },
    { id: 4, name: 'bottom B', category: 'bottom', formality: 'everyday', occasions: ['casual'], status: 'active' },
    { id: 5, name: 'shoes A', category: 'shoes', formality: 'everyday', occasions: ['casual'], status: 'active' },
    { id: 6, name: 'shoes B', category: 'shoes', formality: 'everyday', occasions: ['casual'], status: 'active' },
  ]
  const slots = [
    { id: 'nature_walk', label: 'Nature Walk', occasion: 'casual', activity: 'none', targetOutfits: 1, requestedOutfits: 1 },
    { id: 'errands', label: 'Errands', occasion: 'casual', activity: 'none', targetOutfits: 1, requestedOutfits: 1 },
  ]
  const workbench = await buildPlanSlotWorkbench(slots, {
    allPieces,
    question: 'Build a small capsule for a nature walk and errands.',
    constraints: { piece_budget: 14, reuse: 'maximize' },
    planKind: 'seasonal_capsule',
  })
  for (const slot of workbench.slots) {
    assert.match(
      slot.submission_requirements.join(' '),
      /distinct from every other look already submitted across the ENTIRE capsule set/,
      `slot ${slot.id} must state the cross-slot requirement, got: ${slot.submission_requirements.join(' ')}`
    )
  }
})

// A neutral color term used to add +12 regardless of pattern — but a
// black/cream/burgundy geometric print (garment 258's real colors) does not
// read as a recombine-with-everything neutral solid just because a neutral
// happens to be in its color list. Pin that a 'loud' piece no longer
// outranks an otherwise-identical 'quiet' piece on the strength of that bonus.
test("capsuleVersatilityScore does not award the neutral-colour bonus to a piece pattern_complexity tags 'loud'", () => {
  const loudButNeutral = { id: 258, name: 'bold geometric top', category: 'top', colors: ['black', 'cream', 'burgundy'], pattern_type: 'geometric', pattern_complexity: 'loud', occasions: ['casual', 'city'], formality: 'everyday' }
  const quietNeutral = { id: 1, name: 'quiet geometric top', category: 'top', colors: ['black', 'cream', 'burgundy'], pattern_type: 'geometric', pattern_complexity: 'quiet', occasions: ['casual', 'city'], formality: 'everyday' }
  const { bench } = buildCapsuleBench([loudButNeutral, quietNeutral], { budget: 10, slots: [] })

  assert.equal(bench[0].id, quietNeutral.id, `the quiet piece must outrank the loud one despite identical neutral colors, got bench order: ${bench.map(piece => piece.id)}`)
})

// docs/capsule-roster-selection-spec.md §7b, owner ruling: needs_base ships
// as a column with no capsule-selector behaviour yet (that is a later,
// separate change) — unset MUST be a strict no-op, and an explicit 'no' must
// behave identically to unset today, since only 'yes' is meant to ever mean
// anything to the engine and 'yes' itself isn't wired to anything yet either.
test('an unset needs_base changes nothing about capsule roster selection', () => {
  const poolWithoutField = [
    { id: 1, name: 'top A', category: 'top', colors: ['black'], pattern_type: 'solid', occasions: ['casual', 'city'], formality: 'everyday' },
    { id: 2, name: 'top B', category: 'top', colors: ['navy'], pattern_type: 'solid', occasions: ['casual', 'city'], formality: 'everyday' },
    { id: 3, name: 'bottom A', category: 'bottom', colors: ['black'], pattern_type: 'solid', occasions: ['casual', 'city'], formality: 'everyday' },
    { id: 4, name: 'shoes A', category: 'shoes', colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' },
  ]
  const poolWithExplicitNo = poolWithoutField.map(piece => ({ ...piece, needs_base: 'no' }))
  const poolWithNull = poolWithoutField.map(piece => ({ ...piece, needs_base: null }))

  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  const baseline = selectCapsuleRoster(poolWithoutField, { budget: 10, occasions: slots.map(slot => slot.occasion), slots })
  const withExplicitNo = selectCapsuleRoster(poolWithExplicitNo, { budget: 10, occasions: slots.map(slot => slot.occasion), slots })
  const withNull = selectCapsuleRoster(poolWithNull, { budget: 10, occasions: slots.map(slot => slot.occasion), slots })

  const idsOf = roster => roster.map(piece => Number(piece.id)).sort()
  assert.deepEqual(idsOf(withExplicitNo), idsOf(baseline), 'an explicit needs_base:no must not change roster selection')
  assert.deepEqual(idsOf(withNull), idsOf(baseline), 'needs_base:null must not change roster selection')

  const { bench: benchBaseline } = buildCapsuleBench(poolWithoutField, { budget: 10, slots })
  const { bench: benchWithNo } = buildCapsuleBench(poolWithExplicitNo, { budget: 10, slots })
  assert.deepEqual(idsOf(benchWithNo), idsOf(benchBaseline), 'needs_base must not change the bench either')
})

test('captured capsule shape rejects a completed use case with no requested transition layer', () => {
  const topA = { id: 1, name: 'top A', category: 'top', formality: 'everyday' }
  const topB = { id: 2, name: 'top B', category: 'top', formality: 'everyday' }
  const bottomA = { id: 3, name: 'bottom A', category: 'bottom', formality: 'everyday' }
  const bottomB = { id: 4, name: 'bottom B', category: 'bottom', formality: 'everyday' }
  const shoes = { id: 5, name: 'boots', category: 'shoes', formality: 'everyday' }
  const jacket = { id: 6, name: 'transition jacket', category: 'outerwear', formality: 'everyday' }
  const pieces = [topA, topB, bottomA, bottomB, shoes, jacket]
  const slot = {
    id: 'casual_indoor',
    label: 'Casual Indoor',
    targetOutfits: 2,
    gateAllowedIds: new Set(pieces.map(piece => piece.id)),
    allowedPieces: pieces
  }
  const result = validateSubmittedPlanOutfits({
    slots: [slot],
    piecesById: new Map(pieces.map(piece => [piece.id, piece])),
    constraints: { pieceBudget: 0 },
    heldOutfits: [],
    requiresTransitionLayerCoverage: true
  }, [
    { slot_id: slot.id, piece_ids: [1, 3, 5] },
    { slot_id: slot.id, piece_ids: [2, 4, 5] }
  ])

  assert.equal(result.accepted.length, 1, 'one card is returned to the model for repair')
  assert.match(result.failures.flatMap(failure => failure.reasons).join(' '), /transition-layer coverage requested/)
})

test('recurring capsule slot demonstrates a second eligible shoe instead of one-pair dominance', () => {
  const pieces = [
    { id: 1, name: 'top A', category: 'top', formality: 'everyday' },
    { id: 2, name: 'top B', category: 'top', formality: 'everyday' },
    { id: 3, name: 'bottom A', category: 'bottom', formality: 'everyday' },
    { id: 4, name: 'bottom B', category: 'bottom', formality: 'everyday' },
    { id: 5, name: 'boots', category: 'shoes', formality: 'everyday' },
    { id: 6, name: 'loafers', category: 'shoes', formality: 'everyday' }
  ]
  const slot = {
    id: 'restaurant_dinner',
    label: 'Restaurant Dinner',
    targetOutfits: 2,
    gateAllowedIds: new Set(pieces.map(piece => piece.id)),
    allowedPieces: pieces
  }
  const pending = {
    planKind: 'seasonal_capsule',
    isSeasonalCapsule: true,
    slots: [slot],
    piecesById: new Map(pieces.map(piece => [piece.id, piece])),
    constraints: { pieceBudget: 14 },
    heldOutfits: []
  }
  const dominated = validateSubmittedPlanOutfits(pending, [
    { slot_id: slot.id, piece_ids: [1, 3, 5] },
    { slot_id: slot.id, piece_ids: [2, 4, 5] }
  ])
  assert.equal(dominated.accepted.length, 1)
  assert.match(dominated.failures.flatMap(failure => failure.reasons).join(' '), /representative shoe range requested/)

  const ranged = validateSubmittedPlanOutfits(pending, [
    { slot_id: slot.id, piece_ids: [1, 3, 5] },
    { slot_id: slot.id, piece_ids: [2, 4, 6] }
  ])
  assert.equal(ranged.failures.length, 0)
  assert.equal(ranged.accepted.length, 2)
})

// The splice above hands the card back for repair. The atomic capsule composer
// validates once and never retries, so there is no repair — the same splice
// just deletes a wearable look to punish shoe monotony, and (with per-slot
// coverage gaps suppressed) the user is never told why a card vanished.
test('bounded capsule composition keeps a valid card instead of dropping it for shoe range', () => {
  const pieces = [
    { id: 1, name: 'top A', category: 'top', formality: 'everyday' },
    { id: 2, name: 'top B', category: 'top', formality: 'everyday' },
    { id: 3, name: 'bottom A', category: 'bottom', formality: 'everyday' },
    { id: 4, name: 'bottom B', category: 'bottom', formality: 'everyday' },
    { id: 5, name: 'boots', category: 'shoes', formality: 'everyday' },
    { id: 6, name: 'loafers', category: 'shoes', formality: 'everyday' }
  ]
  const slot = {
    id: 'restaurant_dinner',
    label: 'Restaurant Dinner',
    targetOutfits: 2,
    gateAllowedIds: new Set(pieces.map(piece => piece.id)),
    allowedPieces: pieces
  }
  const pending = {
    planKind: 'seasonal_capsule',
    isSeasonalCapsule: true,
    boundedComposition: true,
    slots: [slot],
    piecesById: new Map(pieces.map(piece => [piece.id, piece])),
    constraints: { pieceBudget: 14 },
    heldOutfits: []
  }
  const dominated = validateSubmittedPlanOutfits(pending, [
    { slot_id: slot.id, piece_ids: [1, 3, 5] },
    { slot_id: slot.id, piece_ids: [2, 4, 5] }
  ])

  assert.equal(dominated.accepted.length, 2, 'both wearable looks survive when no repair round exists')
  assert.match(
    dominated.failures.flatMap(failure => failure.reasons).join(' '),
    /representative shoe range requested/,
    'the finding is still recorded as evidence'
  )
})

test('capsule shortfall is described for the user, without the raw validator reasons', () => {
  const line = describeCapsuleCompositionShortfall(
    [{ label: 'City Outings & Museums', missing: 2 }, { label: 'Brunch', missing: 0 }],
    { plannedTotal: 12, acceptedTotal: 10 }
  )

  assert.match(line, /10 of 12 planned looks are ready/)
  assert.match(line, /"City Outings & Museums" \(2\)/)
  assert.doesNotMatch(line, /Brunch/, 'a slot that lost nothing is not listed')
  assert.doesNotMatch(line, /heel|gate|register|validator/i, 'internal rejection reasons stay in the log')
  assert.equal(
    describeCapsuleCompositionShortfall([], { plannedTotal: 12, acceptedTotal: 12 }),
    '',
    'a complete rotation says nothing'
  )
})

// Same sentence, two different causes: the card cap trimmed the slot, or the
// roster simply has no further distinct core for it. The second used to blame
// the first, and the UI then offered a billed "show another" against a rotation
// that was already complete.
test('a capacity-trimmed capsule slot reports the roster as the cause, not the card cap', () => {
  const pieces = [
    { id: 1, name: 'top', category: 'top', formality: 'everyday' },
    { id: 2, name: 'bottom', category: 'bottom', formality: 'everyday' },
    { id: 3, name: 'shoes', category: 'shoes', formality: 'everyday' }
  ]
  const baseSlot = {
    id: 'errands',
    label: 'Errands / Weekends',
    requestedOutfits: 3,
    targetOutfits: 1,
    totalOutfitCap: 12,
    gateAllowedIds: new Set([1, 2, 3]),
    allowedPieces: pieces
  }
  const outfit = { slot_id: 'errands', pieces, pieceIds: [1, 2, 3], source: 'plan_outfit_set', _slotId: 'errands' }

  const capacityTrimmed = assembleSubmittedPlanOutfits(
    { slots: [{ ...baseSlot, capsuleSlotCapacity: 1 }], constraints: { pieceBudget: 24 }, suppressModelCoverageGaps: true },
    [outfit]
  )
  const capTrimmed = assembleSubmittedPlanOutfits(
    { slots: [baseSlot], constraints: { pieceBudget: 24 }, suppressModelCoverageGaps: true },
    [outfit]
  )
  const linesOf = plan => (plan[0]?.tripPlanLines || []).join('\n')

  assert.match(linesOf(capacityTrimmed), /\[rotation limit: "Errands \/ Weekends"/)
  assert.doesNotMatch(linesOf(capacityTrimmed), /plan trimmed/)
  assert.match(linesOf(capTrimmed), /\[plan trimmed: "Errands \/ Weekends"/)
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
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'held top one', occasions: ['city', 'casual'] })
  insertPiece({ category: 'bottom', name: 'held bottom one', occasions: ['city', 'casual'] })
  insertPiece({ category: 'shoes', name: 'held shoes one', occasions: ['city', 'casual'], heel_height: 'flat', walk_support: 'high' })
  insertPiece({ category: 'top', name: 'held top two', occasions: ['casual', 'city'] })
  insertPiece({ category: 'bottom', name: 'held bottom two', occasions: ['casual', 'city'] })
  insertPiece({ category: 'shoes', name: 'held shoes two', occasions: ['casual', 'city'], heel_height: 'flat', walk_support: 'high' })
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
})

test('capsule representative rotation rejects changing only shoes on the same main core', () => {
  const pieces = [
    { id: 1, category: 'top', name: 'capsule top' },
    { id: 2, category: 'bottom', name: 'capsule bottom' },
    { id: 3, category: 'shoes', name: 'casual shoes' },
    { id: 4, category: 'shoes', name: 'elevated shoes' },
  ]
  const pendingPlan = {
    planKind: 'seasonal_capsule',
    isSeasonalCapsule: true,
    slots: [{
      id: 'rotation',
      label: 'Rotation',
      occasion: 'city',
      activity: 'none',
      targetOutfits: 2,
      gateAllowedIds: new Set([1, 2, 3, 4]),
      rosterIds: new Set([1, 2, 3, 4]),
      allowedPieces: pieces,
    }],
    piecesById: new Map(pieces.map(piece => [piece.id, piece])),
    constraints: { reuse: 'maximize', noRepeat: new Set(), anchorIds: new Set(), pieceBudget: 10 },
    heldOutfits: [],
  }
  const result = validateSubmittedPlanOutfits(pendingPlan, [
    { slot_id: 'rotation', piece_ids: [1, 2, 3] },
    { slot_id: 'rotation', piece_ids: [1, 2, 4] },
  ])

  assert.equal(result.accepted.length, 1)
  assert.equal(result.failures.length, 1)
  assert.match(result.failures[0].reasons.join(' '), /duplicate capsule core already represented/)
})

test('non-capsule plans may vary shoes around the same main core', () => {
  const pieces = [
    { id: 1, category: 'top', name: 'plan top' },
    { id: 2, category: 'bottom', name: 'plan bottom' },
    { id: 3, category: 'shoes', name: 'shoe one' },
    { id: 4, category: 'shoes', name: 'shoe two' },
  ]
  const pendingPlan = {
    slots: [{ id: 'rotation', label: 'Rotation', occasion: 'city', activity: 'none', gateAllowedIds: new Set([1, 2, 3, 4]), allowedPieces: pieces }],
    piecesById: new Map(pieces.map(piece => [piece.id, piece])),
    constraints: { reuse: '', noRepeat: new Set(), anchorIds: new Set(), pieceBudget: 0 },
    heldOutfits: [],
  }
  const result = validateSubmittedPlanOutfits(pendingPlan, [
    { slot_id: 'rotation', piece_ids: [1, 2, 3] },
    { slot_id: 'rotation', piece_ids: [1, 2, 4] },
  ])

  assert.equal(result.accepted.length, 2)
  assert.equal(result.failures.length, 0)
})

test('submit_plan_outfits reports missing slots together with other validation failures', async () => {
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'roundtrip top one', occasions: ['city', 'casual'] })
  insertPiece({ category: 'bottom', name: 'roundtrip bottom one', occasions: ['city', 'casual'] })
  insertPiece({ category: 'shoes', name: 'roundtrip shoes one', occasions: ['city', 'casual'], heel_height: 'flat', walk_support: 'high' })
  insertPiece({ category: 'top', name: 'roundtrip top two', occasions: ['city', 'casual'] })
  insertPiece({ category: 'bottom', name: 'roundtrip bottom two', occasions: ['city', 'casual'] })
  insertPiece({ category: 'shoes', name: 'roundtrip shoes two', occasions: ['city', 'casual'], heel_height: 'flat', walk_support: 'high' })
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
})

test('propose_outfit redirects while a model-mode pending plan awaits submission', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'redirect top', occasions: ['city'] })
  const bottomId = insertPiece({ category: 'bottom', name: 'redirect bottom', occasions: ['city'] })
  const shoesId = insertPiece({ category: 'shoes', name: 'redirect shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
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
})

// --- Partial re-plan must merge, not destroy (spec 23 Part 1, P0) ------------

function pieceIdByName(slot = {}, name = '') {
  const match = (slot.allowedPieces || []).find(piece => piece.name === name)
  return match ? Number(match.id) : null
}

test('P0 regression: office week repro — 5 slots, 4 held + floor rejection, single-slot re-call at a lower register, one submit, 5 cards in Mon-Fri order', async () => {
  db.prepare('DELETE FROM pieces').run()
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  for (const day of days) {
    insertPiece({ category: 'top', name: `${day} everyday top`, occasions: ['city'], formality: 'everyday' })
    insertPiece({ category: 'bottom', name: `${day} everyday pants`, occasions: ['city'], formality: 'everyday' })
    insertPiece({ category: 'shoes', name: `${day} everyday shoes`, occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  }
  // No dressy-or-better piece exists anywhere in the wardrobe, so Thursday's
  // dressy floor is genuinely unfillable at the model's original register —
  // the live repro's exact shape.

  const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'office week outfits' }
  await executeTool('plan_outfit_set', {
    slots: days.map(day => ({
      label: day,
      occasion: 'city',
      activity: 'none',
      count: 1,
      ...(day === 'Thursday' ? { register: 'dressy' } : {})
    }))
  }, toolContext)

  const slotsBeforeReplan = toolContext.pendingPlan.slots
  const outfitFor = slot => {
    const day = slot.label
    return {
      slot_id: slot.id,
      piece_ids: [
        pieceIdByName(slot, `${day} everyday top`),
        pieceIdByName(slot, `${day} everyday pants`),
        pieceIdByName(slot, `${day} everyday shoes`)
      ]
    }
  }
  const firstSubmit = await executeTool('submit_plan_outfits', {
    outfits: slotsBeforeReplan.map(outfitFor)
  }, toolContext)

  assert.equal(firstSubmit.status, 'validation_error')
  assert.equal(firstSubmit.held_count, 4, `expected 4 of 5 held, got ${JSON.stringify(firstSubmit)}`)
  assert.match(firstSubmit.message, /re-call plan_outfit_set with just this slot at a lower register/)
  assert.equal(toolContext.pendingPlan.heldOutfits.length, 4)

  // The model obeys the hatch exactly: re-call plan_outfit_set with just
  // Thursday, at a lower (default) register.
  await executeTool('plan_outfit_set', {
    slots: [{ label: 'Thursday', occasion: 'city', activity: 'none', count: 1 }]
  }, toolContext)

  // The 4 previously held outfits must survive this call, not be destroyed.
  assert.equal(toolContext.pendingPlan.heldOutfits.length, 4, 'the 4 previously held outfits must carry forward through the re-plan call')
  assert.equal(toolContext.pendingPlan.slots.length, 5, 'all 5 slots must still be present after the merge')

  const mergedThursday = toolContext.pendingPlan.slots.find(slot => slot.label === 'Thursday')
  const finalSubmit = await executeTool('submit_plan_outfits', {
    outfits: [outfitFor(mergedThursday)]
  }, toolContext)

  assert.equal(finalSubmit.status, 'success', `expected the merged plan to submit cleanly, got ${JSON.stringify(finalSubmit)}`)
  assert.equal(toolContext.generatedOutfits.length, 5, 'all 5 outfits must be delivered, not just the re-planned slot')
  assert.deepEqual(toolContext.generatedOutfits.map(outfit => outfit.label), days, 'Mon-Fri order must survive the merge')
})

test('P0 regression: wedding weekend repro — 3 slots, 2 held, ceremony re-call, 3 cards', async () => {
  db.prepare('DELETE FROM pieces').run()
  const events = ['Rehearsal', 'Ceremony', 'Brunch']
  for (const event of events) {
    insertPiece({ category: 'top', name: `${event} everyday top`, occasions: ['city'], formality: 'everyday' })
    insertPiece({ category: 'bottom', name: `${event} everyday pants`, occasions: ['city'], formality: 'everyday' })
    insertPiece({ category: 'shoes', name: `${event} everyday shoes`, occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  }

  const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'wedding weekend outfits' }
  await executeTool('plan_outfit_set', {
    slots: events.map(event => ({
      label: event,
      occasion: 'city',
      activity: 'none',
      count: 1,
      ...(event === 'Ceremony' ? { register: 'dressy' } : {})
    }))
  }, toolContext)

  const outfitFor = slot => {
    const event = slot.label
    return {
      slot_id: slot.id,
      piece_ids: [
        pieceIdByName(slot, `${event} everyday top`),
        pieceIdByName(slot, `${event} everyday pants`),
        pieceIdByName(slot, `${event} everyday shoes`)
      ]
    }
  }
  const firstSubmit = await executeTool('submit_plan_outfits', {
    outfits: toolContext.pendingPlan.slots.map(outfitFor)
  }, toolContext)

  assert.equal(firstSubmit.status, 'validation_error')
  assert.equal(firstSubmit.held_count, 2, `expected 2 of 3 held, got ${JSON.stringify(firstSubmit)}`)

  await executeTool('plan_outfit_set', {
    slots: [{ label: 'Ceremony', occasion: 'city', activity: 'none', count: 1 }]
  }, toolContext)

  assert.equal(toolContext.pendingPlan.heldOutfits.length, 2, 'the 2 previously held outfits must carry forward')
  assert.equal(toolContext.pendingPlan.slots.length, 3)

  const mergedCeremony = toolContext.pendingPlan.slots.find(slot => slot.label === 'Ceremony')
  const finalSubmit = await executeTool('submit_plan_outfits', {
    outfits: [outfitFor(mergedCeremony)]
  }, toolContext)

  assert.equal(finalSubmit.status, 'success', `expected the merged plan to submit cleanly, got ${JSON.stringify(finalSubmit)}`)
  assert.equal(toolContext.generatedOutfits.length, 3, 'all 3 outfits must be delivered')
  assert.deepEqual(toolContext.generatedOutfits.map(outfit => outfit.label), events)
})

test('a partial re-plan inherits the prior plan\'s constraints when the re-call omits them (no_repeat still enforced across the union)', async () => {
  db.prepare('DELETE FROM pieces').run()
  const top1 = insertPiece({ category: 'top', name: 'shared top one', occasions: ['city'] })
  insertPiece({ category: 'top', name: 'shared top two', occasions: ['city'] })
  insertPiece({ category: 'bottom', name: 'shared bottom one', occasions: ['city'] })
  insertPiece({ category: 'bottom', name: 'shared bottom two', occasions: ['city'] })
  insertPiece({ category: 'shoes', name: 'shared shoes one', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  insertPiece({ category: 'shoes', name: 'shared shoes two', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })

  const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'two outfits, no repeated tops' }
  await executeTool('plan_outfit_set', {
    slots: [
      { label: 'Slot A', occasion: 'city', activity: 'none', count: 1 },
      { label: 'Slot B', occasion: 'city', activity: 'none', count: 1 }
    ],
    constraints: { no_repeat: ['top'] }
  }, toolContext)

  const slotA = toolContext.pendingPlan.slots.find(slot => slot.label === 'Slot A')
  const firstSubmit = await executeTool('submit_plan_outfits', {
    outfits: [{
      slot_id: slotA.id,
      piece_ids: [
        pieceIdByName(slotA, 'shared top one'),
        pieceIdByName(slotA, 'shared bottom one'),
        pieceIdByName(slotA, 'shared shoes one')
      ]
    }]
  }, toolContext)
  assert.equal(firstSubmit.status, 'validation_error', 'Slot B is still missing at this point')
  assert.equal(toolContext.pendingPlan.heldOutfits.length, 1)

  // Re-call omits constraints entirely.
  await executeTool('plan_outfit_set', {
    slots: [{ label: 'Slot B', occasion: 'city', activity: 'none', count: 1 }]
  }, toolContext)

  const mergedSlotB = toolContext.pendingPlan.slots.find(slot => slot.label === 'Slot B')
  const repeatingSubmit = await executeTool('submit_plan_outfits', {
    outfits: [{
      slot_id: mergedSlotB.id,
      piece_ids: [
        pieceIdByName(mergedSlotB, 'shared top one'), // reuses Slot A's top — should violate inherited no_repeat
        pieceIdByName(mergedSlotB, 'shared bottom two'),
        pieceIdByName(mergedSlotB, 'shared shoes two')
      ]
    }]
  }, toolContext)

  assert.equal(repeatingSubmit.status, 'validation_error')
  assert.match(repeatingSubmit.message, /repeats despite no_repeat/)
})

test('a partial re-plan that explicitly restates constraints replaces the prior ones', async () => {
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'shared top one', occasions: ['city'] })
  insertPiece({ category: 'top', name: 'shared top two', occasions: ['city'] })
  insertPiece({ category: 'bottom', name: 'shared bottom one', occasions: ['city'] })
  insertPiece({ category: 'bottom', name: 'shared bottom two', occasions: ['city'] })
  insertPiece({ category: 'shoes', name: 'shared shoes one', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  insertPiece({ category: 'shoes', name: 'shared shoes two', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })

  const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'two outfits, no repeated tops' }
  await executeTool('plan_outfit_set', {
    slots: [
      { label: 'Slot A', occasion: 'city', activity: 'none', count: 1 },
      { label: 'Slot B', occasion: 'city', activity: 'none', count: 1 }
    ],
    constraints: { no_repeat: ['top'] }
  }, toolContext)

  const slotA = toolContext.pendingPlan.slots.find(slot => slot.label === 'Slot A')
  await executeTool('submit_plan_outfits', {
    outfits: [{
      slot_id: slotA.id,
      piece_ids: [
        pieceIdByName(slotA, 'shared top one'),
        pieceIdByName(slotA, 'shared bottom one'),
        pieceIdByName(slotA, 'shared shoes one')
      ]
    }]
  }, toolContext)
  assert.equal(toolContext.pendingPlan.heldOutfits.length, 1)

  // Re-call explicitly restates constraints without no_repeat — this must
  // REPLACE the inherited constraints, not merge with them.
  await executeTool('plan_outfit_set', {
    slots: [{ label: 'Slot B', occasion: 'city', activity: 'none', count: 1 }],
    constraints: { reuse: 'diversify' }
  }, toolContext)

  const mergedSlotB = toolContext.pendingPlan.slots.find(slot => slot.label === 'Slot B')
  const repeatingSubmit = await executeTool('submit_plan_outfits', {
    outfits: [{
      slot_id: mergedSlotB.id,
      piece_ids: [
        pieceIdByName(mergedSlotB, 'shared top one'),
        pieceIdByName(mergedSlotB, 'shared bottom two'),
        pieceIdByName(mergedSlotB, 'shared shoes two')
      ]
    }]
  }, toolContext)

  assert.equal(repeatingSubmit.status, 'success', `restated constraints should have dropped no_repeat, got ${JSON.stringify(repeatingSubmit)}`)
})

test('re-planning a slot that already had an accepted outfit supersedes it with a disclosure line', async () => {
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'A top one', occasions: ['city'] })
  insertPiece({ category: 'top', name: 'A top two', occasions: ['city'] })
  insertPiece({ category: 'bottom', name: 'A bottom one', occasions: ['city'] })
  insertPiece({ category: 'bottom', name: 'A bottom two', occasions: ['city'] })
  insertPiece({ category: 'shoes', name: 'A shoes one', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  insertPiece({ category: 'shoes', name: 'A shoes two', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })

  const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'two outfits' }
  await executeTool('plan_outfit_set', {
    slots: [
      { label: 'Slot A', occasion: 'city', activity: 'none', count: 1 },
      { label: 'Slot B', occasion: 'city', activity: 'none', count: 1 }
    ]
  }, toolContext)

  const slotA = toolContext.pendingPlan.slots.find(slot => slot.label === 'Slot A')
  await executeTool('submit_plan_outfits', {
    outfits: [{
      slot_id: slotA.id,
      piece_ids: [
        pieceIdByName(slotA, 'A top one'),
        pieceIdByName(slotA, 'A bottom one'),
        pieceIdByName(slotA, 'A shoes one')
      ]
    }]
  }, toolContext)
  assert.equal(toolContext.pendingPlan.heldOutfits.length, 1)

  // Re-plan Slot A again, even though it already had an accepted outfit.
  await executeTool('plan_outfit_set', {
    slots: [{ label: 'Slot A', occasion: 'city', activity: 'none', count: 1 }]
  }, toolContext)

  assert.equal(toolContext.pendingPlan.heldOutfits.length, 0, 'the superseded outfit must be dropped, not just added to')
  assert.ok(
    toolContext.pendingPlan.coverageGaps.some(line => /\[slot re-planned: "Slot A" — 1 earlier look replaced\]/.test(line)),
    `expected a supersede disclosure line, got ${JSON.stringify(toolContext.pendingPlan.coverageGaps)}`
  )
})

test('a fresh plan_outfit_set call with no pending plan and no plan cards this turn behaves exactly as today', async () => {
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'fresh top', occasions: ['city'] })
  insertPiece({ category: 'bottom', name: 'fresh bottom', occasions: ['city'] })
  insertPiece({ category: 'shoes', name: 'fresh shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })

  const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'one city outfit' }
  const result = await executeTool('plan_outfit_set', {
    slots: [{ label: 'City Day', occasion: 'city', activity: 'none', count: 1 }]
  }, toolContext)

  assert.equal(result.status, 'slot_rosters')
  assert.doesNotMatch(result.message, /previously accepted/, 'a fresh plan must not carry the merge-specific wording')
  assert.equal(toolContext.pendingPlan.heldOutfits.length, 0)
  assert.equal(toolContext.pendingPlan.slots.length, 1)
})

// --- Enforced footwear packing under reuse:maximize (spec 24 Part 1) --------

test('a 4th distinct pair of shoes under reuse:maximize is rejected, coaching reuse of gate-eligible used pairs', async () => {
  db.prepare('DELETE FROM pieces').run()
  for (const label of ['A', 'B', 'C', 'D']) {
    insertPiece({ category: 'top', name: `${label} top`, occasions: ['city'] })
    insertPiece({ category: 'bottom', name: `${label} bottom`, occasions: ['city'] })
    insertPiece({ category: 'shoes', name: `${label} shoes`, occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  }
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Day A', occasion: 'city', activity: 'none', count: 1 },
    { label: 'Day B', occasion: 'city', activity: 'none', count: 1 },
    { label: 'Day C', occasion: 'city', activity: 'none', count: 1 },
    { label: 'Day D', occasion: 'city', activity: 'none', count: 1 },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'four days', constraints: { reuse: 'maximize' } })
  const [slotA, slotB, slotC, slotD] = workbench.pendingPlan.slots
  const idFor = (slot, name) => Number((slot.allowedPieces || []).find(piece => piece.name === name)?.id)

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [
    { slot_id: slotA.id, piece_ids: [idFor(slotA, 'A top'), idFor(slotA, 'A bottom'), idFor(slotA, 'A shoes')] },
    { slot_id: slotB.id, piece_ids: [idFor(slotB, 'B top'), idFor(slotB, 'B bottom'), idFor(slotB, 'B shoes')] },
    { slot_id: slotC.id, piece_ids: [idFor(slotC, 'C top'), idFor(slotC, 'C bottom'), idFor(slotC, 'C shoes')] },
    { slot_id: slotD.id, piece_ids: [idFor(slotD, 'D top'), idFor(slotD, 'D bottom'), idFor(slotD, 'D shoes')] },
  ])

  assert.equal(result.accepted.length, 3, `expected Day A, B, C accepted, Day D rejected, got ${JSON.stringify(result.failures)}`)
  const failure = result.failures.find(entry => entry.label === 'Day D')
  assert.ok(failure, 'Day D should have failed on the 4th-pair cap')
  const reasons = failure.reasons.join(' ')
  assert.match(reasons, /4th pair of shoes under reuse:maximize/)
  assert.match(reasons, /A shoes/)
  assert.match(reasons, /B shoes/)
  assert.match(reasons, /C shoes/)
})

test('reuse:maximize never blocks the first, second, or third distinct pair of shoes', async () => {
  db.prepare('DELETE FROM pieces').run()
  for (const label of ['A', 'B', 'C']) {
    insertPiece({ category: 'top', name: `${label} top`, occasions: ['city'] })
    insertPiece({ category: 'bottom', name: `${label} bottom`, occasions: ['city'] })
    insertPiece({ category: 'shoes', name: `${label} shoes`, occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  }
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Day A', occasion: 'city', activity: 'none', count: 1 },
    { label: 'Day B', occasion: 'city', activity: 'none', count: 1 },
    { label: 'Day C', occasion: 'city', activity: 'none', count: 1 },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'three days', constraints: { reuse: 'maximize' } })
  const [slotA, slotB, slotC] = workbench.pendingPlan.slots
  const idFor = (slot, name) => Number((slot.allowedPieces || []).find(piece => piece.name === name)?.id)

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [
    { slot_id: slotA.id, piece_ids: [idFor(slotA, 'A top'), idFor(slotA, 'A bottom'), idFor(slotA, 'A shoes')] },
    { slot_id: slotB.id, piece_ids: [idFor(slotB, 'B top'), idFor(slotB, 'B bottom'), idFor(slotB, 'B shoes')] },
    { slot_id: slotC.id, piece_ids: [idFor(slotC, 'C top'), idFor(slotC, 'C bottom'), idFor(slotC, 'C shoes')] },
  ])

  assert.equal(result.failures.length, 0, `first, second, and third distinct pairs must never be blocked, got ${JSON.stringify(result.failures)}`)
  assert.equal(result.accepted.length, 3)
})

test('seasonal capsule reuse allows every shoe intentionally selected into its bounded roster', () => {
  const pieces = []
  for (let index = 1; index <= 4; index += 1) {
    pieces.push(
      { id: index * 10 + 1, category: 'top', name: `capsule top ${index}` },
      { id: index * 10 + 2, category: 'bottom', name: `capsule bottom ${index}` },
      { id: index * 10 + 3, category: 'shoes', name: `capsule shoes ${index}` }
    )
  }
  const piecesById = new Map(pieces.map(piece => [piece.id, piece]))
  const slots = Array.from({ length: 4 }, (_, index) => ({
    id: `capsule_slot_${index + 1}`,
    label: `Capsule Slot ${index + 1}`,
    targetOutfits: 1,
    gateAllowedIds: new Set(pieces.map(piece => piece.id)),
    allowedPieces: pieces
  }))
  const pendingPlan = {
    planKind: 'seasonal_capsule',
    isSeasonalCapsule: true,
    capsuleRoster: pieces,
    slots,
    piecesById,
    constraints: {
      reuse: 'maximize',
      noRepeat: new Set(),
      anchorIds: new Set(),
      pieceBudget: 24
    },
    heldOutfits: []
  }
  const submissions = slots.map((slot, index) => ({
    slot_id: slot.id,
    piece_ids: [(index + 1) * 10 + 1, (index + 1) * 10 + 2, (index + 1) * 10 + 3]
  }))

  const result = validateSubmittedPlanOutfits(pendingPlan, submissions)

  assert.equal(result.failures.length, 0, JSON.stringify(result.failures))
  assert.equal(result.accepted.length, 4)
})

test('reuse:diversify is byte-identical — the shoe cap only applies under maximize', async () => {
  db.prepare('DELETE FROM pieces').run()
  for (const label of ['A', 'B', 'C', 'D']) {
    insertPiece({ category: 'top', name: `${label} top`, occasions: ['city'] })
    insertPiece({ category: 'bottom', name: `${label} bottom`, occasions: ['city'] })
    insertPiece({ category: 'shoes', name: `${label} shoes`, occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  }
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Day A', occasion: 'city', activity: 'none', count: 1 },
    { label: 'Day B', occasion: 'city', activity: 'none', count: 1 },
    { label: 'Day C', occasion: 'city', activity: 'none', count: 1 },
    { label: 'Day D', occasion: 'city', activity: 'none', count: 1 },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'four days', constraints: { reuse: 'diversify' } })
  const [slotA, slotB, slotC, slotD] = workbench.pendingPlan.slots
  const idFor = (slot, name) => Number((slot.allowedPieces || []).find(piece => piece.name === name)?.id)

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [
    { slot_id: slotA.id, piece_ids: [idFor(slotA, 'A top'), idFor(slotA, 'A bottom'), idFor(slotA, 'A shoes')] },
    { slot_id: slotB.id, piece_ids: [idFor(slotB, 'B top'), idFor(slotB, 'B bottom'), idFor(slotB, 'B shoes')] },
    { slot_id: slotC.id, piece_ids: [idFor(slotC, 'C top'), idFor(slotC, 'C bottom'), idFor(slotC, 'C shoes')] },
    { slot_id: slotD.id, piece_ids: [idFor(slotD, 'D top'), idFor(slotD, 'D bottom'), idFor(slotD, 'D shoes')] },
  ])

  assert.equal(result.failures.length, 0, `diversify must be unaffected by the maximize-only shoe cap, got ${JSON.stringify(result.failures)}`)
  assert.equal(result.accepted.length, 4)
})

test('a demanding activity (hiking) still gets its own shoe as a 4th pair when the 3 used pairs fail its gates', async () => {
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'office top one', occasions: ['casual'] })
  insertPiece({ category: 'bottom', name: 'office bottom one', occasions: ['casual'] })
  insertPiece({ category: 'shoes', name: 'office heels one', occasions: ['casual'], heel_height: 'mid', walk_support: 'medium' })
  insertPiece({ category: 'top', name: 'office top two', occasions: ['casual'] })
  insertPiece({ category: 'bottom', name: 'office bottom two', occasions: ['casual'] })
  insertPiece({ category: 'shoes', name: 'office heels two', occasions: ['casual'], heel_height: 'mid', walk_support: 'medium' })
  insertPiece({ category: 'top', name: 'office top three', occasions: ['casual'] })
  insertPiece({ category: 'bottom', name: 'office bottom three', occasions: ['casual'] })
  insertPiece({ category: 'shoes', name: 'office heels three', occasions: ['casual'], heel_height: 'mid', walk_support: 'medium' })
  insertPiece({ category: 'top', name: 'hike top', occasions: ['casual'] })
  insertPiece({ category: 'bottom', name: 'hike bottom', occasions: ['casual'] })
  insertPiece({ category: 'shoes', name: 'trail sneakers', occasions: ['casual'], heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Office A', occasion: 'casual', activity: 'none', count: 1 },
    { label: 'Office B', occasion: 'casual', activity: 'none', count: 1 },
    { label: 'Office C', occasion: 'casual', activity: 'none', count: 1 },
    { label: 'Hike', occasion: 'casual', activity: 'hiking', count: 1 },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'office days plus a hike', constraints: { reuse: 'maximize' } })
  const [slotA, slotB, slotC, slotHike] = workbench.pendingPlan.slots
  const idFor = (slot, name) => Number((slot.allowedPieces || []).find(piece => piece.name === name)?.id)

  // The hiking slot's gate must exclude the mid-heel/medium-support office
  // shoes (this is the exemption's precondition, not the thing under test).
  assert.ok(!slotHike.gateAllowedIds.has(idFor(slotA, 'office heels one')), 'office heels should fail the hiking gate')

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [
    { slot_id: slotA.id, piece_ids: [idFor(slotA, 'office top one'), idFor(slotA, 'office bottom one'), idFor(slotA, 'office heels one')] },
    { slot_id: slotB.id, piece_ids: [idFor(slotB, 'office top two'), idFor(slotB, 'office bottom two'), idFor(slotB, 'office heels two')] },
    { slot_id: slotC.id, piece_ids: [idFor(slotC, 'office top three'), idFor(slotC, 'office bottom three'), idFor(slotC, 'office heels three')] },
    { slot_id: slotHike.id, piece_ids: [idFor(slotHike, 'hike top'), idFor(slotHike, 'hike bottom'), idFor(slotHike, 'trail sneakers')] },
  ])

  assert.equal(result.failures.length, 0, `the hiking slot's 4th pair should be exempt since none of the 3 used pairs pass its gates, got ${JSON.stringify(result.failures)}`)
  assert.equal(result.accepted.length, 4)
})

test('the used-shoe ledger survives a spec-23 partial re-plan merge across three rounds', async () => {
  db.prepare('DELETE FROM pieces').run()
  for (const label of ['A', 'B', 'C', 'D']) {
    insertPiece({ category: 'top', name: `${label} top`, occasions: ['city'] })
    insertPiece({ category: 'bottom', name: `${label} bottom`, occasions: ['city'] })
    insertPiece({ category: 'shoes', name: `${label} shoes`, occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  }
  const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'four days, pack light' }
  await executeTool('plan_outfit_set', {
    slots: [
      { label: 'Day A', occasion: 'city', activity: 'none', count: 1 },
      { label: 'Day B', occasion: 'city', activity: 'none', count: 1 },
      { label: 'Day C', occasion: 'city', activity: 'none', count: 1 },
      { label: 'Day D', occasion: 'city', activity: 'none', count: 1 },
    ],
    constraints: { reuse: 'maximize' }
  }, toolContext)

  const outfitFor = slot => ({
    slot_id: slot.id,
    piece_ids: [
      pieceIdByName(slot, `${slot.label.slice(-1)} top`),
      pieceIdByName(slot, `${slot.label.slice(-1)} bottom`),
      pieceIdByName(slot, `${slot.label.slice(-1)} shoes`)
    ]
  })

  const slotA = toolContext.pendingPlan.slots.find(slot => slot.label === 'Day A')
  const firstSubmit = await executeTool('submit_plan_outfits', { outfits: [outfitFor(slotA)] }, toolContext)
  assert.equal(firstSubmit.status, 'validation_error', 'Day B, Day C, and Day D are still missing')
  assert.equal(toolContext.pendingPlan.heldOutfits.length, 1)

  // Round 1 of merge: re-plan Day B.
  await executeTool('plan_outfit_set', {
    slots: [{ label: 'Day B', occasion: 'city', activity: 'none', count: 1 }]
  }, toolContext)
  const slotB = toolContext.pendingPlan.slots.find(slot => slot.label === 'Day B')
  const secondSubmit = await executeTool('submit_plan_outfits', { outfits: [outfitFor(slotB)] }, toolContext)
  assert.equal(secondSubmit.status, 'validation_error', 'Day C and Day D are still missing')
  assert.equal(toolContext.pendingPlan.heldOutfits.length, 2, 'the used-shoe ledger must reflect both A and B after the first merge')

  // Round 2 of merge: re-plan Day C. The 3rd distinct pair must still be accepted.
  await executeTool('plan_outfit_set', {
    slots: [{ label: 'Day C', occasion: 'city', activity: 'none', count: 1 }]
  }, toolContext)
  const slotC = toolContext.pendingPlan.slots.find(slot => slot.label === 'Day C')
  const thirdSubmit = await executeTool('submit_plan_outfits', { outfits: [outfitFor(slotC)] }, toolContext)
  assert.equal(thirdSubmit.status, 'validation_error', 'Day D is still missing')
  assert.equal(toolContext.pendingPlan.heldOutfits.length, 3, 'the used-shoe ledger must reflect A, B, and C after the second merge')

  // Round 3 of merge: re-plan Day D. A 4th distinct pair must still be rejected.
  await executeTool('plan_outfit_set', {
    slots: [{ label: 'Day D', occasion: 'city', activity: 'none', count: 1 }]
  }, toolContext)
  const slotD = toolContext.pendingPlan.slots.find(slot => slot.label === 'Day D')
  const fourthSubmit = await executeTool('submit_plan_outfits', { outfits: [outfitFor(slotD)] }, toolContext)

  assert.equal(fourthSubmit.status, 'validation_error', 'a 4th distinct pair of shoes must still be caught after three rounds of merge')
  assert.match(fourthSubmit.message, /4th pair of shoes under reuse:maximize/)
})

// --- Plan-mode layering requires sight, parity with propose_outfit (spec 24 Part 3) --

test('a blind top-over-dress submission is rejected with view_pieces coaching', async () => {
  db.prepare('DELETE FROM pieces').run()
  const dressId = insertPiece({ category: 'dress', name: 'abstract midi dress', occasions: ['city'] })
  const topId = insertPiece({ category: 'top', name: 'abstract print blouse', occasions: ['city'] })
  const shoesId = insertPiece({ category: 'shoes', name: 'layering shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Wednesday', occasion: 'city', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'office week' })
  const slot = workbench.pendingPlan.slots[0]

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(dressId), Number(topId), Number(shoesId)],
  }])

  assert.equal(result.accepted.length, 0)
  const reasons = result.failures[0].reasons.join(' ')
  assert.match(reasons, /layers a top over a dress/)
  assert.match(reasons, /call view_pieces/)
})

test('the same top-over-dress submission is accepted once both pieces have been visually seen', async () => {
  db.prepare('DELETE FROM pieces').run()
  const dressId = insertPiece({ category: 'dress', name: 'abstract midi dress', occasions: ['city'] })
  const topId = insertPiece({ category: 'top', name: 'abstract print blouse', occasions: ['city'] })
  const shoesId = insertPiece({ category: 'shoes', name: 'layering shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Wednesday', occasion: 'city', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'office week' })
  const slot = workbench.pendingPlan.slots[0]

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(dressId), Number(topId), Number(shoesId)],
  }], { visuallySeenPieceIds: new Set([Number(dressId), Number(topId)]) })

  assert.equal(result.failures.length, 0, `expected the seen top-over-dress outfit to pass, got ${JSON.stringify(result.failures)}`)
  assert.equal(result.accepted.length, 1)
})

test('a plain top+bottom outfit is unaffected by the layering sight check (no dress present)', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'plain top', occasions: ['city'] })
  const bottomId = insertPiece({ category: 'bottom', name: 'plain bottom', occasions: ['city'] })
  const shoesId = insertPiece({ category: 'shoes', name: 'plain shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Monday', occasion: 'city', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'office week' })
  const slot = workbench.pendingPlan.slots[0]

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(topId), Number(bottomId), Number(shoesId)],
  }])

  assert.equal(result.failures.length, 0, `top+bottom outfits must not be gated by the sight check, got ${JSON.stringify(result.failures)}`)
  assert.equal(result.accepted.length, 1)
})

// --- Print-pairing sight gate (spec 27 Part 1) -------------------------------

test('a blind two-print plan submission is rejected with view_pieces coaching', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'floral print top', occasions: ['city'], pattern_type: 'floral' })
  const bottomId = insertPiece({ category: 'bottom', name: 'plaid print pants', occasions: ['city'], pattern_type: 'plaid' })
  const shoesId = insertPiece({ category: 'shoes', name: 'print-gate shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Wednesday', occasion: 'city', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'office week' })
  const slot = workbench.pendingPlan.slots[0]

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(topId), Number(bottomId), Number(shoesId)],
  }])

  assert.equal(result.accepted.length, 0)
  const reasons = result.failures[0].reasons.join(' ')
  assert.match(reasons, /pairs 2 printed pieces/)
  assert.match(reasons, /call view_pieces on/)
  assert.match(reasons, new RegExp(`\\[${[topId, bottomId].sort((a, b) => a - b).join(', ')}\\]`))
})

test('the same two-print submission is accepted once both printed pieces have been visually seen', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'floral print top', occasions: ['city'], pattern_type: 'floral' })
  const bottomId = insertPiece({ category: 'bottom', name: 'plaid print pants', occasions: ['city'], pattern_type: 'plaid' })
  const shoesId = insertPiece({ category: 'shoes', name: 'print-gate shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Wednesday', occasion: 'city', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'office week' })
  const slot = workbench.pendingPlan.slots[0]

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(topId), Number(bottomId), Number(shoesId)],
  }], { visuallySeenPieceIds: new Set([Number(topId), Number(bottomId)]) })

  assert.equal(result.failures.length, 0, `expected the seen print pairing to pass, got ${JSON.stringify(result.failures)}`)
  assert.equal(result.accepted.length, 1)
})

test('one print piece plus solids passes without requiring sight', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'floral print top', occasions: ['city'], pattern_type: 'floral' })
  const bottomId = insertPiece({ category: 'bottom', name: 'solid pants', occasions: ['city'], pattern_type: 'solid' })
  const shoesId = insertPiece({ category: 'shoes', name: 'solid shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Monday', occasion: 'city', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'office week' })
  const slot = workbench.pendingPlan.slots[0]

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(topId), Number(bottomId), Number(shoesId)],
  }])

  assert.equal(result.failures.length, 0, `a single print must not trigger the sight gate, got ${JSON.stringify(result.failures)}`)
  assert.equal(result.accepted.length, 1)
})

test('an unknown pattern_type piece alongside one known print passes (tags are the truth surface)', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'floral print top', occasions: ['city'], pattern_type: 'floral' })
  const bottomId = insertPiece({ category: 'bottom', name: 'untagged pants', occasions: ['city'], pattern_type: '' })
  const shoesId = insertPiece({ category: 'shoes', name: 'solid shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Tuesday', occasion: 'city', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'office week' })
  const slot = workbench.pendingPlan.slots[0]

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(topId), Number(bottomId), Number(shoesId)],
  }])

  assert.equal(result.failures.length, 0, `an unknown pattern_type must not count toward the print trigger, got ${JSON.stringify(result.failures)}`)
  assert.equal(result.accepted.length, 1)
})

test('a printed scarf accessory alongside one printed top does NOT trigger the print-pairing gate', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'floral print top', occasions: ['city'], pattern_type: 'floral' })
  const bottomId = insertPiece({ category: 'bottom', name: 'solid pants', occasions: ['city'], pattern_type: 'solid' })
  const scarfId = insertPiece({ category: 'accessory', name: 'printed silk scarf', occasions: ['city'], pattern_type: 'geometric' })
  const shoesId = insertPiece({ category: 'shoes', name: 'solid shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Thursday', occasion: 'city', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'office week' })
  const slot = workbench.pendingPlan.slots[0]

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(topId), Number(bottomId), Number(scarfId), Number(shoesId)],
  }])

  assert.equal(result.failures.length, 0, `a printed accessory must not count as a MAIN print, got ${JSON.stringify(result.failures)}`)
  assert.equal(result.accepted.length, 1)
})

// --- Reason-revision validator (spec 26 Part 1) -----------------------------

test('reasonRevisesMidSentence catches both captured live incidents verbatim', () => {
  assert.equal(reasonRevisesMidSentence('**Actually revising:** emerald v-neck top + oatmeal pants…'), true)
  assert.equal(reasonRevisesMidSentence('**wait, maxi skirt is prohibited per owner rule. Switching:** …mini skirt'), true)
})

test('reasonRevisesMidSentence does not false-positive on a clean reason containing "waiting"', () => {
  assert.equal(reasonRevisesMidSentence('This look is worth waiting for sunset to photograph.'), false)
})

test('a submitted plan outfit whose reason revises itself mid-sentence is rejected with the coaching message', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'revision top', occasions: ['city'] })
  const bottomId = insertPiece({ category: 'bottom', name: 'revision bottom', occasions: ['city'] })
  const shoesId = insertPiece({ category: 'shoes', name: 'revision shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Thursday', occasion: 'city', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'office week' })
  const slot = workbench.pendingPlan.slots[0]

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(topId), Number(bottomId), Number(shoesId)],
    reason: '**wait, maxi skirt is prohibited per owner rule. Switching:** …mini skirt'
  }])

  assert.equal(result.accepted.length, 0)
  assert.match(result.failures[0].reasons.join(' '), /your reason revises itself mid-sentence/)
})

test('resubmission with a clean, non-revising reason is accepted', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'clean top', occasions: ['city'] })
  const bottomId = insertPiece({ category: 'bottom', name: 'clean bottom', occasions: ['city'] })
  const shoesId = insertPiece({ category: 'shoes', name: 'clean shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Thursday', occasion: 'city', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'office week' })
  const slot = workbench.pendingPlan.slots[0]

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(topId), Number(bottomId), Number(shoesId)],
    reason: 'A quiet, structured look worth waiting for sunset to photograph.'
  }])

  assert.equal(result.failures.length, 0, `expected the clean reason to pass, got ${JSON.stringify(result.failures)}`)
  assert.equal(result.accepted.length, 1)
})

// --- One-layer instruction (spec 24 Part 4) ---------------------------------

test('workbench instructions include the one-layer-per-outfit line', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'City Day', occasion: 'city', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day' })
  assert.match(workbench.instructions, /At most one layer \(cardigan, jacket, or shawl\) per outfit/)
})

// --- Submit-success anti-rebuild line (spec 24 Part 5) ----------------------

test('submit_plan_outfits success message tells the model not to call propose_outfit or render again', async () => {
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'anti-rebuild top', occasions: ['city'] })
  insertPiece({ category: 'bottom', name: 'anti-rebuild bottom', occasions: ['city'] })
  insertPiece({ category: 'shoes', name: 'anti-rebuild shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })

  const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'one city outfit' }
  await executeTool('plan_outfit_set', {
    slots: [{ label: 'City Day', occasion: 'city', activity: 'none', count: 1 }]
  }, toolContext)
  const slot = toolContext.pendingPlan.slots[0]
  const result = await executeTool('submit_plan_outfits', {
    outfits: [{
      slot_id: slot.id,
      piece_ids: [
        pieceIdByName(slot, 'anti-rebuild top'),
        pieceIdByName(slot, 'anti-rebuild bottom'),
        pieceIdByName(slot, 'anti-rebuild shoes')
      ]
    }]
  }, toolContext)

  assert.equal(result.status, 'success')
  assert.match(result.message, /do NOT call propose_outfit or render them again/)
})

// --- Partial-accept gap-fill pointer (spec 26 Part 2) -----------------------

test('the partial-accept success message after the resubmit cap names the plan_outfit_set gap-fill path', async () => {
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'A top', occasions: ['city'] })
  insertPiece({ category: 'bottom', name: 'A bottom', occasions: ['city'] })
  insertPiece({ category: 'shoes', name: 'A shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  insertPiece({ category: 'top', name: 'B top', occasions: ['city'] })
  insertPiece({ category: 'bottom', name: 'B bottom', occasions: ['city'] })
  insertPiece({ category: 'shoes', name: 'B shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })

  const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'two days' }
  await executeTool('plan_outfit_set', {
    slots: [
      { label: 'Day A', occasion: 'city', activity: 'none', count: 1 },
      { label: 'Day B', occasion: 'city', activity: 'none', count: 1 },
    ]
  }, toolContext)
  const slotA = toolContext.pendingPlan.slots.find(slot => slot.label === 'Day A')

  // Day A submits successfully and stays held; Day B is never submitted, so
  // every round comes back a validation_error until the resubmit cap flips
  // the response to a partial success.
  const submitDayAOnly = () => executeTool('submit_plan_outfits', {
    outfits: [{
      slot_id: slotA.id,
      piece_ids: [
        pieceIdByName(slotA, 'A top'),
        pieceIdByName(slotA, 'A bottom'),
        pieceIdByName(slotA, 'A shoes')
      ]
    }]
  }, toolContext)

  const first = await submitDayAOnly()
  assert.equal(first.status, 'validation_error')
  const second = await submitDayAOnly()
  assert.equal(second.status, 'validation_error')
  const third = await submitDayAOnly()

  assert.equal(third.status, 'success')
  assert.equal(third.partial, true)
  assert.match(third.message, /To fill the disclosed gaps, call plan_outfit_set again with JUST the unfilled slot\(s\) — accepted cards carry forward automatically\./)

  await executeTool('plan_outfit_set', {
    slots: [{ label: 'Day B', occasion: 'city', activity: 'none', count: 1 }]
  }, toolContext)
  assert.equal(toolContext.pendingPlan.heldOutfits.length, 1, 'the accepted Day A card must remain held during gap fill')
  const slotB = toolContext.pendingPlan.slots.find(slot => slot.label === 'Day B')
  const completed = await executeTool('submit_plan_outfits', {
    outfits: [{
      slot_id: slotB.id,
      piece_ids: [
        pieceIdByName(slotB, 'B top'),
        pieceIdByName(slotB, 'B bottom'),
        pieceIdByName(slotB, 'B shoes')
      ]
    }]
  }, toolContext)
  assert.equal(completed.status, 'success', JSON.stringify(completed))
  assert.equal(toolContext.generatedOutfits.length, 2, 'gap fill must deliver the prior accepted card plus the new one')
})

test('a compatible Supplement label closes the original partial-delivery gap instead of creating a second slot', () => {
  const priorSlot = {
    id: 'casual_indoors',
    label: 'Casual Indoors',
    occasion: 'casual',
    activity: 'none',
    environment: 'indoor',
    targetOutfits: 3,
    originalIndex: 0
  }
  const priorHeld = [
    { _slotId: priorSlot.id, pieceIds: [1, 2, 3] },
    { _slotId: priorSlot.id, pieceIds: [4, 5, 6] }
  ]
  const supplementSlot = {
    ...priorSlot,
    id: 'casual_indoors_supplement',
    label: 'Casual Indoors Supplement',
    targetOutfits: 1
  }
  const merged = mergePendingPlanForReplan({
    slots: [priorSlot],
    heldOutfits: priorHeld,
    partialDelivered: true,
    constraints: {},
    piecesById: new Map()
  }, {
    slots: [supplementSlot],
    heldOutfits: [],
    constraints: {},
    piecesById: new Map()
  })

  assert.deepEqual(merged.slots.map(slot => slot.id), ['casual_indoors'])
  assert.equal(merged.slots[0].targetOutfits, 3, 'two held cards plus the one-card gap fill should restore the original target')
  assert.equal(merged.heldOutfits.length, 2)
})

test('winter indoor sleeveless bases require a stay-on cardigan; a puffer alone does not satisfy the layer', () => {
  const sleeveless = parsePiece({
    id: 1, name: 'black sleeveless blouse', category: 'top', sleeve_type: 'sleeveless',
    formality: 'elevated', status: 'active', style_profile_json: '{}'
  })
  const bottom = parsePiece({ id: 2, name: 'black trousers', category: 'bottom', formality: 'elevated', status: 'active', style_profile_json: '{}' })
  const shoes = parsePiece({ id: 3, name: 'ankle boots', category: 'shoes', formality: 'elevated', status: 'active', style_profile_json: '{}' })
  const puffer = parsePiece({
    id: 4, name: 'black puffer coat', category: 'outerwear', fabric_weight: 'heavy',
    formality: 'elevated', status: 'active', style_profile_json: '{}'
  })
  const cardigan = parsePiece({
    id: 5, name: 'grey knit cardigan', category: 'outerwear', fabric_weight: 'medium',
    formality: 'everyday', status: 'active', style_profile_json: '{}'
  })
  const pieces = [sleeveless, bottom, shoes, puffer, cardigan]
  const slot = {
    id: 'winter_dinner',
    label: 'Winter Dinner',
    occasion: 'evening',
    activity: 'none',
    environment: 'indoor',
    targetOutfits: 1,
    gateAllowedIds: new Set(pieces.map(piece => piece.id)),
    rosterIds: new Set(pieces.map(piece => piece.id)),
    weatherProfile: {}
  }
  const plan = {
    slots: [slot],
    piecesById: new Map(pieces.map(piece => [piece.id, piece])),
    constraints: { noRepeat: new Set(), anchorIds: new Set(), pieceBudget: 14 },
    heldOutfits: [],
    isWinterCapsule: true
  }

  const coatOnly = validateSubmittedPlanOutfits(plan, [{
    slot_id: slot.id,
    piece_ids: [sleeveless.id, bottom.id, shoes.id, puffer.id]
  }])
  assert.equal(coatOnly.accepted.length, 0)
  assert.match(coatOnly.failures[0].reasons.join(' '), /transition coat alone does not satisfy/)

  const stayOnLayer = validateSubmittedPlanOutfits(plan, [{
    slot_id: slot.id,
    piece_ids: [sleeveless.id, bottom.id, shoes.id, cardigan.id]
  }])
  assert.equal(stayOnLayer.accepted.length, 1, JSON.stringify(stayOnLayer.failures))
})

// --- Owner rules delivered into the plan workbench (spec 25 Part 2) --------

test('workbench instructions contain the OWNER RULES block when owner rules exist, and respect the cap', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'City Day', occasion: 'city', activity: 'none', count: 1 }])

  const withRules = await buildPlanSlotWorkbench(slots, {
    allPieces,
    question: 'city day',
    ownerRules: ['For office and client days: structured silhouettes only — no maxi skirts, no shawls at work.', 'No flats for me.']
  })
  assert.match(withRules.instructions, /OWNER RULES — hard requirements, not suggestions\./)
  assert.match(withRules.instructions, /Apply to every outfit you compose:/)
  assert.match(withRules.instructions, /"For office and client days: structured silhouettes only — no maxi skirts, no shawls at work\."/)
  assert.match(withRules.instructions, /"No flats for me\."/)
})

test('workbench instructions carry the professional-slot styling line unconditionally (spec 26 Part 6)', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'City Day', occasion: 'city', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day' })
  assert.match(workbench.instructions, /at most ONE bold print per outfit/)
  assert.match(workbench.instructions, /no statement wraps at work/)
})

test('model plan workbench exposes authoritative garment construction without special-case rules', async () => {
  const allPieces = [
    {
      id: 9101,
      name: 'white tailed shirt',
      category: 'top',
      colors: ['white'],
      occasions: ['city'],
      formality: 'everyday',
      silhouette: 'oversized',
      length_hits_at: 'hip',
      hem_finish: 'design_hem',
      sleeve_type: 'long',
      fit_on_body: 'hangs_straight',
      tuck_behavior: 'wear_over_only',
      opacity: 'opaque',
      fabric_category: 'cotton',
      status: 'active',
    },
    { id: 9102, name: 'navy trousers', category: 'bottom', colors: ['navy'], occasions: ['city'], formality: 'everyday', status: 'active' },
    { id: 9103, name: 'black loafers', category: 'shoes', colors: ['black'], occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high', status: 'active' },
  ]
  const slots = normalizePlanSlots([{ label: 'Gallery', occasion: 'city', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'gallery outfit' })
  const shirtLine = workbench.piece_catalog.find(line => line.includes('white tailed shirt'))

  assert.match(shirtLine, /silhouette:oversized/)
  assert.match(shirtLine, /length:hip/)
  assert.match(shirtLine, /hem:design_hem/)
  assert.match(shirtLine, /fit:hangs_straight/)
  assert.match(shirtLine, /tuck:wear_over_only/)
  assert.match(workbench.instructions, /authoritative garment construction/)
  assert.doesNotMatch(workbench.instructions, /NO_TUCK|wear_over_only/)
})

test('workbench instructions omit the OWNER RULES block when no owner rules exist', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'City Day', occasion: 'city', activity: 'none', count: 1 }])

  const withoutRules = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day' })
  assert.doesNotMatch(withoutRules.instructions, /OWNER RULES/)

  const withEmptyRules = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day', ownerRules: [] })
  assert.doesNotMatch(withEmptyRules.instructions, /OWNER RULES/)
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
    sleeve_type: '',
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
      formality, sleeve_type, length_hits_at, heel_height, walk_support, style_profile_json
    ) VALUES (
      @name, @category, @colors, @occasions, @season, @notes, @status,
      @recommendation_status, @fit_confidence, @role_permission, @occasion_permissions,
      @engine_notes, @photo, @worn_photo, @pattern_type, @pattern_scale,
      @pattern_complexity, @reads_as, @silhouette, @fabric_category, @fabric_weight, @fiber_content,
      @formality, @sleeve_type, @length_hits_at, @heel_height, @walk_support, @style_profile_json
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

test('normalizePlanSlots merges equivalent ordinal variants into one coverage slot', () => {
  const diagnostics = {}
  const bump = field => { diagnostics[field] = (diagnostics[field] || 0) + 1 }
  const slots = normalizePlanSlots([
    {
      label: 'Casual Indoor Day 1',
      occasion: 'casual',
      activity: 'none',
      environment: 'indoor',
      count: 2,
      best_for: 'Casual Indoor Day 1'
    },
    {
      label: 'Casual Indoor Day 2',
      occasion: 'casual',
      activity: 'none',
      environment: 'indoor',
      count: 1,
      best_for: 'Casual Indoor Day 2'
    }
  ], { fallbackWeather: 'winter', onDiagnostic: bump })

  assert.equal(slots.length, 1)
  assert.equal(slots[0].id, 'casual_indoor')
  assert.equal(slots[0].label, 'Casual Indoor')
  assert.equal(slots[0].bestFor, 'Casual Indoor')
  assert.equal(slots[0].targetOutfits, 3)
  assert.deepEqual(diagnostics, { planEquivalentSlotsMerged: 1 })
})

test('normalizePlanSlots preserves ordinal slots when their structured use cases differ', () => {
  const slots = normalizePlanSlots([
    {
      label: 'City Day 1',
      occasion: 'city',
      activity: 'walking',
      environment: 'outdoor',
      date: '2026-08-01',
      count: 1,
      best_for: 'City Day 1'
    },
    {
      label: 'City Day 2',
      occasion: 'city',
      activity: 'walking',
      environment: 'indoor',
      date: '2026-08-02',
      count: 1,
      best_for: 'City Day 2'
    }
  ], { fallbackWeather: 'warm' })

  assert.equal(slots.length, 2)
  assert.deepEqual(slots.map(slot => slot.label), ['City Day 1', 'City Day 2'])
  assert.notEqual(slots[0].id, slots[1].id, 'distinct slots must retain distinct IDs')
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

test('selectCapsuleRoster never spends a roster slot on a piece blocked in every requested context', async () => {
  db.prepare('DELETE FROM pieces').run()
  for (const [name, recommendationStatus] of [
    ['cream experimental crochet top', 'experimental'],
    ['olive trusted cotton top', 'trusted'],
    ['navy trusted linen top', 'trusted'],
  ]) {
    insertPiece({
      category: 'top',
      name,
      recommendation_status: recommendationStatus,
      colors: ['cream'],
      reads_as: 'summer capsule top',
      fabric_category: 'cotton',
      fabric_weight: 'light',
      pattern_type: 'solid',
      formality: 'everyday',
      occasions: ['casual', 'city']
    })
  }
  for (const name of ['black cotton pants', 'tan linen skirt']) {
    insertPiece({ category: 'bottom', name, colors: ['black'], reads_as: 'summer capsule bottom', fabric_weight: 'light', pattern_type: 'solid', formality: 'everyday', occasions: ['casual', 'city'] })
  }
  insertPiece({ category: 'dress', name: 'olive day dress', colors: ['olive'], reads_as: 'summer day dress', fabric_weight: 'light', formality: 'everyday', occasions: ['casual', 'city'] })
  for (const name of ['navy canvas flats', 'white walking sneakers']) {
    insertPiece({ category: 'shoes', name, colors: ['navy'], reads_as: 'summer walking shoes', formality: 'everyday', occasions: ['casual', 'city'], heel_height: 'flat', walk_support: 'medium' })
  }

  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'At Home', occasion: 'casual', environment: 'indoor', count: 2 },
    { label: 'City Outing', occasion: 'city', activity: 'walking', weather: 'warm', count: 2 },
  ])
  const roster = selectCapsuleRoster(pool, {
    budget: 8,
    isSummer: true,
    occasions: slots.map(slot => slot.occasion),
    slots
  })

  assert.ok(!roster.some(piece => piece.name === 'cream experimental crochet top'), `all-slot-blocked piece consumed the roster: ${roster.map(piece => piece.name)}`)
  assert.ok(roster.some(piece => piece.name === 'olive trusted cotton top'), `eligible replacement should fill the top quota: ${roster.map(piece => piece.name)}`)
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
  const cap = capsuleTotalOutfitCap(24)
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

test('mixed-register capsule preserves an everyday shoe instead of spending the full shoe quota on elevated looks', async () => {
  const pool = seedShoeReserveFixture()
  insertPiece({ category: 'shoes', name: 'cream block heel mules', colors: ['cream'], reads_as: 'polished block heel mules', occasions: ['smart casual', 'evening'], formality: 'elevated', heel_height: 'high', walk_support: 'medium' })
  const refreshedPool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Casual Indoor', occasion: 'casual', count: 3 },
    { label: 'Brunch Gallery', occasion: 'smart casual', count: 3 },
    { label: 'Restaurant Dinner', occasion: 'evening', register: 'dressy', count: 2 },
  ])
  const roster = selectCapsuleRoster(refreshedPool, { budget: 14, occasions: slots.map(slot => slot.occasion), slots })
  const rosterShoes = roster.filter(piece => wardrobeCategoryGroup(piece) === 'shoes')

  assert.ok(rosterShoes.some(piece => piece.formality === 'everyday'), `casual must retain a legal everyday shoe, got ${rosterShoes.map(piece => `${piece.name}:${piece.formality}`)}`)
  assert.ok(rosterShoes.filter(piece => piece.formality === 'elevated').length >= 1, `dressier slots must retain an elevated shoe path, got ${rosterShoes.map(piece => `${piece.name}:${piece.formality}`)}`)
  assert.ok(rosterShoes.length <= 3, `shoe guarantees must remain inside the 14-piece capsule quota, got ${rosterShoes.length}`)
})

test('explicit winter indoor capsule excludes warm-only tops and keeps sleeve-covered bases in the majority', async () => {
  db.prepare('DELETE FROM pieces').run()
  for (const [name, season, sleeves] of [
    ['warm floral tank', 'warm', 'sleeveless'],
    ['year round blue shell', 'year-round', 'sleeveless'],
    ['year round olive shell', 'year-round', 'sleeveless'],
    ['charcoal short sleeve knit', 'year-round', 'short'],
    ['navy three quarter sleeve top', 'year-round', '3/4'],
    ['plum long sleeve blouse', 'year-round', 'long'],
    ['cream long sleeve knit', 'year-round', 'long'],
  ]) {
    insertPiece({ category: 'top', name, season, sleeve_type: sleeves, colors: ['navy'], reads_as: 'indoor capsule top', pattern_type: 'solid', fabric_weight: 'medium', formality: 'everyday', occasions: ['casual', 'smart-casual', 'city'] })
  }
  for (const name of ['black pants', 'navy jeans', 'grey trousers', 'olive skirt']) {
    insertPiece({ category: 'bottom', name, season: 'year-round', colors: ['black'], reads_as: 'capsule bottom', formality: 'everyday', occasions: ['casual', 'smart-casual', 'city'] })
  }
  insertPiece({ category: 'dress', name: 'indoor day dress', season: 'year-round', sleeve_type: 'short', colors: ['navy'], reads_as: 'indoor dress', formality: 'everyday', occasions: ['casual', 'smart-casual'] })
  insertPiece({ category: 'outerwear', name: 'transition jacket', season: 'year-round', sleeve_type: 'long', colors: ['olive'], reads_as: 'light transition jacket', formality: 'everyday', occasions: ['casual', 'smart-casual', 'city'] })
  insertPiece({ category: 'outerwear', name: 'charcoal knit cardigan', season: 'cool', sleeve_type: 'long', colors: ['charcoal'], reads_as: 'soft indoor cardigan', fabric_category: 'knit', fabric_weight: 'medium', fiber_content: ['wool'], formality: 'everyday', occasions: ['casual', 'smart-casual', 'city'] })
  insertPiece({
    category: 'outerwear',
    name: 'black winter puffer coat',
    season: 'cool',
    sleeve_type: 'long',
    colors: ['black'],
    reads_as: 'insulated winter coat',
    fabric_category: 'synthetic',
    fabric_weight: 'heavy',
    fiber_content: ['polyester'],
    formality: 'elevated',
    occasions: ['casual', 'smart-casual', 'city', 'outdoor', 'evening'],
    style_profile_json: {
      garment_intelligence: {
        auto_use_trust: 'trusted',
        occasion_confidence: { casual: 'high', 'smart-casual': 'low', evening: 'low', outdoor: 'high' }
      }
    }
  })
  for (const name of ['olive slip ons', 'brown boots', 'black loafers']) {
    insertPiece({ category: 'shoes', name, season: 'year-round', colors: ['brown'], reads_as: 'capsule shoes', formality: 'everyday', occasions: ['casual', 'smart-casual', 'city'], heel_height: 'flat', walk_support: 'medium' })
  }

  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Casual Indoor', occasion: 'casual', weather: 'indoor', count: 3 },
    { label: 'Brunch Gallery', occasion: 'smart casual', weather: 'indoor', count: 3 },
    { label: 'Restaurant Dinner', occasion: 'evening', weather: 'indoor', count: 2 },
  ])
  const roster = selectCapsuleRoster(pool, { budget: 14, isWinter: true, occasions: slots.map(slot => slot.occasion), slots })
  const tops = roster.filter(piece => wardrobeCategoryGroup(piece) === 'top')
  const layers = roster.filter(piece => wardrobeCategoryGroup(piece) === 'outerwear')
  const covered = tops.filter(piece => ['short', '3/4', 'long'].includes(piece.sleeve_type))

  assert.ok(!roster.some(piece => piece.name === 'warm floral tank'), `warm-only top should not consume explicit winter roster space, got ${roster.map(piece => piece.name)}`)
  assert.ok(covered.length >= Math.ceil(tops.length / 2), `sleeve-covered indoor bases should be the majority, got ${tops.map(piece => `${piece.name}:${piece.sleeve_type}`)}`)
  assert.ok(tops.some(piece => piece.sleeve_type === 'sleeveless'), 'year-round sleeveless layering bases should remain eligible')
  assert.equal(layers.length, 2, `14-piece winter capsule should budget two distinct layer roles, got ${layers.map(piece => piece.name)}`)
  assert.ok(layers.some(piece => piece.name === 'charcoal knit cardigan'), `winter capsule should reserve an indoor knit layer, got ${layers.map(piece => piece.name)}`)
  assert.ok(layers.some(piece => piece.name === 'black winter puffer coat'), `winter capsule should reserve cold-capable transition outerwear, got ${layers.map(piece => piece.name)}`)

  const workbench = await buildPlanSlotWorkbench(slots, {
    constraints: { piece_budget: 14, reuse: 'maximize' },
    allPieces: pool,
    question: 'Build a 14-piece winter capsule with reusable outerwear for transitions',
    planKind: 'seasonal_capsule'
  })
  const dinner = workbench.pendingPlan.slots.find(slot => slot.id === 'restaurant_dinner')
  assert.ok(dinner.allowedPieces.some(piece => piece.name === 'black winter puffer coat'), 'explicit user evening tag must override stale low AI evening confidence for the transition coat')
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

test('a tight mixed shoe quota lets one hiking shoe cover the everyday demand and keeps an elevated shoe', async () => {
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
  // The hiking shoe also clears the everyday ceiling. The mixed-register
  // allocator must count that overlap and leave the second slot elevated.
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
  assert.equal(roster.shoeReserveGaps, undefined, `the two-shoe assignment is feasible and should not report a gap, got ${JSON.stringify(roster.shoeReserveGaps)}`)
})

test('capsule pool rejection names the curated roster, not "active", when the piece is genuinely a real wardrobe item', async () => {
  const pool = seedShoeReserveFixture()
  const slots = normalizePlanSlots([
    { label: 'Smart Casual Dinner', occasion: 'smart casual', count: 1 },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces: pool, question: 'a 10-piece capsule', constraints: { piece_budget: 10 }, planKind: 'seasonal_capsule' })
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

test('a numeric piece budget does not activate capsule selection without seasonal_capsule plan kind', async () => {
  const pool = seedShoeReserveFixture()
  const slots = normalizePlanSlots([
    { label: 'Trip dinner', occasion: 'smart casual', count: 1 },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, {
    allPieces: pool,
    question: 'Pack within 10 pieces',
    constraints: { piece_budget: 10, reuse: 'maximize' },
    planKind: 'trip'
  })
  assert.equal(workbench.pendingPlan.planKind, 'trip')
  assert.deepEqual(workbench.pendingPlan.capsuleRoster, [])
  assert.ok(workbench.slots[0].allowed_piece_ids.length > 0)
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

test('mixed winter capsule preserves an evening separates path after reserving casual rotation', async () => {
  db.prepare("DELETE FROM pieces").run()
  for (const [name, color] of [['charcoal knit top', 'charcoal'], ['navy jersey top', 'navy'], ['olive cotton top', 'olive'], ['cream ribbed top', 'cream'], ['black ponte top', 'black'], ['grey mock neck top', 'grey']]) {
    insertPiece({ category: 'top', name, colors: [color], reads_as: 'easy indoor top', pattern_type: 'solid', fabric_weight: 'medium', formality: 'everyday', occasions: ['casual', 'city', 'work', 'travel'] })
  }
  insertPiece({ category: 'top', name: 'plum silk evening blouse', colors: ['plum'], reads_as: 'polished evening blouse', pattern_type: 'abstract', fabric_category: 'silk', fabric_weight: 'light', formality: 'elevated', occasions: ['evening'] })

  for (const [name, color] of [['grey utility pants', 'grey'], ['blue straight jeans', 'blue'], ['olive casual pants', 'olive'], ['black casual skirt', 'black'], ['navy corduroy pants', 'navy']]) {
    insertPiece({ category: 'bottom', name, colors: [color], reads_as: 'easy everyday bottom', pattern_type: 'solid', fabric_weight: 'medium', formality: 'everyday', occasions: ['casual', 'city', 'work', 'travel'] })
  }
  insertPiece({ category: 'bottom', name: 'burgundy tailored evening trousers', colors: ['burgundy'], reads_as: 'polished tailored trousers', pattern_type: 'abstract', fabric_weight: 'medium', formality: 'elevated', occasions: ['evening'] })

  insertPiece({ category: 'dress', name: 'casual knit day dress', colors: ['navy'], reads_as: 'easy day dress', fabric_weight: 'medium', formality: 'everyday', occasions: ['casual'] })
  insertPiece({ category: 'outerwear', name: 'black wool coat', colors: ['black'], reads_as: 'warm shared winter layer', fabric_weight: 'heavy', formality: 'elevated', occasions: ['casual', 'city', 'evening'] })
  insertPiece({ category: 'shoes', name: 'grey walking sneakers', colors: ['grey'], reads_as: 'comfortable sneakers', formality: 'everyday', occasions: ['casual', 'city'], heel_height: 'flat', walk_support: 'high' })
  insertPiece({ category: 'shoes', name: 'black everyday loafers', colors: ['black'], reads_as: 'easy loafers', formality: 'everyday', occasions: ['casual', 'city'], heel_height: 'flat', walk_support: 'medium' })
  insertPiece({ category: 'shoes', name: 'black evening boots', colors: ['black'], reads_as: 'refined evening boots', formality: 'elevated', occasions: ['evening'], heel_height: 'low', walk_support: 'medium' })

  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Casual Indoor Days', occasion: 'casual', activity: 'none', weather: 'indoor', count: 4 },
    { label: 'Restaurant Dinner', occasion: 'evening', activity: 'none', weather: 'indoor', count: 1 },
  ])
  const roster = selectCapsuleRoster(pool, { budget: 14, occasions: slots.map(slot => slot.occasion), slots })
  const selected = group => roster.filter(piece => wardrobeCategoryGroup(piece) === group)

  assert.ok(selected('top').some(piece => piece.formality === 'everyday'), 'casual top coverage must survive')
  assert.ok(selected('bottom').some(piece => piece.formality === 'everyday'), 'casual bottom coverage must survive')
  assert.ok(selected('top').some(piece => piece.formality === 'elevated'), `evening needs an elevated top path, got ${roster.map(piece => piece.name)}`)
  assert.ok(selected('bottom').some(piece => piece.formality === 'elevated'), `evening needs an elevated bottom path, got ${roster.map(piece => piece.name)}`)
  assert.ok(selected('outerwear').some(piece => piece.name === 'black wool coat'), 'winter warmth should come from a reusable layer')
  assert.ok(roster.length <= 14, `coverage reserves must remain inside the piece budget, got ${roster.length}`)
})

// --- Capsule bench builder + roster validator (spec steps 1-2) --------------
// docs/capsule-bench-implementation-brief.md. The bench is additive — it does
// not change selectCapsuleRoster's own output — so these pin the bench's own
// guarantees plus the validator's acceptance of today's ratified roster.

test('buildCapsuleBench honours per-category minimums when the global ranking would have starved a category', () => {
  db.prepare('DELETE FROM pieces').run()
  for (let i = 0; i < 8; i += 1) {
    insertPiece({ category: 'top', name: `neutral versatile top ${i}`, colors: ['black'], pattern_type: 'solid', occasions: ['casual', 'city', 'smart casual', 'evening'], formality: 'everyday' })
  }
  // These two bottoms score far below every top (colorful, patterned, one
  // occasion tag) — a plain "top 40 by rank" bench with a small size would
  // drop them entirely even though the category needs at least 2 bottoms.
  for (const name of ['loud print bottom A', 'loud print bottom B']) {
    insertPiece({ category: 'bottom', name, colors: ['orange'], pattern_type: 'floral', occasions: ['casual'], formality: 'everyday' })
  }
  insertPiece({ category: 'dress', name: 'plain dress', colors: ['black'], pattern_type: 'solid', occasions: ['casual', 'city'], formality: 'everyday' })
  for (const name of ['shoe A', 'shoe B']) {
    insertPiece({ category: 'shoes', name, colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })
  }
  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 1 }])
  const { bench, diagnostics } = buildCapsuleBench(pool, { budget: 10, slots, benchSize: 8 })

  const bottomNames = bench.filter(piece => wardrobeCategoryGroup(piece) === 'bottom').map(piece => piece.name)
  assert.ok(bottomNames.length >= 2, `low-ranked bottoms should still be admitted by the category minimum, got bench bottoms: ${bottomNames}`)
  assert.equal(diagnostics.perCategory.bottom.minimum, 2)
})

test('buildCapsuleBench honours the per-slot minimum — a low-ranked piece that is the only thing covering a slot is admitted', () => {
  db.prepare('DELETE FROM pieces').run()
  for (let i = 0; i < 5; i += 1) {
    insertPiece({ category: 'top', name: `casual top ${i}`, colors: ['black'], pattern_type: 'solid', occasions: ['casual', 'city'], formality: 'everyday' })
    insertPiece({ category: 'bottom', name: `casual bottom ${i}`, colors: ['black'], pattern_type: 'solid', occasions: ['casual', 'city'], formality: 'everyday' })
    insertPiece({ category: 'shoes', name: `casual shoe ${i}`, colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })
  }
  // The gate's occasion filter passes casual tops/shoes for an 'evening'
  // slot on trust/formality grounds even without an 'evening' occasion tag
  // (measured: filterWholeWardrobePiecesForGeneration), but excludes
  // bottoms lacking one — so this bottom is the only thing that can complete
  // a Restaurant Dinner core, low-scoring (single occasion tag, patterned,
  // non-neutral) so a plain rank cut would leave it out.
  insertPiece({ category: 'bottom', name: 'evening only bottom', colors: ['fuchsia'], pattern_type: 'floral', occasions: ['evening'], formality: 'elevated' })

  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Everyday', occasion: 'casual', count: 3 },
    { label: 'Restaurant Dinner', occasion: 'evening', register: 'dressy', count: 1 },
  ])
  const { bench, diagnostics } = buildCapsuleBench(pool, { budget: 10, slots, benchSize: 6 })
  const benchNames = bench.map(piece => piece.name)

  assert.ok(benchNames.includes('evening only bottom'), `the only bottom covering the evening slot must be admitted, got ${benchNames}`)
  const eveningDiag = diagnostics.perSlot.find(entry => entry.slot === 'Restaurant Dinner')
  assert.ok(eveningDiag?.canFormCore, `evening slot diagnostics should report a formable core, got ${JSON.stringify(diagnostics.perSlot)}`)
})

test('buildCapsuleBench is deterministic across two calls with identical inputs', () => {
  db.prepare('DELETE FROM pieces').run()
  for (let i = 0; i < 6; i += 1) insertPiece({ category: 'top', name: `top ${i}`, colors: ['black'], pattern_type: 'solid', occasions: ['casual', 'city'], formality: 'everyday' })
  for (let i = 0; i < 4; i += 1) insertPiece({ category: 'bottom', name: `bottom ${i}`, colors: ['black'], pattern_type: 'solid', occasions: ['casual', 'city'], formality: 'everyday' })
  insertPiece({ category: 'dress', name: 'day dress', colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })
  for (let i = 0; i < 3; i += 1) insertPiece({ category: 'shoes', name: `shoe ${i}`, colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })

  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  // Every top and every bottom scores identically here (same fields), so this
  // also pins the tie-break: without a stable id-ascending tiebreak the bench
  // could reshuffle between calls and be untestable downstream.
  const first = buildCapsuleBench(pool, { budget: 10, slots, benchSize: 8 })
  const second = buildCapsuleBench(pool, { budget: 10, slots, benchSize: 8 })
  assert.deepEqual(first.bench.map(piece => piece.id), second.bench.map(piece => piece.id))
})

test('buildCapsuleBench keeps guaranteed pieces even when they push the bench past benchSize', () => {
  db.prepare('DELETE FROM pieces').run()
  for (let i = 0; i < 6; i += 1) insertPiece({ category: 'top', name: `top ${i}`, colors: ['black'], pattern_type: 'solid', occasions: ['casual', 'city'], formality: 'everyday' })
  for (let i = 0; i < 4; i += 1) insertPiece({ category: 'bottom', name: `bottom ${i}`, colors: ['black'], pattern_type: 'solid', occasions: ['casual', 'city'], formality: 'everyday' })
  for (let i = 0; i < 3; i += 1) insertPiece({ category: 'shoes', name: `shoe ${i}`, colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })
  insertPiece({ category: 'dress', name: 'day dress', colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })

  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  const { bench, diagnostics } = buildCapsuleBench(pool, { budget: 10, slots, benchSize: 3 })

  assert.ok(bench.length > 3, `guarantees must not be dropped to hit benchSize, got ${bench.length}`)
  assert.ok(diagnostics.exceededTarget)
  assert.equal(diagnostics.targetBenchSize, 3)
})

// Review finding (2026-07-28): a rank-only bench silently dropped exactly the
// pieces the reserve passes exist to rescue — a shoe reserved for one dressy
// slot, a dress that clears a register floor — because capsuleVersatilityScore
// scores pieces in isolation and coverage pieces are by definition not the
// most "versatile" ones. Fix: buildCapsuleBench now seeds the bench with
// today's deterministic selectCapsuleRoster output before rank-filling. This
// is the regression that would have caught the hole: the bench must contain
// every roster piece, across the full scenario matrix, not just look
// reasonable on one budget.
test("buildCapsuleBench contains every piece of today's deterministic roster across the full scenario matrix", () => {
  db.prepare('DELETE FROM pieces').run()
  for (const name of ['white cotton tee', 'olive cotton tank', 'graphic fruit stand tee', 'vibrant blue sleeveless top', 'charcoal knit top', 'navy jersey top']) {
    insertPiece({ category: 'top', name, colors: ['white'], reads_as: 'easy everyday top', fabric_category: 'cotton', fabric_weight: 'light', formality: 'everyday', occasions: ['casual', 'city', 'outdoor_daytime_social'] })
  }
  for (const name of ['black silk blouse', 'white tie front blouse', 'large flowers floral print tank', 'plum silk evening blouse']) {
    insertPiece({ category: 'top', name, colors: ['black'], reads_as: 'polished elevated top', fabric_category: 'silk', fabric_weight: 'light', formality: 'elevated', occasions: ['city', 'smart casual', 'evening', 'gallery / art event'] })
  }
  for (const name of ['tan solid straight shorts', 'beige twill cargo capri pants', 'light beige linen wide-leg pants', 'grey utility pants', 'blue straight jeans']) {
    insertPiece({ category: 'bottom', name, colors: ['tan'], reads_as: 'everyday bottom', bottom_shape: 'straight', fabric_category: 'linen', fabric_weight: 'light', formality: 'everyday', occasions: ['casual', 'city', 'outdoor_daytime_social', 'evening', 'gallery / art event'] })
  }
  for (const name of ['Apple skirt', 'burgundy tailored evening trousers']) {
    insertPiece({ category: 'bottom', name, colors: ['burgundy'], reads_as: 'polished elevated bottom', bottom_shape: 'a_line_skirt', fabric_category: 'silk', fabric_weight: 'light', formality: 'elevated', occasions: ['casual', 'city', 'outdoor_daytime_social', 'evening', 'gallery / art event'] })
  }
  insertPiece({ category: 'dress', name: 'blue botanical sleeveless dress', colors: ['blue'], reads_as: 'easy warm dress', fabric_category: 'rayon', fabric_weight: 'light', formality: 'everyday', occasions: ['casual', 'city'] })
  insertPiece({ category: 'dress', name: 'grey wool black stripe knit dress', colors: ['grey'], reads_as: 'polished elevated dress', fabric_category: 'wool', fabric_weight: 'medium', formality: 'elevated', occasions: ['casual', 'city', 'evening'] })
  insertPiece({ category: 'outerwear', name: 'charcoal knit cardigan', season: 'cool', colors: ['charcoal'], reads_as: 'soft indoor cardigan', fabric_category: 'knit', fabric_weight: 'medium', fiber_content: ['wool'], formality: 'everyday', occasions: ['casual', 'city'] })
  insertPiece({ category: 'outerwear', name: 'black winter puffer coat', season: 'cool', colors: ['black'], reads_as: 'insulated winter coat', fabric_category: 'synthetic', fabric_weight: 'heavy', fiber_content: ['polyester'], formality: 'elevated', occasions: ['casual', 'city', 'outdoor', 'evening'] })
  for (const name of ['navy canvas slip shoes', 'taupe knit lace-up sneakers', 'white leather sneakers', 'grey walking sneakers']) {
    insertPiece({ category: 'shoes', name, colors: ['navy'], reads_as: 'everyday shoes', formality: 'everyday', occasions: ['casual', 'city', 'outdoor_daytime_social'], heel_height: 'flat', walk_support: 'medium' })
  }
  for (const name of ['black suede lace-up shoes', 'cream leather mules', 'navy low block heels', 'black evening boots']) {
    insertPiece({ category: 'shoes', name, colors: ['black'], reads_as: 'polished elevated shoes', formality: 'elevated', occasions: ['city', 'smart casual', 'evening', 'gallery / art event'], heel_height: 'low', walk_support: 'medium' })
  }

  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const BUDGETS = [10, 14, 18, 24]
  const SEASON_FLAGS = [{ isSummer: true, isWinter: false }, { isSummer: false, isWinter: true }]
  const SCENARIOS = [
    [{ label: 'Everyday', occasion: 'casual', count: 3 }, { label: 'City Outing', occasion: 'city', count: 2 }],
    [{ label: 'Everyday', occasion: 'casual', count: 3 }, { label: 'Brunch Gallery', occasion: 'smart casual', count: 3 }, { label: 'Restaurant Dinner', occasion: 'evening', register: 'dressy', environment: 'indoor', count: 2 }],
    [{ label: 'Outdoor Market', occasion: 'outdoor_daytime_social', count: 2 }, { label: 'Gallery Visit', occasion: 'city', count: 2 }, { label: 'Restaurant Dinner', occasion: 'evening', environment: 'indoor', count: 1 }],
  ]

  const gaps = []
  for (const { isSummer, isWinter } of SEASON_FLAGS) {
    for (const rawSlots of SCENARIOS) {
      for (const budget of BUDGETS) {
        const slots = normalizePlanSlots(rawSlots)
        const roster = selectCapsuleRoster(pool, { budget, isSummer, isWinter, occasions: slots.map(slot => slot.occasion), slots })
        const { bench } = buildCapsuleBench(pool, { budget, slots, isSummer, isWinter })
        const benchIds = new Set(bench.map(piece => Number(piece.id)))
        const missing = roster.filter(piece => !benchIds.has(Number(piece.id)))
        if (missing.length) gaps.push({ isSummer, isWinter, budget, missing: missing.map(piece => piece.name) })
      }
    }
  }
  assert.deepEqual(gaps, [], `every roster piece must be in the bench across the full matrix, got gaps: ${JSON.stringify(gaps)}`)
})

// Pins the exact case the review measured: at budget 24 the deterministic
// roster reserves elevated shoes and a dress for the mixed-register capsule's
// dinner/gallery slots that a rank-only bench dropped entirely.
test('buildCapsuleBench includes an elevated shoe and the roster dress for summer mixed_register at budget 24', () => {
  db.prepare('DELETE FROM pieces').run()
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
  const cap = capsuleTotalOutfitCap(24)
  const slots = normalizePlanSlots([
    { label: 'Smart Casual Brunch', occasion: 'smart casual', count: 2, weather: 'warm' },
    { label: 'Beach Day', occasion: 'casual', count: 1, weather: 'warm' },
    { label: 'Everyday City Outing', occasion: 'city', activity: 'walking', count: 3, weather: 'warm' },
    { label: 'Gallery Visit', occasion: 'gallery / art event', count: 1, weather: 'warm' },
    { label: 'Casual Dinner', occasion: 'casual', count: 2, weather: 'warm' },
    { label: 'Outdoor Market', occasion: 'outdoor_daytime_social', activity: 'walking', count: 2, weather: 'warm' },
  ], { fallbackWeather: 'warm', maxSlots: cap, maxTotalOutfits: cap })
  const roster = selectCapsuleRoster(pool, { budget: 24, isSummer: true, occasions: slots.map(slot => slot.occasion), slots })
  const rosterDress = roster.find(piece => wardrobeCategoryGroup(piece) === 'dress')
  assert.ok(rosterDress, 'sanity: the deterministic roster should include a dress')

  const { bench } = buildCapsuleBench(pool, { budget: 24, slots, isSummer: true })
  const benchIds = new Set(bench.map(piece => Number(piece.id)))
  const benchElevatedShoes = bench.filter(piece => wardrobeCategoryGroup(piece) === 'shoes' && piece.formality === 'elevated')

  assert.ok(benchElevatedShoes.length >= 1, `bench must carry at least one elevated shoe, got ${bench.filter(piece => wardrobeCategoryGroup(piece) === 'shoes').map(piece => `${piece.name}:${piece.formality}`)}`)
  assert.ok(benchIds.has(Number(rosterDress.id)), `bench must include the roster's dress (${rosterDress.name})`)
})

test('buildCapsuleBench: guarantees still win over benchSize when the seed alone exceeds it', () => {
  db.prepare('DELETE FROM pieces').run()
  for (let i = 0; i < 8; i += 1) insertPiece({ category: 'top', name: `top ${i}`, colors: ['black'], pattern_type: 'solid', occasions: ['casual', 'city'], formality: 'everyday' })
  for (let i = 0; i < 6; i += 1) insertPiece({ category: 'bottom', name: `bottom ${i}`, colors: ['black'], pattern_type: 'solid', occasions: ['casual', 'city'], formality: 'everyday' })
  for (let i = 0; i < 4; i += 1) insertPiece({ category: 'shoes', name: `shoe ${i}`, colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })
  insertPiece({ category: 'dress', name: 'day dress', colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })

  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  const roster = selectCapsuleRoster(pool, { budget: 24, occasions: slots.map(slot => slot.occasion), slots })
  const { bench, diagnostics } = buildCapsuleBench(pool, { budget: 24, slots, benchSize: 10 })
  const benchIds = new Set(bench.map(piece => Number(piece.id)))

  assert.ok(roster.length > 10, `sanity: the seed itself must already exceed benchSize, got roster of ${roster.length}`)
  assert.ok(roster.every(piece => benchIds.has(Number(piece.id))), 'every seeded roster piece must survive into the bench even past benchSize')
  assert.equal(diagnostics.seedSize, roster.length)
  assert.ok(diagnostics.exceededTarget)
  assert.equal(diagnostics.targetBenchSize, 10)
})

test("validateCapsuleRoster accepts today's deterministic roster for a representative capsule scenario", () => {
  db.prepare('DELETE FROM pieces').run()
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
  // plannedCards mirrors what the real pipeline computes downstream of
  // selectCapsuleRoster (routes/ai.js: allocateCapsuleRepresentativeRotation
  // with cap: capsuleTotalOutfitCap(pieceBudget)) — the number of cards the
  // rotation will actually request for THIS roster, not the aspirational cap.
  const allocated = allocateCapsuleRepresentativeRotation(slots, roster, { cap: capsuleTotalOutfitCap(10) })
  const plannedCards = allocated.reduce((sum, slot) => sum + (slot.targetOutfits || 0), 0)

  const result = validateCapsuleRoster(roster, { slots, budget: 10, isSummer: true, plannedCards, pool })
  assert.deepEqual(result.failures, [], `today's roster must validate clean, got ${JSON.stringify(result.failures)}`)
  assert.ok(result.ok)
})

test('validateCapsuleRoster produces a specific, repairable failure for each documented code', () => {
  // budget_exceeded: too many pieces, and a piece outside the supplied pool.
  {
    const pieceA = { id: 1, name: 'top A', category: 'top', formality: 'everyday', status: 'active' }
    const pieceB = { id: 2, name: 'top B', category: 'top', formality: 'everyday', status: 'active' }
    const outsider = { id: 99, name: 'outsider top', category: 'top', formality: 'everyday', status: 'active' }
    const result = validateCapsuleRoster([pieceA, pieceB, outsider], { budget: 2, pool: [pieceA, pieceB] })
    assert.ok(result.failures.some(failure => failure.code === 'budget_exceeded' && /budget is 2/.test(failure.message)))
    assert.ok(result.failures.some(failure => failure.code === 'budget_exceeded' && /not in the supplied pool/.test(failure.message)))
  }

  // slot_uncoverable: the wardrobe has no shoes at all.
  {
    db.prepare('DELETE FROM pieces').run()
    insertPiece({ category: 'top', name: 'casual top', colors: ['black'], occasions: ['casual'], formality: 'everyday' })
    insertPiece({ category: 'bottom', name: 'casual bottom', colors: ['black'], occasions: ['casual'], formality: 'everyday' })
    const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
    const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 1 }])
    const result = validateCapsuleRoster(pool, { slots, budget: 10 })
    const failure = result.failures.find(entry => entry.code === 'slot_uncoverable')
    assert.ok(failure, `expected slot_uncoverable, got ${JSON.stringify(result.failures)}`)
    assert.match(failure.message, /0 eligible shoe/)
  }

  // capacity_below_rotation: one distinct core, two cards planned.
  {
    db.prepare('DELETE FROM pieces').run()
    insertPiece({ category: 'top', name: 'only top', colors: ['black'], occasions: ['casual'], formality: 'everyday' })
    insertPiece({ category: 'bottom', name: 'only bottom', colors: ['black'], occasions: ['casual'], formality: 'everyday' })
    insertPiece({ category: 'shoes', name: 'only shoe', colors: ['black'], occasions: ['casual'], formality: 'everyday' })
    const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
    const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
    const result = validateCapsuleRoster(pool, { slots, budget: 10, plannedCards: 2 })
    const failure = result.failures.find(entry => entry.code === 'capacity_below_rotation')
    assert.ok(failure, `expected capacity_below_rotation, got ${JSON.stringify(result.failures)}`)
    assert.match(failure.message, /capacity is 1/)
  }

  // category_floor: the only top is too formal to clear the casual ceiling.
  {
    db.prepare('DELETE FROM pieces').run()
    insertPiece({ category: 'top', name: 'dressy top', colors: ['black'], occasions: ['casual'], formality: 'dressy' })
    insertPiece({ category: 'bottom', name: 'casual bottom', colors: ['black'], occasions: ['casual'], formality: 'everyday' })
    insertPiece({ category: 'shoes', name: 'casual shoe', colors: ['black'], occasions: ['casual'], formality: 'everyday' })
    const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
    const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 3 }])
    const result = validateCapsuleRoster(pool, { slots, budget: 10 })
    const failure = result.failures.find(entry => entry.code === 'category_floor')
    assert.ok(failure, `expected category_floor, got ${JSON.stringify(result.failures)}`)
    assert.match(failure.message, /0 top/)
  }

  // winter_layer_role_missing: an indoor cardigan but no transition coat/jacket.
  {
    db.prepare('DELETE FROM pieces').run()
    insertPiece({ category: 'top', name: 'top', colors: ['black'], occasions: ['casual'], formality: 'everyday' })
    insertPiece({ category: 'bottom', name: 'bottom', colors: ['black'], occasions: ['casual'], formality: 'everyday' })
    insertPiece({ category: 'shoes', name: 'shoe', colors: ['black'], occasions: ['casual'], formality: 'everyday' })
    insertPiece({ category: 'outerwear', name: 'knit cardigan', colors: ['charcoal'], occasions: ['casual'], formality: 'everyday', fabric_category: 'knit', fabric_weight: 'medium' })
    const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
    const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 1 }])
    const result = validateCapsuleRoster(pool, { slots, budget: 12, isWinterCapsule: true })
    const failure = result.failures.find(entry => entry.code === 'winter_layer_role_missing')
    assert.ok(failure, `expected winter_layer_role_missing, got ${JSON.stringify(result.failures)}`)
    assert.match(failure.message, /cold-transition/)
  }

  // register_shoe_path_missing: casual + evening slots, but only elevated shoes.
  {
    db.prepare('DELETE FROM pieces').run()
    insertPiece({ category: 'top', name: 'top', colors: ['black'], occasions: ['casual', 'evening'], formality: 'elevated' })
    insertPiece({ category: 'bottom', name: 'bottom', colors: ['black'], occasions: ['casual', 'evening'], formality: 'elevated' })
    insertPiece({ category: 'shoes', name: 'elevated shoe', colors: ['black'], occasions: ['casual', 'evening'], formality: 'elevated' })
    const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
    const slots = normalizePlanSlots([
      { label: 'Everyday', occasion: 'casual', count: 1 },
      { label: 'Restaurant Dinner', occasion: 'evening', count: 1 },
    ])
    const result = validateCapsuleRoster(pool, { slots, budget: 10 })
    const failure = result.failures.find(entry => entry.code === 'register_shoe_path_missing')
    assert.ok(failure, `expected register_shoe_path_missing, got ${JSON.stringify(result.failures)}`)
    assert.match(failure.message, /everyday\/casual/)
  }
})

// Stage 3 hands roster choice to a model and validateCapsuleRoster becomes the
// ONLY guard, so any guarantee selectCapsuleRoster enforces that the validator
// does not know about is a guarantee that silently stops existing. Three were
// missing when this was written: statement_presence, base_for_dependent_top and
// winter_covered_bases. Both now read the same declarations, so they cannot drift.
// Spec §7 path 1: a palette stated in the request was being dropped entirely,
// because roster selection reads structured columns and never the request text.
// The vocabulary comes from the wardrobe's own stored colours, so it is
// per-user rather than a hard-coded list.
test('a palette stated in the request is read from the wardrobe\'s own colour vocabulary', () => {
  const pool = [
    { id: 1, category: 'top', colors: ['black'] },
    { id: 2, category: 'bottom', colors: ['cream'] },
    { id: 3, category: 'shoes', colors: ['olive'] },
    { id: 4, category: 'top', colors: ['fuchsia'] },
  ]
  assert.deepEqual(extractStatedPalette('summer capsule, keep it to black cream and olive', pool).colors, ['black', 'cream', 'olive'])
  assert.deepEqual(extractStatedPalette('I want a summer capsule', pool).colors, [], 'saying nothing is not a palette')
  // "neutrals" names a set; expand it against what this person actually owns.
  const neutrals = extractStatedPalette('a summer capsule in neutrals', pool).colors
  assert.ok(neutrals.includes('black') && neutrals.includes('cream'))
  assert.ok(!neutrals.includes('fuchsia'))
  // A colour the wardrobe does not have is not invented.
  assert.deepEqual(extractStatedPalette('a capsule in turquoise', pool).colors, [])
})

// Owner request 2026-07-29: there must be a way to skip palette choosing.
// "said nothing" and "explicitly wants no constraint" have to stay
// distinguishable — otherwise a stored palette preference would apply to every
// future capsule with no way to turn it off for one request.
test('a person can explicitly opt out of palette choosing', () => {
  const pool = [{ id: 1, category: 'top', colors: ['black'] }]
  for (const phrase of [
    'a summer capsule, any colour is fine',
    'summer capsule with no palette',
    'build a capsule and ignore my palette',
    'a capsule in any color please',
  ]) {
    const result = extractStatedPalette(phrase, pool)
    assert.equal(result.optOut, true, `expected opt-out for: ${phrase}`)
    assert.deepEqual(result.colors, [])
  }
  // Unstated is NOT an opt-out — the two states must not collapse.
  assert.equal(extractStatedPalette('I want a summer capsule', pool).optOut, false)
  // A colour word is not an opt-out just because "any" appears near it.
  assert.equal(extractStatedPalette('any black top works', pool).optOut, false)
})

// The §7 constraint, and this project's own gate history: a hard filter on a
// taste dimension starves capacity (the `home` gate ruling). A palette biases
// the ranking; it never excludes, and structural coverage still wins.
test('a stated palette is a preference, not a filter', () => {
  const palettePieces = []
  for (let i = 0; i < 4; i += 1) {
    palettePieces.push({ id: 10 + i, name: `black top ${i}`, category: 'top', colors: ['black'], formality: 'everyday', occasions: ['casual', 'city'] })
    palettePieces.push({ id: 20 + i, name: `black bottom ${i}`, category: 'bottom', colors: ['black'], formality: 'everyday', occasions: ['casual', 'city'] })
  }
  // The only shoes in the wardrobe are outside the requested palette.
  const offPalette = [
    { id: 90, name: 'rust sneakers', category: 'shoes', colors: ['rust'], formality: 'everyday', occasions: ['casual', 'city'] },
    { id: 91, name: 'rust boots', category: 'shoes', colors: ['rust'], formality: 'everyday', occasions: ['casual', 'city'] },
  ]
  const pool = [...palettePieces, ...offPalette]
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  const roster = selectCapsuleRoster(pool, { budget: 10, isSummer: true, occasions: ['casual'], slots, palette: ['black'] })

  assert.ok(
    roster.some(piece => wardrobeCategoryGroup(piece) === 'shoes'),
    'a palette must not starve a category the capsule structurally needs'
  )
  assert.ok(roster.filter(piece => (piece.colors || []).includes('black')).length >= 4, 'the palette still shapes the roster')
})

// Spec §3 stage 2. The whole point of injecting `chooseRoster` is that the
// contract is provable with no provider: one bounded call, ONE repair given the
// specific failures, then the deterministic roster. Never a third attempt.
function paletteTestWardrobe() {
  const pool = []
  for (let i = 0; i < 6; i += 1) {
    pool.push({ id: 100 + i, name: `top ${i}`, category: 'top', colors: ['black'], formality: 'everyday', occasions: ['casual', 'city'], pattern_complexity: i === 0 ? 'loud' : 'quiet' })
    pool.push({ id: 200 + i, name: `bottom ${i}`, category: 'bottom', colors: ['black'], formality: 'everyday', occasions: ['casual', 'city'] })
  }
  for (let i = 0; i < 3; i += 1) {
    pool.push({ id: 300 + i, name: `shoe ${i}`, category: 'shoes', colors: ['black'], formality: 'everyday', occasions: ['casual', 'city'] })
  }
  return pool
}

test('a model-chosen capsule roster is accepted when it satisfies the guarantees', async () => {
  const pool = paletteTestWardrobe()
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  let calls = 0
  const result = await selectCapsuleRosterViaModel({
    pool, budget: 10, slots, isSummer: true, occasions: ['casual'],
    chooseRoster: async ({ bench }) => {
      calls += 1
      return { roster_piece_ids: bench.slice(0, 10).map(piece => Number(piece.id)), palette: 'black', piece_jobs: [] }
    }
  })

  assert.equal(calls, 1, 'a valid roster costs exactly one call')
  assert.equal(result.source, 'model')
  assert.equal(result.roster.length, 10)
  assert.equal(result.palette, 'black')
})

test('an invalid model roster gets exactly one repair attempt, then the deterministic roster', async () => {
  const pool = paletteTestWardrobe()
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  const attempts = []
  const result = await selectCapsuleRosterViaModel({
    pool, budget: 10, slots, isSummer: true, occasions: ['casual'],
    // Always returns a roster of tops only: no bottoms, no shoes.
    chooseRoster: async ({ bench, attempt, failures }) => {
      attempts.push({ attempt, failureCodes: failures.map(entry => entry.code) })
      const tops = bench.filter(piece => piece.category === 'top').map(piece => Number(piece.id))
      return { roster_piece_ids: tops.slice(0, 10), palette: '', piece_jobs: [] }
    }
  })

  assert.equal(attempts.length, 2, 'one call plus one repair — never a third')
  assert.equal(attempts[0].attempt, 1)
  assert.ok(attempts[1].failureCodes.length, 'the repair round is told exactly what failed')
  assert.equal(result.source, 'deterministic_fallback')
  assert.ok(result.roster.length > 0, 'a fallback capsule still ships')
  assert.ok(result.roster.some(piece => wardrobeCategoryGroup(piece) === 'shoes'), 'and it is structurally sound')
})

test('a model roster reaching outside the candidate list is a contract failure, not silently clamped', async () => {
  const pool = paletteTestWardrobe()
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  const seen = []
  await selectCapsuleRosterViaModel({
    pool, budget: 10, slots, isSummer: true, occasions: ['casual'],
    chooseRoster: async ({ bench, attempt, failures }) => {
      seen.push(failures.map(entry => entry.code))
      // 999999 is in no wardrobe; clamping it away would hide the mistake the
      // repair round exists to correct.
      return { roster_piece_ids: [999999, ...bench.slice(0, 9).map(piece => Number(piece.id))], palette: '', piece_jobs: [] }
    }
  })

  assert.deepEqual(seen[0], [], 'the first attempt is not told about failures that have not happened yet')
  assert.ok(seen[1].includes('piece_outside_bench'), `expected a bench-membership failure, got ${JSON.stringify(seen[1])}`)
})

test('capsule roster selection stays deterministic when no model chooser is wired', async () => {
  const pool = paletteTestWardrobe()
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  const result = await selectCapsuleRosterViaModel({ pool, budget: 10, slots, isSummer: true, occasions: ['casual'] })

  assert.equal(result.source, 'deterministic', 'the flag being off must change nothing')
  assert.deepEqual(
    result.roster.map(piece => Number(piece.id)).sort(),
    selectCapsuleRoster(pool, { budget: 10, isSummer: true, occasions: ['casual'], slots }).map(piece => Number(piece.id)).sort()
  )
})

test('the validator checks every guarantee the selector enforces', () => {
  const conditionCodes = capsuleRosterPostConditions({
    quotas: { top: 5, bottom: 4, dress: 1, outerwear: 2, shoes: 3 },
    reserve: { rank: formalityRank('everyday'), looks: 3, byGroup: { top: 2 } },
    isWinter: true,
    shoeDemands: [{ label: 'an everyday/casual look', required: 1, predicate: () => true }],
    roster: [{ id: 1, category: 'top', needs_base: 'yes' }],
  }).map(condition => condition.code)

  for (const expected of ['statement_presence', 'base_for_dependent_top', 'winter_covered_bases', 'winter_indoor_layer', 'winter_transition_layer']) {
    assert.ok(conditionCodes.includes(expected), `${expected} must be a declared guarantee`)
  }

  // A model roster that ignores a guarantee is rejected with a repairable code.
  const plainTop = { id: 1, name: 'tee', category: 'top', formality: 'everyday' }
  const bottom = { id: 2, name: 'jeans', category: 'bottom', formality: 'everyday' }
  const shoe = { id: 3, name: 'sneakers', category: 'shoes', formality: 'everyday' }
  const loudTop = { id: 4, name: 'bold print top', category: 'top', formality: 'everyday', pattern_complexity: 'loud' }
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  const quiet = validateCapsuleRoster([plainTop, bottom, shoe], {
    slots, budget: 24, pool: [plainTop, bottom, shoe, loudTop]
  })
  assert.ok(
    quiet.failures.some(failure => failure.code === 'statement_presence'),
    `a statement piece was available and unpicked, got ${JSON.stringify(quiet.failures)}`
  )

  // ...but the same roster passes when the wardrobe has no statement piece to
  // offer. A supply gap is not a roster defect, and a validator that invents
  // failures is worse than one that misses them.
  const noneAvailable = validateCapsuleRoster([plainTop, bottom, shoe], {
    slots, budget: 24, pool: [plainTop, bottom, shoe]
  })
  assert.ok(!noneAvailable.failures.some(failure => failure.code === 'statement_presence'))
})

// The ratified ordering rule: if the validator fails on today's deterministic
// roster, the validator is wrong, not the roster. selectCapsuleRoster records
// the guarantees it could not meet on the roster it returns, and the validator
// trusts that record rather than re-accusing it — evidence computed with the
// real pool beats any heuristic here.
test('a guarantee the pipeline already disclosed is not re-reported as a roster defect', () => {
  const top = { id: 1, name: 'tee', category: 'top', formality: 'everyday' }
  const bottom = { id: 2, name: 'jeans', category: 'bottom', formality: 'everyday' }
  const shoe = { id: 3, name: 'sneakers', category: 'shoes', formality: 'everyday' }
  const loudTop = { id: 4, name: 'bold print top', category: 'top', formality: 'everyday', pattern_complexity: 'loud' }
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  const roster = [top, bottom, shoe]
  roster.postConditionGaps = ['statement_presence']

  const result = validateCapsuleRoster(roster, { slots, budget: 24, pool: [top, bottom, shoe, loudTop] })
  assert.ok(!result.failures.some(failure => failure.code === 'statement_presence'))
})

test('validateCapsuleRoster does not reject a roster for colour or aesthetic reasons', () => {
  db.prepare('DELETE FROM pieces').run()
  // A deliberately uncoordinated palette (clashing, no shared neutral) with
  // otherwise ample structural capacity — validateCapsuleRoster's job is
  // capacity, never taste (docs/stylist-session-handoff.md, the `home`-gate
  // lifestyle-audit ruling: a hard filter on a taste dimension starves the
  // roster, so it stays the model's job per the capsule-roster-selection spec).
  const clashingColors = ['fuchsia', 'chartreuse', 'orange', 'turquoise', 'magenta', 'yellow']
  for (let i = 0; i < 4; i += 1) {
    insertPiece({ category: 'top', name: `clashing top ${i}`, colors: [clashingColors[i]], pattern_type: 'floral', occasions: ['casual', 'city'], formality: 'everyday' })
    insertPiece({ category: 'bottom', name: `clashing bottom ${i}`, colors: [clashingColors[(i + 2) % clashingColors.length]], pattern_type: 'geometric', occasions: ['casual', 'city'], formality: 'everyday' })
  }
  for (let i = 0; i < 3; i += 1) {
    insertPiece({ category: 'shoes', name: `clashing shoe ${i}`, colors: [clashingColors[(i + 4) % clashingColors.length]], occasions: ['casual', 'city'], formality: 'everyday' })
  }
  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  const roster = pool
  const result = validateCapsuleRoster(roster, { slots, budget: pool.length })

  assert.ok(result.ok, `a clashing but structurally sound roster must pass, got ${JSON.stringify(result.failures)}`)
  const anyColorLanguage = JSON.stringify(result)
  for (const color of clashingColors) assert.ok(!anyColorLanguage.toLowerCase().includes(color), `validator output must not mention taste/color, got: ${color} in ${anyColorLanguage}`)
})

// Live repro, winter/casual budget 10 on the real 243-piece wardrobe: the
// register reserve reached 2 register-compliant tops and the roster ended with
// 1, because ensureWinterIndoorTopBalance swaps on sleeve coverage alone and
// knows nothing about register. Two of the final three tops were then
// unwearable in the very slots that asked for them. Each reserve pass states a
// guarantee and then hands the roster to a pass free to undo it; these tests
// pin the end-of-selection check that makes the guarantees hold jointly.
test('the post-condition check repairs a guarantee a later pass undid', () => {
  const mk = (id, name, formality, sleeve) => ({ id, name, category: 'top', formality, sleeve_type: sleeve, season: 'year-round' })
  const elevatedA = mk(1, 'elevated long blouse A', 'elevated', 'long')
  const elevatedB = mk(2, 'elevated long blouse B', 'elevated', 'long')
  const sleeveless = mk(3, 'everyday sleeveless shell', 'everyday', 'sleeveless')
  const everydayKnit = mk(4, 'everyday long knit', 'everyday', 'long')
  // What the roster looks like after the coverage pass has traded a compliant
  // top away for sleeve coverage: 2 covered bases, but only 1 everyday piece.
  const roster = [elevatedA, elevatedB, sleeveless]
  const groups = { top: [elevatedA, elevatedB, sleeveless, everydayKnit] }
  const scoreOf = new Map([[elevatedA, 40], [elevatedB, 39], [sleeveless, 28], [everydayKnit, 8]])
  const conditions = capsuleRosterPostConditions({
    quotas: { top: 3 },
    reserve: { rank: formalityRank('everyday'), looks: 3, byGroup: { top: 2 } },
    isWinter: true
  })

  const { roster: repaired, unsatisfied } = enforceCapsulePostConditions(roster, groups, conditions, scoreOf, new Set())
  const everyday = repaired.filter(piece => ['lounge', 'everyday'].includes(String(pieceFormality(piece))))
  const covered = repaired.filter(piece => ['short', 'long'].includes(String(piece.sleeve_type)))

  assert.equal(unsatisfied.length, 0, `both guarantees are satisfiable here, got ${JSON.stringify(unsatisfied)}`)
  assert.ok(everyday.length >= 2, `register reserve must be restored, got ${everyday.length}: ${repaired.map(p => p.name).join(', ')}`)
  assert.ok(covered.length >= 2, `sleeve coverage must survive the repair, got ${covered.length}: ${repaired.map(p => p.name).join(', ')}`)
  assert.ok(
    repaired.includes(everydayKnit),
    'the repair should reach for the garment satisfying BOTH rules, not merely the highest-scoring compliant one'
  )
  assert.equal(repaired.length, roster.length, 'a repair swaps, it never grows or shrinks the roster')
})

// Removing the neutral bonus from loud pieces was correct (a black/cream/burgundy
// geometric print is not a neutral) but over-shot: the live 24-piece summer roster
// came back with ZERO statement pieces, which the owner ruled is not a capsule
// either. Presence is a guarantee, not something to bribe the score into
// producing — and unlike a score nudge, a guarantee can't be traded away by a
// later pass. Cross-category by nature: the statement can be a top, bottom or dress.
test('a capsule of useful size guarantees a statement piece, swapping within its category', () => {
  const quietTop = { id: 1, name: 'quiet cream tee', category: 'top', formality: 'everyday', pattern_complexity: 'quiet' }
  const quietTopB = { id: 2, name: 'quiet navy tee', category: 'top', formality: 'everyday', pattern_complexity: 'quiet' }
  const loudTop = { id: 3, name: 'bold geometric top', category: 'top', formality: 'everyday', pattern_complexity: 'loud' }
  const quietBottom = { id: 4, name: 'black trouser', category: 'bottom', formality: 'everyday', pattern_complexity: 'quiet' }
  const roster = [quietTop, quietTopB, quietBottom]
  const groups = { top: [quietTop, quietTopB, loudTop], bottom: [quietBottom], dress: [], outerwear: [], shoes: [] }
  const conditions = capsuleRosterPostConditions({ quotas: { top: 5, bottom: 4, dress: 1 } })

  const { roster: withStatement, unsatisfied } = enforceCapsulePostConditions(
    roster, groups, conditions, new Map([[quietTop, 40], [quietTopB, 10], [loudTop, 5]]), new Set()
  )

  assert.equal(unsatisfied.length, 0)
  assert.ok(withStatement.includes(loudTop), 'a roster of all quiet basics is not a capsule')
  assert.equal(withStatement.filter(p => p.category === 'top').length, 2, 'the swap stays inside the category, so quotas are untouched')
  assert.ok(withStatement.includes(quietBottom), 'a cross-category guarantee must not raid another category')
})

test('a small capsule is not forced to spend a slot on a statement piece', () => {
  // Below a useful size every slot is load-bearing; the guarantee is not added
  // at all rather than being added and then reported as an unmeetable gap.
  const conditions = capsuleRosterPostConditions({ quotas: { top: 3, bottom: 3, dress: 1 } })
  assert.ok(!conditions.some(condition => condition.code === 'statement_presence'))
})

// Owner ruling 2026-07-28: "what we do in other flows is show the card with a
// disclaimer, do not throw it away, and fix locally on that card." The atomic
// capsule path was the only composing surface that deleted a rejected attempt
// and announced an absence instead — the live run lost two looks that way and
// the person never saw what had been tried.
test('a rejected capsule look survives as a needs-review card carrying its blocked piece', () => {
  const heels = { id: 199, name: 'burgundy cork wedges', category: 'shoes', formality: 'elevated' }
  const top = { id: 10, name: 'white tank', category: 'top', formality: 'everyday' }
  const bottom = { id: 20, name: 'linen shorts', category: 'bottom', formality: 'everyday' }
  const failures = [{
    slot_id: 'city_museum',
    label: 'City / Museum',
    reasons: ["piece 199 failed this slot's gates: activity profile: high heel unsuitable"],
    blockedPieceIds: [199],
    outfit: { title: 'Museum Day', pieces: [top, bottom, heels], pieceIds: [10, 20, 199] }
  }]
  const pendingPlan = { slots: [{ id: 'city_museum', label: 'City / Museum', bestFor: 'museums', occasion: 'city' }] }

  const [card] = buildRejectedCapsuleCards(failures, pendingPlan)

  assert.equal(card.broken, true, 'the attempt is shown, not deleted')
  assert.equal(card.tripSlot, 'city_museum', 'it renders in the slot it was meant for')
  assert.deepEqual(card.pieces.map(p => p.id), [10, 20, 199], 'the whole attempt is preserved')
  assert.deepEqual(card.brokenPieces.map(p => p.name), ['burgundy cork wedges'], 'only the blocked garment is flagged, not the whole outfit')
  assert.deepEqual(card.capsuleRepair, { slotId: 'city_museum', blockedPieceIds: [199] }, 'enough state to swap one garment without re-planning')
  assert.equal(card.title, 'Museum Day', "the model's own title survives")
})

// A needs-review card appended after every other slot reads as unrelated to the
// use case it belongs to — and it is the card the person is meant to act on.
// Live confabulation (thread_1785348988259): the closing model told the person a
// card was flagged because the formula "runs warm for summer evenings" and
// offered a lighter swap. It was flagged for having no shoes. The turn handed it
// the COUNT of held-back looks but never the REASON, so it invented one — the
// exact failure the final-answer guard exists to catch, arriving through a gap
// the guard cannot see.
test('a rejected capsule look carries a reason the closing turn can state truthfully', () => {
  const top = { id: 1, name: 'tee', category: 'top' }
  const bottom = { id: 2, name: 'jeans', category: 'bottom' }
  const slot = {
    id: 'dinner',
    label: 'Restaurants / Social Events',
    targetOutfits: 2,
    gateAllowedIds: new Set([1, 2, 3]),
    allowedPieces: [top, bottom],
  }
  const result = validateSubmittedPlanOutfits({
    slots: [slot],
    piecesById: new Map([[1, top], [2, bottom]]),
    constraints: { pieceBudget: 24 },
    isSeasonalCapsule: true,
    boundedComposition: true,
    heldOutfits: [],
  }, [{ slot_id: 'dinner', title: 'Shoeless attempt', piece_ids: [1, 2] }])

  const failure = result.failures.find(entry => entry.slot_id === 'dinner')
  assert.ok(failure, 'the rejection is reported')
  assert.match(failure.reasons.join(' '), /shoes/i, 'and it names the real cause, not a count')
  assert.ok(failure.outfit, 'with the attempt attached, so the reason can reach both the card and the closing prose')
})

test('a rejected capsule card is grouped with its own slot, not appended last', () => {
  const top = { id: 1, name: 'tee', category: 'top' }
  const bottom = { id: 2, name: 'jeans', category: 'bottom' }
  const shoe = { id: 3, name: 'sneakers', category: 'shoes' }
  const pendingPlan = {
    slots: [
      { id: 'home', label: 'At Home', bestFor: 'home', occasion: 'casual' },
      { id: 'dinner', label: 'Restaurant Dinner', bestFor: 'dinner', occasion: 'evening' },
      { id: 'walks', label: 'Nature Walks', bestFor: 'walks', occasion: 'casual' },
    ],
  }
  const [card] = buildRejectedCapsuleCards([{
    slot_id: 'dinner',
    label: 'Restaurant Dinner',
    reasons: ['missing shoes'],
    blockedPieceIds: [],
    outfit: { title: 'Dinner attempt', pieces: [top, bottom, shoe], pieceIds: [1, 2, 3] },
  }], pendingPlan)

  assert.equal(card.label, 'Restaurant Dinner')
  assert.equal(card.tripSlot, 'dinner', 'the card carries the slot it belongs to, so ordering by slot is possible')
})

test('a failure with no recoverable outfit produces no card rather than an empty one', () => {
  const cards = buildRejectedCapsuleCards(
    [{ slot_id: 'x', label: 'X', reasons: ['unknown slot_id'] }],
    { slots: [] }
  )
  assert.deepEqual(cards, [])
})

// Owner ruling 2026-07-28: a garment that cannot be worn alone costs two roster
// slots to make one look, so it may only take a place in a finite capsule when
// something it can go over is also there. Conditional by nature — the guarantee
// is added only when a dependent piece is actually present, so an unpopulated
// needs_base field changes nothing for any existing wardrobe.
test('a capsule carrying a layer-only top must also carry something to wear under it', () => {
  const dependent = { id: 1, name: 'crochet overlay top', category: 'top', formality: 'everyday', needs_base: 'yes' }
  const plainTop = { id: 2, name: 'cotton tee', category: 'top', formality: 'everyday' }
  const roster = [dependent]
  const conditions = capsuleRosterPostConditions({ quotas: { top: 2 }, roster })

  assert.ok(conditions.some(condition => condition.code === 'base_for_dependent_top'), 'a dependent piece adds the requirement')

  const { roster: settled, unsatisfied } = enforceCapsulePostConditions(
    roster, { top: [dependent, plainTop] }, conditions, new Map([[plainTop, 5]]), new Set()
  )
  assert.equal(unsatisfied.length, 0)
  assert.ok(settled.includes(plainTop), 'the base is brought into the roster')

  // Unset needs_base must be a strict no-op, or shipping the column would have
  // silently changed every existing wardrobe on the day it landed.
  const noneDependent = capsuleRosterPostConditions({ quotas: { top: 2 }, roster: [plainTop] })
  assert.ok(!noneDependent.some(condition => condition.code === 'base_for_dependent_top'))
})

// Owner ruling 2026-07-28: when the digitized wardrobe cannot sustain the capsule
// asked for, say so BEFORE composing. The live sandbox case — 23 pieces, five
// requested contexts, three distinct cores — produced a single card and read as
// broken. The constraint is what has been photographed, not what is owned.
test('a wardrobe too thin for the requested capsule is declined before composition', () => {
  const top = { id: 1, name: 'tee', category: 'top' }
  const bottom = { id: 2, name: 'jeans', category: 'bottom' }
  const shoe = { id: 3, name: 'sneakers', category: 'shoes' }
  const roster = [top, bottom, shoe]
  const thin = {
    capsuleRoster: roster,
    capsuleCapacity: 1,
    slots: [
      { label: 'At Home', capsuleSlotCapacity: 1, gateAllowedIds: new Set([1, 2, 3]) },
      { label: 'Errands', capsuleSlotCapacity: 0, gateAllowedIds: new Set([1, 2]) },
      { label: 'Dinner', capsuleSlotCapacity: 0, gateAllowedIds: new Set([3]) },
    ]
  }
  const gap = describeCapsuleSupplyGap(thin)

  assert.ok(gap, 'three contexts against one distinct core is not a capsule')
  assert.deepEqual(gap.covered, ['At Home'])
  assert.deepEqual(gap.uncovered.map(entry => entry.label), ['Errands', 'Dinner'])
  assert.ok(gap.uncovered[0].missing.includes('shoes'), 'name what to photograph next, in plain words')
  assert.ok(gap.uncovered[1].missing.includes('a top'))
  // A healthy plan must not trip this — it is a no-op for any real capsule.
  assert.equal(
    describeCapsuleSupplyGap({
      capsuleRoster: roster,
      capsuleCapacity: 40,
      slots: [{ label: 'At Home', capsuleSlotCapacity: 6, gateAllowedIds: new Set([1, 2, 3]) }]
    }),
    null
  )
})

test('the post-condition check leaves a satisfied roster untouched', () => {
  // This is what keeps every already-ratified selection byte-identical: no
  // violated condition means no swap, not a re-optimisation.
  const everydayKnit = { id: 1, name: 'everyday long knit', category: 'top', formality: 'everyday', sleeve_type: 'long' }
  const everydayTee = { id: 2, name: 'everyday short tee', category: 'top', formality: 'everyday', sleeve_type: 'short' }
  const spare = { id: 3, name: 'higher scoring everyday knit', category: 'top', formality: 'everyday', sleeve_type: 'long' }
  const roster = [everydayKnit, everydayTee]
  const conditions = capsuleRosterPostConditions({
    quotas: { top: 2 },
    reserve: { rank: formalityRank('everyday'), looks: 3, byGroup: { top: 2 } },
    isWinter: true
  })

  const { roster: settled, unsatisfied } = enforceCapsulePostConditions(
    roster, { top: [everydayKnit, everydayTee, spare] }, conditions, new Map([[spare, 99]]), new Set()
  )

  assert.deepEqual(settled, roster, 'a satisfied roster is returned unchanged')
  assert.equal(unsatisfied.length, 0)
})

test('an unmeetable capsule guarantee is reported, not silently dropped', () => {
  db.prepare('DELETE FROM pieces').run()
  // No everyday-ceiling top exists at all, so the register reserve cannot be
  // met by any selection. The roster must still be returned (a partial capsule
  // beats none) with the failure observable rather than swallowed.
  for (let i = 0; i < 4; i += 1) {
    insertPiece({ category: 'top', name: `dressy blouse ${i}`, colors: ['navy'], formality: 'dressy', occasions: ['evening', 'smart casual'] })
    insertPiece({ category: 'bottom', name: `everyday trouser ${i}`, colors: ['black'], formality: 'everyday', occasions: ['casual', 'city'] })
    insertPiece({ category: 'shoes', name: `everyday boot ${i}`, colors: ['black'], formality: 'everyday', occasions: ['casual', 'city'] })
  }
  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 3 }])
  const roster = selectCapsuleRoster(pool, {
    budget: 10, isSummer: true, occasions: slots.map(slot => slot.occasion), slots
  })

  assert.ok(roster.length > 0, 'an unmeetable guarantee must not empty the roster')
  assert.ok(
    Array.isArray(roster.postConditionGaps) && roster.postConditionGaps.some(code => code.startsWith('register_reserve')),
    `the unmeetable guarantee should be reported, got ${JSON.stringify(roster.postConditionGaps)}`
  )
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
  const cap = capsuleTotalOutfitCap(24)
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

  assert.equal(cap, 12)
  assert.equal(slots.reduce((sum, slot) => sum + slot.targetOutfits, 0), 12)
  assert.ok(slots.some(slot => slot.requestedOutfits), `24-piece capsule should trim its representative rotation to 12 cards, got ${JSON.stringify(slots)}`)
})

test('capsule display cap is min(piece budget, 12)', () => {
  assert.equal(capsuleTotalOutfitCap(10), 10)
  assert.equal(capsuleTotalOutfitCap(14), 12)
  assert.equal(capsuleTotalOutfitCap(24), 12)
  assert.equal(capsuleTotalOutfitCap(0), PLAN_TOTAL_OUTFIT_CAP)
})

// The capsule redesign briefly collapsed this function into min(budget, 12) and
// made every non-capsule plan pass 0, which pinned a 30-piece trip at 8 looks.
// A trip's axis is days, so its cap still rises with the packing budget.
test('non-capsule plans keep the day-shaped budget curve', () => {
  assert.equal(planTotalOutfitCapForBudget(0), PLAN_TOTAL_OUTFIT_CAP)
  assert.equal(planTotalOutfitCapForBudget(12), PLAN_TOTAL_OUTFIT_CAP)
  assert.equal(planTotalOutfitCapForBudget(18), 12)
  assert.equal(planTotalOutfitCapForBudget(24), 16)
  assert.equal(planTotalOutfitCapForBudget(30), 20)
  assert.notEqual(
    planTotalOutfitCapForBudget(24),
    capsuleTotalOutfitCap(24),
    'a 24-piece trip and a 24-piece capsule must not share one cap — different plan shapes, different axes'
  )
})

test('capsule capacity counts distinct gate-valid cores, not displayed cards', () => {
  const roster = [
    { id: 1, category: 'top' },
    { id: 2, category: 'top' },
    { id: 3, category: 'bottom' },
    { id: 4, category: 'bottom' },
    { id: 5, category: 'dress' },
    { id: 6, category: 'shoes' },
  ]
  const slots = [
    { gateAllowedIds: new Set([1, 2, 3, 4, 5, 6]) },
    { gateAllowedIds: new Set([1, 3, 6]) },
  ]

  assert.equal(capsuleOutfitCoreCapacity(roster, slots), 5, 'four separates cores plus one dress; repeated compatibility in another slot is not double-counted')
  assert.ok(capsuleOutfitCoreCapacity(roster, slots) > 2, 'capacity is independent of how many representative cards are shown')
})

test('capsule rotation allocates coverage before recurring multiplicity and respects slot capacity', () => {
  const roster = [
    { id: 1, category: 'top' },
    { id: 2, category: 'top' },
    { id: 3, category: 'bottom' },
    { id: 4, category: 'bottom' },
    { id: 5, category: 'dress' },
    { id: 6, category: 'shoes' },
  ]
  const slots = [
    { id: 'everyday', targetOutfits: 3, gateAllowedIds: new Set([1, 2, 3, 4, 5, 6]) },
    { id: 'evening', targetOutfits: 3, gateAllowedIds: new Set([1, 3, 6]) },
    { id: 'gallery', targetOutfits: 2, gateAllowedIds: new Set([2, 4, 6]) },
  ]
  const allocated = allocateCapsuleRepresentativeRotation(slots, roster, { cap: 5 })

  assert.deepEqual(allocated.map(slot => slot.targetOutfits), [3, 1, 1])
  assert.deepEqual(allocated.map(slot => slot.capsuleSlotCapacity), [5, 1, 1])
  assert.equal(allocated.reduce((sum, slot) => sum + slot.targetOutfits, 0), 5)
})

// Live shape: "At Home" and "Errands / Weekends" resolve to the identical gate
// result, so each reported the full shared core count and allocation asked for
// both. validateSubmittedPlanOutfits enforces distinct cores across the whole
// plan, and the atomic composer has no retry — so every over-asked card became
// a silent missing look. Allocation must ask only for what the roster can
// distinctly fill.
test('capsule rotation never requests more looks than the roster has distinct cores', () => {
  const roster = [
    { id: 1, category: 'top' },
    { id: 2, category: 'bottom' },
    { id: 3, category: 'bottom' },
    { id: 4, category: 'shoes' },
  ]
  const sharedGate = new Set([1, 2, 3, 4])
  const slots = [
    { id: 'at_home', targetOutfits: 3, gateAllowedIds: sharedGate },
    { id: 'errands', targetOutfits: 3, gateAllowedIds: sharedGate },
  ]
  const globalCapacity = capsuleOutfitCoreCapacity(roster, slots)
  const allocated = allocateCapsuleRepresentativeRotation(slots, roster, { cap: 12 })
  const requested = allocated.reduce((sum, slot) => sum + slot.targetOutfits, 0)

  assert.equal(globalCapacity, 2, 'one top against two bottoms is two distinct cores, shared by both slots')
  assert.equal(requested, globalCapacity, `allocation asked for ${requested} looks against ${globalCapacity} distinct cores`)
  assert.deepEqual(allocated.map(slot => slot.targetOutfits), [1, 1], 'coverage first, then nothing left to buy')
  assert.deepEqual(
    allocated.map(slot => slot.capsuleSlotCapacity),
    [1, 1],
    'a slot retired for global infeasibility reports no unused core, so no billed "show another" is offered'
  )
})

test('capsule rotation assigns zero cards to an impossible slot so it can be disclosed as a gap', () => {
  const roster = [
    { id: 1, category: 'top' },
    { id: 2, category: 'bottom' },
    { id: 3, category: 'shoes' },
  ]
  const allocated = allocateCapsuleRepresentativeRotation([
    { id: 'casual', targetOutfits: 2, gateAllowedIds: new Set([1, 2, 3]) },
    { id: 'evening', targetOutfits: 1, gateAllowedIds: new Set([1, 3]) },
  ], roster, { cap: 3 })

  assert.deepEqual(allocated.map(slot => slot.targetOutfits), [1, 0])
})
