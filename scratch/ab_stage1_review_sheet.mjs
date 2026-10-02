// Builds the blind owner-review sheet for one Stage 1 scenario from a harness run. Pre-registration:
// scratch/ab_stage1_preregistration.json.
//  - Each scenario/replicate pair enters only after scratch/ab_stage1_contract.mjs recomputes, from the
//    recorded route debug, that both arms resolved identical temperatures and location, both routes
//    answered, and the one-outfit attempt routed to single_outfit. Excluded pairs go to the sealed key.
//  - Cards are shown as the product shows them to a user: title, rank label or Needs-review status,
//    rejection reason, flags, the model's reason, styling instructions and watchFor, under the product's
//    own visibility rules. Only the arm (and replicate) is blinded.
//  - Piece roles come from the manifest exactly as the route returned them; nothing is derived here.
//  - Every card the product displays is shown and rated, Needs-review cards included; an attempt with zero
//    cards contributes none and its outcomes are not computable (scored by scratch/ab_stage1_score.mjs).
//  - Engine evidence is collapsed until the card is rated. Ratings export as blinded JSON.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
const args = process.argv.slice(2)
const val = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const REPO = path.join(path.dirname(new URL(import.meta.url).pathname), '..')
const snapshot = val('--snapshot'), runDir = val('--run'), scenarioKey = val('--scenario')
// --photo hanger (default) shows each garment's own photo, falling back to the worn photo only when none
// exists; --photo worn reproduces the first-round sheets. --label names a later rating round's files so
// an earlier round's sheets and sealed keys are never overwritten.
const photoMode = val('--photo') || 'hanger', label = val('--label')
const outName = suffix => `review-${scenarioKey}${label ? `.${label}` : ''}${suffix}`
if (!snapshot || !runDir || !scenarioKey) { console.error('usage: node scratch/ab_stage1_review_sheet.mjs --snapshot <dir> --run <harness out dir> --scenario S1'); process.exit(2) }
// The snapshot is frozen evidence: opening it directly lets SQLite create WAL/SHM files and checkpoint
// into system.db, which changes its hashes. Read a private copy instead.
import os from 'os'
const snapshotCopy = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-stage1-sheet-'))
for (const f of ['wardrobe.db', 'wardrobe.db-wal', 'wardrobe.db-shm', 'system.db', 'system.db-wal', 'system.db-shm']) {
  if (fs.existsSync(path.join(snapshot, f))) fs.copyFileSync(path.join(snapshot, f), path.join(snapshotCopy, f))
}
process.on('exit', () => fs.rmSync(snapshotCopy, { recursive: true, force: true }))
process.env.WARDROBE_DB_PATH = path.join(snapshotCopy, 'wardrobe.db')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(snapshotCopy, 'system.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(REPO, 'uploads')
const { db, parsePiece } = await import(`${REPO}/db.js`)
const { evaluateWearableOutfit } = await import(`${REPO}/styling-engine/outfitValidation.js`)
const { garmentWarmthLevel } = await import(`${REPO}/styling-engine/garmentWarmth.js`)
const sharp = (await import('sharp')).default
const { SCENARIOS } = await import(`${REPO}/scratch/ab_stage1_scenarios.mjs`)
const { reviewEligibility, userVisibleCard, renderVisibleCardBody, captureIntegrity } = await import(`${REPO}/scratch/ab_stage1_contract.mjs`)
const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'))
const preflight = manifest.mode !== 'live'
const preregistrationSha256 = manifest.preregistration?.sha256 || null

const experimentCells = manifest.cells.filter(c => c.scenario === scenarioKey && c.neutralVerdicts)
// Capture integrity is reported before the sheet is built. A failing attempt stays as it is: it is kept
// on the sheet, recorded in the sealed key, and never rerun.
const captureFailures = experimentCells.map(cell => ({ attempt: `r${cell.replicate}:${cell.scenario}:${cell.arm}`, ...captureIntegrity(cell, manifest.mode) })).filter(r => r.assessed && !r.ok)
if (captureFailures.length) console.warn(`CAPTURE-INTEGRITY FAILURE(S) for ${scenarioKey}:\n${captureFailures.map(f => `  ${f.attempt}: ${f.reasons.join('; ')}`).join('\n')}`)
const replicateNumbers = [...new Set(experimentCells.map(c => c.replicate))].sort((a, b) => a - b)
const cards = [], exclusions = [], included = []
for (const replicate of replicateNumbers) {
  const one = experimentCells.find(c => c.arm === 'one' && c.replicate === replicate)
  const bundle = experimentCells.find(c => c.arm === 'bundle' && c.replicate === replicate)
  const eligibility = reviewEligibility(one, bundle)
  if (!eligibility.eligible) { exclusions.push({ replicate, reasons: eligibility.reasons }); continue }
  included.push({ replicate, conditions: eligibility.parity.one })
  for (const [arm, cell] of [['one', one], ['bundle', bundle]]) {
    for (const card of cell.response?.cards || []) cards.push({ arm, replicate, card, weatherProfile: bundle.weatherProfileForEvaluation, resolved: eligibility.parity.bundle })
  }
}
if (!cards.length) { console.error(`No displayable cards to rate for ${scenarioKey}:`, JSON.stringify(exclusions)); process.exit(1) }

const seed = crypto.randomBytes(4).toString('hex')
let state = parseInt(seed, 16)
const rand = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const order = cards.map((c, i) => [rand(), i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i)
let wornFallbacks = 0
const thumb = async p => {
  const chosen = photoMode === 'worn' ? (p.worn_photo || p.photo) : (p.photo || p.worn_photo)
  if (photoMode !== 'worn' && !p.photo && p.worn_photo) wornFallbacks++
  const file = path.join(REPO, 'uploads', chosen || '')
  if (!chosen || !fs.existsSync(file)) return ''
  const buf = await sharp(file).resize({ width: 140, height: 140, fit: 'inside' }).jpeg({ quality: 70 }).toBuffer()
  return `data:image/jpeg;base64,${buf.toString('base64')}`
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
const activity = SCENARIOS?.[scenarioKey]?.activity || 'none'
const key = { scenario: scenarioKey, seed, round: label || 'first', photoMode, mode: manifest.mode || 'preflight', preregistrationSha256, source: manifest.source || null, captureIntegrityFailures: captureFailures, includedReplicates: included, excludedReplicates: exclusions, cards: [] }
const blocks = []
for (const [position, index] of order.entries()) {
  const { arm, replicate, card, weatherProfile, resolved } = cards[index]
  // Roles exactly as the route returned them; a piece the route left without a role stays without one.
  const pieces = card.pieces.map(p => {
    const row = db.prepare('SELECT * FROM pieces WHERE id = ?').get(Number(p.id))
    return row ? { ...parsePiece(row), role: p.role, anchor: p.anchor } : null
  }).filter(Boolean)
  const profile = weatherProfile || { highF: resolved.highF, lowF: resolved.lowF, weatherSource: resolved.source }
  const evaluation = evaluateWearableOutfit(pieces, { requireShoes: true, roleAware: true, includeLayerDirections: true, weatherContext: { weatherProfile: profile, activity } })
  const fit = evaluation?.stages?.find(s => s.stage === 'environment')?.result?.evidence?.endpointFit
  // RAW EVIDENCE ONLY (owner, 2026-09-13): targets, completed levels and signed distances, never verdict words.
  const signed = d => d == null ? 'unknown' : (d > 0 ? `+${d}` : String(d))
  const nameOf = id => pieces.find(x => Number(x.id) === Number(id))?.name || `ID ${id}`
  const configurationLines = (fit?.configurations || []).map(c => c.removedPieceId === null
    ? `As shown, every layer on: level ${c.unknown ? 'unknown' : c.level}; distance from cold-end target ${signed(c.coldDelta)}`
    : `With ${esc(nameOf(c.removedPieceId))} removed: level ${c.unknown ? 'unknown' : c.level}; distance from warm-end target ${signed(c.warmDelta)}`)
  const findings = [...(evaluation?.hardFindings || []), ...(evaluation?.advisoryFindings || [])].map(f => `${f.code}: ${f.message}`)
  const visible = userVisibleCard(card, position)
  key.cards.push({ position: position + 1, arm, replicate, needsReview: visible.needsReview, ids: card.ids })
  const photos = await Promise.all(pieces.map(async p => `<figure><img src="${await thumb(p)}" alt=""><figcaption>${esc(p.name)}</figcaption></figure>`))
  const select = (field, options) => `<select data-field="${field}"><option></option>${options.map(o => `<option>${o}</option>`).join('')}</select>`
  blocks.push(`<section class="card${visible.needsReview ? ' needs-review' : ''}" data-position="${position + 1}">
  <p class="position">Card ${position + 1}</p>
  ${renderVisibleCardBody(visible, photos.join(''), esc)}
  <fieldset><legend>Your rating (before opening evidence)</legend>
  <label>Weather adequacy for these conditions ${select('weatherAdequacy', [1, 2, 3, 4, 5])}</label>
  <label>Style and intent ${select('styleIntent', [1, 2, 3, 4, 5])}</label>
  <label>Would wear as shown ${select('wouldWear', ['yes', 'no'])}</label>
  <label>Notes <textarea data-field="notes" rows="2"></textarea></label></fieldset>
  <details><summary>Engine evidence (open only after rating this card)</summary><ul>
  <li>Cold-end target: ${esc(fit?.coldTarget || 'unknown')}; warm-end target: ${esc(fit?.warmTarget || 'unknown')}</li>
  ${configurationLines.map(l => `<li>${l}</li>`).join('')}
  <li>Garment roles as returned: ${pieces.map(p => `${esc(p.name)}: ${esc(p.role || 'none')}`).join('; ')}</li>
  <li>Garment warmth labels: ${pieces.map(p => `${esc(p.name)}: ${esc(garmentWarmthLevel(p) || 'unknown')}`).join('; ')}</li>
  <li>Findings: ${findings.length ? findings.map(esc).join('<br>') : 'none'}</li></ul></details></section>`)
}
const conditions = included[0].conditions
const title = `Stage 1 review — ${scenarioKey}${preflight ? ' (PREFLIGHT, scripted cards)' : ''}`
const meta = { experiment: 'stage1-production-paths', scenario: scenarioKey, seed, preregistrationSha256, mode: manifest.mode || 'preflight', cardCount: cards.length, strongestPickIsDescriptiveOnly: true }
const html = `<title>${esc(title)}</title><style>
:root{--bg:#fbfaf7;--fg:#222;--muted:#555;--line:#ddd;--repair:#9a3b1a;--card:#fff}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#1b1a18;--fg:#eee;--muted:#aaa;--line:#444;--repair:#f0a080;--card:#242320}}
:root[data-theme="dark"]{--bg:#1b1a18;--fg:#eee;--muted:#aaa;--line:#444;--repair:#f0a080;--card:#242320}
body{background:var(--bg);color:var(--fg);font:14px system-ui;margin:0;padding:16px;max-width:1100px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin:12px 0}.card.needs-review{border-color:var(--repair)}
.position{margin:0;color:var(--muted);font-size:12px}.heading{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}.heading h2{margin:4px 0;font-size:17px}.badge{font-size:12px;color:var(--muted)}
.review-notice{color:var(--repair);font-size:12px;display:grid;gap:4px;margin:6px 0}.flag,.note{font-size:12px;color:var(--muted)}
.photos{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}figure{margin:0;width:150px}img{width:140px;height:140px;object-fit:contain;background:#fff}
fieldset{margin-top:8px;display:grid;gap:6px}textarea{width:100%;box-sizing:border-box}.banner{background:#fff3cd;color:#222;padding:8px;border-radius:6px}
.export textarea{font:12px ui-monospace,monospace;min-height:120px}</style>
<h1>${esc(title)}</h1>${preflight ? '<p class="banner">Tool/payload preflight: these cards come from scripted model answers used to exercise the pipeline. They are not a preview of either flow&#39;s quality. Ratings on this sheet check the sheet&#39;s usability only.</p>' : ''}
<p>Conditions: ${esc(SCENARIOS?.[scenarioKey]?.situation || '')} Resolved by both flows: ${esc(conditions.highF)}/${esc(conditions.lowF)}°F, ${esc(conditions.location)}. ${cards.length} cards in random order; which flow and which run produced each card is hidden. Cards the app itself marked for review are shown that way, as a user would see them. Your lived-wear rating is the outcome being measured; the engine evidence under each card is raw data, not a judgment of whether the outfit is warm enough.</p>
${blocks.join('\n')}
<section class="card export"><h2>After rating every card</h2>
<label>Strongest card overall (descriptive only; not used in any comparison) <select id="strongest"><option></option>${cards.map((_, i) => `<option>${i + 1}</option>`).join('')}</select></label>
<label>Would you actually wear the strongest card in these conditions? <select id="strongest-wear"><option></option><option>yes</option><option>no</option></select></label>
<label>Sheet notes <textarea id="sheet-notes" rows="2"></textarea></label>
<p><button type="button" id="export">Export ratings</button> The blinded export (no flow or run information) appears below; it is also offered as a file download.</p>
<textarea id="export-output" readonly></textarea></section>
<script>
const SHEET = ${JSON.stringify(meta)};
document.getElementById('export').addEventListener('click', () => {
  const cards = [...document.querySelectorAll('section.card[data-position]')].map(section => {
    const field = name => section.querySelector('[data-field="' + name + '"]').value
    const score = name => field(name) === '' ? null : Number(field(name))
    return { position: Number(section.dataset.position), weatherAdequacy: score('weatherAdequacy'), styleIntent: score('styleIntent'), wouldWear: field('wouldWear') || null, notes: field('notes') }
  })
  const strongest = document.getElementById('strongest').value
  const out = { ...SHEET, exportedAt: new Date().toISOString(), cards,
    strongestPosition: strongest ? Number(strongest) : null, wouldWearStrongest: document.getElementById('strongest-wear').value || null,
    sheetNotes: document.getElementById('sheet-notes').value, unratedPositions: cards.filter(c => c.weatherAdequacy == null || c.styleIntent == null || !c.wouldWear).map(c => c.position) }
  const text = JSON.stringify(out, null, 2)
  document.getElementById('export-output').value = text
  try {
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    link.download = 'stage1-ratings-' + SHEET.scenario + '-' + SHEET.seed + '.json'
    link.click()
  } catch {}
})
</script>`
fs.writeFileSync(path.join(runDir, outName('.html')), html)
fs.writeFileSync(path.join(runDir, outName('.sealed-key.json')), JSON.stringify(key, null, 2))
console.log('review sheet', path.join(runDir, outName('.html')), 'cards', cards.length, 'seed', seed, 'photos', photoMode, 'worn-photo fallbacks', wornFallbacks, 'excluded replicates', exclusions.length)
