import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import {
  cachedThumbnailUrl,
  cachedThumbnailUrlForUpload,
  ensureCachedThumbnail,
  ensureSubjectThumbnail,
  sourcePathFromCachedThumbnail,
  sourceFilenameFromSubjectThumbnail,
  subjectThumbnailUrl
} from '../lib/subjectThumbnails.js'

test('subject thumbnails are small cached WebP derivatives', async () => {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-subject-thumb-'))
  const sourceName = 'large-source.jpg'
  const sourcePath = path.join(uploadsDir, sourceName)
  await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#7c6a58' } })
    .jpeg({ quality: 95 })
    .toFile(sourcePath)

  const thumbnailPath = await ensureSubjectThumbnail(sourceName, uploadsDir)
  const metadata = await sharp(thumbnailPath).metadata()
  assert.equal(metadata.format, 'webp')
  assert.equal(metadata.width, 128)
  assert.equal(metadata.height, 96)
  assert.ok(fs.statSync(thumbnailPath).size < fs.statSync(sourcePath).size)

  const firstMtime = fs.statSync(thumbnailPath).mtimeMs
  const cachedPath = await ensureSubjectThumbnail(sourceName, uploadsDir)
  assert.equal(cachedPath, thumbnailPath)
  assert.equal(fs.statSync(thumbnailPath).mtimeMs, firstMtime)
})

test('subject thumbnail URLs round-trip safe source filenames', () => {
  assert.equal(subjectThumbnailUrl('piece photo.jpg'), '/uploads/.thumbnails/subject/piece%20photo.jpg.webp')
  assert.equal(sourceFilenameFromSubjectThumbnail('piece photo.jpg.webp'), 'piece photo.jpg')
  assert.equal(subjectThumbnailUrl('../secret.jpg'), '')
  assert.equal(sourceFilenameFromSubjectThumbnail('../secret.jpg.webp'), '')
})

test('relationship thumbnails support nested generated-board paths', async () => {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-board-thumb-'))
  const sourceName = path.join('generated-boards', 'comparison.png')
  const sourcePath = path.join(uploadsDir, sourceName)
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true })
  await sharp({ create: { width: 1024, height: 1776, channels: 3, background: '#d8cec0' } })
    .png()
    .toFile(sourcePath)

  const thumbnailPath = await ensureCachedThumbnail(sourceName, uploadsDir, 'relationship-board')
  const metadata = await sharp(thumbnailPath).metadata()
  assert.equal(metadata.format, 'webp')
  assert.equal(metadata.width, 248)
  assert.equal(metadata.height, 308)
  assert.equal(
    cachedThumbnailUrlForUpload('/uploads/generated-boards/comparison.png', 'relationship-board'),
    '/uploads/.thumbnails/relationship-board/generated-boards/comparison.png.webp'
  )
  assert.equal(
    sourcePathFromCachedThumbnail('generated-boards/comparison.png.webp'),
    'generated-boards/comparison.png'
  )
  assert.equal(cachedThumbnailUrl('../comparison.png', 'relationship-board'), '')
})

test('chat garment and inline variants preserve the whole image without enlarging it', async () => {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-chat-thumb-'))
  const sourceName = 'portrait.jpg'
  await sharp({ create: { width: 600, height: 1200, channels: 3, background: '#6f6257' } })
    .jpeg({ quality: 95 })
    .toFile(path.join(uploadsDir, sourceName))

  const garment = await sharp(await ensureCachedThumbnail(sourceName, uploadsDir, 'chat-garment')).metadata()
  const inline = await sharp(await ensureCachedThumbnail(sourceName, uploadsDir, 'chat-inline')).metadata()
  assert.deepEqual([garment.width, garment.height], [80, 160])
  assert.deepEqual([inline.width, inline.height], [160, 320])
})

test('outfit page variants preserve portrait proportions at their display budgets', async () => {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-outfit-thumb-'))
  const sourceName = 'outfit.jpg'
  await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#817164' } })
    .jpeg({ quality: 95 })
    .toFile(path.join(uploadsDir, sourceName))

  const piece = await sharp(await ensureCachedThumbnail(sourceName, uploadsDir, 'outfit-piece')).metadata()
  const grid = await sharp(await ensureCachedThumbnail(sourceName, uploadsDir, 'outfit-grid')).metadata()
  const preview = await sharp(await ensureCachedThumbnail(sourceName, uploadsDir, 'outfit-preview')).metadata()
  assert.deepEqual([piece.width, piece.height], [281, 375])
  assert.deepEqual([grid.width, grid.height], [480, 640])
  assert.deepEqual([preview.width, preview.height], [720, 960])
})

test('garment display variant is retina-ready for the desktop wardrobe grid', async () => {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-garment-display-'))
  const sourceName = 'garment.jpg'
  await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#75695e' } })
    .jpeg({ quality: 95 })
    .toFile(path.join(uploadsDir, sourceName))

  const display = await sharp(await ensureCachedThumbnail(sourceName, uploadsDir, 'garment-display')).metadata()
  assert.deepEqual([display.width, display.height], [720, 960])
})

test('lookbook display variant covers three-column retina cards and detail views', async () => {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-lookbook-display-'))
  const sourceName = 'look.jpg'
  await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#6f6258' } })
    .jpeg({ quality: 95 })
    .toFile(path.join(uploadsDir, sourceName))

  const display = await sharp(await ensureCachedThumbnail(sourceName, uploadsDir, 'lookbook-display')).metadata()
  assert.deepEqual([display.width, display.height], [900, 1200])
})

test('visual reference variant provides a square retina card crop', async () => {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-visual-reference-'))
  const sourceName = 'reference.jpg'
  await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#76685c' } })
    .jpeg({ quality: 95 })
    .toFile(path.join(uploadsDir, sourceName))

  const display = await sharp(await ensureCachedThumbnail(sourceName, uploadsDir, 'visual-reference')).metadata()
  assert.deepEqual([display.width, display.height], [480, 480])
})

test('desktop chat variants preserve enough pixels for boards and portrait attachments', async () => {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-chat-display-'))
  const sourceName = 'portrait.jpg'
  await sharp({ create: { width: 800, height: 1600, channels: 3, background: '#70645a' } })
    .jpeg({ quality: 95 })
    .toFile(path.join(uploadsDir, sourceName))

  const board = await sharp(await ensureCachedThumbnail(sourceName, uploadsDir, 'chat-display')).metadata()
  const attachment = await sharp(await ensureCachedThumbnail(sourceName, uploadsDir, 'chat-attachment')).metadata()
  assert.deepEqual([board.width, board.height], [480, 960])
  assert.deepEqual([attachment.width, attachment.height], [280, 560])
})
