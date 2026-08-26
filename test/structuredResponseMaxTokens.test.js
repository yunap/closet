// thread_1787687552307: the selected-piece visual composer hit a hardcoded maxTokens: 2000
// with 33 shown pieces and was truncated mid-JSON, then reported as generic "Model did not
// return JSON" instead of an identifiable token-cap hit. See docs/post-254-architecture-roadmap.md
// R7. This locked in the fix: one shared, count-scaled budget for the visual-composer JSON
// schema (visualComposerMaxTokensForOutfitCount), replacing the two independent hardcoded
// literals (2000 / 2200) that ignored how many outfits were actually requested.
//
// thread_1787717774384 showed the same class of defect in a third, un-unified call site: the
// atomic capsule composer (routes/ai.js's composeCapsulePlanOnce) carried its own separate,
// under-tuned formula instead of this shared one, and a 10-look/24-piece capsule silently
// truncated to zero outfits. The function was renamed structuredOutfitMaxTokens and folded that
// call site in with its own honest per-outfit rate.
//
// thread_1787725557304 then showed a second, genuinely different-shaped caller wanting the same
// formula: capsule roster selection (routes/ai.js's capsuleRosterSelectionSchema) scales by
// garment count, not outfit count, and needed a different base offset for its free-text
// reasoning fields — its own private formula hit its ceiling twice in the same live turn. Per
// codebase-design's "two adapters means a real seam," the function was generalized once more
// (base offset added, renamed structuredResponseMaxTokens) instead of adding a fourth private
// formula beside it.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'
// Hermetic DB isolation (spec 21/29 doctrine): core.js's import chain reaches db.js, whose
// module-load migrations would otherwise run against the real wardrobe.db.
const tmpRoot = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'structured-response-max-tokens-'))
process.env.WARDROBE_DB_PATH = nodePath.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = nodePath.join(tmpRoot, 'uploads')
const { structuredResponseMaxTokens } = await import('../styling-engine/core.js')

test('structuredResponseMaxTokens scales with requested item count using the default (visual-composer) rate', () => {
  const forFour = structuredResponseMaxTokens(4)
  const forOne = structuredResponseMaxTokens(1)
  const forFive = structuredResponseMaxTokens(5)
  assert.ok(forFour > forOne, 'more requested items must get a larger budget, not a flat constant')
  assert.ok(forFive > forFour)
})

test('structuredResponseMaxTokens default rate never regresses below the previously hardcoded ceilings', () => {
  // The selected-piece composer always requests 3-4 outfits and previously hardcoded 2000; the
  // whole-wardrobe composer requests up to 5 and previously hardcoded 2200 regardless of count.
  assert.ok(structuredResponseMaxTokens(4) > 2000)
  assert.ok(structuredResponseMaxTokens(1) >= 2200)
  assert.ok(structuredResponseMaxTokens(2) >= 2200)
})

test('structuredResponseMaxTokens default rate clamps and tolerates bad input', () => {
  assert.equal(structuredResponseMaxTokens(0), structuredResponseMaxTokens(1))
  assert.equal(structuredResponseMaxTokens(-3), structuredResponseMaxTokens(1))
  assert.equal(structuredResponseMaxTokens(undefined), structuredResponseMaxTokens(4))
  assert.ok(structuredResponseMaxTokens(999) <= 4200)
})

test('structuredResponseMaxTokens accepts a caller-supplied rate/base/floor/ceiling for capsule composition', () => {
  const capsuleTen = structuredResponseMaxTokens(10, { tokensPerItem: 550, base: 900, floor: 2200, ceiling: 7500 })
  // The old capsule formula (600 + count*180, ceiling 3200) hit exactly 2400 for a 10-look
  // capsule and truncated it (thread_1787717774384). The replacement must clear that ceiling.
  assert.ok(capsuleTen > 3200)
  const capsuleTwelve = structuredResponseMaxTokens(12, { tokensPerItem: 550, base: 900, floor: 2200, ceiling: 7500 })
  assert.equal(capsuleTwelve, 900 + 12 * 550)
  assert.ok(capsuleTwelve <= 7500)
})

test('structuredResponseMaxTokens accepts a caller-supplied rate/base/floor/ceiling for capsule roster selection', () => {
  // The old roster formula (300 + budget*65, floor 900, no explicit ceiling beyond the floor's
  // Math.max) hit exactly 1860 for a 24-piece budget, twice in the same turn — once on the
  // initial attempt and again on the repair (thread_1787725557304). The replacement must clear
  // that ceiling with real headroom for the schema's free-text reasoning fields.
  const rosterBudget24 = structuredResponseMaxTokens(24, { tokensPerItem: 100, base: 1500, floor: 1500, ceiling: 5500 })
  assert.ok(rosterBudget24 > 1860 * 1.5, 'must clear the old ceiling with real headroom, not by a sliver')
  assert.equal(rosterBudget24, 1500 + 24 * 100)
})
