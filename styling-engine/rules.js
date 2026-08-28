// Gates, ceilings, scores and the owner-constraint hard gate live here.
// DOCUMENTED IN: docs/engine-behaviour-map.md (gate/score behaviour) and
// docs/feedback-and-memory-map.md (getStylistFeedbackMemory, owner_constraints, and the
// AUTHORITY each store carries). Intent lives there, not here — read it before deciding a
// missing gate is a bug, and amend it in the same commit as any change. See AGENTS.md.
import { db, safeJsonParse, parsePiece } from '../db.js'
import { confidenceFromProfile } from './taggerMerge.js'
export { parsePiece }
import { autoStylingTrustDecision, buildWardrobePieceTruthText, stylingRulesForPrompt } from '../src/utils/wardrobeAiContext.js'
import { WHOLE_WARDROBE_OUTFIT_ARCHETYPES, OUTFIT_MISSIONS } from './prompts.js'
import { resolveOccasionProfile } from './occasions.js'
import { resolveActivityProfile, ACTIVITY_PROFILES } from './footwear-comfort.js'
import { FEEDBACK_BEHAVIOURS, FEEDBACK_REASON_LABELS, SCOPED_EVIDENCE_KINDS, WRONG_PIECE_FOR_OUTFIT_FEEDBACK, canonicalFeedbackType, feedbackBehaviour } from '../lib/feedbackTaxonomy.js'
import { ACCENT_COLOR_NAMES } from '../lib/colorTaxonomy.js'
import { ownerConstraintApplies, parseOwnerConstraintRow } from '../lib/ownerConstraints.js'
import { evaluateAutomaticUsePiecePoolCore } from './automaticUsePool.js'
import { buildCoveredCandidateSet, completeOutfitSupplyRequirement } from './candidateSet.js'
import { evaluateWearableOutfit } from './outfitValidation.js'
import { validatedSubstitute } from './recovery.js'
import {
  ownerGuidanceApplicabilityForFeedback,
  ownerGuidanceApplicabilityFromSynthesis,
  ownerGuidanceApplies,
} from '../lib/ownerGuidance.js'
import { resolveCalendarSeason } from '../lib/seasonContext.js'

import {
  fabricWeight,
  pieceFabricWeight,
  FORMALITY_VALUES,
  pieceBareness,
  pieceExposureDegree,
  pieceCoverage,
  pieceHemCoverage,
  pieceHasInsulatingMaterial,
  pieceFiberBreathability,
  pieceOcclusiveFitDegree,
  pieceHasWetSensitiveFootwearMaterial,
  pieceFormality,
  formalityRank,
  pieceHeelHeight,
  pieceWalkSupport,
  bottomKind,
  colorFamily,
  patternLoudness,
  groundingLevel,
  styleLanes,
  garmentKind,
  pieceSoftness,
  pieceGroundingValue,
  pieceStructureValue,
  isExpressiveForAnchor,
  pieceOccasionScore,
  isAccessory,
  isOuterwear,
  isTop,
  wardrobeCategoryGroup,
  isDarkPiece,
  pieceMatchesMaterial,
  pieceMatchesFootwear,
  pieceMatchesPieceName,
  necklineWarmth,
  sleeveCoverage
} from './attributes.js'

export function isStyleSelectedQuestion(question = '') {
  const q = String(question).toLowerCase()
  return !q.trim() || /style|wear|pair|outfit|how should|how do i|what goes|what would work|proposal|suggest/.test(q)
}

// `seasonIsCalendarOnly` — set by callers whose request spans a whole season
// rather than describing a day's conditions. A seasonal capsule is the case
// this exists for: "I want a summer capsule" names the calendar, not the
// weather. Inferring `isHot` from it stamps every slot of the plan hot,
// including the air-conditioned museum and the evening restaurant, and the hot
// gate then suppresses the layers the capsule is specifically supposed to
// carry. Measured on live thread_1785380251549: the blanket hot profile
// removed 17-26 outerwear pieces from EVERY slot's gate, and left two of the
// five slots unable to admit any layer at all.
//
// An EXPLICIT heat signal still wins — "a summer capsule, it's 95 here" is a
// statement about conditions and keeps its meaning. Only the bare season word
// is demoted, which is the same asymmetry this function already applies to
// cool signals.
//
// Cold is deliberately untouched. The measured defect is on the hot side, and
// a winter capsule's covered-base and transition-layer post-conditions depend
// on cold gating behaving as it does; changing both directions at once without
// evidence for the second would be guesswork.
export function weatherProfileFromContext({ mood = '', season = '', currentDate = new Date(), seasonIsCalendarOnly = false } = {}) {
  if (String(season || '').trim().toLowerCase() === 'indoor') {
    return { isHot: false, isCold: false }
  }
  const text = `${mood} ${season}`.toLowerCase()
  const fahrenheitValues = [...text.matchAll(/\b(\d{2,3})\s*(?:-|–|to)?\s*(?:\d{2,3})?\s*(?:f|°f|degrees?)?\b/g)]
    .map(match => Number(match[1]))
    .filter(n => Number.isFinite(n))
  const hasHotTemperature = fahrenheitValues.some(n => n >= 80)
  const hasExtremeHeatTemperature = fahrenheitValues.some(n => n >= 100)
  const hasColdTemperature = fahrenheitValues.some(n => n <= 45)
  const explicitWarmWeather = String(season || '').trim().toLowerCase() === 'warm'
    || /\bwarm(?:\s+(?:weather|climate|day|daytime|trip|season|current-season|current season))\b/.test(text)
  // Part 2 (spec 24): a bare season word ("summer") is a weak prior — it lost
  // twice live to a stated cool condition in the same sentence (Point Reyes:
  // "cool coastal summer, 55-58F, foggy"; a separate incident: "summer rain,
  // cool mountain"), both times firing the hot-weather insulating gate and
  // rejecting a jacket the cool/foggy/rainy conditions actually called for.
  // An EXPLICIT heat word/temperature (hot, 80s/90s, scorching...) still wins
  // outright over a cool signal — the asymmetry is the point, pinned by the
  // "hot days, cool evenings" fixture below, which must stay hot.
  const hasCoolSignal = /\b(cool|cold|chilly|fog(?:gy)?|marine layer|wind(?:y)?|breez(?:e|y)|overcast|drizzl(?:e|ing)?|rain(?:y|ing)?)\b/.test(text) // ratchet-allow: weather-text parsing, not garment matching
  const hasRainSignal = /\b(drizzl(?:e|ing)?|rain(?:y|ing)?)\b/.test(text) // ratchet-allow: weather-text parsing, not garment matching
  const hasDirectWetExposure = /\b(wet|mud|muddy|puddles?|drizzl(?:e|ing)?|rain(?:y|ing)?)\b/.test(text) // ratchet-allow: weather-context parsing, not garment matching
  const hasCoastalExposure = /\b(beach|coast|coastal|seashore|shoreline|marine layer)\b/.test(text) // ratchet-allow: environment-context parsing, not garment matching
  const hasFogSignal = /\b(fog|foggy|marine layer)\b/.test(text) // ratchet-allow: weather-context parsing, not garment matching
  const hasOutdoorFootExposure = /\b(walk|walking|stroll|strolling|hike|hiking|trail|outdoor|outside)\b/.test(text) // ratchet-allow: activity-context parsing, not garment matching
  const isWetExposure = hasDirectWetExposure || (hasCoastalExposure && hasFogSignal && hasOutdoorFootExposure)
  const strongHotSignal = /\b(hot|heat|heatwave|sweltering|scorching|humid|80s|90s|100 degrees)\b/.test(text) || hasHotTemperature
  const extremeHeatSignal = hasExtremeHeatTemperature || /\b(extreme heat|100s|triple[- ]digit)\b/.test(text) // ratchet-allow: weather-text parsing, not garment matching
  const seasonHotSignal = explicitWarmWeather || /\bsummer\b/.test(text)
  const explicitHot = strongHotSignal || (seasonHotSignal && !hasCoolSignal && !seasonIsCalendarOnly)
  const explicitCold = /\b(cold|freezing|frigid|snow|winter|chilly)\b/.test(text)
    || hasColdTemperature
    || (hasCoolSignal && !strongHotSignal)

  // An explicit weather word/temperature always wins over the "current season" calendar guess below —
  // otherwise a stated "it'll be cold" during a warm month cancels itself out against the calendar
  // heuristic (isHot && isCold both true) and the mutual-exclusion collapses both flags to false,
  // silently disabling weather gating entirely. Only fall back to the calendar guess when the user
  // (or context) gave no explicit signal at all.
  if (explicitHot || explicitCold) {
    return {
      isHot: explicitHot && !explicitCold,
      isCold: explicitCold && !explicitHot,
      isRainy: hasRainSignal,
      isWetExposure,
      ...(explicitHot && extremeHeatSignal ? { isExtremeHeat: true } : {})
    }
  }

  const month = currentDate instanceof Date && !Number.isNaN(currentDate.getTime())
    ? currentDate.getMonth()
    : null
  const currentSeasonRequested = /\b(current season|current weather|right now|today|this month)\b/.test(text) // ratchet-allow: date-context parsing, not garment text matching
  const currentSeasonHot = currentSeasonRequested && month !== null && month >= 5 && month <= 7
  const currentSeasonCold = currentSeasonRequested && month !== null && (month === 11 || month <= 1)
  return { isHot: currentSeasonHot, isCold: currentSeasonCold, isRainy: hasRainSignal, isWetExposure }
}

export { pieceFabricWeight, pieceBareness, pieceCoverage } from './attributes.js'

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

const WEATHER_EVIDENCE_WEIGHTS = {
  mass: 8,
  insulatingMaterialHeat: 6,
  insulatingMaterialCold: 6,
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

  if (massIndex === null && !insulatingMaterial && breathability === 0 && !hemCoverage && !exposure && !warmNeckline && !longSleeves && !occlusion) {
    return null
  }
  return { group, massIndex, insulatingMaterial, breathability, hemCoverage, exposure, warmNeckline, longSleeves, occlusion }
}

// Graded hot/cold numeric scores built from pieceWeatherEvidence — see that function's comment for
// the evidence model. Both scores are sums of independent, signed terms (never a single
// determinative field), matching real behavior: fabric weight, material, coverage, fit, and
// exposure all contribute and can offset one another rather than any one of them deciding the
// outcome alone.
export function pieceWeatherScores(piece = {}) {
  const evidence = pieceWeatherEvidence(piece)
  if (!evidence) return { heat: 0, cold: 0, evidence: null }
  const { group, massIndex, insulatingMaterial, breathability, hemCoverage, exposure, warmNeckline, longSleeves, occlusion } = evidence
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

export function weatherFitForPiece(piece = {}, weatherProfile = {}) {
  const adjustments = []
  // fabric_weight/coverage/bareness/insulating-material on a shoe or accessory describe
  // construction (a chunky-heel sandal tagged 'heavy'), not body-thermal insulation — an
  // open-toe sandal isn't cold-weather-appropriate for being sturdily built, and scoring it that
  // way is exactly what put a "heavy" sandal in the wardrobe page's warmth-filter results before
  // pieceWarmthTier (attributes.js) drew this same boundary. Same fix here: skip the fabric-weight
  // read entirely for shoes/accessories rather than treating their tag as thermal signal.
  const group = wardrobeCategoryGroup(piece)
  if (group === 'shoes' || group === 'accessory') {
    return { score: 0, label: 'neutral', adjustments }
  }

  const { heat, cold } = pieceWeatherScores(piece)

  if (weatherProfile?.isHot && heat !== 0) {
    adjustments.push({
      score: heat,
      label: heat > 0 ? 'lightweight - good for heat' : 'heavy - too warm for the heat',
      reason: heat > 0 ? 'hot weather: lightweight fabric' : 'hot weather: heavy fabric',
    })
  } else if (weatherProfile?.isCold && cold !== 0) {
    adjustments.push({
      score: cold,
      label: cold > 0 ? 'heavy - good for cool weather' : 'lightweight - needs layering',
      reason: cold > 0 ? 'cold weather: heavy fabric' : 'cold weather: lightweight fabric',
    })
  }

  return {
    score: adjustments.reduce((sum, item) => sum + item.score, 0),
    label: adjustments[0]?.label || 'neutral',
    adjustments
  }
}

// A practical, user-facing readout on top of pieceWeatherScores — "is this an option for hot
// weather / cold weather / does it work either way" — rather than the raw substance tier
// (pieceWarmthTier) or a single field. Owner's own framing: a piece tagged fabric_weight 'light'
// isn't automatically "good for heat" if a close, occlusive fit kills its ventilation (the
// leggings case), and isn't automatically "not good for heat" either if it's just moderate rather
// than exceptional (a long-sleeve rayon blouse — light fabric, relaxed fit, but sleeves mean it
// doesn't also earn the bareness credit a sleeveless light piece gets). 'versatile' is not a claim
// that a piece is great for both extremes — it's the honest result whenever neither direction has
// a clear, standalone advantage. Returns null for shoes/accessories and for pieces with no weather
// signal at all (pieceWeatherEvidence itself returns null).
//
// HEAT_COLD_MEANINGFUL_MARGIN exists because pieceWeatherScores sums several independently weaker
// terms (breathability, coverage, neckline...) alongside two strong, direct ones (mass, exposure):
// a single weak signal — e.g. a plain medium-weight cotton top, mass-neutral, with nothing else
// tagged — would otherwise net a small positive heat score from breathability alone and get called
// "hot" outright, which is exactly the "no one property should be sufficient on its own" trap the
// owner's design charter warns against. Real regression: exposure itself is now graded (0..1, not
// a flat constant — see pieceExposureDegree), so a piece that's only PARTIALLY exposed (a
// sleeveless-but-midi dress, degree 0.5, diff 8) is comparably weak evidence to breathability alone
// (diff 5) and must not unilaterally decide the bucket either — only genuinely strong, direct
// evidence should: a fully-tagged fabric_weight alone (diff 16), full exposure alone (diff 16), or
// a known insulating material alone (diff 12). The margin sits at 10 — above the two weak,
// secondary signals (breathability 5, half-exposure 8) and below the three strong, direct ones
// (12, 16, 16) — so a lone weak signal can nudge an already-leaning piece but can't unilaterally
// decide a neutral one.
const HEAT_COLD_MEANINGFUL_MARGIN = 10
export function pieceHeatSuitability(piece = {}) {
  const { heat, cold, evidence } = pieceWeatherScores(piece)
  if (!evidence) return null
  if (heat > cold + HEAT_COLD_MEANINGFUL_MARGIN) return 'hot'
  if (cold > heat + HEAT_COLD_MEANINGFUL_MARGIN) return 'cold'
  return 'versatile'
}

function isLightweightLinenBottom(piece = {}) {
  if (wardrobeCategoryGroup(piece) !== 'bottom') return false
  if (pieceFabricWeight(piece) !== 'light') return false
  return /\b(linen|linen blend|gauze|gauzy)\b/i.test(pieceTextBlob(piece))
}

export function resolveFormalityIntent(options = {}) {
  const text = [
    options.formality,
    options.register,
    options.mood,
    options.occasion,
    options.activity,
    options.request,
    options.question
  ].filter(Boolean).join(' ').toLowerCase()
  const avoid = new Set()
  let target = null
  const has = pattern => pattern.test(text) // ratchet-allow: user-intent parsing, not garment text matching

  if (has(/\b(not|no|avoid|less)\s+(?:too\s+)?dressy\b/) || has(/\bnot\s+formal\b/)) avoid.add('dressy')
  if (has(/\b(not|no|avoid|less)\s+(?:too\s+)?elevated\b/)) avoid.add('elevated')
  if (has(/\b(not|no|avoid|less)\s+(?:too\s+)?(?:lounge|loungey|loungy|sloppy|athletic)\b/)) avoid.add('lounge')
  if (has(/\bnot\s+(?:too\s+)?casual\b/)) avoid.add('lounge')

  const positiveText = text
    .replace(/\b(?:not|no|avoid|less)\s+(?:too\s+)?(?:dressy|formal|elevated|lounge|loungey|loungy|sloppy|athletic|casual)\b/g, ' ')

  if (/\b(more|make it|make this|feel|keep it|same outfit,?)\s+(?:more\s+)?everyday\b/.test(positiveText) || /\beveryday\b/.test(positiveText)) target = 'everyday'
  if (/\b(more|make it|make this|feel|keep it|same outfit,?)\s+(?:more\s+)?elevated\b/.test(positiveText) || /\belevated\b/.test(positiveText)) target = 'elevated'
  if (/\b(dressy|formal|going out|night out)\b/.test(positiveText)) target = 'dressy'
  if (/\b(lounge|loungey|loungy|home comfort|comfort-first)\b/.test(positiveText)) target = 'lounge'

  const activityProfile = options.activityProfile || resolveActivityProfile({
    activity: options.activity,
    occasion: options.occasion,
    request: options.request || options.question || ''
  })
  const walkable = activityProfile?.id === 'walking' || activityProfile?.id === 'hiking'

  return {
    target,
    targetRank: target ? formalityRank(target) : null,
    avoid,
    walkable,
    active: Boolean(target || avoid.size || walkable)
  }
}

export function resolveRegisterCeiling(options = {}) {
  const intent = options.formalityIntent || resolveFormalityIntent(options)

  if (intent.target !== null && intent.targetRank !== null) {
    return intent.target
  }

  const candidates = []
  const occasionCeiling = options.occasionProfile?.register_ceiling
  const occasionCeilingRank = formalityRank(occasionCeiling)
  if (occasionCeilingRank !== null) candidates.push(occasionCeilingRank)

  const activityCeiling = options.activityProfile?.rules?.register_ceiling
  const activityCeilingRank = formalityRank(activityCeiling)
  if (activityCeilingRank !== null) candidates.push(activityCeilingRank)

  if (intent.avoid?.has('dressy')) candidates.push(formalityRank('elevated'))
  if (intent.avoid?.has('elevated')) candidates.push(formalityRank('everyday'))
  if (intent.avoid?.has('everyday')) candidates.push(formalityRank('lounge'))

  const validCandidates = candidates.filter(rank => rank !== null)
  if (!validCandidates.length) return null
  return FORMALITY_VALUES[Math.min(...validCandidates)]
}

export function formalityFitForPiece(piece = {}, options = {}) {
  const intent = options.formalityIntent || resolveFormalityIntent(options)
  const formality = pieceFormality(piece)
  const rank = formalityRank(formality)
  const adjustments = []
  const add = (score, reason) => adjustments.push({ score, reason })
  if (!formality || rank === null || !intent.active) {
    return { score: 0, adjustments, formality, rank, intent }
  }

  if (intent.avoid?.has(formality)) add(-24, `register: avoid ${formality}`)

  if (intent.targetRank !== null) {
    const distance = Math.abs(rank - intent.targetRank)
    if (distance === 0) add(10, `register: ${formality} matches request`)
    else if (distance === 1) add(-6, `register: ${formality} near ${intent.target}`)
    else add(-18, `register: ${formality} too far from ${intent.target}`)
  }

  if (intent.walkable && (piece.category === 'shoes' || wardrobeCategoryGroup(piece) === 'shoes')) {
    const support = pieceWalkSupport(piece)
    if (piece.heel_height === 'high' || support === 'low') add(-18, 'register: not walkable enough')
    else if (support === 'high') add(8, 'register: walkable shoe')
  }

  return {
    score: adjustments.reduce((sum, item) => sum + item.score, 0),
    adjustments,
    formality,
    rank,
    intent
  }
}

export function formalityFitForOutfit(pieces = [], options = {}) {
  const intent = options.formalityIntent || resolveFormalityIntent(options)
  const adjustments = []
  const add = (score, reason) => adjustments.push({ score, reason })
  const ranked = pieces
    .map(piece => ({ piece, formality: pieceFormality(piece), rank: formalityRank(pieceFormality(piece)) }))
    .filter(item => item.rank !== null && !isAccessory(item.piece))
  if (!ranked.length) return { score: 0, adjustments, intent }

  if (intent.active) {
    for (const item of ranked) {
      const fit = formalityFitForPiece(item.piece, { ...options, formalityIntent: intent })
      for (const adjustment of fit.adjustments) add(adjustment.score, `${item.piece.name}: ${adjustment.reason}`)
    }
  }

  const groups = ranked.map(item => wardrobeCategoryGroup(item.piece))
  const min = Math.min(...ranked.map(item => item.rank))
  const max = Math.max(...ranked.map(item => item.rank))
  const spread = max - min
  if (spread >= 3) add(-22, 'register clash: lounge/everyday mixed with dressy')
  else if (spread === 2) add(-8, 'register spread needs intentional styling')

  const hasLounge = ranked.some(item => item.formality === 'lounge')
  if (hasLounge && ranked.some(item => item.formality === 'elevated' || item.formality === 'dressy')) {
    add(-18, 'register clash: lounge with polished pieces')
  }
  if (intent.target === 'dressy' && !ranked.some(item => item.rank >= 2) && groups.some(group => ['top', 'bottom', 'dress'].includes(group))) {
    add(-18, 'register: no elevated/dressy anchor for dressy request')
  }
  if (intent.target === 'everyday' && ranked.some(item => item.formality === 'dressy')) {
    add(-14, 'register: dressy piece in everyday request')
  }

  return {
    score: adjustments.reduce((sum, item) => sum + item.score, 0),
    adjustments,
    intent
  }
}

export function explicitFormalityAvoidanceIssue(pieces = [], options = {}) {
  const intent = options.formalityIntent || resolveFormalityIntent(options)
  if (!intent.avoid?.size) return null
  const scopedPieces = (pieces || []).filter(piece => piece && !isAccessory(piece))
  for (const piece of scopedPieces) {
    const formality = pieceFormality(piece)
    if (formality && intent.avoid.has(formality)) {
      return `explicit register request: avoid ${formality} (${piece.name})`
    }
  }
  return null
}



export { wardrobeCategoryGroup } from './attributes.js'

export function categoryConstraintForSelectedPiece(piece) {
  if (wardrobeCategoryGroup(piece) === 'bottom') {
    return `Selected item category is BOTTOM. Every outfit idea must include "${piece.name}" as the bottom. Do not recommend skirts, dresses, jeans, pants, or any other bottom as an outfit idea.`
  }
  if (wardrobeCategoryGroup(piece) === 'top') {
    return `Selected item category is TOP. Every outfit idea must include "${piece.name}" as the top. Do not replace it with another top.`
  }
  if (wardrobeCategoryGroup(piece) === 'dress') {
    return `Selected item category is DRESS. Every outfit idea must include "${piece.name}" as the dress. Do not replace it with separates.`
  }
  if (wardrobeCategoryGroup(piece) === 'outerwear') {
    return `Selected item category is OUTERWEAR. Every outfit idea must include "${piece.name}" as the outer layer. Do not replace it with another jacket/cardigan.`
  }
  if (wardrobeCategoryGroup(piece) === 'shoes') {
    return `Selected item category is SHOES. Every outfit idea must include "${piece.name}" as the shoes. Do not suggest different shoes unless marked as an avoid note.`
  }
  return `Every outfit idea must include the selected item "${piece.name}".`
}

export function idealAdditionAnchorConstraint(piece) {
  const group = wardrobeCategoryGroup(piece)
  const name = piece?.name || 'selected item'
  const base = `The selected item "${name}" is the non-replaceable anchor. Every direction must keep it in the outfit and suggest only complementary additions around it.`
  if (group === 'bottom') return `${base} Because the anchor is a bottom, do not suggest trousers, jeans, pants, shorts, skirts, dresses, or jumpsuits as missingPieces. Suggest tops, layers, shoes, bags, jewelry, or other support pieces only.`
  if (group === 'top') return `${base} Because the anchor is a top, do not suggest another top, blouse, shirt, sweater, tee, tank, or dress as missingPieces. Suggest bottoms, layers, shoes, bags, or accessories only.`
  if (group === 'dress') return `${base} Because the anchor is a dress, do not suggest another dress or separates that replace it. Suggest shoes, layers, bags, jewelry, belts, or other support pieces only.`
  if (group === 'outerwear') return `${base} Because the anchor is outerwear, do not suggest another jacket, blazer, cardigan, coat, vest, or dress that replaces it. Suggest base layers, bottoms, shoes, bags, or accessories only.`
  if (group === 'shoes') return `${base} Because the anchor is shoes, do not suggest replacement shoes as missingPieces. Suggest tops, bottoms, dresses, layers, bags, or accessories only.`
  return base
}

export function textIncludesAny(value, words) {
  const haystack = String(value || '').toLowerCase()
  return words.some(w => haystack.includes(w))
}

const pieceTextBlobCache = new WeakMap()

const STRUCTURE_FIT_CONFIDENCE_FIELDS = new Set([
  'hem_finish',
  'length_hits_at',
  'silhouette',
  'fit_on_body',
  'tuck_behavior',
  'waistband_type',
  'sleeve_length',
  'sleeve_shape'
])

export function getFieldConfidence(piece, field) {
  const confidence = String(confidenceFromProfile(piece, field) || '').toLowerCase()
  if (confidence === 'manual') return 'manual'
  if (confidence === 'high') return 'high'
  if (confidence === 'medium') return 'medium'
  if (confidence === 'low') return 'low'
  return piece?.tag_state === 'provisional' && STRUCTURE_FIT_CONFIDENCE_FIELDS.has(field) ? 'low' : 'medium'
}

function trustedField(piece, field) {
  const confidence = getFieldConfidence(piece, field)
  return confidence === 'manual' || confidence === 'high' || confidence === 'medium'
}

export function pieceTextBlob(p) {
  if (p && typeof p === 'object' && pieceTextBlobCache.has(p)) return pieceTextBlobCache.get(p)
  const value = [
    p.name, p.category, p.background_color, p.reads_as, p.pattern_type,
    p.pattern_scale, p.pattern_complexity,
    trustedField(p, 'hem_finish') ? p.hem_finish : '',
    trustedField(p, 'length_hits_at') ? p.length_hits_at : '',
    trustedField(p, 'silhouette') ? p.silhouette : '',
    p.shoe_type, p.toe_shape,
    p.fabric_category, p.fabric_weight, p.visual_weight,
    trustedField(p, 'fit_on_body') ? p.fit_on_body : '',
    trustedField(p, 'tuck_behavior') ? p.tuck_behavior : '',
    trustedField(p, 'waistband_type') ? p.waistband_type : '',
    p.accessory_subtype, p.jewelry_type, p.necklace_length, p.bottom_subtype,
    p.notes,
    ...(p.colors || []), ...(p.occasions || []),
    ...stylingRulesForPrompt(p.styling_rules_learned), ...(p.tried_and_rejected || [])
  ].filter(Boolean).join(' ').toLowerCase()
  if (p && typeof p === 'object') pieceTextBlobCache.set(p, value)
  return value
}

// Minimal pieceNameBlob helper in server.js:
export function pieceNameBlob(p) {
  return [p.name, p.category, p.reads_as].filter(Boolean).join(' ').toLowerCase()
}

export function pieceHasFocalColor(piece, focalColors) {
  const colors = (piece.colors || []).map(c => c.toLowerCase())
  if (colors.some(c => focalColors.includes(c))) return true
  
  const readsAs = String(piece.reads_as || '').toLowerCase()
  const name = String(piece.name || '').toLowerCase()
  const combined = [readsAs, name].join(' ')
  return focalColors.some(fc => {
    const escaped = fc.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
    const regex = new RegExp('\\b' + escaped + '\\b', 'i')
    return regex.test(combined)
  })
}


export function visualWeightProfile(p) {
  const softness = pieceSoftness(p)
  const expressive = isExpressiveForAnchor(p)
  const grounding = pieceGroundingValue(p)
  const structure = pieceStructureValue(p)
  const lanes = styleLanes(p)

  return {
    grounding,
    groundingLabel: grounding >= 4 ? 'strong anchor' : grounding >= 2 ? 'moderate anchor' : grounding >= 0 ? 'light anchor' : 'floating/soft',
    softness,
    structure,
    expressive,
    lanes: [...new Set(lanes)].slice(0, 3)
  }
}

export function buildVisualWeightText(p) {
  const v = visualWeightProfile(p)
  const lane = v.lanes.length ? v.lanes.join(', ') : 'neutral support'
  return `VISUAL WEIGHT: ${v.groundingLabel}; structure ${v.structure}; softness ${v.softness}; expressive ${v.expressive ? 'yes' : 'no'}; style lane: ${lane}`
}

function textContainsWholePhrase(text = '', phrase = '') {
  const normalizedPhrase = String(phrase || '').toLowerCase().trim()
  if (!normalizedPhrase) return false
  const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).test(String(text || '').toLowerCase())
}

export function hasRejectedReference(sourcePiece, targetPiece) {
  const targetName = String(targetPiece.name || '').toLowerCase()
  return (sourcePiece.tried_and_rejected || []).some(note => textContainsWholePhrase(note, targetName))
}

export function collectPieceIdsFromFeedbackPayload(payloadText) {
  const ids = new Set()
  try {
    const payload = typeof payloadText === 'string' ? safeJsonParse(payloadText, {}) : (payloadText || {})
    const visit = (value) => {
      if (!value) return
      if (Array.isArray(value)) return value.forEach(visit)
      if (typeof value === 'object') {
        if (value.id !== undefined && value.id !== null && !Number.isNaN(Number(value.id))) ids.add(Number(value.id))
        if (value.pieceId !== undefined && value.pieceId !== null && !Number.isNaN(Number(value.pieceId))) ids.add(Number(value.pieceId))
        if (Array.isArray(value.pieces)) value.pieces.forEach(visit)
        if (Array.isArray(value.pieceIds)) value.pieceIds.forEach(id => {
          if (!Number.isNaN(Number(id))) ids.add(Number(id))
        })
        if (value.board) visit(value.board)
        if (value.outfit) visit(value.outfit)
      } else if (typeof value === 'number' || /^\d+$/.test(String(value))) {
        ids.add(Number(value))
      }
    }
    visit(payload)
  } catch {}
  return [...ids]
}

const POSITIVE_WHOLE_WARDROBE_PROMPT_TYPES = new Set(['signature', 'works', 'good_formula', 'good_pieces', 'almost'])
const NEGATIVE_WHOLE_WARDROBE_PROMPT_TYPES = new Set([
  'not_me', 'too_safe', 'too_soft', 'too_generic', 'too_boho', 'too_polished',
  'weak_structure', 'weak_contrast', 'bad_grounding', 'wrong_silhouette',
  'catalog_drift', 'bad_reference', 'proportion_problem', 'wrong_proportions',
  WRONG_PIECE_FOR_OUTFIT_FEEDBACK, 'bad_occasion', 'fit_issue',
])

function acceptedPersonalSynthesisSources() {
  const feedbackIds = new Set()
  const boardIds = new Set()
  try {
    const rows = db.prepare(`
      SELECT CAST(source.value AS INTEGER) AS feedback_id, sb.id AS board_id
      FROM feedback_synthesis_drafts draft
      JOIN json_each(draft.source_feedback_ids) source
      LEFT JOIN stylist_feedback sf ON sf.id = CAST(source.value AS INTEGER)
      LEFT JOIN saved_boards sb ON sb.image_url = json_extract(sf.payload, '$.board.imageUrl')
      WHERE draft.status = 'accepted' AND draft.disposition = 'personal_contextual_lesson'
    `).all()
    for (const row of rows) {
      if (Number.isInteger(Number(row.feedback_id)) && Number(row.feedback_id) > 0) feedbackIds.add(Number(row.feedback_id))
      if (Number.isInteger(Number(row.board_id)) && Number(row.board_id) > 0) boardIds.add(Number(row.board_id))
    }
  } catch {}
  return { feedbackIds, boardIds }
}

export function collectPieceIdsFromSavedBoardRow(row) {
  const ids = new Set()
  if (row?.context_type === 'piece' && row.context_id && !Number.isNaN(Number(row.context_id))) {
    ids.add(Number(row.context_id))
  }
  const visit = (value) => {
    if (!value) return
    if (Array.isArray(value)) return value.forEach(visit)
    if (typeof value === 'object') {
      if (value.id !== undefined && value.id !== null && !String(value.id).startsWith('missing-') && !Number.isNaN(Number(value.id))) ids.add(Number(value.id))
      if (value.pieceId !== undefined && value.pieceId !== null && !Number.isNaN(Number(value.pieceId))) ids.add(Number(value.pieceId))
      if (Array.isArray(value.pieces)) value.pieces.forEach(visit)
      if (Array.isArray(value.pieceIds)) value.pieceIds.forEach(visit)
      if (value.board) visit(value.board)
      if (value.outfit) visit(value.outfit)
    } else if (/^\d+$/.test(String(value))) {
      ids.add(Number(value))
    }
  }
  visit(safeJsonParse(row?.pieces, []))
  visit(safeJsonParse(row?.payload, {}))
  return [...ids]
}

// Reasonless negative/qualified verdicts have one safe meaning: the exact proposal was not a
// confirmed success. They may prevent an existing styling call from reproducing that same piece
// set, but they cannot describe a disliked formula, silhouette, garment, or general preference.
const EMPTY_FEEDBACK_CONTEXT_VALUES = new Set(['', 'none', 'n/a', 'na', 'unspecified', 'unknown'])

function feedbackContextTerms(value) {
  const values = Array.isArray(value) ? value : [value]
  return [...new Set(values
    .flatMap(entry => String(entry || '').split(/[,;|]/))
    .map(entry => entry.trim().toLowerCase().replaceAll('_', ' ').replace(/\s+/g, ' '))
    .filter(entry => !EMPTY_FEEDBACK_CONTEXT_VALUES.has(entry)))]
}

function feedbackContextMatches(storedValue, requestedValue) {
  const storedTerms = feedbackContextTerms(storedValue)
  if (!storedTerms.length) return true
  const requestedTerms = new Set(feedbackContextTerms(requestedValue))
  if (!requestedTerms.size) return false
  return storedTerms.some(term => requestedTerms.has(term))
}

export function getExactOutfitReactionMemory(pieceIds = [], {
  occasion = '', activity = '', season = '', currentDate = null, limit = 3,
} = {}) {
  const availableIds = new Set((Array.isArray(pieceIds) ? pieceIds : [pieceIds])
    .map(Number).filter(id => Number.isInteger(id) && id > 0))
  if (availableIds.size < 2 || limit <= 0) return ''
  const normalizedContext = {
    occasion: String(occasion || '').trim().toLowerCase(),
    activity: String(activity || '').trim().toLowerCase(),
    season: resolveCalendarSeason(season, currentDate),
  }
  const rowSeason = (value, row) => {
    const rawDate = row?.created_at
    const referenceDate = rawDate
      ? new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(rawDate) ? rawDate : `${String(rawDate).replace(' ', 'T')}Z`)
      : undefined
    return resolveCalendarSeason(value, referenceDate)
  }
  try {
    const rows = db.prepare(`
      SELECT * FROM saved_boards
      WHERE COALESCE(archived,0) = 0
        AND (
          EXISTS (SELECT 1 FROM json_each(json_extract(payload, '$.feedback_labels')) WHERE value = 'almost')
          OR EXISTS (SELECT 1 FROM json_each(json_extract(payload, '$.feedback_labels')) WHERE value = 'not_me')
        )
      ORDER BY id DESC
      LIMIT 240
    `).all()
    const lines = []
    for (const row of rows) {
      const payload = safeJsonParse(row.payload, {}) || {}
      const labels = Array.isArray(payload.feedback_labels) ? payload.feedback_labels : []
      const verdict = labels.includes('not_me') ? 'Not for me' : (labels.includes('almost') ? 'Almost right' : '')
      if (!verdict) continue
      const sourceIds = [...new Set(collectPieceIdsFromSavedBoardRow(row))].sort((a, b) => a - b)
      if (sourceIds.length < 2 || !sourceIds.every(id => availableIds.has(id))) continue
      const evidenceContext = payload.scoped_evidence?.context || payload.outfit?.context || {}
      const storedContext = {
        occasion: String(evidenceContext.occasion || payload.outfit?.occasion || '').trim().toLowerCase(),
        activity: String(evidenceContext.activity || payload.outfit?.activity || '').trim().toLowerCase(),
        season: rowSeason(evidenceContext.season || payload.outfit?.season || '', row),
      }
      const contextMismatch = Object.keys(storedContext).some(key =>
        !feedbackContextMatches(storedContext[key], normalizedContext[key]))
      if (contextMismatch) continue
      const selectedReasons = Object.values(payload.feedback_details || {})
        .flatMap(value => Array.isArray(value) ? value : [])
        .map(value => typeof value === 'string' ? value : value?.issue)
        .map(value => FEEDBACK_REASON_LABELS[value] || '')
        .filter(Boolean)
      const ownerComment = String(payload.feedback_details?.owner_comment || payload.ownerComment || '')
        .replace(/\s+/g, ' ').trim().slice(0, 500)
      const issueText = selectedReasons.length
        ? ` Confirmed user-selected issue${selectedReasons.length > 1 ? 's' : ''}: ${[...new Set(selectedReasons)].join('; ')}.`
        : (ownerComment ? ' No structured cause was confirmed.' : ' No cause was confirmed.')
      const commentText = ownerComment
        ? ` Owner comment (verbatim, may express uncertainty): ${JSON.stringify(ownerComment)}.`
        : ''
      lines.push(`- Exact prior outfit piece IDs [${sourceIds.join(', ')}] was marked ${verdict}.${issueText}${commentText} Do not reproduce this exact combination unchanged. Do not infer dislike of its formula, silhouette, colors, or individual garments.`)
      if (lines.length >= Number(limit)) break
    }
    if (lines.length < Number(limit)) {
      const unsavedRows = db.prepare(`
        SELECT * FROM stylist_feedback
        WHERE COALESCE(archived,0) = 0
          AND feedback_type IN ('almost','not_me')
          AND target_type = 'generated_visual_board'
          AND NOT EXISTS (
            SELECT 1 FROM saved_boards
            WHERE saved_boards.image_url = json_extract(stylist_feedback.payload, '$.board.imageUrl')
          )
        ORDER BY id DESC
        LIMIT 120
      `).all()
      for (const row of unsavedRows) {
        const payload = safeJsonParse(row.payload, {}) || {}
        const sourceIds = [...new Set(collectPieceIdsFromFeedbackPayload(row.payload))].sort((a, b) => a - b)
        if (sourceIds.length < 2 || !sourceIds.every(id => availableIds.has(id))) continue
        const evidenceContext = payload.scopedEvidence?.context || payload.outfit?.context || {}
        const storedContext = {
          occasion: String(evidenceContext.occasion || payload.outfit?.occasion || '').trim().toLowerCase(),
          activity: String(evidenceContext.activity || payload.outfit?.activity || '').trim().toLowerCase(),
          season: rowSeason(evidenceContext.season || payload.outfit?.season || '', row),
        }
        const contextMismatch = Object.keys(storedContext).some(key =>
          !feedbackContextMatches(storedContext[key], normalizedContext[key]))
        if (contextMismatch) continue
        const ownerComment = String(payload.ownerComment || '').replace(/\s+/g, ' ').trim().slice(0, 500)
        const verdict = row.feedback_type === 'not_me' ? 'Not for me' : 'Almost right'
        const commentText = ownerComment
          ? ` Owner comment (verbatim, may express uncertainty): ${JSON.stringify(ownerComment)}.`
          : ' No cause was confirmed.'
        lines.push(`- Exact prior outfit piece IDs [${sourceIds.join(', ')}] was marked ${verdict}.${commentText} Do not reproduce this exact combination unchanged. Do not infer dislike of its formula, silhouette, colors, or individual garments.`)
        if (lines.length >= Number(limit)) break
      }
    }
    return lines.join('\n')
  } catch {
    return ''
  }
}

// Provisional owner evidence is delivered only when its exact subject garment is already in the
// model's candidate/retrieval set. It is a compact verbatim reminder inside an existing styling
// call, never a score, standing preference, or reason invented by application code.
export function getProvisionalWrongChoiceMemory(pieceIds = [], limit = 3) {
  const allowedIds = new Set((Array.isArray(pieceIds) ? pieceIds : [pieceIds])
    .map(Number).filter(id => Number.isInteger(id) && id > 0))
  if (!allowedIds.size || limit <= 0) return ''
  try {
    const acceptedSources = acceptedPersonalSynthesisSources().feedbackIds
    const rows = db.prepare(`
      SELECT id, payload
      FROM stylist_feedback
      WHERE COALESCE(archived,0) = 0 AND feedback_type = ?
      ORDER BY id DESC
      LIMIT 240
    `).all(WRONG_PIECE_FOR_OUTFIT_FEEDBACK)
    const seen = new Set()
    const lines = []
    for (const row of rows) {
      if (acceptedSources.has(Number(row.id))) continue
      const payload = safeJsonParse(row.payload, {}) || {}
      const evidence = payload.feedbackEvidence
      if (Number(evidence?.version) !== 2 || evidence?.action !== 'wrong_piece_for_outfit') continue
      const pieceId = Number(evidence?.subject?.pieceId)
      if (!allowedIds.has(pieceId)) continue
      const reason = String(evidence?.explicitReason || '').trim()
      const subjectName = String(evidence?.subject?.name || `Piece ${pieceId}`).trim()
      const context = evidence?.context || {}
      const contextParts = [
        context.outfitLabel ? `outfit: ${context.outfitLabel}` : '',
        context.occasion ? `occasion: ${context.occasion}` : '',
        context.activity && context.activity !== 'none' ? `activity: ${context.activity}` : '',
        context.weather ? `weather: ${context.weather}` : '',
      ].filter(Boolean)
      const dedupeKey = `${pieceId}:${String(context.outfitLabel || '').toLowerCase()}:${reason.toLowerCase()}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      lines.push(reason
        ? `- ${subjectName} (ID ${pieceId}) was rejected${contextParts.length ? ` [${contextParts.join('; ')}]` : ''}. Owner reason: "${reason.slice(0, 360)}" Do not treat this as a global garment rejection or infer a broader preference.`
        : `- ${subjectName} (ID ${pieceId}) was rejected for this exact outfit${contextParts.length ? ` [${contextParts.join('; ')}]` : ''}. No reason was supplied: do not repeat the exact combination blindly, and do not infer any broader garment or owner preference.`)
      if (lines.length >= Math.min(6, Number(limit) || 3)) break
    }
    return lines.join('\n')
  } catch {
    return ''
  }
}

export function acceptedSynthesisApplicabilityMatches(applicability = {}, requestContext = {}) {
  const routed = ownerGuidanceApplicabilityFromSynthesis(applicability)
  const pieceIds = (Array.isArray(requestContext?.pieceIds) ? requestContext.pieceIds : [])
    .map(Number).filter(id => Number.isInteger(id) && id > 0)
  return ownerGuidanceApplies(routed, {
    requestContext,
    pieces: pieceIds.map(id => ({ id })),
  })
}

// Only owner-accepted personal/contextual synthesis drafts become styling prompt memory.
// Garment corrections and general styling failures remain visible review records, not owner taste.
// Applicability is structured and mechanically matched; boundary prose is display/explanation only.
export function getAcceptedFeedbackSynthesisMemory(limit = 8, requestContext = {}) {
  if (limit <= 0) return ''
  try {
    const rows = db.prepare(`
      SELECT id, proposed_text, edited_text, boundary, payload
      FROM feedback_synthesis_drafts
      WHERE status = 'accepted' AND disposition = 'personal_contextual_lesson'
      ORDER BY updated_at DESC, id DESC
      LIMIT 64
    `).all()
    const contexts = Array.isArray(requestContext?.contexts) && requestContext.contexts.length
      ? requestContext.contexts.map(context => ({ ...context, pieceIds: requestContext.pieceIds || context?.pieceIds || [] }))
      : [requestContext]
    return rows.filter(row => {
      const payload = safeJsonParse(row.payload, {}) || {}
      return contexts.some(context => acceptedSynthesisApplicabilityMatches(payload.applicability, context))
    }).slice(0, Math.min(16, Number(limit) || 8)).map(row => {
      const lesson = String(row.edited_text || row.proposed_text || '').trim().slice(0, 600)
      const boundary = String(row.boundary || '').trim().slice(0, 300)
      if (!lesson) return ''
      return `- ${lesson}${boundary ? ` Boundary: ${boundary}` : ''}`
    }).filter(Boolean).join('\n')
  } catch {
    return ''
  }
}

// Structured verdict version of the two readers above, for callers that have no model turn to
// hand prose reminders to. thread_1787895437637: applyComfortFootwearRepair (styling-engine/
// footwear-comfort.js) substitutes a shoe deterministically from a wide recovery pool with zero
// feedback awareness — the model never sees or judges the substitute, so there is no prompt for
// getAcceptedFeedbackSynthesisMemory/getProvisionalWrongChoiceMemory's prose to land in. This
// reuses the identical tables, acceptance rules, and matching functions those two readers already
// use (acceptedSynthesisApplicabilityMatches, acceptedPersonalSynthesisSources,
// WRONG_PIECE_FOR_OUTFIT_FEEDBACK) and returns which of the given piece ids are flagged, so a
// deterministic repair can exclude them the same way it already excludes discouraged footwear
// types. Provisional rows intentionally carry no context filter here either, matching
// getProvisionalWrongChoiceMemory's existing "ever explicitly rejected" semantics.
export function pieceIdsWithApplicableNegativeFeedback(pieceIds = [], context = {}) {
  const ids = new Set((Array.isArray(pieceIds) ? pieceIds : [])
    .map(Number).filter(id => Number.isInteger(id) && id > 0))
  const flagged = new Set()
  if (!ids.size) return flagged
  try {
    const rows = db.prepare(`
      SELECT payload FROM feedback_synthesis_drafts
      WHERE status = 'accepted' AND disposition = 'personal_contextual_lesson'
    `).all()
    for (const row of rows) {
      const applicability = (safeJsonParse(row.payload, {}) || {}).applicability
      const ruledPieceIds = Array.isArray(applicability?.piece_ids) ? applicability.piece_ids.map(Number) : []
      for (const pieceId of ruledPieceIds) {
        if (!ids.has(pieceId) || flagged.has(pieceId)) continue
        if (acceptedSynthesisApplicabilityMatches(applicability, { ...context, pieceIds: [pieceId] })) flagged.add(pieceId)
      }
    }
  } catch {}
  try {
    const acceptedSources = acceptedPersonalSynthesisSources().feedbackIds
    const rows = db.prepare(`
      SELECT id, payload FROM stylist_feedback
      WHERE COALESCE(archived,0) = 0 AND feedback_type = ?
      ORDER BY id DESC LIMIT 240
    `).all(WRONG_PIECE_FOR_OUTFIT_FEEDBACK)
    for (const row of rows) {
      if (acceptedSources.has(Number(row.id))) continue
      const evidence = (safeJsonParse(row.payload, {}) || {}).feedbackEvidence
      if (Number(evidence?.version) !== 2 || evidence?.action !== 'wrong_piece_for_outfit') continue
      const pieceId = Number(evidence?.subject?.pieceId)
      if (ids.has(pieceId)) flagged.add(pieceId)
    }
  } catch {}
  return flagged
}

// Chat threads have no per-message table — the whole conversation lives in
// payload.messages[]. Piece references show up as structuredOutfits[].pieceIds
// (or .pieces[].id) on assistant messages proposing an outfit.
export function collectPieceIdsFromChatThreadRow(row) {
  const ids = new Set()
  const payload = safeJsonParse(row?.payload, {})
  const messages = Array.isArray(payload?.messages) ? payload.messages : []
  for (const message of messages) {
    const outfits = Array.isArray(message?.structuredOutfits) ? message.structuredOutfits : []
    for (const outfit of outfits) {
      if (Array.isArray(outfit?.pieceIds)) {
        outfit.pieceIds.forEach(id => { if (!Number.isNaN(Number(id))) ids.add(Number(id)) })
      }
      if (Array.isArray(outfit?.pieces)) {
        outfit.pieces.forEach(p => { if (p?.id !== undefined && !Number.isNaN(Number(p.id))) ids.add(Number(p.id)) })
      }
    }
  }
  return [...ids]
}

// Per-piece usage signal for the Wardrobe "Most worn" / "Recently used" sort —
// "used" means referenced by the Visual Composer (saved_boards) or a Stylist
// chat recommendation (chat_threads), not literal real-world wear. Computed at
// query time from existing timestamped rows rather than a persisted counter.
export function getPieceUsageStats() {
  const stats = new Map()
  const bump = (pieceId, createdAt) => {
    const entry = stats.get(pieceId) || { count: 0, lastUsedAt: null }
    entry.count += 1
    if (!entry.lastUsedAt || (createdAt && createdAt > entry.lastUsedAt)) entry.lastUsedAt = createdAt || entry.lastUsedAt
    stats.set(pieceId, entry)
  }
  try {
    const boardRows = db.prepare('SELECT pieces, payload, context_type, context_id, created_at FROM saved_boards WHERE COALESCE(archived,0) = 0').all()
    for (const row of boardRows) {
      for (const pieceId of collectPieceIdsFromSavedBoardRow(row)) bump(pieceId, row.created_at)
    }
  } catch {}
  try {
    const threadRows = db.prepare("SELECT payload, updated_at, created_at FROM chat_threads WHERE COALESCE(archived,0) = 0").all()
    for (const row of threadRows) {
      const timestamp = row.updated_at || row.created_at
      for (const pieceId of collectPieceIdsFromChatThreadRow(row)) bump(pieceId, timestamp)
    }
  } catch {}
  return Object.fromEntries(stats)
}

export function getSavedBoardMemory(contextType = null, contextId = null, limit = 10, { excludeContexts = [] } = {}) {
  try {
    const clauses = ['COALESCE(archived,0) = 0']
    const params = []
    const acceptedBoardIds = [...acceptedPersonalSynthesisSources().boardIds]
    if (acceptedBoardIds.length) {
      clauses.push(`id NOT IN (${acceptedBoardIds.map(() => '?').join(',')})`)
      params.push(...acceptedBoardIds)
    }
    if (contextType) { clauses.push('context_type = ?'); params.push(contextType) }
    if (contextId) { clauses.push('context_id = ?'); params.push(Number(contextId)) }
    for (const context of excludeContexts) {
      if (!context?.type || !Number.isFinite(Number(context.id))) continue
      clauses.push('NOT (context_type = ? AND context_id IS ?)')
      params.push(context.type, Number(context.id))
    }
    const rows = db.prepare(`
      SELECT * FROM saved_boards
      WHERE ${clauses.join(' AND ')}
        AND (COALESCE(favorite,0) = 1 OR COALESCE(json_array_length(json_extract(payload, '$.feedback_labels')), 0) > 0)
      ORDER BY COALESCE(favorite,0) DESC, id DESC
      LIMIT ?
    `).all(...params, Number(limit))
    if (!rows.length) return ''
    const negativeLabels = /not_me|style_direction|shape_balance|too_safe|too_boho|too_polished|too_soft|too_generic|body_proportions_drift|wrong_silhouette|wrong_length|wrong_energy|weak_structure|weak_contrast|bad_grounding|catalog_like|ignore|bad|drift/i
    const negatives = []
    const silhouetteReasonLabels = {
      too_much_volume: 'too much overall volume',
      shape_lost: 'waist or shape was lost',
      unbalanced_proportions: 'top and bottom felt unbalanced',
      layer_too_long: 'top or layer was too long',
      competing_hemlines: 'hem lengths competed',
      too_columnar: 'too narrow or columnar',
      too_fitted: 'too fitted',
    }
    const tooSoftReasonLabels = {
      needs_structure: 'needs more structure',
      needs_contrast: 'needs stronger contrast',
      needs_grounding: 'needs better grounding',
      too_delicate: 'too delicate or romantic',
      too_blended: 'too visually blended',
    }
    const wrongEnergyReasonLabels = {
      too_formal: 'too formal',
      too_casual: 'too casual',
      too_severe: 'too severe',
      too_youthful: 'too youthful',
      too_sporty: 'too sporty',
      too_subdued: 'too subdued',
      too_polished: 'too polished',
    }
    const styleDirectionReasonLabels = {
      too_safe: 'too safe',
      too_polished: 'too polished',
      too_soft: 'too soft',
      too_generic: 'too generic',
      too_formal: 'too formal',
      too_casual: 'too casual',
      too_severe: 'too severe',
      too_youthful: 'too youthful',
      too_sporty: 'too sporty',
      too_subdued: 'too subdued',
      costume_like: 'costume-like',
      catalog_like: 'catalog-like',
    }
    for (const row of rows) {
      const pieces = safeJsonParse(row.pieces, []).map(p => p?.name).filter(Boolean).join(' + ')
      const payload = safeJsonParse(row.payload, {}) || {}
      const labels = Array.isArray(payload.feedback_labels)
        ? payload.feedback_labels.map(canonicalFeedbackType)
        : []
      const stylingLabels = labels.filter(label => feedbackBehaviour({
        feedback_type: String(label),
        target_type: 'generated_visual_board',
      }) === FEEDBACK_BEHAVIOURS.STYLING_PROMPT)
      const scopedEvidence = payload.scoped_evidence
      if (Number(scopedEvidence?.version) === 1 && scopedEvidence?.kind === SCOPED_EVIDENCE_KINDS.OUTFIT_LOGIC) {
        // Positive outfit logic is retained as provenance only. Delivering it here—even without
        // literal garment IDs—reinforces the same formula and works against closet discovery.
        continue
      }
      const labelText = stylingLabels.length ? ` [${stylingLabels.join(', ')}]` : ''
      const silhouetteReasons = Array.isArray(payload.feedback_details?.wrong_silhouette)
        ? payload.feedback_details.wrong_silhouette.map(value => silhouetteReasonLabels[value]).filter(Boolean)
        : []
      const tooSoftReasons = Array.isArray(payload.feedback_details?.too_soft)
        ? payload.feedback_details.too_soft.map(value => tooSoftReasonLabels[value]).filter(Boolean)
        : []
      const wrongEnergyReasons = Array.isArray(payload.feedback_details?.wrong_energy)
        ? payload.feedback_details.wrong_energy.map(value => wrongEnergyReasonLabels[value]).filter(Boolean)
        : []
      const styleDirectionReasons = Array.isArray(payload.feedback_details?.style_direction)
        ? payload.feedback_details.style_direction.map(value => styleDirectionReasonLabels[value]).filter(Boolean)
        : []
      const shapeBalanceReasons = Array.isArray(payload.feedback_details?.shape_balance)
        ? payload.feedback_details.shape_balance.map(value => silhouetteReasonLabels[value]).filter(Boolean)
        : []
      const detailParts = [
        silhouetteReasons.length ? `silhouette issue: ${silhouetteReasons.join('; ')}` : '',
        tooSoftReasons.length ? `softness issue: ${tooSoftReasons.join('; ')}` : '',
        wrongEnergyReasons.length ? `energy issue: ${wrongEnergyReasons.join('; ')}` : '',
        styleDirectionReasons.length ? `style direction issue: ${styleDirectionReasons.join('; ')}` : '',
        shapeBalanceReasons.length ? `shape and balance issue: ${shapeBalanceReasons.join('; ')}` : '',
      ].filter(Boolean)
      const detailText = detailParts.length ? ` | ${detailParts.join(' | ')}` : ''
      const reason = row.reason ? ` — ${String(row.reason).slice(0, 240)}` : ''
      const line = `- ${row.title || 'Untitled board'}${labelText}${pieces ? ` | pieces: ${pieces}` : ''}${detailText}${reason}`
      const hasNegativeFeedback = stylingLabels.some(label => negativeLabels.test(String(label)))
      if (hasNegativeFeedback) negatives.push(line)
    }
    const parts = []
    if (negatives.length) parts.push(`Saved visual board negative memory. Avoid repeating these drift/problem patterns:\n${negatives.slice(0, 10).join('\n')}`)
    return parts.join('\n\n')
  } catch {
    return ''
  }
}

export function getSavedBoardRendererMemory(pieceIds = [], limit = 24) {
  try {
    const requestedIds = new Set((Array.isArray(pieceIds) ? pieceIds : []).map(Number).filter(Boolean))
    const rows = db.prepare(`
      SELECT * FROM saved_boards
      WHERE COALESCE(archived,0) = 0
        AND COALESCE(json_array_length(json_extract(payload, '$.feedback_labels')), 0) > 0
      ORDER BY id DESC
      LIMIT ?
    `).all(Number(limit))
    const corrections = new Set()
    let bodyProportionsDrift = false
    let identityDrift = false
    const lengthIssueLabels = {
      sleeves_too_long: 'sleeves rendered too long',
      sleeves_too_short: 'sleeves rendered too short',
      upper_hem_too_long: 'top or jacket hem rendered too long',
      upper_hem_too_short: 'top or jacket hem rendered too short',
      lower_hem_too_long: 'pants, skirt, or dress rendered too long',
      lower_hem_too_short: 'pants, skirt, or dress rendered too short',
    }

    for (const row of rows) {
      const payload = safeJsonParse(row.payload, {}) || {}
      const labels = Array.isArray(payload.feedback_labels)
        ? payload.feedback_labels.map(canonicalFeedbackType)
        : []
      const boardPieceIds = collectPieceIdsFromSavedBoardRow(row)
      const overlaps = requestedIds.size === 0 || boardPieceIds.some(id => requestedIds.has(Number(id)))
      if (labels.includes('body_proportions_drift')) bodyProportionsDrift = true
      if (labels.includes('identity_drift')) identityDrift = true
      if (!overlaps) continue

      const boardPieces = safeJsonParse(row.pieces, [])
      const relevantNames = boardPieces
        .filter(piece => requestedIds.size === 0 || requestedIds.has(Number(piece?.id)))
        .map(piece => piece?.name)
        .filter(Boolean)

      if (labels.includes('wrong_garment_details') && relevantNames.length) {
        corrections.add(`Preserve the exact construction, color, print, neckline, sleeves, and other visible details of: ${relevantNames.join(', ')}.`)
      }

      const lengthCorrections = Array.isArray(payload.feedback_details?.wrong_length)
        ? payload.feedback_details.wrong_length
        : []
      for (const correction of lengthCorrections) {
        const correctionPieceId = Number(correction?.piece_id)
        if (requestedIds.size && !requestedIds.has(correctionPieceId)) continue
        const issue = lengthIssueLabels[correction?.issue]
        if (issue) corrections.add(`${correction?.piece_name || `Garment ${correctionPieceId}`}: prior render had ${issue}; match the saved garment reference length.`)
      }
    }

    const feedbackRows = db.prepare(`
      SELECT * FROM stylist_feedback
      WHERE COALESCE(archived,0) = 0
        AND target_type = 'generated_visual_board'
        AND feedback_type IN ('wrong_length','wrong_garment_details','body_proportions_drift','identity_drift','wrong_proportions','proportion_problem')
      ORDER BY id DESC
      LIMIT ?
    `).all(Number(limit))
    for (const row of feedbackRows) {
      const feedbackPayload = safeJsonParse(row.payload, {}) || {}
      const ids = collectPieceIdsFromFeedbackPayload(row.payload)
      const overlaps = requestedIds.size === 0 || ids.some(id => requestedIds.has(Number(id)))
      const feedbackType = canonicalFeedbackType(row.feedback_type)
      if (feedbackType === 'body_proportions_drift') bodyProportionsDrift = true
      if (feedbackType === 'identity_drift') identityDrift = true
      if (!overlaps) continue
      const payloadNames = Array.isArray(feedbackPayload?.board?.pieces)
        ? feedbackPayload.board.pieces
          .filter(piece => requestedIds.size === 0 || requestedIds.has(Number(piece?.id)))
          .map(piece => piece?.name)
          .filter(Boolean)
        : []
      const names = payloadNames.length
        ? payloadNames
        : (ids.length ? db.prepare(`SELECT name FROM pieces WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(piece => piece.name).filter(Boolean) : [])
      if (feedbackType === 'wrong_garment_details' && names.length) {
        corrections.add(`Preserve the exact construction, color, print, neckline, sleeves, and other visible details of: ${names.join(', ')}.`)
      }
      if (feedbackType === 'wrong_length') {
        // length_correction names exactly one garment — the one this report is actually about. A
        // malformed/legacy row with no piece_id carries no attribution at all, so it must not fall
        // back to blaming every other garment that merely shares this board (that previously misled
        // a garment that was never reported wrong, e.g. shorts blamed for a report about the top
        // worn with them, just because both were in the same outfit's `board.pieces` list).
        const lengthCorrection = feedbackPayload.length_correction
        const issue = lengthIssueLabels[lengthCorrection?.issue]
        const correctedPieceId = Number(lengthCorrection?.piece_id)
        const correctedPieceIsRequested = requestedIds.size === 0 || requestedIds.has(correctedPieceId)
        if (issue && correctedPieceId && correctedPieceIsRequested) {
          corrections.add(`${lengthCorrection.piece_name || `Garment ${correctedPieceId}`}: prior render had ${issue}; match the saved garment reference length.`)
        }
      }
    }

    if (bodyProportionsDrift) corrections.add('Keep the person’s body proportions consistent with the supplied real-photo calibration references; do not elongate, narrow, or reshape the body.')
    if (identityDrift) corrections.add('Preserve the person’s facial identity and resemblance from the supplied real-photo calibration references; do not substitute a generic model.')
    if (!corrections.size) return ''
    return `Renderer-only corrections from prior generated boards:\n${[...corrections].slice(0, 12).map(line => `- ${line}`).join('\n')}`
  } catch {
    return ''
  }
}

export function explicitOccasionsForPiece(piece = {}) {
  return Array.isArray(piece.occasions) ? piece.occasions.map(o => String(o).toLowerCase()) : []
}

export function profileOccasionConfidence(piece = {}, occasion = '') {
  const intelligence = pieceGarmentIntelligence(piece)
  return String(intelligence.occasionConfidence?.[occasion] || '').toLowerCase()
}

export function isUtilityOrCargoPiece(piece = {}) {
  const name = String(piece.name || '').toLowerCase()
  const notes = String(piece.notes || '').toLowerCase()
  const engineNotes = String(piece.engine_notes || '').toLowerCase()
  const profile = pieceStyleProfile(piece)
  
  if (profile?.style_lanes?.workwear_utilitarian >= 3) return true
  
  // TODO: backfill styling profile fields for cargo/utility
  return /\b(cargo|utility)\b/i.test(`${name} ${notes} ${engineNotes}`)
}

export function pieceMatchesOccasion(piece = {}, occasion = '') {
  const requested = String(occasion || '').toLowerCase().trim()
  if (!requested) return true
  const occasions = explicitOccasionsForPiece(piece)
  if (occasions.includes(requested)) return true // User tag overrides AI profile confidence
  const confidence = profileOccasionConfidence(piece, requested)
  return confidence === 'high' || confidence === 'medium'
}

export function styleLaneScore(piece = {}, lane = '') {
  const lanes = pieceStyleProfile(piece)?.style_lanes || {}
  const score = Number(lanes[lane])
  return Number.isFinite(score) ? score : 0
}

export function garmentProfileText(piece = {}) {
  const intelligence = pieceGarmentIntelligence(piece)
  const profile = pieceStyleProfile(piece)
  return [
    profile?.style_notes?.best_use,
    profile?.style_notes?.risk,
    intelligence.bestOutfitRole,
    ...intelligence.pairingRequirements,
    ...intelligence.failureRisks,
    ...intelligence.formulaCompatibility,
    ...intelligence.doNotPairRules,
    ...Object.values(intelligence.realWearNotes || {})
  ].filter(Boolean).join(' ').toLowerCase()
}

export function optionalLayerCoherenceIssue(selected = {}, layer = {}, corePieces = [], options = {}) {
  if (wardrobeCategoryGroup(layer) !== 'outerwear') return ''
  const occasion = String(options.occasion || '').toLowerCase().trim()
  if (occasion && !pieceMatchesOccasion(layer, occasion)) return `weak ${occasion} occasion fit`

  const core = [selected, ...corePieces].filter(Boolean)
  const coreText = core.map(piece => `${pieceTextBlob(piece)} ${garmentProfileText(piece)}`).join(' ')
  const layerText = `${pieceTextBlob(layer)} ${garmentProfileText(layer)}`
  const polishedLayer = styleLaneScore(layer, 'polished_classic') >= 4 ||
    /\b(tweed|blazer|tailored|polished|classic|formal|structured jacket)\b/.test(layerText)
  const relaxedCore = /\b(relaxed|capri|wide-leg|wide leg|linen|cotton|athletic|sneaker|slip-on|easy everyday|soft|casual)\b/.test(coreText)
  const layerWarnsAgainstRelaxed = /\b(too formal|stiff|overly relaxed|casual bottoms|relaxed pieces|overly casual)\b/.test(layerText)
  if (polishedLayer && relaxedCore && layerWarnsAgainstRelaxed) return 'optional polished layer fights the relaxed core outfit'

  const expressiveCoreCount = core.filter(piece => {
    const text = `${pieceTextBlob(piece)} ${garmentProfileText(piece)}`
    return /\b(floral|graphic|print|pattern|polka|bow|lace|ruffle|bold|statement|texture_piece|color_accent)\b/.test(text)
  }).length
  const texturedLayer = /\b(tweed|jacquard|boucle|embroider|texture_piece|pattern|print)\b/.test(layerText)
  if (texturedLayer && expressiveCoreCount >= 2) return 'optional layer adds a competing texture to an already expressive core'

  return ''
}

export function compatibilityScoreForSelectedItem(selected, candidate, options = {}) {
  let score = 0
  const reasons = []
  const selectedBlob = pieceTextBlob(selected)
  const candidateBlob = pieceTextBlob(candidate)
  const occasion = String(options.occasion || '').toLowerCase().trim()

  // Weather appropriateness — independent term, applies to every candidate
  const weather = options.weatherProfile || weatherProfileFromContext(options)
  const weatherFit = weatherFitForPiece(candidate, weather)
  if (weatherFit.adjustments.length) {
    score += weatherFit.score
    for (const adjustment of weatherFit.adjustments) {
      reasons.push(adjustment.reason)
    }
  }

  const candidateFormalityFit = formalityFitForPiece(candidate, options)
  if (candidateFormalityFit.adjustments.length) {
    score += candidateFormalityFit.score
    for (const adjustment of candidateFormalityFit.adjustments) {
      reasons.push(adjustment.reason)
    }
  }
  const pairFormalityFit = formalityFitForOutfit([selected, candidate], options)
  if (pairFormalityFit.adjustments.length) {
    const pairScore = Math.max(-18, Math.min(10, Math.round(pairFormalityFit.score * 0.45)))
    score += pairScore
    reasons.push(...pairFormalityFit.adjustments.slice(0, 2).map(adjustment => adjustment.reason))
  }

  if (hasRejectedReference(selected, candidate) || hasRejectedReference(candidate, selected)) {
    score -= 40; reasons.push('rejected pairing note')
  }

  if (occasion && !pieceMatchesOccasion(candidate, occasion)) {
    score -= 14
    reasons.push(`weak ${occasion} occasion fit`)
  }

  if (options.comfortConstraint && (candidate.category === 'shoes' || wardrobeCategoryGroup(candidate) === 'shoes')) {
    const { discouraged_footwear = [], keep_footwear = [] } = options.comfortConstraint
    let matchedKeep = false
    for (const fw of keep_footwear) {
      if (pieceMatchesFootwear(candidate, fw)) {
        score += 10
        reasons.push(`comfort constraint: preferred footwear (${fw})`)
        matchedKeep = true
        break
      }
    }
    if (!matchedKeep) {
      for (const fw of discouraged_footwear) {
        if (pieceMatchesFootwear(candidate, fw)) {
          score -= 10
          reasons.push(`comfort constraint: discouraged footwear (${fw})`)
          break
        }
      }
    }
  }
  const layerIssue = optionalLayerCoherenceIssue(selected, candidate, [], { occasion })
  if (layerIssue) {
    score -= 24
    reasons.push(layerIssue)
  }

  if (selected.category === 'bottom') {
    if (candidate.category === 'top') { score += 10; reasons.push('needed top for selected bottom') }
    if (candidate.category === 'shoes') { score += 4; reasons.push('shoe support') }
    if (candidate.category === 'accessory') { score += 2; reasons.push('accessory support') }
    if (candidate.category === 'bottom' || candidate.category === 'dress') { score -= 60; reasons.push('competing bottom/dress') }

    if (candidate.category === 'top') {
      if (textIncludesAny(candidateBlob, ['fitted', 'slim', 'compact', 'structured', 'sleeveless', 'shell', 'tank', 'short sleeve', 'short-sleeve'])) {
        score += 12; reasons.push('compact/structured top')
      }
      if (textIncludesAny(candidateBlob, ['boxy', 'oversized', 'drop-shoulder', 'loose', 'relaxed']) &&
          textIncludesAny(selectedBlob, ['wide', 'bootcut', 'relaxed', 'gauzy', 'soft', 'corduroy', 'stripe'])) {
        score -= 8; reasons.push('wide/soft top risk with statement bottom')
      }
      if (textIncludesAny(candidateBlob, ['long', 'mid-thigh', 'tunic']) && textIncludesAny(selectedBlob, ['stripe', 'corduroy', 'wide', 'bootcut'])) {
        score -= 8; reasons.push('long layer may break vertical line')
      }
    }
  } else if (selected.category === 'top') {
    if (candidate.category === 'bottom') { score += 10; reasons.push('needed bottom for selected top') }
    if (candidate.category === 'shoes') { score += 4; reasons.push('shoe support') }
    if (candidate.category === 'accessory') { score += 2; reasons.push('accessory support') }
    if (candidate.category === 'top') { score -= 60; reasons.push('competing top') }

    if (candidate.category === 'bottom') {
      const cleanSelectedBlob = selectedBlob.replace(/\b(t-shirt|sweatshirt|tee-shirt|tee shirt|t shirt)\b/gi, '')
      const selectedIsButtonOrTunic = (
        textIncludesAny(cleanSelectedBlob, ['button-up', 'button up', 'button-down', 'button down', 'tunic', 'popover', 'longline']) ||
        /\bshirt\b/i.test(cleanSelectedBlob)
      )
      const selectedIsCompactTop = textIncludesAny(selectedBlob, ['shell', 'sleeveless', 'tank', 'compact', 'cropped', 'short sleeve', 'short-sleeve', 'fitted knit', 'fitted top']) && !selectedIsButtonOrTunic
      
      const bKind = bottomKind(candidate)
      const bottomIsSkirt = bKind && bKind.startsWith('skirt')
      const bottomIsShorts = bKind === 'shorts'
      const bottomIsPantsColumn = bKind === 'pants' && (colorFamily(candidate) === 'dark-anchor' || colorFamily(candidate) === 'warm-earth' || textIncludesAny(candidateBlob, ['jeans', 'denim', 'pants', 'trousers', 'straight', 'slim', 'bootcut', 'flare', 'wide-leg', 'wide leg', 'column']))
      
      const bottomIsAbruptSkirt = bKind === 'skirt-mini'
      const bottomIsUsefulSkirt = bKind === 'skirt-midi' || bKind === 'skirt-maxi'
      const selectedWeight = visualWeightProfile(selected)
      const candidateWeight = visualWeightProfile(candidate)
      const selectedIsDark = isDarkPiece(selected)
      const selectedNeedsAnchor = (selectedWeight.softness >= 2 && !selectedIsDark) || (selectedWeight.expressive && textIncludesAny(selectedBlob, ['lace','floral','appliqué','applique','sheer','cream','white','pale','soft']) && !selectedIsDark)

      if (selectedNeedsAnchor && candidateWeight.grounding >= 3) {
        score += 14; reasons.push('visual gravity for soft/expressive top')
      }
      if (selectedNeedsAnchor && candidateWeight.grounding < 1) {
        score -= 12; reasons.push('too little lower-half anchor')
      }
      if (selectedNeedsAnchor && textIncludesAny(candidateBlob, ['white','cream','pale','light']) && !textIncludesAny(candidateBlob, ['denim','structured','utility','twill','pencil','maxi'])) {
        score -= 7; reasons.push('pale-on-pale softness risk')
      }
      if (bottomIsUsefulSkirt && candidateWeight.grounding >= 3) {
        score += 10; reasons.push('grounded skirt anchor')
      }

      if (textIncludesAny(candidateBlob, ['structured', 'column', 'dark', 'navy', 'black', 'brown', 'denim', 'straight', 'slim', 'bootcut', 'flare'])) {
        score += 12; reasons.push('stable vertical bottom')
      }
      if (bottomIsPantsColumn && selectedIsButtonOrTunic) {
        score += 10; reasons.push('preserves vertical continuity for shirt/tunic')
      }
      if (bottomIsUsefulSkirt && selectedIsCompactTop) {
        score += 8; reasons.push('compact top can support skirt formula')
      }
      if (bottomIsAbruptSkirt && selectedIsButtonOrTunic) {
        score -= 22; reasons.push('abrupt skirt hem weakens vertical continuity')
      } else if (bottomIsAbruptSkirt && !selectedIsCompactTop) {
        score -= 12; reasons.push('short skirt is less signature without compact top')
      }
      if (textIncludesAny(candidateBlob, ['gauzy', 'soft', 'wide', 'relaxed']) && textIncludesAny(selectedBlob, ['loose', 'oversized', 'boxy', 'drape', 'tunic'])) {
        score -= 12; reasons.push('wide + soft risk')
      }
    }
  } else if (selected.category === 'dress') {
    if (['shoes','accessory','outerwear'].includes(candidate.category)) { score += 8; reasons.push('supports selected dress') }
    if (['top','bottom','dress'].includes(candidate.category)) { score -= 40; reasons.push('replaces dress') }
  } else if (selected.category === 'shoes') {
    if (candidate.category === 'top') { score += 9; reasons.push('needed top for selected shoes') }
    if (candidate.category === 'bottom') { score += 9; reasons.push('needed bottom for selected shoes') }
    if (candidate.category === 'dress') { score += 8; reasons.push('dress formula for selected shoes') }
    if (candidate.category === 'outerwear') { score += 4; reasons.push('layer support for selected shoes') }
    if (candidate.category === 'accessory') { score += 2; reasons.push('accessory support') }
    if (candidate.category === 'shoes') { score -= 60; reasons.push('replacement shoe') }
  }

  const earthyOrDeep = ['olive','mustard','cognac','cream','beige','taupe','navy','denim','brown','tan','oatmeal','amber','plum','charcoal','dark blue','dark grey']
  const sharedColors = (candidate.colors || []).filter(c => (selected.colors || []).includes(c))
  if (sharedColors.length) { score += 3; reasons.push(`shared color: ${sharedColors.slice(0,2).join('/')}`) }
  if ((candidate.colors || []).some(c => earthyOrDeep.includes(c))) { score += 3; reasons.push('signature palette') }
  if (textIncludesAny(candidateBlob, ['artistic', 'graphic', 'architectural', 'texture', 'textured', 'corduroy', 'crochet', 'cashmere', 'linen', 'knit'])) {
    score += 4; reasons.push('artistic/texture vocabulary')
  }

  const selectedSoft = textIncludesAny(selectedBlob, ['gauzy', 'soft', 'drape', 'loose knit', 'oversized', 'relaxed'])
  const candidateSoft = textIncludesAny(candidateBlob, ['gauzy', 'soft', 'drape', 'loose knit', 'oversized', 'relaxed'])
  if (selectedSoft && candidateSoft) { score -= 7; reasons.push('soft + soft risk') }

  const selectedExpressive = textIncludesAny(selectedBlob, ['loud', 'bold', 'graphic', 'floral', 'stripe', 'abstract', 'multi', 'pattern'])
  const candidateExpressive = textIncludesAny(candidateBlob, ['loud', 'bold', 'graphic', 'floral', 'stripe', 'abstract', 'multi', 'pattern'])
  // TODO: a register attribute in attributes.js could one day let the penalty fire only on cross-register pairs.
  if (selectedExpressive && candidateExpressive) { score -= 5; reasons.push('expressive competition risk') }

  return { score, reasons }
}

export function rankedComplementaryWardrobeFor(piece, allPieces, limit = 24, options = {}) {
  const selectedCategory = piece.category
  const allowed = allPieces.filter(p => {
    if (p.id === piece.id) return false
    if (selectedCategory === 'bottom') return ['top','outerwear','shoes','accessory'].includes(p.category)
    if (selectedCategory === 'top') return ['bottom','outerwear','shoes','accessory'].includes(p.category)
    if (selectedCategory === 'dress') return ['outerwear','shoes','accessory'].includes(p.category)
    if (selectedCategory === 'outerwear') return ['top','bottom','dress','shoes','accessory'].includes(p.category)
    if (selectedCategory === 'shoes') return ['top','bottom','dress','outerwear','accessory'].includes(p.category)
    return true
  })

  return allowed
    .map(p => {
      const scored = compatibilityScoreForSelectedItem(piece, p, options)
      const sharedEligibility = options.eligibilityDecisionsById?.get(Number(p.id))
      const trust = sharedEligibility
        ? {
            allowed: sharedEligibility.underlyingAllowed,
            supportOnly: sharedEligibility.supportOnly,
            reasons: sharedEligibility.reasons,
          }
        : wholeWardrobePieceTrustDecision(p, {
            occasion: options.occasion || 'casual',
            season: options.season,
            activity: options.activity,
            mood: options.mood,
            request: options.request,
            question: options.question,
            explorationMode: options.explorationMode || 'moderate',
            weatherProfile: options.weatherProfile
          })
      return {
        piece: p,
        ...scored,
        score: scored.score + (trust.allowed ? 0 : -120),
        reasons: [
          ...(scored.reasons || []),
          ...(trust.allowed ? [] : trust.reasons.map(reason => `auto-use blocked: ${reason}`))
        ],
        autoUseBlocked: !trust.allowed,
        autoUseBlockReasons: trust.reasons
      }
    })
    .sort((a,b) => b.score - a.score || String(a.piece.category).localeCompare(String(b.piece.category)))
    .slice(0, limit)
}

export function complementaryWardrobeFor(piece, allPieces, limit = 24, options = {}) {
  return rankedComplementaryWardrobeFor(piece, allPieces, limit, options).map(r => r.piece)
}

export function buildRankedCandidateText(rankedCandidates) {
  if (!rankedCandidates?.length) return ''
  return rankedCandidates.map((r, idx) => {
    const reasonText = r.reasons?.length ? `\n  RANKING REASONS: ${r.reasons.slice(0, 4).join('; ')} | score ${r.score}` : ''
    return `${idx + 1}. ${buildPieceText(r.piece)}${reasonText}`
  }).join('\n')
}

export function selectCandidatesForOutfitGeneration(piece, allPieces, limit = 30, options = {}) {
  // Rank the FULL eligible wardrobe before any truncation — the per-category
  // addSome() quotas below are what should bound each category's contribution.
  // Passing `limit` here instead would apply a single global top-N cut before
  // categories are separated, which can silently starve an entire category
  // (e.g. shoes) when another category scores higher for this particular
  // anchor piece, even though that category has plenty of eligible pieces.
  const ranked = rankedComplementaryWardrobeFor(piece, allPieces, allPieces.length, options)
  const byCategory = { top: [], bottom: [], dress: [], outerwear: [], shoes: [], accessory: [] }
  for (const r of ranked) {
    const cat = r.piece.category || 'other'
    if (byCategory[cat]) byCategory[cat].push(r)
  }
  const mixed = []
  const addSome = (cat, count) => {
    const rows = byCategory[cat] || []
    const trusted = rows.filter(r => !r.autoUseBlocked)
    const source = trusted.length ? trusted : rows
    mixed.push(...source.slice(0, count))
  }

  if (wardrobeCategoryGroup(piece) === 'top') {
    addSome('bottom', 12); addSome('shoes', 8); addSome('outerwear', 5); addSome('accessory', 5)
  } else if (wardrobeCategoryGroup(piece) === 'bottom') {
    addSome('top', 12); addSome('shoes', 8); addSome('outerwear', 5); addSome('accessory', 5)
  } else if (wardrobeCategoryGroup(piece) === 'dress') {
    addSome('shoes', 10); addSome('outerwear', 8); addSome('accessory', 6)
  } else if (wardrobeCategoryGroup(piece) === 'shoes') {
    addSome('top', 12); addSome('bottom', 12); addSome('dress', 8); addSome('outerwear', 6); addSome('accessory', 4)
  } else {
    mixed.push(...ranked.slice(0, limit))
  }

  const seen = new Set()
  const initialSelection = mixed.filter(r => {
    if (seen.has(r.piece.id)) return false
    seen.add(r.piece.id)
    return true
  }).slice(0, limit)
  const rowById = new Map(ranked.map(row => [Number(row.piece.id), row]))
  const covered = buildCoveredCandidateSet({
    rankedPieces: ranked.map(row => row.piece).filter(candidate => Number(candidate.id) !== Number(piece?.id)),
    initialSelection: initialSelection.map(row => row.piece),
    capacity: limit,
    requirements: [completeOutfitSupplyRequirement({ anchorPiece: piece, id: 'selected_anchor_outfit_path' })],
  })
  const result = covered.pieces.map(candidate => rowById.get(Number(candidate.id))).filter(Boolean)
  Object.defineProperty(result, 'coverageReport', { value: covered.report, enumerable: false })
  return result
}

export function buildOutfitGenerationCandidateText(rankedCandidates) {
  if (!rankedCandidates?.length) return ''
  return rankedCandidates.map((r, idx) => {
    const p = r.piece
    const reasons = r.reasons?.length ? `\n  WHY RETRIEVED: ${r.reasons.slice(0, 5).join('; ')} | score ${r.score}` : ''
    return `${idx + 1}. [garment id: ${p.id}] ${buildPieceText(p)}${reasons}`
  }).join('\n')
}

export function getOutfitsForPieceMemory(pieceId, limit = 6) {
  const outfits = db.prepare(`
    SELECT o.* FROM outfits o
    JOIN outfit_pieces op ON o.id = op.outfit_id
    WHERE op.piece_id = ?
    ORDER BY o.date_added DESC
    LIMIT ?
  `).all(pieceId, limit)
  return outfits.map(o => buildOutfitText(o, getLinkedPiecesForOutfit(o.id))).join('\n\n')
}

// These are mock-like wrappers or helpers used to avoid missing definitions:
function buildOutfitText(o, pieces) {
  const pieceNames = pieces.map(p => `${p.name} (${p.category})`).join(' + ')
  return `• Outfit: ${o.name} | occasion: ${o.occasion} | season: ${o.season} | pieces: ${pieceNames} | notes: ${o.notes || 'none'}`
}

function getLinkedPiecesForOutfit(outfitId) {
  const rows = db.prepare(`
    SELECT p.* FROM pieces p
    JOIN outfit_pieces op ON p.id = op.piece_id
    WHERE op.outfit_id = ?
  `).all(outfitId)
  return rows.map(p => parsePiece(p))
}


// Spec 25 Part 2: rows written by store_user_correction (feedback_type
// 'owner_rule' going forward; the legacy 'preference_reaction'/'message' rows
// written before this spec are still owner rules — no migration, same
// selector). Kept as a plain predicate so getStylistFeedbackMemory and the
// plan-workbench delivery path (getOwnerRuleNotes) select identically.
function isOwnerRuleRow(row = {}) {
  return row.feedback_type === 'owner_rule' ||
    (row.feedback_type === 'preference_reaction' && row.target_type === 'message')
}

export function getStylistFeedbackMemory(contextType = null, contextId = null, limit = 16, { excludeContexts = [], ownerGuidanceContext = null } = {}) {
  try {
    const deliveryLimit = Math.max(0, Number(limit) || 0)
    if (!deliveryLimit) return ''
    const clauses = [`NOT (
      target_type = 'generated_visual_board'
      AND EXISTS (
        SELECT 1 FROM saved_boards
        WHERE saved_boards.image_url = json_extract(stylist_feedback.payload, '$.board.imageUrl')
      )
    )`]
    const params = []
    if (contextType) { clauses.push('context_type = ?'); params.push(contextType) }
    if (contextId) { clauses.push('context_id = ?'); params.push(Number(contextId)) }
    for (const context of excludeContexts) {
      if (!context?.type || !Number.isFinite(Number(context.id))) continue
      clauses.push('NOT (context_type = ? AND context_id IS ?)')
      params.push(context.type, Number(context.id))
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    // Read beyond the delivery cap so repeated legacy prose cannot consume all
    // of the slots before it is consolidated below. This remains bounded; it
    // does not turn prompt construction into an unbounded history scan.
    const scanLimit = Math.min(Math.max(deliveryLimit * 20, deliveryLimit), 4000)
    const rows = db.prepare(`
      SELECT * FROM stylist_feedback
      ${where ? where + ' AND COALESCE(archived,0) = 0' : 'WHERE COALESCE(archived,0) = 0'}
      ORDER BY id DESC
      LIMIT ?
    `).all(...params, scanLimit)

    if (!rows.length) return ''

    // Spec 25 Part 2/3: owner rules are standing instructions the model must
    // apply everywhere; reaction history is taste feedback scoped to the
    // board/context it was given on. Rendering them under the same flat list
    // (the pre-spec-25 shape) let a stored office/client rule read as just
    // another reaction crumb and get out-competed by an unrelated praise
    // corpus. Owner rules always sort to the top, under their own
    // sub-header, severed from the scoped-reaction section below.
    const ownerRuleLines = []
    const legacyReactionLines = new Map()
    const acceptedSources = acceptedPersonalSynthesisSources().feedbackIds
    let deliveredUnits = 0
    for (const r of rows) {
      if (acceptedSources.has(Number(r.id))) continue
      const behaviour = feedbackBehaviour(r)
      if (behaviour === FEEDBACK_BEHAVIOURS.OWNER_PROMPT) {
        const applicability = ownerGuidanceApplicabilityForFeedback(r)
        // Rows without an envelope are legacy data awaiting owner review. New writers always
        // persist either a resolved or explicit unresolved envelope, so unresolved new guidance
        // cannot silently regain global authority.
        if (applicability && !ownerGuidanceApplies(applicability, ownerGuidanceContext || {})) continue
        if (deliveredUnits >= deliveryLimit) continue
        ownerRuleLines.push(`- OWNER RULE: ${String(r.note || '').trim().slice(0, 280)}`)
        deliveredUnits += 1
        continue
      }
      if (behaviour !== FEEDBACK_BEHAVIOURS.STYLING_PROMPT) continue
      const feedbackPayload = safeJsonParse(r.payload, {}) || {}
      const scopedEvidence = feedbackPayload.scopedEvidence
      if (Number(scopedEvidence?.version) === 1 && scopedEvidence?.kind === SCOPED_EVIDENCE_KINDS.OUTFIT_LOGIC) {
        // Stored positive logic remains inspectable provenance, not styling authority.
        continue
      }
      if (POSITIVE_WHOLE_WARDROBE_PROMPT_TYPES.has(r.feedback_type)) continue
      const target = r.target_type ? `${r.target_type}` : 'item'
      const label = r.label ? ` — ${r.label}` : ''
      const note = r.note ? `: ${String(r.note).slice(0, 280)}` : ''
      const feedbackReason = FEEDBACK_REASON_LABELS[feedbackPayload.feedback_reason]
      if ((r.feedback_type === 'style_direction' || r.feedback_type === 'shape_balance') && feedbackReason) {
        const category = r.feedback_type === 'style_direction' ? 'style direction' : 'fit and shape'
        const line = `- ${category} issue on ${target}${label}: ${feedbackReason}${note} — scoped to this board; correct this issue without turning it into a universal ban.`
        if (!legacyReactionLines.has(line) && deliveredUnits < deliveryLimit) {
          legacyReactionLines.set(line, line)
          deliveredUnits += 1
        }
        continue
      }
      if (r.feedback_type === 'wrong_silhouette') {
        const line = `- wrong_silhouette on ${target}${label}${note} — scoped to this selected garment/board; do NOT globally avoid this silhouette family.`
        if (!legacyReactionLines.has(line) && deliveredUnits < deliveryLimit) {
          legacyReactionLines.set(line, line)
          deliveredUnits += 1
        }
        continue
      }
      const line = `- ${r.feedback_type} on ${target}${label}${note}`
      if (!legacyReactionLines.has(line) && deliveredUnits < deliveryLimit) {
        legacyReactionLines.set(line, line)
        deliveredUnits += 1
      }
    }

    const reactionLines = [...legacyReactionLines.values()]
    const sections = []
    if (ownerRuleLines.length) {
      sections.push(`Owner rules (standing, apply them):\n${ownerRuleLines.join('\n')}`)
    }
    if (reactionLines.length) {
      sections.push(`Saved reactions (scoped to the named board/context they were given on — taste signals, not global directives):\n${reactionLines.join('\n')}`)
    }
    return sections.join('\n\n')
  } catch {
    return ''
  }
}

// Spec 25 Part 2: the plan workbench (the one place composition-time context
// actually gets obeyed — every existing plan instruction lives there, ~40k
// tokens closer to the model's attention than the system-prompt tail) needs
// the same owner-rule rows as plain notes, newest first, capped small so the
// workbench doesn't balloon. Deterministic string pass-through — these
// remain prompt guidance, never a mechanical gate (the #44 memory-pollution
// lesson: stored text must never get absolute mechanical authority).
export function getOwnerRuleNotes(limit = 8, ownerGuidanceContext = null) {
  try {
    const deliveryLimit = Math.max(0, Number(limit) || 0)
    if (!deliveryLimit) return []
    const scanLimit = Math.min(Math.max(deliveryLimit * 20, deliveryLimit), 4000)
    const rows = db.prepare(`
      SELECT * FROM stylist_feedback
      WHERE COALESCE(archived,0) = 0
        AND (feedback_type = 'owner_rule' OR (feedback_type = 'preference_reaction' AND target_type = 'message'))
      ORDER BY id DESC
      LIMIT ?
    `).all(scanLimit)
    return rows.filter(row => {
      const applicability = ownerGuidanceApplicabilityForFeedback(row)
      return !applicability || ownerGuidanceApplies(applicability, ownerGuidanceContext || {})
    }).map(r => String(r.note || '').trim()).filter(Boolean).slice(0, deliveryLimit)
  } catch {
    return []
  }
}

export function getWholeWardrobeFeedbackMemory(limit = 24) {
  try {
    const rows = db.prepare(`
      SELECT * FROM stylist_feedback
      WHERE COALESCE(archived,0) = 0
        AND target_type = 'whole_wardrobe_outfit'
      ORDER BY id DESC
      LIMIT ?
    `).all(Number(limit))

    if (!rows.length) return ''
    const negatives = []
    for (const row of rows) {
      if (feedbackBehaviour(row) !== FEEDBACK_BEHAVIOURS.STYLING_PROMPT) continue
      const payload = safeJsonParse(row.payload, {}) || {}
      const outfit = payload.outfit || {}
      const pieces = Array.isArray(payload.pieces) && payload.pieces.length
        ? payload.pieces
        : (Array.isArray(outfit.pieces) ? outfit.pieces : [])
      const pieceText = pieces.map(p => p?.name).filter(Boolean).join(' + ')
      const formula = payload.formulaFamily || outfit.formulaFamily || ''
      const occasion = payload.occasion || outfit.bestFor || ''
      const note = row.note ? ` — ${String(row.note).slice(0, 220)}` : ''
      const line = `- ${row.feedback_type}${row.label ? ` / ${row.label}` : ''}${occasion ? ` (${occasion})` : ''}${formula ? ` | formula: ${formula}` : ''}${pieceText ? ` | pieces: ${pieceText}` : ''}${note}`
      if (NEGATIVE_WHOLE_WARDROBE_PROMPT_TYPES.has(row.feedback_type)) negatives.push(line)
    }

    const parts = []
    if (negatives.length) parts.push(`Whole-wardrobe outfit feedback to suppress. Avoid repeating these exact combinations, piece roles, formulas, or occasion mismatches:\n${negatives.slice(0, 12).join('\n')}`)
    return parts.join('\n\n')
  } catch {
    return ''
  }
}

export function saveWholeWardrobeSession({ occasion = '', outfits = [] } = {}) {
  try {
    const pieceIds = [...new Set(
      outfits
        .flatMap(outfit => {
          const ids = Array.isArray(outfit?.pieceIds) && outfit.pieceIds.length
            ? outfit.pieceIds
            : (Array.isArray(outfit?.pieces) ? outfit.pieces.map(piece => piece?.id) : [])
          return ids
        })
        .map(Number)
        .filter(Boolean)
    )]
    const formulaFamilies = [...new Set(outfits
      .map(outfit => outfit?.formulaFamily || wholeWardrobeFormulaFamily(outfit, outfit?.pieces || [], occasion))
      .filter(Boolean))]
    if (!pieceIds.length && !formulaFamilies.length) return

    db.prepare(`
      INSERT INTO whole_wardrobe_sessions (occasion, piece_ids, formula_families)
      VALUES (?, ?, ?)
    `).run(occasion || '', JSON.stringify(pieceIds), JSON.stringify(formulaFamilies))

    db.prepare(`
      DELETE FROM whole_wardrobe_sessions
      WHERE id NOT IN (
        SELECT id FROM whole_wardrobe_sessions ORDER BY id DESC LIMIT 10
      )
    `).run()
  } catch (err) {
    console.warn('saveWholeWardrobeSession failed:', err.message)
  }
}

export function getRecentWholeWardrobeSessionInfluence({ occasion = '', daysCutoff = 6 } = {}) {
  const empty = { pieceRecency: new Map(), formulaRecency: new Map(), sessionCount: 0 }
  try {
    const cutoff = Math.floor(Date.now() / 1000) - Number(daysCutoff || 6) * 86400
    const rows = db.prepare(`
      SELECT occasion, piece_ids, formula_families, created_at
      FROM whole_wardrobe_sessions
      WHERE created_at > ?
      ORDER BY created_at DESC
      LIMIT 6
    `).all(cutoff)

    const pieceRecency = new Map()
    const formulaRecency = new Map()
    const requestedOccasion = String(occasion || '').toLowerCase().trim()

    rows.forEach((row, sessionIndex) => {
      const sessionOccasion = String(row.occasion || '').toLowerCase().trim()
      const sameOccasion = requestedOccasion && sessionOccasion && requestedOccasion === sessionOccasion
      const occasionFactor = sameOccasion ? 1 : 0.55
      const decayFactor = Math.max(0.2, 1 - (sessionIndex * 0.16)) * occasionFactor
      const ids = safeJsonParse(row.piece_ids, [])
      const families = safeJsonParse(row.formula_families, [])

      for (const id of (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean)) {
        pieceRecency.set(id, (pieceRecency.get(id) || 0) + Math.round(18 * decayFactor))
      }
      for (const family of (Array.isArray(families) ? families : []).filter(Boolean)) {
        formulaRecency.set(family, (formulaRecency.get(family) || 0) + Math.round(30 * decayFactor))
      }
    })

    return { pieceRecency, formulaRecency, sessionCount: rows.length }
  } catch (err) {
    console.warn('getRecentWholeWardrobeSessionInfluence failed:', err.message)
    return empty
  }
}

export function buildPieceText(p) {
  return buildWardrobePieceTruthText(p)
}

export function pieceStyleProfile(piece = {}) {
  if (piece?.style_profile_json && typeof piece.style_profile_json === 'object') return piece.style_profile_json
  return safeJsonParse(piece?.style_profile_json, {}) || {}
}

export function normalizeStyleProfileList(value) {
  if (!value) return []
  if (Array.isArray(value)) return [...new Set(value.map(v => String(v || '').trim()).filter(Boolean))]
  return String(value)
    .split(/[\n;]+/)
    .map(v => v.trim())
    .filter(Boolean)
}

export function pieceGarmentIntelligence(piece = {}) {
  const profile = pieceStyleProfile(piece)
  const info = profile?.garment_intelligence && typeof profile.garment_intelligence === 'object'
    ? profile.garment_intelligence
    : {}
  return {
    autoUseTrust: String(info.auto_use_trust || '').trim(),
    bestOutfitRole: String(info.best_outfit_role || '').trim(),
    pairingRequirements: normalizeStyleProfileList(info.pairing_requirements),
    failureRisks: normalizeStyleProfileList(info.failure_risks),
    formulaCompatibility: normalizeStyleProfileList(info.formula_compatibility),
    doNotPairRules: normalizeStyleProfileList(info.do_not_pair_rules),
    realWearNotes: info.real_wear_notes && typeof info.real_wear_notes === 'object' ? info.real_wear_notes : {},
    occasionConfidence: info.occasion_confidence && typeof info.occasion_confidence === 'object' ? info.occasion_confidence : {}
  }
}

// Cheap, structured pre-filter for whether a composed outfit is worth the extra visual-critic
// call — not a replacement for it. Legacy garment-intelligence prose was produced by several
// tagger generations without stable provenance. Its mere presence is not executable evidence and
// must never activate a paid review or rejection path.
export function wholeWardrobeOutfitVisualReviewFindings(outfit = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const patternedPieceIds = pieces.filter(piece => {
    const complexity = String(piece.pattern_complexity || '').toLowerCase().trim()
    if (complexity === 'loud' || complexity === 'medium') return true
    if (complexity) return false
    const patternType = String(piece.pattern_type || '').toLowerCase().trim()
    return Boolean(patternType && !['solid', 'none', 'unknown'].includes(patternType))
  }).map(piece => Number(piece.id)).filter(Number.isFinite)
  if (patternedPieceIds.length < 2) return []
  return [{
    code: 'multiple_patterned_pieces',
    reason: 'two or more pieces carry a concrete pattern signal',
    pieceIds: patternedPieceIds,
    source: 'structured_piece_facts',
  }]
}

export function wholeWardrobeOutfitLooksQuestionable(outfit = {}) {
  return wholeWardrobeOutfitVisualReviewFindings(outfit).length > 0
}

export function inferWholeWardrobePieceRoles(piece = {}) {
  const profile = pieceStyleProfile(piece)
  const intelligence = pieceGarmentIntelligence(piece)
  const profileRoles = [
    ...(Array.isArray(profile.roles) ? profile.roles : []),
    ...(Array.isArray(profile.visual_roles) ? profile.visual_roles : []),
    intelligence.bestOutfitRole,
  ].filter(Boolean)
  const group = wardrobeCategoryGroup(piece)
  const text = [
    pieceNameBlob(piece),
    piece.background_color,
    piece.reads_as,
    piece.pattern_type,
    piece.pattern_complexity,
    trustedField(piece, 'silhouette') ? piece.silhouette : '',
    piece.shoe_type, piece.toe_shape,
    piece.fabric_category,
    piece.fabric_weight, piece.visual_weight,
    trustedField(piece, 'fit_on_body') ? piece.fit_on_body : '',
    piece.notes,
    ...(piece.colors || []),
    ...stylingRulesForPrompt(piece.styling_rules_learned)
  ].filter(Boolean).join(' ').toLowerCase()
  const roles = new Set(profileRoles)
  if (group === 'dress') roles.add('one_piece_column')
  if (group === 'top' && /\b(fitted|sleeveless|tank|shell|compact|structured)\b/.test(text)) roles.add('upper_anchor')
  if (group === 'top' && /\b(relaxed|oversized|loose|tunic|boxy|linen|knit)\b/.test(text)) roles.add('relaxed_upper')
  if (group === 'bottom' && /\b(black|charcoal|dark|navy|denim|jean|straight|bootcut|trouser|column)\b/.test(text)) {
    roles.add('lower_column')
    if (isDarkPiece(piece)) {
      roles.add('dark_lower_column')
    }
  }
  if (group === 'shoes') roles.add('grounding_piece')
  if (group === 'shoes' && /\b(pointed|patent|loafer|boot|mule|oxford)\b/.test(text)) roles.add('sharp_finish')
  if (['outerwear', 'bottom', 'top'].includes(group) && /\b(structured|blazer|jacket|utility|trouser|denim|crisp|architectural)\b/.test(text)) roles.add('structure_support')
  if (/\b(floral|print|graphic|stripe|striped|pattern|abstract|tapestry|bold)\b/.test(text)) roles.add('graphic_element')
  if (/\b(soft|gauzy|drape|drapey|linen|cashmere|knit|chiffon|lace|cream|ivory|oatmeal)\b/.test(text)) roles.add('soft_texture')
  if (/\b(beige|taupe|sand|cream|ivory|soft neutral|oatmeal)\b/.test(text)) roles.add('beige_sludge')
  if (group === 'shoes' && /\b(slipper|soft flat|slip-on|beach|sandal)\b/.test(text)) roles.add('soft_shoe')
  if (group === 'bottom' && /\b(wide|wide-leg|soft|gauzy|flowing|palazzo)\b/.test(text)) roles.add('wide_soft_bottom')
  return [...roles]
}

export function inferWholeWardrobeOutfitRoles(pieces = []) {
  const roles = new Set()
  for (const piece of pieces) inferWholeWardrobePieceRoles(piece).forEach(role => roles.add(role))
  const softCount = pieces.filter(p => inferWholeWardrobePieceRoles(p).includes('soft_texture')).length
  const patternCount = pieces.filter(p => inferWholeWardrobePieceRoles(p).includes('graphic_element')).length
  if (softCount >= 2) roles.add('soft_texture_stack')
  if (patternCount >= 2) roles.add('extra_pattern')
  return [...roles]
}

export function occasionBiasForArchetype(archetype, occasion) {
  const key = String(occasion || '').toLowerCase()
  return Number(archetype.occasionBias?.[key] || archetype.occasionBias?.[occasion] || 0)
}

export function occasionScoreForOutfit(pieces = [], occasion = '') {
  const key = String(occasion || '').toLowerCase()
  const text = pieces.map(pieceTextBlob).join(' ')
  let score = 0
  if (key === 'evening') {
    if (/\b(black|charcoal|dark|espresso|navy|plum|patent)\b/.test(text)) score += 10
    if (/\b(pointed|patent|loafer|boot|mule|dress)\b/.test(text)) score += 8
    if (/\b(sneaker|slipper|beach|flip|soft sandal|light casual)\b/.test(text)) score -= 14
    if (/\b(gauzy|beachy|linen short|soft slip-on)\b/.test(text)) score -= 8
  }
  if (key === 'gallery / art event') {
    if (/\b(print|graphic|stripe|abstract|tapestry|architectural|structured|utility|earthy|olive|cognac)\b/.test(text)) score += 10
    const expressiveCount = (text.match(/\b(print|graphic|stripe|abstract|tapestry|floral|pattern)\b/g) || []).length
    if (expressiveCount > 1 && !/\b(black|charcoal|solid|plain|denim|structured|pointed|loafer|boot)\b/.test(text)) score -= 12
  }
  return score
}

const ARCHETYPE_MIN_SCORE = 1

const MISSION_FOCAL_COLORS = ACCENT_COLOR_NAMES
const MISSION_NEUTRAL_COLORS = ['black', 'charcoal', 'grey', 'gray', 'navy', 'white', 'cream', 'ivory', 'beige', 'taupe', 'sand', 'oatmeal', 'espresso', 'brown', 'tan']
const MISSION_PATTERN_VALUES = ['floral', 'print', 'pattern', 'stripe', 'striped', 'abstract', 'tapestry', 'paisley', 'botanical', 'graphic', 'plaid']
const MISSION_TEXTURE_VALUES = ['crochet', 'knit', 'cashmere', 'corduroy', 'linen', 'silk', 'satin', 'leather', 'suede', 'tweed', 'velvet', 'gauzy', 'drape', 'drapey', 'textured', 'wool']
const MISSION_SOFT_VALUES = ['soft', 'gauzy', 'drape', 'drapey', 'silk', 'satin', 'cashmere', 'wool', 'linen', 'ruffle', 'cowl', 'flowing']
const MISSION_STRUCTURED_VALUES = ['structured', 'utility', 'blazer', 'jacket', 'twill', 'denim', 'leather', 'pointed', 'loafer', 'boot', 'pants', 'trousers', 'tailored']
const MISSION_SHARP_VALUES = ['pointed', 'patent', 'loafer', 'boot', 'mule', 'oxford', 'structured', 'tailored']

function structuredPieceSignalTokens(piece = {}) {
  return [
    ...(Array.isArray(piece.colors) ? piece.colors : []),
    piece.reads_as,
    piece.pattern_type,
    piece.pattern_complexity,
    piece.fabric_category,
    piece.fabric_weight,
    piece.visual_weight,
    piece.silhouette,
    piece.bottom_shape,
    piece.length_hits_at,
    piece.neckline,
    piece.sleeve_length,
    piece.sleeve_shape,
    piece.hem
  ].filter(Boolean)
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function structuredPieceHasAny(piece = {}, values = []) {
  const tokens = new Set(structuredPieceSignalTokens(piece))
  return values.some(value => tokens.has(String(value || '').toLowerCase()))
}

function structuredPieceColorTokens(piece = {}) {
  return [
    ...(Array.isArray(piece.colors) ? piece.colors : []),
    String(piece.reads_as || '')
  ].join(' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function missionColorFamilies(piece = {}) {
  const tokens = new Set(structuredPieceColorTokens(piece))
  const families = new Set()
  if (['black', 'charcoal', 'grey', 'gray'].some(c => tokens.has(c))) families.add('dark_neutral')
  if (['white', 'cream', 'ivory', 'beige', 'taupe', 'sand', 'oatmeal'].some(c => tokens.has(c))) families.add('light_neutral')
  if (['brown', 'espresso', 'tan', 'cognac', 'camel'].some(c => tokens.has(c))) families.add('earth')
  if (['blue', 'navy', 'denim'].some(c => tokens.has(c))) families.add('blue')
  if (['green', 'olive', 'emerald', 'teal'].some(c => tokens.has(c))) families.add('green')
  if (['orange', 'yellow', 'mustard', 'ochre', 'rust', 'terracotta', 'coral'].some(c => tokens.has(c))) families.add('warm')
  if (['red', 'pink', 'purple', 'lavender', 'fuchsia', 'magenta', 'violet', 'lilac', 'plum', 'burgundy'].some(c => tokens.has(c))) families.add('red_purple')
  return families
}

function isMissionNeutralPiece(piece = {}) {
  return structuredPieceHasAny(piece, MISSION_NEUTRAL_COLORS) && !pieceHasFocalColor(piece, MISSION_FOCAL_COLORS)
}

function isMissionPatternPiece(piece = {}) {
  return structuredPieceHasAny(piece, MISSION_PATTERN_VALUES) || String(piece.pattern_complexity || '').toLowerCase() === 'loud'
}

function hasLowVarianceTonalCluster(pieces = []) {
  const families = new Set()
  for (const piece of pieces) {
    for (const family of missionColorFamilies(piece)) families.add(family)
  }
  if (!families.size) return false
  if (families.size === 1) return true
  const earthyLight = families.size <= 2 && families.has('earth') && families.has('light_neutral')
  const darkOnly = families.size <= 2 && families.has('dark_neutral') && families.has('blue')
  if (earthyLight || darkOnly) return true
  if (families.has('dark_neutral') && (families.has('light_neutral') || families.has('earth') || families.has('warm'))) return false
  return false
}

export function qualifiesWholeWardrobeMission(pieces = [], missionId = '') {
  const realPieces = (pieces || []).filter(Boolean)
  if (!realPieces.length || !missionId) return false
  if (missionId === 'controlled_print') {
    const patternCount = realPieces.filter(isMissionPatternPiece).length
    return patternCount === 1
  }
  if (missionId === 'monochrome_texture') {
    const textureCount = new Set(realPieces
      .filter(piece => structuredPieceHasAny(piece, MISSION_TEXTURE_VALUES))
      .map(piece => String(piece.fabric_category || piece.reads_as || piece.silhouette || '').toLowerCase().trim())
      .filter(Boolean)
    ).size
    return hasLowVarianceTonalCluster(realPieces) && textureCount >= 2
  }
  if (missionId === 'structured_soft') {
    return realPieces.some(piece => structuredPieceHasAny(piece, MISSION_SOFT_VALUES)) &&
      realPieces.some(piece => structuredPieceHasAny(piece, MISSION_STRUCTURED_VALUES))
  }
  if (missionId === 'color_anchor') {
    const focalCount = realPieces.filter(piece => pieceHasFocalColor(piece, MISSION_FOCAL_COLORS)).length
    const supportQuiet = realPieces
      .filter(piece => !pieceHasFocalColor(piece, MISSION_FOCAL_COLORS))
      .every(piece => isMissionNeutralPiece(piece) && !isMissionPatternPiece(piece))
    return focalCount === 1 && supportQuiet
  }
  if (missionId === 'unexpected_pairing') {
    const groups = new Set(realPieces.map(wardrobeCategoryGroup).filter(Boolean))
    const hasSoftOrExpressive = realPieces.some(piece => structuredPieceHasAny(piece, [...MISSION_SOFT_VALUES, ...MISSION_PATTERN_VALUES]) || pieceHasFocalColor(piece, MISSION_FOCAL_COLORS))
    const hasSharpOrStructured = realPieces.some(piece => structuredPieceHasAny(piece, [...MISSION_STRUCTURED_VALUES, ...MISSION_SHARP_VALUES]))
    return groups.size >= 3 && hasSoftOrExpressive && hasSharpOrStructured
  }
  return false
}

export function inferOutfitArchetype(outfit, candidatePieces = [], occasion = 'casual') {
  const pieces = wholeWardrobeFullPieces(outfit, candidatePieces)
  const roles = inferWholeWardrobeOutfitRoles(pieces)
  const roleSet = new Set(roles)
  const hasRole = (role) => roleSet.has(role)
  const hasDress = pieces.some(p => wardrobeCategoryGroup(p) === 'dress')
  let best = null
  for (const archetype of WHOLE_WARDROBE_OUTFIT_ARCHETYPES) {
    if (archetype.id === 'dress_grounded_sharp' && !hasDress) continue
    if (archetype.id !== 'dress_grounded_sharp' && hasDress) continue
    let score = occasionBiasForArchetype(archetype, occasion) + occasionScoreForOutfit(pieces, occasion)
    for (const role of archetype.preferredRoles || []) if (hasRole(role)) score += 8
    for (const role of archetype.avoidRoles || []) if (hasRole(role)) score -= 12
    if (archetype.id === 'grounded_graphic_column' && hasRole('graphic_element') && hasRole('dark_lower_column') && hasRole('grounding_piece')) score += 12
    if (archetype.id === 'dress_grounded_sharp' && hasRole('one_piece_column')) score += 18
    if (archetype.id === 'relaxed_dark_base' && hasRole('relaxed_upper') && hasRole('dark_lower_column')) score += 14
    if (archetype.id === 'soft_structure_contrast' && hasRole('soft_texture') && hasRole('structure_support')) score += 12
    if (archetype.id === 'earthy_structured_minimal' && hasRole('structure_support') && !hasRole('extra_pattern')) score += 8
    if (!best || score > best.archetypeScore) best = { ...archetype, archetypeScore: score }
  }
  const bestPreferredHits = best
    ? (best.preferredRoles || []).filter(role => hasRole(role)).length
    : 0
  if (!best || best.archetypeScore < ARCHETYPE_MIN_SCORE || bestPreferredHits < 1) {
    return {
      archetypeId: null,
      formulaFamily: null,
      direction: '',
      silhouette: '',
      labelSuggestion: '',
      archetypeScore: best?.archetypeScore || 0,
      visualGoal: '',
      roles
    }
  }
  const fallback = best
  return {
    archetypeId: fallback.id,
    formulaFamily: fallback.formulaFamily,
    direction: fallback.direction,
    silhouette: fallback.silhouette,
    labelSuggestion: fallback.label,
    archetypeScore: fallback.archetypeScore || 0,
    visualGoal: fallback.visualGoal,
    roles
  }
}

export function wholeWardrobeArchetypeFor(outfit = {}, candidatePieces = [], occasion = 'casual') {
  const inferred = inferOutfitArchetype(outfit, candidatePieces, occasion)
  return WHOLE_WARDROBE_OUTFIT_ARCHETYPES.find(a => a.id === inferred.archetypeId)
    ? inferred
    : { archetypeId: null, formulaFamily: null, direction: '', silhouette: '', labelSuggestion: '', archetypeScore: inferred?.archetypeScore || 0, visualGoal: '', roles: inferred?.roles || [] }
}

export function wholeWardrobeFormulaFamily(outfit = {}, candidatePieces = [], occasion = 'casual') {
  return outfit.formulaFamily || wholeWardrobeArchetypeFor(outfit, candidatePieces, occasion).formulaFamily || wholeWardrobeFormulaType(outfit)
}

export function pieceOccasionCompatible(piece, occasion = '') {
  const normOccasion = String(occasion || '').toLowerCase().replace(/[-_]+/g, ' ').trim()
  if (!normOccasion) return true
  const pOccasions = (piece.occasions || []).map(o => String(o).toLowerCase().replace(/[-_]+/g, ' ').trim())
  if (pOccasions.length === 0) return true
  let isCompatible = pOccasions.includes(normOccasion)
  if (!isCompatible) {
    if (normOccasion === 'evening' && pOccasions.includes('smart casual')) {
      isCompatible = true
    } else if (normOccasion === 'smart casual' && (pOccasions.includes('evening') || pOccasions.includes('city'))) {
      isCompatible = true
    } else if (normOccasion === 'gallery / art event' && (pOccasions.includes('city') || pOccasions.includes('smart casual') || pOccasions.includes('evening'))) {
      isCompatible = true
    } else if (normOccasion === 'outdoor daytime social' && (pOccasions.includes('outdoor') || pOccasions.includes('city') || pOccasions.includes('smart casual'))) {
      isCompatible = true
    } else if (normOccasion === 'city' && pOccasions.includes('smart casual')) {
      isCompatible = true
    } else if (normOccasion === 'casual' && (pOccasions.includes('city') || pOccasions.includes('home') || pOccasions.includes('outdoor') || pOccasions.includes('outdoor active') || pOccasions.includes('smart casual'))) {
      isCompatible = true
    } else if (normOccasion === 'outdoor active' && (pOccasions.includes('outdoor') || pOccasions.includes('casual'))) {
      isCompatible = true
    } else if (normOccasion === 'outdoor' && (pOccasions.includes('outdoor active') || pOccasions.includes('casual'))) {
      isCompatible = true
    }
  }
  return isCompatible
}

export function piecePriorityForMission(piece, missionId, colorFamily = '', focalColor = '', moodProfile = null, weatherProfile = null, occasion = '') {
  const blob = pieceTextBlob(piece)
  const name = pieceNameBlob(piece)
  const group = wardrobeCategoryGroup(piece)
  
  let score = 0
  
  if (missionId === 'controlled_print') {
    const hasPattern = /\b(floral|print|pattern|stripe|striped|abstract|tapestry|paisley|botanical|graphic|plaid)\b/.test(name) ||
                        /\b(floral|print|pattern|stripe|striped|abstract|tapestry|paisley|botanical|graphic|plaid)\b/.test(blob)
    if (hasPattern) score += 25
    if (/\b(structured|utility|jacket|blazer|denim|trouser|leather|pointed|loafer|boot)\b/.test(blob)) score += 8
    if (/\b(slipper|soft flat|slip-on|beach|sandal)\b/.test(blob) && group === 'shoes') score -= 8
  } else if (missionId === 'monochrome_texture') {
    if (colorFamily) {
      const colors = (piece.colors || []).map(c => c.toLowerCase())
      const readsAs = String(piece.reads_as || '').toLowerCase()
      const matchingColors = colorFamily.split('/')
      const hasMatch = matchingColors.some(mc => {
        if (colors.includes(mc)) return true
        const regex = new RegExp('\\b' + mc.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'i')
        return regex.test(readsAs)
      })
      if (hasMatch) score += 20
    }
    if (/\b(crochet|knit|cashmere|corduroy|linen|silk|satin|leather|suede|tweed|velvet|gauzy|drape|textured)\b/.test(blob)) score += 15
  } else if (missionId === 'structured_soft') {
    const isSoft = /\b(soft|gauzy|drape|drapey|silk|satin|cashmere|wool knit|linen|ruffle|cowl|mock)\b/.test(blob)
    const isStructured = /\b(structured|utility|blazer|jacket|twill|denim|leather|pointed|loafer|boot|pants|trousers)\b/.test(blob)
    if (isSoft) score += 15
    if (isStructured) score += 15
  } else if (missionId === 'color_anchor') {
    const hasFocalColor = pieceHasFocalColor(piece, MISSION_FOCAL_COLORS)
    if (hasFocalColor) {
      score += 40
    } else {
      const colors = (piece.colors || []).map(c => c.toLowerCase())
      const readsAs = String(piece.reads_as || '').toLowerCase()
      const name = String(piece.name || '').toLowerCase()
      const colorsText = [...colors, readsAs, name].join(' ')
      const isNeutral = /\b(black|charcoal|grey|gray|navy|white|cream|ivory|beige|taupe|sand|oatmeal|espresso|brown)\b/.test(colorsText)
      if (isNeutral) score += 10
    }
  } else if (missionId === 'unexpected_pairing') {
    const selectionWeight = (Number(piece.id) * 7) % 31
    score += selectionWeight
    if (group === 'shoes' && /\b(pointed|patent|loafer|boot|mule|oxford)\b/.test(blob)) score += 15
  } else if (missionId === 'soft_architecture') {
    if (/\b(denim|jean|black|darkest)\b/.test(blob)) score -= 50
    if (/\b(cowl|mock|boatneck|drape|drapey|A-line|flowing|column|maxi|midi|waist|belt|tuck)\b/.test(blob)) score += 20
  } else {
    if (/\b(black|charcoal|espresso|chocolate|deep navy|navy|olive|plum|cognac|rust|mustard)\b/.test(blob)) score += 5
    if (/\b(artistic|graphic|architectural|structured|utility|linen|corduroy|textured|denim|cashmere|knit)\b/.test(blob)) score += 4
    if (/\b(pointed|loafer|boot|mule|oxford|structured)\b/.test(blob)) score += 3
    if (/\b(soft|gauzy|drape|oversized|beige|cream|ivory|taupe)\b/.test(blob)) score -= 1
    if (moodProfile?.id === 'modern_bohemian_restraint') score += bohoSignalForPiece(piece) * 5
  }

  // Weather adjustments added to piece priority — delegates to weatherFitForPiece (the single
  // graded weather-fit assessment, pieceWeatherScores) instead of recomputing fabric_weight/
  // coverage independently; this used to duplicate a slightly different, since-corrected version
  // of that same scoring.
  if (weatherProfile && (weatherProfile.isHot || weatherProfile.isCold)) {
    score += weatherFitForPiece(piece, weatherProfile).score
  }

  // Occasion adjustments added to piece priority
  if (occasion) {
    if (!pieceOccasionCompatible(piece, occasion)) {
      score -= 60
    }
  }

  return score
}

export function wholeWardrobePieceBucket(allPieces = [], options = {}) {
  const bucket = { top: [], bottom: [], dress: [], outerwear: [], shoes: [], accessory: [], other: [] }
  const moodProfile = wholeWardrobeMoodProfile(options.mood)
  const weatherProfile = options.weatherProfile || weatherProfileFromContext(options)
  for (const piece of allPieces) {
    const group = wardrobeCategoryGroup(piece)
    if (bucket[group]) bucket[group].push(piece)
    else bucket.other.push(piece)
  }
  for (const key of Object.keys(bucket)) {
    bucket[key].sort((a, b) => {
      const priorityA = piecePriorityForMission(a, options.missionId, options.colorFamily, options.focalColor, moodProfile, weatherProfile, options.occasion)
      const priorityB = piecePriorityForMission(b, options.missionId, options.colorFamily, options.focalColor, moodProfile, weatherProfile, options.occasion)
      return priorityB - priorityA || String(a.name).localeCompare(String(b.name))
    })
  }
  return bucket
}

export function getMergedProfileRules(occasionProfile, activityProfile) {
  const merged = {
    prohibited_materials: [],
    prohibited_materials_warm: [],
    prohibited_footwear: [],
    prohibited_footwear_summer: [],
    prohibited_pieces: [],
    discouraged_materials: [],
    discouraged_materials_warm: [],
    discouraged_footwear: [],
    discouraged_footwear_summer: [],
    discouraged_footwear_warm: [],
    discouraged_pieces: [],
    preferred_materials: [],
    preferred_footwear: [],
    required_footwear: []
  }

  if (occasionProfile?.rules) {
    for (const key of Object.keys(merged)) {
      if (Array.isArray(occasionProfile.rules[key])) {
        merged[key].push(...occasionProfile.rules[key])
      }
    }
  }

  if (activityProfile?.rules) {
    const activityScoringKeys = [
      'prohibited_materials',
      'prohibited_materials_warm',
      'prohibited_pieces',
      'discouraged_materials',
      'discouraged_materials_warm',
      'discouraged_pieces',
      'preferred_materials'
    ]
    for (const key of activityScoringKeys) {
      if (Array.isArray(activityProfile.rules[key])) {
        merged[key].push(...activityProfile.rules[key])
      }
    }
  }

  for (const key of Object.keys(merged)) {
    merged[key] = [...new Set(merged[key])]
  }

  return merged
}

// Shared footwear-comfort decision — one implementation consumed by both the composer roster gate
// (footwearGateReason) and profileRuleFit. Pure: returns a verdict; callers format their own labels.
export function footwearComfortVerdict(piece = {}, excludedHeels = [], excludedSupport = []) {
  const isShoe = piece.category === 'shoes' || wardrobeCategoryGroup(piece) === 'shoes'
  if (!isShoe || (!excludedHeels.length && !excludedSupport.length)) return { verdict: 'pass' }
  const heel = pieceHeelHeight(piece)
  const support = pieceWalkSupport(piece)
  if (heel === null && support === null) return { verdict: 'unknown' }
  if (heel !== null && excludedHeels.includes(heel)) return { verdict: 'exclude', dimension: 'heel', value: heel }
  if (support !== null && excludedSupport.includes(support)) return { verdict: 'exclude', dimension: 'support', value: support }
  return { verdict: 'pass' }
}

// Shared register-ceiling decision — consumed by the composer roster gate (registerGateReason) and profileRuleFit.
//
// Owner ruling 2026-07-30, from live thread_1785380251549: the beige tailored
// linen shorts are tagged `occasions: casual, smart-casual, city` and were
// still refused from a casual slot, because the casual profile's `everyday`
// ceiling outranked the owner's own tag on the garment. An explicit occasion
// tag is a direct statement about THAT piece; a profile ceiling is a default
// for pieces nobody has judged. The tag wins — the same precedent
// `pieceMatchesOccasion` already sets ("User tag overrides AI profile
// confidence").
//
// Capped at ONE register step so the exemption stays a correction, not a hole:
// across this wardrobe 52 casual-tagged pieces sit above the ceiling, and the
// two `dressy` ones (a gold print blouse, a silk floral ruffle midi) read as
// tagging noise rather than genuine casual wear. Elevated is admitted, dressy
// is not.
export function registerCeilingVerdict(piece = {}, registerCeilingRank = null, { occasion = '' } = {}) {
  if (registerCeilingRank === null || registerCeilingRank === undefined || isAccessory(piece)) return { verdict: 'pass' }
  const formality = pieceFormality(piece)
  const rank = formalityRank(formality)
  if (rank === null) return { verdict: 'unknown' }
  if (rank <= registerCeilingRank) return { verdict: 'pass' }
  const requested = String(occasion || '').toLowerCase().trim()
  if (requested &&
      explicitOccasionsForPiece(piece).includes(requested) &&
      rank <= registerCeilingRank + 1) {
    return { verdict: 'pass', exemptedByExplicitTag: true, formality }
  }
  return { verdict: 'exclude', formality }
}

export function profileRuleFit(piece = {}, mergedRules = {}, { weatherProfile = {}, occasionProfile = null, activityProfile = null, registerCeiling = null } = {}) {
  const isShoe = piece.category === 'shoes' || wardrobeCategoryGroup(piece) === 'shoes'

  const sourceFor = (key, value, warmKey = '') => {
    const occasionRules = occasionProfile?.rules || {}
    if (occasionRules[key]?.includes(value)) return 'occasion'
    if (warmKey && weatherProfile?.isHot && occasionRules[warmKey]?.includes(value)) return 'occasion'
    return 'activity'
  }

  const prohibitedMaterials = [...(mergedRules.prohibited_materials || [])]
  if (weatherProfile?.isHot && mergedRules.prohibited_materials_warm) {
    prohibitedMaterials.push(...mergedRules.prohibited_materials_warm)
  }
  for (const mat of prohibitedMaterials) {
    if (pieceMatchesMaterial(piece, mat)) {
      const source = sourceFor('prohibited_materials', mat, 'prohibited_materials_warm')
      return { tier: 'prohibited', label: 'prohibited material', reason: `${source} profile: prohibited material (${mat})` }
    }
  }

  // Structured enum gates — mode-switched: active only for callers that pass activity/register
  // context (search_wardrobe). Composer-path callers pass neither and fall through to the legacy
  // phrase-list path below, unchanged. See spec 1 (freeform gate parity).
  let unknownLabel = null
  if (isShoe && activityProfile) {
    const fw = footwearComfortVerdict(
      piece,
      activityProfile.rules?.excluded_heel_heights || [],
      activityProfile.rules?.excluded_walk_support || []
    )
    if (fw.verdict === 'exclude') {
      const label = fw.dimension === 'heel' ? `${fw.value} heel unsuitable` : `${fw.value} support unsuitable`
      return { tier: 'prohibited', label, reason: `activity profile: ${label}` }
    }
    if (fw.verdict === 'unknown') unknownLabel = 'footwear comfort not tagged'
  }
  if (registerCeiling) {
    const rv = registerCeilingVerdict(piece, formalityRank(registerCeiling), { occasion: occasionProfile?.id })
    if (rv.verdict === 'exclude') {
      return { tier: 'prohibited', label: `${rv.formality} exceeds ${registerCeiling} ceiling`, reason: `register: ${rv.formality} exceeds ${registerCeiling} ceiling` }
    }
    if (rv.verdict === 'unknown' && !unknownLabel) unknownLabel = 'formality not tagged'
  }

  if (isShoe && !activityProfile) {
    const prohibitedFootwear = [...(mergedRules.prohibited_footwear || [])]
    if (weatherProfile?.isHot && mergedRules.prohibited_footwear_summer) {
      prohibitedFootwear.push(...mergedRules.prohibited_footwear_summer)
    }
    for (const fw of prohibitedFootwear) {
      if (pieceMatchesFootwear(piece, fw)) {
        const source = sourceFor('prohibited_footwear', fw, 'prohibited_footwear_summer')
        return { tier: 'prohibited', label: 'prohibited footwear', reason: `${source} profile: prohibited footwear (${fw})` }
      }
    }
  }

  for (const item of (mergedRules.prohibited_pieces || [])) {
    if (pieceMatchesPieceName(piece, item)) {
      const source = sourceFor('prohibited_pieces', item)
      return { tier: 'prohibited', label: 'prohibited piece', reason: `${source} profile: prohibited piece (${item})` }
    }
  }

  // Untagged footwear/formality under an active enum gate — surfaced as 'unknown' (after all
  // prohibited sources, which outrank it; before discouraged, which it outranks).
  if (unknownLabel) return { tier: 'unknown', label: unknownLabel }

  const discouragedMaterials = [...(mergedRules.discouraged_materials || [])]
  if (weatherProfile?.isHot && mergedRules.discouraged_materials_warm) {
    discouragedMaterials.push(...mergedRules.discouraged_materials_warm)
  }
  for (const mat of discouragedMaterials) {
    if (pieceMatchesMaterial(piece, mat)) return { tier: 'discouraged', label: 'discouraged material' }
  }

  const discouragedFootwear = [...(mergedRules.discouraged_footwear || [])]
  if (weatherProfile?.isHot && mergedRules.discouraged_footwear_summer) {
    discouragedFootwear.push(...mergedRules.discouraged_footwear_summer)
  }
  if (weatherProfile?.isHot && mergedRules.discouraged_footwear_warm) {
    discouragedFootwear.push(...mergedRules.discouraged_footwear_warm)
  }
  if (isShoe && !activityProfile) {
    for (const fw of discouragedFootwear) {
      if (pieceMatchesFootwear(piece, fw)) return { tier: 'discouraged', label: 'discouraged footwear' }
    }
  }

  for (const item of (mergedRules.discouraged_pieces || [])) {
    if (pieceMatchesPieceName(piece, item)) return { tier: 'discouraged', label: 'discouraged piece' }
  }

  // docs/activity-and-roster-spec.md §5.4(2) — gate parity, and deliberately the LAST word.
  //
  // Placed after every prohibitive check on purpose. An earlier revision returned from here before
  // the register ceiling, and measuring the composer against a recorded live run
  // (thread_1786908644157) showed elevated/dressy pieces losing their hard suppression for a casual
  // hike: 45 register exclusions collapsed to 8. A soft signal must never pre-empt a hard gate.
  //
  // Scoped to garments the structured footwear fields cannot speak for: a shoe's fitness for a
  // trail is carried by walk_support / heel_height / shoe_type, which hold on any instance, while a
  // top's is carried only by how this particular user tagged it. The composer enforces its own
  // required-tag gate separately (applyActivityTagGate); this exists for the freeform path, and by
  // sitting here it changes ranking without changing what either path suppresses.
  //
  // DISCOURAGED, never prohibited: a hard gate would contradict the 2026-06-12 ratification keeping
  // a day dress allowed for outdoor-active, and would make the roster depend on tagging density
  // (§5.0).
  const requiredOccasionTags = (activityProfile?.rules?.required_occasion_tags || [])
    .map(value => String(value).toLowerCase().replace(/[-_]+/g, ' ').trim())
    .filter(Boolean)
  if (requiredOccasionTags.length && ['top', 'bottom', 'dress'].includes(wardrobeCategoryGroup(piece))) {
    const pieceTags = (Array.isArray(piece?.occasions) ? piece.occasions : [])
      .map(value => String(value).toLowerCase().replace(/[-_]+/g, ' ').trim())
    if (!pieceTags.some(tag => requiredOccasionTags.includes(tag))) {
      const label = `not tagged for ${activityProfile.label || activityProfile.id}`
      return { tier: 'discouraged', label, reason: `activity profile: ${label}` }
    }
  }

  for (const mat of (mergedRules.preferred_materials || [])) {
    if (pieceMatchesMaterial(piece, mat)) return { tier: 'preferred', label: 'preferred material' }
  }

  if (isShoe) {
    for (const fw of (mergedRules.preferred_footwear || [])) {
      if (pieceMatchesFootwear(piece, fw)) return { tier: 'preferred', label: 'preferred footwear' }
    }
  }

  return { tier: 'neutral', label: 'neutral' }
}

// Consolidation of the hot-weather insulation-exclusion check that used to be duplicated,
// independently, inside wholeWardrobePieceTrustDecision and buildVisualComposerRoster — the exact
// class of "parallel weather heuristic" that had already drifted between the two call sites before
// this: the roster never checked dress/neckline/sleeve coverage or applied the heavy-weight check
// to bottoms/dresses, while the trust-decision gate did both. Model consolidation, not a policy
// change — the underlying facts (fabric_weight, insulating material, coverage, neckline, sleeves)
// are read exactly once here, using the same primitives as everywhere else in this file, but WHICH
// of those facts apply to a given caller is an explicit parameter, preserving each gate's own
// pre-existing, already-audited threshold rather than forcing them onto one identical rule (that
// would be a real behavior change — a deliberate widening of the roster's exclusions — and is
// explicitly out of scope for this pass; see the commit message for the parameter-by-parameter
// audit against both gates' pre-existing test coverage).
function hotWeatherInsulationReason(piece, {
  heavyAppliesToAllCategories,       // trust-decision: true (any non-shoe/accessory category). roster: false (outerwear/top only).
  checkUpperBodyCoverageNeckSleeve,  // trust-decision only — roster never checked dress/neckline/sleeve coverage.
  checkBottomCoverage,               // both gates check this.
  openFrontExemption,                // trust-decision only — roster never exempted open-front layers.
} = {}) {
  const weight = pieceFabricWeight(piece)
  const isHeavy = weight === 'heavy'
  const isMediumOrHeavy = weight === 'medium' || weight === 'heavy'
  const hasHotInsulatingFiber = pieceHasInsulatingMaterial(piece) && weight !== 'light'
  if (hasHotInsulatingFiber) return 'hot weather: insulating fiber'

  const isShoeOrAccessoryPiece = wardrobeCategoryGroup(piece) === 'shoes' || isAccessory(piece)
  if (isHeavy && !isShoeOrAccessoryPiece && (heavyAppliesToAllCategories || isOuterwear(piece) || isTop(piece))) {
    return 'hot weather: insulating piece'
  }

  const hasInsulatingCoverage = pieceCoverage(piece) === 'full'
  if (checkUpperBodyCoverageNeckSleeve) {
    const isOpenFrontLayer = openFrontExemption && isWholeWardrobeLayerableTop(piece)
    const isUpperBodyPiece = piece.category === 'outerwear' || wardrobeCategoryGroup(piece) === 'outerwear' || piece.category === 'top' || piece.category === 'dress'
    const hasWarmNeckline = necklineWarmth(piece) === 'warm'
    const hasWarmSleeves = sleeveCoverage(piece) === 'long'
    if (isUpperBodyPiece && !isOpenFrontLayer && isMediumOrHeavy && (hasInsulatingCoverage || hasWarmNeckline || hasWarmSleeves)) {
      return 'hot weather: insulating piece'
    }
  }
  if (checkBottomCoverage && wardrobeCategoryGroup(piece) === 'bottom' && hasInsulatingCoverage && isMediumOrHeavy) {
    return 'hot weather: insulating piece'
  }
  return null
}

export function wholeWardrobePieceTrustDecision(piece = {}, options = {}) {
  const { occasion = 'casual', explorationMode = 'moderate', weatherProfile = {} } = options

  const reqOccasion = String(occasion || '').toLowerCase().replace(/[-_]+/g, ' ').trim()
  const isEvening = reqOccasion.includes('evening') || reqOccasion === 'evening social'
  if (isEvening && wardrobeCategoryGroup(piece) === 'bottom') {
    const explicitOccasions = explicitOccasionsForPiece(piece)
    const isCargoOrUtility = isUtilityOrCargoPiece(piece)
    if (!explicitOccasions.includes('evening') || isCargoOrUtility) {
      return {
        allowed: false,
        supportOnly: false,
        reasons: [`prohibited bottom for evening settings${isCargoOrUtility ? ' (utility/cargo pants)' : ''}`]
      }
    }
  }
  const exclusions = (piece.occasion_exclusions || []).map(o => String(o || '').toLowerCase().replace(/[-_]+/g, ' ').trim())
  const ownerExclusionOccasion = String(options.ownerExclusionOccasion || reqOccasion).toLowerCase().replace(/[-_]+/g, ' ').trim()
  if (exclusions.includes(ownerExclusionOccasion)) {
    const role = String(piece.role_permission || 'auto')
    const intelligence = pieceGarmentIntelligence(piece)
    const profileTrust = String(intelligence.autoUseTrust || '').toLowerCase()
    return {
      allowed: false,
      supportOnly: role === 'support_only' || profileTrust === 'support_only',
      reasons: [`user-excluded for ${ownerExclusionOccasion}`]
    }
  }

  let ownerConstraints = options.ownerConstraints
  if (!Array.isArray(ownerConstraints)) {
    try {
      ownerConstraints = db.prepare("SELECT * FROM owner_constraints WHERE status = 'active' ORDER BY id").all().map(parseOwnerConstraintRow)
    } catch { ownerConstraints = [] }
  }
  const structuredMaterials = [piece.fabric_category, ...(Array.isArray(piece.fiber_content) ? piece.fiber_content : [])]
    .map(value => String(value || '').toLowerCase().trim()).filter(Boolean)
  const ownerConstraint = ownerConstraints.find(row => ownerConstraintApplies(row, {
    id: piece.id,
    category: wardrobeCategoryGroup(piece),
    materials: structuredMaterials,
    piece,
  }, {
    occasion: ownerExclusionOccasion,
    season: options.calendarSeason || options.season,
    activity: options.activity,
    currentDate: options.currentDate,
    weather: {
      hot: Boolean(weatherProfile.isHot),
      cold: Boolean(weatherProfile.isCold),
      rainy: Boolean(weatherProfile.isRainy),
      wet_exposure: Boolean(weatherProfile.isWetExposure),
    },
  }))
  if (ownerConstraint) {
    return {
      allowed: false,
      supportOnly: false,
      reasons: [`owner constraint ${ownerConstraint.id}: prohibited for ${ownerConstraint.context_dimension} ${ownerConstraint.context_values.join(', ')}`],
    }
  }

  const occasionProfile = resolveOccasionProfile(occasion, options.mood || '')
  const activityProfile = resolveActivityProfile({
    activity: options.activity,
    occasion,
    mood: options.mood || '',
    request: options.request || options.question || ''
  })
  const mergedRules = getMergedProfileRules(occasionProfile, activityProfile)

  const checkOccasion = occasionProfile ? occasionProfile.id : occasion
  const decision = autoStylingTrustDecision(piece, { occasion: checkOccasion, explorationMode })
  const reasons = decision.reasons ? [...decision.reasons] : []

  if (weatherProfile.isHot) {
    // 2026-07-12: coverage alone (no weight qualifier) flagged a LIGHT silk summer maxi dress as
    // insulating purely because length 'maxi' derives full-insulating coverage. Weight-qualified
    // now: light full-length pieces are summer clothing. Open-front layer pieces (cardigans,
    // kimonos, overshirts) are exempt from the coverage/neckline/sleeve clauses (ratified by Yuna
    // 2026-07-12 after summer layering requests kept dying on knit cardigans) but remain subject
    // to the heavy-weight and insulating-fiber checks. 2026-07-12 also corrected the bottom check
    // to authored full-insulating coverage only, not ANY medium-weight pants (that false-positived
    // normal cotton/linen cargos/chinos/cropped pants).
    const reason = hotWeatherInsulationReason(piece, {
      heavyAppliesToAllCategories: true,
      checkUpperBodyCoverageNeckSleeve: true,
      checkBottomCoverage: true,
      openFrontExemption: true,
    })
    if (reason) reasons.push(reason)
  }

  if (weatherProfile.isCold) {
    if (bottomKind(piece) === 'shorts') {
      reasons.push('cold weather: shorts')
    } else if (isLightweightLinenBottom(piece)) {
      reasons.push('cold weather: lightweight linen bottom')
    }
    const isBareBodyPiece = ['top', 'dress', 'bottom', 'outerwear'].includes(wardrobeCategoryGroup(piece))
    if (isBareBodyPiece && pieceBareness(piece) === 'high') {
      reasons.push('cold weather: bare/sleeveless')
    }
  }

  if (weatherProfile.isWetExposure && pieceHasWetSensitiveFootwearMaterial(piece)) {
    reasons.push('wet exposure: absorbent footwear material')
  }

  // Spec 8: register-ceiling and footwear-enum awareness are unconditional here, matching the two
  // other fully-gated composition paths (search_wardrobe, buildVisualComposerRoster) that already
  // call the same underlying verdict helpers. Previously this was opt-in per caller (spec 5's
  // registerCeiling-only opt-in, and activityProfile was never passed at all) — that left every
  // caller of this function exposed to the exact gate-parity bug class specs 5/7 kept finding one
  // call site at a time. See spec 8 for the full caller inventory and the register-ceiling rollout.
  const registerCeiling = options.registerCeiling !== undefined
    ? options.registerCeiling
    : resolveRegisterCeiling({
        occasion,
        activity: options.activity,
        mood: options.mood || '',
        request: options.request || options.question || '',
        occasionProfile,
        activityProfile
      })

  const profileFit = profileRuleFit(piece, mergedRules, { weatherProfile, occasionProfile, activityProfile, registerCeiling })
  if (profileFit.tier === 'prohibited') {
    reasons.push(profileFit.reason)
  }

  return {
    ...decision,
    allowed: reasons.length === 0,
    reasons
  }
}

// Slice 7 (2026-08-25): filterWholeWardrobePiecesForGeneration was a compatibility projection
// over evaluateAutomaticUsePiecePool and had no production consumers. It was removed so tests and
// diagnostics cannot accidentally establish the retired response shape as a second eligibility API.

export function buildVisualComposerRoster(allowedPieces = [], {
  occasion = 'casual',
  weatherProfile = {},          // from weatherProfileFromContext({ mood, season })
  sessionInfluence = null,      // existing recency map, optional
  maxImages = 90,                // hard ceiling, below Claude's 100-image limit
  selectedPieceId = null,
  includeAccessories = false,
  mood = '',
  activity = '',
  request = '',
  question = '',
  occasionProfile = null,
  activityProfile = null,
  recordMetadataTodos = true
} = {}) {
  const roster = []
  const excluded = []
  const capCutReasons = new Set(['roster cap: category limit', 'roster cap: global limit'])
  const scoreCache = new Map()
  const resolvedOccasionProfile = occasionProfile || resolveOccasionProfile(occasion, mood)
  const resolvedActivityProfile = (activity && activity !== 'none')
    ? (activityProfile || resolveActivityProfile({ activity }))
    : null
  const formalityIntent = resolveFormalityIntent({
    occasion,
    mood,
    activity,
    request,
    question,
    activityProfile: resolvedActivityProfile
  })
  const registerCeiling = resolveRegisterCeiling({
    occasion,
    mood,
    activity,
    request,
    question,
    occasionProfile: resolvedOccasionProfile,
    activityProfile: resolvedActivityProfile,
    formalityIntent
  })
  const registerCeilingRank = formalityRank(registerCeiling)
  const telemetryActivityProfile = resolvedActivityProfile || resolveActivityProfile({ occasion, request: request || question })
  const debug = {
    excludedCounts: {},
    categoryCounts: {},
    postGatePoolSize: 0,
    capApplied: false,
    capCutPieces: [],
    slotCoverage: { top: 0, bottom: 0, dress: 0, shoes: 0, outerwear: 0, accessory: 0 },
    activityCoverageGaps: [],
    activityTagEnforcedGroups: [],
    registerTarget: null,
    registerTargetCoverageGaps: [],
    registerTargetEnforcedGroups: [],
    registerCeiling,
    formalityIntent: {
      target: formalityIntent.target,
      avoid: [...(formalityIntent.avoid || [])],
      walkable: formalityIntent.walkable,
      active: formalityIntent.active
    },
    resolvedActivity: telemetryActivityProfile?.id || 'none',
    activitySource: (activity && activity !== 'none') ? 'dropdown' : (telemetryActivityProfile ? 'inferred' : 'none'),
    walkable: formalityIntent.walkable
  }

  const exclude = (piece, reason) => {
    excluded.push({
      pieceId: piece.id,
      name: piece.name,
      reason
    })
    debug.excludedCounts[reason] = (debug.excludedCounts[reason] || 0) + 1
  }

  const ensureMetadataTodo = (piece, field, gate = 'weather') => {
    if (!recordMetadataTodos) return
    const description = `${piece.name || `Piece ${piece.id}`}: missing ${field} — retag to restore ${gate}-gated visibility`
    try {
      const linkedPiece = db.prepare('SELECT id FROM pieces WHERE id = ?').get(piece.id)
      if (!linkedPiece) return
      const existing = db.prepare(`
        SELECT id FROM todos
        WHERE completed = 0
          AND linked_piece_id = ?
          AND description LIKE ?
        LIMIT 1
      `).get(piece.id, `%missing ${field}%`)
      if (!existing) {
        db.prepare('INSERT INTO todos (type, description, linked_piece_id, field) VALUES (?, ?, ?, ?)').run('metadata', description, piece.id, field)
      }
    } catch (err) {
      console.warn('Failed to create metadata todo:', err.message)
    }
  }

  const missingWeatherGateField = (piece) => {
    if (!isHot && !isCold) return null
    const group = wardrobeCategoryGroup(piece)
    if (isAccessory(piece) || group === 'shoes') return null
    const needsFabricWeight = group === 'top' || group === 'outerwear' || group === 'dress' || group === 'bottom'
    if (needsFabricWeight && pieceFabricWeight(piece) === null) return 'fabric_weight'
    // "Is this bottom warm enough" is a cold-weather-only question — hot weather doesn't care whether
    // a medium/heavy-fabric short or skirt has full leg coverage. Pants are inherently full-leg
    // coverage regardless of length_hits_at tagging (that field is for hemlines like skirts/dresses,
    // not pant length) — bottomKind already distinguishes pants from shorts/skirts from a concrete
    // authored field, so only ambiguous/skirt bottoms need the pieceCoverage() derivation.
    const needsCoverage = isCold && group === 'bottom' && bottomKind(piece) !== 'pants' && (pieceFabricWeight(piece) === 'medium' || pieceFabricWeight(piece) === 'heavy')
    if (needsCoverage && pieceCoverage(piece) === null) return 'length_hits_at'
    const fibers = Array.isArray(piece?.fiber_content) ? piece.fiber_content : []
    const fabricCategory = String(piece?.fabric_category || '').toLowerCase().trim()
    const insulatingCategories = new Set(['wool', 'cashmere', 'fleece', 'down', 'mohair', 'alpaca'])
    if (isHot && fibers.length === 0 && insulatingCategories.has(fabricCategory)) return 'fiber_content'
    return null
  }

  const registerGateReason = (piece) => {
    const rv = registerCeilingVerdict(piece, registerCeilingRank, { occasion: resolvedOccasionProfile?.id })
    if (rv.verdict === 'unknown') return 'metadata missing: formality (register gate active)'
    if (rv.verdict === 'exclude') return `register: ${rv.formality} exceeds ${registerCeiling} ceiling`
    return null
  }
  const explicitTargetRank = formalityIntent.targetRank
  const profileTarget = resolvedOccasionProfile?.register_target || ''
  const profileTargetRank = formalityRank(profileTarget)
  const registerTarget = explicitTargetRank !== null
    ? formalityIntent.target
    : (profileTargetRank !== null ? profileTarget : null)
  const registerTargetRank = formalityRank(registerTarget)
  debug.registerTarget = registerTarget
  const registerTargetGroup = piece => {
    const group = wardrobeCategoryGroup(piece)
    if (group === 'top' || group === 'dress') return 'top'
    if (group === 'bottom') return 'bottom'
    if (group === 'shoes') return 'shoes'
    return null
  }
  const pieceMeetsRegisterTarget = piece => {
    const rank = formalityRank(pieceFormality(piece))
    if (rank === null || registerTargetRank === null) return false
    if (resolvedActivityProfile?.id === 'walking' && registerTargetGroup(piece) === 'shoes') {
      return rank >= formalityRank('everyday')
    }
    return rank >= registerTargetRank
  }
  const registerTargetReason = piece => {
    if (!registerTarget || registerTargetRank === null) return null
    const group = registerTargetGroup(piece)
    if (!group || !debug.registerTargetEnforcedGroups.includes(group)) return null
    const formality = pieceFormality(piece)
    const rank = formalityRank(formality)
    if (rank === null) return 'metadata missing: formality (register target active)'
    if (resolvedActivityProfile?.id === 'walking' && group === 'shoes') {
      if (rank < formalityRank('everyday')) return `register: ${formality} below polished walking target`
      const discouragedFootwear = resolvedOccasionProfile?.rules?.discouraged_footwear || []
      const discouragedMatch = discouragedFootwear.find(term => pieceMatchesFootwear(piece, term))
      if (discouragedMatch) return `footwear: ${discouragedMatch} unsuitable for polished walking target`
      return null
    }
    if (rank < registerTargetRank) return `register: ${formality} below ${registerTarget} target`
    return null
  }
  const applyRegisterTargetGate = pieces => {
    if (!registerTarget || registerTargetRank === null) return pieces
    const minimums = { top: 4, bottom: 3, shoes: 2 }
    const counts = { top: 0, bottom: 0, shoes: 0 }
    for (const piece of pieces) {
      if (isSelected(piece) || isAccessory(piece)) continue
      const group = registerTargetGroup(piece)
      if (!group) continue
      if (pieceMeetsRegisterTarget(piece)) counts[group] += 1
    }
    debug.registerTargetCoverageGaps = Object.keys(minimums).filter(group => counts[group] < minimums[group])
    debug.registerTargetEnforcedGroups = Object.keys(minimums).filter(group => counts[group] >= minimums[group])
    const filtered = []
    for (const piece of pieces) {
      const reason = registerTargetReason(piece)
      if (reason) {
        exclude(piece, reason)
        if (reason.startsWith('metadata missing: formality')) ensureMetadataTodo(piece, 'formality', 'register')
      } else {
        filtered.push(piece)
      }
    }
    return filtered
  }

  const footwearGateReason = (piece) => {
    const rules = resolvedActivityProfile?.rules
    if (!rules) return null
    const fw = footwearComfortVerdict(piece, rules.excluded_heel_heights || [], rules.excluded_walk_support || [])
    if (fw.verdict === 'unknown') return 'metadata missing: footwear comfort (activity gate active)'
    if (fw.verdict === 'exclude') {
      return fw.dimension === 'heel'
        ? `footwear: ${fw.value} heel unsuitable for ${resolvedActivityProfile.label}`
        : `footwear: ${fw.value} support unsuitable for ${resolvedActivityProfile.label}`
    }
    return null
  }

  const normalizeOccasionTag = value => String(value || '').toLowerCase().replace(/[-_]+/g, ' ').trim()
  const activityRequiredTags = (resolvedActivityProfile?.rules?.required_occasion_tags || [])
    .map(normalizeOccasionTag)
    .filter(Boolean)
  const activityTagGroup = piece => {
    const group = wardrobeCategoryGroup(piece)
    if (group === 'top' || group === 'dress') return 'top'
    if (group === 'bottom') return 'bottom'
    if (group === 'shoes') return 'shoes'
    return null
  }
  const pieceHasActivityTag = piece => {
    const tags = Array.isArray(piece?.occasions) ? piece.occasions.map(normalizeOccasionTag).filter(Boolean) : []
    return tags.some(tag => activityRequiredTags.includes(tag))
  }
  const activityTagReason = piece => {
    if (!activityRequiredTags.length) return null
    if (isAccessory(piece)) return null
    const group = activityTagGroup(piece)
    if (!group || !debug.activityTagEnforcedGroups.includes(group)) return null
    if (pieceHasActivityTag(piece)) return null
    return `activity: not tagged for ${resolvedActivityProfile.label}`
  }
  const applyActivityTagGate = pieces => {
    if (!activityRequiredTags.length) return pieces
    const minimums = { top: 3, bottom: 3, shoes: 2 }
    const counts = { top: 0, bottom: 0, shoes: 0 }
    for (const piece of pieces) {
      if (isSelected(piece) || isAccessory(piece)) continue
      const group = activityTagGroup(piece)
      if (!group) continue
      if (pieceHasActivityTag(piece)) counts[group] += 1
    }
    debug.activityCoverageGaps = Object.keys(minimums).filter(group => counts[group] < minimums[group])
    debug.activityTagEnforcedGroups = Object.keys(minimums).filter(group => counts[group] >= minimums[group])
    const filtered = []
    for (const piece of pieces) {
      const reason = activityTagReason(piece)
      if (reason) {
        exclude(piece, reason)
      } else {
        filtered.push(piece)
      }
    }
    return filtered
  }

  const isSelected = (p) => {
    if (selectedPieceId && Number(p.id) === Number(selectedPieceId)) return true
    if (p.selected || p.isAnchor) return true
    return false
  }

  // Pre-load confirmed outfits and stylist feedback maps to optimize Step 4 queries
  const confirmedCounts = new Map()
  try {
    const rows = db.prepare(`
      SELECT op.piece_id, COUNT(*) as cnt
      FROM outfit_pieces op
      JOIN outfits o ON op.outfit_id = o.id
      GROUP BY op.piece_id
    `).all()
    for (const r of rows) {
      confirmedCounts.set(Number(r.piece_id), { count: r.cnt })
    }
  } catch (err) {
    console.warn('Failed to query confirmed outfits count:', err.message)
  }

  // Step 1 — No photo
  const afterStep1 = []
  for (const p of allowedPieces) {
    if (isSelected(p)) {
      afterStep1.push(p)
    } else if (!p.photo && !p.worn_photo) {
      exclude(p, 'no photo')
    } else {
      afterStep1.push(p)
    }
  }

  // Step 2 — Category gate
  const afterStep2 = []
  for (const p of afterStep1) {
    if (isSelected(p)) {
      afterStep2.push(p)
    } else if (!includeAccessories && isAccessory(p)) {
      exclude(p, 'accessories excluded from visual composer')
    } else {
      afterStep2.push(p)
    }
  }

  // Step 3 — Weather/register validity gate
  const afterStep3 = []
  const isHot = weatherProfile && weatherProfile.isHot
  const isCold = weatherProfile && weatherProfile.isCold

  if (isHot) {
    const outerwearCandidates = []
    for (const p of afterStep2) {
      const missingField = missingWeatherGateField(p)
      const registerReason = registerGateReason(p)
      const footwearReason = footwearGateReason(p)
      // Roster policy, preserved as-is (see hotWeatherInsulationReason's own comment): unlike
      // wholeWardrobePieceTrustDecision, the roster's heavy-weight check has never applied outside
      // outerwear/top, and it has never checked dress/neckline/sleeve coverage or exempted
      // open-front layers — narrower on purpose here, not a bug to widen in this pass.
      const insulationReason = hotWeatherInsulationReason(p, {
        heavyAppliesToAllCategories: false,
        checkUpperBodyCoverageNeckSleeve: false,
        checkBottomCoverage: true,
        openFrontExemption: false,
      })
      if (isSelected(p)) {
        afterStep3.push(p)
      } else if (registerReason) {
        exclude(p, registerReason)
        if (registerReason.startsWith('metadata missing: formality')) ensureMetadataTodo(p, 'formality', 'register')
      } else if (footwearReason) {
        exclude(p, footwearReason)
        if (footwearReason.startsWith('metadata missing: footwear comfort')) ensureMetadataTodo(p, 'footwear-comfort', 'activity')
      } else if (missingField) {
        const reason = `metadata missing: ${missingField} (weather gate active)`
        exclude(p, reason)
        ensureMetadataTodo(p, missingField)
      } else if (insulationReason) {
        exclude(p, insulationReason)
      } else if (isOuterwear(p)) {
        outerwearCandidates.push(p)
      } else {
        afterStep3.push(p)
      }
    }

    // Cap outerwear to the 3 lightest pieces
    if (outerwearCandidates.length > 3) {
      const weightValues = { 'light': 1, 'medium': 2, 'heavy': 3 }
      outerwearCandidates.sort((a, b) => {
        const wa = weightValues[fabricWeight(a)] || 2
        const wb = weightValues[fabricWeight(b)] || 2
        if (wa !== wb) return wa - wb
        return Number(a.id) - Number(b.id) // stable tie-breaker by piece ID
      })

      for (let i = 0; i < outerwearCandidates.length; i++) {
        const p = outerwearCandidates[i]
        if (i < 3) {
          afterStep3.push(p)
        } else {
          exclude(p, 'hot weather: outerwear cap')
        }
      }
    } else {
      afterStep3.push(...outerwearCandidates)
    }
  } else if (isCold) {
    for (const p of afterStep2) {
      const missingField = missingWeatherGateField(p)
      const registerReason = registerGateReason(p)
      const footwearReason = footwearGateReason(p)
      if (isSelected(p)) {
        afterStep3.push(p)
      } else if (registerReason) {
        exclude(p, registerReason)
        if (registerReason.startsWith('metadata missing: formality')) ensureMetadataTodo(p, 'formality', 'register')
      } else if (footwearReason) {
        exclude(p, footwearReason)
        if (footwearReason.startsWith('metadata missing: footwear comfort')) ensureMetadataTodo(p, 'footwear-comfort', 'activity')
      } else if (missingField) {
        const reason = `metadata missing: ${missingField} (weather gate active)`
        exclude(p, reason)
        ensureMetadataTodo(p, missingField)
      } else if (bottomKind(p) === 'shorts') {
        exclude(p, 'cold weather: shorts')
      } else if (isLightweightLinenBottom(p)) {
        exclude(p, 'cold weather: lightweight linen bottom')
      } else if (['top', 'dress', 'bottom', 'outerwear'].includes(wardrobeCategoryGroup(p)) && pieceBareness(p) === 'high') {
        exclude(p, 'cold weather: bare/sleeveless')
      } else {
        afterStep3.push(p)
      }
    }
  } else {
    for (const p of afterStep2) {
      const registerReason = registerGateReason(p)
      const footwearReason = footwearGateReason(p)
      if (isSelected(p)) {
        afterStep3.push(p)
      } else if (registerReason) {
        exclude(p, registerReason)
        if (registerReason.startsWith('metadata missing: formality')) ensureMetadataTodo(p, 'formality', 'register')
      } else if (footwearReason) {
        exclude(p, footwearReason)
        if (footwearReason.startsWith('metadata missing: footwear comfort')) ensureMetadataTodo(p, 'footwear-comfort', 'activity')
      } else {
        afterStep3.push(p)
      }
    }
  }
  const afterRegisterTargetGate = applyRegisterTargetGate(afterStep3)
  const afterActivityGate = applyActivityTagGate(afterRegisterTargetGate)
  debug.postGatePoolSize = afterActivityGate.length
  debug.capApplied = afterActivityGate.length > maxImages

  // Step 4 — Image budget cap
  let afterStep4 = []
  if (afterActivityGate.length > maxImages) {
    const defaultCeilings = {
      top: 30,
      bottom: 25,
      shoes: 15,
      dress: 10,
      outerwear: 8,
      other: 5
    }
    const sumCeilings = Object.values(defaultCeilings).reduce((a, b) => a + b, 0)
    const ceilings = { ...defaultCeilings }
    if (sumCeilings > maxImages) {
      const factor = maxImages / sumCeilings
      for (const cat of Object.keys(ceilings)) {
        ceilings[cat] = Math.floor(defaultCeilings[cat] * factor)
      }
    }

    // Group surviving pieces by category
    const byCategory = {
      top: [],
      bottom: [],
      shoes: [],
      dress: [],
      outerwear: [],
      other: []
    }

    for (const p of afterActivityGate) {
      const group = wardrobeCategoryGroup(p)
      if (byCategory[group]) {
        byCategory[group].push(p)
      } else {
        byCategory.other.push(p)
      }
    }

    // Sort and limit per category
    for (const cat of Object.keys(byCategory)) {
      const pieces = byCategory[cat]
      const limit = ceilings[cat]

      // Sort by relevance score descending, stably by recency and piece ID ascending
      pieces.sort((a, b) => comparePieces(a, b))

      let categoryKeptCount = 0
      for (const p of pieces) {
        if (isSelected(p)) {
          afterStep4.push(p)
          categoryKeptCount++
        } else if (categoryKeptCount < limit) {
          afterStep4.push(p)
          categoryKeptCount++
        } else {
          exclude(p, 'roster cap: category limit')
        }
      }
    }
  } else {
    afterStep4.push(...afterActivityGate)
  }

  function pushAdjustmentReason(pieceId, reason) {
    if (!debug.relevanceAdjustments) {
      debug.relevanceAdjustments = {}
    }
    if (!debug.relevanceAdjustments[pieceId]) {
      debug.relevanceAdjustments[pieceId] = []
    }
    debug.relevanceAdjustments[pieceId].push(reason)
  }

  function getRelevanceScore(p) {
    const cacheKey = Number(p.id)
    if (scoreCache.has(cacheKey)) return scoreCache.get(cacheKey)
    const occasionScore = pieceOccasionScore(p, occasion)
    const conf = confirmedCounts.get(Number(p.id)) || { count: 0 }
    let historyBonus = conf.count * 8
    if (historyBonus > 24) {
      historyBonus = 24
      pushAdjustmentReason(p.id, 'history bonus capped')
    }
    const recencyPenalty = sessionInfluence && sessionInfluence.pieceRecency
      ? (sessionInfluence.pieceRecency.get(Number(p.id)) || 0)
      : 0
      
    let weatherBonus = 0
    if (weatherProfile && weatherProfile.isHot) {
      const isLight = fabricWeight(p) === 'light'
      const isHeavy = fabricWeight(p) === 'heavy'
      const isShorts = bottomKind(p) === 'shorts'

      if (isLight) {
        weatherBonus += 10
        pushAdjustmentReason(p.id, 'hot weather: lightweight fabric (+10)')
      }
      if (isShorts) {
        weatherBonus += 8
        pushAdjustmentReason(p.id, 'hot weather: shorts (+8)')
      }
      if (isHeavy) {
        weatherBonus -= 10
        pushAdjustmentReason(p.id, 'hot weather: heavy fabric (-10)')
      }
    } else if (weatherProfile && weatherProfile.isCold) {
      const isLight = fabricWeight(p) === 'light'
      const isHeavy = fabricWeight(p) === 'heavy'

      if (isLight) {
        const catGroup = wardrobeCategoryGroup(p)
        if (catGroup === 'bottom' || catGroup === 'dress') {
          weatherBonus -= 10
          pushAdjustmentReason(p.id, 'cold weather: lightweight fabric (-10)')
        }
      }
      if (isHeavy) {
        weatherBonus += 10
        pushAdjustmentReason(p.id, 'cold weather: heavy fabric (+10)')
      }
    }

    let occasionProfileBonus = 0
    const mergedRules = getMergedProfileRules(resolvedOccasionProfile, resolvedActivityProfile)

    const preferredMaterials = mergedRules.preferred_materials || []
    const preferredFootwear = mergedRules.preferred_footwear || []
    const discouragedMaterials = mergedRules.discouraged_materials ? [...mergedRules.discouraged_materials] : []
    if (weatherProfile && weatherProfile.isHot && mergedRules.discouraged_materials_warm) {
      discouragedMaterials.push(...mergedRules.discouraged_materials_warm)
    }
    const discouragedFootwear = mergedRules.discouraged_footwear ? [...mergedRules.discouraged_footwear] : []
    if (weatherProfile && weatherProfile.isHot && mergedRules.discouraged_footwear_summer) {
      discouragedFootwear.push(...mergedRules.discouraged_footwear_summer)
    }
    if (weatherProfile && weatherProfile.isHot && mergedRules.discouraged_footwear_warm) {
      discouragedFootwear.push(...mergedRules.discouraged_footwear_warm)
    }
    const discouragedPieces = mergedRules.discouraged_pieces || []

    // Preferred materials boost
    for (const mat of preferredMaterials) {
      if (pieceMatchesMaterial(p, mat)) {
        const source = resolvedOccasionProfile?.rules?.preferred_materials?.includes(mat) ? 'occasion' : 'activity'
        occasionProfileBonus += 8
        pushAdjustmentReason(p.id, `${source} profile: preferred material (${mat}) (+8)`)
        break
      }
    }

    // Preferred footwear boost
    if (p.category === 'shoes' || wardrobeCategoryGroup(p) === 'shoes') {
      for (const fw of preferredFootwear) {
        if (pieceMatchesFootwear(p, fw)) {
          const source = resolvedOccasionProfile?.rules?.preferred_footwear?.includes(fw) ? 'occasion' : 'activity'
          occasionProfileBonus += 10
          pushAdjustmentReason(p.id, `${source} profile: preferred footwear (${fw}) (+10)`)
          break
        }
      }
    }

    // Discouraged materials penalty
    for (const mat of discouragedMaterials) {
      if (pieceMatchesMaterial(p, mat)) {
        const source = resolvedOccasionProfile?.rules?.discouraged_materials?.includes(mat) || (weatherProfile && weatherProfile.isHot && resolvedOccasionProfile?.rules?.discouraged_materials_warm?.includes(mat)) ? 'occasion' : 'activity'
        occasionProfileBonus -= 8
        pushAdjustmentReason(p.id, `${source} profile: discouraged material (${mat}) (-8)`)
        break
      }
    }

    // Discouraged footwear penalty
    if (p.category === 'shoes' || wardrobeCategoryGroup(p) === 'shoes') {
      for (const fw of discouragedFootwear) {
        if (pieceMatchesFootwear(p, fw)) {
          const source = resolvedOccasionProfile?.rules?.discouraged_footwear?.includes(fw) || 
                         (weatherProfile && weatherProfile.isHot && resolvedOccasionProfile?.rules?.discouraged_footwear_summer?.includes(fw)) ||
                         (weatherProfile && weatherProfile.isHot && resolvedOccasionProfile?.rules?.discouraged_footwear_warm?.includes(fw)) 
                         ? 'occasion' : 'activity'
          occasionProfileBonus -= 10
          pushAdjustmentReason(p.id, `${source} profile: discouraged footwear (${fw}) (-10)`)
          break
        }
      }
    }

    // Discouraged pieces penalty
    for (const item of discouragedPieces) {
      if (pieceMatchesPieceName(p, item)) {
        const source = resolvedOccasionProfile?.rules?.discouraged_pieces?.includes(item) ? 'occasion' : 'activity'
        occasionProfileBonus -= 10
        pushAdjustmentReason(p.id, `${source} profile: discouraged piece (${item}) (-10)`)
        break
      }
    }
    
    const formalityFit = formalityFitForPiece(p, { occasion, mood, activity, request, question, formalityIntent })
    for (const adjustment of formalityFit.adjustments) {
      const sign = adjustment.score >= 0 ? '+' : ''
      pushAdjustmentReason(p.id, `${adjustment.reason} (${sign}${adjustment.score})`)
    }

    const score = occasionScore + historyBonus - recencyPenalty + weatherBonus + occasionProfileBonus + formalityFit.score
    scoreCache.set(cacheKey, score)
    return score
  }

  function comparePieces(a, b) {
    const ra = getRelevanceScore(a)
    const rb = getRelevanceScore(b)
    if (ra !== rb) return rb - ra

    // Tie-breaker 1: less-recently-shown first
    const recencyA = sessionInfluence && sessionInfluence.pieceRecency
      ? (sessionInfluence.pieceRecency.get(Number(a.id)) || 0)
      : 0
    const recencyB = sessionInfluence && sessionInfluence.pieceRecency
      ? (sessionInfluence.pieceRecency.get(Number(b.id)) || 0)
      : 0
    if (recencyA !== recencyB) return recencyA - recencyB

    // Tie-breaker 2: piece ID ascending (final fallback)
    return Number(a.id) - Number(b.id)
  }

  // Step 5 — Final guard
  if (afterStep4.length > maxImages) {
    // Sort globally by relevance descending, stably by recency and piece ID ascending
    afterStep4.sort((a, b) => comparePieces(a, b))

    console.warn(`[buildVisualComposerRoster] Roster count (${afterStep4.length}) exceeds maxImages (${maxImages}) even after category limits. Trimming globally.`)

    let finalKeptCount = 0
    for (const p of afterStep4) {
      if (isSelected(p)) {
        roster.push(p)
        finalKeptCount++
      } else if (finalKeptCount < maxImages) {
        roster.push(p)
        finalKeptCount++
      } else {
        exclude(p, 'roster cap: global limit')
      }
    }
  } else {
    roster.push(...afterStep4)
  }

  const protectedRosterPieces = afterActivityGate.filter(isSelected)
  const coverageRequirements = protectedRosterPieces.length
    ? protectedRosterPieces.map(anchorPiece => completeOutfitSupplyRequirement({
        anchorPiece,
        id: `visual_anchor_${Number(anchorPiece.id)}_outfit_path`,
      }))
    : [completeOutfitSupplyRequirement({ id: 'visual_roster_outfit_path' })]
  const coveredRoster = buildCoveredCandidateSet({
    rankedPieces: [...afterActivityGate].sort((a, b) => comparePieces(a, b)),
    initialSelection: roster,
    capacity: maxImages,
    protectedPieceIds: protectedRosterPieces.map(piece => Number(piece.id)),
    requirements: coverageRequirements,
  })
  const originalRosterIds = new Set(roster.map(piece => Number(piece.id)))
  const coveredRosterIds = new Set(coveredRoster.pieces.map(piece => Number(piece.id)))
  const rosterChanged = originalRosterIds.size !== coveredRosterIds.size ||
    [...originalRosterIds].some(id => !coveredRosterIds.has(id))
  if (rosterChanged) {
    const addedIds = new Set([...coveredRosterIds].filter(id => !originalRosterIds.has(id)))
    const finalIds = new Set(coveredRoster.pieces.map(piece => Number(piece.id)))
    for (let index = excluded.length - 1; index >= 0; index -= 1) {
      const item = excluded[index]
      if (!addedIds.has(Number(item.pieceId)) || !capCutReasons.has(item.reason)) continue
      excluded.splice(index, 1)
      debug.excludedCounts[item.reason] = Math.max(0, (debug.excludedCounts[item.reason] || 0) - 1)
    }
    for (const piece of roster) {
      if (finalIds.has(Number(piece.id))) continue
      if (!excluded.some(item => Number(item.pieceId) === Number(piece.id) && capCutReasons.has(item.reason))) {
        exclude(piece, 'roster cap: global limit')
      }
    }
    roster.splice(0, roster.length, ...coveredRoster.pieces)
  }
  debug.coverageReport = coveredRoster.report
  debug.structureCoverageGaps = coveredRoster.report.shortfalls.map(shortfall => shortfall.code)

  // Populate debug category counts
  for (const p of roster) {
    const group = wardrobeCategoryGroup(p)
    debug.categoryCounts[group] = (debug.categoryCounts[group] || 0) + 1
    const slot = Object.prototype.hasOwnProperty.call(debug.slotCoverage, group) ? group : 'accessory'
    debug.slotCoverage[slot] += 1
  }
  const pieceById = new Map(allowedPieces.map(p => [Number(p.id), p]))
  debug.capCutPieces = excluded
    .filter(item => capCutReasons.has(item.reason))
    .map(item => {
      const piece = pieceById.get(Number(item.pieceId)) || item
      const score = getRelevanceScore(piece)
      const topReasons = (debug.relevanceAdjustments?.[item.pieceId] || [])
        .filter(Boolean)
        .slice(0, 3)
      return {
        id: Number(item.pieceId),
        name: item.name,
        score,
        topReasons: topReasons.length ? topReasons : [item.reason],
        reason: item.reason
      }
    })

  return { roster, excluded, debug }
}

export function wholeWardrobeMoodProfile(mood = '') {
  const text = String(mood || '').toLowerCase()
  if (/\b(boho|bohemian)\b/.test(text)) {
    return {
      id: 'modern_bohemian_restraint',
      label: 'modern bohemian restraint',
      guidance: [
        'Translate "boho" as modern bohemian restraint for this wardrobe: earthy/artisan texture, relaxed movement, woven/crochet/linen/botanical/paisley/denim/cognac/olive/rust notes, with city-appropriate grounding.',
        'Bohemian is not a negative lane. Do not collapse it into festival costume, excessive layers, delicate romantic softness, or generic hippie styling.',
        'Do not answer boho with plain all-black tailored minimalism unless another garment carries clear bohemian texture, print, movement, or warm artisan detail.',
        'Each returned boho outfit still needs a readable visual thesis: the bohemian element should be the hero or a clear support texture, and the other garments should stabilize it.'
      ].join(' ')
    }
  }
  return null
}

export function bohoTraitForPiece(piece = {}) {
  const text = pieceTextBlob(piece)
  if (/\b(crochet|woven|raffia|rattan|cork|espadrille|basket|braided)\b/.test(text)) return 'woven texture'
  if (/\b(embroidered|embroidery|artisan|handmade)\b/.test(text)) return 'artisan detail'
  if (/\b(paisley|botanical|floral|abstract print|print)\b/.test(text)) return 'expressive print'
  if (/\b(linen|gauzy|slub|cotton voile)\b/.test(text)) return 'dry natural texture'
  if (/\b(tiered|maxi|midi|flowing|drape|soft movement)\b/.test(text)) return 'relaxed movement'
  if (/\b(cognac|rust|terracotta|ochre|mustard|olive|brown|tan|amber)\b/.test(text)) return 'earthy color'
  if (/\b(denim|jean)\b/.test(text)) return 'casual denim support'
  return ''
}

const bohoSignalCache = new WeakMap()

export function bohoSignalForPiece(piece = {}) {
  if (piece && typeof piece === 'object' && bohoSignalCache.has(piece)) return bohoSignalCache.get(piece)
  const text = pieceTextBlob(piece)
  let score = 0
  if (/\b(crochet|woven|raffia|rattan|cork|espadrille|basket|braided|embroidered|embroidery|artisan|handmade|paisley|botanical)\b/.test(text)) score += 3
  if (/\b(floral|abstract print|print|linen|gauzy|slub|cotton voile)\b/.test(text)) score += 2
  if (/\b(tiered|maxi skirt|maxi dress|midi skirt|midi dress|flowing|drape|soft movement)\b/.test(text)) score += 1.5
  if (/\b(cognac|rust|terracotta|ochre|mustard|olive|brown|tan|amber|earthy)\b/.test(text)) score += 1
  if (/\b(sandal|clog|mule|boot|leather)\b/.test(text) && wardrobeCategoryGroup(piece) === 'shoes') score += 1
  if (/\b(denim|jean)\b/.test(text)) score += 0.5
  if (piece && typeof piece === 'object') bohoSignalCache.set(piece, score)
  return score
}

export function wholeWardrobeBohoSignalScore(pieces = []) {
  return pieces.reduce((sum, piece) => sum + bohoSignalForPiece(piece), 0)
}

export function wholeWardrobeMissesMood(outfitOrPieces, mood = '') {
  const moodProfile = wholeWardrobeMoodProfile(mood)
  if (moodProfile?.id !== 'modern_bohemian_restraint') return false
  const pieces = Array.isArray(outfitOrPieces)
    ? outfitOrPieces
    : (Array.isArray(outfitOrPieces?.pieces) ? outfitOrPieces.pieces : [])
  return wholeWardrobeBohoSignalScore(pieces) < 2
}

export function strongestBohoPiece(pieces = []) {
  return [...pieces]
    .map(piece => ({ piece, score: bohoSignalForPiece(piece) }))
    .sort((a, b) => b.score - a.score)[0]?.piece || pieces[0] || null
}


export function wholeWardrobeFormulaType(outfit = {}) {
  if (wholeWardrobeHasDress(outfit)) return 'dress_grounding_shoe'
  const text = (Array.isArray(outfit.pieces) ? outfit.pieces : []).map(pieceNameBlob).join(' ')
  if (/\b(compact_top_dark_column)\b/.test(text)) return 'compact_top_dark_column'
  if (/\b(soft_piece_structured_anchor)\b/.test(text)) return 'soft_piece_structured_anchor'
  if (/\b(earthy_structured_separates)\b/.test(text)) return 'earthy_structured_separates'
  if (/\b(relaxed_top_dark_base)\b/.test(text)) return 'relaxed_top_dark_base'
  return 'standard_separates'
}

export function wholeWardrobeDirectionFromPieces(outfit = {}) {
  return wholeWardrobeArchetypeFor(outfit).direction || ''
}

export function wholeWardrobeSilhouetteFromPieces(outfit = {}) {
  return wholeWardrobeArchetypeFor(outfit).silhouette || ''
}

export function wholeWardrobeGroundingStrategy(outfit = {}) {
  const shoe = wholeWardrobePieceByGroup(outfit, 'shoes')
  if (!shoe) return 'no shoe grounding'
  const text = pieceTextBlob(shoe)
  if (/\b(black|dark|charcoal|navy|brown|tan)\b/.test(text) && /\b(pointed|boot|loafer|mule|oxford|structured)\b/.test(text)) return 'sharp dark grounding'
  if (/\b(sneaker|slip-on|flat|sandal|flip)\b/.test(text)) return 'soft casual grounding'
  return 'standard shoe anchor'
}

export function wholeWardrobeShoeShape(outfit = {}) {
  const shoe = wholeWardrobePieceByGroup(outfit, 'shoes')
  if (!shoe) return 'none'
  const text = pieceTextBlob(shoe)
  if (/\b(pointed)\b/.test(text)) return 'pointed'
  if (/\b(almond|oval)\b/.test(text)) return 'almond/oval'
  if (/\b(square)\b/.test(text)) return 'square'
  if (/\b(round|loafer|boot|sneaker)\b/.test(text)) return 'rounded/square'
  return 'rounded'
}

export function wholeWardrobeVisualRhythm(outfit = {}) {
  const counts = { expressive: 0, solid: 0 }
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  pieces.forEach(p => {
    const expressive = /\b(floral|print|pattern|stripe|abstract|graphic)\b/.test(pieceNameBlob(p))
    if (expressive) counts.expressive += 1
    else counts.solid += 1
  })
  if (counts.expressive >= 2) return 'pattern collision / complex rhythm'
  if (counts.expressive === 1) return 'hero print + quiet support'
  return 'clean solid rhythm'
}

export function wholeWardrobeHeroPieceId(outfit = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const sorted = [...pieces].sort((a, b) => {
    const isHero = (p) => /\b(floral|print|pattern|appliqué|applique|crochet|textured|color_accent|hero_piece)\b/.test(pieceTextBlob(p))
    return Number(isHero(b)) - Number(isHero(a))
  })
  return sorted[0]?.id || null
}

export function wholeWardrobeFullPieces(outfit = {}, candidatePieces = []) {
  const ids = Array.isArray(outfit.pieceIds) ? outfit.pieceIds.map(Number) : []
  if (ids.length && Array.isArray(candidatePieces) && candidatePieces.length > 0) {
    const matched = ids.map(id => candidatePieces.find(cp => Number(cp.id) === id)).filter(Boolean)
    if (matched.length > 0) return matched
  }
  return Array.isArray(outfit.pieces) ? outfit.pieces : []
}

export function wholeWardrobePieceByGroup(outfit = {}, group) {
  return (Array.isArray(outfit.pieces) ? outfit.pieces : []).find(p => wardrobeCategoryGroup(p) === group) || null
}

export function wholeWardrobeTopBottomKey(outfit = {}) {
  const top = wholeWardrobePieceByGroup(outfit, 'top')
  const bottom = wholeWardrobePieceByGroup(outfit, 'bottom')
  if (!top || !bottom) return null
  return `${Number(top.id)}:${Number(bottom.id)}`
}

export function wholeWardrobeHasDress(outfit = {}) {
  return (Array.isArray(outfit.pieces) ? outfit.pieces : []).some(p => wardrobeCategoryGroup(p) === 'dress')
}

export function wholeWardrobeHasPrintOrStripe(outfit = {}) {
  const text = (Array.isArray(outfit.pieces) ? outfit.pieces : []).map(pieceNameBlob).join(' ')
  return /\b(floral|print|graphic|stripe|striped|pattern|abstract|tapestry)\b/.test(text)
}

export function wholeWardrobeHasGraphicTop(outfit = {}) {
  const top = wholeWardrobePieceByGroup(outfit, 'top')
  return top ? /\b(floral|print|graphic|stripe|striped|pattern|abstract|tapestry)\b/.test(pieceNameBlob(top)) : false
}

export function wholeWardrobeHasNonGraphicTop(outfit = {}) {
  const top = wholeWardrobePieceByGroup(outfit, 'top')
  return Boolean(top && !wholeWardrobeHasGraphicTop(outfit))
}

export function wholeWardrobeIsExploratory(outfit = {}) {
  const text = (Array.isArray(outfit.pieces) ? outfit.pieces : []).map(pieceNameBlob).join(' ')
  if (wholeWardrobeHasDress(outfit)) return true
  if (/\b(soft|gauzy|linen|cashmere|knit|drape|cream|ivory|oatmeal)\b/.test(text) && /\b(pointed|loafer|boot|mule|oxford|black|cognac)\b/.test(text)) return true
  return false
}

export function wholeWardrobeLabelFromPieces(outfit = {}) {
  const arch = wholeWardrobeArchetypeFor(outfit)
  if (arch?.labelSuggestion) return arch.labelSuggestion
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const names = pieces.map(p => p.name || 'garment')
  if (names.length >= 2) return `${names[0]} & ${names[1]} formula`
  return 'curated wardrobe formula'
}

export function wholeWardrobeReasonFromPieces(outfit = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const text = pieces.map(pieceTextBlob).join(' ')
  const colorPop = /\b(red|orange|mustard|plum|amber)\b/.test(text) && /\b(black|charcoal|navy|grey|beige|cream)\b/.test(text)
  const visualWeight = pieces.map(visualWeightProfile)
  const softAnchor = visualWeight.some(v => v.softness >= 2) && visualWeight.some(v => v.structure >= 2)
  if (colorPop) return 'controlled color pop provides artistic tension to the neutral column'
  if (softAnchor) return 'structured support piece stabilizes the soft natural drape'
  return 'simple balanced separates that follow a stable vertical column'
}

export function wholeWardrobeWatchFromPieces(outfit = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  
  // Double soft volume risk: check if we have a top/dress that is soft/relaxed, AND a bottom that is wide/loose.
  const topOrDress = pieces.find(p => p && (p.category === 'top' || p.category === 'dress'))
  const bottom = pieces.find(p => p && p.category === 'bottom')
  if (topOrDress && bottom) {
    const topText = pieceTextBlob(topOrDress)
    const bottomText = pieceTextBlob(bottom)
    if (/\b(gauzy|soft|relaxed|linen|cotton voile)\b/.test(topText) && /\b(wide|wide-leg|loose)\b/.test(bottomText)) {
      return 'double soft volume risk'
    }
  }
  
  // Visual competition from multiple patterns: count how many DIFFERENT pieces have a pattern or print keyword.
  const patternPiecesCount = pieces.filter(p => {
    if (!p) return false
    const pText = pieceTextBlob(p)
    return /\b(floral|stripe|print|pattern)\b/.test(pText)
  }).length
  if (patternPiecesCount >= 2) {
    return 'visual competition from multiple patterns'
  }
  
  return 'none'
}

export function wholeWardrobeGarmentModifier(pieces = []) {
  const notes = []
  for (const piece of pieces) {
    if (piece.tuck_behavior === 'tucks_with_structure') notes.push(`${piece.name} requires structured tuck`)
    if (piece.waistband_type === 'tight_no_room') notes.push(`tight waist on ${piece.name} limits comfortable tucking`)
  }
  return notes.join(', ') || 'standard wear'
}

export function wholeWardrobeOutfitsFromCandidates(candidates = [], candidatePieces = [], options = {}) {
  return candidates.map(candidate => repairWholeWardrobeOutfit(normalizeWholeWardrobeOutfitObject({
    label: wholeWardrobeLabelFromPieces({ pieces: candidate.pieces }),
    strength: 'usable',
    dominantDirection: wholeWardrobeDirectionFromPieces({ pieces: candidate.pieces }),
    silhouette: wholeWardrobeSilhouetteFromPieces({ pieces: candidate.pieces }),
    bestFor: options.occasion || 'casual',
    pieceIds: candidate.pieceIds,
    pieces: candidate.pieces,
    reason: wholeWardrobeReasonFromPieces({ pieces: candidate.pieces }),
    watchFor: wholeWardrobeWatchFromPieces({ pieces: candidate.pieces }),
    localScore: candidate.localScore,
    missionId: candidate.missionId,
  }, candidatePieces), candidatePieces, options.occasion, options.mood, options))
}

export function scoreWholeWardrobeCandidate(pieces = [], options = {}) {
  const text = pieces.map(pieceTextBlob).join(' ')
  const names = pieces.map(p => p.name).join(' + ')
  const groups = pieces.map(wardrobeCategoryGroup)
  let score = 0
  const reasons = []
  const add = (n, reason) => { score += n; if (reason) reasons.push(reason) }

  // Weather appropriateness
  const weather = options.weatherProfile || weatherProfileFromContext(options)
  if (weather.isHot) {
    for (const piece of pieces) {
      const fit = weatherFitForPiece(piece, weather)
      add(fit.score)
      for (const adjustment of fit.adjustments) reasons.push(adjustment.reason)
    }
    if (pieces.some(p => wardrobeCategoryGroup(p) === 'outerwear')) {
      add(-30, 'hot weather: penalize outerwear/layering')
    }
  } else if (weather.isCold) {
    for (const piece of pieces) {
      const fit = weatherFitForPiece(piece, weather)
      for (const adjustment of fit.adjustments) {
        if (adjustment.reason === 'cold weather: lightweight fabric') {
          const catGroup = wardrobeCategoryGroup(piece)
          if (catGroup !== 'bottom' && catGroup !== 'dress') continue
        }
        add(adjustment.score, adjustment.reason)
      }
    }
    const hasWarmLayer = pieces.some(piece => {
      const catGroup = wardrobeCategoryGroup(piece)
      if (catGroup === 'top' || catGroup === 'outerwear' || catGroup === 'dress') {
        const weight = pieceFabricWeight(piece)
        return weight === 'medium' || weight === 'heavy'
      }
      return false
    })
    if (!hasWarmLayer) {
      add(-14, 'cold weather: no warm layer in ensemble')
    }
  }

  // Cross-piece warmth consistency — independent of the isHot/isCold buckets above, which only
  // score a piece against the two temperature EXTREMES and stay silent in between (e.g. a 76°F
  // day is neither >=80 hot nor <=45 cold, so weatherFitForPiece never runs for it at all). A
  // heavy or insulating-fiber top/bottom paired with bare warm-weather footwear (sandals,
  // open-toe) is an internal contradiction regardless of which bucket the day falls into: bare
  // feet imply the day reads warm enough for that, so the rest of the outfit should track the
  // same read, not a cooler morning/evening low. Cold days are exempt — a warm layer with boots
  // or closed shoes is the point there, and this check only fires alongside bare footwear anyway.
  if (!weather.isCold) {
    const shoe = pieces.find(piece => wardrobeCategoryGroup(piece) === 'shoes')
    const shoeIsBareWarmWeather = shoe && /\b(sandal|sandals|open[- ]toe|flip[- ]flop|flip[- ]flops|slide|slides)\b/i.test(pieceTextBlob(shoe))
    if (shoeIsBareWarmWeather) {
      const heavyOrInsulatingPiece = pieces.find(piece =>
        wardrobeCategoryGroup(piece) !== 'shoes' &&
        (pieceFabricWeight(piece) === 'heavy' || pieceHasInsulatingMaterial(piece))
      )
      if (heavyOrInsulatingPiece) {
        add(-20, `${heavyOrInsulatingPiece.name} is a heavy/insulating piece paired with bare warm-weather footwear (${shoe.name}) — garment weight should track the day, not a cooler low`)
      }
    }
  }

  if (groups.includes('top') && groups.includes('bottom')) add(14, 'complete separates')
  if (groups.includes('dress')) add(12, 'complete dress base')
  if (groups.includes('shoes')) add(10, 'grounded with shoes')
  if (/\b(black|charcoal|espresso|chocolate|deep navy|navy|olive|plum|cognac|rust|mustard)\b/.test(text)) add(7, 'deep/warm palette')
  if (/\b(artistic|graphic|architectural|structured|utility|textured|corduroy|linen|denim)\b/.test(text)) add(8, 'artistic texture/structure')
  if (/\b(pointed|loafer|boot|mule|oxford|cognac|black)\b/.test(text) && groups.includes('shoes')) add(6, 'strong shoe grounding')
  if (/\b(contrast|column|dark|structured|utility|graphic)\b/.test(text)) add(5, 'clear visual thesis')
  if (/\b(focal|hero|anchor|support|grounded|sharp|tension|thesis|waist clarity|shape continuity|visual intelligence)\b/.test(text)) add(5, 'outfit-level visual thesis')

  const wideCount = (text.match(/\b(wide|wide-leg|oversized|loose|flowing|voluminous|relaxed)\b/g) || []).length
  const softCount = (text.match(/\b(soft|gauzy|drape|drapey|chiffon|loose knit|oversized|cream|ivory|beige|taupe|sand)\b/g) || []).length
  const lightNeutralCount = (text.match(/\b(cream|ivory|beige|taupe|sand|oatmeal|white)\b/g) || []).length
  const minorVariationCount = (text.match(/\b(similar|same|matching|coordinated|echoes|pairs well|goes with)\b/g) || []).length
  if (wideCount >= 2) add(-20, 'wide + wide risk')
  if (softCount >= 3) add(-24, 'soft stack risk')
  if (minorVariationCount >= 3 && !/\b(tension|contrast|column|grounded|sharp|anchor|structure|thesis)\b/.test(text)) add(-10, 'minor-variation without thesis risk')
  if (lightNeutralCount >= 3 && !/\b(black|charcoal|espresso|plum|cognac|boot|loafer|pointed|graphic|structured)\b/.test(text)) add(-24, 'generic light-neutral softness')
  if (/\b(librarian|catalog|mature|ladylike|polished neutral|luxe neutral)\b/.test(text)) add(-28, 'catalog/librarian drift risk')
  if (groups.includes('shoes') && !/\b(pointed|loafer|boot|mule|oxford|black|cognac|structured|grounded)\b/.test(text)) add(-8, 'weak shoe grounding')
  for (const piece of pieces) {
    const decision = wholeWardrobePieceTrustDecision(piece, options)
    if (decision.supportOnly && ['top', 'bottom', 'dress'].includes(wardrobeCategoryGroup(piece))) add(-18, `${piece.name} support-only`)
  }

  const registerFit = formalityFitForOutfit(pieces, options)
  if (registerFit.adjustments.length) {
    add(registerFit.score, 'structured register fit')
    reasons.push(...registerFit.adjustments.map(adjustment => adjustment.reason))
  }

  const intelligenceSet = pieces.map(pieceGarmentIntelligence)
  const profileRoleText = intelligenceSet.map(i => i.bestOutfitRole).filter(Boolean).join(' ')
  const profileRulesText = intelligenceSet.flatMap(i => [...i.pairingRequirements, ...i.failureRisks, ...i.formulaCompatibility, ...i.doNotPairRules]).join(' ').toLowerCase()
  if (/\b(hero|movement|texture|color_accent|sharpener)\b/.test(profileRoleText) && /\b(grounding|column|support)\b/.test(profileRoleText)) add(7, 'profile roles create outfit structure')
  if (/\b(waist clarity|shape continuity|structured support|grounded shoe|quiet anchor)\b/.test(profileRulesText)) add(4, 'profile pairing requirements satisfied in candidate')
  if (/\b(too small|too tight|rides up|bunch|pull|fit review|do not auto|costume|unsupported softness)\b/.test(profileRulesText)) add(-18, 'profile risk requires caution')
  if (/\b(avoid another pattern|quiet support|no extra pattern)\b/.test(profileRulesText) && (text.match(/\b(floral|paisley|botanical|abstract|graphic|print|pattern|stripe)\b/g) || []).length >= 2) {
    add(-16, 'profile warns against pattern stacking')
  }

  // Occasion alignment checks
  const occasion = String(options.occasion || '').toLowerCase().trim()
  if (occasion) {
    for (const piece of pieces) {
      if (!pieceOccasionCompatible(piece, occasion)) {
        add(-60, `${piece.name} is unsuitable for ${occasion} occasion`)
      }
    }
  }

  // Occasion/activity profile boosts/penalties
  const occasionProfile = resolveOccasionProfile(occasion, options.mood || '')
  const activityProfile = resolveActivityProfile({
    activity: options.activity,
    occasion,
    mood: options.mood || '',
    request: options.request || options.question || ''
  })
  const mergedRules = getMergedProfileRules(occasionProfile, activityProfile)

  const preferredMaterials = mergedRules.preferred_materials || []
  const preferredFootwear = mergedRules.preferred_footwear || []
  const discouragedMaterials = mergedRules.discouraged_materials ? [...mergedRules.discouraged_materials] : []
  if (weather.isHot && mergedRules.discouraged_materials_warm) {
    discouragedMaterials.push(...mergedRules.discouraged_materials_warm)
  }
  const discouragedFootwear = mergedRules.discouraged_footwear ? [...mergedRules.discouraged_footwear] : []
  if (weather.isHot && mergedRules.discouraged_footwear_summer) {
    discouragedFootwear.push(...mergedRules.discouraged_footwear_summer)
  }
  if (weather.isHot && mergedRules.discouraged_footwear_warm) {
    discouragedFootwear.push(...mergedRules.discouraged_footwear_warm)
  }
  const discouragedPieces = mergedRules.discouraged_pieces || []

  for (const piece of pieces) {
    // Preferred materials boost
    for (const mat of preferredMaterials) {
      if (pieceMatchesMaterial(piece, mat)) {
        const source = occasionProfile?.rules?.preferred_materials?.includes(mat) ? 'occasion' : 'activity'
        add(8, `${source} profile: preferred material (${mat})`)
        break
      }
    }

    // Preferred footwear boost (if category is shoes)
    if (piece.category === 'shoes' || wardrobeCategoryGroup(piece) === 'shoes') {
      for (const fw of preferredFootwear) {
        if (pieceMatchesFootwear(piece, fw)) {
          const source = occasionProfile?.rules?.preferred_footwear?.includes(fw) ? 'occasion' : 'activity'
          add(10, `${source} profile: preferred footwear (${fw})`)
          break
        }
      }
    }

    // Discouraged materials penalty
    for (const mat of discouragedMaterials) {
      if (pieceMatchesMaterial(piece, mat)) {
        const source = occasionProfile?.rules?.discouraged_materials?.includes(mat) || (weather.isHot && occasionProfile?.rules?.discouraged_materials_warm?.includes(mat)) ? 'occasion' : 'activity'
        add(-8, `${source} profile: discouraged material (${mat})`)
        break
      }
    }

    // Discouraged footwear penalty (if category is shoes)
    if (piece.category === 'shoes' || wardrobeCategoryGroup(piece) === 'shoes') {
      for (const fw of discouragedFootwear) {
        if (pieceMatchesFootwear(piece, fw)) {
          const source = occasionProfile?.rules?.discouraged_footwear?.includes(fw) || 
                         (weather.isHot && occasionProfile?.rules?.discouraged_footwear_summer?.includes(fw)) ||
                         (weather.isHot && occasionProfile?.rules?.discouraged_footwear_warm?.includes(fw)) 
                         ? 'occasion' : 'activity'
          add(-10, `${source} profile: discouraged footwear (${fw})`)
          break
        }
      }
    }

    // Discouraged pieces penalty
    for (const item of discouragedPieces) {
      if (pieceMatchesPieceName(piece, item)) {
        const source = occasionProfile?.rules?.discouraged_pieces?.includes(item) ? 'occasion' : 'activity'
        add(-10, `${source} profile: discouraged piece (${item})`)
        break
      }
    }
  }

  if (options.comfortConstraint) {
    const { discouraged_footwear = [], keep_footwear = [] } = options.comfortConstraint
    for (const piece of pieces) {
      if (piece.category === 'shoes' || wardrobeCategoryGroup(piece) === 'shoes') {
        let matchedKeep = false
        for (const fw of keep_footwear) {
          if (pieceMatchesFootwear(piece, fw)) {
            add(10, `comfort constraint: preferred footwear (${fw})`)
            matchedKeep = true
            break
          }
        }
        if (!matchedKeep) {
          for (const fw of discouraged_footwear) {
            if (pieceMatchesFootwear(piece, fw)) {
              add(-10, `comfort constraint: discouraged footwear (${fw})`)
              break
            }
          }
        }
      }
    }
  }



  // Clashing shoe/dress formality check
  const dress = pieces.find(p => wardrobeCategoryGroup(p) === 'dress')
  const shoe = pieces.find(p => wardrobeCategoryGroup(p) === 'shoes')
  if (dress && shoe) {
    const shoeBlob = pieceTextBlob(shoe)
    const isSneaker = /\b(sneaker|running|athletic|sporty|knit sneakers)\b/.test(shoeBlob)
    const dressBlob = pieceTextBlob(dress)
    const isFormalDress = /\b(evening|cocktail|formal|elegant|silk|satin|maxi)\b/.test(dressBlob) || (dress.occasions || []).map(o => o.toLowerCase()).includes('evening')
    if (isSneaker && isFormalDress) {
      add(-40, `clashing shoe formality: pairing casual sneakers with formal/maxi dress`)
    }
  }

  const sessionInfluence = options.sessionInfluence
  if (sessionInfluence) {
    const pieceIds = pieces.map(p => Number(p.id)).filter(Boolean)
    const formula = wholeWardrobeFormulaFamily({ pieces }, pieces, options.occasion)
    const piecePenalty = pieceIds.reduce((sum, id) => sum + (sessionInfluence.pieceRecency?.get(id) || 0), 0)
    if (piecePenalty > 0) add(-Math.min(piecePenalty, 40), 'recently shown pieces')

    const formulaPenalty = sessionInfluence.formulaRecency?.get(formula) || 0
    if (formulaPenalty > 0) add(-Math.min(formulaPenalty, 35), 'recently shown formula family')
  }

  const mood = String(options.mood || '').toLowerCase()
  const moodProfile = wholeWardrobeMoodProfile(mood)
  if (mood && text.includes(mood)) add(2, 'mood match')
  if (moodProfile?.id === 'modern_bohemian_restraint') {
    const bohoSignal = wholeWardrobeBohoSignalScore(pieces)
    const polishedGrounding = /\b(boot|mule|loafer|sandal|clog|wedge|leather|cognac|black|brown|pointed)\b/.test(text) && groups.includes('shoes')
    if (bohoSignal >= 4) add(28, 'strong boho mood match')
    else if (bohoSignal >= 2) add(16, 'boho mood match')
    else add(-36, 'misses boho mood')
    if (polishedGrounding) add(5, 'city boho grounding')
    if (/\b(black|turtleneck|tailored trouser|pointed heel|minimal column|all black|monochrome)\b/.test(text) && bohoSignal < 2) add(-24, 'too structured-minimal for boho mood')
  }

  const activeMissionId = options.activeMissionId
  if (activeMissionId) {
    if (activeMissionId === 'controlled_print') {
      const patternPieces = pieces.filter(p => {
        const pBlob = pieceTextBlob(p)
        const pName = pieceNameBlob(p)
        return /\b(floral|print|pattern|stripe|striped|abstract|tapestry|paisley|botanical|graphic|plaid)\b/.test(pName) ||
               /\b(floral|print|pattern|stripe|striped|abstract|tapestry|paisley|botanical|graphic|plaid)\b/.test(pBlob)
      })
      if (patternPieces.length === 1) {
        add(20, 'exactly one print hero')
      } else {
        add(-80, 'does not have exactly one print hero')
      }
      const hasStructuredStabilizer = pieces.some(p => {
        const pBlob = pieceTextBlob(p)
        return /\b(structured|utility|jacket|blazer|denim|trouser|leather|pointed|loafer|boot)\b/.test(pBlob)
      })
      if (hasStructuredStabilizer) {
        add(15, 'structured stabilizer present')
      } else {
        add(-15, 'lacks structured stabilizer')
      }
    } else if (activeMissionId === 'monochrome_texture') {
      const colorsSets = pieces.map(p => (p.colors || []).map(c => c.toLowerCase()))
      const neutralGray = ['black', 'grey', 'gray', 'charcoal']
      const blueFamily = ['blue', 'navy', 'denim']
      const earthFamily = ['brown', 'espresso', 'tan', 'cognac', 'beige', 'cream', 'ivory', 'sand', 'oatmeal']
      
      const counts = { neutralGray: 0, blueFamily: 0, earthFamily: 0 }
      for (const pColors of colorsSets) {
        if (pColors.some(c => neutralGray.includes(c))) counts.neutralGray++
        if (pColors.some(c => blueFamily.includes(c))) counts.blueFamily++
        if (pColors.some(c => earthFamily.includes(c))) counts.earthFamily++
      }
      
      const maxMatch = Math.max(counts.neutralGray, counts.blueFamily, counts.earthFamily)
      if (maxMatch === pieces.length) {
        add(25, 'perfect monochrome color family match')
      } else if (maxMatch >= pieces.length - 1) {
        add(15, 'tonal monochrome support')
      } else {
        add(-80, 'competing colors in monochrome mission')
      }
      
      const textBlob = pieces.map(pieceTextBlob).join(' ')
      const textureCount = (textBlob.match(/\b(crochet|knit|cashmere|corduroy|linen|silk|satin|leather|suede|tweed|velvet|gauzy|drape|textured)\b/g) || []).length
      if (textureCount >= 2) {
        add(20, 'rich texture contrast')
      } else {
        add(-15, 'lacks texture variety')
      }
    } else if (activeMissionId === 'structured_soft') {
      const hasSoft = pieces.some(p => /\b(soft|gauzy|drape|drapey|silk|satin|cashmere|wool knit|linen|ruffle|cowl|mock)\b/.test(pieceTextBlob(p)))
      const hasStructured = pieces.some(p => /\b(structured|utility|blazer|jacket|twill|denim|leather|pointed|loafer|boot|pants|trousers)\b/.test(pieceTextBlob(p)))
      if (hasSoft && hasStructured) {
        add(25, 'productive soft + structured tension')
      } else {
        add(-80, 'lacks structured/soft tension')
      }
    } else if (activeMissionId === 'color_anchor') {
      const focalCount = pieces.filter(p => pieceHasFocalColor(p, MISSION_FOCAL_COLORS)).length
      
      if (focalCount === 1) {
        add(30, 'exactly one focal color anchor')
      } else {
        add(-80, 'does not have exactly one focal color anchor')
      }
      
      const nonFocalPieces = pieces.filter(p => !pieceHasFocalColor(p, MISSION_FOCAL_COLORS))
      const allNonFocalNeutral = nonFocalPieces.every(p => {
        const colors = (p.colors || []).map(c => c.toLowerCase())
        const readsAs = String(p.reads_as || '').toLowerCase()
        const name = String(p.name || '').toLowerCase()
        const cText = [...colors, readsAs, name].join(' ')
        return /\b(black|charcoal|grey|gray|navy|white|cream|ivory|beige|taupe|sand|oatmeal|espresso|brown)\b/.test(cText)
      })
      
      if (allNonFocalNeutral) {
        add(15, 'quiet neutral support for anchor')
      } else {
        add(-30, 'noisy support distracts from color anchor')
      }
    } else if (activeMissionId === 'unexpected_pairing') {
      add(20, 'exploratory unexpected candidate pairing')
      const shoe = pieces.find(p => wardrobeCategoryGroup(p) === 'shoes')
      if (shoe && /\b(pointed|patent|loafer|boot|mule|oxford|structured)\b/.test(pieceTextBlob(shoe))) {
        add(25, 'unexpected pairing grounded by structured shoe')
      } else {
        add(-15, 'unexpected pairing lacks grounded finish')
      }
    } else if (activeMissionId === 'soft_architecture') {
      const hasDenimOrBlack = pieces.some(p => /\b(denim|jean|black)\b/.test(pieceTextBlob(p)) || /\b(denim|jean|black)\b/.test(pieceNameBlob(p)))
      if (hasDenimOrBlack) {
        add(-80, 'contains forbidden denim or black')
      } else {
        add(20, 'clean non-denim/non-black architecture')
      }
      const hasShape = pieces.some(p => /\b(cowl|mock|boatneck|drape|drapey|A-line|flowing|column|maxi|midi|waist|belt|tuck)\b/.test(pieceTextBlob(p)))
      if (hasShape) {
        add(15, 'architectural shape / drape')
      }
    }
  }

  return { score, reasons: reasons.slice(0, 10), names }
}

export function candidateObjectFromPieces(pieces, index, options) {
  const scored = scoreWholeWardrobeCandidate(pieces, options)
  const activeMission = OUTFIT_MISSIONS.find(m => m.id === options.activeMissionId)
  return {
    candidateId: `cand-${index + 1}`,
    label: pieces.map(p => p.name).join(' + '),
    pieceIds: pieces.map(p => Number(p.id)).filter(Boolean),
    pieces: pieces.map(p => ({ id: p.id, name: p.name, category: wardrobeCategoryGroup(p), photo: p.photo || null, worn_photo: p.worn_photo || null })),
    localScore: scored.score,
    localReasons: scored.reasons,
    missionId: options.activeMissionId || null,
    missionLabel: activeMission ? activeMission.label : null
  }
}

export function wholeWardrobeCandidateAxes(candidate = {}) {
  const pieces = Array.isArray(candidate.pieces) ? candidate.pieces : []
  const outfit = { pieces }
  const top = wholeWardrobePieceByGroup(outfit, 'top')
  const bottom = wholeWardrobePieceByGroup(outfit, 'bottom')
  const shoe = wholeWardrobePieceByGroup(outfit, 'shoes')
  const text = pieces.map(pieceTextBlob).join(' ').toLowerCase()
  return {
    topId: top ? Number(top.id) : null,
    bottomId: bottom ? Number(bottom.id) : null,
    shoeId: shoe ? Number(shoe.id) : null,
    formula: wholeWardrobeFormulaFamily(outfit, pieces),
    silhouette: wholeWardrobeSilhouetteFromPieces(outfit),
    grounding: wholeWardrobeGroundingStrategy(outfit),
    shoeShape: wholeWardrobeShoeShape(outfit),
    rhythm: wholeWardrobeVisualRhythm(outfit),
    hasDress: pieces.some(p => wardrobeCategoryGroup(p) === 'dress'),
    hasNonGraphicTop: Boolean(top && !/\b(floral|print|graphic|stripe|striped|pattern|abstract|tapestry)\b/.test(pieceTextBlob(top))),
    hasSoftTexture: /\b(crochet|gauze|gauzy|soft|cashmere|drape|drapey|silk|ruffle|fluid)\b/.test(text),
    hasTonalDark: /\b(black|charcoal|espresso|chocolate|deep navy|navy)\b/.test(text) && !/\b(floral|graphic|stripe|striped|pattern|abstract|tapestry)\b/.test(text)
  }
}

export function selectDiverseWholeWardrobeCandidates(candidates = [], limit = 60, options = {}) {
  const selected = []
  const pool = [...candidates]
  const useCount = {
    top: new Map(),
    bottom: new Map(),
    shoe: new Map(),
    formula: new Map(),
    silhouette: new Map(),
    grounding: new Map(),
    shoeShape: new Map(),
    rhythm: new Map()
  }
  const count = (map, key) => key == null ? 0 : (map.get(key) || 0)
  const bump = (map, key) => {
    if (key != null) map.set(key, (map.get(key) || 0) + 1)
  }
  const selectedHas = predicate => selected.some(candidate => predicate(wholeWardrobeCandidateAxes(candidate)))

  // Guarantee representation of each unique mission present in the pool first
  const uniqueMissionsInPool = [...new Set(pool.map(c => c.missionId).filter(Boolean))]
  for (const missionId of uniqueMissionsInPool) {
    if (selected.length >= limit) break
    const missionCandidates = pool.filter(c => c.missionId === missionId)
    if (!missionCandidates.length) continue
    missionCandidates.sort((a, b) => (b.score ?? b.localScore ?? 0) - (a.score ?? a.localScore ?? 0))
    const bestForMission = missionCandidates[0]
    const poolIdx = pool.findIndex(c => c.key === bestForMission.key)
    if (poolIdx !== -1) {
      const [chosen] = pool.splice(poolIdx, 1)
      const axes = wholeWardrobeCandidateAxes(chosen)
      selected.push(chosen)
      bump(useCount.top, axes.topId)
      bump(useCount.bottom, axes.bottomId)
      bump(useCount.shoe, axes.shoeId)
      bump(useCount.formula, axes.formula)
      bump(useCount.silhouette, axes.silhouette)
      bump(useCount.grounding, axes.grounding)
      bump(useCount.shoeShape, axes.shoeShape)
      bump(useCount.rhythm, axes.rhythm)
    }
  }

  while (pool.length && selected.length < limit) {
    let bestIndex = 0
    let bestScore = -Infinity
    for (let i = 0; i < pool.length; i += 1) {
      const candidate = pool[i]
      const axes = wholeWardrobeCandidateAxes(candidate)
      let score = Number(candidate.score ?? candidate.localScore) || 0

      if (!count(useCount.formula, axes.formula)) score += 22
      if (!count(useCount.silhouette, axes.silhouette)) score += 16
      if (!count(useCount.grounding, axes.grounding)) score += 12
      if (!count(useCount.shoeShape, axes.shoeShape)) score += 10
      if (!count(useCount.rhythm, axes.rhythm)) score += 10
      if (axes.topId && !count(useCount.top, axes.topId)) score += 9
      if (axes.bottomId && !count(useCount.bottom, axes.bottomId)) score += 9
      if (axes.hasDress && !selectedHas(a => a.hasDress)) score += 24
      if (axes.hasNonGraphicTop && !selectedHas(a => a.hasNonGraphicTop)) score += 16
      if (axes.hasSoftTexture && !selectedHas(a => a.hasSoftTexture)) score += 12
      if (axes.hasTonalDark && !selectedHas(a => a.hasTonalDark)) score += 12
      const moodProfile = wholeWardrobeMoodProfile(options.mood)
      if (moodProfile?.id === 'modern_bohemian_restraint') {
        const bohoSignal = wholeWardrobeBohoSignalScore(candidate.pieces)
        if (bohoSignal >= 4) score += 30
        else if (bohoSignal >= 2) score += 16
        else score -= 60
      }

      score -= count(useCount.top, axes.topId) * 46
      score -= count(useCount.bottom, axes.bottomId) * 34
      score -= count(useCount.shoe, axes.shoeId) * 14
      score -= count(useCount.formula, axes.formula) * 44
      score -= count(useCount.silhouette, axes.silhouette) * 24
      score -= count(useCount.grounding, axes.grounding) * 14
      score -= count(useCount.shoeShape, axes.shoeShape) * 12
      score -= count(useCount.rhythm, axes.rhythm) * 12

      if (score > bestScore) {
        bestScore = score
        bestIndex = i
      }
    }

    const [chosen] = pool.splice(bestIndex, 1)
    const axes = wholeWardrobeCandidateAxes(chosen)
    selected.push(chosen)
    bump(useCount.top, axes.topId)
    bump(useCount.bottom, axes.bottomId)
    bump(useCount.shoe, axes.shoeId)
    bump(useCount.formula, axes.formula)
    bump(useCount.silhouette, axes.silhouette)
    bump(useCount.grounding, axes.grounding)
    bump(useCount.shoeShape, axes.shoeShape)
    bump(useCount.rhythm, axes.rhythm)
  }

  return selected
}

export function wholeWardrobeCandidateFormulaCounts(candidates = []) {
  return candidates.reduce((counts, candidate) => {
    const formula = wholeWardrobeCandidateAxes(candidate).formula || 'unknown'
    counts[formula] = (counts[formula] || 0) + 1
    return counts
  }, {})
}

export function wholeWardrobeCandidateText(candidates = []) {
  return candidates.map((candidate, index) => [
    `${index + 1}. ${candidate.candidateId} | formula family ${wholeWardrobeCandidateAxes(candidate).formula}`,
    `Pieces: ${candidate.pieces.map(p => `${p.id}:${p.name} (${p.category})`).join(' + ')}`,
    candidate.localReasons?.length ? `Local reasons: ${candidate.localReasons.join('; ')}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')
}

function isWholeWardrobeLayerableTop(piece = {}) {
  if (wardrobeCategoryGroup(piece) !== 'top') return false
  const text = [
    piece.name,
    piece.notes,
    piece.engine_notes,
    piece.reads_as,
    piece.silhouette,
    garmentProfileText(piece),
    String(piece.role_permission || '')
  ].filter(Boolean).join(' ').toLowerCase()
  return /\b(button[- ]?(up|down)|overshirt|shirt[- ]?jacket|cardigan|kimono|wrap|vest)\b/.test(text)
    || /\b(layer_top|top layer|overlayer|overlay|worn open|wear open|worn over|wear over)\b/.test(text)
}

export function buildWholeWardrobeCandidateOutfits(allPieces, options = {}) {
  const moodProfile = wholeWardrobeMoodProfile(options.mood)
  const activeMissions = options.activeMissions || ['controlled_print', 'monochrome_texture', 'structured_soft', 'color_anchor', 'unexpected_pairing']
  const requiredPieceId = Number(options.requiredPieceId || options.mainPieceId) || null
  const requiredPiece = requiredPieceId
    ? allPieces.find(piece => Number(piece.id) === requiredPieceId)
    : null
  const requiredGroup = requiredPiece ? wardrobeCategoryGroup(requiredPiece) : ''
  const requiredIsAddOn = ['outerwear', 'accessory'].includes(requiredGroup)
  const preserveLayeredTop = Boolean(options.preserveLayeredTop || options.sourceHasLayeredTopFormula)
  const requiredIsLayerableTop = preserveLayeredTop && requiredGroup === 'top' && isWholeWardrobeLayerableTop(requiredPiece)
  
  const requestedCandidateLimit = Math.max(0, Number(options.candidateLimit) || 0)
  const requestedBucketLimit = Math.max(0, Number(options.candidateBucketLimit) || 0)
  const testCandidateLimit = process.env.NODE_ENV === 'test'
    ? Math.max(0, Number(process.env.WARDROBE_TEST_MAX_WHOLE_WARDROBE_CANDIDATES) || 0)
    : 0
  const effectiveCandidateLimit = Math.max(testCandidateLimit, requestedCandidateLimit)
  
  const allMissionsCandidates = []
  const seenKeys = new Set()
  
  const colorFamilies = ['black/charcoal/gray', 'navy/blue', 'brown/espresso/beige/cream/tan', 'olive/earthy']
  const focalColors = ['rust', 'terracotta', 'mustard', 'ochre', 'olive', 'plum', 'burgundy', 'emerald', 'red']
  
  const chosenColorFamily = colorFamilies[(allPieces.length) % colorFamilies.length]
  const chosenFocalColor = focalColors[(allPieces.length + 3) % focalColors.length]
  
  for (const missionId of activeMissions) {
    const bucket = wholeWardrobePieceBucket(allPieces, {
      ...options,
      missionId,
      colorFamily: chosenColorFamily,
      focalColor: chosenFocalColor
    })
    
    const maxInitialCandidates = effectiveCandidateLimit ? Math.max(20, effectiveCandidateLimit * 2) : 1200
    const maxSeparateCandidates = Math.round(maxInitialCandidates * 0.85)
    
    const sliceForTest = (items, productionLimit) => items.slice(0, effectiveCandidateLimit ? Math.min(items.length, requestedBucketLimit || 3) : productionLimit)
    
    const includeRequiredFirst = (items, group) => {
      if (!requiredPiece || requiredGroup !== group) return items
      const withoutRequired = items.filter(piece => Number(piece.id) !== requiredPieceId)
      return [requiredPiece, ...withoutRequired]
    }
    const shoes = requiredGroup === 'shoes'
      ? [requiredPiece]
      : (bucket.shoes.length ? sliceForTest(includeRequiredFirst(bucket.shoes, 'shoes'), 10) : [null])
    const tops = requiredGroup === 'top'
      ? [requiredPiece]
      : sliceForTest(includeRequiredFirst(bucket.top, 'top'), 16)
    const baseTopsForRequiredLayer = requiredIsLayerableTop
      ? sliceForTest(bucket.top.filter(piece => Number(piece.id) !== requiredPieceId), 10)
      : []
    const bottoms = requiredGroup === 'bottom'
      ? [requiredPiece]
      : sliceForTest(includeRequiredFirst(bucket.bottom, 'bottom'), 14)
    const dresses = requiredGroup === 'dress'
      ? [requiredPiece]
      : sliceForTest(includeRequiredFirst(bucket.dress, 'dress'), 10)
    const outerwear = requiredGroup === 'outerwear'
      ? includeRequiredFirst(bucket.outerwear, 'outerwear').slice(0, effectiveCandidateLimit ? 1 : 6)
      : sliceForTest(includeRequiredFirst(bucket.outerwear, 'outerwear'), 6)
    const accessories = requiredGroup === 'accessory'
      ? includeRequiredFirst(bucket.accessory, 'accessory').slice(0, effectiveCandidateLimit ? 1 : 6)
      : sliceForTest(includeRequiredFirst(bucket.accessory, 'accessory'), 6)
    
    const missionCandidates = []
    
    const addCandidate = (pieces, { allowMissingRequired = false } = {}) => {
      if (missionCandidates.length >= maxInitialCandidates) return
      const clean = pieces.filter(Boolean)
      if (requiredPieceId && !allowMissingRequired && !clean.some(piece => Number(piece.id) === requiredPieceId)) return
      if (moodProfile?.id === 'modern_bohemian_restraint' && wholeWardrobeBohoSignalScore(clean) < 2) return
      if (!qualifiesWholeWardrobeMission(clean, missionId)) return
      if (explicitFormalityAvoidanceIssue(clean, options)) return
      
      if (missionId === 'soft_architecture') {
        const hasDenimOrBlack = clean.some(p => /\b(denim|jean|black)\b/.test(pieceTextBlob(p)) || /\b(denim|jean|black)\b/.test(pieceNameBlob(p)))
        if (hasDenimOrBlack) return
      }
      
      const key = clean.map(p => p.id).sort((a,b) => a-b).join('|')
      if (!key) return
      const scored = scoreWholeWardrobeCandidate(clean, { ...options, activeMissionId: missionId })
      if (scored.score < -18) return
      missionCandidates.push({ key, pieces: clean, score: scored.score, missionId })
    }
    const addStructuralCandidate = (pieces) => {
      const clean = pieces.filter(Boolean)
      if (!clean.length) return
      if (requiredPieceId && !clean.some(piece => Number(piece.id) === requiredPieceId)) return
      if (explicitFormalityAvoidanceIssue(clean, options)) return
      const key = clean.map(p => p.id).sort((a,b) => a-b).join('|')
      if (!key || missionCandidates.some(candidate => candidate.key === key)) return
      const scored = scoreWholeWardrobeCandidate(clean, { ...options, activeMissionId: missionId })
      missionCandidates.push({ key, pieces: clean, score: scored.score, missionId })
    }
    const hasRequiredCandidate = () => !requiredPieceId || missionCandidates.some(candidate => candidate.pieces.some(piece => Number(piece.id) === requiredPieceId))
    // Append the Main piece only when a slot has not already supplied it. For an add-on Main
    // (outerwear/accessory) the slot lists never contain it, so this is a no-op; for a top/bottom
    // Main the slot list IS [requiredPiece], and appending blindly would duplicate the garment.
    const withRequiredPiece = pieces => {
      const clean = pieces.filter(Boolean)
      return clean.some(piece => Number(piece.id) === requiredPieceId) ? clean : [...clean, requiredPiece]
    }
    
    if (requiredGroup !== 'dress') {
      separateCandidates:
      for (const top of tops) {
        for (const bottom of bottoms) {
          for (const shoe of shoes) {
            addCandidate(requiredIsAddOn ? [top, bottom, shoe, requiredPiece] : [top, bottom, shoe])
            if (missionCandidates.length >= maxSeparateCandidates) break separateCandidates
          }
        }
      }
      if (requiredIsLayerableTop) {
        layeredTopCandidates:
        for (const baseTop of baseTopsForRequiredLayer) {
          for (const bottom of bottoms) {
            for (const shoe of shoes) {
              addCandidate([baseTop, bottom, shoe, requiredPiece])
              if (missionCandidates.length >= maxSeparateCandidates) break layeredTopCandidates
            }
          }
        }
      }
    }
    if (!['top', 'bottom'].includes(requiredGroup)) {
      dressCandidates:
      for (const dress of dresses) {
        for (const shoe of shoes) {
          addCandidate(requiredIsAddOn ? [dress, shoe, requiredPiece] : [dress, shoe])
          if (requiredGroup === 'dress') {
            for (const top of tops.slice(0, effectiveCandidateLimit ? 2 : 6)) {
              if (Number(top?.id) !== requiredPieceId) addCandidate([dress, top, shoe])
            }
          }
          if (missionCandidates.length >= maxInitialCandidates) break dressCandidates
        }
      }
    }
    // Structural fallback for the Main piece. This used to be gated on `requiredIsAddOn`, so an
    // outerwear/accessory Main fell back to structurally-valid outfits when no mission qualified,
    // but a top/bottom/dress Main in the same situation produced NOTHING — the saved-outfit
    // "Similar variants" path (routes/ai.js) then returned zero candidates for a perfectly
    // ordinary garment. Gated on `!hasRequiredCandidate()`, so it is additive by construction:
    // it can only add outfits where there were none, never replace or reorder existing ones.
    if (requiredPieceId && !hasRequiredCandidate()) {
      // A layer-capable top Main keeps its base top: preserve the saved two-top formula before
      // falling back to a single-top look, so the layer is not flattened into the only top.
      if (requiredIsLayerableTop) {
        structuralLayeredTop:
        for (const baseTop of baseTopsForRequiredLayer) {
          for (const bottom of bottoms) {
            for (const shoe of shoes) {
              addStructuralCandidate([baseTop, bottom, shoe, requiredPiece])
              if (hasRequiredCandidate()) break structuralLayeredTop
            }
          }
        }
      }
      // Same role guards the mission path above uses. Without them a dress Main gets appended to a
      // complete top+bottom+shoes look, which is not an outfit anyone can wear.
      if (requiredGroup !== 'dress') {
        structuralSeparate:
        for (const top of tops) {
          for (const bottom of bottoms) {
            for (const shoe of shoes) {
              if (hasRequiredCandidate()) break structuralSeparate
              addStructuralCandidate(withRequiredPiece([top, bottom, shoe]))
              if (hasRequiredCandidate()) break structuralSeparate
            }
          }
        }
      }
      if (!['top', 'bottom'].includes(requiredGroup) && !hasRequiredCandidate()) {
        structuralDress:
        for (const dress of dresses) {
          for (const shoe of shoes) {
            addStructuralCandidate(withRequiredPiece([dress, shoe]))
            if (hasRequiredCandidate()) break structuralDress
          }
        }
      }
    }
    
    const baseCandidateLimit = effectiveCandidateLimit ? Math.max(4, Math.round(effectiveCandidateLimit / 4)) : 40
    const layeredBaseLimit = effectiveCandidateLimit ? 2 : 15
    const layerLimit = effectiveCandidateLimit ? 1 : 2
    const accessoryLimit = effectiveCandidateLimit ? 1 : 2
    const base = missionCandidates
      .sort((a, b) => b.score - a.score)
      .slice(0, baseCandidateLimit)
    
    for (const candidate of base.slice(0, layeredBaseLimit)) {
      for (const layer of outerwear.slice(0, layerLimit)) addCandidate([...candidate.pieces, layer])
      for (const accessory of accessories.slice(0, accessoryLimit)) addCandidate([...candidate.pieces, accessory])
    }
    
    const sortedMissionCandidates = missionCandidates
      .filter(cand => !requiredPieceId || cand.pieces.some(piece => Number(piece.id) === requiredPieceId))
      .sort((a, b) => b.score - a.score)
    const topLimit = effectiveCandidateLimit ? Math.max(4, Math.round(effectiveCandidateLimit / 4)) : 50
    for (const cand of sortedMissionCandidates.slice(0, topLimit)) {
      const globalKey = `${cand.key}-${missionId}`
      if (!seenKeys.has(globalKey)) {
        seenKeys.add(globalKey)
        allMissionsCandidates.push(cand)
      }
    }
  }
  
  const ranked = allMissionsCandidates.sort((a, b) => b.score - a.score)
  const chosen = selectDiverseWholeWardrobeCandidates(ranked, effectiveCandidateLimit || 60, options)
  
  return chosen.map((candidate, index) => {
    return candidateObjectFromPieces(candidate.pieces, index, { ...options, activeMissionId: candidate.missionId })
  })
}

export function normalizeWholeWardrobeOutfitObject(outfit, candidatePieces = []) {
  const candidateById = new Map(candidatePieces.map(p => [Number(p.id), p]))
  const ids = []
  const addId = (value) => {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0 && candidateById.has(n) && !ids.includes(n)) ids.push(n)
  }
  if (Array.isArray(outfit?.pieceIds)) outfit.pieceIds.forEach(addId)
  if (Array.isArray(outfit?.pieces)) outfit.pieces.forEach(piece => addId(piece?.id))
  const ownedPieces = ids.map(id => candidateById.get(id)).filter(Boolean)
  const label = String(outfit?.label || outfit?.title || 'Whole wardrobe outfit').trim()
  const strength = String(outfit?.strength || '').toLowerCase().trim()
  const missionId = outfit?.missionId || null
  const activeMission = OUTFIT_MISSIONS.find(m => m.id === missionId)
  const silhouette = String(outfit?.silhouette || '').trim()
  const suppliedStylingInstructions = String(outfit?.styling_instructions || outfit?.stylingInstructions || '').trim()
  return {
    label,
    strength: ['signature', 'strong', 'usable', 'experimental'].includes(strength) ? strength : 'strong',
    dominantDirection: outfit?.dominantDirection || outfit?.dominant_direction || outfit?.direction || '',
    silhouette,
    bestFor: outfit?.bestFor || outfit?.best_for || '',
    reason: outfit?.reason || outfit?.why || '',
    stylingInstructions: suppliedStylingInstructions,
    watchFor: outfit?.watchFor || outfit?.watch_for || 'none',
    pieceIds: ids.slice(0, 6),
    missingPieces: [],
    textOnly: true,
    wholeWardrobe: true,
    localScore: Number(outfit?.localScore) || 0,
    archetypeId: outfit?.archetypeId || null,
    formulaFamily: outfit?.formulaFamily || null,
    missionId,
    missionLabel: activeMission ? activeMission.label : null,
    pieces: ownedPieces.map(p => ({
      id: p.id,
      name: p.name,
      category: wardrobeCategoryGroup(p),
      bottomKind: bottomKind(p),
      photo: p.photo || null,
      worn_photo: p.worn_photo || null
    }))
  }
}

// One vocabulary for "this text is showing its working", shared by the card fields below and by the
// closing answer in provider.js. Retrieval and self-correction are how the turn was produced, not
// what it produced: the user asked for an outfit, not a transcript of the search that found it.
// Keep this list mechanical and short. It is not a semantic judge — prose that merely reads oddly is
// the model's business, and widening it into a style filter is how a guard becomes a rules engine.
//
// Every term must be unambiguous deliberation. "instead of the" and "rejected" were drafted here and
// removed before shipping: "wear the cardigan open instead of the belted version" is a styling
// instruction, not a confession, and this predicate also gates the card's own styling_instructions.
// Same failure as the earlier detector that erased legitimate instructions containing "wait" or
// "must use". When in doubt, leave a term out — a missed leak costs a sentence, a false positive
// deletes advice the user needed.
export function exposesComposerDeliberation(text = '') {
  const value = String(text || '')
  // Retrieval and self-correction. Note what is NOT here: "instead of the" and "rejected" were
  // drafted into this list and removed before shipping, because they ate real styling instructions
  // ("wear the cardigan open instead of the belted version"). Do not put them back.
  if (/\b(?:rebuilding|checking available|checking the|using it despite|recently[- ]shown|let me (?:search|check|look)|searching (?:for|the)|no (?:results|matches) (?:for|found))\b/i.test(value)) return true // ratchet-allow: model-output integrity boundary, not garment classification
  // Search-broadening machinery (2026-08-19). search_wardrobe now reports which filters it relaxed;
  // that report exists for the model's reasoning, not for the reader. These patterns are deliberately
  // narrow because the vocabulary collides with real styling language: "relaxed" is a silhouette
  // ("relaxed wide-leg trousers") and a jacket can "broaden" a shoulder line. Match the machinery
  // phrasing, never the bare adjective.
  if (/\bno exact match\b/i.test(value)) return true // ratchet-allow: model-output integrity boundary, not garment classification
  if (/\b(?:relaxed|dropped|removed|loosened) (?:the |my )?[\w-]* ?(?:filter|filters|requirement|constraint)s?\b/i.test(value)) return true // ratchet-allow: model-output integrity boundary, not garment classification
  if (/\bbroadened (?:the |my )?(?:search|query|criteria)\b/i.test(value)) return true // ratchet-allow: model-output integrity boundary, not garment classification
  // The literal field names of the retrieval report: quoting them is machinery by definition.
  if (/\b(?:relaxedFilters|requestedCategories|returnedByCategory|shortfalls?)\b/.test(value)) return true // ratchet-allow: model-output integrity boundary, not garment classification
  return false
}

export function sanitizeWholeWardrobeOutfitProse(outfit = {}) {
  const finalIds = new Set((outfit?.pieceIds || []).map(Number).filter(Number.isFinite))
  const proseFields = ['reason', 'watchFor', 'stylingInstructions']
  const fieldIssues = proseFields.flatMap(field => {
    const text = String(outfit?.[field] || '')
    const citedIds = [...text.matchAll(/\bID\s*#?\s*(\d+)\b/gi)].map(match => Number(match[1])) // ratchet-allow: validating model output citations, not garment classification
    const outsideIds = [...new Set(citedIds.filter(id => !finalIds.has(id)))]
    const exposesDeliberation = exposesComposerDeliberation(text)
    if (!outsideIds.length && !exposesDeliberation) return []
    return [{ field, outsideIds, exposesDeliberation }]
  })
  const actualBottomKinds = (outfit?.pieces || [])
    .filter(piece => piece?.category === 'bottom')
    .map(piece => String(piece?.bottomKind || ''))
  const silhouette = String(outfit?.silhouette || '')
  const callsSkirtPants = actualBottomKinds.some(kind => kind.startsWith('skirt')) && /\b(?:trousers?|pants?|jeans?)\b/i.test(silhouette) // ratchet-allow: validating model output against structured bottom_kind, not classifying garments
  const callsPantsSkirt = actualBottomKinds.includes('pants') && /\bskirt\b/i.test(silhouette) // ratchet-allow: validating model output against structured bottom_kind, not classifying garments
  const silhouetteIssue = callsSkirtPants || callsPantsSkirt
    ? 'silhouette: named a bottom category that is not present on the final card'
    : ''
  if (!fieldIssues.length && !silhouetteIssue) return outfit

  const names = (outfit?.pieces || []).map(piece => piece?.name).filter(Boolean)
  const issues = fieldIssues.flatMap(issue => [
    ...(issue.exposesDeliberation ? [`${issue.field}: exposed composer deliberation`] : []),
    ...(issue.outsideIds.length ? [`${issue.field}: cited IDs outside final card: ${issue.outsideIds.join(', ')}`] : [])
  ]).concat(silhouetteIssue ? [silhouetteIssue] : [])
  const badFields = new Set(fieldIssues.map(issue => issue.field))
  return {
    ...outfit,
    ...(badFields.has('reason') ? { reason: `Final card: ${names.join(', ')}. The composer’s original explanation was withheld because it did not consistently describe these final pieces.` } : {}),
    ...(badFields.has('watchFor') ? { watchFor: 'none' } : {}),
    ...(badFields.has('stylingInstructions') ? { stylingInstructions: '' } : {}),
    ...(silhouetteIssue ? {
      silhouette: 'Silhouette description withheld because it did not match the garments shown.'
    } : {}),
    proseIntegrityIssues: issues,
    resolutionNote: silhouetteIssue && !fieldIssues.length
      ? 'Silhouette wording corrected locally; review the garment photos shown on this card.'
      : 'Styling explanation withheld; review the final garment combination shown on this card.'
  }
}

export function mergeStyleProfilePatch(existing = {}, patch = {}) {
  if (!patch || typeof patch !== 'object') return existing || {}
  const base = existing && typeof existing === 'object' ? existing : {}
  const merged = { ...base, ...patch }
  if (base.style_lanes || patch.style_lanes) merged.style_lanes = { ...(base.style_lanes || {}), ...(patch.style_lanes || {}) }
  if (base.style_notes || patch.style_notes) merged.style_notes = { ...(base.style_notes || {}), ...(patch.style_notes || {}) }
  if (base.garment_intelligence || patch.garment_intelligence) {
    const b = base.garment_intelligence || {}
    const p = patch.garment_intelligence || {}
    merged.garment_intelligence = { ...b, ...p }
    for (const key of ['pairing_requirements', 'failure_risks', 'formula_compatibility', 'do_not_pair_rules']) {
      if (b[key] || p[key]) merged.garment_intelligence[key] = [...new Set([...normalizeStyleProfileList(b[key]), ...normalizeStyleProfileList(p[key])])]
    }
    if (b.real_wear_notes || p.real_wear_notes) merged.garment_intelligence.real_wear_notes = { ...(b.real_wear_notes || {}), ...(p.real_wear_notes || {}) }
    if (b.occasion_confidence || p.occasion_confidence) merged.garment_intelligence.occasion_confidence = { ...(b.occasion_confidence || {}), ...(p.occasion_confidence || {}) }
  }
  return merged
}

function localNormalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function dedupeMissingAgainstOwned(missingPieces = [], ownedPieces = []) {
  const ownedKeys = new Set(ownedPieces.map(p => `${localNormalizeForMatch(p.name)}|${localNormalizeForMatch(p.category)}`))
  const ownedNames = new Set(ownedPieces.map(p => localNormalizeForMatch(p.name)))
  const seen = new Set()
  const result = []
  for (const piece of missingPieces || []) {
    const nameKey = localNormalizeForMatch(piece?.name || '').replace(/ missing piece$/i, '').trim()
    const categoryKey = localNormalizeForMatch(piece?.category || '')
    const key = `${nameKey}|${categoryKey}`
    if (!nameKey) continue
    if (ownedNames.has(nameKey) || ownedKeys.has(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    result.push(piece)
  }
  return result
}

export function photoPreservingVisualsEnabled() {
  return String(process.env.PHOTO_PRESERVING_VISUALS || 'false').toLowerCase() === 'true'
}


// ============================================================================
// --- CONSOLIDATED WHOLE-WARDROBE STYLING LOGIC MOVED FROM FORKED Call Sites ---
// ============================================================================

export function outfitStylisticStrengthScore(outfit = {}, selectedPiece = null) {
  const text = [
    outfit.label,
    outfit.dominantDirection,
    outfit.silhouette,
    outfit.bestFor,
    outfit.reason,
    outfit.watchFor,
    ...(Array.isArray(outfit.pieces) ? outfit.pieces.map(p => p?.name || '') : [])
  ].join(' ').toLowerCase()
  let score = 0
  const add = (n, reason) => { score += n }

  if (/\b(dark column|column|graphic|contrast|structured|structure|architectural|gallery|modern minimal|clean & modern|clean and modern|earthy & structured|earthy and structured|artistic contrast|modern preppy|city minimal|black minimalist|monochrome chic|relaxed artistic|structured utility|slightly edgy)\b/.test(text)) add(22)
  if (/\b(black|charcoal|deep navy|espresso|chocolate|plum|olive|cognac|rust|terra.?cotta|ink navy)\b/.test(text)) add(9)
  if (/\b(pointed|loafer|loafers|ankle boot|boots|boot|structured bag|crossbody|long pendant|belt|blazer|utility|denim|jeans|cigarette|straight|pencil|midi|column skirt|dark denim|cuffed|cuff|mule|oxford)\b/.test(text)) add(10)
  if (/\b(tension|friction|sharp|grounded|edited|visual thesis|focal|directional|memorable|angular|asymmetry|asymmetric|attitude)\b/.test(text)) add(18)
  if (/\b(dark|black|charcoal|espresso|deep navy)\b/.test(text) && /\b(pointed|loafer|boot|structured|column|jeans|trouser)\b/.test(text)) add(10)

  if (/\b(luxe neutral|elevated casual|harmonious|harmony|flattering|elongating|draws attention upward|balanced silhouette|balance the body|confidence|comfortable chic|soft romantic|soft neutral|textured monochrome contrast|lightweight layered elegance|luxe neutral layering)\b/.test(text)) add(-34)
  if (/\b(librarian|catalog|mature|tasteful|polished neutral|sophisticated neutral|respectable|ladylike)\b/.test(text)) add(-30)
  if (/\b(cream stable slip-on|stable slip-on|soft shoe|light casual sneaker|rounded sneaker|beige|sand-colored|sand colored|cream slip-on|taupe slip-on|white architectural skirt|soft white skirt)\b/.test(text)) add(-18)
  if (/\b(soft)\b/.test(text) && !/\b(contrast|structure|structured|dark|black|charcoal|pointed|boot|loafer|graphic)\b/.test(text)) add(-18)
  if (/\b(cream|ivory|white|beige|taupe|sand|blush)\b/.test(text) && /\b(skirt|pant|trouser|shoe|sneaker|slip-on|flat)\b/.test(text) && !/\b(black|charcoal|deep navy|espresso|plum|cognac|rust|graphic|contrast|pointed|boot|structured|dark column)\b/.test(text)) add(-18)

  if (/\b(cream|beige|taupe|ivory|sand|blush)\b/.test(text) && !/\b(black|charcoal|espresso|plum|deep navy|graphic|contrast|pointed|boot|structured|dark column)\b/.test(text)) add(-14)
  if (/\b(skirt|pants|trouser)\b/.test(text) && !/\b(pointed|loafer|boot|black|structured|dark|cognac|sharp|grounded)\b/.test(text)) add(-8)

  if (!String(outfit.label || '').trim() || /^third wardrobe option|best wardrobe direction|relaxed structured variation|strongest wardrobe column$/i.test(String(outfit.label || '').trim())) add(-8)
  if (!String(outfit.dominantDirection || '').trim()) add(-6)
  if (!String(outfit.silhouette || '').trim()) add(-6)
  return score
}

export function sortByStylisticStrength(outfits = [], selectedPiece = null) {
  const strengthOrder = { signature: 8, strong: 5, usable: 2, experimental: 1 }
  return [...outfits].sort((a, b) => {
    const as = outfitStylisticStrengthScore(a, selectedPiece) + (strengthOrder[a?.strength] || 3)
    const bs = outfitStylisticStrengthScore(b, selectedPiece) + (strengthOrder[b?.strength] || 3)
    return bs - as
  }).map((o, index) => {
    const score = outfitStylisticStrengthScore(o, selectedPiece)
    const copy = { ...o }
    if (index === 0 && score >= 8) copy.strength = 'signature'
    else if (score < -15 && copy.strength === 'signature') copy.strength = 'usable'
    else if (score < -5 && copy.strength === 'strong') copy.strength = 'usable'
    return copy
  })
}

// `preserveAuthoredText` keeps a model's own label/description/reason when it wrote one, and falls
// back to the archetype template only when that text is missing, a placeholder, or generic — the
// same predicate repairWholeWardrobeOutfit already applies further down.
//
// Why this option exists (2026-08-16): the whole-wardrobe and capsule paths keep the model's own
// notes because advisor mode skips repair entirely, which is why their cards read in the model's
// voice and end with its skipped-directions and saveable-learning lines. The selected-piece path
// (routes/ai.js) repairs unconditionally, and repair's FIRST step called this function, which
// overwrote `reason` before the guard written to protect it could ever run. The template is meant
// to be the fallback, and on that path it had become the default: a live card paired a blouse and
// a tank with a lace midi dress and described it as "the dress carries the column" — the generated
// prose has no branch for a top alongside a dress, so it silently omitted the garment the person
// was being told to wear.
//
// The post-substitution call site deliberately does NOT preserve: once a piece has been swapped,
// the model's sentences describe an outfit that no longer exists.
export function rewriteWholeWardrobeOutfitWithArchetype(outfit = {}, candidatePieces = [], occasion = 'casual', { preserveAuthoredText = false } = {}) {
  const pieces = wholeWardrobeFullPieces(outfit, candidatePieces)
  const archetype = wholeWardrobeArchetypeFor({ ...outfit, pieces }, candidatePieces, occasion)
  const modifier = wholeWardrobeGarmentModifier(pieces)
  const label = archetype.labelSuggestion && modifier
    ? `${archetype.labelSuggestion}: ${modifier}`
    : archetype.labelSuggestion || wholeWardrobeLabelFromPieces({ ...outfit, pieces })
  const silhouetteVariant = wholeWardrobeSilhouetteFromPieces({ ...outfit, pieces })
  let silhouette = silhouetteVariant && silhouetteVariant !== archetype.direction
    ? silhouetteVariant
    : archetype.silhouette
  // docs/card-consistency-spec.md Part 2 (mechanical half). The archetype's own silhouette text is
  // a claim about shape, and it was being copied onto outfits that contradict it: every outfit
  // containing a dress is forced into `dress_grounded_sharp` (inferOutfitArchetype skips all other
  // archetypes when a dress is present), so a dress carrying two extra tops was still described as
  // a "one-piece column". Describe what is there, not what the archetype assumes.
  if (outfitLayersTopWithDress(pieces) && /\b(one[- ]piece|column|single garment)\b/i.test(String(silhouette || ''))) {
    const layerCount = pieces.filter(piece => wardrobeCategoryGroup(piece) === 'top').length
    silhouette = `dress layered with ${layerCount > 1 ? `${layerCount} additional tops` : 'an additional top'}`
  }
  const authored = field => {
    const value = String(outfit?.[field] || '').trim()
    if (!value) return null
    if (hasWholeWardrobePlaceholder(outfit) || hasGenericWholeWardrobeText(outfit)) return null
    return value
  }
  const keep = (field, generated) => (preserveAuthoredText ? (authored(field) ?? generated) : generated)
  return {
    ...outfit,
    archetypeId: archetype.archetypeId,
    formulaFamily: archetype.formulaFamily,
    label: keep('label', label),
    dominantDirection: keep('dominantDirection', archetype.direction),
    silhouette: keep('silhouette', silhouette),
    reason: keep('reason', buildOutfitMechanicsReason(outfit, pieces, archetype)),
    watchFor: keep('watchFor', wholeWardrobeWatchFromPieces({ ...outfit, pieces }))
  }
}

export function hasWholeWardrobePlaceholder(outfit = {}) {
  const text = [outfit.label, outfit.dominantDirection, outfit.silhouette, outfit.bestFor, outfit.reason, outfit.watchFor].join(' ').toLowerCase()
  return /\b(short style lane|one clear silhouette idea|short use case|whole wardrobe outfit|strong wardrobe outfit|complete wardrobe formula|locally ranked wardrobe composition)\b/.test(text)
}

export function hasGenericWholeWardrobeText(outfit = {}) {
  const text = [outfit.reason, outfit.watchFor].join(' ').toLowerCase()
  return /\b(balances artfulness with modernity|playful touch|overall look|creates an artistic visual|refined silhouette|visual balance|contrasts well|modern artistic element|clean silhouette|may overwhelm the look|potential boxiness|ensure the playful elements do not overwhelm)\b/.test(text)
}

export function repairWholeWardrobeOutfit(outfit = {}, candidatePieces = [], occasion = 'casual', mood = '', options = {}) {
  // Nothing has been changed yet, so anything the model wrote still describes this exact outfit.
  // Keep its words; the archetype template fills only what it left empty or generic.
  const repaired = rewriteWholeWardrobeOutfitWithArchetype({ ...outfit }, candidatePieces, occasion, { preserveAuthoredText: true })

  // Footwear gate & repair
  const occasionProfile = resolveOccasionProfile(occasion, mood)
  const activityProfile = resolveActivityProfile({
    activity: options.activity,
    occasion,
    mood,
    request: options.request || options.question || ''
  })
  const requiredFootwear = [
    ...(occasionProfile?.rules?.required_footwear || []),
    ...(activityProfile?.rules?.required_footwear || [])
  ]

  if (requiredFootwear.length > 0) {
    const pieces = wholeWardrobeFullPieces(repaired, candidatePieces)
    const currentShoe = pieces.find(p => p.category === 'shoes' || wardrobeCategoryGroup(p) === 'shoes')
    if (currentShoe) {
      const isTrailRated = requiredFootwear.some(fw => pieceMatchesFootwear(currentShoe, fw))
      if (!isTrailRated) {
        const weatherProfile = options.weatherProfile || weatherProfileFromContext({ mood, season: options.season })
        const recoveryEligibility = evaluateAutomaticUsePiecePoolCore({
          pieces: candidatePieces,
          context: { occasion, season: options.season, weatherProfile, mood, activity: options.activity },
          policy: { hotOuterwearCap: 3 },
          decidePiece: wholeWardrobePieceTrustDecision,
        })
        const allowedPieces = recoveryEligibility.eligiblePieces
        
        const getShoeRelevance = (shoe) => {
          let score = pieceOccasionScore(shoe, occasion)
          const preferredFootwear = [
            ...(occasionProfile?.rules?.preferred_footwear || []),
            ...(activityProfile?.rules?.preferred_footwear || [])
          ]
          const discouragedFootwear = [
            ...(occasionProfile?.rules?.discouraged_footwear || []),
            ...(activityProfile?.rules?.discouraged_footwear || []),
            ...(weatherProfile.isHot && occasionProfile?.rules?.discouraged_footwear_summer ? occasionProfile.rules.discouraged_footwear_summer : []),
            ...(weatherProfile.isHot && activityProfile?.rules?.discouraged_footwear_summer ? activityProfile.rules.discouraged_footwear_summer : []),
            ...(weatherProfile.isHot && occasionProfile?.rules?.discouraged_footwear_warm ? occasionProfile.rules.discouraged_footwear_warm : []),
            ...(weatherProfile.isHot && activityProfile?.rules?.discouraged_footwear_warm ? activityProfile.rules.discouraged_footwear_warm : [])
          ]
          for (const fw of preferredFootwear) {
            if (pieceMatchesFootwear(shoe, fw)) {
              score += 10
              break
            }
          }
          for (const fw of discouragedFootwear) {
            if (pieceMatchesFootwear(shoe, fw)) {
              score -= 10
              break
            }
          }
          const discouragedMaterials = [
            ...(occasionProfile?.rules?.discouraged_materials || []),
            ...(activityProfile?.rules?.discouraged_materials || [])
          ]
          for (const mat of discouragedMaterials) {
            if (pieceMatchesMaterial(shoe, mat)) {
              score -= 8
              break
            }
          }
          return score
        }
        
        const candidateShoes = allowedPieces.filter(p => {
          if (p.category !== 'shoes' && wardrobeCategoryGroup(p) !== 'shoes') return false
          return requiredFootwear.some(fw => pieceMatchesFootwear(p, fw))
        })
        
        if (candidateShoes.length > 0) {
          candidateShoes.sort((a, b) => {
            const scoreA = getShoeRelevance(a)
            const scoreB = getShoeRelevance(b)
            if (scoreA !== scoreB) return scoreB - scoreA
            return a.id - b.id
          })
          const substitution = validatedSubstitute({
            subject: repaired,
            target: currentShoe,
            candidates: candidateShoes,
            mutate: (currentOutfit, bestShoe) => ({
              ...currentOutfit,
              pieceIds: Array.isArray(currentOutfit.pieceIds)
                ? currentOutfit.pieceIds.map(id => Number(id) === Number(currentShoe.id) ? Number(bestShoe.id) : Number(id))
                : currentOutfit.pieceIds,
              pieces: Array.isArray(currentOutfit.pieces)
                ? currentOutfit.pieces.map(piece => Number(piece.id) === Number(currentShoe.id) ? bestShoe : piece)
                : currentOutfit.pieces,
            }),
            validate: trial => evaluateWearableOutfit(wholeWardrobeFullPieces(trial, candidatePieces), { requireShoes: true }),
            context: { flow: 'whole_wardrobe', reason: 'required_footwear' },
          })
          if (substitution.status === 'recovered') {
            const updatedRepaired = rewriteWholeWardrobeOutfitWithArchetype(substitution.value, candidatePieces, occasion)
            Object.assign(repaired, updatedRepaired)
          } else {
            const warning = "footwear is not trail-rated — closest available match."
            if (!repaired.watchFor || repaired.watchFor === 'none') repaired.watchFor = warning
            else if (!repaired.watchFor.includes(warning)) repaired.watchFor = `${repaired.watchFor}; ${warning}`
          }
        } else {
          const warning = "footwear is not trail-rated — closest available match."
          if (!repaired.watchFor || repaired.watchFor === 'none') {
            repaired.watchFor = warning
          } else if (!repaired.watchFor.includes(warning)) {
            repaired.watchFor = `${repaired.watchFor}; ${warning}`
          }
        }
      }
    }
  }
  if (hasWholeWardrobePlaceholder(repaired) || !String(repaired.label || '').trim()) repaired.label = wholeWardrobeLabelFromPieces(repaired)
  const repairedArchetype = wholeWardrobeArchetypeFor(repaired, candidatePieces, occasion)
  if (hasWholeWardrobePlaceholder(repaired) || String(repaired.dominantDirection || '').trim() === String(repaired.silhouette || '').trim()) repaired.dominantDirection = repairedArchetype.direction || ''
  if (hasWholeWardrobePlaceholder(repaired) || String(repaired.dominantDirection || '').trim() === String(repaired.silhouette || '').trim()) repaired.silhouette = repairedArchetype.silhouette || ''
  if (hasWholeWardrobePlaceholder(repaired) || !String(repaired.bestFor || '').trim()) repaired.bestFor = 'right-now wardrobe dressing'
  if (hasWholeWardrobePlaceholder(repaired) || hasGenericWholeWardrobeText(repaired) || !String(repaired.reason || '').trim()) repaired.reason = buildOutfitMechanicsReason(repaired, wholeWardrobeFullPieces(repaired, candidatePieces), repairedArchetype)
  if (hasWholeWardrobePlaceholder(repaired) || hasGenericWholeWardrobeText(repaired) || !String(repaired.watchFor || '').trim() || /^none$/i.test(String(repaired.watchFor || '').trim())) repaired.watchFor = wholeWardrobeWatchFromPieces(repaired)
  const moodProfile = wholeWardrobeMoodProfile(mood)
  if (moodProfile?.id === 'modern_bohemian_restraint') {
    const pieces = wholeWardrobeFullPieces(repaired, candidatePieces)
    if (wholeWardrobeBohoSignalScore(pieces) >= 2) {
      repaired.pieces = pieces
      repaired.label = bohoMoodLabelFromPieces(repaired)
      repaired.dominantDirection = 'modern bohemian restraint with city grounding'
      repaired.silhouette = wholeWardrobeSilhouetteFromPieces(repaired)
      repaired.reason = buildBohoOutfitReason(repaired, pieces, occasion)
      repaired.watchFor = buildBohoWatch(repaired, pieces)
    }
  }
  return repaired
}

export function wholeWardrobeDiversitySelectionScore(outfit, selected, options = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const top = wholeWardrobePieceByGroup(outfit, 'top')
  const bottom = wholeWardrobePieceByGroup(outfit, 'bottom')
  const shoe = wholeWardrobePieceByGroup(outfit, 'shoes')
  const formula = wholeWardrobeFormulaFamily(outfit, options.candidatePieces, options.occasion)
  const silhouetteFamily = wholeWardrobeSilhouetteFromPieces(outfit)
  const grounding = wholeWardrobeGroundingStrategy(outfit)
  const shoeShape = wholeWardrobeShoeShape(outfit)
  const rhythm = wholeWardrobeVisualRhythm(outfit)
  let score = outfitStylisticStrengthScore(outfit, null) + (Number(outfit.localScore) || 0) * 0.25 + (Number(outfit.archetypeScore) || 0)
  const countPiece = (groupPiece) => groupPiece
    ? selected.filter(existing => (existing.pieces || []).some(p => Number(p.id) === Number(groupPiece.id))).length
    : 0
  const sameTopCount = countPiece(top)
  const sameBottomCount = countPiece(bottom)
  const sameShoeCount = countPiece(shoe)
  const sameFormulaCount = selected.filter(existing => wholeWardrobeFormulaFamily(existing, options.candidatePieces, options.occasion) === formula).length
  const sameSilhouetteCount = selected.filter(existing => wholeWardrobeSilhouetteFromPieces(existing) === silhouetteFamily).length
  const sameGroundingCount = selected.filter(existing => wholeWardrobeGroundingStrategy(existing) === grounding).length
  const sameShoeShapeCount = selected.filter(existing => wholeWardrobeShoeShape(existing) === shoeShape).length
  const sameRhythmCount = selected.filter(existing => wholeWardrobeVisualRhythm(existing) === rhythm).length
  const printFormulaCount = wholeWardrobeHasPrintOrStripe(outfit)
    ? selected.filter(existing => wholeWardrobeHasPrintOrStripe(existing)).length
    : 0

  if (sameTopCount >= 1) score -= 40 * sameTopCount
  if (sameBottomCount >= 1) score -= 20 * sameBottomCount
  if (sameShoeCount >= 1) score -= 20 * sameShoeCount
  if (sameSilhouetteCount >= 1) score -= 35 * sameSilhouetteCount
  if (sameGroundingCount >= 1) score -= 18 * sameGroundingCount
  if (sameShoeShapeCount >= 1) score -= 14 * sameShoeShapeCount
  if (sameRhythmCount >= 1) score -= 16 * sameRhythmCount
  if (printFormulaCount >= 1) score -= 20 * printFormulaCount
  if (sameFormulaCount >= 1) score -= 45 * sameFormulaCount
  if (formula === 'compact_top_dark_column' && sameFormulaCount >= 1) score -= 25
  const moodProfile = wholeWardrobeMoodProfile(options.mood)
  if (moodProfile?.id === 'modern_bohemian_restraint') {
    const bohoSignal = wholeWardrobeBohoSignalScore(pieces)
    if (bohoSignal >= 4) score += 24
    else if (bohoSignal >= 2) score += 12
    else score -= 45
  }
  return score
}

export function bestWholeWardrobeRequirementCandidate(pool, selected, predicate, options = {}) {
  const selectedKeys = new Set(selected.map(o => (o.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')))
  return pool
    .filter(outfit => predicate(outfit))
    .filter(outfit => !selectedKeys.has((outfit.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')))
    .sort((a, b) => wholeWardrobeDiversitySelectionScore(b, selected, options) - wholeWardrobeDiversitySelectionScore(a, selected, options))[0] || null
}

export function applyWholeWardrobeDiversity(outfits = [], limit = 5, options = {}) {
  const selected = []
  const rejected = []
  const topUse = new Map()
  const bottomUse = new Map()
  const shoeUse = new Map()
  const heroUse = new Map()
  const formulaUse = new Map()
  const silhouetteUse = new Map()
  const groundingUse = new Map()
  const shoeShapeUse = new Map()
  const rhythmUse = new Map()
  const topBottomUse = new Set()
  const pool = [...outfits]
  const formulaFor = (outfit) => wholeWardrobeFormulaFamily(outfit, options.candidatePieces, options.occasion)
  const hasUnusedAlternativeFormula = (formula) => pool.some(candidate => {
    const key = (candidate.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')
    if (selected.some(existing => (existing.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|') === key)) return false
    return formulaFor(candidate) !== formula
  })
  const exploratoryFamilies = new Set(['dress_grounding_shoe', 'soft_piece_structured_anchor', 'earthy_structured_separates'])
  const exploratory = bestWholeWardrobeRequirementCandidate(
    pool,
    selected,
    outfit => exploratoryFamilies.has(formulaFor(outfit)) || wholeWardrobeIsExploratory(outfit),
    options
  )
  if (exploratory) {
    selected.push(exploratory)
    const pieces = Array.isArray(exploratory.pieces) ? exploratory.pieces : []
    const top = pieces.find(p => wardrobeCategoryGroup(p) === 'top')
    const bottom = pieces.find(p => wardrobeCategoryGroup(p) === 'bottom')
    const shoe = pieces.find(p => wardrobeCategoryGroup(p) === 'shoes')
    const heroId = wholeWardrobeHeroPieceId(exploratory)
    const formula = formulaFor(exploratory)
    const silhouetteFamily = wholeWardrobeSilhouetteFromPieces(exploratory)
    const grounding = wholeWardrobeGroundingStrategy(exploratory)
    const shoeShape = wholeWardrobeShoeShape(exploratory)
    const rhythm = wholeWardrobeVisualRhythm(exploratory)
    const topBottomKey = wholeWardrobeTopBottomKey(exploratory)
    if (top) topUse.set(Number(top.id), 1)
    if (bottom) bottomUse.set(Number(bottom.id), 1)
    if (shoe) shoeUse.set(Number(shoe.id), 1)
    if (heroId) heroUse.set(heroId, 1)
    formulaUse.set(formula, 1)
    silhouetteUse.set(silhouetteFamily, 1)
    groundingUse.set(grounding, 1)
    shoeShapeUse.set(shoeShape, 1)
    rhythmUse.set(rhythm, 1)
    if (topBottomKey) topBottomUse.add(topBottomKey)
  }
  while (pool.length && selected.length < limit) {
    pool.sort((a, b) => wholeWardrobeDiversitySelectionScore(b, selected, options) - wholeWardrobeDiversitySelectionScore(a, selected, options))
    const outfit = pool.shift()
    const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
    const top = pieces.find(p => wardrobeCategoryGroup(p) === 'top')
    const bottom = pieces.find(p => wardrobeCategoryGroup(p) === 'bottom')
    const shoe = pieces.find(p => wardrobeCategoryGroup(p) === 'shoes')
    const heroId = wholeWardrobeHeroPieceId(outfit)
    const formula = formulaFor(outfit)
    const silhouetteFamily = wholeWardrobeSilhouetteFromPieces(outfit)
    const grounding = wholeWardrobeGroundingStrategy(outfit)
    const shoeShape = wholeWardrobeShoeShape(outfit)
    const rhythm = wholeWardrobeVisualRhythm(outfit)
    const topBottomKey = wholeWardrobeTopBottomKey(outfit)
    const outfitKey = (outfit.pieceIds || pieces.map(p => p.id)).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')
    if (selected.some(existing => (existing.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|') === outfitKey)) continue
    const topCount = top ? (topUse.get(Number(top.id)) || 0) : 0
    const bottomCount = bottom ? (bottomUse.get(Number(bottom.id)) || 0) : 0
    const shoeCount = shoe ? (shoeUse.get(Number(shoe.id)) || 0) : 0
    const heroCount = heroId ? (heroUse.get(heroId) || 0) : 0
    const formulaCount = formulaUse.get(formula) || 0
    const silhouetteCount = silhouetteUse.get(silhouetteFamily) || 0
    const groundingCount = groundingUse.get(grounding) || 0
    const shoeShapeCount = shoeShapeUse.get(shoeShape) || 0
    const rhythmCount = rhythmUse.get(rhythm) || 0
    if (top && topCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `too many outfits use ${top.name}` })
      continue
    }
    if (bottom && bottomCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `too many outfits use ${bottom.name}` })
      continue
    }
    if (topBottomKey && topBottomUse.has(topBottomKey)) {
      rejected.push({ label: outfit.label || 'unnamed', reason: 'exact top+bottom formula already used' })
      continue
    }
    if (heroId && heroCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: 'hero garment used more than twice' })
      continue
    }
    if (formula === 'compact_top_dark_column' && formulaCount >= 1 && hasUnusedAlternativeFormula(formula)) {
      rejected.push({ label: outfit.label || 'unnamed', reason: 'compact-top dark-column slot already used' })
      continue
    }
    if (formulaCount >= 1 && hasUnusedAlternativeFormula(formula)) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `duplicate ${formula} formula` })
      continue
    }
    if (silhouetteCount >= 1 && selected.length >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `duplicate ${silhouetteFamily} silhouette` })
      continue
    }
    if (groundingCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `too much ${grounding}` })
      continue
    }
    if (shoeShapeCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `too many ${shoeShape} shoes` })
      continue
    }
    if (rhythmCount >= 1 && selected.length >= 3) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `duplicate ${rhythm}` })
      continue
    }
    selected.push(outfit)
    if (top) topUse.set(Number(top.id), topCount + 1)
    if (bottom) bottomUse.set(Number(bottom.id), bottomCount + 1)
    if (shoe) shoeUse.set(Number(shoe.id), shoeCount + 1)
    if (heroId) heroUse.set(heroId, heroCount + 1)
    formulaUse.set(formula, formulaCount + 1)
    silhouetteUse.set(silhouetteFamily, silhouetteCount + 1)
    groundingUse.set(grounding, groundingCount + 1)
    shoeShapeUse.set(shoeShape, shoeShapeCount + 1)
    rhythmUse.set(rhythm, rhythmCount + 1)
    if (topBottomKey) topBottomUse.add(topBottomKey)
  }

  if (options.requireDress && !selected.some(wholeWardrobeHasDress)) {
    const dressCandidate = bestWholeWardrobeRequirementCandidate(outfits, selected, wholeWardrobeHasDress, options)
    if (dressCandidate) {
      const replaceIndex = selected.length >= limit ? selected.length - 1 : selected.length
      if (selected[replaceIndex]) rejected.push({ label: selected[replaceIndex].label || 'unnamed', reason: 'replaced to include a dress formula' })
      selected[replaceIndex] = dressCandidate
    }
  }

  if (options.requireNonGraphicTop && !selected.some(wholeWardrobeHasNonGraphicTop)) {
    const plainTopCandidate = bestWholeWardrobeRequirementCandidate(outfits, selected, wholeWardrobeHasNonGraphicTop, options)
    if (plainTopCandidate) {
      const replaceIndex = selected.length >= limit ? selected.length - 1 : selected.length
      if (selected[replaceIndex]) rejected.push({ label: selected[replaceIndex].label || 'unnamed', reason: 'replaced to include a non-graphic top formula' })
      selected[replaceIndex] = plainTopCandidate
    }
  }

  const targetFormulaCount = Math.min(3, limit, selected.length)
  let formulaDiversityAttempts = 0
  while (new Set(selected.map(formulaFor)).size < targetFormulaCount && formulaDiversityAttempts < limit * 3) {
    formulaDiversityAttempts += 1
    const usedFamilies = new Set(selected.map(formulaFor))
    const candidate = bestWholeWardrobeRequirementCandidate(
      outfits,
      selected,
      outfit => !usedFamilies.has(formulaFor(outfit)),
      options
    )
    if (!candidate) break
    const replaceIndex = selected
      .map((outfit, index) => ({ outfit, index, count: selected.filter(o => formulaFor(o) === formulaFor(outfit)).length }))
      .filter(item => item.count > 1 || formulaFor(item.outfit) === 'compact_top_dark_column')
      .sort((a, b) => wholeWardrobeDiversitySelectionScore(a.outfit, selected.filter((_, i) => i !== a.index), options) - wholeWardrobeDiversitySelectionScore(b.outfit, selected.filter((_, i) => i !== b.index), options))[0]?.index
    const targetIndex = Number.isInteger(replaceIndex) ? replaceIndex : selected.length - 1
    rejected.push({ label: selected[targetIndex]?.label || 'unnamed', reason: `replaced to include ${formulaFor(candidate)} formula` })
    selected[targetIndex] = candidate
  }

  return { outfits: selected, rejected }
}
// docs/card-consistency-spec.md Part 1. A top worn with a dress is a legitimate styling decision
// (owner ruling 2026-08-16) and is deliberately NOT taste-gated — evaluateWearableOutfit still permits
// it. But it is an unusual enough choice that the card has to account for it: a live response
// paired a blouse and a floral tank with a lace midi dress and explained neither.
//
// Structural fact only: category groups, no keywords, no text classification.
export function outfitLayersTopWithDress(pieces = []) {
  const groups = (Array.isArray(pieces) ? pieces : []).map(p => wardrobeCategoryGroup(p))
  return groups.includes('dress') && groups.includes('top')
}

// Returns the tops a dress outfit's own prose never mentions. Deliberately weak: a substring match
// on a piece name we already know is in the card, in the spirit of findZeroResultContradiction —
// checking a known fact, not fact-checking prose. It cannot judge whether the explanation is any
// good; that is taste, and taste belongs to the model. It only enforces that the choice was
// accounted for. A false positive costs one retry; the miss costs an unexplained garment.
export function unexplainedLayeredTops(outfit = {}, pieces = []) {
  const resolved = Array.isArray(pieces) && pieces.length ? pieces : (outfit.pieces || [])
  if (!outfitLayersTopWithDress(resolved)) return []
  const prose = [outfit.reason, outfit.why, outfit.stylingInstructions, outfit.watchFor]
    .filter(Boolean).join(' ').toLowerCase()
  if (!prose.trim()) return resolved.filter(p => wardrobeCategoryGroup(p) === 'top')
  const words = piece => String(piece?.name || '').toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean)
  return resolved.filter(piece => {
    if (wardrobeCategoryGroup(piece) !== 'top') return false
    const name = String(piece?.name || '').toLowerCase().trim()
    if (!name) return false
    if (prose.includes(name)) return false
    // A distinctive word counts as naming the piece — "the blouson smooths the line" is not silence
    // about "black blouson v-neck top". But a word shared with another garment in the SAME outfit
    // cannot distinguish it: "black blouson v-neck top" beside "black brown lace floral midi dress"
    // both contain "black", and prose about the dress would otherwise read as prose about the top.
    // That false negative is exactly the live case this check exists to catch.
    const others = new Set(resolved.filter(other => Number(other?.id) !== Number(piece?.id)).flatMap(words))
    const distinctive = words(piece).filter(word =>
      word.length >= 4 && !GENERIC_GARMENT_WORDS.has(word) && !others.has(word))
    return !distinctive.some(word => prose.includes(word))
  })
}

const GENERIC_GARMENT_WORDS = new Set([
  'top', 'tops', 'sleeve', 'sleeves', 'sleeveless', 'short', 'shorts', 'long',
  'print', 'printed', 'color', 'colour', 'light', 'dark', 'with', 'this', 'that'
])

export const LAYERED_TOP_UNEXPLAINED_FLAG =
  'This look layers a top with the dress and the stylist did not say why — treat the top as optional.'

export function normalizeWholeWardrobeStrengths(outfits = []) {
  return outfits.map((outfit, index) => ({
    ...outfit,
    strength: index === 0 ? 'signature' : (index <= 2 ? 'strong' : 'usable')
  }))
}

function appendSystemFlag(outfit = {}, type = 'note', message = '') {
  if (!message) return outfit
  const systemFlags = Array.isArray(outfit.systemFlags) ? [...outfit.systemFlags] : []
  if (!systemFlags.some(flag => flag.type === type && flag.message === message)) {
    systemFlags.push({ type, message })
  }
  return { ...outfit, systemFlags }
}

function scrubBodyShapeFraming(text = '') {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .filter(sentence => !/\b(flattering|elongating|slimming|confidence|draws attention upward|balance the body)\b/i.test(sentence))
    .join(' ')
    .trim()
}

function pieceExcludedForOccasion(piece = {}, occasion = '') {
  const requested = String(occasion || '').toLowerCase().replace(/[-_]+/g, ' ').trim()
  if (!requested) return false
  return (Array.isArray(piece.occasion_exclusions) ? piece.occasion_exclusions : [])
    .map(value => String(value || '').toLowerCase().replace(/[-_]+/g, ' ').trim())
    .includes(requested)
}

export function locallyGateWholeWardrobeOutfits(outfits = [], limit = 5, { mode = 'gate', requireShoes = true, requireDress = false, requireNonGraphicTop = false, rejectProfileDiscouraged = false, applyDiversity = true, repair = undefined, candidatePieces = [], occasion = 'casual', mood = '', season = '', weatherProfile = null, activity = '', sessionInfluence = null, request = '', question = '' } = {}) {
  const advisorMode = mode === 'advisor'
  const seen = new Set()
  const accepted = []
  const rejected = []
  const reject = (outfit, reason) => {
    rejected.push({ label: outfit?.label || 'unnamed', reason, outfit })
  }
  const resolvedWeatherProfile = weatherProfile || weatherProfileFromContext({ mood, season })
  const occasionProfile = resolveOccasionProfile(occasion, mood)
  const activityProfile = resolveActivityProfile({ activity, occasion, mood })
  const mergedRules = getMergedProfileRules(occasionProfile, activityProfile)
  // Spec 8: this was the one direct profileRuleFit call in the codebase that didn't go through
  // wholeWardrobePieceTrustDecision and had no register-ceiling/footwear-enum awareness at all — the
  // final gate an outfit passes through in the /ask precompose fallback tier and trip-slot ranking
  // before shipping. Resolved the same way buildVisualComposerRoster resolves it.
  const registerCeiling = resolveRegisterCeiling({ occasion, activity, mood, request, occasionProfile, activityProfile })
  const candidatePieceById = new Map((candidatePieces || []).map(piece => [Number(piece.id), piece]))
  const ownedIds = new Set(candidatePieceById.keys())
  // Spec 9: repair defaults to running whenever NOT in advisor mode (original behavior), but a
  // caller can force it on even in advisor mode via options.repair — for locally-generated candidate
  // outfits (trip-slot ranking, the /ask fallback tier), where there's no LLM composition to preserve,
  // so a mechanical slot-fill isn't "reinventing" anything the way it would be for a model's own
  // outfit. Composer callers (LLM-proposed outfits) don't pass this, so their repair-skip is unchanged.
  const shouldRepair = repair !== undefined ? repair : !advisorMode
  for (const outfit of outfits) {
    let repaired = shouldRepair
      ? repairWholeWardrobeOutfit(outfit, candidatePieces, occasion, mood, { season, weatherProfile: resolvedWeatherProfile, activity })
      : { ...outfit }
    // Spec 29 Part 1: normalizeWholeWardrobeOutfitObject trims outfit.pieces to
    // {id, name, category, photo, worn_photo} before this function ever sees them, so every
    // structured gate below (registerCeilingVerdict, footwearComfortVerdict, prohibited-material/
    // footwear checks via profileRuleFit) would otherwise read undefined and silently degrade to
    // name-text matching. Rehydrate against candidatePieces by id before any gate runs; this is
    // purely a local computation variable — repaired.pieces (the response shape) is untouched.
    const trimmedPieces = Array.isArray(repaired?.pieces) ? repaired.pieces : []
    const pieces = trimmedPieces.map(piece => candidatePieceById.get(Number(piece?.id)) || piece)
    const pieceIds = pieces.map(piece => Number(piece.id)).filter(Boolean)
    const text = [repaired.label, repaired.dominantDirection, repaired.silhouette, repaired.reason, repaired.watchFor, ...pieces.map(p => p.name)].join(' ').toLowerCase()
    const key = (repaired.pieceIds || pieceIds).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')

    const validation = evaluateWearableOutfit(pieces, { requireShoes })
    if (!validation.hardValid) {
      reject(repaired, validation.primaryFinding?.message || 'not a complete wardrobe outfit')
      continue
    }
    if (ownedIds.size && pieceIds.some(id => !ownedIds.has(id))) {
      reject(repaired, 'contains non-owned piece')
      continue
    }
    if (pieces.some(piece => pieceExcludedForOccasion(piece, occasion))) {
      reject(repaired, `user-excluded for ${occasion}`)
      continue
    }
    if (seen.has(key)) {
      reject(repaired, 'duplicate formula')
      continue
    }
    // docs/card-consistency-spec.md Part 1, terminal case. A top with a dress is a legitimate
    // styling choice and is never removed here — that would be code censoring the composer, which
    // Decision B (owner, 2026-06-25) ruled against and which advisor mode exists to prevent. If the
    // card's own words do not account for the top, the card ships with the top and says so.
    const unexplainedTops = unexplainedLayeredTops(repaired, wholeWardrobeFullPieces(repaired, candidatePieces))
    if (unexplainedTops.length) {
      repaired = appendSystemFlag(repaired, 'layering', LAYERED_TOP_UNEXPLAINED_FLAG)
    }
    if (/\b(flattering|elongating|slimming|confidence|draws attention upward|balance the body)\b/.test(text)) {
      if (advisorMode) {
        repaired = appendSystemFlag(repaired, 'language', 'Removed body-shape framing from the explanation; review the outfit visually.')
        const scrubbedReason = scrubBodyShapeFraming(repaired.reason)
        if (scrubbedReason) repaired.reason = scrubbedReason
      } else {
        reject(repaired, 'uses body-shape/flattery framing')
        continue
      }
    }
    if (wholeWardrobeMissesMood(repaired, mood)) {
      if (advisorMode) {
        repaired = appendSystemFlag(repaired, 'mood', 'May miss the requested mood; compare against the garment photos.')
      } else {
        reject(repaired, 'misses requested boho mood')
        continue
      }
    }
    if ((text.match(/\b(wide|wide-leg|oversized|loose|flowing|voluminous|relaxed)\b/g) || []).length >= 3) {
      if (advisorMode) {
        repaired = appendSystemFlag(repaired, 'proportion', 'Reads volume-heavy; check that one piece anchors the outfit.')
      } else {
        reject(repaired, 'too much width/volume')
        continue
      }
    }
    if ((text.match(/\b(soft|gauzy|drape|drapey|cream|ivory|beige|taupe|sand)\b/g) || []).length >= 5 && !/\b(black|charcoal|espresso|boot|loafer|pointed|structured|graphic)\b/.test(text)) {
      if (advisorMode) {
        repaired = appendSystemFlag(repaired, 'contrast', 'Soft neutral read; check whether it has enough grounding in the photos.')
      } else {
        reject(repaired, 'soft neutral drift')
        continue
      }
    }

    const profileFits = pieces.map(piece => profileRuleFit(piece, mergedRules, { weatherProfile: resolvedWeatherProfile, occasionProfile, activityProfile, registerCeiling }))
    const prohibitedFit = profileFits.find(fit => fit.tier === 'prohibited')
    if (prohibitedFit) {
      if (advisorMode) {
        repaired = appendSystemFlag(repaired, 'occasion', prohibitedFit.reason || 'May conflict with this occasion profile.')
      } else {
        reject(repaired, prohibitedFit.reason || prohibitedFit.label || 'profile-prohibited piece')
        continue
      }
    }
    // Spec 8: an enum-gated piece with no heel_height/walk_support/formality tagged resolves to
    // 'unknown', not 'prohibited' or 'discouraged' — without this, that signal silently vanished
    // (buildVisualComposerRoster already excludes+flags 'unknown' the same way; this matches it,
    // per the project's flag-not-guess convention rather than letting untagged data pass silently).
    const unknownFit = !prohibitedFit && profileFits.find(fit => fit.tier === 'unknown')
    if (unknownFit) {
      if (advisorMode) {
        repaired = appendSystemFlag(repaired, 'occasion', `Not yet tagged for this gate (${unknownFit.label}) — verify manually.`)
      } else {
        reject(repaired, unknownFit.label || 'gate metadata not tagged')
        continue
      }
    }
    const discouragedProfileCount = profileFits.filter(fit => fit.tier === 'discouraged').length
    if (rejectProfileDiscouraged && discouragedProfileCount) {
      if (advisorMode) {
        repaired = appendSystemFlag(repaired, 'occasion', 'Contains a piece the occasion/activity profile usually discourages.')
      } else {
        reject(repaired, 'profile-discouraged piece')
        continue
      }
    }
    const profileAdjusted = discouragedProfileCount
      ? { ...repaired, localScore: (Number(repaired.localScore) || 0) - discouragedProfileCount * 16 }
      : repaired
    const recencyPiecePenalty = sessionInfluence?.pieceRecency
      ? pieceIds.reduce((sum, id) => sum + (sessionInfluence.pieceRecency.get(id) || 0), 0)
      : 0
    const formulaFamily = profileAdjusted.formulaFamily || wholeWardrobeFormulaFamily(profileAdjusted, pieces, occasion)
    const recencyFormulaPenalty = sessionInfluence?.formulaRecency?.get(formulaFamily) || 0
    const recencyAdjusted = (recencyPiecePenalty || recencyFormulaPenalty)
      ? {
          ...profileAdjusted,
          formulaFamily,
          localScore: (Number(profileAdjusted.localScore) || 0) - Math.min(recencyPiecePenalty, 40) - Math.min(recencyFormulaPenalty, 35)
        }
      : profileAdjusted

    seen.add(key)
    accepted.push(recencyAdjusted)
  }
  const ranked = advisorMode ? accepted : sortByStylisticStrength(accepted, null)
  const diverse = applyDiversity
    ? applyWholeWardrobeDiversity(ranked, limit, { requireDress, requireNonGraphicTop, candidatePieces, occasion, mood })
    : { outfits: ranked.slice(0, limit), rejected: [] }
  return {
    outfits: normalizeWholeWardrobeStrengths(diverse.outfits),
    rejected: [...rejected, ...diverse.rejected]
  }
}

export function formatWholeWardrobeOutfitFeedback({ occasion, season, mood, outfits = [], skip = '', saveableLearning = '' }) {
  const lines = [
    `**Generated strongest wardrobe outfits**`,
    `**Occasion / season:** ${occasion || 'casual'} / ${season || 'current season'}`,
    mood ? `**Mood:** ${mood}` : '',
    ''
  ].filter(Boolean)
  outfits.forEach((outfit, index) => {
    lines.push(`**${index === 0 || outfit.strength === 'signature' ? 'Signature / strongest outfit' : outfit.label || `Outfit ${index + 1}`}**`)
    if (outfit.missionLabel) lines.push(`Mission: ${outfit.missionLabel}`)
    if (outfit.label) lines.push(`Label: ${outfit.label}`)
    if (outfit.strength) lines.push(`Strength: ${outfit.strength}`)
    if (outfit.dominantDirection) lines.push(`Direction: ${outfit.dominantDirection}`)
    if (outfit.silhouette) lines.push(`Silhouette: ${outfit.silhouette}`)
    if (outfit.bestFor) lines.push(`Best for: ${outfit.bestFor}`)
    const pieces = Array.isArray(outfit.pieces) ? outfit.pieces.map(p => p?.name).filter(Boolean).join(' + ') : ''
    if (pieces) lines.push(`Pieces: ${pieces}`)
    const missing = Array.isArray(outfit.missingPieces) ? outfit.missingPieces.map(p => p?.name || p).filter(Boolean).join(' + ') : ''
    if (missing) lines.push(`Missing pieces: ${missing}`)
    if (outfit.reason) lines.push(`Why this works: ${outfit.reason}`)
    if (outfit.watchFor && outfit.watchFor !== 'none') lines.push(`Watch for: ${outfit.watchFor}`)
    lines.push('')
  })
  if (skip) {
    lines.push(`*Skipped directions:* ${skip}`)
    lines.push('')
  }
  if (saveableLearning) {
    lines.push(`**Saveable learning:** ${saveableLearning}`)
  }
  return lines.join('\n').trim()
}

export function buildOutfitMechanicsReason(outfit = {}, pieces = [], archetype = {}) {
  const byGroup = (group) => pieces.find(p => wardrobeCategoryGroup(p) === group)
  const top = byGroup('top')
  const bottom = byGroup('bottom')
  const dress = byGroup('dress')
  const shoe = byGroup('shoes')
  const layer = byGroup('outerwear')
  const printPiece = pieces.find(p => /\b(floral|print|graphic|stripe|pattern|abstract|tapestry)\b/.test(pieceNameBlob(p)))
  const softPiece = pieces.find(p => /\b(soft|gauzy|drape|linen|cashmere|knit|cream|ivory|oatmeal)\b/.test(pieceNameBlob(p)))
  const shoeText = shoe ? pieceNameBlob(shoe) : ''
  const sentences = []

  if (dress) {
    const support = layer ? `${layer.name} adds the structure around it` : shoe ? `${shoe.name} gives the one-piece line a grounded finish` : 'the supporting pieces need to stay clean'
    sentences.push(`${dress.name} carries the column, and ${support}.`)
    // A top alongside a dress used to be omitted from this sentence entirely: the card told the
    // person to wear a garment the prose never mentioned, under a label ("one-piece column") that
    // implied it was not there. Name it, and say what it is doing.
    if (top) {
      sentences.push(`${top.name} is worn with the dress rather than instead of it — layered over or under, it has to read as a deliberate second layer, not a spare garment.`)
    }
  } else if (bottom) {
    const columnVerb = /\b(black|charcoal|dark|navy|denim|straight|trouser|column)\b/.test(pieceNameBlob(bottom)) ? 'creates the long base' : 'sets the lower proportion'
    const upperJob = top ? `${top.name} ${/\b(fitted|sleeveless|tank|shell|compact)\b/.test(pieceNameBlob(top)) ? 'keeps the upper half compact' : 'sets the upper shape'}` : 'the upper piece needs to stay controlled'
    sentences.push(`${bottom.name} ${columnVerb}, while ${upperJob}.`)
  } else if (top) {
    sentences.push(`${top.name} sets the upper anchor, so the remaining pieces need to keep the line grounded.`)
  }

  if (printPiece && printPiece !== top && printPiece !== bottom && printPiece !== dress) {
    sentences.push(`${printPiece.name} supplies the visual tension; the quiet support pieces keep it from turning into pattern stacking.`)
  } else if (printPiece) {
    sentences.push(`${printPiece.name} supplies the visual tension, so the surrounding pieces need to stay quieter.`)
  } else if (softPiece) {
    sentences.push(`${softPiece.name} brings the softness; the structured or dark pieces keep the formula from drifting loose.`)
  }

  if (shoe) {
    if (/\b(pointed|patent|mule|flat)\b/.test(shoeText)) sentences.push(`${shoe.name} keeps the finish sharp at the floor.`)
    else if (/\b(boot|bootie)\b/.test(shoeText)) sentences.push(`${shoe.name} gives the hem enough weight.`)
    else if (/\b(loafer|oxford)\b/.test(shoeText)) sentences.push(`${shoe.name} adds the tailored grounding.`)
    else sentences.push(`${shoe.name} grounds the outfit; keep it intentional rather than casual.`)
  } else if (archetype?.formulaFamily !== 'dress_grounding_shoe') {
    sentences.push('The shoe choice needs to add a clear anchor before this leaves the house.')
  }

  return sentences
    .join(' ')
    .replace(/\b(harmonious|flattering|sophisticated|balance|modernity|overall look|playful touch)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function bohoMoodLabelFromPieces(outfit = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const text = pieces.map(pieceTextBlob).join(' ')
  const modifier = wholeWardrobeGarmentModifier(pieces)
  let base = 'Modern Bohemian City'
  if (pieces.some(p => wardrobeCategoryGroup(p) === 'dress')) base = 'Grounded Bohemian Dress'
  else if (/\b(crochet|woven|raffia|rattan|cork|espadrille|basket|braided|artisan|embroidered|embroidery)\b/.test(text)) base = 'Artisan City Bohemian'
  else if (/\b(paisley|botanical|floral|abstract print|print)\b/.test(text)) base = 'Botanical Bohemian City'
  else if (/\b(cognac|rust|terracotta|ochre|mustard|olive|brown|tan|amber|earthy)\b/.test(text)) base = 'Earthy Bohemian City'
  return modifier ? `${base}: ${modifier}` : base
}

export function buildBohoOutfitReason(outfit = {}, pieces = [], occasion = 'city') {
  const hero = strongestBohoPiece(pieces)
  const shoe = pieces.find(p => wardrobeCategoryGroup(p) === 'shoes')
  const support = pieces.find(p => hero && Number(p.id) !== Number(hero.id) && wardrobeCategoryGroup(p) !== 'shoes')
  const heroTrait = bohoTraitForPiece(hero) || 'bohemian detail'
  const supportGroup = support ? wardrobeCategoryGroup(support) : ''
  const supportText = support
    ? supportGroup === 'bottom'
      ? `${support.name} sets the lower proportion so the bohemian detail has structure rather than sprawl.`
      : supportGroup === 'outerwear'
        ? `${support.name} adds the city frame around the softer bohemian element.`
        : `${support.name} keeps the outfit ${/\b(city|gallery|art|museum)\b/i.test(occasion) ? 'city-readable' : 'wearable'} without flattening the texture.`
    : ''
  const shoeText = shoe
    ? `${shoe.name} gives the outfit a practical grounded finish.`
    : 'Add a grounded shoe before treating this as complete.'
  return [
    hero ? `${hero.name} carries the bohemian read through ${heroTrait}.` : '',
    supportText,
    shoeText
  ].filter(Boolean).join(' ')
}

export function buildBohoWatch(outfit = {}, pieces = []) {
  const text = pieces.map(pieceTextBlob).join(' ')
  const printCount = (text.match(/\b(floral|paisley|botanical|abstract|graphic|print|pattern)\b/g) || []).length
  const softCount = (text.match(/\b(crochet|gauzy|drape|flowing|soft|tiered|ruffle)\b/g) || []).length
  if (printCount >= 2) return 'Keep any added layer quiet so the print mix stays intentional.'
  if (softCount >= 2) return 'Use a grounded shoe or structured support piece so the softness does not turn shapeless.'
  if (!pieces.some(p => wardrobeCategoryGroup(p) === 'shoes')) return 'Choose the shoe before judging the outfit; boho needs grounded finish, not just texture.'
  return 'Keep the bohemian detail as the clear thesis; avoid adding a second competing accent.'
}
