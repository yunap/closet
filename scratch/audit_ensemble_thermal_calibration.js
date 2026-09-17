// Ensemble thermal calibration audit — owner-directed, fourth revision, 2026-09-12.
//
// WHAT THE PREVIOUS CANDIDATE GOT WRONG (owner): it separated forecast precision from clothing
// tolerance at the warm end and then re-conflated them at the cold end, on the rationale "you can't
// put on what you didn't bring". Which garments you brought determines the AVAILABLE CONFIGURATIONS;
// it says nothing about how finely a five-level ordinal scale can distinguish comfort. A precise
// PET-derived target does not prove that one level below it is physically inadequate.
//
// THE MODEL UNDER REVIEW:
//   · PET supplies the preferred RANKING target at each endpoint.
//   · Realistic removable configurations are enumerated and each endpoint asks one question:
//         does AT LEAST ONE configuration suit this point in the day?
//   · An adjacent one-level difference — either direction — affects ranking and may support a soft
//     note. It is never on its own a mechanical inadequacy.
//   · Mechanical inadequacy is reserved for a SUBSTANTIAL mismatch (>= 2 ordinal levels with no
//     configuration inside the adjacent band) or for the independent physical requirements that
//     remain untouched by this model: severe-cold presence, outdoor capability, sleeve-bearing
//     transit coverage, rain protection.
//   · Cold-end overshoot is REPORTED, never discarded — harmless when another configuration works,
//     but that is evidence, not an assumption.
//   · `lower` (bottom-half warmth) is AUDIT EVIDENCE ONLY. It is deliberately not proposed as a
//     production field: under "new structure must earn its keep" it needs a real consumer first.
//
// PRODUCTION IS UNCHANGED. This script only reports what the candidate would say.
//
// Usage: node scratch/audit_ensemble_thermal_calibration.js
import { createIsolatedDbSnapshot } from '../lib/databaseSafety.js'

const isolated = createIsolatedDbSnapshot()
process.env.WARDROBE_DB_PATH = isolated.dbPath

const { db, parsePiece } = await import('../db.js')
const { wardrobeCategoryGroup } = await import('../styling-engine/attributes.js')
const { garmentWarmthLevel, warmthIsRemovable, WARMTH_LEVELS } = await import('../styling-engine/garmentWarmth.js')
const { requiredThermalEndpointBands } = await import('../styling-engine/thermalDemand.js')
const { resolveExposureContext } = await import('../styling-engine/exposure.js')
const { outfitThermalContribution } = await import('../styling-engine/outfitThermalContribution.js')
const { evaluateAutomaticUsePiecePool, evaluateVisualComposerPiecePool } = await import('../styling-engine/eligibility.js')

const IDX = new Map(WARMTH_LEVELS.map((level, i) => [level, i]))
const warmer = (a, b) => (a == null ? b : b == null ? a : (IDX.get(a) >= IDX.get(b) ? a : b))
const stepUp = level => WARMTH_LEVELS[Math.min(WARMTH_LEVELS.length - 1, IDX.get(level) + 1)]
const P = id => parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(id))
const short = piece => `${piece.id}:${String(piece.name || '').trim().slice(0, 18)}`
const pad = (v, n) => String(v ?? '—').padEnd(n)
const signed = n => (n == null ? '—' : `${n >= 0 ? '+' : ''}${n}`)

const ADJACENT = 1 // one ordinal level: ranking signal and soft note, never a mechanical failure

// Upper-body contribution; the layering step is taken on the weaker UPPER half (owner ruling R1).
// `lower` is collected for the audit only.
function upperContribution(pieces) {
  let upperBase = null, upperRemovable = null, lower = null
  for (const piece of pieces) {
    const level = garmentWarmthLevel(piece)
    if (level == null) continue
    const group = wardrobeCategoryGroup(piece)
    if (warmthIsRemovable(piece)) upperRemovable = warmer(upperRemovable, level)
    else if (group === 'top' || group === 'dress') upperBase = warmer(upperBase, level)
    else if (group === 'bottom') lower = warmer(lower, level)
  }
  const system = upperBase == null || upperRemovable == null
    ? (upperBase ?? upperRemovable)
    : warmer(warmer(upperBase, upperRemovable), stepUp(IDX.get(upperBase) <= IDX.get(upperRemovable) ? upperBase : upperRemovable))
  return { upperBase, upperRemovable, system, lower }
}

function configurations(pieces) {
  const removables = pieces.filter(warmthIsRemovable)
  const states = [{ label: 'all layers on', pieces }]
  for (const layer of removables) {
    states.push({ label: `minus ${short(layer)}`, pieces: pieces.filter(p => Number(p.id) !== Number(layer.id)) })
  }
  if (removables.length > 1) states.push({ label: 'no layers', pieces: pieces.filter(p => !warmthIsRemovable(p)) })
  return states.map(state => ({ ...state, c: upperContribution(state.pieces) }))
}

// One endpoint, one question: does at least one configuration suit it?
function endpointVerdict(states, target) {
  const deltas = states.map(state => ({
    state,
    delta: state.c.system == null || !target ? null : IDX.get(state.c.system) - IDX.get(target),
  })).filter(entry => entry.delta != null)
  if (!deltas.length) return { verdict: 'unknown', best: null, deltas }
  const withinBand = deltas.filter(entry => Math.abs(entry.delta) <= ADJACENT)
  const best = deltas.reduce((a, b) => (Math.abs(a.delta) <= Math.abs(b.delta) ? a : b))
  if (withinBand.length) {
    const exact = withinBand.find(entry => entry.delta === 0)
    return {
      verdict: exact ? 'fits (on target)' : `fits (adjacent ${signed(best.delta)})`,
      soft: exact ? '' : `one level ${best.delta < 0 ? 'under' : 'over'} the preferred target`,
      best, deltas,
    }
  }
  return {
    verdict: best.delta < 0 ? 'SUBSTANTIAL SHORTFALL' : 'SUBSTANTIAL EXCESS',
    soft: '', best, deltas,
  }
}

const endpointsFor = (highF, lowF) => requiredThermalEndpointBands(resolveExposureContext({}, {
  highF, lowF, isCold: lowF <= 45, needsRemovableCoolLayer: lowF > 45 && lowF < 64, weatherSource: 'stated_user',
}))

function auditCard({ label, ids, highF, lowF, verbose = true }) {
  const pieces = ids.map(P)
  const ends = endpointsFor(highF, lowF)
  const states = configurations(pieces)
  const cold = endpointVerdict(states, ends.cold.level)
  const warm = endpointVerdict(states, ends.warm.level)
  const prod = outfitThermalContribution(pieces)

  if (verbose) {
    console.log(`\n  ${label}`)
    console.log(`    targets: cold=${ends.cold.level}  warm=${ends.warm.level}   (ranking preference only)`)
    console.log(`    pieces: ${pieces.map(p => `${short(p)}(${garmentWarmthLevel(p) ?? 'untagged'})`).join(' | ')}`)
    console.log(`    ${pad('configuration', 26)} ${pad('upperSys', 10)} ${pad('lower*', 10)} cold Δ  warm Δ`)
    for (const state of states) {
      const cd = cold.deltas.find(entry => entry.state === state)
      const wd = warm.deltas.find(entry => entry.state === state)
      console.log(`    ${pad(state.label, 26)} ${pad(state.c.system, 10)} ${pad(state.c.lower, 10)} ${String(signed(cd?.delta)).padStart(5)}  ${String(signed(wd?.delta)).padStart(6)}`)
    }
    console.log(`    COLD endpoint: ${cold.verdict}${cold.soft ? `  — soft note: ${cold.soft}` : ''}   best via "${cold.best?.state.label}"`)
    console.log(`    WARM endpoint: ${warm.verdict}${warm.soft ? `  — soft note: ${warm.soft}` : ''}   best via "${warm.best?.state.label}"`)
    const coldOver = cold.deltas.filter(entry => entry.delta >= 1)
    if (coldOver.length) {
      const harmless = cold.deltas.some(entry => Math.abs(entry.delta) <= ADJACENT)
      console.log(`    cold-end overshoot reported: ${coldOver.map(entry => `${entry.state.label} ${signed(entry.delta)}`).join(', ')}${harmless ? '  (another configuration suits the cold end)' : ''}`)
    }
    console.log(`    production today: full system=${prod.withLayer} -> ${prod.withLayer === ends.cold.level ? 'adequate' : 'undershoot/overshoot vs single demand'}`)
  }
  return { label, cold: cold.verdict, warm: warm.verdict, coldSoft: cold.soft, warmSoft: warm.soft }
}

function layerLadder({ baseIds, highF, lowF, calendarSeason }) {
  const wp = { isHot: false, isCold: lowF <= 45, isExtremeHeat: false, isColdSevere: false, needsRemovableCoolLayer: lowF > 45 && lowF < 64, highF, lowF, weatherSource: 'stated_user' }
  const all = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const context = { occasion: 'casual', season: calendarSeason || 'fall', calendarSeason, currentDate: new Date(), explorationMode: 'moderate', weatherProfile: wp, mood: '', activity: 'none' }
  const auto = evaluateAutomaticUsePiecePool({ pieces: all, context, policy: { anchorPieceIds: [], hotOuterwearCap: 3 } })
  const pool = evaluateVisualComposerPiecePool({ pieces: auto.eligiblePieces, context: { ...context, requestText: '', question: '' }, policy: { maxImages: 90 } })
  const layers = pool.eligiblePieces.filter(p => wardrobeCategoryGroup(p) === 'outerwear')
  const base = baseIds.map(P)
  const ends = endpointsFor(highF, lowF)
  console.log(`\n--- layer ladder over ${base.map(short).join(' + ')} at ${highF}/${lowF} — roster ${calendarSeason ? 'WITH' : 'WITHOUT'} season gate (${layers.length} layers)`)
  console.log(`    targets: cold=${ends.cold.level} warm=${ends.warm.level}`)
  console.log(`    ${pad('layer', 28)} ${pad('level', 10)} ${pad('cold endpoint', 22)} ${pad('warm endpoint', 22)} rank(cold Δ best)`)
  for (const layer of layers) {
    const states = configurations([...base, layer])
    const cold = endpointVerdict(states, ends.cold.level)
    const warm = endpointVerdict(states, ends.warm.level)
    console.log(`    ${pad(short(layer), 28)} ${pad(garmentWarmthLevel(layer) ?? 'untagged', 10)} ${pad(cold.verdict, 22)} ${pad(warm.verdict, 22)} ${signed(cold.best?.delta)}`)
  }
}

const SHIPPED_CARDS = [
  { label: 'O1 Striped Tee + Gray Fleece', ids: [265, 89, 214, 996762] },
  { label: 'O2 Graphic Tee + Gray Jacket', ids: [351, 230, 195, 159] },
  { label: 'O3 Mustard Knit + Cream Cardigan', ids: [84, 109, 215, 990362] },
  { label: 'O4 Stripe Top + Vest + Denim', ids: [266, 142, 105, 214] },
  { label: 'O5 Asymmetrical + Navy Puffer', ids: [220, 119, 215, 996866] },
  { label: "owner's example: 84 sweater + 109 denim + 996762 fleece", ids: [84, 109, 996762] },
]

console.log('CANDIDATE MODEL v2 — adjacency is a ranking signal, not a verdict')
console.log('mechanical inadequacy only for a substantial (>=2 level) mismatch with no configuration in the adjacent band')
console.log('* lower = audit evidence only; not proposed as a production field')

console.log('\n\n================ THE SHIPPED CARDS + THE NAMED EXAMPLE, 65/50 ================')
const results = SHIPPED_CARDS.map(card => auditCard({ ...card, highF: 65, lowF: 50 }))
console.log('\n---- summary ----')
for (const r of results) console.log(`    ${pad(r.label, 52)} cold: ${pad(r.cold, 22)} warm: ${r.warm}`)

console.log('\n\n================ THE NAMED LAYER LADDER ================')
layerLadder({ baseIds: [84, 109], highF: 65, lowF: 50, calendarSeason: 'fall' })
layerLadder({ baseIds: [84, 109], highF: 65, lowF: 50, calendarSeason: '' })

console.log('\n\n================ 45/35 — EVERY CARD SHOWN, NOT SUMMARISED ================')
for (const card of SHIPPED_CARDS.slice(0, 5)) auditCard({ ...card, highF: 45, lowF: 35 })

console.log('\n\n================ 72/62 REGRESSION WATCH ================')
const mild = SHIPPED_CARDS.slice(0, 5).map(card => auditCard({ ...card, highF: 72, lowF: 62, verbose: false }))
for (const r of mild) console.log(`    ${pad(r.label, 36)} cold: ${pad(r.cold, 22)} warm: ${r.warm}`)


// ════════════════════════════════════════════════════════════════════════════════════════════════
// SEVERE-COLD BACKSTOP REGRESSION — canonical path only
//
// The previous revision of this audit hand-built a 45/35 profile with `isColdSevere: false` and then
// concluded, wrongly, that the freezing backstop was weak. It had not been exercised at all:
// `hasMinimumWarmLayer()` is only the PRELIMINARY presence floor, and the severe branch that follows
// it checks outdoor capability and system cold evidence.
//
// So this section builds NOTHING by hand. It resolves the weather through the production
// classification (`createStylingContextResolver` -> `resolveStylingContext`, the same path the
// composer and /ask use, including `isColdSevere` and `coldPresenceRequirement`) and evaluates the
// COMPLETE `evaluateOutfitEnvironmentalAdequacy()`, printing every hard and advisory finding.
const { createStylingContextResolver } = await import('../styling-engine/stylingContext.js')
const { evaluateOutfitEnvironmentalAdequacy } = await import('../styling-engine/outfitEnvironmentalAdequacy.js')

const resolveContext = createStylingContextResolver({ weatherResolver: async () => ({ status: 'unavailable' }) })

async function canonicalProfile({ highF, lowF, statedWeather = '' }) {
  const context = await resolveContext({
    explicitRequest: {
      occasion: 'casual', season: 'winter', location: 'Walnut Creek, CA', date: new Date(),
      userWeather: { high_f: highF, low_f: lowF }, statedWeather,
    },
    policy: { allowLiveWeather: false, requireOccasion: false },
  })
  return context.weatherProfile
}

const untaggedLayer = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  .find(p => wardrobeCategoryGroup(p) === 'outerwear' && garmentWarmthLevel(p) == null)

const MEASURED_BASE = [84, 109, 215]        // moderate sweater + moderate denim + shoes
const LIGHT_BASE = [233, 110, 215]          // light graphic tee + light-ish crop jeans + shoes

async function severeColdFixtures({ label, highF, lowF, statedWeather }) {
  const profile = await canonicalProfile({ highF, lowF, statedWeather })
  console.log(`\n--- ${label}: ${highF}/${lowF}${statedWeather ? ` (statedWeather=${statedWeather})` : ''}`)
  console.log(`    canonical profile: isCold=${profile.isCold} isColdSevere=${profile.isColdSevere} isIndoor=${Boolean(profile.isIndoor)} transitIsCold=${Boolean(profile.transitIsCold)} transitIsColdSevere=${Boolean(profile.transitIsColdSevere)}`)
  console.log(`    coldPresenceRequirement: ${profile.coldPresenceRequirement?.state} (${profile.coldPresenceRequirement?.rationale || ''})`)
  const fixtures = [
    ['light cashmere vest as the only layer', [...MEASURED_BASE, 142]],
    ['light open cardigan as the only layer', [...MEASURED_BASE, 990362]],
    ['grey fleece coat', [...MEASURED_BASE, 996762]],
    ['navy quilted puffer', [...MEASURED_BASE, 996866]],
    [`untagged outer layer (${untaggedLayer ? short(untaggedLayer) : 'none found'})`, untaggedLayer ? [...MEASURED_BASE, Number(untaggedLayer.id)] : null],
    ['known outdoor coat over a measured-light base', [...LIGHT_BASE, 996867]],
  ]
  for (const [name, ids] of fixtures) {
    if (!ids) { console.log(`    ${pad(name, 46)} (skipped: no fixture available)`); continue }
    const result = evaluateOutfitEnvironmentalAdequacy(ids.map(P), { weatherProfile: profile, environment: profile.isIndoor ? 'indoor' : 'outdoor' })
    const hard = result.hardFindings.map(f => f.code)
    const advisory = result.advisoryFindings.map(f => f.code)
    console.log(`    ${pad(name, 46)}`)
    console.log(`        hard:     ${hard.length ? hard.join(', ') : '(none)'}`)
    console.log(`        advisory: ${advisory.length ? advisory.join(', ') : '(none)'}`)
    const fit = result.evidence?.severeColdFit
    if (fit) console.log(`        severeColdFit: ${fit.verdict} (target ${fit.target} via ${fit.targetSource}, bestDelta ${fit.bestDelta})`)
  }
}

console.log('\n\n================ SEVERE-COLD BACKSTOP — canonical weather + complete evaluator ================')
await severeColdFixtures({ label: 'sustained outdoor, severe cold', highF: 35, lowF: 25 })
await severeColdFixtures({ label: 'sustained outdoor, cold (not severe)', highF: 45, lowF: 38 })
await severeColdFixtures({ label: 'indoor destination with cold transit', highF: 35, lowF: 25, statedWeather: 'indoor' })

isolated.cleanup()
