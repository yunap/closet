// Spec 26 Part 7: parseModelJson must distinguish "the model wrote bad JSON"
// from "the response hit the token cap mid-string" — both used to surface as
// the identical "Unterminated string in JSON at position N" message.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseModelJson } from '../styling-engine/provider.js'

test('parseModelJson parses well-formed JSON, including a ```json fence', () => {
  assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 })
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 })
})

test('parseModelJson reports a truncation-specific error for a response cut off mid-string', () => {
  const truncated = '{"name":"cream knit top","colors":["cream","ivory'
  assert.throws(
    () => parseModelJson(truncated, { context: 'tagger', maxTokens: 2500 }),
    err => {
      assert.equal(err.isTruncation, true)
      assert.match(err.message, /hit the token cap/)
      assert.match(err.message, /maxTokens: 2500/)
      assert.match(err.message, /\[tagger\]/)
      return true
    }
  )
})

test('parseModelJson reports an ordinary bad-JSON error (not truncation) when the response ends cleanly', () => {
  const malformed = '{"name": "cream knit top",}'
  assert.throws(
    () => parseModelJson(malformed, { context: 'tagger', maxTokens: 2500 }),
    err => {
      assert.equal(err.isTruncation, undefined)
      assert.doesNotMatch(err.message, /hit the token cap/)
      return true
    }
  )
})
