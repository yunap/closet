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
// Per-slot live weather is now wired (build step 3): each slot resolves its own
// forecast from slot.location + slot.date (or the plan date_range) via
// getWeatherProfileForPlan, so a 60°F coast day on an otherwise-hot inland trip
// composes for the coast. User-stated per-slot weather still wins over the
// forecast. The signed reuse dial + per-category repeat rules + the anchor
// exemption are wired too (build step 4): constraints.reuse
// ('maximize'|'diversify'|'none'), constraints.no_repeat / allow_repeat (per
// category group), and constraints.shared_anchor_ids (soft-pinned across slots
// and exempt from no_repeat). The plan report is objective-driven too (build
// step 5): a piece_budget leads with the roster + combination count, a
// diversified / no_repeat plan leads with the repeat schedule, everything else
// keeps the packing-reuse headline (see buildPlanReport).

import { getWeatherProfileForPlan } from './weather.js'
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

function annotateTripOutfit(outfit, slot, index = 0, { slotIndex = 0, slotTotal = 1, source = 'trip_precompose', weatherLabel = '' } = {}) {
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
    slotWeather: weatherLabel,
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

function collectPieceRoster(outfits = []) {
  const seen = new Set()
  const names = []
  for (const outfit of outfits || []) {
    for (const piece of outfit?.pieces || []) {
      const key = Number(piece?.id) || normalizeTripPieceName(piece?.name || '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      names.push(piece?.name || 'Garment')
    }
  }
  return names
}

// Objective-driven plan report (build step 5). The report sections are chosen
// by what the set is FOR, not hardcoded to packing: a capsule (piece_budget)
// leads with the roster + how many outfits it yields; a diversified plan or one
// with a no_repeat rule leads with the repeat schedule (its success is "nothing
// repeats"); everything else keeps the packing-reuse headline. Returns the
// report lines to append to the shared plan lines.
function buildPlanReport(pieceReuse, tripOutfits = [], { reuseMode = '', noRepeatCats = new Set(), pieceBudget = 0 } = {}) {
  const outfitCount = tripOutfits.length
  const lines = []
  if (pieceBudget > 0) {
    const roster = collectPieceRoster(tripOutfits)
    const shown = roster.slice(0, 12).join(', ')
    lines.push(`Piece roster (${pieceReuse.distinctPieces}): ${shown}${roster.length > 12 ? ', …' : ''}`)
    lines.push(`${pieceReuse.distinctPieces} pieces → ${outfitCount} ${outfitCount === 1 ? 'outfit' : 'outfits'}`)
    lines.push(pieceReuse.distinctPieces <= pieceBudget
      ? `Within the ${pieceBudget}-piece budget.`
      : `Over the ${pieceBudget}-piece budget by ${pieceReuse.distinctPieces - pieceBudget} — tighten a slot or allow more repeats.`)
    return lines
  }
  if (reuseMode === 'diversify' || noRepeatCats.size) {
    if (!pieceReuse.repeated.length) {
      lines.push(`Every look is distinct — no piece repeats across the ${outfitCount} ${outfitCount === 1 ? 'outfit' : 'outfits'}.`)
    } else {
      lines.push(`Repeat schedule: ${pieceReuse.repeated.slice(0, 4).map(entry => `${entry.name} (${entry.where})`).join('; ')}`)
    }
    return lines
  }
  if (pieceReuse.summary) lines.push(`Packing reuse: ${pieceReuse.summary}`)
  return lines
}

function buildWeatherLine(slotWeather = []) {
  const parts = (Array.isArray(slotWeather) ? slotWeather : [])
    .filter(entry => entry?.label && entry?.weather)
    .map(entry => `${entry.label} — ${entry.weather}`)
  return parts.length ? `Weather used: ${parts.join('; ')}` : ''
}

function attachTripPlanMetadata(outfits = [], { source = 'trip_precompose', slotWeather = [], reuseMode = '', noRepeatCats = new Set(), pieceBudget = 0 } = {}) {
  const tripOutfits = outfits.filter(outfit => outfit?.source === source)
  if (!tripOutfits.length) return outfits
  const durationLabel = source === 'plan_outfit_set' ? 'Plan length' : 'Trip length'
  const pieceReuse = describeTripPieceReuse(tripOutfits)
  const reportLines = buildPlanReport(pieceReuse, tripOutfits, { reuseMode, noRepeatCats, pieceBudget })
  const weatherLine = buildWeatherLine(slotWeather)
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
        outfit.tripSummary?.durationText ? `${durationLabel}: ${outfit.tripSummary.durationText}` : '',
        outfit.tripSummary?.dayBreakdown ? `Coverage: ${outfit.tripSummary.dayBreakdown}` : '',
        coverageBySlot.get(key) || '',
        weatherLine,
        ...reportLines
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
    'name',
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

function isOfficePlanSlot(slot = {}) {
  const text = [
    slot?.label,
    slot?.bestFor,
    slot?.coverage,
    slot?.planNote,
    slot?.occasion
  ].filter(Boolean).join(' ').toLowerCase()
  if (!text || slot.activity === 'walking' || slot.activity === 'hiking') return false
  return /\b(office|work\s*(day|days|week)?|workday|client[- ]?facing|client|meeting)\b/.test(text) // ratchet-allow: slot-register classifier, not garment matching
}

function isClientPlanSlot(slot = {}) {
  const text = [
    slot?.label,
    slot?.bestFor,
    slot?.coverage,
    slot?.planNote
  ].filter(Boolean).join(' ').toLowerCase()
  return /\b(client|meeting|client[- ]?facing)\b/.test(text) // ratchet-allow: slot-register classifier, not garment matching
}

function pieceOfficePolishScore(piece = {}) {
  if (!piece) return 0
  let score = 0
  if (piece.formality === 'elevated') score += 8
  if (piece.formality === 'dressy') score += 4
  if (tripPieceHasStructuredValue(piece, ['tailored', 'structured', 'polished', 'blouse', 'button', 'button_down', 'button-shirt', 'trouser', 'straight', 'pencil_skirt', 'knit', 'wool', 'stripe', 'striped'])) score += 12
  if (tripPieceHasStructuredValue(piece, ['botanical', 'floral', 'tropical', 'beach', 'resort', 'gauze', 'gauzy', 'open_toe', 'open-toe', 'espadrille', 'raffia', 'cork'])) score -= 18
  return score
}

function isOfficeStructuredDress(piece = {}) {
  return tripPieceHasStructuredValue(piece, [
    'tailored',
    'structured',
    'polished',
    'knit',
    'wool',
    'stripe',
    'striped',
    'sheath',
    'column',
    'shirt_dress',
    'shirtdress'
  ])
}

// Slot-level register escalation (the step-6 contract's `slot.register`): an
// event weekend wants the marquee slot dressiest — rehearsal 'dressy', ceremony
// 'formal', brunch 'elevated'. Without it the wedding ceremony composed in denim
// flares + a leather zip jacket (the evening scorer credits any dark layer as
// "elevated" and never penalizes denim). Only escalates at dressy+ so everyday /
// elevated slots keep the existing occasion scorers untouched.
const REGISTER_LEVELS = { everyday: 0, elevated: 1, dressy: 2, formal: 3 }

function normalizeRegisterLevel(value = '') {
  const normalized = String(value || '').toLowerCase().trim()
  return normalized in REGISTER_LEVELS ? normalized : ''
}

function tripOutfitRegisterEscalationScore(outfit = {}, slot = {}) {
  const target = REGISTER_LEVELS[slot.register]
  if (!(target >= 1)) return { score: 0, hardRejects: [] }
  const dressy = target >= 2
  const formal = target >= 3
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const dress = pieces.find(piece => wardrobeCategoryGroup(piece) === 'dress')
  const shoe = pieces.find(piece => wardrobeCategoryGroup(piece) === 'shoes')
  const hardRejects = []
  let score = 0

  for (const piece of pieces) {
    const group = wardrobeCategoryGroup(piece)
    // Judge formality by the piece's OWN register and FABRIC — never by print or
    // hemline. A silk botanical maxi is a dressy dress; demoting it for the words
    // "botanical"/"maxi" was wrong (owner ruling). Casual signals: a piece the
    // wardrobe itself tags everyday/casual, a casual fabric, or a casual shoe
    // type. Applies from 'elevated' up, scaled by how dressy.
    if (['everyday', 'casual'].includes(String(piece?.formality || '').toLowerCase())) {
      score -= formal ? 22 : dressy ? 14 : 7
    }
    if (tripPieceHasStructuredValue(piece, ['jersey', 'terry', 'fleece', 'canvas'])) {
      score -= formal ? 26 : dressy ? 16 : 8
    }
    if (group === 'shoes' && tripShoeMatchesAny(piece, ['espadrille', 'wedge', 'wedges', 'cork', 'flip', 'flip-flop', 'slide', 'slides'])) {
      score -= formal ? 40 : dressy ? 24 : 12
    }
    // The rest only kick in at 'dressy'+ — dark structured denim can still read
    // elevated-casual, so it isn't penalized at the 'elevated' rung.
    if (!dressy) continue
    if (group === 'bottom' && tripPieceHasStructuredValue(piece, ['denim', 'jean', 'jeans', 'cargo', 'jogger', 'drawstring'])) {
      score -= formal ? 60 : 34
      if (formal) hardRejects.push('denim/casual bottom too informal for a formal slot')
    }
    if (group === 'outerwear' && tripPieceHasStructuredValue(piece, ['moto', 'zip', 'leather', 'fleece', 'denim', 'utility', 'bomber', 'anorak', 'puffer', 'hoodie'])) {
      score -= formal ? 44 : 24
      if (formal) hardRejects.push('casual jacket too informal for a formal slot')
    }
    if (group === 'top' && ['tee', 'tank', 'sweatshirt', 'hoodie'].includes(garmentKind(piece))) {
      score -= formal ? 26 : 14
    }
    if (group === 'shoes' && tripShoeMatchesAny(piece, ['sneaker', 'sneakers', 'canvas', 'sport'])) {
      score -= formal ? 50 : 28
      if (formal) hardRejects.push('casual shoes too informal for a formal slot')
    }
  }

  // Reward the genuinely dressy anchors a formal slot wants — solid/structured
  // over resort, a dress or refined material, dress heels.
  if (dress) score += 12
  if (shoe && tripShoeMatchesAny(shoe, ['heel', 'heels', 'pump', 'pumps', 'dress flat', 'dress flats', 'mule', 'mules'])) score += 12
  if (pieces.some(piece => tripPieceHasStructuredValue(piece, ['silk', 'satin', 'lace', 'chiffon', 'velvet', 'crepe', 'tailored', 'structured', 'sheath', 'column', 'sequin', 'beaded']))) score += formal ? 16 : 10
  if (pieces.some(piece => piece?.formality === 'dressy' || piece?.formality === 'elevated')) score += 8

  return { score, hardRejects }
}

function tripOutfitOfficeRegisterScore(outfit = {}, slot = {}) {
  if (!isOfficePlanSlot(slot)) return { score: 0, hardRejects: [] }
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const top = pieces.find(piece => wardrobeCategoryGroup(piece) === 'top')
  const bottom = pieces.find(piece => wardrobeCategoryGroup(piece) === 'bottom')
  const dress = pieces.find(piece => wardrobeCategoryGroup(piece) === 'dress')
  const shoe = pieces.find(piece => wardrobeCategoryGroup(piece) === 'shoes')
  const layer = pieces.find(piece => wardrobeCategoryGroup(piece) === 'outerwear')
  const client = isClientPlanSlot(slot)
  const hardRejects = []
  let score = 0

  for (const piece of [top, bottom, dress, shoe, layer]) score += pieceOfficePolishScore(piece)

  if (top) {
    if (garmentKind(top) === 'button-shirt') score += 16
    if (sleeveCoverage(top) === 'sleeveless' && client) score -= 10
  }
  if (bottom) {
    const kind = bottomKind(bottom)
    if (kind === 'pants' || kind === 'trouser') score += 16
    if (kind === 'shorts') {
      score -= client ? 80 : 42
      if (client) hardRejects.push('shorts too casual for client meeting')
    }
    if (kind?.startsWith('skirt')) score += 8
  }
  if (dress) {
    score += 8
    const officeStructuredDress = isOfficeStructuredDress(dress)
    if (officeStructuredDress) score += client ? 18 : 12
    if (tripPieceHasStructuredValue(dress, ['maxi', 'flowing', 'full_skirt', 'a_line_skirt', 'botanical', 'floral', 'lace', 'black_lace', 'resort'])) score -= client ? 46 : 28
    if (sleeveCoverage(dress) === 'sleeveless' && client && !layer) score -= 22
    if (client && !layer && !officeStructuredDress) {
      score -= 36
      hardRejects.push('dress lacks enough office structure for client meeting')
    }
  }
  if (shoe) {
    if (tripShoeMatchesAny(shoe, ['loafer', 'loafers', 'flat', 'flats', 'ballet flat', 'ballet flats', 'pointed', 'block heel', 'block heels', 'pump', 'pumps'])) score += 18
    if (tripShoeMatchesAny(shoe, ['sandal', 'sandals', 'open toe', 'open-toe', 'espadrille', 'wedge', 'wedges', 'cork'])) {
      score -= client ? 46 : 26
      if (client) hardRejects.push('open casual shoes too informal for client meeting')
    }
  }
  if (client) {
    score += 8
    if (layer) score += 12
    if (!top && !bottom && dress && !layer) score -= 8
  }
  return { score, hardRejects }
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
  // When the forecast is live, it is authoritative — the slot.season text may
  // still carry the trip-level weather (e.g. an inland "hot, 90F") that must NOT
  // re-inject heat into a slot whose own forecast came back cool (the coastal
  // microclimate miss, #56). The season-text regex stays a fallback only when
  // the profile is heuristic.
  const liveWeather = weatherProfile?.weatherSource === 'live'
  const isHotDay = Boolean(weatherProfile?.isHot) || (!liveWeather && /\b(hot|80|90|summer)\b/i.test(`${slot.season || ''} ${slot.bestFor || ''}`))
  const isHotNonDinner = isHotDay && !isDinner
  const isColdDay = Boolean(weatherProfile?.isCold) || (!liveWeather && /\b(cold|freezing|winter|chilly)\b/i.test(`${slot.season || ''} ${slot.bestFor || ''}`))
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

  const officeFit = tripOutfitOfficeRegisterScore(outfit, slot)
  score += officeFit.score
  hardRejects.push(...officeFit.hardRejects)
  const registerFit = tripOutfitRegisterEscalationScore(outfit, slot)
  score += registerFit.score
  hardRejects.push(...registerFit.hardRejects)
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

function describeWeatherProfile(profile = {}) {
  if (profile.isHot && profile.isCold) return 'hot days, cold nights'
  if (profile.isHot) return 'hot'
  if (profile.isCold) return 'cold'
  return 'mild'
}

function isGenericSeason(season = '') {
  const value = String(season || '').trim().toLowerCase()
  return !value || value === 'current season' || value === 'current' || value === 'year-round'
}

function isIndoorPlanSlot(slot = {}, { occasion = '', activity = '' } = {}) {
  const text = [
    slot?.label,
    slot?.best_for,
    slot?.bestFor,
    slot?.coverage,
    slot?.plan_note,
    slot?.planNote,
    occasion
  ].filter(Boolean).join(' ').toLowerCase()
  if (!text || activity === 'walking' || activity === 'hiking') return false
  if (/\b(outdoor|outside|patio|garden|hike|hiking|walk|walking|sightseeing|winery|wineries|coast|beach)\b/.test(text)) return false // ratchet-allow: slot-place classifier, not garment matching
  return /\b(office|work\s*(day|days|week)?|workday|client[- ]?facing|client|meeting|restaurant|indoor)\b/.test(text) // ratchet-allow: slot-place classifier, not garment matching
}

// Per-slot weather resolution (build step 3). Precedence: user-stated per-slot
// weather wins outright (the model set slot.weather because it knows something
// the forecast can't — e.g. an indoor event); otherwise the slot's own live
// forecast is fetched from slot.location + slot.date (or the plan date_range),
// which is what catches microclimates like a cool coast day on a hot inland
// trip; and getWeatherProfileForPlan itself falls back to the heuristic when no
// location/date is available or the fetch fails. The returned `label` is what
// the plan lines state back to the user so they can correct it conversationally.
async function resolveSlotWeather(slot = {}, { mood = '', question = '', dateRange = {}, fetchImpl } = {}) {
  const moodText = mood || question
  if (slot.statedWeather) {
    return {
      profile: { ...weatherProfileFromContext({ mood: moodText, season: slot.statedWeather }), weatherSource: 'stated' },
      label: slot.statedWeather
    }
  }
  // Fall back to `undefined` (not '') when no date is known: getWeatherProfileForPlan
  // threads the start date into the heuristic as currentDate, and only `undefined`
  // lets weatherProfileFromContext default to today for its "current season"
  // calendar guess — an empty string reads as a provided-but-invalid Date and
  // silently disables it, which would regress the keyword pre-route's weather.
  const day = slot.date || undefined
  const profile = await getWeatherProfileForPlan({
    dateRange: { start: day || dateRange.start || undefined, end: day || dateRange.end || dateRange.start || undefined },
    location: slot.location || '',
    season: slot.season,
    mood: moodText,
    ...(fetchImpl ? { fetchImpl } : {})
  })
  const descriptor = describeWeatherProfile(profile)
  if (profile.weatherSource === 'live') {
    const where = slot.location ? `, ${slot.location}` : ''
    return { profile, label: `${descriptor} (live forecast${where})` }
  }
  // Heuristic: prefer the user's own weather phrasing when they gave one, since
  // it is more informative than the coarse hot/cold/mild descriptor.
  return { profile, label: isGenericSeason(slot.season) ? descriptor : slot.season }
}

const REUSE_MODES = new Set(['maximize', 'diversify', 'none'])
const REPEAT_CATEGORY_GROUPS = new Set(['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'])

// Map the model's per-category repeat words onto the engine's category groups.
// wardrobeCategoryGroup already folds plurals ('tops' -> 'top', 'shoes' -> 'shoes')
// and most garment nouns; 'layers' is the one planning word it doesn't cover.
function normalizeRepeatCategory(value = '') {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  if (/^layers?$/.test(raw)) return 'outerwear'
  const group = wardrobeCategoryGroup(raw)
  return REPEAT_CATEGORY_GROUPS.has(group) ? group : ''
}

function toCategorySet(list = []) {
  const set = new Set()
  for (const value of Array.isArray(list) ? list : []) {
    const group = normalizeRepeatCategory(value)
    if (group) set.add(group)
  }
  return set
}

// Shared-constraint parsing (build step 4). The signed reuse dial + per-category
// repeat rules + the anchor exemption — the dimensions the multi-scenario shape
// validation surfaced (packing wants maximum reuse; a work week wants tops
// diversified but shoes may repeat; a pinned new piece must be exempt from
// no_repeat or the two constraints contradict).
export function normalizePlanConstraints(raw = {}) {
  const reuseRaw = String(raw?.reuse || '').trim().toLowerCase()
  const reuse = REUSE_MODES.has(reuseRaw) ? reuseRaw : ''
  const noRepeat = toCategorySet(raw?.no_repeat)
  const allowRepeat = toCategorySet(raw?.allow_repeat)
  // A category listed in both is a contradiction; explicit permission wins.
  for (const category of allowRepeat) noRepeat.delete(category)
  const anchorIds = new Set(
    (Array.isArray(raw?.shared_anchor_ids) ? raw.shared_anchor_ids : [])
      .map(id => Number(id))
      .filter(Boolean)
  )
  const budgetRaw = Number.parseInt(raw?.piece_budget, 10)
  const pieceBudget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : 0
  return { reuse, noRepeat, allowRepeat, anchorIds, pieceBudget }
}

function outfitCategoryPairs(outfit = {}) {
  return (Array.isArray(outfit.pieces) ? outfit.pieces : [])
    .map(piece => ({ id: Number(piece?.id), group: wardrobeCategoryGroup(piece) }))
    .filter(pair => pair.id)
}

export async function composeOutfitSet({ slots = [], question = '', mood = '', allPieces = [], seedOutfits = [], source = 'trip_precompose', dateRange = {}, constraints = {}, fetchImpl } = {}) {
  const picked = []
  const seeded = seedTripUsedSets(seedOutfits)
  const usedKeys = seeded.usedKeys
  const usedTopBottom = seeded.usedTopBottom
  const { reuse: reuseMode, noRepeat: noRepeatCats, anchorIds, pieceBudget } = normalizePlanConstraints(constraints)
  // Set-scoped piece bookkeeping for the reuse dial + no_repeat. usedPieceIds
  // seeds from any prior set (a replan) so novelty is measured against what the
  // user already has; the per-category map only accumulates within this
  // composition (seed outfits don't reliably carry category), which is enough —
  // no_repeat is a within-set guarantee.
  const usedPieceIds = new Set()
  const usedPieceIdsByCategory = new Map()
  for (const outfit of Array.isArray(seedOutfits) ? seedOutfits : []) {
    const ids = outfit?.pieceIds || (outfit?.pieces || []).map(piece => piece?.id)
    for (const id of ids || []) {
      const numeric = Number(id)
      if (numeric) usedPieceIds.add(numeric)
    }
  }
  const violatesNoRepeat = outfit => {
    if (!noRepeatCats.size) return false
    for (const { id, group } of outfitCategoryPairs(outfit)) {
      if (!noRepeatCats.has(group) || anchorIds.has(id)) continue
      if (usedPieceIdsByCategory.get(group)?.has(id)) return true
    }
    return false
  }
  const overlapCount = outfit => {
    let count = 0
    for (const { id } of outfitCategoryPairs(outfit)) {
      if (!anchorIds.has(id) && usedPieceIds.has(id)) count += 1
    }
    return count
  }
  const anchorPresence = outfit => {
    if (!anchorIds.size) return 0
    let count = 0
    for (const { id } of outfitCategoryPairs(outfit)) {
      if (anchorIds.has(id)) count += 1
    }
    return count
  }
  const recordOutfitUse = outfit => {
    for (const { id, group } of outfitCategoryPairs(outfit)) {
      usedPieceIds.add(id)
      if (!usedPieceIdsByCategory.has(group)) usedPieceIdsByCategory.set(group, new Set())
      usedPieceIdsByCategory.get(group).add(id)
    }
  }
  const slotWeather = []
  for (const slot of slots) {
    const { profile: weatherProfile, label: weatherLabel } = await resolveSlotWeather(slot, { mood, question, dateRange, fetchImpl })
    slotWeather.push({ label: slot.label, weather: weatherLabel })
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
    // Hard-pin a shared anchor by forcing it into candidate generation
    // (soft-pinning can't surface a piece the composer never pairs). Only one
    // piece can be forced per slot, so we pin the first anchor; the rest keep
    // the exemption + soft-pin. If forcing yields nothing for this slot (the
    // anchor is gated out or won't complete a valid outfit here), fall back to
    // composing the slot without it — "recurs in every slot it fits".
    const anchorPieceId = anchorIds.size ? [...anchorIds][0] : null
    const buildSlotLocalOutfits = requiredPieceId => {
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
        question,
        ...(requiredPieceId ? { requiredPieceId } : {})
      })
      return wholeWardrobeOutfitsFromCandidates(candidates, allowedPieces, {
        occasion: slot.occasion,
        mood: mood || question,
        season: slot.season,
        weatherProfile,
        activity: slot.activity,
        request: question,
        question
      }).filter(outfit => isOutfitStructurallyValid(outfit?.pieces || [], { requireShoes: true }))
    }
    let localOutfits = buildSlotLocalOutfits(anchorPieceId)
    if (anchorPieceId && !localOutfits.length) localOutfits = buildSlotLocalOutfits(null)
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
    const chooseScoredOutfit = (items, { avoidUsedFormula = true, enforceNoRepeat = true, preferUnusedBottomSilhouette = false } = {}) => {
      const available = items.filter(({ outfit }) => {
        const key = tripOutfitKey(outfit)
        if (!key || usedKeys.has(key)) return false
        const formulaKey = tripOutfitFormulaKey(outfit)
        if (avoidUsedFormula && formulaKey && usedTopBottom.has(formulaKey)) return false
        if (enforceNoRepeat && violatesNoRepeat(outfit)) return false
        return true
      })
      if (!available.length) return null
      // 1) Soft-pin shared anchors across the WHOLE available set (not just the
      // fit-tolerance window) so a pinned piece recurs in every slot it can fit —
      // "one piece styled several ways" is the whole point of an anchor.
      let anchored = available
      if (anchorIds.size) {
        const maxAnchors = Math.max(...available.map(item => anchorPresence(item.outfit)))
        if (maxAnchors > 0) anchored = available.filter(item => anchorPresence(item.outfit) === maxAnchors)
      }
      const best = anchored[0]
      // Never let the variety / reuse re-rank swap an accepted outfit for a
      // hard-rejected one (e.g. denim at a formal slot, shorts at a client
      // meeting) just because it adds a new silhouette: hold the pool at the
      // best's acceptance tier. anchored is already sorted accepted-first, so
      // best.fit.accepted tells us whether any acceptable outfit exists.
      const tier = best.fit.accepted ? anchored.filter(item => item.fit.accepted) : anchored
      // Re-rank only within a fit tolerance of the best so the constraint dials
      // never override a clearly-better-fitting outfit for a marginal one.
      let pool = tier.filter(item => item.fit.score >= best.fit.score - 36)
      if (!pool.length) pool = [best]
      // 2) Signed reuse dial within that pool.
      if (reuseMode === 'maximize') {
        return [...pool].sort((a, b) => overlapCount(b.outfit) - overlapCount(a.outfit) || b.fit.score - a.fit.score)[0]
      }
      if (reuseMode === 'diversify') {
        return [...pool].sort((a, b) => overlapCount(a.outfit) - overlapCount(b.outfit) || b.fit.score - a.fit.score)[0]
      }
      // 3) No dial: keep the existing bottom-silhouette variety nudge.
      if (preferUnusedBottomSilhouette && slotUsedBottomSilhouettes.size) {
        const varied = pool.find(item => {
          const silhouetteKey = tripBottomSilhouetteKey(item.outfit)
          return silhouetteKey && !slotUsedBottomSilhouettes.has(silhouetteKey)
        })
        if (varied) return varied
      }
      return pool[0]
    }
    for (let pass = 0; pass < targetOutfits; pass += 1) {
      // Maximizing reuse and varying the bottom silhouette pull in opposite
      // directions, so the silhouette nudge only applies when we aren't packing.
      const preferUnusedBottomSilhouette = pass > 0 && reuseMode !== 'maximize'
      // Relaxation order keeps no_repeat (the user's explicit rule) as the last
      // thing to give, ahead of formula variety (a nice-to-have).
      const choice = chooseScoredOutfit(scoredOutfits, { avoidUsedFormula: true, enforceNoRepeat: true, preferUnusedBottomSilhouette })?.outfit ||
        chooseScoredOutfit(scoredOutfits, { avoidUsedFormula: false, enforceNoRepeat: true, preferUnusedBottomSilhouette })?.outfit ||
        chooseScoredOutfit(scoredOutfits, { avoidUsedFormula: true, enforceNoRepeat: false, preferUnusedBottomSilhouette })?.outfit ||
        chooseScoredOutfit(scoredOutfits, { avoidUsedFormula: false, enforceNoRepeat: false })?.outfit
      if (!choice) break
      const key = tripOutfitKey(choice)
      const formulaKey = tripOutfitFormulaKey(choice)
      const bottomSilhouetteKey = tripBottomSilhouetteKey(choice)
      usedKeys.add(key)
      if (formulaKey) usedTopBottom.add(formulaKey)
      if (bottomSilhouetteKey) slotUsedBottomSilhouettes.add(bottomSilhouetteKey)
      recordOutfitUse(choice)
      slotChoices.push(choice)
    }
    slotChoices.forEach((choice, slotIndex) => {
      picked.push(annotateTripOutfit(choice, slot, picked.length, {
        slotIndex,
        slotTotal: slotChoices.length,
        source,
        weatherLabel
      }))
    })
  }
  return attachTripPlanMetadata(picked, { source, slotWeather, reuseMode, noRepeatCats, pieceBudget })
}

// Tool-argument slots (plan_outfit_set) -> engine slots. Mirrors the pre-route
// planner's normalizePlannerSlots (routes/ai.js), which keeps its own copy
// until the keyword pre-route retires on diagnostics evidence.
export const PLAN_TOTAL_OUTFIT_CAP = 8

export function normalizePlanSlots(rawSlots = [], {
  fallbackWeather = '',
  fallbackOccasion = 'city',
  fallbackActivity = 'none',
  fallbackLocation = '',
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
      // statedWeather is ONLY the model's explicit per-slot weather — it wins
      // over the live forecast. The trip-level fallbackWeather is not "stated"
      // for this purpose: it feeds season/heuristic but must let a slot's own
      // forecast override it (that is the coastal-microclimate case).
      const explicitWeather = String(slot?.weather || slot?.stated_weather || '').trim()
      const statedWeather = explicitWeather || (isIndoorPlanSlot(slot, { occasion, activity }) ? 'indoor' : '')
      return {
        id: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `slot_${index + 1}`,
        label,
        occasion,
        activity,
        season: String(statedWeather || slot?.season || fallbackWeather || 'current season').trim(),
        statedWeather,
        location: String(slot?.location || fallbackLocation || '').trim(),
        date: String(slot?.date || '').trim(),
        bestFor,
        coverage: String(slot?.coverage || bestFor || label).trim(),
        targetOutfits: Math.min(3, Math.max(1, Number.parseInt(slot?.count, 10) || 1)),
        register: normalizeRegisterLevel(slot?.register),
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
