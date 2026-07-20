// Spec 34 PR B — the public front door's one write. This router is mounted BEFORE the
// /api session guard in server.js, so it is reachable with no account and no session:
// a prospective user asking to be let in. The admin side (list + approve/decline) already
// exists at /api/admin/invite-requests from PR A; this only adds the public submission.
import express from 'express'
import { createInviteRequest } from '../lib/systemDb.js'

const router = express.Router()

router.post('/', (req, res) => {
  const { email, note } = req.body || {}
  // Minimal, honest validation: a plausible email is all that's required. We deliberately
  // do NOT check whether the address already has an account or a prior request — the reply
  // is the same either way, so an anonymous visitor can't probe who is already a member.
  if (!email || !String(email).includes('@') || String(email).length > 200) {
    return res.status(400).json({ error: 'A valid email is required' })
  }
  try {
    createInviteRequest(email, note)
    res.json({ ok: true })
  } catch (err) {
    console.error('Invite request error:', err)
    res.status(500).json({ error: 'Could not submit your request. Please try again.' })
  }
})

export default router
