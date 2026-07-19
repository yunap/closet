// Spec 33 Part 1 — pins the exact risk the spec calls out: AsyncLocalStorage must survive
// async continuations (the importer's phases are awaited chains within a single request,
// e.g. routes/importer.js's IIFE-wrapped /review handler) so a slow request for one user
// never lets its late writes land in another user's database. WARDROBE_USERS_DIR isolates
// this test's per-user files under a tmp root instead of the real data/users/ layout.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-als-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_USERS_DIR = path.join(tmpRoot, 'users')

const { getDbForUser } = await import('../db.js')
const { runWithUser, getCurrentUserId } = await import('../lib/requestContext.js')

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Simulates a request's full async lifecycle: several awaited steps (matching the
// importer's classify -> detect -> cluster -> tag -> review chain), each of which reads
// getCurrentUserId() fresh. If ALS didn't survive across the awaits, a later step could
// resolve to the wrong (or no) user.
async function simulatedRequestPhases(userId, label) {
  return runWithUser(userId, async () => {
    const seenUserIds = []

    seenUserIds.push(getCurrentUserId())
    await sleep(5)

    seenUserIds.push(getCurrentUserId())
    const conn = getDbForUser(getCurrentUserId())
    conn.prepare("INSERT INTO app_meta (key, value) VALUES ('als_test_label', ?)").run(label)
    await sleep(5)

    seenUserIds.push(getCurrentUserId())
    await Promise.resolve().then(() => sleep(5))

    seenUserIds.push(getCurrentUserId())
    const finalConn = getDbForUser(getCurrentUserId())
    finalConn.prepare("UPDATE app_meta SET value = ? WHERE key = 'als_test_label'").run(`${label}-done`)

    return seenUserIds
  })
}

test('AsyncLocalStorage context survives interleaved async phases across two concurrent users', async () => {
  const userA = 101
  const userB = 102

  const [seenA, seenB] = await Promise.all([
    simulatedRequestPhases(userA, 'A'),
    simulatedRequestPhases(userB, 'B')
  ])

  assert.deepStrictEqual(seenA, [userA, userA, userA, userA], 'every step of user A\'s async chain resolved to user A')
  assert.deepStrictEqual(seenB, [userB, userB, userB, userB], 'every step of user B\'s async chain resolved to user B')

  const dbA = getDbForUser(userA)
  const dbB = getDbForUser(userB)

  const rowA = dbA.prepare("SELECT value FROM app_meta WHERE key = 'als_test_label'").get()
  const rowB = dbB.prepare("SELECT value FROM app_meta WHERE key = 'als_test_label'").get()

  assert.strictEqual(rowA.value, 'A-done', 'user A\'s writes landed in user A\'s own file')
  assert.strictEqual(rowB.value, 'B-done', 'user B\'s writes landed in user B\'s own file')

  assert.ok(fs.existsSync(path.join(tmpRoot, 'users', String(userA), 'wardrobe.db')), 'user A got its own DB file')
  assert.ok(fs.existsSync(path.join(tmpRoot, 'users', String(userB), 'wardrobe.db')), 'user B got its own DB file')
})

test('getCurrentUserId falls back to DEFAULT_USER_ID outside any request context', async () => {
  const { DEFAULT_USER_ID } = await import('../lib/requestContext.js')
  assert.strictEqual(getCurrentUserId(), DEFAULT_USER_ID)
})
