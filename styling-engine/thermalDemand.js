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
import { WARMTH_LEVELS } from './garmentWarmth.js'

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
