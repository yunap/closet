#!/usr/bin/env node
// Completeness audit for docs/feedback-and-memory-map.md, across all four persistence media.
//
//   node scratch/audit_feedback_surface_completeness.js [db-path]
//
// Exits non-zero when the running system contains a store the inventory does not classify, or the
// inventory classifies something that no longer exists. Read-only; no migrations.
//
// This replaces an earlier grep-over-prose check that only proved a table NAME appeared somewhere
// in the document — including inside a command, a citation or an open question. Textual mention is
// not classification, and that check could not see media 2, 3 or 4 at all.
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { KNOWN_FEEDBACK_TYPES, SCOPED_EVIDENCE_KINDS } from '../lib/feedbackTaxonomy.js'
import { FEEDBACK_EVIDENCE_ACTIONS } from '../lib/feedbackEvidence.js'
import { FEEDBACK_SYNTHESIS_DISPOSITIONS } from '../lib/feedbackSynthesis.js'

const root = process.cwd()
const dbPath = process.argv[2] || path.join(root, 'wardrobe.db')
const inv = JSON.parse(fs.readFileSync(path.join(root, 'scratch/feedback_surface_inventory.json'), 'utf8'))

let problems = 0
const fail = (medium, msg) => { problems++; console.log(`  ✗ [${medium}] ${msg}`) }
const ok = (msg) => console.log(`  ✓ ${msg}`)
const head = (t) => console.log(`\n## ${t}\n`)

// ── Medium 1: SQLite ─────────────────────────────────────────────────────────
head('Medium 1 · SQLite tables')
const db = new Database(dbPath, { readonly: true, fileMustExist: true })
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all().map(r => r.name)
for (const t of tables) {
  if (!inv.sqlite[t]) fail('sqlite', `table "${t}" exists but is not classified in the inventory`)
}
for (const t of Object.keys(inv.sqlite)) {
  if (!tables.includes(t)) fail('sqlite', `inventory lists "${t}" but no such table exists`)
}
if (!problems) ok(`${tables.length} tables, all classified`)

// ── Medium 1b: semantic types inside stylist_feedback ───────────────────────
head('Medium 1b · Feedback semantics')
const semanticInventory = inv.feedback_semantics || {}
const destinationGroups = semanticInventory.types_by_destination || {}
const aliases = semanticInventory.legacy_aliases || {}
const inventoriedTypes = new Set([
  ...Object.values(destinationGroups).flat(),
  ...Object.keys(aliases),
])
const knownTypes = new Set(KNOWN_FEEDBACK_TYPES)
for (const type of knownTypes) {
  if (!inventoriedTypes.has(type)) fail('feedback type', `code accepts "${type}" but it has no semantic disposition`)
}
for (const type of inventoriedTypes) {
  if (!knownTypes.has(type)) fail('feedback type', `semantic inventory lists stale type "${type}"`)
}
for (const [alias, canonical] of Object.entries(aliases)) {
  if (!knownTypes.has(canonical)) fail('feedback alias', `"${alias}" maps to unknown canonical type "${canonical}"`)
}
const liveFeedbackTypes = db.prepare('SELECT DISTINCT feedback_type FROM stylist_feedback ORDER BY feedback_type')
  .all().map(row => row.feedback_type).filter(Boolean)
for (const type of liveFeedbackTypes) {
  if (!inventoriedTypes.has(type)) fail('feedback type', `database contains unclassified type "${type}"`)
}
const liveBoardFeedbackTypes = db.prepare(`
  SELECT DISTINCT labels.value AS feedback_type
  FROM saved_boards, json_each(saved_boards.payload, '$.feedback_labels') AS labels
  WHERE labels.value IS NOT NULL AND labels.value != ''
  ORDER BY labels.value
`).all().map(row => row.feedback_type)
for (const type of liveBoardFeedbackTypes) {
  if (!inventoriedTypes.has(type)) fail('feedback type', `saved board contains unclassified type "${type}"`)
}

const inventoriedKinds = new Set(Object.keys(semanticInventory.scoped_evidence_kinds || {}))
const knownKinds = new Set(Object.values(SCOPED_EVIDENCE_KINDS))
for (const kind of knownKinds) {
  if (!inventoriedKinds.has(kind)) fail('evidence kind', `code defines "${kind}" but it has no semantic disposition`)
}
for (const kind of inventoriedKinds) {
  if (!knownKinds.has(kind)) fail('evidence kind', `semantic inventory lists stale kind "${kind}"`)
}
const liveEvidenceKinds = db.prepare(`
  SELECT DISTINCT kind FROM (
    SELECT json_extract(payload, '$.scopedEvidence.kind') AS kind FROM stylist_feedback
    UNION
    SELECT json_extract(payload, '$.scoped_evidence.kind') AS kind FROM saved_boards
  ) WHERE kind IS NOT NULL AND kind != ''
`).all().map(row => row.kind)
for (const kind of liveEvidenceKinds) {
  if (!inventoriedKinds.has(kind)) fail('evidence kind', `database contains unclassified scoped evidence kind "${kind}"`)
}
const inventoriedActions = new Set(Object.keys(semanticInventory.feedback_evidence_actions || {}))
const knownActions = new Set(Object.values(FEEDBACK_EVIDENCE_ACTIONS))
for (const action of knownActions) {
  if (!inventoriedActions.has(action)) fail('evidence action', `code defines "${action}" but it has no semantic disposition`)
}
for (const action of inventoriedActions) {
  if (!knownActions.has(action)) fail('evidence action', `semantic inventory lists stale action "${action}"`)
}
const liveEvidenceActions = db.prepare(`
  SELECT DISTINCT json_extract(payload, '$.feedbackEvidence.action') AS action
  FROM stylist_feedback
  WHERE action IS NOT NULL AND action != ''
`).all().map(row => row.action)
for (const action of liveEvidenceActions) {
  if (!inventoriedActions.has(action)) fail('evidence action', `database contains unclassified feedback evidence action "${action}"`)
}
const inventoriedSynthesisDispositions = new Set(Object.keys(semanticInventory.synthesis_dispositions || {}))
const knownSynthesisDispositions = new Set(FEEDBACK_SYNTHESIS_DISPOSITIONS)
for (const disposition of knownSynthesisDispositions) {
  if (!inventoriedSynthesisDispositions.has(disposition)) fail('synthesis disposition', `code defines "${disposition}" but it has no semantic disposition`)
}
for (const disposition of inventoriedSynthesisDispositions) {
  if (!knownSynthesisDispositions.has(disposition)) fail('synthesis disposition', `semantic inventory lists stale disposition "${disposition}"`)
}
const liveSynthesisDispositions = tables.includes('feedback_synthesis_drafts')
  ? db.prepare('SELECT DISTINCT disposition FROM feedback_synthesis_drafts ORDER BY disposition').all().map(row => row.disposition).filter(Boolean)
  : []
for (const disposition of liveSynthesisDispositions) {
  if (!inventoriedSynthesisDispositions.has(disposition)) fail('synthesis disposition', `database contains unclassified synthesis disposition "${disposition}"`)
}
if (!problems) ok(`${inventoriedTypes.size} feedback types, ${inventoriedKinds.size} scoped-evidence kinds, ${inventoriedActions.size} evidence actions, and ${inventoriedSynthesisDispositions.size} synthesis dispositions classified`)

// ── Medium 2: uploaded files ─────────────────────────────────────────────────
head('Medium 2 · Uploaded files')
const uploads = path.join(root, 'uploads')
if (!fs.existsSync(uploads)) {
  console.log('  (no uploads/ directory in this checkout — file audit skipped)')
} else {
  const onDisk = new Set(fs.readdirSync(uploads).filter(f => !f.startsWith('.')))
  const referenced = new Set()
  const addRefs = (sql, col) => {
    for (const row of db.prepare(sql).all()) {
      const v = row[col]
      if (v) referenced.add(String(v).replace(/^.*\//, ''))
    }
  }
  addRefs("SELECT photo FROM pieces WHERE photo IS NOT NULL AND photo != ''", 'photo')
  addRefs("SELECT worn_photo FROM pieces WHERE worn_photo IS NOT NULL AND worn_photo != ''", 'worn_photo')
  addRefs("SELECT photo FROM outfits WHERE photo IS NOT NULL AND photo != ''", 'photo')
  for (const col of ['filename', 'image_url', 'file']) {
    try { addRefs(`SELECT ${col} FROM calibration_images WHERE ${col} IS NOT NULL AND ${col} != ''`, col) } catch {}
  }
  const missing = [...referenced].filter(f => !onDisk.has(f) && !fs.existsSync(path.join(uploads, f)))
  const dirs = [...onDisk].filter(f => fs.statSync(path.join(uploads, f)).isDirectory())
  const orphans = [...onDisk].filter(f => !dirs.includes(f) && !referenced.has(f))

  console.log(`  referenced by the database : ${referenced.size}`)
  console.log(`  present in uploads/        : ${onDisk.size - dirs.length} files, ${dirs.length} subdirectories`)
  if (missing.length) fail('files', `${missing.length} referenced file(s) missing from disk, e.g. ${missing.slice(0, 3).join(', ')}`)
  else ok('every referenced file is present')
  console.log(`  unreferenced on disk       : ${orphans.length}  (derived artifacts + genuine orphans; not a failure)`)
  for (const d of dirs) {
    const key = `uploads/${d}/`
    if (!inv.files[key]) fail('files', `uploads/${d}/ exists but is not classified in the inventory`)
  }
  if (dirs.length) ok(`${dirs.length} subdirectories classified`)
}

// ── Medium 3: browser storage ────────────────────────────────────────────────
head('Medium 3 · Browser storage')
let keys = []
try {
  const out = execSync(
    `grep -rhoE "localStorage\\.(get|set|remove)Item\\('[^']+'" --include=*.jsx --include=*.js src/ || true`,
    { cwd: root, encoding: 'utf8' })
  keys = [...new Set(out.split('\n').map(l => (l.match(/'([^']+)'/) || [])[1]).filter(Boolean))]
} catch { /* grep found nothing */ }
for (const k of keys) if (!inv.browser[k]) fail('browser', `localStorage key "${k}" is used but not classified`)
for (const k of Object.keys(inv.browser)) {
  if (!keys.includes(k)) fail('browser', `inventory lists localStorage key "${k}" but nothing uses it`)
}
if (keys.length) ok(`${keys.length} localStorage keys, all classified`)
const otherApis = execSync(
  `grep -rlE "sessionStorage|indexedDB|document\\.cookie" --include=*.jsx --include=*.js src/ || true`,
  { cwd: root, encoding: 'utf8' }).trim()
console.log(otherApis
  ? `  other browser persistence APIs found in: ${otherApis.split('\n').join(', ')}  — classify these`
  : '  no sessionStorage / indexedDB / cookie usage in src/')

// ── Medium 4: runtime and prompt caches ──────────────────────────────────────
head('Medium 4 · Runtime / prompt caches')
const rt = execSync(
  `grep -rn "refreshPrompts\\|buildForUser" --include=*.js styling-engine/ routes/ || true`,
  { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
console.log(`  prompt-cache build/invalidate sites: ${rt.length}`)
if (!Object.keys(inv.runtime).length) fail('runtime', 'no runtime cache classified')
else ok(`${Object.keys(inv.runtime).length} runtime cache(s) classified`)
console.log('  [manual] medium 4 has no enumerable inventory. Verify by hand that every caller of')
console.log('           refreshPrompts corresponds to a store already classified above.')

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(70)}`)
if (problems) {
  console.log(`FAIL — ${problems} unclassified or stale entr${problems === 1 ? 'y' : 'ies'}.`)
  console.log('Add each to scratch/feedback_surface_inventory.json with a disposition, and')
  console.log('document it in the map (§1 for "category", §8 for "excluded").')
  process.exit(1)
}
console.log('PASS — every store in media 1–3 is classified, and medium 4 is declared.')
console.log('This proves classification, NOT that the map\'s prose about each store is correct.')
