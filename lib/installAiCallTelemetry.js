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
      })
      throw err
    }
  }
}

ensureAiCallLogTable()
patchSdkFetchWithTimeout(Anthropic, 'anthropic')
patchSdkFetchWithTimeout(OpenAI, 'openai')
