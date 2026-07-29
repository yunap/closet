#!/usr/bin/env node

// Provider-free utility audit for thread_1785272841293's captured 24-piece
// summer roster, evaluated against the owner-ruled five lived contexts.
// Descriptive only: no scoring changes, model calls, network, or DB writes.

process.env.NODE_ENV = 'test'

const { db } = await import('../db.js')
const { parsePiece } = await import('../styling-engine/rules.js')
const { wardrobeCategoryGroup } = await import('../styling-engine/attributes.js')
const { normalizePlanSlots, buildPlanSlotWorkbench, selectCapsuleRoster } = await import('../styling-engine/outfitSetPlanner.js')

const rosterIds = [
  67, 136, 63, 364, 172, 174, 1, 71, 132, 224, 242, 128,
  93, 101, 261, 92, 97, 151, 110, 262, 169, 214, 199, 194
]
const roster = db.prepare(`SELECT * FROM pieces WHERE status = 'active' AND id IN (${rosterIds.map(() => '?').join(',')})`)
  .all(...rosterIds)
  .map(parsePiece)
const piecesById = new Map(roster.map(piece => [Number(piece.id), piece]))

const capturedCasualIds = [364, 174, 1, 224, 261, 92, 110, 262, 169, 214]
const contexts = [
  { id: 'at_home', label: 'At Home', allowedIds: capturedCasualIds },
  { id: 'errands_weekends', label: 'Errands / Weekends', allowedIds: capturedCasualIds },
  { id: 'nature_walk', label: 'Nature Walk', allowedIds: [364, 174, 1, 224, 261, 92, 262, 169, 214] },
  { id: 'city_outing_museum', label: 'City Outing / Museum', allowedIds: [67, 136, 63, 364, 174, 1, 71, 224, 242, 128, 101, 261, 92, 151, 262, 169, 214, 194] },
  { id: 'restaurant_social', label: 'Restaurant / Social', allowedIds: [67, 136, 63, 364, 174, 1, 71, 224, 242, 128, 101, 261, 92, 151, 110, 262, 169, 214, 199, 194] }
]

const referenceRotation = [
  [1, 261, 169],
  [174, 110, 214],
  [364, 92, 169],
  [174, 261, 169],
  [364, 261, 214],
  [67, 242, 194],
  [71, 101, 169],
  [136, 92, 194],
  [63, 242, 194],
  [136, 128, 199],
  [174, 101, 194]
]
const rotationUse = new Map()
for (const outfit of referenceRotation) {
  for (const id of outfit) rotationUse.set(id, (rotationUse.get(id) || 0) + 1)
}

function groupPieces(ids, group) {
  return ids.map(id => piecesById.get(id)).filter(piece => wardrobeCategoryGroup(piece) === group)
}

function opportunitiesForPiece(piece) {
  const id = Number(piece.id)
  const group = wardrobeCategoryGroup(piece)
  let opportunities = 0
  for (const context of contexts) {
    if (!context.allowedIds.includes(id)) continue
    const tops = groupPieces(context.allowedIds, 'top')
    const bottoms = groupPieces(context.allowedIds, 'bottom')
    const dresses = groupPieces(context.allowedIds, 'dress')
    if (group === 'top') opportunities += bottoms.length
    else if (group === 'bottom') opportunities += tops.length
    else if (group === 'dress') opportunities += 1
    else if (group === 'shoes') opportunities += tops.length * bottoms.length + dresses.length
    else if (group === 'outerwear') opportunities += tops.length * bottoms.length + dresses.length
  }
  return opportunities
}

function structuredLayerSignal(piece) {
  const intelligence = piece?.style_profile_json?.garment_intelligence || {}
  const formulas = Array.isArray(intelligence.formula_compatibility) ? intelligence.formula_compatibility : []
  return wardrobeCategoryGroup(piece) === 'outerwear' ||
    formulas.some(formula => String(formula).toLowerCase() === 'casual layers')
}

const rows = roster.map(piece => {
  const id = Number(piece.id)
  const supportedContexts = contexts.filter(context => context.allowedIds.includes(id)).map(context => context.label)
  return {
    id,
    name: piece.name,
    group: wardrobeCategoryGroup(piece),
    formality: piece.formality || 'unknown',
    contexts: supportedContexts,
    contextCount: supportedContexts.length,
    pairingOpportunities: opportunitiesForPiece(piece),
    rotationUses: rotationUse.get(id) || 0,
    structuredLayerSignal: structuredLayerSignal(piece),
    walkSupport: piece.walk_support || '',
    heelHeight: piece.heel_height || ''
  }
})

const unused = rows.filter(row => row.rotationUses === 0)
const layers = rows.filter(row => row.structuredLayerSignal)
const shoes = rows.filter(row => row.group === 'shoes')
const contextSupply = contexts.map(context => {
  const allowed = context.allowedIds.map(id => piecesById.get(id)).filter(Boolean)
  const byGroup = {}
  for (const group of ['top', 'bottom', 'dress', 'outerwear', 'shoes']) {
    byGroup[group] = allowed.filter(piece => wardrobeCategoryGroup(piece) === group).length
  }
  return { label: context.label, byGroup }
})
const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
const tracedSlots = normalizePlanSlots([
  { label: 'At Home', occasion: 'casual', activity: 'none', environment: 'indoor', count: 2, best_for: 'Low-key days at home' },
  { label: 'Errands / Weekends', occasion: 'casual', activity: 'none', count: 1, best_for: 'Errands and weekends out' },
  { label: 'Nature Walk', occasion: 'casual', activity: 'walking', count: 2, best_for: 'Dog walks and nature paths' },
  { label: 'City Outing / Museum', occasion: 'city', activity: 'walking', count: 3, best_for: 'Museums and city exploring' },
  { label: 'Restaurant / Social', occasion: 'smart casual', activity: 'none', environment: 'indoor', count: 3, best_for: 'Restaurants and social events' }
], { fallbackWeather: 'warm, summer', maxTotalOutfits: 12 })
const tracedWorkbench = await buildPlanSlotWorkbench(tracedSlots, {
  // Trace the captured roster against the real gates without running it
  // through today's capsule selector first; otherwise a correctly prefiltered
  // piece disappears before its suppression reason can be audited.
  constraints: { reuse: 'maximize' },
  allPieces,
  question: 'summer capsule for home, errands, nature walks, museums, restaurants',
  planKind: 'coordinated_plan'
})
function gateStateForId(id) {
  const slotStates = tracedWorkbench.pendingPlan.slots.map(slot => {
    const reasons = slot.suppressedReasonsById?.get(id) || []
    return { label: slot.label, eligible: reasons.length === 0, reasons }
  })
  return {
    eligibleSlots: slotStates.filter(state => state.eligible),
    blockedSlots: slotStates.filter(state => !state.eligible)
  }
}
const gateStateById = new Map(rows.map(row => [row.id, gateStateForId(row.id)]))
const gateBlocked = rows.filter(row => gateStateById.get(row.id).eligibleSlots.length === 0)
const eligibleUnused = unused.filter(row => gateStateById.get(row.id).eligibleSlots.length > 0)
const used = rows.filter(row => row.rotationUses > 0)
const currentRoster = selectCapsuleRoster(allPieces, {
  budget: 24,
  isSummer: true,
  occasions: tracedSlots.map(slot => slot.occasion),
  slots: tracedSlots
})
const currentBlocked = currentRoster.filter(piece => gateStateForId(Number(piece.id)).eligibleSlots.length === 0)
const currentIds = new Set(currentRoster.map(piece => Number(piece.id)))
const historicalIds = new Set(rosterIds)
const removedByCurrentSelector = roster.filter(piece => !currentIds.has(Number(piece.id)))
const addedByCurrentSelector = currentRoster.filter(piece => !historicalIds.has(Number(piece.id)))

console.log('summer capsule roster utility audit — structured data only')
console.log('provider calls: 0; network calls: 0; database writes: 0')
console.log(`roster pieces: ${rows.length}; used: ${used.length}; eligible but unused: ${eligibleUnused.length}; blocked in every slot: ${gateBlocked.length}`)
console.log(`current selector: ${currentRoster.length} pieces; blocked in every slot: ${currentBlocked.length}`)
console.log(`current selector removed: ${removedByCurrentSelector.map(piece => `${piece.id}:${piece.name}`).join(' | ') || 'none'}`)
console.log(`current selector added: ${addedByCurrentSelector.map(piece => `${piece.id}:${piece.name}`).join(' | ') || 'none'}`)
for (const context of contextSupply) console.log(`${context.label}: ${JSON.stringify(context.byGroup)}`)
console.log(`layer signals: ${layers.length ? layers.map(row => `${row.id}:${row.name} [stored as ${row.group}]`).join(' | ') : 'none'}`)
console.log(`shoes: ${shoes.map(row => `${row.id}:${row.name} [heel=${row.heelHeight || 'unknown'}, support=${row.walkSupport || 'unknown'}, contexts=${row.contextCount}]`).join(' | ')}`)
console.log('unused roster pieces:')
for (const row of unused) {
  const gateState = gateStateById.get(row.id)
  const state = gateState.eligibleSlots.length ? 'eligible but unused' : 'blocked'
  console.log(`- ${row.id}:${row.name} [${row.group}; ${state}; eligible slots=${gateState.eligibleSlots.length}; captured contexts=${row.contextCount}; captured opportunities=${row.pairingOpportunities}]`)
}
console.log('all-slot gate blocks:')
for (const row of gateBlocked) {
  const reasons = gateStateById.get(row.id).blockedSlots.map(slot => `${slot.label}=${slot.reasons.join(' | ')}`)
  console.log(`- ${row.id}:${row.name}: ${reasons.join('; ')}`)
}
console.log('lowest captured-rotation pairing opportunity pieces:')
for (const row of [...rows].sort((a, b) => a.pairingOpportunities - b.pairingOpportunities || a.id - b.id).slice(0, 8)) {
  console.log(`- ${row.id}:${row.name} [${row.group}; contexts=${row.contextCount}; opportunities=${row.pairingOpportunities}; rotation=${row.rotationUses}]`)
}

if (rows.length !== rosterIds.length || currentBlocked.length) process.exitCode = 1

db.close()
