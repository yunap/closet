import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { locallyGateWholeWardrobeOutfits } from '../styling-engine/rules.js'

// Spec 9 (2026-07-10): extends the 2026-06-25 advisor-mode (reject->flag) decision to the two
// locallyGateWholeWardrobeOutfits call sites inside /ask's own precompose (the trip-slot ranking —
// since step 6 extracted into styling-engine/outfitSetPlanner.js's composeOutfitSet — and
// maybePrecomposeStructuredOutfitsForAsk's own last-resort fallback tier) that
// never received it -- only the primary visual composer had been migrated. Confirmed with Yuna:
// applyDiversity stays on (repeat-wear avoidance matters across a trip), rejectProfileDiscouraged
// stays true (matches the composer), and repair is decoupled from advisorMode for these two call
// sites specifically -- they're locally-generated candidates, not LLM output, so a mechanical
// slot-fill repair isn't "reinventing" a model's composition the way it would be for the composer's
// advisor-mode calls (see yunap-closet-no-repair-in-advisor-mode).

const routeAi = fs.readFileSync(new URL('../routes/ai.js', import.meta.url), 'utf8')
const outfitSetPlanner = fs.readFileSync(new URL('../styling-engine/outfitSetPlanner.js', import.meta.url), 'utf8')

test('both /ask precompose fallback call sites pass mode: advisor and repair: true', () => {
  // Trip-slot ranking tier — moved to composeOutfitSet in styling-engine/outfitSetPlanner.js (step 6).
  assert.match(outfitSetPlanner, /spec 9 — matches the 2026-06-25 advisor-mode decision/)
  assert.equal((outfitSetPlanner.match(/repair: true/g) || []).length, 1)
  assert.match(outfitSetPlanner, /rejectProfileDiscouraged: true,\s*\n\s*requireShoes: true,\s*\n\s*candidatePieces: allowedPieces,\s*\n\s*occasion: slot\.occasion/)
  // /ask's own last-resort fallback tier — still in routes/ai.js.
  assert.match(routeAi, /spec 9 — same as the trip-slot ranking tier above/)
  // Only this call site remains in ai.js with repair decoupled from mode; the composer's calls don't pass this.
  assert.equal((routeAi.match(/repair: true/g) || []).length, 1)
  assert.match(routeAi, /rejectProfileDiscouraged: true,\s*\n\s*requireShoes: true,\s*\n\s*candidatePieces: allowedPieces,\s*\n\s*occasion,\s*\n\s*mood: body\.mood \|\| question/)
})

test('advisor mode + repair: true keeps and flags an outfit that fails a soft/subjective check instead of dropping it', () => {
  const outfit = {
    label: 'Boho Drift',
    pieceIds: [1, 2, 3],
    pieces: [
      { id: 1, name: 'Cream Gauzy Blouse', category: 'top', formality: 'everyday' },
      { id: 2, name: 'Ivory Wide-Leg Trousers', category: 'bottom', formality: 'everyday' },
      { id: 3, name: 'Taupe Loafers', category: 'shoes', formality: 'everyday', heel_height: 'flat', walk_support: 'high' }
    ],
    reason: 'Soft gauzy layers with a relaxed drape.'
  }
  const candidatePieces = outfit.pieces

  const result = locallyGateWholeWardrobeOutfits([outfit], 5, {
    mode: 'advisor',
    repair: true,
    rejectProfileDiscouraged: true,
    candidatePieces,
    occasion: 'casual',
    mood: 'boho'
  })

  assert.equal(result.outfits.length, 1, 'soft neutral drift should flag, not drop, the outfit in advisor mode')
  assert.deepEqual(result.rejected, [])
})

test('repair: true still repairs a wrong shoe for these locally-generated candidates, despite advisor mode', () => {
  const testPool = [
    { id: 10, name: 'Cotton Tee', category: 'top', reads_as: 'cotton tee shirt', formality: 'everyday' },
    { id: 20, name: 'Linen Shorts', category: 'bottom', reads_as: 'linen shorts', formality: 'everyday' },
    { id: 30, name: 'Canvas Slip-ons', category: 'shoes', reads_as: 'canvas slip-on loafers', formality: 'everyday', heel_height: 'flat', walk_support: 'medium' },
    { id: 40, name: 'Trail Sneakers', category: 'shoes', reads_as: 'trail running sneakers', occasions: ['casual', 'outdoor'], formality: 'everyday', heel_height: 'flat', walk_support: 'high' }
  ]
  const outfit = {
    label: 'Trail Day',
    pieceIds: [10, 20, 30],
    pieces: [testPool[0], testPool[1], testPool[2]]
  }

  const withRepair = locallyGateWholeWardrobeOutfits([outfit], 5, {
    mode: 'advisor',
    repair: true,
    candidatePieces: testPool,
    occasion: 'casual',
    activity: 'hiking'
  })
  assert.equal(withRepair.outfits.length, 1)
  assert.ok(withRepair.outfits[0].pieceIds.includes(40), 'repair should swap in trail sneakers despite advisor mode')
  assert.ok(!withRepair.outfits[0].pieceIds.includes(30), 'repair should swap out the canvas slip-ons')

  // Control: the composer's own calls don't pass repair: true, so this confirms that default is
  // unchanged -- advisor mode alone still skips repair, same as before spec 9.
  const withoutRepair = locallyGateWholeWardrobeOutfits([{ ...outfit, pieceIds: [...outfit.pieceIds], pieces: [...outfit.pieces] }], 5, {
    mode: 'advisor',
    candidatePieces: testPool,
    occasion: 'casual',
    activity: 'hiking'
  })
  assert.ok(withoutRepair.outfits[0].pieceIds.includes(30), 'without repair: true, advisor mode should NOT repair the shoe (unchanged composer behavior)')
})

test('hard structural checks still reject outright in advisor mode for these call sites', () => {
  const outfit = {
    label: 'No Shoes',
    pieceIds: [1, 2],
    pieces: [
      { id: 1, name: 'Cotton Tee', category: 'top', formality: 'everyday' },
      { id: 2, name: 'Jeans', category: 'bottom', formality: 'everyday' }
    ]
  }
  const candidatePieces = outfit.pieces // no shoe available in the pool at all

  const result = locallyGateWholeWardrobeOutfits([outfit], 5, {
    mode: 'advisor',
    repair: true,
    requireShoes: true,
    candidatePieces,
    occasion: 'casual'
  })

  assert.equal(result.outfits.length, 0, 'an outfit that repair cannot complete must still be rejected outright, not flagged and kept')
  assert.ok(result.rejected.some(r => r.reason === 'not a complete wardrobe outfit'))
})
