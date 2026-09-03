// Slice 2 of docs/thermal-comfort-band-spec.md §12/§13 — ordinal warmth PLACEMENT for one garment.
//
// The supply half of `contribution >= demand`. It answers only "how warm is this garment, relative
// to others", never "is that enough here" — the demand side is §9.1's and is not chosen yet (§12).
//
// NO PRODUCTION CONSUMERS. §8 step 1: both contracts ship as pure functions with behaviour
// unchanged, then consumers migrate. Nothing calls this yet, by design.
//
// WHY IT REPLACES proposedWarmthLevel. That formula is `fabric_weight` + an insulating-material
// bonus and never reads coverage, so it placed five sleeveless garments at `warm` — a wool shell
// scoring cold -2 among them — and its level medians were non-monotonic against the evidence
// (`moderate` median 14 sat above `warm` median 12). Measured in §13.2.
//
// WHAT IT IS NOT CALIBRATED AGAINST. `pieceWeatherScores().cold` is a DIAGNOSTIC comparator, never
// the target. §10.1 disqualified it as a warmth unit — no temperature anchor, no meaningful zero,
// weights tuned historically for ranking — so fitting this scale to it would promote the old score
// to an oracle. Owner ruling 2026-09-03. Disagreement is a question to investigate, not an error to
// minimise: if this places a sleeveless wool shell at `light` while `cold` says -2, the old score may
// simply be wrong in a different way.
import { thermalMaterialVerdict, fabricWeight, wardrobeCategoryGroup, sleeveCoverage, pieceHemCoverage, pieceExposureDegree, necklineWarmth } from './attributes.js'

export const WARMTH_LEVELS = ['very light', 'light', 'moderate', 'warm', 'very warm']

// Anchored ordinally to published single-garment insulation data (§13.5): a sleeveless top and a
// thick sweater differ by roughly 4-5x, which is the separation the old formula collapsed. The
// anchors place garments into levels; they are NOT a unit and this file states no clo value.
// The §13.5 table is approximate and pending verification against primary ASHRAE 55 / ISO 9920
// material — no boundary here may be treated as authoritative until that lands (§12 Slice 2 step 3).
const SUBSTANCE = { ultralight: -1, light: 0, medium: 1, heavy: 2 }

/**
 * Can this garment be placed at all, and if not, why?
 *
 *   placeable              enough evidence to assign a level
 *   material_unestablished substantial garment, no material evidence — §13.3's at-risk band
 *   no_substance           not even fabric_weight
 *   out_of_scope           shoes and accessories: fabric_weight there describes construction
 *                          substance, not body insulation (the boundary pieceWarmthTier draws)
 */
export function warmthPlacementState(piece = {}) {
  const group = wardrobeCategoryGroup(piece)
  if (group === 'shoes' || group === 'accessory') return 'out_of_scope'
  const substance = SUBSTANCE[fabricWeight(piece)]
  if (substance === undefined) return 'no_substance'

  // §13.3, corrected. Unknown material evidence is only disqualifying where it could move the level:
  // on a light garment "there might be something warm in here" cannot lift it far enough to matter,
  // and refusing to place it buys nothing. On a medium or heavy one it can move it several levels —
  // 88 of 204 placements sat in that band, including a knit sweater placed `light`.
  //
  // RATIFIED 2026-09-03 by criterion 4b (§15.4). The verified ASHRAE-55 garment table shows coverage
  // outweighs substance by ~4x: the thin->thick step averages +0.089 clo, while thin garments span
  // 0.08..0.36 across types. A light garment's unstated material can move it about one narrow band;
  // its cut moves it across most of the scale.
  //
  // The exception holds ONLY because this file now reads coverage. Under the old substance-only
  // formula it did not, and if coverageAdjustment is ever weakened this must be re-derived.
  //
  // This replaces the old THERMALLY_UNCHARACTERIZED_FABRIC_CATEGORIES allowlist, which reached for
  // the same predicate through fabric_category and caught 9 pieces instead of 88.
  if (substance >= 1 && thermalMaterialVerdict(piece) === 'unknown') return 'material_unestablished'
  return 'placeable'
}

// Coverage as an ordinal adjustment, in levels — the input the old formula lacked entirely.
// Deliberately NOT a re-derivation of pieceWeatherScores' weighted terms: this reads the same
// structured facts and expresses them on this scale, so the two remain independent readings of one
// evidence base rather than one being fitted to the other.
function coverageAdjustment(piece) {
  let adj = 0
  const exposure = pieceExposureDegree(piece) || 0
  // A bare cut is the strongest single correction available, and the one whose absence produced
  // "sleeveless wool shell → warm". Full ordinal steps: it moves a garment a whole level or two.
  if (exposure > 0) return adj - (exposure >= 0.5 ? 2 : 1)

  // Secondary coverage is HALF-STEPS. A first attempt gave sleeves, hem and neckline a full step
  // each, and a medium fleece with a warm collar then tied a heavy down puffer at `very warm` —
  // three secondary terms outweighing a fabric-weight class. A collar is not worth as much as the
  // difference between medium and heavy cloth, and the reference spread in §13.5 says so.
  if (sleeveCoverage(piece) === 'long') adj += 0.5
  if (pieceHemCoverage(piece) === 'full') adj += 0.5
  if (necklineWarmth(piece) === 'warm') adj += 0.5
  return adj
}

// Boundaries, not a clamped index. A first attempt used the raw sum as an array index and saturated:
// a wool sweater, a knit cardigan and a down puffer all came out `very warm`, which destroys exactly
// the puffer-vs-cardigan separation pinned rows 1 and 3 depend on. The inputs span roughly -3..7
// (substance -1..2, insulating 0..2, coverage -2..3), so five levels need real boundaries.
//
// Placed against the verified reference ordering (§15.2) rather than against `cold`: a bare top sits
// far below a long-sleeved one of the same fabric, an insulated coat clearly above a knit cardigan.
//
// VERIFIED for the low and middle of the scale (§15.3): t-shirt 0.08 < thin trousers 0.15 <
// long-sleeve shirt 0.25 < thin coat 0.36 < thick coat 0.48.
//
// `very warm` IS AN EXPLICITLY UNANCHORED ORDINAL EXTENSION (§15.5, owner ruling 2026-09-03).
// ASHRAE 55 is an indoor-comfort standard; its heaviest entry is a 0.48 double-breasted coat, with
// no down parka, shearling or filled outerwear. So this level sits above everything the anchors
// cover, and it claims only that such a garment is materially warmer than that highest class —
// never a clo value, never an ASHRAE-calibrated boundary.
//
// Consumers must treat it as a BOUNDED CEILING: no `very warm+`, no "extreme" tier, no numeric
// distance above the verified range.
function levelForRawScore(raw) {
  if (raw <= -1) return 'very light'
  if (raw <= 1) return 'light'
  if (raw <= 2.5) return 'moderate'
  if (raw <= 4) return 'warm'
  return 'very warm'
}

/**
 * @returns {string|null} a WARMTH_LEVELS member, or null when the evidence cannot place it.
 *   null is "unknown", and per §12.1 row 6 it must never be read as neutral warmth.
 */
export function garmentWarmthLevel(piece = {}) {
  if (warmthPlacementState(piece) !== 'placeable') return null
  const substance = SUBSTANCE[fabricWeight(piece)] ?? 0
  // Positive insulating evidence is the single largest ordinal step, matching the reference spread
  // between an uninsulated and an insulated garment of the same substance.
  const insulating = thermalMaterialVerdict(piece) === 'insulating' ? 2 : 0
  return levelForRawScore(substance + insulating + coverageAdjustment(piece))
}

// Base warmth vs removable warmth. §13.4 measured the minimum information needed and found it
// already stored: `category = outerwear` is the one available bit and is sufficient — a cardigan is
// outerwear and removable, a heavy sweater is a top and is base warmth. needs_base is populated on
// 6 of 213 pieces, outerwear_role is deprecated, and no garment-kind column exists.
// Recommendation on record: add nothing.
export function warmthIsRemovable(piece = {}) {
  return wardrobeCategoryGroup(piece) === 'outerwear'
}
