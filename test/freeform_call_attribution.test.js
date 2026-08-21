import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Cache-efficiency investigation (2026-08-21): freeform_generation_runs only ever stored turn-level
// sums (provider_iterations, provider_input_tokens, ...), so a turn that took 4 provider calls could
// not say which call cost what, which was a retry, or which was the nested composer call hidden
// inside generate_outfits. This proves the per-call attribution added to ai_call_log: freeform_run_id
// (via freeform_turn_token backfill), iteration_index, subflow, tool_names, is_retry/retry_reason,
// is_nested — using the real installed Anthropic SDK against an explicit synthetic fetch, the same
// harness test/ai_call_telemetry.test.js uses to prove the SDK-transport-boundary hook without any
// real network traffic. No paid provider call is made anywhere in this file.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-freeform-call-attribution-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

function anthropicToolUseResponse(toolName, usage) {
  return new Response(JSON.stringify({
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
    content: [
      { type: 'text', text: 'checking the wardrobe' },
      { type: 'tool_use', id: 'tool_1', name: toolName, input: {} }
    ],
    stop_reason: 'tool_use', stop_sequence: null, usage
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function anthropicFinalTextResponse(usage) {
  return new Response(JSON.stringify({
    id: 'msg_test_final', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
    content: [{ type: 'text', text: 'Here is your outfit.' }],
    stop_reason: 'end_turn', stop_sequence: null, usage
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

// inferCallKind (lib/aiCallTelemetry.js) only classifies a call as 'tool_loop' when the request
// body actually carries tools — exactly like the real stylist tool loop always does. Without this,
// tool_names derivation is skipped and every row comes back with tool_names: ''.
const STUB_TOOLS = [{ name: 'declare_intent', description: 'stub', input_schema: { type: 'object', properties: {} } }]

let callIndex = 0
const scriptedResponses = []
const syntheticFetch = async () => {
  const next = scriptedResponses[callIndex]
  callIndex += 1
  if (!next) throw new Error(`Unexpected synthetic fetch call #${callIndex}`)
  return next
}

const telemetry = await import('../lib/aiCallTelemetry.js')
await import('../lib/installAiCallTelemetry.js')
const { default: Anthropic } = await import('@anthropic-ai/sdk')
const { db } = await import('../db.js')
const { nextFreeformCallIndex } = await import('../styling-engine/tools.js')

async function waitForRows(count) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const n = db.prepare('SELECT COUNT(*) AS n FROM ai_call_log').get()?.n || 0
      if (n >= count) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${count} ai_call_log rows`)
}

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

test('ordinary tool-loop calls get sequential iteration_index, subflow and per-call tool_names', async () => {
  callIndex = 0
  scriptedResponses.length = 0
  scriptedResponses.push(
    anthropicToolUseResponse('declare_intent', { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }),
    anthropicFinalTextResponse({ input_tokens: 25, output_tokens: 40, cache_read_input_tokens: 150, cache_creation_input_tokens: 0 })
  )

  const toolContext = {}
  const anthropic = new Anthropic({ apiKey: 'test-key', maxRetries: 0, fetch: syntheticFetch })
  const freeformTurnToken = 'turn-token-ordinary-loop'
  toolContext.freeformTurnToken = freeformTurnToken

  await telemetry.runWithAiTelemetryContext({ originalUrl: '/api/ai/ask', sessionId: 'thread_test_ordinary' }, async () => {
    // Mirrors exactly what styling-engine/provider.js's askStylistWithTools loop does immediately
    // before each provider call: stage this call's attribution on the shared context, then fire it.
    telemetry.updateAiTelemetryContext({
      freeformTurnToken, subflow: 'stylist_tool_loop',
      iterationIndex: nextFreeformCallIndex(toolContext), isRetry: false, retryReason: '', isNested: false,
    })
    await anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 20, tools: STUB_TOOLS, messages: [{ role: 'user', content: 'what should I wear' }] })

    telemetry.updateAiTelemetryContext({
      freeformTurnToken, subflow: 'stylist_tool_loop',
      iterationIndex: nextFreeformCallIndex(toolContext), isRetry: false, retryReason: '', isNested: false,
    })
    await anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 20, tools: STUB_TOOLS, messages: [{ role: 'user', content: 'what should I wear' }] })
  })

  await waitForRows(2)
  const rows = db.prepare(
    "SELECT * FROM ai_call_log WHERE freeform_turn_token = ? ORDER BY iteration_index"
  ).all(freeformTurnToken)
  assert.equal(rows.length, 2)

  assert.equal(rows[0].iteration_index, 1)
  assert.equal(rows[0].subflow, 'stylist_tool_loop')
  assert.equal(rows[0].tool_names, 'declare_intent')
  assert.equal(rows[0].is_retry, 0)
  assert.equal(rows[0].is_nested, 0)
  assert.equal(rows[0].freeform_run_id, null, 'not backfilled yet')

  assert.equal(rows[1].iteration_index, 2)
  assert.equal(rows[1].subflow, 'stylist_tool_loop')
  assert.equal(rows[1].tool_names, '', 'the final text-only call requests no tools')
  assert.equal(rows[1].input_tokens, 25)
  assert.equal(rows[1].cache_read_input_tokens, 150)

  // persistFreeformGenerationRun's real flow: insert the turn's summary row, learn its id, then
  // correlate every ai_call_log row this turn wrote back to it in one UPDATE.
  telemetry.backfillFreeformRunId({ freeformTurnToken, freeformRunId: 4242 })
  const backfilled = db.prepare(
    'SELECT freeform_run_id FROM ai_call_log WHERE freeform_turn_token = ?'
  ).all(freeformTurnToken)
  assert.deepEqual(backfilled.map(r => r.freeform_run_id), [4242, 4242])
})

test('a retry call is tagged is_retry with the blocking check as retry_reason', async () => {
  callIndex = 0
  scriptedResponses.length = 0
  scriptedResponses.push(
    anthropicFinalTextResponse({ input_tokens: 10, output_tokens: 8, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  )

  const toolContext = {}
  const anthropic = new Anthropic({ apiKey: 'test-key', maxRetries: 0, fetch: syntheticFetch })
  const freeformTurnToken = 'turn-token-retry'

  await telemetry.runWithAiTelemetryContext({ originalUrl: '/api/ai/ask', sessionId: 'thread_test_retry' }, async () => {
    // Mirrors what the loop does the iteration right after an output-guard check blocks: the
    // pending reason from the previous iteration is staged as this call's retry attribution.
    telemetry.updateAiTelemetryContext({
      freeformTurnToken, subflow: 'stylist_tool_loop', iterationIndex: nextFreeformCallIndex(toolContext),
      isRetry: true, retryReason: 'zeroResultContradiction', isNested: false,
    })
    await anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 20, messages: [{ role: 'user', content: 'test' }] })
  })

  await waitForRows(3)
  const row = db.prepare('SELECT * FROM ai_call_log WHERE freeform_turn_token = ?').get(freeformTurnToken)
  assert.ok(row)
  assert.equal(row.is_retry, 1)
  assert.equal(row.retry_reason, 'zeroResultContradiction')
})

test('a nested composer call is tagged is_nested and shares the turn token, not the outer loop subflow', async () => {
  callIndex = 0
  scriptedResponses.length = 0
  scriptedResponses.push(
    anthropicToolUseResponse('generate_outfits', { input_tokens: 30, output_tokens: 10, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 }),
    anthropicFinalTextResponse({ input_tokens: 900, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 5000 })
  )

  const toolContext = {}
  const anthropic = new Anthropic({ apiKey: 'test-key', maxRetries: 0, fetch: syntheticFetch })
  const freeformTurnToken = 'turn-token-nested'

  await telemetry.runWithAiTelemetryContext({ originalUrl: '/api/ai/ask', sessionId: 'thread_test_nested' }, async () => {
    // Outer loop iteration that calls the generate_outfits tool.
    telemetry.updateAiTelemetryContext({
      freeformTurnToken, subflow: 'stylist_tool_loop', iterationIndex: nextFreeformCallIndex(toolContext),
      isRetry: false, retryReason: '', isNested: false,
    })
    await anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 20, tools: STUB_TOOLS, messages: [{ role: 'user', content: 'plan me an outfit' }] })

    // Mirrors exactly what styling-engine/tools.js's generate_outfits case stages immediately
    // before generateWholeWardrobeOutfitsVisualInternal's own real provider call.
    telemetry.updateAiTelemetryContext({
      freeformTurnToken, subflow: 'nested_composer', iterationIndex: nextFreeformCallIndex(toolContext),
      isRetry: false, retryReason: '', isNested: true,
    })
    await anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: 'compose the wardrobe' }] })
  })

  await waitForRows(5) // cumulative across this file's earlier tests: 2 + 1 + this test's 2
  const rows = db.prepare(
    'SELECT * FROM ai_call_log WHERE freeform_turn_token = ? ORDER BY iteration_index'
  ).all(freeformTurnToken)
  assert.equal(rows.length, 2)

  assert.equal(rows[0].subflow, 'stylist_tool_loop')
  assert.equal(rows[0].tool_names, 'generate_outfits')
  assert.equal(rows[0].is_nested, 0)

  assert.equal(rows[1].subflow, 'nested_composer')
  assert.equal(rows[1].is_nested, 1)
  assert.equal(rows[1].iteration_index, 2)
  // The largest single call in the turn — exactly the call docs/message-lifecycle.md's
  // freeform_generation_runs aggregate could never separate from the rest of the turn's cost.
  assert.equal(rows[1].cache_creation_input_tokens, 5000)
})

test('askStylistWithTools stages attribution before each provider call, guarded on freeformTurnToken', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'styling-engine/provider.js'), 'utf8')
  const loopStart = src.indexOf('for (let iter = 0; iter < maxProviderIterations; iter++) {')
  assert.ok(loopStart > -1)
  const loopHeader = src.slice(loopStart, loopStart + 800)
  assert.match(loopHeader, /if \(toolContext\.freeformTurnToken\)/, 'must not tag the outfit-evaluation follow-up caller of this same loop')
  assert.match(loopHeader, /subflow: 'stylist_tool_loop'/)
  assert.match(loopHeader, /nextFreeformCallIndex\(toolContext\)/)
  assert.match(src, /toolContext\._pendingFreeformRetryReason = check\.blockType/)
})

test('the generate_outfits tool case stages nested_composer attribution before its internal composer call', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'styling-engine/tools.js'), 'utf8')
  const caseStart = src.indexOf("case 'generate_outfits': {")
  const internalCallAt = src.indexOf('generateOutfitsForPieceInternal({', caseStart)
  assert.ok(caseStart > -1 && internalCallAt > caseStart)
  const staging = src.slice(caseStart, internalCallAt)
  assert.match(staging, /subflow: 'nested_composer'/)
  assert.match(staging, /isNested: true/)
  assert.match(staging, /if \(toolContext\.freeformTurnToken\)/)
})
