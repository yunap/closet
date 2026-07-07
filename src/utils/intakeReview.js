import { GATE_CRITICAL_FIELDS, missingGateFields } from '../../styling-engine/attributes.js'

export function confidenceMapForPiece(piece = {}) {
  return piece.style_profile_json?._confidence || piece._confidence || {}
}

export function lowConfidenceFields(piece = {}) {
  const confidence = confidenceMapForPiece(piece)
  return Object.entries(confidence)
    .filter(([, value]) => String(value || '').toLowerCase() === 'low')
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
