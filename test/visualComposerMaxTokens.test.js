// thread_1787687552307: the selected-piece visual composer hit a hardcoded maxTokens: 2000
// with 33 shown pieces and was truncated mid-JSON, then reported as generic "Model did not
// return JSON" instead of an identifiable token-cap hit. See docs/post-254-architecture-roadmap.md
// R7. This locks in the fix: one shared, outfit-count-scaled budget for the visual-composer
// JSON schema, replacing the two independent hardcoded literals (2000 / 2200) that ignored how
// many outfits were actually requested.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'
// Hermetic DB isolation (spec 21/29 doctrine): core.js's import chain reaches db.js, whose
// module-load migrations would otherwise run against the real wardrobe.db.
const tmpRoot = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'visual-composer-max-tokens-'))
process.env.WARDROBE_DB_PATH = nodePath.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = nodePath.join(tmpRoot, 'uploads')
const { visualComposerMaxTokensForOutfitCount } = await import('../styling-engine/core.js')

test('visualComposerMaxTokensForOutfitCount scales with requested outfit count', () => {
  const forFour = visualComposerMaxTokensForOutfitCount(4)
  const forOne = visualComposerMaxTokensForOutfitCount(1)
  const forFive = visualComposerMaxTokensForOutfitCount(5)
  assert.ok(forFour > forOne, 'more requested outfits must get a larger budget, not a flat constant')
  assert.ok(forFive > forFour)
})

test('visualComposerMaxTokensForOutfitCount never regresses below the previously hardcoded ceilings', () => {
  // The selected-piece composer always requests 3-4 outfits and previously hardcoded 2000; the
  // whole-wardrobe composer requests up to 5 and previously hardcoded 2200 regardless of count.
  assert.ok(visualComposerMaxTokensForOutfitCount(4) > 2000)
  assert.ok(visualComposerMaxTokensForOutfitCount(1) >= 2200)
  assert.ok(visualComposerMaxTokensForOutfitCount(2) >= 2200)
})

test('visualComposerMaxTokensForOutfitCount clamps and tolerates bad input', () => {
  assert.equal(visualComposerMaxTokensForOutfitCount(0), visualComposerMaxTokensForOutfitCount(1))
  assert.equal(visualComposerMaxTokensForOutfitCount(-3), visualComposerMaxTokensForOutfitCount(1))
  assert.equal(visualComposerMaxTokensForOutfitCount(undefined), visualComposerMaxTokensForOutfitCount(4))
  assert.ok(visualComposerMaxTokensForOutfitCount(999) <= 4200)
})
