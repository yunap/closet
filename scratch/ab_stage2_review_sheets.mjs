// Stage 2 review sheets (docs/stage1-cause-matrix-2026-09-14.md §5–7; scratch/ab_stage2_preregistration.json).
// Offline and read-only: no model call, no validation, no diagnostic cards, backfill, critic or repair.
//   B  — one blinded sheet of every raw composer card, exactly as returned, hanger photo first.
//   C  — stage 1: blinded individual-card ratings; stage 2 (a separate file, opened only after stage-1 ratings are
//        exported): cards grouped by anonymized attempt for best-of-set and "at least one I'd wear".
//   A  — evidence-marking sheet: each probe response beside the exact text and four photographs it received.
// Timed-out attempts are listed as technical failures and never produce a card. Sealed keys map every displayed
// card to contract, scenario, replicate, arm, attempt and raw-output index. Inputs are hashed before and after.
// usage: node scratch/ab_stage2_review_sheets.mjs --run-root scratch/ab_stage2_runs/2026-09-14 --out <dir> [--round r2] [--skip-a]
// Round r2 (owner deviation, 2026-09-14): the owner missed that conditions change between sections in round 1, so every
// card and set now states its own conditions; round-1 exports stay recorded and are not overwritten.
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const runRoot = path.resolve(REPO, value('--run-root') || 'scratch/ab_stage2_runs/2026-09-14')
const round = value('--round') || 'r1'
const suffix = round === 'r1' ? '' : `-${round}`
const outDir = path.resolve(REPO, value('--out') || path.join(runRoot, 'review', round === 'r1' ? '' : round))
const liveRoot = path.join(runRoot, 'live')
const snapshotDir = path.join(runRoot, 'final_snapshot')
const DB_FILES = ['wardrobe.db', 'wardrobe.db-wal', 'wardrobe.db-shm', 'system.db', 'system.db-wal', 'system.db-shm']
const sha = v => crypto.createHash('sha256').update(v).digest('hex')

function treeDigest(dir) {
  const files = []
  const walk = d => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); fs.statSync(p).isDirectory() ? walk(p) : files.push(p) } }
  walk(dir)
  return { files: files.length, sha256: sha(files.map(f => `${path.relative(dir, f)}\0${sha(fs.readFileSync(f))}`).join('\n')) }
}
const inputsBefore = { live: treeDigest(liveRoot), snapshot: treeDigest(snapshotDir) }

// Read garments from a private copy of the frozen snapshot; the frozen files are never opened.
const dbCopy = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-sheets-db-'))
for (const f of DB_FILES) if (fs.existsSync(path.join(snapshotDir, f))) fs.copyFileSync(path.join(snapshotDir, f), path.join(dbCopy, f))
process.on('exit', () => fs.rmSync(dbCopy, { recursive: true, force: true }))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(dbCopy, 'wardrobe.db')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(dbCopy, 'system.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(REPO, 'uploads')
const { db, parsePiece } = await import(`${REPO}/db.js`)
const { prepareWardrobeThumb } = await import(`${REPO}/styling-engine/provider.js`)
const sharp = (await import('sharp')).default
const { SCENARIOS } = await import(`${REPO}/scratch/ab_stage1_scenarios.mjs`)
const prereg = JSON.parse(fs.readFileSync(path.join(REPO, 'scratch', 'ab_stage2_preregistration.json'), 'utf8'))
const preregSha256 = sha(fs.readFileSync(path.join(REPO, 'scratch', 'ab_stage2_preregistration.json')))
fs.mkdirSync(outDir, { recursive: true })

const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
const seededRandom = seedHex => { let a = parseInt(seedHex.slice(0, 8), 16) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const shuffle = (list, rand) => list.map(item => [rand(), item]).sort((x, y) => x[0] - y[0]).map(([, item]) => item)
const pieceById = id => { const row = Number.isInteger(Number(id)) ? db.prepare('SELECT * FROM pieces WHERE id = ?').get(Number(id)) : null; return row ? parsePiece(row) : null }
const thumbCache = new Map()
async function hangerFirstThumb(piece) {
  const file = piece?.photo || piece?.worn_photo
  if (!file || !fs.existsSync(path.join(REPO, 'uploads', file))) return ''
  if (!thumbCache.has(file)) thumbCache.set(file, `data:image/jpeg;base64,${(await sharp(path.join(REPO, 'uploads', file)).resize({ width: 150, height: 150, fit: 'inside' }).jpeg({ quality: 72 }).toBuffer()).toString('base64')}`)
  return thumbCache.get(file)
}

const STYLE = `<style>:root{--bg:#fbfaf7;--fg:#222;--muted:#5b5b5b;--line:#ddd;--card:#fff;--warn:#8a4b00}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#1b1a18;--fg:#eee;--muted:#aaa;--line:#444;--card:#242320;--warn:#f0b070}}
:root[data-theme="dark"]{--bg:#1b1a18;--fg:#eee;--muted:#aaa;--line:#444;--card:#242320;--warn:#f0b070}
body{background:var(--bg);color:var(--fg);font:14px system-ui;margin:0;padding:16px;max-width:1150px}
.card,.group,.call{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin:12px 0}
.pos{margin:0;color:var(--muted);font-size:12px}.conditions{margin:4px 0;padding:6px 8px;border-left:4px solid var(--warn);font-weight:600}.card h3{margin:4px 0 8px}
.garments{display:flex;flex-wrap:wrap;gap:10px}figure{margin:0;width:160px}img{max-width:150px;max-height:150px;background:#fff}figcaption{font-size:12px;color:var(--muted)}
.fields p{margin:4px 0}.failure{color:var(--warn);border:1px dashed var(--warn);padding:8px;border-radius:6px;margin:8px 0}
fieldset{margin-top:8px;display:grid;gap:6px}textarea{width:100%;box-sizing:border-box}.export textarea{font:12px ui-monospace,monospace;min-height:140px}
.ev{border-top:1px solid var(--line);padding:6px 0}.photo768 img{max-width:360px;max-height:360px}.req{white-space:pre-wrap;font:12px ui-monospace,monospace}</style>`
const exportScript = (meta, collect) => `<script>
const SHEET = ${JSON.stringify(meta)};
document.getElementById('export').addEventListener('click', () => {
  const data = (${collect})()
  const text = JSON.stringify({ ...SHEET, exportedAt: new Date().toISOString(), ...data }, null, 2)
  document.getElementById('export-output').value = text
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = SHEET.sheetId + '-' + SHEET.seed + '.json'; a.click() } catch {}
})
</script>`
const ratingFields = `<fieldset><legend>Your rating</legend>
<label>Weather adequacy for these conditions <select data-field="weatherAdequacy"><option></option>${[1, 2, 3, 4, 5].map(n => `<option>${n}</option>`).join('')}</select></label>
<label>Style and intent <select data-field="styleIntent"><option></option>${[1, 2, 3, 4, 5].map(n => `<option>${n}</option>`).join('')}</select></label>
<label>Would wear as shown <select data-field="wouldWear"><option></option><option>yes</option><option>no</option></select></label>
<label>Notes <textarea data-field="notes" rows="2"></textarea></label></fieldset>`
const collectCards = `() => { const cards = [...document.querySelectorAll('section.card[data-card]')].map(s => { const f = n => s.querySelector('[data-field="' + n + '"]').value; const num = n => f(n) === '' ? null : Number(f(n)); return { cardId: s.dataset.card, weatherAdequacy: num('weatherAdequacy'), styleIntent: num('styleIntent'), wouldWear: f('wouldWear') || null, notes: f('notes') } }); return { cards, sheetNotes: document.getElementById('sheet-notes').value, unratedCards: cards.filter(c => c.weatherAdequacy == null || c.styleIntent == null || !c.wouldWear).map(c => c.cardId) } }`

const SLOT_ORDER = [['base_top_id', 'base top'], ['dress_id', 'dress'], ['middle_layer_id', 'middle layer'], ['outer_layer_id', 'outer layer'], ['bottom_id', 'bottom'], ['shoes_id', 'shoes']]
const SLOT_KEYS = new Set(SLOT_ORDER.map(([k]) => k))
async function renderRawCard(cardId, outfit, conditionsText) {
  const garments = []
  for (const [key, label] of SLOT_ORDER) {
    if (!(key in (outfit || {})) || outfit[key] === null || outfit[key] === undefined) continue
    const piece = pieceById(outfit[key])
    garments.push(`<figure>${piece ? `<img src="${await hangerFirstThumb(piece)}" alt="">` : ''}<figcaption>${esc(label)}: ${piece ? `${esc(piece.name)} (ID ${esc(outfit[key])})` : `ID ${esc(JSON.stringify(outfit[key]))} — not found in the wardrobe`}</figcaption></figure>`)
  }
  const fields = Object.entries(outfit || {}).filter(([k]) => !SLOT_KEYS.has(k) && k !== 'label')
    .map(([k, v]) => `<p><strong>${esc(k)}:</strong> ${esc(typeof v === 'string' ? v : JSON.stringify(v))}</p>`).join('')
  return `<section class="card" data-card="${esc(cardId)}"><p class="pos">Card ${esc(cardId)}</p><p class="conditions">Conditions for this card: ${esc(conditionsText)}</p><h3>${esc(outfit?.label ?? '(no label returned)')}</h3>
<div class="garments">${garments.join('') || '<p>(no garment slots returned)</p>'}</div><div class="fields">${fields}</div>${ratingFields}</section>`
}

function loadAttempts(contract) {
  const manifest = JSON.parse(fs.readFileSync(path.join(liveRoot, `ab2_live_${contract}`, 'manifest.json'), 'utf8'))
  if (manifest.mode !== 'live' || manifest.preregistration.sha256 !== preregSha256) throw new Error(`${contract}: manifest is not the approved live run`)
  return manifest.attempts.map(a => {
    const dirName = `${a.key.split(':')[1]}-${a.key.split(':')[2]}-r${a.key.split(':')[0].slice(1)}`
    const attempt = JSON.parse(fs.readFileSync(path.join(liveRoot, `ab2_live_${contract}`, dirName, 'attempt.json'), 'utf8'))
    const e = attempt.experiment
    const outfits = Array.isArray(e?.raw?.outfits) ? e.raw.outfits : null
    const failed = Boolean(!e || e.composerError || attempt.status !== 200 || !outfits)
    const [r, scenario, arm] = a.key.split(':')
    return { key: a.key, scenario, replicate: Number(r.slice(1)), arm, attemptDir: `ab2_live_${contract}/${dirName}`, failed, failure: failed ? (e?.composerError || attempt.error || `status ${attempt.status}`) : null, outfits: failed ? [] : outfits }
  })
}

async function buildCardSheet(contract, { stageLabel, sheetId }) {
  const attempts = loadAttempts(contract)
  const seed = crypto.randomBytes(4).toString('hex')
  const rand = seededRandom(seed)
  const key = { sheetId, contract, stage: stageLabel, seed, preregSha256, builtAt: new Date().toISOString(), cards: [], failures: [] }
  const sections = []
  let counter = 0
  for (const scenario of Object.keys(SCENARIOS)) {
    const cards = attempts.filter(a => a.scenario === scenario).flatMap(a => a.outfits.map((outfit, rawOutputIndex) => ({ a, outfit, rawOutputIndex })))
    const failures = attempts.filter(a => a.scenario === scenario && a.failed)
    const blocks = []
    for (const item of shuffle(cards, rand)) {
      const cardId = `${contract}-${String(++counter).padStart(3, '0')}`
      key.cards.push({ cardId, contract, scenario, replicate: item.a.replicate, arm: item.a.arm, attempt: item.a.key, attemptDir: item.a.attemptDir, rawOutputIndex: item.rawOutputIndex })
      blocks.push(await renderRawCard(cardId, item.outfit, SCENARIOS[scenario].situation))
    }
    for (const f of failures) key.failures.push({ contract, scenario, replicate: f.replicate, arm: f.arm, attempt: f.key, attemptDir: f.attemptDir, reason: f.failure })
    const failureNote = failures.length ? `<p class="failure">${failures.length} attempt${failures.length === 1 ? '' : 's'} for these conditions returned no cards: technical failure (${esc([...new Set(failures.map(f => f.failure))].join('; '))}). No card is shown or substituted for ${failures.length === 1 ? 'it' : 'them'}.</p>` : ''
    sections.push(`<h2>Conditions: ${esc(SCENARIOS[scenario].situation)}</h2>${failureNote}${blocks.join('\n')}`)
  }
  const title = `${contract === 'B' ? 'Stage 2 — Contract B review (raw composer cards)' : 'Stage 2 — Contract C, stage 1: individual card ratings'}${round === 'r1' ? '' : ` — rating round ${round.slice(1)}`}`
  const intro = `<p>Every card is shown exactly as the composer returned it — no validation, repair or filtering — including anything incomplete or inconsistent. Cards are in a recorded random order within each set of conditions; which run or condition produced each card is hidden. Conditions change between sections and are printed on every card — rate each card for its own conditions. Rate each card on its own.${contract === 'C' ? ' A separate stage-2 sheet, grouping cards by attempt, is provided only after these ratings are exported.' : ''}</p>`
  const html = `<title>${esc(title)}</title>${STYLE}<h1>${esc(title)}</h1>${intro}${sections.join('\n')}
<section class="card export" id="export-section"><h2>After rating every card</h2><label>Sheet notes <textarea id="sheet-notes" rows="2"></textarea></label>
<p><button type="button" id="export">Export ratings</button> The export (no run or condition information) appears below and is offered as a download.</p><textarea id="export-output" readonly></textarea></section>
${exportScript({ sheetId, contract, stage: stageLabel, seed, preregSha256 }, collectCards)}`
  fs.writeFileSync(path.join(outDir, `${sheetId}.html`), html)
  fs.writeFileSync(path.join(outDir, `${sheetId}.sealed-key.json`), JSON.stringify(key, null, 2))
  return { html, key, attempts }
}

async function buildCStage2(stage1Key, attempts) {
  const seed = crypto.randomBytes(4).toString('hex')
  const rand = seededRandom(seed)
  const sheetId = `stage2-C-stage2-groups${suffix}`
  const key = { sheetId, contract: 'C', stage: 'stage 2 (grouped by attempt)', seed, preregSha256, stage1SheetSeed: stage1Key.seed, builtAt: new Date().toISOString(), groups: [] }
  const sections = []
  let g = 0
  for (const scenario of Object.keys(SCENARIOS)) {
    const blocks = []
    for (const a of shuffle(attempts.filter(x => x.scenario === scenario), rand)) {
      const groupId = `C-group-${String(++g).padStart(2, '0')}`
      const cardIds = stage1Key.cards.filter(c => c.attempt === a.key).sort((x, y) => x.rawOutputIndex - y.rawOutputIndex).map(c => c.cardId)
      key.groups.push({ groupId, scenario, replicate: a.replicate, arm: a.arm, attempt: a.key, attemptDir: a.attemptDir, cardIds, failed: a.failed, failure: a.failure })
      if (a.failed) { blocks.push(`<section class="group" data-group="${groupId}" data-failed="true"><h3>${groupId}</h3><p class="conditions">Conditions for this set: ${esc(SCENARIOS[scenario].situation)}</p><p class="failure">This attempt returned no cards: technical failure (${esc(a.failure)}). Nothing to rate.</p></section>`); continue }
      const thumbs = []
      for (const cardId of cardIds) {
        const ref = stage1Key.cards.find(c => c.cardId === cardId)
        const outfit = a.outfits[ref.rawOutputIndex]
        const imgs = []
        for (const [slot] of SLOT_ORDER) { if (outfit?.[slot] == null) continue; const p = pieceById(outfit[slot]); if (p) imgs.push(`<img src="${await hangerFirstThumb(p)}" alt="" style="max-width:70px;max-height:70px">`) }
        thumbs.push(`<figure style="width:auto"><figcaption>Card ${esc(cardId)} — ${esc(outfit?.label ?? '(no label)')}</figcaption>${imgs.join('')}</figure>`)
      }
      blocks.push(`<section class="group" data-group="${groupId}"><h3>${groupId}</h3><p class="conditions">Conditions for this set: ${esc(SCENARIOS[scenario].situation)}</p><div class="garments">${thumbs.join('')}</div>
<fieldset><label>Strongest card in this set <select data-field="strongest"><option></option>${cardIds.map(id => `<option>${id}</option>`).join('')}</select></label>
<label>Would you wear at least one card from this set? <select data-field="atLeastOne"><option></option><option>yes</option><option>no</option></select></label>
<label>Notes <textarea data-field="notes" rows="2"></textarea></label></fieldset></section>`)
    }
    sections.push(`<h2>Conditions: ${esc(SCENARIOS[scenario].situation)}</h2>${blocks.join('\n')}`)
  }
  const collect = `() => ({ groups: [...document.querySelectorAll('section.group[data-group]')].map(s => s.dataset.failed ? { groupId: s.dataset.group, failed: true } : { groupId: s.dataset.group, strongest: s.querySelector('[data-field="strongest"]').value || null, atLeastOne: s.querySelector('[data-field="atLeastOne"]').value || null, notes: s.querySelector('[data-field="notes"]').value }), sheetNotes: document.getElementById('sheet-notes').value })`
  const html = `<title>Stage 2 — Contract C, stage 2: sets by attempt</title>${STYLE}<h1>Stage 2 — Contract C, stage 2: sets by attempt</h1>
<p>Open only after your stage-1 card ratings are exported and locked. Each set is the cards one attempt returned; set size is visible and unavoidable here. Card numbers match the stage-1 sheet.</p>${sections.join('\n')}
<section class="card export"><h2>Export</h2><label>Sheet notes <textarea id="sheet-notes" rows="2"></textarea></label><p><button type="button" id="export">Export set judgments</button></p><textarea id="export-output" readonly></textarea></section>
${exportScript({ sheetId, contract: 'C', stage: 'stage 2', seed, preregSha256, stage1SheetSeed: stage1Key.seed }, collect)}`
  fs.writeFileSync(path.join(outDir, `${sheetId}.html`), html)
  fs.writeFileSync(path.join(outDir, `${sheetId}.sealed-key.json`), JSON.stringify(key, null, 2))
  return { html, key }
}

async function buildASheet() {
  const manifest = JSON.parse(fs.readFileSync(path.join(liveRoot, 'ab2_live_A', 'manifest.json'), 'utf8'))
  if (manifest.mode !== 'live' || manifest.preregistration.sha256 !== preregSha256) throw new Error('A: manifest is not the approved live run')
  const imageChecks = []
  const blocks = []
  for (const call of manifest.calls) {
    const [r, inner] = call.attempt.split(':')
    const dir = path.join(liveRoot, 'ab2_live_A', `${inner}-${r}`)
    const a = JSON.parse(fs.readFileSync(path.join(dir, 'attempt.json'), 'utf8'))
    const images = [...a.imageManifest]
    const request = []
    for (const text of a.textParts) {
      request.push(`<div class="req">${esc(text)}</div>`)
      const m = text.match(/^(inner|outer) garment — (hanger|worn) photo$/)
      if (!m) continue
      const entry = images.find(i => i.role === m[1] && i.photoKind === m[2])
      const thumb = await prepareWardrobeThumb(path.join(REPO, 'uploads', entry.photoFile), `${entry.id}:${entry.maxPx}:${entry.photoFile}`, { maxPx: entry.maxPx })
      const matches = sha(String(thumb.data)) === entry.sentSha256
      imageChecks.push({ attempt: call.attempt, id: entry.id, role: entry.role, photoKind: entry.photoKind, matchesSentBytes: matches })
      request.push(`<figure class="photo768"><img src="data:${thumb.media_type};base64,${thumb.data}" alt=""><figcaption>${esc(m[1])} garment — ${esc(m[2])} photo (ID ${entry.id}) ${matches ? '— identical to the bytes sent' : '— WARNING: differs from the bytes sent'}</figcaption></figure>`)
    }
    const raw = a.raw || {}
    const markItem = (itemId, label, text) => `<div class="ev" data-item="${esc(itemId)}"><p><strong>${esc(label)}</strong> ${esc(text)}</p>
<label>Support <select data-field="support"><option></option><option>supported</option><option>unsupported</option></select></label>
<label><input type="checkbox" data-field="invented"> contains an invented inference</label>
<label>Note <input data-field="note" size="60"></label></div>`
    const items = (raw.construction_evidence || []).map((ev, i) => markItem(`evidence-${i}`, `Evidence ${i + 1} — ${ev.garment} garment, cited as ${ev.source}:`, ev.observation))
    if (raw.sleeve_treatment) items.push(markItem('sleeve_treatment', 'Sleeve treatment:', raw.sleeve_treatment))
    if (raw.uncertainty_reason) items.push(markItem('uncertainty_reason', 'Uncertainty reason:', raw.uncertainty_reason))
    blocks.push(`<section class="call" data-call="${esc(call.attempt)}"><h2>Call ${call.executionIndex}: ID ${esc(inner)} under 996866 (${esc(r)})</h2>
<details><summary>System prompt sent (exact)</summary><div class="req">${esc(prereg.contracts.A.systemPrompt)}</div></details>
<h3>What the model received</h3>${request.join('\n')}
<h3>What it returned</h3><p><strong>Verdict:</strong> ${esc(raw.verdict ?? '(none)')}</p>${items.join('\n')}</section>`)
  }
  const collect = `() => ({ calls: [...document.querySelectorAll('section.call[data-call]')].map(s => ({ call: s.dataset.call, items: [...s.querySelectorAll('.ev[data-item]')].map(e => ({ item: e.dataset.item, support: e.querySelector('[data-field="support"]').value || null, inventedInference: e.querySelector('[data-field="invented"]').checked, note: e.querySelector('[data-field="note"]').value })) })), sheetNotes: document.getElementById('sheet-notes').value })`
  const sheetId = 'stage2-A-evidence-marking'
  const html = `<title>Stage 2 — Contract A evidence marking</title>${STYLE}<h1>Stage 2 — Contract A evidence marking</h1>
<p>Each probe response beside the exact text and four photographs it received. Mark every item supported or unsupported by what was shown, and flag any invented inference. Nothing is pre-marked; the source a response cited (fact or photo) is its own claim, not a judgment.</p>${blocks.join('\n')}
<section class="call export"><h2>Export</h2><label>Sheet notes <textarea id="sheet-notes" rows="2"></textarea></label><p><button type="button" id="export">Export evidence marks</button></p><textarea id="export-output" readonly></textarea></section>
${exportScript({ sheetId, contract: 'A', seed: 'none', preregSha256 }, collect)}`
  fs.writeFileSync(path.join(outDir, `${sheetId}.html`), html)
  return { html, imageChecks, calls: manifest.calls.length }
}

// ── build ──
const B = await buildCardSheet('B', { stageLabel: `individual cards (${round})`, sheetId: `stage2-B-cards${suffix}` })
const C1 = await buildCardSheet('C', { stageLabel: `stage 1 (individual cards, ${round})`, sheetId: `stage2-C-stage1-cards${suffix}` })
const C2 = await buildCStage2(C1.key, C1.attempts)
const A = args.includes('--skip-a') ? null : await buildASheet()

// ── verification ──
const checks = { round }
for (const [label, sheet] of [['B', B], ['C', C1]]) {
  const expected = sheet.attempts.filter(a => !a.failed).flatMap(a => a.outfits.map((_, i) => `${a.key}#${i}`))
  const shown = sheet.key.cards.map(c => `${c.attempt}#${c.rawOutputIndex}`)
  const htmlCardIds = [...sheet.html.matchAll(/data-card="([^"]+)"/g)].map(m => m[1])
  const initialView = sheet.html.split('<script>')[0]
  const leakPattern = /\b(B0|B1|N1|N5)\b|garmentLine|holdOut|replicate|\br[12]:S[123]|S[123]-(B[01]|N[15])-r[12]|ab2_live|requestedLimit|maxTokensForCount|experiment manifest/i
  checks[label] = {
    successfulRawCards: expected.length,
    displayedCards: htmlCardIds.length,
    everySuccessfulCardExactlyOnce: JSON.stringify([...expected].sort()) === JSON.stringify([...shown].sort()) && new Set(shown).size === shown.length && htmlCardIds.length === expected.length,
    failedAttemptsProduceNoCard: sheet.attempts.filter(a => a.failed).every(a => !shown.some(s => s.startsWith(`${a.key}#`))),
    failuresRecorded: sheet.key.failures.map(f => f.attempt),
    keyComplete: sheet.key.cards.every(c => ['contract', 'scenario', 'replicate', 'arm', 'attempt', 'rawOutputIndex'].every(f => c[f] !== undefined && c[f] !== null)),
    armLeaksInInitialView: [...new Set([...initialView.matchAll(new RegExp(leakPattern.source, 'gi'))].map(m => m[0]))],
    scriptMetadataKeys: Object.keys(JSON.parse(sheet.html.match(/const SHEET = (\{.*?\});/)[1])),
  }
}
checks.C_stage2 = { groups: C2.key.groups.length, groupsForFailedAttempts: C2.key.groups.filter(g => g.failed).map(g => g.attempt), everyStage1CardInExactlyOneGroup: JSON.stringify(C2.key.groups.flatMap(g => g.cardIds).sort()) === JSON.stringify(C1.key.cards.map(c => c.cardId).sort()), failedGroupsHaveNoCards: C2.key.groups.filter(g => g.failed).every(g => g.cardIds.length === 0) }
if (A) checks.A = { calls: A.calls, photosShown: A.imageChecks.length, everyPhotoIdenticalToSentBytes: A.imageChecks.every(c => c.matchesSentBytes), mismatches: A.imageChecks.filter(c => !c.matchesSentBytes), noPreMarking: !/<option[^>]*selected|<input[^>]*\bchecked\b/.test(A.html.split('<script>')[0]) }
const inputsAfter = { live: treeDigest(liveRoot), snapshot: treeDigest(snapshotDir) }
checks.inputsUnchanged = { before: inputsBefore, after: inputsAfter, unchanged: JSON.stringify(inputsBefore) === JSON.stringify(inputsAfter) }
fs.writeFileSync(path.join(outDir, 'verification.json'), JSON.stringify(checks, null, 2))
console.log(JSON.stringify(checks, null, 2))
db.close()
