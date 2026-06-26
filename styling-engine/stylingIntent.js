export const OCCASION_VALUES = ['casual', 'city', 'smart casual', 'outdoor_daytime_social', 'evening', 'gallery / art event', 'travel', 'concert']
export const ACTIVITY_VALUES = ['none', 'walking', 'hiking']
export const MISSION_VALUES = ['mix', 'capsule', 'wildcard']

export function normalizeOccasion(value) {
  const v = String(value || '').toLowerCase().trim()
  if (OCCASION_VALUES.includes(v)) return v
  if (['dinner', 'dining', 'restaurant', 'wine bar', 'theater', 'night', 'night out', 'wedding'].includes(v)) {
    return 'evening'
  }
  if (['brunch', 'museum', 'shopping', 'office', 'work', 'everyday'].includes(v)) {
    return 'city'
  }
  if (['gallery', 'art event', 'gallery event', 'gallery opening'].includes(v)) {
    return 'gallery / art event'
  }
  if (['outdoor daytime social', 'outdoor daytime', 'daytime social', 'wine festival', 'outdoor cafe', 'picnic'].includes(v)) {
    return 'outdoor_daytime_social'
  }
  console.warn(`[stylingIntent] off-vocabulary occasion "${value}" -> defaulting to "casual"`)
  return 'casual'
}

export function normalizeActivity(value) {
  const v = String(value || '').toLowerCase().trim()
  if (ACTIVITY_VALUES.includes(v)) return v
  if (v) console.warn(`[stylingIntent] off-vocabulary activity "${value}" -> "none"`)
  return 'none'
}

export function normalizeMission(value) {
  const v = String(value || '').toLowerCase().trim()
  return MISSION_VALUES.includes(v) ? v : 'mix'
}

export function extractWeatherContext(text = '') {
  const raw = String(text || '')
  const normalized = raw.toLowerCase().replace(/[–—]/g, '-')
  const numeric = normalized.match(/\b(?:highs?|lows?|around|about|near|mid|low|upper)?\s*(\d{2,3})(?:\s*(?:-|to)\s*(\d{2,3}))?\s*(?:degrees?|deg|f|°)\b/)
  if (numeric) return numeric[0].trim()
  const decade = normalized.match(/\b(?:mid|low|upper)?\s*(\d{2})s\b/)
  if (decade) return decade[0].trim()
  if (/\b(hot|pretty hot|very hot|really hot|swelter|sweltering|heat|heatwave|warm|humid|muggy)\b/.test(normalized)) {
    return 'hot weather'
  }
  if (/\b(cold|very cold|really cold|freezing|frigid|snow|snowy|icy|winter)\b/.test(normalized)) {
    return 'cold weather'
  }
  if (/\b(rain|rainy|showers?|drizzle|wet|storm|stormy)\b/.test(normalized)) {
    return 'rainy weather'
  }
  if (/\b(cool|chilly|mild|breezy|windy|overcast)\b/.test(normalized)) {
    return 'cool mild weather'
  }
  return ''
}

export function isTravelOrPackingRequest(text = '', occasion = '') {
  const q = String(text || '').toLowerCase()
  const occ = String(occasion || '').toLowerCase()
  return occ === 'travel' || /\b(pack|packing|trip|travel|visit|visiting|vacation|weekend away|going to|headed to)\b/.test(q) // ratchet-allow: user intent routing words, not garment matching
}

export function normalizeStylingIntent({ occasion, season, mood, mission } = {}) {
  return {
    occasion: normalizeOccasion(occasion),
    season: String(season || '').trim() || 'current season',
    mood: String(mood || '').trim(),
    mission: normalizeMission(mission)
  }
}
