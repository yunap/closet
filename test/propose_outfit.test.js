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
