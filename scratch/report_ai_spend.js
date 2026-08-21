// Report durable provider-call spend from every per-user ai_call_log.
//
// Read-only: each wardrobe DB is copied with its WAL/SHM files to a temp directory before opening,
// matching scratch/measure_freeform_turns.js and docs/database-safety.md.
//
//   node scratch/report_ai_spend.js
//   node scratch/report_ai_spend.js --since '2026-08-20 00:00' --until '2026-08-21 00:00'
//   node scratch/report_ai_spend.js --flow outfit_feedback
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'

const args = process.argv.slice(2)
const argOf = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] }
const since = argOf('--since') || new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const until = argOf('--until') || null
const flow = argOf('--flow') || null

function candidateDatabases() {
  if (process.env.WARDROBE_DB_PATH) {
    const explicit = path.resolve(process.env.WARDROBE_DB_PATH)
    return fs.existsSync(explicit) ? [explicit] : []
  }

  const found = []
  const rootDb = path.join(process.cwd(), 'wardrobe.db')
  if (fs.existsSync(rootDb)) found.push(rootDb)

  const usersRoot = path.resolve(process.env.WARDROBE_USERS_DIR || path.join(process.cwd(), 'data', 'users'))
  if (fs.existsSync(usersRoot)) {
    for (const entry of fs.readdirSync(usersRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const userDb = path.join(usersRoot, entry.name, 'wardrobe.db')
      if (fs.existsSync(userDb)) found.push(userDb)
    }
  }

  return [...new Set(found.map(file => path.resolve(file)))]
}

function snapshotDatabase(live, snapshotRoot, index) {
  const dir = path.join(snapshotRoot, String(index))
  fs.mkdirSync(dir, { recursive: true })
  const copy = path.join(dir, 'wardrobe.db')
  fs.copyFileSync(live, copy)
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(live + suffix)) fs.copyFileSync(live + suffix, copy + suffix)
  }
  return copy
}

const databases = candidateDatabases()
if (!databases.length) {
  console.error('No wardrobe database found (checked WARDROBE_DB_PATH, ./wardrobe.db, and data/users/*/wardrobe.db).')
  process.exit(1)
}

const where = ['created_at >= ?', 'is_mock = 0']
const params = [since]
if (until) { where.push('created_at < ?'); params.push(until) }
if (flow) { where.push('flow = ?'); params.push(flow) }

const snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-spend-'))
const grouped = new Map()
let databasesWithTelemetry = 0

for (const [index, live] of databases.entries()) {
  const copy = snapshotDatabase(live, snapshotRoot, index)
  const db = new Database(copy, { readonly: true })
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_call_log'").get()
    if (!table) continue
    databasesWithTelemetry++
    const rows = db.prepare(`
      SELECT flow, endpoint, provider, model, is_image,
             COUNT(*) AS calls,
             SUM(input_tokens) AS input_tokens,
             SUM(output_tokens) AS output_tokens,
             SUM(cache_read_input_tokens) AS cache_read_tokens,
             SUM(cache_creation_input_tokens) AS cache_creation_tokens,
             SUM(estimated_cost_usd) AS estimated_cost_usd,
             SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures
      FROM ai_call_log
      WHERE ${where.join(' AND ')}
      GROUP BY flow, endpoint, provider, model, is_image
    `).all(...params)

    for (const row of rows) {
      const key = [row.flow, row.endpoint, row.provider, row.model, row.is_image].join('\u0000')
      const existing = grouped.get(key) || {
        ...row,
        calls: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        estimated_cost_usd: 0,
        failures: 0,
      }
      existing.calls += Number(row.calls || 0)
      existing.input_tokens += Number(row.input_tokens || 0)
      existing.output_tokens += Number(row.output_tokens || 0)
      existing.cache_read_tokens += Number(row.cache_read_tokens || 0)
      existing.cache_creation_tokens += Number(row.cache_creation_tokens || 0)
      existing.estimated_cost_usd += Number(row.estimated_cost_usd || 0)
      existing.failures += Number(row.failures || 0)
      grouped.set(key, existing)
    }
  } finally {
    db.close()
  }
}

const rows = [...grouped.values()].sort((a, b) =>
  Number(b.estimated_cost_usd || 0) - Number(a.estimated_cost_usd || 0) ||
  Number(b.calls || 0) - Number(a.calls || 0)
)

if (!rows.length) {
  console.log(`No non-mock AI calls since ${since}${until ? ` and before ${until}` : ''}${flow ? ` for ${flow}` : ''}. Scanned ${databases.length} database(s); ${databasesWithTelemetry} had ai_call_log.`)
  process.exit(0)
}

const money = value => value == null ? 'n/a' : `$${Number(value).toFixed(4)}`
const num = value => Number(value || 0).toLocaleString('en-US')

console.log(`\nAI spend since ${since}${until ? ` until ${until}` : ''}${flow ? ` · flow=${flow}` : ''}`)
console.log(`databases: ${databases.length} scanned · ${databasesWithTelemetry} with telemetry\n`)
console.log(['flow', 'provider/model', 'kind', 'calls', 'input', 'output', 'cache read', 'cache write', 'cost', 'fail'].map(s => s.padEnd(18)).join(''))
console.log('-'.repeat(180))
for (const row of rows) {
  const cells = [
    row.flow,
    `${row.provider || '?'} / ${row.model || '?'}`,
    row.is_image ? 'image' : 'text',
    String(row.calls),
    num(row.input_tokens),
    num(row.output_tokens),
    num(row.cache_read_tokens),
    num(row.cache_creation_tokens),
    money(row.estimated_cost_usd),
    String(row.failures || 0),
  ]
  console.log(cells.map(value => String(value).slice(0, 17).padEnd(18)).join(''))
}
const total = rows.reduce((sum, row) => sum + Number(row.estimated_cost_usd || 0), 0)
const calls = rows.reduce((sum, row) => sum + Number(row.calls || 0), 0)
const failures = rows.reduce((sum, row) => sum + Number(row.failures || 0), 0)
console.log(`\nTotal: ${calls} calls · ${money(total)} · ${failures} failures\n`)
