// Composition, prompt assembly, formatting and rendering pipelines.
// DOCUMENTED IN: docs/engine-behaviour-map.md, docs/flows/ (per-flow model-call diagrams), and
// docs/feedback-and-memory-map.md for buildStylistConversationPayload's memory blocks.
// Amend the matching doc in the same commit. See AGENTS.md.
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import sharp from 'sharp'
import OpenAI, { toFile } from 'openai'
import { db, userUploadsDir, safeJsonParse } from '../db.js'
import { buildWardrobeManifest, STRUCTURAL_FIELD_UNSET, stylingRulesForPrompt } from '../src/utils/wardrobeAiContext.js'
import { resolveOpenAiKey, hasOpenAiKey, noKeyErrorMessage } from '../lib/apiKeys.js'
import { getStylistConversationState, saveStylistConversationState } from './conversationState.js'
import { restoreWeatherProfile, serializeWeatherProfile } from './weather.js'

export { getStylistConversationState, saveStylistConversationState }

const FREEFORM_HISTORY_MAX_MESSAGES = 8
const FREEFORM_HISTORY_MAX_CHARS = 12000
const FREEFORM_HISTORY_MAX_MESSAGE_CHARS = 3500

function truncateFreeformHistoryContent(content, maxChars = FREEFORM_HISTORY_MAX_MESSAGE_CHARS) {
  const text = typeof content === 'string' ? content : JSON.stringify(content ?? '')
  if (text.length <= maxChars) return text
  const marker = '\n[Earlier detail omitted from bounded history]\n'
  if (maxChars <= marker.length + 2) return text.slice(-Math.max(0, maxChars))
  const available = Math.max(0, maxChars - marker.length)
  const head = Math.ceil(available / 2)
  return `${text.slice(0, head)}${marker}${text.slice(text.length - (available - head))}`
}

export function boundFreeformConversationHistory(history = [], {
  maxMessages = FREEFORM_HISTORY_MAX_MESSAGES,
  maxChars = FREEFORM_HISTORY_MAX_CHARS,
  maxMessageChars = FREEFORM_HISTORY_MAX_MESSAGE_CHARS,
} = {}) {
  const received = (Array.isArray(history) ? history : [])
    .filter(message => message?.role === 'user' || message?.role === 'assistant')
    .map(message => ({ role: message.role, content: message.content }))
  const receivedChars = received.reduce((sum, message) => sum + String(message.content ?? '').length, 0)
  let candidates = received.slice(-Math.max(1, maxMessages))
  while (candidates.length > 1 && candidates[0]?.role !== 'user') candidates.shift()

  const keptNewestFirst = []
  let usedChars = 0
  for (const message of [...candidates].reverse()) {
    const remaining = Math.max(0, maxChars - usedChars)
    if (!remaining) break
    const content = truncateFreeformHistoryContent(message.content, Math.min(maxMessageChars, remaining))
    keptNewestFirst.push({ role: message.role, content })
    usedChars += content.length
  }
  const messages = keptNewestFirst.reverse()
  while (messages.length > 1 && messages[0]?.role !== 'user') messages.shift()
  const includedChars = messages.reduce((sum, message) => sum + String(message.content ?? '').length, 0)
  return {
    messages,
    diagnostics: {
      historyMessagesReceived: received.length,
      historyMessagesIncluded: messages.length,
      historyCharsRemoved: Math.max(0, receivedChars - includedChars),
    }
  }
}

import {
  prompts,
  EXPRESSIVE_HIERARCHY_RULES,
  EDITORIAL_IMAGE_BASE_PROMPT,
  EDITORIAL_IMAGE_REALISM_RULE
} from './promptRuntime.js'

import {
  askStylist,
  askStylistWithUsage,
  askStylistStructuredWithUsage,
  askStylistWithTools,
  prepareImageForClaude,
  AI_PROVIDER,
  ACTIVE_STYLIST_MODEL,
  PROMPT_CACHE_BREAKPOINT,
  estimateAiUsageCost,
  mockAiEnabled,
  parseModelJson,
} from './provider.js'
import { isTravelOrPackingRequest, travelRequestCanResolveWeatherLive } from './stylingIntent.js'
import { formalityRank, pieceRequiresBaseLayer, visuallyPrioritizedPieces } from './attributes.js'
import { evaluateWearableOutfit } from './outfitValidation.js'
import { validatedFallback } from './recovery.js'
import { resolveCalendarSeason } from '../lib/seasonContext.js'
import { projectStylingApplicabilityContext } from './stylingContext.js'

import { OCCASION_PROFILES, resolveOccasionProfile } from './occasions.js'
import { extractWeatherContext } from './stylingIntent.js'

import {
  parsePiece,
  buildPieceText,
  wardrobeCategoryGroup,
  categoryConstraintForSelectedPiece,
  getWholeWardrobeFeedbackMemory,
  getSavedBoardMemory,
  getSavedBoardRendererMemory,
  wholeWardrobeMoodProfile,
  pieceTextBlob,
  selectDiverseWholeWardrobeCandidates,
  wholeWardrobeCandidateAxes,
  wholeWardrobeCandidateText,
  optionalLayerCoherenceIssue,
  buildOutfitGenerationCandidateText,
  getStylistFeedbackMemory,
  getProvisionalWrongChoiceMemory,
  getAcceptedFeedbackSynthesisMemory,
  sortByStylisticStrength,
  weatherProfileFromContext,
  footwearComfortVerdict,
  registerCeilingVerdict,
  resolveRegisterCeiling,
} from './rules.js'

function withSavedBoardRendererMemory(prompt, pieces = []) {
  const pieceIds = (Array.isArray(pieces) ? pieces : []).map(piece => Number(piece?.id)).filter(Boolean)
  const memory = getSavedBoardRendererMemory(pieceIds, 24)
  return memory ? `${prompt}\n\n${memory}` : prompt
}

// ── Basic helper/utility functions ───────────────────────────────────────────
// Parsing model JSON now goes through provider.js's parseModelJson, which already carries
// truncation detection (isTruncation, trusting the provider's own stop_reason when supplied)
// and chatty-narration recovery (salvageFirstJson) — capabilities this module's own
// safeJsonFromModel duplicated without the truncation awareness. Callers migrated 2026-08-25
// after thread_1787687552307 showed a real token-cap hit reported as generic "did not return
// JSON" instead of the identifiable truncation it was. See
// docs/post-254-architecture-roadmap.md R7.

// One shared token-budget shape for any schema-forced call whose output scales with a requested
// item count, parameterized per caller instead of each hardcoding its own flat ceiling. Originally
// introduced (as visualComposerMaxTokensForOutfitCount) for the two visual composers' JSON schema
// (label, strength, dominantDirection, silhouette, bestFor, pieces[], reason,
// styling_instructions, watchFor per outfit) — those defaults are preserved below. The atomic
// capsule composer (routes/ai.js's composeCapsulePlanOnce) used to carry its own separate,
// untuned formula (600 + count*180, ceiling 3200) instead of this one; a 10-look capsule hit that
// ceiling exactly and silently came back with zero outfits (thread_1787717774384). It was folded
// in with its own honest per-outfit rate and a ceiling wide enough for a 12-look capsule.
//
// Generalized further (base offset added, renamed from *ForOutfitCount) when a second, genuinely
// different-shaped caller needed the same formula: capsule roster selection (routes/ai.js's
// capsuleRosterSelectionSchema) scales by garment count, not outfit count, and its schema's free-
// text reasoning (category_shape_reason, category_departures[].reason, repair_changes[].reason)
// doesn't grow linearly with garment count the way an outfit's fields grow with outfit count — its
// own formula (300 + budget*65) hit its ceiling twice in the same live turn
// (thread_1787725557304), once on the first attempt and again on the repair. Per codebase-design's
// "two adapters means a real seam": a second real caller with a different base offset is the
// signal to widen the interface rather than add a fourth private formula beside it.
export function structuredResponseMaxTokens(itemCount = 4, { tokensPerItem = 500, base = 900, floor = 2200, ceiling = 4200 } = {}) {
  const count = Math.max(1, Number(itemCount) || 1)
  return Math.max(floor, Math.min(ceiling, base + count * tokensPerItem))
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
// tuck_behavior is the sole authority on whether a piece can be tucked —
// hem_finish is construction only (what shape the hem is) and must not be
// used to infer or override tuck permission. A piece with no tuck_behavior
// set returns null here rather than guessing from its hem; that gap is
// already surfaced through the normal confidence/review system instead.
export function computeTuckNote(p) {
  if (!p.category || !['top','dress','outerwear'].includes(p.category)) return null
  if (p.tuck_behavior === 'wear_over_only') return 'no tuck — wear over only'
  if (p.fabric_category === 'silk' || p.fabric_category === 'satin') return 'no tuck — silk/satin cannot hold'
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
  const isConfirmed = status === 'confirmed'
  const lines = []

  if (linkedPieces.length) {
    lines.push('AUTHORITY NOTE: This outfit has linked garment records. Treat linked garment truth as higher authority than the image. Do not rename, replace, or visually reinterpret linked pieces unless the user explicitly says the record is wrong.')
  } else {
    lines.push('AUTHORITY NOTE: No linked garment records are saved for this outfit yet. Image/title analysis is lower confidence. Avoid strong garment-identity claims and avoid recommending replacement of core pieces based only on a visual guess.')
  }

  if (isConfirmed) {
    lines.push(`STATUS NOTE: This outfit is marked confirmed. Start from the assumption that the core outfit has worked for ${prompts.PROFILE_NAME}. Explain WHY it works first. Suggest only minor refinements unless the user asks for alternatives.`)
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

export function findLikelyPiecesForOutfit(outfit, limit = 12) {
  const text = `${outfit.name || ''} ${outfit.notes || ''}`.toLowerCase()
  const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active' ORDER BY date_added DESC").all().map(parsePiece)
  const stop = new Set(['the','and','with','plus','outfit','look','top','pants','jeans','skirt','dress','shoes','boots','shirt','blouse','sweater','knit','sleeve','sleeves','casual','year','round'])
  const tokens = text.split(/[^a-z0-9]+/).filter(t => t.length > 2 && !stop.has(t))

  const scored = pieces.map(piece => {
    const hay = [
      piece.name, piece.category, piece.colors?.join(' '), piece.reads_as, piece.fabric_category,
      piece.silhouette, piece.notes, stylingRulesForPrompt(piece.styling_rules_learned).join(' ')
    ].filter(Boolean).join(' ').toLowerCase()
    let score = 0
    for (const t of tokens) if (hay.includes(t)) score += 3
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
    likelyPieces.length ? `Likely saved garment truth for Outfit A — hints only unless linked:\n${likelyPieces.map(buildPieceText).join('\n')}` : ''
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
  const negativeLabels = /style_direction|shape_balance|too_safe|too_boho|body_proportions_drift|wrong_silhouette|wrong_length|wrong_energy|catalog_like|not_me|ignore|bad|drift|too_polished|too_generic|too_soft/i

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

  const criticSystem = `You are a strict editor for ${prompts.PROFILE_NAME}'s generated outfit ideas.
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
- Use ${prompts.PROFILE_NAME}'s language: visual column, relaxed structure, grounded texture, compact top, stable bottom, controlled softness, signature direction.`

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

  const criticSystem = `You are a strict editor for ${prompts.PROFILE_NAME}'s wardrobe stylist app.
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
    strength: ['signature', 'strong', 'usable', 'experimental'].includes(strength) ? strength : (label.toLowerCase().includes('signature') ? 'signature' : 'strong'), // ratchet-allow: normalizing a style-memory label, not matching garment text
    dominantDirection: outfit?.dominantDirection || outfit?.dominant_direction || outfit?.direction || '',
    silhouette: outfit?.silhouette || '',
    bestFor: outfit?.bestFor || outfit?.best_for || '',
    reason: outfit?.reason || outfit?.why || '',
    stylingInstructions: outfit?.styling_instructions || outfit?.stylingInstructions || '',
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

// Thin adapter around the canonical wearable gate — selected-piece recovery/fallback callers need
// a {valid, primaryFinding} shape (consumed by recovery.js's validatedFallback), not
// evaluateWearableOutfit's full stage/finding structure, but the underlying hard-validity question
// must be the same one every other flow answers. This used to run only evaluateOutfitStructure +
// evaluateRequiredBaseLayers — a real, silently weaker parallel contract missing layer direction and
// layer construction (the sleeve-construction check), so a model-composed outfit that failed the
// canonical gate could still pass here. Do not copy individual checks back in if the canonical gate
// grows another one; project through evaluateWearableOutfit instead.
export function validateSelectedRecoveryOutfit(outfit = {}, selectedPiece = {}, candidatePieces = []) {
  const pieceById = new Map([selectedPiece, ...(candidatePieces || [])]
    .filter(Boolean)
    .map(piece => [Number(piece.id), piece]))
  const pieces = (outfit.pieceIds || []).map(id => pieceById.get(Number(id))).filter(Boolean)
  if (!pieces.some(piece => Number(piece.id) === Number(selectedPiece?.id))) {
    return { valid: false, reason: 'selected_anchor_missing' }
  }
  const verdict = evaluateWearableOutfit(pieces, { requireShoes: true, includeLayerDirections: true })
  return verdict.hardValid
    ? { valid: true }
    : { valid: false, primaryFinding: verdict.primaryFinding }
}

// locallyGateOutfitDirections dedupes by pieceIds and folds in the label, so two outfits with
// different pieces but the same generated label survive intact — thread_1787791754740 saw two
// "Artisan City Bohemian: standard wear" directions (cat tee vs. emerald top) reach the user, and a
// follow-up naming the label by itself resolved to the wrong one. Applied once, after every branch
// has settled on its final outfit list, so it sees exactly what the user will read regardless of
// which path produced it.
export function disambiguateOutfitLabels(outfits = [], selectedPiece) {
  const selectedId = Number(selectedPiece?.id)
  const seenCounts = new Map()
  return (outfits || []).map(outfit => {
    const label = String(outfit?.label || '').trim()
    if (!label) return outfit
    const key = label.toLowerCase()
    const count = seenCounts.get(key) || 0
    seenCounts.set(key, count + 1)
    if (count === 0) return outfit
    const distinguishingPiece = (outfit.pieces || []).find(p => p?.name && Number(p.id) !== selectedId)
    const suffix = distinguishingPiece ? ` (with ${distinguishingPiece.name})` : ` (variant ${count + 1})`
    return { ...outfit, label: `${label}${suffix}` }
  })
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
  // This fallback only ever picks one piece per category and has no concept
  // of adding a base layer underneath — unlike the composer paths, which
  // either add one (core.js:2075) or exclude needs_base pieces outright
  // (tools.js:1913). Prefer standalone-wearable pieces first within each
  // affected category so a dependent piece only surfaces here when it's the
  // only option, never displacing a standalone piece that needed no layering
  // this fallback can't provide.
  for (const cat of ['top', 'dress', 'outerwear']) {
    byCategory[cat].sort((a, b) => Number(pieceRequiresBaseLayer(a)) - Number(pieceRequiresBaseLayer(b)))
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

  const locallyGated = locallyGateOutfitDirections(outfits, selected).slice(0, 3)
  const recoveryPieces = rankedCandidates.map(entry => entry?.piece || entry).filter(Boolean)
  const fallback = validatedFallback({
    candidates: locallyGated,
    limit: 3,
    validate: outfit => validateSelectedRecoveryOutfit(outfit, selected, recoveryPieces),
    context: { flow: 'selected_piece', selectedPieceId: Number(selected?.id) || null },
  })
  return fallback.values
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

// Prompt-responsibility census verification (2026-08-26): OUTFIT_EVALUATOR_GATE_SYSTEM audits real
// tagged pieces, unlike the purely conceptual EDITORIAL_NEW_PIECES_SYSTEM. The selected anchor
// bypasses automatic-use eligibility (ratified 2026-08-25), so it is the one piece the evaluator
// sees that never ran registerCeilingVerdict/footwearComfortVerdict — every supporting candidate
// already did, via selectAutomaticUseCandidatesForOutfitGeneration upstream. Computing the anchor's
// own verdicts here, as a directly testable pure function, and citing the result closes the one case
// where the evaluator's free-prose judgment could genuinely diverge from the canonical verdict on
// the same request. Returns '' when neither check finds an issue — most requests.
export function anchorRegisterFootwearComputedChecks({ selectedPiece, occasion, activity = '', mood = '', question = '', occasionProfile = null, activityProfile = null }) {
  const registerCeilingRank = formalityRank(resolveRegisterCeiling({
    occasion, activity, mood, request: question, occasionProfile, activityProfile,
  }))
  const registerVerdict = registerCeilingVerdict(selectedPiece, registerCeilingRank, { occasion })
  const footwearVerdict = footwearComfortVerdict(
    selectedPiece,
    activityProfile?.rules?.excluded_heel_heights || [],
    activityProfile?.rules?.excluded_walk_support || [],
  )
  return [
    registerVerdict.verdict === 'exclude'
      ? `Selected garment register check (computed): its formality "${registerVerdict.formality}" exceeds the occasion's register ceiling.`
      : '',
    footwearVerdict.verdict === 'exclude'
      ? `Selected garment footwear check (computed): its ${footwearVerdict.dimension} value "${footwearVerdict.value}" is unsuitable for this activity.`
      : '',
  ].filter(Boolean).join('\n')
}

export async function composeStructuredOutfitsForPiece({ selectedPiece, rankedCandidates, occasion, season, mission, mood, question, idealMode, idealOnlyMode, memoryText, history = [], activity = '', occasionProfile = null, activityProfile = null }) {
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
    system: prompts.OUTFIT_COMPOSER_SYSTEM,
    maxTokens: 1800,
    messages: [
      ...(history || []).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: [{ type: 'text', text: userPayload }] }
    ]
  })

  let composerParsed = parseModelJson(rawComposer, { context: 'outfit composer', maxTokens: 1800 })
  console.log(`[0]    - Raw AI Composer response:\n${rawComposer}\n`)
  console.log(`[0]    - Parsed AI Composer JSON:`, JSON.stringify(composerParsed, null, 2))
  let normalized = (composerParsed.outfits || []).map(o => normalizeGeneratedOutfitObject(o, selectedPiece, candidatePieces))

  let gated = { outfits: normalized, rejected: [], skip: composerParsed.skip || '', saveableLearning: composerParsed.saveableLearning || '' }
  try {
    const anchorComputedChecks = anchorRegisterFootwearComputedChecks({
      selectedPiece, occasion, activity, mood, question, occasionProfile, activityProfile,
    })
    const rawGate = await askStylist({
      system: prompts.OUTFIT_EVALUATOR_GATE_SYSTEM,
      maxTokens: 1400,
      messages: [{ role: 'user', content: [{ type: 'text', text: [
        `Selected garment truth:\n${buildPieceText(selectedPiece)}`,
        categoryConstraintForSelectedPiece(selectedPiece),
        `Occasion: ${occasion}`,
        `Season: ${season}`,
        mission && mission !== 'mix' ? `Mission: ${mission}` : '',
        mood ? `Mood: ${mood}` : '',
        anchorComputedChecks,
        `Composer JSON to audit:\n${JSON.stringify({ outfits: normalized, skip: composerParsed.skip || '', saveableLearning: composerParsed.saveableLearning || '' }, null, 2)}`
      ].filter(Boolean).join('\n\n') }] }]
    })
    const gateParsed = parseModelJson(rawGate, { context: 'outfit evaluator gate', maxTokens: 1400 })
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

  // Local/deterministic logic may prepare and rank candidate space, but it may not supply a
  // user-facing outfit recommendation the styling model never actually selected or evaluated
  // (2026-08-27 policy, thread_1787803856242). This used to call buildLocalFallbackOutfitDirections()
  // as a base whenever the AI composer returned zero (or, in the closet-only branch, fewer than 4)
  // owned-wardrobe outfits — an engine-only category-fill pick, sometimes then decorated with an
  // "ideal missing piece" completion, presented with the same confident labeling as a real
  // composition and with none of the shared hard validation. A composer that returns nothing now
  // surfaces as an explicit `compositionSkipped` failure state instead.
  let compositionSkipped = null

  if (idealOnlyMode) {
    outfits = buildIdealOnlyCompletionsForPiece(selectedPiece).map(o => normalizeGeneratedOutfitObject(o, selectedPiece, candidatePieces))
  } else if (idealMode) {
    outfits = ensureIdealMissingCompletion(outfits, selectedPiece, true).map(o => normalizeGeneratedOutfitObject(o, selectedPiece, candidatePieces))
    if (!outfits.length) compositionSkipped = 'composer_failed'
  } else {
    outfits = sanitizeSelectedPieceOutfitDirections(outfits, selectedPiece, candidatePieces, { occasion })
    outfits = validatedFallback({
      candidates: outfits,
      limit: outfits.length,
      validate: outfit => validateSelectedRecoveryOutfit(outfit, selectedPiece, candidatePieces),
      context: { flow: 'selected_piece_post_sanitize', selectedPieceId: Number(selectedPiece?.id) || null },
    }).values
    console.log(`    - After sanitizeSelectedPieceOutfitDirections: ${outfits.length} outfits:`, outfits.map(o => `${o.label} (pieces: ${o.pieceIds?.join(', ')})`))
    if (!outfits.length) compositionSkipped = 'composer_failed'
  }

  return {
    outfits: disambiguateOutfitLabels(outfits, selectedPiece),
    rejected: gated.rejected || [],
    skip: compositionSkipped
      ? 'The stylist didn\'t return any usable outfit ideas for this piece this time. Try again.'
      : (gated.skip || composerParsed.skip || ''),
    saveableLearning: gated.saveableLearning || composerParsed.saveableLearning || '',
    compositionSkipped,
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
  const filePath = photo ? path.join(userUploadsDir(), photo) : null
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
    system: prompts.VISUAL_SUPPORT_CRITIC_SYSTEM,
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
  const parsed = parseModelJson(raw, { context: 'visual support critic', maxTokens: 900 })
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
    system: prompts.VISUAL_WARDROBE_CRITIC_SYSTEM,
    maxTokens: 900,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: sheet.mime, data: sheet.base64 } },
        { type: 'text', text: [
          `Occasion: ${occasion || 'casual'}`,
          `Season: ${season || 'current season'}`,
          mood ? `Mood: ${mood}` : '',
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
  const parsed = parseModelJson(raw, { context: 'visual wardrobe critic', maxTokens: 900 })
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

// The composer above proposes outfits from ISOLATED per-garment photos — it never sees two
// pieces together, so its own written "reason" can rationalize a pairing (shared color-family
// words, "one loud piece grounded by support") that the actual photos, side by side, show
// clashing. This builds one contact sheet of the outfits it already composed and asks a second
// pass to judge only what the row actually shows, ignoring the first pass's own prose.
export async function makeComposedOutfitClashContactSheet(outfits = [], maxOutfits = 12) {
  const shown = outfits.slice(0, maxOutfits)
  const width = 1120
  const rowHeight = 196
  const headerHeight = 76
  const height = headerHeight + shown.length * rowHeight + 28
  const composites = []
  const rowSvgs = []

  for (const [index, outfit] of shown.entries()) {
    const y = headerHeight + index * rowHeight
    const pieces = (Array.isArray(outfit.pieces) ? outfit.pieces : []).slice(0, 5)
    const title = `${index}: ${outfit.label || pieces.map(piece => piece.name).join(' + ')}`
    rowSvgs.push(`
      <rect x="24" y="${y}" width="${width - 48}" height="${rowHeight - 14}" rx="18" fill="#fffaf7" stroke="#ddd1c6"/>
      <text x="44" y="${y + 30}" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#3f352e">${escapeSvgText(title)}</text>
    `)
    composites.push(...await Promise.all(pieces.map(async (piece, pieceIndex) => ({
      input: await makeGarmentTile(piece, 150, 132),
      left: 44 + pieceIndex * 166,
      top: y + 44
    }))))
  }

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f4efe8"/>
    <text x="32" y="38" font-family="Georgia, serif" font-size="30" fill="#2f2924">Composed outfit clash review</text>
    <text x="32" y="62" font-family="Arial, sans-serif" font-size="14" fill="#786d63">Each row is one already-composed outfit. Judge only what the photos show — ignore any written justification.</text>
    ${rowSvgs.join('')}
  </svg>`
  const buffer = await sharp(Buffer.from(svg)).composite(composites).jpeg({ quality: 84 }).toBuffer()
  return { base64: buffer.toString('base64'), mime: 'image/jpeg', shownCount: shown.length }
}

export async function reviewComposedWholeWardrobeOutfitsForClash({ outfits = [], occasion, season, mood, memoryText = '' } = {}) {
  const reviewable = outfits.filter(outfit => (outfit.pieces || []).some(piece => piece.photo || piece.worn_photo))
  if (reviewable.length < 1) return null

  const sheet = await makeComposedOutfitClashContactSheet(reviewable, 12)
  const raw = await askStylist({
    system: prompts.WHOLE_WARDROBE_OUTFIT_CLASH_CRITIC_SYSTEM,
    maxTokens: 700,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: sheet.mime, data: sheet.base64 } },
        { type: 'text', text: [
          `Occasion: ${occasion || 'casual'}`,
          `Season: ${season || 'current season'}`,
          mood ? `Mood: ${mood}` : '',
          memoryText ? `Taste memory:\n${memoryText.slice(0, 3000)}` : ''
        ].filter(Boolean).join('\n') }
      ]
    }]
  })
  const parsed = parseModelJson(raw, { context: 'whole wardrobe outfit clash critic', maxTokens: 700 })
  const flagged = Array.isArray(parsed.flagged) ? parsed.flagged : []
  const flaggedByOutfit = new Map()
  for (const item of flagged) {
    const index = Number(item?.index)
    if (!Number.isInteger(index) || index < 0 || index >= reviewable.length) continue
    flaggedByOutfit.set(reviewable[index], String(item?.reason || 'visual critic flagged a clash in the photos').trim())
  }
  return { flaggedByOutfit, reviewedCount: reviewable.length }
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
      stylingInstructions: outfit.styling_instructions || outfit.stylingInstructions || '',
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
  // WARDROBE_MOCK_AI implies photo-preserving (local collage) rendering too,
  // so mock mode never triggers a billed OpenAI image-generation call.
  return String(process.env.PHOTO_PRESERVING_VISUALS || 'false').toLowerCase() === 'true' || mockAiEnabled()
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
  const boardDir = path.join(userUploadsDir(), 'generated-boards')
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
  const outPath = path.join(userUploadsDir(), filename)
  await sharp(Buffer.from(baseSvg)).composite(composites).png().toFile(outPath)
  return `/uploads/${filename}`
}

export async function createOutfitBoardImage({ board, pieces, index }) {
  const boardDir = path.join(userUploadsDir(), 'generated-boards')
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
  const outPath = path.join(userUploadsDir(), filename)
  await sharp(Buffer.from(headerSvg)).composite(composites).png().toFile(outPath)
  return `/uploads/${filename}`
}

// The hanger photo is the authority for print scale, colour, texture and construction, so it needs
// full resolution. The worn photo's only job is geometry — how the garment falls, where the hem
// lands, how a sleeve sits — and geometry is large-scale, so it survives downscaling intact. A face
// does not: at this size there is far less facial detail available to copy.
//
// This is deliberate damage to one part of the image to protect another. Verified against two
// renders of the same wardrobe: the rendered expression tracked whichever worn photo was in that
// outfit (a downcast closet mirror selfie produced a downcast face; a warm, engaged one produced a
// warm face), even though the label below explicitly forbids using it as an identity reference.
// The instruction did not hold, so the pixels have to carry less to copy.
export const HANGER_REFERENCE_MAX_PX = 768
export const WORN_REFERENCE_MAX_PX = 400

export function garmentReferencePlan(piece = {}, { maxPhotos = 2 } = {}) {
  const group = wardrobeCategoryGroup(piece)
  const name = piece.name || 'garment'
  const candidates = [
    // A worn photo necessarily shows her face and body — that's what makes it useful for fit and
    // drape — but it is not the identity reference. Said so explicitly: before this, nothing told
    // the model to prefer the dedicated calibration photos over whichever garment happened to
    // carry a worn shot, and a wardrobe can have several, taken on different days under different
    // light. Garment fields stay first in the label; the identity disclaimer is appended, not
    // leading, so this reads as a garment reference with a caveat, not an identity reference.
    piece.worn_photo ? {
      kind: 'worn',
      filename: piece.worn_photo,
      maxPx: WORN_REFERENCE_MAX_PX,
      label: `${name} (${group}) — worn photo, intentionally low resolution: read it only for how this garment hangs, where its hem falls, and how it sits on a body. Do not use this photo's face, hair, expression, or body proportions as an identity or likeness reference — use only the dedicated identity/proportion calibration photos for that.`,
    } : null,
    piece.photo ? {
      kind: 'hanger',
      filename: piece.photo,
      maxPx: HANGER_REFERENCE_MAX_PX,
      label: `${name} (${group}) — hanger photo: authoritative for construction, color, print scale, texture, and garment shape${piece.worn_photo ? '' : '; no worn photo is available, so body fit and drape are unconfirmed and must be inferred conservatively from structured garment data'}`,
    } : null,
  ].filter(Boolean)
  return candidates.slice(0, Math.max(0, Number(maxPhotos) || 0))
}

export async function garmentReferenceImages(piece, options = {}) {
  const refs = []
  for (const planned of garmentReferencePlan(piece, options)) {
    const filePath = path.join(userUploadsDir(), planned.filename)
    if (!fs.existsSync(filePath)) continue
    const maxPx = Number(planned.maxPx) || HANGER_REFERENCE_MAX_PX
    const buffer = await sharp(filePath)
      .rotate()
      .resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 84 })
      .toBuffer()
    refs.push({
      base64: buffer.toString('base64'),
      mime: 'image/jpeg',
      label: planned.label,
      kind: planned.kind,
      piece,
    })
  }
  return refs
}

// Shared with editorialImagePrompt below — a category-level "don't substitute this for a generic
// version" checklist. Extracted 2026-08-27 (thread_1787813410728): editorialImagePrompt used to
// describe every non-anchor garment with prose alone (or nothing at all), and the image model
// routinely invented wrong pants/shoes details as a result. One owner for this checklist so both
// prompts stay in sync rather than drifting into two different fidelity vocabularies.
function pieceFidelityChecklist(pieces) {
  return pieces.map((piece, index) => {
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
}

// Shared with editorialImagePrompt below — same extraction reasoning as pieceFidelityChecklist.
function pieceConstructionChecklist(pieces) {
  return pieces.map((piece, index) => {
    const fields = [
      piece.silhouette ? `preserve its ${String(piece.silhouette).replaceAll('_', ' ')} silhouette` : '',
      piece.length_hits_at ? `keep its ${String(piece.length_hits_at).replaceAll('_', ' ')} length` : '',
      piece.hem_finish ? `show its complete ${String(piece.hem_finish).replaceAll('_', ' ')}` : '',
      (() => {
        const length = piece.sleeve_length && piece.sleeve_length !== 'sleeveless' ? String(piece.sleeve_length).replaceAll('_', ' ') : ''
        const shape = piece.sleeve_shape && piece.sleeve_shape !== 'other' && piece.sleeve_shape !== 'unknown' ? String(piece.sleeve_shape).replaceAll('_', ' ') : ''
        const combined = [length, shape].filter(Boolean).join(' ')
        return combined ? `preserve its ${combined} sleeves` : ''
      })(),
      piece.fit_on_body && piece.fit_on_body !== 'none' ? `render its fit as ${String(piece.fit_on_body).replaceAll('_', ' ')}` : '',
      piece.tuck_behavior === 'wear_over_only'
        ? 'wear it fully outside the bottom waistband, with the complete hem visible and no part tucked in'
        : (piece.tuck_behavior ? `respect its ${String(piece.tuck_behavior).replaceAll('_', ' ')} wear behavior` : ''),
      piece.waistband_type ? `preserve the ${String(piece.waistband_type).replaceAll('_', ' ')} waistband` : '',
      piece.opacity && piece.opacity !== 'opaque' ? `preserve its ${String(piece.opacity).replaceAll('_', ' ')} opacity` : '',
      pieceRequiresBaseLayer(piece) ? 'show it with a base layer' : '',
    ].filter(Boolean)
    return `${index + 1}. ${piece.name}: ${fields.length ? fields.join('; ') : 'use the reference image and garment truth as provided'}.`
  }).join('\n')
}

export function wholeWardrobeImagePrompt({ outfit = {}, pieces = [], occasion = 'casual', season = 'current season' }) {
  const pieceLines = pieces.map((piece, index) => {
    const truth = buildPieceText(piece).replace(/\s+/g, ' ').slice(0, 900)
    return `${index + 1}. ${piece.name} (${wardrobeCategoryGroup(piece)}): ${truth}`
  }).join('\n')
  const fidelityChecklist = pieceFidelityChecklist(pieces)
  const constructionChecklist = pieceConstructionChecklist(pieces)
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
    '- Structured garment fields and reference images are authoritative for each garment’s own construction: fit, length, hem, sleeve, tuck, waistband, and opacity. Outfit labels, reasons, and style prose are intent notes only and must be ignored wherever they conflict with those per-garment facts. The one exception is "Authoritative styling instructions" below, when present: it governs how the listed garments relate to each other (layering order, what sits over/under what, where a belt or tie lands) and must be followed exactly, even where a more conventional default would look plausible — it can direct a relationship between garments, but it can never override a single garment’s own construction fields above.',
    '',
    `Piece-specific fidelity checklist:\n${fidelityChecklist}`,
    '',
    `Authoritative garment construction:\n${constructionChecklist}`,
    '',
    outfit.stylingInstructions ? `Authoritative styling instructions (how these garments relate to each other — follow exactly):\n${outfit.stylingInstructions}` : '',
    '',
    'Person / scene:',
    '- Full figure visible from head to shoes, single adult woman, natural relaxed posture, ordinary realistic proportions, no beauty retouching.',
    '- Simple neutral or natural background, soft daylight, no text, no watermark, no collage labels.',
    '- Keep the result wearable and grounded, closer to a real try-on/photo reference than a fashion ad.',
    '',
    `Outfit label: ${outfit.label || 'Whole wardrobe outfit'}`,
    outfit.dominantDirection ? `Direction: ${outfit.dominantDirection}` : '',
    outfit.silhouette ? `Silhouette: ${outfit.silhouette}` : '',
    outfit.reason ? `Non-authoritative styling intent: ${outfit.reason}` : '',
    outfit.watchFor ? `Avoid drift: ${outfit.watchFor}` : '',
    `Occasion: ${occasion}. Season: ${season}.`,
    '',
    `Saved wardrobe pieces to use:\n${pieceLines}`,
    '',
    'Final render check: the visible outfit must satisfy every authoritative garment-construction direction and the authoritative styling instructions (if present) above, even when a more conventional styling choice would look plausible.'
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
      outfit.stylingInstructions ? `Authoritative styling instructions (how these garments relate to each other — follow exactly): ${outfit.stylingInstructions}` : '',
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
    "- Where a panel lists authoritative styling instructions, follow them exactly for that panel's layering/positioning, even where a more conventional default would look plausible.",
    '',
    'Style direction:',
    '- Relaxed artistic realism, grounded personal style, believable wearable outfits.',
    '- Avoid fashion fantasy, influencer polish, generic catalog styling, and overly decorative accessories.',
    occasionLine,
    '',
    `Outfit panels:\n${outfitLines}`
  ].filter(Boolean).join('\n')
}

export function savedOutfitImagePrompt({ outfit = {}, pieces = [], occasion = 'casual', season = 'current season', variantMode = 'similar', currentDate = new Date() }) {
  const mode = variantMode === 'creative' ? 'creative' : 'similar'
  const weatherProfile = weatherProfileFromContext({ season, currentDate })
  const requestedAnchorId = Number(outfit.mainPieceId || outfit.main_piece_id || outfit.anchorPieceId || outfit.anchor_piece_id) || null
  const userSelectedAnchor = requestedAnchorId
    ? (pieces || []).find(piece => Number(piece.id) === requestedAnchorId)
    : null
  const anchorPiece = userSelectedAnchor
    || (pieces || []).find(piece => wardrobeCategoryGroup(piece) === 'top')
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
    anchorPiece ? `Keep this ${userSelectedAnchor ? 'user-selected main linked garment' : 'linked garment'} as a visible anchor in all three alternatives unless the saved outfit itself has no clear anchor: ${anchorPiece.name} (${wardrobeCategoryGroup(anchorPiece)}). Do not replace or redesign that anchor garment.` : '',
    '',
    'Shared quality rules:',
    '- Avoid mere micro-variations such as only changing tuck, sleeve length, belt, jewelry, or bag.',
    '- Each alternative must change a meaningful styling axis: silhouette relationship, grounding/shoe strategy, layer logic, palette relationship, focal hierarchy, or outfit category.',
    '- Prefer high-quality styling ideas over maximum difference.',
    '- Keep proportions coherent, visual hierarchy clear, and wearability believable.',
    '- Avoid random novelty, generic catalog styling, influencer polish, bland retail styling, and overly soft beige looks.',
    '- Do not repeat the same skirt shape, same shoe family, same color family, or same layer idea across all three.',
    '- Across the three alternatives, vary the outfit formula family, silhouette family, grounding/shoe strategy, and focal hierarchy. If two ideas share the same anchor, make the surrounding structure visibly different.',
    weatherProfile.isHot
      ? '- Warm/current-season realism: do not introduce boots, ankle boots, or heavy cold-weather footwear unless they are already essential to the saved outfit reference; prefer seasonally plausible flats, loafers, sneakers, sandals, or light slip-ons.'
      : '',
    weatherProfile.isCold
      ? '- Cold/current-season realism: avoid bare warm-weather footwear unless the saved outfit reference clearly requires it; prefer seasonally plausible closed shoes, boots, or layers.'
      : '',
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

export async function createSavedOutfitImage({ outfit = {}, pieces = [], occasion = 'casual', season = 'current season', index = 1, variantMode = 'similar', currentDate = new Date() }) {
  const startedAt = Date.now()
  const timings = {}
  const filename = `generated-boards/saved-outfit-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(userUploadsDir(), filename)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const sourcePath = outfit.photo ? imageUrlToUploadPath(outfit.photo) : null

  if (photoPreservingVisualsEnabled() || !hasOpenAiKey()) {
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
    const client = new OpenAI({ apiKey: resolveOpenAiKey() })
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

    // Calibration goes before garment references, not after: garment worn photos also show her,
    // and establishing the real identity anchor first — before any competing photo of her arrives
    // — is the point, not just what the text says.
    const calibrationStartedAt = Date.now()
    const calibrationRefs = await getCalibrationReferenceImagesForGeneration(2)
    timings.calibrationReferenceMs = Date.now() - calibrationStartedAt
    for (const img of calibrationRefs) {
      contentParts.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.base64}` })
      contentParts.push({
        type: 'input_text',
        text: img.kind === 'real_photo'
          ? 'Identity/proportion calibration reference — the only authoritative source for her face, body proportions, and likeness. A garment reference photo elsewhere in this prompt may also show a person wearing that garment; that photo is fit/drape evidence only, never an identity reference.'
          : 'Taste calibration reference.',
      })
    }

    const garmentStartedAt = Date.now()
    const garmentRefs = (await Promise.all(visuallyPrioritizedPieces(pieces, 5).map(piece => garmentReferenceImages(piece)))).flat()
    timings.garmentReferenceMs = Date.now() - garmentStartedAt
    for (const ref of garmentRefs) {
      contentParts.push({ type: 'input_text', text: `Linked garment reference: ${ref.label}` })
      contentParts.push({ type: 'input_image', image_url: `data:${ref.mime};base64,${ref.base64}` })
    }

    contentParts.push({ type: 'input_text', text: withSavedBoardRendererMemory(savedOutfitImagePrompt({ outfit, pieces, occasion, season, variantMode, currentDate }), pieces) })
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

export async function createWholeWardrobeOutfitImage({ outfit, pieces, occasion, season, index = 1, forceAi = false }) {
  const startedAt = Date.now()
  const timings = {}
  const filename = `generated-boards/whole-wardrobe-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(userUploadsDir(), filename)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })

  const board = {
    label: outfit.label || `Whole wardrobe outfit ${index}`,
    reason: outfit.reason || '',
  }

  if (mockAiEnabled() || (!forceAi && photoPreservingVisualsEnabled()) || !hasOpenAiKey()) {
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
    const client = new OpenAI({ apiKey: resolveOpenAiKey() })
    const contentParts = []

    // Calibration goes before garment references, not after: several of the garment worn photos
    // below also show her, and establishing the real identity anchor first — before any competing
    // photo of her arrives — is the point, not just what the text says.
    const calibrationStartedAt = Date.now()
    const calibrationRefs = await getCalibrationReferenceImagesForGeneration(2)
    timings.calibrationReferenceMs = Date.now() - calibrationStartedAt
    for (const img of calibrationRefs) {
      contentParts.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.base64}` })
      contentParts.push({
        type: 'input_text',
        text: img.kind === 'real_photo'
          ? 'Identity/proportion reference only — the only authoritative source for her face, body proportions, and likeness. Do not copy outfit unless it matches listed wardrobe pieces. Wardrobe garment references below may also show a person wearing that garment; that is fit/drape evidence only, never an identity reference.'
          : 'Taste calibration reference only.',
      })
    }

    const garmentStartedAt = Date.now()
    const garmentRefs = (await Promise.all(visuallyPrioritizedPieces(pieces, 5).map(piece => garmentReferenceImages(piece)))).flat()
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

    contentParts.push({ type: 'input_text', text: withSavedBoardRendererMemory(wholeWardrobeImagePrompt({ outfit, pieces, occasion, season }), pieces) })

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
  const outPath = path.join(userUploadsDir(), filename)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const shown = outfits.slice(0, 5)
  const uniquePieces = [...new Map(
    shown
      .flatMap(outfit => (outfit.pieceIds || []).map(id => piecesById.get(Number(id))).filter(Boolean))
      .map(piece => [Number(piece.id), piece])
  ).values()]

  if (photoPreservingVisualsEnabled() || !hasOpenAiKey()) {
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
    const client = new OpenAI({ apiKey: resolveOpenAiKey() })
    const contentParts = []

    // Calibration goes before garment references, not after. This sheet can carry up to 18
    // garment images preferring worn evidence — up to 18 photos that may show her — against just 2
    // calibration photos, so establishing the real identity anchor first, before any of those
    // arrive, matters more here than anywhere else this pattern is used.
    const calibrationStartedAt = Date.now()
    const calibrationRefs = await getCalibrationReferenceImagesForGeneration(2)
    timings.calibrationReferenceMs = Date.now() - calibrationStartedAt
    for (const img of calibrationRefs) {
      contentParts.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.base64}` })
      contentParts.push({
        type: 'input_text',
        text: img.kind === 'real_photo'
          ? 'Identity/proportion reference only — the only authoritative source for her face, body proportions, and likeness. Do not copy outfit unless it matches a listed panel. Garment references below may show a person wearing that garment; that is fit/drape evidence only, never an identity reference.'
          : 'Taste calibration reference only.',
      })
    }

    contentParts.push({
      type: 'input_text',
      text: 'WARDROBE GARMENT REFERENCES — these are the saved pieces available for the outfit panels. Use each piece only in the panel where it is listed in the final prompt.'
    })
    const garmentStartedAt = Date.now()
    // Comparison sheets can contain 18 garments. Keep this preview to one reference per garment
    // (prefer worn evidence) rather than doubling the request to as many as 36 input images.
    const garmentRefs = (await Promise.all(uniquePieces.slice(0, 18).map(piece => garmentReferenceImages(piece, { maxPhotos: 1 })))).flat()
    timings.garmentReferenceMs = Date.now() - garmentStartedAt
    for (const ref of garmentRefs) {
      contentParts.push({ type: 'input_text', text: `Garment reference: ${ref.piece.id} — ${ref.label}` })
      contentParts.push({ type: 'input_image', image_url: `data:${ref.mime};base64,${ref.base64}` })
    }

    contentParts.push({ type: 'input_text', text: withSavedBoardRendererMemory(wholeWardrobeComparisonSheetPrompt({ outfits: shown, piecesById, occasion, season, mood }), uniquePieces) })
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

    // Title used to render as one unwrapped centered <text> — a long label (e.g. "3. Stripe & Black
    // Canvas Edge") routinely overran its own column width and visually spilled into the next
    // column's title, since SVG text has no implicit wrapping. Wrapped the same way the reason text
    // below it already was, at a shorter line length (16px bold vs. 12px regular chars are wider),
    // and the reason block's start position now follows however many lines the title actually took
    // instead of a fixed y — a single-line title reproduces the original y=76 exactly.
    const titleLineHeight = 20
    const headerSvg = `<svg width="${imgW}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f7f3ed"/>
      ${shown.map((outfit, index) => {
        const centerX = (index + 0.5) * colW
        const title = `${index + 1}. ${outfit.label || `Direction ${index + 1}`}`
        const titleLines = wrapText(title, 22)
        const reasonStartY = 48 + (titleLines.length - 1) * titleLineHeight + 28
        const lines = wrapText(outfit.reason || '', 32)
        return `
          ${titleLines.map((line, tIdx) => `<text x="${centerX}" y="${48 + tIdx * titleLineHeight}" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#221c16">${escapeSvgText(line)}</text>`).join('')}
          ${lines.map((line, lIdx) => `<text x="${centerX}" y="${reasonStartY + lIdx * 18}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#5a5045">${escapeSvgText(line)}</text>`).join('')}
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
  const outPath = path.join(userUploadsDir(), filename)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })

  const garmentRefs = await garmentReferenceImages(selectedPiece)
  const anchorRules = anchorFidelityInstructions(selectedPiece)

  const directionLines = directions.map((d, i) => [
    `FIGURE ${i + 1} — "${d.label}"`,
    `Wears the selected garment (see reference photo) plus these NEW pieces: ${
      (d.additions || []).join(', ')}`,
    d.visualPrompt ? `PRIMARY RENDERING DIRECTIVE for this figure — follow this exactly: ${d.visualPrompt}` : '',
    d.reason ? `Styling intent: ${d.reason}` : ''
  ].filter(Boolean).join('\n')).join('\n\n')

  const promptText = [
    `Generate ONE comparison image containing ${directions.length} full-body figures of the same woman standing side by side, each labeled ${directions.map((_, i) => `"${directions[i].label}"`).join(', ')}.`,
    '',
    'Selected garment fidelity rules:',
    '- Every figure wears the EXACT garment shown in the attached reference photo. Preserve its color, length, neckline, fabric weight, and silhouette precisely. Do not restyle, recolor, or shorten it.',
    anchorRules ? `- ${anchorRules}` : '',
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
    if (process.env.NODE_ENV === 'test' || mockAiEnabled()) {
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

    if (!hasOpenAiKey()) {
      const err = new Error(noKeyErrorMessage('openai'))
      err.code = 'no_api_key'
      throw err
    }
    const client = new OpenAI({ apiKey: resolveOpenAiKey() })
    const contentParts = []
    // Calibration first: this sheet renders the SAME WOMAN across every figure, so an identity
    // anchor established before the selected garment's own worn photo (if it has one) matters even
    // more here — drift would repeat across every figure, not just one.
    const calibrationRefs = await getCalibrationReferenceImagesForGeneration(2)
    for (const img of calibrationRefs) {
      contentParts.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.base64}` })
      contentParts.push({
        type: 'input_text',
        text: img.kind === 'real_photo'
          ? 'Identity/proportion reference only — the only authoritative source for her face, body proportions, and likeness across every figure. The garment reference photo below may also show a person wearing it; that is fit/drape evidence only, never an identity reference.'
          : 'Taste calibration reference only.',
      })
    }
    for (const garmentRef of garmentRefs) {
      contentParts.push({ type: 'input_text', text: `Reference photo: ${garmentRef.label}. This exact garment appears on every figure.` })
      contentParts.push({
        type: 'input_image',
        image_url: `data:${garmentRef.mime};base64,${garmentRef.base64}`
      })
    }
    contentParts.push({ type: 'input_text', text: withSavedBoardRendererMemory(promptText, [selectedPiece]) })

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
  const s = String(outfitPhoto)
  // Preserve the relative path after /uploads/ so subdirectories like
  // generated-boards/ are not stripped (path.basename would lose them).
  const uploadsPrefix = '/uploads/'
  if (s.startsWith(uploadsPrefix)) {
    return path.join(userUploadsDir(), s.slice(uploadsPrefix.length))
  }
  // Legacy: bare filename or relative path — join directly.
  return path.join(userUploadsDir(), path.basename(s))
}

// Marker between the stylist-voice prose and the structured field dump in the
// feedback text. The client splits on this exact line to collapse the details.
export const CRITIQUE_DETAILS_DELIMITER = '--- Full structured read ---'

const OUTFIT_EVALUATION_RESULT_CACHE_TTL_MS = 10 * 60 * 1000
const OUTFIT_EVALUATION_RESULT_CACHE_MAX = 50
const OUTFIT_EVALUATION_CACHE_VERSION = 'critique-cost-v1'
const outfitEvaluationResultCache = new Map()
const outfitEvaluationInFlight = new Map()

function critiqueResultCacheEnabled() {
  return process.env.NODE_ENV !== 'test' || process.env.WARDROBE_TEST_EVALUATION_CACHE === 'true'
}

function cloneJsonValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function pruneOutfitEvaluationResultCache(now = Date.now()) {
  for (const [key, entry] of outfitEvaluationResultCache) {
    if (entry.expiresAt <= now) outfitEvaluationResultCache.delete(key)
  }
  while (outfitEvaluationResultCache.size > OUTFIT_EVALUATION_RESULT_CACHE_MAX) {
    const oldestKey = outfitEvaluationResultCache.keys().next().value
    outfitEvaluationResultCache.delete(oldestKey)
  }
}

function outfitEvaluationResultCacheKey({ system, messages, maxTokens, responseMode }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    version: OUTFIT_EVALUATION_CACHE_VERSION,
    provider: AI_PROVIDER,
    model: ACTIVE_STYLIST_MODEL,
    responseMode,
    maxTokens,
    system,
    messages,
  })).digest('hex')
}

function readOutfitEvaluationResultCache(key, now = Date.now()) {
  if (!critiqueResultCacheEnabled()) return null
  pruneOutfitEvaluationResultCache(now)
  const entry = outfitEvaluationResultCache.get(key)
  if (!entry) return null
  // Refresh insertion order so the bounded map behaves as a small LRU.
  outfitEvaluationResultCache.delete(key)
  outfitEvaluationResultCache.set(key, entry)
  const result = cloneJsonValue(entry.result)
  result.debug = {
    ...(result.debug || {}),
    providerCalls: 0,
    usage: null,
    estimatedCost: {
      estimatedUsd: 0,
      pricingAvailable: true,
      source: 'exact_result_cache',
    },
    resultCache: {
      hit: true,
      ageMs: Math.max(0, now - entry.createdAt),
      ttlMs: OUTFIT_EVALUATION_RESULT_CACHE_TTL_MS,
    },
  }
  return result
}

function writeOutfitEvaluationResultCache(key, result, now = Date.now()) {
  if (!critiqueResultCacheEnabled()) return
  outfitEvaluationResultCache.set(key, {
    createdAt: now,
    expiresAt: now + OUTFIT_EVALUATION_RESULT_CACHE_TTL_MS,
    result: cloneJsonValue(result),
  })
  pruneOutfitEvaluationResultCache(now)
}

export function clearOutfitEvaluationResultCache() {
  outfitEvaluationResultCache.clear()
  outfitEvaluationInFlight.clear()
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
  const userCritique = parsed?.userCritique && typeof parsed.userCritique === 'object'
    ? parsed.userCritique
    : {}
  const detailedCritique = Array.isArray(parsed?.detailedCritique)
    ? parsed.detailedCritique.map(paragraph => String(paragraph || '').trim()).filter(Boolean)
    : typeof parsed?.detailedCritique === 'string' && parsed.detailedCritique.trim()
      ? parsed.detailedCritique.split(/\n\s*\n/).map(paragraph => paragraph.trim()).filter(Boolean)
      : []
  const critiqueProse = typeof parsed?.critiqueProse === 'string' ? parsed.critiqueProse.trim() : ''
  const noChangeNeeded = /^no change needed\.?$/i.test(String(userCritique.action || recommendationBlock.smallestAdjustment || '').trim())
  const displayAnswer = noChangeNeeded && userCritique.answer ? 'Works' : userCritique.answer
  const userCritiqueText = [
    displayAnswer ? `**${String(displayAnswer).trim()}.**` : '',
    userCritique.reason ? String(userCritique.reason).trim() : '',
    userCritique.action
      ? (noChangeNeeded ? '**No change needed.**' : `**Try this:** ${String(userCritique.action).trim()}`)
      : '',
    userCritique.check && !noChangeNeeded ? `**Check:** ${String(userCritique.check).trim()}` : '',
    userCritique.occasionNote ? `**For this occasion:** ${String(userCritique.occasionNote).trim()}` : ''
  ].filter(Boolean).join('\n\n')
  const userFacingCritique = userCritiqueText || critiqueProse
  // Summary and verdict stay out of this block: when the user-facing critique
  // leads the feedback they sit right above the collapsed details, and the
  // model tends to write summary as a copy of that answer anyway.
  // The actionable answer (what to change first, and what to avoid/try next) leads this list,
  // ahead of the supporting diagnostic/score dump — someone who expands "Full structured read"
  // is looking for the specific fix, not a dozen analysis rows before reaching it. Matches the
  // "answer first" ordering fallbackFollowupFeedback below already uses.
  const structuredDetailParts = [
    nestedEvaluation.firstVisibleIssue ? `First visible issue: ${nestedEvaluation.firstVisibleIssue}` : '',
    (recommendationBlock.smallestAdjustment || typeof parsed.recommendation === 'string') ? `Next: ${recommendationBlock.smallestAdjustment || parsed.recommendation}` : '',
    recommendationBlock.avoidForNow ? `Avoid for now: ${recommendationBlock.avoidForNow}` : '',
    recommendationBlock.tryNext || parsed.tryNext ? `Try next: ${recommendationBlock.tryNext || parsed.tryNext}` : '',
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
    Array.isArray(parsed.works) && parsed.works.length ? `Works: ${parsed.works.join(' ')}` : '',
    Array.isArray(parsed.risks) && parsed.risks.length ? `Risks: ${parsed.risks.join(' ')}` : ''
  ].filter(Boolean)
  const structuredDetails = detailedCritique.length
    ? detailedCritique.join('\n\n')
    : structuredDetailParts.join('\n\n')
  const structuredRead = [
    nestedEvaluation.summary || parsed.summary || 'Evaluation complete.',
    verdict ? `Verdict: ${verdict}` : '',
    structuredDetails
  ].filter(Boolean).join('\n\n')
  const feedback = userFacingCritique
    ? [
        userFacingCritique,
        structuredDetails ? `${CRITIQUE_DETAILS_DELIMITER}\n\n${structuredDetails}` : ''
      ].filter(Boolean).join('\n\n')
    : structuredRead
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
      userCritique,
      detailedCritique,
      critiqueProse,
      saveableLearning: parsed.saveableLearning || ''
    }
  }
}

// One-shot entry (docs/deferred-conversational-cache-spec.md): 'full' and 'followup' use
// different system text, so a followup here never reads back a full turn's cache and vice versa —
// a 1h ephemeral write on either would never be reused. No PROMPT_CACHE_BREAKPOINT.
export function outfitEvaluationSystemPrompt(responseMode) {
  return responseMode === 'followup'
    ? prompts.OUTFIT_EVALUATION_FOLLOWUP_SYSTEM
    : prompts.WHOLE_WARDROBE_EVALUATOR_SYSTEM
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
  const outfitPhoto = outfit.photo || outfit.imageUrl || outfit.image_url || ''
  const generatedBoardEvidence = outfit.visualEvidenceType === 'generated_board'
  const savedPhotoPath = uploadedPhotoPath || uploadedOrSavedOutfitPhotoPath(outfitPhoto)
  if (generatedBoardEvidence && savedPhotoPath) {
    content.push({
      type: 'text',
      text: `IMAGE 1 — AI-GENERATED STYLING VISUALIZATION: ${outfit.label || outfit.title || outfit.name || 'current outfit'}. This is the composition being evaluated, not evidence of how the real garments fit or can be worn.`
    })
  }
  const outfitImageIncluded = await addEvaluationImage(content, savedPhotoPath)
  if (generatedBoardEvidence && savedPhotoPath && !outfitImageIncluded) content.pop()
  if (!outfitImageIncluded && pieces.length < 2 && !allowPhotoOnly) {
    const err = new Error('An outfit photo or at least two linked wardrobe pieces are required')
    err.statusCode = 400
    throw err
  }

  const imageRefs = await Promise.all(visuallyPrioritizedPieces(pieces, 5).map(async (piece) => {
    const photo = piece.worn_photo || piece.photo
    if (!photo) return null
    const filePath = path.join(userUploadsDir(), photo)
    if (!fs.existsSync(filePath)) return null
    const { base64, mime } = await prepareImageForClaude(filePath)
    return { piece, base64, mime }
  }))
  for (const [index, ref] of imageRefs.filter(Boolean).entries()) {
    if (generatedBoardEvidence) {
      content.push({
        type: 'text',
        text: `IMAGE ${index + 2} — LINKED GARMENT REFERENCE: ${ref.piece.name} (${ref.piece.category}). Use this image only to verify this garment's identity and construction.`
      })
    }
    content.push({ type: 'image', source: { type: 'base64', media_type: ref.mime, data: ref.base64 } })
  }
  const attachedImageInventory = [
    outfitImageIncluded
      ? `${generatedBoardEvidence ? 'AI-generated styling visualization' : 'actual worn outfit photo'}: ${outfit.label || outfit.title || outfit.name || 'current outfit'}`
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
    outfit.reason ? `Card rationale (non-authoritative styling intent only; ignore any construction, fit, placement, or wear claim that conflicts with linked garment truth or the current image): ${outfit.reason}` : '',
    outfit.watchFor ? `Current watch note: ${outfit.watchFor}` : '',
    outfit.formulaFamily ? `Formula family: ${outfit.formulaFamily}` : '',
    outfit.archetypeId ? `Archetype: ${outfit.archetypeId}` : '',
    outfit.notes ? `Saved outfit notes: ${outfit.notes}` : ''
  ].filter(Boolean).join('\n')

  const imageAuthorityText = outfitImageIncluded && pieces.length
    ? (generatedBoardEvidence
        ? 'The first image is an AI-generated styling visualization, not a worn outfit photo. Use it to evaluate the proposed composition and to identify rendering errors, but never treat its fit, placement, tuck, hem, or invented construction as proof about the real garments. Later linked garment references and structured garment truth are authoritative when the visualization conflicts with them.'
        : 'The first image is the actual worn outfit photo. Treat it as primary visual evidence for fit, scale, proportion, and whether the combination works. Later images are linked garment references that clarify the saved pieces.')
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
    pieceLines
      ? 'Authority rule: structured owned-garment truth and the current attached images outrank card titles, reasons, watch notes, prior critique prose, and other generated descriptions. Use card prose only to understand intended mood or occasion; never use it to redefine garment construction or how a garment can be worn.'
      : '',
    pieceLines
      ? 'Constraint-composition rule: before recommending any physical styling action that involves multiple garments, verify that every affected garment permits it. A capability on one garment cannot override a prohibition or construction constraint on another.'
      : '',
    generatedBoardEvidence && pieceLines
      ? 'Generated-board output validity check: before returning the critique, compare the proposed userCritique.action and recommendation.smallestAdjustment against every affected linked garment record. If either action conflicts with any construction or wear constraint, discard that action and choose a compatible action using the current pieces, or say no valid adjustment is available. A contradictory action makes the response invalid even if the prose acknowledges the constraint.'
      : '',
    linkedFitCautionsText
      ? `Linked fit/trust cautions. Treat these as authoritative and reconcile visible fit placement against them before judging whether a garment fits naturally:\n${linkedFitCautionsText}`
      : '',
    extraContextText,
    previousEvaluation
      ? `Previous structured critique memory. Use this for continuity, but correct it if the current image/garment truth contradicts it:\n${String(previousEvaluation).slice(0, 1600)}`
      : '',
    responseMode === 'followup'
      ? 'Response mode: followup. Answer the user directly in 2-5 concise sentences. You may use search_wardrobe when—and only when—the user’s meaning requires garments beyond the linked outfit, regardless of their exact wording. Search proactively when they ask for an owned alternative, replacement, or another wardrobe option; never claim the rest of the closet is unavailable. Use view_pieces or get_garment_details only when the search result needs visual or construction verification. If the question can be answered from the current outfit, do not call a tool. If the user asks what photos/images you can see, answer with the Current attached image inventory first and do not give styling advice unless the user also asks for it. If the user asks whether a garment can be tucked, altered, cuffed, belted, or otherwise worn differently, first check both the actual outfit photo and the linked garment truth for fabric, hem behavior, fit confidence, engine notes, and visible waist placement; if evidence is missing, say what is low-confidence instead of pretending. The current outfit image and linked garment records are the authority. If the user asks about sharpness, softness, proportion, or why an outfit is not working, lead with garment mechanics: hem length, waist transition, fit placement, silhouette continuity, and proportion behavior. Do not use jewelry/accessories as the first fix unless the garment mechanics are already working. Do not repeat the full critique, visible facts, scores, roles, or JSON sections in prose. If correcting an earlier read, say what changed and give one practical next step.'
      : 'Response mode: full critique.',
    '',
    wholeWardrobeFeedbackText ? `Whole-wardrobe feedback memory:\n${wholeWardrobeFeedbackText}` : '',
    globalSavedBoardText ? `Saved visual board memory:\n${globalSavedBoardText}` : '',
    calibrationMemoryText ? `Calibration memory:\n${calibrationMemoryText}` : '',
    '',
    'Return direct advice only. Do not create render directions or image-generation prompts.'
  ].filter(Boolean).join('\n') })

  const isFollowup = responseMode === 'followup'
  const system = outfitEvaluationSystemPrompt(responseMode)
  const maxTokens = isFollowup ? 500 : 3000
  const messages = [
    ...(history || []).map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content }
  ]
  const resultCacheKey = outfitEvaluationResultCacheKey({
    system,
    messages,
    maxTokens,
    responseMode,
  })
  const cachedResult = readOutfitEvaluationResultCache(resultCacheKey)
  if (cachedResult) {
    cachedResult.debug = {
      ...(cachedResult.debug || {}),
      timings: { totalMs: Date.now() - startedAt },
    }
    return cachedResult
  }

  const inFlight = outfitEvaluationInFlight.get(resultCacheKey)
  if (inFlight) {
    const sharedResult = cloneJsonValue(await inFlight)
    sharedResult.debug = {
      ...(sharedResult.debug || {}),
      timings: { totalMs: Date.now() - startedAt },
      providerCalls: 0,
      usage: null,
      estimatedCost: {
        estimatedUsd: 0,
        pricingAvailable: true,
        source: 'in_flight_coalescing',
      },
      resultCache: {
        hit: true,
        coalesced: true,
        ttlMs: OUTFIT_EVALUATION_RESULT_CACHE_TTL_MS,
      },
    }
    return sharedResult
  }

  const evaluationPromise = (async () => {
    let parsed
    let usage
    let providerCalls = 1
    if (isFollowup) {
      const toolContext = {
        allowedToolNames: ['search_wardrobe', 'view_pieces', 'get_garment_details'],
        maxProviderIterations: 3,
        skipFreeformOutputChecks: true,
        trackMockUsage: true,
        returnObjectAnswer: true,
        occasion,
        season,
        mood,
        question,
        request: question,
        retrievedPieceIds: new Set(pieces.map(piece => Number(piece.id)).filter(Boolean)),
        visuallySeenPieceIds: new Set(imageRefs.filter(Boolean).map(ref => Number(ref.piece.id)).filter(Boolean)),
      }
      const followupResult = await withTimeout(askStylistWithTools({
        system,
        maxTokens,
        messages,
        toolContext,
      }), 90000, 'Outfit critique follow-up')
      let followupAnswer = String(followupResult.answer || '').trim()
      if (followupAnswer.startsWith('{')) {
        try {
          const structuredAnswer = JSON.parse(followupAnswer)
          if (typeof structuredAnswer?.answer === 'string') followupAnswer = structuredAnswer.answer
        } catch {
          // The tool-capable provider normally follows the answer-only JSON contract, but a
          // plain-text answer is also safe to display. Leave malformed/non-JSON text untouched.
        }
      }
      parsed = { answer: followupAnswer }
      const diagnostics = toolContext.freeformDiagnostics || {}
      providerCalls = Math.max(1, Number(diagnostics.providerIterations) || 0)
      usage = {
        provider: AI_PROVIDER,
        model: ACTIVE_STYLIST_MODEL,
        inputTokens: Number(diagnostics.providerInputTokens) || 0,
        outputTokens: Number(diagnostics.providerOutputTokens) || 0,
        cacheReadInputTokens: Number(diagnostics.providerCacheReadInputTokens) || 0,
        cacheCreationInputTokens: Number(diagnostics.providerCacheCreationInputTokens) || 0,
      }
      usage.totalTokens = usage.inputTokens + usage.outputTokens +
        usage.cacheReadInputTokens + usage.cacheCreationInputTokens
    } else {
      // Sized from observed truncation: the full critique JSON reached ~7.9k
      // chars (~2000 tokens) before being cut off, so 1400 and even 2000
      // truncated real responses mid-string. 3000 leaves headroom.
      const evaluationResult = await withTimeout(askStylistWithUsage({
        system,
        maxTokens,
        messages,
      }), 90000, 'Whole-wardrobe outfit evaluator')
      usage = evaluationResult.usage
      parsed = parseModelJson(evaluationResult.text, { context: 'whole-wardrobe outfit evaluator', maxTokens, stopReason: usage?.stopReason })
    }
    const formatted = formatSharedOutfitEvaluation({ parsed, responseMode, question, attachedImageInventory })
    const result = {
      ...formatted,
      provider: AI_PROVIDER,
      model: ACTIVE_STYLIST_MODEL,
      mode: routeMode,
      pipeline: 'whole_wardrobe_outfit_evaluator',
      evidenceMode,
      debug: {
        timings: { totalMs: Date.now() - startedAt },
        providerCalls,
        usage,
        estimatedCost: estimateAiUsageCost(usage),
        resultCache: {
          hit: false,
          ttlMs: OUTFIT_EVALUATION_RESULT_CACHE_TTL_MS,
        },
        evidenceMode,
        linkedPieceCount: pieces.length,
        outfitImageIncluded,
        imageCount: imageRefs.filter(Boolean).length + (outfitImageIncluded ? 1 : 0)
      }
    }
    writeOutfitEvaluationResultCache(resultCacheKey, result)
    return result
  })()

  outfitEvaluationInFlight.set(resultCacheKey, evaluationPromise)
  try {
    return await evaluationPromise
  } finally {
    if (outfitEvaluationInFlight.get(resultCacheKey) === evaluationPromise) {
      outfitEvaluationInFlight.delete(resultCacheKey)
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
  const colorFamilies = [
    ['black', 'black', 'charcoal', 'dark grey', 'dark gray'],
    ['charcoal', 'black', 'charcoal', 'dark grey', 'dark gray'],
    ['brown', 'brown', 'chocolate', 'espresso', 'cognac', 'tobacco'],
    ['camel', 'camel', 'tan', 'caramel', 'tobacco'],
    ['cream', 'cream', 'ivory', 'white', 'oatmeal', 'beige'],
    ['navy', 'navy', 'indigo', 'blue'],
    ['olive', 'olive', 'green', 'khaki'],
  ]
  const categoryFamilies = [
    ['trouser', 'trouser', 'trousers', 'pant', 'pants', 'jean', 'jeans', 'denim', 'barrel', 'utility', 'cargo', 'fatigue'],
    ['skirt', 'skirt', 'midi', 'pencil', 'column'],
    ['shoe', 'shoe', 'shoes', 'loafer', 'flat', 'sandal', 'sneaker', 'boot', 'mule', 'heel'],
    ['bag', 'bag', 'tote', 'purse', 'satchel'],
    ['jacket', 'jacket', 'blazer', 'cardigan', 'coat', 'vest', 'outerwear'],
    ['top', 'top', 'shirt', 'blouse', 'tee', 'tank', 'shell', 'sweater', 'knit'],
  ]
  const matchingFamilies = (text, families) => families
    .filter(([, ...words]) => words.some(word => new RegExp(`\\b${word}\\b`).test(text)))
    .map(([label]) => label)
  const archetypeColors = matchingFamilies(a, colorFamilies)
  const archetypeCategories = matchingFamilies(a, categoryFamilies)
  const wantsDenim = /\b(denim|jean|jeans)\b/.test(a)
  const wantsOliveUtility = /\bolive\b/.test(a) && /\b(utility|cargo|barrel|fatigue|workwear)\b/.test(a)
  const wantsCreamTrouser = /\b(cream|ivory|white|oatmeal|beige)\b/.test(a) && /\b(trouser|pant|pants|jean|jeans)\b/.test(a)
  const wantsNavyTrouser = /\b(navy|indigo|blue)\b/.test(a) && /\b(trouser|pant|pants|jean|jeans|denim)\b/.test(a)

  for (const p of ownedPieces || []) {
    const n = normalizeForMatch(`${p.name || ''} ${p.category || ''} ${p.colors || ''} ${p.notes || ''}`)
    if (!n) continue
    const ownedColors = matchingFamilies(n, colorFamilies)
    const ownedCategories = matchingFamilies(n, categoryFamilies)
    if (a && n.includes(a)) return true
    if (
      archetypeColors.some(color => ownedColors.includes(color)) &&
      archetypeCategories.some(category => ownedCategories.includes(category))
    ) return true
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

export function makeDistinctNewPieceArchetype(original = '', selectedPiece = {}, used = new Set(), ownedPieces = []) {
  const pool = idealAdditionSupportPool(selectedPiece)

  const o = normalizeArchetypeText(original)
  let candidate = pool.find(x => {
    const key = normalizeArchetypeText(x)
    return !used.has(key) && key !== o && !ownedLooksSimilarToArchetype(x, ownedPieces)
  })
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
        next = makeDistinctNewPieceArchetype(next, selectedPiece, usedMissing, ownedPieces)
      } else {
        usedMissing.add(key)
      }
      return next
    }).filter(Boolean)

    while (copy.missingPieces.length < 2) {
      copy.missingPieces.push(makeDistinctNewPieceArchetype('', selectedPiece, usedMissing, ownedPieces))
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

// A structural column the tagger populated, or '' when it is absent or set to
// the not-applicable sentinel. `readable` turns `hangs_straight` into
// `hangs straight` so a clause reads as English rather than as a column dump.
function anchorColumn(piece, field) {
  const value = String(piece?.[field] ?? '').trim().toLowerCase()
  return STRUCTURAL_FIELD_UNSET.has(value) ? '' : value
}
const readable = value => value.replace(/[-_]+/g, ' ')

// Every clause here used to be derived from `name + notes` regexes. That meant
// `length_hits_at` — populated on 207 of 236 pieces — produced no length
// instruction at all, because the builder had no length clause and the column
// was never read. Meanwhile the renderer memory appended to this same prompt is
// full of "prior render had this rendered too long" corrections: the wardrobe
// knew the length, the prompt never stated it, and the correction arrived
// afterwards as feedback. Columns are now the primary source; the old regexes
// survive only as the fallback for pieces that carry no structured value, so
// nothing that produced a clause before stops producing one.
export function anchorFidelityInstructions(selectedPiece = {}) {
  const name = String(selectedPiece.name || '').toLowerCase()
  const category = String(selectedPiece.category || '').toLowerCase()
  const notes = String(selectedPiece.notes || '').toLowerCase()
  const described = `${name} ${notes}`
  const parts = []

  if (category.includes('top') || /top|shell|tank|tee|shirt|blouse|sweater|cardigan|tunic/.test(name)) {
    parts.push('Anchor is an upper-body garment: preserve its neckline, shoulder width, sleeve length, hem length, and looseness/fittedness.')
  }
  if (category.includes('bottom') || /pant|jean|trouser|skirt|short/.test(name)) {
    parts.push('Anchor is a lower-body garment: preserve the rise, leg/hem width, length, drape, and visible volume. Do not turn wide pants into slim pants or cropped pants into long pants.')
  }

  const length = anchorColumn(selectedPiece, 'length_hits_at')
  if (length) {
    parts.push(`Anchor length: this garment hits at ${readable(length)} — render it at exactly that length. Wrong length is the most common failure on this path; do not lengthen or shorten the anchor to suit the composition.`)
  }

  const sleeveLength = anchorColumn(selectedPiece, 'sleeve_length')
  const sleeveShape = anchorColumn(selectedPiece, 'sleeve_shape')
  if (sleeveLength === 'sleeveless') {
    parts.push('Keep the anchor sleeveless; do not add sleeves.')
  } else if (sleeveLength || sleeveShape) {
    const sleeveDesc = [sleeveLength, sleeveShape !== 'other' && sleeveShape !== 'unknown' ? sleeveShape : '']
      .filter(Boolean).map(readable).join(' ')
    parts.push(`Anchor sleeve: ${sleeveDesc} — preserve that exact sleeve length and volume; do not lengthen, shorten, or slim it, and do not cover it with a layer that would crush it.`)
  } else {
    if (/sleeveless|tank|shell/.test(described)) parts.push('Keep the anchor sleeveless; do not add sleeves.')
    if (/short sleeve|short-sleeve/.test(described)) parts.push('Keep the anchor short-sleeved; do not make it long-sleeved.')
    if (/long sleeve|long-sleeve/.test(described)) parts.push('Keep the anchor long-sleeved; do not shorten the sleeves.')
  }

  const patternType = anchorColumn(selectedPiece, 'pattern_type')
  const patternScale = anchorColumn(selectedPiece, 'pattern_scale')
  if (patternType && patternType !== 'solid') {
    const scale = patternScale ? ` at ${readable(patternScale)} scale` : ''
    parts.push(`Anchor pattern: ${readable(patternType)}${scale} — reproduce that motif, its scale, and its color relationship; do not substitute a different print or invent a different scale.`)
    if (patternType === 'stripe') parts.push('Preserve stripe direction and stripe spacing.')
  } else if (!patternType && /stripe|striped/.test(described)) {
    parts.push('Preserve stripe direction, stripe spacing, and color relationship; do not invent a different stripe scale.')
  }

  const fabric = anchorColumn(selectedPiece, 'fabric_category')
  const fabricWeight = anchorColumn(selectedPiece, 'fabric_weight')
  if (fabric) {
    parts.push(`Anchor fabric: ${readable(fabric)}${fabricWeight ? `, ${readable(fabricWeight)} weight` : ''} — preserve that texture and how it hangs.`)
  } else if (/lace|crochet|gauze|linen|corduroy|cashmere|wool|silk|satin|denim/.test(described)) {
    parts.push('Preserve the apparent fabric character and texture weight of the anchor garment.')
  }

  const silhouette = anchorColumn(selectedPiece, 'silhouette')
  const fitOnBody = anchorColumn(selectedPiece, 'fit_on_body')
  if (silhouette) parts.push(`Anchor silhouette: ${readable(silhouette)} — keep that volume; do not tighten or loosen it.`)
  if (fitOnBody) parts.push(`Anchor fit: it ${readable(fitOnBody)} on the body — keep that relationship to the body.`)
  if (!silhouette && !fitOnBody) {
    if (/boxy|relaxed|loose|oversized/.test(described)) parts.push('Keep the anchor relaxed/boxy if described that way; do not make it clingy or tucked tight.')
    if (/fitted|slim|compact/.test(described)) parts.push('Keep the anchor fitted/compact if described that way; do not make it oversized.')
  }

  const hem = anchorColumn(selectedPiece, 'hem_finish')
  if (hem && hem !== 'straight_loose') parts.push(`Anchor hem finish: ${readable(hem)} — keep it.`)

  return parts.join(' ')
}

export function editorialImagePrompt({ selectedPiece, direction, occasion, season, supportingPieces = [] }) {
  const missing = Array.isArray(direction.missingPieces)
    ? direction.missingPieces.join(', ')
    : ''
  // Real saved pieces this direction uses besides the anchor (pants, shoes, etc.) — distinct from
  // `missing`/direction.missingPieces above, which are genuinely invented "ideal addition"
  // archetypes with no real garment to preserve. Before this, a direction built from owned pieces
  // had NOTHING describing its non-anchor garments — no photo, no text — and the model routinely
  // invented wrong pants/shoes details (thread_1787813410728). Reuses the same checklists
  // wholeWardrobeImagePrompt already proved for this; the reference photos themselves are supplied
  // separately via createEditorialConceptImage → runGPT4oImageGeneration's supportingGarmentImages.
  const supportingFidelity = supportingPieces.length ? pieceFidelityChecklist(supportingPieces) : ''
  const supportingConstruction = supportingPieces.length ? pieceConstructionChecklist(supportingPieces) : ''
  // How the garments relate to each other when it isn't obvious from the pieces alone — layering
  // order, where a belt/tie lands and which layer it cinches, tuck/drape behavior between two named
  // garments. Both selected-piece composer prompts (outfitComposerTemplate,
  // wholeWardrobeVisualComposerTemplate) already generate and document this as "the ONLY field the
  // image renderer treats as authoritative for how pieces relate to each other" — it survives
  // normalizeGeneratedOutfitObject onto the outfit card, but this renderer never read it, same class
  // of gap as the missing supporting-garment photos above. wholeWardrobeImagePrompt already treats
  // it as authoritative for its own callers; this must not be a second, weaker restatement.
  const stylingInstructions = String(direction.stylingInstructions || direction.styling_instructions || '').trim()
  // Built from the same truth text the whole-wardrobe image path uses. The old
  // hand-picked list carried name/category/colors/notes only — no length,
  // sleeve, silhouette, hem or fabric — and its `fabric` line read
  // `selectedPiece.fabric`, a column that does not exist (the real ones are
  // fabric_category / fabric_weight / fiber_content), so it never rendered at
  // all. Two prompts describing the same wardrobe should describe it the same way.
  // buildPieceText already leads with `• name (category | …)`, so it carries the
  // name and category the old list stated by hand.
  const pieceDesc = buildPieceText(selectedPiece) ||
    [selectedPiece.name, selectedPiece.category].filter(Boolean).join('; ')
  const anchorRules = anchorFidelityInstructions(selectedPiece)
  const selectedGroup = wardrobeCategoryGroup(selectedPiece)
  const silhouetteRule = selectedGroup === 'bottom' || selectedGroup === 'dress'
    ? 'Silhouette: respect the anchor garment actual hem length and lower-body shape. If the anchor is a knee skirt, midi skirt, cropped pant, or dress, keep that exact length; do not force a full-length lower half.'
    : 'Silhouette: fitted or structured upper half + full-length bottom (wide-leg, straight-leg, flowing maxi/midi). The lower half is usually full-length unless a specific suggested piece says otherwise.'
 
  return [
    EDITORIAL_IMAGE_BASE_PROMPT,
 
    prompts.EDITORIAL_IMAGE_SUBJECT_PROMPT,
 
    `Style Constitution:
${prompts.BODY_CONTRACT}
${prompts.PROVEN_FORMULAS}
${prompts.AESTHETIC_GRAVITY}
${prompts.LANE_NEUTRALITY}
${EXPRESSIVE_HIERARCHY_RULES}`,
 
    silhouetteRule,
 
    prompts.EDITORIAL_IMAGE_SHOES_RULE,
 
    EDITORIAL_IMAGE_REALISM_RULE,
 
    `ANCHOR GARMENT — preserve exactly: ${pieceDesc}.`,
    anchorRules ? `Anchor fidelity: ${anchorRules}` : '',
    'The anchor garment must remain visually recognizable — same category, neckline, sleeve length, print scale, color, fit, and hem length. Do not redesign it or substitute a different garment.',
    '',
    supportingFidelity
      ? `SUPPORTING WARDROBE GARMENTS — real saved pieces worn together with the anchor in this outfit, each with its own reference photo(s) below. Preserve each one; do not invent a substitute or a generic version:\n${supportingFidelity}`
      : '',
    supportingConstruction
      ? `Supporting garment construction (authoritative for fit/length/sleeve/hem — overrides the stylist logic prose below wherever they conflict):\n${supportingConstruction}`
      : '',
    stylingInstructions
      ? `Authoritative styling instructions (how these garments relate to each other — follow exactly): ${stylingInstructions}`
      : '',
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

export async function runGPT4oImageGeneration({ client, prompt, size = '1024x1536', referenceImages = [], anchorGarmentImage = null, supportingGarmentImages = [] }) {
  const contentParts = []

  const anchorPhotos = Array.isArray(anchorGarmentImage)
    ? anchorGarmentImage
    : anchorGarmentImage ? [anchorGarmentImage] : []

  // Calibration goes before the anchor garment photos, not after: an anchor garment can include a
  // worn photo that also shows her, and establishing the real identity anchor first — before any
  // competing photo of her arrives — is the point, not just what the caption says.
  for (const img of referenceImages.slice(0, 3)) {
    contentParts.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.base64}` })
    const captionParts = [
      img.kind === 'real_photo'
        ? (img.favorite
          ? 'Real photo — the only authoritative source for her visual identity, proportion, and presence. Use it strongly. An anchor garment photo below may also show a person wearing that garment; that is garment fit reference only, never an identity reference.'
          : 'Real outfit photo — the only authoritative identity reference. An anchor garment photo below may also show a person wearing that garment; that is garment fit reference only, never an identity reference.')
        : (img.favorite ? 'Good style reference — use strongly for aesthetic direction' : 'Good style reference'),
      img.labels?.length ? `[${img.labels.join(', ')}]` : '',
      img.notes ? img.notes : '',
    ].filter(Boolean)
    if (captionParts.length) {
      contentParts.push({ type: 'input_text', text: captionParts.join(' — ') })
    }
  }

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

  // Real saved pieces this direction uses besides the anchor (pants, shoes, etc.) — without these,
  // the model had nothing but a stylist-logic paragraph to go on for every non-anchor garment and
  // routinely invented wrong pants/shoes details (thread_1787813410728). One notch below the
  // anchor's stricter "do not redesign" language since these are secondary to the anchor, not the
  // premise, but still real garments that must not be substituted.
  if (supportingGarmentImages.length > 0) {
    contentParts.push({
      type: 'input_text',
      text: 'SUPPORTING WARDROBE GARMENTS — the following photos show other real saved pieces that must also appear in the generated image, worn together with the anchor garment. Preserve each one\'s category, color, print/pattern, construction, and silhouette as shown. Do not invent a substitute or a generic version of any of these.'
    })
    for (const photo of supportingGarmentImages) {
      contentParts.push({ type: 'input_image', image_url: `data:${photo.mime};base64,${photo.base64}` })
      if (photo.label) {
        contentParts.push({ type: 'input_text', text: photo.label })
      }
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
  // Real saved pieces this direction uses besides the anchor — resolved fresh from the DB (not the
  // client-supplied direction.pieces, which may be a lightweight/stale copy) so the reference photos
  // below and the fidelity text in editorialImagePrompt come from the same authoritative source.
  // Without this, a direction styled entirely from owned wardrobe pieces (as opposed to a genuine
  // "ideal missing piece" concept) had nothing describing its non-anchor garments at all, and the
  // model routinely invented wrong pants/shoes details (thread_1787813410728).
  const supportingPieceIds = [...new Set((Array.isArray(direction.pieceIds) ? direction.pieceIds : [])
    .map(Number)
    .filter(id => Number.isFinite(id) && id !== Number(selectedPiece?.id)))]
  const supportingPieces = supportingPieceIds.length
    ? db.prepare(`SELECT * FROM pieces WHERE id IN (${supportingPieceIds.map(() => '?').join(',')})`).all(...supportingPieceIds).map(parsePiece)
    : []
  const prompt = withSavedBoardRendererMemory(
    editorialImagePrompt({ selectedPiece, direction, occasion, season, supportingPieces }),
    [selectedPiece, ...supportingPieces]
  )
  const filename = `generated-boards/editorial-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(userUploadsDir(), filename)
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
 
  if (!hasOpenAiKey()) {
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
      const filePath = path.join(userUploadsDir(), selectedPiece.worn_photo)
      if (fs.existsSync(filePath)) {
        // Same reasoning as garmentReferencePlan's WORN_REFERENCE_MAX_PX: geometry survives the
        // downscale, facial detail does not, and that asymmetry is the whole point.
        const buffer = await sharp(filePath)
          .resize(WORN_REFERENCE_MAX_PX, WORN_REFERENCE_MAX_PX, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer()
        anchorParts.push({
          base64: buffer.toString('base64'),
          mime: 'image/jpeg',
          label: `${selectedPiece.name} — worn photo, intentionally low resolution: read it only for drape, fit, and neckline on a body. Do not use this photo's face, hair, expression, or body proportions as an identity or likeness reference — use only the dedicated identity/proportion calibration photos for that.`,
        })
      }
    }
 
    if (selectedPiece.photo) {
      const filePath = path.join(userUploadsDir(), selectedPiece.photo)
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

  let supportingGarmentImages = []
  if (supportingPieces.length) {
    try {
      supportingGarmentImages = (await Promise.all(supportingPieces.map(piece => garmentReferenceImages(piece)))).flat()
    } catch (err) {
      console.warn('Could not load supporting garment photos:', err.message)
    }
  }

  try {
    const client = new OpenAI({ apiKey: resolveOpenAiKey() })
    const referenceImages = await getCalibrationReferenceImagesForGeneration(3)
    const { result: base64Result, usage } = await runGPT4oImageGeneration({
      client,
      prompt,
      size: getOpenAIImageSize('generate'),
      referenceImages,
      anchorGarmentImage,
      supportingGarmentImages,
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
    const client = new OpenAI({ apiKey: resolveOpenAiKey() })
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

export function imageUrlToUploadPath(imageUrl) {
  const value = String(imageUrl || '')
  const filename = value.startsWith('/uploads/') ? value.replace('/uploads/', '') : path.basename(value)
  if (!filename || filename.includes('..')) return null
  const filePath = path.join(userUploadsDir(), filename)
  return fs.existsSync(filePath) ? filePath : null
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
      // "exactly one" and the placeholder-list prohibition are the pre-dedup contract, restored
      // verbatim: slice 7 consolidated the mode reminders to remove repetition, not to relax what
      // they required, and neither clause survives anywhere else in the prompt.
      return 'The user has a new request. Answer them directly and naturally. If required context is missing, ask exactly one clear clarifying question; do not generate a placeholder list.'
  }
}

// docs/freeform-prompt-cache-levers.md lever 1. This block is BELOW the prompt cache breakpoint, so
// it may vary per turn at no cost to reuse. That is exactly why per-turn mode behaviour lives here
// and not in a tool description: tool schemas sit above the breakpoint, where one varying byte
// invalidates the whole cached prefix.
export function freeformToolRoutingInstruction(turnMode = '') {
  const ownerLine = 'TOOL ROUTING OWNERSHIP: each tool description owns its eligibility, required arguments, and mechanical output contract. Follow declare_intent, suggest_slot_swaps, render_preview, generate_outfits, and plan_outfit_set as written instead of restating their schemas here.'
  if (String(turnMode || '') !== 'new_request') return ownerLine
  // Stated in full here, because the tool descriptions no longer carry it. A fresh request is the
  // only turn shape the bounded exception applies to, which is why it is emitted only for one mode.
  return `${ownerLine}
BOUNDED MULTI-LOOK EXCEPTION (this turn only): for a fresh request for 2–5 outfit options that share one occasion, activity, location, date and weather context, do NOT call declare_intent and do NOT call search_wardrobe — call generate_outfits directly and exactly once. That call is itself the cards declaration. An ordinary new "what should I wear?" defaults to limit:2; an explicit count 2–5 wins.
One/best/pick-one requests stay on the verified search + propose path; multi-context schedules and capsules use plan_outfit_set; existing-card revisions use suggest_slot_swaps. Never flatten distinct contexts to qualify.`
}

export const STYLIST_CONVERSATION_MODES = new Set([
  'new_request',
  'followup',
  'correction',
  'explanation',
  'preference_reaction',
])

function shouldAttachGeneratedOutfitReferenceSheet(question = '', conversationMode = 'new_request') {
  const q = String(question || '').toLowerCase()
  if (conversationMode === 'new_request') return true
  return /\b(show|render|visual|visualize|image|photo|picture|see|look|color|colour|texture|pattern|hem|shoe|shoes|skirt|pants|top|dress|cardigan|layer)\b/.test(q) // ratchet-allow: user intent routing for whether to attach generated-card reference images
}

function isGeneratedSetCoverageAudit(question = '') {
  const q = String(question || '').toLowerCase()
  return /\b(coverage|cover|enough|same outfit|only one|backup|laundry|repeat|re-wear|rewear|additional|another|more options?)\b/.test(q) // ratchet-allow: user intent routing for multi-outfit coverage audits
}

// Historical outfit-set addressability (docs: current_outfit_set stays the default referent;
// earlier sets and their critiques are historical and surface only on an explicit backward
// reference — see the spec discussed against thread_1787435527800). Ordinal/positional ("the first
// set"), temporal ("earlier", "before", "originally"), and direct-recall ("what was wrong with",
// "go back to") phrasing. Deliberately narrow: an unrelated correction or a fresh request must not
// trip this and pull old, superseded critique into a turn that never asked for it.
const BACKWARD_OUTFIT_REFERENCE_RE = /\b(earlier|previous(?:ly)?|first|original(?:ly)?|older?|prior|before|last time|go back to|what (?:was|were) wrong with|the (?:other|last) (?:set|option|round))\b/i
export function isBackwardOutfitSetReference(question = '') {
  return BACKWARD_OUTFIT_REFERENCE_RE.test(String(question || ''))
}

// Every assistant turn that returned outfit cards is one "set." The current_outfit_set already
// tracks the latest one (see currentOutfitSet below), so everything earlier is historical by
// definition — excludeLatest drops the most recent card-bearing turn so callers never double up.
// A turn that only edits an existing set (adds a layer, swaps one piece) still gets its own entry
// here; we don't try to detect "same set, revised" because the label/reason text a backward
// reference actually needs is already carried per-turn, and merging risks conflating two distinct
// critiques into one.
export function extractHistoricalOutfitSets(threadMessages = [], { excludeLatest = true } = {}) {
  const cardTurns = (Array.isArray(threadMessages) ? threadMessages : [])
    .filter(message => message?.role === 'assistant' && Array.isArray(message.structuredOutfits) && message.structuredOutfits.length)
  const historical = excludeLatest ? cardTurns.slice(0, -1) : cardTurns
  return historical.map((message, index) => ({
    setIndex: index,
    introText: String(message.text || '').trim(),
    outfits: message.structuredOutfits.map(outfit => {
      const pieceIds = (Array.isArray(outfit?.pieceIds) && outfit.pieceIds.length
        ? outfit.pieceIds
        : (Array.isArray(outfit?.pieces) ? outfit.pieces.map(piece => piece?.id) : [])
      ).map(Number).filter(Boolean)
      return {
        label: outfit?.label || outfit?.title || '',
        strength: outfit?.strength || '',
        reason: outfit?.reason || '',
        watchFor: outfit?.watchFor || '',
        bestFor: outfit?.bestFor || '',
        pieceIds,
        pieceNames: (Array.isArray(outfit?.pieces) ? outfit.pieces.map(piece => piece?.name).filter(Boolean) : [])
      }
    })
  }))
}

// A garment named in the question that is not part of current_outfit_set but names exactly one
// historical set resolves that set deterministically — "go back to the outfit with the olive cargo
// shorts." Appearing in two or more historical sets must not be silently resolved to either one
// (spec rule: ambiguous garment references stay ambiguous); the caller surfaces that instead of
// guessing which set the user means.
export function resolveHistoricalReferenceByGarment(question = '', historicalSets = [], currentPieceIds = []) {
  const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const questionNorm = normalize(question)
  const questionWords = new Set(questionNorm.split(' ').filter(Boolean))
  const currentSet = new Set((Array.isArray(currentPieceIds) ? currentPieceIds : []).map(Number))
  const matchingSetIndexes = new Set()
  let matchedPieceName = ''
  ;(Array.isArray(historicalSets) ? historicalSets : []).forEach((set, setIndex) => {
    (set.outfits || []).forEach(outfit => {
      (outfit.pieceNames || []).forEach((name, pieceIndex) => {
        // "olive cargo shorts" for a piece actually named "olive cargo drawstring shorts" — same
        // prose-abbreviation gap as recentReferentPieceIds in routes/ai.js: require at least 2
        // words match and at most 1 be missing, not an exact full-name substring.
        const nameWords = normalize(name).split(' ').filter(Boolean)
        const matchedCount = nameWords.filter(word => questionWords.has(word)).length
        if (matchedCount < 2 || nameWords.length - matchedCount > 1) return
        const pieceId = outfit.pieceIds?.[pieceIndex]
        if (pieceId && currentSet.has(pieceId)) return // already in the current set, not a backward reference
        matchingSetIndexes.add(setIndex)
        matchedPieceName = name
      })
    })
  })
  if (!matchedPieceName) return { kind: 'none' }
  if (matchingSetIndexes.size > 1) return { kind: 'ambiguous', pieceName: matchedPieceName, setCount: matchingSetIndexes.size }
  const [onlyIndex] = matchingSetIndexes
  return { kind: 'resolved', pieceName: matchedPieceName, set: historicalSets[onlyIndex] }
}

// Top-level resolver: garment-named references resolve or flag ambiguous deterministically; a
// keyword-only reference ("what was wrong with the earlier set?") hands the model bounded candidate
// sets and lets it match the ordinal/location language itself, which is what a language model is
// for — hand-rolling "first" vs "second" vs "the Walnut Creek one" parsing here would just be a
// worse copy of what the full stylist already does with real conversational text. 'none' means no
// backward reference was detected at all, so the caller injects nothing extra this turn.
export function resolveHistoricalOutfitContext(question = '', historicalSets = [], currentPieceIds = []) {
  const garmentResult = resolveHistoricalReferenceByGarment(question, historicalSets, currentPieceIds)
  if (garmentResult.kind === 'resolved') return { kind: 'garment', sets: [garmentResult.set], pieceName: garmentResult.pieceName }
  if (garmentResult.kind === 'ambiguous') return { kind: 'ambiguous', pieceName: garmentResult.pieceName, setCount: garmentResult.setCount }
  if (isBackwardOutfitSetReference(question) && historicalSets.length) {
    return { kind: 'keyword', sets: historicalSets.slice(-4) }
  }
  return { kind: 'none' }
}

export function formatHistoricalOutfitSetsForPrompt(resolution) {
  if (!resolution || resolution.kind === 'none') return ''
  if (resolution.kind === 'ambiguous') {
    return `AMBIGUOUS HISTORICAL REFERENCE: "${resolution.pieceName}" appears in ${resolution.setCount} different earlier outfit sets in this thread. Do not silently pick one — ask the user which set they mean before answering.`
  }
  const body = (resolution.sets || []).map((set, index) => {
    const outfitLines = (set.outfits || []).map(outfit => [
      `- ${outfit.label || 'Outfit'}${outfit.strength ? ` (${outfit.strength})` : ''}`,
      outfit.bestFor ? `  Best for: ${outfit.bestFor}` : '',
      outfit.reason ? `  Reason: ${outfit.reason}` : '',
      outfit.watchFor ? `  Watch: ${outfit.watchFor}` : ''
    ].filter(Boolean).join('\n')).join('\n')
    return [`Historical set ${index + 1}${set.introText ? `: ${set.introText}` : ''}`, outfitLines].filter(Boolean).join('\n')
  }).join('\n\n')
  return [
    'HISTORICAL OUTFIT SETS (superseded — for this backward reference ONLY, this is NOT current_outfit_set):',
    body,
    'These are earlier, replaced outfit sets, shown because the user explicitly referred back to one. Any critique or judgment recorded here belongs to that earlier set alone and must NOT be applied to current_outfit_set unless the user restates or repeats it about the current set now.'
  ].join('\n\n')
}

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
    uploadedPhoto,
    sessionId = 'default',
    activeContext,
    occasion,
    season,
    weather,
    mood,
    mission,
    activity
  } = body

  let activeOutfit = outfit
  let activePieceIds = pieceIds
  let resolvedActiveOutfitPieceIds = []

  // Structured thread state: on follow-up turns, restore established context and
  // the current outfit set from the server-side session state so the thread
  // survives the client omitting fields. Body values always win; state fills gaps.
  let restoredState = {}
  if (requestedConversationMode !== 'new_request') {
    restoredState = getStylistConversationState(sessionId) || {}
    if (!activeOutfit && restoredState.active_outfit) {
      activeOutfit = restoredState.active_outfit
      activePieceIds = restoredState.active_piece_ids
    }
  }
  const restoredEstablished = restoredState.established && typeof restoredState.established === 'object'
    ? restoredState.established
    : {}
  const restoredWeatherProfile = requestedConversationMode !== 'new_request'
    ? restoreWeatherProfile(restoredState.weather_profile)
    : null
  const effectiveOccasion = occasion || restoredEstablished.occasion || ''
  const effectiveActivity = activity || restoredEstablished.activity || ''
  const effectiveSeason = season || restoredEstablished.season || ''
  const effectiveMood = mood || restoredEstablished.mood || ''
  const effectiveMission = mission || restoredEstablished.mission || ''
  const effectiveLocation = body.location || restoredEstablished.location || ''

  const generatedOutfitContextText = String(generatedContext || '').trim()
  const threadContextText = String(threadContext || '').trim()
  // Weather precedence: explicit body value, then this turn's text, then the
  // established value from thread state, then (last resort) a coarse guess from
  // season/mood words — so a restored "hot, highs 85F" beats a "warm"-season guess.
  const explicitTurnWeather = weather || extractWeatherContext(question || '')
  const contextualTurnWeather = extractWeatherContext([
    threadContextText,
    generatedOutfitContextText
  ].join('\n'))
  const turnWeather = explicitTurnWeather || contextualTurnWeather
  // A new explicit weather statement owns this turn. Otherwise retain resolved numeric physics
  // separately from display season text so "summer; mild; 78/56" cannot be reparsed as hot.
  const effectiveWeatherProfile = explicitTurnWeather ? null : restoredWeatherProfile
  const extractedWeather = turnWeather
    || restoredEstablished.weather
    || extractWeatherContext([effectiveSeason, effectiveMood].join('\n'))
    || ''
  const travelOrPackingRequest = isTravelOrPackingRequest(question, effectiveOccasion)
  const canResolveTravelWeatherLive = travelRequestCanResolveWeatherLive(question, effectiveOccasion)
  const missingTravelWeather = travelOrPackingRequest && !extractedWeather && !canResolveTravelWeatherLive
  const establishedStylingContext = {
    ...(effectiveOccasion ? { occasion: effectiveOccasion } : {}),
    ...(effectiveActivity ? { activity: effectiveActivity } : {}),
    ...(extractedWeather ? { weather: extractedWeather } : {}),
    ...(canResolveTravelWeatherLive ? { weather_resolution: 'resolve live from named destination' } : {}),
    ...(effectiveSeason ? { season: effectiveSeason } : {}),
    ...(effectiveMood ? { mood: effectiveMood } : {}),
    ...(effectiveMission ? { mission: effectiveMission } : {}),
    ...(effectiveLocation ? { location: effectiveLocation } : {}),
  }
  const establishedStylingContextText = Object.keys(establishedStylingContext).length
    ? 'established styling context present'
    : ''

  const now = currentDate ? new Date(currentDate) : new Date()
  const effectiveCalendarSeason = resolveCalendarSeason(effectiveSeason, now)
  const feedbackApplicabilityContext = projectStylingApplicabilityContext({
    occasion: effectiveOccasion,
    activity: effectiveActivity,
    season: effectiveSeason,
    calendarSeason: effectiveCalendarSeason,
    date: now,
    weatherProfile: effectiveWeatherProfile || {},
    statedWeather: extractedWeather,
    requestText: [question, effectiveOccasion, effectiveActivity].filter(Boolean).join(' '),
  }, {
    weatherText: String(extractedWeather || ''),
  })
  const resolvedCurrentDateLabel = currentDateLabel || new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: timezone || 'America/Los_Angeles',
  }).format(now)

  let outfitImageContent = null
  let attachedImageInventory = []
  let extraContextText = ''

  if (activeOutfit) {
    const { pieces: outfitPieces } = resolveOutfitEvaluationPieces({ outfit: activeOutfit, pieceIds: activePieceIds })
    resolvedActiveOutfitPieceIds = outfitPieces.map(piece => Number(piece?.id)).filter(Boolean)
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
        const filePath = path.join(userUploadsDir(), photo)
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
  } else {
    // An outfit photo uploaded via /outfit-feedback has no linked pieces and no activeOutfit —
    // it survives in `messages[].uploadedPhoto` client-side (see message-lifecycle.md's
    // "attached photo permanently changes the feature" discontinuity) but every follow-up in the
    // thread used to be blind to it. The client resends the thread's most recent upload filename;
    // reattach it here the same way an active outfit's photo attaches, at the volatile tail.
    const uploadedPhotoName = String(uploadedPhoto || '').trim()
    if (uploadedPhotoName) {
      const uploadedPhotoFilePath = path.join(userUploadsDir(), path.basename(uploadedPhotoName))
      const contentImages = []
      const uploadedPhotoIncluded = await addEvaluationImage(contentImages, uploadedPhotoFilePath)
      if (uploadedPhotoIncluded) {
        outfitImageContent = contentImages
        attachedImageInventory.push('uploaded outfit photo from earlier in this thread')
        extraContextText = 'An outfit photo was uploaded earlier in this thread and is attached again for this turn. It has no linked wardrobe pieces — do not assume any visible garment is already owned. If the user asks whether they own something like it, use search_wardrobe rather than guessing from the image.'
      }
    }
  }

  const hasThreadContext = Boolean(
    threadContextText ||
    establishedStylingContextText ||
    generatedOutfitContextText ||
    activeOutfit ||
    (Array.isArray(history) && history.length)
  )

  const conversationMode = resolveStylistConversationMode(question, {
    requestedMode: requestedConversationMode,
    hasThreadContext,
    hasGeneratedContext: Boolean(generatedOutfitContextText || (Array.isArray(generatedOutfits) && generatedOutfits.length) || activeOutfit),
  })

  const generatedOutfitReferenceSheet = Array.isArray(generatedOutfits) &&
    generatedOutfits.length &&
    shouldAttachGeneratedOutfitReferenceSheet(question, conversationMode)
    ? await makeGeneratedOutfitReferenceSheet(generatedOutfits, pieces || [])
    : null

  // Assemble the structured thread state for this turn. The current outfit set
  // comes from the body when present; otherwise (follow-ups) it is restored from
  // the persisted session state so "the second one" keeps meaning across turns.
  const outfitSetFromBody = (Array.isArray(generatedOutfits) ? generatedOutfits : []).slice(0, 8).map((o, index) => ({
    index: index + 1,
    label: o?.label || o?.title || `Outfit ${index + 1}`,
    ...(o?.occasion ? { occasion: o.occasion } : {}),
    ...(o?.activity ? { activity: o.activity } : {}),
    ...(o?.dominantDirection ? { direction: o.dominantDirection } : {}),
    ...(o?.silhouette ? { silhouette: o.silhouette } : {}),
    ...(o?.reason ? { reason: o.reason } : {}),
    ...(o?.stylingInstructions ? { styling_instructions: o.stylingInstructions } : {}),
    ...(o?.watchFor ? { watch_for: o.watchFor } : {}),
    piece_ids: (Array.isArray(o?.pieceIds) && o.pieceIds.length
      ? o.pieceIds
      : (Array.isArray(o?.pieces) ? o.pieces.map(piece => piece?.id) : [])
    ).map(Number).filter(Boolean),
    pieces: (Array.isArray(o?.pieces) ? o.pieces : []).map(piece => piece?.name).filter(Boolean),
  }))
  const currentOutfitSet = outfitSetFromBody.length
    ? outfitSetFromBody
    : (requestedConversationMode !== 'new_request' && Array.isArray(restoredState.current_outfit_set)
      ? restoredState.current_outfit_set
      : [])

  const threadState = {
    turn_mode: conversationMode,
    established: establishedStylingContext,
    ...(effectiveWeatherProfile ? { weather_profile: serializeWeatherProfile(effectiveWeatherProfile) } : {}),
    ...(travelOrPackingRequest ? {
      travel: {
        missing_weather: missingTravelWeather,
        live_weather_resolvable: canResolveTravelWeatherLive,
      }
    } : {}),
    ...(activeContext?.type ? {
      active_context: {
        type: activeContext.type,
        ...(activeContext.id ? { id: activeContext.id } : {}),
        ...(activeContext.name ? { name: activeContext.name } : {}),
      }
    } : {}),
    ...(activeOutfit ? {
      active_outfit: {
        ...(activeOutfit.id ? { id: activeOutfit.id } : {}),
        label: activeOutfit.label || activeOutfit.title || activeOutfit.name || 'current outfit',
      }
    } : {}),
    ...(currentOutfitSet.length ? { current_outfit_set: currentOutfitSet } : {}),
  }

  // Persist the full turn state (overwrites the previous turn: body values won,
  // restored values already merged into `established` above).
  saveStylistConversationState({
    ...(activeOutfit ? {
      active_outfit: activeOutfit,
      active_piece_ids: activePieceIds,
      visible_image_inventory: attachedImageInventory,
    } : {}),
    established: establishedStylingContext,
    ...(effectiveWeatherProfile ? { weather_profile: serializeWeatherProfile(effectiveWeatherProfile) } : {}),
    ...(currentOutfitSet.length ? { current_outfit_set: currentOutfitSet } : {}),
  }, sessionId)

  // 2026-07-12: the pre-model auto-save that stored the RAW question whenever the
  // keyword classifier called a turn correction/preference_reaction is gone. Live
  // data showed it filing plain requests ("give me 3 polished outfit ideas…")
  // as high-authority preferences — seven duplicates — which then steered every
  // later turn toward "polished" regardless of the actual ask. Corrections are
  // saved deliberately by the model via the store_user_correction tool (the
  // CRITICAL instruction in the wardrobe guidance), which distills the note
  // instead of quoting the question.
  const automaticallySavedCorrection = null

  const conversationDirective = buildStylistConversationDirective(conversationMode)
  const generatedSetCoverageAudit = Boolean(generatedOutfitContextText && isGeneratedSetCoverageAudit(question))

  // The whole-closet manifest: the stylist "knows the wardrobe" by reading it.
  // Deterministic ordering (group, then id) keeps the prompt prefix stable for
  // caching. Falls back to the legacy tools-only guidance if the wardrobe ever
  // outgrows the manifest budget.
  const manifestPieceCap = Number(process.env.WARDROBE_MANIFEST_MAX_PIECES || 400)
  let activeManifestPieces = []
  try {
    activeManifestPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active' ORDER BY id").all().map(parsePiece)
  } catch (err) {
    console.error('Wardrobe manifest query failed:', err)
  }
  const wardrobeManifestText = activeManifestPieces.length && activeManifestPieces.length <= manifestPieceCap
    ? buildWardrobeManifest(activeManifestPieces, { groupFor: wardrobeCategoryGroup })
    : ''

  // Historical outfit-set addressability: current_outfit_set stays the default referent (nothing
  // below fires without a signal), and older sets/critiques surface only when the user gives one.
  // Reuses the thread's own persisted messages rather than a parallel history store — the same
  // chat_threads row the client already reads/writes for this session. Gated cheaply: a keyword
  // match needs no DB read to detect; a garment-name match needs the manifest we already just
  // loaded above, so this runs after it rather than earlier in the function.
  const currentOutfitPieceIds = currentOutfitSet.flatMap(entry => Array.isArray(entry?.piece_ids) ? entry.piece_ids : []).map(Number).filter(Boolean)
  const questionNormForHistorical = String(question || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  // Same word-overlap tolerance as resolveHistoricalReferenceByGarment (a user drops a word, e.g.
  // "olive cargo shorts" for "olive cargo drawstring shorts") — an exact-substring gate here would
  // silently under-trigger relative to what the resolver could actually find once loaded.
  const questionWordsForHistorical = new Set(questionNormForHistorical.split(' ').filter(Boolean))
  const questionMayNameHistoricalGarment = activeManifestPieces.some(piece => {
    const nameWords = String(piece?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
    const matchedCount = nameWords.filter(word => questionWordsForHistorical.has(word)).length
    return matchedCount >= 2 && nameWords.length - matchedCount <= 1 && !currentOutfitPieceIds.includes(Number(piece.id))
  })
  let historicalOutfitContextText = ''
  if (isBackwardOutfitSetReference(question) || questionMayNameHistoricalGarment) {
    try {
      const threadRow = sessionId ? db.prepare('SELECT payload FROM chat_threads WHERE id = ?').get(sessionId) : null
      const threadMessages = threadRow ? (safeJsonParse(threadRow.payload, {})?.messages || []) : []
      const historicalSets = extractHistoricalOutfitSets(threadMessages)
      const historicalResolution = resolveHistoricalOutfitContext(question, historicalSets, currentOutfitPieceIds)
      historicalOutfitContextText = formatHistoricalOutfitSetsForPrompt(historicalResolution)
    } catch (err) {
      console.warn('Historical outfit-set lookup failed:', err.message)
    }
  }

  const activeWardrobeText = wardrobeManifestText
    ? [
      `WARDROBE MANIFEST — all ${activeManifestPieces.length} active pieces, grouped by category. A "?" suffix marks a low-confidence tag value; [flags] mark trust limits (do not auto-style flagged pieces without checking).`,
      '',
      wardrobeManifestText,
      '',
      'How to use the manifest:',
      '- It is the authoritative index of what exists. Only reference wardrobe pieces by the exact IDs above; never invent pieces.',
      '- Reason directly from it for coverage, gap, and "what do I own" questions — no search needed for that.',
      '- VERIFICATION CONTRACT (mechanically enforced): any specific piece you recommend or place in an outfit card must be verified THIS turn — `view_pieces` (cheap: photo thumbnails + truth lines for exact IDs) is the preferred way; `search_wardrobe` and `get_garment_details` also count. The manifest alone is not verification — its tags cannot show construction risks (lining, sheerness, true texture). Unverified piece IDs in your answer or in propose_outfit will be rejected and you will be asked to redo the work.',
      '- Layer/base pieces (layer_top / layer_bottom roles — anything worn under another garment or against skin) additionally require having SEEN the photo this turn: `view_pieces` (size:\'large\' for construction detail) is the cheap way; `search_wardrobe` visual:true and `get_garment_details` also attach photos. Check the `opacity` tag (sheer / open_weave pieces cannot be standalone base layers).',
      '- When recommending a specific piece in prose, cite it as (ID <number>) so the recommendation is verifiable.',
      '- ANCHOR RULE: when the user explicitly asks to style/wear a specific piece — or asks you to compose from pieces just discussed ("make cards from those") — those pieces are the premise. Verify them (view_pieces), then pass each to propose_outfit with anchor:true so suitability gates do not reject the very pieces the user asked about. Be honest in prose about any tradeoffs (weather, formality) instead of refusing the piece.',
      '- PAIRING/SLOT QUESTIONS ("what goes under X", "which shoes with Y"): answer in prose citing verified IDs. If you also propose a card, the card must be a COMPLETE outfit — shoes plus top+bottom or a dress — so finish the look around the pairing.',
      '- `search_wardrobe` also applies occasion/weather/activity gating; use it when composing for specific conditions so prohibited pieces are filtered for you.',
      '- Use `get_last_outfit_evaluation` to check past critiques and `get_current_image_inventory` to inspect attached images.',
      'CRITICAL: If the user states a new DURABLE style rule, taste preference, dislike, constraint, or correction, call `store_user_correction`. Pass a verified `piece_id` for one exact garment. Otherwise include `guidance_applicability` using only explicit owner-stated garment and context terms; use universal only when the owner clearly means every request. Add `firm_rule_proposal` only for an explicit supported prohibition. Never guess scope or store situational trip facts.'
    ].join('\n')
    : [
      'The full wardrobe list is omitted from the prompt to save context tokens.',
      'You MUST use the database search tools to look up or search for pieces in the closet:',
      '- Use `search_wardrobe` to search or filter active garments by query, category, color, or occasion.',
      '- Use `get_garment_details` to inspect detailed notes, fit warnings, styling rules, and intelligence for specific garment IDs.',
      '- Use `get_last_outfit_evaluation` to check past critiques.',
      '- Use `get_current_image_inventory` to inspect attached images.',
      '- Use `store_user_correction` to save user corrections/preferences.',
      'Never guess or assume a piece exists without querying the database via tools first.',
      'CRITICAL: If the user states a new DURABLE style rule, taste preference, dislike, constraint, or correction, call `store_user_correction`. Pass a verified `piece_id` for one exact garment. Otherwise include `guidance_applicability` using only explicit owner-stated garment and context terms; use universal only when the owner clearly means every request. Add `firm_rule_proposal` only for an explicit supported prohibition. Never guess scope or store situational trip facts.'
    ].join('\n')

  const feedbackMemoryParts = []
  const deliveredFeedbackContexts = []
  const ownerGuidancePieceIds = [...new Set([
    Number(activeContext?.type === 'piece' ? activeContext.id : (body.pieceId || body.piece?.id || null)),
    ...resolvedActiveOutfitPieceIds,
  ].filter(Boolean))]
  const ownerGuidancePieces = ownerGuidancePieceIds.length
    ? db.prepare(`SELECT * FROM pieces WHERE id IN (${ownerGuidancePieceIds.map(() => '?').join(',')})`).all(...ownerGuidancePieceIds).map(parsePiece)
    : []
  const ownerGuidanceContext = {
    requestContext: feedbackApplicabilityContext,
    pieces: ownerGuidancePieces,
  }
  if (activeOutfit && activeOutfit.id) {
    const outfitFeedbackText = getStylistFeedbackMemory('outfit', activeOutfit.id, 16, { ownerGuidanceContext })
    if (outfitFeedbackText) {
      feedbackMemoryParts.push(`Saved feedback/preferences for this outfit under discussion:\n${outfitFeedbackText}`)
      deliveredFeedbackContexts.push({ type: 'outfit', id: activeOutfit.id })
    }
  }
  const activePieceId = activeContext?.type === 'piece' ? activeContext.id : (body.pieceId || body.piece?.id || null)
  if (activePieceId) {
    const pieceFeedbackText = getStylistFeedbackMemory('piece', activePieceId, 16, { ownerGuidanceContext })
    if (pieceFeedbackText) {
      feedbackMemoryParts.push(`Saved feedback/preferences for this active garment:\n${pieceFeedbackText}`)
      deliveredFeedbackContexts.push({ type: 'piece', id: activePieceId })
    }
    const provisionalPieceText = getProvisionalWrongChoiceMemory([activePieceId], 2)
    if (provisionalPieceText) {
      feedbackMemoryParts.push(`Provisional owner corrections for this active garment:\n${provisionalPieceText}`)
    }
  }
  const globalFeedbackText = getStylistFeedbackMemory(null, null, 24, { excludeContexts: deliveredFeedbackContexts, ownerGuidanceContext })
  if (globalFeedbackText) {
    feedbackMemoryParts.push(`Global saved stylist feedback/preferences:\n${globalFeedbackText}`)
  }
  const acceptedLessonPieceIds = [...new Set([
    Number(activePieceId),
    ...resolvedActiveOutfitPieceIds,
  ].filter(Boolean))]
  const acceptedSynthesisText = getAcceptedFeedbackSynthesisMemory(8, {
    pieceIds: acceptedLessonPieceIds,
    ...feedbackApplicabilityContext,
  })
  if (acceptedSynthesisText) {
    feedbackMemoryParts.push(`Owner-accepted personal or contextual lessons:\n${acceptedSynthesisText}`)
  }

  const savedFeedbackSection = feedbackMemoryParts.length
    ? [
        '',
        'SAVED STYLIST FEEDBACK & PREFERENCES (HIGH-AUTHORITY MEMORIES):',
        'You MUST strictly respect and conform to the saved user preferences and corrections below. Stated preferences/dislikes take absolute precedence over generic style advice.',
        ...feedbackMemoryParts
      ].join('\n')
    : ''

  // Prompt-cache layout: stable blocks first (constitution, profiles, wardrobe
  // manifest), then the cache breakpoint, then the volatile per-turn blocks.
  // Keep the stable prefix byte-stable — it is what makes the manifest cheap.
  const system = prompts.STYLIST_SYSTEM + [
    '',
    'OCCASION & CLIMATE PROFILES (RULES-AS-DATA):',
    'Classify the user\'s event/activity and weather description into one of the profiles below. You MUST strictly apply that profile\'s prohibited_materials, prohibited_footwear, and preferred style vibe rules to recommended outfits or pieces. NEVER suggest heavy zip ankle boots in summer months (June, July, August) even on cooler/windy days, unless explicitly requested or for rain/mud. Each profile\'s `keywords` are illustrative examples of the kind of request it covers, not an exhaustive or literal match list — real requests will use wording none of them anticipated. Classify by the social register and setting the request actually implies, not by matching a surface noun: the same noun can describe very different registers (e.g. "market" spans a routine grocery/farmers-market errand, which is casual/city, versus a craft fair, wine festival, or artisan market outing, which is outdoor_daytime_social). When a request is a plain errand or everyday task with no festival/social/event framing, default to the permissive casual or city profiles rather than a narrower one.',
    JSON.stringify(OCCASION_PROFILES, null, 2),
    '',
    'CURRENT WARDROBE TRUTH:',
    activeWardrobeText,
    '',
    PROMPT_CACHE_BREAKPOINT,
    '',
    'CURRENT DATE / SEASON:',
    `Today is ${resolvedCurrentDateLabel}. Time zone: ${timezone || 'America/Los_Angeles'}.`,
    'Use this date for relative phrases like today, next week, in a few weeks, current season, or upcoming travel. Do not say you cannot determine today’s date.',
    '',
    'CONVERSATION CONTROLLER:',
    `Current turn mode: ${conversationMode}.`,
    `Turn directive: ${conversationDirective}`,
    'FIT CONCERNS: when the user states a fit problem (baggy, loose waist, clingy, riding up), address it head-on in prose FIRST — belting, tucking, proportion balancing, silhouette pairing — then compose cards that implement the advice. Do not ignore the stated concern and just assemble an outfit.',
    'INDOOR TRANSIT WEATHER: indoor describes a climate-controlled destination, not a weather escape hatch. In a multi-outfit plan, the outside forecast still governs the base outfit and transit. During extreme heat, build a breathable hot-weather base and use only an optional light layer for AC; never solve AC with a heavy main garment. Indoor suppresses direct-sun and outdoor-activity styling, not temperature itself.',
    freeformToolRoutingInstruction(conversationMode),
    extractedWeather ? `Established weather context for this turn: ${extractedWeather}. Pass this weather to search_wardrobe and apply weatherFit/ruleFit before suggesting garments.` : '',
    missingTravelWeather ? 'TRAVEL WEATHER BLOCKER: The user gave a travel/packing request without weather or forecast context. Do not call search_wardrobe, do not recommend garments, and do not suggest outfits. Ask one friendly clarification for the expected weather/forecast first.' : '',
    `If mode is new_request and required context is present, answer the user’s request directly using wardrobe context by recommending specific items from ${prompts.PROFILE_NAME}'s closet. For travel or packing requests, required context means destination/location, timing, and weather/forecast; timing/season alone is not enough because trip outfits depend on the actual forecast. Parse relative timing (e.g., "in a week", "tomorrow") or specific dates as valid timing context (and infer likely season only as a fallback), but if travel weather context is missing, ask specifically for the expected weather forecast before searching the wardrobe or suggesting outfits. Do not ask "when" if timing or dates are already provided. Do not suggest generic categories or descriptions (like "a solid-colored tank", "a lightweight scarf", or "a compact umbrella"); you must search the wardrobe and recommend specific owned items (e.g., "your rust orange ribbed tank top") or flag them as missing wardrobe gaps. If details like location/city, timing, or travel weather are missing, do not call any database search tools (like search_wardrobe) and do not recommend garments or suggest outfits; you must ask exactly one friendly, natural clarifying question to gather the missing context (e.g., "What weather are you expecting for the trip?").`,
    'For followup, correction, explanation, and preference_reaction modes, answer the latest user message first. Do not regenerate the full prior list, plan, or evaluation unless the user explicitly asks for a revised version. For trip or multi-outfit plans, if the user asks to revise, add, check variety, or show/render the outfits, update or use the Current outfit set instead of treating the latest suggestion as a standalone note.',
    generatedSetCoverageAudit ? 'CURRENT SET COVERAGE AUDIT: The user is asking whether the current multi-outfit set has enough coverage, backup options, or repeat-wear resilience. First audit the current set plainly. If you recommend additional outfits or swaps, you MUST call search_wardrobe with visual:true and the relevant occasion/activity/weather before naming pieces. Suggest only exact owned wardrobe garments returned by search_wardrobe. Do NOT invent aspirational pieces, do NOT add shopping-style [missing wardrobe gap] outfits, and do NOT include a missing wardrobe gap unless an owned-garment search fails and you are explicitly explaining the uncovered gap.' : '',
    'In correction mode, keep the reply to 1–3 short sentences or one compact paragraph unless the user asks for a new complete answer.',
    'Only use the full structured outfit-evaluation template when the user explicitly asks to evaluate or critique an outfit. For ordinary chat follow-ups, answer conversationally.',
    '',
    'THREAD STATE (STRUCTURED):',
    JSON.stringify(threadState, null, 1),
    'THREAD STATE is the single source of truth for established styling context and the current outfit set. Reuse its values for follow-ups unless the user changes them; when it conflicts with older prose context, THREAD STATE wins. When the user references outfits by position ("the first one", "#2"), resolve against current_outfit_set. For a one-slot variant request against a current outfit, prefer suggest_slot_swaps so the alternatives stay tied to the existing card instead of restarting full outfit composition.',
    'CURRENT-SET AUTHORITY: current_outfit_set is the default referent for unqualified discussion ("these outfits", "the second one", "add a layer", "which works best?") — always reason from it, not from an earlier turn\'s conversational framing. Earlier outfit sets and critiques of them are historical context, discussable only when the user explicitly refers back (see HISTORICAL OUTFIT SETS below if supplied this turn). A critique or rejection recorded against an earlier set — "these don\'t work," "too elevated," any objection — must NOT be applied to current_outfit_set unless the user states or repeats that same critique about the current set now. Regenerating the set resolves the earlier objection; do not re-litigate it from memory of the prior turn.',
    '',
    historicalOutfitContextText,
    threadContextText ? `CURRENT THREAD CONTEXT:\n${threadContextText}` : '',
    '',
    extraContextText ? `OUTFIT CONTEXT UNDER DISCUSSION:\n${extraContextText}` : '',
    '',
    attachedImageInventory.length
      ? `CURRENT ATTACHED IMAGE INVENTORY:\n${attachedImageInventory.map(item => `- ${item}`).join('\n')}`
      : '',
    savedFeedbackSection,
    '',
    generatedOutfitContextText ? [
      'CURRENT GENERATED OUTFIT CARD CONTEXT:',
      generatedOutfitContextText,
      '',
      'If the user asks about "the first one", "these outfits", or a generated card, use this current card context.',
      conversationMode === 'new_request'
        ? 'For a new outfit-planning request, you may present the current cards as the answer when they directly satisfy the request.'
        : 'For this follow-up/correction, treat the cards as memory only. Answer the latest question directly; do not repeat the full trip plan or outfit list unless the user explicitly asks to show, render, or regenerate cards.',
      generatedSetCoverageAudit
        ? 'For this coverage question, do not create new dinner/trip outfit sections from imagination. Either say the current set is insufficient and search owned wardrobe for concrete backups, or explain the repeat-wear tradeoff using the current cards.'
        : '',
      generatedOutfitReferenceSheet
        ? 'The current user turn includes a generated outfit garment-reference sheet grouped by card. Use those pixels for garment thumbnail, hanger-photo, worn-photo, ruler, texture, fit, shoe, and detail questions.'
        : 'You can discuss the generated outfit card text and saved garment thumbnails described here.',
      'If the context includes a generation pipeline note, use it to answer whether photos were used during selection.',
      generatedOutfitReferenceSheet
        ? 'Do not say you cannot see the current generated garment photos. Inspect the attached reference sheet and state confidence if a detail is small or partially visible.'
        : 'Be honest if you are judging from card context rather than a full rendered outfit image, but do not say you cannot see or discuss the generated outfits.'
    ].join('\n') : ''
  ].filter(Boolean).join('\n')

  // Cross-turn cache prefix: this text becomes a history message on the NEXT turn, where the browser
  // replays it as the user's bare question. Anything added here that history will not replay makes
  // the two representations differ, and Anthropic matches cache on exact prefix — so a difference at
  // message 0 invalidates the whole message array on every subsequent turn. The date is therefore
  // deliberately NOT repeated here: it already sits in the volatile system half above, with its
  // usage instruction, which is where the model reads it from. The "Attached:" lines stay because
  // they only appear on image turns, which carry base64 blocks history never replays anyway.
  const promptText = [
    generatedOutfitReferenceSheet ? 'Attached: current generated outfit garment-reference sheet.' : '',
    outfitImageContent ? 'Attached: images for the outfit under discussion.' : '',
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

  // The client's `history` already ends with the message being asked (StylistChat appends it to
  // chatHistory before sending), and `question` is then sent separately and appended again as the
  // final user turn — so the current question reached the model TWICE on every freeform request.
  // Not the largest cost, but pure duplication, and repeating the latest wording verbatim also
  // overweights it against the rest of the turn's context.
  //
  // Dropped defensively on the server rather than by changing the client contract: only when the
  // trailing entry is a user message whose text matches `question` exactly. Anything else — a
  // genuine repeat of an earlier question, a trailing assistant turn — is left alone.
  const priorHistory = (history || []).map(h => ({ role: h.role, content: h.content }))
  const askedNow = String(question || '').trim()
  const last = priorHistory[priorHistory.length - 1]
  if (askedNow && last?.role === 'user' && typeof last.content === 'string' && last.content.trim() === askedNow) {
    priorHistory.pop()
  }
  const boundedHistory = boundFreeformConversationHistory(priorHistory)

  return {
    system,
    messages: [
      ...boundedHistory.messages,
      { role: 'user', content: userContent }
    ],
    maxTokens: 1500,
    automaticallySavedCorrection,
    threadState,
    historyDiagnostics: boundedHistory.diagnostics,
    // docs/search-payload-spec.md §5. search_wardrobe trims its rows to per-request judgment only
    // when the model can actually see the full-truth manifest. The tiered discovery index does not
    // qualify: it owns identity only, so search must return the missing stable truth.
    wardrobeManifestIncluded: Boolean(wardrobeManifestText)
  }
}
