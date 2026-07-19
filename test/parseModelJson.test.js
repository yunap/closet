// Spec 26 Part 7: parseModelJson must distinguish "the model wrote bad JSON"
// from "the response hit the token cap mid-string" — both used to surface as
// the identical "Unterminated string in JSON at position N" message.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'
// Hermetic DB isolation (spec 21/29 doctrine): this file's import chain reaches db.js,
// whose module-load migrations would otherwise run against the real wardrobe.db.
const tmpRoot = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'parse-model-json-'))
process.env.WARDROBE_DB_PATH = nodePath.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = nodePath.join(tmpRoot, 'uploads')
const { parseModelJson, salvageFirstJson } = await import('../styling-engine/provider.js')

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

// Live-found: a retag call returned "I need to look at this garment more closely
// before tagging it.\n\n{\"name\": ...}" — leading chatter parseModelJson rejects
// outright, that salvageFirstJson is meant to recover from.
test('salvageFirstJson pulls the JSON object out of leading model chatter', () => {
  const chatty = 'I need to look at this garment more closely before tagging it.\n\n{"name":"cream knit top","colors":["cream"]}'
  assert.deepEqual(salvageFirstJson(chatty), { name: 'cream knit top', colors: ['cream'] })
})

test('salvageFirstJson returns null when there is no valid JSON to recover', () => {
  assert.equal(salvageFirstJson('I need more information to tag this garment.'), null)
})
