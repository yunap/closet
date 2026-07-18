import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'
// Hermetic DB isolation (spec 21/29 doctrine): this file's import chain reaches db.js,
// whose module-load migrations would otherwise run against the real wardrobe.db.
const tmpRoot = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'ai-error-handling-'))
process.env.WARDROBE_DB_PATH = nodePath.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = nodePath.join(tmpRoot, 'uploads')
const { describeAiError } = await import('../styling-engine/provider.js')

// 2026-07-10: /ask's catch block was the one AI-backed route that suppressed the real error behind a
// hardcoded "Something went wrong — try again", unlike every other route in this file, which already
// surfaces err.message directly. Confirmed live: a real OpenAI 429 insufficient_quota error (raw SDK
// error shape reproduced below) got reduced to that unhelpful generic string instead of a clear signal
// that this is a billing/plan issue, not an app bug.

test('describeAiError detects OpenAI insufficient_quota errors and gives a clear billing message', () => {
  const err = {
    status: 429,
    code: 'insufficient_quota',
    message: 'You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors.',
    error: { message: 'You exceeded your current quota...', type: 'insufficient_quota', code: 'insufficient_quota' }
  }
  const { status, message } = describeAiError(err)
  assert.equal(status, 429)
  assert.match(message, /quota/i)
  assert.match(message, /not an app bug/i)
})

test('describeAiError detects a generic rate-limit error without a quota code', () => {
  const err = { status: 429, message: 'Rate limit exceeded, please retry after a few seconds.' }
  const { status, message } = describeAiError(err)
  assert.equal(status, 429)
  assert.match(message, /rate-limiting/i)
})

test('describeAiError detects an Anthropic-style overloaded error even without a numeric status', () => {
  const err = { message: 'Overloaded: the API is temporarily overloaded, please retry.' }
  const { status, message } = describeAiError(err)
  assert.equal(status, 429)
  assert.match(message, /rate-limiting/i)
})

test('describeAiError falls back to the real error message for unrelated failures', () => {
  const err = { message: 'connect ECONNREFUSED 127.0.0.1:443' }
  const { status, message } = describeAiError(err)
  assert.equal(status, 500)
  assert.equal(message, 'connect ECONNREFUSED 127.0.0.1:443')
})

test('describeAiError falls back to the generic message when the error has no message at all', () => {
  const { status, message } = describeAiError({})
  assert.equal(status, 500)
  assert.equal(message, 'Something went wrong — try again')
})
