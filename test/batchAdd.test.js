import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.join(process.cwd(), 'src/components/BatchAdd.jsx'), 'utf8')

test('BatchAdd preserves structured register and shoe comfort tags from AI tagging', () => {
  assert.match(source, /formality:\s*null,\s*heel_height:\s*null,\s*walk_support:\s*null/)
  assert.match(source, /formality:\s*tags\.formality\s*\|\|\s*null/)
  assert.match(source, /heel_height:\s*tags\.heel_height\s*\|\|\s*null/)
  assert.match(source, /walk_support:\s*tags\.walk_support\s*\|\|\s*null/)
})

test('BatchAdd review UI exposes formality before saving', () => {
  assert.match(source, /const FORMALITY_OPTIONS = \[/)
  assert.match(source, /form\.category !== 'accessory'/)
  assert.match(source, /form\.formality === opt\.value/)
  assert.match(source, /set\('formality', opt\.value\)/)
})

test('BatchAdd review UI exposes fabric_weight, fiber_content, and shoe comfort fields', () => {
  assert.match(source, /const FABRIC_WEIGHT_OPTIONS = \[/)
  assert.match(source, /const FIBER_OPTIONS = \[/)
  assert.match(source, /const HEEL_HEIGHT_OPTIONS = \[/)
  assert.match(source, /const WALK_SUPPORT_OPTIONS = \[/)
  assert.match(source, /form\.fabric_weight === opt\.value/)
  assert.match(source, /toggleArr\('fiber_content', fib\)/)
  assert.match(source, /form\.category === 'shoes'/)
})

test('BatchAdd and PieceForm bind all GATE_CRITICAL_FIELDS to UI control labels', () => {
  const pieceFormSource = fs.readFileSync(path.join(process.cwd(), 'src/components/PieceForm.jsx'), 'utf8')
  const GATE_CRITICAL_FIELDS = ['formality', 'fabric_weight', 'fiber_content', 'occasions', 'heel_height', 'walk_support']
  
  for (const field of GATE_CRITICAL_FIELDS) {
    assert.match(source, new RegExp(`field="${field}"`))
    assert.match(pieceFormSource, new RegExp(`field="${field}"`))
  }
})
