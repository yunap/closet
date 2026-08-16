// Measures which SCORING terms actually fire on the real wardrobe.
//
// A weight in the source is a claim about what the engine cares about; it only matters if the
// condition attached to it is ever true. This runs the real scorers over the real (read-only)
// wardrobe and reports, per term, how often it fires and how much of the spread it explains.
//
// Companion to derive_engine_behaviours.js, which finds mechanisms but cannot tell you whether
// a mechanism is load-bearing. Feeds docs/engine-behaviour-map.md → "Scoring".
//
//   node scratch/measure_scoring_terms.js
//
// Read-only. No network, no model call.

import { db, parsePiece } from '../db.js'
import { formalityRank, pieceFormality, fabricWeight } from '../styling-engine/attributes.js'
import { wardrobeCategoryGroup } from '../styling-engine/rules.js'

const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
const pct = n => `${((n / pieces.length) * 100).toFixed(0)}%`

console.log(`wardrobe: ${pieces.length} active pieces\n`)

// ── planWorkbenchPieceScore's terms (outfitSetPlanner.js:931) ────────────────
// Reproduced here term-by-term so each can be counted; the function itself only returns a total.
const SLOT = { occasion: 'casual', register: 'everyday' }

const terms = [
  ['+80  core group (top/bottom/dress/shoes)', p => ['top', 'bottom', 'dress', 'shoes'].includes(wardrobeCategoryGroup(p))],
  ['+30  support group (outerwear/accessory)', p => ['outerwear', 'accessory'].includes(wardrobeCategoryGroup(p))],
  ['+50  recommendation_status = trusted', p => p.recommendation_status === 'trusted'],
  ['+30  fit_confidence = high', p => p.fit_confidence === 'high'],
  ['+20  role_permission hero|auto', p => p.role_permission === 'hero' || p.role_permission === 'auto'],
  ['+35  piece tagged with slot occasion', p => (Array.isArray(p.occasions) ? p.occasions : []).map(o => String(o).toLowerCase()).includes(SLOT.occasion)],
  ['+5   fabric_weight light', p => fabricWeight(p) === 'light'],
  ['0-20 register proximity term resolvable', p => formalityRank(pieceFormality(p)) !== null]
]

console.log('--- planWorkbenchPieceScore: how often each term fires ---')
for (const [label, test] of terms) {
  const n = pieces.filter(p => { try { return test(p) } catch { return false } }).length
  console.log(`  ${String(n).padStart(4)}  ${pct(n).padStart(4)}  ${label}`)
}

// ── field coverage: a weight on an unpopulated column is dead ────────────────
const FIELDS = ['recommendation_status', 'fit_confidence', 'role_permission', 'formality', 'fabric_weight', 'fabric_category', 'pattern_type']
console.log('\n--- field population (a weight keyed on an empty column cannot fire) ---')
for (const field of FIELDS) {
  const counts = {}
  for (const p of pieces) {
    const v = p[field] === null || p[field] === undefined || p[field] === '' ? '(empty)' : String(p[field])
    counts[v] = (counts[v] || 0) + 1
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4)
  console.log(`  ${field.padEnd(22)} ${top.map(([v, n]) => `${v}=${n}`).join('  ')}`)
}

// ── capsuleVersatilityScore's neutral-color term ─────────────────────────────
const CAPSULE_NEUTRAL_COLORS = ['black', 'white', 'ivory', 'cream', 'navy', 'blue', 'grey', 'gray', 'charcoal', 'beige', 'tan', 'khaki', 'stone', 'olive', 'denim', 'brown', 'camel']
const neutral = pieces.filter(p => (Array.isArray(p.colors) ? p.colors : []).some(c => CAPSULE_NEUTRAL_COLORS.some(n => String(c).toLowerCase().includes(n))))
const solid = pieces.filter(p => ['solid', 'none', ''].includes(String(p.pattern_type || '').toLowerCase()))
const occ4 = pieces.filter(p => (Array.isArray(p.occasions) ? p.occasions : []).length >= 4)
console.log('\n--- capsuleVersatilityScore: how often each term fires ---')
console.log(`  ${String(neutral.length).padStart(4)}  ${pct(neutral.length).padStart(4)}  +12  neutral color`)
console.log(`  ${String(solid.length).padStart(4)}  ${pct(solid.length).padStart(4)}  +8   solid/no pattern`)
console.log(`  ${String(occ4.length).padStart(4)}  ${pct(occ4.length).padStart(4)}  +16  4+ occasions (term maxes at 4)`)

console.log('\nNOTE: firing frequency is not correctness. A term that fires on 95% of the wardrobe')
console.log('does not discriminate; one that fires on 0% is dead weight. Both are worth knowing')
console.log('before tuning any number.')

// ── compatibilityScoreForSelectedItem: which terms ever fire? ────────────────
// The pair terms need a SELECTED piece with real history, so the sample is drawn from the pieces
// that actually carry feedback — picking an arbitrary piece measures nothing but its emptiness.
import { compatibilityScoreForSelectedItem, hasPairingReference, hasRejectedReference, getFeedbackInfluenceForPair, getSavedBoardInfluenceForPair } from '../styling-engine/rules.js'

const feedbackPieceIds = db.prepare(
  "SELECT context_id AS id, COUNT(*) n FROM stylist_feedback WHERE context_type = 'piece' AND COALESCE(archived,0) = 0 GROUP BY context_id ORDER BY n DESC LIMIT 6"
).all().map(r => Number(r.id))
const byId = new Map(pieces.map(p => [Number(p.id), p]))
const selectedSamples = feedbackPieceIds.map(id => byId.get(id)).filter(Boolean)

console.log(`\n--- compatibilityScoreForSelectedItem: pair-term firing rates ---`)
console.log(`  sampled selected pieces: the ${selectedSamples.length} with the most feedback rows`)

let pairs = 0, pairingRef = 0, rejectedRef = 0, feedbackPair = 0, boardPair = 0
const spread = []
for (const selected of selectedSamples) {
  for (const candidate of pieces) {
    if (Number(candidate.id) === Number(selected.id)) continue
    pairs++
    if (hasPairingReference(selected, candidate) || hasPairingReference(candidate, selected)) pairingRef++
    if (hasRejectedReference(selected, candidate) || hasRejectedReference(candidate, selected)) rejectedRef++
    if (getFeedbackInfluenceForPair(selected, candidate)) feedbackPair++
    if (getSavedBoardInfluenceForPair(selected, candidate)) boardPair++
    spread.push(Number(compatibilityScoreForSelectedItem(selected, candidate, { occasion: 'casual' })?.score ?? 0))
  }
}
const rate = n => `${((n / pairs) * 100).toFixed(1)}%`
console.log(`  ${pairs} pairs tested`)
console.log(`  ${String(pairingRef).padStart(5)}  ${rate(pairingRef).padStart(6)}  +16   confirmed pairing note`)
console.log(`  ${String(rejectedRef).padStart(5)}  ${rate(rejectedRef).padStart(6)}  -40   rejected pairing note`)
console.log(`  ${String(feedbackPair).padStart(5)}  ${rate(feedbackPair).padStart(6)}  +/-60 getFeedbackInfluenceForPair returns a score`)
console.log(`  ${String(boardPair).padStart(5)}  ${rate(boardPair).padStart(6)}  0..70 getSavedBoardInfluenceForPair returns a score`)

spread.sort((a, b) => a - b)
console.log(`  total score range ${spread[0]}..${spread[spread.length - 1]}, median ${spread[Math.floor(spread.length / 2)]}`)

// ── terms keyed on columns that are empty wardrobe-wide ─────────────────────
console.log('\n--- terms whose column is empty across the whole wardrobe ---')
const favPieces = db.prepare('SELECT COUNT(*) n FROM pieces WHERE COALESCE(favorite,0) = 1').get().n
const favBoards = db.prepare('SELECT COUNT(*) n FROM saved_boards WHERE COALESCE(favorite,0) = 1').get().n
console.log(`  pieces.favorite = 1:       ${favPieces} of ${pieces.length}  (feeds +4 in compatibilityScoreForSelectedItem, +5 in scoreWholeWardrobeCandidate)`)
console.log(`  saved_boards.favorite = 1: ${favBoards} of ${db.prepare('SELECT COUNT(*) n FROM saved_boards WHERE COALESCE(archived,0) = 0').get().n}  (feeds the +45 branch of getSavedBoardInfluenceForPair)`)
