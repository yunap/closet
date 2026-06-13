process.env.NODE_ENV = 'test'
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

import test from 'node:test'
import assert from 'node:assert/strict'
import { executeTool } from '../styling-engine/tools.js'

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
  assert.ok(detailsScoped[0].text.includes('piece 106 is not available for Yuna\'s current request'), 'Should return refusal text')
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
        pieceIds: [106],
        pieces: [{ id: 106, name: 'black washed bootcut denim jeans', category: 'bottom' }],
        reason: 'mock reason',
        watchFor: 'mock watch'
      }],
      rejected: [],
      skip: '',
      saveableLearning: 'mock learning'
    }
  }

  try {
    const toolContext = { generatedOutfits: [] }
    const resWhole = await executeTool('generate_outfits', {
      occasion: 'casual',
      season: 'warm',
      limit: 2
    }, toolContext)

    assert.equal(resWhole.status, 'success')
    assert.equal(toolContext.source, 'whole_wardrobe')
    assert.ok(Array.isArray(toolContext.generatedOutfits))
    assert.ok(toolContext.generatedOutfits.length > 0)

    const toolContextPiece = { generatedOutfits: [] }
    const resPiece = await executeTool('generate_outfits', {
      occasion: 'casual',
      season: 'warm',
      piece_id: 106
    }, toolContextPiece)

    assert.equal(resPiece.status, 'success')
    assert.equal(toolContextPiece.source, 'selected_piece')
    assert.ok(Array.isArray(toolContextPiece.generatedOutfits))
    assert.ok(toolContextPiece.generatedOutfits.length > 0)
  } finally {
    delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  }
})
