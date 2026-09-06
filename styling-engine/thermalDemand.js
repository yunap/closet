// Slice 3 of docs/thermal-comfort-band-spec.md §9.1 — `requiredThermalBand`.
//
// The demand half of `contribution >= demand`. It answers only "how much thermal capacity do these
// conditions call for", never "which garment". Supply is garmentWarmth.js's; the comparison is §16's.
//
// NO PRODUCTION CONSUMERS. §8 step 1. Nothing calls this yet, by design.
//
// EXPOSURE IS A NAMED, REQUIRED INPUT (§9.1) — not a field reached out of a weather blob. It comes
// from exposure.js's resolveExposureContext, which owns "what will this outfit actually meet".
// Passing a bare forecast here would repeat this arc's signature failure: a correct primitive fed
// the wrong inputs, which is how a 5am trough came to size a museum visit.
import { WARMTH_LEVELS, LEVEL_RAW_BOUNDARIES } from './garmentWarmth.js'

const LEVEL_INDEX = new Map(WARMTH_LEVELS.map((l, i) => [l, i]))

// STATED CALIBRATION, validated against §12.1's pinned cases — not derived from a comfort equation.
// §11.7 refuses the apparatus (PMV, IREQ, metabolic watts), so there is no equation to derive from,
// and inventing one would be the fake precision §11.8 prohibits. These are the temperatures at
// which a sedentary, ordinary-exposure person needs each level, chosen so the pinned cases hold and
// stated plainly so they can be argued with.
//
// Anchored where the reference table CAN anchor (§15.3): the middle of the scale corresponds to
// ordinary indoor-to-outdoor autumn dressing, which is exactly the band the CBE/ASHRAE garment
// entries cover. The top is an ordinal extension (§15.5) and gets no temperature claim beyond
// "colder than the range our anchors cover".
const SEDENTARY_DEMAND_F = [
  { atOrAbove: 75, level: 'very light' },
  { atOrAbove: 66, level: 'light' },
  { atOrAbove: 56, level: 'moderate' },
  { atOrAbove: 44, level: 'warm' },
  { atOrAbove: -Infinity, level: 'very warm' },
]

// Exertion lowers required insulation at the same ambient temperature — the relationship §11.1 took
// from the cold-exercise literature and the reason a hiker and a stationary diner must not resolve
// to the same demand. Ordinal steps, never a metabolic rate (§7 of the exposure spec).
//
// `unknown` deliberately shifts nothing: absent exertion is not an assertion of stillness, and
// exposure.js keeps that distinction precisely so this layer cannot lose it.
const EXERTION_SHIFT = { unknown: 0, none: 0, walking: -1, hiking: -2 }

// A climate-controlled destination. Anchored rather than stated: the CBE/ASHRAE ensembles for
// ordinary heated indoor wear (trousers + long-sleeve shirt ~0.61 clo) sit squarely in the middle
// of the garment table, which places the base at `light`. The outside temperature does not govern
// it — that is the transit window's job, returned separately.
const INDOOR_BASE_DEMAND = 'light'

function levelAt(tempF) {
  for (const row of SEDENTARY_DEMAND_F) if (tempF >= row.atOrAbove) return row.level
  return 'very warm'
}
const shift = (level, by) =>
  WARMTH_LEVELS[Math.max(0, Math.min(WARMTH_LEVELS.length - 1, LEVEL_INDEX.get(level) + by))]

/**
 * @param {object} exposure  an ExposureContext from exposure.js — REQUIRED, and its `unknown`
 *                           values are honoured rather than defaulted.
 * @returns {object} { level, range: [lo, hi], certain, basis }
 *   `range` is the band. When conditions are coarse it spans more than one level: §5.8 requires
 *   coarse conditions be consumed as UNCERTAINTY, never as measurement. Replacing "47°F is falsely
 *   precise" with "53.3°F is falsely precise" is the failure that requirement exists to prevent.
 */
export function requiredThermalBand(exposure = null) {
  const c = exposure?.conditions
  if (!c || !c.known || !Number.isFinite(c.wakingLowF)) {
    return { level: null, range: null, certain: false, basis: 'no_conditions' }
  }

  // The COLD end of the exposure window sets the requirement: an outfit must work at the coolest
  // moment it is worn through, and a removable layer is how the warm end is handled. That is
  // §5.5's removability axis doing its own job rather than the demand absorbing it.
  const exertion = EXERTION_SHIFT[exposure.exertion] ?? 0
  const outdoorDemand = shift(levelAt(c.wakingLowF), exertion)

  // §5.7: an indoor destination excuses the BASE, never the trip — and the two are returned
  // separately so a consumer cannot blend them back together.
  //
  // A first version returned the outdoor demand as the base for an indoor slot, which over-dresses
  // the base for a heated restaurant: the same error the 47°F trough produced, inverted. A climate-
  // controlled destination is an indoor-comfort problem, and that is precisely the band the
  // reference anchors DO cover (§15.3).
  const indoor = exposure.exposureMode === 'indoor_destination'
  const level = indoor ? INDOOR_BASE_DEMAND : outdoorDemand
  const transit = exposure.transit?.applies
    ? { level: shift(levelAt(exposure.transit.conditions?.wakingLowF ?? c.wakingLowF), 0) }
    : null

  // THE REMOVABLE LAYER IS NOT EXERTING WHEN IT MATTERS. The exertion shift above is correct for
  // the BASE — a hiker generates heat and needs less insulation at the same ambient — but applying
  // it to the outer layer sizes the jacket for the middle of the climb, which is the one moment the
  // jacket is off. The layer is for the trailhead, the stops, the shade, the walk back.
  //
  // This is §5.5's error on the exertion axis: the demand absorbing removability instead of leaving
  // it to the removability axis. `transit` above already had the right shape for the same reason on
  // the time axis — an indoor destination excuses the base, never the trip — so this returns the
  // layer separately rather than blending it back in.
  //
  // Live cost of the blend (thread_1788425468666): 65/48°F October, waking low 54°F. Sedentary
  // demand at 54°F is `warm`; hiking shifts it to `light`; the only `light` outerwear in the
  // wardrobe is a sheer shrug, two knit cardigans and a technical hoodie. The engine recommended
  // the hoodie for an October nature walk and ranked every real jacket below it.
  //
  // The layer's band is the WAKING WINDOW ITSELF, not a ±1 uncertainty cuff: the layer is carried
  // across the whole day, so the warm end caps it as surely as the cold end sets it. That is what
  // keeps a `very warm` puffer overshooting a 54–65°F day while a `warm` cardigan sits inside it.
  //
  // The discount is CAPPED, not dropped. Dropping it entirely over-corrects: a city sightseeing day
  // is mostly spent moving, and sizing its coat for a standstill puts a fleece on a 65°F afternoon —
  // the same error inverted, which is this arc's signature way of failing. Exertion is INTERMITTENT,
  // and one step is what that intermittency is worth: a hiker's base gets the full -2 because they
  // are climbing, while the jacket they take off at the top gets -1 because they are not climbing
  // the whole time. Walking's -1 is already within the cap and so is unchanged.
  //
  // Built from the TRIP's conditions when the destination is indoors — an outer layer on a museum
  // day answers to the walk there, never to the heated gallery. That is the same thing `transit`
  // says; the layer is where it becomes usable, as one demand-shaped object with a level and a
  // range that agree. Returning transit's level beside the slot's range was measuring distance from
  // one band's centre against another band's edges.
  const layerExertion = Math.max(-1, exertion)
  const lc = (exposure.transit?.applies && exposure.transit.conditions) || c
  const layerLevel = shift(levelAt(lc.wakingLowF ?? c.wakingLowF), layerExertion)
  const layer = {
    level: layerLevel,
    range: [shift(levelAt(lc.wakingHighF ?? lc.dailyHighF ?? lc.wakingLowF ?? c.wakingLowF), layerExertion), layerLevel],
    certain: !c.coarse,
  }

  // Uncertainty. A coarse window is an estimate of which hours are met, so the true demand could sit
  // a level either side. An anchored (`explicit_hourly`) reading would collapse this to a point.
  const spread = c.coarse ? 1 : 0
  const range = [shift(level, -spread), shift(level, spread)]

  return {
    level,
    range,
    certain: !c.coarse,
    basis: c.conditionsSource,
    exertionApplied: exposure.exertion,
    transit,
    layer,
  }
}

/**
 * Compare supply against demand. Overshoot is a RANKING signal, never an exclusion (§5.5): a
 * wardrobe whose only layer is a heavy coat still gets dressed.
 *
 * `very warm` is a BOUNDED CEILING (§15.5) — no tier above it, and no numeric distance is reported
 * beyond the ordinal gap, because the anchors cannot support one.
 */
export function compareThermalFit(garmentLevel, demand) {
  if (!garmentLevel || !demand?.level) return { fit: 'unknown', steps: null, distance: null }
  const g = LEVEL_INDEX.get(garmentLevel)
  const [lo, hi] = demand.range.map(l => LEVEL_INDEX.get(l))
  // Distance from the band's TARGET, not from its edges. Membership alone cannot express preference:
  // on a genuinely cold day an uncertainty band spans moderate..very warm, so a cardigan and a
  // puffer are both "adequate" and the ordering pinned rows 1 and 3 need would be lost. Ranking
  // reads `distance`; gating reads `fit`.
  const distance = g - LEVEL_INDEX.get(demand.level)
  if (g < lo) return { fit: 'undershoot', steps: lo - g, distance }
  if (g > hi) return { fit: g - hi >= 2 ? 'substantial_overshoot' : 'overshoot', steps: g - hi, distance }
  return { fit: 'adequate', steps: 0, distance }
}

// docs/thermal-ranking-source-sensitivity-and-overshoot-policy-spec.md — the shared RANKING
// primitive. Consolidates what were two independently-drifting inline formulas
// (styling-engine/rules.js's weatherFitForPiece and buildVisualComposerRoster) behind one function.
//
// Deliberately separate from compareThermalFit above: `fit`/`steps`/`distance` stay pure ADEQUACY
// classification, range-tolerant exactly as before, and this function never changes them — it only
// adds a ranking-only `offset`. A hard adequacy gate that reads `.fit`/`.steps` never sees either
// refinement below.
//
// Two refinements over the bucket-index `distance` alone:
//
// 1. RAW-SCORE PRECISION. Two garments compareThermalFit places in the SAME named bucket (a wool
//    cardigan and a plain cotton jacket, both `moderate`) are not equally warm — the census behind
//    the source-sensitive insulating credit spec found real raw-score gaps the 5-level scale is
//    deliberately too coarse to name (levelForRawScore's own comments on anchor spacing). This
//    measures distance from the garment's RAW score to the nearest edge of the demand's own raw
//    interval — continuous, not stepped — so same-bucket garments still rank apart.
//
// 2. OVERSHOOT RANKING WEIGHT. An explicit, modest, ranking-only asymmetry: every live incident this
//    arc has resolved was a garment wrongly favored for being TOO warm (a down puffer on a mild
//    evening, thread_1788050815289 and the founding Vienna incident alike), never the reverse. At
//    equal raw distance from the demand's acceptable interval, overshoot is penalised more than
//    undershoot. This is a stated ranking preference, not a claim that an overshooting garment is
//    "inadequate" — §5.5's rule that overshoot ranks but never excludes is unchanged, because this
//    function never touches `fit`.
const OVERSHOOT_RANKING_WEIGHT = 1.5

function rawIntervalForLevel(level) {
  const idx = LEVEL_INDEX.get(level)
  if (idx === undefined) return null
  const low = idx === 0 ? -Infinity : LEVEL_RAW_BOUNDARIES[idx - 1]
  const high = idx === LEVEL_RAW_BOUNDARIES.length ? Infinity : LEVEL_RAW_BOUNDARIES[idx]
  return [low, high]
}

// The raw midpoint of a level's bucket — continuous inside an ANCHOR-SUPPORTED target level, which
// is what distance-from-the-nearest-edge cannot give: two garments that both land in demand.level
// itself (both "adequate", both distance 0) are not equally well matched if one sits at the
// bucket's center and the other near its far edge.
//
// Returns null for `very light`/`very warm` deliberately, not a nominal center — levelForRawScore's
// own rule for these two ("an EXPLICITLY UNANCHORED ORDINAL EXTENSION... no numeric distance above
// the verified range") applies here too. An early version invented a nominal center by borrowing the
// adjacent bucket's width; a `very warm` down puffer scoring 4.5 sat just under that invented 4.75
// center and read as a spurious, tiny "undershoot" against a `very warm` demand — reopening
// thread_1788050815289 (a heavy coat must read as a clean match in genuinely severe cold, not a
// near-miss) precisely because it manufactured distance the anchors do not support. Callers fall
// back to the discrete `distance` for these two levels, exactly as before this ranking primitive.
function rawCenterForLevel(level) {
  const [low, high] = rawIntervalForLevel(level)
  return Number.isFinite(low) && Number.isFinite(high) ? (low + high) / 2 : null
}

/**
 * @param {string} garmentLevel  a WARMTH_LEVELS member (garmentWarmthLevel's output)
 * @param {number} garmentScore  the raw score behind it (garmentWarmthScore's output) — never
 *                                exposed to the model; ranking-internal only
 * @param {object} demand        requiredThermalBand's return shape
 * @returns the same shape compareThermalFit returns, plus `offset`: a signed, continuous,
 *          overshoot-weighted ranking distance. Ranking consumers use `offset` where they
 *          previously used `distance`; adequacy/gating consumers keep reading `fit`/`steps`.
 *
 * `offset` is measured against `demand.level`'s own raw CENTER (the TARGET), never `demand.range`
 * (the uncertainty-widened tolerance `fit` already checks) — the same distinction `distance` above
 * already draws and the reason it exists as a separate field from `fit`. Widening a coarse day's
 * range to `[moderate, very warm]` makes a puffer and a cardigan both `adequate`; that must not also
 * flatten them to the same ranking preference, or the coarser the forecast, the less this function
 * does.
 */
export function thermalRankingFit(garmentLevel, garmentScore, demand) {
  const fit = compareThermalFit(garmentLevel, demand)
  if (fit.fit === 'unknown' || !Number.isFinite(garmentScore)) {
    return { ...fit, offset: fit.distance }
  }
  const target = rawIntervalForLevel(demand.level)
  let raw
  if (target && garmentScore < target[0]) {
    // Undershooting the target level always hits a real, anchored lower edge — the only way to
    // undershoot `very warm` is from below its (anchored) floor, so this branch never needs the
    // unanchored ceiling above `very warm` itself.
    raw = garmentScore - target[0]
  } else if (target && garmentScore > target[1]) {
    // Symmetric: overshooting always hits a real, anchored upper edge.
    raw = garmentScore - target[1]
  } else {
    // The garment sits inside the TARGET level's own bucket. Refine by distance from that bucket's
    // center — but only when the center is anchor-supported (both edges finite). `rawCenterForLevel`
    // returns null for `very light`/`very warm`, and 0 here is deliberate, not a missing case: two
    // garments already at that same unanchored extreme as the demand are left undifferentiated
    // rather than measured against an invented center.
    const center = rawCenterForLevel(demand.level)
    raw = center === null ? 0 : garmentScore - center
  }
  const offset = raw > 0 ? raw * OVERSHOOT_RANKING_WEIGHT : raw
  return { ...fit, offset }
}
