import { AsyncLocalStorage } from 'node:async_hooks'
import { db } from '../db.js'

const aiTelemetryStorage = new AsyncLocalStorage()

const IMAGE_CALL_FLAT_USD = {
  'gpt-4o-image': 0.07,
  'gpt-image-1': 0.07,
  'gpt-4o': 0.07,
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

function routePath(originalUrl = '') {
  return String(originalUrl || '').split('?')[0]
}

// docs/message-lifecycle.md Stage 5-7 / the freeform cache-efficiency investigation: a turn made of
// several provider calls (execution router, tool-loop iterations, a nested composer call inside a
// tool) previously left only a turn-level sum in freeform_generation_runs — provider_iterations,
// provider_input_tokens etc — with no way to see which call cost what. freeform_run_id correlates
// each row back to its freeform_generation_runs turn once that row exists (it is only inserted at
// the end of the turn, so it is backfilled — see backfillFreeformRunId); freeform_turn_token is the
// correlation key available at call time, before that id exists.
const FREEFORM_CALL_ATTRIBUTION_COLUMNS = [
  'freeform_run_id INTEGER DEFAULT NULL',
  "freeform_turn_token TEXT DEFAULT ''",
  'iteration_index INTEGER DEFAULT NULL',
  "subflow TEXT DEFAULT ''",
  "tool_names TEXT DEFAULT ''",
  'is_retry INTEGER NOT NULL DEFAULT 0',
  "retry_reason TEXT DEFAULT ''",
  'is_nested INTEGER NOT NULL DEFAULT 0',
]

// Tagger source attribution (tagger semantic-consistency cleanup follow-up spec, 2026-08-23):
// both ordinary Add and Batch Add call POST /api/ai/tag-piece, so flow=tag_piece alone cannot
// distinguish them. A small closed vocabulary, validated server-side — the client sends an
// X-Tagger-Source header, but only a known value is trusted; anything else (missing, or an
// arbitrary/unrecognized string) is recorded as 'unknown' rather than trusting client text
// verbatim into an aggregation column. /tag-piece-existing/:id is already separately
// attributable via flow=tag_piece_existing and is deliberately not part of this vocabulary.
export const KNOWN_TAGGER_SOURCES = new Set(['piece_form_add', 'batch_add'])

export function normalizeTaggerSource(value) {
  const source = String(value || '').trim()
  return KNOWN_TAGGER_SOURCES.has(source) ? source : (source ? 'unknown' : '')
}

const TAGGER_SOURCE_COLUMNS = [
  "tagger_source TEXT DEFAULT ''",
]

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

export function ensureAiCallLogTable() {
  // CREATE IF NOT EXISTS is intentionally cheap and uncached. Caching this by user id made a
  // deleted/recreated test or per-user database look initialized when the table no longer existed.
  // The db proxy already resolves the current user's connection, so re-running the additive schema
  // statement is the correct source of truth.
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
  // Additive per-call attribution for turns made of several provider calls (currently only /ask).
  // ALTER TABLE ADD COLUMN one at a time and swallow "duplicate column" so this stays safe to
  // re-run against a database that already has some or all of these, same pattern db.js uses for
  // freeform_generation_runs.
  for (const col of [...FREEFORM_CALL_ATTRIBUTION_COLUMNS, ...TAGGER_SOURCE_COLUMNS]) {
    try { db.exec(`ALTER TABLE ai_call_log ADD COLUMN ${col}`) } catch {}
  }
}

export function runWithAiTelemetryContext(context = {}, fn) {
  // The auth middleware has already established the per-user DB context before this runs.
  // Ensure the additive telemetry schema before the first paid call for this request/user.
  ensureAiCallLogTable()
  return aiTelemetryStorage.run({ ...context }, fn)
}

export function getAiTelemetryContext() {
  return aiTelemetryStorage.getStore() || {}
}

// Mutates the current request's AsyncLocalStorage store in place, rather than starting a nested
// .run(). A freeform turn issues several sequential (never concurrent) provider calls — the router,
// each tool-loop iteration, a nested composer call inside a tool — and each one needs its own
// subflow/iteration/retry attribution set immediately before it fires. Sharing one mutable store
// across those calls, instead of re-entering .run() per call, keeps sessionId/originalUrl/flow
// (set once by server.js) intact alongside the fields that change every call. Safe only because
// calls within one turn are sequential; a store from a different, unrelated request is never
// touched since each request gets its own store from runWithAiTelemetryContext.
export function updateAiTelemetryContext(patch = {}) {
  const store = aiTelemetryStorage.getStore()
  if (!store) return
  Object.assign(store, patch)
}

export async function logAiCall({
  flow = '', endpoint = '', sessionId = '', callKind = 'text', isImage = false,
  provider = '', model = '', usage = null, success = true, errorMessage = '',
  latencyMs = null, isMock = false, context = '', estimatedCostUsd = undefined,
  toolNames = undefined, subflow = undefined, iterationIndex = undefined,
  isRetry = undefined, retryReason = undefined, isNested = undefined,
  freeformTurnToken = undefined, taggerSource = undefined,
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
    // Explicit params win (installAiCallTelemetry.js derives toolNames from the response payload
    // itself, which the ALS context never carries); everything else falls back to whatever the
    // freeform turn code staged on the shared context via updateAiTelemetryContext just before
    // this call was made.
    const resolvedToolNames = toolNames !== undefined ? toolNames : (telemetryContext.toolNames || '')
    const resolvedSubflow = subflow !== undefined ? subflow : (telemetryContext.subflow || '')
    const resolvedIterationIndex = iterationIndex !== undefined ? iterationIndex : telemetryContext.iterationIndex
    const resolvedIsRetry = isRetry !== undefined ? isRetry : Boolean(telemetryContext.isRetry)
    const resolvedRetryReason = retryReason !== undefined ? retryReason : (telemetryContext.retryReason || '')
    const resolvedIsNested = isNested !== undefined ? isNested : Boolean(telemetryContext.isNested)
    const resolvedFreeformTurnToken = freeformTurnToken !== undefined ? freeformTurnToken : (telemetryContext.freeformTurnToken || '')
    const resolvedTaggerSource = normalizeTaggerSource(
      taggerSource !== undefined ? taggerSource : telemetryContext.taggerSource
    )
    db.prepare(`
      INSERT INTO ai_call_log (
        flow, endpoint, session_id, call_kind, is_image, provider, model, success,
        error_message, input_tokens, output_tokens, cache_read_input_tokens,
        cache_creation_input_tokens, total_tokens, estimated_cost_usd, latency_ms,
        is_mock, context, freeform_turn_token, iteration_index, subflow, tool_names,
        is_retry, retry_reason, is_nested, tagger_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      resolvedFlow, resolvedEndpoint, resolvedSessionId, callKind, isImage ? 1 : 0,
      provider, model, success ? 1 : 0, String(errorMessage || '').slice(0, 1000),
      numberOrZero(normalizedUsage?.inputTokens), numberOrZero(normalizedUsage?.outputTokens),
      numberOrZero(normalizedUsage?.cacheReadInputTokens), numberOrZero(normalizedUsage?.cacheCreationInputTokens),
      numberOrZero(normalizedUsage?.totalTokens), Number.isFinite(Number(cost)) ? Number(cost) : null,
      Number.isFinite(Number(latencyMs)) ? Math.round(Number(latencyMs)) : null,
      isMock ? 1 : 0, contextText.slice(0, 4000),
      String(resolvedFreeformTurnToken || ''),
      Number.isFinite(Number(resolvedIterationIndex)) ? Number(resolvedIterationIndex) : null,
      String(resolvedSubflow || ''), String(resolvedToolNames || ''),
      resolvedIsRetry ? 1 : 0, String(resolvedRetryReason || ''), resolvedIsNested ? 1 : 0,
      resolvedTaggerSource
    )
  } catch (err) {
    console.warn('[ai-call-telemetry] failed to persist call log:', err?.message || err)
  }
}

// Runs once, right after persistFreeformGenerationRun inserts the turn's summary row and learns its
// id. Every ai_call_log row this turn wrote already carries freeform_turn_token (set at call time,
// before that id existed); this correlates them to the real foreign key in one UPDATE rather than
// holding the insert open across every provider call in the turn. Best-effort, like logAiCall: a
// diagnostics-ledger failure must never surface as a stylist request failure.
export function backfillFreeformRunId({ freeformTurnToken = '', freeformRunId = null } = {}) {
  if (!freeformTurnToken || !Number.isFinite(Number(freeformRunId))) return
  try {
    ensureAiCallLogTable()
    db.prepare(`
      UPDATE ai_call_log SET freeform_run_id = ?
      WHERE freeform_turn_token = ? AND freeform_run_id IS NULL
    `).run(Number(freeformRunId), String(freeformTurnToken))
  } catch (err) {
    console.warn('[ai-call-telemetry] failed to backfill freeform_run_id:', err?.message || err)
  }
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
      provider,
      model,
      inputTokens,
      outputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
      totalTokens: inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens,
    }
  }
  const inputTokens = numberOrZero(raw.prompt_tokens ?? raw.input_tokens)
  const outputTokens = numberOrZero(raw.completion_tokens ?? raw.output_tokens)
  const cacheReadInputTokens = numberOrZero(raw.prompt_tokens_details?.cached_tokens ?? raw.input_tokens_details?.cached_tokens)
  return {
    provider,
    model,
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens: 0,
    totalTokens: numberOrZero(raw.total_tokens) || inputTokens + outputTokens,
  }
}
