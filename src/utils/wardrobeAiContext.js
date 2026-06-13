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

export function computeTuckNote(piece = {}) {
  if (!CLOTHING_WITH_TUCK.has(piece.category)) return null
  if (piece.tuck_behavior === 'wear_over_only') return 'no tuck — wear over only'
  if (piece.fabric_category === 'silk' || piece.fabric_category === 'satin') return 'no tuck — silk/satin cannot hold'
  if (piece.hem_finish === 'ribbed' || piece.hem_finish === 'design_hem') return 'no tuck — design hem'
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
  if (piece.waistband_type === 'drawstring_relaxed') return 'drawstring — no tuck'
  return null
}
export function normalizeOccasionForConfidence(occ) {
  const norm = String(occ || '').toLowerCase().replace('-', ' ').trim()
  if (norm.startsWith('outdoor')) return 'outdoor'
  if (norm.startsWith('smart') || norm.includes('smart')) return 'smart-casual'
  if (norm.includes('art') || norm.includes('gallery')) return 'city'
  if (norm.includes('travel')) return 'city'
  if (norm.includes('home') || norm.includes('lounge')) return 'home'
  return norm.replace(/\s+/g, '-')
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
  const occasionConfidence = normOcc ? String(intelligence.occasionConfidence?.[normOcc] || '').toLowerCase() : ''
  const reasons = []
  const aggressive = explorationMode === 'aggressive'

  if (status === 'avoid' || status === 'do_not_recommend') reasons.push('recommendation status blocks auto-use')
  if (role === 'never_auto' || role === 'only_when_requested') reasons.push('role permission blocks automatic styling')
  if (status === 'needs_fit_review' && !aggressive) reasons.push('needs fit review')
  if (status === 'experimental' && !aggressive) reasons.push('experimental piece held for exploration mode')
  if (fit === 'low' && !aggressive) reasons.push('low fit confidence')
  if (profileTrust === 'do_not_auto_use') reasons.push('AI profile blocks auto-use')
  if (profileTrust === 'needs_fit_review' && !aggressive) reasons.push('AI profile needs fit review')
  if (profileTrust === 'experimental' && !aggressive) reasons.push('AI profile experimental')
  if (occasionConfidence === 'low' && !aggressive) reasons.push(`AI profile low confidence for ${occasion}`)
  if (permissions.length && occasion && !permissions.includes(occasion)) reasons.push(`not permitted for ${occasion}`)
  if (/\b(too small|too tight|does not fit|doesn't fit|bad fit|avoid auto|do not auto|do not auto-style|do not auto style|not evening|not for evening|testing only|only when requested|specifically requested|testing whether alteration)\b/.test(`${notes} ${profileNotes}`) && !aggressive) {
    reasons.push('engine notes suppress auto-use')
  }

  return {
    allowed: reasons.length === 0,
    supportOnly: role === 'support_only' || profileTrust === 'support_only',
    reasons
  }
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
  if (piece.hem_finish) parts.push(`hem: ${piece.hem_finish}`)
  if (piece.length_hits_at) parts.push(`hits at: ${piece.length_hits_at}`)
  if (piece.silhouette) parts.push(`silhouette: ${piece.silhouette}`)
  if (piece.fabric_category) parts.push(`fabric: ${piece.fabric_category}${piece.fabric_weight ? `/${piece.fabric_weight}` : ''}`)
  if (piece.fit_on_body) parts.push(`fit: ${piece.fit_on_body}`)

  const tuck = computeTuckNote(piece) || computeWaistbandNote(piece)
  if (tuck) parts.push(tuck)

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
  if (Array.isArray(piece.styling_rules_learned) && piece.styling_rules_learned.length) {
    text += `\n  RULES (authoritative): ${piece.styling_rules_learned.join(' | ')}`
  }
  if (Array.isArray(piece.tried_and_rejected) && piece.tried_and_rejected.length) {
    text += `\n  REJECTED: ${piece.tried_and_rejected.join(' | ')}`
  }
  if (Array.isArray(piece.pairs_well_with) && piece.pairs_well_with.length) {
    text += `\n  PAIRS WITH: ${piece.pairs_well_with.join(', ')}`
  }

  return text
}
