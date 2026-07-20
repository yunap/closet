// Spec 34 Part 4 — the admin UI's backend. Mounted at /api/admin; server.js's own guard
// already refused any non-admin before a request reaches here, so handlers below don't
// re-check isAdmin — they only need the operation-specific guards (self-delete, last
// admin, typed confirmation).
import express from 'express'
import fs from 'fs'
import path from 'path'
import {
  listUsersForAdmin,
  findUserById,
  isAdmin,
  countAdmins,
  setAdmin,
  setUserStatus,
  deleteUserAndSessions,
  createPasswordResetCode,
  revokeOtherSessions,
  listSessions,
  createInvite,
  listInvites,
  revokeInvite,
  listInviteRequests,
  decideInviteRequest,
  setOperatorKeyApproval,
  db as systemDb
} from '../lib/systemDb.js'
import { resolveDbPath, resolveUploadsDir } from '../db.js'
import { ownKeyStatus } from '../lib/apiKeys.js'
import { DEFAULT_USER_ID } from '../lib/requestContext.js'

const router = express.Router()

function dirSizeBytes(dir) {
  if (!fs.existsSync(dir)) return 0
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    try {
      if (entry.isDirectory()) total += dirSizeBytes(full)
      else total += fs.statSync(full).size
    } catch {} // a file can vanish between readdir and stat; skip it rather than crash the whole listing
  }
  return total
}

// No du subprocess — a small recursive stat walk is portable and avoids shelling out.
function computeUserStorageBytes(userId) {
  const dbPath = resolveDbPath(userId)
  let dbBytes = 0
  for (const suffix of ['', '-wal', '-shm']) {
    try { dbBytes += fs.statSync(dbPath + suffix).size } catch {}
  }
  return dbBytes + dirSizeBytes(resolveUploadsDir(userId))
}

router.get('/users', (req, res) => {
  try {
    const users = listUsersForAdmin().map(u => ({
      id: u.id,
      email: u.email,
      createdAt: u.created_at,
      lastSeen: u.last_seen,
      sessionCount: u.session_count,
      storageBytes: computeUserStorageBytes(u.id),
      operatorKeyApproved: Boolean(u.operator_key_approved),
      isAdmin: Boolean(u.is_admin),
      status: u.status,
      ...ownKeyStatus(u.id)
    }))
    res.json({ users })
  } catch (err) {
    console.error('Admin users list error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.patch('/users/:id/operator-key-approval', (req, res) => {
  const userId = Number(req.params.id)
  const user = findUserById(userId)
  if (!user) return res.status(404).json({ error: 'User not found' })
  setOperatorKeyApproval(user.email, Boolean(req.body?.approved))
  res.json({ ok: true })
})

router.patch('/users/:id/status', (req, res) => {
  const userId = Number(req.params.id)
  const status = req.body?.status
  if (!['active', 'disabled'].includes(status)) return res.status(400).json({ error: 'status must be active or disabled' })
  if (!findUserById(userId)) return res.status(404).json({ error: 'User not found' })
  setUserStatus(userId, status)
  res.json({ ok: true, status })
})

router.patch('/users/:id/admin', (req, res) => {
  const userId = Number(req.params.id)
  const nextIsAdmin = Boolean(req.body?.isAdmin)
  const user = findUserById(userId)
  if (!user) return res.status(404).json({ error: 'User not found' })
  if (!nextIsAdmin && isAdmin(userId) && countAdmins() <= 1) {
    return res.status(400).json({ error: 'Cannot remove the last admin' })
  }
  setAdmin(userId, nextIsAdmin)
  res.json({ ok: true, isAdmin: nextIsAdmin })
})

router.post('/users/:id/reset-password', (req, res) => {
  const userId = Number(req.params.id)
  if (!findUserById(userId)) return res.status(404).json({ error: 'User not found' })
  // Shown exactly once — this response is the only place the raw code ever appears.
  const code = createPasswordResetCode(userId)
  res.json({ code })
})

router.post('/users/:id/revoke-sessions', (req, res) => {
  const userId = Number(req.params.id)
  if (!findUserById(userId)) return res.status(404).json({ error: 'User not found' })
  // No "keep current" session to preserve here (the admin is revoking someone ELSE's
  // sessions, not their own) — pass a token hash that can never match a real one.
  const revoked = revokeOtherSessions(userId, '')
  res.json({ revoked })
})

router.delete('/users/:id', (req, res) => {
  const userId = Number(req.params.id)
  const user = findUserById(userId)
  if (!user) return res.status(404).json({ error: 'User not found' })
  if (userId === DEFAULT_USER_ID) return res.status(400).json({ error: 'Cannot delete the operator account' })
  if (userId === req.wardrobeSession.user_id) return res.status(400).json({ error: 'Cannot delete your own account' })
  if (isAdmin(userId) && countAdmins() <= 1) return res.status(400).json({ error: 'Cannot delete the last admin' })
  const confirmEmail = String(req.body?.confirmEmail || '').toLowerCase().trim()
  if (confirmEmail !== user.email) return res.status(400).json({ error: 'Email confirmation does not match' })

  deleteUserAndSessions(userId) // cascades sessions; invites/reset-codes referencing them go NULL/cascade per their own FKs
  // The data directory is a single directory by construction (spec 33's per-user file
  // layout) — deletion is genuinely complete, which is exactly why this needs the
  // confirmation above. dirname() of the db path is that directory for any non-default
  // userId (the DEFAULT_USER_ID branch above already refused before we get here).
  const dataDir = path.dirname(resolveDbPath(userId))
  try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch (err) {
    console.error(`Deleted user ${userId} from system.db but failed to remove ${dataDir}:`, err.message)
  }
  res.json({ ok: true })
})

// ── Invites ────────────────────────────────────────────────────────────────────
router.get('/invites', (req, res) => {
  res.json({ invites: listInvites() })
})

router.post('/invites', (req, res) => {
  const code = createInvite(req.wardrobeSession.user_id)
  res.json({ code })
})

router.delete('/invites/:code', (req, res) => {
  const revoked = revokeInvite(req.params.code)
  if (!revoked) return res.status(400).json({ error: 'Code not found or already used' })
  res.json({ ok: true })
})

// ── Invite requests (spec 34 Part 3 — table + admin side only; the public submission
// endpoint ships in a later PR) ─────────────────────────────────────────────────
router.get('/invite-requests', (req, res) => {
  res.json({ requests: listInviteRequests() })
})

router.patch('/invite-requests/:id', (req, res) => {
  const status = req.body?.status
  if (!['approved', 'dismissed'].includes(status)) return res.status(400).json({ error: 'status must be approved or dismissed' })
  const id = Number(req.params.id)
  const request = systemDb.prepare('SELECT * FROM invite_requests WHERE id = ?').get(id)
  if (!request) return res.status(404).json({ error: 'Request not found' })
  decideInviteRequest(id, status)
  if (status === 'approved') {
    const code = createInvite(req.wardrobeSession.user_id)
    return res.json({ ok: true, code })
  }
  res.json({ ok: true })
})

export default router
