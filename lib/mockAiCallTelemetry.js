import { classifyAiFlow, getAiTelemetryContext, logAiCall } from './aiCallTelemetry.js'

const MOCK_PATCH_MARKER = Symbol.for('wardrobe.aiCallTelemetry.mockPatched')

function mockCallKind(system = '', result = null) {
  const text = String(system || '')
  if (text.includes('Classify one wardrobe-stylist request into an execution profile')) return 'structured'
  if (text.includes('structured response') || (result && typeof result === 'object')) return 'structured'
  const flow = classifyAiFlow(getAiTelemetryContext()?.originalUrl || '').flow
  if (flow === 'ask') return 'tool_loop'
  return 'text'
}

// WARDROBE_MOCK_AI/test mode never crosses the network boundary observed by
// installAiFetchTelemetry(). Wrap the existing canned-response handler so sandbox verification can
// still prove flow attribution and schema writes. These rows are explicitly is_mock=1, carry no
// tokens/cost, and are excluded from spend reports.
export function installMockAiCallTelemetry() {
  if (globalThis[MOCK_PATCH_MARKER]) return
  const original = globalThis.__WARDROBE_AI_TEST_HANDLER__
  if (typeof original !== 'function') return

  globalThis.__WARDROBE_AI_TEST_HANDLER__ = args => {
    const startedAt = Date.now()
    try {
      const result = original(args)
      void logAiCall({
        callKind: mockCallKind(args?.system, result),
        provider: 'mock',
        model: 'mock',
        success: true,
        latencyMs: Date.now() - startedAt,
        isMock: true,
        context: { source: 'WARDROBE_MOCK_AI' },
      })
      return result
    } catch (err) {
      void logAiCall({
        callKind: mockCallKind(args?.system),
        provider: 'mock',
        model: 'mock',
        success: false,
        errorMessage: err?.message || String(err),
        latencyMs: Date.now() - startedAt,
        isMock: true,
        context: { source: 'WARDROBE_MOCK_AI' },
      })
      throw err
    }
  }
  globalThis[MOCK_PATCH_MARKER] = true
}
