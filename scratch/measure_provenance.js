// PROVENANCE: for every column the engine makes decisions on, who set the value —
// the owner, or the auto-tagger?
//
// This exists because provenance reversed two recommendations during the mapping of
// docs/engine-behaviour-map.md. A "column conflict" between two fields is not symmetric when one
// side is a hand-correction and the other is model output. Run this before proposing any fix that
// resolves one column against another.
//
//   node scratch/measure_provenance.js
//   node scratch/measure_provenance.js formality occasions   # cross-tab two columns' provenance
//
// Read-only. No network, no model call.

import { db, parsePiece } from '../db.js'
import { normalizeManualOverrides } from '../styling-engine/taggerMerge.js'
import { getFieldConfidence } from '../styling-engine/rules.js'

const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
const overridesOf = p => new Set(normalizeManualOverrides(p.manual_overrides))

// Columns the engine actually gates or scores on, and where.
const DECISION_COLUMNS = [
  ['formality', 'register ceiling (the largest single exclusion), formality fit, capsule roster'],
  ['occasions', 'occasion gate, +35 workbench term, capsule versatility'],
  ['fabric_weight', 'hot/cold weather gate, capsule summer term'],
  ['fiber_content', 'hot-weather insulating-fiber clause, wet-exposure footwear clause, capsule summer term'],
  ['fabric_category', 'weather + profile material rules'],
  ['heel_height', 'activity footwear-comfort gate'],
  ['walk_support', 'activity footwear-comfort gate'],
  ['length_hits_at', 'image truth text (no gate)'],
  ['sleeve_type', 'cold-weather bareness, image fidelity'],
  ['silhouette', 'image truth text, structure fit confidence'],
  ['fit_on_body', 'image truth text'],
  ['pattern_type', 'capsule solid term; NOT read by the pattern classifiers'],
  ['fit_confidence', '+30 workbench term, auto-use trust gate'],
  ['recommendation_status', 'auto-use trust gate'],
  ['role_permission', 'auto-use trust gate'],
  ['colors', 'capsule neutral term, keyword scorers'],
  ['season', 'not gated directly'],
  ['notes', 'engine-notes suppression clause, image prompts'],
  ['name', 'every keyword classifier in the engine']
]

const args = process.argv.slice(2)

if (args.length === 2) {
  const [a, b] = args
  console.log(`cross-tab: provenance of "${a}" vs "${b}"\n`)
  const cell = new Map()
  for (const p of pieces) {
    const o = overridesOf(p)
    const key = `${o.has(a) ? 'owner' : 'tagger'} ${a} / ${o.has(b) ? 'owner' : 'tagger'} ${b}`
    cell.set(key, (cell.get(key) || 0) + 1)
  }
  for (const [k, n] of [...cell].sort((x, y) => y[1] - x[1])) console.log(`  ${String(n).padStart(4)}  ${k}`)
  console.log('\nA conflict between two columns is only symmetric when both are owner-set.')
  process.exit(0)
}

console.log(`wardrobe: ${pieces.length} active pieces\n`)
console.log('--- who set the value the engine decides on ---\n')
console.log(`  ${'column'.padEnd(22)} ${'owner-set'.padStart(9)} ${'populated'.padStart(9)}   decides`)
console.log(`  ${'-'.repeat(22)} ${'-'.repeat(9)} ${'-'.repeat(9)}   ${'-'.repeat(40)}`)
for (const [column, decides] of DECISION_COLUMNS) {
  const owner = pieces.filter(p => overridesOf(p).has(column)).length
  const populated = pieces.filter(p => {
    const v = p[column]
    return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)
  }).length
  const flag = owner === 0 && populated > 0 ? '  [entirely tagger-set]' : ''
  console.log(`  ${column.padEnd(22)} ${String(owner).padStart(9)} ${String(populated).padStart(9)}   ${decides}${flag}`)
}

// Confidence is the tagger's own hedge; it is pinned to high on owner-set fields.
console.log('\n--- the tagger\'s self-reported confidence on its own values ---')
const CONF_FIELDS = ['formality', 'length_hits_at', 'silhouette', 'fit_on_body', 'hem_finish', 'sleeve_type']
for (const field of CONF_FIELDS) {
  const dist = new Map()
  for (const p of pieces) {
    const c = getFieldConfidence(p, field) || '(none)'
    dist.set(c, (dist.get(c) || 0) + 1)
  }
  console.log(`  ${field.padEnd(16)} ${[...dist].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}=${n}`).join('  ')}`)
}

console.log('\nRULE OF THUMB: before resolving a conflict between two columns, cross-tab them —')
console.log('  node scratch/measure_provenance.js <columnA> <columnB>')
console.log('An owner correction outranks a tagger prediction. Two recommendations in the engine')
console.log('behaviour map were withdrawn for getting this backwards.')

// ── tagger version coverage: how much of the wardrobe predates the current prompt ──
import { pieceStyleProfile } from '../styling-engine/rules.js'
import { hasFitVisiblePhoto, hasPhotoPropertyJudgment } from '../styling-engine/taggerMerge.js'
import { estimateAiUsageCost, AI_PROVIDER, ACTIVE_STYLIST_MODEL } from '../styling-engine/provider.js'

console.log('\n--- tagger version coverage ---')
const versions = new Map()
for (const p of pieces) versions.set(p.tagger_version || '(unversioned)', (versions.get(p.tagger_version || '(unversioned)') || 0) + 1)
for (const [v, n] of [...versions].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${v}`)

const judged = pieces.filter(p => hasPhotoPropertyJudgment(pieceStyleProfile(p)))
const fitVisible = pieces.filter(p => hasFitVisiblePhoto(pieceStyleProfile(p)))
console.log(`\n  ${judged.length} pieces carry a photo-property judgment (the prompt's first section)`)
console.log(`  ${fitVisible.length} have fit_visible on some photo`)

const lowLen = f => f.filter(p => getFieldConfidence(p, 'length_hits_at') === 'low').length
console.log(`\n  low-confidence length_hits_at, all pieces:      ${lowLen(pieces)}/${pieces.length}`)
console.log(`  low-confidence length_hits_at, fit_visible only: ${lowLen(fitVisible)}/${fitVisible.length}`)
console.log('  -> where the authority section ran, structural confidence is roughly twice as good.')

// ── what a re-tag of the stale pieces would cost (this is a BILLED operation) ──
const stale = pieces.filter(p => !p.tagger_version)
const PER_PIECE_INPUT = 9880   // measured in scratch/measure_image_path.js
const PER_PIECE_OUTPUT = 2500  // the maxTokens cap; actual is likely lower
const est = estimateAiUsageCost({
  provider: AI_PROVIDER,
  model: ACTIVE_STYLIST_MODEL,
  inputTokens: PER_PIECE_INPUT * stale.length,
  outputTokens: PER_PIECE_OUTPUT * stale.length,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0
})
console.log(`\n--- cost of re-tagging the ${stale.length} unversioned pieces (BILLED — do not run casually) ---`)
console.log(`  provider/model: ${AI_PROVIDER} / ${ACTIVE_STYLIST_MODEL}`)
console.log(`  at ${PER_PIECE_INPUT.toLocaleString()} in / ${PER_PIECE_OUTPUT.toLocaleString()} out per piece (output = the cap, so this is an UPPER bound)`)
console.log(`  estimated: $${est?.estimatedUsd?.toFixed(2) ?? '?'}   (input $${est?.inputUsd?.toFixed(2)}, output $${est?.outputUsd?.toFixed(2)})`)
console.log(`  manual overrides are preserved by applyTaggerResult, so a re-tag cannot undo owner corrections.`)
