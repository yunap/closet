export const OCCASION_VALUES = ['casual', 'city', 'smart casual', 'outdoor_daytime_social', 'evening', 'gallery / art event', 'travel', 'concert']
export const ACTIVITY_VALUES = ['none', 'walking', 'hiking']
export const MISSION_VALUES = ['mix', 'capsule', 'wildcard']

export function normalizeOccasion(value) {
  const v = String(value || '').toLowerCase().trim()
  if (OCCASION_VALUES.includes(v)) return v // ratchet-allow: controlled intent vocabulary normalization, not garment matching
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
  if (ACTIVITY_VALUES.includes(v)) return v // ratchet-allow: controlled intent vocabulary normalization, not garment matching
  if (v) console.warn(`[stylingIntent] off-vocabulary activity "${value}" -> "none"`)
  return 'none'
}

export function normalizeMission(value) {
  const v = String(value || '').toLowerCase().trim()
  return MISSION_VALUES.includes(v) ? v : 'mix' // ratchet-allow: controlled intent vocabulary normalization, not garment matching
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

export function travelRequestCanResolveWeatherLive(text = '', occasion = '') {
  const raw = String(text || '')
  const q = raw.toLowerCase()
  const occ = String(occasion || '').toLowerCase()
  if (!isTravelOrPackingRequest(raw, occ)) return false
  const hasNamedPlace = /\b(?:day trip to|trip to|travel to|headed to|going to|visit to|visiting|in)\s+[A-Z][A-Za-z]+(?:[\s,]+[A-Z]{2}|[\s,]+[A-Z][A-Za-z]+){0,3}\b/.test(raw)
  if (!hasNamedPlace) return false
  const hasSpecificOccasionOrActivity = occ && occ !== 'travel' && occ !== 'casual' ||
    /\b(hik\w*|walk\w*|museum|gallery|winery|wine|lunch|brunch|dinner|restaurant|concert|show|theater|wedding|meeting|conference|work|business|beach|pool|spa)\b/i.test(raw)
  return Boolean(hasSpecificOccasionOrActivity)
}

const TRIP_ACTIVITY_OR_USE_CASE_PATTERNS = [
  /\b(walk|walking|explor\w*|sightseeing|tour)\b/,
  /\b(hik\w*|trail|outdoors?|outdoor)\b/,
  /\b(ski\w*|snowboard\w*)\b/,
  /\b(camp\w*|backpack\w*)\b/,
  /\b(climb\w*|kayak\w*|surf\w*|bik\w*|cycl\w*)\b/,
  /\b(dinner|evening|restaurant|date night)\b/,
  /\b(museum|gallery|art)\b/,
  /\b(brunch|lunch)\b/,
  /\b(shopping|shop)\b/,
  /\b(event|wedding|party)\b/,
  /\b(meeting|conference|work|business)\b/,
  /\b(drinks|bar|concert|show|theater)\b/,
  /\b(wine|winery)\b/,
  /\b(beach|pool|spa)\b/
]

// 2026-07-10: trip packing needs activity/use-case scope before garments. A destination and live
// weather are enough to resolve climate, but not enough to decide between city walking, restaurants,
// hiking, beach, work, etc. Multi-day trips with no use cases, or only one use case, should ask what
// else is planned before composing a packing set.
export function tripRequestNeedsScopeClarification(text = '') {
  const q = String(text || '').toLowerCase()
  if (!q.trim()) return false
  const isMultiDay = /\b(weekend|week-?long|multi-?day|several days|a few days|\d+\s*-?\s*days?)\b/.test(q) // ratchet-allow: user intent routing words, not garment matching
  if (!isMultiDay) return false
  const useCaseCount = TRIP_ACTIVITY_OR_USE_CASE_PATTERNS.reduce((count, pattern) => (
    pattern.test(q) ? count + 1 : count // ratchet-allow: trip scope intent counting, not garment matching
  ), 0)
  return useCaseCount < 2
}

export function normalizeStylingIntent({ occasion, season, mood, mission } = {}) {
  return {
    occasion: normalizeOccasion(occasion),
    season: String(season || '').trim() || 'current season',
    mood: String(mood || '').trim(),
    mission: normalizeMission(mission)
  }
}
