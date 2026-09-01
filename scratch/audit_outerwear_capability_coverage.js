#!/usr/bin/env node
// Slice A.1 of docs/outerwear-weather-consolidation-spec.md — the mandatory
// real-wardrobe capability audit that must run BEFORE outerwear_role /
// weather_protection are wired into any runtime decision.
//
//   node scratch/audit_outerwear_capability_coverage.js            # default ./wardrobe.db
//   node scratch/audit_outerwear_capability_coverage.js <db-path>
//
// Opens the database READ-ONLY and runs no migrations, so it is safe against a
// live file (docs/database-safety.md) and cannot be the thing that changed your
// data. It deliberately does NOT import db.js: parsePiece would normalize
// weather_protection on the way out, and this audit needs to see the stored
// bytes, including any pre-normalization stray values.
//
// The purpose is not coverage for its own sake. It is the spec's stop
// condition: are POPULATED capability facts reliable enough to consume?
import Database from 'better-sqlite3'
import path from 'path'

const dbPath = process.argv[2] || path.join(process.cwd(), 'wardrobe.db')
const db = new Database(dbPath, { readonly: true, fileMustExist: true })

const ROLES = ['indoor_layer', 'transition_layer', 'protective_shell', 'cold_weather_outerwear']
const HAZARDS = ['rain', 'wind']

const h = (t) => console.log(`\n## ${t}\n`)
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a')
const table = (data, cols) => {
  if (!data.length) return console.log('  (none)')
  const w = cols.map(c => Math.max(c.length, ...data.map(r => String(r[c] ?? '').length)))
  console.log('  ' + cols.map((c, i) => c.padEnd(w[i])).join('  '))
  console.log('  ' + w.map(n => '-'.repeat(n)).join('  '))
  for (const r of data) console.log('  ' + cols.map((c, i) => String(r[c] ?? '').padEnd(w[i])).join('  '))
}

// weather_protection is stored as a JSON array string; read it defensively the
// same way pieceWeatherProtection() does, but report what is actually stored.
const parseProtection = (raw) => {
  if (raw == null || raw === '') return { list: [], stray: [], malformed: false }
  let v
  try { v = JSON.parse(raw) } catch { return { list: [], stray: [], malformed: true } }
  if (!Array.isArray(v)) return { list: [], stray: [], malformed: true }
  const list = v.filter(x => HAZARDS.includes(x))
  const stray = v.filter(x => !HAZARDS.includes(x))
  return { list, stray, malformed: false }
}

console.log('# Outerwear capability audit — Slice A.1')
console.log(`db: ${dbPath} (read-only)`)
console.log('spec: docs/outerwear-weather-consolidation-spec.md §15 Slice A.1')

const pieces = db.prepare(
  "SELECT id, name, category, outerwear_role, weather_protection, fabric_weight, fiber_content, photo" +
  " FROM pieces WHERE status='active'"
).all()

const outerwear = pieces.filter(p => String(p.category || '').toLowerCase() === 'outerwear')
const total = outerwear.length

h('1. Population — active outerwear')
console.log(`  active pieces (all categories): ${pieces.length}`)
console.log(`  active outerwear pieces:        ${total}`)

h('2. outerwear_role coverage')
const roleCounts = new Map(ROLES.map(r => [r, 0]))
let roleUnset = 0
const roleStray = []
for (const p of outerwear) {
  const v = p.outerwear_role
  if (v == null || v === '') { roleUnset += 1; continue }
  if (roleCounts.has(v)) roleCounts.set(v, roleCounts.get(v) + 1)
  else roleStray.push({ id: p.id, name: p.name, stored: v })
}
const rolePopulated = total - roleUnset - roleStray.length
console.log(`  populated (recognized): ${rolePopulated} / ${total}  (${pct(rolePopulated, total)})`)
console.log(`  null / unset:           ${roleUnset} / ${total}  (${pct(roleUnset, total)})`)
console.log(`  stored-but-unrecognized:${roleStray.length}`)
console.log('')
table(ROLES.map(r => ({ role: r, count: roleCounts.get(r), share: pct(roleCounts.get(r), total) })),
  ['role', 'count', 'share'])
if (roleStray.length) { console.log('\n  unrecognized stored values (read as unknown by pieceOuterwearRole):'); table(roleStray, ['id', 'name', 'stored']) }

h('3. weather_protection coverage')
let protNonEmpty = 0, protEmpty = 0, protMalformed = 0
const hazardCounts = { rain: 0, wind: 0, both: 0 }
const protStray = []
for (const p of outerwear) {
  const { list, stray, malformed } = parseProtection(p.weather_protection)
  if (malformed) protMalformed += 1
  if (stray.length) protStray.push({ id: p.id, name: p.name, stored: p.weather_protection })
  if (list.length) {
    protNonEmpty += 1
    if (list.includes('rain')) hazardCounts.rain += 1
    if (list.includes('wind')) hazardCounts.wind += 1
    if (list.includes('rain') && list.includes('wind')) hazardCounts.both += 1
  } else protEmpty += 1
}
console.log(`  non-empty: ${protNonEmpty} / ${total}  (${pct(protNonEmpty, total)})`)
console.log(`  empty:     ${protEmpty} / ${total}  (${pct(protEmpty, total)})  — a legitimate answer, not a gap`)
console.log(`  malformed/non-array stored: ${protMalformed}`)
console.log('')
table([
  { hazard: 'rain (any)', count: hazardCounts.rain },
  { hazard: 'wind (any)', count: hazardCounts.wind },
  { hazard: 'rain + wind', count: hazardCounts.both },
], ['hazard', 'count'])
if (protStray.length) { console.log('\n  stored arrays containing unrecognized members:'); table(protStray, ['id', 'name', 'stored']) }

h('4. Representative examples per populated value — for manual image review')
for (const r of ROLES) {
  const ex = outerwear.filter(p => p.outerwear_role === r).slice(0, 8)
  console.log(`  ${r} (${roleCounts.get(r)}):`)
  if (!ex.length) { console.log('    (none)'); continue }
  table(ex.map(p => ({ id: p.id, name: p.name, fabric_weight: p.fabric_weight, weather_protection: p.weather_protection, image: p.photo ? "yes" : "NO" })),
    ['id', 'name', 'fabric_weight', 'weather_protection', 'image'])
}
for (const hz of HAZARDS) {
  const ex = outerwear.filter(p => parseProtection(p.weather_protection).list.includes(hz)).slice(0, 8)
  console.log(`\n  weather_protection includes ${hz} (${hazardCounts[hz]}):`)
  if (!ex.length) { console.log('    (none)'); continue }
  table(ex.map(p => ({ id: p.id, name: p.name, outerwear_role: p.outerwear_role, stored: p.weather_protection })),
    ['id', 'name', 'outerwear_role', 'stored'])
}

h('5. Cross-field sanity flags — candidates for the manual sample')
// These are NOT rules. They are the combinations the spec's orthogonality
// fixtures say must be possible, so a population with ZERO of one of them is a
// hint the tagger collapsed two axes; and the combinations that are suspicious
// enough to be worth eyeballing against the photo.
const heavyIndoor = outerwear.filter(p => p.outerwear_role === 'indoor_layer' && p.fabric_weight === 'heavy')
const lightCold = outerwear.filter(p => p.outerwear_role === 'cold_weather_outerwear' && p.fabric_weight === 'light')
const shellNoHazard = outerwear.filter(p => p.outerwear_role === 'protective_shell' && !parseProtection(p.weather_protection).list.length)
const hazardNoShell = outerwear.filter(p => parseProtection(p.weather_protection).list.length && p.outerwear_role && p.outerwear_role !== 'protective_shell')
const coldWithHazard = outerwear.filter(p => p.outerwear_role === 'cold_weather_outerwear' && parseProtection(p.weather_protection).list.length)
table([
  { combination: 'indoor_layer + heavy (orthogonality: must be possible)', count: heavyIndoor.length },
  { combination: 'cold_weather_outerwear + light (suspicious, review)', count: lightCold.length },
  { combination: 'protective_shell + no hazard (allowed, but review)', count: shellNoHazard.length },
  { combination: 'hazard on a non-shell role (allowed, must be possible)', count: hazardNoShell.length },
  { combination: 'cold_weather_outerwear + hazard (allowed)', count: coldWithHazard.length },
], ['combination', 'count'])
for (const [label, set] of [['indoor_layer + heavy', heavyIndoor], ['cold_weather_outerwear + light', lightCold], ['hazard on non-shell role', hazardNoShell]]) {
  if (!set.length) continue
  console.log(`\n  ${label}:`)
  table(set.slice(0, 10).map(p => ({ id: p.id, name: p.name, role: p.outerwear_role, fabric_weight: p.fabric_weight, protection: p.weather_protection })),
    ['id', 'name', 'role', 'fabric_weight', 'protection'])
}

h('6. Stop-condition summary')
console.log(`  populated role coverage:       ${pct(rolePopulated, total)}  (${rolePopulated}/${total})`)
console.log(`  non-empty protection coverage: ${pct(protNonEmpty, total)}  (${protNonEmpty}/${total})`)
console.log(`  data integrity problems:       ${roleStray.length + protStray.length + protMalformed}`)
console.log('')
console.log('  Coverage alone does NOT decide the stop condition. The spec requires a manual')
console.log('  review of the §4 samples against the garment images before any runtime wiring.')
console.log('  Stop if populated values are systematically misclassified. Missing values stay')
console.log('  unknown/no-op and must never become exclusions.')
