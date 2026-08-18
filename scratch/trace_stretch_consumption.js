// Q4 follow-up — trace `stretch`'s single consumer to see whether its low consumer count (1 file,
// found by scratch/research_tagger_prompt.js §6) is a latent gap (like fiber_content's wet-exposure
// miss) or fully decorative (like heel_height/role_permission before they were ever corrected).
//
// The one consumer is refinedFabric() in styling-engine/softScoreFloors.js:76, which only reads
// piece.stretch inside a narrow branch: fabric_category === 'synthetic', AND fabric_weight is
// ultralight/light, AND fit_on_body is 'drapes' or unset. Outside that branch stretch is never
// read at all — a silk/wool/etc. piece short-circuits to `true` before stretch is ever consulted.
//
// Read-only. No model call.

import { db, parsePiece } from '../db.js'

const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
console.log(`${pieces.length} active pieces\n`)

const norm = v => String(v || '').toLowerCase().trim()

// --- How populated is the field itself, independent of consumption? ---
const dist = {}
for (const p of pieces) {
  const key = p.stretch === null || p.stretch === undefined || p.stretch === '' ? '(empty)' : p.stretch
  dist[key] = (dist[key] || 0) + 1
}
console.log('--- stretch value distribution ---')
for (const [k, n] of Object.entries(dist).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`)
const populated = pieces.length - (dist['(empty)'] || 0)
console.log(`\n  ${populated}/${pieces.length} (${Math.round(100 * populated / pieces.length)}%) have any stretch value at all`)

// --- Reproduce refinedFabric()'s gating exactly (styling-engine/softScoreFloors.js) ---
function reachesStretchCheck(p) {
  if (norm(p.fabric_category) !== 'synthetic') return false
  const weightOk = ['ultralight', 'light'].includes(norm(p.fabric_weight))
  const fitOk = ['drapes', ''].includes(norm(p.fit_on_body))
  return weightOk && fitOk
}

const reachable = pieces.filter(reachesStretchCheck)
console.log(`\n--- pieces where refinedFabric() actually evaluates stretch ---`)
console.log(`  ${reachable.length}/${pieces.length} (${Math.round(100 * reachable.length / pieces.length)}%) — synthetic + ultralight/light weight + drapes-or-unset fit`)

const blocks = reachable.filter(p => !['none', 'minimal', ''].includes(norm(p.stretch)))
console.log(`  ${blocks.length}/${reachable.length} of those have stretch actually block refinement (stretch = moderate/stretchy)`)

if (reachable.length && !blocks.length) {
  console.log('\n  VERDICT: fully non-discriminating on this wardrobe today. The mechanism is real and')
  console.log('  correctly wired, but zero pieces currently exist where stretch changes the outcome —')
  console.log('  every piece that reaches the check also happens to pass it. Same class as')
  console.log('  heel_height/role_permission before correction (engine-behaviour-map.md → Provenance),')
  console.log('  not the same class as fiber_content\'s live wet-exposure miss.')
}

// --- The null-handling quirk: unset stretch silently passes the "not stretchy" test ---
const unsetInReachable = reachable.filter(p => p.stretch === null || p.stretch === undefined || p.stretch === '')
console.log(`\n--- null-handling: ${unsetInReachable.length}/${reachable.length} reachable pieces have NO stretch value`)
console.log('  refinedFabric() treats unset stretch the same as stretch="none" (norm(null) === "" is in')
console.log('  the pass-list). A genuinely stretchy synthetic piece that was never tagged for stretch')
console.log('  would silently pass the "not stretchy" floor rather than being excluded — backwards from')
console.log('  the conservative-default convention used elsewhere in this schema (needs_base\'s explicit')
console.log('  "conservative default: null, not no"). Currently latent: none of the untagged pieces in')
console.log('  the reachable set are known to actually be stretchy (no ground truth to check against),')
console.log('  so this cannot be shown to have produced a wrong answer yet — recorded as a design risk,')
console.log('  not a confirmed live miss.')
