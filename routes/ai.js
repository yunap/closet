import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import OpenAI, { toFile } from 'openai'
import { db, uploadsDir, safeJsonParse, parsePiece } from '../db.js'
import { applyTaggerResult, normalizeConfidenceMap, normalizePhotoProperties, tagStateForTaggerResult } from '../styling-engine/taggerMerge.js'

import {
  prepareImageForClaude,
  prepareWardrobeThumb,
  contentToOpenAI,
  askStylist,
  askStylistWithTools,
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
  WHOLE_WARDROBE_AGENT_SYSTEM,
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
import { pieceMatchesMaterial, pieceMatchesFootwear } from '../styling-engine/attributes.js'

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

function formatCoverageNote(topCoverage, shoeCoverage) {
  let limitedSlots = []
  if (topCoverage !== null && topCoverage < 5) limitedSlots.push('tops')
  if (shoeCoverage !== null && shoeCoverage < 3) limitedSlots.push('footwear')
  
  if (limitedSlots.length > 0) {
    const slotsText = limitedSlots.join(' and ')
    return `Your wardrobe has limited trail-specific ${slotsText} — these are the closest matches. Explore Additions can suggest trail-ready pieces if you want to fill the gap.`
  }
  return ''
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
  if (!idealOnlyMode) {
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
  }

  const composed = await composeStructuredOutfitsForPiece({
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
    pipeline: idealOnlyMode ? 'composer_evaluator_renderer_handoff' : 'visual_candidate_reviewer_composer_evaluator_renderer_handoff',
    idealMode,
    idealOnlyMode,
    debug: {
      visualCritic: visualCriticDebug,
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

export async function generateWholeWardrobeOutfitsInternal({
  occasion = 'casual',
  season = 'current season',
  mood = '',
  mission = 'mix',
  limit = 5,
  explorationMode = 'moderate',
  question = '',
  activity = ''
}) {
  const routeStartedAt = Date.now()
  const requestedLimit = Math.max(1, Math.min(5, Number(limit) || 5))
  const moodProfile = wholeWardrobeMoodProfile(mood)
  const weatherProfile = weatherProfileFromContext({ mood, season })
  const occasionProfile = resolveOccasionProfile(occasion, mood)
  const activityProfile = resolveActivityProfile({ activity, occasion, mood, request: question })
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
      ...(occasionProfile.rules?.discouraged_footwear_warm || []),
      ...(occasionProfile.rules?.discouraged_pieces || [])
    ].join(', ')
    
    occasionProfileGuidance = `OCCASION PROFILE — ${occasionProfile.label}:
Vibe: ${occasionProfile.vibe}
Lean toward: ${preferred}
Use sparingly and justify in watchFor if chosen: ${discouraged}
(Hard-prohibited pieces have already been removed from your searchable wardrobe.)`
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
    
    const activityText = `ACTIVITY PROFILE — ${activityProfile.label}:
Vibe: ${activityProfile.vibe || 'movement-focused'}
Lean toward: ${preferred}
Use sparingly and justify in watchFor if chosen: ${discouraged}
(Hard-prohibited pieces have already been removed from your searchable wardrobe.)`

    occasionProfileGuidance = occasionProfileGuidance
      ? `${occasionProfileGuidance}\n\n${activityText}`
      : activityText
  }

  const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
  const { allowedPieces, suppressedPieces } = filterWholeWardrobePiecesForGeneration(allPieces, { occasion, explorationMode, weatherProfile, mood, activity })
  const wholeWardrobeFeedbackInfluence = buildWholeWardrobeFeedbackInfluence()
  const sessionInfluence = getRecentWholeWardrobeSessionInfluence({ occasion, daysCutoff: 6 })
  
  // Choose active missions for this generation run
  const activeMissions = (mission && mission !== 'mix')
    ? [mission]
    : ['controlled_print', 'monochrome_texture', 'structured_soft', 'color_anchor', 'unexpected_pairing']
  const activeMissionsText = OUTFIT_MISSIONS
    .filter(m => activeMissions.includes(m.id))
    .map(m => `- ${m.label} (missionId: "${m.id}"): ${m.description}`)
    .join('\n')

  const comfortConstraint = resolveComfortFootwearConstraint({ occasion, mood, request: question, activity })
  if (comfortConstraint) {
    const walkingGuidance = comfortConstraint.reason === 'all-day walking comfort'
      ? "All-day walking: avoid stilettos, high heels, pumps, and delicate sandals; prefer low block heels, loafers, flats, sneakers."
      : "Hiking/Outdoor active: avoid heels, wedges, dress shoes, delicate sandals, mules, and sandals; require sneakers, athletic shoes, or flat rugged boots."
    occasionProfileGuidance = occasionProfileGuidance
      ? `${occasionProfileGuidance}\n${walkingGuidance}`
      : walkingGuidance
  }

  let candidates = buildWholeWardrobeCandidateOutfits(allowedPieces, { occasion, season, mood, explorationMode, wholeWardrobeFeedbackInfluence, sessionInfluence, activeMissions, comfortConstraint })
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

  const candidateText = candidates.slice(0, 25).map((c, idx) => {
    const pStr = c.pieces.map(p => `${p.id}: ${p.name} (${p.category})`).join(' + ')
    return `${idx + 1}. [Candidate ID: ${c.candidateId}] [Mission: ${c.missionLabel} (missionId: "${c.missionId}")] Pieces: ${pStr}\n   Visual logic: ${c.localReasons?.join('; ') || ''}`
  }).join('\n\n')

  let weatherConstraintsBlock = ''
  if (weatherProfile.isHot) {
    weatherConstraintsBlock = "WEATHER CONSTRAINTS (hard): it is very hot outside. The searchable wardrobe has already been filtered for weather validity. Prefer lightweight fabrics and breathable cuts; do not add layers or outerwear unless the user asked; if you consider a medium-weight piece (denim, ponte), justify it in watchFor."
  } else if (weatherProfile.isCold) {
    weatherConstraintsBlock = "WEATHER CONSTRAINTS (hard): it is very cold outside. The searchable wardrobe has already been filtered for weather validity. Prefer warmer fabrics and appropriate coverage; do not use shorts or extremely bare cuts."
  }

  const initialUserMessageText = [
    `Occasion: ${occasion || 'casual'}`,
    `Season: ${season || 'current season'}`,
    `Mood: ${mood || 'artistic minimalist'}`,
    activity && activity !== 'none' ? `Activity: ${activity}` : '',
    occasionProfileGuidance || '',
    moodProfile ? `Mood guidance:\n${moodProfile.guidance}` : '',
    `Active Outfit Missions (every outfit you design MUST be mapped to one of these missions, specifying the "missionId" field in the JSON response):\n${activeMissionsText}`,
    `Target count: ${requestedLimit} outfits.`,
    rotationWarningsText,
    suppressedListText,
    weatherConstraintsBlock,
    `Candidate Combinations (prioritize choosing and refining outfits from these pre-sorted candidates, preserving their exact garment IDs and "missionId" fields):\n\n${candidateText}`,
    `Memory & preferences:\n${memoryText}`,
    '',
    `Please review the candidate combinations list, retrieve garment details to inspect their images, and design up to ${requestedLimit} outfits by choosing from the candidate list or building them. Map each outfit to its correct "missionId" in the JSON response.`
  ].filter(Boolean).join('\n\n')

  let parsed = {}
  let composerError = null
  let visualCriticDebug = null
  const agentStartedAt = Date.now()
  const toolContext = { allowedPieceIds: new Set(allowedPieces.map(p => Number(p.id))) }
  try {
    const { answer: raw } = await withTimeout(askStylistWithTools({
      system: `${WHOLE_WARDROBE_AGENT_SYSTEM}\n\nOCCASION & CLIMATE PROFILES (RULES-AS-DATA):\n${JSON.stringify(OCCASION_PROFILES, null, 2)}`,
      messages: [{ role: 'user', content: initialUserMessageText }],
      maxTokens: 3000,
      toolContext
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

  let structuredOutfits = resolvedOutfits.map(o => {
    const normalized = normalizeWholeWardrobeOutfitObject(o, allPieces)
    
    if (mission && mission !== 'mix') {
      normalized.missionId = mission
      const activeMission = OUTFIT_MISSIONS.find(m => m.id === mission)
      normalized.missionLabel = activeMission ? activeMission.label : null
    } else {
      let bestMissionId = 'unexpected_pairing'
      let bestScore = -Infinity
      const allMissionsList = ['controlled_print', 'monochrome_texture', 'structured_soft', 'color_anchor', 'unexpected_pairing']
      for (const mId of allMissionsList) {
        const scored = scoreWholeWardrobeCandidate(normalized.pieces, { activeMissionId: mId, occasion })
        if (scored.score > bestScore) {
          bestScore = scored.score
          bestMissionId = mId
        }
      }
      normalized.missionId = bestMissionId
      const activeMission = OUTFIT_MISSIONS.find(m => m.id === bestMissionId)
      normalized.missionLabel = activeMission ? activeMission.label : null
    }
    
    return repairWholeWardrobeOutfit(normalized, allPieces, occasion, mood, { season, weatherProfile, activity })
  })
  const localBackfillOutfits = wholeWardrobeOutfitsFromCandidates(candidates, allPieces, { occasion, mood, season, weatherProfile, activity })

  if (!structuredOutfits.length) {
    structuredOutfits = localBackfillOutfits.slice(0, Math.max(requestedLimit, 8))
  }

  let diversityRejectedCount = 0
  let gated = locallyGateWholeWardrobeOutfits(
    [...structuredOutfits, ...localBackfillOutfits],
    requestedLimit,
    { requireShoes, requireDress, requireNonGraphicTop, candidatePieces: allPieces, occasion, mood, season, weatherProfile, activity }
  )
  diversityRejectedCount += gated.rejected?.length || 0
  structuredOutfits = gated.outfits
  if (!structuredOutfits.length) {
    structuredOutfits = locallyGateWholeWardrobeOutfits(
      localBackfillOutfits.slice(0, Math.max(requestedLimit, 12)),
      requestedLimit,
      { requireShoes, requireDress, requireNonGraphicTop, candidatePieces: allPieces, occasion, mood, season, weatherProfile, activity }
    ).outfits
  }

  if (comfortConstraint) {
    structuredOutfits = structuredOutfits.map(o => applyComfortFootwearRepair(o, allPieces, comfortConstraint, { weatherProfile, occasion, mood, activity }))
  }
  const formulaFamiliesReturned = [...new Set(structuredOutfits.map(outfit => outfit.formulaFamily || wholeWardrobeFormulaFamily(outfit, allPieces, occasion)).filter(Boolean))]
  const archetypeCounts = structuredOutfits.reduce((counts, outfit) => {
    const id = outfit.archetypeId || wholeWardrobeArchetypeFor(outfit, allPieces, occasion).archetypeId
    counts[id] = (counts[id] || 0) + 1
    return counts
  }, {})
  saveWholeWardrobeSession({ occasion, outfits: structuredOutfits })

  const { topCoverage, shoeCoverage } = computeWardrobeCoverage(allowedPieces, occasionProfile, activityProfile)

  let feedback = formatWholeWardrobeOutfitFeedback({
    occasion,
    season,
    mood,
    outfits: structuredOutfits,
    skip: parsed.skip || '',
    saveableLearning: parsed.saveableLearning || ''
  })

  const coverageNote = formatCoverageNote(topCoverage, shoeCoverage)
  if (coverageNote) {
    feedback = feedback + '\n\n' + coverageNote
  }

  return {
    feedback,
    structuredOutfits,
    rejectedOutfits: [...(parsed.rejected || []), ...(gated.rejected || [])],
    provider: AI_PROVIDER,
    mode: 'generate_wardrobe_outfits',
    pipeline: 'whole_wardrobe_composer_evaluator',
    debug: {
      profileCoverage: {
        tops: topCoverage,
        shoes: shoeCoverage
      },
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
      diversityRejectedCount,
      agentPickedSuppressedCount: (() => {
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

router.post('/generate-wardrobe-outfits', async (req, res) => {
  try {
    const result = await generateWholeWardrobeOutfitsInternal(req.body)
    res.json(result)
  } catch (err) {
    console.error('Generate whole-wardrobe outfits error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/generate-wardrobe-outfits-visual', async (req, res) => {
  const {
    occasion = 'casual',
    season = 'current season',
    mood = '',
    limit = 5,
    activity = ''
  } = req.body || {}

  try {
    const routeStartedAt = Date.now()
    const requestedLimit = Math.max(1, Math.min(5, Number(limit) || 5))
    const weatherProfile = weatherProfileFromContext({ mood, season })
    const occasionProfile = resolveOccasionProfile(occasion, mood)
    const activityProfile = resolveActivityProfile({ activity, occasion, mood, request: req.body.request || req.body.question || '' })
    const comfortConstraint = resolveComfortFootwearConstraint({
      occasion,
      mood,
      request: req.body.request || req.body.question || '',
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
        ? "All-day walking: avoid stilettos, high heels, pumps, and delicate sandals; prefer low block heels, loafers, flats, sneakers."
        : "Hiking/Outdoor active: avoid heels, wedges, dress shoes, delicate sandals, mules, and sandals; require sneakers, athletic shoes, or flat rugged boots."
      occasionProfileGuidance = occasionProfileGuidance
        ? `${occasionProfileGuidance}\n${walkingGuidance}`
        : walkingGuidance
    }
    const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)

    // Reuse existing suppression filter (hard filter here — suppressed pieces are simply not shown)
    const { allowedPieces, suppressedPieces } =
      filterWholeWardrobePiecesForGeneration(allPieces, { occasion, explorationMode: 'moderate', weatherProfile, mood, activity })

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
    for (const group of grouped.keys()) {
      const pieces = grouped.get(group)
      if (!pieces?.length) continue
      content.push({ type: 'text', text: `=== ${group.toUpperCase()}S ===` })
      for (const p of pieces) {
        const photoFile = p.worn_photo || p.photo || ''
        if (!photoFile) continue
        const filePath = path.join(uploadsDir, photoFile)
        if (!fs.existsSync(filePath)) continue
        const thumb = await prepareWardrobeThumb(filePath, `${p.id}:${photoFile}`)
        content.push({ type: 'text', text: `ID ${p.id}: ${p.name}` })
        content.push({ type: 'image', detail: 'low', source: { type: 'base64', media_type: thumb.media_type, data: thumb.data } })
        shownPieceCount++
      }
    }
    const timings = { thumbPrepMs: Date.now() - routeStartedAt }

    // Single model call — no tools
    let parsed = {}
    let composerError = null
    const composerStartedAt = Date.now()
    try {
      const raw = await withTimeout(askStylist({
        system: `${WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM}\n\nOCCASION & CLIMATE PROFILES (RULES-AS-DATA):\n${JSON.stringify(OCCASION_PROFILES, null, 2)}\n\nACTIVITY PROFILES (RULES-AS-DATA):\n${JSON.stringify(ACTIVITY_PROFILES, null, 2)}`,
        maxTokens: 2200,
        messages: [{ role: 'user', content }]
      }), 90000, 'Visual wardrobe composer')
      timings.composerMs = Date.now() - composerStartedAt
      parsed = safeJsonFromModel(raw)
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

    let structuredOutfits = resolved.map(o =>
      repairWholeWardrobeOutfit(normalizeWholeWardrobeOutfitObject(o, allowedPieces), allowedPieces, occasion, mood, { season, weatherProfile, activity }))
      .filter(o => isOutfitStructurallyValid(o.pieces, { requireShoes: true }))

    if (!structuredOutfits.length) {
      console.log(`    - Visual Composer AI returned 0 structurally valid outfits. Falling back to local candidate generation.`)
      const candidates = buildWholeWardrobeCandidateOutfits(allowedPieces, { occasion, season, mood, activity })
      const localBackfillOutfits = wholeWardrobeOutfitsFromCandidates(candidates, allowedPieces, { occasion, mood, season, weatherProfile, activity })
      
      const gatedFallback = locallyGateWholeWardrobeOutfits(
        localBackfillOutfits,
        requestedLimit,
        { requireShoes: true, candidatePieces: allowedPieces, occasion, mood, season, weatherProfile, activity }
      )
      structuredOutfits = gatedFallback.outfits
    }

    if (comfortConstraint) {
      structuredOutfits = structuredOutfits.map(o => applyComfortFootwearRepair(o, allowedPieces, comfortConstraint, { weatherProfile, occasion, mood, activity }))
    }

    // Light gating only: completeness + dedupe. Do NOT apply formula diversity caps here —
    // the prompt owns diversity in this workflow. Mission labeling stays post-generation:
    structuredOutfits = structuredOutfits.slice(0, requestedLimit).map(outfit => {
      // Dynamic labeling: score the combination across all missions to assign the highest-scoring one
      let bestMissionId = 'unexpected_pairing'
      let bestScore = -Infinity
      const allMissionsList = ['controlled_print', 'monochrome_texture', 'structured_soft', 'color_anchor', 'unexpected_pairing']
      for (const mId of allMissionsList) {
        const scored = scoreWholeWardrobeCandidate(outfit.pieces, { activeMissionId: mId, occasion, mood, activity })
        if (scored.score > bestScore) {
          bestScore = scored.score
          bestMissionId = mId
        }
      }
      const activeMission = OUTFIT_MISSIONS.find(m => m.id === bestMissionId)
      return {
        ...outfit,
        formulaFamily: outfit.formulaFamily || wholeWardrobeFormulaFamily(outfit, allowedPieces, occasion),
        missionId: bestMissionId,
        missionLabel: activeMission ? activeMission.label : null
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

    const coverageNote = formatCoverageNote(topCoverage, shoeCoverage)
    if (coverageNote) {
      feedback = feedback + '\n\n' + coverageNote
    }

    res.json({
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
        composerError,
        timings,
        rosterCount: roster.length,
        excludedCounts: rosterDebug.excludedCounts,
        excluded,
        agentPickedSuppressedCount: (() => {
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
    })
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
    const toolContext = {
      generatedOutfits: [],
      source: 'whole_wardrobe',
      occasion: 'casual',
      season: 'current season',
      mood: '',
      mission: 'mix',
      activity: req.body.activity || '',
      question: req.body.question || ''
    }
    const payload = await buildStylistConversationPayload(req.body)
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
      structuredOutfitsActivity: toolContext.activity
    })
  } catch (err) {
    console.error('AI error:', err)
    res.status(500).json({ error: err.message })
  }
})

export default router
