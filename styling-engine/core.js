import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import OpenAI, { toFile } from 'openai'
import { db, uploadsDir, safeJsonParse } from '../db.js'

import {
  OUTFIT_COMPOSER_SYSTEM,
  OUTFIT_EVALUATOR_GATE_SYSTEM,
  EDITORIAL_NEW_PIECES_SYSTEM,
  RENDERER_CALIBRATION_SYSTEM,
  WHOLE_WARDROBE_EVALUATOR_SYSTEM,
  STYLIST_SYSTEM,
  COMPARE_OUTFITS_SYSTEM,
  EXPRESSIVE_HIERARCHY_RULES,
  VISUAL_SUPPORT_CRITIC_SYSTEM,
  VISUAL_WARDROBE_CRITIC_SYSTEM,
  EDITORIAL_IMAGE_BASE_PROMPT,
  EDITORIAL_IMAGE_SUBJECT_PROMPT,
  EDITORIAL_IMAGE_SHOES_RULE,
  EDITORIAL_IMAGE_REALISM_RULE,
  BODY_CONTRACT,
  PROVEN_FORMULAS,
  AESTHETIC_GRAVITY,
  LANE_NEUTRALITY
} from './prompts.js'

import {
  askStylist,
  askStylistWithTools,
  prepareImageForClaude,
  AI_PROVIDER,
  ACTIVE_STYLIST_MODEL
} from './provider.js'

import { OCCASION_PROFILES, resolveOccasionProfile } from './occasions.js'

import {
  parsePiece,
  buildPieceText,
  wardrobeCategoryGroup,
  categoryConstraintForSelectedPiece,
  idealAdditionAnchorConstraint,
  getWholeWardrobeFeedbackMemory,
  getSavedBoardMemory,
  wholeWardrobeFeedbackInfluenceForCandidate,
  wholeWardrobePieceBucket,
  wholeWardrobePieceTrustDecision,
  wholeWardrobeMoodProfile,
  wholeWardrobeBohoSignalScore,
  wholeWardrobeMissesMood,
  inferOutfitArchetype,
  wholeWardrobeFormulaFamily,
  wholeWardrobeFormulaType,
  wholeWardrobeArchetypeFor,
  wholeWardrobeFullPieces,
  wholeWardrobePieceByGroup,
  wholeWardrobeHeroPieceId,
  wholeWardrobeIsExploratory,
  wholeWardrobeHasPrintOrStripe,
  wholeWardrobeHasGraphicTop,
  wholeWardrobeHasNonGraphicTop,
  wholeWardrobeHasDress,
  wholeWardrobeTopBottomKey,
  wholeWardrobeDirectionFromPieces,
  wholeWardrobeSilhouetteFromPieces,
  wholeWardrobeGroundingStrategy,
  wholeWardrobeShoeShape,
  wholeWardrobeVisualRhythm,
  pieceTextBlob,
  pieceNameBlob,
  pieceStyleProfile,
  normalizeStyleProfileList,
  pieceGarmentIntelligence,
  inferWholeWardrobePieceRoles,
  inferWholeWardrobeOutfitRoles,
  occasionBiasForArchetype,
  occasionScoreForOutfit,
  selectDiverseWholeWardrobeCandidates,
  wholeWardrobeCandidateAxes,
  wholeWardrobeCandidateFormulaCounts,
  wholeWardrobeCandidateText,
  buildWholeWardrobeCandidateOutfits,
  normalizeWholeWardrobeOutfitObject,
  candidateObjectFromPieces,
  scoreWholeWardrobeCandidate,
  optionalLayerCoherenceIssue,
  textIncludesAny,
  visualWeightProfile,
  buildVisualWeightText,
  hasPairingReference,
  hasRejectedReference,
  collectPieceIdsFromFeedbackPayload,
  feedbackWeight,
  getFeedbackInfluenceForPair,
  buildGoldStandardFeedbackMemory,
  collectPieceIdsFromSavedBoardRow,
  getSavedBoardInfluenceForPair,
  explicitOccasionsForPiece,
  profileOccasionConfidence,
  pieceMatchesOccasion,
  styleLaneScore,
  garmentProfileText,
  compatibilityScoreForSelectedItem,
  rankedComplementaryWardrobeFor,
  complementaryWardrobeFor,
  buildRankedCandidateText,
  selectCandidatesForOutfitGeneration,
  buildOutfitGenerationCandidateText,
  getOutfitsForPieceMemory,
  getStylistFeedbackMemory,
  buildWholeWardrobeFeedbackInfluence,
  saveWholeWardrobeSession,
  getRecentWholeWardrobeSessionInfluence,
  mergeStyleProfilePatch,
  outfitStylisticStrengthScore,
  sortByStylisticStrength
} from './rules.js'

// ── Basic helper/utility functions ───────────────────────────────────────────
export function safeJsonFromModel(raw) {
  const text = String(raw || '').trim().replace(/^```json\n?|\n?```$/g, '').trim()
  try { return JSON.parse(text) } catch {}
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Model did not return JSON')
  return JSON.parse(match[0])
}

export function withTimeout(promise, ms, label = 'operation') {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function escapeSvgText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function wrapLabel(value, max = 22) {
  const words = String(value || '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > max && line) { lines.push(line); line = word }
    else line = next
  }
  if (line) lines.push(line)
  return lines.slice(0, 2)
}

export function escapeXml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function normalizeCalibrationRow(row) {
  return {
    ...row,
    favorite: Boolean(row.favorite),
    archived: Boolean(row.archived),
    labels: safeJsonParse(row.labels, []) || []
  }
}

// ── Tuck and waistband rules calculation ─────────────────────────────────────
export function computeTuckNote(p) {
  if (!p.category || !['top','dress','outerwear'].includes(p.category)) return null
  if (p.tuck_behavior === 'wear_over_only') return 'no tuck — wear over only'
  if (p.fabric_category === 'silk' || p.fabric_category === 'satin') return 'no tuck — silk/satin cannot hold'
  if (p.hem_finish === 'ribbed' || p.hem_finish === 'design_hem') return 'no tuck — design hem'
  if (p.tuck_behavior === 'tucks_with_structure') return 'tucks with structured waist or belt only'
  if (p.tuck_behavior === 'tucks_anywhere') return 'tucks freely'
  return null
}

export function computeWaistbandNote(p) {
  if (p.category !== 'bottom') return null
  if (p.waistband_type === 'tight_no_room') return 'tight waistband — no tuck'
  if (p.waistband_type === 'soft_elastic_pull_on') return 'elastic waist — no tuck'
  if (p.waistband_type === 'structured_high_waist') return 'structured high waist — receives tuck'
  if (p.waistband_type === 'structured_mid_waist') return 'structured mid waist — receives tuck'
  if (p.waistband_type === 'drawstring_relaxed') return 'drawstring — no tuck'
  return null
}

export function buildCompactPieceText(p) {
  const parts = []
  const colors = Array.isArray(p.colors) ? p.colors : []

  if (p.reads_as) parts.push(`reads as: ${p.reads_as}`)
  else if (colors.length) parts.push(colors.join('/'))

  if (p.bottom_shape) parts.push(`shape: ${p.bottom_shape}`)
  if (p.silhouette) parts.push(`silhouette: ${p.silhouette}`)
  if (p.fabric_category) parts.push(`fabric: ${p.fabric_category}`)
  
  const tuck = computeTuckNote(p) || computeWaistbandNote(p)
  if (tuck) parts.push(tuck)

  if (Array.isArray(p.occasions) && p.occasions.length) parts.push(p.occasions.join(', '))
  if (p.recommendation_status && p.recommendation_status !== 'trusted') parts.push(`recommendation trust: ${p.recommendation_status}`)
  if (p.fit_confidence && p.fit_confidence !== 'unknown') parts.push(`fit: ${p.fit_confidence}`)
  if (p.engine_notes) parts.push(`engine note: ${p.engine_notes}`)

  let text = `• ${p.name} (${p.category} | ${parts.join(' | ')})`
  if (Array.isArray(p.styling_rules_learned) && p.styling_rules_learned.length) {
    text += `\n  RULES (authoritative): ${p.styling_rules_learned.join(' | ')}`
  }
  if (Array.isArray(p.tried_and_rejected) && p.tried_and_rejected.length) {
    text += `\n  REJECTED: ${p.tried_and_rejected.join(' | ')}`
  }
  if (Array.isArray(p.pairs_well_with) && p.pairs_well_with.length) {
    text += `\n  PAIRS WITH: ${p.pairs_well_with.join(', ')}`
  }
  return text
}

export function buildLinkedPieceFitCautions(pieces = []) {
  const cautionNotePattern = /\b(too small|too tight|does not fit|doesn't fit|bad fit|fit review|rides up|ride up|pulls|pulling|bunches|bunching|waist|high waist|sits too high|too high|low confidence)\b/i
  return pieces.map((piece) => {
    const cautions = []
    const status = String(piece.recommendation_status || 'trusted')
    const fit = String(piece.fit_confidence || 'unknown')
    const role = String(piece.role_permission || 'auto')

    if (status !== 'trusted') cautions.push(`recommendation trust: ${status}`)
    if (fit !== 'unknown') cautions.push(`fit confidence: ${fit}`)
    if (role !== 'auto') cautions.push(`auto-styling role: ${role}`)
    if (piece.engine_notes) cautions.push(`engine note: ${piece.engine_notes}`)
    if (piece.notes && cautionNotePattern.test(piece.notes)) cautions.push(`note: ${piece.notes}`)

    return cautions.length
      ? `- ${piece.name} (${piece.category}): ${cautions.join(' | ')}`
      : ''
  }).filter(Boolean).join('\n')
}

export function buildOutfitText(outfit, linkedPieces = []) {
  const lines = [
    `Outfit: "${outfit.name}"`,
    outfit.occasion ? `Occasion: ${outfit.occasion}` : '',
    outfit.season ? `Season: ${outfit.season}` : '',
    outfit.status ? `Status: ${outfit.status}` : '',
    outfit.notes ? `Styling notes: ${outfit.notes}` : '',
    linkedPieces.length ? `Linked garment truth:\n${linkedPieces.map(buildPieceText).join('\n')}` : 'Linked garment truth: none saved for this outfit yet'
  ].filter(Boolean)
  return lines.join('\n')
}

export function buildOutfitAuthorityNote(outfit, linkedPieces = [], likelyPieces = []) {
  const status = String(outfit.status || '').toLowerCase()
  const isConfirmed = status === 'confirmed' || Boolean(outfit.favorite)
  const lines = []

  if (linkedPieces.length) {
    lines.push('AUTHORITY NOTE: This outfit has linked garment records. Treat linked garment truth as higher authority than the image. Do not rename, replace, or visually reinterpret linked pieces unless the user explicitly says the record is wrong.')
  } else {
    lines.push('AUTHORITY NOTE: No linked garment records are saved for this outfit yet. Image/title analysis is lower confidence. Avoid strong garment-identity claims and avoid recommending replacement of core pieces based only on a visual guess.')
  }

  if (isConfirmed) {
    lines.push('STATUS NOTE: This outfit is marked confirmed/favorite. Start from the assumption that the core outfit has worked for Yuna. Explain WHY it works first. Suggest only minor refinements unless the user asks for alternatives.')
  } else if (status === 'rejected') {
    lines.push('STATUS NOTE: This outfit is marked rejected. Diagnose what likely failed, but keep the critique garment-focused and practical.')
  } else {
    lines.push('STATUS NOTE: This outfit appears to be testing/uncertain. Evaluate openly, but still prefer small adjustments before replacing garments.')
  }

  if (likelyPieces.length && !linkedPieces.length) {
    lines.push('LIKELY-PIECE NOTE: The app inferred possible saved pieces from the outfit name/notes. Use them cautiously as hints, not confirmed truth. If the answer depends on them, say that linking the actual pieces would improve precision.')
  }

  lines.push('MEMORY NOTE: If the outfit is confirmed, the Saveable learning should capture the formula that works. If it is testing/rejected, the Saveable learning should capture the condition or problem to remember.')
  return lines.join('\n')
}

export function getConfirmedOutfitMemory(limit = 8) {
  const outfits = db.prepare(`
    SELECT * FROM outfits
    WHERE status = 'confirmed' OR favorite = 1
    ORDER BY favorite DESC, date_added DESC
    LIMIT ?
  `).all(limit)

  return outfits.map(o => buildOutfitText(o, getLinkedPiecesForOutfit(o.id))).join('\n\n')
}

export function findLikelyPiecesForOutfit(outfit, limit = 12) {
  const text = `${outfit.name || ''} ${outfit.notes || ''}`.toLowerCase()
  const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active' ORDER BY favorite DESC, date_added DESC").all().map(parsePiece)
  const stop = new Set(['the','and','with','plus','outfit','look','top','pants','jeans','skirt','dress','shoes','boots','shirt','blouse','sweater','knit','sleeve','sleeves','casual','year','round'])
  const tokens = text.split(/[^a-z0-9]+/).filter(t => t.length > 2 && !stop.has(t))

  const scored = pieces.map(piece => {
    const hay = [
      piece.name, piece.category, piece.colors?.join(' '), piece.reads_as, piece.fabric_category,
      piece.silhouette, piece.notes, piece.pairs_well_with?.join(' '), piece.styling_rules_learned?.join(' ')
    ].filter(Boolean).join(' ').toLowerCase()
    let score = 0
    for (const t of tokens) if (hay.includes(t)) score += 3
    if (piece.favorite) score += 2
    if (text.includes('jeans') && /jean|denim/.test(hay)) score += 5
    if (text.includes('hoodie') && /hoodie|sweatshirt/.test(hay)) score += 5
    if (text.includes('knit') && /knit|sweater|crochet/.test(hay)) score += 3
    if (text.includes('sleeve') && /sleeve/.test(hay)) score += 3
    if (text.includes('boyfriend') && /boyfriend/.test(hay)) score += 6
    return { piece, score }
  }).filter(x => x.score > 0).sort((a,b) => b.score - a.score)

  return scored.slice(0, limit).map(x => x.piece)
}

export function buildSavedOutfitEvaluationContext(outfit) {
  if (!outfit?.id) return { linkedPieces: [], likelyPieces: [], extraContextText: '' }
  const linkedPieces = getLinkedPiecesForOutfit(outfit.id)
  const likelyPieces = linkedPieces.length ? [] : findLikelyPiecesForOutfit(outfit)
  const extraContextText = [
    buildOutfitAuthorityNote(outfit, linkedPieces, likelyPieces),
    buildOutfitText(outfit, linkedPieces),
    likelyPieces.length ? `Likely saved garment truth for Outfit A — hints only unless linked:\n${likelyPieces.map(buildPieceText).join('\n')}` : '',
    getConfirmedOutfitMemory() ? `Other confirmed outfit memory for comparison. Use this to understand Yuna's taste, not as a rigid checklist:\n${getConfirmedOutfitMemory()}` : ''
  ].filter(Boolean).join('\n\n')
  return { linkedPieces, likelyPieces, extraContextText }
}

export function getLinkedPiecesForOutfit(outfitId) {
  return db.prepare(`
    SELECT p.* FROM pieces p
    JOIN outfit_pieces op ON p.id = op.piece_id
    WHERE op.outfit_id = ?
    ORDER BY p.category, p.name
  `).all(outfitId).map(parsePiece)
}

export function getCalibrationReferenceSummary(limit = 24) {
  let rows = []
  try {
    rows = db.prepare(`
      SELECT * FROM calibration_images
      WHERE COALESCE(archived,0) = 0
      ORDER BY COALESCE(favorite,0) DESC, id DESC
      LIMIT ?
    `).all(Number(limit))
  } catch {
    return ''
  }
  if (!rows.length) return ''

  const normalized = rows.map(normalizeCalibrationRow)
  const good = normalized.filter(r => ['good_reference', 'real_photo'].includes(r.kind)).slice(0, 8)
  const bad = normalized.filter(r => r.kind === 'bad_reference').slice(0, 8)

  const summarize = (r) => {
    const labels = (r.labels || []).join(', ')
    const note = String(r.notes || '').trim()
    const strength = r.favorite ? 'Use strongly; ' : ''
    return `- ${strength}${r.kind}${labels ? ` [${labels}]` : ''}${note ? `: ${note}` : ''}`
  }

  const parts = []
  if (good.length) parts.push(`Positive calibration references — preserve these traits:\n${good.map(summarize).join('\n')}`)
  if (bad.length) parts.push(`Negative calibration references — avoid these drift patterns:\n${bad.map(summarize).join('\n')}`)
  return parts.join('\n\n')
}

export function getCalibrationMemoryForStylist(limit = 32) {
  let rows = []
  try {
    rows = db.prepare(`
      SELECT * FROM calibration_images
      WHERE COALESCE(archived,0) = 0
      ORDER BY COALESCE(favorite,0) DESC, id DESC
      LIMIT ?
    `).all(Number(limit))
  } catch {
    return ''
  }
  if (!rows.length) return ''

  const normalized = rows.map(normalizeCalibrationRow)
  const positiveLabels = /most_like_me|signature|works|good|strong|real|use_strongly|relaxed_structure|grounded|modern|minimal|artistic/i
  const negativeLabels = /too_safe|too_boho|wrong_proportions|body_proportions_drift|wrong_silhouette|wrong_length|wrong_energy|catalog_drift|not_me|ignore|bad|drift|too_polished|too_generic|too_soft/i

  const positives = []
  const negatives = []
  for (const row of normalized) {
    const labels = row.labels || []
    const labelText = labels.join(', ')
    const note = String(row.notes || '').trim()
    const summary = `- ${row.favorite ? 'Use strongly: ' : ''}${row.kind}${labelText ? ` [${labelText}]` : ''}${note ? ` — ${note.slice(0, 260)}` : ''}`
    if (row.archived) continue
    if (row.kind === 'bad_reference' || labels.some(l => negativeLabels.test(String(l))) || negativeLabels.test(note)) {
      negatives.push(summary)
    } else if (row.favorite || row.kind === 'real_photo' || row.kind === 'good_reference' || labels.some(l => positiveLabels.test(String(l))) || positiveLabels.test(note)) {
      positives.push(summary)
    }
  }

  const parts = []
  if (positives.length) parts.push(`Calibration Library positive memory. Treat Use strongly / real outfit / good references as high-authority taste and identity examples, but do not copy outfits literally:\n${positives.slice(0, 12).join('\n')}`)
  if (negatives.length) parts.push(`Calibration Library negative memory. Suppress outfit ideas and renderer choices that resemble these drift patterns:\n${negatives.slice(0, 12).join('\n')}`)
  return parts.join('\n\n')
}

// ── Critic Passes ────────────────────────────────────────────────────────────
export async function criticPassForGeneratedOutfits({ selectedPiece, draft, userQuestion }) {
  if (process.env.STYLIST_CRITIC_DISABLED === 'true') return draft

  const criticSystem = `You are a strict editor for Yuna's generated outfit ideas.
Return ONLY the corrected final answer.

Hard checks:
- Every outfit idea must include the selected garment.
- Do not replace the selected garment.
- Remove invented saved wardrobe items unless clearly labeled as missing-piece idea.
- Prune weak ideas. Surface only 2-3 recommendations unless more are genuinely strong. Never keep five just for variety.
- Do not present a risky outfit as recommended if it contradicts the Avoid section. Either remove it or label it "usable but weaker" and explain why.
- Remove generic filler like "harmony", "balance", "draws attention upward", "confidence to pull off", or "proper tuck" unless tied to a real garment-specific reason.
- Do not recommend tucking unless garment truth supports it.
- Avoid section must be contextual and must not contradict the recommended outfits.
- Keep the required output format: Signature / strongest direction, Usable variation, optional Experimental direction, optional I would skip, Saveable learning.
- Use Yuna's language: visual column, relaxed structure, grounded texture, compact top, stable bottom, controlled softness, signature direction.`

  const checked = await askStylist({
    system: criticSystem,
    maxTokens: 1200,
    messages: [{ role: 'user', content: [
      `Selected garment truth:\n${buildPieceText(selectedPiece)}`,
      categoryConstraintForSelectedPiece(selectedPiece),
      `User request: ${userQuestion || 'Generate outfit ideas'}`,
      `Draft answer to audit and correct:\n${draft}`
    ].join('\n\n') }]
  })
  return checked || draft
}

export async function criticPassForSelectedItem({ selectedPiece, draft, userQuestion }) {
  if (process.env.STYLIST_CRITIC_DISABLED === 'true') return draft

  const criticSystem = `You are a strict editor for Yuna's wardrobe stylist app.
Check the draft answer for rule violations.
Fix it if needed. Return ONLY the corrected final answer, no meta-commentary.

Hard checks:
- Every outfit idea must include the selected item.
- If selected item is a bottom, the answer must not recommend skirts/dresses/other pants as outfit ideas.
- It must not contradict authoritative notes, rejected pairings, or the user's style filter.
- Remove generic filler and body-shape commentary.
- Keep the required section structure.`

  const checked = await askStylist({
    system: criticSystem,
    maxTokens: 900,
    messages: [{ role: 'user', content: [
      `Selected item:\n${buildPieceText(selectedPiece)}`,
      categoryConstraintForSelectedPiece(selectedPiece),
      `User question: ${userQuestion || 'How should I style this piece?'}`,
      `Draft answer to audit and correct:\n${draft}`
    ].join('\n\n') }]
  })
  return checked || draft
}

// ── Outfits Gating & Composition logic ───────────────────────────────────────
export function normalizeGeneratedOutfitObject(outfit, selectedPiece, candidatePieces = []) {
  const candidateById = new Map(candidatePieces.map(p => [Number(p.id), p]))
  const candidatesByName = new Map()
  for (const piece of candidatePieces) {
    const key = normalizeForMatch(piece?.name || '')
    if (key && !candidatesByName.has(key)) candidatesByName.set(key, piece)
  }
  const selectedId = Number(selectedPiece?.id)
  const ids = []
  const missingPieces = []

  const nonSelectedIds = (outfit?.pieceIds || [])
    .map(Number)
    .filter(n => Number.isFinite(n) && n > 0 && n !== selectedId)

  const piecesArrayIds = (outfit?.pieces || [])
    .filter(p => p && !p.missing && !String(p.id || '').startsWith('missing-'))
    .map(p => Number(p.id))
    .filter(n => Number.isFinite(n) && n > 0 && n !== selectedId)

  const allNonSelectedIds = [...nonSelectedIds, ...piecesArrayIds]

  let isSequentialIndices = false
  if (allNonSelectedIds.length > 0) {
    const allWithinRange = allNonSelectedIds.every(n => n >= 1 && n < candidatePieces.length)
    const hasInvalidDbId = allNonSelectedIds.some(n => !candidateById.has(n))
    if (allWithinRange && hasInvalidDbId) {
      isSequentialIndices = true
    }
  }

  const resolveId = (value) => {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) return null
    if (n === selectedId) return selectedId

    if (isSequentialIndices) {
      if (n >= 1 && n < candidatePieces.length) {
        return Number(candidatePieces[n]?.id) || null
      }
    } else {
      if (candidateById.has(n)) {
        return n
      }
    }
    return null
  }

  const addId = (value) => {
    const resolved = resolveId(value)
    if (resolved && !ids.includes(resolved)) ids.push(resolved)
  }

  const addPieceReference = (piece) => {
    if (piece?.name) {
      const key = normalizeForMatch(piece.name)
      const matched = candidatesByName.get(key)
      if (matched) {
        addId(matched.id)
        return
      }
    }

    if (piece?.name) {
      const normalizedAiName = normalizeForMatch(piece.name)
      const aiCategory = wardrobeCategoryGroup(piece.category || piece.type || '')
      for (const candidate of candidatePieces) {
        const normalizedCandName = normalizeForMatch(candidate?.name || '')
        const candCategory = wardrobeCategoryGroup(candidate?.category || '')
        if (normalizedCandName && normalizedAiName && (aiCategory === 'other' || aiCategory === candCategory)) {
          if (normalizedCandName.includes(normalizedAiName) || normalizedAiName.includes(normalizedCandName)) {
            addId(candidate.id)
            return
          }
        }
      }
    }

    const resolved = resolveId(piece?.id)
    if (resolved) {
      addId(resolved)
    }
  }

  if (Array.isArray(outfit?.pieceIds)) outfit.pieceIds.forEach(addId)
  if (Array.isArray(outfit?.pieces)) {
    for (const piece of outfit.pieces) {
      if (piece?.missing || String(piece?.id || '').startsWith('missing-')) {
        const rawName = piece.name || piece.label || 'missing piece'
        const normalized = normalizeForMatch(rawName).replace(/missing piece/g, '').trim() || normalizeForMatch(rawName) || 'support piece'
        missingPieces.push({
          id: piece.id || `missing-${normalized.replace(/\s+/g, '-')}`,
          name: /missing piece/i.test(rawName) ? rawName : `${rawName} (missing piece)`,
          category: piece.category || inferMissingCategory(rawName),
          missing: true,
          photo: null,
          worn_photo: null
        })
      } else {
        addPieceReference(piece)
      }
    }
  }
  if (selectedId && !ids.includes(selectedId)) ids.unshift(selectedId)

  const ownedPieces = ids.map(id => candidateById.get(id)).filter(Boolean)
  const cleanMissing = dedupeMissingAgainstOwned(missingPieces, ownedPieces).slice(0, Math.max(0, 5 - ownedPieces.length))
  const label = String(outfit?.label || outfit?.title || 'Outfit direction').trim()
  const strength = String(outfit?.strength || '').toLowerCase().trim()
  return {
    label,
    strength: ['signature', 'strong', 'usable', 'experimental'].includes(strength) ? strength : (label.toLowerCase().includes('signature') ? 'signature' : 'strong'),
    dominantDirection: outfit?.dominantDirection || outfit?.dominant_direction || outfit?.direction || '',
    silhouette: outfit?.silhouette || '',
    bestFor: outfit?.bestFor || outfit?.best_for || '',
    reason: outfit?.reason || outfit?.why || '',
    watchFor: outfit?.watchFor || outfit?.watch_for || 'none',
    pieceIds: ids.slice(0, 5),
    missingPieces: cleanMissing,
    pieces: [
      ...ownedPieces.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        photo: p.photo || null,
        worn_photo: p.worn_photo || null
      })),
      ...cleanMissing.map(p => ({ id: p.id, name: p.name, category: p.category, missing: true }))
    ]
  }
}


export function locallyGateOutfitDirections(outfits = [], selectedPiece) {
  const selectedId = Number(selectedPiece?.id)
  const seen = new Set()
  const accepted = []
  const rejected = []
  for (const outfit of outfits) {
    const ids = Array.isArray(outfit?.pieceIds) ? outfit.pieceIds.map(Number).filter(Boolean) : []
    const missingCount = Array.isArray(outfit?.missingPieces) ? outfit.missingPieces.length : 0
    const key = ids.slice().sort((a,b) => a-b).join('|') + '::' + (outfit?.label || '').toLowerCase()
    if (selectedId && !ids.includes(selectedId)) {
      rejected.push({ label: outfit?.label || 'unnamed', reason: 'does not include selected garment' })
      continue
    }
    if ((ids.length + missingCount) < 2) {
      rejected.push({ label: outfit?.label || 'unnamed', reason: 'not a complete outfit direction' })
      continue
    }
    if (seen.has(key)) {
      rejected.push({ label: outfit?.label || 'unnamed', reason: 'duplicate direction' })
      continue
    }
    seen.add(key)
    accepted.push(outfit)
  }
  return sortByStylisticStrength(accepted, selectedPiece).slice(0, 5)
}

export function mergeOutfitDirections(primary = [], fallback = [], selectedPiece, { closetOnly = false, minCount = 3 } = {}) {
  const selectedId = Number(selectedPiece?.id)
  const merged = []
  const seen = new Set()
  const add = (outfit, isPrimary) => {
    if (!outfit) return
    const ids = Array.isArray(outfit.pieceIds) ? outfit.pieceIds.map(Number).filter(Boolean) : []
    const hasMissing = (Array.isArray(outfit.missingPieces) && outfit.missingPieces.length) ||
      (Array.isArray(outfit.pieces) && outfit.pieces.some(p => p?.missing || String(p?.id || '').startsWith('missing-')))
    if (closetOnly && hasMissing) return
    if (selectedId && !ids.includes(selectedId)) return
    if (ids.length < 2) return
    const key = ids.slice().sort((a,b) => a-b).join('|')
    if (seen.has(key)) return
    seen.add(key)
    merged.push({ ...outfit, isFallback: !isPrimary })
  }
  primary.forEach(o => add(o, true))
  fallback.forEach(o => add(o, false))

  const sorted = [...merged].sort((a, b) => {
    if (a.isFallback !== b.isFallback) {
      return a.isFallback ? 1 : -1
    }
    const strengthOrder = { signature: 8, strong: 5, usable: 2, experimental: 1 }
    const as = outfitStylisticStrengthScore(a, selectedPiece) + (strengthOrder[a?.strength] || 3)
    const bs = outfitStylisticStrengthScore(b, selectedPiece) + (strengthOrder[b?.strength] || 3)
    return bs - as
  })

  const resolved = sorted.map((o, index) => {
    const score = outfitStylisticStrengthScore(o, selectedPiece)
    const copy = { ...o }
    if (index === 0 && score >= 8) copy.strength = 'signature'
    else if (score < -15 && copy.strength === 'signature') copy.strength = 'usable'
    else if (score < -5 && copy.strength === 'strong') copy.strength = 'usable'
    return copy
  })

  return resolved.slice(0, Math.max(minCount, 4))
}

export function sanitizeSelectedPieceOutfitDirections(outfits = [], selectedPiece, candidatePieces = [], options = {}) {
  const occasion = String(options.occasion || '').toLowerCase().trim()
  const selectedId = Number(selectedPiece?.id)
  const candidateById = new Map(candidatePieces.map(piece => [Number(piece.id), piece]))
  return (outfits || []).map(outfit => {
    const ids = Array.isArray(outfit?.pieceIds) ? outfit.pieceIds.map(Number).filter(Boolean) : []
    const fullPieces = ids.map(id => candidateById.get(id)).filter(Boolean)
    const keptIds = ids.filter(id => {
      if (selectedId && id === selectedId) return true
      const piece = candidateById.get(id)
      if (!piece) return true
      const corePieces = fullPieces.filter(core => Number(core.id) !== Number(piece.id))
      const isSelectedOuterwear = wardrobeCategoryGroup(selectedPiece) === 'outerwear'
      const isCurrentOuterwear = wardrobeCategoryGroup(piece) === 'outerwear'
      if (isSelectedOuterwear) {
        const otherCore = corePieces.filter(core => Number(core.id) !== selectedId)
        if (optionalLayerCoherenceIssue(piece, selectedPiece, otherCore, { occasion })) return false
      } else if (isCurrentOuterwear) {
        if (optionalLayerCoherenceIssue(selectedPiece, piece, corePieces, { occasion })) return false
      } else {
        if (optionalLayerCoherenceIssue(selectedPiece, piece, corePieces, { occasion })) return false
      }
      return true
    })
    if (keptIds.length === ids.length) return outfit
    const kept = new Set(keptIds)
    return {
      ...outfit,
      pieceIds: keptIds,
      pieces: (outfit.pieces || []).filter(piece => piece?.missing || kept.has(Number(piece.id))),
      watchFor: outfit.watchFor && outfit.watchFor !== 'none'
        ? outfit.watchFor
        : 'keep support pieces aligned with the requested occasion'
    }
  }).filter(outfit => {
    const ids = Array.isArray(outfit?.pieceIds) ? outfit.pieceIds.map(Number).filter(Boolean) : []
    return (!selectedId || ids.includes(selectedId)) && ids.length >= 2
  })
}

export function buildLocalFallbackOutfitDirections(selectedPiece, rankedCandidates = [], options = {}) {
  const selected = selectedPiece
  const occasion = String(options.occasion || '').toLowerCase().trim()
  const requestedUse = occasion ? occasion.replace(/\b\w/g, c => c.toUpperCase()) : 'Everyday'
  const requestedBestFor = occasion || 'everyday, city days, casual meetings'
  const byCategory = { top: [], bottom: [], dress: [], outerwear: [], shoes: [], accessory: [] }
  for (const r of rankedCandidates || []) {
    const piece = r?.piece || r
    if (!piece || piece.id === selected?.id) continue
    const cat = wardrobeCategoryGroup(piece)
    if (byCategory[cat]) byCategory[cat].push(piece)
  }

  const pick = (cat, used = new Set(), predicate = null) => (byCategory[cat] || []).find(p => {
    if (used.has(Number(p.id))) return false
    return typeof predicate === 'function' ? predicate(p) : true
  })
  const make = ({ label, strength, dominantDirection, silhouette, bestFor, pieces, reason, watchFor }) => {
    const all = [selected, ...(pieces || [])].filter(Boolean)
    const seen = new Set()
    const owned = all.filter(piece => {
      const id = Number(piece.id)
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })
    return normalizeGeneratedOutfitObject({
      label,
      strength,
      dominantDirection,
      silhouette,
      bestFor,
      pieceIds: owned.map(p => p.id),
      pieces: owned.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        photo: p.photo || null,
        worn_photo: p.worn_photo || null
      })),
      reason,
      watchFor: watchFor || 'none'
    }, selected, [selected, ...rankedCandidates.map(r => r?.piece || r).filter(Boolean)])
  }

  const outfits = []
  const usedFirst = new Set()

  if (wardrobeCategoryGroup(selected) === 'top') {
    const bottom1 = pick('bottom', usedFirst); if (bottom1) usedFirst.add(Number(bottom1.id))
    const shoes1 = pick('shoes', usedFirst); if (shoes1) usedFirst.add(Number(shoes1.id))
    const acc1 = pick('accessory', usedFirst); if (acc1) usedFirst.add(Number(acc1.id))
    if (bottom1) outfits.push(make({
      label: 'Most specific wardrobe direction',
      strength: 'signature',
      dominantDirection: 'edited outfit with a clear visual thesis',
      silhouette: 'selected top plus a grounded lower-half shape',
      bestFor: requestedBestFor,
      pieces: [bottom1, shoes1, acc1].filter(Boolean),
      reason: 'Uses the strongest saved bottom to create a readable silhouette instead of a safe generic pairing.',
      watchFor: 'check shoe weight in the photo before rendering'
    }))

    const usedSecond = new Set(outfits.flatMap(o => o.pieceIds.map(Number)))
    const bottom2 = pick('bottom', usedSecond); if (bottom2) usedSecond.add(Number(bottom2.id))
    const shoes2 = pick('shoes', usedSecond); if (shoes2) usedSecond.add(Number(shoes2.id))
    const outer2 = pick('outerwear', usedSecond, p => !optionalLayerCoherenceIssue(selected, p, [bottom2, shoes2].filter(Boolean), { occasion })); if (outer2) usedSecond.add(Number(outer2.id))
    if (bottom2) outfits.push(make({
      label: 'Controlled contrast variation',
      strength: 'strong',
      dominantDirection: `${occasion || 'casual'} direction with one deliberate contrast`,
      silhouette: 'compact/controlled top with an intentional saved bottom',
      bestFor: requestedBestFor,
      pieces: [bottom2, shoes2, outer2].filter(Boolean),
      reason: 'Gives a second real wardrobe option without replacing the selected top or inventing missing pieces.',
      watchFor: 'avoid adding a loose layer if it makes the waist area visually busy'
    }))

    const usedThird = new Set(outfits.flatMap(o => o.pieceIds.map(Number)))
    const bottom3 = pick('bottom', usedThird); if (bottom3) usedThird.add(Number(bottom3.id))
    const shoes3 = pick('shoes', usedThird); if (shoes3) usedThird.add(Number(shoes3.id))
    const acc3 = pick('accessory', usedThird); if (acc3) usedThird.add(Number(acc3.id))
    if (bottom3) outfits.push(make({
      label: 'Alternate visual thesis',
      strength: 'usable',
      dominantDirection: 'different saved-wardrobe idea with its own shape logic',
      silhouette: 'selected top with a different saved bottom and quiet support pieces',
      bestFor: 'alternate everyday styling test',
      pieces: [bottom3, shoes3, acc3].filter(Boolean),
      reason: 'Keeps the selected top central and uses only saved wardrobe pieces so the suggestion is testable immediately.',
      watchFor: 'compare this against the stronger first two options before rendering visuals'
    }))
  } else if (wardrobeCategoryGroup(selected) === 'bottom') {
    const top1 = pick('top', usedFirst); if (top1) usedFirst.add(Number(top1.id))
    const shoes1 = pick('shoes', usedFirst); if (shoes1) usedFirst.add(Number(shoes1.id))
    const acc1 = pick('accessory', usedFirst); if (acc1) usedFirst.add(Number(acc1.id))
    if (top1) outfits.push(make({
      label: 'Most specific wardrobe pairing',
      strength: 'signature',
      dominantDirection: 'selected bottom with a clear upper-half point of view',
      silhouette: 'stable bottom with a controlled upper half',
      bestFor: requestedBestFor,
      pieces: [top1, shoes1, acc1].filter(Boolean),
      reason: 'Keeps the selected bottom central and uses the highest-ranked saved top rather than suggesting replacement bottoms.',
      watchFor: 'judge cuff or hem by the full outfit, not by vertical-column rules alone'
    }))

    const usedSecond = new Set(outfits.flatMap(o => o.pieceIds.map(Number)))
    const top2 = pick('top', usedSecond); if (top2) usedSecond.add(Number(top2.id))
    const shoes2 = pick('shoes', usedSecond); if (shoes2) usedSecond.add(Number(shoes2.id))
    const outer2 = pick('outerwear', usedSecond, p => !optionalLayerCoherenceIssue(selected, p, [top2, shoes2].filter(Boolean), { occasion })); if (outer2) usedSecond.add(Number(outer2.id))
    if (top2) outfits.push(make({
      label: `${requestedUse} visual-tension variation`,
      strength: 'strong',
      dominantDirection: 'relaxed structure with a distinct support piece',
      silhouette: 'selected bottom with a simple supporting top',
      bestFor: requestedBestFor,
      pieces: [top2, shoes2, outer2].filter(Boolean),
      reason: 'Provides another complete wardrobe outfit while keeping the selected bottom as the anchor.',
      watchFor: 'skip extra layers if they compete with the main silhouette'
    }))

    const usedThird = new Set(outfits.flatMap(o => o.pieceIds.map(Number)))
    const top3 = pick('top', usedThird); if (top3) usedThird.add(Number(top3.id))
    const shoes3 = pick('shoes', usedThird); if (shoes3) usedThird.add(Number(shoes3.id))
    const acc3 = pick('accessory', usedThird); if (acc3) usedThird.add(Number(acc3.id))
    if (top3) outfits.push(make({
      label: 'Alternate visual thesis',
      strength: 'usable',
      dominantDirection: 'another real closet pairing with the selected bottom',
      silhouette: 'selected bottom with a different controlled top and quiet support pieces',
      bestFor: 'alternate everyday styling test',
      pieces: [top3, shoes3, acc3].filter(Boolean),
      reason: 'Keeps the selected bottom central and uses only saved wardrobe pieces so the suggestion is testable immediately.',
      watchFor: 'compare shoe grounding and top compactness before rendering visuals'
    }))
  } else if (wardrobeCategoryGroup(selected) === 'dress') {
    const shoes1 = pick('shoes', usedFirst); if (shoes1) usedFirst.add(Number(shoes1.id))
    const acc1 = pick('accessory', usedFirst); if (acc1) usedFirst.add(Number(acc1.id))
    const outer1 = pick('outerwear', usedFirst); if (outer1) usedFirst.add(Number(outer1.id))
    if (shoes1 || acc1 || outer1) outfits.push(make({
      label: 'Clean dress styling',
      strength: 'signature',
      dominantDirection: 'selected dress with restrained support pieces',
      silhouette: 'one-piece column with simple grounding',
      bestFor: 'dinner, events, gallery days',
      pieces: [shoes1, acc1, outer1].filter(Boolean),
      reason: 'Keeps the dress central and adds only support pieces from the wardrobe.',
      watchFor: 'avoid over-accessorizing the dress'
    }))
  } else if (wardrobeCategoryGroup(selected) === 'shoes') {
    const top1 = pick('top', usedFirst); if (top1) usedFirst.add(Number(top1.id))
    const bottom1 = pick('bottom', usedFirst); if (bottom1) usedFirst.add(Number(bottom1.id))
    const outer1 = pick('outerwear', usedFirst); if (outer1) usedFirst.add(Number(outer1.id))
    if (top1 && bottom1) outfits.push(make({
      label: 'Best outfit for the shoes',
      strength: 'signature',
      dominantDirection: 'saved separates that let the selected shoes finish the outfit',
      silhouette: 'top and bottom with the selected shoes as the grounding/artistic finish',
      bestFor: 'city days, casual plans, travel',
      pieces: [top1, bottom1, outer1].filter(Boolean),
      reason: 'Builds a complete outfit around the selected shoes instead of treating them as an afterthought.',
      watchFor: 'make sure the pant hem or skirt length leaves enough shoe visible'
    }))

    const usedSecond = new Set(outfits.flatMap(o => o.pieceIds.map(Number)))
    const dress2 = pick('dress', usedSecond); if (dress2) usedSecond.add(Number(dress2.id))
    const outer2 = pick('outerwear', usedSecond); if (outer2) usedSecond.add(Number(outer2.id))
    const acc2 = pick('accessory', usedSecond); if (acc2) usedSecond.add(Number(acc2.id))
    if (dress2) outfits.push(make({
      label: 'Dress formula with shoe focus',
      strength: 'strong',
      dominantDirection: 'one-piece outfit grounded by the selected shoes',
      silhouette: 'dress column or movement with the shoe pattern kept visible',
      bestFor: 'lunch, gallery / art event, casual evening',
      pieces: [dress2, outer2, acc2].filter(Boolean),
      reason: 'Uses a one-piece base so the selected shoes can carry the playful/artistic note without too many competing garments.',
      watchFor: 'avoid a dress hem that hides the shoe or competes with its pattern'
    }))

    const usedThird = new Set(outfits.flatMap(o => o.pieceIds.map(Number)))
    const top3 = pick('top', usedThird); if (top3) usedThird.add(Number(top3.id))
    const bottom3 = pick('bottom', usedThird); if (bottom3) usedThird.add(Number(bottom3.id))
    const acc3 = pick('accessory', usedThird); if (acc3) usedThird.add(Number(acc3.id))
    if (top3 && bottom3) outfits.push(make({
      label: 'Alternate separates formula',
      strength: 'usable',
      dominantDirection: 'different saved separates with the selected shoes as the intentional accent',
      silhouette: 'alternate top/bottom proportion finished by the same shoe',
      bestFor: 'alternate everyday styling test',
      pieces: [top3, bottom3, acc3].filter(Boolean),
      reason: 'Gives a second testable separates option while keeping the selected shoes central.',
      watchFor: 'keep the rest of the outfit quiet enough for patterned shoes to read intentional'
    }))
  } else {
    const top1 = pick('top', usedFirst); if (top1) usedFirst.add(Number(top1.id))
    const bottom1 = pick('bottom', usedFirst); if (bottom1) usedFirst.add(Number(bottom1.id))
    const shoes1 = pick('shoes', usedFirst); if (shoes1) usedFirst.add(Number(shoes1.id))
    if (top1 || bottom1 || shoes1) outfits.push(make({
      label: 'Best wardrobe direction',
      strength: 'signature',
      dominantDirection: 'complete saved-wardrobe outfit',
      silhouette: 'simple stable outfit architecture',
      bestFor: 'everyday',
      pieces: [top1, bottom1, shoes1].filter(Boolean),
      reason: 'Builds a complete outfit from the highest-ranked saved wardrobe pieces.',
      watchFor: 'none'
    }))

    const usedSecond = new Set(outfits.flatMap(o => o.pieceIds.map(Number)))
    const top2 = pick('top', usedSecond); if (top2) usedSecond.add(Number(top2.id))
    const bottom2 = pick('bottom', usedSecond); if (bottom2) usedSecond.add(Number(bottom2.id))
    const shoes2 = pick('shoes', usedSecond); if (shoes2) usedSecond.add(Number(shoes2.id))
    if (top2 || bottom2 || shoes2) outfits.push(make({
      label: 'Alternate separates contrast',
      strength: 'strong',
      dominantDirection: 'alternate saved separates with the selected layer',
      silhouette: 'layer over simple top and bottoms',
      bestFor: 'everyday, casual meetings',
      pieces: [top2, bottom2, shoes2].filter(Boolean),
      reason: 'Generates a second distinct wardrobe option using alternative tops and bottoms.',
      watchFor: 'none'
    }))

    const usedThird = new Set(outfits.flatMap(o => o.pieceIds.map(Number)))
    const dress3 = pick('dress', usedThird); if (dress3) usedThird.add(Number(dress3.id))
    const shoes3 = pick('shoes', usedThird); if (shoes3) usedThird.add(Number(shoes3.id))
    if (dress3) {
      outfits.push(make({
        label: 'Layered dress formula',
        strength: 'usable',
        dominantDirection: 'selected layer over a one-piece dress column',
        silhouette: 'outer layer framing a dress silhouette',
        bestFor: 'smart-casual, social plans',
        pieces: [dress3, shoes3].filter(Boolean),
        reason: 'Pairs the outerwear piece over a saved dress to frame a clean one-piece column.',
        watchFor: 'none'
      }))
    } else {
      const top3 = pick('top', usedThird); if (top3) usedThird.add(Number(top3.id))
      const bottom3 = pick('bottom', usedThird); if (bottom3) usedThird.add(Number(bottom3.id))
      const shoes3_alt = pick('shoes', usedThird); if (shoes3_alt) usedThird.add(Number(shoes3_alt.id))
      if (top3 || bottom3 || shoes3_alt) outfits.push(make({
        label: 'Relaxed basics direction',
        strength: 'usable',
        dominantDirection: 'relaxed styling with basic separates',
        silhouette: 'relaxed layered coordinates',
        bestFor: 'lounge, easy errands',
        pieces: [top3, bottom3, shoes3_alt].filter(Boolean),
        reason: 'Offers a casual, everyday alternative formula using remaining wardrobe items.',
        watchFor: 'none'
      }))
    }
  }

  return locallyGateOutfitDirections(outfits, selected).slice(0, 3)
}

export function formatStructuredOutfitFeedback({ selectedPiece, occasion, season, outfits = [], skip = '', saveableLearning = '' }) {
  const lines = [
    `**Generated outfit ideas for:** ${selectedPiece?.name || 'selected garment'}`,
    `**Occasion / season:** ${occasion || 'casual'} / ${season || 'current season'}`,
    ''
  ]
  const labelFor = (outfit, index) => {
    if (index === 0 || outfit.strength === 'signature') return 'Signature / strongest direction'
    if (outfit.strength === 'usable') return 'Usable variation'
    if (outfit.strength === 'experimental') return 'Optional experimental direction'
    return outfit.label || 'Strong direction'
  }
  outfits.forEach((outfit, index) => {
    lines.push(`**${labelFor(outfit, index)}**`)
    if (outfit.label && outfit.label !== labelFor(outfit, index)) lines.push(`Label: ${outfit.label}`)
    if (outfit.strength) lines.push(`Strength: ${outfit.strength}`)
    if (outfit.dominantDirection) lines.push(`Direction: ${outfit.dominantDirection}`)
    if (outfit.silhouette) lines.push(`Silhouette: ${outfit.silhouette}`)
    if (outfit.bestFor) lines.push(`Best for: ${outfit.bestFor}`)
    const pieces = Array.isArray(outfit.pieces) ? outfit.pieces.map(p => p?.name).filter(Boolean).join(' + ') : ''
    if (pieces) lines.push(`Pieces: ${pieces}`)
    if (outfit.reason) lines.push(`Why it works: ${outfit.reason}`)
    lines.push(`Watch for: ${outfit.watchFor || 'none'}`)
    lines.push('')
  })
  if (skip) lines.push(`**I would skip**\n${skip}\n`)
  if (saveableLearning) lines.push(`**Saveable learning**\n- ${saveableLearning}`)
  return lines.join('\n').trim()
}

export async function composeStructuredOutfitsForPiece({ selectedPiece, rankedCandidates, occasion, season, mission, mood, question, idealMode, idealOnlyMode, memoryText, history = [] }) {
  const candidatePieces = [selectedPiece, ...rankedCandidates.map(r => r.piece)]
  const candidateText = buildOutfitGenerationCandidateText(rankedCandidates)
  const userPayload = [
    `Selected garment id: ${selectedPiece.id}`,
    categoryConstraintForSelectedPiece(selectedPiece),
    `Selected garment truth:\n${buildPieceText(selectedPiece)}`,
    '',
    `Occasion: ${occasion}`,
    `Season: ${season}`,
    mission && mission !== 'mix' ? `Mission: ${mission}` : '',
    mood ? `Mood: ${mood}` : '',
    `Mode: ${idealOnlyMode ? 'ideal missing-piece only' : idealMode ? 'mixed owned wardrobe plus ideal missing-piece completion' : 'closet-only saved wardrobe'}`,
    '',
    memoryText || '',
    '',
    candidateText ? `Ranked candidate wardrobe pieces. Use exact ids/names for owned pieces:\n${candidateText}` : 'No supporting wardrobe candidates found.',
    '',
    `User request: ${question || 'Generate outfit ideas for this piece.'}`
  ].filter(Boolean).join('\n')

  const rawComposer = await askStylist({
    system: OUTFIT_COMPOSER_SYSTEM,
    maxTokens: 1800,
    messages: [
      ...(history || []).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: [{ type: 'text', text: userPayload }] }
    ]
  })

  let composerParsed = safeJsonFromModel(rawComposer)
  console.log(`[0]    - Raw AI Composer response:\n${rawComposer}\n`)
  console.log(`[0]    - Parsed AI Composer JSON:`, JSON.stringify(composerParsed, null, 2))
  let normalized = (composerParsed.outfits || []).map(o => normalizeGeneratedOutfitObject(o, selectedPiece, candidatePieces))

  let gated = { outfits: normalized, rejected: [], skip: composerParsed.skip || '', saveableLearning: composerParsed.saveableLearning || '' }
  try {
    const rawGate = await askStylist({
      system: OUTFIT_EVALUATOR_GATE_SYSTEM,
      maxTokens: 1400,
      messages: [{ role: 'user', content: [{ type: 'text', text: [
        `Selected garment truth:\n${buildPieceText(selectedPiece)}`,
        categoryConstraintForSelectedPiece(selectedPiece),
        `Occasion: ${occasion}`,
        `Season: ${season}`,
        mission && mission !== 'mix' ? `Mission: ${mission}` : '',
        mood ? `Mood: ${mood}` : '',
        `Composer JSON to audit:\n${JSON.stringify({ outfits: normalized, skip: composerParsed.skip || '', saveableLearning: composerParsed.saveableLearning || '' }, null, 2)}`
      ].filter(Boolean).join('\n\n') }] }]
    })
    const gateParsed = safeJsonFromModel(rawGate)
    console.log(`[0]    - Raw Evaluator Gate response:\n${rawGate}\n`)
    console.log(`[0]    - Parsed Evaluator Gate JSON:`, JSON.stringify(gateParsed, null, 2))
    const gateOutfits = (gateParsed.outfits || []).map(o => normalizeGeneratedOutfitObject(o, selectedPiece, candidatePieces))
    gated = {
      outfits: gateOutfits.length ? gateOutfits : normalized,
      rejected: gateParsed.rejected || [],
      skip: gateParsed.skip || composerParsed.skip || '',
      saveableLearning: gateParsed.saveableLearning || composerParsed.saveableLearning || ''
    }
  } catch (err) {
    console.warn('Outfit gate fallback:', err.message)
  }

  console.log(`[0] 🧠 composeStructuredOutfitsForPiece:`)
  console.log(`    - AI composer returned ${normalized.length} raw outfits:`, normalized.map(o => `${o.label} (pieces: ${o.pieceIds?.join(', ')})`))

  let outfits = locallyGateOutfitDirections(gated.outfits, selectedPiece)
  if (!outfits.length && normalized.length) outfits = locallyGateOutfitDirections(normalized, selectedPiece)
  console.log(`    - After locallyGateOutfitDirections: ${outfits.length} outfits:`, outfits.map(o => `${o.label} (pieces: ${o.pieceIds?.join(', ')})`))

  const localFallback = buildLocalFallbackOutfitDirections(selectedPiece, rankedCandidates, { occasion })

  if (idealOnlyMode) {
    outfits = buildIdealOnlyCompletionsForPiece(selectedPiece).map(o => normalizeGeneratedOutfitObject(o, selectedPiece, candidatePieces))
  } else if (idealMode) {
    outfits = ensureIdealMissingCompletion(outfits.length ? outfits : localFallback, selectedPiece, true).map(o => normalizeGeneratedOutfitObject(o, selectedPiece, candidatePieces))
  } else {
    outfits = mergeOutfitDirections(outfits, localFallback, selectedPiece, { closetOnly: true, minCount: 4 })
    console.log(`    - After mergeOutfitDirections: ${outfits.length} outfits:`, outfits.map(o => `${o.label} (pieces: ${o.pieceIds?.join(', ')})`))
    outfits = sanitizeSelectedPieceOutfitDirections(outfits, selectedPiece, candidatePieces, { occasion })
    console.log(`    - After sanitizeSelectedPieceOutfitDirections: ${outfits.length} outfits:`, outfits.map(o => `${o.label} (pieces: ${o.pieceIds?.join(', ')})`))
    if (!outfits.length) {
      console.log(`    - Final outfits list empty, fallback to sanitized localFallback.`)
      outfits = sanitizeSelectedPieceOutfitDirections(localFallback, selectedPiece, candidatePieces, { occasion })
    }
  }

  return {
    outfits,
    rejected: gated.rejected || [],
    skip: gated.skip || composerParsed.skip || '',
    saveableLearning: gated.saveableLearning || composerParsed.saveableLearning || '',
    rawComposer
  }
}

// ── Rendering Adapters ───────────────────────────────────────────────────────
export async function makeTextTile({ width, height, title, subtitle }) {
  const titleLines = wrapLabel(title, 20)
  const subtitleLines = wrapLabel(subtitle, 28)
  const titleSvg = titleLines.map((line, i) => `<text x="${width / 2}" y="${height / 2 - 16 + i * 18}" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" font-weight="600" fill="#4b423b">${escapeSvgText(line)}</text>`).join('')
  const subtitleSvg = subtitleLines.map((line, i) => `<text x="${width / 2}" y="${height / 2 + 34 + i * 14}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#81766d">${escapeSvgText(line)}</text>`).join('')
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="18" fill="#f4f0ea"/><rect x="8" y="8" width="${width - 16}" height="${height - 16}" rx="14" fill="none" stroke="#d8cec4" stroke-width="1.5" stroke-dasharray="5 5"/>${titleSvg}${subtitleSvg}</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

export async function makeGarmentTile(piece, width = 190, height = 230) {
  const photo = piece?.photo || piece?.worn_photo
  const filePath = photo ? path.join(uploadsDir, photo) : null
  let image
  if (filePath && fs.existsSync(filePath)) {
    image = await sharp(filePath)
      .rotate()
      .resize(width - 20, height - 52, { fit: 'contain', background: { r: 250, g: 248, b: 245, alpha: 0 } })
      .png()
      .toBuffer()
  } else {
    image = await makeTextTile({ width: width - 20, height: height - 52, title: piece?.name || 'garment', subtitle: piece?.category || '' })
  }

  const labelLines = wrapLabel(piece?.name || 'garment', 21)
  const labelSvg = labelLines.map((line, i) => `<text x="${width / 2}" y="${height - 28 + i * 13}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#5b5149">${escapeSvgText(line)}</text>`).join('')
  const tileSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="18" fill="#fbfaf8"/><rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="18" fill="none" stroke="#e2d9d0"/>${labelSvg}</svg>`
  return sharp(Buffer.from(tileSvg)).composite([{ input: image, left: 10, top: 12 }]).png().toBuffer()
}

export function fullPiecesForCandidate(candidate = {}, candidatePieces = []) {
  const byId = new Map(candidatePieces.map(piece => [Number(piece.id), piece]))
  return (candidate.pieceIds || candidate.pieces?.map(piece => piece.id) || [])
    .map(id => byId.get(Number(id)))
    .filter(Boolean)
}

export function hydrateGeneratedOutfitPiece(piece = {}, byId = new Map()) {
  const saved = piece?.id ? byId.get(Number(piece.id)) : null
  return {
    ...(saved || {}),
    ...(piece || {}),
    id: piece?.id || saved?.id || null,
    name: piece?.name || saved?.name || 'garment',
    category: piece?.category || saved?.category || '',
    photo: piece?.photo || saved?.photo || null,
    worn_photo: piece?.worn_photo || saved?.worn_photo || null,
  }
}

export function piecesForGeneratedOutfit(outfit = {}, wardrobePieces = []) {
  const byId = new Map((wardrobePieces || []).map(piece => [Number(piece.id), piece]))
  const rawPieces = Array.isArray(outfit.pieces) && outfit.pieces.length
    ? outfit.pieces
    : (outfit.pieceIds || []).map(id => ({ id }))
  const seen = new Set()
  return rawPieces
    .map(piece => hydrateGeneratedOutfitPiece(piece, byId))
    .filter(piece => {
      const key = piece.id ? `id:${piece.id}` : `${piece.name}:${piece.category}`
      if (seen.has(key)) return false
      seen.add(key)
      return piece.name || piece.photo || piece.worn_photo
    })
}

export async function makeGeneratedOutfitReferenceSheet(generatedOutfits = [], wardrobePieces = [], maxOutfits = 5) {
  const shown = (generatedOutfits || []).slice(0, maxOutfits)
    .map((outfit, index) => ({
      outfit,
      index,
      pieces: piecesForGeneratedOutfit(outfit, wardrobePieces).slice(0, 5)
    }))
    .filter(row => row.pieces.length)
  if (!shown.length) return null

  const tileW = 200
  const tileH = 250
  const width = 1240
  const headerHeight = 82
  const rowHeight = 320
  const height = headerHeight + shown.length * rowHeight + 28
  const composites = []
  const rowSvgs = []

  for (const [rowPosition, row] of shown.entries()) {
    const y = headerHeight + rowPosition * rowHeight
    const title = `Outfit ${row.index + 1}: ${row.outfit.label || row.outfit.title || `Generated outfit ${row.index + 1}`}`
    const detail = [
      row.outfit.strength ? `strength: ${row.outfit.strength}` : '',
      row.outfit.dominantDirection ? `direction: ${row.outfit.dominantDirection}` : '',
      row.outfit.silhouette ? `silhouette: ${row.outfit.silhouette}` : ''
    ].filter(Boolean).join(' · ')
    rowSvgs.push(`
      <rect x="24" y="${y}" width="${width - 48}" height="${rowHeight - 16}" rx="18" fill="#fffaf7" stroke="#ddd1c6"/>
      <text x="44" y="${y + 32}" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#3f352e">${escapeSvgText(title)}</text>
      ${detail ? `<text x="44" y="${y + 58}" font-family="Arial, sans-serif" font-size="12" fill="#81756b">${escapeSvgText(detail)}</text>` : ''}
      <text x="44" y="${y + rowHeight - 34}" font-family="Arial, sans-serif" font-size="12" fill="#81756b">Reference photos: hanger photo when available; worn photo only as fallback. Use these pixels for garment-detail follow-up questions.</text>
    `)
    const tiles = await Promise.all(row.pieces.map(async (piece, pieceIndex) => ({
      input: await makeGarmentTile(piece, tileW, tileH),
      left: 44 + pieceIndex * (tileW + 18),
      top: y + 72
    })))
    composites.push(...tiles)
  }

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f6f1eb"/>
    <text x="32" y="38" font-family="Georgia, serif" font-size="30" fill="#2f2924">Current generated outfit garment references</text>
    <text x="32" y="64" font-family="Arial, sans-serif" font-size="14" fill="#786d63">Grouped by generated card. Inspect the garment photos directly before answering follow-up questions about details.</text>
    ${rowSvgs.join('')}
  </svg>`
  const buffer = await sharp(Buffer.from(svg)).composite(composites).jpeg({ quality: 86 }).toBuffer()
  return { base64: buffer.toString('base64'), mime: 'image/jpeg' }
}

export async function makeWholeWardrobeCandidateContactSheet(candidates = [], candidatePieces = [], maxCandidates = 12) {
  const shown = candidates.slice(0, maxCandidates)
  const width = 1120
  const rowHeight = 196
  const headerHeight = 76
  const height = headerHeight + shown.length * rowHeight + 28
  const composites = []
  const rowSvgs = []

  for (const [index, candidate] of shown.entries()) {
    const y = headerHeight + index * rowHeight
    const pieces = fullPiecesForCandidate(candidate, candidatePieces).slice(0, 5)
    const title = `${candidate.candidateId}: ${pieces.map(piece => piece.name).join(' + ')}`
    const formula = wholeWardrobeCandidateAxes(candidate).formula
    rowSvgs.push(`
      <rect x="24" y="${y}" width="${width - 48}" height="${rowHeight - 14}" rx="18" fill="#fffaf7" stroke="#ddd1c6"/>
      <text x="44" y="${y + 30}" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#3f352e">${escapeSvgText(title)}</text>
      <text x="44" y="${y + 54}" font-family="Arial, sans-serif" font-size="12" fill="#81756b">formula: ${escapeSvgText(formula)}${candidate.localReasons?.length ? ` · ${escapeSvgText(candidate.localReasons.join('; '))}` : ''}</text>
    `)
    composites.push(...await Promise.all(pieces.map(async (piece, pieceIndex) => ({
      input: await makeGarmentTile(piece, 150, 132),
      left: 44 + pieceIndex * 166,
      top: y + 62
    }))))
  }

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f4efe8"/>
    <text x="32" y="38" font-family="Georgia, serif" font-size="30" fill="#2f2924">Whole wardrobe candidate sheet</text>
    <text x="32" y="62" font-family="Arial, sans-serif" font-size="14" fill="#786d63">Choose visually coherent outfits by candidate ID. Use the garment photos, not just the labels.</text>
    ${rowSvgs.join('')}
  </svg>`
  const buffer = await sharp(Buffer.from(svg)).composite(composites).jpeg({ quality: 84 }).toBuffer()
  return { base64: buffer.toString('base64'), mime: 'image/jpeg', shownCandidateIds: shown.map(candidate => candidate.candidateId) }
}

export async function makeSelectedPieceCandidateContactSheet(selectedPiece, rankedCandidates = [], maxCandidates = 18) {
  const shown = rankedCandidates.slice(0, maxCandidates)
  const width = 1120
  const selectedHeight = 178
  const rowHeight = 164
  const headerHeight = 76
  const height = headerHeight + selectedHeight + shown.length * rowHeight + 28
  const composites = []
  const rowSvgs = []

  composites.push({
    input: await makeGarmentTile(selectedPiece, 150, 132),
    left: 44,
    top: headerHeight + 34
  })
  rowSvgs.push(`
    <rect x="24" y="${headerHeight}" width="${width - 48}" height="${selectedHeight - 14}" rx="18" fill="#fffaf7" stroke="#c7ab91"/>
    <text x="214" y="${headerHeight + 48}" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#3f352e">Selected garment: ${escapeSvgText(selectedPiece?.name || 'garment')}</text>
    <text x="214" y="${headerHeight + 76}" font-family="Arial, sans-serif" font-size="13" fill="#81756b">${escapeSvgText(buildPieceText(selectedPiece).slice(0, 360))}</text>
  `)

  for (const [index, ranked] of shown.entries()) {
    const y = headerHeight + selectedHeight + index * rowHeight
    const piece = ranked.piece
    rowSvgs.push(`
      <rect x="24" y="${y}" width="${width - 48}" height="${rowHeight - 14}" rx="18" fill="#fbfaf8" stroke="#ddd1c6"/>
      <text x="214" y="${y + 34}" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#3f352e">cand-${index + 1} / id ${piece.id}: ${escapeSvgText(piece.name)} (${escapeSvgText(piece.category || '')})</text>
      <text x="214" y="${y + 58}" font-family="Arial, sans-serif" font-size="12" fill="#81756b">score ${Math.round(ranked.score || 0)}${ranked.reasons?.length ? ` · ${escapeSvgText(ranked.reasons.slice(0, 3).join('; '))}` : ''}</text>
      <text x="214" y="${y + 84}" font-family="Arial, sans-serif" font-size="12" fill="#81756b">${escapeSvgText(buildPieceText(piece).slice(0, 260))}</text>
    `)
    composites.push({
      input: await makeGarmentTile(piece, 150, 132),
      left: 44,
      top: y + 16
    })
  }

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f4efe8"/>
    <text x="32" y="38" font-family="Georgia, serif" font-size="30" fill="#2f2924">Selected-piece candidate sheet</text>
    <text x="32" y="62" font-family="Arial, sans-serif" font-size="14" fill="#786d63">Rank support garments by actual photo compatibility with the selected garment. Use garment photos, not just labels.</text>
    ${rowSvgs.join('')}
  </svg>`
  const buffer = await sharp(Buffer.from(svg)).composite(composites).jpeg({ quality: 84 }).toBuffer()
  return { base64: buffer.toString('base64'), mime: 'image/jpeg', shownPieceIds: shown.map(r => Number(r.piece.id)).filter(Boolean) }
}

export async function rankSelectedPieceCandidatesWithVision({ selectedPiece, rankedCandidates = [], occasion, season, mission, mood, question, memoryText = '' }) {
  const candidatesWithPhotos = rankedCandidates.filter(r => r?.piece && (r.piece.photo || r.piece.worn_photo))
  const reviewCandidates = (candidatesWithPhotos.length >= 8 ? candidatesWithPhotos : rankedCandidates).slice(0, 18)
  if (!selectedPiece || !reviewCandidates.length || !(selectedPiece.photo || selectedPiece.worn_photo || reviewCandidates.some(r => r.piece?.photo || r.piece?.worn_photo))) return null

  const sheet = await makeSelectedPieceCandidateContactSheet(selectedPiece, reviewCandidates, 18)
  const candidateTruth = reviewCandidates.map((ranked, index) => {
    const piece = ranked.piece
    return `${index + 1}. id ${piece.id}: ${piece.name} (${piece.category})\n${buildPieceText(piece)}`
  }).join('\n\n')
  const raw = await askStylist({
    system: VISUAL_SUPPORT_CRITIC_SYSTEM,
    maxTokens: 900,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: sheet.mime, data: sheet.base64 } },
        { type: 'text', text: [
          `Occasion: ${occasion || 'casual'}`,
          `Season: ${season || 'current season'}`,
          mission && mission !== 'mix' ? `Mission: ${mission}` : '',
          mood ? `Mood: ${mood}` : '',
          question ? `User request: ${question}` : '',
          memoryText ? `Taste memory:\n${memoryText.slice(0, 5000)}` : '',
          `Selected garment truth:\n${buildPieceText(selectedPiece)}`,
          `Candidate truth:\n${candidateTruth}`,
          '',
          `Return JSON exactly like:
{
  "rankedPieceIds": [12, 45, 9],
  "rejectedPieceIds": [{"pieceId": 22, "reason": "photo-specific reason"}],
  "visualLearning": "one concise observation"
}`,
          'Reject or push down pieces where the actual photo contradicts the text/tag read, the style family fights the selected garment, or the shoe/outerwear looks wrong for the outfit logic.'
        ].filter(Boolean).join('\n\n') }
      ]
    }]
  })
  const parsed = safeJsonFromModel(raw)
  const rejectMap = new Map((parsed.rejectedPieceIds || []).map(item => {
    if (typeof item === 'object' && item !== null) return [Number(item.pieceId), item.reason || 'visual critic rejected']
    return [Number(item), 'visual critic rejected']
  }).filter(([id]) => Number.isFinite(id)))
  const rankMap = new Map((parsed.rankedPieceIds || []).map((id, index) => [Number(id), index]))
  const reviewedIds = new Set(sheet.shownPieceIds)
  const reviewed = rankedCandidates.map(ranked => {
    const id = Number(ranked.piece.id)
    const rankIndex = rankMap.has(id) ? rankMap.get(id) : null
    const rejected = rejectMap.get(id)
    const visualBoost = rankIndex !== null ? Math.max(4, 42 - rankIndex * 3) : 0
    const visualPenalty = rejected ? -70 : 0
    const visualReason = rejected
      ? `visual critic warning: ${rejected}`
      : rankIndex !== null
        ? `visual critic promoted from garment photo review`
        : reviewedIds.has(id)
          ? `visual critic reviewed but did not promote`
          : ''
    return {
      ...ranked,
      score: (ranked.score || 0) + visualBoost + visualPenalty,
      reasons: [...(ranked.reasons || []), visualReason].filter(Boolean)
    }
  })
  return {
    rankedCandidates: reviewed.sort((a, b) => b.score - a.score || String(a.piece.category).localeCompare(String(b.piece.category))),
    debug: {
      reviewedPieceIds: sheet.shownPieceIds,
      rankedPieceIds: parsed.rankedPieceIds || [],
      rejectedPieceIds: parsed.rejectedPieceIds || [],
      visualLearning: parsed.visualLearning || ''
    }
  }
}

export async function rankWholeWardrobeCandidatesWithVision({ candidates = [], candidatePieces = [], occasion, season, mood, memoryText = '', limit = 5 }) {
  const candidatesWithPhotos = candidates.filter(candidate =>
    fullPiecesForCandidate(candidate, candidatePieces).some(piece => piece.photo || piece.worn_photo)
  )
  const reviewSource = candidatesWithPhotos.length >= 6 ? candidatesWithPhotos : candidates
  const testReviewLimit = process.env.NODE_ENV === 'test'
    ? Math.max(0, Number(process.env.WARDROBE_TEST_MAX_WHOLE_WARDROBE_REVIEW_CANDIDATES) || 0)
    : 0
  const reviewCandidates = selectDiverseWholeWardrobeCandidates(reviewSource, testReviewLimit || 18, { occasion })
  if (!reviewCandidates.length) return null

  const sheet = await makeWholeWardrobeCandidateContactSheet(reviewCandidates, candidatePieces, 18)
  const candidateTruth = wholeWardrobeCandidateText(reviewCandidates)
  const moodProfile = wholeWardrobeMoodProfile(mood)
  const raw = await askStylist({
    system: VISUAL_WARDROBE_CRITIC_SYSTEM,
    maxTokens: 900,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: sheet.mime, data: sheet.base64 } },
        { type: 'text', text: [
          `Occasion: ${occasion || 'casual'}`,
          `Season: ${season || 'current season'}`,
          `Mood: ${mood || 'artistic minimalist'}`,
          moodProfile ? `Mood interpretation:\n${moodProfile.guidance}` : '',
          memoryText ? `Taste memory:\n${memoryText}` : '',
          `Candidate truth:\n${candidateTruth}`,
          '',
          `Return JSON exactly like:
{
  "rankedCandidateIds": ["cand-1", "cand-7"],
  "rejectedCandidateIds": [{"candidateId": "cand-3", "reason": "visual reason"}],
  "visualLearning": "one concise observation"
}`,
          `Rank up to ${Math.max(limit, 5)} candidates. Prefer visual coherence, good fit/trust, garment rotation, and actual outfit appeal over safe repeated formulas.`
        ].filter(Boolean).join('\n\n') }
      ]
    }]
  })
  const parsed = safeJsonFromModel(raw)
  const rankedIds = Array.isArray(parsed.rankedCandidateIds) ? parsed.rankedCandidateIds.filter(id => sheet.shownCandidateIds.includes(id)) : []
  if (!rankedIds.length) return null
  const byId = new Map(candidates.map(candidate => [candidate.candidateId, candidate]))
  const ranked = rankedIds.map(id => byId.get(id)).filter(Boolean)
  const rest = candidates.filter(candidate => !rankedIds.includes(candidate.candidateId))
  return {
    candidates: [...ranked, ...rest],
    visualRejected: parsed.rejectedCandidateIds || [],
    visualLearning: parsed.visualLearning || '',
    reviewedCandidateIds: sheet.shownCandidateIds,
    rankedCandidateIds: rankedIds
  }
}

export function getOpenAIImageModel() {
  const configured = String(process.env.OPENAI_IMAGE_MODEL || '').trim()
  const unsupported = new Set(['dall-e-2', 'dall-e-3', 'dalle-2', 'dalle-3'])
  if (configured && !unsupported.has(configured.toLowerCase())) return configured
  return 'gpt-image-1'
}

export function getOpenAIImageFallbackModels() {
  const primary = getOpenAIImageModel()
  return [primary, 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini', 'chatgpt-image-latest']
    .filter((m, i, arr) => m && arr.indexOf(m) === i)
}

export function getOpenAIImageSize(kind = 'generate') {
  return kind === 'identity'
    ? (process.env.OPENAI_IDENTITY_IMAGE_SIZE || process.env.OPENAI_EDITORIAL_IMAGE_SIZE || process.env.OPENAI_IMAGE_SIZE || '1024x1536')
    : (process.env.OPENAI_EDITORIAL_IMAGE_SIZE || process.env.OPENAI_IMAGE_SIZE || '1024x1536')
}

export async function runOpenAIImageGeneration({ client, prompt, size, kind = 'generate', imagePath = null }) {
  let lastError = null
  for (const model of getOpenAIImageFallbackModels()) {
    try {
      if (kind === 'edit' && imagePath) {
        return await client.images.edit({
          model,
          image: await toFile(fs.createReadStream(imagePath), path.basename(imagePath), { type: 'image/png' }),
          prompt,
          size,
          n: 1
        })
      }
      return await client.images.generate({
        model,
        prompt,
        size,
        n: 1
      })
    } catch (err) {
      lastError = err
      console.error(`OpenAI image ${kind} failed with ${model}:`, err.message)
    }
  }
  throw lastError || new Error('OpenAI image generation failed')
}

export function inferBoardLabel(block, index) {
  const heading = String(block || '').split('\n').find(line => /^\*\*[^*]+\*\*/.test(line.trim()))
  if (heading) return heading.replace(/\*/g, '').trim().replace(/^\d+\.?\s*/, '')
  return index === 0 ? 'signature / strongest direction' : index === 1 ? 'usable variation' : 'optional experimental direction'
}

export function extractPiecesLine(block) {
  const line = String(block || '').split('\n').find(l => /^\s*Pieces\s*:/i.test(l))
  return line ? line.replace(/^\s*Pieces\s*:/i, '').trim() : ''
}

export function extractWhyLine(block) {
  const line = String(block || '').split('\n').find(l => /^\s*Why it works\s*:/i.test(l))
  return line ? line.replace(/^\s*Why it works\s*:/i, '').trim() : ''
}

export function extractWatchLine(block) {
  const line = String(block || '').split('\n').find(l => /^\s*Watch for\s*:/i.test(l))
  const value = line ? line.replace(/^\s*Watch for\s*:/i, '').trim() : ''
  return /^none$/i.test(value) ? '' : value
}

export function piecesMentionedInLine(line, candidatePieces, selectedPiece) {
  const normalizedLine = normalizeForMatch(line)
  const scored = []
  for (const piece of candidatePieces) {
    const name = normalizeForMatch(piece.name)
    if (!name) continue
    if (normalizedLine.includes(name)) {
      scored.push({ piece, score: name.length + 100 })
      continue
    }
    const words = name.split(' ').filter(w => w.length > 2)
    if (!words.length) continue
    const hits = words.filter(w => normalizedLine.includes(w)).length
    const score = hits / words.length
    if (score >= 0.72 && hits >= Math.min(3, words.length)) scored.push({ piece, score: score * 80 + hits })
  }
  const byId = new Map()
  for (const { piece, score } of scored.sort((a,b) => b.score - a.score)) {
    if (!byId.has(Number(piece.id))) byId.set(Number(piece.id), piece)
  }
  if (selectedPiece?.id && !byId.has(Number(selectedPiece.id))) byId.set(Number(selectedPiece.id), selectedPiece)
  return [...byId.values()]
}

export function inferMissingCategory(name = '') {
  const n = normalizeForMatch(name)
  if (/boot|loafer|flat|sandal|sneaker|shoe|mule/.test(n)) return 'shoes'
  if (/pant|jean|trouser|skirt|short/.test(n)) return 'bottom'
  if (/jacket|cardigan|blazer|coat|vest/.test(n)) return 'outerwear'
  if (/bag|belt|necklace|earring|bracelet|scarf|tote|crossbody/.test(n)) return 'accessory'
  if (/dress/.test(n)) return 'dress'
  return 'missing piece'
}

export function missingPiecesMentionedInLine(line, candidatePieces = []) {
  const text = String(line || '')
  const found = []
  const seen = new Set()
  const patterns = [
    /\[missing\s*:\s*([^\]]+)\]/gi,
    /\(missing\s*:\s*([^\)]+)\)/gi,
    /missing-piece idea\s*:\s*([^+;,.]+)/gi
  ]
  for (const pattern of patterns) {
    let m
    while ((m = pattern.exec(text))) {
      const raw = String(m[1] || '').replace(/^idea\s*:/i, '').trim()
      const name = raw.replace(/^a\s+|^an\s+|^the\s+/i, '').trim()
      if (!name) continue
      const normalized = normalizeForMatch(name)
      if (!normalized || seen.has(normalized)) continue
      if (candidatePieces.some(p => normalizeForMatch(p.name) === normalized)) continue
      seen.add(normalized)
      found.push({
        id: `missing-${normalized.replace(/\s+/g, '-')}`,
        name: `${name} (missing piece)`,
        category: inferMissingCategory(name),
        missing: true,
        photo: null,
        worn_photo: null
      })
    }
  }
  return found
}

export function structuredOutfitsFromGeneratedText(answer, selectedPiece, candidatePieces) {
  const text = String(answer || '')
  const sections = []
  const labelPattern = 'Signature \/ strongest direction|Best owned wardrobe direction|Ideal editorial completion|Usable variation|Optional experimental direction'
  const regex = new RegExp('\\*\\*(' + labelPattern + ')\\*\\*([\\s\\S]*?)(?=\\n\\*\\*(?:' + labelPattern + '|I would skip|Avoid for this garment|Saveable learning)|$)', 'gi')
  let match
  while ((match = regex.exec(text))) {
    sections.push({ label: match[1], block: match[2] })
  }
  if (!sections.length) {
    const chunks = text.split(/\n---\n/).filter(chunk => /Pieces\s*:/i.test(chunk)).slice(0, 3)
    chunks.forEach((block, i) => sections.push({ label: inferBoardLabel(block, i), block }))
  }
  return sections.map((section, i) => {
    const line = extractPiecesLine(section.block)
    const pieces = piecesMentionedInLine(line, candidatePieces, selectedPiece)
    const missingPieces = missingPiecesMentionedInLine(line, candidatePieces)
    const reason = extractWhyLine(section.block)
    const watchFor = extractWatchLine(section.block)
    return {
      label: section.label.toLowerCase(),
      reason: reason || `${section.label} using saved wardrobe pieces and/or missing-piece archetypes`,
      watchFor,
      pieceIds: pieces.map(p => Number(p.id)).filter(Boolean),
      missingPieces,
      pieces: [
        ...pieces.map(p => ({ id: p.id, name: p.name, category: p.category })),
        ...missingPieces.map(p => ({ id: p.id, name: p.name, category: p.category, missing: true }))
      ]
    }
  }).filter(o => o.pieceIds.includes(Number(selectedPiece.id)) && (o.pieceIds.length + (o.missingPieces?.length || 0)) >= 2)
}

export function hasMissingPiecesInStructuredOutfits(structuredOutfits = []) {
  return (structuredOutfits || []).some(o =>
    (Array.isArray(o?.missingPieces) && o.missingPieces.length) ||
    (Array.isArray(o?.pieces) && o.pieces.some(p => p?.missing || String(p?.id || '').startsWith('missing-')))
  )
}

export function buildIdealMissingCompletionForPiece(selectedPiece, existingOutfits = []) {
  if (!selectedPiece?.id) return null
  const name = String(selectedPiece.name || '').toLowerCase()
  const category = String(selectedPiece.category || '').toLowerCase()
  const isTop = category.includes('top')
  const isBottom = category.includes('bottom') || category.includes('pants') || category.includes('skirt')
  let missing = []
  let reason = 'Ideal editorial completion using missing-piece archetypes to show the strongest direction, not just the closest owned substitute.'

  if (isTop) {
    if (/lace|sheer|floral|soft|cream|appliqu/.test(name)) {
      missing = [
        { id: 'missing-grounded-olive-utility-trouser', name: 'grounded olive utility trouser (missing piece)', category: 'bottom', missing: true },
        { id: 'missing-cognac-or-brown-grounded-flat', name: 'cognac grounded flat or loafer (missing piece)', category: 'shoes', missing: true },
      ]
      reason = 'Ideal editorial completion: a grounded olive utility trouser gives the soft top visual gravity, while cognac footwear keeps the warmth intentional.'
    } else if (/stripe|button|shirt|tailor|structured/.test(name)) {
      missing = [
        { id: 'missing-deep-navy-or-charcoal-long-column-trouser', name: 'deep navy or charcoal long column trouser (missing piece)', category: 'bottom', missing: true },
        { id: 'missing-slim-loafer-or-grounded-flat', name: 'slim loafer or grounded flat (missing piece)', category: 'shoes', missing: true },
      ]
      reason = 'Ideal editorial completion: a long dark column keeps the structured top clean and avoids breaking the vertical line.'
    } else {
      missing = [
        { id: 'missing-structured-earth-tone-trouser', name: 'structured earth-tone trouser (missing piece)', category: 'bottom', missing: true },
        { id: 'missing-grounded-walking-flat', name: 'grounded walking flat (missing piece)', category: 'shoes', missing: true },
      ]
      reason = 'Ideal editorial completion: a structured trouser and grounded shoe clarify the silhouette without adding more visual noise.'
    }
  } else if (isBottom) {
    missing = [
      { id: 'missing-compact-artistic-knit-or-shell', name: 'compact artistic knit or shell (missing piece)', category: 'top', missing: true },
      { id: 'missing-grounded-low-profile-shoe', name: 'grounded low-profile shoe (missing piece)', category: 'shoes', missing: true },
    ]
    reason = 'Ideal editorial completion: a compact top keeps the selected bottom central while the shoe stabilizes the lower line.'
  } else {
    missing = [
      { id: 'missing-simple-grounding-support-piece', name: 'simple grounding support piece (missing piece)', category: 'bottom', missing: true },
    ]
  }

  return {
    label: 'ideal editorial completion',
    reason,
    pieceIds: [Number(selectedPiece.id)],
    missingPieces: missing,
    pieces: [
      { id: selectedPiece.id, name: selectedPiece.name, category: selectedPiece.category },
      ...missing
    ]
  }
}

export function ensureIdealMissingCompletion(structuredOutfits, selectedPiece, forceVisible = false) {
  const outfits = Array.isArray(structuredOutfits) ? [...structuredOutfits] : []
  if (!forceVisible && hasMissingPiecesInStructuredOutfits(outfits)) return outfits
  const ideal = buildIdealMissingCompletionForPiece(selectedPiece, outfits)
  if (!ideal) return outfits
  const filtered = outfits.filter(o => !/optional experimental/i.test(String(o?.label || '')))
  return [filtered[0], ideal, ...filtered.slice(1)].filter(Boolean).slice(0, 3)
}

export function buildIdealOnlyCompletionsForPiece(selectedPiece) {
  const name = String(selectedPiece?.name || '').toLowerCase()
  const category = String(selectedPiece?.category || '').toLowerCase()
  const selected = { id: selectedPiece.id, name: selectedPiece.name, category: selectedPiece.category }
  const isTop = category.includes('top')
  const isBottom = category.includes('bottom') || /pant|jean|skirt|trouser/.test(name)

  const make = (label, reason, missing) => ({
    label,
    reason,
    pieceIds: [Number(selectedPiece.id)],
    missingPieces: missing,
    pieces: [selected, ...missing]
  })

  if (isTop && /lace|sheer|cream|floral|appliqu|soft/.test(name)) {
    return [
      make('ideal relaxed earthy', 'A grounded olive utility trouser gives the delicate top visual gravity without making the outfit stiff.', [
        { id: 'missing-grounded-olive-utility-trouser', name: 'grounded olive utility trouser (missing piece)', category: 'bottom', missing: true },
        { id: 'missing-cognac-leather-flat-or-loafer', name: 'cognac leather flat or loafer (missing piece)', category: 'shoes', missing: true }
      ]),
      make('ideal soft structured', 'A clean cream structured trouser keeps the palette quiet while adding enough architecture below the lace.', [
        { id: 'missing-cream-structured-full-length-trouser', name: 'cream structured full-length trouser (missing piece)', category: 'bottom', missing: true },
        { id: 'missing-nude-or-taupe-flat', name: 'nude or taupe flat (missing piece)', category: 'shoes', missing: true }
      ]),
      make('ideal modern preppy', 'A dark navy pencil or midi skirt gives the soft top a restrained vertical anchor.', [
        { id: 'missing-deep-navy-pencil-or-midi-skirt', name: 'deep navy pencil or midi skirt (missing piece)', category: 'bottom', missing: true },
        { id: 'missing-navy-or-black-loafer', name: 'navy or black loafer (missing piece)', category: 'shoes', missing: true }
      ])
    ]
  }

  if (isTop && /stripe|button|shirt|structured|sleeveless/.test(name)) {
    return [
      make('ideal long column', 'A long dark trouser gives the graphic top a cleaner vertical base than a cropped or playful bottom.', [
        { id: 'missing-deep-navy-long-column-trouser', name: 'deep navy long column trouser (missing piece)', category: 'bottom', missing: true },
        { id: 'missing-low-profile-loafer', name: 'low-profile loafer (missing piece)', category: 'shoes', missing: true }
      ]),
      make('ideal relaxed earthy', 'An olive or tobacco utility pant softens the graphic stripe while keeping enough structure.', [
        { id: 'missing-olive-or-tobacco-utility-pant', name: 'olive or tobacco utility pant (missing piece)', category: 'bottom', missing: true },
        { id: 'missing-cognac-flat', name: 'cognac flat (missing piece)', category: 'shoes', missing: true }
      ])
    ]
  }

  if (isBottom) {
    return [
      make('ideal compact top', 'A compact structured top keeps the selected bottom central and avoids extra volume at the waist.', [
        { id: 'missing-compact-navy-shell-or-knit', name: 'compact navy shell or knit (missing piece)', category: 'top', missing: true },
        { id: 'missing-grounded-low-profile-shoe', name: 'grounded low-profile shoe (missing piece)', category: 'shoes', missing: true }
      ]),
      make('ideal artistic restraint', 'A quiet graphic or textural top adds interest without competing with the selected bottom.', [
        { id: 'missing-quiet-graphic-structured-top', name: 'quiet graphic structured top (missing piece)', category: 'top', missing: true },
        { id: 'missing-cognac-or-dark-flat', name: 'cognac or dark flat (missing piece)', category: 'shoes', missing: true }
      ])
    ]
  }

  return [buildIdealMissingCompletionForPiece(selectedPiece)].filter(Boolean)
}

export function boardPlanFromStructuredOutfits(structuredOutfits, selectedPiece, candidatePieces) {
  if (!Array.isArray(structuredOutfits) || !structuredOutfits.length) return []
  const candidateById = new Map(candidatePieces.map(p => [Number(p.id), p]))
  return structuredOutfits.slice(0, 3).map((outfit, index) => {
    const ids = Array.isArray(outfit.pieceIds)
      ? outfit.pieceIds.map(Number)
      : Array.isArray(outfit.pieces)
        ? outfit.pieces.map(p => Number(p.id || p.pieceId)).filter(Boolean)
        : []
    if (selectedPiece?.id && !ids.includes(Number(selectedPiece.id))) ids.unshift(Number(selectedPiece.id))
    const unique = [...new Set(ids)].filter(id => candidateById.has(id)).slice(0, 5)
    const missingPieces = Array.isArray(outfit.missingPieces)
      ? outfit.missingPieces
      : Array.isArray(outfit.pieces)
        ? outfit.pieces.filter(p => p?.missing || String(p?.id || '').startsWith('missing-')).map(p => ({
            id: p.id || `missing-${normalizeForMatch(p.name).replace(/\s+/g, '-')}`,
            name: p.name || 'missing piece',
            category: p.category || inferMissingCategory(p.name),
            missing: true,
            photo: null,
            worn_photo: null
          }))
        : []
    return {
      label: outfit.label || (index === 0 ? 'strongest artistic-minimal' : index === 1 ? 'usable variation' : 'optional experimental'),
      reason: outfit.reason || outfit.why || '',
      watchFor: outfit.watchFor || outfit.watch_for || '',
      pieceIds: unique,
      missingPieces: missingPieces.slice(0, Math.max(0, 5 - unique.length))
    }
  }).filter(b => (b.pieceIds.length + (b.missingPieces?.length || 0)) >= 2)
}

export function dedupeBoardPiecesForRender(pieces = []) {
  const seenIds = new Set()
  const seenNames = new Set()
  const result = []
  for (const piece of pieces) {
    if (!piece) continue
    const rawId = piece.id
    const numericId = Number(rawId)
    const hasRealNumericId = Number.isFinite(numericId) && numericId > 0
    const nameKey = normalizeForMatch(piece.name || '')
    const categoryKey = normalizeForMatch(piece.category || '')
    const key = `${nameKey}|${categoryKey}`

    if (hasRealNumericId && seenIds.has(numericId)) continue
    if (nameKey && seenNames.has(key)) continue

    seenIds.add(numericId)
    if (nameKey) seenNames.add(key)
    result.push(piece)
  }
  return result
}

export function dedupeMissingAgainstOwned(missingPieces = [], ownedPieces = []) {
  const ownedKeys = new Set(ownedPieces.map(p => `${normalizeForMatch(p.name)}|${normalizeForMatch(p.category)}`))
  const ownedNames = new Set(ownedPieces.map(p => normalizeForMatch(p.name)))
  const seen = new Set()
  const result = []
  for (const piece of missingPieces || []) {
    const nameKey = normalizeForMatch(piece?.name || '').replace(/ missing piece$/i, '').trim()
    const categoryKey = normalizeForMatch(piece?.category || '')
    const key = `${nameKey}|${categoryKey}`
    if (!nameKey) continue
    if (ownedNames.has(nameKey) || ownedKeys.has(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    result.push(piece)
  }
  return result
}

export function photoPreservingVisualsEnabled() {
  return String(process.env.PHOTO_PRESERVING_VISUALS || 'false').toLowerCase() === 'true'
}

export async function makePhotoPanel(filePath, width, height, label = 'source photo') {
  let image
  try {
    image = await sharp(filePath)
      .rotate()
      .resize(width - 24, height - 70, { fit: 'cover', position: 'top' })
      .png()
      .toBuffer()
  } catch (err) {
    image = await makeTextTile({ width: width - 24, height: height - 70, title: label, subtitle: 'photo unavailable' })
  }
  const safeLabel = escapeSvgText(label)
  const frame = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" rx="24" fill="#fffaf4" stroke="#d8c9b7" stroke-width="2"/>
    <text x="18" y="${height - 30}" font-family="Arial, sans-serif" font-size="15" fill="#6d6259">${safeLabel}</text>
  </svg>`
  return sharp(Buffer.from(frame)).composite([{ input: image, left: 12, top: 12 }]).png().toBuffer()
}

export function makeMissingPieceObject(name, idx = 0) {
  return {
    id: `missing-visual-${idx}-${normalizeForMatch(name).replace(/\s+/g, '-')}`,
    name: String(name || 'missing piece'),
    category: inferMissingCategory(name),
    missing: true,
    photo: null,
    worn_photo: null
  }
}

export async function createPhotoPreservingCollageImage({ title, subtitle, sourcePath = null, selectedPiece = null, pieces = [], missingPieces = [], reason = '', index = 1, prefix = 'photo-collage' }) {
  const boardDir = path.join(uploadsDir, 'generated-boards')
  if (!fs.existsSync(boardDir)) fs.mkdirSync(boardDir, { recursive: true })

  const width = 1024
  const height = sourcePath ? 1280 : 900
  const safeTitle = escapeSvgText(title || 'Photo-preserving board')
  const safeSubtitle = escapeSvgText(subtitle || 'Real-photo / saved-garment collage')
  const safeReason = escapeSvgText(reason || 'Uses real saved images rather than generating a new person or scene.')
  const baseSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f7f3ed"/>
    <text x="48" y="58" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#3f3832">${safeTitle}</text>
    <text x="48" y="88" font-family="Arial, sans-serif" font-size="15" fill="#756a62">${safeSubtitle}</text>
    <foreignObject x="48" y="${height - 110}" width="900" height="58"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.35; color:#6d6259;">${safeReason}</div></foreignObject>
    <text x="48" y="${height - 28}" font-family="Arial, sans-serif" font-size="12" fill="#9b9087">Photo-preserving collage: source/saved photos are kept as photos; no synthetic person rendering.</text>
  </svg>`

  const composites = []
  let x = 52
  if (sourcePath) {
    const sourcePanel = await makePhotoPanel(sourcePath, 430, 780, 'source photo preserved')
    composites.push({ input: sourcePanel, left: 52, top: 126 })
    x = 520
  }

  const visualPieces = []
  if (selectedPiece) visualPieces.push({ ...selectedPiece, _labelPrefix: 'anchor' })
  for (const piece of pieces || []) {
    if (selectedPiece?.id && Number(piece?.id) === Number(selectedPiece.id)) continue
    visualPieces.push(piece)
  }
  for (const [idx, name] of (missingPieces || []).entries()) visualPieces.push(makeMissingPieceObject(name, idx))

  const tileW = sourcePath ? 200 : 190
  const tileH = sourcePath ? 244 : 230
  const positions = sourcePath
    ? [[520,126],[760,126],[520,404],[760,404],[640,682]]
    : [[70,150],[292,150],[514,150],[736,150],[292,440],[514,440]]

  for (let i = 0; i < visualPieces.slice(0, positions.length).length; i++) {
    const tile = await makeGarmentTile(visualPieces[i], tileW, tileH)
    composites.push({ input: tile, left: positions[i][0], top: positions[i][1] })
  }

  const filename = `generated-boards/${prefix}-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(uploadsDir, filename)
  await sharp(Buffer.from(baseSvg)).composite(composites).png().toFile(outPath)
  return `/uploads/${filename}`
}

export async function createOutfitBoardImage({ board, pieces, index }) {
  const boardDir = path.join(uploadsDir, 'generated-boards')
  if (!fs.existsSync(boardDir)) fs.mkdirSync(boardDir, { recursive: true })

  const width = 900
  const height = 620
  const headerSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f7f3ed"/>
    <text x="48" y="54" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#3f3832">${escapeSvgText(board.label || 'Outfit board')}</text>
    <text x="48" y="84" font-family="Arial, sans-serif" font-size="14" fill="#756a62">${escapeSvgText(board.reason || 'Wardrobe styling board')}</text>
    <text x="48" y="590" font-family="Arial, sans-serif" font-size="12" fill="#9b9087">Visual board uses saved garment photos; missing pieces appear as labeled placeholders.</text>
  </svg>`

  const tileW = 190
  const tileH = 230
  const coords = [
    [64, 132], [270, 122], [476, 132], [654, 174], [372, 370]
  ]
  const composites = []
  for (let i = 0; i < pieces.slice(0, 5).length; i++) {
    const tile = await makeGarmentTile(pieces[i], tileW, tileH)
    composites.push({ input: tile, left: coords[i][0], top: coords[i][1] })
  }

  const filename = `generated-boards/board-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(uploadsDir, filename)
  await sharp(Buffer.from(headerSvg)).composite(composites).png().toFile(outPath)
  return `/uploads/${filename}`
}

export async function garmentReferenceImage(piece) {
  const photo = piece?.photo || piece?.worn_photo
  if (!photo) return null
  const filePath = path.join(uploadsDir, photo)
  if (!fs.existsSync(filePath)) return null
  const buffer = await sharp(filePath)
    .rotate()
    .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84 })
    .toBuffer()
  return {
    base64: buffer.toString('base64'),
    mime: 'image/jpeg',
    label: `${piece.name} (${wardrobeCategoryGroup(piece)})`,
    piece
  }
}

export function wholeWardrobeImagePrompt({ outfit = {}, pieces = [], occasion = 'casual', season = 'current season' }) {
  const pieceLines = pieces.map((piece, index) => {
    const truth = buildPieceText(piece).replace(/\s+/g, ' ').slice(0, 900)
    return `${index + 1}. ${piece.name} (${wardrobeCategoryGroup(piece)}): ${truth}`
  }).join('\n')
  const fidelityChecklist = pieces.map((piece, index) => {
    const group = wardrobeCategoryGroup(piece)
    const blob = pieceTextBlob(piece)
    const constraints = []
    if (group === 'top') {
      if (/\b(long sleeve|long-sleeve)\b/.test(blob)) constraints.push('must remain a long-sleeve top')
      if (/\b(short sleeve|short-sleeve)\b/.test(blob)) constraints.push('must remain a short-sleeve top')
      if (/\b(sleeveless|tank)\b/.test(blob)) constraints.push('must remain sleeveless/tank shaped')
      if (/\b(v-neck|scoop|boat|mock neck|turtleneck|crew)\b/.test(blob)) constraints.push('preserve the neckline read')
      if (/\b(floral|botanical|paisley|abstract|stripe|striped|pattern|abstract|tapestry)\b/.test(blob)) constraints.push('preserve the visible top print/pattern, not a generic similar print')
    }
    if (group === 'bottom') {
      if (/\b(skirt|midi|knee|maxi)\b/.test(blob)) constraints.push('must remain the listed skirt shape/length')
      if (/\b(jean|trouser|pant|wide|straight|bootcut|crop)\b/.test(blob)) constraints.push('must remain the listed pant/jean silhouette')
      if (/\b(floral|botanical|paisley|abstract|stripe|striped|pattern|abstract|tapestry)\b/.test(blob)) constraints.push('preserve the bottom print/pattern scale and colors')
    }
    if (group === 'dress') constraints.push('must remain one dress, not separates')
    if (group === 'shoes') constraints.push('preserve shoe type, color, heel/sole shape, and openness/coverage')
    if (!constraints.length) constraints.push('preserve category, color, shape, and visible texture')
    return `${index + 1}. ${piece.name}: ${constraints.join('; ')}.`
  }).join('\n')
  return [
    'Generate one realistic full-outfit styling image using the provided saved wardrobe garment references.',
    'This is NOT a shopping/editorial concept and NOT a generated fantasy outfit. Use the listed saved garments as the outfit components.',
    '',
    'Garment fidelity rules:',
    '- Preserve each referenced garment category, color family, print/stripe/pattern scale, neckline/sleeve/hem behavior, fabric weight, and visible texture as much as possible.',
    '- Do not replace a listed wardrobe piece with a different garment.',
    '- Do not simplify a printed top into a plain/fitted tee or generic floral top. If the listed top has long sleeves, visible print, a wrap/tie, asymmetric detail, or a specific neckline, those details must still read in the generated outfit.',
    '- If two listed garments are both printed, keep both actual prints recognizable; do not merge them into one invented print.',
    '- Do not add extra hero garments, patterned layers, belts, scarves, or accessories unless the listed outfit explicitly includes them.',
    '- Shoes must match the listed shoe reference if shoes are included.',
    '',
    `Piece-specific fidelity checklist:\n${fidelityChecklist}`,
    '',
    'Person / scene:',
    '- Full figure visible from head to shoes, single adult woman, natural relaxed posture, ordinary realistic proportions, no beauty retouching.',
    '- Simple neutral or natural background, soft daylight, no text, no watermark, no collage labels.',
    '- Keep the result wearable and grounded, closer to a real try-on/photo reference than a fashion ad.',
    '',
    `Outfit label: ${outfit.label || 'Whole wardrobe outfit'}`,
    outfit.dominantDirection ? `Direction: ${outfit.dominantDirection}` : '',
    outfit.silhouette ? `Silhouette: ${outfit.silhouette}` : '',
    outfit.reason ? `Stylist mechanics: ${outfit.reason}` : '',
    outfit.watchFor ? `Avoid drift: ${outfit.watchFor}` : '',
    `Occasion: ${occasion}. Season: ${season}.`,
    '',
    `Saved wardrobe pieces to use:\n${pieceLines}`
  ].filter(Boolean).join('\n')
}

export function wholeWardrobeComparisonSheetPrompt({ outfits = [], piecesById = new Map(), occasion = 'casual', season = 'current season', mood = '' }) {
  const outfitLines = outfits.map((outfit, index) => {
    const ids = Array.isArray(outfit.pieceIds) ? outfit.pieceIds.map(Number).filter(Boolean) : []
    const pieces = ids.map(id => piecesById.get(id)).filter(Boolean)
    const pieceText = pieces.map(piece => `${piece.name} (${wardrobeCategoryGroup(piece)})`).join(' + ')
    return [
      `Panel ${index + 1}: ${outfit.label || `Outfit ${index + 1}`}`,
      outfit.dominantDirection ? `Direction: ${outfit.dominantDirection}` : '',
      outfit.silhouette ? `Silhouette: ${outfit.silhouette}` : '',
      outfit.reason ? `Mechanics: ${outfit.reason}` : '',
      `Pieces: ${pieceText}`
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  const profile = resolveOccasionProfile(occasion, mood)
  const occasionLine = profile
    ? `Occasion: ${profile.label} — style the garments for ${profile.vibe}; movement-ready, no added dressy accessories.`
    : `Occasion: ${occasion}. Season: ${season}.`

  return [
    'Generate ONE realistic visual comparison sheet containing separate full-body outfit previews for the listed saved wardrobe outfits.',
    'This is a rough preview sheet, not final individual renders.',
    'The image must look like a silent photo contact sheet, not an infographic, poster, presentation slide, or labeled fashion board.',
    '',
    'Layout rules:',
    `- Show exactly ${outfits.length} distinct panels, one outfit per panel.`,
    '- Keep panels visually separated. Do not merge garments across panels.',
    '- Each panel should show one full-body adult woman, head-to-shoes, ordinary realistic proportions, natural posture.',
    '- No text of any kind may appear inside the image.',
    '- Do not include numbers, headings, panel titles, captions, labels, garment names, typography, watermarks, tags, UI, or Pinterest-style save buttons.',
    '- Separate the panels only with plain visual spacing or subtle borders.',
    '',
    'Garment rules:',
    '- Use only the garment references assigned to each panel.',
    '- Do not swap the main garments between panels.',
    '- Preserve the garment category, color family, print scale, neckline/sleeve/hem behavior, and shoe type as much as possible.',
    '- The outfits should be visibly different as formulas, not minor recolors of the same outfit.',
    '',
    'Style direction:',
    '- Relaxed artistic realism, grounded personal style, believable wearable outfits.',
    '- Avoid fashion fantasy, influencer polish, generic catalog styling, and overly decorative accessories.',
    occasionLine,
    '',
    `Outfit panels:\n${outfitLines}`
  ].filter(Boolean).join('\n')
}

export function savedOutfitImagePrompt({ outfit = {}, pieces = [], occasion = 'casual', season = 'current season', variantMode = 'similar' }) {
  const mode = variantMode === 'creative' ? 'creative' : 'similar'
  const anchorPiece = (pieces || []).find(piece => wardrobeCategoryGroup(piece) === 'top')
    || (pieces || []).find(piece => wardrobeCategoryGroup(piece) === 'dress')
    || (pieces || [])[0]
  const pieceLines = pieces.map((piece, index) => {
    const truth = buildPieceText(piece).replace(/\s+/g, ' ').slice(0, 500)
    return `${index + 1}. ${piece.name} (${wardrobeCategoryGroup(piece)}): ${truth}`
  }).join('\n')
  return [
    mode === 'creative'
      ? 'Create one image showing three creative outfit alternatives inspired by the saved outfit photo.'
      : 'Create one image showing three similar outfit variants inspired by the saved outfit photo.',
    'Show the three alternatives side by side as a clean triptych/contact sheet. Each alternative should be a full-body outfit on the same person.',
    'Use the source photo only for identity, proportions, and fit context.',
    'Use the linked garment references when useful. You may change supporting styling pieces freely, but keep the anchor garment.',
    anchorPiece ? `Keep this linked garment as a visible anchor in all three alternatives unless the saved outfit itself has no clear anchor: ${anchorPiece.name} (${wardrobeCategoryGroup(anchorPiece)}). Do not replace or redesign that anchor garment.` : '',
    '',
    'Shared quality rules:',
    '- Avoid mere micro-variations such as only changing tuck, sleeve length, belt, jewelry, or bag.',
    '- Each alternative must change a meaningful styling axis: silhouette relationship, grounding/shoe strategy, layer logic, palette relationship, focal hierarchy, or outfit category.',
    '- Prefer high-quality styling ideas over maximum difference.',
    '- Keep proportions coherent, visual hierarchy clear, and wearability believable.',
    '- Avoid random novelty, generic catalog styling, influencer polish, bland retail styling, and overly soft beige looks.',
    '- Do not repeat the same skirt shape, same shoe family, same color family, or same layer idea across all three.',
    '',
    mode === 'creative'
      ? 'Creative alternatives mode: allow bigger changes in silhouette, palette, mood, polish level, and outfit category. The ideas may feel exploratory or surprising, but they must still read like plausible personal outfits.'
      : 'Similar variants mode: preserve the original outfit style DNA. Keep the same general mood, maintenance level, silhouette logic, and emotional tone. Change pieces enough to create useful alternatives, but the result should feel like same person, different day.',
    mode === 'creative'
      ? 'Surface at least three distinct outfit formula families across the alternatives.'
      : 'Keep the alternatives adjacent to the source outfit while avoiding near-duplicates.',
    'Full body, realistic clothing, no text, no labels, no watermark, no mirror selfie.',
    '',
    `Saved outfit: ${outfit.label || outfit.title || outfit.name || 'saved outfit'}`,
    pieceLines ? `Linked garment truth:\n${pieceLines}` : '',
    `Occasion: ${occasion}. Season: ${season}.`
  ].filter(Boolean).join('\n')
}

export async function createSavedOutfitImage({ outfit = {}, pieces = [], occasion = 'casual', season = 'current season', index = 1, variantMode = 'similar' }) {
  const startedAt = Date.now()
  const timings = {}
  const filename = `generated-boards/saved-outfit-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(uploadsDir, filename)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const sourcePath = outfit.photo ? imageUrlToUploadPath(outfit.photo) : null

  if (photoPreservingVisualsEnabled() || !process.env.OPENAI_API_KEY) {
    const collageStartedAt = Date.now()
    const imageUrl = await createPhotoPreservingCollageImage({
      title: 'Outfit alternatives',
      subtitle: variantMode === 'creative' ? 'creative outfit alternatives · photo-preserving collage' : 'similar outfit variants · photo-preserving collage',
      sourcePath,
      pieces,
      reason: 'Uses the saved outfit photo and linked garment photos as references.',
      index,
      prefix: 'saved-outfit-collage'
    })
    timings.collageMs = Date.now() - collageStartedAt
    timings.totalMs = Date.now() - startedAt
    return { imageUrl, timings, renderer: 'photo_preserving_collage' }
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const contentParts = []
    if (sourcePath) {
      const sourceStartedAt = Date.now()
      const buffer = await sharp(sourcePath)
        .rotate()
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 86 })
        .toBuffer()
      timings.sourceImageMs = Date.now() - sourceStartedAt
      contentParts.push({ type: 'input_text', text: 'Source outfit photo. Reference only. Do not recreate it exactly.' })
      contentParts.push({ type: 'input_image', image_url: `data:image/jpeg;base64,${buffer.toString('base64')}` })
    }

    const garmentStartedAt = Date.now()
    const garmentRefs = (await Promise.all(pieces.slice(0, 5).map(piece => garmentReferenceImage(piece)))).filter(Boolean)
    timings.garmentReferenceMs = Date.now() - garmentStartedAt
    for (const ref of garmentRefs) {
      contentParts.push({ type: 'input_image', image_url: `data:${ref.mime};base64,${ref.base64}` })
      contentParts.push({ type: 'input_text', text: `Linked garment reference: ${ref.label}` })
    }

    const calibrationStartedAt = Date.now()
    const calibrationRefs = await getCalibrationReferenceImagesForGeneration(2)
    timings.calibrationReferenceMs = Date.now() - calibrationStartedAt
    for (const img of calibrationRefs) {
      contentParts.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.base64}` })
      contentParts.push({ type: 'input_text', text: img.kind === 'real_photo' ? 'Identity/proportion calibration reference.' : 'Taste calibration reference.' })
    }

    contentParts.push({ type: 'input_text', text: savedOutfitImagePrompt({ outfit, pieces, occasion, season, variantMode }) })
    const gptStartedAt = Date.now()
    const response = await client.responses.create({
      model: 'gpt-4o',
      input: [{ role: 'user', content: contentParts }],
      tools: [{ type: 'image_generation', size: getOpenAIImageSize('generate'), quality: 'medium' }]
    })
    timings.gpt4oImageMs = Date.now() - gptStartedAt
    timings.usage = response.usage
    timings.imageSize = getOpenAIImageSize('generate')
    const imageItem = response.output?.find(item => item.type === 'image_generation_call')
    if (!imageItem?.result) throw new Error('GPT-4o did not return an image result')
    const writeStartedAt = Date.now()
    await fs.promises.writeFile(outPath, Buffer.from(imageItem.result, 'base64'))
    timings.writeMs = Date.now() - writeStartedAt
    timings.totalMs = Date.now() - startedAt
    return { imageUrl: `/uploads/${filename}`, timings, renderer: 'gpt-4o' }
  } catch (err) {
    console.error('Saved outfit GPT-4o image generation failed, falling back to collage:', err.message)
    timings.gpt4oError = err.message
    const imageUrl = await createPhotoPreservingCollageImage({
      title: 'Outfit alternatives',
      subtitle: variantMode === 'creative' ? 'creative alternatives fallback · source and garment photos' : 'similar variants fallback · source and garment photos',
      sourcePath,
      pieces,
      reason: `Image generation fallback: ${err.message}`,
      index,
      prefix: 'saved-outfit-fallback'
    })
    timings.totalMs = Date.now() - startedAt
    return { imageUrl, timings, renderer: 'fallback_collage' }
  }
}

export async function createWholeWardrobeOutfitImage({ outfit, pieces, occasion, season, index = 1 }) {
  const startedAt = Date.now()
  const timings = {}
  const filename = `generated-boards/whole-wardrobe-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(uploadsDir, filename)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })

  const board = {
    label: outfit.label || `Whole wardrobe outfit ${index}`,
    reason: outfit.reason || '',
  }

  if (photoPreservingVisualsEnabled() || !process.env.OPENAI_API_KEY) {
    const collageStartedAt = Date.now()
    const imageUrl = await createPhotoPreservingCollageImage({
      title: board.label,
      subtitle: 'whole-wardrobe outfit · saved garment photos',
      pieces,
      reason: outfit.reason || 'Uses saved wardrobe garment photos for evaluation.',
      index,
      prefix: 'whole-wardrobe-collage'
    })
    timings.collageMs = Date.now() - collageStartedAt
    timings.totalMs = Date.now() - startedAt
    return { imageUrl, timings, renderer: 'photo_preserving_collage' }
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const contentParts = []
    const garmentStartedAt = Date.now()
    const garmentRefs = (await Promise.all(pieces.slice(0, 5).map(piece => garmentReferenceImage(piece)))).filter(Boolean)
    timings.garmentReferenceMs = Date.now() - garmentStartedAt

    if (garmentRefs.length) {
      contentParts.push({
        type: 'input_text',
        text: `WARDROBE GARMENT REFERENCES — use these saved pieces together in one outfit. Preserve each garment as much as possible; do not invent substitutes.`
      })
      for (const ref of garmentRefs) {
        const pieceTruth = buildPieceText(ref.piece).replace(/\s+/g, ' ').slice(0, 700)
        contentParts.push({ type: 'input_text', text: `Next image is REQUIRED wardrobe reference: ${ref.label}. Preserve this exact garment in the final outfit. ${pieceTruth}` })
        contentParts.push({ type: 'input_image', image_url: `data:${ref.mime};base64,${ref.base64}` })
      }
    }

    const calibrationStartedAt = Date.now()
    const calibrationRefs = await getCalibrationReferenceImagesForGeneration(2)
    timings.calibrationReferenceMs = Date.now() - calibrationStartedAt
    for (const img of calibrationRefs) {
      contentParts.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.base64}` })
      contentParts.push({ type: 'input_text', text: img.kind === 'real_photo' ? 'Identity/proportion reference only. Do not copy outfit unless it matches listed wardrobe pieces.' : 'Taste calibration reference only.' })
    }

    contentParts.push({ type: 'input_text', text: wholeWardrobeImagePrompt({ outfit, pieces, occasion, season }) })

    const gptStartedAt = Date.now()
    const response = await client.responses.create({
      model: 'gpt-4o',
      input: [{ role: 'user', content: contentParts }],
      tools: [{ type: 'image_generation', size: getOpenAIImageSize('generate'), quality: 'medium' }]
    })
    timings.gpt4oImageMs = Date.now() - gptStartedAt
    timings.usage = response.usage
    timings.imageSize = getOpenAIImageSize('generate')
    const imageItem = response.output?.find(item => item.type === 'image_generation_call')
    if (!imageItem?.result) throw new Error('GPT-4o did not return an image result')
    const writeStartedAt = Date.now()
    await fs.promises.writeFile(outPath, Buffer.from(imageItem.result, 'base64'))
    timings.writeMs = Date.now() - writeStartedAt
    timings.totalMs = Date.now() - startedAt
    return { imageUrl: `/uploads/${filename}`, timings, renderer: 'gpt-4o' }
  } catch (err) {
    console.error('Whole-wardrobe GPT-4o image generation failed, falling back to collage:', err.message)
    timings.gpt4oError = err.message
    const fallbackStartedAt = Date.now()
    const imageUrl = await createPhotoPreservingCollageImage({
      title: board.label,
      subtitle: 'whole-wardrobe fallback · saved garment photos',
      pieces,
      reason: `Image generation fallback: ${err.message}`,
      index,
      prefix: 'whole-wardrobe-fallback'
    })
    timings.fallbackCollageMs = Date.now() - fallbackStartedAt
    timings.totalMs = Date.now() - startedAt
    return { imageUrl, timings, renderer: 'fallback_collage' }
  }
}

export async function createWholeWardrobeComparisonSheetImage({ outfits = [], piecesById = new Map(), occasion, season, mood = '' }) {
  const startedAt = Date.now()
  const timings = {}
  const filename = `generated-boards/whole-wardrobe-comparison-${Date.now()}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(uploadsDir, filename)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const shown = outfits.slice(0, 5)
  const uniquePieces = [...new Map(
    shown
      .flatMap(outfit => (outfit.pieceIds || []).map(id => piecesById.get(Number(id))).filter(Boolean))
      .map(piece => [Number(piece.id), piece])
  ).values()]

  if (photoPreservingVisualsEnabled() || !process.env.OPENAI_API_KEY) {
    const width = 1300
    const panelH = 310
    const height = 132 + shown.length * panelH
    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f7f3ed"/>
      <text x="46" y="58" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#3f3832">Whole-wardrobe preview sheet</text>
      <text x="46" y="88" font-family="Arial, sans-serif" font-size="15" fill="#756a62">Photo-preserving preview: saved garment photos only, no synthetic outfit render.</text>
      ${shown.map((outfit, index) => {
        const y = 120 + index * panelH
        return `<rect x="38" y="${y}" width="${width - 76}" height="${panelH - 24}" rx="18" fill="#fffaf4" stroke="#ddd1c5"/>
        <text x="62" y="${y + 34}" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#3f3832">${escapeSvgText(outfit.label || `Outfit ${index + 1}`)}</text>
        <text x="62" y="${y + 60}" font-family="Arial, sans-serif" font-size="13" fill="#8a7c70">${escapeSvgText((outfit.reason || '').slice(0, 150))}</text>`
      }).join('')}
    </svg>`
    const composites = []
    for (let outfitIndex = 0; outfitIndex < shown.length; outfitIndex += 1) {
      const pieces = (shown[outfitIndex].pieceIds || []).map(id => piecesById.get(Number(id))).filter(Boolean).slice(0, 5)
      const tiles = await Promise.all(pieces.map(piece => makeGarmentTile(piece, 132, 172)))
      const y = 198 + outfitIndex * panelH
      tiles.forEach((tile, tileIndex) => composites.push({ input: tile, left: 62 + tileIndex * 150, top: y }))
    }
    const fallbackStartedAt = Date.now()
    await sharp(Buffer.from(svg)).composite(composites).png().toFile(outPath)
    timings.collageMs = Date.now() - fallbackStartedAt
    timings.totalMs = Date.now() - startedAt
    return { imageUrl: `/uploads/${filename}`, timings, renderer: 'photo_preserving_collage' }
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const contentParts = [{
      type: 'input_text',
      text: 'WARDROBE GARMENT REFERENCES — these are the saved pieces available for the outfit panels. Use each piece only in the panel where it is listed in the final prompt.'
    }]
    const garmentStartedAt = Date.now()
    const garmentRefs = (await Promise.all(uniquePieces.slice(0, 18).map(piece => garmentReferenceImage(piece)))).filter(Boolean)
    timings.garmentReferenceMs = Date.now() - garmentStartedAt
    for (const ref of garmentRefs) {
      contentParts.push({ type: 'input_image', image_url: `data:${ref.mime};base64,${ref.base64}` })
      contentParts.push({ type: 'input_text', text: `Garment reference: ${ref.piece.id} — ${ref.label}` })
    }

    const calibrationStartedAt = Date.now()
    const calibrationRefs = await getCalibrationReferenceImagesForGeneration(2)
    timings.calibrationReferenceMs = Date.now() - calibrationStartedAt
    for (const img of calibrationRefs) {
      contentParts.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.base64}` })
      contentParts.push({ type: 'input_text', text: img.kind === 'real_photo' ? 'Identity/proportion reference only. Do not copy outfit unless it matches a listed panel.' : 'Taste calibration reference only.' })
    }

    contentParts.push({ type: 'input_text', text: wholeWardrobeComparisonSheetPrompt({ outfits: shown, piecesById, occasion, season, mood }) })
    const gptStartedAt = Date.now()
    const response = await client.responses.create({
      model: 'gpt-4o',
      input: [{ role: 'user', content: contentParts }],
      tools: [{ type: 'image_generation', size: getOpenAIImageSize('generate'), quality: 'medium' }]
    })
    timings.gpt4oImageMs = Date.now() - gptStartedAt
    timings.usage = response.usage
    timings.imageSize = getOpenAIImageSize('generate')
    const imageItem = response.output?.find(item => item.type === 'image_generation_call')
    if (!imageItem?.result) throw new Error('GPT-4o did not return an image result')
    const writeStartedAt = Date.now()

    const rawBuffer = Buffer.from(imageItem.result, 'base64')
    const metadata = await sharp(rawBuffer).metadata()
    const imgW = metadata.width || 1024
    const imgH = metadata.height || 1024

    const headerHeight = 240
    const colW = imgW / shown.length

    const wrapText = (text, maxChars) => {
      const words = String(text || '').split(' ')
      const lines = []
      let current = ''
      for (const word of words) {
        if ((current + ' ' + word).length > maxChars) {
          lines.push(current.trim())
          current = word
        } else {
          current += ' ' + word
        }
      }
      if (current) lines.push(current.trim())
      return lines
    }

    const headerSvg = `<svg width="${imgW}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f7f3ed"/>
      ${shown.map((outfit, index) => {
        const centerX = (index + 0.5) * colW
        const title = `${index + 1}. ${outfit.label || `Direction ${index + 1}`}`
        const lines = wrapText(outfit.reason || '', 32)
        return `
          <text x="${centerX}" y="48" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#221c16">${escapeSvgText(title)}</text>
          ${lines.map((line, lIdx) => `<text x="${centerX}" y="${76 + lIdx * 18}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#5a5045">${escapeSvgText(line)}</text>`).join('')}
        `
      }).join('')}
      <line x1="0" y1="${headerHeight - 1}" x2="${imgW}" y2="${headerHeight - 1}" stroke="#d3c7b7" stroke-width="1.5"/>
    </svg>`

    const overlaySvg = `<svg width="${imgW}" height="${headerHeight + imgH}" xmlns="http://www.w3.org/2000/svg">
      ${Array.from({ length: shown.length - 1 }).map((_, i) => {
        const lineX = (i + 1) * colW
        return `<line x1="${lineX}" y1="0" x2="${lineX}" y2="${headerHeight + imgH}" stroke="#d3c7b7" stroke-width="1.5"/>`
      }).join('')}
    </svg>`

    const combinedBuffer = await sharp({
      create: {
        width: imgW,
        height: headerHeight + imgH,
        channels: 4,
        background: { r: 247, g: 243, b: 237, alpha: 1 }
      }
    })
    .composite([
      { input: Buffer.from(headerSvg), left: 0, top: 0 },
      { input: rawBuffer, left: 0, top: headerHeight },
      { input: Buffer.from(overlaySvg), left: 0, top: 0 }
    ])
    .png()
    .toBuffer()

    await fs.promises.writeFile(outPath, combinedBuffer)
    timings.writeMs = Date.now() - writeStartedAt
    timings.totalMs = Date.now() - startedAt
    return { imageUrl: `/uploads/${filename}`, timings, renderer: 'gpt-4o_comparison_sheet' }
  } catch (err) {
    console.error('Whole-wardrobe comparison sheet generation failed, falling back to collage:', err.message)
    timings.gpt4oError = err.message
    const imageUrl = await createPhotoPreservingCollageImage({
      title: 'Whole-wardrobe preview sheet',
      subtitle: 'fallback · saved garment photos',
      pieces: uniquePieces.slice(0, 6),
      reason: `Image generation fallback: ${err.message}`,
      prefix: 'whole-wardrobe-comparison-fallback'
    })
    timings.totalMs = Date.now() - startedAt
    return { imageUrl, timings, renderer: 'fallback_collage' }
  }
}

export async function createIdealAdditionsComparisonSheetImage({
  selectedPiece, directions = [], occasion = 'casual', season = 'current season'
}) {
  const startedAt = Date.now()
  const timings = {}
  const filename = `generated-boards/ideal-additions-sheet-${Date.now()}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(uploadsDir, filename)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })

  // Single reference photo: the selected garment
  const garmentRef = await garmentReferenceImage(selectedPiece)

  const directionLines = directions.map((d, i) => [
    `FIGURE ${i + 1} — "${d.label}"`,
    `Wears the selected garment (see reference photo) plus these NEW pieces: ${
      (d.additions || []).join(', ')}`,
    d.reason ? `Styling intent: ${d.reason}` : ''
  ].filter(Boolean).join('\n')).join('\n\n')

  const promptText = [
    `Generate ONE comparison image containing ${directions.length} full-body figures of the same woman standing side by side, each labeled ${directions.map((_, i) => `"${directions[i].label}"`).join(', ')}.`,
    '',
    'Selected garment fidelity rules:',
    '- Every figure wears the EXACT garment shown in the attached reference photo. Preserve its color, length, neckline, fabric weight, and silhouette precisely. Do not restyle, recolor, or shorten it.',
    '',
    'Addition pieces:',
    '- The other pieces per figure are described in text below. Render them as plausible, realistic garments matching the descriptions.',
    '',
    'Scene:',
    '- Single adult woman, identical across all figures, natural relaxed posture, full figure head to shoes.',
    '- Neutral background, soft daylight. Small clean text label above or below each figure with its direction name. No other text, no watermark.',
    '- This is a rough comparison sheet — clarity of the outfit differences matters more than polish.',
    '',
    `Occasion: ${occasion}. Season: ${season}.`,
    '',
    directionLines
  ].join('\n')

  try {
    if (process.env.NODE_ENV === 'test') {
      const mockBuffer = await sharp({
        create: {
          width: 1024,
          height: 768,
          channels: 3,
          background: { r: 232, g: 223, b: 216 }
        }
      }).png().toBuffer()
      await fs.promises.writeFile(outPath, mockBuffer)
      timings.totalMs = Date.now() - startedAt
      return { imageUrl: `/uploads/${filename}`, timings, renderer: 'mock_gpt-4o' }
    }

    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing')
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const contentParts = []
    if (garmentRef) {
      contentParts.push({
        type: 'input_image',
        image_url: `data:${garmentRef.mime};base64,${garmentRef.base64}`
      })
      contentParts.push({ type: 'input_text', text: `Reference photo: ${garmentRef.label}. This exact garment appears on every figure.` })
    }
    contentParts.push({ type: 'input_text', text: promptText })

    const gptStartedAt = Date.now()
    const response = await client.responses.create({
      model: 'gpt-4o',
      input: [{ role: 'user', content: contentParts }],
      tools: [{ type: 'image_generation', size: getOpenAIImageSize('generate'), quality: 'medium' }]
    })
    timings.gpt4oImageMs = Date.now() - gptStartedAt
    timings.usage = response.usage
    timings.imageSize = getOpenAIImageSize('generate')
    const imageItem = response.output?.find(item => item.type === 'image_generation_call')
    if (!imageItem?.result) throw new Error('GPT-4o did not return an image result')
    await fs.promises.writeFile(outPath, Buffer.from(imageItem.result, 'base64'))
    timings.totalMs = Date.now() - startedAt
    return { imageUrl: `/uploads/${filename}`, timings, renderer: 'gpt-4o' }
  } catch (err) {
    timings.totalMs = Date.now() - startedAt
    throw Object.assign(new Error(`Ideal-additions sheet failed: ${err.message}`), { timings })
  }
}


// ── Shared Outfit Evaluation Pipeline ─────────────────────────────────────────
export function resolveOutfitEvaluationPieces({ outfit = {}, pieceIds = [], maxPieces = 6 } = {}) {
  let ids = [...new Set((Array.isArray(pieceIds) && pieceIds.length ? pieceIds : outfit.pieceIds || [])
    .map(Number)
    .filter(Boolean))]
    .slice(0, maxPieces)
  let pieces = []
  if (ids.length) {
    const rows = db.prepare(`SELECT * FROM pieces WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(parsePiece)
    const byId = new Map(rows.map(piece => [Number(piece.id), piece]))
    pieces = ids.map(id => byId.get(id)).filter(Boolean)
  } else if (outfit.id) {
    pieces = getLinkedPiecesForOutfit(outfit.id).slice(0, maxPieces)
    ids = pieces.map(piece => Number(piece.id)).filter(Boolean)
  }
  return { ids, pieces }
}

export async function addEvaluationImage(content, filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false
  const { base64, mime } = await prepareImageForClaude(filePath)
  content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
  return true
}

export function uploadedOrSavedOutfitPhotoPath(outfitPhoto = '') {
  if (!outfitPhoto) return ''
  const outfitFileName = String(outfitPhoto).startsWith('/uploads/')
    ? path.basename(outfitPhoto)
    : path.basename(String(outfitPhoto))
  return path.join(uploadsDir, outfitFileName)
}

export function formatSharedOutfitEvaluation({ parsed, responseMode = 'full', question = '', attachedImageInventory = [] }) {
  const directFollowup = responseMode === 'followup'
    ? String(parsed?.answer || parsed?.feedback || parsed?.reply || parsed?.response || '').trim()
    : ''
  const visibleFacts = parsed?.visibleFacts && typeof parsed.visibleFacts === 'object' ? parsed.visibleFacts : {}
  const inferredIntent = parsed?.inferredIntent && typeof parsed.inferredIntent === 'object' ? parsed.inferredIntent : {}
  const nestedEvaluation = parsed?.evaluation && typeof parsed.evaluation === 'object' ? parsed.evaluation : {}
  const recommendationBlock = parsed?.recommendation && typeof parsed.recommendation === 'object' ? parsed.recommendation : {}
  const verdict = nestedEvaluation.verdict || parsed.verdict || ''
  const scores = nestedEvaluation.scores || parsed.scores || {}
  const scoreText = scores && typeof scores === 'object'
    ? Object.entries(scores).map(([key, value]) => `${key}: ${value}/5`).join(' · ')
    : ''
  const roles = nestedEvaluation.roles && typeof nestedEvaluation.roles === 'object'
    ? nestedEvaluation.roles
    : parsed?.roles && typeof parsed.roles === 'object' ? parsed.roles : {}
  const shoeAnalysis = visibleFacts.shoeAnalysis && typeof visibleFacts.shoeAnalysis === 'object'
    ? visibleFacts.shoeAnalysis
    : {}
  const shoeText = [
    shoeAnalysis.visibility ? `visibility: ${shoeAnalysis.visibility}` : '',
    shoeAnalysis.read ? `read: ${shoeAnalysis.read}` : (visibleFacts.shoeRead ? `read: ${visibleFacts.shoeRead}` : ''),
    shoeAnalysis.effect ? `effect: ${shoeAnalysis.effect}` : '',
    shoeAnalysis.confidence ? `confidence: ${shoeAnalysis.confidence}` : '',
  ].filter(Boolean).join(' · ')
  const factsText = [
    visibleFacts.floorLine ? `Floor line: ${visibleFacts.floorLine}` : '',
    visibleFacts.upperLayering ? `Upper layering: ${visibleFacts.upperLayering}` : '',
    visibleFacts.waistArea ? `Waist area: ${visibleFacts.waistArea}` : '',
    visibleFacts.fitPlacement ? `Fit placement: ${visibleFacts.fitPlacement}` : '',
    visibleFacts.proportionRead ? `Proportion read: ${visibleFacts.proportionRead}` : '',
    visibleFacts.texturePattern ? `Texture/pattern: ${visibleFacts.texturePattern}` : '',
    visibleFacts.accessoryDialogue ? `Accessory dialogue: ${visibleFacts.accessoryDialogue}` : '',
    shoeText ? `Shoe analysis: ${shoeText}` : '',
    visibleFacts.photoSettingRead ? `Photo setting read: ${visibleFacts.photoSettingRead}` : '',
    visibleFacts.cropConfidence ? `Crop confidence: ${visibleFacts.cropConfidence}` : '',
    visibleFacts.confidenceLimits ? `Confidence limits: ${visibleFacts.confidenceLimits}` : '',
  ].filter(Boolean).join('\n')
  const intentText = [
    inferredIntent.label ? `Intent: ${inferredIntent.label}` : '',
    Array.isArray(inferredIntent.successCriteria) && inferredIntent.successCriteria.length
      ? `Success criteria: ${inferredIntent.successCriteria.join(' ')}`
      : '',
  ].filter(Boolean).join('\n')
  const roleText = [
    roles.heroPiece ? `Hero: ${roles.heroPiece}` : '',
    Array.isArray(roles.supportPieces) && roles.supportPieces.length ? `Support: ${roles.supportPieces.join(' ')}` : '',
    roles.groundingPiece ? `Grounding: ${roles.groundingPiece}` : '',
    roles.possibleCompetingPiece ? `Tension point: ${roles.possibleCompetingPiece}` : '',
  ].filter(Boolean).join('\n')
  const feedback = [
    nestedEvaluation.summary || parsed.summary || 'Evaluation complete.',
    verdict ? `Verdict: ${verdict}` : '',
    intentText,
    factsText ? `Visible facts:\n${factsText}` : '',
    nestedEvaluation.tensionType || parsed.tensionType ? `Tension: ${nestedEvaluation.tensionType || parsed.tensionType}` : '',
    nestedEvaluation.maintenanceBurden || parsed.maintenanceBurden ? `Maintenance burden: ${nestedEvaluation.maintenanceBurden || parsed.maintenanceBurden}` : '',
    scoreText ? `Scores: ${scoreText}` : '',
    roleText ? `Roles:\n${roleText}` : '',
    nestedEvaluation.styleIdea ? `Style idea: ${nestedEvaluation.styleIdea}` : '',
    nestedEvaluation.intentionalTension ? `Intentional tension: ${nestedEvaluation.intentionalTension}` : '',
    nestedEvaluation.styleOpportunity ? `Style opportunity: ${nestedEvaluation.styleOpportunity}` : '',
    nestedEvaluation.ideaViability ? `Idea viability: ${nestedEvaluation.ideaViability}` : '',
    nestedEvaluation.executionGap ? `Execution gap: ${nestedEvaluation.executionGap}` : '',
    nestedEvaluation.mainSuccess ? `Main success: ${nestedEvaluation.mainSuccess}` : '',
    nestedEvaluation.firstVisibleIssue ? `First visible issue: ${nestedEvaluation.firstVisibleIssue}` : '',
    Array.isArray(parsed.works) && parsed.works.length ? `Works: ${parsed.works.join(' ')}` : '',
    Array.isArray(parsed.risks) && parsed.risks.length ? `Risks: ${parsed.risks.join(' ')}` : '',
    (recommendationBlock.smallestAdjustment || typeof parsed.recommendation === 'string') ? `Next: ${recommendationBlock.smallestAdjustment || parsed.recommendation}` : '',
    recommendationBlock.avoidForNow ? `Avoid for now: ${recommendationBlock.avoidForNow}` : '',
    recommendationBlock.tryNext || parsed.tryNext ? `Try next: ${recommendationBlock.tryNext || parsed.tryNext}` : ''
  ].filter(Boolean).join('\n\n')
  const fallbackFollowupFeedback = [
    nestedEvaluation.summary || parsed.summary || '',
    nestedEvaluation.firstVisibleIssue ? `Updated read: ${nestedEvaluation.firstVisibleIssue}` : '',
    (recommendationBlock.smallestAdjustment || typeof parsed.recommendation === 'string')
      ? `Next: ${recommendationBlock.smallestAdjustment || parsed.recommendation}`
      : '',
    recommendationBlock.avoidForNow ? `Avoid: ${recommendationBlock.avoidForNow}` : ''
  ].filter(Boolean).join('\n\n') || feedback

  const asksAboutImages = responseMode === 'followup'
    && /(which|what|still|do you|can you|did you).{0,40}(image|images|photo|photos|picture|pictures|see|saw)/i.test(String(question || ''))
  const imageInventoryText = asksAboutImages && attachedImageInventory.length
    ? `I have these images attached in this turn:\n${attachedImageInventory.map(item => `- ${item}`).join('\n')}`
    : ''

  return {
    feedback: responseMode === 'followup'
      ? [imageInventoryText, directFollowup || fallbackFollowupFeedback].filter(Boolean).join('\n\n')
      : feedback,
    evaluation: {
      visibleFacts,
      inferredIntent,
      summary: nestedEvaluation.summary || parsed.summary || '',
      verdict,
      roles,
      tensionType: nestedEvaluation.tensionType || parsed.tensionType || '',
      maintenanceBurden: nestedEvaluation.maintenanceBurden || parsed.maintenanceBurden || '',
      ideaViability: nestedEvaluation.ideaViability || '',
      executionGap: nestedEvaluation.executionGap || '',
      mainSuccess: nestedEvaluation.mainSuccess || '',
      firstVisibleIssue: nestedEvaluation.firstVisibleIssue || '',
      scores,
      works: Array.isArray(parsed.works) ? parsed.works : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      recommendation: recommendationBlock.smallestAdjustment || (typeof parsed.recommendation === 'string' ? parsed.recommendation : ''),
      avoidForNow: recommendationBlock.avoidForNow || '',
      tryNext: recommendationBlock.tryNext || parsed.tryNext || '',
      saveableLearning: parsed.saveableLearning || ''
    }
  }
}

export async function evaluateOutfitThroughSharedPipeline({
  outfit = {},
  pieceIds = [],
  occasion = 'casual',
  season = 'current season',
  mood = '',
  question = '',
  previousEvaluation = '',
  responseMode = 'full',
  history = [],
  routeMode = 'evaluate_wardrobe_outfit',
  uploadedPhotoPath = '',
  allowPhotoOnly = false,
  extraContextText = ''
} = {}) {
  const startedAt = Date.now()
  const { pieces } = resolveOutfitEvaluationPieces({ outfit, pieceIds })
  const content = []
  const outfitPhoto = outfit.photo || outfit.imageUrl || ''
  const savedPhotoPath = uploadedPhotoPath || uploadedOrSavedOutfitPhotoPath(outfitPhoto)
  const outfitImageIncluded = await addEvaluationImage(content, savedPhotoPath)
  if (!outfitImageIncluded && pieces.length < 2 && !allowPhotoOnly) {
    const err = new Error('An outfit photo or at least two linked wardrobe pieces are required')
    err.statusCode = 400
    throw err
  }

  const imageRefs = await Promise.all(pieces.slice(0, 5).map(async (piece) => {
    const photo = piece.worn_photo || piece.photo
    if (!photo) return null
    const filePath = path.join(uploadsDir, photo)
    if (!fs.existsSync(filePath)) return null
    const { base64, mime } = await prepareImageForClaude(filePath)
    return { piece, base64, mime }
  }))
  for (const ref of imageRefs.filter(Boolean)) {
    content.push({ type: 'image', source: { type: 'base64', media_type: ref.mime, data: ref.base64 } })
  }
  const attachedImageInventory = [
    outfitImageIncluded
      ? `actual worn outfit photo: ${outfit.label || outfit.title || outfit.name || 'current outfit'}`
      : '',
    ...imageRefs
      .filter(Boolean)
      .map(ref => `linked garment reference photo: ${ref.piece.name} (${ref.piece.category})`)
  ].filter(Boolean)

  const wholeWardrobeFeedbackText = getWholeWardrobeFeedbackMemory(20)
  const calibrationMemoryText = getCalibrationMemoryForStylist(20)
  const globalSavedBoardText = getSavedBoardMemory(null, null, 10)
  const pieceLines = pieces.map((piece, index) => `${index + 1}. ${buildPieceText(piece)}`).join('\n')
  const linkedFitCautionsText = buildLinkedPieceFitCautions(pieces)
  const evidenceMode = pieces.length >= 2
    ? 'linked_garment_truth'
    : outfitImageIncluded
      ? 'photo_only_low_garment_truth'
      : 'limited'
  const outfitSummary = [
    `Label: ${outfit.label || outfit.title || outfit.name || 'Whole wardrobe outfit'}`,
    outfit.dominantDirection ? `Direction: ${outfit.dominantDirection}` : '',
    outfit.silhouette ? `Silhouette: ${outfit.silhouette}` : '',
    outfit.reason ? `Current reason: ${outfit.reason}` : '',
    outfit.watchFor ? `Current watch note: ${outfit.watchFor}` : '',
    outfit.formulaFamily ? `Formula family: ${outfit.formulaFamily}` : '',
    outfit.archetypeId ? `Archetype: ${outfit.archetypeId}` : '',
    outfit.notes ? `Saved outfit notes: ${outfit.notes}` : ''
  ].filter(Boolean).join('\n')

  const imageAuthorityText = outfitImageIncluded && pieces.length
    ? 'The first image is the actual worn outfit photo. Treat it as primary visual evidence for fit, scale, proportion, and whether the combination works. Later images are linked garment references that clarify the saved pieces.'
    : outfitImageIncluded
      ? 'The image is the actual worn outfit photo. There are no linked garment records, so identify garments cautiously and mark garment-truth uncertainty in confidenceLimits.'
      : 'No worn outfit photo was provided. Use linked garment references and garment truth cautiously.'

  content.push({ type: 'text', text: [
    `Mode: ${routeMode}`,
    `Occasion: ${occasion}`,
    `Season: ${season}`,
    mood ? `Mood: ${mood}` : '',
    `Evidence mode: ${evidenceMode}`,
    question ? `User question: ${question}` : 'User question: Evaluate this outfit.',
    imageAuthorityText,
    attachedImageInventory.length
      ? `Current attached image inventory for this turn:\n${attachedImageInventory.map(item => `- ${item}`).join('\n')}`
      : 'Current attached image inventory for this turn: none.',
    '',
    `Proposed outfit:\n${outfitSummary}`,
    '',
    pieceLines
      ? `Owned garment truth. Use these exact garments for the critique:\n${pieceLines}`
      : 'Owned garment truth: no linked pieces. Use visual evidence only; do not overclaim exact garment identity, fabric, or shoe type.',
    linkedFitCautionsText
      ? `Linked fit/trust cautions. Treat these as authoritative and reconcile visible fit placement against them before judging whether a garment fits naturally:\n${linkedFitCautionsText}`
      : '',
    extraContextText,
    previousEvaluation
      ? `Previous structured critique memory. Use this for continuity, but correct it if the current image/garment truth contradicts it:\n${String(previousEvaluation).slice(0, 1600)}`
      : '',
    responseMode === 'followup'
      ? 'Response mode: followup. Answer the user directly in 2-5 concise sentences. If the user asks what photos/images you can see, answer with the Current attached image inventory first and do not give styling advice unless the user also asks for it. If the user asks whether a garment can be tucked, altered, cuffed, belted, or otherwise worn differently, first check both the actual outfit photo and the linked garment truth for fabric, hem behavior, fit confidence, engine notes, and visible waist placement; if evidence is missing, say what is low-confidence instead of pretending. The current outfit image and linked garment records are the authority; do not introduce garments that are not visible or listed unless you clearly label them as a possible future test. If the user asks about sharpness, softness, proportion, or why an outfit is not working, lead with garment mechanics: hem length, waist transition, fit placement, silhouette continuity, and proportion behavior. Do not use jewelry/accessories as the first fix unless the garment mechanics are already working. Do not repeat the full critique, visible facts, scores, roles, or JSON sections in prose. If correcting an earlier read, say what changed and give one practical next step.'
      : 'Response mode: full critique.',
    '',
    wholeWardrobeFeedbackText ? `Whole-wardrobe feedback memory:\n${wholeWardrobeFeedbackText}` : '',
    globalSavedBoardText ? `Saved visual board memory:\n${globalSavedBoardText}` : '',
    calibrationMemoryText ? `Calibration memory:\n${calibrationMemoryText}` : '',
    '',
    'Return direct advice only. Do not create render directions or image-generation prompts.'
  ].filter(Boolean).join('\n') })

  const raw = await withTimeout(askStylist({
    system: WHOLE_WARDROBE_EVALUATOR_SYSTEM,
    maxTokens: 1400,
    messages: [
      ...(history || []).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content }
    ]
  }), 45000, 'Whole-wardrobe outfit evaluator')
  const parsed = safeJsonFromModel(raw)
  const formatted = formatSharedOutfitEvaluation({ parsed, responseMode, question, attachedImageInventory })
  return {
    ...formatted,
    provider: AI_PROVIDER,
    model: ACTIVE_STYLIST_MODEL,
    mode: routeMode,
    pipeline: 'whole_wardrobe_outfit_evaluator',
    debug: {
      timings: { totalMs: Date.now() - startedAt },
      evidenceMode,
      linkedPieceCount: pieces.length,
      outfitImageIncluded,
      imageCount: imageRefs.filter(Boolean).length + (outfitImageIncluded ? 1 : 0)
    }
  }
}

// ── Editorial / Archetype / Calibration Helpers ──────────────────────────────
export function ownedInventorySummaryForEditorial(excludePieceId = null) {
  try {
    const rows = db.prepare('SELECT id, name, category, colors, notes FROM pieces ORDER BY id DESC LIMIT 400').all()
    return rows
      .filter(p => Number(p.id) !== Number(excludePieceId))
      .map(p => {
        const bits = [p.name, p.category, p.colors ? `colors: ${p.colors}` : '', p.notes ? `notes: ${String(p.notes).slice(0, 120)}` : '']
        return bits.filter(Boolean).join(' — ')
      })
      .join('\n')
  } catch (err) {
    return ''
  }
}

export function normalizeArchetypeText(value = '') {
  return normalizeForMatch(String(value || '').replace(/\(missing piece\)/gi, ''))
}

export function ownedLooksSimilarToArchetype(archetype = '', ownedPieces = []) {
  const a = normalizeArchetypeText(archetype)
  if (!a) return false
  const wantsDenim = /\b(denim|jean|jeans)\b/.test(a)
  const wantsOliveUtility = /\bolive\b/.test(a) && /\b(utility|cargo|barrel|fatigue|workwear)\b/.test(a)
  const wantsCreamTrouser = /\b(cream|ivory|white|oatmeal|beige)\b/.test(a) && /\b(trouser|pant|pants|jean|jeans)\b/.test(a)
  const wantsNavyTrouser = /\b(navy|indigo|blue)\b/.test(a) && /\b(trouser|pant|pants|jean|jeans|denim)\b/.test(a)

  for (const p of ownedPieces || []) {
    const n = normalizeForMatch(`${p.name || ''} ${p.category || ''} ${p.colors || ''} ${p.notes || ''}`)
    if (!n) continue
    if (a && n.includes(a)) return true
    if (wantsDenim && /\b(denim|jean|jeans)\b/.test(n)) return true
    if (wantsOliveUtility && /\bolive\b/.test(n) && /\b(utility|cargo|pant|pants|trouser|fatigue|workwear)\b/.test(n)) return true
    if (wantsCreamTrouser && /\b(cream|ivory|white|oatmeal|beige)\b/.test(n) && /\b(trouser|pant|pants|jean|jeans)\b/.test(n)) return true
    if (wantsNavyTrouser && /\b(navy|indigo|blue)\b/.test(n) && /\b(trouser|pant|pants|jean|jeans|denim)\b/.test(n)) return true
  }
  return false
}

export function idealAdditionSupportPool(selectedPiece = {}) {
  const selectedName = normalizeForMatch(selectedPiece?.name || '')
  const group = wardrobeCategoryGroup(selectedPiece)

  if (group === 'bottom') {
    return [
      'ink navy compact wrap top with a clean waist finish',
      'deep chocolate fitted knit shell with quiet texture',
      'black structured sleeveless top with a narrow shoulder line',
      'cognac slim-soled pointed loafer',
      'black pointed kitten heel mule',
      'cropped dark leather jacket with clean shoulder structure',
      'warm cognac small leather bag'
    ]
  }

  if (group === 'dress') {
    return [
      'black pointed kitten heel mule',
      'cognac slim ankle boot with a narrow shaft',
      'cropped dark leather jacket with clean shoulder structure',
      'ink navy short structured jacket without bulk',
      'warm cognac small leather bag',
      'long dark pendant necklace'
    ]
  }

  if (group === 'outerwear') {
    return [
      'compact black knit shell with clean neckline',
      'ink navy fitted tank with matte finish',
      'deep chocolate straight-leg trouser with clean hem',
      'warm taupe architectural trouser with crisp front crease',
      'black pointed flat',
      'cognac slim-soled loafer'
    ]
  }

  if (group === 'shoes') {
    return [
      'compact ink navy shell with quiet texture',
      'black fitted knit top with clean neckline',
      'deep chocolate straight-leg trouser with clean hem',
      'tobacco brown architectural trouser with soft front pleat',
      'dark olive weighted midi skirt with clean column line',
      'warm cognac leather bag'
    ]
  }

  if (/lace|sheer|appliqu|cream|soft|floral/.test(selectedName)) {
    return [
      'deep chocolate straight midi skirt with clean column line',
      'ink navy structured pencil skirt with subtle texture',
      'tobacco brown architectural trouser with soft front pleat',
      'dark olive weighted crochet-column skirt',
      'cognac slim-soled loafer'
    ]
  }

  if (/stripe|striped|graphic|button|shirt|sleeveless|knit/.test(selectedName)) {
    return [
      'dark chocolate long column trouser with clean hem',
      'tobacco brown structured barrel trouser with tapered ankle',
      'ink navy straight midi skirt with matte texture',
      'warm taupe architectural trouser with crisp front crease',
      'cognac slim-soled loafer'
    ]
  }

  return [
    'dark chocolate straight-leg trouser with clean hem',
    'tobacco structured utility trouser without cargo pockets',
    'ink navy column skirt with matte texture',
    'warm taupe architectural trouser',
    'cognac grounded loafer'
  ]
}

export function makeDistinctNewPieceArchetype(original = '', selectedPiece = {}, used = new Set()) {
  const pool = idealAdditionSupportPool(selectedPiece)

  const o = normalizeArchetypeText(original)
  let candidate = pool.find(x => !used.has(normalizeArchetypeText(x)) && normalizeArchetypeText(x) !== o)
  if (!candidate) candidate = `more specific ${String(original || 'editorial support piece').replace(/\(missing piece\)/gi, '').trim()}`
  used.add(normalizeArchetypeText(candidate))
  return candidate
}

export function dedupeAndDifferentiateEditorialDirections(directions = [], selectedPiece = {}, ownedPieces = []) {
  const usedMissing = new Set()
  const seenTitles = new Set()
  const cleaned = []
  const anchorGroup = wardrobeCategoryGroup(selectedPiece)
  const violatesAnchorRole = (text = '') => {
    const value = String(text || '').toLowerCase()
    if (anchorGroup === 'bottom') return /\b(trouser|pant|jean|skirt|short|culotte|legging|dress|jumpsuit)\b/.test(value)
    if (anchorGroup === 'top') return /\b(top|shirt|blouse|tee|t-shirt|tank|shell|sweater|knit|tunic|hoodie|sweatshirt|dress)\b/.test(value)
    if (anchorGroup === 'dress') return /\b(dress|jumpsuit|trouser|pant|jean|skirt|top|shirt|blouse|tee|sweater)\b/.test(value)
    if (anchorGroup === 'outerwear') return /\b(jacket|blazer|cardigan|coat|vest|outerwear|overshirt|kimono|dress)\b/.test(value)
    if (anchorGroup === 'shoes') return /\b(shoe|boot|flat|loafer|sandal|sneaker|heel|mule|clog)\b/.test(value)
    return false
  }

  for (const direction of directions || []) {
    const copy = { ...direction }
    const titleKey = normalizeForMatch(copy.title || '')
    if (titleKey && seenTitles.has(titleKey)) continue
    if (titleKey) seenTitles.add(titleKey)

    const missing = Array.isArray(copy.missingPieces) ? copy.missingPieces : []
    let replacedAnchorRole = false
    copy.missingPieces = missing.map(piece => {
      const raw = typeof piece === 'string' ? piece : piece?.name || String(piece || '')
      let next = raw.replace(/\(missing piece\)/gi, '').trim()
      const key = normalizeArchetypeText(next)
      if (!next) next = 'specific editorial support piece'
      if (violatesAnchorRole(next) || usedMissing.has(key) || ownedLooksSimilarToArchetype(next, ownedPieces)) {
        if (violatesAnchorRole(next)) replacedAnchorRole = true
        next = makeDistinctNewPieceArchetype(next, selectedPiece, usedMissing)
      } else {
        usedMissing.add(key)
      }
      return next
    }).filter(Boolean)

    while (copy.missingPieces.length < 2) {
      copy.missingPieces.push(makeDistinctNewPieceArchetype('', selectedPiece, usedMissing))
    }

    if (replacedAnchorRole && anchorGroup === 'bottom') {
      copy.reason = `Keeps ${selectedPiece.name} as the visual anchor and changes the support pieces around it instead of replacing the bottom.`
      copy.visualPrompt = `Style ${selectedPiece.name} with ${copy.missingPieces.join(' + ')}. Preserve the selected bottom exactly: same hem length, print, rise, drape, and waist placement. Do not replace it with another skirt, pant, trouser, jean, dress, or jumpsuit.`
    } else if (replacedAnchorRole && anchorGroup === 'top') {
      copy.reason = `Keeps ${selectedPiece.name} as the visual anchor and changes the bottom, shoe, or support pieces around it.`
      copy.visualPrompt = `Style ${selectedPiece.name} with ${copy.missingPieces.join(' + ')}. Preserve the selected top exactly: same neckline, sleeves, fit, hem, color, and print. Do not replace it with another top or dress.`
    }

    copy.reason = String(copy.reason || '').replace(/\bjeans?\b/gi, m => m)
    cleaned.push(copy)
  }

  return cleaned.slice(0, 3)
}

export function anchorFidelityInstructions(selectedPiece = {}) {
  const name = String(selectedPiece.name || '').toLowerCase()
  const category = String(selectedPiece.category || '').toLowerCase()
  const notes = String(selectedPiece.notes || '').toLowerCase()
  const parts = []

  if (category.includes('top') || /top|shell|tank|tee|shirt|blouse|sweater|cardigan|tunic/.test(name)) {
    parts.push('Anchor is an upper-body garment: preserve its neckline, shoulder width, sleeve length, hem length, and looseness/fittedness.')
  }
  if (category.includes('bottom') || /pant|jean|trouser|skirt|short/.test(name)) {
    parts.push('Anchor is a lower-body garment: preserve the rise, leg/hem width, length, drape, and visible volume. Do not turn wide pants into slim pants or cropped pants into long pants.')
  }
  if (/sleeveless|tank|shell/.test(name + ' ' + notes)) parts.push('Keep the anchor sleeveless; do not add sleeves.')
  if (/short sleeve|short-sleeve/.test(name + ' ' + notes)) parts.push('Keep the anchor short-sleeved; do not make it long-sleeved.')
  if (/long sleeve|long-sleeve/.test(name + ' ' + notes)) parts.push('Keep the anchor long-sleeved; do not shorten the sleeves.')
  if (/stripe|striped/.test(name + ' ' + notes)) parts.push('Preserve stripe direction, stripe spacing, and color relationship; do not invent a different stripe scale.')
  if (/lace|crochet|gauze|linen|corduroy|cashmere|wool|silk|satin|denim/.test(name + ' ' + notes)) parts.push('Preserve the apparent fabric character and texture weight of the anchor garment.')
  if (/boxy|relaxed|loose|oversized/.test(name + ' ' + notes)) parts.push('Keep the anchor relaxed/boxy if described that way; do not make it clingy or tucked tight.')
  if (/fitted|slim|compact/.test(name + ' ' + notes)) parts.push('Keep the anchor fitted/compact if described that way; do not make it oversized.')

  return parts.join(' ')
}

export function editorialImagePrompt({ selectedPiece, direction, occasion, season }) {
  const missing = Array.isArray(direction.missingPieces)
    ? direction.missingPieces.join(', ')
    : ''
  const pieceDesc = [
    selectedPiece.name,
    selectedPiece.category,
    selectedPiece.colors  ? `colors: ${selectedPiece.colors}`  : '',
    selectedPiece.fabric  ? `fabric: ${selectedPiece.fabric}`  : '',
    selectedPiece.notes   ? `notes: ${String(selectedPiece.notes).slice(0, 700)}` : ''
  ].filter(Boolean).join('; ')
  const anchorRules = anchorFidelityInstructions(selectedPiece)
  const selectedGroup = wardrobeCategoryGroup(selectedPiece)
  const silhouetteRule = selectedGroup === 'bottom' || selectedGroup === 'dress'
    ? 'Silhouette: respect the anchor garment actual hem length and lower-body shape. If the anchor is a knee skirt, midi skirt, cropped pant, or dress, keep that exact length; do not force a full-length lower half.'
    : 'Silhouette: fitted or structured upper half + full-length bottom (wide-leg, straight-leg, flowing maxi/midi). The lower half is usually full-length unless a specific suggested piece says otherwise.'
 
  return [
    EDITORIAL_IMAGE_BASE_PROMPT,
 
    EDITORIAL_IMAGE_SUBJECT_PROMPT,
 
    `Style Constitution:
${BODY_CONTRACT}
${PROVEN_FORMULAS}
${AESTHETIC_GRAVITY}
${LANE_NEUTRALITY}
${EXPRESSIVE_HIERARCHY_RULES}`,
 
    silhouetteRule,
 
    EDITORIAL_IMAGE_SHOES_RULE,
 
    EDITORIAL_IMAGE_REALISM_RULE,
 
    `ANCHOR GARMENT — preserve exactly: ${pieceDesc}.`,
    anchorRules ? `Anchor fidelity: ${anchorRules}` : '',
    'The anchor garment must remain visually recognizable — same category, neckline, sleeve length, print scale, color, fit, and hem length. Do not redesign it or substitute a different garment.',
    '',
    direction.visualPrompt
      ? `PRIMARY RENDERING DIRECTIVE — follow this exactly: ${direction.visualPrompt}`
      : missing
        ? `Complete the outfit with these new-piece archetypes: ${missing}.`
        : '',
    direction.reason ? `Stylist logic: ${direction.reason}` : '',
 
    `Occasion: ${occasion}. Season: ${season}.`,
 
    [
      'GARMENT FIDELITY — preserve the anchor garment exactly as shown in the photo:',
      '- Do not add a belt or waist tie unless the anchor garment photo shows one',
      '- Do not change the neckline, sleeve length, or closure style of the anchor garment',
    ].join('\n'),
 
  ].filter(Boolean).join('\n')
}

export async function getCalibrationReferenceImagesForGeneration(limit = 3) {
  try {
    const poolLimit = Math.max(Number(limit) * 4, 15)
    const rows = db.prepare(`
      SELECT * FROM calibration_images
      WHERE COALESCE(archived, 0) = 0
        AND kind IN ('good_reference', 'real_photo')
      ORDER BY
        CASE WHEN kind = 'real_photo' THEN 0 ELSE 1 END,
        COALESCE(favorite, 0) DESC,
        id DESC
      LIMIT ?
    `).all(poolLimit)

    const starredRows = rows.filter(row => Boolean(row.favorite))
    const normalRows = rows.filter(row => !Boolean(row.favorite))

    const shuffle = (array) => {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array
    }

    shuffle(starredRows)
    shuffle(normalRows)

    const selectedRows = [...starredRows, ...normalRows].slice(0, Number(limit))

    const images = []
    for (const row of selectedRows) {
      const filePath = imageUrlToUploadPath(row.image_url)
      if (!filePath) continue
      try {
        const buffer = await sharp(filePath)
          .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer()
        images.push({
          base64:   buffer.toString('base64'),
          mime:     'image/jpeg',
          kind:     row.kind,
          favorite: Boolean(row.favorite),
          labels:   safeJsonParse(row.labels, []),
          notes:    row.notes || '',
          id:       row.id
        })
      } catch (imgErr) {
        console.warn('Could not read calibration image for generation:', row.id, imgErr.message)
      }
    }
    return images
  } catch (err) {
    console.warn('getCalibrationReferenceImagesForGeneration error:', err.message)
    return []
  }
}

export async function runGPT4oImageGeneration({ client, prompt, size = '1024x1536', referenceImages = [], anchorGarmentImage = null }) {
  const contentParts = []
 
  const anchorPhotos = Array.isArray(anchorGarmentImage)
    ? anchorGarmentImage
    : anchorGarmentImage ? [anchorGarmentImage] : []
 
  if (anchorPhotos.length > 0) {
    contentParts.push({
      type: 'input_text',
      text: `ANCHOR GARMENT — the following ${anchorPhotos.length > 1 ? anchorPhotos.length + ' photos show' : 'photo shows'} the exact garment that must appear in the generated image. Preserve exactly: neckline shape, collar or no-collar, closure type, sleeve length and style, print scale and color family, lace or fabric detail, hem length, and overall silhouette. Do NOT redesign this garment, change its neckline, add a belt or waist definition not present in the photos, or substitute a different garment.`
    })
    for (const photo of anchorPhotos) {
      contentParts.push({ type: 'input_image', image_url: `data:${photo.mime};base64,${photo.base64}` })
      if (photo.label) {
        contentParts.push({ type: 'input_text', text: photo.label })
      }
    }
  }
 
  for (const img of referenceImages.slice(0, 3)) {
    contentParts.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.base64}` })
    const captionParts = [
      img.kind === 'real_photo'
        ? (img.favorite ? 'Real photo — use strongly for visual identity, proportion, and presence reference' : 'Real outfit photo — use for identity reference')
        : (img.favorite ? 'Good style reference — use strongly for aesthetic direction' : 'Good style reference'),
      img.labels?.length ? `[${img.labels.join(', ')}]` : '',
      img.notes ? img.notes : '',
    ].filter(Boolean)
    if (captionParts.length) {
      contentParts.push({ type: 'input_text', text: captionParts.join(' — ') })
    }
  }
 
  contentParts.push({ type: 'input_text', text: prompt })
 
  const response = await client.responses.create({
    model: 'gpt-4o',
    input: [{ role: 'user', content: contentParts }],
    tools: [{ type: 'image_generation', size, quality: 'medium' }]
  })
 
  const imageItem = response.output?.find(item => item.type === 'image_generation_call')
  if (!imageItem?.result) {
    throw new Error('GPT-4o Responses API did not return an image_generation_call result')
  }
  return { result: imageItem.result, usage: response.usage }
}

export async function createEditorialConceptImage({ selectedPiece, direction, index, occasion, season }) {
  const startedAt = Date.now()
  const timings = {}
  const prompt = editorialImagePrompt({ selectedPiece, direction, occasion, season })
  const filename = `generated-boards/editorial-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(uploadsDir, filename)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
 
  if (photoPreservingVisualsEnabled()) {
    const imageUrl = await createPhotoPreservingCollageImage({
      title: direction.title || `Ideal direction ${index}`,
      subtitle: 'ideal addition concept · photo-preserving collage',
      selectedPiece,
      missingPieces: direction.missingPieces || [],
      reason: direction.reason || '',
      index,
      prefix: 'editorial-collage'
    })
    timings.totalMs = Date.now() - startedAt
    return { imageUrl, timings, renderer: 'photo_preserving_collage' }
  }
 
  if (!process.env.OPENAI_API_KEY) {
    const title  = escapeXml(direction.title || `Ideal direction ${index}`)
    const pieces = escapeXml((direction.missingPieces || []).join(' + '))
    const anchor = escapeXml(selectedPiece.name || 'selected item')
    const svg = `<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1536" fill="#f5efe7"/>
      <rect x="72" y="72" width="880" height="1392" rx="34" fill="#fffaf4" stroke="#d8c9b7" stroke-width="3"/>
      <text x="112" y="160" font-family="Georgia, serif" font-size="48" fill="#3b3128">${title}</text>
      <text x="112" y="238" font-family="Arial, sans-serif" font-size="28" fill="#7b6a59">Anchor: ${anchor}</text>
      <text x="112" y="310" font-family="Arial, sans-serif" font-size="30" fill="#6d5135">Suggested additions: ${pieces}</text>
      <text x="112" y="1480" font-family="Arial, sans-serif" font-size="24" fill="#9a8774">Image generation unavailable.</text>
    </svg>`
    await sharp(Buffer.from(svg)).png().toFile(outPath)
    timings.totalMs = Date.now() - startedAt
    return { imageUrl: `/uploads/${filename}`, timings, renderer: 'fallback_svg' }
  }
 
  let anchorGarmentImage = null
  try {
    const anchorParts = []
 
    if (selectedPiece.worn_photo) {
      const filePath = path.join(uploadsDir, selectedPiece.worn_photo)
      if (fs.existsSync(filePath)) {
        const buffer = await sharp(filePath)
          .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer()
        anchorParts.push({
          base64: buffer.toString('base64'),
          mime: 'image/jpeg',
          label: `${selectedPiece.name} — worn photo showing drape, fit, and neckline on a body`,
        })
      }
    }
 
    if (selectedPiece.photo) {
      const filePath = path.join(uploadsDir, selectedPiece.photo)
      if (fs.existsSync(filePath)) {
        const buffer = await sharp(filePath)
          .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer()
        anchorParts.push({
          base64: buffer.toString('base64'),
          mime: 'image/jpeg',
          label: `${selectedPiece.name} — hanger photo showing exact print scale, color, texture, and construction detail`,
        })
      }
    }
 
    if (anchorParts.length > 0) {
      anchorGarmentImage = anchorParts
    }
  } catch (err) {
    console.warn('Could not load anchor garment photos:', err.message)
  }
 
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const referenceImages = await getCalibrationReferenceImagesForGeneration(3)
    const { result: base64Result, usage } = await runGPT4oImageGeneration({
      client,
      prompt,
      size: getOpenAIImageSize('generate'),
      referenceImages,
      anchorGarmentImage,
    })
    await fs.promises.writeFile(outPath, Buffer.from(base64Result, 'base64'))
    timings.usage = usage
    timings.imageSize = getOpenAIImageSize('generate')
    timings.totalMs = Date.now() - startedAt
    return { imageUrl: `/uploads/${filename}`, timings, renderer: 'gpt-4o' }
  } catch (err) {
    console.error('GPT-4o editorial image generation failed, falling back to gpt-image-1:', err.message)
  }
 
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const result = await runOpenAIImageGeneration({
      client, prompt, size: getOpenAIImageSize('generate'), kind: 'generate'
    })
    const first = result.data?.[0]
    if (first?.b64_json) {
      await fs.promises.writeFile(outPath, Buffer.from(first.b64_json, 'base64'))
      timings.totalMs = Date.now() - startedAt
      return { imageUrl: `/uploads/${filename}`, timings, renderer: 'gpt-image-1' }
    }
    if (first?.url) {
      const response = await fetch(first.url)
      if (!response.ok) throw new Error(`image download failed: ${response.status}`)
      const arrayBuffer = await response.arrayBuffer()
      await fs.promises.writeFile(outPath, Buffer.from(arrayBuffer))
      timings.totalMs = Date.now() - startedAt
      return { imageUrl: `/uploads/${filename}`, timings, renderer: 'gpt-image-1' }
    }
    throw new Error('No image data in fallback response')
  } catch (fallbackErr) {
    console.error('gpt-image-1 fallback also failed:', fallbackErr.message)
    const svg = `<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1536" fill="#f5efe7"/>
      <rect x="72" y="72" width="880" height="1392" rx="34" fill="#fffaf4" stroke="#d8c9b7" stroke-width="3"/>
      <text x="112" y="160" font-family="Georgia, serif" font-size="48" fill="#3b3128">${escapeXml(direction.title || '')}</text>
      <text x="112" y="1480" font-family="Arial, sans-serif" font-size="24" fill="#9a8774">Could not generate: ${escapeXml(fallbackErr.message).slice(0, 120)}</text>
    </svg>`
    await sharp(Buffer.from(svg)).png().toFile(outPath)
    timings.totalMs = Date.now() - startedAt
    return { imageUrl: `/uploads/${filename}`, timings, renderer: 'fallback_error' }
  }
}

export function getPiecePhotoPath(piece, preferWorn = true) {
  const photo = preferWorn ? (piece.worn_photo || piece.photo) : (piece.photo || piece.worn_photo)
  if (!photo) return null
  const filePath = path.join(uploadsDir, photo)
  return fs.existsSync(filePath) ? filePath : null
}

export function imageUrlToUploadPath(imageUrl) {
  const value = String(imageUrl || '')
  const filename = value.startsWith('/uploads/') ? value.replace('/uploads/', '') : path.basename(value)
  if (!filename || filename.includes('..')) return null
  const filePath = path.join(uploadsDir, filename)
  return fs.existsSync(filePath) ? filePath : null
}

export function getCalibrationSourcePhotoPath() {
  try {
    const rows = db.prepare(`
      SELECT * FROM calibration_images
      WHERE COALESCE(archived,0) = 0
        AND kind IN ('real_photo', 'good_reference')
      ORDER BY
        CASE WHEN kind = 'real_photo' THEN 0 ELSE 1 END,
        COALESCE(favorite,0) DESC,
        id DESC
      LIMIT 12
    `).all()
    for (const row of rows) {
      const filePath = imageUrlToUploadPath(row.image_url)
      if (filePath) {
        return {
          path: filePath,
          label: row.kind === 'real_photo'
            ? (row.favorite ? 'calibration real photo marked Use strongly' : 'calibration real outfit photo')
            : (row.favorite ? 'good calibration reference marked Use strongly' : 'good calibration reference'),
          row: normalizeCalibrationRow(row)
        }
      }
    }
  } catch (err) {
    console.warn('Calibration source lookup failed:', err.message)
  }
  return null
}

export function chooseIdentityEditSource(piece) {
  const worn = piece?.worn_photo ? getPiecePhotoPath({ ...piece, photo: null }, true) : null
  if (worn) return { path: worn, label: 'selected garment worn photo', kind: 'garment_worn' }

  const calibration = getCalibrationSourcePhotoPath()
  if (calibration) return { ...calibration, kind: 'calibration' }

  const garment = piece?.photo ? getPiecePhotoPath({ ...piece, worn_photo: null }, false) : null
  if (garment) return { path: garment, label: 'selected garment hanger/photo fallback', kind: 'garment_photo' }

  return null
}

export function identityEditPrompt({ selectedPiece, direction, occasion, season, sourceLabel }) {
  const missing = Array.isArray(direction.missingPieces) ? direction.missingPieces.join(', ') : ''
  const pieceDesc = [
    selectedPiece.name,
    selectedPiece.category,
    selectedPiece.colors ? `colors: ${selectedPiece.colors}` : '',
    selectedPiece.fabric ? `fabric: ${selectedPiece.fabric}` : '',
    selectedPiece.notes ? `notes: ${String(selectedPiece.notes).slice(0, 700)}` : ''
  ].filter(Boolean).join('; ')
  const anchorRules = anchorFidelityInstructions(selectedPiece)
  const calibrationSummary = getCalibrationReferenceSummary(12)

  return [
    'Edit the provided real mirror/photo reference. This is an observation-preserving clothing edit, NOT a synthetic portrait, NOT a new model, and NOT an editorial re-creation.',
    `SOURCE PHOTO: ${sourceLabel || 'real reference photo'}. The source photo is the authority for body geometry and identity. Preserve the same person and the same physical geometry: face, hair, age read, head size, neck length, shoulder slope, shoulder width, bust/torso width, torso length, waist ambiguity, hip width, thigh/leg proportions, arm size, stance, weight distribution, posture asymmetry, camera angle, lighting, background, and lived-in photo realism.`,
    'Do NOT optimize the body. Do NOT lengthen the torso or legs. Do NOT narrow hips/thighs. Do NOT shrink the waist. Do NOT broaden or square the shoulders. Do NOT straighten posture. Do NOT make the person taller, thinner, younger, smoother, more symmetrical, more elegant, more polished, more catalog-ready, or more conventionally flattering.',
    'If the source photo already shows the selected anchor garment, preserve it as visual truth. If the source photo is a calibration fallback and does not show the selected garment, use the source only for body/posture/identity and introduce the selected garment conservatively without changing the person geometry. Keep garment fit, looseness/fittedness, length, neckline, sleeve length, print/stripe scale, fabric behavior, hem behavior, wrinkles, slight tension, and visual weight. Do not clean it up into ideal tailoring.',
    `ANCHOR GARMENT: ${pieceDesc}.`,
    anchorRules ? `Anchor-specific fidelity: ${anchorRules}` : '',
    'Change only the supporting styling pieces needed for the concept. Treat this like trying different clothes on the same real photo. If the edit cannot preserve the person and anchor garment, make a minimal edit rather than regenerating the full person.',
    'Do NOT repaint the face, arms, neck, shoulders, or body mass. Preserve facial angularity, actual jaw/cheek planes, real shoulder slope, real arm width, real torso width, real hip/thigh relationship, and the exact stance from the source. No beauty smoothing, no soft-body rounding, no chubby cartoon effect, no plastic skin, no AI eyes.',
    'Keep natural mirror-photo imperfections: asymmetry, relaxed stance, imperfect drape, real textile collapse, non-model posture, and ordinary room lighting. These are identity features, not problems to fix.',
    'Preserve angular relaxed tension when present: off-center ease, directional body line, garment pull, cuffs, shadows, and shoe grounding. Do not replace it with front-facing passive catalog posture.',
    `Suggested additions to test: ${missing}.`,
    direction.visualPrompt ? `Visual direction: ${direction.visualPrompt}` : '',
    direction.reason ? `Stylist logic: ${direction.reason}` : '',
    calibrationSummary ? `Use this calibration library as identity guidance and anti-drift memory, not as outfits to copy:\n${calibrationSummary}` : '',
    'Style target: relaxed structure with artistic intelligence; restrained artistic modernism; grounded but not passive; contemporary, authentic, visually self-directed. Prefer dark grounded columns, sharper footwear, directional accessories, controlled contrast, and one strong silhouette idea over polite neutral harmony.',
    'Avoid: librarian/school-teacher styling, mature catalog drift, Santa Fe/festival stereotype, lifestyle-brand softness, influencer polish, excessive scarves/cardigans, excessive neatness, generic elegance, passive comfortwear, soft cream/taupe sludge, and over-smoothed mature-casual styling.',
    'Hard anti-drift rule: do not convert relaxed structure into tailoring, do not convert artistic tension into accessories, do not convert comfort into passivity, and do not resolve silhouette ambiguity into a safe catalog look.',
    `Occasion/season: ${occasion} / ${season}.`,
    'Return only the edited realistic image. No text, labels, watermarks, extra people, product tags, or split-screen layout.'
  ].filter(Boolean).join('\n')
}

export async function createIdentityPreservingEditImage({ sourcePath, sourceLabel, selectedPiece, direction, index, occasion, season }) {
  const prompt = identityEditPrompt({ selectedPiece, direction, occasion, season, sourceLabel })
  const filename = `generated-boards/identity-edit-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(uploadsDir, filename)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })

  if (photoPreservingVisualsEnabled()) {
    return createPhotoPreservingCollageImage({
      title: direction.title || `Identity edit ${index}`,
      subtitle: `identity edit · ${sourceLabel || 'source photo'} preserved`,
      sourcePath,
      selectedPiece,
      missingPieces: direction.missingPieces || [],
      reason: direction.reason || 'Shows the real source photo alongside the selected garment and suggested additions instead of repainting the person.',
      index,
      prefix: 'identity-collage'
    })
  }

  if (!process.env.OPENAI_API_KEY) {
    const title = escapeXml(direction.title || `Identity edit ${index}`)
    const pieces = escapeXml((direction.missingPieces || []).join(' + '))
    const svg = `<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1536" fill="#f5efe7"/>
      <rect x="72" y="72" width="880" height="1392" rx="34" fill="#fffaf4" stroke="#d8c9b7" stroke-width="3"/>
      <text x="112" y="160" font-family="Georgia, serif" font-size="46" fill="#3b3128">${title}</text>
      <text x="112" y="230" font-family="Arial, sans-serif" font-size="26" fill="#7b6a59">Identity-preserving edit placeholder</text>
      <foreignObject x="112" y="300" width="800" height="260"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Arial, sans-serif; font-size: 34px; line-height: 1.35; color:#3b3128;">${pieces}</div></foreignObject>
      <text x="112" y="1385" font-family="Arial, sans-serif" font-size="24" fill="#9a8774">Image editing unavailable.</text>
    </svg>`
    await sharp(Buffer.from(svg)).png().toFile(outPath)
    return `/uploads/${filename}`
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const result = await runOpenAIImageGeneration({
      client,
      prompt,
      size: getOpenAIImageSize('identity'),
      kind: 'edit',
      imagePath: sourcePath
    })
    const first = result.data?.[0]
    if (first?.b64_json) {
      await fs.promises.writeFile(outPath, Buffer.from(first.b64_json, 'base64'))
      return `/uploads/${filename}`
    }
    if (first?.url) {
      const response = await fetch(first.url)
      if (!response.ok) throw new Error(`image download failed: ${response.status}`)
      const arrayBuffer = await response.arrayBuffer()
      await fs.promises.writeFile(outPath, Buffer.from(arrayBuffer))
      return `/uploads/${filename}`
    }
    throw new Error('No image data returned')
  } catch (err) {
    console.error('Identity edit generation failed:', err.message)
    const title = escapeXml(direction.title || `Identity edit ${index}`)
    const svg = `<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1536" fill="#f5efe7"/>
      <rect x="72" y="72" width="880" height="1392" rx="34" fill="#fffaf4" stroke="#d8c9b7" stroke-width="3"/>
      <text x="112" y="160" font-family="Georgia, serif" font-size="46" fill="#3b3128">${title}</text>
      <text x="112" y="1385" font-family="Arial, sans-serif" font-size="24" fill="#9a8774">Could not edit image: ${escapeXml(err.message).slice(0, 120)}</text>
    </svg>`
    await sharp(Buffer.from(svg)).png().toFile(outPath)
    return `/uploads/${filename}`
  }
}

export function calibrationImagePrompt({ selectedPiece, variation, occasion, season }) {
  const base = editorialImagePrompt({ selectedPiece, direction: variation, occasion, season })
  const variationType = String(variation.variation || variation.title || '').toUpperCase()
  const extra = []
  extra.push('CALIBRATION MODE: This image is one of three controlled renderer variations. It should test a specific silhouette/energy direction, not invent a random outfit.')
  if (variationType.includes('A')) {
    extra.push('Variation A weighting: softer restrained, relaxed structure, medium-light grounding, slightly softer drape, but do not become passive, festival/costume stereotype, sweet, or mature-catalog.')
  } else if (variationType.includes('B')) {
    extra.push('Variation B weighting: balanced artistic modern baseline, grounded and edited, likely strongest everyday artistic direction, with contemporary presence and controlled tension.')
  } else if (variationType.includes('C')) {
    extra.push('Variation C weighting: sharper architectural, stronger lower-half anchor, cleaner vertical line, more intentional structure and visual confidence, but no fashion fantasy or hard corporate tailoring.')
  }
  extra.push('The comparison should be visible: A/B/C should differ in grounding, structure, and artistic tension while preserving the same anchor garment truth.')
  return [base, ...extra].join('\n')
}

export async function createCalibrationConceptImage({ selectedPiece, variation, index, occasion, season }) {
  const startedAt = Date.now()
  const timings = {}
  const prompt = calibrationImagePrompt({ selectedPiece, variation, occasion, season })
  const filename = `generated-boards/calibration-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(uploadsDir, filename)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
 
  if (!process.env.OPENAI_API_KEY) {
    const title  = escapeXml(`${variation.variation || String.fromCharCode(64 + index)} · ${variation.title || 'Calibration variation'}`)
    const pieces = escapeXml((variation.missingPieces || []).join(' + '))
    const svg = `<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1536" fill="#f5efe7"/>
      <rect x="72" y="72" width="880" height="1392" rx="34" fill="#fffaf4" stroke="#d8c9b7" stroke-width="3"/>
      <text x="112" y="160" font-family="Georgia, serif" font-size="46" fill="#3b3128">${title}</text>
      <text x="112" y="230" font-family="Arial, sans-serif" font-size="26" fill="#7b6a59">Renderer calibration placeholder</text>
      <foreignObject x="112" y="300" width="800" height="260"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Arial, sans-serif; font-size: 34px; line-height: 1.35; color:#3b3128;">${pieces}</div></foreignObject>
      <text x="112" y="1385" font-family="Arial, sans-serif" font-size="24" fill="#9a8774">Image generation unavailable.</text>
    </svg>`
    await sharp(Buffer.from(svg)).png().toFile(outPath)
    timings.totalMs = Date.now() - startedAt
    return { imageUrl: `/uploads/${filename}`, timings, renderer: 'fallback_svg' }
  }
 
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const referenceImages = await getCalibrationReferenceImagesForGeneration(3)
    const { result: base64Result, usage } = await runGPT4oImageGeneration({
      client,
      prompt,
      size: getOpenAIImageSize('generate'),
      referenceImages,
    })
    await fs.promises.writeFile(outPath, Buffer.from(base64Result, 'base64'))
    timings.usage = usage
    timings.imageSize = getOpenAIImageSize('generate')
    timings.totalMs = Date.now() - startedAt
    return { imageUrl: `/uploads/${filename}`, timings, renderer: 'gpt-4o' }
  } catch (err) {
    console.error('GPT-4o calibration image generation failed, falling back to gpt-image-1:', err.message)
  }
 
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const result = await runOpenAIImageGeneration({
      client, prompt, size: getOpenAIImageSize('generate'), kind: 'generate'
    })
    const first = result.data?.[0]
    if (first?.b64_json) {
      await fs.promises.writeFile(outPath, Buffer.from(first.b64_json, 'base64'))
      timings.totalMs = Date.now() - startedAt
      return { imageUrl: `/uploads/${filename}`, timings, renderer: 'gpt-image-1' }
    }
    if (first?.url) {
      const response = await fetch(first.url)
      if (!response.ok) throw new Error(`image download failed: ${response.status}`)
      const arrayBuffer = await response.arrayBuffer()
      await fs.promises.writeFile(outPath, Buffer.from(arrayBuffer))
      timings.totalMs = Date.now() - startedAt
      return { imageUrl: `/uploads/${filename}`, timings, renderer: 'gpt-image-1' }
    }
    throw new Error('No image data in fallback response')
  } catch (fallbackErr) {
    console.error('gpt-image-1 calibration fallback also failed:', fallbackErr.message)
    const title = escapeXml(`${variation.variation || String.fromCharCode(64 + index)} · ${variation.title || 'Calibration variation'}`)
    const svg = `<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1536" fill="#f5efe7"/>
      <rect x="72" y="72" width="880" height="1392" rx="34" fill="#fffaf4" stroke="#d8c9b7" stroke-width="3"/>
      <text x="112" y="160" font-family="Georgia, serif" font-size="46" fill="#3b3128">${title}</text>
      <text x="112" y="1385" font-family="Arial, sans-serif" font-size="24" fill="#9a8774">Could not generate image: ${escapeXml(fallbackErr.message).slice(0, 120)}</text>
    </svg>`
    await sharp(Buffer.from(svg)).png().toFile(outPath)
    timings.totalMs = Date.now() - startedAt
    return { imageUrl: `/uploads/${filename}`, timings, renderer: 'fallback_error' }
  }
}

// ── Conversation controller helpers ──────────────────────────────────────────
export function resolveStylistConversationMode(question, {
  requestedMode = 'new_request',
  hasThreadContext = false,
  hasGeneratedContext = false,
} = {}) {
  const requested = STYLIST_CONVERSATION_MODES.has(String(requestedMode))
    ? String(requestedMode)
    : 'new_request'
  const q = String(question || '').trim().toLowerCase()
  if (!q) return requested

  if (hasThreadContext && /\b(no|nope|wait|hold on|i meant|i did not|i didn't|you said|but you|you missed|you ignored|that's wrong|that is wrong|not true|actually|today is|it is|it isn't|it is not|these are|this is|wrong|mistake|error|not correct|incorrect|incorrectly)\b/.test(q)) {
    return 'correction'
  }
  if (/\b(i disagree|you are wrong|that's wrong|that is wrong|not true|you missed|you ignored|today is|wrong|mistake|error|not correct|incorrect|incorrectly)\b/.test(q)) {
    return 'correction'
  }
  if (/\b(i like|i don't like|i do not like|not me|too safe|too soft|too generic|more like|less like|good formula|good pieces|bad piece|bad occasion|fit issue|not sure about|prefer|instead of|don't want|do not want|too \w+)\b/.test(q)) {
    return 'preference_reaction'
  }
  if (/^(why|how did|how do you know|what made|which|do you see|can you see|did you see|where|what date|which season|what season|what images|which images)\b/.test(q)) {
    return 'explanation'
  }
  if (hasGeneratedContext && /\b(first|second|third|last|previous|above|earlier|that one|those outfits|these outfits|this outfit|that outfit|the outfit|the shoes|the top|the skirt|the pants|the photo|the image)\b/.test(q)) {
    return 'followup'
  }
  if (hasThreadContext && /\b(last|previous|above|earlier|that one|first one|second one|third one|those outfits|these outfits|this outfit|that outfit|the outfit|the shoes|the top|the skirt|the pants|the photo|the image)\b/.test(q)) {
    return 'followup'
  }
  return requested
}

export function buildStylistConversationDirective(mode) {
  switch (mode) {
    case 'correction':
      return 'The user is challenging or correcting a previous response. Address their correction directly, update the specific mistaken point, and answer them naturally without regenerating prior lists/outfits unless requested.'
    case 'explanation':
      return 'The user is asking for explanation or rationale. Explain how the prior answer was made naturally using listed garment details, metadata, and any images attached to this call.'
    case 'preference_reaction':
      return 'The user is stating a style or taste preference. Accept this preference naturally, adapt your rules for their style profile, and keep your reply concise.'
    case 'followup':
      return 'The user is asking a follow-up question. Answer it directly and naturally. Do not restart the full evaluation flow.'
    default:
      return 'The user has a new request. Answer them directly and naturally. Ask one clarifying question if required context is missing.'
  }
}

export const STYLIST_CONVERSATION_MODES = new Set([
  'new_request',
  'followup',
  'correction',
  'explanation',
  'preference_reaction',
])

export async function buildStylistConversationPayload(body) {
  const {
    question,
    pieces,
    history,
    generatedContext,
    generatedOutfits,
    conversationMode: requestedConversationMode = 'new_request',
    currentDate,
    currentDateLabel,
    timezone = 'America/Los_Angeles',
    threadContext,
    outfit,
    pieceIds,
    sessionId = 'default',
    activeContext
  } = body

  let activeOutfit = outfit
  let activePieceIds = pieceIds
  
  if (requestedConversationMode === 'new_request') {
    if (!activeOutfit) {
      saveStylistConversationState({}, sessionId)
    }
  } else {
    const state = getStylistConversationState(sessionId)
    if (!activeOutfit && state.active_outfit) {
      activeOutfit = state.active_outfit
      activePieceIds = state.active_piece_ids
    }
  }

  const confirmedOutfitsText = getConfirmedOutfitMemory()
  const generatedOutfitContextText = String(generatedContext || '').trim()
  const threadContextText = String(threadContext || '').trim()

  const now = currentDate ? new Date(currentDate) : new Date()
  const resolvedCurrentDateLabel = currentDateLabel || new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: timezone || 'America/Los_Angeles',
  }).format(now)

  const generatedOutfitReferenceSheet = Array.isArray(generatedOutfits) && generatedOutfits.length
    ? await makeGeneratedOutfitReferenceSheet(generatedOutfits, pieces || [])
    : null

  let outfitImageContent = null
  let attachedImageInventory = []
  let extraContextText = ''

  if (activeOutfit) {
    const { pieces: outfitPieces } = resolveOutfitEvaluationPieces({ outfit: activeOutfit, pieceIds: activePieceIds })
    const outfitPhoto = activeOutfit.photo || activeOutfit.imageUrl || ''
    const savedPhotoPath = uploadedOrSavedOutfitPhotoPath(outfitPhoto)
    const contentImages = []

    const isVisualQuery = /\b(see|saw|photo|photos|image|images|picture|pictures|color|colors|shoes|boots|pants|jeans|skirt|top|shirt|jacket|look|fitted|tucked|hem|waist|silhouette|view|inspect)\b/i.test(question)
    const isFirstTurn = !history || history.length === 0
    const shouldAttachImages = isVisualQuery || isFirstTurn || requestedConversationMode === 'new_request'

    if (shouldAttachImages) {
      const outfitImageIncluded = await addEvaluationImage(contentImages, savedPhotoPath)
      if (outfitImageIncluded) {
        attachedImageInventory.push(`actual worn outfit photo: ${activeOutfit.label || activeOutfit.title || activeOutfit.name || 'current outfit'}`)
      }

      const imageRefs = await Promise.all(outfitPieces.slice(0, 5).map(async (piece) => {
        const photo = piece.worn_photo || piece.photo
        if (!photo) return null
        const filePath = path.join(uploadsDir, photo)
        if (!fs.existsSync(filePath)) return null
        const { base64, mime } = await prepareImageForClaude(filePath)
        return { piece, base64, mime }
      }))
      for (const ref of imageRefs.filter(Boolean)) {
        contentImages.push({ type: 'image', source: { type: 'base64', media_type: ref.mime, data: ref.base64 } })
        attachedImageInventory.push(`linked garment reference photo: ${ref.piece.name} (${ref.piece.category})`)
      }

      if (contentImages.length > 0) {
        outfitImageContent = contentImages
      }
    } else {
      attachedImageInventory = ['images omitted on this turn to conserve vision tokens']
    }

    const outfitSummary = [
      `Label: ${activeOutfit.label || activeOutfit.title || activeOutfit.name || 'Current outfit'}`,
      activeOutfit.dominantDirection ? `Direction: ${activeOutfit.dominantDirection}` : '',
      activeOutfit.silhouette ? `Silhouette: ${activeOutfit.silhouette}` : '',
      activeOutfit.reason ? `Current reason: ${activeOutfit.reason}` : '',
      activeOutfit.watchFor ? `Current watch note: ${activeOutfit.watchFor}` : '',
      activeOutfit.notes ? `Saved outfit notes: ${activeOutfit.notes}` : ''
    ].filter(Boolean).join('\n')

    const pieceLines = outfitPieces.map((piece, index) => `${index + 1}. ${buildPieceText(piece)}`).join('\n')
    const linkedFitCautionsText = buildLinkedPieceFitCautions(outfitPieces)

    extraContextText = [
      `Proposed outfit:\n${outfitSummary}`,
      pieceLines ? `Linked garments:\n${pieceLines}` : '',
      linkedFitCautionsText ? `Linked fit/trust cautions:\n${linkedFitCautionsText}` : '',
    ].filter(Boolean).join('\n\n')
  }

  const hasThreadContext = Boolean(
    threadContextText ||
    generatedOutfitContextText ||
    activeOutfit ||
    (Array.isArray(history) && history.length)
  )

  const conversationMode = resolveStylistConversationMode(question, {
    requestedMode: requestedConversationMode,
    hasThreadContext,
    hasGeneratedContext: Boolean(generatedOutfitContextText || generatedOutfitReferenceSheet || activeOutfit),
  })

  if (activeOutfit) {
    saveStylistConversationState({
      active_outfit: activeOutfit,
      active_piece_ids: activePieceIds,
      visible_image_inventory: attachedImageInventory
    }, sessionId)
  }

  let automaticallySavedCorrection = null
  if (conversationMode === 'correction' || conversationMode === 'preference_reaction') {
    storeUserCorrection(question, activeOutfit ? 'outfit' : 'general', activeOutfit ? activeOutfit.id : null)
    automaticallySavedCorrection = {
      note: question,
      context_type: activeOutfit ? 'outfit' : 'general',
      context_id: activeOutfit ? activeOutfit.id : null
    }
  }

  const conversationDirective = buildStylistConversationDirective(conversationMode)

  const activeWardrobeText = [
    'The full wardrobe list is omitted from the prompt to save context tokens.',
    'You MUST use the database search tools to look up or search for pieces in the closet:',
    '- Use `search_wardrobe` to search or filter active garments by query, category, color, or occasion.',
    '- Use `get_garment_details` to inspect detailed notes, fit warnings, styling rules, and intelligence for specific garment IDs.',
    '- Use `get_last_outfit_evaluation` to check past critiques.',
    '- Use `get_current_image_inventory` to inspect attached images.',
    '- Use `store_user_correction` to save user corrections/preferences.',
    'Never guess or assume a piece exists without querying the database via tools first.',
    'CRITICAL: If the user states a new style rule, taste preference, dislike, constraint, or correction (e.g. "I do not wear boots in summer", "no flats for me", "I dislike cargo pants", "prefer dark jeans"), you MUST proactively call the `store_user_correction` tool to save this rule/preference immediately. Do not wait for the user to ask you to save it; save it automatically using the tool.'
  ].join('\n')

  let modeDirectiveText = ''
  switch (conversationMode) {
    case 'correction':
      modeDirectiveText = 'The user is correcting or challenging a detail. Acknowledge and adjust to the correction gracefully, update the mistaken point, and give a concise adjustment. Do not defend a contradiction.'
      break
    case 'explanation':
      modeDirectiveText = 'The user is asking for styling explanation or context details. Explain your styling rationale in a friendly, conversational manner using listed garment details.'
      break
    case 'preference_reaction':
      modeDirectiveText = 'The user is providing taste feedback. Accept the preference, adapt your style rules, and keep it brief.'
      break
    case 'followup':
      modeDirectiveText = 'The user is asking a follow-up question. Answer it directly and conversationally without restarting evaluation templates.'
      break
    default:
      modeDirectiveText = 'The user has a new request. Respond directly. If details like destination or timing/season are completely missing, ask exactly one clear clarifying question; do not generate a placeholder list. Do not ask "when" if a timing or date is already provided.'
  }

  const feedbackMemoryParts = []
  if (activeOutfit && activeOutfit.id) {
    const outfitFeedbackText = getStylistFeedbackMemory('outfit', activeOutfit.id, 16)
    if (outfitFeedbackText) {
      feedbackMemoryParts.push(`Saved feedback/preferences for this outfit under discussion:\n${outfitFeedbackText}`)
    }
  }
  const activePieceId = activeContext?.type === 'piece' ? activeContext.id : (body.pieceId || body.piece?.id || null)
  if (activePieceId) {
    const pieceFeedbackText = getStylistFeedbackMemory('piece', activePieceId, 16)
    if (pieceFeedbackText) {
      feedbackMemoryParts.push(`Saved feedback/preferences for this active garment:\n${pieceFeedbackText}`)
    }
  }
  const globalFeedbackText = getStylistFeedbackMemory(null, null, 24)
  if (globalFeedbackText) {
    feedbackMemoryParts.push(`Global saved stylist feedback/preferences:\n${globalFeedbackText}`)
  }

  const savedFeedbackSection = feedbackMemoryParts.length
    ? [
        '',
        'SAVED STYLIST FEEDBACK & PREFERENCES (HIGH-AUTHORITY MEMORIES):',
        'You MUST strictly respect and conform to the saved user preferences and corrections below. Stated preferences/dislikes take absolute precedence over generic style advice.',
        ...feedbackMemoryParts
      ].join('\n')
    : ''

  const system = STYLIST_SYSTEM + [
    '',
    'CURRENT DATE / SEASON:',
    `Today is ${resolvedCurrentDateLabel}. Time zone: ${timezone || 'America/Los_Angeles'}.`,
    'Use this date for relative phrases like today, next week, in a few weeks, current season, or upcoming travel. Do not say you cannot determine today’s date.',
    '',
    'OCCASION & CLIMATE PROFILES (RULES-AS-DATA):',
    'Classify the user\'s event/activity and weather description into one of the profiles below. You MUST strictly apply that profile\'s prohibited_materials, prohibited_footwear, and preferred style vibe rules to recommended outfits or pieces. NEVER suggest heavy zip ankle boots in summer months (June, July, August) even on cooler/windy days, unless explicitly requested or for rain/mud.',
    JSON.stringify(OCCASION_PROFILES, null, 2),
    '',
    'CONVERSATION CONTROLLER:',
    `Current turn mode: ${conversationMode}.`,
    `Mode instructions: ${modeDirectiveText}`,
    `Turn directive: ${conversationDirective}`,
    'If mode is new_request and required context (both location/city and weather/season/dates/timing) is present, answer the user’s request directly using wardrobe context by recommending specific items from Yuna\'s closet. Keep the response natural, following the Conversational Flow guidelines and Examples. Parse relative timing (e.g., "in a week", "tomorrow") or specific dates as valid timing/season context (and infer the likely season accordingly, e.g. mid-June in Portland is summer). Do not ask "when" they are visiting if timing is already provided; if weather context is still missing, ask specifically for the expected weather forecast. Do not suggest generic categories or descriptions (like "a solid-colored tank", "a lightweight scarf", or "a compact umbrella"); you must search the wardrobe and recommend specific owned items (e.g., "your rust orange ribbed tank top") or flag them as missing wardrobe gaps. If details like location/city or timing/season/weather are completely missing, do not call any database search tools (like search_wardrobe) and do not recommend garments or suggest outfits; you must ask exactly one friendly, natural clarifying question to gather this missing context (e.g., "Where are you going, and what is the expected weather?").',
    'If mode is followup, answer the specific follow-up directly in a friendly conversational tone without restarting the whole evaluation, outfit generation, packing list, or plan.',
    'If mode is correction, acknowledge the correction, revise only the relevant mistaken point, and do not defend a contradiction.',
    'If mode is explanation, explain how the previous recommendation was made using the available context.',
    'If mode is preference_reaction, adapt the next advice to the stated preference and keep it concise.',
    'For followup, correction, explanation, and preference_reaction modes, answer the latest user message first. Do not regenerate the full prior list, plan, or evaluation unless the user explicitly asks for a revised version.',
    'In correction mode, keep the reply to 1–3 short sentences or one compact paragraph unless the user asks for a new complete answer.',
    'Only use the full structured outfit-evaluation template when the user explicitly asks to evaluate or critique an outfit. For ordinary chat follow-ups, answer conversationally.',
    '',
    threadContextText ? `CURRENT THREAD CONTEXT:\n${threadContextText}` : '',
    '',
    extraContextText ? `OUTFIT CONTEXT UNDER DISCUSSION:\n${extraContextText}` : '',
    '',
    attachedImageInventory.length
      ? `CURRENT ATTACHED IMAGE INVENTORY:\n${attachedImageInventory.map(item => `- ${item}`).join('\n')}`
      : '',
    savedFeedbackSection,
    '',
    'CURRENT WARDROBE TRUTH:',
    activeWardrobeText,
    '',
    confirmedOutfitsText ? `CONFIRMED / FAVORITE OUTFIT MEMORY:\n${confirmedOutfitsText}` : '',
    generatedOutfitContextText ? [
      'CURRENT GENERATED OUTFIT CARD CONTEXT:',
      generatedOutfitContextText,
      '',
      'If the user asks about "the first one", "these outfits", or a generated card, use this current card context.',
      generatedOutfitReferenceSheet
        ? 'The current user turn includes a generated outfit garment-reference sheet grouped by card. Use those pixels for garment thumbnail, hanger-photo, worn-photo, ruler, texture, fit, shoe, and detail questions.'
        : 'You can discuss the generated outfit card text and saved garment thumbnails described here.',
      'If the context includes a generation pipeline note, use it to answer whether photos were used during selection.',
      generatedOutfitReferenceSheet
        ? 'Do not say you cannot see the current generated garment photos. Inspect the attached reference sheet and state confidence if a detail is small or partially visible.'
        : 'Be honest if you are judging from card context rather than a full rendered outfit image, but do not say you cannot see or discuss the generated outfits.'
    ].join('\n') : ''
  ].filter(Boolean).join('\n')

  const promptText = [
    generatedOutfitReferenceSheet ? 'Attached: current generated outfit garment-reference sheet.' : '',
    outfitImageContent ? 'Attached: images for the outfit under discussion.' : '',
    `Today is ${resolvedCurrentDateLabel} (${timezone || 'America/Los_Angeles'}).`,
    '',
    question
  ].filter(Boolean).join('\n')

  let userContent
  if (generatedOutfitReferenceSheet || outfitImageContent) {
    userContent = []
    if (generatedOutfitReferenceSheet) {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: generatedOutfitReferenceSheet.mime, data: generatedOutfitReferenceSheet.base64 } })
    }
    if (outfitImageContent) {
      userContent.push(...outfitImageContent)
    }
    userContent.push({ type: 'text', text: promptText })
  } else {
    userContent = promptText
  }

  return {
    system,
    messages: [
      ...(history || []).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: userContent }
    ],
    maxTokens: 1500,
    automaticallySavedCorrection
  }
}

// ── State Recovery / Storage proxy helpers (mirrored from tools.js) ──────────
export function getStylistConversationState(sessionId = 'default') {
  try {
    const row = db.prepare('SELECT state_json FROM stylist_conversation_state WHERE session_id = ?').get(sessionId)
    if (!row) return {}
    return JSON.parse(row.state_json || '{}')
  } catch (err) {
    console.error('getStylistConversationState error:', err)
    return {}
  }
}

export function saveStylistConversationState(state, sessionId = 'default') {
  try {
    const stateJson = JSON.stringify(state || {})
    db.prepare(`
      INSERT INTO stylist_conversation_state (session_id, state_json, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = datetime('now')
    `).run(sessionId, stateJson)
  } catch (err) {
    console.error('saveStylistConversationState error:', err)
  }
}

export function storeUserCorrection(note, contextType = 'general', contextId = null) {
  try {
    db.prepare(`
      INSERT INTO stylist_feedback (feedback_type, target_type, context_type, context_id, note)
      VALUES ('preference_reaction', 'message', ?, ?, ?)
    `).run(contextType, contextId, note)
  } catch (err) {
    console.error('storeUserCorrection error:', err)
  }
}

export function normalizeEditorialDirections(directions = []) {
  if (!Array.isArray(directions)) return []
  return directions.map((d, idx) => {
    const missingPieces = Array.isArray(d?.missingPieces)
      ? d.missingPieces.map(p => typeof p === 'string' ? p : (p?.name || p?.label || '')).filter(Boolean)
      : []
    return {
      title: d?.title || d?.label || `Ideal direction ${idx + 1}`,
      missingPieces,
      reason: d?.reason || d?.notes || d?.stylistReason || '',
      watchFor: d?.watchFor || d?.risk || '',
      visualPrompt: d?.visualPrompt || d?.prompt || d?.reason || ''
    }
  }).filter(d => d.title || d.missingPieces.length || d.reason)
}
