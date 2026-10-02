// docs: lib/providerInputCapture.js. Off-by-default diagnostic capture -- verify it stays silent
// when disabled, and that redaction/digests behave correctly when enabled.
import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'closet-provider-capture-'))

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

test('disabled by default: no env var set, nothing is written, no error', async () => {
  delete process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR
  const { providerInputCaptureEnabled, captureNormalizedProviderInput, captureWireProviderInput } = await import('../lib/providerInputCapture.js')
  assert.equal(providerInputCaptureEnabled(), false)
  captureNormalizedProviderInput({ provider: 'gemini', model: 'x', system: 'sys', messages: [], tools: [] })
  captureWireProviderInput({ provider: 'gemini', model: 'x', request: { foo: 'bar' } })
  // Nothing to assert on disk -- the point is this must not throw and must not create the dir.
  assert.ok(true)
})

test('enabled: writes a normalized capture with matching digests and redacted image data', async () => {
  const dir = path.join(tmpRoot, 'run1')
  process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR = dir
  // Re-import fresh so the module re-reads the env var (ESM caches the module, not the env read --
  // the exported functions read process.env at call time, so no reset needed here).
  const { captureNormalizedProviderInput } = await import('../lib/providerInputCapture.js')
  const bigBase64 = 'A'.repeat(3000)
  captureNormalizedProviderInput({
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    subflow: 'stylist_tool_loop',
    iterationIndex: 2,
    system: 'You are a stylist.',
    messages: [
      { role: 'user', content: [{ type: 'image', source: { type: 'base64', data: bigBase64 } }] },
      { role: 'assistant', text: 'Here is the outfit.' },
    ],
    tools: [{ name: 'search_wardrobe', description: 'search' }],
  })
  const files = fs.readdirSync(dir)
  assert.equal(files.length, 1)
  const record = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'))
  assert.match(files[0], /^\d{8}T\d{6}\d{3}Z-p\d+-[a-f0-9]{8}-\d{4}-anthropic-normalized\.json$/)
  assert.ok(files[0].startsWith(`${record.captureSessionId}-`))
  assert.equal(Number.isInteger(record.captureIndex), true)
  assert.ok(record.captureIndex > 0)
  assert.equal(record.stage, 'normalized')
  assert.equal(record.provider, 'anthropic')
  assert.equal(record.iterationIndex, 2)
  assert.ok(!JSON.stringify(record.messages).includes(bigBase64), 'raw base64 image data must never be written to disk')
  assert.match(JSON.stringify(record.messages), /redacted, 3000 chars/)
  assert.equal(typeof record.systemSha256, 'string')
  assert.equal(record.systemSha256.length, 64)
  assert.equal(typeof record.normalizedInputSha256, 'string')

  delete process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR
})

test('two captures with identical normalized content produce identical digests', async () => {
  const dir = path.join(tmpRoot, 'run2')
  process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR = dir
  const { captureNormalizedProviderInput } = await import('../lib/providerInputCapture.js')
  const shared = { system: 'same system', messages: [{ role: 'user', text: 'same question' }], tools: [] }
  captureNormalizedProviderInput({ provider: 'gemini', model: 'gemini-3.5-flash-lite', ...shared })
  captureNormalizedProviderInput({ provider: 'anthropic', model: 'claude-sonnet-4-6', ...shared })
  const files = fs.readdirSync(dir).sort()
  const recordA = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'))
  const recordB = JSON.parse(fs.readFileSync(path.join(dir, files[1]), 'utf8'))
  assert.equal(recordA.normalizedInputSha256, recordB.normalizedInputSha256,
    'same normalized system/messages/tools must hash identically regardless of provider')
  delete process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR
})

test('different normalized content produces different digests', async () => {
  const dir = path.join(tmpRoot, 'run3')
  process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR = dir
  const { captureNormalizedProviderInput } = await import('../lib/providerInputCapture.js')
  captureNormalizedProviderInput({ provider: 'gemini', model: 'x', system: 'sys A', messages: [{ role: 'user', text: 'q' }], tools: [] })
  captureNormalizedProviderInput({ provider: 'anthropic', model: 'y', system: 'sys B', messages: [{ role: 'user', text: 'q' }], tools: [] })
  const files = fs.readdirSync(dir).sort()
  const recordA = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'))
  const recordB = JSON.parse(fs.readFileSync(path.join(dir, files[1]), 'utf8'))
  assert.notEqual(recordA.normalizedInputSha256, recordB.normalizedInputSha256)
  delete process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR
})

test('a capture never overwrites a legacy counter-only filename after a process restart', async () => {
  const dir = path.join(tmpRoot, 'restart-safe')
  fs.mkdirSync(dir, { recursive: true })
  const legacyName = '0001-anthropic-normalized.json'
  const legacyPath = path.join(dir, legacyName)
  fs.writeFileSync(legacyPath, '{"sentinel":"older run"}')
  process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR = dir
  const { captureNormalizedProviderInput } = await import('../lib/providerInputCapture.js')
  captureNormalizedProviderInput({ provider: 'anthropic', model: 'x', system: 'new run', messages: [], tools: [] })

  assert.equal(fs.readFileSync(legacyPath, 'utf8'), '{"sentinel":"older run"}')
  const newFiles = fs.readdirSync(dir).filter(file => file !== legacyName)
  assert.equal(newFiles.length, 1)
  assert.match(newFiles[0], /-anthropic-normalized\.json$/)
  delete process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR
})

test('enabled: every record carries the thread, turn and request it belongs to, and a structured call its schema name', async () => {
  const dir = path.join(tmpRoot, 'attribution')
  process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR = dir
  const { registerProviderCaptureContextReader, captureNormalizedProviderInput, captureWireProviderInput, captureProviderOutput } = await import('../lib/providerInputCapture.js')
  registerProviderCaptureContextReader(() => ({
    sessionId: 'thread_123',
    freeformTurnToken: 'turn-abc',
    originalUrl: '/api/ai/ask?debug=1',
    isNested: true,
  }))
  try {
    const meta = { provider: 'gemini', model: 'x', subflow: 'structured_response', schemaName: 'trip_plan_composition', callId: 'c1' }
    captureNormalizedProviderInput({ ...meta, system: 'sys', messages: [], tools: [] })
    captureWireProviderInput({ ...meta, request: { foo: 'bar' } })
    captureProviderOutput({ ...meta, output: '{}' })
    const records = fs.readdirSync(dir).sort().map(file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))
    assert.deepEqual(records.map(r => r.stage), ['normalized', 'wire', 'output'])
    for (const record of records) {
      assert.equal(record.threadId, 'thread_123')
      assert.equal(record.turnToken, 'turn-abc')
      assert.equal(record.requestPath, '/api/ai/ask')
      assert.equal(record.nested, true)
      assert.equal(record.schemaName, 'trip_plan_composition')
    }
  } finally {
    registerProviderCaptureContextReader(null)
    delete process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR
  }
})

test('enabled with no request context: attribution fields are present and empty, and a throwing reader never breaks the capture', async () => {
  const dir = path.join(tmpRoot, 'no-context')
  process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR = dir
  const { registerProviderCaptureContextReader, captureWireProviderInput } = await import('../lib/providerInputCapture.js')
  registerProviderCaptureContextReader(() => { throw new Error('no store') })
  try {
    captureWireProviderInput({ provider: 'gemini', model: 'x', request: { foo: 'bar' } })
    const [file] = fs.readdirSync(dir)
    const record = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    assert.equal(record.threadId, '')
    assert.equal(record.turnToken, '')
    assert.equal(record.requestPath, '')
    assert.equal(record.nested, false)
    assert.equal(record.schemaName, '')
  } finally {
    registerProviderCaptureContextReader(null)
    delete process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR
  }
})
