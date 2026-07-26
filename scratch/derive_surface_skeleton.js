// Derives the app's surface skeleton from source, and diffs it against docs/app-surface-map.md.
//
// Purpose: the map is hand-written and will rot. This makes staleness *checkable* — run it and it
// prints surfaces that exist in code but have no entry, and entries that no longer match anything.
//
// It finds surfaces (routes, tabs, mode-gated sections, dialogs). It does NOT understand behaviour,
// so it cannot tell you an entry is wrong — only that one is missing or orphaned. Every error in
// the 2026-07-26 session was a misread condition, not a missed file; this catches the other half.
//
//   node scratch/derive_surface_skeleton.js
//
// Read-only. No network, no database, no model call.

import fs from 'fs'
import path from 'path'

const root = process.cwd()
const read = p => { try { return fs.readFileSync(path.join(root, p), 'utf8') } catch { return '' } }

const surfaces = []
const add = (kind, name, where, note = '') => surfaces.push({ kind, name, where, note })

// ---- routes -------------------------------------------------------------
const app = read('src/App.jsx')
for (const m of app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<(\w+)/g)) {
  if (m[1] === '/') continue
  add('route', m[1], 'src/App.jsx', `renders <${m[2]}>`)
}

// ---- tab / section sets -------------------------------------------------
// e.g. VALID_SECTIONS = ['references','saved','profile','upload']
for (const file of ['src/components/VisualLab.jsx', 'src/components/StylistChat.jsx',
                    'src/views/OutfitLookbook.jsx', 'src/views/PieceInventory.jsx']) {
  const src = read(file)
  if (!src) continue
  for (const m of src.matchAll(/const\s+(VALID_SECTIONS|SECTIONS|TABS|VALID_TABS)\s*=\s*\[([^\]]+)\]/g)) {
    for (const raw of m[2].split(',')) {
      const name = raw.trim().replace(/^['"]|['"]$/g, '')
      if (name) add('tab', name, file, `member of ${m[1]}`)
    }
  }
}

// ---- mode-gated section variants ---------------------------------------
// A component rendered under two modes is two surfaces. This is exactly the distinction that was
// misread twice: StylistSettings renders disjoint sections for mode 'account' vs 'style'.
// NOTE: a single literal is enough. StylistSettings only ever writes `mode === 'style'` and
// relies on a default prop for the other branch, so requiring two literals missed the exact case
// this check exists for. Any mode gate at all means the component renders as 2+ surfaces.
for (const dir of ['src/views', 'src/components']) {
  for (const f of fs.readdirSync(path.join(root, dir))) {
    if (!f.endsWith('.jsx')) continue
    const file = `${dir}/${f}`
    const src = read(file)
    const modes = new Set()
    // Only count gates that guard *rendering*. StylistChat parses prose with a local `mode`
    // variable ('skip'/'avoid'/'learning') which is not a surface split — checked 2026-07-26.
    for (const m of src.matchAll(/mode === '(\w+)'/g)) {
      const line = src.slice(0, m.index).split('\n').length
      const ctx = src.split('\n').slice(line - 2, line + 1).join(' ')
      if (/notes\.push|\bcontinue\b/.test(ctx)) continue
      modes.add(m[1])
    }
    const dflt = src.match(/mode\s*=\s*'(\w+)'/)
    if (dflt) modes.add(dflt[1])
    if (modes.size > 1) {
      add('mode-split', path.basename(f, '.jsx'), file,
          `renders disjoint sections per mode: ${[...modes].join(', ')} — count each as its own surface`)
    }
  }
}

// ---- dialogs / modals ---------------------------------------------------
for (const dir of ['src/views', 'src/components']) {
  for (const f of fs.readdirSync(path.join(root, dir))) {
    if (!f.endsWith('.jsx')) continue
    const file = `${dir}/${f}`
    const src = read(file)
    const dialogs = [...src.matchAll(/role="dialog"/g)].length
    if (dialogs) add('dialog', path.basename(f, '.jsx'), file, `${dialogs} dialog(s)`)
  }
}

// ---- api surface --------------------------------------------------------
const endpoints = []
for (const f of fs.readdirSync(path.join(root, 'routes'))) {
  if (!f.endsWith('.js')) continue
  const src = read(`routes/${f}`)
  for (const m of src.matchAll(/router\.(get|post|patch|put|delete)\(\s*['"`]([^'"`]+)/g)) {
    endpoints.push(`${m[1].toUpperCase()} ${m[2]}  (routes/${f})`)
  }
}

// ---- diff against the map ----------------------------------------------
const map = read('docs/app-surface-map.md')
const headings = [...map.matchAll(/^## (.+)$/gm)].map(m => m[1].toLowerCase())
const covered = name => headings.some(h => h.includes(String(name).toLowerCase().replace(/^\//, '')))

console.log(`derived ${surfaces.length} candidate surfaces, ${endpoints.length} api endpoints`)
console.log(`map has ${headings.length} headings\n`)

const missing = surfaces.filter(s => !covered(s.name) && !covered(s.where))
console.log(`--- candidate surfaces with no obvious map entry (${missing.length}) ---`)
for (const s of missing) console.log(`  [${s.kind}] ${s.name}  ${s.where}${s.note ? '  — ' + s.note : ''}`)

console.log(`\n--- all derived surfaces, for the checklist ---`)
for (const s of surfaces) console.log(`  ${covered(s.name) ? '✓' : ' '} [${s.kind}] ${s.name}  (${s.where})`)

console.log(`\nEndpoint count by file:`)
const byFile = {}
for (const e of endpoints) { const f = e.match(/\(routes\/(.+?)\)/)[1]; byFile[f] = (byFile[f] || 0) + 1 }
for (const [f, n] of Object.entries(byFile)) console.log(`  ${n.toString().padStart(3)}  routes/${f}`)

console.log(`\nNOTE: this finds surfaces, not behaviour. It cannot tell you an entry is WRONG —`)
console.log(`only that one is missing. Verify conditions (mode gates, feature flags) by reading.`)
