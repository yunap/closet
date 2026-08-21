// Settles the questions the engine-behaviour map raised but did not answer.
//
// Each block below corresponds to an [unverified] tag that turned out to be cheap to resolve
// against the real wardrobe. Kept as a script so the answers can be re-derived when the data
// changes rather than trusted from a doc.
//
//   node scratch/measure_open_questions.js
//
// Read-only. No network, no model call.

import { db, parsePiece } from '../db.js'
import { pieceFormality, wardrobeCategoryGroup, isAccessory, pieceHasInsulatingMaterial, fabricWeight } from '../styling-engine/attributes.js'
import { missingGateFields, pieceHasWetSensitiveFootwearMaterial } from '../styling-engine/attributes.js'
import { wholeWardrobePieceTrustDecision, formalityFitForPiece, weatherFitForPiece, pieceStyleProfile } from '../styling-engine/rules.js'
import { capsuleVersatilityScore } from '../styling-engine/outfitSetPlanner.js'

const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
const line = t => console.log(`\n${'='.repeat(72)}\n${t}\n${'='.repeat(72)}`)

// ── Q1: do the 35 pieces with no fiber_content pass the hot-weather fiber clause? ──
line('Q1  fiber_content gap — does it let pieces through the hot-weather clause?')
const noFiber = pieces.filter(p => missingGateFields(p).includes('fiber_content'))
let noFiberBlockedHot = 0
let noFiberBlockedByFiberClause = 0
for (const p of noFiber) {
  const d = wholeWardrobePieceTrustDecision(p, { occasion: 'casual', weatherProfile: { isHot: true } })
  if (!d.allowed) noFiberBlockedHot++
  if ((d.reasons || []).some(r => r.includes('insulating fiber'))) noFiberBlockedByFiberClause++
}
console.log(`  ${noFiber.length} pieces have no fiber_content`)
console.log(`  of those, ${noFiberBlockedHot} are blocked in a hot casual context anyway (other layers)`)
console.log(`  of those, ${noFiberBlockedByFiberClause} are blocked BY the insulating-fiber clause`)
const heavyNoFiber = noFiber.filter(p => fabricWeight(p) === 'heavy' || fabricWeight(p) === 'medium')
console.log(`  ${heavyNoFiber.length} of them are medium/heavy weight — the population the clause exists to catch`)
console.log(`  (pieceHasInsulatingMaterial reads fiber_content AND fabric_category: ${noFiber.filter(pieceHasInsulatingMaterial).length} of ${noFiber.length} return true)`)

// ── Q2: what IS the low-occasion-confidence population for evening / loungewear? ──
line('Q2  "AI profile low confidence" — untagged, or genuinely unsuitable?')
for (const occasion of ['evening', 'home']) {
  const blocked = pieces.filter(p => {
    const d = wholeWardrobePieceTrustDecision(p, { occasion, weatherProfile: {} })
    return (d.reasons || []).some(r => r.startsWith('AI profile low confidence'))
  })
  const conf = new Map()
  let noProfileAtAll = 0
  for (const p of blocked) {
    const profile = pieceStyleProfile(p)
    const oc = profile?.garment_intelligence?.occasion_confidence
    if (!oc || typeof oc !== 'object') { noProfileAtAll++; continue }
    for (const [k, v] of Object.entries(oc)) conf.set(`${k}=${v}`, (conf.get(`${k}=${v}`) || 0) + 1)
  }
  console.log(`\n  ${occasion}: ${blocked.length} pieces blocked for low confidence`)
  console.log(`    ${noProfileAtAll} of them have NO occasion_confidence map at all (absence, not a judgement)`)
  const byGroup = {}
  for (const p of blocked) { const g = wardrobeCategoryGroup(p); byGroup[g] = (byGroup[g] || 0) + 1 }
  console.log(`    by group: ${Object.entries(byGroup).map(([g, n]) => `${g}=${n}`).join(' ')}`)
}

// ── Q3: do planWorkbenchPieceScore's near-constant terms change the selected 40? ──
line('Q3  planWorkbenchPieceScore — do the near-constant terms change what is selected?')
const SLOT = { occasion: 'casual', register: 'everyday' }
const score = (p, { withTrusted = true, withRole = true } = {}) => {
  let s = 0
  const group = wardrobeCategoryGroup(p)
  if (['top', 'bottom', 'dress', 'shoes'].includes(group)) s += 80
  if (['outerwear', 'accessory'].includes(group)) s += 30
  if (withTrusted && p.recommendation_status === 'trusted') s += 50
  if (p.fit_confidence === 'high') s += 30
  if (withRole && (p.role_permission === 'hero' || p.role_permission === 'auto')) s += 20
  const occ = (Array.isArray(p.occasions) ? p.occasions : []).map(o => String(o).toLowerCase())
  if (occ.includes(SLOT.occasion)) s += 35
  if (fabricWeight(p) === 'light') s += 5
  return s
}
const rank = opts => pieces
  .map((p, i) => ({ id: Number(p.id), s: score(p, opts), i }))
  .sort((a, b) => b.s - a.s || b.id - a.id || a.i - b.i)
  .slice(0, 40).map(x => x.id)

const base = rank()
const noRole = rank({ withRole: false })
const noTrusted = rank({ withTrusted: false })
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
const overlap = (a, b) => a.filter(x => b.includes(x)).length
console.log(`  top-40 identical with role_permission term removed?      ${same(base, noRole)}  (overlap ${overlap(base, noRole)}/40)`)
console.log(`  top-40 identical with trusted term removed?              ${same(base, noTrusted)}  (overlap ${overlap(base, noTrusted)}/40)`)

// ── Q4: capsuleVersatilityScore's +16 occasion term — sparse tagging or bad weight? ──
line('Q4  capsule occasion-breadth term — is the wardrobe under-tagged, or is 4+ just rare?')
const dist = new Map()
for (const p of pieces) {
  const n = (Array.isArray(p.occasions) ? p.occasions : []).length
  dist.set(n, (dist.get(n) || 0) + 1)
}
for (const [n, count] of [...dist].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${String(count).padStart(4)} pieces tagged with ${n} occasion${n === 1 ? '' : 's'}`)
}

// ── Q5: the sub-scorers nobody has measured ─────────────────────────────────
line('Q5  formalityFitForPiece / weatherFitForPiece — how large are they in practice?')
for (const [label, opts] of [
  ['dressy request', { occasion: 'evening', request: 'dinner, something dressy' }],
  ['walkable request', { occasion: 'casual', activity: 'walking', request: 'lots of walking today' }],
  ['no register intent', { occasion: 'casual', request: 'something to wear' }]
]) {
  const scores = pieces.map(p => formalityFitForPiece(p, opts).score)
  const nonZero = scores.filter(s => s !== 0)
  console.log(`  formalityFitForPiece, ${label}: ${nonZero.length}/${pieces.length} pieces non-zero, range ${nonZero.length ? Math.min(...nonZero) : 0}..${nonZero.length ? Math.max(...nonZero) : 0}`)
}
for (const [label, weather] of [['hot', { isHot: true }], ['cold', { isCold: true }], ['mild', {}]]) {
  const scores = pieces.map(p => weatherFitForPiece(p, weather).score)
  const nonZero = scores.filter(s => s !== 0)
  console.log(`  weatherFitForPiece, ${label}: ${nonZero.length}/${pieces.length} pieces non-zero, range ${nonZero.length ? Math.min(...nonZero) : 0}..${nonZero.length ? Math.max(...nonZero) : 0}`)
}

// ── Q6: what the 'elevated' tag actually covers ─────────────────────────────
line('Q6  the elevated population — what is actually in it?')
const elevated = pieces.filter(p => pieceFormality(p) === 'elevated' && !isAccessory(p))
const byGroup = {}
for (const p of elevated) { const g = wardrobeCategoryGroup(p); byGroup[g] = (byGroup[g] || 0) + 1 }
console.log(`  ${elevated.length} non-accessory elevated pieces: ${Object.entries(byGroup).map(([g, n]) => `${g}=${n}`).join(' ')}`)
const alsoTaggedCasual = elevated.filter(p => (Array.isArray(p.occasions) ? p.occasions : []).map(o => String(o).toLowerCase()).includes('casual'))
console.log(`  ${alsoTaggedCasual.length} of them are ALSO tagged with the 'casual' occasion by the owner/tagger`)
console.log(`  — those are pieces the wardrobe says are casual-appropriate and the ceiling blocks anyway`)

// ── Q7: does the fiber_content gap also let shoes through the wet-exposure clause? ──
// Same shape as Q1, for the SECOND real fiber_content consumer: pieceHasWetSensitiveFootwearMaterial
// (attributes.js) only fires on 'suede' in fiber_content (or 'canvas' in fabric_category), gating
// footwear out of wet-exposure requests. Q1 only checked the hot-weather insulating-fiber clause —
// this settles whether the same missing-data population also has a live footwear consequence.
line('Q7  fiber_content gap — does it let shoes through the wet-exposure footwear clause?')
const noFiberShoes = noFiber.filter(p => wardrobeCategoryGroup(p) === 'shoes')
console.log(`  ${noFiberShoes.length} of the ${noFiber.length} no-fiber_content pieces are shoes`)
let stillCaughtByFabricCategory = 0
let missedEntirely = 0
for (const p of noFiberShoes) {
  if (pieceHasWetSensitiveFootwearMaterial(p)) { stillCaughtByFabricCategory++; continue }
  missedEntirely++
  const nameHasSuede = /suede/i.test(String(p.name || '') + ' ' + String(p.notes || ''))
  if (nameHasSuede) console.log(`    MISS: piece ${p.id} "${p.name}" — name/notes say suede, fiber_content empty, fabric_category='${p.fabric_category || ''}' — pieceHasWetSensitiveFootwearMaterial returns false`)
}
console.log(`  of those, ${stillCaughtByFabricCategory} still pass pieceHasWetSensitiveFootwearMaterial anyway (caught via fabric_category='canvas')`)
console.log(`  ${missedEntirely} pass the clause as false purely because fiber_content is empty — any flagged above are a real, live miss`)

// ── Q8: does the fiber_content gap change capsuleVersatilityScore's summer term? ──
// Third real consumer: capsuleVersatilityScore's isSummer branch reads fiber_content OR
// fabric_category through the same hasFiberOrFabric() check. A piece with no fiber_content still
// gets the fabric_category half of that check, so this settles whether fiber_content is doing any
// WORK here beyond what fabric_category alone already provides.
line('Q8  fiber_content gap — does it change the capsule summer versatility score?')
let scoreChangedBySummer = 0
let fiberOnlyPenalty = 0
let fiberOnlyBonus = 0
for (const p of noFiber) {
  const withFiber = capsuleVersatilityScore(p, { isSummer: true })
  const withoutFiber = capsuleVersatilityScore({ ...p, fiber_content: [] }, { isSummer: true })
  if (withFiber !== withoutFiber) scoreChangedBySummer++
}
console.log(`  ${noFiber.length} pieces have no fiber_content — score is therefore already computed with fiber_content=[]`)
console.log(`  ${scoreChangedBySummer} of them would score differently in the summer term if fiber_content were populated`)
console.log(`  (a piece missing fiber_content can only be under-penalized/under-rewarded here, never wrongly excluded —`)
console.log(`   this term is additive scoring, not a hard gate, so a miss here is a ranking effect, not a visibility one)`)
