import {
  FEEDBACK_BEHAVIOURS,
  SCOPED_EVIDENCE_KINDS,
  canonicalFeedbackType,
  feedbackBehaviour,
} from './feedbackTaxonomy.js'

function parsedPayload(row) {
  if (row?.payload && typeof row.payload === 'object') return row.payload
  try { return JSON.parse(row?.payload || '{}') || {} } catch { return {} }
}

function sourceFor(row) {
  if (row.feedback_type === 'piece_rule_receipt' || row.target_type === 'message') return 'Stylist chat'
  if (row.target_type === 'generated_visual_board') {
    return row.referenced_board_id ? 'Saved-board feedback' : 'Generated-board feedback'
  }
  if (row.target_type === 'whole_wardrobe_outfit' || row.target_type === 'board') return 'Outfit feedback'
  return 'Saved feedback'
}

function contextualScope(row, payload) {
  const forwardEvidence = payload.feedbackEvidence
  if (Number(forwardEvidence?.version) === 2 && forwardEvidence?.action === 'wrong_piece_for_outfit') {
    const context = forwardEvidence.context || {}
    const parts = [context.occasion, context.activity && context.activity !== 'none' ? context.activity : '', context.weather]
      .filter(Boolean)
    return parts.length ? `Outfit context: ${parts.join(' · ')}` : 'This outfit context'
  }
  const evidence = payload.scopedEvidence
  if (evidence?.kind === SCOPED_EVIDENCE_KINDS.GARMENT_CONTEXT_SUITABILITY) {
    const context = evidence.context || {}
    const parts = [context.occasion, context.activity && context.activity !== 'none' ? context.activity : '']
      .filter(Boolean)
    return parts.length ? `Occasion/activity: ${parts.join(' · ')}` : 'This outfit context'
  }
  if (evidence?.kind === SCOPED_EVIDENCE_KINDS.OUTFIT_LOGIC) {
    const context = evidence.context || {}
    const parts = [context.occasion, context.activity, context.season, context.mood].filter(Boolean)
    return parts.length ? `Styling context: ${parts.join(' · ')}` : 'This styling context'
  }
  return row.context_name ? `Context: ${row.context_name}` : 'This styling context'
}

export function activeMemoryMetadata(row = {}) {
  const payload = parsedPayload(row)
  const evidence = payload.feedbackEvidence
  const feedbackType = canonicalFeedbackType(row.feedback_type)
  const behaviour = feedbackBehaviour({ ...row, feedback_type: feedbackType, payload })
  const source = sourceFor(row)

  if (feedbackType === 'piece_rule_receipt') {
    return {
      destination: 'display_only',
      source,
      scope: `Garment: ${row.context_name || `Piece ${row.context_id || ''}`}`.trim(),
      effect: 'Guides styling prompts for this garment; this receipt is only its editable projection.',
      strength: 'standing',
    }
  }
  if (behaviour === FEEDBACK_BEHAVIOURS.OWNER_PROMPT) {
    return {
      destination: 'owner_prompt',
      source,
      scope: 'Every styling request',
      effect: 'Guides the stylist as a standing instruction; it is not a deterministic gate or score.',
      strength: 'standing',
    }
  }
  if (behaviour === FEEDBACK_BEHAVIOURS.PROVISIONAL_CONTEXT) {
    const subjectName = evidence?.subject?.name || payload?.pieceName || row.label || 'Garment'
    const outfitLabel = evidence?.context?.outfitLabel || payload?.outfit?.label || payload?.outfit?.title || 'this outfit'
    return {
      destination: 'provisional_context',
      source,
      scope: contextualScope(row, payload),
      effect: evidence?.explicitReason
        ? 'Available as provisional garment-scoped evidence; it is not a score or standing preference.'
        : 'Prevents blind repetition of this exact garment-and-outfit combination; no broader lesson can be inferred without a reason.',
      strength: 'provisional',
      synthesisEligible: Boolean(String(evidence?.explicitReason || '').trim()),
      ...(Number(evidence?.version) === 2 ? {
        display: {
          title: subjectName,
          context: `Wrong choice for ${outfitLabel}`,
          summary: evidence.explicitReason || 'Marked as the wrong choice for this outfit.',
        },
      } : {}),
    }
  }
  if (behaviour === FEEDBACK_BEHAVIOURS.RENDERER) {
    return {
      destination: 'renderer',
      source,
      scope: 'Image generation only',
      effect: 'Guides future rendered images; it does not influence garment or outfit selection.',
      strength: 'renderer-only',
    }
  }
  if (behaviour === FEEDBACK_BEHAVIOURS.STYLING_PROMPT) {
    const outfitLogic = payload?.scopedEvidence
    const positiveOutfitProvenance = ['signature', 'works', 'almost'].includes(feedbackType) ||
      (Number(outfitLogic?.version) === 1 &&
        [SCOPED_EVIDENCE_KINDS.OUTFIT_LOGIC, SCOPED_EVIDENCE_KINDS.LEGACY_OUTFIT_SNAPSHOT].includes(outfitLogic?.kind) &&
        ['signature', 'works', 'almost'].includes(String(outfitLogic?.verdict || feedbackType)))
    if (positiveOutfitProvenance) {
      return {
        destination: 'display_only',
        source,
        scope: contextualScope(row, payload),
        effect: 'Kept with its source outfit as provenance; it does not steer garment or formula selection.',
        strength: 'none',
        synthesisEligible: false,
      }
    }
    return {
      destination: 'styling_prompt',
      source,
      scope: contextualScope(row, payload),
      effect: 'Guides similar styling contexts without becoming a global garment preference.',
      strength: 'contextual',
      synthesisEligible: false,
    }
  }
  return {
    destination: 'display_only',
    source,
    scope: row.context_name ? `Context: ${row.context_name}` : 'Historical record',
    effect: 'Kept for history and display; it has no active behavioural reader.',
    strength: 'none',
  }
}
