// Blinded sheet: per anchor, the two control sets from the garment-read replay (arm A, the old
// code-ranked roster) and the live set with the stylist-chosen roster, in a seeded shuffle.
// Hanger photos (pieces.photo), read-only sqlite3; key.json maps sets back to their source.
// usage: node scratch/selected_piece_roster_live_sheets.mjs          controls vs live (live_roster/)
//        node scratch/selected_piece_roster_live_sheets.mjs v2       live vs live with the shortlist wording (live_roster_v2/)
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUNS = path.join(REPO, 'scratch/garment_read_runs/2026-10-24')
const V2 = process.argv[2] === 'v2'
const OUT = path.join(RUNS, V2 ? 'live_roster_v2' : 'live_roster')
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'))
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const THREADS = [
  { thread: 'thread_1792821629010', anchor: 'olive utility skinny pants' },
  { thread: 'thread_1792822990468', anchor: 'black wide-leg knit trousers' },
  { thread: 'thread_1792823824264', anchor: 'black solid long shirt' },
]
const rows = new Map(JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', path.join(REPO, 'wardrobe.db'), 'SELECT id, name, photo FROM pieces'], { encoding: 'utf8', maxBuffer: 64 << 20 })).map(r => [Number(r.id), r]))
const THUMBS = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-sheet-thumbs-'))
process.on('exit', () => fs.rmSync(THUMBS, { recursive: true, force: true }))
const images = new Map()
function img(id) {
  const file = rows.get(Number(id))?.photo
  const src = file && path.join(REPO, 'uploads', file)
  if (!src || !fs.existsSync(src)) return ''
  if (!images.has(file)) {
    const out = path.join(THUMBS, `${images.size}.jpg`)
    execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', '360', src, '--out', out], { stdio: 'ignore' })
    images.set(file, `data:image/jpeg;base64,${fs.readFileSync(out).toString('base64')}`)
  }
  return file
}
const SLOTS = [['base_top_id', 'top'], ['dress_id', 'dress'], ['bottom_id', 'bottom'], ['middle_layer_id', 'layer'], ['outer_layer_id', 'outer'], ['shoes_id', 'shoes']]
// Both sources reduced to the same card shape: label, ordered [role, id], why, how, watch.
const fromReplay = o => ({ label: o.label, pieces: SLOTS.filter(([k]) => o[k] != null).map(([k, role]) => [role, o[k]]), reason: o.reason, how: o.styling_instructions, watch: o.watchFor })
const roleName = { primary_top: 'top', layer_top: 'layer', primary_bottom: 'bottom', dress: 'dress', outerwear: 'outer', shoes: 'shoes' }
const fromLive = o => ({ label: o.label, pieces: (o.pieces || []).map(p => [roleName[p.role] || p.category, p.id]), reason: o.reason || o.why, how: o.stylingInstructions || o.styling_instructions, watch: o.watchFor, broken: o.broken })
function shuffle(list, seed) {
  const out = [...list]; let h = crypto.createHash('sha256').update(seed).digest()
  for (let i = out.length - 1; i > 0; i--) { const j = h[i % 32] % (i + 1); [out[i], out[j]] = [out[j], out[i]] }
  return out
}
const sel = (k, opts) => `<select data-k="${k}"><option></option>${opts.map(o => `<option>${o}</option>`).join('')}</select>`
const key = {}
let body = ''
for (const t of THREADS) {
  const live = readJson(path.join(OUT, `${t.thread}.json`)).result
  const sets = V2 ? [
    { source: 'live_v1_up_to_40', cards: readJson(path.join(RUNS, 'live_roster', `${t.thread}.json`)).result.structuredOutfits.map(fromLive) },
    { source: 'live_v2_shortlist', cards: live.structuredOutfits.map(fromLive) },
  ] : [
    { source: 'control_r1', cards: readJson(path.join(RUNS, `${t.thread}__A__r1.json`)).parsed.outfits.map(fromReplay) },
    { source: 'control_r2', cards: readJson(path.join(RUNS, `${t.thread}__A__r2.json`)).parsed.outfits.map(fromReplay) },
    { source: 'stylist_roster', cards: live.structuredOutfits.map(fromLive) },
  ]
  const anchorId = live.structuredOutfits[0]?.selectedPieceId
  body += `<h2>${esc(t.anchor)}</h2><figure class="pc" style="width:120px"><img data-img="${esc(img(anchorId))}" style="width:120px;height:150px" alt=""></figure>`
  shuffle(sets, `${V2 ? 'roster-live-v2' : 'roster-live'}:${t.thread}`).forEach((set, si) => {
    const setId = `${t.thread}.set${si + 1}`
    key[setId] = set.source
    body += `<div class="set"><h3>Set ${si + 1}</h3><div class="cards">${set.cards.map((c, ci) => `<div class="card"><h4>${esc(c.label)}${c.broken ? ' <i>(needs review)</i>' : ''}</h4><div class="pieces">${c.pieces.map(([role, id]) => `<figure class="pc"><img data-img="${esc(img(id))}" alt=""><figcaption><b>${esc(role)}</b> ${esc(rows.get(Number(id))?.name)}${Number(id) === Number(anchorId) ? ' <i>(anchor)</i>' : ''}</figcaption></figure>`).join('')}</div>
<p><b>Why it works:</b> ${esc(c.reason)}</p>${c.how ? `<p><b>How to wear:</b> ${esc(c.how)}</p>` : ''}${c.watch ? `<p><b>Watch for:</b> ${esc(c.watch)}</p>` : ''}
<label>Card rating ${sel(`${setId}.card${ci + 1}`, [1, 2, 3, 4, 5])}</label></div>`).join('')}</div>
<div class="setq"><label>Set rating ${sel(`${setId}.set`, [1, 2, 3, 4, 5])}</label><label>Distinct directions? ${sel(`${setId}.distinct`, ['yes', 'partly', 'no'])}</label><label style="flex:1">Note <textarea data-k="${setId}.note"></textarea></label></div></div>`
  })
}
const title = V2 ? 'Roster comparison 2 — blinded' : 'Roster comparison — blinded'
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>:root{--bg:#fbfaf7;--fg:#222;--muted:#666;--line:#ddd;--card:#fff;--accent:#5a4632}
@media (prefers-color-scheme:dark){:root{--bg:#1b1a18;--fg:#eee;--muted:#aaa;--line:#444;--card:#262420;--accent:#d8b98f}}
body{background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif;padding:16px;max-width:1100px;margin:0 auto}
h2{margin-top:40px;border-bottom:2px solid var(--accent);padding-bottom:4px}h3{color:var(--accent)}
.set{border:1px solid var(--line);border-radius:10px;padding:12px;margin:18px 0;background:var(--card)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}.card{border:1px solid var(--line);border-radius:8px;padding:10px}.card h4{margin:0 0 6px}.card p{margin:6px 0;font-size:14px}
.pieces{display:flex;flex-wrap:wrap;gap:6px}.pc{margin:0;width:88px;font-size:11px;color:var(--muted)}.pc img{width:88px;height:110px;object-fit:contain;border-radius:4px;background:#fff}
.setq{display:flex;flex-wrap:wrap;gap:16px;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)}textarea{width:100%;min-height:40px;font:inherit}
.bar{position:sticky;top:0;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--line);z-index:2}button{font:inherit;padding:6px 12px}</style></head><body>
<div class="bar"><button id="copy">Copy ratings as JSON</button> <span id="msg"></span></div>
<h1>${title}</h1><p>Three garments, ${V2 ? 'two' : 'three'} sets each, in a shuffled order. Rate each card and each set as you would in the app. Nothing on the page says how a set was made. When you're done, copy your ratings and paste them into the chat.</p>${body}
<script>const IMG=${JSON.stringify(Object.fromEntries(images))};document.querySelectorAll('img[data-img]').forEach(i=>{const s=IMG[i.dataset.img];if(s)i.src=s});
const KEY='${title}';let st={};try{st=JSON.parse(localStorage.getItem(KEY)||'{}')}catch{}
document.querySelectorAll('[data-k]').forEach(el=>{if(st[el.dataset.k]!=null)el.value=st[el.dataset.k];el.addEventListener('change',()=>{st[el.dataset.k]=el.value;try{localStorage.setItem(KEY,JSON.stringify(st))}catch{}})});
document.getElementById('copy').onclick=async()=>{const t=JSON.stringify(st,null,1);try{await navigator.clipboard.writeText(t);msg.textContent='Copied. Paste it into the chat.'}catch{prompt('Copy this:',t)}};</script></body></html>`
fs.writeFileSync(path.join(OUT, V2 ? 'roster_comparison_2.html' : 'roster_comparison.html'), html)
fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 2))
console.log(`sheet → ${path.join(OUT, V2 ? 'roster_comparison_2.html' : 'roster_comparison.html')} (${images.size} images); key → ${path.join(OUT, 'key.json')}`)
