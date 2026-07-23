import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const css = fs.readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
const pieceDetail = fs.readFileSync(new URL('../src/components/PieceDetail.jsx', import.meta.url), 'utf8')
const lookbook = fs.readFileSync(new URL('../src/views/OutfitLookbook.jsx', import.meta.url), 'utf8')

test('garment and outfit detail dialogs share the refined record layout', () => {
  assert.match(css, /\.piece-detail-sheet,\s*\n\.outfit-detail-sheet\s*\{[\s\S]*border-radius:\s*20px/)
  assert.match(css, /\.piece-detail-visual,\s*\n\.outfit-detail-visual\s*\{[\s\S]*justify-content:\s*flex-start/)
  assert.match(css, /\.outfit-detail-body\s*\{[\s\S]*display:\s*flex[\s\S]*flex-direction:\s*column/)
  assert.match(css, /\.outfit-styling-actions\s*\{[\s\S]*margin-top:\s*auto/)
})

test('detail layout changes preserve thumbnail-first media loading', () => {
  assert.match(pieceDetail, /uploadThumbnailSrc\(`\/uploads\/\$\{activePhoto\}`, 'garment-display'\)/)
  assert.match(pieceDetail, /loading=\{prioritize \? 'eager' : 'lazy'\}/)
  assert.match(pieceDetail, /board\.thumbnail_url \|\| board\.image_url/)
  assert.match(lookbook, /resolveUploadThumbnailSrc\(outfit\.photo, 'lookbook-display'\)/)
  assert.match(lookbook, /resolveUploadThumbnailSrc\(p\.photo, 'outfit-piece'\)/)
  assert.match(lookbook, /loading="lazy" decoding="async"/)
})

test('detail dialogs stack before their minimum columns can overflow', () => {
  assert.match(css, /@media \(max-width: 860px\)\s*\{[\s\S]*?\.piece-detail-layout,\s*\n\s*\.outfit-detail-layout\s*\{[\s\S]*?display:\s*block/)
  assert.match(css, /\.piece-detail-layout,\s*\n\s*\.outfit-detail-layout\s*\{[\s\S]*?height:\s*auto[\s\S]*?max-height:\s*none/)
})
