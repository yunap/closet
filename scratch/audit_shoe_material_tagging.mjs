#!/usr/bin/env node
// Is the shoes `fabric_category` tag trustworthy enough for the weather gates to read?
//
//   node scratch/audit_shoe_material_tagging.mjs [db-path]
//
// Two independent signals, both wardrobe-agnostic:
//   1. NAME/TAG CONTRADICTION — the piece name states a material the tag disagrees with. The name is
//      owner- or tagger-authored prose and is NOT authority (that is the whole point of structured
//      tags), so a contradiction is not proof the tag is wrong — it is a reliability signal worth
//      counting.
//   2. GATE EFFECT — how many shoes each weather gate excludes, so the cost of a rule is visible
//      rather than assumed. Reported as information: supply is a per-user fact and must never
//      calibrate a rule that ships to everyone.
//
// Read-only.
import path from 'path'
const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const Database = (await import('better-sqlite3')).default
const { pieceHasWetSensitiveFootwearMaterial, pieceHasVentilatedFootwearMaterial } = await import(ROOT + '/styling-engine/attributes.js')

const dbPath = process.argv[2] || path.join(ROOT, 'wardrobe.db')
const db = new Database(dbPath, { readonly: true, fileMustExist: true })
const shoes = db.prepare("SELECT * FROM pieces WHERE status='active' AND lower(category)='shoes'").all()
  .map(r => ({ ...r, fiber_content: JSON.parse(r.fiber_content || '[]') }))

// Material words that, when they appear in a name, imply a fabric_category. Only unambiguous ones.
const NAME_IMPLIES = {
  knit: ['knit', 'mesh'], mesh: ['mesh', 'knit'], leather: ['leather', 'patent', 'nubuck'],
  suede: ['suede', 'nubuck'], canvas: ['canvas'], patent: ['patent'], rubber: ['rubber'],
  velvet: ['textile'], satin: ['textile'], straw: ['woven'], raffia: ['woven'], tweed: ['textile'],
}

console.log(`# Shoe material tagging audit\ndb: ${dbPath}\nactive shoes: ${shoes.length}\n`)

const contradictions = []
let untagged = 0
for (const s of shoes) {
  const fab = String(s.fabric_category || '').toLowerCase().trim()
  if (!fab) { untagged += 1; continue }
  const name = String(s.name || '').toLowerCase()
  for (const [word, allowed] of Object.entries(NAME_IMPLIES)) {
    if (!new RegExp(`\\b${word}\\b`).test(name)) continue
    if (!allowed.includes(fab)) contradictions.push({ id: s.id, name: s.name, word, fab, allowed: allowed.join('/') })
  }
}
console.log(`## 1. Name/tag contradictions: ${contradictions.length} of ${shoes.length}` + (untagged ? `  (${untagged} untagged)` : ''))
for (const c of contradictions) {
  console.log(`  ${String(c.id).padEnd(7)}${String(c.name).slice(0, 38).padEnd(40)}name says "${c.word}" → expected ${c.allowed}, tagged '${c.fab}'`)
}

const wet = shoes.filter(pieceHasWetSensitiveFootwearMaterial)
const vent = shoes.filter(pieceHasVentilatedFootwearMaterial)
const openToe = shoes.filter(s => s.toe_shape === 'open_toe' || s.shoe_type === 'sandal')
const coldOut = new Set([...vent, ...openToe])
console.log(`\n## 2. Gate effect (information, never a reason to narrow a physics rule)`)
console.log(`  excluded on WET exposure:  ${wet.length} / ${shoes.length}   remaining ${shoes.length - wet.length}`)
console.log(`  excluded on SEVERE cold:   ${coldOut.size} / ${shoes.length}   remaining ${shoes.length - coldOut.size}`)
const both = shoes.filter(s => !wet.includes(s) && !coldOut.has(s))
console.log(`  remaining on a COLD WET day: ${both.length}` + (both.length ? '' : '  ← wardrobe gap, disclosure path'))
for (const s of both) console.log(`     ${String(s.id).padEnd(7)}${String(s.name).slice(0, 36).padEnd(38)}fab=${String(s.fabric_category || '-').padEnd(10)}support=${s.walk_support || '-'}`)
