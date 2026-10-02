// Stage 1 contract (scratch/ab_stage1_preregistration.json): every provider call's normalized input, wire
// input and raw output share one callId. Exercised end to end through the real provider functions for
// all three providers, with each SDK's request method stubbed — nothing reaches the network.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'

const tmpRoot = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'capture-pairing-test-'))
process.env.WARDROBE_DB_PATH = nodePath.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = nodePath.join(tmpRoot, 'uploads')
process.env.NODE_ENV = 'test'
// Deliberate opt-in, as in gemini_call_turn.test.js: every SDK request method is stubbed below.
process.env.WARDROBE_ALLOW_TEST_PROVIDER_NETWORK = 'true'
process.env.GEMINI_API_KEY = 'test-key'
process.env.OPENAI_API_KEY = 'test-key'
process.env.ANTHROPIC_API_KEY = 'test-key'

const { GoogleGenAI } = await import('@google/genai')
const { default: Anthropic } = await import('@anthropic-ai/sdk')
const { default: OpenAI } = await import('openai')
const json = '{"ok":true}'
Object.defineProperty(GoogleGenAI.prototype, 'interactions', {
  configurable: true,
  get() {
    return { create: async request => ({ id: 'interaction_1', status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: request.response_format ? json : 'Wear the blue sweater.' }] }],
      usage: { total_input_tokens: 1, total_output_tokens: 1 } }) }
  }
})
Anthropic.Messages.prototype.create = async request => (request.tool_choice
  ? { content: [{ type: 'tool_use', id: 'tu_1', name: request.tool_choice.name, input: { ok: true } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } }
  : { content: [{ type: 'text', text: 'Wear the blue sweater.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
OpenAI.Chat.Completions.prototype.create = async request => ({
  choices: [{ message: { role: 'assistant', content: request.response_format ? json : 'Wear the blue sweater.' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1 } })

const { askStylistWithTools, askStylistStructuredWithUsage, askStylistWithUsage } = await import('../styling-engine/provider.js')

async function captured(fn) {
  const dir = fs.mkdtempSync(nodePath.join(tmpRoot, 'capture-'))
  process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR = dir
  try { await fn() } finally { delete process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR }
  return fs.readdirSync(dir).map(file => JSON.parse(fs.readFileSync(nodePath.join(dir, file), 'utf8')))
}

function assertOneIdPerCall(records, subflow) {
  assert.ok(records.length > 0, 'capture wrote records')
  assert.deepEqual(records.filter(r => !r.callId).map(r => r.stage), [], 'every record carries a callId')
  const byCall = new Map()
  for (const r of records) byCall.set(r.callId, [...(byCall.get(r.callId) || []), r])
  assert.ok(byCall.size >= 1)
  for (const [callId, group] of byCall) {
    assert.match(callId, /^[0-9a-f]{12}$/)
    assert.deepEqual(group.map(r => r.stage).sort(), ['normalized', 'output', 'wire'], `call ${callId} has exactly one record per stage`)
    assert.ok(group.every(r => r.subflow === subflow))
    assert.equal(new Set(group.map(r => r.iterationIndex ?? null)).size, 1, 'all three stages name the same iteration')
    // Order of capture: input before the SDK call, output after it.
    const index = stage => group.find(r => r.stage === stage).captureIndex
    assert.ok(index('normalized') < index('wire') && index('wire') < index('output'))
  }
}

const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }
for (const provider of ['gemini', 'openai', 'anthropic']) {
  test(`CAPTURE PAIRING (${provider}): a tool-loop turn's normalized, wire and output records share one callId`, async () => {
    const records = await captured(() => askStylistWithTools({ system: 'system prompt', messages: [{ role: 'user', content: 'what should I wear?' }], toolContext: { providerOverride: { provider } } }))
    assertOneIdPerCall(records, 'stylist_tool_loop')
    assert.ok(records.filter(r => r.stage === 'wire').every(r => Number.isInteger(r.iterationIndex)))
  })
  test(`CAPTURE PAIRING (${provider}): a structured call's three records share one callId`, async () => {
    const records = await captured(() => askStylistStructuredWithUsage({ system: 'system prompt', messages: [{ role: 'user', content: 'classify' }], schema, providerOverride: { provider }, subflow: 'pairing_structured' }))
    assertOneIdPerCall(records, 'pairing_structured')
    assert.equal(records.length, 3)
  })
  test(`CAPTURE PAIRING (${provider}): a plain text call's three records share one callId`, async () => {
    const records = await captured(() => askStylistWithUsage({ system: 'system prompt', messages: [{ role: 'user', content: 'hello' }], providerOverride: { provider }, subflow: 'pairing_text' }))
    assertOneIdPerCall(records, 'pairing_text')
    assert.equal(records.length, 3)
  })
}
