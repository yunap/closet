// Activity profiles (walking / hiking) and the footwear comfort gate.
// DOCUMENTED IN: docs/engine-behaviour-map.md and docs/occasion_profiles_ratification.md
// (ratified — register ceilings and occasion rules; not a draft despite its history).
// Activity is a STRUCTURED axis: only the resolved enum reaches these gates, never request prose.
import { pieceMatchesFootwear, pieceOccasionScore, pieceMatchesMaterial, wardrobeCategoryGroup } from './attributes.js'
import { resolveOccasionProfile } from './occasions.js'
import { evaluateOutfitStructure } from './outfitValidation.js'
import { validatedSubstitute } from './recovery.js'

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
      discouraged_footwear_warm: ['boot', 'boots', 'ankle boot', 'ankle boots'],
      discouraged_pieces: [],
      preferred_materials: [],
      preferred_footwear: [],
      required_footwear: [],
      excluded_heel_heights: ['mid', 'high'],
      excluded_walk_support: ['low'],
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
    // "nature walk" is a hike — owner ruling 2026-08-17: "it's not climbing a mountain hike, but
    // it's a hike". These phrases must be matched before walking's bare "walk" claims them.
    keywords: ["hike", "hiking", "trail", "nature walk", "trail walk", "trailhead", "hiking trail", "woods walk"],
    moodKeywords: ["hike", "hiking", "trail", "nature walk", "trail walk"],
    vibe: "practical, comfortable, highly durable, movement-focused",
    rules: {
      required_occasion_tags: ["outdoor", "outdoor active", "hiking"],
      prohibited_materials: [],
      prohibited_footwear: ["heel", "heels", "wedge", "wedges", "dress shoe", "dress shoes", "flip-flop", "flip-flops"],
      prohibited_pieces: [],
      discouraged_materials: ["silk", "satin", "chiffon", "lace", "suede"],
      discouraged_footwear: ["delicate sandal", "delicate sandals", "mule", "mules", "sandal", "sandals"],
      discouraged_footwear_warm: ["ankle boots", "ankle boot", "boots", "boot"],
      discouraged_pieces: ["dress", "dresses", "skirt", "skirts", "blouse", "blouses", "dressy top", "dressy tops", "dressy shorts"],
      preferred_materials: ["cotton", "knit", "knitwear", "denim", "utility", "canvas"],
      preferred_footwear: ["sneakers", "walking flats", "flat rugged boots"],
      required_footwear: ["sneaker", "sneakers", "athletic", "trail", "rugged", "lace-up", "walking flat", "walking flats"],
      excluded_heel_heights: ['low', 'mid', 'high'],
      excluded_walk_support: ['low', 'medium'],
      register_ceiling: "everyday"
    }
  }
]

function hasAffirmedActivityKeyword(text, keyword) {
  const escaped = keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
  const regex = new RegExp(`\\b${escaped}\\b`, 'ig')
  let match
  while ((match = regex.exec(text)) !== null) {
    const prefix = text.slice(Math.max(0, match.index - 64), match.index)
    const localClause = prefix.split(/[.!?;,]|\bbut\b|\bhowever\b/i).pop() || ''
    const negated = /\b(?:no|not|without)\b(?:\s+[a-z'-]+){0,3}\s*$/i.test(localClause)
      || /\b(?:do|does|did|will|would|should|is|are|was|were|have|has)\s+not\b(?:\s+[a-z'-]+){0,3}\s*$/i.test(localClause)
      || /\b(?:don't|doesn't|didn't|won't|wouldn't|shouldn't|isn't|aren't|wasn't|weren't|haven't|hasn't)\b(?:\s+[a-z'-]+){0,3}\s*$/i.test(localClause)
    if (!negated) return true
  }
  return false
}

// docs/activity-and-roster-spec.md Part 1. The model declares the activity, and it declared
// `walking` for a nature walk while its own prose said "if the trail has any rocky or uneven
// sections" — it understood the terrain, and only the structured value reaches the gates. This used
// to return immediately on a supplied activity, so no later signal could correct it.
//
// Escalation is ONE-DIRECTIONAL by design: request text may lift none/walking → hiking, and may
// never lower hiking → walking. The failure is asymmetric. Treating a city walk as a hike costs
// comfortable shoes nobody needed; treating a hike as a city walk costs grip on a trail.
// hasAffirmedActivityKeyword's negation handling means "just a gentle stroll, no hiking" does not
// escalate.
export function resolveActivityProfile({ activity = '', occasion = '', mood = '', request = '' } = {}) {
  const normActivity = String(activity || '').toLowerCase().trim()
  const hikeProfile = ACTIVITY_PROFILES.find(p => p.id === 'hiking')
  const walkProfile = ACTIVITY_PROFILES.find(p => p.id === 'walking')
  // NOT mood: it is the vibe/aesthetic axis ("Do NOT put activity here; use the activity
  // parameter"), and test/footwear_comfort.test.js pins that mood:'lots of walking' must not
  // resolve a comfort constraint.
  const haystack = `${occasion} ${request}`.toLowerCase()
  const textSaysHiking = () => (hikeProfile.keywords || []).some(keyword =>
    hasAffirmedActivityKeyword(haystack, keyword) // ratchet-allow: intent parsing, not garment text matching
  )

  if (normActivity === 'hiking' || normActivity === 'outdoor active' || normActivity === 'outdoor_active') {
    return hikeProfile
  }
  if (normActivity === 'walking') {
    // Escalate only; never de-escalate.
    return textSaysHiking() ? hikeProfile : walkProfile
  }

  if (normActivity === 'none' || !normActivity) {
    // Hiking matches first (more restrictive than walking)
    if (textSaysHiking()) return hikeProfile

    const matchedWalk = (walkProfile.keywords || []).some(keyword =>
      hasAffirmedActivityKeyword(haystack, keyword) // ratchet-allow: intent parsing, not garment text matching
    )
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
      discouraged_footwear_warm: profile.rules.discouraged_footwear_warm,
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

export function applyComfortFootwearRepair(outfit, candidatePieces = [], constraint, { weatherProfile, occasion, mood, activity, avoidPieceIds = null } = {}) {
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
  const warmDiscouragedFootwear = weatherProfile?.isHot ? (constraint.discouraged_footwear_warm || []) : []
  const discouragedFootwear = [
    ...(constraint.discouraged_footwear || []),
    ...warmDiscouragedFootwear
  ]
  const keepFootwear = (constraint.keep_footwear || []).filter(term => {
    if (!warmDiscouragedFootwear.length) return true
    return !warmDiscouragedFootwear.some(warmTerm => {
      const a = String(term).toLowerCase()
      const b = String(warmTerm).toLowerCase()
      return a.includes(b) || b.includes(a)
    })
  })

  // Keep-first ordering (hard rule)
  if (matchesAny(currentShoe, keepFootwear) && !matchesAny(currentShoe, discouragedFootwear)) {
    return outfit
  }

  if (matchesAny(currentShoe, discouragedFootwear)) {
    const candidateShoes = candidatePieces.filter(p => {
      if (p.category !== 'shoes' && wardrobeCategoryGroup(p) !== 'shoes') return false
      // This substitution never passes through a model turn, so a piece with an applicable
      // owner-approved objection (accepted personal_contextual_lesson or a provisional
      // wrong-choice row — see rules.js's pieceIdsWithApplicableNegativeFeedback) gets the same
      // hard exclusion as a discouraged footwear type, not a silent pass-through. avoidPieceIds is
      // optional so existing unit tests that construct this function directly keep working.
      if (avoidPieceIds && avoidPieceIds.has(Number(p.id))) return false
      return matchesAny(p, keepFootwear) && !matchesAny(p, discouragedFootwear)
    })

    if (candidateShoes.length > 0) {
      const getShoeRelevance = (shoe) => {
        let score = pieceOccasionScore(shoe, occasion)
        if (matchesAny(shoe, keepFootwear)) {
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

      const substitution = validatedSubstitute({
        subject: outfit,
        target: currentShoe,
        candidates: candidateShoes,
        mutate: (currentOutfit, bestShoe) => ({
          ...currentOutfit,
          pieceIds: Array.isArray(currentOutfit.pieceIds)
            ? currentOutfit.pieceIds.map(id => Number(id) === Number(currentShoe.id) ? Number(bestShoe.id) : Number(id))
            : currentOutfit.pieceIds,
          pieces: Array.isArray(currentOutfit.pieces)
            ? currentOutfit.pieces.map(piece => wardrobeCategoryGroup(piece) === 'shoes' ? bestShoe : piece)
            : currentOutfit.pieces,
        }),
        validate: trial => evaluateOutfitStructure(trial.pieces, { requireShoes: true }),
        context: { flow: 'footwear_comfort', reason: constraint.reason },
      })
      if (substitution.status !== 'recovered') return outfit
      const repaired = substitution.value

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
