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

// Activity becomes hard footwear and exposure context downstream, so a small routing model's
// unsupported guess cannot own it. This extractor recognizes only activity the user actually
// stated; an outing, a named city, or several hours outdoors is not walking evidence. Hiking wins
// over walking when both are present. Negated mentions remain none rather than activating a gate.
export function extractExplicitActivity(text = '') {
  const normalized = String(text || '').toLowerCase()
  const hasAffirmedPhrase = phrase => {
    const escaped = phrase.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
    const regex = new RegExp(`\\b${escaped}\\b`, 'ig')
    let match
    while ((match = regex.exec(normalized)) !== null) {
      const prefix = normalized.slice(Math.max(0, match.index - 64), match.index)
      const localClause = prefix.split(/[.!?;,]|\bbut\b|\bhowever\b/i).pop() || ''
      const suffix = normalized.slice(match.index + match[0].length, match.index + match[0].length + 64)
      const negated = /\b(?:no|not|without)\b(?:\s+[a-z'-]+){0,3}\s*$/i.test(localClause)
        || /\b(?:do|does|did|will|would|should|is|are|was|were|have|has)\s+not\b(?:\s+[a-z'-]+){0,3}\s*$/i.test(localClause)
        || /\b(?:don't|doesn't|didn't|won't|wouldn't|shouldn't|isn't|aren't|wasn't|weren't|haven't|hasn't)\b(?:\s+[a-z'-]+){0,3}\s*$/i.test(localClause)
        || /^\s+(?:is|are|was|were|will be|would be|should be)?\s*not\b/i.test(suffix)
      if (!negated) return true // ratchet-allow: user activity intent parsing, not garment matching
    }
    return false
  }
  const hikingPhrases = ['hike', 'hiking', 'trail', 'nature walk', 'trail walk', 'trailhead', 'woods walk']
  if (hikingPhrases.some(hasAffirmedPhrase)) return 'hiking' // ratchet-allow: controlled activity vocabulary
  const walkingPhrases = ['walk', 'walking', 'stroll', 'strolling', 'on my feet', 'lots of walking', 'walking around', 'exploring on foot']
  if (walkingPhrases.some(hasAffirmedPhrase)) return 'walking' // ratchet-allow: controlled activity vocabulary
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

// Fresh single-outfit requests need the user's literal numeric range to survive the routing
// boundary as data. extractWeatherContext is intentionally lightweight display prose and returns
// only the first number from forms such as "60→48°F"; using it as action authority therefore
// changed the actual conditions before the styling model saw them. This extractor is deliberately
// conservative: it recognizes only an explicit two-number Fahrenheit range and returns null for
// anything that would require climate knowledge or interpretation.
export function extractStructuredUserWeather(text = '') {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[–—→]/g, '-')
  const rangeMatch = normalized.match(/\b(-?\d{1,3})\s*(?:°\s*)?(?:f(?:ahrenheit)?)?\s*(?:-|to)\s*(-?\d{1,3})\s*(?:(?:°|degrees?)\s*)?(?:f(?:ahrenheit)?)\b/)
  // A wearing-window request often states the endpoints as two timed observations rather than
  // typographically as a range: "60°F when I leave and 48°F after sunset". Both values must carry
  // an explicit Fahrenheit unit so this remains factual extraction, not climate interpretation.
  const explicitFahrenheitValues = [...normalized.matchAll(/(-?\d{1,3})\s*(?:(?:°\s*)?f(?:ahrenheit)?|degrees?\s+fahrenheit)\b/g)]
    .map(match => Number(match[1]))
  let endpoints = null
  if (rangeMatch) {
    endpoints = [Number(rangeMatch[1]), Number(rangeMatch[2])]
  } else if (explicitFahrenheitValues.length === 2) {
    endpoints = explicitFahrenheitValues
  } else if (explicitFahrenheitValues.length === 1) {
    const isPastReference = /\b(yesterday|last\s+(?:week|month|year|night|weekend))\b/.test(normalized)
    if (!isPastReference) {
      endpoints = [explicitFahrenheitValues[0], explicitFahrenheitValues[0]]
    }
  }
  if (!endpoints) return null
  const [first, second] = endpoints
  if (!Number.isFinite(first) || !Number.isFinite(second) || first < -100 || first > 150 || second < -100 || second > 150) return null
  const weather = { high_f: Math.max(first, second), low_f: Math.min(first, second) }
  if (/\b(rain|rainy|showers?|drizzle|wet)\b/.test(normalized)) weather.precipitation = 'rain'
  else if (/\b(snow|snowy)\b/.test(normalized)) weather.precipitation = 'snow'
  else if (/\b(dry|no (?:rain|snow|precipitation))\b/.test(normalized)) weather.precipitation = 'none'
  if (/\b(windy|strong winds?|gusty|gusts?)\b/.test(normalized)) weather.wind = 'windy'
  else if (/\b(breezy|breeze)\b/.test(normalized)) weather.wind = 'breezy'
  return weather
}

const MONTH_NAMES = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
}
const MONTH_NAME_PATTERN = Object.keys(MONTH_NAMES).sort((a, b) => b.length - a.length).join('|')
const trimDateComponent = date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
const isoDate = date => date.toISOString().slice(0, 10)

// A stated trip date is factual request state, not something the model should have to re-derive
// correctly on every plan_outfit_set call (thread_1788499704803: the model's own date_range
// drifted to the current week despite the user stating "October 12th... for a week" in the same
// turn, and nothing caught the mismatch before it silently resolved live weather for the wrong
// dates). Extracted once, deterministically, from the user's own words -- conservative by
// construction: returns null rather than guessing whenever the text isn't an unambiguous month +
// day statement, since a wrong extracted date is worse than none. No year inference beyond "the
// next occurrence of this month/day from `currentDate`", matching how a person actually means a
// bare "October 12th" mentioned in September.
export function extractStatedTripDateRange(text = '', { currentDate = new Date() } = {}) {
  const normalized = String(text || '').toLowerCase()
  const dateMatch = normalized.match(new RegExp(`\\b(${MONTH_NAME_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`))
  if (!dateMatch) return null
  const month = MONTH_NAMES[dateMatch[1]]
  const day = Number(dateMatch[2])
  if (!Number.isInteger(day) || day < 1 || day > 31) return null

  const now = currentDate instanceof Date && !Number.isNaN(currentDate.getTime()) ? currentDate : new Date()
  const today = trimDateComponent(now)
  let year = dateMatch[3] ? Number(dateMatch[3]) : now.getUTCFullYear()
  let startDate = trimDateComponent(new Date(Date.UTC(year, month, day)))
  if (Number.isNaN(startDate.getTime())) return null
  // No explicit year stated and the bare month/day already passed this year -- assume next
  // year's occurrence (a person saying "October 12th" in September means THIS October, but the
  // same words in November mean NEXT October, never a date already in the past).
  if (!dateMatch[3] && startDate < today) {
    year += 1
    startDate = trimDateComponent(new Date(Date.UTC(year, month, day)))
  }

  const durationMatch = normalized.match(/\bfor\s+(a|one|\d+)\s+(day|days|night|nights|week|weeks)\b/) ||
    normalized.match(/\b(a|one|\d+)\s+(day|days|night|nights|week|weeks)\s+(?:trip|stay|visit)\b/)
  let durationDays = 1
  if (durationMatch) {
    const countRaw = durationMatch[1]
    const count = countRaw === 'a' || countRaw === 'one' ? 1 : Number(countRaw)
    const unit = durationMatch[2]
    durationDays = unit.startsWith('week') ? count * 7 : unit.startsWith('night') ? count + 1 : count
  }
  const endDate = new Date(startDate.getTime() + (Math.max(1, durationDays) - 1) * 86400000)

  return {
    start: isoDate(startDate),
    end: isoDate(endDate),
    durationDays: Math.max(1, durationDays),
    // Distinguishes "the person said how long" from "nothing was said, defaulted to a single day"
    // — thread_1788501349296's live rerun: the extractor's own end (Oct 18, from the explicitly
    // stated "for a week") is the complete, user-owned fact when a duration was actually stated: it
    // must not be silently swapped back out for whatever end date the model separately supplied
    // (Oct 19), even when the model's start happened to agree. Ownership at the plan_outfit_set
    // boundary (styling-engine/tools.js) reads this flag to decide whether the model's own end date
    // is additional detail worth keeping (no duration stated) or a fact already settled by the user
    // (duration stated).
    hasExplicitDuration: Boolean(durationMatch),
    source: 'user_stated',
  }
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

export function normalizeStylingIntent({ occasion, season, mood, mission } = {}) {
  return {
    occasion: normalizeOccasion(occasion),
    season: String(season || '').trim() || 'current season',
    mood: String(mood || '').trim(),
    mission: normalizeMission(mission)
  }
}
