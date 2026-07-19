// Spec 33 Part 2 — bootstraps Yuna's own account. Part 1 already made DEFAULT_USER_ID (1)
// resolve to her real wardrobe.db/uploads/ (legacy-path fallback); this script only needs
// to create the system.db side — the matching user row with id=1 — so her session then
// resolves to data she already has. No file copying: that's Part 3's adopt-db.js, for
// onboarding OTHER pre-existing instances. This script is for exactly one thing: the
// very first account on a fresh system.db, id forced to 1 to line up with DEFAULT_USER_ID.
// Usage: node scripts/create-first-user.js <email> <password>
import { db, hashPassword } from '../lib/systemDb.js'
import { DEFAULT_USER_ID } from '../lib/requestContext.js'

const [, , email, password] = process.argv
if (!email || !password) {
  console.error('Usage: node scripts/create-first-user.js <email> <password>')
  process.exit(1)
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters')
  process.exit(1)
}

const existingCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
if (existingCount > 0) {
  console.error(`system.db already has ${existingCount} user(s) — this script is only for bootstrapping the very first account. Use scripts/create-invite.js + registration for anyone else.`)
  process.exit(1)
}

db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
  .run(DEFAULT_USER_ID, email.toLowerCase().trim(), hashPassword(password))
console.log(`Created user #${DEFAULT_USER_ID} (${email}) — this account resolves to your existing wardrobe.`)
