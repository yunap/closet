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
const { executeTool, bumpFreeformDiagnostic, looksLikeTimezoneIdentifier, resolveStatedOrLiveWeather, recordNestedFreeformUsage, declareBoundedMultiLookIntent, STYLIST_TOOLS } = await import('../styling-engine/tools.js')
const { persistFreeformGenerationRun, resolveWholeWardrobeWeatherProfile, resolveDirectVisualComposerWeather, boundedConversationStateFromToolContext, composerPieceLineSuffix, compactFreeformAnswerSystem, compactFreeformPieceFacts, compactFreeformContext, compactProfileHasContext, compactFreeformAnswerMessage, compactGarmentVisualEvidence, formatWardrobeInventoryAnswer, exactNamedPieceIdsFromQuestion, isSavedPhotoWearMechanicsQuestion, compactRouterTurnHasContext } = await import('../routes/ai.js')
const { findZeroResultContradiction, looksLikeUnproposedOutfitProse, looksLikeDestinationOrWeatherQuestion, extractPieceIdsFromProse, looksLikeOutfitRequest, extractRequestedOutfitCount, applyFreeformOutputChecks, boundedCapsuleFinalAnswer, boundedAtomicMultiLookFinalAnswer, boundedAtomicMultiLookResponse, freeformToolLoopFallbackAnswer, recordToolLoopUsage, stylistToolsForTurn, routeFreeformExecutionProfile } = await import('../styling-engine/provider.js')

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
    // docs/card-consistency-spec.md Part 1 — cards whose prose did not account for a top worn with
    // a dress, sent back for one correction round.
    cardProseInconsistentBlocks: 0,
    atomicMultiLookCalls: 0,
    executionRouterCalls: 0,
    // Capsule's ending: a clause that spent its retry and is still failing ships with a note.
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
    // Which tools ran in which iteration — the shape of a turn, not just its size.
    toolSequence: '',
    providerIterations: 0,
    providerInputTokens: 0,
    providerOutputTokens: 0,
    providerCacheReadInputTokens: 0,
    providerCacheCreationInputTokens: 0,
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
  const base = freeformToolRoutingInstruction(false)
  const bounded = freeformToolRoutingInstruction(true)
  assert.match(base, /each tool description owns its eligibility, required arguments, and mechanical output contract/)
  assert.doesNotMatch(base, /want:"text"|outfit_index|piece_ids/)
  assert.match(bounded, /fresh 2–5 option requests/)
  assert.match(bounded, /One\/best requests stay on the verified serial path/)
  assert.match(bounded, /multi-context schedules and capsules use plan_outfit_set/)
  assert.match(bounded, /existing-card revisions use suggest_slot_swaps/)

  const tool = name => STYLIST_TOOLS.find(candidate => candidate.name === name)
  assert.match(tool('declare_intent').description, /Call it first each turn/)
  assert.match(tool('suggest_slot_swaps').description, /alternatives to ONE slot/)
  assert.match(tool('render_preview').description, /card produced this turn by index, or explicit piece_ids/)
  assert.match(tool('generate_outfits').description, /ordinary new 'what should I wear\?' request defaults to 2 options/)
  assert.match(tool('plan_outfit_set').description, /multiple use-case slots/)
  assert.ok(bounded.length < 800, 'the cross-tool controller stays smaller than the schemas it references')
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
    assert.match(payload.system, /BOUNDED MULTI-LOOK CROSS-TOOL BOUNDARY:/)
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
        contextSummary: entry.context
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

test('live numeric weather owns hard gates even when the execution router supplies summer', () => {
  const live = {
    isHot: false,
    isCold: false,
    highF: 78,
    lowF: 56,
    weatherSource: 'live'
  }
  assert.deepEqual(resolveWholeWardrobeWeatherProfile({
    mood: 'relaxed',
    stylingRequest: 'outdoor farmers market',
    season: 'summer; mild weather; forecast high 78°F, low 56°F',
    resolvedWeatherProfile: live
  }), live)

  assert.equal(resolveWholeWardrobeWeatherProfile({
    season: 'summer; mild weather; forecast high 78°F, low 56°F'
  }).isHot, true, 'without a resolved live profile the existing text fallback remains unchanged')
})

test('unavailable named-place weather remains neutral through whole-wardrobe composition', () => {
  const unavailable = {
    isHot: false,
    isCold: false,
    isRainy: false,
    isWetExposure: false,
    weatherSource: 'unavailable',
    weatherFailure: 'weather_request_failed'
  }
  assert.deepEqual(resolveWholeWardrobeWeatherProfile({
    season: 'summer; hot weather',
    resolvedWeatherProfile: unavailable
  }), unavailable)
})

test('direct Visual Composer resolves live weather only for Current season', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.includes('geocoding-api')) {
      return { ok: true, json: async () => ({ results: [{ latitude: 37.9, longitude: -122.1 }] }) }
    }
    return { ok: true, json: async () => ({ daily: { temperature_2m_max: [69], temperature_2m_min: [55] } }) }
  }

  const current = await resolveDirectVisualComposerWeather({
    season: 'current season',
    location: 'Walnut Creek, CA',
    date: '2026-08-19',
    fetchImpl
  })
  assert.deepEqual(current, {
    isHot: false,
    isCold: false,
    highF: 69,
    lowF: 55,
    weatherSource: 'live'
  })
  assert.equal(calls.length, 2)

  const hypothetical = await resolveDirectVisualComposerWeather({
    season: 'winter',
    location: 'Walnut Creek, CA',
    date: '2026-08-19',
    fetchImpl
  })
  assert.equal(hypothetical, null)
  assert.equal(calls.length, 2, 'an explicit seasonal brief must not fetch or be overridden by today\'s weather')
})

test('direct Visual Composer endpoint wires saved location weather into whole-wardrobe composition', () => {
  const routeSrc = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  const routeStart = routeSrc.indexOf("router.post('/generate-wardrobe-outfits-visual'")
  const routeEnd = routeSrc.indexOf('// ── AI Visual Rendering & Boards', routeStart)
  const routeBlock = routeSrc.slice(routeStart, routeEnd)
  assert.match(routeBlock, /location: input\.location \|\| getHomeLocation\(\)/)
  assert.match(routeBlock, /generateWholeWardrobeOutfitsVisualInternal\(\{ \.\.\.input, resolvedWeatherProfile \}\)/)
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
