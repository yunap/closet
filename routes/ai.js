import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import OpenAI, { toFile } from 'openai'
import { db, uploadsDir, safeJsonParse, parsePiece } from '../db.js'

import {
  prepareImageForClaude,
  contentToOpenAI,
  askStylist,
  askStylistWithTools,
  parseModelJson,
  AI_PROVIDER,
  ACTIVE_STYLIST_MODEL
} from '../styling-engine/provider.js'

import {
  STYLIST_SYSTEM,
  STYLE_SELECTED_ITEM_SYSTEM,
  STYLE_SELECTED_ITEM_FEW_SHOTS,
  OUTFIT_BOARD_PLANNER_SYSTEM,
  WHOLE_WARDROBE_AGENT_SYSTEM,
  EDITORIAL_NEW_PIECES_SYSTEM,
  RENDERER_CALIBRATION_SYSTEM,
  COMPARE_OUTFITS_SYSTEM,
  TAG_PIECE_PROMPT
} from '../styling-engine/prompts.js'

import {
  isStyleSelectedQuestion,
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
  wholeWardrobeMoodProfile
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
  chooseIdentityEditSource,
  outfitStylisticStrengthScore,
  sortByStylisticStrength
} from '../styling-engine/core.js'

const router = express.Router()

// Multer storage setup
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, unique + path.extname(file.originalname))
  }
})
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } })

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
    system: 'You tag wardrobe items from hanger or flat-lay photos. Return only valid JSON matching the requested schema. Use lavender/lilac/mauve for muted purple or purple-pink items; do not collapse them into taupe unless the item is truly warm grey-brown. Separate literal visual facts from style interpretation: floral, botanical, crochet, and print describe the garment surface; bohemian is a style lane only when the construction, material, movement, or styling logic genuinely supports it. Do not mark every floral or botanical item as modern_bohemian. Do not suppress bohemian when it is objectively visible. Use folk_artisan for prairie/craft/rustic/Free People heritage construction, and reserve workwear_utilitarian for real workwear or technical utility. Be conservative with home and grounding_piece: soft/relaxed does not mean home, and movement-heavy skirts are not grounding pieces. Never tag standard daytime tops, basic tank tops, everyday t-shirts, jeans, trousers, or outdoor jackets as "home" unless they are comfort-loungewear/pajamas/sleepwear. The "home" occasion is strictly comfort loungewear or sleepwear; standard daywear items must be "home": "low" or omitted.',
    maxTokens: 1000,
    messages: [{
      role: 'user',
      content
    }]
  }

  const raw = await askStylist(payload)
  return parseModelJson(raw)
}

// ── Whole Wardrobe Generation Helpers ─────────────────────────────────────────
function rewriteWholeWardrobeOutfitWithArchetype(outfit = {}, candidatePieces = [], occasion = 'casual') {
  const pieces = wholeWardrobeFullPieces(outfit, candidatePieces)
  const archetype = wholeWardrobeArchetypeFor({ ...outfit, pieces }, candidatePieces, occasion)
  const modifier = wholeWardrobeGarmentModifier(pieces)
  const label = modifier
    ? `${archetype.labelSuggestion}: ${modifier}`
    : archetype.labelSuggestion
  const silhouetteVariant = wholeWardrobeSilhouetteFromPieces({ ...outfit, pieces })
  const silhouette = silhouetteVariant && silhouetteVariant !== archetype.direction
    ? silhouetteVariant
    : archetype.silhouette
  return {
    ...outfit,
    archetypeId: archetype.archetypeId,
    formulaFamily: archetype.formulaFamily,
    label,
    dominantDirection: archetype.direction,
    silhouette,
    reason: buildOutfitMechanicsReason(outfit, pieces, archetype),
    watchFor: wholeWardrobeWatchFromPieces({ ...outfit, pieces })
  }
}

function hasWholeWardrobePlaceholder(outfit = {}) {
  const text = [outfit.label, outfit.dominantDirection, outfit.silhouette, outfit.bestFor, outfit.reason, outfit.watchFor].join(' ').toLowerCase()
  return /\b(short style lane|one clear silhouette idea|short use case|whole wardrobe outfit|strong wardrobe outfit|complete wardrobe formula|locally ranked wardrobe composition)\b/.test(text)
}

function hasGenericWholeWardrobeText(outfit = {}) {
  const text = [outfit.reason, outfit.watchFor].join(' ').toLowerCase()
  return /\b(balances artfulness with modernity|playful touch|overall look|creates an artistic visual|refined silhouette|visual balance|contrasts well|modern artistic element|clean silhouette|may overwhelm the look|potential boxiness|ensure the playful elements do not overwhelm)\b/.test(text)
}

function repairWholeWardrobeOutfit(outfit = {}, candidatePieces = [], occasion = 'casual', mood = '') {
  const repaired = rewriteWholeWardrobeOutfitWithArchetype({ ...outfit }, candidatePieces, occasion)
  if (hasWholeWardrobePlaceholder(repaired) || !String(repaired.label || '').trim()) repaired.label = wholeWardrobeLabelFromPieces(repaired)
  if (hasWholeWardrobePlaceholder(repaired) || !String(repaired.dominantDirection || '').trim() || String(repaired.dominantDirection || '').trim() === String(repaired.silhouette || '').trim()) repaired.dominantDirection = wholeWardrobeArchetypeFor(repaired, candidatePieces, occasion).direction
  if (hasWholeWardrobePlaceholder(repaired) || !String(repaired.silhouette || '').trim() || String(repaired.dominantDirection || '').trim() === String(repaired.silhouette || '').trim()) repaired.silhouette = wholeWardrobeSilhouetteFromPieces(repaired)
  if (hasWholeWardrobePlaceholder(repaired) || !String(repaired.bestFor || '').trim()) repaired.bestFor = 'right-now wardrobe dressing'
  if (hasWholeWardrobePlaceholder(repaired) || hasGenericWholeWardrobeText(repaired) || !String(repaired.reason || '').trim()) repaired.reason = buildOutfitMechanicsReason(repaired, wholeWardrobeFullPieces(repaired, candidatePieces), wholeWardrobeArchetypeFor(repaired, candidatePieces, occasion))
  if (hasWholeWardrobePlaceholder(repaired) || hasGenericWholeWardrobeText(repaired) || !String(repaired.watchFor || '').trim() || /^none$/i.test(String(repaired.watchFor || '').trim())) repaired.watchFor = wholeWardrobeWatchFromPieces(repaired)
  const moodProfile = wholeWardrobeMoodProfile(mood)
  if (moodProfile?.id === 'modern_bohemian_restraint') {
    const pieces = wholeWardrobeFullPieces(repaired, candidatePieces)
    if (wholeWardrobeBohoSignalScore(pieces) >= 2) {
      repaired.pieces = pieces
      repaired.label = bohoMoodLabelFromPieces(repaired)
      repaired.dominantDirection = 'modern bohemian restraint with city grounding'
      repaired.silhouette = wholeWardrobeSilhouetteFromPieces(repaired)
      repaired.reason = buildBohoOutfitReason(repaired, pieces, occasion)
      repaired.watchFor = buildBohoWatch(repaired, pieces)
    }
  }
  return repaired
}

function wholeWardrobeBohoSignalScore(pieces = []) {
  return pieces.reduce((sum, piece) => sum + bohoSignalForPiece(piece), 0)
}

function wholeWardrobeSelectionScore(outfit, selected, options = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const top = wholeWardrobePieceByGroup(outfit, 'top')
  const bottom = wholeWardrobePieceByGroup(outfit, 'bottom')
  const shoe = wholeWardrobePieceByGroup(outfit, 'shoes')
  const formula = wholeWardrobeFormulaFamily(outfit, options.candidatePieces, options.occasion)
  const silhouetteFamily = wholeWardrobeSilhouetteFromPieces(outfit)
  const grounding = wholeWardrobeGroundingStrategy(outfit)
  const shoeShape = wholeWardrobeShoeShape(outfit)
  const rhythm = wholeWardrobeVisualRhythm(outfit)
  let score = outfitStylisticStrengthScore(outfit, null) + (Number(outfit.localScore) || 0) * 0.25 + (Number(outfit.archetypeScore) || 0)
  const countPiece = (groupPiece) => groupPiece
    ? selected.filter(existing => (existing.pieces || []).some(p => Number(p.id) === Number(groupPiece.id))).length
    : 0
  const sameTopCount = countPiece(top)
  const sameBottomCount = countPiece(bottom)
  const sameShoeCount = countPiece(shoe)
  const sameFormulaCount = selected.filter(existing => wholeWardrobeFormulaFamily(existing, options.candidatePieces, options.occasion) === formula).length
  const sameSilhouetteCount = selected.filter(existing => wholeWardrobeSilhouetteFromPieces(existing) === silhouetteFamily).length
  const sameGroundingCount = selected.filter(existing => wholeWardrobeGroundingStrategy(existing) === grounding).length
  const sameShoeShapeCount = selected.filter(existing => wholeWardrobeShoeShape(existing) === shoeShape).length
  const sameRhythmCount = selected.filter(existing => wholeWardrobeVisualRhythm(existing) === rhythm).length
  const printFormulaCount = wholeWardrobeHasPrintOrStripe(outfit)
    ? selected.filter(existing => wholeWardrobeHasPrintOrStripe(existing)).length
    : 0

  if (sameTopCount >= 1) score -= 40 * sameTopCount
  if (sameBottomCount >= 1) score -= 20 * sameBottomCount
  if (sameShoeCount >= 1) score -= 20 * sameShoeCount
  if (sameSilhouetteCount >= 1) score -= 35 * sameSilhouetteCount
  if (sameGroundingCount >= 1) score -= 18 * sameGroundingCount
  if (sameShoeShapeCount >= 1) score -= 14 * sameShoeShapeCount
  if (sameRhythmCount >= 1) score -= 16 * sameRhythmCount
  if (printFormulaCount >= 1) score -= 20 * printFormulaCount
  if (sameFormulaCount >= 1) score -= 45 * sameFormulaCount
  if (formula === 'compact_top_dark_column' && sameFormulaCount >= 1) score -= 25
  const moodProfile = wholeWardrobeMoodProfile(options.mood)
  if (moodProfile?.id === 'modern_bohemian_restraint') {
    const bohoSignal = wholeWardrobeBohoSignalScore(pieces)
    if (bohoSignal >= 4) score += 24
    else if (bohoSignal >= 2) score += 12
    else score -= 45
  }
  return score
}

function bestWholeWardrobeRequirementCandidate(pool, selected, predicate, options = {}) {
  const selectedKeys = new Set(selected.map(o => (o.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')))
  return pool
    .filter(outfit => predicate(outfit))
    .filter(outfit => !selectedKeys.has((outfit.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')))
    .sort((a, b) => wholeWardrobeSelectionScore(b, selected, options) - wholeWardrobeSelectionScore(a, selected, options))[0] || null
}

function applyWholeWardrobeDiversity(outfits = [], limit = 5, options = {}) {
  const selected = []
  const rejected = []
  const topUse = new Map()
  const bottomUse = new Map()
  const shoeUse = new Map()
  const heroUse = new Map()
  const formulaUse = new Map()
  const silhouetteUse = new Map()
  const groundingUse = new Map()
  const shoeShapeUse = new Map()
  const rhythmUse = new Map()
  const topBottomUse = new Set()
  const pool = [...outfits]
  const formulaFor = (outfit) => wholeWardrobeFormulaFamily(outfit, options.candidatePieces, options.occasion)
  const hasUnusedAlternativeFormula = (formula) => pool.some(candidate => {
    const key = (candidate.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')
    if (selected.some(existing => (existing.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|') === key)) return false
    return formulaFor(candidate) !== formula
  })
  const exploratoryFamilies = new Set(['dress_grounding_shoe', 'soft_piece_structured_anchor', 'earthy_structured_separates'])
  const exploratory = bestWholeWardrobeRequirementCandidate(
    pool,
    selected,
    outfit => exploratoryFamilies.has(formulaFor(outfit)) || wholeWardrobeIsExploratory(outfit),
    options
  )
  if (exploratory) {
    selected.push(exploratory)
    const pieces = Array.isArray(exploratory.pieces) ? exploratory.pieces : []
    const top = pieces.find(p => wardrobeCategoryGroup(p) === 'top')
    const bottom = pieces.find(p => wardrobeCategoryGroup(p) === 'bottom')
    const shoe = pieces.find(p => wardrobeCategoryGroup(p) === 'shoes')
    const heroId = wholeWardrobeHeroPieceId(exploratory)
    const formula = formulaFor(exploratory)
    const silhouetteFamily = wholeWardrobeSilhouetteFromPieces(exploratory)
    const grounding = wholeWardrobeGroundingStrategy(exploratory)
    const shoeShape = wholeWardrobeShoeShape(exploratory)
    const rhythm = wholeWardrobeVisualRhythm(exploratory)
    const topBottomKey = wholeWardrobeTopBottomKey(exploratory)
    if (top) topUse.set(Number(top.id), 1)
    if (bottom) bottomUse.set(Number(bottom.id), 1)
    if (shoe) shoeUse.set(Number(shoe.id), 1)
    if (heroId) heroUse.set(heroId, 1)
    formulaUse.set(formula, 1)
    silhouetteUse.set(silhouetteFamily, 1)
    groundingUse.set(grounding, 1)
    shoeShapeUse.set(shoeShape, 1)
    rhythmUse.set(rhythm, 1)
    if (topBottomKey) topBottomUse.add(topBottomKey)
  }
  while (pool.length && selected.length < limit) {
    pool.sort((a, b) => wholeWardrobeSelectionScore(b, selected, options) - wholeWardrobeSelectionScore(a, selected, options))
    const outfit = pool.shift()
    const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
    const top = pieces.find(p => wardrobeCategoryGroup(p) === 'top')
    const bottom = pieces.find(p => wardrobeCategoryGroup(p) === 'bottom')
    const shoe = pieces.find(p => wardrobeCategoryGroup(p) === 'shoes')
    const heroId = wholeWardrobeHeroPieceId(outfit)
    const formula = formulaFor(outfit)
    const silhouetteFamily = wholeWardrobeSilhouetteFromPieces(outfit)
    const grounding = wholeWardrobeGroundingStrategy(outfit)
    const shoeShape = wholeWardrobeShoeShape(outfit)
    const rhythm = wholeWardrobeVisualRhythm(outfit)
    const topBottomKey = wholeWardrobeTopBottomKey(outfit)
    const outfitKey = (outfit.pieceIds || pieces.map(p => p.id)).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')
    if (selected.some(existing => (existing.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|') === outfitKey)) continue
    const topCount = top ? (topUse.get(Number(top.id)) || 0) : 0
    const bottomCount = bottom ? (bottomUse.get(Number(bottom.id)) || 0) : 0
    const shoeCount = shoe ? (shoeUse.get(Number(shoe.id)) || 0) : 0
    const heroCount = heroId ? (heroUse.get(heroId) || 0) : 0
    const formulaCount = formulaUse.get(formula) || 0
    const silhouetteCount = silhouetteUse.get(silhouetteFamily) || 0
    const groundingCount = groundingUse.get(grounding) || 0
    const shoeShapeCount = shoeShapeUse.get(shoeShape) || 0
    const rhythmCount = rhythmUse.get(rhythm) || 0
    if (top && topCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `too many outfits use ${top.name}` })
      continue
    }
    if (bottom && bottomCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `too many outfits use ${bottom.name}` })
      continue
    }
    if (topBottomKey && topBottomUse.has(topBottomKey)) {
      rejected.push({ label: outfit.label || 'unnamed', reason: 'exact top+bottom formula already used' })
      continue
    }
    if (heroId && heroCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: 'hero garment used more than twice' })
      continue
    }
    if (formula === 'compact_top_dark_column' && formulaCount >= 1 && hasUnusedAlternativeFormula(formula)) {
      rejected.push({ label: outfit.label || 'unnamed', reason: 'compact-top dark-column slot already used' })
      continue
    }
    if (formulaCount >= 1 && hasUnusedAlternativeFormula(formula)) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `duplicate ${formula} formula` })
      continue
    }
    if (silhouetteCount >= 1 && selected.length >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `duplicate ${silhouetteFamily} silhouette` })
      continue
    }
    if (groundingCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `too much ${grounding}` })
      continue
    }
    if (shoeShapeCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `too many ${shoeShape} shoes` })
      continue
    }
    if (rhythmCount >= 1 && selected.length >= 3) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `duplicate ${rhythm}` })
      continue
    }
    selected.push(outfit)
    if (top) topUse.set(Number(top.id), topCount + 1)
    if (bottom) bottomUse.set(Number(bottom.id), bottomCount + 1)
    if (shoe) shoeUse.set(Number(shoe.id), shoeCount + 1)
    if (heroId) heroUse.set(heroId, heroCount + 1)
    formulaUse.set(formula, formulaCount + 1)
    silhouetteUse.set(silhouetteFamily, silhouetteCount + 1)
    groundingUse.set(grounding, groundingCount + 1)
    shoeShapeUse.set(shoeShape, shoeShapeCount + 1)
    rhythmUse.set(rhythm, rhythmCount + 1)
    if (topBottomKey) topBottomUse.add(topBottomKey)
  }

  if (options.requireDress && !selected.some(wholeWardrobeHasDress)) {
    const dressCandidate = bestWholeWardrobeRequirementCandidate(outfits, selected, wholeWardrobeHasDress, options)
    if (dressCandidate) {
      const replaceIndex = selected.length >= limit ? selected.length - 1 : selected.length
      if (selected[replaceIndex]) rejected.push({ label: selected[replaceIndex].label || 'unnamed', reason: 'replaced to include a dress formula' })
      selected[replaceIndex] = dressCandidate
    }
  }

  if (options.requireNonGraphicTop && !selected.some(wholeWardrobeHasNonGraphicTop)) {
    const plainTopCandidate = bestWholeWardrobeRequirementCandidate(outfits, selected, wholeWardrobeHasNonGraphicTop, options)
    if (plainTopCandidate) {
      const replaceIndex = selected.length >= limit ? selected.length - 1 : selected.length
      if (selected[replaceIndex]) rejected.push({ label: selected[replaceIndex].label || 'unnamed', reason: 'replaced to include a non-graphic top formula' })
      selected[replaceIndex] = plainTopCandidate
    }
  }

  const targetFormulaCount = Math.min(3, limit, selected.length)
  let formulaDiversityAttempts = 0
  while (new Set(selected.map(formulaFor)).size < targetFormulaCount && formulaDiversityAttempts < limit * 3) {
    formulaDiversityAttempts += 1
    const usedFamilies = new Set(selected.map(formulaFor))
    const candidate = bestWholeWardrobeRequirementCandidate(
      outfits,
      selected,
      outfit => !usedFamilies.has(formulaFor(outfit)),
      options
    )
    if (!candidate) break
    const replaceIndex = selected
      .map((outfit, index) => ({ outfit, index, count: selected.filter(o => formulaFor(o) === formulaFor(outfit)).length }))
      .filter(item => item.count > 1 || formulaFor(item.outfit) === 'compact_top_dark_column')
      .sort((a, b) => wholeWardrobeSelectionScore(a.outfit, selected.filter((_, i) => i !== a.index), options) - wholeWardrobeSelectionScore(b.outfit, selected.filter((_, i) => i !== b.index), options))[0]?.index
    const targetIndex = Number.isInteger(replaceIndex) ? replaceIndex : selected.length - 1
    rejected.push({ label: selected[targetIndex]?.label || 'unnamed', reason: `replaced to include ${formulaFor(candidate)} formula` })
    selected[targetIndex] = candidate
  }

  return { outfits: selected, rejected }
}

function normalizeWholeWardrobeStrengths(outfits = []) {
  return outfits.map((outfit, index) => ({
    ...outfit,
    strength: index === 0 ? 'signature' : (index <= 2 ? 'strong' : 'usable')
  }))
}

function wholeWardrobeOutfitsFromCandidates(candidates = [], candidatePieces = [], options = {}) {
  return candidates.map(candidate => repairWholeWardrobeOutfit(normalizeWholeWardrobeOutfitObject({
    label: wholeWardrobeLabelFromPieces({ pieces: candidate.pieces }),
    strength: 'usable',
    dominantDirection: wholeWardrobeDirectionFromPieces({ pieces: candidate.pieces }),
    silhouette: wholeWardrobeSilhouetteFromPieces({ pieces: candidate.pieces }),
    bestFor: options.occasion || 'casual',
    pieceIds: candidate.pieceIds,
    pieces: candidate.pieces,
    reason: wholeWardrobeReasonFromPieces({ pieces: candidate.pieces }),
    watchFor: wholeWardrobeWatchFromPieces({ pieces: candidate.pieces }),
    localScore: candidate.localScore,
  }, candidatePieces), candidatePieces, options.occasion, options.mood))
}

function locallyGateWholeWardrobeOutfits(outfits = [], limit = 5, { requireShoes = true, requireDress = false, requireNonGraphicTop = false, candidatePieces = [], occasion = 'casual', mood = '' } = {}) {
  const seen = new Set()
  const accepted = []
  const rejected = []
  for (const outfit of outfits) {
    const repaired = repairWholeWardrobeOutfit(outfit, candidatePieces, occasion, mood)
    const pieces = Array.isArray(repaired?.pieces) ? repaired.pieces : []
    const groups = pieces.map(p => wardrobeCategoryGroup(p))
    const hasSeparates = groups.includes('top') && groups.includes('bottom')
    const hasDress = groups.includes('dress')
    const hasShoes = groups.includes('shoes')
    const text = [repaired.label, repaired.dominantDirection, repaired.silhouette, repaired.reason, repaired.watchFor, ...pieces.map(p => p.name)].join(' ').toLowerCase()
    const key = (repaired.pieceIds || pieces.map(p => p.id)).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')

    if ((!hasSeparates && !hasDress) || (requireShoes && !hasShoes)) {
      rejected.push({ label: repaired?.label || 'unnamed', reason: 'not a complete wardrobe outfit' })
      continue
    }
    if (seen.has(key)) {
      rejected.push({ label: repaired?.label || 'unnamed', reason: 'duplicate formula' })
      continue
    }

    if (/\b(flattering|elongating|slimming|confidence|draws attention upward|balance the body)\b/.test(text)) {
      rejected.push({ label: repaired?.label || 'unnamed', reason: 'uses body-shape/flattery framing' })
      continue
    }
    if (wholeWardrobeMissesMood(repaired, mood)) {
      rejected.push({ label: repaired?.label || 'unnamed', reason: 'misses requested boho mood' })
      continue
    }
    if ((text.match(/\b(wide|wide-leg|oversized|loose|flowing|voluminous|relaxed)\b/g) || []).length >= 3) {
      rejected.push({ label: repaired?.label || 'unnamed', reason: 'too much width/volume' })
      continue
    }
    if ((text.match(/\b(soft|gauzy|drape|drapey|cream|ivory|beige|taupe|sand)\b/g) || []).length >= 5 && !/\b(black|charcoal|espresso|boot|loafer|pointed|structured|graphic)\b/.test(text)) {
      rejected.push({ label: repaired?.label || 'unnamed', reason: 'soft neutral drift' })
      continue
    }

    seen.add(key)
    accepted.push(repaired)
  }
  const diverse = applyWholeWardrobeDiversity(sortByStylisticStrength(accepted, null), limit, { requireDress, requireNonGraphicTop, candidatePieces, occasion, mood })
  return {
    outfits: normalizeWholeWardrobeStrengths(diverse.outfits),
    rejected: [...rejected, ...diverse.rejected]
  }
}

function formatWholeWardrobeOutfitFeedback({ occasion, season, mood, outfits = [], skip = '', saveableLearning = '' }) {
  const lines = [
    `**Generated strongest wardrobe outfits**`,
    `**Occasion / season:** ${occasion || 'casual'} / ${season || 'current season'}`,
    mood ? `**Mood:** ${mood}` : '',
    ''
  ].filter(Boolean)
  outfits.forEach((outfit, index) => {
    lines.push(`**${index === 0 || outfit.strength === 'signature' ? 'Signature / strongest outfit' : outfit.label || `Outfit ${index + 1}`}**`)
    if (outfit.label) lines.push(`Label: ${outfit.label}`)
    if (outfit.strength) lines.push(`Strength: ${outfit.strength}`)
    if (outfit.dominantDirection) lines.push(`Direction: ${outfit.dominantDirection}`)
    if (outfit.silhouette) lines.push(`Silhouette: ${outfit.silhouette}`)
    if (outfit.bestFor) lines.push(`Best for: ${outfit.bestFor}`)
    const pieces = Array.isArray(outfit.pieces) ? outfit.pieces.map(p => p?.name).filter(Boolean).join(' + ') : ''
    if (pieces) lines.push(`Pieces: ${pieces}`)
    const missing = Array.isArray(outfit.missingPieces) ? outfit.missingPieces.map(p => p?.name || p).filter(Boolean).join(' + ') : ''
    if (missing) lines.push(`Missing pieces: ${missing}`)
    if (outfit.reason) lines.push(`Why this works: ${outfit.reason}`)
    if (outfit.watchFor && outfit.watchFor !== 'none') lines.push(`Watch for: ${outfit.watchFor}`)
    lines.push('')
  })
  if (skip) {
    lines.push(`*Skipped directions:* ${skip}`)
    lines.push('')
  }
  if (saveableLearning) {
    lines.push(`**Saveable learning:** ${saveableLearning}`)
  }
  return lines.join('\n').trim()
}

function buildOutfitMechanicsReason(outfit = {}, pieces = [], archetype = {}) {
  const byGroup = (group) => pieces.find(p => wardrobeCategoryGroup(p) === group)
  const top = byGroup('top')
  const bottom = byGroup('bottom')
  const dress = byGroup('dress')
  const shoe = byGroup('shoes')
  const layer = byGroup('outerwear')
  const printPiece = pieces.find(p => /\b(floral|print|graphic|stripe|pattern|abstract|tapestry)\b/.test(pieceNameBlob(p)))
  const softPiece = pieces.find(p => /\b(soft|gauzy|drape|linen|cashmere|knit|cream|ivory|oatmeal)\b/.test(pieceNameBlob(p)))
  const shoeText = shoe ? pieceNameBlob(shoe) : ''
  const sentences = []

  if (dress) {
    const support = layer ? `${layer.name} adds the structure around it` : shoe ? `${shoe.name} gives the one-piece line a grounded finish` : 'the supporting pieces need to stay clean'
    sentences.push(`${dress.name} carries the column, and ${support}.`)
  } else if (bottom) {
    const columnVerb = /\b(black|charcoal|dark|navy|denim|straight|trouser|column)\b/.test(pieceNameBlob(bottom)) ? 'creates the long base' : 'sets the lower proportion'
    const upperJob = top ? `${top.name} ${/\b(fitted|sleeveless|tank|shell|compact)\b/.test(pieceNameBlob(top)) ? 'keeps the upper half compact' : 'sets the upper shape'}` : 'the upper piece needs to stay controlled'
    sentences.push(`${bottom.name} ${columnVerb}, while ${upperJob}.`)
  } else if (top) {
    sentences.push(`${top.name} sets the upper anchor, so the remaining pieces need to keep the line grounded.`)
  }

  if (printPiece && printPiece !== top && printPiece !== bottom && printPiece !== dress) {
    sentences.push(`${printPiece.name} supplies the visual tension; the quiet support pieces keep it from turning into pattern stacking.`)
  } else if (printPiece) {
    sentences.push(`${printPiece.name} supplies the visual tension, so the surrounding pieces need to stay quieter.`)
  } else if (softPiece) {
    sentences.push(`${softPiece.name} brings the softness; the structured or dark pieces keep the formula from drifting loose.`)
  }

  if (shoe) {
    if (/\b(pointed|patent|mule|flat)\b/.test(shoeText)) sentences.push(`${shoe.name} keeps the finish sharp at the floor.`)
    else if (/\b(boot|bootie)\b/.test(shoeText)) sentences.push(`${shoe.name} gives the hem enough weight.`)
    else if (/\b(loafer|oxford)\b/.test(shoeText)) sentences.push(`${shoe.name} adds the tailored grounding.`)
    else sentences.push(`${shoe.name} grounds the outfit; keep it intentional rather than casual.`)
  } else if (archetype?.formulaFamily !== 'dress_grounding_shoe') {
    sentences.push('The shoe choice needs to add a clear anchor before this leaves the house.')
  }

  return sentences
    .join(' ')
    .replace(/\b(harmonious|flattering|sophisticated|balance|modernity|overall look|playful touch)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function bohoMoodLabelFromPieces(outfit = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const text = pieces.map(pieceTextBlob).join(' ')
  const modifier = wholeWardrobeGarmentModifier(pieces)
  let base = 'Modern Bohemian City'
  if (pieces.some(p => wardrobeCategoryGroup(p) === 'dress')) base = 'Grounded Bohemian Dress'
  else if (/\b(crochet|woven|raffia|rattan|cork|espadrille|basket|braided|artisan|embroidered|embroidery)\b/.test(text)) base = 'Artisan City Bohemian'
  else if (/\b(paisley|botanical|floral|abstract print|print)\b/.test(text)) base = 'Botanical Bohemian City'
  else if (/\b(cognac|rust|terracotta|ochre|mustard|olive|brown|tan|amber|earthy)\b/.test(text)) base = 'Earthy Bohemian City'
  return modifier ? `${base}: ${modifier}` : base
}

function strongestBohoPiece(pieces = []) {
  return [...pieces]
    .map(piece => ({ piece, score: bohoSignalForPiece(piece) }))
    .sort((a, b) => b.score - a.score)[0]?.piece || pieces[0] || null
}

function buildBohoOutfitReason(outfit = {}, pieces = [], occasion = 'city') {
  const hero = strongestBohoPiece(pieces)
  const shoe = pieces.find(p => wardrobeCategoryGroup(p) === 'shoes')
  const support = pieces.find(p => hero && Number(p.id) !== Number(hero.id) && wardrobeCategoryGroup(p) !== 'shoes')
  const heroTrait = bohoTraitForPiece(hero) || 'bohemian detail'
  const supportGroup = support ? wardrobeCategoryGroup(support) : ''
  const supportText = support
    ? supportGroup === 'bottom'
      ? `${support.name} sets the lower proportion so the bohemian detail has structure rather than sprawl.`
      : supportGroup === 'outerwear'
        ? `${support.name} adds the city frame around the softer bohemian element.`
        : `${support.name} keeps the outfit ${/\b(city|gallery|art|museum)\b/i.test(occasion) ? 'city-readable' : 'wearable'} without flattening the texture.`
    : ''
  const shoeText = shoe
    ? `${shoe.name} gives the outfit a practical grounded finish.`
    : 'Add a grounded shoe before treating this as complete.'
  return [
    hero ? `${hero.name} carries the bohemian read through ${heroTrait}.` : '',
    supportText,
    shoeText
  ].filter(Boolean).join(' ')
}

function buildBohoWatch(outfit = {}, pieces = []) {
  const text = pieces.map(pieceTextBlob).join(' ')
  const printCount = (text.match(/\b(floral|paisley|botanical|abstract|graphic|print|pattern)\b/g) || []).length
  const softCount = (text.match(/\b(crochet|gauzy|drape|flowing|soft|tiered|ruffle)\b/g) || []).length
  if (printCount >= 2) return 'Keep any added layer quiet so the print mix stays intentional.'
  if (softCount >= 2) return 'Use a grounded shoe or structured support piece so the softness does not turn shapeless.'
  if (!pieces.some(p => wardrobeCategoryGroup(p) === 'shoes')) return 'Choose the shoe before judging the outfit; boho needs grounded finish, not just texture.'
  return 'Keep the bohemian detail as the clear thesis; avoid adding a second competing accent.'
}



// ── AI Tagging endpoints ───────────────────────────────────────────────────────
router.post('/extract-pieces', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo provided' })
  const filePath = path.join(uploadsDir, req.file.filename)
  try {
    const { base64, mime } = await prepareImageForClaude(filePath)
    fs.unlinkSync(filePath)

    const raw = await askStylist({
      system: 'You analyze outfit photos to identify and extract individual wardrobe items with full styling details. Return only valid JSON matching the requested schema. Capture structural, architectural, and geometric drape details (asymmetric collars, button cowls, design hems, waffle or textured knits) and use elevated styling vocabulary instead of lazy, generic classifications.',
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
      "fabric_category": "jersey|knit|linen|silk|satin|cotton|wool|denim|ponte|synthetic|fleece|other",
      "fabric_weight": "ultralight|light|medium|heavy",
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

router.post('/fit-note', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo provided' })
  const filePath = path.join(uploadsDir, req.file.filename)
  try {
    const { base64, mime } = await prepareImageForClaude(filePath)
    fs.unlinkSync(filePath)

    const {
      piece_name,
      piece_category,
      piece_notes = '',
      engine_notes = '',
      recommendation_status = 'trusted',
      fit_confidence = 'unknown',
      role_permission = 'auto'
    } = req.body
    const isTop    = ['top','outerwear','dress'].includes(piece_category)
    const isBottom = piece_category === 'bottom'

    const focusLine = piece_name && piece_category
      ? `The piece being evaluated is: "${piece_name}" (${piece_category}). Focus your entire evaluation on this piece only — treat any other visible clothing as neutral context, not part of the assessment.`
      : 'Focus on the primary garment visible in this photo.'

    const trustContext = [
      piece_notes ? `existing styling notes: ${piece_notes}` : '',
      engine_notes ? `engine notes: ${engine_notes}` : '',
      recommendation_status && recommendation_status !== 'trusted' ? `recommendation trust: ${recommendation_status}` : '',
      fit_confidence && fit_confidence !== 'unknown' ? `fit confidence: ${fit_confidence}` : '',
      role_permission && role_permission !== 'auto' ? `auto-styling role: ${role_permission}` : ''
    ].filter(Boolean).join('\n')

    const schemaText = `Return ONLY a valid JSON object — no markdown, no explanation:
{
  "note": "1-3 sentence factual fit-mechanics note in lowercase. Mention placement, rise/waist/hem/drape/pulling/bunching/strain if visible or if existing notes flag it. Do not praise style, attractiveness, body, or print. Do not say print/color absorbs fit issues. Net verdict must be one of: works as-is, needs minor adjustment, needs fit review, or do not auto-style.",
  "fit_on_body": "clings_stretchy|clings_drapey|skims|hangs_straight|drapes|structured",
  "length_hits_at": "crop|waist|hip|mid-thigh|knee|midi|maxi|full-length",
  ${isTop  ? '"tuck_behavior": "tucks_anywhere|tucks_with_structure|wear_over_only",' : ''}
  ${isBottom ? '"waistband_type": "structured_high_waist|structured_mid_waist|soft_elastic_pull_on|tight_no_room|drawstring_relaxed",' : ''}
  "silhouette": "fitted|slim|relaxed|boxy|A-line|drop-shoulder|oversized",
  "fit_confidence": "unknown|low|medium|high",
  "recommendation_status": "trusted|needs_fit_review",
  "style_profile_patch": {
    "style_notes": {
      "best_use": "updated stylist role description based on how it behaves/looks on-body. Avoid generic 'casual wear' or 'daily casual' phrases.",
      "risk": "styling or aesthetic risk observed on-body. Do not put 'needs fit review' here; risk must be a styling/aesthetic constraint."
    },
    "style_lanes": {
      "artistic_minimal": 0, "modern_bohemian": 0, "folk_artisan": 0, "boho_romantic": 0, "boho_festival": 0,
      "graphic_casual": 0, "earthy_structured": 0, "polished_classic": 0, "romantic_soft": 0, "workwear_utilitarian": 0
    },
    "visual_roles": ["choose 1-4: hero_piece, support_piece, grounding_piece, sharpener_piece, texture_piece, movement_piece, column_piece, quiet_anchor, color_accent"]
  }
}`

    const raw = await askStylist({
      system: 'You inspect clothing fit on-body. Return only valid JSON matching the requested schema. Provide raw, descriptive physical observations without styling fluff, body flattery, or comfort speculation.',
      maxTokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
          { type: 'text', text: [focusLine, trustContext, schemaText].filter(Boolean).join('\n\n') }
        ]
      }]
    })

    res.json(parseModelJson(raw))
  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    console.error('Fit note error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/tag-piece', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo provided' })
  const filePath = path.join(uploadsDir, req.file.filename)
  try {
    const tags = await tagPieceWithProvider(filePath)
    fs.unlinkSync(filePath)
    res.json(tags)
  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    console.error('AI tag error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/tag-piece-existing/:id', async (req, res) => {
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(req.params.id)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })
    if (!piece.photo && !piece.worn_photo) return res.status(400).json({ error: 'This piece has no photo to tag' })

    const photos = []
    if (piece.photo) {
      const hangerPath = path.join(uploadsDir, piece.photo)
      if (fs.existsSync(hangerPath)) photos.push({ path: hangerPath, label: 'HANGER PHOTO', guidance: 'Use for literal garment truth: category, color, construction, pattern, fabric, and shape.' })
    }
    if (piece.worn_photo) {
      const wornPath = path.join(uploadsDir, piece.worn_photo)
      if (fs.existsSync(wornPath)) photos.push({ path: wornPath, label: 'WORN PHOTO', guidance: 'Use for fit, drape, scale, real-wear behavior, outfit role, and risks. Do not override literal garment color/category from this styling context.' })
    }
    if (!photos.length) return res.status(404).json({ error: 'Photo file not found in uploads/' })

    const tags = await tagPieceWithProvider(photos)
    res.json(tags)
  } catch (err) {
    console.error('AI retag error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/tag-piece-claude/:id', async (req, res) => {
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(req.params.id)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })
    if (!piece.photo && !piece.worn_photo) return res.status(400).json({ error: 'This piece has no photo to tag' })

    const photos = []
    if (piece.photo) {
      const hangerPath = path.join(uploadsDir, piece.photo)
      if (fs.existsSync(hangerPath)) photos.push({ path: hangerPath, label: 'HANGER PHOTO', guidance: 'Use for literal garment truth: category, color, construction, pattern, fabric, and shape.' })
    }
    if (piece.worn_photo) {
      const wornPath = path.join(uploadsDir, piece.worn_photo)
      if (fs.existsSync(wornPath)) photos.push({ path: wornPath, label: 'WORN PHOTO', guidance: 'Use for fit, drape, scale, real-wear behavior, outfit role, and risks. Do not override literal garment color/category from this styling context.' })
    }
    if (!photos.length) return res.status(404).json({ error: 'Photo file not found in uploads/' })

    const tags = await tagPieceWithProvider(photos)
    res.json(tags)
  } catch (err) {
    console.error('AI retag error:', err)
    res.status(500).json({ error: err.message })
  }
})

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
router.post('/generate-outfits-for-piece', async (req, res) => {
  const { pieceId, occasion = 'casual', season = 'current season', question, history, includeMissingPieces = false, idealOnly = false } = req.body
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })

    const parsedPiece = parsePiece(piece)
    const idealMode = Boolean(includeMissingPieces || idealOnly || /ideal|missing|new ideas|do not have|don't have|dont have|not in my wardrobe|wish list|wardrobe gap/i.test(String(question || '')))
    const idealOnlyMode = Boolean(idealOnly || /new ideas|do not limit|not limited|not just my wardrobe|ignore wardrobe|conceptual/i.test(String(question || '')))
    const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
    let rankedCandidates = selectCandidatesForOutfitGeneration(parsedPiece, allPieces, 32, { occasion })
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
    if (!idealOnlyMode) {
      try {
        const visualReview = await withTimeout(rankSelectedPieceCandidatesWithVision({
          selectedPiece: parsedPiece,
          rankedCandidates,
          occasion,
          season,
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
    }

    const composed = await composeStructuredOutfitsForPiece({
      selectedPiece: parsedPiece,
      rankedCandidates,
      occasion,
      season,
      question,
      idealMode,
      idealOnlyMode,
      memoryText,
      history
    })

    let structuredOutfits = Array.isArray(composed.outfits) ? composed.outfits : []
    if (!structuredOutfits.length && !idealOnlyMode) {
      structuredOutfits = buildLocalFallbackOutfitDirections(parsedPiece, rankedCandidates, { occasion })
    }
    if (!structuredOutfits.length) {
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
        watchFor: 'Use this as a starting point; refine after seeing the actual garments together.'
      }, parsedPiece, [parsedPiece, ...candidates])]
    }
    const answer = formatStructuredOutfitFeedback({
      selectedPiece: parsedPiece,
      occasion,
      season,
      outfits: structuredOutfits,
      skip: composed.skip,
      saveableLearning: composed.saveableLearning
    })

    res.json({
      feedback: answer,
      structuredOutfits,
      rejectedOutfits: composed.rejected || [],
      provider: AI_PROVIDER,
      mode: idealOnlyMode ? 'ideal_new_ideas_only' : idealMode ? 'ideal_styling_directions' : 'generate_outfit_ideas',
      pipeline: idealOnlyMode ? 'composer_evaluator_renderer_handoff' : 'visual_candidate_reviewer_composer_evaluator_renderer_handoff',
      idealMode,
      idealOnlyMode,
      debug: {
        visualCritic: visualCriticDebug
      }
    })
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
  const {
    occasion = 'casual',
    season = 'current season',
    mood = '',
    limit = 5,
    explorationMode = 'moderate'
  } = req.body || {}

  try {
    const routeStartedAt = Date.now()
    const requestedLimit = Math.max(1, Math.min(5, Number(limit) || 5))
    const moodProfile = wholeWardrobeMoodProfile(mood)
    const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
    const { allowedPieces, suppressedPieces } = filterWholeWardrobePiecesForGeneration(allPieces, { occasion, explorationMode })
    const wholeWardrobeFeedbackInfluence = buildWholeWardrobeFeedbackInfluence()
    const sessionInfluence = getRecentWholeWardrobeSessionInfluence({ occasion, daysCutoff: 6 })
    let candidates = buildWholeWardrobeCandidateOutfits(allowedPieces, { occasion, season, mood, explorationMode, wholeWardrobeFeedbackInfluence, sessionInfluence })
    const candidateFormulaCounts = wholeWardrobeCandidateFormulaCounts(candidates)
    let candidatePieceIds = [...new Set(candidates.flatMap(c => c.pieceIds || []))]
    const candidatePieces = candidatePieceIds
      .map(id => allPieces.find(p => Number(p.id) === Number(id)))
      .filter(Boolean)
    const confirmedOutfitsText = getConfirmedOutfitMemory(10)
    const globalFeedbackText = getStylistFeedbackMemory(null, null, 24)
    const wholeWardrobeFeedbackText = getWholeWardrobeFeedbackMemory(28)
    const globalSavedBoardText = getSavedBoardMemory(null, null, 16)
    const calibrationMemoryText = getCalibrationMemoryForStylist(32)
    const requireShoes = allPieces.some(p => wardrobeCategoryGroup(p) === 'shoes')
    const requireDress = allPieces.some(p => wardrobeCategoryGroup(p) === 'dress')
    const requireNonGraphicTop = allPieces.some(p => wardrobeCategoryGroup(p) === 'top' && !/\b(floral|print|graphic|stripe|striped|pattern|abstract|tapestry)\b/.test(pieceNameBlob(p)))
    const timings = {
      candidateBuildMs: Date.now() - routeStartedAt
    }

    const memoryText = [
      confirmedOutfitsText ? `Confirmed/favorite outfit memory:\n${confirmedOutfitsText}` : '',
      globalSavedBoardText ? `Saved visual board memory. Use strongly boards should bias ranking:\n${globalSavedBoardText}` : '',
      calibrationMemoryText ? `Calibration Library memory. Higher authority than broad style theory:\n${calibrationMemoryText}` : '',
      wholeWardrobeFeedbackText ? `Whole-wardrobe outfit feedback. This is direct ranking/correction memory for this feature:\n${wholeWardrobeFeedbackText}` : '',
      globalFeedbackText ? `General saved stylist feedback memory:\n${globalFeedbackText}` : ''
    ].filter(Boolean).join('\n\n')
    const rotationWarningsText = sessionInfluence.pieceRecency?.size
      ? `Recently worn garments (try to avoid using these to rotate wardrobe unless necessary):\n${[...sessionInfluence.pieceRecency.keys()]
          .map(id => allPieces.find(p => Number(p.id) === Number(id))?.name)
          .filter(Boolean)
          .join(', ')}`
      : ''

    const suppressedListText = suppressedPieces.length
      ? `Suppressed garments (DO NOT pair or use these for the occasion "${occasion}"):\n${suppressedPieces.map(p => `- ${p.name} (id: ${p.id})`).join('\n')}`
      : ''

    const initialUserMessageText = [
      `Occasion: ${occasion || 'casual'}`,
      `Season: ${season || 'current season'}`,
      `Mood: ${mood || 'artistic minimalist'}`,
      moodProfile ? `Mood guidance:\n${moodProfile.guidance}` : '',
      `Target count: ${requestedLimit} outfits.`,
      rotationWarningsText,
      suppressedListText,
      `Memory & preferences:\n${memoryText}`,
      '',
      `Please search the wardrobe and inspect matching pieces to design up to ${requestedLimit} outfits. Output your final turn response as a JSON object matching the requested schema.`
    ].filter(Boolean).join('\n\n')

    let parsed = {}
    let composerError = null
    let visualCriticDebug = null
    const agentStartedAt = Date.now()

    try {
      const raw = await withTimeout(askStylistWithTools({
        system: WHOLE_WARDROBE_AGENT_SYSTEM,
        messages: [{ role: 'user', content: initialUserMessageText }],
        maxTokens: 3000
      }), 65000, 'Whole-wardrobe agent stylist')

      timings.agentStylistMs = Date.now() - agentStartedAt
      parsed = safeJsonFromModel(raw)
      visualCriticDebug = { notes: "Executed via dynamic tool-calling stylist agent." }
    } catch (err) {
      console.warn('Whole-wardrobe agent fallback:', err.message)
      composerError = err.message
      timings.agentStylistMs = timings.agentStylistMs || null
    }

    const aiReturnedCount = Array.isArray(parsed?.outfits) ? parsed.outfits.length : 0
    const resolvedOutfits = (Array.isArray(parsed?.outfits) ? parsed.outfits : []).map(outfit => {
      const outfitPieceIds = Array.isArray(outfit.pieceIds) ? outfit.pieceIds.map(Number) : []
      const ownedPieces = outfitPieceIds.map(id => allPieces.find(p => Number(p.id) === id)).filter(Boolean)
      return {
        ...outfit,
        pieceIds: outfitPieceIds,
        pieces: ownedPieces
      }
    })

    let structuredOutfits = resolvedOutfits.map(o => repairWholeWardrobeOutfit(normalizeWholeWardrobeOutfitObject(o, allPieces), allPieces, occasion, mood))
    const localBackfillOutfits = wholeWardrobeOutfitsFromCandidates(candidates, allPieces, { occasion, mood })

    if (!structuredOutfits.length) {
      structuredOutfits = localBackfillOutfits.slice(0, Math.max(requestedLimit, 8))
    }

    let diversityRejectedCount = 0
    let gated = locallyGateWholeWardrobeOutfits(
      [...structuredOutfits, ...localBackfillOutfits],
      requestedLimit,
      { requireShoes, requireDress, requireNonGraphicTop, candidatePieces: allPieces, occasion, mood }
    )
    diversityRejectedCount += gated.rejected?.length || 0
    structuredOutfits = gated.outfits
    if (!structuredOutfits.length) {
      structuredOutfits = locallyGateWholeWardrobeOutfits(
        localBackfillOutfits.slice(0, Math.max(requestedLimit, 12)),
        requestedLimit,
        { requireShoes, requireDress, requireNonGraphicTop, candidatePieces: allPieces, occasion, mood }
      ).outfits
    }
    const formulaFamiliesReturned = [...new Set(structuredOutfits.map(outfit => outfit.formulaFamily || wholeWardrobeFormulaFamily(outfit, allPieces, occasion)).filter(Boolean))]
    const archetypeCounts = structuredOutfits.reduce((counts, outfit) => {
      const id = outfit.archetypeId || wholeWardrobeArchetypeFor(outfit, allPieces, occasion).archetypeId
      counts[id] = (counts[id] || 0) + 1
      return counts
    }, {})
    saveWholeWardrobeSession({ occasion, outfits: structuredOutfits })

    const feedback = formatWholeWardrobeOutfitFeedback({
      occasion,
      season,
      mood,
      outfits: structuredOutfits,
      skip: parsed.skip || '',
      saveableLearning: parsed.saveableLearning || ''
    })

    res.json({
      feedback,
      structuredOutfits,
      rejectedOutfits: [...(parsed.rejected || []), ...(gated.rejected || [])],
      provider: AI_PROVIDER,
      mode: 'generate_wardrobe_outfits',
      pipeline: 'whole_wardrobe_composer_evaluator',
      debug: {
        candidateCount: candidates.length,
        candidateFormulaCounts,
        feedbackInfluenceRowsUsed: wholeWardrobeFeedbackInfluence.rowsUsed,
        sessionMemory: {
          recentSessionCount: sessionInfluence.sessionCount || 0,
          piecePenaltyCount: sessionInfluence.pieceRecency?.size || 0,
          formulaPenaltyCount: sessionInfluence.formulaRecency?.size || 0
        },
        suppressedPieceCount: suppressedPieces.length,
        suppressedPieces,
        visualCritic: visualCriticDebug,
        composerError,
        timings,
        archetypeCounts,
        formulaFamiliesReturned,
        locallyGeneratedCount: localBackfillOutfits.length,
        aiReturnedCount,
        finalReturnedCount: structuredOutfits.length,
        diversityRejectedCount
      }
    })
  } catch (err) {
    console.error('Generate whole-wardrobe outfits error:', err)
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
    const rankedCandidates = selectCandidatesForOutfitGeneration(selectedPiece, allPieces, 48, { occasion })
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
  const { outfits = [], occasion = 'casual', season = 'current season' } = req.body || {}
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

    const rendered = await createWholeWardrobeComparisonSheetImage({ outfits: normalizedOutfits, piecesById, occasion, season })
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
  const { pieceId, occasion = 'casual', season = 'current season', question, history, seedLook } = req.body
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

    const imageUrl = await createEditorialConceptImage({
      selectedPiece,
      direction,
      index: 1,
      occasion,
      season
    })

    res.json({
      imageUrl,
      label: direction.title || 'Rendered direction',
      missingPieces: direction.missingPieces || [],
      reason: direction.reason || '',
      watchFor: direction.watchFor || '',
      mode: 'editorial_render_one'
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
      const imageUrl = await createEditorialConceptImage({ selectedPiece, direction, index: idx + 1, occasion, season })
      visuals.push({
        label: direction.title || `Ideal direction ${idx + 1}`,
        reason: direction.reason || '',
        watchFor: direction.watchFor || '',
        missingPieces: Array.isArray(direction.missingPieces) ? direction.missingPieces : [],
        imageUrl,
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
      const imageUrl = await createCalibrationConceptImage({ selectedPiece, variation, index: idx + 1, occasion, season })
      visuals.push({
        label: `${variation.variation || String.fromCharCode(65 + idx)} · ${variation.title || 'Calibration variation'}`,
        variation: variation.variation || String.fromCharCode(65 + idx),
        silhouetteLabel: variation.silhouetteLabel || '',
        reason: variation.reason || '',
        watchFor: variation.watchFor || '',
        missingPieces: variation.missingPieces || [],
        imageUrl,
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
    const payload = await buildStylistConversationPayload(req.body)
    const answer = await askStylistWithTools(payload)
    res.json({ answer, provider: AI_PROVIDER })
  } catch (err) {
    console.error('AI error:', err)
    res.status(500).json({ error: err.message })
  }
})

// Helper to build piece text blob formatted identically to rules.js/buildPieceText
function buildPieceText(p) {
  if (!p) return ''
  const colors = Array.isArray(p.colors) ? p.colors : []
  const occasions = Array.isArray(p.occasions) ? p.occasions : []
  const permissions = Array.isArray(p.occasion_permissions) ? p.occasion_permissions : []
  const rules = Array.isArray(p.styling_rules_learned) ? p.styling_rules_learned : []
  const pairs = Array.isArray(p.pairs_well_with) ? p.pairs_well_with : []
  const rejected = Array.isArray(p.tried_and_rejected) ? p.tried_and_rejected : []

  const parts = [
    `Garment: "${p.name}" (id: ${p.id})`,
    `Category: ${p.category}`,
    colors.length ? `Colors: ${colors.join(', ')}` : '',
    p.background_color ? `Background color: ${p.background_color}` : '',
    p.reads_as ? `Dominant visual impression: ${p.reads_as}` : '',
    occasions.length ? `Occasions: ${occasions.join(', ')}` : '',
    p.season ? `Season: ${p.season}` : '',
    p.pattern_type ? `Pattern: ${p.pattern_type} (${p.pattern_scale || 'none'} scale, ${p.pattern_complexity || 'solid'} complexity)` : '',
    p.silhouette ? `Silhouette: ${p.silhouette}` : '',
    p.fabric_category ? `Fabric: ${p.fabric_category} (${p.fabric_weight || 'medium'} weight)` : '',
    p.fit_on_body ? `On-body fit: ${p.fit_on_body}` : '',
    p.tuck_behavior ? `Tuck behavior: ${p.tuck_behavior}` : '',
    p.waistband_type ? `Waistband: ${p.waistband_type}` : '',
    p.notes ? `Styling notes: ${p.notes}` : '',
    p.engine_notes ? `Engine warnings: ${p.engine_notes}` : '',
    p.recommendation_status ? `Recommendation trust: ${p.recommendation_status}` : '',
    p.fit_confidence ? `Fit confidence: ${p.fit_confidence}` : '',
    p.role_permission ? `Styling permissions: role permission is \&apos;${p.role_permission}\&apos;${permissions.length ? ', occasion exclusions are ' + permissions.join(', ') : ''}` : '',
    rules.length ? `RULES (authoritative): ${rules.join(' | ')}` : '',
    pairs.length ? `PAIRS WITH: ${pairs.join(', ')}` : '',
    rejected.length ? `REJECTED: ${rejected.join(' | ')}` : ''
  ].filter(Boolean)
  return parts.join('\n')
}

export default router
