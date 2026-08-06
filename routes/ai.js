import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import OpenAI, { toFile } from 'openai'
import { db, userUploadsDir, safeJsonParse, parsePiece } from '../db.js'
import { colorTaggerInstruction, sanitizeTaggerColors } from '../lib/colorTaxonomy.js'
import { queueColorTaxonomyReviews } from '../lib/colorTaxonomyReview.js'
import { applyTaggerResult, buildAnchorBlock, normalizeConfidenceMap, normalizePhotoProperties, normalizeFiberContent, normalizeFormality, normalizeHeelHeight, normalizeWalkSupport, tagStateForTaggerResult, normalizeManualOverrides } from '../styling-engine/taggerMerge.js'

import {
  prepareImageForClaude,
  prepareWardrobeThumb,
  contentToOpenAI,
  askStylist,
  askStylistWithUsage,
  askStylistStructuredWithUsage,
  askStylistWithTools,
  recordToolLoopUsage,
  estimateAiUsageCost,
  parseModelJson,
  salvageFirstJson,
  PROMPT_CACHE_BREAKPOINT,
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
import { validateSubmittedPlanOutfits, describeOutfitStructureGap, capsuleNeutralBasePlan } from '../styling-engine/outfitSetPlanner.js'

import { OCCASION_PROFILES, resolveOccasionProfile } from '../styling-engine/occasions.js'
import { colorFamilyLabel, colorTaxonomyEntry } from '../lib/colorTaxonomy.js'
import {
  pieceMatchesMaterial,
  pieceMatchesFootwear,
  pieceVisualDetailPolicy
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
    // Cache structure belongs to the provider request, not the frozen semantic
    // prompt constant guarded by prompt_equivalence.test.js.
    system: `${TAG_PIECE_SYSTEM}${PROMPT_CACHE_BREAKPOINT}`,
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
export function persistFreeformGenerationRun({ sessionId = '', occasion = '', diagnostics = {}, turnFailed = false } = {}) {
  try {
    db.prepare(`
      INSERT INTO freeform_generation_runs (session_id, occasion, search_calls, gate_excluded_total, propose_calls, propose_validation_fails, outfit_prose_without_tool_count, zero_result_contradiction_blocks, destination_clarification_retries, plan_slot_environment_inferred, plan_slot_activity_inferred, submit_plan_calls, submit_plan_validation_fails, submit_plan_resubmits, submit_plan_partial_accepts, capsule_final_fallbacks, capsule_supply_gaps, capsule_looks_auto_completed, capsule_roster_model_calls, capsule_roster_model_repairs, capsule_roster_model_fallbacks, capsule_roster_failure_codes, turn_failed, provider_iterations, provider_input_tokens, provider_output_tokens, provider_cache_read_input_tokens, provider_cache_creation_input_tokens, weather_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      "colors": ["${colorTaggerInstruction()}"],
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
      "needs_base": "yes|no|null (omit unless clearly a construction that cannot be worn alone against skin — conservative default is null, not 'no')",
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
    for (const group of grouped.keys()) {
      const pieces = grouped.get(group)
      if (!pieces?.length) continue
      content.push({ type: 'text', text: `=== ${group.toUpperCase()}S ===` })
      for (const p of pieces) {
        const photoFile = p.worn_photo || p.photo || ''
        if (!photoFile) continue
        const filePath = path.join(userUploadsDir(), photoFile)
        if (!fs.existsSync(filePath)) continue
        const { maxPx, detail } = pieceVisualDetailPolicy(p, { allowLow: false })
        const thumb = await prepareWardrobeThumb(filePath, `${p.id}:${maxPx}:${photoFile}`, { maxPx })
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
      `Compose ${requestedLimit} outfits.`,
      savedVariantGuidance,
      rotationWarningsText,
      wholeWardrobeFeedbackText ? `Feedback memory (rejected pairings are settled — do not repeat them):\n${wholeWardrobeFeedbackText}` : '',
      confirmedOutfitsText ? `Confirmed favorite outfits:\n${confirmedOutfitsText}` : ''
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
    let composerUsage = null
    const composerStartedAt = Date.now()
    const systemPrompt = `${prompts.WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM}[[PROMPT_CACHE_BREAKPOINT]]${savedVariantGuidance ? `\n\n${savedVariantGuidance}` : ''}`
    try {
      const composerResult = await withTimeout(askStylistWithUsage({
        system: systemPrompt,
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
    coreCapacity: Math.max(0, Number(slot?.core_capacity) || 0),
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

Use only IDs in the supplied allowed roster. The outfit must contain exactly one top plus one bottom, or one dress; exactly one pair of shoes; and at most one optional layer. Choose a new main core not already represented. Do not add accessories. Do not reinterpret the weather, occasion, roster, or capsule brief. If the catalog cannot support another credible outfit, return {"title":"","piece_ids":[],"reason":"no credible unused combination"}.

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

function capsuleExpansionCoreCapacity(pieces = []) {
  if (!pieces.some(piece => wardrobeCategoryGroup(piece) === 'shoes')) return 0
  const tops = pieces.filter(piece => wardrobeCategoryGroup(piece) === 'top')
  const bottoms = pieces.filter(piece => wardrobeCategoryGroup(piece) === 'bottom')
  const dresses = pieces.filter(piece => wardrobeCategoryGroup(piece) === 'dress')
  return (tops.length * bottoms.length) + dresses.length
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
            reason: { type: 'string' }
          },
          required: ['slot_id', 'piece_ids', 'title', 'reason']
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
      roster_piece_ids: { type: 'array', items: { type: 'integer' }, minItems: exact, maxItems: exact },
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
  quotas = null, attempt = 1, failures = [], previousRosterIds = [], ownerRules = []
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
  return `SEASON: ${isWinter ? 'winter' : isSummer ? 'summer' : 'unspecified'}
CAPSULE SIZE: exactly ${budget} pieces
${capsulePaletteBlock(palette, budget)}${ownerRulesBlock}${capsuleAllocationBlock(quotas, budget)}

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
  quotas = null, ownerRules = [], attempt = 1, failures = [], previousRosterIds = [], imageParts = []
} = {}) {
  // STABLE PREFIX FIRST. Built with attempt:1 unconditionally — passing the
  // real `attempt` here would append the repair text to this block and
  // invalidate the prefix, which is the only place in a single run where a
  // cache hit was ever possible. The caching would then cost the creation
  // premium twice and return nothing.
  const content = [{
    type: 'text',
    text: capsuleRosterSelectionUserText({
      bench, slots, budget, palette, isSummer, isWinter, quotas, ownerRules,
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

  const content = capsuleRosterSelectionContent({
    bench, slots, budget, palette, isSummer, isWinter, quotas, ownerRules,
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
    const slotCoreCapacity = contextSlot.coreCapacity || capsuleExpansionCoreCapacity(allowedPieces)
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
    const structuredOutfit = {
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
    }
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
      for (const candidate of additions) {
        const pieceIds = [...originalIds, Number(candidate.id)]
        const { accepted } = validateSubmittedPlanOutfits(pendingPlan, [{
          slot_id: contextSlot.id,
          title: String(req.body?.title || contextSlot.label || '').trim(),
          piece_ids: pieceIds,
          reason: ''
        }])
        if (accepted.length) {
          attempts.push({ accepted: accepted[0], replaced: null, replacement: candidate, added: true })
          break
        }
      }
    }
    for (const targetId of attempts.length ? [] : swapTargets) {
      const targetPiece = piecesById.get(targetId)
      const targetGroup = wardrobeCategoryGroup(targetPiece || {})
      const candidates = allowedPieces
        .filter(piece => wardrobeCategoryGroup(piece) === targetGroup && !originalIds.includes(Number(piece.id)))
        .sort((a, b) => Number(a.id) - Number(b.id))
      for (const candidate of candidates) {
        const pieceIds = originalIds.map(id => (id === targetId ? Number(candidate.id) : id))
        const { accepted } = validateSubmittedPlanOutfits(pendingPlan, [{
          slot_id: contextSlot.id,
          title: String(req.body?.title || contextSlot.label || '').trim(),
          piece_ids: pieceIds,
          reason: ''
        }])
        if (accepted.length) {
          attempts.push({ accepted: accepted[0], replaced: targetPiece, replacement: candidate })
          break
        }
      }
      if (attempts.length) break
    }

    if (!attempts.length) {
      return res.status(409).json({
        error: missingGroup
          ? `That look is missing ${missingGroup === 'shoes' ? 'shoes' : `a ${missingGroup}`}, and nothing in this capsule's roster for ${contextSlot.label} completes it.`
          : 'No single swap from this capsule roster fixes that look — the pieces it would need are not in this capsule.',
        debug: { providerCalls: 0, swapsTried: swapTargets.length, missingGroup: missingGroup || null }
      })
    }

    const { accepted: acceptedOutfit, replaced, replacement, added } = attempts[0]
    const structuredOutfit = {
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
    }
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
    const extractedWeather = req.body.weather || extractWeatherContext([
      req.body.question || '',
      req.body.threadContext || '',
      req.body.generatedContext || ''
    ].join('\n'))
    const currentQuestion = req.body.question || ''
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
      // Step 4 (model-declared intent): set by the declare_intent tool; guards
      // and composing tools consume it instead of keyword-guessing.
      declaredIntent: null
    }
    // Point the hoisted reference at the live context as soon as it exists, so
    // anything that throws from here on still gets its diagnostics recorded.
    diagnosticsContext = toolContext
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
      diagnostics: freeformDiagnostics || {},
      turnFailed: false
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
        turnFailed: true
      })
    }
    const { status, message } = describeAiError(err)
    res.status(status).json({ error: message })
  }
})

export default router
