import {
  buildVisualComposerRoster,
  selectCandidatesForOutfitGeneration,
  wholeWardrobePieceTrustDecision,
} from './rules.js'
import { pieceFabricWeight, wardrobeCategoryGroup } from './attributes.js'
import { db } from '../db.js'
import { parseOwnerConstraintRow } from '../lib/ownerConstraints.js'

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

function findingAuthority(reason = '') {
  return /^(owner constraint |user-excluded for )/.test(String(reason || '')) ? 'owner' : 'engine'
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
  const anchorIds = new Set((policy.anchorPieceIds || []).map(Number))
  let ownerConstraints = policy.decisionOptions?.ownerConstraints ?? context.ownerConstraints
  if (!Array.isArray(ownerConstraints)) {
    try {
      ownerConstraints = db.prepare("SELECT * FROM owner_constraints WHERE status = 'active' ORDER BY id").all().map(parseOwnerConstraintRow)
    } catch {
      ownerConstraints = []
    }
  }
  const decisionContext = {
    ...context,
    ...(policy.decisionOptions || {}),
    ownerConstraints,
  }
  const decisions = (pieces || []).map(piece => {
    const verdict = wholeWardrobePieceTrustDecision(piece, decisionContext)
    const findings = (verdict.reasons || []).map(reason => ({
      pieceId: Number(piece.id),
      pieceName: piece.name || '',
      code: findingCode(reason),
      reason,
      kind: 'validity',
      authority: findingAuthority(reason),
      source: 'hard_gate',
    }))
    const bypassed = anchorIds.has(Number(piece.id)) && !verdict.allowed
    return {
      piece,
      pieceId: Number(piece.id),
      allowed: Boolean(verdict.allowed || bypassed),
      underlyingAllowed: Boolean(verdict.allowed),
      bypassed,
      supportOnly: Boolean(verdict.supportOnly),
      findings,
      reasons: findings.map(finding => finding.reason),
    }
  })

  const hotOuterwearCap = Number(policy.hotOuterwearCap)
  if (context.weatherProfile?.isHot && Number.isFinite(hotOuterwearCap) && hotOuterwearCap >= 0) {
    const weightScore = { light: 1, medium: 2, heavy: 3 }
    const capCandidates = decisions
      .filter(decision => decision.underlyingAllowed && wardrobeCategoryGroup(decision.piece) === 'outerwear')
      .sort((a, b) => {
        const weightDiff = (weightScore[pieceFabricWeight(a.piece)] || 2) - (weightScore[pieceFabricWeight(b.piece)] || 2)
        return weightDiff || a.pieceId - b.pieceId
      })
    for (const decision of capCandidates.slice(hotOuterwearCap)) {
      const finding = {
        pieceId: decision.pieceId,
        pieceName: decision.piece.name || '',
        code: 'hot_weather_outerwear_cap',
        reason: 'hot weather: outerwear cap',
        kind: 'capacity',
        authority: 'engine',
        source: 'automatic_use_pool',
      }
      decision.findings.push(finding)
      decision.reasons.push(finding.reason)
      decision.allowed = anchorIds.has(decision.pieceId)
      decision.bypassed = decision.allowed
    }
  }
  const decisionsById = new Map(decisions.map(decision => [decision.pieceId, decision]))
  const eligiblePieces = decisions.filter(decision => decision.allowed).map(decision => decision.piece)
  const excludedDecisions = decisions.filter(decision => !decision.allowed)
  const underlyingExcludedDecisions = decisions.filter(decision =>
    !decision.underlyingAllowed || decision.findings.some(finding => finding.kind === 'capacity')
  )
  const excludedProjection = decision => ({
    id: decision.pieceId,
    pieceId: decision.pieceId,
    name: decision.piece.name || '',
    category: decision.piece.category || '',
    reasons: decision.reasons,
    piece: decision.piece,
  })

  return {
    eligiblePieces,
    excludedPieces: excludedDecisions.map(excludedProjection),
    underlyingExcludedPieces: underlyingExcludedDecisions.map(excludedProjection),
    findings: decisions.flatMap(decision => decision.findings),
    decisions,
    decisionsById,
    eligibleIds: new Set(eligiblePieces.map(piece => Number(piece.id))),
    debug: {
      evaluatedCount: decisions.length,
      eligibleCount: eligiblePieces.length,
      excludedCount: excludedDecisions.length,
      underlyingExcludedCount: underlyingExcludedDecisions.length,
      bypassedAnchorCount: decisions.filter(decision => decision.bypassed).length,
      findingCounts: decisions.flatMap(decision => decision.findings).reduce((counts, finding) => {
        counts[finding.code] = (counts[finding.code] || 0) + 1
        return counts
      }, {}),
    },
  }
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
