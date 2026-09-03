// Slice 4 of docs/thermal-comfort-band-spec.md §9.2 — outfit thermal contribution.
//
// The supply side for a whole outfit. NO PRODUCTION CONSUMERS (§8 step 1).
//
// THE TRAP THIS FILE EXISTS TO AVOID: `very light..very warm` is an ORDERED CLASSIFICATION, not an
// interval unit. `warm(3) + moderate(2) = 5` has no physical meaning, and summing level indexes
// would be the ensemble version of canonizing the old `cold` score — the exact failure §10.1 and
// this whole arc were built to prevent. **Nothing here adds indexes.**
//
// WHAT THE ANCHORS ACTUALLY SUPPORT. The CBE/ASHRAE ensemble entries (§15.2's source) measure
// layering directly:
//
//     Trousers, long-sleeve shirt              0.61 clo
//     Jacket, Trousers, long-sleeve shirt      0.96 clo     -> adding a jacket: +0.35
//     Single-breasted coat (thin), on its own   0.36 clo     -> ~= its own garment value
//
// So layering is approximately additive IN CLO (§11.4 already recorded ASHRAE permitting exactly
// that as a practical estimate). It is NOT additive in ordinal level, because the levels span
// different clo widths. What the measurement licenses is a bounded ORDINAL STEP: adding a real
// second layer moves the outfit up one level from the warmer of the two — never a sum, and never
// unbounded (§15.5's ceiling).
//
// AND ROW 2 TURNS OUT NOT TO BE A TOTAL AT ALL. "A mild base plus a removable layer beats a
// permanently warm base for a variable museum/transit exposure" is about covering a RANGE: the
// layered outfit is adequate at the cold end with the layer ON and at the warm end with it OFF,
// while the permanently-heavy outfit can only ever answer the cold end. Comparing totals cannot
// express that; comparing range coverage can, and needs no arithmetic.
import { WARMTH_LEVELS, garmentWarmthLevel, warmthIsRemovable } from './garmentWarmth.js'

const IDX = new Map(WARMTH_LEVELS.map((l, i) => [l, i]))
const warmer = (a, b) => (a == null ? b : b == null ? a : (IDX.get(a) >= IDX.get(b) ? a : b))
const stepUp = l => WARMTH_LEVELS[Math.min(WARMTH_LEVELS.length - 1, IDX.get(l) + 1)]

/**
 * @returns {object} the STRUCTURE, never a scalar total:
 *   base       warmest non-removable contribution, or null
 *   removable  warmest removable contribution, or null
 *   withLayer  the outfit with its removable layer on
 *   unknown    which side could not be placed — preserved, never coerced to zero
 */
export function outfitThermalContribution(pieces = []) {
  const list = Array.isArray(pieces) ? pieces : []
  let base = null, removable = null
  const unknown = { base: false, removable: false, pieces: [] }

  for (const p of list) {
    const level = garmentWarmthLevel(p)
    const isLayer = warmthIsRemovable(p)
    if (level === null) {
      // UNKNOWN PROPAGATES STRUCTURALLY. "known cardigan + unknown top" is not "known cardigan +
      // very-light top": treating an unplaceable garment as zero warmth invents evidence, and is
      // §5.6's "unknown is never inadequacy" arriving at the ensemble.
      // Shoes and accessories are out of thermal scope and are not an unknown — they are a
      // different question (garmentWarmth.js's `out_of_scope`).
      if (isLayer) unknown.removable = true
      else if (isInThermalScope(p)) unknown.base = true
      if (isLayer || isInThermalScope(p)) unknown.pieces.push(p?.id ?? null)
      continue
    }
    if (isLayer) removable = warmer(removable, level)
    else base = warmer(base, level)
  }

  // The bounded ordinal step, justified above — and it turns on the WEAKER of the two, not the
  // stronger. The clo evidence is why: trousers+long-sleeve (0.61) plus a jacket (0.36) reaches 0.96
  // because BOTH are substantial, whereas a thin tee (0.08) under the same jacket reaches 0.44,
  // barely above the jacket alone. A first version keyed on the removable layer only and pushed a
  // light top under a knit cardigan to `very warm` — puffer territory, from a cardigan.
  const weaker = base == null || removable == null ? null
    : (IDX.get(base) <= IDX.get(removable) ? base : removable)
  // Threshold raised from `moderate` to `warm` on 2026-09-03. It was calibrated when most bases were
  // UNPLACEABLE and so never reached the step at all; once garmentWarmth stopped treating known
  // non-insulating fabrics as unknown, ordinary bases began placing at `moderate` and nearly every
  // layered outfit took the +1 — a cotton top, jeans and a knit cardigan came out `very warm` and
  // was reported as overshooting a 72/62 day.
  //
  // The clo evidence still supports a step only when BOTH halves are substantial
  // (trousers+long-sleeve 0.61 + jacket 0.36 -> 0.96). A `moderate` base is the thin-trousers end of
  // that range, not the substantial end.
  const bothReal = weaker != null && IDX.get(weaker) >= IDX.get('warm')
  const withLayer = removable == null ? base
    : base == null ? removable
    : bothReal ? stepUp(warmer(base, removable)) : warmer(base, removable)

  return { base, removable, withLayer, unknown, hasRemovableLayer: removable != null }
}

function isInThermalScope(piece) {
  const c = String(piece?.category || '').toLowerCase()
  return !['shoes', 'accessory'].includes(c)
}

/**
 * Row 2's actual question: does this outfit cover the exposure RANGE?
 *
 * Layer ON must answer the cold end; layer OFF must not be stranded overshooting the warm end.
 * Deliberately reports both ends separately rather than a verdict — and deliberately carries NO
 * rain, footwear, removability-as-policy or outdoor-capability semantics. Those are independent
 * contracts (§2.1, §7 of the exposure spec) and must not be absorbed into a thermal total.
 */
export function outfitCoversRange(contribution, demandCold, demandWarm, compare) {
  const coldEnd = compare(contribution.withLayer, demandCold)
  // With the layer removed, the base alone meets the warm end of the day.
  const warmEnd = compare(contribution.base ?? contribution.withLayer, demandWarm)
  return {
    coldEnd,
    warmEnd,
    // Adaptable = it can answer both ends. A permanently-heavy outfit answers the cold end and is
    // stuck overshooting the warm one; that is the row 2 distinction, and it is not a total.
    adaptable: coldEnd.fit !== 'undershoot' && !String(warmEnd.fit).includes('overshoot'),
    unknownPresent: contribution.unknown.base || contribution.unknown.removable,
  }
}
