import { pieceMatchesFootwear, pieceOccasionScore, pieceMatchesMaterial, wardrobeCategoryGroup } from './attributes.js'
import { resolveOccasionProfile } from './occasions.js'

export const ACTIVITY_PROFILES = [
  {
    id: "walking",
    label: "Lots of walking",
    keywords: [
      'walk', 'walking', 'city walk', 'stroll', 'strolling',
      'all day on my feet', 'on my feet', 'lots of walking',
      'walking around', 'walkable', 'sightseeing', 'exploring on foot'
    ],
    rules: {
      prohibited_materials: [],
      prohibited_footwear: [],
      prohibited_pieces: [],
      discouraged_materials: [],
      discouraged_footwear: [
        'stiletto', 'stilettos', 'high heel', 'high heels', 'pump', 'pumps',
        'pointed heel', 'pointed heels', 'spool heel', 'spool heels',
        'delicate sandal', 'delicate sandals', 'strappy sandal', 'strappy sandals',
        'kitten heel', 'kitten heels', 'high wedge', 'high wedges', 'high wedge heel', 'high wedge heels',
        'high wedge sandal', 'high wedge sandals'
      ],
      discouraged_pieces: [],
      preferred_materials: [],
      preferred_footwear: [],
      required_footwear: [],
      keep_footwear: [
        'block heel', 'block heels', 'low heel', 'low heels', 'low block heel', 'low block heels',
        'loafer', 'loafers', 'flat', 'flats', 'sneaker', 'sneakers', 'slip-on', 'slip-ons',
        'slip on', 'slip ons', 'mule', 'mules', 'boot', 'boots', 'ankle boot', 'ankle boots', 'clog', 'clogs'
      ]
    }
  },
  {
    id: "hiking",
    label: "Hiking / Outdoor active",
    keywords: ["hike", "hiking", "trail"],
    moodKeywords: ["hike", "hiking", "trail"],
    vibe: "practical, comfortable, highly durable, movement-focused",
    rules: {
      prohibited_materials: [],
      prohibited_footwear: ["heel", "heels", "wedge", "wedges", "dress shoe", "dress shoes", "flip-flop", "flip-flops"],
      prohibited_pieces: [],
      discouraged_materials: ["silk", "satin", "chiffon", "lace", "suede"],
      discouraged_footwear: ["delicate sandal", "delicate sandals", "mule", "mules", "sandal", "sandals"],
      discouraged_footwear_warm: ["ankle boots", "ankle boot", "boots", "boot"],
      discouraged_pieces: ["dress", "dresses", "skirt", "skirts", "blouse", "blouses", "dressy top", "dressy tops", "dressy shorts"],
      preferred_materials: ["cotton", "knit", "knitwear", "denim", "utility", "canvas"],
      preferred_footwear: ["sneakers", "walking flats", "flat rugged boots"],
      required_footwear: ["sneaker", "sneakers", "athletic", "trail", "rugged", "lace-up", "walking flat", "walking flats"]
    }
  }
]

export function resolveActivityProfile({ activity = '', occasion = '', mood = '', request = '' } = {}) {
  const normActivity = String(activity || '').toLowerCase().trim()
  if (normActivity === 'walking') {
    return ACTIVITY_PROFILES.find(p => p.id === 'walking')
  }
  if (normActivity === 'hiking' || normActivity === 'outdoor active' || normActivity === 'outdoor_active') {
    return ACTIVITY_PROFILES.find(p => p.id === 'hiking')
  }

  if (normActivity === 'none' || !normActivity) {
    const haystack = `${occasion} ${mood} ${request}`.toLowerCase()
    
    // Hiking matches first (more restrictive than walking)
    const hikeProfile = ACTIVITY_PROFILES.find(p => p.id === 'hiking')
    const hikeKeywords = hikeProfile.keywords || []
    const matchedHike = hikeKeywords.some(keyword => {
      const escaped = keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
      const regex = new RegExp(`\\b${escaped}\\b`, 'i')
      return regex.test(haystack) // ratchet-allow: intent parsing, not garment text matching
    })
    if (matchedHike) return hikeProfile

    const walkProfile = ACTIVITY_PROFILES.find(p => p.id === 'walking')
    const walkKeywords = walkProfile.keywords || []
    const matchedWalk = walkKeywords.some(keyword => {
      const escaped = keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
      const regex = new RegExp(`\\b${escaped}\\b`, 'i')
      return regex.test(haystack) // ratchet-allow: intent parsing, not garment text matching
    })
    if (matchedWalk) return walkProfile
  }

  return null
}

export function resolveComfortFootwearConstraint({ occasion = '', mood = '', request = '', activity = '' }) {
  const profile = resolveActivityProfile({ activity, occasion, mood, request })
  if (!profile) return null

  if (profile.id === 'walking') {
    return {
      reason: 'all-day walking comfort',
      discouraged_footwear: profile.rules.discouraged_footwear,
      keep_footwear: profile.rules.keep_footwear
    }
  }

  if (profile.id === 'hiking') {
    return {
      reason: 'hiking comfort',
      discouraged_footwear: [
        ...profile.rules.prohibited_footwear,
        ...profile.rules.discouraged_footwear
      ],
      keep_footwear: profile.rules.required_footwear
    }
  }

  return null
}

export function applyComfortFootwearRepair(outfit, candidatePieces = [], constraint, { weatherProfile, occasion, mood, activity } = {}) {
  if (!constraint) return outfit

  const warning = constraint.reason === 'hiking comfort'
    ? 'swapped for hiking footwear comfort'
    : 'swapped for all-day walking comfort'
  
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

        // Apply weather and material discouraged rules from occasionProfile and activityProfile if active
        const occasionProfile = resolveOccasionProfile(occasion, mood)
        const activityProfile = resolveActivityProfile({ activity, occasion, mood })
        const discouragedMaterials = [
          ...(occasionProfile?.rules?.discouraged_materials || []),
          ...(activityProfile?.rules?.discouraged_materials || [])
        ]
        for (const mat of discouragedMaterials) {
          if (pieceMatchesMaterial(shoe, mat)) {
            score -= 8
            break
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
