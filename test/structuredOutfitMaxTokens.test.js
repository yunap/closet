// thread_1787687552307: the selected-piece visual composer hit a hardcoded maxTokens: 2000
// with 33 shown pieces and was truncated mid-JSON, then reported as generic "Model did not
// return JSON" instead of an identifiable token-cap hit. See docs/post-254-architecture-roadmap.md
// R7. This locked in the fix: one shared, outfit-count-scaled budget for the visual-composer
// JSON schema, replacing the two independent hardcoded literals (2000 / 2200) that ignored how
// many outfits were actually requested.
//
// thread_1787717774384 showed the same class of defect in a third, un-unified call site: the
// atomic capsule composer (routes/ai.js's composeCapsulePlanOnce) carried its own separate,
// under-tuned formula instead of this shared one, and a 10-look/24-piece capsule silently
// truncated to zero outfits. structuredOutfitMaxTokens was generalized (renamed from
// visualComposerMaxTokensForOutfitCount) so every "generate N structured outfits" call site
// states its own honest per-outfit rate and ceiling as data, instead of re-deriving a formula.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'
// Hermetic DB isolation (spec 21/29 doctrine): core.js's import chain reaches db.js, whose
// module-load migrations would otherwise run against the real wardrobe.db.
const tmpRoot = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'structured-outfit-max-tokens-'))
process.env.WARDROBE_DB_PATH = nodePath.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = nodePath.join(tmpRoot, 'uploads')
const { structuredOutfitMaxTokens } = await import('../styling-engine/core.js')

test('structuredOutfitMaxTokens scales with requested outfit count using the default (visual-composer) rate', () => {
  const forFour = structuredOutfitMaxTokens(4)
  const forOne = structuredOutfitMaxTokens(1)
  const forFive = structuredOutfitMaxTokens(5)
  assert.ok(forFour > forOne, 'more requested outfits must get a larger budget, not a flat constant')
  assert.ok(forFive > forFour)
})

test('structuredOutfitMaxTokens default rate never regresses below the previously hardcoded ceilings', () => {
  // The selected-piece composer always requests 3-4 outfits and previously hardcoded 2000; the
  // whole-wardrobe composer requests up to 5 and previously hardcoded 2200 regardless of count.
  assert.ok(structuredOutfitMaxTokens(4) > 2000)
  assert.ok(structuredOutfitMaxTokens(1) >= 2200)
  assert.ok(structuredOutfitMaxTokens(2) >= 2200)
})

test('structuredOutfitMaxTokens default rate clamps and tolerates bad input', () => {
  assert.equal(structuredOutfitMaxTokens(0), structuredOutfitMaxTokens(1))
  assert.equal(structuredOutfitMaxTokens(-3), structuredOutfitMaxTokens(1))
  assert.equal(structuredOutfitMaxTokens(undefined), structuredOutfitMaxTokens(4))
  assert.ok(structuredOutfitMaxTokens(999) <= 4200)
})

test('structuredOutfitMaxTokens accepts a caller-supplied rate/floor/ceiling instead of the default', () => {
  const capsuleTen = structuredOutfitMaxTokens(10, { tokensPerOutfit: 550, floor: 2200, ceiling: 7500 })
  // The old capsule formula (600 + count*180, ceiling 3200) hit exactly 2400 for a 10-look
  // capsule and truncated it (thread_1787717774384). The replacement must clear that ceiling.
  assert.ok(capsuleTen > 3200)
  const capsuleTwelve = structuredOutfitMaxTokens(12, { tokensPerOutfit: 550, floor: 2200, ceiling: 7500 })
  assert.equal(capsuleTwelve, 900 + 12 * 550)
  assert.ok(capsuleTwelve <= 7500)
})
