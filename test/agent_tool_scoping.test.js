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
