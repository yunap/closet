import { pieceRequiresBaseLayer, wardrobeCategoryGroup } from './attributes.js'
import { evaluateBaseLayerCandidate, evaluateWearableOutfit } from './outfitValidation.js'
import { resolveExposureContext } from './exposure.js'
import { requiredThermalEndpointBands, compareThermalFit } from './thermalDemand.js'
import { outfitRangeCoverage, outfitThermalContribution } from './outfitThermalContribution.js'
import { garmentWarmthLevel } from './garmentWarmth.js'

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

const SYSTEM_ROSTER_TARGET_PATHS = 4
const SYSTEM_ROSTER_TOTAL_IMAGE_CAP = 36
const SYSTEM_ROSTER_CATEGORY_IMAGE_CAP = 6
const SYSTEM_ROSTER_FRONTIER_CAPS = {
  top: 12,
  dependentTop: 6,
  base: 6,
  bottom: 12,
  dress: 12,
  dependentDress: 6,
  shoes: 6,
  outerwear: 24,
}

function rolePiece(piece, role) {
  return { ...piece, role, anchor: false }
}

function pieceHasPhoto(piece = {}) {
  return Boolean(piece.photo || piece.worn_photo)
}

function physicalPieceFacets(piece = {}) {
  const group = wardrobeCategoryGroup(piece) || piece.category || 'other'
  const values = {
    warmth: garmentWarmthLevel(piece) || 'unknown',
    insulation: Array.isArray(piece.insulating_layer_materials)
      ? (piece.insulating_layer_materials.length ? 'present' : 'none')
      : 'unknown',
    interior: piece.interior_construction || 'unknown',
    fabric: piece.fabric_category || 'unknown',
    weight: piece.fabric_weight || 'unknown',
    removable: group === 'outerwear' ? 'yes' : 'no',
    protection: Array.isArray(piece.weather_protection)
      ? [...piece.weather_protection].sort().join('+') || 'none'
      : 'unknown',
    sleeve: piece.sleeve_length || 'unknown',
    sleeveShape: piece.sleeve_shape || 'unknown',
    hem: piece.length_hits_at || 'unknown',
    opacity: piece.opacity || 'unknown',
    needsBase: pieceRequiresBaseLayer(piece) ? 'yes' : 'no',
    shoeCoverage: group === 'shoes' ? (piece.length_hits_at || 'unknown') : 'n/a',
    walkSupport: group === 'shoes' ? (piece.walk_support || 'unknown') : 'n/a',
  }
  return Object.entries(values).map(([key, value]) => `${group}:${key}=${value}`)
}

// The production join does not need every identity-equivalent Cartesian permutation in memory.
// Keep a bounded mechanical frontier that greedily covers structured construction facts; the full
// hard-eligible identity set remains in eligiblePieceIndex. Small fixtures below these ceilings are
// exhaustive, which lets tests compare the optimized and naive enumerators exactly.
function constructionFrontier(pieces = [], limit = pieces.length) {
  const remaining = [...pieces]
  const selected = []
  const covered = new Set()
  while (selected.length < limit && remaining.length) {
    remaining.sort((a, b) => {
      const aNew = physicalPieceFacets(a).filter(facet => !covered.has(facet)).length
      const bNew = physicalPieceFacets(b).filter(facet => !covered.has(facet)).length
      return bNew - aNew
    })
    const chosen = remaining.shift()
    selected.push(chosen)
    for (const facet of physicalPieceFacets(chosen)) covered.add(facet)
  }
  return selected
}

function pathThermalState(pieces, weatherContext = null) {
  const weatherProfile = weatherContext?.weatherProfile || null
  if (!weatherProfile) {
    return {
      applicable: false,
      known: false,
      coldFit: 'unknown',
      warmFit: 'unknown',
      distance: null,
      rank: 0,
      variableDemand: false,
      wearingStates: null,
    }
  }
  const exposure = resolveExposureContext({
    environment: weatherContext?.environment || 'outdoor',
    activity: weatherContext?.activity,
  }, weatherProfile)
  const endpoints = requiredThermalEndpointBands(exposure)
  if (!endpoints.cold.level || !endpoints.warm.level) {
    return {
      applicable: false,
      known: false,
      coldFit: 'unknown',
      warmFit: 'unknown',
      distance: null,
      rank: 0,
      variableDemand: false,
      wearingStates: null,
    }
  }

  const outerwear = pieces.filter(piece => wardrobeCategoryGroup(piece) === 'outerwear')
  let coldEnd
  let warmEnd
  let unknownPresent
  let removedPieceId = null
  let warmPieceIds = pieces.map(piece => Number(piece.id))
  if (outerwear.length) {
    const range = outfitRangeCoverage(pieces, endpoints.cold, endpoints.warm, compareThermalFit)
    const preferredRemoval = range.candidates.find(candidate =>
      Number(candidate.removedPieceId) === Number(outerwear[outerwear.length - 1]?.id)) || range.candidates[0]
    coldEnd = preferredRemoval?.coldEnd || compareThermalFit(range.full.withLayer, endpoints.cold)
    warmEnd = preferredRemoval?.warmEnd || compareThermalFit(range.full.upperBase || range.full.base, endpoints.warm)
    unknownPresent = preferredRemoval ? preferredRemoval.unknownPresent : range.unknownPresent
    removedPieceId = preferredRemoval?.removedPieceId ?? null
    if (removedPieceId) warmPieceIds = pieces.filter(piece => Number(piece.id) !== Number(removedPieceId)).map(piece => Number(piece.id))
  } else {
    const contribution = outfitThermalContribution(pieces)
    coldEnd = compareThermalFit(contribution.withLayer, endpoints.cold)
    warmEnd = compareThermalFit(contribution.withLayer, endpoints.warm)
    unknownPresent = contribution.unknown.base || contribution.unknown.removable
  }

  const fits = [coldEnd?.fit || 'unknown', warmEnd?.fit || 'unknown']
  const known = !unknownPresent && !fits.includes('unknown')
  const rank = !known ? 3
    : fits.includes('undershoot') ? 4
      : fits.includes('substantial_overshoot') ? 2
        : fits.includes('overshoot') ? 1
          : 0
  const distances = [coldEnd?.distance, warmEnd?.distance].filter(Number.isFinite)
  return {
    applicable: true,
    known,
    coldFit: coldEnd?.fit || 'unknown',
    warmFit: warmEnd?.fit || 'unknown',
    distance: distances.length ? distances.reduce((sum, value) => sum + Math.abs(value), 0) : null,
    rank,
    variableDemand: endpoints.cold.level !== endpoints.warm.level,
    wearingStates: {
      cold: {
        piece_ids: pieces.map(piece => Number(piece.id)),
        thermal: coldEnd?.fit || 'unknown',
      },
      warm: {
        removed_piece_id: removedPieceId ? Number(removedPieceId) : null,
        piece_ids: warmPieceIds,
        thermal: warmEnd?.fit || 'unknown',
      },
    },
  }
}

function systemPathCandidate(pieces, sequence, context) {
  const validation = evaluateWearableOutfit(pieces, {
    roleAware: true,
    includeLayerDirections: true,
    seenPieceIds: [],
    weatherContext: context.weatherProfile ? {
      weatherProfile: context.weatherProfile,
      activity: context.activity,
      environment: context.environment,
      requireThermalAdequacy: context.layerRequired,
    } : null,
  })
  const thermal = pathThermalState(pieces, context.weatherProfile ? context : null)
  const unresolved = validation.unresolvedPairs.length > 0 || (thermal.applicable && !thermal.known)
  const outerwear = pieces.find(piece => wardrobeCategoryGroup(piece) === 'outerwear')
  const lead = outerwear || pieces.find(piece => ['dress', 'top'].includes(wardrobeCategoryGroup(piece)))
  return {
    pieces,
    pieceIds: pieces.map(piece => Number(piece.id)),
    sequence,
    hardValid: validation.hardValid,
    hardFindingCodes: validation.hardFindings.map(finding => finding.code),
    evidenceState: unresolved ? 'unknown' : 'known',
    thermal,
    leadPieceId: Number(lead?.id) || null,
    facets: new Set(pieces.flatMap(physicalPieceFacets)),
  }
}

function betterSystemPath(a, b) {
  if (!b) return true
  if (a.thermal.rank !== b.thermal.rank) return a.thermal.rank < b.thermal.rank
  const aDistance = Number.isFinite(a.thermal.distance) ? a.thermal.distance : Infinity
  const bDistance = Number.isFinite(b.thermal.distance) ? b.thermal.distance : Infinity
  if (aDistance !== bDistance) return aDistance < bDistance
  return a.sequence < b.sequence
}

function pathFitsImageBudget(path, selectedIds, categoryCounts, { totalCap, categoryCap }) {
  let addedTotal = 0
  const additions = new Map()
  for (const piece of path.pieces) {
    const id = Number(piece.id)
    if (selectedIds.has(id) || !pieceHasPhoto(piece)) continue
    const category = wardrobeCategoryGroup(piece) || piece.category || 'other'
    addedTotal += 1
    additions.set(category, (additions.get(category) || 0) + 1)
  }
  const currentTotal = [...categoryCounts.values()].reduce((sum, count) => sum + count, 0)
  if (currentTotal + addedTotal > totalCap) return false
  for (const [category, count] of additions) {
    if ((categoryCounts.get(category) || 0) + count > categoryCap) return false
  }
  return true
}

function addPathImages(path, selectedIds, selectedPhotoIds, categoryCounts) {
  for (const piece of path.pieces) {
    const id = Number(piece.id)
    selectedIds.add(id)
    if (selectedPhotoIds.has(id) || !pieceHasPhoto(piece)) continue
    selectedPhotoIds.add(id)
    const category = wardrobeCategoryGroup(piece) || piece.category || 'other'
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1)
  }
}

function selectSystemPaths(candidates, options = {}) {
  const target = options.targetPaths || SYSTEM_ROSTER_TARGET_PATHS
  const totalCap = options.totalImageCap || SYSTEM_ROSTER_TOTAL_IMAGE_CAP
  const categoryCap = options.categoryImageCap || SYSTEM_ROSTER_CATEGORY_IMAGE_CAP
  const remaining = [...candidates]
  const selected = []
  const selectedIds = new Set()
  const selectedPhotoIds = new Set()
  const coveredFacets = new Set()
  const categoryCounts = new Map()
  const skippedForBudget = []
  const selectionReasons = []
  const weatherApplicable = candidates.some(candidate => candidate.thermal.applicable)

  const choose = (chosen, reason) => {
    const newFacets = [...chosen.facets].filter(facet => !coveredFacets.has(facet))
    selected.push(chosen)
    selectionReasons.push({
      sequence: chosen.sequence,
      reason,
      new_facets: newFacets,
    })
    for (const facet of chosen.facets) coveredFacets.add(facet)
    addPathImages(chosen, selectedIds, selectedPhotoIds, categoryCounts)
    const chosenIndex = remaining.indexOf(chosen)
    if (chosenIndex >= 0) remaining.splice(chosenIndex, 1)
  }

  while (selected.length < target && remaining.length) {
    // With no resolved thermal demand, the weather dimension is a strict no-op. Preserve the
    // structural enumerator's stable order rather than letting construction diversity masquerade
    // as a weather judgment.
    if (!weatherApplicable) {
      const chosen = remaining.find(candidate =>
        pathFitsImageBudget(candidate, selectedPhotoIds, categoryCounts, { totalCap, categoryCap }))
      if (!chosen) break
      choose(chosen, 'stable structural order; no resolved thermal demand')
      continue
    }
    const minimumRank = Math.min(...remaining.map(candidate => candidate.thermal.rank))
    const sameRank = remaining.filter(candidate => candidate.thermal.rank === minimumRank)
    const fitting = sameRank.filter(candidate => {
      const fits = pathFitsImageBudget(candidate, selectedPhotoIds, categoryCounts, { totalCap, categoryCap })
      if (!fits) skippedForBudget.push(candidate)
      return fits
    })
    if (!fitting.length) {
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        if (remaining[index].thermal.rank === minimumRank) remaining.splice(index, 1)
      }
      continue
    }
    fitting.sort((a, b) => {
      const aDistance = Number.isFinite(a.thermal.distance) ? a.thermal.distance : Infinity
      const bDistance = Number.isFinite(b.thermal.distance) ? b.thermal.distance : Infinity
      if (aDistance !== bDistance) return aDistance - bDistance
      const aNewFacets = [...a.facets].filter(facet => !coveredFacets.has(facet)).length
      const bNewFacets = [...b.facets].filter(facet => !coveredFacets.has(facet)).length
      if (aNewFacets !== bNewFacets) return bNewFacets - aNewFacets
      return a.sequence - b.sequence
    })
    const chosen = fitting[0]
    choose(chosen, selected.length === 0
      ? 'best known thermal disposition and nearest fit'
      : 'best thermal disposition with new factual construction coverage')
  }

  // Keep one observable upper boundary when the wardrobe supplies it. This makes a materially
  // warmer construction visible without allowing it to crowd all adequate systems out. Replace
  // only the final selected path, and only when the boundary itself fits atomically.
  const overshootBoundary = weatherApplicable && target >= 2 && candidates.some(candidate => candidate.thermal.variableDemand)
    ? candidates
        .filter(candidate => [1, 2].includes(candidate.thermal.rank) && !selected.includes(candidate))
        .sort((a, b) => a.thermal.rank - b.thermal.rank ||
          (Number.isFinite(a.thermal.distance) ? a.thermal.distance : Infinity) -
            (Number.isFinite(b.thermal.distance) ? b.thermal.distance : Infinity) ||
          a.sequence - b.sequence)
        .find(candidate => {
          const retained = selected.slice(0, Math.max(0, target - 1))
          const ids = new Set()
          const photoIds = new Set()
          const counts = new Map()
          for (const path of retained) addPathImages(path, ids, photoIds, counts)
          return pathFitsImageBudget(candidate, photoIds, counts, { totalCap, categoryCap })
        })
    : null
  if (overshootBoundary && selected.length >= target) {
    const retained = selected.slice(0, target - 1)
    const retainedFacets = new Set(retained.flatMap(path => [...path.facets]))
    const boundaryNewFacets = [...overshootBoundary.facets].filter(facet => !retainedFacets.has(facet))
    selected.length = 0
    selectedIds.clear()
    selectedPhotoIds.clear()
    categoryCounts.clear()
    for (const path of retained) {
      selected.push(path)
      addPathImages(path, selectedIds, selectedPhotoIds, categoryCounts)
    }
    selected.push(overshootBoundary)
    addPathImages(overshootBoundary, selectedIds, selectedPhotoIds, categoryCounts)
    selectionReasons.length = target - 1
    selectionReasons.push({
      sequence: overshootBoundary.sequence,
      reason: 'limited warmer boundary after adequate systems',
      new_facets: boundaryNewFacets,
    })
  }

  return {
    selected,
    visualPieceIds: [...selectedIds],
    visualPhotoIds: [...selectedPhotoIds],
    categoryImageCounts: Object.fromEntries(categoryCounts),
    skippedForBudgetCount: new Set(skippedForBudget.map(path => path.sequence)).size,
    selectionReasons,
  }
}

function compactEligiblePiece(piece = {}) {
  return {
    id: Number(piece.id),
    name: piece.name,
    category: wardrobeCategoryGroup(piece) || piece.category,
    thermal: garmentWarmthLevel(piece) || 'unknown',
    insulating_layer: Array.isArray(piece.insulating_layer_materials)
      ? (piece.insulating_layer_materials.length ? 'present' : 'none')
      : 'unknown',
    interior: piece.interior_construction || 'unknown',
    removable: wardrobeCategoryGroup(piece) === 'outerwear',
    sleeve_length: piece.sleeve_length || undefined,
    sleeve_shape: piece.sleeve_shape || undefined,
    length_hits_at: piece.length_hits_at || undefined,
    opacity: piece.opacity || undefined,
    needs_base: pieceRequiresBaseLayer(piece),
    weather_protection: piece.weather_protection || [],
    walk_support: piece.walk_support || undefined,
  }
}

/**
 * Build a one-outfit evidence roster from complete mechanically feasible systems.
 * The input is already the complete hard-eligible search pool; this function never resolves
 * context, never infers garment meaning from text, and never applies aesthetic judgment.
 */
export function buildSystemAwareWeatherRoster({
  pieces = [],
  weatherProfile = null,
  activity = '',
  environment = 'outdoor',
  layerRequired = false,
  targetPaths = SYSTEM_ROSTER_TARGET_PATHS,
  totalImageCap = SYSTEM_ROSTER_TOTAL_IMAGE_CAP,
  categoryImageCap = SYSTEM_ROSTER_CATEGORY_IMAGE_CAP,
} = {}) {
  const eligible = uniquePieces(pieces)
  const byGroup = group => eligible.filter(piece => wardrobeCategoryGroup(piece) === group)
  const allTops = byGroup('top')
  const allBottoms = byGroup('bottom')
  const allDresses = byGroup('dress')
  const allShoes = byGroup('shoes')
  const allOuterwear = byGroup('outerwear')
  const allBases = allTops.filter(usableRequiredBase)
  const allIndependentTops = allTops.filter(piece => !pieceRequiresBaseLayer(piece))
  const allDependentTops = allTops.filter(pieceRequiresBaseLayer)
  const allIndependentDresses = allDresses.filter(piece => !pieceRequiresBaseLayer(piece))
  const allDependentDresses = allDresses.filter(pieceRequiresBaseLayer)
  const independentTops = constructionFrontier(allIndependentTops, SYSTEM_ROSTER_FRONTIER_CAPS.top)
  const dependentTops = constructionFrontier(allDependentTops, SYSTEM_ROSTER_FRONTIER_CAPS.dependentTop)
  const bases = constructionFrontier(allBases, SYSTEM_ROSTER_FRONTIER_CAPS.base)
  const bottoms = constructionFrontier(allBottoms, SYSTEM_ROSTER_FRONTIER_CAPS.bottom)
  const independentDresses = constructionFrontier(allIndependentDresses, SYSTEM_ROSTER_FRONTIER_CAPS.dress)
  const dependentDresses = constructionFrontier(allDependentDresses, SYSTEM_ROSTER_FRONTIER_CAPS.dependentDress)
  const shoes = constructionFrontier(allShoes, SYSTEM_ROSTER_FRONTIER_CAPS.shoes)
  const outerwear = constructionFrontier(allOuterwear, SYSTEM_ROSTER_FRONTIER_CAPS.outerwear)
  const pathLayers = layerRequired ? outerwear : [null, ...outerwear]
  const logicalLayerCount = layerRequired ? allOuterwear.length : 1 + allOuterwear.length
  const logicalCandidatePathCount = allShoes.length * logicalLayerCount * (
    allIndependentDresses.length +
    (allDependentDresses.length * allBases.length) +
    (allIndependentTops.length * allBottoms.length) +
    (allDependentTops.length * allBases.length * allBottoms.length)
  )
  const hardFailureCounts = new Map()
  const bestByLead = new Map()
  const bestBySignature = new Map()
  const stableStructuralCandidates = []
  let candidatePathCount = 0
  let knownFeasiblePathCount = 0
  let unknownPathCount = 0
  let hardFailedPathCount = 0
  let sequence = 0

  const consider = clothingPieces => {
    if (!shoes.length) return
    // Shoes have already survived the shared piece-level activity/weather gates, and none of the
    // outfit-level structural, dependency, layer-direction, construction, or thermal stages reads
    // footwear against another garment. Evaluate those shared stages once for the clothing system,
    // then project every eligible shoe identity through that same verdict. If an outfit-level
    // shoe-pair contract is ever added, this optimization must be retired in favor of that owner.
    const first = systemPathCandidate([...clothingPieces, rolePiece(shoes[0], 'shoes')], sequence, {
      weatherProfile,
      activity,
      environment,
      layerRequired,
    })
    for (const shoe of shoes) {
      const shoePiece = rolePiece(shoe, 'shoes')
      const pieces = [...clothingPieces, shoePiece]
      const pieceIds = pieces.map(piece => Number(piece.id))
      const thermal = first.thermal.applicable
        ? {
          ...first.thermal,
          wearingStates: {
            cold: { ...first.thermal.wearingStates.cold, piece_ids: pieceIds },
            warm: {
              ...first.thermal.wearingStates.warm,
              piece_ids: pieceIds.filter(id => id !== first.thermal.wearingStates.warm.removed_piece_id),
            },
          },
        }
        : first.thermal
      const path = {
        ...first,
        pieces,
        pieceIds,
        thermal,
        sequence,
        facets: new Set(pieces.flatMap(physicalPieceFacets)),
      }
      sequence += 1
      candidatePathCount += 1
      if (!path.hardValid) {
        hardFailedPathCount += 1
        for (const code of path.hardFindingCodes) hardFailureCounts.set(code, (hardFailureCounts.get(code) || 0) + 1)
        continue
      }
      if (path.evidenceState === 'known') knownFeasiblePathCount += 1
      else unknownPathCount += 1
      if (!path.thermal.applicable && stableStructuralCandidates.length < targetPaths) {
        stableStructuralCandidates.push(path)
      }
      const signature = [...path.facets].sort().join('|')
      if (betterSystemPath(path, bestBySignature.get(signature))) bestBySignature.set(signature, path)
      if (path.leadPieceId && betterSystemPath(path, bestByLead.get(path.leadPieceId))) bestByLead.set(path.leadPieceId, path)
    }
  }

  const withLayers = core => {
    for (const layer of pathLayers) {
      if (layer) consider([...core, rolePiece(layer, 'outerwear')])
      else consider(core)
    }
  }

  for (const dress of independentDresses) withLayers([rolePiece(dress, 'dress')])
  for (const dress of dependentDresses) {
    for (const base of bases) {
      if (Number(base.id) === Number(dress.id)) continue
      withLayers([rolePiece(dress, 'dress'), rolePiece(base, 'layer_top')])
    }
  }
  for (const top of independentTops) {
    for (const bottom of bottoms) withLayers([rolePiece(top, 'primary_top'), rolePiece(bottom, 'primary_bottom')])
  }
  for (const dependent of dependentTops) {
    for (const base of bases) {
      if (Number(base.id) === Number(dependent.id)) continue
      for (const bottom of bottoms) {
        withLayers([
          rolePiece(base, 'primary_top'),
          rolePiece(dependent, 'layer_top'),
          rolePiece(bottom, 'primary_bottom'),
        ])
      }
    }
  }

  const pathsBySequence = new Map()
  for (const path of [...bestBySignature.values(), ...bestByLead.values()]) pathsBySequence.set(path.sequence, path)
  const selectionPool = stableStructuralCandidates.length
    ? stableStructuralCandidates
    : [...pathsBySequence.values()]
  const selection = selectSystemPaths(selectionPool, {
    targetPaths,
    totalImageCap,
    categoryImageCap,
  })
  const selectedPaths = selection.selected.map((path, index) => ({
    path_id: `system-${index + 1}`,
    piece_ids: path.pieceIds,
    wearing_states: path.thermal.wearingStates,
    evidence_state: path.evidenceState,
    thermal_disposition: {
      cold: path.thermal.coldFit,
      warm: path.thermal.warmFit,
    },
  }))
  const feasiblePathCount = knownFeasiblePathCount + unknownPathCount
  const enumerationComplete = candidatePathCount === logicalCandidatePathCount
  const outcome = logicalCandidatePathCount === 0
    ? 'wardrobe_structural_gap'
    : feasiblePathCount === 0
      ? (enumerationComplete ? 'known_physical_shortfall' : 'evidence_shortfall')
      : selectedPaths.length === 0
        ? 'visual_budget_configuration_failure'
        : knownFeasiblePathCount === 0
          ? 'evidence_shortfall'
          : 'ready'

  return {
    systemPaths: selectedPaths,
    visualPieceIds: selection.visualPieceIds,
    eligiblePieceIndex: eligible.map(compactEligiblePiece),
    report: {
      eligible_piece_count: eligible.length,
      eligible_by_category: Object.fromEntries([...new Set(eligible.map(piece => wardrobeCategoryGroup(piece) || piece.category))]
        .map(group => [group, eligible.filter(piece => (wardrobeCategoryGroup(piece) || piece.category) === group).length])),
      candidate_path_count: logicalCandidatePathCount,
      evaluated_path_count: candidatePathCount,
      path_enumeration_complete: enumerationComplete,
      frontier_piece_ids: {
        top: [...independentTops, ...dependentTops].map(piece => Number(piece.id)),
        base: bases.map(piece => Number(piece.id)),
        bottom: bottoms.map(piece => Number(piece.id)),
        dress: [...independentDresses, ...dependentDresses].map(piece => Number(piece.id)),
        shoes: shoes.map(piece => Number(piece.id)),
        outerwear: outerwear.map(piece => Number(piece.id)),
      },
      known_feasible_path_count: knownFeasiblePathCount,
      unknown_path_count: unknownPathCount,
      hard_failed_path_count: hardFailedPathCount,
      hard_failures_by_code: Object.fromEntries(hardFailureCounts),
      visually_presented_path_count: selectedPaths.length,
      omitted_feasible_path_count: Math.max(0, knownFeasiblePathCount + unknownPathCount - selectedPaths.length),
      skipped_for_atomic_visual_budget_count: selection.skippedForBudgetCount,
      visual_images_by_category: selection.categoryImageCounts,
      selected_paths: selectedPaths.map((path, index) => ({
        path_id: path.path_id,
        piece_ids: path.piece_ids,
        thermal_disposition: path.thermal_disposition,
        reason: selection.selectionReasons[index]?.reason || 'stable feasible path',
        newly_covered_construction_facets: selection.selectionReasons[index]?.new_facets || [],
      })),
      compact_index_ids_omitted_from_photographs: eligible
        .map(piece => Number(piece.id))
        .filter(id => !selection.visualPhotoIds.includes(id)),
      outcome,
    },
  }
}
