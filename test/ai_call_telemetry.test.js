import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-ai-telemetry-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const realFetch = globalThis.fetch
const syntheticCalls = []
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : String(input?.url || '')
  syntheticCalls.push({ url, body: String(init?.body || '') })
  if (url.includes('api.anthropic.com')) {
    return new Response(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null,
      usage: {
        input_tokens: 12,
        output_tokens: 3,
        cache_read_input_tokens: 4,
        cache_creation_input_tokens: 5,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (url.includes('api.openai.com')) {
    return new Response(JSON.stringify({
      id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12,
        prompt_tokens_details: { cached_tokens: 3 },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  throw new Error(`Unexpected synthetic fetch: ${url}`)
}

const telemetry = await import('../lib/aiCallTelemetry.js')
telemetry.installAiFetchTelemetry()
const { default: Anthropic } = await import('@anthropic-ai/sdk')
const { default: OpenAI } = await import('openai')
const { db } = await import('../db.js')

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
  globalThis.fetch = realFetch
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

test('installed Anthropic and OpenAI SDK clients cross the telemetry transport boundary', async () => {
  const anthropic = new Anthropic({ apiKey: 'test-key', maxRetries: 0 })
  await telemetry.runWithAiTelemetryContext({ originalUrl: '/api/ai/outfit-feedback', sessionId: 'thread_test' }, () =>
    anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 20,
      messages: [{ role: 'user', content: 'test' }],
    })
  )

  const openai = new OpenAI({ apiKey: 'test-key', maxRetries: 0 })
  await telemetry.runWithAiTelemetryContext({ originalUrl: '/api/ai/compare-outfits' }, () =>
    openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 20,
      messages: [{ role: 'user', content: 'test' }],
    })
  )

  await waitForRows(2)
  assert.equal(syntheticCalls.length, 2, 'both SDK calls used the synthetic global fetch')

  const rows = db.prepare('SELECT * FROM ai_call_log ORDER BY id').all()
  assert.equal(rows.length, 2)

  const anthropicRow = rows[0]
  assert.equal(anthropicRow.flow, 'outfit_feedback')
  assert.equal(anthropicRow.endpoint, '/outfit-feedback')
  assert.equal(anthropicRow.session_id, 'thread_test')
  assert.equal(anthropicRow.provider, 'anthropic')
  assert.equal(anthropicRow.model, 'claude-sonnet-4-6')
  assert.equal(anthropicRow.call_kind, 'text')
  assert.equal(anthropicRow.input_tokens, 12)
  assert.equal(anthropicRow.output_tokens, 3)
  assert.equal(anthropicRow.cache_read_input_tokens, 4)
  assert.equal(anthropicRow.cache_creation_input_tokens, 5)
  assert.equal(anthropicRow.success, 1)
  assert.equal(anthropicRow.is_mock, 0)

  const openaiRow = rows[1]
  assert.equal(openaiRow.flow, 'compare_outfits')
  assert.equal(openaiRow.endpoint, '/compare-outfits')
  assert.equal(openaiRow.provider, 'openai')
  assert.equal(openaiRow.model, 'gpt-4o')
  assert.equal(openaiRow.input_tokens, 10)
  assert.equal(openaiRow.output_tokens, 2)
  assert.equal(openaiRow.cache_read_input_tokens, 3)
  assert.equal(openaiRow.success, 1)
})

test('mock rows are flagged and excluded from real spend semantics', async () => {
  await telemetry.runWithAiTelemetryContext({ originalUrl: '/api/ai/tag-piece' }, () =>
    telemetry.logAiCall({
      provider: 'mock', model: 'mock', callKind: 'structured', isMock: true,
      success: true, context: { source: 'test' },
    })
  )
  await waitForRows(3)
  const row = db.prepare('SELECT * FROM ai_call_log ORDER BY id DESC LIMIT 1').get()
  assert.equal(row.flow, 'tag_piece')
  assert.equal(row.is_mock, 1)
  assert.equal(row.estimated_cost_usd, null)
  assert.equal(row.input_tokens, 0)
  assert.equal(row.output_tokens, 0)
})
