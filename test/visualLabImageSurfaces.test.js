import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/VisualLab.jsx', import.meta.url), 'utf8')

test('Visual Lab uses display-sized derivatives while full previews retain originals', () => {
  assert.match(source, /row\.thumbnail_url \|\| uploadThumbnailSrc\(row\.image_url, 'visual-reference'\)/)
  assert.match(source, /uploadThumbnailSrc\(board\.image_url, 'lookbook-display'\)/)
  assert.match(source, /uploadThumbnailSrc\(selectedBoard\.image_url, 'lookbook-display'\)/)
  assert.match(source, /setPreviewImage\(\{ src: row\.image_url/)
  assert.match(source, /setPreviewImage\(\{ src: selectedBoard\.image_url/)
})

test('Visual Lab defers off-screen grid decoding', () => {
  assert.match(source, /alt="Calibration" loading="lazy" decoding="async"/)
  assert.match(source, /alt=\{board\.title \|\| 'Saved board'\} loading="lazy" decoding="async"/)
})
