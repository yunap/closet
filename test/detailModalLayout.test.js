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

test('garment detail presents learned feedback as readable memory instead of system tags', () => {
  assert.match(pieceDetail, /function presentMemoryRule\(rule\)/)
  assert.match(pieceDetail, /withoutEmbeddedImages/)
  assert.match(pieceDetail, /works\?/)
  assert.match(pieceDetail, /Styling memory/)
  assert.match(pieceDetail, /What your stylist has learned about using this piece/)
  assert.match(pieceDetail, /Works well/)
  assert.match(pieceDetail, /Avoid or reconsider/)
  assert.doesNotMatch(pieceDetail, /fontSize:\s*12,\s*color:\s*'var\(--accent\)'/)
  assert.match(css, /\.garment-memory-item\s*\{[\s\S]*?font-size:\s*var\(--type-control\);[\s\S]*?line-height:\s*1\.55/)
})

test('garment detail distinguishes identity, evidence, relationships, and actions', () => {
  assert.match(pieceDetail, /garment-detail-eyebrow/)
  assert.match(pieceDetail, />Garment notes</)
  assert.match(pieceDetail, /piece\.worn_photo \? 'Review fit details' : 'Add worn photo'/)
  assert.match(pieceDetail, /Generated outfits ·/)
  assert.match(pieceDetail, /Linked outfits ·/)
  assert.ok(
    pieceDetail.indexOf('Linked outfits ·') < pieceDetail.indexOf('Generated outfits ·'),
    'lived outfit evidence should appear before generated exploration'
  )
  assert.match(pieceDetail, /relationshipsLoading/)
  assert.match(pieceDetail, /btn-secondary piece-edit-action/)
  assert.match(css, /\.garment-ask-stylist\s*\{[\s\S]*?background:\s*var\(--accent\);[\s\S]*?color:\s*#fff;/)
})

test('garment dialog traps focus, closes with Escape, and restores prior focus', () => {
  assert.match(pieceDetail, /requestAnimationFrame\(\(\) => closeRef\.current\?\.focus\(\)\)/)
  assert.match(pieceDetail, /onCloseRef\.current\(\)/)
  assert.match(pieceDetail, /event\.key === 'Escape'/)
  assert.match(pieceDetail, /event\.key !== 'Tab'/)
  assert.match(pieceDetail, /previewDialogRef\.current/)
  assert.match(pieceDetail, /aria-labelledby="garment-preview-title"/)
  assert.match(pieceDetail, /previouslyFocused\?\.focus\?\.\(\)/)
})

test('garment detail keeps its actions reachable and its desktop columns spacious', () => {
  assert.match(css, /@media \(max-width: 860px\)\s*\{[\s\S]*?\.piece-detail-action-dock\s*\{[\s\S]*?position:\s*sticky/)
  assert.match(css, /@media \(min-width: 768px\)\s*\{[\s\S]*?\.piece-detail-sheet\s*\{[\s\S]*?width:\s*min\(1100px,/)
})
