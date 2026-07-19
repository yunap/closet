import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'
// Hermetic DB isolation (spec 21/29 doctrine): this file's import chain reaches db.js,
// whose module-load migrations would otherwise run against the real wardrobe.db.
const tmpRoot = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'editorial-ideal-additions-'))
process.env.WARDROBE_DB_PATH = nodePath.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = nodePath.join(tmpRoot, 'uploads')
const {
  dedupeAndDifferentiateEditorialDirections,
  ownedLooksSimilarToArchetype,
} = await import('../styling-engine/core.js')

test('editorial ideal additions avoid owned color/category matches while preserving selected top role', () => {
  const selectedPiece = {
    id: 77,
    name: 'bold purple floral sleeveless top',
    category: 'top',
    colors: ['purple', 'pink'],
  }
  const ownedPieces = [
    { id: 1, name: 'deep charcoal structured wide-leg trousers', category: 'bottom', colors: ['charcoal'] },
    { id: 2, name: 'sleek black leather loafers', category: 'shoes', colors: ['black'] },
    { id: 3, name: 'camel flowing midi skirt', category: 'bottom', colors: ['camel'] },
    { id: 4, name: 'brown strappy sandals', category: 'shoes', colors: ['brown'] },
  ]
  const directions = [{
    title: 'Tailored Elegance',
    missingPieces: [
      'deep charcoal structured wide-leg trousers',
      'sleek black leather loafers',
      'another sleeveless shell top',
    ],
    reason: 'Generic closet-like additions',
    visualPrompt: '',
  }]

  assert.equal(ownedLooksSimilarToArchetype('black leather loafer', ownedPieces), true)
  assert.equal(ownedLooksSimilarToArchetype('camel midi skirt', ownedPieces), true)

  const [cleaned] = dedupeAndDifferentiateEditorialDirections(directions, selectedPiece, ownedPieces)
  const text = cleaned.missingPieces.join(' | ').toLowerCase()
  assert.doesNotMatch(text, /charcoal|black leather loafer|camel|brown strappy|sleeveless shell top/)
  assert.doesNotMatch(text, /\b(top|shirt|blouse|tee|tank|shell|sweater|knit|dress)\b/)
  assert.ok(cleaned.missingPieces.length >= 2)
})
