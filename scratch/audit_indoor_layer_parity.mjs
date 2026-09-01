#!/usr/bin/env node
// [A6] parity probe for Slice F of docs/outerwear-weather-consolidation-spec.md.
//
//   node scratch/audit_indoor_layer_parity.mjs
//
// Question: can a role-based "stays on indoors" test replace the winter-capsule rule's
// garmentKind==='cardigan' && medium/heavy proxy? [A6] forbids deleting that rule until the shared
// contract demonstrably subsumes BOTH of its meanings, so this measures the substitution over the
// real wardrobe instead of assuming it.
//
// Answer as of 2026-08-31: NO. See the spec's Appendix F. Kept as a re-runnable verifier so the
// conclusion can be rechecked after any future tagging pass.
//
// Read-only, no writes, no model calls.
const ROOT = '/Users/yuna/Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist'
const Database = (await import('better-sqlite3')).default
const { garmentKind, fabricWeight, pieceOuterwearRole, pieceHasInsulatingMaterial } = await import(ROOT + '/styling-engine/attributes.js')
const { pieceWeatherScores } = await import(ROOT + '/styling-engine/thermal.js')
const db = new Database(ROOT + '/wardrobe.db', { readonly: true, fileMustExist: true })
const parse = r => ({ ...r, colors: [], occasions: [],
  fiber_content: JSON.parse(r.fiber_content || '[]'),
  weather_protection: JSON.parse(r.weather_protection || '[]') })
const outer = db.prepare("SELECT * FROM pieces WHERE status='active' AND lower(category)='outerwear' ORDER BY id").all().map(parse)

const OLD = p => garmentKind(p) === 'cardigan' && ['medium','heavy'].includes(fabricWeight(p))
const INDOOR_WEARABLE_ROLES = new Set(['indoor_layer','transition_layer'])
const NEW = p => INDOOR_WEARABLE_ROLES.has(pieceOuterwearRole(p)) && pieceWeatherScores(p).cold >= 6

const rows = outer.map(p => ({
  id: p.id, name: String(p.name).slice(0,38), kind: garmentKind(p) || '-', w: fabricWeight(p) || '-',
  role: pieceOuterwearRole(p) || '-', cold: pieceWeatherScores(p).cold, old: OLD(p), neu: NEW(p),
}))
const diverge = rows.filter(r => r.old !== r.neu)
console.log(`outerwear: ${rows.length}   OLD qualifies: ${rows.filter(r=>r.old).length}   NEW qualifies: ${rows.filter(r=>r.neu).length}   DIVERGE: ${diverge.length}\n`)
const show = (t, rs) => { console.log(t); for (const r of rs) console.log(`  ${String(r.id).padEnd(7)}${r.name.padEnd(40)}kind=${r.kind.padEnd(10)}w=${r.w.padEnd(7)}role=${r.role.padEnd(23)}cold=${String(r.cold).padStart(3)}  old=${r.old?'Y':'n'} new=${r.neu?'Y':'n'}`) }
show('BOTH qualify:', rows.filter(r=>r.old&&r.neu))
show('\nDIVERGENT — old yes, new no:', diverge.filter(r=>r.old))
show('\nDIVERGENT — new yes, old no:', diverge.filter(r=>!r.old))


// --- job 2: isCapsuleColdTransitionLayer — can outerwear_role replace coat/jacket+heavy? ---------
const OLD2 = p => ['coat','jacket'].includes(garmentKind(p)) &&
  (fabricWeight(p) === 'heavy' || pieceHasInsulatingMaterial(p))
const NEW2 = p => pieceOuterwearRole(p) === 'cold_weather_outerwear'
const rows2 = outer.map(p => ({
  id: p.id, name: String(p.name).slice(0,38), kind: garmentKind(p) || '-', w: fabricWeight(p) || '-',
  role: pieceOuterwearRole(p) || '-', old: OLD2(p), neu: NEW2(p),
}))
const d2 = rows2.filter(r => r.old !== r.neu)
console.log(`\n\n=== job 2: cold transition layer ===`)
console.log(`OLD qualifies: ${rows2.filter(r=>r.old).length}   NEW qualifies: ${rows2.filter(r=>r.neu).length}   DIVERGE: ${d2.length}\n`)
show('DIVERGENT:', d2)
