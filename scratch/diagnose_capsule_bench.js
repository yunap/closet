// Bench-width / headroom check for the capsule roster-selection spec
// (docs/capsule-roster-selection-spec.md §6, docs/capsule-bench-implementation-brief.md §5).
// It never constructs an AI client or makes a network request.
//
// buildCapsuleBench seeds the bench with today's deterministic
// selectCapsuleRoster output (every roster piece is admitted by guarantee),
// then fills the remainder by capsuleVersatilityScore rank up to benchSize.
// That makes "roster picks outside the bench" 0 by construction — the
// question that measurement used to answer doesn't apply anymore. The
// question this script answers now is HEADROOM: how much room is left in the
// bench beyond the deterministic roster for a model to choose something
// different.
//
// The original rank-only measurement (no seed) is kept below as a reference:
// it is the evidence for why the seed exists — a pure top-40-by-score bench
// silently drops exactly the pieces the reserve passes rescue (a shoe bought
// for one dressy slot, a dress that clears a register floor), which is a
// structural gap in the ranking heuristic, not noise.
//
// This is a measurement, not a threshold — do not turn either number into a
// pass/fail and do not retune buildCapsuleBench or capsuleVersatilityScore to
// make it look good. Report the numbers; the owner rules on them.
//
// Usage:
//   node scratch/diagnose_capsule_bench.js
//   node scratch/diagnose_capsule_bench.js --json

import { db, parsePiece } from '../db.js'
import { selectCapsuleRoster, buildCapsuleBench } from '../styling-engine/outfitSetPlanner.js'

const JSON_OUTPUT = process.argv.includes('--json')
const BUDGETS = [10, 14, 18, 24]
const SEASONS = [
  { name: 'summer', isSummer: true, isWinter: false },
  { name: 'winter', isSummer: false, isWinter: true }
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

const headroomRows = []
const rankOnlyRows = []

for (const season of SEASONS) {
  for (const scenario of SCENARIOS) {
    for (const budget of BUDGETS) {
      const roster = selectCapsuleRoster(allPieces, {
        budget,
        isSummer: season.isSummer,
        isWinter: season.isWinter,
        occasions: scenario.slots.map(slot => slot.occasion),
        slots: scenario.slots
      })
      const rosterIds = new Set(roster.map(piece => Number(piece.id)))

      // Headline: the real, seeded bench. The roster is contained in it by
      // construction — headroom is how much the bench offers beyond that.
      const seeded = buildCapsuleBench(allPieces, {
        budget, slots: scenario.slots, isSummer: season.isSummer, isWinter: season.isWinter
      })
      const missingFromBench = roster.filter(piece => !seeded.bench.some(benchPiece => Number(benchPiece.id) === Number(piece.id)))
      const headroom = seeded.bench.filter(piece => !rosterIds.has(Number(piece.id)))
      headroomRows.push({
        season: season.name,
        scenario: scenario.name,
        budget,
        rosterSize: roster.length,
        seedSize: seeded.diagnostics.seedSize,
        benchSize: seeded.diagnostics.benchSize,
        headroomCount: headroom.length,
        missingFromBenchCount: missingFromBench.length,
        missingFromBenchNames: missingFromBench.map(piece => `ID ${piece.id} ${piece.name || 'Garment'}`)
      })

      // Reference: the pre-seed, rank-only bench — the original measurement,
      // kept runnable as the evidence for why the seed exists.
      const rankOnly = buildCapsuleBench(allPieces, {
        budget, slots: scenario.slots, isSummer: season.isSummer, isWinter: season.isWinter,
        seedWithDeterministicRoster: false
      })
      const rankOnlyBenchIds = new Set(rankOnly.bench.map(piece => Number(piece.id)))
      const outsideRankOnlyBench = roster.filter(piece => !rankOnlyBenchIds.has(Number(piece.id)))
      rankOnlyRows.push({
        season: season.name,
        scenario: scenario.name,
        budget,
        rosterSize: roster.length,
        benchSize: rankOnly.diagnostics.benchSize,
        outsideBenchCount: outsideRankOnlyBench.length,
        outsideBenchNames: outsideRankOnlyBench.map(piece => `ID ${piece.id} ${piece.name || 'Garment'}`)
      })
    }
  }
}

const totalHeadroom = headroomRows.reduce((sum, row) => sum + row.headroomCount, 0)
const totalBenchPieces = headroomRows.reduce((sum, row) => sum + row.benchSize, 0)
const totalMissingFromSeededBench = headroomRows.reduce((sum, row) => sum + row.missingFromBenchCount, 0)

const totalRosterPieces = rankOnlyRows.reduce((sum, row) => sum + row.rosterSize, 0)
const totalOutsideRankOnly = rankOnlyRows.reduce((sum, row) => sum + row.outsideBenchCount, 0)
const rankOnlyRate = totalRosterPieces ? (totalOutsideRankOnly / totalRosterPieces) : 0

if (JSON_OUTPUT) {
  console.log(JSON.stringify({
    wardrobeSize: allPieces.length,
    headroom: { rows: headroomRows, totalHeadroom, totalBenchPieces, totalMissingFromSeededBench },
    rankOnlyReference: { rows: rankOnlyRows, totalRosterPieces, totalOutsideRankOnly, rankOnlyRate }
  }, null, 2))
} else {
  console.log(`wardrobe: ${allPieces.length} active pieces; no model call, no network\n`)

  console.log('=== seeded bench — headroom beyond today\'s deterministic roster ===')
  console.log('season scenario       budget roster seed bench headroom')
  for (const row of headroomRows) {
    console.log(
      `${row.season.padEnd(6)} ${row.scenario.padEnd(14)} ${String(row.budget).padStart(6)} ` +
      `${String(row.rosterSize).padStart(6)} ${String(row.seedSize).padStart(4)} ${String(row.benchSize).padStart(5)} ` +
      `${String(row.headroomCount).padStart(8)}` +
      (row.missingFromBenchCount ? `  — MISSING FROM BENCH: ${row.missingFromBenchNames.join(', ')}` : '')
    )
  }
  console.log(`\noverall: bench holds ${totalBenchPieces} pieces total, ${totalHeadroom} of them beyond the deterministic roster (headroom)`)
  console.log(`roster-in-bench invariant: ${totalMissingFromSeededBench} roster picks missing from the bench (must be 0 by construction)`)

  console.log('\n=== rank-only bench, for reference — this is why the seed exists ===')
  console.log('(no seed: capsuleVersatilityScore rank cut at benchSize, same as the bench-before-this-review)')
  console.log('season scenario       budget roster bench outside_bench')
  for (const row of rankOnlyRows) {
    console.log(
      `${row.season.padEnd(6)} ${row.scenario.padEnd(14)} ${String(row.budget).padStart(6)} ` +
      `${String(row.rosterSize).padStart(6)} ${String(row.benchSize).padStart(5)} ` +
      `${String(row.outsideBenchCount).padStart(13)}` +
      (row.outsideBenchCount ? `  — ${row.outsideBenchNames.join(', ')}` : '')
    )
  }
  console.log(`\noverall (rank-only, reference): ${totalOutsideRankOnly}/${totalRosterPieces} roster picks would fall outside a rank-only bench (${(rankOnlyRate * 100).toFixed(1)}%)`)
}
