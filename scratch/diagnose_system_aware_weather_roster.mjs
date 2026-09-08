#!/usr/bin/env node

// Provider-free, read-only-at-source diagnostic for docs/system-aware-weather-roster-spec.md.
// It copies the supplied database before importing the application DB module, so migrations and
// WAL pragmas can touch only the disposable copy. No provider or model function is called.

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
  console.error('usage: node scratch/diagnose_system_aware_weather_roster.mjs --db <wardrobe-copy.db> [--mode cold|hot]')
  process.exit(2)
}

const sourcePath = path.resolve(sourceDb)
if (!fs.existsSync(sourcePath)) {
  console.error(`database does not exist: ${sourcePath}`)
  process.exit(2)
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-system-roster-'))
const diagnosticDb = path.join(tmpDir, 'wardrobe.db')
fs.copyFileSync(sourcePath, diagnosticDb)
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = diagnosticDb

const { executeTool } = await import('../styling-engine/tools.js')
const userWeather = mode === 'cold' ? { high_f: 60, low_f: 48 } : { high_f: 95, low_f: 85 }
const layerRequirement = mode === 'cold' ? 'required' : 'unspecified'
const context = {
  executionProfile: 'single_outfit',
  declaredIntent: { want: 'cards', outfitCount: 1, layerRequirement },
  request: mode === 'cold'
    ? 'One sightseeing outfit with a removable layer for an outdoor 60 to 48 degree exposure.'
    : 'One sightseeing outfit for an outdoor 95 to 85 degree exposure.',
  userWeather,
  freeformDiagnostics: {},
}

try {
  const result = await executeTool('search_wardrobe', {
    category: ['top', 'bottom', 'dress', 'shoes', 'outerwear'],
    activity: 'walking',
    user_weather: userWeather,
    intent: 'compose',
    visual: false,
  }, context)
  if (!Array.isArray(result)) throw new Error('single-outfit search did not return a result array')
  const roster = result.find(item => item.system_roster)?.system_roster
  if (!roster) throw new Error('single-outfit search returned no system_roster block')
  const report = context.freeformDiagnostics.systemAwareWeatherRoster
  const byId = new Map(roster.eligible_piece_index.map(piece => [Number(piece.id), piece]))
  const outerwear = roster.eligible_piece_index.filter(piece => piece.category === 'outerwear')
  const groupedOuterwear = new Map()
  for (const piece of outerwear) {
    const key = `${piece.thermal || 'thermal unknown'} · insulation ${piece.insulating_layer} · construction degree ${piece.construction_thermal_degree ?? 'unknown'}`
    groupedOuterwear.set(key, [...(groupedOuterwear.get(key) || []), piece])
  }

  console.log(`System-aware weather roster diagnostic · ${mode}`)
  console.log(`source database (not mutated): ${sourcePath}`)
  console.log(`eligible pieces: ${report.eligible_piece_count}`)
  console.log(`logical candidate paths: ${report.candidate_path_count}`)
  console.log(`evaluated frontier paths: ${report.evaluated_path_count} (${report.path_enumeration_scope})`)
  console.log(`adaptive frontier by category: ${Object.entries(report.frontier_piece_ids)
    .map(([category, ids]) => `${category}=${ids.length}`)
    .join(', ')}`)
  console.log(`known feasible: ${report.known_feasible_path_count}; unknown: ${report.unknown_path_count}`)
  console.log('\nEligible outerwear by thermal/construction evidence:')
  for (const [group, pieces] of groupedOuterwear) {
    console.log(`  ${group}`)
    for (const piece of pieces) console.log(`    ${piece.id} · ${piece.name}`)
  }
  console.log('\nOuterwear identities retained in the adaptive construction frontier:')
  for (const id of report.frontier_piece_ids.outerwear) {
    console.log(`  ${id} · ${byId.get(Number(id))?.name || 'unknown'}`)
  }
  console.log('\nSelected complete visual paths:')
  for (const selected of report.selected_paths) {
    const names = selected.piece_ids.map(id => `${id} · ${byId.get(Number(id))?.name || 'unknown'}`)
    console.log(`  ${selected.path_id}: ${names.join(' | ')}`)
    console.log(`    ${selected.reason}; cold=${selected.thermal_disposition.cold}, warm=${selected.thermal_disposition.warm}`)
  }
  console.log('\nImage budget by category:')
  console.log(JSON.stringify(report.visual_images_by_category, null, 2))
  console.log(`\nIndexed alternatives not photographed: ${report.compact_index_ids_omitted_from_photographs.join(', ') || 'none'}`)
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}
