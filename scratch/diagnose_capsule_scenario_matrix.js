// Free capsule regression matrix. Runs the real roster selector and hard gate
// against the local wardrobe; it never constructs an AI client or makes a
// network request.
//
// Usage:
//   node scratch/diagnose_capsule_scenario_matrix.js
//   node scratch/diagnose_capsule_scenario_matrix.js --json

import { db, parsePiece } from '../db.js'
import { selectCapsuleRoster } from '../styling-engine/outfitSetPlanner.js'
import { weatherProfileFromContext } from '../styling-engine/rules.js'
import { evaluateAutomaticUsePiecePool } from '../styling-engine/eligibility.js'
import { wardrobeCategoryGroup } from '../styling-engine/attributes.js'

const JSON_OUTPUT = process.argv.includes('--json')
const BUDGETS = [10, 14, 18, 24]
const SEASONS = [
  { name: 'summer', isSummer: true, profile: { label: 'warm', warm: true, hot: false } },
  { name: 'winter', isSummer: false, profile: { label: 'cold', cold: true, warm: false, hot: false } }
]
const SCENARIOS = [
  {
    name: 'casual',
    slots: [
      { slot: 'everyday', occasion: 'casual', bestFor: 'errands and relaxed days', targetOutfits: 3 },
      { slot: 'city', occasion: 'city', bestFor: 'walking and museums', targetOutfits: 2 }
    ]
  },
  {
    name: 'mixed_register',
    slots: [
      { slot: 'everyday', occasion: 'casual', bestFor: 'errands and relaxed days', targetOutfits: 3 },
      { slot: 'social', occasion: 'smart casual', bestFor: 'brunch and galleries', targetOutfits: 3 },
      { slot: 'evening', occasion: 'evening', register: 'dressy', bestFor: 'restaurant dinner and drinks', environment: 'indoor', targetOutfits: 2 }
    ]
  },
  {
    name: 'social',
    slots: [
      { slot: 'day_social', occasion: 'outdoor daytime social', bestFor: 'markets and outdoor cafes', targetOutfits: 2 },
      { slot: 'gallery', occasion: 'city', bestFor: 'gallery visits', targetOutfits: 2 },
      { slot: 'evening', occasion: 'evening', bestFor: 'restaurant dinner', environment: 'indoor', targetOutfits: 1 }
    ]
  }
]

const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)

function tally(pieces) {
  const counts = { top: 0, bottom: 0, dress: 0, shoes: 0, outerwear: 0 }
  for (const piece of pieces) {
    const group = wardrobeCategoryGroup(piece)
    if (group in counts) counts[group] += 1
  }
  return counts
}

function capacity(counts) {
  return counts.top * counts.bottom + counts.dress
}

const rows = []
for (const season of SEASONS) {
  for (const scenario of SCENARIOS) {
    for (const budget of BUDGETS) {
      const selected = selectCapsuleRoster(allPieces, {
        budget,
        isSummer: season.isSummer,
        isWinter: !season.isSummer,
        occasions: scenario.slots.map(slot => slot.occasion),
        slots: scenario.slots
      })
      const roster = Array.isArray(selected) ? selected : (selected?.pieces || selected?.roster || [])
      const rosterIds = new Set(roster.map(piece => Number(piece.id)))
      const slots = scenario.slots.map(slot => {
        const request = [slot.slot, slot.bestFor].join('. ')
        const { eligiblePieces } = evaluateAutomaticUsePiecePool({
          pieces: allPieces,
          context: {
            occasion: slot.occasion,
            explorationMode: 'moderate',
            weatherProfile: slot.environment === 'indoor'
              ? weatherProfileFromContext({ season: 'indoor' })
              : season.profile,
            mood: `${season.name} capsule`,
            request
          },
          policy: { hotOuterwearCap: 3 },
        })
        const eligible = eligiblePieces.filter(piece => rosterIds.has(Number(piece.id)))
        const counts = tally(eligible)
        return {
          slot: slot.slot,
          counts,
          cores: capacity(counts),
          complete: capacity(counts) > 0 && counts.shoes > 0
        }
      })
      rows.push({
        season: season.name,
        scenario: scenario.name,
        budget,
        rosterSize: roster.length,
        roster: tally(roster),
        completeSlots: slots.filter(slot => slot.complete).length,
        slotCount: slots.length,
        weakestSlotCores: Math.min(...slots.map(slot => slot.cores)),
        slots
      })
    }
  }
}

if (JSON_OUTPUT) {
  console.log(JSON.stringify({ wardrobeSize: allPieces.length, rows }, null, 2))
} else {
  console.log(`wardrobe: ${allPieces.length} active pieces; no model call, no network\n`)
  console.log('season scenario       budget roster slots weakest_cores categories')
  for (const row of rows) {
    const r = row.roster
    console.log(
      `${row.season.padEnd(6)} ${row.scenario.padEnd(14)} ${String(row.budget).padStart(6)} ` +
      `${String(row.rosterSize).padStart(6)} ${`${row.completeSlots}/${row.slotCount}`.padStart(5)} ` +
      `${String(row.weakestSlotCores).padStart(13)} ${r.top}T ${r.bottom}B ${r.dress}D ${r.outerwear}O ${r.shoes}S`
    )
  }
  const gaps = rows.flatMap(row => row.slots
    .filter(slot => !slot.complete)
    .map(slot => `${row.season}/${row.scenario}/budget-${row.budget}/${slot.slot}`))
  console.log(`\nstructural gaps: ${gaps.length ? gaps.join(', ') : 'none'}`)
}
