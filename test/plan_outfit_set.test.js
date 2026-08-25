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
const { STYLIST_TOOLS, executeTool, sanitizePlanConstraintsForQuestion, resolvePlanKind, DEFAULT_SEASONAL_CAPSULE_BUDGET, coercePlanOutfitSetSlotsArg, coerceSubmitPlanOutfitsArg, CAPSULE_PLAN_EVIDENCE_BOUNDARY } = await import('../styling-engine/tools.js')
const { normalizePlanSlots, normalizePlanConstraints, selectCapsuleRoster, buildCapsuleBench, validateCapsuleRoster, capsuleOutfitCoreCapacity, allocateCapsuleRepresentativeRotation, describeCapsuleCompositionShortfall, describeCapsulePaletteCohesion, describeCapsuleRosterUtilization, buildRejectedCapsuleCards, describeCapsuleSupplyGap, extractStatedPalette, selectCapsuleRosterViaModel, capsuleNeutralBasePlan, capsuleNeutralBaseCount, capsuleRosterPostConditions, enforceCapsulePostConditions, buildPlanSlotWorkbench, validateSubmittedPlanOutfits, completeSubmittedPlanOutfits, assembleSubmittedPlanOutfits, describeOutfitStructureGap, mergePendingPlanForReplan, PLAN_TOTAL_OUTFIT_CAP, planTotalOutfitCapForBudget, capsuleTotalOutfitCap, reasonRevisesMidSentence, slotRequiresActiveMovement, slotRequiresOperationalEase, extremeHeatPieceAdvisory, activeMovementPieceAdvisory, operationalEasePieceAdvisory } = await import('../styling-engine/outfitSetPlanner.js')
const { _clearWeatherCachesForTests } = await import('../styling-engine/weather.js')
const { parsePiece, weatherProfileFromContext, hasRejectedReference } = await import('../styling-engine/rules.js')
const { wardrobeCategoryGroup, pieceFormality, formalityRank } = await import('../styling-engine/attributes.js')
const { resolveOccasionProfile } = await import('../styling-engine/occasions.js')
const { replayStylistToolScript, stylistToolsForTurn } = await import('../styling-engine/provider.js')
const { describeCapsuleUndemonstratedJobs, capsuleConditionMatches, describeCapsuleAutoCompletions } = await import('../styling-engine/outfitSetPlanner.js')
const { capsulePlanQuestion, capsulePlanCompositionSchema, capsuleRosterSelectionSystemPrompt, capsuleRosterSelectionUserText, capsuleRosterSelectionContent, capsulePlanCompositionSystemPrompt } = await import("../routes/ai.js")

const topIdsOf = outfits => outfits.flatMap(outfit => (outfit.pieces || []).filter(piece => wardrobeCategoryGroup(piece) === 'top').map(piece => Number(piece.id)))
const distinctPieceCount = outfits => new Set(outfits.flatMap(outfit => outfit.pieceIds || [])).size

function planOutfitSetSlotSchema() {
  const tool = STYLIST_TOOLS.find(entry => entry.name === 'plan_outfit_set')
  return tool?.input_schema?.properties?.slots?.items || {}
}

test('capsule planning preserves the original palette through a lifestyle clarification turn', () => {
  const question = capsulePlanQuestion('Mostly errands, museums, restaurants, and nature walks.', [
    { role: 'user', content: 'I want a summer capsule in yellow.' },
    { role: 'assistant', content: 'What does your summer mainly include?' }
  ])
  assert.match(question, /summer capsule in yellow/)
  assert.match(question, /errands, museums, restaurants, and nature walks/)

  assert.equal(
    capsulePlanQuestion('Make me a winter capsule in pink.', [
      { role: 'user', content: 'I want a summer capsule in yellow.' }
    ]),
    'Make me a winter capsule in pink.',
    'a new capsule request supersedes the earlier one'
  )
})

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
  db.prepare('DELETE FROM feedback_synthesis_drafts').run()
  db.prepare('DELETE FROM feedback_synthesis_batches').run()
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
  assert.match(
    toolContext.generatedOutfits[0].tripPlanLines.join(' '),
    // This fixture is entirely neutral, and the line now says so ("no colour
    // family beyond a 2-family neutral base") where it used to report those
    // two base families as breadth.
    /capsule palette: (?:\d+ colour famil(?:y|ies)|no colour family) beyond /,
    'set-level palette evidence must reach the bounded capsule result, not stay in diagnostics'
  )
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
  assert.doesNotMatch(result.message, /validation (?:gap|failure)|unfilled/i)
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

test('a home-specific plan slot enforces the garment owner exclusion before model composition', async () => {
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'home top', occasions: ['casual'], formality: 'everyday' })
  const excludedBottom = insertPiece({ category: 'bottom', name: 'tailored shorts', occasions: ['casual'], formality: 'everyday' })
  const allowedBottom = insertPiece({ category: 'bottom', name: 'home pants', occasions: ['casual', 'home'], formality: 'everyday' })
  insertPiece({ category: 'shoes', name: 'home shoes', occasions: ['casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  db.prepare('UPDATE pieces SET occasion_exclusions = ? WHERE id = ?').run(JSON.stringify(['home']), excludedBottom)
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{
    label: 'Home & Backyard', occasion: 'casual', activity: 'none', count: 1,
    best_for: 'home time and backyard play'
  }])

  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'a home capsule' })
  assert.equal(workbench.slots[0].occasion, 'casual')
  assert.equal(workbench.slots[0].eligibility_context, 'home')
  assert.ok(!workbench.slots[0].allowed_piece_ids.includes(excludedBottom))
  assert.ok(workbench.slots[0].allowed_piece_ids.includes(allowedBottom))
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

test('plan slot weather discloses a failed named-location forecast instead of labeling neutral gates as a seasonal estimate', async () => {
  db.prepare('DELETE FROM pieces').run()
  insertPiece({ category: 'top', name: 'neutral weather top', occasions: ['city'], formality: 'everyday' })
  insertPiece({ category: 'bottom', name: 'neutral weather pants', occasions: ['city'], formality: 'everyday' })
  insertPiece({ category: 'shoes', name: 'neutral weather shoes', occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Dinner', occasion: 'city', count: 1, location: 'Reykjavik, Iceland' }])
  slots[0].season = 'winter'
  const workbench = await buildPlanSlotWorkbench(slots, {
    allPieces,
    question: 'December dinner trip',
    dateRange: { start: '2026-12-10', end: '2026-12-10' },
    fetchImpl: async () => ({ ok: true, json: async () => ({ results: [] }) })
  })
  assert.equal(workbench.slots[0].weather_used, 'forecast unavailable for Reykjavik, Iceland; temperature unknown')
  assert.doesNotMatch(workbench.slots[0].weather_used, /winter|estimated/)
})

test('an indoor slot in extreme heat keeps transit heat and permits only light AC coverage', async () => {
  db.prepare('DELETE FROM pieces').run()
  const lightTop = insertPiece({ category: 'top', name: 'breathable museum top', occasions: ['city'], formality: 'everyday', fabric_weight: 'light' })
  const lightBottom = insertPiece({ category: 'bottom', name: 'breathable museum pants', occasions: ['city'], formality: 'everyday', fabric_weight: 'light' })
  const shoes = insertPiece({ category: 'shoes', name: 'museum walking shoes', occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const lightLayer = insertPiece({ category: 'outerwear', name: 'light AC layer', occasions: ['city'], formality: 'everyday', fabric_weight: 'light' })
  const heavyMain = insertPiece({ category: 'top', name: 'heavy wool museum top', occasions: ['city'], formality: 'everyday', fabric_weight: 'heavy' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'Museum Visit', occasion: 'city', activity: 'none', environment: 'indoor', count: 1 },
  ], { fallbackWeather: 'hot, highs 100-105F, sunny' })

  assert.equal(slots[0].statedWeather, 'indoor')
  assert.equal(slots[0].transitSeason, 'hot, highs 100-105F, sunny')

  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'museum visit during a 100F trip' })
  const allowed = new Set(workbench.slots[0].allowed_piece_ids)
  assert.match(workbench.slots[0].weather_used, /^indoor; transit: hot, highs 100-105F, sunny \(estimated\)$/)
  assert.ok(allowed.has(lightTop))
  assert.ok(allowed.has(lightBottom))
  assert.ok(allowed.has(shoes))
  assert.ok(allowed.has(lightLayer), 'a light optional AC layer remains available')
  assert.equal(allowed.has(heavyMain), false, 'a heavy main is still rejected for hot transit')
  assert.match(workbench.slots[0].submission_requirements.join(' '), /breathable hot-weather base for transit/)
  assert.match(workbench.slots[0].submission_requirements.join(' '), /optional light layer/)
})

test('extreme heat and active movement reach the model as independent pre-composition assessments', async () => {
  db.prepare('DELETE FROM pieces').run()
  const closedSupportiveShoe = insertPiece({
    category: 'shoes', name: 'cream knit slip-on shoes', reads_as: 'closed knit slip-on sneaker',
    occasions: ['casual'], formality: 'everyday', fabric_weight: 'light', heel_height: 'flat', walk_support: 'high'
  })
  const lightPants = insertPiece({
    category: 'bottom', name: 'light linen pants', reads_as: 'relaxed linen pants', bottom_kind: 'pants',
    occasions: ['casual'], formality: 'everyday', fabric_weight: 'light', fabric_category: 'linen', length_hits_at: 'ankle'
  })
  const lightShorts = insertPiece({
    category: 'bottom', name: 'light linen shorts', reads_as: 'relaxed linen shorts', bottom_kind: 'shorts',
    occasions: ['casual'], formality: 'everyday', fabric_weight: 'light', fabric_category: 'linen', length_hits_at: 'mid-thigh'
  })
  const elevatedTop = insertPiece({
    category: 'top', name: 'elevated structured top', reads_as: 'structured top', occasions: ['casual'],
    formality: 'elevated', fabric_weight: 'light', sleeve_length: 'sleeveless'
  })
  const everydayTop = insertPiece({
    category: 'top', name: 'easy everyday tank', reads_as: 'easy tank', occasions: ['casual'],
    formality: 'everyday', fabric_weight: 'light', sleeve_length: 'sleeveless'
  })
  insertPiece({ category: 'shoes', name: 'second flat shoes', reads_as: 'open toe sandals', occasions: ['casual'], formality: 'everyday', fabric_weight: 'light', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{
    label: 'Active Kid Day', occasion: 'casual', activity: 'none', environment: 'outdoor', count: 1,
    best_for: 'Chasing a five-year-old at home and in the backyard'
  }], { fallbackWeather: 'extreme heat, highs 100-105F' })

  assert.equal(slotRequiresActiveMovement(slots[0]), true)
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'active kid day in 105F heat' })
  const assessments = new Map(workbench.slots[0].piece_assessments.map(item => [item.id, item]))

  assert.equal(assessments.get(closedSupportiveShoe).movement.tier, 'preferred')
  assert.equal(assessments.get(closedSupportiveShoe).extreme_heat.tier, 'workable')
  assert.match(assessments.get(closedSupportiveShoe).extreme_heat.reason, /runs warmer/)
  assert.equal(assessments.get(lightPants).extreme_heat.tier, 'discouraged')
  assert.match(assessments.get(lightPants).extreme_heat.reason, /full-leg coverage/)
  assert.equal(assessments.get(lightShorts).extreme_heat.tier, 'preferred')
  assert.equal(assessments.get(elevatedTop).movement.tier, 'discouraged', 'elevated mains remain visible as model-judged tradeoffs')
  assert.equal(assessments.get(everydayTop).movement.tier, 'preferred')
  assert.match(workbench.slots[0].submission_requirements.join(' '), /Evaluate movement fit independently from heat fit/)
  assert.match(workbench.slots[0].submission_requirements.join(' '), /“light” describes fabric mass/)

  assert.equal(activeMovementPieceAdvisory({ category: 'shoes', heel_height: 'flat', walk_support: 'high' }, true).tier, 'preferred')
  assert.equal(extremeHeatPieceAdvisory({ category: 'bottom', bottom_kind: 'pants', fabric_weight: 'light' }, { isExtremeHeat: true }).tier, 'discouraged')
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

test('submit_plan_outfits carries styling_instructions through to the accepted outfit, defaulting to empty when omitted', async () => {
  db.prepare('DELETE FROM pieces').run()
  const bottomId = insertPiece({ category: 'bottom', name: 'mechanics pants', occasions: ['city'], formality: 'everyday' })
  const shoesId = insertPiece({ category: 'shoes', name: 'mechanics shoes', occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const topIds = []
  for (let i = 0; i < 45; i += 1) {
    topIds.push(insertPiece({ category: 'top', name: `mechanics top ${i}`, occasions: ['city'], formality: 'everyday' }))
  }
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'City Day', occasion: 'city', activity: 'none', count: 1, weather: 'indoor' },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city outfit' })
  const slotId = workbench.pendingPlan.slots[0].id
  const topId = Number(topIds[0])

  const withMechanics = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slotId,
    piece_ids: [topId, Number(bottomId), Number(shoesId)],
    styling_instructions: 'Leave the top untucked over the pants.'
  }])
  assert.equal(withMechanics.accepted.length, 1)
  assert.equal(withMechanics.accepted[0].stylingInstructions, 'Leave the top untucked over the pants.')

  const withoutMechanics = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slotId,
    piece_ids: [topId, Number(bottomId), Number(shoesId)],
  }])
  assert.equal(withoutMechanics.accepted.length, 1)
  assert.equal(withoutMechanics.accepted[0].stylingInstructions, '')
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

test('plan use-case advisories keep movement and home-play tradeoffs visible without hard filtering', () => {
  const kidSlot = { label: 'Kid Chase', bestFor: 'parks, playgrounds, chasing a 5-year-old' }
  const homeSlot = { label: 'Relaxed Home / Downtime', bestFor: 'home base, indoor play, low-key days' }
  assert.equal(slotRequiresActiveMovement(kidSlot), true)
  assert.equal(slotRequiresOperationalEase(homeSlot), true)
  assert.equal(activeMovementPieceAdvisory({ category: 'bottom', formality: 'elevated' }, true).tier, 'discouraged')
  assert.equal(activeMovementPieceAdvisory({ category: 'bottom', formality: 'everyday' }, true).tier, 'preferred')
  assert.equal(operationalEasePieceAdvisory({ category: 'shoes', heel_height: 'mid' }, true).tier, 'discouraged')
  assert.equal(operationalEasePieceAdvisory({ category: 'shoes', heel_height: 'flat' }, true).tier, 'preferred')
})

test('an owner-rejected garment pairing reaches the composer and cannot pass plan validation', async () => {
  db.prepare('DELETE FROM pieces').run()
  const dressId = insertPiece({ category: 'dress', name: 'coral maxi dress', occasions: ['city'], formality: 'everyday' })
  const topId = insertPiece({ category: 'top', name: 'emerald shell top', occasions: ['city'], formality: 'elevated' })
  db.prepare('UPDATE pieces SET tried_and_rejected = ? WHERE id = ?').run(JSON.stringify(['coral maxi dress — rejected pairing']), topId)
  db.prepare('UPDATE pieces SET styling_rules_learned = ? WHERE id = ?').run(JSON.stringify(['Do not use over the coral maxi dress']), topId)
  const shoeId = insertPiece({ category: 'shoes', name: 'flat sandals', occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Indoor City', occasion: 'city', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces })
  assert.match(workbench.piece_catalog.join('\n'), /REJECTED PAIRINGS:coral maxi dress/)
  assert.match(workbench.piece_catalog.join('\n'), /RULES \(authoritative\):Do not use over the coral maxi dress/)
  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{ slot_id: slots[0].id, piece_ids: [dressId, topId, shoeId] }], {
    visuallySeenPieceIds: new Set([dressId, topId])
  })
  assert.match(result.failures[0].reasons.join(' '), /owner-rejected pairing/)
})

test('owner-rejected pairing references match whole piece-name phrases, not substrings inside another word', () => {
  const redTop = { name: 'red top' }
  assert.equal(hasRejectedReference({ tried_and_rejected: ['textured top — rejected pairing'] }, redTop), false)
  assert.equal(hasRejectedReference({ tried_and_rejected: ['red top — rejected pairing'] }, redTop), true)
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
    roster_pieces: [
      { id: 1, name: 'top', category: 'top', photo: null, worn_photo: null, colors: [] },
      { id: 2, name: 'pants', category: 'bottom', photo: null, worn_photo: null, colors: [] },
      { id: 3, name: 'shoes', category: 'shoes', photo: null, worn_photo: null, colors: [] },
    ],
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
    { id: 1, name: 'sleeveless base', category: 'top', sleeve_length: 'sleeveless', fabric_weight: 'medium', formality: 'everyday', occasions: ['casual'], status: 'active' },
    { id: 2, name: 'long sleeve top', category: 'top', sleeve_length: 'long', fabric_weight: 'medium', formality: 'everyday', occasions: ['casual'], status: 'active' },
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
  // Colours must be genuinely all-neutral for this test to isolate what it
  // claims to. The fixture previously included `burgundy` and still described
  // itself as "identical neutral colors" — harmless while the neutral test was
  // "any colour matches", but under pieceReadsAsNeutral ("every colour matches")
  // neither piece would be neutral and the bonus could not tell them apart.
  const loudButNeutral = { id: 258, name: 'bold geometric top', category: 'top', colors: ['black', 'cream'], pattern_type: 'geometric', pattern_complexity: 'loud', occasions: ['casual', 'city'], formality: 'everyday' }
  const quietNeutral = { id: 1, name: 'quiet geometric top', category: 'top', colors: ['black', 'cream'], pattern_type: 'geometric', pattern_complexity: 'quiet', occasions: ['casual', 'city'], formality: 'everyday' }
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
  assert.match(reasons, /layers a top with a dress/)
  assert.match(reasons, /call view_pieces/)
  assert.match(reasons, /model must decide it from both photos/)
})

test('an unrecorded top-dress direction is provisionally accepted after both pieces are seen', async () => {
  db.prepare('DELETE FROM pieces').run()
  const dressId = insertPiece({ category: 'dress', name: 'plain midi dress', occasions: ['city'] })
  const topId = insertPiece({ category: 'top', name: 'plain blouse', occasions: ['city'] })
  const shoesId = insertPiece({ category: 'shoes', name: 'flat shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Wednesday', occasion: 'city', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'office week' })
  const slot = workbench.pendingPlan.slots[0]
  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(dressId), Number(topId), Number(shoesId)],
  }], { visuallySeenPieceIds: new Set([Number(dressId), Number(topId)]) })

  assert.equal(result.failures.length, 0, JSON.stringify(result.failures))
  assert.equal(result.accepted.length, 1)
})

test('an explicit overlay top over a dress is accepted once both pieces have been visually seen', async () => {
  db.prepare('DELETE FROM pieces').run()
  const dressId = insertPiece({ category: 'dress', name: 'abstract midi dress', occasions: ['city'] })
  const topId = insertPiece({ category: 'top', name: 'abstract print blouse', occasions: ['city'], engine_notes: 'Explicit overlay top; wear over a dress.' })
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

test('an explicit base layer under a dress remains a valid top-plus-dress relationship', async () => {
  db.prepare('DELETE FROM pieces').run()
  const dressId = insertPiece({ category: 'dress', name: 'pinafore midi dress', occasions: ['city'], engine_notes: 'Designed to wear over a fitted base layer.' })
  const topId = insertPiece({ category: 'top', name: 'fitted base layer tee', occasions: ['city'], engine_notes: 'Base layer worn under dresses.' })
  const shoesId = insertPiece({ category: 'shoes', name: 'flat shoes', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Wednesday', occasion: 'city', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'office week' })
  const slot = workbench.pendingPlan.slots[0]
  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(dressId), Number(topId), Number(shoesId)],
  }], { visuallySeenPieceIds: new Set([Number(dressId), Number(topId)]) })

  assert.equal(result.failures.length, 0, `expected the base-layer relationship to pass, got ${JSON.stringify(result.failures)}`)
})

test('offline replay rejects the stale white-tank plus lace-dress IDs from thread_1786036700758', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'white scoop neck sleeveless top', reads_as: 'white fitted tank', occasions: ['city'] })
  const dressId = insertPiece({ category: 'dress', name: 'black brown lace floral midi dress', occasions: ['city'] })
  const shoesId = insertPiece({ category: 'shoes', name: 'black canvas sneakers', occasions: ['city'], heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Museums & City', occasion: 'city', activity: 'walking', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'summer capsule' })
  const slot = workbench.pendingPlan.slots[0]
  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    title: 'White Tank + Black-Brown Lace Floral Dress',
    piece_ids: [Number(topId), Number(dressId), Number(shoesId)],
    reason: 'The white tank is not added since the dress is complete. Correcting: the dress is the core.'
  }], { visuallySeenPieceIds: new Set([Number(topId), Number(dressId)]) })

  assert.equal(result.accepted.length, 0)
  const reasons = result.failures[0].reasons.join(' ')
  assert.match(reasons, /reason revises itself mid-sentence/)
  assert.doesNotMatch(reasons, /no recorded layering relationship/)
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
  assert.equal(reasonRevisesMidSentence('The tank is excluded. Correcting: the dress is the core.'), true)
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
    id: 1, name: 'black sleeveless blouse', category: 'top', sleeve_length: 'sleeveless',
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

test('workbench instructions carry applicable owner guidance without mislabelling prompt advice as a hard gate', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'City Day', occasion: 'city', activity: 'none', count: 1 }])

  const withRules = await buildPlanSlotWorkbench(slots, {
    allPieces,
    question: 'city day',
    ownerRules: ['For office and client days: structured silhouettes only — no maxi skirts, no shawls at work.', 'No flats for me.']
  })
  assert.match(withRules.instructions, /OWNER GUIDANCE — applicable to this bounded roster and these use cases\./)
  assert.match(withRules.instructions, /Follow it unless the owner explicitly changes it in this request:/)
  assert.doesNotMatch(withRules.instructions, /hard requirements/)
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
      sleeve_length: 'long',
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
    sleeve_length: '',
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
      formality, sleeve_length, length_hits_at, heel_height, walk_support, style_profile_json
    ) VALUES (
      @name, @category, @colors, @occasions, @season, @notes, @status,
      @recommendation_status, @fit_confidence, @role_permission, @occasion_permissions,
      @engine_notes, @photo, @worn_photo, @pattern_type, @pattern_scale,
      @pattern_complexity, @reads_as, @silhouette, @fabric_category, @fabric_weight, @fiber_content,
      @formality, @sleeve_length, @length_hits_at, @heel_height, @walk_support, @style_profile_json
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

test('normalizePlanSlots preserves an unambiguous home use case for eligibility without conflating home plus errands', () => {
  const [home, mixed] = normalizePlanSlots([
    { label: 'Home & Backyard', occasion: 'casual', activity: 'none', best_for: 'home time and backyard play' },
    { label: 'At Home / Errands', occasion: 'casual', activity: 'none', best_for: 'home days and quick errands' },
  ])
  assert.equal(home.occasion, 'casual')
  assert.equal(home.eligibilityOccasion, 'home')
  assert.equal(mixed.eligibilityOccasion, 'casual')
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

// Was: "normalizePlanSlots lets explicit outdoor environment beat indoor text
// defaults", pinning spec 17 Part 1's deliberate choice that a declared
// `outdoor` should suppress the label classifier.
//
// TWO problems, both fixed here. The assertion was VACUOUS: its label was
// "Outdoor Office Picnic", and the word "Outdoor" trips the classifier's own
// exclusion list, so the text default never fired and the declaration was never
// actually exercised. It passed identically whether or not declarations won —
// which is why nothing failed when owner ruling 2026-07-30 reversed the
// behaviour to label-wins.
//
// It now tests what it names, against the current ruling: a declared `outdoor`
// yields to a label that unambiguously reads indoor, and still wins everywhere
// else.
test('an outdoor declaration wins except where the label unambiguously reads indoor', () => {
  // The word "Outdoor" in the label is itself an outdoor signal, so this stays
  // outdoor under any rule — kept as the original fixture, now with a sibling
  // that isolates the actual property.
  const [named] = normalizePlanSlots([
    { label: 'Outdoor Office Picnic', occasion: 'city', activity: 'none', weather: 'outdoor' },
  ], { fallbackWeather: 'mild' })
  assert.equal(named.environment, 'outdoor')
  assert.equal(named.statedWeather, '')
  assert.equal(named.season, 'mild')

  // Same declaration, label no longer self-identifying as outdoor. Owner ruling
  // 2026-07-30: the label wins here. Under spec 17 this asserted 'outdoor'.
  const [office] = normalizePlanSlots([
    { label: 'Office Picnic', occasion: 'city', activity: 'none', weather: 'outdoor' },
  ], { fallbackWeather: 'mild' })
  assert.equal(office.environment, 'indoor')
  assert.equal(office.statedWeather, 'indoor')

  // A declaration still wins over a label that says nothing either way.
  const [neutral] = normalizePlanSlots([
    { label: 'Day Two', occasion: 'city', activity: 'none', weather: 'outdoor' },
  ], { fallbackWeather: 'mild' })
  assert.equal(neutral.environment, 'outdoor')
  assert.equal(neutral.statedWeather, '')
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

// Live thread_1785902365403 sent no_repeat ['tops','dresses'] on a capsule and,
// crucially, sent NO piece_budget — and the guard's first condition is
// `pieceBudget > 0`. It still stripped correctly, because the tool applies the
// 24-piece default and the reuse:maximize default BEFORE calling the guard.
// That ordering is load-bearing and nothing pinned it, so pin it: reorder those
// three lines and a capsule silently acquires a no-repeat rule that fights the
// whole point of a capsule.
test('a capsule that omits piece_budget still gets model-invented no_repeat stripped', () => {
  const question = 'I want a summer capsule.'
  const planKind = resolvePlanKind('seasonal_capsule', question)
  // Exactly the tool-call shape the live run produced.
  let constraints = { reuse: 'maximize', no_repeat: ['tops', 'dresses'], allow_repeat: ['shoes', 'outerwear'] }
  if (planKind === 'seasonal_capsule' && !(Number(constraints.piece_budget) > 0)) {
    constraints.piece_budget = DEFAULT_SEASONAL_CAPSULE_BUDGET
  }
  if (planKind === 'seasonal_capsule' && !String(constraints.reuse || '').trim()) constraints.reuse = 'maximize'
  constraints = sanitizePlanConstraintsForQuestion(constraints, question)

  assert.equal(constraints.no_repeat, undefined, 'a budget-less capsule must still lose invented no_repeat')
  assert.equal(constraints.piece_budget, DEFAULT_SEASONAL_CAPSULE_BUDGET)
  assert.deepEqual(constraints.allow_repeat, ['shoes', 'outerwear'], 'allow_repeat is untouched')
})

// The model reached for no_repeat on a capsule twice in captured runs. The guard
// discards it, but the schema never said so — the model was spending reasoning
// on a field that is silently dropped.
test('the plan tool tells the model no_repeat is discarded for a capsule', () => {
  const planTool = STYLIST_TOOLS.find(tool => tool.name === 'plan_outfit_set')
  const noRepeat = planTool.input_schema.properties.constraints.properties.no_repeat.description
  assert.match(noRepeat, /Do not set this for a seasonal capsule/)
  assert.match(noRepeat, /unless the person explicitly asked for no repeats/)
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
    insertPiece({ category: 'top', name, season, sleeve_length: sleeves, colors: ['navy'], reads_as: 'indoor capsule top', pattern_type: 'solid', fabric_weight: 'medium', formality: 'everyday', occasions: ['casual', 'smart-casual', 'city'] })
  }
  for (const name of ['black pants', 'navy jeans', 'grey trousers', 'olive skirt']) {
    insertPiece({ category: 'bottom', name, season: 'year-round', colors: ['black'], reads_as: 'capsule bottom', formality: 'everyday', occasions: ['casual', 'smart-casual', 'city'] })
  }
  insertPiece({ category: 'dress', name: 'indoor day dress', season: 'year-round', sleeve_length: 'short', colors: ['navy'], reads_as: 'indoor dress', formality: 'everyday', occasions: ['casual', 'smart-casual'] })
  insertPiece({ category: 'outerwear', name: 'transition jacket', season: 'year-round', sleeve_length: 'long', colors: ['olive'], reads_as: 'light transition jacket', formality: 'everyday', occasions: ['casual', 'smart-casual', 'city'] })
  insertPiece({ category: 'outerwear', name: 'charcoal knit cardigan', season: 'cool', sleeve_length: 'long', colors: ['charcoal'], reads_as: 'soft indoor cardigan', fabric_category: 'knit', fabric_weight: 'medium', fiber_content: ['wool'], formality: 'everyday', occasions: ['casual', 'smart-casual', 'city'] })
  insertPiece({
    category: 'outerwear',
    name: 'black winter puffer coat',
    season: 'cool',
    sleeve_length: 'long',
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
  const covered = tops.filter(piece => ['short', '3/4', 'long'].includes(piece.sleeve_length))

  assert.ok(!roster.some(piece => piece.name === 'warm floral tank'), `warm-only top should not consume explicit winter roster space, got ${roster.map(piece => piece.name)}`)
  assert.ok(covered.length >= Math.ceil(tops.length / 2), `sleeve-covered indoor bases should be the majority, got ${tops.map(piece => `${piece.name}:${piece.sleeve_length}`)}`)
  assert.ok(tops.some(piece => piece.sleeve_length === 'sleeveless'), 'year-round sleeveless layering bases should remain eligible')
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

test('representative outfit count does not multiply casual garment reserves', async () => {
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
  const oneCard = normalizePlanSlots([{ label: 'Casual Summer', occasion: 'casual', activity: 'walking', count: 1 }])
  const eightCards = normalizePlanSlots([{ label: 'Casual Summer', occasion: 'casual', activity: 'walking', count: 8 }])
  const select = slots => selectCapsuleRoster(pool, { budget: 10, isSummer: true, occasions: ['casual'], slots })
  assert.deepEqual(
    select(oneCard).map(piece => Number(piece.id)).sort((a, b) => a - b),
    select(eightCards).map(piece => Number(piece.id)).sort((a, b) => a - b),
    'asking the UI to show more cards must not manufacture additional garment requirements'
  )
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

// --- Bench category targets ------------------------------------------------
//
// Written as an acceptance contract before the implementation, and kept as
// permanent regression tests once it passed (AGENTS: "acceptance criteria
// become permanent tests, so the next refactor cannot silently regress them").
//
// The defect these pin, measured on the live 242-piece wardrobe for a 4-slot
// summer capsule at budget 24 (scratch/compare_capsule_rosters.js --verbose):
//
//     benchSize 40 -> 13T 14B  3D  4O  6S   hero-capable 10/46  elevated-shoes 2/18
//     benchSize 70 -> 28T 22B  3D  8O  9S   hero-capable 10/46  elevated-shoes 3/18
//     eligible     -> 67T 31B 14D 16O 32S
//
// Widening the bench by 30 places bought 15 tops, 8 bottoms and ZERO dresses,
// and left hero-capable representation exactly where it was. All 30 went to a
// global capsuleVersatilityScore fill — a score that is a fair comparator
// within a category and close to meaningless across them (dresses sit at median
// rank 116 of 160, shoes at 113, tops at 84). The defect was bench COMPOSITION,
// not bench width, so the fix is in the per-category targets rather than in
// benchSize — see buildCapsuleBench.
//
// Deliberately property-based: no invented floor constants. A constant that
// shapes output needs a source, an owner ruling, or a measurement, and none of
// those exists for "the bench should hold 6 dresses." What IS defensible is
// that a category the model cannot choose within is not being selected at all.
test('a category with supply headroom offers the model more than the roster quota', () => {
  db.prepare('DELETE FROM pieces').run()
  // Tops score high (neutral, solid, widely tagged) and dominate global rank.
  for (let i = 0; i < 60; i += 1) {
    insertPiece({ category: "top", name: `neutral top ${i}`, colors: ['black'], pattern_type: 'solid', occasions: ['casual', 'city', 'smart casual', 'evening'], formality: 'everyday' })
  }
  for (let i = 0; i < 12; i += 1) {
    insertPiece({ category: 'bottom', name: `neutral bottom ${i}`, colors: ['black'], pattern_type: 'solid', occasions: ['casual', 'city', 'smart casual', 'evening'], formality: 'everyday' })
  }
  // Dresses score lower (one colour of their own, fewer occasion tags), which
  // is exactly why rank-fill never reaches them on the real wardrobe.
  for (let i = 0; i < 12; i += 1) {
    insertPiece({ category: 'dress', name: `dress ${i}`, colors: ['green'], pattern_type: 'solid', occasions: ['casual'], formality: 'everyday' })
  }
  for (let i = 0; i < 12; i += 1) {
    insertPiece({ category: 'shoes', name: `shoe ${i}`, colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })
  }
  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 3 }])
  const { bench } = buildCapsuleBench(pool, { budget: 24, slots, isSummer: true, benchSize: 40 })

  const benchDresses = bench.filter(piece => wardrobeCategoryGroup(piece) === 'dress').length
  const eligibleDresses = pool.filter(piece => wardrobeCategoryGroup(piece) === 'dress').length
  const dressQuota = 3 // capsuleQuotas(24).dress

  assert.ok(eligibleDresses > dressQuota, 'precondition: this wardrobe has dress headroom to select within')
  // A bench that offers exactly the quota is not a choice set — it is a forced
  // pick. Stage 3 exists so the model SELECTS; in a category where bench count
  // equals quota it is merely accepting what the engine already decided.
  assert.ok(
    benchDresses > dressQuota,
    `a category with supply headroom must give the model something to choose between: bench holds ${benchDresses} dress(es) against a quota of ${dressQuota} and ${eligibleDresses} eligible`
  )
})

test('widening the bench widens every under-represented category, not only the top-ranked ones', () => {
  db.prepare('DELETE FROM pieces').run()
  for (let i = 0; i < 60; i += 1) {
    insertPiece({ category: "top", name: `neutral top ${i}`, colors: ['black'], pattern_type: 'solid', occasions: ['casual', 'city', 'smart casual', 'evening'], formality: 'everyday' })
  }
  for (let i = 0; i < 12; i += 1) {
    insertPiece({ category: 'bottom', name: `neutral bottom ${i}`, colors: ['black'], pattern_type: 'solid', occasions: ['casual', 'city', 'smart casual', 'evening'], formality: 'everyday' })
  }
  for (let i = 0; i < 12; i += 1) {
    insertPiece({ category: 'dress', name: `dress ${i}`, colors: ['green'], pattern_type: 'solid', occasions: ['casual'], formality: 'everyday' })
  }
  for (let i = 0; i < 12; i += 1) {
    insertPiece({ category: 'shoes', name: `shoe ${i}`, colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })
  }
  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 3 }])
  const count = (list, group) => list.filter(piece => wardrobeCategoryGroup(piece) === group).length

  const narrow = buildCapsuleBench(pool, { budget: 24, slots, isSummer: true, benchSize: 24 }).bench
  const wide = buildCapsuleBench(pool, { budget: 24, slots, isSummer: true, benchSize: 48 }).bench
  assert.ok(wide.length > narrow.length, 'precondition: the wider bench really is wider')

  // Spending 24 more places must not leave a starved category untouched. This
  // is the exact 40->70 defect: +15 tops, +8 bottoms, +0 dresses.
  for (const group of ['top', 'bottom', 'dress', 'shoes']) {
    const eligible = count(pool, group)
    if (count(narrow, group) >= eligible) continue // already exhausted, nothing to widen
    assert.ok(
      count(wide, group) > count(narrow, group),
      `${group}: bench grew ${narrow.length}->${wide.length} overall but ${group} stayed at ${count(narrow, group)} of ${eligible} eligible — extra places went only to the highest-ranked categories`
    )
  }
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

  // Presentation count is not a roster failure: one real lifestyle path can
  // be represented by one or several cards without changing garment validity.
  {
    db.prepare('DELETE FROM pieces').run()
    insertPiece({ category: 'top', name: 'only top', colors: ['black'], occasions: ['casual'], formality: 'everyday' })
    insertPiece({ category: 'bottom', name: 'only bottom', colors: ['black'], occasions: ['casual'], formality: 'everyday' })
    insertPiece({ category: 'shoes', name: 'only shoe', colors: ['black'], occasions: ['casual'], formality: 'everyday' })
    const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
    const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
    const result = validateCapsuleRoster(pool, { slots, budget: 10, plannedCards: 2 })
    assert.ok(!result.failures.some(entry => entry.code === 'capacity_below_rotation'))
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

  // A generic winter label does not manufacture cardigan/coat roles when the
  // supplied lifestyle slot does not ask for either job.
  {
    db.prepare('DELETE FROM pieces').run()
    insertPiece({ category: 'top', name: 'top', colors: ['black'], occasions: ['casual'], formality: 'everyday' })
    insertPiece({ category: 'bottom', name: 'bottom', colors: ['black'], occasions: ['casual'], formality: 'everyday' })
    insertPiece({ category: 'shoes', name: 'shoe', colors: ['black'], occasions: ['casual'], formality: 'everyday' })
    insertPiece({ category: 'outerwear', name: 'knit cardigan', colors: ['charcoal'], occasions: ['casual'], formality: 'everyday', fabric_category: 'knit', fabric_weight: 'medium' })
    const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
    const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 1 }])
    const result = validateCapsuleRoster(pool, { slots, budget: 12, isWinterCapsule: true })
    assert.ok(!result.failures.some(entry => entry.code === 'winter_layer_role_missing'))
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
    { id: 4, category: 'top', colors: ['orange'] },
  ]
  const neutralRequest = extractStatedPalette('summer capsule, keep it to black cream and olive', pool)
  assert.deepEqual(neutralRequest.colors, ['black', 'cream', 'olive'])
  assert.deepEqual(neutralRequest.accentColors, [], 'neutral and neutral-adjacent names do not consume the accent allowance')
  assert.deepEqual(extractStatedPalette('summer capsule with orange', pool).accentColors, ['orange'])
  assert.deepEqual(extractStatedPalette('I want a summer capsule', pool).colors, [], 'saying nothing is not a palette')
  // "neutrals" names a set; expand it against what this person actually owns.
  const neutrals = extractStatedPalette('a summer capsule in neutrals', pool).colors
  assert.ok(neutrals.includes('black') && neutrals.includes('cream'))
  assert.ok(!neutrals.includes('orange'))
  // A canonical colour the wardrobe does not have remains visible so the
  // capsule can disclose that it was unavailable instead of silently losing
  // the request.
  assert.deepEqual(extractStatedPalette('a capsule in turquoise', pool).accentColors, ['turquoise'])
  assert.deepEqual(extractStatedPalette('a capsule with fuchsia accents', pool).accentColors, ['fuchsia'])
})

test('the automatic capsule foundation aims for 70% neutral with a 60–75% acceptance band', () => {
  assert.deepEqual(capsuleNeutralBasePlan(24), { target: 17, minimum: 15, maximum: 18 })
  assert.equal(capsuleNeutralBaseCount([
    { colors: ['black'] },
    { colors: ['cream', 'olive'] },
    { colors: ['orange'] },
  ]), 2)
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
test('a requested accent never removes structurally necessary neutral footwear', () => {
  const palettePieces = []
  for (let i = 0; i < 4; i += 1) {
    palettePieces.push({ id: 10 + i, name: `black top ${i}`, category: 'top', colors: ['black'], formality: 'everyday', occasions: ['casual', 'city'] })
    palettePieces.push({ id: 20 + i, name: `black bottom ${i}`, category: 'bottom', colors: ['black'], formality: 'everyday', occasions: ['casual', 'city'] })
  }
  // The only shoes are rust, but black is a neutral request rather than an
  // accent-family constraint. Structure must still win.
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

test('a duplicate-only repaired model roster keeps its unique choices and fills the empty place locally', async () => {
  const pool = paletteTestWardrobe()
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  let expectedUniqueIds = []
  let calls = 0
  const result = await selectCapsuleRosterViaModel({
    pool, budget: 10, slots, isSummer: true, occasions: ['casual'],
    chooseRoster: async ({ bench }) => {
      calls += 1
      const valid = bench.slice(0, 10).map(piece => Number(piece.id))
      expectedUniqueIds = valid.slice(0, 9)
      return {
        roster_piece_ids: [...expectedUniqueIds, expectedUniqueIds[0]],
        palette: 'neutral base',
        piece_jobs: []
      }
    }
  })

  assert.equal(calls, 2, 'the model still receives its one explicit repair attempt')
  assert.equal(result.source, 'model_repaired_locally')
  assert.equal(result.roster.length, 10)
  assert.ok(expectedUniqueIds.every(id => result.roster.some(piece => Number(piece.id) === id)), 'the local fill must preserve every unique model choice')
})

test('an unavailable requested accent stays neutral and is disclosed to the user', async () => {
  const pool = paletteTestWardrobe()
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  const result = await selectCapsuleRosterViaModel({
    pool, budget: 10, slots, isSummer: true, occasions: ['casual'], palette: ['teal'],
    chooseRoster: async ({ bench }) => ({
      roster_piece_ids: bench.slice(0, 10).map(piece => Number(piece.id)),
      palette: 'neutral foundation; teal unavailable',
      piece_jobs: []
    })
  })

  assert.equal(result.source, 'model')
  assert.ok(result.roster.every(piece => capsuleNeutralBaseCount([piece]) === 1), 'no unrelated accent is substituted')
  assert.equal(result.coverageGaps.length, 1)
  assert.match(result.coverageGaps[0], /could not supply teal/i)
  assert.match(result.coverageGaps[0], /stayed in the neutral foundation/i)
})

test('deterministic fallback keeps the neutral base and requested family without unrelated accents', async () => {
  const pool = paletteTestWardrobe().map(piece => ({ ...piece, colors: [...piece.colors] }))
  pool.find(piece => piece.id === 100).colors = ['yellow']
  pool.find(piece => piece.id === 200).colors = ['mustard']
  pool.find(piece => piece.id === 300).colors = ['yellow']
  pool.find(piece => piece.id === 101).colors = ['orange']
  pool.push(
    { id: 400, name: 'neutral dress', category: 'dress', colors: ['black'], formality: 'everyday', occasions: ['casual', 'city'] },
    { id: 500, name: 'neutral cardigan', category: 'outerwear', colors: ['cream'], formality: 'everyday', occasions: ['casual', 'city'] }
  )
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  const result = await selectCapsuleRosterViaModel({
    pool, budget: 10, slots, isSummer: true, occasions: ['casual'], palette: ['yellow'],
    chooseRoster: async () => ({ roster_piece_ids: [], palette: '', piece_jobs: [] })
  })

  assert.equal(result.source, 'deterministic_fallback')
  assert.equal(result.roster.length, 10)
  assert.ok(result.roster.some(piece => (piece.colors || []).some(color => ['yellow', 'mustard'].includes(color))))
  assert.ok(capsuleNeutralBaseCount(result.roster) >= capsuleNeutralBasePlan(10).minimum)
  assert.ok(capsuleNeutralBaseCount(result.roster) <= capsuleNeutralBasePlan(10).maximum)
  assert.equal(
    result.roster.some(piece => (piece.colors || []).includes('orange')),
    false
  )
})

// The neutral bonus makes the deterministic selector prefer neutrals, so on a
// wardrobe with plenty of them the palette-safe fallback lands ABOVE the neutral
// ceiling and has to swap requested-family pieces back in. That swap loop shipped
// reading a `.valid` field the validator never returns, so it silently never ran
// and a fallback capsule could come back fully neutral with the requested family
// sitting available in the pool. Pin the swap actually happening.
test('deterministic fallback swaps requested-family pieces in when the neutral base overshoots its ceiling', async () => {
  const pool = paletteTestWardrobe()
  pool.push(
    { id: 400, name: 'neutral dress', category: 'dress', colors: ['black'], formality: 'everyday', occasions: ['casual', 'city'] },
    { id: 500, name: 'neutral cardigan', category: 'outerwear', colors: ['cream'], formality: 'everyday', occasions: ['casual', 'city'] }
  )
  // Narrower occasion coverage than the neutrals, so the stated-palette bonus
  // alone does not pull them in and the roster genuinely lands above the ceiling.
  for (let i = 0; i < 3; i += 1) {
    pool.push({ id: 110 + i, name: `yellow top ${i}`, category: 'top', colors: ['yellow'], formality: 'everyday', occasions: ['casual'] })
    pool.push({ id: 210 + i, name: `yellow bottom ${i}`, category: 'bottom', colors: ['mustard'], formality: 'everyday', occasions: ['casual'] })
  }
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  const result = await selectCapsuleRosterViaModel({
    pool, budget: 10, slots, isSummer: true, occasions: ['casual'], palette: ['yellow'],
    chooseRoster: async () => ({ roster_piece_ids: [], palette: '', piece_jobs: [] })
  })

  const plan = capsuleNeutralBasePlan(10)
  assert.equal(result.source, 'deterministic_fallback')
  assert.equal(result.roster.length, 10)
  assert.ok(
    capsuleNeutralBaseCount(result.roster) <= plan.maximum,
    `the fallback must swap down to the neutral ceiling, got ${capsuleNeutralBaseCount(result.roster)} of ${plan.maximum}`
  )
  assert.ok(
    result.roster.filter(piece => (piece.colors || []).some(color => ['yellow', 'mustard'].includes(color))).length >= 10 - plan.maximum,
    'the places freed below the ceiling carry the requested family'
  )
})

test('deterministic fallback stays neutral and preserves the supply disclosure when a requested family is unavailable', async () => {
  const pool = paletteTestWardrobe()
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  const result = await selectCapsuleRosterViaModel({
    pool, budget: 10, slots, isSummer: true, occasions: ['casual'], palette: ['yellow'],
    chooseRoster: async () => ({ roster_piece_ids: [], palette: '', piece_jobs: [] })
  })

  assert.equal(result.source, 'deterministic_fallback')
  assert.equal(capsuleNeutralBaseCount(result.roster), result.roster.length)
  assert.match(result.coverageGaps.join(' '), /yellow.*not available|could not supply.*yellow/i)
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

  for (const expected of ['base_for_dependent_top', 'register_reserve:top', 'shoe_reserve:0']) {
    assert.ok(conditionCodes.includes(expected), `${expected} must be a declared guarantee`)
  }
  for (const formulaOnly of ['statement_presence', 'dress_presence', 'winter_covered_bases', 'winter_indoor_layer', 'winter_transition_layer', 'layer_floor:outerwear', 'category_ceiling:outerwear']) {
    assert.ok(!conditionCodes.includes(formulaOnly), `${formulaOnly} is guidance, not universal validity`)
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
  assert.ok(!quiet.failures.some(failure => failure.code === 'statement_presence'))

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
  const mk = (id, name, formality, sleeve) => ({ id, name, category: 'top', formality, sleeve_length: sleeve, season: 'year-round' })
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
  const covered = repaired.filter(piece => ['short', 'long'].includes(String(piece.sleeve_length)))

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
// The bench's protagonist reserve and the statement-presence guarantee had two
// different definitions of "can lead a look": the bench read
// `loud || visual_roles.includes('hero_piece')`, the guarantee read `loud`
// alone. Live thread_1785883879348 shipped a rotation led by a lace floral midi
// dress tagged hero_piece (pattern_complexity `medium`) and a blouson top tagged
// hero_piece (`solid`), and the guarantee counted ONE statement piece. Worse,
// enforceCapsulePostConditions acts on that count and would swap a piece out to
// force in a loud print. One predicate now, so they cannot drift again.
test('protagonist metadata remains model evidence and is not a validator requirement', () => {
  const heroByTag = {
    id: 1, name: 'black brown lace floral midi dress', category: 'dress',
    pattern_complexity: 'medium', colors: ['black', 'brown'],
    style_profile_json: { visual_roles: ['hero_piece', 'texture_piece'] }
  }
  const heroBySolidCut = {
    id: 2, name: 'black blouson v-neck top', category: 'top',
    pattern_complexity: 'solid', colors: ['black'],
    style_profile_json: { visual_roles: ['hero_piece', 'support_piece'] }
  }
  const heroByPrint = {
    id: 3, name: 'black geometric tassel hem crop top', category: 'top',
    pattern_complexity: 'loud', colors: ['black'],
    style_profile_json: { visual_roles: ['hero_piece'] }
  }
  const quiet = {
    id: 4, name: 'white scoop neck sleeveless top', category: 'top',
    pattern_complexity: 'solid', colors: ['white'], style_profile_json: { visual_roles: ['support_piece'] }
  }
  const statementCondition = capsuleRosterPostConditions({
    quotas: { top: 8, bottom: 7, dress: 3, outerwear: 2, shoes: 4 }
  }).find(condition => condition.code === 'statement_presence')
  assert.equal(statementCondition, undefined)
  assert.equal([heroByTag, heroBySolidCut, heroByPrint, quiet].length, 4, 'fixture keeps all visual roles available to the model')
})

// The bench reserve and the guarantee must agree piece-for-piece on the
// "is this expressive" half, or the bench can offer protagonists the guarantee
// refuses to count — which is exactly the state this fixed.
test('the bench still offers protagonist choices without forcing one into the roster', () => {
  db.prepare('DELETE FROM pieces').run()
  const ids = {
    loud: insertPiece({ category: 'top', name: 'loud print top', pattern_complexity: 'loud', colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' }),
    heroTag: insertPiece({ category: 'dress', name: 'hero tagged dress', pattern_complexity: 'medium', colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday', style_profile_json: JSON.stringify({ visual_roles: ['hero_piece'] }) }),
    quiet: insertPiece({ category: 'top', name: 'quiet basic top', pattern_complexity: 'solid', colors: ['white'], occasions: ['casual', 'city'], formality: 'everyday' })
  }
  insertPiece({ category: 'bottom', name: 'plain bottom', colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })
  insertPiece({ category: 'shoes', name: 'plain shoe', colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })
  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  const { bench } = buildCapsuleBench(pool, { budget: 10, slots, benchSize: 40 })

  const benchById = new Map(bench.map(p => [Number(p.id), p]))
  for (const key of ['loud', 'heroTag']) {
    const p = benchById.get(Number(ids[key]))
    assert.ok(p, `${key} should be on the bench`)
  }
  assert.ok(benchById.get(Number(ids.quiet)), 'quiet support remains available too')
  assert.ok(!capsuleRosterPostConditions({ quotas: { top: 4, bottom: 3, dress: 2, outerwear: 1, shoes: 2 } })
    .some(c => c.code === 'statement_presence'))
})

// Owner ruling 2026-08-05: "the summer capsule should have at least one dress,
// but no one said it has to be casual." The presence half was previously fused
// to the register reserve, which demanded the dress clear the plan's STRICTEST
// ceiling — and that half is what rejected the model's roster in both recorded
// fallbacks (thread_1785711580188, thread_1785883879348).
test('a model roster whose only dress is elevated is accepted, not sent back', () => {
  db.prepare('DELETE FROM pieces').run()
  // The bench holds BOTH an everyday dress and an elevated one, so supply
  // attribution cannot excuse the old rule — a satisfying piece was available
  // and went unpicked, which is exactly when the validator blames the roster.
  for (let i = 0; i < 10; i += 1) insertPiece({ category: 'top', name: `everyday top ${i}`, colors: ['black'], formality: 'everyday', occasions: ['casual', 'city'] })
  for (let i = 0; i < 9; i += 1) insertPiece({ category: 'bottom', name: `everyday bottom ${i}`, colors: ['black'], formality: 'everyday', occasions: ['casual', 'city'] })
  for (let i = 0; i < 6; i += 1) insertPiece({ category: 'shoes', name: `everyday shoe ${i}`, colors: ['black'], formality: 'everyday', occasions: ['casual', 'city'], heel_height: 'flat', walk_support: 'high' })
  for (let i = 0; i < 3; i += 1) insertPiece({ category: 'outerwear', name: `light layer ${i}`, colors: ['black'], formality: 'everyday', occasions: ['casual', 'city'] })
  insertPiece({ category: 'dress', name: 'everyday jersey dress', colors: ['black'], formality: 'everyday', occasions: ['casual', 'city'] })
  insertPiece({ category: 'dress', name: 'elevated lace midi dress', colors: ['black'], formality: 'elevated', occasions: ['city', 'smart casual', 'evening'] })

  const pool = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'At Home', occasion: 'casual', count: 3 },
    { label: 'City Outings', occasion: 'city', count: 3 }
  ])
  // A MODEL roster: a plain array with no postConditionGaps record, so every
  // condition applies strictly. It takes the elevated dress and leaves the
  // everyday one — the shape of what the live runs actually did.
  const byName = name => pool.find(piece => piece.name === name)
  const modelRoster = [
    byName('elevated lace midi dress'),
    ...pool.filter(p => wardrobeCategoryGroup(p) === 'top').slice(0, 8),
    ...pool.filter(p => wardrobeCategoryGroup(p) === 'bottom').slice(0, 7),
    ...pool.filter(p => wardrobeCategoryGroup(p) === 'outerwear').slice(0, 2),
    ...pool.filter(p => wardrobeCategoryGroup(p) === 'shoes').slice(0, 4)
  ]
  const verdict = validateCapsuleRoster(modelRoster, { slots, budget: 24, isSummer: true, pool })
  const dressFailures = verdict.failures.filter(failure => /dress/i.test(failure.message))
  assert.deepEqual(dressFailures, [],
    `an elevated dress must satisfy the requirement, got: ${JSON.stringify(dressFailures)}`)
})

test('a roster with no dress is not rejected merely for its category shape', () => {
  const quotas = { top: 8, bottom: 7, dress: 3, outerwear: 2, shoes: 4 }
  const conditions = capsuleRosterPostConditions({ quotas, roster: [] })
  assert.ok(!conditions.some(c => c.code === 'dress_presence'))
})

test('the post-condition enforcer does not swap garments to manufacture a statement piece', () => {
  const quietTop = { id: 1, name: 'quiet cream tee', category: 'top', formality: 'everyday', pattern_complexity: 'quiet' }
  const quietTopB = { id: 2, name: 'quiet navy tee', category: 'top', formality: 'everyday', pattern_complexity: 'quiet' }
  const loudTop = { id: 3, name: 'bold geometric top', category: 'top', formality: 'everyday', pattern_complexity: 'loud' }
  const quietBottom = { id: 4, name: 'black trouser', category: 'bottom', formality: 'everyday', pattern_complexity: 'quiet' }
  const roster = [quietTop, quietTopB, quietBottom]
  const groups = { top: [quietTop, quietTopB, loudTop], bottom: [quietBottom], dress: [], outerwear: [], shoes: [] }
  // dress: 0 keeps this focused on the statement swap; dress_presence has its own tests.
  const conditions = capsuleRosterPostConditions({ quotas: { top: 5, bottom: 4, dress: 0 } })

  const { roster: withStatement, unsatisfied } = enforceCapsulePostConditions(
    roster, groups, conditions, new Map([[quietTop, 40], [quietTopB, 10], [loudTop, 5]]), new Set()
  )

  assert.equal(unsatisfied.length, 0)
  assert.ok(!withStatement.includes(loudTop), 'visual personality remains the roster model\'s judgment')
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
  const everydayKnit = { id: 1, name: 'everyday long knit', category: 'top', formality: 'everyday', sleeve_length: 'long' }
  const everydayTee = { id: 2, name: 'everyday short tee', category: 'top', formality: 'everyday', sleeve_length: 'short' }
  const spare = { id: 3, name: 'higher scoring everyday knit', category: 'top', formality: 'everyday', sleeve_length: 'long' }
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

// Live run thread_1785380251549: the model spent 1 of 24 roster places on a
// pendant necklace, which then appeared in none of the ten looks — the capsule
// composition prompt forbids accessories, so a bench that offers one is
// offering a guaranteed dead slot. The deterministic selector never picked
// accessories; only the bench's rank-fill did.
test('the capsule bench never offers a piece the composer cannot use', () => {
  const pool = [
    { id: 1, name: 'white tee', category: 'top', colors: ['white'], occasions: ['casual'] },
    { id: 2, name: 'black tee', category: 'top', colors: ['black'], occasions: ['casual'] },
    { id: 3, name: 'tan shorts', category: 'bottom', colors: ['tan'], occasions: ['casual'] },
    { id: 4, name: 'olive shorts', category: 'bottom', colors: ['olive'], occasions: ['casual'] },
    { id: 5, name: 'white sneakers', category: 'shoes', colors: ['white'], occasions: ['casual'] },
    { id: 6, name: 'pendant necklace', category: 'accessory', colors: ['silver'], occasions: ['casual'] },
    { id: 7, name: 'leather belt', category: 'accessory', colors: ['brown'], occasions: ['casual'] },
  ]
  const slots = [{ id: 'home', label: 'At Home', occasion: 'casual', bestFor: 'home', targetOutfits: 2 }]

  // benchSize deliberately larger than the pool, so the rank-fill loop would
  // admit every remaining piece if nothing stopped it.
  const { bench } = buildCapsuleBench(pool, { budget: 6, slots, isSummer: true, benchSize: 40 })

  assert.equal(bench.some(piece => piece.category === 'accessory'), false)
  assert.equal(bench.length, 5)
})

// docs/capsule-real-world-rules.md: published capsule frameworks allot two
// layers regardless of season and swap WHICH outerwear is active, never how
// many. The old formula evaluated to ZERO outerwear for a summer capsule at
// every budget — unsupported by any framework, and the reason the model on
// live thread_1785380251549 overrode it by taking 4.
test('a summer capsule gets the same layer allowance as a winter one', () => {
  const pool = []
  let id = 1
  const add = (n, category, extra = {}) => {
    for (let i = 0; i < n; i += 1) {
      pool.push({ id: id++, name: `${category} ${i}`, category, colors: ['black'], occasions: ['casual', 'city', 'smart-casual'], ...extra })
    }
  }
  add(20, 'top'); add(20, 'bottom'); add(4, 'dress'); add(8, 'outerwear'); add(10, 'shoes')
  const slots = [
    { id: 'home', label: 'At Home', occasion: 'casual', bestFor: 'home', targetOutfits: 3 },
    { id: 'city', label: 'City', occasion: 'city', bestFor: 'city', targetOutfits: 3 },
  ]
  const countOuterwear = roster => roster.filter(piece => piece.category === 'outerwear').length

  const summer = selectCapsuleRoster(pool, { budget: 24, isSummer: true, isWinter: false, occasions: ['casual', 'city'], slots })
  const winter = selectCapsuleRoster(pool, { budget: 24, isSummer: false, isWinter: true, occasions: ['casual', 'city'], slots })

  assert.equal(countOuterwear(summer), 2)
  // Winter's allowance is unchanged by the fix — it was already the right number.
  assert.equal(countOuterwear(winter), 2)
})

// Every post-condition used to be a floor, so nothing noticed a roster
// overspending a category. 4 outerwear against a quota of 2 cost 18 outfit
// cores on the live run.
test('a roster may depart from the example layer allocation when its jobs justify it', () => {
  const mk = (id, category, extra = {}) => ({ id, name: `${category} ${id}`, category, colors: ['black'], occasions: ['casual'], ...extra })
  const slots = [{ id: 'home', label: 'At Home', occasion: 'casual', bestFor: 'home', targetOutfits: 2 }]
  const base = [
    ...Array.from({ length: 9 }, (_, i) => mk(100 + i, 'top')),
    ...Array.from({ length: 8 }, (_, i) => mk(200 + i, 'bottom')),
    mk(300, 'dress'),
    ...Array.from({ length: 4 }, (_, i) => mk(400 + i, 'shoes')),
  ]

  const withinQuota = [...base.slice(0, 18), mk(500, 'outerwear'), mk(501, 'outerwear')]
  const overQuota = [...base.slice(0, 16), mk(500, 'outerwear'), mk(501, 'outerwear'), mk(502, 'outerwear'), mk(503, 'outerwear')]

  const ceilingFailures = roster => validateCapsuleRoster(roster, { slots, budget: 24, isSummer: true, isWinterCapsule: false })
    .failures.filter(failure => failure.code === 'category_ceiling:outerwear')

  assert.equal(ceilingFailures(withinQuota).length, 0)
  assert.equal(ceilingFailures(overQuota).length, 0)
})

// ---------------------------------------------------------------------------
// Step 5 V1 correction (docs/capsule-step5-evaluation.md §5), from live
// thread_1785448241452. Each test below is one of the accepted behavioural
// criteria in §3, made permanent so the next refactor cannot silently regress
// it. The deterministic roster path is unchanged throughout — proved directly
// by the third test.
// ---------------------------------------------------------------------------

// Criterion 1. The ceiling above stopped a model roster overspending the layer
// allowance; the live run then UNDERSPENT it, and because the budget is exact,
// the freed slot went into a fifth pair of shoes that earned no demonstrated
// formula. The researched allocation is season-invariant
// (docs/capsule-real-world-rules.md), so it is now a floor as well.
const layerTradeWardrobe = () => {
  const pool = []
  let id = 1
  const add = (n, category, extra = {}) => {
    for (let i = 0; i < n; i += 1) {
      pool.push({ id: id++, name: `${category} ${i}`, category, colors: ['black'], formality: 'everyday', occasions: ['casual', 'city'], ...extra })
    }
  }
  add(14, 'top'); add(12, 'bottom'); add(4, 'dress'); add(4, 'outerwear'); add(10, 'shoes')
  return pool
}

test('a model roster may depart from layer and shoe starting counts with real jobs', async () => {
  const pool = layerTradeWardrobe()
  const slots = normalizePlanSlots([
    { label: 'At Home', occasion: 'casual', count: 3 },
    { label: 'City Outing', occasion: 'city', count: 3 },
  ])
  const seenFailures = []
  await selectCapsuleRosterViaModel({
    pool, budget: 24, slots, isSummer: true, occasions: ['casual', 'city'],
    chooseRoster: async ({ bench, failures }) => {
      seenFailures.push(failures.map(entry => entry.code))
      const of = group => bench.filter(piece => piece.category === group)
      // Exactly the live shape: one layer instead of two, and the freed slot
      // spent on a fifth shoe.
      const roster = [
        ...of('top').slice(0, 8),
        ...of('bottom').slice(0, 7),
        ...of('dress').slice(0, 3),
        ...of('outerwear').slice(0, 1),
        ...of('shoes').slice(0, 5),
      ]
      assert.ok(of('outerwear').length >= 2, `sanity: the bench must supply the second layer, got ${of('outerwear').length}`)
      assert.equal(roster.length, 24, 'sanity: the trade keeps the budget exact, which is why nothing noticed it')
      return { roster_piece_ids: roster.map(piece => Number(piece.id)), palette: 'black', piece_jobs: [] }
    }
  })

  assert.deepEqual(seenFailures[0], [], 'the first attempt is not told about failures that have not happened yet')
  assert.equal(seenFailures.length, 1, 'category guidance alone must not spend a repair call')
})

test('model roster bookkeeping cannot discard an otherwise valid paid selection', async () => {
  const pool = layerTradeWardrobe()
  pool[0].pattern_complexity = 'loud'
  const slots = normalizePlanSlots([{ label: 'At Home', occasion: 'casual', count: 3 }])
  const seenFailures = []
  const result = await selectCapsuleRosterViaModel({
    pool, budget: 24, slots, isSummer: true, occasions: ['casual'],
    chooseRoster: async ({ bench, failures }) => {
      seenFailures.push(failures.map(entry => entry.code))
      const of = group => bench.filter(piece => piece.category === group)
      const roster = [
        ...of('top').slice(0, 8), ...of('bottom').slice(0, 6), ...of('dress').slice(0, 3),
        ...of('outerwear').slice(0, 2), ...of('shoes').slice(0, 5)
      ]
      return {
        roster_piece_ids: roster.map(piece => Number(piece.id)),
        palette: 'black', category_shape_reason: 'Followed exactly.',
        // This is the exact live failure: the prose/schema claimed the target
        // while the IDs actually contained one fewer bottom and one extra shoe.
        category_counts: { top: 8, bottom: 7, dress: 3, outerwear: 2, shoes: 4 },
        category_departures: [], repair_changes: [],
        piece_jobs: roster.slice(0, 23).map(piece => ({ piece_id: Number(piece.id), job: 'distinct job' }))
      }
    }
  })
  assert.equal(result.source, 'model')
  assert.equal(seenFailures.length, 1, 'bookkeeping defects must not spend a repair call')
  assert.deepEqual(seenFailures[0], [])
})

test('an accurately counted and explained target departure remains valid', async () => {
  const pool = layerTradeWardrobe()
  pool[0].pattern_complexity = 'loud'
  const slots = normalizePlanSlots([{ label: 'At Home', occasion: 'casual', count: 3 }])
  const result = await selectCapsuleRosterViaModel({
    pool, budget: 24, slots, isSummer: true, occasions: ['casual'],
    chooseRoster: async ({ bench }) => {
      const of = group => bench.filter(piece => piece.category === group)
      const roster = [
        ...of('top').slice(0, 8), ...of('bottom').slice(0, 6), ...of('dress').slice(0, 3),
        ...of('outerwear').slice(0, 2), ...of('shoes').slice(0, 5)
      ]
      return {
        roster_piece_ids: roster.map(piece => Number(piece.id)),
        palette: 'black', category_shape_reason: 'One bottom slot moved to shoes for the stated use cases.',
        category_counts: { top: 8, bottom: 6, dress: 3, outerwear: 2, shoes: 5 },
        category_departures: [
          { category: 'bottom', target_count: 7, selected_count: 6, reason: 'Six bottoms cover the requested casual rotation.' },
          { category: 'shoes', target_count: 4, selected_count: 5, reason: 'A fifth pair serves a distinct required activity.' }
        ],
        repair_changes: [],
        piece_jobs: roster.map(piece => ({ piece_id: Number(piece.id), job: `distinct job for ${piece.name}` }))
      }
    }
  })
  assert.equal(result.source, 'model')
})

test('layer count alone never creates a repair failure', () => {
  const pool = layerTradeWardrobe()
  const slots = normalizePlanSlots([{ label: 'At Home', occasion: 'casual', count: 3 }])
  const byCategory = group => pool.filter(piece => piece.category === group)
  const oneLayer = [
    ...byCategory('top').slice(0, 8),
    ...byCategory('bottom').slice(0, 7),
    ...byCategory('dress').slice(0, 3),
    ...byCategory('outerwear').slice(0, 1),
    ...byCategory('shoes').slice(0, 5),
  ]
  const twoLayers = [...oneLayer.slice(0, 23), byCategory('outerwear')[1]]

  const floorFailures = roster => validateCapsuleRoster(roster, { slots, budget: 24, isSummer: true, pool })
    .failures.filter(failure => failure.code === 'layer_floor:outerwear')

  assert.equal(floorFailures(oneLayer).length, 0)
  assert.equal(floorFailures(twoLayers).length, 0)
})

test('a layer-count departure does not trigger repair or structural-gap disclosure', async () => {
  const pool = layerTradeWardrobe()
  const slots = normalizePlanSlots([
    { label: 'At Home', occasion: 'casual', count: 3 },
    { label: 'City Outing', occasion: 'city', count: 3 },
  ])
  const attempts = []
  const bumped = []
  const result = await selectCapsuleRosterViaModel({
    pool, budget: 24, slots, isSummer: true, occasions: ['casual', 'city'],
    onDiagnostic: field => bumped.push(field),
    chooseRoster: async ({ bench, attempt, failures }) => {
      attempts.push(failures.map(entry => entry.code))
      const of = group => bench.filter(piece => piece.category === group)
      // One layer and five shoes: a deliberate departure from the example.
      const roster = [
        ...of('top').slice(0, 8),
        ...of('bottom').slice(0, 7),
        ...of('dress').slice(0, 3),
        ...of('outerwear').slice(0, 1),
        ...of('shoes').slice(0, 5),
      ]
      return { roster_piece_ids: roster.map(piece => Number(piece.id)), palette: 'black', piece_jobs: [] }
    }
  })

  assert.equal(attempts.length, 1)
  assert.equal(result.source, 'model')
  assert.equal(result.roster.length, 24, "the model's own selection ships")
  assert.equal(bumped.includes('capsuleRosterModelFallbacks'), false, 'category shape alone must not spend the fallback')

  assert.equal(result.coverageGaps.some(line => /structural guarantees/.test(line)), false)
})

test('a structural failure still falls back, and the fallback is no longer silent', async () => {
  const pool = paletteTestWardrobe()
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  const bumped = []
  const result = await selectCapsuleRosterViaModel({
    pool, budget: 10, slots, isSummer: true, occasions: ['casual'],
    onDiagnostic: field => bumped.push(field),
    chooseRoster: async ({ bench }) => {
      const tops = bench.filter(piece => piece.category === 'top').map(piece => Number(piece.id))
      return { roster_piece_ids: tops.slice(0, 10), palette: '', piece_jobs: [] }
    }
  })

  assert.equal(result.source, 'deterministic_fallback')
  assert.ok(bumped.includes('capsuleRosterModelFallbacks'))
  const disclosure = result.coverageGaps.find(line => /^\[capsule fallback:/.test(line))
  assert.ok(disclosure, `the fallback must disclose itself, got ${JSON.stringify(result.coverageGaps)}`)
  assert.match(disclosure, /backup capsule selection/)
  assert.doesNotMatch(disclosure, /IDs?\b|category_|reported|actual/i)
})

test('the codes behind a rejection are recorded across both attempts', async () => {
  const pool = paletteTestWardrobe()
  const slots = normalizePlanSlots([{ label: 'Everyday', occasion: 'casual', count: 2 }])
  const result = await selectCapsuleRosterViaModel({
    pool, budget: 10, slots, isSummer: true, occasions: ['casual'],
    chooseRoster: async ({ bench, attempt }) => {
      // A different defect each round, so the record has to accumulate.
      if (attempt === 1) return { roster_piece_ids: [999999], palette: '', piece_jobs: [] }
      const tops = bench.filter(piece => piece.category === 'top').map(piece => Number(piece.id))
      return { roster_piece_ids: tops.slice(0, 10), palette: '', piece_jobs: [] }
    }
  })

  assert.ok(result.failureCodes.includes('piece_outside_bench'), `got ${JSON.stringify(result.failureCodes)}`)
  assert.ok(result.failureCodes.length > 1, 'the second round\'s codes are recorded too')
  // A clean run records nothing, so the column stays empty for the normal case.
  const clean = await selectCapsuleRosterViaModel({
    pool, budget: 10, slots, isSummer: true, occasions: ['casual'],
    chooseRoster: async ({ bench }) => ({ roster_piece_ids: bench.slice(0, 10).map(piece => Number(piece.id)), palette: 'black', piece_jobs: [] })
  })
  assert.deepEqual(clean.failureCodes, [])
})

test('no universal layer floor is declared for either roster path', () => {
  const thin = layerTradeWardrobe().filter(piece => piece.category !== 'outerwear')
  const slots = normalizePlanSlots([{ label: 'At Home', occasion: 'casual', count: 3 }])
  const args = { budget: 24, isSummer: true, isWinter: false, occasions: ['casual'], slots }

  const roster = selectCapsuleRoster(thin, args)
  assert.deepEqual(
    (roster.postConditionGaps || []).filter(code => code === 'layer_floor:outerwear'),
    [],
    'a validator-owned guarantee must never become a deterministic unmet-guarantee record'
  )

  // And the enforcer ignores it even when handed the declaration directly.
  const conditions = capsuleRosterPostConditions({
    quotas: { top: 8, bottom: 7, dress: 3, outerwear: 2, shoes: 4 },
    roster: []
  })
  assert.ok(!conditions.some(condition => condition.code === 'layer_floor:outerwear'))
  const groups = { top: thin.filter(piece => piece.category === 'top'), outerwear: [] }
  const enforced = enforceCapsulePostConditions(groups.top.slice(0, 5), groups, conditions, new Map())
  assert.equal(
    enforced.unsatisfied.includes('layer_floor:outerwear'),
    false,
    'the enforcer must not report a condition it is not allowed to act on'
  )
})

// Criterion 3. base_for_dependent_top only proves SOME standalone top is
// somewhere in the roster. The live run selected two dependent tops and both
// demonstrations leaned on the same tank; the structural half of that — is a
// base even valid where the dependent piece is offered — is checkable for free.
const dependentBaseWardrobe = () => ([
  { id: 1, name: 'geometric crop top', category: 'top', colors: ['black'], formality: 'everyday', occasions: ['casual'], needs_base: 'yes' },
  // Standalone, but too formal to clear a casual slot's ceiling — so it exists
  // in the roster and is unusable in the slot the dependent piece is offered in.
  { id: 2, name: 'silk evening blouse', category: 'top', colors: ['ivory'], formality: 'dressy', occasions: ['casual'] },
  { id: 3, name: 'straight jeans', category: 'bottom', colors: ['black'], formality: 'everyday', occasions: ['casual'] },
  { id: 4, name: 'canvas sneakers', category: 'shoes', colors: ['white'], formality: 'everyday', occasions: ['casual'] },
])

test('a dependent top needs a standalone base valid in the slot that offers it, not merely somewhere in the roster', () => {
  const roster = dependentBaseWardrobe()
  const availableBase = { id: 5, name: 'cotton tank', category: 'top', colors: ['orange'], formality: 'everyday', occasions: ['casual'] }
  const slots = normalizePlanSlots([{ label: 'At Home', occasion: 'casual', count: 2 }])

  // The roster-level guarantee is satisfied — piece 2 can be worn alone — which
  // is precisely the loophole.
  const rosterLevel = capsuleRosterPostConditions({ quotas: { top: 2 }, roster })
    .find(condition => condition.code === 'base_for_dependent_top')
  assert.ok(rosterLevel, 'sanity: the roster-level condition still applies')
  assert.equal(roster.filter(piece => rosterLevel.predicate(piece) && piece.category === 'top').length >= 1, true)

  const result = validateCapsuleRoster(roster, { slots, budget: 24, isSummer: true, pool: [...roster, availableBase] })
  const failure = result.failures.find(entry => entry.code === 'dependent_base_unavailable')
  assert.ok(failure, `expected a slot-level dependent failure, got ${JSON.stringify(result.failures)}`)
  assert.match(failure.message, /At Home/)
  assert.match(failure.message, /geometric crop top/)
  assert.match(failure.message, /cannot be worn alone/)
})

test('a slot-valid standalone base clears the dependent check', () => {
  const roster = [
    ...dependentBaseWardrobe(),
    { id: 5, name: 'cotton tank', category: 'top', colors: ['orange'], formality: 'everyday', occasions: ['casual'] },
  ]
  const slots = normalizePlanSlots([{ label: 'At Home', occasion: 'casual', count: 2 }])
  const result = validateCapsuleRoster(roster, { slots, budget: 24, isSummer: true, pool: roster })
  assert.equal(result.failures.some(entry => entry.code === 'dependent_base_unavailable'), false,
    `expected no dependent failure, got ${JSON.stringify(result.failures)}`)
})

test('a sheer or open-weave top in the same slot does not clear the slot-level dependent check', () => {
  const roster = [
    ...dependentBaseWardrobe(),
    { id: 5, name: 'sheer chiffon cami', category: 'top', colors: ['ivory'], formality: 'everyday', occasions: ['casual'], opacity: 'sheer' },
  ]
  const slots = normalizePlanSlots([{ label: 'At Home', occasion: 'casual', count: 2 }])
  // The supply-attribution guard needs a genuinely available base OUTSIDE the
  // roster to blame the roster at all — same pattern as "a dependent top
  // needs a standalone base valid in the slot..." above. Without one, "the
  // sheer top in the roster doesn't count" and "the wardrobe simply has
  // nothing better" are indistinguishable, and correctly not failed.
  const availableBase = { id: 6, name: 'cotton tank', category: 'top', colors: ['orange'], formality: 'everyday', occasions: ['casual'] }
  const result = validateCapsuleRoster(roster, { slots, budget: 24, isSummer: true, pool: [...roster, availableBase] })
  assert.ok(
    result.failures.some(entry => entry.code === 'dependent_base_unavailable'),
    `a sheer top must not clear the dependent check, got ${JSON.stringify(result.failures)}`
  )
})

test('the dependent check blames the roster only when the wardrobe could have done better', () => {
  const roster = dependentBaseWardrobe()
  const slots = normalizePlanSlots([{ label: 'At Home', occasion: 'casual', count: 2 }])
  // Nothing unused in the pool can be worn alone in this slot either: a supply
  // gap, unrepairable by any swap, so not a roster defect.
  const result = validateCapsuleRoster(roster, {
    slots, budget: 24, isSummer: true,
    pool: [...roster, { id: 6, name: 'second evening blouse', category: 'top', colors: ['navy'], formality: 'dressy', occasions: ['casual'] }]
  })
  assert.equal(result.failures.some(entry => entry.code === 'dependent_base_unavailable'), false,
    `a supply gap is not a roster defect, got ${JSON.stringify(result.failures)}`)
})

test('an unpopulated needs_base field changes nothing', () => {
  const roster = dependentBaseWardrobe().map(({ needs_base, ...piece }) => piece)
  const slots = normalizePlanSlots([{ label: 'At Home', occasion: 'casual', count: 2 }])
  const result = validateCapsuleRoster(roster, { slots, budget: 24, isSummer: true, pool: roster })
  assert.equal(result.failures.some(entry => entry.code === 'dependent_base_unavailable'), false)
  assert.equal(
    capsuleRosterPostConditions({ quotas: { top: 2 }, roster }).some(condition => condition.code === 'base_for_dependent_top'),
    false,
    'the roster-level condition is not even declared without a dependent piece'
  )
})

// ---------------------------------------------------------------------------
// Step 5 V1 follow-up (owner review 2026-07-30, prompted by thread_1785451253837's
// "black geometric tassel hem crop top + wide leg trousers" card and the
// owner's "a dependent piece is not a standalone capsule piece" ruling). Three
// structural gaps the earlier correction did not close: capacity math counted
// a dependent top's core without requiring its base to coexist; a "top"
// register floor could be satisfied entirely by dependents; and no check
// existed at the OUTFIT level preventing a needs_base piece from shipping
// without a base at all. All three are additive/no-op absent a needs_base
// piece — this wardrobe has exactly two.
// ---------------------------------------------------------------------------

// Point 7: "a valid dependent-top core is not crochet top + bottom + shoes —
// it is compatible base + crochet top + bottom + shoes." capsuleOutfitCoreCapacity
// is what every capacity number in this feature is built from.
test('capsule core capacity requires a standalone base to coexist with a dependent top', () => {
  const dependentTop = { id: 1, category: 'top', needs_base: 'yes' }
  const standaloneTop = { id: 2, category: 'top' }
  const bottom = { id: 3, category: 'bottom' }
  const shoe = { id: 4, category: 'shoes' }

  // No standalone base in this slot: the dependent top cannot produce a
  // wearable core, so capacity is zero, not one.
  const noBaseRoster = [dependentTop, bottom, shoe]
  const noBaseSlots = [{ gateAllowedIds: new Set([1, 3, 4]) }]
  assert.equal(capsuleOutfitCoreCapacity(noBaseRoster, noBaseSlots), 0,
    'a dependent top with no base in its own slot must not count as a core')

  // A standalone base is present in the SAME slot: both the dependent-top
  // core and the standalone-top's own core are now real.
  const withBaseRoster = [dependentTop, standaloneTop, bottom, shoe]
  const withBaseSlots = [{ gateAllowedIds: new Set([1, 2, 3, 4]) }]
  assert.equal(capsuleOutfitCoreCapacity(withBaseRoster, withBaseSlots), 2,
    'once a base coexists in the slot, both the dependent and the standalone top form valid cores')
})

test('capsule core capacity is unaffected when no piece is a dependent', () => {
  const roster = [
    { id: 1, category: 'top' }, { id: 2, category: 'top' },
    { id: 3, category: 'bottom' }, { id: 4, category: 'shoes' },
  ]
  const slots = [{ gateAllowedIds: new Set([1, 2, 3, 4]) }]
  assert.equal(capsuleOutfitCoreCapacity(roster, slots), 2, 'ordinary capacity math is a strict no-op')
})

// Owner review 2026-07-30: "the prompt already says open-weave or sheer
// pieces cannot serve as standalone bases" — the shared base-candidate
// predicate must read structured opacity, not just needs_base, or a sheer
// top could "support" a dependent it cannot actually cover.
// Opacity gates only whether a top can serve as a BASE for something else —
// not whether it is wearable as its own outfit's top. A sheer top that is
// not itself tagged needs_base still forms its own core; what it cannot do
// is rescue a DIFFERENT dependent top's core. These are separate questions,
// caught by this test after an earlier version conflated them (a sheer top
// briefly lost its own core-forming ability along with its base eligibility).
test('a sheer or open-weave top cannot serve as the base for a dependent, but still forms its own core', () => {
  const dependentTop = { id: 1, category: 'top', needs_base: 'yes' }
  const sheerTop = { id: 2, category: 'top', opacity: 'sheer' }
  const openWeaveTop = { id: 3, category: 'top', opacity: 'open_weave' }
  const bottom = { id: 4, category: 'bottom' }
  const shoe = { id: 5, category: 'shoes' }

  const withSheerOnly = [dependentTop, sheerTop, bottom, shoe]
  assert.equal(
    capsuleOutfitCoreCapacity(withSheerOnly, [{ gateAllowedIds: new Set([1, 2, 4, 5]) }]),
    1,
    'the sheer top forms its own core; the dependent contributes zero because a sheer top cannot rescue it'
  )
  const withOpenWeaveOnly = [dependentTop, openWeaveTop, bottom, shoe]
  assert.equal(
    capsuleOutfitCoreCapacity(withOpenWeaveOnly, [{ gateAllowedIds: new Set([1, 3, 4, 5]) }]),
    1,
    'open-weave is the same case — visible holes cannot function as coverage for the dependent'
  )
})

test('unpopulated opacity leaves a top eligible as a base — a strict no-op for the 206 of 243 unset pieces on the live wardrobe', () => {
  const dependentTop = { id: 1, category: 'top', needs_base: 'yes' }
  const unknownOpacityTop = { id: 2, category: 'top' } // no opacity field at all
  const bottom = { id: 3, category: 'bottom' }
  const shoe = { id: 4, category: 'shoes' }
  const roster = [dependentTop, unknownOpacityTop, bottom, shoe]
  assert.equal(
    capsuleOutfitCoreCapacity(roster, [{ gateAllowedIds: new Set([1, 2, 3, 4]) }]),
    2,
    'unset opacity is not evidence of unsuitability — both tops must form cores'
  )
})

// Point 2: "standalone top capacity vs. dependent top capacity should be
// counted separately." register_reserve and winter_covered_bases both assert
// that many INDEPENDENTLY wearable tops exist; a dependent cannot satisfy
// either on its own, or the guarantee passes on paper with no real capacity
// behind it.
// Revised 2026-07-30 after owner review of the first version's
// overcorrection: making a needs_base piece fail every group:'top' condition
// UNCONDITIONALLY swapped out expressive dependent pieces even when their
// base was genuinely present and usable (piece 258 in the recorded ranking
// A/B). The correct rule is "a dependent cannot satisfy the guarantee BY
// ITSELF" — a SUPPORTED dependent (a standalone base coexists in the same
// pool) represents real dependent-top capacity and should count.
test('an unsupported dependent does not count toward a register floor', () => {
  const dependentA = { id: 1, category: 'top', needs_base: 'yes', formality: 'elevated' }
  const dependentB = { id: 2, category: 'top', needs_base: 'yes', formality: 'elevated' }
  const conditions = capsuleRosterPostConditions({
    quotas: { top: 3 },
    reserve: { rank: formalityRank('elevated'), byGroup: { top: 2 } },
  })
  const registerCondition = conditions.find(condition => condition.code === 'register_reserve:top')
  assert.ok(registerCondition, 'sanity: the register_reserve condition must be declared')

  // No standalone base anywhere in this pool: neither dependent has support.
  const unsupportedPool = [dependentA, dependentB]
  assert.equal(capsuleConditionMatches(dependentA, registerCondition, unsupportedPool), false)
  assert.equal(capsuleConditionMatches(dependentB, registerCondition, unsupportedPool), false)
})

test('a supported dependent counts as real dependent-top capacity toward a register floor', () => {
  // A geometric hero top with a suitable tank is exactly this case: the
  // dependent clears the register floor, and a standalone base is present.
  // "Clears the ceiling" means at-or-under it (FORMALITY_VALUES:
  // lounge < everyday < elevated < dressy), so the base is deliberately
  // 'dressy' here — a rank the elevated ceiling itself does NOT clear —
  // to prove this is about the base's mere PRESENCE, not double-counting it
  // as if it also satisfied the register.
  const dependent = { id: 1, category: 'top', needs_base: 'yes', formality: 'elevated' }
  const base = { id: 2, category: 'top', formality: 'dressy' }
  const conditions = capsuleRosterPostConditions({
    quotas: { top: 3 },
    reserve: { rank: formalityRank('elevated'), byGroup: { top: 1 } },
  })
  const registerCondition = conditions.find(condition => condition.code === 'register_reserve:top')
  const supportedPool = [dependent, base]
  assert.equal(capsuleConditionMatches(dependent, registerCondition, supportedPool), true,
    'a dependent with a standalone base in the same pool is real capacity, not fiction')
  assert.equal(capsuleConditionMatches(base, registerCondition, supportedPool), false,
    "the base itself, being dressy, does not clear the elevated ceiling — only the dependent's own formality does")
})

test('standalone and dependent capacity remain distinguishable end to end through the repair', () => {
  const dependentA = { id: 1, category: 'top', needs_base: 'yes', formality: 'elevated' }
  const dependentB = { id: 2, category: 'top', needs_base: 'yes', formality: 'elevated' }
  const standalone = { id: 3, category: 'top', formality: 'elevated' }
  const conditions = capsuleRosterPostConditions({
    quotas: { top: 3 },
    reserve: { rank: formalityRank('elevated'), byGroup: { top: 2 } },
  })
  const registerCondition = conditions.find(condition => condition.code === 'register_reserve:top')

  // No standalone base at all: unsupported, unrepairable by adding more
  // dependents — the repair must swap toward a standalone alternative.
  const standalone2 = { id: 6, category: 'top', formality: 'elevated' }
  const bottomPiece = { id: 4, category: 'bottom' }
  const shoePiece = { id: 5, category: 'shoes' }
  const groups = { top: [dependentA, dependentB, standalone, standalone2], bottom: [bottomPiece], shoes: [shoePiece] }
  const roster = [dependentA, dependentB, bottomPiece, shoePiece]
  const { roster: repaired, unsatisfied } = enforceCapsulePostConditions(roster, groups, conditions, new Map())
  assert.equal(unsatisfied.includes('register_reserve:top'), false, 'the repair must be able to satisfy this guarantee')
  const clearingCount = repaired.filter(piece => capsuleConditionMatches(piece, registerCondition, repaired)).length
  assert.ok(clearingCount >= 2, `expected a standalone top to be swapped in, got ${JSON.stringify(repaired.map(p => p.id))}`)

  // Contrast: give the SAME starting roster one standalone base already
  // present. Now both dependents are supported and the reserve is already
  // satisfied — the repair must leave the roster untouched (byte-identical,
  // per the function's own contract), not swap out an expressive dependent
  // it no longer needs to.
  const supportedRoster = [dependentA, dependentB, standalone, bottomPiece, shoePiece]
  const supportedGroups = { top: [dependentA, dependentB, standalone, standalone2], bottom: [bottomPiece], shoes: [shoePiece] }
  const { roster: untouched, unsatisfied: stillUnsatisfied } = enforceCapsulePostConditions(supportedRoster, supportedGroups, conditions, new Map())
  assert.deepEqual(untouched, supportedRoster, 'a roster that already satisfies the guarantee via supported dependents must not be touched')
  assert.equal(stillUnsatisfied.includes('register_reserve:top'), false)
})

test('base_for_dependent_top is exempt from the standalone-only rule — it IS the dependent-base guarantee', () => {
  const dependent = { id: 1, category: 'top', needs_base: 'yes' }
  const conditions = capsuleRosterPostConditions({ quotas: { top: 2 }, roster: [dependent] })
  const baseCondition = conditions.find(condition => condition.code === 'base_for_dependent_top')
  assert.ok(baseCondition)
  // Its own job is finding a piece that is NOT a dependent — confirm the
  // wrap did not double up or invert that.
  assert.equal(baseCondition.predicate({ id: 2, category: 'top' }), true)
  assert.equal(baseCondition.predicate(dependent), false)
})

test('a generic winter label does not impose a fixed sleeve-covered-top ratio', () => {
  const conditions = capsuleRosterPostConditions({ quotas: { top: 4 }, isWinter: true })
  const coveredCondition = conditions.find(condition => condition.code === 'winter_covered_bases')
  assert.equal(coveredCondition, undefined)
})

// Point 5: "it should never present the crochet top as if it were a
// standalone top." Nothing checked, at the OUTFIT level, that a needs_base
// piece actually shipped with a base underneath it — only that a standalone
// base existed somewhere in the roster or slot. Shared validator, so this
// also protects a trip/coordinated plan that happens to include one.
test('a submitted outfit cannot ship a dependent top without a standalone base', async () => {
  db.prepare('DELETE FROM pieces').run()
  const dependentId = insertPiece({ category: 'top', name: 'geometric tassel top', occasions: ['casual'], formality: 'everyday' })
  db.prepare('UPDATE pieces SET needs_base = ? WHERE id = ?').run('yes', dependentId)
  const baseId = insertPiece({ category: 'top', name: 'orange ribbed tank', occasions: ['casual'], formality: 'everyday' })
  db.prepare('UPDATE pieces SET opacity = ?, fit_on_body = ? WHERE id = ?').run('opaque', 'skims', baseId)
  const bottomId = insertPiece({ category: 'bottom', name: 'wide leg trousers', occasions: ['casual'], formality: 'everyday' })
  const shoesId = insertPiece({ category: 'shoes', name: 'canvas slip shoes', occasions: ['casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'City Day', occasion: 'casual', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day' })
  const slot = workbench.pendingPlan.slots[0]

  // Solo: the dependent top with a bottom and shoes, no base at all.
  const solo = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(dependentId), Number(bottomId), Number(shoesId)],
  }])
  assert.equal(solo.accepted.length, 0)
  assert.match(solo.failures[0].reasons.join(' '), /cannot be worn alone/)
  assert.match(solo.failures[0].reasons.join(' '), /geometric tassel top/)

  // With its base: accepted normally.
  const layered = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(dependentId), Number(baseId), Number(bottomId), Number(shoesId)],
  }])
  assert.equal(layered.accepted.length, 1, `expected acceptance, got ${JSON.stringify(layered.failures)}`)
})

test('a submitted outfit cannot use a sheer top as the dependent\'s base', async () => {
  db.prepare('DELETE FROM pieces').run()
  const dependentId = insertPiece({ category: 'top', name: 'geometric tassel top', occasions: ['casual'], formality: 'everyday' })
  db.prepare('UPDATE pieces SET needs_base = ? WHERE id = ?').run('yes', dependentId)
  const sheerBaseId = insertPiece({ category: 'top', name: 'sheer chiffon cami', occasions: ['casual'], formality: 'everyday' })
  db.prepare('UPDATE pieces SET opacity = ? WHERE id = ?').run('sheer', sheerBaseId)
  const bottomId = insertPiece({ category: 'bottom', name: 'wide leg trousers', occasions: ['casual'], formality: 'everyday' })
  const shoesId = insertPiece({ category: 'shoes', name: 'canvas slip shoes', occasions: ['casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'City Day', occasion: 'casual', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day' })
  const slot = workbench.pendingPlan.slots[0]

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: slot.id,
    piece_ids: [Number(dependentId), Number(sheerBaseId), Number(bottomId), Number(shoesId)],
  }])
  assert.equal(result.accepted.length, 0)
  assert.match(result.failures[0].reasons.join(' '), /cannot provide the required coverage/)
})

test('a submitted outfit cannot use a known loose top as the dependent\'s required base layer', async () => {
  db.prepare('DELETE FROM pieces').run()
  const dependentId = insertPiece({ category: 'top', name: 'open crochet top', occasions: ['casual'], formality: 'everyday' })
  db.prepare('UPDATE pieces SET needs_base = ? WHERE id = ?').run('yes', dependentId)
  const looseBaseId = insertPiece({ category: 'top', name: 'draped blouse', occasions: ['casual'], formality: 'everyday' })
  db.prepare('UPDATE pieces SET opacity = ?, fit_on_body = ? WHERE id = ?').run('opaque', 'drapes', looseBaseId)
  const bottomId = insertPiece({ category: 'bottom', name: 'wide leg trousers', occasions: ['casual'], formality: 'everyday' })
  const shoesId = insertPiece({ category: 'shoes', name: 'canvas slip shoes', occasions: ['casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const workbench = await buildPlanSlotWorkbench(
    normalizePlanSlots([{ label: 'City Day', occasion: 'casual', activity: 'none', count: 1 }]),
    { allPieces, question: 'city day' },
  )

  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: workbench.pendingPlan.slots[0].id,
    piece_ids: [Number(dependentId), Number(looseBaseId), Number(bottomId), Number(shoesId)],
  }], { visuallySeenPieceIds: new Set([dependentId, looseBaseId]) })
  assert.equal(result.accepted.length, 0)
  assert.match(result.failures[0].reasons.join(' '), /rather than close-fitting/)
})

test('missing base-layer fit or opacity requires sight, then remains model-judged', async () => {
  db.prepare('DELETE FROM pieces').run()
  const dependentId = insertPiece({ category: 'top', name: 'open crochet top', occasions: ['casual'], formality: 'everyday' })
  db.prepare('UPDATE pieces SET needs_base = ? WHERE id = ?').run('yes', dependentId)
  const unknownBaseId = insertPiece({ category: 'top', name: 'legacy tank', occasions: ['casual'], formality: 'everyday' })
  const bottomId = insertPiece({ category: 'bottom', name: 'wide leg trousers', occasions: ['casual'], formality: 'everyday' })
  const shoesId = insertPiece({ category: 'shoes', name: 'canvas slip shoes', occasions: ['casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const workbench = await buildPlanSlotWorkbench(
    normalizePlanSlots([{ label: 'City Day', occasion: 'casual', activity: 'none', count: 1 }]),
    { allPieces, question: 'city day' },
  )
  const submission = [{
    slot_id: workbench.pendingPlan.slots[0].id,
    piece_ids: [Number(dependentId), Number(unknownBaseId), Number(bottomId), Number(shoesId)],
  }]

  const unseen = validateSubmittedPlanOutfits(workbench.pendingPlan, submission)
  assert.equal(unseen.accepted.length, 0)
  assert.match(unseen.failures[0].reasons.join(' '), /incomplete fit or opacity data/)
  assert.match(unseen.failures[0].reasons.join(' '), /view_pieces/)

  const seen = validateSubmittedPlanOutfits(workbench.pendingPlan, submission, {
    visuallySeenPieceIds: new Set([dependentId, unknownBaseId]),
  })
  assert.equal(seen.accepted.length, 1, `sight-backed unknown should remain model-judged: ${JSON.stringify(seen.failures)}`)
})

test('a standalone-only outfit is unaffected by the dependent-base check', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'plain tee', occasions: ['casual'], formality: 'everyday' })
  const bottomId = insertPiece({ category: 'bottom', name: 'jeans', occasions: ['casual'], formality: 'everyday' })
  const shoesId = insertPiece({ category: 'shoes', name: 'sneakers', occasions: ['casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'City Day', occasion: 'casual', activity: 'none', count: 1 }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day' })
  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: workbench.pendingPlan.slots[0].id,
    piece_ids: [Number(topId), Number(bottomId), Number(shoesId)],
  }])
  assert.equal(result.accepted.length, 1, `expected acceptance, got ${JSON.stringify(result.failures)}`)
})

// Criterion 3 (structural) is deterministic; criteria 5-7 are not. The
// evaluation is explicit that hero balance, seasonal shoe credibility and
// "does this piece earn a distinct job" are relational visual judgments that
// belong in the brief, never in a keyword rule or a numeric taste score.
test('the roster-selection brief asks for the four judgments and the ratified palette contract', () => {
  const brief = capsuleRosterSelectionSystemPrompt()
  assert.match(brief, /pieces that lead, pieces that support them, and pieces that ground/)
  assert.match(brief, /more than one visually distinct option that can lead a look/)
  assert.match(brief, /INDEPENDENT WEARABILITY/)
  assert.match(brief, /costs two places to produce one look/)
  assert.match(brief, /passing the engine's gates only means it is technically eligible/)
  assert.match(brief, /A DISTINCT JOB PER PIECE/)

  assert.match(brief, /neutral foundation is automatic/i)
  assert.match(brief, /Aim for about 70%/)
  assert.match(brief, /60–75% accepted/)
  assert.match(brief, /Do not substitute an unrelated accent colour/)
  assert.doesNotMatch(brief, /at least (two|three|2|3) statement/i)
})

// Owner ruling 2026-07-30, reassessing thread_1785467959899: "different bases
// alone does not [justify a dependent's two-slot cost]." A needs_base piece is
// a selection DISADVANTAGE, not merely an extra cost the model may justify —
// "a harder rule," explicitly not a ban, so it belongs in the brief (model
// judgment) and NOT as a deterministic exclusion or cap. Superseded the
// generic stylist_feedback owner_rule row (id 399, now archived) — this is
// the settled home for it.
test('the roster-selection brief states independent wearability as a settled, harder default — not a ban, not a hard filter', () => {
  const brief = capsuleRosterSelectionSystemPrompt()
  assert.match(brief, /default to independently wearable garments/)
  assert.match(brief, /clearly outweighs the flexibility lost/)
  assert.match(brief, /If a comparable standalone option exists.*choose the standalone option/)
  assert.match(brief, /not a ban/)
  // "Different bases" is necessary but not sufficient — each dependent must
  // still individually clear the bar, not be waved through by variety alone.
  assert.match(brief, /does not by itself justify either one's two-slot cost/)
  // Still model judgment: no deterministic score, cap, or exclusion smuggled
  // in. "Reject" already appears elsewhere in this brief for structural
  // validator repair (unrelated), so scope the guard to needs_base language
  // specifically rather than banning the word outright.
  assert.doesNotMatch(brief, /never (select|include|choose) (a |any )?needs_base/i)
  assert.doesNotMatch(brief, /(exclude|disqualify|reject) (a |any )?needs_base/i)
})

// Owner: "wiring getOwnerRuleNotes generically into roster selection is a
// good idea." Previously owner rules reached only composition
// (buildPlanSlotWorkbench's instructions) — the roster PICK itself never saw
// them, so a stored rule could keep an unsuitable piece out of every composed
// look while it still spent a roster slot the composer had nothing to do
// with. Threaded through selectCapsuleRosterViaModel -> chooseRoster ->
// capsuleRosterSelectionUserText, both the initial call and the repair.
// Live thread_1785711580188 and thread_1785883879348 both exhausted their
// repair round and fell back to the deterministic roster on `category_floor`,
// after selecting ZERO dresses — while the user text told them season, size,
// palette, owner rules, use cases and candidates, and nothing about category
// shape. The model was graded against a rubric it was never shown.
test('the roster-selection user text states category guidance without calling it validity', () => {
  const shared = {
    bench: layerTradeWardrobe().slice(0, 6),
    slots: [{ label: 'At Home', occasion: 'casual', bestFor: 'low-key days at home' }],
    budget: 24, palette: [], isSummer: true
  }
  const quotas = { top: 8, bottom: 7, dress: 3, outerwear: 2, shoes: 4 }
  const text = capsuleRosterSelectionUserText({ ...shared, quotas })

  assert.match(text, /CATEGORY STARTING SHAPE FOR 24 PIECES/)
  assert.match(text, /planning guidance from common capsule examples, not a validity formula/)
  assert.match(text, /top: 8 · bottom: 7 · dress: 3 · layers: 2 · shoes: 4/)
  // Placed before the candidate catalog, same reasoning as owner rules.
  assert.ok(text.indexOf('CATEGORY STARTING SHAPE') < text.indexOf('CANDIDATES:'))

  assert.doesNotMatch(text, /Layers: exactly|Dresses: at least|[Tt]ops: exactly|[Bb]ottoms: exactly|[Ss]hoes: exactly/)
  assert.match(text, /Explain every departure/)

  // Strict no-op when the caller passes no allocation.
  assert.doesNotMatch(capsuleRosterSelectionUserText(shared), /CATEGORY STARTING SHAPE/)
})

// Regression: the planner passed quotas to chooseRoster, but the production
// provider adapter used to drop them before capsuleRosterSelectionContent.
// Testing only capsuleRosterSelectionUserText left that broken final hop green.
test('the production roster content includes the category starting guidance', () => {
  const quotas = { top: 8, bottom: 7, dress: 3, outerwear: 2, shoes: 4 }
  const content = capsuleRosterSelectionContent({
    bench: layerTradeWardrobe().slice(0, 6),
    slots: [{ label: 'At Home', occasion: 'casual', bestFor: 'low-key days at home' }],
    budget: 24, palette: [], isSummer: true, quotas, imageParts: []
  })
  assert.match(content[0].text, /CATEGORY STARTING SHAPE FOR 24 PIECES/)
  assert.match(content[0].text, /top: 8 · bottom: 7 · dress: 3 · layers: 2 · shoes: 4/)
})

test('the roster brief requires an explicit category rationale and repair accounting', () => {
  const brief = capsuleRosterSelectionSystemPrompt()
  assert.match(brief, /category_shape_reason/)
  assert.match(brief, /empty repair_changes array/)
  assert.match(brief, /record every one-for-one swap/)
  assert.match(brief, /never return an unchanged rejected roster without explaining why/)
})

test('the capsule closing turn treats palette and unused-roster claims as evidence-bound facts', () => {
  assert.match(CAPSULE_PLAN_EVIDENCE_BOUNDARY, /requested colour may serve any visual role/i)
  assert.match(CAPSULE_PLAN_EVIDENCE_BOUNDARY, /never has to be a hero piece/i)
  assert.match(CAPSULE_PLAN_EVIDENCE_BOUNDARY, /not demonstrated.*never rejected, bad, or previously flagged/i)
  assert.match(CAPSULE_PLAN_EVIDENCE_BOUNDARY, /wardrobe gap only when a plan_line explicitly reports insufficient eligible supply/i)
})

// The numbers in the brief and the numbers the validator enforces have to be
// the same numbers. A brief that states an allocation the engine does not check
// is the mirror of the bug it fixes.
test('category starting guidance is not reproduced as validator floors or ceilings', () => {
  const quotas = { top: 8, bottom: 7, dress: 3, outerwear: 2, shoes: 4 }
  const conditions = capsuleRosterPostConditions({
    quotas,
    reserve: { rank: formalityRank('everyday'), looks: 6, byGroup: { top: 2, bottom: 2, dress: 1, outerwear: 1, shoes: 2 } },
    roster: []
  })
  const layerFloor = conditions.find(c => c.code === 'layer_floor:outerwear')
  const layerCeiling = conditions.find(c => c.code === 'category_ceiling:outerwear')
  const dressPresence = conditions.find(c => c.code === 'dress_presence')

  assert.equal(layerFloor, undefined)
  assert.equal(layerCeiling, undefined)
  assert.equal(dressPresence, undefined)
  assert.equal(conditions.some(c => c.code === 'register_reserve:dress'), false)
  // And nothing enforces a tops/bottoms/shoes COUNT, which is why the brief
  // presents those as targets rather than requirements.
  for (const group of ['top', 'bottom']) {
    const floor = conditions.find(c => c.code === `${group}_floor` || (c.group === group && c.required === quotas[group]))
    assert.equal(floor, undefined, `${group} must not be enforced as an exact count`)
  }
})

test('optional layers inherit neither a register reserve nor a universal count', () => {
  const quotas = { top: 8, bottom: 7, dress: 3, outerwear: 2, shoes: 4 }
  const conditions = capsuleRosterPostConditions({
    quotas,
    // Deliberately include the legacy outerwear entry: post-conditions must
    // not revive it even if an older caller constructs this reserve shape.
    reserve: { rank: formalityRank('everyday'), looks: 3, byGroup: { top: 2, bottom: 2, outerwear: 1, shoes: 2 } },
    roster: []
  })

  assert.equal(
    conditions.some(condition => condition.code === 'register_reserve:outerwear'),
    false,
    'outerwear is optional in a complete outfit, so it has no lowest-register reserve'
  )
  const layerFloor = conditions.find(condition => condition.code === 'layer_floor:outerwear')
  const layerCeiling = conditions.find(condition => condition.code === 'category_ceiling:outerwear')
  assert.equal(layerFloor, undefined)
  assert.equal(layerCeiling, undefined)
})

test('owner rules reach the roster-selection user text, placed before the candidate catalog', () => {
  const withRules = capsuleRosterSelectionUserText({
    bench: layerTradeWardrobe().slice(0, 6),
    slots: [{ label: 'At Home', occasion: 'casual', bestFor: 'low-key days at home' }],
    budget: 24, palette: [], isSummer: true,
    ownerRules: ['Yuna prefers to travel in pants, not dresses, for airplane travel days.']
  })
  assert.match(withRules, /OWNER RULES — hard requirements, not suggestions/)
  assert.match(withRules, /travel in pants, not dresses/)
  // Placed before CANDIDATES (a potentially long catalog), not after — this
  // codebase has already measured stored rules losing out from tail position.
  assert.ok(withRules.indexOf('OWNER RULES') < withRules.indexOf('CANDIDATES:'))

  // Absent ownerRules, or an empty array, is a strict no-op.
  const withoutRules = capsuleRosterSelectionUserText({
    bench: layerTradeWardrobe().slice(0, 6),
    slots: [{ label: 'At Home', occasion: 'casual', bestFor: 'low-key days at home' }],
    budget: 24, palette: [], isSummer: true
  })
  assert.doesNotMatch(withoutRules, /OWNER RULES/)
})

test('applicable accepted lessons reach roster-selection text before the candidate catalog', () => {
  const text = capsuleRosterSelectionUserText({
    bench: layerTradeWardrobe().slice(0, 6),
    slots: [{ label: 'Summer city', occasion: 'city', bestFor: 'hot city walking' }],
    budget: 24,
    isSummer: true,
    acceptedLessons: '- Do not use the named fall shoes in summer. Boundary: summer only.',
  })
  assert.match(text, /OWNER-ACCEPTED APPLICABLE LESSONS/)
  assert.match(text, /fall shoes in summer/)
  assert.ok(text.indexOf('OWNER-ACCEPTED APPLICABLE LESSONS') < text.indexOf('CANDIDATES:'))
  assert.doesNotMatch(capsuleRosterSelectionUserText({ bench: [], slots: [] }), /OWNER-ACCEPTED APPLICABLE LESSONS/)
})

test('bounded plan workbench includes accepted piece lessons only when their garment enters its pool', async () => {
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const activeId = Number(allPieces[0].id)
  const batchId = db.prepare(`INSERT INTO feedback_synthesis_batches
    (status, feedback_ids, compact_input, input_hash) VALUES ('completed', '[]', '{}', 'plan-applicability')`).run().lastInsertRowid
  db.prepare(`INSERT INTO feedback_synthesis_drafts
    (batch_id, disposition, title, proposed_text, boundary, status, payload)
    VALUES (?, 'personal_contextual_lesson', 'Candidate lesson', 'Keep this candidate lesson bounded.', 'Only for the named garment.', 'accepted', ?)`)
    .run(batchId, JSON.stringify({ applicability: {
      version: 1, scope: 'piece', piece_ids: [activeId], occasions: [], activities: [], seasons: [], weather_terms: [],
    } }))
  const slots = normalizePlanSlots([{ label: 'City day', occasion: 'city', activity: 'walking', count: 1 }])
  const withPiece = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day' })
  assert.match(withPiece.instructions, /OWNER-ACCEPTED APPLICABLE LESSONS/)
  assert.match(withPiece.instructions, /Keep this candidate lesson bounded/)

  const withoutPiece = await buildPlanSlotWorkbench(slots, { allPieces: allPieces.filter(piece => Number(piece.id) !== activeId), question: 'city day' })
  assert.doesNotMatch(withoutPiece.instructions, /Keep this candidate lesson bounded/)
})

test('selectCapsuleRosterViaModel passes ownerRules through to both the initial call and the repair', async () => {
  const pool = layerTradeWardrobe()
  const slots = normalizePlanSlots([{ label: 'At Home', occasion: 'casual', count: 2 }])
  const seenOwnerRules = []
  const rule = 'Yuna prefers to travel in pants, not dresses, for airplane travel days.'
  await selectCapsuleRosterViaModel({
    pool, budget: 24, slots, isSummer: true, occasions: ['casual'],
    ownerRules: [rule],
    // Force a repair round so both attempts are observed.
    chooseRoster: async ({ bench, ownerRules }) => {
      seenOwnerRules.push(ownerRules)
      const tops = bench.filter(piece => piece.category === 'top').map(piece => Number(piece.id))
      return { roster_piece_ids: tops.slice(0, 24), palette: '', piece_jobs: [] }
    }
  })
  assert.equal(seenOwnerRules.length, 2, 'sanity: this fixture always fails and repairs once')
  assert.deepEqual(seenOwnerRules[0], [rule])
  assert.deepEqual(seenOwnerRules[1], [rule])
})

// The starting shape has to survive the trip from the engine to the prompt on
// both attempts. It gives the model useful capsule-practice guidance without
// becoming a hard validator formula.
test('selectCapsuleRosterViaModel passes the category allocation to both the initial call and the repair', async () => {
  const pool = layerTradeWardrobe()
  const slots = normalizePlanSlots([{ label: 'At Home', occasion: 'casual', count: 2 }])
  const seenQuotas = []
  await selectCapsuleRosterViaModel({
    pool, budget: 24, slots, isSummer: true, occasions: ['casual'],
    chooseRoster: async ({ bench, quotas }) => {
      seenQuotas.push(quotas)
      const tops = bench.filter(piece => piece.category === 'top').map(piece => Number(piece.id))
      return { roster_piece_ids: tops.slice(0, 24), palette: '', piece_jobs: [] }
    }
  })
  assert.equal(seenQuotas.length, 2, 'sanity: this fixture always fails and repairs once')
  for (const quotas of seenQuotas) {
    assert.ok(quotas, 'the allocation must reach the chooser')
    // The same numbers capsuleQuotas produces for this budget.
    assert.equal(quotas.outerwear, 2)
    assert.equal(quotas.dress, 3)
    assert.equal(quotas.shoes, 4)
    assert.equal(quotas.top + quotas.bottom + quotas.dress + quotas.outerwear + quotas.shoes, 24)
  }
})

test('buildPlanSlotWorkbench forwards its ownerRules into roster selection, not just composition', async () => {
  db.prepare('DELETE FROM pieces').run()
  for (let i = 0; i < 8; i += 1) insertPiece({ category: 'top', name: `tee ${i}`, colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })
  for (let i = 0; i < 7; i += 1) insertPiece({ category: 'bottom', name: `pants ${i}`, colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })
  for (let i = 0; i < 3; i += 1) insertPiece({ category: 'dress', name: `dress ${i}`, colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })
  for (let i = 0; i < 2; i += 1) insertPiece({ category: 'outerwear', name: `jacket ${i}`, colors: ['olive'], occasions: ['casual', 'city'], formality: 'everyday' })
  for (let i = 0; i < 4; i += 1) insertPiece({ category: 'shoes', name: `shoe ${i}`, colors: ['white'], occasions: ['casual', 'city'], formality: 'everyday' })

  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'At Home', occasion: 'casual', count: 2 }])
  const rule = 'Yuna prefers to travel in pants, not dresses, for airplane travel days.'
  let seenOwnerRules = null
  await buildPlanSlotWorkbench(slots, {
    constraints: { piece_budget: 24, reuse: 'maximize' },
    allPieces,
    question: 'I want a summer capsule',
    planKind: 'seasonal_capsule',
    ownerRules: [rule],
    chooseCapsuleRoster: async ({ bench, ownerRules }) => {
      seenOwnerRules = ownerRules
      return { roster_piece_ids: bench.slice(0, 24).map(piece => Number(piece.id)), palette: 'black', piece_jobs: [] }
    }
  })
  assert.deepEqual(seenOwnerRules, [rule], 'the same ownerRules passed to buildPlanSlotWorkbench must reach roster selection')
})

test('the repair call is held to the same brief as the first attempt', () => {
  const bench = layerTradeWardrobe().slice(0, 6)
  const slots = [{ label: 'At Home', occasion: 'casual', bestFor: 'low-key days at home' }]
  const shared = { bench, slots, budget: 24, palette: [], isSummer: true, isWinter: false }

  const first = capsuleRosterSelectionUserText({ ...shared, attempt: 1, failures: [] })
  const repair = capsuleRosterSelectionUserText({
    ...shared, attempt: 2,
    failures: [{ code: 'layer_floor:outerwear', message: 'roster has 1 outerwear(s) — needs 2 layering piece(s)' }],
    previousRosterIds: [1, 2, 3]
  })

  // Same system brief for both calls, by construction.
  assert.equal(capsuleRosterSelectionSystemPrompt(), capsuleRosterSelectionSystemPrompt())
  assert.doesNotMatch(first, /YOUR PREVIOUS SELECTION WAS REJECTED/)
  assert.match(repair, /YOUR PREVIOUS SELECTION WAS REJECTED/)
  assert.match(repair, /needs 2 layering piece\(s\)/, 'the repair round is told the exact structural reason')
  assert.match(repair, /protagonists, independent wearability, seasonally credible footwear, and a distinct job per piece/)
  assert.match(repair, /the piece with the weakest job, not simply the easiest one to remove/)
  // Both attempts carry the same candidates and the same use cases.
  for (const text of [first, repair]) {
    assert.match(text, /CAPSULE SIZE: exactly 24 pieces/)
    assert.match(text, /low-key days at home/)
    assert.match(text, /^ID 1: /m)
  }
})

// The roster call attaches one thumbnail per bench piece (up to ~70), and the
// repair is the ONLY point in a single run where a prompt-cache read is
// possible. A prompt cache matches on prefix, so the volatile repair text has
// to sit AFTER the last cache_control breakpoint — appended to the leading
// text block (as it originally was) it invalidates every breakpoint behind it
// and the repair re-pays for every image, while still charging the cache
// creation premium on both attempts.
test('the repair call reuses the initial call cache prefix instead of re-paying for every thumbnail', () => {
  const bench = layerTradeWardrobe()
  const shared = {
    bench,
    slots: [{ label: 'At Home', occasion: 'casual', bestFor: 'low-key days at home' }],
    budget: 24, palette: [], isSummer: true,
    ownerRules: ['Yuna prefers to travel in pants, not dresses, for airplane travel days.']
  }
  // Two parts per piece, exactly as the provider builds them.
  const imageParts = bench.flatMap(piece => ([
    { type: 'text', text: `ID ${piece.id}: ${piece.name}` },
    { type: 'image', detail: 'low', source: { type: 'base64', media_type: 'image/jpeg', data: `fake-${piece.id}` } }
  ]))
  const failures = [{ code: 'layer_floor:outerwear', message: 'roster has 1 outerwear(s) — needs 2 layering piece(s)' }]

  const initial = capsuleRosterSelectionContent({ ...shared, imageParts, attempt: 1, failures: [], previousRosterIds: [] })
  const repair = capsuleRosterSelectionContent({
    ...shared, imageParts, attempt: 2, failures, previousRosterIds: bench.slice(0, 3).map(p => Number(p.id))
  })

  const lastBreakpoint = content => content.reduce(
    (last, part, index) => (part?.cache_control ? index : last), -1
  )
  const initialBreak = lastBreakpoint(initial)
  const repairBreak = lastBreakpoint(repair)
  assert.ok(initialBreak > 0, 'the initial call sets a breakpoint after the images')
  assert.equal(initialBreak, repairBreak, 'both attempts break at the same position')

  // The whole cached prefix must be byte-identical, images included.
  assert.deepEqual(
    repair.slice(0, repairBreak + 1),
    initial.slice(0, initialBreak + 1),
    'the repair must not alter one byte of the cached prefix'
  )
  assert.ok(initial.some(part => part.type === 'image'), 'the prefix genuinely carries the thumbnails')

  // The repair still reaches the model — just after the breakpoint, and it is
  // the ONLY difference between the two payloads.
  assert.equal(repair.length, initial.length + 1)
  const tail = repair[repair.length - 1]
  assert.equal(tail.type, 'text')
  assert.equal(tail.cache_control, undefined, 'the volatile tail must not carry a breakpoint of its own')
  assert.match(tail.text, /YOUR PREVIOUS SELECTION WAS REJECTED/)
  assert.match(tail.text, /needs 2 layering piece\(s\)/, 'the repair round still gets the exact structural reason')
  assert.match(tail.text, /protagonists, independent wearability, seasonally credible footwear, and a distinct job per piece/)

  // The initial call carries no repair text anywhere.
  assert.ok(
    !initial.some(part => /YOUR PREVIOUS SELECTION WAS REJECTED/.test(String(part?.text || ''))),
    'the initial call is unchanged by this'
  )
})

// Criterion 8. The rotation is the capsule's evidence, so it must demonstrate
// the roster's functions rather than merely touch most of its IDs.
test('the composition brief asks the rotation to demonstrate functions, not just use pieces', () => {
  const brief = capsulePlanCompositionSystemPrompt()
  assert.match(brief, /The rotation is what proves the capsule works/)
  assert.match(brief, /a layer worn somewhere/)
  assert.match(brief, /a piece that cannot stand alone shown over a base/)
  assert.match(brief, /a specialised shoe in a look that genuinely calls for it/)
  assert.match(brief, /uses almost every ID while never showing a whole function/)
  assert.match(brief, /A top may be worn over a dress as an overlay, or under a dress as a base layer/)
  assert.match(brief, /garment truth explicitly supports that direction/)
})

test('the per-run composition guidance names the functions this roster actually bought', async () => {
  db.prepare('DELETE FROM pieces').run()
  // Seven plain tops plus the dependent one exactly fills this budget's top
  // quota, so the roster provably contains it and the guidance must say so.
  for (let i = 0; i < 7; i += 1) insertPiece({ category: 'top', name: `tee ${i}`, colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })
  for (let i = 0; i < 7; i += 1) insertPiece({ category: 'bottom', name: `pants ${i}`, colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })
  for (let i = 0; i < 3; i += 1) insertPiece({ category: 'dress', name: `dress ${i}`, colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })
  for (let i = 0; i < 2; i += 1) insertPiece({ category: 'outerwear', name: `jacket ${i}`, colors: ['olive'], occasions: ['casual', 'city'], formality: 'everyday' })
  for (let i = 0; i < 4; i += 1) insertPiece({ category: 'shoes', name: `shoe ${i}`, colors: ['white'], occasions: ['casual', 'city'], formality: 'everyday' })
  // insertPiece enumerates its columns explicitly and silently drops anything
  // else, so needs_base has to be set on the row afterwards.
  const dependentId = insertPiece({ category: 'top', name: 'tassel crop top', colors: ['black'], occasions: ['casual', 'city'], formality: 'everyday' })
  db.prepare('UPDATE pieces SET needs_base = ? WHERE id = ?').run('yes', dependentId)

  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([
    { label: 'At Home', occasion: 'casual', count: 3 },
    { label: 'City Outing', occasion: 'city', count: 3 },
  ])
  const workbench = await buildPlanSlotWorkbench(slots, {
    constraints: { piece_budget: 24, reuse: 'maximize' },
    allPieces,
    question: 'I want a summer capsule',
    planKind: 'seasonal_capsule'
  })

  const rosterIds = new Set(workbench.slots.flatMap(slot => slot.allowed_piece_ids || []))
  const dependent = allPieces.find(piece => piece.name === 'tassel crop top')
  assert.equal(dependent.needs_base, 'yes', 'sanity: the dependent field must actually be set')
  assert.ok(rosterIds.has(Number(dependent.id)), 'sanity: the dependent piece must be in the roster for its clause to apply')

  assert.match(workbench.instructions, /must demonstrate the roster's functional logic/)
  assert.match(workbench.instructions, /the layer\(s\) it holds, worn in at least one look/)
  assert.match(workbench.instructions, /the piece that cannot be worn alone/)
  assert.match(workbench.instructions, /shoe pairs in a look whose register and activity genuinely call for it/)
  assert.match(workbench.instructions, /an omitted look is honest, an unexplained missing function is not/)
})

test('the functional-demonstration guidance is absent for a plan that is not a capsule', async () => {
  db.prepare('DELETE FROM pieces').run()
  for (let i = 0; i < 4; i += 1) insertPiece({ category: 'top', name: `tee ${i}`, colors: ['black'], occasions: ['casual'], formality: 'everyday' })
  for (let i = 0; i < 3; i += 1) insertPiece({ category: 'bottom', name: `pants ${i}`, colors: ['black'], occasions: ['casual'], formality: 'everyday' })
  insertPiece({ category: 'outerwear', name: 'jacket', colors: ['olive'], occasions: ['casual'], formality: 'everyday' })
  insertPiece({ category: 'shoes', name: 'sneakers', colors: ['white'], occasions: ['casual'], formality: 'everyday' })

  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'Weekend', occasion: 'casual', count: 2 }])
  const workbench = await buildPlanSlotWorkbench(slots, {
    constraints: {},
    allPieces,
    question: 'outfits for the weekend',
    planKind: 'coordinated_plan'
  })

  assert.doesNotMatch(workbench.instructions, /functional logic/)
})

// Criterion 4. 22 of 24 pieces reached a look — a 92% headline — and the two
// that did not were the capsule's ONLY layer and a shoe that earned no formula.
// Raw utilization counts IDs; a capsule's claim is about functions.
test('an undemonstrated category cannot hide behind a high utilization percentage', () => {
  const roster = [
    ...Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `core ${i}`, category: i < 10 ? 'top' : 'bottom' })),
    { id: 21, name: 'olive lightweight jacket', category: 'outerwear' },
    { id: 22, name: 'taupe suede ankle boots', category: 'shoes' },
    { id: 23, name: 'canvas sneakers', category: 'shoes' },
    { id: 24, name: 'brown wedges', category: 'shoes' },
  ]
  const cards = [{ pieceIds: roster.filter(piece => piece.category !== 'outerwear').map(piece => piece.id) }]

  const line = describeCapsuleUndemonstratedJobs(roster, cards)
  assert.match(line, /23 of 24 roster pieces \(96%\) appear in a look/, 'the percentage is stated beside the gap, not instead of it')
  assert.match(line, /1 selected job\(s\) went undemonstrated/)
  assert.match(line, /no look uses a layer/)
  assert.match(line, /olive lightweight jacket/)
  // Shoes ARE demonstrated as a category here, so the line must not claim otherwise.
  assert.doesNotMatch(line, /no look uses a shoes/)
})

test('a dependent piece and a statement piece that never appear are named as jobs', () => {
  const roster = [
    { id: 1, name: 'white tee', category: 'top' },
    { id: 2, name: 'tan shorts', category: 'bottom' },
    { id: 3, name: 'sneakers', category: 'shoes' },
    { id: 4, name: 'geometric crop top', category: 'top', needs_base: 'yes' },
    { id: 5, name: 'bold print blouse', category: 'top', pattern_complexity: 'loud' },
  ]
  const line = describeCapsuleUndemonstratedJobs(roster, [{ pieceIds: [1, 2, 3] }])
  assert.match(line, /1 of 1 piece\(s\) that need a base under them appear in no look/)
  assert.match(line, /geometric crop top/)
  assert.match(line, /no statement piece leads a look/)
  assert.match(line, /bold print blouse/)
})

test('a rotation that demonstrates every job discloses nothing', () => {
  const roster = [
    { id: 1, name: 'white tee', category: 'top' },
    { id: 2, name: 'tan shorts', category: 'bottom' },
    { id: 3, name: 'sneakers', category: 'shoes' },
    { id: 4, name: 'olive jacket', category: 'outerwear' },
    { id: 5, name: 'unused second tee', category: 'top' },
  ]
  // Piece 5 is unused, so utilization still reports it — but no JOB is missing,
  // and this line must not invent one.
  assert.equal(describeCapsuleUndemonstratedJobs(roster, [{ pieceIds: [1, 2, 3, 4] }]), '')
  assert.equal(describeCapsuleUndemonstratedJobs([], [{ pieceIds: [1] }]), '')
})

// docs/capsule-real-world-rules.md: every published breakdown that lists
// dresses separately allots 2-3. A flat 1 also silently capped the BENCH — on
// live thread_1785380251549 the model was shown one dress while 10 of the
// wardrobe's 18 passed a slot gate.
test('the dress quota matches published breakdowns and stops starving the bench', () => {
  const pool = []
  let id = 1
  const add = (n, category) => { for (let i = 0; i < n; i += 1) pool.push({ id: id++, name: `${category} ${i}`, category, colors: ['black'], occasions: ['casual', 'city'] }) }
  add(20, 'top'); add(20, 'bottom'); add(10, 'dress'); add(6, 'outerwear'); add(8, 'shoes')
  const slots = [
    { id: 'home', label: 'At Home', occasion: 'casual', bestFor: 'home', targetOutfits: 3 },
    { id: 'city', label: 'City', occasion: 'city', bestFor: 'city', targetOutfits: 3 },
  ]
  const dressesIn = pieces => pieces.filter(piece => piece.category === 'dress').length

  const roster = selectCapsuleRoster(pool, { budget: 24, isSummer: true, isWinter: false, occasions: ['casual', 'city'], slots })
  assert.equal(dressesIn(roster), 3)

  // The bench must offer at least the quota, or the model cannot choose dresses.
  const { bench } = buildCapsuleBench(pool, { budget: 24, slots, isSummer: true, benchSize: 40 })
  assert.ok(dressesIn(bench) >= 3, `bench offered ${dressesIn(bench)} dresses`)
})

// Season eligibility is deliberately asymmetric. Winter drops warm-season
// pieces outright; summer drops cool-season CORE pieces but keeps cool-season
// outerwear, because the layer's job is the cool part of a warm day. A blanket
// mirror rule deleted the live wardrobe's olive lightweight jacket — the one
// correct summer layer — while corduroy trousers stayed in on rank alone.
test('a summer capsule drops cool-season cores but keeps a cool-season layer', () => {
  const pool = [
    { id: 1, name: 'linen tank', category: 'top', season: 'warm', colors: ['white'], occasions: ['casual'] },
    { id: 2, name: 'cotton tee', category: 'top', season: 'year-round', colors: ['black'], occasions: ['casual'] },
    { id: 3, name: 'corduroy trousers', category: 'bottom', season: 'cool', colors: ['brown'], occasions: ['casual'] },
    { id: 4, name: 'cotton shorts', category: 'bottom', season: 'warm', colors: ['beige'], occasions: ['casual'] },
    { id: 5, name: 'lightweight jacket', category: 'outerwear', season: 'cool', colors: ['olive'], occasions: ['casual'] },
    { id: 6, name: 'sneakers', category: 'shoes', season: 'year-round', colors: ['white'], occasions: ['casual'] },
  ]
  const slots = [{ id: 'home', label: 'At Home', occasion: 'casual', bestFor: 'home', targetOutfits: 2 }]
  const roster = selectCapsuleRoster(pool, { budget: 12, isSummer: true, isWinter: false, occasions: ['casual'], slots })
  const names = roster.map(piece => piece.name)

  assert.equal(names.includes('corduroy trousers'), false, 'a cool-season bottom is not summer capsule material')
  assert.equal(names.includes('lightweight jacket'), true, 'the cool-season layer is exactly what a summer capsule needs')
})

// docs/capsule-palette-rules.md: "recombines with everything" is what the +12
// neutral bonus pays for, and a piece only earns it if it introduces no colour
// of its own. Live example: piece 87, `pink/green/blue/yellow/white`, collected
// the full bonus on the strength of one "blue".
test('the neutral bonus goes to pieces that introduce no colour, not to prints containing one', () => {
  const slots = [{ id: 'home', label: 'At Home', occasion: 'casual', bestFor: 'home', targetOutfits: 2 }]
  const stripeTee = { id: 1, name: 'navy white stripe tee', category: 'top', colors: ['navy', 'white'], pattern_type: 'stripe', pattern_complexity: 'medium', occasions: ['casual'], formality: 'everyday' }
  const floral = { id: 2, name: 'floral chiffon blouse', category: 'top', colors: ['pink', 'green', 'blue', 'yellow', 'white'], pattern_type: 'floral', pattern_complexity: 'medium', occasions: ['casual'], formality: 'everyday' }

  const { bench } = buildCapsuleBench([stripeTee, floral], { budget: 10, slots, isSummer: true, benchSize: 40 })

  // A two-tone neutral stripe genuinely recombines; a five-colour floral does not.
  assert.equal(bench[0].id, stripeTee.id, `bench order was ${bench.map(piece => piece.id)}`)
})

// The neutral list has to be complete once the test is "every colour matches",
// or an unrecognised neutral name disqualifies a genuinely neutral piece.
test('taupe and oatmeal count as neutrals', () => {
  const slots = [{ id: 'home', label: 'At Home', occasion: 'casual', bestFor: 'home', targetOutfits: 2 }]
  const taupeKnit = { id: 1, name: 'grey taupe knit cardigan', category: 'top', colors: ['light grey', 'taupe'], pattern_complexity: 'quiet', occasions: ['casual'], formality: 'everyday' }
  const coloured = { id: 2, name: 'rust knit cardigan', category: 'top', colors: ['rust'], pattern_complexity: 'quiet', occasions: ['casual'], formality: 'everyday' }

  const { bench } = buildCapsuleBench([taupeKnit, coloured], { budget: 10, slots, isSummer: true, benchSize: 40 })
  assert.equal(bench[0].id, taupeKnit.id, `bench order was ${bench.map(piece => piece.id)}`)
})

// Live thread_1785380251549: 4 of 24 roster pieces reached none of the ten
// cards and no surface said so. Disclosure, not enforcement — forcing an unused
// piece into a card buys the metric with a worse outfit.
test('roster utilization names the pieces that reached no look', () => {
  const roster = [
    { id: 1, name: 'white tee', category: 'top' },
    { id: 2, name: 'tan shorts', category: 'bottom' },
    { id: 3, name: 'coral maxi dress', category: 'dress' },
    { id: 4, name: 'olive jacket', category: 'outerwear' },
  ]
  const cards = [{ pieceIds: [1, 2] }]

  const line = describeCapsuleRosterUtilization(roster, cards)
  assert.match(line, /2 of 4 pieces did not make it into a look/)
  assert.match(line, /coral maxi dress/)
  assert.match(line, /olive jacket/)
  assert.doesNotMatch(line, /white tee/)

  // A piece inside a needs-review card has a job waiting, so it is not unused.
  assert.equal(describeCapsuleRosterUtilization(roster, [{ pieceIds: [1, 2] }, { piece_ids: [3, 4] }]), '')
  assert.equal(describeCapsuleRosterUtilization([], cards), '')
})

// Step 4 stays observational until the corrected roster is evaluated. Family
// breadth and unused accents are set-level facts the per-piece score cannot
// expose; reporting them makes the Step 5 comparison falsifiable without
// steering the generation being judged.
test('capsule palette disclosure reports family breadth, neutral share, and unused accents', () => {
  const roster = [
    { id: 1, name: 'cream tee', category: 'top', colors: ['cream'] },
    { id: 2, name: 'ivory trousers', category: 'bottom', colors: ['ivory'] },
    { id: 3, name: 'navy shoes', category: 'shoes', colors: ['navy'] },
    { id: 4, name: 'coral maxi dress', category: 'dress', colors: ['coral'] },
    { id: 5, name: 'burgundy cardigan', category: 'outerwear', colors: ['burgundy'] },
    { id: 6, name: 'untagged layer', category: 'outerwear', colors: ['not-a-colour'] },
  ]
  const cards = [{ pieces: [roster[0], roster[1], roster[2], roster[4]] }]

  const line = describeCapsulePaletteCohesion(roster, cards)
  // The neutral base is reported as the base, never as palette breadth: white
  // and blue (navy) are the base here, pink and red are the actual colour.
  assert.match(line, /2 colour families beyond a 2-family neutral base — pink \(1\), red \(1\)/)
  assert.match(line, /3 of 6 pieces \(50%\) form the neutral base/)
  assert.match(line, /1 of 2 accent-colour pieces did not make it into a look/)
  assert.match(line, /coral maxi dress/)
  assert.doesNotMatch(line, /burgundy cardigan/)
  assert.doesNotMatch(line, /unknown/)
  // Both colour families lead a piece of their own here, so nothing is flagged
  // as secondary-only.
  assert.doesNotMatch(line, /secondary colour/)
})

test('capsule palette disclosure is evidence, not a palette validity check', () => {
  const accentRoster = [
    { id: 1, name: 'coral top', colors: ['coral'] },
    { id: 2, name: 'green bottom', colors: ['green'] },
  ]
  const line = describeCapsulePaletteCohesion(accentRoster, [{ pieceIds: [1, 2] }])
  assert.match(line, /0 of 2 pieces \(0%\) form the neutral base/)
  assert.match(line, /2 colour families beyond no neutral family at all/)
  assert.equal(describeCapsulePaletteCohesion([], []), '')
})

// Live thread_1785451253837 reported "10 colour families" for a roster holding
// 4 non-neutral garments. A flat family count is the palette equivalent of the
// raw-utilization headline: technically true, and it reads as a verdict.
// Published guidance counts a palette as what the set reads as, so a number
// compared against it has to be built the same way.
test('the palette line counts what the capsule reads as, not every colour term mentioned', () => {
  const roster = [
    // One multi-colour piece used to supply three families by itself.
    { id: 1, name: 'black canvas sneakers', category: 'shoes', colors: ['black', 'white', 'brown'] },
    // And `red` existed nowhere except as this piece's third listed colour.
    { id: 2, name: 'geometric tassel crop top', category: 'top', colors: ['black', 'cream', 'burgundy'] },
    { id: 3, name: 'oatmeal skirt', category: 'bottom', colors: ['oatmeal'] },
    { id: 4, name: 'navy slip shoes', category: 'shoes', colors: ['navy'] },
    { id: 5, name: 'olive jacket', category: 'outerwear', colors: ['olive'] },
    { id: 6, name: 'green midi dress', category: 'dress', colors: ['green'] },
  ]
  const line = describeCapsulePaletteCohesion(roster, [{ pieceIds: [1, 2, 3, 4, 5, 6] }])

  // black, white, brown, beige and blue(navy) are all base; green and red are
  // the only families carrying an accent term.
  assert.match(line, /2 colour families beyond a 5-family neutral base — green \(2\), red \(1\)/)
  // The inflation is named rather than folded into the count: nothing in this
  // capsule leads with red.
  assert.match(line, /red appears only as a secondary colour inside a multi-colour piece, never leading one/)
  // Guard against the old behaviour returning: a bare "N colour families"
  // headline counting the neutral base as breadth.
  assert.doesNotMatch(line, /7 colour families/)
})

// Live thread_1785380251549: two of ten cards came back with no shoes while
// their own slot rosters held four and three gate-passing pairs. Both shipped
// as needs-review cards for the person to fix by hand — for an omission the
// engine can fill itself, deterministically, at zero model cost.
test('a look submitted without shoes is completed from its own slot roster', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'city top', occasions: ['city'], formality: 'everyday' })
  const bottomId = insertPiece({ category: 'bottom', name: 'city pants', occasions: ['city'], formality: 'everyday' })
  const shoesId = insertPiece({ category: 'shoes', name: 'city loafers', occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'City Day', occasion: 'city', activity: 'none', count: 1, weather: 'indoor' }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day' })
  const submission = [{ slot_id: workbench.pendingPlan.slots[0].id, title: 'Shoeless', piece_ids: [Number(topId), Number(bottomId)] }]

  // Without completion the look is rejected outright.
  const plain = validateSubmittedPlanOutfits(workbench.pendingPlan, submission)
  assert.equal(plain.accepted.length, 0)
  assert.match(plain.failures[0].reasons.join(' '), /shoe/i)

  const completed = completeSubmittedPlanOutfits(workbench.pendingPlan, submission)
  assert.equal(completed.accepted.length, 1, 'the look should be completed, not rejected')
  assert.equal(completed.failures.length, 0)
  assert.equal(completed.completions.length, 1)
  assert.equal(completed.completions[0].group, 'shoes')
  assert.equal(completed.completions[0].addedPieceId, Number(shoesId))
  assert.ok((completed.accepted[0].pieces || []).some(piece => Number(piece.id) === Number(shoesId)))

  // The completion has to be visible to the person, not just to the dev log.
  const line = describeCapsuleAutoCompletions(completed.completions)
  assert.match(line, /^\[capsule looks completed: 1 look was submitted without a required piece/)
  assert.match(line, /"Shoeless" got city loafers/)
  // Live thread_1785467959899: a card titled "Ankle Boots" carried the navy
  // canvas slip shoes because the fill happened after the title was written.
  // Reconciling the prose would need a second paid call; naming the piece list
  // as authoritative is the honest free half.
  assert.match(line, /the piece list is what you are actually being shown/)
})

// Live thread_1785467959899, the exact card: the title named "Ankle Boots", the
// model submitted no shoe at all, and the fill took the lowest-ID candidate —
// the navy canvas slip shoes — so the finished card named a garment it did not
// contain. The model had already said which shoe it meant; reading its own
// title back costs nothing and removes the contradiction at its source.
test('a completion prefers the shoe the card already names over the lowest ID', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'city top', occasions: ['city'], formality: 'everyday' })
  const bottomId = insertPiece({ category: 'bottom', name: 'city pants', occasions: ['city'], formality: 'everyday' })
  // Inserted first, so lowest-ID ordering alone would pick these — the live bug.
  const slipId = insertPiece({ category: 'shoes', name: 'navy canvas slip shoes', occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const bootId = insertPiece({ category: 'shoes', name: 'taupe suede ankle boots', occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'City Day', occasion: 'city', activity: 'none', count: 1, weather: 'indoor' }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day' })
  const submission = [{
    slot_id: workbench.pendingPlan.slots[0].id,
    title: 'City Top + City Pants + Ankle Boots',
    piece_ids: [Number(topId), Number(bottomId)]
  }]

  assert.ok(Number(slipId) < Number(bootId), 'the fixture must make lowest-ID pick the wrong shoe')

  const completed = completeSubmittedPlanOutfits(workbench.pendingPlan, submission)
  assert.equal(completed.accepted.length, 1)
  assert.equal(
    completed.completions[0].addedPieceId,
    Number(bootId),
    'the card names ankle boots, so the completion must add the ankle boots'
  )
  assert.equal(completed.completions[0].matchesCardText, true)

  // A card whose own words account for the added piece needs no "the piece list
  // is what you are actually being shown" caveat — the two now agree.
  const line = describeCapsuleAutoCompletions(completed.completions)
  assert.match(line, /"City Top \+ City Pants \+ Ankle Boots" got taupe suede ankle boots/)
  assert.doesNotMatch(line, /the piece list is what you are actually being shown/)
})

// The reason text counts too, and a card that names nothing keeps the old
// deterministic lowest-ID behaviour rather than picking arbitrarily.
test('a completion falls back to lowest ID when the card names no candidate', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'city top', occasions: ['city'], formality: 'everyday' })
  const bottomId = insertPiece({ category: 'bottom', name: 'city pants', occasions: ['city'], formality: 'everyday' })
  const slipId = insertPiece({ category: 'shoes', name: 'navy canvas slip shoes', occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  insertPiece({ category: 'shoes', name: 'taupe suede ankle boots', occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'City Day', occasion: 'city', activity: 'none', count: 1, weather: 'indoor' }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day' })
  const completed = completeSubmittedPlanOutfits(workbench.pendingPlan, [{
    slot_id: workbench.pendingPlan.slots[0].id,
    title: 'An Easy Day Out',
    reason: 'Comfortable and simple for a long afternoon.',
    piece_ids: [Number(topId), Number(bottomId)]
  }])

  assert.equal(completed.completions[0].addedPieceId, Number(slipId))
  assert.equal(completed.completions[0].matchesCardText, false)
  assert.match(describeCapsuleAutoCompletions(completed.completions), /the piece list is what you are actually being shown/)
})

// A no-op when nothing was completed — the overwhelming majority of runs.
test('a rotation the engine did not touch discloses no completion', () => {
  assert.equal(describeCapsuleAutoCompletions([]), '')
  assert.equal(describeCapsuleAutoCompletions([{ filled: false, title: 'Untouched' }]), '')
})

// The jobs line states the utilization percentage inside itself on purpose:
// the failure mode it closes is a high raw number reading as success on its
// own. Appending the bare count after it put that number back as the last word.
test('the bare utilization count is withheld when the jobs line already states it', () => {
  const roster = [
    { id: 1, name: 'tee', category: 'top', colors: ['black'] },
    { id: 2, name: 'jeans', category: 'bottom', colors: ['black'] },
    { id: 3, name: 'sneakers', category: 'shoes', colors: ['white'] },
    { id: 4, name: 'olive jacket', category: 'outerwear', colors: ['olive'] }
  ]
  const cards = [{ pieceIds: [1, 2, 3] }]

  // The layer is unused, so BOTH lines have something to say about piece 4.
  const jobs = describeCapsuleUndemonstratedJobs(roster, cards)
  const utilization = describeCapsuleRosterUtilization(roster, cards)
  assert.match(jobs, /no look uses a layer/)
  assert.match(jobs, /3 of 4 roster pieces \(75%\)/, 'the jobs line carries the percentage itself')
  assert.match(utilization, /olive jacket/)

  // Both are non-empty, which is exactly the case that used to print twice.
  // The caller suppresses the second; assert the qualified line is the one that
  // survives by checking it alone reports both the count and the reason.
  assert.ok(jobs.includes('75%') && jobs.includes('layer'))

  // And the case they do NOT overlap on: every job demonstrated, a piece still
  // unused. Here the utilization line is the only reporter and must stay.
  const allJobsShown = [
    { id: 1, name: 'tee', category: 'top', colors: ['black'] },
    { id: 2, name: 'other tee', category: 'top', colors: ['white'] },
    { id: 3, name: 'jeans', category: 'bottom', colors: ['black'] },
    { id: 4, name: 'sneakers', category: 'shoes', colors: ['white'] }
  ]
  const usedCards = [{ pieceIds: [1, 3, 4] }]
  assert.equal(describeCapsuleUndemonstratedJobs(allJobsShown, usedCards), '', 'every category is demonstrated')
  assert.match(describeCapsuleRosterUtilization(allJobsShown, usedCards), /other tee/, 'the unused piece still gets reported')
})

// Completion must never invent supply. When the slot roster genuinely has no
// shoe, the look stays a needs-review card and the person is told the truth.
test('completion does not fabricate a piece the slot roster lacks', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'city top', occasions: ['city'], formality: 'everyday' })
  const bottomId = insertPiece({ category: 'bottom', name: 'city pants', occasions: ['city'], formality: 'everyday' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'City Day', occasion: 'city', activity: 'none', count: 1, weather: 'indoor' }])
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'city day' })
  const submission = [{ slot_id: workbench.pendingPlan.slots[0].id, title: 'Shoeless', piece_ids: [Number(topId), Number(bottomId)] }]

  const completed = completeSubmittedPlanOutfits(workbench.pendingPlan, submission)
  assert.equal(completed.accepted.length, 0)
  assert.equal(completed.completions.length, 0)
  assert.equal(completed.failures.length, 1)
})

// Distinct-core enforcement is a property of the whole rotation, so a look
// completed in isolation could duplicate an already-accepted core and turn one
// broken card into two. completeSubmittedPlanOutfits re-validates the entire
// set after each completion for exactly this reason.
test('completion never creates a duplicate core with an already-accepted look', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'city top', occasions: ['city'], formality: 'everyday' })
  const bottomId = insertPiece({ category: 'bottom', name: 'city pants', occasions: ['city'], formality: 'everyday' })
  const shoeA = insertPiece({ category: 'shoes', name: 'city loafers', occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const shoeB = insertPiece({ category: 'shoes', name: 'city sneakers', occasions: ['city'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const slots = normalizePlanSlots([{ label: 'City Day', occasion: 'city', activity: 'none', count: 2, weather: 'indoor' }])
  // Distinct cores are enforced for a CAPSULE, not for an ordinary plan, where a
  // shoe swap legitimately re-skins a look. The safeguard only has meaning here.
  const workbench = await buildPlanSlotWorkbench(slots, {
    allPieces,
    question: 'summer capsule',
    planKind: 'seasonal_capsule',
    constraints: { piece_budget: 8 },
  })
  const slotId = workbench.pendingPlan.slots[0].id
  assert.equal(workbench.pendingPlan.isSeasonalCapsule, true, 'fixture must be an enforced capsule')

  // The only completion available reuses the accepted look's exact core, so a
  // second shoe would re-skin it rather than make a distinct look.
  const submission = [
    { slot_id: slotId, title: 'Complete', piece_ids: [Number(topId), Number(bottomId), Number(shoeA)] },
    { slot_id: slotId, title: 'Shoeless', piece_ids: [Number(topId), Number(bottomId)] },
  ]

  const completed = completeSubmittedPlanOutfits(workbench.pendingPlan, submission)
  assert.equal(completed.accepted.length, 1, 'only the genuinely distinct look survives')
  assert.equal(completed.accepted[0].title, 'Complete')
  assert.equal(completed.completions.length, 0, 'no completion should be reported')
  assert.ok(String(completed.failures[0]?.reasons?.join(' ') || '').length > 0)
  assert.ok(Number(shoeB) > 0)
})

// "I want a summer capsule" names the calendar, not the weather. Inferring a
// blanket isHot from it stamped every slot hot on live thread_1785380251549 —
// including the air-conditioned museum and the evening restaurant — and the hot
// gate then suppressed 17-26 outerwear pieces from EVERY slot, leaving two of
// five unable to admit any layer at all. That is the same capsule the layer
// research says must carry two.
test('a seasonal capsule does not inherit a blanket hot profile from the season word', () => {
  const bare = weatherProfileFromContext({ mood: 'I want a summer capsule', season: '' })
  assert.equal(bare.isHot, true, 'an ordinary request still reads summer as hot')

  const capsule = weatherProfileFromContext({ mood: 'I want a summer capsule', season: '', seasonIsCalendarOnly: true })
  assert.equal(capsule.isHot, false)
  assert.equal(capsule.isCold, false)
})

// The asymmetry is the point: a stated condition is a claim about the weather
// and keeps its meaning; only the bare season word is demoted.
test('an explicit heat signal still wins inside a seasonal capsule', () => {
  for (const mood of ['a summer capsule, it is 95 here', 'summer capsule during a heatwave']) {
    const profile = weatherProfileFromContext({ mood, season: '', seasonIsCalendarOnly: true })
    assert.equal(profile.isHot, true, `"${mood}" should still gate as hot`)
  }
})

// Cold is deliberately untouched — the measured defect was on the hot side, and
// the winter covered-base and transition-layer post-conditions depend on cold
// gating behaving as it does.
test('a winter capsule keeps its cold profile', () => {
  const profile = weatherProfileFromContext({ mood: 'I want a winter capsule', season: '', seasonIsCalendarOnly: true })
  assert.equal(profile.isCold, true)
  assert.equal(profile.isHot, false)
})

// Owner ruling 2026-07-30: evening is dressier than a restaurant; an ordinary
// restaurant dinner reads smart casual, or maybe city. The schema previously
// told the model to map dinner and evening-restaurant use cases to 'evening',
// contradicting the engine's own occasion profiles — city_smart_casual lists
// `dinner` and `museum` (ceiling elevated) while evening_social lists
// `dinner date, wine bar, theater, night out` (ceiling dressy).
test('the plan slot occasion guidance matches the occasion profiles and the owner register semantics', () => {
  const description = planOutfitSetSlotSchema()?.properties?.occasion?.description || ''

  assert.doesNotMatch(description, /map dinner\/evening-restaurant/i, 'the contradicted wording must not return')
  assert.match(description, /restaurant dinner/i)
  assert.match(description, /smart casual/i)
  assert.match(description, /reserve 'evening'/i)
})

// The guidance is only correct if the profiles it describes still behave that
// way — this fails if someone re-tunes a ceiling without revisiting the wording.
test('restaurant-register semantics hold in the occasion profiles themselves', () => {
  const smartCasual = resolveOccasionProfile('smart casual')
  const evening = resolveOccasionProfile('evening')

  assert.equal(smartCasual.id, 'city_smart_casual')
  assert.equal(evening.id, 'evening_social')
  assert.ok((smartCasual.keywords || []).includes('dinner'), 'city_smart_casual should still own plain "dinner"')
  assert.equal(smartCasual.register_ceiling, 'elevated')
  assert.equal(evening.register_ceiling, 'dressy')
  assert.ok(
    formalityRank(evening.register_ceiling) > formalityRank(smartCasual.register_ceiling),
    'evening must remain the dressier register'
  )
})

// Live thread_1785380251549: "City Outings / Museums" was gated as a hot
// outdoor day. The indoor classifier already covered offices, meetings and
// restaurants but not museums or galleries, though the engine has a
// gallery_art_event occasion profile.
test('museum and gallery slots infer indoor weather', () => {
  for (const label of ['City Outings / Museums', 'Museum Visit', 'Gallery Day']) {
    const [slot] = normalizePlanSlots([{ label, occasion: 'city', activity: 'none', count: 2 }])
    assert.equal(slot.statedWeather, 'indoor', `"${label}" should infer indoor`)
  }
})

// The inference must stay narrow: an explicitly outdoor place and a walking
// activity both keep their outdoor weather.
test('the indoor inference yields to an outdoor place or a walking activity', () => {
  const [garden] = normalizePlanSlots([{ label: 'Outdoor Sculpture Garden', occasion: 'city', activity: 'none', count: 2 }])
  assert.equal(garden.statedWeather || '', '')

  const [walking] = normalizePlanSlots([{ label: 'City Outings / Museums', occasion: 'city', activity: 'walking', count: 2 }])
  assert.equal(walking.statedWeather || '', '')
})

// Owner ruling 2026-07-30: a slot's own label wins over a declared `outdoor`.
// Live thread_1785380251549 declared `outdoor` for both the restaurant and the
// museum slot, and the engine then dressed each for the weather outside the
// room. Any declared environment used to short-circuit past the label
// classifier entirely.
test('an unambiguously indoor label overrides a declared outdoor environment', () => {
  for (const label of ['Restaurants / Social Events', 'City Outings / Museums']) {
    const [slot] = normalizePlanSlots([{ label, occasion: 'city', activity: 'none', environment: 'outdoor', count: 2 }])
    assert.equal(slot.environment, 'indoor', `"${label}" should resolve indoor`)
    assert.equal(slot.statedWeather, 'indoor')
  }
})

// Narrow by construction: an outdoor place, a walking activity, and the
// deliberate beach_coastal signal all keep their declared setting.
test('the label override does not touch genuinely outdoor or coastal slots', () => {
  const cases = [
    ['Patio Dinner', 'none', 'outdoor'],
    ['Outdoor Sculpture Garden', 'none', 'outdoor'],
    ['Nature Walks', 'walking', 'outdoor'],
    ['Beach Day', 'none', 'beach_coastal'],
  ]
  for (const [label, activity, environment] of cases) {
    const [slot] = normalizePlanSlots([{ label, occasion: 'casual', activity, environment, count: 2 }])
    assert.equal(slot.environment, environment, `"${label}" must keep ${environment}`)
  }
})

// The ratified occasion behaviour is not in scope of the environment override:
// occasions must resolve exactly as before (docs/occasion_profiles_ratification.md).
test('the label override changes no occasion', () => {
  const cases = [
    ['Restaurants / Social Events', 'smart casual', 'outdoor', 'smart casual'],
    ['City Outings / Museums', 'city', 'outdoor', 'city'],
    ['At Home / Errands', 'casual', 'indoor', 'casual'],
    ['Nature Walks', 'casual', 'outdoor', 'casual'],
    ['Beach Day', 'casual', 'beach_coastal', 'casual'],
  ]
  for (const [label, occasion, environment, expected] of cases) {
    const [slot] = normalizePlanSlots([{ label, occasion, activity: 'none', environment, count: 2 }])
    assert.equal(slot.occasion, expected, `"${label}" occasion must stay ${expected}`)
  }
})

// Live thread_1785380251549: the lifestyle answer listed three distinct
// contexts — days at home, errands, weekends out — and all three came back
// `occasion: casual`, so a going-out slot inherited a stay-at-home register.
// The field's own description was the cause: it framed `register` as an
// event-weekend escalation tool and told the model to omit it otherwise.
test('the slot register guidance covers ordinary going-out slots, not just event weekends', () => {
  const description = planOutfitSetSlotSchema()?.properties?.register?.description || ''

  assert.doesNotMatch(description, /Omit for ordinary slots/i, 'the wording that suppressed the field must not return')
  assert.match(description, /going-out/i)
  assert.match(description, /requires nothing/i, 'elevated must be described as permission, not obligation')
  assert.match(description, /dressy-or-better main piece/i, 'the dressy/formal floor must stay stated')
})

// The guidance above is only honest because of this asymmetry: the per-look
// register floor applies at `dressy` and above only, so `elevated` widens what
// a slot may use without demanding anything. If that threshold ever moves, the
// description becomes a lie — this is the pin that catches it.
test('register elevated imposes no per-look floor; dressy does', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = insertPiece({ category: 'top', name: 'everyday tee', occasions: ['casual'], formality: 'everyday' })
  const bottomId = insertPiece({ category: 'bottom', name: 'everyday jeans', occasions: ['casual'], formality: 'everyday' })
  const shoesId = insertPiece({ category: 'shoes', name: 'everyday sneakers', occasions: ['casual'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' })
  insertPiece({ category: 'top', name: 'dressy silk blouse', occasions: ['casual'], formality: 'dressy' })
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const allEveryday = [Number(topId), Number(bottomId), Number(shoesId)]

  const submit = async register => {
    const slots = normalizePlanSlots([{ label: 'Weekends Out', occasion: 'casual', activity: 'none', count: 1, weather: 'indoor', ...(register ? { register } : {}) }])
    const workbench = await buildPlanSlotWorkbench(slots, { allPieces, question: 'weekends out' })
    return validateSubmittedPlanOutfits(workbench.pendingPlan, [{
      slot_id: workbench.pendingPlan.slots[0].id, title: 'All everyday', piece_ids: allEveryday,
    }])
  }

  assert.equal((await submit('elevated')).accepted.length, 1, 'elevated must not demand an elevated piece')
  const dressy = await submit('dressy')
  assert.equal(dressy.accepted.length, 0, 'dressy must demand a dressy-or-better main piece')
  assert.match(dressy.failures[0].reasons.join(' '), /register floor/i)
})

test('the limited photo slots go to the garments hardest to describe in words', async () => {
  const { visuallyPrioritizedPieces } = await import('../styling-engine/attributes.js')
  const complex = { id: 1, name: 'loud print blouse', photo: 'a.jpg', pattern_complexity: 'loud' }
  const plain = { id: 2, name: 'plain tee', photo: 'b.jpg' }
  const plain2 = { id: 3, name: 'plain shoe', photo: 'c.jpg' }
  const noPhoto = { id: 4, name: 'unphotographed scarf', pattern_complexity: 'loud' }

  // Array order used to decide, so a loud print could be rendered from prose while a plain shoe
  // kept its reference — the inverse of the visual-grounding principle.
  assert.deepEqual(
    visuallyPrioritizedPieces([plain, plain2, complex], 2).map(p => p.id),
    [1, 2],
  )
  // A piece with no usable photo contributes no reference, so it must not consume a slot even
  // though it is visually complex.
  assert.deepEqual(
    visuallyPrioritizedPieces([noPhoto, plain, complex], 2).map(p => p.id),
    [1, 2],
  )
  // Stable within a tier: equally-ranked pieces keep their original order.
  assert.deepEqual(
    visuallyPrioritizedPieces([plain, plain2], 2).map(p => p.id),
    [2, 3],
  )
  assert.equal(visuallyPrioritizedPieces([], 5).length, 0)
})
