import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import OpenAI, { toFile } from 'openai'
import { db, uploadsDir, safeJsonParse, parsePiece } from '../db.js'
import { applyTaggerResult, normalizeConfidenceMap, normalizePhotoProperties, normalizeFiberContent, tagStateForTaggerResult } from '../styling-engine/taggerMerge.js'

import {
  prepareImageForClaude,
  prepareWardrobeThumb,
  contentToOpenAI,
  askStylist,
  askStylistWithUsage,
  askStylistWithTools,
  estimateAiUsageCost,
  parseModelJson,
  AI_PROVIDER,
  ACTIVE_STYLIST_MODEL
} from '../styling-engine/provider.js'

import {
  resolveComfortFootwearConstraint,
  applyComfortFootwearRepair,
  resolveActivityProfile,
  ACTIVITY_PROFILES
} from '../styling-engine/footwear-comfort.js'

import {
  STYLIST_SYSTEM,
  STYLE_SELECTED_ITEM_SYSTEM,
  STYLE_SELECTED_ITEM_FEW_SHOTS,
  OUTFIT_BOARD_PLANNER_SYSTEM,
  WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM,
  EDITORIAL_NEW_PIECES_SYSTEM,
  RENDERER_CALIBRATION_SYSTEM,
  COMPARE_OUTFITS_SYSTEM,
  TAG_PIECE_PROMPT,
  OUTFIT_MISSIONS,
  TAG_PIECE_SYSTEM,
  EXTRACT_PIECES_SYSTEM
} from '../styling-engine/prompts.js'

import { OCCASION_PROFILES, resolveOccasionProfile } from '../styling-engine/occasions.js'
import {
  bottomKind,
  fabricWeight,
  garmentKind,
  isDarkPiece,
  pieceMatchesMaterial,
  pieceMatchesFootwear,
  sleeveCoverage
} from '../styling-engine/attributes.js'
import {
  extractWeatherContext,
  isTravelOrPackingRequest,
  normalizeActivity,
  normalizeOccasion
} from '../styling-engine/stylingIntent.js'

import {
  isStyleSelectedQuestion,
  weatherProfileFromContext,
  buildVisualComposerRoster,
  complementaryWardrobeFor,
  categoryConstraintForSelectedPiece,
  idealAdditionAnchorConstraint,
  filterWholeWardrobePiecesForGeneration,
  buildWholeWardrobeFeedbackInfluence,
  getRecentWholeWardrobeSessionInfluence,
  buildWholeWardrobeCandidateOutfits,
  wholeWardrobeCandidateFormulaCounts,
  wholeWardrobeFormulaFamily,
  wholeWardrobeArchetypeFor,
  saveWholeWardrobeSession,
  selectCandidatesForOutfitGeneration,
  getOutfitsForPieceMemory,
  getStylistFeedbackMemory,
  buildGoldStandardFeedbackMemory,
  getSavedBoardMemory,
  getWholeWardrobeFeedbackMemory,
  collectPieceIdsFromSavedBoardRow,
  collectPieceIdsFromFeedbackPayload,
  bohoSignalForPiece,
  bohoTraitForPiece,
  wholeWardrobeLabelFromPieces,
  wholeWardrobeDirectionFromPieces,
  wholeWardrobeSilhouetteFromPieces,
  wholeWardrobeReasonFromPieces,
  wholeWardrobeWatchFromPieces,
  wholeWardrobeGarmentModifier,
  qualifiesWholeWardrobeMission,
  pieceNameBlob,
  pieceTextBlob,
  wardrobeCategoryGroup,
  wholeWardrobeFullPieces,
  wholeWardrobeIsExploratory,
  wholeWardrobeHeroPieceId,
  wholeWardrobeTopBottomKey,
  wholeWardrobeGroundingStrategy,
  wholeWardrobeShoeShape,
  wholeWardrobeVisualRhythm,
  wholeWardrobeHasPrintOrStripe,
  wholeWardrobeHasNonGraphicTop,
  wholeWardrobeHasDress,
  wholeWardrobePieceByGroup,
  wholeWardrobeMissesMood,
  normalizeWholeWardrobeOutfitObject,
  dedupeMissingAgainstOwned,
  photoPreservingVisualsEnabled,
  wholeWardrobeMoodProfile,
  scoreWholeWardrobeCandidate,
  buildPieceText,
  strongestBohoPiece,
  wholeWardrobeBohoSignalScore,
  wholeWardrobeOutfitsFromCandidates,
  locallyGateWholeWardrobeOutfits,
  formatWholeWardrobeOutfitFeedback,
  repairWholeWardrobeOutfit,
  isOutfitStructurallyValid,
  rewriteWholeWardrobeOutfitWithArchetype,
  hasWholeWardrobePlaceholder,
  hasGenericWholeWardrobeText,
  outfitStylisticStrengthScore,
  sortByStylisticStrength
} from '../styling-engine/rules.js'

import {
  rankSelectedPieceCandidatesWithVision,
  composeStructuredOutfitsForPiece,
  buildLocalFallbackOutfitDirections,
  normalizeGeneratedOutfitObject,
  formatStructuredOutfitFeedback,
  boardPlanFromStructuredOutfits,
  structuredOutfitsFromGeneratedText,
  dedupeBoardPiecesForRender,
  createOutfitBoardImage,
  createWholeWardrobeOutfitImage,
  createWholeWardrobeComparisonSheetImage,
  createIdealAdditionsComparisonSheetImage,
  createSavedOutfitImage,
  evaluateOutfitThroughSharedPipeline,
  createEditorialConceptImage,
  buildIdealOnlyCompletionsForPiece,
  dedupeAndDifferentiateEditorialDirections,
  createIdentityPreservingEditImage,
  createCalibrationConceptImage,
  makeGeneratedOutfitReferenceSheet,
  buildSavedOutfitEvaluationContext,
  getConfirmedOutfitMemory,
  criticPassForSelectedItem,
  getLinkedPiecesForOutfit,
  findLikelyPiecesForOutfit,
  buildOutfitAuthorityNote,
  buildOutfitText,
  getCalibrationReferenceSummary,
  resolveOutfitEvaluationPieces,
  uploadedOrSavedOutfitPhotoPath,
  addEvaluationImage,
  resolveStylistConversationMode,
  buildStylistConversationDirective,
  getStylistConversationState,
  saveStylistConversationState,
  storeUserCorrection,
  buildStylistConversationPayload,
  normalizeCalibrationRow,
  withTimeout,
  safeJsonFromModel,
  getCalibrationMemoryForStylist,
  getCalibrationReferenceImagesForGeneration,
  runGPT4oImageGeneration,
  runOpenAIImageGeneration,
  getOpenAIImageSize,
  normalizeEditorialDirections,
  anchorFidelityInstructions,
  createPhotoPreservingCollageImage,
  ownedInventorySummaryForEditorial,
  chooseIdentityEditSource
} from '../styling-engine/core.js'

const router = express.Router()

function isBroadOutfitPlanningText(text = '') {
  const q = String(text || '').toLowerCase()
  if (!q.trim()) return false
  if (/\b(show|render|visualize|see|picture|image|why|what about|do you think|evaluate|critique)\b/.test(q)) return false // ratchet-allow: user intent routing words, not garment matching
  return /\b(outfits?|looks?|pack|packing|trip|travel|capsule|wardrobe)\b/.test(q) && // ratchet-allow: user intent routing words, not garment matching
    /\b(suggest|recommend|what should|help|plan|pack|wear|put together|create|build)\b/.test(q) // ratchet-allow: user intent routing words, not garment matching
}

function structuredOutfitContextText(outfits = [], { source = 'whole_wardrobe', reason = '' } = {}) {
  if (!Array.isArray(outfits) || !outfits.length) return ''
  const cards = outfits.slice(0, 8).map((outfit, index) => {
    const pieces = Array.isArray(outfit?.pieces)
      ? outfit.pieces.map(piece => `${piece?.name || 'Garment'}${piece?.category ? ` (${piece.category})` : ''}${piece?.id ? `, id ${piece.id}` : ''}`).join('\n- ')
      : ''
    return [
      `Outfit ${index + 1}: ${outfit.label || outfit.title || `Structured outfit ${index + 1}`}`,
      outfit.bestFor ? `Use case: ${outfit.bestFor}` : '',
      outfit.dominantDirection ? `Direction: ${outfit.dominantDirection}` : '',
      outfit.silhouette ? `Silhouette: ${outfit.silhouette}` : '',
      pieces ? `Pieces:\n- ${pieces}` : '',
      outfit.reason ? `Reason: ${outfit.reason}` : '',
      outfit.watchFor ? `Watch: ${outfit.watchFor}` : '',
    ].filter(Boolean).join('\n')
  }).join('\n\n')
  return [
    'CURRENT OUTFIT SET (LATEST, HIGH AUTHORITY): These structured cards were pre-composed by the validated wardrobe composer before the chat answer. Explain and refine these cards; do not invent a separate prose-only outfit set.',
    reason ? `Pre-composition reason: ${reason}` : '',
    source ? `Source: ${source}` : '',
    cards
  ].filter(Boolean).join('\n')
}

const USE_CASE_PLANNER_SYSTEM = `FREEFORM_STYLIST_USE_CASE_PLANNER
You convert a freeform wardrobe request into outfit use-case slots for a deterministic composer.
Return strict JSON only:
{
  "shouldCompose": boolean,
  "reason": "short reason",
  "tripSummary": {
    "durationText": "stated or inferred trip duration, if applicable",
    "dayBreakdown": "short natural breakdown of recurring day/evening needs"
  },
  "slots": [
    {
      "id": "stable_snake_case",
      "label": "short user-facing label",
      "occasion": "casual|city|smart casual|outdoor_daytime_social|evening|gallery / art event|travel|concert",
      "activity": "none|walking|hiking",
      "season": "weather/temperature for this slot",
      "bestFor": "specific use case",
      "coverage": "how many days/instances this slot spans",
      "targetOutfits": 1,
      "planNote": "one sentence composer guidance"
    }
  ]
}
Use only needs stated or clearly implied by the user/current outfit set. Do not invent a destination-specific itinerary.
For trips, infer the day structure from the stated duration and activities. A museum day is still part of the daytime city experience, even when the museum itself is indoors; fold it into the relevant daytime/city coverage instead of making a separate sedentary slot unless the user specifically asks for that.
Estimate recurring instances like daytime city days and dinners, then set targetOutfits so a few distinct looks rotate through recombination. This is packing: assume pieces repeat across days; variety comes from recombining a shared wardrobe, not making a separate wardrobe per day. Keep total distinct outfits across all slots around 6-8 or fewer; spend the budget on recurring use-cases first, while one-offs usually get one look.
Map dinner, evening restaurant, and night-out use cases to occasion "evening" with activity "none" unless the user explicitly says the dinner itself requires substantial walking. If the user asks a conversational question that does not need new composed cards, set shouldCompose false.`

const TOTAL_OUTFIT_CAP = 8

function normalizePlannerTripSummary(rawSummary = null) {
  if (!rawSummary || typeof rawSummary !== 'object') return null
  const durationText = String(rawSummary.durationText || '').trim()
  const dayBreakdown = String(rawSummary.dayBreakdown || '').trim()
  if (!durationText && !dayBreakdown) return null
  return { durationText, dayBreakdown }
}

function normalizeTripPieceName(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function tripCitySlotImpliesWalking(slot = {}, occasion = '') {
  if (occasion !== 'city') return false
  const text = [
    slot?.id,
    slot?.label,
    slot?.bestFor,
    slot?.coverage,
    slot?.planNote
  ].map(normalizeTripPieceName).join(' ')
  const tokens = new Set(text.split(/\s+/).filter(Boolean))
  return ['city', 'museum', 'museums', 'exploring', 'sightseeing', 'shopping', 'walking'].some(token => tokens.has(token))
}

function normalizePlannerSlots(rawSlots = [], { extractedWeather = '', fallbackOccasion = 'city', fallbackActivity = '', maxSlots = 5, tripSummary = null } = {}) {
  const normalized = (Array.isArray(rawSlots) ? rawSlots : [])
    .slice(0, maxSlots)
    .map((slot, index) => {
      const occasion = normalizeOccasion(slot?.occasion || fallbackOccasion || 'city')
      const plannerActivity = normalizeActivity(slot?.activity || fallbackActivity || 'none')
      const activity = plannerActivity === 'none' && tripSummary && tripCitySlotImpliesWalking(slot, occasion)
        ? 'walking'
        : plannerActivity
      const label = String(slot?.label || '').trim() || (index === 0 ? 'Primary Outfit' : `Outfit ${index + 1}`)
      const targetOutfits = Math.min(3, Math.max(1, Number.parseInt(slot?.targetOutfits, 10) || 1))
      return {
        id: String(slot?.id || label || `slot_${index + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `slot_${index + 1}`,
        label,
        occasion,
        activity,
        season: String(slot?.season || extractedWeather || 'current season').trim(),
        bestFor: String(slot?.bestFor || label).trim(),
        coverage: String(slot?.coverage || slot?.bestFor || label).trim(),
        targetOutfits,
        tripSummary,
        planNote: String(slot?.planNote || '').trim()
      }
    })
    .filter(slot => slot.label && slot.bestFor)
  let total = normalized.reduce((sum, slot) => sum + slot.targetOutfits, 0)
  for (let index = normalized.length - 1; index >= 0 && total > TOTAL_OUTFIT_CAP; index -= 1) {
    const slot = normalized[index]
    const trim = Math.min(slot.targetOutfits - 1, total - TOTAL_OUTFIT_CAP)
    if (trim > 0) {
      slot.targetOutfits -= trim
      total -= trim
    }
  }
  return normalized
}

async function planFreeformUseCases({
  question = '',
  extractedWeather = '',
  conversationMode = 'new_request',
  generatedContext = '',
  generatedOutfits = [],
  fallbackOccasion = 'city',
  fallbackActivity = '',
  maxSlots = 5
} = {}) {
  try {
    const currentSet = Array.isArray(generatedOutfits) && generatedOutfits.length
      ? generatedOutfits.slice(0, 8).map((outfit, index) => {
          const pieces = (outfit?.pieces || []).map(piece => piece?.name).filter(Boolean).join(' + ')
          return `${index + 1}. ${outfit?.label || outfit?.title || 'Outfit'}: ${pieces}`
        }).join('\n')
      : ''
    const raw = await withTimeout(askStylist({
      system: USE_CASE_PLANNER_SYSTEM,
      maxTokens: 900,
      messages: [{
        role: 'user',
        content: [
          `Conversation mode: ${conversationMode}`,
          extractedWeather ? `Established weather: ${extractedWeather}` : '',
          fallbackOccasion ? `Default occasion: ${fallbackOccasion}` : '',
          fallbackActivity ? `Default activity: ${fallbackActivity}` : '',
          generatedContext ? `Current set context:\n${String(generatedContext).slice(0, 3000)}` : '',
          currentSet ? `Current structured cards:\n${currentSet}` : '',
          `Latest user request:\n${question}`
        ].filter(Boolean).join('\n\n')
      }]
    }), 8000, 'freeform use-case planning')
    const parsed = safeJsonFromModel(raw)
    if (!parsed?.shouldCompose) return []
    const tripSummary = normalizePlannerTripSummary(parsed.tripSummary)
    return normalizePlannerSlots(parsed.slots, {
      extractedWeather,
      fallbackOccasion,
      fallbackActivity,
      maxSlots,
      tripSummary
    })
  } catch (err) {
    console.warn('Freeform use-case planner failed:', err.message)
    return []
  }
}

function annotateTripOutfit(outfit, slot, index = 0, { slotIndex = 0, slotTotal = 1 } = {}) {
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
    source: 'trip_precompose',
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

function attachTripPlanMetadata(outfits = []) {
  const tripOutfits = outfits.filter(outfit => outfit?.source === 'trip_precompose')
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
    if (outfit?.source !== 'trip_precompose') return outfit
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

function qualifiedMissionForPieces(pieces = [], { occasion = '', mood = '', activity = '' } = {}) {
  const allMissionsList = ['controlled_print', 'monochrome_texture', 'structured_soft', 'color_anchor', 'unexpected_pairing']
  let bestMissionId = null
  let bestScore = -Infinity
  for (const missionId of allMissionsList) {
    if (!qualifiesWholeWardrobeMission(pieces, missionId)) continue
    const scored = scoreWholeWardrobeCandidate(pieces, { activeMissionId: missionId, occasion, mood, activity })
    if (scored.score > bestScore) {
      bestScore = scored.score
      bestMissionId = missionId
    }
  }
  const activeMission = OUTFIT_MISSIONS.find(mission => mission.id === bestMissionId)
  return {
    missionId: bestMissionId,
    missionLabel: activeMission ? activeMission.label : null
  }
}

function comfortFootwearSuggestionForOutfit(outfit = {}, candidatePieces = [], constraint = null, { weatherProfile = {}, occasion = '', mood = '', activity = '' } = {}) {
  if (!constraint) return null
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const currentShoe = pieces.find(piece => wardrobeCategoryGroup(piece) === 'shoes')
  if (!currentShoe) return null

  const matchesAny = (piece, terms = []) => terms.some(term => pieceMatchesFootwear(piece, term))
  const warmDiscouraged = weatherProfile?.isHot ? (constraint.discouraged_footwear_warm || []) : []
  const discouraged = [...(constraint.discouraged_footwear || []), ...warmDiscouraged]
  const keep = (constraint.keep_footwear || []).filter(term => {
    if (!warmDiscouraged.length) return true
    const normalized = String(term || '').toLowerCase()
    return !warmDiscouraged.some(warmTerm => {
      const warm = String(warmTerm || '').toLowerCase()
      return normalized.includes(warm) || warm.includes(normalized)
    })
  })
  if (!matchesAny(currentShoe, discouraged) || matchesAny(currentShoe, keep)) return null

  const candidates = candidatePieces
    .filter(piece => wardrobeCategoryGroup(piece) === 'shoes')
    .filter(piece => Number(piece.id) !== Number(currentShoe.id))
    .filter(piece => matchesAny(piece, keep) && !matchesAny(piece, discouraged))
    .sort((a, b) => {
      const aOccasion = pieceMatchesFootwear(a, 'loafer') || pieceMatchesFootwear(a, 'flat') ? 1 : 0
      const bOccasion = pieceMatchesFootwear(b, 'loafer') || pieceMatchesFootwear(b, 'flat') ? 1 : 0
      return bOccasion - aOccasion || Number(a.id) - Number(b.id)
    })
  const best = candidates[0]
  if (!best) return {
    type: 'comfort',
    message: `${currentShoe.name} may be uncomfortable for ${constraint.reason}; no clear owned swap was found.`,
    swapOut: Number(currentShoe.id)
  }
  return {
    type: 'comfort',
    message: `For ${constraint.reason}, consider ${best.name} instead of ${currentShoe.name}.`,
    swapOut: Number(currentShoe.id),
    swapIn: Number(best.id)
  }
}

function fullPiecesForMissionCheck(outfit = {}, candidatePieces = []) {
  const byId = new Map((candidatePieces || []).map(piece => [Number(piece.id), piece]))
  const ids = Array.isArray(outfit.pieceIds) && outfit.pieceIds.length
    ? outfit.pieceIds.map(Number)
    : (Array.isArray(outfit.pieces) ? outfit.pieces.map(piece => Number(piece?.id)) : [])
  const resolved = ids.map(id => byId.get(id)).filter(Boolean)
  return resolved.length ? resolved : (Array.isArray(outfit.pieces) ? outfit.pieces : [])
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

function buildLocalTripSlotOutfits({ slots = [], question = '', mood = '', allPieces = [], seedOutfits = [] } = {}) {
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
      activity: slot.activity
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
      candidateBucketLimit: 8
    })
    const localOutfits = wholeWardrobeOutfitsFromCandidates(candidates, allowedPieces, {
      occasion: slot.occasion,
      mood: mood || question,
      season: slot.season,
      weatherProfile,
      activity: slot.activity
    }).filter(outfit => isOutfitStructurallyValid(outfit?.pieces || [], { requireShoes: true }))
    const ranked = locallyGateWholeWardrobeOutfits(localOutfits, Math.max(3, slots.length), {
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
        slotTotal: slotChoices.length
      }))
    })
  }
  return attachTripPlanMetadata(picked)
}

async function maybePrecomposeStructuredOutfitsForAsk(body = {}, extractedWeather = '') {
  const question = body.question || ''
  const requestedMode = body.conversationMode || 'new_request'
  if (requestedMode !== 'new_request') return null
  if (Array.isArray(body.generatedOutfits) && body.generatedOutfits.length) return null
  if (body.outfit || body.pieceId || body.piece || body.activeContext?.type === 'piece' || body.activeContext?.type === 'outfit') return null
  const isTravelPlanning = isTravelOrPackingRequest(question, body.occasion)
  if (!isBroadOutfitPlanningText(question) && !isTravelPlanning) return null
  if (isTravelPlanning && !extractedWeather) return null

  const fallbackActivity = normalizeActivity(body.activity || 'none')
  const occasion = normalizeOccasion(body.occasion || (isTravelPlanning ? 'city' : 'casual'))
  const seasonParts = [body.season || 'current season', extractedWeather].filter(Boolean)
  const plannedSlots = await planFreeformUseCases({
    question,
    extractedWeather,
    conversationMode: requestedMode,
    generatedContext: body.generatedContext || '',
    generatedOutfits: [],
    fallbackOccasion: occasion,
    fallbackActivity,
    maxSlots: isTravelPlanning ? 5 : 3
  })
  const result = await generateWholeWardrobeOutfitsVisualInternal({
    occasion,
    season: seasonParts.join('; '),
    mood: body.mood || question,
    mission: body.mission || 'mix',
    limit: 5,
    explorationMode: 'moderate',
    question,
    activity: plannedSlots[0]?.activity || fallbackActivity
  })
  let structuredOutfits = Array.isArray(result?.structuredOutfits) ? result.structuredOutfits : []
  if (plannedSlots.length) {
    const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
    const tripOutfits = buildLocalTripSlotOutfits({
      slots: plannedSlots,
      question,
      mood: body.mood || question,
      allPieces
    })
    if (tripOutfits.length) structuredOutfits = tripOutfits
  }
  if (!structuredOutfits.length) {
    const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
    const weatherProfile = weatherProfileFromContext({ mood: body.mood || question, season: seasonParts.join('; ') })
    const { allowedPieces } = filterWholeWardrobePiecesForGeneration(allPieces, {
      occasion,
      explorationMode: 'moderate',
      weatherProfile,
      mood: body.mood || question,
      activity: fallbackActivity
    })
    const candidates = buildWholeWardrobeCandidateOutfits(allowedPieces, {
      occasion,
      season: seasonParts.join('; '),
      mood: body.mood || question,
      explorationMode: 'moderate',
      activeMissions: ['controlled_print', 'monochrome_texture', 'structured_soft', 'color_anchor', 'unexpected_pairing'],
      comfortConstraint: resolveComfortFootwearConstraint({
        occasion,
        mood: body.mood || question,
        request: question,
        activity: fallbackActivity
      })
    })
    const localOutfits = wholeWardrobeOutfitsFromCandidates(candidates, allowedPieces, {
      occasion,
      mood: body.mood || question,
      season: seasonParts.join('; '),
      weatherProfile,
      activity: fallbackActivity
    }).filter(outfit => isOutfitStructurallyValid(outfit?.pieces || [], { requireShoes: true }))
    structuredOutfits = locallyGateWholeWardrobeOutfits(localOutfits, 5, {
      requireShoes: true,
      candidatePieces: allowedPieces,
      occasion,
      mood: body.mood || question,
      season: seasonParts.join('; '),
      weatherProfile,
      activity: fallbackActivity
    }).outfits
    if (!structuredOutfits.length) structuredOutfits = localOutfits.slice(0, 5)
  }
  if (!structuredOutfits.length) return null
  return {
    ...result,
    structuredOutfits,
    occasion,
    season: seasonParts.join('; '),
    activity: plannedSlots[0]?.activity || fallbackActivity,
    contextText: structuredOutfitContextText(structuredOutfits, {
      source: 'whole_wardrobe_visual_composer',
      reason: 'freeform multi-outfit planning request'
    })
  }
}

async function maybePrecomposeStructuredFollowupForAsk(body = {}, extractedWeather = '') {
  const question = body.question || ''
  const requestedMode = body.conversationMode || 'new_request'
  if (requestedMode === 'new_request') return null
  if (body.outfit || body.pieceId || body.piece || body.activeContext?.type === 'piece' || body.activeContext?.type === 'outfit') return null
  const currentOutfits = Array.isArray(body.generatedOutfits) ? body.generatedOutfits : []
  if (!currentOutfits.length) return null

  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const fallbackOccasion = normalizeOccasion(body.occasion || currentOutfits[0]?.occasion || 'city')
  const fallbackActivity = normalizeActivity(body.activity || currentOutfits[0]?.activity || 'none')
  const slots = await planFreeformUseCases({
    question,
    extractedWeather,
    conversationMode: requestedMode,
    generatedContext: body.generatedContext || '',
    generatedOutfits: currentOutfits,
    fallbackOccasion,
    fallbackActivity,
    maxSlots: 5
  })
  if (!slots.length) return null
  const structuredOutfits = buildLocalTripSlotOutfits({
    slots,
    question,
    mood: body.mood || question,
    allPieces,
    seedOutfits: currentOutfits
  })
  if (!structuredOutfits.length) return null

  return {
    structuredOutfits,
    occasion: slots[0]?.occasion || fallbackOccasion,
    season: slots[0]?.season || body.season || 'cool evening weather',
    activity: slots[0]?.activity || fallbackActivity,
    contextText: structuredOutfitContextText(structuredOutfits, {
      source: 'freeform_followup_composer',
      reason: 'validated owned-wardrobe options for current outfit set follow-up'
    })
  }
}

// Multer storage setup
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, unique + path.extname(file.originalname))
  }
})
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } })
const TAGGER_VERSION = 'v2.0.0-photo-property-authority'

// ── Shared Visual/Tagging helper ──────────────────────────────────────────────
export async function tagPieceWithProvider(photoInputs) {
  const inputs = Array.isArray(photoInputs) ? photoInputs : [{ path: photoInputs, label: 'HANGER PHOTO' }]
  const prepared = await Promise.all(inputs.map(async input => ({
    ...input,
    ...(await prepareImageForClaude(input.path))
  })))
  const content = []
  for (const input of prepared) {
    content.push({ type: 'text', text: `IMAGE INPUT - [${input.label}]:\nGuidance: ${input.guidance || ''}` })
    content.push({ type: 'image', source: { type: 'base64', media_type: input.mime, data: input.base64 } })
  }
  content.push({ type: 'text', text: TAG_PIECE_PROMPT })
  const payload = {
    system: TAG_PIECE_SYSTEM,
    maxTokens: 1500,
    messages: [{
      role: 'user',
      content
    }]
  }

  const raw = await askStylist(payload)
  const tags = parseModelJson(raw)
  if (tags && typeof tags === 'object') {
    tags.tagger_version = TAGGER_VERSION
    const confidence = normalizeConfidenceMap(tags._confidence || tags.style_profile_json?._confidence || {})
    const photoProperties = normalizePhotoProperties(tags.photo_properties || tags.style_profile_json?.photo_properties || {})
    tags.fiber_content = normalizeFiberContent(tags.fiber_content)
    tags.style_profile_json = {
      ...(tags.style_profile_json || {}),
      _confidence: confidence,
      photo_properties: photoProperties
    }
    tags._confidence = confidence
    tags.photo_properties = photoProperties
  }
  return tags
}






function computeWardrobeCoverage(allowedPieces, occasionProfile, activityProfile) {
  let topCoverage = null
  let shoeCoverage = null
  let hasCoverageCheck = false
  
  const preferredMaterials = [
    ...(occasionProfile?.rules?.preferred_materials || []),
    ...(activityProfile?.rules?.preferred_materials || [])
  ]
  const requiredFootwear = [
    ...(occasionProfile?.rules?.required_footwear || []),
    ...(activityProfile?.rules?.required_footwear || [])
  ]

  if (preferredMaterials.length > 0) {
    topCoverage = allowedPieces.filter(p => wardrobeCategoryGroup(p) === 'top' &&
      preferredMaterials.some(mat => pieceMatchesMaterial(p, mat))
    ).length
    hasCoverageCheck = true
  }
  if (requiredFootwear.length > 0) {
    shoeCoverage = allowedPieces.filter(p => (p.category === 'shoes' || wardrobeCategoryGroup(p) === 'shoes') &&
      requiredFootwear.some(fw => pieceMatchesFootwear(p, fw))
    ).length
    hasCoverageCheck = true
  }
  
  return { topCoverage, shoeCoverage, hasCoverageCheck }
}

function formatCoverageContextLabel(occasion = '', occasionProfile = null, activityProfile = null) {
  if (activityProfile?.id === 'hiking') return 'trail-ready'
  if (activityProfile?.label) return activityProfile.label.toLowerCase()
  if (occasionProfile?.label) return occasionProfile.label.toLowerCase()
  const normalized = String(occasion || '').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return normalized || 'requested'
}

function visualComposerImageDetailForRoster(rosterLength = 0) {
  const count = Number(rosterLength) || 0
  return count <= 45 ? 'high' : 'auto'
}

function persistGenerationRun({ flow, occasion = '', weather = '', rosterDebug = {}, rosterCount = 0 } = {}) {
  try {
    const cutIds = Array.isArray(rosterDebug.capCutPieces)
      ? rosterDebug.capCutPieces.map(piece => Number(piece.id)).filter(Number.isFinite)
      : []
    db.prepare(`
      INSERT INTO generation_runs (flow, occasion, weather, roster_count, pool_size, cap_applied, cut_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      flow,
      occasion || '',
      typeof weather === 'string' ? weather : JSON.stringify(weather || {}),
      Number(rosterCount) || 0,
      Number(rosterDebug.postGatePoolSize) || 0,
      rosterDebug.capApplied ? 1 : 0,
      JSON.stringify(cutIds)
    )
  } catch (err) {
    console.warn('Failed to persist generation run:', err.message)
  }
}

function formatCoverageNote(topCoverage, shoeCoverage, { occasion = '', occasionProfile = null, activityProfile = null } = {}) {
  let limitedSlots = []
  if (topCoverage !== null && topCoverage < 5) limitedSlots.push('tops')
  if (shoeCoverage !== null && shoeCoverage < 3) limitedSlots.push('footwear')
  
  if (limitedSlots.length > 0) {
    const slotsText = limitedSlots.join(' and ')
    const contextLabel = formatCoverageContextLabel(occasion, occasionProfile, activityProfile)
    return `Your wardrobe has limited ${contextLabel} ${slotsText} — these are the closest matches. Explore Additions can suggest ${contextLabel} pieces if you want to fill the gap.`
  }
  return ''
}

async function composeSelectedPieceVisualWardrobeOutfits({
  selectedPiece,
  rankedCandidates = [],
  allPieces = [],
  occasion = 'casual',
  season = 'current season',
  mission = 'mix',
  mood = '',
  question = '',
  activity = '',
  memoryText = '',
  weatherProfile = null,
  comfortConstraint = null
}) {
  const routeStartedAt = Date.now()
  const selectedId = Number(selectedPiece.id)
  const supportCandidates = rankedCandidates
    .map(r => r?.piece)
    .filter(p => p && Number(p.id) !== selectedId)
  const candidatePool = [selectedPiece, ...supportCandidates]
  const poolById = new Map(candidatePool.map(p => [Number(p.id), p]))
  const activityProfile = resolveActivityProfile({ activity, occasion, mood, request: question })
  const occasionProfile = resolveOccasionProfile(occasion, mood)
  const { roster, excluded, debug: rosterDebug } = buildVisualComposerRoster(candidatePool, {
    occasion,
    weatherProfile,
    sessionInfluence: null,
    maxImages: 54,
    mood,
    activity
  })
  const rosterPieces = [selectedPiece, ...roster.filter(p => Number(p.id) !== selectedId)]
  const candidatePieces = [...new Map(rosterPieces.map(p => [Number(p.id), p])).values()]
  const composerThumbPx = 768
  const composerImageDetail = visualComposerImageDetailForRoster(candidatePieces.length)
  const candidateIds = new Set(candidatePieces.map(p => Number(p.id)))
  const groupsOrder = ['top', 'bottom', 'dress', 'shoes', 'outerwear', 'accessory']
  const grouped = new Map(groupsOrder.map(g => [g, []]))
  for (const p of candidatePieces.filter(p => Number(p.id) !== selectedId)) {
    const group = wardrobeCategoryGroup(p) || 'accessory'
    if (!grouped.has(group)) grouped.set(group, [])
    grouped.get(group).push(p)
  }

  let occasionProfileGuidance = ''
  if (occasionProfile?.rules) {
    occasionProfileGuidance = [
      occasionProfile.vibe ? `Occasion vibe: ${occasionProfile.vibe}` : '',
      occasionProfile.rules.required_footwear?.length ? `Required footwear: ${occasionProfile.rules.required_footwear.join(', ')}` : '',
      occasionProfile.rules.prohibited_footwear?.length ? `Avoid footwear: ${occasionProfile.rules.prohibited_footwear.join(', ')}` : '',
      occasionProfile.rules.prohibited_materials?.length ? `Avoid materials: ${occasionProfile.rules.prohibited_materials.join(', ')}` : ''
    ].filter(Boolean).join('\n')
  }
  if (activityProfile) {
    const preferred = [
      ...(activityProfile.rules?.preferred_footwear || []),
      ...(activityProfile.rules?.preferred_materials || []),
      ...(activityProfile.rules?.preferred_pieces || [])
    ].join(', ')
    const discouraged = [
      ...(activityProfile.rules?.discouraged_materials || []),
      ...(activityProfile.rules?.discouraged_footwear || []),
      ...(activityProfile.rules?.discouraged_pieces || [])
    ].join(', ')
    const activityGuidance = [
      activityProfile.vibe ? `Activity vibe: ${activityProfile.vibe}` : '',
      preferred ? `For this activity, lean toward: ${preferred}` : '',
      discouraged ? `For this activity, use sparingly and justify: ${discouraged}` : ''
    ].filter(Boolean).join('\n')
    occasionProfileGuidance = [occasionProfileGuidance, activityGuidance].filter(Boolean).join('\n\n')
  }
  if (comfortConstraint) {
    const walkingGuidance = comfortConstraint.reason === 'all-day walking comfort'
      ? 'All-day walking: avoid stilettos, high heels, pumps, delicate sandals, and warm-weather boots; prefer low block heels, loafers, flats, sneakers.'
      : 'Hiking/Outdoor active: avoid heels, wedges, dress shoes, delicate sandals, mules, and sandals; require sneakers, athletic shoes, or flat rugged boots.'
    occasionProfileGuidance = [occasionProfileGuidance, walkingGuidance].filter(Boolean).join('\n')
  }

  const content = []
  content.push({ type: 'text', text: [
    `Selected anchor id: ${selectedPiece.id}`,
    categoryConstraintForSelectedPiece(selectedPiece),
    `Selected garment truth:\n${buildPieceText(selectedPiece)}`,
    '',
    `Occasion: ${occasion}`,
    `Season: ${season}`,
    mission && mission !== 'mix' ? `Mission: ${mission}` : '',
    mood ? `Mood: ${mood}` : '',
    activity && activity !== 'none' ? `Activity: ${activity}` : '',
    occasionProfileGuidance ? `Occasion/activity guidance:\n${occasionProfileGuidance}` : '',
    memoryText ? `Taste and selected-garment memory:\n${memoryText.slice(0, 7000)}` : '',
    '',
    'Compose 3-4 complete outfits using only shown saved wardrobe pieces.',
    `Every outfit must include selected anchor id ${selectedPiece.id}. Do not replace it with another ${wardrobeCategoryGroup(selectedPiece) || selectedPiece.category}.`,
    'Use the selected garment as the visual/thematic anchor; choose support pieces around its actual role, risks, and confidence-aware garment truth.',
    'Reference pieces only by exact IDs shown in labels. Do not invent missing pieces in this wardrobe mode.',
    '',
    'Below are photos of the selected anchor and candidate support pieces, grouped by category.'
  ].filter(Boolean).join('\n') })

  let shownPieceCount = 0
  const shownPieces = []
  async function addPieceImage(piece, labelPrefix, detailOverride = null) {
    const photoFile = piece.worn_photo || piece.photo || ''
    if (!photoFile) return
    const filePath = path.join(uploadsDir, photoFile)
    if (!fs.existsSync(filePath)) return
    const thumb = await prepareWardrobeThumb(filePath, `${piece.id}:${photoFile}`, { maxPx: composerThumbPx })
    content.push({ type: 'text', text: `${labelPrefix} ID ${piece.id}: ${piece.name}` })
    content.push({ type: 'image', detail: detailOverride || composerImageDetail, source: { type: 'base64', media_type: thumb.media_type, data: thumb.data } })
    shownPieceCount++
    shownPieces.push(piece)
  }

  await addPieceImage(selectedPiece, 'SELECTED ANCHOR', 'high')
  for (const group of grouped.keys()) {
    const pieces = grouped.get(group)
    if (!pieces?.length) continue
    content.push({ type: 'text', text: `=== SUPPORT ${group.toUpperCase()}S ===` })
    for (const p of pieces) await addPieceImage(p, 'SUPPORT')
  }

  const timings = { thumbPrepMs: Date.now() - routeStartedAt }
  let parsed = {}
  let composerError = null
  let composerUsage = null
  try {
    const composerStartedAt = Date.now()
    const composerResult = await withTimeout(askStylistWithUsage({
      system: `${WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM}\n\nSELECTED-ANCHOR CONTRACT:\nEvery outfit must include the selected anchor id. The selected garment is the premise, not one option among many.\n\nOCCASION & CLIMATE PROFILES (RULES-AS-DATA):\n${JSON.stringify(OCCASION_PROFILES, null, 2)}\n\nACTIVITY PROFILES (RULES-AS-DATA):\n${JSON.stringify(ACTIVITY_PROFILES, null, 2)}`,
      maxTokens: 2000,
      messages: [{ role: 'user', content }]
    }), 90000, 'Selected-piece visual composer')
    timings.composerMs = Date.now() - composerStartedAt
    composerUsage = composerResult.usage || null
    parsed = safeJsonFromModel(composerResult.text)
  } catch (err) {
    timings.composerMs = Date.now() - routeStartedAt - timings.thumbPrepMs
    composerError = err.message
  }

  const resolved = (Array.isArray(parsed?.outfits) ? parsed.outfits : []).map(outfit => {
    const ids = Array.isArray(outfit.pieceIds) ? outfit.pieceIds.map(Number) : []
    if (!ids.includes(selectedId)) ids.unshift(selectedId)
    const owned = [...new Set(ids)]
      .filter(id => candidateIds.has(id))
      .map(id => poolById.get(id) || candidatePieces.find(p => Number(p.id) === id))
      .filter(Boolean)
    return { ...outfit, pieceIds: owned.map(p => Number(p.id)), pieces: owned }
  }).filter(o => o.pieces.some(p => Number(p.id) === selectedId) && o.pieces.length >= 2)

  let outfits = resolved.map(o =>
    repairWholeWardrobeOutfit(normalizeWholeWardrobeOutfitObject(o, candidatePieces), candidatePieces, occasion, mood, { season, weatherProfile, activity }))
    .filter(o => (o.pieceIds || []).map(Number).includes(selectedId))
    .filter(o => isOutfitStructurallyValid(o.pieces, { requireShoes: true }))

  if (!outfits.length) {
    const localFallback = buildLocalFallbackOutfitDirections(selectedPiece, rankedCandidates, { occasion })
    outfits = localFallback
      .map(o => normalizeGeneratedOutfitObject(o, selectedPiece, candidatePool))
      .filter(o => (o.pieceIds || []).map(Number).includes(selectedId))
  }

  if (comfortConstraint) {
    const visibleRepairPool = shownPieces.length ? shownPieces : candidatePieces
    outfits = outfits.map(o => {
      const repairedFromShown = applyComfortFootwearRepair(o, visibleRepairPool, comfortConstraint, { weatherProfile, occasion, mood, activity })
      return repairedFromShown === o
        ? applyComfortFootwearRepair(o, allPieces, comfortConstraint, { weatherProfile, occasion, mood, activity })
        : repairedFromShown
    })
  }

  outfits = outfits.slice(0, 4).map(outfit => ({
    ...outfit,
    selectedPieceId: selectedPiece.id,
    wholeWardrobe: false,
    textOnly: true
  }))

  return {
    outfits,
    rejected: parsed.rejected || [],
    skip: parsed.skip || '',
    saveableLearning: parsed.saveableLearning || '',
    debug: {
      shownPieceCount,
      rosterCount: candidatePieces.length,
      excludedCount: excluded.length,
      excludedCounts: rosterDebug.excludedCounts,
      postGatePoolSize: rosterDebug.postGatePoolSize,
      capApplied: rosterDebug.capApplied,
      capCutPieces: rosterDebug.capCutPieces,
      slotCoverage: rosterDebug.slotCoverage,
      imageDetail: composerImageDetail,
      thumbPx: composerThumbPx,
      aiReturnedCount: Array.isArray(parsed?.outfits) ? parsed.outfits.length : 0,
      composerError,
      composerUsage: composerUsage ? {
        ...composerUsage,
        estimatedCost: estimateAiUsageCost(composerUsage)
      } : null,
      timings
    }
  }
}


// ── AI Tagging endpoints ───────────────────────────────────────────────────────
router.post('/extract-pieces', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo provided' })
  const filePath = path.join(uploadsDir, req.file.filename)
  try {
    const { base64, mime } = await prepareImageForClaude(filePath)
    fs.unlinkSync(filePath)

    const raw = await askStylist({
      system: EXTRACT_PIECES_SYSTEM,
      maxTokens: 1200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
          { type: 'text', text: `Look at this outfit photo and identify every clothing item and accessory visible.
Return ONLY a valid JSON object — no markdown, no explanation, just JSON:
{
  "pieces": [
    {
      "name_suggestion": "descriptive name: [visual]+[pattern/texture]+[shape]+[length], 3-5 words, lowercase. e.g. 'sculptural asymmetrical cowl knit top' or 'black cream botanical midi skirt'",
      "notes_suggestion": "1-2 sentence stylist summary of the item's visual structure, texture, design details (e.g. asymmetrical button cowls, curved high-low design hems), and styling potential for the user's notes.",
      "category": "top|bottom|dress|outerwear|shoes|accessory",
      "background_color": "base color of the garment, e.g. black, navy, cream, white",
      "colors": ["only from: black, white, cream, beige, taupe, grey, charcoal, navy, denim, brown, tan, oatmeal, amber, mustard, orange, red, pink, mauve, lavender, lilac, plum, green, olive, turquoise, dark blue, dark grey, light grey, light blue, periwinkle, multi"],
      "occasions": ["only from: casual, city, evening, smart-casual, outdoor, home"],
      "season": "warm|cool|year-round",
      "pattern_type": "solid|floral|stripe|botanical|geometric|abstract|animal|graphic|plaid|other",
      "pattern_scale": "none|subtle|medium|bold",
      "pattern_complexity": "solid|quiet|medium|loud",
      "reads_as": "short phrase: the dominant visual impression",
      "hem_finish": "straight_loose|banded_elastic|ribbed|design_hem",
      "neckline": "V|scoop|crew|boat|mock|cowl|off-shoulder|square|wrap|other|none",
      "sleeve_type": "sleeveless|cap|short|3/4|long|bell|bishop|none",
      "length_hits_at": "crop|waist|hip|mid-thigh|knee|midi|maxi|full-length",
      "silhouette": "fitted|slim|relaxed|boxy|A-line|drop-shoulder|oversized",
      "fabric_category": "jersey|knit|linen|silk|satin|cotton|wool|cashmere|viscose|denim|twill|canvas|corduroy|tweed|velvet|leather|suede|ponte|synthetic|fleece|other",
      "fabric_weight": "ultralight|light|medium|heavy",
      "fiber_content": ["array of visible/likely fibers from this canonical list only: wool, merino, cashmere, alpaca, mohair, fleece, down, cotton, linen, silk, tencel, modal, rayon, viscose, polyester, nylon, acrylic, spandex, leather, suede, denim, unknown. Use 'unknown' if not determinable."],
      "style_profile_json": {
        "style_lanes": {
          "artistic_minimal": 0, "modern_bohemian": 0, "folk_artisan": 0, "boho_romantic": 0, "boho_festival": 0,
          "graphic_casual": 0, "earthy_structured": 0, "polished_classic": 0, "romantic_soft": 0, "workwear_utilitarian": 0
        },
        "visual_roles": ["choose 1-4: hero_piece, support_piece, grounding_piece, sharpener_piece, texture_piece, movement_piece, column_piece, quiet_anchor, color_accent"],
        "style_notes": {
          "best_use": "stylist role description based on design weight. Avoid generic 'casual wear' or 'daily casual' phrases.",
          "risk": "styling or aesthetic risk. Do not put 'needs fit review' here; risk must be a styling/aesthetic constraint."
        },
        "garment_intelligence": {
          "auto_use_trust": "trusted|support_only|experimental|needs_fit_review|do_not_auto_use",
          "best_outfit_role": "hero|support|grounding|movement|sharpener|color_accent|texture_accent|column",
          "pairing_requirements": ["0-4 concise engine-facing requirements"],
          "failure_risks": ["0-4 specific functional/wear risks"],
          "formula_compatibility": ["0-4 outfit formulas supported"],
          "do_not_pair_rules": ["0-4 concrete pairing rules"]
        }
      }
    }
  ]
}` }
        ]
      }]
    })

    res.json(parseModelJson(raw))
  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    console.error('Extract pieces error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/tag-piece', upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'worn_photo', maxCount: 1 }
]), async (req, res) => {
  const files = req.files || {}
  const photoFile = files.photo ? files.photo[0] : null
  const wornPhotoFile = files.worn_photo ? files.worn_photo[0] : null

  if (!photoFile && !wornPhotoFile) {
    return res.status(400).json({ error: 'No photo provided' })
  }

  const photos = []
  if (photoFile) {
    const filePath = path.join(uploadsDir, photoFile.filename)
    photos.push({
      path: filePath,
      label: 'HANGER PHOTO',
      guidance: 'Use for literal garment truth: category, color, construction, pattern, fabric, and shape.'
    })
  }
  if (wornPhotoFile) {
    const filePath = path.join(uploadsDir, wornPhotoFile.filename)
    photos.push({
      path: filePath,
      label: 'WORN PHOTO',
      guidance: 'Use for fit, drape, scale, real-wear behavior, outfit role, and risks. Do not override literal garment color/category from this styling context.'
    })
  }

  try {
    const tags = await tagPieceWithProvider(photos)
    tags.tag_state = tagStateForTaggerResult(tags, { photo: Boolean(photoFile), worn_photo: Boolean(wornPhotoFile) })
    photos.forEach(p => {
      if (fs.existsSync(p.path)) fs.unlinkSync(p.path)
    })
    res.json(tags)
  } catch (err) {
    photos.forEach(p => {
      if (fs.existsSync(p.path)) fs.unlinkSync(p.path)
    })
    console.error('AI tag error:', err)
    res.status(500).json({ error: err.message })
  }
})

const tagExistingHandler = async (req, res) => {
  const tempFiles = []
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(req.params.id)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })

    const photos = []
    const photoFile = req.files?.photo?.[0]
    if (photoFile) {
      const filePath = path.join(uploadsDir, photoFile.filename)
      photos.push({ path: filePath, label: 'HANGER PHOTO', guidance: 'Use for literal garment truth: category, color, construction, pattern, fabric, and shape.' })
      tempFiles.push(filePath)
    } else if (piece.photo) {
      const hangerPath = path.join(uploadsDir, piece.photo)
      if (fs.existsSync(hangerPath)) {
        photos.push({ path: hangerPath, label: 'HANGER PHOTO', guidance: 'Use for literal garment truth: category, color, construction, pattern, fabric, and shape.' })
      }
    }

    const wornPhotoFile = req.files?.worn_photo?.[0]
    if (wornPhotoFile) {
      const filePath = path.join(uploadsDir, wornPhotoFile.filename)
      photos.push({ path: filePath, label: 'WORN PHOTO', guidance: 'Use for fit, drape, scale, real-wear behavior, outfit role, and risks. Do not override literal garment color/category from this styling context.' })
      tempFiles.push(filePath)
    } else if (piece.worn_photo) {
      const wornPath = path.join(uploadsDir, piece.worn_photo)
      if (fs.existsSync(wornPath)) {
        photos.push({ path: wornPath, label: 'WORN PHOTO', guidance: 'Use for fit, drape, scale, real-wear behavior, outfit role, and risks. Do not override literal garment color/category from this styling context.' })
      }
    }

    if (!photos.length) return res.status(400).json({ error: 'This piece has no photo to tag' })

    const tags = await tagPieceWithProvider(photos)
    tags.tag_state = tagStateForTaggerResult(tags, {
      photo: Boolean(photoFile || piece.photo),
      worn_photo: Boolean(wornPhotoFile || piece.worn_photo)
    })
    const merged = applyTaggerResult(parsePiece(piece), tags)
    tempFiles.forEach(f => {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    })
    res.json(merged)
  } catch (err) {
    tempFiles.forEach(f => {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    })
    console.error('AI retag error:', err)
    res.status(500).json({ error: err.message })
  }
}

router.post('/tag-piece-existing/:id', upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'worn_photo', maxCount: 1 }
]), tagExistingHandler)

router.post('/tag-piece-claude/:id', upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'worn_photo', maxCount: 1 }
]), tagExistingHandler)

// ── AI Evaluation/Styling ─────────────────────────────────────────────────────
router.post('/evaluate-piece', async (req, res) => {
  const { pieceId, question, history } = req.body
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })

    const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
    const parsedPiece = parsePiece(piece)
    const selectedStyleMode = isStyleSelectedQuestion(question)

    const relatedWardrobe = selectedStyleMode
      ? complementaryWardrobeFor(parsedPiece, allPieces)
      : allPieces.filter(p => p.id !== piece.id)
    const wardrobeText = relatedWardrobe.map(buildPieceText).join('\n')
    const confirmedOutfitsText = getConfirmedOutfitMemory()
    const selectedPieceOutfitsText = getOutfitsForPieceMemory(parsedPiece.id)

    const content = []
    const photoFile = piece.worn_photo || piece.photo
    if (photoFile) {
      const filePath = path.join(uploadsDir, photoFile)
      if (fs.existsSync(filePath)) {
        const { base64, mime } = await prepareImageForClaude(filePath)
        content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
      }
    }

    if (selectedStyleMode) {
      content.push({ type: 'text', text: [
        `Mode: STYLE_SELECTED_ITEM`,
        categoryConstraintForSelectedPiece(parsedPiece),
        '',
        `Selected item — corrected garment truth. This overrides image guesses:`,
        buildPieceText(parsedPiece),
        '',
        selectedPieceOutfitsText ? `Saved outfits that already use this selected item:\n${selectedPieceOutfitsText}` : `Saved outfits using this selected item: none yet`,
        '',
        confirmedOutfitsText ? `General confirmed/favorite outfit memory for Yuna's taste filter:\n${confirmedOutfitsText}` : '',
        '',
        wardrobeText ? `Available wardrobe pieces that may be used as supporting items. Do not replace the selected item with these:\n${wardrobeText}` : '',
        '',
        `Few-shot quality examples:\n${STYLE_SELECTED_ITEM_FEW_SHOTS}`,
        '',
        `User question: ${question || 'How should I style this piece?'}`,
        '',
        `Final reminder: every outfit idea must include "${parsedPiece.name}". Use the ranked candidates as your wardrobe pool. If you choose a lower-ranked candidate, explain the visual reason.`
      ].filter(Boolean).join('\n') })

      const draft = await askStylist({
        system: STYLE_SELECTED_ITEM_SYSTEM,
        maxTokens: 1200,
        messages: [
          ...(history || []).map(h => ({ role: h.role, content: h.content })),
          { role: 'user', content }
        ]
      })
      const answer = await criticPassForSelectedItem({ selectedPiece: parsedPiece, draft, userQuestion: question })
      return res.json({ feedback: answer, provider: AI_PROVIDER, mode: 'STYLE_SELECTED_ITEM' })
    }

    content.push({ type: 'text', text: [
      `Mode: evaluate_piece`,
      `Piece being evaluated — use these corrected records as truth:`,
      buildPieceText(parsedPiece),
      '',
      confirmedOutfitsText ? `Confirmed outfit memory:\n${confirmedOutfitsText}` : '',
      '',
      `Rest of active wardrobe for pairings:\n${wardrobeText}`,
      '',
      question || 'What can you tell me about this piece and how to style it?'
    ].filter(Boolean).join('\n') })

    const answer = await askStylist({
      maxTokens: 1200,
      messages: [
        ...(history || []).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content }
      ]
    })
    res.json({ feedback: answer, provider: AI_PROVIDER, mode: 'evaluate_piece' })
  } catch (err) {
    console.error('Evaluate piece error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── AI Outfit Generation ──────────────────────────────────────────────────────
export async function generateOutfitsForPieceInternal({
  pieceId,
  occasion = 'casual',
  season = 'current season',
  mission = 'mix',
  mood = '',
  question,
  history,
  includeMissingPieces = false,
  idealOnly = false,
  activity = ''
}) {
  console.log(`\n[0] 🧥 generateOutfitsForPieceInternal called:`)
  console.log(`    - pieceId: ${pieceId}`)
  console.log(`    - occasion: "${occasion}" | season: "${season}" | mission: "${mission}" | mood: "${mood}" | activity: "${activity}"`)
  console.log(`    - includeMissingPieces: ${includeMissingPieces} | idealOnly: ${idealOnly}`)
  
  const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
  if (!piece) {
    throw new Error(`Piece ID ${pieceId} not found in database.`)
  }

  const parsedPiece = parsePiece(piece)
  const idealMode = Boolean(includeMissingPieces || idealOnly || /ideal|missing|new ideas|do not have|don't have|dont have|not in my wardrobe|wish list|wardrobe gap/i.test(String(question || '')))
  const idealOnlyMode = Boolean(idealOnly || /new ideas|do not limit|not limited|not just my wardrobe|ignore wardrobe|conceptual/i.test(String(question || '')))
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const weatherProfile = weatherProfileFromContext({ mood, season })
  const comfortConstraint = resolveComfortFootwearConstraint({ occasion, mood, request: question, activity })
  let rankedCandidates = selectCandidatesForOutfitGeneration(parsedPiece, allPieces, 32, { occasion, mission, mood, season, weatherProfile, comfortConstraint, activity })
  console.log(`    - Found ${rankedCandidates.length} supporting wardrobe candidates.`)
  const confirmedOutfitsText = getConfirmedOutfitMemory()
  const selectedPieceOutfitsText = getOutfitsForPieceMemory(parsedPiece.id, 8)
  const selectedFeedbackText = getStylistFeedbackMemory('piece', parsedPiece.id, 16)
  const goldFeedbackText = buildGoldStandardFeedbackMemory(parsedPiece.id, 10)
  const selectedSavedBoardText = getSavedBoardMemory('piece', parsedPiece.id, 10)
  const globalSavedBoardText = getSavedBoardMemory(null, null, 12)
  const globalFeedbackText = getStylistFeedbackMemory(null, null, 24)
  const calibrationMemoryText = getCalibrationMemoryForStylist(32)

  const memoryText = [
    selectedPieceOutfitsText ? `Saved outfits already using this selected garment:\n${selectedPieceOutfitsText}` : `Saved outfits using this selected garment: none yet`,
    goldFeedbackText ? `High-authority signature/works feedback for this garment. Reinforce similar formulas:\n${goldFeedbackText}` : '',
    selectedSavedBoardText ? `Saved visual boards for this garment. Use strongly boards are high-authority outfit memory:\n${selectedSavedBoardText}` : '',
    selectedFeedbackText ? `Recent feedback for this garment. Signature/Works should be reinforced; Not me/Too soft/Proportion problem should suppress similar ideas:\n${selectedFeedbackText}` : '',
    confirmedOutfitsText ? `Confirmed/favorite outfit memory for Yuna's taste filter:\n${confirmedOutfitsText}` : '',
    globalSavedBoardText ? `Global saved board memory. Use strongly boards should bias ranking when relevant:\n${globalSavedBoardText}` : '',
    calibrationMemoryText ? `Calibration Library memory. This is higher authority than broad style theory for taste boundaries and identity-preservation:\n${calibrationMemoryText}` : '',
    globalFeedbackText ? `General saved stylist feedback memory:\n${globalFeedbackText}` : ''
  ].filter(Boolean).join('\n\n')

  let visualCriticDebug = null
  let composed = null
  if (!idealMode && !idealOnlyMode) {
    composed = await composeSelectedPieceVisualWardrobeOutfits({
      selectedPiece: parsedPiece,
      rankedCandidates,
      allPieces,
      occasion,
      season,
      mission,
      mood,
      question,
      activity,
      memoryText,
      weatherProfile,
      comfortConstraint
    })
    visualCriticDebug = composed.debug || null
  } else {
    try {
      const visualReview = await withTimeout(rankSelectedPieceCandidatesWithVision({
        selectedPiece: parsedPiece,
        rankedCandidates,
        occasion,
        season,
        mission,
        mood,
        question,
        memoryText
      }), 20000, 'Selected-piece visual critic')
      if (visualReview?.rankedCandidates?.length) {
        rankedCandidates = visualReview.rankedCandidates
        visualCriticDebug = visualReview.debug || null
      }
    } catch (err) {
      console.warn('Selected-piece visual critic fallback:', err.message)
      visualCriticDebug = { error: err.message }
    }

    composed = await composeStructuredOutfitsForPiece({
      selectedPiece: parsedPiece,
      rankedCandidates,
      occasion,
      season,
      mission,
      mood,
      question,
      idealMode,
      idealOnlyMode,
      memoryText,
      history
    })
  }

  let structuredOutfits = Array.isArray(composed.outfits) ? composed.outfits : []
  if (structuredOutfits.length > 0) {
    console.log(`    - Successfully generated ${structuredOutfits.length} outfits from AI stylist composer.`)
  } else if (!idealOnlyMode) {
    console.log(`    - AI stylist composer returned 0 outfits. Falling back to local wardrobe directions.`)
    structuredOutfits = buildLocalFallbackOutfitDirections(parsedPiece, rankedCandidates, { occasion })
  }
  if (!structuredOutfits.length) {
    console.log(`    - Local fallback generated 0 outfits. Using absolute basic backfill.`)
    const candidates = (rankedCandidates || []).map(r => r.piece).filter(Boolean)
    const selectedGroup = wardrobeCategoryGroup(parsedPiece)
    const supporting = candidates.filter(p => Number(p.id) !== Number(parsedPiece.id)).slice(0, 4)
    structuredOutfits = [normalizeGeneratedOutfitObject({
      label: 'Best available wardrobe direction',
      strength: 'usable',
      dominantDirection: 'simple closet-based pairing using the selected garment',
      silhouette: selectedGroup === 'bottom' ? 'selected bottom with a controlled top' : selectedGroup === 'top' ? 'selected top with the cleanest available bottom' : 'selected garment with restrained support pieces',
      bestFor: 'testing from saved wardrobe pieces',
      pieceIds: [parsedPiece.id, ...supporting.map(p => p.id)].filter(Boolean).slice(0, 5),
      pieces: [parsedPiece, ...supporting].map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        photo: p.photo || null,
        worn_photo: p.worn_photo || null
      })).slice(0, 5),
      reason: 'Fallback direction generated locally because the AI response did not return visible outfit cards.',
    }, parsedPiece, [parsedPiece, ...candidates])]
  }

  if (comfortConstraint) {
    structuredOutfits = structuredOutfits.map(o => applyComfortFootwearRepair(o, allPieces, comfortConstraint, { weatherProfile, occasion, mood, activity }))
  }
  if (!idealMode && !idealOnlyMode && visualCriticDebug) {
    persistGenerationRun({
      flow: 'anchor_visual',
      occasion,
      weather: weatherProfile,
      rosterDebug: visualCriticDebug,
      rosterCount: Number(visualCriticDebug.rosterCount) || 0
    })
  }
  const answer = formatStructuredOutfitFeedback({
    selectedPiece: parsedPiece,
    occasion,
    season,
    outfits: structuredOutfits,
    skip: composed.skip,
    saveableLearning: composed.saveableLearning
  })

  return {
    feedback: answer,
    structuredOutfits,
    rejectedOutfits: composed.rejected || [],
    provider: AI_PROVIDER,
    mode: idealOnlyMode ? 'ideal_new_ideas_only' : idealMode ? 'ideal_styling_directions' : 'generate_outfit_ideas',
    pipeline: idealOnlyMode
      ? 'composer_evaluator_renderer_handoff'
      : idealMode
        ? 'visual_candidate_reviewer_composer_evaluator_renderer_handoff'
        : 'selected_piece_visual_composer',
    idealMode,
    idealOnlyMode,
    debug: {
      visualCritic: visualCriticDebug,
      composerUsage: visualCriticDebug?.composerUsage || null,
      weatherProfile
    }
  }
}

router.post('/generate-outfits-for-piece', async (req, res) => {
  try {
    const result = await generateOutfitsForPieceInternal(req.body)
    res.json(result)
  } catch (err) {
    console.error('Generate outfit ideas error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.delete('/whole-wardrobe-session-memory', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM whole_wardrobe_sessions').run()
    res.json({
      success: true,
      clearedCount: result.changes || 0,
      mode: 'reset_whole_wardrobe_session_memory'
    })
  } catch (err) {
    console.error('Reset whole-wardrobe session memory error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/generate-wardrobe-outfits', async (req, res) => {
  try {
    const result = await generateWholeWardrobeOutfitsVisualInternal(req.body || {})
    res.json({ ...result, deprecated: true })
  } catch (err) {
    console.error('Generate whole-wardrobe outfits error:', err)
    res.status(500).json({ error: err.message })
  }
})

export async function generateWholeWardrobeOutfitsVisualInternal({
  occasion = 'casual',
  season = 'current season',
  mission = 'mix',
  mood = '',
  limit = 5,
  explorationMode = 'moderate',
  question = '',
  request = '',
  activity = ''
} = {}) {
    const routeStartedAt = Date.now()
    const requestedLimit = Math.max(1, Math.min(5, Number(limit) || 5))
    const weatherProfile = weatherProfileFromContext({ mood, season })
    const occasionProfile = resolveOccasionProfile(occasion, mood)
    const activityProfile = resolveActivityProfile({ activity, occasion, mood, request: request || question || '' })
    const comfortConstraint = resolveComfortFootwearConstraint({
      occasion,
      mood,
      request: request || question || '',
      activity
    })
    let occasionProfileGuidance = ''
    if (occasionProfile) {
      const preferred = [
        ...(occasionProfile.rules?.preferred_materials || []),
        ...(occasionProfile.rules?.preferred_footwear || [])
      ].join(', ')
      const discouraged = [
        ...(occasionProfile.rules?.discouraged_materials || []),
        ...(occasionProfile.rules?.discouraged_materials_warm || []),
        ...(occasionProfile.rules?.discouraged_footwear || []),
        ...(occasionProfile.rules?.discouraged_footwear_summer || []),
        ...(occasionProfile.rules?.discouraged_pieces || [])
      ].join(', ')
      
      const parts = []
      parts.push(`Occasion Vibe: ${occasionProfile.vibe}`)
      if (preferred || discouraged) {
        let rulesLine = 'For this occasion, '
        if (preferred) {
          rulesLine += `lean toward: ${preferred}`
        }
        if (discouraged) {
          if (preferred) rulesLine += '; '
          rulesLine += `use sparingly and justify in watchFor: ${discouraged}`
        }
        rulesLine += '.'
        parts.push(rulesLine)
      }
      occasionProfileGuidance = parts.join('\n')
    }

    if (activityProfile) {
      const preferred = [
        ...(activityProfile.rules?.preferred_materials || []),
        ...(activityProfile.rules?.preferred_footwear || [])
      ].join(', ')
      const discouraged = [
        ...(activityProfile.rules?.discouraged_materials || []),
        ...(activityProfile.rules?.discouraged_materials_warm || []),
        ...(activityProfile.rules?.discouraged_footwear || []),
        ...(activityProfile.rules?.discouraged_footwear_summer || []),
        ...(activityProfile.rules?.discouraged_footwear_warm || []),
        ...(activityProfile.rules?.discouraged_pieces || [])
      ].join(', ')
      
      const parts = []
      parts.push(`Activity Vibe: ${activityProfile.vibe || 'movement-focused'}`)
      if (preferred || discouraged) {
        let rulesLine = 'For this activity, '
        if (preferred) {
          rulesLine += `lean toward: ${preferred}`
        }
        if (discouraged) {
          if (preferred) rulesLine += '; '
          rulesLine += `use sparingly and justify in watchFor: ${discouraged}`
        }
        rulesLine += '.'
        parts.push(rulesLine)
      }
      const activityGuidance = parts.join('\n')
      occasionProfileGuidance = occasionProfileGuidance
        ? `${occasionProfileGuidance}\n\n${activityGuidance}`
        : activityGuidance
    }

    if (comfortConstraint) {
      const walkingGuidance = comfortConstraint.reason === 'all-day walking comfort'
        ? "All-day walking: avoid stilettos, high heels, pumps, delicate sandals, and warm-weather boots; prefer low block heels, loafers, flats, sneakers."
        : "Hiking/Outdoor active: avoid heels, wedges, dress shoes, delicate sandals, mules, and sandals; require sneakers, athletic shoes, or flat rugged boots."
      occasionProfileGuidance = occasionProfileGuidance
        ? `${occasionProfileGuidance}\n${walkingGuidance}`
        : walkingGuidance
    }
    const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)

    // Reuse existing suppression filter (hard filter here — suppressed pieces are simply not shown)
    const { allowedPieces, suppressedPieces } =
      filterWholeWardrobePiecesForGeneration(allPieces, { occasion, explorationMode, weatherProfile, mood, activity })

    // Session memory (reuse existing)
    const sessionInfluence = getRecentWholeWardrobeSessionInfluence({ occasion, daysCutoff: 6 })
    const rotationWarningsText = sessionInfluence.pieceRecency?.size
      ? `Recently shown garments — avoid unless clearly the best choice: ${
          [...sessionInfluence.pieceRecency.keys()]
            .map(id => allowedPieces.find(p => Number(p.id) === Number(id))?.name)
            .filter(Boolean).join(', ')}`
      : ''

    // Memory context (reuse existing builders, keep it lean)
    const wholeWardrobeFeedbackText = getWholeWardrobeFeedbackMemory(20)
    const confirmedOutfitsText = getConfirmedOutfitMemory(8)

    // Compute weather profile and filter the visual composer roster
    const { roster, excluded, debug: rosterDebug } = buildVisualComposerRoster(allowedPieces, {
      occasion,
      weatherProfile,
      sessionInfluence,
      maxImages: 90,
      mood,
      activity
    })

    console.log(`\n[Visual Composer Roster] Filtering active pieces for mood: "${mood}", season: "${season}"`)
    console.log(`  - Total active pieces: ${allowedPieces.length}`)
    console.log(`  - Survived in roster: ${roster.length}`)
    console.log(`  - Excluded: ${excluded.length}`)
    console.log(`  - Excluded reasons count:`, rosterDebug.excludedCounts)

    const composerThumbPx = 768
    const composerImageDetail = visualComposerImageDetailForRoster(roster.length)

    // Build the multimodal content array, grouped by category (only showing rostered pieces)
    const groupsOrder = ['top', 'bottom', 'dress', 'shoes', 'outerwear', 'accessory']
    const grouped = new Map(groupsOrder.map(g => [g, []]))
    for (const p of roster) {
      const group = wardrobeCategoryGroup(p) || 'accessory'
      if (!grouped.has(group)) grouped.set(group, [])
      grouped.get(group).push(p)
    }

    const isWeatherFiltered = weatherProfile.isHot || weatherProfile.isCold
    const content = []
    content.push({ type: 'text', text: [
      `Occasion: ${occasion}`,
      `Season: ${season}`,
      mood ? `Mood: ${mood}` : '',
      activity && activity !== 'none' ? `Activity: ${activity}` : '',
      occasionProfileGuidance ? `Occasion guidance:\n${occasionProfileGuidance}` : '',
      isWeatherFiltered ? "Off-season pieces have been deprioritized or removed; everything shown is weather-optimized." : '',
      `Compose ${requestedLimit} outfits.`,
      rotationWarningsText,
      wholeWardrobeFeedbackText ? `Feedback memory (rejected pairings are settled — do not repeat them):\n${wholeWardrobeFeedbackText}` : '',
      confirmedOutfitsText ? `Confirmed favorite outfits:\n${confirmedOutfitsText}` : '',
      '',
      'Below are photos of every available piece, grouped by category. Reference pieces by exact ID.'
    ].filter(Boolean).join('\n') })

    let shownPieceCount = 0
    const shownPieces = []
    for (const group of grouped.keys()) {
      const pieces = grouped.get(group)
      if (!pieces?.length) continue
      content.push({ type: 'text', text: `=== ${group.toUpperCase()}S ===` })
      for (const p of pieces) {
        const photoFile = p.worn_photo || p.photo || ''
        if (!photoFile) continue
        const filePath = path.join(uploadsDir, photoFile)
        if (!fs.existsSync(filePath)) continue
        const thumb = await prepareWardrobeThumb(filePath, `${p.id}:${photoFile}`, { maxPx: composerThumbPx })
        content.push({ type: 'text', text: `ID ${p.id}: ${p.name}` })
        // Composition depends on texture and construction cues; never hardcode this to low detail.
        content.push({ type: 'image', detail: composerImageDetail, source: { type: 'base64', media_type: thumb.media_type, data: thumb.data } })
        shownPieceCount++
        shownPieces.push(p)
      }
    }
    const timings = { thumbPrepMs: Date.now() - routeStartedAt }

    // Single model call — no tools
    let parsed = {}
    let composerError = null
    let composerUsage = null
    const composerStartedAt = Date.now()
    try {
      const composerResult = await withTimeout(askStylistWithUsage({
        system: WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM,
        maxTokens: 2200,
        messages: [{ role: 'user', content }]
      }), 90000, 'Visual wardrobe composer')
      timings.composerMs = Date.now() - composerStartedAt
      composerUsage = composerResult.usage
      parsed = safeJsonFromModel(composerResult.text)
    } catch (err) {
      composerError = err.message
      timings.composerMs = timings.composerMs || null
    }

    // Resolve and validate — IDs must exist; reuse existing normalize/repair/gate
    const resolved = (Array.isArray(parsed?.outfits) ? parsed.outfits : []).map(outfit => {
      const ids = Array.isArray(outfit.pieceIds) ? outfit.pieceIds.map(Number) : []
      const owned = ids.map(id => allowedPieces.find(p => Number(p.id) === id)).filter(Boolean)
      return { ...outfit, pieceIds: owned.map(p => Number(p.id)), pieces: owned }
    }).filter(o => o.pieces.length >= 2)

    let modelOutfits = resolved.map(o => normalizeWholeWardrobeOutfitObject(o, allowedPieces))
      .filter(o => isOutfitStructurallyValid(o.pieces, { requireShoes: true }))
      .map(outfit => ({
        ...outfit,
        systemSuggestion: comfortFootwearSuggestionForOutfit(outfit, allowedPieces, comfortConstraint, { weatherProfile, occasion, mood, activity })
      }))

    let localBackfillOutfits = []
    let localBackfillCandidateCount = 0
    const buildVisualLocalBackfill = () => {
      if (localBackfillOutfits.length) return localBackfillOutfits
      const candidates = buildWholeWardrobeCandidateOutfits(allowedPieces, {
        occasion,
        season,
        mood,
        activity,
        sessionInfluence,
        candidateLimit: 42,
        candidateBucketLimit: 8
      })
      localBackfillCandidateCount = candidates.length
      localBackfillOutfits = wholeWardrobeOutfitsFromCandidates(candidates, allowedPieces, { occasion, mood, season, weatherProfile, activity, sessionInfluence })
      return localBackfillOutfits
    }

    const rejectionSummary = rejected => (Array.isArray(rejected) ? rejected : []).reduce((counts, item) => {
      const reason = item?.reason || 'unknown'
      counts[reason] = (counts[reason] || 0) + 1
      return counts
    }, {})
    const visualDebugLog = {
      requestedLimit,
      aiReturnedRaw: Array.isArray(parsed?.outfits) ? parsed.outfits.length : 0,
      aiResolvedWithOwnedPieces: resolved.length,
      aiStructurallyValid: modelOutfits.length,
      mode: 'advisor',
      applyDiversity: false
    }

    const gatedModel = locallyGateWholeWardrobeOutfits(
      modelOutfits,
      requestedLimit,
      { mode: 'advisor', requireShoes: true, rejectProfileDiscouraged: true, applyDiversity: false, candidatePieces: allowedPieces, occasion, mood, season, weatherProfile, activity, sessionInfluence }
    )
    let structuredOutfits = gatedModel.outfits.slice(0, requestedLimit)
    let softBackfillCount = 0
    let gatedLocal = { outfits: [], rejected: [] }
    if (structuredOutfits.length < requestedLimit) {
      if (!modelOutfits.length) {
        console.log(`    - Visual Composer AI returned 0 structurally valid outfits. Filling from local candidate generation.`)
      }
      gatedLocal = locallyGateWholeWardrobeOutfits(
        buildVisualLocalBackfill(),
        requestedLimit,
        { mode: 'advisor', requireShoes: true, rejectProfileDiscouraged: true, applyDiversity: false, candidatePieces: allowedPieces, occasion, mood, season, weatherProfile, activity, sessionInfluence }
      )
      const seenKeys = new Set(structuredOutfits.map(outfit => {
        const ids = Array.isArray(outfit.pieceIds) && outfit.pieceIds.length
          ? outfit.pieceIds
          : (Array.isArray(outfit.pieces) ? outfit.pieces.map(piece => piece?.id) : [])
        return ids.map(Number).filter(Boolean).sort((a, b) => a - b).join('|')
      }))
      const fillOutfits = gatedLocal.outfits.filter(outfit => {
        const ids = Array.isArray(outfit.pieceIds) && outfit.pieceIds.length
          ? outfit.pieceIds
          : (Array.isArray(outfit.pieces) ? outfit.pieces.map(piece => piece?.id) : [])
        const key = ids.map(Number).filter(Boolean).sort((a, b) => a - b).join('|')
        if (!key || seenKeys.has(key)) return false
        seenKeys.add(key)
        return true
      })
      softBackfillCount = Math.min(requestedLimit - structuredOutfits.length, fillOutfits.length)
      structuredOutfits = [...structuredOutfits, ...fillOutfits.slice(0, requestedLimit - structuredOutfits.length)]
    }
    visualDebugLog.localBackfillCandidates = localBackfillCandidateCount
    visualDebugLog.localBackfillOutfits = localBackfillOutfits.length
    visualDebugLog.modelGateOutfits = gatedModel.outfits.length
    visualDebugLog.modelGateRejected = gatedModel.rejected.length
    visualDebugLog.modelGateRejectedReasons = rejectionSummary(gatedModel.rejected)
    visualDebugLog.localFillGateOutfits = gatedLocal.outfits.length
    visualDebugLog.localFillGateRejected = gatedLocal.rejected.length
    visualDebugLog.localFillGateRejectedReasons = rejectionSummary(gatedLocal.rejected)
    visualDebugLog.localFillAdded = softBackfillCount
    visualDebugLog.finalBeforeMissionLabels = structuredOutfits.length
    console.log('[Visual Composer Final Selection]', visualDebugLog)

    // Mission labeling stays post-generation:
    structuredOutfits = structuredOutfits.slice(0, requestedLimit).map((outfit, index) => {
      const missionPieces = fullPiecesForMissionCheck(outfit, allowedPieces)
      const qualifiedMission = mission && mission !== 'mix'
        ? (() => {
            const activeMission = OUTFIT_MISSIONS.find(m => m.id === mission)
            const qualifies = activeMission && qualifiesWholeWardrobeMission(missionPieces, mission)
            return {
              missionId: qualifies ? mission : null,
              missionLabel: qualifies ? activeMission.label : null
            }
          })()
        : qualifiedMissionForPieces(missionPieces, { occasion, mood, activity })
      return {
        ...outfit,
        strength: index === 0 ? 'signature' : (index <= 2 ? 'strong' : 'usable'),
        formulaFamily: outfit.formulaFamily || wholeWardrobeFormulaFamily(outfit, allowedPieces, occasion),
        missionId: qualifiedMission.missionId,
        missionLabel: qualifiedMission.missionLabel
      }
    })

    saveWholeWardrobeSession({ occasion, outfits: structuredOutfits })

    const { topCoverage, shoeCoverage } = computeWardrobeCoverage(allowedPieces, occasionProfile, activityProfile)

    let feedback = formatWholeWardrobeOutfitFeedback({
      occasion, season, mood,
      outfits: structuredOutfits,
      skip: parsed.skip || '',
      saveableLearning: parsed.saveableLearning || ''
    })

    const coverageNote = formatCoverageNote(topCoverage, shoeCoverage, { occasion, occasionProfile, activityProfile })
    if (coverageNote) {
      feedback = feedback + '\n\n' + coverageNote
    }

    persistGenerationRun({
      flow: 'whole_wardrobe_visual',
      occasion,
      weather: weatherProfile,
      rosterDebug,
      rosterCount: roster.length
    })

    return {
      feedback,
      structuredOutfits,
      provider: AI_PROVIDER,
      mode: 'generate_wardrobe_outfits_visual',
      pipeline: 'full_wardrobe_visual_composer',
      debug: {
        profileCoverage: {
          tops: topCoverage,
          shoes: shoeCoverage
        },
        shownPieceCount,
        suppressedCount: suppressedPieces.length,
        aiReturnedCount: Array.isArray(parsed?.outfits) ? parsed.outfits.length : 0,
        locallyGeneratedCount: localBackfillOutfits.length,
        finalReturnedCount: structuredOutfits.length,
        advisorFlaggedCount: structuredOutfits.filter(outfit => Array.isArray(outfit.systemFlags) && outfit.systemFlags.length).length,
        localFillAddedCount: softBackfillCount,
        imageDetail: composerImageDetail,
        thumbPx: composerThumbPx,
        composerUsage: composerUsage ? {
          ...composerUsage,
          estimatedCost: estimateAiUsageCost(composerUsage)
        } : null,
        finalSelection: visualDebugLog,
        sessionMemory: {
          recentSessionCount: sessionInfluence.sessionCount || 0,
          piecePenaltyCount: sessionInfluence.pieceRecency?.size || 0,
          formulaPenaltyCount: sessionInfluence.formulaRecency?.size || 0,
          rotationWarningShown: Boolean(rotationWarningsText)
        },
        composerError,
        timings,
        rosterCount: roster.length,
        excludedCounts: rosterDebug.excludedCounts,
        postGatePoolSize: rosterDebug.postGatePoolSize,
        capApplied: rosterDebug.capApplied,
        capCutPieces: rosterDebug.capCutPieces,
        slotCoverage: rosterDebug.slotCoverage,
        excluded,
        modelPickedSuppressedCount: (() => {
          const allowedPieceIdsSet = new Set(allowedPieces.map(p => Number(p.id)))
          let count = 0
          for (const outfit of structuredOutfits) {
            if (outfit.pieceIds) {
              for (const id of outfit.pieceIds) {
                if (!allowedPieceIdsSet.has(Number(id))) {
                  count++
                }
              }
            }
          }
          return count
        })()
      }
    }
}

router.post('/generate-wardrobe-outfits-visual', async (req, res) => {
  try {
    const result = await generateWholeWardrobeOutfitsVisualInternal(req.body || {})
    res.json(result)
  } catch (err) {
    console.error('Visual wardrobe composer error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── AI Visual Rendering & Boards ──────────────────────────────────────────────
router.post('/generate-outfit-boards', async (req, res) => {
  const { pieceId, conceptsText = '', structuredOutfits = null, occasion = 'casual', season = 'current season' } = req.body
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })

    const selectedPiece = parsePiece(piece)
    const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
    const rankedCandidates = selectCandidatesForOutfitGeneration(selectedPiece, allPieces, 48, { occasion, season })
    const candidatePieces = [selectedPiece, ...rankedCandidates.map(r => r.piece)]
    const allowedIds = new Set(candidatePieces.map(p => Number(p.id)))
    const pieceById = new Map(candidatePieces.map(p => [Number(p.id), p]))

    let boardPlans = boardPlanFromStructuredOutfits(structuredOutfits, selectedPiece, candidatePieces)

    if (!boardPlans.length && conceptsText) {
      boardPlans = structuredOutfitsFromGeneratedText(conceptsText, selectedPiece, candidatePieces)
    }

    if (!boardPlans.length) {
      const candidateText = candidatePieces.map(p => `${p.id}: ${p.name} (${p.category}) — ${buildPieceText(p)}`).join('\n')
      const rawPlan = await askStylist({
        system: OUTFIT_BOARD_PLANNER_SYSTEM,
        maxTokens: 1000,
        messages: [{ role: 'user', content: [{ type: 'text', text: [
          `Selected garment id: ${selectedPiece.id}`,
          `Selected garment: ${selectedPiece.name} (${selectedPiece.category})`,
          `Occasion: ${occasion}`,
          `Season: ${season}`,
          '',
          conceptsText ? `Text outfit ideas to translate into boards:\n${conceptsText}` : 'No prior concept text was provided. Create useful boards from the candidates.',
          '',
          `Candidate saved wardrobe pieces. Use ONLY these ids:\n${candidateText}`,
          '',
          `Return 2-3 boards if possible. Every board must include selected id ${selectedPiece.id}.`
        ].join('\n') }] }]
      })
      const parsed = safeJsonFromModel(rawPlan)
      boardPlans = parsed.boards || []
    }

    const boards = []
    for (const [idx, board] of boardPlans.slice(0, 3).entries()) {
      const ids = Array.isArray(board.pieceIds) ? board.pieceIds.map(Number).filter(id => allowedIds.has(id)) : []
      if (!ids.includes(Number(selectedPiece.id))) ids.unshift(Number(selectedPiece.id))
      const uniqueIds = [...new Set(ids)].slice(0, 5)
      const ownedBoardPieces = uniqueIds.map(id => pieceById.get(id)).filter(Boolean)
      const rawMissingPieces = Array.isArray(board.missingPieces) ? board.missingPieces : []
      const cleanMissingPieces = dedupeMissingAgainstOwned(rawMissingPieces, ownedBoardPieces)
      const boardPieces = dedupeBoardPiecesForRender([
        ...ownedBoardPieces,
        ...cleanMissingPieces.map(p => ({ ...p, missing: true, photo: null, worn_photo: null }))
      ]).slice(0, 5)
      if (boardPieces.length < 2) continue
      const imageUrl = await createOutfitBoardImage({ board, pieces: boardPieces, index: idx + 1 })
      boards.push({
        label: board.label || `Outfit board ${idx + 1}`,
        reason: board.reason || '',
        watchFor: board.watchFor || '',
        pieces: boardPieces.map(p => ({ id: p.id, name: p.name, category: p.category, missing: !!p.missing })),
        imageUrl
      })
    }

    if (!boards.length) throw new Error('No usable boards were generated from structured outfit ids')
    res.json({ boards, provider: AI_PROVIDER, mode: 'generate_outfit_boards' })
  } catch (err) {
    console.error('Generate outfit boards error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/generate-wardrobe-outfit-image', async (req, res) => {
  const { outfit = {}, pieceIds = [], occasion = 'casual', season = 'current season' } = req.body || {}
  try {
    const ids = [...new Set((Array.isArray(pieceIds) && pieceIds.length ? pieceIds : outfit.pieceIds || [])
      .map(Number)
      .filter(Boolean))]
      .slice(0, 6)
    if (!ids.length) return res.status(400).json({ error: 'pieceIds are required' })

    const rows = db.prepare(`SELECT * FROM pieces WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(parsePiece)
    const byId = new Map(rows.map(piece => [Number(piece.id), piece]))
    const pieces = ids.map(id => byId.get(id)).filter(Boolean)
    if (pieces.length < 2) return res.status(400).json({ error: 'At least two saved wardrobe pieces are required' })

    const rendered = await createWholeWardrobeOutfitImage({ outfit, pieces, occasion, season, index: 1 })
    const board = {
      label: outfit.label || 'Whole wardrobe generated outfit',
      reason: outfit.reason || '',
      watchFor: outfit.watchFor || '',
      pieces: pieces.map(p => ({ id: p.id, name: p.name, category: wardrobeCategoryGroup(p), photo: p.photo || null, worn_photo: p.worn_photo || null })),
      imageUrl: rendered.imageUrl,
      debug: { timings: rendered.timings, renderer: rendered.renderer },
      wholeWardrobe: true
    }
    res.json({ ...board, board, provider: AI_PROVIDER, mode: 'generate_wardrobe_outfit_image', debug: board.debug })
  } catch (err) {
    console.error('Generate whole-wardrobe outfit image error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/generate-wardrobe-outfit-comparison-sheet', async (req, res) => {
  const { outfits = [], occasion = 'casual', season = 'current season', mood = '' } = req.body || {}
  try {
    const shown = Array.isArray(outfits) ? outfits.slice(0, 5) : []
    const ids = [...new Set(shown.flatMap(outfit => {
      if (Array.isArray(outfit?.pieceIds) && outfit.pieceIds.length) return outfit.pieceIds
      if (Array.isArray(outfit?.pieces)) return outfit.pieces.map(piece => piece?.id)
      return []
    }).map(Number).filter(Boolean))].slice(0, 30)
    if (shown.length < 2) return res.status(400).json({ error: 'At least two outfits are required' })
    if (!ids.length) return res.status(400).json({ error: 'pieceIds are required' })

    const rows = db.prepare(`SELECT * FROM pieces WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(parsePiece)
    const piecesById = new Map(rows.map(piece => [Number(piece.id), piece]))
    const normalizedOutfits = shown.map((outfit, index) => {
      const outfitIds = (Array.isArray(outfit?.pieceIds) && outfit.pieceIds.length
        ? outfit.pieceIds
        : (Array.isArray(outfit?.pieces) ? outfit.pieces.map(piece => piece?.id) : []))
        .map(Number)
        .filter(id => piecesById.has(id))
      return {
        ...outfit,
        label: outfit?.label || outfit?.title || `Outfit ${index + 1}`,
        pieceIds: [...new Set(outfitIds)].slice(0, 6)
      }
    }).filter(outfit => outfit.pieceIds.length >= 2)

    if (normalizedOutfits.length < 2) return res.status(400).json({ error: 'At least two complete outfits with saved pieces are required' })

    const rendered = await createWholeWardrobeComparisonSheetImage({ outfits: normalizedOutfits, piecesById, occasion, season, mood })
    const board = {
      label: 'Whole-wardrobe comparison sheet',
      reason: `Preview sheet for ${normalizedOutfits.length} outfit ideas. Use individual Generate outfit image buttons for final renders.`,
      pieces: rows.map(p => ({ id: p.id, name: p.name, category: wardrobeCategoryGroup(p), photo: p.photo || null, worn_photo: p.worn_photo || null })),
      imageUrl: rendered.imageUrl,
      debug: { timings: rendered.timings, renderer: rendered.renderer },
      wholeWardrobe: true,
      previewOnly: true
    }
    res.json({ ...board, board, provider: AI_PROVIDER, mode: 'generate_wardrobe_outfit_comparison_sheet', debug: board.debug })
  } catch (err) {
    console.error('Generate whole-wardrobe comparison sheet error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/generate-ideal-additions-preview-sheet', async (req, res) => {
  const { pieceId, directions = [], occasion = 'casual', season = 'current season' } = req.body || {}
  try {
    if (!pieceId) return res.status(400).json({ error: 'pieceId is required' })
    if (!Array.isArray(directions) || directions.length === 0) {
      return res.status(400).json({ error: 'directions array is required and must not be empty' })
    }

    const row = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
    if (!row) return res.status(404).json({ error: 'Selected piece not found' })
    const selectedPiece = parsePiece(row)

    const rendered = await createIdealAdditionsComparisonSheetImage({
      selectedPiece,
      directions,
      occasion,
      season
    })

    const board = {
      label: 'Ideal additions comparison sheet',
      reason: `Preview sheet for ${directions.length} directions. Use individual Generate outfit image buttons for final renders.`,
      pieces: [
        {
          id: selectedPiece.id,
          name: selectedPiece.name,
          category: wardrobeCategoryGroup(selectedPiece),
          photo: selectedPiece.photo || null,
          worn_photo: selectedPiece.worn_photo || null
        }
      ],
      imageUrl: rendered.imageUrl,
      debug: { timings: rendered.timings, renderer: rendered.renderer },
      previewOnly: true
    }

    res.json({
      ...board,
      board,
      provider: AI_PROVIDER,
      mode: 'generate_ideal_additions_preview_sheet',
      debug: board.debug
    })
  } catch (err) {
    console.error('Generate ideal additions comparison sheet error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/generate-saved-outfit-image', async (req, res) => {
  const { outfit = {}, pieceIds = [], occasion = 'casual', season = 'current season', variantMode = 'similar' } = req.body || {}
  try {
    const mode = variantMode === 'creative' ? 'creative' : 'similar'
    let ids = [...new Set((Array.isArray(pieceIds) && pieceIds.length ? pieceIds : outfit.pieceIds || [])
      .map(Number)
      .filter(Boolean))]
      .slice(0, 6)
    let pieces = []
    if (ids.length) {
      const rows = db.prepare(`SELECT * FROM pieces WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(parsePiece)
      const byId = new Map(rows.map(piece => [Number(piece.id), piece]))
      pieces = ids.map(id => byId.get(id)).filter(Boolean)
    } else if (outfit.id) {
      pieces = getLinkedPiecesForOutfit(outfit.id).slice(0, 6)
      ids = pieces.map(piece => Number(piece.id)).filter(Boolean)
    }
    if (!ids.length) return res.status(400).json({ error: 'No linked wardrobe pieces were found for this outfit' })

    if (pieces.length < 2) return res.status(400).json({ error: 'At least two linked wardrobe pieces are required' })

    const rendered = await createSavedOutfitImage({ outfit, pieces, occasion, season, index: 1, variantMode: mode })
    const boards = [{
      label: mode === 'creative' ? 'Creative outfit alternatives' : 'Similar outfit variants',
      reason: mode === 'creative'
        ? 'One GPT-4o call generated three exploratory outfit alternatives from the saved outfit photo and linked garment references.'
        : 'One GPT-4o call generated three adjacent outfit variants from the saved outfit photo and linked garment references.',
      watchFor: mode === 'creative'
        ? 'The alternatives should explore different formulas without turning into random novelty.'
        : 'The variants should feel like the same person on a different day, not tiny styling tweaks.',
      pieces: pieces.map(p => ({ id: p.id, name: p.name, category: wardrobeCategoryGroup(p), photo: p.photo || null, worn_photo: p.worn_photo || null })),
      imageUrl: rendered.imageUrl,
      debug: { timings: rendered.timings, renderer: rendered.renderer },
      savedOutfit: true,
      variant: true,
      variantMode: mode
    }]
    res.json({
      boards,
      feedback: mode === 'creative'
        ? 'Generated three creative outfit alternatives in one image from the saved outfit photo and linked garment references.'
        : 'Generated three similar outfit variants in one image from the saved outfit photo and linked garment references.',
      provider: 'openai',
      mode: mode === 'creative' ? 'generate_saved_outfit_creative_alternatives' : 'generate_saved_outfit_similar_variants',
      debug: { variantCount: 3, requestCount: 1, variantMode: mode }
    })
  } catch (err) {
    console.error('Generate saved outfit image error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── AI Outfit Evaluation ──────────────────────────────────────────────────────
router.post('/evaluate-wardrobe-outfit', async (req, res) => {
  const { outfit = {}, pieceIds = [], occasion = 'casual', season = 'current season', mood = '', question = '', previousEvaluation = '', responseMode = 'full', history = [] } = req.body || {}

  try {
    let resolvedOutfit = outfit
    let resolvedPieceIds = pieceIds
    let savedExtraContext = ''
    const savedOutfitId = Number(outfit?.id || 0)
    if (savedOutfitId) {
      const savedOutfit = db.prepare('SELECT * FROM outfits WHERE id = ?').get(savedOutfitId)
      if (savedOutfit) {
        const { linkedPieces, extraContextText } = buildSavedOutfitEvaluationContext(savedOutfit)
        resolvedOutfit = {
          ...savedOutfit,
          ...outfit,
          id: savedOutfit.id,
          name: outfit.name || outfit.title || outfit.label || savedOutfit.name,
          title: outfit.title || outfit.label || outfit.name || savedOutfit.name,
          label: outfit.label || outfit.title || outfit.name || savedOutfit.name,
          photo: outfit.photo || savedOutfit.photo,
          occasion: outfit.occasion || savedOutfit.occasion,
          season: outfit.season || savedOutfit.season,
          notes: outfit.notes || savedOutfit.notes,
        }
        if (!Array.isArray(resolvedPieceIds) || !resolvedPieceIds.length) {
          resolvedPieceIds = linkedPieces.map(piece => piece.id)
        }
        savedExtraContext = extraContextText
      }
    }
    const result = await evaluateOutfitThroughSharedPipeline({
      outfit: resolvedOutfit,
      pieceIds: resolvedPieceIds,
      occasion,
      season,
      mood,
      question,
      previousEvaluation,
      responseMode,
      history,
      routeMode: 'evaluate_wardrobe_outfit',
      extraContextText: savedExtraContext
    })
    res.json(result)
  } catch (err) {
    console.error('Evaluate wardrobe outfit error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/outfit-feedback', upload.single('photo'), async (req, res) => {
  const tempPath = req.file ? path.join(uploadsDir, req.file.filename) : ''
  try {
    const { question, outfitName, outfitNotes } = req.body
    const activeWardrobeText = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece).map(buildPieceText).join('\n')
    const confirmedOutfitsText = getConfirmedOutfitMemory()

    const result = await evaluateOutfitThroughSharedPipeline({
      outfit: { label: outfitName || 'Uploaded outfit photo', notes: outfitNotes || '' },
      question: question || 'What do you think of this outfit? Does it work well together?',
      routeMode: 'evaluate_uploaded_outfit_photo',
      uploadedPhotoPath: tempPath,
      allowPhotoOnly: true,
      extraContextText: [
        outfitName ? `Outfit: "${outfitName}"` : '',
        outfitNotes ? `User notes / corrected truth: ${outfitNotes}` : '',
        confirmedOutfitsText ? `Confirmed outfit memory:\n${confirmedOutfitsText}` : '',
        activeWardrobeText ? `Active wardrobe truth, for identifying likely saved garments and avoiding wrong guesses:\n${activeWardrobeText}` : ''
      ].filter(Boolean).join('\n\n')
    })
    res.json(result)
  } catch (err) {
    console.error('AI error:', err)
    res.status(err.statusCode || 500).json({ error: err.message })
  } finally {
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
  }
})

// ── AI Editorial / Identity Edits ─────────────────────────────────────────────
router.post('/editorial-directions-preview', async (req, res) => {
  const { pieceId, occasion = 'casual', season = 'current season', mission = 'mix', mood = '', question, history, seedLook } = req.body
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })
    const selectedPiece = parsePiece(piece)
    const ownedRows = db.prepare('SELECT * FROM pieces ORDER BY id DESC LIMIT 500').all().map(parsePiece)
    const anchorConstraint = idealAdditionAnchorConstraint(selectedPiece)

    const content = []
    const photoFile = piece.worn_photo || piece.photo
    if (photoFile) {
      const filePath = path.join(uploadsDir, photoFile)
      if (fs.existsSync(filePath)) {
        const { base64, mime } = await prepareImageForClaude(filePath)
        content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
      }
    }
    const calibrationSummary = getCalibrationReferenceSummary()
    const seedBoard = seedLook?.board || null
    const seedOutfit = seedLook?.outfit || null
    const seedImageUrl = typeof seedBoard?.imageUrl === 'string' ? seedBoard.imageUrl : ''
    if (seedImageUrl.startsWith('/uploads/')) {
      const seedFilePath = path.join(uploadsDir, path.basename(seedImageUrl))
      if (fs.existsSync(seedFilePath)) {
        const { base64, mime } = await prepareImageForClaude(seedFilePath)
        content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
      }
    }
    const seedPieces = Array.isArray(seedBoard?.pieces) ? seedBoard.pieces : (Array.isArray(seedOutfit?.pieces) ? seedOutfit.pieces : [])
    const seedMissingPieces = Array.isArray(seedBoard?.missingPieces) ? seedBoard.missingPieces : (Array.isArray(seedOutfit?.missingPieces) ? seedOutfit.missingPieces : [])
    const seedLookSummary = seedLook ? [
      'Rendered wardrobe look to use as a taste seed:',
      `Board title: ${seedBoard?.label || seedBoard?.title || seedOutfit?.label || seedOutfit?.title || 'Wardrobe look'}`,
      seedBoard?.reason || seedOutfit?.reason ? `Why it worked: ${seedBoard?.reason || seedOutfit?.reason}` : '',
      seedOutfit?.silhouette ? `Silhouette: ${seedOutfit.silhouette}` : '',
      seedOutfit?.dominantDirection ? `Direction: ${seedOutfit.dominantDirection}` : '',
      seedPieces.length ? `Owned pieces in the seed look: ${seedPieces.map(p => p?.name || p).filter(Boolean).join(' + ')}` : '',
      seedMissingPieces.length ? `Existing missing-piece notes: ${seedMissingPieces.map(p => p?.name || p).filter(Boolean).join(' + ')}` : '',
      'Use this look as the visual and styling DNA. Suggest ideal new additions that elevate or sharpen it beyond the saved wardrobe board, while keeping the selected garment central.'
    ].filter(Boolean).join('\n') : ''
    content.push({ type: 'text', text: [
      `Selected garment truth:\n${buildPieceText(selectedPiece)}`,
      `Anchor constraint:\n${anchorConstraint}`,
      `Occasion: ${occasion}`,
      `Season: ${season}`,
      mission && mission !== 'mix' ? `Mission: ${mission}` : '',
      mood ? `Mood: ${mood}` : '',
      `User request: ${question || 'Suggest ideal new pieces for this item.'}`,
      seedLookSummary,
      calibrationSummary ? `Renderer calibration library:\n${calibrationSummary}` : '',
      '',
      'Generate only conceptual missing-piece additions. Do not use saved wardrobe pairings except for the selected garment. MissingPieces must not include anything that replaces the selected anchor or duplicates its wardrobe role. If the wardrobe already has jeans, olive cargo/utility pants, or similar basics, do not present those as new pieces; suggest more specific/different archetypes.'
    ].filter(Boolean).join('\n') })

    const raw = await askStylist({
      system: EDITORIAL_NEW_PIECES_SYSTEM,
      maxTokens: 1200,
      messages: [
        ...(history || []).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content }
      ]
    })

    let parsed = safeJsonFromModel(raw)
    let directions = Array.isArray(parsed?.directions) ? parsed.directions : []
    if (!directions.length) {
      directions = buildIdealOnlyCompletionsForPiece(selectedPiece).map(o => ({
        title: o.label || 'Ideal direction',
        missingPieces: (o.missingPieces || []).map(p => p.name),
        reason: o.reason || '',
        watchFor: o.watchFor || '',
        visualPrompt: o.reason || ''
      }))
    }
    directions = dedupeAndDifferentiateEditorialDirections(directions, selectedPiece, ownedRows)

    res.json({
      directions: directions.slice(0, 3).map(d => ({
        title: d.title || 'Ideal direction',
        missingPieces: Array.isArray(d.missingPieces) ? d.missingPieces : [],
        reason: d.reason || '',
        watchFor: d.watchFor || '',
        visualPrompt: d.visualPrompt || '',
      })),
      pieceId,
      occasion,
      season,
      provider: AI_PROVIDER,
      mode: 'editorial_directions_preview'
    })
  } catch (err) {
    console.error('Editorial directions preview error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/editorial-render-one', async (req, res) => {
  const { pieceId, direction, occasion = 'casual', season = 'current season' } = req.body
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })
    const selectedPiece = parsePiece(piece)

    const rendered = await createEditorialConceptImage({
      selectedPiece,
      direction,
      index: 1,
      occasion,
      season
    })

    res.json({
      imageUrl: rendered.imageUrl,
      label: direction.title || 'Rendered direction',
      missingPieces: direction.missingPieces || [],
      reason: direction.reason || '',
      watchFor: direction.watchFor || '',
      mode: 'editorial_render_one',
      debug: {
        timings: rendered.timings,
        renderer: rendered.renderer
      }
    })
  } catch (err) {
    console.error('Editorial render-one error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/editorial-new-piece-visuals', async (req, res) => {
  const { pieceId, occasion = 'casual', season = 'current season', question, history } = req.body
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })
    const selectedPiece = parsePiece(piece)
    const ownedRows = db.prepare('SELECT * FROM pieces ORDER BY id DESC LIMIT 500').all().map(parsePiece)

    const content = []
    const photoFile = piece.worn_photo || piece.photo
    if (photoFile) {
      const filePath = path.join(uploadsDir, photoFile)
      if (fs.existsSync(filePath)) {
        const { base64, mime } = await prepareImageForClaude(filePath)
        content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
      }
    }
    const calibrationSummary = getCalibrationReferenceSummary()
    content.push({ type: 'text', text: [
      `Selected garment truth:\n\th${buildPieceText(selectedPiece)}`,
      `Occasion: ${occasion}`,
      `Season: ${season}`,
      `User request: ${question || 'Suggest ideal new pieces for this item.'}`,
      calibrationSummary ? `Renderer calibration library:\n${calibrationSummary}` : '',
      '',
      'Generate only conceptual missing-piece additions. Do not use saved wardrobe pairings except for the selected garment. If the wardrobe already has jeans, olive cargo/utility pants, or similar basics, do not present those as new pieces; suggest more specific/different archetypes.'
    ].filter(Boolean).join('\n') })

    const raw = await askStylist({
      system: EDITORIAL_NEW_PIECES_SYSTEM,
      maxTokens: 1200,
      messages: [
        ...(history || []).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content }
      ]
    })

    let parsed = safeJsonFromModel(raw)
    let directions = Array.isArray(parsed?.directions) ? parsed.directions : []
    if (!directions.length) {
      directions = buildIdealOnlyCompletionsForPiece(selectedPiece).map(o => ({
        title: o.label || 'Ideal direction',
        missingPieces: (o.missingPieces || []).map(p => p.name),
        reason: o.reason || '',
        watchFor: o.watchFor || '',
        visualPrompt: o.reason || ''
      }))
    }
    directions = dedupeAndDifferentiateEditorialDirections(directions, selectedPiece, ownedRows)

    const visuals = []
    for (const [idx, direction] of directions.slice(0, 3).entries()) {
      const rendered = await createEditorialConceptImage({ selectedPiece, direction, index: idx + 1, occasion, season })
      visuals.push({
        label: direction.title || `Ideal direction ${idx + 1}`,
        reason: direction.reason || '',
        watchFor: direction.watchFor || '',
        missingPieces: Array.isArray(direction.missingPieces) ? direction.missingPieces : [],
        imageUrl: rendered.imageUrl,
        debug: {
          timings: rendered.timings,
          renderer: rendered.renderer
        },
        mode: 'editorial_new_piece_visual'
      })
    }
    res.json({ visuals, provider: AI_PROVIDER, mode: 'editorial_new_piece_visuals' })
  } catch (err) {
    console.error('Editorial new-piece visuals error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/identity-edit-visuals', async (req, res) => {
  const { pieceId, occasion = 'casual', season = 'current season', question, history } = req.body
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })

    const sourceInfo = chooseIdentityEditSource(piece)
    if (!sourceInfo?.path) {
      return res.status(400).json({ error: 'Identity-preserving edits need either a selected garment worn photo, a Calibration Library real photo/good reference, or a garment photo.' })
    }
    const sourcePath = sourceInfo.path

    const selectedPiece = parsePiece(piece)
    const content = []
    const { base64, mime } = await prepareImageForClaude(sourcePath)
    content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
    content.push({ type: 'text', text: [
      `Selected garment truth:\n${buildPieceText(selectedPiece)}`,
      `Occasion: ${occasion}`,
      `Season: ${season}`,
      `User request: ${question || 'Create identity-preserving styling edits for this selected item.'}`,
      '',
      'Generate exactly three styling directions for editing the provided real photo. Do not make wardrobe pairings. Each direction should suggest conceptual additions only. Keep the selected garment as the anchor. The edit must preserve the real person/photo geometry; choose additions that can be shown without changing body proportions, posture, age read, or garment fit. Prioritize visual composition over pleasant harmony: at least one dark grounded column, one structured/earthy tension option, and one controlled contrast option. Avoid scarves/cardigans as default maturity signals, soft cream/taupe sludge, polite slip-ons, and generic mature-casual elegance.'
    ].join('\n') })

    let directions = []
    try {
      const raw = await askStylist({
        system: EDITORIAL_NEW_PIECES_SYSTEM,
        maxTokens: 1300,
        messages: [
          ...(history || []).map(h => ({ role: h.role, content: h.content })),
          { role: 'user', content }
        ]
      })
      const parsed = safeJsonFromModel(raw)
      directions = normalizeEditorialDirections(parsed?.directions || [])
    } catch (err) {
      console.error('Identity edit direction model failed:', err.message)
    }

    if (!directions.length) directions = buildIdealOnlyCompletionsForPiece(selectedPiece).slice(0, 3)
    if (!directions.length) directions = defaultCalibrationVariations(selectedPiece)
    directions = directions.slice(0, 3).map((d, idx) => ({
      title: d.title || ['Identity-preserving edit A', 'Identity-preserving edit B', 'Identity-preserving edit C'][idx],
      missingPieces: Array.isArray(d.missingPieces) ? d.missingPieces.map(p => p.name || p).filter(Boolean) : [],
      reason: d.reason || '',
      watchFor: d.watchFor || '',
      visualPrompt: d.visualPrompt || d.reason || ''
    }))

    const visuals = []
    for (const [idx, direction] of directions.entries()) {
      const imageUrl = await createIdentityPreservingEditImage({ sourcePath, sourceLabel: sourceInfo.label, selectedPiece, direction, index: idx + 1, occasion, season })
      visuals.push({
        label: direction.title || `Identity edit ${idx + 1}`,
        reason: direction.reason || '',
        watchFor: direction.watchFor || '',
        missingPieces: direction.missingPieces || [],
        imageUrl,
        mode: 'identity_edit',
        calibration: {
          rendererVersion: 'v36',
          source: 'real_photo_edit',
          identityPreserving: true
        }
      })
    }

    res.json({ visuals, provider: AI_PROVIDER, mode: 'identity_edit' })
  } catch (err) {
    console.error('Identity edit visuals error:', err)
    res.status(500).json({ error: err.message })
  }
})

// Helper for default calibration variations
function defaultCalibrationVariations(selectedPiece) {
  const base = buildIdealOnlyCompletionsForPiece(selectedPiece)
  const source = base.length ? base : [{ missingPieces: [], reason: '' }]
  return ['A', 'B', 'C'].map((letter, idx) => {
    const fallback = source[idx % source.length]
    const missingPieces = (fallback.missingPieces || []).map(p => p.name || p).filter(Boolean)
    return {
      variation: letter,
      title: letter === 'A' ? 'Softer restrained' : letter === 'B' ? 'Balanced artistic modern' : 'Sharper architectural',
      silhouetteLabel: letter === 'A' ? 'soft structure / medium grounding' : letter === 'B' ? 'grounded edited baseline' : 'architectural / stronger anchor',
      missingPieces: missingPieces.length ? missingPieces : ['specific grounded support piece', 'specific stabilizing shoe'],
      reason: letter === 'A'
        ? 'Tests whether a softer version can stay intentional without drifting passive.'
        : letter === 'B'
          ? 'Tests the most balanced grounded artistic direction.'
          : 'Tests a sharper architectural version with stronger lower-half weight.',
      watchFor: letter === 'A' ? 'Too soft or mature-catalog drift.' : letter === 'B' ? 'Too generic if the pieces become basic.' : 'Too severe or over-styled.',
      visualPrompt: fallback.reason || ''
    }
  })
}

router.post('/generate-calibration-boards', async (req, res) => {
  const { pieceId, occasion = 'casual', season = 'current season', question, history } = req.body
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })
    const selectedPiece = parsePiece(piece)

    const content = []
    const photoFile = piece.worn_photo || piece.photo
    if (photoFile) {
      const filePath = path.join(uploadsDir, photoFile)
      if (fs.existsSync(filePath)) {
        const { base64, mime } = await prepareImageForClaude(filePath)
        content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
      }
    }
    content.push({ type: 'text', text: [
      `Selected garment truth:\n${buildPieceText(selectedPiece)}`,
      `Occasion: ${occasion}`,
      `Season: ${season}`,
      `User request: ${question || 'Generate renderer calibration variations.'}`,
      '',
      'Generate exactly three controlled renderer variations: A softer restrained, B balanced artistic modern, C sharper architectural. Use conceptual supporting pieces, not saved wardrobe pairings. Preserve the selected garment as visual truth.'
    ].join('\n') })

    let variations = []
    try {
      const raw = await askStylist({
        system: RENDERER_CALIBRATION_SYSTEM,
        maxTokens: 1200,
        messages: [
          ...(history || []).map(h => ({ role: h.role, content: h.content })),
          { role: 'user', content }
        ]
      })
      const parsed = safeJsonFromModel(raw)
      variations = Array.isArray(parsed?.variations) ? parsed.variations : []
    } catch (err) {
      console.error('Calibration variation model failed:', err.message)
    }

    if (!variations.length) variations = defaultCalibrationVariations(selectedPiece)
    variations = variations.slice(0, 3).map((v, idx) => ({
      variation: v.variation || ['A', 'B', 'C'][idx],
      title: v.title || ['Softer restrained', 'Balanced artistic modern', 'Sharper architectural'][idx],
      silhouetteLabel: v.silhouetteLabel || '',
      missingPieces: Array.isArray(v.missingPieces) ? v.missingPieces : [],
      reason: v.reason || '',
      watchFor: v.watchFor || '',
      visualPrompt: v.visualPrompt || ''
    }))

    const visuals = []
    for (const [idx, variation] of variations.entries()) {
      const rendered = await createCalibrationConceptImage({ selectedPiece, variation, index: idx + 1, occasion, season })
      visuals.push({
        label: `${variation.variation || String.fromCharCode(65 + idx)} · ${variation.title || 'Calibration variation'}`,
        variation: variation.variation || String.fromCharCode(65 + idx),
        silhouetteLabel: variation.silhouetteLabel || '',
        reason: variation.reason || '',
        watchFor: variation.watchFor || '',
        missingPieces: variation.missingPieces || [],
        imageUrl: rendered.imageUrl,
        debug: {
          timings: rendered.timings,
          renderer: rendered.renderer
        },
        mode: 'renderer_calibration',
        calibration: {
          variationType: variation.title || '',
          silhouetteLabel: variation.silhouetteLabel || '',
          rendererVersion: 'v32'
        }
      })
    }
    res.json({ visuals, provider: AI_PROVIDER, mode: 'renderer_calibration' })
  } catch (err) {
    console.error('Calibration boards error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── AI Outfit Comparison & Conversational Ask ────────────────────────────────
router.post('/compare-outfits', async (req, res) => {
  const { outfitAId, outfitBId, question, history } = req.body
  const outfitA = db.prepare('SELECT * FROM outfits WHERE id = ?').get(outfitAId)
  const outfitB = db.prepare('SELECT * FROM outfits WHERE id = ?').get(outfitBId)
  if (!outfitA || !outfitB) return res.status(404).json({ error: 'One or both outfits were not found' })

  try {
    const content = []

    const addOutfitImage = async (label, outfit) => {
      if (!outfit.photo) return
      const filePath = path.join(uploadsDir, outfit.photo)
      if (!fs.existsSync(filePath)) return
      const { base64, mime } = await prepareImageForClaude(filePath)
      content.push({ type: 'text', text: `${label} image:` })
      content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
    }

    await addOutfitImage('Outfit A', outfitA)
    await addOutfitImage('Outfit B', outfitB)

    const linkedA = getLinkedPiecesForOutfit(outfitA.id)
    const linkedB = getLinkedPiecesForOutfit(outfitB.id)
    const likelyA = linkedA.length ? [] : findLikelyPiecesForOutfit(outfitA)
    const likelyB = linkedB.length ? [] : findLikelyPiecesForOutfit(outfitB)
    const confirmedOutfitsText = getConfirmedOutfitMemory()

    content.push({ type: 'text', text: [
      `Mode: compare_outfits`,
      `Question: ${question || 'Which outfit works better for Yuna?'}`,
      '',
      `Outfit A context:`,
      buildOutfitAuthorityNote(outfitA, linkedA, likelyA),
      buildOutfitText(outfitA, linkedA),
      likelyA.length ? `Likely saved garment truth for Outfit A — hints only unless linked:\n${likelyA.map(buildPieceText).join('\n')}` : '',
      '',
      `Outfit B context:`,
      buildOutfitAuthorityNote(outfitB, linkedB, likelyB),
      buildOutfitText(outfitB, linkedB),
      likelyB.length ? `Likely saved garment truth for Outfit B — hints only unless linked:\n${likelyB.map(buildPieceText).join('\n')}` : '',
      '',
      confirmedOutfitsText ? `Other confirmed outfit memory for Yuna's taste filter:\n${confirmedOutfitsText}` : '',
      '',
      `Comparison instruction: make a call if one outfit is clearly stronger. If both work, explain the different use cases. If neither works, identify the shared issue. Do not give a vague "both are nice" answer.`
    ].filter(Boolean).join('\n') })

    const answer = await askStylist({
      system: COMPARE_OUTFITS_SYSTEM,
      maxTokens: 1400,
      messages: [
        ...(history || []).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content }
      ]
    })

    res.json({ feedback: answer, provider: AI_PROVIDER, mode: 'compare_outfits' })
  } catch (err) {
    console.error('Compare outfits error:', err)
    res.status(500).json({ error: err.message })
  }
})
router.post('/ask', async (req, res) => {
  try {
    const extractedWeather = req.body.weather || extractWeatherContext([
      req.body.question || '',
      req.body.threadContext || '',
      req.body.generatedContext || ''
    ].join('\n'))
    const precomposed = await maybePrecomposeStructuredOutfitsForAsk(req.body, extractedWeather)
    const followupPrecomposed = precomposed ? null : await maybePrecomposeStructuredFollowupForAsk(req.body, extractedWeather)
    const activePrecompose = precomposed || followupPrecomposed
    const generatedOutfitsForTurn = activePrecompose?.structuredOutfits || []
    const generatedContextForTurn = [
      activePrecompose?.contextText || '',
      req.body.generatedContext || ''
    ].filter(Boolean).join('\n\n')
    const toolContext = {
      generatedOutfits: generatedOutfitsForTurn,
      source: activePrecompose ? 'whole_wardrobe' : 'whole_wardrobe',
      occasion: activePrecompose?.occasion || req.body.occasion || 'casual',
      season: activePrecompose?.season || req.body.season || 'current season',
      weather: extractedWeather,
      mood: req.body.mood || '',
      mission: req.body.mission || 'mix',
      activity: activePrecompose?.activity || req.body.activity || '',
      question: req.body.question || ''
    }
    const payload = await buildStylistConversationPayload({
      ...req.body,
      generatedContext: generatedContextForTurn,
      generatedOutfits: generatedOutfitsForTurn.length ? generatedOutfitsForTurn : req.body.generatedOutfits,
      occasion: activePrecompose?.occasion || req.body.occasion,
      season: activePrecompose?.season || req.body.season,
      activity: activePrecompose?.activity || req.body.activity
    })
    const { answer, savedCorrections } = await askStylistWithTools({
      ...payload,
      toolContext
    })
    const allSaved = [...(savedCorrections || [])]
    if (payload.automaticallySavedCorrection) {
      allSaved.push(payload.automaticallySavedCorrection)
    }
    res.json({
      answer,
      savedCorrections: allSaved,
      provider: AI_PROVIDER,
      structuredOutfits: toolContext.generatedOutfits,
      structuredOutfitsSource: toolContext.source,
      structuredOutfitsOccasion: toolContext.occasion,
      structuredOutfitsSeason: toolContext.season,
      structuredOutfitsMood: toolContext.mood,
      structuredOutfitsMission: toolContext.mission,
      structuredOutfitsActivity: toolContext.activity,
      structuredOutfitsDebug: activePrecompose?.debug || null
    })
  } catch (err) {
    console.error('AI error:', err)
    res.status(500).json({ error: err.message })
  }
})

export default router
