#!/usr/bin/env node
// Regenerates every measurement in docs/feedback-and-memory-map.md.
//
//   node scratch/measure_feedback_surface.js            # default ./wardrobe.db
//   node scratch/measure_feedback_surface.js <db-path>  # any other wardrobe db
//
// Opens the database READ-ONLY and runs no migrations, so it is safe against a
// live file and cannot be the thing that changed your data. Every table in the
// map is printed here under the same heading, so a reviewer can diff the doc
// against reality without reading any application code.
import Database from 'better-sqlite3'
import path from 'path'

const dbPath = process.argv[2] || path.join(process.cwd(), 'wardrobe.db')
const db = new Database(dbPath, { readonly: true, fileMustExist: true })

const h = (title) => console.log(`\n## ${title}\n`)
const rows = (sql, ...args) => db.prepare(sql).all(...args)
const one = (sql, ...args) => db.prepare(sql).get(...args)
const table = (data, cols) => {
  if (!data.length) return console.log('  (none)')
  const w = cols.map(c => Math.max(c.length, ...data.map(r => String(r[c] ?? '').length)))
  console.log('  ' + cols.map((c, i) => c.padEnd(w[i])).join('  '))
  console.log('  ' + w.map(n => '-'.repeat(n)).join('  '))
  for (const r of data) console.log('  ' + cols.map((c, i) => String(r[c] ?? '').padEnd(w[i])).join('  '))
}

console.log(`# Feedback surface measurements`)
console.log(`db: ${dbPath}`)
console.log(`generated: run date not embedded on purpose — cite the date you ran it`)

h('1. Storage inventory — every store that holds user input, by category')
const inv = (category, store, sql) => ({ category, store, rows: one(sql).n })
table([
  inv('1 garment truth', 'pieces (active)', "SELECT COUNT(*) n FROM pieces WHERE status='active'"),
  inv('1 garment truth', '  favourited pieces', "SELECT COUNT(*) n FROM pieces WHERE status='active' AND COALESCE(favorite,0)=1"),
  inv('2 saved outfits', 'outfits', 'SELECT COUNT(*) n FROM outfits'),
  inv('2 saved outfits', '  confirmed', "SELECT COUNT(*) n FROM outfits WHERE status='confirmed'"),
  inv('2 saved outfits', '  favourited', 'SELECT COUNT(*) n FROM outfits WHERE COALESCE(favorite,0)=1'),
  inv('2 saved outfits', '  with notes', "SELECT COUNT(*) n FROM outfits WHERE notes IS NOT NULL AND notes != ''"),
  inv('2 saved outfits', 'outfit_pieces links', 'SELECT COUNT(*) n FROM outfit_pieces'),
  inv('3 boards', 'saved_boards (unarchived)', 'SELECT COUNT(*) n FROM saved_boards WHERE COALESCE(archived,0)=0'),
  inv('3 boards', '  favourited ("Use strongly")', 'SELECT COUNT(*) n FROM saved_boards WHERE COALESCE(archived,0)=0 AND COALESCE(favorite,0)=1'),
  inv('3 boards', '  with feedback_labels', "SELECT COUNT(*) n FROM saved_boards WHERE COALESCE(archived,0)=0 AND COALESCE(json_array_length(json_extract(payload,'$.feedback_labels')),0) > 0"),
  inv('4 calibration', 'calibration_images (unarchived)', 'SELECT COUNT(*) n FROM calibration_images WHERE COALESCE(archived,0)=0'),
  inv('4 calibration', '  favourited', 'SELECT COUNT(*) n FROM calibration_images WHERE COALESCE(archived,0)=0 AND COALESCE(favorite,0)=1'),
  inv('4 calibration', '  with labels', "SELECT COUNT(*) n FROM calibration_images WHERE COALESCE(archived,0)=0 AND labels NOT IN ('','[]')"),
  inv('4 calibration', '  with notes', "SELECT COUNT(*) n FROM calibration_images WHERE COALESCE(archived,0)=0 AND notes IS NOT NULL AND notes != ''"),
  inv('5/6 feedback', 'stylist_feedback', 'SELECT COUNT(*) n FROM stylist_feedback'),
  inv('5/6 feedback', '  archived', 'SELECT COUNT(*) n FROM stylist_feedback WHERE COALESCE(archived,0)=1'),
  inv('7 thread state', 'chat_threads', 'SELECT COUNT(*) n FROM chat_threads'),
  inv('7 thread state', 'stylist_conversation_state', 'SELECT COUNT(*) n FROM stylist_conversation_state'),
  inv('8 recency', 'whole_wardrobe_sessions', 'SELECT COUNT(*) n FROM whole_wardrobe_sessions'),
  inv('9 tasks', 'todos (retag-suggestion)', "SELECT COUNT(*) n FROM todos WHERE type='retag-suggestion'"),
  inv('9 tasks', 'todos (metadata)', "SELECT COUNT(*) n FROM todos WHERE type='metadata'"),
  inv('10 constitution', 'style_constitution layers', 'SELECT COUNT(*) n FROM style_constitution'),
  inv('10 constitution', 'app_meta keys', 'SELECT COUNT(*) n FROM app_meta'),
  inv('11 visual evidence', 'pieces with hanger photo', "SELECT COUNT(*) n FROM pieces WHERE status='active' AND photo IS NOT NULL AND photo != ''"),
  inv('11 visual evidence', 'pieces with worn photo', "SELECT COUNT(*) n FROM pieces WHERE status='active' AND worn_photo IS NOT NULL AND worn_photo != ''"),
  inv('11 visual evidence', '  pieces with NEITHER (excluded)', "SELECT COUNT(*) n FROM pieces WHERE status='active' AND COALESCE(photo,'')='' AND COALESCE(worn_photo,'')=''"),
  inv('11 visual evidence', 'outfits with photo', "SELECT COUNT(*) n FROM outfits WHERE photo IS NOT NULL AND photo != ''"),
  inv('12 intake/provenance', 'import_sessions', 'SELECT COUNT(*) n FROM import_sessions'),
  inv('12 intake/provenance', 'import_garments', 'SELECT COUNT(*) n FROM import_garments'),
  inv('12 intake/provenance', 'piece_import_evidence', 'SELECT COUNT(*) n FROM piece_import_evidence'),
  inv('12 intake/provenance', 'constitution_history', 'SELECT COUNT(*) n FROM constitution_history'),
], ['category', 'store', 'rows'])

h('1b. Style constitution layers (the largest preference store)')
table(rows('SELECT layer, length(body) AS chars, updated_at FROM style_constitution ORDER BY layer'),
  ['layer', 'chars', 'updated_at'])
console.log('  Loaded by loadConstitution (promptRuntime.js:32) and interpolated into system prompts.')

h('2. Per-garment memory fields (active pieces)')
const active = one("SELECT COUNT(*) n FROM pieces WHERE status='active'").n
table([
  ['notes', "notes IS NOT NULL AND notes != ''"],
  ['styling_rules_learned', "styling_rules_learned NOT IN ('','[]')"],
  ['pairs_well_with', "pairs_well_with NOT IN ('','[]')"],
  ['tried_and_rejected', "tried_and_rejected NOT IN ('','[]')"],
  ['occasion_exclusions', "occasion_exclusions NOT IN ('','[]')"],
  ['engine_notes', "engine_notes IS NOT NULL AND engine_notes != ''"],
].map(([field, cond]) => ({
  field,
  pieces: one(`SELECT COUNT(*) n FROM pieces WHERE status='active' AND ${cond}`).n,
  of: active,
})), ['field', 'pieces', 'of'])

h('3. stylist_feedback by type and target (unarchived)')
table(rows(`SELECT feedback_type, target_type, COUNT(*) AS n FROM stylist_feedback
            WHERE COALESCE(archived,0)=0 GROUP BY 1,2 ORDER BY n DESC`),
  ['feedback_type', 'target_type', 'n'])

h('4. Standing prose rules — what getOwnerRuleNotes(8) would return')
console.log("  selector: feedback_type='owner_rule' OR (feedback_type='preference_reaction' AND target_type='message')")
table(rows(`SELECT id, feedback_type, target_type, substr(note,1,58) AS note FROM stylist_feedback
            WHERE COALESCE(archived,0)=0
              AND (feedback_type='owner_rule' OR (feedback_type='preference_reaction' AND target_type='message'))
            ORDER BY id DESC LIMIT 12`),
  ['id', 'feedback_type', 'target_type', 'note'])
console.log(`  eligible total: ${one(`SELECT COUNT(*) n FROM stylist_feedback WHERE COALESCE(archived,0)=0 AND (feedback_type='owner_rule' OR (feedback_type='preference_reaction' AND target_type='message'))`).n}  (delivery cap is 8)`)
console.log(`  NOT eligible  : ${one("SELECT COUNT(*) n FROM stylist_feedback WHERE COALESCE(archived,0)=0 AND NOT (feedback_type='owner_rule' OR (feedback_type='preference_reaction' AND target_type='message'))").n}`)

h('5. styling_rules_learned entries by origin')
table(rows(`WITH r AS (SELECT p.id, j.value AS rule FROM pieces p, json_each(p.styling_rules_learned) j WHERE p.status='active')
  SELECT CASE
    WHEN rule LIKE '[feedback:%' THEN 'reaction blurb ([feedback:*])'
    WHEN rule LIKE 'Excluded from %' OR rule LIKE 'Restored for %' THEN 'occasion-exclusion note'
    WHEN length(rule) > 200 THEN 'saved chat message (long)'
    ELSE 'short rule (owner-shaped)' END AS origin,
  COUNT(*) AS n FROM r GROUP BY 1 ORDER BY n DESC`),
  ['origin', 'n'])

h('6. Active feedback types (routing authority lives in lib/feedbackTaxonomy.js)')
console.log('  There is no generic feedback-weight table or generic deterministic scorer.')
console.log('  Only canonical garment_context_suitability evidence can affect ranking, at -6 per exact context match capped at -12.')
table(rows(`SELECT feedback_type, target_type, COUNT(*) AS n FROM stylist_feedback
            WHERE COALESCE(archived,0)=0 GROUP BY 1,2 ORDER BY n DESC`),
  ['feedback_type', 'target_type', 'n'])

h('7. renderer_calibration rows (target type with no reader)')
table(rows(`SELECT feedback_type, context_type, COUNT(*) AS n FROM stylist_feedback
            WHERE COALESCE(archived,0)=0 AND target_type='renderer_calibration' GROUP BY 1,2 ORDER BY n DESC`),
  ['feedback_type', 'context_type', 'n'])

h('8. saved_boards as a feedback and display store')
table([
  { measure: 'boards, unarchived', n: one('SELECT COUNT(*) n FROM saved_boards WHERE COALESCE(archived,0)=0').n },
  { measure: '  favourited', n: one('SELECT COUNT(*) n FROM saved_boards WHERE COALESCE(archived,0)=0 AND COALESCE(favorite,0)=1').n },
  { measure: '  carrying feedback_labels', n: one("SELECT COUNT(*) n FROM saved_boards WHERE COALESCE(archived,0)=0 AND COALESCE(json_array_length(json_extract(payload,'$.feedback_labels')),0) > 0").n },
  { measure: '  scoped to a piece', n: one("SELECT COUNT(*) n FROM saved_boards WHERE COALESCE(archived,0)=0 AND context_type='piece'").n },
], ['measure', 'n'])
console.log('  Read into prompts by getSavedBoardMemory / getSavedBoardRendererMemory.')
console.log('  Board reactions do not mechanically promote their literal garment pairs.')

h('9. Field confidence provenance (why "low" is not always a tagger judgment)')
console.log('  Note the signature is "zero medium", not "zero medium or high" — a few pre-v2 highs exist.')
for (const field of ['fit_on_body', 'length_hits_at', 'silhouette', 'hem_finish']) {
  console.log(`\n  ${field}:`)
  table(rows(`SELECT CASE WHEN tagger_version LIKE 'v2%' THEN 'v2 (photo-authority)'
                          WHEN tagger_version LIKE 'v1%' THEN 'v1' ELSE '(unversioned)' END AS era,
      SUM(CASE WHEN json_extract(style_profile_json,'$._confidence.${field}')='low' THEN 1 ELSE 0 END) AS low,
      SUM(CASE WHEN json_extract(style_profile_json,'$._confidence.${field}')='medium' THEN 1 ELSE 0 END) AS med,
      SUM(CASE WHEN json_extract(style_profile_json,'$._confidence.${field}')='high' THEN 1 ELSE 0 END) AS high,
      SUM(CASE WHEN json_extract(style_profile_json,'$._confidence.${field}')='manual' THEN 1 ELSE 0 END) AS manual,
      COUNT(*) AS pieces
    FROM pieces WHERE status='active' GROUP BY 1 ORDER BY pieces DESC`),
    ['era', 'low', 'med', 'high', 'manual', 'pieces'])
}

console.log('\n(end)')
