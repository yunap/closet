// 2026-08-27 policy (thread_1787803856242, real-user test on the sleeve-taxonomy branch): local/
// deterministic logic may prepare, rank, filter, validate, or recover candidate space, but it may
// not supply a user-facing outfit recommendation unless a styling model actually selected/evaluated
// that outfit. A composer timeout previously fell back to buildLocalFallbackOutfitDirections()'s
// category-fill picks (no photo judgment, no layering awareness, no validation at all) and presented
// them with the same confident labeling as a real composition — that's how a shrug the model never
// saw got paired with a shirt in a "Signature / strongest direction" card. This file pins the fix
// for the two violations that census found:
//   1. The selected-item visual composer (routes/ai.js's composeSelectedPieceVisualWardrobeOutfits,
//      reached via generateOutfitsForPieceInternal) — a composer that returns nothing must surface
//      an explicit `compositionSkipped: 'composer_failed'` state, never a local substitute.
//   2. composeStructuredOutfitsForPiece's closet-only branch (styling-engine/core.js) — used to blend
//      real model outfits with buildLocalFallbackOutfitDirections() output via mergeOutfitDirections
//      up to a minCount of 4, and fell back to a raw local outfit when the model returned nothing.
//      mergeOutfitDirections is now deleted entirely; the branch shows exactly what the model
//      produced, nothing padded in.
// Both regressions guard against a future "helpful fallback" silently reintroducing heuristic
// outfits into user-facing recommendation UI.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'selected-piece-no-fallback-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { generateOutfitsForPieceInternal } = await import('../routes/ai.js')
const { composeStructuredOutfitsForPiece } = await import('../styling-engine/core.js')
const { db, parsePiece } = await import('../db.js')
const { ensureFixturePieces } = await import('./helpers/dbFixtures.js')

// Same fixture shape as test/agent_tool_scoping.test.js: a selected bottom plus enough top/shoes
// candidates that the composer's candidate-supply check passes and the mock response is the only
// thing standing between "nothing" and "a complete outfit."
const cleanupFixtures = ensureFixturePieces([
  { id: 106, name: 'black washed bootcut denim jeans', category: 'bottom', status: 'active', occasions: '["casual"]', fabric_weight: 'medium', fabric_category: 'denim', reads_as: 'denim jeans', formality: 'everyday', photo: 'fixture-106.jpg' },
  { id: 700501, name: 'rust cotton crew tee', category: 'top', status: 'active', occasions: '["casual"]', colors: '["rust"]', fabric_weight: 'light', formality: 'everyday', photo: 'fixture-700501.jpg' },
  { id: 700502, name: 'white leather sneakers', category: 'shoes', status: 'active', occasions: '["casual"]', heel_height: 'flat', walk_support: 'high', formality: 'everyday', photo: 'fixture-700502.jpg' },
  { id: 700503, name: 'navy linen shirt', category: 'top', status: 'active', occasions: '["casual"]', colors: '["navy"]', fabric_weight: 'light', formality: 'everyday', photo: 'fixture-700503.jpg' },
  { id: 700504, name: 'tan leather loafers', category: 'shoes', status: 'active', occasions: '["casual"]', heel_height: 'flat', walk_support: 'high', formality: 'everyday', photo: 'fixture-700504.jpg' },
  // Sleeve-construction regression fixtures: a voluminous-sleeve dress plus two cardigan-worded tops
  // (the "cardigan" wording gives pieceHasExplicitTopLayerEvidence a direction signal, so the
  // top-over-dress pair resolves deterministically even without role-aware layering). The narrow
  // cardigan has zero capacity for the dress's voluminous inner sleeve (a real conflict); the roomy
  // one does not.
  { id: 700601, name: 'voluminous-sleeve wrap dress', category: 'dress', status: 'active', occasions: '["casual"]', colors: '["black"]', fabric_weight: 'light', formality: 'everyday', photo: 'fixture-700601.jpg', sleeve_length: 'long', sleeve_shape: 'voluminous' },
  { id: 700602, name: 'structured cardigan layer', category: 'top', status: 'active', occasions: '["casual"]', colors: '["cream"]', fabric_weight: 'light', formality: 'everyday', photo: 'fixture-700602.jpg', sleeve_length: 'long', sleeve_shape: 'fitted' },
  { id: 700603, name: 'roomy cardigan layer', category: 'top', status: 'active', occasions: '["casual"]', colors: '["oatmeal"]', fabric_weight: 'light', formality: 'everyday', photo: 'fixture-700603.jpg', sleeve_length: 'long', sleeve_shape: 'voluminous' },
])
test.after(() => {
  cleanupFixtures()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

test('visual composer path: a composer that returns nothing surfaces an explicit failure state, never a local heuristic substitute', async () => {
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = () => ({ outfits: [] })
  try {
    const result = await generateOutfitsForPieceInternal({
      pieceId: 106,
      occasion: 'casual',
      season: 'warm',
    })
    assert.deepEqual(result.structuredOutfits, [], 'no heuristic outfit may be silently substituted for a failed composer response')
    assert.equal(result.compositionSkipped, 'composer_failed')
    assert.equal(result.debug.compositionSkipped, 'composer_failed')
    assert.match(result.feedback, /didn.t return any outfit ideas|Try again/i)
    // Every remaining card (there should be none) would still need to carry model provenance.
    assert.ok(result.structuredOutfits.every(o => o.result?.provenance?.composedBy === 'model'))
  } finally {
    delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  }
})

test('visual composer path: a genuinely composed, hard-valid outfit is still shown (the fix does not suppress real model output)', async () => {
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = () => ({
    outfits: [{
      label: 'Real composed look',
      strength: 'signature',
      pieceIds: [106, 700501, 700502],
      pieces: [
        { id: 106, name: 'black washed bootcut denim jeans', category: 'bottom' },
        { id: 700501, name: 'rust cotton crew tee', category: 'top' },
        { id: 700502, name: 'white leather sneakers', category: 'shoes' },
      ],
      reason: 'mock reason',
    }],
  })
  try {
    const result = await generateOutfitsForPieceInternal({
      pieceId: 106,
      occasion: 'casual',
      season: 'warm',
    })
    assert.equal(result.structuredOutfits.length, 1)
    assert.equal(result.compositionSkipped, null)
    assert.equal(result.structuredOutfits[0].result?.provenance?.composedBy, 'model')
  } finally {
    delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  }
})

test('composeStructuredOutfitsForPiece (closet-only branch): an empty model response returns no outfits and an explicit failure state, not a local fallback', async () => {
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = () => ({ outfits: [] })
  try {
    const selectedPiece = parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(106))
    const rankedCandidates = [700501, 700502].map(id => ({ piece: parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(id)), score: 1 }))

    const result = await composeStructuredOutfitsForPiece({
      selectedPiece,
      rankedCandidates,
      occasion: 'casual',
      season: 'warm',
      mission: 'mix',
      mood: '',
      question: 'Style this piece using my existing wardrobe.',
      idealMode: false,
      idealOnlyMode: false,
      memoryText: '',
    })

    assert.deepEqual(result.outfits, [], 'an empty model response must not be padded out by buildLocalFallbackOutfitDirections()')
    assert.equal(result.compositionSkipped, 'composer_failed')
  } finally {
    delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  }
})

test('composeStructuredOutfitsForPiece (closet-only branch): 2 real model outfits are shown as 2, never padded to minCount 4 with heuristic picks', async () => {
  const twoCompleteOutfits = {
    outfits: [
      { label: 'Real look one', strength: 'signature', pieceIds: [106, 700501, 700502], pieces: [{ id: 106, name: 'black washed bootcut denim jeans', category: 'bottom' }, { id: 700501, name: 'rust cotton crew tee', category: 'top' }, { id: 700502, name: 'white leather sneakers', category: 'shoes' }], reason: 'r1' },
      { label: 'Real look two', strength: 'usable', pieceIds: [106, 700503, 700504], pieces: [{ id: 106, name: 'black washed bootcut denim jeans', category: 'bottom' }, { id: 700503, name: 'navy linen shirt', category: 'top' }, { id: 700504, name: 'tan leather loafers', category: 'shoes' }], reason: 'r2' },
    ],
  }
  // The evaluator gate audits the composer's own output; echo it back unchanged so the two real
  // outfits survive both calls intact.
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = () => twoCompleteOutfits
  try {
    const selectedPiece = parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(106))
    const rankedCandidates = [700501, 700502, 700503, 700504].map(id => ({ piece: parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(id)), score: 1 }))

    const result = await composeStructuredOutfitsForPiece({
      selectedPiece,
      rankedCandidates,
      occasion: 'casual',
      season: 'warm',
      mission: 'mix',
      mood: '',
      question: 'Style this piece using my existing wardrobe.',
      idealMode: false,
      idealOnlyMode: false,
      memoryText: '',
    })

    assert.equal(result.outfits.length, 2, 'the model returned exactly 2 valid outfits; none may be silently added to reach a minimum count')
    assert.equal(result.compositionSkipped, null)
    assert.ok(result.outfits.every(o => !o.isFallback), 'mergeOutfitDirections\' isFallback tag must not appear — that helper is gone')
  } finally {
    delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  }
})

// 2026-08-27 follow-up: validateSelectedRecoveryOutfit() used to run only evaluateOutfitStructure +
// evaluateRequiredBaseLayers — a weaker parallel contract than the canonical evaluateWearableOutfit
// gate every other flow uses, missing layer direction and layer construction entirely. It's now a
// thin adapter around evaluateWearableOutfit(). This proves a model-composed outfit with a real
// sleeve-construction conflict (the same class of defect the sleeve-taxonomy work fixed elsewhere)
// is rejected in this closet-only selected-piece path too, not just in the visual composer path.
test('composeStructuredOutfitsForPiece (closet-only branch): a model-composed outfit that fails canonical layer construction is rejected, not just structure/base-layer checks', async () => {
  const conflictingLook = { label: 'Conflicting layered look', strength: 'signature', pieceIds: [700601, 700602, 700502], pieces: [{ id: 700601, name: 'voluminous-sleeve wrap dress', category: 'dress' }, { id: 700602, name: 'structured cardigan layer', category: 'top' }, { id: 700502, name: 'white leather sneakers', category: 'shoes' }], reason: 'r1' }
  const compatibleLook = { label: 'Compatible layered look', strength: 'usable', pieceIds: [700601, 700603, 700502], pieces: [{ id: 700601, name: 'voluminous-sleeve wrap dress', category: 'dress' }, { id: 700603, name: 'roomy cardigan layer', category: 'top' }, { id: 700502, name: 'white leather sneakers', category: 'shoes' }], reason: 'r2' }
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = () => ({ outfits: [conflictingLook, compatibleLook] })
  try {
    const selectedPiece = parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(700601))
    const rankedCandidates = [700602, 700603, 700502].map(id => ({ piece: parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(id)), score: 1 }))

    const result = await composeStructuredOutfitsForPiece({
      selectedPiece,
      rankedCandidates,
      occasion: 'casual',
      season: 'warm',
      mission: 'mix',
      mood: '',
      question: 'Style this piece using my existing wardrobe.',
      idealMode: false,
      idealOnlyMode: false,
      memoryText: '',
    })

    assert.equal(result.outfits.length, 1, 'only the sleeve-compatible look should survive')
    assert.equal(result.outfits[0].label, 'Compatible layered look')
    assert.ok(!result.outfits.some(o => o.label === 'Conflicting layered look'), 'the sleeve-construction conflict must be rejected, not merely deprioritized')
  } finally {
    delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  }
})
