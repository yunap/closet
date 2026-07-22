import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/StylistChat.jsx', import.meta.url), 'utf8')

test('piece and outfit handoffs are available on the first render', () => {
  assert.match(source, /initialOutfit\?\.autoSend === true \? null : \(initialOutfit \|\| null\)/)
  assert.match(source, /useState\(\(\) => initialPiece \|\| null\)/)
})

test('stylist landing hero images use compact high-priority derivatives', () => {
  assert.match(source, /alt=\{pendingPiece\.name\} decoding="async" fetchPriority="high"/)
  assert.match(source, /alt=\{pendingOutfit\.name\} decoding="async" fetchPriority="high"/)
  assert.equal((source.match(/resolveUploadThumbnailSrc\(pendingPhotoSrc, 'outfit-piece'\)/g) || []).length, 2)
})
