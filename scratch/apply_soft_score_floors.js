import { db, parsePiece } from '../db.js'
import { applySoftScoreFloors } from '../styling-engine/softScoreFloors.js'

const dryRun = process.argv.includes('--dry-run')
const onlyIdIndex = process.argv.indexOf('--id')
const onlyId = onlyIdIndex >= 0 ? Number(process.argv[onlyIdIndex + 1]) : null

const rows = onlyId
  ? db.prepare('SELECT * FROM pieces WHERE id = ?').all(onlyId)
  : db.prepare('SELECT * FROM pieces').all()

const updates = []
for (const row of rows) {
  const piece = parsePiece(row)
  const adjusted = applySoftScoreFloors(piece)
  const before = JSON.stringify(piece.style_profile_json || {})
  const after = JSON.stringify(adjusted.style_profile_json || {})
  if (before !== after) {
    updates.push({ id: piece.id, name: piece.name, before, after, rules: adjusted.style_profile_json?._soft_score_adjustments?.rules || [] })
  }
}

if (!updates.length) {
  console.log('No soft-score floor updates needed.')
  process.exit(0)
}

console.log(`${dryRun ? 'Would update' : 'Updating'} ${updates.length} piece(s):`)
for (const update of updates) {
  console.log(`- ${update.id}: ${update.name}`)
  update.rules.forEach(rule => {
    console.log(`  ${rule.rule}: ${rule.path} ${rule.before} -> ${rule.after}`)
  })
}

if (!dryRun) {
  const stmt = db.prepare('UPDATE pieces SET style_profile_json = ? WHERE id = ?')
  db.transaction(() => {
    updates.forEach(update => stmt.run(update.after, update.id))
  })()
}
