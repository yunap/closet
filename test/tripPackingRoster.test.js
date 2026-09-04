// Trip packing roster architecture. A trip gets a first-class packing set, chosen by the model from
// a bench, validated structurally, before any card is composed — see the header comment above
// selectTripRosterViaModel in outfitSetPlanner.js for the full rationale. This pins the mechanism
// in isolation, before it is wired into buildPlanSlotWorkbench.
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { selectTripRosterViaModel } from '../styling-engine/outfitSetPlanner.js'
import { pieceVisualDetailPolicy } from '../styling-engine/attributes.js'

// docs/database-safety.md: routes/ai.js reaches db.js on import, so this must isolate
// WARDROBE_DB_PATH before that import or it runs db.js's migrations against the real wardrobe.db.
// A static `import ... from '../routes/ai.js'` would be hoisted above these env assignments (ES
// module imports evaluate before any other top-level code), so this uses a dynamic import instead.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-trip-roster-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const {
  modelTripRosterEnabled,
  tripRosterSelectionSchema,
  tripRosterSelectionSystemPrompt,
  tripRosterRepairText,
  tripRosterSelectionUserText,
  tripRosterSelectionContent,
} = await import('../routes/ai.js')

const piece = (id, category, extra = {}) => ({ id, name: `piece ${id}`, category, status: 'active', occasions: ['city'], ...extra })

// City and hiking pieces are occasion-scoped so they genuinely gate apart — a piece tagged only
// `city` must not pass a `casual`/hiking slot's occasion gate, or a roster missing real hiking
// pieces would incorrectly validate (caught live: identical footwear specs on both groups first
// made every fixture pass every gate, which tested nothing).
const CITY_TOP = piece(1, 'top')
const CITY_BOTTOM = piece(2, 'bottom')
const CITY_SHOES = piece(3, 'shoes', { heel_height: 'flat', walk_support: 'high' })
const HIKE_TOP = piece(4, 'top', { occasions: ['casual', 'outdoor'] })
const HIKE_BOTTOM = piece(5, 'bottom', { occasions: ['casual', 'outdoor'] })
const HIKE_SHOES = piece(6, 'shoes', { occasions: ['casual', 'outdoor'], heel_height: 'flat', walk_support: 'high' })
const HEELED_SHOES = piece(7, 'shoes', { occasions: ['casual', 'outdoor'], heel_height: 'high', walk_support: 'low' })
const JACKET = piece(8, 'outerwear', { occasions: ['city', 'casual', 'outdoor'] })
const DEPENDENT_TOP = piece(9, 'top', { occasions: ['casual', 'outdoor'], needs_base: 'yes', sleeve_length: 'sleeveless', opacity: 'sheer' })
const STANDALONE_BASE = piece(10, 'top', { occasions: ['casual', 'outdoor'], fit_on_body: 'fitted' })

const SLOTS = [
  { id: 's1', label: 'City Walking', occasion: 'city', activity: 'walking' },
  { id: 's2', label: 'Nature Walks', occasion: 'casual', activity: 'hiking' },
]
const POOL = [CITY_TOP, CITY_BOTTOM, CITY_SHOES, HIKE_TOP, HIKE_BOTTOM, HIKE_SHOES, HEELED_SHOES, JACKET]

test('the bench is coverage-guaranteed: every requested use case has a complete core inside it', async () => {
  const result = await selectTripRosterViaModel({ pool: POOL, slots: SLOTS, chooseRoster: null })
  const benchIds = new Set(result.bench.map(p => Number(p.id)))
  // No model available -> falls back to the bench itself, disclosed as a coverage gap.
  assert.equal(result.source, 'bench_fallback')
  assert.ok(result.coverageGaps.length)
  assert.ok(benchIds.has(1) && benchIds.has(2) && benchIds.has(3), 'city core must be on the bench')
  assert.ok(benchIds.has(4) && benchIds.has(5) && benchIds.has(6), 'hike core must be on the bench')
})

test('a model roster that satisfies every use case is accepted on the first attempt', async () => {
  const chooseRoster = async () => ({ roster_piece_ids: [1, 2, 3, 4, 5, 6, 8] })
  const result = await selectTripRosterViaModel({ pool: POOL, slots: SLOTS, chooseRoster })
  assert.equal(result.source, 'model')
  assert.deepEqual(result.roster.map(p => Number(p.id)).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 8])
})

test('a roster whose only hiking shoe is hard-gate-excluded is rejected, and a repair that fixes it is accepted', async () => {
  // Hiking-footwear capability needs no dedicated condition of its own: the shared hard gate already
  // excludes a heel-excluded shoe (confirmed live — evaluateAutomaticUsePiecePool returns
  // underlyingAllowed:false, code activity_profile_high_heel_unsuitable, source:'hard_gate'). Here
  // HEELED_SHOES is excluded so early it never even reaches the bench, so the first attempt fails on
  // piece_outside_bench rather than use_case_uncoverable — a different failure code, the same
  // underlying guarantee (an unwearable shoe cannot end up in a delivered roster either way), and
  // still real, concrete feedback driving a successful repair.
  const seenFailureCodes = []
  const chooseRoster = async ({ attempt, failures }) => {
    if (attempt === 1) return { roster_piece_ids: [1, 2, 4, 5, 7] } // heeled shoes only for hiking
    seenFailureCodes.push(...failures.map(f => f.code))
    return { roster_piece_ids: [1, 2, 3, 4, 5, 6] }
  }
  const result = await selectTripRosterViaModel({ pool: POOL, slots: SLOTS, chooseRoster })
  assert.equal(result.source, 'model_repaired')
  assert.ok(result.roster.some(p => Number(p.id) === 6))
  assert.ok(seenFailureCodes.length, 'the repair round must be told concretely what failed')
})

test('a roster with no path for a requested use case fails use_case_uncoverable, not a taste verdict', async () => {
  // Zero shoes at all for the hiking slot — the unambiguous trigger. Occasion tags alone
  // (`city` vs `casual`) are NOT a hard exclusion in this app (confirmed live: a city-only top passed
  // evaluateAutomaticUsePiecePool for a hiking context with zero findings) — only genuinely
  // structural gaps like "no shoe category at all" reliably produce use_case_uncoverable.
  const chooseRoster = async () => ({ roster_piece_ids: [1, 2, 4, 5] }) // hiking top+bottom, no shoe at all (city shoes deliberately excluded — its comfort specs happen to also clear hiking, confirmed live)
  const result = await selectTripRosterViaModel({ pool: POOL, slots: SLOTS, chooseRoster })
  assert.equal(result.source, 'bench_fallback')
  assert.ok(result.failures.some(f => f.code === 'use_case_uncoverable'))
})

test('a dependent top with no standalone base in the roster fails structurally', async () => {
  // A narrow pool where the ONLY tops are the dependent one and a standalone base that is NOT
  // selected into the roster — proving the base genuinely exists in supply (so this is a roster
  // defect, not a wardrobe gap the check must excuse) while not being reachable from the roster
  // itself. Occasion tags are deliberately not the lever here (see the prior two fixes): city pieces
  // are not hard-excluded from a hiking slot, so an unrelated top could otherwise mask the defect.
  const poolWithDependent = [DEPENDENT_TOP, STANDALONE_BASE, HIKE_BOTTOM, HIKE_SHOES]
  const chooseRoster = async () => ({ roster_piece_ids: [9, 5, 6] }) // dependent top, no base
  const result = await selectTripRosterViaModel({ pool: poolWithDependent, slots: [SLOTS[1]], chooseRoster })
  assert.equal(result.source, 'bench_fallback')
  assert.ok(result.failures.some(f => f.code === 'dependent_base_unavailable'))
})

test('a piece outside the bench is a contract failure, never silently dropped', async () => {
  const chooseRoster = async () => ({ roster_piece_ids: [1, 2, 3, 4, 5, 6, 999999] })
  const result = await selectTripRosterViaModel({ pool: POOL, slots: SLOTS, chooseRoster })
  assert.equal(result.source, 'bench_fallback')
  assert.ok(result.failures.some(f => f.code === 'piece_outside_bench'))
})

test('no fixed budget: the model may choose fewer or more pieces than any capsule-style quota', async () => {
  // Minimal roster that still covers both use cases with maximum reuse (the trip objective) —
  // must not be rejected for "wrong size" the way a capsule roster would be.
  const chooseRoster = async () => ({ roster_piece_ids: [1, 2, 3] }) // reuse the city core... but this fails hiking, expect rejection for THAT reason, not size
  const result = await selectTripRosterViaModel({ pool: POOL, slots: [SLOTS[0]], chooseRoster })
  assert.equal(result.source, 'model')
  assert.equal(result.roster.length, 3)
  assert.ok(!result.failures.some(f => f.code === 'roster_size'), 'trip rosters have no size contract, unlike capsules')
})

// ─── BENCH CONSTRUCTION DIVERSITY (thread_1788504927533) ────────────────────────────────────────
// The cardigan-only Vienna roster traced back to the bench the roster model was shown, not to its
// judgment: buildTripBench ranked candidates by (tripReuseScore desc, id asc), and once many pieces
// tie on reuse score (the common case), ascending id alone decided who survived capacity truncation.
// A wardrobe with 16 real jackets/coats and 6 cardigans put every cardigan in the bench and NONE of
// the 16 structured pieces in it, purely because the cardigans happened to have lower ids -- the
// model was never shown a real jacket to weigh against a cardigan. This is a property of the bench's
// own ranking, not anything specific to outerwear: the same truncation can silently narrow any
// category down to whichever construction bucket has the most low-id members. These reproduce that
// exact shape and prove the fix (diversityInterleavedByBucket) without asserting "a jacket must be
// present" anywhere -- only that every construction bucket gate-eligible for the trip gets a turn
// before capacity truncates, the same guarantee for every category, not a special case for outerwear.
const manyLowIdCardigans = [10, 11, 12, 13, 14, 15].map(id => piece(id, 'outerwear', { name: `cardigan ${id}` }))
const oneLowIdVest = piece(16, 'outerwear', { name: 'vest 16' })
const fewHighIdJackets = [900, 901, 902].map(id => piece(id, 'outerwear', { name: `jacket ${id}` }))
const fewHighIdCoats = [903, 904].map(id => piece(id, 'outerwear', { name: `coat ${id}` }))
const DIVERSITY_POOL = [CITY_TOP, CITY_BOTTOM, CITY_SHOES, ...manyLowIdCardigans, oneLowIdVest, ...fewHighIdJackets, ...fewHighIdCoats]

test('a bench capped well below total supply still contains every gate-eligible construction bucket, not just the lowest-id one', async () => {
  const result = await selectTripRosterViaModel({ pool: DIVERSITY_POOL, slots: [SLOTS[0]], chooseRoster: null, benchSize: 10 })
  const benchIds = new Set(result.bench.map(p => Number(p.id)))
  assert.ok([...benchIds].some(id => id >= 900 && id <= 902), 'a jacket-bucket piece must survive truncation even though every jacket id is higher than every cardigan id')
  assert.ok([...benchIds].some(id => id >= 903 && id <= 904), 'a coat-bucket piece must survive truncation for the same reason')
  assert.ok([...benchIds].some(id => id >= 10 && id <= 15), 'the cardigan bucket must still be represented -- this is diversity, not exclusion of the low-id bucket')
  assert.ok(benchIds.has(16), 'the single-member vest bucket must also get its turn')
  assert.equal(result.bench.length, 10, 'sanity: the cap was actually binding')
})

test('bench diversity applies to any category with many tied candidates, not only outerwear', async () => {
  // Six low-id tops, one high-id top of a materially different construction (garmentKind 'button-
  // shirt' vs the default 'tee'-adjacent bucket the plain fixtures fall into) -- same shape as the
  // outerwear case, a different category, to prove the fix is not outerwear-special-cased.
  const manyLowIdTees = [20, 21, 22, 23, 24, 25].map(id => piece(id, 'top', { name: `tee ${id}` }))
  const oneHighIdShirt = piece(950, 'top', { name: 'button-up shirt 950' })
  const pool = [CITY_BOTTOM, CITY_SHOES, ...manyLowIdTees, oneHighIdShirt]
  const result = await selectTripRosterViaModel({ pool, slots: [SLOTS[0]], chooseRoster: null, benchSize: 4 })
  const benchIds = new Set(result.bench.map(p => Number(p.id)))
  assert.ok(benchIds.has(950), 'a materially different top construction must survive truncation even at high id, same guarantee as outerwear')
})

// ─── ROSTER-LEVEL FEASIBILITY (thread_1788501349296) ────────────────────────────────────────────
// A roster chooser can return something schema-valid and every-use-case-coverable
// (tripRosterModelCalls:1, 0 repairs, 0 fallbacks looked healthy) and still be structurally unable
// to produce a single passing card, because card validation's own SET-level adequacy check
// (outfitEnvironmentalAdequacy.js's NO_REMOVABLE_COOL_LAYER) requires a layer somewhere in the
// roster whenever a slot's weather says needsRemovableCoolLayer and the slot is not already isCold
// or indoor. These pin the fix: the exact same requirement, checked against the roster BEFORE any
// card is composed, using the SAME bar (presence of an outerwear piece) the downstream check
// already uses — not a new "trips need outerwear" quota.
import { validateTripRoster } from '../styling-engine/outfitSetPlanner.js'

const layerRequiredSlot = (overrides = {}) => ({
  id: 's1', label: 'City Walking', occasion: 'city', activity: 'walking',
  stylingContext: {
    occasion: 'city', activity: 'walking',
    weatherProfile: { needsRemovableCoolLayer: true, isCold: false, highF: 63, lowF: 46 },
  },
  ...overrides,
})

test('tripRosterFailures flags a roster with zero outerwear against a slot that needs a removable cool layer, with a neutral structural message', () => {
  const result = validateTripRoster([CITY_TOP, CITY_BOTTOM, CITY_SHOES], { slots: [layerRequiredSlot()] })
  assert.equal(result.ok, false)
  const gap = result.failures.find(f => f.code === 'missing_removable_cool_layer')
  assert.ok(gap, 'a roster with no outerwear at all must fail this check')
  assert.match(gap.message, /missing required removable coverage for slots City Walking/)
  // Neutral/factual, not a styling preference -- the whole point of the distinction the owner drew.
  assert.doesNotMatch(gap.message, /stylish|cardigan|fashionable|cute/i)
})

test('tripRosterFailures does not flag missing removable coverage when no slot actually needs it (indoor, or already isCold)', () => {
  const indoorSlot = layerRequiredSlot({
    id: 's_indoor', label: 'Museum', environment: 'indoor',
    stylingContext: { weatherProfile: { needsRemovableCoolLayer: true, isCold: false } },
  })
  const alreadyColdSlot = layerRequiredSlot({
    id: 's_cold', label: 'Winter Walk',
    stylingContext: { weatherProfile: { needsRemovableCoolLayer: true, isCold: true } },
  })
  const result = validateTripRoster([CITY_TOP, CITY_BOTTOM, CITY_SHOES], { slots: [indoorSlot, alreadyColdSlot] })
  assert.ok(!result.failures.some(f => f.code === 'missing_removable_cool_layer'), 'an all-indoor or already-cold trip is never required to carry outerwear just because it is a trip')
})

test('tripRosterFailures does not flag a roster that already has an outerwear piece, whatever its job', () => {
  const result = validateTripRoster([CITY_TOP, CITY_BOTTOM, CITY_SHOES, JACKET], { slots: [layerRequiredSlot()] })
  assert.ok(!result.failures.some(f => f.code === 'missing_removable_cool_layer'))
})

// ─── COLD FLOOR: roster-level feasibility (thread_1788516198449) ────────────────────────────────
// A roster can pass the removable-cool-layer check above (it DOES contain outerwear) and still
// leave one specific isCold slot with none of it, because the only packed layer is gate-ineligible
// for that slot's own occasion/activity. Live run: the bench contained real outdoor-eligible
// jackets/coats, but the roster model selected only a city-only trench -- the hiking slot's own
// allowed_piece_ids ended up with zero outerwear at all, so submit_plan_outfits' NO_WARM_LAYER_FOR_COLD
// rejected every card composed for it, no matter what the model tried. This is knowable
// deterministically the moment the roster is chosen, reusing hasMinimumWarmLayer -- the identical
// criterion a submitted card is later held to -- rather than discovering it after several rejected
// submissions.
// occasions alone do not strictly gate a piece out (a live-earlier lesson) -- what excluded the real
// trench from the real hiking slot was its formality ('elevated'), which the register-ceiling gate
// does enforce. Matches the real piece's own tagged formality, not an invented exclusion mechanism.
const CITY_ONLY_TRENCH = piece(11, 'outerwear', { occasions: ['city', 'smart-casual'], formality: 'elevated' })

const coldHikingSlot = (overrides = {}) => ({
  id: 's_hike', label: 'Nature Walks', occasion: 'casual', activity: 'hiking',
  stylingContext: {
    occasion: 'casual', activity: 'hiking',
    weatherProfile: { isCold: true, needsRemovableCoolLayer: true, highF: 55, lowF: 40 },
  },
  ...overrides,
})

test('tripRosterFailures flags a roster whose only outerwear is gate-ineligible for an isCold slot -- the exact live-run shape', () => {
  const result = validateTripRoster([HIKE_TOP, HIKE_BOTTOM, HIKE_SHOES, CITY_ONLY_TRENCH], { slots: [coldHikingSlot()] })
  assert.equal(result.ok, false)
  const gap = result.failures.find(f => f.code === 'cold_floor_infeasible')
  assert.ok(gap, 'a roster whose only layer cannot legally reach this slot must fail this check, even though the roster is not empty of outerwear')
  assert.equal(gap.message, 'Nature Walks cannot form a cold-valid outfit from this roster: no slot-eligible qualifying warm layer or heavy main is available.')
})

test('tripRosterFailures does not flag an isCold slot whose roster contains a slot-eligible qualifying layer', () => {
  const result = validateTripRoster([HIKE_TOP, HIKE_BOTTOM, HIKE_SHOES, JACKET], { slots: [coldHikingSlot()] })
  assert.ok(!result.failures.some(f => f.code === 'cold_floor_infeasible'), 'JACKET is outdoor-eligible, so the hiking slot does have a legal path')
})

test('tripRosterFailures does not flag a slot the cold floor does not apply to (not isCold, or indoor)', () => {
  const notColdSlot = coldHikingSlot({ id: 's_mild', stylingContext: { occasion: 'casual', activity: 'hiking', weatherProfile: { isCold: false } } })
  const indoorSlot = coldHikingSlot({ id: 's_indoor', environment: 'indoor', stylingContext: { occasion: 'casual', activity: 'hiking', weatherProfile: { isCold: true, isIndoor: true } } })
  const result = validateTripRoster([HIKE_TOP, HIKE_BOTTOM, HIKE_SHOES, CITY_ONLY_TRENCH], { slots: [notColdSlot, indoorSlot] })
  assert.ok(!result.failures.some(f => f.code === 'cold_floor_infeasible'))
})

test('selectTripRosterViaModel: a chooser that picks the city-only trench over the bench\'s outdoor-eligible jacket triggers exactly one repair, not a roster handed to submit_plan_outfits doomed to fail', async () => {
  // A second, city slot -- exactly the real 4-slot trip's shape -- is required for the trench to be
  // bench-eligible at all: buildTripBench only offers a piece that is gate-eligible for at least ONE
  // requested slot, and the trench's elevated formality excludes it from the hiking slot alone.
  const citySlot = { id: 's_city', label: 'City Walking', occasion: 'city', activity: 'walking' }
  const pool = [HIKE_TOP, HIKE_BOTTOM, HIKE_SHOES, CITY_ONLY_TRENCH, JACKET]
  let attempts = 0
  const chooseRoster = async ({ attempt }) => {
    attempts++
    if (attempt === 1) return { roster_piece_ids: [4, 5, 6, 11] } // HIKE_TOP/BOTTOM/SHOES + the city-only trench, exactly the live-run mistake
    return { roster_piece_ids: [4, 5, 6, 11, 8] } // the repair round adds JACKET (id 8)
  }
  const result = await selectTripRosterViaModel({ pool, slots: [citySlot, coldHikingSlot()], chooseRoster })
  assert.equal(attempts, 2, 'the roster-level cold-floor check must reject the first attempt and trigger exactly one repair')
  assert.equal(result.source, 'model_repaired')
  assert.ok(result.roster.some(p => Number(p.id) === 8), 'the repaired roster must include the added outdoor-eligible jacket')
  assert.equal(validateTripRoster(result.roster, { slots: [coldHikingSlot()] }).ok, true)
})

test('a roster chooser that omits a required removable layer triggers exactly one roster-level repair, not silent acceptance', async () => {
  let attempts = 0
  const chooseRoster = async ({ attempt }) => {
    attempts++
    if (attempt === 1) return { roster_piece_ids: [1, 2, 3] } // tops/bottoms/shoes only, no outerwear
    return { roster_piece_ids: [1, 2, 3, 8] } // the repair round adds JACKET (id 8)
  }
  const result = await selectTripRosterViaModel({ pool: POOL, slots: [layerRequiredSlot()], chooseRoster })
  assert.equal(attempts, 2, 'the schema-valid but layer-less first roster must be rejected and trigger exactly one repair attempt')
  assert.equal(result.source, 'model_repaired')
  assert.ok(result.roster.some(p => Number(p.id) === 8), 'the repaired roster must include the added layer')
  assert.equal(validateTripRoster(result.roster, { slots: [layerRequiredSlot()] }).ok, true)
})

test('a roster chooser that never adds a qualifying layer degrades honestly to the coverage-guaranteed bench, disclosing the real gap', async () => {
  const chooseRoster = async () => ({ roster_piece_ids: [1, 2, 3] }) // never adds a layer, even after repair
  const result = await selectTripRosterViaModel({ pool: POOL, slots: [layerRequiredSlot()], chooseRoster })
  assert.equal(result.source, 'bench_fallback')
  assert.ok(result.failures.some(f => f.code === 'missing_removable_cool_layer'))
})

// ─── WIRED INTO buildPlanSlotWorkbench ──────────────────────────────────────────────────────────
import { buildPlanSlotWorkbench } from '../styling-engine/outfitSetPlanner.js'

const DINNER_TOP = piece(11, 'dress', { occasions: ['casual', 'outdoor', 'city'] })
const DINNER_SHOES = piece(12, 'shoes', { occasions: ['casual', 'outdoor', 'city'], heel_height: 'flat', walk_support: 'high' })
const WIDE_POOL = [...POOL, DINNER_TOP, DINNER_SHOES]

test('planKind trip with a chooser: card composition draws only from the selected roster, not the whole wardrobe', async () => {
  // The model deliberately leaves the dress/dinner pieces (11, 12) out of the packing roster —
  // this is the actual behavior under test: cards must not be able to reach past the roster to the
  // full wardrobe just because those pieces exist and are otherwise gate-eligible.
  const chooseRoster = async () => ({ roster_piece_ids: [1, 2, 3, 4, 5, 6, 8] })
  const slots = SLOTS.map(s => ({ ...s, stylingContext: { occasion: s.occasion, activity: s.activity, calendarSeason: 'fall' } }))
  const workbench = await buildPlanSlotWorkbench(slots, {
    allPieces: WIDE_POOL, question: 'trip', planKind: 'trip', chooseTripRoster: chooseRoster,
  })
  const allAllowedIds = new Set(workbench.slots.flatMap(s => s.allowed_piece_ids))
  assert.ok(!allAllowedIds.has(11) && !allAllowedIds.has(12), 'pieces outside the selected packing roster must not reach any card')
  assert.ok([1, 2, 3, 4, 5, 6, 8].some(id => allAllowedIds.has(id)), 'roster pieces must still reach their slots')
  assert.deepEqual(workbench.pendingPlan.tripRoster.map(p => Number(p.id)).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 8])
  assert.equal(workbench.pendingPlan.tripRosterSource, 'model')
  assert.deepEqual(workbench.pendingPlan.packingRoster.map(p => Number(p.id)).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 8])
})

test('planKind trip with NO chooser: falls through to the whole wardrobe exactly as before (no regression)', async () => {
  const slots = SLOTS.map(s => ({ ...s, stylingContext: { occasion: s.occasion, activity: s.activity, calendarSeason: 'fall' } }))
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces: WIDE_POOL, question: 'trip', planKind: 'trip' })
  assert.deepEqual(workbench.pendingPlan.tripRoster, [])
  assert.deepEqual(workbench.pendingPlan.packingRoster, [])
})

test('planKind coordinated_plan is unaffected by the trip roster wiring', async () => {
  const chooseRoster = async () => ({ roster_piece_ids: [1, 2, 3] })
  const slots = SLOTS.map(s => ({ ...s, stylingContext: { occasion: s.occasion, activity: s.activity, calendarSeason: 'fall' } }))
  const workbench = await buildPlanSlotWorkbench(slots, {
    allPieces: WIDE_POOL, question: 'a work week', planKind: 'coordinated_plan', chooseTripRoster: chooseRoster,
  })
  assert.deepEqual(workbench.pendingPlan.tripRoster, [])
})

// ─── SET LEVEL vs CARD LEVEL, through the real submission path ─────────────────────────────────
import { validateSubmittedPlanOutfits } from '../styling-engine/outfitSetPlanner.js'

test('a card with no layer of its own is accepted when the packing roster already has one, rejected when it does not', async () => {
  const chooseRoster = async () => ({ roster_piece_ids: [1, 2, 3, 8] }) // includes JACKET (id 8)
  const slots = SLOTS.map(s => ({ ...s, stylingContext: { occasion: s.occasion, activity: s.activity, calendarSeason: 'fall' } }))
  const workbench = await buildPlanSlotWorkbench([slots[0]], {
    allPieces: POOL, question: 'trip', planKind: 'trip', chooseTripRoster: chooseRoster,
  })
  // Force the exact condition under test without needing live weather resolution — this is the
  // real, planner-computed pendingPlan.packingRoster (JACKET included), only the slot's own weather
  // flag is set directly so the scenario is deterministic.
  workbench.pendingPlan.slots[0].weatherProfile = { ...workbench.pendingPlan.slots[0].weatherProfile, needsRemovableCoolLayer: true, isCold: false }

  const cityCard = { slot_id: workbench.pendingPlan.slots[0].id, piece_ids: [1, 2, 3] } // no layer on the card itself
  const withRoster = validateSubmittedPlanOutfits(workbench.pendingPlan, [cityCard])
  assert.equal(withRoster.failures.length, 0, 'the packed jacket covers it even though this card does not show it')
  assert.equal(withRoster.accepted.length, 1)

  // Same card, same weather, but the packing roster is empty (the un-wired, pre-existing behavior)
  // — the per-card requirement must still apply exactly as before.
  const noRosterPlan = { ...workbench.pendingPlan, packingRoster: [], heldOutfits: [] }
  const withoutRoster = validateSubmittedPlanOutfits(noRosterPlan, [cityCard])
  assert.ok(withoutRoster.failures.length > 0, 'without a packing roster, the card must still carry its own layer')
})

// ─── COLD FLOOR: assigned_layer_piece_ids (thread_1788508369689 arc, product ruling "use B") ─────
// A cold slot is physically different from the cool-edge case above: "packed somewhere in the
// roster" does not make THIS card's worn outfit warm. packingRosterHasLayer must NOT suppress
// NO_WARM_LAYER_FOR_COLD (that would create a real hole — a puffer packed for one mountain day
// cannot retroactively warm an unrelated thin-blouse-and-skirt cold card). Instead the card names
// the specific packed layer(s) it uses via assigned_layer_piece_ids, kept separate from piece_ids
// (a trip card is a representative CORE outfit, not a literal enumeration of every shared layer).
test('cold_layer_required is disclosed to the model as a resolved fact, true only when isCold and not indoor', async () => {
  const chooseRoster = async () => ({ roster_piece_ids: [1, 2, 3, 8] })
  const slots = SLOTS.map(s => ({ ...s, stylingContext: { occasion: s.occasion, activity: s.activity, calendarSeason: 'fall' } }))
  const coldWorkbench = await buildPlanSlotWorkbench([slots[0]], {
    allPieces: POOL, question: 'trip', planKind: 'trip', chooseTripRoster: chooseRoster,
  })
  assert.equal(coldWorkbench.slots[0].cold_layer_required, false, 'weather was never forced cold in this build, so the fact must read false, not a stale default')
})

test('a genuinely cold slot rejects a core-only card with no warm layer, exactly as before', async () => {
  const chooseRoster = async () => ({ roster_piece_ids: [1, 2, 3, 8] }) // JACKET (id 8) is packed
  const slots = SLOTS.map(s => ({ ...s, stylingContext: { occasion: s.occasion, activity: s.activity, calendarSeason: 'fall' } }))
  const workbench = await buildPlanSlotWorkbench([slots[0]], {
    allPieces: POOL, question: 'trip', planKind: 'trip', chooseTripRoster: chooseRoster,
  })
  workbench.pendingPlan.slots[0].weatherProfile = { ...workbench.pendingPlan.slots[0].weatherProfile, isCold: true }

  const coreOnlyCard = { slot_id: workbench.pendingPlan.slots[0].id, piece_ids: [1, 2, 3] } // no layer, no assignment
  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [coreOnlyCard])
  assert.equal(result.accepted.length, 0)
  assert.ok(result.failures.some(f => f.reasons.some(r => r.includes('no warm layer for cold weather'))),
    'packingRosterHasLayer must NOT suppress the cold floor — a jacket existing in the roster does not warm an outfit that does not use it')
})

test('assigned_layer_piece_ids lets a cold card pass using a packed layer it does not visually enumerate in piece_ids', async () => {
  const chooseRoster = async () => ({ roster_piece_ids: [1, 2, 3, 8] })
  const slots = SLOTS.map(s => ({ ...s, stylingContext: { occasion: s.occasion, activity: s.activity, calendarSeason: 'fall' } }))
  const workbench = await buildPlanSlotWorkbench([slots[0]], {
    allPieces: POOL, question: 'trip', planKind: 'trip', chooseTripRoster: chooseRoster,
  })
  workbench.pendingPlan.slots[0].weatherProfile = { ...workbench.pendingPlan.slots[0].weatherProfile, isCold: true }

  const assignedCard = { slot_id: workbench.pendingPlan.slots[0].id, piece_ids: [1, 2, 3], assigned_layer_piece_ids: [8] }
  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [assignedCard])
  assert.equal(result.failures.length, 0)
  assert.equal(result.accepted.length, 1)
  const accepted = result.accepted[0]
  assert.deepEqual(accepted.pieceIds.sort((a, b) => a - b), [1, 2, 3], 'the assigned layer must not join the card\'s own core piece_ids')
  assert.ok(!accepted.pieces.some(p => Number(p.id) === 8), 'the assigned layer must not join the card\'s own pieces either')
  assert.deepEqual(accepted.assignedLayerIds, [8], 'the relation itself must still be recorded on the accepted outfit')
})

test('an assigned layer outside the packing roster or ineligible for the slot is rejected, not silently trusted', async () => {
  const chooseRoster = async () => ({ roster_piece_ids: [1, 2, 3] }) // JACKET (id 8) deliberately NOT packed
  const slots = SLOTS.map(s => ({ ...s, stylingContext: { occasion: s.occasion, activity: s.activity, calendarSeason: 'fall' } }))
  const workbench = await buildPlanSlotWorkbench([slots[0]], {
    allPieces: POOL, question: 'trip', planKind: 'trip', chooseTripRoster: chooseRoster,
  })
  workbench.pendingPlan.slots[0].weatherProfile = { ...workbench.pendingPlan.slots[0].weatherProfile, isCold: true }

  const assignedCard = { slot_id: workbench.pendingPlan.slots[0].id, piece_ids: [1, 2, 3], assigned_layer_piece_ids: [8] }
  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [assignedCard])
  assert.equal(result.accepted.length, 0)
  assert.ok(result.failures.some(f => f.reasons.some(r => r.includes('not eligible as a layer'))))
})

test('an assigned layer that is packed and slot-eligible but still not warm enough leaves the cold floor unsatisfied', async () => {
  // A second outerwear piece that is genuinely eligible for the slot but thin (no fabric_weight
  // set, no heavy main) — hasMinimumWarmLayer should still accept it, since it IS category
  // 'outerwear' regardless of weight (the presence bar, per hasMinimumWarmLayer's own comment: "it
  // accepts a heavy main INSTEAD of a layer" -- any outerwear piece already satisfies presence).
  // So to prove the merge doesn't blindly trust ANY assigned id, use a non-outerwear piece that
  // passes the slot's gates but cannot satisfy hasMinimumWarmLayer on its own.
  const thinTop = piece(20, 'top', { name: 'thin top' })
  const pool = [...POOL, thinTop]
  const chooseRoster = async () => ({ roster_piece_ids: [1, 2, 3, 20] })
  const slots = SLOTS.map(s => ({ ...s, stylingContext: { occasion: s.occasion, activity: s.activity, calendarSeason: 'fall' } }))
  const workbench = await buildPlanSlotWorkbench([slots[0]], {
    allPieces: pool, question: 'trip', planKind: 'trip', chooseTripRoster: chooseRoster,
  })
  workbench.pendingPlan.slots[0].weatherProfile = { ...workbench.pendingPlan.slots[0].weatherProfile, isCold: true }

  const assignedCard = { slot_id: workbench.pendingPlan.slots[0].id, piece_ids: [1, 2, 3], assigned_layer_piece_ids: [20] }
  const result = validateSubmittedPlanOutfits(workbench.pendingPlan, [assignedCard])
  assert.equal(result.accepted.length, 0)
  assert.ok(result.failures.some(f => f.reasons.some(r => r.includes('no warm layer for cold weather'))),
    'an eligible but non-warming assigned piece must not manufacture a pass — this is a real environmental check, not a rubber stamp')
})

// ─── WHAT TO PACK surface ────────────────────────────────────────────────────────────────────────
import { assembleSubmittedPlanOutfits } from '../styling-engine/outfitSetPlanner.js'

test('the packed roster is exposed as its own first-class object, distinct from the cards', () => {
  const cardPieces = [
    { id: 1, name: 'city top', category: 'top' },
    { id: 2, name: 'city pants', category: 'bottom' },
    { id: 3, name: 'city shoes', category: 'shoes' },
  ]
  // JACKET (id 8) is in the packing roster but NOT on this card — exactly the "engine knows the
  // jacket is packed, the card doesn't show it" scenario this surface exists to make visible.
  const tripRoster = [...cardPieces, { id: 8, name: 'shared jacket', category: 'outerwear' }]
  const slot = { id: 'city_walking', label: 'City Walking', targetOutfits: 1, originalIndex: 0 }
  const assembled = assembleSubmittedPlanOutfits({
    slots: [slot], constraints: {}, slotWeather: [], tripRoster,
  }, [{ _slotId: 'city_walking', title: 'City Look', pieces: cardPieces, pieceIds: [1, 2, 3], reason: 'r' }])

  const outfit = assembled[0]
  // Structured, client-facing: the roster as its own object, not folded into the card.
  assert.ok(outfit.tripPlanContext, 'a trip roster must produce a first-class tripPlanContext')
  assert.deepEqual(outfit.tripPlanContext.roster_ids.sort((a, b) => a - b), [1, 2, 3, 8])
  assert.ok(outfit.tripPlanContext.roster_pieces.some(p => p.id === 8), 'the jacket must be visible in the roster even though no card shows it')

  // Text surface: WHAT TO PACK is its own line, separate from the card, and names the
  // undemonstrated piece explicitly rather than annotating the card itself.
  const packLine = outfit.tripPlanLines.find(l => l.startsWith('WHAT TO PACK'))
  assert.ok(packLine, 'plan_lines must carry a WHAT TO PACK section')
  assert.match(packLine, /shared jacket/)
  const undemonstratedLine = outfit.tripPlanLines.find(l => l.startsWith('Packed but not shown'))
  assert.ok(undemonstratedLine)
  assert.match(undemonstratedLine, /shared jacket/)
  assert.ok(outfit.tripPlanLines.some(l => l.startsWith('OUTFITS:')), 'plan_lines must separate the outfit count from the packing list')

  // The card itself carries no per-card annotation about the jacket — the point of the
  // architecture is to stop making every card prove the set, not to relocate the same noise.
  assert.ok(!outfit.reason?.includes('jacket'))
})

// chooseTripRosterWithProvider (routes/ai.js) — the production chooser that was missing entirely
// (thread_1788484052964, thread_1788488744055): plan_kind resolved to 'trip' but nothing ever
// called the real model with a trip-shaped request. These pin the offline-assertable half of that
// contract, the same way plan_outfit_set.test.js pins capsuleRosterSelectionSchema/Content/etc
// without invoking the provider itself.

test('modelTripRosterEnabled defaults on and respects the env override', () => {
  const original = process.env.WARDROBE_MODEL_TRIP_ROSTER
  try {
    delete process.env.WARDROBE_MODEL_TRIP_ROSTER
    assert.equal(modelTripRosterEnabled(), true)
    process.env.WARDROBE_MODEL_TRIP_ROSTER = 'false'
    assert.equal(modelTripRosterEnabled(), false)
  } finally {
    if (original === undefined) delete process.env.WARDROBE_MODEL_TRIP_ROSTER
    else process.env.WARDROBE_MODEL_TRIP_ROSTER = original
  }
})

test('the trip roster schema has no fixed size, unlike the capsule roster', () => {
  const schema = tripRosterSelectionSchema()
  assert.equal(schema.properties.roster_piece_ids.minItems, 1)
  assert.equal('maxItems' in schema.properties.roster_piece_ids, false, 'packing efficiency is a model judgment call, not a budget')
  assert.ok(schema.required.includes('roster_piece_ids'))
  assert.ok(schema.required.includes('repair_changes'))
  assert.equal('palette' in schema.properties, false, 'a suitcase has no palette contract')
  assert.equal('category_counts' in schema.properties, false, 'a suitcase has no category starting shape')
})

test('the trip roster system prompt asks for cross-use-case reuse, not capsule palette/shape judgment', () => {
  const brief = tripRosterSelectionSystemPrompt()
  assert.match(brief, /REUSE ACROSS USE CASES IS THE POINT/)
  assert.match(brief, /no fixed count/i)
  assert.doesNotMatch(brief, /PALETTE CONTRACT/)
  assert.doesNotMatch(brief, /category_shape_reason/)
  // Same prompt for both attempts (mirrors the capsule contract): a repair is a correction, held
  // to the same standard, not a fresh brief.
  assert.equal(tripRosterSelectionSystemPrompt(), tripRosterSelectionSystemPrompt())
})

// thread_1788504927533, Part 2: the outerwear/layering judgment belongs to the model ("cardigan vs
// jacket for this particular 65/48°F week" is exactly the contextual judgment deterministic code
// cannot honestly make) -- the prompt's job is only to make sure the model actually weighs it, the
// same way it is already asked to weigh footwear jobs, using the supplied garment facts. This must
// never harden into a category preference; that would just sneak the rejected deterministic rule
// back in through prompt text instead of code.
test('the trip roster system prompt asks the model to judge layering/outerwear strategy from garment facts, without preferring any category', () => {
  const brief = tripRosterSelectionSystemPrompt()
  assert.match(brief, /LAYERING \/ OUTERWEAR THAT SUITS THE TRIP/)
  assert.match(brief, /repeated outdoor time, transitions between indoor and outdoor settings, and variation across the stay/)
  assert.match(brief, /construction, warmth, insulation, weather-protection, and removability facts/)
  assert.doesNotMatch(brief, /prefer (a |)(jacket|coat)/i, 'must not harden into a category preference — that is the deterministic rule this session explicitly rejected, now smuggled into prose instead of code')
  assert.doesNotMatch(brief, /must (pack|include|choose) a (jacket|coat)/i)
  assert.doesNotMatch(brief, /cardigans? (is|are) not (enough|sufficient|adequate)/i, 'must not single out cardigans as inherently inadequate — the judgment is contextual, not garment-kind-based')
})

test('the trip roster repair text states the previous IDs and the exact structural reasons', () => {
  const repair = tripRosterRepairText({
    failures: [{ code: 'use_case_uncoverable', message: 'Nature Walks has 0 eligible shoe(s)' }],
    previousRosterIds: [1, 2, 3],
  })
  assert.match(repair, /YOUR PREVIOUS SELECTION WAS REJECTED/)
  assert.match(repair, /Previous IDs: \[1, 2, 3\]/)
  assert.match(repair, /Nature Walks has 0 eligible shoe\(s\)/)
})

test('the trip roster user text lists use cases and candidates with no budget/palette framing', () => {
  const bench = [{ id: 1, name: 'city top', category: 'top' }]
  const slots = [{ label: 'City Walking', occasion: 'city', activity: 'walking', bestFor: 'sightseeing around town' }]
  const text = tripRosterSelectionUserText({ bench, slots })
  assert.match(text, /USE CASES THIS TRIP MUST COVER/)
  assert.match(text, /sightseeing around town/)
  assert.match(text, /^ID 1: /m)
  assert.doesNotMatch(text, /CAPSULE SIZE/)
})

// thread_1788508369689 / thread_1788510320546: the same 3/2/2 trip request produced roster sizes of
// 19, 12, and 7 across three live runs, with the small rosters failing downstream on "duplicate
// outfit already accepted" -- the roster model was never told how many DISTINCT outfits each use
// case needs, only that it must be "covered" at all, so it had no way to reason about whether its
// piece counts (e.g. one bottom) could actually supply that many non-repeating cores. targetOutfits
// was already tracked on every slot object reaching this function; it just never reached the text.
test('the trip roster user text states each use case\'s required distinct-outfit count, not just that it must be covered', () => {
  const bench = [{ id: 1, name: 'city top', category: 'top' }]
  const slots = [
    { label: 'Sightseeing & Museums', occasion: 'city', activity: 'walking', bestFor: 'city sightseeing', targetOutfits: 3 },
    { label: 'Nature Walks', occasion: 'casual', activity: 'hiking', bestFor: 'trails', targetOutfits: 2 },
    { label: 'Dinners & Evenings', occasion: 'evening', bestFor: 'dinners', targetOutfits: 2 },
  ]
  const text = tripRosterSelectionUserText({ bench, slots })
  assert.match(text, /Sightseeing & Museums[\s\S]*?needs 3 distinct outfits/)
  assert.match(text, /Nature Walks[\s\S]*?needs 2 distinct outfits/)
  assert.match(text, /Dinners & Evenings[\s\S]*?needs 2 distinct outfits/)
})

test('a slot with no targetOutfits set still states a count (1), rather than omitting the requirement silently', () => {
  const bench = [{ id: 1, name: 'city top', category: 'top' }]
  const slots = [{ label: 'City Walking', occasion: 'city', bestFor: 'sightseeing' }]
  const text = tripRosterSelectionUserText({ bench, slots })
  assert.match(text, /needs 1 distinct outfit:/)
})

test('the trip roster system prompt distinguishes making a use case wearable once from provisioning enough distinct outfits for its stated count', () => {
  const brief = tripRosterSelectionSystemPrompt()
  assert.match(brief, /how many genuinely different representative looks/)
  assert.match(brief, /enough combinatorial room/)
  assert.match(brief, /without repeating the same core piece-for-piece/)
})

// Same reasoning as plan_outfit_set.test.js's capsule equivalent: the repair call must reuse the
// initial call's cache prefix (images included) instead of re-paying for every thumbnail, since the
// repair is the only point in a single run where a prompt-cache read is possible.
test('the trip roster repair call reuses the initial call cache prefix instead of re-paying for every thumbnail', () => {
  const bench = [{ id: 1, name: 'city top' }, { id: 2, name: 'city bottom' }]
  const slots = [{ label: 'City Walking', occasion: 'city', bestFor: 'sightseeing' }]
  const imageParts = bench.flatMap(piece => ([
    { type: 'text', text: `ID ${piece.id}: ${piece.name}` },
    { type: 'image', detail: 'low', source: { type: 'base64', media_type: 'image/jpeg', data: `fake-${piece.id}` } }
  ]))
  const failures = [{ code: 'use_case_uncoverable', message: 'City Walking has 0 eligible top(s)' }]

  const initial = tripRosterSelectionContent({ bench, slots, imageParts, attempt: 1, failures: [], previousRosterIds: [] })
  const repair = tripRosterSelectionContent({ bench, slots, imageParts, attempt: 2, failures, previousRosterIds: [1] })

  const lastBreakpoint = content => content.reduce((last, part, index) => (part?.cache_control ? index : last), -1)
  const initialBreak = lastBreakpoint(initial)
  const repairBreak = lastBreakpoint(repair)
  assert.ok(initialBreak > 0)
  assert.equal(initialBreak, repairBreak)
  assert.deepEqual(repair.slice(0, repairBreak + 1), initial.slice(0, repairBreak + 1))
  assert.match(repair[repair.length - 1].text, /YOUR PREVIOUS SELECTION WAS REJECTED/)
})

// ─── VISUAL-ROLE EVIDENCE SPLIT (thread_1788518048013 arc) ──────────────────────────────────────
// hero_piece/color_accent/sharpener_piece are a capsule-era STYLING-ROLE judgment (which garment
// should carry an outfit's visual weight for that planning objective), not a garment fact with any
// trip-specific meaning. Both channels that could shape trip roster selection through it -- image
// fidelity (pieceVisualDetailPolicy) and catalog text (buildPieceText/tripRosterSelectionUserText)
// -- must stop granting it special treatment there, while a capsule caller (or any other default
// caller) keeps the original behavior unchanged.
const COLOR_ACCENT_PLAIN = piece(40, 'top', {
  pattern_complexity: 'solid', fabric_category: 'cotton',
  style_profile_json: { visual_roles: ['color_accent'] },
})
const LOUD_PATTERN_PIECE = piece(41, 'top', { pattern_complexity: 'loud' })

test('pieceVisualDetailPolicy: color_accent alone earns 800px by default (capsule-unchanged), but not with useVisualRoles:false', () => {
  const withRoles = pieceVisualDetailPolicy(COLOR_ACCENT_PLAIN)
  assert.deepEqual(withRoles, { maxPx: 800, detail: 'auto' }, 'default behavior (capsule roster selection) must be unchanged')

  const withoutRoles = pieceVisualDetailPolicy(COLOR_ACCENT_PLAIN, { useVisualRoles: false })
  assert.deepEqual(withoutRoles, { maxPx: 448, detail: 'low' }, 'a styling-role tag with no trip-specific meaning must not earn higher fidelity when disabled')
})

test('pieceVisualDetailPolicy: genuine garment-intrinsic signals (pattern, texture) still earn 800px with useVisualRoles:false', () => {
  const result = pieceVisualDetailPolicy(LOUD_PATTERN_PIECE, { useVisualRoles: false })
  assert.deepEqual(result, { maxPx: 800, detail: 'auto' }, 'a genuinely hard-to-read garment must still get higher fidelity regardless of the visual-roles flag')
})

test('tripRosterSelectionUserText excludes visual roles from candidate text even when the piece carries them', () => {
  const bench = [COLOR_ACCENT_PLAIN]
  const slots = [{ label: 'City Walking', occasion: 'city', bestFor: 'sightseeing' }]
  const text = tripRosterSelectionUserText({ bench, slots })
  assert.doesNotMatch(text, /visual roles/i, 'hero_piece/color_accent must not shape the trip roster model through text either')
})

test('buildPieceText keeps surfacing visual roles by default -- only the trip roster path opts out', async () => {
  const { buildPieceText } = await import('../styling-engine/rules.js')
  const text = buildPieceText(COLOR_ACCENT_PLAIN)
  assert.match(text, /visual roles: color_accent/, 'every other caller (capsule roster selection included) must be unaffected')
})
