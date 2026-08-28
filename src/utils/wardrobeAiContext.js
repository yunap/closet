const CLOTHING_WITH_TUCK = new Set(['top', 'dress', 'outerwear'])

export function safeJsonParse(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export function normalizeStyleProfileList(value) {
  if (!value) return []
  if (Array.isArray(value)) return [...new Set(value.map(v => String(v || '').trim()).filter(Boolean))]
  return String(value)
    .split(/[\n;]+/)
    .map(v => v.trim())
    .filter(Boolean)
}

export function pieceStyleProfile(piece = {}) {
  if (piece?.style_profile_json && typeof piece.style_profile_json === 'object') return piece.style_profile_json
  return safeJsonParse(piece?.style_profile_json, {}) || {}
}

export function getFieldConfidence(piece = {}, field) {
  const profile = pieceStyleProfile(piece)
  const confidence = String(profile?._confidence?.[field] || '').toLowerCase()
  if (['manual', 'high', 'medium', 'low'].includes(confidence)) return confidence
  const manualOverrides = Array.isArray(piece.manual_overrides) ? piece.manual_overrides : []
  if (manualOverrides.includes(field)) return 'manual'
  return piece.tag_state === 'provisional' ? 'low' : 'medium'
}

// The tagger writes the literal string `none` for a structural field that does
// not apply to the category — sleeve_type on 59 bottoms, length_hits_at on
// shoes and accessories. Emitting `sleeve: none` is worse than silence: it
// reads as a claim about the garment rather than an absence of one.
export const STRUCTURAL_FIELD_UNSET = new Set(['none', 'unknown', 'n/a'])

function trustedFieldText(piece, field, label, value) {
  if (!value) return null
  if (STRUCTURAL_FIELD_UNSET.has(String(value).trim().toLowerCase())) return null
  return getFieldConfidence(piece, field) === 'low'
    ? `${label}: [low confidence - add worn photo] ${value}`
    : `${label}: ${value}`
}

export function pieceGarmentIntelligence(piece = {}) {
  const profile = pieceStyleProfile(piece)
  const info = profile?.garment_intelligence && typeof profile.garment_intelligence === 'object'
    ? profile.garment_intelligence
    : {}
  return {
    autoUseTrust: String(info.auto_use_trust || '').trim(),
    bestOutfitRole: String(info.best_outfit_role || '').trim(),
    pairingRequirements: normalizeStyleProfileList(info.pairing_requirements),
    failureRisks: normalizeStyleProfileList(info.failure_risks),
    formulaCompatibility: normalizeStyleProfileList(info.formula_compatibility),
    doNotPairRules: normalizeStyleProfileList(info.do_not_pair_rules),
    realWearNotes: info.real_wear_notes && typeof info.real_wear_notes === 'object' ? info.real_wear_notes : {},
    occasionConfidence: info.occasion_confidence && typeof info.occasion_confidence === 'object' ? info.occasion_confidence : {},
  }
}

// tuck_behavior is the sole authority on whether a piece can be tucked —
// hem_finish is construction only (what shape the hem is) and must not be
// used to infer or override tuck permission. A piece with no tuck_behavior
// set returns null here rather than guessing from its hem; that gap is
// already surfaced through the normal confidence/review system instead
// (tuck_behavior is a STRUCTURE_FIT_CONFIDENCE_FIELDS entry in attributes.js).
export function computeTuckNote(piece = {}) {
  if (!CLOTHING_WITH_TUCK.has(piece.category)) return null
  if (piece.tuck_behavior === 'wear_over_only') return 'no tuck — wear over only'
  if (piece.fabric_category === 'silk' || piece.fabric_category === 'satin') return 'no tuck — silk/satin cannot hold'
  if (piece.tuck_behavior === 'tucks_with_structure') return 'tucks with structured waist or belt only'
  if (piece.tuck_behavior === 'tucks_anywhere') return 'tucks freely'
  return null
}

export function computeWaistbandNote(piece = {}) {
  if (piece.category !== 'bottom') return null
  if (piece.waistband_type === 'tight_no_room') return 'tight waistband — no tuck'
  if (piece.waistband_type === 'soft_elastic_pull_on') return 'elastic waist — no tuck'
  if (piece.waistband_type === 'structured_high_waist') return 'structured high waist — receives tuck'
  if (piece.waistband_type === 'structured_mid_waist') return 'structured mid waist — receives tuck'
  if (piece.waistband_type === 'structured_low_waist') return 'structured low waist — receives tuck'
  if (piece.waistband_type === 'drawstring_relaxed') return 'drawstring — no tuck'
  return null
}
// Spec 26 Part 3: the prefix rule below predates the outdoor_daytime_social
// occasion and was never a deliberate Decision — startsWith('outdoor')
// accidentally routed every social outdoor occasion through the tagger's
// rugged/exposure-flavored `outdoor` key, systematically suppressing refined
// pieces (linen, blouses) that are fine for a winery patio but score
// low on ruggedness. Exposure belongs to the weather gates; ruggedness
// belongs to the activity profile; occasion confidence here should measure
// social-register suitability instead. Plain outdoor/hiking-flavored
// occasions keep reading the strict `outdoor` key.
export function isOutdoorSocialOccasion(occ) {
  const norm = String(occ || '').toLowerCase().replace(/[-_]+/g, ' ').trim()
  return norm.startsWith('outdoor') && norm.includes('social')
}

export function normalizeOccasionForConfidence(occ) {
  const norm = String(occ || '').toLowerCase().replace(/[-_]+/g, ' ').trim()
  if (norm.startsWith('outdoor')) return 'outdoor'
  if (norm.startsWith('smart') || norm.includes('smart')) return 'smart-casual'
  if (norm.includes('art') || norm.includes('gallery')) return 'city'
  if (norm.includes('travel') || norm.includes('walk') || norm.includes('walking')) return 'city'
  if (norm.includes('home') || norm.includes('lounge')) return 'home'
  if (norm.includes('evening')) return 'evening'
  return norm.replace(/\s+/g, '-')
}

const OCCASION_CONFIDENCE_RANK = { manual: 4, high: 3, medium: 2, low: 1 }

// Best-of lookup for outdoor_daytime_social (and any future outdoor_*_social
// occasion): reads casual/smart-casual/outdoor and keeps the highest
// confidence found, rather than the single strict `outdoor` key.
function resolveOccasionConfidence(occasion, occasionConfidence = {}) {
  if (isOutdoorSocialOccasion(occasion)) {
    const candidates = ['casual', 'smart-casual', 'outdoor']
      .map(key => String(occasionConfidence?.[key] || '').toLowerCase())
      .filter(Boolean)
    if (!candidates.length) return ''
    return candidates.sort((a, b) => (OCCASION_CONFIDENCE_RANK[b] || 0) - (OCCASION_CONFIDENCE_RANK[a] || 0))[0]
  }
  const normOcc = normalizeOccasionForConfidence(occasion)
  return normOcc ? String(occasionConfidence?.[normOcc] || '').toLowerCase() : ''
}

function manualOverridesForPiece(piece = {}) {
  if (Array.isArray(piece.manual_overrides)) return piece.manual_overrides.map(v => String(v || '').trim())
  if (typeof piece.manual_overrides === 'string') {
    try {
      const parsed = JSON.parse(piece.manual_overrides || '[]')
      return Array.isArray(parsed) ? parsed.map(v => String(v || '').trim()) : []
    } catch {
      return []
    }
  }
  return []
}

// A composite occasion profile id (e.g. "city_smart_casual") is one register reachable by either
// of its constituent words — see docs/occasion_profiles_ratification.md's "city / city_smart_casual"
// and "smart casual ... resolved through the city_smart_casual profile" rows. Any occasion-shaped
// check that compares a piece's own occasion words against the resolved profile id needs the same
// alias set, so it lives here once rather than re-deriving "does this profile text mean city/smart"
// per caller.
function occasionAliasesFor(occasion = '', normalizedOccasion = '') {
  const rawOccasion = String(occasion || '').toLowerCase()
  const profileText = rawOccasion.replace(/[-_]+/g, ' ')
  const aliases = new Set([rawOccasion, normalizedOccasion])
  if (profileText.includes('city')) aliases.add('city')
  if (profileText.includes('smart')) aliases.add('smart-casual')
  return aliases
}

function explicitOccasionMatches(piece = {}, occasion = '', normalizedOccasion = '') {
  const explicitOccasions = Array.isArray(piece.occasions) ? piece.occasions.map(o => String(o || '').toLowerCase()) : []
  const normalizedExplicit = explicitOccasions.map(normalizeOccasionForConfidence)
  const aliases = occasionAliasesFor(occasion, normalizedOccasion)
  return explicitOccasions.some(occ => aliases.has(occ)) ||
    normalizedExplicit.some(occ => aliases.has(occ))
}

export function autoStylingTrustDecision(piece = {}, { occasion = 'casual', explorationMode = 'moderate' } = {}) {
  const status = String(piece.recommendation_status || 'trusted')
  const fit = String(piece.fit_confidence || 'unknown')
  const role = String(piece.role_permission || 'auto')
  const notes = `${piece.engine_notes || ''} ${piece.notes || ''}`.toLowerCase()
  const permissions = Array.isArray(piece.occasion_permissions) ? piece.occasion_permissions : []
  const intelligence = pieceGarmentIntelligence(piece)
  const profileTrust = String(intelligence.autoUseTrust || '').toLowerCase()
  const profileNotes = [
    ...intelligence.failureRisks,
    ...intelligence.doNotPairRules,
    ...Object.values(intelligence.realWearNotes || {})
  ].join(' ').toLowerCase()
  const normOcc = normalizeOccasionForConfidence(occasion)
  const occasionConfidence = resolveOccasionConfidence(occasion, intelligence.occasionConfidence)
  const reasons = []
  const aggressive = explorationMode === 'aggressive'
  const manualOverrides = manualOverridesForPiece(piece)
  const manuallyTrustedFit = manualOverrides.includes('fit_confidence') && ['high', 'trusted'].includes(fit)

  if (status === 'avoid' || status === 'do_not_recommend') reasons.push('recommendation status blocks auto-use')
  if (role === 'never_auto' || role === 'only_when_requested') reasons.push('role permission blocks automatic styling')
  if (status === 'needs_fit_review' && !aggressive) reasons.push('needs fit review')
  if (status === 'experimental' && !aggressive) reasons.push('experimental piece held for exploration mode')
  if (fit === 'low' && !aggressive) reasons.push('low fit confidence')
  if (profileTrust === 'do_not_auto_use') reasons.push('AI profile blocks auto-use')
  if (profileTrust === 'needs_fit_review' && !aggressive && !manuallyTrustedFit) reasons.push('AI profile needs fit review')
  if (profileTrust === 'experimental' && !aggressive) reasons.push('AI profile experimental')

  const isExplicitlyTagged = explicitOccasionMatches(piece, occasion, normOcc)

  if (occasionConfidence === 'low' && !isExplicitlyTagged && !aggressive) {
    reasons.push(`AI profile low confidence for ${occasion}`)
  }
  if (permissions.length && occasion) {
    // `occasion` here is often a resolved composite profile id (e.g. "city_smart_casual"), while
    // `occasion_permissions` is tagged with the individual occasion words from that same profile
    // (docs/garment-field-reference.md: "multi-select from the `occasions` list") — never the
    // composite id itself. A literal permissions.includes(occasion) can never match in that case,
    // silently rejecting every piece with an explicit allowlist.
    //
    // ANY-of-constituent-words is deliberate, not a loosened re-guess: styling-engine/occasions.js
    // has no separate "city" profile and no separate "smart_casual" profile — both words are
    // keywords on the single city_smart_casual OCCASION_PROFILES entry, so a "city" request and a
    // "smart casual" request already resolve to the identical rules/register ceiling. They are two
    // names for one register, not two requirements a piece must jointly satisfy. Matches
    // explicitOccasionMatches's existing (tested) policy for the same profile-vs-word gap on
    // piece.occasions.
    const permissionAliases = occasionAliasesFor(occasion, normOcc)
    const normalizedPermissions = permissions.map(p => String(p || '').toLowerCase())
    const permitted = normalizedPermissions.some(p => permissionAliases.has(p))
    if (!permitted) reasons.push(`not permitted for ${occasion}`)
  }
  if (/\b(too small|too tight|does not fit|doesn't fit|bad fit|avoid auto|do not auto|do not auto-style|do not auto style|not evening|not for evening|testing only|only when requested|specifically requested|testing whether alteration)\b/.test(`${notes} ${profileNotes}`) && !aggressive) {
    reasons.push('engine notes suppress auto-use')
  }

  return {
    allowed: reasons.length === 0,
    supportOnly: role === 'support_only' || profileTrust === 'support_only',
    reasons
  }
}

const GENERATED_OCCASION_RECEIPT = /^(?:Excluded from|Restored for) .+ by .+ \(\d{4}-\d{2}-\d{2}\)\s*$/

export function stylingRulesForPrompt(rules) {
  return (Array.isArray(rules) ? rules : []).filter(rule => !GENERATED_OCCASION_RECEIPT.test(String(rule || '')))
}

export function buildWardrobePieceTruthText(piece = {}) {
  const parts = []
  const colors = Array.isArray(piece.colors) ? piece.colors : []

  if (piece.background_color) parts.push(`background: ${piece.background_color}`)
  if (piece.reads_as) parts.push(`reads as: ${piece.reads_as}`)
  else if (colors.length) parts.push(colors.join('/'))

  if (piece.pattern_complexity && piece.pattern_complexity !== 'solid') {
    const pat = [piece.pattern_type, piece.pattern_scale, piece.pattern_complexity].filter(Boolean).join('/')
    parts.push(`pattern: ${pat}`)
  }

  if (piece.bottom_shape) parts.push(`bottom shape: ${piece.bottom_shape}`)
  if (piece.leg_opening) parts.push(`leg opening: ${piece.leg_opening}`)
  const hemText = trustedFieldText(piece, 'hem_finish', 'hem', piece.hem_finish)
  if (hemText) parts.push(hemText)
  const lengthText = trustedFieldText(piece, 'length_hits_at', 'hits at', piece.length_hits_at)
  if (lengthText) parts.push(lengthText)
  const silhouetteText = trustedFieldText(piece, 'silhouette', 'silhouette', piece.silhouette)
  if (silhouetteText) parts.push(silhouetteText)
  // silhouette is not applicable to shoes (see garment-field-reference.md) — shoe_type/toe_shape
  // are its replacement there, so they need the same treatment or a shoe's type/toe shape
  // reaches no composing prompt at all, same failure shape as the sleeve_type gap above.
  const shoeTypeText = trustedFieldText(piece, 'shoe_type', 'shoe type', piece.shoe_type)
  if (shoeTypeText) parts.push(shoeTypeText)
  const toeShapeText = trustedFieldText(piece, 'toe_shape', 'toe shape', piece.toe_shape)
  if (toeShapeText) parts.push(toeShapeText)
  // sleeve_type (now split into sleeve_length/sleeve_shape) was populated on 207
  // of 236 pieces and reached NO composing prompt — so a capsule look put a
  // short-sleeved cardigan over a bishop sleeve, because as far as the model
  // could see the top had no sleeve at all. Same shape as the missing length
  // clause: the wardrobe knows, the prompt never says, the correction arrives
  // afterwards as feedback.
  const sleeveLengthText = trustedFieldText(piece, 'sleeve_length', 'sleeve length', piece.sleeve_length)
  if (sleeveLengthText) parts.push(sleeveLengthText)
  const sleeveShapeText = piece.sleeve_length !== 'sleeveless'
    ? trustedFieldText(piece, 'sleeve_shape', 'sleeve shape', piece.sleeve_shape)
    : null
  if (sleeveShapeText) parts.push(sleeveShapeText)
  // shoes/accessory use visual_weight (delicate/slim/medium/chunky — visual
  // scale, not fabric weight); everything else uses fabric_weight.
  const weightForFabricLine = (piece.category === 'shoes' || piece.category === 'accessory')
    ? piece.visual_weight
    : piece.fabric_weight
  if (piece.fabric_category) parts.push(`fabric: ${piece.fabric_category}${weightForFabricLine ? `/${weightForFabricLine}` : ''}`)
  if (piece.opacity && piece.opacity !== 'opaque') {
    const opacityText = trustedFieldText(piece, 'opacity', 'opacity', piece.opacity)
    if (opacityText) parts.push(opacityText)
  }
  if (piece.needs_base === 'yes') {
    const needsBaseText = trustedFieldText(piece, 'needs_base', 'cannot be worn alone', 'needs a base layer underneath')
    if (needsBaseText) parts.push(needsBaseText)
  }
  const fitText = trustedFieldText(piece, 'fit_on_body', 'fit', piece.fit_on_body)
  if (fitText) parts.push(fitText)

  const tuck = computeTuckNote(piece) || computeWaistbandNote(piece)
  if (tuck) parts.push(tuck)

  if (piece.accessory_subtype) {
    const jewelryDetail = piece.accessory_subtype === 'jewelry' && piece.jewelry_type
      ? ` (${piece.jewelry_type}${piece.jewelry_type === 'necklace' && piece.necklace_length ? `, ${piece.necklace_length}` : ''})`
      : ''
    parts.push(`accessory type: ${piece.accessory_subtype}${jewelryDetail}`)
  }

  if (Array.isArray(piece.occasions) && piece.occasions.length) parts.push(piece.occasions.join(', '))
  if (piece.status && piece.status !== 'active') parts.push(`status: ${piece.status}`)
  if (piece.recommendation_status && piece.recommendation_status !== 'trusted') parts.push(`recommendation trust: ${piece.recommendation_status}`)
  if (piece.fit_confidence && piece.fit_confidence !== 'unknown') parts.push(`fit confidence: ${piece.fit_confidence}`)
  if (piece.role_permission && piece.role_permission !== 'auto') parts.push(`auto-styling role: ${piece.role_permission}`)
  if (Array.isArray(piece.occasion_permissions) && piece.occasion_permissions.length) parts.push(`auto occasions: ${piece.occasion_permissions.join(', ')}`)
  if (piece.engine_notes) parts.push(`engine note: ${piece.engine_notes}`)

  const profile = pieceStyleProfile(piece)
  const lanes = profile?.style_lanes && typeof profile.style_lanes === 'object'
    ? Object.entries(profile.style_lanes)
      .map(([lane, score]) => [lane, Number(score)])
      .filter(([, score]) => Number.isFinite(score) && score >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([lane, score]) => `${lane}:${score}`)
    : []
  if (lanes.length) parts.push(`style lanes: ${lanes.join(', ')}`)
  if (Array.isArray(profile?.visual_roles) && profile.visual_roles.length) parts.push(`visual roles: ${profile.visual_roles.slice(0, 4).join(', ')}`)
  if (profile?.style_notes?.best_use) parts.push(`best use: ${profile.style_notes.best_use}`)
  if (profile?.style_notes?.risk) parts.push(`style risk: ${profile.style_notes.risk}`)

  const intelligence = pieceGarmentIntelligence(piece)
  if (intelligence.autoUseTrust) parts.push(`AI auto-use trust: ${intelligence.autoUseTrust}`)
  if (intelligence.bestOutfitRole) parts.push(`best outfit role: ${intelligence.bestOutfitRole}`)
  if (intelligence.pairingRequirements.length) parts.push(`pairing requirements: ${intelligence.pairingRequirements.slice(0, 3).join('; ')}`)
  if (intelligence.failureRisks.length) parts.push(`failure risks: ${intelligence.failureRisks.slice(0, 3).join('; ')}`)
  if (intelligence.formulaCompatibility.length) parts.push(`formula compatibility: ${intelligence.formulaCompatibility.slice(0, 3).join('; ')}`)
  if (intelligence.doNotPairRules.length) parts.push(`do not pair: ${intelligence.doNotPairRules.slice(0, 3).join('; ')}`)
  const realWearNotes = Object.entries(intelligence.realWearNotes || {})
    .filter(([, value]) => value)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${value}`)
  if (realWearNotes.length) parts.push(`real wear: ${realWearNotes.join('; ')}`)
  if (piece.notes) parts.push(`note: ${piece.notes}`)

  let text = `• ${piece.name} (${piece.category} | ${parts.join(' | ')})`
  const promptRules = stylingRulesForPrompt(piece.styling_rules_learned)
  if (promptRules.length) {
    text += `\n  RULES (authoritative): ${promptRules.join(' | ')}`
  }
  if (Array.isArray(piece.tried_and_rejected) && piece.tried_and_rejected.length) {
    text += `\n  REJECTED: ${piece.tried_and_rejected.join(' | ')}`
  }
  return text
}

// ── Wardrobe manifest (compact whole-closet index for the stylist prompt) ─────
// One deterministic line per piece: decision-relevant attributes only, with a
// "?" suffix on low-confidence tag values and [flags] for trust limits. Kept
// byte-stable for a given wardrobe so the prompt prefix stays cache-friendly.

const MANIFEST_LOW_CONFIDENCE_SUFFIX = '?'

function manifestValue(piece, field, value) {
  if (!value) return ''
  return getFieldConfidence(piece, field) === 'low'
    ? `${value}${MANIFEST_LOW_CONFIDENCE_SUFFIX}`
    : String(value)
}

export function buildWardrobeManifestLine(piece = {}) {
  const colors = Array.isArray(piece.colors) ? piece.colors.filter(Boolean) : []
  // reads_as is a read of the garment, not its palette. The line used to show one OR the other, so
  // a piece with reads_as had no colours here at all and search had to re-send them every time.
  const readsAs = piece.reads_as || piece.background_color || ''
  const colorList = colors.join('/')
  const color = [readsAs, readsAs && colorList ? `colors ${colorList}` : (colorList || '')]
    .filter(Boolean).join('; ')
  const weightField = (piece.category === 'shoes' || piece.category === 'accessory') ? 'visual_weight' : 'fabric_weight'
  const weightValue = piece[weightField]
  const fabric = piece.fabric_category
    ? `${manifestValue(piece, 'fabric_category', piece.fabric_category)}${weightValue ? `/${manifestValue(piece, weightField, weightValue)}` : ''}`
    : ''
  const pattern = piece.pattern_complexity && piece.pattern_complexity !== 'solid'
    ? [piece.pattern_type, piece.pattern_scale].filter(Boolean).join('/')
    : ''
  const occasions = Array.isArray(piece.occasions) ? piece.occasions.filter(Boolean) : []
  // The tagger stores a literal 'none' for fields that do not apply to a garment (a shoe has no
  // neckline), and printing them wastes a token on every such piece and reads as a real value.
  const present = value => {
    const v = String(value ?? '').trim()
    return v && v.toLowerCase() !== 'none' ? v : ''
  }
  const neckline = present(piece.neckline) ? manifestValue(piece, 'neckline', piece.neckline) : ''
  const sleeves = [present(piece.sleeve_length), present(piece.sleeve_shape)].filter(Boolean).join('/')

  const attrs = [
    color,
    fabric ? `fabric ${fabric}` : '',
    piece.opacity && piece.opacity !== 'opaque' ? `opacity ${manifestValue(piece, 'opacity', piece.opacity)}` : '',
    piece.needs_base === 'yes' ? 'needs base layer' : '',
    present(piece.silhouette) ? `silhouette ${manifestValue(piece, 'silhouette', piece.silhouette)}` : '',
    piece.shoe_type ? `shoe type ${manifestValue(piece, 'shoe_type', piece.shoe_type)}` : '',
    piece.toe_shape ? `toe ${manifestValue(piece, 'toe_shape', piece.toe_shape)}` : '',
    piece.length_hits_at ? `hits ${manifestValue(piece, 'length_hits_at', piece.length_hits_at)}` : '',
    // docs/search-payload-spec.md option B. These five were stable garment truth that lived only in
    // search_wardrobe's result rows, so every search re-transmitted them uncached while the rest of
    // the same garment's facts sat in this cached line. One home for stable truth, and search is
    // left carrying only per-request judgment.
    neckline ? `neck ${neckline}` : '',
    sleeves ? `sleeve ${sleeves}` : '',
    present(piece.hem_finish) ? `hem ${manifestValue(piece, 'hem_finish', piece.hem_finish)}` : '',
    present(piece.tuck_behavior) ? `tuck ${manifestValue(piece, 'tuck_behavior', piece.tuck_behavior)}` : '',
    present(piece.walk_support) ? `support ${manifestValue(piece, 'walk_support', piece.walk_support)}` : '',
    pattern ? `pattern ${pattern}` : '',
    piece.formality ? `formality ${manifestValue(piece, 'formality', piece.formality)}` : '',
    piece.heel_height ? `heel ${manifestValue(piece, 'heel_height', piece.heel_height)}` : '',
    occasions.length ? `occ ${occasions.join('+')}` : '',
    piece.season && piece.season !== 'year-round' ? `season ${piece.season}` : '',
  ].filter(Boolean).join('; ')

  const fitConfidence = String(piece.fit_confidence || '')
  const flags = [
    piece.recommendation_status && piece.recommendation_status !== 'trusted' ? `trust:${piece.recommendation_status}` : '',
    fitConfidence && fitConfidence !== 'unknown' && fitConfidence !== 'high' && fitConfidence !== 'trusted' ? `fit:${fitConfidence}` : '',
    piece.role_permission && piece.role_permission !== 'auto' ? `role:${piece.role_permission}` : '',
    piece.tag_state === 'provisional' ? 'tags:provisional' : '',
  ].filter(Boolean)

  return `#${piece.id} ${piece.name || 'unnamed piece'} — ${attrs}${flags.length ? ` [${flags.join(' ')}]` : ''}`
}

const MANIFEST_GROUP_ORDER = ['top', 'bottom', 'dress', 'shoes', 'outerwear', 'accessory', 'other']
const MANIFEST_GROUP_LABELS = {
  top: 'TOPS',
  bottom: 'BOTTOMS',
  dress: 'DRESSES',
  shoes: 'SHOES',
  outerwear: 'OUTERWEAR',
  accessory: 'ACCESSORIES',
  other: 'OTHER',
}

export function buildWardrobeManifest(pieces = [], { groupFor } = {}) {
  const resolveGroup = typeof groupFor === 'function'
    ? (piece) => String(groupFor(piece) || 'other').toLowerCase()
    : (piece) => String(piece?.category || 'other').toLowerCase()
  const grouped = new Map(MANIFEST_GROUP_ORDER.map(group => [group, []]))
  for (const piece of pieces) {
    const group = resolveGroup(piece)
    if (!grouped.has(group)) grouped.set(group, [])
    grouped.get(group).push(piece)
  }
  const sections = []
  for (const [group, groupPieces] of grouped) {
    if (!groupPieces.length) continue
    const sorted = [...groupPieces].sort((a, b) => Number(a.id) - Number(b.id))
    const label = MANIFEST_GROUP_LABELS[group] || group.toUpperCase()
    sections.push(`${label} (${sorted.length}):\n${sorted.map(buildWardrobeManifestLine).join('\n')}`)
  }
  return sections.join('\n\n')
}
