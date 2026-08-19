// Spec 33 Part 2 — auth contract tests: invite-gated registration, login/logout, session
// cookies, the structural 401/404 guard (with WARDROBE_TEST_REQUIRE_AUTH so the
// NODE_ENV=test bypass — needed by the ~10 pre-Part-2 test files that predate auth
// entirely — doesn't mask real enforcement here), and session management.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-auth-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.WARDROBE_TEST_REQUIRE_AUTH = '1'
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { app } = await import('../server.js')
const { createInvite } = await import('../lib/systemDb.js')

const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
const baseUrl = `http://127.0.0.1:${server.address().port}`

after(async () => {
  await new Promise(resolve => server.close(resolve))
})

function extractCookie(res) {
  const raw = res.headers.get('set-cookie')
  if (!raw) return null
  return raw.split(';')[0]
}

async function register(email, password, inviteCode) {
  return fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, inviteCode })
  })
}

async function login(email, password) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
}

test('register without an invite code is rejected', async () => {
  const res = await register('nobody@example.com', 'longenoughpw', '')
  assert.equal(res.status, 400)
})

test('register with an invalid invite code is rejected', async () => {
  const res = await register('nobody@example.com', 'longenoughpw', 'not-a-real-code')
  assert.equal(res.status, 400)
})

test('register with a valid invite code succeeds, sets a session cookie, and the code becomes single-use', async () => {
  const code = createInvite(null)
  const res = await register('maya@example.com', 'longenoughpw', code)
  assert.equal(res.status, 200)
  const cookie = extractCookie(res)
  assert.ok(cookie?.startsWith('wardrobe_session='), 'sets the session cookie')

  const second = await register('someoneelse@example.com', 'longenoughpw', code)
  assert.equal(second.status, 400, 'the same code cannot be redeemed twice')
})

test('/api/auth/me reflects session state; /api/* 401s without a session; the session cookie authenticates it', async () => {
  const anonMe = await fetch(`${baseUrl}/api/auth/me`).then(r => r.json())
  assert.equal(anonMe.authenticated, false)

  const anonPieces = await fetch(`${baseUrl}/api/pieces`)
  assert.equal(anonPieces.status, 401)

  const code = createInvite(null)
  const registerRes = await register('riley@example.com', 'longenoughpw', code)
  const cookie = extractCookie(registerRes)

  const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } }).then(r => r.json())
  assert.equal(me.authenticated, true)

  const pieces = await fetch(`${baseUrl}/api/pieces`, { headers: { Cookie: cookie } })
  assert.equal(pieces.status, 200)
})

test('login rejects a wrong password with a generic message (no user enumeration)', async () => {
  const code = createInvite(null)
  await register('sam@example.com', 'correctpassword', code)

  const wrongPassword = await login('sam@example.com', 'wrongpassword')
  assert.equal(wrongPassword.status, 401)
  const wrongUser = await login('nosuchuser@example.com', 'whatever123')
  assert.equal(wrongUser.status, 401)
  assert.equal((await wrongPassword.json()).error, (await wrongUser.json()).error, 'same error message either way')

  const right = await login('sam@example.com', 'correctpassword')
  assert.equal(right.status, 200)
})

test('a garbage/expired session cookie is treated as unauthenticated, not a crash', async () => {
  const res = await fetch(`${baseUrl}/api/pieces`, { headers: { Cookie: 'wardrobe_session=not-a-real-token' } })
  assert.equal(res.status, 401)
})

test('logout clears the cookie and immediately locks out protected routes', async () => {
  const code = createInvite(null)
  const registerRes = await register('taylor@example.com', 'longenoughpw', code)
  const cookie = extractCookie(registerRes)

  const before = await fetch(`${baseUrl}/api/pieces`, { headers: { Cookie: cookie } })
  assert.equal(before.status, 200)

  const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } })
  assert.equal(logoutRes.status, 200)

  const after = await fetch(`${baseUrl}/api/pieces`, { headers: { Cookie: cookie } })
  assert.equal(after.status, 401, 'the revoked cookie no longer authenticates')
})

test('/uploads without a session 404s (private photos, not a redirect)', async () => {
  const res = await fetch(`${baseUrl}/uploads/anything.jpg`)
  assert.equal(res.status, 404)
})

test('session listing marks the current session and supports revoke / revoke-others', async () => {
  const code = createInvite(null)
  const registerRes = await register('jordan@example.com', 'longenoughpw', code)
  const cookieA = extractCookie(registerRes)

  const loginRes = await login('jordan@example.com', 'longenoughpw')
  const cookieB = extractCookie(loginRes)

  const listA = await fetch(`${baseUrl}/api/auth/sessions`, { headers: { Cookie: cookieA } }).then(r => r.json())
  assert.equal(listA.sessions.length, 2)
  const current = listA.sessions.find(s => s.isCurrent)
  assert.ok(current, 'exactly one session is marked current for this cookie')

  const revokeOthers = await fetch(`${baseUrl}/api/auth/sessions/revoke-others`, { method: 'POST', headers: { Cookie: cookieA } }).then(r => r.json())
  assert.equal(revokeOthers.revoked, 1)

  const stillGoodA = await fetch(`${baseUrl}/api/pieces`, { headers: { Cookie: cookieA } })
  assert.equal(stillGoodA.status, 200, 'the session that issued revoke-others survives')

  const nowBadB = await fetch(`${baseUrl}/api/pieces`, { headers: { Cookie: cookieB } })
  assert.equal(nowBadB.status, 401, 'the other session was revoked')
})

test('duplicate email registration is rejected', async () => {
  const code1 = createInvite(null)
  await register('dupe@example.com', 'longenoughpw', code1)
  const code2 = createInvite(null)
  const res = await register('dupe@example.com', 'longenoughpw', code2)
  assert.equal(res.status, 400)
})
