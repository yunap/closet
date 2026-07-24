import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const css = fs.readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
const inventory = fs.readFileSync(new URL('../src/views/PieceInventory.jsx', import.meta.url), 'utf8')

test('Wardrobe uses a comparison-friendly desktop visual index', () => {
  assert.match(
    css,
    /\.piece-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(250px,\s*1fr\)\)\s*!important;/,
  )
})

test('Wardrobe cards keep stable garment framing and readable working text', () => {
  assert.match(
    css,
    /\.piece-photo-stage\s*\{[\s\S]*?aspect-ratio:\s*4\/5;/,
  )
  assert.match(
    css,
    /\.piece-card-name\s*\{[\s\S]*?font-size:\s*var\(--type-body\);[\s\S]*?line-height:\s*1\.32;/,
  )
  assert.doesNotMatch(css, /\.piece-photo-stage\.is-portrait\s*\{/)
})

test('Wardrobe search is debounced without issuing an immediate duplicate fetch', () => {
  assert.match(inventory, /const \[debouncedSearch, setDebouncedSearch\] = useState\(search\)/)
  assert.match(inventory, /setTimeout\(\(\) => setDebouncedSearch\(search\), 300\)/)
  assert.doesNotMatch(inventory, /setTimeout\(fetchPieces/)
  assert.match(inventory, /piecesRequestRef\.current\.controller\?\.abort\(\)/)
  assert.match(inventory, /piecesRequestRef\.current\.id !== requestId/)
})

test('Wardrobe filtered empty states provide a complete recovery action', () => {
  assert.match(inventory, /filterFabric \|\| favOnly/)
  assert.match(inventory, /No matching pieces/)
  assert.match(inventory, /className="btn-secondary wardrobe-clear-empty"/)
  assert.match(inventory, /Clear filters/)
})

test('Wardrobe filters expose selected state and return focus after selection', () => {
  assert.match(inventory, /aria-pressed=\{filterCat === c\.value\}/)
  assert.match(inventory, /role="listbox"/)
  assert.match(inventory, /role="option"/)
  assert.match(inventory, /aria-selected=/)
  assert.match(inventory, /data-filter-trigger=/)
  assert.match(inventory, /requestAnimationFrame/)
  assert.match(inventory, /aria-label="Search fabrics"/)
})

test('Wardrobe usage sorts describe styling activity rather than real-world wear', () => {
  assert.match(inventory, /label: 'Recently styled'/)
  assert.match(inventory, /label: 'Most styled'/)
  assert.doesNotMatch(inventory, /label: 'Most worn'/)
})
