// Checking whether §13.3's "79% violation" claim is as strong as I stated it.
import { thermalMaterialVerdict, fabricWeight, wardrobeCategoryGroup } from '../styling-engine/attributes.js'
const { db, parsePiece } = await import('../db.js')
const { proposedWarmthLevel } = await import('../styling-engine/warmthCalibration.js')
const clothing = db.prepare("SELECT * FROM pieces WHERE status='active'").all().map(parsePiece)
  .filter(p => !['shoes','accessory'].includes(wardrobeCategoryGroup(p)))
const rows = clothing.filter(p => thermalMaterialVerdict(p) === 'unknown' && proposedWarmthLevel(p))
const bySub = {}
for (const p of rows) {
  const w = fabricWeight(p) || '(untagged)'
  bySub[w] = (bySub[w] || 0) + 1
}
console.log('placed garments with UNKNOWN material verdict, by substance:')
for (const [k, v] of Object.entries(bySub).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(12)} ${v}`)
console.log('\n  light/ultralight: unknown material cannot move the level far — placement is well founded')
console.log('  medium/heavy:     unknown material CAN move it multiple levels — this is the real risk')
const risky = rows.filter(p => ['medium','heavy'].includes(fabricWeight(p)))
console.log(`\n  at-risk placements (medium/heavy + unknown material): ${risky.length} of ${rows.length}`)
for (const p of risky.slice(0, 10)) {
  console.log(`      ${String(p.id).padEnd(8)}${String(p.name).slice(0,32).padEnd(34)}${String(fabricWeight(p)).padEnd(8)}${proposedWarmthLevel(p)}`)
}
