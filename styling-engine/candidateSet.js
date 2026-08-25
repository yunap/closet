import { pieceRequiresBaseLayer, wardrobeCategoryGroup } from './attributes.js'
import { evaluateBaseLayerCandidate } from './outfitValidation.js'

const groupIs = group => piece => wardrobeCategoryGroup(piece) === group
const independentTop = piece => groupIs('top')(piece) && !pieceRequiresBaseLayer(piece)
const dependentTop = piece => groupIs('top')(piece) && pieceRequiresBaseLayer(piece)
const independentDress = piece => groupIs('dress')(piece) && !pieceRequiresBaseLayer(piece)
const dependentDress = piece => groupIs('dress')(piece) && pieceRequiresBaseLayer(piece)
const usableRequiredBase = piece => evaluateBaseLayerCandidate(piece).verdict !== 'incompatible'

const slot = (key, predicate) => ({ key, predicate })

const separatesPaths = [
  [slot('top', independentTop), slot('bottom', groupIs('bottom')), slot('shoes', groupIs('shoes'))],
  [slot('dependent_top', dependentTop), slot('required_base', usableRequiredBase), slot('bottom', groupIs('bottom')), slot('shoes', groupIs('shoes'))],
]
const dressPaths = [
  [slot('dress', independentDress), slot('shoes', groupIs('shoes'))],
  [slot('dependent_dress', dependentDress), slot('required_base', usableRequiredBase), slot('shoes', groupIs('shoes'))],
]

// The shared contract describes supply, not taste. Each caller supplies its own ranking; these
// alternatives only say what must remain possible after a hard cap.
export function completeOutfitSupplyRequirement({ anchorPiece = null, id = 'complete_outfit_path' } = {}) {
  const anchorGroup = wardrobeCategoryGroup(anchorPiece)
  let alternatives
  if (anchorGroup === 'top') {
    alternatives = pieceRequiresBaseLayer(anchorPiece)
      ? [[slot('required_base', usableRequiredBase), slot('bottom', groupIs('bottom')), slot('shoes', groupIs('shoes'))]]
      : [[slot('bottom', groupIs('bottom')), slot('shoes', groupIs('shoes'))]]
  } else if (anchorGroup === 'bottom') {
    alternatives = [
      [slot('top', independentTop), slot('shoes', groupIs('shoes'))],
      [slot('dependent_top', dependentTop), slot('required_base', usableRequiredBase), slot('shoes', groupIs('shoes'))],
    ]
  } else if (anchorGroup === 'dress') {
    alternatives = pieceRequiresBaseLayer(anchorPiece)
      ? [[slot('required_base', usableRequiredBase), slot('shoes', groupIs('shoes'))]]
      : [[slot('shoes', groupIs('shoes'))]]
  } else if (anchorGroup === 'shoes') {
    alternatives = [
      [slot('dress', independentDress)],
      [slot('dependent_dress', dependentDress), slot('required_base', usableRequiredBase)],
      [slot('top', independentTop), slot('bottom', groupIs('bottom'))],
      [slot('dependent_top', dependentTop), slot('required_base', usableRequiredBase), slot('bottom', groupIs('bottom'))],
    ]
  } else {
    alternatives = [...dressPaths, ...separatesPaths]
  }
  return { id, alternatives }
}

export function projectCandidateSetShortfall(report = null, { anchorPiece = null } = {}) {
  if (report?.complete !== false) return ''
  const capacityOnly = (report.shortfalls || []).every(shortfall =>
    shortfall?.code === 'required_structure_exceeds_capacity')
  const subject = anchorPiece
    ? `around ${anchorPiece.name || 'the selected item'}`
    : 'for this request'
  return capacityOnly
    ? `I couldn't retain a complete outfit path ${subject} within the candidate limit, so I stopped before composition instead of asking the stylist to work from an incomplete roster.`
    : `Your currently eligible wardrobe pieces do not contain a complete outfit path ${subject} (a dress or top + bottom, plus shoes, including any required coverage layer). I stopped before composition instead of inventing or forcing a weak outfit.`
}

// Restrict a structural requirement to the pieces admitted by a caller-specific context gate
// (for example, one capsule slot). The structure remains shared; only the eligible IDs vary.
export function restrictSupplyRequirement(requirement, allowedPieceIds = []) {
  const allowedIds = allowedPieceIds instanceof Set
    ? allowedPieceIds
    : new Set((allowedPieceIds || []).map(Number).filter(Boolean))
  return {
    ...requirement,
    alternatives: (requirement?.alternatives || []).map(alternative =>
      alternative.map(requirementSlot => ({
        ...requirementSlot,
        predicate: piece => allowedIds.has(Number(piece?.id)) && requirementSlot.predicate(piece),
      }))
    ),
  }
}

function uniquePieces(pieces = []) {
  const seen = new Set()
  return (Array.isArray(pieces) ? pieces : []).filter(piece => {
    const id = Number(piece?.id)
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function assignmentForAlternative(alternative = [], pieces = []) {
  const chosen = []
  const used = new Set()
  const assign = index => {
    if (index >= alternative.length) return true
    const requirementSlot = alternative[index]
    for (const piece of pieces) {
      const id = Number(piece.id)
      if (used.has(id) || !requirementSlot.predicate(piece)) continue
      used.add(id)
      chosen.push({ key: requirementSlot.key, piece })
      if (assign(index + 1)) return true
      chosen.pop()
      used.delete(id)
    }
    return false
  }
  return assign(0) ? chosen : null
}

function bestRequirementAssignment(requirement, pool, selectedIds, rankById) {
  const candidates = []
  const assignmentPool = [...pool].sort((a, b) => {
    const aSelected = selectedIds.has(Number(a.id)) ? 0 : 1
    const bSelected = selectedIds.has(Number(b.id)) ? 0 : 1
    return aSelected - bSelected ||
      (rankById.get(Number(a.id)) ?? pool.length) - (rankById.get(Number(b.id)) ?? pool.length)
  })
  for (const [index, alternative] of (requirement.alternatives || []).entries()) {
    const assignment = assignmentForAlternative(alternative, assignmentPool)
    if (!assignment) continue
    const added = assignment.filter(item => !selectedIds.has(Number(item.piece.id))).length
    const rank = assignment.reduce((sum, item) => sum + (rankById.get(Number(item.piece.id)) ?? pool.length), 0)
    candidates.push({ index, assignment, added, rank })
  }
  return candidates.sort((a, b) => a.added - b.added || a.rank - b.rank || a.index - b.index)[0] || null
}

export function buildCoveredCandidateSet({
  rankedPieces = [],
  initialSelection = [],
  capacity = Infinity,
  protectedPieceIds = [],
  requirements = [],
} = {}) {
  const pool = uniquePieces([...rankedPieces, ...initialSelection])
  const initial = uniquePieces(initialSelection)
  const hardCapacity = Math.max(0, Number.isFinite(Number(capacity)) ? Number(capacity) : pool.length)
  const rankById = new Map(pool.map((piece, index) => [Number(piece.id), index]))
  const pieceById = new Map(pool.map(piece => [Number(piece.id), piece]))
  const protectedIds = new Set((protectedPieceIds || []).map(Number).filter(Boolean))
  const mandatoryIds = new Set()
  const shortfalls = []
  let allCoveredByInitial = initial.length <= hardCapacity
  const initialIds = new Set(initial.map(piece => Number(piece.id)))

  for (const id of protectedIds) {
    if (pieceById.has(id)) mandatoryIds.add(id)
    else shortfalls.push({ code: 'protected_piece_unavailable', pieceId: id })
    if (!initialIds.has(id)) allCoveredByInitial = false
  }

  const requirementResults = []
  for (const requirement of requirements || []) {
    const selectedIds = new Set([...initial.map(piece => Number(piece.id)), ...mandatoryIds])
    const existing = bestRequirementAssignment(requirement, initial, selectedIds, rankById)
    const chosen = existing || bestRequirementAssignment(requirement, pool, selectedIds, rankById)
    if (!existing) allCoveredByInitial = false
    if (!chosen) {
      const result = { id: requirement.id, status: 'supply_shortfall', alternativeIndex: null, pieceIds: [] }
      requirementResults.push(result)
      shortfalls.push({ code: 'required_structure_unavailable', requirementId: requirement.id })
      continue
    }
    const chosenIds = chosen.assignment.map(item => Number(item.piece.id))
    for (const id of chosenIds) mandatoryIds.add(id)
    requirementResults.push({
      id: requirement.id,
      status: 'covered',
      alternativeIndex: chosen.index,
      pieceIds: chosenIds,
      slots: chosen.assignment.map(item => ({ key: item.key, pieceId: Number(item.piece.id) })),
    })
  }

  if (mandatoryIds.size > hardCapacity) {
    for (const result of requirementResults.filter(item => item.status === 'covered')) {
      result.status = 'capacity_shortfall'
    }
    shortfalls.push({
      code: 'required_structure_exceeds_capacity',
      requiredCount: mandatoryIds.size,
      capacity: hardCapacity,
    })
  }

  if (shortfalls.length) {
    const preserved = initial.slice(0, hardCapacity)
    return {
      pieces: preserved,
      report: {
        complete: false,
        capacity: hardCapacity,
        suppliedCount: pool.length,
        selectedCount: preserved.length,
        protectedPieceIds: [...protectedIds],
        requirementResults,
        shortfalls,
        addedForCoverageIds: [],
        removedByCoverageIds: initial.slice(hardCapacity).map(piece => Number(piece.id)),
      },
    }
  }

  if (allCoveredByInitial && shortfalls.length === 0) {
    return {
      pieces: initial,
      report: {
        complete: true,
        capacity: hardCapacity,
        suppliedCount: pool.length,
        selectedCount: initial.length,
        protectedPieceIds: [...protectedIds],
        requirementResults,
        shortfalls: [],
        addedForCoverageIds: [],
        removedByCoverageIds: [],
      },
    }
  }

  const chosenIds = new Set()
  const selected = []
  const add = piece => {
    const id = Number(piece?.id)
    if (!id || chosenIds.has(id) || selected.length >= hardCapacity) return
    chosenIds.add(id)
    selected.push(piece)
  }
  for (const piece of pool) if (mandatoryIds.has(Number(piece.id))) add(piece)
  for (const piece of initial) add(piece)
  for (const piece of pool) add(piece)

  const complete = shortfalls.length === 0 && requirementResults.every(result => result.status === 'covered')
  return {
    pieces: selected,
    report: {
      complete,
      capacity: hardCapacity,
      suppliedCount: pool.length,
      selectedCount: selected.length,
      protectedPieceIds: [...protectedIds],
      requirementResults,
      shortfalls,
      addedForCoverageIds: selected
        .map(piece => Number(piece.id))
        .filter(id => mandatoryIds.has(id) && !initial.some(piece => Number(piece.id) === id)),
      removedByCoverageIds: initial
        .map(piece => Number(piece.id))
        .filter(id => !chosenIds.has(id)),
    },
  }
}
