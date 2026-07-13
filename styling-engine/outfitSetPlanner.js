// Outfit-set planning engine — multi-outfit composition under shared constraints.
//
// Step 6 of the freeform re-architecture (docs/flows/freeform-stylist-chat.md,
// "Step 6 resolution — the planning engine"): this engine started life as the
// trip precompose's slot builder in routes/ai.js and was extracted verbatim so
// the model can call it as the plan_outfit_set tool. What it does that a
// per-outfit composer can't: compose outfits for several use-case slots at
// once while sharing state across them (piece reuse via used outfit/formula
// keys, per-slot silhouette variety), then attach plan metadata (per-slot
// coverage lines + a packing-reuse report) that the client renders as the
// trip-plan block.
//
// Still to come per the documented build order: per-slot live weather
// (getWeatherProfileForPlan), the signed reuse dial + per-category repeat
// rules, and objective-driven plan reports.

import {
  filterWholeWardrobePiecesForGeneration,
  buildWholeWardrobeCandidateOutfits,
  wholeWardrobeOutfitsFromCandidates,
  locallyGateWholeWardrobeOutfits,
  isOutfitStructurallyValid,
  weatherProfileFromContext,
  outfitStylisticStrengthScore,
  wardrobeCategoryGroup
} from './rules.js'
import { bottomKind, fabricWeight, garmentKind, isDarkPiece, pieceMatchesFootwear, sleeveCoverage } from './attributes.js'
import { resolveComfortFootwearConstraint, applyComfortFootwearRepair } from './footwear-comfort.js'
import { normalizeOccasion, normalizeActivity } from './stylingIntent.js'

export function normalizeTripPieceName(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function annotateTripOutfit(outfit, slot, index = 0, { slotIndex = 0, slotTotal = 1, source = 'trip_precompose' } = {}) {
  if (!outfit || !slot) return outfit
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const pieceIds = pieces.map(piece => Number(piece.id)).filter(Boolean)
  const existingReason = String(outfit.reason || '').trim()
  const existingWatch = String(outfit.watchFor || '').trim()
  return {
    ...outfit,
    pieces: pieces.length ? pieces : outfit.pieces,
    pieceIds: pieceIds.length ? pieceIds : outfit.pieceIds,
    label: slot.label,
    title: slot.label,
    bestFor: slot.bestFor,
    occasion: slot.occasion,
    activity: slot.activity,
    tripSlot: slot.id,
    tripNote: slot.planNote || '',
    coverage: slot.coverage || slot.bestFor,
    targetOutfits: slot.targetOutfits || 1,
    tripSummary: slot.tripSummary || null,
    coveragePosition: `${slot.label} · ${slotIndex + 1} of ${slotTotal}`,
    source,
    strength: '',
    mission: '',
    missionId: '',
    missionLabel: '',
    dominantDirection: '',
    silhouette: '',
    reason: existingReason,
    watchFor: existingWatch && !/^none$/i.test(existingWatch) ? existingWatch : ''
  }
}

function describeTripPieceReuse(outfits = []) {
  const byPiece = new Map()
  for (const outfit of outfits || []) {
    const slotLabel = outfit?.label || outfit?.title || outfit?.bestFor || 'look'
    for (const piece of outfit?.pieces || []) {
      const id = Number(piece?.id)
      const key = id || normalizeTripPieceName(piece?.name || '')
      if (!key) continue
      if (!byPiece.has(key)) {
        byPiece.set(key, {
          name: piece?.name || 'Garment',
          labels: new Set(),
          count: 0
        })
      }
      const entry = byPiece.get(key)
      entry.count += 1
      entry.labels.add(slotLabel)
    }
  }
  const repeated = [...byPiece.values()]
    .filter(entry => entry.count > 1)
    .map(entry => ({
      name: entry.name,
      count: entry.count,
      where: [...entry.labels].slice(0, 3).join(', ')
    }))
  return {
    distinctPieces: byPiece.size,
    repeated,
    summary: repeated.length
      ? `${byPiece.size} distinct pieces; repeats: ${repeated.slice(0, 4).map(entry => `${entry.name} -> ${entry.where}`).join('; ')}`
      : `${byPiece.size} distinct pieces; no repeated pieces needed.`
  }
}

function attachTripPlanMetadata(outfits = [], { source = 'trip_precompose' } = {}) {
  const tripOutfits = outfits.filter(outfit => outfit?.source === source)
  if (!tripOutfits.length) return outfits
  const pieceReuse = describeTripPieceReuse(tripOutfits)
  const bySlot = new Map()
  for (const outfit of tripOutfits) {
    const key = outfit.tripSlot || outfit.label || outfit.bestFor
    if (!bySlot.has(key)) bySlot.set(key, [])
    bySlot.get(key).push(outfit)
  }
  const coverageBySlot = new Map()
  for (const [key, group] of bySlot.entries()) {
    const first = group[0] || {}
    const count = group.length
    const lookWord = count === 1 ? 'look covers' : 'looks cover'
    coverageBySlot.set(key, `${count} ${first.label || first.title || 'trip'} ${lookWord} ${first.coverage || first.bestFor || 'this use case'}`)
  }
  return outfits.map(outfit => {
    if (outfit?.source !== source) return outfit
    const key = outfit.tripSlot || outfit.label || outfit.bestFor
    return {
      ...outfit,
      pieceReuse,
      coverageLine: coverageBySlot.get(key) || '',
      tripPlanLines: [
        outfit.tripSummary?.durationText ? `Trip length: ${outfit.tripSummary.durationText}` : '',
        outfit.tripSummary?.dayBreakdown ? `Coverage: ${outfit.tripSummary.dayBreakdown}` : '',
        coverageBySlot.get(key) || '',
        pieceReuse.summary ? `Packing reuse: ${pieceReuse.summary}` : ''
      ].filter(Boolean)
    }
  })
}

function tripSlotComfortConstraint(slot = {}, baseConstraint = null) {
  if (slot.activity !== 'walking') return baseConstraint
  return {
    reason: 'all-day walking comfort',
    discouraged_footwear: [
      ...(baseConstraint?.discouraged_footwear || []),
      ...TRIP_UNSTABLE_FOOTWEAR_TERMS.filter(term => term !== 'boot' && term !== 'boots' && term !== 'ankle boot' && term !== 'ankle boots')
    ],
    discouraged_footwear_warm: [
      ...(baseConstraint?.discouraged_footwear_warm || []),
      'boot', 'boots', 'ankle boot', 'ankle boots'
    ],
    keep_footwear: [
      ...TRIP_WALKABLE_FOOTWEAR_TERMS
    ]
  }
}

function tripOutfitKey(outfit = {}) {
  const ids = (outfit.pieceIds || outfit.pieces?.map(p => p.id) || []).map(Number).filter(Boolean)
  return ids.slice().sort((a, b) => a - b).join('|')
}

function tripOutfitFormulaKey(outfit = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const top = pieces.find(p => wardrobeCategoryGroup(p) === 'top')?.id || ''
  const bottom = pieces.find(p => wardrobeCategoryGroup(p) === 'bottom')?.id || ''
  const dress = pieces.find(p => wardrobeCategoryGroup(p) === 'dress')?.id || ''
  return dress ? `dress:${dress}` : `separates:${top}:${bottom}`
}

function tripBottomSilhouetteKey(outfit = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const bottom = pieces.find(piece => wardrobeCategoryGroup(piece) === 'bottom')
  const dress = pieces.find(piece => wardrobeCategoryGroup(piece) === 'dress')
  const piece = bottom || dress
  if (!piece) return ''
  const kind = bottom ? bottomKind(piece) : 'dress'
  const shape = normalizedStructuredValue(piece.bottom_shape || piece.silhouette || '')
  const length = normalizedStructuredValue(piece.length_hits_at || '')
  return [kind, shape, length].filter(Boolean).join(':')
}

const TRIP_WALKABLE_FOOTWEAR_TERMS = [
  'flat',
  'flats',
  'ballet flat',
  'ballet flats',
  'sneaker',
  'sneakers',
  'slip-on',
  'slip-ons',
  'slip on',
  'slip ons',
  'canvas',
  'canvas shoe',
  'canvas shoes',
  'loafer',
  'loafers',
  'sandal',
  'sandals',
  'walking flat',
  'walking flats'
]

const TRIP_UNSTABLE_FOOTWEAR_TERMS = [
  'heel',
  'heels',
  'high heel',
  'high heels',
  'pointed',
  'pointed heel',
  'pointed heels',
  'mule',
  'mules',
  'wedge',
  'wedges',
  'boot',
  'boots',
  'ankle boot',
  'ankle boots',
  'dress shoe',
  'dress shoes'
]

const TRIP_CASUAL_DINNER_FOOTWEAR_TERMS = [
  'sneaker',
  'sneakers',
  'canvas',
  'slip-on',
  'slip-ons',
  'slip on',
  'slip ons',
  'trainer',
  'trainers'
]

const TRIP_SHARP_DINNER_FOOTWEAR_TERMS = [
  'mule',
  'mules',
  'heel',
  'heels',
  'block heel',
  'block heels',
  'dress flat',
  'dress flats',
  'cutout'
]

function normalizedStructuredValue(value = '') {
  return String(value || '').toLowerCase().trim().replaceAll('-', '_').replaceAll(' ', '_')
}

function tripStructuredValueSet(piece = {}) {
  const values = new Set()
  const add = value => {
    const normalized = normalizedStructuredValue(value)
    if (!normalized) return
    values.add(normalized)
    for (const token of normalized.replaceAll('_', ' ').split(/\s+/)) {
      if (token) values.add(token)
    }
  }
  for (const color of Array.isArray(piece.colors) ? piece.colors : []) add(color)
  for (const field of [
    'category',
    'reads_as',
    'pattern_type',
    'pattern_scale',
    'pattern_complexity',
    'silhouette',
    'fabric_category',
    'fabric_weight',
    'fit_on_body',
    'tuck_behavior',
    'waistband_type',
    'sleeve_type',
    'bottom_shape',
    'length_hits_at',
    'neckline',
    'hem'
  ]) add(piece[field])
  return values
}

function tripPieceHasStructuredValue(piece = {}, values = []) {
  const pieceValues = tripStructuredValueSet(piece)
  return values.some(value => pieceValues.has(normalizedStructuredValue(value)))
}

function tripShoeMatchesAny(piece = {}, terms = []) {
  return terms.some(term => pieceMatchesFootwear(piece, term))
}

function tripPieceIsDelicateForDay(piece = {}) {
  return fabricWeight(piece) === 'heavy' || tripPieceHasStructuredValue(piece, [
    'lace',
    'crochet',
    'satin',
    'silk',
    'suede',
    'sheer',
    'chiffon',
    'wool',
    'leather'
  ])
}

function tripShoeIsWalkable(piece = {}) {
  return tripShoeMatchesAny(piece, TRIP_WALKABLE_FOOTWEAR_TERMS)
}

function tripShoeIsUnstableForWalking(piece = {}) {
  return tripShoeMatchesAny(piece, TRIP_UNSTABLE_FOOTWEAR_TERMS)
}

function isTripDinnerSlot(slot = {}) {
  return normalizeOccasion(slot.occasion) === 'evening'
}

function isCasualDinnerShoe(piece = {}) {
  return tripShoeMatchesAny(piece, TRIP_CASUAL_DINNER_FOOTWEAR_TERMS)
}

function isSharpDinnerShoe(piece = {}) {
  return tripShoeMatchesAny(piece, TRIP_SHARP_DINNER_FOOTWEAR_TERMS)
}

function isCasualDinnerLayer(piece = {}) {
  return tripPieceHasStructuredValue(piece, [
    'stripe',
    'striped',
    'fleece',
    'chunky',
    'slouchy',
    'oversized',
    'casual',
    'relaxed'
  ])
}

function isElevatedDinnerTop(piece = {}) {
  return isDarkPiece(piece) ||
    garmentKind(piece) === 'button-shirt' ||
    tripPieceHasStructuredValue(piece, ['satin', 'silk', 'blouson', 'cowl', 'structured'])
}

function isCasualDinnerTop(piece = {}) {
  return garmentKind(piece) === 'tee' ||
    garmentKind(piece) === 'sweatshirt' ||
    garmentKind(piece) === 'hoodie' ||
    tripPieceHasStructuredValue(piece, ['graphic', 'casual'])
}

function isCasualDinnerBottom(piece = {}) {
  return tripPieceHasStructuredValue(piece, ['drawstring', 'jogger', 'cargo', 'casual'])
}

function isLightNeutralPiece(piece = {}) {
  const colorValues = new Set((Array.isArray(piece.colors) ? piece.colors : []).map(normalizedStructuredValue))
  return colorValues.has('tan') || colorValues.has('beige') || colorValues.has('cream')
}

function isElevatedDinnerLayer(piece = {}) {
  return garmentKind(piece) === 'blazer' ||
    isDarkPiece(piece) ||
    tripPieceHasStructuredValue(piece, ['draped', 'sheer', 'trim', 'tailored', 'structured'])
}

function isDinnerDiscouragedBottom(piece = {}) {
  return tripPieceHasStructuredValue(piece, ['crochet', 'lace', 'jersey', 'drawstring'])
}

function isDinnerDiscouragedTop(piece = {}) {
  return garmentKind(piece) === 'tee' || tripPieceHasStructuredValue(piece, ['graphic', 'casual'])
}

function isDinnerShoeRegister(piece = {}) {
  return tripShoeMatchesAny(piece, ['mule', 'mules', 'heel', 'heels', 'sandal', 'sandals'])
}

function tripPieceFabricBreathabilityScore(piece = {}, { isHotDay = false } = {}) {
  let score = 0
  const weight = fabricWeight(piece)
  if (weight === 'light') score += isHotDay ? 22 : 14
  else if (weight === 'medium') score += 8
  else if (weight === 'heavy') score -= isHotDay ? 36 : 22

  if (tripPieceHasStructuredValue(piece, ['linen', 'cotton', 'viscose', 'tencel', 'gauze', 'seersucker'])) score += 10
  if (tripPieceHasStructuredValue(piece, ['wool', 'leather', 'suede', 'fleece', 'corduroy'])) score -= isHotDay ? 18 : 8
  return score
}

function tripPieceWalkabilityScore(piece = {}) {
  let score = 0
  if (tripPieceHasStructuredValue(piece, ['wide_leg', 'wide', 'flowing', 'relaxed', 'full_skirt', 'a_line_skirt', 'slip_skirt'])) score += 12
  if (tripPieceHasStructuredValue(piece, ['midi', 'maxi', 'ankle', 'full_length'])) score += 6
  if (tripPieceHasStructuredValue(piece, ['pencil_skirt', 'slim', 'fitted', 'tight', 'mini', 'short'])) score -= 10
  if (tripPieceHasStructuredValue(piece, ['stretch', 'elastic', 'side_slit'])) score += 6
  return score
}

function tripDaytimeBottomScore(piece = {}, { isHotDay = false, isWinery = false } = {}) {
  const kind = bottomKind(piece)
  let score = tripPieceFabricBreathabilityScore(piece, { isHotDay }) + tripPieceWalkabilityScore(piece)
  if (kind === 'shorts') score += isHotDay ? 10 : 6
  if (kind === 'pants' && fabricWeight(piece) === 'light') score += 10
  if (kind === 'skirt-mini') score -= isWinery ? 2 : 8
  if (kind === 'skirt-midi' || kind === 'skirt-maxi') score += fabricWeight(piece) === 'light' ? 12 : 4
  if (isWinery && (kind === 'skirt-midi' || kind === 'skirt-maxi')) score += 8
  return score
}

function tripOutfitAestheticGravityScore(outfit = {}) {
  const gravity = outfitStylisticStrengthScore(outfit, null)
  return Math.max(-26, Math.min(28, Math.round(gravity * 0.35)))
}

function tripOutfitDinnerRegisterScore(outfit = {}, slot = {}) {
  if (!isTripDinnerSlot(slot)) return 0
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const top = pieces.find(piece => wardrobeCategoryGroup(piece) === 'top')
  const bottom = pieces.find(piece => wardrobeCategoryGroup(piece) === 'bottom')
  const dress = pieces.find(piece => wardrobeCategoryGroup(piece) === 'dress')
  const shoe = pieces.find(piece => wardrobeCategoryGroup(piece) === 'shoes')
  const layer = pieces.find(piece => wardrobeCategoryGroup(piece) === 'outerwear')
  let score = 0

  if (dress) score += 34
  if (top) {
    if (isElevatedDinnerTop(top)) score += 18
    if (isCasualDinnerTop(top)) score -= 20
  }
  if (bottom) {
    const kind = bottomKind(bottom)
    if (kind?.startsWith('skirt')) score += 12
    if (isCasualDinnerBottom(bottom)) score -= 28
  }
  if (shoe) {
    if (isSharpDinnerShoe(shoe)) score += 16
    if (isCasualDinnerShoe(shoe)) score -= 24
    if (isLightNeutralPiece(shoe) && isCasualDinnerShoe(shoe)) score -= 10
  }
  if (layer) {
    score += 4
    if (isCasualDinnerLayer(layer)) score -= 34
    if (isElevatedDinnerLayer(layer)) score += 16
  }
  if (layer && shoe && isCasualDinnerLayer(layer) && isCasualDinnerShoe(shoe)) score -= 26
  return score
}

function tripSlotFitScore(outfit = {}, slot = {}, { weatherProfile = {} } = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const top = pieces.find(piece => wardrobeCategoryGroup(piece) === 'top')
  const bottom = pieces.find(piece => wardrobeCategoryGroup(piece) === 'bottom')
  const dress = pieces.find(piece => wardrobeCategoryGroup(piece) === 'dress')
  const shoe = pieces.find(piece => wardrobeCategoryGroup(piece) === 'shoes')
  const layer = pieces.find(piece => wardrobeCategoryGroup(piece) === 'outerwear')
  const isWalking = slot.activity === 'walking'
  const isDinner = isTripDinnerSlot(slot)
  const isWinery = slot.occasion === 'outdoor_daytime_social'
  const isDayWalking = isWalking && !isDinner
  const isHotDay = Boolean(weatherProfile?.isHot || /\b(hot|80|90|summer)\b/i.test(`${slot.season || ''} ${slot.bestFor || ''}`))
  const isHotNonDinner = isHotDay && !isDinner
  const isColdDay = Boolean(weatherProfile?.isCold || /\b(cold|freezing|winter|chilly)\b/i.test(`${slot.season || ''} ${slot.bestFor || ''}`))
  const hardRejects = []
  let score = 0

  if (!shoe) hardRejects.push('missing shoes')
  if (isHotNonDinner && dress && fabricWeight(dress) === 'heavy') {
    score -= 90
    hardRejects.push('heavy dress too warm for hot daytime slot')
  }
  if (isDinner && isHotDay && dress && fabricWeight(dress) === 'heavy') {
    score -= 70
    hardRejects.push('heavy dress too warm for warm trip dinner')
  }
  // Mirrors the missing-shoes hard reject: a piece-level cold-weather gate keeps bare/sleeveless
  // pieces out, but nothing previously verified the assembled OUTFIT actually carries a warm layer —
  // "tee + jeans + sneakers" passed every piece-level check individually while providing zero
  // insulation for a stated cold trip.
  if (isColdDay) {
    const hasWarmLayer = Boolean(layer) || (top && fabricWeight(top) === 'heavy') || (dress && fabricWeight(dress) === 'heavy')
    if (!hasWarmLayer) {
      score -= 60
      hardRejects.push('no warm layer for cold weather')
    }
  }

  if (isDayWalking) {
    if (shoe) {
      if (tripShoeIsUnstableForWalking(shoe)) hardRejects.push('unstable walking shoes')
      if (tripShoeIsWalkable(shoe)) score += 24
    }

    if (bottom) {
      score += tripDaytimeBottomScore(bottom, { isHotDay, isWinery })
      if (tripPieceIsDelicateForDay(bottom)) score -= isWinery ? 10 : 24
    }

    if (dress) {
      score += isWinery ? 14 : -34
      if (tripPieceIsDelicateForDay(dress)) score -= isWinery ? 6 : 18
    }

    if (top) {
      const topKind = garmentKind(top)
      if (topKind === 'tee' || topKind === 'tank' || topKind === 'button-shirt') score += 10
      if (tripPieceIsDelicateForDay(top)) score -= isWinery ? 6 : 18
      if (sleeveCoverage(top) === 'long' && isHotDay) score -= 18
      if (fabricWeight(top) === 'heavy' && isHotDay) score -= 24
    }

    if (layer && isHotDay) score -= 18
    if (!bottom && !dress) score -= 20
  } else {
    if (dress) score += 28
    if (bottom) {
      const kind = bottomKind(bottom)
      if (kind?.startsWith('skirt')) score += 14
      if (isDinnerDiscouragedBottom(bottom)) score -= 22
    }
    if (top) {
      if (isDarkPiece(top)) score += 12
      if (garmentKind(top) === 'button-shirt') score += 10
      if (isDinnerDiscouragedTop(top)) score -= 10
    }
    if (shoe) {
      if (isDinnerShoeRegister(shoe)) score += 8
      if (isCasualDinnerShoe(shoe)) score -= 10
      if (isDinner && isCasualDinnerShoe(shoe)) score -= 18
    }
    if (layer) {
      score += 8
      if (isCasualDinnerLayer(layer)) score -= 20
      if (isDinner && isCasualDinnerLayer(layer)) score -= 18
    }
    if (!dress && !bottom) score -= 20
    if (isDinner) {
      score += tripOutfitDinnerRegisterScore(outfit, slot)
      if (tripOutfitDinnerRegisterScore(outfit, slot) < 0) hardRejects.push('too casual for dinner register')
    }
  }

  score += tripOutfitAestheticGravityScore(outfit)

  return {
    score,
    hardRejects,
    accepted: hardRejects.length === 0
  }
}

function chooseEveningLayerForOutfit(outfit, allPieces = [], slot = {}) {
  const pieces = Array.isArray(outfit?.pieces) ? outfit.pieces : []
  const existingIds = new Set(pieces.map(piece => Number(piece.id)).filter(Boolean))
  const weatherProfile = weatherProfileFromContext({ season: slot.season || 'cool evening weather' })
  const { allowedPieces } = filterWholeWardrobePiecesForGeneration(allPieces, {
    occasion: 'city',
    explorationMode: 'moderate',
    weatherProfile,
    mood: 'cool evening layer',
    activity: 'none'
  })
  const baseScore = tripSlotFitScore(outfit, slot, { weatherProfile }).score
  const options = allowedPieces
    .filter(piece => wardrobeCategoryGroup(piece) === 'outerwear' && !existingIds.has(Number(piece.id)))
    .map(layer => {
      const nextPieces = [...pieces, layer]
      const candidate = {
        ...outfit,
        pieces: nextPieces,
        pieceIds: nextPieces.map(piece => Number(piece.id)).filter(Boolean)
      }
      const fit = tripSlotFitScore(candidate, slot, { weatherProfile })
      return { layer, candidate, fit }
    })
    .filter(item => item.fit.accepted && item.fit.score >= baseScore + 6)
    .sort((a, b) => b.fit.score - a.fit.score)
  return options[0]?.candidate || outfit
}

function withEveningLayerIfUseful(outfit, allPieces = [], slot = {}) {
  if (!outfit || !isTripDinnerSlot(slot)) return outfit
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  if (pieces.some(piece => wardrobeCategoryGroup(piece) === 'outerwear')) return outfit
  const layered = chooseEveningLayerForOutfit(outfit, allPieces, slot)
  const layer = layered.pieces?.find(piece => wardrobeCategoryGroup(piece) === 'outerwear')
  if (!layer) return outfit
  return {
    ...layered,
    reason: [
      outfit.reason,
      `${layer.name} adds a light evening layer if the evening cools down.`
    ].filter(Boolean).join(' '),
    watchFor: outfit.watchFor || ''
  }
}

function seedTripUsedSets(outfits = []) {
  const usedKeys = new Set()
  const usedTopBottom = new Set()
  for (const outfit of outfits || []) {
    const key = tripOutfitKey(outfit)
    const formulaKey = tripOutfitFormulaKey(outfit)
    if (key) usedKeys.add(key)
    if (formulaKey) usedTopBottom.add(formulaKey)
  }
  return { usedKeys, usedTopBottom }
}

export function composeOutfitSet({ slots = [], question = '', mood = '', allPieces = [], seedOutfits = [], source = 'trip_precompose' } = {}) {
  const picked = []
  const seeded = seedTripUsedSets(seedOutfits)
  const usedKeys = seeded.usedKeys
  const usedTopBottom = seeded.usedTopBottom
  for (const slot of slots) {
    const weatherProfile = weatherProfileFromContext({ mood: mood || question, season: slot.season })
    const { allowedPieces } = filterWholeWardrobePiecesForGeneration(allPieces, {
      occasion: slot.occasion,
      explorationMode: 'moderate',
      weatherProfile,
      mood: mood || question,
      activity: slot.activity,
      request: question
    })
    const comfortConstraint = tripSlotComfortConstraint(slot, resolveComfortFootwearConstraint({
      occasion: slot.occasion,
      mood: mood || question,
      request: question,
      activity: slot.activity
    }))
    const candidates = buildWholeWardrobeCandidateOutfits(allowedPieces, {
      occasion: slot.occasion,
      season: slot.season,
      mood: mood || question,
      explorationMode: 'moderate',
      activeMissions: ['controlled_print', 'monochrome_texture', 'structured_soft', 'color_anchor', 'unexpected_pairing'],
      comfortConstraint,
      candidateLimit: 42,
      candidateBucketLimit: 8,
      request: question,
      question
    })
    const localOutfits = wholeWardrobeOutfitsFromCandidates(candidates, allowedPieces, {
      occasion: slot.occasion,
      mood: mood || question,
      season: slot.season,
      weatherProfile,
      activity: slot.activity,
      request: question,
      question
    }).filter(outfit => isOutfitStructurallyValid(outfit?.pieces || [], { requireShoes: true }))
    const ranked = locallyGateWholeWardrobeOutfits(localOutfits, Math.max(3, slots.length), {
      mode: 'advisor', // spec 9 — matches the 2026-06-25 advisor-mode decision, closes the "missing
      // outfit count" gap that only the primary visual composer had been fixed for; applyDiversity
      // left on (default true) since repeat-wear avoidance across a multi-day trip matters here
      repair: true, // spec 9 — locally-generated candidates, not LLM output, so a slot-fill repair
      // isn't "reinventing" a model's composition; decoupled from advisorMode for this reason
      rejectProfileDiscouraged: true,
      requireShoes: true,
      candidatePieces: allowedPieces,
      occasion: slot.occasion,
      mood: mood || question,
      season: slot.season,
      weatherProfile,
      activity: slot.activity
    }).outfits
    const scoredOutfits = [...ranked, ...localOutfits]
      .map(outfit => {
        const repaired = applyComfortFootwearRepair(outfit, allowedPieces, comfortConstraint, {
          weatherProfile,
          occasion: slot.occasion,
          mood: mood || question,
          activity: slot.activity
        })
        const finalOutfit = withEveningLayerIfUseful(repaired, allPieces, slot)
        return {
          outfit: finalOutfit,
          fit: tripSlotFitScore(finalOutfit, slot, { weatherProfile })
        }
      })
      .filter(item => tripOutfitKey(item.outfit))
      .sort((a, b) => {
        if (a.fit.accepted !== b.fit.accepted) return a.fit.accepted ? -1 : 1
        if (a.fit.hardRejects.length !== b.fit.hardRejects.length) return a.fit.hardRejects.length - b.fit.hardRejects.length
        return b.fit.score - a.fit.score
      })
    const slotChoices = []
    const slotUsedBottomSilhouettes = new Set()
    const targetOutfits = Math.min(3, Math.max(1, Number(slot.targetOutfits) || 1))
    const chooseScoredOutfit = (items, { avoidUsedFormula = true, preferUnusedBottomSilhouette = false } = {}) => {
      const available = items.filter(({ outfit }) => {
        const key = tripOutfitKey(outfit)
        if (!key || usedKeys.has(key)) return false
        const formulaKey = tripOutfitFormulaKey(outfit)
        return !avoidUsedFormula || !formulaKey || !usedTopBottom.has(formulaKey)
      })
      const best = available[0]
      if (!best) return null
      if (preferUnusedBottomSilhouette && slotUsedBottomSilhouettes.size) {
        const varied = available.find(item => {
          const silhouetteKey = tripBottomSilhouetteKey(item.outfit)
          return silhouetteKey && !slotUsedBottomSilhouettes.has(silhouetteKey) && item.fit.score >= best.fit.score - 36
        })
        if (varied) return varied
      }
      return best
    }
    for (let pass = 0; pass < targetOutfits; pass += 1) {
      const preferUnusedBottomSilhouette = pass > 0
      const choice = chooseScoredOutfit(scoredOutfits, { avoidUsedFormula: true, preferUnusedBottomSilhouette })?.outfit ||
        chooseScoredOutfit(scoredOutfits, { avoidUsedFormula: true })?.outfit ||
        chooseScoredOutfit(scoredOutfits, { avoidUsedFormula: false, preferUnusedBottomSilhouette })?.outfit ||
        chooseScoredOutfit(scoredOutfits, { avoidUsedFormula: false })?.outfit
      if (!choice) break
      const key = tripOutfitKey(choice)
      const formulaKey = tripOutfitFormulaKey(choice)
      const bottomSilhouetteKey = tripBottomSilhouetteKey(choice)
      usedKeys.add(key)
      if (formulaKey) usedTopBottom.add(formulaKey)
      if (bottomSilhouetteKey) slotUsedBottomSilhouettes.add(bottomSilhouetteKey)
      slotChoices.push(choice)
    }
    slotChoices.forEach((choice, slotIndex) => {
      picked.push(annotateTripOutfit(choice, slot, picked.length, {
        slotIndex,
        slotTotal: slotChoices.length,
        source
      }))
    })
  }
  return attachTripPlanMetadata(picked, { source })
}

// Tool-argument slots (plan_outfit_set) -> engine slots. Mirrors the pre-route
// planner's normalizePlannerSlots (routes/ai.js), which keeps its own copy
// until the keyword pre-route retires on diagnostics evidence.
export const PLAN_TOTAL_OUTFIT_CAP = 8

export function normalizePlanSlots(rawSlots = [], {
  fallbackWeather = '',
  fallbackOccasion = 'city',
  fallbackActivity = 'none',
  maxSlots = 6,
  tripSummary = null
} = {}) {
  const normalized = (Array.isArray(rawSlots) ? rawSlots : [])
    .slice(0, maxSlots)
    .map((slot, index) => {
      const occasion = normalizeOccasion(String(slot?.occasion || fallbackOccasion || 'city'))
      const activity = normalizeActivity(String(slot?.activity || fallbackActivity || 'none'))
      const label = String(slot?.label || '').trim()
      const bestFor = String(slot?.best_for || slot?.bestFor || label).trim()
      return {
        id: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `slot_${index + 1}`,
        label,
        occasion,
        activity,
        season: String(slot?.weather || slot?.season || fallbackWeather || 'current season').trim(),
        bestFor,
        coverage: String(slot?.coverage || bestFor || label).trim(),
        targetOutfits: Math.min(3, Math.max(1, Number.parseInt(slot?.count, 10) || 1)),
        tripSummary,
        planNote: String(slot?.plan_note || slot?.planNote || '').trim()
      }
    })
    .filter(slot => slot.label && slot.bestFor)
  let total = normalized.reduce((sum, slot) => sum + slot.targetOutfits, 0)
  for (let index = normalized.length - 1; index >= 0 && total > PLAN_TOTAL_OUTFIT_CAP; index -= 1) {
    const slot = normalized[index]
    const trim = Math.min(slot.targetOutfits - 1, total - PLAN_TOTAL_OUTFIT_CAP)
    if (trim > 0) {
      slot.targetOutfits -= trim
      total -= trim
    }
  }
  return normalized
}
