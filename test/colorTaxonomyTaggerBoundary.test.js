import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('tagger routes sanitize unsupported colors and queue linked reviews', () => {
  const ai = fs.readFileSync('routes/ai.js', 'utf8')
  assert.match(ai, /sanitizeTaggerColors\(rawTags\)/)
  assert.match(ai, /sanitizeTaggerColors\(rawTags, \{ preserveExisting: true \}\)/)
  assert.match(ai, /queueColorTaxonomyReviews\(db, \{/)
})

test('new-piece save paths carry taxonomy gaps into the linked review list', () => {
  const crud = fs.readFileSync('routes/crud.js', 'utf8')
  const pieceForm = fs.readFileSync('src/components/PieceForm.jsx', 'utf8')
  const batchAdd = fs.readFileSync('src/components/BatchAdd.jsx', 'utf8')
  assert.match(crud, /colors: safeJsonParse\(color_taxonomy_gaps, \[\]\)/)
  assert.match(pieceForm, /fd\.append\('color_taxonomy_gaps'/)
  assert.match(batchAdd, /fd\.append\('color_taxonomy_gaps'/)
  assert.match(pieceForm, /were not applied/)
  assert.match(batchAdd, /were not applied/)
})
