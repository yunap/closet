import { db } from '../db.js'
import { parseOwnerConstraintRow } from '../lib/ownerConstraints.js'
import { pieceFabricWeight, wardrobeCategoryGroup } from './attributes.js'
import { pieceOuterwearCapabilityFacts } from './outerwearCapability.js'

function findingCode(reason = '') {
  return String(reason || 'excluded').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function findingAuthority(reason = '') {
  return /^(owner constraint |user-excluded for )/.test(String(reason || '')) ? 'owner' : 'engine'
}

// Dependency-neutral mechanics for the automatic-use pool. The public domain adapter in
// eligibility.js supplies wholeWardrobePieceTrustDecision; rules.js can supply the same verdict
// locally without importing eligibility.js back into its own dependency graph.
export function evaluateAutomaticUsePiecePoolCore({
  pieces = [],
  context = {},
  policy = {},
  decidePiece,
} = {}) {
  if (typeof decidePiece !== 'function') {
    throw new TypeError('evaluateAutomaticUsePiecePoolCore requires decidePiece')
  }

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
    const verdict = decidePiece(piece, decisionContext)
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
      // Slice C of docs/outerwear-weather-consolidation-spec.md. Canonical outerwear capability
      // facts ride along with every decision so search, selected generation, whole-wardrobe, plan
      // and capsule read one interpretation of outerwear_role/weather_protection instead of each
      // re-deriving it. Facts only: no verdict, no finding, and deliberately no effect on
      // `allowed`. Per [A2] a capability shortfall is evidence, never a pool exclusion — a shell
      // that under-insulates alone is still a legitimate candidate under a sweater, and only
      // Contract C (outfit level) may hard-fail. Attaching this as a field rather than a finding
      // makes that boundary structural: there is no code path here that could reject a piece.
      capability: pieceOuterwearCapabilityFacts(piece),
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
