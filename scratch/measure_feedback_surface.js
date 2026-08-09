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

h('1. Storage inventory')
table([
  { store: 'stylist_feedback', rows: one('SELECT COUNT(*) n FROM stylist_feedback').n },
  { store: '  of those, archived', rows: one('SELECT COUNT(*) n FROM stylist_feedback WHERE COALESCE(archived,0)=1').n },
  { store: 'saved_boards', rows: one('SELECT COUNT(*) n FROM saved_boards').n },
  { store: '  with feedback_labels', rows: one("SELECT COUNT(*) n FROM saved_boards WHERE COALESCE(json_array_length(json_extract(payload,'$.feedback_labels')),0) > 0").n },
  { store: 'todos (retag-suggestion)', rows: one("SELECT COUNT(*) n FROM todos WHERE type='retag-suggestion'").n },
  { store: 'outfits with notes', rows: one("SELECT COUNT(*) n FROM outfits WHERE notes IS NOT NULL AND notes != ''").n },
], ['store', 'rows'])

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

h('6. Feedback types with no scoring weight (inert in both deterministic scorers)')
console.log('  weights live in feedbackWeight() — styling-engine/rules.js. Cross-check by hand if it moved.')
const WEIGHTED = new Set(['signature','works','good_formula','good_pieces','almost','not_me','too_safe','too_soft',
  'too_generic','too_boho','too_polished','weak_structure','weak_contrast','bad_grounding','wrong_silhouette',
  'catalog_drift','bad_reference','proportion_problem','wrong_proportions','wrong_item_read','bad_occasion','fit_issue'])
table(rows(`SELECT feedback_type, COUNT(*) AS n FROM stylist_feedback WHERE COALESCE(archived,0)=0 GROUP BY 1`)
  .filter(r => !WEIGHTED.has(r.feedback_type)).sort((a, b) => b.n - a.n),
  ['feedback_type', 'n'])

h('7. renderer_calibration rows (target type with no reader)')
table(rows(`SELECT feedback_type, context_type, COUNT(*) AS n FROM stylist_feedback
            WHERE COALESCE(archived,0)=0 AND target_type='renderer_calibration' GROUP BY 1,2 ORDER BY n DESC`),
  ['feedback_type', 'context_type', 'n'])

h('8. saved_boards as a feedback store (favourites are a signal, not just a gallery)')
table([
  { measure: 'boards, unarchived', n: one('SELECT COUNT(*) n FROM saved_boards WHERE COALESCE(archived,0)=0').n },
  { measure: '  favourited', n: one('SELECT COUNT(*) n FROM saved_boards WHERE COALESCE(archived,0)=0 AND COALESCE(favorite,0)=1').n },
  { measure: '  carrying feedback_labels', n: one("SELECT COUNT(*) n FROM saved_boards WHERE COALESCE(archived,0)=0 AND COALESCE(json_array_length(json_extract(payload,'$.feedback_labels')),0) > 0").n },
  { measure: '  scoped to a piece', n: one("SELECT COUNT(*) n FROM saved_boards WHERE COALESCE(archived,0)=0 AND context_type='piece'").n },
], ['measure', 'n'])
console.log('  Read deterministically by getSavedBoardInfluenceForPair (favourite OR piece-scoped),')
console.log('  and into prompts by getSavedBoardMemory / getSavedBoardRendererMemory.')

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
