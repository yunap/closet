// Spec 33 Part 4 — BYOK key resolution: own key overrides the operator's env key, falls
// back cleanly when unset, and a missing key surfaces as a distinguishable 'no_api_key'
// error (not a raw crash) rather than the generic 500 path. GET never echoes a stored key.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-api-keys-'))
process.env.NODE_ENV = 'test'
// Dedicated key-resolution contract: this test calls assertProviderKey directly but never a
// provider request function. Ordinary tests must not set this escape hatch.
process.env.WARDROBE_ALLOW_TEST_PROVIDER_NETWORK = 'true'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.ANTHROPIC_API_KEY = 'operator-anthropic-key'
process.env.OPENAI_API_KEY = 'operator-openai-key'

const { resolveAnthropicKey, resolveOpenAiKey, hasAnthropicKey, hasOperatorKeyAccess, setOwnKey, ownKeyStatus, noKeyErrorMessage } = await import('../lib/apiKeys.js')
const { assertProviderKey } = await import('../styling-engine/provider.js')
const { app } = await import('../server.js')
const { createUser, setOperatorKeyApproval } = await import('../lib/systemDb.js')
const { runWithUser, DEFAULT_USER_ID } = await import('../lib/requestContext.js')

const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
const baseUrl = `http://127.0.0.1:${server.address().port}`
after(async () => { await new Promise(resolve => server.close(resolve)) })

test('with no own key set, resolution falls back to the operator env key', () => {
  assert.equal(resolveAnthropicKey(), 'operator-anthropic-key')
  assert.equal(resolveOpenAiKey(), 'operator-openai-key')
})

test('a saved own key overrides the operator key', () => {
  setOwnKey('anthropic', 'my-own-anthropic-key')
  assert.equal(resolveAnthropicKey(), 'my-own-anthropic-key')
  assert.equal(resolveOpenAiKey(), 'operator-openai-key', 'unrelated provider untouched')
  setOwnKey('anthropic', '') // clean up for later tests
})

test('clearing an own key (empty string) falls back to the operator key again', () => {
  setOwnKey('openai', 'my-own-openai-key')
  assert.equal(resolveOpenAiKey(), 'my-own-openai-key')
  setOwnKey('openai', '')
  assert.equal(resolveOpenAiKey(), 'operator-openai-key')
})

test('with neither an own key nor an operator key, resolution returns null and assertProviderKey throws a no_api_key-coded error', () => {
  const savedEnv = process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  try {
    assert.equal(resolveAnthropicKey(), null)
    assert.equal(hasAnthropicKey(), false)
    assert.throws(() => assertProviderKey(), (err) => {
      assert.equal(err.code, 'no_api_key')
      assert.match(err.message, /add your own.*Settings|ask the operator/i)
      return true
    })
  } finally {
    process.env.ANTHROPIC_API_KEY = savedEnv
  }
})

test('GET /api/settings/api-keys reports only booleans, never the stored key value', async () => {
  setOwnKey('anthropic', 'super-secret-key-value')
  const res = await fetch(`${baseUrl}/api/settings/api-keys`)
  const body = await res.json()
  assert.deepEqual(body, { hasOwnAnthropicKey: true, hasOwnOpenAiKey: false, hasOwnGeminiKey: false, hasOperatorKeyAccess: true })
  assert.ok(!JSON.stringify(body).includes('super-secret-key-value'))
  setOwnKey('anthropic', '')
})

test('PUT /api/settings/api-keys saves and clears keys, reflected in status', async () => {
  const setRes = await fetch(`${baseUrl}/api/settings/api-keys`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anthropicKey: 'a-real-looking-key', openAiKey: 'another-key' })
  })
  assert.equal(setRes.status, 200)
  assert.deepEqual(await setRes.json(), { hasOwnAnthropicKey: true, hasOwnOpenAiKey: true, hasOwnGeminiKey: false, hasOperatorKeyAccess: true })
  assert.equal(resolveAnthropicKey(), 'a-real-looking-key')

  const clearRes = await fetch(`${baseUrl}/api/settings/api-keys`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anthropicKey: '', openAiKey: '' })
  })
  assert.deepEqual(await clearRes.json(), { hasOwnAnthropicKey: false, hasOwnOpenAiKey: false, hasOwnGeminiKey: false, hasOperatorKeyAccess: true })
  assert.equal(resolveAnthropicKey(), 'operator-anthropic-key')
})

test('ownKeyStatus matches the route response shape', () => {
  setOwnKey('openai', 'x')
  assert.deepEqual(ownKeyStatus(), { hasOwnAnthropicKey: false, hasOwnOpenAiKey: true, hasOwnGeminiKey: false, hasOperatorKeyAccess: true })
  setOwnKey('openai', '')
})

// Owner ruling 2026-07-20 (follow-up): an invited user does NOT ride on the operator's
// key by default — the operator has to approve them first.
// Burns user #1 first: this file's system.db is fresh, so the first createUser() call
// would otherwise land on id 1 — colliding with DEFAULT_USER_ID, which is exempt from
// the approval check entirely and would make the "no access by default" assertion below
// pass for the wrong reason.
createUser('placeholder-burns-id-1@example.com', 'irrelevant-password')

test('a newly invited user has no operator-key access by default, even though the operator key is configured', () => {
  const { id, email } = createUser('needs-approval@example.com', 'longenoughpw')
  assert.notEqual(id, DEFAULT_USER_ID, 'sanity: this is a real non-owner user')
  runWithUser(id, () => {
    assert.equal(hasOperatorKeyAccess(id), false)
    assert.equal(resolveAnthropicKey(), null, 'no own key + no approval = no key, even though the operator has one configured')
    assert.match(noKeyErrorMessage('anthropic', id), /don't have access.*approve/i)
  })
})

test('approving a user grants operator-key fallback; revoking removes it again', () => {
  const { id, email } = createUser('gets-approved@example.com', 'longenoughpw')
  runWithUser(id, () => {
    assert.equal(resolveAnthropicKey(), null)
  })
  setOperatorKeyApproval(email, true)
  runWithUser(id, () => {
    assert.equal(hasOperatorKeyAccess(id), true)
    assert.equal(resolveAnthropicKey(), 'operator-anthropic-key')
  })
  setOperatorKeyApproval(email, false)
  runWithUser(id, () => {
    assert.equal(resolveAnthropicKey(), null, 'revoking access removes the fallback again')
  })
})

test('the operator (DEFAULT_USER_ID) is always exempt from the approval check', () => {
  assert.equal(hasOperatorKeyAccess(DEFAULT_USER_ID), true)
})

test('an approved user\'s own key still takes precedence over the operator key', () => {
  const { id, email } = createUser('approved-with-own-key@example.com', 'longenoughpw')
  setOperatorKeyApproval(email, true)
  runWithUser(id, () => {
    setOwnKey('anthropic', 'their-own-key', id)
    assert.equal(resolveAnthropicKey(id), 'their-own-key')
  })
})
