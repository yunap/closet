import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const pieceCardSource = fs.readFileSync(new URL('../src/components/PieceCard.jsx', import.meta.url), 'utf8')
const pieceDetailSource = fs.readFileSync(new URL('../src/components/PieceDetail.jsx', import.meta.url), 'utf8')
const pieceFormSource = fs.readFileSync(new URL('../src/components/PieceForm.jsx', import.meta.url), 'utf8')

test('garment grid, detail, and editor use the retina-ready display derivative', () => {
  assert.match(pieceCardSource, /garment-display/)
  assert.match(pieceDetailSource, /garment-display/)
  assert.match(pieceFormSource, /garment-display/)
})

test('piece editor uses fixed photo slots without a photo-size control', () => {
  assert.doesNotMatch(pieceFormSource, /photoPreviewSize|aria-label="Photo size"/)
})
