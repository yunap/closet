import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { STYLIST_SYSTEM } from './prompts.js'
import { STYLIST_TOOLS, executeTool, bumpFreeformDiagnostic } from './tools.js'

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
// the tool, so the pieces it named are unverified. Soft signal (flagged, not blocked) since the
// severe case (0b) is the one with proof of a false claim.
export function looksLikeUnproposedOutfitProse(answerText = '') {
  const labelMatches = String(answerText || '').match(/^\s*(?:[-*]\s*)?\*{0,2}(top|bottom|dress|shoes|outerwear|accessory)\*{0,2}\s*:/gim) || []
  const distinctLabels = new Set(labelMatches.map(m => m.toLowerCase().replace(/[^a-z]/g, '')))
  return distinctLabels.size >= 2
}

// Spec 7 Part 2: the model asking a destination/weather clarifying question without ever calling
// search_wardrobe is the confirmed failure mode (STYLIST_SYSTEM's prompt guidance alone wasn't
// reliable — same lesson as spec 3 Part 0). Deliberately loose keyword match: a false positive just
// costs one harmless retry, cheaper than the miss (a full extra clarifying turn from Yuna's side).
export function looksLikeDestinationOrWeatherQuestion(answerText = '') {
  const text = String(answerText || '')
  if (!text.includes('?')) return false // ratchet-allow: model's own reply prose, not garment matching
  return /\b(what weather|what'?s the weather|what destination|where are you (going|headed)|where'?re you (going|headed|traveling)|what city|which city|what location)\b/i.test(text) // ratchet-allow: model's own reply prose, not garment matching
}

// Spec 11: Yuna's own framing — she doesn't mind the app answering some questions in plain prose
// without going through the model's tools, but explicitly minds an ignored "show" request. Unlike
// looksLikeUnproposedOutfitProse (which reads the model's ANSWER and only soft-flags), this reads the
// USER's question — the explicit "show/render this" signal STYLIST_SYSTEM's own "Showing /
// Re-rendering an Outfit" rule already tells the model to act on via propose_outfit. Confirmed live
// (2026-07-10): the model doesn't reliably follow that rule on its own, same lesson as spec 3/7 —
// prompt guidance alone isn't enough, this needs a mechanical backstop too.
export function looksLikeShowOrRenderRequest(questionText = '') {
  return /\b(show|render|visuali[sz]e)\b/i.test(String(questionText || '')) // ratchet-allow: user's own request text, not garment matching
}

// After the model produces a tool-call-free final answer, apply spec 3 Part 0's checks plus spec 7
// Part 2's. Returns { block: true, correctionMessage } to force a retry (0b or spec 7), or
// { block: false } after recording any soft flag (0a) as a diagnostic for the client's collapsed
// details affordance. Retry flags are passed in per-kind so exhausting one retry budget doesn't
// consume the other.
function applyFreeformOutputChecks(answerText, toolContext, { zeroResultCorrectionRetried = false, destinationClarificationRetried = false, showRequestRetried = false } = {}) {
  const contradiction = !zeroResultCorrectionRetried && findZeroResultContradiction(answerText, toolContext)
  if (contradiction) {
    bumpFreeformDiagnostic(toolContext, 'zeroResultContradictionBlocks')
    return {
      block: true,
      blockType: 'zeroResultContradiction',
      correctionMessage: `You searched for "${contradiction}" and found nothing — do not describe this as a piece Yuna owns. Either offer a real alternative via search_wardrobe or say plainly that she doesn't have this piece.`
    }
  }
  if ((toolContext?.freeformDiagnostics?.proposeCalls || 0) === 0 && looksLikeUnproposedOutfitProse(answerText)) {
    bumpFreeformDiagnostic(toolContext, 'outfitProseWithoutToolCall')
  }
  if (!destinationClarificationRetried && (toolContext?.freeformDiagnostics?.searchCalls || 0) === 0 && looksLikeDestinationOrWeatherQuestion(answerText)) {
    bumpFreeformDiagnostic(toolContext, 'destinationClarificationRetries')
    return {
      block: true,
      blockType: 'destinationClarification',
      correctionMessage: "You asked about weather or destination without calling search_wardrobe first. If this message names any real place or specific occasion (even one word — a city, region, venue, or event), call search_wardrobe with that as `location` and proceed to propose an outfit. Only ask again if you genuinely cannot identify any destination or occasion in the request."
    }
  }
  if (!showRequestRetried && (toolContext?.freeformDiagnostics?.proposeCalls || 0) === 0 && looksLikeShowOrRenderRequest(toolContext?.question)) {
    bumpFreeformDiagnostic(toolContext, 'showRequestRetries')
    return {
      block: true,
      blockType: 'showRequest',
      correctionMessage: "You were asked to show or render an outfit but did not call propose_outfit. If an outfit or outfit set has already been discussed in this conversation, call propose_outfit now with the same verified piece IDs so it renders as a card. If nothing has been discussed yet to show, say so plainly instead of describing an outfit in prose."
    }
  }
  return { block: false }
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
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system,
    messages
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

export async function askStylist({ system = STYLIST_SYSTEM, messages, maxTokens = 1200 }) {
  const { text } = await askStylistWithUsage({ system, messages, maxTokens })
  return text
}

export async function askStylistWithUsage({ system = STYLIST_SYSTEM, messages, maxTokens = 1200 }) {
  const testResponse = takeTestAiResponse({ system, messages, maxTokens })
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
        { role: 'system', content: system },
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
  const testResponse = takeTestAiResponse({ system, messages, maxTokens })
  if (testResponse != null) {
    const answerStr = typeof testResponse === 'string' ? testResponse : JSON.stringify(testResponse)
    return { answer: answerStr, savedCorrections: [] }
  }

  assertProviderKey()

  let currentMessages = [...messages]
  const savedCorrections = []
  let zeroResultCorrectionRetried = false
  let destinationClarificationRetried = false
  let showRequestRetried = false

  for (let iter = 0; iter < 5; iter++) {
    if (AI_PROVIDER === 'openai') {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const response = await client.chat.completions.create({
        model: OPENAI_MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
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
        const check = applyFreeformOutputChecks(finalText, toolContext, { zeroResultCorrectionRetried, destinationClarificationRetried, showRequestRetried })
        if (check.block) {
          if (check.blockType === 'destinationClarification') destinationClarificationRetried = true
          else if (check.blockType === 'showRequest') showRequestRetried = true
          else zeroResultCorrectionRetried = true
          currentMessages.push({ role: 'assistant', content: finalText })
          currentMessages.push({ role: 'user', content: check.correctionMessage })
          continue
        }
        return { answer: finalText, savedCorrections }
      }
    } else {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      
      const formattedMessages = currentMessages.map(m => {
        return { role: m.role, content: m.content }
      })

      const response = await client.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        system,
        messages: formattedMessages,
        tools: STYLIST_TOOLS
      })

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
                detail: 'low',
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
        const check = applyFreeformOutputChecks(finalText, toolContext, { zeroResultCorrectionRetried, destinationClarificationRetried, showRequestRetried })
        if (check.block) {
          if (check.blockType === 'destinationClarification') destinationClarificationRetried = true
          else if (check.blockType === 'showRequest') showRequestRetried = true
          else zeroResultCorrectionRetried = true
          currentMessages.push({ role: 'assistant', content: response.content })
          currentMessages.push({ role: 'user', content: check.correctionMessage })
          continue
        }
        return { answer: finalText, savedCorrections }
      }
    }
  }

  return { answer: 'Tool calling loop reached max iterations.', savedCorrections }
}
