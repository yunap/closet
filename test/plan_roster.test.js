// docs/multi-outfit-shortlist-and-composer-spec.md (owner, 2026-10-27: "the same garment selection mechanism as the trip
// flow"): a coordinated plan's garments are chosen by the stylist through selectTripRosterViaModel — every gate-eligible
// piece, one roster call, the trip's coverage check with one repair, a disclosed fallback — and its first set is
// composed in one call with a photo of every chosen garment, then accepted by submit_plan_outfits itself.

import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-coordinated-plan-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { db } = await import('../db.js')
const { executeTool } = await import('../styling-engine/tools.js')
const { coordinatedPlanCompositionSchema, coordinatedPlanCompositionSystemPrompt, tripRosterSelectionSystemPrompt, tripRosterSelectionUserText, tripPlanCompositionSystemPrompt } = await import('../routes/ai.js')

after(() => {
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

function insertPiece(overrides = {}) {
  const piece = {
    name: 'test piece', category: 'top', colors: [], occasions: ['casual', 'city', 'home'], season: 'year-round', notes: '',
    status: 'active', recommendation_status: 'trusted', fit_confidence: 'high', role_permission: 'auto', occasion_permissions: [],
    engine_notes: '', photo: null, worn_photo: null, pattern_type: 'solid', pattern_scale: 'none', pattern_complexity: 'solid',
    reads_as: '', silhouette: '', fabric_category: '', fabric_weight: 'light', fiber_content: [], formality: 'everyday',
    sleeve_length: '', length_hits_at: '', heel_height: null, walk_support: null, toe_shape: null, shoe_type: null,
    style_profile_json: { garment_intelligence: { auto_use_trust: 'trusted' } },
    ...overrides,
  }
  return Number(db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission,
      occasion_permissions, engine_notes, photo, worn_photo, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette,
      fabric_category, fabric_weight, fiber_content, formality, sleeve_length, length_hits_at, heel_height, walk_support, toe_shape, shoe_type, style_profile_json)
    VALUES (@name, @category, @colors, @occasions, @season, @notes, @status, @recommendation_status, @fit_confidence, @role_permission,
      @occasion_permissions, @engine_notes, @photo, @worn_photo, @pattern_type, @pattern_scale, @pattern_complexity, @reads_as, @silhouette,
      @fabric_category, @fabric_weight, @fiber_content, @formality, @sleeve_length, @length_hits_at, @heel_height, @walk_support, @toe_shape, @shoe_type, @style_profile_json)
  `).run({
    ...piece,
    colors: JSON.stringify(piece.colors), occasions: JSON.stringify(piece.occasions), occasion_permissions: JSON.stringify(piece.occasion_permissions),
    fiber_content: JSON.stringify(piece.fiber_content), style_profile_json: JSON.stringify(piece.style_profile_json),
  }).lastInsertRowid)
}

let ids = {}
beforeEach(() => {
  db.prepare('DELETE FROM pieces').run()
  ids = {
    tops: Array.from({ length: 6 }, (_, i) => insertPiece({ name: `plan top ${i + 1}`, category: 'top' })),
    bottoms: Array.from({ length: 4 }, (_, i) => insertPiece({ name: `plan bottom ${i + 1}`, category: 'bottom' })),
    shoes: Array.from({ length: 3 }, (_, i) => insertPiece({ name: `plan shoes ${i + 1}`, category: 'shoes', heel_height: 'flat', walk_support: 'high' })),
  }
})

const piece = (id, category) => ({ id, name: `piece ${id}`, category })

const rosterOf = list => ({ roster_piece_ids: list, packing_reasoning: 'soft hosting looks, a sharper dinner', piece_jobs: list.map(id => ({ piece_id: id, job: 'a look' })), repair_changes: [] })

test('a coordinated plan: the stylist chooses the roster with the trip mechanism, one composition call, accepted by submit_plan_outfits; a decline lowers the slot and is disclosed', async () => {
  let rosterCalls = 0
  let seenRequest = null
  let composedWorkbench = null
  const toolContext = {
    declaredIntent: { want: 'cards' },
    generatedOutfits: [],
    question: 'guests staying with us Wednesday to Saturday, dinner out Friday',
    choosePlanRoster: async request => {
      rosterCalls += 1
      seenRequest = request
      return rosterOf([ids.tops[0], ids.tops[1], ids.bottoms[0], ids.shoes[0]])
    },
    composeCoordinatedPlanOnce: async workbench => {
      composedWorkbench = workbench
      const [hosting, dinner] = workbench.slots
      return {
        outfits: [{ slot_id: hosting.id, piece_ids: [ids.tops[0], ids.bottoms[0], ids.shoes[0]], title: 'Hosting', reason: 'Easy and put together.', cold_layer_decision: { mode: 'not_required', assigned_layer_piece_id: null } }],
        slotGaps: [{ slot_id: dinner.id, gap_reason: 'nothing dressy enough for a restaurant among these' }],
      }
    },
  }
  const result = await executeTool('plan_outfit_set', {
    plan_kind: 'coordinated_plan',
    slots: [
      { label: 'Hosting at Home', occasion: 'casual', activity: 'none', environment: 'indoor', count: 1 },
      { label: 'Friday Visit', occasion: 'casual', activity: 'none', environment: 'indoor', count: 1 },
    ],
  }, toolContext)

  assert.equal(rosterCalls, 1, 'one roster call, which passed the trip coverage check')
  assert.equal(seenRequest.bench.length, 13, 'every gate-eligible piece is offered, as on a trip')
  assert.equal(seenRequest.slotLabelsById.get(ids.tops[0]).join(','), 'Hosting at Home,Friday Visit')
  const roster = new Set([ids.tops[0], ids.tops[1], ids.bottoms[0], ids.shoes[0]])
  assert.ok(composedWorkbench.slots.every(slot => slot.allowed_piece_ids.length && slot.allowed_piece_ids.every(id => roster.has(Number(id)))), 'each slot composes from her roster only')
  assert.equal(result.status, 'success', JSON.stringify(result).slice(0, 400))
  assert.equal(toolContext.generatedOutfits.length, 1)
  assert.ok((result.plan_lines || []).some(line => /Friday Visit/.test(line) && /nothing dressy enough/.test(line)), JSON.stringify(result.plan_lines))
  assert.equal(toolContext.freeformDiagnostics.coordinatedPlanCompositionCalls, 1)
  assert.equal(toolContext.freeformDiagnostics.planRosterModelCalls, 1)
})

test('a roster that cannot dress a use case is repaired once; failing that, every eligible piece is offered and the fallback is disclosed', async () => {
  const attempts = []
  const toolContext = {
    declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'a work week',
    choosePlanRoster: async request => { attempts.push(request); return rosterOf([ids.tops[0]]) },
    composeCoordinatedPlanOnce: async () => { throw new Error('provider timeout') },
  }
  const result = await executeTool('plan_outfit_set', {
    plan_kind: 'coordinated_plan',
    slots: [{ label: 'Office days', occasion: 'casual', activity: 'none', environment: 'indoor', count: 1 }],
  }, toolContext)
  assert.equal(attempts.length, 2)
  assert.equal(attempts[1].attempt, 2)
  assert.ok(attempts[1].failures.length, 'the repair is told what was missing')
  assert.equal(toolContext.pendingPlan.planRosterSource, 'bench_fallback')
  assert.ok(toolContext.pendingPlan.coverageGaps.some(gap => /plan roster: the stylist's garment selection could not dress every use case/.test(gap)))
  assert.equal(toolContext.freeformDiagnostics.planRosterModelFallbacks, 1)
})

test('if the plan composition call fails, the plan falls back to the tool loop with her roster', async () => {
  const toolContext = {
    declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'a work week',
    choosePlanRoster: async () => rosterOf([ids.tops[2], ids.bottoms[1], ids.shoes[1]]),
    composeCoordinatedPlanOnce: async () => { throw new Error('provider timeout') },
  }
  const result = await executeTool('plan_outfit_set', {
    plan_kind: 'coordinated_plan',
    slots: [{ label: 'Office days', occasion: 'casual', activity: 'none', environment: 'indoor', count: 1 }],
  }, toolContext)
  assert.match(result.message, /Compose the plan yourself and call submit_plan_outfits/)
  assert.deepEqual(new Set(result.slots[0].allowed_piece_ids), new Set([ids.tops[2], ids.bottoms[1], ids.shoes[1]]))
  assert.equal(toolContext.pendingPlan.planRosterSource, 'model')
  assert.deepEqual(toolContext.pendingPlan.planRosterJobs.map(job => job.pieceId).sort(), [ids.tops[2], ids.bottoms[1], ids.shoes[1]].sort())
  assert.equal(toolContext.freeformDiagnostics.coordinatedPlanCompositionFallbacks, 1)
})

test('a roster larger than the per-slot workbench limit reaches the slot whole', async () => {
  db.prepare('DELETE FROM pieces').run()
  const many = Array.from({ length: 50 }, (_, i) => insertPiece({ name: `many top ${i + 1}`, category: 'top' }))
  const bottom = insertPiece({ name: 'one bottom', category: 'bottom' })
  const shoe = insertPiece({ name: 'one shoe', category: 'shoes', heel_height: 'flat', walk_support: 'high' })
  const toolContext = {
    declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'a work week',
    choosePlanRoster: async () => rosterOf([...many, bottom, shoe]),
    composeCoordinatedPlanOnce: async () => { throw new Error('not needed') },
  }
  const result = await executeTool('plan_outfit_set', {
    plan_kind: 'coordinated_plan',
    slots: [{ label: 'Office days', occasion: 'casual', activity: 'none', environment: 'indoor', count: 1 }],
  }, toolContext)
  assert.equal(result.slots[0].allowed_piece_ids.length, 52)
})

test('trips and capsules never call the plan chooser; a trip still uses its own', async () => {
  let coordinatedCalls = 0
  let tripCalls = 0
  const toolContext = {
    declaredIntent: { want: 'cards' },
    generatedOutfits: [],
    question: 'a week in the city',
    choosePlanRoster: async () => { coordinatedCalls += 1; return rosterOf([]) },
    chooseTripRoster: async ({ bench }) => { tripCalls += 1; return { roster_piece_ids: bench.map(entry => Number(entry.id)) } },
    composeTripPlanOnce: async workbench => [{ slot_id: workbench.slots[0].id, piece_ids: [ids.tops[0], ids.bottoms[0], ids.shoes[0]], title: 'City', reason: 'x', cold_layer_decision: { mode: 'not_required', assigned_layer_piece_id: null } }],
  }
  await executeTool('plan_outfit_set', { plan_kind: 'trip', slots: [{ label: 'City Days', occasion: 'city', activity: 'walking', count: 1 }] }, toolContext)
  assert.equal(coordinatedCalls, 0)
  assert.equal(tripCalls, 1)
})

test('one roster prompt for every plan: the trip\'s, with only its packing paragraphs left out; it reads the request in the person\'s words and each use case\'s season', () => {
  const system = tripRosterSelectionSystemPrompt({ planKind: 'coordinated_plan' })
  assert.match(system, /Nothing is being packed/)
  assert.match(system, /a garment you leave out cannot be used/)
  assert.doesNotMatch(system, /suitcase|5-4-3-2-1|travels well/i)
  assert.match(tripRosterSelectionSystemPrompt(), /suitcase/, 'the trip prompt keeps its packing contract')
  // The trip's lessons that are not about packing reach every plan (owner, 2026-10-28).
  assert.match(system, /- Where the warmth comes from: a coat comes off indoors/)
  assert.match(system, /- What layers are for:/)
  assert.match(system, /INDEPENDENT WEARABILITY:/)
  assert.match(system, /FOOTWEAR THAT SUITS EACH JOB:/)
  assert.match(system, /STYLE CONSTITUTION — BODY CONTRACT:/)
  for (const tripOnly of [/HOW A DAY AWAY WORKS/, /HOW THE TRAVELLER PACKS/, /REUSE ACROSS USE CASES/, /How it comes out of the bag/, /A DISTINCT JOB FOR EVERY BULKY PIECE/, /THE USE CASES ARE NOT A SCHEDULE/]) {
    assert.doesNotMatch(system, tripOnly)
    assert.match(tripRosterSelectionSystemPrompt(), tripOnly)
  }
  const composer = tripPlanCompositionSystemPrompt({ planKind: 'coordinated_plan' })
  assert.match(composer, /When an outfit presents an indoor base or core separates, you may pair it with an outerwear layer/)
  assert.match(composer, /LAYERED LOOKS\./)
  assert.doesNotMatch(composer, /HOW A DAY AWAY WORKS|suitcase/)
  const text = tripRosterSelectionUserText({
    planKind: 'coordinated_plan',
    slots: [{ id: 'wed', label: 'Wednesday Hosting', occasion: 'casual', environment: 'indoor', targetOutfits: 2, stylingContext: { season: 'current season', calendarSeason: 'fall' } }],
    bench: [{ id: 5, name: 'turquoise sleeveless dress', category: 'dress', season: 'warm' }],
    slotLabelsById: new Map([[5, ['Wednesday Hosting']]]),
    requestWords: 'I have guests coming to stay with us this coming Wednesday through Saturday.',
    dateRange: { start: '2026-10-28', end: '2026-10-31' },
  })
  assert.match(text, /^THE REQUEST \(their words, oldest first\):\nI have guests coming/)
  assert.match(text, /Dates: 2026-10-28 to 2026-10-31/)
  assert.match(text, /- Wednesday Hosting \(casual, indoor, season: fall \(the current season\)\) — up to 2 outfits/)
  assert.match(text, /a garment's season is the season it is tagged to be worn in/)
  assert.match(text, /#5 turquoise sleeveless dress \| dress \|.*season:warm.*\| slots: Wednesday Hosting/)
})

test('the composition prompt carries no packing contract, and its schema has no worn_on_date', () => {
  const composer = coordinatedPlanCompositionSystemPrompt()
  assert.doesNotMatch(composer, /suitcase to make the most of[^.]*reuse|packing roster|packed suitcase/)
  assert.match(composer, /target_outfits is the most outfits a slot may have, not a quota/)
  assert.match(composer, /Nothing is being packed/)
  const schema = coordinatedPlanCompositionSchema(3)
  assert.ok(!('worn_on_date' in schema.properties.outfits.items.properties))
  assert.ok(!schema.properties.outfits.items.required.includes('worn_on_date'))
})

// 2026-10-27, guests-at-home replay: the stylist chose coordinated_plan and named the wearer's own home city, and the
// "a named location means travel" rule turned it into a trip.
test('naming the wearer\'s own home on a plan does not make it a trip; another place still does', async () => {
  const { isWearerHomeLocation } = await import('../styling-engine/tools.js')
  assert.equal(isWearerHomeLocation('Walnut Creek, California', { location: 'Walnut Creek, CA' }), true)
  assert.equal(isWearerHomeLocation('Vienna, Austria', { location: 'Walnut Creek, CA' }), false)
  let rosterCalls = 0
  const toolContext = {
    declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'guests at home this week', location: 'Walnut Creek, CA',
    choosePlanRoster: async () => { rosterCalls += 1; return rosterOf([ids.tops[0], ids.bottoms[0], ids.shoes[0]]) },
    composeCoordinatedPlanOnce: async () => { throw new Error('not needed here') },
  }
  await executeTool('plan_outfit_set', { plan_kind: 'coordinated_plan', location: 'Walnut Creek, California', slots: [{ label: 'Hosting', occasion: 'casual', activity: 'none', environment: 'indoor', count: 1 }] }, toolContext)
  assert.equal(toolContext.freeformDiagnostics.planKindResolved, 'coordinated_plan')
  assert.equal(rosterCalls, 1)
})

// Owner ruling 2026-10-27 (thread_1793159779428): an at-home plan packs nothing, so it has no rotation.
test('the plan tool tells the stylist that rotation is for packed plans only; a coordinated plan dresses every day', async () => {
  const { STYLIST_TOOLS } = await import('../styling-engine/tools.js')
  const slots = STYLIST_TOOLS.find(tool => tool.name === 'plan_outfit_set').input_schema.properties.slots.description
  assert.match(slots, /A trip packs a suitcase: estimate recurring instances \(e\.g\. 3 winery days\) and set count so a few distinct looks rotate/)
  assert.match(slots, /A coordinated_plan packs nothing and has no rotation: every day or occasion the person will be dressed for gets its own look/)
  assert.doesNotMatch(slots, /^The plan's use-case slots, in wearing order\. Estimate recurring instances/)
})

// Live thread_1793165996825: "show me these outfits" after a written plan came back as five different outfits.
test('looks the stylist already decided are validated and shown as given: no roster call, no composition', async () => {
  let rosterCalls = 0
  let compositionCalls = 0
  const toolContext = {
    declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'show me these outfits',
    choosePlanRoster: async () => { rosterCalls += 1; return rosterOf([]) },
    composeCoordinatedPlanOnce: async () => { compositionCalls += 1; return { outfits: [], slotGaps: [] } },
  }
  const result = await executeTool('plan_outfit_set', {
    plan_kind: 'coordinated_plan',
    slots: [
      { label: 'Wednesday Hosting', occasion: 'casual', activity: 'none', environment: 'indoor', count: 1, looks: [{ piece_ids: [ids.tops[0], ids.bottoms[0], ids.shoes[0]], title: 'Stripe tee and linen joggers' }] },
      { label: 'Thursday Home', occasion: 'casual', activity: 'none', environment: 'indoor', count: 1, looks: [{ piece_ids: [ids.tops[1], ids.bottoms[1], ids.shoes[1]], title: 'Mustard and emerald' }] },
    ],
  }, toolContext)
  assert.equal(result.status, 'success', JSON.stringify(result).slice(0, 400))
  assert.equal(rosterCalls, 0)
  assert.equal(compositionCalls, 0)
  assert.deepEqual(toolContext.generatedOutfits.map(outfit => outfit.pieceIds.map(Number).sort((a, b) => a - b)),
    [[ids.tops[0], ids.bottoms[0], ids.shoes[0]].sort((a, b) => a - b), [ids.tops[1], ids.bottoms[1], ids.shoes[1]].sort((a, b) => a - b)])
  assert.equal(toolContext.freeformDiagnostics.planProvidedLooks, 2)
})

test('looks on only some slots do not bypass the roster call', async () => {
  let rosterCalls = 0
  const toolContext = {
    declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'a work week',
    choosePlanRoster: async () => { rosterCalls += 1; return rosterOf([ids.tops[0], ids.tops[1], ids.bottoms[0], ids.shoes[0]]) },
    composeCoordinatedPlanOnce: async () => { throw new Error('not needed') },
  }
  await executeTool('plan_outfit_set', {
    plan_kind: 'coordinated_plan',
    slots: [
      { label: 'Monday', occasion: 'casual', activity: 'none', environment: 'indoor', count: 1, looks: [{ piece_ids: [ids.tops[0], ids.bottoms[0], ids.shoes[0]] }] },
      { label: 'Tuesday', occasion: 'casual', activity: 'none', environment: 'indoor', count: 1 },
    ],
  }, toolContext)
  assert.equal(rosterCalls, 1)
})

// Live thread_1793165996825: at 10:48 pm Pacific on Tuesday (already Wednesday in UTC) "this coming Wednesday through
// Saturday" became November 4, one day.
test('a stated weekday range is read in the user\'s time zone and ends on the stated last day', async () => {
  const { extractStatedTripDateRange } = await import('../styling-engine/stylingIntent.js')
  const text = 'I have guests coming to stay with us this coming Wednesday through Saturday.'
  const lateTuesdayPacific = new Date('2026-10-28T05:48:00Z')
  const local = extractStatedTripDateRange(text, { currentDate: lateTuesdayPacific, timeZone: 'America/Los_Angeles' })
  assert.deepEqual({ start: local.start, end: local.end, days: local.durationDays, explicit: local.hasExplicitDuration }, { start: '2026-10-28', end: '2026-10-31', days: 4, explicit: true })
  const noZone = extractStatedTripDateRange(text, { currentDate: lateTuesdayPacific })
  assert.equal(noZone.start, '2026-11-04', 'without a time zone the instant is read in UTC, as before')
  assert.equal(extractStatedTripDateRange('this Friday', { currentDate: lateTuesdayPacific, timeZone: 'America/Los_Angeles' }).end, '2026-10-30', 'a single day stays one day')
})

// Owner, 2026-10-28: nothing about packing reaches a plan that packs nothing.
test('a plan that packs nothing: reuse:maximize is dropped, a verified piece outside her set is accepted, and the summary never says packing', async () => {
  const toolContext = {
    declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'a work week',
    choosePlanRoster: async () => rosterOf([ids.tops[0], ids.bottoms[0], ids.shoes[0]]),
    composeCoordinatedPlanOnce: async () => { throw new Error('provider timeout') },
  }
  await executeTool('plan_outfit_set', {
    plan_kind: 'coordinated_plan',
    slots: [{ label: 'Office days', occasion: 'casual', activity: 'none', environment: 'indoor', count: 1 }],
    constraints: { reuse: 'maximize' },
  }, toolContext)
  assert.equal(toolContext.pendingPlan.constraints.reuse, '')
  const slot = toolContext.pendingPlan.slots[0]
  const result = await executeTool('submit_plan_outfits', { outfits: [{
    slot_id: slot.id, piece_ids: [ids.tops[3], ids.bottoms[0], ids.shoes[0]], title: 'Office', reason: 'Clean and easy.', styling_instructions: '',
    cold_layer_decision: { mode: 'not_required', assigned_layer_piece_id: null },
  }] }, toolContext)
  assert.equal(result.status, 'success', JSON.stringify(result).slice(0, 600))
  // Owner, 2026-10-29: no "Repeat Schedule" (or any reuse line) for a plan that packs nothing.
  assert.ok((result.plan_lines || []).every(line => !/Every look is distinct|Repeat schedule|reuse/i.test(line)), JSON.stringify(result.plan_lines))
  assert.ok((result.plan_lines || []).every(line => !/pack/i.test(line)), JSON.stringify(result.plan_lines))
})

test('the plan\'s shared rules reach the roster call; a selection without the piece the looks are built around is repaired', async () => {
  const attempts = []
  const toolContext = {
    declaredIntent: { want: 'cards' }, generatedOutfits: [], question: 'office looks around my new top, no repeated tops',
    choosePlanRoster: async request => {
      attempts.push(request)
      return rosterOf(attempts.length === 1 ? [ids.tops[0], ids.bottoms[0], ids.shoes[0]] : [ids.tops[0], ids.tops[5], ids.bottoms[0], ids.shoes[0]])
    },
    composeCoordinatedPlanOnce: async () => { throw new Error('provider timeout') },
  }
  await executeTool('plan_outfit_set', {
    plan_kind: 'coordinated_plan',
    slots: [{ label: 'Office days', occasion: 'casual', activity: 'none', environment: 'indoor', count: 2 }],
    constraints: { shared_anchor_ids: [ids.tops[5]], no_repeat: ['tops'] },
  }, toolContext)
  assert.deepEqual(attempts[0].constraints.anchorIds, [ids.tops[5]])
  assert.deepEqual(attempts[0].constraints.noRepeat, ['top'])
  assert.equal(attempts.length, 2)
  assert.ok(attempts[1].failures.some(failure => failure.code === 'anchor_missing' && failure.message.includes(`ID ${ids.tops[5]}`)), JSON.stringify(attempts[1].failures))
  assert.equal(toolContext.pendingPlan.planRosterSource, 'model_repaired')

  const text = tripRosterSelectionUserText({ bench: attempts[0].bench, slots: attempts[0].slots, planKind: 'coordinated_plan', constraints: attempts[0].constraints })
  assert.match(text, new RegExp(`SHARED ACROSS THE SET:\\n- Built around: plan top 6 \\(ID ${ids.tops[5]}\\)`))
  assert.match(text, /- No piece repeats across the 2 looks in: tops\./)
  assert.doesNotMatch(tripRosterSelectionUserText({ bench: attempts[0].bench, slots: attempts[0].slots }), /SHARED ACROSS THE SET/, 'nothing is added when the plan has no shared rules')
})

// Live thread_1793326366522: "from today through Sunday … the restaurant with them on Saturday" was read as Saturday
// alone; every day of the stay moved to Saturday and took Saturday's forecast.
test('a stated span from today wins over a single day named later in the message', async () => {
  const { extractStatedTripDateRange } = await import('../styling-engine/stylingIntent.js')
  const thursdayEveningPacific = new Date('2026-10-30T02:12:27Z')
  const text = 'have guests coming to stay with us from today through Sunday. We might be going out to the restaurant with them on Saturday, but we will mainly host them at home.'
  const range = extractStatedTripDateRange(text, { currentDate: thursdayEveningPacific, timeZone: 'America/Los_Angeles' })
  assert.deepEqual({ start: range.start, end: range.end, days: range.durationDays }, { start: '2026-10-29', end: '2026-11-01', days: 4 })
  const tomorrow = extractStatedTripDateRange('friends visit tomorrow to Saturday', { currentDate: thursdayEveningPacific, timeZone: 'America/Los_Angeles' })
  assert.deepEqual([tomorrow.start, tomorrow.end], ['2026-10-30', '2026-10-31'])
  assert.equal(extractStatedTripDateRange('dinner on Saturday', { currentDate: thursdayEveningPacific, timeZone: 'America/Los_Angeles' }).start, '2026-10-31', 'a single day alone is still that day')
})
