#!/usr/bin/env node

// Provider-free diagnostic for the single-outfit flow's three-layer capability. It copies the
// supplied database, asks the real single-outfit search for the hard-eligible catalog, and then
// measures whether an owned primary top + middle layer + outer layer can cover an exact 60->48F
// exposure when the corresponding two-layer system cannot. No provider or paid API is called.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dbIndex = process.argv.indexOf('--db')
const sourceDb = dbIndex >= 0 ? process.argv[dbIndex + 1] : ''
if (!sourceDb) {
  console.error('usage: node scratch/diagnose_single_outfit_layering.mjs --db <wardrobe.db>')
  process.exit(2)
}

const sourcePath = path.resolve(sourceDb)
if (!fs.existsSync(sourcePath)) {
  console.error(`database does not exist: ${sourcePath}`)
  process.exit(2)
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-single-outfit-layering-'))
const diagnosticDb = path.join(tmpDir, 'wardrobe.db')
fs.copyFileSync(sourcePath, diagnosticDb)
for (const suffix of ['-wal', '-shm']) {
  if (fs.existsSync(sourcePath + suffix)) fs.copyFileSync(sourcePath + suffix, diagnosticDb + suffix)
}
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = diagnosticDb
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpDir, 'uploads')

const [{ db, parsePiece }, { executeTool }, { evaluateLayerPairConstruction },
  { outfitRangeCoverage }, { requiredThermalEndpointBands, compareThermalFit },
  { resolveExposureContext }, { garmentWarmthLevel }] = await Promise.all([
  import('../db.js'),
  import('../styling-engine/tools.js'),
  import('../styling-engine/outfitValidation.js'),
  import('../styling-engine/outfitThermalContribution.js'),
  import('../styling-engine/thermalDemand.js'),
  import('../styling-engine/exposure.js'),
  import('../styling-engine/garmentWarmth.js'),
])

const userWeather = { high_f: 60, low_f: 48, precipitation: 'none', wind: 'breezy' }
const context = {
  executionProfile: 'single_outfit',
  declaredIntent: { want: 'cards', outfitCount: 1, layerRequirement: 'required' },
  request: 'One city outfit with a removable layer for an exact 60 to 48 degree outdoor exposure.',
  userWeather,
  freeformDiagnostics: {},
}

function thermalResult(pieces, endpoints, removedPieceId) {
  const coverage = outfitRangeCoverage(pieces, endpoints.cold, endpoints.warm, compareThermalFit)
  const removal = coverage.candidates.find(candidate => Number(candidate.removedPieceId) === Number(removedPieceId))
  return {
    cold: coverage.candidates[0]?.coldEnd?.fit || null,
    warmAfterOuterRemoval: removal?.warmEnd?.fit || null,
    contribution: coverage.full.withLayer,
  }
}

try {
  await executeTool('search_wardrobe', {
    category: ['top', 'bottom', 'dress', 'shoes', 'outerwear', 'accessory'],
    occasion: 'city',
    activity: 'none',
    user_weather: userWeather,
    intent: 'compose',
    visual: false,
  }, context)

  const eligible = context.singleOutfitCatalogEligibleIds instanceof Set
    ? context.singleOutfitCatalogEligibleIds
    : new Set(context.singleOutfitCatalogEligibleIds || [])
  const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all()
    .map(parsePiece)
    .filter(piece => eligible.has(Number(piece.id)))
  const tops = pieces.filter(piece => piece.category === 'top')
  // Diagnostic-only name split: production deliberately has no middle-vs-outer garment-kind
  // field. This keeps obvious coats out of the middle position and obvious cardigans/vests out of
  // the outermost position while measuring the missing structured distinction itself.
  const middleLayers = pieces.filter(piece => piece.category === 'outerwear' && /\b(?:cardigan|vest|fleece|shrug)\b/i.test(piece.name || ''))
  const outerLayers = pieces.filter(piece => piece.category === 'outerwear' && !/\b(?:cardigan|vest|shrug)\b/i.test(piece.name || ''))
  const exposure = resolveExposureContext(
    { activity: 'none', environment: 'outdoor' },
    { temperature: { highF: 60, lowF: 48, source: 'stated_user' }, wind: { value: 'breezy' } },
  )
  const endpoints = requiredThermalEndpointBands(exposure)
  const hardGateViable = []
  const oneRemovalViable = []
  const rejectedModerateStacks = []

  for (const top of tops) {
    for (const middle of middleLayers) {
      for (const outer of outerLayers) {
        if (Number(middle.id) === Number(outer.id)) continue
        const rolePieces = [
          { ...top, role: 'primary_top' },
          { ...middle, role: 'layer_top' },
          { ...outer, role: 'outerwear' },
        ]
        if (evaluateLayerPairConstruction(rolePieces, { roleAware: true }).verdict !== 'compatible') continue

        const withoutMiddle = thermalResult([
          { ...top, role: 'primary_top' },
          { ...outer, role: 'outerwear' },
        ], endpoints, outer.id)
        const withMiddle = thermalResult(rolePieces, endpoints, outer.id)
        const row = { top, middle, outer, withoutMiddle, withMiddle }
        if ([top, middle, outer].every(piece => garmentWarmthLevel(piece) === 'moderate') &&
            withoutMiddle.cold === 'undershoot' && withMiddle.cold === 'undershoot') {
          rejectedModerateStacks.push(row)
        }
        if (withoutMiddle.cold !== 'undershoot' || withMiddle.cold === 'undershoot') continue
        // This mirrors the shipped hard gate: warm-end overshoot is advisory, while undershoot is
        // the only range-coverage error.
        if (withMiddle.warmAfterOuterRemoval !== 'undershoot') hardGateViable.push(row)
        if (withMiddle.warmAfterOuterRemoval === 'adequate') oneRemovalViable.push(row)

      }
    }
  }

  const distinctMiddles = new Set(oneRemovalViable.map(row => Number(row.middle.id)))
  const distinctOuters = new Set(oneRemovalViable.map(row => Number(row.outer.id)))
  const distinctTops = new Set(oneRemovalViable.map(row => Number(row.top.id)))
  console.log('Single-outfit multi-layer diagnostic · exact 60->48F, dry/breezy, activity none')
  console.log(`source database (not mutated): ${sourcePath}`)
  console.log(`eligible garments: ${pieces.length}`)
  console.log(`systems where a middle layer changes cold fit from undershoot to adequate and passes today's hard gate: ${hardGateViable.length}`)
  console.log(`systems exactly comfortable at 60 after removing the outermost layer: ${oneRemovalViable.length}`)
  console.log(`known construction-compatible moderate top + moderate middle + moderate outer stacks still rejected at 48: ${rejectedModerateStacks.length}`)
  console.log(`passing systems use distinct primary tops: ${distinctTops.size}; middle layers: ${distinctMiddles.size}; outer layers: ${distinctOuters.size}`)
  console.log(`cold demand: ${endpoints.cold.level}; warm demand: ${endpoints.warm.level}`)
  console.log('\nFirst 30 systems:')
  for (const row of oneRemovalViable.slice(0, 30)) {
    console.log([
      `${row.top.id} ${row.top.name} (${garmentWarmthLevel(row.top)})`,
      `${row.middle.id} ${row.middle.name} (${garmentWarmthLevel(row.middle)})`,
      `${row.outer.id} ${row.outer.name} (${garmentWarmthLevel(row.outer)})`,
      `full=${row.withMiddle.contribution}`,
      `after outer off=${row.withMiddle.warmAfterOuterRemoval}`,
    ].join(' | '))
  }
  console.log('\nFirst 30 rejected moderate stacks (the disputed physical-adequacy zone):')
  for (const row of rejectedModerateStacks.slice(0, 30)) {
    console.log([
      `${row.top.id} ${row.top.name}`,
      `${row.middle.id} ${row.middle.name}`,
      `${row.outer.id} ${row.outer.name}`,
      `full=${row.withMiddle.contribution}`,
    ].join(' | '))
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}
