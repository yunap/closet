import test from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateBaseLayerCandidate,
  evaluateLayerDirections,
  evaluateOutfitRoles,
  evaluateRequiredBaseLayers,
} from '../styling-engine/outfitValidation.js'

// Spec 2: role-based outfit validation (roles only, no layerOf). Intentional layering is valid;
// unresolved slot collisions are not — the malformed-vs-intentional distinction, mechanically enforced.

const p = (id, role) => ({ id, role })
const roleIssues = pieces => evaluateOutfitRoles(pieces).findings.map(finding => finding.message)

test('required base-layer candidate verdict distinguishes known compatibility from missing metadata', () => {
  assert.equal(evaluateBaseLayerCandidate({
    id: 1, category: 'top', opacity: 'opaque', fit_on_body: 'skims',
  }).verdict, 'compatible')
  const unknown = evaluateBaseLayerCandidate({ id: 2, category: 'top' })
  assert.equal(unknown.verdict, 'unknown')
  assert.equal(unknown.sightRequired, 'both')
  assert.deepEqual(
    unknown.findings.map(finding => finding.code),
    ['base_layer_candidate_opacity_unknown', 'base_layer_candidate_fit_unknown'],
  )
})

test('required base-layer candidate rejects dependence, sheer coverage, and loose fit as independent facts', () => {
  const result = evaluateBaseLayerCandidate({
    id: 2,
    name: 'sheer draped shell',
    category: 'top',
    needs_base: 'yes',
    opacity: 'sheer',
    fit_on_body: 'drapes',
  })
  assert.equal(result.verdict, 'incompatible')
  assert.deepEqual(result.findings.map(finding => finding.code), [
    'base_layer_candidate_is_dependent',
    'base_layer_candidate_not_opaque',
    'base_layer_candidate_not_close_fitting',
  ])
})

test('required base-layer contract applies to dependent garments, not ordinary layered outfits', () => {
  const ordinaryLayers = evaluateRequiredBaseLayers([
    { id: 1, category: 'top', role: 'primary_top', fit_on_body: 'drapes', opacity: 'opaque' },
    { id: 2, category: 'outerwear', role: 'layer_top' },
  ], { roleAware: true })
  assert.equal(ordinaryLayers.verdict, 'compatible', 'ordinary inner/outer layering has no close-fit rule')

  const dependentLayers = evaluateRequiredBaseLayers([
    { id: 1, category: 'top', role: 'primary_top', fit_on_body: 'drapes', opacity: 'opaque' },
    { id: 2, name: 'open crochet top', category: 'top', role: 'layer_top', needs_base: 'yes' },
  ], { roleAware: true })
  assert.equal(dependentLayers.verdict, 'incompatible')
  assert.match(dependentLayers.primaryFinding.message, /rather than close-fitting/)
})

test('returns typed role findings with stable evidence', () => {
  const result = evaluateOutfitRoles([p(1, 'primary_top'), p(2, 'primary_top'), p(3, 'shoes')])
  assert.equal(result.valid, false)
  assert.deepEqual(result.findings.map(finding => finding.code), ['multiple_primary_tops', 'missing_primary_core'])
  assert.equal(result.primaryFinding.kind, 'role_structure')
  assert.equal(result.primaryFinding.severity, 'error')
  assert.equal(result.evidence.counts.primary_top, 2)
})

test('valid: separates core (primary_top + primary_bottom + shoes)', () => {
  assert.deepEqual(roleIssues([p(1, 'primary_top'), p(2, 'primary_bottom'), p(3, 'shoes')]), [])
})

test('valid: dress core + shoes', () => {
  assert.deepEqual(roleIssues([p(1, 'dress'), p(2, 'shoes')]), [])
})

test('valid: intentional layering (primary_top + layer_top) is not a collision', () => {
  assert.deepEqual(
    roleIssues([p(1, 'primary_top'), p(2, 'layer_top'), p(3, 'primary_bottom'), p(4, 'shoes'), p(5, 'outerwear'), p(6, 'accessory')]),
    []
  )
})

test('valid: layer_bottom under a dress (e.g. leggings under a slip dress)', () => {
  assert.deepEqual(roleIssues([p(1, 'dress'), p(2, 'layer_bottom'), p(3, 'shoes')]), [])
})

test('invalid: two primary_top = unresolved top slot', () => {
  const issues = roleIssues([p(1, 'primary_top'), p(2, 'primary_top'), p(3, 'primary_bottom'), p(4, 'shoes')])
  assert.match(issues.join(' '), /unresolved top slot/)
})

test('invalid: two primary_bottom = unresolved bottom slot', () => {
  const issues = roleIssues([p(1, 'primary_top'), p(2, 'primary_bottom'), p(3, 'primary_bottom'), p(4, 'shoes')])
  assert.match(issues.join(' '), /unresolved bottom slot/)
})

test('invalid: two dress = unresolved dress slot', () => {
  const issues = roleIssues([p(1, 'dress'), p(2, 'dress'), p(3, 'shoes')])
  assert.match(issues.join(' '), /unresolved dress slot/)
})

test('invalid: more than one shoes', () => {
  const issues = roleIssues([p(1, 'primary_top'), p(2, 'primary_bottom'), p(3, 'shoes'), p(4, 'shoes')])
  assert.match(issues.join(' '), /unresolved shoes slot/)
})

test('invalid: no core (only shoes)', () => {
  const issues = roleIssues([p(1, 'shoes')])
  assert.match(issues.join(' '), /needs a primary_top plus primary_bottom, or a single dress/)
})

test('invalid: dress combined with separates', () => {
  const issues = roleIssues([p(1, 'dress'), p(2, 'primary_top'), p(3, 'shoes')])
  assert.match(issues.join(' '), /dress cannot be combined/)
})

test('invalid: layer_top with nothing to layer over', () => {
  const issues = roleIssues([p(1, 'layer_top'), p(2, 'primary_bottom'), p(3, 'shoes')])
  assert.match(issues.join(' '), /layer_top has no primary_top or dress/)
})

test('invalid: unknown/missing role', () => {
  const issues = roleIssues([p(1, 'top'), p(2, 'primary_bottom'), p(3, 'shoes')])
  assert.match(issues.join(' '), /invalid or missing role/)
})

test('invalid: category must match assigned structural role', () => {
  const issues = roleIssues([
    { id: 1, role: 'primary_top', name: 'black blouson top', category: 'top' },
    { id: 2, role: 'primary_bottom', name: 'black textured long sleeve top', category: 'top' },
    { id: 3, role: 'shoes', name: 'black slip-on loafers', category: 'shoes' }
  ])
  assert.match(issues.join(' '), /category "top" but was assigned role "primary_bottom"/)
})

// 2026-07-10: the whole-wardrobe visual composer's prompt already required exactly one shoe and
// forbade omitting the slot silently, but freeform chat's propose_outfit never mechanically enforced
// this at all — a zero-shoes outfit passed validation cleanly and rendered as a normal, unflagged
// card (confirmed live: "Relaxed Comfort Look" — top + bottom + cardigan, no shoes, no warning).
test('invalid: no shoes and no missing_gaps entry for shoes', () => {
  const issues = roleIssues([p(1, 'primary_top'), p(2, 'primary_bottom')])
  assert.match(issues.join(' '), /missing shoes/)
})

test('ordinary tee in layer_top is structurally valid but has unknown direction', () => {
  const pieces = [
    { id: 1, role: 'primary_top', name: 'ivory graphic print crew tee', category: 'top', reads_as: 'graphic crew tee' },
    { id: 2, role: 'layer_top', name: 'black graphic cat tee', category: 'top', reads_as: 'graphic tee' },
    p(3, 'primary_bottom'),
    p(4, 'shoes')
  ]
  assert.deepEqual(roleIssues(pieces), [])
  const direction = evaluateLayerDirections(pieces, { roleAware: true })
  assert.equal(direction.verdict, 'unknown')
  assert.equal(direction.sightRequired, 'both')
  assert.equal(direction.primaryFinding.evidence.resolutionPolicy, 'provisional_visual_judgment')
})

test('explicit top-layer evidence records a known over direction', () => {
  const result = evaluateLayerDirections([
    { id: 1, role: 'primary_top', category: 'top' },
    { id: 2, role: 'layer_top', category: 'top', engine_notes: 'Wear open over a fitted tee.' },
  ], { roleAware: true })
  assert.equal(result.verdict, 'compatible')
  assert.equal(result.pairs[0].direction, 'layer_top_over_primary_top')
  assert.equal(result.pairs[0].evidence.source, 'top_overlay_evidence')
})

// PR review: layerDirectionPromptRule() initially omitted pieceRequiresBaseLayer as a direction
// signal — a canonical branch evaluateLayerDirections has always used (a layer_top that itself
// needs_base sits over its primary_top base, no explicit overlay text required). This pins the
// executable behavior directly, independent of the prompt projection, so a future edit to the
// projection text has a real behavioral fixture to check itself against.
test('a needs_base layer_top records a known over direction from dependency alone, with no overlay text', () => {
  const result = evaluateLayerDirections([
    { id: 1, role: 'primary_top', category: 'top' },
    { id: 2, role: 'layer_top', category: 'top', needs_base: 'yes' },
  ], { roleAware: true })
  assert.equal(result.verdict, 'compatible')
  assert.equal(result.pairs[0].direction, 'layer_top_over_primary_top')
  assert.equal(result.pairs[0].evidence.source, 'dependent_layer_requires_base')
})

// PR review: layerDirectionPromptRule() initially implied role/category assignment never decides
// direction by itself, which is wrong for this exact case — an outerwear-category layer_top is
// direction evidence on its own, unlike a layer_top role on an ordinary top (see the prior test).
// This pins the executable behavior directly so the prompt prose has a real fixture to check itself
// against.
test('an outerwear-category layer_top records a known over direction from category alone, with no notes or dependency', () => {
  const result = evaluateLayerDirections([
    { id: 1, role: 'primary_top', category: 'top' },
    { id: 2, role: 'layer_top', category: 'outerwear' },
  ], { roleAware: true })
  assert.equal(result.verdict, 'compatible')
  assert.equal(result.pairs[0].direction, 'layer_top_over_primary_top')
  assert.equal(result.pairs[0].evidence.source, 'outerwear_category')
})

test('valid: tank with explicit overlay evidence can be layer_top', () => {
  assert.deepEqual(roleIssues([
    { id: 1, role: 'primary_top', name: 'ivory graphic print crew tee', category: 'top', reads_as: 'graphic crew tee' },
    {
      id: 2,
      role: 'layer_top',
      name: 'sheer black layering tank',
      category: 'top',
      reads_as: 'sheer overlay tank',
      engine_notes: 'Can be worn as layer_top over a fitted tee or tank; intended as a top layer.'
    },
    p(3, 'primary_bottom'),
    p(4, 'shoes')
  ]), [])
})

test('top plus dress direction distinguishes explicit underlayer from visual unknown', () => {
  const known = evaluateLayerDirections([
    { id: 1, category: 'dress', name: 'pinafore dress' },
    { id: 2, category: 'top', name: 'fitted top', engine_notes: 'Base layer worn under dresses.' },
  ])
  assert.equal(known.verdict, 'compatible')
  assert.equal(known.pairs[0].direction, 'top_under_dress')

  const unknown = evaluateLayerDirections([
    { id: 3, category: 'dress', name: 'plain midi dress' },
    { id: 4, category: 'top', name: 'plain blouse' },
  ])
  assert.equal(unknown.verdict, 'unknown')
  assert.deepEqual(unknown.evidence.provisionalVisualPairIds, [[4, 3]])
})

test('a top worn over a base layer is not misread as the base layer', () => {
  const result = evaluateLayerDirections([
    { id: 1, category: 'dress', name: 'plain midi dress' },
    { id: 2, category: 'top', name: 'open knit', engine_notes: 'Top layer worn over a base layer.' },
  ])
  assert.equal(result.verdict, 'compatible')
  assert.equal(result.pairs[0].direction, 'top_over_dress')
})
