import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../db.js'
import { executeTool, bumpFreeformDiagnostic } from '../styling-engine/tools.js'
import { persistFreeformGenerationRun } from '../routes/ai.js'
import { findZeroResultContradiction, looksLikeUnproposedOutfitProse, looksLikeDestinationOrWeatherQuestion } from '../styling-engine/provider.js'

// Spec 3 (freeform observability): gate exclusions and propose_outfit validation outcomes must be
// inspectable, not anecdotal — the freeform-chat equivalent of the composer's excludedCounts debug.

test('bumpFreeformDiagnostic initializes and accumulates counters on toolContext', () => {
  const toolContext = {}
  bumpFreeformDiagnostic(toolContext, 'searchCalls')
  bumpFreeformDiagnostic(toolContext, 'gateExcludedTotal', 3)
  bumpFreeformDiagnostic(toolContext, 'searchCalls')
  assert.deepEqual(toolContext.freeformDiagnostics, {
    searchCalls: 2,
    gateExcludedTotal: 3,
    proposeCalls: 0,
    proposeValidationFails: 0,
    outfitProseWithoutToolCall: 0,
    zeroResultContradictionBlocks: 0,
    destinationClarificationRetries: 0,
    weatherSource: ''
  })
})

test('executeTool search_wardrobe records a search call and gate-exclusion count in toolContext.freeformDiagnostics', async () => {
  const heelId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json, heel_height, walk_support)
    VALUES ('observability test heel', 'shoes', '["black"]', '["casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'sharp heel', '', '', '', '[]', 'everyday', '', '{}', 'high', 'low')
  `).run().lastInsertRowid
  try {
    const toolContext = {}
    await executeTool('search_wardrobe', { category: 'shoes', occasion: 'casual', activity: 'hiking' }, toolContext)
    assert.ok(toolContext.freeformDiagnostics, 'freeformDiagnostics should be initialized')
    assert.equal(toolContext.freeformDiagnostics.searchCalls, 1)
    assert.ok(toolContext.freeformDiagnostics.gateExcludedTotal >= 1, 'the prohibited heel should count toward gate exclusions')
  } finally {
    db.prepare('DELETE FROM pieces WHERE id = ?').run(heelId)
  }
})

test('executeTool propose_outfit success increments proposeCalls', async () => {
  const topId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs top', 'top', '[]', '["casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', '', '', '', '', '[]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const bottomId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs bottom', 'bottom', '[]', '["casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', '', '', '', '', '[]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  try {
    const toolContext = { generatedOutfits: [] }
    const result = await executeTool('propose_outfit', {
      label: 'Obs outfit',
      pieces: [{ id: topId, role: 'primary_top' }, { id: bottomId, role: 'primary_bottom' }]
    }, toolContext)
    assert.equal(result.status, 'success')
    assert.equal(toolContext.freeformDiagnostics.proposeCalls, 1)
    assert.equal(toolContext.freeformDiagnostics.proposeValidationFails, 0)
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?)').run(topId, bottomId)
  }
})

test('executeTool propose_outfit validation failure pushes a visible broken diagnostic card and increments proposeValidationFails', async () => {
  const topId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs top 2', 'top', '[]', '["casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', '', '', '', '', '[]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const topId2 = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs top 3', 'top', '[]', '["casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', '', '', '', '', '[]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  try {
    const toolContext = { generatedOutfits: [] }
    const result = await executeTool('propose_outfit', {
      label: 'Collision outfit',
      pieces: [{ id: topId, role: 'primary_top' }, { id: topId2, role: 'primary_top' }]
    }, toolContext)

    assert.equal(result.status, 'validation_error')
    assert.equal(toolContext.freeformDiagnostics.proposeValidationFails, 1)

    // Part 1: the failed attempt must render visibly, not be silently dropped — a broken card is
    // pushed into generatedOutfits using the same shape the composer's "needs review" cards use.
    assert.equal(toolContext.generatedOutfits.length, 1)
    const broken = toolContext.generatedOutfits[0]
    assert.equal(broken.broken, true)
    assert.match(broken.rejectionReason, /unresolved top slot/)
    assert.equal(broken.label, 'Collision outfit')
    assert.deepEqual(broken.pieceIds.sort(), [topId, topId2].sort())
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?)').run(topId, topId2)
  }
})

test('persistFreeformGenerationRun writes a queryable row', () => {
  db.prepare('DELETE FROM freeform_generation_runs').run()
  persistFreeformGenerationRun({
    sessionId: 'test-session',
    occasion: 'casual',
    diagnostics: {
      searchCalls: 2,
      gateExcludedTotal: 1,
      proposeCalls: 1,
      proposeValidationFails: 1,
      outfitProseWithoutToolCall: 1,
      zeroResultContradictionBlocks: 1,
      destinationClarificationRetries: 1
    }
  })
  const row = db.prepare('SELECT * FROM freeform_generation_runs WHERE session_id = ?').get('test-session')
  assert.ok(row, 'a row should be persisted')
  assert.equal(row.occasion, 'casual')
  assert.equal(row.search_calls, 2)
  assert.equal(row.gate_excluded_total, 1)
  assert.equal(row.propose_calls, 1)
  assert.equal(row.propose_validation_fails, 1)
  assert.equal(row.outfit_prose_without_tool_count, 1)
  assert.equal(row.zero_result_contradiction_blocks, 1)
  assert.equal(row.destination_clarification_retries, 1)
})

// Spec 3 Part 0 (live-testing findings, 2026-07-09):
// 0a — outfit-shaped prose with no propose_outfit call this turn (intermittent).
// 0b — a zero-result named-garment search contradicted by the model then describing it as real
//      (the "Turquoise Linen Button-Up Shirt" case) — hard-blocked and retried, not just logged.

test('executeTool search_wardrobe records a zero-result named query onto toolContext.zeroResultQueries', async () => {
  const toolContext = {}
  await executeTool('search_wardrobe', { query: 'Turquoise Linen Button-Up Shirt', visual: true }, toolContext)
  assert.deepEqual(toolContext.zeroResultQueries, ['Turquoise Linen Button-Up Shirt'])
})

test('executeTool search_wardrobe does not record a query when results are found', async () => {
  const topId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('findable obs top', 'top', '[]', '["casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', '', '', '', '', '[]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  try {
    const toolContext = {}
    await executeTool('search_wardrobe', { query: 'findable obs top' }, toolContext)
    assert.equal(toolContext.zeroResultQueries, undefined)
  } finally {
    db.prepare('DELETE FROM pieces WHERE id = ?').run(topId)
  }
})

test('findZeroResultContradiction flags an answer that describes a proven-empty query as real', () => {
  const toolContext = { zeroResultQueries: ['Turquoise Linen Button-Up Shirt'] }
  const answer = 'Top: Turquoise Linen Button-Up Shirt\nBottom: Beige Wide-Leg Trousers'
  assert.equal(findZeroResultContradiction(answer, toolContext), 'Turquoise Linen Button-Up Shirt')
})

test('findZeroResultContradiction does not flag a clean answer with no matching query', () => {
  const toolContext = { zeroResultQueries: ['Turquoise Linen Button-Up Shirt'] }
  const answer = 'Top: Black and Cream Striped Knit Top\nBottom: Beige Wide-Leg Trousers'
  assert.equal(findZeroResultContradiction(answer, toolContext), null)
})

test('findZeroResultContradiction returns null when there are no tracked zero-result queries', () => {
  assert.equal(findZeroResultContradiction('anything at all', {}), null)
  assert.equal(findZeroResultContradiction('anything at all', { zeroResultQueries: [] }), null)
})

test('looksLikeUnproposedOutfitProse detects a title + labeled-slot outfit written as plain text', () => {
  const answer = 'Playful Stripes\n\nTop: Black and Cream Striped Knit Top\nBottom: Beige Wide-Leg Trousers\nShoes: Cream Textured Slip-On Shoes\nAccessory: Woven Straw Crossbody Bag\n\nThe striped top adds a playful touch.'
  assert.equal(looksLikeUnproposedOutfitProse(answer), true)
})

test('looksLikeUnproposedOutfitProse does not false-positive on ordinary conversational text', () => {
  const answer = "That sounds like a great plan for your winery lunch! Let's make sure the shoes are comfortable for walking."
  assert.equal(looksLikeUnproposedOutfitProse(answer), false)
})

test('looksLikeUnproposedOutfitProse requires at least two distinct labeled slots, not one', () => {
  const answer = 'Top: a nice blouse — no other slots mentioned here.'
  assert.equal(looksLikeUnproposedOutfitProse(answer), false)
})

// Spec 7 Part 2 (destination/weather clarification hardening, 2026-07-09): the live repro was the
// model asking "What weather are you expecting for the Napa trip on Saturday?" without ever calling
// search_wardrobe, despite the message naming both a place (Napa) and a specific occasion (winery
// lunch) — prompt guidance alone wasn't reliable (same lesson as spec 3 Part 0), so this mechanical
// check backstops it.
test('looksLikeDestinationOrWeatherQuestion matches the literal live repro', () => {
  const answer = 'What weather are you expecting for the Napa trip on Saturday? This will help me recommend the most suitable outfit for the winery lunch.'
  assert.equal(looksLikeDestinationOrWeatherQuestion(answer), true)
})

test('looksLikeDestinationOrWeatherQuestion does not false-positive on ordinary proposing prose', () => {
  const answer = 'For your winery lunch in Napa, I\'d go with a linen blouse, tailored trousers, and comfortable flats to handle the gravel paths.'
  assert.equal(looksLikeDestinationOrWeatherQuestion(answer), false)
})

test('looksLikeDestinationOrWeatherQuestion requires a question mark, not just matching phrasing', () => {
  const answer = 'I already checked what weather to expect in Napa and it looks mild, so here is the outfit.'
  assert.equal(looksLikeDestinationOrWeatherQuestion(answer), false)
})

test('persistFreeformGenerationRun does not throw when diagnostics are missing', () => {
  assert.doesNotThrow(() => persistFreeformGenerationRun({ occasion: 'casual', diagnostics: {} }))
  assert.doesNotThrow(() => persistFreeformGenerationRun({}))
})

// Spec 4: search_wardrobe records which weather source it resolved (live vs heuristic) for spec 3's
// observability. Under NODE_ENV=test with no location, this is always 'heuristic' (see weather.test.js
// for live-path coverage via a mocked fetchImpl) — this test only verifies the wiring, not live weather.
test('executeTool search_wardrobe records weatherSource onto toolContext.freeformDiagnostics', async () => {
  const toolContext = {}
  await executeTool('search_wardrobe', { occasion: 'city', weather: 'hot' }, toolContext)
  assert.equal(toolContext.freeformDiagnostics.weatherSource, 'heuristic')
})
