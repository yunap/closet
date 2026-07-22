import { uploadThumbnailSrc } from './uploadThumbnails.js'

const threadCache = new Map()
const threadRequests = new Map()
const WARM_IMAGE_COUNT = 6

function normalizeImageSrc(value) {
  const src = String(value || '').trim()
  if (!src) return ''
  if (/^(https?:\/\/|data:|blob:|\/uploads\/)/i.test(src)) return src
  if (src.startsWith('uploads/')) return `/${src}`
  if (src.startsWith('generated-boards/')) return `/uploads/${src}`
  if (src.startsWith('/generated-boards/')) return `/uploads${src}`
  return `/uploads/${src}`
}

function collectRenderedImages(thread) {
  const attachments = []
  const renderedImages = []
  const add = (collection, src, variant) => {
    const normalized = normalizeImageSrc(src)
    if (normalized) collection.push(uploadThumbnailSrc(normalized, variant))
  }

  for (const message of thread?.payload?.messages || []) {
    add(attachments, message?.imagePrev, 'chat-attachment')
    for (const board of message?.renderedBoards || []) add(renderedImages, board?.imageUrl || board?.image_url, 'chat-display')
  }
  for (const result of Object.values(thread?.payload?.boardResults || {})) {
    const boards = Array.isArray(result) ? result : (result?.boards || [])
    for (const board of boards) add(renderedImages, board?.imageUrl || board?.image_url, 'chat-display')
  }
  for (const result of Object.values(thread?.payload?.editorialVisualResults || {})) {
    for (const visual of [...(result?.boards || []), ...(result?.visuals || [])]) {
      add(renderedImages, visual?.imageUrl || visual?.image_url, 'chat-display')
    }
  }

  const openingAttachment = attachments[0]
  const remaining = [...new Set([...attachments.slice(1), ...renderedImages])]
    .filter(src => src !== openingAttachment)
    .slice(-(WARM_IMAGE_COUNT - (openingAttachment ? 1 : 0)))
  return openingAttachment ? [openingAttachment, ...remaining] : remaining
}

function warmRecentThreadImages(thread) {
  if (typeof Image === 'undefined') return
  collectRenderedImages(thread).forEach(src => {
    const image = new Image()
    image.decoding = 'async'
    image.src = src
  })
}

export function getCachedChatThread(threadId) {
  return threadCache.get(String(threadId)) || null
}

export function loadChatThread(threadId, { refresh = false } = {}) {
  const key = String(threadId || '')
  if (!key) return Promise.reject(new Error('Thread id is required'))
  if (threadRequests.has(key)) return threadRequests.get(key)
  if (!refresh && threadCache.has(key)) return Promise.resolve(threadCache.get(key))

  const request = fetch(`/api/chat-threads/${encodeURIComponent(key)}`)
    .then(async response => {
      if (!response.ok) throw new Error('This chat thread is no longer available')
      const thread = await response.json()
      threadCache.set(key, thread)
      warmRecentThreadImages(thread)
      return thread
    })
    .finally(() => threadRequests.delete(key))

  threadRequests.set(key, request)
  return request
}

export function prefetchChatThread(threadId) {
  loadChatThread(threadId).catch(() => {})
}
