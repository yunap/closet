// Measures the CLASSIFIERS the diversity selector penalises on.
//
// `wholeWardrobeDiversitySelectionScore` charges -45 for a repeated formula family, -35 for a
// repeated silhouette, -18 grounding, -16 rhythm, -14 shoe shape. Those are the largest numbers in
// the engine — but a penalty is only as meaningful as the classifier it keys on. If every outfit
// lands in the same bucket, the penalty fires constantly and diversity degrades to "anything but
// the last one".
//
// Builds structurally-valid outfits from real gate-passing pieces and reports the bucket
// distribution for each classifier, plus how much of the pattern data the classifiers can see.
//
//   node scratch/measure_diversity_classifiers.js
//
// Read-only. No network, no model call. Feeds docs/engine-behaviour-map.md → "After the gate".

import { db, parsePiece } from '../db.js'
import { wardrobeCategoryGroup } from '../styling-engine/attributes.js'
import {
  wholeWardrobeFormulaFamily,
  wholeWardrobeSilhouetteFromPieces,
  wholeWardrobeGroundingStrategy,
  wholeWardrobeShoeShape,
  wholeWardrobeVisualRhythm,
  wholeWardrobeHasPrintOrStripe,
  wholeWardrobePieceTrustDecision,
  pieceNameBlob,
  pieceTextBlob
} from '../styling-engine/rules.js'

const OCCASION = 'casual'
const all = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
const allowed = all.filter(p => wholeWardrobePieceTrustDecision(p, { occasion: OCCASION, weatherProfile: {} }).allowed)

const byGroup = g => allowed.filter(p => wardrobeCategoryGroup(p) === g)
const tops = byGroup('top')
const bottoms = byGroup('bottom')
const shoes = byGroup('shoes')

console.log(`wardrobe ${all.length} active, ${allowed.length} pass the ${OCCASION} gate`)
console.log(`  usable: ${tops.length} tops, ${bottoms.length} bottoms, ${shoes.length} shoes\n`)

// Deterministic spread across the pools — no randomness (and Date.now/Math.random are unavailable
// in some tooling here anyway). Strided so the sample is not just the first N of each list.
const outfits = []
const N = Math.min(600, tops.length * bottoms.length * shoes.length)
for (let i = 0; i < N; i++) {
  const top = tops[(i * 7) % tops.length]
  const bottom = bottoms[(i * 11) % bottoms.length]
  const shoe = shoes[(i * 13) % shoes.length]
  if (!top || !bottom || !shoe) continue
  outfits.push({ pieces: [top, bottom, shoe], pieceIds: [top.id, bottom.id, shoe.id] })
}
console.log(`sampled ${outfits.length} structurally-valid top+bottom+shoe outfits\n`)

const report = (label, fn) => {
  const counts = new Map()
  for (const outfit of outfits) {
    const value = String(fn(outfit) ?? '(null)')
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1])
  const top = sorted[0]
  console.log(`${label}  — ${sorted.length} distinct bucket${sorted.length === 1 ? '' : 's'}, largest holds ${((top[1] / outfits.length) * 100).toFixed(0)}%`)
  for (const [value, n] of sorted.slice(0, 6)) {
    console.log(`    ${String(n).padStart(4)}  ${((n / outfits.length) * 100).toFixed(0).padStart(3)}%  ${value}`)
  }
  if (sorted.length > 6) console.log(`    … ${sorted.length - 6} more`)
  console.log('')
}

console.log('--- what each diversity classifier actually returns ---\n')
report('formulaFamily   (-45 per repeat)', o => wholeWardrobeFormulaFamily(o, allowed, OCCASION))
report('silhouette      (-35 per repeat)', o => wholeWardrobeSilhouetteFromPieces(o))
report('grounding       (-18 per repeat)', o => wholeWardrobeGroundingStrategy(o))
report('visual rhythm   (-16 per repeat)', o => wholeWardrobeVisualRhythm(o))
report('shoe shape      (-14 per repeat)', o => wholeWardrobeShoeShape(o))
report('print/stripe    (-20 per repeat)', o => String(wholeWardrobeHasPrintOrStripe(o)))

// ── can the classifiers even SEE the pattern data? ──────────────────────────
// The pattern classifiers read pieceNameBlob (name + category + reads_as), not pattern_type.
console.log('--- pattern visibility: structured tag vs what the classifier reads ---')
const PATTERN_RE = /\b(floral|print|graphic|stripe|striped|pattern|abstract|tapestry)\b/
const patterned = all.filter(p => {
  const t = String(p.pattern_type || '').toLowerCase()
  return t && t !== 'solid' && t !== 'none'
})
const invisible = patterned.filter(p => !PATTERN_RE.test(pieceNameBlob(p)))
const falsePositive = all.filter(p => {
  const t = String(p.pattern_type || '').toLowerCase()
  return (t === 'solid' || t === 'none') && PATTERN_RE.test(pieceNameBlob(p))
})
console.log(`  ${patterned.length} pieces have a non-solid pattern_type`)
console.log(`  ${invisible.length} of those are INVISIBLE to the classifier (no pattern word in name/category/reads_as)`)
console.log(`  ${falsePositive.length} solid-tagged pieces READ as patterned to the classifier`)
for (const p of invisible.slice(0, 8)) {
  console.log(`    invisible: ${String(p.id).padEnd(7)} ${String(p.pattern_type).padEnd(10)} ${String(p.name).slice(0, 46)}`)
}

console.log('\nNOTE: a coarse classifier is not automatically wrong — but a -45 penalty on a bucket')
console.log('that holds most outfits behaves differently from one on a bucket that holds a few.')

// ── the same classifiers, plural-tolerant ───────────────────────────────────
// See scratch/measure_plural_gap.js: the engine tests singular keywords against plural garment
// names. These are the same three classifiers with 's?' added, to show how much of the reported
// bucket concentration is real and how much is the regex bug.
console.log('\n--- corrected: the same classifiers with plural-tolerant regexes ---\n')

const shoeOf = o => (o.pieces || []).find(p => wardrobeCategoryGroup(p) === 'shoes') || null

const groundingFixed = (o) => {
  const shoe = shoeOf(o)
  if (!shoe) return 'no shoe grounding'
  const t = pieceTextBlob(shoe)
  if (/\b(black|dark|charcoal|navy|brown|tan)\b/.test(t) && /\b(pointed|boots?|loafers?|mules?|oxfords?|structured)\b/.test(t)) return 'sharp dark grounding'
  if (/\b(sneakers?|slip-ons?|flats?|sandals?|flip)\b/.test(t)) return 'soft casual grounding'
  return 'standard shoe anchor'
}
const shapeFixed = (o) => {
  const shoe = shoeOf(o)
  if (!shoe) return 'none'
  const t = pieceTextBlob(shoe)
  if (/\b(pointed)\b/.test(t)) return 'pointed'
  if (/\b(almond|oval)\b/.test(t)) return 'almond/oval'
  if (/\b(square)\b/.test(t)) return 'square'
  if (/\b(rounds?|loafers?|boots?|sneakers?)\b/.test(t)) return 'rounded/square'
  return 'rounded'
}

const compare = (label, before, after) => {
  const tally = fn => {
    const m = new Map()
    for (const o of outfits) { const k = String(fn(o)); m.set(k, (m.get(k) || 0) + 1) }
    return [...m].sort((a, b) => b[1] - a[1])
  }
  const b = tally(before), a = tally(after)
  const pctOf = t => `${((t[0][1] / outfits.length) * 100).toFixed(0)}% in "${t[0][0]}"`
  console.log(`${label}`)
  console.log(`    as written:      ${b.length} buckets, largest ${pctOf(b)}`)
  console.log(`    plural-tolerant: ${a.length} buckets, largest ${pctOf(a)}`)
  console.log(`      -> ${a.map(([k, n]) => `${k}=${n}`).join('  ')}`)
}

compare('grounding strategy (-18 per repeat)', wholeWardrobeGroundingStrategy, groundingFixed)
compare('shoe shape (-14 per repeat)', wholeWardrobeShoeShape, shapeFixed)

console.log('\n  The shoe-shape classifier is the one materially misreported: its concentration in')
console.log('  the default bucket is the plural bug, not wardrobe uniformity.')
