// Report durable provider-call spend from ai_call_log.
//
// Read-only: copy wardrobe.db + WAL/SHM to a temp directory before opening it,
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

const live = path.join(process.cwd(), 'wardrobe.db')
if (!fs.existsSync(live)) {
  console.error('No wardrobe.db in the working directory.')
  process.exit(1)
}
const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-spend-')), 'snapshot.db')
fs.copyFileSync(live, copy)
for (const suffix of ['-wal', '-shm']) {
  if (fs.existsSync(live + suffix)) fs.copyFileSync(live + suffix, copy + suffix)
}
const db = new Database(copy, { readonly: true })

const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_call_log'").get()
if (!table) {
  console.log('ai_call_log does not exist yet. Restart the app on a build with telemetry enabled and exercise a model-facing flow first.')
  process.exit(0)
}

const where = ['created_at >= ?', 'is_mock = 0']
const params = [since]
if (until) { where.push('created_at < ?'); params.push(until) }
if (flow) { where.push('flow = ?'); params.push(flow) }

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
  ORDER BY COALESCE(estimated_cost_usd, 0) DESC, calls DESC
`).all(...params)

if (!rows.length) {
  console.log(`No non-mock AI calls since ${since}${until ? ` and before ${until}` : ''}${flow ? ` for ${flow}` : ''}.`)
  process.exit(0)
}

const money = value => value == null ? 'n/a' : `$${Number(value).toFixed(4)}`
const num = value => Number(value || 0).toLocaleString('en-US')

console.log(`\nAI spend since ${since}${until ? ` until ${until}` : ''}${flow ? ` · flow=${flow}` : ''}\n`)
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
