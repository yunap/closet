// Stage 3 day-wear pilot review sheets (scratch/ab_stage3_preregistration.json; docs/day-wear-explanation-experiment-2026-09-15.md).
//   --stage 1: one blinded sheet of every raw card from the approved live run, exactly as returned, hanger photo first,
//              conditions on every card, seeded random order with a sealed key; arm and replicate hidden; wear_through_day
//              NOT shown (both arms look alike). Fields: weather adequacy, style and intent, would wear, notes.
//   --stage 2 --stage1-export <file>: REQUIRED explanation-validity sheet, built only from a complete stage-1 export that
//              matches the sealed key; the export's sha256 is recorded as locked. Every explain card with its photos, its own
//              stage-1 rating and its verbatim wear_through_day; marks: believable plan, accurate coverage, rationalizes a poor choice.
// Read-only: the live run and the frozen snapshot are never modified (verified by tree digest).
// usage: node scratch/ab_stage3_review_sheets.mjs --run-root scratch/ab_stage3_runs/2026-09-15 --stage 1|2 [--stage1-export <file>]
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const runRoot = path.resolve(REPO, value('--run-root') || 'scratch/ab_stage3_runs/2026-09-15')
const stage = value('--stage')
if (!['1', '2'].includes(stage)) { console.error('--stage 1|2 required'); process.exit(2) }
const liveRoot = path.join(runRoot, 'live')
const outDir = path.join(runRoot, 'review')
const snapshotDir = path.join(REPO, 'scratch/ab_stage2_runs/2026-09-14/final_snapshot')
const DB_FILES = ['wardrobe.db', 'wardrobe.db-wal', 'wardrobe.db-shm', 'system.db', 'system.db-wal', 'system.db-shm']
const sha = v => crypto.createHash('sha256').update(v).digest('hex')
function treeDigest(dir) {
  const files = []
  const walk = d => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); fs.statSync(p).isDirectory() ? walk(p) : files.push(p) } }
  walk(dir)
  return { files: files.length, sha256: sha(files.map(f => `${path.relative(dir, f)}\0${sha(fs.readFileSync(f))}`).join('\n')) }
}
const inputsBefore = { live: treeDigest(liveRoot), snapshot: treeDigest(snapshotDir) }

const dbCopy = fs.mkdtempSync(path.join(os.tmpdir(), 'stage3-sheets-db-'))
for (const f of DB_FILES) if (fs.existsSync(path.join(snapshotDir, f))) fs.copyFileSync(path.join(snapshotDir, f), path.join(dbCopy, f))
process.on('exit', () => fs.rmSync(dbCopy, { recursive: true, force: true }))
Object.assign(process.env, { NODE_ENV: 'test', WARDROBE_DB_PATH: path.join(dbCopy, 'wardrobe.db'), WARDROBE_SYSTEM_DB_PATH: path.join(dbCopy, 'system.db'), WARDROBE_UPLOADS_DIR: path.join(REPO, 'uploads') })
const { db, parsePiece } = await import(`${REPO}/db.js`)
const sharp = (await import('sharp')).default
const { SCENARIOS } = await import(`${REPO}/scratch/ab_stage1_scenarios.mjs`)
const preregFile = path.join(REPO, 'scratch', 'ab_stage3_preregistration.json')
const prereg = JSON.parse(fs.readFileSync(preregFile, 'utf8'))
const preregSha256 = sha(fs.readFileSync(preregFile))
fs.mkdirSync(outDir, { recursive: true })

const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
const seededRandom = seedHex => { let a = parseInt(seedHex.slice(0, 8), 16) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const shuffle = (list, rand) => list.map(item => [rand(), item]).sort((x, y) => x[0] - y[0]).map(([, item]) => item)
const pieceById = id => { const row = Number.isInteger(Number(id)) ? db.prepare('SELECT * FROM pieces WHERE id = ?').get(Number(id)) : null; return row ? parsePiece(row) : null }
const thumbCache = new Map()
async function hangerFirstThumb(piece) {
  const file = piece?.photo || piece?.worn_photo
  if (!file || !fs.existsSync(path.join(REPO, 'uploads', file))) return ''
  if (!thumbCache.has(file)) thumbCache.set(file, `data:image/jpeg;base64,${(await sharp(path.join(REPO, 'uploads', file)).resize({ width: 170, height: 170, fit: 'inside' }).jpeg({ quality: 74 }).toBuffer()).toString('base64')}`)
  return thumbCache.get(file)
}
const STYLE = `<style>:root{--bg:#fbfaf7;--fg:#222;--muted:#5b5b5b;--line:#ddd;--card:#fff;--warn:#8a4b00}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#1b1a18;--fg:#eee;--muted:#aaa;--line:#444;--card:#242320;--warn:#f0b070}}
:root[data-theme="dark"]{--bg:#1b1a18;--fg:#eee;--muted:#aaa;--line:#444;--card:#242320;--warn:#f0b070}
body{background:var(--bg);color:var(--fg);font:14px system-ui;margin:0;padding:16px;max-width:1150px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin:12px 0}
.pos{margin:0;color:var(--muted);font-size:12px}.conditions{margin:4px 0;padding:6px 8px;border-left:4px solid var(--warn);font-weight:600}
.garments{display:flex;flex-wrap:wrap;gap:10px}figure{margin:0;width:180px}img{max-width:170px;max-height:170px;background:#fff}figcaption{font-size:12px;color:var(--muted)}
.fields p{margin:4px 0}.failure{color:var(--warn);border:1px dashed var(--warn);padding:8px;border-radius:6px;margin:8px 0}
.plan{white-space:pre-wrap;border-left:4px solid var(--line);padding:6px 10px;margin:8px 0}
fieldset{border:1px solid var(--line);border-radius:6px;margin-top:8px}label{display:block;margin:4px 0}textarea{width:100%;background:var(--card);color:var(--fg)}select{background:var(--card);color:var(--fg)}</style>`
const exportScript = (meta, collect) => `<script>
const SHEET = ${JSON.stringify(meta)};
document.getElementById('export').addEventListener('click', () => {
  const data = (${collect})()
  const text = JSON.stringify({ ...SHEET, exportedAt: new Date().toISOString(), ...data }, null, 2)
  document.getElementById('export-output').value = text
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = SHEET.sheetId + '-' + SHEET.seed + '.json'; a.click() } catch {}
})
</script>`
const SLOT_ORDER = [['base_top_id', 'base top'], ['dress_id', 'dress'], ['middle_layer_id', 'middle layer'], ['outer_layer_id', 'outer layer'], ['bottom_id', 'bottom'], ['shoes_id', 'shoes']]
const SLOT_KEYS = new Set(SLOT_ORDER.map(([k]) => k))
const HIDDEN_IN_STAGE1 = new Set(['wear_through_day'])
async function garmentsHtml(outfit) {
  const out = []
  for (const [key, label] of SLOT_ORDER) {
    if (outfit?.[key] === null || outfit?.[key] === undefined) continue
    const piece = pieceById(outfit[key])
    out.push(`<figure>${piece ? `<img src="${await hangerFirstThumb(piece)}" alt="">` : ''}<figcaption>${esc(label)}: ${piece ? `${esc(piece.name)} (ID ${esc(outfit[key])})` : `ID ${esc(JSON.stringify(outfit[key]))} — not found in the wardrobe`}</figcaption></figure>`)
  }
  return out.join('') || '<p>(no garment slots returned)</p>'
}
const textFields = (outfit, hidden) => Object.entries(outfit || {}).filter(([k]) => !SLOT_KEYS.has(k) && k !== 'label' && !hidden.has(k))
  .map(([k, v]) => `<p><strong>${esc(k)}:</strong> ${esc(typeof v === 'string' ? v : JSON.stringify(v))}</p>`).join('')

function loadAttempts() {
  const manifest = JSON.parse(fs.readFileSync(path.join(liveRoot, 'manifest.json'), 'utf8'))
  if (manifest.mode !== 'live' || manifest.preregistration.sha256 !== preregSha256) throw new Error('live manifest is not the approved run of this pre-registration')
  return manifest.attempts.map(a => {
    const [r, scenario, arm] = a.key.split(':')
    const dirName = `${scenario}-${arm}-r${r.slice(1)}`
    const attempt = JSON.parse(fs.readFileSync(path.join(liveRoot, dirName, 'attempt.json'), 'utf8'))
    const e = attempt.experiment
    const outfits = Array.isArray(e?.raw?.outfits) ? e.raw.outfits : null
    const failed = Boolean(!e || e.composerError || attempt.status !== 200 || !outfits || !outfits.length)
    return { key: a.key, scenario, replicate: Number(r.slice(1)), arm, dir: dirName, failed, failure: failed ? (e?.composerError || attempt.error || (outfits && !outfits.length ? 'no outfits returned' : `status ${attempt.status}`)) : null, outfits: failed ? [] : outfits }
  })
}

const attempts = loadAttempts()
const checks = { stage }

if (stage === '1') {
  const seed = crypto.randomBytes(4).toString('hex')
  const rand = seededRandom(seed)
  const sheetId = 'stage3-pilot-cards'
  const key = { sheetId, seed, preregSha256, builtAt: new Date().toISOString(), cards: [], failures: [] }
  const sections = []
  let counter = 0
  for (const scenario of shuffle(Object.keys(SCENARIOS), rand)) {
    const cards = attempts.filter(a => a.scenario === scenario && !a.failed).flatMap(a => a.outfits.map((outfit, rawOutputIndex) => ({ a, outfit, rawOutputIndex })))
    const blocks = []
    for (const item of shuffle(cards, rand)) {
      const cardId = `P-${String(++counter).padStart(2, '0')}`
      key.cards.push({ cardId, scenario, replicate: item.a.replicate, arm: item.a.arm, attempt: item.a.key, dir: item.a.dir, rawOutputIndex: item.rawOutputIndex })
      blocks.push(`<section class="card" data-card="${cardId}"><p class="pos">Card ${cardId}</p><p class="conditions">Conditions for this card: ${esc(SCENARIOS[scenario].situation)}</p><h3>${esc(item.outfit?.label ?? '(no label returned)')}</h3>
<div class="garments">${await garmentsHtml(item.outfit)}</div><div class="fields">${textFields(item.outfit, HIDDEN_IN_STAGE1)}</div>
<fieldset><legend>Your rating</legend>
<label>Weather adequacy for these conditions <select data-field="weatherAdequacy"><option></option>${[1, 2, 3, 4, 5].map(n => `<option>${n}</option>`).join('')}</select></label>
<label>Style and intent <select data-field="styleIntent"><option></option>${[1, 2, 3, 4, 5].map(n => `<option>${n}</option>`).join('')}</select></label>
<label>Would wear as shown <select data-field="wouldWear"><option></option><option>yes</option><option>no</option></select></label>
<label>Notes <textarea data-field="notes" rows="2"></textarea></label></fieldset></section>`)
    }
    const failures = attempts.filter(a => a.scenario === scenario && a.failed)
    for (const f of failures) key.failures.push({ scenario, replicate: f.replicate, arm: f.arm, attempt: f.key, dir: f.dir, reason: f.failure })
    const note = failures.length ? `<p class="failure">${failures.length} attempt${failures.length === 1 ? '' : 's'} for these conditions returned no card (technical failure). Nothing is shown or substituted.</p>` : ''
    sections.push(`<h2>Conditions: ${esc(SCENARIOS[scenario].situation)}</h2>${note}${blocks.join('\n')}`)
  }
  const collect = `() => { const cards = [...document.querySelectorAll('section.card[data-card]')].map(s => { const f = n => s.querySelector('[data-field="' + n + '"]').value; const num = n => f(n) === '' ? null : Number(f(n)); return { cardId: s.dataset.card, weatherAdequacy: num('weatherAdequacy'), styleIntent: num('styleIntent'), wouldWear: f('wouldWear') || null, notes: f('notes') } }); return { cards, sheetNotes: document.getElementById('sheet-notes').value, unratedCards: cards.filter(c => c.weatherAdequacy == null || c.styleIntent == null || !c.wouldWear).map(c => c.cardId) } }`
  const html = `<title>Day-wear pilot — card ratings</title>${STYLE}<h1>Day-wear pilot — card ratings</h1>
<p>At most 12 cards. Each card is shown exactly as the composer returned it, with no validation, repair or filtering. Order is random, and which run produced each card is hidden. Conditions are printed on every card and change between sections; rate each card for its own conditions.</p>${sections.join('\n')}
<section class="card"><h2>After rating every card</h2><label>Sheet notes <textarea id="sheet-notes" rows="2"></textarea></label>
<p><button type="button" id="export">Export ratings</button> The export appears below and is offered as a download. Send it back; the explanation review is built only from this locked export.</p><textarea id="export-output" readonly rows="6"></textarea></section>
${exportScript({ sheetId, seed, preregSha256 }, collect)}`
  fs.writeFileSync(path.join(outDir, `${sheetId}.html`), html)
  fs.writeFileSync(path.join(outDir, `${sheetId}.sealed-key.json`), JSON.stringify(key, null, 2))
  const expected = attempts.filter(a => !a.failed).flatMap(a => a.outfits.map((_, i) => `${a.key}#${i}`)).sort()
  const shown = key.cards.map(c => `${c.attempt}#${c.rawOutputIndex}`).sort()
  const initialView = html.split('<script>')[0]
  checks.stage1 = {
    cards: key.cards.length, everySuccessfulCardExactlyOnce: JSON.stringify(expected) === JSON.stringify(shown),
    atMost12: key.cards.length <= 12, failures: key.failures,
    armLeaksInInitialView: [...new Set([...initialView.matchAll(/\b(control|explain|N1|r[12]:S[123])\b|wear_through_day|replicate|dayWear/gi)].map(m => m[0]))],
    explanationTextShown: key.cards.some(c => { const o = attempts.find(a => a.key === c.attempt).outfits[c.rawOutputIndex]; return o?.wear_through_day && initialView.includes(esc(o.wear_through_day)) }),
  }
} else {
  const exportFile = value('--stage1-export')
  if (!exportFile) { console.error('--stage1-export <file> required for stage 2'); process.exit(2) }
  const key = JSON.parse(fs.readFileSync(path.join(outDir, 'stage3-pilot-cards.sealed-key.json'), 'utf8'))
  const exportBytes = fs.readFileSync(exportFile)
  const exp = JSON.parse(exportBytes)
  if (exp.seed !== key.seed || exp.preregSha256 !== key.preregSha256) throw new Error('stage-1 export does not match the sealed key')
  const rated = new Map(exp.cards.map(c => [c.cardId, c]))
  const unrated = key.cards.filter(c => { const r = rated.get(c.cardId); return !r || r.weatherAdequacy == null || r.styleIntent == null || !r.wouldWear })
  if (unrated.length) throw new Error(`stage-1 export is incomplete: ${unrated.map(c => c.cardId).join(', ')}`)
  const locked = { file: path.basename(exportFile), sha256: sha(exportBytes), lockedAt: new Date().toISOString() }
  fs.copyFileSync(exportFile, path.join(outDir, `locked-${path.basename(exportFile)}`))
  fs.writeFileSync(path.join(outDir, 'stage1-export-locked.json'), JSON.stringify(locked, null, 2))
  const sheetId = 'stage3-pilot-explanations'
  const blocks = []
  const explainCards = key.cards.filter(c => c.arm.startsWith('explain'))
  for (const c of explainCards) {
    const outfit = attempts.find(a => a.key === c.attempt).outfits[c.rawOutputIndex]
    const r = rated.get(c.cardId)
    blocks.push(`<section class="card" data-card="${c.cardId}"><p class="pos">Card ${c.cardId} (same number as in your card ratings)</p><p class="conditions">Conditions for this card: ${esc(SCENARIOS[c.scenario].situation)}</p><h3>${esc(outfit?.label ?? '')}</h3>
<div class="garments">${await garmentsHtml(outfit)}</div><div class="fields">${textFields(outfit, HIDDEN_IN_STAGE1)}</div>
<p><strong>Your locked rating:</strong> weather ${esc(r.weatherAdequacy)}, style ${esc(r.styleIntent)}, would wear ${esc(r.wouldWear)}${r.notes ? ` — “${esc(r.notes)}”` : ''}</p>
<p><strong>The stylist's stated plan through the conditions (wear_through_day):</strong></p><div class="plan">${esc(outfit?.wear_through_day ?? '(not returned)')}</div>
<fieldset><legend>Explanation validity</legend>
<label>Is this a physically believable plan for these conditions? <select data-field="believable"><option></option><option>yes</option><option>partly</option><option>no</option></select></label>
<label>Are its coverage statements accurate for these garments (arms, neck, torso, legs; open or closed)? <select data-field="coverageAccurate"><option></option><option>yes</option><option>partly</option><option>no</option></select></label>
<label>Does it rationalize a poor garment choice rather than describe a sound plan? <select data-field="rationalizes"><option></option><option>yes</option><option>no</option><option>unsure</option></select></label>
<label>Notes <textarea data-field="notes" rows="2"></textarea></label></fieldset></section>`)
  }
  const collect = `() => { const cards = [...document.querySelectorAll('section.card[data-card]')].map(s => { const f = n => s.querySelector('[data-field="' + n + '"]').value; return { cardId: s.dataset.card, believable: f('believable') || null, coverageAccurate: f('coverageAccurate') || null, rationalizes: f('rationalizes') || null, notes: f('notes') } }); return { cards, sheetNotes: document.getElementById('sheet-notes').value, unmarkedCards: cards.filter(c => !c.believable || !c.coverageAccurate || !c.rationalizes).map(c => c.cardId) } }`
  const html = `<title>Day-wear pilot — explanation review</title>${STYLE}<h1>Day-wear pilot — explanation review</h1>
<p>This review is required. Your card ratings are locked (export sha256 ${esc(locked.sha256.slice(0, 12))}…). These are the cards whose stylist was asked to explain how the outfit is worn through the conditions. Judge whether each plan is physically believable, and whether it honestly describes the outfit or rationalizes a poor choice.</p>${blocks.join('\n')}
<section class="card"><h2>Export</h2><label>Sheet notes <textarea id="sheet-notes" rows="2"></textarea></label><p><button type="button" id="export">Export explanation marks</button></p><textarea id="export-output" readonly rows="6"></textarea></section>
${exportScript({ sheetId, seed: key.seed, preregSha256, lockedStage1ExportSha256: locked.sha256 }, collect)}`
  fs.writeFileSync(path.join(outDir, `${sheetId}.html`), html)
  checks.stage2 = { explainCards: explainCards.length, locked, everyExplainCardHasText: explainCards.every(c => typeof attempts.find(a => a.key === c.attempt).outfits[c.rawOutputIndex]?.wear_through_day === 'string') }
}
const inputsAfter = { live: treeDigest(liveRoot), snapshot: treeDigest(snapshotDir) }
checks.inputsUnchanged = JSON.stringify(inputsBefore) === JSON.stringify(inputsAfter)
fs.writeFileSync(path.join(outDir, `verification-stage${stage}.json`), JSON.stringify(checks, null, 2))
console.log(JSON.stringify(checks, null, 2))
db.close()
