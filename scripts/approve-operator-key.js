// Spec 33 Part 4 (follow-up, owner ruling 2026-07-20) — no invited user rides on the
// operator's API key by default; the operator has to explicitly approve them. No admin
// UI in v1, CLI only, matching create-invite.js/reset-password.js.
// Usage: node scripts/approve-operator-key.js <email> [--revoke]
import { findUserByEmail, setOperatorKeyApproval } from '../lib/systemDb.js'

const [, , email, flag] = process.argv
if (!email) {
  console.error('Usage: node scripts/approve-operator-key.js <email> [--revoke]')
  process.exit(1)
}
const approve = flag !== '--revoke'

const user = findUserByEmail(email)
if (!user) {
  console.error(`No account found for ${email}`)
  process.exit(1)
}

setOperatorKeyApproval(email, approve)
console.log(`${user.email} ${approve ? 'can now use' : 'no longer has access to'} the operator's API key.`)
