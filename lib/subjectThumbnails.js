import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const THUMB_SUFFIX = '.webp'
const THUMB_VARIANTS = {
  subject: { width: 128, height: 96, fit: 'cover' },
  'chat-inline': { width: 320, height: 320, fit: 'inside' },
  'chat-garment': { width: 160, height: 160, fit: 'inside' },
  'chat-board': { width: 360, height: 480, fit: 'inside' },
  'chat-display': { width: 720, height: 960, fit: 'inside' },
  'chat-attachment': { width: 400, height: 560, fit: 'inside' },
  'outfit-piece': { width: 300, height: 375, fit: 'inside' },
  'outfit-grid': { width: 480, height: 640, fit: 'inside' },
  'outfit-preview': { width: 720, height: 960, fit: 'inside' },
  'garment-display': { width: 720, height: 960, fit: 'inside' },
  'lookbook-display': { width: 900, height: 1200, fit: 'inside' },
  'visual-reference': { width: 480, height: 480, fit: 'cover' },
  'relationship-board': { width: 248, height: 308, fit: 'cover' },
  'relationship-outfit': { width: 180, height: 236, fit: 'inside' }
}

function safeRelativePath(filename) {
  const value = String(filename || '').replaceAll('\\', '/')
  if (!value || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) return ''
  return value
}

function thumbnailVariant(variant) {
  return THUMB_VARIANTS[variant] ? variant : ''
}

export function cachedThumbnailUrl(filename, variant) {
  const source = safeRelativePath(filename)
  const safeVariant = thumbnailVariant(variant)
  if (!source || !safeVariant) return ''
  const encodedSource = source.split('/').map(encodeURIComponent).join('/')
  return `/uploads/.thumbnails/${safeVariant}/${encodedSource}${THUMB_SUFFIX}`
}

export function cachedThumbnailUrlForUpload(imageUrl, variant) {
  const prefix = '/uploads/'
  if (!String(imageUrl || '').startsWith(prefix)) return ''
  return cachedThumbnailUrl(String(imageUrl).slice(prefix.length), variant)
}

export function subjectThumbnailUrl(filename) {
  return cachedThumbnailUrl(filename, 'subject')
}

export function sourcePathFromCachedThumbnail(thumbnailName) {
  const name = safeRelativePath(thumbnailName)
  if (!name.endsWith(THUMB_SUFFIX)) return ''
  return safeRelativePath(name.slice(0, -THUMB_SUFFIX.length))
}

export function sourceFilenameFromSubjectThumbnail(thumbnailName) {
  const source = sourcePathFromCachedThumbnail(thumbnailName)
  return source && !source.includes('/') ? source : ''
}

export async function ensureCachedThumbnail(filename, uploadsDir, variant) {
  const source = safeRelativePath(filename)
  const safeVariant = thumbnailVariant(variant)
  if (!source || !safeVariant) throw new Error('Invalid cached thumbnail request')
  const config = THUMB_VARIANTS[safeVariant]

  const sourcePath = path.join(uploadsDir, source)
  const targetPath = path.join(uploadsDir, '.thumbnails', safeVariant, `${source}${THUMB_SUFFIX}`)
  const targetDir = path.dirname(targetPath)
  const sourceStat = await fs.promises.stat(sourcePath)

  try {
    const targetStat = await fs.promises.stat(targetPath)
    if (targetStat.mtimeMs >= sourceStat.mtimeMs && targetStat.size > 0) return targetPath
  } catch {}

  await fs.promises.mkdir(targetDir, { recursive: true })
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp.webp`
  try {
    await sharp(sourcePath)
      .rotate()
      .resize({ ...config, position: 'centre', withoutEnlargement: true })
      .webp({ quality: 72 })
      .toFile(tempPath)
    await fs.promises.rename(tempPath, targetPath)
  } finally {
    await fs.promises.unlink(tempPath).catch(() => {})
  }
  return targetPath
}

export function ensureSubjectThumbnail(filename, uploadsDir) {
  return ensureCachedThumbnail(filename, uploadsDir, 'subject')
}
