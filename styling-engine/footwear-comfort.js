import { pieceMatchesFootwear, pieceOccasionScore, pieceMatchesMaterial, wardrobeCategoryGroup } from './attributes.js'
import { resolveOccasionProfile } from './occasions.js'

/**
 * Scans occasion, mood, and raw user request for comfort/walking intent.
 * Trigger vocabulary: walk, walking, city walk, stroll, strolling, all day on my feet,
 * on my feet, lots of walking, walking around, walkable, sightseeing, exploring on foot.
 * Returns comfort constraint object if matched, else null.
 */
export function resolveComfortFootwearConstraint({ occasion = '', mood = '', request = '' }) {
  const triggers = [
    'walk', 'walking', 'city walk', 'stroll', 'strolling',
    'all day on my feet', 'on my feet', 'lots of walking',
    'walking around', 'walkable', 'sightseeing', 'exploring on foot'
  ]

  const haystack = `${occasion} ${mood} ${request}`.toLowerCase()

  const matched = triggers.some(trigger => {
    const escaped = trigger.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
    const regex = new RegExp(`\\b${escaped}\\b`, 'i')
    return regex.test(haystack) // ratchet-allow: intent parsing, not garment text matching
  })

  if (!matched) return null

  return {
    reason: 'all-day walking comfort',
    discouraged_footwear: [
      'stiletto', 'stilettos', 'high heel', 'high heels', 'pump', 'pumps',
      'pointed heel', 'pointed heels', 'spool heel', 'spool heels',
      'delicate sandal', 'delicate sandals', 'strappy sandal', 'strappy sandals',
      'kitten heel', 'kitten heels'
    ],
    keep_footwear: [
      'block heel', 'block heels', 'low heel', 'low heels', 'low block heel', 'low block heels',
      'loafer', 'loafers', 'flat', 'flats', 'sneaker', 'sneakers', 'slip-on', 'slip-ons',
      'slip on', 'slip ons', 'mule', 'mules', 'boot', 'boots', 'ankle boot', 'ankle boots', 'clog', 'clogs'
    ]
  }
}

/**
 * Repairs outfit footwear if walking comfort constraint is active.
 * currentShoe matches keep_footwear -> return outfit unchanged.
 * currentShoe matches discouraged_footwear -> swap for best comfortable shoe.
 */
export function applyComfortFootwearRepair(outfit, candidatePieces = [], constraint, { weatherProfile, occasion } = {}) {
  if (!constraint) return outfit

  const warning = 'swapped for all-day walking comfort'
  
  // Guarantee Idempotency
  if (outfit.watchFor && outfit.watchFor.includes(warning)) {
    return outfit
  }

  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const currentShoe = pieces.find(p => p.category === 'shoes' || wardrobeCategoryGroup(p) === 'shoes')
  if (!currentShoe) return outfit

  const matchesAny = (piece, terms) => terms.some(term => pieceMatchesFootwear(piece, term))

  // Keep-first ordering (hard rule)
  if (matchesAny(currentShoe, constraint.keep_footwear)) {
    return outfit
  }

  if (matchesAny(currentShoe, constraint.discouraged_footwear)) {
    const candidateShoes = candidatePieces.filter(p => {
      if (p.category !== 'shoes' && wardrobeCategoryGroup(p) !== 'shoes') return false
      return matchesAny(p, constraint.keep_footwear) && !matchesAny(p, constraint.discouraged_footwear)
    })

    if (candidateShoes.length > 0) {
      const getShoeRelevance = (shoe) => {
        let score = pieceOccasionScore(shoe, occasion)
        if (matchesAny(shoe, constraint.keep_footwear)) {
          score += 10
        }

        // Apply weather and material discouraged rules from occasionProfile if active
        const occasionProfile = resolveOccasionProfile(occasion)
        const weather = weatherProfile || { isHot: false, isCold: false }
        if (occasionProfile && occasionProfile.rules) {
          const discouragedMaterials = occasionProfile.rules.discouraged_materials || []
          for (const mat of discouragedMaterials) {
            if (pieceMatchesMaterial(shoe, mat)) {
              score -= 8
              break
            }
          }
        }
        return score
      }

      candidateShoes.sort((a, b) => {
        const scoreA = getShoeRelevance(a)
        const scoreB = getShoeRelevance(b)
        if (scoreA !== scoreB) return scoreB - scoreA
        return a.id - b.id
      })

      const bestShoe = candidateShoes[0]

      const repaired = { ...outfit }
      if (Array.isArray(repaired.pieceIds)) {
        repaired.pieceIds = repaired.pieceIds.map(id => Number(id) === Number(currentShoe.id) ? Number(bestShoe.id) : Number(id))
      }
      if (Array.isArray(repaired.pieces)) {
        repaired.pieces = repaired.pieces.map(p => {
          const cat = p.category || wardrobeCategoryGroup(p)
          if (cat === 'shoes') return bestShoe
          return p
        })
      }

      if (!repaired.watchFor || repaired.watchFor === 'none') {
        repaired.watchFor = warning
      } else if (!repaired.watchFor.includes(warning)) {
        repaired.watchFor = `${repaired.watchFor}; ${warning}`
      }

      return repaired
    }
  }

  return outfit
}
