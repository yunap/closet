// Q6 — Ground truth proxy: how often does a human correct a given field after tagging?
//
// Every field's individual override rate. This differs from scratch/measure_provenance.js, which
// only tracks a fixed list of gate-decision columns (DECISION_COLUMNS) chosen because they feed a
// gate or score. This script sweeps ALL fields that have ever appeared in any piece's
// manual_overrides array — including style_profile_json / garment_intelligence sub-fields that
// never gate anything but are still corrected by hand — because a field that gets overridden
// constantly is either poorly tagged or poorly specified, whether or not the engine gates on it.
//
// Reuses existing data only: manual_overrides across the real wardrobe. No new tagging calls,
// no model call. Read-only.

import { db, parsePiece } from '../db.js'
import { normalizeManualOverrides } from '../styling-engine/taggerMerge.js'

const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
console.log(`wardrobe: ${pieces.length} active pieces\n`)

const counts = new Map()
let piecesWithAnyOverride = 0

for (const p of pieces) {
  const overrides = normalizeManualOverrides(p.manual_overrides)
  if (overrides.length) piecesWithAnyOverride++
  for (const field of overrides) {
    counts.set(field, (counts.get(field) || 0) + 1)
  }
}

console.log(`${piecesWithAnyOverride}/${pieces.length} pieces (${(100 * piecesWithAnyOverride / pieces.length).toFixed(0)}%) carry at least one manual override\n`)

console.log('--- override frequency by field, all fields ever corrected, sorted descending ---\n')
const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
const maxNameLen = Math.max(...sorted.map(([f]) => f.length))
for (const [field, n] of sorted) {
  const pct = (100 * n / pieces.length).toFixed(0)
  console.log(`  ${field.padEnd(maxNameLen)}  ${String(n).padStart(4)} / ${pieces.length}  (${pct.padStart(3)}%)`)
}

console.log(`\n${sorted.length} distinct fields have ever been manually corrected on this wardrobe.`)

// Fields the tagger schema asks for but that have NEVER been overridden — the same signal
// Q7/provenance flagged for heel_height/recommendation_status/role_permission, generalized.
// Cross-check against CONFIDENCE_FIELDS (the whitelist of fields that can even carry a confidence
// badge) so "never corrected" isn't conflated with "not eligible for review in the first place."
import { CONFIDENCE_FIELDS } from '../styling-engine/taggerMerge.js'
const neverOverridden = CONFIDENCE_FIELDS.filter(f => !counts.has(f))
console.log(`\n--- confidence-eligible fields that have NEVER been manually corrected (${neverOverridden.length}/${CONFIDENCE_FIELDS.length}) ---`)
console.log('A field nobody has ever corrected is either (a) the tagger gets it right every time, or')
console.log('(b) nobody is checking it closely enough to notice when it is wrong. This script cannot')
console.log('distinguish the two — that is exactly Q6\'s open limitation, stated in the plan.\n')
for (const f of neverOverridden) console.log(`  ${f}`)
