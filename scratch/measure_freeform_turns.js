// Measure freeform turns against the recorded baselines of this arc.
//
// Read-only, and never touches the live database: it copies wardrobe.db to a temp file first, per
// docs/database-safety.md. Prices with the same table styling-engine/provider.js uses, so the
// numbers here and in the specs are comparable.
//
//   node scratch/measure_freeform_turns.js                 # turns from the last 24h
//   node scratch/measure_freeform_turns.js --since '2026-08-19 18:00'
//   node scratch/measure_freeform_turns.js --thread thread_123
//
// What it answers, and why each needs a live turn rather than a test:
//   - did the model actually BATCH one search across categories, or fall back to one per category?
//   - did automatic broadening spare it the re-search round-trip on a sparse anchor?
//   - is declaration ceremony gone from turns that produce no cards?
//   - is cross-turn cache reuse holding?
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'

const PRICES = { input: 3.0, cacheWrite: 3.75, cacheRead: 0.30, output: 15.0 } // claude-sonnet-4-6

// Recorded baselines from this arc, for comparison rather than nostalgia.
const BASELINES = {
  'sparse composition (pre-batching)': { thread: 'thread_1787128902650', iterations: 9, searches: 5, created: 60532, read: 212147, input: 2174, output: 1875 },
  // Shoe-coverage baselines rather than the lightweight-jacket one: `outerwear` is a storage
  // category, not a garment kind, so a jacket audit mixes the evidence question with a taxonomy
  // problem. `shoes` is both, and walk_support is an owner-confirmable latent property — the same
  // shape as the failures these threads recorded.
  'shoe coverage — single judge (visually anchored)': { thread: 'thread_1787126412249', iterations: 2, searches: 0, created: 0, read: 0, input: 16354, output: 1446 },
  'shoe coverage — restated instruction, same miss': { thread: 'thread_1787127928718', iterations: 2, searches: 0, created: 0, read: 0, input: 16469, output: 1450 },
  'shoe coverage — staged, rejected for default-on': { thread: 'thread_1787128659041', iterations: 3, searches: 0, created: 0, read: 0, input: 19384, output: 2867 },
  'follow-up (post cache fix)': { thread: 'thread_1787128902650', iterations: 2, searches: 0, created: 4730, read: 80220, input: 4, output: 0 },
}

const usd = r => (Number(r.provider_input_tokens || 0) * PRICES.input
  + Number(r.provider_output_tokens || 0) * PRICES.output
  + Number(r.provider_cache_read_input_tokens || 0) * PRICES.cacheRead
  + Number(r.provider_cache_creation_input_tokens || 0) * PRICES.cacheWrite) / 1e6

const args = process.argv.slice(2)
const argOf = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] }
const since = argOf('--since') || new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const thread = argOf('--thread')

const live = path.join(process.cwd(), 'wardrobe.db')
if (!fs.existsSync(live)) { console.error('No wardrobe.db in the working directory.'); process.exit(1) }
const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'freeform-measure-')), 'snapshot.db')
fs.copyFileSync(live, copy)
// The -wal file holds commits not yet checkpointed into the main database. Copying wardrobe.db
// alone silently loses them — which would drop exactly the turns just run, the ones being measured.
// Observed: 140 rows live, 127 in a .db-only copy.
for (const suffix of ['-wal', '-shm']) {
  if (fs.existsSync(live + suffix)) fs.copyFileSync(live + suffix, copy + suffix)
}
const db = new Database(copy, { readonly: true })

// The assistant reply belonging to a specific turn. Aligning the LAST N assistant messages with the
// N measured rows in order skips the opening greeting without having to recognise it. Reading only
// the newest message showed the same answer against every row of a multi-turn thread, which made a
// three-turn thread look like it had answered identically three times.
function assistantTextForTurn(sessionId, turnIndex, turnCount) {
  if (!sessionId) return ''
  try {
    const row = db.prepare('SELECT payload FROM chat_threads WHERE id = ?').get(sessionId)
    const messages = JSON.parse(row?.payload || '{}')?.messages
    if (!Array.isArray(messages)) return ''
    const assistant = messages.filter(m => m?.role === 'assistant' && m?.text).map(m => String(m.text))
    const aligned = assistant.length >= turnCount ? assistant.slice(-turnCount) : assistant
    return aligned[turnIndex] || ''
  } catch { return '' }
}

const rows = thread
  ? db.prepare('SELECT * FROM freeform_generation_runs WHERE session_id = ? ORDER BY created_at').all(thread)
  : db.prepare('SELECT * FROM freeform_generation_runs WHERE created_at >= ? ORDER BY created_at').all(since)

if (!rows.length) {
  console.log(`No freeform runs ${thread ? `for ${thread}` : `since ${since}`}.`)
  process.exit(0)
}

console.log(`\n=== ${rows.length} turn(s) ${thread ? `on ${thread}` : `since ${since}`} ===\n`)
for (const [rowIndex, r] of rows.entries()) {
  const sequence = String(r.tool_sequence || '')
  const searchIterations = sequence.split(';').filter(step => step.includes('search_wardrobe')).length
  console.log(`${r.created_at}  ${r.session_id || '(UNATTRIBUTED — attribution guard should have prevented this)'}`)
  console.log(`  tools        ${sequence || '(none)'}`)
  console.log(`  iterations   ${r.provider_iterations}   searches ${r.search_calls}   proposes ${r.propose_calls}${r.turn_failed ? '   TURN FAILED' : ''}`)
  console.log(`  tokens       in ${r.provider_input_tokens}  out ${r.provider_output_tokens}  cache w ${r.provider_cache_creation_input_tokens} / r ${r.provider_cache_read_input_tokens}`)
  console.log(`  cost         $${usd(r).toFixed(4)}`)

  const notes = []
  if (r.search_calls > 1) notes.push(`${r.search_calls} searches — batching did NOT happen; the description asks for one call covering every category`)
  // One search only demonstrates batching if the turn actually needed several categories. A
  // single-category question ("enough dressy flats?") reaches one search either way, so claiming
  // batching there would be reading a result into a request that could not produce it.
  if (r.search_calls === 1 && searchIterations === 1) notes.push('one search — batching is only demonstrated if the request needed several categories; check the question')
  if (sequence.includes('declare_intent') && r.propose_calls === 0 && !sequence.includes('generate_outfits') && !sequence.includes('render_preview')) {
    notes.push('declare_intent on a turn that produced no cards — the ceremony change did not take')
  }
  if (r.provider_cache_creation_input_tokens > 30000 && r.provider_cache_read_input_tokens > 0) {
    notes.push('large cache write despite a read — check whether the message prefix broke again')
  }
  for (const note of notes) console.log(`  → ${note}`)

  // Half of what a live turn proves is in the prose, not the counters: whether the closing answer
  // drifted from its card, leaked retrieval machinery, or claimed hidden performance from looks.
  // chat_threads stores it, so this does not need pasting back by hand.
  const answer = assistantTextForTurn(r.session_id, rowIndex, rows.length)
  if (answer) {
    console.log(`  answer       ${answer.slice(0, 400).replace(/\n+/g, ' ')}${answer.length > 400 ? ' …' : ''}`)
    const leaks = [
      [/\bno exact match\b|\b(?:relaxed|dropped) (?:the )?[\w-]* ?filters?\b|\bbroadened the search\b/i, 'retrieval machinery in user-facing prose'],
      [/\b(?:relaxedFilters|requestedCategories|returnedByCategory|shortfalls?)\b/, 'literal retrieval field names'],
      // NOT listed as a leak: the prompt currently REQUIRES "(ID <n>)" citations in prose so the
      // unverified-citation guard can check them (core.js "cite it as (ID <number>)"). That is a
      // live tension with batched discovery's acceptance case 7, which says user-facing prose shows
      // no IDs — a question for the owner, not something this script should report as a defect.
      [/\b(?:formality|fabric_weight|walk_support|tuck_behavior|occasions)\b/, 'database field names'],
    ].filter(([re]) => re.test(answer)).map(([, label]) => label)
    for (const leak of leaks) console.log(`  → PROSE: ${leak}`)
  }
  console.log()
}

const total = rows.reduce((sum, r) => sum + usd(r), 0)
console.log(`total: $${total.toFixed(4)}   mean per turn: $${(total / rows.length).toFixed(4)}\n`)

console.log('=== recorded baselines ===')
for (const [label, b] of Object.entries(BASELINES)) {
  const cost = (b.input * PRICES.input + b.output * PRICES.output + b.read * PRICES.cacheRead + b.created * PRICES.cacheWrite) / 1e6
  console.log(`  ${label.padEnd(44)} ${String(b.iterations).padStart(2)} iters, ${b.searches} searches, $${cost.toFixed(4)}`)
}
console.log()
