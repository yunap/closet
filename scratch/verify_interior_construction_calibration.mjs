#!/usr/bin/env node
// docs/interior-construction-spec.md §10 steps 8 and 9 — the calibration stage, run as
// VERIFICATION rather than as a decision gate (owner ruling 2026-09-02).
//
// Reads the repaired REAL wardrobe rows and checks the spec's invariants against them. Any
// contradiction exits non-zero: it is a test failure to iterate on, not a checkpoint to escalate.
//
//   node scratch/verify_interior_construction_calibration.mjs           # against a DB copy
//   WARDROBE_DB_PATH=... node scratch/verify_interior_construction_calibration.mjs
import { thermalMaterialVerdict, interiorConstruction } from '../styling-engine/attributes.js'
const { db, parsePiece } = await import('../db.js')
const { pieceWeatherScores } = await import('../styling-engine/thermal.js')

const IDS = [996767, 996762, 250, 207, 996759, 996867, 996764, 996868, 996866, 996775, 996765]
const rows = db.prepare(`SELECT * FROM pieces WHERE id IN (${IDS.join(',')})`).all().map(parsePiece)
const P = new Map(rows.map(r => [Number(r.id), r]))
const cold = id => pieceWeatherScores(P.get(id)).cold
const verdict = id => thermalMaterialVerdict(P.get(id))

const failures = []
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

console.log('# Real-garment calibration, against the repaired wardrobe\n')
console.log('## Stored facts')
for (const id of IDS) {
  const p = P.get(id)
  if (!p) { failures.push(`missing piece ${id}`); continue }
  console.log(`  ${String(id).padEnd(7)} ${String(p.name).slice(0, 36).padEnd(38)}` +
    `${interiorConstruction(p).padEnd(17)}${JSON.stringify(p.insulating_layer_materials ?? null).padEnd(15)}` +
    `${verdict(id).padEnd(15)}cold=${String(cold(id)).padStart(5)}`)
}

console.log('\n## §13 — the two regression tests that matter')
check('996764 reversible is NOT insulated', verdict(996764) !== 'insulating', verdict(996764))
check('996764 is warmer than the unlined light jacket 996767',
  cold(996764) > cold(996767), `${cold(996764)} > ${cold(996767)}`)
check('996868 shearling-lined IS insulating', verdict(996868) === 'insulating')
check('996868 records shearling, not generic fleece',
  JSON.stringify(P.get(996868).insulating_layer_materials) === '["shearling"]',
  JSON.stringify(P.get(996868).insulating_layer_materials))
check('996868 shearling left fiber_content, which describes the FACE',
  !(P.get(996868).fiber_content || []).includes('fleece'),
  JSON.stringify(P.get(996868).fiber_content))

console.log('\n## §7.1 — the required ordering, on real garments')
check('unlined light jacket < reversible double layer',
  cold(996767) < cold(996764), `996767 ${cold(996767)} < 996764 ${cold(996764)}`)
check('reversible double layer < shearling-lined',
  cold(996764) < cold(996868), `996764 ${cold(996764)} < 996868 ${cold(996868)}`)
check('shearling-lined <= polyester-filled puffer',
  cold(996868) <= cold(996866), `996868 ${cold(996868)} <= 996866 ${cold(996866)}`)
check('polyester-filled <= down-filled puffer',
  cold(996866) <= cold(996775), `996866 ${cold(996866)} <= 996775 ${cold(996775)}`)

console.log('\n## §12.2 — three pieces stay insulating through the FACE fabric')
check('250 charcoal tweed, unlined, no fill', verdict(250) === 'insulating', verdict(250))
check('996762 grey fleece, unlined, no fill', verdict(996762) === 'insulating', verdict(996762))
check('996867 wool coat, lined, no fill', verdict(996867) === 'insulating', verdict(996867))

console.log('\n## §6.1 — the first real non_insulating verdicts, checked against verified facts')
// Activation. Each of these is a garment the owner confirmed has no fill and no warm face fabric.
for (const [id, why] of [[207, 'leather jacket, lined, no fill'],
                         [996759, 'cotton/poly trench, lined, no fill'],
                         [996767, 'cotton jacket, unlined, no fill']]) {
  check(`${id} → non_insulating (${why})`, verdict(id) === 'non_insulating', verdict(id))
}
check('no repaired piece landed on a verdict its stored facts contradict',
  IDS.every(id => {
    const p = P.get(id)
    const layer = p.insulating_layer_materials
    if (Array.isArray(layer) && layer.length) return verdict(id) === 'insulating'
    return true
  }))

console.log('\n## §6 — construction never moved a verdict')
for (const id of IDS) {
  const p = P.get(id)
  const stripped = { ...p, interior_construction: null }
  if (thermalMaterialVerdict(stripped) !== verdict(id)) {
    failures.push(`construction changed the verdict for ${id}`)
    console.log(`  FAIL  ${id}: verdict depends on interior_construction`)
  }
}
if (!failures.some(f => f.startsWith('construction changed'))) {
  console.log('  ok    removing interior_construction changes no verdict, on any of the 11')
}

console.log(failures.length ? `\n❌ ${failures.length} contradiction(s)` : '\n✅ all calibration invariants hold')
process.exit(failures.length ? 1 : 0)
