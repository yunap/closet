import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Isolated per-run DB (spec 21 Part 1) — this file used to import `db.js`
// (and routes/ai.js, tools.js, provider.js, all of which import db.js
// transitively) statically, which meant it read/wrote the developer's real
// wardrobe.db. The env vars must land before those modules evaluate, so
// those imports are dynamic and come after this.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-freeform-observability-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { db } = await import('../db.js')
const { executeTool, bumpFreeformDiagnostic, looksLikeTimezoneIdentifier, resolveStatedOrLiveWeather } = await import('../styling-engine/tools.js')
const { persistFreeformGenerationRun } = await import('../routes/ai.js')
const { findZeroResultContradiction, looksLikeUnproposedOutfitProse, looksLikeDestinationOrWeatherQuestion, extractPieceIdsFromProse, looksLikeOutfitRequest, extractRequestedOutfitCount, applyFreeformOutputChecks, boundedCapsuleFinalAnswer, freeformToolLoopFallbackAnswer, recordToolLoopUsage } = await import('../styling-engine/provider.js')

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
    planOutfitSetCalls: 0,
    outfitProseWithoutToolCall: 0,
    zeroResultContradictionBlocks: 0,
    destinationClarificationRetries: 0,
    planSlotEnvironmentInferred: 0,
    planSlotActivityInferred: 0,
    submitPlanCalls: 0,
    submitPlanValidationFails: 0,
    submitPlanResubmits: 0,
    submitPlanPartialAccepts: 0,
    capsuleFinalFallbacks: 0,
    capsuleSupplyGaps: 0,
    capsuleLooksAutoCompleted: 0,
    capsuleRosterModelCalls: 0,
    capsuleRosterModelRepairs: 0,
    capsuleRosterModelFallbacks: 0,
    // String, like weatherSource: a fallback that records only its own count
    // sends the next question to a paid run instead of a query.
    capsuleRosterFailureCodes: '',
    providerIterations: 0,
    providerInputTokens: 0,
    providerOutputTokens: 0,
    providerCacheReadInputTokens: 0,
    providerCacheCreationInputTokens: 0,
    weatherSource: ''
  })
})

test('recordToolLoopUsage aggregates every paid provider iteration into turn diagnostics', () => {
  const toolContext = {}
  recordToolLoopUsage(toolContext, {
    inputTokens: 1200,
    outputTokens: 180,
    cacheReadInputTokens: 900,
    cacheCreationInputTokens: 40
  })
  recordToolLoopUsage(toolContext, {
    inputTokens: 1500,
    outputTokens: 260,
    cacheReadInputTokens: 1200,
    cacheCreationInputTokens: 0
  })
  assert.equal(toolContext.freeformDiagnostics.providerIterations, 2)
  assert.equal(toolContext.freeformDiagnostics.providerInputTokens, 2700)
  assert.equal(toolContext.freeformDiagnostics.providerOutputTokens, 440)
  assert.equal(toolContext.freeformDiagnostics.providerCacheReadInputTokens, 2100)
  assert.equal(toolContext.freeformDiagnostics.providerCacheCreationInputTokens, 40)
})

test('a completed bounded capsule does not re-enter generic card delivery retries', () => {
  const toolContext = {
    question: 'Build a 14-piece capsule with 8 looks',
    declaredIntent: { want: 'cards', outfitCount: 5 },
    generatedOutfits: [],
    capsuleAtomicAttempted: true,
    freeformDiagnostics: {}
  }
  const result = applyFreeformOutputChecks('I could not validate a credible look for one use case, so I am disclosing the gap.', toolContext, new Set())
  assert.equal(result.block, false)
})

test('bounded capsule final prose is replaced locally when it invents unvalidated outfits', () => {
  const toolContext = {
    capsuleAtomicAttempted: true,
    capsuleAtomicCompleted: true,
    generatedOutfits: [{
      title: 'Validated look',
      pieces: [{ id: 10 }, { id: 20 }, { id: 30 }]
    }],
    freeformDiagnostics: {}
  }
  const result = boundedCapsuleFinalAnswer(
    'Here is the validated look. Second option: pair your top (ID #99) with another bottom.',
    toolContext
  )
  assert.equal(result.replaced, true)
  assert.equal(result.answer, '')
  assert.doesNotMatch(result.answer, /99|Second option/)
  assert.equal(toolContext.freeformDiagnostics.capsuleFinalFallbacks, 1)
})

test('bounded capsule final prose may discuss selected roster pieces not used by example cards', () => {
  const toolContext = {
    capsuleAtomicAttempted: true,
    capsuleAtomicCompleted: true,
    generatedOutfits: [{
      pieces: [{ id: 10 }, { id: 20 }],
      capsulePlanContext: { roster_ids: [10, 20, 30] }
    }],
    freeformDiagnostics: {}
  }
  const text = 'The cardigan (ID #30) gives the capsule a light layer even though it is not needed in the examples.'
  assert.deepEqual(boundedCapsuleFinalAnswer(text, toolContext), {
    answer: text,
    replaced: false,
    reasons: []
  })
})

test('bounded capsule final prose passes when it only introduces accepted cards', () => {
  const toolContext = {
    capsuleAtomicAttempted: true,
    capsuleAtomicCompleted: true,
    generatedOutfits: [{
      title: 'Validated look',
      pieces: [{ id: 10 }, { id: 20 }, { id: 30 }]
    }],
    freeformDiagnostics: {}
  }
  const text = 'Here is your validated capsule rotation. The cards below cover the five parts of your summer.'
  assert.deepEqual(boundedCapsuleFinalAnswer(text, toolContext), {
    answer: text,
    replaced: false,
    reasons: []
  })
})

// First live firing of this guard (2026-07-28, thread_1785288370357) replaced the
// model's closing and recorded NOTHING — counter incremented, prose discarded, no
// reasons, no original. A correct catch and a false positive looked identical
// afterwards, which is what made the run undiagnosable.
test('a replaced capsule closing keeps the reasons and the original prose for review', () => {
  const toolContext = {
    capsuleAtomicAttempted: true,
    capsuleAtomicCompleted: true,
    generatedOutfits: [{ pieces: [{ id: 10 }, { id: 20 }, { id: 30 }] }],
    freeformDiagnostics: {}
  }
  const original = 'That is the engine ceiling for this capsule.'
  const result = boundedCapsuleFinalAnswer(original, toolContext)

  assert.equal(result.replaced, true)
  assert.deepEqual(toolContext.capsuleFinalFallbackDetail.reasons, result.reasons)
  assert.equal(toolContext.capsuleFinalFallbackDetail.original, original)
})

// The same run's guard fired on prose that was probably honest. Measured offline:
// the bare words "another/second … look/option" are ordinary English for explaining
// a rejection, and the tool message explicitly asks the model to explain one. What
// makes prose an unvalidated ADDITION is a garment — an ID, or a "wear X with Y".
test('an honest explanation of a rejected look is not treated as proposing one', () => {
  const toolContext = {
    capsuleAtomicAttempted: true,
    capsuleAtomicCompleted: true,
    generatedOutfits: [{ pieces: [{ id: 10 }, { id: 20 }, { id: 30 }] }],
    capsuleShortfall: { missing: 1, planned: 9, accepted: 8 },
    freeformDiagnostics: {}
  }
  const honest = "For the museum day I couldn't land a second option that worked with walking shoes."
  assert.equal(boundedCapsuleFinalAnswer(honest, toolContext).replaced, false, 'explaining a rejection is the disclosure we asked for')

  // ...but naming garments to wear still gets replaced, which is the whole point.
  const proposes = 'Option: pair the white blouse with the beige trousers for a second museum look.'
  assert.equal(boundedCapsuleFinalAnswer(proposes, { ...toolContext, freeformDiagnostics: {} }).replaced, true)
})

// 2026-07-10: even after the prompt fix, live testing found the model still passed
// location: "America/Los_Angeles" to search_wardrobe — and because an explicit tool argument always
// wins over the server-injected home location, this actively overrode the real value once one was
// configured. This is the mechanical backstop: reject a timezone-shaped location outright, regardless
// of what the prompt says or whether the model complies with it.
test('looksLikeTimezoneIdentifier matches real IANA timezone identifiers', () => {
  assert.equal(looksLikeTimezoneIdentifier('America/Los_Angeles'), true)
  assert.equal(looksLikeTimezoneIdentifier('Europe/London'), true)
  assert.equal(looksLikeTimezoneIdentifier('Asia/Ho_Chi_Minh'), true)
})

test('looksLikeTimezoneIdentifier does not false-positive on real place names', () => {
  assert.equal(looksLikeTimezoneIdentifier('Los Angeles'), false)
  assert.equal(looksLikeTimezoneIdentifier('San Francisco'), false)
  assert.equal(looksLikeTimezoneIdentifier('Napa'), false)
  assert.equal(looksLikeTimezoneIdentifier('Seattle'), false)
  assert.equal(looksLikeTimezoneIdentifier(''), false)
  assert.equal(looksLikeTimezoneIdentifier(undefined), false)
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
  const shoesId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs shoes', 'shoes', '[]', '["casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', '', '', '', '', '[]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  try {
    const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], activity: 'walking', retrievedPieceIds: new Set([topId, bottomId, shoesId]) }
    const result = await executeTool('propose_outfit', {
      label: 'Obs outfit',
      pieces: [{ id: topId, role: 'primary_top' }, { id: bottomId, role: 'primary_bottom' }, { id: shoesId, role: 'shoes' }]
    }, toolContext)
    assert.equal(result.status, 'success')
    assert.equal(toolContext.freeformDiagnostics.proposeCalls, 1)
    assert.equal(toolContext.freeformDiagnostics.proposeValidationFails, 0)
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?, ?)').run(topId, bottomId, shoesId)
  }
})

test('executeTool propose_outfit inherits hot-weather card context from prior search', async () => {
  const topId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs hot city polished top', 'top', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'polished cotton top', '', 'cotton', 'light', '["cotton"]', 'elevated', '', '{}')
  `).run().lastInsertRowid
  const bottomId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs hot city tailored shorts', 'bottom', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'tailored linen shorts', '', 'linen', 'light', '["linen"]', 'elevated', '', '{"bottom_kind":"shorts"}')
  `).run().lastInsertRowid
  const shoesId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json, heel_height, walk_support)
    VALUES ('obs hot city loafers', 'shoes', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'walkable loafers', '', 'leather', 'light', '["leather"]', 'everyday', '', '{}', 'flat', 'medium')
  `).run().lastInsertRowid

  try {
    const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], season: 'current season' }
    await executeTool('search_wardrobe', { occasion: 'city', activity: 'walking', weather: 'hot weather', visual: true }, toolContext)
    assert.equal(toolContext.weatherProfile?.isHot, true)
    assert.equal(toolContext.weather, 'hot weather')

    const result = await executeTool('propose_outfit', {
      label: 'Hot City Polish',
      pieces: [
        { id: topId, role: 'primary_top' },
        { id: bottomId, role: 'primary_bottom' },
        { id: shoesId, role: 'shoes' }
      ],
      occasion_context: 'city walking',
      why_it_works: 'Light but polished for walking in hot weather.'
    }, toolContext)

    assert.equal(result.status, 'success')
    assert.equal(toolContext.generatedOutfits.length, 1)
    assert.equal(toolContext.generatedOutfits[0].occasion, 'city')
    assert.equal(toolContext.generatedOutfits[0].season, 'hot weather')
    assert.equal(toolContext.generatedOutfits[0].debug.resolvedActivity, 'walking')
    assert.equal(toolContext.generatedOutfits[0].debug.walkable, true)
    assert.equal(toolContext.season, 'hot weather')
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?, ?)').run(topId, bottomId, shoesId)
  }
})

test('executeTool honors explicit no-shorts request in search and proposal validation', async () => {
  const shortsId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs no-shorts tailored shorts', 'bottom', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'tailored shorts', '', 'linen', 'light', '["linen"]', 'elevated', '', '{"bottom_kind":"shorts"}')
  `).run().lastInsertRowid
  const pantsId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs no-shorts wide-leg pants', 'bottom', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'wide-leg linen pants', '', 'linen', 'light', '["linen"]', 'elevated', '', '{"bottom_kind":"pants"}')
  `).run().lastInsertRowid
  const topId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs no-shorts polished top', 'top', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'polished top', '', 'cotton', 'light', '["cotton"]', 'elevated', '', '{}')
  `).run().lastInsertRowid
  const shoesId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json, heel_height, walk_support)
    VALUES ('obs no-shorts loafers', 'shoes', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'walkable loafers', '', 'leather', 'light', '["leather"]', 'everyday', '', '{}', 'flat', 'medium')
  `).run().lastInsertRowid

  try {
    const toolContext = {
      declaredIntent: { want: 'cards' },
      generatedOutfits: [],
      question: "It's hot and I'll be walking around the city all day. Give me polished outfit ideas, no shorts.",
      retrievedPieceIds: new Set([topId, shortsId, shoesId])
    }
    const results = await executeTool('search_wardrobe', { category: 'bottom', occasion: 'city', activity: 'walking', weather: 'hot' }, toolContext)
    const resultIds = results.filter(item => item && item.id).map(item => Number(item.id))
    assert.equal(resultIds.includes(Number(shortsId)), false)
    assert.equal(resultIds.includes(Number(pantsId)), true)

    const result = await executeTool('propose_outfit', {
      label: 'Shorts Should Not Pass',
      pieces: [
        { id: topId, role: 'primary_top' },
        { id: shortsId, role: 'primary_bottom' },
        { id: shoesId, role: 'shoes' }
      ],
      occasion_context: 'city walking'
    }, toolContext)

    assert.equal(result.status, 'validation_error')
    assert.match(result.message, /excludes shorts/)
    assert.equal(toolContext.generatedOutfits.length, 1)
    assert.equal(toolContext.generatedOutfits[0].broken, true)
    assert.match(toolContext.generatedOutfits[0].rejectionReason, /excludes shorts/)
    assert.equal(toolContext.generatedOutfits[0].debug.resolvedActivity, 'walking')
    assert.equal(toolContext.generatedOutfits[0].debug.walkable, true)
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?, ?, ?)').run(shortsId, pantsId, topId, shoesId)
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
    const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], retrievedPieceIds: new Set([topId, topId2]) }
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

test('executeTool propose_outfit rejects category-role mismatch as a broken diagnostic card', async () => {
  const topId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs black blouson top', 'top', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'black blouson top', '', 'cotton', 'light', '["cotton"]', 'elevated', '', '{}')
  `).run().lastInsertRowid
  const topAsBottomId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs black textured long sleeve top', 'top', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'black textured long sleeve top', '', 'cotton', 'light', '["cotton"]', 'elevated', '', '{}')
  `).run().lastInsertRowid
  const shoesId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json, heel_height, walk_support)
    VALUES ('obs black slip-on loafers', 'shoes', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'black slip-on loafers', '', 'leather', 'light', '["leather"]', 'everyday', '', '{}', 'flat', 'medium')
  `).run().lastInsertRowid

  try {
    const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], retrievedPieceIds: new Set([topId, topAsBottomId, shoesId]) }
    const result = await executeTool('propose_outfit', {
      label: 'Sleek City Moves',
      pieces: [
        { id: topId, role: 'primary_top' },
        { id: topAsBottomId, role: 'primary_bottom' },
        { id: shoesId, role: 'shoes' }
      ],
      occasion_context: 'city walking'
    }, toolContext)

    assert.equal(result.status, 'validation_error')
    assert.match(result.issues.join(' '), /category "top" but was assigned role "primary_bottom"/)
    assert.equal(toolContext.generatedOutfits.length, 1)
    assert.equal(toolContext.generatedOutfits[0].broken, true)
    assert.match(toolContext.generatedOutfits[0].rejectionReason, /primary_bottom/)
    assert.equal(toolContext.generatedOutfits[0].debug.resolvedActivity, 'walking')
    assert.equal(toolContext.generatedOutfits[0].debug.walkable, true)
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?, ?)').run(topId, topAsBottomId, shoesId)
  }
})

// 2026-07-10: live-testing found a real freeform chat card ("Relaxed Comfort Look" — top + bottom +
// cardigan, no shoes) render as a normal, unflagged card, with no code path that would have caught
// it. This confirms the fix routes through the same existing broken-card mechanism as the role-
// collision case above, not a new one.
test('executeTool propose_outfit with zero shoes and no missing_gaps pushes a visible broken diagnostic card', async () => {
  const topId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs top 4', 'top', '[]', '["casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', '', '', '', '', '[]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const bottomId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs bottom 2', 'bottom', '[]', '["casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', '', '', '', '', '[]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  try {
    const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], retrievedPieceIds: new Set([topId, bottomId]) }
    const result = await executeTool('propose_outfit', {
      label: 'Relaxed Comfort Look',
      pieces: [{ id: topId, role: 'primary_top' }, { id: bottomId, role: 'primary_bottom' }]
    }, toolContext)

    assert.equal(result.status, 'validation_error')
    assert.match(result.message, /missing shoes/)
    assert.equal(toolContext.generatedOutfits.length, 1)
    const broken = toolContext.generatedOutfits[0]
    assert.equal(broken.broken, true)
    assert.match(broken.rejectionReason, /missing shoes/)
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?)').run(topId, bottomId)
  }
})

test('executeTool propose_outfit rejects shoe missing_gaps as a substitute for actual footwear', async () => {
  const topId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs hiking tee', 'top', '[]', '["travel","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'cotton graphic tee', '', 'cotton', 'light', '["cotton"]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const topId2 = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs black graphic cat tee', 'top', '[]', '["travel","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'graphic tee', '', 'cotton', 'light', '["cotton"]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const bottomId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs hiking pants', 'bottom', '[]', '["travel","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'cropped hiking pants', '', 'cotton', 'light', '["cotton"]', 'everyday', '', '{}')
  `).run().lastInsertRowid

  try {
    const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], activity: 'hiking', retrievedPieceIds: new Set([bottomId, topId, topId2]) }
    const result = await executeTool('propose_outfit', {
      label: 'Light and Airy Hike',
      pieces: [
        { id: bottomId, role: 'primary_bottom' },
        { id: topId, role: 'primary_top' },
        { id: topId2, role: 'layer_top' }
      ],
      missing_gaps: ['comfortable hiking shoes'],
      occasion: 'travel',
      season: 'warm'
    }, toolContext)

    assert.equal(result.status, 'validation_error')
    assert.match(result.issues.join(' '), /missing shoes/)
    assert.match(result.issues.join(' '), /standalone top/)
    assert.equal(toolContext.generatedOutfits.length, 1)
    assert.equal(toolContext.generatedOutfits[0].broken, true)
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?, ?)').run(topId, topId2, bottomId)
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
      planOutfitSetCalls: 0,
      outfitProseWithoutToolCall: 1,
      zeroResultContradictionBlocks: 1,
      destinationClarificationRetries: 1,
      planSlotEnvironmentInferred: 2,
      planSlotActivityInferred: 3,
      submitPlanCalls: 4,
      submitPlanValidationFails: 2,
      submitPlanResubmits: 2,
      submitPlanPartialAccepts: 1
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
  assert.equal(row.plan_slot_environment_inferred, 2)
  assert.equal(row.plan_slot_activity_inferred, 3)
  assert.equal(row.submit_plan_calls, 4)
  assert.equal(row.submit_plan_validation_fails, 2)
  assert.equal(row.submit_plan_resubmits, 2)
  assert.equal(row.submit_plan_partial_accepts, 1)
  assert.equal(row.capsule_final_fallbacks, 0)
})

// thread_1785902365403: a capsule turn completed and PAID FOR its roster call,
// then died when the composition call hit an exhausted credit balance. The only
// persist ran on the success path, so the roster's outcome — its failure codes
// above all — was lost entirely, and the next step was another paid run rather
// than a query. The row is now written either way, and says which it was.
test('a failed turn still records what it spent, marked as failed', () => {
  db.prepare('DELETE FROM freeform_generation_runs').run()
  persistFreeformGenerationRun({
    sessionId: 'died-mid-capsule',
    occasion: 'capsule',
    diagnostics: {
      capsuleRosterModelCalls: 1,
      capsuleRosterModelRepairs: 1,
      capsuleRosterFailureCodes: 'category_floor',
      providerInputTokens: 331,
      providerCacheCreationInputTokens: 124268
    },
    turnFailed: true
  })
  const row = db.prepare('SELECT * FROM freeform_generation_runs WHERE session_id = ?').get('died-mid-capsule')
  assert.equal(row.turn_failed, 1, 'the row must say the turn did not finish')
  // The whole point: the paid roster call and its reason survive the failure.
  assert.equal(row.capsule_roster_model_calls, 1)
  assert.equal(row.capsule_roster_model_repairs, 1)
  assert.equal(row.capsule_roster_failure_codes, 'category_floor')
  assert.equal(row.provider_cache_creation_input_tokens, 124268)
})

test('a completed turn is distinguishable from a failed one in the same table', () => {
  persistFreeformGenerationRun({ sessionId: 'finished-fine', occasion: 'capsule', diagnostics: { capsuleRosterModelCalls: 1 } })
  const row = db.prepare('SELECT turn_failed FROM freeform_generation_runs WHERE session_id = ?').get('finished-fine')
  assert.equal(row.turn_failed, 0, 'default is a completed turn, so existing rows keep their meaning')
})

// The route must actually reach that path. Source-asserted because forcing the
// provider to throw mid-turn from here would exercise the mock, not the wiring.
test('the /ask route records diagnostics from its catch block, not only on success', () => {
  const routeSrc = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  // The reference is hoisted above the try and pointed at the live context
  // before any provider call can throw.
  assert.match(routeSrc, /let diagnosticsContext = null\s*\n\s*try \{/)
  assert.match(routeSrc, /diagnosticsContext = toolContext/)
  // And the catch persists it, flagged.
  assert.match(routeSrc, /catch \(err\) \{[\s\S]{0,900}persistFreeformGenerationRun\(\{[\s\S]{0,300}turnFailed: true/)
})

test('persistFreeformGenerationRun stores aggregate provider usage for cost audits', () => {
  persistFreeformGenerationRun({
    sessionId: 'usage-audit',
    occasion: 'capsule',
    diagnostics: {
      providerIterations: 5,
      providerInputTokens: 12500,
      providerOutputTokens: 1800,
      providerCacheReadInputTokens: 9000,
      providerCacheCreationInputTokens: 700
    }
  })
  const row = db.prepare(`
    SELECT provider_iterations, provider_input_tokens, provider_output_tokens,
           provider_cache_read_input_tokens, provider_cache_creation_input_tokens
    FROM freeform_generation_runs WHERE session_id = ?
  `).get('usage-audit')
  assert.deepEqual(row, {
    provider_iterations: 5,
    provider_input_tokens: 12500,
    provider_output_tokens: 1800,
    provider_cache_read_input_tokens: 9000,
    provider_cache_creation_input_tokens: 700
  })
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

// 2026-07-10: live-testing found a real answer in this exact numbered-garment-name shape slip past
// the category-label check entirely (no retry fired, no card rendered) — this is the literal repro.
test('looksLikeUnproposedOutfitProse detects a numbered garment-name list citing real piece IDs', () => {
  const answer = '### Outfit Idea: Casual Comfort\n\n**1. Mustard Knit Sweater (ID 84)**\n- Fit & Proportion: relaxed drape.\n\n**2. Oatmeal Linen Jogger-Style Pants (ID 99)**\n- Fit & Texture: comfortable.\n\n**3. Cream Textured Slip-On Shoes (ID 215)**\n- Fit & Versatility: lightweight.\n\nWould you like accessories?'
  assert.equal(looksLikeUnproposedOutfitProse(answer), true)
})

test('looksLikeUnproposedOutfitProse does not false-positive on a numbered list with no cited piece IDs', () => {
  const answer = 'A few style tips for today:\n\n1. Keep layers light for warm weather.\n2. Stick to breathable fabrics.\n3. Comfortable shoes matter most.'
  assert.equal(looksLikeUnproposedOutfitProse(answer), false)
})

test('looksLikeUnproposedOutfitProse does not false-positive on a single numbered item citing an ID', () => {
  const answer = 'One option worth considering: **1. Mustard Knit Sweater (ID 84)** would work well on its own as a layer.'
  assert.equal(looksLikeUnproposedOutfitProse(answer), false)
})

// 2026-07-10, third live-testing finding: a bulleted-sentence answer ("- Start with your **charcoal
// solid tailored trousers**...") escaped BOTH prose-format checks above — no category labels, no
// numbered list, no cited IDs. Rather than add a fourth answer-format regex, this checks the
// USER's question instead — format-independent by construction, covers this case and future ones.
test('looksLikeOutfitRequest matches the literal live repros from this session', () => {
  assert.equal(looksLikeOutfitRequest('What should I wear today, nothing special?'), true)
  assert.equal(looksLikeOutfitRequest('going on a walk tomorrow, ideas?'), true)
  assert.equal(looksLikeOutfitRequest("I'm going to the farmers' market on Sunday, ideas?"), true)
  assert.equal(looksLikeOutfitRequest('can we try layering metallic stripe scoop tank as a top layer on something from my wardrobe?'), true)
})

test('looksLikeOutfitRequest matches other common outfit-request phrasings', () => {
  assert.equal(looksLikeOutfitRequest('What should I pack for the trip?'), true)
  assert.equal(looksLikeOutfitRequest('Help me pack for Napa this weekend'), true)
  assert.equal(looksLikeOutfitRequest('Any outfit ideas for a rainy day?'), true)
  assert.equal(looksLikeOutfitRequest('Can you give me some styling advice for this top?'), true)
})

test('looksLikeOutfitRequest does not false-positive on informational or non-outfit questions', () => {
  assert.equal(looksLikeOutfitRequest('Do you know how many pieces are in my wardrobe right now?'), false)
  assert.equal(looksLikeOutfitRequest('Why did you suggest wool for this weather?'), false)
  assert.equal(looksLikeOutfitRequest('show'), false)
})

test('extractRequestedOutfitCount reads explicit outfit idea counts', () => {
  assert.equal(extractRequestedOutfitCount("Can you give me 3 outfit ideas that don't look too casual?"), 3)
  assert.equal(extractRequestedOutfitCount('show me three polished looks'), 3)
  assert.equal(extractRequestedOutfitCount('I want two city outfits'), 2)
  assert.equal(extractRequestedOutfitCount('what should I wear today?'), null)
})

test('applyFreeformOutputChecks retries when concrete requested outfit count is underdelivered', () => {
  const toolContext = {
    question: "It's hot and I'll be walking around the city all day. Give me 3 polished outfit ideas, no shorts.",
    generatedOutfits: [
      { label: 'Ready card', broken: false },
      { label: 'Rejected card', broken: true }
    ],
    freeformDiagnostics: { proposeCalls: 1, searchCalls: 1 }
  }
  const check = applyFreeformOutputChecks("Here's one outfit.", toolContext)
  assert.equal(check.block, true)
  assert.equal(check.blockType, 'outfitCount')
  assert.match(check.correctionMessage, /requested 3 outfit ideas/)
  assert.match(check.correctionMessage, /Do not call search_wardrobe again/)
  assert.match(check.correctionMessage, /Call propose_outfit now/)

  const alreadyRetried = applyFreeformOutputChecks("Here's one outfit.", toolContext, new Set(['outfitCount']))
  assert.equal(alreadyRetried.block, false)
})

test('freeformToolLoopFallbackAnswer reports requested-count shortfall instead of generic success', () => {
  const answer = freeformToolLoopFallbackAnswer({
    question: "It's hot and I'll be walking around the city all day. Give me 3 polished outfit ideas, no shorts.",
    generatedOutfits: [
      { label: 'Floral Harmony' },
      { label: 'Chic Comfort' },
      { label: 'Emerald Elegance', broken: true }
    ]
  })
  assert.match(answer, /2 verified outfit cards/)
  assert.match(answer, /1 additional proposal was rejected/)
  assert.match(answer, /all 3 requested looks/)
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

test('looksLikeDestinationOrWeatherQuestion matches expected-forecast phrasing', () => {
  const answer = "What's the expected weather forecast for tomorrow in Fairfax? Knowing the weather will help me suggest the best hiking outfit for you."
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

// Spec 11, revised (2026-07-10): the first version of this fix only retried when the user explicitly
// asked to "show"/"render" an already-described outfit, by asking the model to reconstruct it —
// unreliable, since the model would sometimes substitute a different-but-plausible piece instead of a
// true re-render. Root cause traced further: the legacy client-side prose parser that used to build
// cards locally (StylistChat.jsx's parseStructuredOutfitsFromAssistantText, deleted in spec 21 Part 4)
// only matched the old pre-propose_outfit "### Outfit N" + "**Pieces**: A + B + C" format, which
// STYLIST_SYSTEM has explicitly told the model not to write since the propose_outfit migration — so
// there was no reliable local fallback to lean on either. The actual fix: harden looksLikeUnproposedOutfitProse (previously
// a spec-3 soft flag only) into a hard block that fires on ANY outfit-shaped prose with zero
// propose_outfit calls, not just ones following a "show" request — so there's ideally nothing left to
// reconstruct by the time a follow-up like "show" is asked. Known test gap, same as spec 3/7/11's
// other retry checks: the hardened block lives inside askStylistWithTools's tool loop, bypassed under
// NODE_ENV=test — live-verified separately (see memory), only the pure helper is unit-tested here.
test('extractPieceIdsFromProse finds IDs cited in parenthetical form', () => {
  const prose = 'Top: White tie front blouse (ID 63) adds elegance.\nBottom: Black cream botanical tiered midi skirt (ID 92).\nShoes: Black slip-on loafers (ID 196).'
  assert.deepEqual(extractPieceIdsFromProse(prose), [63, 92, 196])
})

test('extractPieceIdsFromProse finds IDs cited without parentheses and dedupes repeats', () => {
  const prose = 'This uses ID 12 and ID: 45. We already mentioned ID 12 above.'
  assert.deepEqual(extractPieceIdsFromProse(prose), [12, 45])
})

test('extractPieceIdsFromProse returns an empty array when no IDs are present', () => {
  assert.deepEqual(extractPieceIdsFromProse('A relaxed outfit with a linen top and denim.'), [])
})

test('persistFreeformGenerationRun does not throw when diagnostics are missing', () => {
  assert.doesNotThrow(() => persistFreeformGenerationRun({ occasion: 'casual', diagnostics: {} }))
  assert.doesNotThrow(() => persistFreeformGenerationRun({}))
})

// Spec 4: search_wardrobe records which weather source it resolved (stated vs live vs heuristic) for
// spec 3's observability. This call's own `weather` arg is a stated override (resolveStatedOrLiveWeather)
// and short-circuits straight to 'stated' without ever attempting live resolution — this test only
// verifies the wiring, not live weather (see weather.test.js for live-path coverage via a mocked
// fetchImpl).
test('executeTool search_wardrobe records weatherSource onto toolContext.freeformDiagnostics', async () => {
  const toolContext = {}
  await executeTool('search_wardrobe', { occasion: 'city', weather: 'hot' }, toolContext)
  assert.equal(toolContext.freeformDiagnostics.weatherSource, 'stated')
})

// With no weather arg of its own and no location, resolution falls all the way through to the text
// heuristic (NODE_ENV=test with no location never hits the network).
test('executeTool search_wardrobe falls back to the heuristic weatherSource without a stated weather arg', async () => {
  const toolContext = {}
  await executeTool('search_wardrobe', { occasion: 'city' }, toolContext)
  assert.equal(toolContext.freeformDiagnostics.weatherSource, 'heuristic')
})

// 2026-07-14 live bug: on a thread with an established hot/summer weather context, a followup
// stating NEW weather ("add a rainy-day option") still resolved live weather for the home location
// (sunny/hot LA) instead of honoring the stated text, so propose_outfit wrongly rejected
// rainy-appropriate pieces (jeans, a cardigan) as "hot weather: insulating piece". This proves the
// fix at the source: resolveStatedOrLiveWeather must short-circuit to the stated text and never even
// attempt the live lookup — mirrors outfitSetPlanner.js's resolveSlotWeather precedent and the
// weather.test.js mocked-fetchImpl convention.
test('resolveStatedOrLiveWeather short-circuits to the stated text and never calls fetch, even with a location set', async () => {
  let calls = 0
  const fetchImpl = async (url) => {
    calls += 1
    // If this were ever reached, it would resolve a hot summer profile — the opposite of "rainy".
    if (url.includes('geocoding-api')) return { ok: true, json: async () => ({ results: [{ latitude: 34.05, longitude: -118.24 }] }) }
    return { ok: true, json: async () => ({ daily: { temperature_2m_max: [95], temperature_2m_min: [70] } }) }
  }
  const profile = await resolveStatedOrLiveWeather({
    statedWeather: 'rainy weather',
    location: 'Los Angeles',
    fetchImpl
  })
  assert.equal(profile.weatherSource, 'stated')
  assert.equal(profile.isHot, false, '"rainy weather" must not inherit the hot classification a live LA lookup would have returned')
  assert.equal(calls, 0, 'a stated override must short-circuit before any geocode/forecast call')
})

test('resolveStatedOrLiveWeather falls through to live resolution when no weather is stated', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('geocoding-api')) return { ok: true, json: async () => ({ results: [{ latitude: 34.05, longitude: -118.24 }] }) }
    return { ok: true, json: async () => ({ daily: { temperature_2m_max: [95], temperature_2m_min: [70] } }) }
  }
  const profile = await resolveStatedOrLiveWeather({ location: 'Los Angeles', fetchImpl })
  assert.equal(profile.weatherSource, 'live')
  assert.equal(profile.isHot, true)
})

// End-to-end reproduction of the observable symptom: a stated followup weather, once cached onto
// toolContext.weatherProfile by search_wardrobe, must let propose_outfit accept pieces that are
// correct for THAT weather (not the piece that would only be safe in heat).
test('executeTool propose_outfit accepts cold/rainy-appropriate pieces after a stated-weather search_wardrobe call', async () => {
  const blousonTopId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs black blouson top', 'top', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'blouson top', '', 'cotton', 'medium', '["cotton"]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const cardiganId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs grey knit draped cardigan', 'outerwear', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'knit cardigan', '', 'wool', 'medium', '["wool"]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const jeansId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs dark blue slim straight jeans', 'bottom', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'straight jeans', '', 'denim', 'medium', '["cotton"]', 'everyday', '', '{"bottom_kind":"pants"}')
  `).run().lastInsertRowid
  const loafersId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json, heel_height, walk_support)
    VALUES ('obs black slip-on loafers 2', 'shoes', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'black slip-on loafers', '', 'leather', 'medium', '["leather"]', 'everyday', '', '{}', 'flat', 'medium')
  `).run().lastInsertRowid

  try {
    const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], occasion: 'city', season: 'current season' }
    // Simulates the model correctly stating the followup's new weather, as it did live.
    await executeTool('search_wardrobe', { occasion: 'city', activity: 'none', weather: 'rainy weather' }, toolContext)
    assert.equal(toolContext.weatherProfile?.isHot, false)

    const result = await executeTool('propose_outfit', {
      label: 'Urban Rainy Comfort',
      pieces: [
        { id: blousonTopId, role: 'primary_top' },
        { id: cardiganId, role: 'outerwear' },
        { id: jeansId, role: 'primary_bottom' },
        { id: loafersId, role: 'shoes' }
      ],
      occasion_context: 'rainy city day',
      why_it_works: 'A blouson top, cardigan, and jeans are appropriate for a rainy day, not a hot one.'
    }, toolContext)

    assert.equal(result.status, 'success', `expected the rainy-appropriate outfit to be accepted, got: ${JSON.stringify(result)}`)
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?, ?, ?)').run(blousonTopId, cardiganId, jeansId, loafersId)
  }
})

test('executeTool propose_outfit rejects hot-weather gated pieces using weather resolved by prior search', async () => {
  const woolTopId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs green brown wool tunic', 'top', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'wool tunic', '', 'wool', 'medium', '["wool"]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const shortsId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs beige linen shorts', 'bottom', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'linen shorts', '', 'linen', 'light', '["linen"]', 'everyday', '', '{"bottom_kind":"shorts"}')
  `).run().lastInsertRowid
  const shoesId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json, heel_height, walk_support)
    VALUES ('obs black slip-on loafers', 'shoes', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'black slip-on loafers', '', 'leather', 'light', '["leather"]', 'everyday', '', '{}', 'flat', 'medium')
  `).run().lastInsertRowid

  try {
    const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], occasion: 'city', season: 'current season' }
    await executeTool('search_wardrobe', { occasion: 'city', activity: 'walking', weather: 'hot' }, toolContext)
    assert.equal(toolContext.weatherProfile?.isHot, true)
    assert.equal(toolContext.activity, 'walking')

    const result = await executeTool('propose_outfit', {
      label: 'City Day Stroll',
      pieces: [
        { id: woolTopId, role: 'primary_top' },
        { id: shortsId, role: 'primary_bottom' },
        { id: shoesId, role: 'shoes' }
      ],
      occasion_context: 'city walking',
      why_it_works: 'This should be rejected because the tunic is too warm.'
    }, toolContext)

    assert.equal(result.status, 'validation_error')
    assert.match(result.message, /wool tunic/)
    assert.match(result.message, /hot weather: insulating fiber/)
    assert.equal(toolContext.generatedOutfits.length, 1)
    assert.equal(toolContext.generatedOutfits[0].broken, true)
    assert.match(toolContext.generatedOutfits[0].rejectionReason, /hot weather: insulating fiber/)
    assert.equal(toolContext.generatedOutfits[0].occasion, 'city')
    assert.equal(toolContext.generatedOutfits[0].season, 'hot')
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?, ?)').run(woolTopId, shortsId, shoesId)
  }
})

// Part 1 (spec 18): a proposal that STATES a different occasion than the
// turn's context must not inherit that context's stale activity — the live
// bug was a hiking-capsule turn's activity leaking into a same-turn dinner
// follow-up, dragging the register ceiling down to "everyday" and rejecting
// a dressy dinner outfit as if it were a hike.
test('executeTool propose_outfit drops stale toolContext.activity when this call states a different occasion', async () => {
  const topId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs dressy silk cami', 'top', '[]', '["evening"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'polished silk cami', '', 'silk', 'light', '["silk"]', 'dressy', '', '{}')
  `).run().lastInsertRowid
  const bottomId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs dressy satin skirt', 'bottom', '[]', '["evening"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'polished satin skirt', '', 'satin', 'light', '["satin"]', 'dressy', '', '{}')
  `).run().lastInsertRowid
  const shoesId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json, heel_height, walk_support)
    VALUES ('obs sleek black cutout flats', 'shoes', '[]', '["evening"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'sleek dressy flats', '', 'leather', 'light', '["leather"]', 'dressy', '', '{}', 'flat', 'low')
  `).run().lastInsertRowid

  try {
    // Simulates the earlier capsule turn having set a hiking context that
    // persists on toolContext going into this NEW, differently-occasioned call.
    const toolContext = {
      declaredIntent: { want: 'cards' },
      generatedOutfits: [],
      occasion: 'casual',
      activity: 'hiking',
      retrievedPieceIds: new Set([topId, bottomId, shoesId])
    }
    const result = await executeTool('propose_outfit', {
      label: 'Dinner Look',
      occasion: 'evening',
      pieces: [
        { id: topId, role: 'primary_top' },
        { id: bottomId, role: 'primary_bottom' },
        { id: shoesId, role: 'shoes' }
      ],
      occasion_context: 'evening dinner',
      why_it_works: 'A dressy dinner look, not a hike.'
    }, toolContext)

    assert.equal(result.status, 'success', `dressy dinner pieces should not be gated as a hike, got: ${JSON.stringify(result)}`)
    assert.equal(toolContext.generatedOutfits.length, 1)
    assert.equal(toolContext.generatedOutfits[0].debug.resolvedActivity, 'none')
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?, ?)').run(topId, bottomId, shoesId)
  }
})

// Cross-turn state (handoff scenario 6) must stay untouched: a follow-up that
// states NO occasion at all (e.g. "swap the shoes on #2") still inherits
// toolContext.activity exactly as before.
test('executeTool propose_outfit still inherits toolContext.activity when this call states no occasion', async () => {
  const topId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs no-occasion top', 'top', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', '', '', '', '', '[]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const bottomId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs no-occasion bottom', 'bottom', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', '', '', '', '', '[]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const shoesId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json, heel_height, walk_support)
    VALUES ('obs no-occasion shoes', 'shoes', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', '', '', '', '', '[]', 'everyday', '', '{}', 'flat', 'high')
  `).run().lastInsertRowid

  try {
    const toolContext = {
      declaredIntent: { want: 'cards' },
      generatedOutfits: [],
      occasion: 'city',
      activity: 'walking',
      retrievedPieceIds: new Set([topId, bottomId, shoesId])
    }
    const result = await executeTool('propose_outfit', {
      label: 'Swapped Shoes',
      pieces: [
        { id: topId, role: 'primary_top' },
        { id: bottomId, role: 'primary_bottom' },
        { id: shoesId, role: 'shoes' }
      ]
    }, toolContext)

    assert.equal(result.status, 'success')
    assert.equal(toolContext.generatedOutfits[0].debug.resolvedActivity, 'walking')
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?, ?)').run(topId, bottomId, shoesId)
  }
})

// A follow-up that restates the SAME occasion still inherits the activity —
// only a genuine occasion switch should drop it.
test('executeTool propose_outfit inherits toolContext.activity when this call restates the same occasion', async () => {
  const topId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs same-occasion top', 'top', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', '', '', '', '', '[]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const bottomId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('obs same-occasion bottom', 'bottom', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', '', '', '', '', '[]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const shoesId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json, heel_height, walk_support)
    VALUES ('obs same-occasion shoes', 'shoes', '[]', '["city","casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', '', '', '', '', '[]', 'everyday', '', '{}', 'flat', 'high')
  `).run().lastInsertRowid

  try {
    const toolContext = {
      declaredIntent: { want: 'cards' },
      generatedOutfits: [],
      occasion: 'city',
      activity: 'walking',
      retrievedPieceIds: new Set([topId, bottomId, shoesId])
    }
    const result = await executeTool('propose_outfit', {
      label: 'Another Walking Look',
      occasion: 'city',
      pieces: [
        { id: topId, role: 'primary_top' },
        { id: bottomId, role: 'primary_bottom' },
        { id: shoesId, role: 'shoes' }
      ]
    }, toolContext)

    assert.equal(result.status, 'success')
    assert.equal(toolContext.generatedOutfits[0].debug.resolvedActivity, 'walking')
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?, ?)').run(topId, bottomId, shoesId)
  }
})
