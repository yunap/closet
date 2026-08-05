// Migration step 4 (docs/capsule-roster-selection-spec.md §8): deterministic
// roster vs model-chosen roster, on the same wardrobe, same slots, same bench.
//
// Read-only. By default it constructs NO AI client and makes NO network request:
// it reports the deterministic side, the bench the model would choose from, and
// every measure the two will be compared on. That half is free and is what makes
// the eventual billed run one command instead of a project.
//
// The model side needs one provider call per scenario and is opt-in:
//   node scratch/compare_capsule_rosters.js --with-model
// Do not pass that flag casually — see the cost note this prints.

import fs from 'fs'
import path from 'path'
import { db, parsePiece } from '../db.js'
import {
  selectCapsuleRoster,
  buildCapsuleBench,
  validateCapsuleRoster,
  capsuleOutfitCoreCapacity,
  allocateCapsuleRepresentativeRotation,
  capsuleTotalOutfitCap,
  extractStatedPalette,
  selectCapsuleRosterViaModel
} from '../styling-engine/outfitSetPlanner.js'
import { wardrobeCategoryGroup, pieceFormality, formalityRank } from '../styling-engine/attributes.js'
import { filterWholeWardrobePiecesForGeneration, weatherProfileFromContext, pieceStyleProfile } from '../styling-engine/rules.js'

const WITH_MODEL = process.argv.includes('--with-model')
// CLI script safety: --dry-run validates inputs, prints the targeted scope and
// a cost estimate, and short-circuits before the first paid request.
const DRY_RUN = process.argv.includes('--dry-run')
// --scenario <substring>: run one scenario instead of all three. The model side
// bills per scenario, so this is the difference between ~$0.27 and ~$0.82 for a
// comparison — worth having when the question only needs one wardrobe shape.
const SCENARIO_ARG_INDEX = process.argv.indexOf('--scenario')
const SCENARIO_FILTER = SCENARIO_ARG_INDEX > -1 ? String(process.argv[SCENARIO_ARG_INDEX + 1] || '').toLowerCase() : ''
const VERBOSE = process.argv.includes('--verbose')
// Contact sheets are free local artifacts written only after a paid comparison
// returns. Override the parent directory when a caller wants a stable location.
const OUTPUT_ARG_INDEX = process.argv.indexOf('--output-dir')
const OUTPUT_ROOT = OUTPUT_ARG_INDEX > -1
  ? path.resolve(process.argv[OUTPUT_ARG_INDEX + 1] || '')
  : path.resolve('scratch/capsule_roster_comparisons')
// --live <file>: pin the slots from a real plan's saved capsulePlanContext, so
// both sides are measured on the ground an actual request produced rather than
// slots invented here. A synthetic "Restaurant Dinner" at occasion `evening`
// is far stricter than what the live plan actually decomposed (smart casual),
// and comparing against invented slots produced a misleading verdict once.
const LIVE_ARG_INDEX = process.argv.indexOf('--live')
const LIVE_PAYLOAD = LIVE_ARG_INDEX > -1 ? process.argv[LIVE_ARG_INDEX + 1] : null
// --bench-size N: this was hardcoded to 40 while production had already moved
// to 70 (selectCapsuleRosterViaModel's default), so the harness was measuring a
// bench nobody ships. Defaults to the production value; pass it explicitly to
// compare two widths on identical slots, which is the whole 40-vs-70 question.
// The A/B differ passes the SAME value to both checkouts.
const PRODUCTION_BENCH_SIZE = 70
const BENCH_SIZE_ARG_INDEX = process.argv.indexOf('--bench-size')
const BENCH_SIZE = BENCH_SIZE_ARG_INDEX > -1
  ? Math.max(1, Number.parseInt(process.argv[BENCH_SIZE_ARG_INDEX + 1], 10) || PRODUCTION_BENCH_SIZE)
  : PRODUCTION_BENCH_SIZE

const SCENARIOS = [
  {
    name: 'summer · mixed register',
    isSummer: true, budget: 24,
    question: 'I want a summer capsule',
    slots: [
      { id: 'home', label: 'At Home', occasion: 'casual', bestFor: 'low-key days at home', targetOutfits: 3 },
      { id: 'city', label: 'City Outings', occasion: 'city', activity: 'walking', bestFor: 'walking, museums', targetOutfits: 3 },
      { id: 'brunch', label: 'Brunch', occasion: 'smart casual', bestFor: 'brunch and galleries', targetOutfits: 2 },
      { id: 'dinner', label: 'Restaurant Dinner', occasion: 'evening', bestFor: 'restaurant dinner', environment: 'indoor', targetOutfits: 2 },
    ],
  },
  {
    name: 'summer · stated palette',
    isSummer: true, budget: 24,
    question: 'a summer capsule in black, cream and olive',
    slots: [
      { id: 'home', label: 'At Home', occasion: 'casual', bestFor: 'low-key days at home', targetOutfits: 3 },
      { id: 'city', label: 'City Outings', occasion: 'city', activity: 'walking', bestFor: 'walking, museums', targetOutfits: 3 },
      { id: 'dinner', label: 'Restaurant Dinner', occasion: 'evening', bestFor: 'restaurant dinner', environment: 'indoor', targetOutfits: 2 },
    ],
  },
  {
    name: 'winter · mixed register',
    isSummer: false, budget: 18,
    question: 'I want a winter capsule',
    slots: [
      { id: 'home', label: 'At Home', occasion: 'casual', bestFor: 'low-key days at home', targetOutfits: 3 },
      { id: 'city', label: 'City Outings', occasion: 'city', activity: 'walking', bestFor: 'walking, museums', targetOutfits: 2 },
      { id: 'dinner', label: 'Restaurant Dinner', occasion: 'evening', bestFor: 'restaurant dinner', environment: 'indoor', targetOutfits: 2 },
    ],
  },
]

const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)

function liveScenarioFrom(payloadPath) {
  const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'))
  const cards = payload.messages.slice(-1)[0].structuredOutfits || []
  const ctx = cards.find(card => card.capsulePlanContext)?.capsulePlanContext
  if (!ctx) throw new Error('no capsulePlanContext in that payload')
  const cardsPerSlot = new Map()
  for (const card of cards) {
    if (card.broken) continue
    cardsPerSlot.set(card.tripSlot, (cardsPerSlot.get(card.tripSlot) || 0) + 1)
  }
  return {
    name: 'LIVE plan slots (pinned from capsulePlanContext)',
    isSummer: !ctx.is_winter_capsule,
    budget: ctx.piece_budget,
    question: payload.messages.find(message => message.role === 'user')?.text || 'I want a summer capsule',
    slots: ctx.slots.map(slot => ({
      id: slot.id,
      label: slot.label,
      occasion: slot.occasion,
      activity: slot.activity,
      environment: slot.environment,
      bestFor: slot.label,
      weatherProfile: slot.weather_profile,
      targetOutfits: cardsPerSlot.get(slot.id) || 2,
    })),
  }
}

// Per-slot capacity means nothing without each slot's real gate result — the
// same filter buildPlanSlotWorkbench applies. Passing bare slots reports 0
// everywhere, which is a harness artifact, not a thin roster.
function gateSlotsFor(roster, slots, { isSummer, isWinter }) {
  return slots.map(slot => {
    const request = [slot.label, slot.bestFor].filter(Boolean).join('. ')
    const season = slot.environment === 'indoor' ? 'indoor' : (isSummer ? 'summer' : 'winter')
    const { allowedPieces } = filterWholeWardrobePiecesForGeneration(roster, {
      occasion: slot.occasion,
      explorationMode: 'moderate',
      // Prefer the weather the live plan actually resolved. Re-deriving it from
      // season/environment is an approximation, and approximating a gate is
      // what produced a wrong "this slot is starved" reading before.
      weatherProfile: slot.weatherProfile || weatherProfileFromContext({ mood: request, season }),
      mood: request,
      activity: slot.activity || 'none',
      request,
    })
    return { ...slot, gateAllowedIds: new Set(allowedPieces.map(piece => Number(piece.id))) }
  })
}

// Measured locally rather than imported, on purpose: this harness has to run
// against an OLDER baseline checkout, so it cannot depend on a symbol a newer
// engine exports. Both lenses are reported — the broad one is what the engine's
// statement guarantee now uses, the loud-print count is kept beside it because
// that is what the guarantee used to mean and the two must be readable apart
// when a roster changes.
function pieceVisualRoles(piece = {}) {
  const raw = piece?.style_profile_json
  const profile = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) } catch { return {} } })() : (raw || {})
  return Array.isArray(profile?.visual_roles) ? profile.visual_roles : []
}
function readsAsProtagonist(piece = {}) {
  if (!['top', 'bottom', 'dress'].includes(wardrobeCategoryGroup(piece))) return false
  return String(piece?.pattern_complexity || '').toLowerCase() === 'loud' || pieceVisualRoles(piece).includes('hero_piece')
}

function describeRoster(roster, { slots, budget, isSummer, isWinter, palette, bench }) {
  const gated = gateSlotsFor(roster, slots, { isSummer, isWinter })
  const group = g => roster.filter(piece => wardrobeCategoryGroup(piece) === g).length
  const colors = new Map()
  for (const piece of roster) {
    for (const color of Array.isArray(piece.colors) ? piece.colors : []) {
      const key = String(color).toLowerCase()
      colors.set(key, (colors.get(key) || 0) + 1)
    }
  }
  const topColors = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const allocation = allocateCapsuleRepresentativeRotation(gated, roster, { cap: capsuleTotalOutfitCap(budget) })
  const verdict = validateCapsuleRoster(roster, {
    slots, budget, isSummer, isWinterCapsule: isWinter, pool: bench,
    plannedCards: allocation.reduce((sum, slot) => sum + Math.max(0, Number(slot.targetOutfits) || 0), 0),
  })
  return {
    size: roster.length,
    categories: `${group('top')}T ${group('bottom')}B ${group('dress')}D ${group('outerwear')}O ${group('shoes')}S`,
    capacity: capsuleOutfitCoreCapacity(roster, gated),
    perSlot: allocation.map(slot => `${slot.label}:${slot.capsuleSlotCapacity}`).join(' '),
    statementPieces: roster.filter(readsAsProtagonist).length,
    loudPieces: roster.filter(piece => String(piece.pattern_complexity || '') === 'loud').length,
    dependents: roster.filter(piece => String(piece.needs_base || '').toLowerCase() === 'yes').length,
    elevatedShoes: roster.filter(piece => wardrobeCategoryGroup(piece) === 'shoes' && ['elevated', 'dressy'].includes(String(pieceFormality(piece)))).length,
    paletteMatch: palette.length
      ? `${roster.filter(piece => (piece.colors || []).some(c => palette.includes(String(c).toLowerCase()))).length}/${roster.length}`
      : '—',
    topColors: topColors.map(([color, n]) => `${color}×${n}`).join(' '),
    valid: verdict.ok ? 'PASS' : `FAIL(${verdict.failures.map(f => f.code).join(',')})`,
    failures: verdict.failures,
    gaps: (roster.postConditionGaps || []).join(',') || '—',
  }
}

function printRow(label, d) {
  console.log(`  ${label.padEnd(22)} ${String(d.size).padStart(2)} pieces  ${d.categories.padEnd(22)} cores ${String(d.capacity).padStart(3)}  statement ${d.statementPieces}(loud ${d.loudPieces})  elev-shoes ${d.elevatedShoes}  palette ${d.paletteMatch.padEnd(6)} ${d.valid}`)
  console.log(`  ${''.padEnd(22)} colours: ${d.topColors}`)
  console.log(`  ${''.padEnd(22)} per-slot capacity: ${d.perSlot}${d.gaps !== '—' ? `  | disclosed gaps: ${d.gaps}` : ''}`)
}

function printRoster(label, roster) {
  if (!VERBOSE) return
  console.log(`  ${label} roster:`)
  for (const piece of roster) {
    console.log(`    ${piece.id} · ${piece.name} · ${(piece.colors || []).join('/') || 'no-colour'}`)
  }
}

function printAttemptFailures(attempt, description) {
  const failures = description.failures || []
  if (!failures.length && !attempt.outsideBenchIds.length && !attempt.duplicateIds.length) {
    console.log(`  ${''.padEnd(22)} validation: PASS`)
    return
  }
  for (const failure of failures) {
    console.log(`  ${''.padEnd(22)} ${failure.code}: ${failure.message}`)
  }
  if (attempt.outsideBenchIds.length) {
    console.log(`  ${''.padEnd(22)} piece_outside_bench: ${attempt.outsideBenchIds.join(', ')}`)
  }
  if (attempt.duplicateIds.length) {
    console.log(`  ${''.padEnd(22)} duplicate ids: ${[...new Set(attempt.duplicateIds)].join(', ')}`)
  }
}

function printAttemptReasons(attempt) {
  if (attempt.categoryShapeReason) {
    console.log(`  ${''.padEnd(22)} category reasoning: ${attempt.categoryShapeReason}`)
  }
  for (const change of attempt.repairChanges || []) {
    console.log(`  ${''.padEnd(22)} repair reason: -${change.removed_piece_id} +${change.added_piece_id} · ${change.reason}`)
  }
}

function printRepairDelta(attempts) {
  if (attempts.length < 2) return
  const before = new Set(attempts[0].rosterPieceIds)
  const after = new Set(attempts[1].rosterPieceIds)
  const removed = [...before].filter(id => !after.has(id))
  const added = [...after].filter(id => !before.has(id))
  console.log(`  ${''.padEnd(22)} repair delta: -[${removed.join(', ') || 'none'}] +[${added.join(', ') || 'none'}]`)
}

function safeFilePart(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scenario'
}

function manifestPiece(piece = {}) {
  return {
    id: Number(piece.id),
    name: piece.name,
    category: wardrobeCategoryGroup(piece),
    colors: Array.isArray(piece.colors) ? piece.colors : [],
    photo: piece.worn_photo || piece.photo || ''
  }
}

// What a roster drawn from this bench could achieve AT BEST. The bench is the
// model's entire universe at stage 3, so a property no bench piece has is a
// property no roster can have — measurable with no model and no money.
// Reported against eligible supply because the raw counts mean nothing without
// the denominator: 3 dresses is starvation out of 14 and everything there is
// out of 3.
function benchHeadroom(bench, eligible) {
  const isHero = piece => {
    const roles = pieceStyleProfile(piece)?.visual_roles || []
    return piece.pattern_complexity === 'loud' || (Array.isArray(roles) && roles.includes('hero_piece'))
  }
  const isElevatedShoe = piece => wardrobeCategoryGroup(piece) === 'shoes' &&
    (formalityRank(pieceFormality(piece)) ?? -1) >= formalityRank('elevated')
  const count = (list, group) => list.filter(piece => wardrobeCategoryGroup(piece) === group).length
  const shape = list => `${count(list, 'top')}T ${count(list, 'bottom')}B ${count(list, 'dress')}D ${count(list, 'outerwear')}O ${count(list, 'shoes')}S`
  return {
    shape: shape(bench),
    eligibleShape: shape(eligible),
    heroCapable: bench.filter(isHero).length,
    eligibleHeroCapable: eligible.filter(isHero).length,
    elevatedShoes: bench.filter(isElevatedShoe).length,
    eligibleElevatedShoes: eligible.filter(isElevatedShoe).length
  }
}

// One line per measure, each a stable `key: value` so the A/B differ can
// compare them without re-deriving anything. Printed unconditionally (not only
// under --verbose) so a non-verbose run still shows what the model would see.
function printBenchHeadroom(head) {
  console.log(`  bench shape: ${head.shape}  (eligible supply: ${head.eligibleShape})`)
  console.log(`  bench headroom: hero-capable ${head.heroCapable}/${head.eligibleHeroCapable}  elevated-shoes ${head.elevatedShoes}/${head.eligibleElevatedShoes}`)
}

console.log(`wardrobe: ${allPieces.length} active pieces · model side: ${WITH_MODEL ? 'ENABLED (billed)' : 'skipped (free run)'}\n`)

const allScenarios = LIVE_PAYLOAD ? [liveScenarioFrom(LIVE_PAYLOAD)] : SCENARIOS
const scenarios = SCENARIO_FILTER
  ? allScenarios.filter(entry => entry.name.toLowerCase().includes(SCENARIO_FILTER))
  : allScenarios
if (SCENARIO_FILTER && !scenarios.length) {
  console.error(`No scenario matches "${SCENARIO_FILTER}". Available: ${allScenarios.map(entry => entry.name).join(' | ')}`)
  process.exit(2)
}
if (SCENARIO_FILTER) console.log(`(scenario filter "${SCENARIO_FILTER}": ${scenarios.length} of ${allScenarios.length})\n`)

for (const scenario of scenarios) {
  const { name, slots, budget, isSummer, question } = scenario
  const isWinter = !isSummer
  const { colors: palette } = extractStatedPalette(question, allPieces)
  const { bench, diagnostics } = buildCapsuleBench(allPieces, { budget, slots, isSummer, isWinter, benchSize: BENCH_SIZE, palette })
  // The denominator for every headroom number below: everything that passes at
  // least one slot's gates, i.e. what the bench is sampling FROM. benchSize is
  // deliberately absurd rather than "unlimited" — buildCapsuleBench never
  // returns more than the eligible pool, so this is the pool itself.
  const { bench: eligible } = buildCapsuleBench(allPieces, { budget, slots, isSummer, isWinter, benchSize: Number.MAX_SAFE_INTEGER, palette })

  console.log(`── ${name} · budget ${budget} · "${question}"`)
  // benchSize is stated because it is now a variable, and a comparison run that
  // silently used a different one on each side would be worse than no run.
  console.log(`  bench ${bench.length} of ${eligible.length} eligible · benchSize ${BENCH_SIZE} · ${diagnostics.admittedByGuaranteeCount} guaranteed + ${bench.length - diagnostics.admittedByGuaranteeCount} target-fill` +
    `${palette.length ? ` · palette asked for: ${palette.join(', ')}` : ' · no palette stated'}` +
    `${diagnostics.uncoverableSlots.length ? ` · uncoverable: ${diagnostics.uncoverableSlots.join(', ')}` : ''}`)
  // benchSize is a cost ceiling and wins over the category targets, so a target
  // the bench could not afford is stated rather than absorbed silently.
  if (diagnostics.unmetTargets?.length) {
    console.log(`  bench unmet targets: ${diagnostics.unmetTargets.map(entry => `${entry.group} ${entry.actual}/${entry.target} (of ${entry.eligible} eligible)`).join(', ')}`)
  }
  printBenchHeadroom(benchHeadroom(bench, eligible))
  printRoster('bench', bench)

  const deterministic = selectCapsuleRoster(allPieces, {
    budget, isSummer, isWinter, occasions: slots.map(s => s.occasion), slots, palette,
  })
  printRow('deterministic', describeRoster(deterministic, { slots, budget, isSummer, isWinter, palette, bench }))
  printRoster('deterministic', deterministic)

  if (WITH_MODEL) {
    const {
      chooseCapsuleRosterForComparison, previewCapsuleRosterCall, describePreview, assertPhotosResolve,
      comparisonAttempts, resetComparisonAttempts, renderRosterContactSheet
    } = await import('./_capsule_model_chooser.js')
    // Scope and spend, printed before anything is billed. --dry-run stops here
    // (CLI script safety: a preview mode that short-circuits before the first
    // paid request, validating inputs and estimating cost).
    const preview = previewCapsuleRosterCall({ bench, budget, label: name })
    console.log(describePreview(preview))
    assertPhotosResolve(preview)
    if (DRY_RUN) {
      console.log('  --dry-run: stopping before the provider call.\n')
      continue
    }
    resetComparisonAttempts()
    const result = await selectCapsuleRosterViaModel({
      pool: allPieces, budget, slots, isSummer, isWinter,
      occasions: slots.map(s => s.occasion), palette,
      chooseRoster: chooseCapsuleRosterForComparison,
    })

    // Print and render what the model ACTUALLY chose before production replaced
    // an invalid answer with the deterministic fallback.
    for (const attempt of comparisonAttempts) {
      const description = describeRoster(attempt.roster, { slots, budget, isSummer, isWinter, palette, bench })
      printRow(`model attempt ${attempt.attempt}`, description)
      printRoster(`model attempt ${attempt.attempt}`, attempt.roster)
      printAttemptFailures(attempt, description)
      printAttemptReasons(attempt)
    }
    printRepairDelta(comparisonAttempts)

    printRow(`model (${result.source})`, describeRoster(result.roster, { slots, budget, isSummer, isWinter, palette, bench }))
    printRoster(`model (${result.source})`, result.roster)
    if (result.palette) console.log(`  ${''.padEnd(22)} model's palette: ${result.palette}`)
    for (const job of (result.jobs || []).slice(0, 6)) console.log(`  ${''.padEnd(22)} ${job.piece_id}: ${job.job}`)

    const runDir = path.join(
      OUTPUT_ROOT,
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeFilePart(name)}`
    )
    const engineSheet = path.join(runDir, 'engine-roster.png')
    await renderRosterContactSheet({ roster: deterministic, label: `Engine roster · ${name}`, outPath: engineSheet })
    const attemptSheets = []
    for (const attempt of comparisonAttempts) {
      const outPath = path.join(runDir, `model-attempt-${attempt.attempt}.png`)
      const description = describeRoster(attempt.roster, { slots, budget, isSummer, isWinter, palette, bench })
      const status = description.failures.length ? `INVALID · ${description.failures.map(f => f.code).join(', ')}` : 'VALID'
      await renderRosterContactSheet({
        roster: attempt.roster,
        label: `Model attempt ${attempt.attempt} · ${status} · ${name}`,
        outPath
      })
      attemptSheets.push(outPath)
    }
    const manifest = {
      scenario: { name, budget, question, slots },
      result: { source: result.source, failureCodes: result.failureCodes || [] },
      engine: deterministic.map(manifestPiece),
      attempts: comparisonAttempts.map(attempt => {
        const description = describeRoster(attempt.roster, { slots, budget, isSummer, isWinter, palette, bench })
        return {
          attempt: attempt.attempt,
          requestedIds: attempt.requestedIds,
          outsideBenchIds: attempt.outsideBenchIds,
          duplicateIds: attempt.duplicateIds,
          palette: attempt.palette,
          categoryShapeReason: attempt.categoryShapeReason,
          repairChanges: attempt.repairChanges,
          pieceJobs: attempt.jobs,
          failures: description.failures,
          roster: attempt.roster.map(manifestPiece)
        }
      }),
      sheets: { engine: engineSheet, modelAttempts: attemptSheets }
    }
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'comparison.json'), JSON.stringify(manifest, null, 2))
    console.log(`  visual comparison written to: ${runDir}`)
  }
  console.log()
}

if (!WITH_MODEL) {
  console.log('The model side was not run: it needs one provider call per scenario (a bench of')
  console.log(`${BENCH_SIZE} with thumbnails). Everything above is the free half — the deterministic`)
  console.log('baseline and the exact measures the comparison uses.')
  console.log('')
  console.log('  node scratch/compare_capsule_rosters.js --with-model --dry-run   # scope + cost, spends nothing')
  console.log('  node scratch/compare_capsule_rosters.js --with-model             # runs it')
} else if (!DRY_RUN) {
  const { comparisonUsage } = await import('./_capsule_model_chooser.js')
  console.log('what the model side actually spent:')
  console.log(`  ${comparisonUsage.calls} roster call(s) · in ${comparisonUsage.inputTokens.toLocaleString()} · out ${comparisonUsage.outputTokens.toLocaleString()}` +
    ` · cache read ${comparisonUsage.cacheReadInputTokens.toLocaleString()} · cache creation ${comparisonUsage.cacheCreationInputTokens.toLocaleString()}`)
  // A repair attempt reuses the cached prefix (#200), so a second call on the
  // same bench should read far more than it creates. If it does not, the cache
  // breakpoint has regressed.
  if (comparisonUsage.calls > 1 && comparisonUsage.cacheReadInputTokens < comparisonUsage.cacheCreationInputTokens) {
    console.log('  NOTE: a repair attempt created more cache than it read — the roster-call cache prefix may have regressed.')
  }
}
