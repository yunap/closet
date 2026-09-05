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
const { executeTool, bumpFreeformDiagnostic, looksLikeTimezoneIdentifier, resolveToolStylingContext, recordNestedFreeformUsage, recordFreeformToolIteration, declareBoundedMultiLookIntent, STYLIST_TOOLS } = await import('../styling-engine/tools.js')
const { createStylingContextResolver } = await import('../styling-engine/stylingContext.js')
const { persistFreeformGenerationRun, boundedConversationStateFromToolContext, composerPieceLineSuffix, compactFreeformAnswerSystem, compactFreeformPieceFacts, compactFreeformContext, compactProfileHasContext, compactFreeformAnswerMessage, compactGarmentVisualEvidence, formatWardrobeInventoryAnswer, exactNamedPieceIdsFromQuestion, isSavedPhotoWearMechanicsQuestion, compactRouterTurnHasContext } = await import('../routes/ai.js')
const { findZeroResultContradiction, looksLikeUnproposedOutfitProse, looksLikeDestinationOrWeatherQuestion, extractPieceIdsFromProse, looksLikeOutfitRequest, extractRequestedOutfitCount, applyFreeformOutputChecks, boundedCapsuleFinalAnswer, boundedAtomicMultiLookFinalAnswer, boundedAtomicMultiLookResponse, applyAcceptedCardAuthority, stripPieceIdCitations, freeformToolLoopFallbackAnswer, recordToolLoopUsage, stylistToolsForTurn, routeFreeformExecutionProfile } = await import('../styling-engine/provider.js')

// Spec 3 (freeform observability): gate exclusions and propose_outfit validation outcomes must be
// inspectable, not anecdotal — the freeform-chat equivalent of the composer's excludedCounts debug.

test('bumpFreeformDiagnostic initializes and accumulates counters on toolContext', () => {
  const toolContext = {}
  bumpFreeformDiagnostic(toolContext, 'searchCalls')
  bumpFreeformDiagnostic(toolContext, 'gateExcludedTotal', 3)
  bumpFreeformDiagnostic(toolContext, 'searchCalls')
  assert.deepEqual(toolContext.freeformDiagnostics, {
    searchCalls: 2,
    // docs/search-wardrobe-visual-budget-spec.md counters.
    searchVisualImagesAttached: 0,
    searchVisualMaxCategoryCount: 0,
    gateExcludedTotal: 3,
    proposeCalls: 0,
    proposeValidationFails: 0,
    planOutfitSetCalls: 0,
    outfitProseWithoutToolCall: 0,
    zeroResultContradictionBlocks: 0,
    // docs/card-consistency-spec.md Part 1 — cards whose prose did not account for a top worn with
    // a dress, sent back for one correction round.
    cardProseInconsistentBlocks: 0,
    atomicMultiLookCalls: 0,
    executionRouterCalls: 0,
    // Capsule's ending: a clause that spent its retry and is still failing ships with a note.
    closingProseWithheld: 0,
    unresolvedCheckDisclosures: 0,
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
    // One stage later than the roster pick: distinguishes a token-cap truncation on the
    // composition call from a genuine model refusal (thread_1787717774384).
    capsuleCompositionFailureCode: '',
    // thread_1788484052964: what plan_outfit_set actually resolved plan_kind to, and whether the
    // trip roster model call (mirroring the capsule roster's own counters just above) ever fired.
    planKindResolved: '',
    tripRosterModelCalls: 0,
    tripRosterModelRepairs: 0,
    tripRosterModelFallbacks: 0,
    // thread_1788499704803: the authoritative resolved date/location plan_outfit_set actually used
    // (never the raw model argument — the resolved value can silently diverge from it), and
    // whether the date came from the deterministic user-stated extraction or the model's own
    // argument.
    resolvedDateRange: '',
    resolvedLocation: '',
    dateRangeSource: '',
    // Which tools ran in which iteration — the shape of a turn, not just its size.
    toolSequence: '',
    providerIterations: 0,
    providerInputTokens: 0,
    providerOutputTokens: 0,
    providerCacheReadInputTokens: 0,
    providerCacheCreationInputTokens: 0,
    // Cache attribution (docs/deferred-conversational-cache-spec.md): subsets of the two totals
    // above, broken out by which cache_control breakpoint produced them.
    providerImageManifestCacheReadTokens: 0,
    providerImageManifestCacheCreationTokens: 0,
    providerFullStylistSystemCacheCreationTokens: 0,
    providerMovingMessageCacheCreationTokens: 0,
    providerToolLoopCacheReadTokens: 0,
    weatherSource: ''
  })
})

test('whole-wardrobe composer labels expose authoritative opacity and explicit base-layer status', () => {
  assert.equal(
    composerPieceLineSuffix({ fabric_category: 'lace', opacity: 'opaque', needs_base: 'no', tuck_behavior: 'wear_over_only' }),
    '; fabric: lace; opacity: opaque; tuck_behavior: wear_over_only; needs_base: no'
  )
  assert.equal(composerPieceLineSuffix({ opacity: 'sheer', needs_base: 'yes' }), '; opacity: sheer; needs_base: yes')
})

test('whole-wardrobe composer labels expose a piece\'s own do-not-pair rules', () => {
  const piece = {
    fabric_category: 'jersey',
    style_profile_json: {
      garment_intelligence: {
        do_not_pair_rules: ['avoid another loud pattern']
      }
    }
  }
  assert.equal(
    composerPieceLineSuffix(piece),
    '; fabric: jersey; do not pair: avoid another loud pattern'
  )
  assert.equal(composerPieceLineSuffix({ fabric_category: 'cotton' }), '; fabric: cotton')
})

test('compact answer profiles expose only bounded card and garment context', () => {
  const context = compactFreeformContext({
    body: { generatedOutfits: [{ label: 'browser echo', pieceIds: [11, 12, 13] }] },
    state: { current_outfit_set: [{ label: 'server verified', piece_ids: [99] }] }
  })
  assert.deepEqual(context.pieceIds, [99])
  assert.equal(context.outfits[0].label, 'server verified')
  const facts = compactFreeformPieceFacts({ id: 11, name: 'lace top', category: 'top', opacity: 'opaque', needs_base: 'no', photo: 'must-not-leak.jpg' })
  assert.equal(facts.opacity, 'opaque')
  assert.equal(facts.needs_base, 'no')
  assert.equal('photo' in facts, false)
  assert.match(compactFreeformAnswerSystem('existing_card_explanation'), /only the supplied verified outfit cards/)
  assert.match(compactFreeformAnswerSystem('garment_fact'), /only from the supplied structured garment evidence/)
  assert.match(compactFreeformAnswerSystem('general_advice'), /Do not imply that you inspected the wardrobe/)
  assert.match(compactFreeformAnswerSystem('general_advice'), /multiple valid pathways/)
  assert.match(compactFreeformAnswerSystem('general_advice'), /optional signals whose effect depends on the whole outfit—not mandatory ingredients/)
  assert.match(compactFreeformAnswerSystem('general_advice'), /never treat casual clothing as inherently careless, shapeless, or confined to errands/)
  assert.equal(compactProfileHasContext('existing_card_explanation', context), true)
  assert.equal(compactProfileHasContext('existing_card_explanation', { outfits: [] }), false)
  assert.equal(compactProfileHasContext('garment_fact', { pieceIds: [] }), false)
  assert.equal(compactProfileHasContext('general_advice', {}), true)
  const generalMessage = compactFreeformAnswerMessage({
    profile: 'general_advice', question: 'What is smart casual?', context,
    pieces: [{ id: 11, name: 'must not leak' }], state: { established: { occasion: 'private context' } }
  })
  assert.equal(generalMessage, 'Question: What is smart casual?')
})

test('explicit "ID N" garment mentions resolve into compact context, and recent history reaches existing_card_explanation and garment_fact but not general_advice', async () => {
  const { explicitPieceIdMentionsFromQuestion, compactGarmentFactSubjectsIncomplete, compactRecentHistory } = await import('../routes/ai.js')

  // thread_1787387145601 msg 7: "about black blouson top (ID 136) did you try it with ID 127?"
  // Neither ID has a name in the question text for exactNamedPieceIdsFromQuestion to find.
  assert.deepEqual(explicitPieceIdMentionsFromQuestion('about black blouson top (ID 136) did you try it with ID 127?'), [136, 127])
  assert.deepEqual(explicitPieceIdMentionsFromQuestion('what is the fabric on this piece?'), [])
  assert.deepEqual(explicitPieceIdMentionsFromQuestion('ID 136 and ID 136 again'), [136])

  const context = compactFreeformContext({
    body: { generatedOutfits: [{ label: 'lilac cardigan look', pieceIds: [136] }] },
    state: {}
  })
  const explicitMentions = explicitPieceIdMentionsFromQuestion('about black blouson top (ID 136) did you try it with ID 127?')
  const resolvedAgainstActivePieces = explicitMentions.filter(id => [136].includes(id)) // 127 does not resolve
  const merged = compactFreeformContext({
    body: { generatedOutfits: [{ label: 'lilac cardigan look', pieceIds: [136] }] },
    state: {},
    namedPieceIds: resolvedAgainstActivePieces
  })
  assert.deepEqual(merged.pieceIds, [136])
  // Two garments cited by ID, only one resolves — the compact call must not fire on this.
  assert.equal(compactGarmentFactSubjectsIncomplete('about black blouson top (ID 136) did you try it with ID 127?', merged.pieceIds), true)
  // Both resolve — a genuine two-subject garment_fact comparison proceeds.
  assert.equal(compactGarmentFactSubjectsIncomplete('compare ID 136 and ID 127', [136, 127]), false)
  // One subject cited — no completeness concern.
  assert.equal(compactGarmentFactSubjectsIncomplete('is ID 136 breathable?', [136]), false)
  assert.equal(compactGarmentFactSubjectsIncomplete('is ID 136 breathable?', []), false)
  void context

  // thread_1787387145601 msg 5: "hmm, but you had something in mind when you proposed it?" needed
  // the immediately preceding exchange, which the stateless compact call never carried.
  const history = [
    { role: 'user', content: 'can you tell me why Graphic Stripe, Warm Sole did not clear the engine?' },
    { role: 'assistant', content: 'The rejection reason is recorded directly on the card...' },
  ]
  assert.equal(compactRecentHistory(history, 4), [
    'user: can you tell me why Graphic Stripe, Warm Sole did not clear the engine?',
    'assistant: The rejection reason is recorded directly on the card...'
  ].join('\n'))
  assert.equal(compactRecentHistory([], 4), '')
  const cardMessage = compactFreeformAnswerMessage({
    profile: 'existing_card_explanation', question: 'hmm, but you had something in mind when you proposed it?',
    context: { outfits: [] }, history
  })
  assert.match(cardMessage, /Recent conversation \(most recent last\):/)
  assert.match(cardMessage, /The rejection reason is recorded directly on the card/)
  // garment_fact carries the same small window now (thread_1787435527800 msg 16's "these shorts"
  // needed it too) — general_advice still doesn't, since it answers from general knowledge, not
  // from what was just said.
  const garmentMessage = compactFreeformAnswerMessage({
    profile: 'garment_fact', question: 'is this breathable?', context: {}, pieces: [], history
  })
  assert.match(garmentMessage, /Recent conversation \(most recent last\):/)
  const generalAdviceMessage = compactFreeformAnswerMessage({
    profile: 'general_advice', question: 'what is smart casual?', context: {}, pieces: [], history
  })
  assert.doesNotMatch(generalAdviceMessage, /Recent conversation/)
})

test('a vague "these shorts" reference resolves against the immediately preceding exchange, not every bottom in the current cards', async () => {
  const { recentReferentPieceIds } = await import('../routes/ai.js')

  // thread_1787435527800: msg 15 named "the tan shorts" specifically as part of Abstract City Walk;
  // msg 16 then said "These shorts are a bit large" one turn later. Four bottoms existed across the
  // accumulated current-card set (tan straight shorts, olive cargo shorts, beige capris, olive
  // cropped pants) — msg 17 listed all four and asked which one, instead of using the one just named.
  const pieces = [
    { id: 601, name: 'tan straight shorts' },
    { id: 602, name: 'olive cargo drawstring shorts' },
    { id: 603, name: 'beige capris' },
    { id: 604, name: 'olive utility cropped pants' },
  ]
  const history = [
    { role: 'user', content: 'which one looks more put together?' },
    { role: 'assistant', content: 'Abstract City Walk looks more put together. The abstract print tank is a clear hero, the tan shorts are a clean, quiet base, and the light grey sneakers connect back to the grey in the print.' },
  ]
  assert.deepEqual(recentReferentPieceIds('These shorts are a bit large. Can I wear a belt?', history, pieces), [601])

  // Both "shorts" candidates named in the recent exchange — ambiguous, no override.
  const bothNamedHistory = [
    { role: 'user', content: 'compare the two' },
    { role: 'assistant', content: 'the tan straight shorts read cleaner than the olive cargo drawstring shorts.' },
  ]
  assert.deepEqual(recentReferentPieceIds('These shorts are a bit large.', bothNamedHistory, pieces), [])

  // Nothing recent to resolve against — no override, existing fallback applies.
  assert.deepEqual(recentReferentPieceIds('These shorts are a bit large.', [], pieces), [])

  // No category word in the question — not this mechanism's job.
  assert.deepEqual(recentReferentPieceIds('is this comfortable?', history, pieces), [])
})

// Batched discovery acceptance case 1. The coverage arc failed twice on this: thread_1787127928718
// discussed only the four visually sampled shoes, and thread_1787128659041 dropped deserving
// candidates before visual refinement. A piece without a photograph must stay a candidate.
test('a piece with no photograph is still returned by a batched search', async () => {
  const withPhoto = db.prepare("INSERT INTO pieces (name, category, status, photo) VALUES ('pictured probe top', 'top', 'active', 'nonexistent.jpg')").run().lastInsertRowid
  const withoutPhoto = db.prepare("INSERT INTO pieces (name, category, status) VALUES ('unpictured probe top', 'top', 'active')").run().lastInsertRowid
  try {
    const res = await executeTool('search_wardrobe', { category: ['top'], visual: true }, { freeformDiagnostics: {} })
    const returned = new Set(res.filter(item => item.id).map(item => Number(item.id)))
    assert.ok(returned.has(Number(withoutPhoto)), 'an unpictured piece must not be filtered out of retrieval')
    assert.ok(returned.has(Number(withPhoto)))
    // The visual budget limits which pieces get a THUMBNAIL, never which pieces exist. If that ever
    // becomes a filter, unpictured candidates go invisible and the model reports a false gap.
    const row = res.find(item => Number(item.id) === Number(withoutPhoto))
    assert.ok(row.name, 'it comes back as a full truth row, just without an image')
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?)').run(withPhoto, withoutPhoto)
  }
})

// Source-asserted deliberately. Exercising the real budget needs 17+ seeded pieces WITH photo files
// on disk per category, which would make this a slow fixture test of image plumbing rather than of
// the property that matters. The property: the visual budget is ranked PER CATEGORY, so a batched
// four-category search cannot let the first category eat every thumbnail.
//
// This is load-bearing for two commitments at once. Visual grounding is a founding principle of this
// app, and batched discovery's first acceptance case says unpictured candidates must not become
// invisible — both fail silently if someone "simplifies" this to a per-call index.
test('the search image budget is ranked per category, so batching cannot starve later categories', () => {
  const toolsSrc = fs.readFileSync(path.join(process.cwd(), 'styling-engine/tools.js'), 'utf8')
  const searchCase = toolsSrc.slice(
    toolsSrc.indexOf("case 'search_wardrobe'"),
    toolsSrc.indexOf("case 'view_pieces'")
  )
  // A per-category counter, not the row's position in the whole result set.
  assert.match(searchCase, /seenPerCategory/, 'per-category ranking must exist')
  assert.match(searchCase, /visualRankByPiece\.set\(p\.id, rank\)/)
  assert.match(searchCase, /const visualRank = visualRankByPiece\.get\(p\.id\)/)
  assert.match(searchCase, /visual && visualRank < perCategoryVisualCap/,
    'the cap must be applied to the per-category rank, never to the flat index')
  // docs/search-wardrobe-visual-budget-spec.md — a single category still gets the full ceiling,
  // and no category is starved below the floor purely because other categories were also asked for.
  assert.match(searchCase, /visualCategoryCount <= 1[\s\S]*?SEARCH_WARDROBE_VISUAL_CAP/,
    'a single-category call must keep the full per-category ceiling')
  assert.match(searchCase, /SEARCH_WARDROBE_VISUAL_FLOOR/,
    'a call-level cap must not be allowed to starve a category below the floor')
  // The tool description promises this, and the promise is what makes batching safe to encourage.
  const description = STYLIST_TOOLS.find(tool => tool.name === 'search_wardrobe').description
  assert.match(description, /image budget is per category/)
  assert.match(description, /category` accepts an array/)
})

test('one batched search covers several categories and reports no compromise when it finds them', async () => {
  const ids = [
    db.prepare("INSERT INTO pieces (name, category, status, colors) VALUES ('batch probe tee', 'top', 'active', '[\"blue\"]')").run().lastInsertRowid,
    db.prepare("INSERT INTO pieces (name, category, status, colors) VALUES ('batch probe trouser', 'bottom', 'active', '[\"black\"]')").run().lastInsertRowid,
    db.prepare("INSERT INTO pieces (name, category, status, colors) VALUES ('batch probe loafer', 'shoes', 'active', '[\"tan\"]')").run().lastInsertRowid,
  ]
  try {
    // The gallery run spent one provider round-trip per category. One call covers them all.
    const res = await executeTool('search_wardrobe', { category: ['top', 'bottom', 'shoes'] }, { freeformDiagnostics: {} })
    const found = new Set(res.filter(item => item.id).map(item => Number(item.id)))
    for (const id of ids) assert.ok(found.has(Number(id)), `batched search must return the ${id} piece`)
    assert.ok(!res.some(item => item.retrieval), 'every requested category was satisfied, so there is nothing to report')
  } finally {
    for (const id of ids) db.prepare('DELETE FROM pieces WHERE id = ?').run(id)
  }
})

test('broadening climbs a fixed ladder and never relaxes category, status or exclusions', async () => {
  const id = db.prepare("INSERT INTO pieces (name, category, status, colors, silhouette) VALUES ('ladder probe skirt', 'bottom', 'active', '[\"olive\"]', 'a-line')").run().lastInsertRowid
  const inactive = db.prepare("INSERT INTO pieces (name, category, status, colors) VALUES ('ladder probe archived', 'bottom', 'inactive', '[\"olive\"]')").run().lastInsertRowid
  try {
    // A free-text anchor that matches nothing: rung 1 drops the query rather than costing the model
    // a round-trip to discover the emptiness itself.
    const ctx = { freeformDiagnostics: {} }
    const res = await executeTool('search_wardrobe', { query: 'nonexistent sequined cape', category: ['bottom'] }, ctx)
    const summary = res.find(item => item.retrieval)?.retrieval
    assert.ok(summary, 'a broadened search says so')
    assert.equal(summary.broadened, true)
    assert.ok(summary.relaxedFilters.includes('query'), 'free text is the first rung')
    assert.deepEqual(summary.requestedCategories, ['bottom'])

    const returnedIds = res.filter(item => item.id).map(item => Number(item.id))
    assert.ok(returnedIds.includes(Number(id)), 'broadening returns the closest active pieces')
    // The three things no rung may ever touch.
    assert.ok(!returnedIds.includes(Number(inactive)), 'broadening never resurrects an inactive piece')
    for (const item of res) {
      if (!item.id) continue
      assert.equal(item.category, 'bottom', 'broadening never widens the requested category')
    }
    // Internal re-entry stays internal: one search the model made is one search recorded.
    assert.equal(ctx.freeformDiagnostics.searchCalls, 1, 'climbing rungs is not extra searches')
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?)').run(id, inactive)
  }
})

test('broadening does not let the model claim the narrow thing it searched for exists', async () => {
  // The false-claim guard keys on queries that returned nothing. Broadening finds *other* pieces, so
  // without this ordering the original named garment would stop being recorded and the answer could
  // describe a garment the wardrobe does not have -- the exact failure zeroResultQueries exists for.
  const ctx = { freeformDiagnostics: {} }
  await executeTool('search_wardrobe', { query: 'cream sequined opera cape', category: ['bottom'] }, ctx)
  assert.ok(Array.isArray(ctx.zeroResultQueries), 'the empty narrow query is still recorded')
  assert.ok(ctx.zeroResultQueries.includes('cream sequined opera cape'))
})

test('a category with nothing in it is reported as a real shortfall, not hidden by broadening', async () => {
  const ctx = { freeformDiagnostics: {} }
  // Nothing is seeded for this category in this fixture wardrobe, so no amount of relaxing finds one.
  const res = await executeTool('search_wardrobe', { query: 'anything at all', category: ['outerwear'] }, ctx)
  const summary = res.find(item => item.retrieval)?.retrieval
  assert.ok(summary, 'a shortfall is always reported')
  assert.deepEqual(summary.shortfalls, ['outerwear'])
  assert.match(summary.note, /real wardrobe shortfall, not a narrow search/)
  assert.equal(ctx.freeformDiagnostics.searchCalls, 1)
})

test('category-scoped coverage answers from one result instead of three retrieval steps', async () => {
  // thread_1787188412205 spent wardrobe_coverage -> search_wardrobe -> view_pieces before answering,
  // because counts said HOW MANY and never WHICH. Coverage is already the intent-specific primitive,
  // so it carries the evidence.
  const ids = [
    db.prepare("INSERT INTO pieces (name, category, status, walk_support, formality) VALUES ('census probe flat', 'shoes', 'active', 'medium', 'elevated')").run().lastInsertRowid,
    db.prepare("INSERT INTO pieces (name, category, status, walk_support, formality) VALUES ('census probe sneaker', 'shoes', 'active', 'high', 'everyday')").run().lastInsertRowid,
  ]
  try {
    // Above the manifest cap there is no manifest to read from, so full truth travels with the row.
    const noManifest = await executeTool('wardrobe_coverage', { group_by: 'formality', category: 'shoes' }, { freeformDiagnostics: {} })
    assert.ok(noManifest.counts, 'the coverage maths is still there')
    assert.equal(noManifest.candidates.length, noManifest.total_pieces, 'the census is complete, never sampled')
    const full = noManifest.candidates.find(c => Number(c.id) === Number(ids[0]))
    assert.equal(full.walk_support, 'medium', 'latent physical truth travels when nothing else carries it')
    assert.equal(full.formality, 'elevated')

    // With the manifest present the model already holds every stable field, so repeating them here
    // would duplicate the manifest one category at a time — measured at 16.3k tokens for 88 tops.
    // What coverage uniquely adds is the CLOSED SET, so identity is enough.
    const res = await executeTool('wardrobe_coverage', { group_by: 'formality', category: 'shoes' },
      { freeformDiagnostics: {}, wardrobeManifestIncluded: true })
    assert.equal(res.candidates.length, res.total_pieces, 'still complete, still never sampled')
    const probe = res.candidates.find(c => Number(c.id) === Number(ids[0]))
    assert.deepEqual(Object.keys(probe).sort(), ['id', 'name'], 'identity only; the manifest carries the truth')
    assert.match(res.candidates_note, /already in the wardrobe manifest/)
    assert.ok(JSON.stringify(res).length < JSON.stringify(noManifest).length / 2, 'and it is dramatically smaller')
  } finally {
    for (const id of ids) db.prepare('DELETE FROM pieces WHERE id = ?').run(id)
  }
})

test('unscoped coverage stays counts-only, and the census is never ranked or capped', async () => {
  const ctx = { freeformDiagnostics: {} }
  // Without a category the scope is the whole active wardrobe, where the manifest already carries
  // identity — dumping every row would be the prompt over again.
  const unscoped = await executeTool('wardrobe_coverage', { group_by: 'category' }, ctx)
  assert.ok(unscoped.counts)
  assert.equal(unscoped.candidates, undefined)

  // Scoped: complete, and in stable id order rather than a relevance ranking. Ranking would
  // reintroduce the failure the coverage arc hit twice — a piece the model never saw cannot be
  // judged, and the ones dropped were owner-confirmed.
  const scoped = await executeTool('wardrobe_coverage', { group_by: 'formality', category: 'shoes' }, ctx)
  const ids = scoped.candidates.map(c => Number(c.id))
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), 'stable id order, not a ranking')
  assert.equal(new Set(ids).size, ids.length, 'each piece appears exactly once')
  assert.match(scoped.candidates_note, /not a sample/)
  assert.match(scoped.candidates_note, /no photograph is still a candidate/)
})

test('a one-piece evaluation gets its own narrow prompt, not the stylist manual', async () => {
  // /evaluate-piece used to omit `system` and inherit askStylist's default, STYLIST_SYSTEM, so a
  // question about a single garment carried outfit-set policy, capsule rules, proposal mechanics and
  // trip planning. That call passes NO tools, so the tool instructions were unreachable as well as
  // irrelevant. Owner ruling 2026-08-20: it gets an explicit narrow prompt.
  const { buildPrompts } = await import('../styling-engine/prompts.js')
  const { LEGACY_PROFILE, LEGACY_CONSTITUTION } = await import('../styling-engine/constitutionSeed.js')
  const built = buildPrompts({ profile: LEGACY_PROFILE, constitution: LEGACY_CONSTITUTION })
  const evaluate = built.EVALUATE_PIECE_SYSTEM

  // What it must carry: the owner's list.
  assert.match(evaluate, /corrected truth and overrides anything you think you see in the photo/i, 'garment truth')
  assert.match(evaluate, /An inference may never silently become a verified fact/i, 'evidence provenance')
  assert.match(evaluate, /Never invent a garment, a fact, or a feature/i, 'no hallucinated facts')
  assert.match(evaluate, /the owner's note wins/i, 'owner and manual facts outrank inference')
  assert.match(evaluate, /Answer that question/i, 'answer the piece question')

  // What it must not: the multi-outfit machinery this ruling exists to remove.
  for (const machinery of ['plan_outfit_set', 'propose_outfit', 'submit_plan_outfits', 'piece_budget', 'declare_intent', 'shared_anchor_ids']) {
    assert.ok(!evaluate.includes(machinery), `a one-piece evaluation must not carry ${machinery}`)
  }
  assert.ok(evaluate.length < built.STYLIST_SYSTEM.length / 4,
    `expected a narrow prompt, got ${evaluate.length} against ${built.STYLIST_SYSTEM.length}`)

  // And the route must actually pass it. Source-asserted because the endpoint's own mock path does
  // not reveal which system prompt was chosen, and the bug being guarded is an OMISSION -- the call
  // still works when the argument is missing, which is exactly why it went unnoticed.
  const routeSrc = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  const evaluateRoute = routeSrc.slice(routeSrc.indexOf("router.post('/evaluate-piece'"), routeSrc.indexOf("mode: 'evaluate_piece'"))
  assert.match(evaluateRoute, /system: prompts\.EVALUATE_PIECE_SYSTEM/,
    'the evaluate_piece branch must pass its prompt explicitly, never inherit the default')
})

test('the stylist prompt states no global material absolutes', async () => {
  // Owner ruling 2026-08-20. Three rules read as authoritative law while being globally false, and
  // one of them — "silk, satin, chiffon → always wear_over_only REGARDLESS OF NOTES" — overrode the
  // owner's own note about their own garment, which the evidence-provenance ladder calls the
  // strongest evidence there is. Silk blouses are tucked routinely; the rule was an incident
  // generalised to a material name and shipped to every user of a multiuser app.
  //
  // Structured truth (tuck_behavior) carries the general case; per-piece RULES carry the specific
  // one. That mechanism already exists in the same prompt under EARNED WISDOM OVERRIDE.
  const { buildPrompts } = await import('../styling-engine/prompts.js')
  const { LEGACY_PROFILE, LEGACY_CONSTITUTION } = await import('../styling-engine/constitutionSeed.js')
  const system = buildPrompts({ profile: LEGACY_PROFILE, constitution: LEGACY_CONSTITUTION }).STYLIST_SYSTEM

  assert.doesNotMatch(system, /regardless of notes/i,
    'nothing may override an owner note about their own garment')
  assert.doesNotMatch(system, /cannot hold a tuck/i)
  assert.doesNotMatch(system, /never suggest tucking them/i)
  assert.doesNotMatch(system, /Never recommend heels, wedges, or delicate shoes/i)
  assert.doesNotMatch(system, /Never pair two "loud" pieces/i)

  // The replacements keep the caution and drop the law.
  assert.match(system, /may be less stable when tucked/)
  assert.match(system, /Do not infer "wear over only" from the material name alone/)
  assert.match(system, /the owner's note wins/)
  assert.match(system, /a low block heel may be acceptable where saved comfort evidence supports it/)
  assert.match(system, /Deliberate print or colour mixing is allowed when hierarchy, palette and scale are controlled/)

  // The mechanism that should carry owner-specific truth is still there and still authoritative.
  assert.match(system, /RULES \(authoritative\)/)
})

test('piece IDs are a verification scaffold, not product copy', () => {
  // Owner ruling 2026-08-20: acceptance case 7 wins over the "(ID <n>)" citation requirement. The
  // app may require handles internally; the reader should never see them.
  const cases = [
    ['**Black slip-on loafers** (ID 196) — minimalist suede.', '**Black slip-on loafers** — minimalist suede.'],
    ['Pair the tee (ID 12) with the trousers (ID 34).', 'Pair the tee with the trousers.'],
    ['Try IDs 169, 361 together.', 'Try together.'],
    ['Start with the shell [ID 204].', 'Start with the shell.'],
    ['The cutout flats (ID 204) and loafers (ID 196) both work.', 'The cutout flats and loafers both work.'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(stripPieceIdCitations(input), expected)
  }

  // Must not touch text that merely contains digits or the letters "ID".
  for (const untouched of [
    'The 501 jeans work here.',
    'That IDEA is worth trying.',
    'Wear it with the 3/4 sleeve knit.',
    'A 90s silhouette, cropped at the waist.',
  ]) {
    assert.equal(stripPieceIdCitations(untouched), untouched, `must not rewrite: ${untouched}`)
  }

  // Removing a mid-sentence citation must not leave its separators behind. The bracketed form the
  // prompt mandates never hits this, but the model does sometimes cite inline.
  assert.equal(stripPieceIdCitations('The loafers, ID 196, work.'), 'The loafers, work.')
  assert.equal(stripPieceIdCitations('- ID 196\n- ID 204'), '', 'a bullet that was only a citation is dropped, not left as a stray dash')

  // Line structure survives, because answers are markdown with lists and headings.
  const markdown = '**The reliable two:**\n- **Cutout flats** (ID 204) — pointed toe.\n- **Loafers** (ID 196) — suede.'
  assert.equal(stripPieceIdCitations(markdown), '**The reliable two:**\n- **Cutout flats** — pointed toe.\n- **Loafers** — suede.')
})

test('an accepted card has authority over the closing prose that comments on it', () => {
  const ctx = () => ({
    generatedOutfits: [{ label: 'Quiet column', pieceIds: [11, 12, 13], pieces: [{ id: 11 }, { id: 12 }, { id: 13 }] }],
    freeformDiagnostics: {},
  })

  // Ordinary commentary about the accepted card is untouched.
  const good = 'The shell keeps the top half quiet so the trousers carry the shape.'
  assert.equal(applyAcceptedCardAuthority(good, ctx()), good)

  // Showing the turn's working is not the product. (Live: the sparse run narrated each lookup.)
  const narrated = `Let me search the wardrobe for a top.\n\n${good}`
  const trimmed = applyAcceptedCardAuthority(narrated, ctx())
  assert.equal(trimmed, good, 'retrieval narration is dropped, the styling prose survives')

  // Reintroducing a piece the composition did not accept. (Live: the sparse run contradicted itself
  // about a piece that never made the card.)
  const contradicting = `${good}\n\nI nearly used the taupe boots (ID 359), which would also have worked.`
  assert.equal(applyAcceptedCardAuthority(contradicting, ctx()), good)

  // A paragraph citing only accepted pieces is fine -- the rule is about candidates outside the card,
  // not about mentioning IDs at all.
  const citesAccepted = `${good}\n\nThe trousers (ID 12) are doing the most work here.`
  assert.equal(applyAcceptedCardAuthority(citesAccepted, ctx()), citesAccepted)

  // Diagnostics record that something was withheld, so a bad turn is reconstructable.
  const counted = ctx()
  applyAcceptedCardAuthority(contradicting, counted)
  assert.equal(counted.freeformDiagnostics.closingProseWithheld, 1)
})

// Live case (thread_1788053088737): propose_outfit succeeded via the real tool call, and the model
// ALSO dumped the same payload as a ```outfit fenced JSON block in its free-text closing answer.
// Nothing renders that fence specially, so it would have shown as literal JSON in the chat. The
// existing ID-citation check does not catch this: `"id": 70` does not match the (ID n) citation
// regex at all.
test('a fenced raw-JSON payload in the closing prose is withheld like any other exposed machinery', () => {
  const ctx = () => ({
    generatedOutfits: [{ label: 'Rainy Commute', pieceIds: [70, 191, 996763], pieces: [{ id: 70 }, { id: 191 }, { id: 996763 }] }],
    freeformDiagnostics: {},
  })
  const good = 'Layer the blouse under the raincoat with the ankle boots for wet pavements.'
  const leaked = `Here is the outfit proposal for your rainy commute:\n\n${good}\n\n\`\`\`outfit\n{\n "label": "Rainy Commute Trench Look",\n "pieces": [{"id": 70, "role": "primary_top"}]\n}\n\`\`\``
  const result = applyAcceptedCardAuthority(leaked, ctx())
  assert.ok(!result.includes('```'), 'the fenced JSON block must never reach the reader')
  assert.ok(!result.includes('"role"'), 'raw JSON keys must never reach the reader')
  assert.ok(result.includes(good), 'the legitimate styling paragraph survives alongside the intro')

  // A fenced block that is NOT JSON (a real markdown code example, however unlikely in this domain)
  // must not be caught by the same net -- the rule is specifically about raw structured data, not
  // fences in general.
  const notJson = `${good}\n\n\`\`\`\nHold the collar flat, tuck once.\n\`\`\``
  assert.equal(applyAcceptedCardAuthority(notJson, ctx()), notJson)
})

test('the deliberation vocabulary does not eat legitimate styling instructions', async () => {
  // This predicate also gates the card's own styling_instructions, so a loose term deletes advice
  // rather than leaking a sentence. "instead of the" and "rejected" were drafted into it and pulled
  // before shipping for exactly this reason — the same failure as the earlier detector that erased
  // instructions containing "wait" or "must use".
  const { exposesComposerDeliberation } = await import('../styling-engine/rules.js')
  for (const instruction of [
    'Wear the cardigan open instead of the belted version.',
    'Ground it with the loafers instead of the sandals.',
    'Push the sleeves instead of the full cuff.',
    'Belt it over the cardigan at the natural waist.',
    // The broadening vocabulary added 2026-08-19 collides with real styling language: "relaxed" is
    // a silhouette and a jacket can broaden a shoulder. These must survive.
    'The relaxed wide-leg trousers balance the fitted top.',
    'A relaxed silhouette needs one sharp edge to hold it together.',
    'The jacket broadens the shoulder line, so keep the bottom narrow.',
    'Push the sleeves up so the cuff sits below the elbow.',
  ]) {
    assert.equal(exposesComposerDeliberation(instruction), false, `must not withhold: ${instruction}`)
  }
  for (const leak of [
    'Let me search the wardrobe for a top.',
    'No results for lightweight jackets, so I broadened.',
    'Checking the recently-shown list first.',
    'Rebuilding that look around the trousers.',
    // search_wardrobe reports the filters it relaxed. That report is for the model's reasoning, not
    // for the reader — quoting it into the answer is machinery in user-facing prose.
    'I relaxed the color filter to find these.',
    'No exact match for the original filters.',
    'I dropped the neckline requirement to widen the search.',
    'I broadened the search to find these.',
    'relaxedFilters: [query, color]',
  ]) {
    assert.equal(exposesComposerDeliberation(leak), true, `must withhold: ${leak}`)
  }
})

test('accepted-card authority applies only when a card was actually accepted', () => {
  // A prose turn has no card to defer to, so its answer is the product and is never filtered --
  // otherwise the guard would eat ordinary conversational answers.
  const prose = 'Let me check the difference: smart casual keeps structure, casual does not.'
  assert.equal(applyAcceptedCardAuthority(prose, { generatedOutfits: [], freeformDiagnostics: {} }), prose)
  assert.equal(applyAcceptedCardAuthority(prose, { freeformDiagnostics: {} }), prose)

  // A turn whose only cards are broken has nothing accepted either.
  const brokenOnly = { generatedOutfits: [{ broken: true, pieceIds: [11] }], freeformDiagnostics: {} }
  assert.equal(applyAcceptedCardAuthority(prose, brokenOnly), prose)
})

test('closing prose that is entirely withheld is replaced locally, not left empty', () => {
  const ctx = {
    generatedOutfits: [
      { label: 'One', pieceIds: [11], pieces: [{ id: 11 }] },
      { label: 'Two', pieceIds: [12], pieces: [{ id: 12 }] },
    ],
    freeformDiagnostics: {},
  }
  const allBad = 'Let me search for a better top.\n\nI nearly used the cream shell (ID 999) along the way.'
  const result = applyAcceptedCardAuthority(allBad, ctx)
  assert.match(result, /Here are 2 looks/, 'the reply says what was delivered rather than going blank beside the cards')
  assert.doesNotMatch(result, /search|rejected|999/)
  assert.equal(ctx.freeformDiagnostics.closingProseWithheld, 2)
})

test('compact router eligibility requires context the compact profiles can actually use', () => {
  const noContext = { outfits: [], pieceIds: [] }

  // A fresh request can reach any profile, so it is always eligible.
  assert.equal(compactRouterTurnHasContext('new_request', noContext), true)
  assert.equal(compactRouterTurnHasContext(undefined, noContext), true)

  // Follow-ups/corrections qualify only through the context a compact profile needs.
  assert.equal(compactRouterTurnHasContext('followup', { outfits: [{ index: 1 }], pieceIds: [] }), true)
  assert.equal(compactRouterTurnHasContext('correction', { outfits: [], pieceIds: [264] }), true)
  assert.equal(compactRouterTurnHasContext('explanation', { outfits: [{ index: 1 }], pieceIds: [264] }), true)

  // The turn this narrowing exists to stop: a follow-up carrying neither a verified card set nor a
  // resolved subject cannot reach a context-bearing compact profile, so it must not buy a router
  // call before the full loop it is going to pay for anyway.
  assert.equal(compactRouterTurnHasContext('followup', noContext), false)
  assert.equal(compactRouterTurnHasContext('correction', {}), false)

  // compactFreeformContext is what feeds this, and it folds every subject route into pieceIds —
  // activeContext, body pieceIds, exact named pieces and pieces inside current cards.
  const fromActiveContext = compactFreeformContext({ body: { activeContext: { type: 'piece', id: 264 } } })
  assert.equal(compactRouterTurnHasContext('followup', fromActiveContext), true)
  const fromCardPieces = compactFreeformContext({ body: {}, state: { current_outfit_set: [{ index: 1, piece_ids: [92] }] } })
  assert.equal(compactRouterTurnHasContext('followup', fromCardPieces), true)
  assert.equal(compactRouterTurnHasContext('followup', compactFreeformContext({ body: {} })), false)
})

test('compact garment facts attach bounded saved hanger and worn evidence', async () => {
  const uploadsDir = path.join(tmpRoot, 'compact-visuals')
  fs.mkdirSync(uploadsDir, { recursive: true })
  const sharp = (await import('sharp')).default
  for (const filename of ['hanger.png', 'worn.png']) {
    await sharp({ create: { width: 12, height: 12, channels: 3, background: '#f4f0ea' } })
      .png()
      .toFile(path.join(uploadsDir, filename))
  }
  const blocks = await compactGarmentVisualEvidence([{
    id: 364,
    name: 'white scoop neck sleeveless top',
    photo: 'hanger.png',
    worn_photo: 'worn.png'
  }], { uploadsDir, maxImages: 2 })
  assert.deepEqual(blocks.filter(block => block.type === 'text').map(block => block.text), [
    'Saved worn photo for white scoop neck sleeveless top:',
    'Saved hanger photo for white scoop neck sleeveless top:'
  ])
  assert.equal(blocks.filter(block => block.type === 'image').length, 2)
  assert.ok(blocks.filter(block => block.type === 'image').every(block => block.source.media_type === 'image/jpeg'))
  assert.ok(blocks.filter(block => block.type === 'image').every(block => block.source.type === 'base64'))
  assert.match(compactFreeformAnswerSystem('garment_fact'), /worn photograph showing the requested configuration/)
  assert.match(compactFreeformAnswerSystem('garment_fact'), /do not ask the user to upload/)
  assert.match(compactFreeformAnswerSystem('garment_fact'), /proves only that the configuration is physically possible/)
  assert.match(compactFreeformAnswerSystem('garment_fact'), /Do not pretend an unseen alternative is proven better/)
  assert.match(compactFreeformAnswerSystem('garment_fact'), /cannot establish exact fiber composition/)
  assert.match(compactFreeformAnswerSystem('garment_fact'), /do not guess cotton, wool, viscose, modal or a blend/)
})

// thread_1787728618995: asked whether a lace-sleeve blouse could layer over a turtleneck, the
// compact garment_fact answer confidently said the pairing worked ("solves both problems at
// once") despite both pieces carrying sleeve_length: "long" in the supplied structured facts —
// answerable from text alone, no image needed. The original fix (a private prose rule naming a
// retired `sleeve_type` field the compact model was never even supplied) was replaced with a
// canonical outfitValidation.js verdict shared by propose_outfit/plan/capsule validation — see
// evaluateLayerPairConstruction in styling-engine/outfitValidation.js and its census correction.
// garment_fact now defers to that verdict instead of restating sleeve/fabric thresholds itself.
test('garment_fact defers to the computed layering-evidence block instead of restating sleeve rules itself', () => {
  const system = compactFreeformAnswerSystem('garment_fact')
  assert.match(system, /layering one garment over or under another/)
  assert.match(system, /"Layering evidence \(computed\)" block/)
  assert.match(system, /that verdict is authoritative/)
  assert.doesNotMatch(system, /sleeve_type/, 'must not cite the retired sleeve_type field')
})

test('compactGarmentFactLayeringEvidence computes the canonical verdict for the original incident, now conservative under missing evidence', async () => {
  const { compactGarmentFactLayeringEvidence } = await import('../routes/ai.js')
  // Original incident evidence: both long-sleeve, neither sleeve_shape nor fabric_weight supplied.
  // The old prose rule would have had the model guess; the shared verdict now reports "unknown"
  // instead of a confident wrong "works" OR a crude wrong "never works" — matches the owner
  // correction that two long sleeves alone is not proof of conflict.
  const blouse = { id: 201, name: 'lace-sleeve blouse', category: 'top', sleeve_length: 'long' }
  const turtleneck = { id: 202, name: 'turtleneck', category: 'top', sleeve_length: 'long' }
  const unknownLines = compactGarmentFactLayeringEvidence([blouse, turtleneck])
  assert.equal(unknownLines.length, 1)
  assert.match(unknownLines[0], /unknown/)

  // Known conflict: the INNER garment's voluminous sleeve is trapped under a narrow, structured
  // OUTER sleeve — direction resolved from the outer piece's explicit top-layer evidence ("cardigan"
  // in its garment text, per pieceHasExplicitTopLayerEvidence), both still category "top" so this
  // pair still passes compactGarmentFactLayeringEvidence's top/dress-only candidate filter.
  const voluminousInner = { id: 203, name: 'voluminous-sleeve base top', category: 'top', sleeve_length: 'long', sleeve_shape: 'voluminous', fabric_weight: 'light' }
  const structuredOuterLayer = { id: 204, name: 'structured cardigan layer', category: 'top', sleeve_length: 'long', sleeve_shape: 'fitted', fabric_weight: 'light' }
  const conflictLines = compactGarmentFactLayeringEvidence([voluminousInner, structuredOuterLayer])
  assert.equal(conflictLines.length, 1)
  assert.match(conflictLines[0], /incompatible/)

  // Known compatible: two fitted, lightweight, cuffed-sleeve garments — the case the owner
  // explicitly said must not be crudely rejected just for both being long-sleeve.
  const fittedTee = { id: 205, name: 'fitted long-sleeve tee', category: 'top', sleeve_length: 'long', sleeve_shape: 'fitted', fabric_weight: 'light' }
  const fittedBase = { id: 206, name: 'fitted base layer', category: 'top', sleeve_length: 'long', sleeve_shape: 'straight', fabric_weight: 'ultralight' }
  assert.deepEqual(compactGarmentFactLayeringEvidence([fittedTee, fittedBase]), [])

  // A single subject produces no pair at all.
  assert.deepEqual(compactGarmentFactLayeringEvidence([blouse]), [])
})

test('full-stylist history bounding keeps recent complete exchanges within both budgets', async () => {
  const { boundFreeformConversationHistory } = await import('../styling-engine/core.js')
  const history = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${index}:${'x'.repeat(index === 11 ? 5000 : 900)}`
  }))
  const bounded = boundFreeformConversationHistory(history)
  assert.ok(bounded.messages.length <= 8)
  assert.equal(bounded.messages[0].role, 'user')
  assert.match(bounded.messages.at(-1).content, /11:/)
  assert.ok(bounded.messages.every(message => message.content.length <= 3500))
  assert.ok(bounded.messages.reduce((sum, message) => sum + message.content.length, 0) <= 12000)
  assert.equal(bounded.diagnostics.historyMessagesReceived, 12)
  assert.equal(bounded.diagnostics.historyMessagesIncluded, bounded.messages.length)
  assert.ok(bounded.diagnostics.historyCharsRemoved > 0)
})

test('bounded history trims only prior prose; structured thread state and the current question remain', async () => {
  const { buildStylistConversationPayload, saveStylistConversationState } = await import('../styling-engine/core.js')
  {
    const sessionId = `bounded-history-${Date.now()}`
    saveStylistConversationState({
      established: { occasion: 'city', weather: 'mild' },
      current_outfit_set: [{ index: 1, label: 'Verified card', piece_ids: [11, 12, 13] }]
    }, sessionId)
    const question = 'Why does the second option work better?'
    const history = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `historical message ${index}`
    })).concat({ role: 'user', content: question })
    const payload = await buildStylistConversationPayload({
      sessionId, conversationMode: 'followup', question, history
    })
    assert.ok(payload.messages.length <= 9, 'at most eight prior messages plus the current turn')
    assert.equal(payload.messages.at(-1).role, 'user')
    assert.match(String(payload.messages.at(-1).content), /Why does the second option work better/)
    assert.equal(payload.threadState.established.occasion, 'city')
    assert.equal(payload.threadState.current_outfit_set[0].label, 'Verified card')
    assert.equal(payload.historyDiagnostics.historyMessagesReceived, 12, 'the duplicate current question is removed before bounding')
    assert.ok(payload.historyDiagnostics.historyMessagesIncluded < 12)
  }
})

test('the wardrobe manifest is the only prompt representation of the closet', async () => {
  // The tiered discovery index was removed 2026-08-19: its identity guarantee is worth keeping, but
  // the implementation was coupled to the sequential tool loop that failed the cost test. Batched
  // discovery reintroduces only the identity representation it actually needs. Until then the
  // manifest is the single representation, and no flag may switch it.
  const { buildStylistConversationPayload } = await import('../styling-engine/core.js')
  db.prepare("INSERT INTO pieces (name, category, status, reads_as) VALUES (?, ?, 'active', ?)")
    .run('test discovery shirt', 'top', 'quiet blue shirt')
  try {
    process.env.WARDROBE_FREEFORM_TIERED_DISCOVERY = 'true'
    const payload = await buildStylistConversationPayload({
      question: 'What tops do I own?', conversationMode: 'new_request', sessionId: 'manifest-only'
    })
    assert.equal(payload.wardrobeManifestIncluded, true)
    assert.equal(payload.wardrobeDiscoveryIndexIncluded, undefined, 'the discovery-index diagnostic is gone')
    assert.match(payload.system, /WARDROBE MANIFEST/)
    assert.doesNotMatch(payload.system, /WARDROBE DISCOVERY INDEX/, 'the removed flag must not resurrect the index')
    assert.match(payload.system, /Reason directly from it for coverage/)
  } finally {
    delete process.env.WARDROBE_FREEFORM_TIERED_DISCOVERY
    db.prepare("DELETE FROM pieces WHERE name = ?").run('test discovery shirt')
  }
})

test('the message array stays a cacheable prefix across turns until the history window slides', async () => {
  // Anthropic matches prompt cache on exact prefix, so a turn's user message must be byte-identical
  // to the way browser history replays it next turn. It previously was not: the sent message carried
  // a "Today is …" line that history never replays, so message 0 differed on every follow-up and the
  // whole message array missed cache. The date lives in the volatile system half instead.
  const { buildStylistConversationPayload } = await import('../styling-engine/core.js')
  const { PROMPT_CACHE_BREAKPOINT } = await import('../styling-engine/provider.js')
  const contentOf = message => typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content)

  const ask = (question, history) => buildStylistConversationPayload({
    question, history, conversationMode: 'new_request', sessionId: 'cache-shape', currentDate: '2026-06-01'
  })

  const q1 = 'What should I wear to a gallery opening?'
  const a1 = 'A quiet column with one graphic decision.'
  const t1 = await ask(q1, [])
  assert.equal(contentOf(t1.messages.at(-1)), q1, 'the sent turn is exactly the raw question')

  // Turn 2 replays turn 1 from browser history. Turn 1's messages must be an exact prefix.
  const t2 = await ask('And what about the shoes?', [
    { role: 'user', content: q1 }, { role: 'assistant', content: a1 },
  ])
  assert.deepEqual(
    t2.messages.slice(0, t1.messages.length).map(contentOf),
    t1.messages.map(contentOf),
    'turn 1 must be an exact prefix of turn 2, or every follow-up rewrites the whole message cache'
  )

  // The stable system half must also be byte-identical, or the 27k-token prefix is rewritten too.
  const stable = payload => payload.system.split(PROMPT_CACHE_BREAKPOINT)[0]
  assert.equal(stable(t1), stable(t2), 'the cached system prefix must not change between turns')

  // Bounded history's tradeoff, asserted rather than assumed: once the window is full the oldest
  // exchange drops, message 0 changes, and prefix reuse necessarily ends. Bounding still caps the
  // size of that rewrite; it does not preserve append-only growth forever.
  const longHistory = Array.from({ length: 12 }, (_, i) => ([
    { role: 'user', content: `question ${i}` }, { role: 'assistant', content: `answer ${i}` },
  ])).flat()
  const slid = await ask('next question', longHistory)
  const slidAgain = await ask('another question', [...longHistory,
    { role: 'user', content: 'next question' }, { role: 'assistant', content: 'next answer' }])
  assert.notDeepEqual(
    contentOf(slid.messages[0]), contentOf(slidAgain.messages[0]),
    'a slid window changes message 0 — this is the accepted bounded-history tradeoff, not a regression'
  )
  assert.ok(slid.historyDiagnostics.historyMessagesIncluded <= 8, 'window bound still applies')
})

test('freeform prompt ownership leaves tool mechanics in tool descriptions and only cross-tool boundaries in the controller', async () => {
  const { freeformToolRoutingInstruction } = await import('../styling-engine/core.js')
  // Takes the turn mode now: per-turn behaviour lives in this block precisely because it is below
  // the cache breakpoint, where varying costs nothing. See docs/freeform-prompt-cache-levers.md.
  const base = freeformToolRoutingInstruction('followup')
  const bounded = freeformToolRoutingInstruction('new_request')
  assert.match(base, /each tool description owns its eligibility, required arguments, and mechanical output contract/)
  assert.doesNotMatch(base, /want:"text"|outfit_index|piece_ids/)
  assert.doesNotMatch(base, /BOUNDED MULTI-LOOK EXCEPTION/, 'the exception is a fresh-request rule only')
  assert.match(bounded, /BOUNDED MULTI-LOOK EXCEPTION/)
  assert.match(bounded, /do NOT call declare_intent and do NOT call search_wardrobe/)
  assert.match(bounded, /One\/best\/pick-one requests stay on the verified search \+ propose path/)
  assert.match(bounded, /multi-context schedules and capsules use plan_outfit_set/)
  assert.match(bounded, /existing-card revisions use suggest_slot_swaps/)

  const tool = name => STYLIST_TOOLS.find(candidate => candidate.name === name)
  // The declaration is required by the operations that consume it, not by every turn: a prose
  // answer needs none, and declaring want:'text' merely to answer buys a second round-trip for
  // nothing (measured at $0.0134 against a ~$0.04 follow-up).
  assert.match(tool('declare_intent').description, /Required before propose_outfit, generate_outfits or render_preview/)
  assert.match(tool('declare_intent').description, /NOT required to answer in prose/)
  assert.match(tool('suggest_slot_swaps').description, /alternatives to ONE slot/)
  assert.match(tool('render_preview').description, /card produced this turn by index, or explicit piece_ids/)
  assert.match(tool('generate_outfits').description, /ordinary new 'what should I wear\?' request defaults to 2 options/)
  assert.match(tool('plan_outfit_set').description, /multiple use-case slots/)
  // Grew from ~700 to ~890 chars when lever 1 moved the bounded exception out of the tool schemas.
  // That is the trade working: ~48 tokens of volatile text at full input price (~$0.00014/call)
  // buys back ~35k tokens of cached prefix that a turn-mode change used to discard (~$0.13). The
  // bound still guards the thing it was written for — the controller restating tool schemas — which
  // the assertions above check directly.
  assert.ok(bounded.length < 1100, 'the cross-tool controller stays smaller than the schemas it references')
})

test('assembled full-stylist prompt carries one mode owner and no retired schema restatements', async () => {
  const { buildStylistConversationPayload } = await import('../styling-engine/core.js')
  {
    const payload = await buildStylistConversationPayload({
      question: 'Can you explain the previous recommendation?',
      conversationMode: 'explanation',
      sessionId: `prompt-owner-${Date.now()}`
    })
    assert.equal((payload.system.match(/Turn directive:/g) || []).length, 1)
    assert.doesNotMatch(payload.system, /Mode instructions:/)
    assert.doesNotMatch(payload.system, /INTENT DECLARATION \(mechanically enforced\)/)
    assert.doesNotMatch(payload.system, /If mode is followup|If mode is correction|If mode is explanation|If mode is preference_reaction/)
    assert.match(payload.system, /TOOL ROUTING OWNERSHIP:/)
    assert.doesNotMatch(payload.system, /BOUNDED MULTI-LOOK EXCEPTION/, 'an explanation turn is not a fresh request')
  }
})

test('small execution router owns intent without receiving wardrobe context', async () => {
  let captured = null
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = call => {
    captured = call
    return {
      profile: 'bounded_multi',
      occasion: 'outdoor_daytime_social',
      activity: 'walking',
      season: 'warm',
      mood: 'creative outdoor afternoon',
      mission: 'mix',
      limit: 2,
      location: 'Sausalito, CA',
      date: '2026-08-22'
    }
  }
  try {
    const routed = await routeFreeformExecutionProfile({
      question: 'On Saturday I am walking around an outdoor art fair in Sausalito. What should I wear?',
      currentDate: '2026-08-18',
      timezone: 'America/Los_Angeles'
    })
    assert.equal(routed.value.profile, 'bounded_multi')
    assert.equal(routed.value.limit, 2)
    assert.equal(routed.value.activity, 'walking')
    assert.match(captured.system, /Choose bounded_multi ONLY/)
    assert.match(captured.system, /dinner with friends.*occasion:city/s)
    assert.match(captured.system, /attending dinner there, does not establish walking/)
    assert.doesNotMatch(captured.system, /WARDROBE MANIFEST|STYLE CONSTITUTION/)
    assert.doesNotMatch(JSON.stringify(captured.messages), /piece ID|garment|wardrobe manifest/i)
  } finally {
    delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  }
})

test('execution router can select compact text profiles from presence-only context', async () => {
  let captured = null
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = call => {
    captured = call
    return { profile: 'existing_card_explanation', occasion: 'city', activity: 'none', season: '', mood: '', mission: 'mix', limit: 0, location: '', date: '', subject: 'second card' }
  }
  try {
    const routed = await routeFreeformExecutionProfile({
      question: 'Why is the second one warmer?',
      contextSummary: 'verified current outfit set: 2 card(s); verified garment subjects available: 7'
    })
    assert.equal(routed.value.profile, 'existing_card_explanation')
    assert.match(JSON.stringify(captured.messages), /verified current outfit set: 2 card/)
    assert.doesNotMatch(JSON.stringify(captured.messages), /piece ID|garment name|wardrobe manifest/i)
    assert.match(captured.system, /Choose garment_fact/)
    assert.match(captured.system, /saved garment photographs are available/)
    assert.match(captured.system, /Choose general_advice/)
    assert.match(captured.system, /Choose wardrobe_inventory/)
    // Coverage has no bounded execution architecture, so the router must not be able to select it.
    // Coverage questions fall to full_stylist until they are rebuilt on shared batched discovery.
    assert.doesNotMatch(captured.system, /qualified_coverage/)
  } finally {
    delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  }
})

test('execution router receives the immediately preceding exchange, not the whole thread history', async () => {
  // thread_1787707798034 msg 11 (2026-08-26): the router classified purely from the isolated
  // current message, so a reply naming garments only because it answered the assistant's own
  // clarifying question ("which outfit's layer?") read like a standalone garment_fact question.
  // See docs/deferred-conversational-cache-spec.md's sibling finding and the routing-corpus entry
  // 'layer-request-after-clarifying-question'.
  let captured = null
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = call => {
    captured = call
    return { profile: 'full_stylist', occasion: 'evening', activity: 'none', season: '', mood: '', mission: 'mix', limit: 0, location: '', date: '', subject: '' }
  }
  try {
    await routeFreeformExecutionProfile({
      question: 'I\'m asking about the layer for Mauve Utility Punch — floral abstract sleeveless tunic',
      contextSummary: 'no current outfit set; verified garment subjects available: 3',
      recentExchange: 'user: ok, not bad. Give me some layering options for the evening\nassistant: Before I pull options, quick clarification: are you adding a layer to the current Mauve Utility Punch outfit, or starting fresh?'
    })
    assert.match(captured.messages[0].content, /Recent exchange \(immediately preceding turn only\):\nuser: ok, not bad\. Give me some layering options for the evening\nassistant: Before I pull options/)
    // The recent-exchange block must sit between compact context and the current request, with the
    // request still last — every existing corpus assertion anchors "Request: ...$" at the end.
    assert.match(captured.messages[0].content, /Recent exchange[\s\S]*Request: I'm asking about the layer/)
    assert.match(captured.system, /RECENT EXCHANGE, if supplied, is only the immediately preceding assistant\/user turn/)
    assert.match(captured.system, /NOT thereby a garment_fact question about that garment/)
  } finally {
    delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  }
})

test('execution router omits the recent-exchange block entirely when none is supplied', async () => {
  let captured = null
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = call => {
    captured = call
    return { profile: 'bounded_multi', occasion: 'casual', activity: 'none', season: '', mood: '', mission: 'mix', limit: 2, location: '', date: '', subject: '' }
  }
  try {
    await routeFreeformExecutionProfile({ question: 'What should I wear today?' })
    assert.doesNotMatch(captured.messages[0].content, /Recent exchange/)
  } finally {
    delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  }
})

test('offline execution-routing corpus spans every profile and conservative fallback class', async () => {
  const corpus = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), 'test/fixtures/freeform_execution_routing_corpus.json'),
    'utf8'
  ))
  const classes = new Set(corpus.map(entry => entry.class))
  for (const required of ['composition', 'followup_explanation', 'garment_fact', 'general_advice', 'inventory', 'discovery', 'correction_or_revision', 'photo_or_critique', 'plan', 'ambiguous']) {
    assert.ok(classes.has(required), `routing corpus must cover ${required}`)
  }
  assert.deepEqual(
    [...new Set(corpus.map(entry => entry.expectedProfile))].sort(),
    ['bounded_multi', 'existing_card_explanation', 'full_stylist', 'garment_fact', 'general_advice', 'wardrobe_inventory']
  )

  const seenIds = new Set()
  let activeCase = null
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = call => {
    assert.match(call.system, /Classify one wardrobe-stylist request/)
    assert.match(call.messages[0].content, new RegExp(`Request: ${activeCase.request.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    assert.match(call.messages[0].content, new RegExp(`Compact context available: ${activeCase.context.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    if (activeCase.recentExchange) {
      assert.match(call.messages[0].content, new RegExp(`Recent exchange \\(immediately preceding turn only\\):\\n${activeCase.recentExchange.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    } else {
      assert.doesNotMatch(call.messages[0].content, /Recent exchange/)
    }
    return {
      profile: activeCase.expectedProfile,
      occasion: 'casual', activity: 'none', season: '', mood: '', mission: 'mix',
      limit: activeCase.expectedProfile === 'bounded_multi' ? 2 : 0,
      location: '', date: '', subject: ''
    }
  }
  try {
    for (const entry of corpus) {
      assert.ok(entry.id && !seenIds.has(entry.id), `routing corpus id must be unique: ${entry.id}`)
      seenIds.add(entry.id)
      activeCase = entry
      const routed = await routeFreeformExecutionProfile({
        question: entry.request,
        currentDate: '2026-08-18',
        timezone: 'America/Los_Angeles',
        contextSummary: entry.context,
        recentExchange: entry.recentExchange || ''
      })
      assert.equal(routed.value.profile, entry.expectedProfile, entry.id)
    }
  } finally {
    delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  }
})

test('wardrobe inventory compact completion formats exact active database counts without styling judgment', () => {
  const answer = formatWardrobeInventoryAnswer({ top: 88, bottom: 61, dress: 20, shoes: 33, outerwear: 31, accessory: 18 })
  assert.match(answer, /\| Tops \| 88 \|/)
  assert.match(answer, /\| Outerwear \| 31 \|/)
  assert.match(answer, /\| Accessories \| 18 \|/)
  assert.match(answer, /\| \*\*Total\*\* \| \*\*251\*\* \|/)
  assert.doesNotMatch(answer, /enough|missing|should|recommend/i)
})

test('wardrobe inventory profile returns after the router instead of entering declare_intent', () => {
  const routeSrc = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  const inventoryBranch = routeSrc.slice(
    routeSrc.indexOf("compactProfile === 'wardrobe_inventory'"),
    routeSrc.indexOf("['existing_card_explanation', 'garment_fact', 'general_advice'].includes(compactProfile)")
  )
  assert.match(inventoryBranch, /SELECT category, COUNT\(\*\)/)
  assert.match(inventoryBranch, /compact_wardrobe_inventory/)
  assert.match(inventoryBranch, /return res\.json/)
  assert.doesNotMatch(inventoryBranch, /askStylistWithUsage|buildStylistConversationPayload|declare_intent/)
})

test('exact saved garment names seed compact fact context without guessing ambiguous identity', () => {
  const pieces = [
    { id: 264, name: 'black abstract print short tee' },
    { id: 350, name: 'red graphic v-neck' },
  ]
  assert.deepEqual(
    exactNamedPieceIdsFromQuestion('Can my black abstract print short tee be tucked?', pieces),
    [264]
  )
  assert.deepEqual(exactNamedPieceIdsFromQuestion('Can my graphic tee be tucked?', pieces), [])
  assert.deepEqual(exactNamedPieceIdsFromQuestion('Compare black abstract print short tee and red graphic v-neck.', pieces), [])
})

test('exact named saved-photo tuck questions deterministically use the bounded visual-fact lane', () => {
  const evidence = { exactSubjectCount: 1, savedPhotoCount: 1 }
  assert.equal(isSavedPhotoWearMechanicsQuestion('Does my white scoop neck sleeveless top look good tucked in?', evidence), true)
  assert.equal(isSavedPhotoWearMechanicsQuestion('Would a French tuck work for my white scoop neck sleeveless top?', evidence), true)
  assert.equal(isSavedPhotoWearMechanicsQuestion('What should I wear with my white scoop neck sleeveless top?', evidence), false)
  assert.equal(isSavedPhotoWearMechanicsQuestion('Does my white scoop neck sleeveless top look good tucked in?', { exactSubjectCount: 1, savedPhotoCount: 0 }), false)
  assert.equal(isSavedPhotoWearMechanicsQuestion('Does this top look good tucked in?', { exactSubjectCount: 0, savedPhotoCount: 1 }), false)
})

test('saved-photo presence is exposed to the router without leaking garment identity or image data', () => {
  const routeSrc = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  assert.match(routeSrc, /SELECT id, name, photo, worn_photo FROM pieces/)
  assert.match(routeSrc, /saved garment photographs available: \$\{compactSavedPhotoCount\} resolved subject\(s\)/)
  assert.match(routeSrc, /compactGarmentVisualEvidence\(visualPieces\)/)
  assert.match(routeSrc, /Refusing expensive full-stylist fallback/)
})

test('view_pieces limits photographs to visible evidence rather than invented fiber or preference', () => {
  const viewTool = STYLIST_TOOLS.find(tool => tool.name === 'view_pieces')
  assert.match(viewTool.description, /cannot establish exact fiber composition/)
  assert.match(viewTool.description, /Possibility does not prove that the shown styling looks good/)
  const toolsSrc = fs.readFileSync(path.join(process.cwd(), 'styling-engine/tools.js'), 'utf8')
  assert.match(toolsSrc, /evidence_note: 'Photos support visible drape, bulk, texture and behavior—not exact fiber composition/)
})

test('compact garment facts carry tag confidence and allow evidence-based inference without a hem shortcut', () => {
  const facts = compactFreeformPieceFacts({
    id: 264, name: 'black abstract print short tee', category: 'top',
    tuck_behavior: 'tucks_anywhere', hem_finish: 'straight_loose',
    style_profile_json: { _confidence: { tuck_behavior: 'manual', hem_finish: 'manual' } }
  })
  assert.equal(facts.tuck_behavior, 'tucks_anywhere')
  assert.equal(facts.field_confidence.tuck_behavior, 'manual')
  const system = compactFreeformAnswerSystem('garment_fact')
  assert.match(system, /Saved tags are evidence, not infallible/)
  assert.match(system, /Never infer tuckability from hem shape alone/)
  assert.match(system, /Give a direct, respectful styling judgment about the visible garment-and-body interaction/)
  assert.match(system, /if the shown tuck fights the wearer's proportions, say that it is not the strongest presentation/)
  assert.match(system, /recommend trying it as the likely stronger option or ask for a comparison photograph/)
  assert.match(system, /compare fully untucked before proposing a partial, French, asymmetric, folded, or otherwise more elaborate tuck/)
  assert.match(system, /Do not invent a hidden cause, diagnose the wearer's body, or turn one photographed interaction into a universal body rule/)
  assert.match(system, /never expose field names, snake_case keys, enum values/)
  assert.match(system, /say “this fitted tee can be tucked,” never “tuck_behavior is tucks_anywhere”/)
})

test('whole-wardrobe composer receives wear mechanics but is told not to recite fixed garment truth', () => {
  const routeSrc = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  assert.match(routeSrc, /tuck_behavior: \$\{piece\.tuck_behavior\}/)
  assert.match(routeSrc, /hem_finish: \$\{piece\.hem_finish\}/)
  assert.match(routeSrc, /waistband_type: \$\{piece\.waistband_type\}/)
  assert.match(routeSrc, /opacity: \$\{piece\.opacity\}/)
  assert.match(routeSrc, /needs_base: \$\{piece\.needs_base\}/)
  assert.match(routeSrc, /Opacity and needs_base are authoritative/)
  assert.match(routeSrc, /Do not repeat a fixed fact the owner already knows/)
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

// docs/trip-composition-parity-spec.md: the atomic trip composer degrades to accepted cards +
// honest gaps after one composition call, the same as capsule's -- boundedCompositionCompleted
// must recognize tripAtomicAttempted too, or a partial/honest trip result would incorrectly trip
// the generic "cardsNotDelivered"/"outfitCount" retry nudges this flag exists to suppress.
test('a completed bounded trip composition does not re-enter generic card delivery retries', () => {
  const toolContext = {
    question: 'Pack for a week in Vienna with 6 looks',
    declaredIntent: { want: 'cards', outfitCount: 6 },
    generatedOutfits: [],
    tripAtomicAttempted: true,
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

// Still load-bearing after the tiered index was removed: when the wardrobe exceeds the manifest
// cap the prompt carries no manifest at all, and search must then return full stable truth rather
// than trimmed judgment rows — otherwise those fields are visible in neither surface.
test('search returns full stable garment truth when no manifest is in the prompt', async () => {
  const pieceId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json, neckline, sleeve_length, hem_finish, tuck_behavior)
    VALUES ('tiered truth shirt', 'top', '["blue"]', '["casual"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'quiet blue shirt', 'relaxed', 'cotton', 'light', '["cotton"]', 'everyday', 'hip', '{}', 'boat', 'long', 'designer_hem', 'tucks_with_structure')
  `).run().lastInsertRowid
  try {
    const toolContext = {
      wardrobeManifestIncluded: false,
      freeformDiagnostics: {},
    }
    const result = await executeTool('search_wardrobe', { query: 'tiered truth shirt' }, toolContext)
    const piece = result.find(item => Number(item.id) === Number(pieceId))
    assert.equal(piece.fabric_category, 'cotton')
    assert.equal(piece.fabric_weight, 'light')
    assert.equal(piece.neckline, 'boat')
    assert.equal(piece.sleeve_length, 'long')
    assert.equal(piece.hem_finish, 'designer_hem')
    assert.equal(piece.tuck_behavior, 'tucks_with_structure')
  } finally {
    db.prepare('DELETE FROM pieces WHERE id = ?').run(pieceId)
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
    // Spec future-trip-weather-estimate-spec.md §3.1/§6.5: free-text weather
    // is removed from search_wardrobe's schema; a structured weather_estimate
    // establishes the hot context now, and toolContext.weather (the old
    // free-text echo) is no longer touched by this tool at all.
    const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], season: 'current season' }
    await executeTool('search_wardrobe', { occasion: 'city', activity: 'walking', weather_estimate: { high_f: 92, low_f: 78 }, visual: true }, toolContext)
    assert.equal(toolContext.weatherProfile?.isHot, true)

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
    assert.equal(toolContext.generatedOutfits[0].season, 'current season')
    assert.equal(toolContext.generatedOutfits[0].debug.resolvedActivity, 'walking')
    assert.equal(toolContext.generatedOutfits[0].debug.walkable, true)
    assert.equal(toolContext.season, 'current season')
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
      atomicMultiLookCalls: 1,
      executionRouterCalls: 1,
      historyMessagesReceived: 12,
      historyMessagesIncluded: 8,
      historyCharsRemoved: 4200,
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
  assert.equal(row.atomic_multi_look_calls, 1)
  assert.equal(row.execution_router_calls, 1)
  assert.equal(row.history_messages_received, 12)
  assert.equal(row.history_messages_included, 8)
  assert.equal(row.history_chars_removed, 4200)
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

// thread_1787717774384: composeCapsulePlanOnce's zero-outfit result and a genuine token-cap
// truncation used to be indistinguishable in this table, same problem as the roster codes above
// one stage earlier.
test('a truncated capsule composition records a distinct failure code from a genuine empty result', () => {
  db.prepare('DELETE FROM freeform_generation_runs').run()
  persistFreeformGenerationRun({
    sessionId: 'capsule-composition-truncated',
    occasion: 'capsule',
    diagnostics: { submitPlanCalls: 1, submitPlanValidationFails: 1, capsuleCompositionFailureCode: 'truncated_max_tokens' }
  })
  const row = db.prepare('SELECT * FROM freeform_generation_runs WHERE session_id = ?').get('capsule-composition-truncated')
  assert.equal(row.capsule_composition_failure_code, 'truncated_max_tokens')
})

test('a completed turn is distinguishable from a failed one in the same table', () => {
  persistFreeformGenerationRun({ sessionId: 'finished-fine', occasion: 'capsule', diagnostics: { capsuleRosterModelCalls: 1 } })
  const row = db.prepare('SELECT turn_failed FROM freeform_generation_runs WHERE session_id = ?').get('finished-fine')
  assert.equal(row.turn_failed, 0, 'default is a completed turn, so existing rows keep their meaning')
})

// Attribution guard. 112 of the first 127 recorded rows had an empty session_id, so a month of cost
// telemetry could not be grouped into conversations at all — which is how three wrong cost
// hypotheses survived as long as they did. The bounded early-return path was the last offender; it
// was fixed 2026-08-19 and every row since carries a real thread ID. The risk now is a SIXTH early
// return being added that forgets, so this enumerates the call sites rather than trusting review.
test('every freeform run row is attributed to its thread, on success and on failure', () => {
  const routeSrc = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  const marker = 'persistFreeformGenerationRun({'
  const sites = []
  for (let at = routeSrc.indexOf(marker); at !== -1; at = routeSrc.indexOf(marker, at + 1)) {
    // Skip the function's own declaration; only its call sites carry a sessionId argument.
    if (/function\s*$/.test(routeSrc.slice(Math.max(0, at - 20), at))) continue
    // Bound each window at the NEXT call site. A fixed-width slice bleeds into the following call
    // and lets a site that omits sessionId entirely pass on its neighbour's line — verified by
    // injecting exactly that regression.
    const next = routeSrc.indexOf(marker, at + 1)
    sites.push(routeSrc.slice(at, next === -1 ? at + 260 : Math.min(next, at + 260)))
  }
  assert.ok(sites.length >= 5, `expected every persist call site to be found, got ${sites.length}`)
  sites.forEach((site, index) => {
    assert.match(site, /sessionId: req\.body\.sessionId/,
      `persistFreeformGenerationRun call site ${index + 1} must pass the request's real thread ID`)
  })
  // A literal or invented id would satisfy the pattern above only by being written deliberately;
  // this catches the likelier slip of dropping the field and letting the '' default stand.
  sites.forEach((site, index) => {
    assert.doesNotMatch(site, /sessionId: ''/,
      `persistFreeformGenerationRun call site ${index + 1} must not persist an unattributed row`)
  })
  // The catch block is one of those sites: a turn that died still has to say which thread it died in.
  const catchBlock = routeSrc.slice(routeSrc.indexOf('if (diagnosticsContext) {'))
  assert.match(catchBlock.slice(0, 300), /sessionId: req\.body\.sessionId/)
  assert.match(catchBlock.slice(0, 300), /turnFailed: true/)
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

test('compact answer profiles are unconditional, bounded, and return before the full manifest payload', () => {
  const routeSrc = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  // Default-on since 2026-08-19: no flag may gate these profiles.
  assert.doesNotMatch(routeSrc, /WARDROBE_FREEFORM_/, 'freeform feature flags are removed, not re-added')
  assert.match(routeSrc, /\['existing_card_explanation', 'garment_fact', 'general_advice'\]/)
  const compactStart = routeSrc.indexOf("if (['existing_card_explanation', 'garment_fact', 'general_advice'].includes(compactProfile))")
  const boundedStart = routeSrc.indexOf("if (String(req.body.conversationMode || 'new_request') === 'new_request'", compactStart)
  const payloadStart = routeSrc.indexOf('const payload = await buildStylistConversationPayload')
  assert.ok(compactStart > 0 && compactStart < payloadStart, 'compact answer must return before full manifest payload assembly')
  assert.ok(boundedStart > compactStart && boundedStart < payloadStart, 'compact and bounded execution profiles must remain separate branches')
  const compactBlock = routeSrc.slice(compactStart, boundedStart)
  assert.match(compactBlock, /await askStylistWithUsage/)
  assert.doesNotMatch(compactBlock, /askStylistWithTools|search_wardrobe|generate_outfits/)
  assert.match(compactBlock, /compactFreeformAnswerMessage/)
  assert.match(routeSrc, /profile !== 'general_advice' && pieces\.length/, 'general advice must not receive cards, garment facts, or established wardrobe context')
})

test('the execution router bypasses the full manifest controller only after bounded composition succeeds', () => {
  const routeSrc = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  assert.match(routeSrc, /routed\.value\?\.profile === 'bounded_multi'/)
  assert.match(routeSrc, /if \(toolContext\.atomicMultiLookCompleted\) \{[\s\S]{0,1200}return res\.json/)
  const routerBlock = routeSrc.slice(
    routeSrc.indexOf('if (routerEligible)'),
    routeSrc.indexOf('const payload = await buildStylistConversationPayload')
  )
  assert.doesNotMatch(routerBlock, /buildStylistConversationPayload|askStylistWithTools/)
  assert.match(routerBlock, /saveStylistConversationState\([\s\S]*boundedConversationStateFromToolContext/)
  assert.match(routerBlock, /catch \(routerError\) \{/)
  assert.match(routerBlock, /Falling back to full stylist/)
  assert.match(routerBlock, /Refusing expensive full-stylist fallback/)
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

test('bounded multi-look ends after one composer pass and discloses a validation shortfall', () => {
  const toolContext = {
    declaredIntent: { want: 'cards', outfitCount: 3, turnMode: 'new_request' },
    atomicMultiLookCompleted: true,
    atomicMultiLookRequestedCount: 3,
    generatedOutfits: [{ label: 'Ready' }, { label: 'Rejected', broken: true }],
    freeformDiagnostics: {}
  }
  assert.deepEqual(applyFreeformOutputChecks('Here is the validated set.', toolContext), { block: false })
  assert.deepEqual(stylistToolsForTurn(toolContext), [])
  assert.match(boundedAtomicMultiLookFinalAnswer('Here is the validated set.', toolContext), /1 of 3 requested outfits is ready/)
  assert.match(boundedAtomicMultiLookResponse(toolContext), /I’d start with this direction/)
})

test('bounded multi-look introduction uses exact live weather context without machinery language', () => {
  const answer = boundedAtomicMultiLookResponse({
    atomicMultiLookCompleted: true,
    atomicMultiLookRequestedCount: 2,
    boundedWeatherSummary: 'a forecast high of 69°F and low of 55°F',
    boundedLocation: 'Sausalito, CA',
    generatedOutfits: [{ label: 'One' }, { label: 'Two' }]
  })
  assert.equal(answer, 'For a forecast high of 69°F and low of 55°F in Sausalito, CA, I’d compare these two directions.')
  assert.doesNotMatch(answer, /wardrobe-verified|for this request/i)
})

test('bounded multi-look introduction names the actual number of ready directions', () => {
  const answer = boundedAtomicMultiLookResponse({
    atomicMultiLookCompleted: true,
    atomicMultiLookRequestedCount: 4,
    boundedWeatherSummary: 'a forecast high of 72°F and low of 58°F',
    boundedLocation: 'Oakland, CA',
    generatedOutfits: [{ label: 'One' }, { label: 'Two' }, { label: 'Three' }, { label: 'Four' }]
  })
  assert.equal(answer, 'For a forecast high of 72°F and low of 58°F in Oakland, CA, I’d compare these 4 directions.')
})

test('bounded multi-look introduction starts rather than compares when weather context has one ready card', () => {
  const answer = boundedAtomicMultiLookResponse({
    atomicMultiLookCompleted: true,
    atomicMultiLookRequestedCount: 2,
    boundedWeatherSummary: 'a forecast high of 70°F and low of 55°F',
    boundedLocation: 'San Francisco, CA',
    generatedOutfits: [{ label: 'One' }]
  })
  assert.match(answer, /I’d start with this direction\./)
  assert.doesNotMatch(answer, /compare this direction/)
})

test('bounded router state preserves the generated set and established context for server-side follow-ups', () => {
  const state = boundedConversationStateFromToolContext({
    occasion: 'city',
    activity: 'none',
    season: 'mild weather',
    mood: 'relaxed social',
    mission: 'mix',
    boundedLocation: 'San Francisco, CA',
    boundedWeatherSummary: 'a forecast high of 70°F and low of 55°F',
    weatherProfile: { weatherSource: 'live', highF: 70, lowF: 55, isHot: false, isCold: false, isExtremeHeat: false },
    generatedOutfits: [{
      label: 'Layered dinner',
      pieceIds: [11, 12, 13],
      pieces: [{ id: 11, name: 'top' }, { id: 12, name: 'trousers' }, { id: 13, name: 'flats' }]
    }]
  })
  assert.deepEqual(state.current_outfit_set, [{
    index: 1,
    label: 'Layered dinner',
    piece_ids: [11, 12, 13],
    pieces: ['top', 'trousers', 'flats']
  }])
  assert.deepEqual(state.weather_profile, {
    source: 'live', high_f: 70, low_f: 55, is_hot: false, is_cold: false, is_extreme_heat: false
  })
  assert.equal(state.established.location, 'San Francisco, CA')
  assert.equal(state.established.weather, 'a forecast high of 70°F and low of 55°F')
})

// Spec §7: current_outfit_set persists a per-outfit weather disclosure and its
// serialized structured context (distinct from the single shared weather_profile
// above, which cannot represent a multi-slot plan with different weather per
// slot). A follow-up like "what weather were you planning for the coast day?"
// reads this back per-outfit.
test('bounded router state persists per-outfit weatherUsed/resolvedWeatherContext onto current_outfit_set', () => {
  const state = boundedConversationStateFromToolContext({
    generatedOutfits: [{
      label: 'Coast Day',
      pieceIds: [21],
      pieces: [{ id: 21, name: 'jacket' }],
      weatherUsed: '65°F high / 45°F low — live forecast, Cambria, CA',
      resolvedWeatherContext: {
        status: 'resolved',
        location: 'Cambria, CA',
        date_range: { start: '2026-10-14', end: '2026-10-14' },
        temperature: { high_f: 65, low_f: 45, is_hot: false, is_cold: true, is_extreme_heat: false, source: 'live' },
        overall_source: 'live',
      }
    }, {
      label: 'No Weather Slot',
      pieceIds: [22],
      pieces: [{ id: 22, name: 'sweater' }]
    }]
  })
  assert.equal(state.current_outfit_set[0].weather_used, '65°F high / 45°F low — live forecast, Cambria, CA')
  assert.equal(state.current_outfit_set[0].resolved_weather_context.location, 'Cambria, CA')
  assert.equal(state.current_outfit_set[0].resolved_weather_context.overall_source, 'live')
  assert.equal(state.current_outfit_set[1].weather_used, undefined, 'an outfit with no resolved weather must not fabricate a disclosure')
  assert.equal(state.current_outfit_set[1].resolved_weather_context, undefined)
})

// thread_1788508369689 arc, product ruling "use B": validateSubmittedPlanOutfits puts
// assignedLayerIds on an accepted trip outfit (the shared packed layer used with a cold look,
// deliberately kept off pieceIds), but this whitelist serializer was found to drop it silently on
// the way into persisted current_outfit_set -- a follow-up edit had no way to know a cold card's
// worn outfit depended on a specific packed layer at all.
test('bounded router state persists assignedLayerIds onto current_outfit_set as assigned_layer_piece_ids', () => {
  const state = boundedConversationStateFromToolContext({
    generatedOutfits: [{
      label: 'Nature Walk',
      pieceIds: [1, 2, 3],
      pieces: [{ id: 1, name: 'top' }, { id: 2, name: 'bottom' }, { id: 3, name: 'shoes' }],
      assignedLayerIds: [8],
    }, {
      label: 'City Day',
      pieceIds: [4, 5, 6],
      pieces: [{ id: 4, name: 'top' }, { id: 5, name: 'bottom' }, { id: 6, name: 'shoes' }],
    }]
  })
  assert.deepEqual(state.current_outfit_set[0].assigned_layer_piece_ids, [8])
  assert.equal(state.current_outfit_set[1].assigned_layer_piece_ids, undefined,
    'an outfit with no assigned layer must not fabricate one')
})

test('stored weather physics survive echoed display prose but yield to explicit turn weather', async () => {
  const { buildStylistConversationPayload, saveStylistConversationState } = await import('../styling-engine/core.js')
  const sessionId = `weather-physics-${Date.now()}`
  saveStylistConversationState({
    established: { season: 'summer; mild weather; forecast high 78°F, low 56°F' },
    weather_profile: { source: 'live', high_f: 78, low_f: 56, is_hot: false, is_cold: false, is_extreme_heat: false }
  }, sessionId)

  const inherited = await buildStylistConversationPayload({
    sessionId,
    conversationMode: 'followup',
    question: 'Why does that layer work?',
    threadContext: 'summer; mild weather; forecast high 78°F, low 56°F'
  })
  assert.equal(inherited.threadState.weather_profile.is_hot, false)
  assert.equal(inherited.threadState.weather_profile.high_f, 78)

  const superseded = await buildStylistConversationPayload({
    sessionId,
    conversationMode: 'followup',
    question: 'Would this still work?',
    weather: '95°F and sunny'
  })
  assert.equal('weather_profile' in superseded.threadState, false)
})

test('historical outfit-set addressability: pure resolver functions', async () => {
  const {
    isBackwardOutfitSetReference,
    extractHistoricalOutfitSets,
    resolveHistoricalReferenceByGarment,
    resolveHistoricalOutfitContext,
    formatHistoricalOutfitSetsForPrompt
  } = await import('../styling-engine/core.js')

  // thread_1787435527800 shape: an early rejected set ("Botanical Drift" / "Patchwork Artisan",
  // critiqued as too elevated), then a regenerated Walnut Creek set that superseded it.
  const threadMessages = [
    { role: 'user', text: 'Use my wardrobe to create outfits for casual, artful, lots of walking.' },
    {
      role: 'assistant',
      text: 'Here are the strongest wardrobe outfits.',
      structuredOutfits: [
        { label: 'Botanical Drift', strength: 'signature', reason: 'earns an elevated read from the black crochet lace tank', pieceIds: [901, 902] },
        { label: 'Patchwork Artisan', strength: 'strong', reason: 'reads more elevated than casual', pieceIds: [903, 904] }
      ]
    },
    { role: 'user', text: 'Botanical Drift and Patchwork Artisan read more elevated than casual.' },
    { role: 'assistant', text: 'You are not wrong — here is why.' },
    { role: 'user', text: 'The trail is paved, but none of your proposed outfits work. What else can I wear?' },
    {
      role: 'assistant',
      text: 'For Walnut Creek, CA, I’d compare these 5 directions.',
      structuredOutfits: [
        { label: 'Red Crow on the Trail', strength: 'signature', reason: 'paved trail walk, casual hot-weather outing', pieceIds: [350, 245, 990397] },
        { label: 'Brown Crew and Tan', strength: 'usable', reason: 'tone-on-tone earthy separates', pieceIds: [350, 127] }
      ]
    }
  ]
  const currentPieceIds = [350, 245, 990397, 127] // the Walnut Creek set

  // 1. A vague, forward-looking reference ("add a layer") is not a backward reference at all —
  //    current_outfit_set stays the sole subject, nothing historical gets pulled in.
  assert.equal(isBackwardOutfitSetReference('nice! can I have a layer just in case?'), false)
  const noSignal = resolveHistoricalOutfitContext('can I have a layer just in case?', extractHistoricalOutfitSets(threadMessages), currentPieceIds)
  assert.equal(noSignal.kind, 'none')
  assert.equal(formatHistoricalOutfitSetsForPrompt(noSignal), '')

  // extractHistoricalOutfitSets excludes the latest card-bearing turn (the current set) by default.
  const historicalSets = extractHistoricalOutfitSets(threadMessages)
  assert.equal(historicalSets.length, 1)
  assert.equal(historicalSets[0].outfits[0].label, 'Botanical Drift')
  assert.equal(historicalSets[0].introText, 'Here are the strongest wardrobe outfits.')

  // 3. Keyword-based: "what was wrong with the first set?" resolves the historical set and its
  //    own critique text, without needing to name a specific garment.
  assert.equal(isBackwardOutfitSetReference('what was wrong with the first set?'), true)
  const keywordResolution = resolveHistoricalOutfitContext('what was wrong with the first set?', historicalSets, currentPieceIds)
  assert.equal(keywordResolution.kind, 'keyword')
  assert.equal(keywordResolution.sets.length, 1)
  const keywordText = formatHistoricalOutfitSetsForPrompt(keywordResolution)
  assert.match(keywordText, /HISTORICAL OUTFIT SETS/)
  assert.match(keywordText, /Botanical Drift/)
  assert.match(keywordText, /elevated read from the black crochet lace tank/)
  assert.match(keywordText, /must NOT be applied to current_outfit_set/)

  // 4. Garment-based: naming a piece that is in a historical set but not the current one resolves
  //    that set directly, even with no keyword present ("olive cargo shorts" alone, no "first"/
  //    "earlier"/"before" — resolveHistoricalReferenceByGarment must find it on its own).
  const gSets = extractHistoricalOutfitSets([
    ...threadMessages.slice(0, 2).map(m => m.role === 'assistant'
      ? { ...m, structuredOutfits: [{ label: 'Piranha and Olive', reason: 'earthy tone', pieceIds: [601], pieces: [{ id: 601, name: 'olive cargo drawstring shorts' }] }] }
      : m),
    threadMessages[threadMessages.length - 1]
  ])
  const garmentResolution = resolveHistoricalOutfitContext('go back to the outfit with the olive cargo shorts', gSets, currentPieceIds)
  assert.equal(garmentResolution.kind, 'garment')
  assert.equal(garmentResolution.sets[0].outfits[0].label, 'Piranha and Olive')

  // 5. The same garment appears in two different historical sets — must not silently pick one.
  const ambiguousSets = [
    { setIndex: 0, introText: 'first pass', outfits: [{ label: 'Set A', pieceIds: [700], pieceNames: ['tan straight shorts'], reason: '', strength: '', watchFor: '', bestFor: '' }] },
    { setIndex: 1, introText: 'second pass', outfits: [{ label: 'Set B', pieceIds: [700], pieceNames: ['tan straight shorts'], reason: '', strength: '', watchFor: '', bestFor: '' }] }
  ]
  const ambiguousResolution = resolveHistoricalOutfitContext('go back to the outfit with the tan straight shorts', ambiguousSets, [])
  assert.equal(ambiguousResolution.kind, 'ambiguous')
  assert.equal(ambiguousResolution.setCount, 2)
  const ambiguousText = formatHistoricalOutfitSetsForPrompt(ambiguousResolution)
  assert.match(ambiguousText, /AMBIGUOUS HISTORICAL REFERENCE/)
  assert.match(ambiguousText, /do not silently pick one/i)

  // Direct unit coverage of the garment resolver's own ambiguous/none branches.
  assert.equal(resolveHistoricalReferenceByGarment('what should I wear today?', historicalSets, currentPieceIds).kind, 'none')
})

test('historical outfit-set addressability wired into buildStylistConversationPayload', async () => {
  const { buildStylistConversationPayload } = await import('../styling-engine/core.js')
  const sessionId = `historical-set-${Date.now()}`
  const threadMessages = [
    { role: 'user', text: 'Use my wardrobe to create outfits for casual, artful, lots of walking.' },
    {
      role: 'assistant',
      text: 'Here are the strongest wardrobe outfits.',
      structuredOutfits: [
        { label: 'Botanical Drift', strength: 'signature', reason: 'too elevated for casual, per the lace tank', pieceIds: [901, 902] }
      ]
    },
    { role: 'user', text: 'That reads more elevated than casual.' },
    { role: 'assistant', text: 'You are not wrong — here is why.' },
    { role: 'user', text: 'None of your proposed outfits work. What else can I wear?' },
    {
      role: 'assistant',
      text: 'For Walnut Creek, CA, I’d compare these 5 directions.',
      structuredOutfits: [
        { label: 'Red Crow on the Trail', strength: 'signature', reason: 'paved trail walk, casual hot-weather outing', pieceIds: [350, 245] }
      ]
    }
  ]
  db.prepare('INSERT INTO chat_threads (id, title, payload) VALUES (?, ?, ?)')
    .run(sessionId, 'test thread', JSON.stringify({ messages: threadMessages }))

  // 6/7. Durable constraints (established styling context) carry forward regardless of whether
  // this turn triggers a historical lookup — confirmed on both branches below.
  const commonBody = {
    sessionId,
    conversationMode: 'followup',
    occasion: 'casual',
    season: 'warm; hot weather',
    generatedOutfits: [{ label: 'Red Crow on the Trail', pieceIds: [350, 245] }]
  }

  // 1/2. An ordinary follow-up ("can I have a layer") carries no backward-reference signal: no
  // historical block is injected, and current_outfit_set is exactly the new Walnut Creek set —
  // the old "too elevated" critique of Botanical Drift is nowhere in this turn's fresh context.
  const forwardTurn = await buildStylistConversationPayload({
    ...commonBody,
    question: 'nice! can I have a layer just in case?'
  })
  // The authority rule's own text mentions "HISTORICAL OUTFIT SETS" by name (a pointer to the block
  // below, when present), so check the block's actual superseded-set heading, not the bare phrase.
  assert.doesNotMatch(forwardTurn.system, /HISTORICAL OUTFIT SETS \(superseded/)
  assert.doesNotMatch(forwardTurn.system, /too elevated for casual/)
  assert.equal(forwardTurn.threadState.current_outfit_set[0].label, 'Red Crow on the Trail')
  assert.equal(forwardTurn.threadState.established.occasion, 'casual')
  // The authority rule itself is always present, whether or not a historical block fires this turn.
  assert.match(forwardTurn.system, /CURRENT-SET AUTHORITY/)
  assert.match(forwardTurn.system, /must NOT be applied to current_outfit_set unless the user states or repeats/)

  // 3. An explicit backward reference pulls in the historical set and its own critique text, and
  // still keeps current_outfit_set as the new Walnut Creek set underneath it.
  const backwardTurn = await buildStylistConversationPayload({
    ...commonBody,
    question: 'what was wrong with the first set?'
  })
  assert.match(backwardTurn.system, /HISTORICAL OUTFIT SETS/)
  assert.match(backwardTurn.system, /Botanical Drift/)
  assert.match(backwardTurn.system, /too elevated for casual/)
  assert.equal(backwardTurn.threadState.current_outfit_set[0].label, 'Red Crow on the Trail')
  assert.equal(backwardTurn.threadState.established.occasion, 'casual')
})

test('bounded multi-look discloses unavailable destination weather instead of claiming a season temperature', () => {
  const answer = boundedAtomicMultiLookResponse({
    atomicMultiLookCompleted: true,
    atomicMultiLookRequestedCount: 2,
    boundedLocation: 'Berkeley, CA',
    boundedWeatherUnavailable: true,
    generatedOutfits: [{ label: 'One' }, { label: 'Two' }]
  })
  assert.equal(answer, 'I couldn’t verify the forecast for Berkeley, CA, so these options avoid assuming hot or cold weather; check the temperature before choosing.')
  assert.doesNotMatch(answer, /summer|warm night|hot weather/i)
})

test('supplied live numeric weather owns hard gates without being re-derived from text', async () => {
  const live = {
    isHot: false,
    isCold: false,
    highF: 78,
    lowF: 56,
    weatherSource: 'live'
  }
  const resolveStylingContext = createStylingContextResolver()
  const context = await resolveStylingContext({
    explicitRequest: {
      mood: 'relaxed',
      requestText: 'outdoor farmers market',
      season: 'summer; mild weather; forecast high 78°F, low 56°F',
      weatherProfile: live,
    },
  })
  assert.deepEqual(context.weatherProfile, live)
})

test('unavailable named-place weather remains neutral through shared context resolution', async () => {
  const unavailable = {
    isHot: false,
    isCold: false,
    isRainy: false,
    isWetExposure: false,
    weatherSource: 'unavailable',
    weatherFailure: 'weather_request_failed'
  }
  const resolveStylingContext = createStylingContextResolver()
  const context = await resolveStylingContext({
    explicitRequest: {
      season: 'summer; hot weather',
      weatherProfile: unavailable,
    },
  })
  assert.deepEqual(context.weatherProfile, unavailable)
})

test('shared context resolves live weather only for Current season', async () => {
  const calls = []
  const resolveStylingContext = createStylingContextResolver({
    weatherResolver: async input => {
      calls.push(input)
      return { isHot: false, isCold: false, highF: 69, lowF: 55, weatherSource: 'live' }
    },
  })
  const current = await resolveStylingContext({
    explicitRequest: { season: 'current season', location: 'Walnut Creek, CA', date: '2026-08-19' },
  })
  // Spec future-trip-weather-estimate-spec.md §6.5: location+date now
  // resolves through the structured contract, whose profile carries fuller
  // field-level info (isExtremeHeat/isRainy/isWetExposure/
  // resolvedWeatherContext) than the raw weatherResolver return value alone.
  assert.equal(current.weatherProfile.isHot, false)
  assert.equal(current.weatherProfile.isCold, false)
  assert.equal(current.weatherProfile.highF, 69)
  assert.equal(current.weatherProfile.lowF, 55)
  assert.equal(current.weatherProfile.weatherSource, 'live')
  assert.equal(current.weatherProfile.resolvedWeatherContext.location, 'Walnut Creek, CA')
  assert.equal(calls.length, 1)

  const hypothetical = await resolveStylingContext({
    explicitRequest: { season: 'winter', location: 'Walnut Creek, CA', date: '2026-08-19' },
  })
  assert.equal(hypothetical.weatherProfile.weatherSource, 'heuristic')
  assert.equal(calls.length, 1, 'an explicit seasonal brief must not fetch or be overridden by today\'s weather')
})

test('direct Visual Composer endpoint wires saved location weather into whole-wardrobe composition', () => {
  const routeSrc = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  const routeStart = routeSrc.indexOf("router.post('/generate-wardrobe-outfits-visual'")
  const routeEnd = routeSrc.indexOf('// ── AI Visual Rendering & Boards', routeStart)
  const routeBlock = routeSrc.slice(routeStart, routeEnd)
  assert.match(routeBlock, /location: input\.location \|\| getHomeLocation\(\)/)
  assert.match(routeBlock, /generateWholeWardrobeOutfitsVisualInternal\(\{/)
  assert.match(routeBlock, /date: input\.date \|\| input\.currentDate \|\| new Date\(\)/)
})

test('bounded composer schema accepts location and resolved date for weather', () => {
  const schema = STYLIST_TOOLS.find(tool => tool.name === 'generate_outfits')?.input_schema
  assert.equal(schema?.properties?.location?.type, 'string')
  assert.match(schema?.properties?.date?.description || '', /YYYY-MM-DD/)
})

test('bounded generate call declares its own cards contract only inside the narrow profile', () => {
  // Default-on since 2026-08-19. The narrowness now comes entirely from the turn shape, not a flag.
  const bounded = { turnMode: 'new_request' }
  assert.equal(declareBoundedMultiLookIntent(bounded, { limit: 3 }), true)
  assert.deepEqual(bounded.declaredIntent, { want: 'cards', outfitCount: 3, turnMode: 'new_request' })

  const ordinaryWhatToWear = { turnMode: 'new_request' }
  assert.equal(declareBoundedMultiLookIntent(ordinaryWhatToWear), true)
  assert.deepEqual(ordinaryWhatToWear.declaredIntent, { want: 'cards', outfitCount: 2, turnMode: 'new_request' })

  // The four shapes that must still fall through to the verified serial path.
  for (const [context, call] of [
    [{ turnMode: 'followup' }, { limit: 3 }],
    [{ turnMode: 'new_request' }, { limit: 1 }],
    [{ turnMode: 'new_request' }, { limit: 3, pieceId: 42 }],
    [{ turnMode: 'new_request', declaredIntent: { want: 'text' } }, { limit: 3 }],
  ]) {
    assert.equal(declareBoundedMultiLookIntent(context, call), false)
    assert.notDeepEqual(context.declaredIntent, { want: 'cards', outfitCount: 3, turnMode: 'new_request' })
  }
})

test('adaptive visual evidence rides the bounded multi-look path only', () => {
  // Default-on since 2026-08-19; scoping is now structural — bounded whole-wardrobe generation gets
  // adaptive detail and resolved weather, the selected-piece path deliberately gets neither.
  const routeSrc = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  const toolsSrc = fs.readFileSync(path.join(process.cwd(), 'styling-engine/tools.js'), 'utf8')
  assert.doesNotMatch(toolsSrc, /WARDROBE_FREEFORM_/, 'freeform feature flags are removed, not re-added')
  assert.match(toolsSrc, /generatedOutfits\.some\(outfit => !outfit\?\.broken\)/, 'bounded generation must not overwrite an earlier valid card in a hybrid turn')
  assert.match(routeSrc, /pieceVisualDetailPolicy\(p, \{ allowLow: adaptiveVisualDetail \}\)/)
  assert.match(routeSrc, /imageSizeCounts/)
  const wholeWardrobeCall = toolsSrc.slice(
    toolsSrc.indexOf('result = await generateWholeWardrobeOutfitsVisualInternal({'),
    toolsSrc.indexOf('\n          })', toolsSrc.indexOf('result = await generateWholeWardrobeOutfitsVisualInternal({'))
  )
  const selectedPieceCall = toolsSrc.slice(
    toolsSrc.indexOf('result = await generateOutfitsForPieceInternal({'),
    toolsSrc.indexOf('\n          })', toolsSrc.indexOf('result = await generateOutfitsForPieceInternal({'))
  )
  assert.match(wholeWardrobeCall, /resolvedWeatherProfile: boundedMultiLook \? toolContext\.weatherProfile : null/)
  assert.match(wholeWardrobeCall, /adaptiveVisualDetail: boundedMultiLook/)
  assert.doesNotMatch(selectedPieceCall, /adaptiveVisualDetail|resolvedWeatherProfile/)
})

test('nested composer usage is included in the parent freeform diagnostics', () => {
  const toolContext = {}
  recordNestedFreeformUsage(toolContext, {
    inputTokens: 1200,
    outputTokens: 340,
    cacheReadInputTokens: 900,
    cacheCreationInputTokens: 50
  })
  assert.equal(toolContext.freeformDiagnostics.providerIterations, 1)
  assert.equal(toolContext.freeformDiagnostics.providerInputTokens, 1200)
  assert.equal(toolContext.freeformDiagnostics.providerOutputTokens, 340)
  assert.equal(toolContext.freeformDiagnostics.providerCacheReadInputTokens, 900)
  assert.equal(toolContext.freeformDiagnostics.providerCacheCreationInputTokens, 50)
})

// Cache-efficiency investigation (2026-08-21): a turn's tool_sequence used to be able to say
// "declare_intent;generate_outfits" while provider_iterations said 4 — the nested composer call
// generate_outfits triggers internally counted toward the total but never appeared in the ordered
// sequence, so the 4th call's identity had to be guessed. recordNestedFreeformUsage is the one place
// all nested composer usage flows through (styling-engine/tools.js's generate_outfits case), so this
// pins that it now also records its own step in tool_sequence.
test('nested composer usage also records its own step in tool_sequence', () => {
  const toolContext = {}
  recordFreeformToolIteration(toolContext, ['execution_router'])
  recordFreeformToolIteration(toolContext, ['declare_intent'])
  recordFreeformToolIteration(toolContext, ['generate_outfits'])
  recordNestedFreeformUsage(toolContext, {
    inputTokens: 1200, outputTokens: 340, cacheReadInputTokens: 900, cacheCreationInputTokens: 50
  })
  assert.equal(
    toolContext.freeformDiagnostics.toolSequence,
    'execution_router;declare_intent;generate_outfits;nested_composer'
  )
  assert.equal(toolContext.freeformDiagnostics.providerIterations, 1)
})

// recordNestedFreeformUsage is a no-op guard (usage is null/falsy) when generate_outfits's internal
// call never happened at all — that must not fabricate a tool_sequence entry for a call that was
// never made.
test('recordNestedFreeformUsage does not touch tool_sequence when there is no usage to record', () => {
  const toolContext = {}
  recordFreeformToolIteration(toolContext, ['declare_intent'])
  recordNestedFreeformUsage(toolContext, null)
  assert.equal(toolContext.freeformDiagnostics.toolSequence, 'declare_intent')
})

test('bounded batch contract uses the server-resolved new-request mode when declaration omits it', async () => {
  {
    const toolContext = { turnMode: 'new_request' }
    const result = await executeTool('declare_intent', { want: 'cards', outfit_count: 3 }, toolContext)
    assert.match(result.message, /call generate_outfits exactly once with limit:3/)
    assert.equal(toolContext.declaredIntent.turnMode, null)

    const followup = await executeTool('declare_intent', { want: 'cards', outfit_count: 3 }, { turnMode: 'followup' })
    assert.doesNotMatch(followup.message, /call generate_outfits exactly once/)
  }
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

// Live case (thread_1788054462046, Gemini 3.5 Flash Lite): a real, correctly-verified answer cited
// every one of its 12 pieces as a bare "(146)" instead of the mandated "(ID 146)" — the mandated-form-
// only regex found nothing, silently defeating both the truth clause's verification check and
// docs/bounded-multi-context-continuity-spec.md's persisted-discussion tracking on a perfect target
// case.
test('extractPieceIdsFromProse also recognizes a bare (n) citation, but only when it is a known piece id', () => {
  const prose = 'Navy wool turtleneck (146) or Black turtleneck (144): warm for a cool evening.'
  assert.deepEqual(extractPieceIdsFromProse(prose), [], 'without knownPieceIds, bare citations are not recognized at all')
  assert.deepEqual(extractPieceIdsFromProse(prose, { knownPieceIds: new Set([146, 144]) }), [146, 144])
  // A number that happens to sit in parentheses but is not a real, in-scope piece id must never
  // become a false citation -- the whole point of gating this on knownPieceIds.
  assert.deepEqual(
    extractPieceIdsFromProse('We have 3 formal events (2 weddings) this month.', { knownPieceIds: new Set([2, 3]) }),
    [],
    'a coincidental in-parens number that is not actually a garment reference must not be swept in'
  )
})

test('stripPieceIdCitations also removes a bare (n) citation when it is a known piece id, and nothing else', () => {
  const text = 'Wear the blouse (146) with the trousers (182).'
  assert.equal(stripPieceIdCitations(text), text, 'without knownPieceIds, bare citations are left alone')
  assert.equal(
    stripPieceIdCitations(text, { knownPieceIds: new Set([146, 182]) }),
    'Wear the blouse with the trousers.'
  )
  assert.equal(
    stripPieceIdCitations('We have 3 formal events (2 weddings) this month.', { knownPieceIds: new Set([2, 3]) }),
    'We have 3 formal events (2 weddings) this month.',
    'a coincidental in-parens number that is not a garment reference must survive untouched'
  )
})

test('persistFreeformGenerationRun does not throw when diagnostics are missing', () => {
  assert.doesNotThrow(() => persistFreeformGenerationRun({ occasion: 'casual', diagnostics: {} }))
  assert.doesNotThrow(() => persistFreeformGenerationRun({}))
})

// Spec future-trip-weather-estimate-spec.md §3.1/§6.5: search_wardrobe's
// free-text `weather` is removed; a structured weather_estimate resolves
// through resolveWeatherForRequest and short-circuits before any live
// lookup is even attempted (no location/date here to geocode against) —
// this test only verifies the wiring, not live weather (see weather.test.js
// for live-path coverage via a mocked fetchImpl).
test('executeTool search_wardrobe records weatherSource onto toolContext.freeformDiagnostics', async () => {
  const toolContext = {}
  await executeTool('search_wardrobe', { occasion: 'city', weather_estimate: { high_f: 90, low_f: 75 } }, toolContext)
  assert.equal(toolContext.freeformDiagnostics.weatherSource, 'model_estimate')
})

test('executeTool search_wardrobe excludes ordinary open sandals from a cold compose roster', async () => {
  const insert = db.prepare(`
    INSERT INTO pieces
      (name, category, status, occasions, formality, shoe_type, toe_shape, heel_height, walk_support)
    VALUES (?, 'shoes', 'active', '["city"]', 'everyday', ?, ?, 'flat', 'high')
  `)
  const sandalId = Number(insert.run('cold search open sandal', 'sandal', 'open_toe').lastInsertRowid)
  const sneakerId = Number(insert.run('cold search closed sneaker', 'sneaker', 'round').lastInsertRowid)
  try {
    const toolContext = { freeformDiagnostics: {} }
    const results = await executeTool('search_wardrobe', {
      category: 'shoes',
      occasion: 'city',
      weather_estimate: { high_f: 65, low_f: 45 },
    }, toolContext)
    const ids = new Set(results.filter(item => item?.id).map(item => Number(item.id)))
    assert.equal(ids.has(sandalId), false)
    assert.equal(ids.has(sneakerId), true)
    assert.ok(toolContext.freeformDiagnostics.gateExcludedTotal >= 1)
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?)').run(sandalId, sneakerId)
  }
})

test('search relaxation counts one hard-gated piece once across all internal retry rungs', async () => {
  const activeShoeIds = db.prepare("SELECT id FROM pieces WHERE category = 'shoes' AND status = 'active'").all().map(row => Number(row.id))
  db.prepare("UPDATE pieces SET status = 'inactive' WHERE category = 'shoes' AND status = 'active'").run()
  const sandalId = Number(db.prepare(`
    INSERT INTO pieces
      (name, category, status, occasions, formality, shoe_type, toe_shape, heel_height, walk_support)
    VALUES ('relaxation cold open sandal', 'shoes', 'active', '["city"]', 'everyday', 'sandal', 'open_toe', 'flat', 'high')
  `).run().lastInsertRowid)
  try {
    const toolContext = { freeformDiagnostics: {} }
    const results = await executeTool('search_wardrobe', {
      category: 'shoes',
      occasion: 'city',
      activity: 'walking',
      weather_estimate: { high_f: 55, low_f: 40 },
    }, toolContext)

    assert.equal(results.some(item => Number(item?.id) === sandalId), false)
    assert.ok(results.some(item => /1 piece\(s\) filtered out/.test(item?.note || '')))
    assert.equal(toolContext.freeformDiagnostics.searchCalls, 1)
    assert.equal(toolContext.freeformDiagnostics.gateExcludedTotal, 1)
  } finally {
    db.prepare('DELETE FROM pieces WHERE id = ?').run(sandalId)
    const restore = db.prepare("UPDATE pieces SET status = 'active' WHERE id = ?")
    for (const id of activeShoeIds) restore.run(id)
  }
})

test('executeTool propose_outfit preserves cached cold transit when season is indoor', async () => {
  const insert = db.prepare(`
    INSERT INTO pieces
      (name, category, status, occasions, formality, fabric_category, fabric_weight, sleeve_length, shoe_type, toe_shape, heel_height, walk_support)
    VALUES (?, ?, 'active', '["city"]', 'everyday', ?, ?, ?, ?, ?, ?, ?)
  `)
  const topId = Number(insert.run('indoor transit long sleeve top', 'top', 'cotton', 'light', 'long', null, null, null, null).lastInsertRowid)
  const bottomId = Number(insert.run('indoor transit trousers', 'bottom', 'cotton', 'medium', null, null, null, null, null).lastInsertRowid)
  const sandalId = Number(insert.run('indoor transit open sandal', 'shoes', 'leather', 'light', null, 'sandal', 'open_toe', 'flat', 'high').lastInsertRowid)
  // Added 2026-09-01: freeform now runs the shared cold-transit floor, which this outfit failed
  // before reaching the footwear rule this test is about. A sleeve-bearing removable layer clears
  // that floor and leaves the open-toe assertion below testing what it was written to test.
  const layerId = Number(insert.run('indoor transit sleeved jacket', 'outerwear', 'wool', 'medium', 'long', null, null, null, null).lastInsertRowid)
  try {
    const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], freeformDiagnostics: {} }
    await executeTool('search_wardrobe', {
      occasion: 'city',
      location: 'Vienna, Virginia',
      date: '2026-10-12',
      weather_estimate: { high_f: 65, low_f: 45 },
    }, toolContext)
    await executeTool('search_wardrobe', {
      query: 'indoor transit open sandal',
      occasion: 'city',
      intent: 'explain',
    }, toolContext)

    const result = await executeTool('propose_outfit', {
      label: 'Cold museum transit',
      season: 'indoor',
      occasion: 'city',
      pieces: [
        { id: topId, role: 'primary_top' },
        { id: bottomId, role: 'primary_bottom' },
        { id: sandalId, role: 'shoes' },
        { id: layerId, role: 'layer_top' },
      ],
    }, toolContext)

    assert.equal(toolContext.weatherProfile.isIndoor, true)
    assert.equal(toolContext.weatherProfile.transitIsCold, true)
    assert.equal(toolContext.weatherProfile.resolvedWeatherContext.location, 'Vienna, Virginia')
    assert.equal(result.status, 'validation_error')
    assert.match(result.message, /cold weather.*(open-toe|sandal)/i)
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?, ?)').run(topId, bottomId, sandalId)
  }
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
test('shared tool context short-circuits to stated weather before live resolution', async () => {
  let calls = 0
  const weatherResolver = async () => {
    calls += 1
    return { weatherSource: 'live', isHot: true, highF: 95, lowF: 70 }
  }
  const context = await resolveToolStylingContext({
    explicitRequest: { statedWeather: 'rainy weather', location: 'Los Angeles', season: 'current season' },
    policy: { allowLiveWeather: true },
    weatherResolver,
  })
  const profile = context.weatherProfile
  assert.equal(profile.weatherSource, 'stated')
  assert.equal(profile.isHot, false, '"rainy weather" must not inherit the hot classification a live LA lookup would have returned')
  assert.equal(calls, 0, 'a stated override must short-circuit before any geocode/forecast call')
})

test('shared tool context falls through to live resolution when weather is unstated', async () => {
  const weatherResolver = async () => ({ weatherSource: 'live', isHot: true, highF: 95, lowF: 70 })
  const context = await resolveToolStylingContext({
    explicitRequest: { location: 'Los Angeles', season: 'current season' },
    policy: { allowLiveWeather: true },
    weatherResolver,
  })
  const profile = context.weatherProfile
  assert.equal(profile.weatherSource, 'live')
  assert.equal(profile.isHot, true)
})

// ============================================================================
// docs/future-trip-weather-estimate-spec.md §6.5 single-outfit parity —
// search_wardrobe/propose_outfit/generate_outfits now resolve a named
// destination/date through the SAME structured contract as plan_outfit_set,
// via resolveNamedDestinationWeather (styling-engine/stylingContext.js).
// ============================================================================

// A location alone (no date, no structured weather) must NOT be treated as a
// named destination/date — it stays on the legacy live-for-today path
// (previous test above). Only location+date (or a structured weather input
// on its own) activates the new resolver.
test('resolveToolStylingContext: location+date resolves through the structured contract via live weather', async () => {
  const toolContext = {}
  const weatherResolver = async ({ location, date }) => {
    assert.equal(location, 'Vienna, Virginia')
    assert.equal(date, '2026-09-05')
    return { weatherSource: 'live', isHot: false, isCold: true, highF: 65, lowF: 45 }
  }
  const context = await resolveToolStylingContext({
    explicitRequest: { location: 'Vienna, Virginia', date: '2026-09-05', season: 'current season' },
    toolContext,
    policy: { allowLiveWeather: true },
    weatherResolver,
  })
  assert.equal(context.weatherProfile.weatherSource, 'live')
  assert.equal(context.weatherProfile.isCold, true)
  assert.ok(toolContext.resolvedWeatherContext, 'the resolved context must be cached onto toolContext for a later propose_outfit call to reuse')
  assert.equal(toolContext.resolvedWeatherContext.location, 'Vienna, Virginia')
})

test('resolveToolStylingContext: a future destination outside live coverage falls back to weather_estimate, then stays unavailable without one', async () => {
  const unavailableResolver = async () => ({ weatherSource: 'unavailable' })
  const withEstimate = await resolveToolStylingContext({
    explicitRequest: {
      location: 'Vienna, Virginia',
      date: '2026-10-12',
      weatherEstimate: { high_f: 65, low_f: 45 },
    },
    toolContext: {},
    policy: { allowLiveWeather: true },
    weatherResolver: unavailableResolver,
  })
  assert.equal(withEstimate.weatherProfile.weatherSource, 'model_estimate')
  assert.equal(withEstimate.weatherProfile.isCold, true)

  const withoutEstimate = await resolveToolStylingContext({
    explicitRequest: { location: 'Vienna, Virginia', date: '2026-10-12' },
    toolContext: {},
    policy: { allowLiveWeather: true },
    weatherResolver: unavailableResolver,
  })
  assert.equal(withoutEstimate.weatherProfile.weatherSource, 'unavailable')
  assert.equal(withoutEstimate.weatherProfile.isCold, false, 'unresolved must never read as mild/known')
})

// Spec §9 items 15/17: none of these date-, count-, temperature-, or
// styling-flavored strings can create or alter resolved weather — the old
// regex-based currentTurnStatedWeather repair this replaced was deleted
// specifically because it scanned prose like this for numbers/condition
// words; the new resolver never reads requestText/mood/season for temperature
// at all, only structured user_weather/weather_estimate/live fields. Every
// phrase below is taken verbatim from the spec's own anti-regression list.
test('resolveToolStylingContext: prose (dates, counts, Celsius, styling adjectives) cannot create or alter resolved weather', async () => {
  const proseNeedle = [
    'October 12', '10 outfits', '18°C', 'warm colors', 'cool outfit',
    'winter white', 'icy blue', 'crisp outdoor walking weather',
  ].join(', please style for: ')
  const unavailableResolver = async () => ({ weatherSource: 'unavailable' })
  const context = await resolveToolStylingContext({
    explicitRequest: {
      location: 'Vienna, Virginia',
      date: '2026-10-12',
      requestText: proseNeedle,
      // A malformed request also tries to smuggle the same prose into the
      // structured fields themselves — the validator must reject the shape,
      // not extract a number from within the string (item 17).
      userWeather: { temperature_band: '18°C' },
      weatherEstimate: { high_f: 'warm colors', low_f: 'icy blue' },
    },
    toolContext: {},
    inferred: { requestText: proseNeedle },
    policy: { allowLiveWeather: true, mode: 'freeform_action' },
    weatherResolver: unavailableResolver,
  })
  assert.equal(context.weatherProfile.weatherSource, 'unavailable', 'malformed structured fields must be rejected outright, not parsed from their prose-like values')
  assert.equal(context.weatherProfile.isHot, false)
  assert.equal(context.weatherProfile.isCold, false, 'prose must never resolve to a known temperature, hot or cold')
  assert.equal(context.weatherProfile.highF, undefined)
  assert.equal(context.weatherProfile.lowF, undefined)
})

test('resolveToolStylingContext: a bare structured user_weather with no named place resolves via the no-destination branch, not the legacy heuristic', async () => {
  const context = await resolveToolStylingContext({
    explicitRequest: { userWeather: { temperature_band: 'cold' } },
    policy: { allowLiveWeather: true },
  })
  assert.equal(context.weatherProfile.weatherSource, 'stated_user')
  assert.equal(context.weatherProfile.isCold, true)
})

// Spec §6.5: "search stores its resolved context in toolContext; proposal
// consumes the matching context." A second call with the SAME location/date
// identity and no new structured weather reuses the cached result instead of
// re-resolving (re-geocoding).
test('resolveToolStylingContext: a matching second call reuses the cached resolved context instead of re-fetching', async () => {
  let resolverCalls = 0
  const toolContext = {}
  const weatherResolver = async () => {
    resolverCalls += 1
    return { weatherSource: 'live', isHot: false, isCold: true, highF: 65, lowF: 45 }
  }
  await resolveToolStylingContext({
    explicitRequest: { location: 'Vienna, Virginia', date: '2026-09-05' },
    toolContext,
    policy: { allowLiveWeather: true },
    weatherResolver,
  })
  const callsAfterFirst = resolverCalls
  assert.ok(callsAfterFirst > 0, 'the first call must actually resolve live weather')

  // propose_outfit-style follow-up: same location/date, no fresh structured input.
  const reused = await resolveToolStylingContext({
    explicitRequest: { location: 'Vienna, Virginia', date: '2026-09-05' },
    toolContext,
    policy: { allowLiveWeather: true },
    weatherResolver,
  })
  assert.equal(resolverCalls, callsAfterFirst, 'a matching identity must reuse the cache, not re-resolve')
  assert.equal(reused.weatherProfile.weatherSource, 'live')
  assert.equal(reused.weatherProfile.isCold, true)
})

// Spec §6.2, extended to search_wardrobe/propose_outfit/generate_outfits by §6.5:
// a named destination/date with no resolved temperature (no live coverage under
// NODE_ENV=test's network skip, no weather_estimate, no user_weather) must stop
// with a typed weather_context_required response before retrieval/scoring, the
// same as plan_outfit_set already does.
test('executeTool search_wardrobe stops with weather_context_required for a named destination/date with no resolved temperature', async () => {
  const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [] }
  const result = await executeTool('search_wardrobe', {
    occasion: 'city',
    location: 'Vienna, Virginia',
    date: '2026-10-12',
  }, toolContext)
  assert.equal(result.status, 'weather_context_required')
  assert.equal(result.location, 'Vienna, Virginia')
  assert.equal(result.date_range.start, '2026-10-12')
  assert.deepEqual(result.missing, ['temperature'])
  assert.match(result.message, /weather_estimate/)
})

test('executeTool search_wardrobe proceeds normally for a bare structured weather claim with no named destination', async () => {
  const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], occasion: 'city' }
  const result = await executeTool('search_wardrobe', {
    occasion: 'city',
    user_weather: { precipitation: 'rain' },
  }, toolContext)
  assert.ok(Array.isArray(result), 'no destination named — precipitation-only input must not stop the search')
  assert.equal(toolContext.weatherProfile?.isHot, false)
})

// Spec §9 item 16: "A free-text weather HTTP field cannot alter roster
// membership or validation." search_wardrobe's schema no longer advertises a
// `weather` argument at all, but executeTool takes a plain args object with no
// schema enforcement of its own — a caller (or an unpatched client) could still
// send one over HTTP. Prove it is silently ignored, not read for gating.
test('executeTool search_wardrobe ignores an undeclared free-text weather arg entirely', async () => {
  const withStray = { declaredIntent: { want: 'cards' }, generatedOutfits: [], occasion: 'city' }
  await executeTool('search_wardrobe', { occasion: 'city', weather: 'freezing arctic blast' }, withStray)
  const withoutStray = { declaredIntent: { want: 'cards' }, generatedOutfits: [], occasion: 'city' }
  await executeTool('search_wardrobe', { occasion: 'city' }, withoutStray)
  assert.equal(withStray.weatherProfile?.isCold, withoutStray.weatherProfile?.isCold, 'a stray weather string must not flip isCold')
  assert.equal(withStray.weatherProfile?.weatherSource, withoutStray.weatherProfile?.weatherSource)
})

test('executeTool propose_outfit stops with weather_context_required for a named destination/date with no resolved temperature', async () => {
  db.prepare('DELETE FROM pieces').run()
  const topId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('weather-stop top', 'top', '[]', '["city"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'top', '', 'cotton', 'medium', '["cotton"]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const bottomId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('weather-stop bottom', 'bottom', '[]', '["city"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'bottom', '', 'denim', 'medium', '["cotton"]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const shoesId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json, heel_height, walk_support)
    VALUES ('weather-stop shoes', 'shoes', '[]', '["city"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'shoes', '', 'leather', 'medium', '["leather"]', 'everyday', '', '{}', 'flat', 'medium')
  `).run().lastInsertRowid
  try {
    const toolContext = {
      declaredIntent: { want: 'cards' },
      generatedOutfits: [],
      retrievedPieceIds: new Set([topId, bottomId, shoesId]),
    }
    const result = await executeTool('propose_outfit', {
      pieces: [
        { id: topId, role: 'primary_top' },
        { id: bottomId, role: 'primary_bottom' },
        { id: shoesId, role: 'shoes' },
      ],
      label: 'Vienna Evening',
      why_it_works: 'a simple city outfit',
      location: 'Vienna, Virginia',
      date: '2026-10-12',
    }, toolContext)
    assert.equal(result.status, 'weather_context_required')
    assert.equal(result.location, 'Vienna, Virginia')
    assert.equal(result.date_range.start, '2026-10-12')
    assert.deepEqual(result.missing, ['temperature'])
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?, ?)').run(topId, bottomId, shoesId)
  }
})

// Spec §7: an accepted card persists the truthful weather disclosure and its
// serialized structured context, not just the shared toolContext-level
// weatherProfile — so a later follow-up can read this specific outfit's weather
// back even if other outfits in the set resolved differently.
test('executeTool propose_outfit persists weatherUsed/resolvedWeatherContext onto the accepted card via a weather_estimate fallback', async () => {
  const topId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('weather-persist top', 'top', '[]', '["city"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'top', '', 'wool', 'heavy', '["wool"]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const bottomId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('weather-persist bottom', 'bottom', '[]', '["city"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'bottom', '', 'denim', 'medium', '["cotton"]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const shoesId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json, heel_height, walk_support)
    VALUES ('weather-persist shoes', 'shoes', '[]', '["city"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'shoes', '', 'leather', 'medium', '["leather"]', 'everyday', '', '{}', 'flat', 'medium')
  `).run().lastInsertRowid
  // Added 2026-09-01: a 40°F low now carries isColdSevere through the structured-weather projection
  // (it was silently dropped before), so an outfit with no outer layer at all legitimately fails.
  // The layer keeps this test measuring weatherUsed/resolvedWeatherContext PERSISTENCE, its subject.
  const layerId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json, sleeve_length, outerwear_role)
    VALUES ('weather-persist coat', 'outerwear', '[]', '["city"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'coat', '', 'wool', 'heavy', '["wool"]', 'everyday', '', '{}', 'long', 'cold_weather_outerwear')
  `).run().lastInsertRowid
  try {
    const toolContext = {
      declaredIntent: { want: 'cards' },
      generatedOutfits: [],
      retrievedPieceIds: new Set([topId, bottomId, shoesId, layerId]),
    }
    const result = await executeTool('propose_outfit', {
      pieces: [
        { id: topId, role: 'primary_top' },
        { id: bottomId, role: 'primary_bottom' },
        { id: shoesId, role: 'shoes' },
        { id: layerId, role: 'layer_top' },
      ],
      label: 'Vienna Evening',
      why_it_works: 'a warm layered city outfit',
      location: 'Vienna, Virginia',
      date: '2026-10-12',
      weather_estimate: { high_f: 55, low_f: 40 },
    }, toolContext)
    assert.equal(result.status, 'success')
    const card = toolContext.generatedOutfits[0]
    assert.match(card.weatherUsed, /55°F high \/ 40°F low — seasonal estimate, not a live forecast/)
    assert.equal(card.resolvedWeatherContext.location, 'Vienna, Virginia')
    assert.equal(card.resolvedWeatherContext.overall_source, 'model_estimate')
    assert.equal(card.resolvedWeatherContext.temperature.high_f, 55)
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?, ?)').run(topId, bottomId, shoesId)
  }
})

// Regression: propose_outfit/generate_outfits used to funnel their own
// `season` argument into legacy `statedWeather` whenever it wasn't a
// recognized calendar-season word (extractSeasonRequest returns '' for
// "hot weather") — and resolveWeather checks statedWeatherCandidate BEFORE
// any structured resolution ever runs, so a model-invented free-text season
// like "hot weather" silently outranked a genuine structured
// weather_estimate for a named destination. This defeated the entire "one
// structured authority" architecture on both single-outfit tools.
test('executeTool propose_outfit: a genuine weather_estimate is not overridden by an arbitrary free-text season string', async () => {
  const topId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('prose-bypass top', 'top', '[]', '["city"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'top', '', 'cotton', 'medium', '["cotton"]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const bottomId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('prose-bypass bottom', 'bottom', '[]', '["city"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'bottom', '', 'denim', 'medium', '["cotton"]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const shoesId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json, heel_height, walk_support)
    VALUES ('prose-bypass shoes', 'shoes', '[]', '["city"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'shoes', '', 'leather', 'medium', '["leather"]', 'everyday', '', '{}', 'flat', 'medium')
  `).run().lastInsertRowid
  // Added 2026-09-01: freeform now reaches the shared cold-warmth floor, and a 45°F low with no
  // outer layer legitimately fails it. The layer keeps the outfit weather-valid so the assertions
  // below still measure weather AUTHORITY — this test's actual subject — not outfit adequacy.
  const layerId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json, sleeve_length)
    VALUES ('prose-bypass coat', 'outerwear', '[]', '["city"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'coat', '', 'wool', 'heavy', '["wool"]', 'everyday', '', '{}', 'long')
  `).run().lastInsertRowid
  try {
    const toolContext = { declaredIntent: { want: 'cards' }, generatedOutfits: [], retrievedPieceIds: new Set([topId, bottomId, shoesId, layerId]) }
    const result = await executeTool('propose_outfit', {
      pieces: [
        { id: topId, role: 'primary_top' },
        { id: bottomId, role: 'primary_bottom' },
        { id: shoesId, role: 'shoes' },
        { id: layerId, role: 'layer_top' },
      ],
      label: 'Prose Bypass Test',
      why_it_works: 'test',
      location: 'Vienna, Virginia',
      date: '2026-10-12',
      weather_estimate: { high_f: 65, low_f: 45 },
      season: 'hot weather',
    }, toolContext)
    assert.equal(result.status, 'success')
    assert.equal(toolContext.weatherProfile.isCold, true, 'the structured 65/45 estimate must win, not the "hot weather" prose')
    assert.equal(toolContext.weatherProfile.weatherSource, 'model_estimate')
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?, ?)').run(topId, bottomId, shoesId)
  }
})

// Regression: an unresolved named destination used to fall back to whatever
// toolContext.weatherProfile already held from an EARLIER call this turn
// (a different location, or a prior turn's snapshot) instead of surfacing as
// genuinely unresolved. Because that stale snapshot carries no
// resolvedWeatherContext, weatherContextRequiredStop could never fire — the
// typed stop was silently bypassed whenever any prior weather happened to be
// cached, which is common (search_wardrobe runs before most propose_outfit
// calls).
test('executeTool propose_outfit: an unresolved named destination stops even when a stale weatherProfile from an earlier call this turn exists', async () => {
  const topId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('stale-snapshot top', 'top', '[]', '["city"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'top', '', 'cotton', 'medium', '["cotton"]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const bottomId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES ('stale-snapshot bottom', 'bottom', '[]', '["city"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'bottom', '', 'denim', 'medium', '["cotton"]', 'everyday', '', '{}')
  `).run().lastInsertRowid
  const shoesId = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes, pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json, heel_height, walk_support)
    VALUES ('stale-snapshot shoes', 'shoes', '[]', '["city"]', 'year-round', '', 'active', 'trusted', 'high', 'auto', '[]', '', 'solid', 'none', 'solid', 'shoes', '', 'leather', 'medium', '["leather"]', 'everyday', '', '{}', 'flat', 'medium')
  `).run().lastInsertRowid
  try {
    const toolContext = {
      declaredIntent: { want: 'cards' },
      generatedOutfits: [],
      retrievedPieceIds: new Set([topId, bottomId, shoesId]),
      // A stale snapshot from an earlier call this turn (e.g. an at-home
      // search before the user mentioned a trip).
      weatherProfile: { weatherSource: 'live', isHot: true, isCold: false, highF: 95, lowF: 75 },
    }
    const result = await executeTool('propose_outfit', {
      pieces: [
        { id: topId, role: 'primary_top' },
        { id: bottomId, role: 'primary_bottom' },
        { id: shoesId, role: 'shoes' },
      ],
      label: 'Stale Snapshot Test',
      why_it_works: 'test',
      location: 'Vienna, Virginia',
      date: '2026-10-12',
    }, toolContext)
    assert.equal(result.status, 'weather_context_required', `an unresolved Vienna destination must stop, not silently reuse the stale hot snapshot, got: ${JSON.stringify(result)}`)
  } finally {
    db.prepare('DELETE FROM pieces WHERE id IN (?, ?, ?)').run(topId, bottomId, shoesId)
  }
})

test('executeTool generate_outfits stops with weather_context_required for a named destination/date with no resolved temperature', async () => {
  const toolContext = {
    declaredIntent: { want: 'cards' },
    generatedOutfits: [],
    turnMode: 'new_request',
  }
  const result = await executeTool('generate_outfits', {
    occasion: 'city',
    season: 'current season',
    location: 'Vienna, Virginia',
    date: '2026-10-12',
    limit: 2,
  }, toolContext)
  assert.equal(result.status, 'weather_context_required')
  assert.equal(result.location, 'Vienna, Virginia')
  assert.equal(result.date_range.start, '2026-10-12')
  assert.deepEqual(result.missing, ['temperature'])
})

test('executeTool: search_wardrobe then propose_outfit share the same resolved weather context', async () => {
  const toolContext = {
    declaredIntent: { want: 'cards' },
    generatedOutfits: [],
  }
  await executeTool('search_wardrobe', {
    occasion: 'city',
    location: 'Vienna, Virginia',
    date: '2026-10-12',
    weather_estimate: { high_f: 65, low_f: 45 },
  }, toolContext)
  assert.equal(toolContext.weatherProfile.weatherSource, 'model_estimate')
  assert.equal(toolContext.weatherProfile.isCold, true)

  // propose_outfit passes no location/date of its own — it must inherit the
  // context search_wardrobe already resolved for the same turn.
  const proposeContext = await resolveToolStylingContext({
    explicitRequest: {},
    toolContext,
    policy: { allowLiveWeather: true },
  })
  assert.equal(proposeContext.weatherProfile.weatherSource, 'model_estimate')
  assert.equal(proposeContext.weatherProfile.isCold, true)
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
    // Simulates the model correctly translating the followup's own explicit
    // weather claim into structured user_weather, as it should have done live.
    await executeTool('search_wardrobe', { occasion: 'city', activity: 'none', user_weather: { precipitation: 'rain' } }, toolContext)
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

test('search excludes hot-weather hard failures before composition and propose_outfit still enforces the gate', async () => {
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
    const composeSearch = await executeTool('search_wardrobe', {
      occasion: 'city',
      activity: 'walking',
      weather_estimate: { high_f: 92, low_f: 78 },
    }, toolContext)
    assert.equal(toolContext.weatherProfile?.isHot, true)
    assert.equal(toolContext.activity, 'walking')
    assert.equal(composeSearch.some(item => Number(item?.id) === Number(woolTopId)), false,
      'the insulating top must not enter the model composition roster')

    // Explain mode intentionally makes the rejected garment inspectable. Once
    // verified, the proposal boundary must still enforce the same hard gate.
    await executeTool('search_wardrobe', {
      query: 'obs green brown wool tunic',
      occasion: 'city',
      activity: 'walking',
      intent: 'explain',
    }, toolContext)

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
    assert.equal(toolContext.generatedOutfits[0].season, 'current season')
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

// docs/activity-and-roster-spec.md Part 4 — narration written beside tool calls must reach the user.
// Live shape (thread_1786908272853): the model wrote each look's prose in the same assistant
// messages as its propose_outfit calls and closed with "---\n\nA few quick notes…". Only that
// closing message survived, so the reply began with an orphan horizontal rule and referred to
// "Look 1/2/3" — labels no card carries.
test('assistant text is collected from every block, not just the first', async () => {
  const { collectAssistantText } = await import('../styling-engine/provider.js')

  // The old code read content[0].text. A final message can carry more than one text block, and
  // a tool-use message interleaves prose with tool_use blocks.
  assert.equal(collectAssistantText([{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }]), 'one\n\ntwo')
  assert.equal(collectAssistantText([
    { type: 'text', text: 'Look 1 — Earthy Trail Ease' },
    { type: 'tool_use', id: 'tu1', name: 'propose_outfit', input: {} },
  ]), 'Look 1 — Earthy Trail Ease')
  assert.equal(collectAssistantText([{ type: 'tool_use', id: 'tu1', name: 'x', input: {} }]), '')
  assert.equal(collectAssistantText('plain string  '), 'plain string')
  assert.equal(collectAssistantText(null), '')
})

test('narration written beside tool calls is joined ahead of the closing message', async () => {
  const { joinAssistantNarration } = await import('../styling-engine/provider.js')

  const looks = '**Look 1 — Earthy Trail Ease**\nThe striped tank and cargo capris read as one palette.'
  const closing = '---\n\nA few quick notes:\n- Shoes: go with the sneakers.'

  const joined = joinAssistantNarration([looks], closing)
  assert.match(joined, /Earthy Trail Ease/, 'prose written beside a tool call survives')
  assert.match(joined, /A few quick notes/, 'and so does the closing message')
  assert.ok(joined.indexOf('Earthy Trail Ease') < joined.indexOf('A few quick notes'), 'in the order written')

  // The orphan rule is the visible symptom: with nothing above it, it is not a separator.
  assert.doesNotMatch(joinAssistantNarration([], closing), /^\s*---/)
  // With narration restored it IS a separator and stays.
  assert.match(joined, /---/)

  // A model that repeats itself in the closing message must not be printed twice.
  assert.equal(joinAssistantNarration(['Here are three looks.'], 'Here are three looks. Enjoy.'), 'Here are three looks. Enjoy.')
  assert.equal(joinAssistantNarration([], ''), '')
  assert.equal(joinAssistantNarration(['', null], 'only this'), 'only this')
})

// thread_1787728618995: the model narrated an intention beside a mid-turn tool call ("You're right
// — let me verify both before saying anything about them"), then ended its turn without ever
// writing the promised follow-up. The terminal, post-tool-result text came back empty, so the
// visible answer was just that leftover sentence — no description of the card the user could
// already see. Nothing in applyAcceptedCardAuthority catches this: it only strips bad paragraphs,
// and this one paragraph was never bad, just alone.
test('an empty terminal answer beside an accepted card falls back to the same safe closing line applyAcceptedCardAuthority uses', async () => {
  const { joinAssistantNarration } = await import('../styling-engine/provider.js')

  const danglingNarration = "You're right — let me verify both before saying anything about them."
  const joined = joinAssistantNarration([danglingNarration], '', { cardCount: 1 })
  assert.match(joined, /You're right/, 'the narration itself is not discarded')
  assert.match(joined, /Here is the look, with its pieces and styling notes on the card\./)

  const joinedTwo = joinAssistantNarration([danglingNarration], '', { cardCount: 2 })
  assert.match(joinedTwo, /Here are 2 looks, with their pieces and styling notes on each card\./)

  // No card accepted this turn: an empty terminal answer is left as-is, not papered over with a
  // card-shaped fallback line that would misdescribe a non-card turn.
  assert.equal(joinAssistantNarration([danglingNarration], '', { cardCount: 0 }), danglingNarration)
  assert.equal(joinAssistantNarration([danglingNarration], ''), danglingNarration, 'cardCount defaults to 0')

  // Real closing text always wins — the fallback only fires when the terminal text is genuinely empty.
  assert.equal(
    joinAssistantNarration([danglingNarration], 'Here it is, styled with the boots.', { cardCount: 1 }),
    `${danglingNarration}\n\nHere it is, styled with the boots.`
  )
})

// Capsule's ending, adopted for the turn contract (owner, 2026-08-17). Each clause gets one retry;
// after that it was suppressed and the answer returned unchanged and unremarked, so a guard that
// fired and did not get fixed left the person holding a flawed answer with no sign of it. Capsule
// ships `model_repaired_with_gaps` with the unmet thing stated — same here.
test('a clause that spent its retry and still fails ships with the gap stated', async () => {
  const { discloseUnresolvedFreeformChecks } = await import('../styling-engine/provider.js')

  // A card pairing a top with a dress whose prose never mentions the top — the cardProseInconsistent
  // clause. Pretend it already had its one retry.
  const toolContext = {
    generatedOutfits: [{
      label: 'Layered Look',
      reason: 'The navy cotton midi dress carries the column.',
      pieces: [
        { id: 1, name: 'ivory silk shell', category: 'top' },
        { id: 2, name: 'navy cotton midi dress', category: 'dress' },
        { id: 3, name: 'tan sandals', category: 'shoes' },
      ],
    }],
  }
  const answer = 'Here is a look for tonight.'
  const disclosed = discloseUnresolvedFreeformChecks(answer, toolContext, new Set(['cardProseInconsistent']))
  assert.match(disclosed, /Here is a look for tonight/, 'the answer is still delivered, not withheld')
  assert.match(disclosed, /treat the extra top as optional/i, 'and it says what is unresolved')

  // Not double-counted, and not appended twice.
  assert.equal(discloseUnresolvedFreeformChecks(disclosed, toolContext, new Set(['cardProseInconsistent'])), disclosed)

  // A clause that never fired gets no note; nor does a turn with nothing retried.
  assert.equal(discloseUnresolvedFreeformChecks(answer, toolContext, new Set()), answer)
  assert.equal(discloseUnresolvedFreeformChecks(answer, { generatedOutfits: [] }, new Set(['cardProseInconsistent'])), answer)

  // The disclosure pass must not re-record diagnostics — it is a re-run of the same predicates.
  const counted = { generatedOutfits: toolContext.generatedOutfits, freeformDiagnostics: { cardProseInconsistentBlocks: 0 } }
  discloseUnresolvedFreeformChecks(answer, counted, new Set(['cardProseInconsistent']))
  assert.equal(counted.freeformDiagnostics.cardProseInconsistentBlocks, 0, 'the recheck must not double-count the block')
})

// Review finding P1. narration accumulated across the whole loop, so a rejected answer's prose was
// prepended again after the model corrected itself — shipping the text that caused the rejection
// alongside its correction, with the clause that caught it already out of retry budget:
//   "Use piece #999."  /  "Correction: use verified piece #12 instead."
test('narration written before a retry does not survive the correction', async () => {
  const { supersedeNarrationOnRetry, joinAssistantNarration } = await import('../styling-engine/provider.js')

  const narration = []
  narration.push('**Look 1** — pairing it with piece #999.')   // written beside a tool call
  narration.push('**Look 2** — and the cream cardigan over it.')

  // A guard rejects the answer; the retry replaces it.
  supersedeNarrationOnRetry(narration)
  assert.deepEqual(narration, [], 'the superseded attempt is dropped, in place')

  // Narration written AFTER the correction still accumulates — this is a boundary, not a discard.
  narration.push('**Look 1** — pairing it with the verified piece #12.')
  const answer = joinAssistantNarration(narration, 'Here are the looks.')

  assert.doesNotMatch(answer, /#999/, 'the superseded reference must not reappear')
  assert.doesNotMatch(answer, /Look 2/, 'nor the prose from the rejected attempt')
  assert.match(answer, /#12/, 'the corrected narration survives')
  assert.match(answer, /Here are the looks/)

  // Idempotent and safe on junk.
  assert.deepEqual(supersedeNarrationOnRetry([]), [])
  assert.doesNotThrow(() => supersedeNarrationOnRetry(undefined))
})

// Review finding P2. applyFreeformOutputChecks short-circuits on the first failure by design, so
// disclosing from a single call surfaced at most one unresolved clause — and a newly-introduced
// failure that had NOT been retried would be returned first and mask a retried one behind it,
// shipping the reply with nothing said at all.
test('every unresolved clause is disclosed, and a new failure cannot mask a retried one', async () => {
  const { discloseUnresolvedFreeformChecks } = await import('../styling-engine/provider.js')

  // A card that layers a top with a dress and never explains it (cardProseInconsistent), in a turn
  // whose prose also cites an unverified piece id (unverifiedCitation). Both clauses fire.
  const toolContext = {
    zeroResultQueries: [],
    generatedOutfits: [{
      label: 'Layered Look',
      reason: 'The navy cotton midi dress carries the column.',
      pieces: [
        { id: 1, name: 'ivory silk shell', category: 'top' },
        { id: 2, name: 'navy cotton midi dress', category: 'dress' },
        { id: 3, name: 'tan sandals', category: 'shoes' },
      ],
    }],
  }
  const answer = 'Try the shell with it (ID 777).'

  // Both retried and still failing -> both disclosed.
  const both = discloseUnresolvedFreeformChecks(answer, toolContext, new Set(['cardProseInconsistent', 'unverifiedCitation']))
  assert.match(both, /treat the extra top as optional/i)
  assert.match(both, /not verified against your wardrobe/i)

  // Only one retried: the other is a live failure the loop may still correct, so it is not
  // disclosed — but it must not suppress the one that HAS spent its budget. This is the masking
  // case: unverifiedCitation is evaluated before cardProseInconsistent.
  const masked = discloseUnresolvedFreeformChecks(answer, toolContext, new Set(['cardProseInconsistent']))
  assert.match(masked, /treat the extra top as optional/i, 'a retried clause is disclosed even when an earlier clause also fails')
  assert.doesNotMatch(masked, /not verified against your wardrobe/i, 'a clause with retries left is not disclosed')

  // Counted once per note, and never appended twice.
  const counted = { ...toolContext, freeformDiagnostics: { unresolvedCheckDisclosures: 0 } }
  const first = discloseUnresolvedFreeformChecks(answer, counted, new Set(['cardProseInconsistent', 'unverifiedCitation']))
  assert.equal(counted.freeformDiagnostics.unresolvedCheckDisclosures, 2)
  assert.equal(discloseUnresolvedFreeformChecks(first, counted, new Set(['cardProseInconsistent', 'unverifiedCitation'])), first)
})
