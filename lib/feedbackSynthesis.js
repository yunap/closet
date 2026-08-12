import crypto from 'node:crypto'
import { POSITIVE_OUTFIT_LOGIC_TYPES, SCOPED_EVIDENCE_KINDS } from './feedbackTaxonomy.js'
import { resolveSeasonTerm } from './ownerConstraints.js'

const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
const clipped = (value, limit = 240) => clean(value).slice(0, limit)
// The composer's season selector defaults to the unresolved placeholder "current season" when the
// owner never picked one — recorded verbatim into feedback context at request time. Left as-is,
// that placeholder would surface as a literal, meaningless "season" a lesson could be scoped to.
// Resolve it against the reaction's own created_at (not "now") — the season that mattered was
// whatever it was when this evidence was recorded, not whatever it is when someone later edits it.
const evidenceReferenceDate = row => {
  const raw = row?.created_at
  if (!raw) return undefined
  const iso = /(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? raw : `${String(raw).replace(' ', 'T')}Z`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : date
}
const evidenceSeason = (rawSeason, row) => clipped(resolveSeasonTerm(rawSeason, evidenceReferenceDate(row)), 100)
const compactPiece = piece => ({
  id: Number(piece?.id) || null,
  name: clipped(piece?.name, 120),
  category: clipped(piece?.category, 60),
  sleeveType: clipped(piece?.sleeve_type, 80),
  fit: clipped(piece?.fit_on_body, 80),
  fabric: clipped(piece?.fabric_category, 80),
  readsAs: clipped(piece?.reads_as, 160),
})

export function compactSynthesisEvidenceRow(row = {}) {
  let payload = row.payload
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) } catch { payload = {} }
  }
  payload ||= {}
  const evidence = payload.feedbackEvidence || {}
  if (Number(evidence.version) === 2 && evidence.action === 'wrong_piece_for_outfit') {
    if (!clean(evidence.explicitReason)) return null
    const subjectId = Number(evidence?.subject?.pieceId) || null
    const outfitPieces = (Array.isArray(payload?.outfit?.pieces) ? payload.outfit.pieces : (Array.isArray(payload?.pieces) ? payload.pieces : []))
      .filter(piece => Number(piece?.id) !== subjectId)
      .slice(0, 8)
      .map(compactPiece)
    return {
      evidenceId: Number(row.id),
      evidenceKind: 'wrong_choice',
      action: 'wrong_piece_for_outfit',
      subject: compactPiece({ ...evidence.subject, id: subjectId }),
      outfit: {
        label: clipped(evidence?.context?.outfitLabel, 160),
        otherPieces: outfitPieces,
      },
      context: {
        occasion: clipped(evidence?.context?.occasion, 100),
        activity: clipped(evidence?.context?.activity, 100),
        season: evidenceSeason(evidence?.context?.season, row),
        mood: clipped(evidence?.context?.mood, 140),
        weather: clipped(evidence?.context?.weather, 220),
      },
      ownerReason: clipped(evidence?.explicitReason, 500) || null,
    }
  }

  const logicEvidence = payload.scopedEvidence
  const verdict = String(logicEvidence?.verdict || row.feedback_type || '').trim()
  if (Number(logicEvidence?.version) === 1 &&
      logicEvidence?.kind === SCOPED_EVIDENCE_KINDS.LEGACY_OUTFIT_SNAPSHOT &&
      POSITIVE_OUTFIT_LOGIC_TYPES.has(verdict)) {
    const snapshot = logicEvidence.snapshot || {}
    const pieces = (Array.isArray(snapshot.pieces) ? snapshot.pieces : []).slice(0, 10).map(piece => ({
      category: clipped(piece?.category, 60),
      sleeveType: clipped(piece?.sleeve_type, 80),
      fit: clipped(piece?.fit_on_body, 80),
      fabric: clipped(piece?.fabric_category, 80),
      readsAs: clipped(piece?.reads_as, 160),
    }))
    if (!clipped(snapshot.explanation, 500) && !pieces.some(piece => Object.values(piece).some(Boolean))) return null
    return {
      evidenceId: Number(row.id),
      evidenceKind: 'legacy_positive_board',
      verdict,
      generatedDescription: {
        title: clipped(snapshot.title, 160),
        explanation: clipped(snapshot.explanation, 500),
      },
      anonymousPieces: pieces,
      context: {
        occasion: clipped(logicEvidence?.context?.occasion, 100),
        activity: clipped(logicEvidence?.context?.activity, 100),
        season: evidenceSeason(logicEvidence?.context?.season, row),
        mood: '',
        weather: '',
      },
      ownerReason: null,
      sourceConfidence: 'legacy_generated_description',
    }
  }
  if (Number(logicEvidence?.version) !== 1 ||
      logicEvidence?.kind !== SCOPED_EVIDENCE_KINDS.OUTFIT_LOGIC ||
      !POSITIVE_OUTFIT_LOGIC_TYPES.has(verdict)) return null
  const logic = {
    formula: clipped(logicEvidence?.logic?.formula, 180),
    silhouette: clipped(logicEvidence?.logic?.silhouette, 180),
    direction: clipped(logicEvidence?.logic?.direction, 180),
    mood: clipped(logicEvidence?.logic?.mood, 180),
  }
  if (!Object.values(logic).some(Boolean)) return null
  return {
    evidenceId: Number(row.id),
    evidenceKind: 'positive_outfit_logic',
    verdict,
    logic,
    context: {
      occasion: clipped(logicEvidence?.context?.occasion, 100),
      activity: clipped(logicEvidence?.context?.activity, 100),
      season: evidenceSeason(logicEvidence?.context?.season, row),
      mood: clipped(logicEvidence?.context?.mood, 140),
      weather: '',
    },
    ownerReason: clipped(payload?.explicitReason, 500) || null,
  }
}

export function buildFeedbackSynthesisPreview(rows = [], {
  provider = '',
  model = '',
  maxItems = 12,
} = {}) {
  // Positive verdicts remain provenance while we evaluate whether any future learning route can
  // avoid reinforcing the same formulas. The current paid workflow is intentionally limited to
  // explicit, reasoned wrong-choice evidence.
  const evidence = rows.map(compactSynthesisEvidenceRow)
    .filter(item => item?.evidenceKind === 'wrong_choice')
    .slice(0, maxItems)
  const compactInput = JSON.stringify({ evidence }, null, 2)
  const inputHash = crypto.createHash('sha256').update(compactInput).digest('hex')
  // This is both the disclosed worst-case output allowance and the provider max_tokens value.
  // Keeping one number prevents a call from being authorized against a cheaper estimate than it
  // can actually spend, while leaving enough room for the structured tool response to close.
  const outputTokenCap = Math.min(3600, 900 + evidence.length * 225)
  const call = feedbackSynthesisCall(compactInput, outputTokenCap)
  const estimatedInputTokens = structuredRequestInputTokenUpperBound(call)
  return {
    feedbackIds: evidence.map(item => item.evidenceId),
    evidence,
    compactInput,
    inputHash,
    provider,
    model,
    estimatedInputTokens,
    estimatedOutputTokens: outputTokenCap,
    outputTokenCap,
  }
}

export const FEEDBACK_SYNTHESIS_DISPOSITIONS = Object.freeze([
  'personal_contextual_lesson',
  'garment_fact_correction',
  'general_styling_failure',
  'duplicate_or_refinement',
  'insufficient_evidence',
])

export const FEEDBACK_SYNTHESIS_APPLICABILITY_SCOPES = Object.freeze([
  'piece',
  'context',
  'piece_context',
])

const applicabilityList = (value, limit, maxLength) => [...new Set(
  (Array.isArray(value) ? value : [])
    .map(item => clipped(item, maxLength).toLowerCase())
    .filter(Boolean)
)].slice(0, limit)

const supportedByEvidence = (value, evidence = []) => {
  const normalized = clean(value).toLowerCase()
  if (!normalized) return false
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i')
  return evidence.some(item => {
    const searchable = [
      item?.ownerReason,
      item?.context?.occasion,
      item?.context?.activity,
      item?.context?.season,
      item?.context?.weather,
      // Legacy descriptions are generated, lower-confidence evidence, but exact context phrases
      // inside them may bound a reviewable draft. They never establish owner-authored rationale.
      item?.evidenceKind === 'legacy_positive_board' ? item?.generatedDescription?.title : '',
      item?.evidenceKind === 'legacy_positive_board' ? item?.generatedDescription?.explanation : '',
    ].map(clean).join(' ')
    return pattern.test(searchable)
  })
}

// The synthesis model may structure only applicability that is visible in the selected evidence.
// This is a mechanical anti-invention boundary: IDs must occur in the compact evidence and every
// context value must occur as a complete phrase in the owner reason or recorded context.
export function sanitizeSynthesisApplicability(value = {}, evidence = []) {
  const allowedPieceIds = new Set(evidence.flatMap(item => [
    Number(item?.subject?.id),
    ...(Array.isArray(item?.outfit?.otherPieces) ? item.outfit.otherPieces.map(piece => Number(piece?.id)) : []),
  ]).filter(id => Number.isInteger(id) && id > 0))
  const pieceIds = [...new Set((Array.isArray(value?.piece_ids) ? value.piece_ids : [])
    .map(Number)
    .filter(id => allowedPieceIds.has(id)))]
    .slice(0, 8)
  const supported = values => values.filter(item => supportedByEvidence(item, evidence))
  const occasions = supported(applicabilityList(value?.occasions, 6, 100))
  const activities = supported(applicabilityList(value?.activities, 6, 100))
  const seasons = supported(applicabilityList(value?.seasons, 4, 40))
  const weatherTerms = supported(applicabilityList(value?.weather_terms, 8, 60))
  const hasContext = Boolean(occasions.length || activities.length || seasons.length || weatherTerms.length)
  if (!pieceIds.length && !hasContext) return null
  const requestedScope = FEEDBACK_SYNTHESIS_APPLICABILITY_SCOPES.includes(value?.scope) ? value.scope : null
  const scope = requestedScope === 'piece' && pieceIds.length
    ? 'piece'
    : requestedScope === 'context' && hasContext
      ? 'context'
      : requestedScope === 'piece_context' && pieceIds.length && hasContext
        ? 'piece_context'
        : pieceIds.length && hasContext ? 'piece_context' : (pieceIds.length ? 'piece' : 'context')
  return {
    version: 1,
    scope,
    piece_ids: pieceIds,
    occasions,
    activities,
    seasons,
    weather_terms: weatherTerms,
  }
}

// The exact set of values an owner-edit of applicability is allowed to select from — every entry
// here is guaranteed to survive sanitizeSynthesisApplicability's supportedByEvidence check, because
// it was read from the same evidence.context fields that check matches against. This is what makes
// a checkbox-only editor safe: the option list and the validator share one source of truth, so the
// UI can never offer a choice the server would silently drop.
export function computeSynthesisApplicabilityOptions(evidence = []) {
  const pieces = new Map()
  for (const item of evidence) {
    const subjectId = Number(item?.subject?.id)
    if (Number.isInteger(subjectId) && subjectId > 0) pieces.set(subjectId, item.subject.name || `Piece #${subjectId}`)
    for (const piece of (Array.isArray(item?.outfit?.otherPieces) ? item.outfit.otherPieces : [])) {
      const pieceId = Number(piece?.id)
      if (Number.isInteger(pieceId) && pieceId > 0) pieces.set(pieceId, piece.name || `Piece #${pieceId}`)
    }
  }
  const collect = field => [...new Set(evidence.map(item => clean(item?.context?.[field]).toLowerCase()).filter(Boolean))]
  return {
    pieces: [...pieces.entries()].map(([id, name]) => ({ id, name })),
    occasions: collect('occasion'),
    activities: collect('activity'),
    seasons: collect('season'),
    weather: collect('weather'),
  }
}

export const FEEDBACK_SYNTHESIS_SYSTEM = `You are a constrained feedback-memory editor, not the styling authority.

The evidence contains either a reasoned "Wrong choice for this outfit", structured outfit logic, or a legacy generated-board snapshot from "This feels exactly like me", "Looks good", or "Almost right".
- For wrong_choice evidence, the owner's reason is the only authority for the cause. Without it, do not derive a transferable lesson.
- For positive_outfit_logic evidence, the verdict is the owner's signal; formula, silhouette, direction, mood and context are generated descriptions the owner reacted to, not owner-authored prose.
- For legacy_positive_board evidence, the verdict is the owner's signal, but the title, explanation and anonymous garment attributes were generated by the app before structured outfit logic existed. Treat them as lower-confidence clues. Extract a lesson only when the styling decision is clear; otherwise return insufficient_evidence.
- Extract only transferable styling logic. Never copy, reward or recommend the literal garments or original combination.
- A positive verdict confirms that this outfit worked; it does not by itself prove that the owner has a durable preference for its formula. Propose a personal/contextual lesson only when the evidence reveals an owner-specific, non-obvious choice that would materially change a future styling decision and that a competent stylist could not safely assume without this owner's reaction.
- Reject paraphrases of ordinary outfit competence. Statements such as "a relaxed top with a structured bottom looks cohesive", "dark lowers anchor soft uppers", or "quiet shoes support a printed outfit" are not new owner knowledge. Return insufficient_evidence with a concise explanation that the reaction confirms the outfit but adds no distinctive personal lesson.
- "signature" and "works" may support a bounded personal/contextual lesson only when they pass that owner-specific novelty test. "almost" is qualified evidence: a lone Almost reaction cannot become a positive rule unless an explicit owner reason says what worked; it may refine a lesson supported by selected positive evidence.
- For negative evidence, generic physical, practical, or styling knowledge is general_styling_failure, not personal memory. For positive evidence that merely confirms ordinary styling knowledge, use insufficient_evidence instead.
- A statement correcting one garment's stored stable property is garment_fact_correction and must remain a proposal. A physical incompatibility between two otherwise-correct garments is not a garment fact.
- Examples of general_styling_failure: absorbent canvas footwear selected for credible wet exposure; a fitted narrow-sleeved layer proposed over a long voluminous sleeve. These are reusable product/styling failures, not owner preferences and not rules attached to the literal garments.
- Only an explicitly owner-specific taste or contextual preference may be personal_contextual_lesson.
- Do not turn the model's own styling mistake into an owner preference.
- Keep proposed_text and boundary to one concise sentence each.
- For personal_contextual_lesson from wrong_choice evidence, use only garment IDs and complete context terms present in that evidence.
- For personal_contextual_lesson from positive_outfit_logic or legacy_positive_board evidence, piece_ids must be empty and scope must be context; use only complete context terms present in the selected evidence.
- Never mark a one-outfit reaction global.
- For every other disposition, return empty applicability lists.
- Every result must cite its source evidence IDs. Unrelated evidence remains separate.

Return only the structured response.`

export const feedbackSynthesisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    results: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source_feedback_ids: { type: 'array', minItems: 1, items: { type: 'integer' } },
          disposition: { type: 'string', enum: [...FEEDBACK_SYNTHESIS_DISPOSITIONS] },
          title: { type: 'string', maxLength: 140 },
          proposed_text: { type: 'string', maxLength: 600 },
          boundary: { type: 'string', maxLength: 300 },
          rationale: { type: 'string', maxLength: 500 },
          confidence: { type: 'string', enum: ['explicit_owner', 'bounded_context', 'insufficient'] },
          related_draft_id: { type: 'integer' },
          applicability: {
            type: 'object',
            additionalProperties: false,
            properties: {
              scope: { type: 'string', enum: [...FEEDBACK_SYNTHESIS_APPLICABILITY_SCOPES] },
              piece_ids: { type: 'array', maxItems: 8, items: { type: 'integer' } },
              occasions: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 100 } },
              activities: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 100 } },
              seasons: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 40 } },
              weather_terms: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 60 } },
            },
            required: ['scope', 'piece_ids', 'occasions', 'activities', 'seasons', 'weather_terms'],
          },
        },
        required: ['source_feedback_ids', 'disposition', 'title', 'proposed_text', 'boundary', 'rationale', 'confidence', 'related_draft_id', 'applicability'],
      },
    },
  },
  required: ['results'],
}

export const FEEDBACK_SYNTHESIS_TOOL_NAME = 'feedback_synthesis_drafts'
export const FEEDBACK_SYNTHESIS_TOOL_DESCRIPTION = 'Route provisional outfit feedback into reviewable drafts without inventing owner preferences.'

export function feedbackSynthesisCall(compactInput, maxTokens) {
  return {
    system: FEEDBACK_SYNTHESIS_SYSTEM,
    messages: [{ role: 'user', content: compactInput }],
    schema: feedbackSynthesisSchema,
    name: FEEDBACK_SYNTHESIS_TOOL_NAME,
    description: FEEDBACK_SYNTHESIS_TOOL_DESCRIPTION,
    maxTokens,
  }
}

export function structuredRequestInputTokenUpperBound(call) {
  // Count the complete logical request: instructions, evidence, schema, tool metadata and choice.
  // A UTF-8 byte is a deliberately conservative local ceiling for tokenizer-produced input
  // tokens. The fixed allowance covers provider-added message/tool framing that is not present in
  // our request object. Actual provider usage is retained separately after execution.
  const request = {
    system: call.system,
    messages: call.messages,
    tools: [{ name: call.name, description: call.description, input_schema: call.schema }],
    tool_choice: { type: 'tool', name: call.name },
  }
  return Buffer.byteLength(JSON.stringify(request), 'utf8') + 512
}
