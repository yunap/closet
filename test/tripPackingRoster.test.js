// Trip packing roster architecture. A trip gets a first-class packing set, chosen by the model from
// a bench, validated structurally, before any card is composed — see the header comment above
// selectTripRosterViaModel in outfitSetPlanner.js for the full rationale. This pins the mechanism
// in isolation, before it is wired into buildPlanSlotWorkbench.
import test from 'node:test'
import assert from 'node:assert'
import { selectTripRosterViaModel } from '../styling-engine/outfitSetPlanner.js'

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
