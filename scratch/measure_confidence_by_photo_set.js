// Q1 — Is the schema asking for things a single photo can actually answer?
//
// The plan's original framing needs a FRESH corpus of tag responses with known, controlled photo
// sets (same piece tagged hanger-only vs hanger+worn) — that requires new billed calls and is
// explicitly gated pending separate approval.
//
// This is a free substitute, not a replacement: a NATURAL experiment using data already on disk.
// Every v2-tagged piece already carries style_profile_json.photo_properties, which records which
// photos were actually classified at tagging time (HANGER PHOTO / WORN PHOTO, each with its own
// fit_visible boolean). Cross-tabbing confidence against "did this piece's actual tag call include
// a fit_visible worn photo" answers most of Q1's real question — which fields are reliably
// low-confidence on hanger-only calls — without spending anything. It is NOT a controlled
// same-piece comparison (different pieces, not the same piece tagged twice), so read it as
// suggestive, not definitive; that gap is exactly what the gated billed corpus would close.
//
// Read-only. No model call.

import { db, parsePiece } from '../db.js'
import { pieceStyleProfile } from '../styling-engine/rules.js'
import { hasFitVisiblePhoto } from '../styling-engine/taggerMerge.js'

const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
const v2 = pieces.filter(p => String(p.tagger_version || '').startsWith('v2'))
console.log(`${v2.length} pieces tagged by the current (v2) prompt — the only population where`)
console.log(`photo_properties is reliably populated.\n`)

const withFitVisible = v2.filter(p => hasFitVisiblePhoto(pieceStyleProfile(p)))
const withoutFitVisible = v2.filter(p => !hasFitVisiblePhoto(pieceStyleProfile(p)))
console.log(`  ${withFitVisible.length} had a fit_visible photo at tagging time (worn photo, usually)`)
console.log(`  ${withoutFitVisible.length} did not (hanger-only, or worn photo present but not fit_visible)\n`)

function confidenceOf(piece, field) {
  const profile = pieceStyleProfile(piece)
  return profile?._confidence?.[field]
}

// Fields the prompt's own authority map says are structurally unknowable without a fit-visible
// photo: fit_on_body, drape (inside real_wear_notes, no direct confidence field), length_hits_at,
// tuck_behavior, waistband_type, on-body silhouette. Test each against low-confidence rate.
const FIT_DEPENDENT_FIELDS = ['fit_on_body', 'length_hits_at', 'tuck_behavior', 'waistband_type', 'silhouette']
// Control group: fields the authority map says are answerable from a flat garment photo alone —
// should show NO real gap between the two groups if the schema's own claim is accurate.
const PHOTO_INDEPENDENT_FIELDS = ['pattern_type', 'fabric_category', 'colors', 'neckline']

function lowRate(cohort, field) {
  if (!cohort.length) return null
  const low = cohort.filter(p => confidenceOf(p, field) === 'low').length
  return { low, total: cohort.length, pct: Math.round(100 * low / cohort.length) }
}

console.log('--- fields the prompt says are fit-visible-dependent (should show a real gap) ---')
for (const field of FIT_DEPENDENT_FIELDS) {
  const withR = lowRate(withFitVisible, field)
  const withoutR = lowRate(withoutFitVisible, field)
  console.log(`  ${field.padEnd(16)} fit_visible: ${withR ? `${withR.low}/${withR.total} (${withR.pct}%) low` : 'n/a'}   no fit_visible: ${withoutR ? `${withoutR.low}/${withoutR.total} (${withoutR.pct}%) low` : 'n/a'}`)
}

console.log('\n--- control: fields the prompt says are answerable from any photo (should show NO real gap) ---')
for (const field of PHOTO_INDEPENDENT_FIELDS) {
  const withR = lowRate(withFitVisible, field)
  const withoutR = lowRate(withoutFitVisible, field)
  console.log(`  ${field.padEnd(16)} fit_visible: ${withR ? `${withR.low}/${withR.total} (${withR.pct}%) low` : 'n/a'}   no fit_visible: ${withoutR ? `${withoutR.low}/${withoutR.total} (${withoutR.pct}%) low` : 'n/a'}`)
}

console.log('\n--- what this natural experiment cannot tell you (the gap a billed corpus would close) ---')
console.log('  This compares DIFFERENT pieces, some with a fit_visible photo and some without — it')
console.log('  cannot rule out that pieces lacking a worn photo are also just harder to tag for other')
console.log('  reasons (patterned, unusual construction, etc.), confounding the comparison. A fresh')
console.log('  corpus tagging the SAME pieces both ways (hanger-only, then hanger+worn) would isolate')
console.log('  photo availability as the only variable — that is the piece of Q1 still gated on approval.')
