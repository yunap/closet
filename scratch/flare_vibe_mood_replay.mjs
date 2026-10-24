// Three-way composer replay on the captured flare-jeans first turn (thread_1792867254713,
// capture 20261024T183548752Z-p23819-67fd7368-0005). Same roster, photos, schema and model:
//   A as_is        — the captured request
//   B no_columns   — "clean columns" removed from the city occasion vibe (request line + profile JSON)
//   C mood         — a Mood line asking for more interesting outfits, placed where the composer puts it
// usage: node scratch/flare_vibe_mood_replay.mjs                 preflight + dry run
//        node scratch/flare_vibe_mood_replay.mjs --run --reps 2  paid calls
//        node scratch/flare_vibe_mood_replay.mjs --sheet         blinded hanger-photo sheet
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CAP = path.join(os.homedir(), '.wardrobe-captures')
const WIRE = '20261024T183548752Z-p23819-67fd7368-0005-gemini-wire.json'
const OUT = path.join(REPO, 'scratch/garment_read_runs/2026-10-24/flare_vibe_mood')
const args = process.argv.slice(2)
const REPS = Number(args[args.indexOf('--reps') + 1]) || 2
export const MOOD_TEXT = 'more interesting outfits, not just safe black columns'
const VIBE_OLD = 'polished, comfortable, walk-friendly, clean columns'
const VIBE_NEW = 'polished, comfortable, walk-friendly'
const sha256 = v => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex')
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'))
const PLACEHOLDER = /^\[redacted, (\d+) chars, sha256:([0-9a-f]{16}), saved images\/([0-9a-f]{64}\.\w+)\]$/
const rehydrate = v => Array.isArray(v) ? v.map(rehydrate) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rehydrate(x)])) : (typeof v === 'string' && PLACEHOLDER.test(v)) ? (() => {
  const m = v.match(PLACEHOLDER); const b64 = fs.readFileSync(path.join(CAP, 'images', m[3])).toString('base64')
  if (b64.length !== Number(m[1]) || !sha256(b64).startsWith(m[2])) throw new Error(`image ${m[3]} does not match its capture`)
  return b64
})() : v
const clone = v => JSON.parse(JSON.stringify(v))

function arms() {
  const wire = readJson(path.join(CAP, WIRE))
  if (wire.subflow !== 'selected_piece_visual_composer' || sha256(wire.request) !== wire.requestSha256) throw new Error('capture is not an intact selected-piece composer request')
  const A = rehydrate(wire.request)
  const once = (text, find) => { const n = text.split(find).length - 1; if (n !== 1) throw new Error(`"${find}" occurs ${n} times, expected 1`); return text }
  const B = clone(A)
  B.system_instruction = once(B.system_instruction, `"vibe": "${VIBE_OLD}"`).replace(`"vibe": "${VIBE_OLD}"`, `"vibe": "${VIBE_NEW}"`)
  const bi = B.input.findIndex(p => p.type === 'text' && p.text.includes(`Occasion vibe: ${VIBE_OLD}`))
  B.input[bi].text = once(B.input[bi].text, `Occasion vibe: ${VIBE_OLD}`).replace(`Occasion vibe: ${VIBE_OLD}`, `Occasion vibe: ${VIBE_NEW}`)
  const C = clone(A)
  C.input[0].text = once(C.input[0].text, '\nSeason: current season\n').replace('\nSeason: current season\n', `\nSeason: current season\nMood: ${MOOD_TEXT}\n`)
  return { wire, A, B, C }
}
const NAMES = { A: 'as_is', B: 'no_clean_columns', C: 'mood_request' }

if (args.includes('--sheet')) {
  const rows = new Map(JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', path.join(REPO, 'wardrobe.db'), 'SELECT id, name, photo FROM pieces'], { encoding: 'utf8', maxBuffer: 64 << 20 })).map(r => [Number(r.id), r]))
  const thumbs = fs.mkdtempSync(path.join(os.tmpdir(), 'flare-sheet-')); process.on('exit', () => fs.rmSync(thumbs, { recursive: true, force: true }))
  const images = new Map()
  const img = id => { const file = rows.get(Number(id))?.photo; const src = file && path.join(REPO, 'uploads', file); if (!src || !fs.existsSync(src)) return ''; if (!images.has(file)) { const out = path.join(thumbs, `${images.size}.jpg`); execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', '360', src, '--out', out], { stdio: 'ignore' }); images.set(file, `data:image/jpeg;base64,${fs.readFileSync(out).toString('base64')}`) } return file }
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const SLOTS = [['base_top_id', 'top'], ['dress_id', 'dress'], ['bottom_id', 'bottom'], ['middle_layer_id', 'layer'], ['outer_layer_id', 'outer'], ['shoes_id', 'shoes']]
  const cells = fs.readdirSync(OUT).filter(f => /^[ABC]__r\d+\.json$/.test(f)).map(f => readJson(path.join(OUT, f))).filter(c => c.parsed?.outfits?.length)
  let h = crypto.createHash('sha256').update('flare-vibe-mood').digest(); const order = [...cells]
  for (let i = order.length - 1; i > 0; i--) { const j = h[i % 32] % (i + 1); [order[i], order[j]] = [order[j], order[i]] }
  const sel = (k, o) => `<select data-k="${k}"><option></option>${o.map(x => `<option>${x}</option>`).join('')}</select>`
  const key = {}
  const body = order.map((c, si) => {
    const id = `set${si + 1}`; key[id] = { arm: c.arm, version: NAMES[c.arm], rep: c.rep }
    return `<div class="set"><h3>Set ${si + 1}</h3><div class="cards">${c.parsed.outfits.map((o, ci) => `<div class="card"><h4>${esc(o.label)}</h4><div class="pieces">${SLOTS.filter(([k]) => o[k] != null).map(([k, role]) => `<figure class="pc"><img data-img="${esc(img(o[k]))}" alt=""><figcaption><b>${role}</b> ${esc(rows.get(Number(o[k]))?.name)}${Number(o[k]) === 106 ? ' <i>(anchor)</i>' : ''}</figcaption></figure>`).join('')}</div><p><b>Why it works:</b> ${esc(o.reason)}</p>${o.styling_instructions ? `<p><b>How to wear:</b> ${esc(o.styling_instructions)}</p>` : ''}<p><b>Watch for:</b> ${esc(o.watchFor)}</p><label>Card rating ${sel(`${id}.card${ci + 1}`, [1, 2, 3, 4, 5])}</label></div>`).join('')}</div>
<div class="setq"><label>Set rating ${sel(`${id}.set`, [1, 2, 3, 4, 5])}</label><label>Interesting, not just safe? ${sel(`${id}.interesting`, ['yes', 'partly', 'no'])}</label><label style="flex:1">Note <textarea data-k="${id}.note"></textarea></label></div></div>`
  }).join('')
  const title = 'Flare jeans — blinded'
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>:root{--bg:#fbfaf7;--fg:#222;--muted:#666;--line:#ddd;--card:#fff;--accent:#5a4632}@media (prefers-color-scheme:dark){:root{--bg:#1b1a18;--fg:#eee;--muted:#aaa;--line:#444;--card:#262420;--accent:#d8b98f}}body{background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif;padding:16px;max-width:1100px;margin:0 auto}h3{color:var(--accent)}.set{border:1px solid var(--line);border-radius:10px;padding:12px;margin:18px 0;background:var(--card)}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}.card{border:1px solid var(--line);border-radius:8px;padding:10px}.card h4{margin:0 0 6px}.card p{margin:6px 0;font-size:14px}.pieces{display:flex;flex-wrap:wrap;gap:6px}.pc{margin:0;width:88px;font-size:11px;color:var(--muted)}.pc img{width:88px;height:110px;object-fit:contain;border-radius:4px;background:#fff}.setq{display:flex;flex-wrap:wrap;gap:16px;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)}textarea{width:100%;min-height:40px;font:inherit}.bar{position:sticky;top:0;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--line);z-index:2}button{font:inherit;padding:6px 12px}</style></head><body><div class="bar"><button id="copy">Copy ratings as JSON</button> <span id="msg"></span></div><h1>${title}</h1><p>${order.length} sets of first-turn outfits for the black flare leg denim pants, in a shuffled order. Rate each card and each set. Nothing on the page says how a set was made. When you're done, copy your ratings and paste them into the chat.</p>${body}<script>const IMG=${JSON.stringify(Object.fromEntries(images))};document.querySelectorAll('img[data-img]').forEach(i=>{const s=IMG[i.dataset.img];if(s)i.src=s});const KEY='${title}';let st={};try{st=JSON.parse(localStorage.getItem(KEY)||'{}')}catch{}document.querySelectorAll('[data-k]').forEach(el=>{if(st[el.dataset.k]!=null)el.value=st[el.dataset.k];el.addEventListener('change',()=>{st[el.dataset.k]=el.value;try{localStorage.setItem(KEY,JSON.stringify(st))}catch{}})});document.getElementById('copy').onclick=async()=>{const t=JSON.stringify(st,null,1);try{await navigator.clipboard.writeText(t);msg.textContent='Copied. Paste it into the chat.'}catch{prompt('Copy this:',t)}};</script></body></html>`
  fs.writeFileSync(path.join(OUT, 'flare_comparison.html'), html); fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 2))
  console.log(`sheet → ${path.join(OUT, 'flare_comparison.html')} (${order.length} sets, ${images.size} images)`)
  process.exit(0)
}

const { A, B, C } = arms()
const diff = (x, y) => { const out = []; if (x.system_instruction !== y.system_instruction) out.push('system_instruction'); x.input.forEach((p, i) => { if (JSON.stringify(p) !== JSON.stringify(y.input[i])) out.push(`input[${i}]`) }); for (const k of ['model', 'generation_config', 'response_format']) if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) out.push(k); return out }
console.log(`capture ${WIRE} verified; ${A.input.filter(p => p.type === 'image').length} photos rehydrated`)
console.log(`B vs A differs in: ${diff(A, B).join(', ')}  ("${VIBE_OLD}" → "${VIBE_NEW}", twice)`)
console.log(`C vs A differs in: ${diff(A, C).join(', ')}  (adds "Mood: ${MOOD_TEXT}")`)
if (!args.includes('--run')) { console.log(`\nPlan: 3 versions × ${REPS} = ${3 * REPS} composer calls, ≈ $${(3 * REPS * 0.0135).toFixed(3)}. Dry run only.`); process.exit(0) }

const env = Object.fromEntries(fs.readFileSync(path.join(REPO, '.env'), 'utf8').split('\n').map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]))
const { GoogleGenAI } = await import('@google/genai')
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY })
fs.mkdirSync(OUT, { recursive: true })
let spent = 0
const reqs = { A, B, C }
for (let rep = 1; rep <= REPS; rep++) for (const arm of rep % 2 ? ['A', 'B', 'C'] : ['C', 'B', 'A']) {
  const file = path.join(OUT, `${arm}__r${rep}.json`); if (fs.existsSync(file)) { console.log(`skip ${path.basename(file)}`); continue }
  const it = await ai.interactions.create(reqs[arm])
  const text = (it.steps || []).filter(s => s.type === 'model_output').map(o => (o.content || []).filter(c => c.type === 'text').map(c => c.text).join('')).join('').trim() || String(it.output_text || '')
  const u = it.usage || {}; const cost = (u.total_input_tokens || 0) * 0.3e-6 + ((u.total_output_tokens || 0) + (u.total_thought_tokens || 0)) * 2.5e-6; spent += cost
  let parsed = null; try { parsed = JSON.parse(text) } catch {}
  fs.writeFileSync(file, JSON.stringify({ arm, version: NAMES[arm], rep, text, parsed, usage: u, cost }, null, 2))
  console.log(`${arm} ${NAMES[arm]} r${rep}: ${parsed?.outfits?.length ?? 'unparsed'} cards $${cost.toFixed(4)} | ${(parsed?.outfits || []).map(o => o.label).join(' / ')}`)
}
console.log(`spent ≈ $${spent.toFixed(3)}`)
