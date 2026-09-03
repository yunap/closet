#!/usr/bin/env node
// One self-contained capture of a single stylist thread, for external review.
//
// Emits Markdown to stdout: what the user asked, what they were shown, what the ENGINE told the
// model about each candidate, and what the model chose instead. That last contrast is the reviewable
// unit — "the engine ranked X, the model picked Y" — and nothing else in the repo produces it.
//
//   node scratch/capture_thread_for_review.mjs <thread_id> [> review.md]
//
// Reads a DB copy. Never writes. Set WARDROBE_DB_PATH to an isolated copy (docs/database-safety.md);
// bring the -wal sidecar or you will silently read a stale snapshot.
import { wardrobeCategoryGroup } from '../styling-engine/attributes.js'
const threadId = process.argv[2]
if (!threadId) { console.error('usage: capture_thread_for_review.mjs <thread_id>'); process.exit(1) }

const { db, parsePiece } = await import('../db.js')
const { thermalFitPieceAdvisory, seasonFitPieceAdvisory, slotThermalDemandLabel } = await import('../styling-engine/outfitSetPlanner.js')
const { resolveExposureContext } = await import('../styling-engine/exposure.js')
const { requiredThermalBand } = await import('../styling-engine/thermalDemand.js')
const { garmentWarmthLevel } = await import('../styling-engine/garmentWarmth.js')

const row = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(threadId)
if (!row) { console.error(`thread ${threadId} not found`); process.exit(1) }
const payload = JSON.parse(row.payload || '{}')
const messages = payload.messages || []
const final = [...messages].reverse().find(m => m.role === 'assistant' && (m.structuredOutfits || []).length) || messages[messages.length - 1] || {}
const cards = final.structuredOutfits || []
const p = s => console.log(s)

p(`# Thread capture — \`${threadId}\``)
p(`\n**Title:** ${row.title || '(untitled)'}  `)
p(`**Created:** ${row.created_at} · **Updated:** ${row.updated_at}  `)
p(`**Provider/model:** ${final.provider || '?'} / ${final.model || '?'}`)

p(`\n---\n\n## 1. What the user asked\n`)
for (const m of messages.filter(m => m.role === 'user')) p(`> ${String(m.text || '').trim().replace(/\n/g, '\n> ')}`)

p(`\n---\n\n## 2. What the user was shown\n`)
p('```text')
p(String(final.text || '(no visible answer)').trim())
p('```')

// ── the decisive contrast ────────────────────────────────────────────────────────────────────
p(`\n---\n\n## 3. Cards delivered, and what the engine said about each piece\n`)
p(`\`engine\` columns are what the planner computed and handed the model BEFORE it composed.`)
p(`A piece marked \`discouraged\` that still appears is the model overriding the engine.\n`)

const calendarSeason = (final.debug?.calendarSeason) || guessSeason(row.created_at)
function guessSeason(ts) {
  const mo = new Date(String(ts || '').replace(' ', 'T') + 'Z').getUTCMonth()
  return mo >= 2 && mo <= 4 ? 'spring' : mo >= 5 && mo <= 7 ? 'summer' : mo >= 8 && mo <= 10 ? 'fall' : 'winter'
}

let overrides = 0
for (const [i, card] of cards.entries()) {
  const wx = card.resolvedWeatherContext?.temperature || {}
  const weather = { highF: wx.high_f, lowF: wx.low_f, source: wx.source, isHot: wx.is_hot, isCold: wx.is_cold }
  const exposure = resolveExposureContext({ activity: card.activity, environment: card.environment }, weather)
  const demand = requiredThermalBand(exposure)
  p(`### Card ${i + 1} — ${card.occasion || '?'} / ${card.activity || '?'}`)
  p(`weather: \`${card.weatherUsed || '?'}\` · thermal demand: \`${slotThermalDemandLabel(exposure) || 'none'}\` · calendar: \`${calendarSeason}\`\n`)
  p('| piece | category | season tag | warmth | engine: thermal | engine: season |')
  p('|---|---|---|---|---|---|')
  for (const piece of card.pieces || []) {
    const full = db.prepare('SELECT * FROM pieces WHERE id = ?').get(Number(piece.id))
    const parsed = full ? parsePiece(full) : piece
    const t = thermalFitPieceAdvisory(parsed, weather, exposure)
    const s = seasonFitPieceAdvisory(parsed, calendarSeason)
    if (t.tier === 'discouraged' || s.tier === 'discouraged') overrides++
    p(`| ${piece.name} | ${wardrobeCategoryGroup(parsed)} | ${parsed.season || '—'} | ${garmentWarmthLevel(parsed) || 'unknown'} | **${t.tier}** ${t.reason ? `— ${t.reason}` : ''} | **${s.tier}** ${s.reason ? `— ${s.reason}` : ''} |`)
  }
  p('')
}
p(`**${overrides} piece placement(s) across ${cards.length} cards used a garment the engine marked \`discouraged\`.**`)

// ── what the engine would have preferred ─────────────────────────────────────────────────────
p(`\n---\n\n## 4. What the engine ranked highest, per card's conditions\n`)
const firstCard = cards[0]
if (firstCard) {
  const wx = firstCard.resolvedWeatherContext?.temperature || {}
  const weather = { highF: wx.high_f, lowF: wx.low_f, source: wx.source }
  const exposure = resolveExposureContext({ activity: firstCard.activity, environment: firstCard.environment }, weather)
  const outer = db.prepare("SELECT * FROM pieces WHERE status='active' AND lower(category)='outerwear'").all().map(parsePiece)
  const ranked = outer.map(piece => {
    const t = thermalFitPieceAdvisory(piece, weather, exposure)
    const s = seasonFitPieceAdvisory(piece, calendarSeason)
    return { piece, score: t.score + s.score, t, s }
  }).sort((a, b) => b.score - a.score)
  p(`Outer layers at \`${firstCard.weatherUsed}\`, ${firstCard.activity || 'unknown activity'}:\n`)
  p('| rank | piece | combined | thermal | season |')
  p('|---|---|---|---|---|')
  for (const [i, r] of ranked.slice(0, 6).entries()) {
    p(`| ${i + 1} | ${r.piece.name} | ${r.score} | ${r.t.tier} | ${r.s.tier} |`)
  }
  const worst = ranked.slice(-3)
  for (const r of worst) p(`| … | ${r.piece.name} | ${r.score} | ${r.t.tier} | ${r.s.tier} |`)
}

// ── turn diagnostics ─────────────────────────────────────────────────────────────────────────
p(`\n---\n\n## 5. Turn diagnostics\n`)
const dbg = final.debug || {}
p('```text')
for (const k of ['weatherSource', 'executionProfile', 'toolSequence', 'searchCalls', 'planOutfitSetCalls',
  'submitPlanCalls', 'submitPlanValidationFails', 'submitPlanResubmits', 'submitPlanPartialAccepts',
  'providerIterations', 'gateExcludedTotal', 'closingProseWithheld', 'cardProseInconsistentBlocks',
  'planSlotActivityInferred', 'planSlotEnvironmentInferred']) {
  if (dbg[k] !== undefined) p(`${k.padEnd(32)} ${JSON.stringify(dbg[k])}`)
}
p('```')

const run = db.prepare('SELECT * FROM freeform_generation_runs WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(threadId)
if (run) {
  p(`\nPersisted run row \`freeform_generation_runs.id=${run.id}\` (${run.created_at}), tokens: `
    + `in ${run.provider_input_tokens ?? '?'} / out ${run.provider_output_tokens ?? '?'} / `
    + `cache-read ${run.provider_cache_read_input_tokens ?? '?'}.`)
}

p(`\n---\n\n## 6. How to reproduce these numbers\n`)
p('```bash')
p(`WARDROBE_DB_PATH=<db copy> node scratch/capture_thread_for_review.mjs ${threadId}`)
p('node scratch/qa_thermal_shipped_path.mjs          # deterministic QA of the shipped thermal path')
p('node scratch/census_thermal_demand_consumers.mjs  # who still reads legacy cold flags')
p('```')
