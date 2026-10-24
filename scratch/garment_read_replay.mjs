// Garment-read-first replay (docs/garment-read-first-composer-design.md §4–5).
// Replays the three captured first-turn selected-piece composer requests (2026-10-24) in three arms:
//   A control      — the captured wire request, images rehydrated, nothing else changed
//   B read_first   — A + GARMENT_READ_FIRST_INSTRUCTION appended to the system prompt, garment_read /
//                    directions / outfits[].direction in the schema, max_output_tokens 2900 → 3500
//   C think_more   — A with thinking_level medium and max_output_tokens + 4000 (thinking counts against it)
// No app code, no db.js, no wardrobe database: requests come from ~/.wardrobe-captures, the key from .env.
//
// usage:
//   node scratch/garment_read_replay.mjs                 preflight + dry run (no model calls)
//   node scratch/garment_read_replay.mjs --run --reps 2  preflight, then the paid calls
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CAPTURES = path.join(os.homedir(), '.wardrobe-captures')
const OUT = path.join(REPO, 'scratch/garment_read_runs/2026-10-24')
const args = process.argv.slice(2)
const RUN = args.includes('--run')
const REPS = Number(args[args.indexOf('--reps') + 1]) || 2

export const THREADS = [
  { thread: 'thread_1792821629010', anchor: 'olive utility skinny pants', wire: '20261024T055745633Z-p97929-63e73900-0002-gemini-wire.json', output: '20261024T055745633Z-p97929-63e73900-0003-gemini-output.json' },
  { thread: 'thread_1792822990468', anchor: 'black wide-leg knit trousers', wire: '20261024T062205474Z-p99897-deecea28-0002-gemini-wire.json', output: '20261024T062205474Z-p99897-deecea28-0003-gemini-output.json' },
  { thread: 'thread_1792823824264', anchor: 'black solid long shirt', wire: '20261024T063425667Z-p1826-0b563123-0002-gemini-wire.json', output: '20261024T063425667Z-p1826-0b563123-0003-gemini-output.json' },
]

export const GARMENT_READ_FIRST_INSTRUCTION = "READ THE GARMENT FIRST. Before composing, write `garment_read`: how you see the selected garment in its photograph and recorded facts — its weight, drape, line, volume, texture and character — and what that asks of the pieces worn with it. Then write `directions`: two to four distinct ways to wear this garment that the wardrobe shown can carry well, each a styling idea rather than a list of garments. Build each outfit from one direction and name it in that outfit's `direction`. Leave out a direction the wardrobe cannot carry well rather than building it weakly."

const sha256 = v => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex')
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'))
const clone = v => JSON.parse(JSON.stringify(v))
const PLACEHOLDER = /^\[redacted, (\d+) chars, sha256:([0-9a-f]{16}), saved images\/([0-9a-f]{64}\.(?:jpg|png|webp|gif))\]$/

// Rehydrates every image placeholder; verifies each file against the length and hash the capture recorded.
function rehydrate(request) {
  const images = []
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    if (typeof v === 'string') {
      const m = v.match(PLACEHOLDER)
      if (!m) return v
      const file = path.join(CAPTURES, 'images', m[3])
      if (!fs.existsSync(file)) throw new Error(`missing image ${m[3]}`)
      const b64 = fs.readFileSync(file).toString('base64')
      const full = sha256(b64)
      if (b64.length !== Number(m[1])) throw new Error(`image ${m[3]}: ${b64.length} chars, capture says ${m[1]}`)
      if (!full.startsWith(m[2]) || !m[3].startsWith(full)) throw new Error(`image ${m[3]}: sha mismatch`)
      images.push(full)
      return b64
    }
    return v
  }
  return { request: walk(request), images }
}

// The same redaction the capture applied, so a rehydrated request can be compared to the captured one.
function redact(v) {
  if (Array.isArray(v)) return v.map(redact)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, (k === 'data' && typeof x === 'string' && x.length > 200) ? `[redacted, ${x.length} chars, sha256:${sha256(x).slice(0, 16)}, saved images/${sha256(x)}.jpg]` : redact(x)]))
  return v
}

// Every JSON path where two values differ.
function diffPaths(a, b, at = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return []
  // A list of plain values (a schema's `required`) is one setting, not N.
  const plainList = v => Array.isArray(v) && v.every(x => x === null || typeof x !== 'object')
  if (plainList(a) || plainList(b)) return [at || '(root)']
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    return keys.flatMap(k => diffPaths(a[k], b[k], `${at}${Array.isArray(a) ? `[${k}]` : `.${k}`}`))
  }
  return [at || '(root)']
}

function readFirstSchema(schema) {
  const s = clone(schema)
  const outfits = s.properties.outfits
  outfits.items.properties = { direction: { type: 'string' }, ...outfits.items.properties }
  outfits.items.required = ['direction', ...outfits.items.required]
  s.properties = {
    garment_read: { type: 'string' },
    directions: {
      type: 'array', minItems: 2, maxItems: 4,
      items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, idea: { type: 'string' } }, required: ['name', 'idea'] },
    },
    ...s.properties,
  }
  s.required = ['garment_read', 'directions', ...s.required]
  return s
}

export function buildArms(control) {
  const B = clone(control)
  B.system_instruction = `${control.system_instruction}\n\n${GARMENT_READ_FIRST_INSTRUCTION}`
  B.response_format.schema = readFirstSchema(control.response_format.schema)
  B.generation_config.max_output_tokens = 3500
  const C = clone(control)
  C.generation_config.thinking_level = 'medium'
  C.generation_config.max_output_tokens = control.generation_config.max_output_tokens + 4000
  return { A: control, B, C }
}

const EXPECTED_DIFFS = {
  A: [],
  B: ['.system_instruction', '.response_format.schema.properties.garment_read', '.response_format.schema.properties.directions', '.response_format.schema.properties.outfits.items.properties.direction', '.response_format.schema.properties.outfits.items.required', '.response_format.schema.required', '.generation_config.max_output_tokens'],
  C: ['.generation_config.thinking_level', '.generation_config.max_output_tokens'],
}

// Pre-registered usage from each thread's captured call: inputs are identical across arms; output is
// estimated (B adds the read, C adds medium thinking). Gemini 3.5 Flash-Lite: $0.30/M in, $2.50/M out.
const EST_EXTRA_OUTPUT = { A: 0, B: 600, C: 2500 }
const usd = (inTok, outTok) => inTok * 0.30 / 1e6 + outTok * 2.5 / 1e6

export function preflight({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log
  const cells = []
  for (const t of THREADS) {
    const wire = readJson(path.join(CAPTURES, t.wire))
    const capturedOutput = readJson(path.join(CAPTURES, t.output))
    if (wire.subflow !== 'selected_piece_visual_composer' || wire.stage !== 'wire') throw new Error(`${t.wire}: not a selected-piece composer wire record`)
    if (capturedOutput.callId !== wire.callId) throw new Error(`${t.output}: callId does not pair with ${t.wire}`)
    if (sha256(wire.request) !== wire.requestSha256) throw new Error(`${t.wire}: capture does not match its own requestSha256`)
    if (!wire.request.system_instruction.includes('SELECTED-ANCHOR CONTRACT')) throw new Error(`${t.wire}: no selected-anchor contract`)
    const { request: control, images } = rehydrate(wire.request)
    if (sha256(redact(control)) !== wire.requestSha256) throw new Error(`${t.thread}: rehydrated control does not reproduce the captured request`)
    const arms = buildArms(control)
    const capturedUsage = (() => { try { return JSON.parse(capturedOutput.output) && null } catch { return null } })()
    log(`\n━━ ${t.thread} — ${t.anchor}`)
    log(`   capture ${t.wire}  requestSha256 ${wire.requestSha256.slice(0, 16)}… verified; ${images.length} images rehydrated (all length+sha checked)`)
    for (const [arm, req] of Object.entries(arms)) {
      const diffs = diffPaths(redact(control), redact(req))
      const expected = EXPECTED_DIFFS[arm]
      const ok = diffs.length === expected.length && diffs.every(d => expected.includes(d))
      if (!ok) throw new Error(`${t.thread} arm ${arm}: unexpected diff\n  got ${JSON.stringify(diffs)}\n  expected ${JSON.stringify(expected)}`)
      log(`   arm ${arm}: ${diffs.length ? diffs.join(', ') : 'identical to the captured request'}  ✓`)
      cells.push({ thread: t.thread, anchor: t.anchor, arm, request: req, identitySha256: sha256(redact(req)) })
    }
    void capturedUsage
  }
  return cells
}

function printDryRun(cells) {
  const t0 = cells.filter(c => c.thread === THREADS[0].thread)
  const [A, B, C] = ['A', 'B', 'C'].map(a => t0.find(c => c.arm === a).request)
  console.log('\n━━ Arm B, exact additions (same for all three threads)')
  console.log('   system_instruction += "\\n\\n" +')
  console.log(`   ${GARMENT_READ_FIRST_INSTRUCTION}`)
  console.log('   schema, top level (written first):')
  console.log(`     garment_read: ${JSON.stringify(B.response_format.schema.properties.garment_read)}`)
  console.log(`     directions:   ${JSON.stringify(B.response_format.schema.properties.directions)}`)
  console.log(`   schema, each outfit (first field): direction: ${JSON.stringify(B.response_format.schema.properties.outfits.items.properties.direction)}`)
  console.log(`   property order, top level: ${Object.keys(B.response_format.schema.properties).join(' → ')}`)
  console.log(`   property order, outfit:    ${Object.keys(B.response_format.schema.properties.outfits.items.properties).slice(0, 4).join(' → ')} → …`)
  console.log(`   generation_config: ${JSON.stringify(A.generation_config)} → ${JSON.stringify(B.generation_config)}`)
  console.log('\n━━ Arm C, exact change')
  console.log(`   generation_config: ${JSON.stringify(A.generation_config)} → ${JSON.stringify(C.generation_config)}`)
  console.log(`\n━━ Plan: ${THREADS.length} threads × 3 arms × ${REPS} replicates = ${THREADS.length * 3 * REPS} calls`)
  let total = 0
  for (const t of THREADS) {
    const p = readJson(path.join(REPO, 'scratch/garment_read_runs/captured_usage.json'))[t.thread]
    for (const arm of ['A', 'B', 'C']) total += REPS * usd(p.inputTokens, p.outputTokens + EST_EXTRA_OUTPUT[arm])
  }
  console.log(`   estimated cost ≈ $${total.toFixed(3)} (captured input tokens; output estimated A +0, B +600, C +2500)`)
}

// Counterbalanced, seeded order: each replicate runs every thread×arm once, arm order rotated per thread.
function runOrder() {
  const order = []
  const rotations = [['A', 'B', 'C'], ['B', 'C', 'A'], ['C', 'A', 'B']]
  for (let rep = 1; rep <= REPS; rep++) {
    THREADS.forEach((t, i) => {
      const arms = rep % 2 ? rotations[i % 3] : [...rotations[i % 3]].reverse()
      for (const arm of arms) order.push({ thread: t.thread, arm, rep })
    })
  }
  return order
}

async function callGemini(request) {
  const env = fs.readFileSync(path.join(REPO, '.env'), 'utf8')
  const key = env.match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
  if (!key) throw new Error('GEMINI_API_KEY not in .env')
  const { GoogleGenAI } = await import('@google/genai')
  const ai = new GoogleGenAI({ apiKey: key })
  const started = Date.now()
  const interaction = await ai.interactions.create(request)
  const text = (interaction.steps || [])
    .filter(s => s.type === 'model_output')
    .map(o => (o.content || []).filter(c => c.type === 'text').map(c => c.text).join(''))
    .join('\n\n').trim() || String(interaction.output_text || '').trim()
  return { text, status: interaction.status, usage: interaction.usage, latencyMs: Date.now() - started }
}

const cells = preflight()
if (!RUN) {
  printDryRun(cells)
  console.log('\nDry run only — no model calls made. Re-run with --run --reps N to send.')
  process.exit(0)
}

fs.mkdirSync(OUT, { recursive: true })
const order = runOrder()
const manifest = { experiment: 'garment-read-first', design: 'docs/garment-read-first-composer-design.md', model: 'gemini-3.5-flash-lite', reps: REPS, startedAt: new Date().toISOString(), instruction: GARMENT_READ_FIRST_INSTRUCTION, cells: order.map(o => ({ ...o, identitySha256: cells.find(c => c.thread === o.thread && c.arm === o.arm).identitySha256 })) }
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
let spent = 0
for (const [i, o] of order.entries()) {
  const file = path.join(OUT, `${o.thread}__${o.arm}__r${o.rep}.json`)
  if (fs.existsSync(file)) { console.log(`skip (done) ${path.basename(file)}`); continue }
  const cell = cells.find(c => c.thread === o.thread && c.arm === o.arm)
  let result
  try {
    result = await callGemini(cell.request)
  } catch (err) {
    result = { error: err?.message || String(err) }
  }
  let parsed = null, parseError = null
  if (result.text) { try { parsed = JSON.parse(result.text) } catch (e) { parseError = e.message } }
  const u = result.usage || {}
  const cost = usd(u.total_input_tokens || 0, (u.total_output_tokens || 0) + (u.total_thought_tokens || 0))
  spent += cost
  fs.writeFileSync(file, JSON.stringify({ ...o, identitySha256: cell.identitySha256, ...result, parsed, parseError, estimatedUsd: cost }, null, 2))
  console.log(`${String(i + 1).padStart(2)}/${order.length} ${o.thread} ${o.arm} r${o.rep}: ${result.error ? `ERROR ${result.error}` : `${parsed?.outfits?.length ?? 'unparsed'} cards, ${u.total_output_tokens} out + ${u.total_thought_tokens || 0} thought, ${result.latencyMs}ms, $${cost.toFixed(4)}`}`)
}
console.log(`\nDone. Spent ≈ $${spent.toFixed(3)}. Outputs in ${OUT}`)
