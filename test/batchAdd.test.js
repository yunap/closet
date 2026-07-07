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
