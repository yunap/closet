// Contract A of docs/outerwear-weather-consolidation-spec.md — the single graded thermal model.
//
// Relocated verbatim from rules.js (2026-08-31, Slice D) with NO behavioural change. The move
// exists to break an import cycle, not to redesign anything: rules.js imports outfitValidation.js,
// so the canonical outfit validator could not import the thermal owner back out of rules.js. Both
// now import it from here, which is what makes Contract C able to compose real thermal evidence
// instead of reimplementing a second interpretation of warmth.
//
// rules.js re-exports pieceWeatherEvidence/pieceWeatherScores, so every existing importer is
// unaffected and no call site changed.
import {
  fabricWeight,
  necklineWarmth,
  pieceExposureDegree,
  pieceFiberBreathability,
  pieceHasInsulatingMaterial,
  pieceHemCoverage,
  interiorConstruction,
  pieceOcclusiveFitDegree,
  sleeveCoverage,
  wardrobeCategoryGroup,
} from './attributes.js'

// Numeric mass index for fabric_weight: light=-1, medium=0, heavy=1, untagged=null. A small
// internal helper so the weight terms below read as arithmetic instead of string comparisons.
function fabricMassIndex(piece) {
  const fw = fabricWeight(piece)
  if (fw === 'light') return -1
  if (fw === 'heavy') return 1
  if (fw === 'medium') return 0
  return null
}

// How strongly coverage/neckline/sleeve terms should weigh in for HEAT specifically: 0 for a
// light/untagged substance, 1 for medium, 2 for heavy. A full-coverage light linen shirt is real
// summer clothing (near-zero penalty); the same coverage on a medium or heavy fabric is a
// genuinely different, warmer garment. Untagged weight is treated like medium (1) rather than 0 —
// matching the standing rule that an unknown fabric_weight should never read as confidently
// summer-safe as a fabric we've actually confirmed is light.
function heatCoverageScale(massIndex) {
  if (massIndex === null) return 1
  return massIndex <= -1 ? 0 : massIndex >= 1 ? 2 : 1
}

// Graded, ordinary NON-INSULATING interior construction. A lining or a second fabric face is real
// thermal mass and belongs in the score; it is not insulation and must never reach
// thermalMaterialVerdict. See docs/interior-construction-spec.md §7.
//
//   unknown           0     no claim either way
//   unlined           0     confirmed absent — nothing to add, and deliberately not negative:
//                           "no lining" is not evidence of being COOLER than an untagged garment
//   partial_lining    0.5   \ stored separately because the physical distinction is real, scored
//   full_lining       0.5   / identically until a real garment demonstrates a difference (§7.1)
//   full_second_face  1     part of the garment's primary fabric construction, not a thin lining
//
// The degree is multiplied by a weight strictly below the insulating-material weight, which is what
// keeps the required ordering true by construction:
//   unlined < ordinary lined < full second face < true insulation
const INTERIOR_CONSTRUCTION_DEGREE = {
  unknown: 0,
  unlined: 0,
  partial_lining: 0.5,
  full_lining: 0.5,
  full_second_face: 1,
}

// Parity guard. This map is a SCORING POLICY keyed by the canonical vocabulary, not a second copy
// of it: if a sixth construction value is ever added, an unlisted key would silently score 0 and the
// new value would be stored, shown, and thermally inert — the quietest possible regression. Asserted
// in test/interiorConstruction.test.js rather than thrown at import, so a vocabulary change fails
// the suite instead of the app.
export const INTERIOR_CONSTRUCTION_DEGREE_KEYS = Object.keys(INTERIOR_CONSTRUCTION_DEGREE)

function interiorConstructionDegree(piece) {
  return INTERIOR_CONSTRUCTION_DEGREE[interiorConstruction(piece)] ?? 0
}

const WEATHER_EVIDENCE_WEIGHTS = {
  mass: 8,
  insulatingMaterialHeat: 6,
  insulatingMaterialCold: 6,
  // Strictly below insulatingMaterial*: a full second face (degree 1) contributes 4, an ordinary
  // lining 2, against insulation's 6. Construction can make a jacket warmer than an unlined one
  // without ever reaching what a filled or fleece-lined garment scores.
  constructionHeat: 4,
  constructionCold: 4,
  breathability: 5,
  hemCoverageHeat: 5,
  hemCoverageCold: 6,
  necklineHeat: 3,
  necklineCold: 3,
  sleeveHeat: 5,
  sleeveCold: 6,
  bareHeat: 8,
  bareCold: 8,
  occlusionBaseHeat: 2,
  occlusionNonBreathableAmplifyHeat: 4,
}

// The single graded weather-fit assessment — every consumer that judges hot/cold suitability
// (the soft weatherFitForPiece/pieceHeatSuitability scores below, and the hard composer/generation
// gates in wholeWardrobePieceTrustDecision and buildVisualComposerRoster) reads from this, instead
// of each re-deriving fabric_weight/coverage/material facts independently and drifting apart the
// way those two gates already had (one checked dress/neckline/sleeve coverage, the other didn't).
//
// Owner's explicit design charter: no single property — fabric_weight, fiber identity, coverage,
// fit, or exposure — is sufficient on its own to call a garment good or bad for heat/cold. Each is
// graded, independent evidence that can reinforce or counteract the others. Rules the model
// specifically must NOT break, each broken once by a real regression and fixed here:
//   - Do not turn an unordered fiber_content PRESENCE LIST into a composition fraction. A piece
//     tagged ["viscose","polyester","nylon"] is not "1/3 viscose" — there is no data on how much of
//     the fabric is which fiber. pieceFiberBreathability (attributes.js) is categorical: +1
//     (breathable), -1 (non-breathable), 0 (mixed evidence or none) — never an invented ratio.
//   - Do not let skin exposure act as one flat, garment-wide credit regardless of how much of the
//     body stays covered, and do not let a MISSING region look more confidently exposed than a
//     known, covered one. pieceExposureDegree (attributes.js) is a 0..1 fraction of the garment's
//     category-applicable regions (upper body: sleeve/neckline; lower body: hem) that are
//     CONFIRMED exposed — untagged regions count toward the denominator but default to "not
//     exposed," so missing data can only weaken the exposure reading, never strengthen it.
//   - Do not gate fit evidence away entirely just because fiber evidence is inconclusive. A close,
//     clingy cut genuinely restricts airflow against skin regardless of what the fabric is made
//     of — pieceOcclusiveFitDegree contributes its own small, independent penalty always, with
//     confident non-breathability AMPLIFYING (not switching on) that penalty, rather than the
//     fabric evidence gating the fit evidence to zero whenever it's inconclusive.
//   - Do not count the same physical fact twice. sleeve_length: 'long'/'extra_long' is upper-body
//     coverage; length_hits_at: full/floor-length/maxi is lower-body coverage — two independent
//     regions, not one 'full' coverage flag fed by either. pieceHemCoverage reports the hem half
//     only; sleeve coverage is read directly from sleeveCoverage() as its own term.
//
// The terms:
//   - substance (fabric_weight, when tagged): the base term, ±1 per mass-index step.
//   - insulating material (fiber_content/fabric_category): a real, ADDITIVE bump — a lightweight
//     wool knit still runs warmer than lightweight cotton — not a hard override of substance.
//   - breathability (pieceFiberBreathability, categorical): cotton/linen/rayon are not
//     automatically breathable and polyester/nylon are not automatically heat-unfriendly. Only
//     affects HEAT — breathability is about ventilating body heat outward, not a cold-weather
//     insulation mechanism the way an insulating material is.
//   - hem coverage (pieceHemCoverage) / long sleeves (sleeveCoverage): independent upper- and
//     lower-body coverage terms, each scaled by substance mass for heat (heatCoverageScale) so a
//     light full-length linen piece isn't penalized the way a medium/heavy one is, but always
//     counted toward cold.
//   - warm neckline: smaller, same-shaped term as coverage — real but secondary evidence, also
//     mass-scaled for heat.
//   - exposure (pieceExposureDegree): skin exposure is real, independent thermal evidence, graded
//     by how much of the garment is actually bare rather than a flat constant, and doesn't erase
//     an insulating material's own bump — a separate additive term, not a multiplier that can zero
//     another term out. Not applied to outerwear (see below).
//   - occlusive fit (pieceOcclusiveFitDegree): always contributes its own small heat penalty when
//     the cut is close, amplified further when the fiber evidence is confidently non-breathable —
//     "fit + fit×non-breathable interaction," not "fit only if the fabric is confidently bad."
//
// Returns null for shoes/accessories (fabric_weight there describes construction substance, not
// body insulation — the same boundary pieceWarmthTier already draws) and when NOTHING is known at
// all (every term silent) — an honest "unknown," never a guess.
export function pieceWeatherEvidence(piece = {}) {
  const group = wardrobeCategoryGroup(piece)
  if (group === 'shoes' || group === 'accessory') return null
  const massIndex = fabricMassIndex(piece)
  const insulatingMaterial = pieceHasInsulatingMaterial(piece)
  const breathability = pieceFiberBreathability(piece)
  const hemCoverage = pieceHemCoverage(piece)
  const exposure = pieceExposureDegree(piece)
  const warmNeckline = necklineWarmth(piece) === 'warm'
  const longSleeves = sleeveCoverage(piece) === 'long'
  const occlusion = pieceOcclusiveFitDegree(piece)
  const construction = interiorConstructionDegree(piece)

  if (massIndex === null && !insulatingMaterial && !construction && breathability === 0 && !hemCoverage && !exposure && !warmNeckline && !longSleeves && !occlusion) {
    return null
  }
  return { group, massIndex, insulatingMaterial, construction, breathability, hemCoverage, exposure, warmNeckline, longSleeves, occlusion }
}

// Graded hot/cold numeric scores built from pieceWeatherEvidence — see that function's comment for
// the evidence model. Both scores are sums of independent, signed terms (never a single
// determinative field), matching real behavior: fabric weight, material, coverage, fit, and
// exposure all contribute and can offset one another rather than any one of them deciding the
// outcome alone.
export function pieceWeatherScores(piece = {}) {
  const evidence = pieceWeatherEvidence(piece)
  if (!evidence) return { heat: 0, cold: 0, evidence: null }
  const { group, massIndex, insulatingMaterial, construction, breathability, hemCoverage, exposure, warmNeckline, longSleeves, occlusion } = evidence
  const W = WEATHER_EVIDENCE_WEIGHTS
  const heatScale = heatCoverageScale(massIndex)

  let heat = 0
  let cold = 0

  if (massIndex !== null) {
    heat += -massIndex * W.mass
    cold += massIndex * W.mass
  }
  if (insulatingMaterial) {
    heat -= W.insulatingMaterialHeat
    cold += W.insulatingMaterialCold
  }
  // Independent of insulatingMaterial, never folded into it — a garment can be both lined and
  // filled (996765), and collapsing the two would make a reversible jacket "insulating" again by
  // a different route.
  if (construction) {
    heat -= W.constructionHeat * construction
    cold += W.constructionCold * construction
  }
  heat += breathability * W.breathability
  if (hemCoverage === 'full') {
    heat -= W.hemCoverageHeat * (heatScale / 2)
    cold += W.hemCoverageCold
  }
  if (warmNeckline) {
    heat -= W.necklineHeat * (heatScale / 2)
    cold += W.necklineCold
  }
  if (longSleeves) {
    heat -= W.sleeveHeat * (heatScale / 2)
    cold += W.sleeveCold
  }
  // Real regression: a sleeveless wool/cashmere vest (outerwear) got the same heat-friendly
  // exposure credit as a bare TOP or DRESS. A vest's missing sleeves aren't exposed skin — they're
  // a layering choice (a vest is worn OVER a sleeved base, not against bare arms the way a tank top
  // is), so "sleeveless" there says nothing about ventilation, and nothing about cold exposure
  // either — the same reasoning applies to both directions: a sleeveless insulated vest isn't
  // meaningfully less warm for cold weather than the same fabric with sleeves would be, because
  // it's never worn as the only sleeve-bearing layer. Exposure is skipped entirely for outerwear.
  if (exposure && group !== 'outerwear') {
    heat += exposure * W.bareHeat
    cold -= exposure * W.bareCold
  }
  // Fit is independent evidence — a close, clingy cut genuinely restricts airflow regardless of
  // what the fabric is made of, so it always costs some heat-score. Confident non-breathability
  // (breathability === -1, not merely "mixed" or unknown) AMPLIFIES that cost on top of the base
  // penalty rather than being the only thing that switches it on — "fit + fit×non-breathable
  // interaction," matching a close synthetic cut being worse than a close natural-fiber one
  // without a close natural-fiber cut costing nothing at all.
  heat -= occlusion * W.occlusionBaseHeat
  if (breathability < 0) {
    heat -= occlusion * W.occlusionNonBreathableAmplifyHeat
  }

  return { heat, cold, evidence }
}
