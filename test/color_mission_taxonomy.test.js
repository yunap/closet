import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'color-mission-taxonomy-'))
process.env.WARDROBE_DB_PATH = path.join(root, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(root, 'uploads')

const { qualifiesWholeWardrobeMission } = await import('../styling-engine/rules.js')
const { colorFamily } = await import('../styling-engine/attributes.js')

const support = [
  { id: 2, name: 'black trousers', category: 'bottom', colors: ['black'] },
  { id: 3, name: 'white flats', category: 'shoes', colors: ['white'] },
]

test('olive is neutral-adjacent support, not a color-anchor focal accent', () => {
  const olive = { id: 1, name: 'olive top', category: 'top', colors: ['olive'] }
  assert.equal(qualifiesWholeWardrobeMission([olive, ...support], 'color_anchor'), false)
})

test('burgundy remains eligible as the single focal accent in a color-anchor outfit', () => {
  const burgundy = { id: 1, name: 'burgundy top', category: 'top', colors: ['burgundy'] }
  assert.equal(qualifiesWholeWardrobeMission([burgundy, ...support], 'color_anchor'), true)
})

test('unstructured color fallback uses taxonomy accents without a copied list', () => {
  assert.equal(colorFamily({ name: 'pink blouse', colors: [] }), 'accent')
  assert.equal(colorFamily({ name: 'olive blouse', colors: [] }), 'warm-earth')
})
