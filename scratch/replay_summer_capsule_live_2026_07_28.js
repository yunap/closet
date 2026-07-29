#!/usr/bin/env node

// Provider-free replay of thread_1785272841293's exact 24-piece summer
// roster and captured gates, with the owner-ruled home/errands split. It proves the roster can supply
// the full 11-look representative rotation under the corrected seasonal
// rules, while raw validator detail stays out of production plan notes.
// Read-only: no model client, network request, or database write.

process.env.NODE_ENV = 'test'

const { db } = await import('../db.js')
const { parsePiece } = await import('../styling-engine/rules.js')
const {
  validateSubmittedPlanOutfits,
  assembleSubmittedPlanOutfits
} = await import('../styling-engine/outfitSetPlanner.js')

const rosterIds = [
  67, 136, 63, 364, 172, 174, 1, 71, 132, 224, 242, 128,
  93, 101, 261, 92, 97, 151, 110, 262, 169, 214, 199, 194
]
const roster = db.prepare(`SELECT * FROM pieces WHERE status = 'active' AND id IN (${rosterIds.map(() => '?').join(',')})`)
  .all(...rosterIds)
  .map(parsePiece)
const piecesById = new Map(roster.map(piece => [Number(piece.id), piece]))

function capturedSlot({ id, label, occasion, activity, environment, targetOutfits, allowedIds, weatherProfile }) {
  const gateAllowedIds = new Set(allowedIds)
  return {
    id,
    label,
    occasion,
    activity,
    environment,
    targetOutfits,
    gateAllowedIds,
    rosterIds: gateAllowedIds,
    allowedPieces: allowedIds.map(pieceId => piecesById.get(pieceId)).filter(Boolean),
    weatherProfile,
    weatherLabel: environment === 'indoor' ? 'indoor' : 'warm, summer (estimated)'
  }
}

const slots = [
  capturedSlot({
    id: 'at_home',
    label: 'At Home',
    occasion: 'casual',
    activity: 'none',
    environment: 'indoor',
    targetOutfits: 2,
    allowedIds: [364, 174, 1, 224, 261, 92, 110, 262, 169, 214],
    weatherProfile: { isHot: false, isCold: false, weatherSource: 'stated' }
  }),
  capturedSlot({
    id: 'errands_weekends',
    label: 'Errands / Weekends',
    occasion: 'casual',
    activity: 'none',
    environment: 'outdoor',
    targetOutfits: 1,
    allowedIds: [364, 174, 1, 224, 261, 92, 110, 262, 169, 214],
    weatherProfile: { isHot: true, isCold: false, weatherSource: 'heuristic' }
  }),
  capturedSlot({
    id: 'nature_walk',
    label: 'Nature Walk',
    occasion: 'casual',
    activity: 'walking',
    environment: 'outdoor',
    targetOutfits: 2,
    allowedIds: [364, 174, 1, 224, 261, 92, 262, 169, 214],
    weatherProfile: { isHot: true, isCold: false, weatherSource: 'heuristic' }
  }),
  capturedSlot({
    id: 'city_outing_museum',
    label: 'City Outing / Museum',
    occasion: 'city',
    activity: 'walking',
    environment: 'outdoor',
    targetOutfits: 3,
    allowedIds: [67, 136, 63, 364, 174, 1, 71, 224, 242, 128, 101, 261, 92, 151, 262, 169, 214, 194],
    weatherProfile: { isHot: true, isCold: false, weatherSource: 'heuristic' }
  }),
  capturedSlot({
    id: 'restaurant_social',
    label: 'Restaurant / Social',
    occasion: 'smart casual',
    activity: 'none',
    environment: 'indoor',
    targetOutfits: 3,
    allowedIds: [67, 136, 63, 364, 174, 1, 71, 224, 242, 128, 101, 261, 92, 151, 110, 262, 169, 214, 199, 194],
    weatherProfile: { isHot: false, isCold: false, weatherSource: 'stated' }
  })
]

const pendingPlan = {
  planKind: 'seasonal_capsule',
  isSeasonalCapsule: true,
  suppressModelCoverageGaps: true,
  slots,
  piecesById,
  constraints: {
    reuse: 'maximize',
    noRepeat: new Set(),
    allowRepeat: new Set(['shoes', 'outerwear']),
    anchorIds: new Set(),
    pieceBudget: 24
  },
  capsuleRoster: roster,
  capsuleCapacity: 57,
  coverageGaps: [],
  slotWeather: slots.map((slot, order) => ({ label: slot.label, weather: slot.weatherLabel, order })),
  heldOutfits: []
}

// This is a structural reference rotation, not an aesthetic recommendation.
// It intentionally uses the exact captured roster/gates to prove that the
// earlier 8/11 result was composition failure, not wardrobe scarcity.
const submissions = [
  { slot_id: 'at_home', title: 'Home 1', piece_ids: [1, 261, 169] },
  { slot_id: 'at_home', title: 'Home 2', piece_ids: [174, 110, 214] },
  { slot_id: 'errands_weekends', title: 'Errands 1', piece_ids: [364, 92, 169] },
  { slot_id: 'nature_walk', title: 'Nature 1', piece_ids: [174, 261, 169] },
  { slot_id: 'nature_walk', title: 'Nature 2', piece_ids: [364, 261, 214] },
  { slot_id: 'city_outing_museum', title: 'City 1', piece_ids: [67, 242, 194] },
  { slot_id: 'city_outing_museum', title: 'City 2', piece_ids: [71, 101, 169] },
  { slot_id: 'city_outing_museum', title: 'City 3', piece_ids: [136, 92, 194] },
  { slot_id: 'restaurant_social', title: 'Social 1', piece_ids: [63, 242, 194] },
  { slot_id: 'restaurant_social', title: 'Social 2', piece_ids: [136, 128, 199] },
  { slot_id: 'restaurant_social', title: 'Social 3', piece_ids: [174, 101, 194] }
]

const result = validateSubmittedPlanOutfits(pendingPlan, submissions, {
  visuallySeenPieceIds: new Set(rosterIds)
})
const assembled = assembleSubmittedPlanOutfits(pendingPlan, result.accepted)
const publicNotes = assembled[0]?.tripPlanLines || []
const rawProductionNotes = publicNotes.filter(line =>
  /\[(?:capsule|coverage) gap:|validation|bounded composition|unfilled/i.test(String(line))
)
const skirt = piecesById.get(92)

console.log('provider-free summer capsule live-fixture replay')
console.log(`roster: ${roster.length}/24 active captured pieces`)
console.log(`reference rotation: ${result.accepted.length}/${submissions.length} accepted`)
console.log(`validation failures: ${result.failures.length}`)
console.log(`raw validator lines in production notes: ${rawProductionNotes.length}`)
console.log(`botanical skirt truth: pattern=${skirt?.pattern_complexity}; reads_as=${skirt?.reads_as}; home_confidence=${skirt?.style_profile_json?.garment_intelligence?.occasion_confidence?.home}`)
for (const failure of result.failures) {
  console.log(`- ${failure.label}: ${failure.reasons.join(' | ')}`)
}

if (roster.length !== rosterIds.length ||
    result.accepted.length !== submissions.length ||
    result.failures.length ||
    rawProductionNotes.length) {
  process.exitCode = 1
}

db.close()
