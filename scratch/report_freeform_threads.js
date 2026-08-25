// Report transcript + freeform turn telemetry + per-provider-call telemetry for specific chat threads.
//
// Read-only: each wardrobe DB is copied with its WAL/SHM files to a temp directory before opening,
// matching scratch/report_ai_spend.js and docs/database-safety.md.
//
// Usage:
//   node scratch/report_freeform_threads.js thread_1787435527800
//   node scratch/report_freeform_threads.js thread_... thread_...
//   WARDROBE_DB_PATH=/path/to/wardrobe.db node scratch/report_freeform_threads.js thread_...
//
// Paste the output into ChatGPT when reviewing freeform architecture/cost behavior.

import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'

const threadIds = process.argv.slice(2).filter(arg => !arg.startsWith('--'))

if (!threadIds.length) {
  console.error('Usage: node scratch/report_freeform_threads.js <thread_id> [thread_id ...]')
  process.exit(1)
}

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

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name))
}

function columnsFor(db, table) {
  if (!hasTable(db, table)) return new Set()
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name))
}

function pick(obj, keys) {
  const out = {}
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined) out[key] = obj[key]
  }
  return out
}

function parsePayload(text) {
  try { return JSON.parse(text || '{}') } catch { return {} }
}

function messageSummary(message, index) {
  const role = message?.role || message?.sender || message?.type || '?'
  const text = message?.content ?? message?.text ?? message?.message ?? message?.answer ?? ''
  const structured = message?.structuredOutfits || message?.outfits || []
  const summary = {
    index,
    role,
    text: typeof text === 'string' ? text : JSON.stringify(text),
  }
  if (Array.isArray(structured) && structured.length) {
    summary.structuredOutfits = structured.map(outfit => pick(outfit, [
      'id', 'label', 'title', 'strength', 'reason', 'rejectionReason', 'broken', 'pieceIds', 'piece_ids'
    ]))
  }
  if (message?.debug) summary.debug = message.debug
  return summary
}

function selectExistingColumns(db, table, desired) {
  const available = columnsFor(db, table)
  return desired.filter(name => available.has(name))
}

const databases = candidateDatabases()
if (!databases.length) {
  console.error('No wardrobe database found (checked WARDROBE_DB_PATH, ./wardrobe.db, and data/users/*/wardrobe.db).')
  process.exit(1)
}

const snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'freeform-thread-report-'))
const reports = new Map(threadIds.map(id => [id, { threadId: id, matches: [] }]))

for (const [index, live] of databases.entries()) {
  const copy = snapshotDatabase(live, snapshotRoot, index)
  const db = new Database(copy, { readonly: true })
  try {
    for (const threadId of threadIds) {
      const match = { database: live, transcript: null, freeformRuns: [], aiCalls: [] }
      let found = false

      if (hasTable(db, 'chat_threads')) {
        const thread = db.prepare('SELECT id, title, payload, created_at, updated_at FROM chat_threads WHERE id = ?').get(threadId)
        if (thread) {
          found = true
          const payload = parsePayload(thread.payload)
          const messages = Array.isArray(payload.messages) ? payload.messages : []
          match.transcript = {
            id: thread.id,
            title: thread.title,
            created_at: thread.created_at,
            updated_at: thread.updated_at,
            messages: messages.map(messageSummary),
          }
        }
      }

      if (hasTable(db, 'freeform_generation_runs')) {
        const runColumns = selectExistingColumns(db, 'freeform_generation_runs', [
          'id', 'session_id', 'occasion', 'search_calls', 'gate_excluded_total', 'propose_calls',
          'propose_validation_fails', 'outfit_prose_without_tool_count', 'zero_result_contradiction_blocks',
          'atomic_multi_look_calls', 'execution_router_calls', 'destination_clarification_retries',
          'plan_compose_mode', 'submit_plan_calls', 'submit_plan_validation_fails', 'submit_plan_resubmits',
          'submit_plan_partial_accepts', 'capsule_final_fallbacks', 'capsule_supply_gaps',
          'capsule_looks_auto_completed', 'capsule_roster_model_calls', 'capsule_roster_model_repairs',
          'capsule_roster_model_fallbacks', 'capsule_roster_failure_codes', 'turn_failed',
          'provider_iterations', 'provider_input_tokens', 'provider_output_tokens',
          'provider_cache_read_input_tokens', 'provider_cache_creation_input_tokens', 'weather_source',
          'history_messages_received', 'history_messages_included', 'history_chars_removed', 'created_at'
        ])
        if (runColumns.length) {
          match.freeformRuns = db.prepare(`
            SELECT ${runColumns.join(', ')}
            FROM freeform_generation_runs
            WHERE session_id = ?
            ORDER BY created_at, id
          `).all(threadId)
          if (match.freeformRuns.length) found = true
        }
      }

      if (hasTable(db, 'ai_call_log')) {
        const callColumns = selectExistingColumns(db, 'ai_call_log', [
          'id', 'flow', 'endpoint', 'session_id', 'freeform_run_id', 'freeform_turn_token',
          'iteration_index', 'subflow', 'tool_names', 'is_retry', 'retry_reason', 'is_nested',
          'call_kind', 'is_image', 'provider', 'model', 'success', 'error_message',
          'input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens',
          'total_tokens', 'estimated_cost_usd', 'latency_ms', 'is_mock', 'context', 'created_at'
        ])
        if (callColumns.length) {
          match.aiCalls = db.prepare(`
            SELECT ${callColumns.join(', ')}
            FROM ai_call_log
            WHERE session_id = ? AND COALESCE(is_mock, 0) = 0
            ORDER BY created_at, COALESCE(iteration_index, 999999), id
          `).all(threadId)
          if (match.aiCalls.length) found = true
        }
      }

      if (found) reports.get(threadId).matches.push(match)
    }
  } finally {
    db.close()
  }
}

console.log(`# Freeform thread telemetry report`)
console.log(`Databases scanned: ${databases.length}`)
console.log(`Threads requested: ${threadIds.join(', ')}`)

for (const threadId of threadIds) {
  const report = reports.get(threadId)
  console.log(`\n## ${threadId}`)
  if (!report.matches.length) {
    console.log('No matching thread or telemetry found.')
    continue
  }

  for (const [matchIndex, match] of report.matches.entries()) {
    if (report.matches.length > 1) console.log(`\n### Database match ${matchIndex + 1}: ${match.database}`)
    else console.log(`Database: ${match.database}`)

    console.log('\n### Transcript')
    if (!match.transcript) console.log('No chat_threads row found.')
    else console.log(JSON.stringify(match.transcript, null, 2))

    console.log('\n### freeform_generation_runs')
    if (!match.freeformRuns.length) console.log('No freeform_generation_runs rows found.')
    else console.log(JSON.stringify(match.freeformRuns, null, 2))

    console.log('\n### ai_call_log')
    if (!match.aiCalls.length) console.log('No ai_call_log rows found.')
    else console.log(JSON.stringify(match.aiCalls, null, 2))
  }
}
