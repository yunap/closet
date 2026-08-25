import {
  buildVisualComposerRoster,
  selectCandidatesForOutfitGeneration,
  wholeWardrobePieceTrustDecision,
} from './rules.js'
import { evaluateAutomaticUsePiecePoolCore } from './automaticUsePool.js'

const PRESENTATION_REASONS = new Set([
  'no photo',
  'accessories excluded from visual composer',
])

function findingKind(reason = '') {
  const value = String(reason || '').trim()
  if (value.startsWith('roster cap:')) return 'capacity'
  if (PRESENTATION_REASONS.has(value)) return 'presentation'
  return 'validity'
}

function findingCode(reason = '') {
  return String(reason || 'excluded').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

/**
 * Shared pool projection of the hard gate (`wholeWardrobePieceTrustDecision`).
 *
 * The findings always describe the underlying automatic-use verdict. An explicit anchor policy
 * may change disposition without erasing those findings, so every consumer observes the same
 * reason even when the user-requested premise is deliberately allowed through.
 */
export function evaluateAutomaticUsePiecePool({
  pieces = [],
  context = {},
  policy = {},
} = {}) {
  return evaluateAutomaticUsePiecePoolCore({
    pieces,
    context,
    policy,
    decidePiece: wholeWardrobePieceTrustDecision,
  })
}

/**
 * Selected-piece ranking adapter: one automatic-use evaluation feeds the existing anchor-specific
 * ranking strategy, so ranking can preserve its category quotas without re-running the hard gate.
 */
export function selectAutomaticUseCandidatesForOutfitGeneration({
  anchorPiece,
  pieces = [],
  limit = 30,
  context = {},
} = {}) {
  const eligibility = evaluateAutomaticUsePiecePool({ pieces, context })
  const rankedCandidates = selectCandidatesForOutfitGeneration(anchorPiece, pieces, limit, {
    ...context,
    eligibilityDecisionsById: eligibility.decisionsById,
  })
  return { rankedCandidates, eligibility }
}

/**
 * Shared authority for the finite visual-composer piece pool.
 *
 * `eligiblePieces` is the photo roster. `recoveryEligiblePieces` is deliberately broader: local
 * recovery may use pieces omitted only for presentation or capacity, but it may never reintroduce
 * a piece rejected by a weather, register, activity, footwear, metadata, or other validity gate.
 */
export function evaluateVisualComposerPiecePool({
  pieces = [],
  context = {},
  policy = {},
} = {}) {
  const result = buildVisualComposerRoster(pieces, {
    occasion: context.occasion,
    weatherProfile: context.weatherProfile,
    mood: context.mood,
    activity: context.activity,
    request: context.requestText ?? context.request,
    question: context.question,
    occasionProfile: context.occasionProfile,
    activityProfile: context.activityProfile,
    sessionInfluence: policy.sessionInfluence ?? null,
    maxImages: policy.maxImages,
    selectedPieceId: policy.selectedPieceId ?? null,
    includeAccessories: Boolean(policy.includeAccessories),
    recordMetadataTodos: policy.recordMetadataTodos !== false,
  })

  const pieceById = new Map((pieces || []).map(piece => [Number(piece.id), piece]))
  const eligibleIds = new Set(result.roster.map(piece => Number(piece.id)))
  const findings = result.excluded.map(entry => ({
    pieceId: Number(entry.pieceId),
    pieceName: entry.name || pieceById.get(Number(entry.pieceId))?.name || '',
    code: findingCode(entry.reason),
    reason: entry.reason || 'excluded',
    kind: findingKind(entry.reason),
    source: 'visual_composer_pool',
  }))
  const validityExcludedIds = new Set(
    findings.filter(finding => finding.kind === 'validity').map(finding => finding.pieceId)
  )
  const recoveryEligiblePieces = (pieces || []).filter(piece => !validityExcludedIds.has(Number(piece.id)))

  return {
    eligiblePieces: result.roster,
    recoveryEligiblePieces,
    excludedPieces: result.excluded.map(entry => ({
      ...entry,
      piece: pieceById.get(Number(entry.pieceId)) || null,
    })),
    findings,
    eligibleIds,
    recoveryEligibleIds: new Set(recoveryEligiblePieces.map(piece => Number(piece.id))),
    debug: {
      ...result.debug,
      findingCounts: findings.reduce((counts, finding) => {
        counts[finding.kind] = (counts[finding.kind] || 0) + 1
        return counts
      }, {}),
    },
  }
}
