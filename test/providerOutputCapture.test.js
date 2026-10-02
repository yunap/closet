// Raw provider output capture (owner-approved 2026-09-13): diagnostic-only, off by default, and paired
// with the existing input capture by callId so a malformed answer can be attributed from evidence.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  captureNormalizedProviderInput,
  captureProviderOutput,
  newProviderCaptureCallId,
  providerOutputCaptureEnabled,
} from '../lib/providerInputCapture.js'

function withEnv(values, fn) {
  const keys = ['WARDROBE_CAPTURE_PROVIDER_INPUT_DIR']
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  for (const key of keys) {
    if (values[key] === undefined) delete process.env[key]
    else process.env[key] = values[key]
  }
  try { return fn() } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
}

test('OUTPUT CAPTURE is off by default: no call id and no file when capture is not enabled', () => {
  withEnv({}, () => {
    assert.equal(providerOutputCaptureEnabled(), false)
    assert.equal(newProviderCaptureCallId(), null)
    captureProviderOutput({ provider: 'gemini', model: 'm', subflow: 's', output: '{"outfits":[]}' })
  })
})

test('OUTPUT CAPTURE records the raw answer before parsing, paired with its input by callId', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-on-'))
  const raw = '{"outfits": [{"label": "truncated'
  // The one existing capture variable turns on BOTH halves — a complete capture needs no second setting.
  withEnv({ WARDROBE_CAPTURE_PROVIDER_INPUT_DIR: dir }, () => {
    const callId = newProviderCaptureCallId()
    assert.match(callId, /^[0-9a-f]{12}$/)
    captureNormalizedProviderInput({ provider: 'gemini', model: 'm', subflow: 'whole_wardrobe_visual_composer', callId, system: 'sys', messages: [] })
    captureProviderOutput({ provider: 'gemini', model: 'm', subflow: 'whole_wardrobe_visual_composer', callId, stopReason: 'max_tokens', output: raw })
    const records = fs.readdirSync(dir).map(file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))
    const input = records.find(record => record.stage === 'normalized')
    const output = records.find(record => record.stage === 'output')
    assert.ok(input && output)
    assert.equal(input.callId, callId)
    assert.equal(output.callId, callId)
    assert.equal(output.output, raw, 'the unparseable text is kept exactly')
    assert.equal(output.stopReason, 'max_tokens')
    assert.equal(output.subflow, 'whole_wardrobe_visual_composer')
  })
})

test('OUTPUT CAPTURE covers every tool-loop provider turn: each SDK branch records its raw response, paired by callId', () => {
  const source = fs.readFileSync(new URL('../styling-engine/provider.js', import.meta.url), 'utf8')
  const body = name => {
    const start = source.indexOf(`function ${name}(`)
    assert.ok(start >= 0, `${name} exists`)
    return source.slice(start, source.indexOf('\n}\n', start))
  }
  for (const [name, raw] of [
    ['callAnthropicTurn', 'output: response.content'],
    ['callOpenAiTurn', 'output: response.choices?.[0]?.message'],
    ['callGeminiTurn', 'steps: interaction?.steps'],
  ]) {
    const fn = body(name)
    assert.match(fn, /captureProviderOutput\(\{[^}]*subflow: 'stylist_tool_loop'[^}]*callId: captureCallId/, `${name} captures its raw turn output`)
    assert.ok(fn.includes(raw), `${name} captures the unparsed response (${raw})`)
    const captureAt = fn.indexOf('captureProviderOutput(')
    const parseAt = name === 'callGeminiTurn' ? fn.indexOf('assertGeminiInteractionUsable(') : fn.indexOf('normalizeAiUsage(')
    assert.ok(captureAt >= 0 && captureAt < parseAt, `${name} captures before parsing`)
  }
  const loop = body('askStylistWithTools')
  assert.match(loop, /const captureCallId = newProviderCaptureCallId\(\)/)
  assert.match(loop, /subflow: 'stylist_tool_loop', iterationIndex: iter, callId: captureCallId/, 'the normalized input of the same turn carries the id')
  assert.match(loop, /callProviderTurn\(target\.provider, \{[^}]*captureCallId, iterationIndex: iter/, 'the turn receives the id it must write')
})

