import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import OpenAI, { toFile } from 'openai'
import { db, userUploadsDir, safeJsonParse, parsePiece } from '../db.js'
import { applyTaggerResult, buildAnchorBlock, normalizeConfidenceMap, normalizePhotoProperties, normalizeFiberContent, normalizeFormality, normalizeHeelHeight, normalizeWalkSupport, tagStateForTaggerResult, normalizeManualOverrides } from '../styling-engine/taggerMerge.js'

import {
  prepareImageForClaude,
  prepareWardrobeThumb,
  contentToOpenAI,
  askStylist,
  askStylistWithUsage,
  askStylistWithTools,
  estimateAiUsageCost,
  parseModelJson,
  salvageFirstJson,
  AI_PROVIDER,
  ACTIVE_STYLIST_MODEL,
  describeAiError
} from '../styling-engine/provider.js'

import {
  resolveComfortFootwearConstraint,
  applyComfortFootwearRepair,
  resolveActivityProfile,
  ACTIVITY_PROFILES
} from '../styling-engine/footwear-comfort.js'

import {
  prompts,
  STYLE_SELECTED_ITEM_FEW_SHOTS,
  OUTFIT_MISSIONS,
  TAG_PIECE_SYSTEM,
  EXTRACT_PIECES_SYSTEM
} from '../styling-engine/promptRuntime.js'

import { OCCASION_PROFILES, resolveOccasionProfile } from '../styling-engine/occasions.js'
import {
  pieceMatchesMaterial,
  pieceMatchesFootwear
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
  anchorFidelityInstructions,
  createPhotoPreservingCollageImage,
  ownedInventorySummaryForEditorial
} from '../styling-engine/core.js'

const router = express.Router()

const normalizeForMatch = (str) => {
  if (!str) return ''
  return String(str).toLowerCase().trim().replace(/\s+/g, ' ')
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

export function deriveTripTitle(question = '', weather = '', outfits = []) {
  const q = String(question || '').trim()
  const w = String(weather || '').trim()

  let destination = ''
  const patterns = [
    /\b(?:trip to|travel to|headed to|going to|packing for|visit to|visiting|weekend in|days in|vacation in|in)\s+([A-Z][A-Za-z\s,]+)/,
    /\b(?:trip to|travel to|headed to|going to|packing for|visit to|visiting|weekend in|days in|vacation in)\s+([a-zA-Z\s,]+)/i
  ]
  for (const pat of patterns) {
    const match = q.match(pat)
    if (match && match[1]) {
      const dest = match[1].replace(/\b(?:a|an|the|this|some|my|our)\b/i, '').replace(/[.!?]/g, '').trim()
      if (dest && dest.split(/\s+/).length <= 4 && !/^(?:outfit|wardrobe|summer|winter|spring|fall|weather|clothing|clothes|options|packing|jacket|shirt|pants|skirt|shoes|boots|bag)$/i.test(dest)) {
        destination = dest.split(/\s+/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
        break
      }
    }
  }

  if (!destination) {
    const weatherPatterns = [
      /\b(?:weather in|forecast for)\s+([A-Za-z\s,]+)/i,
      /([A-Za-z\s,]+)\s+weather/i
    ]
    for (const pat of weatherPatterns) {
      const match = w.match(pat)
      if (match && match[1]) {
        const dest = match[1].replace(/[.!?]/g, '').trim()
        if (dest && dest.split(/\s+/).length <= 4 && !/^(?:hot|cold|warm|rainy|sunny|chilly|mild|cool|dry|humid|wet)$/i.test(dest)) {
          destination = dest.split(/\s+/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
          break
        }
      }
    }
  }

  let duration = ''
  const hasTripSummary = Array.isArray(outfits) ? outfits.find(o => o.tripSummary)?.tripSummary : null
  if (hasTripSummary?.durationText) {
    duration = hasTripSummary.durationText.trim()
  }
  if (!duration) {
    const match = q.match(/\b(\d+)\s*-?\s*days?\b/i)
    if (match) {
      duration = `${match[1]} days`
    }
  }
  if (!duration && Array.isArray(outfits) && outfits.length > 0) {
    duration = `${outfits.length} days`
  }

  const occasionLabels = Array.from(new Set(
    (Array.isArray(outfits) ? outfits : []).map(o => {
      const occ = o.occasion || o.bestFor
      if (!occ) return null
      if (occ === 'outdoor_daytime_social') return 'Winery'
      if (occ === 'evening') return 'Evening'
      if (occ === 'gallery / art event') return 'Art'
      if (occ === 'smart casual') return 'Smart Casual'
      return String(occ).charAt(0).toUpperCase() + String(occ).slice(1)
    })
  )).filter(Boolean)
  const friendlyOccasions = occasionLabels.join('/')

  if (destination) {
    if (duration) {
      return `${destination} trip · ${duration}`
    }
    return `${destination} trip`
  }

  const parts = ['Trip']
  if (duration) parts.push(duration)
  if (friendlyOccasions) parts.push(friendlyOccasions)

  return parts.join(' · ')
}

// Multer storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, userUploadsDir()),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, unique + path.extname(file.originalname))
  }
})
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } })
const TAGGER_VERSION = 'v2.0.0-photo-property-authority'

// ── Shared Visual/Tagging helper ──────────────────────────────────────────────
async function anchorThumbsForTagger(anchors = [], { limit = 8 } = {}) {
  const thumbs = []
  for (const anchor of anchors) {
    if (thumbs.length >= limit) break
    const photoFile = anchor.photo || anchor.worn_photo || ''
    if (!photoFile) continue
    const filePath = path.join(userUploadsDir(), photoFile)
    if (!fs.existsSync(filePath)) continue
    try {
      const thumb = await prepareWardrobeThumb(filePath, `tagger-anchor:${anchor.id}:${photoFile}`, { maxPx: 448 })
      thumbs.push({
        label: `CALIBRATION ${String(anchor.value || '').toUpperCase()} ANCHOR ${anchor.id}`,
        guidance: `${anchor.name || '(unnamed piece)'}${anchor.fabric_category ? `; fabric: ${anchor.fabric_category}` : ''}${anchor.reads_as ? `; reads_as: ${anchor.reads_as}` : ''}`,
        ...thumb
      })
    } catch (err) {
      console.warn(`Skipping tagger calibration anchor ${anchor.id}: ${err.message}`)
    }
  }
  return thumbs
}

export async function tagPieceWithProvider(photoInputs, existingPiece = null, { onUsage } = {}) {
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
  const anchorBlock = buildAnchorBlock({
    pieces: db.prepare("SELECT * FROM pieces WHERE status = 'active' ORDER BY id").all().map(parsePiece),
    fields: ['formality', 'fabric_weight']
  })
  if (anchorBlock.text) {
    content.push({ type: 'text', text: anchorBlock.text })
    const anchorThumbs = await anchorThumbsForTagger(anchorBlock.anchors)
    content.push(...anchorThumbs.flatMap(thumb => [
      { type: 'text', text: `${thumb.label}: ${thumb.guidance}` },
      { type: 'image', detail: 'low', source: { type: 'base64', media_type: thumb.media_type, data: thumb.data } }
    ]))
  }

  // Inject Ground Truth context from user overrides on the existing piece
  if (existingPiece) {
    const overrides = normalizeManualOverrides(existingPiece.manual_overrides)
    const groundTruth = []
    for (const field of overrides) {
      const val = existingPiece[field]
      if (val !== null && val !== undefined && val !== '') {
        groundTruth.push(`- ${field}: ${Array.isArray(val) ? val.join(', ') : val}`)
      }
    }
    if (groundTruth.length > 0) {
      content.push({
        type: 'text',
        text: `Ground Truth Overrides:\nThe user has manually overridden the following properties for this garment. You MUST align your other predictions with this truth (e.g. if fabric_category is silk, fiber_content should be silk; if a shoe is flat, heel_height should be flat):\n${groundTruth.join('\n')}\n`
      })
    }
  }

  content.push({ type: 'text', text: prompts.TAG_PIECE_PROMPT })
  const payload = {
    system: TAG_PIECE_SYSTEM,
    // Spec 26 Part 7: the full tag schema was truncating mid-JSON
    // ("Unterminated string in JSON at position 5084") at the prior cap —
    // spec 22 fixed the 400 the truncated body caused on the Anthropic
    // path, but the underlying truncation itself was still live.
    maxTokens: 2500,
    messages: [{
      role: 'user',
      content
    }]
  }

  const { text: raw, usage } = await askStylistWithUsage(payload)
  if (onUsage && usage) onUsage(usage)
  let tags
  try {
    tags = parseModelJson(raw, { context: 'tagger', maxTokens: payload.maxTokens })
  } catch (err) {
    const salvaged = salvageFirstJson(raw)
    if (salvaged === null) throw err
    console.warn('[tagger] salvaged leading JSON from a chatty response')
    tags = salvaged
  }
  if (tags && typeof tags === 'object') {
    tags.tagger_version = TAGGER_VERSION
    const confidence = normalizeConfidenceMap(tags._confidence || tags.style_profile_json?._confidence || {})
    const photoProperties = normalizePhotoProperties(tags.photo_properties || tags.style_profile_json?.photo_properties || {})
    tags.fiber_content = normalizeFiberContent(tags.fiber_content)
    tags.formality = normalizeFormality(tags.formality)
    tags.heel_height = normalizeHeelHeight(tags.heel_height)
    tags.walk_support = normalizeWalkSupport(tags.walk_support)
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

function persistGenerationRun({ flow, occasion = '', weather = '', rosterDebug = {}, rosterCount = 0, requested = null, delivered = null, coverageGaps = [], unresolvedReferencesCount = 0, structuralRejectionReasons = {} } = {}) {
  try {
    const cutIds = Array.isArray(rosterDebug.capCutPieces)
      ? rosterDebug.capCutPieces.map(piece => Number(piece.id)).filter(Number.isFinite)
      : []
    db.prepare(`
      INSERT INTO generation_runs (flow, occasion, weather, roster_count, pool_size, cap_applied, cut_ids, requested, delivered, coverage_gaps, roster_counts, activity_source, unresolved_references_count, structural_rejection_reasons)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      flow,
      occasion || '',
      typeof weather === 'string' ? weather : JSON.stringify(weather || {}),
      Number(rosterCount) || 0,
      Number(rosterDebug.postGatePoolSize) || 0,
      rosterDebug.capApplied ? 1 : 0,
      JSON.stringify(cutIds),
      requested === null ? null : Number(requested) || 0,
      delivered === null ? null : Number(delivered) || 0,
      JSON.stringify(Array.isArray(coverageGaps) ? coverageGaps : []),
      JSON.stringify(rosterDebug.rosterCounts || rosterDebug.categoryCounts || {}),
      rosterDebug.activitySource || '',
      Number(unresolvedReferencesCount) || 0,
      JSON.stringify(structuralRejectionReasons || {})
    )
  } catch (err) {
    console.warn('Failed to persist generation run:', err.message)
  }
}

// Spec 3 (freeform observability): the freeform-chat equivalent of persistGenerationRun above —
// a parallel table since the composer's roster-shaped columns (pool_size, cap_applied, cut_ids) don't
// apply to a tool-calling chat turn. Makes "how often does validation fail," "how often are pieces
// gate-excluded" queryable instead of anecdotal, mirroring how generation_runs already serves that
// role for the composer. Best-effort: never throws into the request.
export function persistFreeformGenerationRun({ sessionId = '', occasion = '', diagnostics = {} } = {}) {
  try {
    db.prepare(`
      INSERT INTO freeform_generation_runs (session_id, occasion, search_calls, gate_excluded_total, propose_calls, propose_validation_fails, outfit_prose_without_tool_count, zero_result_contradiction_blocks, destination_clarification_retries, plan_slot_environment_inferred, plan_slot_activity_inferred, submit_plan_calls, submit_plan_validation_fails, submit_plan_resubmits, submit_plan_partial_accepts, weather_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId || '',
      occasion || '',
      Number(diagnostics.searchCalls) || 0,
      Number(diagnostics.gateExcludedTotal) || 0,
      Number(diagnostics.proposeCalls) || 0,
      Number(diagnostics.proposeValidationFails) || 0,
      Number(diagnostics.outfitProseWithoutToolCall) || 0,
      Number(diagnostics.zeroResultContradictionBlocks) || 0,
      Number(diagnostics.destinationClarificationRetries) || 0,
      Number(diagnostics.planSlotEnvironmentInferred) || 0,
      Number(diagnostics.planSlotActivityInferred) || 0,
      Number(diagnostics.submitPlanCalls) || 0,
      Number(diagnostics.submitPlanValidationFails) || 0,
      Number(diagnostics.submitPlanResubmits) || 0,
      Number(diagnostics.submitPlanPartialAccepts) || 0,
      diagnostics.weatherSource || ''
    )
  } catch (err) {
    console.warn('Failed to persist freeform generation run:', err.message)
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

const composerPieceLineSuffix = piece =>
  `${piece.fabric_category ? `; fabric: ${piece.fabric_category}` : ''}${piece.reads_as ? `; reads_as: ${piece.reads_as}` : ''}`

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
    activity,
    request: question,
    question,
    occasionProfile,
    activityProfile
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
    const filePath = path.join(userUploadsDir(), photoFile)
    if (!fs.existsSync(filePath)) return
    const thumb = await prepareWardrobeThumb(filePath, `${piece.id}:${photoFile}`, { maxPx: composerThumbPx })
    content.push({ type: 'text', text: `${labelPrefix} ID ${piece.id}: ${piece.name}${composerPieceLineSuffix(piece)}` })
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
      system: `${prompts.WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM}\n\nSELECTED-ANCHOR CONTRACT:\nEvery outfit must include the selected anchor id. The selected garment is the premise, not one option among many.\n\nOCCASION & CLIMATE PROFILES (RULES-AS-DATA):\n${JSON.stringify(OCCASION_PROFILES, null, 2)}\n\nACTIVITY PROFILES (RULES-AS-DATA):\n${JSON.stringify(ACTIVITY_PROFILES, null, 2)}`,
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

  const unresolvedReferences = []
  const resolved = (Array.isArray(parsed?.outfits) ? parsed.outfits : []).map(outfit => {
    const incomingPieces = Array.isArray(outfit.pieces) 
      ? outfit.pieces 
      : (Array.isArray(outfit.pieceIds) ? outfit.pieceIds.map(id => ({ id })) : [])
    
    const hasAnchor = incomingPieces.some(p => Number(p.id) === selectedId)
    if (!hasAnchor) {
      const anchorPiece = poolById.get(selectedId) || candidatePieces.find(p => Number(p.id) === selectedId)
      if (anchorPiece) {
        incomingPieces.unshift({ id: selectedId, name: anchorPiece.name })
      }
    }

    const resolvedPieces = []
    for (const p of incomingPieces) {
      const id = p?.id
      const name = p?.name
      let match = candidatePieces.find(item => Number(item.id) === Number(id))
      if (!match && name) {
        match = candidatePieces.find(item => normalizeForMatch(item.name) === normalizeForMatch(name))
      }
      if (!match) {
        unresolvedReferences.push({
          id,
          name,
          outfitLabel: outfit.title || outfit.direction || outfit.label || 'unlabeled'
        })
      } else {
        resolvedPieces.push(match)
      }
    }
    const uniqueResolved = []
    const seenIds = new Set()
    for (const p of resolvedPieces) {
      if (p && !seenIds.has(Number(p.id))) {
        seenIds.add(Number(p.id))
        uniqueResolved.push(p)
      }
    }
    return { ...outfit, pieceIds: uniqueResolved.map(p => Number(p.id)), pieces: uniqueResolved }
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
      registerCeiling: rosterDebug.registerCeiling,
      formalityIntent: rosterDebug.formalityIntent,
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
      timings,
      resolvedActivity: rosterDebug.resolvedActivity,
      activitySource: rosterDebug.activitySource,
      walkable: rosterDebug.walkable,
      rosterCounts: rosterDebug.categoryCounts,
      unresolvedReferences,
      unresolvedReferencesCount: unresolvedReferences.length
    }
  }
}


// ── AI Tagging endpoints ───────────────────────────────────────────────────────
router.post('/extract-pieces', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo provided' })
  const filePath = path.join(userUploadsDir(), req.file.filename)
  try {
    const { base64, mime } = await prepareImageForClaude(filePath)
    fs.unlinkSync(filePath)

    const raw = await askStylist({
      system: EXTRACT_PIECES_SYSTEM,
      maxTokens: 3000,
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
      "fabric_weight": "ultralight|light|medium|heavy — for SHOES use the shoe scale instead: delicate|slim|medium|chunky (a substantial shoe is chunky, not heavy)",
      "opacity": "opaque|semi_sheer|sheer|open_weave",
      "fiber_content": ["array of visible/likely fibers from this canonical list only: wool, merino, cashmere, alpaca, mohair, fleece, down, cotton, linen, silk, tencel, modal, rayon, viscose, polyester, nylon, acrylic, spandex, leather, suede, denim, unknown. Use 'unknown' if not determinable."],
      "formality": "lounge|everyday|elevated|dressy",
      "heel_height": "flat|low|mid|high|null (shoes only; null/omit for non-shoes)",
      "walk_support": "high|medium|low|null (shoes only; null/omit for non-shoes)"
    }
  ]
}` }
        ]
      }]
    })

    console.log('RAW RESPONSE LENGTH:', raw?.length, 'RAW RESPONSE:', raw)
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
    const filePath = path.join(userUploadsDir(), photoFile.filename)
    photos.push({
      path: filePath,
      label: 'HANGER PHOTO',
      guidance: 'Use for literal garment truth: category, color, construction, pattern, fabric, and shape.'
    })
  }
  if (wornPhotoFile) {
    const filePath = path.join(userUploadsDir(), wornPhotoFile.filename)
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
      const filePath = path.join(userUploadsDir(), photoFile.filename)
      photos.push({ path: filePath, label: 'HANGER PHOTO', guidance: 'Use for literal garment truth: category, color, construction, pattern, fabric, and shape.' })
      tempFiles.push(filePath)
    } else if (piece.photo) {
      const hangerPath = path.join(userUploadsDir(), piece.photo)
      if (fs.existsSync(hangerPath)) {
        photos.push({ path: hangerPath, label: 'HANGER PHOTO', guidance: 'Use for literal garment truth: category, color, construction, pattern, fabric, and shape.' })
      }
    }

    const wornPhotoFile = req.files?.worn_photo?.[0]
    if (wornPhotoFile) {
      const filePath = path.join(userUploadsDir(), wornPhotoFile.filename)
      photos.push({ path: filePath, label: 'WORN PHOTO', guidance: 'Use for fit, drape, scale, real-wear behavior, outfit role, and risks. Do not override literal garment color/category from this styling context.' })
      tempFiles.push(filePath)
    } else if (piece.worn_photo) {
      const wornPath = path.join(userUploadsDir(), piece.worn_photo)
      if (fs.existsSync(wornPath)) {
        photos.push({ path: wornPath, label: 'WORN PHOTO', guidance: 'Use for fit, drape, scale, real-wear behavior, outfit role, and risks. Do not override literal garment color/category from this styling context.' })
      }
    }

    if (!photos.length) return res.status(400).json({ error: 'This piece has no photo to tag' })

    const tags = await tagPieceWithProvider(photos, parsePiece(piece))
    tags.tag_state = tagStateForTaggerResult(tags, {
      photo: Boolean(photoFile || piece.photo),
      worn_photo: Boolean(wornPhotoFile || piece.worn_photo)
    })
    const merged = applyTaggerResult(parsePiece(piece), tags)
    merged._confidence = merged.style_profile_json?._confidence || {}
    merged.photo_properties = merged.style_profile_json?.photo_properties || {}
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
      const filePath = path.join(userUploadsDir(), photoFile)
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
        confirmedOutfitsText ? `General confirmed/favorite outfit memory for ${prompts.PROFILE_NAME}'s taste filter:\n${confirmedOutfitsText}` : '',
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
        system: prompts.STYLE_SELECTED_ITEM_SYSTEM,
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
  let rankedCandidates = selectCandidatesForOutfitGeneration(parsedPiece, allPieces, 32, { occasion, mission, mood, season, weatherProfile, comfortConstraint, activity, request: question, question })
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
    confirmedOutfitsText ? `Confirmed/favorite outfit memory for ${prompts.PROFILE_NAME}'s taste filter:\n${confirmedOutfitsText}` : '',
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

function wholeWardrobeSessionMemorySummary({ daysCutoff = 6 } = {}) {
  const cutoff = Math.floor(Date.now() / 1000) - Number(daysCutoff || 6) * 86400
  const rows = db.prepare(`
    SELECT piece_ids, formula_families
    FROM whole_wardrobe_sessions
    WHERE created_at > ?
    ORDER BY created_at DESC
    LIMIT 6
  `).all(cutoff)
  const pieceIds = new Set()
  const formulaFamilies = new Set()
  for (const row of rows) {
    const ids = safeJsonParse(row.piece_ids, [])
    if (Array.isArray(ids)) {
      ids.map(Number).filter(Boolean).forEach(id => pieceIds.add(id))
    }
    const families = safeJsonParse(row.formula_families, [])
    if (Array.isArray(families)) {
      families.filter(Boolean).forEach(family => formulaFamilies.add(family))
    }
  }
  return {
    success: true,
    daysCutoff,
    recentSessionCount: rows.length,
    itemCount: pieceIds.size,
    formulaCount: formulaFamilies.size,
    mode: 'whole_wardrobe_session_memory_summary'
  }
}

router.get('/whole-wardrobe-session-memory', (req, res) => {
  try {
    res.json(wholeWardrobeSessionMemorySummary())
  } catch (err) {
    console.error('Get whole-wardrobe session memory error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.delete('/whole-wardrobe-session-memory', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM whole_wardrobe_sessions').run()
    res.json({
      success: true,
      clearedCount: result.changes || 0,
      recentSessionCount: 0,
      itemCount: 0,
      formulaCount: 0,
      mode: 'reset_whole_wardrobe_session_memory'
    })
  } catch (err) {
    console.error('Reset whole-wardrobe session memory error:', err)
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
  activity = '',
  savedOutfitSeed = null
} = {}) {
    const routeStartedAt = Date.now()
    const requestedLimit = Math.max(1, Math.min(5, Number(limit) || 5))
    const stylingRequest = String(request || question || '').trim()
    const weatherProfile = weatherProfileFromContext({ mood: [mood, stylingRequest].filter(Boolean).join(' '), season })
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
    const savedVariantMode = savedOutfitSeed?.mode === 'adjacent' ? 'adjacent' : (savedOutfitSeed ? 'formula' : null)
    const savedSeedIds = [...new Set((savedOutfitSeed?.pieceIds || savedOutfitSeed?.pieces?.map(piece => piece?.id) || [])
      .map(Number)
      .filter(Boolean))]
    const savedSeedPieces = savedSeedIds
      .map(id => allPieces.find(piece => Number(piece.id) === id))
      .filter(Boolean)
    const savedMainPieceId = Number(savedOutfitSeed?.mainPieceId || savedOutfitSeed?.main_piece_id) || null
    const savedMainPiece = savedMainPieceId
      ? savedSeedPieces.find(piece => Number(piece.id) === savedMainPieceId)
        || allPieces.find(piece => Number(piece.id) === savedMainPieceId)
      : null
    const savedSeedOutfit = { pieces: savedSeedPieces, pieceIds: savedSeedPieces.map(piece => Number(piece.id)) }
    const savedSeedFormula = savedSeedPieces.length
      ? wholeWardrobeFormulaFamily(savedSeedOutfit, savedSeedPieces, occasion)
      : ''
    const savedSeedSilhouette = savedSeedPieces.length ? wholeWardrobeSilhouetteFromPieces(savedSeedOutfit) : ''
    const savedSeedGrounding = savedSeedPieces.length ? wholeWardrobeGroundingStrategy(savedSeedOutfit) : ''
    const savedSourceHasLayeredTopFormula = savedSeedPieces.filter(piece => wardrobeCategoryGroup(piece) === 'top').length >= 2
    const savedFormulaRequiresLayeredTop = savedVariantMode === 'formula' && savedSourceHasLayeredTopFormula
    const savedVariantGuidance = savedOutfitSeed ? [
      'SAVED OUTFIT VARIANT CONTRACT:',
      `Source outfit: ${savedOutfitSeed.name || savedOutfitSeed.label || savedOutfitSeed.title || 'saved outfit'}.`,
      savedSeedPieces.length ? `Linked source pieces:\n${savedSeedPieces.map(buildPieceText).join('\n')}` : '',
      savedSeedFormula ? `Inferred source formula family: ${savedSeedFormula}.` : '',
      savedSeedSilhouette ? `Inferred source silhouette: ${savedSeedSilhouette}.` : '',
      savedSeedGrounding ? `Inferred source grounding strategy: ${savedSeedGrounding}.` : '',
      savedFormulaRequiresLayeredTop ? 'The source outfit includes two top-category garments. Formula-similar results MUST preserve that layered-top structure: include one primary top plus one top-layer/overshirt/button-down. The top-layer garment may still be category top; do not collapse the formula into a single top + bottom + shoes outfit.' : '',
      savedSourceHasLayeredTopFormula && savedVariantMode === 'adjacent' ? 'The source outfit includes two top-category garments. Adjacent results may simplify the layer if the neighboring idea is stronger, but layered-top options are preferred when they work.' : '',
      savedMainPiece ? `Every proposed outfit MUST include Main piece ID ${savedMainPiece.id}: ${savedMainPiece.name}.` : '',
      savedVariantMode === 'adjacent'
        ? 'Adjacent mode: use only shown wardrobe pieces. Preserve the source outfit\'s mood, occasion, and personal style lane, but allow a nearby formula, silhouette, or grounding strategy. Return meaningfully different neighboring ideas.'
        : 'Formula-similar mode: use only shown wardrobe pieces. Preserve the source outfit formula and its focal/support relationship while substituting owned pieces. Do not simply repeat the exact saved outfit; each result must be a useful alternate realization of the same formula.',
    ].filter(Boolean).join('\n') : ''

    // Reuse existing suppression filter (hard filter here — suppressed pieces are simply not shown)
    let { allowedPieces, suppressedPieces } =
      filterWholeWardrobePiecesForGeneration(allPieces, { occasion, explorationMode, weatherProfile, mood, activity })
    const savedMainSuppression = savedMainPiece
      ? suppressedPieces.find(piece => Number(piece.id) === savedMainPieceId)
      : null
    const savedMainBypassedSuppression = Boolean(savedMainSuppression)
    if (savedMainPiece && savedMainBypassedSuppression && !allowedPieces.some(piece => Number(piece.id) === savedMainPieceId)) {
      allowedPieces = [savedMainPiece, ...allowedPieces]
    }
    const suppressedReasonCounts = suppressedPieces.reduce((acc, piece) => {
      for (const reason of (piece.reasons || [])) {
        acc[reason] = (acc[reason] || 0) + 1
      }
      return acc
    }, {})

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
    const confirmedOutfitsText = getConfirmedOutfitMemory(8, {
      allowedPieceIds: allowedPieces.map(piece => Number(piece.id))
    })

    // Compute weather profile and filter the visual composer roster
    let { roster, excluded, debug: rosterDebug } = buildVisualComposerRoster(allowedPieces, {
      occasion,
      weatherProfile,
      sessionInfluence,
      maxImages: 90,
      mood,
      activity,
      request: stylingRequest,
      question,
      occasionProfile,
      activityProfile
    })
    if (savedMainPiece) {
      const allowedMain = allowedPieces.find(piece => Number(piece.id) === savedMainPieceId)
      if (!allowedMain) {
        throw new Error(`The selected Main piece is unavailable because it is no longer active. Choose another Main piece.`)
      }
      if (!roster.some(piece => Number(piece.id) === savedMainPieceId)) {
        roster = [allowedMain, ...roster.filter(piece => Number(piece.id) !== savedMainPieceId)].slice(0, 90)
      }
    }

    console.log(`\n[Visual Composer Roster] Filtering active pieces for mood: "${mood}", season: "${season}"`)
    console.log(`  - Weather profile:`, weatherProfile)
    console.log(`  - Suppressed before roster: ${suppressedPieces.length}`, suppressedReasonCounts)
    console.log(`  - Total active pieces: ${allowedPieces.length}`)
    console.log(`  - Survived in roster: ${roster.length}`)
    console.log(`  - Excluded: ${excluded.length}`)
    console.log(`  - Excluded reasons count:`, rosterDebug.excludedCounts)
    console.log(`  - Register ceiling:`, rosterDebug.registerCeiling || 'none', rosterDebug.formalityIntent || {})
    console.log(`  - Register target:`, rosterDebug.registerTarget || 'none', {
      enforced: rosterDebug.registerTargetEnforcedGroups || [],
      gaps: rosterDebug.registerTargetCoverageGaps || []
    })

    const activityFactLine = (() => {
      const enforced = rosterDebug.activityTagEnforcedGroups || []
      const gaps = rosterDebug.activityCoverageGaps || []
      if (!activityProfile?.rules?.required_occasion_tags?.length) return ''
      if (enforced.length && !gaps.length) return `All roster pieces are rated for ${activityProfile.label}; compose freely.`
      if (gaps.length) return `Note: limited ${activityProfile.label}-rated coverage for ${gaps.join(', ')}; closest suitable pieces included.`
      return ''
    })()

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
      stylingRequest ? `Styling request: ${stylingRequest}` : '',
      activity && activity !== 'none' ? `Activity: ${activity}` : '',
      activityFactLine,
      occasionProfileGuidance ? `Occasion guidance:\n${occasionProfileGuidance}` : '',
      isWeatherFiltered ? "Off-season pieces have been deprioritized or removed; everything shown is weather-optimized." : '',
      `Compose ${requestedLimit} outfits.`,
      savedVariantGuidance,
      rotationWarningsText,
      wholeWardrobeFeedbackText ? `Feedback memory (rejected pairings are settled — do not repeat them):\n${wholeWardrobeFeedbackText}` : '',
      confirmedOutfitsText ? `Confirmed favorite outfits:\n${confirmedOutfitsText}` : '',
      '',
      'Below are photos of every available piece, grouped by category. Reference pieces by exact ID.'
    ].filter(Boolean).join('\n') })

    const savedOutfitPhotoPath = savedOutfitSeed?.photo
      ? uploadedOrSavedOutfitPhotoPath(savedOutfitSeed.photo)
      : ''
    if (savedOutfitPhotoPath && fs.existsSync(savedOutfitPhotoPath)) {
      const { base64, mime } = await prepareImageForClaude(savedOutfitPhotoPath)
      content.push({ type: 'text', text: 'Saved outfit source photo. Use it to read the original formula, proportions, and focal hierarchy; do not copy it exactly.' })
      content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
    }

    let shownPieceCount = 0
    const shownPieces = []
    for (const group of grouped.keys()) {
      const pieces = grouped.get(group)
      if (!pieces?.length) continue
      content.push({ type: 'text', text: `=== ${group.toUpperCase()}S ===` })
      for (const p of pieces) {
        const photoFile = p.worn_photo || p.photo || ''
        if (!photoFile) continue
        const filePath = path.join(userUploadsDir(), photoFile)
        if (!fs.existsSync(filePath)) continue
        const thumb = await prepareWardrobeThumb(filePath, `${p.id}:${photoFile}`, { maxPx: composerThumbPx })
        content.push({ type: 'text', text: `ID ${p.id}: ${p.name}${composerPieceLineSuffix(p)}` })
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
        system: savedVariantGuidance
          ? `${prompts.WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM}\n\n${savedVariantGuidance}`
          : prompts.WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM,
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
    const unresolvedReferences = []
    const resolved = (Array.isArray(parsed?.outfits) ? parsed.outfits : []).map(outfit => {
      const incomingPieces = Array.isArray(outfit.pieces) 
        ? outfit.pieces 
        : (Array.isArray(outfit.pieceIds) ? outfit.pieceIds.map(id => ({ id })) : [])
      const resolvedPieces = []
      for (const p of incomingPieces) {
        const id = p?.id
        const name = p?.name
        let match = allowedPieces.find(item => Number(item.id) === Number(id))
        if (!match && name) {
          match = allowedPieces.find(item => normalizeForMatch(item.name) === normalizeForMatch(name))
        }
        if (!match) {
          unresolvedReferences.push({
            id,
            name,
            outfitLabel: outfit.title || outfit.direction || outfit.label || 'unlabeled'
          })
        } else {
          resolvedPieces.push(match)
        }
      }
      const uniqueResolved = []
      const seenIds = new Set()
      for (const p of resolvedPieces) {
        if (p && !seenIds.has(Number(p.id))) {
          seenIds.add(Number(p.id))
          uniqueResolved.push(p)
        }
      }
      return { ...outfit, pieceIds: uniqueResolved.map(p => Number(p.id)), pieces: uniqueResolved }
    }).filter(o => o.pieces.length >= 2)

    const normalizedModelOutfits = resolved.map(o => normalizeWholeWardrobeOutfitObject(o, allowedPieces))
    const structuralRejectionReason = (outfit) => {
      const groups = (outfit?.pieces || []).map(piece => wardrobeCategoryGroup(piece))
      const shoeCount = groups.filter(group => group === 'shoes').length
      const bottomCount = groups.filter(group => group === 'bottom').length
      const dressCount = groups.filter(group => group === 'dress').length
      const topCount = groups.filter(group => group === 'top').length
      if (shoeCount > 1) return 'structural: more than one shoe'
      if (shoeCount !== 1) return 'structural: missing shoes'
      if (bottomCount > 1) return 'structural: more than one bottom'
      if (dressCount > 1) return 'structural: more than one dress'
      if (dressCount === 1 && bottomCount > 0) return 'structural: dress plus bottom'
      if (dressCount !== 1 && topCount < 1) return 'structural: missing top'
      if (dressCount !== 1 && bottomCount !== 1) return 'structural: missing bottom'
      return 'structural: not a complete wardrobe outfit'
    }
    const structurallyRejectedModelOutfits = normalizedModelOutfits
      .filter(o => !isOutfitStructurallyValid(o.pieces, { requireShoes: true }))
      .map(outfit => ({ outfit, reason: structuralRejectionReason(outfit) }))
    const includesSavedMain = outfit => !savedMainPieceId
      || (outfit.pieceIds || outfit.pieces?.map(piece => piece?.id) || []).map(Number).includes(savedMainPieceId)
    const hasLayeredTopFormula = outfit => (outfit.pieces || []).filter(piece => wardrobeCategoryGroup(piece) === 'top').length >= 2
    const modelMissingMainRejectedCount = savedMainPieceId
      ? normalizedModelOutfits.filter(outfit => !includesSavedMain(outfit)).length
      : 0
    const modelLayeredTopFormulaRejectedCount = savedFormulaRequiresLayeredTop
      ? normalizedModelOutfits.filter(outfit => includesSavedMain(outfit) && isOutfitStructurallyValid(outfit.pieces, { requireShoes: true }) && !hasLayeredTopFormula(outfit)).length
      : 0
    let modelOutfits = normalizedModelOutfits
      .filter(includesSavedMain)
      .filter(o => isOutfitStructurallyValid(o.pieces, { requireShoes: true }))
      .filter(o => !savedFormulaRequiresLayeredTop || hasLayeredTopFormula(o))
      .map(outfit => ({
        ...outfit,
        savedOutfitVariantMode: savedVariantMode,
        sourceFormulaFamily: savedSeedFormula,
        systemSuggestion: comfortFootwearSuggestionForOutfit(outfit, allowedPieces, comfortConstraint, { weatherProfile, occasion, mood, activity })
      }))

    let localBackfillOutfits = []
    let localBackfillCandidateCount = 0
    let localBackfillMissingMainRejectedCount = 0
    let diagnosticBackfillOutfits = []
    let diagnosticBackfillCandidateCount = 0
    let diagnosticBackfillMissingMainRejectedCount = 0
    const rosterIds = new Set(roster.map(piece => Number(piece.id)))
    const excludedById = new Map(excluded.map(item => [Number(item.pieceId), item.reason]))
    const outfitKey = outfit => {
      const ids = Array.isArray(outfit?.pieceIds) && outfit.pieceIds.length
        ? outfit.pieceIds
        : (Array.isArray(outfit?.pieces) ? outfit.pieces.map(piece => piece?.id) : [])
      return ids.map(Number).filter(Boolean).sort((a, b) => a - b).join('|')
    }
    const withLocalFillSource = (outfit, extra = {}) => ({
      ...outfit,
      ...extra,
      source: extra.source || 'local-fill',
      label: String(outfit.label || '').includes(': standard wear')
        ? outfit.label
        : `${outfit.label || 'Local fill outfit'}: standard wear`
    })
    const buildBrokenDiagnosticCard = (outfit) => {
      const brokenPieces = (outfit.pieces || [])
        .map(piece => ({
          id: Number(piece.id),
          name: piece.name,
          reason: excludedById.get(Number(piece.id)) || (!rosterIds.has(Number(piece.id)) ? 'not in gated visual roster' : '')
        }))
        .filter(piece => piece.reason)
      if (!brokenPieces.length) return null
      const reasonText = brokenPieces.map(piece => `${piece.name}: ${piece.reason}`).join('; ')
      return withLocalFillSource(outfit, {
        broken: true,
        diagnosticOnly: true,
        strength: 'needs review',
        rejectionReason: reasonText,
        reason: outfit.reason || 'Local fill candidate shown for debugging.',
        brokenPieces
      })
    }
    const buildBrokenModelCard = (outfit, rejectionReason = 'rejected by model-output gate', resolutionNote = null) => withLocalFillSource(outfit, {
      broken: true,
      diagnosticOnly: true,
      source: 'model-rejected',
      strength: 'needs review',
      rejectionReason,
      resolutionNote,
      reason: outfit.reason || 'Model proposal shown for debugging.'
    })
    const buildVisualLocalBackfill = () => {
      if (localBackfillOutfits.length) return localBackfillOutfits
      const candidates = buildWholeWardrobeCandidateOutfits(roster, {
        occasion,
        season,
        weatherProfile,
        mood,
        activity,
        sessionInfluence,
        candidateLimit: 42,
        candidateBucketLimit: 8,
        requiredPieceId: savedMainPieceId,
        preserveLayeredTop: savedSourceHasLayeredTopFormula,
        request: stylingRequest,
        question
      })
      localBackfillCandidateCount = candidates.length
      const candidateOutfits = wholeWardrobeOutfitsFromCandidates(candidates, roster, { occasion, mood, season, weatherProfile, activity, sessionInfluence })
      localBackfillMissingMainRejectedCount = savedMainPieceId
        ? candidateOutfits.filter(outfit => !includesSavedMain(outfit)).length
        : 0
      localBackfillOutfits = candidateOutfits
        .filter(includesSavedMain)
        .filter(outfit => !savedFormulaRequiresLayeredTop || hasLayeredTopFormula(outfit))
        .map(outfit => withLocalFillSource(outfit))
      return localBackfillOutfits
    }
    const buildDiagnosticLocalBackfill = () => {
      if (diagnosticBackfillOutfits.length) return diagnosticBackfillOutfits
      const candidates = buildWholeWardrobeCandidateOutfits(allowedPieces, {
        occasion,
        season,
        weatherProfile,
        mood,
        activity,
        sessionInfluence,
        candidateLimit: 42,
        candidateBucketLimit: 8,
        requiredPieceId: savedMainPieceId,
        preserveLayeredTop: savedSourceHasLayeredTopFormula,
        request: stylingRequest,
        question
      })
      diagnosticBackfillCandidateCount = candidates.length
      const candidateOutfits = wholeWardrobeOutfitsFromCandidates(candidates, allowedPieces, { occasion, mood, season, weatherProfile, activity, sessionInfluence })
      diagnosticBackfillMissingMainRejectedCount = savedMainPieceId
        ? candidateOutfits.filter(outfit => !includesSavedMain(outfit)).length
        : 0
      diagnosticBackfillOutfits = candidateOutfits
        .filter(includesSavedMain)
        .filter(outfit => !savedFormulaRequiresLayeredTop || hasLayeredTopFormula(outfit))
      return diagnosticBackfillOutfits
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
      { mode: 'advisor', requireShoes: true, rejectProfileDiscouraged: true, applyDiversity: false, candidatePieces: allowedPieces, occasion, mood, season, weatherProfile, activity, sessionInfluence, request: stylingRequest, question }
    )
    let structuredOutfits = gatedModel.outfits.slice(0, requestedLimit)
    let softBackfillCount = 0
    let diagnosticBrokenCount = 0
    let gatedLocal = { outfits: [], rejected: [] }
    if (structuredOutfits.length < requestedLimit) {
      if (!modelOutfits.length || savedFormulaRequiresLayeredTop) {
        if (!modelOutfits.length) console.log(`    - Visual Composer AI returned 0 structurally valid outfits. Filling from local candidate generation.`)
        gatedLocal = locallyGateWholeWardrobeOutfits(
          buildVisualLocalBackfill(),
          requestedLimit,
          { mode: 'advisor', requireShoes: true, rejectProfileDiscouraged: true, applyDiversity: false, candidatePieces: roster, occasion, mood, season, weatherProfile, activity, sessionInfluence, request: stylingRequest, question }
        )
        const seenKeys = new Set(structuredOutfits.map(outfitKey))
        const fillOutfits = gatedLocal.outfits.filter(outfit => {
          const key = outfitKey(outfit)
          if (!key || seenKeys.has(key)) return false
          seenKeys.add(key)
          return true
        })
        softBackfillCount = Math.min(requestedLimit - structuredOutfits.length, fillOutfits.length)
        structuredOutfits = [...structuredOutfits, ...fillOutfits.slice(0, requestedLimit - structuredOutfits.length)]
      } else {
        const seenKeys = new Set(structuredOutfits.map(outfitKey))
        const diagnostics = []
        const rejectedModelDiagnostics = [
          ...structurallyRejectedModelOutfits,
          ...gatedModel.rejected
            .filter(item => item?.outfit)
            .map(item => ({ outfit: item.outfit, reason: item.reason || 'rejected by model-output gate' }))
        ]
        for (const candidate of rejectedModelDiagnostics) {
          const key = outfitKey(candidate.outfit)
          if (!key || seenKeys.has(key)) continue
          
          const label = candidate.outfit.title || candidate.outfit.direction || candidate.outfit.label || 'unlabeled'
          const specificUnresolved = unresolvedReferences.filter(ref => ref.outfitLabel === label)
          let resolutionNote = null
          if (specificUnresolved.length > 0) {
            const details = specificUnresolved.map(ref => `model referenced "${ref.name || 'unknown name'}" (id ${ref.id || 'unknown id'}) — not found in roster, no name match`).join('; ')
            resolutionNote = `${details}. Piece may have been excluded by a gate after the model saw it, or the ID was invalid.`
          }
          
          const diagnostic = buildBrokenModelCard(candidate.outfit, candidate.reason, resolutionNote)
          if (!diagnostic) continue
          diagnostics.push(diagnostic)
          seenKeys.add(key)
          if (diagnostics.length >= requestedLimit - structuredOutfits.length) break
        }
        if (diagnostics.length < requestedLimit - structuredOutfits.length) {
          for (const candidate of buildDiagnosticLocalBackfill()) {
            const key = outfitKey(candidate)
            if (!key || seenKeys.has(key)) continue
            const diagnostic = buildBrokenDiagnosticCard(candidate)
            if (!diagnostic) continue
            diagnostics.push(diagnostic)
            seenKeys.add(key)
            if (diagnostics.length >= requestedLimit - structuredOutfits.length) break
          }
        }
        diagnosticBrokenCount = diagnostics.length
        structuredOutfits = [...structuredOutfits, ...diagnostics]
      }
    }
    visualDebugLog.localBackfillCandidates = localBackfillCandidateCount
    visualDebugLog.localBackfillOutfits = localBackfillOutfits.length
    visualDebugLog.localBackfillMissingMainRejected = localBackfillMissingMainRejectedCount
    visualDebugLog.diagnosticBackfillCandidates = diagnosticBackfillCandidateCount
    visualDebugLog.diagnosticBackfillOutfits = diagnosticBackfillOutfits.length
    visualDebugLog.diagnosticBackfillMissingMainRejected = diagnosticBackfillMissingMainRejectedCount
    visualDebugLog.modelMissingMainRejected = modelMissingMainRejectedCount
    visualDebugLog.modelLayeredTopFormulaRejected = modelLayeredTopFormulaRejectedCount
    visualDebugLog.missingMainRejected = modelMissingMainRejectedCount + localBackfillMissingMainRejectedCount + diagnosticBackfillMissingMainRejectedCount
    visualDebugLog.modelGateOutfits = gatedModel.outfits.length
    visualDebugLog.modelGateRejected = gatedModel.rejected.length
    visualDebugLog.modelGateRejectedReasons = rejectionSummary(gatedModel.rejected)
    // Previously invisible: aiStructurallyValid < aiReturnedRaw meant the model produced an
    // incomplete outfit (e.g. missing shoes), but the specific reason never made it into this log —
    // only visible by opening the resulting broken diagnostic card in the UI, one at a time.
    visualDebugLog.structurallyRejectedCount = structurallyRejectedModelOutfits.length
    visualDebugLog.structurallyRejectedReasons = rejectionSummary(structurallyRejectedModelOutfits)
    visualDebugLog.localFillGateOutfits = gatedLocal.outfits.length
    visualDebugLog.localFillGateRejected = gatedLocal.rejected.length
    visualDebugLog.localFillGateRejectedReasons = rejectionSummary(gatedLocal.rejected)
    visualDebugLog.localFillAdded = softBackfillCount
    visualDebugLog.diagnosticBrokenAdded = diagnosticBrokenCount
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
        strength: outfit.broken ? 'needs review' : (index === 0 ? 'signature' : (index <= 2 ? 'strong' : 'usable')),
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
    if (savedVariantMode) {
      const intro = savedVariantMode === 'adjacent'
        ? 'Here are adjacent outfits from your wardrobe: the same style neighborhood, with more freedom in formula and silhouette.'
        : 'Here are formula-similar outfits from your wardrobe: alternate owned-piece versions of the saved look\'s underlying structure.'
      feedback = `${intro}\n\n${feedback}`
    }

    const coverageNote = formatCoverageNote(topCoverage, shoeCoverage, { occasion, occasionProfile, activityProfile })
    const deliveredCount = structuredOutfits.filter(outfit => !outfit.broken).length
    const shortfallNote = deliveredCount < requestedLimit
      ? `${deliveredCount} of ${requestedLimit} requested outfits are ready; broken diagnostic cards show what local fill would have added and why it failed the gated roster.`
      : ''
    const responseCoverageNote = [shortfallNote, coverageNote].filter(Boolean).join('\n')
    if (responseCoverageNote) feedback = feedback + '\n\n' + responseCoverageNote

    persistGenerationRun({
      flow: 'whole_wardrobe_visual',
      occasion,
      weather: weatherProfile,
      rosterDebug,
      rosterCount: roster.length,
      requested: requestedLimit,
      delivered: deliveredCount,
      coverageGaps: rosterDebug.activityCoverageGaps || [],
      unresolvedReferencesCount: unresolvedReferences.length,
      structuralRejectionReasons: visualDebugLog.structurallyRejectedReasons
    })

    return {
      feedback,
      structuredOutfits,
      provider: AI_PROVIDER,
      mode: savedVariantMode ? `generate_saved_outfit_${savedVariantMode}_variants` : 'generate_wardrobe_outfits_visual',
      pipeline: savedVariantMode ? 'saved_outfit_wardrobe_variant_composer' : 'full_wardrobe_visual_composer',
      savedOutfitVariantMode: savedVariantMode,
      sourceOutfit: savedOutfitSeed || null,
      coverageNote: responseCoverageNote,
      debug: {
        profileCoverage: {
          tops: topCoverage,
          shoes: shoeCoverage
        },
        shownPieceCount,
        suppressedCount: suppressedPieces.length,
        suppressedReasonCounts,
        weatherProfile,
        savedMainBypassedSuppression,
        savedMainSuppressionReasons: savedMainSuppression?.reasons || [],
        savedSourceHasLayeredTopFormula,
        aiReturnedCount: Array.isArray(parsed?.outfits) ? parsed.outfits.length : 0,
        locallyGeneratedCount: localBackfillOutfits.length,
        finalReturnedCount: structuredOutfits.length,
        deliveredCount,
        brokenCardCount: structuredOutfits.filter(outfit => outfit.broken).length,
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
        activityCoverageGaps: rosterDebug.activityCoverageGaps || [],
        activityTagEnforcedGroups: rosterDebug.activityTagEnforcedGroups || [],
        registerCeiling: rosterDebug.registerCeiling,
        registerTarget: rosterDebug.registerTarget,
        registerTargetCoverageGaps: rosterDebug.registerTargetCoverageGaps || [],
        registerTargetEnforcedGroups: rosterDebug.registerTargetEnforcedGroups || [],
        formalityIntent: rosterDebug.formalityIntent,
        postGatePoolSize: rosterDebug.postGatePoolSize,
        capApplied: rosterDebug.capApplied,
        capCutPieces: rosterDebug.capCutPieces,
        slotCoverage: rosterDebug.slotCoverage,
        excluded,
        resolvedActivity: rosterDebug.resolvedActivity,
        activitySource: rosterDebug.activitySource,
        walkable: rosterDebug.walkable,
        rosterCounts: rosterDebug.categoryCounts,
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
        })(),
        unresolvedReferences,
        unresolvedReferencesCount: unresolvedReferences.length
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
        system: prompts.OUTFIT_BOARD_PLANNER_SYSTEM,
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

router.post('/generate-saved-outfit-variants', async (req, res) => {
  const { outfit = {}, pieceIds = [], mainPieceId = null, occasion = 'casual', season = 'current season', mode = 'formula', activity = '' } = req.body || {}
  try {
    const savedRow = outfit.id ? db.prepare('SELECT * FROM outfits WHERE id = ?').get(outfit.id) : null
    const savedOutfit = savedRow ? { ...savedRow, ...outfit } : outfit
    let ids = [...new Set((Array.isArray(pieceIds) && pieceIds.length ? pieceIds : savedOutfit.pieceIds || [])
      .map(Number)
      .filter(Boolean))]
      .slice(0, 8)
    if (!ids.length && savedOutfit.id) {
      ids = getLinkedPiecesForOutfit(savedOutfit.id).map(piece => Number(piece.id)).filter(Boolean).slice(0, 8)
    }
    if (ids.length < 2) return res.status(400).json({ error: 'At least two linked wardrobe pieces are required to infer a saved outfit formula' })

    const selectedMainPieceId = Number(mainPieceId || savedOutfit.mainPieceId || savedOutfit.main_piece_id) || null
    if (selectedMainPieceId && !ids.includes(selectedMainPieceId)) {
      return res.status(400).json({ error: 'The selected Main piece is no longer linked to this outfit' })
    }
    const variantMode = mode === 'adjacent' ? 'adjacent' : 'formula'
    const requestedSeason = String(season || '').trim()
    const sourceSeason = requestedSeason && requestedSeason !== 'current season'
      ? requestedSeason
      : (savedOutfit.season || requestedSeason || 'current season')
    const sourceOutfit = {
      id: savedOutfit.id || null,
      name: savedOutfit.name || savedOutfit.label || savedOutfit.title || 'Saved outfit',
      label: savedOutfit.label || savedOutfit.name || savedOutfit.title || 'Saved outfit',
      photo: savedOutfit.photo || '',
      occasion: savedOutfit.occasion || occasion,
      season: sourceSeason,
      notes: savedOutfit.notes || savedOutfit.reason || '',
      pieceIds: ids,
      mainPieceId: selectedMainPieceId,
      mode: variantMode
    }
    const result = await generateWholeWardrobeOutfitsVisualInternal({
      occasion: sourceOutfit.occasion,
      season: sourceOutfit.season,
      limit: 3,
      explorationMode: variantMode === 'adjacent' ? 'adventurous' : 'moderate',
      question: variantMode === 'adjacent'
        ? 'Explore adjacent outfits from this saved look using only my wardrobe.'
        : 'Create formula-similar versions of this saved look using only my wardrobe.',
      request: variantMode === 'adjacent'
        ? 'Preserve the style neighborhood and Main piece while exploring adjacent formulas.'
        : 'Preserve the saved outfit formula and Main piece while substituting owned wardrobe pieces.',
      activity,
      savedOutfitSeed: sourceOutfit
    })
    res.json({
      ...result,
      sourceOutfit,
      debug: {
        ...result.debug,
        savedOutfitVariantMode: variantMode,
        sourcePieceIds: ids,
        mainPieceId: selectedMainPieceId
      }
    })
  } catch (err) {
    console.error('Generate saved outfit wardrobe variants error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/generate-wardrobe-outfit-image', async (req, res) => {
  const { outfit = {}, pieceIds = [], occasion = 'casual', season = 'current season', renderMode = '' } = req.body || {}
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

    const rendered = await createWholeWardrobeOutfitImage({ outfit, pieces, occasion, season, index: 1, forceAi: renderMode === 'ai' })
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
  const { outfit = {}, pieceIds = [], mainPieceId = null, occasion = 'casual', season = 'current season', variantMode = 'similar' } = req.body || {}
  try {
    const mode = variantMode === 'creative' ? 'creative' : 'similar'
    let savedOutfit = outfit
    if (outfit.id) {
      const row = db.prepare('SELECT * FROM outfits WHERE id = ?').get(outfit.id)
      if (row) savedOutfit = { ...row, ...outfit }
    }
    let ids = [...new Set((Array.isArray(pieceIds) && pieceIds.length ? pieceIds : outfit.pieceIds || [])
      .map(Number)
      .filter(Boolean))]
      .slice(0, 6)
    let pieces = []
    if (ids.length) {
      const rows = db.prepare(`SELECT * FROM pieces WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(parsePiece)
      const byId = new Map(rows.map(piece => [Number(piece.id), piece]))
      pieces = ids.map(id => byId.get(id)).filter(Boolean)
    } else if (savedOutfit.id) {
      pieces = getLinkedPiecesForOutfit(savedOutfit.id).slice(0, 6)
      ids = pieces.map(piece => Number(piece.id)).filter(Boolean)
    }
    if (!ids.length) return res.status(400).json({ error: 'No linked wardrobe pieces were found for this outfit' })

    if (pieces.length < 2) return res.status(400).json({ error: 'At least two linked wardrobe pieces are required' })

    const selectedMainPieceId = Number(mainPieceId || savedOutfit.mainPieceId || savedOutfit.main_piece_id || outfit.mainPieceId || outfit.main_piece_id) || null
    const rendered = await createSavedOutfitImage({ outfit: { ...savedOutfit, mainPieceId: selectedMainPieceId }, pieces, occasion, season, index: 1, variantMode: mode })
    const boards = [{
      label: mode === 'creative' ? 'Creative outfit alternatives' : 'Similar outfit variants',
      reason: mode === 'creative'
        ? 'One image-generation call produced three exploratory outfit alternatives from the saved outfit photo and linked garment references.'
        : 'One image-generation call produced three adjacent outfit variants from the saved outfit photo and linked garment references.',
      watchFor: mode === 'creative'
        ? 'The alternatives should explore different formulas without turning into random novelty.'
        : 'The variants should feel like the same person on a different day, not tiny styling tweaks.',
      pieces: pieces.map(p => ({ id: p.id, name: p.name, category: wardrobeCategoryGroup(p), photo: p.photo || null, worn_photo: p.worn_photo || null })),
      imageUrl: rendered.imageUrl,
      debug: { timings: rendered.timings, renderer: rendered.renderer },
      savedOutfit: true,
      variant: true,
      variantMode: mode,
      mainPieceId: selectedMainPieceId
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
  const tempPath = req.file ? path.join(userUploadsDir(), req.file.filename) : ''
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
      const filePath = path.join(userUploadsDir(), photoFile)
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
      const seedFilePath = path.join(userUploadsDir(), path.basename(seedImageUrl))
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
      system: prompts.EDITORIAL_NEW_PIECES_SYSTEM,
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
      const filePath = path.join(userUploadsDir(), outfit.photo)
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
      `Question: ${question || `Which outfit works better for ${prompts.PROFILE_NAME}?`}`,
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
      confirmedOutfitsText ? `Other confirmed outfit memory for ${prompts.PROFILE_NAME}'s taste filter:\n${confirmedOutfitsText}` : '',
      '',
      `Comparison instruction: make a call if one outfit is clearly stronger. If both work, explain the different use cases. If neither works, identify the shared issue. Do not give a vague "both are nice" answer.`
    ].filter(Boolean).join('\n') })

    const answer = await askStylist({
      system: prompts.COMPARE_OUTFITS_SYSTEM,
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
// 2026-07-10: server-side default, deliberately not left to the model to infer (see the timezone-as-
// location bug this replaced). Only used as a fallback when the conversation hasn't already
// established a real place — an explicitly named destination always takes priority.
function getHomeLocation() {
  try {
    const row = db.prepare("SELECT value FROM app_meta WHERE key = 'home_location'").get()
    return row?.value || ''
  } catch {
    return ''
  }
}

router.post('/ask', async (req, res) => {
  try {
    const extractedWeather = req.body.weather || extractWeatherContext([
      req.body.question || '',
      req.body.threadContext || '',
      req.body.generatedContext || ''
    ].join('\n'))
    const toolContext = {
      generatedOutfits: [],
      source: 'whole_wardrobe',
      occasion: req.body.occasion || 'casual',
      season: req.body.season || 'current season',
      weather: extractedWeather,
      mood: req.body.mood || '',
      mission: req.body.mission || 'mix',
      activity: req.body.activity || '',
      question: req.body.question || '',
      // 2026-07-10: home location is a pure fallback — an explicitly named place from this turn's
      // question (extracted by the model as search_wardrobe's own `location` arg) or an already-
      // established req.body.location both still take priority over it, per tools.js's merge order.
      location: req.body.location || getHomeLocation(),
      currentDate: req.body.currentDate || '',
      // Step 3 (retrieval rule): per-turn tracking of which piece ids the model
      // retrieved / actually saw — enforced by propose_outfit and the prose
      // citation check in applyFreeformOutputChecks.
      retrievedPieceIds: new Set(),
      visuallySeenPieceIds: new Set(),
      // Step 4 (model-declared intent): set by the declare_intent tool; guards
      // and composing tools consume it instead of keyword-guessing.
      declaredIntent: null
    }
    const payload = await buildStylistConversationPayload({
      ...req.body,
      occasion: req.body.occasion,
      season: req.body.season,
      activity: req.body.activity
    })
    // Pieces already inside verified cards — the thread's current outfit set —
    // count as verified for citation purposes.
    toolContext.currentOutfitSet = payload.threadState?.current_outfit_set || []
    toolContext.knownOutfitPieceIds = [...new Set(
      (payload.threadState?.current_outfit_set || []).flatMap(outfit => Array.isArray(outfit?.piece_ids) ? outfit.piece_ids : [])
        .map(Number).filter(Boolean)
    )]
    const { answer, savedCorrections } = await askStylistWithTools({
      ...payload,
      toolContext
    })
    const allSaved = [...(savedCorrections || [])]
    if (payload.automaticallySavedCorrection) {
      allSaved.push(payload.automaticallySavedCorrection)
    }

    const isTravel = isTravelOrPackingRequest(req.body.question || '', req.body.occasion || '')
    let suggestedTitle = null
    // A trip-shaped title from a set the model planned itself via the
    // plan_outfit_set tool.
    const titledOutfits = toolContext.source === 'plan_outfit_set' && Array.isArray(toolContext.generatedOutfits)
      ? toolContext.generatedOutfits
      : []
    if (isTravel && titledOutfits.length) {
      suggestedTitle = deriveTripTitle(req.body.question || '', extractedWeather, titledOutfits)
    }

    // Spec 3: log this turn's freeform diagnostics (gate exclusions, propose_outfit validation
    // pass/fail) and surface a summary in the response so a proposal's "what got filtered/rejected"
    // is inspectable, mirroring the composer's excludedCounts debug.
    const freeformDiagnostics = toolContext.freeformDiagnostics || null
    persistFreeformGenerationRun({
      sessionId: req.body.sessionId || '',
      occasion: toolContext.occasion,
      diagnostics: freeformDiagnostics || {}
    })

    res.json({
      answer,
      savedCorrections: allSaved,
      renderedBoards: Array.isArray(toolContext.renderedBoards) ? toolContext.renderedBoards : [],
      provider: AI_PROVIDER,
      structuredOutfits: toolContext.generatedOutfits,
      structuredOutfitsSource: toolContext.source,
      structuredOutfitsOccasion: toolContext.occasion,
      structuredOutfitsSeason: toolContext.season,
      structuredOutfitsMood: toolContext.mood,
      structuredOutfitsMission: toolContext.mission,
      structuredOutfitsActivity: toolContext.activity,
      debug: freeformDiagnostics,
      suggestedTitle
    })
  } catch (err) {
    console.error('AI error:', err)
    const { status, message } = describeAiError(err)
    res.status(status).json({ error: message })
  }
})

export default router
