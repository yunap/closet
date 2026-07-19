// Spec 33 Part 2 — no password-reset email flow in v1; the operator resets from the CLI.
// Usage: node scripts/reset-password.js <email> <new-password>
import { findUserByEmail, hashPassword, db } from '../lib/systemDb.js'

const [, , email, newPassword] = process.argv
if (!email || !newPassword) {
  console.error('Usage: node scripts/reset-password.js <email> <new-password>')
  process.exit(1)
}
if (newPassword.length < 8) {
  console.error('Password must be at least 8 characters')
  process.exit(1)
}

const user = findUserByEmail(email)
if (!user) {
  console.error(`No account found for ${email}`)
  process.exit(1)
}

db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id)
console.log(`Password reset for ${user.email}`)
