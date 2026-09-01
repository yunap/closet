#!/usr/bin/env node
// What does the engine actually know about one garment, and what does it conclude?
//
//   node scratch/show_piece.mjs 996775
//   node scratch/show_piece.mjs "puffer"          # name substring, case-insensitive
//   node scratch/show_piece.mjs 996775 <db-path>
//
// Prints the stored facts, then every derived weather verdict that reads them, so a tag and its
// consequences can be compared side by side. Read-only: opens the database with readonly:true and
// writes nothing.
import path from 'path'
const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const Database = (await import('better-sqlite3')).default
const A = await import(ROOT + '/styling-engine/attributes.js')
const T = await import(ROOT + '/styling-engine/thermal.js')
const { evaluateOuterwearCapability } = await import(ROOT + '/styling-engine/outerwearCapability.js')

const arg = process.argv[2]
if (!arg) { console.error('usage: node scratch/show_piece.mjs <id|name-substring> [db-path]'); process.exit(1) }
const db = new Database(process.argv[3] || path.join(ROOT, 'wardrobe.db'), { readonly: true, fileMustExist: true })

const rows = /^\d+$/.test(arg)
  ? db.prepare('SELECT * FROM pieces WHERE id = ?').all(Number(arg))
  : db.prepare("SELECT * FROM pieces WHERE status='active' AND lower(name) LIKE ?").all(`%${arg.toLowerCase()}%`)
if (!rows.length) { console.error(`no piece matched ${JSON.stringify(arg)}`); process.exit(1) }
if (rows.length > 1) console.log(`${rows.length} matches\n`)

const parse = r => ({ ...r,
  fiber_content: JSON.parse(r.fiber_content || '[]'),
  weather_protection: JSON.parse(r.weather_protection || '[]'),
  colors: JSON.parse(r.colors || '[]'), occasions: JSON.parse(r.occasions || '[]'),
  occasion_exclusions: [] })

// The candidate scale from docs/garment-warmth-calibration.md §2. Kept in sync by hand — this is a
// findings-stage proposal, not shipped code, so it has no module to import from yet.
const NONCOMMITTAL = new Set(['synthetic', 'other', 'technical/performance', ''])
const SUBSTANCE = { light: 0, medium: 1, heavy: 2 }
const warmthLevel = (p) => {
  const fab = String(p.fabric_category || '').toLowerCase().trim()
  const sub = SUBSTANCE[p.fabric_weight] ?? null
  if (sub === null) return 'UNKNOWN (no fabric_weight)'
  const fibres = (p.fiber_content || []).map(f => String(f).toLowerCase())
  const unresolved = fibres.length === 0 || (fibres.length === 1 && fibres[0] === 'unknown')
  const insul = A.pieceHasInsulatingMaterial(p)
  if (!insul && sub >= 1 && NONCOMMITTAL.has(fab) && unresolved) return 'UNKNOWN (substantial, fill/fibre unresolved)'
  return ['very light', 'light', 'moderate', 'warm', 'very warm'][Math.min(4, sub + (insul ? 2 : 0))]
}

const line = (k, v) => console.log(`  ${String(k).padEnd(26)}${v}`)
for (const raw of rows) {
  const p = parse(raw)
  console.log(`\n#${p.id}  ${p.name}\n${'='.repeat(72)}`)
  console.log('STORED FACTS')
  for (const k of ['category', 'fabric_category', 'fabric_weight', 'visual_weight', 'season', 'formality',
                   'sleeve_length', 'length_hits_at', 'neckline', 'opacity', 'shoe_type', 'toe_shape',
                   'walk_support', 'outerwear_role', 'tag_state', 'tag_provider', 'tag_model']) {
    if (p[k] !== null && p[k] !== undefined && p[k] !== '') line(k, p[k])
  }
  line('fiber_content', JSON.stringify(p.fiber_content))
  line('weather_protection', JSON.stringify(p.weather_protection))
  line('manual_overrides', p.manual_overrides || '[]')
  line('photo', p.photo ? 'yes' : 'NO')

  console.log('\nDERIVED — what the engine concludes')
  const scores = T.pieceWeatherScores(p)
  line('thermal evidence', scores.evidence ? 'present' : 'null  ← nothing known about warmth')
  line('cold / heat score', `${scores.cold} / ${scores.heat}`)
  line('insulating material', A.pieceHasInsulatingMaterial(p))
  line('warmth level (proposed)', warmthLevel(p))
  if (A.wardrobeCategoryGroup(p) === 'outerwear') {
    line('outerwear role', A.pieceOuterwearRole(p) ?? 'null (unknown)')
    line('weather protection', JSON.stringify(A.pieceWeatherProtection(p)))
    line('as outdoor layer', evaluateOuterwearCapability(p, { requireOutdoorLayer: true }).verdict)
  }
  if (A.wardrobeCategoryGroup(p) === 'shoes') {
    line('absorbent upper', A.pieceHasWetSensitiveFootwearMaterial(p))
    line('ventilated upper', A.pieceHasVentilatedFootwearMaterial(p))
  }
}
