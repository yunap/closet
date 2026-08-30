// Provider abstraction, the tool loop, and the turn-contract output guards.
// DOCUMENTED IN: docs/freeform-rearchitecture-handoff.md — every guard here exists because of a
// specific live failure recorded there. Read it before loosening or removing one.
// See AGENTS.md.
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import { prompts } from './promptRuntime.js'
import { STYLIST_TOOLS, executeTool, bumpFreeformDiagnostic, verifiedPieceIdSets, recordFreeformToolIteration, nextFreeformCallIndex } from './tools.js'
import { updateAiTelemetryContext, logAiCall } from '../lib/aiCallTelemetry.js'
import { captureNormalizedProviderInput, captureWireProviderInput } from '../lib/providerInputCapture.js'
import { unexplainedLayeredTops, exposesComposerDeliberation, exposesRawStructuredPayload } from './rules.js'
import { wardrobeCategoryGroup } from './attributes.js'
import { resolveAnthropicKey, resolveOpenAiKey, resolveGeminiKey, noKeyErrorMessage } from '../lib/apiKeys.js'
import { getCurrentUserId } from '../lib/requestContext.js'

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
// (StylistChat.jsx's parseStructuredOutfitsFromAssistantText, deleted in spec 21 Part 4) that used to
// build cards locally from plain-text outfit descriptions only matched the old pre-propose_outfit
// "### Outfit N" + "**Pieces**: A + B + C" format — STYLIST_SYSTEM has explicitly told the model NOT to
// write that format since the propose_outfit migration, so that fallback had silently stopped firing
// against current prose well before it was removed. There is no reliable local reconstruction path
// anymore. The actual fix is upstream: make the model call
// propose_outfit on the FIRST turn, every time it's describing an outfit, so there's nothing to
// reconstruct later. This hardens the existing looksLikeUnproposedOutfitProse signal (previously a
// spec-3 soft flag only) into a hard block — same "don't trust the model's self-report, verify
// mechanically" pattern as every other check in this file.
// knownPieceIds (optional): a model that skips the mandated "(ID n)" form but still writes a bare
// parenthesized number right after naming a piece — "Navy wool turtleneck (146)" — is citing just as
// unambiguously; live case (thread_1788054462046, Gemini 3.5 Flash Lite) cited 12 real, verified
// pieces this way and the mandated-form-only regex missed every one of them, silently defeating both
// the truth clause's verification check and docs/bounded-multi-context-continuity-spec.md's
// persisted-discussion tracking. Only counted when knownPieceIds is supplied AND the number is a
// member of it, so this never turns an arbitrary parenthetical number ("(2 items)", "in the 1990s",
// "$50 (on sale)") into a false citation — it has to already be a real, in-scope piece id, which
// callers are expected to pass as exactly the set they would otherwise treat as verified/known.
export function extractPieceIdsFromProse(answerText = '', { knownPieceIds = null } = {}) {
  const text = String(answerText || '')
  const matches = [...text.matchAll(/\bID\s*:?\s*(\d+)\b/gi)] // ratchet-allow: model's own reply prose, not garment matching
  const ids = matches.map(m => Number(m[1])).filter(Number.isFinite)
  if (knownPieceIds && knownPieceIds.size) {
    for (const m of text.matchAll(/\((\d+)\)/g)) { // ratchet-allow: model's own reply prose, not garment matching
      const id = Number(m[1])
      if (knownPieceIds.has(id)) ids.push(id)
    }
  }
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
export function applyFreeformOutputChecks(answerText, toolContext, retried = new Set(), { record = true } = {}) {
  const fail = (blockType, diagnostic, correctionMessage) => {
    // `record: false` is the disclosure pass below re-running the same predicates to see what is
    // STILL failing after its one retry. It must not double-count the diagnostics.
    if (record) bumpFreeformDiagnostic(toolContext, diagnostic)
    return { block: true, blockType, correctionMessage }
  }

  // ── truth ───────────────────────────────────────────────────────────────
  if (!retried.has('zeroResultContradiction')) {
    const contradiction = findZeroResultContradiction(answerText, toolContext)
    if (contradiction) {
      return fail('zeroResultContradiction', 'zeroResultContradictionBlocks',
        `You searched for "${contradiction}" and found nothing — do not describe this as a piece ${prompts.PROFILE_NAME} owns. Either offer a real alternative via search_wardrobe or say plainly that ${prompts.PROFILE_PRONOUNS.subject} ${prompts.PROFILE_PRONOUNS.does}n't have this piece.`)
    }
  }
  // A piece ID cited in prose must have been verified this turn — retrieved via
  // search/details, or part of a verified card (this turn's generated outfits or
  // the thread's current outfit set). With the wardrobe manifest in the prompt,
  // the model can name real IDs it has never actually checked; the manifest is
  // an index, not garment truth.
  if (!retried.has('unverifiedCitation')) {
    const { retrieved, known } = verifiedPieceIdSets(toolContext)
    // knownPieceIds here is deliberately the verified set itself: a bare "(146)" only ever counts
    // as a citation when 146 is already something this clause would accept as verified anyway, so
    // extending the citation format can never let an unverified id slip past this check.
    const citedIds = extractPieceIdsFromProse(answerText, { knownPieceIds: new Set([...retrieved, ...known]) })
    if (citedIds.length) {
      const unverifiedCited = citedIds.filter(id => !retrieved.has(id) && !known.has(id))
      if (unverifiedCited.length) {
        return fail('unverifiedCitation', 'unverifiedCitationBlocks',
          `You cited piece ID(s) ${unverifiedCited.join(', ')} without verifying them this turn — the wardrobe manifest is an index, not garment truth. Call view_pieces for ${unverifiedCited.map(id => `ID ${id}`).join(', ')} to confirm each piece (photo + truth line), then answer again (or drop the unverified references).`)
      }
    }
  }

  // docs/card-consistency-spec.md Part 1 — the internal-consistency clause. The other truth clauses
  // ask whether the card's pieces are real and verified; this one asks whether the card's own words
  // describe the card it is attached to. A live response proposed a blouse and a floral tank with a
  // lace midi dress and explained neither, under a label ("one-piece column") implying no top was
  // there — every existing clause passed it, because every piece was real, verified and delivered.
  //
  // Not a gate: a top with a dress stays legal (owner ruling 2026-08-16), and if the retry produces
  // no explanation the card ships with the top and a visible flag rather than losing it —
  // routes/ai.js owns that ending. Only the retry lives here.
  if (!retried.has('cardProseInconsistent')) {
    const cards = Array.isArray(toolContext?.generatedOutfits) ? toolContext.generatedOutfits : []
    for (const card of cards) {
      if (card?.broken) continue
      const unexplained = unexplainedLayeredTops(card, card?.pieces || [])
      if (!unexplained.length) continue
      const dress = (card.pieces || []).find(piece => wardrobeCategoryGroup(piece) === 'dress')
      const names = unexplained.map(piece => piece.name).join(', ')
      return fail('cardProseInconsistent', 'cardProseInconsistentBlocks',
        `Your outfit "${card.label || card.title || 'this look'}" puts ${names} together with ${dress?.name || 'a dress'}, and your explanation never mentions ${unexplained.length > 1 ? 'them' : 'it'}. Wearing a top with a dress is a real styling choice and you may absolutely make it — but say what it is doing (worn over, layered under, belted, knotted) so it does not read as a stray garment. Call propose_outfit again for that outfit with a why_it_works that accounts for ${unexplained.length > 1 ? 'those pieces' : 'that piece'}, or propose it without ${unexplained.length > 1 ? 'them' : 'it'}.`)
    }
  }

  // ── context (legacy clarification clause — retire candidate) ────────────
  // Per the proposed architecture this should become the model's own judgment
  // informed by THREAD STATE. Kept mechanical until live evidence shows the
  // prompt-level judgment holds. The sibling tripScopeClarification clause was
  // retired outright in spec 21 Part 3 (spec 18 Part 2's flag window closed on
  // owner ruling — the model repeatedly demonstrated the judgment the clause
  // distrusted, with no misfire evidence for this one to justify keeping it
  // mechanical too). This clause has no such misfire evidence and stays live.
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
  // An atomic capsule attempt deliberately degrades to accepted cards + honest
  // gaps after one composition call. Re-entering the generic delivery retries
  // here would undo that cost boundary and restart search/propose/replan.
  const boundedCompositionCompleted = Boolean(
    toolContext?.capsuleAtomicAttempted || toolContext?.atomicMultiLookCompleted
  )
  // Declared cards, delivered none, and didn't ask the user anything: the
  // turn's contract is unmet. An answer containing a question is treated as the
  // model's own clarification judgment and passes.
  const askedAQuestion = String(answerText || '').includes('?')
  if (!boundedCompositionCompleted && !retried.has('cardsNotDelivered') && declaredIntent?.want === 'cards' && readyCards === 0 && !askedAQuestion) {
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
  if (!boundedCompositionCompleted && !retried.has('outfitCount') && requestedOutfitCount && turnWantsCards && readyCards > 0 && readyCards < requestedOutfitCount) {
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
  // The ANSWER is the evidence here, not the question. There used to be a second clause --
  // `!declaredIntent && looksLikeOutfitRequest(question)` -- which read a missing declaration as a
  // skipped ceremony. That only worked while declare_intent was mandatory on every turn. It is now
  // required solely before propose_outfit/generate_outfits/render_preview, so absent declaration is
  // the normal state of an ordinary prose answer, and the old clause would have fired on exactly
  // the conversational turns this change makes cheap -- spending a retry to save a round-trip.
  // Prose that actually describes an unproposed outfit is still caught, by inspecting the prose.
  if (!boundedCompositionCompleted && !retried.has('outfitProse') && !hasPreseededOutfitCard && (toolContext?.freeformDiagnostics?.proposeCalls || 0) === 0 &&
      looksLikeUnproposedOutfitProse(answerText)) {
    const priorIds = extractPieceIdsFromProse(answerText)
    const idHint = priorIds.length
      ? ` You already referenced these exact piece IDs: ${priorIds.join(', ')} — reuse exactly these IDs and roles, do not substitute or invent different pieces.`
      : ''
    return fail('outfitProse', 'outfitProseWithoutToolCall',
      `This looked like a request for an outfit, but propose_outfit was never called this turn — the pieces must go through the tool call to render as a verified card, not a hand-written list. Call propose_outfit now with the outfit you'd suggest.${idHint}`)
  }
  return { block: false }
}

// Accepted-card authority over the closing answer.
//
// Once a card is accepted this turn, the card is the product and the prose is commentary on it. Live
// turns showed the commentary drifting from the thing it commented on: a follow-up called the
// loafers the grounding finishing piece while the card's own prose called the earrings its single
// finishing detail; a sparse composition repeated its accepted card, contradicted itself about a
// piece it had not used, and narrated each lookup on the way.
//
// This is deliberately mechanical and paragraph-level. A paragraph is dropped when it shows the
// turn's working, or when it cites a garment ID that is not on any accepted card -- the reliable
// signal for reintroducing a candidate the composition rejected. It does NOT judge whether the prose
// is good, and it does not compare wording between two prose fields: that is semantic work, and the
// owner has ruled repeatedly against growing these guards into a rules engine.
//
// Withheld, never retried. A retry costs a paid round-trip to fix commentary on a card the user can
// already see; the capsule ending applies -- deliver, and drop what cannot be trusted.
// Owner ruling, 2026-08-20: final user-facing prose shows no piece IDs. The "(ID <n>)" citation the
// prompt requires is a VERIFICATION SCAFFOLD, not product copy — it exists so the unverified-citation
// guard, the accepted-card authority and the zero-result contradiction check can all confirm the
// model is talking about garments that exist. The user should not have to read database handles.
//
// So the contract is ordered, not relaxed: IDs are required while the model reasons, every guard
// that needs them runs on the text that still has them, and this strips them at the last boundary
// before the answer is sent. Never call this before validation — that would silently disarm three
// guards at once. Structured cards keep their piece IDs, so nothing downstream loses the reference.
// knownPieceIds (optional): strips a bare-number citation like "(146)" too, when 146 matches a
// supplied known/verified piece id — same reasoning and the same live incident as
// extractPieceIdsFromProse's knownPieceIds. Without this, a model that skips the mandated "(ID n)"
// form still leaks raw database ids straight into what the user reads. Deliberately narrow: only a
// number that is ALSO a real in-scope piece id gets stripped, so an ordinary parenthetical like
// "(2 items)" or "(on sale)" is untouched.
export function stripPieceIdCitations(answerText = '', { knownPieceIds = null } = {}) {
  let text = String(answerText || '')
  if (knownPieceIds && knownPieceIds.size) {
    text = text.replace(/[ \t]*\((\d+)\)/g, (match, digits) => // ratchet-allow: model-output integrity boundary, not garment classification
      knownPieceIds.has(Number(digits)) ? '' : match)
  }
  return text
    // The mandated form, and its bracketed and plural variants: "(ID 196)", "[IDs 196, 204]".
    .replace(/[ \t]*[([]\s*IDs?\s*:?\s*\d+(?:\s*(?:,|and|&)\s*\d+)*\s*[)\]]/gi, '') // ratchet-allow: model-output integrity boundary, not garment classification
    // A bare inline citation the model wrote without brackets.
    .replace(/[ \t]*\bIDs?\s*:?\s*\d+(?:\s*(?:,|and|&)\s*\d+)*\b/g, '') // ratchet-allow: model-output integrity boundary, not garment classification
    // Tidy what removal leaves behind, without touching line structure.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    // Removing a mid-sentence citation leaves its separators behind: "the loafers, ID 196, work"
    // became "the loafers,, work". The bracketed form the prompt actually mandates never hits this,
    // but the model does sometimes cite inline.
    .replace(/,(\s*,)+/g, ',')
    .replace(/,\s*([.;:!?])/g, '$1')
    // A list item that was nothing but a citation is now an empty bullet; drop the line rather than
    // rendering a stray dash.
    .split('\n').map(line => line.replace(/[ \t]+$/, '')).filter(line => !/^\s*[-*]\s*$/.test(line)).join('\n')
    .trim()
}

export function applyAcceptedCardAuthority(answerText = '', toolContext = {}) {
  const cards = Array.isArray(toolContext?.generatedOutfits)
    ? toolContext.generatedOutfits.filter(card => !card?.broken)
    : []
  // No accepted card means the prose IS the answer and has no card to defer to.
  if (!cards.length) return String(answerText || '').trim()

  const acceptedIds = new Set(cards.flatMap(card => {
    const ids = Array.isArray(card?.pieceIds) && card.pieceIds.length
      ? card.pieceIds
      : (Array.isArray(card?.pieces) ? card.pieces.map(piece => piece?.id) : [])
    return ids.map(Number).filter(Number.isFinite)
  }))

  const paragraphs = String(answerText || '').split(/\n{2,}/).map(part => part.trim()).filter(Boolean)
  const withheld = []
  const kept = paragraphs.filter(part => {
    if (exposesComposerDeliberation(part)) { withheld.push('deliberation'); return false }
    if (exposesRawStructuredPayload(part)) { withheld.push('raw_payload'); return false }
    const outside = extractPieceIdsFromProse(part).filter(id => !acceptedIds.has(Number(id)))
    if (outside.length) { withheld.push(`ids:${outside.join(',')}`); return false }
    return true
  })
  if (!withheld.length) return paragraphs.join('\n\n')

  bumpFreeformDiagnostic(toolContext, 'closingProseWithheld', withheld.length)
  if (kept.length) return kept.join('\n\n')
  // Nothing survived. Say what was delivered rather than emitting an empty reply beside the cards --
  // the same locally-generated ending boundedAtomicMultiLookResponse uses.
  return cards.length === 1
    ? 'Here is the look, with its pieces and styling notes on the card.'
    : `Here are ${cards.length} looks, with their pieces and styling notes on each card.`
}

export function boundedAtomicMultiLookFinalAnswer(answerText = '', toolContext = {}) {
  const text = String(answerText || '').trim()
  if (!toolContext?.atomicMultiLookCompleted) return text
  const requested = Number(toolContext?.atomicMultiLookRequestedCount) || 0
  const ready = Array.isArray(toolContext?.generatedOutfits)
    ? toolContext.generatedOutfits.filter(outfit => !outfit?.broken).length
    : 0
  if (!requested || ready >= requested) return text
  const note = `${ready} of ${requested} requested ${requested === 1 ? 'outfit' : 'outfits'} ${ready === 1 ? 'is' : 'are'} ready; the remaining ${requested - ready} could not be validated from this wardrobe in the bounded composition pass.`
  return `${text}\n\n${note}`.trim()
}

export function boundedAtomicMultiLookResponse(toolContext = {}) {
  const ready = Array.isArray(toolContext?.generatedOutfits)
    ? toolContext.generatedOutfits.filter(outfit => !outfit?.broken).length
    : 0
  const requested = Number(toolContext?.atomicMultiLookRequestedCount) || ready
  const temperature = String(toolContext?.boundedWeatherSummary || '').trim()
  const location = String(toolContext?.boundedLocation || '').trim()
  const context = [temperature, location].filter(Boolean).join(' in ')
  const unavailableWeather = Boolean(toolContext?.boundedWeatherUnavailable)
  const directionPhrase = ready === 1
    ? 'this direction'
    : (ready === 2 ? 'these two directions' : `these ${ready} directions`)
  const base = ready
    ? unavailableWeather
      ? `I couldn’t verify the forecast${location ? ` for ${location}` : ''}, so these options avoid assuming hot or cold weather; check the temperature before choosing.`
      : context
      ? ready === 1 ? `For ${context}, I’d start with ${directionPhrase}.` : `For ${context}, I’d compare ${directionPhrase}.`
      : ready === 1 ? "I’d start with this direction." : `I’d compare ${directionPhrase}.`
    : 'I could not validate a complete outfit from the available wardrobe for this request.'
  return boundedAtomicMultiLookFinalAnswer(base, {
    ...toolContext,
    atomicMultiLookRequestedCount: requested
  })
}

export function boundedCapsuleFinalAnswer(answerText = '', toolContext = {}) {
  const outfits = Array.isArray(toolContext?.generatedOutfits)
    ? toolContext.generatedOutfits.filter(outfit => !outfit?.broken)
    : []
  if (!toolContext?.capsuleAtomicAttempted || !toolContext?.capsuleAtomicCompleted || !outfits.length) {
    return { answer: String(answerText || ''), replaced: false, reasons: [] }
  }

  const acceptedPieceIds = new Set(outfits.flatMap(outfit =>
    (outfit?.pieces || []).map(piece => Number(piece?.id)).filter(Number.isFinite)
  ))
  // A capsule response may discuss any selected garment, including pieces the
  // representative outfit cards did not happen to demonstrate. The previous
  // guard treated those valid roster IDs as invented outfits and replaced the
  // whole closing response with stale outfit-only copy.
  for (const outfit of outfits) {
    for (const id of outfit?.capsulePlanContext?.roster_ids || []) {
      const numericId = Number(id)
      if (Number.isFinite(numericId)) acceptedPieceIds.add(numericId)
    }
  }
  const outsideCardIds = extractPieceIdsFromProse(answerText)
    .filter(id => !acceptedPieceIds.has(Number(id)))
  const text = String(answerText || '')
  const reasons = []
  if (outsideCardIds.length) reasons.push(`piece IDs outside accepted cards: ${outsideCardIds.join(', ')}`)
  if (/\b(?:engine|outfit|look|card|rotation)\b.{0,24}\b(?:ceiling|cap|limit)\b/i.test(text)) { // ratchet-allow: final-response contract language, not garment matching
    reasons.push('unsupported engine-cap claim')
  }
  // Narrowed 2026-07-28. The original pattern fired on the bare words
  // "another/second … look/option", which is ordinary English for explaining a
  // rejection — offline it replaced "I couldn't land a second option that
  // worked with walking shoes", i.e. exactly the honest disclosure the tool
  // message asks for. What actually makes prose an unvalidated ADDITION is a
  // garment: a piece ID, or a "wear X with Y" instruction. Require one.
  const proposesAGarment = outsideCardIds.length > 0 ||
    /\b(?:pair|wear|swap|style|combine)\b.{0,40}\bwith\b/i.test(text) // ratchet-allow: final-response contract language, not garment matching
  if (proposesAGarment &&
      (/\b(?:second|another|additional|extra|alternate|alternative)\b.{0,48}\b(?:option|look|outfit|combination)\b/i.test(text) || // ratchet-allow: final-response contract language, not garment matching
       /\b(?:option|alternative)\s*:\s*(?:your|the|pair|wear|combine)\b/i.test(text))) { // ratchet-allow: final-response contract language, not garment matching
    reasons.push('unvalidated prose outfit addition')
  }
  if (!reasons.length) return { answer: text, replaced: false, reasons: [] }

  bumpFreeformDiagnostic(toolContext, 'capsuleFinalFallbacks')
  // Log what was replaced and why. The first live firing of this guard could
  // not be diagnosed at all: it incremented a counter, discarded the model's
  // prose, and recorded neither the reasons nor the original — so there was no
  // way to tell a correct catch from a false positive. Replacing text without
  // keeping it is not a decision anyone can review later.
  console.log('[Capsule Final Answer Replaced]', { reasons, original: text })
  toolContext.capsuleFinalFallbackDetail = { reasons, original: text }
  // The visual capsule and example cards already carry the result. Do not add
  // a second, layout-dependent paragraph claiming cards are "below" or that
  // they are the complete capsule. Preserve only a real shortfall disclosure.
  const shortfall = toolContext?.capsuleShortfall
  return {
    answer: Number(shortfall?.missing) > 0
      ? `${shortfall.missing} of the ${shortfall.planned} planned example looks did not pass this capsule's rules and are not shown; the details are in Stylist's notes.`
      : '',
    replaced: true,
    reasons
  }
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
  if (code === 'no_api_key') {
    return { status: 400, code: 'no_api_key', message: err.message }
  }
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
// docs/tagger-cost-spec.md §6b/§6c: adopted for standard add/edit/retag tagging after a
// cold-start + warm-anchored screen found no material regression vs ANTHROPIC_MODEL. Import
// tagging (routes/importer.js) deliberately stays on ANTHROPIC_MODEL — that distribution
// (crops, fallback-to-full-photo) was never tested and is explicitly the open gap in that spec.
export const ANTHROPIC_TAGGER_MODEL = process.env.ANTHROPIC_TAGGER_MODEL || 'claude-haiku-4-5'

// Gemini evaluation slice (docs: scratch/gemini_tool_loop_spike_findings.md). Deliberately not
// wired into AI_PROVIDER/ACTIVE_STYLIST_MODEL — those stay Anthropic/OpenAI-binary exactly as
// before. GEMINI_MODEL and the key are read directly from env: this is an experimental,
// debug-only path, not a persisted provider choice (no lib/apiKeys.js entry, no BYOK UI).
export const GEMINI_MODEL = process.env.GEMINI_STYLIST_MODEL || 'gemini-3.7-flash'
// Stage C latency finding (2026-08-27): a real tool-loop comparison run left generation_config's
// thinking_level unset and hit a single call that took 314s wall-clock while billing only 50 output
// tokens total (thought+text) — confirmed via `lsof` to be a genuine open connection to Google's
// servers, not a client-side retry loop (the SDK's own retry backoff caps at 30s). Explicitly
// pinning 'low' here isolates that variable for the comparison; 'medium'/'high' remain worth
// benchmarking separately once a 'low' baseline exists (plan §8: begin at medium for the stylist,
// benchmark low for cheap/router tasks — this override deliberately inverts that for Stage C only,
// to find out whether the unset default itself is the latency driver before trusting any number
// run against it).
const GEMINI_THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL || 'low'

// resolveGeminiKey (real per-user BYOK resolution, plan Stage D) is imported from lib/apiKeys.js
// above — it used to be a standalone `process.env.GEMINI_API_KEY` read here, kept only for the
// experimental slice before real key management existed for this provider. Re-exported for
// scratch-script callers that imported it from this module directly (e.g.
// scratch/gemini_image_resolution_diagnostic.js).
export { resolveGeminiKey }

// resolveAiTarget: the ONLY sanctioned way to run a call through Gemini. `override` is passed
// explicitly by comparison-run scripts (scratch/gemini_comparison_runs.js) and the Stage-0 spike —
// never sourced from a route, session, or UI. With no override, every existing call site resolves
// exactly as before (AI_PROVIDER/ACTIVE_STYLIST_MODEL), so this is a no-op addition until a caller
// opts in on purpose.
export function resolveAiTarget(override = null) {
  if (override?.provider === 'gemini') {
    return { provider: 'gemini', model: override.model || GEMINI_MODEL }
  }
  if (override?.provider === 'openai') {
    return { provider: 'openai', model: override.model || OPENAI_MODEL }
  }
  if (override?.provider === 'anthropic') {
    return { provider: 'anthropic', model: override.model || ANTHROPIC_MODEL }
  }
  return { provider: AI_PROVIDER, model: ACTIVE_STYLIST_MODEL }
}

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

// Gemini Developer API introductory Standard pricing, current through 2026-12-31 (Stage-1 census,
// verified against ai.google.dev/gemini-api/docs/pricing on 2026-08-27). cacheRead covers Gemini's
// implicit-caching reported cached-token count; there is no cacheWrite5m equivalent (implicit
// caching has no separate write charge the way Anthropic's does).
const GEMINI_PRICING_PER_MILLION = [
  { match: /^gemini-3\.7-flash(?:-|$)/i, input: 0.75, cacheRead: 0.075, output: 3.75 },
  // -lite entries MUST precede the bare 3.5-flash pattern below — Array.find takes the first
  // match, and "gemini-3.5-flash-lite" also satisfies /^gemini-3\.5-flash(?:-|$)/i (the "-lite"
  // suffix starts with "-"), so ordering the other way silently mispriced every -lite call.
  { match: /^gemini-3\.5-flash-lite(?:-|$)/i, input: 0.30, cacheRead: 0.03, output: 2.50 },
  { match: /^gemini-3\.1-flash-lite(?:-|$)/i, input: 0.25, cacheRead: 0.025, output: 1.50 },
  // Verified 2026-08-27 against ai.google.dev/gemini-api/docs/pricing — notably priced ABOVE
  // 3.7-flash despite the lower version number; Google's Flash naming doesn't track a monotonic
  // price ladder. Real ladder (input/output per M): flash-lite ($0.30/$2.50) < 3.7-flash
  // ($0.75/$3.75) < 3.5-flash ($1.50/$9.00) < Sonnet ($3/$15).
  { match: /^gemini-3\.5-flash(?:-|$)/i, input: 1.50, cacheRead: 0.15, output: 9.00 },
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
  const table = provider === 'openai'
    ? OPENAI_PRICING_PER_MILLION
    : provider === 'gemini'
      ? GEMINI_PRICING_PER_MILLION
      : ANTHROPIC_PRICING_PER_MILLION
  return table.find(entry => entry.match.test(model)) || null
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

// Normalizes each provider's own finish-reason vocabulary (Anthropic's `stop_reason`,
// OpenAI's `finish_reason`) into one fact callers can trust without knowing which
// provider answered: did the response get cut off by the token cap? This is the
// provider's own authoritative signal — the one place that knows for certain, so
// callers no longer need to infer truncation by inspecting response text.
function normalizeStopReason(rawStopReason, provider) {
  if (!rawStopReason) return null
  if (provider === 'openai') return rawStopReason === 'length' ? 'max_tokens' : rawStopReason
  // Gemini's Interactions API truncation signal was not exercised by the Stage-0 spike (it never
  // hit the token cap) — 'MAX_TOKENS'/'max_tokens' is the value used by Gemini's other APIs and is
  // mapped defensively here; confirm against a real truncated response before trusting this in
  // Stage C, and see the corresponding TODO in the adapter test.
  if (provider === 'gemini') return /max_tokens/i.test(String(rawStopReason)) ? 'max_tokens' : rawStopReason
  return rawStopReason
}

export function normalizeAiUsage(rawUsage = null, { provider = AI_PROVIDER, model = ACTIVE_STYLIST_MODEL, stopReason = null } = {}) {
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
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
      stopReason: normalizeStopReason(stopReason, provider),
      raw: rawUsage
    }
  }
  if (provider === 'gemini') {
    // Field names confirmed against a real Interactions API response in the Stage-0 spike
    // (scratch/gemini_tool_loop_spike_findings.md): total_input_tokens INCLUDES cached tokens
    // (OpenAI-style convention, not Anthropic's), so cacheReadInputTokens is subtracted in
    // estimateAiUsageCost rather than added on top. total_thought_tokens is billed as part of
    // output per Gemini's pricing docs, so it is folded into outputTokens rather than tracked
    // separately — Closet's usage contract has no dedicated reasoning-token field today.
    const inputTokens = numberOrZero(rawUsage.total_input_tokens)
    const outputTokens = numberOrZero(rawUsage.total_output_tokens) + numberOrZero(rawUsage.total_thought_tokens)
    const cacheReadInputTokens = numberOrZero(rawUsage.total_cached_tokens)
    return {
      provider,
      model,
      inputTokens,
      outputTokens,
      totalTokens: numberOrZero(rawUsage.total_tokens) || inputTokens + outputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens: 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
      stopReason: normalizeStopReason(stopReason, provider),
      raw: rawUsage
    }
  }
  const inputTokens = numberOrZero(rawUsage.input_tokens)
  const outputTokens = numberOrZero(rawUsage.output_tokens)
  const cacheCreationInputTokens = numberOrZero(rawUsage.cache_creation_input_tokens)
  const cacheReadInputTokens = numberOrZero(rawUsage.cache_read_input_tokens)
  // Anthropic reports cache-creation tokens split by TTL bucket (it does not split cache-READ
  // tokens this way — a read is one number for however much of the whole tools+system+messages
  // prefix matched). Exploited for cache attribution: `ephemeral_1h_input_tokens` writes can only
  // come from the freeform stable-system breakpoint (systemToAnthropicBlocks is the only ttl:'1h'
  // cache_control in this codebase), so any nonzero value here is unambiguously that cache, never
  // the moving-message breakpoint or a one-shot composer's image-manifest breakpoint (both default
  // 5m). See docs/deferred-conversational-cache-spec.md and the cache-attribution instrumentation
  // in tools.js (recordNestedFreeformUsage) / provider.js (recordToolLoopUsage).
  const cacheCreation5mInputTokens = numberOrZero(rawUsage.cache_creation?.ephemeral_5m_input_tokens)
  const cacheCreation1hInputTokens = numberOrZero(rawUsage.cache_creation?.ephemeral_1h_input_tokens)
  return {
    provider,
    model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    cacheCreation5mInputTokens,
    cacheCreation1hInputTokens,
    stopReason: normalizeStopReason(stopReason, provider),
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
  // OpenAI prompt_tokens and Gemini total_input_tokens both include cached tokens (confirmed for
  // Gemini in the Stage-0 spike: total_input_tokens ~= total_cached_tokens + genuinely-new input);
  // Anthropic input_tokens is the uncached remainder and reports cache reads/creation separately.
  const billableInputTokens = usage.provider === 'openai' || usage.provider === 'gemini'
    ? Math.max(0, numberOrZero(usage.inputTokens) - numberOrZero(usage.cacheReadInputTokens))
    : numberOrZero(usage.inputTokens)
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

export function assertProviderKey(target = null) {
  // Test fixtures use takeTestAiResponse before reaching this boundary. If a test accidentally
  // misses its mock, never fall through to a real operator/BYOK credential merely because dotenv
  // loaded one. An explicit opt-in exists for a deliberately commissioned provider integration
  // test; the ordinary suite never sets it.
  if (process.env.NODE_ENV === 'test' && process.env.WARDROBE_ALLOW_TEST_PROVIDER_NETWORK !== 'true') {
    const err = new Error('Provider network calls are disabled under NODE_ENV=test.')
    err.code = 'no_api_key'
    throw err
  }
  const provider = target?.provider || AI_PROVIDER
  if (provider === 'gemini' && !resolveGeminiKey()) {
    const err = new Error('No Gemini API key available — set GEMINI_API_KEY (experimental path, no BYOK yet).')
    err.code = 'no_api_key'
    throw err
  }
  if (provider === 'openai' && !resolveOpenAiKey()) {
    const err = new Error(noKeyErrorMessage('openai'))
    err.code = 'no_api_key'
    throw err
  }
  if (provider === 'anthropic' && !resolveAnthropicKey()) {
    const err = new Error(noKeyErrorMessage('anthropic'))
    err.code = 'no_api_key'
    throw err
  }
}

export async function prepareImageForClaude(filePath) {
  const sharp = (await import('sharp')).default
  const buffer = await sharp(filePath)
    .rotate()
    .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()
  return { base64: buffer.toString('base64'), mime: 'image/jpeg' }
}

// key: `${userId}:${pieceId}:${filename}:${maxPx}` -> { media_type, data }. The userId
// prefix is defense-in-depth, not a fix for an observed leak — piece ids restart at 1 for
// every fresh per-user db, and while the caller-supplied cacheKey already includes the
// upload filename (which carries enough entropy, Date.now()+random, that a genuine
// cross-user collision is practically negligible), this cache is shared module-wide
// across every concurrent request, so it shouldn't rely on filename entropy alone to stay
// scoped to the right tenant.
const wardrobeThumbCache = new Map()

export async function prepareWardrobeThumb(filePath, cacheKey, { maxPx = 448 } = {}) {
  const normalizedMaxPx = Math.max(1, Math.min(1568, Number(maxPx) || 448))
  const cacheKeyWithSize = cacheKey ? `${getCurrentUserId()}:${cacheKey}:${normalizedMaxPx}` : ''
  if (cacheKeyWithSize && wardrobeThumbCache.has(cacheKeyWithSize)) return wardrobeThumbCache.get(cacheKeyWithSize)
  const sharp = (await import('sharp')).default
  const buffer = await sharp(filePath)
    .rotate()
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

export function stylistToolsForTurn(toolContext = {}) {
  if (toolContext?.capsuleAtomicCompleted) return []
  if (toolContext?.slotSwapCompleted) return []
  // docs/freeform-bounded-execution-spec.md phase 1. The visual composer already returned the
  // complete bounded batch; the outer model gets one prose-only closing turn and cannot restart
  // search or rebuild the same cards serially.
  if (toolContext?.atomicMultiLookCompleted) return []
  const allowedNames = Array.isArray(toolContext?.allowedToolNames)
    ? new Set(toolContext.allowedToolNames)
    : null
  // docs/freeform-prompt-cache-levers.md lever 1. Tool SCHEMAS are byte-identical across turn modes.
  //
  // This used to append a bounded-multi-look exception to declare_intent and generate_outfits, but
  // only for new_request. Anthropic's cached prefix is ordered tools -> system -> messages, so the
  // breakpoint on the system block covers the tools ahead of it: a byte that varies in a tool
  // description invalidates the WHOLE prefix, not just the tools. Measured, that amendment moved
  // 97.8% of a 31,259-character block, so a thread going from a new request to a follow-up threw
  // away roughly 35k tokens of otherwise-warm prefix.
  //
  // It was a prompt-ownership violation too: per-turn mode behaviour belongs to the volatile
  // controller (freeformToolRoutingInstruction), which sits below the breakpoint and already varies
  // per turn, so saying it there costs nothing in reuse. Do not put request-mode policy back here.
  //
  // Returning FEWER tools above is a different thing and stays: which tools are offered is a
  // deliberate turn-ending boundary, not per-request policy inside a schema.
  return allowedNames
    ? STYLIST_TOOLS.filter(tool => allowedNames.has(tool.name))
    : STYLIST_TOOLS
}

// Spec 26 Part 7: "SyntaxError: Unterminated string in JSON at position N"
// used to read identically whether the model wrote malformed JSON or the
// response simply hit maxTokens mid-string — the tagger's actual cause
// ("the schema doesn't fit in the token budget") was indistinguishable from
// "the model wrote bad JSON" in every error log. A response that hits the
// cap always stops mid-token, so it can never end on a closing `}`/`]`
// (after stripping the code-fence wrapper) — a cheap, reliable signal that
// doesn't require guessing at exact token counts.
// Extract the FIRST balanced JSON value from model text, string-aware. Live-found
// failure mode: a model returns a short, COMPLETE JSON object and then keeps narrating
// (or narrates BEFORE it, e.g. "I need to ...") — whole-string parsing rejects both as
// invalid rather than pulling out the JSON that's actually there.
export function salvageFirstJson(raw) {
  const text = String(raw || '')
  const start = text.search(/[{[]/)
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{' || ch === '[') depth++
    if (ch === '}' || ch === ']') depth--
    if (depth === 0 && i > start) {
      try { return JSON.parse(text.slice(start, i + 1)) } catch { return null }
    }
  }
  return null
}

// `stopReason` is the provider's own authoritative finish-reason (from normalizeAiUsage) —
// when it says 'max_tokens', trust that over the string-ending heuristic below, which exists
// only for callers that can't supply it (e.g. mocked test responses).
export function parseModelJson(raw, { context = '', maxTokens = null, stopReason = null } = {}) {
  const cleaned = String(raw || '').trim().replace(/^```json\n?|\n?```$/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch (err) {
    const looksTruncated = stopReason === 'max_tokens' || (cleaned.length > 0 && !/[}\]]$/.test(cleaned))
    if (looksTruncated) {
      const capNote = maxTokens ? ` (maxTokens: ${maxTokens})` : ''
      const truncationError = new Error(`Model response hit the token cap${capNote} and was truncated before valid JSON completed${context ? ` [${context}]` : ''}: ${err.message}`)
      truncationError.isTruncation = true
      truncationError.cause = err
      throw truncationError
    }
    // Not truncated — the model may have written valid JSON preceded/followed by narration
    // ("I need to look more closely...\n\n{...}"). Recover it before giving up, the way every
    // caller previously had to remember to do for themselves via salvageFirstJson.
    const salvaged = salvageFirstJson(cleaned)
    if (salvaged !== null) return salvaged
    throw err
  }
}

export async function askClaude({ system = prompts.STYLIST_SYSTEM, messages, maxTokens = 1200 }) {
  const { text } = await askClaudeWithUsage({ system, messages, maxTokens })
  return text
}

export async function askClaudeWithUsage({ system = prompts.STYLIST_SYSTEM, messages, maxTokens = 1200, model = null }) {
  // Spec 31: an explicit per-call model override (the importer's cheap classification tier).
  const resolvedModel = model || ANTHROPIC_MODEL
  const anthropicKey = resolveAnthropicKey()
  if (!anthropicKey) {
    const err = new Error(noKeyErrorMessage('anthropic'))
    err.code = 'no_api_key'
    throw err
  }
  const client = new Anthropic({ apiKey: anthropicKey })
  const sanitizedMessages = (Array.isArray(messages) ? messages : []).map(message => ({
    ...message,
    content: toAnthropicContentBlocks(message.content)
  }))
  const response = await client.messages.create({
    model: resolvedModel,
    max_tokens: maxTokens,
    system: systemToAnthropicBlocks(system),
    messages: sanitizedMessages
  })
  return {
    text: response.content?.[0]?.text || '',
    usage: normalizeAiUsage(response.usage, { provider: 'anthropic', model: resolvedModel, stopReason: response.stop_reason })
  }
}

// Sandbox dev flag: when set, every stylist call short-circuits to canned
// responses via the same hook the test suite uses (see takeTestAiResponse
// below), so a dev sandbox can be UI-tested in a browser with no billed
// provider calls. Never set in production; wardrobe-api's launch config
// deliberately omits it.
export function mockAiEnabled() {
  return String(process.env.WARDROBE_MOCK_AI || 'false').toLowerCase() === 'true'
}

export function takeTestAiResponse({ system = '', messages = [], maxTokens = 1200 } = {}) {
  if (process.env.NODE_ENV !== 'test' && !mockAiEnabled()) return null
  const queue = globalThis.__WARDROBE_AI_TEST_RESPONSES__
  if (Array.isArray(queue) && queue.length) {
    const next = queue.shift()
    return typeof next === 'function' ? next({ system, messages, maxTokens }) : next
  }
  const handler = globalThis.__WARDROBE_AI_TEST_HANDLER__
  if (typeof handler === 'function') return handler({ system, messages, maxTokens })
  // Belt-and-suspenders: if the mock flag is on but no handler got installed
  // (e.g. mockAiHandler.js failed to load), still never fall through to a
  // real, billed provider call.
  if (mockAiEnabled()) return 'Mock stylist answer (WARDROBE_MOCK_AI is on, no billed AI call was made).'
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
  // docs' cache-efficiency investigation (2026-08-21): this block (tools + wardrobe manifest +
  // occasion profiles + style constitution) only changes when the wardrobe itself changes, so it
  // sits idle across an ordinary chat cadence (5-20+ minutes between turns) far more often than it
  // sits within the default 5-minute ephemeral window — every such gap forces a full 1.25x rewrite
  // instead of a 0.1x read. The 1-hour TTL trades a one-time 2x (vs 1.25x) write for a 0.1x read on
  // every turn that lands inside the hour, which pays for itself after a single avoided rewrite.
  // Anthropic requires a longer-TTL breakpoint to precede any shorter one in the same request; this
  // block already precedes the moving message-tail breakpoint below (withMovingCacheBreakpoint),
  // which deliberately stays on the default 5-minute TTL — that tail changes every iteration within
  // a turn, so a longer TTL there would not be read back before the turn itself already moved past it.
  const blocks = [{ type: 'text', text: stable, cache_control: { type: 'ephemeral', ttl: '1h' } }]
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

export async function askStylist({ system = prompts.STYLIST_SYSTEM, messages, maxTokens = 1200, providerOverride = null }) {
  const { text } = await askStylistWithUsage({ system, messages, maxTokens, providerOverride })
  return text
}

// providerOverride (plan §4): only ever set by a comparison-run script or the Stage-0 spike,
// never by a route/session/UI. Absent, resolves to today's AI_PROVIDER exactly as before.
export async function askStylistWithUsage({ system = prompts.STYLIST_SYSTEM, messages, maxTokens = 1200, model = null, providerOverride = null }) {
  const plainSystem = systemToPlainText(system)
  const testResponse = takeTestAiResponse({ system: plainSystem, messages, maxTokens })
  if (testResponse != null) {
    return {
      text: typeof testResponse === 'string' ? testResponse : JSON.stringify(testResponse),
      usage: normalizeAiUsage(testResponse?.usage || null)
    }
  }

  const target = resolveAiTarget(providerOverride)
  assertProviderKey(target)
  captureNormalizedProviderInput({ provider: target.provider, model: target.model, subflow: 'ask_stylist_with_usage', system, messages, tools: [] })

  if (target.provider === 'gemini') {
    const ai = new GoogleGenAI({ apiKey: resolveGeminiKey() })
    const startedAt = Date.now()
    let interaction
    try {
      interaction = await ai.interactions.create({
        model: target.model,
        system_instruction: plainSystem,
        input: (Array.isArray(messages) ? messages : []).flatMap(m => canonicalContentToGeminiParts(m.content)),
        generation_config: { max_output_tokens: maxTokens, thinking_level: GEMINI_THINKING_LEVEL },
      })
    } catch (err) {
      await logAiCall({ provider: 'gemini', model: target.model, callKind: 'text', success: false, errorMessage: err?.message || String(err), latencyMs: Date.now() - startedAt, isMock: false })
      throw err
    }
    const latencyMs = Date.now() - startedAt
    const text = (interaction.steps || [])
      .filter(s => s.type === 'model_output')
      .map(o => (o.content || []).filter(c => c.type === 'text').map(c => c.text).join(''))
      .join('\n\n').trim() || String(interaction.output_text || '').trim()
    const usage = normalizeAiUsage(interaction.usage, { provider: 'gemini', model: target.model, stopReason: null })
    await logAiCall({ provider: 'gemini', model: target.model, callKind: 'text', usage, success: true, latencyMs, isMock: false, context: geminiModalityContext(interaction) })
    return { text, usage }
  }

  if (target.provider === 'openai') {
    const client = new OpenAI({ apiKey: resolveOpenAiKey() })
    const response = await client.chat.completions.create({
      model: target.model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: plainSystem },
        ...messages.map(m => ({ role: m.role, content: contentToOpenAI(m.content) }))
      ]
    })
    return {
      text: response.choices?.[0]?.message?.content || '',
      usage: normalizeAiUsage(response.usage, { provider: 'openai', model: target.model, stopReason: response.choices?.[0]?.finish_reason })
    }
  }

  return askClaudeWithUsage({ system, messages, maxTokens, model })
}

// One provider call with a provider-enforced object schema. Use this for small deterministic
// composition payloads where free-text narration is not a valid response and a corrective retry
// would be wasteful. Anthropic is forced through one named tool; OpenAI uses strict json_schema.
export async function askStylistStructuredWithUsage({
  system = prompts.STYLIST_SYSTEM,
  messages,
  schema,
  name = 'structured_response',
  description = 'Return the requested structured response.',
  maxTokens = 1200,
  model = null,
  providerOverride = null
}) {
  const plainSystem = systemToPlainText(system)
  const testResponse = takeTestAiResponse({ system: plainSystem, messages, maxTokens })
  if (testResponse != null) {
    const usage = normalizeAiUsage(testResponse?.usage || null)
    try {
      const rawTestText = typeof testResponse?.__rawText === 'string' ? testResponse.__rawText : null
      const value = typeof testResponse === 'string' || rawTestText !== null
        ? parseModelJson(rawTestText ?? testResponse, { context: name, maxTokens })
        : testResponse
      return { value, usage }
    } catch (err) {
      err.usage = usage
      throw err
    }
  }

  const target = resolveAiTarget(providerOverride)
  assertProviderKey(target)
  captureNormalizedProviderInput({ provider: target.provider, model: target.model, subflow: 'execution_router', system, messages, tools: [] })

  if (target.provider === 'gemini') {
    const ai = new GoogleGenAI({ apiKey: resolveGeminiKey() })
    const startedAt = Date.now()
    let interaction
    try {
      interaction = await ai.interactions.create({
        model: target.model,
        system_instruction: plainSystem,
        input: (Array.isArray(messages) ? messages : []).flatMap(m => canonicalContentToGeminiParts(m.content)),
        generation_config: { max_output_tokens: maxTokens, thinking_level: GEMINI_THINKING_LEVEL },
        // Gemini's JSON-Schema subset does not necessarily accept every construct Closet's
        // schemas use (e.g. FREEFORM_EXECUTION_ROUTE_SCHEMA's plain enums are fine; a schema using
        // oneOf, like search_wardrobe's tool input, might not be) — no shadow schema, no silent
        // simplification: if a real schema fails here, that is Stage C's problem to diagnose and
        // is intentionally NOT worked around in this experimental slice (plan: don't widen scope).
        response_format: { type: 'json_object', name, description, schema },
      })
    } catch (err) {
      await logAiCall({ provider: 'gemini', model: target.model, callKind: 'structured', success: false, errorMessage: err?.message || String(err), latencyMs: Date.now() - startedAt, isMock: false })
      throw err
    }
    const latencyMs = Date.now() - startedAt
    const text = (interaction.steps || [])
      .filter(s => s.type === 'model_output')
      .map(o => (o.content || []).filter(c => c.type === 'text').map(c => c.text).join(''))
      .join('\n\n').trim() || String(interaction.output_text || '').trim()
    const usage = normalizeAiUsage(interaction.usage, { provider: 'gemini', model: target.model, stopReason: null })
    await logAiCall({ provider: 'gemini', model: target.model, callKind: 'structured', usage, success: true, latencyMs, isMock: false, context: geminiModalityContext(interaction) })
    try {
      return { value: parseModelJson(text, { context: name, maxTokens, stopReason: usage?.stopReason }), usage }
    } catch (err) {
      err.usage = usage
      throw err
    }
  }

  if (target.provider === 'openai') {
    const client = new OpenAI({ apiKey: resolveOpenAiKey() })
    const response = await client.chat.completions.create({
      model: target.model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: plainSystem },
        ...messages.map(message => ({ role: message.role, content: contentToOpenAI(message.content) }))
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name, strict: true, schema }
      }
    })
    const text = response.choices?.[0]?.message?.content || ''
    const stopReason = response.choices?.[0]?.finish_reason
    const usage = normalizeAiUsage(response.usage, { provider: 'openai', model: target.model, stopReason })
    try {
      return { value: parseModelJson(text, { context: name, maxTokens, stopReason: usage?.stopReason }), usage }
    } catch (err) {
      err.usage = usage
      throw err
    }
  }

  const resolvedModel = model || ANTHROPIC_MODEL
  const client = new Anthropic({ apiKey: resolveAnthropicKey() })
  const response = await client.messages.create({
    model: resolvedModel,
    max_tokens: maxTokens,
    system: systemToAnthropicBlocks(system),
    messages: (Array.isArray(messages) ? messages : []).map(message => ({
      ...message,
      content: toAnthropicContentBlocks(message.content)
    })),
    tools: [{ name, description, input_schema: schema }],
    tool_choice: { type: 'tool', name }
  })
  const toolUse = response.content?.find(block => block?.type === 'tool_use' && block?.name === name)
  const usage = normalizeAiUsage(response.usage, { provider: 'anthropic', model: resolvedModel, stopReason: response.stop_reason })
  // A tool_use block that hit max_tokens mid-generation can still have a complete-looking,
  // valid `input` object — just missing whatever fields the model hadn't reached yet (e.g. an
  // empty `outfits` array instead of the requested count). The !toolUse?.input check alone
  // missed that shape and let a genuine token-cap truncation read as "the model returned
  // nothing" (thread_1787717774384's capsule composition). Trust the provider's own stop_reason
  // here exactly as parseModelJson already does for the plain-JSON path (see core.js).
  if (!toolUse?.input || typeof toolUse.input !== 'object' || usage?.stopReason === 'max_tokens') {
    const capNote = usage?.stopReason === 'max_tokens' ? ` (hit the token cap, maxTokens: ${maxTokens})` : ''
    const err = new Error(`Model did not return the required ${name} structured response${capNote}.`)
    if (usage?.stopReason === 'max_tokens') err.isTruncation = true
    err.usage = usage
    throw err
  }
  return { value: toolUse.input, usage }
}

export const FREEFORM_EXECUTION_ROUTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['profile', 'occasion', 'activity', 'season', 'mood', 'mission', 'limit', 'location', 'date', 'subject'],
  properties: {
    profile: { type: 'string', enum: ['bounded_multi', 'existing_card_explanation', 'garment_fact', 'general_advice', 'wardrobe_inventory', 'full_stylist'] },
    occasion: { type: 'string', enum: ['casual', 'city', 'smart casual', 'outdoor_daytime_social', 'evening', 'gallery / art event', 'travel', 'concert'] },
    activity: { type: 'string', enum: ['none', 'walking', 'hiking'] },
    season: { type: 'string' },
    mood: { type: 'string' },
    mission: { type: 'string', enum: ['mix', 'capsule', 'wildcard'] },
    limit: { type: 'integer', minimum: 0, maximum: 5 },
    location: { type: 'string' },
    date: { type: 'string' },
    subject: { type: 'string' },
  }
}

const FREEFORM_EXECUTION_ROUTER_SYSTEM = `Classify one wardrobe-stylist request into an execution profile. You do not see the wardrobe and must not give styling advice.

Choose bounded_multi ONLY when the user wants 2–5 fresh complete outfit options sharing one occasion, activity, location, date, and weather context. An ordinary "what should I wear?" means 2. An explicit count 2–5 wins.

Choose existing_card_explanation only when compact context says a verified current outfit set exists and the user asks why, compares those options, or clarifies them WITHOUT changing, adding, replacing, rendering, or restyling pieces.

Choose garment_fact only when compact context says an active/verified garment subject exists and the user asks about that garment's construction, wear mechanics, warmth, suitability, or a comparison among supplied subjects. When compact context also says saved garment photographs are available, use garment_fact for judging the visibly shown result of a wear-mechanics configuration such as a tuck; the saved photos will be supplied to the answer model. Do not use it to build an outfit or discover other pieces.

Choose general_advice only for general styling education that does not claim to inspect, select, compare, or discuss the user's owned garments: definitions, broad principles, and non-wardrobe-specific technique. "My", "mine", "this blouse", a named owned piece, or a request for what to wear is not general_advice.

Choose wardrobe_inventory only when the user asks for exact counts of active wardrobe pieces, an exact category count, or a factual active-wardrobe category breakdown. Do NOT use it for whether the wardrobe has enough coverage, what is missing, which pieces qualify, what should be bought, or any styling/aesthetic/suitability judgment; those are full_stylist.

Choose full_stylist for: one/best/pick-one; broad outfit critique; user-attached photos; existing-outfit changes; styling or pairing a garment into an outfit; slot swaps or revisions; capsules, packing, trips or schedules with multiple use cases/contexts; ambiguous identity; visual-fit questions without saved photographs for a resolved subject; or anything needing clarification.

Occasion follows the event's social register, not the relationship between attendees. A generic restaurant dinner, including "dinner with friends," is city/smart casual (occasion:city); an explicit dinner date, night out, evening drinks, or dressy dinner is occasion:evening; coffee, errands, parks, and explicitly low-key/casual events are occasion:casual.

Nature walks, trails, woods, and unpaved ground use activity hiking. Pavement, fairs, museums, sightseeing, and city days use walking only when walking is actually part of the request. Merely traveling to a named place, or attending dinner there, does not establish walking; use activity:none. Resolve relative dates from the supplied current date. Use an empty location/date when none is stated. For full_stylist, use limit 0 and conservative defaults for the other fields.

RECENT EXCHANGE, if supplied, is only the immediately preceding assistant/user turn — use it solely to judge whether the current request continues an unresolved need from that turn (most commonly: the user is answering your own clarifying question). A reply that names an owned garment only because it was answering where to add something, comparing something, or which outfit is meant is NOT thereby a garment_fact question about that garment — classify by the underlying need (usually full_stylist: styling/pairing a garment into an outfit), not by the surface presence of a garment name. Do not use the recent exchange to justify broader classification drift than the current request text supports on its own.`

export async function routeFreeformExecutionProfile({ question = '', currentDate = '', timezone = 'America/Los_Angeles', contextSummary = '', recentExchange = '', providerOverride = null } = {}) {
  return askStylistStructuredWithUsage({
    system: FREEFORM_EXECUTION_ROUTER_SYSTEM,
    messages: [{
      role: 'user',
      content: `Current date: ${currentDate || new Date().toISOString().slice(0, 10)}\nTime zone: ${timezone}\nCompact context available: ${String(contextSummary || 'none').trim()}${String(recentExchange || '').trim() ? `\nRecent exchange (immediately preceding turn only):\n${String(recentExchange).trim()}` : ''}\nRequest: ${String(question || '').trim()}`
    }],
    schema: FREEFORM_EXECUTION_ROUTE_SCHEMA,
    name: 'freeform_execution_route',
    description: 'Choose one narrow execution profile only when its contract and supplied compact context are sufficient.',
    maxTokens: 350,
    providerOverride
  })
}


// docs/activity-and-roster-spec.md Part 4. Every text block of an assistant message, not just the
// first — a final message can carry more than one, and content[0] silently dropped the rest.
export function collectAssistantText(content) {
  if (typeof content === 'string') return content.trim()
  return (Array.isArray(content) ? content : [])
    .filter(block => block?.type === 'text')
    .map(block => String(block.text || ''))
    .join('\n\n')
    .trim()
}

// The model writes its conversational prose in the SAME assistant messages as its tool calls,
// because prompts.js explicitly asks it to ("write your conversational prose — intro, the 'why it
// works' framing, transitions — around those calls"). The tool loop used to return only the last,
// tool-call-free message, so all of that was discarded. A live reply (thread_1786908272853) reached
// the owner as a bare "---" followed by notes referring to "Look 1/2/3" — labels no card carries,
// because the looks had been described beside the propose_outfit calls and thrown away.
// A retry REPLACES the answer, so narration written before it is superseded. Without this, a guard
// that rejected an answer would still ship the prose that caused the rejection: the model's
// correction lands after the original text, producing "Use piece #999." followed by "Correction: use
// verified piece #12" in one reply — and the clause that caught it has spent its retry budget, so it
// cannot fire again. Narration written AFTER the correction accumulates normally, which is what
// makes this a boundary rather than a discard.
export function supersedeNarrationOnRetry(narration = []) {
  if (Array.isArray(narration)) narration.length = 0
  return narration
}

export function joinAssistantNarration(narration = [], finalText = '', { cardCount = 0 } = {}) {
  const closing = String(finalText || '').trim()
  const kept = (Array.isArray(narration) ? narration : [])
    .map(part => String(part || '').trim())
    // Drop anything the model repeated verbatim in its closing message rather than printing twice.
    .filter(part => part && !closing.includes(part))
  // The model can narrate an intention beside a mid-turn tool call ("let me verify that") and then
  // end its turn without ever writing the promised follow-up — the terminal, post-tool-result
  // response comes back empty even though a card was accepted this turn (thread_1787728618995).
  // Left alone, the visible answer is just that leftover intention sentence with no description of
  // what was delivered. Same mechanical shape, and the same fallback text, as
  // applyAcceptedCardAuthority's "nothing survived" case: say what was delivered rather than ship a
  // dangling half-sentence beside cards the user can already see.
  if (!closing && kept.length && cardCount > 0) {
    kept.push(cardCount === 1
      ? 'Here is the look, with its pieces and styling notes on the card.'
      : `Here are ${cardCount} looks, with their pieces and styling notes on each card.`)
  }
  return [...kept, closing]
    .filter(Boolean)
    .join('\n\n')
    // A leading horizontal rule separated the closing notes from prose that used to be discarded.
    // With that prose restored it is a real separator; with nothing above it, it is an orphan.
    .replace(/^\s*-{3,}\s*\n+/, '')
    .trim()
}

// Capsule's ending, adopted for the turn contract (owner, 2026-08-17: the capsule way is better).
//
// Each clause gets exactly one retry — after that `retried` suppresses it and the answer was
// returned unchanged and unremarked, so a guard that fired and did not get fixed left the person
// holding a flawed answer with no sign anything had happened. Capsule does the opposite: a bounded
// attempt that cannot satisfy a rule ships as `model_repaired_with_gaps` with the unmet thing
// stated. Same principle here — deliver, and say what is unresolved.
//
// Deliberately not another retry: the budget is one per clause on purpose, and spending a second
// paid iteration to chase the same failure is the retry spiral the budget exists to prevent.
const FREEFORM_CHECK_DISCLOSURES = {
  zeroResultContradiction: 'One note on the above: I mentioned a piece I could not actually find in your wardrobe. Treat that suggestion as a gap rather than something you own.',
  unverifiedCitation: 'One note: some piece IDs above were not verified against your wardrobe this turn, so check those before acting on them.',
  cardProseInconsistent: 'One note: a look above pairs a top with a dress and I did not explain why. Treat the extra top as optional.',
  outfitProse: 'One note: I described an outfit in text rather than proposing it as a verified card, so its pieces have not been checked against your wardrobe.',
  cardsNotDelivered: 'One note: I was not able to turn this into verified outfit cards — what is above is advice, not a checked proposal.',
  outfitCount: 'One note: this is fewer outfits than you asked for. Ask me to continue if you want the rest.',
  imageNotDelivered: 'One note: I was not able to render the image for this one.',
  destinationClarification: '',
}

// Enumerates EVERY failing clause, then discloses each one that has already spent its retry.
//
// applyFreeformOutputChecks short-circuits on the first failure by design — it exists to pick the
// next correction to send. Calling it once here disclosed at most one unresolved clause, and worse,
// a newly-introduced failure that had NOT been retried would be returned first and mask a retried
// clause behind it, so the reply shipped with nothing said at all. Re-running with each found type
// suppressed walks the whole list without duplicating a single predicate.
export function discloseUnresolvedFreeformChecks(answerText, toolContext = {}, retried = new Set()) {
  if (!retried.size || toolContext.skipFreeformOutputChecks) return answerText
  const suppressed = new Set()
  const failing = []
  // Bounded by the number of clauses; the suppressed set grows every pass, so this terminates.
  for (let pass = 0; pass < Object.keys(FREEFORM_CHECK_DISCLOSURES).length + 1; pass += 1) {
    const recheck = applyFreeformOutputChecks(answerText, toolContext, suppressed, { record: false })
    if (!recheck.block) break
    failing.push(recheck.blockType)
    suppressed.add(recheck.blockType)
  }
  const text = String(answerText || '').trim()
  const notes = failing
    .filter(blockType => retried.has(blockType))
    .map(blockType => FREEFORM_CHECK_DISCLOSURES[blockType])
    .filter(note => note && !text.includes(note)) // ratchet-allow: de-duplicating our own disclosure line in the model's reply, not garment matching
  if (!notes.length) return text
  bumpFreeformDiagnostic(toolContext, 'unresolvedCheckDisclosures', notes.length)
  return `${text}\n\n${[...new Set(notes)].join('\n')}`.trim()
}

// ---- Canonical tool-loop history (Gemini evaluation slice, plan: quizzical-foraging-boot) -----
// currentMessages inside askStylistWithTools used to start in this canonical shape but get
// overwritten with PROVIDER-NATIVE shapes after the first iteration (OpenAI's
// tool_calls/tool_call_id messages, Anthropic's raw content blocks) — that leak, not just the
// branch itself, was what made the loop two independent implementations. It now stays in one
// shape for the whole loop:
//   caller-supplied entries:    { role, content }                         (unchanged from before)
//   a model turn:               { role: 'assistant', text, toolCalls: [{ id, name, args }] }
//   one executed tool's result: { role: 'tool_result', toolCallId, name, text, images }
// Gemini's continuation is deliberately NOT part of any canonical entry (Stage-0 spike,
// scratch/gemini_tool_loop_spike_findings.md: a single opaque previous_interaction_id threaded
// through the loop's own local state is sufficient) — no other adapter reads or writes it, and
// the loop itself never inspects it.

export function toGeminiFunctionDeclaration(tool) {
  return { type: 'function', name: tool.name, description: tool.description, parameters: tool.input_schema }
}

export function canonicalToolResultBlocksForAnthropic(entry) {
  const contentBlocks = [{ type: 'text', text: entry.text }]
  if (entry.images?.length) {
    contentBlocks.push({ type: 'text', text: 'Here are the wardrobe pieces from the tool results. Judge fit, color, texture, print, and proportion by sight.' })
    for (const img of entry.images) {
      contentBlocks.push({ type: 'text', text: img.label })
      contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } })
    }
  }
  return contentBlocks
}

export function canonicalHistoryToAnthropicMessages(canonicalMessages) {
  return canonicalMessages.map(entry => {
    if (entry.role === 'assistant' && Array.isArray(entry.toolCalls)) {
      if (!entry.toolCalls.length) return { role: 'assistant', content: entry.text || '' }
      const content = []
      if (entry.text) content.push({ type: 'text', text: entry.text })
      for (const tc of entry.toolCalls) content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args })
      return { role: 'assistant', content }
    }
    if (entry.role === 'tool_result') {
      return { role: 'user', content: [{ type: 'tool_result', tool_use_id: entry.toolCallId, content: canonicalToolResultBlocksForAnthropic(entry) }] }
    }
    return { role: entry.role, content: toAnthropicContentBlocks(entry.content) }
  })
}

export function canonicalHistoryToOpenAiMessages(canonicalMessages) {
  const out = []
  let i = 0
  while (i < canonicalMessages.length) {
    const entry = canonicalMessages[i]
    if (entry.role === 'assistant' && Array.isArray(entry.toolCalls)) {
      out.push({
        role: 'assistant',
        content: entry.text || '',
        ...(entry.toolCalls.length ? {
          tool_calls: entry.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } }))
        } : {})
      })
      i += 1
      continue
    }
    if (entry.role === 'tool_result') {
      const images = []
      while (i < canonicalMessages.length && canonicalMessages[i].role === 'tool_result') {
        const tr = canonicalMessages[i]
        out.push({ role: 'tool', tool_call_id: tr.toolCallId, name: tr.name, content: tr.text })
        if (tr.images?.length) images.push(...tr.images)
        i += 1
      }
      if (images.length) {
        const content = [{ type: 'text', text: 'Here are the wardrobe pieces from the tool results. Judge fit, color, texture, print, and proportion by sight:' }]
        for (const img of images) {
          content.push({ type: 'text', text: img.label })
          content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}`, detail: 'low' } })
        }
        out.push({ role: 'user', content })
      }
      continue
    }
    out.push({ role: entry.role, content: contentToOpenAI(entry.content) })
    i += 1
  }
  return out
}

export function canonicalContentToGeminiParts(content) {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  return (Array.isArray(content) ? content : []).map(part => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type === 'image') return { type: 'image', data: part.source?.data, mime_type: part.source?.media_type }
    if (part.type === 'image_url') {
      const match = /^data:([^;]+);base64,(.*)$/.exec(part.image_url?.url || '')
      return match ? { type: 'image', data: match[2], mime_type: match[1] } : { type: 'text', text: JSON.stringify(part) }
    }
    return { type: 'text', text: JSON.stringify(part) }
  })
}

// Gemini's Interactions API is stateful server-side (previous_interaction_id) — the Stage-0 spike
// confirmed the loop never needs to resend prior assistant/tool_result turns, only what changed
// since the last Gemini call: on the FIRST call that's the caller's own prior thread history (Gemini
// has never seen it), on every later call it's just this iteration's tool results or a retry-
// correction message. Gemini's own turns are dropped here (`role === 'assistant'` continue) — the
// server already has them via previous_interaction_id.
export function canonicalHistoryToGeminiInput(unsyncedEntries) {
  const input = []
  for (const entry of unsyncedEntries) {
    if (entry.role === 'assistant') continue
    if (entry.role === 'tool_result') {
      const result = [{ type: 'text', text: entry.text }]
      for (const img of entry.images || []) result.push({ type: 'image', data: img.base64, mime_type: img.mime })
      input.push({ type: 'function_result', name: entry.name, call_id: entry.toolCallId, result })
      continue
    }
    input.push(...canonicalContentToGeminiParts(entry.content))
  }
  return input
}

async function callAnthropicTurn({ system, canonicalMessages, tools, maxTokens }) {
  const client = new Anthropic({ apiKey: resolveAnthropicKey() })
  const formattedMessages = withMovingCacheBreakpoint(canonicalHistoryToAnthropicMessages(canonicalMessages))
  const anthropicRequest = {
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system: systemToAnthropicBlocks(system),
    messages: formattedMessages,
    ...(tools.length ? { tools } : {})
  }
  captureWireProviderInput({ provider: 'anthropic', model: ANTHROPIC_MODEL, subflow: 'stylist_tool_loop', request: anthropicRequest })
  const response = await client.messages.create(anthropicRequest)
  const usage = normalizeAiUsage(response.usage, { provider: 'anthropic', model: ANTHROPIC_MODEL, stopReason: response.stop_reason })
  const toolUses = (response.content || []).filter(block => block.type === 'tool_use')
  return {
    text: collectAssistantText(response.content),
    toolCalls: toolUses.map(tu => ({ id: tu.id, name: tu.name, args: tu.input })),
    usage,
    hasToolCalls: response.stop_reason === 'tool_use',
  }
}

async function callOpenAiTurn({ plainSystem, canonicalMessages, tools, maxTokens }) {
  const client = new OpenAI({ apiKey: resolveOpenAiKey() })
  const openAiRequest = {
    model: OPENAI_MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'system', content: plainSystem }, ...canonicalHistoryToOpenAiMessages(canonicalMessages)],
    ...(tools.length ? {
      tools: tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }))
    } : {})
  }
  captureWireProviderInput({ provider: 'openai', model: OPENAI_MODEL, subflow: 'stylist_tool_loop', request: openAiRequest })
  const response = await client.chat.completions.create(openAiRequest)
  const usage = normalizeAiUsage(response.usage, { provider: 'openai', model: OPENAI_MODEL })
  const message = response.choices?.[0]?.message
  if (!message) return { text: '', toolCalls: [], usage, hasToolCalls: false, noMessage: true }
  const toolCalls = (message.tool_calls || []).map(tc => ({ id: tc.id, name: tc.function.name, args: JSON.parse(tc.function.arguments || '{}') }))
  return {
    text: String(message.content || '').trim(),
    toolCalls,
    usage,
    hasToolCalls: toolCalls.length > 0,
  }
}

// Telemetry note (plan §5): Anthropic/OpenAI are observed implicitly by installAiCallTelemetry.js
// patching each SDK's own fetchWithTimeout transport method — that patch is Stainless-specific and
// @google/genai shows no evidence of using the same shim, so this is a deliberate, scoped-to-the-
// experiment divergence: the Gemini branch calls logAiCall() explicitly. If Gemini is promoted past
// this evaluation slice, that's the point to decide between a real transport-level patch or moving
// to a shared invocation boundary — not to be decided here.
const GEMINI_DEBUG = process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'production'

// Persisted into ai_call_log's generic `context` column (no schema change) so a diagnostic script
// can later separate image-token cost from text-token cost per call, and cache-hit vs cache-miss
// latency, without re-deriving it from raw API responses that were never saved. Stage C's own
// image-heavy comparison run is the reason this exists — see scratch/gemini_comparison_runs.js.
function geminiModalityContext(interaction) {
  return {
    inputTokensByModality: interaction.usage?.input_tokens_by_modality || null,
    cachedTokensByModality: interaction.usage?.cached_tokens_by_modality || null,
  }
}

// Diagnostic-only: counts/sizes of what's actually being sent this call, never contents (no image
// bytes, no API key). Exists to answer, from real captured data rather than inference, whether a
// continuation call re-sends prior canonical history (it must not — Gemini already has it via
// previous_interaction_id) and how big the tool-declaration payload is on its own.
function describeGeminiInputShape(input, continuation, toolCount) {
  const byType = {}
  let approxChars = 0
  for (const item of input) {
    byType[item.type] = (byType[item.type] || 0) + 1
    approxChars += JSON.stringify(item).length
  }
  return { usedContinuation: Boolean(continuation), inputItemCount: input.length, inputItemsByType: byType, approxInputJsonChars: approxChars, toolDeclarationCount: toolCount }
}

async function callGeminiTurn({ plainSystem, unsyncedEntries, continuation, tools, maxTokens, model }) {
  const ai = new GoogleGenAI({ apiKey: resolveGeminiKey() })
  const input = canonicalHistoryToGeminiInput(unsyncedEntries)
  const callKind = tools.length ? 'tool_loop' : 'text'
  if (GEMINI_DEBUG) {
    console.log('[gemini request shape]', describeGeminiInputShape(input, continuation, tools.length))
  }
  const startedAt = Date.now()
  let interaction
  const geminiRequest = {
    model,
    ...(continuation ? { previous_interaction_id: continuation } : { system_instruction: plainSystem }),
    input,
    generation_config: { max_output_tokens: maxTokens, thinking_level: GEMINI_THINKING_LEVEL },
    ...(tools.length ? { tools: tools.map(toGeminiFunctionDeclaration) } : {})
  }
  // Note for comparison purposes: on a continuation call (iteration 2+ within one turn), this wire
  // request intentionally omits system_instruction and prior history — Gemini's own backend already
  // has both via previous_interaction_id. That's not missing input, it's a different transport for
  // the same logical context; compare against the 'normalized' capture (canonicalMessages), not this
  // one, to see what the model logically had.
  captureWireProviderInput({ provider: 'gemini', model, subflow: 'stylist_tool_loop', request: geminiRequest })
  try {
    interaction = await ai.interactions.create(geminiRequest)
  } catch (err) {
    await logAiCall({
      provider: 'gemini', model, callKind, success: false,
      errorMessage: err?.message || String(err), latencyMs: Date.now() - startedAt, isMock: false,
    })
    throw err
  }
  // Isolates PURE ai.interactions.create() network/server latency from Closet's own tool
  // execution (search_wardrobe DB queries, sharp image thumbnailing, etc.) — that work happens in
  // the caller (askStylistWithTools), after this function returns, so it is never included here.
  const latencyMs = Date.now() - startedAt
  const steps = interaction.steps || []
  const functionCalls = steps.filter(s => s.type === 'function_call')
  const modelOutputs = steps.filter(s => s.type === 'model_output')
  const text = modelOutputs
    .map(o => (o.content || []).filter(c => c.type === 'text').map(c => c.text).join(''))
    .join('\n\n')
    .trim() || String(interaction.output_text || '').trim()
  // Gemini's truncation signal was never exercised by the Stage-0 spike (it never hit the token
  // cap) — stopReason stays null here until a real truncated response is observed; see the TODO
  // on normalizeStopReason's gemini branch and the corresponding adapter test.
  const usage = normalizeAiUsage(interaction.usage, { provider: 'gemini', model, stopReason: null })
  if (GEMINI_DEBUG) {
    // Full breakdown the SQL columns don't carry (item 4 of the latency diagnosis): thought vs
    // tool-use vs plain output tokens, and cache/input split by modality (text vs image) — the
    // direct evidence for how much of the retained context is images vs structured text.
    console.log('[gemini raw usage]', {
      latencyMs,
      total_tokens: interaction.usage?.total_tokens,
      total_input_tokens: interaction.usage?.total_input_tokens,
      total_cached_tokens: interaction.usage?.total_cached_tokens,
      total_output_tokens: interaction.usage?.total_output_tokens,
      total_thought_tokens: interaction.usage?.total_thought_tokens,
      total_tool_use_tokens: interaction.usage?.total_tool_use_tokens,
      input_tokens_by_modality: interaction.usage?.input_tokens_by_modality,
      cached_tokens_by_modality: interaction.usage?.cached_tokens_by_modality,
    })
  }
  await logAiCall({
    provider: 'gemini', model, callKind, usage, success: true, latencyMs, isMock: false,
    toolNames: functionCalls.map(fc => fc.name).filter(Boolean).join(','),
    context: geminiModalityContext(interaction),
  })
  return {
    text,
    toolCalls: functionCalls.map(fc => ({ id: fc.id, name: fc.name, args: fc.arguments || {} })),
    usage,
    hasToolCalls: interaction.status === 'requires_action' && functionCalls.length > 0,
    continuation: interaction.id,
  }
}

async function callProviderTurn(provider, ctx) {
  if (provider === 'gemini') return callGeminiTurn(ctx)
  if (provider === 'openai') return callOpenAiTurn(ctx)
  return callAnthropicTurn(ctx)
}

export async function askStylistWithTools({ system, messages, maxTokens = 1500, toolContext = {} }) {
  const plainSystem = systemToPlainText(system)
  const testResponse = takeTestAiResponse({ system: plainSystem, messages, maxTokens })
  if (testResponse != null) {
    if (toolContext.trackMockUsage) {
      recordToolLoopUsage(toolContext, normalizeAiUsage(testResponse?.usage || null), { cacheSite: 'tool_loop' })
    }
    // Mirror the real loop's output checks and one-retry-per-guard semantics so
    // contract tests can exercise guard behavior end-to-end (previously this
    // short-circuit skipped the checks entirely, making every guard untestable
    // through /ask).
    let answerStr = toolContext.returnObjectAnswer && typeof testResponse?.answer === 'string'
      ? testResponse.answer
      : (typeof testResponse === 'string' ? testResponse : JSON.stringify(testResponse))
    const retriedChecks = new Set()
    for (let i = 0; i < 6; i++) {
      const capsuleFinal = boundedCapsuleFinalAnswer(answerStr, toolContext)
      if (capsuleFinal.replaced) return { answer: capsuleFinal.answer, savedCorrections: [] }
      const check = toolContext.skipFreeformOutputChecks
        ? { block: false }
        : applyFreeformOutputChecks(answerStr, toolContext, retriedChecks)
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
    return { answer: boundedAtomicMultiLookFinalAnswer(answerStr, toolContext), savedCorrections: [] }
  }

  // Experimental provider override (plan §4): only ever set by a comparison-run script or the
  // Stage-0 spike, never by a route/session/UI. Absent, this resolves to today's
  // AI_PROVIDER/ACTIVE_STYLIST_MODEL exactly as before — a no-op for every real call site.
  const target = resolveAiTarget(toolContext.providerOverride)
  assertProviderKey(target)
  // Out-channel for the real resolved {provider, model} this turn used (plan:
  // quizzical-foraging-boot, Stage F) — same pattern as toolContext.generatedOutfits/
  // freeformDiagnostics. Lets /ask report the turn's actual target instead of the stale
  // process-global AI_PROVIDER constant, without touching this function's several returns.
  toolContext.resolvedProviderTarget = target

  let currentMessages = [...messages]
  let providerContinuation = null
  let syncedHistoryLength = 0
  const savedCorrections = []
  const retriedChecks = new Set()
  // docs/activity-and-roster-spec.md Part 4. The model writes its conversational prose — intro, the
  // per-look framing, transitions — in the SAME assistant messages as its tool calls, because
  // prompts.js explicitly asks it to ("write your conversational prose … around those calls"). This
  // loop used to return only the last, tool-call-free message, so all of that was discarded: a live
  // reply arrived as a bare "---" followed by notes referring to "Look 1/2/3", labels no card
  // carries, because the looks themselves had been written beside the propose_outfit calls.
  const narration = []
  const joinAnswer = finalText => joinAssistantNarration(narration, finalText, {
    cardCount: Array.isArray(toolContext?.generatedOutfits)
      ? toolContext.generatedOutfits.filter(card => !card?.broken).length
      : 0
  })

  // 10 iterations: the disciplined flow (declare, search, view supports, view
  // layers, propose xN) legitimately needs 6-8; the old cap of 7 left no margin
  // for a single corrective bounce and live turns died with zero cards.
  const maxProviderIterations = Number(toolContext.maxProviderIterations) > 0
    ? Math.min(10, Number(toolContext.maxProviderIterations))
    : 10
  for (let iter = 0; iter < maxProviderIterations; iter++) {
    // Stage this call's attribution on the shared telemetry context immediately before it fires —
    // installAiCallTelemetry.js reads it off the context at the SDK transport boundary. Guarded on
    // freeformTurnToken because this same loop also runs from styling-engine/core.js for the outfit-
    // evaluation follow-up flow, which is not a freeform turn and must not be tagged as one.
    if (toolContext.freeformTurnToken) {
      const pendingRetryReason = toolContext._pendingFreeformRetryReason || ''
      updateAiTelemetryContext({
        freeformTurnToken: toolContext.freeformTurnToken,
        subflow: 'stylist_tool_loop',
        iterationIndex: nextFreeformCallIndex(toolContext),
        isRetry: Boolean(pendingRetryReason),
        retryReason: pendingRetryReason,
        isNested: false,
      })
      toolContext._pendingFreeformRetryReason = ''
    }
    const availableTools = stylistToolsForTurn(toolContext)
    const unsyncedEntries = currentMessages.slice(syncedHistoryLength)
    captureNormalizedProviderInput({
      provider: target.provider, model: target.model, subflow: 'stylist_tool_loop', iterationIndex: iter,
      system, messages: currentMessages, tools: availableTools,
    })
    const turn = await callProviderTurn(target.provider, {
      system, plainSystem, model: target.model,
      canonicalMessages: currentMessages,
      unsyncedEntries, continuation: providerContinuation,
      tools: availableTools, maxTokens,
    })
    syncedHistoryLength = currentMessages.length
    if (turn.continuation !== undefined) providerContinuation = turn.continuation

    recordToolLoopUsage(toolContext, turn.usage, { cacheSite: 'tool_loop' })
    if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'production') {
      console.log(`[${target.provider} Tool Loop Usage]`, {
        iter,
        inputTokens: turn.usage?.inputTokens,
        outputTokens: turn.usage?.outputTokens,
        cacheReadInputTokens: turn.usage?.cacheReadInputTokens,
        cacheCreationInputTokens: turn.usage?.cacheCreationInputTokens
      })
    }

    if (turn.noMessage) return { answer: '', savedCorrections }

    if (turn.hasToolCalls) {
      recordFreeformToolIteration(toolContext, turn.toolCalls.map(tc => tc.name))
      if (turn.text) narration.push(turn.text)
      currentMessages.push({ role: 'assistant', text: turn.text || '', toolCalls: turn.toolCalls })

      for (const tc of turn.toolCalls) {
        const result = await executeTool(tc.name, tc.args, toolContext)
        if (tc.name === 'store_user_correction' && result?.status === 'success') {
          savedCorrections.push({ ...tc.args, ...result })
        }
        const extracted = extractToolResultImages(result)
        currentMessages.push({ role: 'tool_result', toolCallId: tc.id, name: tc.name, text: extracted.textResult, images: extracted.images })
      }
      if (toolContext.atomicMultiLookCompleted) {
        return { answer: boundedAtomicMultiLookResponse(toolContext), savedCorrections }
      }
      continue
    } else {
      const finalText = joinAnswer(turn.text || '')
      const capsuleFinal = boundedCapsuleFinalAnswer(finalText, toolContext)
      if (capsuleFinal.replaced) return { answer: capsuleFinal.answer, savedCorrections }
      const check = toolContext.skipFreeformOutputChecks
        ? { block: false }
        : applyFreeformOutputChecks(finalText, toolContext, retriedChecks)
      if (check.block) {
        retriedChecks.add(check.blockType)
        toolContext._pendingFreeformRetryReason = check.blockType
        supersedeNarrationOnRetry(narration)
        currentMessages.push({ role: 'assistant', text: finalText, toolCalls: [] })
        currentMessages.push({ role: 'user', content: check.correctionMessage })
        continue
      }
      const authoritative = applyAcceptedCardAuthority(finalText, toolContext)
      const disclosed = discloseUnresolvedFreeformChecks(authoritative, toolContext, retriedChecks)
      return { answer: boundedAtomicMultiLookFinalAnswer(disclosed, toolContext), savedCorrections }
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

// cacheSite: 'tool_loop' identifies calls made through askStylistWithTools's own Anthropic branch
// (systemToAnthropicBlocks + withMovingCacheBreakpoint applied unconditionally there), which is the
// ONLY caller of this function where a TTL split cleanly separates two named caches: any
// ephemeral_1h write can only be the freeform stable-system breakpoint (the sole ttl:'1h'
// cache_control in this codebase), and the loop's only other breakpoint is the 5m moving-message
// one, so whatever 5m write remains is unambiguously that. Other callers of recordToolLoopUsage
// (the compact router, capsule roster/composition calls, etc.) either carry no breakpoint or carry
// a DIFFERENT 5m breakpoint (e.g. the capsule roster prompt cache) that a blind TTL split would
// wrongly fold into "moving message" — so they must NOT pass cacheSite, and this attribution stays
// off by default. Read tokens have no TTL split from the provider (one number for however much of
// the whole prefix matched), so providerToolLoopCacheReadTokens stays a combined system+message
// total rather than being split further. See docs/deferred-conversational-cache-spec.md.
export function recordToolLoopUsage(toolContext = {}, usage = {}, { cacheSite = null } = {}) {
  bumpFreeformDiagnostic(toolContext, 'providerIterations')
  bumpFreeformDiagnostic(toolContext, 'providerInputTokens', Number(usage.inputTokens) || 0)
  bumpFreeformDiagnostic(toolContext, 'providerOutputTokens', Number(usage.outputTokens) || 0)
  bumpFreeformDiagnostic(toolContext, 'providerCacheReadInputTokens', Number(usage.cacheReadInputTokens) || 0)
  bumpFreeformDiagnostic(toolContext, 'providerCacheCreationInputTokens', Number(usage.cacheCreationInputTokens) || 0)
  if (cacheSite === 'tool_loop') {
    bumpFreeformDiagnostic(toolContext, 'providerFullStylistSystemCacheCreationTokens', Number(usage.cacheCreation1hInputTokens) || 0)
    bumpFreeformDiagnostic(toolContext, 'providerMovingMessageCacheCreationTokens', Number(usage.cacheCreation5mInputTokens) || 0)
    bumpFreeformDiagnostic(toolContext, 'providerToolLoopCacheReadTokens', Number(usage.cacheReadInputTokens) || 0)
  }
  return toolContext.freeformDiagnostics
}

// Provider-free orchestration replay for plan/tool-contract tests. Scripted
// steps use the real tool executor and one shared context, but never construct
// an AI client. Functional args let a submit step consume an earlier workbench.
export async function replayStylistToolScript({ steps = [], toolContext = {} } = {}) {
  const results = []
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue
    if (step.final != null) {
      results.push({ type: 'final', text: String(step.final) })
      continue
    }
    const name = String(step.tool || '').trim()
    if (!name) throw new Error('Replay step needs tool or final')
    const args = typeof step.args === 'function'
      ? await step.args({ results, toolContext })
      : (step.args || {})
    const result = await executeTool(name, args, toolContext)
    results.push({ type: 'tool', name, args, result })
  }
  return { results, toolContext }
}
