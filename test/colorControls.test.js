import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

test('garment entry surfaces share the exact-shade color editor', () => {
  const pieceForm = read('../src/components/PieceForm.jsx')
  const batchAdd = read('../src/components/BatchAdd.jsx')
  const selector = read('../src/components/ColorSelector.jsx')

  assert.match(pieceForm, /<ColorEditor value=\{form\.colors\}/)
  assert.match(batchAdd, /<ColorEditor value=\{form\.colors\}/)
  assert.match(selector, /aria-pressed=\{selected\.has\(color\.name\)\}/)
  assert.match(selector, /Selected colors/)
  assert.match(selector, /color-editor-family-grid/)
})

test('wardrobe and link-pieces retrieval use family and exact shade state separately', () => {
  const inventory = read('../src/views/PieceInventory.jsx')
  const lookbook = read('../src/views/OutfitLookbook.jsx')

  assert.match(inventory, /searchParams\.get\('color_family'\)/)
  assert.match(inventory, /params\.set\('color_family', filterColorFamily\)/)
  assert.match(inventory, /<ColorFamilyFilter/)
  assert.match(lookbook, /<ColorFamilyFilter/)
  assert.match(lookbook, /filterColorFamily/)
  assert.match(lookbook, /const \[selected, setSelected\]/)
  assert.match(lookbook, /role="dialog"/)
  assert.match(lookbook, /aria-modal="true"/)
  assert.match(lookbook, /event\.key === 'Escape'/)
  assert.match(lookbook, /aria-pressed=\{isSelected\}/)
  assert.match(lookbook, /collapsible/)
})
