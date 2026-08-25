import test from 'node:test'
import assert from 'node:assert/strict'
import { isOutfitStructurallyValid, locallyGateWholeWardrobeOutfits, inferOutfitArchetype, qualifiesWholeWardrobeMission } from '../styling-engine/rules.js'
import { describeOutfitStructureGap, evaluateOutfitStructure } from '../styling-engine/outfitValidation.js'

test('typed structure findings preserve the boolean and diagnosis contracts', () => {
  const top = { category: 'top', name: 'Top' }
  const bottom = { category: 'bottom', name: 'Bottom' }
  const shoe = { category: 'shoes', name: 'Shoe' }
  const valid = evaluateOutfitStructure([top, bottom, shoe])
  assert.equal(valid.valid, true)
  assert.deepEqual(valid.findings, [])

  const incomplete = evaluateOutfitStructure([top])
  assert.equal(incomplete.valid, false)
  assert.deepEqual(incomplete.findings.map(finding => finding.code), ['missing_shoes', 'missing_bottom'])
  assert.equal(incomplete.primaryFinding.message, 'missing shoes')
  assert.equal(describeOutfitStructureGap([top]), 'missing shoes')
  assert.equal(isOutfitStructurallyValid([top]), false)
})

test('isOutfitStructurallyValid - basic validation cases', () => {
  // 1. Valid separates: 1 top, 1 bottom, 1 shoe
  assert.ok(isOutfitStructurallyValid([
    { category: 'top', name: 'Cotton Tee' },
    { category: 'bottom', name: 'Jeans' },
    { category: 'shoes', name: 'Sneakers' }
  ]))

  // 2. Valid dress: 1 dress, 1 shoe
  assert.ok(isOutfitStructurallyValid([
    { category: 'dress', name: 'Sun Dress' },
    { category: 'shoes', name: 'Sandals' }
  ]))

  // 3. Dress + layering top is allowed
  assert.ok(isOutfitStructurallyValid([
    { category: 'dress', name: 'Sun Dress' },
    { category: 'top', name: 'Cardigan' },
    { category: 'shoes', name: 'Sandals' }
  ]))

  // 4. Dress + bottom is invalid
  assert.ok(!isOutfitStructurallyValid([
    { category: 'dress', name: 'Sun Dress' },
    { category: 'bottom', name: 'Jeans' },
    { category: 'shoes', name: 'Sandals' }
  ]))

  // 5. Two bottoms is invalid
  assert.ok(!isOutfitStructurallyValid([
    { category: 'top', name: 'Cotton Tee' },
    { category: 'bottom', name: 'Jeans' },
    { category: 'bottom', name: 'Shorts' },
    { category: 'shoes', name: 'Sneakers' }
  ]))

  // 6. Two pairs of shoes is invalid
  assert.ok(!isOutfitStructurallyValid([
    { category: 'top', name: 'Cotton Tee' },
    { category: 'bottom', name: 'Jeans' },
    { category: 'shoes', name: 'Sneakers' },
    { category: 'shoes', name: 'Loafers' }
  ]))

  // 7. No top is invalid for separates
  assert.ok(!isOutfitStructurallyValid([
    { category: 'bottom', name: 'Jeans' },
    { category: 'shoes', name: 'Sneakers' }
  ]))

  // 8. No shoes is invalid when requireShoes is true (default)
  assert.ok(!isOutfitStructurallyValid([
    { category: 'top', name: 'Cotton Tee' },
    { category: 'bottom', name: 'Jeans' }
  ]))

  // 9. No shoes is valid when requireShoes is false
  assert.ok(isOutfitStructurallyValid([
    { category: 'top', name: 'Cotton Tee' },
    { category: 'bottom', name: 'Jeans' }
  ], { requireShoes: false }))
})

test('locallyGateWholeWardrobeOutfits - filters invalid outfits', () => {
  // formality tagged on every piece so this test exercises only what it's named for (structural
  // validity), not spec 8's register-ceiling 'unknown' gate incidentally catching untagged fixtures.
  const candidatePieces = [
    { id: 1, name: 'Cotton Dress', category: 'dress', formality: 'everyday' },
    { id: 2, name: 'Leather Boots', category: 'shoes', formality: 'everyday' },
    { id: 3, name: 'Jeans', category: 'bottom', formality: 'everyday' },
    { id: 4, name: 'Sneakers', category: 'shoes', formality: 'everyday' },
    { id: 5, name: 'Loafers', category: 'shoes', formality: 'everyday' }
  ]

  const outfits = [
    // Valid dress outfit
    {
      label: 'Valid Dress Outfit',
      pieceIds: [1, 2],
      pieces: [
        { id: 1, name: 'Cotton Dress', category: 'dress', formality: 'everyday' },
        { id: 2, name: 'Leather Boots', category: 'shoes', formality: 'everyday' }
      ]
    },
    // Invalid: no top, two shoes (the bug reported by user)
    {
      label: 'Buggy Outfit',
      pieceIds: [3, 4, 5],
      pieces: [
        { id: 3, name: 'Jeans', category: 'bottom', formality: 'everyday' },
        { id: 4, name: 'Sneakers', category: 'shoes', formality: 'everyday' },
        { id: 5, name: 'Loafers', category: 'shoes', formality: 'everyday' }
      ]
    }
  ]

  const result = locallyGateWholeWardrobeOutfits(outfits, 5, {
    candidatePieces,
    requireShoes: true
  })

  assert.equal(result.outfits.length, 1)
  // 2026-08-16: an authored label now survives repair. It used to be overwritten with the
  // archetype name, which collapsed distinct model outfits into one label — a live response
  // returned two different cards both called "Grounded Dress Edit: standard wear". The
  // whole-wardrobe advisor path already keeps model labels (it skips repair), so this is the
  // selected-piece path catching up rather than a new convention.
  assert.equal(result.outfits[0].label, 'Valid Dress Outfit')
  // The archetype template is still the fallback: this fixture supplies no reason, so one is
  // generated for it.
  assert.ok(String(result.outfits[0].reason || '').trim(), 'an outfit with no authored reason still gets the generated one')
  assert.ok(result.rejected.some(r => r.reason === 'not a complete wardrobe outfit'))
})

test('locallyGateWholeWardrobeOutfits advisor mode keeps but flags walking footwear caught by structured enums (spec 8)', () => {
  // Spec 8 (2026-07-09): this final profileRuleFit check previously had no activityProfile/
  // registerCeiling awareness at all — the walking-unsuitable shoe passed through completely
  // unflagged. Now it's caught, and — because this is advisor mode — kept with a caution flag
  // rather than dropped, same treatment as the function's other soft/subjective checks.
  const outfit = {
    label: 'Model Returned Walking Look',
    pieceIds: [1, 2, 3],
    pieces: [
      { id: 1, name: 'Cotton Tee', category: 'top' },
      { id: 2, name: 'Jeans', category: 'bottom' },
      { id: 3, name: 'Low-support sandals', category: 'shoes', heel_height: 'flat', walk_support: 'low' }
    ],
    reason: 'The model returned this complete outfit.'
  }
  const candidatePieces = outfit.pieces

  const result = locallyGateWholeWardrobeOutfits([outfit], 5, {
    mode: 'advisor',
    candidatePieces,
    occasion: 'travel',
    activity: 'walking',
    applyDiversity: false
  })

  assert.equal(result.outfits.length, 1)
  assert.deepEqual(result.outfits[0].pieceIds, outfit.pieceIds)
  assert.deepEqual(result.outfits[0].pieces, outfit.pieces)
  assert.equal(result.outfits[0].label, outfit.label)
  assert.ok(result.outfits[0].systemFlags?.some(f => f.type === 'occasion' && /support unsuitable/.test(f.message)))
  assert.deepEqual(result.rejected, [])
})

test('locallyGateWholeWardrobeOutfits non-advisor (gate) mode rejects the same walking-unsuitable footwear outright (spec 8)', () => {
  const outfit = {
    label: 'Model Returned Walking Look',
    pieceIds: [1, 2, 3],
    pieces: [
      { id: 1, name: 'Cotton Tee', category: 'top' },
      { id: 2, name: 'Jeans', category: 'bottom' },
      { id: 3, name: 'Low-support sandals', category: 'shoes', heel_height: 'flat', walk_support: 'low' }
    ],
    reason: 'The model returned this complete outfit.'
  }
  const candidatePieces = outfit.pieces

  const result = locallyGateWholeWardrobeOutfits([outfit], 5, {
    candidatePieces,
    occasion: 'travel',
    activity: 'walking',
    applyDiversity: false
  })

  assert.equal(result.outfits.length, 0)
  assert.ok(result.rejected.some(r => /support unsuitable/.test(r.reason)))
})

test('inferOutfitArchetype restricts dress archetypes to outfits containing a dress', () => {
  const candidatePieces = [
    { id: 1, name: 'Cotton Dress', category: 'dress' },
    { id: 2, name: 'Leather Boots', category: 'shoes' },
    { id: 3, name: 'Cotton Blouse', category: 'top' },
    { id: 4, name: 'Sage Pants', category: 'bottom' }
  ]

  // Separates outfit (no dress) -> must not match dress_grounded_sharp
  const separatesOutfit = { pieceIds: [3, 4, 2] }
  const arch1 = inferOutfitArchetype(separatesOutfit, candidatePieces)
  assert.notEqual(arch1.archetypeId, 'dress_grounded_sharp', 'Separates outfits must not match dress archetype')

  // Dress outfit (has dress) -> must match dress_grounded_sharp
  const dressOutfit = { pieceIds: [1, 2] }
  const arch2 = inferOutfitArchetype(dressOutfit, candidatePieces)
  assert.equal(arch2.archetypeId, 'dress_grounded_sharp', 'Dress outfits must match dress archetype')
})

test('inferOutfitArchetype abstains when no archetype earns a grounded role match', () => {
  const candidatePieces = [
    { id: 1, name: 'Plain Scarf', category: 'accessory', colors: ['white'], reads_as: 'plain cloth scarf' },
    { id: 2, name: 'Plain Belt', category: 'accessory', colors: ['beige'], reads_as: 'plain belt' },
    { id: 3, name: 'Plain Socks', category: 'accessory', colors: ['white'], reads_as: 'plain socks' }
  ]

  const arch = inferOutfitArchetype({ pieceIds: [1, 2, 3] }, candidatePieces)
  assert.equal(arch.archetypeId, null)
  assert.equal(arch.direction, '')
  assert.equal(arch.silhouette, '')
})

test('whole wardrobe mission qualification abstains from unearned labels', () => {
  const blackBeigeBrown = [
    { id: 1, category: 'top', colors: ['black'], reads_as: 'plain black cotton top', fabric_category: 'cotton', pattern_type: 'solid' },
    { id: 2, category: 'bottom', colors: ['beige'], reads_as: 'plain beige cotton pants', fabric_category: 'cotton', pattern_type: 'solid' },
    { id: 3, category: 'shoes', colors: ['brown'], reads_as: 'brown leather shoes', fabric_category: 'leather', pattern_type: 'solid' }
  ]
  assert.equal(qualifiesWholeWardrobeMission(blackBeigeBrown, 'monochrome_texture'), false)
  assert.equal(qualifiesWholeWardrobeMission(blackBeigeBrown, 'unexpected_pairing'), false)

  const tonalTexture = [
    { id: 4, category: 'top', colors: ['cream'], reads_as: 'cream ribbed knit shell', fabric_category: 'knit', pattern_type: 'solid' },
    { id: 5, category: 'bottom', colors: ['oatmeal'], reads_as: 'oatmeal linen trousers', fabric_category: 'linen', pattern_type: 'solid' },
    { id: 6, category: 'shoes', colors: ['tan'], reads_as: 'tan suede flats', fabric_category: 'suede', pattern_type: 'solid' }
  ]
  assert.equal(qualifiesWholeWardrobeMission(tonalTexture, 'monochrome_texture'), true)

  const controlledPrint = [
    { id: 7, category: 'top', colors: ['blue'], reads_as: 'blue botanical print blouse', fabric_category: 'cotton', pattern_type: 'botanical' },
    { id: 8, category: 'bottom', colors: ['black'], reads_as: 'black structured trousers', fabric_category: 'twill', pattern_type: 'solid' },
    { id: 9, category: 'shoes', colors: ['black'], reads_as: 'black leather loafers', fabric_category: 'leather', pattern_type: 'solid' }
  ]
  assert.equal(qualifiesWholeWardrobeMission(controlledPrint, 'controlled_print'), true)
})

// docs/card-consistency-spec.md Part 1 — a card and its own words must agree.
// A top worn with a dress stays legal (owner ruling 2026-08-16); what is enforced is that the
// card accounts for it. Live case: thread_1786659896815 paired a blouse and a floral tank with a
// lace midi dress and explained neither, under a label implying no top was present.
test('a top with a dress is detected, permitted, and required to be explained', async () => {
  const { outfitLayersTopWithDress, unexplainedLayeredTops, isOutfitStructurallyValid } =
    await import('../styling-engine/rules.js')

  const pieces = [
    { id: 136, name: 'black blouson v-neck top', category: 'top' },
    { id: 990360, name: 'black brown lace floral midi dress', category: 'dress' },
    { id: 184, name: 'patchwork knit buttoned top', category: 'outerwear' },
    { id: 198, name: 'taupe knit lace-up sneakers', category: 'shoes' },
  ]

  // Never gated: this is a styling decision, not a structural error.
  assert.ok(isOutfitStructurallyValid(pieces, { requireShoes: true }))
  assert.ok(outfitLayersTopWithDress(pieces))
  assert.ok(!outfitLayersTopWithDress(pieces.filter(p => p.category !== 'top')))

  // The live prose: describes the dress and the layer, never the blouse.
  const ignores = 'black brown lace floral midi dress carries the column, and patchwork knit buttoned top adds the structure around it.'
  assert.deepEqual(unexplainedLayeredTops({ reason: ignores }, pieces).map(p => p.id), [136])

  // Naming it — in full, or by a word that distinguishes it — satisfies the check.
  assert.equal(unexplainedLayeredTops({ reason: 'The black blouson v-neck top smooths the line under the lace midi dress.' }, pieces).length, 0)
  assert.equal(unexplainedLayeredTops({ reason: 'The blouson underneath keeps the lace from reading as sheer.' }, pieces).length, 0)

  // A word shared with another garment in the same outfit cannot distinguish it. "black" appears
  // in both the blouse and the dress, so prose about the dress must not read as prose about the
  // top — that false negative is the live case this check exists to catch.
  assert.deepEqual(unexplainedLayeredTops({ reason: 'The black brown lace floral midi dress carries the look.' }, pieces).map(p => p.id), [136])

  // No prose at all cannot explain anything.
  assert.deepEqual(unexplainedLayeredTops({ reason: '' }, pieces).map(p => p.id), [136])
})

test('an unexplained layered top is flagged and KEPT, never dropped', async () => {
  const { locallyGateWholeWardrobeOutfits, LAYERED_TOP_UNEXPLAINED_FLAG } =
    await import('../styling-engine/rules.js')

  const pieces = [
    { id: 1, name: 'ivory silk shell', category: 'top', formality: 'everyday' },
    { id: 2, name: 'navy cotton midi dress', category: 'dress', formality: 'everyday' },
    { id: 3, name: 'tan leather sandals', category: 'shoes', formality: 'everyday' },
  ]
  const run = reason => locallyGateWholeWardrobeOutfits(
    [{ label: 'Layered Look', reason, pieceIds: [1, 2, 3], pieces }], 5,
    { candidatePieces: pieces, occasion: 'casual', requireShoes: true, advisorMode: true })

  const unexplained = run('The navy cotton midi dress carries the column.').outfits[0]
  assert.ok(unexplained, 'the outfit is kept — removing it would be code censoring the composer (Decision B)')
  assert.ok(unexplained.pieceIds.includes(1), 'the top is never silently dropped')
  assert.ok((unexplained.systemFlags || []).some(f => f.message === LAYERED_TOP_UNEXPLAINED_FLAG), 'and the card says so')

  const explained = run('The ivory silk shell layers under the navy cotton midi dress to soften the neckline.').outfits[0]
  assert.ok(explained.pieceIds.includes(1))
  assert.equal((explained.systemFlags || []).filter(f => f.message === LAYERED_TOP_UNEXPLAINED_FLAG).length, 0, 'an explained choice is not flagged')
})

// docs/card-consistency-spec.md Part 2 (mechanical half).
test('a dress carrying an extra top is not described as a one-piece column', async () => {
  const { rewriteWholeWardrobeOutfitWithArchetype } = await import('../styling-engine/rules.js')
  const pieces = [
    { id: 1, name: 'ivory silk shell', category: 'top', formality: 'everyday' },
    { id: 2, name: 'navy cotton midi dress', category: 'dress', formality: 'everyday' },
    { id: 3, name: 'tan leather sandals', category: 'shoes', formality: 'everyday' },
  ]
  const layered = rewriteWholeWardrobeOutfitWithArchetype({ pieceIds: [1, 2, 3], pieces }, pieces, 'casual')
  assert.doesNotMatch(String(layered.silhouette || ''), /one[- ]piece|column/i,
    'every dress outfit is forced into the dress archetype, so its "one-piece column" silhouette was being asserted onto outfits that are not one')
  assert.match(String(layered.silhouette || ''), /layered/i)

  // A plain dress outfit is untouched.
  const plain = rewriteWholeWardrobeOutfitWithArchetype(
    { pieceIds: [2, 3], pieces: pieces.filter(p => p.category !== 'top') },
    pieces, 'casual')
  assert.ok(String(plain.silhouette || '').trim())
  assert.doesNotMatch(String(plain.silhouette || ''), /layered with/i)
})
