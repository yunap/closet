// Spec 33 Part 2 — no invite UI in v1; the operator mints codes from the CLI.
// Usage: node scripts/create-invite.js
import { createInvite } from '../lib/systemDb.js'

const code = createInvite(null)
console.log(`Invite code: ${code}`)
