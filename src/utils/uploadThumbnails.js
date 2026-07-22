export function uploadThumbnailSrc(value, variant) {
  const source = String(value || '').trim()
  if (!source || !variant) return source || null
  if (!source.startsWith('/uploads/') || source.startsWith('/uploads/.thumbnails/')) return source

  const relativeSource = source.slice('/uploads/'.length)
  return `/uploads/.thumbnails/${encodeURIComponent(variant)}/${relativeSource}.webp`
}
