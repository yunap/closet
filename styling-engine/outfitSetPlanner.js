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
  wardrobeCategoryGroup,
  footwearComfortVerdict
} from './rules.js'
import { bottomKind, fabricWeight, garmentKind, isDarkPiece, pieceMatchesFootwear, sleeveCoverage, formalityRank, pieceFormality } from './attributes.js'
import { resolveActivityProfile, resolveComfortFootwearConstraint, applyComfortFootwearRepair } from './footwear-comfort.js'
import { normalizeOccasion, normalizeActivity } from './stylingIntent.js'
import { resolveOccasionProfile } from './occasions.js'

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

// Per-slot coverage gaps (capsule review Point 2): when the wardrobe can't
// fill a slot's requested count, that used to just be a thin/missing card with
// no explanation — the model had no deterministic signal to notice or explain
// it. Uses data the composer already computed (how many distinct outfits
// passed the gates vs how many candidates existed at all) rather than
// guessing WHICH category is missing, matching the "flag, don't guess"
// discipline: a wrong specific guess (e.g. "missing shoes" when the real
// issue was weather) would be worse than an honest, general gap note.
function describeSlotCoverageGap(slot = {}, { requestedCount = 0, composedCount = 0, candidateCount = 0, exhaustedByUsedCombos = false, compatibleCombinationCount = 0, ceilingRank = null, composedBy = 'engine' } = {}) {
  if (composedCount >= requestedCount) return ''
  const label = slot?.label || slot?.bestFor || 'this use case'
  const ceilingLabel = ['lounge', 'everyday', 'elevated', 'dressy'][ceilingRank] || 'compatible'
  if (composedBy === 'model') {
    const submittedWord = composedCount === 1 ? 'outfit was' : 'outfits were'
    return `[coverage gap: "${label}" needed ${requestedCount} look${requestedCount === 1 ? '' : 's'} but only ${composedCount} valid ${submittedWord} submitted — the other attempts failed validation]`
  }
  if (exhaustedByUsedCombos) {
    const supported = Math.max(composedCount, compatibleCombinationCount)
    return `[missing wardrobe gap: "${label}" needed ${requestedCount} distinct look${requestedCount === 1 ? '' : 's'} but the capsule roster only supports ${supported} before repeating — not enough distinct ${ceilingLabel}-compatible combinations for the full rotation]`
  }
  if (composedCount === 0) {
    return candidateCount > 0
      ? `[missing wardrobe gap: "${label}" — no outfit passed the ${slot.occasion || 'occasion'}/weather/register gates; the wardrobe may be missing a category (top, bottom, dress, or shoes) suited to this use case]`
      : `[missing wardrobe gap: "${label}" — no candidate outfit could be assembled for ${slot.occasion || 'this occasion'}; the wardrobe may be missing a category (top, bottom, dress, or shoes) for this use case]`
  }
  return `[missing wardrobe gap: "${label}" needed ${requestedCount} distinct look${requestedCount === 1 ? '' : 's'} but the wardrobe only supports ${composedCount} — not enough variety for the full rotation]`
}

// Distinct from describeSlotCoverageGap: that one fires when the WARDROBE
// can't fill a slot's requested count. This one fires when the PLAN itself
// asked for more outfits than PLAN_TOTAL_OUTFIT_CAP allows across the whole
// set, so normalizePlanSlots silently trimmed the slot's count before the
// wardrobe was ever asked — a live capsule test asked for 10 outfits across 5
// slots and got 8 with no signal anywhere that 2 were dropped. Both can fire
// for the same slot (the cap trims it AND the wardrobe still can't fill the
// reduced count) — they describe different causes and are both true.
function describePlanCapTrim(slot = {}) {
  const requested = Number(slot?.requestedOutfits) || 0
  const actual = Number(slot?.targetOutfits) || 0
  if (!requested || requested <= actual) return ''
  const label = slot?.label || slot?.bestFor || 'this use case'
  const cap = Number(slot?.totalOutfitCap) || PLAN_TOTAL_OUTFIT_CAP
  return `[plan trimmed: "${label}" reduced from ${requested} to ${actual} look${actual === 1 ? '' : 's'} — the plan asked for more outfits than the ${cap}-outfit total across the set allows]`
}

function buildCoverageGapLines(coverageGaps = []) {
  return (Array.isArray(coverageGaps) ? coverageGaps : []).filter(Boolean)
}

function attachTripPlanMetadata(outfits = [], { source = 'trip_precompose', composedBy = 'engine', slotWeather = [], reuseMode = '', noRepeatCats = new Set(), pieceBudget = 0, coverageGaps = [] } = {}) {
  const tripOutfits = outfits.filter(outfit => outfit?.source === source)
  if (!tripOutfits.length) return outfits
  const durationLabel = source === 'plan_outfit_set' ? 'Plan length' : 'Trip length'
  const pieceReuse = describeTripPieceReuse(tripOutfits)
  const reportLines = buildPlanReport(pieceReuse, tripOutfits, { reuseMode, noRepeatCats, pieceBudget })
  const weatherLine = buildWeatherLine(slotWeather)
  const gapLines = buildCoverageGapLines(coverageGaps)
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
      composedBy,
      pieceReuse,
      coverageLine: coverageBySlot.get(key) || '',
      tripPlanLines: [
        outfit.tripSummary?.durationText ? `${durationLabel}: ${outfit.tripSummary.durationText}` : '',
        outfit.tripSummary?.dayBreakdown ? `Coverage: ${outfit.tripSummary.dayBreakdown}` : '',
        coverageBySlot.get(key) || '',
        weatherLine,
        ...reportLines,
        ...gapLines
      ].filter(Boolean)
    }
  })
}

function tripSlotComfortConstraint(slot = {}, baseConstraint = null) {
  if (slot.activity !== 'walking') return baseConstraint
  if (slotWantsElevatedShoe(slot)) return baseConstraint
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

// Season-appropriate shoes, by the piece's OWN season tag — never by material
// name. A material like suede can be a summer pump or a winter boot; there is
// no such thing as "suede is a cold-weather material" as a general rule
// (owner correction, 2026-07-14, walking back an earlier material-based
// framing of this same gap). The wardrobe's own `season` tag ('warm'/'cool'/
// 'year-round') is the actual signal the owner tags each piece with, so use
// that directly instead of guessing from fabric/construction words.
function tripShoeSeasonScore(shoe = {}, { isHotDay = false, isColdDay = false } = {}) {
  const season = String(shoe?.season || '').toLowerCase()
  if (season === 'cool' && isHotDay) return -24
  if (season === 'warm' && isColdDay) return -24
  return 0
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

  if (dress) {
    score += 34
    if (tripPieceHasStructuredValue(dress, ['technical', 'performance', 'swim', 'cover_up', 'cover-up', 'beach', 'terry'])) score -= 54
  }
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

function isSmartCasualPlanSlot(slot = {}) {
  const text = [
    slot?.label,
    slot?.bestFor,
    slot?.coverage,
    slot?.planNote,
    slot?.occasion
  ].filter(Boolean).join(' ').toLowerCase()
  return /\bsmart[- ]?casual\b/.test(text) // ratchet-allow: slot-register classifier, not garment matching
}

function textLooksLikeEveningPlanSlot(text = '') {
  return /\b(dinners?|dining|restaurants?|drinks|wine bars?|night out|date night|evenings?)\b/i.test(String(text || '')) // ratchet-allow: slot-use-case classifier, not garment matching
}

function textLooksLikeCoastalPlanSlot(text = '') {
  return /\b(beach(?:es)?|pool(?:side)?|swim(?:ming)?|coast(?:al)?|seaside|oceanfront|shore|sand)\b/i.test(String(text || '')) // ratchet-allow: slot-use-case classifier, not garment matching
}

function normalizePlanSlotEnvironment({ label = '', bestFor = '', coverage = '', planNote = '', location = '' } = {}) {
  const text = [label, bestFor, coverage, planNote, location].filter(Boolean).join(' ')
  return textLooksLikeCoastalPlanSlot(text) ? 'beach_coastal' : ''
}

function normalizePlanEnvironment(rawEnvironment = '') {
  const value = String(rawEnvironment || '').trim().toLowerCase()
  return ['indoor', 'outdoor', 'beach_coastal'].includes(value) ? value : ''
}

function normalizePlanSlotOccasion(rawOccasion = '', { label = '', bestFor = '', coverage = '', planNote = '', environment = '' } = {}) {
  const occasion = normalizeOccasion(rawOccasion)
  const text = [label, bestFor, coverage, planNote].filter(Boolean).join(' ')
  if (occasion === 'outdoor_daytime_social' && environment === 'beach_coastal') return 'casual'
  if ((occasion === 'casual' || occasion === 'city') && textLooksLikeEveningPlanSlot(text)) return 'evening'
  return occasion
}

function slotWantsElevatedShoe(slot = {}) {
  const text = [slot?.label, slot?.bestFor, slot?.coverage, slot?.planNote, slot?.occasion].filter(Boolean).join(' ')
  const occasion = normalizeOccasion(slot?.occasion)
  return occasion === 'evening' ||
    occasion === 'gallery / art event' ||
    isSmartCasualPlanSlot(slot) ||
    textLooksLikeEveningPlanSlot(text)
}

function pieceOfficePolishScore(piece = {}) {
  if (!piece) return 0
  let score = 0
  if (piece.formality === 'elevated') score += 8
  if (piece.formality === 'dressy') score += 4
  if (tripPieceHasStructuredValue(piece, ['tailored', 'structured', 'polished', 'blouse', 'button', 'button_down', 'button-shirt', 'trouser', 'straight', 'pencil_skirt', 'knit', 'wool', 'stripe', 'striped'])) score += 12
  // Judge casualness by the piece's OWN formality tag and FABRIC — never by
  // print (owner ruling from #68: a silk botanical piece is not casual for
  // having a print; print/hemline are not formality signals). Shoe
  // CONSTRUCTION type (open-toe/espadrille/cork) is a legitimate signal but is
  // handled role-scoped in the shoe block below, not blindly here across
  // every role.
  if (['everyday', 'casual'].includes(String(piece?.formality || '').toLowerCase())) score -= 14
  if (tripPieceHasStructuredValue(piece, ['gauze', 'gauzy', 'jersey', 'terry', 'fleece', 'canvas'])) score -= 12
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
    // Judge by the dress's OWN formality tag and FABRIC — never by print or
    // silhouette (owner ruling from #68: a silk botanical maxi is not casual
    // for having a print; length/print say nothing about formality). 'lace'
    // was dropped from the old list entirely — it's a POSITIVE dressy-fabric
    // signal elsewhere in this file, so demoting it here was self-contradictory.
    if (['everyday', 'casual'].includes(String(dress?.formality || '').toLowerCase())) score -= client ? 32 : 20
    if (tripPieceHasStructuredValue(dress, ['gauze', 'gauzy', 'jersey', 'terry', 'fleece', 'canvas'])) score -= client ? 30 : 18
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

function tripOutfitSmartCasualRegisterScore(outfit = {}, slot = {}) {
  if (!isSmartCasualPlanSlot(slot)) return { score: 0, hardRejects: [] }
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const nonShoePieces = pieces.filter(piece => wardrobeCategoryGroup(piece) !== 'shoes')
  const elevatedRank = formalityRank('elevated')
  const hasElevatedAnchor = nonShoePieces.some(piece => {
    const rank = formalityRank(pieceFormality(piece))
    return rank !== null && elevatedRank !== null && rank >= elevatedRank
  })
  const hardRejects = []
  let score = hasElevatedAnchor ? 12 : -46
  if (!hasElevatedAnchor) hardRejects.push('no elevated non-shoe anchor for smart casual')
  for (const piece of nonShoePieces) {
    if (piece?.formality === 'elevated') score += 8
    if (piece?.formality === 'dressy') score += 4
    if (['everyday', 'casual'].includes(String(piece?.formality || '').toLowerCase())) score -= 10
  }
  return { score, hardRejects }
}

// An outdoor-ACTIVE slot (a hike, a park/market wander, "outdoor adventures") is
// not a winery: it wants sneakers/practical shoes and rugged casual pieces, not
// leather loafers and city-casual. outdoor_daytime_social alone can't tell a
// winery from a hike, so read the slot's own words + a hiking activity.
function isOutdoorActivePlanSlot(slot = {}) {
  if (slot.activity === 'hiking') return true
  const text = [slot?.label, slot?.bestFor, slot?.coverage, slot?.planNote].filter(Boolean).join(' ').toLowerCase()
  if (/\b(winery|wineries|gallery|museum|dinner|restaurant|wedding|ceremony)\b/.test(text)) return false // ratchet-allow: slot-place classifier, not garment matching
  return /\b(hike|hiking|trail|trek|park|nature|outdoor|outdoors|adventure|adventures|market|sightsee|sightseeing|walk in|hills?|trailhead)\b/.test(text) // ratchet-allow: slot-place classifier, not garment matching
}

function isBeachCoastalPlanSlot(slot = {}) {
  return slot?.environment === 'beach_coastal'
}

function beachCoastalStatedWeather(explicitWeather = '', { environment = '' } = {}) {
  const weather = String(explicitWeather || '').trim()
  if (!weather) return ''
  // Models sometimes mark a beach slot as `weather:"indoor"` because they are
  // thinking "trip day" rather than physical environment. For a beach/coastal
  // slot, that is contradictory; let the plan-level weather or live forecast
  // drive the slot instead.
  if (environment === 'beach_coastal' && /^indoor$/i.test(weather)) return ''
  return weather
}

function tripOutfitBeachCoastalScore(outfit = {}, slot = {}, { isHotDay = false, isColdDay = false } = {}) {
  if (!isBeachCoastalPlanSlot(slot)) return { score: 0, hardRejects: [] }
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const top = pieces.find(piece => wardrobeCategoryGroup(piece) === 'top')
  const bottom = pieces.find(piece => wardrobeCategoryGroup(piece) === 'bottom')
  const dress = pieces.find(piece => wardrobeCategoryGroup(piece) === 'dress')
  const shoe = pieces.find(piece => wardrobeCategoryGroup(piece) === 'shoes')
  const layer = pieces.find(piece => wardrobeCategoryGroup(piece) === 'outerwear')
  let score = 0

  const washableEasySignals = ['technical', 'performance', 'nylon', 'polyester', 'cotton', 'linen', 'rayon', 'viscose', 'tencel', 'jersey', 'terry', 'canvas']
  const beachSpecificSignals = ['technical', 'performance', 'swim', 'swimsuit', 'cover_up', 'cover-up', 'terry', 'nylon', 'sport', 'beach']
  const fussySignals = ['silk', 'satin', 'suede', 'leather', 'lace', 'chiffon', 'sheer', 'velvet', 'beaded', 'sequin']

  for (const piece of pieces) {
    if (tripPieceHasStructuredValue(piece, washableEasySignals)) score += 8
    if (tripPieceHasStructuredValue(piece, beachSpecificSignals)) score += 12
    if (fabricWeight(piece) === 'light') score += isHotDay ? 8 : 4
    if (fabricWeight(piece) === 'heavy' && isHotDay) score -= 18
    if (tripPieceHasStructuredValue(piece, fussySignals)) score -= 14
    if (piece?.formality === 'dressy') score -= 16
  }

  if (dress) {
    score += isHotDay ? 24 : 14
    if (tripPieceHasStructuredValue(dress, ['technical', 'performance', 'swim', 'cover_up', 'cover-up'])) score += 28
    if (isHotDay && sleeveCoverage(dress) === 'sleeveless') score += 12
  }
  if (top && bottom) {
    if (garmentKind(top) === 'tee' || garmentKind(top) === 'tank') score += 8
    const kind = bottomKind(bottom)
    if (kind === 'shorts') score += isHotDay ? 24 : 4
    if ((kind === 'pants' || kind === 'trouser') && !isHotDay) score += 6
    if ((kind === 'pants' || kind === 'trouser') && isHotDay) score -= 18
    if (tripPieceHasStructuredValue(bottom, ['cargo', 'tailored', 'trouser', 'wide_leg']) && isHotDay) score -= 16
  }
  if (shoe) {
    if (tripShoeMatchesAny(shoe, ['sneaker', 'sneakers', 'canvas', 'sport sandal', 'sport sandals', 'slide', 'slides', 'slip-on', 'slip-ons', 'slip on'])) score += 12
    if (tripShoeMatchesAny(shoe, ['heel', 'heels', 'pump', 'pumps', 'mule', 'mules', 'wedge', 'wedges', 'ballet flat', 'ballet flats', 'dress flat', 'dress flats'])) score -= 24
    if (tripPieceHasStructuredValue(shoe, ['suede', 'leather']) && isHotDay) score -= 10
  }
  if (isColdDay) {
    if (layer) score += 14
    else score -= 12
  } else if (layer && isHotDay) {
    score -= 12
  }
  return { score, hardRejects: [] }
}

function beachCoastalNeedsLayer(slot = {}, { weatherProfile = {} } = {}) {
  if (!isBeachCoastalPlanSlot(slot)) return false
  if (weatherProfile?.isHot) return false
  if (weatherProfile?.isCold) return true
  const text = [slot?.label, slot?.bestFor, slot?.coverage, slot?.planNote, slot?.season]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return /\b(cool|windy|wind|breezy|chilly|fog|foggy|marine layer)\b/.test(text) // ratchet-allow: slot weather/environment classifier, not garment matching
}

function tripOutfitElevatedOccasionShoeScore(outfit = {}, slot = {}) {
  if (!slotWantsElevatedShoe(slot)) return { score: 0, hardRejects: [] }
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const shoe = pieces.find(piece => wardrobeCategoryGroup(piece) === 'shoes')
  let score = 0
  if (shoe) {
    if (pieceMeetsFloorRank(shoe, formalityRank('elevated')) || isDinnerShoeRegister(shoe)) score += 28
    if (isCasualDinnerShoe(shoe) || tripShoeMatchesAny(shoe, ['canvas', 'sneaker', 'sneakers', 'slip-on', 'slip-ons', 'slip on'])) score -= 45
  }
  for (const piece of pieces) {
    if (pieceMeetsFloorRank(piece, formalityRank('elevated'))) score += 6
    if (tripPieceHasStructuredValue(piece, ['cargo', 'drawstring', 'graphic']) && wardrobeCategoryGroup(piece) !== 'shoes') score -= 14
    if (tripPieceHasStructuredValue(piece, ['technical', 'performance', 'swim', 'cover_up', 'cover-up', 'beach', 'terry']) && wardrobeCategoryGroup(piece) !== 'shoes') score -= 34
  }
  return { score, hardRejects: [] }
}

function tripSlotFitScore(outfit = {}, slot = {}, { weatherProfile = {}, isSummerContext = false } = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const top = pieces.find(piece => wardrobeCategoryGroup(piece) === 'top')
  const bottom = pieces.find(piece => wardrobeCategoryGroup(piece) === 'bottom')
  const dress = pieces.find(piece => wardrobeCategoryGroup(piece) === 'dress')
  const shoe = pieces.find(piece => wardrobeCategoryGroup(piece) === 'shoes')
  const layer = pieces.find(piece => wardrobeCategoryGroup(piece) === 'outerwear')
  const isWalking = slot.activity === 'walking'
  const isDinner = isTripDinnerSlot(slot)
  const isWinery = slot.occasion === 'outdoor_daytime_social'
  const isOutdoorActive = isOutdoorActivePlanSlot(slot)
  const isBeachCoastal = isBeachCoastalPlanSlot(slot)
  const isDayWalking = isWalking && !isDinner && !isBeachCoastal && !slotWantsElevatedShoe(slot)
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
  if (shoe) score += tripShoeSeasonScore(shoe, { isHotDay, isColdDay })
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
  const smartCasualFit = tripOutfitSmartCasualRegisterScore(outfit, slot)
  score += smartCasualFit.score
  hardRejects.push(...smartCasualFit.hardRejects)
  const registerFit = tripOutfitRegisterEscalationScore(outfit, slot)
  score += registerFit.score
  hardRejects.push(...registerFit.hardRejects)

  // Summer keeps discouraging warm fabrics even when the slot's weather is
  // neutral (an indoor summer evening still shouldn't be all wool): a live-hot
  // slot already filters these, but an `indoor` slot in a summer plan does not.
  if (isSummerContext) {
    for (const piece of pieces) {
      if (fabricWeight(piece) === 'heavy' || tripPieceHasStructuredValue(piece, ['wool', 'cashmere', 'fleece', 'corduroy', 'tweed', 'flannel', 'heavy_knit', 'chunky'])) {
        score -= 22
      }
    }
  }

  // No double open-knit layer: an open/cardigan-style knit TOP under a cardigan
  // outerwear reads as two cardigans (the live capsule bug). Woven button-ups
  // and plain knit tanks under a cardigan are fine — this only fires when the
  // top is itself an open KNIT layer.
  if (layer && top) {
    const layerIsOpenKnit = garmentKind(layer) === 'cardigan' || tripPieceHasStructuredValue(layer, ['cardigan', 'open_cardigan', 'duster', 'kimono', 'wrap'])
    const topIsOpenKnit = tripPieceHasStructuredValue(top, ['knit', 'sweater']) &&
      tripPieceHasStructuredValue(top, ['cardigan', 'open', 'open_front', 'buttoned', 'overshirt', 'kimono', 'wrap', 'duster'])
    if (layerIsOpenKnit && topIsOpenKnit) {
      score -= 30
      hardRejects.push('two open cardigan/knit layers')
    }
  }

  // Outdoor-active slots go rugged: sneakers/practical, never leather loafers or
  // dressy city shoes; lean casual, not silk/dressy.
  if (isOutdoorActive && shoe) {
    if (tripShoeMatchesAny(shoe, ['loafer', 'loafers', 'slip-on', 'slip-ons', 'slip on', 'mule', 'mules', 'heel', 'heels', 'dress shoe', 'dress shoes', 'dress flat', 'dress flats', 'ballet flat', 'ballet flats'])) {
      score -= 40
      hardRejects.push('leather loafers/dress shoes too city-casual for an outdoor-active slot')
    }
    if (tripShoeMatchesAny(shoe, ['sneaker', 'sneakers', 'trainer', 'trainers', 'athletic', 'sport sandal', 'sport sandals', 'walking flat', 'walking flats', 'hiking', 'canvas'])) {
      score += 22
    }
  }
  if (isOutdoorActive) {
    for (const piece of pieces) {
      if (tripPieceHasStructuredValue(piece, ['silk', 'satin', 'lace', 'chiffon', 'sheer', 'delicate']) || piece?.formality === 'dressy') {
        score -= 12
      }
    }
  }

  const beachCoastalFit = tripOutfitBeachCoastalScore(outfit, slot, { isHotDay, isColdDay })
  score += beachCoastalFit.score
  hardRejects.push(...beachCoastalFit.hardRejects)
  const elevatedOccasionFit = tripOutfitElevatedOccasionShoeScore(outfit, slot)
  score += elevatedOccasionFit.score
  hardRejects.push(...elevatedOccasionFit.hardRejects)

  // Register DOWN for a casual/everyday day slot: the escalation scorer only
  // pushes up for dressy/formal, so a casual "city outing" happily pulled a
  // dressy silk maxi. A daytime casual/city slot that isn't explicitly dressed
  // up should demote dressy-formality pieces and dressy shoes.
  const isCasualDaySlot = !isDinner && !isWinery &&
    (slot.register === 'everyday' || (!slot.register && (slot.occasion === 'casual' || slot.occasion === 'city')))
  if (isCasualDaySlot) {
    for (const piece of pieces) {
      if (piece?.formality === 'dressy') score -= 16
    }
    if (shoe && tripShoeMatchesAny(shoe, ['heel', 'heels', 'pump', 'pumps', 'stiletto'])) score -= 10
  }

  // Athletic/sporty pieces belong on a hike, not an "everyday" or dinner slot —
  // the athletic polyester dress that showed up for Everyday Casual.
  if (!isOutdoorActive) {
    for (const piece of pieces) {
      if (tripPieceHasStructuredValue(piece, ['athletic', 'performance', 'activewear', 'sporty', 'gym', 'track', 'running', 'workout', 'sport'])) {
        score -= 24
      }
    }
  }

  // Summer daytime rarely needs a layer: a cardigan at a summer festival (the
  // Outdoor Event look) is superfluous. The forecast-hot path already discounts
  // layers; this covers weather-neutral (indoor/warm-stated) summer daytime.
  if (isSummerContext && layer && !isDinner && !isColdDay) score -= 18

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

function chooseBeachCoastalLayerForOutfit(outfit, allowedPieces = [], slot = {}, { weatherProfile = {}, isSummerContext = false } = {}) {
  if (!beachCoastalNeedsLayer(slot, { weatherProfile })) return outfit
  const pieces = Array.isArray(outfit?.pieces) ? outfit.pieces : []
  if (pieces.some(piece => wardrobeCategoryGroup(piece) === 'outerwear')) return outfit
  const existingIds = new Set(pieces.map(piece => Number(piece.id)).filter(Boolean))
  const baseScore = tripSlotFitScore(outfit, slot, { weatherProfile, isSummerContext }).score
  const options = (allowedPieces || [])
    .filter(piece => wardrobeCategoryGroup(piece) === 'outerwear' && !existingIds.has(Number(piece.id)))
    .map(layer => {
      const nextPieces = [...pieces, layer]
      const candidate = {
        ...outfit,
        pieces: nextPieces,
        pieceIds: nextPieces.map(piece => Number(piece.id)).filter(Boolean)
      }
      const fit = tripSlotFitScore(candidate, slot, { weatherProfile, isSummerContext })
      return { candidate, fit }
    })
    .filter(item => item.fit.accepted && item.fit.score >= baseScore + 4)
    .sort((a, b) => b.fit.score - a.fit.score)
  return options[0]?.candidate || outfit
}

// Candidate generation (buildWholeWardrobeCandidateOutfits -> candidateObjectFromPieces
// in rules.js) trims outfit.pieces down to {id, name, category, photo, worn_photo} for
// the eventual card shape. Every scorer below this point in the file reads structured
// fields that only exist on the full DB row -- formality, fabric_category, colors,
// season, pattern_type -- and against the trimmed shape those checks silently see
// undefined and no-op. (Confirmed live: pieceOfficePolishScore's formality check, added
// in #86 specifically to stop judging register by name/print, was never actually
// firing -- its test still passed only because a fixture dress's NAME happened to
// contain a fabric word ("jersey"), the exact print/name-matching pattern #86 was
// meant to eliminate.) Rehydrate from the slot's own allowed-pieces pool (by id) before
// any scoring runs, so register/office/season/etc. scorers see real data.
function rehydrateOutfitPieces(outfit, pool = []) {
  if (!outfit || !Array.isArray(outfit.pieces) || !outfit.pieces.length) return outfit
  const byId = new Map(pool.map(piece => [Number(piece.id), piece]))
  const pieces = outfit.pieces.map(piece => byId.get(Number(piece.id)) || piece)
  return { ...outfit, pieces }
}

function buildCapsuleStructuralSeparateOutfits(allowedPieces = [], limit = 48) {
  const groups = { top: [], bottom: [], shoes: [] }
  for (const piece of allowedPieces || []) {
    const group = wardrobeCategoryGroup(piece)
    if (groups[group]) groups[group].push(piece)
  }
  const outfits = []
  const seen = new Set()
  for (const top of groups.top.slice(0, 8)) {
    for (const bottom of groups.bottom.slice(0, 8)) {
      for (const shoe of groups.shoes.slice(0, 6)) {
        const pieces = [top, bottom, shoe].filter(Boolean)
        const key = pieces.map(piece => Number(piece.id)).sort((a, b) => a - b).join('|')
        if (!key || seen.has(key)) continue
        seen.add(key)
        outfits.push({
          label: 'Capsule separates',
          title: 'Capsule separates',
          bestFor: 'capsule separates fallback',
          pieces,
          pieceIds: pieces.map(piece => Number(piece.id)).filter(Boolean),
          source: 'plan_outfit_set'
        })
        if (outfits.length >= limit) return outfits
      }
    }
  }
  return outfits
}

function slotCompositionPriority(slot = {}) {
  const occasion = normalizeOccasion(slot?.occasion)
  const rank = effectiveSlotRegisterCeilingRank(slot)
  if (occasion === 'evening') return 40
  if (isBeachCoastalPlanSlot(slot)) return 35
  if (rank !== null) return 10 + rank
  return 0
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

function withBeachCoastalLayerIfUseful(outfit, allowedPieces = [], slot = {}, { weatherProfile = {}, isSummerContext = false } = {}) {
  if (!outfit || !beachCoastalNeedsLayer(slot, { weatherProfile })) return outfit
  const layered = chooseBeachCoastalLayerForOutfit(outfit, allowedPieces, slot, { weatherProfile, isSummerContext })
  const layer = layered.pieces?.find(piece => wardrobeCategoryGroup(piece) === 'outerwear')
  if (!layer || layered === outfit) return outfit
  return {
    ...layered,
    reason: [
      outfit.reason,
      `${layer.name} adds a light coastal layer for wind or cool marine air.`
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
  return /\b(office|work\s*(day|days|week)?|workday|client[- ]?facing|client|meeting|restaurants?|indoor)\b/.test(text) // ratchet-allow: slot-place classifier, not garment matching
}

function hasDeclaredPlanSlotActivity(slot = {}) {
  return slot?.activity !== undefined && slot?.activity !== null && String(slot.activity).trim() !== ''
}

function inferPlanSlotActivityFromProse(slot = {}) {
  const text = [
    slot?.label,
    slot?.best_for,
    slot?.bestFor,
    slot?.coverage,
    slot?.plan_note,
    slot?.planNote
  ].filter(Boolean).join(' ').toLowerCase()
  if (/\b(hike|hiking|trail|trek|trekking)\b/.test(text)) return 'hiking' // ratchet-allow: slot activity classifier, not garment matching
  if (!/\b(gallery|museum|dinner|restaurant|wedding|ceremony)\b/.test(text) && // ratchet-allow: slot activity classifier, not garment matching
      /\b(walk|walking|stroll|strolling|explore|exploring|sightsee|sightseeing|market)\b/.test(text)) { // ratchet-allow: slot activity classifier, not garment matching
    return 'walking'
  }
  return ''
}

function inferPlanSlotActivity(slot = {}, fallbackActivity = 'none') {
  const explicit = normalizeActivity(String(slot?.activity || 'none'))
  if (hasDeclaredPlanSlotActivity(slot)) return explicit || 'none'
  const fallback = normalizeActivity(String(fallbackActivity || 'none'))
  return inferPlanSlotActivityFromProse(slot) || fallback || explicit || 'none'
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

function outfitDressId(outfit = {}) {
  const dress = (Array.isArray(outfit.pieces) ? outfit.pieces : [])
    .find(piece => wardrobeCategoryGroup(piece) === 'dress')
  return Number(dress?.id) || null
}

// Real capsule builder (path 1): when the plan carries a piece_budget, don't
// just REPORT the roster — enforce it. Pre-select ~budget versatile pieces with
// category coverage (a summer capsule must include shorts), then compose the
// slots ONLY from those, so the distinct-piece count actually lands within the
// budget. Below this floor a "capsule" can't cover top+bottom+shoes, so we keep
// the soft-report behavior instead.
const MIN_ENFORCED_CAPSULE_BUDGET = 6
const PLAN_WORKBENCH_PIECE_LIMIT = 40

const CAPSULE_NEUTRAL_COLORS = ['black', 'white', 'ivory', 'cream', 'navy', 'blue', 'grey', 'gray', 'charcoal', 'beige', 'tan', 'khaki', 'stone', 'olive', 'denim', 'brown', 'camel']

function capsuleVersatilityScore(piece = {}, { isSummer = false } = {}) {
  let score = 0
  const colors = (Array.isArray(piece.colors) ? piece.colors : []).map(color => String(color).toLowerCase())
  if (colors.some(color => CAPSULE_NEUTRAL_COLORS.some(neutral => color.includes(neutral)))) score += 12
  // A versatile capsule piece mixes across many occasions and reads as a solid.
  score += Math.min(4, (Array.isArray(piece.occasions) ? piece.occasions : []).length) * 4
  if (['solid', 'none', ''].includes(String(piece.pattern_type || '').toLowerCase())) score += 8
  const weight = fabricWeight(piece)
  if (isSummer) {
    if (weight === 'light') score += 10
    if (weight === 'heavy' || tripPieceHasStructuredValue(piece, ['wool', 'cashmere', 'fleece', 'corduroy', 'tweed', 'flannel'])) score -= 24
    if (tripPieceHasStructuredValue(piece, ['linen', 'cotton', 'viscose', 'tencel', 'gauze'])) score += 6
  }
  if (piece.recommendation_status === 'trusted') score += 4
  return score
}

// Category quotas for a ~budget-piece day capsule. Kept proportional so a bigger
// budget widens tops/bottoms rather than piling on shoes.
function capsuleQuotas(budget = 10, { isSummer = false } = {}) {
  const shoes = budget >= 30 ? 5 : budget >= 24 ? 4 : budget >= 12 ? 3 : Math.min(3, Math.max(2, Math.round(budget * 0.2)))
  const outerwear = budget >= 8 && (!isSummer || budget < 12) ? 1 : 0
  const dress = budget >= 6 ? 1 : 0
  const remaining = Math.max(0, budget - shoes - outerwear - dress)
  const bottom = Math.max(2, Math.round(remaining * 0.45))
  const top = Math.max(2, remaining - bottom)
  return { top, bottom, dress, outerwear, shoes }
}

// A coarse "these two read as the same garment" signature for capsule
// de-duplication: category + dominant color + garment kind + pattern. Two black
// solid crew tees collapse to one key; a black tee and a white tee do not.
function capsuleSimilarityKey(piece = {}) {
  const group = wardrobeCategoryGroup(piece)
  const color = String((Array.isArray(piece.colors) ? piece.colors : [])[0] || '').toLowerCase()
  const kind = group === 'bottom' ? bottomKind(piece) : garmentKind(piece)
  const pattern = String(piece.pattern_type || '').toLowerCase()
  return `${group}:${color}:${kind}:${pattern}`
}

// The strictest (lowest-rank) register ceiling across every occasion the plan
// actually asked for. `capsuleVersatilityScore`'s generic "neutral color, wide
// occasion tagging, solid, lightweight" formula has no idea what registers the
// plan needs, so a roster it curates can score high on "versatility" while
// still reading uniformly `elevated` — which then fails outright any slot
// whose occasion (e.g. `casual`) enforces an `everyday` ceiling. Live-tested
// 2026-07-14: an 8-slot capsule's roster was 5/6 `elevated` pieces plus 1
// `everyday` shoe; `casual`-occasion slots (Beach Day, City Outing) got zero
// outfits because only shoes cleared the ceiling — no top/bottom/dress did.
function effectiveSlotRegisterCeilingRank(slot = {}) {
  const occasionRank = formalityRank(resolveOccasionProfile(slot?.occasion)?.register_ceiling)
  const slotRank = formalityRank(slot?.register)
  if (occasionRank === null) return slotRank
  if (slotRank === null) return occasionRank
  return Math.min(occasionRank, slotRank)
}

function strictestRegisterCeilingRank(occasions = []) {
  const ranks = occasions
    .map(occasion => formalityRank(resolveOccasionProfile(occasion)?.register_ceiling))
    .filter(rank => rank !== null)
  return ranks.length ? Math.min(...ranks) : null
}

function capsuleDemandReserve(slots = [], quotas = {}) {
  const demandByRank = new Map()
  for (const slot of Array.isArray(slots) ? slots : []) {
    const rank = effectiveSlotRegisterCeilingRank(slot)
    if (rank === null) continue
    const looks = Math.max(1, Number(slot?.targetOutfits) || 1)
    demandByRank.set(rank, (demandByRank.get(rank) || 0) + looks)
  }
  const ranks = [...demandByRank.keys()].sort((a, b) => a - b)
  if (!ranks.length) return null
  const rank = ranks[0]
  const looks = demandByRank.get(rank) || 0
  const mainReserve = looks <= 1 ? 1 : (looks >= 4 && Math.min(quotas.top || 0, quotas.bottom || 0) >= 4 ? 3 : 2)
  return {
    rank,
    looks,
    byGroup: {
      top: Math.min(quotas.top || 0, mainReserve),
      bottom: Math.min(quotas.bottom || 0, mainReserve),
      dress: Math.min(quotas.dress || 0, 1),
      outerwear: Math.min(quotas.outerwear || 0, looks >= 3 ? 1 : 0),
      shoes: Math.min(quotas.shoes || 0, looks <= 1 ? 1 : 2)
    }
  }
}

function pieceClearsCeilingRank(piece = {}, ceilingRank = null) {
  if (ceilingRank === null) return false
  const rank = formalityRank(pieceFormality(piece))
  return rank !== null && rank <= ceilingRank
}

function pieceMeetsFloorRank(piece = {}, floorRank = null) {
  if (floorRank === null) return false
  const rank = formalityRank(pieceFormality(piece))
  return rank !== null && rank >= floorRank
}

function ensureCapsuleGroupReserve(roster = [], groups = {}, group = '', required = 0, ceilingRank = null, scoreOf = new Map()) {
  if (!(required > 0)) return roster
  let nextRoster = roster
  const selectedInGroup = () => nextRoster.filter(piece => wardrobeCategoryGroup(piece) === group)
  const compliantSelected = () => selectedInGroup().filter(piece => pieceClearsCeilingRank(piece, ceilingRank))
  while (compliantSelected().length < required) {
    const selected = selectedInGroup()
    if (!selected.length) break
    const candidate = (groups[group] || []).find(piece =>
      !nextRoster.includes(piece) &&
      pieceClearsCeilingRank(piece, ceilingRank) &&
      !compliantSelected().some(selectedPiece => capsuleSimilarityKey(selectedPiece) === capsuleSimilarityKey(piece))
    ) || (groups[group] || []).find(piece =>
      !nextRoster.includes(piece) &&
      pieceClearsCeilingRank(piece, ceilingRank)
    )
    if (!candidate) break
    const swapTarget = selected
      .filter(piece => !pieceClearsCeilingRank(piece, ceilingRank))
      .sort((a, b) => (scoreOf.get(a) || 0) - (scoreOf.get(b) || 0))[0]
    if (!swapTarget) break
    const swapIndex = nextRoster.indexOf(swapTarget)
    if (swapIndex === -1) break
    nextRoster = nextRoster.map((piece, index) => index === swapIndex ? candidate : piece)
  }
  return nextRoster
}

function footwearPassesActivityProfile(piece = {}, activityProfile = null) {
  if (!activityProfile?.rules) return true
  const verdict = footwearComfortVerdict(
    piece,
    activityProfile.rules.excluded_heel_heights || [],
    activityProfile.rules.excluded_walk_support || []
  )
  return verdict.verdict === 'pass'
}

function demandingActivityProfilesForSlots(slots = []) {
  const profiles = new Map()
  for (const slot of Array.isArray(slots) ? slots : []) {
    const profile = resolveActivityProfile({
      activity: slot.activity,
      occasion: slot.occasion,
      request: slot.slotRequestText || slot.bestFor || slot.label || ''
    })
    const rules = profile?.rules || {}
    if (!profile?.id) continue
    if (!(rules.excluded_heel_heights?.length || rules.excluded_walk_support?.length)) continue
    profiles.set(profile.id, profile)
  }
  return [...profiles.values()]
}

export function selectCapsuleRoster(pool = [], { budget = 10, isSummer = false, occasions = [], slots = [] } = {}) {
  const quotas = capsuleQuotas(budget, { isSummer })
  const groups = { top: [], bottom: [], dress: [], outerwear: [], shoes: [] }
  const scoreOf = new Map()
  for (const piece of pool) {
    const group = wardrobeCategoryGroup(piece)
    if (!groups[group]) continue
    scoreOf.set(piece, capsuleVersatilityScore(piece, { isSummer }))
    groups[group].push(piece)
  }
  for (const group of Object.keys(groups)) groups[group].sort((a, b) => scoreOf.get(b) - scoreOf.get(a))
  // A summer capsule should carry shorts: float the best pair to the front of
  // the bottoms so the quota picks it up.
  if (isSummer) {
    const shortsIndex = groups.bottom.findIndex(piece => bottomKind(piece) === 'shorts' || tripPieceHasStructuredValue(piece, ['shorts']))
    if (shortsIndex > 0) groups.bottom.unshift(...groups.bottom.splice(shortsIndex, 1))
  }
  const roster = []
  for (const [group, count] of Object.entries(quotas)) {
    // Non-redundancy: fill each category with DISTINCT pieces first (a capsule
    // of three near-identical black tees is dead weight), backfilling a
    // near-duplicate only when the quota can't be met with distinct ones.
    const seen = new Set()
    const distinct = []
    const backfill = []
    for (const piece of groups[group]) {
      const key = capsuleSimilarityKey(piece)
      if (seen.has(key)) backfill.push(piece)
      else { seen.add(key); distinct.push(piece) }
    }
    for (const piece of [...distinct, ...backfill].slice(0, count)) roster.push(piece)
  }
  // Register-floor guarantee: for every category the plan actually needs a
  // quota for, make sure at least one selected piece clears the strictest
  // occasion's ceiling — swapping in the best such candidate from the pool
  // for the category's LOWEST-scoring pick if none of the quota-selected
  // pieces already qualify. Skipped entirely when the plan's occasions don't
  // resolve to a ceiling (preserves prior behavior) — this only tightens an
  // otherwise-blind selection, never loosens anything.
  const ceilingRank = strictestRegisterCeilingRank(occasions)
  if (ceilingRank !== null) {
    for (const [group, count] of Object.entries(quotas)) {
      if (!count) continue
      const selectedInGroup = roster.filter(piece => wardrobeCategoryGroup(piece) === group)
      const alreadyCompliant = selectedInGroup.some(piece => {
        return pieceClearsCeilingRank(piece, ceilingRank)
      })
      if (alreadyCompliant || !selectedInGroup.length) continue
      const compliantCandidate = groups[group].find(piece => {
        if (selectedInGroup.includes(piece)) return false
        return pieceClearsCeilingRank(piece, ceilingRank)
      })
      if (!compliantCandidate) continue
      const worst = selectedInGroup.reduce((min, piece) =>
        scoreOf.get(piece) < scoreOf.get(min) ? piece : min, selectedInGroup[0])
      const swapIndex = roster.indexOf(worst)
      if (swapIndex !== -1) roster[swapIndex] = compliantCandidate
    }
  }
  const reserve = capsuleDemandReserve(slots, quotas)
  if (reserve) {
    for (const [group, required] of Object.entries(reserve.byGroup)) {
      const updated = ensureCapsuleGroupReserve(roster, groups, group, required, reserve.rank, scoreOf)
      roster.splice(0, roster.length, ...updated)
    }
  }
  if (quotas.shoes > 0) {
    const demands = shoeReserveDemands(slots, quotas)
    const { roster: guaranteedRoster, gaps } = ensureCapsuleShoeDemands(roster, groups, demands, scoreOf, quotas.shoes)
    roster.splice(0, roster.length, ...guaranteedRoster)
    if (gaps.length) {
      const finalRoster = roster.slice(0, budget)
      finalRoster.shoeReserveGaps = describeShoeReserveGaps(gaps, budget)
      return finalRoster
    }
  }
  return roster.slice(0, budget)
}

// One demand per "the shoe roster must guarantee something" reason: a
// demanding activity profile (hiking's excluded heel/support rules) needs at
// least one passing shoe, and an elevated-look floor needs enough polished
// shoes for the plan's dressier slots. Each has a human label for the
// coverage-gap disclosure if the quota can't hold all of them.
function shoeReserveDemands(slots = [], quotas = {}) {
  const demands = []
  for (const profile of demandingActivityProfilesForSlots(slots)) {
    demands.push({
      label: profile.label || profile.id,
      required: 1,
      predicate: piece => footwearPassesActivityProfile(piece, profile),
    })
  }
  const elevatedRank = formalityRank('elevated')
  const elevatedShoeLooks = (Array.isArray(slots) ? slots : [])
    .filter(slot => slotWantsElevatedShoe(slot))
    .reduce((sum, slot) => sum + Math.max(1, Number(slot?.targetOutfits) || 1), 0)
  if (elevatedShoeLooks > 0 && quotas.shoes > 1) {
    demands.push({
      label: 'a dressy/elevated look',
      required: Math.min(quotas.shoes, Math.max(1, Math.ceil(elevatedShoeLooks / 2))),
      predicate: piece => pieceMeetsFloorRank(piece, elevatedRank),
    })
  }
  return demands
}

// Guarantee every shoe demand together in one pass instead of sequential
// blind swaps. The Part 6 bug: the elevated-shoe floor reserve ran AFTER the
// activity reserve and chose its swap target as the lowest-versatility
// non-elevated shoe — which was exactly the hiking shoe the activity reserve
// had just installed — silently destroying that guarantee. Fix: a swap
// target must satisfy ZERO of the demands currently on the table; only if no
// such shoe exists do we evict one whose own demand(s) are still covered by
// another selected shoe. A shoe satisfying multiple demands (an athletic
// sneaker: hiking + walking) counts for all of them automatically, since
// each demand's "is it satisfied" check scans every currently selected shoe.
function ensureCapsuleShoeDemands(roster = [], groups = {}, demands = [], scoreOf = new Map(), quotaShoes = 0) {
  if (!demands.length || !(quotaShoes > 0)) return { roster, gaps: [] }
  let nextRoster = roster
  const gaps = []
  const selectedShoes = () => nextRoster.filter(piece => wardrobeCategoryGroup(piece) === 'shoes')
  const demandSatisfiedCount = demand => selectedShoes().filter(piece => demand.predicate(piece)).length
  const demandsSatisfiedBy = piece => demands.filter(demand => demand.predicate(piece))

  for (const demand of demands) {
    let guard = 0
    while (demandSatisfiedCount(demand) < demand.required && guard < quotaShoes) {
      guard += 1
      const selected = selectedShoes()
      const candidatePool = (groups.shoes || []).filter(piece => !nextRoster.includes(piece) && demand.predicate(piece))
      const candidate = candidatePool.find(piece =>
        !selected.some(selectedPiece => capsuleSimilarityKey(selectedPiece) === capsuleSimilarityKey(piece))
      ) || candidatePool[0]
      if (!candidate) { gaps.push(demand); break }
      if (selected.length < quotaShoes) {
        nextRoster = [...nextRoster, candidate]
        continue
      }
      // Roster is full: prefer evicting a shoe that satisfies NO demand at
      // all; only if none exists, evict one whose every demand is still
      // covered by another selected shoe once it's gone.
      const zeroDemandTargets = selected.filter(piece => demandsSatisfiedBy(piece).length === 0)
      const safeToEvictTargets = selected.filter(piece => {
        const own = demandsSatisfiedBy(piece)
        return own.length > 0 && own.every(ownDemand =>
          selected.some(other => other !== piece && ownDemand.predicate(other)))
      })
      const swapTarget = [...zeroDemandTargets, ...safeToEvictTargets]
        .sort((a, b) => (scoreOf.get(a) || 0) - (scoreOf.get(b) || 0))[0]
      if (!swapTarget) { gaps.push(demand); break }
      const swapIndex = nextRoster.indexOf(swapTarget)
      if (swapIndex === -1) { gaps.push(demand); break }
      nextRoster = nextRoster.map((piece, index) => index === swapIndex ? candidate : piece)
    }
  }
  return { roster: nextRoster, gaps }
}

function describeShoeReserveGaps(gaps = [], budget = 0) {
  if (gaps.length < 2) {
    return gaps.map(gap => `[missing wardrobe gap: the ${budget}-piece capsule's shoe quota cannot cover ${gap.label} — keep the best assignment and pack around it]`)
  }
  const labels = gaps.map(gap => gap.label)
  const joined = labels.length === 2
    ? `${labels[0]} and ${labels[1]}`
    : `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
  return [`[missing wardrobe gap: the shoe quota under this ${budget}-piece budget cannot cover both ${joined}]`]
}

function planWorkbenchPieceLine(piece = {}) {
  const colors = Array.isArray(piece.colors) && piece.colors.length ? piece.colors.join('/') : ''
  const occasions = Array.isArray(piece.occasions) && piece.occasions.length ? piece.occasions.slice(0, 4).join('/') : ''
  const bits = [
    `ID ${piece.id}`,
    piece.name || 'Garment',
    wardrobeCategoryGroup(piece) || piece.category || '',
    colors ? `colors:${colors}` : '',
    occasions ? `occasions:${occasions}` : '',
    piece.formality ? `formality:${piece.formality}` : '',
    piece.fabric_weight ? `weight:${piece.fabric_weight}` : '',
    piece.heel_height ? `heel:${piece.heel_height}` : '',
    piece.walk_support ? `support:${piece.walk_support}` : '',
    piece.reads_as ? `reads:${String(piece.reads_as).slice(0, 80)}` : ''
  ].filter(Boolean)
  return bits.join(' | ')
}

function idSetForPieces(pieces = []) {
  return new Set((Array.isArray(pieces) ? pieces : []).map(piece => Number(piece?.id)).filter(Boolean))
}

function pieceMapForPieces(pieces = []) {
  return new Map((Array.isArray(pieces) ? pieces : []).map(piece => [Number(piece?.id), piece]).filter(([id]) => Boolean(id)))
}

function suppressedReasonMap(suppressedPieces = []) {
  const map = new Map()
  for (const piece of Array.isArray(suppressedPieces) ? suppressedPieces : []) {
    const id = Number(piece?.id)
    if (!id) continue
    const reasons = Array.isArray(piece?.reasons) && piece.reasons.length
      ? piece.reasons.map(reason => String(reason || '').trim()).filter(Boolean)
      : ['failed register/weather/footwear gates']
    map.set(id, reasons)
  }
  return map
}

export function describeOutfitStructureGap(pieces = [], { requireShoes = true } = {}) {
  const groups = (Array.isArray(pieces) ? pieces : []).map(piece => wardrobeCategoryGroup(piece))
  const shoeCount = groups.filter(group => group === 'shoes').length
  const bottomCount = groups.filter(group => group === 'bottom').length
  const dressCount = groups.filter(group => group === 'dress').length
  const topCount = groups.filter(group => group === 'top').length

  if (requireShoes && shoeCount === 0) return 'missing shoes'
  if (shoeCount > 1) return 'more than one shoe option was submitted'
  if (bottomCount > 1) return 'more than one bottom was submitted'
  if (dressCount > 1) return 'more than one dress was submitted'
  if (dressCount === 1 && bottomCount > 0) return 'dress and bottom were both submitted'
  if (dressCount === 0 && topCount < 1) return 'missing top or dress'
  if (dressCount === 0 && bottomCount !== 1) {
    if (topCount > 1 && bottomCount === 0) return `${topCount} tops were submitted without a bottom`
    return 'missing bottom'
  }
  return ''
}

function planWorkbenchPieceScore(piece = {}, slot = {}, { anchorIds = new Set() } = {}) {
  const id = Number(piece.id)
  let score = 0
  if (anchorIds.has(id)) score += 100000
  const group = wardrobeCategoryGroup(piece)
  if (['top', 'bottom', 'dress', 'shoes'].includes(group)) score += 80
  if (['outerwear', 'accessory'].includes(group)) score += 30
  if (piece.recommendation_status === 'trusted') score += 50
  if (piece.fit_confidence === 'high') score += 30
  if (piece.role_permission === 'hero' || piece.role_permission === 'auto') score += 20
  const occasions = Array.isArray(piece.occasions) ? piece.occasions.map(occ => String(occ || '').toLowerCase()) : []
  const slotOccasion = String(slot?.occasion || '').toLowerCase()
  if (slotOccasion && occasions.includes(slotOccasion)) score += 35
  const slotFloor = String(slot?.register || '').toLowerCase() === 'formal'
    ? formalityRank('dressy')
    : formalityRank(slot?.register)
  const pieceRank = formalityRank(pieceFormality(piece))
  if (slotFloor !== null && pieceRank !== null) {
    score += Math.max(0, 20 - Math.abs(pieceRank - slotFloor) * 5)
  }
  if (fabricWeight(piece) === 'light') score += 5
  return score
}

function selectPlanWorkbenchPieces(allowedPieces = [], slot = {}, { anchorIds = new Set(), limit = PLAN_WORKBENCH_PIECE_LIMIT } = {}) {
  const scored = allowedPieces
    .map((piece, index) => ({ piece, index, score: planWorkbenchPieceScore(piece, slot, { anchorIds }) }))
    .sort((a, b) => b.score - a.score || Number(b.piece.id || 0) - Number(a.piece.id || 0) || a.index - b.index)
  const selected = []
  const seen = new Set()
  const add = item => {
    if (!item || selected.length >= limit) return
    const id = Number(item.piece.id)
    if (!id || seen.has(id)) return
    seen.add(id)
    selected.push(item.piece)
  }

  for (const item of scored) {
    if (anchorIds.has(Number(item.piece.id))) add(item)
  }

  const coverageGroups = ['top', 'bottom', 'dress', 'shoes', 'outerwear', 'accessory']
  for (const group of coverageGroups) {
    const quota = group === 'accessory' || group === 'outerwear' ? 4 : 8
    let taken = selected.filter(piece => wardrobeCategoryGroup(piece) === group).length
    for (const item of scored) {
      if (taken >= quota || selected.length >= limit) break
      if (wardrobeCategoryGroup(item.piece) !== group) continue
      const before = selected.length
      add(item)
      if (selected.length > before) taken += 1
    }
  }

  for (const item of scored) add(item)
  return selected
}

function registerRankName(rank = null) {
  return ['lounge', 'everyday', 'elevated', 'dressy', 'formal'][rank] || ''
}

function modelPlanPool({ allPieces = [], slots = [], constraints = {}, question = '', mood = '' } = {}) {
  const { pieceBudget } = normalizePlanConstraints(constraints)
  const weatherContextText = slots.map(slot => `${slot?.season || ''} ${slot?.weather || ''} ${slot?.slotWeather || ''}`).join(' ')
  const isSummerContext = /\b(summer|warm|hot|80|90|heat)\b/i.test(`${question} ${mood} ${weatherContextText}`) // ratchet-allow: plan weather context, not garment matching
  return pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET
    ? selectCapsuleRoster(allPieces, { budget: pieceBudget, isSummer: isSummerContext, occasions: slots.map(slot => slot.occasion), slots })
    : allPieces
}

export async function buildPlanSlotWorkbench(slots = [], { constraints = {}, allPieces = [], dateRange = {}, mood = '', question = '', fetchImpl } = {}) {
  const { reuse: reuseMode, noRepeat: noRepeatCats, allowRepeat, anchorIds, pieceBudget } = normalizePlanConstraints(constraints)
  const composePool = modelPlanPool({ allPieces, slots, constraints, question, mood })
  const piecesById = pieceMapForPieces(composePool)
  const catalogById = new Map()
  const slotWeather = []
  const workbenchSlots = []
  const droppedSlotLabels = Array.isArray(slots?.droppedSlotLabels) ? slots.droppedSlotLabels : []
  const coverageGaps = []
  if (droppedSlotLabels.length) {
    coverageGaps.push(`[plan trimmed: ${droppedSlotLabels.length} use case${droppedSlotLabels.length === 1 ? '' : 's'} dropped — ${droppedSlotLabels.map(label => `"${label}"`).join(', ')} — a plan can only include up to ${slots.length} use-case slots at once; ask again with the dropped one${droppedSlotLabels.length === 1 ? '' : 's'} as a follow-up]`)
  }
  if (Array.isArray(composePool.shoeReserveGaps)) coverageGaps.push(...composePool.shoeReserveGaps)
  for (const [index, slot] of slots.entries()) {
    const slotRequestText = [slot.label, slot.bestFor, slot.coverage, slot.planNote].filter(Boolean).join('. ') || question
    const { profile: weatherProfile, label: weatherLabel } = await resolveSlotWeather(slot, { mood, question: slotRequestText, dateRange, fetchImpl })
    slotWeather.push({ label: slot.label, weather: weatherLabel, order: index })
    const { allowedPieces, suppressedPieces } = filterWholeWardrobePiecesForGeneration(composePool, {
      occasion: slot.occasion,
      explorationMode: 'moderate',
      weatherProfile,
      mood: mood || slotRequestText,
      activity: slot.activity,
      request: slotRequestText
    })
    const shownPieces = selectPlanWorkbenchPieces(allowedPieces, slot, { anchorIds })
    for (const piece of shownPieces) {
      const id = Number(piece?.id)
      if (id && !catalogById.has(id)) catalogById.set(id, piece)
    }
    const ceilingRank = effectiveSlotRegisterCeilingRank(slot)
    const floorRank = String(slot?.register || '').toLowerCase() === 'formal'
      ? formalityRank('dressy')
      : formalityRank(slot?.register)
    workbenchSlots.push({
      id: slot.id,
      label: slot.label,
      occasion: slot.occasion,
      activity: slot.activity,
      environment: slot.environment || '',
      register: slot.register || '',
      target_outfits: Math.min(3, Math.max(1, Number(slot.targetOutfits) || 1)),
      weather_used: weatherLabel,
      register_ceiling: registerRankName(ceilingRank),
      register_floor: registerRankName(floorRank),
      allowed_piece_ids: shownPieces.map(piece => Number(piece.id)).filter(Boolean),
      suppressed_note: `${Array.isArray(suppressedPieces) ? suppressedPieces.length : 0} pieces excluded by register/weather/footwear gates${allowedPieces.length > shownPieces.length ? `; showing ${shownPieces.length} prioritized of ${allowedPieces.length} allowed pieces` : ''}`
    })
    slot._modelWorkbench = {
      weatherProfile,
      weatherLabel,
      allowedPieces: shownPieces,
      rosterIds: new Set(shownPieces.map(piece => Number(piece.id)).filter(Boolean)),
      gateAllowedIds: idSetForPieces(allowedPieces),
      suppressedReasonsById: suppressedReasonMap(suppressedPieces),
      originalIndex: index,
      slotRequestText
    }
  }
  const pieceCatalog = [...catalogById.values()]
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(planWorkbenchPieceLine)
  return {
    status: 'slot_rosters',
    instructions: 'Compose the outfits yourself and submit ALL slots in ONE submit_plan_outfits call. Use piece_catalog for garment details and pick only from each slot allowed_piece_ids. Do not call view_pieces for roster pieces; make at most one small view_pieces call only if genuinely needed. If validation accepts some outfits and rejects others, resubmit only the failed slots.',
    piece_catalog: pieceCatalog,
    slots: workbenchSlots,
    constraints: {
      reuse: reuseMode,
      no_repeat: [...noRepeatCats],
      allow_repeat: [...allowRepeat],
      shared_anchor_ids: [...anchorIds],
      piece_budget: pieceBudget
    },
    pendingPlan: {
      slots: slots.map((slot, index) => ({
        ...slot,
        originalIndex: index,
        weatherProfile: slot._modelWorkbench?.weatherProfile || null,
        weatherLabel: slot._modelWorkbench?.weatherLabel || '',
        allowedPieces: slot._modelWorkbench?.allowedPieces || [],
        rosterIds: slot._modelWorkbench?.rosterIds || new Set(),
        gateAllowedIds: slot._modelWorkbench?.gateAllowedIds || new Set(),
        suppressedReasonsById: slot._modelWorkbench?.suppressedReasonsById || new Map(),
        slotRequestText: slot._modelWorkbench?.slotRequestText || ''
      })),
      piecesById,
      constraints: { reuse: reuseMode, noRepeat: noRepeatCats, allowRepeat, anchorIds, pieceBudget },
      slotWeather,
      coverageGaps,
      heldOutfits: [],
      resubmits: 0
    }
  }
}

export function validateSlotOutfitConstraints(outfit = {}, slot = {}, { weatherProfile = {} } = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const reasons = []
  const mainPieces = pieces.filter(piece => ['top', 'bottom', 'dress'].includes(wardrobeCategoryGroup(piece)))
  const layer = pieces.find(piece => wardrobeCategoryGroup(piece) === 'outerwear')
  const top = pieces.find(piece => wardrobeCategoryGroup(piece) === 'top')
  const dress = pieces.find(piece => wardrobeCategoryGroup(piece) === 'dress')
  if (weatherProfile?.isCold) {
    const hasWarmLayer = Boolean(layer) || (top && fabricWeight(top) === 'heavy') || (dress && fabricWeight(dress) === 'heavy')
    if (!hasWarmLayer) reasons.push('no warm layer for cold weather')
  }
  if (weatherProfile?.isHot) {
    for (const piece of mainPieces) {
      if (fabricWeight(piece) === 'heavy') reasons.push(`${piece.name || piece.id} is a heavy main for hot weather`)
    }
  }
  const floorRank = String(slot?.register || '').toLowerCase() === 'formal'
    ? formalityRank('dressy')
    : formalityRank(slot?.register)
  if (floorRank !== null && floorRank >= formalityRank('dressy')) {
    for (const piece of mainPieces) {
      const rank = formalityRank(pieceFormality(piece))
      if (rank !== null && rank < floorRank) reasons.push(`${piece.name || piece.id} is below the ${slot.register} register floor`)
    }
  }
  const activityProfile = resolveActivityProfile({ activity: slot.activity, occasion: slot.occasion, request: slot.slotRequestText || slot.bestFor || slot.label || '' })
  if (activityProfile) {
    for (const piece of pieces.filter(piece => wardrobeCategoryGroup(piece) === 'shoes')) {
      const verdict = footwearComfortVerdict(
        piece,
        activityProfile.rules?.excluded_heel_heights || [],
        activityProfile.rules?.excluded_walk_support || []
      )
      if (verdict.verdict === 'exclude') {
        const label = verdict.dimension === 'heel' ? `${verdict.value} heel unsuitable` : `${verdict.value} support unsuitable`
        reasons.push(`${piece.name || piece.id}: ${label} for ${activityProfile.id}`)
      }
      if (verdict.verdict === 'unknown') reasons.push(`${piece.name || piece.id}: footwear comfort not tagged for ${activityProfile.id}`)
    }
  }
  return reasons
}

function modelPlanNoRepeatViolation(outfit = {}, usedPieceIdsByCategory = new Map(), noRepeatCats = new Set(), anchorIds = new Set()) {
  if (!noRepeatCats.size) return ''
  for (const { id, group } of outfitCategoryPairs(outfit)) {
    if (!noRepeatCats.has(group) || anchorIds.has(id)) continue
    if (usedPieceIdsByCategory.get(group)?.has(id)) return `${group} piece ${id} repeats despite no_repeat`
  }
  return ''
}

function recordModelPlanUse(outfit = {}, usedPieceIds = new Set(), usedPieceIdsByCategory = new Map()) {
  for (const { id, group } of outfitCategoryPairs(outfit)) {
    usedPieceIds.add(id)
    if (!usedPieceIdsByCategory.has(group)) usedPieceIdsByCategory.set(group, new Set())
    usedPieceIdsByCategory.get(group).add(id)
  }
}

export function validateSubmittedPlanOutfits(pendingPlan = {}, submissions = []) {
  const slots = Array.isArray(pendingPlan?.slots) ? pendingPlan.slots : []
  const slotById = new Map(slots.map(slot => [slot.id, slot]))
  const planPiecesById = pendingPlan?.piecesById instanceof Map
    ? pendingPlan.piecesById
    : pieceMapForPieces(slots.flatMap(slot => slot.allowedPieces || []))
  const heldOutfits = Array.isArray(pendingPlan?.heldOutfits) ? pendingPlan.heldOutfits : []
  const { noRepeat = new Set(), anchorIds = new Set(), pieceBudget = 0 } = pendingPlan?.constraints || {}
  const isEnforcedCapsule = pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET
  const usedKeys = new Set(heldOutfits.map(outfit => tripOutfitKey(outfit)).filter(Boolean))
  const usedPieceIds = new Set()
  const usedPieceIdsByCategory = new Map()
  heldOutfits.forEach(outfit => recordModelPlanUse(outfit, usedPieceIds, usedPieceIdsByCategory))
  const accepted = []
  const failures = []
  const submitted = Array.isArray(submissions) ? submissions : []
  for (const [index, raw] of submitted.entries()) {
    const slot = slotById.get(String(raw?.slot_id || ''))
    const label = slot?.label || raw?.slot_id || `outfit ${index + 1}`
    const reasons = []
    if (!slot) {
      failures.push({ slot_id: raw?.slot_id || '', label, reasons: [`unknown slot_id ${raw?.slot_id || '(missing)'}`] })
      continue
    }
    const pieceIds = (Array.isArray(raw?.piece_ids) ? raw.piece_ids : []).map(id => Number(id)).filter(Boolean)
    const seenIds = new Set()
    const dedupedIds = pieceIds.filter(id => {
      if (seenIds.has(id)) return false
      seenIds.add(id)
      return true
    })
    if (!dedupedIds.length) reasons.push('piece_ids is required')
    const gateAllowedIds = slot.gateAllowedIds instanceof Set ? slot.gateAllowedIds : (slot.rosterIds || new Set())
    const suppressedReasonsById = slot.suppressedReasonsById instanceof Map ? slot.suppressedReasonsById : new Map()
    const unresolvedPieceIds = []
    for (const id of dedupedIds) {
      if (gateAllowedIds.has(id)) continue
      if (suppressedReasonsById.has(id)) {
        reasons.push(`piece ${id} failed this slot's gates: ${suppressedReasonsById.get(id).join('; ')}`)
      } else {
        // In an enforced capsule, a piece missing from gateAllowedIds is
        // almost always active but simply outside the curated budget roster
        // (the model may have just verified it via search) — "not active"
        // reads as a false contradiction there.
        reasons.push(isEnforcedCapsule
          ? `piece ${id} is outside this capsule's curated ${pieceBudget}-piece roster`
          : `piece ${id} is not an active wardrobe piece for this plan`)
      }
      unresolvedPieceIds.push(id)
    }
    const pieces = dedupedIds
      .filter(id => gateAllowedIds.has(id))
      .map(id => planPiecesById.get(id))
      .filter(Boolean)
    const outfit = {
      title: String(raw?.title || slot.label || '').trim(),
      reason: String(raw?.reason || '').trim(),
      pieces,
      pieceIds: dedupedIds,
      source: 'plan_outfit_set',
      composedBy: 'model'
    }
    if (!unresolvedPieceIds.length) {
      const structureGap = describeOutfitStructureGap(pieces, { requireShoes: true })
      if (structureGap || !isOutfitStructurallyValid(pieces, { requireShoes: true })) {
        reasons.push(structureGap || 'outfit is structurally incomplete or has duplicate core roles')
      }
      reasons.push(...validateSlotOutfitConstraints(outfit, slot, { weatherProfile: slot.weatherProfile || {} }))
      const key = tripOutfitKey(outfit)
      if (key && usedKeys.has(key)) reasons.push('duplicate outfit already accepted in this plan')
      const repeatReason = modelPlanNoRepeatViolation(outfit, usedPieceIdsByCategory, noRepeat, anchorIds)
      if (repeatReason) reasons.push(repeatReason)
      const nextDistinctPieceCount = new Set([...usedPieceIds, ...outfitCategoryPairs(outfit).map(pair => pair.id)]).size
      if (pieceBudget > 0 && nextDistinctPieceCount > pieceBudget) reasons.push(`would exceed the ${pieceBudget}-piece budget`)
    }
    if (reasons.length) {
      failures.push({ slot_id: slot.id, label, reasons })
      continue
    }
    const key = tripOutfitKey(outfit)
    usedKeys.add(key)
    recordModelPlanUse(outfit, usedPieceIds, usedPieceIdsByCategory)
    accepted.push({ ...outfit, _slotId: slot.id })
  }
  const anchorAllowedSlots = anchorIds.size
    ? slots.filter(slot => [...anchorIds].some(id => (slot.gateAllowedIds || slot.rosterIds)?.has(id))).map(slot => slot.label)
    : []
  const allAccepted = [...heldOutfits, ...accepted]
  if (anchorIds.size && anchorAllowedSlots.length && !allAccepted.some(outfit => outfitCategoryPairs(outfit).some(({ id }) => anchorIds.has(id)))) {
    failures.push({
      slot_id: '',
      label: 'Shared anchor',
      reasons: [`include at least one shared anchor piece; it is allowed in: ${anchorAllowedSlots.join(', ')}`]
    })
  }
  return { accepted, failures }
}

export function assembleSubmittedPlanOutfits(pendingPlan = {}, acceptedOutfits = [], { source = 'plan_outfit_set' } = {}) {
  const slots = Array.isArray(pendingPlan?.slots) ? pendingPlan.slots : []
  const slotById = new Map(slots.map(slot => [slot.id, slot]))
  const groupedBySlot = new Map()
  for (const outfit of acceptedOutfits || []) {
    const slotId = outfit?._slotId || outfit?.slot_id || outfit?.tripSlot
    if (!slotId) continue
    if (!groupedBySlot.has(slotId)) groupedBySlot.set(slotId, [])
    groupedBySlot.get(slotId).push(outfit)
  }
  const coverageGaps = [...(Array.isArray(pendingPlan?.coverageGaps) ? pendingPlan.coverageGaps : [])]
  const picked = []
  for (const slot of slots) {
    const group = groupedBySlot.get(slot.id) || []
    const target = Math.min(3, Math.max(1, Number(slot.targetOutfits) || 1))
    if (group.length < target) {
      coverageGaps.push(describeSlotCoverageGap(slot, {
        requestedCount: target,
        composedCount: group.length,
        candidateCount: slot.gateAllowedIds?.size || slot.allowedPieces?.length || 0,
        composedBy: 'model'
      }))
    }
    const trimMessage = describePlanCapTrim(slot)
    if (trimMessage) coverageGaps.push(trimMessage)
    group.forEach((outfit, slotIndex) => {
      picked.push({
        ...annotateTripOutfit(outfit, slot, picked.length, {
          slotIndex,
          slotTotal: group.length,
          source,
          weatherLabel: slot.weatherLabel || ''
        }),
        composedBy: 'model',
        _planOrder: slot.originalIndex
      })
    })
  }
  const orderedPicked = picked
    .sort((a, b) => (a._planOrder ?? 0) - (b._planOrder ?? 0) || (a.coveragePosition || '').localeCompare(b.coveragePosition || ''))
    .map(({ _planOrder, _slotId, ...outfit }) => outfit)
  const { reuse: reuseMode, noRepeat: noRepeatCats, pieceBudget } = pendingPlan?.constraints || {}
  const orderedSlotWeather = [...(pendingPlan?.slotWeather || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return attachTripPlanMetadata(orderedPicked, { source, composedBy: 'model', slotWeather: orderedSlotWeather, reuseMode, noRepeatCats, pieceBudget, coverageGaps })
}

export async function composeOutfitSet({ slots = [], question = '', mood = '', allPieces = [], seedOutfits = [], source = 'trip_precompose', dateRange = {}, constraints = {}, fetchImpl } = {}) {
  const picked = []
  const seeded = seedTripUsedSets(seedOutfits)
  const usedKeys = seeded.usedKeys
  const usedTopBottom = seeded.usedTopBottom
  const { reuse: reuseMode, noRepeat: noRepeatCats, anchorIds, pieceBudget } = normalizePlanConstraints(constraints)
  const avoidRepeatedDressMain = pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET && slots.length > 1
  // A summer plan keeps discouraging warm fabrics on indoor (weather-neutral)
  // slots, where the forecast can't. Text-based so it only fires when the plan
  // is explicitly summer — a trip's per-slot live weather handles its own slots.
  const weatherContextText = slots.map(slot => `${slot?.season || ''} ${slot?.weather || ''} ${slot?.slotWeather || ''}`).join(' ')
  const isSummerContext = /\b(summer|warm|hot|80s?|90s?|heat)\b/i.test(`${question} ${mood} ${weatherContextText}`)
  // Capsule enforcement: when a real budget is set, curate the roster up front
  // and compose every slot ONLY from it, so the distinct-piece count lands
  // within budget instead of being reported after the fact.
  const composePool = pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET
    ? selectCapsuleRoster(allPieces, { budget: pieceBudget, isSummer: isSummerContext, occasions: slots.map(slot => slot.occasion), slots })
    : allPieces
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
  // 'maximize' packs light by rewarding reuse of ANY already-worn piece — but
  // scored that way, shoes never rotate: once a pair is picked, reusing it adds
  // MORE overlap than any alternative shoe, so it wins every subsequent pass and
  // the whole capsule ends up in one pair. Shoes are the one category that isn't
  // "packing" savings (you bring the pair either way) and where repetition
  // across a multi-day capsule reads as an oversight rather than an intent.
  // Score packing reuse on non-shoe pieces only, and break ties toward whichever
  // roster shoe has been used LEAST so far.
  const nonShoeOverlapCount = outfit => {
    let count = 0
    for (const { id, group } of outfitCategoryPairs(outfit)) {
      if (group !== 'shoes' && !anchorIds.has(id) && usedPieceIds.has(id)) count += 1
    }
    return count
  }
  const shoeUseCounts = new Map()
  const pieceUseCounts = new Map()
  const shoeUseCount = outfit => {
    const shoeId = outfitCategoryPairs(outfit).find(({ group }) => group === 'shoes')?.id
    return shoeId ? (shoeUseCounts.get(shoeId) || 0) : 0
  }
  const capsuleMainWearPressure = outfit => {
    let pressure = 0
    for (const { id, group } of outfitCategoryPairs(outfit)) {
      if (group === 'top' || group === 'bottom' || group === 'dress') {
        pressure += pieceUseCounts.get(id) || 0
      }
    }
    return pressure
  }
  const capsuleNewMainCount = outfit => {
    let count = 0
    for (const { id, group } of outfitCategoryPairs(outfit)) {
      if ((group === 'top' || group === 'bottom' || group === 'dress') && !usedPieceIds.has(id)) count += 1
    }
    return count
  }
  const canSpendCapsuleVariety = () =>
    pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET && usedPieceIds.size < pieceBudget
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
      pieceUseCounts.set(id, (pieceUseCounts.get(id) || 0) + 1)
      if (group === 'shoes') shoeUseCounts.set(id, (shoeUseCounts.get(id) || 0) + 1)
    }
  }
  const slotWeather = []
  const coverageGaps = []
  const droppedSlotLabels = Array.isArray(slots?.droppedSlotLabels) ? slots.droppedSlotLabels : []
  if (droppedSlotLabels.length) {
    coverageGaps.push(`[plan trimmed: ${droppedSlotLabels.length} use case${droppedSlotLabels.length === 1 ? '' : 's'} dropped — ${droppedSlotLabels.map(label => `"${label}"`).join(', ')} — a plan can only include up to ${slots.length} use-case slots at once; ask again with the dropped one${droppedSlotLabels.length === 1 ? '' : 's'} as a follow-up]`)
  }
  if (Array.isArray(composePool.shoeReserveGaps)) coverageGaps.push(...composePool.shoeReserveGaps)
  const compositionSlots = slots
    .map((slot, originalIndex) => ({ ...slot, originalIndex }))
    .sort((a, b) => slotCompositionPriority(b) - slotCompositionPriority(a) || a.originalIndex - b.originalIndex)
  for (const slot of compositionSlots) {
    // Cross-slot keyword leakage guard: a multi-slot plan's `question` (the
    // user's whole request) naturally names every slot together — "3 Smart
    // Casual looks, 2 Beach Day looks, ... 1 Gallery Visit look". Using that
    // full text as every slot's mood/request fallback (the pre-2026-07-14
    // behavior) let one slot's keywords (e.g. "gallery") gate another slot's
    // (e.g. "Beach Day") candidates. Live-tested: the same 8-slot plan
    // composed 4 outfits with a short question but 0 with the real, full
    // question — the full-text leak was strict enough to zero out every
    // slot at once. Scope each slot to its OWN descriptive text instead;
    // fall back to the plan-level question only for a slot with none of its
    // own (rare — label is always set in practice).
    const slotRequestText = [slot.label, slot.bestFor, slot.coverage, slot.planNote].filter(Boolean).join('. ') || question
    const { profile: weatherProfile, label: weatherLabel } = await resolveSlotWeather(slot, { mood, question: slotRequestText, dateRange, fetchImpl })
    slotWeather.push({ label: slot.label, weather: weatherLabel, order: slot.originalIndex })
    const { allowedPieces } = filterWholeWardrobePiecesForGeneration(composePool, {
      occasion: slot.occasion,
      explorationMode: 'moderate',
      weatherProfile,
      mood: mood || slotRequestText,
      activity: slot.activity,
      request: slotRequestText
    })
    const comfortConstraint = tripSlotComfortConstraint(slot, resolveComfortFootwearConstraint({
      occasion: slot.occasion,
      mood: mood || slotRequestText,
      request: slotRequestText,
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
        mood: mood || slotRequestText,
        explorationMode: 'moderate',
        activeMissions: ['controlled_print', 'monochrome_texture', 'structured_soft', 'color_anchor', 'unexpected_pairing'],
        comfortConstraint,
        candidateLimit: 42,
        candidateBucketLimit: 8,
        request: slotRequestText,
        question: slotRequestText,
        ...(requiredPieceId ? { requiredPieceId } : {})
      })
      return wholeWardrobeOutfitsFromCandidates(candidates, allowedPieces, {
        occasion: slot.occasion,
        mood: mood || slotRequestText,
        season: slot.season,
        weatherProfile,
        activity: slot.activity,
        request: slotRequestText,
        question: slotRequestText
      }).filter(outfit => isOutfitStructurallyValid(outfit?.pieces || [], { requireShoes: true }))
    }
    let localOutfits = buildSlotLocalOutfits(anchorPieceId)
    if (anchorPieceId && !localOutfits.length) localOutfits = buildSlotLocalOutfits(null)
    if (pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET) {
      const structuralSeparates = buildCapsuleStructuralSeparateOutfits(allowedPieces)
      const seenLocalKeys = new Set(localOutfits.map(outfit => tripOutfitKey(outfit)).filter(Boolean))
      for (const outfit of structuralSeparates) {
        const key = tripOutfitKey(outfit)
        if (key && !seenLocalKeys.has(key)) {
          seenLocalKeys.add(key)
          localOutfits.push(outfit)
        }
      }
    }
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
      mood: mood || slotRequestText,
      season: slot.season,
      weatherProfile,
      activity: slot.activity
    }).outfits
    const scoredOutfits = [...ranked, ...localOutfits]
      .map(outfit => {
        const hydrated = rehydrateOutfitPieces(outfit, allowedPieces)
        const repaired = applyComfortFootwearRepair(hydrated, allowedPieces, comfortConstraint, {
          weatherProfile,
          occasion: slot.occasion,
          mood: mood || slotRequestText,
          activity: slot.activity
        })
        const finalOutfit = withBeachCoastalLayerIfUseful(
          withEveningLayerIfUseful(repaired, composePool, slot),
          allowedPieces,
          slot,
          { weatherProfile, isSummerContext }
        )
        return {
          outfit: finalOutfit,
          fit: tripSlotFitScore(finalOutfit, slot, { weatherProfile, isSummerContext })
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
        const dressId = outfitDressId(outfit)
        if (avoidRepeatedDressMain && dressId && !anchorIds.has(dressId) && formulaKey && usedTopBottom.has(formulaKey)) return false
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
        return [...pool].sort((a, b) =>
          (Math.abs(b.fit.score - a.fit.score) > 14 ? b.fit.score - a.fit.score : 0) ||
          (canSpendCapsuleVariety()
            ? capsuleMainWearPressure(a.outfit) - capsuleMainWearPressure(b.outfit) ||
              capsuleNewMainCount(b.outfit) - capsuleNewMainCount(a.outfit)
            : 0) ||
          nonShoeOverlapCount(b.outfit) - nonShoeOverlapCount(a.outfit) ||
          shoeUseCount(a.outfit) - shoeUseCount(b.outfit) ||
          b.fit.score - a.fit.score
        )[0]
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
    const compatibleKeys = new Set(scoredOutfits.map(({ outfit }) => tripOutfitKey(outfit)).filter(Boolean))
    const gapMessage = describeSlotCoverageGap(slot, {
      requestedCount: targetOutfits,
      composedCount: slotChoices.length,
      candidateCount: scoredOutfits.length,
      exhaustedByUsedCombos: scoredOutfits.length > 0 && !scoredOutfits.some(({ outfit }) => {
        const key = tripOutfitKey(outfit)
        return key && !usedKeys.has(key)
      }),
      compatibleCombinationCount: compatibleKeys.size,
      ceilingRank: effectiveSlotRegisterCeilingRank(slot)
    })
    if (gapMessage) coverageGaps.push(gapMessage)
    const trimMessage = describePlanCapTrim(slot)
    if (trimMessage) coverageGaps.push(trimMessage)
    slotChoices.forEach((choice, slotIndex) => {
      picked.push({
        ...annotateTripOutfit(choice, slot, picked.length, {
        slotIndex,
        slotTotal: slotChoices.length,
        source,
        weatherLabel
        }),
        _planOrder: slot.originalIndex
      })
    })
  }
  const orderedPicked = picked
    .sort((a, b) => (a._planOrder ?? 0) - (b._planOrder ?? 0) || (a.coveragePosition || '').localeCompare(b.coveragePosition || ''))
    .map(({ _planOrder, ...outfit }) => outfit)
  const orderedSlotWeather = [...slotWeather].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return attachTripPlanMetadata(orderedPicked, { source, slotWeather: orderedSlotWeather, reuseMode, noRepeatCats, pieceBudget, coverageGaps })
}

// Tool-argument slots (plan_outfit_set) -> engine slots. Mirrors the pre-route
// planner's normalizePlannerSlots (routes/ai.js), which keeps its own copy
// until the keyword pre-route retires on diagnostics evidence.
export const PLAN_TOTAL_OUTFIT_CAP = 8

export function planTotalOutfitCapForBudget(budget = 0) {
  const numericBudget = Number(budget) || 0
  if (numericBudget >= 30) return 20
  if (numericBudget >= 24) return 16
  if (numericBudget >= 18) return 12
  return PLAN_TOTAL_OUTFIT_CAP
}

export function normalizePlanSlots(rawSlots = [], {
  fallbackWeather = '',
  fallbackOccasion = 'city',
  fallbackActivity = 'none',
  fallbackLocation = '',
  maxSlots = PLAN_TOTAL_OUTFIT_CAP,
  maxTotalOutfits = PLAN_TOTAL_OUTFIT_CAP,
  tripSummary = null,
  onDiagnostic = null
} = {}) {
  const allRawSlots = Array.isArray(rawSlots) ? rawSlots : []
  // A separate slot-count cap keeps the model from opening more use cases than
  // the set can render. Default it to the same 8 as PLAN_TOTAL_OUTFIT_CAP so an
  // 8 one-look capsule is not silently split, while 9+ use cases still get a
  // deterministic disclosure via droppedSlotLabels.
  const droppedRawSlots = allRawSlots.slice(maxSlots)
  const normalized = allRawSlots
    .slice(0, maxSlots)
    .map((slot, index) => {
      const label = String(slot?.label || '').trim()
      const bestFor = String(slot?.best_for || slot?.bestFor || label).trim()
      const coverage = String(slot?.coverage || bestFor || label).trim()
      const planNote = String(slot?.plan_note || slot?.planNote || '').trim()
      const location = String(slot?.location || fallbackLocation || '').trim()
      const declaredActivity = hasDeclaredPlanSlotActivity(slot)
      const proseActivity = declaredActivity ? '' : inferPlanSlotActivityFromProse(slot)
      const activity = declaredActivity
        ? inferPlanSlotActivity(slot, fallbackActivity)
        : (proseActivity || inferPlanSlotActivity(slot, fallbackActivity))
      if (!declaredActivity && proseActivity && typeof onDiagnostic === 'function') onDiagnostic('planSlotActivityInferred')
      const rawExplicitWeather = String(slot?.weather || slot?.stated_weather || '').trim()
      const weatherAsEnvironment = normalizePlanEnvironment(rawExplicitWeather)
      const explicitEnvironment = normalizePlanEnvironment(slot?.environment)
      const proseEnvironment = explicitEnvironment ? '' : normalizePlanSlotEnvironment({ label, bestFor, coverage, planNote, location })
      const declaredEnvironment = explicitEnvironment || (weatherAsEnvironment && (weatherAsEnvironment === 'beach_coastal' || !proseEnvironment) ? weatherAsEnvironment : '')
      const inferredEnvironment = declaredEnvironment ? '' : proseEnvironment
      const environment = declaredEnvironment || inferredEnvironment
      if (!declaredEnvironment && inferredEnvironment && typeof onDiagnostic === 'function') onDiagnostic('planSlotEnvironmentInferred')
      const occasion = normalizePlanSlotOccasion(String(slot?.occasion || fallbackOccasion || 'city'), { label, bestFor, coverage, planNote, environment })
      // statedWeather is ONLY the model's explicit per-slot weather — it wins
      // over the live forecast. The trip-level fallbackWeather is not "stated"
      // for this purpose: it feeds season/heuristic but must let a slot's own
      // forecast override it (that is the coastal-microclimate case).
      const normalizedExplicitWeather = rawExplicitWeather.toLowerCase().replace(/\s+/g, ' ')
      const normalizedFallbackWeather = String(fallbackWeather || '').trim().toLowerCase().replace(/\s+/g, ' ')
      const explicitWeather = normalizedExplicitWeather && !weatherAsEnvironment && normalizedExplicitWeather !== normalizedFallbackWeather
        ? rawExplicitWeather
        : ''
      const statedWeather = beachCoastalStatedWeather(explicitWeather, { environment }) || (
        environment === 'indoor'
          ? 'indoor'
          : environment
            ? ''
            : (isIndoorPlanSlot(slot, { occasion, activity }) ? 'indoor' : '')
      )
      return {
        id: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `slot_${index + 1}`,
        label,
        occasion,
        activity,
        season: String(statedWeather || slot?.season || fallbackWeather || 'current season').trim(),
        statedWeather,
        location,
        environment,
        date: String(slot?.date || '').trim(),
        bestFor,
        coverage,
        targetOutfits: Math.min(3, Math.max(1, Number.parseInt(slot?.count, 10) || 1)),
        totalOutfitCap: maxTotalOutfits,
        register: normalizeRegisterLevel(slot?.register),
        tripSummary,
        planNote
      }
    })
    .filter(slot => slot.label && slot.bestFor)
  let total = normalized.reduce((sum, slot) => sum + slot.targetOutfits, 0)
  for (let index = normalized.length - 1; index >= 0 && total > maxTotalOutfits; index -= 1) {
    const slot = normalized[index]
    const trim = Math.min(slot.targetOutfits - 1, total - maxTotalOutfits)
    if (trim > 0) {
      // Record what was actually asked for before trimming — this cap runs
      // silently (a live capsule test asked for 10 outfits across 5 slots and
      // got 8, with zero signal anywhere that 2 were dropped). requestedOutfits
      // only gets set on a slot that was actually trimmed, so composeOutfitSet
      // can tell "the wardrobe couldn't fill this" (the coverage-gap case) apart
      // from "the plan never even asked the wardrobe for the full count."
      slot.requestedOutfits = slot.targetOutfits
      slot.targetOutfits -= trim
      total -= trim
    }
  }
  // Arrays can carry extra properties; attach here rather than changing the
  // return shape so every existing caller (composeOutfitSet, tests) keeps
  // working with a plain slot array, and callers that care can opt in.
  normalized.droppedSlotLabels = droppedRawSlots
    .map(slot => String(slot?.label || slot?.best_for || slot?.bestFor || '').trim())
    .filter(Boolean)
  return normalized
}
