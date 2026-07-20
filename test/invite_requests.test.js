// Spec 34 PR B — the public invite-request submission endpoint. This is the one write on
// the front door, reachable with no session. WARDROBE_TEST_REQUIRE_AUTH is set so that any
// /api/* route WOULD 401 without a cookie — the point of these tests is that this endpoint
// is mounted before that guard and stays public, while still writing to the same queue the
// admin side reads.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-invite-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_USERS_DIR = path.join(tmpRoot, 'users')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.WARDROBE_TEST_REQUIRE_AUTH = '1'
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { app } = await import('../server.js')
const { listInviteRequests } = await import('../lib/systemDb.js')

const server = app.listen(0)
await once(server, 'listening')
const baseUrl = `http://127.0.0.1:${server.address().port}`
after(async () => { await new Promise(resolve => server.close(resolve)) })

const post = (body) => fetch(`${baseUrl}/api/invite-requests`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

test('accepts a valid submission with no session and stores it as pending', async () => {
  const res = await post({ email: 'Prospect@Example.com', note: '  keen to try it  ' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })

  const rows = listInviteRequests().filter(r => r.email === 'prospect@example.com')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'pending')
  assert.equal(rows[0].email, 'prospect@example.com') // normalised: lowercased + trimmed
  assert.equal(rows[0].note, 'keen to try it')        // trimmed
})

test('rejects a missing or malformed email with 400', async () => {
  for (const body of [{}, { email: '' }, { email: 'not-an-email' }]) {
    const res = await post(body)
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`)
  }
})

test('treats note as optional', async () => {
  const res = await post({ email: 'noteless@example.com' })
  assert.equal(res.status, 200)
  const row = listInviteRequests().find(r => r.email === 'noteless@example.com')
  assert.equal(row.note, '')
})

test('a second request from the same email is allowed (a signal, not an error)', async () => {
  await post({ email: 'again@example.com' })
  const res = await post({ email: 'again@example.com', note: 'still hoping' })
  assert.equal(res.status, 200)
  assert.equal(listInviteRequests().filter(r => r.email === 'again@example.com').length, 2)
})

test('caps an overlong note instead of rejecting it', async () => {
  const res = await post({ email: 'verbose@example.com', note: 'x'.repeat(5000) })
  assert.equal(res.status, 200)
  const row = listInviteRequests().find(r => r.email === 'verbose@example.com')
  assert.equal(row.note.length, 1000)
})
