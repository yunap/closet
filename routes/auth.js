// Spec 33 Part 2 — account/session endpoints. Mounted at /api/auth, unauthenticated-
// reachable (register/login/me must work before any session exists). Session middleware
// itself lives in server.js; this router only issues/consumes it via lib/cookies.js.
import express from 'express'
import {
  createUser,
  findUserByEmail,
  verifyPassword,
  createSession,
  resolveSession,
  listSessions,
  revokeSessionByHash,
  revokeOtherSessions,
  consumeInvite,
  isAdmin
} from '../lib/systemDb.js'
import { getSessionToken, setSessionCookie, clearSessionCookie } from '../lib/cookies.js'

const router = express.Router()

function userAgentLabel(req) {
  return String(req.headers['user-agent'] || '').slice(0, 200)
}

function currentSession(req) {
  return resolveSession(getSessionToken(req))
}

router.post('/register', (req, res) => {
  const { email, password, inviteCode } = req.body || {}
  if (!email || !String(email).includes('@')) return res.status(400).json({ error: 'A valid email is required' })
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
  if (!inviteCode) return res.status(400).json({ error: 'An invite code is required' })

  if (findUserByEmail(email)) return res.status(400).json({ error: 'An account with this email already exists' })

  const user = createUser(email, password)
  // Invite is consumed AFTER the account exists so a mid-request failure doesn't burn
  // a code with no account to show for it; if consumption fails, the account this
  // request just made is the only evidence — refuse and let the operator investigate
  // rather than leaving an unaccountable invite-less user behind.
  if (!consumeInvite(inviteCode, user.id)) {
    return res.status(400).json({ error: 'Invalid or already-used invite code' })
  }

  const rawToken = createSession(user.id, userAgentLabel(req))
  setSessionCookie(res, rawToken)
  res.json({ email: user.email })
})

router.post('/login', (req, res) => {
  const { email, password } = req.body || {}
  const user = findUserByEmail(email)
  // Same generic message whether the email or password was wrong — no user enumeration.
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password' })
  }
  // Owner ruling (spec 34): checked only AFTER the password verifies, so a disabled
  // account doesn't leak its existence to someone guessing passwords. Once verified,
  // the honest message is the kind one (friends-and-family trust model).
  if (user.status && user.status !== 'active') {
    return res.status(403).json({ error: 'This account has been disabled. Contact the operator.' })
  }
  const rawToken = createSession(user.id, userAgentLabel(req))
  setSessionCookie(res, rawToken)
  res.json({ email: user.email })
})

router.post('/logout', (req, res) => {
  const rawToken = getSessionToken(req)
  const session = rawToken ? resolveSession(rawToken) : null
  if (session) revokeSessionByHash(session.tokenHash)
  clearSessionCookie(res)
  res.json({ ok: true })
})

router.get('/me', (req, res) => {
  const session = currentSession(req)
  if (!session) return res.json({ authenticated: false })
  res.json({ authenticated: true, userId: session.user_id, isAdmin: isAdmin(session.user_id) })
})

router.get('/sessions', (req, res) => {
  const session = currentSession(req)
  if (!session) return res.status(401).json({ error: 'unauthorized' })
  const sessions = listSessions(session.user_id).map(s => ({
    id: s.token_hash.slice(0, 12),
    userAgentLabel: s.user_agent_label,
    createdAt: s.created_at,
    lastSeen: s.last_seen,
    isCurrent: s.token_hash === session.tokenHash
  }))
  res.json({ sessions })
})

router.delete('/sessions/:id', (req, res) => {
  const session = currentSession(req)
  if (!session) return res.status(401).json({ error: 'unauthorized' })
  const target = listSessions(session.user_id).find(s => s.token_hash.startsWith(req.params.id))
  if (!target) return res.status(404).json({ error: 'Session not found' })
  revokeSessionByHash(target.token_hash)
  res.json({ ok: true, revokedCurrent: target.token_hash === session.tokenHash })
})

router.post('/sessions/revoke-others', (req, res) => {
  const session = currentSession(req)
  if (!session) return res.status(401).json({ error: 'unauthorized' })
  const revoked = revokeOtherSessions(session.user_id, session.tokenHash)
  res.json({ revoked })
})

export default router
