import test from 'node:test'
import assert from 'node:assert/strict'
import { locallyGateWholeWardrobeOutfits, inferOutfitArchetype, qualifiesWholeWardrobeMission } from '../styling-engine/rules.js'
import { describeOutfitStructureGap, evaluateLayerDirections, evaluateLayerPairConstruction, evaluateLayerPairConstructionFor, evaluateOutfitStructure, evaluateWearableOutfit, layerConstructionPromptRule, NEUTRAL_SLEEVE_LAYERING_STATEMENT, layerDirectionPromptRule, wardrobeSupportsLayeringPair } from '../styling-engine/outfitValidation.js'
import { pieceRequiresBaseLayer, pieceSleeveInterference, pieceOuterSleeveCapacity, SLEEVE_SHAPE_VALUES } from '../styling-engine/attributes.js'

const structureValid = (pieces, options = {}) => evaluateOutfitStructure(pieces, options).valid

test('composed wearable verdict keeps hard invalidity separate from unresolved visual evidence', () => {
  const dependent = { id: 1, name: 'Sheer overshirt', category: 'top', needs_base: 'yes', role: 'layer_top' }
  const unknownBase = { id: 2, name: 'Legacy tank', category: 'top', role: 'primary_top' }
  const bottom = { id: 3, name: 'Trousers', category: 'bottom', role: 'primary_bottom' }
  const shoes = { id: 4, name: 'Loafers', category: 'shoes', role: 'shoes' }

  const unseen = evaluateWearableOutfit([dependent, unknownBase, bottom, shoes], {
    roleAware: true,
    includeLayerDirections: true,
  })
  assert.equal(unseen.hardValid, true, 'unknown metadata is not hard invalidity')
  assert.equal(unseen.reviewRequired, true)
  assert.deepEqual(new Set(unseen.unresolvedSightPieceIds), new Set([1, 2]))

  const seen = evaluateWearableOutfit([dependent, unknownBase, bottom, shoes], {
    roleAware: true,
    includeLayerDirections: true,
    seenPieceIds: [1, 2],
  })
  assert.equal(seen.hardValid, true)
  assert.equal(seen.reviewRequired, false, 'the model may resolve a styling-quality unknown from both photos')

  const missingBase = evaluateWearableOutfit([dependent, bottom, shoes], {
    roleAware: true,
    includeLayerDirections: true,
  })
  assert.equal(missingBase.hardValid, false)
  assert.ok(missingBase.hardFindings.some(finding => finding.code === 'required_base_layer_missing_or_incompatible'))
})

// thread_1787728618995's actual failure mode: propose_outfit/plan/capsule composition could
// already accept a sleeve-bulk conflict with no mechanical check at all (the census correction that
// followed the #263 census). evaluateLayerPairConstruction is the canonical owner; these fixtures
// cover the four verdict shapes and the specific "two long sleeves alone is not proof" ruling.
test('evaluateLayerPairConstruction distinguishes known conflict, known compatible, and unknown', () => {
  // No cuff overlap possible: a sleeveless base under any top is trivially compatible.
  const sleeveless = { id: 1, name: 'sleeveless shell', category: 'top', role: 'primary_top', sleeve_length: 'sleeveless' }
  const anyLayer = { id: 2, name: 'any layer', category: 'top', role: 'layer_top', sleeve_length: 'long' }
  const trivial = evaluateLayerPairConstruction([anyLayer, sleeveless], { roleAware: true })
  assert.equal(trivial.verdict, 'compatible')
  assert.deepEqual(trivial.findings, [])

  // Known conflict: the INNER garment's voluminous sleeve is trapped under a narrow, structured
  // OUTER sleeve. Direction is established via the outer piece's outerwear category (PR #264/#265's
  // canonical evidence) so the verdict is deterministic, not merely "either side is voluminous" —
  // the old symmetric rule this replaces could not distinguish this from the compatible case below.
  const voluminousBase = { id: 4, name: 'voluminous-sleeve blouse', category: 'top', role: 'primary_top', sleeve_length: 'long', sleeve_shape: 'voluminous', fabric_weight: 'light' }
  const structuredOuterLayer = { id: 3, name: 'structured jacket', category: 'outerwear', role: 'layer_top', sleeve_length: 'long', sleeve_shape: 'fitted', fabric_weight: 'light' }
  const conflict = evaluateLayerPairConstruction([structuredOuterLayer, voluminousBase], { roleAware: true })
  assert.equal(conflict.verdict, 'incompatible')
  assert.equal(conflict.findings[0].code, 'layer_construction_sleeve_conflict')
  assert.equal(conflict.sightRequired, 'none', 'a known incompatibility does not need a photo to resolve')

  // Direction reversed: the same voluminous shape worn as the OUTER layer over a fitted inner
  // sleeve has room to spare — not a conflict. This is the "fitted turtleneck under a
  // voluminous-sleeve blouse" case the taxonomy spec calls out explicitly.
  const fittedInner = { id: 15, name: 'fitted turtleneck', category: 'top', role: 'primary_top', sleeve_length: 'long', sleeve_shape: 'fitted', fabric_weight: 'light' }
  const voluminousOuterLayer = { id: 16, name: 'voluminous-sleeve outer blouse', category: 'outerwear', role: 'layer_top', sleeve_length: 'long', sleeve_shape: 'voluminous', fabric_weight: 'light' }
  const noConflict = evaluateLayerPairConstruction([voluminousOuterLayer, fittedInner], { roleAware: true })
  assert.equal(noConflict.verdict, 'compatible', 'a voluminous OUTER sleeve over a fitted inner one is not a conflict')

  // Live correction, thread_1788767789621: overall fabric weight is not sleeve bulk. Even two
  // substantial garments are compatible when their recorded sleeve geometry has no interference.
  const heavyLayer = { id: 5, name: 'heavy cardigan', category: 'top', role: 'layer_top', sleeve_length: 'long', sleeve_shape: 'straight', fabric_weight: 'heavy' }
  const heavyBase = { id: 6, name: 'heavy sweater', category: 'top', role: 'primary_top', sleeve_length: 'long', sleeve_shape: 'straight', fabric_weight: 'medium' }
  const fabricOnly = evaluateLayerPairConstruction([heavyLayer, heavyBase], { roleAware: true })
  assert.equal(fabricOnly.verdict, 'compatible')

  // Known compatible: two fitted, lightweight, cuffed-sleeve garments — must NOT be rejected just
  // for both being long-sleeve (the crudeness explicitly ruled out during the #263 correction).
  const fittedLayer = { id: 7, name: 'fitted long-sleeve tee', category: 'top', role: 'layer_top', sleeve_length: 'long', sleeve_shape: 'fitted', fabric_weight: 'light' }
  const fittedPrimary = { id: 8, name: 'fitted base', category: 'top', role: 'primary_top', sleeve_length: 'long', sleeve_shape: 'straight', fabric_weight: 'ultralight' }
  const compatible = evaluateLayerPairConstruction([fittedLayer, fittedPrimary], { roleAware: true })
  assert.equal(compatible.verdict, 'compatible')
  assert.deepEqual(compatible.findings, [])

  // Unknown: both cuffed, but sleeve_shape/fabric_weight unrecorded — conservative, not a guess.
  const bareLayer = { id: 9, name: 'unspecified layer', category: 'top', role: 'layer_top', sleeve_length: 'long' }
  const barePrimary = { id: 10, name: 'unspecified base', category: 'top', role: 'primary_top', sleeve_length: 'long' }
  const unknown = evaluateLayerPairConstruction([bareLayer, barePrimary], { roleAware: true })
  assert.equal(unknown.verdict, 'unknown')
  assert.equal(unknown.sightRequired, 'both')
})

test('SLEEVE_SHAPE_VALUES is exactly the approved functional taxonomy; retired fashion names are gone', () => {
  assert.deepEqual(SLEEVE_SHAPE_VALUES, [
    'fitted', 'straight', 'puff_shoulder', 'gathered_ruched', 'voluminous', 'flared', 'deep_armhole', 'other', 'unknown',
  ])
  for (const retired of ['relaxed', 'puff', 'bishop', 'bell', 'flutter', 'raglan', 'dolman']) {
    assert.ok(!SLEEVE_SHAPE_VALUES.includes(retired), `${retired} must not be a current taxonomy value`)
  }
})

test('pieceSleeveInterference derives the correct zone for each canonical shape, and null for unresolved shapes', () => {
  const zonesFor = shape => pieceSleeveInterference({ sleeve_shape: shape })
  assert.deepEqual(zonesFor('fitted'), { shoulder: 'none', arm: 'none', lowerArm: 'none', armhole: 'none' })
  assert.deepEqual(zonesFor('straight'), { shoulder: 'none', arm: 'none', lowerArm: 'none', armhole: 'none' })
  assert.deepEqual(zonesFor('puff_shoulder'), { shoulder: 'elevated', arm: 'none', lowerArm: 'none', armhole: 'none' })
  assert.deepEqual(zonesFor('gathered_ruched'), { shoulder: 'none', arm: 'elevated', lowerArm: 'elevated', armhole: 'none' })
  assert.deepEqual(zonesFor('voluminous'), { shoulder: 'none', arm: 'elevated', lowerArm: 'elevated', armhole: 'none' })
  assert.deepEqual(zonesFor('flared'), { shoulder: 'none', arm: 'none', lowerArm: 'elevated', armhole: 'none' })
  assert.deepEqual(zonesFor('deep_armhole'), { shoulder: 'none', arm: 'none', lowerArm: 'none', armhole: 'elevated' })
  // 'other'/'unknown'/unset are unresolved geometry, not "no interference" — every zone stays null.
  assert.deepEqual(zonesFor('other'), { shoulder: null, arm: null, lowerArm: null, armhole: null })
  assert.deepEqual(zonesFor('unknown'), { shoulder: null, arm: null, lowerArm: null, armhole: null })
  assert.deepEqual(zonesFor(undefined), { shoulder: null, arm: null, lowerArm: null, armhole: null })
})

// Directional regression suite named in the taxonomy spec: the physical conflict depends on which
// garment is inner vs outer, not merely on whether either side is "voluminous."
test('directional construction: inner volume against a narrow outer is a concern; the same volume as the outer is not', () => {
  const fittedInner = { id: 20, name: 'fitted turtleneck', category: 'top', role: 'primary_top', sleeve_length: 'long', sleeve_shape: 'fitted', fabric_weight: 'light' }
  const voluminousOuter = { id: 21, name: 'voluminous-sleeve blouse', category: 'outerwear', role: 'layer_top', sleeve_length: 'long', sleeve_shape: 'voluminous', fabric_weight: 'light' }
  const fineOverFitted = evaluateLayerPairConstruction([voluminousOuter, fittedInner], { roleAware: true })
  assert.equal(fineOverFitted.verdict, 'compatible', 'a voluminous outer over a fitted inner is not rejected merely because the outer is voluminous')

  const voluminousInner = { id: 22, name: 'voluminous-sleeve top', category: 'top', role: 'primary_top', sleeve_length: 'long', sleeve_shape: 'voluminous', fabric_weight: 'light' }
  const narrowStructuredOuter = { id: 23, name: 'narrow fitted blazer', category: 'outerwear', role: 'layer_top', sleeve_length: 'long', sleeve_shape: 'fitted', fabric_weight: 'light' }
  const trappedUnderNarrow = evaluateLayerPairConstruction([narrowStructuredOuter, voluminousInner], { roleAware: true })
  assert.equal(trappedUnderNarrow.verdict, 'incompatible', 'a voluminous inner sleeve trapped under a narrow structured outer is a real construction concern')

  const deepArmholeInner = { id: 24, name: 'dolman-style top', category: 'top', role: 'primary_top', sleeve_length: 'long', sleeve_shape: 'deep_armhole', fabric_weight: 'light' }
  const restrictiveOuter = { id: 25, name: 'set-in fitted jacket', category: 'outerwear', role: 'layer_top', sleeve_length: 'long', sleeve_shape: 'fitted', fabric_weight: 'light' }
  const deepArmholeConflict = evaluateLayerPairConstruction([restrictiveOuter, deepArmholeInner], { roleAware: true })
  assert.equal(deepArmholeConflict.verdict, 'incompatible', 'deep-armhole inner geometry under a restrictive outer is a concern')

  // Live acceptance regression, thread_1788762324317: the same geometry previously escaped the
  // validator when the duster used the dedicated outerwear role rather than layer_top.
  const fittedDuster = { ...restrictiveOuter, id: 125, name: 'fitted-sleeve duster', role: 'outerwear', sleeve_shape: 'fitted' }
  const outerwearRoleConflict = evaluateLayerPairConstruction([fittedDuster, deepArmholeInner], { roleAware: true })
  assert.equal(outerwearRoleConflict.verdict, 'incompatible', 'outerwear role must be checked against the primary top, not skipped')
  assert.ok(outerwearRoleConflict.findings.some(finding => finding.code === 'layer_construction_sleeve_conflict'))

  const shortSleeveInner = { ...deepArmholeInner, id: 124, name: 'short-sleeve top', sleeve_length: 'short' }
  const shortSleeveUnderDuster = evaluateLayerPairConstruction([fittedDuster, shortSleeveInner], { roleAware: true })
  assert.equal(shortSleeveUnderDuster.verdict, 'compatible', 'no sleeve-in-sleeve overlap remains valid under outerwear')

  const jerseyTop = { id: 126, name: '3/4-sleeve jersey top', category: 'top', role: 'primary_top', sleeve_length: '3/4', sleeve_shape: 'straight', fabric_weight: 'medium' }
  const mediumTrench = { id: 127, name: 'medium-weight trench', category: 'outerwear', role: 'outerwear', sleeve_length: 'long', sleeve_shape: 'straight', fabric_weight: 'medium' }
  const jerseyUnderTrench = evaluateLayerPairConstruction([mediumTrench, jerseyTop], { roleAware: true })
  assert.equal(jerseyUnderTrench.verdict, 'compatible', 'medium fabric weight on both garments is not evidence of sleeve bulk')

  const flaredInner = { id: 26, name: 'flared-sleeve top', category: 'top', role: 'primary_top', sleeve_length: 'long', sleeve_shape: 'flared', fabric_weight: 'light' }
  const narrowOuterSleeve = { id: 27, name: 'narrow-sleeve outer top', category: 'outerwear', role: 'layer_top', sleeve_length: 'long', sleeve_shape: 'fitted', fabric_weight: 'light' }
  const flaredConflict = evaluateLayerPairConstruction([narrowOuterSleeve, flaredInner], { roleAware: true })
  assert.equal(flaredConflict.verdict, 'incompatible', 'flared inner sleeve under a narrow outer sleeve is a concern')

  // Sleeve capacity: straight sleeve outerwear without generous cut returns null capacity, requiring visual check
  const gatheredInner = { id: 144, name: 'black turtleneck', category: 'top', role: 'primary_top', sleeve_length: 'extra_long', sleeve_shape: 'gathered_ruched', silhouette: 'slim', fabric_weight: 'medium' }
  const straightPufferOuter = { id: 996774, name: 'Straight down puffer coat', category: 'outerwear', role: 'outerwear', sleeve_length: 'long', sleeve_shape: 'straight', silhouette: 'straight', fabric_weight: 'heavy', insulating_layer_materials: ['down'] }
  assert.equal(pieceOuterSleeveCapacity(straightPufferOuter), null, 'straight sleeve without generous cut returns null capacity')
  const straightPufferOverGathered = evaluateLayerPairConstruction([straightPufferOuter, gatheredInner], { roleAware: true })
  assert.equal(straightPufferOverGathered.verdict, 'unknown', 'straight sleeve outer without generous cut over gathered sleeve is unknown capacity')
  assert.equal(straightPufferOverGathered.sightRequired, 'both', 'requires sight check from both photos')

  // Generous cut outerwear (boxy silhouette) accommodates gathered sleeves:
  const boxyPufferOuter = { id: 996775, name: 'Black puffer coat', category: 'outerwear', role: 'outerwear', sleeve_length: 'long', sleeve_shape: 'straight', silhouette: 'boxy', fabric_weight: 'heavy', insulating_layer_materials: ['down'] }
  assert.equal(pieceOuterSleeveCapacity(boxyPufferOuter), 'accommodates', 'boxy silhouette accommodates')
  const pufferOverGathered = evaluateLayerPairConstruction([boxyPufferOuter, gatheredInner], { roleAware: true })
  assert.equal(pufferOverGathered.verdict, 'compatible', 'a boxy down puffer has ample room for gathered/ruched sleeves')
  assert.equal(pufferOverGathered.findings.length, 0, 'no sleeve conflict finding on puffer over gathered sleeve')

  // Explicit fitted coat returns restricted and is incompatible with gathered sleeves:
  const fittedCoat = { id: 996776, name: 'Fitted tailored coat', category: 'outerwear', role: 'outerwear', sleeve_length: 'long', sleeve_shape: 'fitted', fabric_weight: 'heavy' }
  assert.equal(pieceOuterSleeveCapacity(fittedCoat), 'restricted', 'fitted sleeve shape is restricted')
  const fittedOverGathered = evaluateLayerPairConstruction([fittedCoat, gatheredInner], { roleAware: true })
  assert.equal(fittedOverGathered.verdict, 'incompatible', 'fitted outer sleeve over gathered sleeve is incompatible')

  const oversizedOuter = { id: 128, name: 'oversized jacket', category: 'outerwear', role: 'layer_top', sleeve_length: 'long', sleeve_shape: 'straight', silhouette: 'oversized', fabric_weight: 'medium' }
  const oversizedOverVoluminous = evaluateLayerPairConstruction([oversizedOuter, voluminousInner], { roleAware: true })
  assert.equal(oversizedOverVoluminous.verdict, 'compatible', 'oversized outerwear accommodates voluminous inner sleeve')

  // Unknown outer capacity: the inner garment has real volume, but the outer garment's own sleeve
  // shape is not recorded — must not fabricate an incompatibility from an unrecorded outer.
  const unknownCapacityOuter = { id: 28, name: 'unspecified-sleeve outer jacket', category: 'outerwear', role: 'layer_top', sleeve_length: 'long', fabric_weight: 'light' }
  const unknownCapacity = evaluateLayerPairConstruction([unknownCapacityOuter, voluminousInner], { roleAware: true })
  assert.equal(unknownCapacity.verdict, 'unknown', 'an unrecorded outer sleeve shape is unknown capacity, not a guessed incompatibility')
  assert.equal(unknownCapacity.sightRequired, 'both')
})

test('evaluateLayerPairConstructionFor resolves direction for a direct two-garment lookup the same way as the enumerated pair path', () => {
  const fittedInner = { id: 30, name: 'fitted base layer', category: 'top', sleeve_length: 'long', sleeve_shape: 'fitted', fabric_weight: 'light' }
  const voluminousOuterCardigan = { id: 31, name: 'voluminous cardigan', category: 'top', sleeve_length: 'long', sleeve_shape: 'voluminous', fabric_weight: 'light' }
  const compatible = evaluateLayerPairConstructionFor(fittedInner, voluminousOuterCardigan)
  assert.equal(compatible.verdict, 'compatible')

  const voluminousInner = { id: 32, name: 'voluminous top', category: 'top', sleeve_length: 'long', sleeve_shape: 'voluminous', fabric_weight: 'light' }
  const narrowOuterCardigan = { id: 33, name: 'narrow fitted cardigan', category: 'top', sleeve_length: 'long', sleeve_shape: 'fitted', fabric_weight: 'light' }
  const conflict = evaluateLayerPairConstructionFor(voluminousInner, narrowOuterCardigan)
  assert.equal(conflict.verdict, 'incompatible')
  // Argument order must not flip the answer — the function resolves direction from evidence,
  // not from which piece was passed first.
  const conflictReversed = evaluateLayerPairConstructionFor(narrowOuterCardigan, voluminousInner)
  assert.equal(conflictReversed.verdict, 'incompatible')
})

test('layerConstructionPromptRule states only the neutral sleeve sentence, never a categorical shape verdict', () => {
  const rule = layerConstructionPromptRule()
  assert.equal(rule, `- ${NEUTRAL_SLEEVE_LAYERING_STATEMENT}`)
  assert.doesNotMatch(rule, /is a conflict|cannot accommodate|no room to accommodate|puff, bishop, bell/)
})

test('evaluateWearableOutfit keeps the sleeve-geometry verdict as log-only shadow evidence, never a finding', () => {
  // Voluminous INNER sleeve under a structured OUTER sleeve: the geometry verdict still resolves to a
  // conflict, but only as shadow evidence — it is not a hard or advisory finding.
  const voluminousInner = { id: 11, name: 'voluminous-sleeve blouse', category: 'top', role: 'primary_top', sleeve_length: 'long', sleeve_shape: 'voluminous', fabric_weight: 'light' }
  const structuredOuter = { id: 12, name: 'structured jacket', category: 'outerwear', role: 'layer_top', sleeve_length: 'long', sleeve_shape: 'fitted', fabric_weight: 'light' }
  const bottom = { id: 13, name: 'trousers', category: 'bottom', role: 'primary_bottom' }
  const shoes = { id: 14, name: 'loafers', category: 'shoes', role: 'shoes' }
  const result = evaluateWearableOutfit([structuredOuter, voluminousInner, bottom, shoes], { roleAware: true, includeLayerDirections: true })
  assert.equal(result.hardValid, true)
  assert.ok(![...result.hardFindings, ...result.advisoryFindings].some(finding => String(finding.code).startsWith('layer_construction_')))
  assert.ok(result.shadowFindings.some(finding => finding.code === 'layer_construction_sleeve_conflict'))
  assert.ok(result.evidence.includedStages.includes('layer_construction'))
  assert.deepEqual(result.evidence.shadowStages, ['layer_construction'])
})

// PR review: a caller gating a pre-role-assignment prompt projection (does this candidate set
// even have a layering pair worth mentioning?) must not reimplement this with a local top/dress
// category count, because layer_top may be assigned to an outerwear-category piece too — see
// ROLE_CATEGORY_EXPECTATIONS.layer_top in outfitValidation.js, the same map evaluateOutfitRoles
// uses for its role/category mismatch check.
test('wardrobeSupportsLayeringPair recognizes an outerwear layer_top candidate, not only top/dress', () => {
  const soleTop = { id: 1, name: 'lone top', category: 'top' }
  const soleOuterwear = { id: 2, name: 'lone jacket', category: 'outerwear' }
  const soleDress = { id: 3, name: 'lone dress', category: 'dress' }
  const bottom = { id: 4, name: 'bottom', category: 'bottom' }
  const shoes = { id: 5, name: 'shoes', category: 'shoes' }

  // A single top plus a single outerwear piece IS a real layer_top(outerwear) + primary_top pair.
  assert.equal(wardrobeSupportsLayeringPair([soleTop, soleOuterwear, bottom, shoes]), true)
  // A single top plus a single dress IS a real top-over/under-dress pair.
  assert.equal(wardrobeSupportsLayeringPair([soleTop, soleDress, bottom, shoes]), true)
  // Two tops can still form layer_top + primary_top with no outerwear involved.
  assert.equal(wardrobeSupportsLayeringPair([soleTop, { id: 6, name: 'second top', category: 'top' }, bottom, shoes]), true)

  // A lone top with nothing else top/dress/outerwear cannot layer with itself.
  assert.equal(wardrobeSupportsLayeringPair([soleTop, bottom, shoes]), false)
  // A lone outerwear piece with no top/dress base cannot layer with itself.
  assert.equal(wardrobeSupportsLayeringPair([soleOuterwear, bottom, shoes]), false)
  // A lone dress alone (dress cannot be its own added/layer piece) cannot layer.
  assert.equal(wardrobeSupportsLayeringPair([soleDress, bottom, shoes]), false)
  // Nothing top/dress/outerwear-shaped at all.
  assert.equal(wardrobeSupportsLayeringPair([bottom, shoes]), false)
})

// PR review: layerDirectionPromptRule() must name every evidence branch evaluateLayerDirections
// actually reads, including the needs_base-dependency branch it initially omitted (a layer_top that
// itself needs a base layer sits over its primary_top — evidence.source
// 'dependent_layer_requires_base' — with no overlay text required). This ties the projection's
// prose directly to the same behavioral fixture propose_outfit.test.js pins for the executable
// verdict, so a future edit that silently drops the branch from the prose fails here even if the
// code itself is untouched. Also guards against the earlier "two pieces appearing together is not
// evidence of a relationship" line, which conflated relationship (established by role/category) with
// direction (established by construction/dependency evidence) — role-aware layer_top + primary_top
// pieces already have a relationship; what can be unknown is only the supported direction.
test('layerDirectionPromptRule names the needs_base dependency branch and does not conflate relationship with direction', () => {
  const rule = layerDirectionPromptRule()
  assert.match(rule, /needs a base layer/)
  assert.match(rule, /sits over the other piece serving as its base/)
  assert.doesNotMatch(rule, /is not itself evidence of a layering relationship/)

  // The same dependency-only case pinned in propose_outfit.test.js, checked here beside the prose
  // that describes it.
  const result = evaluateLayerDirections([
    { id: 1, role: 'primary_top', category: 'top' },
    { id: 2, role: 'layer_top', category: 'top', needs_base: 'yes' },
  ], { roleAware: true })
  assert.equal(result.pairs[0].direction, 'layer_top_over_primary_top')
  assert.equal(result.pairs[0].evidence.source, 'dependent_layer_requires_base')
})

// PR review: the prose must distinguish a layer_top role alone (relationship, not direction) from
// an outerwear-category layer_top (direction evidence on its own — categoryGroup === 'outerwear'
// resolves layer_top_over_primary_top with no notes or dependency needed). Checked beside the same
// outerwear-only fixture propose_outfit.test.js pins for the executable verdict.
test('layerDirectionPromptRule names outerwear category as direction evidence on its own', () => {
  const rule = layerDirectionPromptRule()
  assert.match(rule, /outerwear-category piece is itself direction evidence/)
  assert.match(rule, /a layer_top role establishes that a pairing is intended to layer together, but does not by itself decide/)

  const result = evaluateLayerDirections([
    { id: 1, role: 'primary_top', category: 'top' },
    { id: 2, role: 'layer_top', category: 'outerwear' },
  ], { roleAware: true })
  assert.equal(result.pairs[0].direction, 'layer_top_over_primary_top')
  assert.equal(result.pairs[0].evidence.source, 'outerwear_category')
})

test('pieceRequiresBaseLayer reads only the explicit structured yes value', () => {
  assert.equal(pieceRequiresBaseLayer({ needs_base: 'yes' }), true)
  assert.equal(pieceRequiresBaseLayer({ needs_base: ' YES ' }), true)
  assert.equal(pieceRequiresBaseLayer({ needs_base: 'no' }), false)
  assert.equal(pieceRequiresBaseLayer({ needs_base: null }), false)
  assert.equal(pieceRequiresBaseLayer({}), false)
})

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
  assert.equal(structureValid([top]), false)
})

test('evaluateOutfitStructure - basic validation cases', () => {
  // 1. Valid separates: 1 top, 1 bottom, 1 shoe
  assert.ok(structureValid([
    { category: 'top', name: 'Cotton Tee' },
    { category: 'bottom', name: 'Jeans' },
    { category: 'shoes', name: 'Sneakers' }
  ]))

  // 2. Valid dress: 1 dress, 1 shoe
  assert.ok(structureValid([
    { category: 'dress', name: 'Sun Dress' },
    { category: 'shoes', name: 'Sandals' }
  ]))

  // 3. Dress + layering top is allowed
  assert.ok(structureValid([
    { category: 'dress', name: 'Sun Dress' },
    { category: 'top', name: 'Cardigan' },
    { category: 'shoes', name: 'Sandals' }
  ]))

  // 4. Dress + bottom is invalid
  assert.ok(!structureValid([
    { category: 'dress', name: 'Sun Dress' },
    { category: 'bottom', name: 'Jeans' },
    { category: 'shoes', name: 'Sandals' }
  ]))

  // 5. Two bottoms is invalid
  assert.ok(!structureValid([
    { category: 'top', name: 'Cotton Tee' },
    { category: 'bottom', name: 'Jeans' },
    { category: 'bottom', name: 'Shorts' },
    { category: 'shoes', name: 'Sneakers' }
  ]))

  // 6. Two pairs of shoes is invalid
  assert.ok(!structureValid([
    { category: 'top', name: 'Cotton Tee' },
    { category: 'bottom', name: 'Jeans' },
    { category: 'shoes', name: 'Sneakers' },
    { category: 'shoes', name: 'Loafers' }
  ]))

  // 7. No top is invalid for separates
  assert.ok(!structureValid([
    { category: 'bottom', name: 'Jeans' },
    { category: 'shoes', name: 'Sneakers' }
  ]))

  // 8. No shoes is invalid when requireShoes is true (default)
  assert.ok(!structureValid([
    { category: 'top', name: 'Cotton Tee' },
    { category: 'bottom', name: 'Jeans' }
  ]))

  // 9. No shoes is valid when requireShoes is false
  assert.ok(structureValid([
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
  assert.ok(result.rejected.some(r => /shoe|top|bottom|dress|complete wardrobe outfit/i.test(r.reason)))
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
  const { outfitLayersTopWithDress, unexplainedLayeredTops } =
    await import('../styling-engine/rules.js')

  const pieces = [
    { id: 136, name: 'black blouson v-neck top', category: 'top' },
    { id: 990360, name: 'black brown lace floral midi dress', category: 'dress' },
    { id: 184, name: 'patchwork knit buttoned top', category: 'outerwear' },
    { id: 198, name: 'taupe knit lace-up sneakers', category: 'shoes' },
  ]

  // Never gated: this is a styling decision, not a structural error.
  assert.ok(structureValid(pieces, { requireShoes: true }))
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

// --- bounded upper-body layering (owner ruling 2026-09-12) --------------------------------------
//
// The composer's prose rule ("optional single outerwear … no two tops") was the ONLY thing
// preventing a pile of same-slot garments: this validator counted tops solely when a bottom was
// missing, and never counted outerwear at all. Keeping the guarantee in prose is what forbade the
// owner's own Layer 2 formula — an open layer over a fitted base — in every composed card (0 of 27
// saved outfits carried a middle layer). The bound lives here now, so the prompt can describe a
// real three-layer system.

const base = () => ({ id: 1, name: 'knit top', category: 'top' })
const middle = () => ({ id: 2, name: 'open cardigan', category: 'outerwear' })
const outer = () => ({ id: 3, name: 'wool coat', category: 'outerwear' })
const trouser = () => ({ id: 4, name: 'trousers', category: 'bottom' })
const loafer = () => ({ id: 5, name: 'loafers', category: 'shoes' })

test('LAYERING: base + middle + outer is a valid outfit', () => {
  const result = evaluateOutfitStructure([base(), middle(), outer(), trouser(), loafer()])
  assert.equal(result.valid, true, `three upper layers is a layered outfit, not a pile: ${JSON.stringify(result.findings)}`)
})

test('LAYERING: a vest over a blouse is a valid outfit', () => {
  // The same ban also caught a second TOP worn over a base — a tweed vest in this wardrobe is
  // `category: top`, so "no two tops" forbade it on warmth-independent styling grounds.
  const vest = { id: 6, name: 'tweed vest', category: 'top' }
  assert.equal(evaluateOutfitStructure([base(), vest, trouser(), loafer()]).valid, true)
})

test('LAYERING: four upper pieces is the pile the old rule was written against', () => {
  const extra = { id: 7, name: 'second coat', category: 'outerwear' }
  const result = evaluateOutfitStructure([base(), middle(), outer(), extra, trouser(), loafer()])
  assert.equal(result.valid, false)
  const codes = result.findings.map(finding => finding.code)
  assert.ok(codes.includes('too_many_upper_layers'), `got ${JSON.stringify(codes)}`)
  assert.ok(codes.includes('multiple_outerwear'), 'three outerwear pieces is also its own finding')
})

test('LAYERING: three tops is rejected even with a bottom present', () => {
  const second = { id: 8, name: 'overshirt', category: 'top' }
  const third = { id: 9, name: 'another top', category: 'top' }
  const result = evaluateOutfitStructure([base(), second, third, trouser(), loafer()])
  assert.equal(result.valid, false, 'this shape passed silently before — the prose rule was the only guard')
  assert.ok(result.findings.map(finding => finding.code).includes('multiple_tops'))
})

test('LAYERING: a dress with a coat is unaffected, and so is a plain outfit', () => {
  const dress = { id: 10, name: 'knit dress', category: 'dress' }
  assert.equal(evaluateOutfitStructure([dress, outer(), loafer()]).valid, true)
  assert.equal(evaluateOutfitStructure([base(), trouser(), loafer()]).valid, true)
})

// --- wear order as data (owner ruling 2026-09-12) -----------------------------------------------

test('ROLES: a model-stated role survives the card projection, and a contradicting one is dropped', async () => {
  const { normalizeWholeWardrobeOutfitObject, roleMatchesCategory, deriveWholeWardrobeRoles } = await import('../styling-engine/rules.js')
  const candidates = [
    { id: 1, name: 'knit top', category: 'top' },
    { id: 2, name: 'knit cardigan', category: 'outerwear' },
    { id: 3, name: 'wool coat', category: 'outerwear' },
    { id: 4, name: 'trousers', category: 'bottom' },
    { id: 5, name: 'loafers', category: 'shoes' },
  ]
  const stated = normalizeWholeWardrobeOutfitObject({
    label: 'stack',
    pieces: [{ id: 1, role: 'primary_top' }, { id: 2, role: 'layer_top' }, { id: 3, role: 'outerwear' }, { id: 4 }, { id: 5 }],
  }, candidates)
  assert.deepEqual(stated.pieces.map(piece => piece.role), ['primary_top', 'layer_top', 'outerwear', null, null])

  // Category is truth, role is intent — the same split propose_outfit already holds. A trouser
  // claiming to be outerwear is dropped and the derivation answers instead.
  const spoofed = normalizeWholeWardrobeOutfitObject({
    label: 'spoof',
    pieces: [{ id: 1 }, { id: 4, role: 'outerwear' }, { id: 5 }],
  }, candidates)
  assert.equal(spoofed.pieces.find(piece => piece.id === 4).role, null, 'a bottom cannot be assigned an upper-body role')
  assert.equal(roleMatchesCategory('layer_top', 'outerwear'), true, 'a cardigan under a coat is a layer_top doing the middle job')
  assert.equal(roleMatchesCategory('primary_top', 'dress'), false)
})

test('ROLES: wear order is derived when the composer states nothing', async () => {
  const { deriveWholeWardrobeRoles } = await import('../styling-engine/rules.js')
  const derived = deriveWholeWardrobeRoles([
    { id: 1, category: 'top' }, { id: 2, category: 'outerwear' }, { id: 3, category: 'outerwear' },
  ])
  assert.equal(derived.get(1), 'primary_top')
  assert.equal(derived.get(2), 'layer_top', 'the first outerwear listed is worn under the second')
  assert.equal(derived.get(3), 'outerwear')
})

test('ROLES: the stack they unlock is what clears a `warm` demand from moderate pieces', async () => {
  const { outfitThermalContribution } = await import('../styling-engine/outfitThermalContribution.js')
  const stack = [
    { id: 1, category: 'top', fabric_weight: 'medium', fiber_content: ['wool'], sleeve_length: 'long', role: 'primary_top' },
    { id: 2, category: 'outerwear', fabric_weight: 'medium', fiber_content: ['wool'], sleeve_length: 'long', role: 'layer_top' },
    { id: 3, category: 'outerwear', fabric_weight: 'light', fiber_content: ['cotton'], sleeve_length: 'long', role: 'outerwear' },
  ]
  assert.equal(outfitThermalContribution(stack).withLayer, 'warm',
    'base + middle + outer steps up — the only route to `warm` in a wardrobe whose bases top out at moderate')
  const roleless = stack.map(({ role, ...piece }) => piece)
  assert.notEqual(outfitThermalContribution(roleless).withLayer, 'warm',
    'and without the roles the same three garments earn nothing, which is what shipped before')
})

// ─── chain-aware construction: volume that travels through an intermediate layer ────────────────
//
// Live thread_1789274442146: a gathered/ruched turtleneck, a cream open cardigan and a fitted navy
// puffer. Both adjacent pairs returned `compatible` and the outfit carried zero findings, because
// the pairwise rule treats accommodation as ABSORPTION — once the cardigan is judged able to
// contain the turtleneck sleeve, that volume disappears before the puffer is evaluated. The model,
// which had all three photographs, then justified the card by asserting that the puffer's ribbed
// TORSO panels supply sleeve capacity. Nothing structured says that.
//
// The fold is qualitative: the same elevated/none/null and accommodates/restricted/null vocabulary
// the pair rule already uses. No magnitudes, no counting of cuffed layers, no fabric-weight
// arithmetic, and deliberately NO use of sleeve LENGTH as a proxy for sleeve thickness — an
// extra-long fitted sleeve extends past a cuff without trapping volume, and treating extent as
// bulk would hard-reject real combinations on evidence that does not exist.

const RUCHED_BASE = { id: 401, name: 'ruched turtleneck', category: 'top', role: 'primary_top', sleeve_length: 'extra_long', sleeve_shape: 'gathered_ruched', fabric_weight: 'medium' }
const ACCOMMODATING_MIDDLE = { id: 402, name: 'open knit cardigan', category: 'outerwear', role: 'layer_top', sleeve_length: 'extra_long', sleeve_shape: 'straight', fabric_weight: 'medium', silhouette: 'relaxed', fit_on_body: 'hangs_straight' }
const FITTED_OUTER = { id: 403, name: 'quilted puffer', category: 'outerwear', role: 'outerwear', sleeve_length: 'long', sleeve_shape: 'straight', fabric_weight: 'medium', silhouette: 'fitted', fit_on_body: 'skims' }
const ROOMY_OUTER = { id: 404, name: 'boxy puffer coat', category: 'outerwear', role: 'outerwear', sleeve_length: 'long', sleeve_shape: 'straight', fabric_weight: 'heavy', silhouette: 'boxy', fit_on_body: 'hangs_straight' }

test('CHAIN: elevated sleeve volume survives an accommodating middle layer and meets the outer sleeve', () => {
  const result = evaluateLayerPairConstruction([RUCHED_BASE, ACCOMMODATING_MIDDLE, FITTED_OUTER], { roleAware: true })
  assert.equal(result.verdict, 'incompatible')
  const conflict = result.findings.find(f => f.code === 'layer_construction_sleeve_conflict')
  assert.ok(conflict, 'the propagated conflict is the same known construction conflict, not a new code')
  assert.equal(conflict.severity, 'error')
  assert.equal(conflict.evidence.originId, RUCHED_BASE.id, 'the finding names where the volume came from')
  assert.equal(conflict.evidence.outerId, FITTED_OUTER.id)
  assert.deepEqual(conflict.evidence.throughIds, [ACCOMMODATING_MIDDLE.id], 'and what it is still inside')
  assert.match(conflict.message, /still inside open knit cardigan/)

  // Exactly one finding for the relationship, matching the pair rule's one-zone-and-stop behaviour.
  assert.equal(result.findings.filter(f => f.code === 'layer_construction_sleeve_conflict').length, 1)
})

test('CHAIN: a flared middle layer is rejected under a fitted outer by the DIRECT pair rule', () => {
  // The second half of the incident, and the reason the chain rule is not the only fix needed: a
  // sleeve that widens into a deep cuff carries its own volume, so it fails under a narrow sleeve
  // with any base at all — no propagation required.
  const flaredCardigan = { ...ACCOMMODATING_MIDDLE, role: 'primary_top', sleeve_shape: 'flared' }
  const result = evaluateLayerPairConstruction([flaredCardigan, FITTED_OUTER], { roleAware: true })
  assert.equal(result.verdict, 'incompatible')
  assert.ok(result.findings.some(f => f.code === 'layer_construction_sleeve_conflict'))
})

test('CHAIN: genuinely roomy outerwear accepts both combinations', () => {
  assert.equal(evaluateLayerPairConstruction([RUCHED_BASE, ACCOMMODATING_MIDDLE, ROOMY_OUTER], { roleAware: true }).verdict, 'compatible')
  const flaredCardigan = { ...ACCOMMODATING_MIDDLE, role: 'primary_top', sleeve_shape: 'flared' }
  assert.equal(evaluateLayerPairConstruction([flaredCardigan, ROOMY_OUTER], { roleAware: true }).verdict, 'compatible')
})

test('CHAIN (negative control): a fine fitted EXTRA-LONG sleeve is not rejected under ordinary long outerwear', () => {
  // Sleeve length is EXTENT, not trapped volume. An extra-long fitted sleeve may extend past a
  // shorter jacket cuff or fold without making the combination unwearable, so `extra_long` inside
  // `long` is not a conflict and must never become one — that would be sleeve length standing in
  // for the sleeve-thickness dimension the catalog does not record, and it would hard-reject real
  // combinations (59 of them in the owner's wardrobe) with no evidence that they fail.
  const fineExtraLong = { id: 410, name: 'fine jersey top', category: 'top', role: 'primary_top', sleeve_length: 'extra_long', sleeve_shape: 'fitted', fabric_weight: 'light' }
  const ordinaryCoat = { id: 411, name: 'wool coat', category: 'outerwear', role: 'outerwear', sleeve_length: 'long', sleeve_shape: 'straight', fabric_weight: 'medium', silhouette: 'fitted', fit_on_body: 'skims' }
  assert.equal(evaluateLayerPairConstruction([fineExtraLong, ordinaryCoat], { roleAware: true }).verdict, 'compatible')

  // Same through a chain, and with a straight middle layer — multiple ordinary straight sleeves
  // never accumulate into a conflict.
  const straightMiddle = { ...ACCOMMODATING_MIDDLE, sleeve_shape: 'straight' }
  assert.equal(evaluateLayerPairConstruction([fineExtraLong, straightMiddle, ordinaryCoat], { roleAware: true }).verdict, 'compatible')
})

test('CHAIN: unresolved sleeve construction stays unknown and never becomes a hard failure', () => {
  const unknownOuter = { ...FITTED_OUTER, sleeve_shape: null, silhouette: null, fit_on_body: null }
  const unknownOuterResult = evaluateLayerPairConstruction([RUCHED_BASE, ACCOMMODATING_MIDDLE, unknownOuter], { roleAware: true })
  assert.equal(unknownOuterResult.verdict, 'unknown')
  assert.ok(unknownOuterResult.findings.every(f => f.severity !== 'error'))
  assert.equal(unknownOuterResult.sightRequired, 'both', 'it is a question for the photographs')

  const unknownBase = { ...RUCHED_BASE, sleeve_shape: null }
  const unknownBaseResult = evaluateLayerPairConstruction([unknownBase, ACCOMMODATING_MIDDLE, FITTED_OUTER], { roleAware: true })
  assert.equal(unknownBaseResult.verdict, 'unknown')
  assert.ok(unknownBaseResult.findings.every(f => f.severity !== 'error'))

  const unknownLength = { ...RUCHED_BASE, sleeve_length: null }
  const unknownLengthResult = evaluateLayerPairConstruction([unknownLength, ACCOMMODATING_MIDDLE, FITTED_OUTER], { roleAware: true })
  assert.ok(unknownLengthResult.verdict !== 'incompatible',
    'a conflict needs BOTH participants known to have a sleeve')
})

test('CHAIN: two-garment outfits are unchanged — the fold only speaks for propagated volume', () => {
  // The direct relationship is the pair rule's to report; the fold never double-reports it.
  const direct = evaluateLayerPairConstruction([RUCHED_BASE, FITTED_OUTER], { roleAware: true })
  assert.equal(direct.verdict, 'incompatible')
  assert.equal(direct.findings.filter(f => f.code === 'layer_construction_sleeve_conflict').length, 1)
  assert.equal(direct.evidence.chainLength, 0, 'no chain is folded for a two-garment upper body')
})

test('CHAIN: exactly ONE conflict is reported, and the direction stage owns none of it', () => {
  // The chain fold briefly lived in evaluateLayerDirections as well as
  // evaluateLayerPairConstruction, and evaluateWearableOutfit composes both stages — so a single
  // propagated conflict surfaced twice, once under a stage whose only question is which garment is
  // worn over which. Construction has exactly one owner.
  const result = evaluateWearableOutfit([
    RUCHED_BASE, ACCOMMODATING_MIDDLE, FITTED_OUTER,
    { id: 405, name: 'trousers', category: 'bottom', role: 'primary_bottom' },
    { id: 406, name: 'boots', category: 'shoes', role: 'shoes' },
  ], { roleAware: true, includeLayerDirections: true })

  // Log-only since 2026-09-14: the chain conflict is shadow evidence, not a finding.
  assert.equal(result.hardValid, true)
  const conflicts = result.shadowFindings.filter(f => f.code === 'layer_construction_sleeve_conflict')
  assert.equal(conflicts.length, 1, `exactly one conflict for one relationship: ${JSON.stringify(conflicts.map(c => c.message))}`)
  assert.equal(result.hardFindings.filter(f => f.code === 'layer_construction_sleeve_conflict').length, 0)

  const directionStage = result.stages.find(stage => stage.stage === 'layer_direction')
  const constructionStage = result.stages.find(stage => stage.stage === 'layer_construction')
  assert.ok(directionStage && constructionStage, 'both stages ran')
  assert.equal(directionStage.result.findings.filter(f => String(f.code).startsWith('layer_construction_')).length, 0,
    'the direction stage reports no construction finding of any kind')
  assert.equal(constructionStage.result.findings.filter(f => f.code === 'layer_construction_sleeve_conflict').length, 1)
})

// ─── register: an unstated ceiling ranks, a stated one gates ────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { registerCeilingVerdict, registerCeilingIsExplicit, profileRuleFit, resolveFormalityIntent, registerFitPieceAdvisory } from '../styling-engine/rules.js'

test('REGISTER: any distance above an UNSTATED ceiling is eligible and ranked down, not prohibited', () => {
  // Live thread_1789288270913: an ordinary "five casual outfits" request excluded 80 owned pieces as
  // `prohibited` while four `elevated` base garments shipped in the same set — the survivors simply
  // carried an explicit `casual` tag. The gate was reading tagging completeness as validity.
  const elevatedCoat = { id: 1, name: 'cream trench coat', category: 'outerwear', formality: 'elevated', occasions: ['city', 'smart-casual'] }
  const everydayCoat = { id: 2, name: 'quilted puffer', category: 'outerwear', formality: 'everyday', occasions: ['casual', 'city'] }
  const dressyCoat = { id: 3, name: 'tweed evening coat', category: 'outerwear', formality: 'dressy', occasions: ['evening'] }
  const EVERYDAY = 1

  // Default ceiling (the app's own idea of what casual usually asks for).
  assert.equal(registerCeilingVerdict(everydayCoat, EVERYDAY, { occasion: 'casual', explicitCeiling: false }).verdict, 'pass')
  assert.equal(registerCeilingVerdict(elevatedCoat, EVERYDAY, { occasion: 'casual', explicitCeiling: false }).verdict, 'above_request',
    'one rank up is eligible and ranked down')
  // 2026-09-13 final ruling: the one-step bound was a ratified PREFERENCE, marked for revisit, and a
  // preference ranks. Two ranks up sinks further in the ranking instead of being declared invalid.
  const twoUp = registerCeilingVerdict(dressyCoat, EVERYDAY, { occasion: 'casual', explicitCeiling: false })
  assert.equal(twoUp.verdict, 'above_request')
  assert.equal(twoUp.ranksAbove, 2)
  const oneUp = registerCeilingVerdict(elevatedCoat, EVERYDAY, { occasion: 'casual', explicitCeiling: false })
  assert.ok(registerFitPieceAdvisory(dressyCoat, { registerCeiling: 'everyday', occasion: 'casual' }).score
    < registerFitPieceAdvisory(elevatedCoat, { registerCeiling: 'everyday', occasion: 'casual' }).score,
    'and it ranks strictly worse than one rank up')
  assert.equal(oneUp.ranksAbove, 1)

  // A ceiling the WEARER stated keeps hard authority: "nothing elevated" means nothing elevated.
  assert.equal(registerCeilingVerdict(elevatedCoat, EVERYDAY, { occasion: 'casual', explicitCeiling: true }).verdict, 'exclude')

  // The existing explicit-tag exemption is unchanged — and is the evidence this was always a
  // preference: an owner tag cannot make a genuinely invalid piece valid.
  const taggedElevated = { ...elevatedCoat, occasions: ['casual', 'city'] }
  assert.equal(registerCeilingVerdict(taggedElevated, EVERYDAY, { occasion: 'casual', explicitCeiling: true }).exemptedByExplicitTag, true)
})

test('REGISTER: the prohibited tier holds prohibitions, not preferences', () => {
  // search_wardrobe drops `prohibited` pieces in compose mode and explains them in `intent: explain`,
  // so a preference in that tier is both a silent supply cut and a false explanation to the wearer.
  const elevatedCoat = { id: 1, name: 'cream trench coat', category: 'outerwear', formality: 'elevated', occasions: ['city', 'smart-casual'] }
  const occasionProfile = { id: 'casual', rules: {} }

  const defaulted = profileRuleFit(elevatedCoat, {}, { occasionProfile, registerCeiling: 'everyday', registerCeilingExplicit: false })
  assert.equal(defaulted.tier, 'discouraged')
  assert.match(defaulted.reason, /one rank above/)

  const stated = profileRuleFit(elevatedCoat, {}, { occasionProfile, registerCeiling: 'everyday', registerCeilingExplicit: true })
  assert.equal(stated.tier, 'prohibited', 'a stated dress code still prohibits')
})

test('REGISTER: only a stated MAXIMUM makes a ceiling hard', () => {
  // Owner ruling 2026-09-13, refined: an occasion-derived target or ceiling is soft, and so is a
  // stated TARGET — "something dressy" says what the wearer is going for, not what they will not
  // wear. Only a maximum is a constraint.
  assert.equal(registerCeilingIsExplicit({ occasion: 'casual', request: 'five casual outfits for a cool day' }), false)
  assert.equal(registerCeilingIsExplicit({ occasion: 'casual', request: 'I want something dressy' }), false,
    'a target is not a maximum')
  assert.equal(registerCeilingIsExplicit({ occasion: 'casual', request: 'nothing dressy' }), true)
  assert.equal(registerCeilingIsExplicit({ occasion: 'casual', request: 'nothing above casual' }), true)

  // An ACTIVITY ceiling is NOT a capability claim either (owner ruling 2026-09-13): formality does
  // not establish whether a garment can physically serve an activity. An elevated fleece settles it.
  // Movement allowance, footwear support, maintenance/delicacy, construction and weather protection
  // are the real owners, and each keeps its own hard gate.
  assert.equal(registerCeilingIsExplicit({ occasion: 'casual', activity: 'hiking', request: 'a hike' }), false)
})

test('REGISTER: "casual outfit" is a target, "nothing above casual" is a maximum', () => {
  assert.equal(registerCeilingIsExplicit({ occasion: 'casual', request: 'five casual outfits for a 65/50 day' }), false)
  assert.equal(registerCeilingIsExplicit({ occasion: 'casual', request: 'casual outfit for running errands' }), false)
  assert.equal(registerCeilingIsExplicit({ occasion: 'casual', request: 'nothing above casual please' }), true)

  // And the maximum lands on the right rank: everything above the named register is excluded,
  // derived from the ladder rather than named case by case.
  const intent = resolveFormalityIntent({ occasion: 'casual', request: 'nothing above casual please' })
  assert.deepEqual([...intent.avoid].sort(), ['dressy', 'elevated'])
})

test('REGISTER: a negated register word is a maximum, not a target (defect fixed 2026-09-13)', () => {
  // `resolveFormalityIntent`'s negation alternation was `not|no|avoid|less`, so "nothing dressy"
  // matched nothing, survived the stripping step, and was read by the POSITIVE matcher as a dressy
  // TARGET — raising the ceiling to dressy and admitting exactly what the wearer excluded. The
  // vocabulary now includes nothing/none/never, and an explicit "above X" maximum is recognised in
  // its own right.
  const negated = resolveFormalityIntent({ occasion: 'casual', request: 'nothing dressy' })
  assert.equal(negated.target, null, 'the word is no longer read as a target')
  assert.deepEqual([...negated.avoid], ['dressy'])

  const maximum = resolveFormalityIntent({ occasion: 'casual', request: 'nothing above casual please' })
  assert.equal(maximum.target, null)
  assert.deepEqual([...maximum.avoid].sort(), ['dressy', 'elevated'])

  // A genuine target still resolves as one.
  assert.equal(resolveFormalityIntent({ occasion: 'casual', request: 'I want something dressy' }).target, 'dressy')
})

test('ROSTER RULE: capability decides the reserve, register only separates comparable coats', () => {
  // Owner ruling 2026-09-13. Register cannot have absolute priority at the roster boundary when
  // environmental capability differs — but it decides between coats that answer the day equally.
  // Both keys already exist: the endpoint evaluator's ranking distance, and the register verdict.
  const source = fs.readFileSync(path.join(process.cwd(), 'styling-engine/rules.js'), 'utf8')
  const reserve = source.slice(source.indexOf('const byThermalFit = coats'), source.indexOf('const keptCoats'))

  // Distance is compared BEFORE the register tiebreak — the ordering of the two keys is the rule.
  const distanceAt = reserve.indexOf('a.distance !== b.distance')
  const registerAt = reserve.indexOf('registerAboveRequestIds')
  assert.ok(distanceAt > 0 && registerAt > 0, 'both keys are present in the reserve sort')
  assert.ok(distanceAt < registerAt,
    'capability is the primary key; register breaks ties between comparable coats')

  // And the category sort carries no absolute register key at all — register lives in the relevance
  // score there, alongside the thermal band's own weighting.
  const categorySort = source.slice(source.indexOf('// Sort by relevance score descending'), source.indexOf('if (cat === \'outerwear\''))
  assert.doesNotMatch(categorySort, /registerAboveRequestIds/,
    'a piece one rank up must not sort behind every within-register piece regardless of capability')
})

test('REGISTER: the advisory is floored so it can never outrank weather adequacy', () => {
  // Owner ruling 2026-09-13: weather adequacy must not lose to register preference by score
  // arithmetic. The floor makes that an invariant rather than a coincidence — before it, the
  // ordering held at one and two ranks (by 14 and 8) but a three-rank distance would have inverted.
  const dressyCoat = { id: 3, name: 'tweed evening coat', category: 'outerwear', formality: 'dressy', occasions: ['evening'] }
  const twoRanks = registerFitPieceAdvisory(dressyCoat, { registerCeiling: 'everyday', occasion: 'casual' })
  assert.equal(twoRanks.score, -9, 'scaled per rank, then floored below the thermal band magnitude')
  assert.ok(Math.abs(twoRanks.score) < 10,
    'strictly smaller than the smallest thermal adjustment, at any distance')

  // Distance is still expressed: farther from the request ranks worse, up to the floor.
  const elevatedCoat = { id: 1, name: 'trench', category: 'outerwear', formality: 'elevated', occasions: ['city'] }
  const oneRank = registerFitPieceAdvisory(elevatedCoat, { registerCeiling: 'everyday', occasion: 'casual' })
  assert.ok(twoRanks.score < oneRank.score)

  // A stated maximum is the gate's business, not the ranking's.
  assert.equal(registerFitPieceAdvisory(dressyCoat, { registerCeiling: 'everyday', occasion: 'casual', explicitCeiling: true }).score, 0)
})
