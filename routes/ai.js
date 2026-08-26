import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import OpenAI, { toFile } from 'openai'
import { db, userUploadsDir, safeJsonParse, parsePiece } from '../db.js'
import { colorTaggerInstruction, sanitizeTaggerColors } from '../lib/colorTaxonomy.js'
import { queueColorTaxonomyReviews } from '../lib/colorTaxonomyReview.js'
import { applyTaggerResult, buildAnchorBlock, normalizeConfidenceMap, normalizePhotoProperties, normalizeFiberContent, normalizeFormality, normalizeHeelHeight, normalizeWalkSupport, normalizeOuterwearRole, normalizeWeatherProtection, tagStateForTaggerResult, normalizeManualOverrides } from '../styling-engine/taggerMerge.js'

import {
  prepareImageForClaude,
  prepareWardrobeThumb,
  contentToOpenAI,
  askStylist,
  askStylistWithUsage,
  askStylistStructuredWithUsage,
  askStylistWithTools,
  routeFreeformExecutionProfile,
  boundedAtomicMultiLookResponse,
  stripPieceIdCitations,
  recordToolLoopUsage,
  estimateAiUsageCost,
  parseModelJson,
  salvageFirstJson,
  PROMPT_CACHE_BREAKPOINT,
  AI_PROVIDER,
  ACTIVE_STYLIST_MODEL,
  ANTHROPIC_MODEL,
  ANTHROPIC_TAGGER_MODEL,
  describeAiError
} from '../styling-engine/provider.js'

import {
  applyComfortFootwearRepair,
  ACTIVITY_PROFILES
} from '../styling-engine/footwear-comfort.js'

import {
  prompts,
  STYLE_SELECTED_ITEM_FEW_SHOTS,
  OUTFIT_MISSIONS,
  TAG_PIECE_SYSTEM,
  EXTRACT_PIECES_SYSTEM
} from '../styling-engine/promptRuntime.js'
import { validateSubmittedPlanOutfits, describeOutfitStructureGap, capsuleNeutralBasePlan, capsuleOutfitCoreCapacity } from '../styling-engine/outfitSetPlanner.js'

import { OCCASION_PROFILES } from '../styling-engine/occasions.js'
import { colorFamilyLabel, colorTaxonomyEntry } from '../lib/colorTaxonomy.js'
import {
  garmentKind,
  pieceMatchesMaterial,
  pieceMatchesFootwear,
  pieceRequiresBaseLayer,
  pieceVisualDetailPolicy
} from '../styling-engine/attributes.js'
import {
  extractWeatherContext,
  isTravelOrPackingRequest,
  normalizeActivity,
  normalizeOccasion
} from '../styling-engine/stylingIntent.js'
import { serializeWeatherProfile, restoreWeatherProfile } from '../styling-engine/weather.js'
import { projectStylingApplicabilityContext, resolveStylingContext } from '../styling-engine/stylingContext.js'

import { storeUserCorrection, executeTool, bumpFreeformDiagnostic, recordFreeformToolIteration, nextFreeformCallIndex } from '../styling-engine/tools.js'
import { detectExplicitProhibition, describeOwnerGuidanceScope } from '../lib/ownerGuidance.js'
import { updateAiTelemetryContext, backfillFreeformRunId, normalizeTaggerSource, getAiTelemetryContext, runWithAiTelemetryContext } from '../lib/aiCallTelemetry.js'
import { randomUUID } from 'node:crypto'

import {
  isStyleSelectedQuestion,
  complementaryWardrobeFor,
  categoryConstraintForSelectedPiece,
  idealAdditionAnchorConstraint,
  getRecentWholeWardrobeSessionInfluence,
  buildWholeWardrobeCandidateOutfits,
  wholeWardrobeCandidateFormulaCounts,
  wholeWardrobeFormulaFamily,
  wholeWardrobeArchetypeFor,
  saveWholeWardrobeSession,
  getOutfitsForPieceMemory,
  getStylistFeedbackMemory,
  getProvisionalWrongChoiceMemory,
  getExactOutfitReactionMemory,
  getAcceptedFeedbackSynthesisMemory,
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
  sanitizeWholeWardrobeOutfitProse,
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
  rewriteWholeWardrobeOutfitWithArchetype,
  hasWholeWardrobePlaceholder,
  hasGenericWholeWardrobeText,
  sortByStylisticStrength,
  pieceGarmentIntelligence,
  wholeWardrobeOutfitVisualReviewFindings
} from '../styling-engine/rules.js'
import {
  evaluateAutomaticUsePiecePool,
  evaluateVisualComposerPiecePool,
  selectAutomaticUseCandidatesForOutfitGeneration,
} from '../styling-engine/eligibility.js'
import { categoryOutfitStructurePromptRule, evaluateWearableOutfit } from '../styling-engine/outfitValidation.js'
import { projectCandidateSetShortfall } from '../styling-engine/candidateSet.js'
import { discloseRecoveryShortfall, validatedComplete, validatedFallback, validatedSubstitute } from '../styling-engine/recovery.js'
import { normalizeDeliveredOutfit, normalizeOutfitResult } from '../styling-engine/outfitResult.js'

import {
  rankSelectedPieceCandidatesWithVision,
  composeStructuredOutfitsForPiece,
  buildLocalFallbackOutfitDirections,
  validateSelectedRecoveryOutfit,
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
  buildStylistConversationPayload,
  normalizeCalibrationRow,
  withTimeout,
  visualComposerMaxTokensForOutfitCount,
  getCalibrationMemoryForStylist,
  getCalibrationReferenceImagesForGeneration,
  runGPT4oImageGeneration,
  runOpenAIImageGeneration,
  getOpenAIImageSize,
  anchorFidelityInstructions,
  createPhotoPreservingCollageImage,
  ownedInventorySummaryForEditorial,
  reviewComposedWholeWardrobeOutfitsForClash
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

// docs/tagger-cost-spec.md §6b/§6c: standard tagging (add/edit/retag) defaults to the cheaper
// tagger tier — screened cold-start and warm-anchored, no material regression found. Callers that
// need the full stylist model (currently: routes/importer.js, whose crop/fallback-photo
// distribution was never screened) must pass `model` explicitly to override this default.
export async function tagPieceWithProvider(photoInputs, existingPiece = null, { onUsage, model = (AI_PROVIDER === 'openai' ? null : ANTHROPIC_TAGGER_MODEL), excludeAnchorPieceId } = {}) {
  // Snapshot the request's AsyncLocalStorage telemetry context (flow, tagger_source, etc.) right
  // at entry, then re-apply it in a fresh frame directly around the provider call below. Found
  // live in a Batch Add run (2026-08-24): 3 of 5 sequential tag calls landed with
  // flow=unattributed/tagger_source='' even though the route handler set taggerSource correctly
  // before calling this function. NOT root-caused: four escalating local repros (plain sharp
  // fan-out matching the per-photo/anchor-thumbnail shape below, real Express+multer+sharp, the
  // actual patched SDK transport, and a ~2.5s simulated model-latency version of all of the
  // above) all failed to reproduce the loss, so "heavy async fan-out breaks ALS" is disproven as
  // the mechanism, not confirmed. This re-snapshot is defensive hardening, not a verified fix —
  // see the console.warn breadcrumbs in lib/aiCallTelemetry.js (updateAiTelemetryContext and
  // logAiCall) for whatever the next real occurrence actually reveals.
  const telemetrySnapshot = { ...getAiTelemetryContext() }
  const inputs = Array.isArray(photoInputs) ? photoInputs : [{ path: photoInputs, label: 'HANGER PHOTO' }]
  const prepared = await Promise.all(inputs.map(async input => ({
    ...input,
    ...(await prepareImageForClaude(input.path))
  })))
  // Stable prefix first: the fully static instructions (~5,290 tok), then the wardrobe-calibration
  // anchors (wardrobe-state-dependent, but stable across an entire tagging session/import batch).
  // Anthropic prompt caching only helps a contiguous prefix from position 0, so this must come
  // before any per-piece content (photo, ground-truth overrides) — previously the photo was
  // pushed first, which meant nothing in this call was ever cacheable no matter what carried
  // cache_control. See docs/tagger-audit-findings.md Q5.
  const content = [{ type: 'text', text: prompts.TAG_PIECE_PROMPT }]

  const anchorPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active' ORDER BY id").all().map(parsePiece)
  const anchorBlock = buildAnchorBlock({
    pieces: excludeAnchorPieceId
      ? anchorPieces.filter(p => Number(p.id) !== Number(excludeAnchorPieceId))
      : anchorPieces,
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

  // Mark the end of the stable prefix: everything above must stay byte-identical across calls in
  // the same session for a cache hit; everything below is per-piece and always volatile.
  // toAnthropicContentBlocks (provider.js) preserves cache_control on text/image blocks verbatim.
  content[content.length - 1] = { ...content[content.length - 1], cache_control: { type: 'ephemeral' } }

  for (const input of prepared) {
    content.push({ type: 'text', text: `IMAGE INPUT - [${input.label}]:\nGuidance: ${input.guidance || ''}` })
    content.push({ type: 'image', source: { type: 'base64', media_type: input.mime, data: input.base64 } })
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

  const payload = {
    // Cache structure belongs to the provider request, not the frozen semantic
    // prompt constant guarded by prompt_equivalence.test.js.
    system: `${TAG_PIECE_SYSTEM}${PROMPT_CACHE_BREAKPOINT}`,
    // Spec 26 Part 7: the full tag schema was truncating mid-JSON
    // ("Unterminated string in JSON at position 5084") at the prior cap —
    // spec 22 fixed the 400 the truncated body caused on the Anthropic
    // path, but the underlying truncation itself was still live.
    maxTokens: 2500,
    ...(model ? { model } : {}),
    messages: [{
      role: 'user',
      content
    }]
  }

  // Latency + cache-hit logging: no instrumentation existed for tag calls before this (unlike
  // outfit generation's generation_runs / freeform_generation_runs tables) despite this being one
  // of the largest, slowest call shapes in the app (~7-10k input tokens, up to 2500 output, full
  // stylist model, one or two images). Console-only for now, not persisted — this answers "is it
  // actually slow, and is the caching fix from this session actually landing" without a schema
  // change; promote to a real table if it turns out to be worth tracking over time.
  const tagCallStartedAt = Date.now()
  const { text: raw, usage } = await runWithAiTelemetryContext(telemetrySnapshot, () => askStylistWithUsage(payload))
  const tagCallMs = Date.now() - tagCallStartedAt
  const cacheReadTokens = usage?.cacheReadInputTokens || 0
  const cacheCreationTokens = usage?.cacheCreationInputTokens || 0
  const cacheStatus = cacheReadTokens > 0
    ? `HIT (${cacheReadTokens} tok read from cache)`
    : cacheCreationTokens > 0
      ? `MISS, wrote ${cacheCreationTokens} tok to cache`
      : 'no cache activity reported'
  console.log(`[Tag Piece] provider call took ${tagCallMs}ms — input ${usage?.inputTokens ?? '?'} tok, output ${usage?.outputTokens ?? '?'} tok, cache: ${cacheStatus}`)
  if (onUsage && usage) onUsage(usage)
  console.log('[Tag Piece] RAW RESPONSE LENGTH:', raw?.length, 'RAW RESPONSE:', raw)
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
    tags.outerwear_role = normalizeOuterwearRole(tags.outerwear_role)
    tags.weather_protection = normalizeWeatherProtection(tags.weather_protection)
    tags.style_profile_json = {
      ...(tags.style_profile_json || {}),
      _confidence: confidence,
      photo_properties: photoProperties
    }
    tags._confidence = confidence
    tags.photo_properties = photoProperties
  }
  console.log('[Tag Piece] Final normalized tags:', JSON.stringify(tags, null, 2))
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
export function persistFreeformGenerationRun({ sessionId = '', occasion = '', diagnostics = {}, turnFailed = false, freeformTurnToken = '' } = {}) {
  try {
    const info = db.prepare(`
      INSERT INTO freeform_generation_runs (session_id, occasion, search_calls, gate_excluded_total, propose_calls, propose_validation_fails, outfit_prose_without_tool_count, zero_result_contradiction_blocks, card_prose_inconsistent_blocks, atomic_multi_look_calls, execution_router_calls, tool_sequence, destination_clarification_retries, plan_slot_environment_inferred, plan_slot_activity_inferred, submit_plan_calls, submit_plan_validation_fails, submit_plan_resubmits, submit_plan_partial_accepts, capsule_final_fallbacks, capsule_supply_gaps, capsule_looks_auto_completed, capsule_roster_model_calls, capsule_roster_model_repairs, capsule_roster_model_fallbacks, capsule_roster_failure_codes, turn_failed, provider_iterations, provider_input_tokens, provider_output_tokens, provider_cache_read_input_tokens, provider_cache_creation_input_tokens, weather_source, history_messages_received, history_messages_included, history_chars_removed, execution_profile)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId || '',
      occasion || '',
      Number(diagnostics.searchCalls) || 0,
      Number(diagnostics.gateExcludedTotal) || 0,
      Number(diagnostics.proposeCalls) || 0,
      Number(diagnostics.proposeValidationFails) || 0,
      Number(diagnostics.outfitProseWithoutToolCall) || 0,
      Number(diagnostics.zeroResultContradictionBlocks) || 0,
      Number(diagnostics.cardProseInconsistentBlocks) || 0,
      Number(diagnostics.atomicMultiLookCalls) || 0,
      Number(diagnostics.executionRouterCalls) || 0,
      String(diagnostics.toolSequence || ''),
      Number(diagnostics.destinationClarificationRetries) || 0,
      Number(diagnostics.planSlotEnvironmentInferred) || 0,
      Number(diagnostics.planSlotActivityInferred) || 0,
      Number(diagnostics.submitPlanCalls) || 0,
      Number(diagnostics.submitPlanValidationFails) || 0,
      Number(diagnostics.submitPlanResubmits) || 0,
      Number(diagnostics.submitPlanPartialAccepts) || 0,
      Number(diagnostics.capsuleFinalFallbacks) || 0,
      Number(diagnostics.capsuleSupplyGaps) || 0,
      Number(diagnostics.capsuleLooksAutoCompleted) || 0,
      Number(diagnostics.capsuleRosterModelCalls) || 0,
      Number(diagnostics.capsuleRosterModelRepairs) || 0,
      Number(diagnostics.capsuleRosterModelFallbacks) || 0,
      // Codes only, never the messages: the messages name garments, and this
      // table is a diagnostic, not a second copy of the wardrobe.
      String(diagnostics.capsuleRosterFailureCodes || ''),
      turnFailed ? 1 : 0,
      Number(diagnostics.providerIterations) || 0,
      Number(diagnostics.providerInputTokens) || 0,
      Number(diagnostics.providerOutputTokens) || 0,
      Number(diagnostics.providerCacheReadInputTokens) || 0,
      Number(diagnostics.providerCacheCreationInputTokens) || 0,
      diagnostics.weatherSource || '',
      Number(diagnostics.historyMessagesReceived) || 0,
      Number(diagnostics.historyMessagesIncluded) || 0,
      Number(diagnostics.historyCharsRemoved) || 0,
      diagnostics.executionProfile || ''
    )
    // Every ai_call_log row this turn's provider calls wrote already carries freeformTurnToken
    // (staged before each call, before this row's real id existed). Correlate them now in one
    // UPDATE rather than holding this insert open across the whole turn.
    const resolvedToken = freeformTurnToken || diagnostics.freeformTurnToken || ''
    if (resolvedToken) {
      backfillFreeformRunId({ freeformTurnToken: resolvedToken, freeformRunId: info.lastInsertRowid })
    }
  } catch (err) {
    console.warn('Failed to persist freeform generation run:', err.message)
  }
}

export function boundedConversationStateFromToolContext(toolContext = {}) {
  const outfits = Array.isArray(toolContext?.generatedOutfits) ? toolContext.generatedOutfits : []
  const currentOutfitSet = outfits.slice(0, 8).map((outfit, index) => ({
    index: index + 1,
    label: outfit?.label || outfit?.title || `Outfit ${index + 1}`,
    ...(outfit?.occasion ? { occasion: outfit.occasion } : {}),
    ...(outfit?.activity ? { activity: outfit.activity } : {}),
    ...(outfit?.dominantDirection ? { direction: outfit.dominantDirection } : {}),
    ...(outfit?.silhouette ? { silhouette: outfit.silhouette } : {}),
    ...(outfit?.reason ? { reason: outfit.reason } : {}),
    ...(outfit?.stylingInstructions ? { styling_instructions: outfit.stylingInstructions } : {}),
    ...(outfit?.watchFor ? { watch_for: outfit.watchFor } : {}),
    piece_ids: (Array.isArray(outfit?.pieceIds) && outfit.pieceIds.length
      ? outfit.pieceIds
      : (Array.isArray(outfit?.pieces) ? outfit.pieces.map(piece => piece?.id) : [])
    ).map(Number).filter(Boolean),
    pieces: (Array.isArray(outfit?.pieces) ? outfit.pieces : []).map(piece => piece?.name).filter(Boolean)
  }))
  const established = {
    ...(toolContext?.occasion ? { occasion: toolContext.occasion } : {}),
    ...(toolContext?.activity ? { activity: toolContext.activity } : {}),
    ...(toolContext?.season ? { season: toolContext.season } : {}),
    ...(toolContext?.mood ? { mood: toolContext.mood } : {}),
    ...(toolContext?.mission ? { mission: toolContext.mission } : {}),
    ...(toolContext?.boundedLocation ? { location: toolContext.boundedLocation } : {}),
    ...(toolContext?.boundedWeatherSummary ? { weather: toolContext.boundedWeatherSummary } : {}),
    ...(toolContext?.boundedWeatherUnavailable ? { weather_resolution: 'forecast unavailable; do not infer temperature' } : {})
  }
  return {
    established,
    ...(serializeWeatherProfile(toolContext?.weatherProfile) ? { weather_profile: serializeWeatherProfile(toolContext.weatherProfile) } : {}),
    ...(currentOutfitSet.length ? { current_outfit_set: currentOutfitSet } : {})
  }
}

export function compactFreeformAnswerSystem(profile = 'general_advice') {
  const profileContract = profile === 'existing_card_explanation'
    ? 'Explain or compare only the supplied verified outfit cards. Do not change pieces, invent alternatives, or claim to see photographs.'
    : profile === 'garment_fact'
      ? 'Answer only from the supplied structured garment evidence and any supplied saved photographs. Do not invent construction, fit, comfort, ownership, or additional garments. Do not compose an outfit. Saved tags are evidence, not infallible: manual/high confidence is strong; missing/low confidence permits cautious inference from the other supplied construction fields and any supplied saved photographs. A worn photograph showing the requested configuration proves only that the configuration is physically possible; judge its visible styling result separately. Give a direct, respectful styling judgment about the visible garment-and-body interaction when the photograph supports one: if the shown tuck fights the wearer\'s proportions, say that it is not the strongest presentation and explain the visible proportion effect. Do not call the shown configuration flattering or preferred merely because it is possible. Do not pretend an unseen alternative is proven better; recommend trying it as the likely stronger option or ask for a comparison photograph. Keep an unseen alternative mechanically simple and adjacent to what was shown: for a full-tuck question, compare fully untucked before proposing a partial, French, asymmetric, folded, or otherwise more elaborate tuck, unless supplied evidence specifically supports that treatment. Do not invent a hidden cause, diagnose the wearer\'s body, or turn one photographed interaction into a universal body rule. If evidence conflicts, explain the practical conflict naturally and prefer clearly visible garment behavior over a weak or missing tag. Photographs may show drape, bulk, texture and visible behavior, but cannot establish exact fiber composition; if fiber is not supplied, describe only its visible behavior and do not guess cotton, wool, viscose, modal or a blend. Never infer tuckability from hem shape alone. If saved photographs are supplied, do not ask the user to upload a photograph you already have. Speak as a stylist, not as a database inspector: never expose field names, snake_case keys, enum values, JSON notation, backticks, or confidence labels such as manual/high/low. Translate the evidence into ordinary garment language (for example, say “this fitted tee can be tucked,” never “tuck_behavior is tucks_anywhere”).'
      : 'Give general styling education only. Do not imply that you inspected the wardrobe or recommend a specific owned garment. Explain dress codes and styling concepts through multiple valid pathways. Present structure, fabric, finish, cohesion, accessories, and footwear as optional signals whose effect depends on the whole outfit—not mandatory ingredients. Distinguish common tendencies from requirements, avoid status-loaded contrasts such as “real” versus lesser accessories, and never treat casual clothing as inherently careless, shapeless, or confined to errands. Say briefly when a wardrobe-specific answer would require looking at the pieces.'
  return `You are a concise personal stylist answering one bounded text question. ${profileContract}

RATIFIED STYLE CONSTITUTION:
${prompts.BODY_CONTRACT}
${prompts.PROVEN_FORMULAS}
${prompts.AESTHETIC_GRAVITY}
${prompts.LANE_NEUTRALITY}
${prompts.WORKING_STYLE}`
}

export function compactFreeformPieceFacts(piece = {}) {
  return {
    id: Number(piece.id),
    name: piece.name,
    category: piece.category,
    colors: piece.colors,
    fabric_category: piece.fabric_category,
    fabric_weight: piece.fabric_weight,
    opacity: piece.opacity,
    needs_base: piece.needs_base,
    tuck_behavior: piece.tuck_behavior,
    hem_finish: piece.hem_finish,
    sleeve_length: piece.sleeve_length,
    length_hits_at: piece.length_hits_at,
    silhouette: piece.silhouette,
    waistband_type: piece.waistband_type,
    formality: piece.formality,
    heel_height: piece.heel_height,
    walk_support: piece.walk_support,
    occasions: piece.occasions,
    reads_as: piece.reads_as,
    styling_rules_learned: piece.styling_rules_learned,
    field_confidence: piece.style_profile_json?._confidence || {},
  }
}

export function exactNamedPieceIdsFromQuestion(question = '', pieces = []) {
  const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const request = normalize(question)
  const matches = (Array.isArray(pieces) ? pieces : [])
    .filter(piece => {
      const name = normalize(piece?.name)
      return name.length >= 6 && request.includes(name)
    })
  return matches.length === 1 ? [Number(matches[0].id)].filter(Boolean) : []
}

// A user citing "ID 127" is naming a garment as precisely as a name match would, but no name text
// is present for exactNamedPieceIdsFromQuestion to find. Every distinct numeral is returned here,
// resolved or not — compactGarmentFactSubjectsIncomplete below needs the unresolved ones too, to
// tell "the user cited one garment" apart from "the user cited two and only one exists."
export function explicitPieceIdMentionsFromQuestion(question = '') {
  const matches = [...String(question || '').matchAll(/\bID\s*#?\s*(\d+)\b/gi)]
  return [...new Set(matches.map(match => Number(match[1])).filter(Number.isFinite))]
}

// garment_fact compares supplied subjects; a question naming two garments by ID where only one
// resolves to an active piece is missing half its evidence, not answerable-with-a-caveat. Scoped to
// explicit ID citations only — the failure this guards against (routes/ai.js:4145) is a user typing
// "ID 127" for a piece never in the current outfit set, not the pre-existing ambiguous-name-match
// miss in exactNamedPieceIdsFromQuestion, which is a separate, already-accepted gap.
export function compactGarmentFactSubjectsIncomplete(question = '', resolvedPieceIds = []) {
  const mentioned = explicitPieceIdMentionsFromQuestion(question)
  if (mentioned.length < 2) return false
  const resolvedSet = new Set((Array.isArray(resolvedPieceIds) ? resolvedPieceIds : []).map(Number))
  return mentioned.some(id => !resolvedSet.has(id))
}

// Last couple of exchanges only — enough for "what did you mean by that?" to resolve, not a second
// copy of the conversation. Originally scoped to existing_card_explanation for thread_1787387145601
// msg 5 (a question referring back to the model's OWN prior turn, unanswerable from outfit-card
// JSON alone). thread_1787435527800 msg 16 showed garment_fact needs the same window for a
// different reason — see recentReferentPieceIds below — so both profiles use it now; general_advice
// still doesn't, since it answers from general knowledge, not from what was just said.
export function compactRecentHistory(history = [], limit = 4) {
  const entries = (Array.isArray(history) ? history : [])
    .filter(entry => entry?.role === 'user' || entry?.role === 'assistant')
    .slice(-limit)
  if (!entries.length) return ''
  return entries.map(entry => `${entry.role}: ${String(entry.content || '').trim()}`).join('\n')
}

// A vague reference like "these shorts" or "this top" names a garment CATEGORY, not an exact piece
// or ID — exactNamedPieceIdsFromQuestion and explicitPieceIdMentionsFromQuestion both miss it, so it
// previously fell through to every piece across the whole accumulated current-card set (see
// compactFreeformContext). thread_1787435527800 msg 16 ("These shorts are a bit large") came one
// turn after msg 15 named "the tan shorts" specifically — the referent is almost always whatever the
// assistant most recently called by that same category word. Resolve against just the last exchange
// before falling back to the full card set; an ambiguous or absent match returns no override, and
// the existing fallback in compactFreeformContext still applies.
const GARMENT_CATEGORY_WORDS = ['shorts', 'pants', 'jeans', 'shoes', 'sneakers', 'sandals', 'boots', 'heels', 'flats', 'dress', 'skirt', 'jacket', 'cardigan', 'sweater', 'coat', 'vest', 'blouse', 'shirt', 'tee', 'tank', 'top', 'hoodie', 'blazer']
export function recentReferentPieceIds(question = '', history = [], pieces = []) {
  const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const questionNorm = normalize(question)
  const categoryWord = GARMENT_CATEGORY_WORDS.find(word => new RegExp(`\\b${word}\\b`).test(questionNorm))
  if (!categoryWord) return []
  const recentText = normalize(compactRecentHistory(history, 2))
  if (!recentText) return []
  const recentWords = new Set(recentText.split(' ').filter(Boolean))
  // Assistant prose abbreviates ("the tan shorts" for "tan straight shorts"), so an exact full-name
  // substring match misses the real case — allow at most one of the piece's other name words to be
  // absent from the recent exchange. Two candidates both fully present (both explicitly compared,
  // e.g. "the tan ones vs. the olive ones") tie and neither wins — genuinely ambiguous stays ambiguous.
  const candidates = (Array.isArray(pieces) ? pieces : [])
    .map(piece => {
      const nameWords = normalize(piece?.name).split(' ').filter(Boolean)
      if (!nameWords.includes(categoryWord)) return null
      const matchedCount = nameWords.filter(word => recentWords.has(word)).length
      if (matchedCount < 2 || nameWords.length - matchedCount > 1) return null
      return Number(piece.id)
    })
    .filter(id => Number.isFinite(id))
  return candidates.length === 1 ? candidates : []
}

// This is request-shape routing, not garment-semantic inference. It stays deliberately narrow:
// exact identity and saved visual evidence must already exist, while pairing, outfit-building,
// general fit critique, and ambiguous references remain with the full stylist.
export function isSavedPhotoWearMechanicsQuestion(question = '', { exactSubjectCount = 0, savedPhotoCount = 0 } = {}) {
  if (Number(exactSubjectCount) !== 1 || Number(savedPhotoCount) < 1) return false
  return /\b(?:tuck(?:ed|ing)?|untuck(?:ed|ing)?|half[- ]?tuck(?:ed|ing)?|french[- ]?tuck(?:ed|ing)?)\b/i.test(String(question || ''))
}

export function compactFreeformContext({ body = {}, state = {}, namedPieceIds = [] } = {}) {
  const bodyOutfits = Array.isArray(body.generatedOutfits) ? body.generatedOutfits : []
  const stateOutfits = Array.isArray(state.current_outfit_set) ? state.current_outfit_set : []
  // Server state is the verified authority. The browser echo remains a legacy fallback for
  // pre-bounded threads that have not yet written current_outfit_set.
  const outfits = stateOutfits.length ? stateOutfits : bodyOutfits
  const activePieceId = Number(body?.activeContext?.type === 'piece' ? body.activeContext.id : body?.pieceId)
  const pieceIds = [...new Set([
    ...(Number.isFinite(activePieceId) && activePieceId > 0 ? [activePieceId] : []),
    ...(Array.isArray(body.pieceIds) ? body.pieceIds : []),
    ...(Array.isArray(namedPieceIds) ? namedPieceIds : []),
    ...outfits.flatMap(outfit => Array.isArray(outfit?.pieceIds)
      ? outfit.pieceIds
      : (Array.isArray(outfit?.piece_ids) ? outfit.piece_ids : [])),
  ].map(Number).filter(Boolean))].slice(0, 16)
  return { outfits: outfits.slice(0, 8), pieceIds }
}

export function compactProfileHasContext(profile, context = {}) {
  if (profile === 'existing_card_explanation') return Boolean(context.outfits?.length)
  if (profile === 'garment_fact') return Boolean(context.pieceIds?.length)
  return profile === 'general_advice'
}

// Whether a turn can reach ANY compact profile, decided before the router is paid for. A fresh
// request can reach all of them; a verified current outfit set can reach existing_card_explanation;
// a resolved garment subject can reach garment_fact. compactFreeformContext already folds
// activeContext, body pieceIds, exact named pieces and current-card pieces into pieceIds, so the
// subject test covers every route to one.
//
// Known accepted miss: general_advice and wardrobe_inventory need no context at all, so a follow-up
// in a thread that never produced a card or a subject falls through to the full stylist. That is a
// deliberate trade rather than an oversight — general education is always answerable, so no turn is
// provably compact-ineligible and any narrowing is a heuristic. Measure before widening: rows with
// execution_router_calls = 0 AND search_calls = 0 are turns the full stylist answered without ever
// touching the wardrobe, which is the proxy for a missed compact turn.
export function compactRouterTurnHasContext(conversationMode = 'new_request', context = {}) {
  if (String(conversationMode || 'new_request') === 'new_request') return true
  return Boolean(context.outfits?.length) || Boolean(context.pieceIds?.length)
}

export function formatWardrobeInventoryAnswer(counts = {}) {
  const ordered = [
    ['top', 'Tops'],
    ['bottom', 'Bottoms'],
    ['dress', 'Dresses'],
    ['shoes', 'Shoes'],
    ['outerwear', 'Outerwear'],
    ['accessory', 'Accessories'],
    ['other', 'Other'],
  ]
  const rows = ordered
    .filter(([key]) => Number(counts[key]) > 0)
    .map(([key, label]) => `| ${label} | ${Number(counts[key])} |`)
  const total = Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0)
  return [
    'Here’s your active wardrobe breakdown:',
    '',
    '| Category | Count |',
    '|---|---:|',
    ...rows,
    `| **Total** | **${total}** |`,
  ].join('\n')
}

export function compactFreeformAnswerMessage({ profile, question = '', context = {}, pieces = [], state = {}, history = [] } = {}) {
  const recentHistory = (profile === 'existing_card_explanation' || profile === 'garment_fact') ? compactRecentHistory(history) : ''
  return [
    `Question: ${question}`,
    recentHistory ? `Recent conversation (most recent last):\n${recentHistory}` : '',
    profile === 'existing_card_explanation' && context.outfits?.length ? `Verified current cards:\n${JSON.stringify(context.outfits)}` : '',
    profile !== 'general_advice' && pieces.length ? `Authoritative garment facts:\n${JSON.stringify(pieces.map(compactFreeformPieceFacts))}` : '',
    profile !== 'general_advice' && state.established ? `Established context:\n${JSON.stringify(state.established)}` : ''
  ].filter(Boolean).join('\n\n')
}

export async function compactGarmentVisualEvidence(pieces = [], { uploadsDir = userUploadsDir(), maxImages = 4 } = {}) {
  const blocks = []
  const seenFiles = new Set()
  const boundedLimit = Math.max(0, Math.min(4, Number(maxImages) || 0))
  for (const piece of Array.isArray(pieces) ? pieces : []) {
    for (const [label, photoFile] of [['worn photo', piece?.worn_photo], ['hanger photo', piece?.photo]]) {
      if (blocks.filter(block => block.type === 'image').length >= boundedLimit) return blocks
      if (!photoFile || seenFiles.has(photoFile)) continue
      if (path.basename(photoFile) !== photoFile) continue
      const filePath = path.join(uploadsDir, photoFile)
      if (!fs.existsSync(filePath)) continue
      try {
        const thumb = await prepareWardrobeThumb(
          filePath,
          `compact-garment-fact:${piece.id}:${label}:${photoFile}`,
          { maxPx: 640 }
        )
        blocks.push(
          { type: 'text', text: `Saved ${label} for ${piece.name || `piece ${piece.id}`}:` },
          { type: 'image', detail: 'low', source: { type: 'base64', ...thumb } }
        )
        seenFiles.add(photoFile)
      } catch (err) {
        console.warn(`Failed to prepare compact garment evidence for piece ${piece?.id}:`, err.message)
      }
    }
  }
  return blocks
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

export const composerPieceLineSuffix = piece => {
  const doNotPairRules = pieceGarmentIntelligence(piece).doNotPairRules
  return `${piece.fabric_category ? `; fabric: ${piece.fabric_category}` : ''}` +
    `${piece.reads_as ? `; reads_as: ${piece.reads_as}` : ''}` +
    `${piece.opacity ? `; opacity: ${piece.opacity}` : ''}` +
    `${piece.fit_on_body ? `; fit_on_body: ${piece.fit_on_body}` : ''}` +
    `${piece.tuck_behavior ? `; tuck_behavior: ${piece.tuck_behavior}` : ''}` +
    `${piece.hem_finish ? `; hem_finish: ${piece.hem_finish}` : ''}` +
    `${piece.waistband_type ? `; waistband_type: ${piece.waistband_type}` : ''}` +
    `${piece.needs_base ? `; needs_base: ${piece.needs_base}` : ''}` +
    `${doNotPairRules.length ? `; do not pair: ${doNotPairRules.join(', ')}` : ''}`
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
  comfortConstraint = null,
  occasionProfile = null,
  activityProfile = null
}) {
  const routeStartedAt = Date.now()
  const selectedId = Number(selectedPiece.id)
  const supportCandidates = rankedCandidates
    .map(r => r?.piece)
    .filter(p => p && Number(p.id) !== selectedId)
  const candidatePool = [selectedPiece, ...supportCandidates]
  const poolById = new Map(candidatePool.map(p => [Number(p.id), p]))
  const poolEvaluation = evaluateVisualComposerPiecePool({
    pieces: candidatePool,
    context: { occasion, weatherProfile, mood, activity, requestText: question, question, occasionProfile, activityProfile },
    policy: { selectedPieceId: selectedId, maxImages: 54 },
  })
  const { eligiblePieces: candidatePieces, excludedPieces: excluded, debug: rosterDebug } = poolEvaluation
  const recoveryEvaluation = evaluateVisualComposerPiecePool({
    pieces: allPieces,
    context: { occasion, weatherProfile, mood, activity, requestText: question, question, occasionProfile, activityProfile },
    policy: {
      selectedPieceId: selectedId,
      includeAccessories: true,
      maxImages: Math.max(1, allPieces.length),
      recordMetadataTodos: false,
    },
  })
  const recoveryRankedCandidates = rankedCandidates.filter(candidate =>
    recoveryEvaluation.recoveryEligibleIds.has(Number(candidate?.piece?.id))
  )
  const structureShortfall = projectCandidateSetShortfall(rosterDebug.coverageReport, { anchorPiece: selectedPiece })
  if (structureShortfall) {
    const selectedDependencyValidation = pieceRequiresBaseLayer(selectedPiece)
      ? evaluateWearableOutfit([selectedPiece], { requireShoes: true })
      : null
    const dependencyFinding = selectedDependencyValidation?.hardFindings
      .find(finding => finding.kind === 'required_base') || null
    const incompleteAnchorCard = dependencyFinding
      ? normalizeOutfitResult({
          label: `${selectedPiece.name || 'Selected garment'} — Needs review`,
          title: `${selectedPiece.name || 'Selected garment'} — Needs review`,
          pieceIds: [Number(selectedPiece.id)],
          pieces: [selectedPiece],
          selectedPieceId: Number(selectedPiece.id),
          broken: true,
          diagnosticOnly: true,
          strength: 'needs review',
          rejectionReason: dependencyFinding.message,
          reason: 'The selected garment remains the premise, but the wardrobe does not currently prove a complete wearable outfit around it.',
          source: 'selected-anchor-incomplete',
        }, {
          disposition: 'rejected',
          findings: [dependencyFinding],
          provenance: { flow: 'selected_piece_visual', source: 'selected-anchor-incomplete', composedBy: 'engine', stage: 'candidate_supply' },
        })
      : null
    return {
      outfits: incompleteAnchorCard ? [incompleteAnchorCard] : [],
      recoveryEligiblePieces: recoveryEvaluation.recoveryEligiblePieces,
      rejected: [],
      skip: structureShortfall,
      saveableLearning: '',
      compositionSkipped: 'incomplete_candidate_supply',
      debug: {
        shownPieceCount: 0,
        rosterCount: candidatePieces.length,
        excludedCount: excluded.length,
        excludedCounts: rosterDebug.excludedCounts,
        registerCeiling: rosterDebug.registerCeiling,
        formalityIntent: rosterDebug.formalityIntent,
        postGatePoolSize: rosterDebug.postGatePoolSize,
        capApplied: rosterDebug.capApplied,
        capCutPieces: rosterDebug.capCutPieces,
        slotCoverage: rosterDebug.slotCoverage,
        coverageReport: rosterDebug.coverageReport,
        structureCoverageGaps: rosterDebug.structureCoverageGaps || [],
        compositionSkipped: 'incomplete_candidate_supply',
        imageDetail: null,
        thumbPx: 768,
        aiReturnedCount: 0,
        composerError: null,
        composerUsage: null,
        timings: { thumbPrepMs: 0, composerMs: 0 },
        resolvedActivity: rosterDebug.resolvedActivity,
        activitySource: rosterDebug.activitySource,
        walkable: rosterDebug.walkable,
        rosterCounts: rosterDebug.categoryCounts,
        unresolvedReferences: [],
        unresolvedReferencesCount: 0
      }
    }
  }
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
  let composerErrorIsTruncation = false
  let composerUsage = null
  const composerMaxTokens = visualComposerMaxTokensForOutfitCount(4)
  try {
    const composerStartedAt = Date.now()
    const composerResult = await withTimeout(askStylistWithUsage({
      system: `${prompts.WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM}\n\nSELECTED-ANCHOR CONTRACT:\nEvery outfit must include the selected anchor id. The selected garment is the premise, not one option among many.\n\nOCCASION & CLIMATE PROFILES (RULES-AS-DATA):\n${JSON.stringify(OCCASION_PROFILES, null, 2)}\n\nACTIVITY PROFILES (RULES-AS-DATA):\n${JSON.stringify(ACTIVITY_PROFILES, null, 2)}`,
      maxTokens: composerMaxTokens,
      messages: [{ role: 'user', content }]
    }), 90000, 'Selected-piece visual composer')
    timings.composerMs = Date.now() - composerStartedAt
    composerUsage = composerResult.usage || null
    parsed = parseModelJson(composerResult.text, { context: 'selected-piece visual composer', maxTokens: composerMaxTokens, stopReason: composerUsage?.stopReason })
  } catch (err) {
    timings.composerMs = Date.now() - routeStartedAt - timings.thumbPrepMs
    composerError = err.message
    composerErrorIsTruncation = Boolean(err.isTruncation)
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

  const selectedModelOutfits = resolved.map(o =>
    repairWholeWardrobeOutfit(normalizeWholeWardrobeOutfitObject(o, candidatePieces), candidatePieces, occasion, mood, { season, weatherProfile, activity }))
    .filter(o => (o.pieceIds || []).map(Number).includes(selectedId))
  const selectedValidation = new Map(selectedModelOutfits.map(outfit => [
    outfit,
    evaluateWearableOutfit(outfit.pieces, {
      requireShoes: true,
      seenPieceIds: new Set(shownPieces.map(piece => Number(piece.id))),
    }),
  ]))
  const needsReviewOutfits = selectedModelOutfits
    .filter(outfit => !selectedValidation.get(outfit).hardValid)
    .map(outfit => normalizeOutfitResult({
      ...outfit,
      broken: true,
      diagnosticOnly: true,
      strength: 'needs review',
      rejectionReason: selectedValidation.get(outfit).primaryFinding?.message || 'Hard outfit validation failed.',
    }, {
      disposition: 'rejected',
      findings: selectedValidation.get(outfit).hardFindings,
      provenance: { flow: 'selected_piece_visual', source: 'model-rejected', composedBy: 'model', stage: 'shared_validation' },
    }))
  let outfits = selectedModelOutfits.filter(outfit => selectedValidation.get(outfit).hardValid)

  if (!outfits.length) {
    const localFallback = buildLocalFallbackOutfitDirections(selectedPiece, recoveryRankedCandidates, { occasion })
    outfits = localFallback
      .map(o => normalizeGeneratedOutfitObject(o, selectedPiece, candidatePool))
      .filter(o => (o.pieceIds || []).map(Number).includes(selectedId))
  }

  if (comfortConstraint) {
    const visibleRepairPool = shownPieces.length ? shownPieces : candidatePieces
    outfits = outfits.map(o => {
      const repairedFromShown = applyComfortFootwearRepair(o, visibleRepairPool, comfortConstraint, { weatherProfile, occasion, mood, activity })
      return repairedFromShown === o
        ? applyComfortFootwearRepair(o, recoveryEvaluation.recoveryEligiblePieces, comfortConstraint, { weatherProfile, occasion, mood, activity })
        : repairedFromShown
    })
  }

  outfits = [...outfits.slice(0, 4), ...needsReviewOutfits].map(outfit => ({
    ...outfit,
    selectedPieceId: selectedPiece.id,
    wholeWardrobe: false,
    textOnly: true
  }))

  return {
    outfits,
    recoveryEligiblePieces: recoveryEvaluation.recoveryEligiblePieces,
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
      coverageReport: rosterDebug.coverageReport,
      structureCoverageGaps: rosterDebug.structureCoverageGaps || [],
      compositionSkipped: null,
      imageDetail: composerImageDetail,
      thumbPx: composerThumbPx,
      aiReturnedCount: Array.isArray(parsed?.outfits) ? parsed.outfits.length : 0,
      composerError,
      composerErrorIsTruncation,
      composerMaxTokens,
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
      "accessory_subtype": "belt|bag|jewelry|scarf|hat|watch|glasses|gloves|other|null (accessory only; null/omit for non-accessories)",
      "bottom_subtype": "pants|shorts|skirt|culottes|overalls|other|unknown|null (bottom only; null/omit for non-bottoms)",
      "jewelry_type": "necklace|earrings|bracelet|ring|pin|null (only when accessory_subtype is jewelry; null/omit otherwise)",
      "necklace_length": "choker|short|long|null (only when jewelry_type is necklace; null/omit otherwise)",
      "background_color": "base color of the garment, e.g. black, navy, cream, white",
      "colors": ["${colorTaggerInstruction()}"],
      "occasions": ["only from: casual, city, evening, smart-casual, outdoor, home"],
      "season": "warm|cool|year-round",
      "pattern_type": "solid|floral (flowers dominate)|botanical (leaves/vines/plant forms)|stripe|polka_dot (repeated dots/circles)|check (regular repeated grid/check pattern, including gingham/windowpane)|plaid (intersecting bands/lines, often multicolor or irregular)|geometric (geometric shapes are the dominant motif)|abstract (nonrepresentational, painterly, irregular, tie-dye/resist-dye-like motifs — there is no separate tie_dye value; use abstract plus reads_as for that nuance)|animal (animal-surface patterns or repeated animal motifs; a single illustrated animal belongs under graphic instead)|graphic (illustration, text, logo, or prominent printed image)|paisley (recognizable paisley/boteh motif)|patchwork (visibly composed of distinct patterned/printed blocks or panels)|other",
      "pattern_scale": "none|subtle|medium|bold",
      "pattern_complexity": "solid|quiet|medium|loud",
      "reads_as": "short phrase: the dominant visual impression",
      "hem_finish": "Valid values depend on category — top -> straight_loose|banded_elastic|ribbed|curved|shirttail|high_low|asymmetric|other; bottom -> straight_loose|cuffed|raw|tapered|banded_elastic|slit|asymmetric|other. Construction/shape only — does not determine tuckability.",
      "neckline": "V|scoop|crew|boat|mock|turtleneck|cowl|off-shoulder|square|wrap|halter|strapless|one-shoulder|collared|shawl|other|unknown",
      "sleeve_length": "sleeveless|cap|short|elbow|3/4|long|extra_long|unknown",
      "sleeve_shape": "fitted|straight|relaxed|puff|bishop|bell|flutter|raglan|dolman|other|unknown|null (omit for sleeveless)",
      "length_hits_at": "Valid values depend on category — pick from the matching list only: top -> cropped|waist|high_hip|hip|low_hip|tunic|unknown; outerwear -> cropped|waist|high_hip|hip|low_hip|mid_thigh|knee|mid_calf|ankle|full_length|floor_length|unknown; dress -> mini|above_knee|knee|below_knee|midi|ankle|maxi|unknown; bottom (this endpoint does not distinguish skirts from pants, so allow either's landing points) -> mini|above_knee|knee|below_knee|midi|maxi|shorts|mid_calf|ankle|full_length|floor_length|unknown; shoes -> open|below_ankle|ankle|high_top|mid_calf|knee|over_knee|unknown (open = fully open/minimal upper, e.g. a sandal or slide). Not applicable to accessory.",
      "silhouette": "Valid values depend on category — not applicable to shoes, use shoe_type/toe_shape instead: top -> fitted|slim|straight|relaxed|boxy|drop-shoulder|oversized|peplum|wrap; dress -> fitted|sheath|shift|A-line|wrap|slip|column|fit-and-flare|empire|relaxed; outerwear -> fitted|straight|boxy|relaxed|oversized|structured; bottom (this endpoint does not distinguish skirts from pants, so allow either's landing points) -> straight_leg|wide_leg|bootcut|flare|tapered|barrel|relaxed|a_line|pencil|full|slip|straight|pleated|wrap.",
      "shoe_type": "mule|loafer|boot|sandal|pump|flat|sneaker|slip_on|other|unknown|null (shoes only). Never 'heel' — heel_height covers that. 'slip_on' is a closure-free shoe (no laces/buckle/zip) that isn't a loafer, mule, or flat shape — e.g. a slip-on sneaker.",
      "toe_shape": "pointed|almond|round|square|open_toe|other|unknown|null (shoes only)",
      "fit_on_body": "clings_stretchy|clings_drapey|skims|hangs_straight|drapes|structured|none (clothing only; null/omit for shoes/accessory). This photo IS a worn photo — judge fit and drape directly from how the garment sits on the body here, the same authority a dedicated worn photo would carry.",
      "tuck_behavior": "tucks_anywhere|tucks_with_structure|wear_over_only|null (top only; null/omit for non-tops). Judge from the garment's own cut, fit, and design intent as shown in this worn photo: fitted or semi-fitted through the body -> tucks_anywhere; loose/relaxed fit that would need a belt or structured waistband to sit cleanly -> tucks_with_structure; peplum/tunic length, or a hem/silhouette clearly meant to be seen rather than tucked away -> wear_over_only. Whether the garment happens to be tucked or untucked in this specific photo is evidence, not the whole answer — an untucked top in this photo can still tuck cleanly if its cut supports it.",
      "waistband_type": "structured_high_waist|structured_mid_waist|structured_low_waist|soft_elastic_pull_on|tight_no_room|drawstring_relaxed|null (bottom only; null/omit for non-bottoms)",
      "fabric_category": "Valid values depend on category — top/bottom/dress/outerwear -> jersey|knit|rib knit|ponte|sweatshirt fleece|fleece|cotton|poplin|linen|linen blend|rayon|viscose|modal|silk|satin|crepe|chiffon|organza|lace|crochet|jacquard|wool|cashmere|boucle|denim|twill|canvas|corduroy|tweed|velvet|leather|faux leather|suede|faux suede|mesh|technical/performance|synthetic|other; shoes -> leather|suede|nubuck|patent|canvas|mesh|woven|synthetic|textile|rubber|other; accessory -> leather|suede|metal|stone|straw|canvas|synthetic|textile|rubber|wood|ceramic|glass|horn|shell|resin|pearl|crystal|enamel|other. Never use the clothing list for a shoe or accessory piece.",
      "fabric_weight": "ultralight|light|medium|heavy|null (top/bottom/dress/outerwear only; null/omit for shoes/accessory — use visual_weight instead)",
      "visual_weight": "delicate|slim|medium|chunky|null (shoes/accessory only; null/omit for clothing — this is NOT fabric weight, it is visual scale/heft, e.g. a substantial shoe is chunky, a fine chain necklace is delicate)",
      "opacity": "opaque|semi_sheer|sheer|open_weave",
      "stretch": "none|minimal|moderate|stretchy|null (clothing only; null/omit for shoes/accessory. Tag conservatively; omit if the photo does not show enough to judge)",
      "needs_base": "yes|no|null (omit unless clearly a construction that cannot be worn alone against skin — conservative default is null, not 'no')",
      "outerwear_role": "indoor_layer|transition_layer|protective_shell|cold_weather_outerwear|null (outerwear only; null/omit for non-outerwear, and null when evidence is insufficient — do not guess). Functional judgment of what job this garment can do as an OUTER layer outdoors, independent of fabric weight: indoor_layer = modest warmth/styling layer, no real outdoor protection; transition_layer = primary outer layer for mild/cool conditions, not a true shell or winter coat; protective_shell = built to block wind/rain rather than insulate, can be thermally light; cold_weather_outerwear = genuine cold-weather layer with substantial insulation. Do not infer from fabric weight, wool, nylon, or the words coat/jacket/cardigan alone.",
      "weather_protection": "array, 0-2 values from: rain, wind (outerwear only; empty array for non-outerwear or when evidence is insufficient — an empty array is common and normal, not a gap). SEPARATE from outerwear_role — a protective_shell is not automatically both, a transition/cold-weather piece is not automatically empty. Include 'rain' only with genuine construction evidence (coated/sealed face fabric, built as a rain shell) — nylon/polyester fiber alone is not evidence. Include 'wind' only with genuine construction evidence (tight wind-blocking weave, built as a windbreaker) — heavy fabric weight or wool alone is not evidence. A windbreaker is typically ['wind'] only; a raincoat is typically ['rain'] only.",
      "fiber_content": ["array of visible/likely fibers/materials from this canonical list only: wool, merino, cashmere, alpaca, mohair, fleece, down, cotton, linen, hemp, silk, tencel, modal, rayon, viscose, polyester, nylon, acrylic, spandex, leather, suede, denim, tweed, metal, stone, wood, ceramic, glass, horn, shell, resin, pearl, crystal, enamel, unknown. metal/stone/wood/ceramic/glass/horn/shell/resin/pearl/crystal/enamel are for accessory/jewelry pieces. Use 'tencel' for lyocell/Tencel fabric — there is no separate 'lyocell' value. Use 'unknown' if not determinable."],
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
  // Caller attribution (tagger semantic-consistency cleanup follow-up spec, 2026-08-23):
  // both ordinary Add and Batch Add hit this endpoint, so flow=tag_piece alone can't tell them
  // apart in telemetry. The client sends X-Tagger-Source; only a known value is trusted — an
  // unrecognized or missing header is recorded as unknown/legacy rather than trusting arbitrary
  // client text into an aggregation column.
  updateAiTelemetryContext({ taggerSource: normalizeTaggerSource(req.headers['x-tagger-source']) })
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
    const rawTags = await tagPieceWithProvider(photos)
    const { tags } = sanitizeTaggerColors(rawTags)
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

    const rawTags = await tagPieceWithProvider(photos, parsePiece(piece))
    const { tags, gaps: unknown } = sanitizeTaggerColors(rawTags, { preserveExisting: true })
    queueColorTaxonomyReviews(db, {
      pieceId: piece.id,
      pieceName: piece.name,
      colors: unknown,
    })
    tags.tag_state = tagStateForTaggerResult(tags, {
      photo: Boolean(photoFile || piece.photo),
      worn_photo: Boolean(wornPhotoFile || piece.worn_photo),
      category: piece.category
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
      `Rest of active wardrobe for pairings:\n${wardrobeText}`,
      '',
      question || 'What can you tell me about this piece and how to style it?'
    ].filter(Boolean).join('\n') })

    // Explicit, narrow prompt. This used to omit `system` and inherit askStylist's default --
    // STYLIST_SYSTEM -- so a question about one garment carried the whole stylist manual: outfit-set
    // policy, capsule rules, proposal mechanics, trip planning. The call passes no tools, so those
    // instructions were unreachable as well as irrelevant. 10,377 tokens -> 502.
    const answer = await askStylist({
      system: prompts.EVALUATE_PIECE_SYSTEM,
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
  activity = '',
  location = '',
  date = null,
  currentDate = null,
  statedWeather = '',
  resolvedWeatherProfile = null
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
  const stylingContext = await resolveStylingContext({
    explicitRequest: {
      occasion,
      activity,
      season,
      mission,
      mood,
      requestText: question,
      location: location || getHomeLocation(),
      date: date || currentDate || new Date(),
      statedWeather,
      weatherProfile: resolvedWeatherProfile,
    },
    policy: { allowLiveWeather: true },
  })
  occasion = stylingContext.occasion
  activity = stylingContext.activity
  season = stylingContext.season
  mission = stylingContext.mission
  mood = stylingContext.mood
  question = stylingContext.requestText
  const idealMode = Boolean(includeMissingPieces || idealOnly || /ideal|missing|new ideas|do not have|don't have|dont have|not in my wardrobe|wish list|wardrobe gap/i.test(String(question || '')))
  const idealOnlyMode = Boolean(idealOnly || /new ideas|do not limit|not limited|not just my wardrobe|ignore wardrobe|conceptual/i.test(String(question || '')))
  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const {
    weatherProfile,
    comfortConstraint,
    occasionProfile,
    activityProfile,
  } = stylingContext
  let { rankedCandidates } = selectAutomaticUseCandidatesForOutfitGeneration({
    anchorPiece: parsedPiece,
    pieces: allPieces,
    limit: 32,
    context: { occasion, mission, mood, season, currentDate: stylingContext.date, weatherProfile, comfortConstraint, activity, request: question, question },
  })
  console.log(`    - Found ${rankedCandidates.length} supporting wardrobe candidates.`)
  const selectedPieceOutfitsText = getOutfitsForPieceMemory(parsedPiece.id, 8)
  const selectedPieceRosterIds = [parsedPiece.id, ...rankedCandidates.map(candidate => candidate?.piece?.id)].filter(Boolean)
  const feedbackApplicabilityContext = projectStylingApplicabilityContext(stylingContext, {
    weatherText: [mood, question].filter(Boolean).join(' '),
    requestText: [occasion, activity, mood, question].filter(Boolean).join(' '),
  })
  const ownerGuidanceContext = {
    requestContext: feedbackApplicabilityContext,
    pieces: [parsedPiece, ...rankedCandidates.map(candidate => candidate?.piece).filter(Boolean)],
  }
  const selectedFeedbackText = getStylistFeedbackMemory('piece', parsedPiece.id, 16, { ownerGuidanceContext })
  const globalFeedbackText = getStylistFeedbackMemory(null, null, 24, { excludeContexts: [{ type: 'piece', id: parsedPiece.id }], ownerGuidanceContext })
  const exactOutfitReactionText = getExactOutfitReactionMemory(selectedPieceRosterIds, {
    occasion,
    activity,
    season: feedbackApplicabilityContext.season,
    currentDate: feedbackApplicabilityContext.currentDate,
    limit: 3,
  })
  const provisionalCorrectionsText = getProvisionalWrongChoiceMemory(
    selectedPieceRosterIds,
    3
  )
  const acceptedSynthesisText = getAcceptedFeedbackSynthesisMemory(8, {
    pieceIds: selectedPieceRosterIds,
    occasion,
    activity,
    ...feedbackApplicabilityContext,
  })
  const calibrationMemoryText = getCalibrationMemoryForStylist(32)

  const memoryText = [
    selectedPieceOutfitsText ? `Saved outfits already using this selected garment:\n${selectedPieceOutfitsText}` : `Saved outfits using this selected garment: none yet`,
    selectedFeedbackText ? `Recent feedback for this garment. Signature/Works should be reinforced; Not me/Too soft/Proportion problem should suppress similar ideas:\n${selectedFeedbackText}` : '',
    exactOutfitReactionText ? `EXACT PRIOR OUTFIT REACTIONS — narrow combination-level evidence only:\n${exactOutfitReactionText}` : '',
    calibrationMemoryText ? `Calibration Library memory. This is higher authority than broad style theory for taste boundaries and identity-preservation:\n${calibrationMemoryText}` : '',
    globalFeedbackText ? `General saved stylist feedback memory:\n${globalFeedbackText}` : '',
    provisionalCorrectionsText ? `PROVISIONAL OWNER CORRECTIONS FOR GARMENTS UNDER CONSIDERATION:\n${provisionalCorrectionsText}` : '',
    acceptedSynthesisText ? `OWNER-ACCEPTED PERSONAL OR CONTEXTUAL LESSONS:\n${acceptedSynthesisText}` : ''
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
      comfortConstraint,
      occasionProfile,
      activityProfile
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

  const recoveryPieces = (!idealMode && !idealOnlyMode && Array.isArray(composed.recoveryEligiblePieces))
    ? composed.recoveryEligiblePieces
    : allPieces
  const recoveryIds = new Set(recoveryPieces.map(piece => Number(piece.id)))
  const recoveryRankedCandidates = rankedCandidates.filter(candidate => recoveryIds.has(Number(candidate?.piece?.id)))
  let structuredOutfits = Array.isArray(composed.outfits) ? composed.outfits : []
  if (structuredOutfits.length > 0) {
    console.log(`    - Successfully generated ${structuredOutfits.length} outfits from AI stylist composer.`)
  } else if (!idealOnlyMode && !composed.compositionSkipped) {
    console.log(`    - AI stylist composer returned 0 outfits. Falling back to local wardrobe directions.`)
    structuredOutfits = buildLocalFallbackOutfitDirections(parsedPiece, recoveryRankedCandidates, { occasion })
  }
  if (!structuredOutfits.length && !composed.compositionSkipped) {
    console.log(`    - Local fallback generated 0 outfits. Using absolute basic backfill.`)
    const candidates = recoveryRankedCandidates.map(r => r.piece).filter(Boolean)
    const selectedGroup = wardrobeCategoryGroup(parsedPiece)
    const supporting = candidates.filter(p => Number(p.id) !== Number(parsedPiece.id)).slice(0, 4)
    const absoluteCandidate = normalizeGeneratedOutfitObject({
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
    }, parsedPiece, [parsedPiece, ...candidates])
    const absoluteFallback = validatedFallback({
      candidates: [absoluteCandidate],
      limit: 1,
      validate: outfit => validateSelectedRecoveryOutfit(outfit, parsedPiece, candidates),
      context: { flow: 'selected_piece_absolute', selectedPieceId: Number(parsedPiece.id) },
    })
    structuredOutfits = absoluteFallback.values
    if (!structuredOutfits.length) {
      composed.recoveryShortfall = absoluteFallback.report
      if (!composed.skip) composed.skip = absoluteFallback.report.message
    }
  }

  if (comfortConstraint) {
    structuredOutfits = structuredOutfits.map(o => applyComfortFootwearRepair(o, recoveryPieces, comfortConstraint, { weatherProfile, occasion, mood, activity }))
  }
  structuredOutfits = structuredOutfits.map(outfit => normalizeDeliveredOutfit(outfit, {
    provenance: {
      flow: 'selected_piece',
      source: outfit.source || (idealOnlyMode ? 'ideal-only' : idealMode ? 'ideal' : 'model'),
      composedBy: outfit.composedBy || 'model',
      stage: 'selected_response',
    },
  }))
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
      recoveryShortfall: composed.recoveryShortfall || null,
      weatherProfile,
      stylingContext: stylingContext.debug
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
  savedOutfitSeed = null,
  resolvedWeatherProfile = null,
  statedWeather = '',
  location = '',
  date = null,
  currentDate = null,
  adaptiveVisualDetail = false,
  comparisonSetGuidance = true
} = {}) {
    const routeStartedAt = Date.now()
    const requestedLimit = Math.max(1, Math.min(5, Number(limit) || 5))
    const stylingContext = await resolveStylingContext({
      explicitRequest: {
        occasion,
        activity,
        season,
        mission,
        mood,
        requestText: request || question,
        location: location || getHomeLocation(),
        date: date || currentDate || new Date(),
        statedWeather,
        weatherProfile: resolvedWeatherProfile,
      },
      policy: { allowLiveWeather: true },
    })
    occasion = stylingContext.occasion
    activity = stylingContext.activity
    season = stylingContext.season
    mission = stylingContext.mission
    mood = stylingContext.mood
    const stylingRequest = stylingContext.requestText
    request = stylingRequest
    const {
      weatherProfile,
      occasionProfile,
      activityProfile,
      comfortConstraint,
    } = stylingContext
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

    const automaticUseEvaluation = evaluateAutomaticUsePiecePool({
      pieces: allPieces,
      context: { occasion, season, calendarSeason: stylingContext.calendarSeason, currentDate: stylingContext.date, explorationMode, weatherProfile, mood, activity },
      policy: {
        anchorPieceIds: savedMainPieceId ? [savedMainPieceId] : [],
        hotOuterwearCap: 3,
      },
    })
    let allowedPieces = automaticUseEvaluation.eligiblePieces
    const suppressedPieces = automaticUseEvaluation.underlyingExcludedPieces
    const savedMainDecision = savedMainPieceId
      ? automaticUseEvaluation.decisionsById.get(savedMainPieceId)
      : null
    const savedMainSuppression = savedMainPiece
      ? suppressedPieces.find(piece => Number(piece.id) === savedMainPieceId)
      : null
    const savedMainBypassedSuppression = Boolean(savedMainDecision?.bypassed)
    if (savedMainPiece && savedMainBypassedSuppression) {
      allowedPieces = [savedMainPiece, ...allowedPieces.filter(piece => Number(piece.id) !== savedMainPieceId)]
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
    // Compute weather profile and filter the visual composer roster
    const poolEvaluation = evaluateVisualComposerPiecePool({
      pieces: allowedPieces,
      context: { occasion, weatherProfile, mood, activity, requestText: stylingRequest, question, occasionProfile, activityProfile },
      policy: { selectedPieceId: savedMainPieceId, sessionInfluence, maxImages: 90 },
    })
    let { eligiblePieces: roster, excludedPieces: excluded, debug: rosterDebug } = poolEvaluation
    if (savedMainPiece) {
      const allowedMain = allowedPieces.find(piece => Number(piece.id) === savedMainPieceId)
      if (!allowedMain) {
        throw new Error(`The selected Main piece is unavailable because it is no longer active. Choose another Main piece.`)
      }
    }
    const structureShortfall = projectCandidateSetShortfall(rosterDebug.coverageReport, {
      anchorPiece: savedMainPiece,
    })
    if (structureShortfall) {
      const { topCoverage, shoeCoverage } = computeWardrobeCoverage(allowedPieces, occasionProfile, activityProfile)
      const profileCoverageNote = formatCoverageNote(topCoverage, shoeCoverage, { occasion, occasionProfile, activityProfile })
      const responseCoverageNote = [structureShortfall, profileCoverageNote].filter(Boolean).join('\n')
      persistGenerationRun({
        flow: 'whole_wardrobe_visual',
        occasion,
        weather: weatherProfile,
        rosterDebug,
        rosterCount: roster.length,
        requested: requestedLimit,
        delivered: 0,
        coverageGaps: rosterDebug.structureCoverageGaps || [],
      })
      return {
        feedback: `**No complete wardrobe outfit is available**\n\n${responseCoverageNote}`,
        structuredOutfits: [],
        provider: AI_PROVIDER,
        mode: savedVariantMode ? `generate_saved_outfit_${savedVariantMode}_variants` : 'generate_wardrobe_outfits_visual',
        pipeline: savedVariantMode ? 'saved_outfit_wardrobe_variant_composer' : 'full_wardrobe_visual_composer',
        savedOutfitVariantMode: savedVariantMode,
        sourceOutfit: savedOutfitSeed || null,
        coverageNote: responseCoverageNote,
        debug: {
          profileCoverage: { tops: topCoverage, shoes: shoeCoverage },
          shownPieceCount: 0,
          suppressedCount: suppressedPieces.length,
          suppressedReasonCounts,
          weatherProfile,
          stylingContext: stylingContext.debug,
          savedMainBypassedSuppression,
          savedMainSuppressionReasons: savedMainSuppression?.reasons || [],
          savedSourceHasLayeredTopFormula,
          aiReturnedCount: 0,
          locallyGeneratedCount: 0,
          finalReturnedCount: 0,
          deliveredCount: 0,
          brokenCardCount: 0,
          advisorFlaggedCount: 0,
          localFillAddedCount: 0,
          imageDetail: null,
          thumbPx: adaptiveVisualDetail ? null : 768,
          adaptiveVisualDetail,
          imageSizeCounts: {},
          composerUsage: null,
          finalSelection: null,
          sessionMemory: null,
          composerError: null,
          compositionSkipped: 'incomplete_candidate_supply',
          timings: { thumbPrepMs: 0, composerMs: 0 },
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
          coverageReport: rosterDebug.coverageReport,
          structureCoverageGaps: rosterDebug.structureCoverageGaps || [],
          excluded,
          resolvedActivity: rosterDebug.resolvedActivity,
          activitySource: rosterDebug.activitySource,
          walkable: rosterDebug.walkable,
          rosterCounts: rosterDebug.categoryCounts,
          modelPickedSuppressedCount: 0,
          unresolvedReferences: [],
          unresolvedReferencesCount: 0,
        }
      }
    }
    const provisionalCorrectionsText = getProvisionalWrongChoiceMemory(roster.map(piece => piece.id), 3)
    const feedbackApplicabilityContext = projectStylingApplicabilityContext(stylingContext, {
      weatherText: [mood, stylingRequest].filter(Boolean).join(' '),
      requestText: [occasion, activity, mood, stylingRequest].filter(Boolean).join(' '),
    })
    const exactOutfitReactionText = getExactOutfitReactionMemory(roster.map(piece => piece.id), {
      occasion,
      activity,
      season: feedbackApplicabilityContext.season,
      currentDate: feedbackApplicabilityContext.currentDate,
      limit: 3,
    })
    const acceptedSynthesisText = getAcceptedFeedbackSynthesisMemory(8, {
      pieceIds: roster.map(piece => piece.id),
      ...feedbackApplicabilityContext,
    })

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

    // Build the multimodal content array.
    // STABLE PREFIX FIRST: candidate thumbnails & catalog text (cached across requests within 5 minutes)
    const groupsOrder = ['top', 'bottom', 'dress', 'shoes', 'outerwear', 'accessory']
    const grouped = new Map(groupsOrder.map(g => [g, []]))
    for (const p of roster) {
      const group = wardrobeCategoryGroup(p) || 'accessory'
      if (!grouped.has(group)) grouped.set(group, [])
      grouped.get(group).push(p)
    }

    const content = []
    content.push({ type: 'text', text: 'Below are photos of every available piece, grouped by category. Reference pieces by exact ID.' })

    let shownPieceCount = 0
    const shownPieces = []
    const imageSizeCounts = {}
    for (const group of grouped.keys()) {
      const pieces = grouped.get(group)
      if (!pieces?.length) continue
      content.push({ type: 'text', text: `=== ${group.toUpperCase()}S ===` })
      for (const p of pieces) {
        const photoFile = p.worn_photo || p.photo || ''
        if (!photoFile) continue
        const filePath = path.join(userUploadsDir(), photoFile)
        if (!fs.existsSync(filePath)) continue
        const { maxPx, detail } = pieceVisualDetailPolicy(p, { allowLow: adaptiveVisualDetail })
        const thumb = await prepareWardrobeThumb(filePath, `${p.id}:${maxPx}:${photoFile}`, { maxPx })
        imageSizeCounts[maxPx] = (imageSizeCounts[maxPx] || 0) + 1
        content.push({ type: 'text', text: `ID ${p.id}: ${p.name}${composerPieceLineSuffix(p)}` })
        content.push({ type: 'image', detail, source: { type: 'base64', media_type: thumb.media_type, data: thumb.data } })
        shownPieceCount++
        shownPieces.push(p)
      }
    }

    // Attach cache_control to the last candidate thumbnail so the entire candidate manifest is cached
    if (content.length > 1) {
      content[content.length - 1] = {
        ...content[content.length - 1],
        cache_control: { type: 'ephemeral' }
      }
    }

    // VOLATILE TAIL SECOND: occasion, season, mood, saved outfit photo, feedback memory
    const isWeatherFiltered = weatherProfile.isHot || weatherProfile.isCold
    content.push({ type: 'text', text: [
      `Occasion: ${occasion}`,
      `Season: ${season}`,
      mood ? `Mood: ${mood}` : '',
      stylingRequest ? `Styling request: ${stylingRequest}` : '',
      activity && activity !== 'none' ? `Activity: ${activity}` : '',
      activityFactLine,
      occasionProfileGuidance ? `Occasion guidance:\n${occasionProfileGuidance}` : '',
      isWeatherFiltered ? "Off-season pieces have been deprioritized or removed; everything shown is weather-optimized." : '',
      'Garment wear facts in the image labels are constraints. Obey them silently. Opacity and needs_base are authoritative: do not call an opaque, independently wearable garment sheer or invent an underlayer for it. Do not repeat a fixed fact the owner already knows merely to fill styling_instructions; use that field only for an actual, useful action or chosen relationship between pieces.',
      'WEAR MECHANICS BELONG ON THE CARD: if the user asked for a specific wear mechanic — untucked, belted, sleeves pushed, worn open — state it in that outfit\'s styling_instructions. Saying it only in the surrounding reply loses it: the card is what persists, what the renderer reads, and what a later turn revises. Prose commenting on a card may not be its only record.',
      'RENDERER CONTRACT: the image generator treats styling_instructions—not silhouette—as authoritative garment-placement guidance. If silhouette states a useful physical relationship such as a top worn over a waistband, repeat that relationship concisely in styling_instructions even though the card also shows the silhouette.',
      'TIME-OF-DAY WEATHER: Judge the part of the forecast range relevant to the request, not only the daily high. For an evening or early-morning outing near a cooler low, include a plausible removable transition layer when the shown wardrobe supports one. At roughly 55°F, do not claim that a sleeveless vest over a light or short-sleeved base handles the outdoor chill; use sleeve-bearing outerwear, a genuinely warm long-sleeved base plus an adequate layer, or state the wardrobe gap. An indoor destination may shape the base outfit, but it does not erase arrival and departure weather. This also runs the other direction: the BASE outfit — what carries the main part of the day — should track the day\'s HIGH, not a cooler morning/evening low. Do not choose a heavy or insulating-fiber top or bottom (a chunky knit, wool, a mock neck) alongside bare warm-weather footwear (sandals, open-toe shoes) just because the low dipped cool; bare feet already say the day reads warm enough for that, so the rest of the base outfit should match — cover the cooler edges of the day with a removable layer instead of a heavier base garment.',
      `Compose ${requestedLimit} outfits.`,
      comparisonSetGuidance && requestedLimit > 1
        ? 'COMPARISON SET CONTRACT: These options will be compared side by side. When the eligible pieces shown support it, use meaningfully different outfit formulas or clearly different silhouettes/proportion logic. Changing only the color, print, or individual garments while repeating the same top + bottom + shoe shape does not create a useful alternative. Activity-safe footwear may repeat when the activity narrows the valid shoe choices.'
        : '',
      savedVariantGuidance,
      rotationWarningsText,
      wholeWardrobeFeedbackText ? `Feedback memory (rejected pairings are settled — do not repeat them):\n${wholeWardrobeFeedbackText}` : '',
      provisionalCorrectionsText ? `PROVISIONAL OWNER CORRECTIONS FOR GARMENTS SHOWN ABOVE:\n${provisionalCorrectionsText}` : '',
      exactOutfitReactionText ? `EXACT PRIOR OUTFIT REACTIONS — narrow combination-level evidence only:\n${exactOutfitReactionText}` : '',
      acceptedSynthesisText ? `OWNER-ACCEPTED PERSONAL OR CONTEXTUAL LESSONS:\n${acceptedSynthesisText}` : ''
    ].filter(Boolean).join('\n') })

    const savedOutfitPhotoPath = savedOutfitSeed?.photo
      ? uploadedOrSavedOutfitPhotoPath(savedOutfitSeed.photo)
      : ''
    if (savedOutfitPhotoPath && fs.existsSync(savedOutfitPhotoPath)) {
      const { base64, mime } = await prepareImageForClaude(savedOutfitPhotoPath)
      content.push({ type: 'text', text: 'Saved outfit source photo. Use it to read the original formula, proportions, and focal hierarchy; do not copy it exactly.' })
      content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
    }

    const timings = { thumbPrepMs: Date.now() - routeStartedAt }

    // Single model call — no tools
    let parsed = {}
    let composerError = null
    let composerErrorIsTruncation = false
    let composerUsage = null
    const composerStartedAt = Date.now()
    const composerMaxTokens = visualComposerMaxTokensForOutfitCount(requestedLimit)
    const systemPrompt = `${prompts.WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM}[[PROMPT_CACHE_BREAKPOINT]]${savedVariantGuidance ? `\n\n${savedVariantGuidance}` : ''}`
    try {
      const composerResult = await withTimeout(askStylistWithUsage({
        system: systemPrompt,
        maxTokens: composerMaxTokens,
        messages: [{ role: 'user', content }]
      }), 90000, 'Visual wardrobe composer')
      timings.composerMs = Date.now() - composerStartedAt
      composerUsage = composerResult.usage
      parsed = parseModelJson(composerResult.text, { context: 'whole-wardrobe visual composer', maxTokens: composerMaxTokens, stopReason: composerUsage?.stopReason })
    } catch (err) {
      composerError = err.message
      composerErrorIsTruncation = Boolean(err.isTruncation)
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

    const normalizedModelOutfits = resolved.map(o =>
      sanitizeWholeWardrobeOutfitProse(normalizeWholeWardrobeOutfitObject(o, allowedPieces))
    )
    const validationByOutfit = new Map(normalizedModelOutfits.map(outfit => [
      outfit,
      evaluateWearableOutfit(outfit.pieces, { requireShoes: true }),
    ]))
    const structuralRejectionReason = (validation) => ({
      multiple_shoes: 'structural: more than one shoe',
      missing_shoes: 'structural: missing shoes',
      multiple_bottoms: 'structural: more than one bottom',
      multiple_dresses: 'structural: more than one dress',
      dress_with_bottom: 'structural: dress plus bottom',
      missing_top_or_dress: 'structural: missing top',
      multiple_tops_without_bottom: 'structural: missing bottom',
      missing_bottom: 'structural: missing bottom',
      required_base_missing: 'dependency: required base layer is missing',
      required_base_incompatible: 'dependency: required base layer is incompatible',
    }[validation?.primaryFinding?.code] || validation?.primaryFinding?.message || 'structural: not a complete wardrobe outfit')
    const structurallyRejectedModelOutfits = normalizedModelOutfits
      .filter(outfit => !validationByOutfit.get(outfit).hardValid)
      .map(outfit => ({ outfit, reason: structuralRejectionReason(validationByOutfit.get(outfit)) }))

    // The composer above proposes from ISOLATED per-garment photos and never sees two pieces
    // together — its own written "reason" can rationalize a pairing that the actual photos, side
    // by side, show clashing (e.g. two busy prints it argued "share a warm palette"). This second
    // pass shows it the composed outfits together and judges only the photos, not that prose.
    // Gated to outfits that already look questionable on cheap tag/name signal — most outfits
    // have no real clash risk, and reviewing all of them would just be paying for a second
    // opinion nobody asked for. Non-fatal: a critic failure must never block the whole turn.
    let visualClashDebug = null
    let clashFlaggedByOutfit = new Map()
    const structurallyValidForClashReview = normalizedModelOutfits.filter(outfit => validationByOutfit.get(outfit).hardValid)
    // normalizeWholeWardrobeOutfitObject trims outfit.pieces to {id, name, category, photo,
    // worn_photo} — pattern_complexity and style_profile_json are gone by here, so the
    // questionable-check would silently see nothing to flag. Rehydrate against allowedPieces by
    // id for the check only; the outfit objects that ship to the client stay trimmed as-is.
    const allowedPieceById = new Map(allowedPieces.map(piece => [Number(piece.id), piece]))
    const visualReviewCandidates = structurallyValidForClashReview.map(outfit => ({
      outfit,
      findings: wholeWardrobeOutfitVisualReviewFindings({
        pieces: (outfit.pieces || []).map(piece => allowedPieceById.get(Number(piece.id)) || piece)
      }),
    })).filter(candidate => candidate.findings.length)
    const questionableForClashReview = visualReviewCandidates.map(candidate => candidate.outfit)
    const visualReviewFindingCounts = visualReviewCandidates
      .flatMap(candidate => candidate.findings)
      .reduce((counts, finding) => {
        counts[finding.code] = (counts[finding.code] || 0) + 1
        return counts
      }, {})
    if (questionableForClashReview.length) {
      try {
        const clashReview = await withTimeout(reviewComposedWholeWardrobeOutfitsForClash({
          outfits: questionableForClashReview,
          occasion,
          season,
          mood,
          memoryText: wholeWardrobeFeedbackText
        }), 20000, 'Whole-wardrobe clash critic')
        if (clashReview?.flaggedByOutfit?.size) {
          clashFlaggedByOutfit = clashReview.flaggedByOutfit
        }
        visualClashDebug = {
          reviewedCount: clashReview?.reviewedCount || 0,
          flaggedCount: clashFlaggedByOutfit.size,
          skippedNotQuestionable: structurallyValidForClashReview.length - questionableForClashReview.length,
          findingCounts: visualReviewFindingCounts,
        }
      } catch (err) {
        console.warn('Whole-wardrobe clash critic fallback:', err.message)
        visualClashDebug = { error: err.message }
      }
    } else if (structurallyValidForClashReview.length) {
      visualClashDebug = {
        reviewedCount: 0,
        flaggedCount: 0,
        skippedNotQuestionable: structurallyValidForClashReview.length,
        findingCounts: {},
      }
    }
    const visuallyRejectedModelOutfits = [...clashFlaggedByOutfit.entries()]
      .map(([outfit, reason]) => ({ outfit, reason: `visual critic: ${reason}` }))

    const includesSavedMain = outfit => !savedMainPieceId
      || (outfit.pieceIds || outfit.pieces?.map(piece => piece?.id) || []).map(Number).includes(savedMainPieceId)
    const hasLayeredTopFormula = outfit => (outfit.pieces || []).filter(piece => wardrobeCategoryGroup(piece) === 'top').length >= 2
    const modelMissingMainRejectedCount = savedMainPieceId
      ? normalizedModelOutfits.filter(outfit => !includesSavedMain(outfit)).length
      : 0
    const modelLayeredTopFormulaRejectedCount = savedFormulaRequiresLayeredTop
      ? normalizedModelOutfits.filter(outfit => includesSavedMain(outfit) && validationByOutfit.get(outfit).hardValid && !hasLayeredTopFormula(outfit)).length
      : 0
    let modelOutfits = normalizedModelOutfits
      .filter(includesSavedMain)
      .filter(outfit => validationByOutfit.get(outfit).hardValid)
      .filter(o => !clashFlaggedByOutfit.has(o))
      .filter(o => !savedFormulaRequiresLayeredTop || hasLayeredTopFormula(o))
      .map(outfit => ({
        ...outfit,
        savedOutfitVariantMode: savedVariantMode,
        sourceFormulaFamily: savedSeedFormula,
        systemSuggestion: comfortFootwearSuggestionForOutfit(outfit, allowedPieces, comfortConstraint, { weatherProfile, occasion, mood, activity })
      }))

    let localBackfillOutfits = []
    let localBackfillRecoveryReport = null
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
      proseIntegritySanitizedCount: normalizedModelOutfits.filter(outfit => outfit.proseIntegrityIssues?.length).length,
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
        const localFallbackCandidates = buildVisualLocalBackfill()
        const localFallbackRecovery = validatedFallback({
          candidates: localFallbackCandidates,
          limit: requestedLimit,
          validate: candidate => locallyGateWholeWardrobeOutfits(
            [candidate],
            1,
            { mode: 'advisor', requireShoes: true, rejectProfileDiscouraged: true, applyDiversity: false, candidatePieces: roster, occasion, mood, season, weatherProfile, activity, sessionInfluence, request: stylingRequest, question }
          ),
          accept: validation => validation.outfits.length > 0,
          context: { flow: 'whole_wardrobe_visual' },
        })
        localBackfillRecoveryReport = localFallbackRecovery.report
        gatedLocal = locallyGateWholeWardrobeOutfits(
          localFallbackRecovery.values,
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
          ...visuallyRejectedModelOutfits,
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
    // A paid composition attempt remains visible even when enough sibling looks passed.
    // Validation controls disposition, not visibility: hard findings become Needs review
    // cards with the actual reason and never consume the requested valid-card count.
    const deliveredKeys = new Set(structuredOutfits.map(outfitKey))
    const paidRejectedDiagnostics = [
      ...structurallyRejectedModelOutfits,
      ...visuallyRejectedModelOutfits,
      ...gatedModel.rejected
        .filter(item => item?.outfit)
        .map(item => ({ outfit: item.outfit, reason: item.reason || 'rejected by model-output gate' })),
    ]
    for (const candidate of paidRejectedDiagnostics) {
      const key = outfitKey(candidate.outfit)
      if (!key || deliveredKeys.has(key)) continue
      const diagnostic = buildBrokenModelCard(candidate.outfit, candidate.reason)
      structuredOutfits.push(diagnostic)
      deliveredKeys.add(key)
      diagnosticBrokenCount += 1
    }
    visualDebugLog.localBackfillCandidates = localBackfillCandidateCount
    visualDebugLog.localBackfillOutfits = localBackfillOutfits.length
    visualDebugLog.localBackfillRecovery = localBackfillRecoveryReport
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
    visualDebugLog.visualClashReview = visualClashDebug
    visualDebugLog.visuallyRejectedCount = visuallyRejectedModelOutfits.length
    visualDebugLog.visuallyRejectedReasons = rejectionSummary(visuallyRejectedModelOutfits)
    visualDebugLog.localFillGateOutfits = gatedLocal.outfits.length
    visualDebugLog.localFillGateRejected = gatedLocal.rejected.length
    visualDebugLog.localFillGateRejectedReasons = rejectionSummary(gatedLocal.rejected)
    visualDebugLog.localFillAdded = softBackfillCount
    visualDebugLog.diagnosticBrokenAdded = diagnosticBrokenCount
    visualDebugLog.finalBeforeMissionLabels = structuredOutfits.length
    console.log('[Visual Composer Final Selection]', visualDebugLog)

    // Mission labeling stays post-generation:
    const readyOutfits = structuredOutfits.filter(outfit => !outfit.broken).slice(0, requestedLimit)
    const reviewOutfits = structuredOutfits.filter(outfit => outfit.broken)
    structuredOutfits = [...readyOutfits, ...reviewOutfits].map((outfit, index) => {
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
      return normalizeDeliveredOutfit({
        ...outfit,
        strength: outfit.broken ? 'needs review' : (index === 0 ? 'signature' : (index <= 2 ? 'strong' : 'usable')),
        formulaFamily: outfit.formulaFamily || wholeWardrobeFormulaFamily(outfit, allowedPieces, occasion),
        missionId: qualifiedMission.missionId,
        missionLabel: qualifiedMission.missionLabel
      }, {
        provenance: {
          flow: 'whole_wardrobe_visual',
          source: outfit.source || 'model',
          composedBy: outfit.composedBy || (outfit.source === 'local-fill' ? 'engine' : 'model'),
          stage: 'advisor_gate',
        },
      })
    })

    const deliveredOutfitsForDiversity = structuredOutfits.filter(outfit => !outfit.broken)
    const deliveredFormulaFamilies = deliveredOutfitsForDiversity.map(outfit => (
      outfit.formulaFamily || wholeWardrobeFormulaFamily(outfit, allowedPieces, occasion)
    ))
    const deliveredSilhouettes = deliveredOutfitsForDiversity.map(outfit => (
      wholeWardrobeSilhouetteFromPieces(outfit) || outfit.silhouette || 'unknown'
    ))
    visualDebugLog.uniqueFormulaCount = new Set(deliveredFormulaFamilies).size
    visualDebugLog.uniqueSilhouetteCount = new Set(deliveredSilhouettes).size
    visualDebugLog.comparisonSetCollapsed = deliveredOutfitsForDiversity.length >= 2
      && visualDebugLog.uniqueFormulaCount === 1
      && visualDebugLog.uniqueSilhouetteCount === 1

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
        stylingContext: stylingContext.debug,
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
        thumbPx: adaptiveVisualDetail ? null : composerThumbPx,
        adaptiveVisualDetail,
        imageSizeCounts,
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
        composerErrorIsTruncation,
        composerMaxTokens,
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
        coverageReport: rosterDebug.coverageReport,
        structureCoverageGaps: rosterDebug.structureCoverageGaps || [],
        compositionSkipped: null,
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
    const input = req.body || {}
    const result = await generateWholeWardrobeOutfitsVisualInternal({
      ...input,
      location: input.location || getHomeLocation(),
      date: input.date || input.currentDate || new Date(),
    })
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
    const { rankedCandidates } = selectAutomaticUseCandidatesForOutfitGeneration({
      anchorPiece: selectedPiece,
      pieces: allPieces,
      limit: 48,
      context: { occasion, season },
    })
    const candidatePieces = [selectedPiece, ...rankedCandidates.map(r => r.piece)]
    const allowedIds = new Set(candidatePieces.map(p => Number(p.id)))
    const pieceById = new Map(candidatePieces.map(p => [Number(p.id), p]))

    let boardPlans = boardPlanFromStructuredOutfits(structuredOutfits, selectedPiece, candidatePieces)

    if (!boardPlans.length && conceptsText) {
      boardPlans = structuredOutfitsFromGeneratedText(conceptsText, selectedPiece, candidatePieces)
    }

    if (!boardPlans.length) {
      const candidateText = candidatePieces.map(p => `${p.id}: ${p.name} (${p.category}) — ${buildPieceText(p)}`).join('\n')
      const content = [
        { type: 'text', text: `Candidate saved wardrobe pieces. Use ONLY these ids:\n${candidateText}`, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: [
          `Selected garment id: ${selectedPiece.id}`,
          `Selected garment: ${selectedPiece.name} (${selectedPiece.category})`,
          `Occasion: ${occasion}`,
          `Season: ${season}`,
          '',
          conceptsText ? `Text outfit ideas to translate into boards:\n${conceptsText}` : 'No prior concept text was provided. Create useful boards from the candidates.',
          '',
          `Return 2-3 boards if possible. Every board must include selected id ${selectedPiece.id}.`
        ].join('\n') }
      ]
      const rawPlan = await askStylist({
        system: `${prompts.OUTFIT_BOARD_PLANNER_SYSTEM}[[PROMPT_CACHE_BREAKPOINT]]`,
        maxTokens: 1000,
        messages: [{ role: 'user', content }]
      })
      const parsed = parseModelJson(rawPlan, { context: 'outfit board planner', maxTokens: 1000 })
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
        stylingInstructions: board.styling_instructions || board.stylingInstructions || '',
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
      savedOutfitSeed: sourceOutfit,
      comparisonSetGuidance: variantMode !== 'formula'
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
      stylingInstructions: outfit.stylingInstructions || outfit.styling_instructions || '',
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

// The uploaded photo is the ONLY record of an un-owned garment: it has no pieces row and no
// lookbook entry, so deleting it after this one critique left every later turn in the thread
// blind — and broke the thumbnail in the user's own history, which fell back to a browser
// blob: URL that dies on reload. The file now survives and its name is returned so the thread
// can own it. Retention is thread-scoped: DELETE /chat-threads/:id unlinks the photos its own
// messages cite (routes/crud.js). A failed critique still unlinks, because nothing will ever
// hold a reference to it.
router.post('/outfit-feedback', upload.single('photo'), async (req, res) => {
  const savedPhoto = req.file ? req.file.filename : ''
  const tempPath = savedPhoto ? path.join(userUploadsDir(), savedPhoto) : ''
  try {
    const { question, outfitName, outfitNotes } = req.body
    const result = await evaluateOutfitThroughSharedPipeline({
      outfit: { label: outfitName || 'Uploaded outfit photo', notes: outfitNotes || '' },
      question: question || 'What do you think of this outfit? Does it work well together?',
      routeMode: 'evaluate_uploaded_outfit_photo',
      uploadedPhotoPath: tempPath,
      allowPhotoOnly: true,
      extraContextText: [
        outfitName ? `Outfit: "${outfitName}"` : '',
        outfitNotes ? `User notes / corrected truth: ${outfitNotes}` : ''
      ].filter(Boolean).join('\n\n')
    })
    res.json({ ...result, photo: savedPhoto })
  } catch (err) {
    console.error('AI error:', err)
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    res.status(err.statusCode || 500).json({ error: err.message })
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

    let parsed = parseModelJson(raw, { context: 'editorial new pieces', maxTokens: 1200 })
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

function normalizedCapsuleExpansionContext(raw = {}) {
  const rosterIds = [...new Set((Array.isArray(raw?.roster_ids) ? raw.roster_ids : [])
    .map(Number).filter(id => Number.isInteger(id) && id > 0))].slice(0, 40)
  const slots = (Array.isArray(raw?.slots) ? raw.slots : []).slice(0, 12).map(slot => ({
    id: String(slot?.id || '').trim(),
    label: String(slot?.label || '').trim(),
    occasion: normalizeOccasion(slot?.occasion || 'casual'),
    activity: normalizeActivity(slot?.activity || 'none'),
    environment: String(slot?.environment || '').trim(),
    register: String(slot?.register || '').trim(),
    weatherLabel: String(slot?.weather_label || '').trim(),
    weatherProfile: slot?.weather_profile && typeof slot.weather_profile === 'object' ? slot.weather_profile : {},
    coreCapacity: slot?.core_capacity === undefined || slot?.core_capacity === null
      ? null
      : Math.max(0, Number(slot.core_capacity) || 0),
    allowedIds: [...new Set((Array.isArray(slot?.allowed_piece_ids) ? slot.allowed_piece_ids : [])
      .map(Number).filter(id => rosterIds.includes(id)))]
  })).filter(slot => slot.id && slot.label)
  return {
    version: Number(raw?.version) || 0,
    pieceBudget: Math.max(0, Number(raw?.piece_budget) || 0),
    capacity: Math.max(0, Number(raw?.capacity) || 0),
    isWinterCapsule: Boolean(raw?.is_winter_capsule),
    rosterIds,
    slots
  }
}

function capsuleExpansionSystemPrompt() {
  return `You are selecting ONE additional outfit for an existing capsule wardrobe.
Return ONLY valid JSON in this exact shape:
{"title":"short evocative title","piece_ids":[1,2,3],"reason":"one specific visual reason"}

Use only IDs in the supplied allowed roster. ${categoryOutfitStructurePromptRule({ strictSingleTop: true, maxOuterwear: 1, allowAccessories: false })} Choose a new main core not already represented. Do not reinterpret the weather, occasion, roster, or capsule brief. If the catalog cannot support another credible outfit, return {"title":"","piece_ids":[],"reason":"no credible unused combination"}.

STYLE CONSTITUTION — BODY CONTRACT:
${prompts.BODY_CONTRACT}

PROVEN FORMULAS:
${prompts.PROVEN_FORMULAS}

AESTHETIC GRAVITY:
${prompts.AESTHETIC_GRAVITY}

LANE NEUTRALITY:
${prompts.LANE_NEUTRALITY}

WORKING STYLE:
${prompts.WORKING_STYLE}`
}

function capsuleExpansionCoreKey(pieces = []) {
  const dress = pieces.find(piece => wardrobeCategoryGroup(piece) === 'dress')
  if (dress) return `dress:${Number(dress.id)}`
  const top = pieces.find(piece => wardrobeCategoryGroup(piece) === 'top')
  const bottom = pieces.find(piece => wardrobeCategoryGroup(piece) === 'bottom')
  return top && bottom ? `separates:${Number(top.id)}:${Number(bottom.id)}` : ''
}

const CAPSULE_EXPANSION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    piece_ids: { type: 'array', items: { type: 'integer' } },
    reason: { type: 'string' }
  },
  required: ['title', 'piece_ids', 'reason']
}

export function capsulePlanQuestion(currentQuestion = '', history = []) {
  const current = String(currentQuestion || '').trim()
  if (/\bcapsule\b/i.test(current)) return current // ratchet-allow: user plan intent, not garment text
  const priorCapsuleRequest = [...(Array.isArray(history) ? history : [])]
    .reverse()
    .find(entry => entry?.role === 'user' && /\bcapsule\b/i.test(String(entry?.content || '')))?.content || '' // ratchet-allow: user plan intent, not garment text
  return [String(priorCapsuleRequest || '').trim(), current].filter(Boolean).join('\n')
}

export function capsulePlanCompositionSchema(targetOutfits = 1) {
  const exactCount = Math.max(1, Number(targetOutfits) || 1)
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      outfits: {
        type: 'array',
        minItems: exactCount,
        maxItems: exactCount,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            slot_id: { type: 'string' },
            piece_ids: { type: 'array', items: { type: 'integer' } },
            title: { type: 'string' },
            reason: { type: 'string' },
            styling_instructions: { type: 'string', description: "Garment-relationship mechanics not obvious from the pieces alone (layering order, where a belt/tie lands, tuck/drape between two named garments), or empty string if not applicable." }
          },
          required: ['slot_id', 'piece_ids', 'title', 'reason', 'styling_instructions']
        }
      }
    },
    required: ['outfits']
  }
}

// Spec §3 stage 2 — the model picks the roster from a bench the engine gated.
// Default ON: model picks the roster from the gated 70-piece bench. Can be set
// to 'false' via environment variable if deterministic roster pick is needed.
export function modelCapsuleRosterEnabled() {
  return String(process.env.WARDROBE_MODEL_CAPSULE_ROSTER || 'true').toLowerCase() !== 'false'
}

export function capsuleRosterSelectionSchema(budget = 24) {
  const exact = Math.max(1, Number(budget) || 1)
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      roster_piece_ids: { type: 'array', items: { type: 'integer' }, minItems: exact, maxItems: exact, uniqueItems: true },
      palette: { type: 'string' },
      category_shape_reason: { type: 'string' },
      category_counts: {
        type: 'object',
        additionalProperties: false,
        properties: {
          top: { type: 'integer' },
          bottom: { type: 'integer' },
          dress: { type: 'integer' },
          outerwear: { type: 'integer' },
          shoes: { type: 'integer' }
        },
        required: ['top', 'bottom', 'dress', 'outerwear', 'shoes']
      },
      category_departures: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            category: { type: 'string', enum: ['top', 'bottom', 'dress', 'outerwear', 'shoes'] },
            target_count: { type: 'integer' },
            selected_count: { type: 'integer' },
            reason: { type: 'string' }
          },
          required: ['category', 'target_count', 'selected_count', 'reason']
        }
      },
      repair_changes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            removed_piece_id: { type: 'integer' },
            added_piece_id: { type: 'integer' },
            reason: { type: 'string' }
          },
          required: ['removed_piece_id', 'added_piece_id', 'reason']
        }
      },
      piece_jobs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { piece_id: { type: 'integer' }, job: { type: 'string' } },
          required: ['piece_id', 'job']
        }
      }
    },
    required: ['roster_piece_ids', 'palette', 'category_shape_reason', 'category_counts', 'category_departures', 'repair_changes', 'piece_jobs']
  }
}

// The qualitative half of the Step 5 correction (docs/capsule-step5-evaluation.md
// §4, "enforcement boundary"). Every judgment added below is relational and
// visual — hero/support balance, whether a shoe is credible for this season,
// whether a piece earns a job distinct from its neighbours. The evaluation is
// explicit that a keyword rule, a numeric taste score, or a larger hard quota
// would put that judgment in the wrong layer, so it arrives as brief here and
// is checked by deterministic structure only where structure can decide.
//
// Used verbatim for both the initial call and the bounded repair, so a repair
// cannot silently drop the standard the first attempt was held to.
export function capsuleRosterSelectionSystemPrompt() {
  return `You are choosing the garments for a seasonal capsule wardrobe. The conversational stylist has already interpreted the request and fixed the use-case slots; a deterministic engine has already gated the candidates you are given.

Pick exactly the requested number of pieces from the supplied candidates, using their IDs. Choose ONLY from the candidate list — nothing else exists for this task.

A capsule is a set, not a ranked list of good garments. Judge the pieces against each other: what recombines, what earns its place, what is redundant beside something already chosen. A garment that is excellent alone and duplicates another choice is a worse pick than a plainer one that unlocks new outfits.

Cover every requested use case. A roster with a beautiful palette that leaves one use case unwearable is a failed roster — the engine will reject it and you will get one chance to repair it. Make sure each use case can form complete outfits, with shoes that suit it.

Coverage is not the same as shape. A set of separates can technically dress every use case while still being the wrong capsule: dresses are complete outfit cores that carry their own occasions and cost one place instead of two, so a capsule that drops them has traded away capacity, not just variety. The category shape you are given below is what a capsule this size is actually made of — build to it unless you can say why this wardrobe or these use cases call for something different.

Every place in this capsule is finite, and one piece taking a place is another piece not taken. Before you finalise, check the set against all four of these:

1. PROTAGONISTS. A capsule needs pieces that lead, pieces that support them, and pieces that ground the whole set. Aim for more than one visually distinct option that can lead a look, serving more than one of the requested contexts — not one token expressive garment surrounded by quiet basics, and not a crowd of pieces all competing for the same job. Judge this from the photographs: a garment that reads expressive in its written description can still read flat in the image, and the image is what the person will wear.

2. INDEPENDENT WEARABILITY. In a finite capsule, default to independently wearable garments — a piece that always needs something else under or over it costs two places to produce one look, it and its base each taking a separate slot out of the fixed budget, not one shared slot. This is a settled, deliberately harder rule, not a passing preference: select a piece that needs a base only when its distinctive contribution clearly outweighs the flexibility lost to that required base. When candidate statement/hero pieces exist, prefer standalone statement pieces over pieces that require a base layer ('needs_base: yes'), unless the prompt explicitly asks for layering. If a comparable standalone option exists in the candidates, choose the standalone option. This is not a ban — an exceptional piece (a genuinely singular hero top, an overlay nothing else in the wardrobe replaces) can still earn its two-slot cost — but the bar is now "clearly outweighs," not merely "earns its cost." Do not treat this as automatically satisfied by demonstrating the piece well or by giving two dependents different bases; that shows the composer can execute the pairing, not that the roster was right to spend two slots on it when a standalone alternative existed.

When you do take a piece that needs a base, its base must be a genuine visual match, not merely present: check opacity and coverage (an open-weave or sheer base does not conceal what it needs to), neckline and strap or sleeve shape, length, bulk, and colour relationship — whether the base is meant to stay hidden or to show intentionally as part of the look. "A tank exists in the roster" is not sufficient; the tank has to actually sit right under that particular construction. Weigh which kind of dependency this is: a strong one, where the base also works alone, supports another piece, and appears in other looks — a connector with multiple jobs, more likely to justify the second slot — versus a weak one, where the base exists only to make this one piece wearable, is never shown alone, and produces only a look or two. A weak dependency needs unusual visual strength, useful context coverage, or a role nothing else in the set fills to justify itself at all. If you do take more than one piece that needs a base, each one individually has to clear this bar on its own merits — giving them different bases is necessary, but it does not by itself justify either one's two-slot cost.

3. FOOTWEAR THAT SUITS THE SEASON AND THE CONTEXTS. A shoe passing the engine's gates only means it is technically eligible. Ask instead whether you would actually wear it in this season for these use cases, and what job it does that another chosen pair does not. Cover each materially different footwear job the lifestyle asks for — such as home/casual wear, walking-heavy city days, nature walks, weather, or polished social occasions. One versatile shoe may cover more than one job; do not manufacture duplicates from the number of representative outfits requested.

4. A DISTINCT JOB PER PIECE. Every piece you take should answer "what does this do that nothing else here does?" If your own job line for a piece could be written about another piece you already chose, one of them is the wrong pick.

PALETTE CONTRACT. The neutral foundation is automatic; the person does not have to choose or repeat neutrals. Aim for about 70% neutral or neutral-adjacent pieces, with 60–75% accepted. Colours named by the person are the ACCENT colour families for the remaining places. Neutrals are always allowed. Do not substitute an unrelated accent colour: if an eligible requested family is unavailable, keep that place neutral and say which family was unavailable in the palette line. Coverage may change which neutral garment you choose, but it does not license a random accent.

The requested colour may do ANY visual job: protagonist, support, grounding, print, layer, dress, or shoe. Never require a requested colour to appear in a hero piece.

State the neutral foundation and requested accent colours you built around in your own words.

Count the selected IDs by their supplied category and return those totals in category_counts. Do not count from memory: reconcile all selected IDs against the candidate records before answering.

In category_shape_reason, say whether you followed the supplied category shape. For every target you departed from, add one category_departures entry with the category, target count, selected count, and the concrete wardrobe or use-case reason. Return an empty category_departures array when every target is met. Do not use aesthetic preference alone to justify missing a hard requirement.

On an initial selection, return an empty repair_changes array. On a repair, record every one-for-one swap with the removed ID, added ID, and the structural problem that swap fixes. If you cannot fix a stated failure from the candidates, say why in category_shape_reason; never return an unchanged rejected roster without explaining why.

For every selected ID, give exactly one piece_jobs entry naming the job it does in this capsule. Include no unselected IDs and do not repeat an ID. Write it for the wearer, not as engine vocabulary: what it is for and what it goes with. Do not restate the garment's own description.

Use the supplied structured garment truth and photographs together: the record is authoritative for fabric, formality and rules; the photograph is how you judge how a piece actually reads and whether two pieces belong in one wardrobe.`
}

// A repair is a correction, not a fresh brief: the structural failures are
// exact and must be fixed, and the four judgments in the system brief still
// apply to whatever the fix displaces — otherwise "swap a shoe for a layer" can
// be satisfied by any layer at all.
//
// Its own function because of WHERE it has to sit in the provider payload. The
// initial call and the repair differ only by this block, so everything before
// it — season, size, palette, owner rules, slots, and the (long) candidate
// catalog with one thumbnail per bench piece — is a byte-identical prefix worth
// caching. Concatenating the repair onto the END of that prefix still breaks
// it: a prompt cache matches on prefix, so a single differing character in the
// first content block invalidates every breakpoint after it, and the repair
// call re-pays for all ~70 images. Kept separate so the provider payload can
// put the volatile part AFTER both cache breakpoints, which is the same
// "VOLATILE TAIL SECOND" ordering the whole-wardrobe composer already uses.
export function capsuleRosterRepairText({ failures = [], previousRosterIds = [] } = {}) {
  return `YOUR PREVIOUS SELECTION WAS REJECTED. Previous IDs: [${(previousRosterIds || []).join(', ')}]
Fix exactly these problems, keeping the rest of your selection:
${(failures || []).map(entry => `- ${entry.message}`).join('\n')}

The replacements you bring in are held to the same standard as the original picks: protagonists, independent wearability, seasonally credible footwear, and a distinct job per piece. Whatever you drop to make room should be the piece with the weakest job, not simply the easiest one to remove.`
}

// Extracted from the provider call so both the initial and the repair contract
// are assertable offline, with no provider and no images. The repair block is
// the only difference between them by construction.
//
// Returns the COMPLETE user text including the repair block, which is what the
// offline contract tests assert against. The provider path deliberately calls
// the two halves separately (see chooseCapsuleRosterWithProvider) so the cache
// prefix survives; this function stays whole so "what did the model actually
// read" remains answerable from one call.
// A practitioner-formula starting allocation, stated to the model as guidance.
// Two live runs (thread_1785711580188, thread_1785883879348)
// exhausted their repair round and fell back to the deterministic roster after
// selecting ZERO dresses — while this text told them season, size, palette,
// owner rules, use cases and candidates, and nothing about category shape.
//
// The figures come from example capsule breakdowns, not a universal standard.
// They must yield to the lived use cases supplied by the conversational intake.
function capsuleAllocationBlock(quotas = null, budget = 24) {
  if (!quotas || typeof quotas !== 'object') return ''
  const line = ['top', 'bottom', 'dress', 'outerwear', 'shoes']
    .map(group => `${group === 'outerwear' ? 'layers' : group}: ${Number(quotas[group]) || 0}`)
    .join(' · ')
  return `

CATEGORY STARTING SHAPE FOR ${budget} PIECES — ${line}
This is planning guidance from common capsule examples, not a validity formula. Adapt it to the supplied lifestyle jobs, climate, owner rules and actual candidates. Dresses and layers earn places only when they serve those facts; do not add or remove them merely to hit a category number. Explain every departure in category_departures.`
}

function capsulePaletteBlock(palette = [], budget = 24) {
  const neutral = capsuleNeutralBasePlan(budget)
  const accents = Array.isArray(palette) ? palette : []
  const mappings = accents.map(color => `${color} → ${colorFamilyLabel(colorTaxonomyEntry(color).family)}`)
  return `

PALETTE PLAN FOR ${budget} PIECES — neutral foundation target ${neutral.target}; accepted range ${neutral.minimum}–${neutral.maximum}.
${accents.length
    ? `ACCENT COLOURS THE PERSON CHOSE: ${accents.join(', ')}. CANONICAL FAMILY MAPPING: ${mappings.join(' · ')}. These are additions to the automatic neutral foundation, not the whole capsule palette. Use only the mapped non-neutral families; if an eligible family is unavailable, use another neutral and name the unavailable family.`
    : 'NO ACCENT COLOURS WERE CHOSEN. Build the automatic neutral foundation and choose a restrained, coherent accent story from the eligible garments.'}`
}

export function capsuleRosterSelectionUserText({
  bench = [], slots = [], budget = 24, palette = [], isSummer = false, isWinter = false,
  quotas = null, attempt = 1, failures = [], previousRosterIds = [], ownerRules = [], acceptedLessons = ''
} = {}) {
  const truthCatalog = bench.map(piece => `ID ${piece.id}: ${buildPieceText(piece)}`)
  const slotLines = slots.map(slot => `- ${slot.label} (${slot.occasion || 'general'}${slot.activity && slot.activity !== 'none' ? `, ${slot.activity}` : ''}${slot.environment ? `, ${slot.environment}` : ''}): ${slot.bestFor || slot.label}`)
  const repairBlock = attempt > 1
    ? `\n\n${capsuleRosterRepairText({ failures, previousRosterIds })}`
    : ''
  // Previously reached the composer (buildPlanSlotWorkbench's instructions)
  // but never the roster pick itself — a stored rule like "avoid maxi skirts
  // at work" could keep an unsuitable piece out of every COMPOSED look while
  // it still spent a roster slot the composer then had nothing to do with.
  // Placed early, right after the fixed facts (season/size/palette) and
  // before the — often long — candidate catalog: this codebase has already
  // measured stored rules losing out from tail position (spec 25/26,
  // workbenchInstructions), so keep it close to where attention starts.
  const ownerRulesBlock = Array.isArray(ownerRules) && ownerRules.length
    ? `\n\nOWNER RULES — hard requirements, not suggestions. Do not construct exceptions or conditional workarounds. If a rule makes a genuinely usable roster impossible, say so in your palette line rather than bending the rule. Apply to every piece you select: ${ownerRules.map(rule => `"${rule}"`).join('; ')}`
    : ''
  const acceptedLessonsBlock = String(acceptedLessons || '').trim()
    ? `\n\nOWNER-ACCEPTED APPLICABLE LESSONS — bounded prompt guidance for the candidates and use cases below; respect each stated boundary:\n${acceptedLessons}`
    : ''
  return `SEASON: ${isWinter ? 'winter' : isSummer ? 'summer' : 'unspecified'}
CAPSULE SIZE: exactly ${budget} pieces
${capsulePaletteBlock(palette, budget)}${ownerRulesBlock}${acceptedLessonsBlock}${capsuleAllocationBlock(quotas, budget)}

USE CASES THIS CAPSULE MUST COVER:
${slotLines.join('\n')}

CANDIDATES:
${truthCatalog.join('\n')}${repairBlock}`
}

// The provider payload, assembled from parts so the cache-prefix invariant is
// assertable offline with no provider, no image files, and no network. Takes
// the already-loaded thumbnail parts because loading them is the only step that
// needs the filesystem.
//
// The invariant this shape exists to hold: for a given bench, everything from
// content[0] through the last cache_control breakpoint is IDENTICAL on attempt
// 1 and attempt 2, so the repair reads the cache the initial call wrote instead
// of re-paying for every thumbnail.
export function capsuleRosterSelectionContent({
  bench = [], slots = [], budget = 24, palette = [], isSummer = false, isWinter = false,
  quotas = null, ownerRules = [], acceptedLessons = '', attempt = 1, failures = [], previousRosterIds = [], imageParts = []
} = {}) {
  // STABLE PREFIX FIRST. Built with attempt:1 unconditionally — passing the
  // real `attempt` here would append the repair text to this block and
  // invalidate the prefix, which is the only place in a single run where a
  // cache hit was ever possible. The caching would then cost the creation
  // premium twice and return nothing.
  const content = [{
    type: 'text',
    text: capsuleRosterSelectionUserText({
      bench, slots, budget, palette, isSummer, isWinter, quotas, ownerRules, acceptedLessons,
      attempt: 1, failures: [], previousRosterIds: []
    }),
    cache_control: { type: 'ephemeral' }
  }]
  content.push(...imageParts)
  if (content.length > 1) {
    content[content.length - 1] = {
      ...content[content.length - 1],
      cache_control: { type: 'ephemeral' }
    }
  }
  // VOLATILE TAIL LAST — after both breakpoints, so it changes nothing the
  // cache covers. The repair reaches the model with the same wording it always
  // had; it just no longer sits in front of the thumbnails.
  if (attempt > 1) {
    content.push({ type: 'text', text: capsuleRosterRepairText({ failures, previousRosterIds }) })
  }
  return content
}

// Exported for scratch/_capsule_model_chooser.js, the model side of the
// deterministic-vs-model roster revalidation. The harness calls this production
// function directly so it measures the path that ships.
export async function chooseCapsuleRosterWithProvider({ bench, slots, budget, palette, isSummer, isWinter, quotas, attempt, failures, previousRosterIds, ownerRules }, toolContext) {
  // Photographs for the candidates, same reasoning as the composer: this stage
  // is more aesthetic than composition, and until now it was the blind one.
  // Hero, printed, and accent pieces use 800px maxPx/auto detail for high visual
  // clarity, while solid neutral basics use 448px low detail to optimize tokens.
  const imageParts = []
  for (const piece of bench) {
    const photoFile = piece.worn_photo || piece.photo || ''
    if (!photoFile) continue
    const filePath = path.join(userUploadsDir(), photoFile)
    if (!fs.existsSync(filePath)) continue
    try {
      const { maxPx, detail } = pieceVisualDetailPolicy(piece)
      const thumb = await prepareWardrobeThumb(filePath, `capsule-roster:${piece.id}:${maxPx}:${photoFile}`, { maxPx })
      imageParts.push({ type: 'text', text: `ID ${piece.id}: ${piece.name}` })
      imageParts.push({ type: 'image', detail, source: { type: 'base64', media_type: thumb.media_type, data: thumb.data } })
    } catch (err) {
      console.error(`Error loading capsule roster thumbnail for piece ${piece.id}:`, err)
    }
  }

  const capsuleSeason = isSummer ? 'summer' : (isWinter ? 'winter' : '')
  const acceptedLessons = getAcceptedFeedbackSynthesisMemory(8, {
    pieceIds: bench.map(piece => piece.id),
    contexts: slots.map(slot => projectStylingApplicabilityContext(slot?.stylingContext || {}, {
      occasion: slot?.occasion || '',
      activity: slot?.activity || '',
      season: slot?.requestedSeason || slot?.transitSeason || slot?.season || capsuleSeason,
      currentDate: slot?.stylingContext?.date || slot?.date || null,
      weatherText: [slot?.weather, slot?.environment, slot?.bestFor].filter(Boolean).join(' '),
      requestText: [slot?.label, slot?.occasion, slot?.activity, slot?.bestFor].filter(Boolean).join(' '),
    })),
  })
  const content = capsuleRosterSelectionContent({
    bench, slots, budget, palette, isSummer, isWinter, quotas, ownerRules, acceptedLessons,
    attempt, failures, previousRosterIds, imageParts
  })

  const { value, usage } = await askStylistStructuredWithUsage({
    system: capsuleRosterSelectionSystemPrompt(),
    messages: [{ role: 'user', content }],
    schema: capsuleRosterSelectionSchema(budget),
    name: 'capsule_roster_selection',
    description: 'Choose the garments for this capsule from the supplied candidates.',
    // The live 24-piece responses were already consuming the old 1,260-token
    // ceiling before category rationale and repair accounting were added.
    maxTokens: Math.max(900, 300 + budget * 65)
  })
  if (toolContext) recordToolLoopUsage(toolContext, usage)
  return value || {}
}

// Step 5 criterion 8: the rotation is the capsule's evidence, so it has to
// demonstrate what the roster claims. The roster-specific version of this
// ("show the layer, show each dependent piece over a different base, give each
// shoe pair a look that calls for it") is built per run in
// buildPlanSlotWorkbench's instructions, because it depends on what was
// actually selected; this states the standing principle those instructions are
// an instance of.
export function capsulePlanCompositionSystemPrompt() {
  return `You are the composition stage of a capsule-planning tool. The conversational stylist has already interpreted the request, chosen the use-case slots, and fixed the capsule roster.

The rotation is what proves the capsule works. Every piece in the roster was chosen for a job, so the set of looks you return must demonstrate those jobs — a layer worn somewhere, a piece that cannot stand alone shown over a base, a specialised shoe in a look that genuinely calls for it — and not merely touch most of the pieces. A rotation that uses almost every ID while never showing a whole function has not demonstrated the capsule. Where a piece's job genuinely cannot be shown well, say so plainly in the reason of the look that comes closest rather than passing over it in silence.

Return the complete representative rotation in one structured response. Use only each slot's allowed_piece_ids and submit exactly its target_outfits count. The schema requires the exact total; never return an empty or partial outfits array. Follow every submission_requirement literally. Every look needs a distinct main core: a different top+bottom pair, or a different dress — this is enforced across the ENTIRE rotation you submit, not just within one slot, so a look can repeat another slot's core and still be rejected. Do not add accessories. Keep titles and reasons concise so the complete rotation fits comfortably. Prefer combinations whose visual relationship you can judge confidently from the supplied structured garment truth. Do not rely solely on 'allowed_piece_ids' as proof of occasion fit. Allowed pieces include the whole roster; you must read each piece's explicit formality (\`lounge\`, \`everyday\`, \`elevated\`, \`dressy\`) and explicit occasions (\`home\`, \`casual\`, \`smart-casual\`, \`evening\`) in the piece catalog lines. Never assign a piece tagged \`lounge\` or \`home\` to a \`smart-casual\` or \`elevated\` slot when higher-register options exist in that slot's roster. The slot's best_for text is the lived scenario, not decorative copy: a broad occasion tag only says a piece is eligible, and does not override a garment record that says it is weak for the specific lived context (for example, home versus errands). When a slot combines adjacent contexts, state the narrower context the look genuinely serves instead of claiming it works for all of them. Every requested slot has already passed deterministic capacity checks; choose the strongest valid combinations from its allowed roster. Never reinterpret, rename, split, merge, or add slots.

TOP + DRESS LAYERING: A top may be worn over a dress as an overlay, or under a dress as a base layer, but only when the supplied garment truth explicitly supports that direction. A top merely appearing beside a dress in allowed_piece_ids is not evidence of a layering relationship. Otherwise use the dress without the top.

STYLE CONSTITUTION — BODY CONTRACT:
${prompts.BODY_CONTRACT}

PROVEN FORMULAS:
${prompts.PROVEN_FORMULAS}

AESTHETIC GRAVITY:
${prompts.AESTHETIC_GRAVITY}

LANE NEUTRALITY:
${prompts.LANE_NEUTRALITY}

WORKING STYLE:
${prompts.WORKING_STYLE}`
}

async function composeCapsulePlanOnce(workbench, toolContext) {
  const targetOutfitCount = (workbench.slots || [])
    .reduce((sum, slot) => sum + Math.max(0, Number(slot?.target_outfits) || 0), 0)
  const rosterIds = [...new Set((workbench.slots || [])
    .flatMap(slot => Array.isArray(slot?.allowed_piece_ids) ? slot.allowed_piece_ids : [])
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0))]
  const rosterPieces = rosterIds.length
    ? db.prepare(`SELECT * FROM pieces WHERE status = 'active' AND id IN (${rosterIds.map(() => '?').join(',')})`)
      .all(...rosterIds)
      .map(parsePiece)
    : []
  const truthCatalog = rosterPieces.map(piece => `ID ${piece.id}: ${buildPieceText(piece)}`)
  const promptPayload = {
    instructions: workbench.instructions,
    constraints: workbench.constraints,
    slots: workbench.slots,
    // Full garment truth is intentional here. The ordinary workbench's compact
    // line omits garment-intelligence pairing requirements and do-not-pair
    // rules; that omission allowed a relaxed hoodie under a relaxed cardigan
    // even though both records explicitly prohibit another loose top.
    piece_catalog: truthCatalog.length ? truthCatalog : workbench.piece_catalog
  }
  const content = [{
    type: 'text',
    text: `Compose this fixed capsule workbench:\n${JSON.stringify(promptPayload)}\n\nThe following thumbnails are the visual evidence for the same fixed roster. Judge silhouette, volume, texture, and physical layering by sight; stored authoritative rules still win.`,
    cache_control: { type: 'ephemeral' }
  }]
  const visuallySeenIds = []
  for (const piece of rosterPieces) {
    const photoFile = piece.worn_photo || piece.photo || ''
    if (!photoFile) continue
    const filePath = path.join(userUploadsDir(), photoFile)
    if (!fs.existsSync(filePath)) continue
    try {
      const thumb = await prepareWardrobeThumb(filePath, `capsule-plan:${piece.id}:${photoFile}`, { maxPx: 800 })
      content.push({ type: 'text', text: `ID ${piece.id}: ${piece.name}` })
      content.push({
        type: 'image',
        detail: 'auto',
        source: { type: 'base64', media_type: thumb.media_type, data: thumb.data }
      })
      visuallySeenIds.push(Number(piece.id))
    } catch (err) {
      console.error(`Error loading atomic capsule thumbnail for piece ${piece.id}:`, err)
    }
  }
  if (content.length > 1) {
    content[content.length - 1] = {
      ...content[content.length - 1],
      cache_control: { type: 'ephemeral' }
    }
  }
  if (!(toolContext.retrievedPieceIds instanceof Set)) toolContext.retrievedPieceIds = new Set()
  if (!(toolContext.visuallySeenPieceIds instanceof Set)) toolContext.visuallySeenPieceIds = new Set()
  for (const piece of rosterPieces) toolContext.retrievedPieceIds.add(Number(piece.id))
  for (const id of visuallySeenIds) toolContext.visuallySeenPieceIds.add(id)
  const { value, usage } = await askStylistStructuredWithUsage({
    system: capsulePlanCompositionSystemPrompt(),
    messages: [{ role: 'user', content }],
    schema: capsulePlanCompositionSchema(targetOutfitCount),
    name: 'capsule_plan_composition',
    description: 'Compose the complete representative capsule rotation from the fixed roster and slots.',
    // A 12-look rotation with IDs, titles, and reasons can legitimately exceed
    // the old 1,600-token ceiling. This is a ceiling, not prepaid usage: concise
    // responses cost only what they emit, while truncation no longer pressures
    // the model toward an empty array.
    maxTokens: Math.max(1600, Math.min(3200, 600 + (targetOutfitCount * 180)))
  })
  // This nested composition call is part of the same paid user turn and must
  // appear in the existing usage/cost diagnostics alongside outer tool-loop
  // iterations.
  recordToolLoopUsage(toolContext, usage)
  toolContext.freeformDiagnostics.atomicCapsuleVisualPieces = visuallySeenIds.length
  return Array.isArray(value?.outfits) ? value.outfits : []
}

// A capsule expansion is deliberately not a freeform tool loop. The original plan already paid
// to choose the roster and resolve the slot's weather/register context. Reusing that structured
// state turns "show one more" into one bounded composition call: no declare/search/view/propose
// chain, no broad wardrobe retrieval, and no silent corrective retry. The result still passes the
// same deterministic submit_plan_outfits validator before it can become a card.
router.post('/expand-capsule', async (req, res) => {
  try {
    const context = normalizedCapsuleExpansionContext(req.body?.planContext || {})
    if (context.version !== 1 || !context.rosterIds.length || !context.slots.length) {
      return res.status(400).json({ error: 'This capsule predates reusable expansion state. Regenerate the capsule before requesting additional looks.' })
    }
    const requestedSlotId = String(req.body?.slotId || '').trim()
    const requestedSlotLabel = String(req.body?.slotLabel || '').trim()
    const contextSlot = context.slots.find(slot =>
      (requestedSlotId && slot.id === requestedSlotId) ||
      (requestedSlotLabel && slot.label === requestedSlotLabel)
    )
    if (!contextSlot) return res.status(400).json({ error: 'The requested capsule use case was not found in the saved plan state.' })

    const placeholders = context.rosterIds.map(() => '?').join(',')
    const roster = db.prepare(`SELECT * FROM pieces WHERE status = 'active' AND id IN (${placeholders})`)
      .all(...context.rosterIds)
      .map(parsePiece)
    const piecesById = new Map(roster.map(piece => [Number(piece.id), piece]))
    const allowedIds = new Set(contextSlot.allowedIds.filter(id => piecesById.has(id)))
    const allowedPieces = [...allowedIds].map(id => piecesById.get(id)).filter(Boolean)
    if (!allowedPieces.length) return res.status(409).json({ error: 'No active pieces remain in this capsule slot roster.' })

    const existingOutfits = (Array.isArray(req.body?.existingOutfits) ? req.body.existingOutfits : [])
      .slice(0, 20)
      .map(outfit => {
        const pieceIds = (Array.isArray(outfit?.pieceIds) ? outfit.pieceIds : [])
          .map(Number).filter(id => piecesById.has(id))
        return {
          ...outfit,
          pieceIds,
          pieces: pieceIds.map(id => piecesById.get(id)),
          _slotId: outfit?.tripSlot || outfit?._slotId || ''
        }
      })
      .filter(outfit => outfit.pieceIds.length)
    const existingCoreLines = existingOutfits.map(outfit =>
      `${outfit.title || outfit.label || 'Existing look'}: [${outfit.pieceIds.join(', ')}]`
    ).join('\n')
    const usedSlotCores = new Set(existingOutfits
      .filter(outfit => !outfit._slotId || outfit._slotId === contextSlot.id)
      .map(outfit => capsuleExpansionCoreKey(outfit.pieces))
      .filter(Boolean))
    const slotCoreCapacity = contextSlot.coreCapacity ?? capsuleOutfitCoreCapacity(allowedPieces, [{
      ...contextSlot,
      gateAllowedIds: allowedIds
    }])
    if (usedSlotCores.size >= slotCoreCapacity) {
      return res.status(409).json({
        error: `Full available rotation shown for ${contextSlot.label}; this capsule roster has no unused outfit core for that use case.`,
        debug: { providerCalls: 0, usedCores: usedSlotCores.size, coreCapacity: slotCoreCapacity }
      })
    }
    const catalog = allowedPieces
      .map(piece => `ID ${Number(piece.id)}: ${buildPieceText(piece)}`)
      .join('\n')
    const userPrompt = `CAPSULE SLOT
id: ${contextSlot.id}
label: ${contextSlot.label}
occasion: ${contextSlot.occasion}
activity: ${contextSlot.activity}
environment: ${contextSlot.environment || 'unspecified'}
register: ${contextSlot.register || 'unspecified'}
weather already resolved: ${contextSlot.weatherLabel || 'unspecified'}

EXISTING CAPSULE LOOKS — do not repeat their main top+bottom pair or dress:
${existingCoreLines || '(none)'}

ALLOWED CAPSULE PIECES:
${catalog}`
    const { value: parsed, usage } = await askStylistStructuredWithUsage({
      system: capsuleExpansionSystemPrompt(),
      messages: [{ role: 'user', content: userPrompt }],
      schema: CAPSULE_EXPANSION_SCHEMA,
      name: 'capsule_expansion',
      description: 'Select exactly one additional outfit from the supplied capsule roster.',
      maxTokens: 400
    })
    const submission = {
      slot_id: contextSlot.id,
      title: String(parsed?.title || '').trim(),
      piece_ids: Array.isArray(parsed?.piece_ids) ? parsed.piece_ids : [],
      reason: String(parsed?.reason || '').trim()
    }
    const slot = {
      ...contextSlot,
      targetOutfits: 1,
      allowedPieces,
      rosterIds: allowedIds,
      gateAllowedIds: allowedIds,
      suppressedReasonsById: new Map()
    }
    const pendingPlan = {
      slots: [slot],
      piecesById,
      heldOutfits: existingOutfits,
      constraints: {
        reuse: 'maximize',
        noRepeat: new Set(),
        allowRepeat: new Set(['shoes']),
        anchorIds: new Set(),
        pieceBudget: context.pieceBudget
      },
      isWinterCapsule: context.isWinterCapsule
    }
    const { accepted, failures } = validateSubmittedPlanOutfits(pendingPlan, [submission])
    if (!accepted.length) {
      return res.status(422).json({
        error: 'The single capsule-expansion attempt did not produce another valid look. No automatic retry was made.',
        validationFailures: failures,
        debug: { providerCalls: 1, usage, estimatedCost: estimateAiUsageCost(usage) }
      })
    }
    const acceptedOutfit = accepted[0]
    const structuredOutfit = normalizeOutfitResult({
      ...acceptedOutfit,
      label: contextSlot.label,
      title: acceptedOutfit.title || contextSlot.label,
      bestFor: contextSlot.label,
      occasion: contextSlot.occasion,
      activity: contextSlot.activity,
      tripSlot: contextSlot.id,
      coverage: contextSlot.label,
      coveragePosition: `${contextSlot.label} · additional look`,
      slotWeather: contextSlot.weatherLabel,
      source: 'plan_outfit_set',
      composedBy: 'model',
      capsulePlanContext: req.body.planContext
    }, {
      disposition: 'accepted',
      provenance: { flow: 'capsule_expansion', source: 'plan_outfit_set', composedBy: 'model', stage: 'plan_validation' },
    })
    return res.json({
      answer: `Added one more ${contextSlot.label} look from the existing capsule roster.`,
      structuredOutfits: [structuredOutfit],
      structuredOutfitsSource: 'plan_outfit_set',
      debug: { providerCalls: 1, usage, estimatedCost: estimateAiUsageCost(usage) }
    })
  } catch (err) {
    console.error('Capsule expansion error:', err)
    const { status, message } = describeAiError(err)
    return res.status(status).json({ error: message })
  }
})

// Repairing a rejected capsule look needs no model at all. The rejection already
// names the blocked garment, the saved plan context already holds the slot's
// gate-passing roster, and the real validator can confirm a substitution — so
// this route swaps one piece and re-validates, with providerCalls: 0. It never
// falls back to a billed call: if no substitution from the saved roster passes,
// that is a fact about the capsule worth telling the person, not a prompt to
// spend money guessing.
router.post('/repair-capsule-look', async (req, res) => {
  try {
    const context = normalizedCapsuleExpansionContext(req.body?.planContext || {})
    if (context.version !== 1 || !context.rosterIds.length || !context.slots.length) {
      return res.status(400).json({ error: 'This capsule predates in-place repair. Regenerate the capsule to fix looks from the card.' })
    }
    const requestedSlotId = String(req.body?.slotId || '').trim()
    const contextSlot = context.slots.find(slot => slot.id === requestedSlotId)
    if (!contextSlot) return res.status(400).json({ error: 'The requested capsule use case was not found in the saved plan state.' })

    const placeholders = context.rosterIds.map(() => '?').join(',')
    const roster = db.prepare(`SELECT * FROM pieces WHERE status = 'active' AND id IN (${placeholders})`)
      .all(...context.rosterIds)
      .map(parsePiece)
    const piecesById = new Map(roster.map(piece => [Number(piece.id), piece]))
    const allowedIds = new Set(contextSlot.allowedIds.filter(id => piecesById.has(id)))
    const allowedPieces = [...allowedIds].map(id => piecesById.get(id)).filter(Boolean)
    if (!allowedPieces.length) return res.status(409).json({ error: 'No active pieces remain in this capsule slot roster.' })

    const originalIds = (Array.isArray(req.body?.pieceIds) ? req.body.pieceIds : []).map(Number).filter(Boolean)
    if (!originalIds.length) return res.status(400).json({ error: 'The look being repaired has no pieces to work from.' })
    const blockedIds = (Array.isArray(req.body?.blockedPieceIds) ? req.body.blockedPieceIds : []).map(Number).filter(Boolean)

    const existingOutfits = (Array.isArray(req.body?.existingOutfits) ? req.body.existingOutfits : [])
      .slice(0, 20)
      .map(outfit => {
        const pieceIds = (Array.isArray(outfit?.pieceIds) ? outfit.pieceIds : []).map(Number).filter(id => piecesById.has(id))
        return { ...outfit, pieceIds, pieces: pieceIds.map(id => piecesById.get(id)), _slotId: outfit?.tripSlot || outfit?._slotId || '' }
      })
      .filter(outfit => outfit.pieceIds.length)

    const slot = {
      ...contextSlot,
      targetOutfits: 1,
      allowedPieces,
      rosterIds: allowedIds,
      gateAllowedIds: allowedIds,
      suppressedReasonsById: new Map()
    }
    const pendingPlan = {
      slots: [slot],
      piecesById,
      heldOutfits: existingOutfits,
      constraints: {
        reuse: 'maximize',
        noRepeat: new Set(),
        allowRepeat: new Set(['shoes']),
        anchorIds: new Set(),
        pieceBudget: context.pieceBudget
      },
      isWinterCapsule: context.isWinterCapsule
    }

    // Replace the blocked garment when the rejection named one; otherwise the
    // rejection was about the look as a whole (a repeated core, say), so try
    // each piece in turn. Candidates are the slot's own gate-passing roster,
    // so a swap can never smuggle in a piece the slot already excludes.
    const swapTargets = blockedIds.length ? blockedIds : originalIds
    const attempts = []

    // A look can fail for a piece that is WRONG or for a piece that is ABSENT,
    // and swapping only fixes the first. The live case: a dinner look submitted
    // with no shoes at all — every substitution failed, and the endpoint then
    // told the person "the pieces it would need are not in this capsule" while
    // the slot had five eligible shoes sitting in the roster. Complete the look
    // first; only then try substitutions.
    const structureGap = describeOutfitStructureGap(
      originalIds.map(id => piecesById.get(id)).filter(Boolean),
      { requireShoes: true }
    )
    const MISSING_GROUP_BY_GAP = [
      [/missing shoes/i, 'shoes'],
      [/missing bottom/i, 'bottom'],
      [/missing top or dress/i, 'top'],
    ]
    const missingGroup = (MISSING_GROUP_BY_GAP.find(([pattern]) => pattern.test(structureGap)) || [])[1]
    if (missingGroup) {
      const additions = allowedPieces
        .filter(piece => wardrobeCategoryGroup(piece) === missingGroup && !originalIds.includes(Number(piece.id)))
        .sort((a, b) => Number(a.id) - Number(b.id))
      const completion = validatedComplete({
        subject: originalIds,
        candidates: additions,
        mutate: (pieceIds, candidate) => [...pieceIds, Number(candidate.id)],
        validate: pieceIds => validateSubmittedPlanOutfits(pendingPlan, [{
          slot_id: contextSlot.id,
          title: String(req.body?.title || contextSlot.label || '').trim(),
          piece_ids: pieceIds,
          reason: ''
        }]),
        accept: validation => validation.accepted.length > 0,
        context: { flow: 'capsule_look', slotId: contextSlot.id, missingGroup },
      })
      if (completion.status === 'recovered') {
        attempts.push({ accepted: completion.validation.accepted[0], replaced: null, replacement: completion.candidate, added: true })
      }
    }
    for (const targetId of attempts.length ? [] : swapTargets) {
      const targetPiece = piecesById.get(targetId)
      const targetGroup = wardrobeCategoryGroup(targetPiece || {})
      const candidates = allowedPieces
        .filter(piece => wardrobeCategoryGroup(piece) === targetGroup && !originalIds.includes(Number(piece.id)))
        .sort((a, b) => Number(a.id) - Number(b.id))
      const substitution = validatedSubstitute({
        subject: originalIds,
        target: targetId,
        candidates,
        mutate: (pieceIds, candidate, replacedId) => pieceIds.map(id => id === replacedId ? Number(candidate.id) : id),
        validate: pieceIds => validateSubmittedPlanOutfits(pendingPlan, [{
          slot_id: contextSlot.id,
          title: String(req.body?.title || contextSlot.label || '').trim(),
          piece_ids: pieceIds,
          reason: ''
        }]),
        accept: validation => validation.accepted.length > 0,
        context: { flow: 'capsule_look', slotId: contextSlot.id, targetId },
      })
      if (substitution.status === 'recovered') {
        attempts.push({ accepted: substitution.validation.accepted[0], replaced: targetPiece, replacement: substitution.candidate })
      }
      if (attempts.length) break
    }

    if (!attempts.length) {
      return res.status(409).json({
        error: missingGroup
          ? `That look is missing ${missingGroup === 'shoes' ? 'shoes' : `a ${missingGroup}`}, and nothing in this capsule's roster for ${contextSlot.label} completes it.`
          : 'No single swap from this capsule roster fixes that look — the pieces it would need are not in this capsule.',
        debug: {
          providerCalls: 0,
          swapsTried: swapTargets.length,
          missingGroup: missingGroup || null,
          recoveryShortfall: discloseRecoveryShortfall({
            operation: missingGroup ? 'complete' : 'substitute',
            reason: 'capsule_roster_exhausted',
            context: { flow: 'capsule_look', slotId: contextSlot.id, missingGroup: missingGroup || null },
          }),
        }
      })
    }

    const { accepted: acceptedOutfit, replaced, replacement, added } = attempts[0]
    const recoveryOperation = added ? 'complete' : 'substitute'
    const structuredOutfit = normalizeOutfitResult({
      ...acceptedOutfit,
      label: contextSlot.label,
      title: acceptedOutfit.title || contextSlot.label,
      bestFor: contextSlot.label,
      occasion: contextSlot.occasion,
      activity: contextSlot.activity,
      tripSlot: contextSlot.id,
      coverage: contextSlot.label,
      coveragePosition: `${contextSlot.label} · repaired`,
      slotWeather: contextSlot.weatherLabel,
      source: 'plan_outfit_set',
      composedBy: 'engine',
      engineNote: added
        ? `Added ${replacement.name} — the look was missing ${missingGroup === 'shoes' ? 'shoes' : `a ${missingGroup}`}.`
        : `Swapped ${replaced?.name || 'the blocked piece'} for ${replacement.name}.`,
      capsulePlanContext: req.body.planContext
    }, {
      disposition: 'accepted',
      provenance: {
        flow: 'capsule_repair',
        source: 'plan_outfit_set',
        composedBy: 'engine',
        stage: 'validated_recovery',
        recovery: { operation: recoveryOperation },
      },
    })
    return res.json({
      answer: added
        ? `Fixed that ${contextSlot.label} look — added ${replacement.name}.`
        : `Fixed that ${contextSlot.label} look — swapped ${replaced?.name || 'the blocked piece'} for ${replacement.name}.`,
      structuredOutfits: [structuredOutfit],
      structuredOutfitsSource: 'plan_outfit_set',
      repairedPieceId: Number(replaced?.id) || null,
      debug: { providerCalls: 0 }
    })
  } catch (err) {
    console.error('Capsule repair error:', err)
    const { status, message } = describeAiError(err)
    return res.status(status).json({ error: message })
  }
})

router.post('/ask', async (req, res) => {
  // Hoisted so the catch below can still record what this turn spent and
  // learned. A turn that throws part-way has usually already made paid provider
  // calls — thread_1785902365403 completed and paid for a capsule roster call,
  // then died when the composition call hit an exhausted credit balance, and
  // the roster's outcome was lost entirely because the only persist ran on the
  // success path.
  let diagnosticsContext = null
  try {
    const currentQuestion = req.body.question || ''
    // Item 12's deferred fast path (feedback-routing-proposal.md): a simple, explicit, self-
    // contained prohibition needs no model turn at all — extractOwnerGuidanceApplicability already
    // resolves it deterministically. Applies regardless of thread state, since the whole point is
    // to skip the cost even inside an existing conversation (the measured case: five provider
    // iterations to store one sentence in an active trip thread). Anything the local extractor
    // can't confidently place falls through to the normal loop below, unchanged.
    const prohibitionApplicability = detectExplicitProhibition(currentQuestion)
    if (prohibitionApplicability) {
      const result = storeUserCorrection(currentQuestion, 'general', null, { guidanceApplicability: prohibitionApplicability })
      if (result.status === 'success') {
        const scopeText = describeOwnerGuidanceScope(prohibitionApplicability)
        return res.json({
          answer: scopeText ? `Got it — noted for ${scopeText}.` : 'Got it — noted.',
          savedCorrections: [{ note: currentQuestion, ...result }],
          renderedBoards: [],
          provider: 'local',
          // A plain acknowledgment, not a real conversational turn — the client must not offer
          // follow-up affordances (e.g. "Generate visual boards") that assume this reply actually
          // discussed the active piece/outfit context.
          isLocalAcknowledgment: true,
          structuredOutfits: [],
          structuredOutfitsSource: null,
          structuredOutfitsOccasion: null,
          structuredOutfitsSeason: null,
          structuredOutfitsMood: null,
          structuredOutfitsMission: null,
          structuredOutfitsActivity: null,
          debug: null,
          suggestedTitle: null,
        })
      }
    }
    const extractedWeather = req.body.weather || extractWeatherContext([
      req.body.question || '',
      req.body.threadContext || '',
      req.body.generatedContext || ''
    ].join('\n'))
    // A capsule often spans two turns: the first names the season/palette and
    // the second answers the stylist's lifestyle clarification. The plan tool
    // used to receive only turn two, silently dropping "in yellow" before
    // roster selection. Preserve the most recent user capsule request as plan
    // context; the current turn still wins when it is itself a capsule request.
    const planQuestion = capsulePlanQuestion(currentQuestion, req.body.history)
    const toolContext = {
      generatedOutfits: [],
      source: 'whole_wardrobe',
      occasion: req.body.occasion || 'casual',
      season: req.body.season || 'current season',
      weather: extractedWeather,
      mood: req.body.mood || '',
      mission: req.body.mission || 'mix',
      activity: req.body.activity || '',
      question: currentQuestion,
      planQuestion,
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
      activeContext: req.body.activeContext || null,
      // Step 4 (model-declared intent): set by the declare_intent tool; guards
      // and composing tools consume it instead of keyword-guessing.
      declaredIntent: null
    }
    // Point the hoisted reference at the live context as soon as it exists, so
    // anything that throws from here on still gets its diagnostics recorded.
    diagnosticsContext = toolContext
    // Correlates every ai_call_log row this turn's provider calls write (router, tool-loop
    // iterations, a nested composer call) back to this turn's freeform_generation_runs row. The
    // real numeric id doesn't exist until persistFreeformGenerationRun inserts it at the end of the
    // turn, so this token is the join key available at call time — see backfillFreeformRunId.
    const freeformTurnToken = randomUUID()
    toolContext.freeformTurnToken = freeformTurnToken
    updateAiTelemetryContext({ freeformTurnToken })
    // The freeform model still owns intent and slot decomposition. Once it
    // invokes plan_outfit_set with an enforced capsule budget, the tool may
    // use this one-shot structured composer instead of returning a workbench
    // that starts an open-ended submit/replan loop.
    toolContext.composeCapsulePlanOnce = workbench => composeCapsulePlanOnce(workbench, toolContext)
    // Stage 2 roster selection is opt-in. With the flag off, toolContext never
    // gets a chooser and the capsule path is byte-identical to what shipped.
    if (modelCapsuleRosterEnabled()) {
      toolContext.chooseCapsuleRoster = request => chooseCapsuleRosterWithProvider(request, toolContext)
    }
    const compactState = getStylistConversationState(req.body.sessionId || 'default') || {}
    const activePieceIdentities = db.prepare("SELECT id, name, photo, worn_photo FROM pieces WHERE status = 'active'").all()
    const exactNamedPieceIds = exactNamedPieceIdsFromQuestion(currentQuestion, activePieceIdentities)
    // A garment cited as "ID 127" never has a name for exactNamedPieceIdsFromQuestion to find, and
    // was previously invisible to the compact path unless it happened to already be in the current
    // outfit set — see thread_1787387145601 msg 7. Resolve only against real active pieces; an
    // unresolved mention is caught below by compactGarmentFactSubjectsIncomplete, not silently added.
    const explicitPieceIdMentions = explicitPieceIdMentionsFromQuestion(currentQuestion)
    const explicitResolvedPieceIds = explicitPieceIdMentions.filter(id =>
      activePieceIdentities.some(piece => Number(piece.id) === id)
    )
    const compactContext = compactFreeformContext({
      body: req.body,
      state: compactState,
      namedPieceIds: [...exactNamedPieceIds, ...explicitResolvedPieceIds]
    })
    const compactPieceIdSet = new Set(compactContext.pieceIds.map(Number))
    const compactSavedPhotoCount = activePieceIdentities.filter(piece =>
      compactPieceIdSet.has(Number(piece.id)) && (piece.photo || piece.worn_photo)
    ).length
    const boundedRouterEligible = String(req.body.conversationMode || 'new_request') === 'new_request'
      && !req.body.activeContext
      && !(Array.isArray(req.body.pieceIds) && req.body.pieceIds.length)
    // Without this, enabling compact answers bought a router call on every text turn — including
    // corrections and follow-ups that cannot reach a compact profile at all and pay the router on
    // top of the full loop. See compactRouterTurnHasContext for the rule and its accepted miss.
    const compactTurnHasContext = compactRouterTurnHasContext(req.body.conversationMode, compactContext)
    const compactRouterEligible = compactTurnHasContext
    if (!compactTurnHasContext) {
      bumpFreeformDiagnostic(toolContext, 'compactRouterSkippedNoContext')
    }
    const routerEligible = (boundedRouterEligible || compactRouterEligible)
      && !req.body.outfit
      && !req.body.image
      && !req.body.imageData
    if (routerEligible) {
      try {
        updateAiTelemetryContext({
          freeformTurnToken,
          subflow: 'execution_router',
          iterationIndex: nextFreeformCallIndex(toolContext),
          isRetry: false,
          retryReason: '',
          isNested: false,
        })
        const routed = await routeFreeformExecutionProfile({
          question: currentQuestion,
          currentDate: req.body.currentDate || '',
          timezone: req.body.timezone || 'America/Los_Angeles',
          contextSummary: [
            compactContext.outfits.length ? `verified current outfit set: ${compactContext.outfits.length} card(s)` : 'no current outfit set',
            compactContext.pieceIds.length ? `${exactNamedPieceIds.length ? 'exact active garment name resolved' : 'verified garment subjects available'}: ${compactContext.pieceIds.length}` : 'no verified garment subject',
            compactSavedPhotoCount ? `saved garment photographs available: ${compactSavedPhotoCount} resolved subject(s)` : 'no saved garment photographs for resolved subjects',
            req.body.activeContext?.type === 'piece' ? `active piece: ${req.body.activeContext.name || req.body.activeContext.id}` : ''
          ].filter(Boolean).join('; ')
        })
        recordToolLoopUsage(toolContext, routed.usage)
        bumpFreeformDiagnostic(toolContext, 'executionRouterCalls')
        recordFreeformToolIteration(toolContext, ['execution_router'])
        const routedLimit = Number(routed.value?.limit) || 0
        const compactProfile = isSavedPhotoWearMechanicsQuestion(currentQuestion, {
          exactSubjectCount: exactNamedPieceIds.length,
          savedPhotoCount: compactSavedPhotoCount
        })
          ? 'garment_fact'
          : routed.value?.profile
        if (compactProfile === 'wardrobe_inventory') {
          const categoryRows = db.prepare("SELECT category, COUNT(*) AS count FROM pieces WHERE status = 'active' GROUP BY category").all()
          const categoryCounts = Object.fromEntries(categoryRows.map(row => [String(row.category || 'other'), Number(row.count) || 0]))
          toolContext.freeformDiagnostics ||= {}
          toolContext.freeformDiagnostics.executionProfile = compactProfile
          recordFreeformToolIteration(toolContext, ['compact_wardrobe_inventory'])
          const freeformDiagnostics = toolContext.freeformDiagnostics
          persistFreeformGenerationRun({
            sessionId: req.body.sessionId || '', occasion: toolContext.occasion,
            diagnostics: freeformDiagnostics, turnFailed: false, freeformTurnToken
          })
          return res.json({
            answer: stripPieceIdCitations(formatWardrobeInventoryAnswer(categoryCounts)),
            savedCorrections: [], renderedBoards: [], provider: AI_PROVIDER,
            structuredOutfits: [], structuredOutfitsSource: null,
            structuredOutfitsOccasion: null, structuredOutfitsSeason: null,
            structuredOutfitsMood: null, structuredOutfitsMission: null,
            structuredOutfitsActivity: null, debug: freeformDiagnostics, suggestedTitle: null
          })
        }
        if (['existing_card_explanation', 'garment_fact', 'general_advice'].includes(compactProfile)) {
          const profileHasContext = compactProfileHasContext(compactProfile, compactContext)
          if (profileHasContext) {
            // "These shorts" names a category, not an exact piece or ID, so it never reaches
            // exactNamedPieceIds/explicitResolvedPieceIds — only try the recent-exchange referent
            // when the question alone gave nothing to go on, and only for garment_fact, where an
            // unresolved vague reference otherwise falls back to every piece in the accumulated
            // current-card set (thread_1787435527800 msg 16/17).
            const referentPieceIds = compactProfile === 'garment_fact' && !exactNamedPieceIds.length && !explicitResolvedPieceIds.length
              ? recentReferentPieceIds(currentQuestion, req.body.history, activePieceIdentities)
              : []
            const scopedPieceIds = referentPieceIds.length ? referentPieceIds : compactContext.pieceIds
            const compactPieces = scopedPieceIds.length
              ? db.prepare(`SELECT * FROM pieces WHERE status = 'active' AND id IN (${scopedPieceIds.map(() => '?').join(',')})`).all(...scopedPieceIds).map(parsePiece)
              : []
            // Every requested verified id must resolve. A deleted/resting/ambiguous subject falls
            // through to the full stylist rather than letting the compact model fill the gap. A
            // question naming two garments by ID where only one exists is the same kind of
            // incomplete evidence — see thread_1787387145601 msg 7: paying for a compact call that
            // can only ever say "I don't have the other one" is a predictably broken answer, not a
            // narrower one.
            const pieceScopeComplete = compactProfile !== 'garment_fact'
              || (compactPieces.length === scopedPieceIds.length
                && !compactGarmentFactSubjectsIncomplete(currentQuestion, scopedPieceIds))
            if (pieceScopeComplete) {
              const answerText = compactFreeformAnswerMessage({
                profile: compactProfile, question: currentQuestion, context: { ...compactContext, pieceIds: scopedPieceIds },
                pieces: compactPieces, state: compactState, history: req.body.history
              })
              const activeVisualPieceId = Number(req.body?.activeContext?.type === 'piece'
                ? req.body.activeContext.id
                : req.body?.pieceId)
              const preferredVisualIds = exactNamedPieceIds.length
                ? new Set(exactNamedPieceIds)
                : (referentPieceIds.length
                    ? new Set(referentPieceIds)
                    : (Number.isFinite(activeVisualPieceId) && activeVisualPieceId > 0
                        ? new Set([activeVisualPieceId])
                        : null))
              const visualPieces = preferredVisualIds
                ? compactPieces.filter(piece => preferredVisualIds.has(Number(piece.id)))
                : compactPieces
              const visualEvidence = compactProfile === 'garment_fact'
                ? await compactGarmentVisualEvidence(visualPieces)
                : []
              updateAiTelemetryContext({
                freeformTurnToken,
                subflow: 'compact_profile',
                iterationIndex: nextFreeformCallIndex(toolContext),
                isRetry: false,
                retryReason: '',
                isNested: false,
              })
              const answerCall = await askStylistWithUsage({
                system: compactFreeformAnswerSystem(compactProfile),
                messages: [{
                  role: 'user',
                  content: visualEvidence.length
                    ? [{ type: 'text', text: answerText }, ...visualEvidence]
                    : answerText
                }],
                maxTokens: 700
              })
              recordToolLoopUsage(toolContext, answerCall.usage)
              recordFreeformToolIteration(toolContext, [`compact_${compactProfile}`])
              toolContext.freeformDiagnostics ||= {}
              toolContext.freeformDiagnostics.executionProfile = compactProfile
              toolContext.freeformDiagnostics.compactVisualImages = visualEvidence.filter(block => block.type === 'image').length
              const freeformDiagnostics = toolContext.freeformDiagnostics || {}
              persistFreeformGenerationRun({
                sessionId: req.body.sessionId || '', occasion: toolContext.occasion,
                diagnostics: freeformDiagnostics, turnFailed: false, freeformTurnToken
              })
              return res.json({
                answer: stripPieceIdCitations(answerCall.text),
                savedCorrections: [], renderedBoards: [], provider: AI_PROVIDER,
                structuredOutfits: [], structuredOutfitsSource: null,
                structuredOutfitsOccasion: null, structuredOutfitsSeason: null,
                structuredOutfitsMood: null, structuredOutfitsMission: null,
                structuredOutfitsActivity: null, debug: freeformDiagnostics, suggestedTitle: null
              })
            }
          }
        }
        if (String(req.body.conversationMode || 'new_request') === 'new_request' && routed.value?.profile === 'bounded_multi' && routedLimit >= 2 && routedLimit <= 5) {
          toolContext.turnMode = 'new_request'
          toolContext.freeformDiagnostics ||= {}
          toolContext.freeformDiagnostics.executionProfile = 'bounded_multi'
          recordFreeformToolIteration(toolContext, ['generate_outfits'])
          await executeTool('generate_outfits', {
            occasion: routed.value.occasion,
            activity: routed.value.activity,
            season: routed.value.season,
            mood: routed.value.mood,
            mission: routed.value.mission,
            limit: routedLimit,
            location: routed.value.location,
            date: routed.value.date
          }, toolContext)
          if (toolContext.atomicMultiLookCompleted) {
            const freeformDiagnostics = toolContext.freeformDiagnostics || {}
            saveStylistConversationState(
              boundedConversationStateFromToolContext(toolContext),
              req.body.sessionId || 'default'
            )
            persistFreeformGenerationRun({
              sessionId: req.body.sessionId || '',
              occasion: toolContext.occasion,
              diagnostics: freeformDiagnostics,
              turnFailed: false,
              freeformTurnToken
            })
            return res.json({
              answer: stripPieceIdCitations(boundedAtomicMultiLookResponse(toolContext)),
              savedCorrections: [],
              renderedBoards: [],
              provider: AI_PROVIDER,
              structuredOutfits: toolContext.generatedOutfits,
              structuredOutfitsSource: toolContext.source,
              structuredOutfitsOccasion: toolContext.occasion,
              structuredOutfitsSeason: toolContext.season,
              structuredOutfitsMood: toolContext.mood,
              structuredOutfitsMission: toolContext.mission,
              structuredOutfitsActivity: toolContext.activity,
              debug: freeformDiagnostics,
              suggestedTitle: null
            })
          }
        }
      } catch (routerError) {
        if (routerError?.usage) recordToolLoopUsage(toolContext, routerError.usage)
        // This narrow route exists specifically to avoid a full-manifest retry. A compact visual
        // serialization/provider failure does not mean the full stylist is needed, so surface it
        // instead of silently converting a failed cheap call into the most expensive path.
        if (isSavedPhotoWearMechanicsQuestion(currentQuestion, {
          exactSubjectCount: exactNamedPieceIds.length,
          savedPhotoCount: compactSavedPhotoCount
        })) {
          console.error('[Freeform Compact Garment Fact] Refusing expensive full-stylist fallback:', routerError.message)
          throw routerError
        }
        console.warn('[Freeform Execution Router] Falling back to full stylist:', routerError.message)
      }
    }
    const payload = await buildStylistConversationPayload({
      ...req.body,
      occasion: req.body.occasion,
      season: req.body.season,
      activity: req.body.activity
    })
    // Pieces already inside verified cards — the thread's current outfit set —
    // count as verified for citation purposes.
    toolContext.wardrobeManifestIncluded = Boolean(payload.wardrobeManifestIncluded)
    // freeformDiagnostics is created lazily by bumpFreeformDiagnostic, and every other
    // initializer sits inside a compact-profile branch. With the router flags off nothing has
    // bumped a counter yet, so this is the first touch on the default path.
    toolContext.freeformDiagnostics ||= {}
    // Router-eligible turns that fell through here (incomplete piece scope, router error) already
    // set executionProfile above and it must stand; router-ineligible turns never touched it.
    toolContext.freeformDiagnostics.executionProfile ||= 'full_stylist'
    Object.assign(toolContext.freeformDiagnostics, payload.historyDiagnostics || {})
    toolContext.turnMode = payload.threadState?.turn_mode || 'new_request'
    toolContext.weatherProfile = restoreWeatherProfile(payload.threadState?.weather_profile)
    toolContext.currentOutfitSet = payload.threadState?.current_outfit_set || []
    toolContext.knownOutfitPieceIds = [...new Set(
      [
        ...(Array.isArray(req.body.pieceIds) ? req.body.pieceIds : []),
        ...(payload.threadState?.current_outfit_set || []).flatMap(outfit => Array.isArray(outfit?.piece_ids) ? outfit.piece_ids : []),
      ]
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
      diagnostics: freeformDiagnostics || {},
      turnFailed: false,
      freeformTurnToken
    })

    res.json({
      // Last boundary before the user sees it: every guard that needs the citations has
      // already run on the text that still had them.
      answer: stripPieceIdCitations(answer),
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
    // Record before responding. The provider calls this turn already made were
    // billed whether or not it finished, and their outcome — a capsule roster
    // call's failure codes above all — is exactly what you need to avoid paying
    // twice to learn the same thing. Marked turn_failed so a partial run is
    // never mistaken for a completed one in the same table. Best-effort by
    // construction: persistFreeformGenerationRun swallows its own errors, so
    // this cannot turn a provider error into a 500.
    if (diagnosticsContext) {
      persistFreeformGenerationRun({
        sessionId: req.body.sessionId || '',
        occasion: diagnosticsContext.occasion,
        diagnostics: diagnosticsContext.freeformDiagnostics || {},
        turnFailed: true,
        freeformTurnToken: diagnosticsContext.freeformTurnToken || ''
      })
    }
    const { status, message } = describeAiError(err)
    res.status(status).json({ error: message })
  }
})

export default router
