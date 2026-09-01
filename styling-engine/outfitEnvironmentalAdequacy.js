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
import { fabricWeight, hasSleevelessConstruction, wardrobeCategoryGroup } from './attributes.js'
import { pieceWeatherScores } from './thermal.js'
import { evaluateOuterwearCapability } from './outerwearCapability.js'

export const ENVIRONMENTAL_ADEQUACY_CODES = {
  NO_REMOVABLE_COOL_LAYER: 'outfit_no_removable_layer_for_cool_conditions',
  COOL_LAYER_IS_SEE_THROUGH: 'outfit_cool_layer_is_see_through',
  NO_REMOVABLE_COOL_LAYER_FOR_TRANSIT: 'outfit_no_removable_layer_for_cool_transit',
  NO_WARM_LAYER_FOR_COLD: 'outfit_no_warm_layer_for_cold',
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

// remedy is opt-in rather than automatic: the migrated minimum-warmth floor (below) keeps its
// original wording verbatim so no existing consumer's behaviour or message changes, while the new
// severe-cold and hazard findings — the ones a wardrobe can genuinely be unable to satisfy — carry
// the escape hatch.
function finding(code, message, { severity = 'error', evidence = {}, remedy = false } = {}) {
  return {
    code,
    severity,
    stage: 'environment',
    message: remedy && severity === 'error' ? `${message} — ${SUPPLY_REMEDY}` : message,
    evidence,
  }
}

// Migrated verbatim from validateSlotOutfitConstraints ([R2]). This is the MINIMUM-WARMTH FLOOR and
// it fires on any isCold, mild included: cold-severity-spec.md is explicit that isCold stays a
// floor. Note it accepts a heavy main INSTEAD of a layer — that is deliberate and unchanged. The
// severe-cold branch adds the outdoor-capability requirement on top rather than replacing this.
function hasMinimumWarmLayer(pieces) {
  const layer = pieces.find(piece => wardrobeCategoryGroup(piece) === 'outerwear')
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

  if (weather.needsRemovableCoolLayer && !weather.isCold && !indoorDestination) {
    if (!layers.length) {
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.NO_REMOVABLE_COOL_LAYER,
        corroborate('this outfit has no layer to put on for the cooler part of the day; the base can stay mild, but something removable is needed'),
        { evidence, remedy: true }))
    } else if (!someLayerContributesWarmth(layers)) {
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
  if (weather.transitNeedsRemovableCoolLayer && !weather.transitIsCold) {
    if (!layers.length) {
      findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.NO_REMOVABLE_COOL_LAYER_FOR_TRANSIT,
        corroborate('the indoor destination may stay light, but this outfit has nothing to put on for the cool walk there and back'),
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
  if (weather.isCold && !indoorDestination && !hasMinimumWarmLayer(list)) {
    findings.push(finding(ENVIRONMENTAL_ADEQUACY_CODES.NO_WARM_LAYER_FOR_COLD,
      'no warm layer for cold weather', { evidence }))
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
    const verdicts = layers.map(piece => ({ piece, ...evaluateOuterwearCapability(piece, { requireOutdoorLayer: true }) }))
    const outdoorCapable = verdicts.filter(v => v.verdict === 'pass')
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
      const verdicts = removable.map(piece => evaluateOuterwearCapability(piece, { requireOutdoorLayer: true }))
      if (verdicts.every(v => v.verdict === 'insufficient')) {
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
