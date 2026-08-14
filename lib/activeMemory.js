import {
  FEEDBACK_BEHAVIOURS,
  REASONED_OUTFIT_VERDICT_TYPES,
  SCOPED_EVIDENCE_KINDS,
  canonicalFeedbackType,
  feedbackBehaviour,
} from './feedbackTaxonomy.js'
import { ownerConstraintProposalForFeedback } from './ownerConstraints.js'
import { ownerGuidanceApplicabilityForFeedback } from './ownerGuidance.js'

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

// "Whole wardrobe" (the generic context_name for a non-piece-scoped board) tells the owner nothing
// about which outfit a reaction was about. When the board never got its own distinct title either,
// fall back to the same piece list the board detail panel already shows under "Pieces".
function boardPieceSummary(payload) {
  const pieces = Array.isArray(payload?.board?.pieces) ? payload.board.pieces
    : Array.isArray(payload?.outfit?.pieces) ? payload.outfit.pieces : []
  const names = pieces.map(piece => piece?.name).filter(Boolean).slice(0, 3)
  return names.join(' + ')
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
    const ownerConstraintProposal = ownerConstraintProposalForFeedback(row)
    const ownerGuidanceApplicability = ownerGuidanceApplicabilityForFeedback(row)
    const guidanceReach = ownerGuidanceApplicability?.reach
    return {
      destination: 'owner_prompt',
      source,
      scope: guidanceReach === 'universal'
        ? 'Every styling request'
        : guidanceReach === 'garment'
          ? 'Matching garments'
          : guidanceReach === 'context'
            ? 'Matching situations'
            : guidanceReach === 'garment_context'
              ? 'Matching garments and situations'
              : guidanceReach === 'unresolved'
                ? 'Needs scope review'
                : 'Legacy broad delivery',
      effect: guidanceReach === 'unresolved'
        ? 'Stored for review; it does not currently reach styling prompts.'
        : 'Guides the stylist when its saved applicability matches; it is not a deterministic gate or score.',
      strength: guidanceReach === 'unresolved' ? 'review' : 'standing',
      ...(ownerConstraintProposal ? { ownerConstraintProposal } : {}),
      ...(ownerGuidanceApplicability ? { ownerGuidanceApplicability } : {}),
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
    const ownerComment = String(payload?.ownerComment || '').trim()
    // "Almost right"/"Not for me" with an owner-written reason are a diagnostic complaint about
    // this outfit, not formula reinforcement — the same shape as "Wrong choice for this outfit"
    // (a reaction plus an explicit reason), just not scoped to one verified garment. Checked before
    // positiveOutfitProvenance below so a reasonless "almost" keeps its prior display-only behaviour.
    if (REASONED_OUTFIT_VERDICT_TYPES.has(feedbackType) && ownerComment) {
      return {
        destination: 'provisional_context',
        source,
        scope: contextualScope(row, payload),
        effect: 'Available as provisional evidence with your own reason attached; it is not a score or standing preference.',
        strength: 'provisional',
        synthesisEligible: true,
        display: {
          // The board's own name ("Casual Daytime") is a far more useful anchor than the generic
          // context_name ("Whole wardrobe", or a bare piece name for a piece-focused board) — it's
          // what lets the owner recognize *which* outfit this was without opening it. When the board
          // never got a distinct title either, the piece list ("rust wrap dress + cream sneakers")
          // is still more useful than the generic "Whole wardrobe" fallback.
          title: payload?.board?.label || row.label || boardPieceSummary(payload) || row.context_name || 'This outfit',
          context: feedbackType === 'almost' ? 'Almost right, with a reason' : 'Not for me, with a reason',
          summary: ownerComment,
        },
      }
    }
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
