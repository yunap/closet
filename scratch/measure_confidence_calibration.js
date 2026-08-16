// Q2 — Is confidence actually calibrated, or reflexively "high"?
//
// MUST split by tagger_version. docs/engine-behaviour-map.md's 2026-08-08 amendment already found
// that pre-v2 "low" values are not real ratings — normalizeConfidenceMap's fallback for an absent
// _confidence entry, not the tagger hedging. Proof: pre-v2 pieces show ZERO "medium" values on any
// structural field across hundreds of pieces, which a genuine rating process would not do. Measuring
// calibration across the whole wardrobe undifferentiated re-collapses that distinction. So every
// distribution below is reported per tagger_version, not pooled.
//
// Read-only. No model call.

import { db, parsePiece } from '../db.js'
import { pieceStyleProfile } from '../styling-engine/rules.js'
import { CONFIDENCE_FIELDS } from '../styling-engine/taggerMerge.js'

const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
console.log(`wardrobe: ${pieces.length} active pieces\n`)

const versionOf = p => p.tagger_version || '(unversioned)'
const versions = [...new Set(pieces.map(versionOf))]
console.log('--- population per tagger_version ---')
for (const v of versions) console.log(`  ${String(pieces.filter(p => versionOf(p) === v).length).padStart(4)}  ${v}`)

function confidenceOf(piece, field) {
  const profile = pieceStyleProfile(piece)
  return profile?._confidence?.[field]
}

// --- Distribution per field, per version, for a representative field sample --------------------
// Full CONFIDENCE_FIELDS is 32 fields; printing all of them per version would be a wall of noise.
// Sample fields that span structural (gate-relevant), cosmetic, and nullable-by-category to avoid
// cherry-picking only the fields already known to be interesting.
const SAMPLE_FIELDS = [
  'formality', 'length_hits_at', 'silhouette', 'fit_on_body', 'hem_finish', 'tuck_behavior',
  'fabric_category', 'fiber_content', 'colors', 'pattern_type', 'reads_as', 'category'
]

console.log('\n--- confidence distribution per field, split by tagger_version ---')
for (const field of SAMPLE_FIELDS) {
  console.log(`\n  ${field}:`)
  for (const v of versions) {
    const cohort = pieces.filter(p => versionOf(p) === v)
    const dist = new Map()
    for (const p of cohort) {
      const c = confidenceOf(p, field)
      const key = c === undefined || c === null || c === '' ? '(absent)' : c
      dist.set(key, (dist.get(key) || 0) + 1)
    }
    const line = [...dist.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}=${n}`).join('  ')
    console.log(`    ${v.padEnd(32)} ${line}`)
  }
}

// --- The actual calibration question: does confidence ever vary WITHIN a field, conditioned on
// version? A field that's constant regardless of photo/garment ambiguity carries no information —
// this is the "reflexively high" test, now honest about which population it's testing. -----------
console.log('\n--- does confidence vary at all within each field, per version? (constant = no information) ---')
for (const field of SAMPLE_FIELDS) {
  for (const v of versions) {
    const cohort = pieces.filter(p => versionOf(p) === v)
    const distinctValues = new Set(cohort.map(p => confidenceOf(p, field)).filter(c => c !== undefined && c !== null && c !== ''))
    if (cohort.length > 3 && distinctValues.size <= 1) {
      const only = [...distinctValues][0] ?? '(never set)'
      console.log(`  [CONSTANT] ${field.padEnd(16)} ${v.padEnd(32)} always "${only}" across ${cohort.length} pieces`)
    }
  }
}

// --- Cross-check against manual overrides: manual_overrides should always read confidence
// "manual" per the pinManualConfidence mechanism. Any mismatch is a genuine bug, not a calibration
// nuance, since applyTaggerResult / pinManualConfidence is supposed to force this on save. ---------
import { normalizeManualOverrides } from '../styling-engine/taggerMerge.js'
console.log('\n--- pinManualConfidence sanity check: every manually-overridden field should read confidence "manual" ---')
let mismatches = 0
for (const p of pieces) {
  const overrides = normalizeManualOverrides(p.manual_overrides)
  for (const field of overrides) {
    if (!CONFIDENCE_FIELDS.includes(field)) continue
    const c = confidenceOf(p, field)
    if (c !== 'manual') {
      mismatches++
      console.log(`  piece ${p.id} "${p.name}": field "${field}" is in manual_overrides but confidence reads "${c}"`)
    }
  }
}
console.log(`\n  ${mismatches} mismatches found${mismatches === 0 ? ' — pinManualConfidence holds cleanly on this wardrobe.' : ''}`)
