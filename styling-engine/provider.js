import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { STYLIST_SYSTEM } from './prompts.js'
import { STYLIST_TOOLS, executeTool, bumpFreeformDiagnostic, verifiedPieceIdSets } from './tools.js'
import { tripRequestNeedsScopeClarification } from './stylingIntent.js'

// Spec 3 Part 0b: a named-garment search that returned zero results is a known-false claim in
// waiting. If the model's final answer then describes that exact query text as a real, ownable
// piece, that's not a guess — the system had proof at generation time and let it through anyway.
// Kept mechanical (substring match against a query already proven empty) rather than general fact
// checking, to stay cheap and low-risk for false positives.
export function findZeroResultContradiction(answerText = '', toolContext = {}) {
  const queries = Array.isArray(toolContext?.zeroResultQueries) ? toolContext.zeroResultQueries : []
  const normalizedAnswer = String(answerText || '').toLowerCase()
  if (!queries.length || !normalizedAnswer) return null
  for (const rawQuery of queries) {
    const normalizedQuery = String(rawQuery || '').toLowerCase().trim()
    if (normalizedQuery.length >= 6 && normalizedAnswer.includes(normalizedQuery)) return rawQuery
  }
  return null
}

// Gate for the tripScopeClarification clause — RETIRED by default as of the
// 2026-07-15 owner ruling. Live evidence: an "Apple skirt" long-weekend-city
// trip turn was well-scoped (anchor viewed large, searched, 3 valid anchored
// cards composed), but the clause's keyword match ("weekend" = multi-day,
// only one use-case keyword matched) blocked the finished answer anyway,
// forcing a fake clarifying question ("You're right — I jumped ahead...")
// displayed ABOVE the three already-finished cards, addressed to the
// validator as if the user had complained. This is stronger than "proved
// unnecessary" — it actively vandalized a turn that went right. The
// destinationClarification clause has no such misfire evidence and stays
// live. Set WARDROBE_TRIP_SCOPE_CLARIFICATION=on to restore this clause as a
// reversible fallback. Read at call time, not module load, so it can be
// flipped without a restart.
export function tripScopeClarificationEnabled() {
  return process.env.WARDROBE_TRIP_SCOPE_CLARIFICATION === 'on'
}

// Spec 3 Part 0a: outfit-shaped prose (a title followed by labeled slot lines) with zero
// propose_outfit calls this turn — the model wrote what looks like a proposal without going through
// the tool, so the pieces it named are unverified. Originally a soft signal only (flagged, not
// blocked); hardened into a retry-triggering hard block on 2026-07-10 (see the note on
// extractPieceIdsFromProse below).
// 2026-07-10 follow-up: the category-label pattern ("Top: ...", "Shoes: ...") missed a second, equally
// common shape the model uses — a numbered list of bold garment names ("**1. Mustard Knit Sweater (ID
// 84)**") with no category words at all. Rather than chase every future prose template individually,
// the numbered-list branch checks for a format-independent signal instead: citing 2+ real piece IDs is
// strong evidence of describing specific wardrobe items outside the tool, regardless of which prose
// shape is used around them.
export function looksLikeUnproposedOutfitProse(answerText = '') {
  const text = String(answerText || '')
  const labelMatches = text.match(/^\s*(?:[-*]\s*)?\*{0,2}(top|bottom|dress|shoes|outerwear|accessory)\*{0,2}\s*:/gim) || []
  const distinctLabels = new Set(labelMatches.map(m => m.toLowerCase().replace(/[^a-z]/g, '')))
  if (distinctLabels.size >= 2) return true

  const numberedLines = (text.match(/^\s*\*{0,2}\d+\.\s+\S/gim) || []).length // ratchet-allow: model's own reply prose, not garment matching
  if (numberedLines >= 2 && extractPieceIdsFromProse(text).length >= 2) return true

  return false
}

// 2026-07-10, second follow-up: live-testing kept finding new prose shapes that escaped
// looksLikeUnproposedOutfitProse — a third one turned up (bulleted sentences, no category labels, no
// cited IDs) within minutes of fixing the second. Chasing the model's answer-formatting choices one at
// a time doesn't converge. This is a format-independent alternative: check what the USER asked instead
// of what the model wrote. If the question itself is clearly an outfit request, propose_outfit should
// have been called regardless of how the (missing) proposal would have been phrased — covers every
// current and future prose shape with one check instead of one regex per format.
export function looksLikeOutfitRequest(questionText = '') {
  const text = String(questionText || '').trim()
  return /\b(what should i wear|what (?:should i|to) wear|what should i pack|help me pack|outfit ideas?|style ideas?|styling advice|styling help|dress me)\b|\bideas\s*\?\s*$/i.test(text) || // ratchet-allow: user intent routing text, not garment matching
    /\b(?:can we|could we|let'?s|try|please|help me)\s+(?:try\s+)?(?:style|layer|layering)\b/i.test(text) || // ratchet-allow: user intent routing text, not garment matching
    /\bas (?:a |the )?(?:top layer|layer_top|outer layer|overlay)\b/i.test(text) // ratchet-allow: user's own request text, not garment matching
}

export function extractRequestedOutfitCount(questionText = '') {
  const text = String(questionText || '').toLowerCase()
  const wordNumbers = new Map([
    ['one', 1],
    ['two', 2],
    ['three', 3],
    ['four', 4],
    ['five', 5]
  ])
  const descriptor = '(?:[a-z]+\\s+){0,4}'
  const explicitDigit = text.match(new RegExp(`\\b(?:give me|show me|suggest|create|make|generate|can you give me|can i get|need|want)\\s+(\\d+)\\s+${descriptor}(?:outfit|look|idea)s?\\b`))
  if (explicitDigit) return Math.max(1, Math.min(5, Number(explicitDigit[1]) || 0))
  const explicitWord = text.match(new RegExp(`\\b(?:give me|show me|suggest|create|make|generate|can you give me|can i get|need|want)\\s+(one|two|three|four|five)\\s+${descriptor}(?:outfit|look|idea)s?\\b`))
  if (explicitWord) return wordNumbers.get(explicitWord[1]) || null
  const bareDigit = text.match(new RegExp(`\\b(\\d+)\\s+${descriptor}(?:outfit|look|idea)s?\\b`))
  if (bareDigit) return Math.max(1, Math.min(5, Number(bareDigit[1]) || 0))
  const bareWord = text.match(new RegExp(`\\b(one|two|three|four|five)\\s+${descriptor}(?:outfit|look|idea)s?\\b`))
  if (bareWord) return wordNumbers.get(bareWord[1]) || null
  return null
}

// Spec 7 Part 2: the model asking a destination/weather clarifying question without ever calling
// search_wardrobe is the confirmed failure mode (STYLIST_SYSTEM's prompt guidance alone wasn't
// reliable — same lesson as spec 3 Part 0). Deliberately loose keyword match: a false positive just
// costs one harmless retry, cheaper than the miss (a full extra clarifying turn from Yuna's side).
export function looksLikeDestinationOrWeatherQuestion(answerText = '') {
  const text = String(answerText || '')
  if (!text.includes('?')) return false // ratchet-allow: model's own reply prose, not garment matching
  return /\b(what weather|what'?s (?:the |expected )?(?:weather|forecast)|expected weather forecast|what destination|where are you (going|headed)|where'?re you (going|headed|traveling)|what city|which city|what location)\b/i.test(text) // ratchet-allow: model's own reply prose, not garment matching
}

// Spec 11, revised (2026-07-10): the original version of this fix only forced a retry when the user
// explicitly asked to "show"/"render", by asking the model to reconstruct an outfit it had already
// described in prose. Live testing found that reconstruction step itself was the problem — the model
// sometimes substituted a different-but-plausible piece for one it wasn't anchored to, instead of a
// true re-render. Root cause traced further: the legacy client-side prose parser
// (parseStructuredOutfitsFromAssistantText in StylistChat.jsx) that used to build cards locally from
// plain-text outfit descriptions only matches the old pre-propose_outfit "### Outfit N" + "**Pieces**:
// A + B + C" format — STYLIST_SYSTEM has explicitly told the model NOT to write that format since the
// propose_outfit migration, so that fallback silently never fires against current prose. There is no
// reliable local reconstruction path anymore. The actual fix is upstream: make the model call
// propose_outfit on the FIRST turn, every time it's describing an outfit, so there's nothing to
// reconstruct later. This hardens the existing looksLikeUnproposedOutfitProse signal (previously a
// spec-3 soft flag only) into a hard block — same "don't trust the model's self-report, verify
// mechanically" pattern as every other check in this file.
export function extractPieceIdsFromProse(answerText = '') {
  const matches = [...String(answerText || '').matchAll(/\bID\s*:?\s*(\d+)\b/gi)] // ratchet-allow: model's own reply prose, not garment matching
  const ids = matches.map(m => Number(m[1])).filter(Number.isFinite)
  return [...new Set(ids)]
}

// THE TURN CONTRACT (step 5 of the "router → stylist" migration): one validator
// over the model's tool-call-free final answer, three clauses, one retry per
// blockType — the caller passes the Set of blockTypes already retried this turn,
// so exhausting one clause's budget doesn't consume another's.
//
//   truth    — claims must match what was verified this turn (step 3's rule)
//   context  — legacy clarification checks; kept before delivery so
//              "stop and ask" beats "deliver more"
//   delivery — the declared want must be satisfied (step 4's declaration)
//
// want:'image' has no delivery clause on purpose: in-chat rendering does not
// exist yet (step 2 postponed) and declare_intent's ack already instructs the
// honest capability-gap answer.
export function applyFreeformOutputChecks(answerText, toolContext, retried = new Set()) {
  const fail = (blockType, diagnostic, correctionMessage) => {
    bumpFreeformDiagnostic(toolContext, diagnostic)
    return { block: true, blockType, correctionMessage }
  }

  // ── truth ───────────────────────────────────────────────────────────────
  if (!retried.has('zeroResultContradiction')) {
    const contradiction = findZeroResultContradiction(answerText, toolContext)
    if (contradiction) {
      return fail('zeroResultContradiction', 'zeroResultContradictionBlocks',
        `You searched for "${contradiction}" and found nothing — do not describe this as a piece Yuna owns. Either offer a real alternative via search_wardrobe or say plainly that she doesn't have this piece.`)
    }
  }
  // A piece ID cited in prose must have been verified this turn — retrieved via
  // search/details, or part of a verified card (this turn's generated outfits or
  // the thread's current outfit set). With the wardrobe manifest in the prompt,
  // the model can name real IDs it has never actually checked; the manifest is
  // an index, not garment truth.
  if (!retried.has('unverifiedCitation')) {
    const citedIds = extractPieceIdsFromProse(answerText)
    if (citedIds.length) {
      const { retrieved, known } = verifiedPieceIdSets(toolContext)
      const unverifiedCited = citedIds.filter(id => !retrieved.has(id) && !known.has(id))
      if (unverifiedCited.length) {
        return fail('unverifiedCitation', 'unverifiedCitationBlocks',
          `You cited piece ID(s) ${unverifiedCited.join(', ')} without verifying them this turn — the wardrobe manifest is an index, not garment truth. Call view_pieces for ${unverifiedCited.map(id => `ID ${id}`).join(', ')} to confirm each piece (photo + truth line), then answer again (or drop the unverified references).`)
      }
    }
  }

  // ── context (legacy clarification clauses — retire candidates) ──────────
  // Per the proposed architecture these should become the model's own judgment
  // informed by THREAD STATE. Kept mechanical until live evidence shows the
  // prompt-level judgment holds — the history here is explicit that prompt
  // guidance alone failed before (2026-07-10 trip-scope live test).
  if (tripScopeClarificationEnabled() && !retried.has('tripScopeClarification') && tripRequestNeedsScopeClarification(toolContext?.question) &&
      ((toolContext?.freeformDiagnostics?.searchCalls || 0) > 0 || (toolContext?.freeformDiagnostics?.proposeCalls || 0) > 0)) {
    return fail('tripScopeClarification', 'tripScopeClarificationRetries',
      "This is a multi-day trip without enough activity/use-case scope, but you already searched or composed outfits before confirming what the trip needs to cover. Stop composing. Ask directly what activities or use cases to plan for — for example city walking, casual daytime, dinners, hiking/outdoors, anything dressier — before proposing garments this turn.")
  }
  if (!retried.has('destinationClarification') && (toolContext?.freeformDiagnostics?.searchCalls || 0) === 0 && looksLikeDestinationOrWeatherQuestion(answerText)) {
    return fail('destinationClarification', 'destinationClarificationRetries',
      "You asked about weather or destination without calling search_wardrobe first. If this message names any real place or specific occasion (even one word — a city, region, venue, or event), call search_wardrobe with that as `location` and proceed to propose an outfit. Only ask again if you genuinely cannot identify any destination or occasion in the request.")
  }

  // ── delivery ────────────────────────────────────────────────────────────
  // The declaration is authoritative; the phrasing regexes apply only on
  // undeclared turns, as a fallback vocabulary.
  const declaredIntent = toolContext?.declaredIntent || null
  const turnWantsCards = declaredIntent ? declaredIntent.want === 'cards' : looksLikeOutfitRequest(toolContext?.question)
  const requestedOutfitCount = declaredIntent?.outfitCount || extractRequestedOutfitCount(toolContext?.question)
  const readyCards = Array.isArray(toolContext?.generatedOutfits)
    ? toolContext.generatedOutfits.filter(outfit => !outfit?.broken).length
    : 0
  // Declared cards, delivered none, and didn't ask the user anything: the
  // turn's contract is unmet. An answer containing a question is treated as the
  // model's own clarification judgment and passes.
  const askedAQuestion = String(answerText || '').includes('?')
  if (!retried.has('cardsNotDelivered') && declaredIntent?.want === 'cards' && readyCards === 0 && !askedAQuestion) {
    return fail('cardsNotDelivered', 'cardsNotDeliveredBlocks',
      "You declared want:'cards' but finished the turn with zero verified outfit cards and no clarifying question. Either compose now — search_wardrobe, then propose_outfit — or, if the wardrobe genuinely cannot satisfy the request, call declare_intent({ want: 'text' }) and explain the gap plainly.")
  }
  // Declared image, never rendered, and didn't ask anything: same shape as
  // cardsNotDelivered — render_preview exists precisely so this want is
  // satisfiable in chat.
  if (!retried.has('imageNotDelivered') && declaredIntent?.want === 'image' &&
      (toolContext?.freeformDiagnostics?.renderCalls || 0) === 0 && !askedAQuestion) {
    return fail('imageNotDelivered', 'imageNotDeliveredBlocks',
      "You declared want:'image' but never called render_preview. Call render_preview({ outfit_index }) for a card produced this turn, or render_preview({ piece_ids }) with IDs from a verified card — or ask the user which look to render.")
  }
  if (!retried.has('outfitCount') && requestedOutfitCount && turnWantsCards && readyCards > 0 && readyCards < requestedOutfitCount) {
    const alreadySearched = (toolContext?.freeformDiagnostics?.searchCalls || 0) > 0
    const missingCount = requestedOutfitCount - readyCards
    return fail('outfitCount', 'outfitCountBlocks', alreadySearched
      ? `The user requested ${requestedOutfitCount} outfit ideas, but only ${readyCards} verified outfit card${readyCards === 1 ? '' : 's'} exist. You already searched the wardrobe for this request. Do not call search_wardrobe again as your next step. Call propose_outfit now for ${missingCount} additional complete valid outfit card${missingCount === 1 ? '' : 's'} using pieces from the existing search results, with the same constraints.`
      : `The user requested ${requestedOutfitCount} outfit ideas, but only ${readyCards} verified outfit card${readyCards === 1 ? '' : 's'} exist. Continue the same turn: search_wardrobe with the same constraints, then call propose_outfit for ${missingCount} additional complete valid outfit card${missingCount === 1 ? '' : 's'}. Do not finish with fewer than requested unless you have made a real additional attempt and must explain the wardrobe gap.`)
  }
  // Outfit-shaped prose backstop: pieces must travel through propose_outfit.
  // With a declaration present the zero-cards case is handled by
  // cardsNotDelivered above; this leg remains for prose-shaped piece lists and
  // for undeclared outfit-request turns. (A trip-precompose plan seeds verified
  // cards before the loop starts — narrating those back is fine, hence the
  // preseeded exemption.)
  const hasPreseededOutfitCard = Array.isArray(toolContext?.generatedOutfits) && toolContext.generatedOutfits.length > 0
  if (!retried.has('outfitProse') && !hasPreseededOutfitCard && (toolContext?.freeformDiagnostics?.proposeCalls || 0) === 0 &&
      (looksLikeUnproposedOutfitProse(answerText) || (!declaredIntent && looksLikeOutfitRequest(toolContext?.question)))) {
    const priorIds = extractPieceIdsFromProse(answerText)
    const idHint = priorIds.length
      ? ` You already referenced these exact piece IDs: ${priorIds.join(', ')} — reuse exactly these IDs and roles, do not substitute or invent different pieces.`
      : ''
    return fail('outfitProse', 'outfitProseWithoutToolCall',
      `This looked like a request for an outfit, but propose_outfit was never called this turn — the pieces must go through the tool call to render as a verified card, not a hand-written list. Call propose_outfit now with the outfit you'd suggest.${idHint}`)
  }
  return { block: false }
}

export function freeformToolLoopFallbackAnswer(toolContext = {}) {
  const outfits = Array.isArray(toolContext.generatedOutfits) ? toolContext.generatedOutfits : []
  if (!outfits.length) {
    return 'I ran out of steps before I could finish this one — my outfit proposals kept getting rejected by validation before a card could land. Ask me to try again: I will verify the exact pieces first and keep the piece you asked about pinned as the anchor.'
  }

  const requestedOutfitCount = toolContext.declaredIntent?.outfitCount || extractRequestedOutfitCount(toolContext.question)
  const readyCount = outfits.filter(outfit => !outfit?.broken).length
  const brokenCount = outfits.length - readyCount
  if (requestedOutfitCount && readyCount < requestedOutfitCount) {
    return [
      `I found ${readyCount} verified outfit card${readyCount === 1 ? '' : 's'} for this request.`,
      brokenCount > 0
        ? `${brokenCount} additional proposal${brokenCount === 1 ? ' was' : 's were'} rejected and shown as a diagnostic card.`
        : '',
      `I couldn't complete all ${requestedOutfitCount} requested looks before the tool loop stopped.`
    ].filter(Boolean).join(' ')
  }
  return readyCount === 1 ? "Here's the outfit." : `Here are ${readyCount} outfit ideas.`
}

// 2026-07-10: /ask's catch block was the one place in this codebase that suppressed the real error
// behind a hardcoded "Something went wrong — try again" — every other AI-backed route already surfaces
// err.message directly. That alone would have shown OpenAI's actual quota-exceeded text, but a raw SDK
// error message ("You exceeded your current quota, please check your plan and billing details...")
// still reads as a stack-trace-adjacent dump, not a clear signal that this is a billing/plan issue and
// not an app bug. Detects rate-limit/quota errors specifically (status 429, provider-specific error
// codes, or message text) across both providers and gives a short, actionable message instead.
export function describeAiError(err) {
  const status = Number(err?.status) || null
  const code = String(err?.code || err?.error?.code || err?.type || '').toLowerCase()
  const message = String(err?.message || '').toLowerCase()
  const isQuota = code.includes('insufficient_quota') || message.includes('quota') || message.includes('billing')
  const isRateLimit = status === 429 || code.includes('rate_limit') || message.includes('rate limit') || message.includes('overloaded')
  if (isQuota) {
    return { status: 429, message: 'The AI provider is reporting an exhausted usage quota — check your API billing/plan before trying again. This is not an app bug.' }
  }
  if (isRateLimit) {
    return { status: 429, message: 'The AI provider is rate-limiting requests right now. Wait a moment and try again.' }
  }
  return { status: 500, message: err?.message || 'Something went wrong — try again' }
}

export const AI_PROVIDER = (process.env.AI_PROVIDER || 'anthropic').toLowerCase()
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_STYLIST_MODEL || 'claude-sonnet-4-6'
export const OPENAI_MODEL = process.env.OPENAI_STYLIST_MODEL || 'gpt-4o'
export const ACTIVE_STYLIST_MODEL = AI_PROVIDER === 'openai' ? OPENAI_MODEL : ANTHROPIC_MODEL

const ANTHROPIC_PRICING_PER_MILLION = [
  { match: /claude-.*sonnet.*4|claude-sonnet-4/i, input: 3, cacheWrite5m: 3.75, cacheRead: 0.30, output: 15 },
  { match: /claude-.*haiku.*4\.5|claude-haiku-4/i, input: 1, cacheWrite5m: 1.25, cacheRead: 0.10, output: 5 },
  { match: /claude-.*opus.*4\.[5-9]|claude-opus-4\.[5-9]/i, input: 5, cacheWrite5m: 6.25, cacheRead: 0.50, output: 25 },
  { match: /claude-.*opus.*4(?:-|$)|claude-opus-4(?:-|$)/i, input: 15, cacheWrite5m: 18.75, cacheRead: 1.50, output: 75 },
]

const OPENAI_PRICING_PER_MILLION = [
  { match: /^gpt-5\.5(?:-|$)/i, input: 5, cachedInput: 0.50, output: 30 },
  { match: /^gpt-5\.4(?:-|$)/i, input: 2.50, cachedInput: 0.25, output: 15 },
  { match: /^gpt-5\.4-mini(?:-|$)/i, input: 0.75, cachedInput: 0.075, output: 4.50 },
  { match: /^gpt-5\.4-nano(?:-|$)/i, input: 0.20, cachedInput: 0.02, output: 1.25 },
  { match: /^gpt-4o-mini(?:-|$)/i, input: 0.15, cachedInput: 0.075, output: 0.60 },
  { match: /^gpt-4o(?:-|$)/i, input: 2.50, cachedInput: 1.25, output: 10 },
]

function envPricingOverride() {
  const input = Number(process.env.AI_INPUT_USD_PER_MTOK)
  const output = Number(process.env.AI_OUTPUT_USD_PER_MTOK)
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null
  const cachedInput = Number(process.env.AI_CACHED_INPUT_USD_PER_MTOK)
  const cacheRead = Number(process.env.AI_CACHE_READ_USD_PER_MTOK)
  const cacheWrite5m = Number(process.env.AI_CACHE_WRITE_5M_USD_PER_MTOK)
  return {
    match: /^env-override$/,
    input,
    output,
    ...(Number.isFinite(cachedInput) ? { cachedInput } : {}),
    ...(Number.isFinite(cacheRead) ? { cacheRead } : {}),
    ...(Number.isFinite(cacheWrite5m) ? { cacheWrite5m } : {}),
    source: 'env'
  }
}

function pricingForModel(provider = AI_PROVIDER, model = ACTIVE_STYLIST_MODEL) {
  const override = envPricingOverride()
  if (override) return override
  const table = provider === 'openai' ? OPENAI_PRICING_PER_MILLION : ANTHROPIC_PRICING_PER_MILLION
  return table.find(entry => entry.match.test(model)) || null
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

export function normalizeAiUsage(rawUsage = null, { provider = AI_PROVIDER, model = ACTIVE_STYLIST_MODEL } = {}) {
  if (!rawUsage || typeof rawUsage !== 'object') return null
  if (provider === 'openai') {
    const promptDetails = rawUsage.prompt_tokens_details || {}
    return {
      provider,
      model,
      inputTokens: numberOrZero(rawUsage.prompt_tokens),
      outputTokens: numberOrZero(rawUsage.completion_tokens),
      totalTokens: numberOrZero(rawUsage.total_tokens),
      cacheReadInputTokens: numberOrZero(promptDetails.cached_tokens),
      cacheCreationInputTokens: 0,
      raw: rawUsage
    }
  }
  const inputTokens = numberOrZero(rawUsage.input_tokens)
  const outputTokens = numberOrZero(rawUsage.output_tokens)
  const cacheCreationInputTokens = numberOrZero(rawUsage.cache_creation_input_tokens)
  const cacheReadInputTokens = numberOrZero(rawUsage.cache_read_input_tokens)
  return {
    provider,
    model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    raw: rawUsage
  }
}

export function estimateAiUsageCost(usage = null) {
  if (!usage) return null
  const pricing = pricingForModel(usage.provider, usage.model)
  if (!pricing) {
    return {
      estimatedUsd: null,
      pricingAvailable: false,
      reason: `No local pricing entry for ${usage.provider}:${usage.model}`
    }
  }
  const billableInputTokens = Math.max(0, numberOrZero(usage.inputTokens) - numberOrZero(usage.cacheReadInputTokens))
  const inputUsd = billableInputTokens * pricing.input / 1_000_000
  const outputUsd = numberOrZero(usage.outputTokens) * pricing.output / 1_000_000
  const cacheReadUsd = numberOrZero(usage.cacheReadInputTokens) * (pricing.cacheRead || pricing.cachedInput || pricing.input) / 1_000_000
  const cacheCreationUsd = numberOrZero(usage.cacheCreationInputTokens) * (pricing.cacheWrite5m || pricing.input) / 1_000_000
  const estimatedUsd = inputUsd + outputUsd + cacheReadUsd + cacheCreationUsd
  return {
    estimatedUsd: Number(estimatedUsd.toFixed(6)),
    pricingAvailable: true,
    inputUsd: Number(inputUsd.toFixed(6)),
    outputUsd: Number(outputUsd.toFixed(6)),
    cacheReadUsd: Number(cacheReadUsd.toFixed(6)),
    cacheCreationUsd: Number(cacheCreationUsd.toFixed(6)),
    ratesPerMillion: pricing
  }
}

export function assertProviderKey() {
  if (AI_PROVIDER === 'openai' && !process.env.OPENAI_API_KEY) {
    throw new Error('AI_PROVIDER=openai but no OPENAI_API_KEY set in .env')
  }
  if (AI_PROVIDER !== 'openai' && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('AI_PROVIDER=anthropic but no ANTHROPIC_API_KEY set in .env')
  }
}

export async function prepareImageForClaude(filePath) {
  const sharp = (await import('sharp')).default
  const buffer = await sharp(filePath)
    .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()
  return { base64: buffer.toString('base64'), mime: 'image/jpeg' }
}

const wardrobeThumbCache = new Map() // key: `${pieceId}:${filename}:${maxPx}` -> { media_type, data }

export async function prepareWardrobeThumb(filePath, cacheKey, { maxPx = 448 } = {}) {
  const normalizedMaxPx = Math.max(1, Math.min(1568, Number(maxPx) || 448))
  const cacheKeyWithSize = cacheKey ? `${cacheKey}:${normalizedMaxPx}` : ''
  if (cacheKeyWithSize && wardrobeThumbCache.has(cacheKeyWithSize)) return wardrobeThumbCache.get(cacheKeyWithSize)
  const sharp = (await import('sharp')).default
  const buffer = await sharp(filePath)
    .resize(normalizedMaxPx, normalizedMaxPx, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer()
  const result = { media_type: 'image/jpeg', data: buffer.toString('base64') }
  if (cacheKeyWithSize) {
    wardrobeThumbCache.set(cacheKeyWithSize, result)
    if (wardrobeThumbCache.size > 300) {
      // simple eviction: drop oldest entry
      wardrobeThumbCache.delete(wardrobeThumbCache.keys().next().value)
    }
  }
  return result
}

export function contentToOpenAI(content) {
  if (typeof content === 'string') return content
  return (content || []).map(part => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type === 'image') {
      return {
        type: 'image_url',
        image_url: {
          url: `data:${part.source.media_type};base64,${part.source.data}`,
          ...(part.detail ? { detail: part.detail } : {})
        }
      }
    }
    if (part.type === 'image_url') {
      return {
        type: 'image_url',
        image_url: part.image_url
      }
    }
    return { type: 'text', text: JSON.stringify(part) }
  })
}

// Spec 22 hotfix: an internal message shape that is a superset of what the
// Anthropic API accepts, sent unsanitized — routes/ai.js's tagger builds
// image blocks as `{ type: 'image', detail: 'low', source }`, an OpenAI-only
// concept (contentToOpenAI reads part-level `detail` and moves it into
// `image_url.detail`). The Anthropic SDK passes content blocks to
// `client.messages.create` verbatim and 400s on the unknown `detail` field.
// The identical bug already shipped once in the tool loop's image blocks
// (fixed by deleting the field at that one call site in PR #103) — fixing
// the class here instead of whack-a-moling each builder: an allowlist over
// the block shapes this codebase actually produces, applied at every
// Anthropic send site, so a stray extra field on any future builder can
// never reach the API again. `cache_control` is preserved on every block
// type — the spec-16 moving cache breakpoint depends on it surviving this
// pass.
export function toAnthropicContentBlocks(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return content
  return content.map(block => {
    if (!block || typeof block !== 'object') return block
    const cacheControl = block.cache_control ? { cache_control: block.cache_control } : {}
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text, ...cacheControl }
      case 'image':
        return { type: 'image', source: block.source, ...cacheControl }
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          ...(block.is_error !== undefined ? { is_error: block.is_error } : {}),
          content: Array.isArray(block.content) ? toAnthropicContentBlocks(block.content) : block.content,
          ...cacheControl
        }
      case 'tool_use':
        return { type: 'tool_use', id: block.id, name: block.name, input: block.input, ...cacheControl }
      default:
        return block
    }
  })
}

export function normalizeToolImage(image = null) {
  if (!image) return null
  const mime = image.mime || image.media_type
  const base64 = image.base64 || image.data
  return mime && base64 ? { mime, base64 } : null
}

export function extractToolResultImages(result) {
  if (!Array.isArray(result)) {
    return { textResult: JSON.stringify(result), images: [] }
  }

  const images = []
  const stripped = result.map(item => {
    if (!item || typeof item !== 'object') return item
    const { image, ...rest } = item
    const normalizedImage = normalizeToolImage(image)
    if (normalizedImage) {
      const flags = [item.ruleFit, item.weatherFit].filter(f => f && f !== 'neutral').join(', ')
      images.push({
        ...normalizedImage,
        label: `ID ${item.id}: ${item.name || 'unnamed garment'}${flags ? ` — ${flags}` : ''}`
      })
    }
    return rest
  })

  return { textResult: JSON.stringify(stripped), images }
}

export function parseModelJson(raw) {
  return JSON.parse(String(raw || '').trim().replace(/^```json\n?|\n?```$/g, '').trim())
}

export async function askClaude({ system = STYLIST_SYSTEM, messages, maxTokens = 1200 }) {
  const { text } = await askClaudeWithUsage({ system, messages, maxTokens })
  return text
}

export async function askClaudeWithUsage({ system = STYLIST_SYSTEM, messages, maxTokens = 1200 }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('No ANTHROPIC_API_KEY set in .env')
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const sanitizedMessages = (Array.isArray(messages) ? messages : []).map(message => ({
    ...message,
    content: toAnthropicContentBlocks(message.content)
  }))
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system: systemToAnthropicBlocks(system),
    messages: sanitizedMessages
  })
  return {
    text: response.content?.[0]?.text || '',
    usage: normalizeAiUsage(response.usage, { provider: 'anthropic', model: ANTHROPIC_MODEL })
  }
}

export function takeTestAiResponse({ system = '', messages = [], maxTokens = 1200 } = {}) {
  if (process.env.NODE_ENV !== 'test') return null
  const queue = globalThis.__WARDROBE_AI_TEST_RESPONSES__
  if (Array.isArray(queue) && queue.length) {
    const next = queue.shift()
    return typeof next === 'function' ? next({ system, messages, maxTokens }) : next
  }
  const handler = globalThis.__WARDROBE_AI_TEST_HANDLER__
  if (typeof handler === 'function') return handler({ system, messages, maxTokens })
  return null
}

// Prompt-cache breakpoint: buildStylistConversationPayload places this marker
// between the stable prompt prefix (style constitution, occasion profiles,
// wardrobe manifest) and the volatile per-turn blocks (date, turn mode, thread
// state, feedback). The Anthropic path splits here into two system blocks with
// cache_control on the stable one — the manifest then only costs full price
// when the wardrobe actually changes (and across tool-loop iterations within a
// turn). Other paths (OpenAI, test mode) just strip the marker.
export const PROMPT_CACHE_BREAKPOINT = '[[PROMPT_CACHE_BREAKPOINT]]'

export function systemToAnthropicBlocks(system) {
  const text = String(system || '')
  const markerAt = text.indexOf(PROMPT_CACHE_BREAKPOINT)
  if (markerAt === -1) return text
  const stable = text.slice(0, markerAt)
  const volatileTail = text.slice(markerAt + PROMPT_CACHE_BREAKPOINT.length)
  const blocks = [{ type: 'text', text: stable, cache_control: { type: 'ephemeral' } }]
  if (volatileTail.trim()) blocks.push({ type: 'text', text: volatileTail })
  return blocks
}

export function systemToPlainText(system) {
  return String(system || '').split(PROMPT_CACHE_BREAKPOINT).join('')
}

function stripCacheControlFromBlock(block = {}) {
  const { cache_control, ...cleaned } = block
  return cleaned
}

export function withMovingCacheBreakpoint(messages = []) {
  const cleaned = (Array.isArray(messages) ? messages : []).map(message => ({
    role: message.role,
    content: typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content)
        ? message.content.map(stripCacheControlFromBlock)
        : message.content
  }))
  if (!cleaned.length) return cleaned

  const lastIndex = cleaned.length - 1
  const last = cleaned[lastIndex]
  const blocks = typeof last.content === 'string'
    ? [{ type: 'text', text: last.content }]
    : Array.isArray(last.content)
      ? last.content.map(block => ({ ...block }))
      : []

  if (!blocks.length) return cleaned
  blocks[blocks.length - 1] = {
    ...blocks[blocks.length - 1],
    cache_control: { type: 'ephemeral' }
  }
  cleaned[lastIndex] = { ...last, content: blocks }
  return cleaned
}

export async function askStylist({ system = STYLIST_SYSTEM, messages, maxTokens = 1200 }) {
  const { text } = await askStylistWithUsage({ system, messages, maxTokens })
  return text
}

export async function askStylistWithUsage({ system = STYLIST_SYSTEM, messages, maxTokens = 1200 }) {
  const plainSystem = systemToPlainText(system)
  const testResponse = takeTestAiResponse({ system: plainSystem, messages, maxTokens })
  if (testResponse != null) {
    return {
      text: typeof testResponse === 'string' ? testResponse : JSON.stringify(testResponse),
      usage: normalizeAiUsage(testResponse?.usage || null)
    }
  }

  assertProviderKey()

  if (AI_PROVIDER === 'openai') {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: plainSystem },
        ...messages.map(m => ({ role: m.role, content: contentToOpenAI(m.content) }))
      ]
    })
    return {
      text: response.choices?.[0]?.message?.content || '',
      usage: normalizeAiUsage(response.usage, { provider: 'openai', model: OPENAI_MODEL })
    }
  }

  return askClaudeWithUsage({ system, messages, maxTokens })
}


export async function askStylistWithTools({ system, messages, maxTokens = 1500, toolContext = {} }) {
  const plainSystem = systemToPlainText(system)
  const testResponse = takeTestAiResponse({ system: plainSystem, messages, maxTokens })
  if (testResponse != null) {
    // Mirror the real loop's output checks and one-retry-per-guard semantics so
    // contract tests can exercise guard behavior end-to-end (previously this
    // short-circuit skipped the checks entirely, making every guard untestable
    // through /ask).
    let answerStr = typeof testResponse === 'string' ? testResponse : JSON.stringify(testResponse)
    const retriedChecks = new Set()
    for (let i = 0; i < 6; i++) {
      const check = applyFreeformOutputChecks(answerStr, toolContext, retriedChecks)
      if (!check.block) break
      retriedChecks.add(check.blockType)
      const retryResponse = takeTestAiResponse({
        system: plainSystem,
        messages: [...messages, { role: 'assistant', content: answerStr }, { role: 'user', content: check.correctionMessage }],
        maxTokens
      })
      if (retryResponse == null) break
      answerStr = typeof retryResponse === 'string' ? retryResponse : JSON.stringify(retryResponse)
    }
    return { answer: answerStr, savedCorrections: [] }
  }

  assertProviderKey()

  let currentMessages = [...messages]
  const savedCorrections = []
  const retriedChecks = new Set()

  // 10 iterations: the disciplined flow (declare, search, view supports, view
  // layers, propose xN) legitimately needs 6-8; the old cap of 7 left no margin
  // for a single corrective bounce and live turns died with zero cards.
  for (let iter = 0; iter < 10; iter++) {
    if (AI_PROVIDER === 'openai') {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const response = await client.chat.completions.create({
        model: OPENAI_MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: plainSystem },
          ...currentMessages.map(m => {
            const mapped = { role: m.role }
            if (m.content) {
              mapped.content = contentToOpenAI(m.content)
            }
            if (m.tool_calls) {
              mapped.tool_calls = m.tool_calls
            }
            if (m.tool_call_id) {
              mapped.tool_call_id = m.tool_call_id
            }
            if (m.name) {
              mapped.name = m.name
            }
            return mapped
          })
        ],
        tools: STYLIST_TOOLS.map(t => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema
          }
        }))
      })
      if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'production') {
        const usage = normalizeAiUsage(response.usage, { provider: 'openai', model: OPENAI_MODEL })
        console.log('[OpenAI Tool Loop Usage]', {
          iter,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadInputTokens: usage.cacheReadInputTokens,
          cacheCreationInputTokens: usage.cacheCreationInputTokens
        })
      }

      const message = response.choices?.[0]?.message
      if (!message) return { answer: '', savedCorrections }

      if (message.tool_calls && message.tool_calls.length) {
        currentMessages.push({ role: 'assistant', content: message.content || '', tool_calls: message.tool_calls })
        
        const toolOutputs = []
        const collectedImages = []
        for (const tc of message.tool_calls) {
          const name = tc.function.name
          const args = JSON.parse(tc.function.arguments || '{}')
          const result = await executeTool(name, args, toolContext)
          if (name === 'store_user_correction') {
            savedCorrections.push(args)
          }
          
          const extracted = extractToolResultImages(result)
          const toolContent = extracted.textResult
          collectedImages.push(...extracted.images)

          toolOutputs.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: name,
            content: toolContent
          })
        }
        currentMessages.push(...toolOutputs)

        if (collectedImages.length > 0) {
          const content = [
            { type: 'text', text: 'Here are the wardrobe pieces from the tool results. Judge fit, color, texture, print, and proportion by sight:' }
          ]
          for (const img of collectedImages) {
            content.push({ type: 'text', text: img.label })
            content.push({
              type: 'image_url',
              image_url: { url: `data:${img.mime};base64,${img.base64}`, detail: 'low' }
            })
          }
          currentMessages.push({ role: 'user', content })
        }
        continue
      } else {
        const finalText = message.content || ''
        const check = applyFreeformOutputChecks(finalText, toolContext, retriedChecks)
        if (check.block) {
          retriedChecks.add(check.blockType)
          currentMessages.push({ role: 'assistant', content: finalText })
          currentMessages.push({ role: 'user', content: check.correctionMessage })
          continue
        }
        return { answer: finalText, savedCorrections }
      }
    } else {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      
      const formattedMessages = withMovingCacheBreakpoint(currentMessages.map(m => {
        return { role: m.role, content: toAnthropicContentBlocks(m.content) }
      }))

      const response = await client.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        system: systemToAnthropicBlocks(system),
        messages: formattedMessages,
        tools: STYLIST_TOOLS
      })
      if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'production') {
        const usage = normalizeAiUsage(response.usage, { provider: 'anthropic', model: ANTHROPIC_MODEL })
        console.log('[Anthropic Tool Loop Usage]', {
          iter,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadInputTokens: usage.cacheReadInputTokens,
          cacheCreationInputTokens: usage.cacheCreationInputTokens
        })
      }

      if (response.stop_reason === 'tool_use') {
        const toolUses = response.content.filter(block => block.type === 'tool_use')
        currentMessages.push({ role: 'assistant', content: response.content })

        const toolResponses = []
        for (const tu of toolUses) {
          const name = tu.name
          const args = tu.input
          const result = await executeTool(name, args, toolContext)
          if (name === 'store_user_correction') {
            savedCorrections.push(args)
          }
          
          const extracted = extractToolResultImages(result)
          const contentBlocks = [{
            type: 'text',
            text: extracted.textResult
          }]
          if (extracted.images.length) {
            contentBlocks.push({
              type: 'text',
              text: 'Here are the wardrobe pieces from the tool results. Judge fit, color, texture, print, and proportion by sight.'
            })
            for (const img of extracted.images) {
              contentBlocks.push({ type: 'text', text: img.label })
              contentBlocks.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: img.mime,
                  data: img.base64
                }
              })
            }
          }

          toolResponses.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: tu.id,
                content: contentBlocks
              }
            ]
          })
        }
        currentMessages.push(...toolResponses)
        continue
      } else {
        const finalText = response.content?.[0]?.text || ''
        const check = applyFreeformOutputChecks(finalText, toolContext, retriedChecks)
        if (check.block) {
          retriedChecks.add(check.blockType)
          currentMessages.push({ role: 'assistant', content: response.content })
          currentMessages.push({ role: 'user', content: check.correctionMessage })
          continue
        }
        return { answer: finalText, savedCorrections }
      }
    }
  }

  // 2026-07-10: live testing found this generic fallback shown to Yuna even when a real outfit had
  // already been proposed this turn (propose_outfit succeeded, toolContext.generatedOutfits is
  // non-empty) — the card rendered fine independent of this return value, but the visible answer text
  // read like an internal error alongside it. If there's real content, say so plainly instead.
  if (Array.isArray(toolContext.generatedOutfits) && toolContext.generatedOutfits.length) {
    return { answer: freeformToolLoopFallbackAnswer(toolContext), savedCorrections }
  }
  return { answer: freeformToolLoopFallbackAnswer(toolContext), savedCorrections }
}
