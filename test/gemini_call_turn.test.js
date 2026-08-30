// Gemini evaluation slice follow-up (2026-08-30 provider-consistency audit). gemini_tool_loop_
// adapter.test.js exercises the canonical-history <-> wire-shape transform helpers, but never the
// function that actually calls the Gemini API and interprets its response: callGeminiTurn. The
// ordinary mock path (askStylistWithTools -> takeTestAiResponse) short-circuits before ever
// reaching a provider branch, so callGeminiTurn's own status/truncation/malformed-call handling
// was untested. These tests call it directly against a stubbed @google/genai client — no network.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'

const tmpRoot = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gemini-call-turn-test-'))
process.env.WARDROBE_DB_PATH = nodePath.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = nodePath.join(tmpRoot, 'uploads')
process.env.NODE_ENV = 'test'
// Deliberate opt-in (see assertProviderKey's comment in provider.js): without this,
// NODE_ENV=test always refuses to reach a provider branch at all. Safe here because
// GoogleGenAI.prototype.interactions is stubbed below — nothing ever hits the real network.
process.env.WARDROBE_ALLOW_TEST_PROVIDER_NETWORK = 'true'
process.env.GEMINI_API_KEY = 'test-key'

const { GoogleGenAI } = await import('@google/genai')
const { callGeminiTurn } = await import('../styling-engine/provider.js')

// Queue of fake `interactions.create` responses/behaviors, consumed one per call. Each entry is
// either a plain object (returned as the resolved interaction) or a function of the request.
let responseQueue = []
const requestsSeen = []
function queueGeminiResponse(entryOrFn) {
  responseQueue.push(entryOrFn)
}

Object.defineProperty(GoogleGenAI.prototype, 'interactions', {
  configurable: true,
  get() {
    return {
      create: async (request) => {
        requestsSeen.push(request)
        const entry = responseQueue.shift()
        if (entry === undefined) throw new Error('test setup error: no queued Gemini response left')
        if (typeof entry === 'function') return entry(request)
        if (entry instanceof Error) throw entry
        return entry
      }
    }
  }
})

test.beforeEach(() => {
  responseQueue = []
  requestsSeen.length = 0
})

function baseArgs(overrides = {}) {
  return {
    plainSystem: 'system prompt',
    unsyncedEntries: [{ role: 'user', content: 'what should I wear?' }],
    continuation: null,
    tools: [],
    maxTokens: 1200,
    model: 'gemini-3.7-flash',
    ...overrides
  }
}

test('a completed interaction with only a model_output step returns its text with no tool calls', async () => {
  queueGeminiResponse({
    id: 'interaction_1', status: 'completed',
    steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Wear the blue sweater.' }] }],
    usage: { total_tokens: 10, total_input_tokens: 5, total_output_tokens: 5 },
  })
  const result = await callGeminiTurn(baseArgs())
  assert.equal(result.text, 'Wear the blue sweater.')
  assert.equal(result.hasToolCalls, false)
  assert.deepEqual(result.toolCalls, [])
  assert.equal(result.continuation, 'interaction_1')
  assert.equal(result.noMessage, undefined)
})

test('parallel tool calls preserve id, name, args and ordering', async () => {
  queueGeminiResponse({
    id: 'interaction_2', status: 'requires_action',
    steps: [
      { type: 'function_call', id: 'call_a', name: 'search_wardrobe', arguments: { category: 'top' } },
      { type: 'function_call', id: 'call_b', name: 'view_pieces', arguments: { ids: [1, 2] } },
    ],
    usage: { total_tokens: 20, total_input_tokens: 15, total_output_tokens: 5 },
  })
  const result = await callGeminiTurn(baseArgs({ tools: [{ name: 'search_wardrobe' }, { name: 'view_pieces' }] }))
  assert.equal(result.hasToolCalls, true)
  assert.deepEqual(result.toolCalls, [
    { id: 'call_a', name: 'search_wardrobe', args: { category: 'top' } },
    { id: 'call_b', name: 'view_pieces', args: { ids: [1, 2] } },
  ])
})

test('narration alongside tool calls is preserved as text, not discarded', async () => {
  queueGeminiResponse({
    id: 'interaction_3', status: 'requires_action',
    steps: [
      { type: 'model_output', content: [{ type: 'text', text: 'Let me check your wardrobe.' }] },
      { type: 'function_call', id: 'call_c', name: 'search_wardrobe', arguments: {} },
    ],
    usage: { total_tokens: 12, total_input_tokens: 10, total_output_tokens: 2 },
  })
  const result = await callGeminiTurn(baseArgs({ tools: [{ name: 'search_wardrobe' }] }))
  assert.equal(result.text, 'Let me check your wardrobe.')
  assert.equal(result.hasToolCalls, true)
  assert.equal(result.toolCalls.length, 1)
})

test('hasToolCalls is driven by function_call presence, not the deprecated requires_action status string', async () => {
  // @google/genai's own InteractionStatus enum marks REQUIRES_ACTION deprecated (use IDLE) — a
  // real response could carry function_call steps under a different status string. Gating on the
  // exact 'requires_action' value would silently drop these real tool calls.
  queueGeminiResponse({
    id: 'interaction_4', status: 'completed',
    steps: [{ type: 'function_call', id: 'call_d', name: 'declare_intent', arguments: { want: 'cards' } }],
    usage: { total_tokens: 8, total_input_tokens: 6, total_output_tokens: 2 },
  })
  const result = await callGeminiTurn(baseArgs({ tools: [{ name: 'declare_intent' }] }))
  assert.equal(result.hasToolCalls, true)
  assert.equal(result.toolCalls[0].id, 'call_d')
})

test('an empty response (no tool calls, no text) short-circuits as noMessage, mirroring the OpenAI branch', async () => {
  queueGeminiResponse({
    id: 'interaction_5', status: 'completed',
    steps: [],
    output_text: '',
    usage: { total_tokens: 4, total_input_tokens: 4, total_output_tokens: 0 },
  })
  const result = await callGeminiTurn(baseArgs())
  assert.equal(result.noMessage, true)
  assert.equal(result.text, '')
  assert.equal(result.hasToolCalls, false)
})

test('a failed interaction status throws instead of being read as a successful reply', async () => {
  queueGeminiResponse({
    id: 'interaction_6', status: 'failed',
    errors: [{ message: 'internal platform error' }],
    steps: [{ type: 'model_output', content: [{ type: 'text', text: 'partial garbage' }] }],
    usage: { total_tokens: 3, total_input_tokens: 3, total_output_tokens: 0 },
  })
  await assert.rejects(
    () => callGeminiTurn(baseArgs()),
    err => {
      assert.match(err.message, /failed/i)
      assert.match(err.message, /internal platform error/)
      return true
    }
  )
})

test('a cancelled interaction status throws', async () => {
  queueGeminiResponse({ id: 'interaction_7', status: 'cancelled', steps: [], usage: null })
  await assert.rejects(() => callGeminiTurn(baseArgs()), /cancelled/i)
})

test('a malformed function_call step (missing id) throws at its origin rather than propagating undefined', async () => {
  queueGeminiResponse({
    id: 'interaction_8', status: 'requires_action',
    steps: [{ type: 'function_call', name: 'search_wardrobe', arguments: {} }],
    usage: { total_tokens: 5, total_input_tokens: 5, total_output_tokens: 0 },
  })
  await assert.rejects(
    () => callGeminiTurn(baseArgs({ tools: [{ name: 'search_wardrobe' }] })),
    /without a usable id\/name/
  )
})

test('a malformed function_call step (missing name) also throws', async () => {
  queueGeminiResponse({
    id: 'interaction_9', status: 'requires_action',
    steps: [{ type: 'function_call', id: 'call_e', arguments: {} }],
    usage: { total_tokens: 5, total_input_tokens: 5, total_output_tokens: 0 },
  })
  await assert.rejects(
    () => callGeminiTurn(baseArgs({ tools: [{ name: 'search_wardrobe' }] })),
    /without a usable id\/name/
  )
})

test('an incomplete status (token-cap truncation) maps to usage.stopReason max_tokens', async () => {
  queueGeminiResponse({
    id: 'interaction_10', status: 'incomplete',
    steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Wear the ' }] }],
    usage: { total_tokens: 1200, total_input_tokens: 1100, total_output_tokens: 100 },
  })
  const result = await callGeminiTurn(baseArgs())
  assert.equal(result.usage.stopReason, 'max_tokens')
})

test('a budget_exceeded status also maps to usage.stopReason max_tokens', async () => {
  queueGeminiResponse({
    id: 'interaction_11', status: 'budget_exceeded',
    steps: [], output_text: 'partial',
    usage: { total_tokens: 1200, total_input_tokens: 1100, total_output_tokens: 100 },
  })
  const result = await callGeminiTurn(baseArgs())
  assert.equal(result.usage.stopReason, 'max_tokens')
})

test('a genuinely completed response has no stopReason', async () => {
  queueGeminiResponse({
    id: 'interaction_12', status: 'completed',
    steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Done.' }] }],
    usage: { total_tokens: 10, total_input_tokens: 8, total_output_tokens: 2 },
  })
  const result = await callGeminiTurn(baseArgs())
  assert.equal(result.usage.stopReason, null)
})

test('a continuation call omits system_instruction and sends previous_interaction_id instead', async () => {
  queueGeminiResponse({
    id: 'interaction_13', status: 'completed',
    steps: [{ type: 'model_output', content: [{ type: 'text', text: 'ok' }] }],
    usage: { total_tokens: 5, total_input_tokens: 4, total_output_tokens: 1 },
  })
  await callGeminiTurn(baseArgs({ continuation: 'prior_interaction_id' }))
  const sent = requestsSeen.at(-1)
  assert.equal(sent.previous_interaction_id, 'prior_interaction_id')
  assert.equal(sent.system_instruction, undefined)
})

test('the first call of a turn (no continuation) sends system_instruction and omits previous_interaction_id', async () => {
  queueGeminiResponse({
    id: 'interaction_14', status: 'completed',
    steps: [{ type: 'model_output', content: [{ type: 'text', text: 'ok' }] }],
    usage: { total_tokens: 5, total_input_tokens: 4, total_output_tokens: 1 },
  })
  await callGeminiTurn(baseArgs({ continuation: null }))
  const sent = requestsSeen.at(-1)
  assert.equal(sent.system_instruction, 'system prompt')
  assert.equal(sent.previous_interaction_id, undefined)
})

test('a network/API error from interactions.create rejects and is not swallowed', async () => {
  queueGeminiResponse(new Error('ECONNRESET'))
  await assert.rejects(() => callGeminiTurn(baseArgs()), /ECONNRESET/)
})
