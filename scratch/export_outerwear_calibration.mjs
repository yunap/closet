#!/usr/bin/env node
/**
 * Export a small outerwear calibration set for review.
 *
 * Usage:
 *   node scratch/export_outerwear_calibration.mjs 123 456 789
 *   node scratch/export_outerwear_calibration.mjs --db /path/to/wardrobe.db 123 456 789
 *
 * Output:
 *   scratch/outerwear-calibration/
 *     pieces.json
 *     piece-summary.txt
 *     images/
 *
 * Opens SQLite READ-ONLY and does not modify wardrobe data.
 */

import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'

import {
  garmentKind,
  thermalMaterialVerdict,
  pieceWeatherProtection,
  fabricWeight,
} from '../styling-engine/attributes.js'
import { pieceWeatherEvidence, pieceWeatherScores } from '../styling-engine/thermal.js'
import {
  warmthCalibrationEvidenceState,
  proposedWarmthLevel,
} from '../styling-engine/warmthCalibration.js'

const argv = process.argv.slice(2)
let dbPath = path.join(process.cwd(), 'wardrobe.db')
const ids = []

for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--db') {
    dbPath = path.resolve(argv[++i])
    continue
  }
  const id = Number(argv[i])
  if (!Number.isInteger(id) || id <= 0) {
    console.error(`Invalid piece id: ${argv[i]}`)
    process.exit(2)
  }
  ids.push(id)
}

if (!ids.length) {
  console.error('Usage: node scratch/export_outerwear_calibration.mjs [--db wardrobe.db] <piece-id> ...')
  process.exit(2)
}

const outDir = path.join(process.cwd(), 'scratch', 'outerwear-calibration')
const imageDir = path.join(outDir, 'images')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(imageDir, { recursive: true })

const db = new Database(dbPath, { readonly: true, fileMustExist: true })

const columns = db.prepare('PRAGMA table_info(pieces)').all().map(r => r.name)
const photoColumns = columns.filter(c => /photo|image/i.test(c))

const placeholders = ids.map(() => '?').join(',')
const rows = db.prepare(`SELECT * FROM pieces WHERE id IN (${placeholders})`).all(...ids)
const byId = new Map(rows.map(r => [Number(r.id), r]))
const missing = ids.filter(id => !byId.has(id))

if (missing.length) {
  console.error(`Missing piece id(s): ${missing.join(', ')}`)
  process.exit(1)
}

function parseStoredValue(value) {
  if (typeof value !== 'string') return value
  const s = value.trim()
  if (!(s.startsWith('[') || s.startsWith('{'))) return value
  try { return JSON.parse(s) } catch { return value }
}

function parseRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, parseStoredValue(v)])
  )
}

function resolveLocalPhoto(raw) {
  if (!raw || typeof raw !== 'string') return null
  const candidates = [
    raw,
    path.resolve(process.cwd(), raw),
    path.resolve(process.cwd(), 'public', raw.replace(/^\/+/, '')),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

function collectPhotoStrings(piece) {
  const found = []
  for (const col of photoColumns) {
    const value = piece[col]
    if (typeof value === 'string' && value.trim()) {
      const parsed = parseStoredValue(value)
      if (Array.isArray(parsed)) {
        for (const p of parsed) if (typeof p === 'string' && p.trim()) found.push({ column: col, value: p })
      } else {
        found.push({ column: col, value })
      }
    } else if (Array.isArray(value)) {
      for (const p of value) if (typeof p === 'string' && p.trim()) found.push({ column: col, value: p })
    }
  }
  return found
}

const exported = []
const summary = []

for (const id of ids) {
  const raw = byId.get(id)
  const piece = parseRow(raw)

  const derived = {
    garment_kind: garmentKind(piece),
    fabric_weight_normalized: fabricWeight(piece),
    thermal_material_verdict: thermalMaterialVerdict(piece),
    weather_protection_normalized: pieceWeatherProtection(piece),
    warmth_calibration_evidence_state: warmthCalibrationEvidenceState(piece),
    proposed_warmth_level: proposedWarmthLevel(piece),
    weather_evidence: pieceWeatherEvidence(piece),
    weather_scores: pieceWeatherScores(piece),
  }

  const photos = []
  for (const { column, value } of collectPhotoStrings(piece)) {
    const local = resolveLocalPhoto(value)
    let copiedTo = null
    if (local) {
      const ext = path.extname(local) || '.jpg'
      const safeCol = column.replace(/[^a-z0-9_-]+/gi, '_')
      const destName = `${id}-${safeCol}-${photos.length + 1}${ext}`
      const dest = path.join(imageDir, destName)
      fs.copyFileSync(local, dest)
      copiedTo = path.relative(outDir, dest)
    }
    photos.push({
      column,
      stored_value: value,
      resolved_local_path: local,
      copied_to: copiedTo,
    })
  }

  exported.push({
    id,
    name: piece.name,
    category: piece.category,
    current_piece: piece,
    current_engine_interpretation: derived,
    photos,
  })

  summary.push([
    `# ${id} — ${piece.name || '(unnamed)'}`,
    `category: ${piece.category ?? ''}`,
    `garment kind: ${derived.garment_kind ?? 'unknown'}`,
    `fabric_weight: ${piece.fabric_weight ?? 'unset'}`,
    `fiber_content: ${JSON.stringify(piece.fiber_content ?? null)}`,
    `fiber_content_completeness: ${piece.fiber_content_completeness ?? 'unset'}`,
    `insulating_layer_materials: ${JSON.stringify(piece.insulating_layer_materials ?? null)}`,
    `weather_protection: ${JSON.stringify(derived.weather_protection_normalized)}`,
    `thermal_material_verdict: ${derived.thermal_material_verdict}`,
    `warmth calibration: ${derived.warmth_calibration_evidence_state}`,
    `proposed warmth: ${derived.proposed_warmth_level ?? 'unknown'}`,
    `weather scores: ${JSON.stringify(derived.weather_scores)}`,
    `photos copied: ${photos.filter(p => p.copied_to).map(p => p.copied_to).join(', ') || 'none resolved'}`,
    '',
  ].join('\n'))
}

fs.writeFileSync(
  path.join(outDir, 'pieces.json'),
  JSON.stringify({
    generated_at: new Date().toISOString(),
    db_path: dbPath,
    requested_ids: ids,
    note: 'Read-only calibration export. No wardrobe data was modified.',
    pieces: exported,
  }, null, 2)
)

fs.writeFileSync(path.join(outDir, 'piece-summary.txt'), summary.join('\n'))

console.log(`Exported ${exported.length} piece(s) to:`)
console.log(`  ${outDir}`)
console.log('')
console.log('Send me:')
console.log('  - scratch/outerwear-calibration/pieces.json')
console.log('  - the images in scratch/outerwear-calibration/images/')
console.log('')
console.log('The script opened the DB read-only and made no changes.')
