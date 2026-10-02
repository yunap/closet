const normalized = value => String(value || '')
  .toLowerCase()
  .replace(/[-_]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

export function extractSeasonRequest(rawSeason) {
  const requested = normalized(rawSeason)
  if (/(?:^|[;,|]\s*)warm(?:\s*[;,|]|$)/.test(requested)) return 'summer'
  const explicit = requested.match(/(?:^|[;,|]\s*|\b)(spring|summer|fall|autumn|winter)(?:\b|\s*[;,|]|$)/)?.[1]
  if (explicit) return explicit === 'autumn' ? 'fall' : explicit
  if (['current season', 'current'].includes(requested) || /(?:^|[;,|]\s*)current season(?:\s*[;,|]|$)/.test(requested)) {
    return 'current season'
  }
  return ''
}

// Canonical calendar-season projection for executable context matching. The public request value
// may deliberately remain "current season" so weather resolution can refresh live conditions and
// the UI can preserve the user's wording. Consumers that match stored applicability must use this
// projection instead of comparing that placeholder literally.
export function resolveCalendarSeason(rawSeason, referenceDate) {
  const requested = normalized(rawSeason)
  if (requested === 'warm') return 'summer'
  if (requested === 'autumn') return 'fall'
  const seasonRequest = extractSeasonRequest(requested)
  if (seasonRequest && seasonRequest !== 'current season') return seasonRequest
  if (seasonRequest !== 'current season') return requested
  const date = referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
    ? referenceDate
    : new Date(referenceDate || Date.now())
  const month = date.getMonth()
  return month >= 2 && month <= 4 ? 'spring'
    : month >= 5 && month <= 7 ? 'summer'
      : month >= 8 && month <= 10 ? 'fall'
        : 'winter'
}

// ── Season as garment evidence, shared by every composer ────────────────────────────────────────
//
// These two lived in outfitSetPlanner.js with exactly one consumer each (the trip planner), which
// is why the visual composer had NO calendar-season handling at all: on a 65/50 fall day 18 of its
// 60 base pieces were tagged `warm` and nothing filtered, ranked or even mentioned them — the model
// picked graphic tees and cropped utility pants, and the engine then told it afterwards that "every
// piece under it is tagged as warm-season clothing" (thread_1789247972106). `rules.js` cannot import
// from `outfitSetPlanner.js` (that module imports rules.js), so the shared semantics live here.
//
// docs/piece-season-as-weather-evidence.md: `season` is wearer-INTENT evidence, never physical
// thermal evidence. It may order a roster and — under the ratified trip-roster rule below — decide
// eligibility, but it never creates a thermal finding.
export const OUT_OF_SEASON = {
  fall: 'warm',
  winter: 'warm',
  summer: 'cool',
  // Missing until now — spring got zero mismatch advisories regardless of piece season tag. 'cold'
  // (deep-winter heavy pieces), the same "opposite extreme" pairing summer:'cool' already uses.
  spring: 'cold',
}

export function seasonFitPieceAdvisory(piece = {}, calendarSeason = '') {
  const season = String(piece?.season || '').toLowerCase().trim()
  const calendar = String(calendarSeason || '').toLowerCase().trim()
  if (!season || season === 'year-round' || !calendar) return { tier: 'neutral', score: 0, reason: '' }
  if (OUT_OF_SEASON[calendar] !== season) return { tier: 'neutral', score: 0, reason: '' }
  return {
    tier: 'discouraged',
    score: -6,
    reason: `tagged ${season}-season clothing; this is a ${calendar} trip`,
  }
}

// docs/trip-roster-season-eligibility-spec.md (ratified). `top` is exempt: it may serve as an indoor
// base layer under something warmer, the one category with a plausible job despite the mismatch.
// `dress` is NOT exempt — an outfit-defining piece, not a layering component. Outerwear is judged on
// its OWN season tag: a warm-season blazer is as useless on a cold day as warm-season trousers,
// while a cool/cold-tagged layer is never excluded.
//
// `group` is passed in rather than derived, so this module stays free of garment-attribute imports.
export function seasonEligibleForCalendar(piece = {}, calendarSeason = '', group = '') {
  const calendar = String(calendarSeason || '').toLowerCase().trim()
  if (!calendar) return true
  const season = String(piece?.season || '').toLowerCase().trim()
  const mismatched = season && season !== 'year-round' && OUT_OF_SEASON[calendar] === season
  if (!mismatched) return true
  if (group === 'top') return true
  if (group === 'outerwear') return season !== 'warm'
  return false
}
