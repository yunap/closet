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
import { pieceWeatherScores } from './thermal.js'
import { evaluateOuterwearCapability } from './outerwearCapability.js'
// §8 step 3: completed outfits compare against the band. Semantic signals only — the ranking slice
// found a filter keyed on a reason STRING that silently stopped matching when the band renamed it,
// so prose is never an API here.
import { resolveExposureContext } from './exposure.js'
import { requiredThermalBand, compareThermalFit } from './thermalDemand.js'
import { outfitThermalContribution } from './outfitThermalContribution.js'

export const ENVIRONMENTAL_ADEQUACY_CODES = {
  NO_REMOVABLE_COOL_LAYER: 'outfit_no_removable_layer_for_cool_conditions',
  COOL_LAYER_IS_SEE_THROUGH: 'outfit_cool_layer_is_see_through',
  NO_REMOVABLE_COOL_LAYER_FOR_TRANSIT: 'outfit_no_removable_layer_for_cool_transit',
  NO_WARM_LAYER_FOR_COLD: 'outfit_no_warm_layer_for_cold',
  THERMAL_UNDERSHOOT: 'outfit_thermal_capacity_below_conditions',
  THERMAL_OVERSHOOT: 'outfit_thermal_capacity_above_conditions',
  NO_TRANSIT_LAYER_FOR_COLD: 'outfit_no_sleeve_bearing_layer_for_cold_transit',
  NO_OUTDOOR_LAYER_FOR_SEVERE_COLD: 'outfit_no_outdoor_capable_layer_for_severe_cold',
  INDOOR_LAYER_ONLY_FOR_SEVERE_COLD: 'outfit_indoor_layer_only_for_severe_cold',
  NO_TRANSIT_LAYER_FOR_SEVERE_COLD: 'outfit_no_removable_layer_for_severe_cold_transit',
  TRANSIT_LAYER_NOT_OUTDOOR_CAPABLE: 'outfit_transit_layer_not_outdoor_capable',
  THERMAL_CAPACITY_INSUFFICIENT: 'outfit_thermal_capacity_insufficient_for_severe_cold',
  RAIN_PROTECTION_MISSING: 'outfit_rain_protection_missing_for_wet_exposure',
  CAPABILITY_UNKNOWN: 'outfit_outerwear_capability_unknown',
}

// [R3]: a hard environmental finding can be unsatisfiable from the wardrobe the user actually
// owns. submit_plan_outfits already hit this exact shape once for register floors and had to name
// the escape hatch, because resubmitting different pieces cannot fix a requirement no piece can
// meet. Every hard finding therefore carries the legal move with it, so a consumer cannot present
// an unsatisfiable rejection with no way forward.
const SUPPLY_REMEDY = 'if no owned piece can satisfy this, say so as a wardrobe gap rather than resubmitting — re-plan at a milder context or accept the disclosed shortfall'

// A layered system can be adequate without any single piece being adequate, so thermal capacity is
// read across the whole outfit. The threshold is intentionally coarse: this asks "is there real
// insulation here at all", not "how many degrees". Contract A owns the grading.
const SEVERE_COLD_SYSTEM_COLD_FLOOR = 12

function outerwearPieces(pieces) {
  return pieces.filter(piece => wardrobeCategoryGroup(piece) === 'outerwear')
}

function systemColdScore(pieces) {
  return pieces.reduce((total, piece) => total + (pieceWeatherScores(piece).cold || 0), 0)
}

// Are the layers UNDER the outerwear all thermally tagged?
//
// This is the line between "we measured a thin base" and "we could not measure the base", and it is
// the whole reason the severe-cold shortfall has two tiers. pieceWeatherEvidence returns null when
// nothing about a garment's warmth is known, so an all-tagged base whose total still falls short is
// POSITIVE evidence of inadequacy — the same class as an indoor_layer-only outfit, which hard-fails.
// A base with any unmeasured piece is absence of evidence, which acceptance criterion 8 says must
// never become invalidity.
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

function baseLayersAreFullyMeasured(pieces) {
  const base = pieces.filter(piece => ['top', 'bottom', 'dress'].includes(wardrobeCategoryGroup(piece)))
  return base.length > 0 && base.every(piece => pieceWeatherScores(piece).evidence !== null)
}

// Can this layer serve as the OUTERMOST layer in severe cold?
//
// This replaces the `outerwear_role` gate (docs/outerwear-role-ontology-spec.md). That tag asked a
// garment to carry a condition-free answer to a question that has none — a light cardigan is
// adequate outdoors at 74°F and not at 40°F — and it was consulted from here, the one place that
// already knows the temperature.
//
// Built from facts that are genuinely intrinsic, and following this file's own method: no new
// threshold. `SEVERE_COLD_SYSTEM_COLD_FLOOR` below still does all the quantitative work; this
// function only sorts a layer into the same three buckets the role did, so the surrounding severity
// ladder is unchanged.
//
// Criterion 8 shapes the asymmetry, as everywhere else here. 'insufficient' requires POSITIVE
// evidence of inadequacy — see-through construction, or a composition established as carrying no
// insulation. Absence of evidence stays 'unknown' and cannot hard-fail an outfit.
//
// `non_insulating` is now reachable precisely because it demands an explicit human assertion (a
// complete composition AND "no insulating layer"), which is exactly the positive-evidence standard
// this branch needs. Under the old tag the equivalent signal was a model's guess.
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
  const layerCoveredByRoster = Boolean(resolvedContext.packingRosterHasLayer)
  if (weather.needsRemovableCoolLayer && !weather.isCold && !indoorDestination && !layerCoveredByRoster) {
    if (!layers.length) {
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.NO_REMOVABLE_COOL_LAYER,
        // HOW MUCH, not just "a layer". Live QA (thread_1788421510368): this requirement said only
        // that a removable layer was needed, so a down puffer satisfied it on a 65/48 day — seven
        // times. The demand is stated so the requirement can be met proportionately.
        corroborate(`this outfit has no layer to put on for the cooler part of the day; the base can stay mild, but something removable is needed${demandHint(weather, resolvedContext)}`),
        { evidence, remedy: true }))
    } else if (!someLayerContributesWarmth(layers)) {
      // ADJUDICATED (docs/README.md: trip roster architecture, item 3) rather than left unexamined
      // once thermal coverage moved to the SET level: does this finding own a factual/physical
      // question, or a thermal styling judgment now duplicated by the roster? someLayerContributesWarmth
      // (above) keys purely on the tagged `opacity` field — sheer/semi_sheer — never on warmth level;
      // an earlier version tried a warmth-level cutoff and was reverted (see that function's own
      // comment) because no threshold could separate a sheer shrug from a legitimately light jacket
      // without being arbitrary. So this answers "does the garment provide meaningful coverage at
      // all," a construction fact closer to "no sole on this shoe" than to "not warm enough" — it
      // survives facts-not-judgments on its own terms and stays a hard finding. It already inherits
      // the roster demotion above (nested inside the same !layerCoveredByRoster gate): a card
      // pairing a sheer layer with real protection packed elsewhere in the roster is exactly the
      // owner's own example — legitimate aesthetic layering, not rejected for being non-insulating.
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.COOL_LAYER_IS_SEE_THROUGH,
        corroborate('the only layer here is see-through, so there is still nothing useful to put on when it cools'),
        { evidence, remedy: true }))
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
  if (weather.transitNeedsRemovableCoolLayer && !weather.transitIsCold && !layerCoveredByRoster) {
    if (!layers.length) {
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.NO_REMOVABLE_COOL_LAYER_FOR_TRANSIT,
        corroborate(`the indoor destination may stay light, but this outfit has nothing to put on for the cool walk there and back${demandHint(weather, resolvedContext)}`),
        { evidence, remedy: true }))
    } else if (!someLayerContributesWarmth(layers)) {
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.COOL_LAYER_IS_SEE_THROUGH,
        corroborate('the only layer here is see-through, so the walk to and from the indoor destination is still uncovered'),
        { evidence, remedy: true }))
    }
  }

  // --- minimum warmth floor (any cold, mild included) --------------------------------------------
  // [R2]/[A3]: migrated from the plan specialization so every consumer of the canonical validator
  // shares it, with its semantics and message intact. Contract C now owns both tiers — the floor
  // here, the capability requirement below — which is what makes deleting the duplicate safe.
  //
  // docs/cold-layer-exposure-trigger-spec.md: requiresWarmLayerForColdExposure is an OPTIONAL,
  // additive field a caller may set on the resolved weatherProfile (today: only the trip-plan path,
  // computed once in buildPlanSlotWorkbench where activity/occasion/exposure are already resolved —
  // this module never learns to resolve them itself). `?? weather.isCold` makes every existing
  // caller that doesn't set it — which is every caller except trip plans — byte-identical to before.
  const requiresWarmLayer = weather.requiresWarmLayerForColdExposure ?? weather.isCold
  if (requiresWarmLayer && !indoorDestination && !hasMinimumWarmLayer(list)) {
    findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.NO_WARM_LAYER_FOR_COLD,
      'no warm layer for cold weather', { evidence }))
  }

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
  if (!indoorDestination) {
    const exposure = resolveExposureContext(
      { environment: resolvedContext.environment || 'outdoor' }, weather)
    const demand = requiredThermalBand(exposure)
    const contribution = outfitThermalContribution(list)
    if (demand.level && contribution.withLayer) {
      const fit = compareThermalFit(contribution.withLayer, demand)
      evidence.thermalDemand = demand.level
      evidence.thermalContribution = contribution.withLayer
      evidence.thermalFit = fit.fit
      evidence.thermalCertain = demand.certain

      // UNKNOWN IS NEVER INADEQUACY (§5.6) — but the asymmetry that runs through this whole arc
      // applies here too, and collapsing it would silence the finding that matters most.
      //
      // UNDERSHOOT is blocked by unknown evidence: an unplaceable base could be secretly warm, so
      // "this is too light" is exactly the claim the missing data could falsify. Silence is right.
      //
      // OVERSHOOT is not: an unknown base cannot make a `very warm` coat LESS excessive for a mild
      // day. Positive evidence of too much insulation stands on its own, the same way positive
      // insulating evidence settles thermalMaterialVerdict from an incomplete record.
      const unknownPresent = contribution.unknown.base || contribution.unknown.removable
      if (unknownPresent) evidence.thermalContributionUnknown = true
      const overshooting = String(fit.fit).includes('overshoot')
      // The overshoot signal is carried by the garment that was actually PLACED — here the removable
      // layer. An unknown base is irrelevant to it, so requiring complete evidence would silence the
      // finding on almost every real outfit: a plain medium cotton top is itself unplaceable (§13.3's
      // at-risk band), and most outfits contain one.
      if (unknownPresent && !overshooting) {
        // undershoot with unknown evidence: record it, claim nothing
      } else if (fit.fit === 'undershoot') {
        // ADVISORY, not an error — and this was a hard finding for exactly one test run before the
        // fixtures showed why it must not be. A synthetic "sleeved wool coat" tagged
        // `fabric_weight: light` with no fibre content placed as `light`, undershot a 65/45 day, and
        // hard-blocked submission. That is acceptance criterion 8 violated: missing metadata may
        // never become hard invalidity, and a barely-tagged wardrobe is exactly the shape that
        // produces it.
        //
        // The PRESENCE gate keeps its authority — NO_WARM_LAYER_FOR_COLD above is still an error.
        // What the band adds here is the AMOUNT, graded, which informs rather than blocks. That also
        // keeps §19.1's composition invariant intact at the adequacy layer.
        findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_UNDERSHOOT,
          corroborate('this outfit carries less warmth than the conditions call for'),
          { evidence, severity: 'advisory' }))
      } else if (overshooting) {
        // ADVISORY, never hard. §5.5: overshoot ranks, it never excludes — a wardrobe whose only
        // layer is a heavy coat still gets dressed. This is the puffer-on-a-65F-museum-day finding
        // that layer-weight-ceiling.md recorded and nothing has ever been able to state.
        findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_OVERSHOOT,
          fit.fit === 'substantial_overshoot'
            ? 'this outfit carries considerably more warmth than the conditions call for'
            : 'this outfit carries more warmth than the conditions call for',
          { evidence, severity: 'advisory' }))
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
    const systemCold = systemColdScore(list)
    evidence.systemColdScore = systemCold

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
    } else if (unknown.length && systemCold < SEVERE_COLD_SYSTEM_COLD_FLOOR) {
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.CAPABILITY_UNKNOWN,
        'the outer layer has no tagged outerwear capability and little thermal evidence, so its adequacy for sustained cold cannot be judged from saved garment facts',
        { severity: 'advisory', evidence }))
    } else if (outdoorCapable.length && systemCold < SEVERE_COLD_SYSTEM_COLD_FLOOR) {
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
      const measured = baseLayersAreFullyMeasured(list)
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.THERMAL_CAPACITY_INSUFFICIENT,
        measured
          ? 'the outer layer is outdoor-capable, but the layers under it are light enough that this outfit carries little insulation for sustained cold'
          : 'the outer layer is outdoor-capable but little insulation is recorded beneath it for sustained cold',
        { severity: measured ? 'error' : 'advisory', evidence, remedy: measured }))
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
