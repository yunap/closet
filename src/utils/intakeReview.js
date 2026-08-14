import { GATE_CRITICAL_FIELDS, missingGateFields } from '../../styling-engine/attributes.js'

export function confidenceMapForPiece(piece = {}) {
  return piece.style_profile_json?._confidence || piece._confidence || {}
}

const REVIEW_EDITABLE_FIELDS = [
  'category', 'colors', 'occasions', 'season', 'formality',
  'fabric_category', 'fabric_weight', 'fiber_content', 'heel_height', 'walk_support',
  'pattern_type', 'pattern_scale', 'pattern_complexity', 'reads_as',
  'neckline', 'sleeve_length', 'sleeve_shape', 'silhouette', 'length_hits_at', 'hem_finish',
  'fit_on_body', 'tuck_behavior', 'waistband_type', 'accessory_subtype', 'jewelry_type', 'necklace_length', 'bottom_subtype'
]

export function lowConfidenceFields(piece = {}) {
  const confidence = confidenceMapForPiece(piece)
  const category = String(piece.category || '').toLowerCase()
  const overrides = Array.isArray(piece.manual_overrides) ? piece.manual_overrides : []
  
  return Object.entries(confidence)
    .filter(([field, value]) => {
      if (overrides.includes(field)) return false
      if (String(value || '').toLowerCase() !== 'low') return false
      if (!REVIEW_EDITABLE_FIELDS.includes(field)) return false
      
      // Category specific visibility constraints
      if ((field === 'heel_height' || field === 'walk_support') && category !== 'shoes') return false
      if (field === 'neckline' && category !== 'top' && category !== 'dress') return false
      if ((field === 'sleeve_length' || field === 'sleeve_shape') && category !== 'top' && category !== 'dress' && category !== 'outerwear') return false
      if (field === 'fit_on_body' && !['top', 'bottom', 'dress', 'outerwear'].includes(category)) return false
      if (field === 'tuck_behavior' && category !== 'top') return false
      if (field === 'waistband_type' && category !== 'bottom') return false
      if (field === 'accessory_subtype' && category !== 'accessory') return false
      if (field === 'bottom_subtype' && category !== 'bottom') return false
      if (field === 'jewelry_type' && (category !== 'accessory' || piece.accessory_subtype !== 'jewelry')) return false
      if (field === 'necklace_length' && (category !== 'accessory' || piece.jewelry_type !== 'necklace')) return false

      return true
    })
    .map(([field]) => field)
}

export function intakeReviewSummary(piece = {}) {
  const lowFields = lowConfidenceFields(piece)
  const missingFields = missingGateFields(piece)
  return {
    lowFields,
    missingGateFields: missingFields,
    lowConfidenceCount: lowFields.length,
    missingGateCount: missingFields.length,
    gateCriticalFields: GATE_CRITICAL_FIELDS
  }
}

export function intakeReviewSummaryText(piece = {}) {
  const summary = intakeReviewSummary(piece)
  const parts = []
  if (summary.lowConfidenceCount) {
    parts.push(`${summary.lowConfidenceCount} low-confidence ${summary.lowConfidenceCount === 1 ? 'field' : 'fields'}`)
  }
  if (summary.missingGateCount) {
    parts.push(`${summary.missingGateCount} gate ${summary.missingGateCount === 1 ? 'field' : 'fields'} empty`)
  }
  return parts.length ? `Review: ${parts.join(', ')}` : 'Review: no gate gaps'
}
