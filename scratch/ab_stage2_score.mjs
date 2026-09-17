// Stage 2 scorer (scratch/ab_stage2_preregistration.json; deviation: review/DEVIATION-round2.md). Offline, read-only.
// Joins the locked owner exports with the sealed keys and the frozen raw outputs and computes the pre-registered
// outcomes. Judgement-based coding (construction acknowledgement, a layer's endpoint purpose) is NOT inferred here:
// the verbatim text is listed for the owner to code.
// usage: node scratch/ab_stage2_score.mjs --run-root scratch/ab_stage2_runs/2026-09-14
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const runRoot = path.resolve(REPO, value('--run-root') || 'scratch/ab_stage2_runs/2026-09-14')
const live = path.join(runRoot, 'live'), review = path.join(runRoot, 'review'), exportsR2 = path.join(review, 'exports', 'r2')
const outDir = path.join(review, 'results'); fs.mkdirSync(outDir, { recursive: true })
const sha = v => crypto.createHash('sha256').update(v).digest('hex')
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'))
const latestExport = prefix => { const f = fs.readdirSync(exportsR2).filter(n => n.startsWith(prefix) && n.endsWith('.json')).sort().pop(); if (!f) throw new Error(`missing export ${prefix}`); return readJson(path.join(exportsR2, f)) }

const dbCopy = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-score-db-'))
for (const f of ['wardrobe.db', 'wardrobe.db-wal', 'wardrobe.db-shm', 'system.db', 'system.db-wal', 'system.db-shm']) { const src = path.join(runRoot, 'final_snapshot', f); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dbCopy, f)) }
process.on('exit', () => fs.rmSync(dbCopy, { recursive: true, force: true }))
process.env.NODE_ENV = 'test'; process.env.WARDROBE_DB_PATH = path.join(dbCopy, 'wardrobe.db'); process.env.WARDROBE_SYSTEM_DB_PATH = path.join(dbCopy, 'system.db'); process.env.WARDROBE_UPLOADS_DIR = path.join(REPO, 'uploads')
const { db, parsePiece } = await import(`${REPO}/db.js`)
const { evaluateWearableOutfit } = await import(`${REPO}/styling-engine/outfitValidation.js`)
const { resolveComposerSlotOutfit } = await import(`${REPO}/styling-engine/composerSlots.js`)
const { SCENARIOS } = await import(`${REPO}/scratch/ab_stage1_scenarios.mjs`)
const prereg = readJson(path.join(REPO, 'scratch', 'ab_stage2_preregistration.json'))

const round = (x, d = 2) => x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
function attemptOutcome(cards) {
  if (!cards.length) return { computable: false, cards: 0 }
  return { computable: true, cards: cards.length, meanWeather: round(mean(cards.map(c => c.weatherAdequacy))), meanStyle: round(mean(cards.map(c => c.styleIntent))),
    wouldWearProportion: round(cards.filter(c => c.wouldWear === 'yes').length / cards.length), bestWeather: Math.max(...cards.map(c => c.weatherAdequacy)), bestStyle: Math.max(...cards.map(c => c.styleIntent)),
    atLeastOneWouldWear: cards.some(c => c.wouldWear === 'yes') }
}
const METRICS = ['meanWeather', 'meanStyle', 'wouldWearProportion', 'bestWeather', 'bestStyle']
const rawOutfitsOf = (contract, attemptDir) => readJson(path.join(live, attemptDir, 'attempt.json')).experiment?.raw?.outfits || []

// ── B and C card ratings joined to their sealed keys ──
function joinedCards(sheetId, exportPrefix) {
  const key = readJson(path.join(review, 'r2', `${sheetId}.sealed-key.json`))
  const exp = latestExport(exportPrefix)
  if (exp.seed !== key.seed || exp.preregSha256 !== key.preregSha256) throw new Error(`${sheetId}: export does not match its sealed key`)
  const ratings = new Map(exp.cards.map(c => [c.cardId, c]))
  const cards = key.cards.map(k => ({ ...k, ...ratings.get(k.cardId), outfit: rawOutfitsOf(k.contract, k.attemptDir)[k.rawOutputIndex] }))
  if (cards.some(c => c.weatherAdequacy == null || c.styleIntent == null || !c.wouldWear)) throw new Error(`${sheetId}: unrated cards`)
  return { key, cards }
}
const B = joinedCards('stage2-B-cards-r2', 'stage2-B-cards-r2-')
const C = joinedCards('stage2-C-stage1-cards-r2', 'stage2-C-stage1-cards-r2-')

function attemptsFor(contract, joined) {
  const manifest = readJson(path.join(live, `ab2_live_${contract}`, 'manifest.json'))
  return manifest.attempts.map(a => {
    const [r, scenario, arm] = a.key.split(':')
    const failure = joined.key.failures.find(f => f.attempt === a.key)
    const cards = joined.cards.filter(c => c.attempt === a.key)
    return { attempt: a.key, scenario, replicate: Number(r.slice(1)), arm, failed: Boolean(failure), failure: failure?.reason || null, outcome: attemptOutcome(cards), cards }
  })
}
const Battempts = attemptsFor('B', B), Cattempts = attemptsFor('C', C)

const pairs = (attempts, armA, armB, extra = () => ({})) => Object.keys(SCENARIOS).flatMap(scenario => [1, 2].map(replicate => {
  const a = attempts.find(x => x.scenario === scenario && x.replicate === replicate && x.arm === armA)
  const b = attempts.find(x => x.scenario === scenario && x.replicate === replicate && x.arm === armB)
  const failed = [a, b].filter(x => x.failed)
  if (failed.length) return { scenario, replicate, computable: false, excludedBecause: failed.map(x => `${x.attempt} returned no cards (${x.failure})`), unpairedDescriptive: [a, b].filter(x => !x.failed).map(x => ({ attempt: x.attempt, ...x.outcome })) }
  return { scenario, replicate, computable: true, [armA]: a.outcome, [armB]: b.outcome, difference: Object.fromEntries(METRICS.map(m => [`${m} (${armB}−${armA})`, round(b.outcome[m] - a.outcome[m])])), ...extra(a, b, scenario, replicate) }
}))

const Bpairs = pairs(Battempts, 'B0', 'B1')
const equalPositions = prereg.contracts.C.outcome1_perCardQuality.equalCardPositions
const Cpairs = pairs(Cattempts, 'N1', 'N5', (n1, n5, scenario, replicate) => {
  const position = equalPositions[`r${replicate}:${scenario}`]
  const single = n1.cards[0], equal = n5.cards.find(c => c.rawOutputIndex === position - 1)
  return { equalCard: { preregisteredPosition: position, N1: { cardId: single.cardId, weather: single.weatherAdequacy, style: single.styleIntent, wouldWear: single.wouldWear }, N5: equal ? { cardId: equal.cardId, weather: equal.weatherAdequacy, style: equal.styleIntent, wouldWear: equal.wouldWear } : null } }
})

// Stage 2 set judgments (C), reported separately from per-card quality.
const s2key = readJson(path.join(review, 'r2', 'stage2-C-stage2-groups-r2.sealed-key.json'))
const s2 = latestExport('stage2-C-stage2-groups-r2-')
if (s2.seed !== s2key.seed) throw new Error('C stage 2 export does not match its sealed key')
const Cstage2 = s2key.groups.map(g => {
  const ans = s2.groups.find(x => x.groupId === g.groupId) || {}
  const strongest = C.cards.find(c => c.cardId === ans.strongest)
  return { groupId: g.groupId, attempt: g.attempt, scenario: g.scenario, replicate: g.replicate, arm: g.arm, cards: g.cardIds.length, failed: g.failed,
    ownerAtLeastOne: g.failed ? null : ans.atLeastOne, strongestCard: strongest ? { cardId: strongest.cardId, weather: strongest.weatherAdequacy, style: strongest.styleIntent, wouldWear: strongest.wouldWear } : null, notes: ans.notes || '' }
})
const productUtility = Cattempts.map(a => ({ attempt: a.attempt, scenario: a.scenario, replicate: a.replicate, arm: a.arm, zeroCardFailure: a.failed,
  atLeastOneWouldWearFromCardRatings: a.failed ? false : a.outcome.atLeastOneWouldWear, bestWeather: a.outcome.bestWeather ?? null, bestStyle: a.outcome.bestStyle ?? null,
  stage2AtLeastOne: Cstage2.find(g => g.attempt === a.attempt)?.ownerAtLeastOne ?? null }))

// ── A ──
const Amarks = readJson(path.join(review, 'exports', 'stage2-A-evidence-marking-none.json'))
const truth = { 144: 'workable', 184: 'workable', 238: 'unworkable' }
const Acalls = readJson(path.join(live, 'ab2_live_A', 'manifest.json')).calls.map(call => {
  const [r, inner] = call.attempt.split(':')
  const a = readJson(path.join(live, 'ab2_live_A', `${inner}-${r}`, 'attempt.json'))
  const raw = a.raw || {}
  const marks = Amarks.calls.find(c => c.call === call.attempt)?.items || []
  const schemaCompliance = { sleeveTreatmentWhenWorkable: raw.verdict !== 'workable' || Boolean(raw.sleeve_treatment), uncertaintyReasonWhenUncertain: raw.verdict !== 'genuinely_uncertain' || Boolean(raw.uncertainty_reason) }
  return { call: call.attempt, inner: Number(inner), verdict: raw.verdict, truth: truth[inner], agrees: raw.verdict === truth[inner], genuinelyUncertain: raw.verdict === 'genuinely_uncertain',
    evidenceItems: (raw.construction_evidence || []).length, citedSources: (raw.construction_evidence || []).map(e => e.source),
    marks: { supported: marks.filter(m => m.support === 'supported').length, unsupported: marks.filter(m => m.support === 'unsupported').length, inventedInference: marks.filter(m => m.inventedInference).length, items: marks },
    schemaCompliance }
})

// ── S3 warm-end evidence (offline evaluator, raw cards; roles from the model's own slots, nothing repaired) ──
const stage1Manifest = readJson(path.join(REPO, 'scratch', 'ab_stage1_runs', '2026-09-14', 'live_run', 'manifest.json'))
const s3Profile = stage1Manifest.cells.find(c => c.scenario === 'S3' && c.arm === 'bundle' && c.neutralVerdicts)?.weatherProfileForEvaluation
const pieceRow = id => { const row = db.prepare('SELECT * FROM pieces WHERE id = ?').get(Number(id)); return row ? parsePiece(row) : null }
function s3Evidence(card) {
  const ids = ['base_top_id', 'dress_id', 'middle_layer_id', 'outer_layer_id', 'bottom_id', 'shoes_id'].map(k => card.outfit?.[k]).filter(v => v != null)
  const candidates = ids.map(pieceRow).filter(Boolean)
  const slots = resolveComposerSlotOutfit(card.outfit || {}, candidates)
  const ev = evaluateWearableOutfit(slots.pieces, { requireShoes: true, roleAware: true, includeLayerDirections: true, weatherContext: { weatherProfile: s3Profile, activity: 'none' } })
  const fit = ev?.stages?.find(s => s.stage === 'environment')?.result?.evidence?.endpointFit
  const configs = fit?.configurations || []
  const lightest = configs.find(c => c.removedPieceId === 'all_layers') || configs.filter(c => c.removedPieceId !== null).slice(-1)[0] || configs.find(c => c.removedPieceId === null)
  return { cardId: card.cardId, contract: card.contract, arm: card.arm, replicate: card.replicate, label: card.outfit?.label,
    pieces: slots.pieces.map(p => `${p.id} ${p.name} [${p.role || 'no role'}]`), warmTarget: fit?.warmTarget ?? null,
    lightestConfiguration: lightest ? { removed: lightest.removedPieceId, level: lightest.unknown ? 'unknown' : lightest.level, warmEndDistance: lightest.warmDelta ?? null } : null,
    stylingInstructions: card.outfit?.styling_instructions ?? null, watchFor: card.outfit?.watchFor ?? null, reason: card.outfit?.reason ?? null,
    owner: { weather: card.weatherAdequacy, style: card.styleIntent, wouldWear: card.wouldWear, notes: card.notes } }
}
const S3 = [...B.cards, ...C.cards].filter(c => c.scenario === 'S3').map(s3Evidence)

// ── control-garment appearances (verbatim, for owner coding) ──
const CONTROLS = [131, 142, 144, 184, 238, 349]
const controls = [...B.cards, ...C.cards].flatMap(c => {
  const ids = Object.entries(c.outfit || {}).filter(([k, v]) => k.endsWith('_id') && v != null).map(([k, v]) => [k, Number(v)])
  return ids.filter(([, id]) => CONTROLS.includes(id)).map(([slot, id]) => ({ garment: id, slot, cardId: c.cardId, contract: c.contract, scenario: c.scenario, replicate: c.replicate, arm: c.arm,
    otherSlots: Object.fromEntries(ids.filter(([s]) => s !== slot)), stylingInstructions: c.outfit?.styling_instructions ?? null, watchFor: c.outfit?.watchFor ?? null,
    owner: { weather: c.weatherAdequacy, style: c.styleIntent, wouldWear: c.wouldWear, notes: c.notes } }))
})

const results = {
  preregistrationSha256: sha(fs.readFileSync(path.join(REPO, 'scratch', 'ab_stage2_preregistration.json'))),
  deviation: 'B and C card ratings are round 2 (review/DEVIATION-round2.md); round-1 B/C exports are recorded but not scored as the result',
  A: { calls: Acalls, perPair: Object.fromEntries([144, 184, 238].map(id => { const cs = Acalls.filter(c => c.inner === id); return [id, { truth: truth[id], agreement: `${cs.filter(c => c.agrees).length}/${cs.length}`, uncertain: cs.filter(c => c.genuinelyUncertain).length, supported: cs.reduce((n, c) => n + c.marks.supported, 0), unsupported: cs.reduce((n, c) => n + c.marks.unsupported, 0), inventedInference: cs.reduce((n, c) => n + c.marks.inventedInference, 0) }] })) },
  B: { attempts: Battempts.map(({ cards, ...a }) => a), pairs: Bpairs },
  C: { attempts: Cattempts.map(({ cards, ...a }) => a), pairs: Cpairs, productUtility, stage2: Cstage2 },
  S3WarmEnd: S3,
  controlGarments: controls,
}
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2))
console.log(`wrote ${path.join(outDir, 'results.json')}`)
db.close()
