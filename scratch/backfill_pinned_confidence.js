// Backfill: pin confidence='manual' for any manual_overrides field that predates the field
// joining CONFIDENCE_FIELDS (or predates pinManualConfidence itself). pinManualConfidence
// (styling-engine/taggerMerge.js) already does this correctly on every write going forward —
// verified directly against the current code (see docs/tagger-audit-findings.md Q2). This is
// purely historical residue: a piece whose manual_overrides included a field before that field
// was added to CONFIDENCE_FIELDS never got the pin applied, and hasn't been saved since.
//
// Found by scratch/measure_confidence_calibration.js: piece 990359's `stretch` override reads
// confidence=undefined instead of 'manual'. This script generalizes the same check across the
// whole wardrobe rather than hand-fixing one piece, in case others exist.
//
// Preview by default (reports what WOULD change, writes nothing). --apply writes the fix.
//
//   node scratch/backfill_pinned_confidence.js            # preview
//   node scratch/backfill_pinned_confidence.js --apply    # write

import { db, parsePiece, safeJsonParse } from '../db.js'
import { normalizeManualOverrides, CONFIDENCE_FIELDS } from '../styling-engine/taggerMerge.js'

const APPLY = process.argv.includes('--apply')
const MANUAL = 'manual' // taggerMerge.js's MANUAL_CONFIDENCE is not exported; this is its literal value

const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
console.log(`${pieces.length} active pieces\n`)

let fixedCount = 0
const update = db.prepare('UPDATE pieces SET style_profile_json = ? WHERE id = ?')

for (const piece of pieces) {
  const overrides = normalizeManualOverrides(piece.manual_overrides)
  const profile = piece.style_profile_json && typeof piece.style_profile_json === 'object'
    ? piece.style_profile_json
    : safeJsonParse(piece.style_profile_json, {}) || {}
  const confidence = profile._confidence && typeof profile._confidence === 'object' ? { ...profile._confidence } : {}

  let changed = false
  for (const field of overrides) {
    if (!CONFIDENCE_FIELDS.includes(field)) continue // not a confidence-eligible field, nothing to pin
    if (confidence[field] === MANUAL) continue
    console.log(`  piece ${piece.id} "${piece.name}": "${field}" is manually overridden but confidence reads "${confidence[field]}" — pinning to "manual"`)
    confidence[field] = MANUAL
    changed = true
  }

  if (changed) {
    fixedCount++
    if (APPLY) {
      const nextProfile = { ...profile, _confidence: confidence }
      update.run(JSON.stringify(nextProfile), piece.id)
    }
  }
}

console.log(`\n${fixedCount} piece(s) ${APPLY ? 'fixed' : 'would be fixed'}.`)
if (!APPLY && fixedCount > 0) console.log('Re-run with --apply to write.')
