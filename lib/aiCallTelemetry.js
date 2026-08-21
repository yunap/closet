import { AsyncLocalStorage } from 'node:async_hooks'
import { db } from '../db.js'
import { getCurrentUserId } from './requestContext.js'

const aiTelemetryStorage = new AsyncLocalStorage()
const initializedUsers = new Set()
const FETCH_PATCH_MARKER = Symbol.for('wardrobe.aiCallTelemetry.fetchPatched')

const IMAGE_CALL_FLAT_USD = {
  'gpt-4o-image': 0.07,
  'gpt-image-1': 0.07,
  'gpt-4o': 0.07,
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value
  if (typeof value !== 'string' || !value.trim()) return fallback
  try { return JSON.parse(value) } catch { return fallback }
}

function routePath(originalUrl = '') {
  return String(originalUrl || '').split('?')[0]
}

export function classifyAiFlow(originalUrl = '') {
  const path = routePath(originalUrl)
  const exact = new Map([
    ['/api/ai/tag-piece', ['tag_piece', '/tag-piece']],
    ['/api/ai/evaluate-piece', ['evaluate_piece', '/evaluate-piece']],
    ['/api/ai/extract-pieces', ['extract_pieces', '/extract-pieces']],
    ['/api/ai/generate-wardrobe-outfits-visual', ['whole_wardrobe_composer', '/generate-wardrobe-outfits-visual']],
    ['/api/ai/generate-saved-outfit-variants', ['saved_outfit_variants', '/generate-saved-outfit-variants']],
    ['/api/ai/generate-outfits-for-piece', ['selected_piece_composer', '/generate-outfits-for-piece']],
    ['/api/ai/generate-outfit-boards', ['piece_concept_boards', '/generate-outfit-boards']],
    ['/api/ai/editorial-directions-preview', ['editorial_directions', '/editorial-directions-preview']],
    ['/api/ai/editorial-render-one', ['editorial_render', '/editorial-render-one']],
    ['/api/ai/generate-ideal-additions-preview-sheet', ['ideal_additions_sheet', '/generate-ideal-additions-preview-sheet']],
    ['/api/ai/generate-wardrobe-outfit-image', ['wardrobe_outfit_image', '/generate-wardrobe-outfit-image']],
    ['/api/ai/generate-wardrobe-outfit-comparison-sheet', ['wardrobe_outfit_comparison_sheet', '/generate-wardrobe-outfit-comparison-sheet']],
    ['/api/ai/generate-saved-outfit-image', ['saved_outfit_image', '/generate-saved-outfit-image']],
    ['/api/ai/evaluate-wardrobe-outfit', ['outfit_evaluation', '/evaluate-wardrobe-outfit']],
    ['/api/ai/outfit-feedback', ['outfit_feedback', '/outfit-feedback']],
    ['/api/ai/compare-outfits', ['compare_outfits', '/compare-outfits']],
    ['/api/ai/ask', ['ask', '/ask']],
    ['/api/ai/expand-capsule', ['expand_capsule', '/expand-capsule']],
    ['/api/ai/repair-capsule-look', ['repair_capsule_look', '/repair-capsule-look']],
    ['/api/feedback-synthesis/batches', ['feedback_synthesis', '/feedback-synthesis/batches']],
  ])
  if (exact.has(path)) {
    const [flow, endpoint] = exact.get(path)
    return { flow, endpoint }
  }
  if (/^\/api\/ai\/tag-piece-existing\/[^/]+$/.test(path)) {
    return { flow: 'tag_piece_existing', endpoint: '/tag-piece-existing/:id' }
  }
  const importMatch = path.match(/^\/api\/import\/sessions\/[^/]+\/(.+)$/)
  if (importMatch) {
    const action = importMatch[1].replace(/\/+/g, '_').replace(/[^a-z0-9_]+/gi, '_').replace(/^_|_$/g, '')
    const known = new Map([
      ['classify', 'importer_classify'],
      ['detect', 'importer_detect'],
      ['crop_verify', 'importer_crop_verify'],
      ['crop_relocate', 'importer_crop_relocate'],
      ['cluster', 'importer_cluster'],
      ['merge', 'importer_merge'],
      ['tag', 'importer_tag'],
    ])
    return {
      flow: known.get(action) || `importer_${action || 'unknown'}`,
      endpoint: `/sessions/:id/${importMatch[1]}`,
    }
  }
  return { flow: 'unattributed', endpoint: path.replace(/^\/api\/ai/, '') || path || '' }
}

export function runWithAiTelemetryContext(context = {}, fn) {
  return aiTelemetryStorage.run({ ...context }, fn)
}

export function getAiTelemetryContext() {
  return aiTelemetryStorage.getStore() || {}
}

function ensureAiCallLogTable() {
  const userId = getCurrentUserId()
  if (initializedUsers.has(userId)) return
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_call_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flow TEXT NOT NULL,
      endpoint TEXT DEFAULT '',
      session_id TEXT DEFAULT '',
      call_kind TEXT NOT NULL DEFAULT 'text',
      is_image INTEGER NOT NULL DEFAULT 0,
      provider TEXT DEFAULT '',
      model TEXT DEFAULT '',
      success INTEGER NOT NULL DEFAULT 1,
      error_message TEXT DEFAULT '',
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_input_tokens INTEGER DEFAULT 0,
      cache_creation_input_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      estimated_cost_usd REAL DEFAULT NULL,
      latency_ms INTEGER DEFAULT NULL,
      is_mock INTEGER NOT NULL DEFAULT 0,
      context TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ai_call_log_created_at ON ai_call_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_call_log_flow ON ai_call_log(flow);
  `)
  initializedUsers.add(userId)
}

export async function logAiCall({
  flow = '', endpoint = '', sessionId = '', callKind = 'text', isImage = false,
  provider = '', model = '', usage = null, success = true, errorMessage = '',
  latencyMs = null, isMock = false, context = '', estimatedCostUsd = undefined,
} = {}) {
  try {
    ensureAiCallLogTable()
    const telemetryContext = getAiTelemetryContext()
    const routed = classifyAiFlow(telemetryContext.originalUrl || '')
    const resolvedFlow = flow || telemetryContext.flow || routed.flow || 'unattributed'
    const resolvedEndpoint = endpoint || telemetryContext.endpoint || routed.endpoint || ''
    const resolvedSessionId = sessionId || telemetryContext.sessionId || ''
    const normalizedUsage = usage || null
    let cost = estimatedCostUsd
    if (cost === undefined && isImage) {
      cost = IMAGE_CALL_FLAT_USD[model] ?? IMAGE_CALL_FLAT_USD['gpt-4o-image']
    }
    if (cost === undefined && normalizedUsage) {
      try {
        const { estimateAiUsageCost } = await import('../styling-engine/provider.js')
        cost = estimateAiUsageCost({ ...normalizedUsage, provider, model })?.estimatedUsd ?? null
      } catch {
        cost = null
      }
    }
    const contextText = typeof context === 'string' ? context : JSON.stringify(context || {})
    db.prepare(`
      INSERT INTO ai_call_log (
        flow, endpoint, session_id, call_kind, is_image, provider, model, success,
        error_message, input_tokens, output_tokens, cache_read_input_tokens,
        cache_creation_input_tokens, total_tokens, estimated_cost_usd, latency_ms,
        is_mock, context
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      resolvedFlow, resolvedEndpoint, resolvedSessionId, callKind, isImage ? 1 : 0,
      provider, model, success ? 1 : 0, String(errorMessage || '').slice(0, 1000),
      numberOrZero(normalizedUsage?.inputTokens), numberOrZero(normalizedUsage?.outputTokens),
      numberOrZero(normalizedUsage?.cacheReadInputTokens), numberOrZero(normalizedUsage?.cacheCreationInputTokens),
      numberOrZero(normalizedUsage?.totalTokens), Number.isFinite(Number(cost)) ? Number(cost) : null,
      Number.isFinite(Number(latencyMs)) ? Math.round(Number(latencyMs)) : null,
      isMock ? 1 : 0, contextText.slice(0, 4000)
    )
  } catch (err) {
    console.warn('[ai-call-telemetry] failed to persist call log:', err?.message || err)
  }
}

function providerFromUrl(url = '') {
  const text = String(url || '')
  if (text.includes('api.anthropic.com')) return 'anthropic'
  if (text.includes('api.openai.com')) return 'openai'
  return ''
}

function modelRequestBody(init = {}) {
  const body = init?.body
  if (typeof body !== 'string') return {}
  return safeJson(body, {})
}

export function inferCallKind({ provider = '', url = '', body = {} } = {}) {
  const tools = Array.isArray(body?.tools) ? body.tools : []
  if (String(url).includes('/images/') || tools.some(tool => tool?.type === 'image_generation')) return 'image'
  if (body?.response_format?.type === 'json_schema') return 'structured'
  if (provider === 'anthropic' && body?.tool_choice?.type === 'tool') return 'structured'
  if (provider === 'openai' && body?.tool_choice?.type === 'function') return 'structured'
  if (tools.length) return 'tool_loop'
  return 'text'
}

export function normalizeProviderUsage(payload = {}, provider = '', model = '') {
  const raw = payload?.usage
  if (!raw || typeof raw !== 'object') return null
  if (provider === 'anthropic') {
    const inputTokens = numberOrZero(raw.input_tokens)
    const outputTokens = numberOrZero(raw.output_tokens)
    const cacheReadInputTokens = numberOrZero(raw.cache_read_input_tokens)
    const cacheCreationInputTokens = numberOrZero(raw.cache_creation_input_tokens)
    return {
      provider, model, inputTokens, outputTokens, cacheReadInputTokens,
      cacheCreationInputTokens,
      totalTokens: inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens,
    }
  }
  const inputTokens = numberOrZero(raw.prompt_tokens ?? raw.input_tokens)
  const outputTokens = numberOrZero(raw.completion_tokens ?? raw.output_tokens)
  const cacheReadInputTokens = numberOrZero(raw.prompt_tokens_details?.cached_tokens ?? raw.input_tokens_details?.cached_tokens)
  return {
    provider, model, inputTokens, outputTokens, cacheReadInputTokens,
    cacheCreationInputTokens: 0,
    totalTokens: numberOrZero(raw.total_tokens) || inputTokens + outputTokens,
  }
}

function responseErrorMessage(payload = {}, response = null) {
  return String(payload?.error?.message || payload?.message || (!response?.ok ? `HTTP ${response?.status || 'error'}` : '') || '')
}

export function installAiFetchTelemetry() {
  if (globalThis[FETCH_PATCH_MARKER]) return
  if (typeof globalThis.fetch !== 'function') return
  const originalFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = async (input, init = undefined) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : String(input?.url || '')
    const provider = providerFromUrl(url)
    if (!provider) return originalFetch(input, init)

    const startedAt = Date.now()
    const body = modelRequestBody(init)
    const model = String(body?.model || '')
    const callKind = inferCallKind({ provider, url, body })
    const isImage = callKind === 'image'
    const baseContext = {
      providerPath: (() => { try { return new URL(url).pathname } catch { return '' } })(),
      responseApi: String(url).includes('/responses'),
    }
    try {
      const response = await originalFetch(input, init)
      const latencyMs = Date.now() - startedAt
      const clone = response.clone()
      void clone.json()
        .then(payload => logAiCall({
          callKind, isImage, provider, model,
          usage: normalizeProviderUsage(payload, provider, model),
          success: response.ok,
          errorMessage: responseErrorMessage(payload, response),
          latencyMs,
          context: { ...baseContext, status: response.status },
        }))
        .catch(() => logAiCall({
          callKind, isImage, provider, model, success: response.ok,
          errorMessage: response.ok ? '' : `HTTP ${response.status}`,
          latencyMs, context: { ...baseContext, status: response.status, usageUnavailable: true },
        }))
      return response
    } catch (err) {
      await logAiCall({
        callKind, isImage, provider, model, success: false,
        errorMessage: err?.message || String(err), latencyMs: Date.now() - startedAt,
        context: { ...baseContext, networkError: true },
      })
      throw err
    }
  }
  globalThis[FETCH_PATCH_MARKER] = true
}
