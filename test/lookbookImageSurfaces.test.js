import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/views/OutfitLookbook.jsx', import.meta.url), 'utf8')

test('large Lookbook cards and detail views use the retina-ready display derivative', () => {
  assert.equal((source.match(/lookbook-display/g) || []).length, 5)
  assert.doesNotMatch(source, /resolveUploadThumbnailSrc\([^\n]+, 'outfit-grid'\)/)
})

test('linked-piece selectors retain their smaller dedicated derivative', () => {
  assert.match(source, /resolveUploadThumbnailSrc\(piece\.photo, 'outfit-piece'\)/)
})
