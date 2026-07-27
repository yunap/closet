// Derives the fan-out from each board-image producer function (styling-engine/core.js) through
// its server-side callers (routes/*.js, styling-engine/tools.js) to the frontend render blocks
// that display the result (src/components/StylistChat.jsx) — and flags any render block that
// doesn't carry the same feedback-chip UI as its siblings.
//
// Why this exists: 2026-07-27's board-feedback-desync fix found two frontend render blocks with
// zero feedback UI, both calling the *same* producer function (createWholeWardrobeOutfitImage) as
// blocks that had full feedback UI. Neither docs/app-surface-map.md (UI-structure-first: routes,
// tabs, mode gates, dialogs) nor docs/engine-behaviour-map.md (backend-function-first: producers,
// cost, payloads) tracks this fan-out — one producer, many consumers, inconsistent capability
// across consumers. This is a third axis neither existing derivation script covers.
//
// Read-only. No network, no database, no model call. Regex/bracket-matching heuristics, same
// style as scratch/derive_surface_skeleton.js — flags candidates for a human to confirm, does not
// claim to be exhaustive or always correctly linked. Any row it can't confidently link is printed
// under "UNLINKED" rather than silently dropped.
//
//   node scratch/derive_board_producer_fanout.js

import fs from 'fs'
import path from 'path'

const root = process.cwd()
const read = p => { try { return fs.readFileSync(path.join(root, p), 'utf8') } catch { return '' } }
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length

// ---- 1. Discover producer functions in core.js --------------------------
const coreSrc = read('styling-engine/core.js')
const producers = [...coreSrc.matchAll(/^export async function (create\w*Image)\(/gm)].map(m => m[1])
console.log(`Found ${producers.length} exported image-producer functions in styling-engine/core.js:`)
producers.forEach(p => console.log(`  - ${p}`))
console.log()

// ---- 2. Find every server-side call site of each producer ---------------
// Only routes/*.js and styling-engine/tools.js count as "reachable from a user action" — calls
// from *within* another producer (e.g. the shared collage fallback) are implementation detail,
// not a separate fan-out branch, so they're excluded here on purpose.
const serverFiles = [
  ...fs.readdirSync(path.join(root, 'routes')).filter(f => f.endsWith('.js')).map(f => `routes/${f}`),
  'styling-engine/tools.js',
]

const producerCallSites = {} // producer -> [{file, line, routeOrTool}]
for (const producer of producers) producerCallSites[producer] = []

for (const file of serverFiles) {
  const src = read(file)
  if (!src) continue
  // Track the nearest preceding router.METHOD('/path' or name: "tool_name" as context.
  const routeMatches = [...src.matchAll(/router\.(get|post|patch|put|delete)\(\s*['"`]([^'"`]+)/g)]
    .map(m => ({ idx: m.index, label: `${m[1].toUpperCase()} ${m[2]}` }))
  const toolMatches = [...src.matchAll(/name:\s*["'](\w+)["']/g)]
    .map(m => ({ idx: m.index, label: `tool ${m[1]}` }))
  const anchors = [...routeMatches, ...toolMatches].sort((a, b) => a.idx - b.idx)
  const nearestAnchor = idx => {
    let best = null
    for (const a of anchors) { if (a.idx <= idx) best = a; else break }
    return best ? best.label : '(no enclosing route/tool found)'
  }

  for (const producer of producers) {
    const re = new RegExp(`\\b${producer}\\(`, 'g')
    for (const m of src.matchAll(re)) {
      // Skip the definition line itself if this file happens to be core.js (it isn't in
      // serverFiles, but guard anyway) and skip matches that are really `function create...(`.
      const before = src.slice(Math.max(0, m.index - 20), m.index)
      if (/function\s+$/.test(before) || /async\s+function\s+$/.test(before)) continue
      producerCallSites[producer].push({ file, line: lineOf(src, m.index), routeOrTool: nearestAnchor(m.index) })
    }
  }
}

console.log('Producer -> server call sites:')
for (const producer of producers) {
  const sites = producerCallSites[producer]
  if (!sites.length) { console.log(`  ${producer}: (no call sites found outside core.js — check for internal-only use)`); continue }
  console.log(`  ${producer}:`)
  for (const s of sites) console.log(`    ${s.routeOrTool}  (${s.file}:${s.line})`)
}
console.log()

// ---- 3. Frontend: every fetch('/api/ai/...') call and what state it feeds ----
const chatSrc = read('src/components/StylistChat.jsx')
const fetchCalls = [...chatSrc.matchAll(/fetch\(\s*[`'"](\/api\/ai\/[^`'"]+)[`'"]/g)]
  .map(m => ({ path: m[1], idx: m.index, line: lineOf(chatSrc, m.index) }))

// Best-effort: look at the next ~800 chars after each fetch for the first setXxx( call, which is
// usually (not always) where the response lands.
const feeds = fetchCalls.map(f => {
  const window = chatSrc.slice(f.idx, f.idx + 800)
  const setterMatch = window.match(/\bset([A-Z]\w+)\(/)
  return { ...f, setter: setterMatch ? `set${setterMatch[1]}` : null }
})

console.log("Frontend fetch('/api/ai/...') call sites and the state setter that appears to follow:")
for (const f of feeds) {
  console.log(`  ${f.path}  (StylistChat.jsx:${f.line}) -> ${f.setter || 'UNLINKED (no setXxx( found nearby — check by hand)'}`)
}
console.log()

// ---- 4. Frontend render blocks: every .map(...) producing a generated-visual-card -----
// Find each `<state>.map((<item>, <idx>) => {` that is followed (within the block) by
// `className="generated-visual-card"`, bracket-match to the closing of that arrow function body,
// and check whether `stylist-feedback-chip` appears inside — that's the actual feedback-chip
// signal, more reliable than any comment or label.
function extractBalanced(src, openIdx) {
  // openIdx points at the '{' that opens the arrow function body.
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(openIdx, i + 1) }
  }
  return src.slice(openIdx, openIdx + 4000) // fallback: unterminated, just cap it
}

const mapRe = /(\w+(?:\[\w+\])?)\.map\(\((\w+)(?:,\s*\w+)?\)\s*=>\s*\{/g
const renderBlocks = []
for (const m of chatSrc.matchAll(mapRe)) {
  const openBraceIdx = m.index + m[0].length - 1
  const block = extractBalanced(chatSrc, openBraceIdx)
  if (!/generated-visual-card/.test(block)) continue // not a board-rendering loop
  const hasChips = /stylist-feedback-chip/.test(block)
  const saveKeyMatch = block.match(/(?:key|saveKey|renderSaveKey):\s*[`'"]?([\w-]+)[`'"]?\s*:?\s*\$\{/) || block.match(/const\s+\w*[Ss]aveKey\s*=\s*`([\w-]+):/)
  renderBlocks.push({
    sourceVar: m[1],
    line: lineOf(chatSrc, m.index),
    hasChips,
    saveKeyPrefix: saveKeyMatch ? saveKeyMatch[1] : '(not found — check by hand)',
  })
}

console.log('Frontend board-rendering blocks (every `<state>.map(...)` that renders a `generated-visual-card`):')
for (const b of renderBlocks) {
  console.log(`  ${b.sourceVar}  (StylistChat.jsx:${b.line})  save-key prefix: ${b.saveKeyPrefix}  feedback chips: ${b.hasChips ? 'YES' : 'NO'}`)
}
console.log()

// ---- 5. Flag inconsistency ------------------------------------------------
const withoutChips = renderBlocks.filter(b => !b.hasChips)
if (withoutChips.length) {
  console.log(`FLAGGED — ${withoutChips.length} render block(s) with NO feedback chips:`)
  withoutChips.forEach(b => console.log(`  ${b.sourceVar} at StylistChat.jsx:${b.line} (save-key prefix: ${b.saveKeyPrefix})`))
} else {
  console.log('No render blocks flagged — every `generated-visual-card` loop found has feedback-chip markup.')
}
console.log()
console.log('This script does NOT confirm the producer -> route -> frontend-state -> render-block chain end')
console.log('to end automatically (that link is semantic, not mechanical) — cross-reference the three')
console.log('tables above by hand for anything not already documented in docs/app-surface-map.md\'s')
console.log('board-feedback-chips entry.')
