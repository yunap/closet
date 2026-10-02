// thread_1789585467294 (2026-09-16, Paso Robles trip, Hill Hiking slot): the final slot-composition
// call delivered elevated city clothing (211 black solid long shirt + 251 gray stretch slim pants)
// with hiking boots attached, described as an "optimal" hiking outfit. Diagnosis found: (1) the
// compact atomic composer had lost occasion evidence that the roster-selection stage saw; (2) the
// roster-selection prompt's "reuse... should be preferred... all else equal" framing had no
// suitability check, so lighter hiking-only tops were dropped for cross-slot-reusable dressier ones;
// (3) the composer had no honest way to disclose a weak/compromise fit, so it wrote confident
// language over a real roster gap; (4) ORIGINALLY diagnosed as a piece's `occasion_exclusions:
// ["travel"]` being silently bypassed for every slot of the trip — that "fix" was itself wrong and
// has since been reverted (thread_1789632137995, owner ruling 2026-09-17: 'travel' means transit,
// never a trip's destination activities; injecting it into every slot crashed a later live run). See
// section (e) below for the corrected behavior.
//
// This file pins the EVIDENCE AND PRIORITY CONTRACT the fix restores, not a specific expected
// outfit or garment ID — per the owner's explicit correction, the five lighter tops seen upstream
// (990351, 990582, 228, 174, 225) are "worth visual consideration", never asserted here as proven
// hiking-appropriate, and 84/114/251 are not asserted as a correct formula either.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-hill-hiking-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { tripPlanTruthCatalog, tripRosterSelectionSystemPrompt, tripPlanCompositionSystemPrompt, tripPlanCompositionSchema } = await import('../routes/ai.js')
const { sharedGarmentEvidenceLine } = await import('../styling-engine/garmentEvidenceLine.js')
const { buildPlanSlotWorkbench, validateTripCompositionPartialPlan } = await import('../styling-engine/outfitSetPlanner.js')
const { wholeWardrobePieceTrustDecision } = await import('../styling-engine/rules.js')

// ─── (a) the final slot composer receives occasions, a recorded fact, per piece ────────────────────

test('trip truth catalog states a piece\'s recorded occasions, not just its unqualified shared fact line', () => {
  const shirt = { id: 211, name: 'black solid long shirt', category: 'top', occasions: ['evening', 'smart-casual', 'city'] }
  const [line] = tripPlanTruthCatalog([shirt])
  assert.equal(line, `${sharedGarmentEvidenceLine(shirt)} | occasions: evening, smart-casual, city`)
  assert.doesNotMatch(line, /\| occasions: unknown/, 'a piece with recorded occasions must not read as unrecorded')
})

test('trip truth catalog states "occasions: unknown" for a piece with no recorded occasion tags, never inferring any', () => {
  const untaggedTop = { id: 990351, name: 'lightweight tank', category: 'top' }
  const [line] = tripPlanTruthCatalog([untaggedTop])
  assert.match(line, /\| occasions: unknown$/)
})

// ─── (b) slot quality is stated to outrank reuse/showcase pressure ─────────────────────────────────

test('the roster-selection prompt no longer tells the model to prefer a cross-use-case piece "all else equal"', () => {
  const brief = tripRosterSelectionSystemPrompt()
  assert.doesNotMatch(brief, /should be preferred over two narrower pieces that each cover only one use case, all else equal/)
  assert.match(brief, /Never prefer a cross-use-case piece over a narrower, purpose-suited candidate/)
})

test('the composition prompt states slot quality outranks showcasing the packed roster, and permits an honest DECLINE via slot_gaps rather than a per-card self-rating', () => {
  const prompt = tripPlanCompositionSystemPrompt()
  assert.doesNotMatch(prompt, /aiming for the representative rotation to showcase the core versatile pieces/)
  assert.match(prompt, /slot quality outranks showcasing the packed roster/)
  assert.match(prompt, /An unused packed piece is a better outcome than a worse-fitting outfit/)
  // thread_1789585467294 (owner ruling 2026-09-16): a required per-card confidence rating was
  // rejected — risk of confident post-hoc justification, the same failure family as the day-wear
  // explanation experiment. The honest path is a DECLINE (omit the card, name the gap), not a rating
  // attached to a card the composer still submits.
  assert.match(prompt, /DECLINE it: omit that outfit from 'outfits' and add an entry to 'slot_gaps'/)
  assert.match(prompt, /it does not carry or need a separate confidence rating/)
  assert.doesNotMatch(prompt, /fit_confidence/)
})

// ─── (d) structural capacity is not a suitability verdict, and a real slot-level decline path exists,
// distinct from any per-card self-rating ──────────────────────────────────────────────────────────

test('tripPlanCompositionSchema offers a slot-level DECLINE path (slot_gaps), and never requires a per-card confidence rating', () => {
  const schema = tripPlanCompositionSchema(2)
  const cardProps = schema.properties.outfits.items.properties
  assert.deepEqual(Object.keys(cardProps).sort(), ['cold_layer_decision', 'piece_ids', 'reason', 'slot_id', 'styling_instructions', 'title'])
  assert.ok(!schema.properties.outfits.items.required.includes('fit_confidence'), 'no card-level confidence rating is required')
  assert.ok(schema.properties.outfits.minItems < schema.properties.outfits.maxItems || schema.properties.outfits.minItems === 1, 'a specific outfit can be omitted from outfits, not forced to an exact per-slot count')

  const gapProps = schema.properties.slot_gaps.items.properties
  assert.deepEqual(Object.keys(gapProps).sort(), ['gap_reason', 'slot_id'])
  assert.deepEqual(schema.properties.slot_gaps.items.required.sort(), ['gap_reason', 'slot_id'])
  assert.match(gapProps.gap_reason.description, /decline/i)
})

test('the workbench instruction states structural_capacity is a supply fact, not an activity/weather suitability verdict', async () => {
  const piece = (id, category, extra = {}) => ({ id, name: `piece ${id}`, category, status: 'active', occasions: ['casual', 'outdoor'], ...extra })
  const top = piece(101, 'top')
  const bottom = piece(102, 'bottom')
  const shoes = piece(103, 'shoes', { heel_height: 'flat', walk_support: 'high' })
  const slots = [{ id: 's1', label: 'Hill Hiking', occasion: 'casual', activity: 'hiking', stylingContext: { occasion: 'casual', activity: 'hiking', calendarSeason: 'fall' } }]
  const workbench = await buildPlanSlotWorkbench(slots, { allPieces: [top, bottom, shoes], question: 'trip', planKind: 'trip' })
  assert.match(workbench.instructions, /structural_capacity on a slot means only that a complete garment combination exists/)
  assert.match(workbench.instructions, /not a judgment that any specific combination suits the slot's activity, register, or weather/)
  assert.ok('structural_capacity' in workbench.slots[0], 'the slot payload key itself must not be named coverage_report/coverage')
  assert.ok(!('coverage_report' in workbench.slots[0]), 'the old, suitability-conflating field name must not still be sent to the model')
})

// ─── (e) SUPERSEDED (thread_1789632137995, owner ruling 2026-09-17): `occasion_exclusions: ['travel']`
// means TRANSIT (airport time, a long car ride) — never a trip's destination activities. Injecting
// 'travel' into every slot's exclusion check was itself the bug: a live Sept 19-22 Paso Robles run
// packed linen pants (#128) excluded only from travel, assigned to Winery Days/Dinners Out, but the
// injected 'travel' entry hard-excluded it from both at composition time. Dinners Out lost its only
// eligible bottom, collapsed to target_outfits: 0, and Stage 2 crashed on the partial-plan contract
// when the model correctly produced no card and no slot_gaps entry for a slot it was told needed
// zero outfits. wholeWardrobePieceTrustDecision's array-of-occasions support (still real, still used
// by ordinary multi-occasion checks) is unchanged; only the trip-wide 'travel' injection is gone. The
// exclusion still applies exactly when a slot's own occasion genuinely IS travel/transit.

test('a piece excluded from travel is NOT excluded from an ordinary trip destination slot (Winery Days), even for plan_kind trip', async () => {
  const piece = (id, category, extra = {}) => ({ id, name: `piece ${id}`, category, status: 'active', occasions: ['casual', 'outdoor', 'evening'], ...extra })
  const excludedFromTravel = piece(128, 'bottom', { occasion_exclusions: ['travel'] })
  const backupTop = piece(201, 'top')
  const shoes = piece(203, 'shoes', { heel_height: 'flat', walk_support: 'high' })
  const slots = [{ id: 's1', label: 'Winery Days', occasion: 'outdoor_daytime_social', activity: 'walking', stylingContext: { occasion: 'outdoor_daytime_social', activity: 'walking', calendarSeason: 'fall' } }]
  const tripWorkbench = await buildPlanSlotWorkbench(slots, { allPieces: [excludedFromTravel, backupTop, shoes], question: 'trip', planKind: 'trip' })
  const tripAllowedIds = new Set(tripWorkbench.slots[0].allowed_piece_ids)
  assert.ok(tripAllowedIds.has(128), 'a piece excluded only from transit is perfectly wearable at the destination, including on a trip')
})

test('a piece excluded from travel IS excluded from a slot whose own occasion genuinely is travel/transit', async () => {
  const piece = (id, category, extra = {}) => ({ id, name: `piece ${id}`, category, status: 'active', occasions: ['casual', 'travel'], ...extra })
  const excludedFromTravel = piece(128, 'bottom', { occasion_exclusions: ['travel'] })
  const backupTop = piece(201, 'top')
  const shoes = piece(203, 'shoes', { heel_height: 'flat', walk_support: 'high' })
  const slots = [{ id: 's1', label: 'Flight Day', occasion: 'travel', activity: 'none', stylingContext: { occasion: 'travel', activity: 'none', calendarSeason: 'fall' } }]
  const tripWorkbench = await buildPlanSlotWorkbench(slots, { allPieces: [excludedFromTravel, backupTop, shoes], question: 'trip', planKind: 'trip' })
  const tripAllowedIds = new Set(tripWorkbench.slots[0].allowed_piece_ids)
  assert.ok(!tripAllowedIds.has(128), 'a slot literally occasioned travel still honors the exclusion')
})

// ─── partial-plan contract (owner ruling 2026-09-16): every requested slot resolves to exactly one
// of a delivered outfit (outfits) or an explicit decline (slot_gaps) — never both, never neither,
// never an unrecognized slot_id, never a duplicated decline. The relaxed outfits.minItems only stays
// honest if this holds; validateTripCompositionPartialPlan is the check, run against the model's raw
// structured response before any domain validation. ──────────────────────────────────────────────

test('partial-plan contract: every requested slot delivered or declined, none of each, passes', () => {
  const result = validateTripCompositionPartialPlan(
    ['winery_days', 'hiking', 'dinner_out'],
    [{ slot_id: 'winery_days', piece_ids: [1] }, { slot_id: 'winery_days', piece_ids: [2] }, { slot_id: 'dinner_out', piece_ids: [3] }],
    [{ slot_id: 'hiking', gap_reason: 'no genuinely hot-weather-suited top or bottom was available' }]
  )
  assert.deepEqual(result, { valid: true, errors: [] })
})

test('partial-plan contract: an unknown slot_id in outfits fails', () => {
  const result = validateTripCompositionPartialPlan(
    ['winery_days'],
    [{ slot_id: 'winery_days' }, { slot_id: 'museum_day' }],
    []
  )
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => /unknown slot_id/.test(e) && /museum_day/.test(e)))
})

test('partial-plan contract: an unknown slot_id in slot_gaps fails', () => {
  const result = validateTripCompositionPartialPlan(
    ['winery_days'],
    [{ slot_id: 'winery_days' }],
    [{ slot_id: 'museum_day', gap_reason: 'x' }]
  )
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => /unknown slot_id/.test(e) && /museum_day/.test(e)))
})

test('partial-plan contract: a duplicate slot_gaps entry for the same slot fails', () => {
  const result = validateTripCompositionPartialPlan(
    ['hiking'],
    [],
    [{ slot_id: 'hiking', gap_reason: 'a' }, { slot_id: 'hiking', gap_reason: 'b' }]
  )
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => /duplicate|2 entries/.test(e) && /hiking/.test(e)))
})

test('partial-plan contract: a slot both delivered and declined fails', () => {
  const result = validateTripCompositionPartialPlan(
    ['hiking'],
    [{ slot_id: 'hiking', piece_ids: [1] }],
    [{ slot_id: 'hiking', gap_reason: 'a' }]
  )
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => /both delivered.*declined|delivered an outfit.*declined/.test(e) && /hiking/.test(e)))
})

test('partial-plan contract: a slot silently missing from both arrays fails — the exact live failure mode this contract exists to catch', () => {
  // thread_1789598100140 (live re-run, 2026-09-16): the Hiking slot's only submitted outfit failed a
  // later domain-validation check (an unrelated tuck-instruction conflict) with no repair path, and
  // was dropped with no slot_gaps entry ever declared for it -- this exact shape, at the raw response
  // level, is what this check exists to catch before it ever reaches validation.
  const result = validateTripCompositionPartialPlan(
    ['winery_days', 'hiking', 'dinner_out'],
    [{ slot_id: 'winery_days' }, { slot_id: 'winery_days' }, { slot_id: 'dinner_out' }],
    []
  )
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => /missing from both/.test(e) && /hiking/.test(e)))
})
