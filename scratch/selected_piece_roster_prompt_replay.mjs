// Roster-only replay (docs/selected-piece-model-roster-spec.md §9): the three captured live
// roster requests (2026-10-24, live_roster/captures) re-sent with ONLY the system prompt replaced by
// the current selectedPieceRosterSystemPrompt(). Same catalog, anchor photo, schema and model, so a
// change in how many garments she picks is the wording's. The captured answers are the old-prompt arm.
// usage: node scratch/selected_piece_roster_prompt_replay.mjs            preflight + dry run
//        node scratch/selected_piece_roster_prompt_replay.mjs --run --reps 2
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIVE = path.join(REPO, 'scratch/garment_read_runs/2026-10-24/live_roster')
const CAP = path.join(LIVE, 'captures')
const OUT = path.join(LIVE, 'prompt_replay')
const args = process.argv.slice(2)
const RUN = args.includes('--run'); const REPS = Number(args[args.indexOf('--reps') + 1]) || 2
const { selectedPieceRosterSystemPrompt } = await import(`${REPO}/styling-engine/selectedPieceRoster.js`)
const sha256 = v => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex')
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'))
const PLACEHOLDER = /^\[redacted, (\d+) chars, sha256:([0-9a-f]{16}), saved images\/([0-9a-f]{64}\.\w+)\]$/
const rehydrate = v => Array.isArray(v) ? v.map(rehydrate) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rehydrate(x)])) : (typeof v === 'string' && PLACEHOLDER.test(v)) ? (() => {
  const m = v.match(PLACEHOLDER); const b64 = fs.readFileSync(path.join(CAP, 'images', m[3])).toString('base64')
  if (b64.length !== Number(m[1]) || !sha256(b64).startsWith(m[2])) throw new Error(`image ${m[3]} does not match its capture`)
  return b64
})() : v
const anchorOf = req => Number(JSON.stringify(req.input).match(/Anchor: ID (\d+)/)?.[1])
const pickCounts = (ids, catalogText) => {
  const groupOf = new Map(); let group = ''
  for (const line of catalogText.split('\n')) { const h = line.match(/^=== ([A-Z]+) \(/); if (h) group = h[1].toLowerCase(); const r = line.match(/^#(\d+) /); if (r) groupOf.set(Number(r[1]), group) }
  return ids.reduce((c, id) => (c[groupOf.get(Number(id)) || 'unknown'] = (c[groupOf.get(Number(id)) || 'unknown'] || 0) + 1, c), {})
}

const wires = fs.readdirSync(CAP).filter(f => f.endsWith('-wire.json')).map(f => ({ f, r: readJson(path.join(CAP, f)) })).filter(x => x.r.subflow === 'selected_piece_roster_selection')
if (wires.length !== 3) throw new Error(`expected 3 roster captures, found ${wires.length}`)
const cells = []
for (const { f, r } of wires) {
  if (sha256(r.request) !== r.requestSha256) throw new Error(`${f}: capture does not match its requestSha256`)
  const output = readJson(path.join(CAP, f.replace('-wire.json', '-output.json').replace(/-(\d{4})-gemini-output/, (m, n) => `-${String(Number(n) + 1).padStart(4, '0')}-gemini-output`)))
  if (output.callId !== r.callId) throw new Error(`${f}: no paired output`)
  const control = rehydrate(r.request)
  const treated = { ...control, system_instruction: selectedPieceRosterSystemPrompt() }
  const changed = Object.keys(control).filter(k => JSON.stringify(control[k]) !== JSON.stringify(treated[k]))
  if (changed.length !== 1 || changed[0] !== 'system_instruction') throw new Error(`${f}: unexpected diff ${changed}`)
  const catalogText = control.input.filter(p => p.type === 'text').map(p => p.text).join('\n')
  const oldIds = JSON.parse(output.output).roster_piece_ids
  cells.push({ anchor: anchorOf(control), request: treated, catalogText, old: { ids: oldIds, counts: pickCounts(oldIds, catalogText) }, oldSystem: control.system_instruction })
  console.log(`anchor ${anchorOf(control)}: capture ${f.slice(0, 40)}… verified, ${control.input.filter(p => p.type === 'image').length} image; only system_instruction differs ✓; old pick ${oldIds.length} ${JSON.stringify(pickCounts(oldIds, catalogText))}`)
}
if (!RUN) {
  const a = cells[0].oldSystem, b = cells[0].request.system_instruction
  let i = 0; while (a[i] === b[i]) i++
  let j = 0; while (a[a.length - 1 - j] === b[b.length - 1 - j]) j++
  console.log(`\nsystem prompt change (same for all three):\n  OLD: …${a.slice(i, a.length - j)}…\n  NEW: …${b.slice(i, b.length - j)}…`)
  console.log(`\nPlan: 3 anchors × ${REPS} replicates = ${3 * REPS} roster calls, ≈ $${(3 * REPS * 0.0055).toFixed(3)} (captured roster calls cost $0.005–0.006). Dry run only — no calls made.`)
  process.exit(0)
}
const env = Object.fromEntries(fs.readFileSync(path.join(REPO, '.env'), 'utf8').split('\n').map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]))
const { GoogleGenAI } = await import('@google/genai')
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY })
fs.mkdirSync(OUT, { recursive: true })
let spent = 0
for (let rep = 1; rep <= REPS; rep++) for (const cell of cells) {
  const file = path.join(OUT, `${cell.anchor}__r${rep}.json`)
  if (fs.existsSync(file)) { console.log(`skip ${path.basename(file)}`); continue }
  const it = await ai.interactions.create(cell.request)
  const text = (it.steps || []).filter(s => s.type === 'model_output').map(o => (o.content || []).filter(c => c.type === 'text').map(c => c.text).join('')).join('').trim() || String(it.output_text || '')
  const u = it.usage || {}; const cost = (u.total_input_tokens || 0) * 0.3e-6 + ((u.total_output_tokens || 0) + (u.total_thought_tokens || 0)) * 2.5e-6
  spent += cost
  let parsed = null; try { parsed = JSON.parse(text) } catch {}
  const ids = parsed?.roster_piece_ids || []
  fs.writeFileSync(file, JSON.stringify({ anchor: cell.anchor, rep, text, parsed, usage: u, cost }, null, 2))
  console.log(`anchor ${cell.anchor} r${rep}: new pick ${ids.length} ${JSON.stringify(pickCounts(ids, cell.catalogText))} (old ${cell.old.ids.length} ${JSON.stringify(cell.old.counts)}) $${cost.toFixed(4)}\n   note: ${parsed?.selection_note}`)
}
console.log(`spent ≈ $${spent.toFixed(3)}`)
