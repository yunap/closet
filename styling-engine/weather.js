import { weatherProfileFromContext } from './rules.js'

// Spec 4: live weather, built new (not ported — nothing like this existed in the repo before).
// Provider: Open-Meteo (free, no API key required — https://open-meteo.com) via its geocoding and
// forecast endpoints. Same output contract as weatherProfileFromContext ({ isHot, isCold }) plus a
// weatherSource tag, so every existing consumer (profileRuleFit, weatherFitForPiece) is a drop-in —
// no shape change needed on their side.

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const HOT_F = 80
const COLD_F = 45
const EXTREME_HEAT_F = 100
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

// `exclusive`: a single day is rarely legitimately both hot and cold, so isHot/isCold are mutually
// exclusive (matching weatherProfileFromContext's contract). A multi-day trip range genuinely can
// span both — non-exclusive lets a packing plan flag both extremes instead of suppressing one.
function classify(highs, lows, { exclusive = true } = {}) {
  const maxHigh = Math.max(...highs)
  const minLow = Math.min(...lows)
  const isHot = maxHigh >= HOT_F
  const isCold = minLow <= COLD_F
  const observedRange = { highF: maxHigh, lowF: minLow }
  const extreme = maxHigh >= EXTREME_HEAT_F ? { isExtremeHeat: true } : {}
  if (!exclusive) return { isHot, isCold, ...extreme, ...observedRange }
  return { isHot: isHot && !isCold, isCold: isCold && !isHot, ...extreme, ...observedRange }
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
  if (!Number.isFinite(highF) || !Number.isFinite(lowF)) return { isHot: false, isCold: false }
  const isHot = highF >= HOT_F
  const isCold = lowF <= COLD_F
  const extreme = highF >= EXTREME_HEAT_F ? { isExtremeHeat: true } : {}
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
    if (!isFiniteTemp(highF) || !isFiniteTemp(lowF) || highF < lowF) return null
    temperature = { highF, lowF, band: null }
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

const BAND_FLAGS = {
  hot: { isHot: true, isCold: false },
  cold: { isHot: false, isCold: true },
  mild: { isHot: false, isCold: false },
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
      isHot: Boolean(classified.isHot), isCold: Boolean(classified.isCold), isExtremeHeat: Boolean(classified.isExtremeHeat),
      source: 'stated_user',
    }
  }
  if (liveTemperature && Number.isFinite(liveTemperature.highF) && Number.isFinite(liveTemperature.lowF)) {
    return {
      highF: liveTemperature.highF, lowF: liveTemperature.lowF, band: null,
      isHot: Boolean(liveTemperature.isHot), isCold: Boolean(liveTemperature.isCold),
      isExtremeHeat: Boolean(liveTemperature.isExtremeHeat),
      source: 'live',
    }
  }
  if (estimateTemperature) {
    const classified = classifyTemperatureRange(estimateTemperature, { exclusive: false })
    return {
      highF: estimateTemperature.highF, lowF: estimateTemperature.lowF, band: null,
      isHot: Boolean(classified.isHot), isCold: Boolean(classified.isCold), isExtremeHeat: Boolean(classified.isExtremeHeat),
      source: 'model_estimate',
    }
  }
  return { highF: null, lowF: null, band: null, isHot: false, isCold: false, isExtremeHeat: false, source: 'unavailable' }
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

  if (!hasDestination) {
    // A user-stated or estimated temperature still wins even without a live
    // lookup being attempted (an at-home request can still carry a stated
    // band, e.g. "it's cold today") — only the LIVE branch is skipped.
    const resolved = resolveWeatherContext({ userWeather, liveWeather: null, modelEstimate, location, dateRange })
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

  return resolveWeatherContext({ userWeather, liveWeather, modelEstimate, location, dateRange })
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
      isExtremeHeat: Boolean(t.is_extreme_heat),
      source: t.source || 'unavailable',
    },
    precipitation: { value: stored.precipitation?.value || 'unknown', source: stored.precipitation?.source || 'unavailable' },
    wind: { value: stored.wind?.value || 'unknown', source: stored.wind?.source || 'unavailable' },
    overallSource: stored.overall_source || 'unavailable',
  }
}
