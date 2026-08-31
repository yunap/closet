// Gemini evaluation slice, Stage B (plan: quizzical-foraging-boot). These tests exercise the
// canonical-history <-> wire-shape mapping directly, without a network call — the real Anthropic/
// OpenAI branches are exercised end-to-end by aiEndpointContracts.test.js / aiErrorHandling.test.js
// / ai_call_telemetry.test.js via takeTestAiResponse, and this file's job is to prove the NEW
// canonical shape round-trips correctly for all three providers, plus the Gemini-specific usage/
// stop-reason normalization confirmed against the real API in the Stage-0 spike
// (scratch/gemini_tool_loop_spike_findings.md).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'

const tmpRoot = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gemini-adapter-test-'))
process.env.WARDROBE_DB_PATH = nodePath.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = nodePath.join(tmpRoot, 'uploads')

const {
  canonicalHistoryToAnthropicMessages,
  canonicalHistoryToOpenAiMessages,
  canonicalHistoryToGeminiInput,
  canonicalContentToGeminiParts,
  toGeminiFunctionDeclaration,
  toOpenAiFunctionTool,
  normalizeAiUsage,
} = await import('../styling-engine/provider.js')
const { STYLIST_TOOLS } = await import('../styling-engine/tools.js')

// A representative canonical history: an initial user turn with an image, a model turn that made
// two tool calls (parallel — Gemini supports this, the array shape already allows it), and the
// two corresponding tool results, one of which returned an image.
function sampleHistory() {
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What should I wear hiking tomorrow?' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
      ],
    },
    {
      role: 'assistant',
      text: 'Let me check your wardrobe.',
      toolCalls: [
        { id: 'call_1', name: 'declare_intent', args: { want: 'cards' } },
        { id: 'call_2', name: 'search_wardrobe', args: { category: 'top' } },
      ],
    },
    { role: 'tool_result', toolCallId: 'call_1', name: 'declare_intent', text: '{"status":"success"}', images: [] },
    {
      role: 'tool_result',
      toolCallId: 'call_2',
      name: 'search_wardrobe',
      text: '{"pieces":[{"id":1}]}',
      images: [{ mime: 'image/jpeg', base64: 'BBBB', label: 'ID 1: Whale stripe tee' }],
    },
  ]
}

test('canonicalHistoryToAnthropicMessages preserves text+image on the original message and reconstructs tool_use/tool_result blocks', () => {
  const mapped = canonicalHistoryToAnthropicMessages(sampleHistory())
  assert.equal(mapped.length, 4)
  assert.equal(mapped[0].role, 'user')
  assert.equal(mapped[0].content[0].type, 'text')
  assert.equal(mapped[0].content[1].type, 'image')
  assert.equal(mapped[0].content[1].source.data, 'AAAA')

  assert.equal(mapped[1].role, 'assistant')
  const toolUseBlocks = mapped[1].content.filter(b => b.type === 'tool_use')
  assert.equal(toolUseBlocks.length, 2)
  assert.equal(toolUseBlocks[0].id, 'call_1')
  assert.equal(toolUseBlocks[1].name, 'search_wardrobe')

  assert.equal(mapped[2].content[0].type, 'tool_result')
  assert.equal(mapped[2].content[0].tool_use_id, 'call_1')
  // the image-bearing tool result carries its image as a real Anthropic image block, not JSON text
  const secondToolResultBlocks = mapped[3].content[0].content
  assert.ok(secondToolResultBlocks.some(b => b.type === 'image' && b.source.data === 'BBBB'))
})

test('canonicalHistoryToOpenAiMessages emits one assistant message with tool_calls, one tool message per call, then a single trailing image message', () => {
  const mapped = canonicalHistoryToOpenAiMessages(sampleHistory())
  const assistantMsg = mapped.find(m => m.role === 'assistant')
  assert.equal(assistantMsg.tool_calls.length, 2)
  assert.equal(JSON.parse(assistantMsg.tool_calls[1].function.arguments).category, 'top')

  const toolMsgs = mapped.filter(m => m.role === 'tool')
  assert.equal(toolMsgs.length, 2)
  assert.equal(toolMsgs[0].tool_call_id, 'call_1')

  // images from ALL tool results in the run are collected into exactly one trailing user message
  // (distinct from the ORIGINAL user turn, which is also a user/array-content message)
  const toolImageMsgs = mapped.filter(m =>
    m.role === 'user' && Array.isArray(m.content) && m.content.some(c => c.type === 'image_url' && c.image_url.url.includes('BBBB')))
  assert.equal(toolImageMsgs.length, 1)
})

test('canonicalHistoryToGeminiInput drops the model\'s own turn (Gemini already has it via previous_interaction_id) and emits typed function_result content, including a real image part', () => {
  const history = sampleHistory()
  // Simulate the loop's real usage: only entries added since the last Gemini call are passed in —
  // here, everything after the initial user turn (i.e. the assistant turn + both tool results).
  const unsynced = history.slice(1)
  const input = canonicalHistoryToGeminiInput(unsynced)

  assert.ok(input.every(item => item.type !== undefined), 'every Gemini input item must carry a type — the Stage-0 spike found the API 400s without one')
  const functionResults = input.filter(item => item.type === 'function_result')
  assert.equal(functionResults.length, 2)
  assert.equal(functionResults[0].call_id, 'call_1')
  assert.equal(functionResults[0].result[0].type, 'text')

  const secondResultParts = functionResults[1].result
  assert.ok(secondResultParts.some(p => p.type === 'image' && p.data === 'BBBB' && p.mime_type === 'image/jpeg'),
    'the tool-returned image must become a real Gemini image part, not JSON-embedded base64 text (Stage-0 spike: the naive version cost ~32.6k tokens for one follow-up)')
})

test('canonicalHistoryToGeminiInput sends the full initial thread as plain content on the first (unsynced-from-zero) call', () => {
  const input = canonicalHistoryToGeminiInput(sampleHistory().slice(0, 1))
  assert.equal(input.length, 2)
  assert.equal(input[0].type, 'text')
  assert.equal(input[1].type, 'image')
  assert.equal(input[1].data, 'AAAA')
})

test('canonicalContentToGeminiParts handles a plain string and an image_url data-URL block (OpenAI-shaped input reused as-is)', () => {
  assert.deepEqual(canonicalContentToGeminiParts('hello'), [{ type: 'text', text: 'hello' }])
  assert.deepEqual(canonicalContentToGeminiParts(''), [])
  const parts = canonicalContentToGeminiParts([
    { type: 'image_url', image_url: { url: 'data:image/png;base64,CCCC' } },
  ])
  assert.deepEqual(parts, [{ type: 'image', data: 'CCCC', mime_type: 'image/png' }])
})

test('toGeminiFunctionDeclaration reuses the real STYLIST_TOOLS schema field names unchanged', () => {
  const decl = toGeminiFunctionDeclaration({ name: 'view_pieces', description: 'desc', input_schema: { type: 'object', properties: { ids: { type: 'array' } } } })
  assert.equal(decl.type, 'function')
  assert.equal(decl.name, 'view_pieces')
  assert.deepEqual(decl.parameters, { type: 'object', properties: { ids: { type: 'array' } } })
})

// Spec §9 item 1 (docs/future-trip-weather-estimate-spec.md): "Tool schemas for Anthropic, OpenAI,
// and Gemini expose identical user_weather and weather_estimate fields on all four composition
// tools." Anthropic reads STYLIST_TOOLS' input_schema with no projection of its own (see
// callAnthropicTurn), so proving Gemini's and OpenAI's projections both reuse that exact object
// unchanged proves parity across all three — there is no separate per-provider copy that could
// drift independently.
const COMPOSITION_TOOL_NAMES = ['search_wardrobe', 'propose_outfit', 'generate_outfits', 'plan_outfit_set']

test('all four composition tools expose user_weather and weather_estimate in their real STYLIST_TOOLS schema', () => {
  for (const name of COMPOSITION_TOOL_NAMES) {
    const tool = STYLIST_TOOLS.find(t => t.name === name)
    assert.ok(tool, `${name} must exist in STYLIST_TOOLS`)
    // plan_outfit_set carries the fields at both the plan level and each slot's own schema
    // (spec §6.3: a slot can override the plan's weather for its own location/date) — checked
    // separately below; this loop covers the plan-level (or tool-level, for the other three) copy.
    const props = tool.input_schema.properties
    assert.ok(props.user_weather, `${name} must expose user_weather`)
    assert.ok(props.weather_estimate, `${name} must expose weather_estimate`)
    assert.equal(props.user_weather.type, 'object')
    assert.equal(props.weather_estimate.type, 'object')
    assert.deepEqual(props.weather_estimate.required, ['high_f', 'low_f'])
  }
  const planTool = STYLIST_TOOLS.find(t => t.name === 'plan_outfit_set')
  const slotSchema = planTool.input_schema.properties.slots.items.properties
  assert.ok(slotSchema.user_weather, 'plan_outfit_set slots must also expose user_weather')
  assert.ok(slotSchema.weather_estimate, 'plan_outfit_set slots must also expose weather_estimate')
})

test('OpenAI and Gemini tool projections carry the identical user_weather/weather_estimate schema object for every composition tool — no per-provider copy to drift', () => {
  for (const name of COMPOSITION_TOOL_NAMES) {
    const tool = STYLIST_TOOLS.find(t => t.name === name)
    const openAiTool = toOpenAiFunctionTool(tool)
    const geminiTool = toGeminiFunctionDeclaration(tool)
    // Same object reference as the source schema — not merely deepEqual — proving neither
    // projection maintains an independent copy of the weather fields.
    assert.equal(openAiTool.function.parameters, tool.input_schema)
    assert.equal(geminiTool.parameters, tool.input_schema)
    assert.equal(openAiTool.function.parameters.properties.user_weather, tool.input_schema.properties.user_weather)
    assert.equal(geminiTool.parameters.properties.weather_estimate, tool.input_schema.properties.weather_estimate)
  }
})

// Field names below are taken verbatim from a real Interactions API response captured in the
// Stage-0 spike (scratch/gemini_tool_loop_spike_findings.md) — not invented for this test.
test('normalizeAiUsage(gemini) matches the real API field names and folds thought tokens into output', () => {
  const usage = normalizeAiUsage({
    total_tokens: 32986,
    total_input_tokens: 32627,
    total_cached_tokens: 28611,
    total_output_tokens: 77,
    total_thought_tokens: 282,
  }, { provider: 'gemini', model: 'gemini-3.7-flash' })
  assert.equal(usage.inputTokens, 32627)
  assert.equal(usage.cacheReadInputTokens, 28611)
  assert.equal(usage.outputTokens, 77 + 282)
  assert.equal(usage.totalTokens, 32986)
  assert.equal(usage.cacheCreationInputTokens, 0)
})

// TODO (flagged, not resolved here — plan explicitly scopes this out of Stage B): the Stage-0 spike
// never drove a real truncated Gemini response, so this asserts the DEFENSIVE mapping written into
// normalizeStopReason's gemini branch, not confirmed real-API behavior. Confirm against an actual
// truncated response during Stage C and correct this test (and the mapping) if the real field/value
// differs from the 'MAX_TOKENS'-shaped guess below.
test('normalizeAiUsage(gemini) maps an assumed max-tokens-shaped stop reason to "max_tokens" (UNCONFIRMED against a real truncated response)', () => {
  const usage = normalizeAiUsage(
    { total_tokens: 10, total_input_tokens: 5, total_output_tokens: 5 },
    { provider: 'gemini', model: 'gemini-3.7-flash', stopReason: 'MAX_TOKENS' }
  )
  assert.equal(usage.stopReason, 'max_tokens')
})
