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
