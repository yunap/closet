// Contract C of docs/outerwear-weather-consolidation-spec.md — does this COMPLETE outfit provide
// the coverage, warmth and environmental protection the resolved context needs?
//
// Owner ruling [O2] placed this here rather than inside evaluateWearableOutfit: that function stays
// the canonical outfit-validity aggregator and composes these findings when authoritative context
// is supplied, but weather semantics live in this narrow primitive instead of being spread through
// the structural validator.
//
// Three boundaries this module holds, all of them load-bearing:
//
//   1. It consumes the CANONICAL RESOLVED weatherProfile only. It never parses weather prose,
//      location or dates — resolveStylingContext already did that, and a second parser would be
//      exactly the parallel weather gate §2 forbids.
//   2. It owns cold SEVERITY. isColdSevere appears here and never in the per-piece capability
//      primitive: a garment cannot know how cold it is, only what job it is built for.
//   3. It composes Contract A (thermal) and Contract B (function) rather than reimplementing
//      either. A cashmere cardigan is warm AND not outdoor outerwear; a shell is outdoor-capable
//      AND thermally light. Collapsing those axes is the defect this slice removes.
//
// Severity follows evaluateWearableOutfit's existing convention: `severity: 'error'` is a hard
// finding, anything else is advisory.
import { fabricWeight, hasSleevelessConstruction, wardrobeCategoryGroup, thermalMaterialVerdict, pieceWeatherProtection, garmentKind } from './attributes.js'
import { interiorConstruction } from './fiberTaxonomy.js'
import { evaluateOuterwearCapability } from './outerwearCapability.js'
// §8 step 3: completed outfits compare against the band. Semantic signals only — the ranking slice
// found a filter keyed on a reason STRING that silently stopped matching when the band renamed it,
// so prose is never an API here.
import { resolveExposureContext } from './exposure.js'
import { requiredThermalBand, requiredThermalEndpointBands, compareThermalFit } from './thermalDemand.js'
import { outfitThermalContribution, outfitRangeCoverage } from './outfitThermalContribution.js'
import { hasFaceMaterialEvidence } from './garmentWarmth.js'
import { WARMTH_LEVELS } from './garmentWarmth.js'

const LEVEL_INDEX_FOR_FIT = new Map(WARMTH_LEVELS.map((level, index) => [level, index]))

export const ENVIRONMENTAL_ADEQUACY_CODES = {
  NO_REMOVABLE_COOL_LAYER: 'outfit_no_removable_layer_for_cool_conditions',
  COOL_LAYER_IS_SEE_THROUGH: 'outfit_cool_layer_is_see_through',
  NO_REMOVABLE_COOL_LAYER_FOR_TRANSIT: 'outfit_no_removable_layer_for_cool_transit',
  NO_WARM_LAYER_FOR_COLD: 'outfit_no_warm_layer_for_cold',
  WARM_LAYER_RECOMMENDED: 'outfit_warm_layer_recommended_for_cool_conditions',
  THERMAL_UNDERSHOOT: 'outfit_thermal_capacity_below_conditions',
  WARM_END_THERMAL_UNDERSHOOT: 'outfit_remaining_layers_below_warm_endpoint',
  THERMAL_OVERSHOOT: 'outfit_thermal_capacity_above_conditions',
  NO_TRANSIT_LAYER_FOR_COLD: 'outfit_no_sleeve_bearing_layer_for_cold_transit',
  NO_OUTDOOR_LAYER_FOR_SEVERE_COLD: 'outfit_no_outdoor_capable_layer_for_severe_cold',
  INDOOR_LAYER_ONLY_FOR_SEVERE_COLD: 'outfit_indoor_layer_only_for_severe_cold',
  NO_TRANSIT_LAYER_FOR_SEVERE_COLD: 'outfit_no_removable_layer_for_severe_cold_transit',
  TRANSIT_LAYER_NOT_OUTDOOR_CAPABLE: 'outfit_transit_layer_not_outdoor_capable',
  THERMAL_CAPACITY_INSUFFICIENT: 'outfit_thermal_capacity_insufficient_for_severe_cold',
  THERMAL_CAPACITY_SHORT_WITHOUT_INSULATION_EVIDENCE: 'outfit_thermal_capacity_short_without_insulation_evidence',
  THERMAL_CAPACITY_INSULATION_EVIDENCE_UNKNOWN: 'outfit_thermal_capacity_insulation_evidence_unknown',
  RAIN_PROTECTION_MISSING: 'outfit_rain_protection_missing_for_wet_exposure',
  CAPABILITY_UNKNOWN: 'outfit_outerwear_capability_unknown',
}

// ── Endpoint / configuration evaluation (Concern 2, owner-approved 2026-09-12) ─────────────────
//
// WHAT THIS REPLACES, AND WHY. The thermal-amount findings used to compare ONE number — the outfit
// with every layer on — against ONE level derived from the cold endpoint. That converted forecast
// precision into clothing certainty: a coarse forecast widened the acceptable band while an exact
// one collapsed it to a single level, so a `moderate` knit was declared objectively wrong at 65F
// and only a quilted puffer could dress a 50F morning. The Matzarakis scale supplies a comfort
// TARGET; it does not establish that one ordinal level below it is physically inadequate.
//
// The model, in three separated parts:
//   TARGET       — the PET-derived level at each endpoint. Ranking preference, reported as evidence.
//   FIT          — does at least ONE realistic worn configuration suit this endpoint? Adjacent (one
//                  ordinal level, either direction) counts as suiting it: ranking/debug evidence,
//                  never a card-face note.
//   SUBSTANTIAL  — two or more levels away with NO configuration inside the adjacent band. That,
//                  and the independent physical rules, is what a finding is for.
//
// ADJACENT_LEVEL_TOLERANCE is the one magnitude here and it is deliberately NOT derived from the
// forecast: it is the resolution limit of a five-level garment taxonomy against a comfort scale,
// applied identically whether the temperature came from a stated range or a coarse estimate.
const ADJACENT_LEVEL_TOLERANCE = 1

// Realistic worn configurations: the outfit as composed, and the outfit with each removable layer
// taken off (plus bare, when more than one layer exists). Only outerwear is removed, so the base and
// every dependency it carries — `needs_base`, layer direction, sleeve pairing — are untouched by
// construction, and the structural caps that bound an outfit (one base, one middle, one outer) bound
// this enumeration with it. A configuration whose level cannot be placed proves NEITHER fit nor
// failure; it is carried as `unknown` and excluded from every claim.
export function wornConfigurations(pieces = [], { validateConfiguration = null } = {}) {
  const list = Array.isArray(pieces) ? pieces : []
  const removables = list.filter(piece => wardrobeCategoryGroup(piece) === 'outerwear')
  const configurations = [{ removedPieceId: null, pieces: list }]
  for (const layer of removables) {
    configurations.push({
      removedPieceId: Number(layer.id) || null,
      pieces: list.filter(piece => Number(piece.id) !== Number(layer.id)),
    })
  }
  if (removables.length > 1) {
    configurations.push({ removedPieceId: 'all_layers', pieces: list.filter(piece => wardrobeCategoryGroup(piece) !== 'outerwear') })
  }
  // REVALIDATION IS NOT FREE, AND REMOVAL IS NOT MONOTONIC. Dropping an outerwear piece keeps every
  // structural cap and every `needs_base` dependency satisfied — those only ever loosen — but taking
  // out an INTERMEDIATE layer creates a base-to-outer adjacency that the composed outfit never had
  // and nothing validated: a voluminous sleeve that was fine under a cardigan may not fit under the
  // coat directly. So the configuration set accepts an injected validator rather than asserting a
  // revalidation it does not perform. `outfitValidation` owns the layer checks and supplies it; with
  // no validator every configuration is `valid: true`, which is exactly the old behaviour, stated.
  return configurations.map(configuration => ({
    ...configuration,
    valid: typeof validateConfiguration === 'function'
      ? validateConfiguration(configuration.pieces, configuration) !== false
      : true,
  }))
}

// One endpoint, one question. Returns a verdict plus the evidence a ranker or a debug payload wants.
export function evaluateEndpointFit(configurations = [], target = null, { upperOnly = false, endpoint = 'cold' } = {}) {
  if (!target) return { verdict: 'no_target', entries: [] }
  // WHICH CONFIGURATIONS ARE AVAILABLE AT THIS ENDPOINT.
  //
  // At the cold end, every configuration is: you can put on everything you brought.
  //
  // At the warm end, the outfit as composed is NOT a candidate whenever it carries something
  // removable — the warm end of the day is where a layer comes off, and letting "keep the down coat
  // on" satisfy a 60F afternoon is how a bare satin shell under a winter coat passed. Every REDUCED
  // configuration stays in play, including the intermediate ones (coat off, cardigan retained), so
  // this is not "lightest state only" — it is "a state you would actually be in once you shed".
  // An unwearable configuration is not a way of wearing the outfit, so it can neither prove fit nor
  // carry a failure. It stays visible in the evidence via `wornConfigurations`, not here.
  const wearable = configurations.filter(configuration => configuration.valid !== false)
  const candidates = endpoint === 'warm' && wearable.some(configuration => configuration.removedPieceId != null)
    ? wearable.filter(configuration => configuration.removedPieceId != null)
    : wearable
  const entries = candidates.map(configuration => {
    const contribution = outfitThermalContribution(configuration.pieces)
    const level = upperOnly ? contribution.upperWithLayer : contribution.withLayer
    const unknown = upperOnly ? contribution.unknown.upper : (contribution.unknown.base || contribution.unknown.removable)
    return {
      removedPieceId: configuration.removedPieceId,
      level,
      // A configuration is UNKNOWN when any garment in it could not be placed — even though a known
      // layer may still give the configuration a non-null level. `upperWithLayer` returns `light`
      // for an unplaceable base under a light jacket, and reading that as evidence would let
      // incomplete data prove both fit and failure. The level is kept for debug; the flag decides.
      unknown: Boolean(unknown) || level == null,
      delta: level == null ? null : LEVEL_INDEX_FOR_FIT.get(level) - LEVEL_INDEX_FOR_FIT.get(target),
    }
  })
  const known = entries.filter(entry => !entry.unknown && entry.delta != null)
  const unknownRemains = entries.some(entry => entry.unknown)
  if (!known.length) return { verdict: 'cannot_judge', entries, best: null }

  // A KNOWN FITTING CONFIGURATION PROVES FIT, whatever else is unknown: there is a way to wear this
  // outfit that suits the endpoint, and no missing datum can take that away.
  const best = known.reduce((a, b) => (Math.abs(a.delta) <= Math.abs(b.delta) ? a : b))
  const fitting = known.filter(entry => Math.abs(entry.delta) <= ADJACENT_LEVEL_TOLERANCE)
  if (fitting.length) {
    return {
      verdict: 'fits',
      adjacent: best.delta !== 0,
      direction: best.delta === 0 ? null : (best.delta < 0 ? 'under' : 'over'),
      best, entries,
    }
  }

  // NOTHING KNOWN FITS. Failure needs the whole relevant picture: an unknown configuration could
  // still be the one that suits this endpoint, so a substantial verdict requires every viable
  // configuration to be sufficiently known.
  if (unknownRemains) return { verdict: 'cannot_judge', entries, best }

  // ...and they must all miss the SAME way. A set that is two levels too warm in one state and two
  // levels too light in another is a genuine finding about neither: no direction describes it, and
  // a mechanical claim would have to pick one arbitrarily.
  const directions = new Set(known.map(entry => (entry.delta < 0 ? 'under' : 'over')))
  if (directions.size > 1) return { verdict: 'no_fitting_configuration', entries, best }

  // NOTHING FITS — so which way is it wrong? Not "whichever configuration is closest": an outfit
  // that is +2 with the coat on and -2 with it off was then reported as EXCESS at the warm end,
  // when the state a person would actually be in for the warm part of the day is the lighter one.
  // The fit question stays general (does ANY configuration suit this endpoint), and only the
  // direction of the message is taken from the configuration the wearer would reach for at this
  // endpoint: the lightest at the warm end, the warmest at the cold end.
  const representative = endpoint === 'warm'
    ? known.reduce((a, b) => (a.delta <= b.delta ? a : b))
    : known.reduce((a, b) => (a.delta >= b.delta ? a : b))
  return {
    verdict: representative.delta < 0 ? 'substantial_shortfall' : 'substantial_excess',
    best, representative, entries,
  }
}

// [R3]: a hard environmental finding can be unsatisfiable from the wardrobe the user actually
// owns. submit_plan_outfits already hit this exact shape once for register floors and had to name
// the escape hatch, because resubmitting different pieces cannot fix a requirement no piece can
// meet. Every hard finding therefore carries the legal move with it, so a consumer cannot present
// an unsatisfiable rejection with no way forward.
const SUPPLY_REMEDY = 'if no owned piece can satisfy this, say so as a wardrobe gap rather than resubmitting — re-plan at a milder context or accept the disclosed shortfall'

// NO FALLBACK DEMAND LEVEL, deliberately (owner ruling 2026-09-12, second pass).
//
// A constant `very warm` stood here for flag-only callers, justified by 45/35, 40/28 and 30/20 all
// resolving to `very warm`. They do — because their LOWS happen to be under 39F, not because
// severity implies that target. `isColdSevere` means the daily HIGH is at most SEVERE_COLD_F, and
// 45/45 is severe with a PET cold endpoint of `warm`. The constant would have graded that day two
// levels too high, hard-failing an upper system that is merely adjacent to the real target.
//
// So the separation is literal: severity decides whether the PHYSICAL backstops run (outdoor
// capability, layer presence, transit coverage); a numeric PET endpoint decides thermal AMOUNT.
// With severity present and temperature absent, amount has no target and stays unjudged.

// Shared structured predicate for a wearable removable layer. Exported for the freeform
// single-outfit request contract: an explicit owner request for a layer must be checked against
// the same category truth as weather adequacy, never against the model-authored role or garment
// name. This deliberately does not revive the deprecated outerwear_role ontology.
export function outerwearPieces(pieces) {
  return pieces.filter(piece => wardrobeCategoryGroup(piece) === 'outerwear')
}

// Does at least one layer plausibly DO something in cool conditions?
//
// The first cut of the cool tier tested `!layers.length` — which is `Boolean(layer)`, the exact
// shortcut §7 of this arc's spec exists to delete from the cold branch, reintroduced one tier up.
// It shipped live: two cards satisfied "you need something to put on" with a `semi_sheer` shrug.
//
// The bar is SEE-THROUGH-NESS, not a thermal threshold. A thermal bar was tried first and rejected:
// measured `cold` scores put a sheer shrug at -8, a light unlined cotton jacket at -2, a sleeveless
// vest at 0 and a knit cardigan at 12. Any cutoff that excludes the shrug also excludes the light
// jacket, which is perfectly reasonable outerwear for a cool evening — and picking a number between
// -2 and -8 would be exactly the arbitrary threshold this arc keeps having to walk back.
//
// `opacity` is an existing tagged field with a clear definition ("sheer: clearly see-through";
// "semi_sheer: skin/light hints through") and it is the actual reason a shrug does not help. An
// unset opacity counts as adequate, for the same criterion-8 reason unmeasured warmth does.
const SEE_THROUGH_OPACITY = new Set(['sheer', 'semi_sheer'])

function someLayerContributesWarmth(layers) {
  return layers.some(piece => !SEE_THROUGH_OPACITY.has(String(piece?.opacity || '').toLowerCase().trim()))
}

// Is the whole base tagged as warm-season clothing?
//
// CORROBORATION ONLY. docs/piece-season-as-weather-evidence.md is explicit that `season` is
// wearer-INTENT evidence, not physical thermal evidence, and must never independently exclude a
// garment or create a finding. This function is therefore only ever consulted to enrich a shortfall
// the physical rule has ALREADY found — never in a condition that decides one.
//
// The control that keeps the hierarchy honest: delete this function and every finding still fires,
// with a shorter message. There is a test asserting exactly that.
function baseIsWarmSeasonOnly(pieces) {
  const base = pieces.filter(piece => ['top', 'bottom', 'dress'].includes(wardrobeCategoryGroup(piece)))
  return base.length > 0 && base.every(piece => String(piece?.season || '').toLowerCase().trim() === 'warm')
}

// Can this layer serve as the OUTERMOST layer in severe cold?
//
// This replaces the `outerwear_role` gate (docs/outerwear-role-ontology-spec.md). That tag asked a
// garment to carry a condition-free answer to a question that has none — a light cardigan is
// adequate outdoors at 74°F and not at 40°F — and it was consulted from here, the one place that
// already knows the temperature.
//
// Built from facts that are genuinely intrinsic, and following this file's own method: no new
// threshold, and none of its own: the quantitative work is done by the endpoint/configuration
// evaluator (2026-09-12, Concern 3 — previously by the retired `SEVERE_COLD_SYSTEM_COLD_FLOOR`).
// This function only sorts a layer into the same three buckets the role did, so the surrounding
// severity ladder is unchanged.
//
// Criterion 8 shapes the asymmetry, as everywhere else here. 'insufficient' requires POSITIVE
// evidence of inadequacy — see-through construction, or a composition established as carrying no
// insulation. Absence of evidence stays 'unknown' and cannot hard-fail an outfit.
//
// `non_insulating` is now reachable precisely because it demands an explicit human assertion (a
// complete composition AND "no insulating layer"), which is exactly the positive-evidence standard
// this branch needs. Under the old tag the equivalent signal was a model's guess.
// INSULATION EVIDENCE for one upper-body garment, kept apart from two neighbouring facts that are
// NOT insulation:
//   - weather_protection proves EXPOSURE protection (wind/rain blocked), not thermal capacity;
//   - interior_construction (a lining, a second fabric face) proves construction SUBSTANCE, not
//     insulation.
// Only the material verdict speaks: a recorded fill or insulating fibre is 'insulating'; an answered
// "no insulating layer" is 'none'. Ordinary base clothing whose face fabric is recorded cannot
// plausibly conceal a fill, so it is known 'none' — the same rule garmentWarmth.js applies to
// placement. An outer layer whose interior was never answered stays 'unknown', and unknown is never
// a fault.
export function upperGarmentInsulationEvidence(piece = {}) {
  const verdict = thermalMaterialVerdict(piece)
  if (verdict === 'insulating') return 'insulating'
  if (verdict === 'non_insulating') return 'none'
  if (wardrobeCategoryGroup(piece) !== 'outerwear' && hasFaceMaterialEvidence(piece)) return 'none'
  return 'unknown'
}

function outerLayerSevereColdAdequacy(piece = {}) {
  // Same bar the cool tier uses, and for the same reason: a sheer shrug is not a coat, and opacity
  // is a defined tagged field rather than a number someone picked.
  if (SEE_THROUGH_OPACITY.has(String(piece?.opacity || '').toLowerCase().trim())) return 'insufficient'

  // CONSTRUCTION FIRST, and this ordering was measured rather than assumed. A first version tested
  // thermal evidence before construction, and it moved 23 of 33 outerwear pieces between buckets —
  // sending cashmere cardigans to 'adequate' for 28°F outdoor exposure, which is precisely what the
  // old gate existed to prevent. Insulating MATERIAL is not the same claim as "built to be the
  // layer you go outside in": a wool cardigan is warm and is still not a coat.
  const kind = String(garmentKind(piece) || '')
  if (['cardigan', 'vest'].includes(kind)) return 'insufficient'
  if (!['coat', 'jacket'].includes(kind)) return 'unknown'

  // Within outdoor construction, warmth or a weather barrier decides. "A shell over real insulation
  // passes" — this branch's own existing comment, now executable.
  if (thermalMaterialVerdict(piece) === 'insulating') return 'adequate'
  if (pieceWeatherProtection(piece).length) return 'adequate'
  if (fabricWeight(piece) === 'heavy') return 'adequate'
  if (thermalMaterialVerdict(piece) === 'non_insulating') return 'insufficient'
  return 'unknown'
}

// remedy is opt-in rather than automatic: the migrated minimum-warmth floor (below) keeps its
// original wording verbatim so no existing consumer's behaviour or message changes, while the new
// severe-cold and hazard findings — the ones a wardrobe can genuinely be unable to satisfy — carry
// the escape hatch.
// Adds the half this requirement never carried: not just THAT a layer is needed, but that it should
// be proportionate. Live QA (thread_1788421510368): stated only as "something removable is needed",
// it was satisfied by a down puffer on a 65/48 day, seven times over.
//
// It deliberately does NOT restate a demand level. The plan roster resolves its own exposure —
// including ACTIVITY, which this function does not receive — so naming a level here would risk
// contradicting it: adequacy would say `warm` for a slot the roster had already resolved as
// `moderate`. Two numbers that can disagree are worse than one, so this checks whether a level is
// even computable rather than inventing a second one.
//
// docs/search-propose-signal-inventory.md: no longer prescribes HOW to pick a layer ("match to
// conditions rather than reaching for the warmest") — that told the model to obey a verdict, the
// exact pattern this session's cleanup removed everywhere else. It also referenced `thermal_fit`,
// a field removed from the payload in an earlier commit (02ffa84) — a stale pointer nobody had
// caught. Points at the facts that still exist (each candidate's own warmth/insulation) and leaves
// the choice to the model.
function demandHint(weather, resolvedContext = {}) {
  const demand = requiredThermalBand(resolveExposureContext(
    { environment: resolvedContext.environment || 'outdoor' }, weather))
  if (!demand?.level) return ''
  return ' — each candidate piece states its own warmth and insulation; choose accordingly'
}

function finding(code, message, { severity = 'error', evidence = {}, remedy = false } = {}) {
  return {
    code,
    severity,
    stage: 'environment',
    message: remedy && severity === 'error' ? `${message} — ${SUPPLY_REMEDY}` : message,
    evidence,
  }
}

// thread_1788513419132: hasMinimumWarmLayer's outerwear branch used to trust CATEGORY alone — any
// outerwear piece satisfied a gate literally named "minimum warm layer," even one whose own tagged
// facts say the opposite. A "thin UPF technical hoodie" (fabric_weight ultralight,
// insulating_layer_materials manually asserted [], interior_construction manually asserted
// unlined) passed cleanly on category membership while every one of its own facts said otherwise.
// The top/dress branches below never had this defect — they already require proven heavy weight,
// never trusting category alone — so only the outerwear branch needed this.
//
// Deliberately NOT outerwear_role. docs/outerwear-role-ontology-spec.md (owner ruling 2026-09-02):
// the field is deprecated with no replacement tag, its two questions (outdoor job vs. thermal
// substance) were shown incoherent on this exact wardrobe, and its VALUE must not be read as
// garment evidence again — only its bare presence survives, elsewhere, as a legacy "was this piece
// ever tagged" proxy.
//
// Convergence, not a single fact and not a category rule (no cardigan/vest/jacket/coat check,
// unlike the severe-cold sibling `outerLayerSevereColdAdequacy`, which answers a different question
// and is deliberately not reused here). Outerwear stays presumed adequate — the unchanged default —
// unless MULTIPLE independent negative facts agree. Missing or unknown evidence never counts toward
// the negative side (criterion 8) — only a fact with a genuine value, several of them human-asserted
// here, contributes.
//
// weather_protection is deliberately NOT a positive override here, even though it is one for the
// separate protection/capability contract (outerwearCapability.js). This function answers a
// WARMTH-presence question; an ultralight, unlined, explicitly non-insulating wind/rain shell can
// do a real protective job while providing essentially no insulation — passing it on
// weather_protection alone would conflate two contracts this codebase keeps deliberately separate
// (module header, points 1-3 above).
//
// interior_construction is deliberately NOT a positive override either, only a way to keep the
// 'unlined' negative signal from firing. Per its own tagging contract (prompts.js): "A plain
// polyester lining... is interior_construction: 'full_lining' and is NOT an insulating layer" — an
// ordinary lining is explicitly documented as non-thermal construction, not warmth evidence, so
// full_lining/full_second_face cannot promote a piece to adequate on their own; they only prevent
// the unlined vote below from being cast.
//
// Reads raw fabric_weight directly rather than through fabricWeight() (attributes.js), which
// deliberately collapses 'ultralight' into 'light' for its own callers — `fabricWeight(piece) ===
// 'ultralight'` can never be true. softScoreFloors.js already reads the raw field the same way for
// the same reason.
function pieceFabricWeightIsUltralight(piece) {
  return String(piece?.fabric_weight || '').toLowerCase().trim() === 'ultralight'
}

// Exported so validateSubmittedPlanOutfits (outfitSetPlanner.js) can hold an explicitly
// model-assigned `assigned_layer_piece_ids` entry to the same warmth-evidence bar a layer already
// present in the outfit gets here, piece-by-piece rather than only at whole-outfit granularity.
// Deliberately the same function, not a re-derived copy: the two early returns below read
// thermalMaterialVerdict/fabricWeight directly and never consult category or garmentKind, so
// calling this on a cardigan/vest/blazer asks exactly the intended question ("does this garment's
// own thermal evidence positively contradict a cold-layer claim") without smuggling in the
// coat/jacket-only ontology outerLayerSevereColdAdequacy (below) deliberately keeps separate.
export function outerwearLayerPositivelyInadequate(piece) {
  if (thermalMaterialVerdict(piece) === 'insulating') return false
  if (fabricWeight(piece) === 'heavy') return false

  const negativeSignals = [
    pieceFabricWeightIsUltralight(piece),
    thermalMaterialVerdict(piece) === 'non_insulating',
    interiorConstruction(piece) === 'unlined',
  ].filter(Boolean).length
  return negativeSignals >= 2
}

// Migrated verbatim from validateSlotOutfitConstraints ([R2]). This is the MINIMUM-WARMTH FLOOR and
// it fires on any isCold, mild included: cold-severity-spec.md is explicit that isCold stays a
// floor. Note it accepts a heavy main INSTEAD of a layer — that is deliberate and unchanged. The
// severe-cold branch adds the outdoor-capability requirement on top rather than replacing this.
//
// Exported (thread_1788516198449) so tripRosterFailures (outfitSetPlanner.js) can ask, per slot,
// "does at least one of this slot's gate-eligible roster pieces individually satisfy this same
// floor" — hasMinimumWarmLayer([singlePiece]) answers exactly that, reusing the identical criterion
// a submitted CARD is later held to rather than deriving a second one. A roster that cannot possibly
// pass this for a cold_layer_required slot is a deterministic feasibility fact, knowable the moment
// the roster is chosen — not a styling judgment discovered only after several rejected submissions.
export function hasMinimumWarmLayer(pieces) {
  const layer = pieces.find(piece =>
    wardrobeCategoryGroup(piece) === 'outerwear' && !outerwearLayerPositivelyInadequate(piece))
  const top = pieces.find(piece => wardrobeCategoryGroup(piece) === 'top')
  const dress = pieces.find(piece => wardrobeCategoryGroup(piece) === 'dress')
  return Boolean(layer) || (top && fabricWeight(top) === 'heavy') || (dress && fabricWeight(dress) === 'heavy')
}

/**
 * @param {object[]} pieces  the complete outfit
 * @param {object} resolvedContext
 * @param {object} resolvedContext.weatherProfile  canonical resolved profile; never prose
 * @param {string} [resolvedContext.environment]   'indoor' | 'outdoor', when the flow resolved one
 */
// Which severe-cold capacity tier, if any, does an endpoint verdict warrant?
//
// The two tiers now come from the evaluator's own accounting rather than a second predicate.
// `substantial_shortfall` is only ever returned when every viable configuration is KNOWN and all of
// them miss the cold end by two levels or more — precisely the "we measured the base and it is
// thin" case the hard tier was split out for. Anything unmeasured returns `cannot_judge` and stays
// advisory, so acceptance criterion 8 holds by construction rather than by a separate check.
//
// THERE IS NO THIRD ROW, and that was measured rather than assumed. A version of this function also
// disclosed an ADJACENT shortfall at advisory severity, on the reasoning that severe cold deserves a
// higher disclosure bar. Run against the real wardrobe it put "this outfit carries little
// insulation" on a quilted puffer over a moderate sweater at 35/25 — bestDelta -1, a perfectly
// well-dressed card. One level short of a `very warm` target is where good winter outfits actually
// sit, so adjacency stays what it is everywhere else: ranking evidence, not a note.
function severeColdCapacityTier(fit = {}) {
  if (fit.verdict === 'substantial_shortfall') return 'error'
  if (fit.verdict === 'cannot_judge') return 'advisory'
  // `no_target` is the flag-only case: severity without a temperature. Unknown GARMENTS produce an
  // inability-to-judge advisory; an unknown DEMAND produces nothing at all, because there is no
  // question to be unable to answer.
  return null
}

export function evaluateOutfitEnvironmentalAdequacy(pieces = [], resolvedContext = {}) {
  const list = Array.isArray(pieces) ? pieces : []
  const weather = resolvedContext.weatherProfile || null

  // No authoritative context means no verdict. Manufacturing one locally is forbidden ([O2]), and
  // silence here is what keeps every existing context-free caller unchanged.
  if (!weather) return { applicable: false, findings: [], evidence: { reason: 'no resolved weather context' } }

  const indoorDestination = resolvedContext.environment === 'indoor' || weather.isIndoor === true
  const layers = outerwearPieces(list)
  const findings = []

  const evidence = {
    outerwearIds: layers.map(piece => Number(piece.id)),
    indoorDestination,
    isCold: Boolean(weather.isCold),
    isColdSevere: Boolean(weather.isColdSevere),
    transitIsColdSevere: Boolean(weather.transitIsColdSevere),
    transitNeedsRemovableCoolLayer: Boolean(weather.transitNeedsRemovableCoolLayer),
  }

  // --- removable layer for the cool end of the day (docs/cool-weather-tier-spec.md) --------------
  //
  // The 45-80F blind spot. `isCold` needs lowF <= 45, so a 65F/48F October day produced NO weather
  // handling at all and a live trip card shipped a sleeveless tank with no layer. This tier answers
  // a different question from the two below it — not "how warm should the base be" but "does this
  // outfit need something the wearer can put ON" — which is why it reads the LOW while severity
  // reads the high.
  //
  // Satisfied ONLY by an actual layer. A warm base deliberately does not count: on a 72F/55F day
  // that would approve a heavy long-sleeved top worn through the 72F afternoon, leaving the wearer
  // overdressed by day and still with nothing to add at dusk. The point of a removable layer is that
  // the base can stay mild.
  //
  // Fires only when `isCold` has NOT — it fills the gap above that cliff rather than duplicating the
  // floor below it, which accepts a heavy main and would otherwise produce two findings for one
  // outfit. §8 of the spec requires an audit of isCold's consumers now that a graded tier exists
  // beneath it; until then the two stay disjoint by construction.
  // Corroboration text, appended to a cool-tier finding that has already fired on physical grounds.
  // Never a condition, never a severity change — see baseIsWarmSeasonOnly.
  const warmSeasonBase = baseIsWarmSeasonOnly(list)
  const corroborate = (message) => warmSeasonBase
    ? `${message}, and every piece under it is tagged as warm-season clothing`
    : message
  if (warmSeasonBase) evidence.baseIsWarmSeasonOnly = true

  // SET LEVEL vs CARD LEVEL (docs/README.md: trip roster architecture). "This outfit has no layer"
  // used to mean "this CARD carries no layer" unconditionally — the exact defect that made a card
  // demonstrate a jacket just to prove it was packed. When the caller is composing from an already
  // roster-validated set (resolvedContext.packingRosterHasLayer), the question this finding answers
  // is already settled at the SET level: the packed roster has a layer for the cooler part of the
  // day, whether or not THIS card happens to show it. Suppressed, not downgraded to advisory noise
  // on every card — a museum card and a trail card should not both carry a reminder about a jacket
  // neither is required to display.
  // AGENTS.md's negation test: a shared SET-level suppression is one guard around both tiers below,
  // not `&& !layerCoveredByRoster` bolted onto each tier's own condition separately.
  const layerCoveredByRoster = Boolean(resolvedContext.packingRosterHasLayer)
  if (!layerCoveredByRoster) {
  if (weather.needsRemovableCoolLayer && !weather.isCold && !indoorDestination) {
    if (!layers.length) {
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.NO_REMOVABLE_COOL_LAYER,
        // HOW MUCH, not just "a layer". Live QA (thread_1788421510368): this requirement said only
        // that a removable layer was needed, so a down puffer satisfied it on a 65/48 day — seven
        // times. The demand is stated so the requirement can be met proportionately.
        corroborate(`this outfit has no layer to put on for the cooler part of the day; the base can stay mild, but something removable is needed${demandHint(weather, resolvedContext)}`),
        { evidence, severity: 'warning', kind: 'advisory', remedy: false }))
    } else if (!someLayerContributesWarmth(layers)) {
      // ADJUDICATED (docs/README.md: trip roster architecture, item 3) rather than left unexamined
      // once thermal coverage moved to the SET level: does this finding own a factual/physical
      // question, or a thermal styling judgment now duplicated by the roster? someLayerContributesWarmth
      // (above) keys purely on the tagged `opacity` field — sheer/semi_sheer — never on warmth level;
      // an earlier version tried a warmth-level cutoff and was reverted (see that function's own
      // comment) because no threshold could separate a sheer shrug from a legitimately light jacket
      // without being arbitrary. So this answers "does the garment provide meaningful coverage at
      // all," a construction fact closer to "no sole on this shoe" than to "not warm enough" — it
      // survives facts-not-judgments on its own terms and stays a finding, but is demoted to advisory
      // warning alongside NO_REMOVABLE_COOL_LAYER so it surfaces as an advisory note rather than
      // rejecting legitimate aesthetic layering. It already inherits
      // the roster demotion above (the shared `!layerCoveredByRoster` guard around both tiers): a
      // card pairing a sheer layer with real protection packed elsewhere in the roster is exactly the
      // owner's own example — legitimate aesthetic layering, not rejected for being non-insulating.
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.COOL_LAYER_IS_SEE_THROUGH,
        corroborate('the only layer here is see-through, so there is still nothing useful to put on when it cools'),
        { evidence, severity: 'warning', kind: 'advisory', remedy: false }))
    }
  }

  // The transit half of the same tier, added 2026-09-01 after it was recorded as a known gap and
  // then immediately caused two bad cards. `museum` and `gallery` classify as indoor
  // (outfitSetPlanner.js), so the branch above skips those slots entirely — and with nothing reading
  // transitNeedsRemovableCoolLayer, two Museum Visits cards shipped as a bare dress plus shoes for a
  // 48F walk to and from the building. An indoor destination excuses the BASE from cold, never the
  // trip there.
  //
  // Disjoint from the cold-transit floor below for the same reason the outdoor tier is disjoint from
  // isCold: that floor already owns transitIsCold, and it demands MORE — sleeve-bearing coverage.
  // The gradient is deliberate. Cool transit asks for something to put on; cold transit asks for
  // something that covers your arms.
  if (weather.transitNeedsRemovableCoolLayer && !weather.transitIsCold) {
    if (!layers.length) {
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.NO_REMOVABLE_COOL_LAYER_FOR_TRANSIT,
        corroborate(`the indoor destination may stay light, but this outfit has nothing to put on for the cool walk there and back${demandHint(weather, resolvedContext)}`),
        { evidence, severity: 'warning', kind: 'advisory', remedy: false }))
    } else if (!someLayerContributesWarmth(layers)) {
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.COOL_LAYER_IS_SEE_THROUGH,
        corroborate('the only layer here is see-through, so the walk to and from the indoor destination is still uncovered'),
        { evidence, severity: 'warning', kind: 'advisory', remedy: false }))
    }
  }
  }

  // --- minimum warmth floor / presence requirement ---------------------------------------------
  // Canonical exposure-aware presence authority: reads weather.coldPresenceRequirement.
  // - state === 'required': verified severe cold outdoor exposure; hard error NO_WARM_LAYER_FOR_COLD.
  // - state === 'recommended': ordinary cool/cold exposure with unknown duration; advisory WARM_LAYER_RECOMMENDED.
  // - state === 'not_needed' or 'unknown' (or absent): zero findings (no fallback reconstruction).
  const presence = weather?.coldPresenceRequirement
  if (presence?.state === 'required' && !indoorDestination && !hasMinimumWarmLayer(list)) {
    findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.NO_WARM_LAYER_FOR_COLD,
      'no warm layer for cold weather', { evidence, severity: 'error', remedy: false }))
  } else if (presence?.state === 'recommended' && !indoorDestination && !hasMinimumWarmLayer(list)) {
    findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.WARM_LAYER_RECOMMENDED,
      // Experiment instrumentation (default off): the same finding stated as the recorded facts that
      // triggered it, without the engine's recommendation.
      process.env.WARDROBE_EXPERIMENT_NEUTRAL_VERDICTS === 'true'
        ? (layers.length
          ? 'every outer layer here is recorded with at least two thin-construction facts (ultralight fabric, no insulating material, unlined), and no base garment is recorded as heavy-weight, for a day that turns cool at the low end'
          : 'this outfit has no outer layer and no base garment recorded as heavy-weight, for a day that turns cool at the low end')
        : 'a warm or midweight layer is recommended for cool weather', { evidence, severity: 'advisory' }))
  }

  // thread_1789536455443: a "no outer layer carries recorded insulation" advisory was tried here
  // and reverted (owner review, 2026-09-16). Missing dedicated insulation is a per-GARMENT fact; it
  // does not, on its own, establish a whole-OUTFIT shortfall — a system can carry real warmth from a
  // medium insulating base, from multiple garments together, from wind protection genuinely
  // mattering at the stated exposure, or from construction this module does not itemize. A check
  // keyed on one garment's material verdict alone ignores all of those and manufactures a second,
  // narrower verdict that competes with the one this function already computes below (which is the
  // ratified authority and remains genuinely miscalibrated for this case — see its own note, and
  // `docs/engine-behaviour-map.md`'s 2026-09-16 amendment for the honest, unresolved status). The
  // fix for the missing evidence lives in what the MODEL is shown (full construction facts and
  // photographs), not in a new engine verdict.

  // --- thermal amount, from the band (§8 step 3) -------------------------------------------------
  //
  // The floor above answers "is there a warm layer at all", a PRESENCE question keyed on `isCold`.
  // This answers the AMOUNT question the flags could never express: between the two temperature
  // extremes `isCold` is false and nothing was said, which is how a down puffer and a light jacket
  // were equally acceptable on a 65/47 museum day.
  //
  // Deliberately NOT migrating the neighbouring contracts. Removability ("something to put on"),
  // transit coverage ("sleeve-bearing") and outdoor capability are different questions from
  // "how much insulation", and §2.1 keeps them separate. This slice adds the amount and leaves
  // those triggers alone.
  // The configuration set is shared: the amount question below and the severe-cold backstop further
  // down must reason about the same worn states, not about two different pictures of the outfit.
  const configurations = wornConfigurations(list, { validateConfiguration: resolvedContext.validateConfiguration })
  let coldEndpointTarget = null
  if (!indoorDestination) {
    const exposure = resolveExposureContext(
      {
        environment: resolvedContext.environment || 'outdoor',
        activity: resolvedContext.activity,
      }, weather)
    const demand = requiredThermalBand(exposure)
    const endpoints = requiredThermalEndpointBands(exposure)
    const contribution = outfitThermalContribution(list)
    coldEndpointTarget = endpoints.cold?.level || null
    // Upper-body only, per the owner's ruling: a trouser contributes to whole-body comfort but must
    // not decide what an upper LAYER accomplishes. Lower-body suitability stays separate evidence
    // and is deliberately not given a finding or a production field until something consumes it.
    const coldFit = evaluateEndpointFit(configurations, endpoints.cold?.level, { upperOnly: true, endpoint: 'cold' })
    const warmFit = evaluateEndpointFit(configurations, endpoints.warm?.level, { upperOnly: true, endpoint: 'warm' })
    if (demand.level) {
      evidence.thermalDemand = demand.level
      evidence.thermalContribution = contribution.withLayer
      evidence.thermalCertain = demand.certain
      // Ranking/debug evidence. Adjacency lives HERE and never becomes a card-face note.
      evidence.endpointFit = {
        coldTarget: endpoints.cold?.level || null,
        warmTarget: endpoints.warm?.level || null,
        cold: { verdict: coldFit.verdict, adjacent: Boolean(coldFit.adjacent), direction: coldFit.direction || null, bestDelta: coldFit.best?.delta ?? null },
        warm: { verdict: warmFit.verdict, adjacent: Boolean(warmFit.adjacent), direction: warmFit.direction || null, bestDelta: warmFit.best?.delta ?? null },
        configurations: (coldFit.entries || []).map(entry => ({
          removedPieceId: entry.removedPieceId,
          level: entry.level,
          unknown: entry.unknown,
          coldDelta: entry.delta,
          warmDelta: (warmFit.entries || []).find(warmEntry => warmEntry.removedPieceId === entry.removedPieceId)?.delta ?? null,
        })),
      }

      // UNKNOWN IS NEVER INADEQUACY (§5.6), and it is now expressed by the evaluator itself: a
      // configuration whose level cannot be placed is carried as `unknown` and excluded from every
      // claim, so `cannot_judge` produces no finding at all rather than a silent verdict.
      //
      // The old asymmetry (undershoot blocked by unknown evidence, overshoot allowed through)
      // survives where it still applies: positive evidence of excess stands on incomplete records,
      // while "this is too light" is exactly the claim missing data could falsify.
      const unknownPresent = contribution.unknown.base || contribution.unknown.removable
      if (unknownPresent) evidence.thermalContributionUnknown = true

      if (coldFit.verdict === 'substantial_shortfall' && !unknownPresent) {
        // SUBSTANTIAL ONLY. An adjacent shortfall is a ranking preference, not a fault: the PET
        // target says which layer is preferable, not that the neighbouring one is unwearable.
        const enforceCertainRequiredLayer = resolvedContext.requireThermalAdequacy === true && demand.certain
        findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_UNDERSHOOT,
          corroborate('no way of wearing this outfit carries enough warmth for the cold end of these conditions'),
          { evidence, severity: enforceCertainRequiredLayer ? 'error' : 'advisory' }))
      }
      if (warmFit.verdict === 'substantial_excess') {
        // ADVISORY, never hard (§5.5): overshoot ranks, it never excludes. Judged across
        // configurations, so excess a person can simply take off is no longer reported as a fault —
        // only warmth that remains in every wearable state.
        findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT,
          'even with the removable layers off, this outfit carries considerably more warmth than the warm end of these conditions calls for',
          { evidence, severity: 'advisory' }))
      }

      // THE WARM ENDPOINT'S OWN SHORTFALL. A required removable layer creates two worn states, and
      // the clothes left after the outer layer comes off must still suit the warm end. This stays
      // scoped to the narrow explicit contract it has always had — `requireThermalAdequacy` with a
      // certain stated range — rather than widening a hard finding while the rest of the model is
      // softening; and it now asks the same question as every other endpoint check: is there a
      // configuration that suits it, with substantial mismatch the only fault.
      if (resolvedContext.requireThermalAdequacy === true && demand.certain && layers.length
        && warmFit.verdict === 'substantial_shortfall') {
        findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.WARM_END_THERMAL_UNDERSHOOT,
          'after the removable outer layer comes off, the clothes that remain carry less warmth than the warm end of the stated outdoor range calls for',
          { evidence, severity: 'error', remedy: true }))
      }
    }
  }

  // [R2]: the transit floor, likewise migrated verbatim. Sleeve-bearing removable coverage is
  // NECESSARY for cold transit; the severe branch below adds that it is not SUFFICIENT.
  if (weather.transitIsCold) {
    const layer = list.find(piece => wardrobeCategoryGroup(piece) === 'outerwear')
    if (!layer || hasSleevelessConstruction(layer)) {
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.NO_TRANSIT_LAYER_FOR_COLD,
        'no adequate sleeve-bearing layer for cold-weather transit (the indoor base may stay light, but removable coverage is required for getting there and back)',
        { evidence }))
    }
  }

  // --- severe cold, outdoor exposure -----------------------------------------------------------
  // [A3]: mild cold (isCold && !isColdSevere) keeps its existing minimum-warmth floor and gains NO
  // new hard requirement here. Only severe cold asks for a genuine outdoor-capable layer, and even
  // then the role is evidence rather than a gate — a shell over real insulation passes.
  if (weather.isColdSevere && !indoorDestination) {
    const verdicts = layers.map(piece => ({ piece, verdict: outerLayerSevereColdAdequacy(piece) }))
    const outdoorCapable = verdicts.filter(v => v.verdict === 'adequate')
    const unknown = verdicts.filter(v => v.verdict === 'unknown')
    // 2026-09-12, Concern 3. Thermal CAPACITY is now asked of the same endpoint/configuration
    // evaluator as every other amount question, instead of an additive raw-score floor
    // (`systemColdScore` summed per-piece `cold` scores against a hand-set 12). Two systems grading
    // the same quantity was the defect: the floor could convict an outfit the band called adequate,
    // and it summed ordinal-ish scores across garments in exactly the way §15.5 forbids.
    //
    // `isColdSevere` (weather.js `coldSevereForRange`, daily high <= SEVERE_COLD_F) remains the
    // physical backstop AUTHORITY — it decides that this branch runs at all. What changed is the
    // measurement inside it. The target is the PET cold endpoint and nothing else: with no
    // temperature there is no target, `evaluateEndpointFit` returns `no_target`, and the capacity
    // question produces no finding while every physical rule in this branch still runs.
    const severeFit = evaluateEndpointFit(configurations, coldEndpointTarget, { upperOnly: true, endpoint: 'cold' })
    evidence.severeColdFit = {
      target: coldEndpointTarget,
      verdict: severeFit.verdict,
      bestDelta: severeFit.best?.delta ?? null,
    }
    const upperGarments = list.filter(piece => ['top', 'dress', 'outerwear'].includes(wardrobeCategoryGroup(piece)))
    const severeColdInsulation = upperGarments.map(piece => ({ id: Number(piece.id) || null, evidence: upperGarmentInsulationEvidence(piece) }))
    evidence.severeColdInsulation = severeColdInsulation

    // The severity ladder here is deliberately asymmetric, and acceptance criterion 8 is why:
    // missing metadata may never become hard invalidity. So a HARD finding requires positive
    // evidence of inadequacy — no layer at all, or every layer tagged as one that stays indoors.
    // Thin-looking insulation on UNTAGGED pieces is not evidence; it is absence of evidence, and an
    // untagged light-weight coat is exactly the shape a barely-tagged wardrobe produces. Those stay
    // advisory. This still satisfies criterion 4 — arbitrary outerwear no longer certifies cold
    // adequacy, because a tagged indoor_layer now fails outright, which is the case the spec was
    // written for.
    if (!layers.length) {
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.NO_OUTDOOR_LAYER_FOR_SEVERE_COLD,
        'this outfit has no outer layer at all for sustained cold outdoor exposure', { evidence, remedy: true }))
    } else if (!outdoorCapable.length && !unknown.length) {
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.INDOOR_LAYER_ONLY_FOR_SEVERE_COLD,
        'the only outer layer here is an indoor layer; it adds warmth but is not outdoor outerwear for cold exposure', { evidence, remedy: true }))
    } else if (unknown.length && severeFit.verdict !== 'fits') {
      // INABILITY TO JUDGE, preserved deliberately. The layer carries no tagged outerwear
      // capability, and the configurations do not establish that the system suits the cold end
      // either — so the honest output is that this cannot be judged from saved garment facts, not
      // a verdict in either direction. A configuration that demonstrably fits ends the question.
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.CAPABILITY_UNKNOWN,
        'the outer layer has no tagged outerwear capability and little thermal evidence, so its adequacy for sustained cold cannot be judged from saved garment facts',
        { severity: 'advisory', evidence }))
    } else if (outdoorCapable.length && severeColdCapacityTier(severeFit)) {
      // Two tiers, split 2026-09-01 after a live "Trail Tee, Pants & Puffer" card put a light
      // warm-season tee and light warm-season track pants under a winter puffer. The shortfall was
      // detected (systemCold 4 against a floor of 12) and stayed advisory, so it never rendered and
      // the card shipped.
      //
      // The original single advisory tier was a Slice D correction for untagged pieces, and it was
      // right for those — but it collapsed "we could not measure the base" together with "we
      // measured the base and it is thin". Only the first is absence of evidence. An all-tagged
      // base that still falls short is a measurement, and it belongs in the same tier as the
      // indoor_layer-only case rather than in a note nobody sees.
      const measured = severeColdCapacityTier(severeFit) === 'error'
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_CAPACITY_INSUFFICIENT,
        measured
          ? 'the outer layer is outdoor-capable, but the layers under it are light enough that this outfit carries little insulation for sustained cold'
          : 'the outer layer is outdoor-capable but little insulation is recorded beneath it for sustained cold',
        { severity: measured ? 'error' : 'advisory', evidence, remedy: measured }))
    }

    // ADJACENT CAPACITY WITHOUT INSULATION EVIDENCE (owner ruling 2026-09-13).
    //
    // isColdSevere decides that this branch runs; the numeric PET cold endpoint alone decides amount.
    // So this asks nothing without a target (flag-only severity makes no amount judgment — the 45/45
    // regression), nothing when the completed system reaches the target (fibre names never fail an
    // outfit that meets it), and nothing on a substantial shortfall (the capacity authority above owns
    // that). It asks one narrow question in between: the upper system is ONE level short, so is there
    // any positive cold-weather insulation evidence in it? A filled coat or a wool/fleece layer under
    // a shell supplies it and the one-level tolerance stands. Weather protection and a lining never
    // do: they prove exposure protection and construction substance. Cotton, rayon and silk still
    // insulate physically; the classifier only says they carry no special insulating-fibre or fill
    // evidence. Unknown garment evidence is disclosed, never convicted.
    const hasPositiveInsulationEvidence = severeColdInsulation.some(entry => entry.evidence === 'insulating')
    const oneLevelShort = Boolean(coldEndpointTarget) && severeFit.verdict === 'fits' && severeFit.best?.delta === -1
    if (oneLevelShort && upperGarments.length && !hasPositiveInsulationEvidence && (outdoorCapable.length || unknown.length)) {
      if (!severeColdInsulation.some(entry => entry.evidence === 'unknown')) {
        findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_CAPACITY_SHORT_WITHOUT_INSULATION_EVIDENCE,
          'for sustained severe cold this outfit is one level short of the warmth target, and no upper-body garment has positive cold-weather insulation evidence (a recorded fill or an insulating fibre such as wool or fleece); the outer layer\'s weather protection and any lining do not supply that evidence',
          { evidence, remedy: true }))
      } else {
        findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_CAPACITY_INSULATION_EVIDENCE_UNKNOWN,
          'this outfit is one level short of the warmth target for sustained severe cold, and insulation evidence is not recorded for every upper-body garment, so whether that shortfall is acceptable cannot be judged from saved garment facts',
          { severity: 'advisory', evidence }))
      }
    }
  }

  // --- severe cold transit to an indoor destination --------------------------------------------
  // The indoor base may stay light — that requirement is deliberately relaxed elsewhere — but the
  // card still needs removable, sleeve-bearing coverage for getting there and back. Sleeve-bearing
  // construction is necessary and NOT sufficient: a sleeved indoor cardigan is still not outdoor
  // outerwear ([R2]).
  if (weather.transitIsColdSevere) {
    const removable = layers.filter(piece => !hasSleevelessConstruction(piece))
    if (!removable.length) {
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.NO_TRANSIT_LAYER_FOR_SEVERE_COLD,
        'the indoor base may stay light, but this outfit has no removable sleeve-bearing layer for cold transit', { evidence, remedy: true }))
    } else {
      const verdicts = removable.map(piece => outerLayerSevereColdAdequacy(piece))
      if (verdicts.every(v => v === 'insufficient')) {
        findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.TRANSIT_LAYER_NOT_OUTDOOR_CAPABLE,
          'the removable layer here stays on indoors rather than functioning as outdoor outerwear for cold transit', { evidence, remedy: true }))
      }
    }
  }

  // --- wet exposure -----------------------------------------------------------------------------
  // §6: rain does not mechanically require a rain-protective coat. Only MEANINGFUL outdoor wet
  // exposure — which the resolved profile already distinguishes from a passing mention of rain —
  // makes protection important, and even then an indoor destination softens it to advisory.
  if (weather.isWetExposure) {
    const rainCapable = layers.some(piece => evaluateOuterwearCapability(piece, { requiredHazards: ['rain'] }).verdict === 'pass')
    if (!rainCapable) {
      // ADVISORY, never hard — corrected 2026-09-01 after this fired on freeform fixtures.
      //
      // Two reasons, both from the spec rather than from the failure. First, §6: "do not implement
      // precipitation = rain → rain-protective coat required. That is too strong." Second,
      // `isWetExposure` does not mean sustained outdoor exposure — weatherProfileFromContext sets it
      // from any wet word in the text ("drizzle", "rain") or a coastal+fog+walking combination. It
      // means wet conditions were MENTIONED, not that the person is out in them for an afternoon.
      //
      // And the supply reality makes a hard rule punitive: rain capability is tagged on 1 of 31
      // outerwear pieces in the real wardrobe, so a hard requirement would reject nearly every
      // outfit on any turn that mentions rain — converting absent metadata into invalidity, which
      // acceptance criterion 8 forbids.
      //
      // A genuinely hard wet-weather requirement needs an exposure signal the resolved profile does
      // not currently carry (hike/long outdoor walk AND rain, per §6's own examples). Recorded as
      // open work rather than approximated here.
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.RAIN_PROTECTION_MISSING,
        indoorDestination
          ? 'no layer here has tagged rain protection; brief transit to an indoor destination may still be fine'
          : 'no layer here has tagged rain protection for wet conditions',
        { severity: 'advisory', evidence }))
    }
  }

  return {
    applicable: true,
    findings,
    hardFindings: findings.filter(f => f.severity === 'error'),
    advisoryFindings: findings.filter(f => f.severity !== 'error'),
    evidence,
  }
}

// --- advisory findings as card-face notes ------------------------------------------------------
//
// ONE SHORTFALL, ONE NOTE. The engine keeps these as separate findings on purpose — §2.1 holds
// removability ("is there something to put on"), presence ("is there a warm layer at all") and
// amount ("how much insulation") apart, and each carries its own evidence for diagnostics. But on
// a 65/46 day an outfit with no layer trips all three at once, and live QA (thread_1789174415595,
// Whole Wardrobe Visual Composer) shipped three chips saying the same thing three ways:
//   · "no layer to put on for the cooler part of the day..."
//   · "a warm or midweight layer is recommended for cool weather"
//   · "this outfit carries less warmth than the conditions call for"
// That is a PRESENTATION defect, not a semantic one, so it is fixed here — where findings become
// chips — and never by suppressing a finding inside the evaluator, which would take the evidence
// with it.
//
// Precedence is by information, most specific first: the removability findings name the missing
// thing AND (via demandHint) how much is needed; the undershoot finding at least states the amount;
// WARM_LAYER_RECOMMENDED is the most generic of the three. The winner alone is shown.
//
// Only members of this family collapse. An undershoot note surviving alone (an outfit that HAS a
// layer, just a lighter one than the day asks for) is untouched, and every non-warmth advisory —
// rain, overshoot, fit — passes through unchanged.
const COOL_WARMTH_ADVISORY_PRECEDENCE = [
  ENVIRONMENTAL_ADEQUACY_CODES.NO_REMOVABLE_COOL_LAYER,
  ENVIRONMENTAL_ADEQUACY_CODES.NO_REMOVABLE_COOL_LAYER_FOR_TRANSIT,
  ENVIRONMENTAL_ADEQUACY_CODES.COOL_LAYER_IS_SEE_THROUGH,
  ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_UNDERSHOOT,
  ENVIRONMENTAL_ADEQUACY_CODES.WARM_LAYER_RECOMMENDED,
]

// HARD THERMAL ERRORS, the same presentation rule as the advisory family below: several typed errors
// can describe one physical shortfall (no warm layer, capacity short, no insulation evidence). Every
// typed finding stays in the evaluation and in debug; only the user-facing list shows one primary
// explanation, most fundamental first.
const SEVERE_COLD_THERMAL_ERROR_PRECEDENCE = [
  ENVIRONMENTAL_ADEQUACY_CODES.NO_OUTDOOR_LAYER_FOR_SEVERE_COLD,
  ENVIRONMENTAL_ADEQUACY_CODES.INDOOR_LAYER_ONLY_FOR_SEVERE_COLD,
  ENVIRONMENTAL_ADEQUACY_CODES.NO_WARM_LAYER_FOR_COLD,
  ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_CAPACITY_INSUFFICIENT,
  ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_CAPACITY_SHORT_WITHOUT_INSULATION_EVIDENCE,
]

// The single explanation a surface shows when it can show only one: the first finding after the
// thermal family has collapsed, so structural findings keep their evaluation order and a thermal
// explanation is always the approved primary rather than whichever typed error the evaluator emitted
// first. Typed findings are untouched; this only chooses what the owner reads.
export function primaryUserFacingFinding(hardFindings = []) {
  return collapseThermalErrorFindings(Array.isArray(hardFindings) ? hardFindings : [])[0] || null
}

export function collapseThermalErrorFindings(findings = []) {
  const family = findings.filter(finding => SEVERE_COLD_THERMAL_ERROR_PRECEDENCE.includes(finding?.code))
  if (family.length < 2) return findings
  const kept = family.reduce((best, finding) =>
    SEVERE_COLD_THERMAL_ERROR_PRECEDENCE.indexOf(finding.code) < SEVERE_COLD_THERMAL_ERROR_PRECEDENCE.indexOf(best.code) ? finding : best)
  return findings.filter(finding => !SEVERE_COLD_THERMAL_ERROR_PRECEDENCE.includes(finding?.code) || finding === kept)
}

export function collapseWarmthAdvisoryFindings(findings = []) {
  const family = findings.filter(finding => COOL_WARMTH_ADVISORY_PRECEDENCE.includes(finding?.code))
  if (family.length < 2) return findings
  const kept = family.reduce((best, finding) =>
    COOL_WARMTH_ADVISORY_PRECEDENCE.indexOf(finding.code) < COOL_WARMTH_ADVISORY_PRECEDENCE.indexOf(best.code)
      ? finding
      : best)
  return findings.filter(finding =>
    !COOL_WARMTH_ADVISORY_PRECEDENCE.includes(finding?.code) || finding === kept)
}

// The same family, asked as a question: "is this finding about the outfit not carrying enough
// warmth?" Exported so a caller deciding whether a corrective pass could help reads the one list
// rather than matching on message prose — the ranking slice already found a filter keyed on a
// reason STRING that silently stopped matching when the wording changed.
export function isWarmthShortfallFinding(finding) {
  return COOL_WARMTH_ADVISORY_PRECEDENCE.includes(finding?.code)
}

// "Is this outfit's LAYER wrong for the day" — in either direction. A corrective pass that only
// knows about shortfall watched three of five live cards ship a winter coat on a 65°F afternoon
// (thread_1789238243751) and had nothing to say: too much warmth is as much a layer error as too
// little, and the same swap fixes it.
export function isLayerFitFinding(finding) {
  return isWarmthShortfallFinding(finding) || finding?.code === ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT
}

const ENVIRONMENTAL_CODE_VALUES = new Set(Object.values(ENVIRONMENTAL_ADEQUACY_CODES))

// The single card-face projection of advisory findings, shared by every composer that shows chips
// (outfitSetPlanner's plan slots, rules.js's whole-wardrobe gate). It was copied prose-for-prose in
// both before this, which is how one of them could have drifted.
export function advisoryFindingsToSystemFlags(findings = []) {
  return collapseWarmthAdvisoryFindings(findings).map(finding => ({
    type: ENVIRONMENTAL_CODE_VALUES.has(finding.code) || finding.stage === 'environment' || finding.kind === 'environment' || String(finding.code || '').startsWith('env_')
      ? 'Weather note'
      : 'Fit note',
    message: finding.message,
  }))
}
