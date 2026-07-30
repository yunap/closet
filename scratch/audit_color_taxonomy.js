#!/usr/bin/env node

// Read-only, provider-free audit of stored color values and likely candidates
// for shades the old tagger vocabulary could not express. This script opens
// SQLite in readonly mode and never imports db.js, so it cannot run migrations
// or create WAL files beside the owner's database.

import Database from 'better-sqlite3'
import path from 'node:path'
import {
  COLOR_NAMES,
  normalizeColorName,
  unknownColorNames,
} from '../lib/colorTaxonomy.js'

const dbArgIndex = process.argv.indexOf('--db')
const dbPath = path.resolve(dbArgIndex >= 0 ? process.argv[dbArgIndex + 1] : 'wardrobe.db')
const db = new Database(dbPath, { readonly: true, fileMustExist: true })
const pieces = db.prepare(`
  SELECT id, name, colors, notes, reads_as, background_color
  FROM pieces
  WHERE status = 'active'
  ORDER BY id
`).all()

const parseColors = value => {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.map(normalizeColorName).filter(Boolean) : []
  } catch {
    return []
  }
}

const storedColors = pieces.flatMap(piece => parseColors(piece.colors))
const unknowns = unknownColorNames(storedColors)
const targetShades = ['coral', 'gold', 'khaki', 'greige', 'camel']
const candidates = []

for (const piece of pieces) {
  const colors = parseColors(piece.colors)
  const text = [
    piece.name,
    piece.notes,
    piece.reads_as,
    piece.background_color,
  ].filter(Boolean).join(' ').toLowerCase()
  const signals = targetShades.filter(shade =>
    new RegExp(`\\b${shade.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(text)
  )
  if (signals.length) candidates.push({ id: piece.id, name: piece.name, colors, signals })
}

console.log(`database: ${dbPath}`)
console.log(`active pieces: ${pieces.length}`)
console.log(`canonical shades: ${COLOR_NAMES.length}`)
console.log(`stored distinct shades: ${new Set(storedColors).size}`)
console.log(`stored unknown shades: ${unknowns.length ? unknowns.join(', ') : 'none'}`)
console.log('')
console.log('new-shade candidates (metadata signal only; not a retag decision):')
if (!candidates.length) console.log('- none')
for (const piece of candidates) {
  console.log(`- ${piece.id} · ${piece.name} · stored:${piece.colors.join('/') || 'none'} · signal:${piece.signals.join('/')}`)
}

db.close()
