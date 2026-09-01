#!/usr/bin/env node
// Slice A.1 remediation for docs/outerwear-weather-consolidation-spec.md — owner-authorized
// 2026-08-31 (Appendix B, ruling [O1]).
//
// Fills ONLY the two later-added capability fields, outerwear_role and weather_protection, on
// active outerwear pieces that predate them. It is NOT a retag: every other field the tagger
// returns is read and discarded. Manual overrides on either field are never touched.
//
//   node scratch/backfill_outerwear_capability.js                 # dry run, no model calls
//   node scratch/backfill_outerwear_capability.js --tag           # dry run + real model calls, no writes
//   WARDROBE_ALLOW_LIVE_DB=1 node scratch/backfill_outerwear_capability.js --tag --apply
//
// Routing: Gemini (owner instruction 2026-08-31), via the sanctioned providerOverride argument —
// the same per-call path the comparison-run scripts use. gemini-3.1-flash-lite is
// TAGGER_MODEL_OVERRIDE's own default and the tier docs/tagger-cost-spec.md §6d benchmarked
// strongest on cost and failure rate. Override with --model.
//
// Safety: --apply refuses to run without WARDROBE_ALLOW_LIVE_DB=1 (docs/database-safety.md), takes
// a VACUUM INTO snapshot before the first write, writes each piece in its own statement touching
// exactly two columns, and stops at a cost ceiling.
import path from 'path'
import fs from 'fs'

const args = process.argv.slice(2)
const DO_TAG = args.includes('--tag')
const DO_APPLY = args.includes('--apply')
const MODEL = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'gemini-3.1-flash-lite'
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity
const ONLY_ID = args.includes('--id') ? Number(args[args.indexOf('--id') + 1]) : null

// Gemini flash-lite tagging measured well under a cent per piece; this ceiling is a runaway
// backstop, not a budget estimate.
const COST_PER_PIECE_ESTIMATE = 0.004
const MAX_COST_LIMIT = 0.75
let cumulativeCost = 0

if (DO_APPLY && process.env.WARDROBE_ALLOW_LIVE_DB !== '1' && !process.env.WARDROBE_DB_PATH) {
  console.error('--apply writes to the live database. Re-run with WARDROBE_ALLOW_LIVE_DB=1 (an')
  console.error('acknowledgement, per docs/database-safety.md), or set WARDROBE_DB_PATH to a copy.')
  process.exit(1)
}
if (DO_APPLY && !DO_TAG) {
  console.error('--apply requires --tag: there is nothing to write without model results.')
  process.exit(1)
}

const { db, userUploadsDir, parsePiece } = await import('../db.js')
const { tagPieceWithProvider } = await import('../routes/ai.js')
const { normalizeManualOverrides, normalizeOuterwearRole, normalizeWeatherProtection } =
  await import('../styling-engine/taggerMerge.js')

const FIELDS = ['outerwear_role', 'weather_protection']

// The population is defined by the field that has a real unset state. weather_protection defaults
// to '[]', so an empty array cannot distinguish "the model saw it and found no hazard" from "the
// model was never asked" — outerwear_role IS NULL is the honest predicate for "predates the field".
const targets = db.prepare(
  "SELECT * FROM pieces WHERE status='active' AND lower(category)='outerwear'" +
  " AND (outerwear_role IS NULL OR outerwear_role='') ORDER BY id"
).all().map(parsePiece).filter(p => (ONLY_ID ? Number(p.id) === ONLY_ID : true)).slice(0, LIMIT)

console.log('# Outerwear capability backfill')
console.log(`mode:    ${DO_APPLY ? 'APPLY (writes)' : DO_TAG ? 'TAG ONLY (no writes)' : 'DRY RUN (no model calls)'}`)
console.log(`routing: gemini / ${MODEL}`)
console.log(`targets: ${targets.length} active outerwear pieces with no outerwear_role`)
console.log(`fields:  ${FIELDS.join(', ')} — every other tagger field is discarded\n`)

if (!DO_TAG) {
  for (const p of targets) {
    const manual = normalizeManualOverrides(p.manual_overrides).filter(f => FIELDS.includes(f))
    console.log(`  ${String(p.id).padEnd(7)} ${String(p.name).slice(0, 44).padEnd(46)}` +
      `${[p.photo && 'hanger', p.worn_photo && 'worn'].filter(Boolean).join('+') || 'NO PHOTO'}` +
      `${manual.length ? `  manual:${manual.join(',')}` : ''}`)
  }
  console.log('\nDry run only. Add --tag to make model calls, --tag --apply to write.')
  process.exit(0)
}

let snapshotTaken = false
function snapshotOnce() {
  if (snapshotTaken || !DO_APPLY) return
  const dir = path.join(process.cwd(), 'backups', 'wardrobe')
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `pre-outerwear-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
  db.prepare('VACUUM INTO ?').run(dest)
  console.log(`[snapshot] ${dest}\n`)
  snapshotTaken = true
}

const update = db.prepare('UPDATE pieces SET outerwear_role = ?, weather_protection = ? WHERE id = ?')
const results = []

for (const piece of targets) {
  if (cumulativeCost >= MAX_COST_LIMIT) {
    console.log(`\n[stop] cost ceiling $${MAX_COST_LIMIT} reached; ${targets.length - results.length} pieces left untouched.`)
    break
  }
  const photos = []
  for (const [field, label, guidance] of [
    ['photo', 'HANGER PHOTO', 'Use for literal garment truth: category, color, construction, pattern, fabric, and shape.'],
    ['worn_photo', 'WORN PHOTO', 'Use for fit, drape, scale, real-wear behavior, outfit role, and risks. Do not override literal garment color/category from this styling context.'],
  ]) {
    if (!piece[field]) continue
    const abs = path.join(userUploadsDir(), piece[field])
    if (fs.existsSync(abs)) photos.push({ path: abs, label, guidance })
  }
  if (!photos.length) {
    console.log(`  ${piece.id} "${piece.name}" — no photo on disk, skipped`)
    results.push({ id: piece.id, name: piece.name, status: 'skipped: no photo' })
    continue
  }

  const manual = normalizeManualOverrides(piece.manual_overrides)
  try {
    const tags = await tagPieceWithProvider(photos, piece, {
      providerOverride: { provider: 'gemini', model: MODEL },
    })
    cumulativeCost += COST_PER_PIECE_ESTIMATE

    // Field isolation: read only the two fields, normalize them through the canonical normalizers,
    // and preserve a manual value if the owner already set one.
    const role = manual.includes('outerwear_role')
      ? piece.outerwear_role ?? null
      : normalizeOuterwearRole(tags.outerwear_role)
    const protection = manual.includes('weather_protection')
      ? (Array.isArray(piece.weather_protection) ? piece.weather_protection : [])
      : normalizeWeatherProtection(tags.weather_protection)

    const confidence = tags._confidence || {}
    console.log(`  ${String(piece.id).padEnd(7)} ${String(piece.name).slice(0, 40).padEnd(42)}` +
      `role=${String(role ?? 'null').padEnd(23)} protection=${JSON.stringify(protection).padEnd(16)}` +
      ` conf=${confidence.outerwear_role || '-'}/${confidence.weather_protection || '-'}` +
      `${manual.length ? '  [manual preserved]' : ''}`)

    if (DO_APPLY) {
      snapshotOnce()
      update.run(role, JSON.stringify(protection), piece.id)
    }
    results.push({ id: piece.id, name: piece.name, role, protection, status: DO_APPLY ? 'written' : 'proposed' })
  } catch (err) {
    console.log(`  ${piece.id} "${piece.name}" — FAILED: ${err.message}`)
    results.push({ id: piece.id, name: piece.name, status: `failed: ${err.message}` })
  }
}

const byRole = {}
for (const r of results) if (r.role !== undefined) byRole[r.role ?? 'null'] = (byRole[r.role ?? 'null'] || 0) + 1
console.log(`\n## Summary (${DO_APPLY ? 'written' : 'proposed, not written'})`)
console.log(`  pieces processed: ${results.length}`)
console.log(`  failures/skips:   ${results.filter(r => r.status.startsWith('failed') || r.status.startsWith('skipped')).length}`)
console.log(`  estimated spend:  $${cumulativeCost.toFixed(3)}`)
for (const [role, n] of Object.entries(byRole).sort()) console.log(`    ${role.padEnd(24)} ${n}`)
console.log(`\nNext: re-run scratch/audit_outerwear_capability_coverage.js, then manually review the`)
console.log(`decisive coats (996775 puffer, 996765 leather, 996760 fleece, 996759 trench, 996763 raincoat).`)
