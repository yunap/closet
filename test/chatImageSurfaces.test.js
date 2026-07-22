import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const chatSource = fs.readFileSync(new URL('../src/components/StylistChat.jsx', import.meta.url), 'utf8')
const railSource = fs.readFileSync(new URL('../src/components/ThreadRail.jsx', import.meta.url), 'utf8')

test('live and saved chat boards use the large-desktop display derivative', () => {
  assert.equal((chatSource.match(/'chat-display'/g) || []).length, 6)
  assert.doesNotMatch(chatSource, /resolveUploadThumbnailSrc\([^\n]+, 'chat-board'\)/)
})

test('chat attachments and handoff panels use retina-sized derivatives', () => {
  assert.match(chatSource, /messageImageSrc, 'chat-attachment'/)
  assert.equal((chatSource.match(/pendingPhotoSrc, 'outfit-piece'/g) || []).length, 2)
})

test('history subject images remain lazy-loaded at their dedicated size', () => {
  assert.match(railSource, /loading="lazy" decoding="async"/)
})
