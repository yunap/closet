import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const readDoc = name => fs.readFileSync(path.join(process.cwd(), 'docs', name), 'utf8')

test('post-254 architecture roadmap retains its end-state, residual inventory, and regression rules', () => {
  const roadmap = readDoc('post-254-architecture-roadmap.md')

  assert.match(roadmap, /^# Post-254 architecture roadmap/m)
  assert.match(roadmap, /^## Architectural end-state$/m)
  assert.match(roadmap, /^## Residual roadmap$/m)
  assert.match(roadmap, /^## Do not regress$/m)
  assert.match(roadmap, /Intentional policy or duplication\? \| Risk if left as-is \| Intended canonical\/shared contract/)
  assert.match(roadmap, /Now.*After PR 254 live validation.*Concrete-defect only/s)
  for (let id = 1; id <= 10; id += 1) {
    assert.match(roadmap, new RegExp(`^\\| R${id} \\|`, 'm'), `roadmap R${id} must remain inventoried`)
  }
  assert.match(roadmap, /Do not create a universal ranking or candidate selector/)
  assert.match(roadmap, /Every new outfit-producing entry point must be added to the architecture consumer ratchet/)
})

test('architecture census does not regress to the stale pre-Slice-7 scorecard', () => {
  const census = readDoc('architecture-responsibility-census.md')

  assert.match(census, /Slices 0–7 complete/)
  assert.match(census, /post-254-architecture-roadmap\.md/)
  assert.doesNotMatch(census, /does not yet have a reusable outfit-production pipeline/)
  assert.doesNotMatch(census, /Shared rankings and verdicts in places, but no common builder/)
  assert.doesNotMatch(census, /Critical: remaining compatibility and validation callers can still diverge/)
  assert.doesNotMatch(census, /Critical: required categories or dependency supply can disappear before composition/)
  assert.doesNotMatch(census, /The remaining partial Slice 1 and Slice 3 questions/)
  assert.match(census, /No scorecard stage remains Critical after the completed Slice 0–7 consumer migrations/)
})
