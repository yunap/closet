#!/usr/bin/env node
// thermal-comfort-band-spec.md §12 Slice 1 — can Closet's stored facts place garments into a small
// ordered warmth representation, reliably enough to compare against a demand?
//
// Measurement only. No production code, no IREQ/PMV, no new unit (§12).
//   WARDROBE_DB_PATH=<copy> node scratch/measure_warmth_placement.mjs
import { thermalMaterialVerdict, interiorConstruction, wardrobeCategoryGroup, fabricWeight } from '../styling-engine/attributes.js'
const { db, parsePiece } = await import('../db.js')
const { proposedWarmthLevel, warmthCalibrationEvidenceState, WARMTH_LEVELS } = await import('../styling-engine/warmthCalibration.js')
const { pieceWeatherScores } = await import('../styling-engine/thermal.js')

const pieces = db.prepare("SELECT * FROM pieces WHERE status='active'").all().map(parsePiece)
const clothing = pieces.filter(p => !['shoes', 'accessory'].includes(wardrobeCategoryGroup(p)))

console.log(`# Warmth placement, measured on the real wardrobe\n`)
console.log(`active pieces ${pieces.length} · clothing (thermal scope) ${clothing.length}\n`)

// ── 1. Placement coverage ────────────────────────────────────────────────────────────────────
const placed = new Map(WARMTH_LEVELS.map(l => [l, 0]))
const unplaced = { insufficient_evidence: 0, thermally_ambiguous: 0 }
for (const p of clothing) {
  const lvl = proposedWarmthLevel(p)
  if (lvl) placed.set(lvl, placed.get(lvl) + 1)
  else unplaced[warmthCalibrationEvidenceState(p)] = (unplaced[warmthCalibrationEvidenceState(p)] || 0) + 1
}
const totalPlaced = [...placed.values()].reduce((a, b) => a + b, 0)
console.log('## 1. Can the existing facts place a garment?')
for (const [l, n] of placed) console.log(`  ${l.padEnd(12)} ${String(n).padStart(4)}`)
for (const [k, n] of Object.entries(unplaced)) if (n) console.log(`  ${('UNPLACED ' + k).padEnd(12)} ${String(n).padStart(4)}`)
console.log(`  placed ${totalPlaced}/${clothing.length} = ${(100 * totalPlaced / clothing.length).toFixed(1)}%\n`)

// ── 2. Does the scale actually SEPARATE, or does one level absorb everything? ────────────────
const share = [...placed.entries()].map(([l, n]) => [l, n / (totalPlaced || 1)])
const biggest = share.sort((a, b) => b[1] - a[1])[0]
console.log('## 2. Separation')
console.log(`  largest level: ${biggest[0]} holds ${(100 * biggest[1]).toFixed(1)}% of placed garments`)
console.log(`  levels actually used: ${[...placed.values()].filter(n => n > 0).length}/${WARMTH_LEVELS.length}\n`)

// ── 3. Outerwear specifically — the layer that decides the Vienna case ───────────────────────
console.log('## 3. Outerwear placement (the pinned ordering cases live here)')
const outer = clothing.filter(p => wardrobeCategoryGroup(p) === 'outerwear')
for (const p of outer.sort((a, b) => (pieceWeatherScores(b).cold) - (pieceWeatherScores(a).cold))) {
  console.log(`  ${String(p.id).padEnd(8)}${String(p.name).slice(0, 34).padEnd(36)}` +
    `${String(proposedWarmthLevel(p) || 'UNPLACED').padEnd(13)}` +
    `${String(fabricWeight(p) || '-').padEnd(8)}${thermalMaterialVerdict(p).padEnd(15)}` +
    `${interiorConstruction(p).padEnd(17)}cold=${String(pieceWeatherScores(p).cold).padStart(5)}`)
}

// ── 4. Base vs removable — the minimum layer-placement information (§12) ─────────────────────
console.log('\n## 4. Base vs removable: what already distinguishes them?')
const groups = {}
for (const p of clothing) {
  const g = wardrobeCategoryGroup(p)
  groups[g] = groups[g] || { n: 0, needsBase: 0, kinds: new Set() }
  groups[g].n++
  if (p.needs_base) groups[g].needsBase++
  if (p.garment_kind) groups[g].kinds.add(p.garment_kind)
}
for (const [g, v] of Object.entries(groups)) {
  console.log(`  ${g.padEnd(12)} n=${String(v.n).padStart(3)}  needs_base=${v.needsBase}  kinds=${[...v.kinds].slice(0, 8).join(',') || '-'}`)
}

// ── 5. Do the two existing representations AGREE on ordering? ────────────────────────────────
// proposedWarmthLevel (substance + insulating bonus) and pieceWeatherScores().cold are both built
// from the same stored facts. If they disagree on which of two garments is warmer, the facts do not
// yet place garments reliably — which is precisely §12's question.
console.log('\n## 5. Ordering agreement between the two representations')
const scored = clothing.map(p => ({ p, lvl: proposedWarmthLevel(p), cold: pieceWeatherScores(p).cold }))
  .filter(x => x.lvl !== null)
const idx = l => WARMTH_LEVELS.indexOf(l)
let agree = 0, invert = 0, tie = 0
for (let i = 0; i < scored.length; i++) {
  for (let j = i + 1; j < scored.length; j++) {
    const a = scored[i], b = scored[j]
    const dl = idx(a.lvl) - idx(b.lvl)
    const dc = a.cold - b.cold
    if (dl === 0 || dc === 0) { tie++; continue }
    if (Math.sign(dl) === Math.sign(dc)) agree++; else invert++
  }
}
const decisive = agree + invert
console.log(`  comparable pairs ${decisive}  agree ${agree} (${(100 * agree / decisive).toFixed(1)}%)  INVERTED ${invert} (${(100 * invert / decisive).toFixed(1)}%)`)

// The worst inversions: same-level garments far apart on cold, and cross-level reversals.
const inversions = []
for (let i = 0; i < scored.length; i++) {
  for (let j = i + 1; j < scored.length; j++) {
    const a = scored[i], b = scored[j]
    const dl = idx(a.lvl) - idx(b.lvl), dc = a.cold - b.cold
    if (dl && dc && Math.sign(dl) !== Math.sign(dc)) inversions.push({ a, b, gap: Math.abs(dc) })
  }
}
console.log('\n  worst ordering reversals (level says one thing, cold score the other):')
for (const { a, b } of inversions.sort((x, y) => y.gap - x.gap).slice(0, 6)) {
  console.log(`    ${String(a.p.name).slice(0, 30).padEnd(32)}${a.lvl.padEnd(11)}cold=${String(a.cold).padStart(4)}`)
  console.log(`    ${String(b.p.name).slice(0, 30).padEnd(32)}${b.lvl.padEnd(11)}cold=${String(b.cold).padStart(4)}\n`)
}

// ── 6. How wide is a level, measured in cold points? ─────────────────────────────────────────
console.log('## 6. Level width — does a level mean one thing?')
for (const l of WARMTH_LEVELS) {
  const xs = scored.filter(x => x.lvl === l).map(x => x.cold).sort((a, b) => a - b)
  if (!xs.length) continue
  console.log(`  ${l.padEnd(12)} n=${String(xs.length).padStart(3)}  cold ${String(xs[0]).padStart(4)} .. ${String(xs[xs.length - 1]).padStart(3)}  median ${xs[Math.floor(xs.length / 2)]}`)
}

// ── 7. §12.1 row 6: "unknown garment evidence → unknown, never neutral warmth" ───────────────
console.log('\n## 7. Pinned case: does unknown evidence stay unknown?')
const byVerdict = { insulating: 0, non_insulating: 0, unknown: 0 }
const placedUnknown = []
for (const p of clothing) {
  const v = thermalMaterialVerdict(p)
  byVerdict[v]++
  if (v === 'unknown' && proposedWarmthLevel(p)) placedUnknown.push(p)
}
console.log(`  material verdicts: insulating ${byVerdict.insulating}  non_insulating ${byVerdict.non_insulating}  unknown ${byVerdict.unknown}`)
console.log(`  garments with UNKNOWN material evidence that still receive a warmth level: ${placedUnknown.length}`)
console.log(`  → these are placed from fabric_weight alone; row 6 says unknown must not become a level.`)
for (const p of placedUnknown.slice(0, 5)) {
  console.log(`      ${String(p.id).padEnd(8)}${String(p.name).slice(0, 32).padEnd(34)}${proposedWarmthLevel(p)}`)
}

// ── 8. The specific defect behind the inversions ─────────────────────────────────────────────
console.log('\n## 8. Bare + insulating fibre — the systematic reversal')
const bare = clothing.filter(p => proposedWarmthLevel(p) === 'warm' && pieceWeatherScores(p).cold <= 2)
console.log(`  garments placed "warm" yet scoring cold <= 2: ${bare.length}`)
for (const p of bare.slice(0, 6)) {
  console.log(`      ${String(p.name).slice(0, 34).padEnd(36)}sleeve=${String(p.sleeve_length || '-').padEnd(11)}cold=${String(pieceWeatherScores(p).cold).padStart(4)}`)
}
console.log('  → proposedWarmthLevel is substance + insulating bonus ONLY. It never reads coverage,')
console.log('    so a sleeveless wool shell is "warm" while the evidence layer scores it near zero.')
