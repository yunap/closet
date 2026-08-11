import { WRONG_PIECE_FOR_OUTFIT_FEEDBACK } from './feedbackTaxonomy.js'

export const FEEDBACK_EVIDENCE_ACTIONS = Object.freeze({
  WRONG_PIECE_FOR_OUTFIT: 'wrong_piece_for_outfit',
})

const clean = value => String(value || '').trim()
const positiveId = value => {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

const firstText = (...values) => values.map(clean).find(Boolean) || ''

// This envelope records what the user explicitly did and where. It deliberately does not infer
// fashion knowledge (formula, silhouette diagnosis, garment roles, etc.); interpreting those
// facts remains the styling model's responsibility.
export function buildFeedbackEvidence({ feedbackType, targetType, contextType, contextId, contextName, sourceSurface, payload = {} } = {}) {
  if (feedbackType !== WRONG_PIECE_FOR_OUTFIT_FEEDBACK) return null
  const outfit = payload?.outfit || {}
  const pieceId = positiveId(payload?.pieceId || payload?.piece_id)
  if (!pieceId) return null
  return {
    version: 2,
    action: FEEDBACK_EVIDENCE_ACTIONS.WRONG_PIECE_FOR_OUTFIT,
    verdict: 'negative',
    subject: {
      type: 'garment',
      pieceId,
      name: clean(payload?.pieceName || payload?.piece?.name),
      category: clean(payload?.pieceCategory || payload?.piece?.category),
    },
    context: {
      type: 'outfit',
      outfitLabel: clean(outfit?.label || outfit?.title),
      occasion: clean(payload?.occasion || outfit?.occasion || outfit?.bestFor),
      activity: clean(payload?.activity || outfit?.activity || 'none'),
      season: clean(payload?.season || outfit?.season),
      mood: clean(payload?.mood || outfit?.mood),
      weather: firstText(
        payload?.weatherContext,
        outfit?.weatherContext,
        outfit?.occasionContext,
        typeof payload?.weather === 'string' ? payload.weather : '',
        typeof outfit?.weather === 'string' ? outfit.weather : '',
      ),
    },
    source: {
      surface: clean(sourceSurface || payload?.sourceSurface) || 'unknown',
      threadId: clean(payload?.threadId) && payload.threadId !== 'new_chat' ? clean(payload.threadId) : null,
      messageIndex: Number.isInteger(payload?.messageIndex) ? payload.messageIndex : null,
      outfitIndex: Number.isInteger(payload?.outfitIndex) ? payload.outfitIndex : null,
      targetType: clean(targetType),
    },
    storageContext: {
      type: clean(contextType),
      id: positiveId(contextId),
      name: clean(contextName),
    },
    explicitReason: clean(payload?.explicitReason) || null,
    scope: 'outfit_context',
    authority: 'weak_contextual',
  }
}
