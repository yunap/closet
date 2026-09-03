#!/usr/bin/env node
// docs/interior-construction-spec.md §12 — repair the verified calibration pieces.
//
// NOT a retag and NOT a bulk inference. It writes owner-verified facts to eleven named rows and
// touches exactly three columns: interior_construction, insulating_layer_materials, fiber_content.
// Every value below came from the owner inspecting the actual garment; nothing here is derived.
//
//   node scratch/repair_interior_construction_calibration.mjs            # dry run, prints the diff
//   WARDROBE_ALLOW_LIVE_DB=1 node scratch/repair_interior_construction_calibration.mjs --apply
//
// Safety: --apply refuses without WARDROBE_ALLOW_LIVE_DB=1 (docs/database-safety.md) and takes a
// VACUUM INTO snapshot before the first write.
//
// §12.1 is the step that cannot be skipped: three pieces carry their insulating material inside
// fiber_content, which is the face-fabric field. Leaving it there keeps the semantic contamination
// the field split exists to prevent, and pollutes pieceFiberBreathability. Those values MOVE; they
// are not copied.
import path from 'path'
import fs from 'fs'

const DO_APPLY = process.argv.includes('--apply')
if (DO_APPLY && process.env.WARDROBE_ALLOW_LIVE_DB !== '1' && !process.env.WARDROBE_DB_PATH) {
  console.error('--apply writes to the live database. Re-run with WARDROBE_ALLOW_LIVE_DB=1 (an')
  console.error('acknowledgement, per docs/database-safety.md), or set WARDROBE_DB_PATH to a copy.')
  process.exit(1)
}

const { db, parsePiece } = await import('../db.js')
const { thermalMaterialVerdict } = await import('../styling-engine/attributes.js')
const { pieceWeatherScores } = await import('../styling-engine/thermal.js')

// id → the verified facts. `construction: null` means the owner verified the FILL but not the
// lining; unknown is not unlined, so nothing is written rather than guessed (§3).
// `fiber` present means §12.1 applies: the role-confused material moves out of the face list.
const REPAIRS = {
  996767: { construction: 'unlined',          layer: [] },
  996762: { construction: 'unlined',          layer: [] },
  250:    { construction: 'unlined',          layer: [] },
  207:    { construction: 'full_lining',      layer: [] },
  996759: { construction: 'full_lining',      layer: [] },
  996867: { construction: 'full_lining',      layer: [] },
  996764: { construction: 'full_second_face', layer: [] },
  996868: { construction: null,               layer: ['shearling'], fiber: ['suede'] },
  996866: { construction: null,               layer: ['polyester'] },
  996775: { construction: null,               layer: ['down'],      fiber: ['polyester', 'nylon'] },
  996765: { construction: 'full_lining',      layer: ['down'],      fiber: ['leather'] },
}

const ids = Object.keys(REPAIRS).map(Number)
const rows = db.prepare(
  `SELECT * FROM pieces WHERE id IN (${ids.join(',')}) AND status='active'`
).all().map(parsePiece)
const byId = new Map(rows.map(r => [Number(r.id), r]))

const missing = ids.filter(id => !byId.has(id))
if (missing.length) console.warn(`! not found or not active: ${missing.join(', ')}\n`)

let snapshotTaken = false
function snapshot() {
  if (snapshotTaken) return
  const dir = path.join(process.cwd(), 'backups', 'wardrobe')
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `pre-interior-construction-${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
  db.prepare('VACUUM INTO ?').run(dest)
  console.log(`[snapshot] ${dest}\n`)
  snapshotTaken = true
}

const update = db.prepare(
  'UPDATE pieces SET interior_construction=?, insulating_layer_materials=?, fiber_content=? WHERE id=?'
)

const line = (label, p) => {
  const s = pieceWeatherScores(p)
  return `${label.padEnd(8)} construction=${String(p.interior_construction ?? 'unknown').padEnd(17)}` +
    `layer=${JSON.stringify(p.insulating_layer_materials ?? null).padEnd(15)}` +
    `fiber=${JSON.stringify(p.fiber_content).padEnd(38)}` +
    `verdict=${thermalMaterialVerdict(p).padEnd(15)}cold=${String(s.cold).padStart(5)} heat=${String(s.heat).padStart(6)}`
}

console.log(`# Interior-construction calibration repair — ${DO_APPLY ? 'APPLY' : 'DRY RUN'}\n`)
const summary = []
for (const id of ids) {
  const before = byId.get(id)
  if (!before) continue
  const r = REPAIRS[id]
  const after = {
    ...before,
    interior_construction: r.construction,
    insulating_layer_materials: r.layer,
    fiber_content: r.fiber ?? before.fiber_content,
  }
  console.log(`## ${id} — ${before.name}`)
  console.log('  ' + line('before', before))
  console.log('  ' + line('after', after))
  if (r.fiber) {
    const moved = (before.fiber_content || []).filter(f => !r.fiber.includes(f))
    console.log(`  §12.1 moved out of fiber_content: ${JSON.stringify(moved)} — breathability WILL change, deliberately`)
  }
  console.log('')
  summary.push({ id, before: thermalMaterialVerdict(before), after: thermalMaterialVerdict(after) })

  if (DO_APPLY) {
    snapshot()
    update.run(
      r.construction,
      JSON.stringify(r.layer),
      JSON.stringify(r.fiber ?? before.fiber_content),
      id,
    )
  }
}

console.log('# Verdict transitions')
for (const s of summary) {
  const changed = s.before !== s.after ? '   <-- CHANGED' : ''
  console.log(`  ${String(s.id).padEnd(8)} ${s.before.padEnd(15)} -> ${s.after}${changed}`)
}
console.log(DO_APPLY ? '\nWritten.' : '\nDry run only. Add --apply (with WARDROBE_ALLOW_LIVE_DB=1) to write.')
