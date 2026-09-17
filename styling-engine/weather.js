import { weatherProfileFromContext } from './rules.js'
import {
  PET_BANDS,
  COLD_THRESHOLD_F,
  SEVERE_COLD_THRESHOLD_F,
  COOL_LAYER_THRESHOLD_F,
  WARM_THRESHOLD_F,
  HOT_THRESHOLD_F,
  EXTREME_HEAT_F,
  classifyPetRange,
  classifyPetTemperature,
} from './biometeorology.js'

// Spec 4: live weather, built new (not ported — nothing like this existed in the repo before).
// Provider: Open-Meteo (free, no API key required — https://open-meteo.com) via its geocoding and
// forecast endpoints. Same output contract as weatherProfileFromContext ({ isHot, isCold }) plus a
// weatherSource tag, so every existing consumer (profileRuleFit, weatherFitForPiece) is a drop-in —
// no shape change needed on their side.

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
export const HOT_F = 80
// Aligned with the ambient comfort scale (biometeorology.js).
// 46°F: ambient threshold for Cold band.
export const COLD_F = COLD_THRESHOLD_F
// 64°F: below this warrants a removable cool or midweight layer.
export const COOL_LOW_F = COOL_LAYER_THRESHOLD_F
const CACHE_TTL_MS = 3 * 60 * 60 * 1000 // 3 hours — coarse enough to avoid per-piece/per-turn hammering
const FETCH_TIMEOUT_MS = 4000

// Weather context binds to a place identity, not a display spelling. This is
// deterministic/offline; geocoding still owns forecast lookup.
const US_STATE_NAMES = {
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca', colorado: 'co',
  connecticut: 'ct', delaware: 'de', florida: 'fl', georgia: 'ga', hawaii: 'hi', idaho: 'id',
  illinois: 'il', indiana: 'in', iowa: 'ia', kansas: 'ks', kentucky: 'ky', louisiana: 'la',
  maine: 'me', maryland: 'md', massachusetts: 'ma', michigan: 'mi', minnesota: 'mn',
  mississippi: 'ms', missouri: 'mo', montana: 'mt', nebraska: 'ne', nevada: 'nv',
  'new hampshire': 'nh', 'new jersey': 'nj', 'new mexico': 'nm', 'new york': 'ny',
  'north carolina': 'nc', 'north dakota': 'nd', ohio: 'oh', oklahoma: 'ok', oregon: 'or',
  pennsylvania: 'pa', 'rhode island': 'ri', 'south carolina': 'sc', 'south dakota': 'sd',
  tennessee: 'tn', texas: 'tx', utah: 'ut', vermont: 'vt', virginia: 'va', washington: 'wa',
  'west virginia': 'wv', wisconsin: 'wi', wyoming: 'wy', 'district of columbia': 'dc',
}

export function normalizedWeatherLocationIdentity(value = '') {
  let normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
  for (const [stateName, abbreviation] of Object.entries(US_STATE_NAMES)) {
    if (normalized === stateName) return abbreviation
    if (normalized.endsWith(` ${stateName}`)) {
      normalized = `${normalized.slice(0, -(stateName.length + 1))} ${abbreviation}`
      break
    }
  }
  return normalized
}

const geocodeCache = new Map() // normalized location -> { coords, expiresAt }
const weatherCache = new Map() // `${start}:${end}|${lat},${lon}` -> { data: {highs, lows}, expiresAt }
const hourlyCache = new Map() // `${date}|${lat},${lon}` -> { data: {times, temps, precip}, expiresAt }

export function serializeWeatherProfile(profile = null) {
  if (!profile || typeof profile !== 'object') return null
  const source = String(profile.weatherSource || profile.source || '').trim()
  const high = Number(profile.highF ?? profile.high_f)
  const low = Number(profile.lowF ?? profile.low_f)
  if (!source && !Number.isFinite(high) && !Number.isFinite(low)) return null
  return {
    source: source || 'unknown',
    ...(Number.isFinite(high) ? { high_f: high } : {}),
    ...(Number.isFinite(low) ? { low_f: low } : {}),
    is_hot: Boolean(profile.isHot ?? profile.is_hot),
    is_cold: Boolean(profile.isCold ?? profile.is_cold),
    is_extreme_heat: Boolean(profile.isExtremeHeat ?? profile.is_extreme_heat),
  }
}

export function restoreWeatherProfile(value = null) {
  const stored = serializeWeatherProfile(value)
  if (!stored) return null
  return {
    weatherSource: stored.source,
    ...(Number.isFinite(stored.high_f) ? { highF: stored.high_f } : {}),
    ...(Number.isFinite(stored.low_f) ? { lowF: stored.low_f } : {}),
    isHot: stored.is_hot,
    isCold: stored.is_cold,
    isExtremeHeat: stored.is_extreme_heat,
  }
}

function defaultFetch(url) {
  return fetch(url)
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('weather request timed out')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function dateKey(date) {
  const d = date instanceof Date ? date : new Date(date)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

async function geocodeQuery(query, fetchImpl) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=1&language=en&format=json`
  const res = await withTimeout(fetchImpl(url), FETCH_TIMEOUT_MS)
  if (!res?.ok) return null
  const data = await res.json()
  const first = data?.results?.[0]
  if (!first || typeof first.latitude !== 'number' || typeof first.longitude !== 'number') return null
  return { lat: first.latitude, lon: first.longitude }
}

async function resolveLocationToCoords(location, fetchImpl) {
  const key = String(location || '').trim().toLowerCase()
  if (!key) return null
  const cached = geocodeCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.coords
  let coords = await geocodeQuery(key, fetchImpl)
  if (!coords) {
    // "City, ST" / "City, State" is an extremely common way to type a US location, but Open-Meteo's
    // geocoder returns zero results for the combined string (confirmed live, 2026-07-10 — "Walnut
    // Creek, CA" silently failed and fell back to the heuristic weather guess with no error surfaced,
    // even though "Walnut Creek" alone resolves correctly). Retry with just the part before the comma.
    const cityOnly = key.split(',')[0].trim()
    if (cityOnly && cityOnly !== key) {
      coords = await geocodeQuery(cityOnly, fetchImpl)
    }
  }
  if (!coords) return null
  geocodeCache.set(key, { coords, expiresAt: Date.now() + CACHE_TTL_MS })
  return coords
}

async function fetchDailyRange(coords, startDate, endDate, fetchImpl) {
  const start = dateKey(startDate)
  const end = dateKey(endDate || startDate)
  if (!start || !end) return null
  const cacheKey = `${start}:${end}|${coords.lat.toFixed(2)},${coords.lon.toFixed(2)}`
  const cached = weatherCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.data
  const url = `${FORECAST_URL}?latitude=${coords.lat}&longitude=${coords.lon}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&start_date=${start}&end_date=${end}`
  const res = await withTimeout(fetchImpl(url), FETCH_TIMEOUT_MS)
  if (!res?.ok) return null
  const data = await res.json()
  const highs = data?.daily?.temperature_2m_max || []
  const lows = data?.daily?.temperature_2m_min || []
  if (!highs.length || !lows.length) return null
  const result = { highs, lows }
  weatherCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS })
  return result
}

// Activity time windows & material exposure sensitivity (spec 2026-09-17). Open-Meteo's free forecast
// endpoint carries hourly data for the same ~16-day rolling horizon its daily data covers (verified
// live 2026-09-16: a date 6 days out returns hourly temperature_2m/precipitation normally; a date 3
// months out returns an explicit "start_date is out of allowed range" error) — no separate product,
// no separate key, just a different query param on the same URL. This is genuinely new information
// the app did not have before: a slot's exposure can now be sliced to when the wearer actually
// expects to be outside, instead of the day's full envelope.
async function fetchHourlyRange(coords, startDate, endDate, fetchImpl) {
  const start = dateKey(startDate)
  const end = dateKey(endDate || startDate)
  if (!start || !end) return null
  const cacheKey = `${start}:${end}|${coords.lat.toFixed(2)},${coords.lon.toFixed(2)}`
  const cached = hourlyCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.data
  const url = `${FORECAST_URL}?latitude=${coords.lat}&longitude=${coords.lon}&hourly=temperature_2m,precipitation&temperature_unit=fahrenheit&timezone=auto&start_date=${start}&end_date=${end}`
  const res = await withTimeout(fetchImpl(url), FETCH_TIMEOUT_MS)
  if (!res?.ok) return null
  const data = await res.json()
  const times = data?.hourly?.time || []
  const temps = data?.hourly?.temperature_2m || []
  const precip = data?.hourly?.precipitation || []
  if (!times.length) return null
  const result = { times, temps, precip }
  hourlyCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS })
  return result
}

// Canonical waking outdoor dayparts (spec §5). Night (21:00-08:00) is deliberately excluded from
// "plausible outdoor recreation exposure" — this states an assumption about ORDINARY waking activity
// timing, the same kind of stated, labelled assumption WAKING_WINDOW.troughOffsetFraction already is
// below, not a claim about when any specific activity happens. A user who explicitly asks for a night
// activity states their own time_window and bypasses daypart guessing entirely.
export const DAYPARTS = {
  morning: { startHour: 8, endHour: 12 },
  afternoon: { startHour: 12, endHour: 17 },
  evening: { startHour: 17, endHour: 21 },
}

// An explicit start_local/end_local pair wins over a named period; a bare period maps to its
// DAYPARTS range. Hours are LOCAL (Open-Meteo's timezone=auto returns local ISO timestamps, and
// fetchHourlyRange never converts them), matching how a wearer states "morning" or "9am".
function resolveTimeWindowHours(timeWindow = null) {
  const startLocal = String(timeWindow?.start_local || '').trim()
  const endLocal = String(timeWindow?.end_local || '').trim()
  const parseHour = value => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value)
    return match ? Number(match[1]) : null
  }
  const startHour = parseHour(startLocal)
  const endHour = parseHour(endLocal)
  if (Number.isFinite(startHour) && Number.isFinite(endHour) && endHour > startHour) {
    return { startHour, endHour }
  }
  // 'midday' is the schema's own synonym for the afternoon daypart (plan_outfit_set's time_window
  // enum states both spellings; DAYPARTS keeps one canonical key).
  const period = String(timeWindow?.period || '').toLowerCase().trim()
  return DAYPARTS[period === 'midday' ? 'afternoon' : period] || null
}

// Slices an hourly series to one calendar date's [startHour, endHour) local window and reduces it to
// the range actually encountered — a range, never a point, same discipline as estimateWakingWindow.
function sliceHourlyWindow(hourly, date, { startHour, endHour } = {}) {
  const dateStr = dateKey(date)
  if (!dateStr || !hourly?.times?.length) return null
  const temps = []
  let sawRain = false
  for (let i = 0; i < hourly.times.length; i += 1) {
    const timestamp = String(hourly.times[i] || '')
    if (!timestamp.startsWith(dateStr)) continue
    const hour = Number(timestamp.slice(11, 13))
    if (!Number.isFinite(hour) || hour < startHour || hour >= endHour) continue
    const temp = hourly.temps[i]
    if (Number.isFinite(temp)) temps.push(temp)
    const precip = hourly.precip[i]
    if (Number.isFinite(precip) && precip > 0) sawRain = true
  }
  if (!temps.length) return null
  return { highF: Math.max(...temps), lowF: Math.min(...temps), precipitation: sawRain ? 'rain' : 'none' }
}

// The near-term path (spec §4): resolves live hourly data sliced to a stated or inferred time
// window, for a single calendar date. Returns null on anything ungeocodable, out of the live
// horizon, or lacking hourly coverage for that date — callers degrade to the existing waking-window
// estimate on null, never fabricate hourly certainty from a day this call could not resolve.
export async function resolveExposureWindowHourly({ location = '', date = '', timeWindow = null, fetchImpl = defaultFetch } = {}) {
  if (shouldSkipLive(fetchImpl) || !location || !date) return null
  const hours = resolveTimeWindowHours(timeWindow)
  if (!hours) return null
  try {
    const coords = await resolveLocationToCoords(location, fetchImpl)
    if (!coords) return null
    const hourly = await fetchHourlyRange(coords, date, date, fetchImpl)
    if (!hourly) return null
    const sliced = sliceHourlyWindow(hourly, date, hours)
    if (!sliced) return null
    // Same classification classify() gives resolveLive's daily range, applied to the sliced window
    // instead of the whole day — the same downstream isHot/isCold/needsRemovableCoolLayer/
    // isExtremeHeat consumers (resolveSlotWeather, tripRosterFailures) read regardless of source.
    return {
      ...classify([sliced.highF], [sliced.lowF], { exclusive: true }),
      precipitation: sliced.precipitation,
      weatherSource: 'live_hourly',
      scope: 'exposure_window',
    }
  } catch {
    return null
  }
}

// The no-time-stated path (spec §6): resolves the same hourly series once, sliced into all three
// canonical dayparts, for a caller (outfitSetPlanner.js) to judge whether the plausible windows are
// PHYSICALLY distinguishable — this function states facts only, never a materiality verdict. Returns
// null under the same conditions resolveExposureWindowHourly does.
export async function resolveDaypartHourlyEvidence({ location = '', date = '', fetchImpl = defaultFetch } = {}) {
  if (shouldSkipLive(fetchImpl) || !location || !date) return null
  try {
    const coords = await resolveLocationToCoords(location, fetchImpl)
    if (!coords) return null
    const hourly = await fetchHourlyRange(coords, date, date, fetchImpl)
    if (!hourly) return null
    const evidence = {}
    for (const [period, hours] of Object.entries(DAYPARTS)) {
      evidence[period] = sliceHourlyWindow(hourly, date, hours)
    }
    if (Object.values(evidence).every(entry => !entry)) return null
    return evidence
  } catch {
    return null
  }
}

// `exclusive`: a single day is rarely legitimately both hot and cold, so isHot/isCold are mutually
// exclusive (matching weatherProfileFromContext's contract). A multi-day trip range genuinely can
// span both — non-exclusive lets a packing plan flag both extremes instead of suppressing one.
function classify(highs, lows, { exclusive = true } = {}) {
  const maxHigh = Math.max(...highs)
  const minLow = Math.min(...lows)
  const isHot = maxHigh >= HOT_F
  const isCold = minLow < COLD_F
  const observedRange = { highF: maxHigh, lowF: minLow }
  const extreme = maxHigh >= EXTREME_HEAT_F ? { isExtremeHeat: true } : {}
  const needsRemovableCoolLayer = minLow <= COOL_LOW_F && !isCold
  if (!exclusive) return { isHot, isCold, needsRemovableCoolLayer, ...extreme, ...observedRange }
  return { isHot: isHot && !isCold, isCold: isCold && !isHot, needsRemovableCoolLayer, ...extreme, ...observedRange }
}

async function resolveLive({ startDate, endDate, location, fetchImpl, exclusive }) {
  const coords = await resolveLocationToCoords(location, fetchImpl)
  if (!coords) return null
  const range = await fetchDailyRange(coords, startDate, endDate, fetchImpl)
  if (!range) return null
  return { ...classify(range.highs, range.lows, { exclusive }), weatherSource: 'live' }
}

function heuristic({ mood, season, currentDate, seasonIsCalendarOnly }) {
  return { ...weatherProfileFromContext({ mood, season, currentDate, seasonIsCalendarOnly }), weatherSource: 'heuristic' }
}

function unavailable(reason = 'forecast_unavailable') {
  return {
    isHot: false,
    isCold: false,
    isRainy: false,
    isWetExposure: false,
    weatherSource: 'unavailable',
    weatherFailure: reason
  }
}

// Skip live resolution entirely under `node --test` unless a test explicitly injects its own
// fetchImpl (used to exercise the live path deterministically without real network calls). This
// guarantees the automated suite never depends on network access, matching the existing
// takeTestAiResponse convention in provider.js.
function shouldSkipLive(fetchImpl) {
  return process.env.NODE_ENV === 'test' && fetchImpl === defaultFetch
}

export async function getCurrentWeatherProfile({ date = new Date(), location = '', mood = '', season = '', fetchImpl = defaultFetch } = {}) {
  if (!location || shouldSkipLive(fetchImpl)) return heuristic({ mood, season, currentDate: date })
  try {
    const live = await resolveLive({ startDate: date, endDate: date, location, fetchImpl, exclusive: true })
    return live || unavailable('location_or_forecast_not_found')
  } catch {
    return unavailable('weather_request_failed')
  }
}

export async function getWeatherProfileForPlan({ dateRange = {}, location = '', mood = '', season = '', fetchImpl = defaultFetch, seasonIsCalendarOnly = false } = {}) {
  const { start, end } = dateRange || {}
  if (!location || !start || shouldSkipLive(fetchImpl)) return heuristic({ mood, season, currentDate: start, seasonIsCalendarOnly })
  try {
    const live = await resolveLive({ startDate: start, endDate: end || start, location, fetchImpl, exclusive: false })
    return live || unavailable('location_or_forecast_not_found')
  } catch {
    return unavailable('weather_request_failed')
  }
}

export function _clearWeatherCachesForTests() {
  geocodeCache.clear()
  weatherCache.clear()
  hourlyCache.clear()
}

// ============================================================================
// Structured weather context (docs/future-trip-weather-estimate-spec.md)
// ============================================================================
//
// Owner ruling 2026-08-30: the model translates natural language into typed
// tool arguments; code never parses arbitrary prose into gate-driving
// physical weather. This section is the ENTIRE authority for that — no
// consumer of ResolvedWeatherContext re-parses numbers or condition words
// from text anywhere else.

const TEMP_MIN_F = -100
const TEMP_MAX_F = 140
export const PRECIPITATION_VALUES = ['none', 'rain', 'snow', 'mixed', 'unknown']
export const WIND_VALUES = ['calm', 'breezy', 'windy', 'unknown']
export const TEMPERATURE_BAND_VALUES = ['hot', 'cold', 'mild']
// thread_1789526496845: does a stated numeric range describe what the wearer will actually be
// outside in (exposure_window), or the day's general forecast stated separately from a narrower
// outing (daily_forecast)? See validateUserWeather.
export const TEMPERATURE_SCOPE_VALUES = ['exposure_window', 'daily_forecast']

// THE canonical structured-precipitation → wet-exposure rule. Two projections of a resolved
// ResolvedWeatherContext need this fact — stylingContext.js's profileFromResolvedWeatherContext
// (the general conversational-stylist path) and resolveSlotWeather (outfitSetPlanner.js, the
// trip/plan slot path) — and until now only the first one computed it, so a real plan_outfit_set/
// trip turn's resolved rain/mixed precipitation never became isWetExposure/isRainy on that slot's
// weatherProfile: RAIN_PROTECTION_MISSING and the wet-sensitive-footwear gate could never fire for
// a trip card no matter how rainy the resolved weather was. Extracted here, rather than left as two
// copies of the same two-line expression, specifically so the next consumer reuses this instead of
// re-deriving a third interpretation — precisely the drift this file's own header docstring exists
// to prevent for every other structured-weather rule.
export function wetExposureFromPrecipitation(precipitationValue) {
  const value = String(precipitationValue || '')
  return {
    isRainy: value === 'rain',
    isWetExposure: value === 'rain' || value === 'mixed',
  }
}

// Requires an ACTUAL number, not merely a coercible value: `Number(null)`
// is 0 and `Number("65")` is 65, so a coercing check would silently accept
// {high_f:null, low_f:null} as 0°F/0°F, or a model-hallucinated string
// "65" as a real number — both slipped through when call sites coerced
// with Number(...) before this check ever ran. The tool schema types these
// fields as JSON `number`; the executor validator now actually enforces it.
function isFiniteTemp(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= TEMP_MIN_F && n <= TEMP_MAX_F
}

// Spec §5.3: same thresholds/constants as live weather, reused everywhere —
// a model estimate, a user-stated range, and a live forecast all trigger
// identical downstream gates. `exclusive` mirrors classify() above: a
// single reading is mutually exclusive hot/cold, but a stated or estimated
// RANGE (a whole trip, not one instant) can genuinely be both — a 90°F/40°F
// range must not silently collapse to neither.
export function classifyTemperatureRange({ highF, lowF } = {}, { exclusive = true } = {}) {
  const hasHigh = Number.isFinite(highF)
  const hasLow = Number.isFinite(lowF)
  if (!hasHigh && !hasLow) return { isHot: false, isCold: false }
  // A one-sided stated range ("highs near 85") genuinely lacks the other endpoint. isHot is a
  // fact about the high, isCold a fact about the low — each is computable independently when its
  // own endpoint is known, and stays false (not manufactured) when it is not.
  const isHot = hasHigh && highF >= HOT_F
  const isCold = hasLow && lowF < COLD_F
  const extreme = hasHigh && highF >= EXTREME_HEAT_F ? { isExtremeHeat: true } : {}
  if (!exclusive) return { isHot, isCold, ...extreme }
  return { isHot: isHot && !isCold, isCold: isCold && !isHot, ...extreme }
}

// Spec §4.1: a real user_weather object carries EITHER a numeric range OR a
// qualitative band, never both — they have different confidence and the
// model must not blend them. At least one of temperature/precipitation/wind
// must be present, or this is not really "the user stated weather" at all.
export function validateUserWeather(input) {
  if (!input || typeof input !== 'object') return null
  const hasRange = input.high_f !== undefined || input.low_f !== undefined
  const hasBand = input.temperature_band !== undefined && input.temperature_band !== null
  if (hasRange && hasBand) return null

  let temperature = null
  if (hasRange) {
    const highF = input.high_f
    const lowF = input.low_f
    const hasHigh = highF !== undefined && highF !== null
    const hasLow = lowF !== undefined && lowF !== null
    // thread_1789526496845 (reopened 2026-09-16): a numeric range is not automatically the range
    // the wearer will actually be outside in. `scope` distinguishes the two claims the model can
    // make with the SAME two numbers, so the executor can tell them apart:
    //   exposure_window  — these ARE the temperatures the wearer will encounter during the outing.
    //   daily_forecast   — this is the day's overall high/low, decoupled from the stated outing.
    // Defaults to exposure_window (the prior, only behavior) so the dedicated "Temperatures you'll
    // be out in" UI field (docs/app-surface-map.md, 2026-09-12 ruling) and any caller that predates
    // this field are completely unaffected. The scope is carried on the temperature object itself
    // (not discarded) so `weather.js`/`exposure.js` can size confidence off it without collapsing
    // the numbers into a qualitative band — a daily forecast is still real numeric evidence, just
    // uncertain relative to the outing, not evidence-free.
    const scope = TEMPERATURE_SCOPE_VALUES.includes(input.scope) ? input.scope : 'exposure_window'
    // 2026-09-15 (spec §4.1 amended): an explicitly one-sided forecast — "highs near 85" — states
    // one endpoint and leaves the other genuinely unknown. Requiring both meant the only way to
    // pass such a statement through was to set both to the same value, manufacturing a low the
    // user never gave. A single endpoint is now a valid stated temperature; the unknown side stays
    // null, which every downstream helper already handles (classifyTemperatureRange,
    // coldSevereForRange, needsRemovableCoolLayerForRange, serializeWeatherProfile).
    // A POINT temperature is unchanged and still arrives as both endpoints set to the same value.
    if (hasHigh && hasLow) {
      if (!isFiniteTemp(highF) || !isFiniteTemp(lowF) || highF < lowF) return null
      temperature = { highF, lowF, band: null, scope }
    } else if (hasHigh) {
      if (!isFiniteTemp(highF)) return null
      temperature = { highF, lowF: null, band: null, scope }
    } else {
      if (!isFiniteTemp(lowF)) return null
      temperature = { highF: null, lowF, band: null, scope }
    }
  } else if (hasBand) {
    if (!TEMPERATURE_BAND_VALUES.includes(input.temperature_band)) return null
    temperature = { highF: null, lowF: null, band: input.temperature_band }
  }

  let precipitation = null
  if (input.precipitation !== undefined && input.precipitation !== null) {
    if (!PRECIPITATION_VALUES.includes(input.precipitation)) return null
    precipitation = input.precipitation
  }

  let wind = null
  if (input.wind !== undefined && input.wind !== null) {
    if (!WIND_VALUES.includes(input.wind)) return null
    wind = input.wind
  }

  if (!temperature && !precipitation && !wind) return null
  return { temperature, precipitation, wind }
}

// Spec §4.1: a model estimate is ALWAYS numeric (no temperature_band — an
// estimate used for a hard gate must commit to a real range, not a vague
// qualitative guess) and never carries free-text `conditions`.
export function validateWeatherEstimate(input) {
  if (!input || typeof input !== 'object') return null
  const highF = input.high_f
  const lowF = input.low_f
  if (!isFiniteTemp(highF) || !isFiniteTemp(lowF) || highF < lowF) return null

  let precipitation = null
  if (input.precipitation !== undefined && input.precipitation !== null) {
    if (!PRECIPITATION_VALUES.includes(input.precipitation)) return null
    precipitation = input.precipitation
  }

  let wind = null
  if (input.wind !== undefined && input.wind !== null) {
    if (!WIND_VALUES.includes(input.wind)) return null
    wind = input.wind
  }

  return { highF, lowF, precipitation, wind }
}

// Severity on the structured path is decided by the DAYTIME HIGH, not by isCold.
//
// It briefly tracked isCold exactly (added 2026-09-01 with [R1] of
// docs/outerwear-weather-consolidation-spec.md, justified as "identical thresholds: COLD_F is 45 and
// the severe rule is <= 45F"). That holds for a single stated reading. It is wrong for a RANGE, and
// it reproduced the very incident cold-severity-spec.md exists to prevent — this time through the
// structured path rather than the prose one. A live 65F/45F week-long trip resolved as severe cold
// because the LOW touched 45, which put the heavy-fabric +10 relevance bonus and Contract C's
// outdoor-layer requirement behind a puffer coat in all five cards, including a 65F city walk. The
// owner called it out twice in the same thread.
//
// The deeper reason, and why this keys on the high rather than on "high OR a deep low": the daily
// LOW occurs before dawn, when nobody is dressed for it. Using it to decide outfit warmth dresses
// the wearer for a temperature they experience asleep. The HIGH is the temperature they are actually
// out in, so "the day never gets out of cold" is the honest test for "heavy is what you actually
// want" — cold-severity-spec.md's own definition of the severe tier.
//
// isCold itself is deliberately UNCHANGED and still comes from the low: it is the minimum-warmth
// floor, and a 45F morning genuinely needs a layer. Only the maximize-toward-winter tier moves.
// Whether isCold should key on the low at all is a larger, open question — recorded in
// cold-severity-spec.md rather than decided here.
export const SEVERE_COLD_F = 45

const coldSevereForRange = ({ highF, lowF } = {}) =>
  Number.isFinite(highF) ? highF <= SEVERE_COLD_F : Number.isFinite(lowF) ? lowF <= SEVERE_COLD_F : false

// docs/cool-weather-tier-spec.md. Does this outfit need a REMOVABLE layer for the cold end of the
// day? Read off the low, and — per §5.2 — this is a range-level PROXY for an unspecified or full-day
// wearing period, not a claim that the daily low governs every slot on the date. A 1-4pm museum
// visit does not really need a layer mandated by the 5am low; narrowing that needs daypart weather
// the planner does not have, so the conservative all-day answer ships first.
const needsRemovableCoolLayerForRange = ({ highF, lowF } = {}) =>
  Number.isFinite(lowF) ? lowF <= COOL_LOW_F : Number.isFinite(highF) ? highF <= COOL_LOW_F : false

const BAND_FLAGS = {
  hot: { isHot: true, isCold: false, isColdSevere: false, needsRemovableCoolLayer: false },
  cold: { isHot: false, isCold: true, isColdSevere: false, needsRemovableCoolLayer: true },
  mild: { isHot: false, isCold: false, isColdSevere: false, needsRemovableCoolLayer: false },
}

function resolveTemperatureField({ userTemperature, liveTemperature, estimateTemperature }) {
  if (userTemperature) {
    if (userTemperature.band) {
      return {
        highF: null, lowF: null, band: userTemperature.band,
        ...BAND_FLAGS[userTemperature.band],
        isExtremeHeat: false,
        source: 'stated_user',
      }
    }
    const classified = classifyTemperatureRange(userTemperature, { exclusive: false })
    return {
      highF: userTemperature.highF, lowF: userTemperature.lowF, band: null,
      isHot: Boolean(classified.isHot), isCold: Boolean(classified.isCold),
      isColdSevere: coldSevereForRange(userTemperature),
      needsRemovableCoolLayer: needsRemovableCoolLayerForRange(userTemperature),
      isExtremeHeat: Boolean(classified.isExtremeHeat),
      source: 'stated_user',
      // thread_1789526496845: carried through so exposure.js can size confidence off it —
      // 'exposure_window' (default) keeps the prior, verbatim-certain treatment; 'daily_forecast'
      // means these are real numbers that are NOT a claim about the stated outing specifically.
      scope: userTemperature.scope || 'exposure_window',
    }
  }
  if (liveTemperature && Number.isFinite(liveTemperature.highF) && Number.isFinite(liveTemperature.lowF)) {
    return {
      highF: liveTemperature.highF, lowF: liveTemperature.lowF, band: null,
      isHot: Boolean(liveTemperature.isHot), isCold: Boolean(liveTemperature.isCold),
      isColdSevere: coldSevereForRange(liveTemperature),
      needsRemovableCoolLayer: needsRemovableCoolLayerForRange(liveTemperature),
      isExtremeHeat: Boolean(liveTemperature.isExtremeHeat),
      source: 'live',
    }
  }
  if (estimateTemperature) {
    const classified = classifyTemperatureRange(estimateTemperature, { exclusive: false })
    return {
      highF: estimateTemperature.highF, lowF: estimateTemperature.lowF, band: null,
      isHot: Boolean(classified.isHot), isCold: Boolean(classified.isCold),
      isColdSevere: coldSevereForRange(estimateTemperature),
      needsRemovableCoolLayer: needsRemovableCoolLayerForRange(estimateTemperature),
      isExtremeHeat: Boolean(classified.isExtremeHeat),
      source: 'model_estimate',
    }
  }
  return { highF: null, lowF: null, band: null, isHot: false, isCold: false, isColdSevere: false, needsRemovableCoolLayer: false, isExtremeHeat: false, source: 'unavailable' }
}

function resolveConditionField(fieldName, { userWeather, liveValue, modelEstimate }) {
  const userValue = userWeather?.[fieldName]
  // 'unknown' means the user didn't actually say anything about this field —
  // it must fall through to the next tier, not win the field-level precedence
  // outright. Spec explicitly calls this out: 'unknown' must not override a
  // known lower-precedence value (e.g. a real model_estimate 'rain').
  if (userValue && userValue !== 'unknown') return { value: userValue, source: 'stated_user' }
  if (liveValue) return { value: liveValue, source: 'live' }
  const estimateValue = modelEstimate?.[fieldName]
  if (estimateValue && estimateValue !== 'unknown') return { value: estimateValue, source: 'model_estimate' }
  return { value: 'unknown', source: 'unavailable' }
}

const RESOLVED_FIELD_SOURCE_PRIORITY = {
  unavailable: 0,
  heuristic: 1,
  model_estimate: 2,
  live: 3,
  stated_user: 4,
}

function preferResolvedField(freshField, cachedField) {
  if (!cachedField || typeof cachedField !== 'object') return freshField
  const freshPriority = RESOLVED_FIELD_SOURCE_PRIORITY[freshField?.source] ?? 0
  const cachedPriority = RESOLVED_FIELD_SOURCE_PRIORITY[cachedField.source] ?? 0
  // A newly supplied field replaces an older field at the same authority;
  // the cache wins only when its retained source is genuinely stronger.
  return cachedPriority > freshPriority ? { ...cachedField } : freshField
}

// Spec §5.1-§5.2: the ONE resolved shape every downstream consumer (roster
// construction, workbench copy, validator, cards, thread state) reads.
// Pure and synchronous — callers resolve live weather (an async network
// call) separately and pass the result in; this function only combines
// already-validated/already-fetched pieces under the field-level precedence
// each dimension resolves independently: explicit structured user field →
// matching live field → matching structured model-estimate field →
// unavailable. A user-stated PRECIPITATION does not block LIVE temperature
// from winning, and vice versa — "the user said rainy, live says 65/45"
// keeps both facts instead of one erasing the other. `fallbackContext` is
// accepted only after a caller has proved matching location/date identity;
// it supplies previously resolved fields that this update did not replace.
export function resolveWeatherContext({ userWeather = null, liveWeather = null, modelEstimate = null, fallbackContext = null, location = '', dateRange = null } = {}) {
  const liveTemperature = liveWeather && liveWeather.weatherSource === 'live'
    ? { highF: liveWeather.highF, lowF: liveWeather.lowF, isHot: liveWeather.isHot, isCold: liveWeather.isCold, isExtremeHeat: liveWeather.isExtremeHeat }
    : null

  const resolvedTemperature = resolveTemperatureField({
    userTemperature: userWeather?.temperature || null,
    liveTemperature,
    estimateTemperature: modelEstimate ? { highF: modelEstimate.highF, lowF: modelEstimate.lowF } : null,
  })
  const temperature = preferResolvedField(resolvedTemperature, fallbackContext?.temperature)
  // Live weather currently carries no precipitation/wind data (Open-Meteo
  // call only fetches temperature_2m_max/min) — those dimensions fall
  // through past 'live' to a model estimate or stay unavailable. No
  // existing hard rule requires them to be more than that (spec §5.2).
  const resolvedPrecipitation = resolveConditionField('precipitation', { userWeather, liveValue: null, modelEstimate })
  const precipitation = preferResolvedField(resolvedPrecipitation, fallbackContext?.precipitation)
  const resolvedWind = resolveConditionField('wind', { userWeather, liveValue: null, modelEstimate })
  const wind = preferResolvedField(resolvedWind, fallbackContext?.wind)

  const sources = new Set([temperature.source, precipitation.source, wind.source].filter(s => s !== 'unavailable'))
  const overallSource = sources.size === 0 ? 'unavailable' : sources.size === 1 ? [...sources][0] : 'mixed'

  return {
    status: temperature.source === 'unavailable' ? 'unavailable' : 'resolved',
    location: String(location || ''),
    dateRange: dateRange || null,
    temperature,
    precipitation,
    wind,
    overallSource,
  }
}

// Spec §6.1: the one entry point every composition tool calls before
// retrieval. Fetches live weather itself (reusing the same geocode/forecast
// plumbing as getWeatherProfileForPlan) and combines it with already-
// validated userWeather/modelEstimate via resolveWeatherContext above.
//
// With no location/date, there is no destination to resolve live weather
// against — this is the "at-home/current-season" case, and it deliberately
// falls back to the existing calendar/mood heuristic (weatherProfileFromContext)
// exactly as before this spec (spec §6.1: "a deliberate no-op"). That
// heuristic result is tagged weatherSource 'heuristic' and never treated as
// resolved for a named destination/date.
export async function resolveWeatherForRequest({
  location = '',
  dateRange = null,
  userWeather = null,
  modelEstimate = null,
  mood = '',
  season = '',
  fetchImpl = defaultFetch,
  seasonIsCalendarOnly = false,
} = {}) {
  const start = dateRange?.start || null
  const hasDestination = Boolean(location) && Boolean(start)
  const normalizedUserWeather = userWeather?.temperature !== undefined ? userWeather : (validateUserWeather(userWeather) || userWeather)
  const normalizedModelEstimate = modelEstimate?.highF !== undefined ? modelEstimate : (validateWeatherEstimate(modelEstimate) || modelEstimate)

  if (!hasDestination) {
    // A user-stated or estimated temperature still wins even without a live
    // lookup being attempted (an at-home request can still carry a stated
    // band, e.g. "it's cold today") — only the LIVE branch is skipped.
    const resolved = resolveWeatherContext({ userWeather: normalizedUserWeather, liveWeather: null, modelEstimate: normalizedModelEstimate, location, dateRange })
    if (resolved.status === 'resolved') return resolved
    const heuristicProfile = heuristic({ mood, season, currentDate: start, seasonIsCalendarOnly })
    return {
      status: 'resolved',
      location: String(location || ''),
      dateRange: dateRange || null,
      temperature: {
        highF: Number.isFinite(heuristicProfile.highF) ? heuristicProfile.highF : null,
        lowF: Number.isFinite(heuristicProfile.lowF) ? heuristicProfile.lowF : null,
        band: null,
        isHot: Boolean(heuristicProfile.isHot),
        isCold: Boolean(heuristicProfile.isCold),
        isExtremeHeat: Boolean(heuristicProfile.isExtremeHeat),
        source: 'heuristic',
      },
      precipitation: { value: heuristicProfile.isRainy ? 'rain' : 'unknown', source: heuristicProfile.isRainy ? 'heuristic' : 'unavailable' },
      wind: { value: 'unknown', source: 'unavailable' },
      overallSource: 'heuristic',
    }
  }

  let liveWeather = null
  try {
    liveWeather = await resolveLive({ startDate: start, endDate: dateRange?.end || start, location, fetchImpl, exclusive: false })
  } catch {
    liveWeather = null
  }

  return resolveWeatherContext({ userWeather: normalizedUserWeather, liveWeather, modelEstimate: normalizedModelEstimate, location, dateRange })
}

// Spec §5.1, §7: persistence shape for cards / current_outfit_set / thread
// state. Serializes the full field-level provenance, not just the flat
// isHot/isCold pair serializeWeatherProfile above preserves for the legacy
// shape.
export function serializeResolvedWeatherContext(context = null) {
  if (!context || typeof context !== 'object') return null
  return {
    status: context.status,
    location: context.location || '',
    date_range: context.dateRange || null,
    temperature: {
      high_f: Number.isFinite(context.temperature?.highF) ? context.temperature.highF : null,
      low_f: Number.isFinite(context.temperature?.lowF) ? context.temperature.lowF : null,
      band: context.temperature?.band || null,
      is_hot: Boolean(context.temperature?.isHot),
      is_cold: Boolean(context.temperature?.isCold),
      // [R1]: severity must survive persistence, not just resolution. A field that resolves but
      // does not round-trip vanishes on the next turn's carry-forward — the same silent-loss shape
      // that left isColdSevere undefined at the validator in the first place.
      is_cold_severe: Boolean(context.temperature?.isColdSevere),
      needs_removable_cool_layer: Boolean(context.temperature?.needsRemovableCoolLayer),
      is_extreme_heat: Boolean(context.temperature?.isExtremeHeat),
      source: context.temperature?.source || 'unavailable',
    },
    precipitation: { value: context.precipitation?.value || 'unknown', source: context.precipitation?.source || 'unavailable' },
    wind: { value: context.wind?.value || 'unknown', source: context.wind?.source || 'unavailable' },
    overall_source: context.overallSource || 'unavailable',
  }
}

export function restoreResolvedWeatherContext(stored = null) {
  if (!stored || typeof stored !== 'object') return null
  const t = stored.temperature || {}
  return {
    status: stored.status || 'unavailable',
    location: stored.location || '',
    dateRange: stored.date_range || null,
    temperature: {
      highF: Number.isFinite(t.high_f) ? t.high_f : null,
      lowF: Number.isFinite(t.low_f) ? t.low_f : null,
      band: t.band || null,
      isHot: Boolean(t.is_hot),
      isCold: Boolean(t.is_cold),
      isColdSevere: Boolean(t.is_cold_severe),
      needsRemovableCoolLayer: Boolean(t.needs_removable_cool_layer),
      isExtremeHeat: Boolean(t.is_extreme_heat),
      source: t.source || 'unavailable',
    },
    precipitation: { value: stored.precipitation?.value || 'unknown', source: stored.precipitation?.source || 'unavailable' },
    wind: { value: stored.wind?.value || 'unknown', source: stored.wind?.source || 'unavailable' },
    overallSource: stored.overall_source || 'unavailable',
  }
}
