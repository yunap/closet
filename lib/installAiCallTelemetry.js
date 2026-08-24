// Side-effect bootstrap imported before styling-engine/provider.js from server.js.
//
// Both installed SDKs resolve their default HTTP transport through their own node-runtime shims
// (node-fetch), so patching globalThis.fetch does not observe real provider traffic. Instrument the
// shared Stainless fetchWithTimeout boundary instead: every actual HTTP attempt, including SDK
// retries, crosses this method while the SDK keeps its native transport unchanged.
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import {
  ensureAiCallLogTable,
  getAiTelemetryContext,
  inferCallKind,
  logAiCall,
  normalizeProviderUsage,
} from './aiCallTelemetry.js'

const SDK_PATCH_MARKER = Symbol.for('wardrobe.aiCallTelemetry.sdkFetchWithTimeoutPatched')

function requestBody(init = {}) {
  if (typeof init?.body !== 'string') return {}
  try { return JSON.parse(init.body) } catch { return {} }
}

function errorMessage(payload = {}, response = null) {
  return String(
    payload?.error?.message ||
    payload?.message ||
    (!response?.ok ? `HTTP ${response?.status || 'error'}` : '') ||
    ''
  )
}

function providerPath(url = '') {
  try { return new URL(String(url)).pathname } catch { return '' }
}

function toolNamesFromResponsePayload(payload = {}, provider = '') {
  if (provider === 'anthropic') {
    const blocks = Array.isArray(payload?.content) ? payload.content : []
    return blocks.filter(b => b?.type === 'tool_use').map(b => b?.name).filter(Boolean).join(',')
  }
  const toolCalls = payload?.choices?.[0]?.message?.tool_calls
  return Array.isArray(toolCalls) ? toolCalls.map(tc => tc?.function?.name).filter(Boolean).join(',') : ''
}

function patchSdkFetchWithTimeout(Client, provider) {
  const proto = Client?.prototype
  if (!proto || proto[SDK_PATCH_MARKER]) return
  const original = proto.fetchWithTimeout
  if (typeof original !== 'function') {
    console.warn(`[ai-call-telemetry] ${provider} SDK has no fetchWithTimeout method; provider calls will not be observed`)
    return
  }

  Object.defineProperty(proto, SDK_PATCH_MARKER, { value: true, configurable: false })
  proto.fetchWithTimeout = async function telemetryFetchWithTimeout(url, init, ms, controller) {
    const startedAt = Date.now()
    const body = requestBody(init)
    const model = String(body?.model || '')
    const callKind = inferCallKind({ provider, url, body })
    const isImage = callKind === 'image'
    const baseContext = {
      providerPath: providerPath(url),
      responseApi: String(url).includes('/responses'),
    }
    // Freeform turns stage subflow/iteration_index/is_retry/retry_reason/is_nested/turn_token on the
    // shared AsyncLocalStorage context right before each call (updateAiTelemetryContext), then fire
    // it. But this hook's own logAiCall write happens inside an async .then() AFTER the response
    // resolves — by which point the *next* iteration may already have called
    // updateAiTelemetryContext again, mutating the same shared store out from under this call's
    // write. fetchWithTimeout itself runs synchronously up to the `await original.call(...)` below,
    // so a snapshot taken right here, before that await, is captured at the correct moment: no other
    // code in this request can run between staging this call's context and reading it. Passing that
    // snapshot's fields through explicitly (instead of letting logAiCall re-read the live, possibly-
    // already-mutated context) is what actually closes the race, not just the timing of the fetch.
    const freeformSnapshot = { ...getAiTelemetryContext() }

    try {
      const response = await original.call(this, url, init, ms, controller)
      const latencyMs = Date.now() - startedAt
      const clone = response.clone()
      void clone.json()
        .then(payload => logAiCall({
          callKind,
          isImage,
          provider,
          model,
          usage: normalizeProviderUsage(payload, provider, model),
          success: response.ok,
          errorMessage: errorMessage(payload, response),
          latencyMs,
          context: { ...baseContext, status: response.status },
          toolNames: callKind === 'tool_loop' ? toolNamesFromResponsePayload(payload, provider) : '',
          freeformTurnToken: freeformSnapshot.freeformTurnToken,
          subflow: freeformSnapshot.subflow,
          iterationIndex: freeformSnapshot.iterationIndex,
          isRetry: freeformSnapshot.isRetry,
          retryReason: freeformSnapshot.retryReason,
          isNested: freeformSnapshot.isNested,
          taggerSource: freeformSnapshot.taggerSource,
        }))
        .catch(() => logAiCall({
          callKind,
          isImage,
          provider,
          model,
          success: response.ok,
          errorMessage: response.ok ? '' : `HTTP ${response.status}`,
          latencyMs,
          context: { ...baseContext, status: response.status, usageUnavailable: true },
          toolNames: '', // no parsed payload here to derive tool names from
          freeformTurnToken: freeformSnapshot.freeformTurnToken,
          subflow: freeformSnapshot.subflow,
          iterationIndex: freeformSnapshot.iterationIndex,
          isRetry: freeformSnapshot.isRetry,
          retryReason: freeformSnapshot.retryReason,
          isNested: freeformSnapshot.isNested,
          taggerSource: freeformSnapshot.taggerSource,
        }))
      return response
    } catch (err) {
      await logAiCall({
        callKind,
        isImage,
        provider,
        model,
        success: false,
        errorMessage: err?.message || String(err),
        latencyMs: Date.now() - startedAt,
        context: { ...baseContext, networkError: true },
        toolNames: '',
        freeformTurnToken: freeformSnapshot.freeformTurnToken,
        subflow: freeformSnapshot.subflow,
        iterationIndex: freeformSnapshot.iterationIndex,
        isRetry: freeformSnapshot.isRetry,
        retryReason: freeformSnapshot.retryReason,
        isNested: freeformSnapshot.isNested,
        taggerSource: freeformSnapshot.taggerSource,
      })
      throw err
    }
  }
}

ensureAiCallLogTable()
patchSdkFetchWithTimeout(Anthropic, 'anthropic')
patchSdkFetchWithTimeout(OpenAI, 'openai')
