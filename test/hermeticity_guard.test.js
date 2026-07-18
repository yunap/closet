// Hermeticity guard — the structural end of the spec 21/29 bug class.
// History: the live-DB-exposure bug was fixed file-by-file three times (spec 21 Part 1:
// four files; spec 29 Part 2: threadRail; spec 32: five more found when a new db.js
// migration made a stray import WRITE to the real wardrobe.db during a test run).
// File-by-file fixes don't survive refactors that change the import graph — this guard
// does: any test file whose imports can reach db.js MUST set WARDROBE_DB_PATH first.
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
  /import\('[^']*\/server\.js'\)/
]

test('every test file that can reach db.js isolates WARDROBE_DB_PATH', () => {
  const testDir = path.join(process.cwd(), 'test')
  const offenders = []
  for (const file of fs.readdirSync(testDir)) {
    if (!file.endsWith('.test.js')) continue
    const src = fs.readFileSync(path.join(testDir, file), 'utf8')
    const reachesDb = DB_REACHING_PATTERNS.some(pattern => pattern.test(src))
    if (reachesDb && !src.includes('WARDROBE_DB_PATH')) offenders.push(file)
  }
  assert.deepStrictEqual(offenders, [],
    `These test files import db.js-reaching modules without isolating WARDROBE_DB_PATH — they will run db.js migrations against the real wardrobe.db: ${offenders.join(', ')}`)
})
