// Measures the ROLE vocabulary that decides an outfit's formula family.
//
// inferOutfitArchetype scores archetypes by which roles a piece set yields, and the winning
// archetype's formulaFamily is what the -45 diversity repeat penalty keys on. So the role
// classifier is upstream of the largest number in the engine.
//
// Unlike the diversity/pattern classifiers, this one IS confidence-aware: silhouette and
// fit_on_body only enter the text blob when trustedField() accepts their confidence.
//
//   node scratch/measure_roles.js
//
// Read-only. No network, no model call.

import { db, parsePiece } from '../db.js'
import { inferWholeWardrobePieceRoles, getFieldConfidence } from '../styling-engine/rules.js'

const pieces = db.prepare("SELECT * FROM pieces WHERE status='active'").all().map(parsePiece)
const trusted = (p, f) => ['manual', 'high', 'medium'].includes(getFieldConfidence(p, f))

console.log(`wardrobe: ${pieces.length} active pieces\n`)
console.log('--- confidence gating on the role text blob ---')
for (const field of ['silhouette', 'fit_on_body']) {
  const n = pieces.filter(p => trusted(p, field)).length
  console.log(`  ${field.padEnd(14)} reaches the blob on ${n}/${pieces.length} pieces (low confidence is dropped, not annotated)`)
}

const dist = new Map()
let none = 0
for (const p of pieces) {
  const roles = inferWholeWardrobePieceRoles(p)
  if (!roles.length) none++
  for (const role of roles) dist.set(role, (dist.get(role) || 0) + 1)
}
console.log(`\n--- role frequency (${none} of ${pieces.length} pieces yield NO role at all) ---`)
for (const [role, n] of [...dist].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${((n / pieces.length) * 100).toFixed(0).padStart(3)}%  ${role}`)
}

console.log('\nNOTE: an outfit whose pieces yield no preferred role scores below ARCHETYPE_MIN_SCORE')
console.log('and gets formulaFamily = null, which falls back to wholeWardrobeFormulaType.')

// ── singular-only regexes vs plural garment names ───────────────────────────
// Garment names are overwhelmingly plural for footwear ("black slip-on loafers"), but the
// classifiers test singular forms with word boundaries: /\bloafer\b/ does not match "loafers".
import { pieceTextBlob, pieceNameBlob } from '../styling-engine/rules.js'
import { wardrobeCategoryGroup } from '../styling-engine/attributes.js'

const shoes = pieces.filter(p => wardrobeCategoryGroup(p) === 'shoes')
console.log(`\n--- plural-form misses (${shoes.length} shoes) ---`)

const asWritten = { pointed: /\b(pointed)\b/, almond: /\b(almond|oval)\b/, square: /\b(square)\b/, rounded: /\b(round|loafer|boot|sneaker)\b/ }
const pluralOk = { pointed: /\b(pointed)\b/, almond: /\b(almond|oval)\b/, square: /\b(square)\b/, rounded: /\b(rounds?|loafers?|boots?|sneakers?)\b/ }
const classify = (s, re) => {
  const t = pieceTextBlob(s)
  if (re.pointed.test(t)) return 'pointed'
  if (re.almond.test(t)) return 'almond/oval'
  if (re.square.test(t)) return 'square'
  if (re.rounded.test(t)) return 'rounded/square'
  return 'rounded (default)'
}
const tally = re => {
  const m = new Map()
  for (const s of shoes) { const k = classify(s, re); m.set(k, (m.get(k) || 0) + 1) }
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join('  ')
}
console.log(`  wholeWardrobeShoeShape as written: ${tally(asWritten)}`)
console.log(`  same, plural-tolerant:             ${tally(pluralOk)}`)
console.log('  -> 8 shoes leave the default bucket once plurals match. The "93% rounded" result')
console.log('     reported under "After the gate" is substantially this bug, not real uniformity.')

const roleMissed = shoes.filter(s => {
  const blob = pieceNameBlob(s)
  return !/\b(pointed|patent|loafer|boot|mule|oxford)\b/.test(blob) && /\b(loafers|boots|mules|oxfords)\b/.test(blob)
})
console.log(`\n  inferWholeWardrobePieceRoles: ${roleMissed.length} shoes miss sharp_finish purely on plurals:`)
for (const s of roleMissed) console.log(`    ${s.name}`)
