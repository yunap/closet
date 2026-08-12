// Removes wrong-length corrections that name a field the garment cannot have — a necklace with
// "sleeves rendered too long", loafers with a sleeve issue. They predate the 2026-07-27 fix that
// filters wrong-length reasons by piece.category, and getSavedBoardRendererMemory still renders
// them into the image prompt verbatim.
//
//   node scratch/clean_impossible_length_reports.js            # preview, changes nothing
//   node scratch/clean_impossible_length_reports.js --apply    # write
//   node scratch/clean_impossible_length_reports.js --db path/to.db
//
// Two payload shapes carry these, and getSavedBoardRendererMemory reads both:
//   saved_boards.payload.feedback_details.wrong_length  — an array; the bad entries are filtered out
//   stylist_feedback.payload.length_correction          — a single object; the ROW is archived
// instead, because stylist_feedback archives rather than deletes everywhere else and the reader
// already skips archived rows. Editing its payload would leave a wrong_length report with no
// correction, which makes the reader fall back to a vague "match the saved reference lengths" line.
//
// Validity is decided by the app's own rule, wrongLengthReasonsForCategory — not by a pattern
// invented here — so this cleanup and the capture UI can never disagree about what is possible.
// A piece with an unknown or missing category keeps everything: that function deliberately returns
// the full list there rather than silently hiding a real correction.
import path from 'node:path'
import Database from 'better-sqlite3'
import { wrongLengthReasonsForCategory } from '../lib/feedbackTaxonomy.js'

const apply = process.argv.includes('--apply')
const dbArg = process.argv.indexOf('--db')
const dbPath = path.resolve(dbArg >= 0 ? process.argv[dbArg + 1] : 'wardrobe.db')

const db = new Database(dbPath, { readonly: !apply })
const categoryById = new Map(db.prepare('SELECT id, category FROM pieces').all().map(r => [Number(r.id), r.category]))
const allowedFor = category => new Set(wrongLengthReasonsForCategory(category).map(([issue]) => issue))

const boards = db.prepare(`
  SELECT id, payload FROM saved_boards
  WHERE json_extract(payload, '$.feedback_details.wrong_length') IS NOT NULL
`).all()

const planned = []
for (const board of boards) {
  let payload
  try { payload = JSON.parse(board.payload || '{}') } catch { continue }
  const corrections = payload?.feedback_details?.wrong_length
  if (!Array.isArray(corrections) || !corrections.length) continue

  const kept = []
  const dropped = []
  for (const correction of corrections) {
    const category = categoryById.get(Number(correction?.piece_id))
    const allowed = allowedFor(category)
    // Unknown category => wrongLengthReasonsForCategory returns the full list, so nothing is lost.
    if (allowed.has(correction?.issue)) kept.push(correction)
    else dropped.push({ ...correction, category: category || '(unknown)' })
  }
  if (!dropped.length) continue

  const next = { ...payload, feedback_details: { ...payload.feedback_details, wrong_length: kept } }
  planned.push({ boardId: board.id, kept, dropped, nextPayload: JSON.stringify(next) })
}

// Second shape: one correction per stylist_feedback row.
const feedbackRows = db.prepare(`
  SELECT id, archived, payload FROM stylist_feedback
  WHERE json_extract(payload, '$.length_correction') IS NOT NULL
`).all()
const plannedRows = []
for (const row of feedbackRows) {
  let payload
  try { payload = JSON.parse(row.payload || '{}') } catch { continue }
  const correction = payload?.length_correction
  if (!correction?.issue) continue
  const category = categoryById.get(Number(correction.piece_id))
  if (allowedFor(category).has(correction.issue)) continue
  plannedRows.push({
    id: row.id,
    archived: Boolean(row.archived),
    piece: correction.piece_name || `piece ${correction.piece_id}`,
    category: category || '(unknown)',
    issue: correction.issue,
  })
}

console.log(`${apply ? 'Applying' : 'Previewing'} impossible-length cleanup in ${dbPath}\n`)
let total = 0
for (const entry of planned) {
  console.log(`board ${entry.boardId}: dropping ${entry.dropped.length}, keeping ${entry.kept.length}`)
  for (const d of entry.dropped) {
    console.log(`    - ${d.piece_name || `piece ${d.piece_id}`} [${d.category}] : ${d.issue}`)
    total += 1
  }
}
if (plannedRows.length) {
  console.log(`\nstylist_feedback rows to archive (${plannedRows.length}):`)
  for (const r of plannedRows) {
    console.log(`    - #${r.id}${r.archived ? ' (already archived)' : ' [LIVE — reaching the model]'} ${r.piece} [${r.category}] : ${r.issue}`)
  }
}
if (!planned.length && !plannedRows.length) console.log('Nothing to clean — every recorded length issue is valid for its garment.')
else console.log(`\n${total} impossible board corrections across ${planned.length} board(s); ${plannedRows.length} feedback row(s) to archive.`)

if (!apply) {
  console.log('\nNo rows changed. Re-run with --apply after reviewing this preview.')
  process.exit(0)
}

db.transaction(() => {
  const update = db.prepare('UPDATE saved_boards SET payload = ? WHERE id = ?')
  for (const entry of planned) {
    const result = update.run(entry.nextPayload, entry.boardId)
    if (result.changes !== 1) throw new Error(`Failed to update board ${entry.boardId}`)
  }
  const archive = db.prepare('UPDATE stylist_feedback SET archived = 1 WHERE id = ?')
  for (const row of plannedRows) archive.run(row.id)
})()
console.log(`\nUpdated ${planned.length} board(s); archived ${plannedRows.length} feedback row(s).`)
