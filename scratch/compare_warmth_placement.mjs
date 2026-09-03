#!/usr/bin/env node
// Slice 2 gate (band spec §13.6): the NEW placement against the five criteria.
// pieceWeatherScores().cold appears here ONLY as a diagnostic disagreement signal — never as the
// target to fit. Owner ruling 2026-09-03; fitting to it would promote the score §10.1 disqualified.
import { thermalMaterialVerdict, fabricWeight, wardrobeCategoryGroup } from '../styling-engine/attributes.js'
const { db, parsePiece } = await import('../db.js')
const { garmentWarmthLevel, warmthPlacementState, warmthIsRemovable, WARMTH_LEVELS } = await import('../styling-engine/garmentWarmth.js')
const { proposedWarmthLevel } = await import('../styling-engine/warmthCalibration.js')
const { pieceWeatherScores } = await import('../styling-engine/thermal.js')

const clothing = db.prepare("SELECT * FROM pieces WHERE status='active'").all().map(parsePiece)
  .filter(p => !['shoes', 'accessory'].includes(wardrobeCategoryGroup(p)))

console.log('# Slice 2 gate\n')
const dist = new Map(WARMTH_LEVELS.map(l => [l, 0]))
const states = {}
for (const p of clothing) {
  const l = garmentWarmthLevel(p)
  if (l) dist.set(l, dist.get(l) + 1)
  states[warmthPlacementState(p)] = (states[warmthPlacementState(p)] || 0) + 1
}
const placed = [...dist.values()].reduce((a, b) => a + b, 0)
console.log('## Distribution (new)')
for (const [l, n] of dist) console.log(`  ${l.padEnd(12)} ${String(n).padStart(4)}`)
console.log(`  placed ${placed}/${clothing.length} = ${(100 * placed / clothing.length).toFixed(1)}%`)
console.log(`  states: ${Object.entries(states).map(([k, v]) => `${k}=${v}`).join('  ')}\n`)

console.log('## Gate 1 — unknown material evidence stays unknown, where it can move the level')
const atRisk = clothing.filter(p => ['medium', 'heavy'].includes(fabricWeight(p)) && thermalMaterialVerdict(p) === 'unknown')
const leaked = atRisk.filter(p => garmentWarmthLevel(p) !== null)
console.log(`  at-risk garments (medium/heavy + unknown material): ${atRisk.length}`)
console.log(`  still receiving a level: ${leaked.length}   ${leaked.length === 0 ? 'PASS' : 'FAIL'}`)
const oldLeak = atRisk.filter(p => proposedWarmthLevel(p) !== null).length
console.log(`  (old formula leaked ${oldLeak} of these)\n`)

console.log('## Gate 2 — coverage is represented')
const bare = clothing.filter(p => String(p.sleeve_length || '') === 'sleeveless' && thermalMaterialVerdict(p) === 'insulating')
console.log(`  sleeveless garments with insulating material: ${bare.length}`)
for (const p of bare.slice(0, 6)) {
  console.log(`    ${String(p.name).slice(0, 32).padEnd(34)}old=${String(proposedWarmthLevel(p) ?? '-').padEnd(11)}new=${String(garmentWarmthLevel(p) ?? 'UNKNOWN')}`)
}

console.log('\n## Gate 5 — DIAGNOSTIC ONLY: disagreement with the old cold score')
const scored = clothing.map(p => ({ p, lvl: garmentWarmthLevel(p), cold: pieceWeatherScores(p).cold })).filter(x => x.lvl)
const idx = l => WARMTH_LEVELS.indexOf(l)
let agree = 0, invert = 0
for (let i = 0; i < scored.length; i++) for (let j = i + 1; j < scored.length; j++) {
  const dl = idx(scored[i].lvl) - idx(scored[j].lvl), dc = scored[i].cold - scored[j].cold
  if (!dl || !dc) continue
  Math.sign(dl) === Math.sign(dc) ? agree++ : invert++
}
console.log(`  pairs ${agree + invert}  agree ${agree} (${(100 * agree / (agree + invert)).toFixed(1)}%)  disagree ${invert} (${(100 * invert / (agree + invert)).toFixed(1)}%)`)
console.log('  NOT a pass/fail number. Investigate large disagreement; do not minimise it.')

console.log('\n## Outerwear ordering (pinned rows 1 and 3 must be supportable)')
for (const p of clothing.filter(p => wardrobeCategoryGroup(p) === 'outerwear')
  .sort((a, b) => idx(garmentWarmthLevel(b) || '') - idx(garmentWarmthLevel(a) || ''))) {
  console.log(`  ${String(p.name).slice(0, 34).padEnd(36)}${String(garmentWarmthLevel(p) ?? 'UNKNOWN').padEnd(12)}removable=${warmthIsRemovable(p)}`)
}
