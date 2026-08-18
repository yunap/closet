// Diagnostic: why did one shoe carry 7 of 8 looks in the "14-piece summer capsule" plan?
//
// Replays the real per-slot gate (`filterWholeWardrobePiecesForGeneration`) against the real
// wardrobe, for the exact slot occasions the capsule plan used, and prints every shoe's fate with
// the engine's own suppression reasons. No model call, no network, read-only.
//
// Usage:
//   node scratch/diagnose_capsule_shoe_roster.js
//   node scratch/diagnose_capsule_shoe_roster.js 169 222 181   # focus on specific piece ids
//
// Reads WARDROBE_DB_PATH like the rest of the app; defaults to the repo's wardrobe.db.

import { db, parsePiece } from '../db.js'
import { filterWholeWardrobePiecesForGeneration, resolveRegisterCeiling } from '../styling-engine/rules.js'

// The slots this capsule actually planned, with the occasion each one resolved to. Taken from
// thread_1784970885986's stored structuredOutfits (tripSlot + occasion), not invented.
const SLOTS = [
  { slot: 'casual_city_day', occasion: 'casual', bestFor: 'errands, coffee, weekend wandering' },
  { slot: 'smart_casual_outing', occasion: 'smart casual', bestFor: 'brunch, city stroll, museum, winery' },
  { slot: 'evening_out', occasion: 'evening', bestFor: 'dinner, drinks' },
  { slot: 'outdoor_daytime_social', occasion: 'outdoor daytime social', bestFor: 'market, picnic, outdoor cafe' },
  { slot: 'city_gallery', occasion: 'city', bestFor: 'gallery visit, museum' }
]

const focusIds = process.argv.slice(2).map(Number).filter(Boolean)

const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
const shoes = allPieces.filter(piece => String(piece.category || '').toLowerCase() === 'shoes')

console.log(`wardrobe: ${allPieces.length} active pieces, ${shoes.length} shoes`)
if (focusIds.length) console.log(`focus: ${focusIds.join(', ')}\n`)

const survivedAnywhere = new Map()

for (const slot of SLOTS) {
  // Mirrors outfitSetPlanner.js's per-slot call: occasion from the slot, warm summer weather,
  // slot text as the request so any activity/register inference sees what the planner saw.
  const request = [slot.slot, slot.bestFor].filter(Boolean).join('. ')
  const options = {
    occasion: slot.occasion,
    explorationMode: 'moderate',
    weatherProfile: { label: 'warm', warm: true, hot: false },
    mood: 'summer capsule',
    request
  }
  const ceiling = resolveRegisterCeiling({ occasion: slot.occasion, mood: 'summer capsule', request })
  const { allowedPieces, suppressedPieces } = filterWholeWardrobePiecesForGeneration(allPieces, options)

  const allowedShoes = allowedPieces.filter(p => String(p.category || '').toLowerCase() === 'shoes')
  const suppressedShoes = suppressedPieces.filter(s => String(s.category || '').toLowerCase() === 'shoes')

  console.log(`\n=== ${slot.slot}  (occasion: ${slot.occasion}, register ceiling: ${ceiling || 'none'})`)
  console.log(`    shoes allowed: ${allowedShoes.length} / ${shoes.length}`)

  for (const piece of allowedShoes) {
    survivedAnywhere.set(piece.id, (survivedAnywhere.get(piece.id) || 0) + 1)
  }

  const show = list => list.filter(x => !focusIds.length || focusIds.includes(Number(x.id)))
  for (const piece of show(allowedShoes)) {
    console.log(`      PASS  ${String(piece.id).padEnd(7)} ${String(piece.name).slice(0, 42).padEnd(42)} ${piece.formality || '?'} / fit=${piece.fit_confidence || '?'}`)
  }
  for (const s of show(suppressedShoes)) {
    console.log(`      DROP  ${String(s.id).padEnd(7)} ${String(s.name).slice(0, 42).padEnd(42)} ${(s.reasons || []).join('; ')}`)
  }
}

console.log('\n=== summary: how many of the 5 slots each shoe was eligible for')
const rows = shoes
  .map(piece => ({ piece, n: survivedAnywhere.get(piece.id) || 0 }))
  .sort((a, b) => b.n - a.n || Number(a.piece.id) - Number(b.piece.id))
for (const { piece, n } of rows) {
  if (focusIds.length && !focusIds.includes(Number(piece.id))) continue
  console.log(`   ${n}/5  ${String(piece.id).padEnd(7)} ${String(piece.name).slice(0, 44).padEnd(44)} ${piece.formality || '?'} / fit=${piece.fit_confidence || '?'}`)
}

console.log(`
Read this as: a shoe eligible on N/5 slots was OFFERED to the model there. If a shoe shows 4/5 or
5/5 and still never appeared in the plan, the gate is not what excluded it — the roster cut
(PLAN_WORKBENCH_PIECE_LIMIT, 8 per category) or the model's own choice is.`)
