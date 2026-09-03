// THE canonical owner of one question: what environmental exposure is this outfit expected to
// experience? See docs/exposure-conditions-spec.md.
//
// Deliberately NOT a thermal module. It computes no warmth, no demand, no threshold and no verdict.
// It resolves the exposure half of `requiredThermalBand(weather, exposureContext)` (thermal-comfort-
// band-spec.md §9.1) and hands it over. Everything about how much warmth a band calls for belongs
// to that spec, not this one.
//
// WHY IT EXISTS. A Vienna trip shipped six cards — three museum days, two woodland hikes, an indoor
// dinner — all sized against one 24-hour envelope, `65°F high / 47°F low`. A down puffer was
// REQUIRED on every 65°F city day, because `needsRemovableCoolLayer` keys on `lowF` alone: a 5am
// trough nobody is dressed for. The slot already knew each outing's activity and environment; those
// facts reached the card's LABEL and changed nothing about what was selected.
//
// TWO INDEPENDENT DEFECTS (spec §4.4), and this module is the first half of each fix:
//   correct conditions + ignored exertion  -> wrong demand
//   wrong conditions   + correct exertion  -> ALSO wrong demand
// Consuming activity/exposure mode is defect 1. Sourcing the conditions the outfit actually meets
// is defect 2, and `conditions.coarse` below is where that lands — see §4.2 and the note there.
import { ACTIVITY_VALUES } from './stylingIntent.js'

// Exertion: the metabolic proxy, ordinal only. NOT a metabolic rate — spec §7 and band spec §11.7
// refuse watts/m², and three ordered levels is what `activity` actually supports.
//
// `unknown` is a first-class value and is NOT `none`. That distinction is load-bearing: as a
// thermal input `none` claims "the wearer is stationary", which is a real claim about heat
// production, while `normalizeActivity` also returns 'none' when nobody said anything. Collapsing
// them is the same defect `insulating_layer_materials` had before null and [] were separated.
export const EXERTION_LEVELS = ['unknown', ...ACTIVITY_VALUES]

// How the outfit meets the outside. Derived ONLY from the typed `environment` field — never from
// occasion, label or prose. An earlier draft of the spec derived windows from meanings ("museum
// means daytime", "dinner means evening"); that invents a model Closet has no business owning and
// was removed (§4.1).
export const EXPOSURE_MODES = ['unknown', 'indoor_destination', 'sustained_outdoor']

const ENVIRONMENT_TO_MODE = {
  indoor: 'indoor_destination',
  outdoor: 'sustained_outdoor',
  beach_coastal: 'sustained_outdoor',
}

function normalizeExertion(slot = {}) {
  const raw = slot?.activity
  // Absent is unknown, not 'none'. hasDeclaredPlanSlotActivity draws this same line upstream in the
  // planner; measured across 53 real plan turns, activity was declared on 52 (spec §10.2).
  if (raw === undefined || raw === null || String(raw).trim() === '') return 'unknown'
  const v = String(raw).toLowerCase().trim()
  return ACTIVITY_VALUES.includes(v) ? v : 'unknown'
}

function normalizeExposureMode(slot = {}) {
  const env = String(slot?.environment || '').toLowerCase().trim()
  return ENVIRONMENT_TO_MODE[env] || 'unknown'
}

// The conditions the outfit is expected to MEET.
//
// Today this is the daily envelope, unchanged and openly labelled `coarse: true`. That is defect 2
// still live, on purpose: spec §10 fixes it at step 4, after the band exists, via §4.2's sourcing
// tier (hourly / window / stated estimate / explicit range). The flag is the seam — a consumer can
// see it is reading a 24-hour envelope rather than exposure conditions, and this module can start
// returning better numbers without any consumer changing.
//
// Wind is carried because it is an environmental condition that is already resolved per turn and
// today reaches only `weather_protection`, never the thermal model (spec §2.2). Whether it shifts
// the demand is the band's decision; establishing the pipe is this module's.
function resolveConditions(resolvedWeather = null) {
  const t = resolvedWeather?.temperature || resolvedWeather || null
  const highF = Number.isFinite(t?.highF) ? t.highF : null
  const lowF = Number.isFinite(t?.lowF) ? t.lowF : null
  const wind = resolvedWeather?.wind?.value ?? resolvedWeather?.wind ?? 'unknown'
  if (highF === null && lowF === null) {
    return { highF: null, lowF: null, wind, source: 'unavailable', coarse: true, known: false }
  }
  return {
    highF,
    lowF,
    wind: typeof wind === 'string' ? wind : 'unknown',
    source: t?.source || resolvedWeather?.overallSource || 'unknown',
    // TRUE while conditions come from the daily envelope rather than the exposure window.
    // Spec §4.2 / §10 step 4 is what makes this false.
    coarse: true,
    known: true,
  }
}

/**
 * @param {object} slot        a plan slot, or any object carrying `activity` / `environment`
 * @param {object} resolvedWeather  a resolved weather context (or its `.temperature`)
 * @returns {object} ExposureContext
 */
export function resolveExposureContext(slot = {}, resolvedWeather = null) {
  const exertion = normalizeExertion(slot)
  const exposureMode = normalizeExposureMode(slot)
  const conditions = resolveConditions(resolvedWeather)

  // An indoor destination excuses the BASE, never the trip (band spec §5.7). The transit window is
  // its own exposure and is always outdoor; today it carries the same coarse conditions, which is
  // exactly the sharing that step 4 will separate.
  const transit = exposureMode === 'indoor_destination'
    ? { applies: true, conditions, exertion: 'unknown' }
    : { applies: false, conditions: null, exertion: 'unknown' }

  // Genuinely absent, and must stay absent rather than being defaulted to all-day. Spec §2.2 lists
  // duration as one of only three variables the standard input model wants that Closet has no field
  // for at all.
  const duration = null

  const unknownFields = []
  if (exertion === 'unknown') unknownFields.push('exertion')
  if (exposureMode === 'unknown') unknownFields.push('exposureMode')
  if (!conditions.known) unknownFields.push('conditions')
  unknownFields.push('duration')

  return { exertion, exposureMode, conditions, transit, duration, unknownFields }
}

// Two exposure contexts are "thermally distinguishable" when they differ on any input a demand
// model would consume. Case A (spec §9) is stated as "must not resolve to identical thermal
// demand"; the band that computes demand does not exist yet, so this reports the honest thing this
// layer can prove — that the INPUTS differ, and on what. A band fed identical inputs cannot produce
// different demands, so this is the necessary half.
export function exposureContextsDiffer(a = {}, b = {}) {
  const reasons = []
  if (a.exertion !== b.exertion) reasons.push(`exertion ${a.exertion} vs ${b.exertion}`)
  if (a.exposureMode !== b.exposureMode) reasons.push(`exposureMode ${a.exposureMode} vs ${b.exposureMode}`)
  if (Boolean(a.transit?.applies) !== Boolean(b.transit?.applies)) reasons.push('transit applicability')
  if (a.conditions?.highF !== b.conditions?.highF || a.conditions?.lowF !== b.conditions?.lowF) {
    reasons.push('conditions')
  }
  return { differ: reasons.length > 0, reasons }
}
