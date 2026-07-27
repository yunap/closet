// Derives the app's NON-UI behaviour skeleton: what the engine does when nobody is looking.
//
// Companion to derive_surface_skeleton.js, which walks routes/tabs/dialogs and is therefore blind
// to anything that never renders. This walks a different axis — writes, prompt splices, retry
// loops, caches and sweeps — because that is where the expensive surprises live.
//
//   node scratch/derive_engine_behaviours.js            # summary
//   node scratch/derive_engine_behaviours.js --writes   # every write, with its function
//
// Read-only. No network, no database, no model call.

import fs from 'fs'
import path from 'path'

const root = process.cwd()
const DIRS = ['styling-engine', 'routes', 'src/utils', 'lib']
const verbose = process.argv.includes('--writes')

// Real table names, so prose in comments ("update the roster", "delete or keep") cannot be
// mistaken for SQL. Learned the hard way: the first run reported writes to tables named
// "the", "or", "SET" and "if".
const schema = fs.readFileSync(path.join(root, 'db.js'), 'utf8')
const TABLES = new Set([...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]))

const files = []
for (const dir of DIRS) {
  const abs = path.join(root, dir)
  if (!fs.existsSync(abs)) continue
  for (const f of fs.readdirSync(abs)) {
    if (f.endsWith('.js')) files.push(`${dir}/${f}`)
  }
}

// enclosing function name for a given line index
const enclosing = (lines, idx) => {
  for (let j = idx; j >= 0; j--) {
    const m = lines[j].match(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)|^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/)
    if (m) return m[1] || m[2]
  }
  return '(top level)'
}

const writes = []
const splices = []
const retries = []
const caches = []
const sweeps = []

for (const file of files) {
  const src = fs.readFileSync(path.join(root, file), 'utf8')
  const lines = src.split('\n')

  lines.forEach((line, i) => {
    // --- DB writes
    const w = line.match(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/i)
    if (w && TABLES.has(w[2])) {
      const fn = enclosing(lines, i)
      // a write inside an obvious CRUD handler is expected; one inside the engine is a side effect
      const isEngine = file.startsWith('styling-engine/')
      writes.push({ file, line: i + 1, verb: w[1].toUpperCase(), table: w[2], fn, isEngine })
      if (/DELETE FROM/i.test(line) && /orphan|stale|clear|prune|sweep/i.test(src.slice(Math.max(0, src.indexOf(line) - 400), src.indexOf(line)))) {
        sweeps.push({ file, line: i + 1, table: w[2], fn })
      }
    }

    // --- prompt splice sites: memory//context text interpolated into a prompt
    if (/\$\{\w*(Memory|memoryText|Rules|constitution|c\.\w+)\w*\}/.test(line) && /`/.test(line)) {
      splices.push({ file, line: i + 1, fn: enclosing(lines, i), text: line.trim().slice(0, 90) })
    }

    // --- retry loops around model calls
    if (/for\s*\(\s*let\s+\w+\s*=\s*0;.*<\s*\d+/.test(line)) {
      const window = lines.slice(i, i + 14).join(' ')
      if (/ask|retry|correctionMessage|takeTestAiResponse|provider/i.test(window)) {
        const cap = line.match(/<\s*(\d+)/)
        retries.push({ file, line: i + 1, fn: enclosing(lines, i), cap: cap ? cap[1] : '?' })
      }
    }

    // --- caches
    if (/new Map\(\)|cache\s*=|Cache\b/.test(line) && /const\s/.test(line)) {
      caches.push({ file, line: i + 1, fn: enclosing(lines, i), text: line.trim().slice(0, 80) })
    }
  })
}

const engineWrites = writes.filter(w => w.isEngine)
const byTable = {}
for (const w of writes) byTable[w.table] = (byTable[w.table] || 0) + 1

console.log(`scanned ${files.length} files\n`)
console.log(`DB writes: ${writes.length} total, ${engineWrites.length} from inside styling-engine/`)
console.log(`  (a write from the engine is a side effect — it happens as a consequence of something else)\n`)

console.log('--- writes originating in styling-engine/ (side effects) ---')
for (const w of engineWrites) console.log(`  ${w.verb.padEnd(11)} ${w.table.padEnd(22)} ${w.fn}  (${w.file}:${w.line})`)

console.log('\n--- tables written, by volume of write sites ---')
for (const [t, n] of Object.entries(byTable).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${t}`)

console.log(`\n--- retry loops around model calls (${retries.length}) ---`)
for (const r of retries) console.log(`  up to ${r.cap}x  ${r.fn}  (${r.file}:${r.line})`)

console.log(`\n--- prompt splice sites (${splices.length}) ---`)
for (const s of splices.slice(0, 25)) console.log(`  ${s.fn}  (${s.file}:${s.line})`)
if (splices.length > 25) console.log(`  … and ${splices.length - 25} more`)

console.log(`\n--- caches (${caches.length}) ---`)
for (const c of caches.slice(0, 12)) console.log(`  ${c.fn}  (${c.file}:${c.line})  ${c.text}`)

if (verbose) {
  console.log('\n--- every write ---')
  for (const w of writes) console.log(`  ${w.verb.padEnd(11)} ${w.table.padEnd(22)} ${w.fn}  (${w.file}:${w.line})`)
}

console.log(`\nNOTE: finds mechanisms, not intent. A side effect is not automatically wrong —`)
console.log(`read it before judging. This is the list of things a UI-first map cannot see.`)
