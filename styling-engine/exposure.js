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

// ── Conditions during exposure ───────────────────────────────────────────────────────────────
//
// The variable the Vienna failure got wrong. `needsRemovableCoolLayer` consumed the 24-hour MINIMUM
// as though it were the temperature a museum visitor experiences; 47°F is a pre-dawn trough, and a
// layer mandated by it with no ceiling makes the warmest coat owned the safest answer.
//
// PROVENANCE, not a point estimate. Sourcing degrades explicitly (spec §4.2), and the tier is
// recorded so a consumer can see how much to trust the number:
//
//   explicit_hourly                 an exposure window is known and sampled from real hourly data
//   waking_window_estimate          live daily high/low, waking window estimated
//   seasonal_waking_window_estimate model-estimated high/low, waking window estimated
//   unknown                         nothing usable
//
// THIS IS A WEATHER-SOURCING POLICY AND NOTHING ELSE. Owner ruling 2026-09-03: it answers "what
// part of the 24-hour envelope is plausibly encountered while a person is out?" — never "when does a
// museum happen?". It does not read the slot. It does not know about occasion, activity or exposure
// mode, and it must give the identical answer for a hike, a dinner and a gallery on the same day.
// A semantic assumption dressed as observed context is the thing this whole arc rejected; a stated,
// disclosed, slot-independent one is not.
//
// Why an assumption is unavoidable here: the Slice 1 census found NO clock information in any typed
// field anywhere (spec §10.3). A slot carries a date, never a time. So there is nothing to derive a
// window from, and the honest move is to state the assumption and label it, not to keep using a
// number everybody agrees is wrong.
const WAKING_WINDOW = {
  // The share of the day's range the pre-dawn trough sits below by the time people are ordinarily
  // out. STATED ASSUMPTION, not a calibrated constant — it exists to stop the daily minimum being
  // used as exposure temperature, and it is deliberately conservative (it still keeps the low end
  // well under the daily high). Replace it with sampled hourly data rather than tuning it; if it
  // proves materially wrong, that is the evidence that would justify a typed exposure-window field,
  // which the owner ruled must NOT be added before such evidence exists.
  troughOffsetFraction: 0.35,
}

// Returns the range plausibly met during ordinary waking exposure, given only the day's envelope.
// A RANGE, never a point: uncertainty is preserved rather than collapsed into a fake precision.
function estimateWakingWindow(highF, lowF) {
  if (!Number.isFinite(highF) || !Number.isFinite(lowF)) return null
  const span = Math.max(0, highF - lowF)
  const wakingLowF = Math.round((lowF + span * WAKING_WINDOW.troughOffsetFraction) * 10) / 10
  return { wakingLowF, wakingHighF: highF }
}

// Wind is carried because it is an environmental condition that is already resolved per turn and
// today reaches only `weather_protection`, never the thermal model (spec §2.2). Whether it shifts
// the demand is the band's decision; establishing the pipe is this module's.
function resolveConditions(resolvedWeather = null) {
  const t = resolvedWeather?.temperature || resolvedWeather || null
  // An indoor-destination profile deliberately carries NO highF/lowF — resolveSlotWeather puts the
  // outside temperature under transit* so the indoor base is not gated by outdoor cold. Reading only
  // highF/lowF therefore made an indoor slot conditions-UNKNOWN, which is not the same claim at all:
  // the trip's weather is perfectly well known, it is just stored under its own name. The whole
  // thermal model then went silent on museum days — no demand, every piece `neutral` — which is how
  // thread_1788427130315 put a down puffer on an October museum day with nothing to say against it.
  // §5.7 is explicit that an indoor destination excuses the base, never the trip.
  const highF = Number.isFinite(t?.highF) ? t.highF : (Number.isFinite(t?.transitHighF) ? t.transitHighF : null)
  const lowF = Number.isFinite(t?.lowF) ? t.lowF : (Number.isFinite(t?.transitLowF) ? t.transitLowF : null)
  const rawWind = resolvedWeather?.wind?.value ?? resolvedWeather?.wind ?? 'unknown'
  const wind = typeof rawWind === 'string' ? rawWind : 'unknown'
  const source = t?.source || resolvedWeather?.overallSource || 'unknown'

  if (highF === null && lowF === null) {
    return {
      dailyHighF: null, dailyLowF: null, wakingLowF: null, wakingHighF: null,
      wind, source, conditionsSource: 'unknown', coarse: true, known: false,
    }
  }

  const window = estimateWakingWindow(highF, lowF)
  // A model estimate five weeks out and a live forecast for tomorrow are both estimates of the
  // waking window here, but they are not equally trustworthy, so the tier records which.
  const conditionsSource = /estimate/i.test(String(source))
    ? 'seasonal_waking_window_estimate'
    : 'waking_window_estimate'

  return {
    // The envelope is kept: it is real data, and the daily low still matters to anything genuinely
    // asking about overnight. Nothing thermal should read it — that is what wakingLowF is for.
    dailyHighF: highF,
    dailyLowF: lowF,
    wakingLowF: window ? window.wakingLowF : highF,
    wakingHighF: window ? window.wakingHighF : highF,
    wind,
    source,
    conditionsSource,
    // TRUE for both estimate tiers: the window is inferred, not observed. Only `explicit_hourly`
    // clears it, and that tier needs the forecast query to request `hourly=temperature_2m` (it asks
    // for `daily=` only today) AND a clock fact to key it — neither exists yet. See spec §10.3.
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
