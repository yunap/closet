// Cross-look batch thermal coherence filter for multi-outfit composition.
//
// Evaluates candidate outfits composed for the same request to ensure they share a
// consistent seasonal and thermal register. Outfits deviating by more than maxSpread
// ordinal warmth levels from the batch anchor (weather profile or batch median) are flagged.

import { WARMTH_LEVELS } from './garmentWarmth.js'
import { outfitThermalContribution } from './outfitThermalContribution.js'

const IDX = new Map(WARMTH_LEVELS.map((l, i) => [l, i]))

/**
 * Cross-look thermal coherence filter for a batch of outfits composed for a single occasion/context.
 * Ensures that a multi-look batch does not pair incompatible seasonal extremes (e.g. linen summer
 * separates alongside a wool knit dress + outerwear jacket).
 *
 * @param {Array} outfits - The candidate outfits in presentation order
 * @param {Object} options
 * @param {Array} options.candidatePieces - Full pieces to rehydrate trimmed outfits
 * @param {Object} options.weatherProfile - Resolved weather profile for target determination
 * @param {number} options.maxSpread - Maximum allowed distance in thermal levels (default 1)
 * @returns {{ coherentOutfits: Array, rejected: Array }}
 */
export function evaluateBatchThermalCoherence(outfits = [], { candidatePieces = [], weatherProfile = null, maxSpread = 1 } = {}) {
  const list = Array.isArray(outfits) ? outfits : []
  if (list.length <= 1) return { coherentOutfits: list, rejected: [] }

  const candidatePieceById = new Map((candidatePieces || []).map(p => [Number(p.id), p]))
  const scored = list.map(outfit => {
    const rawPieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
    const fullPieces = rawPieces.map(p => candidatePieceById.get(Number(p?.id)) || p)
    const thermal = outfitThermalContribution(fullPieces)
    const effectiveLevel = thermal.withLayer || thermal.base || 'moderate'
    const baseLevel = thermal.base || 'moderate'
    const upperLevel = thermal.upperWithLayer || thermal.upperBase || effectiveLevel
    const effectiveIdx = IDX.get(effectiveLevel) ?? 2
    const baseIdx = IDX.get(baseLevel) ?? 2
    const upperIdx = IDX.get(upperLevel) ?? 2
    return { outfit, thermal, effectiveLevel, baseLevel, upperLevel, effectiveIdx, baseIdx, upperIdx }
  })

  // Determine anchor target index
  let targetIdx = null
  if (weatherProfile?.isHot) {
    targetIdx = IDX.get('very light')
  } else if (weatherProfile?.isCold) {
    targetIdx = IDX.get('warm')
  } else if (weatherProfile?.needsRemovableCoolLayer) {
    targetIdx = IDX.get('moderate')
  } else {
    const statedBand = weatherProfile?.resolvedWeatherContext?.temperature?.band
    if (statedBand === 'mild') {
      targetIdx = IDX.get('moderate')
    } else if (statedBand === 'hot') {
      targetIdx = IDX.get('very light')
    } else if (statedBand === 'cold') {
      targetIdx = IDX.get('warm')
    } else {
      const sortedIndices = scored.map(s => s.effectiveIdx).sort((a, b) => a - b)
      targetIdx = sortedIndices[Math.floor(sortedIndices.length / 2)]
    }
  }

  const coherentOutfits = []
  const rejected = []

  for (const item of scored) {
    const distToTarget = Math.abs(item.effectiveIdx - targetIdx)
    const baseDistToTarget = Math.abs(item.baseIdx - targetIdx)
    const upperDistToTarget = Math.abs(item.upperIdx - targetIdx)
    const maxDist = Math.max(distToTarget, baseDistToTarget, upperDistToTarget)

    if (maxDist > maxSpread) {
      rejected.push({
        outfit: item.outfit,
        effectiveLevel: item.effectiveLevel,
        baseLevel: item.baseLevel,
        reason: `thermal incoherence: outfit warmth (${item.effectiveLevel}) diverges from batch register (${WARMTH_LEVELS[targetIdx]})`,
      })
    } else {
      coherentOutfits.push(item.outfit)
    }
  }

  if (!coherentOutfits.length && scored.length) {
    const minDiff = Math.min(...scored.map(s => Math.abs(s.effectiveIdx - targetIdx)))
    const rescued = scored.filter(s => Math.abs(s.effectiveIdx - targetIdx) === minDiff).map(s => s.outfit)
    const stillRejected = rejected.filter(r => !rescued.includes(r.outfit))
    return { coherentOutfits: rescued, rejected: stillRejected }
  }

  return { coherentOutfits, rejected }
}
