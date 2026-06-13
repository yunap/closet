import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { STYLIST_SYSTEM } from './prompts.js'
import { STYLIST_TOOLS, executeTool } from './tools.js'

export const AI_PROVIDER = (process.env.AI_PROVIDER || 'anthropic').toLowerCase()
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_STYLIST_MODEL || 'claude-sonnet-4-6'
export const OPENAI_MODEL = process.env.OPENAI_STYLIST_MODEL || 'gpt-4o'
export const ACTIVE_STYLIST_MODEL = AI_PROVIDER === 'openai' ? OPENAI_MODEL : ANTHROPIC_MODEL

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

const wardrobeThumbCache = new Map() // key: `${pieceId}:${filename}` -> { media_type, data }

export async function prepareWardrobeThumb(filePath, cacheKey) {
  if (cacheKey && wardrobeThumbCache.has(cacheKey)) return wardrobeThumbCache.get(cacheKey)
  const sharp = (await import('sharp')).default
  const buffer = await sharp(filePath)
    .resize(448, 448, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer()
  const result = { media_type: 'image/jpeg', data: buffer.toString('base64') }
  if (cacheKey) {
    wardrobeThumbCache.set(cacheKey, result)
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

export function parseModelJson(raw) {
  return JSON.parse(String(raw || '').trim().replace(/^```json\n?|\n?```$/g, '').trim())
}

export async function askClaude({ system = STYLIST_SYSTEM, messages, maxTokens = 1200 }) {
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
  return response.content?.[0]?.text || ''
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
  const testResponse = takeTestAiResponse({ system, messages, maxTokens })
  if (testResponse != null) {
    return typeof testResponse === 'string' ? testResponse : JSON.stringify(testResponse)
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
    return response.choices?.[0]?.message?.content || ''
  }

  return askClaude({ system, messages, maxTokens })
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
          
          let toolContent = ''
          if (name === 'get_garment_details') {
            toolContent = JSON.stringify(result.map(item => ({ id: item.id, name: item.name, text: item.text })))
            for (const item of result) {
              if (item.image) collectedImages.push(item.image)
            }
          } else {
            toolContent = JSON.stringify(result)
          }

          toolOutputs.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: name,
            content: toolContent
          })
        }
        currentMessages.push(...toolOutputs)

        if (collectedImages.length > 0) {
          currentMessages.push({
            role: 'user',
            content: [
              { type: 'text', text: 'Visual reference photos for the garments you requested details for:' },
              ...collectedImages.map(img => ({
                type: 'image_url',
                image_url: { url: `data:${img.mime};base64,${img.base64}` }
              }))
            ]
          })
        }
        continue
      } else {
        return { answer: message.content || '', savedCorrections }
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
          
          let contentBlocks = []
          if (name === 'get_garment_details') {
            const textResult = JSON.stringify(result.map(item => ({ id: item.id, name: item.name, text: item.text })))
            contentBlocks.push({
              type: 'text',
              text: textResult
            })
            for (const item of result) {
              if (item.image) {
                contentBlocks.push({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: item.image.mime,
                    data: item.image.base64
                  }
                })
              }
            }
          } else {
            contentBlocks.push({
              type: 'text',
              text: JSON.stringify(result)
            })
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
        return { answer: response.content?.[0]?.text || '', savedCorrections }
      }
    }
  }

  return { answer: 'Tool calling loop reached max iterations.', savedCorrections }
}
