import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import OpenAI, { toFile } from 'openai'
import { db, userUploadsDir, safeJsonParse, parsePiece } from '../db.js'
import { colorTaggerInstruction, sanitizeTaggerColors } from '../lib/colorTaxonomy.js'
import { queueColorTaxonomyReviews, queueFiberTaxonomyReviews } from '../lib/colorTaxonomyReview.js'
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
  resolveAiTarget,
  stylistProviderOverride,
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
  describeAiError,
  extractPieceIdsFromProse
} from '../styling-engine/provider.js'
import { composerOutfitSlotsSchema, composerOutfitCountCheck, resolveComposerSlotOutfit, withSlotFindings } from '../styling-engine/composerSlots.js'

import {
  applyComfortFootwearRepair,
  ACTIVITY_PROFILES
} from '../styling-engine/footwear-comfort.js'

import {
  prompts,
  PHYSICAL_WEARABILITY_REALISM_RULES,
  STYLE_SELECTED_ITEM_FEW_SHOTS,
  OUTFIT_MISSIONS,
  TAG_PIECE_SYSTEM,
  EXTRACT_PIECES_SYSTEM,
  STYLIST_COMPETENCE_CONTRACT
} from '../styling-engine/promptRuntime.js'
import { validateSubmittedPlanOutfits, describeOutfitStructureGap, capsuleNeutralBasePlan, capsuleOutfitCoreCapacity, slotThermalDemandLabel, validateTripCompositionPartialPlan } from '../styling-engine/outfitSetPlanner.js'

import { OCCASION_PROFILES, stripSoftRankingRules } from '../styling-engine/occasions.js'
import { colorFamilyLabel, colorTaxonomyEntry } from '../lib/colorTaxonomy.js'
import {
  garmentKind,
  pieceMatchesMaterial,
  pieceMatchesFootwear,
  pieceRequiresBaseLayer,
  pieceVisualDetailPolicy,
  SLEEVE_SHAPE_VALUES,
  FIT_ON_BODY_SCHEMA_DESCRIPTION,
} from '../styling-engine/attributes.js'
import {
  extractWeatherContext,
  extractStatedTripDateRange,
  extractStructuredUserWeather,
  isTravelOrPackingRequest,
  normalizeActivity,
  normalizeOccasion
} from '../styling-engine/stylingIntent.js'
import { serializeWeatherProfile, restoreWeatherProfile } from '../styling-engine/weather.js'
import { projectStylingApplicabilityContext, resolveStylingContext } from '../styling-engine/stylingContext.js'

import { storeUserCorrection, executeTool, bumpFreeformDiagnostic, recordFreeformToolIteration, nextFreeformCallIndex, verifiedPieceIdSets, coldLayerDecisionSchemaProperty, declareSingleOutfitIntent, stylistCatalogLine } from '../styling-engine/tools.js'
import { detectExplicitProhibition, describeOwnerGuidanceScope } from '../lib/ownerGuidance.js'
import { updateAiTelemetryContext, backfillFreeformRunId, normalizeTaggerSource, getAiTelemetryContext, runWithAiTelemetryContext } from '../lib/aiCallTelemetry.js'
import { randomUUID, createHash } from 'node:crypto'

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
  pieceIdsWithApplicableNegativeFeedback,
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
  wholeWardrobeOutfitVisualReviewFindings,
  deriveWholeWardrobeRoles,
} from '../styling-engine/rules.js'
import {
  evaluateAutomaticUsePiecePool,
  evaluateVisualComposerPiecePool,
  selectAutomaticUseCandidatesForOutfitGeneration,
} from '../styling-engine/eligibility.js'
import { categoryOutfitStructurePromptRule, evaluateLayerPairConstruction, evaluateLayerPairConstructionFor, evaluateWearableOutfit, isInabilityToJudgeCode, layerConstructionPromptRule, NEUTRAL_SLEEVE_LAYERING_STATEMENT, correctTuckInstruction } from '../styling-engine/outfitValidation.js'
import { sharedGarmentEvidenceLine, garmentNotesBlock, garmentNotesEntry, GARMENT_FACT_CONVENTIONS, SPARSE_CATALOG_CONVENTIONS } from '../styling-engine/garmentEvidenceLine.js'
import { stylingRulesForPrompt } from '../src/utils/wardrobeAiContext.js'
import { storedGarmentRules } from '../styling-engine/ruleProvenance.js'
import { projectCandidateSetShortfall } from '../styling-engine/candidateSet.js'
import { discloseRecoveryShortfall, validatedComplete, validatedFallback, validatedSubstitute } from '../styling-engine/recovery.js'
import { normalizeDeliveredOutfit, normalizeOutfitResult } from '../styling-engine/outfitResult.js'
import { FIBER_VALUES, FIBER_FAMILIES, INSULATING_LAYER_SCHEMA_DESCRIPTION, INTERIOR_CONSTRUCTION_SCHEMA_DESCRIPTION, fiberContentNormalization, normalizeInsulatingLayerMaterials, normalizeInteriorConstruction, insulatingLayerMaterials, interiorConstruction } from '../styling-engine/fiberTaxonomy.js'
import { resolveExposureContext } from '../styling-engine/exposure.js'
import { requiredThermalBand, compareThermalFit, thermalRankingFit } from '../styling-engine/thermalDemand.js'
import { evaluateOutfitEnvironmentalAdequacy, ENVIRONMENTAL_ADEQUACY_CODES, primaryUserFacingFinding } from '../styling-engine/outfitEnvironmentalAdequacy.js'
// Weather findings only: a repair is judged on what it does to the WEATHER picture, never on
// unrelated advisories a card may carry for its own reasons.
const ENVIRONMENTAL_CODE_SET = new Set(Object.values(ENVIRONMENTAL_ADEQUACY_CODES))
import { garmentWarmthLevel, garmentWarmthScore } from '../styling-engine/garmentWarmth.js'

import {
  rankSelectedPieceCandidatesWithVision,
  composeStructuredOutfitsForPiece,
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
  isGenerationFactsQuestion,
  getStylistConversationState,
  saveStylistConversationState,
  buildStylistConversationPayload,
  buildSingleOutfitConversationPayload,
  priorStylistConversationHistory,
  normalizeCalibrationRow,
  withTimeout,
  structuredResponseMaxTokens,
  getCalibrationMemoryForStylist,
  getCalibrationReferenceImagesForGeneration,
  runGPT4oImageGeneration,
  runOpenAIImageGeneration,
  getOpenAIImageSize,
  anchorFidelityInstructions,
  createPhotoPreservingCollageImage,
  ownedInventorySummaryForEditorial,
  reviewComposedWholeWardrobeOutfitsForClash,
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

// Real routing (plan: quizzical-foraging-boot, Stage F) — env-controlled, reversible without a
// code change.
//
// DEFAULT CHANGED 2026-09-02 (owner decision): tagging now routes to Gemini 3.1 Flash-Lite, the
// tier docs/tagger-cost-spec.md §6d benchmarked strongest on cost and failure rate and §6e adopts.
// Measured in production on the owner's own wardrobe: $0.0079 and 6.6s per garment, against
// $0.0292 and 16.7s for the Haiku call ninety minutes earlier — 73% cheaper, 2.5x faster.
// Set TAGGER_PROVIDER_OVERRIDE='anthropic' to revert without a code change.
//
// BYOK: fine. Gemini resolves keys through lib/apiKeys.js's resolveKey('gemini', userId) — the
// same per-user-then-installation path as Anthropic and OpenAI, with a working Settings field. An
// earlier note here called that a blocker, having read it off a stale error string rather than the
// code; retracted in §6e. Tagging still bills the user's own key where they have set one, which is
// what the cost spec's §1 assumes.
const TAGGER_PROVIDER_OVERRIDE = process.env.TAGGER_PROVIDER_OVERRIDE || 'gemini'
const TAGGER_MODEL_OVERRIDE = process.env.TAGGER_MODEL_OVERRIDE || 'gemini-3.1-flash-lite'
const taggerProviderOverride = TAGGER_PROVIDER_OVERRIDE
  ? { provider: TAGGER_PROVIDER_OVERRIDE, model: TAGGER_MODEL_OVERRIDE }
  : null

// Same shape for the stylist chat turn (/ask) — and now (owner ruling 2026-08-30) every other
// non-image-generation feature too. Unset by default — Sonnet stays the immediate fallback with
// zero code change. gemini-3.5-flash-lite is the tier this session's stylist comparison actually
// quality-tested; gemini-3.7-flash (GEMINI_MODEL's own default) stays excluded here — its latency
// pathology (4/17 calls at 8-11.5min) was never confirmed resolved. Canonical definition now lives
// in styling-engine/provider.js (imported above as `stylistProviderOverride`) so every module can
// share it without a circular import back through this file; this local alias is kept only so the
// many existing references below this line don't all need renaming.

// docs/tagger-cost-spec.md §6b/§6c: standard tagging (add/edit/retag) defaults to the cheaper
// tagger tier — screened cold-start and warm-anchored, no material regression found. Callers that
// need the full stylist model (currently: routes/importer.js, whose crop/fallback-photo
// distribution was never screened) must pass `model` explicitly to override this default.
// providerOverride (Gemini evaluation slice, plan: quizzical-foraging-boot): defaults to
// taggerProviderOverride above (env-controlled, real routing); a caller may still pass its own
// (e.g. the comparison-run/benchmark scripts) to override that default per-call.
// model's default (the Anthropic tagger tier) is skipped when providerOverride routes elsewhere —
// harmless either way (askStylistWithUsage ignores `model` for its openai/gemini branches) but
// confusing to read otherwise.
export async function tagPieceWithProvider(photoInputs, existingPiece = null, { onUsage, model = null, excludeAnchorPieceId, providerOverride = taggerProviderOverride } = {}) {
  if (model === null && !providerOverride) model = AI_PROVIDER === 'openai' ? null : ANTHROPIC_TAGGER_MODEL
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
    //
    // RAISED 2500 -> 4000 on 2026-09-02, after a live retag truncated again. Two things moved at
    // once: the schema grew two output fields (fiber_content_completeness,
    // insulating_layer_materials) and Gemini 3.1 Flash-Lite became the tagger default, which is
    // markedly more verbose than Haiku. Measured on real calls against the old cap:
    //
    //   claude-haiku-4-5       1735   69%
    //   claude-sonnet-4-6      1662   66%
    //   gemini-3.1-flash-lite  1571   63%
    //   gemini-3.1-flash-lite  2496  100%   <- truncated mid-JSON, same schema, same model
    //
    // That 1571 -> 2496 spread on identical work is the point: the cap was not marginally low, it
    // was inside the model's ordinary variance. docs/tagger-cost-spec.md §6d saw this exact
    // truncation once during screening and dismissed it as run-to-run noise after a single clean
    // repeat — correct about the variance, wrong to leave the headroom unchanged.
    //
    // Raised to 3000, not 4000. The ceiling protects against unusual variance; it must not
    // subsidize a verbose output contract. The same investigation found and fixed the actual
    // source of the bulk — real_wear_notes was filled 4.9/5 on average with unbounded prose, and
    // _confidence rated ten fields inapplicable to the garment's own category. Clean outputs sit
    // at 1600-1700, so 3000 is slack rather than a new normal.
    maxTokens: 3000,
    ...(model ? { model } : {}),
    ...(providerOverride ? { providerOverride } : {}),
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
    // Provenance (plan: quizzical-foraging-boot, Stage E): which provider/model actually
    // produced these tags, so a routing change (Stage F) can be evaluated against real usage.
    tags.tag_provider = usage?.provider || ''
    tags.tag_model = usage?.model || ''
    const confidence = normalizeConfidenceMap(tags._confidence || tags.style_profile_json?._confidence || {})
    const photoProperties = normalizePhotoProperties(tags.photo_properties || tags.style_profile_json?.photo_properties || {})
    // Invalid materials are dropped, not rewritten to 'unknown', and the dropped tokens ride out
    // on the result so a caller with db access can queue them — same shape as color_taxonomy_gaps.
    // See docs/fiber-evidence-completeness-spec.md §10.3.
    const fiberNormalization = fiberContentNormalization(tags.fiber_content)
    tags.fiber_content = fiberNormalization.values
    tags.fiber_taxonomy_gaps = fiberNormalization.invalid
    tags.insulating_layer_materials =
      normalizeInsulatingLayerMaterials(tags.insulating_layer_materials, { source: 'tagger' })
    // Writer rule at the boundary: a photo may establish that a lining or second face EXISTS,
    // never that one is absent, so a tagger-asserted 'unlined' becomes 'unknown'.
    tags.interior_construction =
      normalizeInteriorConstruction(tags.interior_construction, { source: 'tagger' }) || 'unknown'
    tags.formality = normalizeFormality(tags.formality)
    tags.heel_height = normalizeHeelHeight(tags.heel_height)
    tags.walk_support = normalizeWalkSupport(tags.walk_support)
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
      INSERT INTO freeform_generation_runs (session_id, occasion, search_calls, gate_excluded_total, propose_calls, propose_validation_fails, outfit_prose_without_tool_count, zero_result_contradiction_blocks, card_prose_inconsistent_blocks, atomic_multi_look_calls, execution_router_calls, tool_sequence, destination_clarification_retries, plan_slot_environment_inferred, plan_slot_activity_inferred, submit_plan_calls, submit_plan_validation_fails, submit_plan_resubmits, submit_plan_partial_accepts, capsule_final_fallbacks, capsule_supply_gaps, capsule_looks_auto_completed, capsule_roster_model_calls, capsule_roster_model_repairs, capsule_roster_model_fallbacks, capsule_roster_failure_codes, capsule_composition_failure_code, plan_kind_resolved, trip_roster_model_calls, trip_roster_model_repairs, trip_roster_model_fallbacks, resolved_date_range, resolved_location, date_range_source, trip_atomic_composition_debug, turn_failed, provider_iterations, provider_input_tokens, provider_output_tokens, provider_cache_read_input_tokens, provider_cache_creation_input_tokens, weather_source, history_messages_received, history_messages_included, history_chars_removed, execution_profile, search_visual_images_attached, search_visual_max_category_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      String(diagnostics.capsuleCompositionFailureCode || ''),
      String(diagnostics.planKindResolved || ''),
      Number(diagnostics.tripRosterModelCalls) || 0,
      Number(diagnostics.tripRosterModelRepairs) || 0,
      Number(diagnostics.tripRosterModelFallbacks) || 0,
      String(diagnostics.resolvedDateRange || ''),
      String(diagnostics.resolvedLocation || ''),
      String(diagnostics.dateRangeSource || ''),
      // Diagnostic-only, never read by the model or shown in user-visible prose (docs/
      // trip-composition-parity-spec.md follow-up). Piece-ID-scoped, unlike the free-text
      // validator reasons it also carries verbatim — a few of those reasons do name a garment
      // (e.g. the footwear-comfort and 4th-shoe-reuse messages), narrower than what
      // console.log('[Atomic Capsule Validation]', failures) already writes uncontrolled for
      // capsule (full resolved piece objects), but not as strictly ID-only as the
      // capsule_roster_failure_codes/capsule_composition_failure_code columns above.
      String(diagnostics.tripAtomicCompositionDebug || ''),
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
      diagnostics.executionProfile || '',
      Number(diagnostics.searchVisualImagesAttached) || 0,
      Number(diagnostics.searchVisualMaxCategoryCount) || 0
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

// docs/bounded-multi-context-continuity-spec.md §5.1. A safety bound, not a selection rule — the
// set it caps (cited AND verified this turn) is already precise, unlike a raw retrieval dump.
const RECENTLY_DISCUSSED_PIECE_CAP = 16

// docs/bounded-multi-context-continuity-spec.md §5.1/§4. The pieces a full_stylist answer actually
// discussed — cited in its own prose AND verified this turn (search_wardrobe/view_pieces/
// get_garment_details/suggest_slot_swaps, via the same verifiedPieceIdSets applyFreeformOutputChecks's
// truth clause already checks citations against) — not every candidate a retrieval tool happened to
// surface. A search can broaden past what the prose ever mentions; persisting the raw retrieval set
// would let the next turn "continue" with pieces the user never actually saw discussed.
export function recentlyDiscussedPieceIdsFromAnswer(answerText, toolContext = {}, { cap = RECENTLY_DISCUSSED_PIECE_CAP } = {}) {
  const { retrieved, known } = verifiedPieceIdSets(toolContext)
  // knownPieceIds recognizes a bare "(146)" citation too, not just the mandated "(ID 146)" form —
  // live case (thread_1788054462046, Gemini 3.5 Flash Lite): a real, correctly-verified 12-piece
  // answer cited every piece this way, and the mandated-form-only regex silently left this field
  // empty despite a perfect target case. Still cannot pull in an unverified id: discussedIds below
  // filters against the exact same retrieved/known sets regardless of citation shape.
  const citedIds = extractPieceIdsFromProse(answerText, { knownPieceIds: new Set([...retrieved, ...known]) })
  const discussedIds = citedIds.filter(id => retrieved.has(id) || known.has(id))
  return discussedIds.slice(0, cap)
}

// docs/bounded-multi-context-continuity-spec.md §5.1, "last assistant-turn continuity" (chosen over
// letting the field survive through an unrelated turn, per review). `recently_discussed_piece_ids`
// claims to reflect "the immediately preceding accepted answer" and the router hint claims "previous
// answer discussed N pieces" — both are only true if EVERY successfully completed turn either sets
// or clears the field, never leaves it untouched. `full_stylist` sets or clears via
// recentlyDiscussedPieceIdsFromAnswer above (empty answer -> empty array, still an explicit write).
// bounded_multi already implicitly clears it (boundedConversationStateFromToolContext's full-blob
// replace omits the key). This covers the remaining case: a compact profile
// (wardrobe_inventory/existing_card_explanation/garment_fact/general_advice) is wardrobe-independent
// or answers a different, narrower subject than "what was just discussed" means here, so its
// completion must clear the field rather than let a stale set from two turns ago survive through it.
export function clearRecentlyDiscussedPieceIds(sessionId) {
  const priorConversationState = getStylistConversationState(sessionId || 'default') || {}
  saveStylistConversationState({
    ...priorConversationState,
    recently_discussed_piece_ids: { piece_ids: [], turn_token: '' }
  }, sessionId || 'default')
}

export function boundedConversationStateFromToolContext(toolContext = {}) {
  // Rejected diagnostic cards remain visible in the turn that produced them, but they are not an
  // accepted outfit set and must never become follow-up authority. A two-step retry used to leave
  // the first broken attempt stranded beside the accepted card in current_outfit_set.
  const outfits = Array.isArray(toolContext?.generatedOutfits)
    ? toolContext.generatedOutfits.filter(outfit => !outfit?.broken)
    : []
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
    // Spec §7: per-outfit weather disclosure + its serialized structured
    // context, so a follow-up ("what weather were you planning for the coast
    // day?") reads the actual per-slot resolution back instead of only the
    // single shared weather_profile below (which cannot distinguish slots).
    ...(outfit?.weatherUsed ? { weather_used: outfit.weatherUsed } : {}),
    ...(outfit?.resolvedWeatherContext ? { resolved_weather_context: outfit.resolvedWeatherContext } : {}),
    // thread_1788508369689 arc, product ruling "use B": the assigned packed-layer relation was
    // being silently dropped at exactly this whitelist boundary — present on the accepted outfit,
    // absent from persisted current_outfit_set, so a follow-up edit had no way to know a cold
    // card's worn outfit depended on a specific packed layer. See the matching addition in
    // core.js's outfitSetFromBody, which projects the same field for the other current_outfit_set
    // path (kept in sync by the same convention as weather_used/resolved_weather_context above).
    ...(Array.isArray(outfit?.assignedLayerIds) && outfit.assignedLayerIds.length
      ? { assigned_layer_piece_ids: outfit.assignedLayerIds.map(Number).filter(Boolean) }
      : {}),
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
  // The active trip packing roster (docs/README.md: trip roster architecture). Two ways this turn
  // can produce a fresh one: a plan turn attaches tripPlanContext to its cards (the roster the
  // model just selected), or propose_outfit records pendingRosterChange when a card edit reaches
  // for a piece outside the roster it was handed — an explicit addition, not a silent one. Neither
  // present means this turn made no roster change; the caller (persistFullStylistTurnState) leaves
  // the prior persisted roster untouched by simply not overwriting it, the same "layers onto"
  // pattern current_outfit_set already uses.
  const rosterBearingOutfit = outfits.find(outfit => outfit?.tripPlanContext)
  const packingRoster = rosterBearingOutfit?.tripPlanContext
    ? {
        roster_ids: rosterBearingOutfit.tripPlanContext.roster_ids || [],
        roster_pieces: rosterBearingOutfit.tripPlanContext.roster_pieces || [],
        slots: rosterBearingOutfit.tripPlanContext.slots || [],
      }
    : (toolContext?.pendingRosterChange
      ? (() => {
          const removedIdSet = new Set(toolContext.pendingRosterChange.removedIds || [])
          const survivingIds = [...(toolContext.packingRosterIds || [])].filter(id => !removedIdSet.has(Number(id)))
          const survivingPieces = (toolContext.packingRosterPieces || []).filter(piece => !removedIdSet.has(Number(piece?.id)))
          return {
            roster_ids: [...new Set([...survivingIds, ...toolContext.pendingRosterChange.addedIds])],
            roster_pieces: [...survivingPieces, ...toolContext.pendingRosterChange.addedPieces],
            // The trip's requirement slots are immutable facts about the itinerary, not something a
            // roster edit changes — carried forward unchanged from what this turn was handed.
            slots: toolContext.packingRosterSlots || [],
          }
        })()
      : null)
  return {
    established,
    ...(packingRoster ? { packing_roster: packingRoster } : {}),
    ...(serializeWeatherProfile(toolContext?.weatherProfile) ? { weather_profile: serializeWeatherProfile(toolContext.weatherProfile) } : {}),
    ...(currentOutfitSet.length ? { current_outfit_set: currentOutfitSet } : {})
  }
}

// Spec §7 continuity, the full-stylist tool-loop path. Called once, right
// after askStylistWithTools returns, from the general (non-bounded_multi)
// /ask handler.
//
// docs/bounded-multi-context-continuity-spec.md §5.1: recently_discussed_piece_ids
// is always written explicitly (including empty) so a stale value from an
// earlier turn cannot linger — it reflects only the immediately preceding
// accepted answer, never a growing memory. Reads the state fresh rather than
// reconstructing it, so this write layers onto whatever
// buildStylistConversationPayload's own earlier-in-this-turn save already set
// (established/current_outfit_set/weather_profile) instead of replacing it —
// the whole-blob store has no partial merge, so overwriting from scratch here
// would silently drop those.
//
// buildStylistConversationPayload's save (which runs BEFORE the tool loop, as
// part of assembling the model's own input) only persists cards the BROWSER
// already echoed back from the PREVIOUS turn — it cannot know about cards
// THIS turn's tool loop is about to produce. Without this second write, a
// freshly accepted plan_outfit_set/propose_outfit/generate_outfits result
// depended entirely on the browser echoing toolContext.generatedOutfits back
// on the NEXT request to survive server-side at all — exactly the continuity
// gap spec §7 requires not to exist. Reuses
// boundedConversationStateFromToolContext's own current_outfit_set/
// weather_profile projection (the same one the bounded_multi router path
// already uses at its own call site above) so both paths persist identically
// shaped state. Only overwrites current_outfit_set when this turn actually
// produced fresh cards — an ordinary prose-only turn leaves the prior set
// alone, consistent with the "layers onto" merge philosophy above.
export function persistFullStylistTurnState({ toolContext, answer, freeformTurnToken, sessionId = 'default' }) {
  const priorConversationState = getStylistConversationState(sessionId) || {}
  const hasFreshCards = Array.isArray(toolContext.generatedOutfits) && toolContext.generatedOutfits.length > 0
  const freshState = hasFreshCards ? boundedConversationStateFromToolContext(toolContext) : null
  saveStylistConversationState({
    ...priorConversationState,
    ...(freshState?.current_outfit_set ? { current_outfit_set: freshState.current_outfit_set } : {}),
    ...(freshState?.packing_roster ? { packing_roster: freshState.packing_roster } : {}),
    ...(freshState?.weather_profile ? { weather_profile: freshState.weather_profile } : {}),
    recently_discussed_piece_ids: {
      piece_ids: recentlyDiscussedPieceIdsFromAnswer(answer, toolContext),
      turn_token: freeformTurnToken
    }
  }, sessionId)
}

export function compactFreeformAnswerSystem(profile = 'general_advice') {
  const profileContract = profile === 'existing_card_explanation'
    // thread_1789536455443 (2026-09-16): this profile is asked, among other things, whether an
    // already-composed card actually suits stated conditions. It used to forbid claiming to see
    // photographs (none were ever supplied) and its only framing was "explain the supplied verified
    // outfit cards" — inviting the model to treat the card's own stored reason/weatherUsed label as
    // the answer rather than an independent judgment. Photographs are now supplied (see
    // compactGarmentVisualEvidence's call site).
    // Revised again 2026-09-16 (owner review, second pass): `reason`/`weatherUsed`/system flags are
    // now removed from the card projection entirely (sanitizeOutfitForExplanation below) rather than
    // sent-with-a-caveat, so a sentence naming those fields specifically is stale — they are never
    // in the payload to repeat. The live risk moved to conversation HISTORY, which is intentionally
    // preserved (the user must be able to ask "what did you mean?", challenge a prior answer, or
    // request more outfits for the same outing) and can still carry an earlier assistant claim in
    // its own prose. This framing is deliberately general — not a weather-specific instruction — and
    // covers any prior claim history might carry, not only a temperature one. A card's
    // `untrusted_display_label` is composer-written display text kept only so the model can tell
    // multiple cards apart; the key itself says what it is, not evidence, so a conclusion-bearing
    // label (e.g. one composer titled a card "50° to 40°F") is not read as a verified fact.
    ? 'Explain or compare the supplied outfit cards. Do not change pieces or invent alternatives. A card\'s `untrusted_display_label` is the composer\'s own untrusted display text, used only to tell multiple cards apart, not evidence — identify the card you mean by its index, piece IDs, or piece names, and never repeat that label\'s wording as if it were a settled fact. Conversation history is provided to preserve continuity and resolve references. Previous assistant statements are fallible prior claims, not authoritative garment evidence. Reassess them against the structured garment facts and photographs, and correct them plainly when they conflict. When asked whether a card suits stated conditions, weather, or comfort, judge it fresh from the supplied garment construction facts and photographs — insulation, lining, coverage, weather protection, fit — and say plainly when the garment evidence is incomplete or the outcome is uncertain.'
    : profile === 'garment_fact'
      ? 'Answer only from the supplied structured garment evidence and any supplied saved photographs. Do not invent construction, fit, comfort, ownership, or additional garments. Do not compose an outfit. Saved tags are evidence, not infallible: manual/high confidence is strong; missing/low confidence permits cautious inference from the other supplied construction fields and any supplied saved photographs. A worn photograph showing the requested configuration proves only that the configuration is physically possible; judge its visible styling result separately. Give a direct, respectful styling judgment about the visible garment-and-body interaction when the photograph supports one: if the shown tuck fights the wearer\'s proportions, say that it is not the strongest presentation and explain the visible proportion effect. Do not call the shown configuration flattering or preferred merely because it is possible. Do not pretend an unseen alternative is proven better; recommend trying it as the likely stronger option or ask for a comparison photograph. Keep an unseen alternative mechanically simple and adjacent to what was shown: for a full-tuck question, compare fully untucked before proposing a partial, French, asymmetric, folded, or otherwise more elaborate tuck, unless supplied evidence specifically supports that treatment. When the question involves layering one garment over or under another: Sleeve shape and relative sleeve length alone do not establish whether two garments layer. Inspect the photographs for sleeve structure, compressibility and the intended treatment, and state uncertainty when the evidence is insufficient. Do not invent a hidden cause, diagnose the wearer\'s body, or turn one photographed interaction into a universal body rule. If evidence conflicts, explain the practical conflict naturally and prefer clearly visible garment behavior over a weak or missing tag. Photographs may show drape, bulk, texture and visible behavior, but cannot establish exact fiber composition; if fiber is not supplied, describe only its visible behavior and do not guess cotton, wool, viscose, modal or a blend. Never infer tuckability from hem shape alone. If saved photographs are supplied, do not ask the user to upload a photograph you already have. Speak as a stylist, not as a database inspector: never expose field names, snake_case keys, enum values, JSON notation, backticks, or confidence labels such as manual/high/low. Translate the evidence into ordinary garment language (for example, say “this fitted tee can be tucked,” never “tuck_behavior is tucks_anywhere”).'
      : 'Give general styling education only. Do not imply that you inspected the wardrobe or recommend a specific owned garment. Explain dress codes and styling concepts through multiple valid pathways. Present structure, fabric, finish, cohesion, accessories, and footwear as optional signals whose effect depends on the whole outfit—not mandatory ingredients. Distinguish common tendencies from requirements, avoid status-loaded contrasts such as “real” versus lesser accessories, and never treat casual clothing as inherently careless, shapeless, or confined to errands. Say briefly when a wardrobe-specific answer would require looking at the pieces.'
  return `${STYLIST_COMPETENCE_CONTRACT} You are answering one bounded text question, concisely. ${profileContract}

RATIFIED STYLE CONSTITUTION:
${prompts.BODY_CONTRACT}
${prompts.PROVEN_FORMULAS}
${prompts.AESTHETIC_GRAVITY}
${prompts.LANE_NEUTRALITY}
${prompts.WORKING_STYLE}`
}

// thread_1789536455443: audited against garmentEvidenceLine.js's garmentEvidenceFields — the
// canonical shared fact set every OTHER chat surface (Whole Wardrobe, trip, /ask view_pieces)
// already sends. Weather-relevant fields that set carries and this one was missing:
// insulating_layer_materials, interior_construction, weather_protection (added first), and
// fiber_content and season (added here). `stretch` is also on the shared line but is a fit/comfort
// fact, not a weather-relevant one, and is deliberately left out — this is not "declare parity from
// three fields," it is a field-by-field comparison against the one list this app treats as
// authoritative for garment evidence.
export function compactFreeformPieceFacts(piece = {}) {
  return {
    id: Number(piece.id),
    name: piece.name,
    category: piece.category,
    colors: piece.colors,
    fabric_category: piece.fabric_category,
    fabric_weight: piece.fabric_weight,
    fiber_content: piece.fiber_content,
    insulating_layer_materials: piece.insulating_layer_materials,
    interior_construction: piece.interior_construction,
    weather_protection: piece.weather_protection,
    season: piece.season,
    opacity: piece.opacity,
    needs_base: piece.needs_base,
    tuck_behavior: piece.tuck_behavior,
    hem_finish: piece.hem_finish,
    sleeve_length: piece.sleeve_length,
    sleeve_shape: piece.sleeve_shape,
    length_hits_at: piece.length_hits_at,
    silhouette: piece.silhouette,
    waistband_type: piece.waistband_type,
    formality: piece.formality,
    heel_height: piece.heel_height,
    walk_support: piece.walk_support,
    occasions: piece.occasions,
    reads_as: piece.reads_as,
    // The owner's stored rules, minus receipts, retired reaction copies and saved chat replies (ruleProvenance.js).
    styling_rules_learned: storedGarmentRules(piece),
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

// Evidence that a request belongs to an established execution context. Conversation-mode words
// are deliberately absent: "this is", "actually", or another tone marker cannot create prior
// state. Callers decide freshness from whether this evidence list is empty.
export function freeformExecutionContextEvidence(body = {}, state = {}, recentlyDiscussedPieceIds = []) {
  const priorHistory = priorStylistConversationHistory(body.history, body.question)
  return [
    body.activeContext ? 'active_context' : '',
    body.outfit ? 'outfit' : '',
    Array.isArray(body.pieceIds) && body.pieceIds.length ? 'piece_ids' : '',
    Array.isArray(body.generatedOutfits) && body.generatedOutfits.length ? 'generated_outfits' : '',
    String(body.generatedContext || '').trim() ? 'generated_context' : '',
    String(body.threadContext || '').trim() ? 'thread_context' : '',
    priorHistory.length ? 'history' : '',
    Array.isArray(state.current_outfit_set) && state.current_outfit_set.length ? 'saved_outfit_set' : '',
    Array.isArray(recentlyDiscussedPieceIds) && recentlyDiscussedPieceIds.length ? 'recently_discussed_pieces' : '',
  ].filter(Boolean)
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

// Canonical layer-pair-mechanics verdict for every top/dress pair among the supplied garment_fact
// subjects, computed server-side so the compact answer model consumes one shared verdict instead of
// re-deriving sleeve/fabric compatibility from raw fields itself (routes/ai.js:evaluateLayerPairConstruction
// is the single owner propose_outfit/plan/capsule validation also consumes). Most garment_fact
// questions are single-garment and produce no pair here; that is expected, not a gap.
// LOG-ONLY since 2026-09-14: this verdict is diagnostic evidence and is no longer sent to the garment_fact model.
export function compactGarmentFactLayeringEvidence(pieces = []) {
  const candidates = (Array.isArray(pieces) ? pieces : [])
    .filter(piece => ['top', 'dress'].includes(wardrobeCategoryGroup(piece)))
  if (candidates.length < 2) return []
  const lines = []
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const pair = evaluateLayerPairConstructionFor(candidates[i], candidates[j])
      if (pair.verdict === 'compatible') continue
      const addedLabel = pair.addedPiece?.name || `piece ${pair.addedPiece?.id}`
      const baseLabel = pair.basePiece?.name || `piece ${pair.basePiece?.id}`
      lines.push(`${addedLabel} + ${baseLabel}: ${pair.verdict}${pair.findings[0] ? ` — ${pair.findings[0].message}` : ''}`)
    }
  }
  return lines
}

// thread_1789536455443 (revised again 2026-09-16, owner review): a local keyword classifier
// deciding WHEN a prior conclusion is dangerous to show was itself the wrong mechanism — it is a
// second guess about which questions are "about weather", brittle by construction, and the
// underlying problem (the model repeating a conclusion placed in front of it) is not limited to
// questions that happen to contain a weather word. `existing_card_explanation` now ALWAYS projects
// a card as structural membership only: `reason`, `weather_used`/`weatherUsed`,
// `resolved_weather_context`/`resolvedWeatherContext`, `needs_removable_cool_layer`/
// `needsRemovableCoolLayer`, and `system_flags`/`systemFlags` are removed unconditionally, on
// every question, not detected per-question. Outfit membership (piece_ids, pieces,
// styling_instructions, roles) is kept: it is a fact about what the card contains, not a conclusion
// about it. The answer model explains or assesses the outfit afresh from its pieces, the full
// garment facts, and the photographs — including for an ordinary "why did you choose this?"
// question, which gets a fresh explanation rather than a repetition of the stored reason. The
// user's own original wording (including any stated weather) is never deleted — it survives in
// recent conversation history, the turn that actually asked for the outfit.
//
// Revised again 2026-09-16 (owner review, second pass): a real capture (thread_1789543565383) showed
// a composer-written `label` of "Polished Urban Walk at 50° to 40°F" reaching the model verbatim —
// exactly the conclusion-bearing text the reason/weatherUsed stripping above was meant to keep out,
// just carried through a field that survived because it is genuinely needed to tell multiple cards
// in a bundle apart. Deleting it outright would break that legitimate case. Renamed instead of
// caveated: the key itself now says what it is (an untrusted composer-written display string, not
// evidence) rather than depending on the model reading and honoring a nearby prompt sentence — once
// a card is resolved, its index/piece_ids/pieces are the neutral way to refer back to it.
function sanitizeOutfitForExplanation(outfit = {}) {
  const {
    reason, weather_used, weatherUsed,
    resolved_weather_context, resolvedWeatherContext,
    needs_removable_cool_layer, needsRemovableCoolLayer,
    system_flags, systemFlags,
    label, title,
    ...membership
  } = outfit
  const composerLabel = label || title
  return composerLabel ? { ...membership, untrusted_display_label: composerLabel } : membership
}

export function compactFreeformAnswerMessage({ profile, question = '', context = {}, pieces = [], state = {}, history = [] } = {}) {
  const recentHistory = (profile === 'existing_card_explanation' || profile === 'garment_fact') ? compactRecentHistory(history) : ''
  const sanitizedOutfits = (context.outfits || []).map(outfit =>
    profile === 'existing_card_explanation' ? sanitizeOutfitForExplanation(outfit) : outfit)
  return [
    `Question: ${question}`,
    // The user's ORIGINAL wording (including any stated weather) survives here, in the turn that
    // asked for the outfit — never deleted, only kept out of the technical-conclusion fields above.
    recentHistory ? `Recent conversation (most recent last):\n${recentHistory}` : '',
    profile === 'existing_card_explanation' && sanitizedOutfits.length
      ? `Card membership as composed (garment IDs and names only — the composer's own reason and weather/warmth conclusions are withheld here; any untrusted_display_label is composer-written display text, not evidence; explain or judge the outfit afresh from the garment facts and photographs below, and from the user's own words above):\n${JSON.stringify(sanitizedOutfits)}`
      : '',
    profile !== 'general_advice' && pieces.length ? `Authoritative garment facts:\n${JSON.stringify(pieces.map(compactFreeformPieceFacts))}` : '',
    profile !== 'general_advice' && state.established ? `Established context:\n${JSON.stringify(state.established)}` : ''
  ].filter(Boolean).join('\n\n')
}

// 2026-09-16 (owner review): a real capture (thread_1789543565383, session
// 20260916T072500260Z-p33193-328b5958) stored a sentence fragment cut off mid-word by
// stopReason: max_tokens and presented it as a finished answer. Raising the caller's maxTokens
// (its own comment has the full diagnosis: Gemini bills thinking tokens out of the same cap) fixes
// the common case; this is the simple defensive backstop for the rest — one retry asking for a
// shorter, complete answer (the same shape as the full tool loop's own providerTruncation retry in
// styling-engine/provider.js), and an honest disclosure if it is STILL truncated, rather than ever
// storing/serving a fragment as a completed answer. `ask` is injectable so this can be unit-tested
// directly — askStylistWithUsage's own test-mode shortcut cannot simulate a provider stopReason
// (see test/bounded_multi_context_continuity_e2e.test.js's documented harness limitation), so a
// route-level HTTP mock could never reach the truncated branch at all.
export async function compactAnswerWithTruncationGuard({
  system, messages, maxTokens = 1500, providerOverride = null, ask = askStylistWithUsage, onAttempt = null
} = {}) {
  const usages = []
  let lastText = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    if (onAttempt) onAttempt({ isRetry: attempt > 0 })
    const call = await ask({
      system,
      messages: attempt === 0
        ? messages
        : [...messages,
            { role: 'assistant', content: lastText },
            { role: 'user', content: 'That reply was cut off by the token limit before it finished, so it may be incomplete — give a shorter, complete answer this time.' }
          ],
      maxTokens,
      providerOverride
    })
    usages.push(call.usage)
    lastText = call.text
    if (call.usage?.stopReason !== 'max_tokens') return { text: call.text, usages, truncated: false }
  }
  return {
    text: "I ran out of room to finish that answer completely — ask me again and I'll give a shorter, complete one.",
    usages,
    truncated: true
  }
}

// A card's own role invariant (outfitValidation.js: "at most one primary_top, primary_bottom,
// dress, and shoes role" plus "at most one MIDDLE layer... and at most one OUTER layer") caps a
// valid outfit at five distinct pieces — top-or-dress, bottom, shoes, one middle layer, one outer
// layer. Accessories are styled separately and never shown here. A lower image ceiling can still
// starve a valid five-piece card of its outerwear or shoes in pass one, below.
const MAX_STRUCTURAL_OUTFIT_PIECES = 5

export async function compactGarmentVisualEvidence(pieces = [], { uploadsDir = userUploadsDir(), maxImages = MAX_STRUCTURAL_OUTFIT_PIECES } = {}) {
  const list = Array.isArray(pieces) ? pieces : []
  const blocks = []
  const seenFiles = new Set()
  // 2026-09-16 (owner review): a hard-coded 4 was a stale ceiling from when 4 pieces was the
  // largest card seen in practice — it could still truncate pass one below the outfit's own
  // structural maximum and lose a valid fifth garment (typically the outer layer) entirely. The
  // ceiling is now the actual structural maximum, so pass one always has room for one image per
  // unique garment on any valid card before pass two spends anything on a second photo.
  const boundedLimit = Math.max(0, Math.min(MAX_STRUCTURAL_OUTFIT_PIECES, Number(maxImages) || 0))
  const imageCount = () => blocks.filter(block => block.type === 'image').length

  const tryAdd = async (piece, label, photoFile) => {
    if (imageCount() >= boundedLimit) return false
    if (!photoFile || seenFiles.has(photoFile)) return false
    if (path.basename(photoFile) !== photoFile) return false
    const filePath = path.join(uploadsDir, photoFile)
    if (!fs.existsSync(filePath)) return false
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
      return true
    } catch (err) {
      console.warn(`Failed to prepare compact garment evidence for piece ${piece?.id}:`, err.message)
      return false
    }
  }

  // thread_1789536455443 (2026-09-16): the previous loop was piece-major, photo-type-minor — worn
  // AND hanger photo for piece 1, then piece 2, and so on — so a 4-image budget silently spent
  // itself on the outfit's first two pieces and left later ones (on a 4-piece outfit: the
  // outerwear) with no visual evidence at all. Pass 1 gives every garment ONE useful image (worn
  // photo preferred, hanger as fallback) before any single garment gets a second; pass 2 only then
  // spends remaining capacity on each garment's other photo, same order.
  for (const piece of list) {
    if (imageCount() >= boundedLimit) break
    const gotWorn = await tryAdd(piece, 'worn photo', piece?.worn_photo)
    if (!gotWorn) await tryAdd(piece, 'hanger photo', piece?.photo)
  }
  for (const piece of list) {
    if (imageCount() >= boundedLimit) break
    await tryAdd(piece, 'worn photo', piece?.worn_photo)
    if (imageCount() >= boundedLimit) break
    await tryAdd(piece, 'hanger photo', piece?.photo)
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


// EXPERIMENT INSTRUMENTATION, default off (docs/engine-behaviour-map.md, 2026-09-13 A/B plan).
// Removes collapsed verdict words the engine adds to model-facing text — ordering headings and the
// "acceptable" adjacency label — so a production-path comparison sees raw evidence only. Read at call
// time; unset leaves every payload byte-identical.
export function experimentNeutralVerdicts() {
  return process.env.WARDROBE_EXPERIMENT_NEUTRAL_VERDICTS === 'true'
}

// The old composer line builder (derived warmth, tagger reads_as, tagger do-not-pair) was removed 2026-09-15: every composer
// garment line is now the shared fact line (styling-engine/garmentEvidenceLine.js).

// COMPOSER-ONLY EXPERIMENT, garment line B1 (owner ruling 2026-09-14): the production composer line is kept
// byte-for-byte and the structured facts the one-outfit catalog carries, but this line lacks, are APPENDED in
// the composer's own `; field: value` vocabulary. Nothing is dropped or reinterpreted, no sparse convention
// is assumed (defaults such as everyday formality are stated), and no role vocabulary is introduced — the
// composer names roles through its slots, not through `layer_top` / `primary_top` labels.
export const composerCompleteFactsSuffix = piece => {
  const group = wardrobeCategoryGroup(piece) || piece.category || 'other'
  const facts = []
  const add = (field, value) => {
    const text = Array.isArray(value) ? value.filter(Boolean).join('/') : String(value ?? '').trim()
    if (text) facts.push(`; ${field}: ${text}`)
  }
  add('colors', piece.colors)
  add('pattern_type', piece.pattern_type)
  add('pattern_scale', piece.pattern_scale)
  add('pattern_complexity', piece.pattern_complexity)
  add('silhouette', piece.silhouette)
  add('formality', piece.formality)
  add('season', piece.season)
  if (['top', 'dress', 'outerwear'].includes(group)) {
    add('length_hits_at', piece.length_hits_at)
    add('neckline', piece.neckline)
    add('sleeve_length', piece.sleeve_length)
    add('sleeve_shape', piece.sleeve_shape)
    add('stretch', piece.stretch)
  } else if (group === 'bottom') {
    add('bottom_shape', piece.bottom_shape)
    add('leg_opening', piece.leg_opening)
    add('length_hits_at', piece.length_hits_at)
  } else if (group === 'shoes') {
    add('shoe_type', piece.shoe_type)
    add('toe_shape', piece.toe_shape)
    add('walk_support', piece.walk_support)
    add('heel_height', piece.heel_height)
  } else if (group === 'accessory') {
    add('accessory_subtype', piece.accessory_subtype)
    add('jewelry_type', piece.jewelry_type)
    add('necklace_length', piece.necklace_length)
  }
  if (group === 'outerwear') add('interior_construction', interiorConstruction(piece))
  if (piece.tag_state === 'provisional') add('tag_state', 'provisional')
  return facts.join('')
}

export const composerExperimentGarmentLine = (piece, garmentLine = 'production') => {
  // The experiment baseline is the production garment line — the shared fact line (2026-09-15) — so a manifest run stays comparable.
  const b0 = sharedGarmentEvidenceLine(piece)
  return garmentLine === 'complete' ? `${b0}${composerCompleteFactsSuffix(piece)}` : b0
}

// Order a set of layers by how well each answers the resolved thermal demand, best first.
// Exported for the contract test: ordering is the part of this that decides something, and an
// inline closure inside a 400-line route function cannot be checked without a full HTTP round trip.
//
// Ranking, not gating — every piece stays. It reads `thermalRankingFit`, the shared ranking
// primitive the roster builder itself uses, rather than `compareThermalFit`: fit membership alone
// flattens a puffer and a cardigan into the same bucket on a coarse forecast, which is exactly the
// ordering this exists to produce.
export function orderLayersByThermalFit(pieces = [], demand = null) {
  const list = Array.isArray(pieces) ? pieces : []
  if (!demand?.level) return list
  const rank = piece => {
    const fit = thermalRankingFit(garmentWarmthLevel(piece), garmentWarmthScore(piece), demand)
    // `unknown` keeps its incoming relevance position rather than being pushed to the back: an
    // untagged layer is not evidence of a bad layer, and demoting it would make missing metadata
    // behave like inadequacy — the criterion-8 error this arc keeps paying for.
    if (fit.fit === 'unknown') return null
    // DISTANCE IN LEVELS, NOT `offset`. `offset` is overshoot-WEIGHTED — it exists to express
    // "prefer the garment that is not too hot", which is the right preference when ranking a
    // garment for wear and the wrong one for a list whose whole job is "which of these covers the
    // cool end". Live run thread_1789247972106: the navy quilted puffer was the ONLY layer whose
    // fit was adequate, and its |offset| of 1.125 (0.75 above the level's centre, weighted) sorted
    // it FIFTH, below four undershooting cardigans at 0.5-0.75 — in a section headed "ordered for
    // these conditions". The owner picked that occasion expecting exactly that coat.
    //
    // Level distance is symmetric and is what this list means: at the demand level first, then one
    // step away, then two. The signed offset still breaks ties, so a piece slightly above the level
    // leads a piece the same distance below it — on a cool day that is the right way to lean.
    const levels = Math.abs(fit.distance ?? 0)
    return levels - (Number(fit.offset) > 0 ? 0.25 : 0)
  }
  // Keeping an unmeasured layer "in place" is a SLOT reservation, not a comparator special case: a
  // comparator that falls back to index whenever one side is unknown is non-transitive, and sort
  // then produces an order that depends on which pairs it happened to compare (it put a `light`
  // vest ahead of a `warm` coat in exactly this fixture). Measured layers are ranked among
  // themselves and poured back into the slots measured layers already occupied.
  const scored = list.map((piece, index) => ({ piece, index, score: rank(piece) }))
  const measured = scored.filter(entry => entry.score !== null)
    .sort((a, b) => (a.score !== b.score ? a.score - b.score : a.index - b.index))
  const measuredSlots = scored.filter(entry => entry.score !== null).map(entry => entry.index)
  const result = list.slice()
  measuredSlots.forEach((slot, i) => { result[slot] = measured[i].piece })
  return result
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
  activityProfile = null,
  // Owner ruling 2026-08-30: defaults to the shared app-wide config (stylistProviderOverride) so
  // every caller — the direct /generate-outfits-for-piece route included, not just freeform chat —
  // gets it automatically without having to remember to pass it explicitly.
  providerOverride = stylistProviderOverride
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
    // 2026-09-15: the activity taste lists (preferred/discouraged) are ratified SOFT scoring and no
    // longer rendered as instructions — see the matching note in the whole-wardrobe composer below.
    const activityGuidance = [
      activityProfile.vibe ? `Activity vibe: ${activityProfile.vibe}` : ''
    ].filter(Boolean).join('\n')
    occasionProfileGuidance = [occasionProfileGuidance, activityGuidance].filter(Boolean).join('\n\n')
  }
  if (comfortConstraint) {
    const walkingGuidance = comfortConstraint.reason === 'all-day walking comfort'
      // 2026-09-15: this sentence now states only what the footwear gate actually enforces.
      // Warm-weather boots (walking) and mules/sandals (hiking) are ratified SOFT — score penalty,
      // never suppression (docs/occasion_profiles_ratification.md) — so naming them here turned a
      // ranking preference into a prohibition the engine never held.
      ? 'All-day walking: avoid stilettos, high heels, pumps, and delicate sandals; prefer low block heels, loafers, flats, sneakers.'
      : 'Hiking/Outdoor active: avoid heels, wedges, dress shoes, and flip-flops; require sneakers, athletic shoes, or flat rugged boots.'
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
    `Compose ${SELECTED_PIECE_OUTFIT_COUNT.minOutfits}-${SELECTED_PIECE_OUTFIT_COUNT.maxOutfits} complete outfits using only shown saved wardrobe pieces.`,
    `Every outfit must include selected anchor id ${selectedPiece.id}. Do not replace it with another ${wardrobeCategoryGroup(selectedPiece) || selectedPiece.category}.`,
    'Use the selected garment as the visual/thematic anchor; choose support pieces around its actual role, risks, and confidence-aware garment truth.',
    'Reference pieces only by exact IDs shown in labels. Do not invent missing pieces in this wardrobe mode.',
    '',
    GARMENT_FACT_CONVENTIONS,
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
    content.push({ type: 'text', text: `${labelPrefix} ${sharedGarmentEvidenceLine(piece)}` })
    content.push({ type: 'image', detail: detailOverride || composerImageDetail, source: { type: 'base64', media_type: thumb.media_type, data: thumb.data } })
    shownPieceCount++
    shownPieces.push(piece)
  }

  await addPieceImage(selectedPiece, 'SELECTED ANCHOR', 'high')
  const supportGroupHeadingMap = {
    top: '=== SUPPORT TOPS ===',
    bottom: '=== SUPPORT BOTTOMS ===',
    dress: '=== SUPPORT DRESSES ===',
    shoes: '=== SUPPORT SHOES ===',
    outerwear: '=== SUPPORT OUTERWEAR ===',
    accessory: '=== SUPPORT ACCESSORIES ==='
  }
  for (const group of grouped.keys()) {
    const pieces = grouped.get(group)
    if (!pieces?.length) continue
    content.push({ type: 'text', text: supportGroupHeadingMap[group] || `=== SUPPORT ${group.toUpperCase()}S ===` })
    for (const p of pieces) await addPieceImage(p, 'SUPPORT')
  }

  const timings = { thumbPrepMs: Date.now() - routeStartedAt }
  let parsed = {}
  let composerError = null
  let composerErrorIsTruncation = false
  let composerErrorIsTimeout = false
  let composerUsage = null
  const composerMaxTokens = structuredResponseMaxTokens(4)
  try {
    const composerStartedAt = Date.now()
    const composerResult = await withTimeout(signal => askStylistStructuredWithUsage({
      system: selectedItemVisualComposerSystemPrompt(),
      maxTokens: composerMaxTokens,
      messages: [{ role: 'user', content }],
      providerOverride,
      // The user message asks for this same range of outfits; the schema carries it too.
      schema: composerOutfitSlotsSchema(SELECTED_PIECE_OUTFIT_COUNT),
      name: 'wardrobe_outfits',
      description: 'Return the composed outfits, each garment named by ID in the slot for its job.',
      subflow: 'selected_piece_visual_composer',
      signal,
    }), 120000, 'Selected-piece visual composer')
    timings.composerMs = Date.now() - composerStartedAt
    composerUsage = composerResult.usage || null
    parsed = composerResult.value || {}
  } catch (err) {
    timings.composerMs = Date.now() - routeStartedAt - timings.thumbPrepMs
    composerError = err.message
    composerErrorIsTruncation = Boolean(err.isTruncation)
    composerErrorIsTimeout = Boolean(err.isTimeout)
  }

  // Slot resolution (composerSlots.js). The anchor used to be unshifted into any card that omitted
  // it, and cards that still lacked it were dropped — both made the model's answer look like
  // something it was not. A card without the anchor is now a Needs review card saying so.
  const unresolvedReferences = []
  const slotFindingsByOutfit = new Map()
  const selectedModelOutfits = (Array.isArray(parsed?.outfits) ? parsed.outfits : []).map(outfit => {
    const slots = resolveComposerSlotOutfit(outfit, candidatePieces, { requiredPieceId: selectedId })
    for (const finding of slots.slotFindings.filter(item => item.code === 'unknown_piece_id')) {
      unresolvedReferences.push({ id: finding.evidence.pieceId, name: null, slot: finding.evidence.slot, outfitLabel: outfit?.label || 'unlabeled' })
    }
    const normalized = normalizeWholeWardrobeOutfitObject({ ...outfit, pieceIds: slots.pieceIds, pieces: slots.pieces }, candidatePieces, { deriveMissingRoles: false })
    // Required-footwear repair swaps a shoe on a complete card; an incomplete card is shown exactly
    // as the model answered it.
    const card = {
      ...(slots.slotFindings.length
        ? normalized
        : repairWholeWardrobeOutfit(normalized, candidatePieces, occasion, mood, { season, weatherProfile, activity })),
      modelSlots: slots.modelSlots,
    }
    slotFindingsByOutfit.set(card, slots.slotFindings)
    return card
  })
  const selectedValidation = new Map(selectedModelOutfits.map(outfit => [
    outfit,
    withSlotFindings(evaluateWearableOutfit(outfit.pieces, {
      requireShoes: true,
      seenPieceIds: new Set(shownPieces.map(piece => Number(piece.id))),
    }), slotFindingsByOutfit.get(outfit)),
  ]))
  const needsReviewOutfits = selectedModelOutfits
    .filter(outfit => !selectedValidation.get(outfit).hardValid)
    .map(outfit => normalizeOutfitResult({
      ...outfit,
      broken: true,
      diagnosticOnly: true,
      strength: 'needs review',
      // One primary explanation for the owner; `findings` below keeps every typed finding.
      rejectionReason: primaryUserFacingFinding(selectedValidation.get(outfit).hardFindings)?.message || 'Hard outfit validation failed.',
    }, {
      disposition: 'rejected',
      findings: selectedValidation.get(outfit).hardFindings,
      provenance: { flow: 'selected_piece_visual', source: 'model-rejected', composedBy: 'model', stage: 'shared_validation' },
    }))
  let outfits = selectedModelOutfits.filter(outfit => selectedValidation.get(outfit).hardValid)

  // Local/deterministic logic may prepare and rank candidate space, but it may not supply a
  // user-facing outfit recommendation the styling model never actually selected or evaluated
  // (2026-08-27 policy, thread_1787803856242: a composer timeout previously substituted
  // buildLocalFallbackOutfitDirections()'s category-fill picks here — no photo judgment, no
  // layering awareness, no validation at all — presented with the same confident labels as a real
  // composition). needsReviewOutfits are still model-sourced (just hard-invalid), so they remain
  // legitimate to show; only a true "nothing to show" case (no valid AND no rejected-but-real
  // outfits) needs to become an explicit failure state rather than a silently-substituted pick.
  const compositionSkipped = (!outfits.length && !needsReviewOutfits.length) ? 'composer_failed' : null

  if (comfortConstraint) {
    const visibleRepairPool = shownPieces.length ? shownPieces : candidatePieces
    // The repair's candidate pool (especially the recovery tier) reaches well beyond what the
    // model was ever shown, so it needs its own feedback check — memoryText above was scoped to
    // the shown/ranked pool and never covers a piece introduced only here.
    const repairFeedbackContext = projectStylingApplicabilityContext(
      { occasion, season, activity, weatherProfile, requestText: question }, {}
    )
    const repairShoeIds = [...new Set(
      [...visibleRepairPool, ...recoveryEvaluation.recoveryEligiblePieces]
        .filter(p => wardrobeCategoryGroup(p) === 'shoes')
        .map(p => Number(p.id))
    )]
    const avoidPieceIds = pieceIdsWithApplicableNegativeFeedback(repairShoeIds, repairFeedbackContext)
    outfits = outfits.map(o => {
      const repairedFromShown = applyComfortFootwearRepair(o, visibleRepairPool, comfortConstraint, { weatherProfile, occasion, mood, activity, avoidPieceIds })
      return repairedFromShown === o
        ? applyComfortFootwearRepair(o, recoveryEvaluation.recoveryEligiblePieces, comfortConstraint, { weatherProfile, occasion, mood, activity, avoidPieceIds })
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
    skip: compositionSkipped
      ? (composerError
          ? `The stylist wasn't able to generate outfit ideas for this piece this time (${composerError}). Try again.`
          : 'The stylist didn\'t return any outfit ideas for this piece this time. Try again.')
      : (parsed.skip || ''),
    saveableLearning: parsed.saveableLearning || '',
    compositionSkipped,
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
      compositionSkipped,
      imageDetail: composerImageDetail,
      thumbPx: composerThumbPx,
      aiReturnedCount: Array.isArray(parsed?.outfits) ? parsed.outfits.length : 0,
      composerError,
      composerErrorIsTruncation,
      composerErrorIsTimeout,
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
      unresolvedReferencesCount: unresolvedReferences.length,
      outfitCountCheck: composerOutfitCountCheck(parsed, SELECTED_PIECE_OUTFIT_COUNT),
    }
  }
}


// ── AI Tagging endpoints ───────────────────────────────────────────────────────
// /extract-pieces is a second photo-derived producer of material facts, so it obeys the same writer
// contract as the tagger rather than being a loophole. It returns pieces the client may later save,
// and once returned parseModelJson(raw) untouched — no fibre normalization at all, so invalid
// materials and casing/duplicate noise reached the client and any taxonomy gap was lost before crud
// could see it. It has been a loophole twice now; the rule below is the general fix.
//
// EVERY photo-derived field it returns must pass through the same normalizers as the main tagging
// path, or the writer rules are enforced by prompt compliance rather than at the boundary. Two are
// asymmetric and cannot be left to the model: a photograph can establish that an insulating layer
// or a lining EXISTS, never that one is ABSENT, so a tagger-emitted `insulating_layer_materials: []`
// is downgraded to null and a tagger-emitted `interior_construction: 'unlined'` to 'unknown'.
// See docs/interior-construction-spec.md §9.
export function applyFiberWriterContract(result) {
  const pieces = Array.isArray(result?.pieces) ? result.pieces
    : Array.isArray(result) ? result
    : null
  if (!pieces) return result
  for (const piece of pieces) {
    if (!piece || typeof piece !== 'object') continue
    const { values, invalid } = fiberContentNormalization(piece.fiber_content)
    piece.fiber_content = values
    piece.fiber_taxonomy_gaps = invalid
    piece.interior_construction =
      normalizeInteriorConstruction(piece.interior_construction, { source: 'tagger' }) || 'unknown'
    piece.insulating_layer_materials =
      normalizeInsulatingLayerMaterials(piece.insulating_layer_materials, { source: 'tagger' })
  }
  return result
}

router.post('/extract-pieces', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo provided' })
  const filePath = path.join(userUploadsDir(), req.file.filename)
  try {
    const { base64, mime } = await prepareImageForClaude(filePath)
    fs.unlinkSync(filePath)

    const raw = await askStylist({
      system: EXTRACT_PIECES_SYSTEM,
      // Left at 3000 deliberately. An earlier version of this change raised it to 5000 by analogy
      // with the single-piece truncation — "same schema, therefore more exposed" — which is not
      // evidence. This endpoint's output scales with the NUMBER of garments in the photo, so it
      // needs a sizing rule rather than a borrowed constant, and ai_call_log contains ZERO calls
      // from this flow to size one from. Measure it before moving it.
      maxTokens: 3000,
      // Vision garment extraction — same job as tagPieceWithProvider, just multi-piece from one
      // photo, so it uses the tagger's own config rather than the general stylist one.
      providerOverride: taggerProviderOverride,
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
      "sleeve_shape": "${SLEEVE_SHAPE_VALUES.join('|')}|null (omit for sleeveless) — a functional sleeve-VOLUME classification (where the sleeve carries excess volume), not a fashion-name label.",
      "length_hits_at": "Valid values depend on category — pick from the matching list only: top -> cropped|waist|high_hip|hip|low_hip|tunic|unknown; outerwear -> cropped|waist|high_hip|hip|low_hip|mid_thigh|knee|mid_calf|ankle|full_length|floor_length|unknown; dress -> mini|above_knee|knee|below_knee|midi|ankle|maxi|unknown; bottom (this endpoint does not distinguish skirts from pants, so allow either's landing points) -> mini|above_knee|knee|below_knee|midi|maxi|shorts|mid_calf|ankle|full_length|floor_length|unknown; shoes -> open|below_ankle|ankle|high_top|mid_calf|knee|over_knee|unknown (open = fully open/minimal upper, e.g. a sandal or slide). Not applicable to accessory.",
      "silhouette": "Valid values depend on category — not applicable to shoes, use shoe_type/toe_shape instead: top -> fitted|slim|straight|relaxed|boxy|drop-shoulder|oversized|peplum|wrap; dress -> fitted|sheath|shift|A-line|wrap|slip|column|fit-and-flare|empire|relaxed; outerwear -> fitted|straight|boxy|relaxed|oversized|structured; bottom (this endpoint does not distinguish skirts from pants, so allow either's landing points) -> straight_leg|wide_leg|bootcut|flare|tapered|barrel|relaxed|a_line|pencil|full|slip|straight|pleated|wrap.",
      "shoe_type": "mule|loafer|boot|sandal|pump|flat|sneaker|slip_on|other|unknown|null (shoes only). Never 'heel' — heel_height covers that. 'slip_on' is a closure-free shoe (no laces/buckle/zip) that isn't a loafer, mule, or flat shape — e.g. a slip-on sneaker.",
      "toe_shape": "pointed|almond|round|square|open_toe|other|unknown|null (shoes only)",
      "fit_on_body": "${FIT_ON_BODY_SCHEMA_DESCRIPTION} This photo IS a worn photo — judge fit and drape directly from how the garment sits on the body here, the same authority a dedicated worn photo would carry.",
      "tuck_behavior": "tucks_anywhere|tucks_with_structure|wear_over_only|null (top only; null/omit for non-tops). Judge from the garment's own cut, fit, and design intent as shown in this worn photo: fitted or semi-fitted through the body -> tucks_anywhere; loose/relaxed fit that would need a belt or structured waistband to sit cleanly -> tucks_with_structure; peplum/tunic length, or a hem/silhouette clearly meant to be seen rather than tucked away -> wear_over_only. Whether the garment happens to be tucked or untucked in this specific photo is evidence, not the whole answer — an untucked top in this photo can still tuck cleanly if its cut supports it.",
      "waistband_type": "structured_high_waist|structured_mid_waist|structured_low_waist|soft_elastic_pull_on|tight_no_room|drawstring_relaxed|null (bottom only; null/omit for non-bottoms)",
      "fabric_category": "Valid values depend on category — top/bottom/dress/outerwear -> jersey|knit|rib knit|ponte|sweatshirt fleece|fleece|cotton|poplin|linen|linen blend|rayon|viscose|modal|silk|satin|crepe|chiffon|organza|lace|crochet|jacquard|wool|cashmere|boucle|denim|twill|canvas|corduroy|tweed|velvet|leather|faux leather|suede|faux suede|mesh|technical/performance|synthetic|other; shoes -> leather|suede|nubuck|patent|canvas|mesh|knit (a knitted/flyknit upper; woven is for raffia/straw, not knits)|woven|synthetic|textile|rubber|other; accessory -> leather|suede|metal|stone|straw|canvas|synthetic|textile|rubber|wood|ceramic|glass|horn|shell|resin|pearl|crystal|enamel|other. Never use the clothing list for a shoe or accessory piece.",
      "fabric_weight": "ultralight|light|medium|heavy|null (top/bottom/dress/outerwear only; null/omit for shoes/accessory — use visual_weight instead)",
      "visual_weight": "delicate|slim|medium|chunky|null (shoes/accessory only; null/omit for clothing — this is NOT fabric weight, it is visual scale/heft, e.g. a substantial shoe is chunky, a fine chain necklace is delicate)",
      "opacity": "opaque|semi_sheer|sheer|open_weave",
      "stretch": "none|minimal|moderate|stretchy|null (clothing only; null/omit for shoes/accessory. Tag conservatively; omit if the photo does not show enough to judge)",
      "needs_base": "yes|no|null (omit unless clearly a construction that cannot be worn alone against skin — conservative default is null, not 'no')",
      "weather_protection": "array, 0-2 values from: rain, wind (outerwear only; empty array for non-outerwear or when evidence is insufficient — an empty array is common and normal, not a gap). SEPARATE from outerwear_role — a protective_shell is not automatically both, a transition/cold-weather piece is not automatically empty. Include 'rain' only with genuine construction evidence (coated/sealed face fabric, built as a rain shell) — nylon/polyester fiber alone is not evidence. Include 'wind' only with genuine construction evidence (tight wind-blocking weave, built as a windbreaker) — heavy fabric weight or wool alone is not evidence. A windbreaker is typically ['wind'] only; a raincoat is typically ['rain'] only.",
      "fiber_content": ["array of visible/likely fibers/materials from this canonical list only: ${FIBER_VALUES.join(', ')}. ${FIBER_FAMILIES.jewelry_material.join('/')} are for accessory/jewelry pieces. Use 'tencel' for lyocell/Tencel fabric — there is no separate 'lyocell' value. For FOOTWEAR this is the UPPER/face material only — a warm shearling, fleece or pile lining goes in insulating_layer_materials, never here. Use 'unknown' if not determinable."],
      "interior_construction": "${INTERIOR_CONSTRUCTION_SCHEMA_DESCRIPTION}",
      "insulating_layer_materials": "${INSULATING_LAYER_SCHEMA_DESCRIPTION}",
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
    res.json(applyFiberWriterContract(parseModelJson(raw)))
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
    queueFiberTaxonomyReviews(db, {
      pieceId: piece.id,
      pieceName: piece.name,
      fibers: tags.fiber_taxonomy_gaps || [],
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
        ],
        providerOverride: stylistProviderOverride
      })
      const answer = await criticPassForSelectedItem({ selectedPiece: parsedPiece, draft, userQuestion: question })
      const resolvedTarget = resolveAiTarget(stylistProviderOverride)
      return res.json({ feedback: answer, provider: resolvedTarget.provider, model: resolvedTarget.model, mode: 'STYLE_SELECTED_ITEM' })
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
      ],
      providerOverride: stylistProviderOverride
    })
    const resolvedTarget = resolveAiTarget(stylistProviderOverride)
    res.json({ feedback: answer, provider: resolvedTarget.provider, model: resolvedTarget.model, mode: 'evaluate_piece' })
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
  resolvedWeatherProfile = null,
  // Owner ruling 2026-08-30: defaults to the shared app-wide config so the direct
  // /generate-outfits-for-piece route (which passes req.body straight through, no providerOverride
  // key) picks it up automatically, same as the freeform-chat selected-piece path.
  providerOverride = stylistProviderOverride
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
      activityProfile,
      providerOverride
    })
    visualCriticDebug = composed.debug || null
  } else {
    try {
      const visualReview = await withTimeout(signal => rankSelectedPieceCandidatesWithVision({
        selectedPiece: parsedPiece,
        rankedCandidates,
        occasion,
        season,
        mission,
        mood,
        question,
        memoryText,
        providerOverride,
        signal
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
      history,
      activity,
      occasionProfile,
      activityProfile,
      providerOverride
    })
  }

  const recoveryPieces = (!idealMode && !idealOnlyMode && Array.isArray(composed.recoveryEligiblePieces))
    ? composed.recoveryEligiblePieces
    : allPieces
  let structuredOutfits = Array.isArray(composed.outfits) ? composed.outfits : []
  if (structuredOutfits.length > 0) {
    console.log(`    - Successfully generated ${structuredOutfits.length} outfits from AI stylist composer.`)
  } else if (!composed.compositionSkipped) {
    // Local/deterministic logic may prepare and rank candidate space, but it may not supply a
    // user-facing outfit recommendation the styling model never actually selected or evaluated
    // (2026-08-27 policy, thread_1787803856242). This used to fall back to
    // buildLocalFallbackOutfitDirections(), then an unvalidated single "Best available wardrobe
    // direction" card built directly from ranked candidates — both engine-only picks presented
    // with the same confident labeling as a real composition. A composer that returns nothing now
    // surfaces as an explicit failure state instead.
    console.log(`    - AI stylist composer returned 0 outfits. Surfacing an explicit generation-failed state.`)
    composed.compositionSkipped = 'composer_failed'
    if (!composed.skip) composed.skip = 'The stylist didn\'t return any outfit ideas for this piece this time. Try again.'
  }

  if (comfortConstraint) {
    const repairFeedbackContext = projectStylingApplicabilityContext(
      { occasion, season, activity, weatherProfile, requestText: question }, {}
    )
    const repairShoeIds = [...new Set(
      recoveryPieces.filter(p => wardrobeCategoryGroup(p) === 'shoes').map(p => Number(p.id))
    )]
    const avoidPieceIds = pieceIdsWithApplicableNegativeFeedback(repairShoeIds, repairFeedbackContext)
    structuredOutfits = structuredOutfits.map(o => applyComfortFootwearRepair(o, recoveryPieces, comfortConstraint, { weatherProfile, occasion, mood, activity, avoidPieceIds }))
  }
  structuredOutfits = structuredOutfits.map(outfit => normalizeDeliveredOutfit(outfit, {
    provenance: {
      flow: 'selected_piece',
      source: outfit.source || (idealOnlyMode ? 'ideal-only' : idealMode ? 'ideal' : 'model'),
      // idealOnlyMode's outfits come from buildIdealOnlyCompletionsForPiece — a deterministic,
      // template-based missing-piece/shopping-idea generator, never a model call, by design (a
      // distinct feature from closet/mixed styling of owned pieces). Every other outfit that
      // reaches this line now genuinely is model-composed: buildLocalFallbackOutfitDirections and
      // the old "absolute basic backfill" no longer feed this response (2026-08-27 policy).
      composedBy: outfit.composedBy || (idealOnlyMode ? 'engine' : 'model'),
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

  const resolvedTarget = resolveAiTarget(providerOverride)
  return {
    feedback: answer,
    structuredOutfits,
    rejectedOutfits: composed.rejected || [],
    provider: resolvedTarget.provider,
    model: resolvedTarget.model,
    mode: idealOnlyMode ? 'ideal_new_ideas_only' : idealMode ? 'ideal_styling_directions' : 'generate_outfit_ideas',
    pipeline: idealOnlyMode
      ? 'composer_evaluator_renderer_handoff'
      : idealMode
        ? 'visual_candidate_reviewer_composer_evaluator_renderer_handoff'
        : 'selected_piece_visual_composer',
    idealMode,
    idealOnlyMode,
    compositionSkipped: composed.compositionSkipped || null,
    debug: {
      visualCritic: visualCriticDebug,
      composerUsage: visualCriticDebug?.composerUsage || null,
      recoveryShortfall: composed.recoveryShortfall || null,
      compositionSkipped: composed.compositionSkipped || null,
      weatherProfile,
      stylingContext: stylingContext.debug,
      // 2026-09-16 (owner review, thread_1789546295700): tools.js's generate_outfits handler reads
      // aiReturnedCount/composerError/composerErrorIsTimeout at the TOP of `result.debug` (matching
      // generateWholeWardrobeOutfitsVisualInternal's shape) to tell a genuine zero-model-card
      // technical failure apart from ordinary success — composeSelectedPieceVisualWardrobeOutfits
      // already tracks these on ITS OWN debug object (visualCriticDebug above), just nested one
      // level down. Falls back to structuredOutfits.length (the prior behavior) for the idealMode/
      // idealOnlyMode branches, which do not go through that composer and so never populate this.
      aiReturnedCount: visualCriticDebug?.aiReturnedCount ?? structuredOutfits.length,
      composerError: visualCriticDebug?.composerError ?? null,
      composerErrorIsTimeout: visualCriticDebug?.composerErrorIsTimeout ?? false,
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

// One-shot entry (docs/deferred-conversational-cache-spec.md): no PROMPT_CACHE_BREAKPOINT. A
// thread that never follows up should not pay for a 1h ephemeral cache write on this image-heavy
// roster manifest. A follow-up on the generated outfits routes through /ai/ask
// (message-lifecycle.md Stage 1, dispatch branches 11-12), which decides its own conversational
// cache disposition against a different stable prefix, so there is nothing here to preserve.
// COMPOSER-ONLY EXPERIMENT (docs/stage1-cause-matrix-2026-09-14.md §4–7). Off unless
// WARDROBE_EXPERIMENT_COMPOSER_MANIFEST names a manifest file, read at call time. Everything upstream of
// the composer call — context resolution, eligibility, ranking, caps, roster order, photographs, prompt
// assembly — runs exactly as in production; only the substitutions the manifest declares are applied,
// and the function returns immediately after the composer response (no slot repair, gate, backfill,
// critic or repair). A named manifest that is missing or invalid throws: an experiment never silently
// runs as production.
// Production now uses the same neutral sentence everywhere (2026-09-14); kept under the experiment name for the
// sealed Stage 2 harness and its tests.
export const EXPERIMENT_NEUTRAL_SLEEVE_SENTENCE = NEUTRAL_SLEEVE_LAYERING_STATEMENT

// DAY-WEAR EXPLANATION EXPERIMENT (docs/day-wear-explanation-experiment-2026-09-15.md). Experiment-only until the owner-rated
// comparison demonstrates an improvement. It asks the stylist to state its own intention and the coverage it leaves at each end
// of the stated conditions. It carries no engine verdict, no layer requirement and names no garment category.
export const DAY_WEAR_EXPLANATION_INSTRUCTION = 'WEARING IT THROUGH THE STATED CONDITIONS: for each outfit, fill `wear_through_day` with how you intend it to be worn across the stated conditions. Describe the warmest part and the coolest part separately; when the conditions do not change, describe the whole period once. For each, name which of the outfit\'s pieces are worn and how (for example open, closed, zipped or carried), and what that leaves covered or uncovered: arms, neck, torso and legs. Say what changes between the two, or that nothing changes. This describes your intention; say where the photographs and facts do not show something, and do not present warmth as certain.'

export function withDayWearExplanation(systemPrompt) {
  return `${String(systemPrompt)}\n\n${DAY_WEAR_EXPLANATION_INSTRUCTION}`
}

export function composerExperimentManifest() {
  const file = process.env.WARDROBE_EXPERIMENT_COMPOSER_MANIFEST
  if (!file) return null
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
  const fail = reason => { throw new Error(`Invalid composer experiment manifest (${file}): ${reason}`) }
  if (!String(manifest?.experiment || '').trim()) fail('experiment name is required')
  if (manifest.stopAfterComposer !== true) fail('stopAfterComposer must be true')
  if (!['production', 'complete'].includes(manifest.garmentLine)) fail('garmentLine must be production or complete')
  if (!['production', 'neutral'].includes(manifest.sleeveGuidance)) fail('sleeveGuidance must be production or neutral')
  if (typeof manifest.holdOutComparisonSet !== 'boolean') fail('holdOutComparisonSet must be boolean')
  if (manifest.maxTokensForCount !== null && !(Number.isInteger(manifest.maxTokensForCount) && manifest.maxTokensForCount >= 1 && manifest.maxTokensForCount <= 5)) fail('maxTokensForCount must be null or 1–5')
  const dayWearGuidance = manifest.dayWearGuidance ?? 'production'
  if (!['production', 'explain'].includes(dayWearGuidance)) fail('dayWearGuidance must be production or explain')
  const requireSealedRequest = manifest.requireSealedRequest ?? false
  const expectedRequestIdentitySha256 = manifest.expectedRequestIdentitySha256 ?? null
  if (typeof requireSealedRequest !== 'boolean') fail('requireSealedRequest must be boolean')
  if (expectedRequestIdentitySha256 !== null && !/^[0-9a-f]{64}$/.test(String(expectedRequestIdentitySha256))) fail('expectedRequestIdentitySha256 must be null or a sha256')
  if (requireSealedRequest && !expectedRequestIdentitySha256) fail('a sealed request needs expectedRequestIdentitySha256')
  return Object.freeze({
    experiment: String(manifest.experiment), arm: String(manifest.arm || ''), stopAfterComposer: true,
    garmentLine: manifest.garmentLine, sleeveGuidance: manifest.sleeveGuidance,
    holdOutComparisonSet: manifest.holdOutComparisonSet, maxTokensForCount: manifest.maxTokensForCount, dayWearGuidance,
    requireSealedRequest, expectedRequestIdentitySha256,
    manifestSha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  })
}

// The complete identity of one provider request: system text, every user text part in order, every image's
// bytes (with its media type and detail) in order, the schema, the resolved model and the token budget. A
// sealed experiment call compares this immediately before the provider call and refuses on any mismatch.
export function composerRequestIdentity({ system, content = [], schema = null, model = '', maxTokens = 0 }) {
  const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
  const parts = {
    systemSha256: sha(String(system ?? '')),
    textPartsSha256: sha((Array.isArray(content) ? content : []).filter(part => part?.type === 'text').map(part => part.text)),
    imagesSha256: sha((Array.isArray(content) ? content : []).filter(part => part?.type === 'image').map(part => ({ detail: part.detail || null, mediaType: part.source?.media_type || null, bytesSha256: sha(String(part.source?.data || '')) }))),
    schemaSha256: sha(schema ?? null),
    model: String(model || ''),
    maxTokens: Number(maxTokens) || 0,
  }
  return { ...parts, sha256: sha(parts) }
}

// Exactly one occurrence of the categorical sleeve rule is replaced; anything else is a contract error.
export function withNeutralSleeveGuidance(systemPrompt) {
  const rule = layerConstructionPromptRule()
  const count = String(systemPrompt).split(rule).length - 1
  if (count !== 1) throw new Error(`Expected the sleeve layering rule exactly once in the composer system prompt, found ${count}`)
  return String(systemPrompt).replace(rule, `- ${EXPERIMENT_NEUTRAL_SLEEVE_SENTENCE}`)
}

export function wholeWardrobeVisualComposerSystemPrompt(savedVariantGuidance = '') {
  return `${prompts.WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM}${savedVariantGuidance ? `\n\n${savedVariantGuidance}` : ''}`
}

// Same one-shot disposition as wholeWardrobeVisualComposerSystemPrompt above — this call site
// never carried PROMPT_CACHE_BREAKPOINT; named here so that stays a verifiable fact rather than an
// inline string nobody checks.
const SELECTED_PIECE_OUTFIT_COUNT = Object.freeze({ minOutfits: 3, maxOutfits: 4 })

export function selectedItemVisualComposerSystemPrompt() {
  return `${prompts.WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM}\n\nSELECTED-ANCHOR CONTRACT:\nEvery outfit must include the selected anchor id. The selected garment is the premise, not one option among many.\n\nOCCASION & CLIMATE PROFILES (RULES-AS-DATA):\n${JSON.stringify(stripSoftRankingRules(OCCASION_PROFILES), null, 2)}\n\nACTIVITY PROFILES (RULES-AS-DATA):\n${JSON.stringify(stripSoftRankingRules(ACTIVITY_PROFILES), null, 2)}`
}

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
  // docs/stated-weather-authority-findings.md §6 option 3. Until now this composer had NO structured
  // weather input at all: its only weather control was the 7-value season dropdown, and a temperature
  // typed into Mood or Styling request reached only the heuristic path, which ranks BELOW live
  // weather — so a user could not state 38°F on this surface in a way that won. Same typed contract
  // /ask's tools use; validateUserWeather owns the shape and unstated fields stay unstated.
  userWeather = null,
  location = '',
  date = null,
  currentDate = null,
  adaptiveVisualDetail = false,
  comparisonSetGuidance = true,
  // Was previously absent-by-default so the two direct HTTP routes (/generate-wardrobe-outfits-
  // visual, saved-outfit variants) never saw the experimental Gemini routing flag — found live: a
  // freeform turn running under STYLIST_PROVIDER_OVERRIDE=gemini still made this nested composer
  // call on Anthropic ($0.12 of that turn's $0.15), because this function's own askStylistWithUsage
  // call never accepted or forwarded an override at all. Owner ruling 2026-08-30 reversed the
  // original exclusion: only actual image-generation calls stay hardcoded to OpenAI — every other
  // feature, including these two direct routes, now defaults to the shared app-wide config.
  providerOverride = stylistProviderOverride
} = {}) {
    const routeStartedAt = Date.now()
    const requestedLimit = Math.max(1, Math.min(5, Number(limit) || 5))
    const composerExperiment = composerExperimentManifest()
    const experimentImageManifest = []
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
        userWeather,
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
      const parts = []
      parts.push(`Occasion Vibe: ${occasionProfile.vibe}`)
      // 2026-09-15: the occasion taste lists no longer reach the model as instructions. They are
      // ratified as SOFT SCORING (docs/occasion_profiles_ratification.md: "SOFT = score penalty,
      // never suppression"; the preferred lists as "soft bonuses"), and rules.js still applies
      // them to roster ranking. Rendering them here restated a ranking preference as a styling
      // requirement — and, being weather-blind, told the model to lean toward cardigans, light
      // outerwear and low heels for a 50/40°F walking day (thread_1789508440573).
      occasionProfileGuidance = parts.join('\n')
    }

    if (activityProfile) {
      const parts = []
      parts.push(`Activity Vibe: ${activityProfile.vibe || 'movement-focused'}`)
      // 2026-09-15: same as the occasion block above. The activity lists carry the categorical
      // walk/season bans the owner flagged (silk/dresses/skirts/blouses on a walk, boots when warm)
      // — all ratified SOFT. They stay in scoring; they are no longer model instructions.
      const activityGuidance = parts.join('\n')
      occasionProfileGuidance = occasionProfileGuidance
        ? `${occasionProfileGuidance}\n\n${activityGuidance}`
        : activityGuidance
    }

    if (comfortConstraint) {
      const walkingGuidance = comfortConstraint.reason === 'all-day walking comfort'
        // 2026-09-15: same correction as the selected-piece composer above — the sentence states
        // only the gate-enforced exclusions; the SOFT lists stay in scoring, not in instructions.
        ? "All-day walking: avoid stilettos, high heels, pumps, and delicate sandals; prefer low block heels, loafers, flats, sneakers."
        : "Hiking/Outdoor active: avoid heels, wedges, dress shoes, and flip-flops; require sneakers, athletic shoes, or flat rugged boots."
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
      context: { occasion, weatherProfile, mood, activity, requestText: stylingRequest, question, occasionProfile, activityProfile, calendarSeason: stylingContext.calendarSeason },
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
        provider: resolveAiTarget(providerOverride).provider,
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
          // Debug-only supply boundary, per piece: which garments automatic-use suppression removed and why.
          suppressedPieces: suppressedPieces.map(piece => ({ id: Number(piece.id), reasons: piece.reasons || [] })),
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
      if (enforced.length && !gaps.length) return `All roster pieces carry a ${activityProfile.label} rating; that rating covers this activity's footwear and register checks only, not whether a piece or a completed outfit suits these conditions.`
      if (gaps.length) return `Note: limited ${activityProfile.label}-rated coverage for ${gaps.join(', ')}; closest suitable pieces included.`
      return ''
    })()

    const composerThumbPx = 768
    const composerImageDetail = visualComposerImageDetailForRoster(roster.length)

    // Hoisted above the catalog loop (it used to live with the volatile tail) because the demand is
    // now used AT THE POINT OF CHOICE — see the outerwear heading and ordering below. Nothing about
    // its value changed; it reads the resolved profile and nothing else.
    const composerExposure = resolveExposureContext({}, weatherProfile)
    const weatherDemand = requiredThermalBand(composerExposure)

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
    // THE DEMAND BELONGS WHERE THE CHOICE IS MADE. Live runs 2077 and 3 both stated it in the
    // volatile tail — first as a requirement, then as evidence — and both times the model picked its
    // layer by looks and narrated warmth afterwards (run 3 called a `warmth: very light` vest "for
    // warmth"). Two thousand characters separated the number from the labels it had to be compared
    // against. Here it sits on the heading of the section the layer is chosen from, and the section
    // leads with the pieces that actually answer it.
    //
    // Outerwear ONLY. Every other category's order is the roster's own relevance ranking (occasion,
    // history, recency, weather), and re-sorting tops or shoes by warmth would let one axis quietly
    // outrank all of it. The layer is the garment this question is actually about.
    for (const group of grouped.keys()) {
      const pieces = group === 'outerwear' ? orderLayersByThermalFit(grouped.get(group), weatherDemand) : grouped.get(group)
      if (!pieces?.length) continue
      const categoryHeading = {
        top: 'TOPS',
        bottom: 'BOTTOMS',
        dress: 'DRESSES',
        shoes: 'SHOES',
        outerwear: 'OUTERWEAR',
        accessory: 'ACCESSORIES'
      }[group] || `${group.toUpperCase()}S`
      // NO TARGET LEVEL IN THE HEADING (owner ruling 2026-09-12). Naming the level the outfit "needs
      // to read" turned a styling task into arithmetic against a published scale: on a wardrobe
      // whose bases are all `moderate`, one `moderate` layer visibly does not reach `warm`, so the
      // arithmetic route to the stated target is a second layer — and cards started arriving with
      // two coats. The ordering still carries the same information without inviting a sum.
      // No heading verdict either (2026-09-15): "(ordered for these conditions)" told the model a derived thermal ordering was a
      // judgment about the conditions. Garment lines state recorded facts; the model judges fit against the stated range.
      content.push({ type: 'text', text: `=== ${categoryHeading} ===` })
      for (const p of pieces) {
        const photoFile = p.worn_photo || p.photo || ''
        if (!photoFile) continue
        const filePath = path.join(userUploadsDir(), photoFile)
        if (!fs.existsSync(filePath)) continue
        const { maxPx, detail } = pieceVisualDetailPolicy(p, { allowLow: adaptiveVisualDetail })
        const thumb = await prepareWardrobeThumb(filePath, `${p.id}:${maxPx}:${photoFile}`, { maxPx })
        imageSizeCounts[maxPx] = (imageSizeCounts[maxPx] || 0) + 1
        content.push({ type: 'text', text: composerExperiment ? composerExperimentGarmentLine(p, composerExperiment.garmentLine) : sharedGarmentEvidenceLine(p) })
        content.push({ type: 'image', detail, source: { type: 'base64', media_type: thumb.media_type, data: thumb.data } })
        if (composerExperiment) {
          experimentImageManifest.push({ id: Number(p.id), photoFile, photoKind: photoFile === p.worn_photo ? 'worn' : 'hanger', maxPx, detail, sentSha256: createHash('sha256').update(String(thumb.data)).digest('hex') })
        }
        shownPieceCount++
        shownPieces.push(p)
      }
    }

    // Shared garment evidence: the fact-line conventions once, then saved-record notes (owner rules, rejections) for shown pieces only.
    if (shownPieces.length) {
      content.push({ type: 'text', text: [GARMENT_FACT_CONVENTIONS, garmentNotesBlock(shownPieces)].filter(Boolean).join('\n\n') })
    }

    // No cache_control on the candidate manifest (removed 2026-08-26 — docs/deferred-conversational-
    // cache-spec.md). This call makes exactly one provider request with no in-call retry, so the
    // write could only ever be read back by a LATER, separate call within 5 minutes reproducing an
    // identical roster/image set — from this same standalone route, /generate-saved-outfit-variants,
    // or freeform's generate_outfits tool (all three share this function). Measured with per-call
    // cache attribution added for this trace: 0 reads against ~40-49k written tokens across every
    // sample checked — 7 standalone calls over the prior 4 days, plus one fresh standalone call and
    // one fresh freeform generate_outfits call run specifically to test this. The write cost
    // (~$0.12-0.18 of each ~$0.15-0.21 call) was never once recovered.

    // VOLATILE TAIL SECOND: occasion, season, mood, saved outfit photo, feedback memory
    // MIGRATED (§8 step 5). This gated a DISCLOSURE — "everything shown is weather-optimized" —
    // on the same two flags, so on a 65/47 day the roster was weather-scored and the model was told
    // it was not. The claim now tracks whether weather actually shaped the roster.
    //
    // Narrower than §8.1's pin suggested: this line was named there as the last hidden binary, but
    // the real one was tools.js's search-evidence gate (§22.1). This is a disclosure, not the
    // evidence itself.
    const isWeatherFiltered = Boolean(weatherProfile.isHot || weatherDemand.level)
    // 2026-09-16 (thread_1789526496845, reopened): a prior version of this line hedged EVERY
    // numeric range as "timing within the day unknown", which directly contradicted the ratified
    // contract this same number carries end to end (docs/app-surface-map.md, 2026-09-12 ruling):
    // `weatherProfile.highF/lowF` IS taken verbatim as the range the wearer will actually be
    // outside in, by `exposure.js`'s `stated_user` branch — never a daily envelope requiring a
    // waking-window estimate the way a live/model-estimated forecast does. Hedging that meaning
    // here, while the exposure/ranking engine still treats the same number as certain, produced a
    // self-contradiction rather than a fix. The actual defect — a daily FORECAST statement
    // ("the forecast is 50°F high and 40°F low") getting set as this certain field in the first
    // place, decoupled from a narrower stated activity window — is fixed upstream, at the point
    // where the model decides whether to populate `user_weather.high_f/low_f` at all
    // (`USER_WEATHER_SCHEMA`, styling-engine/tools.js). By the time a number reaches here, it is
    // supposed to mean what the ratified contract says it means, so this line states it plainly.
    const tempText = Number.isFinite(Number(weatherProfile?.highF))
      ? `${Math.round(Number(weatherProfile.highF))}°F high${Number.isFinite(Number(weatherProfile?.lowF)) ? ` / ${Math.round(Number(weatherProfile.lowF))}°F low` : ''}`
      : ''
    // EVIDENCE, NOT AN INSTRUCTION (principle 3: code constrains, the model judges). The first
    // version of this block told the model a layer was REQUIRED and named the warmth it had to
    // reach — an imperative that then had to contradict itself ("a midweight knit counts") and was
    // resolved by the model in the wrong direction: live run 2077 put a `moderate` or `very light`
    // layer on four of five cards and every one drew an undershoot note. The engine's job here is
    // to state what the conditions ask for in the SAME vocabulary the piece labels already carry,
    // and what the shown wardrobe can answer it with. Choosing the layer stays the model's.
    //
    // Same shape the trip flow already ships (outfitSetPlanner's slotThermalDemandLabel /
    // slotExposureConditions), which replaced a computed `thermal_demand` target for exactly this
    // reason; the composer never got it.
    const demandLabel = slotThermalDemandLabel(composerExposure)
    const shownLayers = shownPieces.filter(piece => wardrobeCategoryGroup(piece) === 'outerwear')
    // THE LAYER BAND, not the base band — the same correction the roster reserve carries. A
    // removable layer answers `weatherDemand.layer` (light..warm on a 65/46 day), which spans the
    // day because the layer comes off; the base band is what the whole outfit must reach at the
    // cold end. An earlier version of this list read the base band and admitted anything that was
    // not an undershoot, so `very warm` winter coats were advertised to the model as adequate and
    // three of five live cards shipped one on a 65°F afternoon.
    //
    // An untagged layer (`unknown`) is counted neither way — the sentence below claims only what
    // labels actually say, and calling an unmeasured piece inadequate is the criterion-8 error this
    // arc keeps paying for.
    //
    // The sentence in the prompt states how many there are; the pieces themselves order the
    // outerwear block. One derivation, so the count and the ordering cannot disagree.
    const layerDemand = weatherDemand.layer || weatherDemand
    const layerAnswersDemand = piece => compareThermalFit(garmentWarmthLevel(piece), layerDemand).fit === 'adequate'
    const qualifyingLayers = weatherDemand.level
      ? shownLayers.filter(layerAnswersDemand)
      : []

    // THE REPAIR'S OWN BENCH, not the composer's presentation cap (owner ruling 2026-09-13).
    //
    // `shownLayers` is what fits in ONE call's image budget after the roster cap — a presentation
    // limit, not an eligibility boundary. Sourcing repair candidates from it inherited that limit as
    // validity: on live thread_1789288270913 the wardrobe held 25 weather-qualifying hard-eligible
    // layers and the repair could only ever see 7, with the navy puffer, the cream trench and the
    // lavender fleece invisible to it for no reason but cap position.
    //
    // `recoveryEligiblePieces` is the existing authority for exactly this distinction — pieces
    // omitted only for presentation or capacity, never one rejected by a weather, register,
    // activity, footwear or metadata validity gate — and the comfort-footwear repair already
    // sources from it. This follows the same precedent as PR 315's trip bench and PR 316's complete
    // sparse catalog: a later stage gets the full eligible set, not the first stage's shortlist.
    const repairLayerBench = weatherDemand.level
      ? (poolEvaluation.recoveryEligiblePieces || [])
          .filter(piece => wardrobeCategoryGroup(piece) === 'outerwear')
          .filter(layerAnswersDemand)
      : []
    const qualifyingLayerCount = qualifyingLayers.length
    // The claim this replaces said "everything shown is weather-optimized" whenever a demand
    // existed — on run 2077 nothing whatsoever had been excluded for weather, so the model was told
    // the roster had already settled a question it had not. Ordering is not removal; say which one
    // happened.
    // BOTH removal stages, or the count lies. A hot-weather wool dress is dropped by automatic-use
    // suppression BEFORE the roster is built (suppressedPieces, `reasons[]`), while the cool/cold
    // and outerwear-cap drops happen inside the pool evaluation (excluded, `reason`). Counting only
    // the second reported "nothing was removed" on a run that had just removed a piece.
    const weatherReason = value => /weather|insulat|season/i.test(String(value || ''))
    const weatherExcludedCount =
      (excluded || []).filter(entry => weatherReason(entry?.reason)).length +
      (suppressedPieces || []).filter(piece => (piece?.reasons || []).some(weatherReason)).length
    content.push({ type: 'text', text: [
      location ? `Location: ${location}` : '',
      `Occasion: ${occasion}`,
      `Season: ${season}`,
      tempText ? `Temperature: ${tempText}${demandLabel ? ' — judge the outfit against the range, not against a number' : ''}` : '',
      mood ? `Mood: ${mood}` : '',
      stylingRequest ? `Styling request: ${stylingRequest}` : '',
      activity && activity !== 'none' ? `Activity: ${activity}` : '',
      activityFactLine,
      occasionProfileGuidance ? `Occasion guidance:\n${occasionProfileGuidance}` : '',
      isWeatherFiltered
        ? (weatherExcludedCount
            ? `${weatherExcludedCount} piece${weatherExcludedCount === 1 ? '' : 's'} plainly unsuited to these conditions ${weatherExcludedCount === 1 ? 'was' : 'were'} removed from this roster; that removal does not certify the rest as warm enough — the rest are ordered by overall relevance, which counts weather fit alongside occasion and wear history, so position is a hint, not a verdict, and each piece is judged by its own stated facts.`
            : 'No piece was removed for weather; the roster is ordered by overall relevance, which counts weather fit alongside occasion and wear history — so position is a hint, not a verdict, and each piece is judged by its own stated facts.')
        : '',
      'Garment wear facts in the image labels are constraints. Obey them silently. Opacity and base-layer facts are authoritative: do not call an opaque garment sheer. Do not infer a required base layer from lace, armhole, neckline or sleeve shape; layer underneath only when it serves a stated styling or practical purpose. Do not repeat a fixed fact the owner already knows merely to fill styling_instructions; use that field only for an actual, useful action or chosen relationship between pieces.',
      'CARD WEAR MECHANICS & RENDERER CONTRACT: styling_instructions is the authoritative placement guidance for the image renderer and persists on the card. If the user requested a specific wear mechanic (untucked, belted, sleeves pushed, worn open) or if two pieces have a physical placement relationship (such as a top over a waistband, or an open cardigan over a dress), state it concisely in styling_instructions.',
      // TIME-OF-DAY WEATHER removed (owner ruling 2026-09-15): the stated range and the request text, including outing hours, carry
      // the conditions; its garment and layer prescriptions were not neutral facts.
      // COOL-END LAYER removed (2026-09-15): an engine-derived requirement that also quoted the old `opacity: sheer` label format.
      `Compose ${requestedLimit} outfits.`,
      // 2026-09-15 (owner ruling): both paragraphs previously pushed toward variety and thermal
      // uniformity as ends in themselves — forcing a weaker alternative merely to look different,
      // and banning mixed thermal weight across cards regardless of what each outfit actually needs
      // for the stated conditions. Replaced with judgment of each card on its own merits.
      comparisonSetGuidance && requestedLimit > 1 && !composerExperiment?.holdOutComparisonSet
        ? 'COMPARISON SET CONTRACT: These options will be compared side by side. Each card should be worthwhile on its own; meaningful alternatives are welcome, but do not choose a weaker outfit merely to avoid repeating a sound formula. Activity-safe footwear may repeat when the activity narrows the valid shoe choices.\nOUTFIT CONDITIONS FIT: Judge each complete outfit for the user\'s stated conditions and exposure; alternatives need not carry uniform thermal weight. Count a removable layer only when it is actually included in the outfit and realistically wearable in it. Do not invent indoor stops or timing to justify a lighter or heavier look.'
        : '',
      savedVariantGuidance,
      rotationWarningsText,
      wholeWardrobeFeedbackText ? `Feedback memory (exact reactions — each applies to its own combination only):\n${wholeWardrobeFeedbackText}` : '',
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
    let composerErrorIsTimeout = false
    let composerUsage = null
    const composerStartedAt = Date.now()
    const composerMaxTokens = structuredResponseMaxTokens(composerExperiment?.maxTokensForCount || requestedLimit)
    const productionSystemPrompt = wholeWardrobeVisualComposerSystemPrompt(savedVariantGuidance)
    const sleeveSystemPrompt = composerExperiment?.sleeveGuidance === 'neutral' ? withNeutralSleeveGuidance(productionSystemPrompt) : productionSystemPrompt
    const explainDayWear = composerExperiment?.dayWearGuidance === 'explain'
    const systemPrompt = explainDayWear ? withDayWearExplanation(sleeveSystemPrompt) : sleeveSystemPrompt
    const composerSchema = composerOutfitSlotsSchema({ minOutfits: requestedLimit, wearThroughDay: explainDayWear })
    const composerRequestIdentityRecord = composerExperiment
      ? composerRequestIdentity({ system: systemPrompt, content, schema: composerSchema, model: resolveAiTarget(providerOverride).model, maxTokens: composerMaxTokens })
      : null
    // SEALED EXPERIMENT REQUEST: compared immediately before the provider call. A mismatch refuses here, so a
    // changed prompt, garment fact, photograph, schema, model or budget can never reach a paid call.
    if (composerExperiment?.requireSealedRequest && composerRequestIdentityRecord.sha256 !== composerExperiment.expectedRequestIdentitySha256) {
      throw new Error(`Sealed composer request identity mismatch (expected ${composerExperiment.expectedRequestIdentitySha256}, got ${composerRequestIdentityRecord.sha256}); no provider call was made`)
    }
    try {
      const composerResult = await withTimeout(signal => askStylistStructuredWithUsage({
        system: systemPrompt,
        maxTokens: composerMaxTokens,
        messages: [{ role: 'user', content }],
        providerOverride,
        schema: composerSchema,
        name: 'wardrobe_outfits',
        description: 'Return the composed outfits, each garment named by ID in the slot for its job.',
        subflow: 'whole_wardrobe_visual_composer',
        signal,
      }), 120000, 'Visual wardrobe composer')
      timings.composerMs = Date.now() - composerStartedAt
      composerUsage = composerResult.usage
      parsed = composerResult.value || {}
    } catch (err) {
      composerError = err.message
      composerErrorIsTruncation = Boolean(err.isTruncation)
      composerErrorIsTimeout = Boolean(err.isTimeout)
      timings.composerMs = timings.composerMs || null
    }

    // COMPOSER-ONLY EXPERIMENT BOUNDARY: stop here. The raw composer result and the exact request are
    // returned; no post-composition stage runs.
    if (composerExperiment) {
      return {
        experimentComposerOnly: {
          manifest: composerExperiment,
          requestedLimit,
          request: {
            system: systemPrompt,
            systemSha256: createHash('sha256').update(systemPrompt).digest('hex'),
            maxTokens: composerMaxTokens,
            schema: composerSchema,
            textParts: content.filter(part => part.type === 'text').map(part => part.text),
            imageCount: content.filter(part => part.type === 'image').length,
          },
          requestIdentity: composerRequestIdentityRecord,
          imageManifest: experimentImageManifest,
          roster: shownPieces.map(piece => Number(piece.id)),
          resolvedContext: {
            occasion, season, activity, mission, mood,
            highF: weatherProfile?.highF ?? null, lowF: weatherProfile?.lowF ?? null,
            weatherSource: weatherProfile?.weatherSource || null,
            location: weatherProfile?.resolvedWeatherContext?.location || location || '',
          },
          raw: parsed,
          composerUsage,
          composerError,
          composerErrorIsTruncation,
          timings,
        },
      }
    }

    // Resolve slots (composerSlots.js): IDs only, names from the wardrobe, every stated role kept and
    // none derived. Every card is kept — one the slots or the shared evaluator reject becomes a
    // diagnostic card carrying the model's own fields and all of its findings.
    const unresolvedReferences = []
    const slotFindingsByOutfit = new Map()
    const normalizedModelOutfits = (Array.isArray(parsed?.outfits) ? parsed.outfits : []).map(outfit => {
      const slots = resolveComposerSlotOutfit(outfit, allowedPieces)
      for (const finding of slots.slotFindings.filter(item => item.code === 'unknown_piece_id')) {
        unresolvedReferences.push({ id: finding.evidence.pieceId, name: null, slot: finding.evidence.slot, outfitLabel: outfit?.label || 'unlabeled' })
      }
      const card = {
        ...sanitizeWholeWardrobeOutfitProse(normalizeWholeWardrobeOutfitObject({ ...outfit, pieceIds: slots.pieceIds, pieces: slots.pieces }, allowedPieces, { deriveMissingRoles: false })),
        modelSlots: slots.modelSlots,
      }
      slotFindingsByOutfit.set(card, slots.slotFindings)
      return card
    })
    const resolved = normalizedModelOutfits.filter(outfit => !slotFindingsByOutfit.get(outfit).some(finding => finding.code === 'unknown_piece_id'))
    const validationByOutfit = new Map(normalizedModelOutfits.map(outfit => [
      outfit,
      withSlotFindings(evaluateWearableOutfit(outfit.pieces, { requireShoes: true }), slotFindingsByOutfit.get(outfit)),
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
      unknown_piece_id: 'structural: a slot names an ID that is not in the roster',
      slot_category_mismatch: 'structural: a garment is in the wrong slot for its category',
      duplicate_slot_piece: 'structural: one garment fills two slots',
      invalid_slot_value: 'structural: a slot does not hold a garment ID',
      required_base_missing: 'dependency: required base layer is missing',
      required_base_incompatible: 'dependency: required base layer is incompatible',
    }[validation?.primaryFinding?.code] || validation?.primaryFinding?.message || 'structural: not a complete wardrobe outfit')
    // EVERY structural finding, not only the first. thread_1789346300319's spliced card was recorded
    // as "more than one bottom" while the evaluator had ALSO found `missing_top_or_dress`. The card
    // stays visible during development with the model's own fields untouched — its malformed prose is
    // the evidence of how the composer failed — and now carries the complete finding list beside it.
    const structurallyRejectedModelOutfits = normalizedModelOutfits
      .filter(outfit => !validationByOutfit.get(outfit).hardValid)
      .map(outfit => {
        const validation = validationByOutfit.get(outfit)
        const structuralFindings = (validation.hardFindings || []).map(finding => ({
          code: finding.code,
          message: finding.message,
        }))
        return {
          outfit: { ...outfit, structuralFindings },
          reason: structuralFindings.length > 1
            ? structuralFindings.map(finding => structuralRejectionReason({ primaryFinding: finding })).join('; ')
            : structuralRejectionReason(validation),
        }
      })

    // The composer above proposes from ISOLATED per-garment photos and never sees two pieces
    // together — its own written "reason" can rationalize a pairing that the actual photos, side
    // by side, show clashing (e.g. two busy prints it argued "share a warm palette"). This second
    // pass shows it the composed outfits together and judges only the photos, not that prose.
    // Gated to outfits that already look questionable on cheap tag/name signal — most outfits
    // have no real clash risk, and reviewing all of them would just be paying for a second
    // opinion nobody asked for. Non-fatal: a critic failure must never block the whole turn.
    let visualClashDebug = null
    let clashFlaggedByOutfit = new Map()
    // A note annotates; only a reject removes a card (conservative critic threshold, 2026-09-13).
    let clashNotedByOutfit = new Map()
    const structurallyValidForClashReview = normalizedModelOutfits.filter(outfit => validationByOutfit.get(outfit).hardValid)
    // normalizeWholeWardrobeOutfitObject trims outfit.pieces to {id, name, category, photo,
    // worn_photo} — pattern_complexity and style_profile_json are gone by here, so the
    // questionable-check would silently see nothing to flag. Rehydrate against allowedPieces by
    // id for the check only; the outfit objects that ship to the client stay trimmed as-is.
    const allowedPieceById = new Map(allowedPieces.map(piece => [Number(piece.id), piece]))
    const visualReviewCandidates = structurallyValidForClashReview.map(outfit => ({
      outfit,
      // Keep each card's own role (same rehydration `debug.sleeveGeometryShadow` below uses) so the
      // sleeve-construction half of this check can identify layering pairs correctly.
      findings: wholeWardrobeOutfitVisualReviewFindings({
        pieces: (outfit.pieces || []).map(piece => ({ ...(allowedPieceById.get(Number(piece.id)) || piece), role: piece?.role }))
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
        const clashReview = await withTimeout(signal => reviewComposedWholeWardrobeOutfitsForClash({
          outfits: questionableForClashReview,
          occasion,
          season,
          mood,
          memoryText: wholeWardrobeFeedbackText,
          providerOverride,
          signal
        }), 20000, 'Whole-wardrobe clash critic')
        if (clashReview?.flaggedByOutfit?.size) {
          clashFlaggedByOutfit = clashReview.flaggedByOutfit
        }
        if (clashReview?.notedByOutfit?.size) {
          clashNotedByOutfit = clashReview.notedByOutfit
        }
        // The critic's own spend was previously invisible to the turn's cost total — folded into
        // composerUsage (below, before the final estimateAiUsageCost call) so the parent figure is
        // no longer an undercount whenever the critic actually fires, not just recorded separately.
        if (clashReview?.usage && composerUsage) {
          composerUsage = {
            ...composerUsage,
            inputTokens: (composerUsage.inputTokens || 0) + (clashReview.usage.inputTokens || 0),
            outputTokens: (composerUsage.outputTokens || 0) + (clashReview.usage.outputTokens || 0),
            totalTokens: (composerUsage.totalTokens || 0) + (clashReview.usage.totalTokens || 0),
            cacheReadInputTokens: (composerUsage.cacheReadInputTokens || 0) + (clashReview.usage.cacheReadInputTokens || 0),
            cacheCreationInputTokens: (composerUsage.cacheCreationInputTokens || 0) + (clashReview.usage.cacheCreationInputTokens || 0),
          }
        }
        visualClashDebug = {
          reviewedCount: clashReview?.reviewedCount || 0,
          flaggedCount: clashFlaggedByOutfit.size,
          notedCount: clashNotedByOutfit.size,
          skippedNotQuestionable: structurallyValidForClashReview.length - questionableForClashReview.length,
          findingCounts: visualReviewFindingCounts,
          usage: clashReview?.usage || null,
          estimatedCost: clashReview?.usage ? estimateAiUsageCost(clashReview.usage) : null,
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
      .map(outfit => {
        // Garment-fact integrity (thread_1789508440573): styling_instructions may not tuck a base top recorded wear_over_only.
        // The trimmed card pieces lose tuck_behavior, so rehydrate by id and keep each card piece's role.
        const tuck = correctTuckInstruction({
          pieces: (outfit.pieces || []).map(piece => ({ ...(allowedPieceById.get(Number(piece.id)) || {}), ...piece, tuck_behavior: allowedPieceById.get(Number(piece.id))?.tuck_behavior ?? piece.tuck_behavior })),
          stylingInstructions: outfit.stylingInstructions || outfit.styling_instructions || '',
        })
        const tuckConflict = tuck.conflict
        const systemFlags = [
          ...(Array.isArray(outfit.systemFlags) ? outfit.systemFlags : []),
          ...(clashNotedByOutfit.has(outfit) ? [{ type: 'Visual note', message: clashNotedByOutfit.get(outfit) }] : []),
          ...(tuckConflict ? [{ type: 'Fit note', code: tuckConflict.code, message: tuckConflict.message }] : []),
        ]
        return {
        ...outfit,
        // The recorded fact wins: the contradicted clause does not ship as authoritative placement guidance (the renderer is told to
        // follow styling_instructions exactly). The card keeps what the model wrote, marked as corrected, so nothing is hidden.
        ...(tuckConflict ? { stylingInstructions: tuck.corrected, stylingInstructionsOriginal: tuck.original, stylingInstructionsCorrection: tuckConflict.message } : {}),
        ...(systemFlags.length ? { systemFlags } : {}),
        savedOutfitVariantMode: savedVariantMode,
        sourceFormulaFamily: savedSeedFormula,
        systemSuggestion: comfortFootwearSuggestionForOutfit(outfit, allowedPieces, comfortConstraint, { weatherProfile, occasion, mood, activity })
      }
      })

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
      outfitCountCheck: composerOutfitCountCheck(parsed, { minOutfits: requestedLimit }),
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
    let structuredOutfits = (gatedModel.outfits || []).slice(0, requestedLimit)

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
        // Diagnostics are the model's own answers, de-duplicated by what it returned — the slot
        // signature, or the card's index — never by garment set: a malformed slot assignment of a ready
        // card's garments is exactly the evidence a diagnostic exists to show. Ready cards keep their
        // garment-set de-duplication, and garment keys are still recorded for the local-fill loop.
        const seenDiagnosticKeys = new Set()
        for (const [index, candidate] of rejectedModelDiagnostics.entries()) {
          const key = candidate.outfit?.modelSlots
            ? `slots:${JSON.stringify(candidate.outfit.modelSlots)}`
            : `model-card:${index}`
          if (seenDiagnosticKeys.has(key)) continue
          
          const label = candidate.outfit.title || candidate.outfit.direction || candidate.outfit.label || 'unlabeled'
          const specificUnresolved = unresolvedReferences.filter(ref => ref.outfitLabel === label)
          let resolutionNote = null
          if (specificUnresolved.length > 0) {
            const details = specificUnresolved.map(ref => `model put id ${ref.id ?? 'unknown id'} in ${ref.slot || 'a slot'} — not found in the roster`).join('; ')
            resolutionNote = `${details}. Piece may have been excluded by a gate after the model saw it, or the ID was invalid.`
          }
          
          const diagnostic = buildBrokenModelCard(candidate.outfit, candidate.reason, resolutionNote)
          if (!diagnostic) continue
          diagnostics.push(diagnostic)
          seenDiagnosticKeys.add(key)
          const garmentKey = outfitKey(candidate.outfit)
          if (garmentKey) seenKeys.add(garmentKey)
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
    // ── ONE bounded missing-layer repair pass (owner ruling 2026-09-13) ────────────────────────
    //
    // Live thread_1789274358263: five cards at 65/50, four of them carrying
    // NO_REMOVABLE_COOL_LAYER. The evaluator detected every one, `advisorFlaggedCount` counted
    // them, and nothing consumed that number — detection with no return path, so the set shipped
    // knowing four of its five cards lacked the configuration the conditions require.
    //
    // This is NOT the retired revision pass. That one mutated piece lists field-wise: it dropped
    // every outerwear-category garment and appended one replacement, which destroyed legitimate
    // `layer_top` + `outerwear` compositions. This one asks for ONE layer to be added to a card
    // whose other garments are preserved verbatim, rebuilds the card from the ORIGINAL pieces plus
    // that layer (the model's own id list is checked for tampering, never trusted as the card), and
    // validates the whole resulting card through the complete evaluator.
    //
    // Bounded: one batched call, never recursive, and only when both halves are real — at least one
    // deficient card AND at least one shown layer that suits the conditions. A wardrobe with no
    // adequate layer pays nothing and keeps its honest disclosure.
    const outfitEnvironmentFindings = outfit => {
      // Same rehydration the gate does: full garment facts, the card's own role preserved, because
      // the role is the only record of which piece is worn over which.
      const owned = (outfit.pieces || []).map(piece => {
        const match = allowedPieceById.get(Number(piece.id))
        if (!match) return piece
        return piece?.role ? { ...match, role: piece.role } : match
      })
      // ROLE-AWARE EVALUATION NEEDS ROLES. A composer card states a role only where it matters to
      // the model, so bottoms and shoes routinely arrive without one; feeding those straight into a
      // roleAware evaluation produces `invalid_role` for every card, which would make the
      // before/after comparison below meaningless. The same derivation the gate uses fills the gaps
      // and never overrides a role the card actually stated.
      const derivedRoles = deriveWholeWardrobeRoles(owned)
      const rehydrated = owned.map(piece => (piece?.role ? piece : { ...piece, role: derivedRoles.get(Number(piece.id)) || piece.role }))
      const validation = evaluateWearableOutfit(rehydrated, {
        roleAware: true,
        includeLayerDirections: true,
        weatherContext: weatherProfile ? { weatherProfile, activity } : null,
      })
      return {
        rehydrated,
        hard: (validation.hardFindings || []).map(finding => finding.code),
        advisory: (validation.advisoryFindings || []).map(finding => finding.code),
        // Kept whole so the repair call can quote the triggering finding verbatim rather than a
        // restatement of it.
        all: [...(validation.hardFindings || []), ...(validation.advisoryFindings || [])],
        // The endpoint evaluator's own verdict for the COMPLETED system. Already computed for every
        // candidate by the viability screen and previously discarded.
        endpointFit: validation.stages?.find(stage => stage.stage === 'environment')?.result?.evidence?.endpointFit || null,
      }
    }
    const missesCoolLayer = codes => codes.includes(ENVIRONMENTAL_ADEQUACY_CODES.NO_REMOVABLE_COOL_LAYER)
    // Building one repaired card is pure and cheap, so per-card feasibility is decided BEFORE the
    // paid call rather than after it.
    const repairedCardFor = (entry, layer) => sanitizeWholeWardrobeOutfitProse(normalizeWholeWardrobeOutfitObject({
      ...entry.outfit,
      pieceIds: [...entry.findings.rehydrated.map(piece => Number(piece.id)), Number(layer.id)],
      pieces: [...entry.findings.rehydrated, { ...layer, role: 'outerwear' }],
    }, allowedPieces))
    // The three typed acceptance conditions, in one place so the pre-call viability screen and the
    // post-call acceptance cannot drift apart.
    const repairVerdict = (entry, layer) => {
      const after = outfitEnvironmentFindings(repairedCardFor(entry, layer))
      const endpointFit = after.endpointFit
      // WHAT THIS CANDIDATE LEAVES BEHIND. The triggering finding is not the only weather note a
      // card can carry: live thread_1789341140366 repaired "Graphic Tee Utility" with an adjacent
      // light jacket, cleared NO_REMOVABLE_COOL_LAYER, and shipped a card still reading "a warm or
      // midweight layer is recommended" — which eleven on-target candidates would have cleared.
      // The residual set is computed here anyway; it was simply thrown away.
      const residualWeather = (after.all || [])
        .filter(finding => ENVIRONMENTAL_CODE_SET.has(finding.code) && !missesCoolLayer([finding.code]))
        .map(finding => ({ code: finding.code, message: finding.message }))
      if (missesCoolLayer(after.advisory) || missesCoolLayer(after.hard)) return { ok: false, why: 'finding_remains', endpointFit, residualWeather }
      const beforeHard = new Set(entry.findings.hard)
      const newHard = after.hard.filter(code => !beforeHard.has(code))
      if (newHard.length) return { ok: false, why: 'new_deficiency', detail: newHard, endpointFit, residualWeather }
      const before = new Set([...entry.findings.advisory, ...entry.findings.hard])
      const introduced = after.advisory.filter(code => !before.has(code) && !isInabilityToJudgeCode(code))
      if (introduced.length) return { ok: false, why: 'new_deficiency', detail: introduced, endpointFit, residualWeather }
      return { ok: true, endpointFit, residualWeather }
    }
    // THE EVALUATOR'S EXISTING VERDICT, IN WORDS. Not a new authority and not a threshold: this
    // renders `endpointFit` — the same fits/adjacent/direction result the engine already uses for
    // ranking — so the model can see which candidate puts the COMPLETED system on target and which
    // is merely an acceptable neighbour. Adjacency stays acceptable; it is now visible.
    // THE LAYER-ON CONFIGURATION SPECIFICALLY. `endpointFit.cold` summarises the BEST configuration
    // the wearer can reach, which for a repaired card may be a state with the new layer taken off —
    // so rendering it under a line that says "with that layer on" would describe something else.
    // The per-configuration evidence the evaluator already records carries the as-composed state as
    // `removedPieceId: null`; this reads that entry. Nothing about the evaluator or adjacency
    // acceptance changes — only which existing row the sentence quotes.
    const describeLayerOn = fit => {
      const asComposed = (fit?.configurations || []).find(entry => entry.removedPieceId === null)
      if (!asComposed || asComposed.unknown || asComposed.coldDelta == null) return 'unknown from saved facts'
      const delta = asComposed.coldDelta
      if (delta === 0) return 'on target'
      const adjacentSuffix = experimentNeutralVerdicts() ? '' : ' (acceptable)'
      if (Math.abs(delta) === 1) return delta > 0 ? `one level over target${adjacentSuffix}` : `one level under target${adjacentSuffix}`
      return delta > 0 ? 'substantially over target' : 'substantially under target'
    }
    const describeEndpoint = end => {
      if (!end || !end.verdict || end.verdict === 'no_target') return 'unknown'
      if (end.verdict === 'cannot_judge') return 'unknown from saved facts'
      if (end.verdict === 'fits') {
        if (!end.adjacent) return 'on target'
        const adjacentSuffix = experimentNeutralVerdicts() ? '' : ' (acceptable)'
        return end.direction === 'over' ? `one level over target${adjacentSuffix}` : `one level under target${adjacentSuffix}`
      }
      if (end.verdict === 'substantial_shortfall') return 'substantially under target'
      if (end.verdict === 'substantial_excess') return 'substantially over target'
      return 'unknown'
    }
    const warmEndVaries = entry => new Set((entry.viableLayers || [])
      .map(candidate => describeEndpoint(candidate.endpointFit?.warm))).size > 1
    let layerRepairDebug = { attempted: false, deficientCount: 0, qualifyingLayerIds: [] }
    const repairedPairsForReview = []
    // DELIVERABLE CARDS ONLY. Diagnostic cards are broken by construction and exist to be looked at;
    // repairing one would be repairing an exhibit. Local backfill has already run at this point, so
    // a layerless card added by the fill is repaired and counted like any other.
    const deficientBefore = structuredOutfits
      .map((outfit, index) => ({ outfit, index }))
      .filter(entry => !entry.outfit?.diagnosticOnly && !entry.outfit?.broken)
      .map(entry => ({ ...entry, findings: outfitEnvironmentFindings(entry.outfit) }))
      .filter(entry => missesCoolLayer(entry.findings.advisory) || missesCoolLayer(entry.findings.hard))
      .map(entry => ({
        ...entry,
        // PER-CARD MECHANICAL VIABILITY. A layer that suits the weather in isolation is not a
        // candidate for THIS card: it has to survive the complete evaluator on this base — roles,
        // structural caps, wear order, sleeve construction and warmth across configurations. Cards
        // with no viable candidate are excluded from the call entirely rather than being offered
        // options that could only be rejected afterwards, at cost.
        viableLayers: repairLayerBench
          .map(layer => ({ layer, verdict: repairVerdict(entry, layer) }))
          .filter(candidate => candidate.verdict.ok)
          .map(candidate => ({
            layer: candidate.layer,
            endpointFit: candidate.verdict.endpointFit,
            residualWeather: candidate.verdict.residualWeather || [],
          })),
      }))
    layerRepairDebug.deficientCount = deficientBefore.length
    layerRepairDebug.qualifyingLayerIds = repairLayerBench.map(piece => Number(piece.id))
    layerRepairDebug.benchSource = 'recovery_eligible_layers'
    layerRepairDebug.shownLayerCount = qualifyingLayers.length
    layerRepairDebug.viableLayerIdsByCard = deficientBefore.map(entry => ({
      label: entry.outfit.label || null,
      viableLayerIds: entry.viableLayers.map(candidate => Number(candidate.layer.id)),
      // The completed-system verdict per candidate, so a live capture shows what the model was told
      // rather than only which garment it picked.
      candidateEndpointFit: entry.viableLayers.map(candidate => ({
        layerId: Number(candidate.layer.id),
        cold: describeLayerOn(candidate.endpointFit),
        warm: describeEndpoint(candidate.endpointFit?.warm),
      })),
    }))
    const repairable = deficientBefore.filter(entry => entry.viableLayers.length)
    layerRepairDebug.repairableCount = repairable.length

    // 2026-09-16 (owner review, thread_1789546295700): an add-one-layer repair edits a card the
    // composer already styled — it cannot invent styling for a set the composer never produced at
    // all. When the composer returned zero outfits (timeout, provider error, or any other reason
    // `parsed.outfits` came back empty), every deliverable card at this point came from local-fill
    // alone, and every "deficient" entry above is a deterministic assembly, not a model composition
    // with one missing piece. Running the repair pass against it just pays for a second call (this
    // incident's repair took 77s against a 60s budget) to "improve" something no model ever styled.
    // This is deliberately scoped to a genuinely EMPTY composer result, not to "the composer
    // returned outfits but some failed validation" — that is a different, legitimate case (item 4
    // below keeps those as visible diagnostic cards) and still allows repair on whatever the model
    // DID validly compose.
    const composerReturnedNoOutfits = !(Array.isArray(parsed?.outfits) && parsed.outfits.length > 0)
    if (composerReturnedNoOutfits) {
      layerRepairDebug.reason = 'skipped: composer returned zero model-composed outfits this turn'
    } else if (repairable.length) {
      const repairStartedAt = Date.now()
      try {
        // THE SAME EVIDENCE THE COMPOSER HAD: every garment arrives as its photograph plus its
        // structured line, for the card's own pieces and for the candidates. Sleeve construction is
        // added for upper-body garments because that is what decides whether a layer can actually be
        // worn over this base — the evaluator enforces it either way, and asking the model to judge
        // it blind would guarantee rejected repairs.
        const pieceBlock = async piece => {
          const photoFile = piece.worn_photo || piece.photo || ''
          // The shared fact line states sleeve length (unknown when unrecorded) and shape, so no separate sleeve suffix is needed.
          const parts = [{ type: 'text', text: sharedGarmentEvidenceLine(piece) }]
          if (!photoFile) return parts
          const filePath = path.join(userUploadsDir(), photoFile)
          if (!fs.existsSync(filePath)) return parts
          const { maxPx, detail } = pieceVisualDetailPolicy(piece, { allowLow: true })
          const thumb = await prepareWardrobeThumb(filePath, `${piece.id}:${maxPx}:${photoFile}`, { maxPx })
          parts.push({ type: 'image', detail, source: { type: 'base64', media_type: thumb.media_type, data: thumb.data } })
          return parts
        }
        // ONE PHOTOGRAPH PER GARMENT. A shared candidate appears in several cards' lists, and an
        // earlier version re-sent its image inside every card block — the same bytes billed once per
        // card. The manifest is emitted once and the cards reference IDs.
        const manifestPieces = new Map()
        for (const entry of repairable) {
          for (const piece of entry.findings.rehydrated) manifestPieces.set(Number(piece.id), piece)
          for (const candidate of entry.viableLayers) manifestPieces.set(Number(candidate.layer.id), candidate.layer)
        }
        const repairContent = [{ type: 'text', text: [
          `Conditions: ${tempText}`,
          `Occasion: ${occasion}`,
          activity && activity !== 'none' ? `Activity: ${activity}` : '',
          mood ? `Mood: ${mood}` : '',
          // The turn's own words. A card's idea cannot be preserved against a request the repair
          // cannot see — this run's request explicitly asked for looks that do not all follow the
          // same layering formula, which is exactly the tension a repair has to respect.
          stylingRequest ? `The request these cards answer: ${stylingRequest}` : '',
          question ? `The wearer asked: ${question}` : '',
          '',
          GARMENT_FACT_CONVENTIONS,
          'GARMENTS (each photograph appears once; cards below reference these IDs):',
        ].filter(Boolean).join('\n') }]
        for (const piece of manifestPieces.values()) repairContent.push(...await pieceBlock(piece))

        for (const [position, entry] of repairable.entries()) {
          const coolLayerFinding = (entry.findings.all || [])
            .find(finding => finding.code === ENVIRONMENTAL_ADEQUACY_CODES.NO_REMOVABLE_COOL_LAYER)
          repairContent.push({ type: 'text', text: [
            '',
            `=== CARD ${position}: "${entry.outfit.label || 'untitled'}" ===`,
            `Its garments (keep all of these): ${entry.findings.rehydrated.map(piece => `ID ${piece.id}`).join(', ')}`,
            // THE CARD'S OWN WORDS. "Preserve the card's idea" is unactionable when the idea itself
            // was never sent — the repair saw a label and a piece list and nothing else.
            entry.outfit.reason ? `Why it works (its own words): ${entry.outfit.reason}` : '',
            entry.outfit.stylingInstructions ? `Styling instructions: ${entry.outfit.stylingInstructions}` : '',
            entry.outfit.watchFor ? `Watch for: ${entry.outfit.watchFor}` : '',
            // The finding verbatim, not a paraphrase of it.
            coolLayerFinding ? `Engine finding: ${coolLayerFinding.message}` : '',
            ...(experimentNeutralVerdicts()
              ? ['Layer candidates for THIS card, each with what the COMPLETED outfit reads as with that', 'layer on, stated as its level relative to the target:']
              : ['Layer candidates for THIS card, each with what the COMPLETED outfit reads as with that',
                'layer on — the engine\'s own ranking evidence, not a rule. An acceptable neighbour is a',
                'legitimate choice; pick it knowing what it costs:']),
            ...entry.viableLayers.map(candidate => {
              const cold = describeLayerOn(candidate.endpointFit)
              const warm = describeEndpoint(candidate.endpointFit?.warm)
              // The warm end only when it distinguishes anything — repeating an identical warm-end
              // line under every candidate is noise the model has to read past.
              const warmSuffix = warmEndVaries(entry) ? `; with it off, warm end: ${warm}` : ''
              // WHAT REMAINS ON THE CARD with that layer on. Without this the model could see that a
              // candidate was "acceptable" but not that choosing it leaves a second weather note
              // standing which other candidates remove.
              const residual = (candidate.residualWeather || []).length
                ? `; the card would still say: "${candidate.residualWeather.map(item => item.message).join('; ')}"`
                : '; clears every weather note on this card'
              return `  ID ${candidate.layer.id} — with this layer ON, the completed outfit reads ${cold} for the cold end${warmSuffix}${residual}`
            }),
            ...(entry.viableLayers.some(candidate => !(candidate.residualWeather || []).length)
              ? ['  Prefer a candidate that clears every weather note. If you choose one that leaves a note standing, put the visual reason in `tradeoff` — what that layer does for this outfit that the clearing ones do not.']
              : []),
          ].filter(Boolean).join('\n') })
        }

        const repairResult = await withTimeout(signal => askStylistWithUsage({
          system: prompts.WHOLE_WARDROBE_MISSING_LAYER_REPAIR_SYSTEM,
          maxTokens: structuredResponseMaxTokens(repairable.length),
          messages: [{ role: 'user', content: repairContent }],
          providerOverride,
          signal,
        }), 60000, 'Whole-wardrobe missing-layer repair')
        const repairParsed = parseModelJson(repairResult.text, { context: 'whole-wardrobe missing-layer repair' })

        // A BLANKET DECLINE MUST SHOW ITS WORK (owner ruling 2026-09-13). Live
        // thread_1789341140366 dismissed 22 mechanically screened candidates for a sleeveless dress
        // with "thick straps and a waist sash" — the straps and sash are visible, but nothing
        // supported the claim that they defeat EVERY candidate. A decline is still always available;
        // it just has to say which candidates it weighed, and naming one arbitrary id does not
        // license dismissing the rest, so the strongest group has to be among them.
        const strongestFor = entry => {
          const clean = entry.viableLayers.filter(candidate => !(candidate.residualWeather || []).length)
          const pool = clean.length ? clean : entry.viableLayers
          return new Set(pool.map(candidate => Number(candidate.layer.id)))
        }
        const declines = (Array.isArray(repairParsed?.declines) ? repairParsed.declines : []).map(decline => {
          const entry = repairable[Number(decline?.cardIndex)]
          const considered = (Array.isArray(decline?.consideredLayerIds) ? decline.consideredLayerIds : []).map(Number).filter(Boolean)
          const reason = String(decline?.reason || '').trim()
          const strongest = entry ? strongestFor(entry) : new Set()
          const namesStrongest = considered.some(id => strongest.has(id))
          const unsupportedReason = !entry ? 'unknown card'
            : !considered.length ? 'named no candidate it considered'
            : !namesStrongest ? 'did not weigh any of the strongest candidates for this card'
            : reason.length < 20 ? 'no specific visual relationship given'
            : null
          return {
            cardIndex: Number(decline?.cardIndex),
            consideredLayerIds: considered,
            reason: reason.slice(0, 300),
            supported: !unsupportedReason,
            unsupportedReason,
          }
        })

        const rejections = { unknown_layer: 0, not_a_layer_repair: 0, gate_rejected: 0, finding_remains: 0, new_deficiency: 0, unexplained_tradeoff: 0 }
        const rejectionDetail = []
        let repairedCount = 0
        let repairedCleanCount = 0
        const repairsRetainingAdvice = []
        for (const repair of (Array.isArray(repairParsed?.repairs) ? repairParsed.repairs : [])) {
          const entry = repairable[Number(repair?.cardIndex)]
          if (!entry) { rejections.not_a_layer_repair++; continue }
          // Only a layer that was offered for THIS card counts — the viability screen above is the
          // candidate list, not a suggestion.
          const layer = entry.viableLayers.find(candidate => Number(candidate.layer.id) === Number(repair?.layerId))?.layer
          if (!layer) { rejections.unknown_layer++; continue }

          // TAMPER CHECK, not a piece list to trust. The card is rebuilt from its ORIGINAL pieces
          // plus the one layer; the model's `pieceIds` only has to agree with that, or this was a
          // recomposition rather than the missing-layer repair that was asked for.
          const originalIds = entry.findings.rehydrated.map(piece => Number(piece.id))
          const proposedIds = (Array.isArray(repair?.pieceIds) ? repair.pieceIds : []).map(Number)
          const expected = new Set([...originalIds, Number(layer.id)])
          if (proposedIds.length && (proposedIds.length !== expected.size || proposedIds.some(id => !expected.has(id)))) {
            rejections.not_a_layer_repair++
            continue
          }
          const repairedPieces = [...entry.findings.rehydrated, { ...layer, role: 'outerwear' }]
          const candidate = sanitizeWholeWardrobeOutfitProse(normalizeWholeWardrobeOutfitObject({
            ...entry.outfit,
            reason: String(repair?.reason || '').trim() || entry.outfit.reason,
            styling_instructions: String(repair?.stylingInstructions || '').trim() || entry.outfit.stylingInstructions,
            pieceIds: repairedPieces.map(piece => Number(piece.id)),
            pieces: repairedPieces,
          }, allowedPieces))

          const regated = locallyGateWholeWardrobeOutfits(
            [candidate],
            1,
            { mode: 'advisor', requireShoes: true, rejectProfileDiscouraged: true, applyDiversity: false, candidatePieces: allowedPieces, occasion, mood, season, weatherProfile, activity, sessionInfluence, request: stylingRequest, question }
          )
          const accepted = regated.outfits?.[0]
          if (!accepted) { rejections.gate_rejected++; continue }

          // TYPED ACCEPTANCE, re-checked on the card the gate actually returned (the gate may repair
          // or annotate it), using the same three conditions the viability screen used.
          const verdict = repairVerdict({ ...entry, findings: entry.findings }, layer)
          if (!verdict.ok) {
            rejections[verdict.why]++
            if (verdict.detail) rejectionDetail.push({ cardIndex: Number(repair?.cardIndex), layerId: Number(layer.id), introduced: verdict.detail })
            continue
          }
          // A REPAIR THAT LEAVES WEATHER ADVICE MUST SAY WHY. Not a gate on adjacency — the model may
          // still take a candidate that keeps a note standing — but when a clearing candidate was on
          // the same list, the visual reason for passing it over has to be stated. An unexplained
          // one is not accepted, and the original card ships with its advisory rather than being
          // quietly swapped for another card that still carries one.
          const chosen = entry.viableLayers.find(candidate => Number(candidate.layer.id) === Number(layer.id))
          const residual = chosen?.residualWeather || []
          const cleanAlternativeExists = entry.viableLayers.some(candidate => !(candidate.residualWeather || []).length)
          const tradeoff = String(repair?.tradeoff || '').trim()
          if (residual.length && cleanAlternativeExists && tradeoff.length < 12) {
            rejections.unexplained_tradeoff++
            rejectionDetail.push({
              cardIndex: Number(repair?.cardIndex),
              layerId: Number(layer.id),
              retains: residual.map(item => item.code),
            })
            continue
          }
          structuredOutfits = structuredOutfits.map(outfit => (outfit === entry.outfit ? accepted : outfit))
          repairedPairsForReview.push({ original: entry.outfit, repaired: accepted, clean: !residual.length })
          repairedCount++
          if (residual.length) {
            repairsRetainingAdvice.push({
              label: entry.outfit.label || null,
              layerId: Number(layer.id),
              retains: residual.map(item => item.code),
              tradeoff,
            })
          } else {
            repairedCleanCount++
          }
        }

        if (repairResult?.usage && composerUsage) {
          composerUsage = {
            ...composerUsage,
            inputTokens: (composerUsage.inputTokens || 0) + (repairResult.usage.inputTokens || 0),
            outputTokens: (composerUsage.outputTokens || 0) + (repairResult.usage.outputTokens || 0),
            totalTokens: (composerUsage.totalTokens || 0) + (repairResult.usage.totalTokens || 0),
          }
        }
        layerRepairDebug = {
          ...layerRepairDebug,
          attempted: true,
          repairedCount,
          // SPLIT, so a capture cannot read five-for-five when some cards still carry weather advice.
          repairedCleanCount,
          repairsRetainingAdvice,
          declinedCount: declines.length,
          declines: declines.map(decline => ({
            cardIndex: decline.cardIndex,
            consideredLayerIds: decline.consideredLayerIds,
            supported: decline.supported,
            unsupportedReason: decline.unsupportedReason,
            reason: decline.reason,
          })),
          rejections,
          rejectionDetail,
          ms: Date.now() - repairStartedAt,
          usage: repairResult?.usage || null,
        }
      } catch (err) {
        // Non-fatal, like every other optional pass: the composer's own cards ship with their notes.
        console.warn('Whole-wardrobe missing-layer repair fallback:', err.message)
        layerRepairDebug = { ...layerRepairDebug, attempted: true, error: err.message }
      }
    } else if (deficientBefore.length) {
      // Both no-call reasons are real and distinct: nothing in the wardrobe suits the conditions at
      // all, versus layers that suit the weather but none that works on any deficient card.
      layerRepairDebug.reason = repairLayerBench.length
        ? 'no weather-suitable layer is mechanically viable on any deficient card'
        : 'no hard-eligible layer suits these conditions'
    }

    // ── visual review of the REPAIRED combinations only ────────────────────────────────────────
    //
    // The clash critic runs before this pass, on the composer's own cards, so combinations the
    // repair creates were never seen by it: live thread_1789341140366 shipped four repaired cards
    // with `visualClashReview.reviewedCount: 0`. Scoped to the repaired subset — the originals were
    // already reviewed — and never recursive: a rejected repair RESTORES the original card with its
    // weather advisory and rejoins the set disclosure. No silent drops, no second repair attempt.
    if (repairedPairsForReview.length) {
      try {
        const repairedReview = await withTimeout(signal => reviewComposedWholeWardrobeOutfitsForClash({
          outfits: repairedPairsForReview.map(pair => pair.repaired),
          occasion,
          season,
          mood,
          memoryText: wholeWardrobeFeedbackText,
          providerOverride,
          signal
        }), 20000, 'Repaired-card clash critic')
        const flagged = repairedReview?.flaggedByOutfit || new Map()
        const noted = repairedReview?.notedByOutfit || new Map()
        const restored = []
        const annotated = []
        for (const pair of repairedPairsForReview) {
          if (flagged.has(pair.repaired)) {
            // A clear, photograph-grounded failure: restore the original with its weather advisory.
            structuredOutfits = structuredOutfits.map(outfit => (outfit === pair.repaired ? pair.original : outfit))
            restored.push({ label: pair.original.label || null, clean: pair.clean, reason: String(flagged.get(pair.repaired) || '').slice(0, 200) })
          } else if (noted.has(pair.repaired)) {
            // Debatable or uncertain: the repair ships, with the critic's observation attached.
            const message = String(noted.get(pair.repaired) || '').slice(0, 200)
            structuredOutfits = structuredOutfits.map(outfit => (outfit === pair.repaired
              ? { ...outfit, systemFlags: [...(Array.isArray(outfit.systemFlags) ? outfit.systemFlags : []), { type: 'Visual note', message }] }
              : outfit))
            annotated.push({ label: pair.repaired.label || null, reason: message })
          }
        }
        if (repairedReview?.usage && composerUsage) {
          composerUsage = {
            ...composerUsage,
            inputTokens: (composerUsage.inputTokens || 0) + (repairedReview.usage.inputTokens || 0),
            outputTokens: (composerUsage.outputTokens || 0) + (repairedReview.usage.outputTokens || 0),
            totalTokens: (composerUsage.totalTokens || 0) + (repairedReview.usage.totalTokens || 0),
          }
        }
        layerRepairDebug.repairedCardReview = {
          reviewedCount: repairedReview?.reviewedCount || repairedPairsForReview.length,
          restoredCount: restored.length,
          restored,
          annotatedCount: annotated.length,
          annotated,
        }
      } catch (err) {
        console.warn('Repaired-card clash critic fallback:', err.message)
        layerRepairDebug.repairedCardReview = { error: err.message }
      }
    }

    // ACCOUNTING DESCRIBES WHAT SHIPS (owner ruling 2026-09-13). Accepted counts are fixed when the
    // repair model's answer passes validation; delivered counts are recomputed here, after the
    // repaired-card critic may have restored some originals. thread_1789346300319 accepted three,
    // restored one, and still reported repairedCount/repairedCleanCount 3/3.
    if (layerRepairDebug.attempted && !layerRepairDebug.error) {
      const restoredEntries = layerRepairDebug.repairedCardReview?.restored || []
      layerRepairDebug.acceptedRepairCount = layerRepairDebug.repairedCount || 0
      layerRepairDebug.acceptedCleanCount = layerRepairDebug.repairedCleanCount || 0
      layerRepairDebug.deliveredRepairCount = Math.max(0, layerRepairDebug.acceptedRepairCount - restoredEntries.length)
      layerRepairDebug.deliveredCleanCount = Math.max(0,
        layerRepairDebug.acceptedCleanCount - restoredEntries.filter(entry => entry.clean).length)
    }

    // SET-LEVEL DISCLOSURE (owner ruling 2026-09-13, Tier 2(a)). Cards that still lack a layer keep
    // their advisory and are NOT mutated, dropped, or completed by the engine — but the set says so
    // once, plainly, instead of leaving the reader to notice four identical per-card notes.
    // READY OUTFITS ONLY. A diagnostic card is shown on purpose during development, but it is not a
    // ready outfit: it counts toward neither side of this sentence. thread_1789346300319 said "1 of
    // these 5 outfits" with four ready cards and one broken diagnostic.
    const readyOutfitsForDisclosure = structuredOutfits.filter(outfit => !outfit?.broken && !outfit?.diagnosticOnly)
    // 2026-09-16 (owner review, thread_1789546295700): "The bases suit the high" used to be a flat
    // clause appended for every deficient card regardless of what the SAME evaluator run already
    // said about that card's own warm end — a card independently carrying THERMAL_OVERSHOOT (its
    // base already runs too warm at the high) got told, in the same breath, that its base "suits
    // the high." Both statements come from evidence already computed once per card
    // (outfitEnvironmentFindings' own endpointFit.warm); this reads that evidence per card instead
    // of asserting one blanket claim for the whole set.
    const deficientAfter = readyOutfitsForDisclosure
      .map(outfit => ({ outfit, findings: outfitEnvironmentFindings(outfit) }))
      .filter(({ findings }) => missesCoolLayer(findings.advisory) || missesCoolLayer(findings.hard))
      .map(({ outfit, findings }) => ({
        outfit,
        // A card whose own warm-end verdict already says its base overshoots cannot also be told
        // its base "suits the high" — that card fails to span the day's range at either end, not
        // merely at the low.
        oversteps: findings.endpointFit?.warm?.verdict === 'substantial_excess',
      }))
    const spansHighOnly = deficientAfter.filter(entry => !entry.oversteps)
    const overstepsHigh = deficientAfter.filter(entry => entry.oversteps)
    const labelList = entries => entries.map(entry => `"${entry.outfit.label}"`).join(', ')
    const coolLayerSetDisclosure = deficientAfter.length
      ? [
          `${deficientAfter.length} of the ${readyOutfitsForDisclosure.length} ready outfit${readyOutfitsForDisclosure.length === 1 ? '' : 's'} ${deficientAfter.length === 1 ? 'has' : 'have'} nothing removable to put on for the cool end of the day (${labelList(deficientAfter)}).`,
          spansHighOnly.length
            ? `${spansHighOnly.length === deficientAfter.length ? 'The bases suit' : `${labelList(spansHighOnly)}: the base suits`} the high; a layer from the wardrobe would cover the low.`
            : '',
          overstepsHigh.length
            ? `${labelList(overstepsHigh)} already run${overstepsHigh.length === 1 ? 's' : ''} too warm at the high and still lack${overstepsHigh.length === 1 ? 's' : ''} a layer for the low — ${overstepsHigh.length === 1 ? 'it fails' : 'they fail'} to span the day's range, not just its cool end.`
            : '',
        ].filter(Boolean).join(' ')
      : ''
    layerRepairDebug.deficientAfterCount = deficientAfter.length

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
    // The exposure the evaluator actually used, in RUN debug rather than stamped on every card: no
    // card renderer consumes it, and a per-card copy would be a second persisted representation of
    // something the run already knows. This is what lets a capture show whether `sedentary` or
    // `hiking` reached evaluation.
    visualDebugLog.resolvedExposure = {
      activity: activity || null,
      weatherSource: weatherProfile?.weatherSource || weatherProfile?.source || null,
      highF: weatherProfile?.highF ?? null,
      lowF: weatherProfile?.lowF ?? null,
      coldPresenceRequirement: weatherProfile?.coldPresenceRequirement?.state || null,
    }
    visualDebugLog.layerRepair = layerRepairDebug
    visualDebugLog.coolLayerSetDisclosure = coolLayerSetDisclosure
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
    // THE SET-LEVEL DISCLOSURE, IN THE PROSE (owner ruling 2026-09-13). It existed in `debug` and on
    // the response object, and nothing rendered it: no UI reads the field, and the stored assistant
    // message never contained it, so on the direct Whole Wardrobe path the Tier 2(a) ruling —
    // disclose rather than mutate — reached nobody. Appending it here makes it stored, visible and
    // quotable without a new UI component. The nested /ask path does not read `feedback`; it gets
    // the same sentence through the tool result instead, so this cannot double up.
    if (coolLayerSetDisclosure) feedback = feedback + '\n\n' + coolLayerSetDisclosure

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
      // Tier 2(a): said once at the SET level. Cards keep their own advisory and are never mutated,
      // dropped, or completed by the engine — this only stops the set from shipping a known
      // deficiency silently. Empty string when nothing is deficient.
      coolLayerSetDisclosure,
      provider: resolveAiTarget(providerOverride).provider,
      model: resolveAiTarget(providerOverride).model,
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
        // Debug-only supply boundary, per piece: which garments automatic-use suppression removed and why.
        suppressedPieces: suppressedPieces.map(piece => ({ id: Number(piece.id), reasons: piece.reasons || [] })),
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
      // Log-only sleeve-geometry evidence per composer card (never a finding, never model-facing).
      // Computed directly from the construction evaluator: this route's own card validation does not run the layering stages.
      sleeveGeometryShadow: normalizedModelOutfits.map(outfit => {
        // Cards carry trimmed piece records here; rehydrate the full garment facts by id, keeping each card's own role.
        const rosterById = new Map((allowedPieces || []).map(piece => [Number(piece.id), piece]))
        const pieces = (outfit.pieces || []).map(piece => ({ ...(rosterById.get(Number(piece?.id)) || piece), role: piece?.role }))
        return { label: outfit.label || '', pieceIds: outfit.pieceIds || [], findings: evaluateLayerPairConstruction(pieces, { roleAware: true }).findings }
      }).filter(entry => entry.findings.length),
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
        composerErrorIsTimeout,
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
    let plannerCalled = false

    if (!boardPlans.length && conceptsText) {
      boardPlans = structuredOutfitsFromGeneratedText(conceptsText, selectedPiece, candidatePieces)
    }

    if (!boardPlans.length) {
      plannerCalled = true
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
        messages: [{ role: 'user', content }],
        providerOverride: stylistProviderOverride
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
    // 2026-08-31 review correction: this previously reported a resolved provider unconditionally,
    // even on the common path where boardPlans came from structuredOutfits/conceptsText and the
    // planner's askStylist call never ran at all — attributing a provider that was never called.
    // createOutfitBoardImage (the board renderer) is a local sharp/SVG composite, not a model call
    // of any kind — there is no "renderer provider" to report here, only whether the text planner
    // ran and, if so, what it resolved to.
    res.json({ boards, provider: plannerCalled ? resolveAiTarget(stylistProviderOverride).provider : null, mode: 'generate_outfit_boards' })
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
      ],
      providerOverride: stylistProviderOverride
    })

    let directions = []
    try {
      const parsed = parseModelJson(raw, { context: 'editorial new pieces', maxTokens: 1200 })
      directions = Array.isArray(parsed?.directions) ? parsed.directions : []
    } catch (err) {
      // A truncated/unparseable response should fall through to the deterministic
      // completions below, same as a genuinely empty model result — not surface a raw
      // parse error to the user, who can't do anything about a token-cap cutoff.
      console.error('Editorial directions preview: unusable model response, using deterministic fallback:', err.message)
    }
    // architecture-ownership-consolidation-spec.md 7.8: a fallback may reduce ambition, but
    // must surface itself to the user rather than presenting a template result as if it were
    // the model's live judgment.
    const usedFallback = !directions.length
    if (usedFallback) {
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
      provider: resolveAiTarget(stylistProviderOverride).provider,
      model: resolveAiTarget(stylistProviderOverride).model,
      mode: 'editorial_directions_preview',
      usedFallback
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
      stylingInstructions: direction.stylingInstructions || direction.styling_instructions || '',
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
      ],
      providerOverride: stylistProviderOverride
    })

    const resolvedTarget = resolveAiTarget(stylistProviderOverride)
    res.json({ feedback: answer, provider: resolvedTarget.provider, model: resolvedTarget.model, mode: 'compare_outfits' })
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

// docs/trip-composition-parity-spec.md — same shape as capsulePlanCompositionSchema, with
// cold_layer_decision added: a trip card names a shared packed layer separately from its own
// piece_ids (owner ruling, thread_1788508369689 arc) rather than being forced to visually enumerate
// it, via a mandatory enum decision rather than an optional array
// (docs/trip-cold-layer-decision-contract-and-repair-spec.md). No palette/category-shape fields — a
// trip roster has no palette contract, unlike a capsule.
export function tripPlanCompositionSchema(targetOutfits = 1) {
  const exactCount = Math.max(1, Number(targetOutfits) || 1)
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      outfits: {
        type: 'array',
        // thread_1789585467294 (owner ruling 2026-09-16): the schema previously required EXACTLY
        // targetOutfits cards, so a specific outfit the composer could not credibly fill still had to
        // produce a card -- there was no honest way to decline. minItems relaxed to 1 (the total trip
        // must still produce something; a full-trip zero stays a genuine composition failure, handled
        // by the atomic branch's existing error path) so a specific outfit can be omitted here and
        // named instead in slot_gaps, below.
        minItems: 1,
        maxItems: exactCount,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            slot_id: { type: 'string' },
            piece_ids: { type: 'array', items: { type: 'integer' } },
            title: { type: 'string' },
            reason: { type: 'string' },
            styling_instructions: { type: 'string', description: "Garment-relationship mechanics not obvious from the pieces alone (layering order, where a belt/tie lands, tuck/drape between two named garments), or empty string if not applicable." },
            cold_layer_decision: coldLayerDecisionSchemaProperty()
          },
          required: ['slot_id', 'piece_ids', 'title', 'reason', 'styling_instructions', 'cold_layer_decision']
        }
      },
      // thread_1789585467294 (owner ruling 2026-09-16): a genuine slot-level DECLINE, distinct from
      // any card you do submit. Requiring every submitted card to also grade and explain its own
      // suitability risked producing exactly the kind of confident post-hoc self-justification that
      // caused the original incident (see the day-wear explanation experiment) -- this is not that.
      // Suitability stays entirely your judgment; structural_capacity (on the slot payload) stays a
      // factual diagnostic only, never a suitability verdict. Every card you DO submit in `outfits`
      // stands on its own reason text, with no separate confidence rating attached.
      slot_gaps: {
        type: 'array',
        maxItems: exactCount,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            slot_id: { type: 'string' },
            gap_reason: { type: 'string', description: "The concrete reason you could not compose a credible outfit for this specific outfit within this slot from its allowed_piece_ids -- e.g. no genuinely hot-weather-suited top or bottom was available for a hike. Name the missing garment kind or capability if you can identify it. This is a decline: do not use it to hedge or caveat a card you ARE submitting in `outfits` -- a submitted card carries no separate rating." }
          },
          required: ['slot_id', 'gap_reason']
        },
        description: "One entry per specific outfit within a slot you chose not to fill because the allowed roster had no credible combination for it. Omit entirely, or leave empty, when every requested outfit was composed. Do not manufacture a placeholder outfit to avoid using this."
      }
    },
    required: ['outfits', 'slot_gaps']
  }
}

// Spec §3 stage 2 — the model picks the roster from a bench the engine gated.
// Default ON: model picks the roster from the gated 70-piece bench. Can be set
// to 'false' via environment variable if deterministic roster pick is needed.
export function modelCapsuleRosterEnabled() {
  return String(process.env.WARDROBE_MODEL_CAPSULE_ROSTER || 'true').toLowerCase() !== 'false'
}

export function modelTripRosterEnabled() {
  return String(process.env.WARDROBE_MODEL_TRIP_ROSTER || 'true').toLowerCase() !== 'false'
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
    providerOverride: toolContext?.providerOverride || null,
    // This formula (previously a private 300 + budget*65, itself a bump from an
    // even tighter 1,260-token ceiling) hit its cap exactly on both the initial
    // attempt and the repair in the same live turn (thread_1787725557304),
    // falling back to the deterministic roster after two wasted paid calls. The
    // garment IDs themselves are cheap; the real cost is the schema's free-text
    // reasoning (category_shape_reason, category_departures[].reason,
    // repair_changes[].reason), which scales with how many categories depart
    // from the starting shape, not with budget count — hence a higher base
    // offset here than structuredResponseMaxTokens' outfit-generation default.
    maxTokens: structuredResponseMaxTokens(budget, { tokensPerItem: 100, base: 1500, floor: 1500, ceiling: 5500 })
  })
  if (toolContext) recordToolLoopUsage(toolContext, usage)
  return value || {}
}

// Trip packing roster (docs/README.md: trip roster architecture). Same bench -> model -> contract-
// validate -> repair shape as the capsule roster immediately above, deliberately NOT the same
// prompt or schema: no fixed size (packing efficiency is the model's own per-turn judgment, not a
// budget), no palette contract, no category starting shape. What replaces those is coverage: every
// trip use-case slot must come out of this roster wearable, and a piece earning a suitcase place by
// working across MULTIPLE use cases is the point, not an accident.
export function tripRosterSelectionSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      roster_piece_ids: { type: 'array', items: { type: 'integer' }, minItems: 1, uniqueItems: true },
      packing_reasoning: { type: 'string' },
      piece_jobs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { piece_id: { type: 'integer' }, job: { type: 'string' } },
          required: ['piece_id', 'job']
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
      }
    },
    required: ['roster_piece_ids', 'packing_reasoning', 'piece_jobs', 'repair_changes']
  }
}

// Used verbatim for both the initial call and the bounded repair, same reasoning as
// capsuleRosterSelectionSystemPrompt.
export function tripRosterSelectionSystemPrompt() {
  return `You are choosing what to pack for a trip. The conversational stylist has already interpreted the request and fixed the trip's use-case slots (Sightseeing Days, Museum Days, Nature Walks, and so on); a deterministic engine has already gated the candidates you are given to what is structurally eligible for at least one of those use cases.

Pick the pieces that should go in the suitcase, using their IDs. Choose ONLY from the supplied candidates. There is no fixed count: packing efficiency is your own judgment call for THIS trip, not a formula. A roster that is too small leaves a use case unwearable; a roster that is too large defeats the point of packing light. Both are real failures, weighed against each other, not just against a target number.

SUITCASE SCALE & PACKING EFFICIENCY:
A suitcase is a compact, curated travel capsule, not a whole wardrobe. Aim for a focused suitcase that covers the trip's use cases with combinatorial headroom while packing light. Every piece in the suitcase should earn its luggage space through high utility or versatility across the planned use cases.

Cover every stated use case. A roster that leaves one use case without a complete, gate-valid outfit is a failed roster — the engine will reject it and you will get one chance to repair it. Make sure each use case can form complete outfits, with footwear that suits it.

Each use case below states how many distinct outfits it needs — that number is not a suggestion for how many pieces to pack, it is how many genuinely different representative looks the engine will ask you to build from this roster later. "Cover the use case" means more than making it wearable once: it means provisioning enough combinatorial room — enough distinct tops, bottoms, or dresses, not just enough outerwear or shoes — that the stylist can build that many outfits from your roster without repeating the same core piece-for-piece. A roster where one use case's need for 3 distinct outfits can only actually produce 1 before every remaining option is a piece-for-piece repeat has not covered that use case, even though every individual outfit in isolation would pass its gates.

REUSE ACROSS USE CASES IS A STRENGTH, NOT AN AUTOMATIC WIN. This is a suitcase, not a capsule wardrobe: a top or a layer that is genuinely well-suited to both sightseeing and a nature walk earns its place twice over. But reuse only counts when the shared piece actually suits each use case on its own merits, not merely because it is eligible for it — a piece that reads as elevated city wear does not become a good hike just by also being packed for dinner. Never prefer a cross-use-case piece over a narrower, purpose-suited candidate for a specific use case; each use case still needs its own strongest fit first. Judge each candidate by how well it serves every use case it is meant to cover, not by how many it can technically be worn for.

CROSS-REGISTER VERSATILITY & SUITCASE EFFICIENCY:
Versatile pieces that transition naturally between daytime exploration and evening dining are valuable for travel. Select footwear that comfortably covers the itinerary's walking and dining needs without packing redundant pairs or separate entire wardrobes for each use case.

BOTTOMS VARIETY & ACTIVITY SEPARATION:
A multi-day suitcase spanning varied activities benefits from distinct bottoms suited to different registers and wear contexts. Where activities contrast significantly (e.g. active outdoor trails versus tailored evening dining), provide practical separation rather than relying on a single piece across conflicting physical demands.

TOPS VARIETY & FUNCTIONAL COVERAGE: an active or outdoor use case (a hike, a trail, sustained outdoor exertion) needs a top that is actually suited to it — a genuinely functional, casual/active top (a plain or lightweight tee, a tank, a breathable knit), not merely a bottom and shoes with no matching top at all, and not a delicate, dressy, or elevated top pressed into service because it happens to share the slot's occasion tag. A roster with several bottoms and shoes but no top that can credibly cover an active slot has not covered that slot, whatever its individual pieces are eligible for — weigh top coverage exactly as seriously as bottoms and footwear coverage, not as an afterthought once those are filled.

INDEPENDENT WEARABILITY:
Default to independently wearable garments. A piece that always needs something else under it (\`needs_base: yes\`) costs two packing places to produce one look. Select a piece that needs a base only if you deliberately pack a compatible underlayer for it; otherwise prefer standalone tops. When you do take a piece that needs a base, its base must be a genuine visual and physical match, not merely present: check opacity, fit, neckline, strap or sleeve shape, and whether it sits right under that garment.

OCCASION REALISM & PRACTICAL UTILITY: FOOTWEAR THAT SUITS EACH JOB:
When a trip spans distinct activities, pack shoes appropriate for each register without manufacturing duplicates: durable walking shoes or sneakers for daytime exploration or hikes; polished boots, loafers, or elevated flats for evening dining. For outdoor walks, coastal trails, or hikes, choose practical, durable garments and supportive walking shoes or sneakers. Avoid delicate or high-maintenance pieces for active outdoor slots when practical alternatives exist in the candidate bench. A shoe earning a place by covering a genuinely distinct job is not the same as packing every pair that happens to be eligible — weigh each additional pair against whether its job is truly distinct from a pair already packed, and against whether that suitcase space would serve the trip better as a top or a layer instead.

LAYERING / OUTERWEAR THAT SUITS THE TRIP:
Consider the trip as a whole, including repeated outdoor time, transitions between indoor and outdoor settings, and variation across the stay. Compare the supplied construction, warmth, insulation, weather-protection, and removability facts for available layers. Choose a compact layering strategy that is practical across the stated activities and conditions. Ensure the outerwear you pack covers the real outdoor activities on the trip. Never rely solely on dressy, elevated, or high-maintenance outerwear when the trip includes trail walking, nature hikes, or active outdoor exploration — pack a practical, casual layer suited to the activity. A button-up, popover, or collared woven blouse is a base top, not a layering garment or a substitute for outerwear — do not count one toward the trip's layering coverage, and do not double the same top as both a base look and its own layer. Avoid packing rainwear or heavy storm layers unless wet weather or rain is actually indicated in the trip context.

A DISTINCT JOB PER PIECE. Every piece you take should answer "what does this cover that nothing else here does, across the whole trip?" If your own job line for a piece could be written about another piece you already chose, one of them is probably not earning its suitcase space.

For every selected ID, give exactly one piece_jobs entry naming the job it does on this trip — which use case(s) it serves and why it earned a place. Include no unselected IDs and do not repeat an ID.

In packing_reasoning, briefly explain the overall shape of what you packed and why — how many pieces, why that count is right for this trip, and anything you deliberately left out despite it being eligible.

On an initial selection, return an empty repair_changes array. On a repair, record every swap with the removed ID, added ID, and the structural problem that swap fixes. If you cannot fix a stated failure from the candidates, say why in packing_reasoning; never return an unchanged rejected roster without explaining why.

Use the supplied structured garment truth and photographs together: the record is authoritative for fabric, formality and rules; the photograph is how you judge how a piece actually reads and whether it is worth the suitcase space.

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

// Mirrors capsuleRosterRepairText — same "fix exactly these problems, keep the rest" contract,
// without the capsule-specific judgment list.
export function tripRosterRepairText({ failures = [], previousRosterIds = [] } = {}) {
  return `YOUR PREVIOUS SELECTION WAS REJECTED. Previous IDs: [${(previousRosterIds || []).join(', ')}]
Fix exactly these problems, keeping the rest of your selection:
${(failures || []).map(entry => `- ${entry.message}`).join('\n')}

The replacements you bring in are held to the same standard as the original picks: cover the use case(s) that need it, prefer a piece that also works for other use cases already in the roster, and give it a distinct job. Whatever you drop to make room should be the piece doing the least work across the trip, not simply the easiest one to remove.`
}

// thread_1789598100140 (owner ruling 2026-09-16): the roster-selection catalog previously used
// buildPieceText's dense format, including unverified tagger prose (best_use/style_risk/AI auto-use
// trust/best outfit role) that docs/garment-evidence-parity-2026-09-15.md's shared-evidence
// architecture already excludes from every other model path -- trip roster selection was simply
// never migrated. Now uses the same sparse fact-line format /ask's single_outfit whole-wardrobe
// catalog uses (stylistCatalogLine), which carries no tagger prose at all. Two additions, same
// reasoning as tripPlanTruthCatalog/TRIP_GARMENT_FACT_CONVENTIONS below: occasions are stated per
// piece (the sparse format's own stated rationale for omitting them -- "every row already survived
// this request's occasion gate" -- does not hold for a trip roster spanning multiple slot
// occasions), and each piece states which of the trip's own use cases it is gate-eligible for
// (slots:), a recorded fact replacing the reuse-ranked bench cap that used to decide, in code,
// which pieces the model was even allowed to see (see buildTripBench's header comment).
const TRIP_ROSTER_CATALOG_CONVENTIONS = `${SPARSE_CATALOG_CONVENTIONS} Unlike other paths' fact line, occasions are stated per piece here (a trip roster spans multiple slot occasions, not one already-filtered request occasion), and each row also states \`slots\`: the trip's own use-case label(s) this piece is gate-eligible for, structurally computed, not a suitability verdict for any of them.`

function tripRosterCandidateLine(piece = {}, slotLabelsById = null) {
  const labels = slotLabelsById?.get?.(Number(piece?.id)) || []
  const slotsSuffix = ` | slots: ${labels.length ? labels.join(', ') : 'none'}`
  return `${stylistCatalogLine(piece)}${tripPieceOccasionsFact(piece)}${slotsSuffix}`
}

export function tripRosterSelectionUserText({
  bench = [], slots = [], dateRange = {}, attempt = 1, failures = [], previousRosterIds = [], ownerRules = [], acceptedLessons = '', slotLabelsById = null
} = {}) {
  const truthCatalog = bench.map(piece => tripRosterCandidateLine(piece, slotLabelsById))
  const destination = slots[0]?.location || slots[0]?.stylingContext?.location || ''
  const startDate = dateRange?.start || slots[0]?.date || slots[0]?.stylingContext?.date || ''
  const endDate = dateRange?.end || ''
  const dateStr = (() => {
    const startStr = startDate ? String(startDate).slice(0, 10) : ''
    const endStr = endDate ? String(endDate).slice(0, 10) : ''
    if (!startStr) return ''
    if (endStr && endStr !== startStr) {
      const d1 = new Date(startStr)
      const d2 = new Date(endStr)
      const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)) + 1
      const durationStr = Number.isFinite(diffDays) && diffDays > 0
        ? ` (${diffDays} day${diffDays === 1 ? '' : 's'}${diffDays === 7 ? ' / 1 week' : ''})`
        : ''
      return `Dates: ${startStr} to ${endStr}${durationStr}`
    }
    return `Date: ${startStr}`
  })()
  const contextHeader = [destination ? `Destination: ${destination}` : '', dateStr].filter(Boolean).join(' | ')
  const slotLines = slots.map(slot => {
    const distinctOutfits = Math.max(1, Number(slot.targetOutfits) || 1)
    const weatherProfile = slot.stylingContext?.weatherProfile || slot.weatherProfile || {}
    const tempText = Number.isFinite(Number(weatherProfile.highF))
      ? `${Math.round(Number(weatherProfile.highF))}°F high${Number.isFinite(Number(weatherProfile.lowF)) ? ` / ${Math.round(Number(weatherProfile.lowF))}°F low` : ''}`
      : ''
    const weatherText = slot.weatherLabel || slot.slotWeather || tempText
    const weatherPart = weatherText ? `, ${weatherText}` : ''
    return `- ${slot.label} (${slot.occasion || 'general'}${slot.activity && slot.activity !== 'none' ? `, ${slot.activity}` : ''}${slot.environment ? `, ${slot.environment}` : ''}${weatherPart}) — needs ${distinctOutfits} distinct outfit${distinctOutfits === 1 ? '' : 's'}: ${slot.bestFor || slot.label}`
  })
  const repairBlock = attempt > 1
    ? `\n\n${tripRosterRepairText({ failures, previousRosterIds })}`
    : ''
  const ownerRulesBlock = Array.isArray(ownerRules) && ownerRules.length
    ? `\n\nOWNER RULES — hard requirements, not suggestions. Do not construct exceptions or conditional workarounds. If a rule makes a genuinely usable roster impossible, say so in your packing_reasoning rather than bending the rule. Apply to every piece you select: ${ownerRules.map(rule => `"${rule}"`).join('; ')}`
    : ''
  const acceptedLessonsBlock = String(acceptedLessons || '').trim()
    ? `\n\nOWNER-ACCEPTED APPLICABLE LESSONS — bounded prompt guidance for the candidates and use cases below; respect each stated boundary:\n${acceptedLessons}`
    : ''
  const headerBlock = contextHeader ? `TRIP CONTEXT: ${contextHeader}\n\n` : ''
  // The sparse fact line carries no owner rules/rejections (that's a separate, source-labelled
  // channel — docs/garment-evidence-parity-2026-09-15.md) — buildPieceText used to fold "RULES
  // (authoritative)"/"REJECTED" inline, so switching formats without this would have silently
  // dropped the owner's authority over roster selection specifically. garmentNotesBlock is the same
  // function trip composition already uses for this.
  const notesBlock = garmentNotesBlock(bench)
  return `${headerBlock}USE CASES THIS TRIP MUST COVER:
${slotLines.join('\n')}${ownerRulesBlock}${acceptedLessonsBlock}

${TRIP_ROSTER_CATALOG_CONVENTIONS}

CANDIDATES:
${truthCatalog.join('\n')}${repairBlock}${notesBlock ? `\n\n${notesBlock}` : ''}`
}

// Same cache-prefix invariant as capsuleRosterSelectionContent: everything through the last
// cache_control breakpoint is identical on attempt 1 and attempt 2, so the repair reads the cache
// the initial call wrote instead of re-paying for the whole catalog.
//
// thread_1789598100140 (owner ruling 2026-09-16): text-only, no images. Roster selection previously
// attached a base64 photo thumbnail per bench candidate, which is what made a large bench
// prohibitively expensive and forced the reuse-ranked 60-piece cap that starved single-use-case
// pieces (see buildTripBench). The candidate catalog is now the same sparse text format /ask's
// single_outfit whole-wardrobe catalog uses for its own full candidate list, at a fraction of the
// token cost of even the old 60-image bench. composeTripPlanOnce still attaches real photos, for the
// much smaller chosen roster, when actual outfits are being judged for drape/volume/layering.
export function tripRosterSelectionContent({
  bench = [], slots = [], dateRange = {}, ownerRules = [], acceptedLessons = '', attempt = 1, failures = [], previousRosterIds = [], slotLabelsById = null
} = {}) {
  const content = [{
    type: 'text',
    text: tripRosterSelectionUserText({
      bench, slots, dateRange, ownerRules, acceptedLessons, attempt: 1, failures: [], previousRosterIds: [], slotLabelsById
    }),
    cache_control: { type: 'ephemeral' }
  }]
  if (attempt > 1) {
    content.push({ type: 'text', text: tripRosterRepairText({ failures, previousRosterIds }) })
  }
  return content
}

// The production trip-roster chooser. Exists precisely because it did not: buildPlanSlotWorkbench
// and selectTripRosterViaModel (styling-engine/outfitSetPlanner.js) already had every piece of the
// contract this function fulfils, and test/tripPackingRoster.test.js already exercised that
// contract against a mock chooseRoster — but nothing ever called the real model with it in
// production. thread_1788484052964 and thread_1788488744055 are both real live runs that resolved
// plan_kind:'trip' (once the boundary fix landed) yet still produced ordinary coordinated-plan
// output, because this function did not exist to be wired in.
export async function chooseTripRosterWithProvider({ bench, slots, dateRange = {}, attempt, failures, previousRosterIds, slotLabelsById }, toolContext) {
  const acceptedLessons = getAcceptedFeedbackSynthesisMemory(8, {
    pieceIds: bench.map(piece => piece.id),
    contexts: slots.map(slot => projectStylingApplicabilityContext(slot?.stylingContext || {}, {
      occasion: slot?.occasion || '',
      activity: slot?.activity || '',
      season: slot?.requestedSeason || slot?.transitSeason || slot?.season || '',
      currentDate: slot?.stylingContext?.date || slot?.date || null,
      weatherText: [slot?.weather, slot?.environment, slot?.bestFor].filter(Boolean).join(' '),
      requestText: [slot?.label, slot?.occasion, slot?.activity, slot?.bestFor].filter(Boolean).join(' '),
    })),
  })
  const content = tripRosterSelectionContent({
    bench, slots, dateRange, ownerRules: toolContext?.tripRosterOwnerRules || [], acceptedLessons,
    attempt, failures, previousRosterIds, slotLabelsById
  })

  const { value, usage } = await askStylistStructuredWithUsage({
    system: tripRosterSelectionSystemPrompt(),
    messages: [{ role: 'user', content }],
    schema: tripRosterSelectionSchema(),
    name: 'trip_roster_selection',
    description: 'Choose what to pack for this trip from the supplied candidates.',
    providerOverride: toolContext?.providerOverride || null,
    // No budget to scale against (the whole point is the model decides the count), so size against
    // the candidate bench itself — same reasoning as the capsule roster's per-item scaling, applied
    // to the pool the model is choosing from rather than a fixed target.
    maxTokens: structuredResponseMaxTokens(bench.length, { tokensPerItem: 90, base: 1500, floor: 1500, ceiling: 6000 })
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

// docs/trip-composition-parity-spec.md — trip's dedicated composition-only sibling of
// capsulePlanCompositionSystemPrompt. Deliberately NOT capsule's rotation objective: a trip roster
// has no palette contract and no "every piece must prove its job" framing (a trip card is a
// representative CORE outfit from a packed suitcase, not a demonstration that every roster piece
// earned its place) — see the owner ruling recorded on outfitSetPlanner.js's assignedLayerIds. What
// IS shared verbatim is the style constitution, and the mechanical contract (allowed_piece_ids
// only, exact target_outfits count, read formality/occasions from the catalog rather than trusting
// allowed_piece_ids alone) — those are true of any fixed-roster composition, not capsule-specific.
export function tripPlanCompositionSystemPrompt() {
  return `You are the composition stage of a trip-packing tool. The conversational stylist has already interpreted the request, chosen the trip's use-case slots, and the packing roster is already fixed.

Return the complete representative rotation for this trip in one structured response. Use only each slot's allowed_piece_ids and submit exactly its target_outfits count. The schema requires the exact total; never return an empty or partial outfits array. Follow every submission_requirement literally. CRITICAL CROSS-SLOT DEDUPLICATION: Submitting the identical complete set of piece_ids in two looks — even across different slots (e.g. a city museum look and a nature walk look) — is rejected by the engine and creates a coverage gap. Every look must be distinct in its full piece set; vary at least one garment (such as the top, bottom, outer layer, or footwear). Reuse across different looks is the foundation of a packed suitcase (a top or layer that earns its place across multiple use cases is a strength, not a compromise), but each outfit card must represent a distinct wearable combination. (Note: in enforced capsule mode, core combinations of top+bottom or dress must also be unique across looks; for standard trips, complete outfit uniqueness is enforced.) Do not add accessories. Keep titles and reasons concise so the complete rotation fits comfortably. Prefer combinations whose visual relationship you can judge confidently from the supplied structured garment truth and the attached photographs. Do not rely solely on 'allowed_piece_ids' as proof of occasion fit — read each piece's explicit formality (\`lounge\`, \`everyday\`, \`elevated\`, \`dressy\`) and explicit occasions (\`home\`, \`casual\`, \`smart-casual\`, \`evening\`) in the piece catalog lines. Never assign a piece tagged \`lounge\` or \`home\` to a \`smart-casual\` or \`elevated\` slot when higher-register options exist in that slot's roster. The slot's best_for text is the lived scenario, not decorative copy: a broad occasion tag only says a piece is eligible, and does not override a garment record that says it is weak for the specific lived context. Every requested slot has already passed deterministic capacity checks; choose the strongest valid combinations from its allowed roster. Never reinterpret, rename, split, merge, or add slots.

This is a suitcase you are packing against a real itinerary and its weather and activities: slot quality outranks showcasing the packed roster. Judge each combination on whether it genuinely suits its stated use case and conditions first; only once a slot has its strongest available combination does using more of the packed suitcase become a secondary, tie-breaking preference. An unused packed piece is a better outcome than a worse-fitting outfit chosen just to give that piece a look. Occasion realism and practical utility govern piece choice: suitcase reuse efficiency must never compromise the functional reality of an occasion. If the allowed roster for a specific outfit within a slot does not contain a genuinely credible combination for its use case, DECLINE it: omit that outfit from 'outfits' and add an entry to 'slot_gaps' naming the slot and the concrete reason, rather than submitting a weak combination described as if it were a good one. This is a real option, not a last resort — an honest decline is a correct answer. A card you do submit stands on its own reason text; it does not carry or need a separate confidence rating. OCCASION REALISM & ACTIVITY SEPARATION: Align pieces with their appropriate use-case contexts: wear practical, durable garments and supportive shoes for active outdoor slots, and tailored or elevated pieces for evening dining or cultural visits when distinct options exist in the packed roster. Avoid pairing high-maintenance or delicate layers with active outdoor trails when practical alternatives exist in the suitcase. Every separates outfit needs a top: [bottom, shoes] alone or [bottom, shoes, outerwear] alone is not a complete look and fails validation — never submit an active or casual outfit missing a top or dress, whatever the roster's own balance of tops to bottoms happens to be. Every outfit requires a cold_layer_decision: Outerwear is fully welcomed directly in piece_ids whenever the outfit is meant to be worn with it (mode 'core_is_warm_enough', assigned_layer_piece_id null), or use a heavy-fabric top/dress as the main piece (mode 'core_is_warm_enough'). When an outfit presents an indoor base or core separates, you may pair it with an already packed outerwear layer from the suitcase via mode 'assigned_packed_layer' (naming its ID via assigned_layer_piece_id). When no cold-weather layering requirement applies, mode 'not_required' with assigned_layer_piece_id null is standard, but if a slot indicates cool temperatures or breezy exposure (needs_removable_cool_layer), including an outerwear piece in piece_ids (mode 'core_is_warm_enough') or naming a packed outer layer via mode 'assigned_packed_layer' is fully permitted and encouraged if needed for warmth.

${PHYSICAL_WEARABILITY_REALISM_RULES}

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
    providerOverride: toolContext?.providerOverride || null,
    // A 12-look rotation with IDs, titles, reasons, and styling_instructions is
    // heavier per outfit than the visual composers' shape, against a fixed
    // roster catalog. The old flat 3200 ceiling silently truncated a real
    // 10-look/24-piece capsule (thread_1787717774384) to zero outfits — this is
    // a ceiling, not prepaid usage, so a generous one costs nothing when the
    // model is concise.
    maxTokens: structuredResponseMaxTokens(targetOutfitCount, { tokensPerItem: 550, base: 900, floor: 2200, ceiling: 7500 })
  })
  // This nested composition call is part of the same paid user turn and must
  // appear in the existing usage/cost diagnostics alongside outer tool-loop
  // iterations.
  recordToolLoopUsage(toolContext, usage)
  toolContext.freeformDiagnostics.atomicCapsuleVisualPieces = visuallySeenIds.length
  return Array.isArray(value?.outfits) ? value.outfits : []
}

// docs/trip-composition-parity-spec.md §5/§7 — trip's sibling of composeCapsulePlanOnce. Same
// shape (full truth catalog, unconditional whole-roster images, dedicated schema-enforced call),
// trip's own objective and prompt. Deliberately does NOT reimplement validation: the caller
// (tools.js's plan_outfit_set atomic branch) feeds this function's returned outfits through the
// exact same validateSubmittedPlanOutfits/assembleSubmittedPlanOutfits path a tool-loop-composed
// trip already goes through — this function's only job is composing candidates, never judging them
// valid.
// buildPlanSlotWorkbench's `instructions` string (outfitSetPlanner.js's workbenchInstructions) is
// shared verbatim with the ordinary tool-loop plan_outfit_set path, where its opening sentence --
// "submit ALL slots in ONE submit_plan_outfits call", "Viewing pieces is cheap, VIEW the pieces..."
// (a view_pieces tool call), "resubmit only the failed slots" -- is correct: that path really does
// have submit_plan_outfits and view_pieces as callable tools, and a real chance to resubmit. The
// atomic composer has neither: this call's tools list is empty (it returns its answer as this
// call's own structured response, per tripPlanCompositionSystemPrompt above) and, being one-shot
// (boundedComposition: true), has no resubmission round at all. Left unfiltered, the model reads
// this sentence immediately after the system prompt's correct "return in one structured response"
// line, in the same call -- a live, direct contradiction about how to submit its answer (found by
// reconstructing an exact capture and reading it end to end, not by inspection of the source alone).
// Every piece's photo is already attached unconditionally below regardless (see visuallySeenIds
// below), so the print/layering/sheer visual-judgment guidance stays relevant even without a
// separate viewing action.
const ATOMIC_TRIP_TOOL_LOOP_ONLY_INSTRUCTION = 'Compose the outfits yourself and submit ALL slots in ONE submit_plan_outfits call. Use piece_catalog for garment details and pick only from each slot allowed_piece_ids. Viewing pieces is cheap. VIEW the pieces of any outfit whose visual coherence you are uncertain about — print combinations, statement pieces, layering, anything sheer or revealing, silhouette pairings you haven\'t seen work. Compose directly from the catalog when pieces are solids and the combination is conventional. Do not bulk-browse the whole roster. If validation accepts some outfits and rejects others, resubmit only the failed slots.'
const ATOMIC_TRIP_COMPOSITION_INSTRUCTION = 'Compose the complete rotation yourself and return it as this call\'s own structured response for every slot in one shot — there is no tool call to submit it and no resubmission round, so get it right the first time. Use piece_catalog for garment details and pick only from each slot\'s allowed_piece_ids; every piece\'s photo is already attached below, so judge print combinations, statement pieces, layering, anything sheer or revealing, and any silhouette pairing by sight rather than guessing. Compose directly from the catalog when pieces are solids and the combination is conventional.'

export function atomicTripCompositionInstructions(instructions) {
  return String(instructions || '').replace(ATOMIC_TRIP_TOOL_LOOP_ONLY_INSTRUCTION, ATOMIC_TRIP_COMPOSITION_INSTRUCTION)
}

// thread_1789585467294 (2026-09-16): the shared fact line omits occasion tags on the stated
// rationale that "every row already survived this request's occasion gate" (garmentEvidenceLine.js's
// SPARSE_CATALOG_CONVENTIONS) — true for a single-occasion request, false for a trip roster, which
// is deliberately a multi-occasion capsule serving distinct slots (a daytime walk, a hike, an evening
// dinner) in one call. Trip is the one path where that omission's premise does not hold, so trip's
// catalog line states each piece's recorded occasions explicitly, appended to the otherwise-identical
// shared fact line. This is a structured recorded field, not tagger prose — it is not covered by
// docs/garment-evidence-parity-2026-09-15.md's decision to omit tagger best_use/style_risk from every
// model path (owner ruling 2026-09-16: keep that decision as-is; do not reintroduce tagger prose here).
function tripPieceOccasionsFact(piece = {}) {
  const tags = Array.isArray(piece?.occasions) ? piece.occasions.map(o => String(o || '').trim()).filter(Boolean) : []
  return ` | occasions: ${tags.length ? tags.join(', ') : 'unknown'}`
}

// TRIP TRUTH CATALOG: the shared garment fact line (docs/garment-evidence-parity-2026-09-15.md), identical to every other chat path,
// plus each piece's recorded occasions (see tripPieceOccasionsFact above), with saved-record notes
// (owner rules, rejections) for roster pieces delivered separately by tripPlanPieceNotes.
export function tripPlanTruthCatalog(rosterPieces = []) {
  return rosterPieces.map(piece => `${sharedGarmentEvidenceLine(piece)}${tripPieceOccasionsFact(piece)}`)
}
export function tripPlanPieceNotes(rosterPieces = []) {
  return rosterPieces.map(piece => garmentNotesEntry(piece)).filter(Boolean)
}
// Trip's piece_catalog_conventions text: the shared conventions plus the one addendum trip needs,
// since occasions are stated per piece here unlike every other fact-line consumer.
export const TRIP_GARMENT_FACT_CONVENTIONS = `${GARMENT_FACT_CONVENTIONS} Occasions are stated per piece here (unlike other paths' fact line) because a trip roster spans multiple slot occasions rather than one already-filtered request occasion; a piece's occasions are its recorded tags, not a suitability verdict for any specific slot — read them alongside formality and the slot's own best_for text.`

async function composeTripPlanOnce(workbench, toolContext) {
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
  // The shared garment fact line and saved-record notes — the same evidence Whole Wardrobe and /ask receive.
  const truthCatalog = tripPlanTruthCatalog(rosterPieces)
  const promptPayload = {
    instructions: atomicTripCompositionInstructions(workbench.instructions),
    constraints: workbench.constraints,
    slots: workbench.slots,
    piece_catalog: truthCatalog.length ? truthCatalog : workbench.piece_catalog,
    piece_catalog_conventions: TRIP_GARMENT_FACT_CONVENTIONS,
    piece_notes: tripPlanPieceNotes(rosterPieces)
  }
  const content = [{
    type: 'text',
    text: `Compose this fixed trip packing workbench:\n${JSON.stringify(promptPayload)}\n\nThe following thumbnails are the visual evidence for the same fixed roster. Judge silhouette, volume, texture, and physical layering by sight; stored authoritative rules still win.`,
    cache_control: { type: 'ephemeral' }
  }]
  // Unconditional, whole-roster image attachment — the same policy capsule composition uses, not
  // pieceVisualDetailPolicy's gated selection (that policy governs roster-SELECTION candidate
  // thumbnails, a different call with a different tradeoff; composition already has a fixed,
  // bounded roster, so every piece gets shown).
  const visuallySeenIds = []
  for (const piece of rosterPieces) {
    const photoFile = piece.worn_photo || piece.photo || ''
    if (!photoFile) continue
    const filePath = path.join(userUploadsDir(), photoFile)
    if (!fs.existsSync(filePath)) continue
    try {
      const thumb = await prepareWardrobeThumb(filePath, `trip-plan:${piece.id}:${photoFile}`, { maxPx: 800 })
      content.push({ type: 'text', text: `ID ${piece.id}: ${piece.name}` })
      content.push({
        type: 'image',
        detail: 'auto',
        source: { type: 'base64', media_type: thumb.media_type, data: thumb.data }
      })
      visuallySeenIds.push(Number(piece.id))
    } catch (err) {
      console.error(`Error loading atomic trip thumbnail for piece ${piece.id}:`, err)
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
    system: tripPlanCompositionSystemPrompt(),
    messages: [{ role: 'user', content }],
    schema: tripPlanCompositionSchema(targetOutfitCount),
    name: 'trip_plan_composition',
    description: 'Compose the complete representative trip packing rotation from the fixed roster and slots.',
    providerOverride: toolContext?.providerOverride || null,
    maxTokens: structuredResponseMaxTokens(targetOutfitCount, { tokensPerItem: 550, base: 900, floor: 2200, ceiling: 7500 })
  })
  recordToolLoopUsage(toolContext, usage)
  toolContext.freeformDiagnostics.atomicTripVisualPieces = visuallySeenIds.length
  // thread_1789585467294 (owner ruling 2026-09-16): the relaxed outfits.minItems only stays honest
  // if every requested slot is provably accounted for in the model's own raw response — reject an
  // unknown slot_id, a duplicate decline, a slot both delivered and declined, or a slot silently
  // present in neither array, before this ever reaches domain validation. Thrown here (no repair
  // round exists on this one-shot path) so it surfaces through the same compositionError handling
  // tools.js already applies to any other composition-call failure.
  const partialPlanCheck = validateTripCompositionPartialPlan(
    (workbench.slots || []).map(slot => slot.id),
    value?.outfits,
    value?.slot_gaps
  )
  if (!partialPlanCheck.valid) {
    throw new Error(`Trip composition response violates the partial-plan contract: ${partialPlanCheck.errors.join('; ')}`)
  }
  // thread_1789585467294: stashed on toolContext, not on the returned array, so this function keeps
  // its existing "returns the outfits array" contract (mocks in tests still work unchanged). The
  // atomic branch in tools.js reads this right after calling composeTripPlanOnce and folds each
  // declined outfit's reason into the same coverageGaps list the model-undercount path already uses.
  toolContext.tripCompositionSlotGaps = Array.isArray(value?.slot_gaps) ? value.slot_gaps : []
  return Array.isArray(value?.outfits) ? value.outfits : []
}

// docs/trip-cold-layer-decision-contract-and-repair-spec.md (Part B, ratified). Deliberately
// text-only (no thumbnails) and narrowly scoped to just the repairable cards
// (identifyColdLayerRepairableFailures, outfitSetPlanner.js) — this is a targeted second chance at
// one specific decision, not a second composition pass, and stays cheap relative to the original
// call by design.
export function repairTripColdLayerCardsSchema(count) {
  const exactCount = Math.max(1, Number(count) || 1)
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      cards: {
        type: 'array',
        minItems: exactCount,
        maxItems: exactCount,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            slot_id: { type: 'string' },
            piece_ids: { type: 'array', items: { type: 'integer' }, description: "Return exactly as given unless mode is 'core_is_warm_enough' and the original piece_ids genuinely is not warm enough on its own -- only then may this be revised to a warmer core." },
            title: { type: 'string' },
            reason: { type: 'string' },
            styling_instructions: { type: 'string' },
            cold_layer_decision: coldLayerDecisionSchemaProperty()
          },
          required: ['slot_id', 'cold_layer_decision']
        }
      }
    },
    required: ['cards']
  }
}

export function repairTripColdLayerCardsSystemPrompt() {
  return `You are fixing exactly one thing on a small set of trip outfit cards: each was rejected only because its cold_layer_decision did not hold up — either it was missing/invalid, or it claimed the core was already warm enough when it was not.

For EACH card listed, answer cold_layer_decision correctly: mode 'core_is_warm_enough' only if piece_ids genuinely contains a qualifying layer or heavy-fabric main on its own, or mode 'assigned_packed_layer' with assigned_layer_piece_id set to one of that card's own listed candidate packed layers.

Do NOT change piece_ids, title, reason, or styling_instructions for any card unless you are choosing mode 'core_is_warm_enough' and the original piece_ids genuinely is not warm enough on its own — in that one case only, you may revise piece_ids to a genuinely warmer core. Otherwise return piece_ids exactly as given. This is a targeted fix, not a chance to restyle the outfit.`
}

async function repairTripColdLayerCards({ cards } = {}, toolContext) {
  const list = Array.isArray(cards) ? cards : []
  if (!list.length) return []
  const content = [{
    type: 'text',
    text: `Fix the cold_layer_decision for exactly these ${list.length} card(s):\n${JSON.stringify(list)}`
  }]
  const { value, usage } = await askStylistStructuredWithUsage({
    system: repairTripColdLayerCardsSystemPrompt(),
    messages: [{ role: 'user', content }],
    schema: repairTripColdLayerCardsSchema(list.length),
    name: 'trip_cold_layer_repair',
    description: 'Correct the cold-layer decision for a small set of trip outfit cards that failed only for that reason.',
    providerOverride: toolContext?.providerOverride || null,
    maxTokens: structuredResponseMaxTokens(list.length, { tokensPerItem: 200, base: 300, floor: 500, ceiling: 2000 })
  })
  recordToolLoopUsage(toolContext, usage)
  return Array.isArray(value?.cards) ? value.cards : []
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
      maxTokens: 400,
      providerOverride: stylistProviderOverride
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
    // Same owner/scope as extractedWeather immediately above (this turn's question, plus recent
    // thread context so a date stated an earlier turn still survives into a later plan_outfit_set
    // call) — a stated trip date is factual request state, not something re-derived per tool call.
    // See extractStatedTripDateRange's own header comment (thread_1788499704803) for why this
    // exists: the deterministic override lives at the plan_outfit_set tool boundary in tools.js,
    // this is only the one extraction this turn computes it from.
    const statedTripDateRange = extractStatedTripDateRange([
      req.body.question || '',
      req.body.threadContext || '',
      req.body.generatedContext || ''
    ].join('\n'), { currentDate: req.body.currentDate ? new Date(req.body.currentDate) : new Date() })
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
      statedTripDateRange,
      // Step 3 (retrieval rule): per-turn tracking of which piece ids the model
      // retrieved / actually saw — enforced by propose_outfit and the prose
      // citation check in applyFreeformOutputChecks.
      retrievedPieceIds: new Set(),
      visuallySeenPieceIds: new Set(),
      activeContext: req.body.activeContext || null,
      // Step 4 (model-declared intent): set by the declare_intent tool; guards
      // and composing tools consume it instead of keyword-guessing.
      declaredIntent: null,
      // Real routing (plan: quizzical-foraging-boot, Stage F). req.body.provider === 'sonnet' is
      // the manual "Retry with Sonnet" escape hatch — it wins over the env default for this one
      // call, forcing Anthropic regardless of STYLIST_PROVIDER_OVERRIDE. Otherwise the env default
      // applies (null when unset, so every existing caller is unaffected).
      providerOverride: req.body.provider === 'sonnet' ? { provider: 'anthropic' } : stylistProviderOverride
    }
    // Computed once, up front, from the same providerOverride every call below reads from
    // toolContext — so the router/compact/bounded-atomic response branches (none of which go
    // through askStylistWithTools, which is the only place that otherwise sets this) report the
    // turn's actual resolved provider instead of the static AI_PROVIDER default.
    // askStylistWithTools recomputes and overwrites this identically for full_stylist turns.
    toolContext.resolvedProviderTarget = resolveAiTarget(toolContext.providerOverride)
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
    // docs/trip-composition-parity-spec.md — same one-shot structured composer shape as capsule's,
    // for the initial trip plan only; always wired (no feature flag) since the spec is ratified.
    toolContext.composeTripPlanOnce = workbench => composeTripPlanOnce(workbench, toolContext)
    // docs/trip-cold-layer-decision-contract-and-repair-spec.md (Part B) — one narrow, bounded
    // repair pass for cold-layer-decision-only failures; always wired alongside composeTripPlanOnce
    // since both are the same ratified atomic-composition arc.
    toolContext.repairTripColdLayerCards = payload => repairTripColdLayerCards(payload, toolContext)
    // Stage 2 roster selection is opt-in. With the flag off, toolContext never
    // gets a chooser and the capsule path is byte-identical to what shipped.
    if (modelCapsuleRosterEnabled()) {
      toolContext.chooseCapsuleRoster = request => chooseCapsuleRosterWithProvider(request, toolContext)
    }
    if (modelTripRosterEnabled()) {
      toolContext.chooseTripRoster = request => chooseTripRosterWithProvider(request, toolContext)
    }
    const compactState = getStylistConversationState(req.body.sessionId || 'default') || {}
    const priorConversationHistory = priorStylistConversationHistory(req.body.history, currentQuestion)
    // docs/bounded-multi-context-continuity-spec.md. Pieces the immediately preceding accepted
    // full_stylist answer actually discussed (cited in prose AND verified that turn) — not raw
    // search candidates. Read-only here: informs the router's contextSummary (§5.4) and, if the
    // turn falls through to full_stylist, buildStylistConversationPayload's continuation-context
    // block (§5.2). Never merged into compactContext.pieceIds (§5.3) and never treated as verified
    // this turn on its own — the model must call view_pieces before composing from it.
    const recentlyDiscussedPieceIds = Array.isArray(compactState.recently_discussed_piece_ids?.piece_ids)
      ? compactState.recently_discussed_piece_ids.piece_ids
      : []
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
    // Execution freshness is structural state, not conversational tone. A live fresh-task request
    // containing the ordinary sentence "This is ordinary sightseeing" was labeled `correction`
    // by the client and skipped the router entirely, despite having no prior context. Keep the
    // tone label for full-stylist conversation behavior, but do not let prose classification own
    // whether a context-free request may reach a bounded execution profile.
    const executionContextEvidence = freeformExecutionContextEvidence(req.body, compactState, recentlyDiscussedPieceIds)
    const freshExecutionRequest = executionContextEvidence.length === 0
    const boundedRouterEligible = freshExecutionRequest
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
    let singleOutfitRoute = null
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
            req.body.activeContext?.type === 'piece' ? `active piece: ${req.body.activeContext.name || req.body.activeContext.id}` : '',
            // docs/bounded-multi-context-continuity-spec.md §5.4. An informational hint only — the
            // router still judges continuation-vs-fresh-request itself; this never gates which
            // profile is reachable. Populated by the full_stylist end-of-turn write below.
            recentlyDiscussedPieceIds.length
              ? `previous answer discussed ${recentlyDiscussedPieceIds.length} specific verified wardrobe piece(s)`
              : 'no recently discussed wardrobe pieces'
          ].filter(Boolean).join('; '),
          // Just the immediately preceding turn (docs/deferred-conversational-cache-spec.md's sibling
          // finding: the router was classifying purely from an isolated sentence, so a reply that only
          // makes sense as an answer to the assistant's own prior question — e.g. naming a garment
          // while answering "which outfit's layer?" — read like a standalone garment_fact question).
          // Reuses the same recent-exchange formatting recentReferentPieceIds already relies on.
          recentExchange: compactRecentHistory(priorConversationHistory, 2),
          explicitActivity: req.body.activity || '',
          providerOverride: toolContext.providerOverride
        })
        recordToolLoopUsage(toolContext, routed.usage)
        bumpFreeformDiagnostic(toolContext, 'executionRouterCalls')
        recordFreeformToolIteration(toolContext, ['execution_router'])
        // The router has already resolved the request's structured occasion/activity. Preserve
        // that result as established turn state even when the selected profile is full_stylist;
        // otherwise a later search_wardrobe call that omits those optional arguments silently
        // falls back to route defaults (`casual` / no activity) and retrieves the wrong visual
        // roster. Occasion remains overridable by an explicit tool argument. Activity is locked to
        // the router's request-level interpretation so a later model tool call cannot invent walking
        // and turn it into a footwear gate.
        //
        // 2026-09-16 (owner review, thread_1789546295700): season gets the SAME lock, for the same
        // reason. This run's router correctly resolved `early fall`; the model's own later
        // generate_outfits call restated season as `warm` (a temperature descriptor, answering the
        // generate_outfits schema's own "e.g. warm, cool, year-round" wording), and
        // resolveCalendarSeason (lib/seasonContext.js) maps `warm -> summer` — silently discarding
        // the correct calendar season and, with it, changing which season-eligibility exclusions
        // applied (OUT_OF_SEASON['fall']:'warm' vs ['summer']:'cool' exclude opposite tag sets).
        // Weather already has its own field (`user_weather`/`resolvedWeather`) for describing
        // temperature — generate_outfits's own resolvedSeason prompt text already appends a
        // `physicalWeather` phrase derived from the resolved weather profile, not from this string
        // — so locking season to the router's calendar classification loses no descriptive
        // information, it only stops a later temperature-vibe word from overwriting the calendar
        // fact used for season-based eligibility.
        if (freshExecutionRequest) {
          toolContext.occasion = normalizeOccasion(routed.value?.occasion)
          toolContext.activity = normalizeActivity(routed.value?.activity)
          toolContext.executionRouterActivity = toolContext.activity
          toolContext.executionRouterActivityLocked = true
          toolContext.season = routed.value?.season || toolContext.season
          toolContext.executionRouterSeason = toolContext.season
          toolContext.executionRouterSeasonLocked = true
        }
        const routedLimit = Number(routed.value?.limit) || 0
        const compactProfile = isSavedPhotoWearMechanicsQuestion(currentQuestion, {
          exactSubjectCount: exactNamedPieceIds.length,
          savedPhotoCount: compactSavedPhotoCount
        })
          ? 'garment_fact'
          : routed.value?.profile
        // Keep the router's raw disposition visible in the response debug even when later context
        // checks conservatively fall through to full_stylist. Previously executionProfile showed
        // only the path ultimately taken, so profile-vs-limit-vs-context rejection was impossible
        // to distinguish after a live run.
        toolContext.freeformDiagnostics ||= {}
        toolContext.freeformDiagnostics.executionRouterProfile = String(compactProfile || '')
        toolContext.freeformDiagnostics.executionRouterLimit = routedLimit
        if (freshExecutionRequest && compactProfile === 'single_outfit' && routedLimit === 1) {
          singleOutfitRoute = routed.value
        }
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
          clearRecentlyDiscussedPieceIds(req.body.sessionId)
          return res.json({
            answer: stripPieceIdCitations(formatWardrobeInventoryAnswer(categoryCounts)),
            savedCorrections: [], renderedBoards: [],
            provider: toolContext.resolvedProviderTarget?.provider || AI_PROVIDER,
            model: toolContext.resolvedProviderTarget?.model || ACTIVE_STYLIST_MODEL,
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
              // thread_1789536455443: existing_card_explanation used to get zero photos (and its
              // system prompt forbade even claiming to see any) — a suitability/warmth question
              // about an already-composed card had no visual evidence of construction at all,
              // only the sparse structured facts. Both compact profiles now get the same visual
              // evidence a garment_fact question already received.
              const visualEvidence = (compactProfile === 'garment_fact' || compactProfile === 'existing_card_explanation')
                ? await compactGarmentVisualEvidence(visualPieces)
                : []
              // 2026-09-16 (owner review): thread_1789543565383 (capture session
              // 20260916T072500260Z-p33193-328b5958) shows a real existing_card_explanation call
              // hit stopReason: max_tokens with maxTokens: 700, storing and presenting a sentence
              // fragment ("...this outfit can be trusted for an outdoor temperature range of 40°F
              // to") as a complete answer. Same root cause already diagnosed for the router
              // (routeFreeformExecutionProfile above, 350->900): Gemini bills thinking tokens out of
              // this same cap and thinking_level 'low' still lets that vary a lot per request, so a
              // ceiling sized only for the visible prose can be exhausted by reasoning before any
              // answer text is written. Raised with headroom, matching the full-turn free-text
              // ceiling used for a prose answer of comparable length elsewhere in this file.
              const guarded = await compactAnswerWithTruncationGuard({
                system: compactFreeformAnswerSystem(compactProfile),
                messages: [{
                  role: 'user',
                  content: visualEvidence.length
                    ? [{ type: 'text', text: answerText }, ...visualEvidence]
                    : answerText
                }],
                maxTokens: 1500,
                providerOverride: toolContext.providerOverride,
                onAttempt: ({ isRetry }) => updateAiTelemetryContext({
                  freeformTurnToken,
                  subflow: 'compact_profile',
                  iterationIndex: nextFreeformCallIndex(toolContext),
                  isRetry,
                  retryReason: isRetry ? 'providerTruncation' : '',
                  isNested: false,
                })
              })
              for (const usage of guarded.usages) recordToolLoopUsage(toolContext, usage)
              bumpFreeformDiagnostic(toolContext, 'compactAnswerCalls')
              if (guarded.usages.length > 1) bumpFreeformDiagnostic(toolContext, 'compactAnswerRetries')
              // A response the provider itself flags as cut off at the token cap is not a completed
              // answer, however fluent the fragment reads — see callOutcomeFromUsage's identical
              // reasoning for ai_call_log. compactAnswerWithTruncationGuard already retried once
              // with a "give a shorter, complete answer" nudge; if it is STILL truncated, its own
              // returned text is an honest disclosure, not a stored/served sentence fragment.
              if (guarded.truncated) bumpFreeformDiagnostic(toolContext, 'compactAnswerTruncatedUnrecovered')
              const answerCall = { text: guarded.text, usage: guarded.usages.at(-1) }
              recordFreeformToolIteration(toolContext, [`compact_${compactProfile}`])
              toolContext.freeformDiagnostics ||= {}
              toolContext.freeformDiagnostics.executionProfile = compactProfile
              toolContext.freeformDiagnostics.compactVisualImages = visualEvidence.filter(block => block.type === 'image').length
              const freeformDiagnostics = toolContext.freeformDiagnostics || {}
              persistFreeformGenerationRun({
                sessionId: req.body.sessionId || '', occasion: toolContext.occasion,
                diagnostics: freeformDiagnostics, turnFailed: false, freeformTurnToken
              })
              clearRecentlyDiscussedPieceIds(req.body.sessionId)
              return res.json({
                answer: stripPieceIdCitations(answerCall.text),
                savedCorrections: [], renderedBoards: [],
                provider: toolContext.resolvedProviderTarget?.provider || AI_PROVIDER,
                model: toolContext.resolvedProviderTarget?.model || ACTIVE_STYLIST_MODEL,
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
          // 2026-09-16 (owner review): confirmed via /tmp/wardrobe-dev-unified.log — this exact
          // shortcut called generate_outfits with no weather at all, was rejected
          // (weather_context_required), and only succeeded after a second, model-issued call
          // restated the temperature it had already read in the user's own words. That restatement
          // is unnecessary: extractStructuredUserWeather (styling-engine/stylingIntent.js) already
          // extracts literal stated Fahrenheit facts deterministically, and buildSingleOutfitConversationPayload
          // already uses it for the identical purpose. Only the fields it actually returns are
          // passed through — no `scope` or any other field is manufactured for either source below.
          //
          // This tool call always states `season` explicitly (a required field on generate_outfits),
          // and resolveWeather (stylingContext.js) deliberately refuses its established-state
          // weather-profile fallback whenever season provenance is 'explicit_request' — "a current
          // explicit seasonal brief is a new instruction... must not silently inherit a derived
          // snapshot from an older card or thread" — so a persisted-weather fallback must be passed
          // as an explicit `user_weather` arg (which resolveWeather checks first, regardless of
          // season provenance) to be reachable at all through this call shape.
          //
          // Current-turn literal weather always wins. The persisted weather_profile is consulted
          // ONLY as a continuation fallback — "three more for the same outing" with no fresh number
          // restated — gated on `!freshExecutionRequest`, the same structural continuation-vs-fresh-
          // pivot signal already computed above for the router-eligibility decision (not a new
          // keyword/weather-specific rule). A genuine fresh pivot ("actually, three hiking outfits
          // tomorrow", no current outfit set) has freshExecutionRequest === true and never inherits a
          // stale profile.
          const currentTurnUserWeather = extractStructuredUserWeather(currentQuestion)
          const continuationHighF = Number(compactState.weather_profile?.high_f)
          const continuationLowF = Number(compactState.weather_profile?.low_f)
          const continuationUserWeather = (Number.isFinite(continuationHighF) || Number.isFinite(continuationLowF))
            ? {
                ...(Number.isFinite(continuationHighF) ? { high_f: continuationHighF } : {}),
                ...(Number.isFinite(continuationLowF) ? { low_f: continuationLowF } : {}),
              }
            : null
          const shortcutUserWeather = currentTurnUserWeather
            || (!freshExecutionRequest ? continuationUserWeather : null)
          await executeTool('generate_outfits', {
            occasion: routed.value.occasion,
            activity: routed.value.activity,
            season: routed.value.season,
            mood: routed.value.mood,
            mission: routed.value.mission,
            limit: routedLimit,
            location: routed.value.location,
            date: routed.value.date,
            ...(shortcutUserWeather ? { user_weather: shortcutUserWeather } : {})
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
              provider: toolContext.resolvedProviderTarget?.provider || AI_PROVIDER,
              model: toolContext.resolvedProviderTarget?.model || ACTIVE_STYLIST_MODEL,
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
    const payload = singleOutfitRoute
      ? buildSingleOutfitConversationPayload(req.body, singleOutfitRoute)
      : await buildStylistConversationPayload({
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
    // The active trip packing roster (docs/README.md: trip roster architecture) — read the same
    // way currentOutfitSet is, so search_wardrobe/propose_outfit see this turn's roster regardless
    // of whether it came from a fresh plan or was carried forward from an earlier one.
    toolContext.packingRosterIds = new Set(
      (payload.threadState?.packing_roster?.roster_ids || []).map(Number).filter(Boolean)
    )
    toolContext.packingRosterPieces = payload.threadState?.packing_roster?.roster_pieces || []
    // The trip's original normalized use-case slots (occasion/activity/weather facts), persisted
    // alongside the roster so a later roster edit can be validated against the real trip
    // specification instead of reconstructed from whichever cards the user happened to accept.
    toolContext.packingRosterSlots = payload.threadState?.packing_roster?.slots || []
    toolContext.knownOutfitPieceIds = [...new Set(
      [
        ...(Array.isArray(req.body.pieceIds) ? req.body.pieceIds : []),
        ...(payload.threadState?.current_outfit_set || []).flatMap(outfit => Array.isArray(outfit?.piece_ids) ? outfit.piece_ids : []),
      ]
        .map(Number).filter(Boolean)
    )]
    if (singleOutfitRoute) {
      toolContext.executionProfile = 'single_outfit'
      toolContext.freeformDiagnostics.executionProfile = 'single_outfit'
      declareSingleOutfitIntent(toolContext)
      toolContext.allowedToolNames = ['search_wardrobe', 'view_pieces', 'propose_outfit']
      toolContext.userWeather = payload.singleOutfitContext?.user_weather || null
      toolContext.location = payload.singleOutfitContext?.location || toolContext.location
      toolContext.currentDate = payload.singleOutfitContext?.date || toolContext.currentDate
      toolContext.season = payload.singleOutfitContext?.season || toolContext.season
      toolContext.mood = payload.singleOutfitContext?.mood || toolContext.mood
      toolContext.mission = payload.singleOutfitContext?.mission || toolContext.mission
    }
    // thread_1788556165595: a plain "what did you use" question about an existing plan reached
    // plan_outfit_set again and produced a second, different capsule. buildStylistConversationPayload
    // already told the model the answer sits in current_outfit_set — this removes the tool that let
    // it ignore that and regenerate instead, mirroring the outfit-critique-followup restriction below.
    if (payload.restrictToInformationalTools) {
      toolContext.allowedToolNames = ['search_wardrobe', 'view_pieces', 'get_garment_details']
    }
    const { answer, savedCorrections } = await askStylistWithTools({
      ...payload,
      toolContext
    })
    const allSaved = [...(savedCorrections || [])]
    if (payload.automaticallySavedCorrection) {
      allSaved.push(payload.automaticallySavedCorrection)
    }

    persistFullStylistTurnState({ toolContext, answer, freeformTurnToken, sessionId: req.body.sessionId || 'default' })

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

    // knownPieceIds lets stripPieceIdCitations also strip a bare "(146)" citation left over from a
    // model that skipped the mandated "(ID 146)" form — otherwise a raw database id reaches the
    // user untouched (live: thread_1788054462046).
    const finalVerifiedIds = verifiedPieceIdSets(toolContext)
    res.json({
      // Last boundary before the user sees it: every guard that needs the citations has
      // already run on the text that still had them.
      answer: stripPieceIdCitations(answer, {
        knownPieceIds: new Set([...finalVerifiedIds.retrieved, ...finalVerifiedIds.known])
      }),
      savedCorrections: allSaved,
      renderedBoards: Array.isArray(toolContext.renderedBoards) ? toolContext.renderedBoards : [],
      // The turn's actual resolved target (plan: quizzical-foraging-boot, Stage F) — not the
      // static AI_PROVIDER process-global, which stops reflecting reality once routing varies
      // per-turn. Falls back to AI_PROVIDER/ACTIVE_STYLIST_MODEL only in the (never-expected) case
      // askStylistWithTools returned without ever setting the out-channel.
      provider: toolContext.resolvedProviderTarget?.provider || AI_PROVIDER,
      model: toolContext.resolvedProviderTarget?.model || ACTIVE_STYLIST_MODEL,
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
