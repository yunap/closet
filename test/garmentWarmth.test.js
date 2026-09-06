// Slice 2 of docs/thermal-comfort-band-spec.md — the ordinal warmth PLACEMENT.
// No production consumers: this is §8 step 1, a pure function with behaviour unchanged.
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { garmentWarmthLevel, garmentWarmthScore, warmthPlacementState, warmthIsRemovable, WARMTH_LEVELS } from '../styling-engine/garmentWarmth.js'

const at = l => WARMTH_LEVELS.indexOf(l)
const G = {
  puffer: { category: 'outerwear', fabric_weight: 'heavy', insulating_layer_materials: ['down'], sleeve_length: 'long' },
  cardigan: { category: 'outerwear', fabric_weight: 'medium', fabric_category: 'knit', fiber_content: ['wool'], sleeve_length: 'long' },
  unlinedJacket: { category: 'outerwear', fabric_weight: 'medium', fiber_content: ['cotton'], insulating_layer_materials: [], sleeve_length: 'long' },
  woolShellBare: { category: 'top', fabric_weight: 'medium', fiber_content: ['wool'], sleeve_length: 'sleeveless' },
  woolSweater: { category: 'top', fabric_weight: 'medium', fiber_content: ['wool'], sleeve_length: 'long' },
  tee: { category: 'top', fabric_weight: 'light', fiber_content: ['cotton'], sleeve_length: 'short' },
  linenDress: { category: 'dress', fabric_weight: 'light', fiber_content: ['linen'], sleeve_length: 'sleeveless' },
}

test('gate 1 — unknown material evidence stays unknown WHERE IT CAN MOVE THE LEVEL', () => {
  // §12.1 row 6, and §13.3 as corrected. The old formula placed 88 medium/heavy garments with no
  // material evidence, including a knit sweater at `light`.
  const mediumUnknown = { category: 'outerwear', fabric_weight: 'medium', fiber_content: ['unknown'] }
  assert.equal(warmthPlacementState(mediumUnknown), 'material_unestablished')
  assert.equal(garmentWarmthLevel(mediumUnknown), null, 'unknown must never become a level')

  const heavyUnknown = { category: 'outerwear', fabric_weight: 'heavy', fiber_content: ['unknown'] }
  assert.equal(garmentWarmthLevel(heavyUnknown), null)

  // A LIGHT garment with unknown material is still placeable. RATIFIED by criterion 4b (§15.4):
  // the verified ASHRAE-55 table shows coverage outweighs substance ~4x, so a light garment's
  // unstated material can move it about one narrow band while its cut moves it across the scale.
  // The exception depends on coverage being read — it was NOT defensible under the old formula.
  assert.equal(warmthPlacementState({ category: 'top', fabric_weight: 'light', fiber_content: ['unknown'] }), 'placeable')
})

test('gate 2 — coverage is represented, and a bare cut is decisive', () => {
  // The headline Slice 1 failure: a sleeveless wool shell placed `warm` by a formula that never
  // read coverage, while the evidence layer scored it -2.
  assert.ok(at(garmentWarmthLevel(G.woolShellBare)) < at(garmentWarmthLevel(G.woolSweater)),
    'the same wool, bare, must sit below the long-sleeved version')
  // Was `moderate` before docs/source-sensitive-insulating-credit-spec.md's fiber-credit fix
  // (+2 -> +0.5 for face-fabric-only evidence): substance(1) + credit(0.5) + bare-cut(-2) = -0.5,
  // now `very light` — the exact, explicitly-flagged consequence of reducing an oversized fiber
  // credit that was previously CANCELLING an also-oversized bare-cut penalty by coincidence, not by
  // calibration (spec §2, §5). The bare-cut penalty itself is a separate, not-yet-ratified
  // follow-up calibration; this pins today's actual behavior, not an endorsement of `-2`.
  assert.equal(garmentWarmthLevel(G.woolShellBare), 'very light')
  assert.equal(garmentWarmthLevel(G.linenDress), 'very light')
})

test('gate 3 — the pinned orderings are supportable', () => {
  // §12.1 rows 1 and 3 need the representation to make these DISTINGUISHABLE and correctly ordered
  // by absolute warmth. Which one wins on a given day is the demand mapping's job, not this one's.
  assert.ok(at(garmentWarmthLevel(G.puffer)) > at(garmentWarmthLevel(G.cardigan)),
    'a down puffer is absolutely warmer than a knit cardigan')
  // The named LEVEL no longer distinguishes these two (both `moderate` since the fiber-credit fix
  // — deliberately: docs/source-sensitive-insulating-credit-spec.md's own census found the bucket
  // system too coarse to name this real but modest difference, and ratified letting the raw SCORE
  // carry it instead of re-inflating the bucket). The raw score still orders them correctly.
  assert.equal(garmentWarmthLevel(G.cardigan), garmentWarmthLevel(G.unlinedJacket), 'same named bucket, by design')
  assert.ok(garmentWarmthScore(G.cardigan) > garmentWarmthScore(G.unlinedJacket),
    'an insulating cardigan still scores above an unlined cotton jacket in raw terms')

  // Secondary coverage must not outweigh a fabric-weight class. A first attempt gave sleeves, hem
  // and neckline a full step each, and a medium fleece with a warm collar tied the down puffer.
  const fleeceCollared = { category: 'outerwear', fabric_weight: 'medium', fabric_category: 'fleece', sleeve_length: 'long', neckline: 'turtleneck' }
  assert.ok(at(garmentWarmthLevel(fleeceCollared)) < at(garmentWarmthLevel(G.puffer)),
    'a medium fleece must not reach a heavy down coat on collar and sleeves alone')
})

test('gate 5 — cold is a diagnostic comparator, never a dependency', () => {
  // Owner ruling 2026-09-03. Fitting this scale to pieceWeatherScores().cold would promote the
  // score §10.1 disqualified — no temperature anchor, no meaningful zero — into the oracle.
  const src = fs.readFileSync(path.join(process.cwd(), 'styling-engine/garmentWarmth.js'), 'utf8')
  const live = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
  for (const banned of ['pieceWeatherScores', 'pieceWeatherEvidence', 'thermal.js']) {
    assert.ok(!live.some(l => l.includes(banned)),
      `garmentWarmth.js must not consume ${banned} — it reads the same facts independently`)
  }
})

test('base vs removable needs no new field', () => {
  // §13.4: category=outerwear is the one available bit and is sufficient. needs_base is populated
  // on 6 of 213 pieces, outerwear_role is deprecated, and no garment-kind column exists.
  assert.equal(warmthIsRemovable(G.cardigan), true)
  assert.equal(warmthIsRemovable(G.puffer), true)
  assert.equal(warmthIsRemovable(G.woolSweater), false, 'a heavy sweater is base warmth, not a layer')
  assert.equal(warmthIsRemovable(G.tee), false)
})

test('shoes and accessories stay out of thermal scope', () => {
  // fabric_weight there describes construction substance, not body insulation — the boundary
  // pieceWarmthTier already draws.
  assert.equal(warmthPlacementState({ category: 'shoes', fabric_weight: 'heavy' }), 'out_of_scope')
  assert.equal(garmentWarmthLevel({ category: 'accessory', fabric_weight: 'heavy' }), null)
})

test('no substance means no placement', () => {
  assert.equal(warmthPlacementState({ category: 'top' }), 'no_substance')
  assert.equal(garmentWarmthLevel({ category: 'top' }), null)
})

test('this is the supply half only — it states no demand and no threshold', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'styling-engine/garmentWarmth.js'), 'utf8')
  const live = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
  for (const banned of ['isCold', 'needsRemovableCoolLayer', 'requiredThermalBand', 'highF', 'lowF']) {
    assert.ok(!live.includes(banned), `placement must not reference ${banned}`)
  }
})

test('outerwear with a known face but unrecorded interior stays UNKNOWN', () => {
  // The case this whole arc came from, and the one a first version of the placement fix broke: the
  // black puffer's ["polyester","nylon"] was a true, COMPLETE statement about its face and silent
  // about the down inside. Knowing a coat's shell does not establish whether it is insulated.
  const shellCoat = {
    category: 'outerwear', fabric_weight: 'heavy', fabric_category: 'cotton',
    fiber_content: ['cotton', 'nylon'], sleeve_length: 'long',
  }
  assert.equal(warmthPlacementState(shellCoat), 'material_unestablished')
  assert.equal(garmentWarmthLevel(shellCoat), null)

  // But an outerwear piece whose interior question IS answered places normally — `[]` makes the
  // verdict non_insulating, a named fill makes it insulating, so neither reaches that branch.
  assert.equal(garmentWarmthLevel({ ...shellCoat, insulating_layer_materials: [] }), 'moderate')
  assert.equal(garmentWarmthLevel({ ...shellCoat, insulating_layer_materials: ['down'] }), 'very warm')
})

test('ordinary clothing with a recorded face fabric places — it cannot conceal a fill', () => {
  // 80 of 97 "unplaceable" garments had perfectly good fibres. A medium cotton trouser with
  // fiber_content ["cotton"] is KNOWN NON-INSULATING, not unknown, and refusing to place it left
  // the roster unable to rank bottoms at all.
  const B = (fw, cat, fib) => ({ category: 'bottom', fabric_weight: fw, fabric_category: cat, fiber_content: fib })
  assert.equal(garmentWarmthLevel(B('medium', 'cotton', ['cotton'])), 'moderate')
  assert.equal(garmentWarmthLevel(B('medium', 'denim', ['denim'])), 'moderate')
  // Was `warm` before docs/source-sensitive-insulating-credit-spec.md's fiber-credit fix — the
  // exact two-bucket-jump-from-a-fiber-name-alone case that census's isolated short-sleeve
  // comparison (5 real cotton tops vs. a matched wool dress) proved wrong. Still ranks above the
  // cotton bottoms in raw score (asserted via garmentWarmthScore below).
  assert.equal(garmentWarmthLevel(B('medium', 'wool', ['wool'])), 'moderate')
  assert.ok(garmentWarmthScore(B('medium', 'wool', ['wool'])) > garmentWarmthScore(B('medium', 'cotton', ['cotton'])),
    'wool still scores above cotton at the same weight, just not enough to cross a bucket alone')

  // The separation the live thread needed: a light summer pant is NOT the same as denim.
  assert.equal(garmentWarmthLevel(B('light', 'cotton', ['cotton'])), 'light')
  assert.equal(garmentWarmthLevel(B('light', 'linen', ['linen'])), 'light')

  // Absent face evidence still blocks placement, whatever the category.
  assert.equal(garmentWarmthLevel(B('medium', '', ['unknown'])), null)
})
