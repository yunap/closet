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
import { bottomKind, fabricWeight, garmentKind, isDarkPiece, pieceMatchesFootwear, sleeveCoverage, formalityRank, pieceFormality } from './attributes.js'
import { resolveComfortFootwearConstraint, applyComfortFootwearRepair } from './footwear-comfort.js'
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
function describeSlotCoverageGap(slot = {}, { requestedCount = 0, composedCount = 0, candidateCount = 0 } = {}) {
  if (composedCount >= requestedCount) return ''
  const label = slot?.label || slot?.bestFor || 'this use case'
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
  return `[plan trimmed: "${label}" reduced from ${requested} to ${actual} look${actual === 1 ? '' : 's'} — the plan asked for more outfits than the ${PLAN_TOTAL_OUTFIT_CAP}-outfit total across the set allows]`
}

function buildCoverageGapLines(coverageGaps = []) {
  return (Array.isArray(coverageGaps) ? coverageGaps : []).filter(Boolean)
}

function attachTripPlanMetadata(outfits = [], { source = 'trip_precompose', slotWeather = [], reuseMode = '', noRepeatCats = new Set(), pieceBudget = 0, coverageGaps = [] } = {}) {
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

// Real capsule builder (path 1): when the plan carries a piece_budget, don't
// just REPORT the roster — enforce it. Pre-select ~budget versatile pieces with
// category coverage (a summer capsule must include shorts), then compose the
// slots ONLY from those, so the distinct-piece count actually lands within the
// budget. Below this floor a "capsule" can't cover top+bottom+shoes, so we keep
// the soft-report behavior instead.
const MIN_ENFORCED_CAPSULE_BUDGET = 6

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
function capsuleQuotas(budget = 10) {
  const shoes = Math.min(3, Math.max(2, Math.round(budget * 0.2)))
  const outerwear = budget >= 8 ? 1 : 0
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
function strictestRegisterCeilingRank(occasions = []) {
  const ranks = occasions
    .map(occasion => formalityRank(resolveOccasionProfile(occasion)?.register_ceiling))
    .filter(rank => rank !== null)
  return ranks.length ? Math.min(...ranks) : null
}

export function selectCapsuleRoster(pool = [], { budget = 10, isSummer = false, occasions = [] } = {}) {
  const quotas = capsuleQuotas(budget)
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
        const rank = formalityRank(pieceFormality(piece))
        return rank !== null && rank <= ceilingRank
      })
      if (alreadyCompliant || !selectedInGroup.length) continue
      const compliantCandidate = groups[group].find(piece => {
        if (selectedInGroup.includes(piece)) return false
        const rank = formalityRank(pieceFormality(piece))
        return rank !== null && rank <= ceilingRank
      })
      if (!compliantCandidate) continue
      const worst = selectedInGroup.reduce((min, piece) =>
        scoreOf.get(piece) < scoreOf.get(min) ? piece : min, selectedInGroup[0])
      const swapIndex = roster.indexOf(worst)
      if (swapIndex !== -1) roster[swapIndex] = compliantCandidate
    }
  }
  return roster.slice(0, budget)
}

export async function composeOutfitSet({ slots = [], question = '', mood = '', allPieces = [], seedOutfits = [], source = 'trip_precompose', dateRange = {}, constraints = {}, fetchImpl } = {}) {
  const picked = []
  const seeded = seedTripUsedSets(seedOutfits)
  const usedKeys = seeded.usedKeys
  const usedTopBottom = seeded.usedTopBottom
  const { reuse: reuseMode, noRepeat: noRepeatCats, anchorIds, pieceBudget } = normalizePlanConstraints(constraints)
  // A summer plan keeps discouraging warm fabrics on indoor (weather-neutral)
  // slots, where the forecast can't. Text-based so it only fires when the plan
  // is explicitly summer — a trip's per-slot live weather handles its own slots.
  const isSummerContext = /\bsummer\b/i.test(`${question} ${mood}`)
  // Capsule enforcement: when a real budget is set, curate the roster up front
  // and compose every slot ONLY from it, so the distinct-piece count lands
  // within budget instead of being reported after the fact.
  const composePool = pieceBudget >= MIN_ENFORCED_CAPSULE_BUDGET
    ? selectCapsuleRoster(allPieces, { budget: pieceBudget, isSummer: isSummerContext, occasions: slots.map(slot => slot.occasion) })
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
  const shoeUseCount = outfit => {
    const shoeId = outfitCategoryPairs(outfit).find(({ group }) => group === 'shoes')?.id
    return shoeId ? (shoeUseCounts.get(shoeId) || 0) : 0
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
      if (group === 'shoes') shoeUseCounts.set(id, (shoeUseCounts.get(id) || 0) + 1)
    }
  }
  const slotWeather = []
  const coverageGaps = []
  const droppedSlotLabels = Array.isArray(slots?.droppedSlotLabels) ? slots.droppedSlotLabels : []
  if (droppedSlotLabels.length) {
    coverageGaps.push(`[plan trimmed: ${droppedSlotLabels.length} use case${droppedSlotLabels.length === 1 ? '' : 's'} dropped — ${droppedSlotLabels.map(label => `"${label}"`).join(', ')} — a plan can only include up to ${slots.length} use-case slots at once; ask again with the dropped one${droppedSlotLabels.length === 1 ? '' : 's'} as a follow-up]`)
  }
  for (const slot of slots) {
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
    const slotRequestText = [slot.label, slot.best_for, slot.plan_note].filter(Boolean).join('. ') || question
    const { profile: weatherProfile, label: weatherLabel } = await resolveSlotWeather(slot, { mood, question: slotRequestText, dateRange, fetchImpl })
    slotWeather.push({ label: slot.label, weather: weatherLabel })
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
        const finalOutfit = withEveningLayerIfUseful(repaired, composePool, slot)
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
    const gapMessage = describeSlotCoverageGap(slot, {
      requestedCount: targetOutfits,
      composedCount: slotChoices.length,
      candidateCount: scoredOutfits.length
    })
    if (gapMessage) coverageGaps.push(gapMessage)
    const trimMessage = describePlanCapTrim(slot)
    if (trimMessage) coverageGaps.push(trimMessage)
    slotChoices.forEach((choice, slotIndex) => {
      picked.push(annotateTripOutfit(choice, slot, picked.length, {
        slotIndex,
        slotTotal: slotChoices.length,
        source,
        weatherLabel
      }))
    })
  }
  return attachTripPlanMetadata(picked, { source, slotWeather, reuseMode, noRepeatCats, pieceBudget, coverageGaps })
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
  const allRawSlots = Array.isArray(rawSlots) ? rawSlots : []
  // Same silent-drop bug PR #89 fixed for the total-outfit cap, found in a
  // different spot: this slice enforces a separate, independent maxSlots cap
  // (default 6) on the NUMBER OF SLOTS, before PLAN_TOTAL_OUTFIT_CAP or any
  // per-slot composition ever runs. Live-tested 2026-07-14: an 8-slot capsule
  // request silently lost its last 2 slots ("City Outing 2", "Gallery Visit")
  // here — no trim line, no gap line, nothing; the ONLY hint was City Outing 2
  // and Gallery Visit's cards just never appearing in the response. Record
  // what got dropped so composeOutfitSet can disclose it the same way
  // PLAN_TOTAL_OUTFIT_CAP's trims already are.
  const droppedRawSlots = allRawSlots.slice(maxSlots)
  const normalized = allRawSlots
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
