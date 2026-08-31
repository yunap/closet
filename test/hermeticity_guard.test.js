// Hermeticity guard — the structural end of the spec 21/29 bug class.
// History: the live-DB-exposure bug was fixed file-by-file three times (spec 21 Part 1:
// four files; spec 29 Part 2: threadRail; spec 32: five more found when a new db.js
// migration made a stray import WRITE to the real wardrobe.db during a test run).
// File-by-file fixes don't survive refactors that change the import graph — this guard
// does: any test file whose imports can reach db.js MUST set WARDROBE_DB_PATH first.
//
// Spec 33 Part 1: db.js resolution is now per-user (DEFAULT_USER_ID still falls back to
// the legacy WARDROBE_DB_PATH-or-project-root path; other userIds resolve under
// WARDROBE_USERS_DIR / data/users/{id}/). A test isolates itself with EITHER env var —
// WARDROBE_USERS_DIR alone is valid for tests that only ever use non-default userIds.
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

// Modules whose import (directly or transitively) reaches db.js and its module-load
// migrations. Keep in sync with reality: if a new module grows a db.js dependency,
// add it here — the cost of forgetting is silent writes to the developer's real closet.
const DB_REACHING_PATTERNS = [
  /from\s+'[^']*\/db\.js'/,
  /import\('[^']*\/db\.js'\)/,
  /from\s+'[^']*styling-engine\/(tools|core|provider|promptRuntime)\.js'/,
  /import\('[^']*styling-engine\/(tools|core|provider|promptRuntime)\.js'\)/,
  /from\s+'[^']*routes\/(ai|crud)\.js'/,
  /import\('[^']*routes\/(ai|crud)\.js'\)/,
  /from\s+'[^']*\/server\.js'/,
  /import\('[^']*\/server\.js'\)/,
  /from\s+'[^']*scripts\/adopt-db\.js'/,
  /import\('[^']*scripts\/adopt-db\.js'\)/,
  /from\s+'[^']*\/lib\/apiKeys\.js'/,
  /import\('[^']*\/lib\/apiKeys\.js'\)/,
  /from\s+'[^']*routes\/admin\.js'/,
  /import\('[^']*routes\/admin\.js'\)/
]

test('every test file that can reach db.js isolates WARDROBE_DB_PATH or WARDROBE_USERS_DIR', () => {
  const testDir = path.join(process.cwd(), 'test')
  const offenders = []
  for (const file of fs.readdirSync(testDir)) {
    if (!file.endsWith('.test.js')) continue
    const src = fs.readFileSync(path.join(testDir, file), 'utf8')
    const reachesDb = DB_REACHING_PATTERNS.some(pattern => pattern.test(src))
    const isolated = src.includes('WARDROBE_DB_PATH') || src.includes('WARDROBE_USERS_DIR')
    if (reachesDb && !isolated) offenders.push(file)
  }
  assert.deepStrictEqual(offenders, [],
    `These test files import db.js-reaching modules without isolating WARDROBE_DB_PATH/WARDROBE_USERS_DIR — they will run db.js migrations against the real wardrobe.db: ${offenders.join(', ')}`)
})

// Spec 33 Part 2: server.js now touches system.db (auth.js's session lookup) on every
// single request, unconditionally — so any test that boots server.js reaches system.db
// too, whether or not it exercises auth at all. Same bug class, separate file.
const SYSTEM_DB_REACHING_PATTERNS = [
  /from\s+'[^']*\/server\.js'/,
  /import\('[^']*\/server\.js'\)/,
  /from\s+'[^']*\/lib\/systemDb\.js'/,
  /import\('[^']*\/lib\/systemDb\.js'\)/,
  /from\s+'[^']*routes\/auth\.js'/,
  /import\('[^']*routes\/auth\.js'\)/,
  /from\s+'[^']*scripts\/adopt-db\.js'/,
  /import\('[^']*scripts\/adopt-db\.js'\)/,
  /from\s+'[^']*routes\/admin\.js'/,
  /import\('[^']*routes\/admin\.js'\)/
]

test('every test file that can reach system.db isolates WARDROBE_SYSTEM_DB_PATH', () => {
  const testDir = path.join(process.cwd(), 'test')
  const offenders = []
  for (const file of fs.readdirSync(testDir)) {
    if (!file.endsWith('.test.js')) continue
    const src = fs.readFileSync(path.join(testDir, file), 'utf8')
    const reachesSystemDb = SYSTEM_DB_REACHING_PATTERNS.some(pattern => pattern.test(src))
    if (reachesSystemDb && !src.includes('WARDROBE_SYSTEM_DB_PATH')) offenders.push(file)
  }
  assert.deepStrictEqual(offenders, [],
    `These test files import system.db-reaching modules without isolating WARDROBE_SYSTEM_DB_PATH — they will create real accounts/sessions in the real system.db: ${offenders.join(', ')}`)
})

test('no test file references the real data/users/ multiuser directory directly', () => {
  const testDir = path.join(process.cwd(), 'test')
  const offenders = []
  for (const file of fs.readdirSync(testDir)) {
    if (!file.endsWith('.test.js')) continue
    const src = fs.readFileSync(path.join(testDir, file), 'utf8')
    // A literal data/users/ reference (not routed through a tmp WARDROBE_USERS_DIR)
    // would mean a test is reading/writing the real multiuser layout instead of an
    // isolated copy — same bug class as touching the real wardrobe.db directly.
    if (/['"`][^'"`]*\bdata\/users\//.test(src) && !src.includes('WARDROBE_USERS_DIR')) offenders.push(file)
  }
  assert.deepStrictEqual(offenders, [],
    `These test files reference data/users/ without routing through a tmp WARDROBE_USERS_DIR: ${offenders.join(', ')}`)
})

test('provider entry points fail closed under NODE_ENV=test unless a commissioned integration test opts in', () => {
  const providerSrc = fs.readFileSync(path.join(process.cwd(), 'styling-engine/provider.js'), 'utf8')
  assert.match(providerSrc, /NODE_ENV === 'test'/)
  assert.match(providerSrc, /WARDROBE_ALLOW_TEST_PROVIDER_NETWORK !== 'true'/)
  assert.match(providerSrc, /Provider network calls are disabled under NODE_ENV=test/)
  const packageJson = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
  assert.doesNotMatch(packageJson, /WARDROBE_ALLOW_TEST_PROVIDER_NETWORK=true/,
    'the ordinary npm test command must never opt into provider network calls')
  // readdirSync's order is filesystem-dependent, not alphabetical by contract — sort before
  // comparing so this assertion doesn't flake on directory-entry ordering.
  const optIns = fs.readdirSync(path.join(process.cwd(), 'test'))
    .filter(file => file.endsWith('.test.js'))
    .filter(file => file !== 'hermeticity_guard.test.js')
    .filter(file => fs.readFileSync(path.join(process.cwd(), 'test', file), 'utf8').includes("process.env.WARDROBE_ALLOW_TEST_PROVIDER_NETWORK = 'true'"))
    .sort()
  assert.deepStrictEqual(optIns, ['api_keys.test.js', 'gemini_call_turn.test.js'],
    'only a dedicated direct-provider contract test may use the test provider escape hatch, and only when it stubs the real SDK client (gemini_call_turn.test.js patches GoogleGenAI.prototype.interactions — no real network call is ever made)')
})
