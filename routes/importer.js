// Spec 31 Phase 1 — batch wardrobe import: ingest doors + classification.
// Ingest accepts loose images, ZIPs (Google Takeout structure recognized), and video
// files (closet walkthroughs). Videos are sampled to frames via ffmpeg — a binary
// dependency accepted by owner ruling; when ffmpeg is absent, videos are SKIPPED with
// a visible count and install hint, never silently (the no-silent-caps doctrine).
// Classification runs on the cheap model tier in batched contact sheets; every spend
// is accumulated on the session so the Phase 3 cost preflight can show real numbers.
import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { spawnSync } from 'child_process'
import sharp from 'sharp'
import AdmZip from 'adm-zip'
import { db, uploadsDir, safeJsonParse } from '../db.js'
import { askStylistWithUsage, estimateAiUsageCost, parseModelJson } from '../styling-engine/provider.js'
import { IMPORT_CLASSIFIER_SYSTEM } from '../styling-engine/prompts.js'

const router = express.Router()
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 500 * 1024 * 1024 } })

// Cheap tier for classify/cluster passes (spec 31 design principle 5). Haiku-class by
// default; env-overridable. Full-model tagging (Phase 3) uses the normal stylist model.
export const IMPORT_CHEAP_MODEL = process.env.WARDROBE_IMPORT_CHEAP_MODEL || 'claude-haiku-4-5'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.avi'])
const CLASSIFY_BATCH_SIZE = 10
// Blur proxy: grayscale stddev below this reads as a smeared/empty frame. Deliberately
// permissive — the classifier's "irrelevant" bucket is the real filter; this only drops
// frames that would waste classification spend on obvious smears.
const FRAME_MIN_STDDEV = 10

const ffmpegBin = () => process.env.WARDROBE_FFMPEG_BIN || 'ffmpeg'
export function ffmpegAvailable() {
  try {
    return spawnSync(ffmpegBin(), ['-version'], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

function sessionDir(sessionId) {
  const dir = path.join(uploadsDir, 'import', String(sessionId))
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function getSession(id) {
  return db.prepare('SELECT * FROM import_sessions WHERE id = ?').get(id)
}

function bumpCounts(sessionId, delta) {
  const row = getSession(sessionId)
  const counts = safeJsonParse(row?.counts_json, {}) || {}
  for (const [key, n] of Object.entries(delta)) counts[key] = (counts[key] || 0) + n
  db.prepare('UPDATE import_sessions SET counts_json = ? WHERE id = ?').run(JSON.stringify(counts), sessionId)
  return counts
}

function addSpend(sessionId, usage) {
  const est = estimateAiUsageCost(usage)
  if (est?.estimatedUsd) {
    db.prepare('UPDATE import_sessions SET spent_usd = spent_usd + ? WHERE id = ?').run(est.estimatedUsd, sessionId)
  }
}

// Normalize any ingested image to an oriented, bounded JPEG in the session dir.
async function storeImage(sessionId, buffer, origin, albumHint = '') {
  const dir = sessionDir(sessionId)
  const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`
  await sharp(buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 }).toFile(path.join(dir, name))
  db.prepare('INSERT INTO import_images (session_id, file, origin, album_hint) VALUES (?, ?, ?, ?)')
    .run(sessionId, name, origin, albumHint)
}

async function ingestZip(sessionId, zipPath, zipName, counts) {
  const zip = new AdmZip(zipPath)
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const entryExt = path.extname(entry.entryName).toLowerCase()
    const parts = entry.entryName.split('/')
    // Google Takeout: Takeout/Google Photos/<album>/<file>; sidecar .json files are
    // per-photo metadata — ignored by design (EXIF/album name are the only hints used).
    if (entryExt === '.json') { counts.metadataFilesIgnored++; continue }
    if (!IMAGE_EXTS.has(entryExt)) { counts.unsupportedSkipped++; continue }
    const albumHint = parts.length >= 2 ? parts[parts.length - 2] : ''
    try {
      await storeImage(sessionId, entry.getData(), `zip:${zipName}`, albumHint)
      counts.imagesIngested++
    } catch {
      counts.unreadableSkipped++
    }
  }
}

async function ingestVideo(sessionId, videoPath, videoName, counts) {
  if (!ffmpegAvailable()) {
    counts.videosSkippedNoFfmpeg++
    return
  }
  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-frames-'))
  const result = spawnSync(ffmpegBin(), [
    '-i', videoPath,
    '-vf', 'fps=1',
    '-q:v', '2',
    path.join(frameDir, 'frame-%04d.jpg')
  ], { stdio: 'ignore' })
  if (result.status !== 0) {
    counts.videosFailed++
    return
  }
  for (const frame of fs.readdirSync(frameDir).sort()) {
    const framePath = path.join(frameDir, frame)
    try {
      const stats = await sharp(framePath).greyscale().stats()
      if ((stats.channels?.[0]?.stdev ?? 0) < FRAME_MIN_STDDEV) {
        counts.blurryFramesDropped++
        continue
      }
      await storeImage(sessionId, fs.readFileSync(framePath), `video:${videoName}`)
      counts.framesSampled++
    } catch {
      counts.unreadableSkipped++
    }
  }
  fs.rmSync(frameDir, { recursive: true, force: true })
}

router.post('/sessions', (req, res) => {
  try {
    const info = db.prepare("INSERT INTO import_sessions (status) VALUES ('ingesting')").run()
    res.json({ sessionId: info.lastInsertRowid, ffmpegAvailable: ffmpegAvailable() })
  } catch (err) {
    console.error('Import session create error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/sessions/:id/files', upload.array('files', 200), async (req, res) => {
  try {
    const session = getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Unknown import session' })
    const counts = {
      imagesIngested: 0, framesSampled: 0, metadataFilesIgnored: 0,
      unsupportedSkipped: 0, unreadableSkipped: 0, blurryFramesDropped: 0,
      videosSkippedNoFfmpeg: 0, videosFailed: 0
    }
    for (const file of req.files || []) {
      const ext = path.extname(file.originalname).toLowerCase()
      try {
        if (ext === '.zip') await ingestZip(session.id, file.path, file.originalname, counts)
        else if (VIDEO_EXTS.has(ext)) await ingestVideo(session.id, file.path, file.originalname, counts)
        else if (IMAGE_EXTS.has(ext)) {
          await storeImage(session.id, fs.readFileSync(file.path), 'upload')
          counts.imagesIngested++
        } else counts.unsupportedSkipped++
      } catch (err) {
        console.warn(`Import ingest failed for ${file.originalname}:`, err.message)
        counts.unreadableSkipped++
      } finally {
        fs.rmSync(file.path, { force: true })
      }
    }
    const totals = bumpCounts(session.id, counts)
    res.json({
      counts,
      totals,
      ...(counts.videosSkippedNoFfmpeg ? { ffmpegHint: 'Video files were skipped because ffmpeg is not installed. Install ffmpeg (e.g. `brew install ffmpeg`) and re-upload the videos — images imported normally.' } : {})
    })
  } catch (err) {
    console.error('Import ingest error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/sessions/:id/classify', async (req, res) => {
  try {
    const session = getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Unknown import session' })
    const pending = db.prepare("SELECT * FROM import_images WHERE session_id = ? AND kind IS NULL AND status = 'pending'").all(session.id)
    const dir = sessionDir(session.id)
    const markKind = db.prepare("UPDATE import_images SET kind = ?, status = 'classified' WHERE id = ?")
    let classified = 0
    let failedBatches = 0

    for (let start = 0; start < pending.length; start += CLASSIFY_BATCH_SIZE) {
      const batch = pending.slice(start, start + CLASSIFY_BATCH_SIZE)
      const content = [{ type: 'text', text: `Classify the following ${batch.length} numbered images.` }]
      for (let i = 0; i < batch.length; i++) {
        const thumb = await sharp(path.join(dir, batch[i].file)).resize({ width: 512, withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer()
        content.push({ type: 'text', text: `Image ${i + 1}:` })
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: thumb.toString('base64') } })
      }
      try {
        const { text, usage } = await askStylistWithUsage({
          system: IMPORT_CLASSIFIER_SYSTEM,
          messages: [{ role: 'user', content }],
          maxTokens: 800,
          model: IMPORT_CHEAP_MODEL
        })
        addSpend(session.id, usage)
        const parsed = parseModelJson(text, { context: 'import classification' })
        const byIndex = new Map((parsed?.classifications || []).map(c => [Number(c.index), String(c.kind || '')]))
        for (let i = 0; i < batch.length; i++) {
          const kind = byIndex.get(i + 1)
          markKind.run(['worn_outfit', 'garment_only', 'irrelevant'].includes(kind) ? kind : 'irrelevant', batch[i].id)
          classified++
        }
      } catch (err) {
        console.warn('Import classify batch failed:', err.message)
        failedBatches++
      }
    }

    const kinds = db.prepare("SELECT kind, COUNT(*) AS n FROM import_images WHERE session_id = ? AND kind IS NOT NULL GROUP BY kind").all(session.id)
    const kindCounts = Object.fromEntries(kinds.map(row => [row.kind, row.n]))
    if (!failedBatches) db.prepare("UPDATE import_sessions SET status = 'classified' WHERE id = ?").run(session.id)
    res.json({
      classified,
      failedBatches,
      kindCounts,
      spentUsd: getSession(session.id).spent_usd
    })
  } catch (err) {
    console.error('Import classify error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.get('/sessions/:id', (req, res) => {
  try {
    const session = getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Unknown import session' })
    const kinds = db.prepare('SELECT kind, COUNT(*) AS n FROM import_images WHERE session_id = ? GROUP BY kind').all(session.id)
    res.json({
      id: session.id,
      status: session.status,
      counts: safeJsonParse(session.counts_json, {}),
      kindCounts: Object.fromEntries(kinds.map(row => [row.kind ?? 'pending', row.n])),
      spentUsd: session.spent_usd,
      ffmpegAvailable: ffmpegAvailable()
    })
  } catch (err) {
    console.error('Import session read error:', err)
    res.status(500).json({ error: err.message })
  }
})

export default router
