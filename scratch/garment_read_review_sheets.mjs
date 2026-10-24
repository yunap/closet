// Blinded review sheets for the garment-read-first replay (docs/garment-read-first-composer-design.md §5).
// Part 1 (part1_cards.html): per thread, all six sets (3 arms × 2 replicates) in a seeded shuffled order,
//   cards only — no garment_read, directions, direction or layering_check, so nothing names the arm.
// Part 2 (part2_reads.html): arm B's reads and directions with their cards, for the read-validity questions.
//   It reveals which sets were B, so it is opened only after Part 1 is rated.
// key.json maps set numbers back to arms. Ratings are kept in the page and copied out as JSON.
// usage: node scratch/garment_read_review_sheets.mjs
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CAPTURES = path.join(os.homedir(), '.wardrobe-captures')
const RUNS = path.join(REPO, 'scratch/garment_read_runs/2026-10-24')
const OUT = path.join(RUNS, 'sheets')
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'))
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const THREADS = [
  { thread: 'thread_1792821629010', anchor: 'olive utility skinny pants', wire: '20261024T055745633Z-p97929-63e73900-0002-gemini-wire.json' },
  { thread: 'thread_1792822990468', anchor: 'black wide-leg knit trousers', wire: '20261024T062205474Z-p99897-deecea28-0002-gemini-wire.json' },
  { thread: 'thread_1792823824264', anchor: 'black solid long shirt', wire: '20261024T063425667Z-p1826-0b563123-0002-gemini-wire.json' },
]
const SLOTS = [['base_top_id', 'top'], ['dress_id', 'dress'], ['bottom_id', 'bottom'], ['middle_layer_id', 'layer'], ['outer_layer_id', 'outer'], ['shoes_id', 'shoes']]

// Garment ID → name and photo, from the labels the composer itself was shown (each label precedes its image).
function rosterFor(wireFile) {
  const input = readJson(path.join(CAPTURES, wireFile)).request.input
  const roster = new Map()
  input.forEach((part, i) => {
    const m = part.type === 'text' && part.text.match(/^(SELECTED ANCHOR|SUPPORT) ID (\d+): ([^;]+);/)
    if (!m) return
    const img = input[i + 1]?.type === 'image' && input[i + 1].data.match(/saved images\/([0-9a-f]{64}\.\w+)\]/)?.[1]
    roster.set(Number(m[2]), { id: Number(m[2]), name: m[3].trim(), image: img || null, anchor: m[1] === 'SELECTED ANCHOR' })
  })
  return roster
}

// Deterministic shuffle so the sheet and its key can always be regenerated identically.
function seededShuffle(list, seed) {
  const out = [...list]
  let h = crypto.createHash('sha256').update(seed).digest()
  for (let i = out.length - 1; i > 0; i--) {
    if (i % 8 === 0) h = crypto.createHash('sha256').update(h).digest()
    const j = h[i % 32] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// The sheets show each garment's hanger photo (pieces.photo), which is how the owner rates; the composer
// itself was sent the worn photo where one exists. Read-only sqlite3 CLI, no db.js; shrunk with sips.
const THUMBS = fs.mkdtempSync(path.join(os.tmpdir(), 'garment-read-thumbs-'))
process.on('exit', () => fs.rmSync(THUMBS, { recursive: true, force: true }))
const hangerPhoto = new Map(JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', path.join(REPO, 'wardrobe.db'), 'SELECT id, photo FROM pieces'], { encoding: 'utf8', maxBuffer: 64 << 20 }) || '[]').map(r => [Number(r.id), r.photo]))
const images = new Map()
function imgRef(id) {
  const file = hangerPhoto.get(Number(id))
  const src = file && path.join(REPO, 'uploads', file)
  if (!src || !fs.existsSync(src)) return ''
  if (!images.has(file)) {
    const out = path.join(THUMBS, `${images.size}.jpg`)
    execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', '360', src, '--out', out], { stdio: 'ignore' })
    images.set(file, `data:image/jpeg;base64,${fs.readFileSync(out).toString('base64')}`)
  }
  return file
}

function cardHtml(card, roster, setId, ci) {
  const pieces = SLOTS.filter(([k]) => card[k] != null).map(([k, role]) => {
    const p = roster.get(Number(card[k]))
    return `<figure class="pc"><img data-img="${esc(imgRef(card[k]))}" alt=""><figcaption><b>${esc(role)}</b> ${esc(p?.name || `unknown ID ${card[k]}`)}${p?.anchor ? ' <i>(anchor)</i>' : ''}</figcaption></figure>`
  }).join('')
  return `<div class="card"><h4>${esc(card.label)}</h4><div class="pieces">${pieces}</div>
<p><b>Why it works:</b> ${esc(card.reason)}</p>${card.styling_instructions ? `<p><b>How to wear:</b> ${esc(card.styling_instructions)}</p>` : ''}<p><b>Watch for:</b> ${esc(card.watchFor)}</p>
<label class="rate">Card rating <select data-k="${setId}.card${ci + 1}"><option></option>${[1, 2, 3, 4, 5].map(n => `<option>${n}</option>`).join('')}</select></label></div>`
}

const PAGE = (title, intro, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#fbfaf7;--fg:#222;--muted:#666;--line:#ddd;--card:#fff;--accent:#5a4632}
@media (prefers-color-scheme:dark){:root{--bg:#1b1a18;--fg:#eee;--muted:#aaa;--line:#444;--card:#262420;--accent:#d8b98f}}
body{background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif;margin:0;padding:16px;max-width:1100px;margin-inline:auto}
h1{font-size:22px}h2{margin-top:40px;border-bottom:2px solid var(--accent);padding-bottom:4px}h3{color:var(--accent)}
.set{border:1px solid var(--line);border-radius:10px;padding:12px;margin:18px 0;background:var(--card)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.card{border:1px solid var(--line);border-radius:8px;padding:10px}.card h4{margin:0 0 6px}.card p{margin:6px 0;font-size:14px}
.pieces{display:flex;flex-wrap:wrap;gap:6px}.pc{margin:0;width:88px;font-size:11px;color:var(--muted)}.pc img{width:88px;height:110px;object-fit:contain;border-radius:4px;background:#fff}
.setq{display:flex;flex-wrap:wrap;gap:16px;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)}
select,textarea{font:inherit}textarea{width:100%;min-height:40px}.read{background:var(--bg);padding:10px;border-radius:8px}
.bar{position:sticky;top:0;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--line);z-index:2}
button{font:inherit;padding:6px 12px}
</style></head><body><div class="bar"><button id="copy">Copy ratings as JSON</button> <span id="msg"></span></div>
<h1>${esc(title)}</h1>${intro}${body}
<script>
const IMG=__IMAGES__;
document.querySelectorAll('img[data-img]').forEach(i=>{const s=IMG[i.dataset.img];if(s)i.src=s});
const KEY='${esc(title)}';let st={};try{st=JSON.parse(localStorage.getItem(KEY)||'{}')}catch{}
document.querySelectorAll('[data-k]').forEach(el=>{if(st[el.dataset.k]!=null)el.value=st[el.dataset.k];el.addEventListener('change',()=>{st[el.dataset.k]=el.value;try{localStorage.setItem(KEY,JSON.stringify(st))}catch{}})});
document.getElementById('copy').onclick=async()=>{const t=JSON.stringify(st,null,1);try{await navigator.clipboard.writeText(t);msg.textContent='Copied — paste it into the chat.'}catch{prompt('Copy this:',t)}};
</script></body></html>`

const sel = (k, opts) => `<select data-k="${k}"><option></option>${opts.map(o => `<option>${o}</option>`).join('')}</select>`

fs.mkdirSync(OUT, { recursive: true })
const key = {}
let part1 = '', part2 = ''
for (const t of THREADS) {
  const roster = rosterFor(t.wire)
  const cells = fs.readdirSync(RUNS).filter(f => f.startsWith(`${t.thread}__`) && f.endsWith('.json')).map(f => readJson(path.join(RUNS, f)))
  const order = seededShuffle(cells.map(c => `${c.arm}|${c.rep}`).sort(), `garment-read-first:${t.thread}`)
  const anchor = [...roster.values()].find(p => p.anchor)
  part1 += `<h2>${esc(t.anchor)}</h2><figure class="pc" style="width:120px"><img data-img="${esc(imgRef(anchor?.id))}" style="width:120px;height:150px" alt=""></figure>`
  order.forEach((armRep, si) => {
    const c = cells.find(x => `${x.arm}|${x.rep}` === armRep)
    const setId = `${t.thread}.set${si + 1}`
    key[setId] = { arm: c.arm, rep: c.rep }
    const outfits = c.parsed?.outfits || []
    part1 += `<div class="set"><h3>Set ${si + 1}</h3>${outfits.length ? `<div class="cards">${outfits.map((o, ci) => cardHtml(o, roster, setId, ci)).join('')}</div>` : `<p><i>No cards: ${esc(c.error || c.parseError || 'empty answer')}</i></p>`}
<div class="setq"><label>Set rating ${sel(`${setId}.set`, [1, 2, 3, 4, 5])}</label><label>Distinct directions? ${sel(`${setId}.distinct`, ['yes', 'partly', 'no'])}</label><label style="flex:1">Note <textarea data-k="${setId}.note"></textarea></label></div></div>`
    if (c.arm === 'B') {
      const p = c.parsed || {}
      part2 += `<div class="set"><h3>${esc(t.anchor)} — Set ${si + 1}</h3><div class="read"><p><b>Garment read:</b> ${esc(p.garment_read)}</p><p><b>Directions:</b></p><ul>${(p.directions || []).map(d => `<li><b>${esc(d.name)}</b> — ${esc(d.idea)}</li>`).join('')}</ul></div>
<div class="cards">${(p.outfits || []).map(o => `<div class="card"><h4>${esc(o.label)}</h4><p><b>Builds direction:</b> ${esc(o.direction)}</p><div class="pieces">${SLOTS.filter(([k]) => o[k] != null).map(([k, role]) => { const r = roster.get(Number(o[k])); return `<figure class="pc"><img data-img="${esc(imgRef(o[k]))}" alt=""><figcaption><b>${role}</b> ${esc(r?.name)}</figcaption></figure>` }).join('')}</div></div>`).join('')}</div>
<div class="setq"><label>Read true to the garment? ${sel(`${setId}.readTrue`, ['yes', 'partly', 'no'])}</label><label>Cards follow the read, or the read rationalizes them? ${sel(`${setId}.follows`, ['follows', 'rationalizes', 'unsure'])}</label><label style="flex:1">Note <textarea data-k="${setId}.readNote"></textarea></label></div></div>`
    }
  })
}
const imgJson = JSON.stringify(Object.fromEntries(images))
fs.writeFileSync(path.join(OUT, 'part1_cards.html'), PAGE('Garment read — Part 1: cards (blinded)', `<p>Three garments, six sets each, in a shuffled order. Rate each card and each set as you would in the app. Nothing on this page says how a set was made. Copy your ratings and paste them into the chat when you're done, then open Part 2.</p>`, part1).replace('__IMAGES__', imgJson))
fs.writeFileSync(path.join(OUT, 'part2_reads.html'), PAGE('Garment read — Part 2: the reads', `<p>Open only after rating Part 1. These are the sets where the stylist first wrote how she sees the garment and named directions. For each one: is the read true to the garment, and do the cards follow it, or does the read just justify them?</p>`, part2).replace('__IMAGES__', imgJson))
fs.writeFileSync(path.join(RUNS, 'key.json'), JSON.stringify(key, null, 2))
console.log(`sheets → ${OUT}\n  part1_cards.html  part2_reads.html  (${images.size} images embedded)\nkey → ${path.join(RUNS, 'key.json')}`)
