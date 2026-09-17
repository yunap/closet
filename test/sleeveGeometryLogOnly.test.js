// SLEEVE GEOMETRY IS LOG-ONLY (owner ruling 2026-09-14; docs/stage1-cause-matrix-2026-09-14.md §1, §10a).
// Sleeve shape and relative length cannot establish layering compatibility, and no field yet records sleeve
// structure or compressibility. The geometry verdict is therefore shadow evidence only, and every model-facing
// layering rule states one neutral sentence. Pins, using the real recorded facts under the fitted puffer 996866:
//   144 ruched turtleneck — wearable, not rejected;
//   184 voluminous patchwork knit — wearable, not rejected;
//   238 substantial floral knit cardigan — incompatible in reality, but ALSO not mechanically rejected.
// TEMPORARY FALSE-NEGATIVE TRADEOFF (recorded deliberately): 238 is not rejected until a sleeve construction
// dimension exists, because the only evidence available (shape tags) would also reject the wearable 144 and 184.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sleeve-log-only-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { evaluateWearableOutfit, layerConstructionPromptRule, NEUTRAL_SLEEVE_LAYERING_STATEMENT } = await import('../styling-engine/outfitValidation.js')
const { buildPrompts, PHYSICAL_WEARABILITY_REALISM_RULES } = await import('../styling-engine/prompts.js')

// Recorded facts as the owner's wardrobe holds them (frozen Stage 2 snapshot), roles as worn.
const PUFFER = { id: 996866, name: 'navy quilted puffer jacket with ribbed side panels', category: 'outerwear', role: 'outerwear', sleeve_length: 'long', sleeve_shape: 'straight', silhouette: 'fitted', fit_on_body: 'skims', fabric_weight: 'medium', stretch: 'minimal', length_hits_at: 'low_hip', fiber_content: ['polyester', 'nylon'], insulating_layer_materials: ['polyester'], interior_construction: 'full_lining', weather_protection: ['wind'] }
const T144 = { id: 144, name: 'black turtleneck', category: 'top', role: 'primary_top', sleeve_length: 'extra_long', sleeve_shape: 'gathered_ruched', silhouette: 'slim', fit_on_body: 'clings_stretchy', fabric_weight: 'medium', stretch: 'minimal', length_hits_at: 'hip', fiber_content: ['viscose', 'polyester'] }
const BASE266 = { id: 266, name: 'black cream stripe mock neck top', category: 'top', role: 'primary_top', sleeve_length: 'extra_long', sleeve_shape: 'straight', silhouette: 'relaxed', fit_on_body: 'skims', fabric_weight: 'light', length_hits_at: 'hip', fiber_content: ['cotton'] }
const K184 = { id: 184, name: 'patchwork knit buttoned top', category: 'outerwear', role: 'layer_top', sleeve_length: '3/4', sleeve_shape: 'voluminous', silhouette: 'relaxed', fit_on_body: 'hangs_straight', fabric_weight: 'medium', stretch: 'moderate', length_hits_at: 'low_hip', fiber_content: ['cotton', 'polyester'] }
const C238 = { id: 238, name: 'green floral knit cardigan', category: 'outerwear', role: 'layer_top', sleeve_length: 'extra_long', sleeve_shape: 'voluminous', silhouette: 'relaxed', fit_on_body: 'skims', fabric_weight: 'medium', length_hits_at: 'hip', fiber_content: ['cotton'] }
const BOTTOM = { id: 104, name: 'emerald green corduroy straight pants', category: 'bottom', role: 'primary_bottom', fabric_weight: 'medium', length_hits_at: 'full_length' }
const SHOES = { id: 996862, name: 'black wool lace-up sneakers', category: 'shoes', role: 'shoes', shoe_type: 'sneaker', walk_support: 'high' }
const COLD_WALK = { weatherProfile: { highF: 46, lowF: 46, weatherSource: 'stated_user', needsRemovableCoolLayer: true }, activity: 'walking', environment: 'outdoor' }

const CASES = [
  ['144 ruched turtleneck under the puffer (wearable)', [T144, BOTTOM, SHOES, PUFFER]],
  ['184 voluminous patchwork knit under the puffer (wearable)', [BASE266, K184, PUFFER, BOTTOM, SHOES]],
  ['238 substantial knit cardigan under the puffer (incompatible; temporary false negative)', [BASE266, C238, PUFFER, BOTTOM, SHOES]],
]

for (const [label, pieces] of CASES) {
  test(`LOG-ONLY SLEEVE GEOMETRY: ${label} is not rejected, and the geometry verdict survives only as shadow evidence`, () => {
    for (const options of [{ roleAware: true, includeLayerDirections: true }, { roleAware: true, includeLayerDirections: true, weatherContext: COLD_WALK }]) {
      const result = evaluateWearableOutfit(pieces, options)
      assert.ok(![...result.hardFindings, ...result.advisoryFindings].some(f => String(f.code).startsWith('layer_construction_')),
        `no sleeve-geometry hard or advisory finding: ${JSON.stringify([...result.hardFindings, ...result.advisoryFindings].map(f => f.code))}`)
      assert.ok(result.shadowFindings.some(f => f.code === 'layer_construction_sleeve_conflict'), 'the geometry verdict is still recorded as shadow evidence')
      assert.deepEqual(result.evidence.shadowStages, ['layer_construction'])
      if (options.weatherContext) {
        const configurations = result.stages.find(stage => stage.stage === 'environment')?.result?.evidence?.endpointFit?.configurations || []
        assert.ok(configurations.length > 0, 'the endpoint evaluation ran')
        assert.ok(configurations.every(c => c.valid !== false), 'no worn configuration is excluded by the sleeve-geometry verdict')
      }
    }
  })
}

test('LOG-ONLY SLEEVE GEOMETRY: every model-facing layering rule is the neutral sentence, never a categorical shape verdict', () => {
  const categorical = /is a conflict|cannot accommodate|no room to accommodate|narrow, structured outer sleeve|puff, gathered\/ruched, voluminous, or flared/
  assert.equal(layerConstructionPromptRule(), `- ${NEUTRAL_SLEEVE_LAYERING_STATEMENT}`)
  assert.ok(PHYSICAL_WEARABILITY_REALISM_RULES.includes(NEUTRAL_SLEEVE_LAYERING_STATEMENT))
  assert.doesNotMatch(PHYSICAL_WEARABILITY_REALISM_RULES, categorical)
  const prompts = buildPrompts({})
  for (const [key, text] of Object.entries(prompts)) {
    if (typeof text !== 'string') continue
    assert.doesNotMatch(text, categorical, `${key} carries no categorical sleeve rule`)
  }
  assert.ok(prompts.WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM.includes(NEUTRAL_SLEEVE_LAYERING_STATEMENT), 'the composer states the neutral sentence')
  const repair = Object.values(prompts).find(text => typeof text === 'string' && text.includes('repairing cards you composed'))
  assert.ok(repair && repair.includes(NEUTRAL_SLEEVE_LAYERING_STATEMENT), 'the missing-layer repair model states the neutral sentence')
})

// Gate and backfill: both pass candidate cards through locallyGateWholeWardrobeOutfits (backfill validates its local
// fill candidates with it), so a sleeve-geometry verdict must not reject or exclude any of the three pins.
const { locallyGateWholeWardrobeOutfits } = await import('../styling-engine/rules.js')
const catalogPiece = piece => ({ ...piece, occasions: ['casual'], status: 'active', formality: 'everyday', colors: ['black'], recommendation_status: 'trusted', fit_confidence: 'high', role_permission: 'auto' })
for (const [label, pieces] of CASES) {
  test(`LOG-ONLY SLEEVE GEOMETRY (gate and backfill): ${label} is not rejected or excluded for sleeve geometry`, () => {
    const candidatePieces = pieces.map(({ role, ...piece }) => catalogPiece(piece))
    const card = { label, pieceIds: pieces.map(p => p.id), pieces: pieces.map(p => ({ id: p.id, name: p.name, category: p.category, role: p.role })), reason: 'test', watchFor: '' }
    for (const mode of ['gate', 'advisor']) {
      const gated = locallyGateWholeWardrobeOutfits([card], 5, { mode, requireShoes: true, applyDiversity: false, candidatePieces, occasion: 'casual', activity: 'walking', weatherProfile: COLD_WALK.weatherProfile })
      assert.doesNotMatch(JSON.stringify(gated.rejected || []), /sleeve|layer_construction/i, `${mode}: no rejection reason mentions sleeves`)
      const outfit = (gated.outfits || []).find(o => o.label === label)
      if (outfit) assert.doesNotMatch(JSON.stringify(outfit.systemFlags || []), /sleeve|layer_construction/i, `${mode}: no sleeve flag`)
    }
  })
}
