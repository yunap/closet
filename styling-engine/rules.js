import { db, safeJsonParse } from '../db.js'
import { autoStylingTrustDecision, buildWardrobePieceTruthText } from '../src/utils/wardrobeAiContext.js'
import { WHOLE_WARDROBE_OUTFIT_ARCHETYPES, OUTFIT_MISSIONS } from './prompts.js'
import { resolveOccasionProfile } from './occasions.js'

import {
  fabricWeight,
  bottomKind,
  colorFamily,
  patternLoudness,
  groundingLevel,
  styleLanes,
  garmentKind,
  pieceSoftness,
  pieceGroundingValue,
  pieceStructureValue,
  isExpressiveForAnchor,
  pieceOccasionScore,
  isAccessory,
  isOuterwear,
  isTop,
  wardrobeCategoryGroup,
  isDarkPiece,
  pieceMatchesMaterial,
  pieceMatchesFootwear,
  pieceMatchesPieceName,
  necklineWarmth,
  sleeveCoverage
} from './attributes.js'

export function isStyleSelectedQuestion(question = '') {
  const q = String(question).toLowerCase()
  return !q.trim() || /style|wear|pair|outfit|how should|how do i|what goes|what would work|proposal|suggest/.test(q)
}

export function weatherProfileFromContext({ mood = '', season = '' } = {}) {
  const text = `${mood} ${season}`.toLowerCase()
  const isHot = /\b(hot|heat|heatwave|sweltering|scorching|humid|90s|100 degrees)\b/.test(text)
    || /\bsummer\b/.test(text)
  const isCold = /\b(cold|freezing|frigid|snow|winter|chilly)\b/.test(text)
  return { isHot: isHot && !isCold, isCold: isCold && !isHot }
}

export function pieceFabricWeight(p) {
  if (p.fabric_weight) {
    const fw = String(p.fabric_weight).toLowerCase().trim()
    if (fw === 'heavy') return 'heavy'
    if (fw === 'light' || fw === 'lightweight') return 'light'
    if (fw === 'medium') return 'medium'
  }
  const text = `${p.name || ''} ${p.reads_as || ''}`.toLowerCase()
  if (/\b(wool|denim|corduroy|leather|fleece)\b/i.test(text)) {
    // TODO: backfill fabric_weight in metadata; remove fallback
    return 'heavy'
  }
  if (/\b(linen|gauze|crinkle|seersucker)\b/i.test(text)) {
    // TODO: backfill fabric_weight in metadata; remove fallback
    return 'light'
  }
  return 'medium'
}

export function pieceBareness(p) {
  if (p.style_profile_json?.bareness) {
    return String(p.style_profile_json.bareness).toLowerCase().trim()
  }
  if (p.sleeve_type && /\b(sleeveless|tank|strapless|halter|camisole)\b/i.test(p.sleeve_type)) {
    return 'high'
  }
  if (p.length_hits_at && /\b(mini|short|mid-thigh|upper-thigh)\b/i.test(p.length_hits_at)) {
    return 'high'
  }
  const text = `${p.name || ''} ${p.reads_as || ''}`.toLowerCase()
  if (/\b(shorts?|mini|tank|sleeveless|camisole|cami|halter|strapless|sandals?|mules?|crop|cropped|shortie|cut-offs?)\b/i.test(text)) {
    // TODO: backfill bareness in metadata; remove fallback
    return 'high'
  }
  return 'normal'
}

export function pieceCoverage(p) {
  if (p.style_profile_json?.coverage) {
    return String(p.style_profile_json.coverage).toLowerCase().trim()
  }
  if (p.sleeve_type && /\b(long)\b/i.test(p.sleeve_type)) {
    return 'full-insulating'
  }
  if (p.length_hits_at && /\b(full|ankle|floor|maxi)\b/i.test(p.length_hits_at)) {
    return 'full-insulating'
  }
  const text = `${p.name || ''} ${p.reads_as || ''}`.toLowerCase()
  if (/\b(pants|trousers|jeans|denim|sweaters?|coats?|jackets?|blazers?|boots?|maxi|tunic|cardigans?|trench|parka|turtleneck)\b/i.test(text)) {
    // TODO: backfill coverage in metadata; remove fallback
    return 'full-insulating'
  }
  return 'normal'
}



export { wardrobeCategoryGroup } from './attributes.js'

export function categoryConstraintForSelectedPiece(piece) {
  if (wardrobeCategoryGroup(piece) === 'bottom') {
    return `Selected item category is BOTTOM. Every outfit idea must include "${piece.name}" as the bottom. Do not recommend skirts, dresses, jeans, pants, or any other bottom as an outfit idea.`
  }
  if (wardrobeCategoryGroup(piece) === 'top') {
    return `Selected item category is TOP. Every outfit idea must include "${piece.name}" as the top. Do not replace it with another top.`
  }
  if (wardrobeCategoryGroup(piece) === 'dress') {
    return `Selected item category is DRESS. Every outfit idea must include "${piece.name}" as the dress. Do not replace it with separates.`
  }
  if (wardrobeCategoryGroup(piece) === 'outerwear') {
    return `Selected item category is OUTERWEAR. Every outfit idea must include "${piece.name}" as the outer layer. Do not replace it with another jacket/cardigan.`
  }
  if (wardrobeCategoryGroup(piece) === 'shoes') {
    return `Selected item category is SHOES. Every outfit idea must include "${piece.name}" as the shoes. Do not suggest different shoes unless marked as an avoid note.`
  }
  return `Every outfit idea must include the selected item "${piece.name}".`
}

export function idealAdditionAnchorConstraint(piece) {
  const group = wardrobeCategoryGroup(piece)
  const name = piece?.name || 'selected item'
  const base = `The selected item "${name}" is the non-replaceable anchor. Every direction must keep it in the outfit and suggest only complementary additions around it.`
  if (group === 'bottom') return `${base} Because the anchor is a bottom, do not suggest trousers, jeans, pants, shorts, skirts, dresses, or jumpsuits as missingPieces. Suggest tops, layers, shoes, bags, jewelry, or other support pieces only.`
  if (group === 'top') return `${base} Because the anchor is a top, do not suggest another top, blouse, shirt, sweater, tee, tank, or dress as missingPieces. Suggest bottoms, layers, shoes, bags, or accessories only.`
  if (group === 'dress') return `${base} Because the anchor is a dress, do not suggest another dress or separates that replace it. Suggest shoes, layers, bags, jewelry, belts, or other support pieces only.`
  if (group === 'outerwear') return `${base} Because the anchor is outerwear, do not suggest another jacket, blazer, cardigan, coat, vest, or dress that replaces it. Suggest base layers, bottoms, shoes, bags, or accessories only.`
  if (group === 'shoes') return `${base} Because the anchor is shoes, do not suggest replacement shoes as missingPieces. Suggest tops, bottoms, dresses, layers, bags, or accessories only.`
  return base
}

export function textIncludesAny(value, words) {
  const haystack = String(value || '').toLowerCase()
  return words.some(w => haystack.includes(w))
}

const pieceTextBlobCache = new WeakMap()

export function pieceTextBlob(p) {
  if (p && typeof p === 'object' && pieceTextBlobCache.has(p)) return pieceTextBlobCache.get(p)
  const value = [
    p.name, p.category, p.background_color, p.reads_as, p.pattern_type,
    p.pattern_scale, p.pattern_complexity, p.hem_finish, p.length_hits_at,
    p.silhouette, p.fabric_category, p.fabric_weight, p.fit_on_body,
    p.tuck_behavior, p.waistband_type, p.notes,
    ...(p.colors || []), ...(p.occasions || []),
    ...(p.styling_rules_learned || []), ...(p.pairs_well_with || []), ...(p.tried_and_rejected || [])
  ].filter(Boolean).join(' ').toLowerCase()
  if (p && typeof p === 'object') pieceTextBlobCache.set(p, value)
  return value
}

// Minimal pieceNameBlob helper in server.js:
export function pieceNameBlob(p) {
  return [p.name, p.category, p.reads_as].filter(Boolean).join(' ').toLowerCase()
}

export function pieceHasFocalColor(piece, focalColors) {
  const colors = (piece.colors || []).map(c => c.toLowerCase())
  if (colors.some(c => focalColors.includes(c))) return true
  
  const readsAs = String(piece.reads_as || '').toLowerCase()
  const name = String(piece.name || '').toLowerCase()
  const combined = [readsAs, name].join(' ')
  return focalColors.some(fc => {
    const escaped = fc.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
    const regex = new RegExp('\\b' + escaped + '\\b', 'i')
    return regex.test(combined)
  })
}


export function visualWeightProfile(p) {
  const softness = pieceSoftness(p)
  const expressive = isExpressiveForAnchor(p)
  const grounding = pieceGroundingValue(p)
  const structure = pieceStructureValue(p)
  const lanes = styleLanes(p)

  return {
    grounding,
    groundingLabel: grounding >= 4 ? 'strong anchor' : grounding >= 2 ? 'moderate anchor' : grounding >= 0 ? 'light anchor' : 'floating/soft',
    softness,
    structure,
    expressive,
    lanes: [...new Set(lanes)].slice(0, 3)
  }
}

export function buildVisualWeightText(p) {
  const v = visualWeightProfile(p)
  const lane = v.lanes.length ? v.lanes.join(', ') : 'neutral support'
  return `VISUAL WEIGHT: ${v.groundingLabel}; structure ${v.structure}; softness ${v.softness}; expressive ${v.expressive ? 'yes' : 'no'}; style lane: ${lane}`
}

export function hasPairingReference(sourcePiece, targetPiece) {
  const targetName = String(targetPiece.name || '').toLowerCase()
  return (sourcePiece.pairs_well_with || []).some(note => String(note).toLowerCase().includes(targetName))
}

export function hasRejectedReference(sourcePiece, targetPiece) {
  const targetName = String(targetPiece.name || '').toLowerCase()
  return (sourcePiece.tried_and_rejected || []).some(note => String(note).toLowerCase().includes(targetName))
}

export function collectPieceIdsFromFeedbackPayload(payloadText) {
  const ids = new Set()
  try {
    const payload = typeof payloadText === 'string' ? safeJsonParse(payloadText, {}) : (payloadText || {})
    const visit = (value) => {
      if (!value) return
      if (Array.isArray(value)) return value.forEach(visit)
      if (typeof value === 'object') {
        if (value.id !== undefined && value.id !== null && !Number.isNaN(Number(value.id))) ids.add(Number(value.id))
        if (value.pieceId !== undefined && value.pieceId !== null && !Number.isNaN(Number(value.pieceId))) ids.add(Number(value.pieceId))
        if (Array.isArray(value.pieces)) value.pieces.forEach(visit)
        if (Array.isArray(value.pieceIds)) value.pieceIds.forEach(id => {
          if (!Number.isNaN(Number(id))) ids.add(Number(id))
        })
        if (value.board) visit(value.board)
        if (value.outfit) visit(value.outfit)
      } else if (typeof value === 'number' || /^\d+$/.test(String(value))) {
        ids.add(Number(value))
      }
    }
    visit(payload)
  } catch {}
  return [...ids]
}

export function feedbackWeight(feedbackType) {
  const weights = {
    signature: 38,
    works: 22,
    good_formula: 14,
    good_pieces: 16,
    almost: 4,
    not_me: -32,
    too_safe: -22,
    too_soft: -20,
    too_generic: -26,
    too_boho: -18,
    too_polished: -16,
    weak_structure: -24,
    weak_contrast: -18,
    bad_grounding: -20,
    wrong_silhouette: -8,
    catalog_drift: -34,
    bad_reference: -36,
    proportion_problem: -24,
    wrong_proportions: -24,
    wrong_item_read: -24,
    bad_occasion: -22,
    fit_issue: -34,
  }
  return weights[feedbackType] || 0
}

export function getFeedbackInfluenceForPair(selectedPiece, candidatePiece) {
  if (!selectedPiece?.id || !candidatePiece?.id || typeof db === 'undefined') return null
  try {
    const rows = db.prepare(`
      SELECT * FROM stylist_feedback
      WHERE COALESCE(archived,0) = 0 AND context_type = 'piece'
        AND context_id = ?
      ORDER BY id DESC
      LIMIT 120
    `).all(Number(selectedPiece.id))

    let score = 0
    const reasons = []
    const candidateName = String(candidatePiece.name || '').toLowerCase()

    for (const row of rows) {
      const weight = feedbackWeight(row.feedback_type)
      if (!weight) continue
      const ids = collectPieceIdsFromFeedbackPayload(row.payload)
      const noteBlob = [row.note, row.label, row.context_name].filter(Boolean).join(' ').toLowerCase()
      const touchesCandidate = ids.includes(Number(candidatePiece.id)) || (candidateName && noteBlob.includes(candidateName))
      if (!touchesCandidate) continue

      score += weight + (row.is_gold ? 35 : 0)
      if (row.feedback_type === 'signature') reasons.push('signature feedback')
      else if (row.feedback_type === 'works') reasons.push('works feedback')
      else if (row.feedback_type === 'almost') reasons.push('almost feedback')
      else if (row.feedback_type === 'not_me') reasons.push('not-me feedback')
      else if (row.feedback_type === 'too_soft') reasons.push('too-soft feedback')
      else if (row.feedback_type === 'proportion_problem') reasons.push('proportion feedback')
      else if (row.feedback_type === 'wrong_item_read') reasons.push('wrong-item feedback')
      else if (row.feedback_type === 'too_generic') reasons.push('too-generic feedback')
      else if (row.feedback_type === 'too_safe') reasons.push('too-safe feedback')
      else if (row.feedback_type === 'weak_structure') reasons.push('weak-structure feedback')
      else if (row.feedback_type === 'weak_contrast') reasons.push('weak-contrast feedback')
      else if (row.feedback_type === 'bad_grounding') reasons.push('bad-grounding feedback')
      else if (row.feedback_type === 'wrong_silhouette') reasons.push('wrong-for-this-piece silhouette feedback')
      else if (row.feedback_type === 'catalog_drift') reasons.push('catalog-drift feedback')
    }

    if (!score) return null
    return { score: Math.max(-60, Math.min(60, score)), reasons: [...new Set(reasons)].slice(0, 4) }
  } catch {
    return null
  }
}

export function buildGoldStandardFeedbackMemory(pieceId, limit = 10) {
  try {
    const rows = db.prepare(`
      SELECT * FROM stylist_feedback
      WHERE COALESCE(archived,0) = 0 AND context_type = 'piece'
        AND context_id = ?
        AND feedback_type IN ('signature','works')
      ORDER BY COALESCE(is_gold,0) DESC, CASE feedback_type WHEN 'signature' THEN 0 ELSE 1 END, id DESC
      LIMIT ?
    `).all(Number(pieceId), Number(limit))
    if (!rows.length) return ''
    return rows.map(row => {
      const ids = collectPieceIdsFromFeedbackPayload(row.payload)
      const pieces = ids.length ? db.prepare(`SELECT id, name, category FROM pieces WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []
      const pieceText = pieces.length ? ` pieces: ${pieces.map(p => `${p.name} (${p.category})`).join(' + ')}` : ''
      const note = row.note ? ` — ${String(row.note).slice(0, 220)}` : ''
      return `- ${row.feedback_type}${row.label ? ` / ${row.label}` : ''}${pieceText}${note}`
    }).join('\n')
  } catch {
    return ''
  }
}

export function collectPieceIdsFromSavedBoardRow(row) {
  const ids = new Set()
  if (row?.context_type === 'piece' && row.context_id && !Number.isNaN(Number(row.context_id))) {
    ids.add(Number(row.context_id))
  }
  const visit = (value) => {
    if (!value) return
    if (Array.isArray(value)) return value.forEach(visit)
    if (typeof value === 'object') {
      if (value.id !== undefined && value.id !== null && !String(value.id).startsWith('missing-') && !Number.isNaN(Number(value.id))) ids.add(Number(value.id))
      if (value.pieceId !== undefined && value.pieceId !== null && !Number.isNaN(Number(value.pieceId))) ids.add(Number(value.pieceId))
      if (Array.isArray(value.pieces)) value.pieces.forEach(visit)
      if (Array.isArray(value.pieceIds)) value.pieceIds.forEach(visit)
      if (value.board) visit(value.board)
      if (value.outfit) visit(value.outfit)
    } else if (/^\d+$/.test(String(value))) {
      ids.add(Number(value))
    }
  }
  visit(safeJsonParse(row?.pieces, []))
  visit(safeJsonParse(row?.payload, {}))
  return [...ids]
}

export function getSavedBoardInfluenceForPair(selectedPiece, candidatePiece) {
  if (!selectedPiece?.id || !candidatePiece?.id || typeof db === 'undefined') return null
  try {
    const rows = db.prepare(`
      SELECT * FROM saved_boards
      WHERE COALESCE(archived,0) = 0
        AND ((context_type = 'piece' AND context_id = ?) OR COALESCE(favorite,0) = 1)
      ORDER BY COALESCE(favorite,0) DESC, id DESC
      LIMIT 120
    `).all(Number(selectedPiece.id))
    let score = 0
    const reasons = []
    for (const row of rows) {
      const ids = collectPieceIdsFromSavedBoardRow(row)
      if (!ids.includes(Number(selectedPiece.id)) || !ids.includes(Number(candidatePiece.id))) continue
      score += row.favorite ? 45 : 18
      reasons.push(row.favorite ? 'saved board marked Use strongly' : 'saved board memory')
    }
    if (!score) return null
    return { score: Math.max(0, Math.min(70, score)), reasons: [...new Set(reasons)].slice(0, 3) }
  } catch {
    return null
  }
}

export function getSavedBoardMemory(contextType = null, contextId = null, limit = 10) {
  try {
    const clauses = ['COALESCE(archived,0) = 0']
    const params = []
    if (contextType) { clauses.push('context_type = ?'); params.push(contextType) }
    if (contextId) { clauses.push('context_id = ?'); params.push(Number(contextId)) }
    const rows = db.prepare(`
      SELECT * FROM saved_boards
      WHERE ${clauses.join(' AND ')}
      ORDER BY COALESCE(favorite,0) DESC, id DESC
      LIMIT ?
    `).all(...params, Number(limit))
    if (!rows.length) return ''
    const positiveLabels = /signature|works|strong|most_like_me|grounded|artistic|modern/i
    const negativeLabels = /almost|not_me|too_safe|too_boho|too_polished|too_soft|too_generic|wrong_proportions|body_proportions_drift|wrong_silhouette|wrong_length|wrong_energy|weak_structure|weak_contrast|bad_grounding|catalog_drift|ignore|bad|drift/i
    const positives = []
    const negatives = []
    for (const row of rows) {
      const pieces = safeJsonParse(row.pieces, []).map(p => p?.name).filter(Boolean).join(' + ')
      const payload = safeJsonParse(row.payload, {}) || {}
      const labels = Array.isArray(payload.feedback_labels) ? payload.feedback_labels : []
      const labelText = labels.length ? ` [${labels.join(', ')}]` : ''
      const reason = row.reason ? ` — ${String(row.reason).slice(0, 240)}` : ''
      const line = `- ${row.title || 'Untitled board'}${labelText}${pieces ? ` | pieces: ${pieces}` : ''}${reason}`
      if (row.favorite || labels.some(l => positiveLabels.test(String(l)))) positives.push(line)
      if (labels.some(l => negativeLabels.test(String(l)))) negatives.push(line)
      if (!row.favorite && !labels.length) positives.push(`- Saved board: ${line.slice(2)}`)
    }
    const parts = []
    if (positives.length) parts.push(`Saved visual board positive memory. Bias future outfit suggestions toward these successful formulas:\n${positives.slice(0, 10).join('\n')}`)
    if (negatives.length) parts.push(`Saved visual board negative memory. Avoid repeating these drift/problem patterns:\n${negatives.slice(0, 10).join('\n')}`)
    return parts.join('\n\n')
  } catch {
    return ''
  }
}

export function explicitOccasionsForPiece(piece = {}) {
  return Array.isArray(piece.occasions) ? piece.occasions.map(o => String(o).toLowerCase()) : []
}

export function profileOccasionConfidence(piece = {}, occasion = '') {
  const intelligence = pieceGarmentIntelligence(piece)
  return String(intelligence.occasionConfidence?.[occasion] || '').toLowerCase()
}

export function pieceMatchesOccasion(piece = {}, occasion = '') {
  const requested = String(occasion || '').toLowerCase().trim()
  if (!requested) return true
  const occasions = explicitOccasionsForPiece(piece)
  const confidence = profileOccasionConfidence(piece, requested)
  if (occasions.includes(requested)) return confidence !== 'low'
  return confidence === 'high' || confidence === 'medium'
}

export function styleLaneScore(piece = {}, lane = '') {
  const lanes = pieceStyleProfile(piece)?.style_lanes || {}
  const score = Number(lanes[lane])
  return Number.isFinite(score) ? score : 0
}

export function garmentProfileText(piece = {}) {
  const intelligence = pieceGarmentIntelligence(piece)
  const profile = pieceStyleProfile(piece)
  return [
    profile?.style_notes?.best_use,
    profile?.style_notes?.risk,
    intelligence.bestOutfitRole,
    ...intelligence.pairingRequirements,
    ...intelligence.failureRisks,
    ...intelligence.formulaCompatibility,
    ...intelligence.doNotPairRules,
    ...Object.values(intelligence.realWearNotes || {})
  ].filter(Boolean).join(' ').toLowerCase()
}

export function optionalLayerCoherenceIssue(selected = {}, layer = {}, corePieces = [], options = {}) {
  if (wardrobeCategoryGroup(layer) !== 'outerwear') return ''
  const occasion = String(options.occasion || '').toLowerCase().trim()
  if (occasion && !pieceMatchesOccasion(layer, occasion)) return `weak ${occasion} occasion fit`

  const core = [selected, ...corePieces].filter(Boolean)
  const coreText = core.map(piece => `${pieceTextBlob(piece)} ${garmentProfileText(piece)}`).join(' ')
  const layerText = `${pieceTextBlob(layer)} ${garmentProfileText(layer)}`
  const polishedLayer = styleLaneScore(layer, 'polished_classic') >= 4 ||
    /\b(tweed|blazer|tailored|polished|classic|formal|structured jacket)\b/.test(layerText)
  const relaxedCore = /\b(relaxed|capri|wide-leg|wide leg|linen|cotton|athletic|sneaker|slip-on|easy everyday|soft|casual)\b/.test(coreText)
  const layerWarnsAgainstRelaxed = /\b(too formal|stiff|overly relaxed|casual bottoms|relaxed pieces|overly casual)\b/.test(layerText)
  if (polishedLayer && relaxedCore && layerWarnsAgainstRelaxed) return 'optional polished layer fights the relaxed core outfit'

  const expressiveCoreCount = core.filter(piece => {
    const text = `${pieceTextBlob(piece)} ${garmentProfileText(piece)}`
    return /\b(floral|graphic|print|pattern|polka|bow|lace|ruffle|bold|statement|texture_piece|color_accent)\b/.test(text)
  }).length
  const texturedLayer = /\b(tweed|jacquard|boucle|embroider|texture_piece|pattern|print)\b/.test(layerText)
  if (texturedLayer && expressiveCoreCount >= 2) return 'optional layer adds a competing texture to an already expressive core'

  return ''
}

export function compatibilityScoreForSelectedItem(selected, candidate, options = {}) {
  let score = 0
  const reasons = []
  const selectedBlob = pieceTextBlob(selected)
  const candidateBlob = pieceTextBlob(candidate)
  const occasion = String(options.occasion || '').toLowerCase().trim()

  // Weather appropriateness — independent term, applies to every candidate
  const weather = options.weatherProfile || weatherProfileFromContext(options)
  if (weather.isHot) {
    if (pieceFabricWeight(candidate) === 'heavy') { score -= 12; reasons.push('hot weather: heavy fabric') }
    if (pieceFabricWeight(candidate) === 'light') { score += 10; reasons.push('hot weather: lightweight fabric') }
    if (pieceBareness(candidate) === 'high')      { score += 8;  reasons.push('hot weather: skin-friendly cut') }
    if (pieceCoverage(candidate) === 'full-insulating') { score -= 8; reasons.push('hot weather: insulating coverage') }
  }
  if (weather.isCold) {
    if (pieceFabricWeight(candidate) === 'heavy') { score += 10; reasons.push('cold weather: heavy fabric') }
    if (pieceFabricWeight(candidate) === 'light') { score -= 12; reasons.push('cold weather: lightweight fabric') }
    if (pieceBareness(candidate) === 'high')      { score -= 8;  reasons.push('cold weather: skin-friendly cut') }
    if (pieceCoverage(candidate) === 'full-insulating') { score += 8;  reasons.push('cold weather: insulating coverage') }
  }

  if (candidate.favorite) { score += 4; reasons.push('favorite') }
  if (hasPairingReference(selected, candidate) || hasPairingReference(candidate, selected)) {
    score += 16; reasons.push('confirmed pairing note')
  }
  if (hasRejectedReference(selected, candidate) || hasRejectedReference(candidate, selected)) {
    score -= 40; reasons.push('rejected pairing note')
  }

  if (occasion && !pieceMatchesOccasion(candidate, occasion)) {
    score -= 14
    reasons.push(`weak ${occasion} occasion fit`)
  }
  const layerIssue = optionalLayerCoherenceIssue(selected, candidate, [], { occasion })
  if (layerIssue) {
    score -= 24
    reasons.push(layerIssue)
  }

  if (selected.category === 'bottom') {
    if (candidate.category === 'top') { score += 10; reasons.push('needed top for selected bottom') }
    if (candidate.category === 'shoes') { score += 4; reasons.push('shoe support') }
    if (candidate.category === 'accessory') { score += 2; reasons.push('accessory support') }
    if (candidate.category === 'bottom' || candidate.category === 'dress') { score -= 60; reasons.push('competing bottom/dress') }

    if (candidate.category === 'top') {
      if (textIncludesAny(candidateBlob, ['fitted', 'slim', 'compact', 'structured', 'sleeveless', 'shell', 'tank', 'short sleeve', 'short-sleeve'])) {
        score += 12; reasons.push('compact/structured top')
      }
      if (textIncludesAny(candidateBlob, ['boxy', 'oversized', 'drop-shoulder', 'loose', 'relaxed']) &&
          textIncludesAny(selectedBlob, ['wide', 'bootcut', 'relaxed', 'gauzy', 'soft', 'corduroy', 'stripe'])) {
        score -= 8; reasons.push('wide/soft top risk with statement bottom')
      }
      if (textIncludesAny(candidateBlob, ['long', 'mid-thigh', 'tunic']) && textIncludesAny(selectedBlob, ['stripe', 'corduroy', 'wide', 'bootcut'])) {
        score -= 8; reasons.push('long layer may break vertical line')
      }
    }
  } else if (selected.category === 'top') {
    if (candidate.category === 'bottom') { score += 10; reasons.push('needed bottom for selected top') }
    if (candidate.category === 'shoes') { score += 4; reasons.push('shoe support') }
    if (candidate.category === 'accessory') { score += 2; reasons.push('accessory support') }
    if (candidate.category === 'top') { score -= 60; reasons.push('competing top') }

    if (candidate.category === 'bottom') {
      const cleanSelectedBlob = selectedBlob.replace(/\b(t-shirt|sweatshirt|tee-shirt|tee shirt|t shirt)\b/gi, '')
      const selectedIsButtonOrTunic = (
        textIncludesAny(cleanSelectedBlob, ['button-up', 'button up', 'button-down', 'button down', 'tunic', 'popover', 'longline']) ||
        /\bshirt\b/i.test(cleanSelectedBlob)
      )
      const selectedIsCompactTop = textIncludesAny(selectedBlob, ['shell', 'sleeveless', 'tank', 'compact', 'cropped', 'short sleeve', 'short-sleeve', 'fitted knit', 'fitted top']) && !selectedIsButtonOrTunic
      
      const bKind = bottomKind(candidate)
      const bottomIsSkirt = bKind && bKind.startsWith('skirt')
      const bottomIsShorts = bKind === 'shorts'
      const bottomIsPantsColumn = bKind === 'pants' && (colorFamily(candidate) === 'dark-anchor' || colorFamily(candidate) === 'warm-earth' || textIncludesAny(candidateBlob, ['jeans', 'denim', 'pants', 'trousers', 'straight', 'slim', 'bootcut', 'flare', 'wide-leg', 'wide leg', 'column']))
      
      const bottomIsAbruptSkirt = bKind === 'skirt-mini'
      const bottomIsUsefulSkirt = bKind === 'skirt-midi' || bKind === 'skirt-maxi'
      const selectedWeight = visualWeightProfile(selected)
      const candidateWeight = visualWeightProfile(candidate)
      const selectedNeedsAnchor = selectedWeight.softness >= 2 || (selectedWeight.expressive && textIncludesAny(selectedBlob, ['lace','floral','appliqué','applique','sheer','cream','white','pale','soft']))

      if (selectedNeedsAnchor && candidateWeight.grounding >= 3) {
        score += 14; reasons.push('visual gravity for soft/expressive top')
      }
      if (selectedNeedsAnchor && candidateWeight.grounding < 1) {
        score -= 12; reasons.push('too little lower-half anchor')
      }
      if (selectedNeedsAnchor && textIncludesAny(candidateBlob, ['white','cream','pale','light']) && !textIncludesAny(candidateBlob, ['denim','structured','utility','twill','pencil','maxi'])) {
        score -= 7; reasons.push('pale-on-pale softness risk')
      }
      if (bottomIsUsefulSkirt && candidateWeight.grounding >= 3) {
        score += 10; reasons.push('grounded skirt anchor')
      }

      if (textIncludesAny(candidateBlob, ['structured', 'column', 'dark', 'navy', 'black', 'brown', 'denim', 'straight', 'slim', 'bootcut', 'flare'])) {
        score += 12; reasons.push('stable vertical bottom')
      }
      if (bottomIsPantsColumn && selectedIsButtonOrTunic) {
        score += 10; reasons.push('preserves vertical continuity for shirt/tunic')
      }
      if (bottomIsUsefulSkirt && selectedIsCompactTop) {
        score += 8; reasons.push('compact top can support skirt formula')
      }
      if (bottomIsAbruptSkirt && selectedIsButtonOrTunic) {
        score -= 22; reasons.push('abrupt skirt hem weakens vertical continuity')
      } else if (bottomIsAbruptSkirt && !selectedIsCompactTop) {
        score -= 12; reasons.push('short skirt is less signature without compact top')
      }
      if (textIncludesAny(candidateBlob, ['gauzy', 'soft', 'wide', 'relaxed']) && textIncludesAny(selectedBlob, ['loose', 'oversized', 'boxy', 'drape', 'tunic'])) {
        score -= 12; reasons.push('wide + soft risk')
      }
    }
  } else if (selected.category === 'dress') {
    if (['shoes','accessory','outerwear'].includes(candidate.category)) { score += 8; reasons.push('supports selected dress') }
    if (['top','bottom','dress'].includes(candidate.category)) { score -= 40; reasons.push('replaces dress') }
  } else if (selected.category === 'shoes') {
    if (candidate.category === 'top') { score += 9; reasons.push('needed top for selected shoes') }
    if (candidate.category === 'bottom') { score += 9; reasons.push('needed bottom for selected shoes') }
    if (candidate.category === 'dress') { score += 8; reasons.push('dress formula for selected shoes') }
    if (candidate.category === 'outerwear') { score += 4; reasons.push('layer support for selected shoes') }
    if (candidate.category === 'accessory') { score += 2; reasons.push('accessory support') }
    if (candidate.category === 'shoes') { score -= 60; reasons.push('replacement shoe') }
  }

  const earthyOrDeep = ['olive','mustard','cognac','cream','beige','taupe','navy','denim','brown','tan','oatmeal','amber','plum','charcoal','dark blue','dark grey']
  const sharedColors = (candidate.colors || []).filter(c => (selected.colors || []).includes(c))
  if (sharedColors.length) { score += 3; reasons.push(`shared color: ${sharedColors.slice(0,2).join('/')}`) }
  if ((candidate.colors || []).some(c => earthyOrDeep.includes(c))) { score += 3; reasons.push('Yuna palette') }
  if (textIncludesAny(candidateBlob, ['artistic', 'graphic', 'architectural', 'texture', 'textured', 'corduroy', 'crochet', 'cashmere', 'linen', 'knit'])) {
    score += 4; reasons.push('artistic/texture vocabulary')
  }

  const selectedSoft = textIncludesAny(selectedBlob, ['gauzy', 'soft', 'drape', 'loose knit', 'oversized', 'relaxed'])
  const candidateSoft = textIncludesAny(candidateBlob, ['gauzy', 'soft', 'drape', 'loose knit', 'oversized', 'relaxed'])
  if (selectedSoft && candidateSoft) { score -= 7; reasons.push('soft + soft risk') }

  const selectedExpressive = textIncludesAny(selectedBlob, ['loud', 'bold', 'graphic', 'floral', 'stripe', 'abstract', 'multi', 'pattern'])
  const candidateExpressive = textIncludesAny(candidateBlob, ['loud', 'bold', 'graphic', 'floral', 'stripe', 'abstract', 'multi', 'pattern'])
  // TODO: a register attribute in attributes.js could one day let the penalty fire only on cross-register pairs.
  if (selectedExpressive && candidateExpressive) { score -= 5; reasons.push('expressive competition risk') }

  const feedbackInfluence = getFeedbackInfluenceForPair(selected, candidate)
  if (feedbackInfluence) {
    score += feedbackInfluence.score
    reasons.push(...feedbackInfluence.reasons)
  }

  const savedBoardInfluence = getSavedBoardInfluenceForPair(selected, candidate)
  if (savedBoardInfluence) {
    score += savedBoardInfluence.score
    reasons.push(...savedBoardInfluence.reasons)
  }

  return { score, reasons }
}

export function rankedComplementaryWardrobeFor(piece, allPieces, limit = 24, options = {}) {
  const selectedCategory = piece.category
  const allowed = allPieces.filter(p => {
    if (p.id === piece.id) return false
    if (selectedCategory === 'bottom') return ['top','outerwear','shoes','accessory'].includes(p.category)
    if (selectedCategory === 'top') return ['bottom','outerwear','shoes','accessory'].includes(p.category)
    if (selectedCategory === 'dress') return ['outerwear','shoes','accessory'].includes(p.category)
    if (selectedCategory === 'outerwear') return ['top','bottom','dress','shoes','accessory'].includes(p.category)
    if (selectedCategory === 'shoes') return ['top','bottom','dress','outerwear','accessory'].includes(p.category)
    return true
  })

  return allowed
    .map(p => {
      const scored = compatibilityScoreForSelectedItem(piece, p, options)
      const trust = wholeWardrobePieceTrustDecision(p, {
        occasion: options.occasion || 'casual',
        explorationMode: options.explorationMode || 'moderate',
        weatherProfile: options.weatherProfile
      })
      return {
        piece: p,
        ...scored,
        score: scored.score + (trust.allowed ? 0 : -120),
        reasons: [
          ...(scored.reasons || []),
          ...(trust.allowed ? [] : trust.reasons.map(reason => `auto-use blocked: ${reason}`))
        ],
        autoUseBlocked: !trust.allowed,
        autoUseBlockReasons: trust.reasons
      }
    })
    .sort((a,b) => b.score - a.score || Number(b.piece.favorite) - Number(a.piece.favorite) || String(a.piece.category).localeCompare(String(b.piece.category)))
    .slice(0, limit)
}

export function complementaryWardrobeFor(piece, allPieces, limit = 24, options = {}) {
  return rankedComplementaryWardrobeFor(piece, allPieces, limit, options).map(r => r.piece)
}

export function buildRankedCandidateText(rankedCandidates) {
  if (!rankedCandidates?.length) return ''
  return rankedCandidates.map((r, idx) => {
    const reasonText = r.reasons?.length ? `\n  RANKING REASONS: ${r.reasons.slice(0, 4).join('; ')} | score ${r.score}` : ''
    return `${idx + 1}. ${buildPieceText(r.piece)}${reasonText}`
  }).join('\n')
}

export function selectCandidatesForOutfitGeneration(piece, allPieces, limit = 30, options = {}) {
  const ranked = rankedComplementaryWardrobeFor(piece, allPieces, limit, options)
  const byCategory = { top: [], bottom: [], dress: [], outerwear: [], shoes: [], accessory: [] }
  for (const r of ranked) {
    const cat = r.piece.category || 'other'
    if (byCategory[cat]) byCategory[cat].push(r)
  }
  const mixed = []
  const addSome = (cat, count) => {
    const rows = byCategory[cat] || []
    const trusted = rows.filter(r => !r.autoUseBlocked)
    const source = trusted.length ? trusted : rows
    mixed.push(...source.slice(0, count))
  }

  if (wardrobeCategoryGroup(piece) === 'top') {
    addSome('bottom', 12); addSome('shoes', 8); addSome('outerwear', 5); addSome('accessory', 5)
  } else if (wardrobeCategoryGroup(piece) === 'bottom') {
    addSome('top', 12); addSome('shoes', 8); addSome('outerwear', 5); addSome('accessory', 5)
  } else if (wardrobeCategoryGroup(piece) === 'dress') {
    addSome('shoes', 10); addSome('outerwear', 8); addSome('accessory', 6)
  } else if (wardrobeCategoryGroup(piece) === 'shoes') {
    addSome('top', 12); addSome('bottom', 12); addSome('dress', 8); addSome('outerwear', 6); addSome('accessory', 4)
  } else {
    mixed.push(...ranked.slice(0, limit))
  }

  const seen = new Set()
  return mixed.filter(r => {
    if (seen.has(r.piece.id)) return false
    seen.add(r.piece.id)
    return true
  }).slice(0, limit)
}

export function buildOutfitGenerationCandidateText(rankedCandidates) {
  if (!rankedCandidates?.length) return ''
  return rankedCandidates.map((r, idx) => {
    const p = r.piece
    const reasons = r.reasons?.length ? `\n  WHY RETRIEVED: ${r.reasons.slice(0, 5).join('; ')} | score ${r.score}` : ''
    return `${idx + 1}. [garment id: ${p.id}] ${buildPieceText(p)}${reasons}`
  }).join('\n')
}

export function getOutfitsForPieceMemory(pieceId, limit = 6) {
  const outfits = db.prepare(`
    SELECT o.* FROM outfits o
    JOIN outfit_pieces op ON o.id = op.outfit_id
    WHERE op.piece_id = ?
    ORDER BY o.favorite DESC, o.date_added DESC
    LIMIT ?
  `).all(pieceId, limit)
  return outfits.map(o => buildOutfitText(o, getLinkedPiecesForOutfit(o.id))).join('\n\n')
}

// These are mock-like wrappers or helpers used to avoid missing definitions:
function buildOutfitText(o, pieces) {
  const pieceNames = pieces.map(p => `${p.name} (${p.category})`).join(' + ')
  return `• Outfit: ${o.name} | occasion: ${o.occasion} | season: ${o.season} | pieces: ${pieceNames} | notes: ${o.notes || 'none'}`
}

function getLinkedPiecesForOutfit(outfitId) {
  const rows = db.prepare(`
    SELECT p.* FROM pieces p
    JOIN outfit_pieces op ON p.id = op.piece_id
    WHERE op.outfit_id = ?
  `).all(outfitId)
  return rows.map(p => parsePiece(p))
}

export function parsePiece(p) {
  return p ? ({
    ...p,
    colors:                JSON.parse(p.colors                || '[]'),
    occasions:             JSON.parse(p.occasions             || '[]'),
    occasion_permissions:   JSON.parse(p.occasion_permissions  || '[]'),
    occasion_exclusions:    JSON.parse(p.occasion_exclusions   || '[]'),
    styling_rules_learned: JSON.parse(p.styling_rules_learned || '[]'),
    pairs_well_with:       JSON.parse(p.pairs_well_with       || '[]'),
    tried_and_rejected:    JSON.parse(p.tried_and_rejected    || '[]'),
    style_profile_json:    safeJsonParse(p.style_profile_json, {}) || {},
    recommendation_status: p.recommendation_status || 'trusted',
    fit_confidence:        p.fit_confidence        || 'unknown',
    role_permission:       p.role_permission       || 'auto',
    engine_notes:          p.engine_notes          || '',
    favorite: Boolean(p.favorite)
  }) : null
}

export function getStylistFeedbackMemory(contextType = null, contextId = null, limit = 16) {
  try {
    const clauses = []
    const params = []
    if (contextType) { clauses.push('context_type = ?'); params.push(contextType) }
    if (contextId) { clauses.push('context_id = ?'); params.push(Number(contextId)) }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = db.prepare(`
      SELECT * FROM stylist_feedback
      ${where ? where + ' AND COALESCE(archived,0) = 0' : 'WHERE COALESCE(archived,0) = 0'}
      ORDER BY COALESCE(is_gold,0) DESC, id DESC
      LIMIT ?
    `).all(...params, Number(limit))

    if (!rows.length) return ''
    return rows.map(r => {
      const target = r.target_type ? `${r.target_type}` : 'item'
      const label = r.label ? ` — ${r.label}` : ''
      const note = r.note ? `: ${String(r.note).slice(0, 280)}` : ''
      if (r.feedback_type === 'wrong_silhouette') {
        return `- wrong_silhouette on ${target}${label}${note} — scoped to this selected garment/board; do NOT globally avoid this silhouette family.`
      }
      if (r.feedback_type === 'wrong_proportions' || r.feedback_type === 'proportion_problem') {
        return `- ${r.feedback_type} on ${target}${label}${note} — scoped to this selected garment/board; do NOT treat as a universal proportion rule.`
      }
      return `- ${r.feedback_type} on ${target}${label}${note}`
    }).join('\n')
  } catch {
    return ''
  }
}

export function getWholeWardrobeFeedbackMemory(limit = 24) {
  try {
    const rows = db.prepare(`
      SELECT * FROM stylist_feedback
      WHERE COALESCE(archived,0) = 0
        AND target_type = 'whole_wardrobe_outfit'
      ORDER BY COALESCE(is_gold,0) DESC, id DESC
      LIMIT ?
    `).all(Number(limit))

    if (!rows.length) return ''
    const positives = []
    const negatives = []
    for (const row of rows) {
      const payload = safeJsonParse(row.payload, {}) || {}
      const outfit = payload.outfit || {}
      const pieces = Array.isArray(payload.pieces) && payload.pieces.length
        ? payload.pieces
        : (Array.isArray(outfit.pieces) ? outfit.pieces : [])
      const pieceText = pieces.map(p => p?.name).filter(Boolean).join(' + ')
      const formula = payload.formulaFamily || outfit.formulaFamily || ''
      const occasion = payload.occasion || outfit.bestFor || ''
      const note = row.note ? ` — ${String(row.note).slice(0, 220)}` : ''
      const line = `- ${row.feedback_type}${row.label ? ` / ${row.label}` : ''}${occasion ? ` (${occasion})` : ''}${formula ? ` | formula: ${formula}` : ''}${pieceText ? ` | pieces: ${pieceText}` : ''}${note}`
      if (feedbackWeight(row.feedback_type) > 0) positives.push(line)
      if (feedbackWeight(row.feedback_type) < 0) negatives.push(line)
    }

    const parts = []
    if (positives.length) parts.push(`Whole-wardrobe outfit feedback to reinforce. Prefer similar garment relationships and formulas when pieces/occasion fit:\n${positives.slice(0, 10).join('\n')}`)
    if (negatives.length) parts.push(`Whole-wardrobe outfit feedback to suppress. Avoid repeating these exact combinations, piece roles, formulas, or occasion mismatches:\n${negatives.slice(0, 12).join('\n')}`)
    return parts.join('\n\n')
  } catch {
    return ''
  }
}

export function buildWholeWardrobeFeedbackInfluence(limit = 120) {
  const influence = {
    piece: new Map(),
    combination: new Map(),
    formula: new Map(),
    occasionFormula: new Map(),
    pieceFormula: new Map(),
    rowsUsed: 0
  }
  const add = (map, key, value) => {
    if (!key || !value) return
    map.set(key, (map.get(key) || 0) + value)
  }
  try {
    const rows = db.prepare(`
      SELECT * FROM stylist_feedback
      WHERE COALESCE(archived,0) = 0
        AND target_type = 'whole_wardrobe_outfit'
      ORDER BY id DESC
      LIMIT ?
    `).all(Number(limit))
    for (const row of rows) {
      const weight = feedbackWeight(row.feedback_type)
      if (!weight) continue
      const payload = safeJsonParse(row.payload, {}) || {}
      const outfit = payload.outfit || {}
      const pieceIds = [...new Set((payload.pieceIds || outfit.pieceIds || collectPieceIdsFromFeedbackPayload(row.payload))
        .map(Number)
        .filter(Boolean))]
      const focusedPieceId = Number(payload.pieceId)
      const formula = payload.formulaFamily || outfit.formulaFamily || ''
      const occasion = payload.occasion || outfit.bestFor || ''
      const signedWeight = weight + (row.is_gold ? Math.sign(weight) * 18 : 0)

      if (Number.isFinite(focusedPieceId) && focusedPieceId > 0) {
        const focusedWeight = row.feedback_type === 'wrong_item_read' || row.feedback_type === 'fit_issue'
          ? Math.round(signedWeight * 1.35)
          : Math.round(signedWeight * 0.9)
        add(influence.piece, focusedPieceId, focusedWeight)
        if (formula) add(influence.pieceFormula, `${focusedPieceId}||${formula}`, Math.round(focusedWeight * 0.8))
      } else if (pieceIds.length) {
        const comboKey = pieceIds.slice().sort((a, b) => a - b).join('|')
        add(influence.combination, comboKey, Math.round(signedWeight * 1.15))
        const pieceMultiplier = row.feedback_type === 'good_formula' ? 0.12 : (row.feedback_type === 'good_pieces' ? 0.55 : 0.35)
        for (const id of pieceIds) add(influence.piece, id, Math.round(signedWeight * pieceMultiplier))
      }
      const formulaMultiplier = row.feedback_type === 'good_formula' ? 0.9 : (row.feedback_type === 'good_pieces' ? 0.2 : 0.45)
      add(influence.formula, formula, Math.round(signedWeight * formulaMultiplier))
      if (occasion && formula) add(influence.occasionFormula, `${occasion}||${formula}`, Math.round(signedWeight * 0.65))
      influence.rowsUsed += 1
    }
  } catch {}
  return influence
}

export function saveWholeWardrobeSession({ occasion = '', outfits = [] } = {}) {
  try {
    const pieceIds = [...new Set(
      outfits
        .flatMap(outfit => {
          const ids = Array.isArray(outfit?.pieceIds) && outfit.pieceIds.length
            ? outfit.pieceIds
            : (Array.isArray(outfit?.pieces) ? outfit.pieces.map(piece => piece?.id) : [])
          return ids
        })
        .map(Number)
        .filter(Boolean)
    )]
    const formulaFamilies = [...new Set(outfits
      .map(outfit => outfit?.formulaFamily || wholeWardrobeFormulaFamily(outfit, outfit?.pieces || [], occasion))
      .filter(Boolean))]
    if (!pieceIds.length && !formulaFamilies.length) return

    db.prepare(`
      INSERT INTO whole_wardrobe_sessions (occasion, piece_ids, formula_families)
      VALUES (?, ?, ?)
    `).run(occasion || '', JSON.stringify(pieceIds), JSON.stringify(formulaFamilies))

    db.prepare(`
      DELETE FROM whole_wardrobe_sessions
      WHERE id NOT IN (
        SELECT id FROM whole_wardrobe_sessions ORDER BY id DESC LIMIT 10
      )
    `).run()
  } catch (err) {
    console.warn('saveWholeWardrobeSession failed:', err.message)
  }
}

export function getRecentWholeWardrobeSessionInfluence({ occasion = '', daysCutoff = 6 } = {}) {
  const empty = { pieceRecency: new Map(), formulaRecency: new Map(), sessionCount: 0 }
  try {
    const cutoff = Math.floor(Date.now() / 1000) - Number(daysCutoff || 6) * 86400
    const rows = db.prepare(`
      SELECT occasion, piece_ids, formula_families, created_at
      FROM whole_wardrobe_sessions
      WHERE created_at > ?
      ORDER BY created_at DESC
      LIMIT 6
    `).all(cutoff)

    const pieceRecency = new Map()
    const formulaRecency = new Map()
    const requestedOccasion = String(occasion || '').toLowerCase().trim()

    rows.forEach((row, sessionIndex) => {
      const sessionOccasion = String(row.occasion || '').toLowerCase().trim()
      const sameOccasion = requestedOccasion && sessionOccasion && requestedOccasion === sessionOccasion
      const occasionFactor = sameOccasion ? 1 : 0.55
      const decayFactor = Math.max(0.2, 1 - (sessionIndex * 0.16)) * occasionFactor
      const ids = safeJsonParse(row.piece_ids, [])
      const families = safeJsonParse(row.formula_families, [])

      for (const id of (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean)) {
        pieceRecency.set(id, (pieceRecency.get(id) || 0) + Math.round(18 * decayFactor))
      }
      for (const family of (Array.isArray(families) ? families : []).filter(Boolean)) {
        formulaRecency.set(family, (formulaRecency.get(family) || 0) + Math.round(30 * decayFactor))
      }
    })

    return { pieceRecency, formulaRecency, sessionCount: rows.length }
  } catch (err) {
    console.warn('getRecentWholeWardrobeSessionInfluence failed:', err.message)
    return empty
  }
}

export function wholeWardrobeFeedbackInfluenceForCandidate(pieces = [], options = {}) {
  const influence = options.wholeWardrobeFeedbackInfluence
  if (!influence) return null
  const ids = pieces.map(p => Number(p.id)).filter(Boolean)
  const outfit = { pieces }
  const comboKey = ids.slice().sort((a, b) => a - b).join('|')
  const formula = wholeWardrobeFormulaFamily(outfit, pieces, options.occasion)
  const occasionFormula = `${options.occasion || ''}||${formula}`
  let score = 0
  const reasons = []
  const addScore = (value, reason) => {
    if (!value) return
    score += value
    reasons.push(reason)
  }

  addScore(influence.combination.get(comboKey), 'whole-wardrobe exact-combination feedback')
  addScore(influence.formula.get(formula), `whole-wardrobe ${formula} feedback`)
  addScore(influence.occasionFormula.get(occasionFormula), `whole-wardrobe ${options.occasion || 'occasion'} formula feedback`)
  const pieceFormulaScore = ids.reduce((sum, id) => sum + (influence.pieceFormula.get(`${id}||${formula}`) || 0), 0)
  addScore(Math.max(-55, Math.min(35, pieceFormulaScore)), 'whole-wardrobe piece/formula feedback')
  const pieceScore = ids.reduce((sum, id) => sum + (influence.piece.get(id) || 0), 0)
  addScore(Math.max(-45, Math.min(30, Math.round(pieceScore / Math.max(1, ids.length)))), 'whole-wardrobe piece feedback')

  if (!score) return null
  return {
    score: Math.max(-80, Math.min(80, score)),
    reasons: [...new Set(reasons)].slice(0, 4)
  }
}

export function buildPieceText(p) {
  return buildWardrobePieceTruthText(p)
}

export function pieceStyleProfile(piece = {}) {
  if (piece?.style_profile_json && typeof piece.style_profile_json === 'object') return piece.style_profile_json
  return safeJsonParse(piece?.style_profile_json, {}) || {}
}

export function normalizeStyleProfileList(value) {
  if (!value) return []
  if (Array.isArray(value)) return [...new Set(value.map(v => String(v || '').trim()).filter(Boolean))]
  return String(value)
    .split(/[\n;]+/)
    .map(v => v.trim())
    .filter(Boolean)
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
    occasionConfidence: info.occasion_confidence && typeof info.occasion_confidence === 'object' ? info.occasion_confidence : {}
  }
}

export function inferWholeWardrobePieceRoles(piece = {}) {
  const profile = pieceStyleProfile(piece)
  const intelligence = pieceGarmentIntelligence(piece)
  const profileRoles = [
    ...(Array.isArray(profile.roles) ? profile.roles : []),
    ...(Array.isArray(profile.visual_roles) ? profile.visual_roles : []),
    intelligence.bestOutfitRole,
  ].filter(Boolean)
  const group = wardrobeCategoryGroup(piece)
  const text = [
    pieceNameBlob(piece),
    piece.background_color,
    piece.reads_as,
    piece.pattern_type,
    piece.pattern_complexity,
    piece.silhouette,
    piece.fabric_category,
    piece.fabric_weight,
    piece.fit_on_body,
    piece.notes,
    ...(piece.colors || []),
    ...(piece.styling_rules_learned || [])
  ].filter(Boolean).join(' ').toLowerCase()
  const roles = new Set(profileRoles)
  if (group === 'dress') roles.add('one_piece_column')
  if (group === 'top' && /\b(fitted|sleeveless|tank|shell|compact|structured)\b/.test(text)) roles.add('upper_anchor')
  if (group === 'top' && /\b(relaxed|oversized|loose|tunic|boxy|linen|knit)\b/.test(text)) roles.add('relaxed_upper')
  if (group === 'bottom' && /\b(black|charcoal|dark|navy|denim|jean|straight|bootcut|trouser|column)\b/.test(text)) {
    roles.add('lower_column')
    if (isDarkPiece(piece)) {
      roles.add('dark_lower_column')
    }
  }
  if (group === 'shoes') roles.add('grounding_piece')
  if (group === 'shoes' && /\b(pointed|patent|loafer|boot|mule|oxford)\b/.test(text)) roles.add('sharp_finish')
  if (['outerwear', 'bottom', 'top'].includes(group) && /\b(structured|blazer|jacket|utility|trouser|denim|crisp|architectural)\b/.test(text)) roles.add('structure_support')
  if (/\b(floral|print|graphic|stripe|striped|pattern|abstract|tapestry|bold)\b/.test(text)) roles.add('graphic_element')
  if (/\b(soft|gauzy|drape|drapey|linen|cashmere|knit|chiffon|lace|cream|ivory|oatmeal)\b/.test(text)) roles.add('soft_texture')
  if (/\b(beige|taupe|sand|cream|ivory|soft neutral|oatmeal)\b/.test(text)) roles.add('beige_sludge')
  if (group === 'shoes' && /\b(slipper|soft flat|slip-on|beach|sandal)\b/.test(text)) roles.add('soft_shoe')
  if (group === 'bottom' && /\b(wide|wide-leg|soft|gauzy|flowing|palazzo)\b/.test(text)) roles.add('wide_soft_bottom')
  return [...roles]
}

export function inferWholeWardrobeOutfitRoles(pieces = []) {
  const roles = new Set()
  for (const piece of pieces) inferWholeWardrobePieceRoles(piece).forEach(role => roles.add(role))
  const softCount = pieces.filter(p => inferWholeWardrobePieceRoles(p).includes('soft_texture')).length
  const patternCount = pieces.filter(p => inferWholeWardrobePieceRoles(p).includes('graphic_element')).length
  if (softCount >= 2) roles.add('soft_texture_stack')
  if (patternCount >= 2) roles.add('extra_pattern')
  return [...roles]
}

export function occasionBiasForArchetype(archetype, occasion) {
  const key = String(occasion || '').toLowerCase()
  return Number(archetype.occasionBias?.[key] || archetype.occasionBias?.[occasion] || 0)
}

export function occasionScoreForOutfit(pieces = [], occasion = '') {
  const key = String(occasion || '').toLowerCase()
  const text = pieces.map(pieceTextBlob).join(' ')
  let score = 0
  if (key === 'evening') {
    if (/\b(black|charcoal|dark|espresso|navy|plum|patent)\b/.test(text)) score += 10
    if (/\b(pointed|patent|loafer|boot|mule|dress)\b/.test(text)) score += 8
    if (/\b(sneaker|slipper|beach|flip|soft sandal|light casual)\b/.test(text)) score -= 14
    if (/\b(gauzy|beachy|linen short|soft slip-on)\b/.test(text)) score -= 8
  }
  if (key === 'gallery / art event') {
    if (/\b(print|graphic|stripe|abstract|tapestry|architectural|structured|utility|earthy|olive|cognac)\b/.test(text)) score += 10
    const expressiveCount = (text.match(/\b(print|graphic|stripe|abstract|tapestry|floral|pattern)\b/g) || []).length
    if (expressiveCount > 1 && !/\b(black|charcoal|solid|plain|denim|structured|pointed|loafer|boot)\b/.test(text)) score -= 12
  }
  return score
}

export function inferOutfitArchetype(outfit, candidatePieces = [], occasion = 'casual') {
  const pieces = wholeWardrobeFullPieces(outfit, candidatePieces)
  const roles = inferWholeWardrobeOutfitRoles(pieces)
  const roleSet = new Set(roles)
  const hasRole = (role) => roleSet.has(role)
  let best = null
  for (const archetype of WHOLE_WARDROBE_OUTFIT_ARCHETYPES) {
    let score = occasionBiasForArchetype(archetype, occasion) + occasionScoreForOutfit(pieces, occasion)
    for (const role of archetype.preferredRoles || []) if (hasRole(role)) score += 8
    for (const role of archetype.avoidRoles || []) if (hasRole(role)) score -= 12
    if (archetype.id === 'grounded_graphic_column' && hasRole('graphic_element') && hasRole('dark_lower_column') && hasRole('grounding_piece')) score += 12
    if (archetype.id === 'dress_grounded_sharp' && hasRole('one_piece_column')) score += 18
    if (archetype.id === 'relaxed_dark_base' && hasRole('relaxed_upper') && hasRole('dark_lower_column')) score += 14
    if (archetype.id === 'soft_structure_contrast' && hasRole('soft_texture') && hasRole('structure_support')) score += 12
    if (archetype.id === 'earthy_structured_minimal' && hasRole('structure_support') && !hasRole('extra_pattern')) score += 8
    if (!best || score > best.archetypeScore) best = { ...archetype, archetypeScore: score }
  }
  const fallback = best || WHOLE_WARDROBE_OUTFIT_ARCHETYPES[0]
  return {
    archetypeId: fallback.id,
    formulaFamily: fallback.formulaFamily,
    direction: fallback.direction,
    silhouette: fallback.silhouette,
    labelSuggestion: fallback.label,
    archetypeScore: fallback.archetypeScore || 0,
    visualGoal: fallback.visualGoal,
    roles
  }
}

export function wholeWardrobeArchetypeFor(outfit = {}, candidatePieces = [], occasion = 'casual') {
  const inferred = inferOutfitArchetype(outfit, candidatePieces, occasion)
  return WHOLE_WARDROBE_OUTFIT_ARCHETYPES.find(a => a.id === inferred.archetypeId)
    ? inferred
    : { ...WHOLE_WARDROBE_OUTFIT_ARCHETYPES[0], archetypeId: WHOLE_WARDROBE_OUTFIT_ARCHETYPES[0].id, labelSuggestion: WHOLE_WARDROBE_OUTFIT_ARCHETYPES[0].label, archetypeScore: 0, roles: [] }
}

export function wholeWardrobeFormulaFamily(outfit = {}, candidatePieces = [], occasion = 'casual') {
  return outfit.formulaFamily || wholeWardrobeArchetypeFor(outfit, candidatePieces, occasion).formulaFamily || wholeWardrobeFormulaType(outfit)
}

export function pieceOccasionCompatible(piece, occasion = '') {
  const normOccasion = String(occasion || '').toLowerCase().replace(/[-_]+/g, ' ').trim()
  if (!normOccasion) return true
  const pOccasions = (piece.occasions || []).map(o => String(o).toLowerCase().replace(/[-_]+/g, ' ').trim())
  if (pOccasions.length === 0) return true
  let isCompatible = pOccasions.includes(normOccasion)
  if (!isCompatible) {
    if (normOccasion === 'evening' && pOccasions.includes('smart casual')) {
      isCompatible = true
    } else if (normOccasion === 'smart casual' && (pOccasions.includes('evening') || pOccasions.includes('city'))) {
      isCompatible = true
    } else if (normOccasion === 'gallery / art event' && (pOccasions.includes('city') || pOccasions.includes('smart casual') || pOccasions.includes('evening'))) {
      isCompatible = true
    } else if (normOccasion === 'city' && pOccasions.includes('smart casual')) {
      isCompatible = true
    } else if (normOccasion === 'casual' && (pOccasions.includes('city') || pOccasions.includes('home') || pOccasions.includes('outdoor') || pOccasions.includes('outdoor active'))) {
      isCompatible = true
    } else if (normOccasion === 'outdoor active' && (pOccasions.includes('outdoor') || pOccasions.includes('casual'))) {
      isCompatible = true
    } else if (normOccasion === 'outdoor' && (pOccasions.includes('outdoor active') || pOccasions.includes('casual'))) {
      isCompatible = true
    }
  }
  return isCompatible
}

export function piecePriorityForMission(piece, missionId, colorFamily = '', focalColor = '', moodProfile = null, weatherProfile = null, occasion = '') {
  const blob = pieceTextBlob(piece)
  const name = pieceNameBlob(piece)
  const group = wardrobeCategoryGroup(piece)
  
  let score = piece.favorite ? 10 : 0
  
  if (missionId === 'controlled_print') {
    const hasPattern = /\b(floral|print|pattern|stripe|striped|abstract|tapestry|paisley|botanical|graphic|plaid)\b/.test(name) ||
                        /\b(floral|print|pattern|stripe|striped|abstract|tapestry|paisley|botanical|graphic|plaid)\b/.test(blob)
    if (hasPattern) score += 25
    if (/\b(structured|utility|jacket|blazer|denim|trouser|leather|pointed|loafer|boot)\b/.test(blob)) score += 8
    if (/\b(slipper|soft flat|slip-on|beach|sandal)\b/.test(blob) && group === 'shoes') score -= 8
  } else if (missionId === 'monochrome_texture') {
    if (colorFamily) {
      const colors = (piece.colors || []).map(c => c.toLowerCase())
      const readsAs = String(piece.reads_as || '').toLowerCase()
      const matchingColors = colorFamily.split('/')
      const hasMatch = matchingColors.some(mc => {
        if (colors.includes(mc)) return true
        const regex = new RegExp('\\b' + mc.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'i')
        return regex.test(readsAs)
      })
      if (hasMatch) score += 20
    }
    if (/\b(crochet|knit|cashmere|corduroy|linen|silk|satin|leather|suede|tweed|velvet|gauzy|drape|textured)\b/.test(blob)) score += 15
  } else if (missionId === 'structured_soft') {
    const isSoft = /\b(soft|gauzy|drape|drapey|silk|satin|cashmere|wool knit|linen|ruffle|cowl|mock)\b/.test(blob)
    const isStructured = /\b(structured|utility|blazer|jacket|twill|denim|leather|pointed|loafer|boot|pants|trousers)\b/.test(blob)
    if (isSoft) score += 15
    if (isStructured) score += 15
  } else if (missionId === 'color_anchor') {
    const focalColors = ['coral', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'lavender', 'fuchsia', 'magenta', 'teal', 'turquoise', 'chartreuse', 'violet', 'lilac', 'rust', 'terracotta', 'mustard', 'ochre', 'plum', 'burgundy', 'emerald', 'red', 'cognac']
    const hasFocalColor = pieceHasFocalColor(piece, focalColors)
    if (hasFocalColor) {
      score += 40
    } else {
      const colors = (piece.colors || []).map(c => c.toLowerCase())
      const readsAs = String(piece.reads_as || '').toLowerCase()
      const name = String(piece.name || '').toLowerCase()
      const colorsText = [...colors, readsAs, name].join(' ')
      const isNeutral = /\b(black|charcoal|grey|gray|navy|white|cream|ivory|beige|taupe|sand|oatmeal|espresso|brown)\b/.test(colorsText)
      if (isNeutral) score += 10
    }
  } else if (missionId === 'unexpected_pairing') {
    const selectionWeight = (Number(piece.id) * 7) % 31
    score += selectionWeight
    if (group === 'shoes' && /\b(pointed|patent|loafer|boot|mule|oxford)\b/.test(blob)) score += 15
  } else if (missionId === 'soft_architecture') {
    if (/\b(denim|jean|black|darkest)\b/.test(blob)) score -= 50
    if (/\b(cowl|mock|boatneck|drape|drapey|A-line|flowing|column|maxi|midi|waist|belt|tuck)\b/.test(blob)) score += 20
  } else {
    if (/\b(black|charcoal|espresso|chocolate|deep navy|navy|olive|plum|cognac|rust|mustard)\b/.test(blob)) score += 5
    if (/\b(artistic|graphic|architectural|structured|utility|linen|corduroy|textured|denim|cashmere|knit)\b/.test(blob)) score += 4
    if (/\b(pointed|loafer|boot|mule|oxford|structured)\b/.test(blob)) score += 3
    if (/\b(soft|gauzy|drape|oversized|beige|cream|ivory|taupe)\b/.test(blob)) score -= 1
    if (moodProfile?.id === 'modern_bohemian_restraint') score += bohoSignalForPiece(piece) * 5
  }

  // Weather adjustments added to piece priority
  if (weatherProfile && weatherProfile.isHot) {
    if (pieceFabricWeight(piece) === 'heavy') score -= 12
    if (pieceFabricWeight(piece) === 'light') score += 10
    if (pieceBareness(piece) === 'high')      score += 8
    if (pieceCoverage(piece) === 'full-insulating') score -= 8
  } else if (weatherProfile && weatherProfile.isCold) {
    if (pieceFabricWeight(piece) === 'heavy') score += 10
    if (pieceFabricWeight(piece) === 'light') score -= 12
    if (pieceBareness(piece) === 'high')      score -= 8
    if (pieceCoverage(piece) === 'full-insulating') score += 8
  }

  // Occasion adjustments added to piece priority
  if (occasion) {
    if (!pieceOccasionCompatible(piece, occasion)) {
      score -= 60
    }
  }

  return score
}

export function wholeWardrobePieceBucket(allPieces = [], options = {}) {
  const bucket = { top: [], bottom: [], dress: [], outerwear: [], shoes: [], accessory: [], other: [] }
  const moodProfile = wholeWardrobeMoodProfile(options.mood)
  const weatherProfile = options.weatherProfile || weatherProfileFromContext(options)
  for (const piece of allPieces) {
    const group = wardrobeCategoryGroup(piece)
    if (bucket[group]) bucket[group].push(piece)
    else bucket.other.push(piece)
  }
  for (const key of Object.keys(bucket)) {
    bucket[key].sort((a, b) => {
      const priorityA = piecePriorityForMission(a, options.missionId, options.colorFamily, options.focalColor, moodProfile, weatherProfile, options.occasion)
      const priorityB = piecePriorityForMission(b, options.missionId, options.colorFamily, options.focalColor, moodProfile, weatherProfile, options.occasion)
      return priorityB - priorityA || String(a.name).localeCompare(String(b.name))
    })
  }
  return bucket
}

export function wholeWardrobePieceTrustDecision(piece = {}, options = {}) {
  const { occasion = 'casual', explorationMode = 'moderate', weatherProfile = {} } = options

  const reqOccasion = String(occasion || '').toLowerCase().replace(/[-_]+/g, ' ').trim()
  const exclusions = (piece.occasion_exclusions || []).map(o => String(o || '').toLowerCase().replace(/[-_]+/g, ' ').trim())
  if (exclusions.includes(reqOccasion)) {
    const role = String(piece.role_permission || 'auto')
    const intelligence = pieceGarmentIntelligence(piece)
    const profileTrust = String(intelligence.autoUseTrust || '').toLowerCase()
    return {
      allowed: false,
      supportOnly: role === 'support_only' || profileTrust === 'support_only',
      reasons: [`user-excluded for ${occasion}`]
    }
  }

  const occasionProfile = resolveOccasionProfile(occasion, options.mood || '')
  const checkOccasion = occasionProfile ? occasionProfile.id : occasion
  const decision = autoStylingTrustDecision(piece, { occasion: checkOccasion, explorationMode })
  const reasons = decision.reasons ? [...decision.reasons] : []

  if (weatherProfile.isHot) {
    const isHeavy = pieceFabricWeight(piece) === 'heavy'
    const isUpperBodyPiece = piece.category === 'outerwear' || wardrobeCategoryGroup(piece) === 'outerwear' || piece.category === 'top' || piece.category === 'dress'
    const hasInsulatingCoverage = pieceCoverage(piece) === 'full-insulating'
    const hasWarmNeckline = necklineWarmth(piece) === 'warm'
    const hasWarmSleeves = sleeveCoverage(piece) === 'long'
    const isMediumOrHeavy = pieceFabricWeight(piece) === 'medium' || pieceFabricWeight(piece) === 'heavy'

    const isInsulatingTopOrDress = isUpperBodyPiece && (
      hasInsulatingCoverage || 
      (hasWarmNeckline && isMediumOrHeavy) ||
      (hasWarmSleeves && isMediumOrHeavy)
    )
    const isInsulatingBottom = wardrobeCategoryGroup(piece) === 'bottom' && hasInsulatingCoverage && isMediumOrHeavy

    if (isHeavy || isInsulatingTopOrDress || isInsulatingBottom) {
      reasons.push('hot weather: insulating piece')
    }
  }

  if (weatherProfile.isCold) {
    if (bottomKind(piece) === 'shorts') {
      reasons.push('cold weather: shorts')
    }
  }

  if (occasionProfile && occasionProfile.rules) {
    // Prohibited materials
    const prohibitedMaterials = occasionProfile.rules.prohibited_materials ? [...occasionProfile.rules.prohibited_materials] : []
    if (weatherProfile.isHot && occasionProfile.rules.prohibited_materials_warm) {
      prohibitedMaterials.push(...occasionProfile.rules.prohibited_materials_warm)
    }
    for (const mat of prohibitedMaterials) {
      if (pieceMatchesMaterial(piece, mat)) {
        reasons.push(`occasion profile: prohibited material (${mat})`)
        break
      }
    }

    // Prohibited footwear (if category is shoes)
    if (piece.category === 'shoes' || wardrobeCategoryGroup(piece) === 'shoes') {
      const prohibitedFootwear = occasionProfile.rules.prohibited_footwear ? [...occasionProfile.rules.prohibited_footwear] : []
      if (weatherProfile.isHot && occasionProfile.rules.prohibited_footwear_summer) {
        prohibitedFootwear.push(...occasionProfile.rules.prohibited_footwear_summer)
      }
      for (const fw of prohibitedFootwear) {
        if (pieceMatchesFootwear(piece, fw)) {
          reasons.push(`occasion profile: prohibited footwear (${fw})`)
          break
        }
      }
    }

    // Prohibited pieces
    const prohibitedPieces = occasionProfile.rules.prohibited_pieces ? [...occasionProfile.rules.prohibited_pieces] : []
    for (const item of prohibitedPieces) {
      if (pieceMatchesPieceName(piece, item)) {
        reasons.push(`occasion profile: prohibited piece (${item})`)
        break
      }
    }
  }

  return {
    ...decision,
    allowed: reasons.length === 0,
    reasons
  }
}

export function filterWholeWardrobePiecesForGeneration(allPieces = [], options = {}) {
  const { weatherProfile = {} } = options
  const allowedPieces = []
  const suppressedPieces = []

  for (const piece of allPieces) {
    const decision = wholeWardrobePieceTrustDecision(piece, options)
    if (decision.allowed) {
      allowedPieces.push(piece)
    } else {
      suppressedPieces.push({
        id: piece.id,
        name: piece.name,
        category: wardrobeCategoryGroup(piece),
        reasons: decision.reasons
      })
    }
  }

  if (weatherProfile.isHot) {
    const outerwearPieces = allowedPieces.filter(p => p.category === 'outerwear' || wardrobeCategoryGroup(p) === 'outerwear')
    if (outerwearPieces.length > 3) {
      const weightScore = { 'light': 1, 'medium': 2, 'heavy': 3 }
      const getWeightVal = (p) => weightScore[pieceFabricWeight(p)] || 2

      outerwearPieces.sort((a, b) => {
        const diff = getWeightVal(a) - getWeightVal(b)
        if (diff !== 0) return diff
        return a.id - b.id // deterministic tie-breaker
      })

      const toSuppress = outerwearPieces.slice(3)
      const toSuppressIds = new Set(toSuppress.map(p => p.id))

      let i = allowedPieces.length
      while (i--) {
        const p = allowedPieces[i]
        if (toSuppressIds.has(p.id)) {
          allowedPieces.splice(i, 1)
          suppressedPieces.push({
            id: p.id,
            name: p.name,
            category: wardrobeCategoryGroup(p),
            reasons: ['hot weather: outerwear cap']
          })
        }
      }
    }
  }

  return { allowedPieces, suppressedPieces }
}

export function buildVisualComposerRoster(allowedPieces = [], {
  occasion = 'casual',
  weatherProfile = {},          // from weatherProfileFromContext({ mood, season })
  sessionInfluence = null,      // existing recency map, optional
  maxImages = 90,                // hard ceiling, below Claude's 100-image limit
  selectedPieceId = null,
  includeAccessories = false,
  mood = ''
} = {}) {
  const roster = []
  const excluded = []
  const debug = {
    excludedCounts: {},
    categoryCounts: {}
  }

  const exclude = (piece, reason) => {
    excluded.push({
      pieceId: piece.id,
      name: piece.name,
      reason
    })
    debug.excludedCounts[reason] = (debug.excludedCounts[reason] || 0) + 1
  }

  const isSelected = (p) => {
    if (selectedPieceId && Number(p.id) === Number(selectedPieceId)) return true
    if (p.selected || p.isAnchor) return true
    return false
  }

  // Pre-load confirmed outfits and stylist feedback maps to optimize Step 4 queries
  const confirmedCounts = new Map()
  try {
    const rows = db.prepare(`
      SELECT op.piece_id, COUNT(*) as cnt, SUM(CASE WHEN o.favorite = 1 THEN 1 ELSE 0 END) as fav_cnt
      FROM outfit_pieces op
      JOIN outfits o ON op.outfit_id = o.id
      GROUP BY op.piece_id
    `).all()
    for (const r of rows) {
      confirmedCounts.set(Number(r.piece_id), { count: r.cnt, favoriteCount: r.fav_cnt })
    }
  } catch (err) {
    console.warn('Failed to query confirmed outfits count:', err.message)
  }

  const feedbackScores = new Map()
  try {
    const feedbackRows = db.prepare(`
      SELECT id, feedback_type, context_type, context_id, payload, is_gold
      FROM stylist_feedback
      WHERE COALESCE(archived,0) = 0
    `).all()
    for (const row of feedbackRows) {
      const weight = feedbackWeight(row.feedback_type)
      if (!weight) continue
      const signedWeight = weight + (row.is_gold ? Math.sign(weight) * 18 : 0)
      
      if (row.context_type === 'piece' && row.context_id) {
        const pId = Number(row.context_id)
        feedbackScores.set(pId, (feedbackScores.get(pId) || 0) + signedWeight)
      }
      
      const ids = collectPieceIdsFromFeedbackPayload(row.payload)
      for (const id of ids) {
        const pId = Number(id)
        feedbackScores.set(pId, (feedbackScores.get(pId) || 0) + signedWeight)
      }
    }
  } catch (err) {
    console.warn('Failed to query stylist feedback memory:', err.message)
  }

  // Step 1 — No photo
  const afterStep1 = []
  for (const p of allowedPieces) {
    if (isSelected(p)) {
      afterStep1.push(p)
    } else if (!p.photo && !p.worn_photo) {
      exclude(p, 'no photo')
    } else {
      afterStep1.push(p)
    }
  }

  // Step 2 — Category gate
  const afterStep2 = []
  for (const p of afterStep1) {
    if (isSelected(p)) {
      afterStep2.push(p)
    } else if (!includeAccessories && isAccessory(p)) {
      exclude(p, 'accessories excluded from visual composer')
    } else {
      afterStep2.push(p)
    }
  }

  // Step 3 — Weather validity gate
  const afterStep3 = []
  const isHot = weatherProfile && weatherProfile.isHot
  const isCold = weatherProfile && weatherProfile.isCold

  if (isHot) {
    const outerwearCandidates = []
    for (const p of afterStep2) {
      if (isSelected(p)) {
        afterStep3.push(p)
      } else if (((isOuterwear(p) || isTop(p)) && fabricWeight(p) === 'heavy') || (wardrobeCategoryGroup(p) === 'bottom' && pieceCoverage(p) === 'full-insulating' && (fabricWeight(p) === 'medium' || fabricWeight(p) === 'heavy'))) {
        exclude(p, 'hot weather: insulating piece')
      } else if (isOuterwear(p)) {
        outerwearCandidates.push(p)
      } else {
        afterStep3.push(p)
      }
    }

    // Cap outerwear to the 3 lightest pieces
    if (outerwearCandidates.length > 3) {
      const weightValues = { 'light': 1, 'medium': 2, 'heavy': 3 }
      outerwearCandidates.sort((a, b) => {
        const wa = weightValues[fabricWeight(a)] || 2
        const wb = weightValues[fabricWeight(b)] || 2
        if (wa !== wb) return wa - wb
        return Number(a.id) - Number(b.id) // stable tie-breaker by piece ID
      })

      for (let i = 0; i < outerwearCandidates.length; i++) {
        const p = outerwearCandidates[i]
        if (i < 3) {
          afterStep3.push(p)
        } else {
          exclude(p, 'hot weather: outerwear cap')
        }
      }
    } else {
      afterStep3.push(...outerwearCandidates)
    }
  } else if (isCold) {
    for (const p of afterStep2) {
      if (isSelected(p)) {
        afterStep3.push(p)
      } else if (bottomKind(p) === 'shorts') {
        exclude(p, 'cold weather: shorts')
      } else {
        afterStep3.push(p)
      }
    }
  } else {
    // No weather profile, Step 3 is a no-op
    afterStep3.push(...afterStep2)
  }

  // Step 4 — Image budget cap
  let afterStep4 = []
  if (afterStep3.length > maxImages) {
    const defaultCeilings = {
      top: 30,
      bottom: 25,
      shoes: 15,
      dress: 10,
      outerwear: 8,
      other: 5
    }
    const sumCeilings = Object.values(defaultCeilings).reduce((a, b) => a + b, 0)
    const ceilings = { ...defaultCeilings }
    if (sumCeilings > maxImages) {
      const factor = maxImages / sumCeilings
      for (const cat of Object.keys(ceilings)) {
        ceilings[cat] = Math.floor(defaultCeilings[cat] * factor)
      }
    }

    // Group surviving pieces by category
    const byCategory = {
      top: [],
      bottom: [],
      shoes: [],
      dress: [],
      outerwear: [],
      other: []
    }

    for (const p of afterStep3) {
      const group = wardrobeCategoryGroup(p)
      if (byCategory[group]) {
        byCategory[group].push(p)
      } else {
        byCategory.other.push(p)
      }
    }

    // Sort and limit per category
    for (const cat of Object.keys(byCategory)) {
      const pieces = byCategory[cat]
      const limit = ceilings[cat]

      // Sort by relevance score descending, stably by recency and piece ID ascending
      pieces.sort((a, b) => comparePieces(a, b))

      let categoryKeptCount = 0
      for (const p of pieces) {
        if (isSelected(p)) {
          afterStep4.push(p)
          categoryKeptCount++
        } else if (categoryKeptCount < limit) {
          afterStep4.push(p)
          categoryKeptCount++
        } else {
          exclude(p, 'roster cap: category limit')
        }
      }
    }
  } else {
    afterStep4.push(...afterStep3)
  }

  function pushAdjustmentReason(pieceId, reason) {
    if (!debug.relevanceAdjustments) {
      debug.relevanceAdjustments = {}
    }
    if (!debug.relevanceAdjustments[pieceId]) {
      debug.relevanceAdjustments[pieceId] = []
    }
    debug.relevanceAdjustments[pieceId].push(reason)
  }

  function getRelevanceScore(p) {
    const occasionScore = pieceOccasionScore(p, occasion)
    const conf = confirmedCounts.get(Number(p.id)) || { count: 0, favoriteCount: 0 }
    let historyBonus = conf.count * 8 + conf.favoriteCount * 12
    if (historyBonus > 24) {
      historyBonus = 24
      pushAdjustmentReason(p.id, 'history bonus capped')
    }
    const fbScore = feedbackScores.get(Number(p.id)) || 0
    const feedbackBonus = fbScore > 0 ? fbScore : 0
    const recencyPenalty = sessionInfluence && sessionInfluence.pieceRecency
      ? (sessionInfluence.pieceRecency.get(Number(p.id)) || 0)
      : 0
      
    let weatherBonus = 0
    if (weatherProfile && weatherProfile.isHot) {
      const isLight = fabricWeight(p) === 'light'
      const isHeavy = fabricWeight(p) === 'heavy'
      const isShorts = bottomKind(p) === 'shorts'

      if (isLight) {
        weatherBonus += 10
        pushAdjustmentReason(p.id, 'hot weather: lightweight fabric (+10)')
      }
      if (isShorts) {
        weatherBonus += 8
        pushAdjustmentReason(p.id, 'hot weather: shorts (+8)')
      }
      if (isHeavy) {
        weatherBonus -= 10
        pushAdjustmentReason(p.id, 'hot weather: heavy fabric (-10)')
      }
    } else if (weatherProfile && weatherProfile.isCold) {
      const isLight = fabricWeight(p) === 'light'
      const isHeavy = fabricWeight(p) === 'heavy'

      if (isLight) {
        const catGroup = wardrobeCategoryGroup(p)
        if (catGroup === 'bottom' || catGroup === 'dress') {
          weatherBonus -= 10
          pushAdjustmentReason(p.id, 'cold weather: lightweight fabric (-10)')
        }
      }
      if (isHeavy) {
        weatherBonus += 10
        pushAdjustmentReason(p.id, 'cold weather: heavy fabric (+10)')
      }
    }

    let occasionProfileBonus = 0
    const occasionProfile = resolveOccasionProfile(occasion, mood)
    if (occasionProfile && occasionProfile.rules) {
      const preferredMaterials = occasionProfile.rules.preferred_materials ? [...occasionProfile.rules.preferred_materials] : []
      const preferredFootwear = occasionProfile.rules.preferred_footwear ? [...occasionProfile.rules.preferred_footwear] : []
      const discouragedMaterials = occasionProfile.rules.discouraged_materials ? [...occasionProfile.rules.discouraged_materials] : []
      if (weatherProfile && weatherProfile.isHot && occasionProfile.rules.discouraged_materials_warm) {
        discouragedMaterials.push(...occasionProfile.rules.discouraged_materials_warm)
      }
      const discouragedFootwear = occasionProfile.rules.discouraged_footwear ? [...occasionProfile.rules.discouraged_footwear] : []
      if (weatherProfile && weatherProfile.isHot && occasionProfile.rules.discouraged_footwear_summer) {
        discouragedFootwear.push(...occasionProfile.rules.discouraged_footwear_summer)
      }
      if (weatherProfile && weatherProfile.isHot && occasionProfile.rules.discouraged_footwear_warm) {
        discouragedFootwear.push(...occasionProfile.rules.discouraged_footwear_warm)
      }
      const discouragedPieces = occasionProfile.rules.discouraged_pieces ? [...occasionProfile.rules.discouraged_pieces] : []

      // Preferred materials boost
      for (const mat of preferredMaterials) {
        if (pieceMatchesMaterial(p, mat)) {
          occasionProfileBonus += 8
          pushAdjustmentReason(p.id, `occasion profile: preferred material (${mat}) (+8)`)
          break
        }
      }

      // Preferred footwear boost
      if (p.category === 'shoes' || wardrobeCategoryGroup(p) === 'shoes') {
        for (const fw of preferredFootwear) {
          if (pieceMatchesFootwear(p, fw)) {
            occasionProfileBonus += 10
            pushAdjustmentReason(p.id, `occasion profile: preferred footwear (${fw}) (+10)`)
            break
          }
        }
      }

      // Discouraged materials penalty
      for (const mat of discouragedMaterials) {
        if (pieceMatchesMaterial(p, mat)) {
          occasionProfileBonus -= 8
          pushAdjustmentReason(p.id, `occasion profile: discouraged material (${mat}) (-8)`)
          break
        }
      }

      // Discouraged footwear penalty
      if (p.category === 'shoes' || wardrobeCategoryGroup(p) === 'shoes') {
        for (const fw of discouragedFootwear) {
          if (pieceMatchesFootwear(p, fw)) {
            occasionProfileBonus -= 10
            pushAdjustmentReason(p.id, `occasion profile: discouraged footwear (${fw}) (-10)`)
            break
          }
        }
      }

      // Discouraged pieces penalty
      for (const item of discouragedPieces) {
        if (pieceMatchesPieceName(p, item)) {
          occasionProfileBonus -= 10
          pushAdjustmentReason(p.id, `occasion profile: discouraged piece (${item}) (-10)`)
          break
        }
      }
    }
    
    return occasionScore + historyBonus + feedbackBonus - recencyPenalty + weatherBonus + occasionProfileBonus
  }

  function comparePieces(a, b) {
    const ra = getRelevanceScore(a)
    const rb = getRelevanceScore(b)
    if (ra !== rb) return rb - ra

    // Tie-breaker 1: less-recently-shown first
    const recencyA = sessionInfluence && sessionInfluence.pieceRecency
      ? (sessionInfluence.pieceRecency.get(Number(a.id)) || 0)
      : 0
    const recencyB = sessionInfluence && sessionInfluence.pieceRecency
      ? (sessionInfluence.pieceRecency.get(Number(b.id)) || 0)
      : 0
    if (recencyA !== recencyB) return recencyA - recencyB

    // Tie-breaker 2: piece ID ascending (final fallback)
    return Number(a.id) - Number(b.id)
  }

  // Step 5 — Final guard
  if (afterStep4.length > maxImages) {
    // Sort globally by relevance descending, stably by recency and piece ID ascending
    afterStep4.sort((a, b) => comparePieces(a, b))

    console.warn(`[buildVisualComposerRoster] Roster count (${afterStep4.length}) exceeds maxImages (${maxImages}) even after category limits. Trimming globally.`)

    let finalKeptCount = 0
    for (const p of afterStep4) {
      if (isSelected(p)) {
        roster.push(p)
        finalKeptCount++
      } else if (finalKeptCount < maxImages) {
        roster.push(p)
        finalKeptCount++
      } else {
        exclude(p, 'roster cap: global limit')
      }
    }
  } else {
    roster.push(...afterStep4)
  }

  // Populate debug category counts
  for (const p of roster) {
    const group = wardrobeCategoryGroup(p)
    debug.categoryCounts[group] = (debug.categoryCounts[group] || 0) + 1
  }

  return { roster, excluded, debug }
}

export function wholeWardrobeMoodProfile(mood = '') {
  const text = String(mood || '').toLowerCase()
  if (/\b(boho|bohemian)\b/.test(text)) {
    return {
      id: 'modern_bohemian_restraint',
      label: 'modern bohemian restraint',
      guidance: [
        'Translate "boho" as modern bohemian restraint for Yuna: earthy/artisan texture, relaxed movement, woven/crochet/linen/botanical/paisley/denim/cognac/olive/rust notes, with city-appropriate grounding.',
        'Bohemian is not a negative lane. Do not collapse it into festival costume, excessive layers, delicate romantic softness, or generic hippie styling.',
        'Do not answer boho with plain all-black tailored minimalism unless another garment carries clear bohemian texture, print, movement, or warm artisan detail.',
        'Each returned boho outfit still needs a readable visual thesis: the bohemian element should be the hero or a clear support texture, and the other garments should stabilize it.'
      ].join(' ')
    }
  }
  return null
}

export function bohoTraitForPiece(piece = {}) {
  const text = pieceTextBlob(piece)
  if (/\b(crochet|woven|raffia|rattan|cork|espadrille|basket|braided)\b/.test(text)) return 'woven texture'
  if (/\b(embroidered|embroidery|artisan|handmade)\b/.test(text)) return 'artisan detail'
  if (/\b(paisley|botanical|floral|abstract print|print)\b/.test(text)) return 'expressive print'
  if (/\b(linen|gauzy|slub|cotton voile)\b/.test(text)) return 'dry natural texture'
  if (/\b(tiered|maxi|midi|flowing|drape|soft movement)\b/.test(text)) return 'relaxed movement'
  if (/\b(cognac|rust|terracotta|ochre|mustard|olive|brown|tan|amber)\b/.test(text)) return 'earthy color'
  if (/\b(denim|jean)\b/.test(text)) return 'casual denim support'
  return ''
}

const bohoSignalCache = new WeakMap()

export function bohoSignalForPiece(piece = {}) {
  if (piece && typeof piece === 'object' && bohoSignalCache.has(piece)) return bohoSignalCache.get(piece)
  const text = pieceTextBlob(piece)
  let score = 0
  if (/\b(crochet|woven|raffia|rattan|cork|espadrille|basket|braided|embroidered|embroidery|artisan|handmade|paisley|botanical)\b/.test(text)) score += 3
  if (/\b(floral|abstract print|print|linen|gauzy|slub|cotton voile)\b/.test(text)) score += 2
  if (/\b(tiered|maxi skirt|maxi dress|midi skirt|midi dress|flowing|drape|soft movement)\b/.test(text)) score += 1.5
  if (/\b(cognac|rust|terracotta|ochre|mustard|olive|brown|tan|amber|earthy)\b/.test(text)) score += 1
  if (/\b(sandal|clog|mule|boot|leather)\b/.test(text) && wardrobeCategoryGroup(piece) === 'shoes') score += 1
  if (/\b(denim|jean)\b/.test(text)) score += 0.5
  if (piece && typeof piece === 'object') bohoSignalCache.set(piece, score)
  return score
}

export function wholeWardrobeBohoSignalScore(pieces = []) {
  return pieces.reduce((sum, piece) => sum + bohoSignalForPiece(piece), 0)
}

export function wholeWardrobeMissesMood(outfitOrPieces, mood = '') {
  const moodProfile = wholeWardrobeMoodProfile(mood)
  if (moodProfile?.id !== 'modern_bohemian_restraint') return false
  const pieces = Array.isArray(outfitOrPieces)
    ? outfitOrPieces
    : (Array.isArray(outfitOrPieces?.pieces) ? outfitOrPieces.pieces : [])
  return wholeWardrobeBohoSignalScore(pieces) < 2
}

export function strongestBohoPiece(pieces = []) {
  return [...pieces]
    .map(piece => ({ piece, score: bohoSignalForPiece(piece) }))
    .sort((a, b) => b.score - a.score)[0]?.piece || pieces[0] || null
}


export function wholeWardrobeFormulaType(outfit = {}) {
  if (wholeWardrobeHasDress(outfit)) return 'dress_grounding_shoe'
  const text = (Array.isArray(outfit.pieces) ? outfit.pieces : []).map(pieceNameBlob).join(' ')
  if (/\b(compact_top_dark_column)\b/.test(text)) return 'compact_top_dark_column'
  if (/\b(soft_piece_structured_anchor)\b/.test(text)) return 'soft_piece_structured_anchor'
  if (/\b(earthy_structured_separates)\b/.test(text)) return 'earthy_structured_separates'
  if (/\b(relaxed_top_dark_base)\b/.test(text)) return 'relaxed_top_dark_base'
  return 'standard_separates'
}

export function wholeWardrobeDirectionFromPieces(outfit = {}) {
  return wholeWardrobeArchetypeFor(outfit).direction || 'standard daily style'
}

export function wholeWardrobeSilhouetteFromPieces(outfit = {}) {
  return wholeWardrobeArchetypeFor(outfit).silhouette || 'relaxed proportions'
}

export function wholeWardrobeGroundingStrategy(outfit = {}) {
  const shoe = wholeWardrobePieceByGroup(outfit, 'shoes')
  if (!shoe) return 'no shoe grounding'
  const text = pieceTextBlob(shoe)
  if (/\b(black|dark|charcoal|navy|brown|tan)\b/.test(text) && /\b(pointed|boot|loafer|mule|oxford|structured)\b/.test(text)) return 'sharp dark grounding'
  if (/\b(sneaker|slip-on|flat|sandal|flip)\b/.test(text)) return 'soft casual grounding'
  return 'standard shoe anchor'
}

export function wholeWardrobeShoeShape(outfit = {}) {
  const shoe = wholeWardrobePieceByGroup(outfit, 'shoes')
  if (!shoe) return 'none'
  const text = pieceTextBlob(shoe)
  if (/\b(pointed)\b/.test(text)) return 'pointed'
  if (/\b(almond|oval)\b/.test(text)) return 'almond/oval'
  if (/\b(square)\b/.test(text)) return 'square'
  if (/\b(round|loafer|boot|sneaker)\b/.test(text)) return 'rounded/square'
  return 'rounded'
}

export function wholeWardrobeVisualRhythm(outfit = {}) {
  const counts = { expressive: 0, solid: 0 }
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  pieces.forEach(p => {
    const expressive = /\b(floral|print|pattern|stripe|abstract|graphic)\b/.test(pieceNameBlob(p))
    if (expressive) counts.expressive += 1
    else counts.solid += 1
  })
  if (counts.expressive >= 2) return 'pattern collision / complex rhythm'
  if (counts.expressive === 1) return 'hero print + quiet support'
  return 'clean solid rhythm'
}

export function wholeWardrobeHeroPieceId(outfit = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const sorted = [...pieces].sort((a, b) => {
    const isHero = (p) => /\b(floral|print|pattern|appliqué|applique|crochet|textured|color_accent|hero_piece)\b/.test(pieceTextBlob(p))
    return Number(isHero(b)) - Number(isHero(a))
  })
  return sorted[0]?.id || null
}

export function wholeWardrobeFullPieces(outfit = {}, candidatePieces = []) {
  const ids = Array.isArray(outfit.pieceIds) ? outfit.pieceIds.map(Number) : []
  if (ids.length && Array.isArray(candidatePieces) && candidatePieces.length > 0) {
    const matched = ids.map(id => candidatePieces.find(cp => Number(cp.id) === id)).filter(Boolean)
    if (matched.length > 0) return matched
  }
  return Array.isArray(outfit.pieces) ? outfit.pieces : []
}

export function wholeWardrobePieceByGroup(outfit = {}, group) {
  return (Array.isArray(outfit.pieces) ? outfit.pieces : []).find(p => wardrobeCategoryGroup(p) === group) || null
}

export function wholeWardrobeTopBottomKey(outfit = {}) {
  const top = wholeWardrobePieceByGroup(outfit, 'top')
  const bottom = wholeWardrobePieceByGroup(outfit, 'bottom')
  if (!top || !bottom) return null
  return `${Number(top.id)}:${Number(bottom.id)}`
}

export function wholeWardrobeHasDress(outfit = {}) {
  return (Array.isArray(outfit.pieces) ? outfit.pieces : []).some(p => wardrobeCategoryGroup(p) === 'dress')
}

export function wholeWardrobeHasPrintOrStripe(outfit = {}) {
  const text = (Array.isArray(outfit.pieces) ? outfit.pieces : []).map(pieceNameBlob).join(' ')
  return /\b(floral|print|graphic|stripe|striped|pattern|abstract|tapestry)\b/.test(text)
}

export function wholeWardrobeHasGraphicTop(outfit = {}) {
  const top = wholeWardrobePieceByGroup(outfit, 'top')
  return top ? /\b(floral|print|graphic|stripe|striped|pattern|abstract|tapestry)\b/.test(pieceNameBlob(top)) : false
}

export function wholeWardrobeHasNonGraphicTop(outfit = {}) {
  const top = wholeWardrobePieceByGroup(outfit, 'top')
  return Boolean(top && !wholeWardrobeHasGraphicTop(outfit))
}

export function wholeWardrobeIsExploratory(outfit = {}) {
  const text = (Array.isArray(outfit.pieces) ? outfit.pieces : []).map(pieceNameBlob).join(' ')
  if (wholeWardrobeHasDress(outfit)) return true
  if (/\b(soft|gauzy|linen|cashmere|knit|drape|cream|ivory|oatmeal)\b/.test(text) && /\b(pointed|loafer|boot|mule|oxford|black|cognac)\b/.test(text)) return true
  return false
}

export function wholeWardrobeLabelFromPieces(outfit = {}) {
  const arch = wholeWardrobeArchetypeFor(outfit)
  if (arch?.labelSuggestion) return arch.labelSuggestion
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const names = pieces.map(p => p.name || 'garment')
  if (names.length >= 2) return `${names[0]} & ${names[1]} formula`
  return 'curated wardrobe formula'
}

export function wholeWardrobeReasonFromPieces(outfit = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const text = pieces.map(pieceTextBlob).join(' ')
  const colorPop = /\b(red|orange|mustard|plum|amber)\b/.test(text) && /\b(black|charcoal|navy|grey|beige|cream)\b/.test(text)
  const visualWeight = pieces.map(visualWeightProfile)
  const softAnchor = visualWeight.some(v => v.softness >= 2) && visualWeight.some(v => v.structure >= 2)
  if (colorPop) return 'controlled color pop provides artistic tension to the neutral column'
  if (softAnchor) return 'structured support piece stabilizes the soft natural drape'
  return 'simple balanced separates that follow a stable vertical column'
}

export function wholeWardrobeWatchFromPieces(outfit = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  
  // Double soft volume risk: check if we have a top/dress that is soft/relaxed, AND a bottom that is wide/loose.
  const topOrDress = pieces.find(p => p && (p.category === 'top' || p.category === 'dress'))
  const bottom = pieces.find(p => p && p.category === 'bottom')
  if (topOrDress && bottom) {
    const topText = pieceTextBlob(topOrDress)
    const bottomText = pieceTextBlob(bottom)
    if (/\b(gauzy|soft|relaxed|linen|cotton voile)\b/.test(topText) && /\b(wide|wide-leg|loose)\b/.test(bottomText)) {
      return 'double soft volume risk'
    }
  }
  
  // Visual competition from multiple patterns: count how many DIFFERENT pieces have a pattern or print keyword.
  const patternPiecesCount = pieces.filter(p => {
    if (!p) return false
    const pText = pieceTextBlob(p)
    return /\b(floral|stripe|print|pattern)\b/.test(pText)
  }).length
  if (patternPiecesCount >= 2) {
    return 'visual competition from multiple patterns'
  }
  
  return 'none'
}

export function wholeWardrobeGarmentModifier(pieces = []) {
  const notes = []
  for (const piece of pieces) {
    if (piece.tuck_behavior === 'tucks_with_structure') notes.push(`${piece.name} requires structured tuck`)
    if (piece.waistband_type === 'tight_no_room') notes.push(`tight waist on ${piece.name} limits comfortable tucking`)
  }
  return notes.join(', ') || 'standard wear'
}

export function wholeWardrobeSelectionScore(outfit, selected, options = {}) {
  const pieces = outfit.pieces || []
  const text = pieces.map(pieceTextBlob).join(' ')
  const label = String(outfit.label || '').toLowerCase()
  const mood = String(options.mood || '').toLowerCase()
  const occasion = String(options.occasion || '').toLowerCase()
  const formula = wholeWardrobeFormulaFamily(outfit, pieces, occasion)
  const scoreReasons = []

  let score = 0
  const add = (val, reason) => {
    score += val
    scoreReasons.push(`${reason} (${val})`)
  }

  // Basic outfit validity
  if (wholeWardrobeHasDress(outfit)) {
    add(20, 'dress-grounding-shoe formula')
  } else {
    const top = wholeWardrobePieceByGroup(outfit, 'top')
    const bottom = wholeWardrobePieceByGroup(outfit, 'bottom')
    if (top && bottom) add(12, 'contains top + bottom separates')
  }

  // Occasion alignment
  if (occasion) {
    const occasionScore = occasionScoreForOutfit(pieces, occasion)
    if (occasionScore) add(occasionScore, `occasion: ${occasion} score`)
  }

  // Favorite piece bonuses
  const favoriteCount = pieces.filter(p => p.favorite).length
  if (favoriteCount) add(favoriteCount * 4, 'contains favorite pieces')

  // Core rule checks
  const ruleInfluence = wholeWardrobeFeedbackInfluenceForCandidate(pieces, options)
  if (ruleInfluence) {
    add(ruleInfluence.score, 'feedback memory influence')
  }

  return { score, reasons: scoreReasons }
}

export function wholeWardrobeOutfitsFromCandidates(candidates = [], candidatePieces = [], options = {}) {
  return candidates.map(candidate => repairWholeWardrobeOutfit(normalizeWholeWardrobeOutfitObject({
    label: wholeWardrobeLabelFromPieces({ pieces: candidate.pieces }),
    strength: 'usable',
    dominantDirection: wholeWardrobeDirectionFromPieces({ pieces: candidate.pieces }),
    silhouette: wholeWardrobeSilhouetteFromPieces({ pieces: candidate.pieces }),
    bestFor: options.occasion || 'casual',
    pieceIds: candidate.pieceIds,
    pieces: candidate.pieces,
    reason: wholeWardrobeReasonFromPieces({ pieces: candidate.pieces }),
    watchFor: wholeWardrobeWatchFromPieces({ pieces: candidate.pieces }),
    localScore: candidate.localScore,
    missionId: candidate.missionId,
  }, candidatePieces), candidatePieces, options.occasion, options.mood, options))
}

export function scoreWholeWardrobeCandidate(pieces = [], options = {}) {
  const text = pieces.map(pieceTextBlob).join(' ')
  const names = pieces.map(p => p.name).join(' + ')
  const groups = pieces.map(wardrobeCategoryGroup)
  let score = 0
  const reasons = []
  const add = (n, reason) => { score += n; if (reason) reasons.push(reason) }

  // Weather appropriateness
  const weather = options.weatherProfile || weatherProfileFromContext(options)
  if (weather.isHot) {
    for (const piece of pieces) {
      if (pieceFabricWeight(piece) === 'heavy') add(-12, 'hot weather: heavy fabric')
      if (pieceFabricWeight(piece) === 'light') add(10, 'hot weather: lightweight fabric')
      if (pieceBareness(piece) === 'high')      add(8, 'hot weather: skin-friendly cut')
      if (pieceCoverage(piece) === 'full-insulating') add(-8, 'hot weather: insulating coverage')
    }
    if (pieces.some(p => wardrobeCategoryGroup(p) === 'outerwear')) {
      add(-30, 'hot weather: penalize outerwear/layering')
    }
  } else if (weather.isCold) {
    for (const piece of pieces) {
      if (pieceFabricWeight(piece) === 'heavy') add(10, 'cold weather: heavy fabric')
      if (pieceFabricWeight(piece) === 'light') {
        const catGroup = wardrobeCategoryGroup(piece)
        if (catGroup === 'bottom' || catGroup === 'dress') {
          add(-12, 'cold weather: lightweight fabric')
        }
      }
      if (pieceBareness(piece) === 'high')      add(-8, 'cold weather: skin-friendly cut')
      if (pieceCoverage(piece) === 'full-insulating') add(8, 'cold weather: insulating coverage')
    }
    const hasWarmLayer = pieces.some(piece => {
      const catGroup = wardrobeCategoryGroup(piece)
      if (catGroup === 'top' || catGroup === 'outerwear' || catGroup === 'dress') {
        const weight = pieceFabricWeight(piece)
        return weight === 'medium' || weight === 'heavy'
      }
      return false
    })
    if (!hasWarmLayer) {
      add(-14, 'cold weather: no warm layer in ensemble')
    }
  }

  if (groups.includes('top') && groups.includes('bottom')) add(14, 'complete separates')
  if (groups.includes('dress')) add(12, 'complete dress base')
  if (groups.includes('shoes')) add(10, 'grounded with shoes')
  if (pieces.some(p => p.favorite)) add(5, 'favorite piece')
  if (/\b(black|charcoal|espresso|chocolate|deep navy|navy|olive|plum|cognac|rust|mustard)\b/.test(text)) add(7, 'deep/warm palette')
  if (/\b(artistic|graphic|architectural|structured|utility|textured|corduroy|linen|denim)\b/.test(text)) add(8, 'artistic texture/structure')
  if (/\b(pointed|loafer|boot|mule|oxford|cognac|black)\b/.test(text) && groups.includes('shoes')) add(6, 'strong shoe grounding')
  if (/\b(contrast|column|dark|structured|utility|graphic)\b/.test(text)) add(5, 'clear visual thesis')
  if (/\b(focal|hero|anchor|support|grounded|sharp|tension|thesis|waist clarity|shape continuity|visual intelligence)\b/.test(text)) add(5, 'outfit-level visual thesis')

  const wideCount = (text.match(/\b(wide|wide-leg|oversized|loose|flowing|voluminous|relaxed)\b/g) || []).length
  const softCount = (text.match(/\b(soft|gauzy|drape|drapey|chiffon|loose knit|oversized|cream|ivory|beige|taupe|sand)\b/g) || []).length
  const lightNeutralCount = (text.match(/\b(cream|ivory|beige|taupe|sand|oatmeal|white)\b/g) || []).length
  const minorVariationCount = (text.match(/\b(similar|same|matching|coordinated|echoes|pairs well|goes with)\b/g) || []).length
  if (wideCount >= 2) add(-20, 'wide + wide risk')
  if (softCount >= 3) add(-24, 'soft stack risk')
  if (minorVariationCount >= 3 && !/\b(tension|contrast|column|grounded|sharp|anchor|structure|thesis)\b/.test(text)) add(-10, 'minor-variation without thesis risk')
  if (lightNeutralCount >= 3 && !/\b(black|charcoal|espresso|plum|cognac|boot|loafer|pointed|graphic|structured)\b/.test(text)) add(-24, 'generic light-neutral softness')
  if (/\b(librarian|catalog|mature|ladylike|polished neutral|luxe neutral)\b/.test(text)) add(-28, 'catalog/librarian drift risk')
  if (groups.includes('shoes') && !/\b(pointed|loafer|boot|mule|oxford|black|cognac|structured|grounded)\b/.test(text)) add(-8, 'weak shoe grounding')
  for (const piece of pieces) {
    const decision = wholeWardrobePieceTrustDecision(piece, options)
    if (decision.supportOnly && ['top', 'bottom', 'dress'].includes(wardrobeCategoryGroup(piece))) add(-18, `${piece.name} support-only`)
  }
  const intelligenceSet = pieces.map(pieceGarmentIntelligence)
  const profileRoleText = intelligenceSet.map(i => i.bestOutfitRole).filter(Boolean).join(' ')
  const profileRulesText = intelligenceSet.flatMap(i => [...i.pairingRequirements, ...i.failureRisks, ...i.formulaCompatibility, ...i.doNotPairRules]).join(' ').toLowerCase()
  if (/\b(hero|movement|texture|color_accent|sharpener)\b/.test(profileRoleText) && /\b(grounding|column|support)\b/.test(profileRoleText)) add(7, 'profile roles create outfit structure')
  if (/\b(waist clarity|shape continuity|structured support|grounded shoe|quiet anchor)\b/.test(profileRulesText)) add(4, 'profile pairing requirements satisfied in candidate')
  if (/\b(too small|too tight|rides up|bunch|pull|fit review|do not auto|costume|unsupported softness)\b/.test(profileRulesText)) add(-18, 'profile risk requires caution')
  if (/\b(avoid another pattern|quiet support|no extra pattern)\b/.test(profileRulesText) && (text.match(/\b(floral|paisley|botanical|abstract|graphic|print|pattern|stripe)\b/g) || []).length >= 2) {
    add(-16, 'profile warns against pattern stacking')
  }

  // Occasion alignment checks
  const occasion = String(options.occasion || '').toLowerCase().trim()
  if (occasion) {
    for (const piece of pieces) {
      if (!pieceOccasionCompatible(piece, occasion)) {
        add(-60, `${piece.name} is unsuitable for ${occasion} occasion`)
      }
    }
  }

  // Occasion profile boosts/penalties
  const occasionProfile = resolveOccasionProfile(occasion, options.mood || '')
  if (occasionProfile && occasionProfile.rules) {
    const preferredMaterials = occasionProfile.rules.preferred_materials ? [...occasionProfile.rules.preferred_materials] : []
    const preferredFootwear = occasionProfile.rules.preferred_footwear ? [...occasionProfile.rules.preferred_footwear] : []
    const discouragedMaterials = occasionProfile.rules.discouraged_materials ? [...occasionProfile.rules.discouraged_materials] : []
    if (weather.isHot && occasionProfile.rules.discouraged_materials_warm) {
      discouragedMaterials.push(...occasionProfile.rules.discouraged_materials_warm)
    }
    const discouragedFootwear = occasionProfile.rules.discouraged_footwear ? [...occasionProfile.rules.discouraged_footwear] : []
    if (weather.isHot && occasionProfile.rules.discouraged_footwear_summer) {
      discouragedFootwear.push(...occasionProfile.rules.discouraged_footwear_summer)
    }
    if (weather.isHot && occasionProfile.rules.discouraged_footwear_warm) {
      discouragedFootwear.push(...occasionProfile.rules.discouraged_footwear_warm)
    }
    const discouragedPieces = occasionProfile.rules.discouraged_pieces ? [...occasionProfile.rules.discouraged_pieces] : []

    for (const piece of pieces) {
      // Preferred materials boost
      for (const mat of preferredMaterials) {
        if (pieceMatchesMaterial(piece, mat)) {
          add(8, `occasion profile: preferred material (${mat})`)
          break
        }
      }

      // Preferred footwear boost (if category is shoes)
      if (piece.category === 'shoes' || wardrobeCategoryGroup(piece) === 'shoes') {
        for (const fw of preferredFootwear) {
          if (pieceMatchesFootwear(piece, fw)) {
            add(10, `occasion profile: preferred footwear (${fw})`)
            break
          }
        }
      }

      // Discouraged materials penalty
      for (const mat of discouragedMaterials) {
        if (pieceMatchesMaterial(piece, mat)) {
          add(-8, `occasion profile: discouraged material (${mat})`)
          break
        }
      }

      // Discouraged footwear penalty (if category is shoes)
      if (piece.category === 'shoes' || wardrobeCategoryGroup(piece) === 'shoes') {
        for (const fw of discouragedFootwear) {
          if (pieceMatchesFootwear(piece, fw)) {
            add(-10, `occasion profile: discouraged footwear (${fw})`)
            break
          }
        }
      }

      // Discouraged pieces penalty
      for (const item of discouragedPieces) {
        if (pieceMatchesPieceName(piece, item)) {
          add(-10, `occasion profile: discouraged piece (${item})`)
          break
        }
      }
    }
  }



  // Clashing shoe/dress formality check
  const dress = pieces.find(p => wardrobeCategoryGroup(p) === 'dress')
  const shoe = pieces.find(p => wardrobeCategoryGroup(p) === 'shoes')
  if (dress && shoe) {
    const shoeBlob = pieceTextBlob(shoe)
    const isSneaker = /\b(sneaker|running|athletic|sporty|knit sneakers)\b/.test(shoeBlob)
    const dressBlob = pieceTextBlob(dress)
    const isFormalDress = /\b(evening|cocktail|formal|elegant|silk|satin|maxi)\b/.test(dressBlob) || (dress.occasions || []).map(o => o.toLowerCase()).includes('evening')
    if (isSneaker && isFormalDress) {
      add(-40, `clashing shoe formality: pairing casual sneakers with formal/maxi dress`)
    }
  }

  const feedbackInfluence = wholeWardrobeFeedbackInfluenceForCandidate(pieces, options)
  if (feedbackInfluence) {
    add(feedbackInfluence.score, 'whole-wardrobe feedback memory')
    reasons.push(...feedbackInfluence.reasons)
  }

  const sessionInfluence = options.sessionInfluence
  if (sessionInfluence) {
    const pieceIds = pieces.map(p => Number(p.id)).filter(Boolean)
    const formula = wholeWardrobeFormulaFamily({ pieces }, pieces, options.occasion)
    const piecePenalty = pieceIds.reduce((sum, id) => sum + (sessionInfluence.pieceRecency?.get(id) || 0), 0)
    if (piecePenalty > 0) add(-Math.min(piecePenalty, 40), 'recently shown pieces')

    const formulaPenalty = sessionInfluence.formulaRecency?.get(formula) || 0
    if (formulaPenalty > 0) add(-Math.min(formulaPenalty, 35), 'recently shown formula family')
  }

  const mood = String(options.mood || '').toLowerCase()
  const moodProfile = wholeWardrobeMoodProfile(mood)
  if (mood && text.includes(mood)) add(2, 'mood match')
  if (moodProfile?.id === 'modern_bohemian_restraint') {
    const bohoSignal = wholeWardrobeBohoSignalScore(pieces)
    const polishedGrounding = /\b(boot|mule|loafer|sandal|clog|wedge|leather|cognac|black|brown|pointed)\b/.test(text) && groups.includes('shoes')
    if (bohoSignal >= 4) add(28, 'strong boho mood match')
    else if (bohoSignal >= 2) add(16, 'boho mood match')
    else add(-36, 'misses boho mood')
    if (polishedGrounding) add(5, 'city boho grounding')
    if (/\b(black|turtleneck|tailored trouser|pointed heel|minimal column|all black|monochrome)\b/.test(text) && bohoSignal < 2) add(-24, 'too structured-minimal for boho mood')
  }

  const activeMissionId = options.activeMissionId
  if (activeMissionId) {
    if (activeMissionId === 'controlled_print') {
      const patternPieces = pieces.filter(p => {
        const pBlob = pieceTextBlob(p)
        const pName = pieceNameBlob(p)
        return /\b(floral|print|pattern|stripe|striped|abstract|tapestry|paisley|botanical|graphic|plaid)\b/.test(pName) ||
               /\b(floral|print|pattern|stripe|striped|abstract|tapestry|paisley|botanical|graphic|plaid)\b/.test(pBlob)
      })
      if (patternPieces.length === 1) {
        add(20, 'exactly one print hero')
      } else {
        add(-80, 'does not have exactly one print hero')
      }
      const hasStructuredStabilizer = pieces.some(p => {
        const pBlob = pieceTextBlob(p)
        return /\b(structured|utility|jacket|blazer|denim|trouser|leather|pointed|loafer|boot)\b/.test(pBlob)
      })
      if (hasStructuredStabilizer) {
        add(15, 'structured stabilizer present')
      } else {
        add(-15, 'lacks structured stabilizer')
      }
    } else if (activeMissionId === 'monochrome_texture') {
      const colorsSets = pieces.map(p => (p.colors || []).map(c => c.toLowerCase()))
      const neutralGray = ['black', 'grey', 'gray', 'charcoal']
      const blueFamily = ['blue', 'navy', 'denim']
      const earthFamily = ['brown', 'espresso', 'tan', 'cognac', 'beige', 'cream', 'ivory', 'sand', 'oatmeal']
      
      const counts = { neutralGray: 0, blueFamily: 0, earthFamily: 0 }
      for (const pColors of colorsSets) {
        if (pColors.some(c => neutralGray.includes(c))) counts.neutralGray++
        if (pColors.some(c => blueFamily.includes(c))) counts.blueFamily++
        if (pColors.some(c => earthFamily.includes(c))) counts.earthFamily++
      }
      
      const maxMatch = Math.max(counts.neutralGray, counts.blueFamily, counts.earthFamily)
      if (maxMatch === pieces.length) {
        add(25, 'perfect monochrome color family match')
      } else if (maxMatch >= pieces.length - 1) {
        add(15, 'tonal monochrome support')
      } else {
        add(-80, 'competing colors in monochrome mission')
      }
      
      const textBlob = pieces.map(pieceTextBlob).join(' ')
      const textureCount = (textBlob.match(/\b(crochet|knit|cashmere|corduroy|linen|silk|satin|leather|suede|tweed|velvet|gauzy|drape|textured)\b/g) || []).length
      if (textureCount >= 2) {
        add(20, 'rich texture contrast')
      } else {
        add(-15, 'lacks texture variety')
      }
    } else if (activeMissionId === 'structured_soft') {
      const hasSoft = pieces.some(p => /\b(soft|gauzy|drape|drapey|silk|satin|cashmere|wool knit|linen|ruffle|cowl|mock)\b/.test(pieceTextBlob(p)))
      const hasStructured = pieces.some(p => /\b(structured|utility|blazer|jacket|twill|denim|leather|pointed|loafer|boot|pants|trousers)\b/.test(pieceTextBlob(p)))
      if (hasSoft && hasStructured) {
        add(25, 'productive soft + structured tension')
      } else {
        add(-80, 'lacks structured/soft tension')
      }
    } else if (activeMissionId === 'color_anchor') {
      const focalColors = ['coral', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'lavender', 'fuchsia', 'magenta', 'teal', 'turquoise', 'chartreuse', 'violet', 'lilac', 'rust', 'terracotta', 'mustard', 'ochre', 'plum', 'burgundy', 'emerald', 'red', 'cognac']
      const focalCount = pieces.filter(p => pieceHasFocalColor(p, focalColors)).length
      
      if (focalCount === 1) {
        add(30, 'exactly one focal color anchor')
      } else {
        add(-80, 'does not have exactly one focal color anchor')
      }
      
      const nonFocalPieces = pieces.filter(p => !pieceHasFocalColor(p, focalColors))
      const allNonFocalNeutral = nonFocalPieces.every(p => {
        const colors = (p.colors || []).map(c => c.toLowerCase())
        const readsAs = String(p.reads_as || '').toLowerCase()
        const name = String(p.name || '').toLowerCase()
        const cText = [...colors, readsAs, name].join(' ')
        return /\b(black|charcoal|grey|gray|navy|white|cream|ivory|beige|taupe|sand|oatmeal|espresso|brown)\b/.test(cText)
      })
      
      if (allNonFocalNeutral) {
        add(15, 'quiet neutral support for anchor')
      } else {
        add(-30, 'noisy support distracts from color anchor')
      }
    } else if (activeMissionId === 'unexpected_pairing') {
      add(20, 'exploratory unexpected candidate pairing')
      const shoe = pieces.find(p => wardrobeCategoryGroup(p) === 'shoes')
      if (shoe && /\b(pointed|patent|loafer|boot|mule|oxford|structured)\b/.test(pieceTextBlob(shoe))) {
        add(25, 'unexpected pairing grounded by structured shoe')
      } else {
        add(-15, 'unexpected pairing lacks grounded finish')
      }
    } else if (activeMissionId === 'soft_architecture') {
      const hasDenimOrBlack = pieces.some(p => /\b(denim|jean|black)\b/.test(pieceTextBlob(p)) || /\b(denim|jean|black)\b/.test(pieceNameBlob(p)))
      if (hasDenimOrBlack) {
        add(-80, 'contains forbidden denim or black')
      } else {
        add(20, 'clean non-denim/non-black architecture')
      }
      const hasShape = pieces.some(p => /\b(cowl|mock|boatneck|drape|drapey|A-line|flowing|column|maxi|midi|waist|belt|tuck)\b/.test(pieceTextBlob(p)))
      if (hasShape) {
        add(15, 'architectural shape / drape')
      }
    }
  }

  return { score, reasons: reasons.slice(0, 6), names }
}

export function candidateObjectFromPieces(pieces, index, options) {
  const scored = scoreWholeWardrobeCandidate(pieces, options)
  const activeMission = OUTFIT_MISSIONS.find(m => m.id === options.activeMissionId)
  return {
    candidateId: `cand-${index + 1}`,
    label: pieces.map(p => p.name).join(' + '),
    pieceIds: pieces.map(p => Number(p.id)).filter(Boolean),
    pieces: pieces.map(p => ({ id: p.id, name: p.name, category: wardrobeCategoryGroup(p), photo: p.photo || null, worn_photo: p.worn_photo || null })),
    localScore: scored.score,
    localReasons: scored.reasons,
    missionId: options.activeMissionId || null,
    missionLabel: activeMission ? activeMission.label : null
  }
}

export function wholeWardrobeCandidateAxes(candidate = {}) {
  const pieces = Array.isArray(candidate.pieces) ? candidate.pieces : []
  const outfit = { pieces }
  const top = wholeWardrobePieceByGroup(outfit, 'top')
  const bottom = wholeWardrobePieceByGroup(outfit, 'bottom')
  const shoe = wholeWardrobePieceByGroup(outfit, 'shoes')
  const text = pieces.map(pieceTextBlob).join(' ').toLowerCase()
  return {
    topId: top ? Number(top.id) : null,
    bottomId: bottom ? Number(bottom.id) : null,
    shoeId: shoe ? Number(shoe.id) : null,
    formula: wholeWardrobeFormulaFamily(outfit, pieces),
    silhouette: wholeWardrobeSilhouetteFromPieces(outfit),
    grounding: wholeWardrobeGroundingStrategy(outfit),
    shoeShape: wholeWardrobeShoeShape(outfit),
    rhythm: wholeWardrobeVisualRhythm(outfit),
    hasDress: pieces.some(p => wardrobeCategoryGroup(p) === 'dress'),
    hasNonGraphicTop: Boolean(top && !/\b(floral|print|graphic|stripe|striped|pattern|abstract|tapestry)\b/.test(pieceTextBlob(top))),
    hasSoftTexture: /\b(crochet|gauze|gauzy|soft|cashmere|drape|drapey|silk|ruffle|fluid)\b/.test(text),
    hasTonalDark: /\b(black|charcoal|espresso|chocolate|deep navy|navy)\b/.test(text) && !/\b(floral|graphic|stripe|striped|pattern|abstract|tapestry)\b/.test(text)
  }
}

export function selectDiverseWholeWardrobeCandidates(candidates = [], limit = 60, options = {}) {
  const selected = []
  const pool = [...candidates]
  const useCount = {
    top: new Map(),
    bottom: new Map(),
    shoe: new Map(),
    formula: new Map(),
    silhouette: new Map(),
    grounding: new Map(),
    shoeShape: new Map(),
    rhythm: new Map()
  }
  const count = (map, key) => key == null ? 0 : (map.get(key) || 0)
  const bump = (map, key) => {
    if (key != null) map.set(key, (map.get(key) || 0) + 1)
  }
  const selectedHas = predicate => selected.some(candidate => predicate(wholeWardrobeCandidateAxes(candidate)))

  // Guarantee representation of each unique mission present in the pool first
  const uniqueMissionsInPool = [...new Set(pool.map(c => c.missionId).filter(Boolean))]
  for (const missionId of uniqueMissionsInPool) {
    if (selected.length >= limit) break
    const missionCandidates = pool.filter(c => c.missionId === missionId)
    if (!missionCandidates.length) continue
    missionCandidates.sort((a, b) => (b.score ?? b.localScore ?? 0) - (a.score ?? a.localScore ?? 0))
    const bestForMission = missionCandidates[0]
    const poolIdx = pool.findIndex(c => c.key === bestForMission.key)
    if (poolIdx !== -1) {
      const [chosen] = pool.splice(poolIdx, 1)
      const axes = wholeWardrobeCandidateAxes(chosen)
      selected.push(chosen)
      bump(useCount.top, axes.topId)
      bump(useCount.bottom, axes.bottomId)
      bump(useCount.shoe, axes.shoeId)
      bump(useCount.formula, axes.formula)
      bump(useCount.silhouette, axes.silhouette)
      bump(useCount.grounding, axes.grounding)
      bump(useCount.shoeShape, axes.shoeShape)
      bump(useCount.rhythm, axes.rhythm)
    }
  }

  while (pool.length && selected.length < limit) {
    let bestIndex = 0
    let bestScore = -Infinity
    for (let i = 0; i < pool.length; i += 1) {
      const candidate = pool[i]
      const axes = wholeWardrobeCandidateAxes(candidate)
      let score = Number(candidate.score ?? candidate.localScore) || 0

      if (!count(useCount.formula, axes.formula)) score += 22
      if (!count(useCount.silhouette, axes.silhouette)) score += 16
      if (!count(useCount.grounding, axes.grounding)) score += 12
      if (!count(useCount.shoeShape, axes.shoeShape)) score += 10
      if (!count(useCount.rhythm, axes.rhythm)) score += 10
      if (axes.topId && !count(useCount.top, axes.topId)) score += 9
      if (axes.bottomId && !count(useCount.bottom, axes.bottomId)) score += 9
      if (axes.hasDress && !selectedHas(a => a.hasDress)) score += 24
      if (axes.hasNonGraphicTop && !selectedHas(a => a.hasNonGraphicTop)) score += 16
      if (axes.hasSoftTexture && !selectedHas(a => a.hasSoftTexture)) score += 12
      if (axes.hasTonalDark && !selectedHas(a => a.hasTonalDark)) score += 12
      const moodProfile = wholeWardrobeMoodProfile(options.mood)
      if (moodProfile?.id === 'modern_bohemian_restraint') {
        const bohoSignal = wholeWardrobeBohoSignalScore(candidate.pieces)
        if (bohoSignal >= 4) score += 30
        else if (bohoSignal >= 2) score += 16
        else score -= 60
      }

      score -= count(useCount.top, axes.topId) * 46
      score -= count(useCount.bottom, axes.bottomId) * 34
      score -= count(useCount.shoe, axes.shoeId) * 14
      score -= count(useCount.formula, axes.formula) * 44
      score -= count(useCount.silhouette, axes.silhouette) * 24
      score -= count(useCount.grounding, axes.grounding) * 14
      score -= count(useCount.shoeShape, axes.shoeShape) * 12
      score -= count(useCount.rhythm, axes.rhythm) * 12

      if (score > bestScore) {
        bestScore = score
        bestIndex = i
      }
    }

    const [chosen] = pool.splice(bestIndex, 1)
    const axes = wholeWardrobeCandidateAxes(chosen)
    selected.push(chosen)
    bump(useCount.top, axes.topId)
    bump(useCount.bottom, axes.bottomId)
    bump(useCount.shoe, axes.shoeId)
    bump(useCount.formula, axes.formula)
    bump(useCount.silhouette, axes.silhouette)
    bump(useCount.grounding, axes.grounding)
    bump(useCount.shoeShape, axes.shoeShape)
    bump(useCount.rhythm, axes.rhythm)
  }

  return selected
}

export function wholeWardrobeCandidateFormulaCounts(candidates = []) {
  return candidates.reduce((counts, candidate) => {
    const formula = wholeWardrobeCandidateAxes(candidate).formula || 'unknown'
    counts[formula] = (counts[formula] || 0) + 1
    return counts
  }, {})
}

export function wholeWardrobeCandidateText(candidates = []) {
  return candidates.map((candidate, index) => [
    `${index + 1}. ${candidate.candidateId} | formula family ${wholeWardrobeCandidateAxes(candidate).formula}`,
    `Pieces: ${candidate.pieces.map(p => `${p.id}:${p.name} (${p.category})`).join(' + ')}`,
    candidate.localReasons?.length ? `Local reasons: ${candidate.localReasons.join('; ')}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')
}

export function buildWholeWardrobeCandidateOutfits(allPieces, options = {}) {
  const moodProfile = wholeWardrobeMoodProfile(options.mood)
  const activeMissions = options.activeMissions || ['controlled_print', 'monochrome_texture', 'structured_soft', 'color_anchor', 'unexpected_pairing']
  
  const testCandidateLimit = process.env.NODE_ENV === 'test'
    ? Math.max(0, Number(process.env.WARDROBE_TEST_MAX_WHOLE_WARDROBE_CANDIDATES) || 0)
    : 0
  
  const allMissionsCandidates = []
  const seenKeys = new Set()
  
  const colorFamilies = ['black/charcoal/gray', 'navy/blue', 'brown/espresso/beige/cream/tan', 'olive/earthy']
  const focalColors = ['rust', 'terracotta', 'mustard', 'ochre', 'plum', 'burgundy', 'emerald', 'red']
  
  const chosenColorFamily = colorFamilies[(allPieces.length) % colorFamilies.length]
  const chosenFocalColor = focalColors[(allPieces.length + 3) % focalColors.length]
  
  for (const missionId of activeMissions) {
    const bucket = wholeWardrobePieceBucket(allPieces, {
      ...options,
      missionId,
      colorFamily: chosenColorFamily,
      focalColor: chosenFocalColor
    })
    
    const maxInitialCandidates = testCandidateLimit ? 20 : 1200
    const maxSeparateCandidates = Math.round(maxInitialCandidates * 0.85)
    
    const sliceForTest = (items, productionLimit) => items.slice(0, testCandidateLimit ? Math.min(items.length, 3) : productionLimit)
    
    const shoes = bucket.shoes.length ? sliceForTest(bucket.shoes, 10) : [null]
    const tops = sliceForTest(bucket.top, 16)
    const bottoms = sliceForTest(bucket.bottom, 14)
    const dresses = sliceForTest(bucket.dress, 10)
    const outerwear = sliceForTest(bucket.outerwear, 6)
    const accessories = sliceForTest(bucket.accessory, 6)
    
    const missionCandidates = []
    
    const addCandidate = (pieces) => {
      if (missionCandidates.length >= maxInitialCandidates) return
      const clean = pieces.filter(Boolean)
      if (moodProfile?.id === 'modern_bohemian_restraint' && wholeWardrobeBohoSignalScore(clean) < 2) return
      
      if (missionId === 'soft_architecture') {
        const hasDenimOrBlack = clean.some(p => /\b(denim|jean|black)\b/.test(pieceTextBlob(p)) || /\b(denim|jean|black)\b/.test(pieceNameBlob(p)))
        if (hasDenimOrBlack) return
      }
      
      const key = clean.map(p => p.id).sort((a,b) => a-b).join('|')
      if (!key) return
      const scored = scoreWholeWardrobeCandidate(clean, { ...options, activeMissionId: missionId })
      if (scored.score < -18) return
      missionCandidates.push({ key, pieces: clean, score: scored.score, missionId })
    }
    
    separateCandidates:
    for (const top of tops) {
      for (const bottom of bottoms) {
        for (const shoe of shoes) {
          addCandidate([top, bottom, shoe])
          if (missionCandidates.length >= maxSeparateCandidates) break separateCandidates
        }
      }
    }
    dressCandidates:
    for (const dress of dresses) {
      for (const shoe of shoes) {
        addCandidate([dress, shoe])
        if (missionCandidates.length >= maxInitialCandidates) break dressCandidates
      }
    }
    
    const baseCandidateLimit = testCandidateLimit ? 4 : 40
    const layeredBaseLimit = testCandidateLimit ? 2 : 15
    const layerLimit = testCandidateLimit ? 1 : 2
    const accessoryLimit = testCandidateLimit ? 1 : 2
    const base = missionCandidates
      .sort((a, b) => b.score - a.score)
      .slice(0, baseCandidateLimit)
    
    for (const candidate of base.slice(0, layeredBaseLimit)) {
      for (const layer of outerwear.slice(0, layerLimit)) addCandidate([...candidate.pieces, layer])
      for (const accessory of accessories.slice(0, accessoryLimit)) addCandidate([...candidate.pieces, accessory])
    }
    
    const sortedMissionCandidates = missionCandidates.sort((a, b) => b.score - a.score)
    const topLimit = testCandidateLimit ? 4 : 50
    for (const cand of sortedMissionCandidates.slice(0, topLimit)) {
      const globalKey = `${cand.key}-${missionId}`
      if (!seenKeys.has(globalKey)) {
        seenKeys.add(globalKey)
        allMissionsCandidates.push(cand)
      }
    }
  }
  
  const ranked = allMissionsCandidates.sort((a, b) => b.score - a.score)
  const chosen = selectDiverseWholeWardrobeCandidates(ranked, testCandidateLimit || 60, options)
  
  return chosen.map((candidate, index) => {
    return candidateObjectFromPieces(candidate.pieces, index, { ...options, activeMissionId: candidate.missionId })
  })
}

export function normalizeWholeWardrobeOutfitObject(outfit, candidatePieces = []) {
  const candidateById = new Map(candidatePieces.map(p => [Number(p.id), p]))
  const ids = []
  const addId = (value) => {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0 && candidateById.has(n) && !ids.includes(n)) ids.push(n)
  }
  if (Array.isArray(outfit?.pieceIds)) outfit.pieceIds.forEach(addId)
  if (Array.isArray(outfit?.pieces)) outfit.pieces.forEach(piece => addId(piece?.id))
  const ownedPieces = ids.map(id => candidateById.get(id)).filter(Boolean)
  const label = String(outfit?.label || outfit?.title || 'Whole wardrobe outfit').trim()
  const strength = String(outfit?.strength || '').toLowerCase().trim()
  const missionId = outfit?.missionId || null
  const activeMission = OUTFIT_MISSIONS.find(m => m.id === missionId)
  return {
    label,
    strength: ['signature', 'strong', 'usable', 'experimental'].includes(strength) ? strength : 'strong',
    dominantDirection: outfit?.dominantDirection || outfit?.dominant_direction || outfit?.direction || '',
    silhouette: outfit?.silhouette || '',
    bestFor: outfit?.bestFor || outfit?.best_for || '',
    reason: outfit?.reason || outfit?.why || '',
    watchFor: outfit?.watchFor || outfit?.watch_for || 'none',
    pieceIds: ids.slice(0, 6),
    missingPieces: [],
    textOnly: true,
    wholeWardrobe: true,
    localScore: Number(outfit?.localScore) || 0,
    archetypeId: outfit?.archetypeId || null,
    formulaFamily: outfit?.formulaFamily || null,
    missionId,
    missionLabel: activeMission ? activeMission.label : null,
    pieces: ownedPieces.map(p => ({ id: p.id, name: p.name, category: wardrobeCategoryGroup(p), photo: p.photo || null, worn_photo: p.worn_photo || null }))
  }
}

export function mergeStyleProfilePatch(existing = {}, patch = {}) {
  if (!patch || typeof patch !== 'object') return existing || {}
  const base = existing && typeof existing === 'object' ? existing : {}
  const merged = { ...base, ...patch }
  if (base.style_lanes || patch.style_lanes) merged.style_lanes = { ...(base.style_lanes || {}), ...(patch.style_lanes || {}) }
  if (base.style_notes || patch.style_notes) merged.style_notes = { ...(base.style_notes || {}), ...(patch.style_notes || {}) }
  if (base.garment_intelligence || patch.garment_intelligence) {
    const b = base.garment_intelligence || {}
    const p = patch.garment_intelligence || {}
    merged.garment_intelligence = { ...b, ...p }
    for (const key of ['pairing_requirements', 'failure_risks', 'formula_compatibility', 'do_not_pair_rules']) {
      if (b[key] || p[key]) merged.garment_intelligence[key] = [...new Set([...normalizeStyleProfileList(b[key]), ...normalizeStyleProfileList(p[key])])]
    }
    if (b.real_wear_notes || p.real_wear_notes) merged.garment_intelligence.real_wear_notes = { ...(b.real_wear_notes || {}), ...(p.real_wear_notes || {}) }
    if (b.occasion_confidence || p.occasion_confidence) merged.garment_intelligence.occasion_confidence = { ...(b.occasion_confidence || {}), ...(p.occasion_confidence || {}) }
  }
  return merged
}

function localNormalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function dedupeMissingAgainstOwned(missingPieces = [], ownedPieces = []) {
  const ownedKeys = new Set(ownedPieces.map(p => `${localNormalizeForMatch(p.name)}|${localNormalizeForMatch(p.category)}`))
  const ownedNames = new Set(ownedPieces.map(p => localNormalizeForMatch(p.name)))
  const seen = new Set()
  const result = []
  for (const piece of missingPieces || []) {
    const nameKey = localNormalizeForMatch(piece?.name || '').replace(/ missing piece$/i, '').trim()
    const categoryKey = localNormalizeForMatch(piece?.category || '')
    const key = `${nameKey}|${categoryKey}`
    if (!nameKey) continue
    if (ownedNames.has(nameKey) || ownedKeys.has(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    result.push(piece)
  }
  return result
}

export function photoPreservingVisualsEnabled() {
  return String(process.env.PHOTO_PRESERVING_VISUALS || 'false').toLowerCase() === 'true'
}


// ============================================================================
// --- CONSOLIDATED WHOLE-WARDROBE STYLING LOGIC MOVED FROM FORKED Call Sites ---
// ============================================================================

export function outfitStylisticStrengthScore(outfit = {}, selectedPiece = null) {
  const text = [
    outfit.label,
    outfit.dominantDirection,
    outfit.silhouette,
    outfit.bestFor,
    outfit.reason,
    outfit.watchFor,
    ...(Array.isArray(outfit.pieces) ? outfit.pieces.map(p => p?.name || '') : [])
  ].join(' ').toLowerCase()
  let score = 0
  const add = (n, reason) => { score += n }

  if (/\b(dark column|column|graphic|contrast|structured|structure|architectural|gallery|modern minimal|clean & modern|clean and modern|earthy & structured|earthy and structured|artistic contrast|modern preppy|city minimal|black minimalist|monochrome chic|relaxed artistic|structured utility|slightly edgy)\b/.test(text)) add(22)
  if (/\b(black|charcoal|deep navy|espresso|chocolate|plum|olive|cognac|rust|terra.?cotta|ink navy)\b/.test(text)) add(9)
  if (/\b(pointed|loafer|loafers|ankle boot|boots|boot|structured bag|crossbody|long pendant|belt|blazer|utility|denim|jeans|cigarette|straight|pencil|midi|column skirt|dark denim|cuffed|cuff|mule|oxford)\b/.test(text)) add(10)
  if (/\b(tension|friction|sharp|grounded|edited|visual thesis|focal|directional|memorable|angular|asymmetry|asymmetric|attitude)\b/.test(text)) add(18)
  if (/\b(dark|black|charcoal|espresso|deep navy)\b/.test(text) && /\b(pointed|loafer|boot|structured|column|jeans|trouser)\b/.test(text)) add(10)

  if (/\b(luxe neutral|elevated casual|harmonious|harmony|flattering|elongating|draws attention upward|balanced silhouette|balance the body|confidence|comfortable chic|soft romantic|soft neutral|textured monochrome contrast|lightweight layered elegance|luxe neutral layering)\b/.test(text)) add(-34)
  if (/\b(librarian|catalog|mature|tasteful|polished neutral|sophisticated neutral|respectable|ladylike)\b/.test(text)) add(-30)
  if (/\b(cream stable slip-on|stable slip-on|soft shoe|light casual sneaker|rounded sneaker|beige|sand-colored|sand colored|cream slip-on|taupe slip-on|white architectural skirt|soft white skirt)\b/.test(text)) add(-18)
  if (/\b(soft)\b/.test(text) && !/\b(contrast|structure|structured|dark|black|charcoal|pointed|boot|loafer|graphic)\b/.test(text)) add(-18)
  if (/\b(cream|ivory|white|beige|taupe|sand|blush)\b/.test(text) && /\b(skirt|pant|trouser|shoe|sneaker|slip-on|flat)\b/.test(text) && !/\b(black|charcoal|deep navy|espresso|plum|cognac|rust|graphic|contrast|pointed|boot|structured|dark column)\b/.test(text)) add(-18)

  if (/\b(cream|beige|taupe|ivory|sand|blush)\b/.test(text) && !/\b(black|charcoal|espresso|plum|deep navy|graphic|contrast|pointed|boot|structured|dark column)\b/.test(text)) add(-14)
  if (/\b(skirt|pants|trouser)\b/.test(text) && !/\b(pointed|loafer|boot|black|structured|dark|cognac|sharp|grounded)\b/.test(text)) add(-8)

  if (!String(outfit.label || '').trim() || /^third wardrobe option|best wardrobe direction|relaxed structured variation|strongest wardrobe column$/i.test(String(outfit.label || '').trim())) add(-8)
  if (!String(outfit.dominantDirection || '').trim()) add(-6)
  if (!String(outfit.silhouette || '').trim()) add(-6)
  return score
}

export function sortByStylisticStrength(outfits = [], selectedPiece = null) {
  const strengthOrder = { signature: 8, strong: 5, usable: 2, experimental: 1 }
  return [...outfits].sort((a, b) => {
    const as = outfitStylisticStrengthScore(a, selectedPiece) + (strengthOrder[a?.strength] || 3)
    const bs = outfitStylisticStrengthScore(b, selectedPiece) + (strengthOrder[b?.strength] || 3)
    return bs - as
  }).map((o, index) => {
    const score = outfitStylisticStrengthScore(o, selectedPiece)
    const copy = { ...o }
    if (index === 0 && score >= 8) copy.strength = 'signature'
    else if (score < -15 && copy.strength === 'signature') copy.strength = 'usable'
    else if (score < -5 && copy.strength === 'strong') copy.strength = 'usable'
    return copy
  })
}

export function rewriteWholeWardrobeOutfitWithArchetype(outfit = {}, candidatePieces = [], occasion = 'casual') {
  const pieces = wholeWardrobeFullPieces(outfit, candidatePieces)
  const archetype = wholeWardrobeArchetypeFor({ ...outfit, pieces }, candidatePieces, occasion)
  const modifier = wholeWardrobeGarmentModifier(pieces)
  const label = modifier
    ? `${archetype.labelSuggestion}: ${modifier}`
    : archetype.labelSuggestion
  const silhouetteVariant = wholeWardrobeSilhouetteFromPieces({ ...outfit, pieces })
  const silhouette = silhouetteVariant && silhouetteVariant !== archetype.direction
    ? silhouetteVariant
    : archetype.silhouette
  return {
    ...outfit,
    archetypeId: archetype.archetypeId,
    formulaFamily: archetype.formulaFamily,
    label,
    dominantDirection: archetype.direction,
    silhouette,
    reason: buildOutfitMechanicsReason(outfit, pieces, archetype),
    watchFor: wholeWardrobeWatchFromPieces({ ...outfit, pieces })
  }
}

export function hasWholeWardrobePlaceholder(outfit = {}) {
  const text = [outfit.label, outfit.dominantDirection, outfit.silhouette, outfit.bestFor, outfit.reason, outfit.watchFor].join(' ').toLowerCase()
  return /\b(short style lane|one clear silhouette idea|short use case|whole wardrobe outfit|strong wardrobe outfit|complete wardrobe formula|locally ranked wardrobe composition)\b/.test(text)
}

export function hasGenericWholeWardrobeText(outfit = {}) {
  const text = [outfit.reason, outfit.watchFor].join(' ').toLowerCase()
  return /\b(balances artfulness with modernity|playful touch|overall look|creates an artistic visual|refined silhouette|visual balance|contrasts well|modern artistic element|clean silhouette|may overwhelm the look|potential boxiness|ensure the playful elements do not overwhelm)\b/.test(text)
}

export function repairWholeWardrobeOutfit(outfit = {}, candidatePieces = [], occasion = 'casual', mood = '', options = {}) {
  const repaired = rewriteWholeWardrobeOutfitWithArchetype({ ...outfit }, candidatePieces, occasion)
  
  // Footwear gate & repair
  const occasionProfile = resolveOccasionProfile(occasion, mood)
  if (occasionProfile && occasionProfile.rules && occasionProfile.rules.required_footwear) {
    const pieces = wholeWardrobeFullPieces(repaired, candidatePieces)
    const currentShoe = pieces.find(p => p.category === 'shoes' || wardrobeCategoryGroup(p) === 'shoes')
    if (currentShoe) {
      const isTrailRated = occasionProfile.rules.required_footwear.some(fw => pieceMatchesFootwear(currentShoe, fw))
      if (!isTrailRated) {
        const weatherProfile = options.weatherProfile || weatherProfileFromContext({ mood, season: options.season })
        const { allowedPieces } = filterWholeWardrobePiecesForGeneration(candidatePieces, { occasion, weatherProfile, mood })
        
        const getShoeRelevance = (shoe) => {
          let score = pieceOccasionScore(shoe, occasion)
          const preferredFootwear = occasionProfile.rules.preferred_footwear || []
          const discouragedFootwear = [
            ...(occasionProfile.rules.discouraged_footwear || []),
            ...(weatherProfile.isHot && occasionProfile.rules.discouraged_footwear_summer ? occasionProfile.rules.discouraged_footwear_summer : []),
            ...(weatherProfile.isHot && occasionProfile.rules.discouraged_footwear_warm ? occasionProfile.rules.discouraged_footwear_warm : [])
          ]
          for (const fw of preferredFootwear) {
            if (pieceMatchesFootwear(shoe, fw)) {
              score += 10
              break
            }
          }
          for (const fw of discouragedFootwear) {
            if (pieceMatchesFootwear(shoe, fw)) {
              score -= 10
              break
            }
          }
          if (occasionProfile.rules.discouraged_materials) {
            for (const mat of occasionProfile.rules.discouraged_materials) {
              if (pieceMatchesMaterial(shoe, mat)) {
                score -= 8
                break
              }
            }
          }
          return score
        }
        
        const candidateShoes = allowedPieces.filter(p => {
          if (p.category !== 'shoes' && wardrobeCategoryGroup(p) !== 'shoes') return false
          return occasionProfile.rules.required_footwear.some(fw => pieceMatchesFootwear(p, fw))
        })
        
        if (candidateShoes.length > 0) {
          candidateShoes.sort((a, b) => {
            const scoreA = getShoeRelevance(a)
            const scoreB = getShoeRelevance(b)
            if (scoreA !== scoreB) return scoreB - scoreA
            return a.id - b.id
          })
          const bestShoe = candidateShoes[0]
          
          if (Array.isArray(repaired.pieceIds)) {
            repaired.pieceIds = repaired.pieceIds.map(id => Number(id) === Number(currentShoe.id) ? Number(bestShoe.id) : Number(id))
          }
          if (Array.isArray(repaired.pieces)) {
            repaired.pieces = repaired.pieces.map(p => Number(p.id) === Number(currentShoe.id) ? bestShoe : p)
          }
          const updatedRepaired = rewriteWholeWardrobeOutfitWithArchetype(repaired, candidatePieces, occasion)
          Object.assign(repaired, updatedRepaired)
        } else {
          const warning = "footwear is not trail-rated — closest available match."
          if (!repaired.watchFor || repaired.watchFor === 'none') {
            repaired.watchFor = warning
          } else if (!repaired.watchFor.includes(warning)) {
            repaired.watchFor = `${repaired.watchFor}; ${warning}`
          }
        }
      }
    }
  }
  if (hasWholeWardrobePlaceholder(repaired) || !String(repaired.label || '').trim()) repaired.label = wholeWardrobeLabelFromPieces(repaired)
  if (hasWholeWardrobePlaceholder(repaired) || !String(repaired.dominantDirection || '').trim() || String(repaired.dominantDirection || '').trim() === String(repaired.silhouette || '').trim()) repaired.dominantDirection = wholeWardrobeArchetypeFor(repaired, candidatePieces, occasion).direction
  if (hasWholeWardrobePlaceholder(repaired) || !String(repaired.silhouette || '').trim() || String(repaired.dominantDirection || '').trim() === String(repaired.silhouette || '').trim()) repaired.silhouette = wholeWardrobeSilhouetteFromPieces(repaired)
  if (hasWholeWardrobePlaceholder(repaired) || !String(repaired.bestFor || '').trim()) repaired.bestFor = 'right-now wardrobe dressing'
  if (hasWholeWardrobePlaceholder(repaired) || hasGenericWholeWardrobeText(repaired) || !String(repaired.reason || '').trim()) repaired.reason = buildOutfitMechanicsReason(repaired, wholeWardrobeFullPieces(repaired, candidatePieces), wholeWardrobeArchetypeFor(repaired, candidatePieces, occasion))
  if (hasWholeWardrobePlaceholder(repaired) || hasGenericWholeWardrobeText(repaired) || !String(repaired.watchFor || '').trim() || /^none$/i.test(String(repaired.watchFor || '').trim())) repaired.watchFor = wholeWardrobeWatchFromPieces(repaired)
  const moodProfile = wholeWardrobeMoodProfile(mood)
  if (moodProfile?.id === 'modern_bohemian_restraint') {
    const pieces = wholeWardrobeFullPieces(repaired, candidatePieces)
    if (wholeWardrobeBohoSignalScore(pieces) >= 2) {
      repaired.pieces = pieces
      repaired.label = bohoMoodLabelFromPieces(repaired)
      repaired.dominantDirection = 'modern bohemian restraint with city grounding'
      repaired.silhouette = wholeWardrobeSilhouetteFromPieces(repaired)
      repaired.reason = buildBohoOutfitReason(repaired, pieces, occasion)
      repaired.watchFor = buildBohoWatch(repaired, pieces)
    }
  }
  return repaired
}

export function wholeWardrobeDiversitySelectionScore(outfit, selected, options = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const top = wholeWardrobePieceByGroup(outfit, 'top')
  const bottom = wholeWardrobePieceByGroup(outfit, 'bottom')
  const shoe = wholeWardrobePieceByGroup(outfit, 'shoes')
  const formula = wholeWardrobeFormulaFamily(outfit, options.candidatePieces, options.occasion)
  const silhouetteFamily = wholeWardrobeSilhouetteFromPieces(outfit)
  const grounding = wholeWardrobeGroundingStrategy(outfit)
  const shoeShape = wholeWardrobeShoeShape(outfit)
  const rhythm = wholeWardrobeVisualRhythm(outfit)
  let score = outfitStylisticStrengthScore(outfit, null) + (Number(outfit.localScore) || 0) * 0.25 + (Number(outfit.archetypeScore) || 0)
  const countPiece = (groupPiece) => groupPiece
    ? selected.filter(existing => (existing.pieces || []).some(p => Number(p.id) === Number(groupPiece.id))).length
    : 0
  const sameTopCount = countPiece(top)
  const sameBottomCount = countPiece(bottom)
  const sameShoeCount = countPiece(shoe)
  const sameFormulaCount = selected.filter(existing => wholeWardrobeFormulaFamily(existing, options.candidatePieces, options.occasion) === formula).length
  const sameSilhouetteCount = selected.filter(existing => wholeWardrobeSilhouetteFromPieces(existing) === silhouetteFamily).length
  const sameGroundingCount = selected.filter(existing => wholeWardrobeGroundingStrategy(existing) === grounding).length
  const sameShoeShapeCount = selected.filter(existing => wholeWardrobeShoeShape(existing) === shoeShape).length
  const sameRhythmCount = selected.filter(existing => wholeWardrobeVisualRhythm(existing) === rhythm).length
  const printFormulaCount = wholeWardrobeHasPrintOrStripe(outfit)
    ? selected.filter(existing => wholeWardrobeHasPrintOrStripe(existing)).length
    : 0

  if (sameTopCount >= 1) score -= 40 * sameTopCount
  if (sameBottomCount >= 1) score -= 20 * sameBottomCount
  if (sameShoeCount >= 1) score -= 20 * sameShoeCount
  if (sameSilhouetteCount >= 1) score -= 35 * sameSilhouetteCount
  if (sameGroundingCount >= 1) score -= 18 * sameGroundingCount
  if (sameShoeShapeCount >= 1) score -= 14 * sameShoeShapeCount
  if (sameRhythmCount >= 1) score -= 16 * sameRhythmCount
  if (printFormulaCount >= 1) score -= 20 * printFormulaCount
  if (sameFormulaCount >= 1) score -= 45 * sameFormulaCount
  if (formula === 'compact_top_dark_column' && sameFormulaCount >= 1) score -= 25
  const moodProfile = wholeWardrobeMoodProfile(options.mood)
  if (moodProfile?.id === 'modern_bohemian_restraint') {
    const bohoSignal = wholeWardrobeBohoSignalScore(pieces)
    if (bohoSignal >= 4) score += 24
    else if (bohoSignal >= 2) score += 12
    else score -= 45
  }
  return score
}

export function bestWholeWardrobeRequirementCandidate(pool, selected, predicate, options = {}) {
  const selectedKeys = new Set(selected.map(o => (o.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')))
  return pool
    .filter(outfit => predicate(outfit))
    .filter(outfit => !selectedKeys.has((outfit.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')))
    .sort((a, b) => wholeWardrobeDiversitySelectionScore(b, selected, options) - wholeWardrobeDiversitySelectionScore(a, selected, options))[0] || null
}

export function applyWholeWardrobeDiversity(outfits = [], limit = 5, options = {}) {
  const selected = []
  const rejected = []
  const topUse = new Map()
  const bottomUse = new Map()
  const shoeUse = new Map()
  const heroUse = new Map()
  const formulaUse = new Map()
  const silhouetteUse = new Map()
  const groundingUse = new Map()
  const shoeShapeUse = new Map()
  const rhythmUse = new Map()
  const topBottomUse = new Set()
  const pool = [...outfits]
  const formulaFor = (outfit) => wholeWardrobeFormulaFamily(outfit, options.candidatePieces, options.occasion)
  const hasUnusedAlternativeFormula = (formula) => pool.some(candidate => {
    const key = (candidate.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')
    if (selected.some(existing => (existing.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|') === key)) return false
    return formulaFor(candidate) !== formula
  })
  const exploratoryFamilies = new Set(['dress_grounding_shoe', 'soft_piece_structured_anchor', 'earthy_structured_separates'])
  const exploratory = bestWholeWardrobeRequirementCandidate(
    pool,
    selected,
    outfit => exploratoryFamilies.has(formulaFor(outfit)) || wholeWardrobeIsExploratory(outfit),
    options
  )
  if (exploratory) {
    selected.push(exploratory)
    const pieces = Array.isArray(exploratory.pieces) ? exploratory.pieces : []
    const top = pieces.find(p => wardrobeCategoryGroup(p) === 'top')
    const bottom = pieces.find(p => wardrobeCategoryGroup(p) === 'bottom')
    const shoe = pieces.find(p => wardrobeCategoryGroup(p) === 'shoes')
    const heroId = wholeWardrobeHeroPieceId(exploratory)
    const formula = formulaFor(exploratory)
    const silhouetteFamily = wholeWardrobeSilhouetteFromPieces(exploratory)
    const grounding = wholeWardrobeGroundingStrategy(exploratory)
    const shoeShape = wholeWardrobeShoeShape(exploratory)
    const rhythm = wholeWardrobeVisualRhythm(exploratory)
    const topBottomKey = wholeWardrobeTopBottomKey(exploratory)
    if (top) topUse.set(Number(top.id), 1)
    if (bottom) bottomUse.set(Number(bottom.id), 1)
    if (shoe) shoeUse.set(Number(shoe.id), 1)
    if (heroId) heroUse.set(heroId, 1)
    formulaUse.set(formula, 1)
    silhouetteUse.set(silhouetteFamily, 1)
    groundingUse.set(grounding, 1)
    shoeShapeUse.set(shoeShape, 1)
    rhythmUse.set(rhythm, 1)
    if (topBottomKey) topBottomUse.add(topBottomKey)
  }
  while (pool.length && selected.length < limit) {
    pool.sort((a, b) => wholeWardrobeDiversitySelectionScore(b, selected, options) - wholeWardrobeDiversitySelectionScore(a, selected, options))
    const outfit = pool.shift()
    const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
    const top = pieces.find(p => wardrobeCategoryGroup(p) === 'top')
    const bottom = pieces.find(p => wardrobeCategoryGroup(p) === 'bottom')
    const shoe = pieces.find(p => wardrobeCategoryGroup(p) === 'shoes')
    const heroId = wholeWardrobeHeroPieceId(outfit)
    const formula = formulaFor(outfit)
    const silhouetteFamily = wholeWardrobeSilhouetteFromPieces(outfit)
    const grounding = wholeWardrobeGroundingStrategy(outfit)
    const shoeShape = wholeWardrobeShoeShape(outfit)
    const rhythm = wholeWardrobeVisualRhythm(outfit)
    const topBottomKey = wholeWardrobeTopBottomKey(outfit)
    const outfitKey = (outfit.pieceIds || pieces.map(p => p.id)).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')
    if (selected.some(existing => (existing.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|') === outfitKey)) continue
    const topCount = top ? (topUse.get(Number(top.id)) || 0) : 0
    const bottomCount = bottom ? (bottomUse.get(Number(bottom.id)) || 0) : 0
    const shoeCount = shoe ? (shoeUse.get(Number(shoe.id)) || 0) : 0
    const heroCount = heroId ? (heroUse.get(heroId) || 0) : 0
    const formulaCount = formulaUse.get(formula) || 0
    const silhouetteCount = silhouetteUse.get(silhouetteFamily) || 0
    const groundingCount = groundingUse.get(grounding) || 0
    const shoeShapeCount = shoeShapeUse.get(shoeShape) || 0
    const rhythmCount = rhythmUse.get(rhythm) || 0
    if (top && topCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `too many outfits use ${top.name}` })
      continue
    }
    if (bottom && bottomCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `too many outfits use ${bottom.name}` })
      continue
    }
    if (topBottomKey && topBottomUse.has(topBottomKey)) {
      rejected.push({ label: outfit.label || 'unnamed', reason: 'exact top+bottom formula already used' })
      continue
    }
    if (heroId && heroCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: 'hero garment used more than twice' })
      continue
    }
    if (formula === 'compact_top_dark_column' && formulaCount >= 1 && hasUnusedAlternativeFormula(formula)) {
      rejected.push({ label: outfit.label || 'unnamed', reason: 'compact-top dark-column slot already used' })
      continue
    }
    if (formulaCount >= 1 && hasUnusedAlternativeFormula(formula)) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `duplicate ${formula} formula` })
      continue
    }
    if (silhouetteCount >= 1 && selected.length >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `duplicate ${silhouetteFamily} silhouette` })
      continue
    }
    if (groundingCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `too much ${grounding}` })
      continue
    }
    if (shoeShapeCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `too many ${shoeShape} shoes` })
      continue
    }
    if (rhythmCount >= 1 && selected.length >= 3) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `duplicate ${rhythm}` })
      continue
    }
    selected.push(outfit)
    if (top) topUse.set(Number(top.id), topCount + 1)
    if (bottom) bottomUse.set(Number(bottom.id), bottomCount + 1)
    if (shoe) shoeUse.set(Number(shoe.id), shoeCount + 1)
    if (heroId) heroUse.set(heroId, heroCount + 1)
    formulaUse.set(formula, formulaCount + 1)
    silhouetteUse.set(silhouetteFamily, silhouetteCount + 1)
    groundingUse.set(grounding, groundingCount + 1)
    shoeShapeUse.set(shoeShape, shoeShapeCount + 1)
    rhythmUse.set(rhythm, rhythmCount + 1)
    if (topBottomKey) topBottomUse.add(topBottomKey)
  }

  if (options.requireDress && !selected.some(wholeWardrobeHasDress)) {
    const dressCandidate = bestWholeWardrobeRequirementCandidate(outfits, selected, wholeWardrobeHasDress, options)
    if (dressCandidate) {
      const replaceIndex = selected.length >= limit ? selected.length - 1 : selected.length
      if (selected[replaceIndex]) rejected.push({ label: selected[replaceIndex].label || 'unnamed', reason: 'replaced to include a dress formula' })
      selected[replaceIndex] = dressCandidate
    }
  }

  if (options.requireNonGraphicTop && !selected.some(wholeWardrobeHasNonGraphicTop)) {
    const plainTopCandidate = bestWholeWardrobeRequirementCandidate(outfits, selected, wholeWardrobeHasNonGraphicTop, options)
    if (plainTopCandidate) {
      const replaceIndex = selected.length >= limit ? selected.length - 1 : selected.length
      if (selected[replaceIndex]) rejected.push({ label: selected[replaceIndex].label || 'unnamed', reason: 'replaced to include a non-graphic top formula' })
      selected[replaceIndex] = plainTopCandidate
    }
  }

  const targetFormulaCount = Math.min(3, limit, selected.length)
  let formulaDiversityAttempts = 0
  while (new Set(selected.map(formulaFor)).size < targetFormulaCount && formulaDiversityAttempts < limit * 3) {
    formulaDiversityAttempts += 1
    const usedFamilies = new Set(selected.map(formulaFor))
    const candidate = bestWholeWardrobeRequirementCandidate(
      outfits,
      selected,
      outfit => !usedFamilies.has(formulaFor(outfit)),
      options
    )
    if (!candidate) break
    const replaceIndex = selected
      .map((outfit, index) => ({ outfit, index, count: selected.filter(o => formulaFor(o) === formulaFor(outfit)).length }))
      .filter(item => item.count > 1 || formulaFor(item.outfit) === 'compact_top_dark_column')
      .sort((a, b) => wholeWardrobeDiversitySelectionScore(a.outfit, selected.filter((_, i) => i !== a.index), options) - wholeWardrobeDiversitySelectionScore(b.outfit, selected.filter((_, i) => i !== b.index), options))[0]?.index
    const targetIndex = Number.isInteger(replaceIndex) ? replaceIndex : selected.length - 1
    rejected.push({ label: selected[targetIndex]?.label || 'unnamed', reason: `replaced to include ${formulaFor(candidate)} formula` })
    selected[targetIndex] = candidate
  }

  return { outfits: selected, rejected }
}
export function isOutfitStructurallyValid(pieces = [], { requireShoes = true } = {}) {
  const groups = pieces.map(p => wardrobeCategoryGroup(p))
  const shoeCount = groups.filter(g => g === 'shoes').length
  const bottomCount = groups.filter(g => g === 'bottom').length
  const dressCount = groups.filter(g => g === 'dress').length
  const topCount = groups.filter(g => g === 'top').length

  if (shoeCount > 1) return false
  if (requireShoes && shoeCount !== 1) return false
  if (bottomCount > 1) return false
  if (dressCount > 1) return false

  if (dressCount === 1) {
    if (bottomCount > 0) return false
  } else {
    if (topCount < 1 || bottomCount !== 1) return false
  }
  return true
}

export function normalizeWholeWardrobeStrengths(outfits = []) {
  return outfits.map((outfit, index) => ({
    ...outfit,
    strength: index === 0 ? 'signature' : (index <= 2 ? 'strong' : 'usable')
  }))
}

export function locallyGateWholeWardrobeOutfits(outfits = [], limit = 5, { requireShoes = true, requireDress = false, requireNonGraphicTop = false, candidatePieces = [], occasion = 'casual', mood = '', season = '', weatherProfile = null } = {}) {
  const seen = new Set()
  const accepted = []
  const rejected = []
  for (const outfit of outfits) {
    const repaired = repairWholeWardrobeOutfit(outfit, candidatePieces, occasion, mood, { season, weatherProfile })
    const pieces = Array.isArray(repaired?.pieces) ? repaired.pieces : []
    const text = [repaired.label, repaired.dominantDirection, repaired.silhouette, repaired.reason, repaired.watchFor, ...pieces.map(p => p.name)].join(' ').toLowerCase()
    const key = (repaired.pieceIds || pieces.map(p => p.id)).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')

    if (!isOutfitStructurallyValid(pieces, { requireShoes })) {
      rejected.push({ label: repaired?.label || 'unnamed', reason: 'not a complete wardrobe outfit' })
      continue
    }
    if (seen.has(key)) {
      rejected.push({ label: repaired?.label || 'unnamed', reason: 'duplicate formula' })
      continue
    }

    if (/\b(flattering|elongating|slimming|confidence|draws attention upward|balance the body)\b/.test(text)) {
      rejected.push({ label: repaired?.label || 'unnamed', reason: 'uses body-shape/flattery framing' })
      continue
    }
    if (wholeWardrobeMissesMood(repaired, mood)) {
      rejected.push({ label: repaired?.label || 'unnamed', reason: 'misses requested boho mood' })
      continue
    }
    if ((text.match(/\b(wide|wide-leg|oversized|loose|flowing|voluminous|relaxed)\b/g) || []).length >= 3) {
      rejected.push({ label: repaired?.label || 'unnamed', reason: 'too much width/volume' })
      continue
    }
    if ((text.match(/\b(soft|gauzy|drape|drapey|cream|ivory|beige|taupe|sand)\b/g) || []).length >= 5 && !/\b(black|charcoal|espresso|boot|loafer|pointed|structured|graphic)\b/.test(text)) {
      rejected.push({ label: repaired?.label || 'unnamed', reason: 'soft neutral drift' })
      continue
    }

    seen.add(key)
    accepted.push(repaired)
  }
  const diverse = applyWholeWardrobeDiversity(sortByStylisticStrength(accepted, null), limit, { requireDress, requireNonGraphicTop, candidatePieces, occasion, mood })
  return {
    outfits: normalizeWholeWardrobeStrengths(diverse.outfits),
    rejected: [...rejected, ...diverse.rejected]
  }
}

export function formatWholeWardrobeOutfitFeedback({ occasion, season, mood, outfits = [], skip = '', saveableLearning = '' }) {
  const lines = [
    `**Generated strongest wardrobe outfits**`,
    `**Occasion / season:** ${occasion || 'casual'} / ${season || 'current season'}`,
    mood ? `**Mood:** ${mood}` : '',
    ''
  ].filter(Boolean)
  outfits.forEach((outfit, index) => {
    lines.push(`**${index === 0 || outfit.strength === 'signature' ? 'Signature / strongest outfit' : outfit.label || `Outfit ${index + 1}`}**`)
    if (outfit.missionLabel) lines.push(`Mission: ${outfit.missionLabel}`)
    if (outfit.label) lines.push(`Label: ${outfit.label}`)
    if (outfit.strength) lines.push(`Strength: ${outfit.strength}`)
    if (outfit.dominantDirection) lines.push(`Direction: ${outfit.dominantDirection}`)
    if (outfit.silhouette) lines.push(`Silhouette: ${outfit.silhouette}`)
    if (outfit.bestFor) lines.push(`Best for: ${outfit.bestFor}`)
    const pieces = Array.isArray(outfit.pieces) ? outfit.pieces.map(p => p?.name).filter(Boolean).join(' + ') : ''
    if (pieces) lines.push(`Pieces: ${pieces}`)
    const missing = Array.isArray(outfit.missingPieces) ? outfit.missingPieces.map(p => p?.name || p).filter(Boolean).join(' + ') : ''
    if (missing) lines.push(`Missing pieces: ${missing}`)
    if (outfit.reason) lines.push(`Why this works: ${outfit.reason}`)
    if (outfit.watchFor && outfit.watchFor !== 'none') lines.push(`Watch for: ${outfit.watchFor}`)
    lines.push('')
  })
  if (skip) {
    lines.push(`*Skipped directions:* ${skip}`)
    lines.push('')
  }
  if (saveableLearning) {
    lines.push(`**Saveable learning:** ${saveableLearning}`)
  }
  return lines.join('\n').trim()
}

export function buildOutfitMechanicsReason(outfit = {}, pieces = [], archetype = {}) {
  const byGroup = (group) => pieces.find(p => wardrobeCategoryGroup(p) === group)
  const top = byGroup('top')
  const bottom = byGroup('bottom')
  const dress = byGroup('dress')
  const shoe = byGroup('shoes')
  const layer = byGroup('outerwear')
  const printPiece = pieces.find(p => /\b(floral|print|graphic|stripe|pattern|abstract|tapestry)\b/.test(pieceNameBlob(p)))
  const softPiece = pieces.find(p => /\b(soft|gauzy|drape|linen|cashmere|knit|cream|ivory|oatmeal)\b/.test(pieceNameBlob(p)))
  const shoeText = shoe ? pieceNameBlob(shoe) : ''
  const sentences = []

  if (dress) {
    const support = layer ? `${layer.name} adds the structure around it` : shoe ? `${shoe.name} gives the one-piece line a grounded finish` : 'the supporting pieces need to stay clean'
    sentences.push(`${dress.name} carries the column, and ${support}.`)
  } else if (bottom) {
    const columnVerb = /\b(black|charcoal|dark|navy|denim|straight|trouser|column)\b/.test(pieceNameBlob(bottom)) ? 'creates the long base' : 'sets the lower proportion'
    const upperJob = top ? `${top.name} ${/\b(fitted|sleeveless|tank|shell|compact)\b/.test(pieceNameBlob(top)) ? 'keeps the upper half compact' : 'sets the upper shape'}` : 'the upper piece needs to stay controlled'
    sentences.push(`${bottom.name} ${columnVerb}, while ${upperJob}.`)
  } else if (top) {
    sentences.push(`${top.name} sets the upper anchor, so the remaining pieces need to keep the line grounded.`)
  }

  if (printPiece && printPiece !== top && printPiece !== bottom && printPiece !== dress) {
    sentences.push(`${printPiece.name} supplies the visual tension; the quiet support pieces keep it from turning into pattern stacking.`)
  } else if (printPiece) {
    sentences.push(`${printPiece.name} supplies the visual tension, so the surrounding pieces need to stay quieter.`)
  } else if (softPiece) {
    sentences.push(`${softPiece.name} brings the softness; the structured or dark pieces keep the formula from drifting loose.`)
  }

  if (shoe) {
    if (/\b(pointed|patent|mule|flat)\b/.test(shoeText)) sentences.push(`${shoe.name} keeps the finish sharp at the floor.`)
    else if (/\b(boot|bootie)\b/.test(shoeText)) sentences.push(`${shoe.name} gives the hem enough weight.`)
    else if (/\b(loafer|oxford)\b/.test(shoeText)) sentences.push(`${shoe.name} adds the tailored grounding.`)
    else sentences.push(`${shoe.name} grounds the outfit; keep it intentional rather than casual.`)
  } else if (archetype?.formulaFamily !== 'dress_grounding_shoe') {
    sentences.push('The shoe choice needs to add a clear anchor before this leaves the house.')
  }

  return sentences
    .join(' ')
    .replace(/\b(harmonious|flattering|sophisticated|balance|modernity|overall look|playful touch)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function bohoMoodLabelFromPieces(outfit = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const text = pieces.map(pieceTextBlob).join(' ')
  const modifier = wholeWardrobeGarmentModifier(pieces)
  let base = 'Modern Bohemian City'
  if (pieces.some(p => wardrobeCategoryGroup(p) === 'dress')) base = 'Grounded Bohemian Dress'
  else if (/\b(crochet|woven|raffia|rattan|cork|espadrille|basket|braided|artisan|embroidered|embroidery)\b/.test(text)) base = 'Artisan City Bohemian'
  else if (/\b(paisley|botanical|floral|abstract print|print)\b/.test(text)) base = 'Botanical Bohemian City'
  else if (/\b(cognac|rust|terracotta|ochre|mustard|olive|brown|tan|amber|earthy)\b/.test(text)) base = 'Earthy Bohemian City'
  return modifier ? `${base}: ${modifier}` : base
}

export function buildBohoOutfitReason(outfit = {}, pieces = [], occasion = 'city') {
  const hero = strongestBohoPiece(pieces)
  const shoe = pieces.find(p => wardrobeCategoryGroup(p) === 'shoes')
  const support = pieces.find(p => hero && Number(p.id) !== Number(hero.id) && wardrobeCategoryGroup(p) !== 'shoes')
  const heroTrait = bohoTraitForPiece(hero) || 'bohemian detail'
  const supportGroup = support ? wardrobeCategoryGroup(support) : ''
  const supportText = support
    ? supportGroup === 'bottom'
      ? `${support.name} sets the lower proportion so the bohemian detail has structure rather than sprawl.`
      : supportGroup === 'outerwear'
        ? `${support.name} adds the city frame around the softer bohemian element.`
        : `${support.name} keeps the outfit ${/\b(city|gallery|art|museum)\b/i.test(occasion) ? 'city-readable' : 'wearable'} without flattening the texture.`
    : ''
  const shoeText = shoe
    ? `${shoe.name} gives the outfit a practical grounded finish.`
    : 'Add a grounded shoe before treating this as complete.'
  return [
    hero ? `${hero.name} carries the bohemian read through ${heroTrait}.` : '',
    supportText,
    shoeText
  ].filter(Boolean).join(' ')
}

export function buildBohoWatch(outfit = {}, pieces = []) {
  const text = pieces.map(pieceTextBlob).join(' ')
  const printCount = (text.match(/\b(floral|paisley|botanical|abstract|graphic|print|pattern)\b/g) || []).length
  const softCount = (text.match(/\b(crochet|gauzy|drape|flowing|soft|tiered|ruffle)\b/g) || []).length
  if (printCount >= 2) return 'Keep any added layer quiet so the print mix stays intentional.'
  if (softCount >= 2) return 'Use a grounded shoe or structured support piece so the softness does not turn shapeless.'
  if (!pieces.some(p => wardrobeCategoryGroup(p) === 'shoes')) return 'Choose the shoe before judging the outfit; boho needs grounded finish, not just texture.'
  return 'Keep the bohemian detail as the clear thesis; avoid adding a second competing accent.'
}


