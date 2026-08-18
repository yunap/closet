// Research for the tagger-prompt spec. Read-only, no model call.
//
// Answers, against the real prompt and the real wardrobe:
//   - token/character attribution per prompt section
//   - which instructed fields never reach a piece column (dead instruction)
//   - which persisted columns get no instruction (unguided field)
//   - whether tagger output looks truncated on the pieces the current prompt tagged
//
//   node scratch/research_tagger_prompt.js

import { db, parsePiece } from '../db.js'
import { prompts } from '../styling-engine/promptRuntime.js'
import { TAG_PIECE_SYSTEM } from '../styling-engine/prompts.js'
import { pieceStyleProfile } from '../styling-engine/rules.js'

const pieces = db.prepare("SELECT * FROM pieces WHERE status='active'").all().map(parsePiece)
const prompt = prompts.TAG_PIECE_PROMPT || ''

// ── 1. section attribution ──────────────────────────────────────────────────
console.log('--- prompt section attribution ---')
const marks = [...prompt.matchAll(/^=== (.+) ===$/gm)].map(m => ({ title: m[1], idx: m.index }))
const bounds = marks.map((m, i) => ({ ...m, end: i + 1 < marks.length ? marks[i + 1].idx : prompt.length }))
const preamble = marks.length ? marks[0].idx : prompt.length
console.log(`  ${String(preamble).padStart(6)} chars  ~${String(Math.round(preamble / 4)).padStart(5)} tok  (preamble)`)
for (const b of bounds) {
  const len = b.end - b.idx
  console.log(`  ${String(len).padStart(6)} chars  ~${String(Math.round(len / 4)).padStart(5)} tok  ${b.title}`)
}
console.log(`  ${String(TAG_PIECE_SYSTEM.length).padStart(6)} chars  ~${String(Math.round(TAG_PIECE_SYSTEM.length / 4)).padStart(5)} tok  [system prompt]`)
console.log(`  ${String(prompt.length).padStart(6)} chars  ~${String(Math.round(prompt.length / 4)).padStart(5)} tok  TOTAL user prompt`)

// ── 2/3. instructed fields vs persisted columns ─────────────────────────────
const columns = new Set(db.prepare('PRAGMA table_info(pieces)').all().map(r => r.name))
// fields the prompt names with a "- Field:" or `"field":` shape
const instructed = new Set()
for (const m of prompt.matchAll(/"([a-z_]{3,30})"\s*:/g)) instructed.add(m[1])
for (const m of prompt.matchAll(/^-\s+([A-Z][A-Za-z ]{2,28}):/gm)) instructed.add(m[1].toLowerCase().replace(/ /g, '_'))

const TAGGABLE = new Set(['name','category','colors','occasions','season','notes','pattern_type','pattern_scale',
  'pattern_complexity','reads_as','hem_finish','neckline','sleeve_type','length_hits_at','silhouette',
  'fabric_category','fabric_weight','stretch','fit_on_body','tuck_behavior','waistband_type','background_color',
  'style_profile_json','fiber_content','formality','heel_height','walk_support','opacity','tagger_version'])

const instructedNotPersisted = [...instructed].filter(f => !columns.has(f)).sort()
const persistedNotInstructed = [...TAGGABLE].filter(f => !instructed.has(f) && f !== 'tagger_version').sort()
console.log('\n--- instructed but NOT a pieces column (goes into style_profile_json, or is dropped) ---')
console.log('  ' + (instructedNotPersisted.join(', ') || '(none)'))
console.log('\n--- taggable column with NO explicit instruction in the prompt ---')
console.log('  ' + (persistedNotInstructed.join(', ') || '(none)'))

// ── 4. truncation evidence on pieces the current prompt tagged ───────────────
console.log('\n--- output completeness on v2-tagged pieces (truncation check) ---')
const v2 = pieces.filter(p => String(p.tagger_version || '').startsWith('v2'))
const REQUIRED = ['style_lanes', 'garment_intelligence', '_confidence', 'photo_properties']
const missingCounts = new Map()
for (const p of v2) {
  const prof = pieceStyleProfile(p)
  for (const key of REQUIRED) if (!prof || prof[key] === undefined) missingCounts.set(key, (missingCounts.get(key) || 0) + 1)
}
console.log(`  ${v2.length} pieces tagged by the current prompt`)
for (const key of REQUIRED) console.log(`    ${String(missingCounts.get(key) || 0).padStart(3)} missing ${key}`)
console.log('  (a truncated response loses the LAST keys emitted; consistent losses point at the cap)')

// ── 5. the recoverable error-profile sample ─────────────────────────────────
// import_clusters.tags_json is the ONLY surviving raw tagger output; the merge discards the
// model's value for any overridden field, so 202 formality corrections cannot tell us what the
// tagger originally said.
import { safeJsonParse } from '../db.js'
console.log('\n--- recoverable comparison set (raw tagger output vs final piece) ---')
const linked = db.prepare("SELECT * FROM import_clusters WHERE tags_json IS NOT NULL AND result_piece_id IS NOT NULL").all()
const unlinked = db.prepare("SELECT * FROM import_clusters WHERE tags_json IS NOT NULL AND result_piece_id IS NULL").all()
console.log(`  ${linked.length} clusters linked to a piece  (solid pairs)`)
console.log(`  ${unlinked.length} clusters unlinked          (recoverable only by name match, needs review)`)

const FIELDS = ['formality', 'fabric_weight', 'length_hits_at', 'sleeve_type', 'silhouette', 'fit_on_body', 'pattern_type']
const disagreements = new Map()
let agree = 0, total = 0
for (const c of linked) {
  const t = safeJsonParse(c.tags_json, {}) || {}
  const p = db.prepare('SELECT * FROM pieces WHERE id = ?').get(c.result_piece_id)
  if (!p) continue
  for (const f of FIELDS) {
    if (t[f] == null || p[f] == null) continue
    total++
    if (String(t[f]) === String(p[f])) { agree++; continue }
    const key = `${f}: ${t[f]} -> ${p[f]}`
    disagreements.set(key, (disagreements.get(key) || 0) + 1)
  }
}
console.log(`\n  ${total} field comparisons, ${agree} agree, ${total - agree} disagree`)
console.log('  disagreement patterns (tagger value -> final value):')
for (const [k, n] of [...disagreements].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(2)}x  ${k}`)
console.log('\n  n is far too small to spec on — but it shows the METHOD works, and that a dry run of')
console.log('  scratch/backfill_retagger.js (which already computes this diff and prints it) would')
console.log('  produce the real error profile if the diff were written to a file instead of stdout.')

// ── 6. Q4 — consumer count per field: instructed AND persisted, but is it ever READ? ─────────────
// Sections 2/3 above answer "instructed vs persisted" — the missing hop is persisted -> actually
// consumed by a downstream function. A field can be perfectly tagged and populated and still be
// dead weight if nothing in styling-engine/ ever reads it. Grep-based, so it is a lower bound
// (a field read only through a dynamic property access or a destructured rename would be missed)
// — reported as such, not as a final verdict.
import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

// Exclude the tagger's own machinery and CRUD/UI plumbing — a field being READ there just means
// "it can be saved and displayed," which is true of every column by construction. The question is
// whether a STYLING decision (gate, score, prompt splice) ever reads it.
const EXCLUDE_FILES = ['taggerMerge.js', 'prompts.js', 'promptRuntime.js']
const CONSUMER_FIELDS = [...TAGGABLE].filter(f => f !== 'style_profile_json' && f !== 'tagger_version')

console.log('\n--- Q4: consumer count per tagged field across styling-engine/ (excludes tagger/prompt plumbing) ---')
console.log('  (grep-based lower bound — a field read via dynamic property access would be missed)\n')
const results = []
for (const field of CONSUMER_FIELDS) {
  let count = 0
  try {
    const out = execSync(
      `grep -rln '\\.${field}\\b' ${path.join(root, 'styling-engine')} 2>/dev/null | grep -vE '(${EXCLUDE_FILES.join('|')})$' || true`,
      { encoding: 'utf8' }
    )
    count = out.split('\n').filter(Boolean).length
  } catch { count = 0 }
  results.push([field, count])
}
results.sort((a, b) => a[1] - b[1])
for (const [field, count] of results) {
  const flag = count === 0 ? '  [ZERO CONSUMER FILES — populated and instructed, never read downstream]' : ''
  console.log(`  ${String(count).padStart(2)} files  ${field}${flag}`)
}
console.log('\n  Zero-consumer fields are candidates for the same class of finding as fiber_content\'s')
console.log('  latent hot-weather gap (docs/engine-behaviour-map.md) — worth checking whether each one')
console.log('  is read through a text-blob concatenation (which this grep DOES catch, since blob')
console.log('  builders reference the field by name to build the string) or is genuinely unread.')
