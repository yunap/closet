import test from 'node:test'
import assert from 'node:assert/strict'
import { validateOutfitRoles } from '../styling-engine/tools.js'

// Spec 2: role-based outfit validation (roles only, no layerOf). Intentional layering is valid;
// unresolved slot collisions are not — the malformed-vs-intentional distinction, mechanically enforced.

const p = (id, role) => ({ id, role })

test('valid: separates core (primary_top + primary_bottom + shoes)', () => {
  assert.deepEqual(validateOutfitRoles([p(1, 'primary_top'), p(2, 'primary_bottom'), p(3, 'shoes')]), [])
})

test('valid: dress core + shoes', () => {
  assert.deepEqual(validateOutfitRoles([p(1, 'dress'), p(2, 'shoes')]), [])
})

test('valid: intentional layering (primary_top + layer_top) is not a collision', () => {
  assert.deepEqual(
    validateOutfitRoles([p(1, 'primary_top'), p(2, 'layer_top'), p(3, 'primary_bottom'), p(4, 'shoes'), p(5, 'outerwear'), p(6, 'accessory')]),
    []
  )
})

test('valid: layer_bottom under a dress (e.g. leggings under a slip dress)', () => {
  assert.deepEqual(validateOutfitRoles([p(1, 'dress'), p(2, 'layer_bottom'), p(3, 'shoes')]), [])
})

test('invalid: two primary_top = unresolved top slot', () => {
  const issues = validateOutfitRoles([p(1, 'primary_top'), p(2, 'primary_top'), p(3, 'primary_bottom'), p(4, 'shoes')])
  assert.match(issues.join(' '), /unresolved top slot/)
})

test('invalid: two primary_bottom = unresolved bottom slot', () => {
  const issues = validateOutfitRoles([p(1, 'primary_top'), p(2, 'primary_bottom'), p(3, 'primary_bottom'), p(4, 'shoes')])
  assert.match(issues.join(' '), /unresolved bottom slot/)
})

test('invalid: two dress = unresolved dress slot', () => {
  const issues = validateOutfitRoles([p(1, 'dress'), p(2, 'dress'), p(3, 'shoes')])
  assert.match(issues.join(' '), /unresolved dress slot/)
})

test('invalid: more than one shoes', () => {
  const issues = validateOutfitRoles([p(1, 'primary_top'), p(2, 'primary_bottom'), p(3, 'shoes'), p(4, 'shoes')])
  assert.match(issues.join(' '), /unresolved shoes slot/)
})

test('invalid: no core (only shoes)', () => {
  const issues = validateOutfitRoles([p(1, 'shoes')])
  assert.match(issues.join(' '), /needs a primary_top plus primary_bottom, or a single dress/)
})

test('invalid: dress combined with separates', () => {
  const issues = validateOutfitRoles([p(1, 'dress'), p(2, 'primary_top'), p(3, 'shoes')])
  assert.match(issues.join(' '), /dress cannot be combined/)
})

test('invalid: layer_top with nothing to layer over', () => {
  const issues = validateOutfitRoles([p(1, 'layer_top'), p(2, 'primary_bottom'), p(3, 'shoes')])
  assert.match(issues.join(' '), /layer_top has no primary_top or dress/)
})

test('invalid: unknown/missing role', () => {
  const issues = validateOutfitRoles([p(1, 'top'), p(2, 'primary_bottom'), p(3, 'shoes')])
  assert.match(issues.join(' '), /invalid or missing role/)
})

test('invalid: category must match assigned structural role', () => {
  const issues = validateOutfitRoles([
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
  const issues = validateOutfitRoles([p(1, 'primary_top'), p(2, 'primary_bottom')])
  assert.match(issues.join(' '), /missing shoes/)
})

test('invalid: missing_gaps can explain but not satisfy a missing shoes slot', () => {
  const issues = validateOutfitRoles([p(1, 'primary_top'), p(2, 'primary_bottom')], ['walkable flat sandal, no suitable shoe in wardrobe'])
  assert.match(issues.join(' '), /missing shoes/)
})

test('invalid: missing_gaps present but does not mention shoes', () => {
  const issues = validateOutfitRoles([p(1, 'primary_top'), p(2, 'primary_bottom')], ['lightweight rain shell'])
  assert.match(issues.join(' '), /missing shoes/)
})

test('invalid: standalone tee cannot be laundered into layer_top', () => {
  const issues = validateOutfitRoles([
    { id: 1, role: 'primary_top', name: 'ivory graphic print crew tee', category: 'top', reads_as: 'graphic crew tee' },
    { id: 2, role: 'layer_top', name: 'black graphic cat tee', category: 'top', reads_as: 'graphic tee' },
    p(3, 'primary_bottom'),
    p(4, 'shoes')
  ])
  assert.match(issues.join(' '), /standalone top/)
})

test('invalid: ordinary tank cannot be laundered into layer_top', () => {
  const issues = validateOutfitRoles([
    { id: 1, role: 'primary_top', name: 'ivory graphic print crew tee', category: 'top', reads_as: 'graphic crew tee' },
    { id: 2, role: 'layer_top', name: 'ribbed cotton tank', category: 'top', reads_as: 'fitted tank' },
    p(3, 'primary_bottom'),
    p(4, 'shoes')
  ])
  assert.match(issues.join(' '), /standalone top/)
})

test('valid: tank with explicit overlay evidence can be layer_top', () => {
  assert.deepEqual(validateOutfitRoles([
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
