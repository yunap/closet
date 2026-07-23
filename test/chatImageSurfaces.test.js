import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const chatSource = fs.readFileSync(new URL('../src/components/StylistChat.jsx', import.meta.url), 'utf8')
const railSource = fs.readFileSync(new URL('../src/components/ThreadRail.jsx', import.meta.url), 'utf8')
const stylistSource = fs.readFileSync(new URL('../src/components/StylistChat.jsx', import.meta.url), 'utf8')
const threadCacheSource = fs.readFileSync(new URL('../src/utils/chatThreadCache.js', import.meta.url), 'utf8')

test('live and saved chat boards use the large-desktop display derivative', () => {
  assert.equal((chatSource.match(/'chat-display'/g) || []).length, 6)
  assert.doesNotMatch(chatSource, /resolveUploadThumbnailSrc\([^\n]+, 'chat-board'\)/)
})

test('chat attachments and handoff panels use retina-sized derivatives', () => {
  assert.match(chatSource, /messageImageSrc, 'chat-attachment'/)
  assert.equal((chatSource.match(/pendingPhotoSrc, 'outfit-piece'/g) || []).length, 2)
})

test('history preloads the first subject thumbnails and leaves the remainder lazy', () => {
  assert.match(railSource, /SUBJECT_THUMB_PRELOAD_COUNT = 12/)
  assert.match(railSource, /new Image\(\)/)
  assert.match(railSource, /loading=\{prioritizeThumbnail \? 'eager' : 'lazy'\}/)
  assert.match(railSource, /fetchPriority=\{prioritizeThumbnail \? 'high' : 'auto'\}/)
})

test('saved chats prefetch detail payloads and warm only recent rendered images', () => {
  assert.match(railSource, /prefetchChatThread\(t\.id\)/)
  assert.match(stylistSource, /getCachedChatThread\(threadId\)/)
  assert.match(stylistSource, /loadChatThread\(threadId, \{ refresh: Boolean\(cachedThread\) \}\)/)
  assert.match(threadCacheSource, /WARM_IMAGE_COUNT = 6/)
  assert.match(threadCacheSource, /const openingAttachment = attachments\[0\]/)
  assert.match(threadCacheSource, /WARM_IMAGE_COUNT - \(openingAttachment \? 1 : 0\)/)
  assert.match(threadCacheSource, /threadRequests\.has\(key\)/)
})

test('opening context photos receive eager high-priority loading', () => {
  assert.match(stylistSource, /const prioritizeContextPhoto = visibleIndex < 2/)
  assert.match(stylistSource, /loading=\{prioritizeContextPhoto \? 'eager' : 'lazy'\}/)
  assert.match(stylistSource, /fetchPriority=\{prioritizeContextPhoto \? 'high' : 'auto'\}/)
})

test('large saved chats progressively reveal older messages and outfit results', () => {
  assert.match(stylistSource, /INITIAL_SAVED_MESSAGE_COUNT = 8/)
  assert.match(stylistSource, /INITIAL_SAVED_OUTFIT_COUNT = 4/)
  assert.match(stylistSource, /messages\.slice\(visibleMessageStart\)/)
  assert.match(stylistSource, /allOutfits\.slice\(0, INITIAL_SAVED_OUTFIT_COUNT\)/)
  assert.match(stylistSource, /Show \{Math\.min\(INITIAL_SAVED_MESSAGE_COUNT, visibleMessageStart\)\} earlier messages/)
})

test('chat keeps feedback on result cards and leaves memory management to Visual Lab', () => {
  assert.doesNotMatch(chatSource, /Feedback memory/)
  assert.doesNotMatch(chatSource, /loadLearningRows/)
  assert.match(chatSource, /saveStylistFeedback/)
  assert.match(chatSource, /GENERATED_BOARD_FEEDBACK_LABELS/)
})
