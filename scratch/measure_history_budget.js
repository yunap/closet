/**
 * Offline measurement for the conversation-history question: what does the full `chatHistory`
 * actually cost per freeform turn, and what would a bounded budget keep or lose?
 *
 * Read-only. Isolate the database before running, per docs/database-safety.md:
 *   WARDROBE_DB_PATH=/tmp/copy.db node scratch/measure_history_budget.js
 *
 * Prints, per stored thread: history size, the share of it the newest N exchanges represent, and
 * which structured facts the dropped remainder still carries — so a budget can be judged on what it
 * would REMOVE, not on the token count alone.
 */
import { db } from '../db.js'

const TOK = chars => Math.round(chars / 4)
const KEEP_EXCHANGES = Number(process.env.HISTORY_KEEP_EXCHANGES || 3)
const RATES = { cacheWrite: 3.75, cacheRead: 0.30 }

const rows = db.prepare("SELECT id, title, payload FROM chat_threads WHERE COALESCE(archived,0)=0").all()
const threads = []
for (const row of rows) {
  let payload
  try { payload = JSON.parse(row.payload) } catch { continue }
  const history = Array.isArray(payload?.chatHistory) ? payload.chatHistory : []
  if (!history.length) continue
  const chars = history.reduce((n, m) => n + String(m?.content || '').length, 0)
  const keep = history.slice(-(KEEP_EXCHANGES * 2))
  const keptChars = keep.reduce((n, m) => n + String(m?.content || '').length, 0)
  threads.push({ id: row.id, title: (row.title || '').slice(0, 34), n: history.length, chars, keptChars })
}
threads.sort((a, b) => b.chars - a.chars)

console.log(`conversation history across ${threads.length} threads, keeping the newest ${KEEP_EXCHANGES} exchanges\n`)
console.log(`${'thread'.padEnd(26)}${'msgs'.padStart(5)}${'chars'.padStart(9)}${'~tok'.padStart(8)}${'kept~tok'.padStart(10)}${'dropped~tok'.padStart(13)}`)
for (const t of threads.slice(0, 12)) {
  console.log(`  ${t.title.padEnd(24)}${String(t.n).padStart(5)}${String(t.chars).padStart(9)}${String(TOK(t.chars)).padStart(8)}${String(TOK(t.keptChars)).padStart(10)}${String(TOK(t.chars - t.keptChars)).padStart(13)}`)
}
const totals = threads.reduce((a, t) => ({ chars: a.chars + t.chars, kept: a.kept + t.keptChars }), { chars: 0, kept: 0 })
const droppedTok = TOK(totals.chars - totals.kept)
console.log(`\n  all threads: ~${TOK(totals.chars).toLocaleString()} tok of history, ~${TOK(totals.kept).toLocaleString()} kept, ~${droppedTok.toLocaleString()} dropped`)

// History sits in the conversation, so it is written to cache once and re-read each iteration.
const worst = threads[0]
if (worst) {
  const dropped = TOK(worst.chars - worst.keptChars)
  for (const iters of [3, 6]) {
    const saved = (dropped * RATES.cacheWrite + dropped * RATES.cacheRead * (iters - 1)) / 1e6
    console.log(`  worst thread, ${iters} iterations: dropping ~${dropped.toLocaleString()} tok saves ~$${saved.toFixed(3)}`)
  }
}
console.log(`\n  NOTE: a saving is only real if the dropped exchanges carry nothing the structured`)
console.log(`  thread state, current outfit set, or saved feedback does not already hold. That is the`)
console.log(`  question this script does NOT answer — see docs/README.md and pilot on long threads.`)
