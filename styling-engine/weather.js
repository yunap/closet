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
