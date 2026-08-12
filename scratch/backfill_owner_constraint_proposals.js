import path from 'node:path'
import Database from 'better-sqlite3'

const apply = process.argv.includes('--apply')
const dbArgIndex = process.argv.indexOf('--db')
const dbPath = path.resolve(dbArgIndex >= 0 ? process.argv[dbArgIndex + 1] : 'wardrobe.db')

const proposals = [
  {
    note: "I don't wear boots in the summer",
    proposal: {
      version: 1,
      selectorType: 'footwear',
      selectorValues: ['boots'],
      contextDimension: 'season',
      contextValues: ['summer'],
      reason: "Don't suggest boots in summer.",
    },
  },
]

const unsupportedNotes = [
  'Yuna prefers to travel in pants, not dresses, for airplane travel days.',
]

const db = new Database(dbPath, { readonly: !apply })
const resolved = proposals.map(entry => {
  const rows = db.prepare('SELECT id, note, payload, archived FROM stylist_feedback WHERE note = ?').all(entry.note)
  if (rows.length !== 1) throw new Error(`Expected exactly one row for ${JSON.stringify(entry.note)}; found ${rows.length}.`)
  let payload = {}
  try { payload = JSON.parse(rows[0].payload || '{}') || {} } catch { throw new Error(`Source row ${rows[0].id} has invalid JSON payload.`) }
  return { ...entry, id: rows[0].id, payload, archived: Boolean(rows[0].archived) }
})
const unsupported = unsupportedNotes.map(note => {
  const rows = db.prepare('SELECT id, note, payload, archived FROM stylist_feedback WHERE note = ?').all(note)
  if (rows.length !== 1) throw new Error(`Expected exactly one row for ${JSON.stringify(note)}; found ${rows.length}.`)
  let payload = {}
  try { payload = JSON.parse(rows[0].payload || '{}') || {} } catch { throw new Error(`Source row ${rows[0].id} has invalid JSON payload.`) }
  return { id: rows[0].id, note, payload }
})

console.log(`${apply ? 'Applying' : 'Previewing'} owner-constraint proposals in ${dbPath}`)
for (const entry of resolved) {
  console.log(`- feedback #${entry.id}: ${entry.note}${entry.archived ? ' (already converted; no proposal update)' : ''}`)
  console.log(`  ${entry.proposal.selectorType}=${entry.proposal.selectorValues.join(', ')} × ${entry.proposal.contextDimension}=${entry.proposal.contextValues.join(', ')}`)
}
for (const entry of unsupported) console.log(`- feedback #${entry.id}: remove unsupported firm-rule proposal; keep as ordinary guidance`)

if (!apply) {
  console.log('No rows changed. Re-run with --apply after reviewing this preview.')
  process.exit(0)
}

db.transaction(() => {
  const update = db.prepare('UPDATE stylist_feedback SET payload = ? WHERE id = ? AND archived = 0')
  let updates = 0
  for (const entry of resolved) {
    if (entry.archived) continue
    const payload = { ...entry.payload, ownerConstraintProposal: entry.proposal }
    const result = update.run(JSON.stringify(payload), entry.id)
    if (result.changes !== 1) throw new Error(`Failed to update feedback #${entry.id}.`)
    updates += result.changes
  }
  for (const entry of unsupported) {
    const payload = { ...entry.payload }
    delete payload.ownerConstraintProposal
    const result = update.run(JSON.stringify(payload), entry.id)
    if (result.changes !== 1) throw new Error(`Failed to update feedback #${entry.id}.`)
    updates += result.changes
  }
  console.log(`Updated ${updates} feedback rows.`)
})()
