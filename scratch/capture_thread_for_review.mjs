#!/usr/bin/env node
// One self-contained capture of a single stylist thread, for external review.
//
// Emits Markdown to stdout: EVERY turn in order — what was asked, what tool path answered it, what
// was shown, and (for turns with cards) what the engine told the model about each candidate versus
// what the model chose. That last contrast is the reviewable unit — "the engine ranked X, the model
// picked Y" — and nothing else in the repo produces it.
//
//   node scratch/capture_thread_for_review.mjs <thread_id> [> review.md]
//
// Reads a DB copy. Never writes. Set WARDROBE_DB_PATH to an isolated copy (docs/database-safety.md);
// bring the -wal sidecar or you will silently read a stale snapshot.
//
// v2: rewritten after a real external-review miss. The v1 script picked ONE "final" turn (the last
// one with cards attached) and showed only that — collapsing all OTHER turns into one undifferentiated
// blockquote in "what the user asked", with no visible turn boundaries and no per-turn diagnostics. A
// reviewer reading v1's output on thread_1788430055577 concluded the WEEK-LONG TRIP REQUEST fell
// through to search_wardrobe/propose_outfit instead of plan_outfit_set — it didn't; a LATER, separate
// single-card follow-up did. v1's own structure made that impossible to see: every turn's request,
// response and diagnostics were merged into one page with no way to tell which turn produced which
// tool sequence. v1 also cited the wrong freeform_generation_runs row in its diagnostics footer (always
// "latest run in session" rather than the run matching the displayed turn) — same root cause, a single-
// turn mental model applied to a multi-turn thread.
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
const p = s => console.log(s)

function guessSeason(ts) {
  const mo = new Date(String(ts || '').replace(' ', 'T') + 'Z').getUTCMonth()
  return mo >= 2 && mo <= 4 ? 'spring' : mo >= 5 && mo <= 7 ? 'summer' : mo >= 8 && mo <= 10 ? 'fall' : 'winter'
}

p(`# Thread capture — \`${threadId}\``)
p(`\n**Title:** ${row.title || '(untitled)'}  `)
p(`**Created:** ${row.created_at} · **Updated:** ${row.updated_at}`)

// Persisted packing-roster state (stylist_conversation_state) — the SET-level evidence that the
// trip roster architecture actually produced something, distinct from the per-turn diagnostic
// counters below (which show the model call happened; this shows what it left behind). One row
// per session, always the latest snapshot, so this is necessarily whole-thread, not per-turn — a
// roster-only edit turn leaves it unchanged rather than clearing it (docs/README.md), so its
// absence after a real trip request is itself the finding, not a gap in this script.
{
  const stateRow = db.prepare('SELECT state_json, updated_at FROM stylist_conversation_state WHERE session_id = ?').get(threadId)
  const state = stateRow ? JSON.parse(stateRow.state_json || '{}') : null
  const packingRoster = state?.packing_roster || null
  p(`\n**Persisted packing roster** (as of ${stateRow?.updated_at || 'n/a'}): `
    + (packingRoster
      ? `packingRoster count \`${(packingRoster.roster_ids || []).length}\`, tripRequirementSlots count \`${(packingRoster.slots || []).length}\``
      : '`(none — no trip roster in persisted state for this thread)`'))
}

// A provider that changes mid-thread is ambiguous without this: it can be independent per-turn
// routing, or a manual "Retry with Sonnet" click (owner's own words: not automatic failover, just a
// click when a non-Sonnet reply is slow, fails, or reads poorly). Found live on this exact thread,
// where a manual click was mis-read as a server restart because nothing distinguished it. Fields are
// set client-side (StylistChat.jsx) only when present; their absence on older threads means the
// marker didn't exist yet, not that no retry happened.
const manualRetries = messages
  .map((m, i) => ({ m, i }))
  .filter(({ m }) => m.manualRetry || m.manualRetryResend)
if (manualRetries.length) {
  p('')
  for (const { m, i } of manualRetries) {
    p(`> ⚠ message [${i}] (${m.role}) is a manual "Retry with Sonnet" ${m.role === 'user' ? 'resend' : `result (forced provider: ${m.manualProviderOverride})`} — not independent routing.`)
  }
}

// ── Per-turn join: no message carries a run id, so this joins assistant turns to
// freeform_generation_runs POSITIONALLY (both are strictly chronological per-thread). Verified exact
// on real threads, but stated honestly: if the counts disagree, turns past the shorter list show no
// run-sourced diagnostics rather than a guessed one — a wrong join is worse than a missing one, which
// is exactly the failure mode this rewrite exists to remove.
// `provider` is unset only on the static greeting bubble (no real generation happened) — every
// actual turn sets it. Excluding the greeting from the join was itself a bug found writing this:
// it silently shifted every subsequent turn's run-join by one position.
const turns = messages.map((m, i) => ({ m, i })).filter(({ m }) => m.role === 'assistant' && m.provider)
const runs = db.prepare('SELECT * FROM freeform_generation_runs WHERE session_id = ? ORDER BY id ASC').all(threadId)
if (turns.length !== runs.length) {
  p(`\n> ⚠ ${turns.length} assistant turns but ${runs.length} persisted run rows — the positional join below may be misaligned for turns past index ${Math.min(turns.length, runs.length) - 1}. Diagnostics for those turns are read from the message's own \`debug\` field only (still correct); the \`freeform_generation_runs\` token citation is omitted rather than guessed.`)
}

p(`\n---\n\n## Turns\n`)
p(`${turns.length} assistant turn(s) across this thread. Each is its own tool-routing decision — do not`)
p(`generalize from one turn's tool sequence to another; the router sees only that turn's request.\n`)

turns.forEach(({ m: asst, i: asstIdx }, turnNumber) => {
  const userMsg = [...messages.slice(0, asstIdx)].reverse().find(x => x.role === 'user')
  const run = runs[turnNumber] // may be undefined; guarded below
  const dbg = asst.debug || {}
  const cards = asst.structuredOutfits || []

  p(`### Turn ${turnNumber + 1} — message [${asstIdx}] (${asst.provider || '?'}/${asst.model || '?'})\n`)
  if (userMsg) p(`**Asked:** ${String(userMsg.text || '').trim().replace(/\n/g, ' ')}\n`)
  p('**Shown:**')
  p('```text')
  p(String(asst.text || '(no visible answer)').trim().slice(0, 2000))
  p('```')

  p('\n**Diagnostics:**')
  p('```text')
  const keys = ['weatherSource', 'executionProfile', 'toolSequence', 'searchCalls', 'planOutfitSetCalls',
    'submitPlanCalls', 'submitPlanValidationFails', 'submitPlanResubmits', 'submitPlanPartialAccepts',
    'providerIterations', 'gateExcludedTotal', 'closingProseWithheld', 'cardProseInconsistentBlocks',
    'planSlotActivityInferred', 'planSlotEnvironmentInferred',
    // Trip-roster activation (docs/README.md: trip roster architecture). thread_1788484052964 and
    // thread_1788488744055 both looked plausible in prose while the roster architecture had either
    // not activated (plan_kind never resolved to 'trip') or had no production chooser to call at
    // all — neither was visible without reconstructing it after the fact. These make "did the
    // production trip-roster path actually run this turn" a direct read instead of a reconstruction.
    'planKindResolved', 'tripRosterModelCalls', 'tripRosterModelRepairs', 'tripRosterModelFallbacks']
  let any = false
  for (const k of keys) {
    if (dbg[k] !== undefined) { p(`${k.padEnd(32)} ${JSON.stringify(dbg[k])}`); any = true }
  }
  if (!any) p('(no debug block persisted on this message)')
  p('```')
  if (run && turns.length === runs.length) {
    p(`Persisted run row \`freeform_generation_runs.id=${run.id}\` (${run.created_at}), tokens: `
      + `in ${run.provider_input_tokens ?? '?'} / out ${run.provider_output_tokens ?? '?'} / `
      + `cache-read ${run.provider_cache_read_input_tokens ?? '?'}.`)
  }

  // ── the decisive contrast, only for turns that actually delivered cards ───────────────────────
  if (cards.length) {
    p(`\n**Cards delivered, and what the engine said about each piece:**`)
    p(`\`engine\` columns are what the planner computed and handed the model BEFORE it composed. A`)
    p(`piece marked \`discouraged\` that still appears is the model overriding the engine.\n`)
    const calendarSeason = dbg.calendarSeason || guessSeason(row.created_at)
    let overrides = 0
    for (const [ci, card] of cards.entries()) {
      const wx = card.resolvedWeatherContext?.temperature || {}
      const weather = { highF: wx.high_f, lowF: wx.low_f, source: wx.source, isHot: wx.is_hot, isCold: wx.is_cold }
      const exposure = resolveExposureContext({ activity: card.activity, environment: card.environment }, weather)
      const demand = requiredThermalBand(exposure)
      p(`Card ${ci + 1} — ${card.occasion || '?'} / ${card.activity || '?'} · weather: \`${card.weatherUsed || '?'}\` · thermal demand: \`${slotThermalDemandLabel(exposure) || 'none'}\` · calendar: \`${calendarSeason}\`\n`)
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
    p(`**${overrides} piece placement(s) across ${cards.length} card(s) in this turn used a garment the engine marked \`discouraged\`.**`)

    const firstCard = cards[0]
    const wx = firstCard.resolvedWeatherContext?.temperature || {}
    const weather = { highF: wx.high_f, lowF: wx.low_f, source: wx.source }
    const exposure = resolveExposureContext({ activity: firstCard.activity, environment: firstCard.environment }, weather)
    const outer = db.prepare("SELECT * FROM pieces WHERE status='active' AND lower(category)='outerwear'").all().map(parsePiece)
    const ranked = outer.map(piece => {
      const t = thermalFitPieceAdvisory(piece, weather, exposure)
      const s = seasonFitPieceAdvisory(piece, guessSeason(row.created_at))
      return { piece, score: t.score + s.score, t, s }
    }).sort((a, b) => b.score - a.score)
    p(`\nWhat the engine ranked highest for this turn's conditions (\`${firstCard.weatherUsed}\`, ${firstCard.activity || 'unknown activity'}):\n`)
    p('| rank | piece | combined | thermal | season |')
    p('|---|---|---|---|---|')
    for (const [ri, r] of ranked.slice(0, 5).entries()) p(`| ${ri + 1} | ${r.piece.name} | ${r.score} | ${r.t.tier} | ${r.s.tier} |`)
    for (const r of ranked.slice(-2)) p(`| … | ${r.piece.name} | ${r.score} | ${r.t.tier} | ${r.s.tier} |`)
  }
  p('\n---\n')
})

p(`## How to reproduce these numbers\n`)
p('```bash')
p(`WARDROBE_DB_PATH=<db copy> node scratch/capture_thread_for_review.mjs ${threadId}`)
p('node scratch/qa_thermal_shipped_path.mjs          # deterministic QA of the shipped thermal path')
p('node scratch/census_thermal_demand_consumers.mjs  # who still reads legacy cold flags')
p('```')
