const OCCASION_RANK = { low: 1, medium: 2, high: 3 }
const OCCASION_BY_RANK = { 1: 'low', 2: 'medium', 3: 'high' }

export const SOFT_SCORE_CONFIG = {
  refinedFabrics: ['silk', 'satin', 'ponte', 'velvet', 'crepe', 'wool', 'twill', 'viscose', 'rayon', 'modal'],
  dressyColors: ['black', 'navy', 'green', 'turquoise', 'plum', 'charcoal', 'dark blue', 'dark grey'],
  dressyColorSignals: ['emerald', 'teal', 'burgundy', 'sapphire', 'jewel', 'deep green', 'forest green'],
  expressivePatterns: ['floral', 'botanical', 'paisley', 'abstract', 'animal', 'graphic'],
  loungewearSignals: ['lounge', 'loungewear', 'sleep', 'sleepwear', 'pajama', 'pyjama'],
  sloppyFabrics: ['jersey', 'fleece', 'sweatshirt fleece']
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone)
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, clone(val)]))
  return value
}

function norm(value) {
  return String(value || '').toLowerCase().trim()
}

function normList(value) {
  return Array.isArray(value) ? value.map(norm).filter(Boolean) : []
}

function styleProfile(piece = {}) {
  if (isObject(piece.style_profile_json)) return piece.style_profile_json
  if (typeof piece.style_profile_json === 'string') {
    try { return JSON.parse(piece.style_profile_json || '{}') || {} } catch { return {} }
  }
  return {}
}

function normalizedOverrides(piece = {}) {
  if (Array.isArray(piece.manual_overrides)) return piece.manual_overrides.map(String)
  if (typeof piece.manual_overrides === 'string') {
    try {
      const parsed = JSON.parse(piece.manual_overrides || '[]')
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

function pathProtected(piece, path) {
  return normalizedOverrides(piece).some(override => (
    override === path ||
    path.startsWith(`${override}.`) ||
    override.startsWith(`${path}.`)
  ))
}

function cleanSolid(piece = {}) {
  return ['solid', 'quiet'].includes(norm(piece.pattern_complexity)) &&
    ['none', 'subtle', ''].includes(norm(piece.pattern_scale))
}

function expressive(piece = {}) {
  return SOFT_SCORE_CONFIG.expressivePatterns.includes(norm(piece.pattern_type)) &&
    ['medium', 'loud'].includes(norm(piece.pattern_complexity))
}

function refinedFabric(piece = {}) {
  const fabric = norm(piece.fabric_category)
  if (SOFT_SCORE_CONFIG.refinedFabrics.includes(fabric)) return true
  if (fabric !== 'synthetic') return false
  // stretch must be EXPLICITLY known and non-stretchy — an unset value must not silently pass
  // the same test as stretch: "none". This was backwards from this schema's own conservative-
  // default convention for absent values elsewhere (needs_base's stated "conservative default:
  // null, not 'no'"). Traced 2026-08-16 while auditing why stretch's low consumer count never
  // discriminated on this wardrobe — not live (no known piece currently gets a wrong answer from
  // it), but a real gap: a genuinely stretchy synthetic piece that was never tagged for stretch
  // would have incorrectly passed the "not stretchy" floor.
  return ['ultralight', 'light'].includes(norm(piece.fabric_weight)) &&
    ['drapes', ''].includes(norm(piece.fit_on_body)) &&
    ['none', 'minimal'].includes(norm(piece.stretch))
}

function dressyColor(piece = {}) {
  const values = [
    norm(piece.background_color),
    ...normList(piece.colors),
    norm(piece.reads_as),
    norm(piece.name)
  ].join(' ')
  return [...SOFT_SCORE_CONFIG.dressyColors, ...SOFT_SCORE_CONFIG.dressyColorSignals]
    .some(color => values.includes(color))
}

function loungewear(piece = {}) {
  const text = [piece.name, piece.reads_as, piece.notes, piece.engine_notes].map(norm).join(' ')
  if (SOFT_SCORE_CONFIG.loungewearSignals.some(signal => text.includes(signal))) return true // ratchet-allow: conservative loungewear category signal until a structured loungewear flag exists
  return ['fleece', 'sweatshirt fleece'].includes(norm(piece.fabric_category)) &&
    ['relaxed', 'oversized'].includes(norm(piece.silhouette)) &&
    !['structured', 'hangs_straight'].includes(norm(piece.fit_on_body))
}

function casualSloppy(piece = {}) {
  return ['oversized', 'drop-shoulder'].includes(norm(piece.silhouette)) &&
    SOFT_SCORE_CONFIG.sloppyFabrics.includes(norm(piece.fabric_category))
}

function floorLane(profile, piece, lane, value, rules, reason) {
  const path = `style_profile_json.style_lanes.${lane}`
  if (pathProtected(piece, path)) return
  profile.style_lanes = isObject(profile.style_lanes) ? { ...profile.style_lanes } : {}
  const before = Number(profile.style_lanes[lane] ?? 0)
  const current = Number.isFinite(before) ? before : 0
  if (current >= value) return
  profile.style_lanes[lane] = value
  rules.push({ rule: reason, path, before: current, after: value })
}

function floorOccasion(profile, piece, occasion, value, rules, reason) {
  const path = `style_profile_json.garment_intelligence.occasion_confidence.${occasion}`
  if (pathProtected(piece, path)) return
  profile.garment_intelligence = isObject(profile.garment_intelligence) ? { ...profile.garment_intelligence } : {}
  const confidence = isObject(profile.garment_intelligence.occasion_confidence)
    ? { ...profile.garment_intelligence.occasion_confidence }
    : {}
  const before = norm(confidence[occasion]) || 'low'
  if ((OCCASION_RANK[before] || 0) >= OCCASION_RANK[value]) return
  confidence[occasion] = value
  profile.garment_intelligence.occasion_confidence = confidence
  rules.push({ rule: reason, path, before, after: value })
}

function capOccasion(profile, piece, occasion, value, rules, reason) {
  const path = `style_profile_json.garment_intelligence.occasion_confidence.${occasion}`
  if (pathProtected(piece, path)) return
  profile.garment_intelligence = isObject(profile.garment_intelligence) ? { ...profile.garment_intelligence } : {}
  const confidence = isObject(profile.garment_intelligence.occasion_confidence)
    ? { ...profile.garment_intelligence.occasion_confidence }
    : {}
  const before = norm(confidence[occasion])
  if (!before || (OCCASION_RANK[before] || 0) <= OCCASION_RANK[value]) return
  confidence[occasion] = OCCASION_BY_RANK[OCCASION_RANK[value]]
  profile.garment_intelligence.occasion_confidence = confidence
  rules.push({ rule: reason, path, before, after: confidence[occasion] })
}

export function softScorePredicates(piece = {}) {
  return {
    cleanSolid: cleanSolid(piece),
    refinedFabric: refinedFabric(piece),
    expressive: expressive(piece),
    dressyColor: dressyColor(piece),
    loungewear: loungewear(piece),
    casualSloppy: casualSloppy(piece)
  }
}

export function applySoftScoreFloors(piece = {}) {
  const profile = clone(styleProfile(piece))
  const next = { ...piece, style_profile_json: profile }
  const rules = []
  const category = norm(piece.category)
  const clothing = ['top', 'bottom', 'dress', 'outerwear'].includes(category)
  const p = softScorePredicates(piece)

  if (clothing && !p.loungewear) {
    capOccasion(profile, piece, 'home', 'low', rules, 'home_cap_non_loungewear')
  }
  if (p.cleanSolid && p.refinedFabric && !p.expressive) {
    floorLane(profile, piece, 'polished_classic', 3, rules, 'polished_classic_clean_refined_floor')
  }
  if (p.refinedFabric && p.cleanSolid && p.dressyColor && !p.casualSloppy) {
    floorOccasion(profile, piece, 'evening', 'medium', rules, 'evening_clean_refined_dressy_floor')
  }
  if (p.refinedFabric && !p.casualSloppy && !p.expressive) {
    floorOccasion(profile, piece, 'smart-casual', 'medium', rules, 'smart_casual_refined_floor')
  }

  if (rules.length) {
    profile._soft_score_adjustments = {
      version: 'v1.0.0-soft-score-floors',
      rules,
      predicates: p
    }
  }
  return next
}
