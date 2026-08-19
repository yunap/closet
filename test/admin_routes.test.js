// Spec 34 Part 4 — admin UI backend contract tests. WARDROBE_USERS_DIR only (not
// WARDROBE_DB_PATH), same reasoning as the als-context/adopt-db tests: WARDROBE_DB_PATH
// would collapse every userId onto one shared file, which breaks both storage-size
// computation and (much worse) the delete-user-directory test — a shared path would mean
// deleting one "user's" directory deletes everyone's data.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-admin-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_USERS_DIR = path.join(tmpRoot, 'users')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.WARDROBE_TEST_REQUIRE_AUTH = '1'
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { app } = await import('../server.js')
const { createUser, createInvite, findUserByEmail } = await import('../lib/systemDb.js')

const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
const baseUrl = `http://127.0.0.1:${server.address().port}`
after(async () => { await new Promise(resolve => server.close(resolve)) })

function extractCookie(res) {
  const raw = res.headers.get('set-cookie')
  return raw ? raw.split(';')[0] : null
}

async function login(email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
  })
  return { res, cookie: extractCookie(res) }
}

async function registerNonAdmin(email) {
  const code = createInvite(null)
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'longenoughpw', inviteCode: code })
  })
  return { cookie: extractCookie(res), user: findUserByEmail(email) }
}

// id 1 becomes the admin (the boot-time migration makes user #1 an admin) — created here
// directly rather than via register, since register's invite flow doesn't control the id.
createUser('admin@example.com', 'longenoughpw')
const { cookie: adminCookie } = await login('admin@example.com', 'longenoughpw')
const adminHeaders = { Cookie: adminCookie, 'Content-Type': 'application/json' }

test('a non-admin gets 403 on every /api/admin/* route', async () => {
  const { cookie } = await registerNonAdmin('plain-user@example.com')
  for (const [method, url] of [
    ['GET', '/api/admin/users'], ['GET', '/api/admin/invites'], ['GET', '/api/admin/invite-requests'],
    ['POST', '/api/admin/invites']
  ]) {
    const res = await fetch(`${baseUrl}${url}`, { method, headers: { Cookie: cookie } })
    assert.equal(res.status, 403, `${method} ${url} should 403 for a non-admin`)
  }
})

test('GET /api/admin/users lists accounts for an admin', async () => {
  const res = await fetch(`${baseUrl}/api/admin/users`, { headers: adminHeaders })
  assert.equal(res.status, 200)
  const { users } = await res.json()
  assert.ok(users.find(u => u.email === 'admin@example.com')?.isAdmin)
  assert.ok(users.find(u => u.email === 'plain-user@example.com'))
})

test('operator-key-approval toggle round-trips', async () => {
  const { user } = await registerNonAdmin('needs-key-access@example.com')
  const before = (await (await fetch(`${baseUrl}/api/admin/users`, { headers: adminHeaders })).json()).users.find(u => u.id === user.id)
  assert.equal(before.operatorKeyApproved, false)

  const patch = await fetch(`${baseUrl}/api/admin/users/${user.id}/operator-key-approval`, {
    method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ approved: true })
  })
  assert.equal(patch.status, 200)
  const after1 = (await (await fetch(`${baseUrl}/api/admin/users`, { headers: adminHeaders })).json()).users.find(u => u.id === user.id)
  assert.equal(after1.operatorKeyApproved, true)
})

test('disabling a user kills their live session on next request and gives an honest login message', async () => {
  const { cookie, user } = await registerNonAdmin('gets-disabled@example.com')
  const stillGood = await fetch(`${baseUrl}/api/pieces`, { headers: { Cookie: cookie } })
  assert.equal(stillGood.status, 200)

  const patch = await fetch(`${baseUrl}/api/admin/users/${user.id}/status`, {
    method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'disabled' })
  })
  assert.equal(patch.status, 200)

  const nowLocked = await fetch(`${baseUrl}/api/pieces`, { headers: { Cookie: cookie } })
  assert.equal(nowLocked.status, 401, 'the live session died on its next request, not just new logins')

  const loginAttempt = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'gets-disabled@example.com', password: 'longenoughpw' })
  })
  assert.equal(loginAttempt.status, 403)
  assert.match((await loginAttempt.json()).error, /disabled.*contact the operator/i)

  // re-enable for hygiene / to prove the flip works both ways
  await fetch(`${baseUrl}/api/admin/users/${user.id}/status`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'active' }) })
  const backToWorking = await login('gets-disabled@example.com', 'longenoughpw')
  assert.equal(backToWorking.res.status, 200)
})

test('reset-password code is redeemable exactly once', async () => {
  const { user } = await registerNonAdmin('needs-reset@example.com')
  const res = await fetch(`${baseUrl}/api/admin/users/${user.id}/reset-password`, { method: 'POST', headers: adminHeaders })
  assert.equal(res.status, 200)
  const { code } = await res.json()
  assert.ok(code)
  // Redemption itself isn't wired to a public endpoint in this PR (Part 4 ships the
  // code-generation half; PR B's public surface wires the redeem form) — assert the
  // code exists and is usable via the lib function directly, matching what a redeem
  // endpoint will call.
  const { redeemPasswordResetCode } = await import('../lib/systemDb.js')
  assert.equal(redeemPasswordResetCode(code, 'brandnewpassword'), true)
  assert.equal(redeemPasswordResetCode(code, 'anotherpassword'), false, 'the same code cannot be redeemed twice')
  const relogin = await login('needs-reset@example.com', 'brandnewpassword')
  assert.equal(relogin.res.status, 200)
})

test('revoke-sessions actually revokes', async () => {
  const { cookie, user } = await registerNonAdmin('gets-revoked@example.com')
  const before = await fetch(`${baseUrl}/api/pieces`, { headers: { Cookie: cookie } })
  assert.equal(before.status, 200)

  const res = await fetch(`${baseUrl}/api/admin/users/${user.id}/revoke-sessions`, { method: 'POST', headers: adminHeaders })
  assert.equal(res.status, 200)
  const { revoked } = await res.json()
  assert.ok(revoked >= 1)

  const after1 = await fetch(`${baseUrl}/api/pieces`, { headers: { Cookie: cookie } })
  assert.equal(after1.status, 401)
})

test('the last admin cannot be de-flagged or deleted', async () => {
  const deflag = await fetch(`${baseUrl}/api/admin/users/1/admin`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ isAdmin: false }) })
  assert.equal(deflag.status, 400)

  const del = await fetch(`${baseUrl}/api/admin/users/1`, { method: 'DELETE', headers: adminHeaders, body: JSON.stringify({ confirmEmail: 'admin@example.com' }) })
  assert.equal(del.status, 400)
})

test('an admin cannot delete their own account even with a second admin present', async () => {
  const { user: second } = await registerNonAdmin('second-admin@example.com')
  await fetch(`${baseUrl}/api/admin/users/${second.id}/admin`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ isAdmin: true }) })

  const selfDelete = await fetch(`${baseUrl}/api/admin/users/1`, { method: 'DELETE', headers: adminHeaders, body: JSON.stringify({ confirmEmail: 'admin@example.com' }) })
  assert.equal(selfDelete.status, 400)
})

test('deleting a user requires exact email confirmation, then removes the account and its data directory', async () => {
  const { user } = await registerNonAdmin('gets-deleted@example.com')
  // Touch db.js for this user so a real per-user directory actually exists on disk.
  const { getDbForUser } = await import('../db.js')
  getDbForUser(user.id)
  const dataDir = path.join(tmpRoot, 'users', String(user.id))
  assert.ok(fs.existsSync(dataDir), 'sanity: the data directory was created')

  const wrongConfirm = await fetch(`${baseUrl}/api/admin/users/${user.id}`, {
    method: 'DELETE', headers: adminHeaders, body: JSON.stringify({ confirmEmail: 'not-the-right-email@example.com' })
  })
  assert.equal(wrongConfirm.status, 400)
  assert.ok(fs.existsSync(dataDir), 'nothing removed on a failed confirmation')

  const res = await fetch(`${baseUrl}/api/admin/users/${user.id}`, {
    method: 'DELETE', headers: adminHeaders, body: JSON.stringify({ confirmEmail: 'gets-deleted@example.com' })
  })
  assert.equal(res.status, 200)
  assert.equal(findUserByEmail('gets-deleted@example.com'), undefined)
  assert.ok(!fs.existsSync(dataDir), 'the data directory is gone')
})

test('invite mint/list/revoke and the invite-request queue', async () => {
  const mint = await fetch(`${baseUrl}/api/admin/invites`, { method: 'POST', headers: adminHeaders })
  assert.equal(mint.status, 200)
  const { code } = await mint.json()
  assert.ok(code)

  const list = await (await fetch(`${baseUrl}/api/admin/invites`, { headers: adminHeaders })).json()
  assert.ok(list.invites.find(i => i.code === code))

  const revoke = await fetch(`${baseUrl}/api/admin/invites/${code}`, { method: 'DELETE', headers: adminHeaders })
  assert.equal(revoke.status, 200)

  // The queue is empty in this PR (no public submission endpoint yet) — just confirm the
  // route works and returns the expected shape.
  const requests = await (await fetch(`${baseUrl}/api/admin/invite-requests`, { headers: adminHeaders })).json()
  assert.deepEqual(requests.requests, [])
})
