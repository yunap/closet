import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-agent-scope-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { executeTool } = await import('../styling-engine/tools.js')
const { ensureFixturePieces } = await import('./helpers/dbFixtures.js')

// Keep these scoped-tool fixtures in an isolated DB. The IDs mirror historical
// local data, but the test must never touch the developer's real wardrobe.
const cleanupFixtures = ensureFixturePieces([
  { id: 106, name: 'black washed bootcut denim jeans', category: 'bottom', status: 'active', occasions: '["casual"]', fabric_weight: 'medium', fabric_category: 'denim', reads_as: 'denim jeans', formality: 'everyday', photo: 'fixture-106.jpg' },
  // Companion pieces so the whole-wardrobe composer has enough category
  // coverage to build a roster around piece 106 on an otherwise-empty DB.
  // The composer's roster gate requires a photo/worn_photo value to be set
  // (it does not need the file to actually exist on disk) and a formality
  // tag (the register-gate metadata-completeness check).
  { id: 700501, name: 'rust cotton crew tee', category: 'top', status: 'active', occasions: '["casual"]', colors: '["rust"]', fabric_weight: 'light', formality: 'everyday', photo: 'fixture-700501.jpg' },
  { id: 700502, name: 'white leather sneakers', category: 'shoes', status: 'active', occasions: '["casual"]', heel_height: 'flat', walk_support: 'high', formality: 'everyday', photo: 'fixture-700502.jpg' }
])
test.after(() => {
  cleanupFixtures()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

test('agent_tool_scoping: search_wardrobe is scoped by allowedPieceIds', async () => {
  // We expect denim pants ID 106 to be present in normal search, but hidden when scoped to not include it.
  
  // 1. Without toolContext (unfiltered)
  const allRes = await executeTool('search_wardrobe', { query: 'denim' })
  assert.ok(Array.isArray(allRes))
  const hasDenim = allRes.some(p => p.id === 106)
  assert.ok(hasDenim, 'Denim pants (ID 106) should be found in unfiltered search')

  // 2. With toolContext that does NOT contain 106
  const scopedRes = await executeTool('search_wardrobe', { query: 'denim' }, { allowedPieceIds: new Set([1, 2, 3]) })
  assert.ok(Array.isArray(scopedRes))
  const hasDenimScoped = scopedRes.some(p => p.id === 106)
  assert.ok(!hasDenimScoped, 'Denim pants (ID 106) should not be found when scoped out')
  
  // Should append a note pointing out the hidden pieces
  const hasNote = scopedRes.some(p => p.note && p.note.includes('pieces hidden'))
  assert.ok(hasNote, 'Result list must contain a note indicating hidden pieces')
})

test('agent_tool_scoping: get_garment_details returns refusal for unallowed piece IDs', async () => {
  // 1. Without toolContext (allowed)
  const detailsNormal = await executeTool('get_garment_details', { ids: [106] })
  assert.equal(detailsNormal.length, 1)
  assert.equal(detailsNormal[0].id, 106)
  assert.ok(detailsNormal[0].text && !detailsNormal[0].text.includes('is not available'), 'Normal details should load styling rules')

  // 2. With toolContext (refusal)
  const detailsScoped = await executeTool('get_garment_details', { ids: [106] }, { allowedPieceIds: new Set([1, 2, 3]) })
  assert.equal(detailsScoped.length, 1)
  assert.equal(detailsScoped[0].id, 106)
  assert.ok(detailsScoped[0].text.includes('piece 106 is not available for this request'), 'Should return refusal text')
  assert.ok(!detailsScoped[0].image, 'Should not load photo/image data for unallowed piece')
})

test('agent_tool_scoping: generate_outfits tool executes and populates toolContext', async () => {
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = () => {
    return {
      outfits: [{
        label: 'Mock outfit',
        strength: 'signature',
        dominantDirection: 'mock direction',
        silhouette: 'mock silhouette',
        bestFor: 'casual',
        // A complete, hard-valid outfit (top + bottom + shoes) — the 2026-08-27 no-silent-fallback
        // policy means an incomplete single-piece mock outfit is now correctly rejected rather than
        // silently padded out by a local heuristic, so this fixture must be genuinely wearable to
        // exercise the tool-wiring happy path this test is actually checking.
        pieceIds: [106, 700501, 700502],
        pieces: [
          { id: 106, name: 'black washed bootcut denim jeans', category: 'bottom' },
          { id: 700501, name: 'rust cotton crew tee', category: 'top' },
          { id: 700502, name: 'white leather sneakers', category: 'shoes' },
        ],
        reason: 'mock reason',
        watchFor: 'mock watch'
      }],
      rejected: [],
      skip: '',
      saveableLearning: 'mock learning'
    }
  }

  try {
    const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [] }
    const resWhole = await executeTool('generate_outfits', {
      occasion: 'casual',
      season: 'warm',
      limit: 2
    }, toolContext)

    assert.equal(resWhole.status, 'success')
    assert.equal(toolContext.source, 'whole_wardrobe')
    assert.equal(toolContext.activity, 'none')
    assert.ok(Array.isArray(toolContext.generatedOutfits))
    assert.ok(toolContext.generatedOutfits.length > 0)

    const toolContextPiece = { declaredIntent: { want: 'cards' }, generatedOutfits: [] }
    const resPiece = await executeTool('generate_outfits', {
      occasion: 'casual',
      season: 'warm',
      piece_id: 106
    }, toolContextPiece)

    assert.equal(resPiece.status, 'success')
    assert.equal(toolContextPiece.source, 'selected_piece')
    assert.equal(toolContextPiece.activity, 'none')
    assert.ok(Array.isArray(toolContextPiece.generatedOutfits))
    assert.ok(toolContextPiece.generatedOutfits.length > 0)

    const hikingContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [] }
    const resHiking = await executeTool('generate_outfits', {
      occasion: 'casual',
      season: 'warm',
      activity: 'hiking',
      piece_id: 106
    }, hikingContext)
    assert.equal(resHiking.status, 'success')
    assert.equal(hikingContext.activity, 'hiking')

    const carriedContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], activity: 'walking' }
    const resCarried = await executeTool('generate_outfits', {
      occasion: 'casual',
      season: 'warm',
      piece_id: 106
    }, carriedContext)
    assert.equal(resCarried.status, 'success')
    assert.equal(carriedContext.activity, 'walking')

    const clearedContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], activity: 'walking' }
    const resCleared = await executeTool('generate_outfits', {
      occasion: 'casual',
      season: 'warm',
      activity: 'none',
      piece_id: 106
    }, clearedContext)
    assert.equal(resCleared.status, 'success')
    assert.equal(clearedContext.activity, 'none')
  } finally {
    delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  }
})
