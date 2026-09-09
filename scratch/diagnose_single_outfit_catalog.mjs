#!/usr/bin/env node

// Provider-free, read-only-at-source diagnostic for the one-outfit catalog recovery. It copies the
// supplied database and WAL sidecars before importing application code, then runs the real search
// tool against the disposable copy. No provider or model function is called.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function arg(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

const sourceDb = arg('--db')
const mode = arg('--mode') || 'cold'
if (!sourceDb || !['cold', 'hot'].includes(mode)) {
  console.error('usage: node scratch/diagnose_single_outfit_catalog.mjs --db <wardrobe.db> [--mode cold|hot]')
  process.exit(2)
}

const sourcePath = path.resolve(sourceDb)
if (!fs.existsSync(sourcePath)) {
  console.error(`database does not exist: ${sourcePath}`)
  process.exit(2)
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-single-outfit-catalog-'))
const diagnosticDb = path.join(tmpDir, 'wardrobe.db')
fs.copyFileSync(sourcePath, diagnosticDb)
for (const suffix of ['-wal', '-shm']) {
  if (fs.existsSync(sourcePath + suffix)) fs.copyFileSync(sourcePath + suffix, diagnosticDb + suffix)
}
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = diagnosticDb
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpDir, 'uploads')

const { executeTool } = await import('../styling-engine/tools.js')
const userWeather = mode === 'cold' ? { high_f: 60, low_f: 48, wind: 'breezy' } : { high_f: 95, low_f: 85 }
const layerRequirement = mode === 'cold' ? 'required' : 'unspecified'
const context = {
  executionProfile: 'single_outfit',
  declaredIntent: { want: 'cards', outfitCount: 1, layerRequirement },
  request: mode === 'cold'
    ? 'One gallery outfit for ordinary outdoor walking with a removable layer for 60 to 48 degrees and a breeze.'
    : 'One sightseeing outfit for ordinary outdoor walking at 95 to 85 degrees.',
  userWeather,
  freeformDiagnostics: {},
}

try {
  const result = await executeTool('search_wardrobe', {
    category: ['top', 'bottom', 'dress', 'shoes', 'outerwear', 'accessory'],
    occasion: 'city',
    activity: 'walking',
    user_weather: userWeather,
    intent: 'compose',
    visual: false,
  }, context)
  if (!Array.isArray(result)) throw new Error('single-outfit search did not return a result array')
  const catalog = result.find(item => item.stylist_catalog)?.stylist_catalog
  if (!catalog) throw new Error('single-outfit search returned no stylist_catalog block')

  console.log(`Single-outfit stylist catalog diagnostic · ${mode}`)
  console.log(`source database (not mutated): ${sourcePath}`)
  console.log(`eligible pieces: ${catalog.eligible_piece_count}`)
  console.log(`eligible by category: ${Object.entries(catalog.eligible_by_category).map(([key, count]) => `${key}=${count}`).join(', ')}`)
  console.log(`catalog text characters: ${catalog.serialized_character_count}`)
  console.log(`complete response characters: ${JSON.stringify(result).length}`)
  console.log(`legacy captured 208-row index characters: 54709`)
  console.log(`catalog reduction from captured index: ${54709 - catalog.serialized_character_count}`)
  console.log(`search-attached photographs: ${result.filter(item => item.image).length}`)
  console.log(`engine-selected outfit paths: ${result.some(item => item.system_roster) ? 'present (BUG)' : 'none'}`)
  console.log('\nHard-exclusion report:')
  console.log(JSON.stringify(catalog.exclusion_report, null, 2))
  console.log('\nCatalog:')
  console.log(catalog.catalog)
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}
