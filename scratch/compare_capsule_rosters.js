// Migration step 4 (docs/capsule-roster-selection-spec.md §8): deterministic
// roster vs model-chosen roster, on the same wardrobe, same slots, same bench.
//
// Read-only. By default it constructs NO AI client and makes NO network request:
// it reports the deterministic side, the bench the model would choose from, and
// every measure the two will be compared on. That half is free and is what makes
// the eventual billed run one command instead of a project.
//
// The model side needs one provider call per scenario and is opt-in:
//   node scratch/compare_capsule_rosters.js --with-model
// Do not pass that flag casually — see the cost note this prints.

import fs from 'fs'
import { db, parsePiece } from '../db.js'
import {
  selectCapsuleRoster,
  buildCapsuleBench,
  validateCapsuleRoster,
  capsuleOutfitCoreCapacity,
  allocateCapsuleRepresentativeRotation,
  capsuleTotalOutfitCap,
  extractStatedPalette,
  selectCapsuleRosterViaModel
} from '../styling-engine/outfitSetPlanner.js'
import { wardrobeCategoryGroup, pieceFormality } from '../styling-engine/attributes.js'
import { filterWholeWardrobePiecesForGeneration, weatherProfileFromContext } from '../styling-engine/rules.js'

const WITH_MODEL = process.argv.includes('--with-model')
// --live <file>: pin the slots from a real plan's saved capsulePlanContext, so
// both sides are measured on the ground an actual request produced rather than
// slots invented here. A synthetic "Restaurant Dinner" at occasion `evening`
// is far stricter than what the live plan actually decomposed (smart casual),
// and comparing against invented slots produced a misleading verdict once.
const LIVE_ARG_INDEX = process.argv.indexOf('--live')
const LIVE_PAYLOAD = LIVE_ARG_INDEX > -1 ? process.argv[LIVE_ARG_INDEX + 1] : null

const SCENARIOS = [
  {
    name: 'summer · mixed register',
    isSummer: true, budget: 24,
    question: 'I want a summer capsule',
    slots: [
      { id: 'home', label: 'At Home', occasion: 'casual', bestFor: 'low-key days at home', targetOutfits: 3 },
      { id: 'city', label: 'City Outings', occasion: 'city', activity: 'walking', bestFor: 'walking, museums', targetOutfits: 3 },
      { id: 'brunch', label: 'Brunch', occasion: 'smart casual', bestFor: 'brunch and galleries', targetOutfits: 2 },
      { id: 'dinner', label: 'Restaurant Dinner', occasion: 'evening', bestFor: 'restaurant dinner', environment: 'indoor', targetOutfits: 2 },
    ],
  },
  {
    name: 'summer · stated palette',
    isSummer: true, budget: 24,
    question: 'a summer capsule in black, cream and olive',
    slots: [
      { id: 'home', label: 'At Home', occasion: 'casual', bestFor: 'low-key days at home', targetOutfits: 3 },
      { id: 'city', label: 'City Outings', occasion: 'city', activity: 'walking', bestFor: 'walking, museums', targetOutfits: 3 },
      { id: 'dinner', label: 'Restaurant Dinner', occasion: 'evening', bestFor: 'restaurant dinner', environment: 'indoor', targetOutfits: 2 },
    ],
  },
  {
    name: 'winter · mixed register',
    isSummer: false, budget: 18,
    question: 'I want a winter capsule',
    slots: [
      { id: 'home', label: 'At Home', occasion: 'casual', bestFor: 'low-key days at home', targetOutfits: 3 },
      { id: 'city', label: 'City Outings', occasion: 'city', activity: 'walking', bestFor: 'walking, museums', targetOutfits: 2 },
      { id: 'dinner', label: 'Restaurant Dinner', occasion: 'evening', bestFor: 'restaurant dinner', environment: 'indoor', targetOutfits: 2 },
    ],
  },
]

const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)

function liveScenarioFrom(payloadPath) {
  const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'))
  const cards = payload.messages.slice(-1)[0].structuredOutfits || []
  const ctx = cards.find(card => card.capsulePlanContext)?.capsulePlanContext
  if (!ctx) throw new Error('no capsulePlanContext in that payload')
  const cardsPerSlot = new Map()
  for (const card of cards) {
    if (card.broken) continue
    cardsPerSlot.set(card.tripSlot, (cardsPerSlot.get(card.tripSlot) || 0) + 1)
  }
  return {
    name: 'LIVE plan slots (pinned from capsulePlanContext)',
    isSummer: !ctx.is_winter_capsule,
    budget: ctx.piece_budget,
    question: payload.messages.find(message => message.role === 'user')?.text || 'I want a summer capsule',
    slots: ctx.slots.map(slot => ({
      id: slot.id,
      label: slot.label,
      occasion: slot.occasion,
      activity: slot.activity,
      environment: slot.environment,
      bestFor: slot.label,
      weatherProfile: slot.weather_profile,
      targetOutfits: cardsPerSlot.get(slot.id) || 2,
    })),
  }
}

// Per-slot capacity means nothing without each slot's real gate result — the
// same filter buildPlanSlotWorkbench applies. Passing bare slots reports 0
// everywhere, which is a harness artifact, not a thin roster.
function gateSlotsFor(roster, slots, { isSummer, isWinter }) {
  return slots.map(slot => {
    const request = [slot.label, slot.bestFor].filter(Boolean).join('. ')
    const season = slot.environment === 'indoor' ? 'indoor' : (isSummer ? 'summer' : 'winter')
    const { allowedPieces } = filterWholeWardrobePiecesForGeneration(roster, {
      occasion: slot.occasion,
      explorationMode: 'moderate',
      // Prefer the weather the live plan actually resolved. Re-deriving it from
      // season/environment is an approximation, and approximating a gate is
      // what produced a wrong "this slot is starved" reading before.
      weatherProfile: slot.weatherProfile || weatherProfileFromContext({ mood: request, season }),
      mood: request,
      activity: slot.activity || 'none',
      request,
    })
    return { ...slot, gateAllowedIds: new Set(allowedPieces.map(piece => Number(piece.id))) }
  })
}

function describeRoster(roster, { slots, budget, isSummer, isWinter, palette, bench }) {
  const gated = gateSlotsFor(roster, slots, { isSummer, isWinter })
  const group = g => roster.filter(piece => wardrobeCategoryGroup(piece) === g).length
  const colors = new Map()
  for (const piece of roster) {
    for (const color of Array.isArray(piece.colors) ? piece.colors : []) {
      const key = String(color).toLowerCase()
      colors.set(key, (colors.get(key) || 0) + 1)
    }
  }
  const topColors = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const allocation = allocateCapsuleRepresentativeRotation(gated, roster, { cap: capsuleTotalOutfitCap(budget) })
  const verdict = validateCapsuleRoster(roster, {
    slots, budget, isSummer, isWinterCapsule: isWinter, pool: bench,
    plannedCards: allocation.reduce((sum, slot) => sum + Math.max(0, Number(slot.targetOutfits) || 0), 0),
  })
  return {
    size: roster.length,
    categories: `${group('top')}T ${group('bottom')}B ${group('dress')}D ${group('outerwear')}O ${group('shoes')}S`,
    capacity: capsuleOutfitCoreCapacity(roster, gated),
    perSlot: allocation.map(slot => `${slot.label}:${slot.capsuleSlotCapacity}`).join(' '),
    statementPieces: roster.filter(piece => String(piece.pattern_complexity || '') === 'loud').length,
    dependents: roster.filter(piece => String(piece.needs_base || '').toLowerCase() === 'yes').length,
    elevatedShoes: roster.filter(piece => wardrobeCategoryGroup(piece) === 'shoes' && ['elevated', 'dressy'].includes(String(pieceFormality(piece)))).length,
    paletteMatch: palette.length
      ? `${roster.filter(piece => (piece.colors || []).some(c => palette.includes(String(c).toLowerCase()))).length}/${roster.length}`
      : '—',
    topColors: topColors.map(([color, n]) => `${color}×${n}`).join(' '),
    valid: verdict.ok ? 'PASS' : `FAIL(${verdict.failures.map(f => f.code).join(',')})`,
    gaps: (roster.postConditionGaps || []).join(',') || '—',
  }
}

function printRow(label, d) {
  console.log(`  ${label.padEnd(22)} ${String(d.size).padStart(2)} pieces  ${d.categories.padEnd(22)} cores ${String(d.capacity).padStart(3)}  statement ${d.statementPieces}  elev-shoes ${d.elevatedShoes}  palette ${d.paletteMatch.padEnd(6)} ${d.valid}`)
  console.log(`  ${''.padEnd(22)} colours: ${d.topColors}`)
  console.log(`  ${''.padEnd(22)} per-slot capacity: ${d.perSlot}${d.gaps !== '—' ? `  | disclosed gaps: ${d.gaps}` : ''}`)
}

console.log(`wardrobe: ${allPieces.length} active pieces · model side: ${WITH_MODEL ? 'ENABLED (billed)' : 'skipped (free run)'}\n`)

const scenarios = LIVE_PAYLOAD ? [liveScenarioFrom(LIVE_PAYLOAD)] : SCENARIOS

for (const scenario of scenarios) {
  const { name, slots, budget, isSummer, question } = scenario
  const isWinter = !isSummer
  const { colors: palette } = extractStatedPalette(question, allPieces)
  const { bench, diagnostics } = buildCapsuleBench(allPieces, { budget, slots, isSummer, isWinter, benchSize: 40, palette })

  console.log(`── ${name} · budget ${budget} · "${question}"`)
  console.log(`  bench ${bench.length} (seeded with the deterministic roster, +${bench.length - budget} beyond it)` +
    `${palette.length ? ` · palette asked for: ${palette.join(', ')}` : ' · no palette stated'}` +
    `${diagnostics.uncoverableSlots.length ? ` · uncoverable: ${diagnostics.uncoverableSlots.join(', ')}` : ''}`)

  const deterministic = selectCapsuleRoster(allPieces, {
    budget, isSummer, isWinter, occasions: slots.map(s => s.occasion), slots, palette,
  })
  printRow('deterministic', describeRoster(deterministic, { slots, budget, isSummer, isWinter, palette, bench }))

  if (WITH_MODEL) {
    const { chooseCapsuleRosterForComparison } = await import('./_capsule_model_chooser.js')
    const result = await selectCapsuleRosterViaModel({
      pool: allPieces, budget, slots, isSummer, isWinter,
      occasions: slots.map(s => s.occasion), palette,
      chooseRoster: chooseCapsuleRosterForComparison,
    })
    printRow(`model (${result.source})`, describeRoster(result.roster, { slots, budget, isSummer, isWinter, palette, bench }))
    if (result.palette) console.log(`  ${''.padEnd(22)} model's palette: ${result.palette}`)
    for (const job of (result.jobs || []).slice(0, 6)) console.log(`  ${''.padEnd(22)} ${job.piece_id}: ${job.job}`)
  }
  console.log()
}

if (!WITH_MODEL) {
  console.log('The model side was not run: it needs one provider call per scenario (bench of 40 with')
  console.log('thumbnails). Everything above is the free half — the deterministic baseline and the')
  console.log('exact measures the comparison will use. Re-run with --with-model when that is affordable.')
}
