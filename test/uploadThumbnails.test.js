import test from 'node:test'
import assert from 'node:assert/strict'

import { uploadThumbnailSrc } from '../src/utils/uploadThumbnails.js'

test('maps local upload URLs to persistent thumbnail variants', () => {
  assert.equal(
    uploadThumbnailSrc('/uploads/generated-boards/look.png', 'chat-board'),
    '/uploads/.thumbnails/chat-board/generated-boards/look.png.webp'
  )
})

test('leaves external, blob, and existing thumbnail URLs unchanged', () => {
  assert.equal(uploadThumbnailSrc('https://example.com/look.jpg', 'chat-inline'), 'https://example.com/look.jpg')
  assert.equal(uploadThumbnailSrc('blob:preview', 'chat-inline'), 'blob:preview')
  assert.equal(
    uploadThumbnailSrc('/uploads/.thumbnails/chat-inline/look.jpg.webp', 'chat-inline'),
    '/uploads/.thumbnails/chat-inline/look.jpg.webp'
  )
})

test('returns null for an empty image source', () => {
  assert.equal(uploadThumbnailSrc('', 'chat-inline'), null)
})
