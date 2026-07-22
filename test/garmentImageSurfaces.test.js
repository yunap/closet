import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const pieceCardSource = fs.readFileSync(new URL('../src/components/PieceCard.jsx', import.meta.url), 'utf8')
const pieceDetailSource = fs.readFileSync(new URL('../src/components/PieceDetail.jsx', import.meta.url), 'utf8')
const pieceFormSource = fs.readFileSync(new URL('../src/components/PieceForm.jsx', import.meta.url), 'utf8')
const relationshipSource = fs.readFileSync(new URL('../src/utils/garmentRelationships.js', import.meta.url), 'utf8')

test('garment grid, detail, and editor use the retina-ready display derivative', () => {
  assert.match(pieceCardSource, /garment-display/)
  assert.match(pieceDetailSource, /garment-display/)
  assert.match(pieceFormSource, /garment-display/)
})

test('piece editor uses fixed photo slots without a photo-size control', () => {
  assert.doesNotMatch(pieceFormSource, /photoPreviewSize|aria-label="Photo size"/)
})

test('garment relationships preload on intent and prioritize initially visible thumbnails', () => {
  assert.match(pieceCardSource, /prefetchGarmentRelationships\(piece\.id\)/)
  assert.match(pieceDetailSource, /getCachedGarmentRelationships\(piece\.id\)/)
  assert.match(pieceDetailSource, /loading=\{prioritize \? 'eager' : 'lazy'\}/)
  assert.match(pieceDetailSource, /fetchPriority=\{prioritize \? 'high' : 'auto'\}/)
  assert.match(relationshipSource, /savedBoards\.slice\(0, 4\)/)
  assert.match(relationshipSource, /relationshipRequests\.has\(key\)/)
})
