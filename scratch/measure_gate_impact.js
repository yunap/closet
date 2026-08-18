// Measures what the HARD GATE actually excludes, on the real wardrobe, per context.
//
// The gate is a stack of independent layers (occasion exclusions, auto-use trust, weather physics,
// register ceiling, profile rules). Source reading tells you each layer exists; it does not tell
// you which one is doing the work. This calls the real `wholeWardrobePieceTrustDecision` — the same
// function the freeform propose_outfit gate and the composer roster call — across representative
// contexts and tallies the reasons.
//
//   node scratch/measure_gate_impact.js
//
// Read-only. No network, no model call. Feeds docs/engine-behaviour-map.md → "The gates".

import { db, parsePiece } from '../db.js'
import { wholeWardrobePieceTrustDecision } from '../styling-engine/rules.js'
import { missingGateFields } from '../styling-engine/attributes.js'

const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)

const CONTEXTS = [
  { name: 'casual, mild', occasion: 'casual', weatherProfile: {} },
  { name: 'casual, hot', occasion: 'casual', weatherProfile: { isHot: true } },
  { name: 'casual, cold', occasion: 'casual', weatherProfile: { isCold: true } },
  { name: 'city smart casual, mild', occasion: 'city smart casual', weatherProfile: {} },
  { name: 'evening, mild', occasion: 'evening', weatherProfile: {} },
  { name: 'evening, cold', occasion: 'evening', weatherProfile: { isCold: true } },
  { name: 'outdoor daytime social, hot', occasion: 'outdoor daytime social', weatherProfile: { isHot: true } },
  { name: 'casual + walking activity', occasion: 'casual', activity: 'walking', weatherProfile: {} },
  { name: 'casual + hiking activity', occasion: 'casual', activity: 'hiking', weatherProfile: {} },
  { name: 'home loungewear, mild', occasion: 'home', weatherProfile: {} }
]

console.log(`wardrobe: ${pieces.length} active pieces\n`)
console.log('--- pieces BLOCKED by the hard gate, per context ---\n')

for (const ctx of CONTEXTS) {
  const blocked = []
  const reasonCounts = new Map()
  for (const piece of pieces) {
    const decision = wholeWardrobePieceTrustDecision(piece, ctx)
    if (decision.allowed) continue
    blocked.push(piece)
    for (const reason of decision.reasons || []) {
      // collapse the parenthesised specifics so reason FAMILIES aggregate
      const family = String(reason).replace(/\s*\([^)]*\)/g, '').trim()
      reasonCounts.set(family, (reasonCounts.get(family) || 0) + 1)
    }
  }
  const pct = ((blocked.length / pieces.length) * 100).toFixed(0)
  console.log(`${ctx.name}`)
  console.log(`  blocked ${blocked.length}/${pieces.length} (${pct}%)`)
  for (const [reason, n] of [...reasonCounts].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    console.log(`    ${String(n).padStart(4)}  ${reason}`)
  }
  console.log('')
}

// ── gate-field coverage: what drives the metadata todos side effect ──────────
console.log('--- missingGateFields: pieces with data the gate needs and does not have ---')
const missingCounts = new Map()
let piecesWithAnyMissing = 0
for (const piece of pieces) {
  const missing = missingGateFields(piece)
  if (missing.length) piecesWithAnyMissing++
  for (const field of missing) missingCounts.set(field, (missingCounts.get(field) || 0) + 1)
}
console.log(`  ${piecesWithAnyMissing}/${pieces.length} pieces are missing at least one gate field`)
for (const [field, n] of [...missingCounts].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(4)}  ${field}`)
}

console.log('\nNOTE: a blocked piece is not a bug. The gate exists to block. What this measures is')
console.log('WHICH layer is load-bearing in a given context — and whether a context is so')
console.log('restrictive that the model is composing from a much smaller wardrobe than it looks.')
