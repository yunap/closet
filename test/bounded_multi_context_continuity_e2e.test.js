// docs/bounded-multi-context-continuity-spec.md §9 / §7 acceptance criteria. Live-shaped HTTP
// integration coverage across real, sequential /api/ai/ask turns against the real route handler
// and the real persisted stylist_conversation_state table — not a unit test of one function.
//
// Test-harness limitation, documented rather than hidden: askStylistWithTools's test-mode shortcut
// (styling-engine/provider.js) returns a canned final answer directly and never executes a real
// tool, so search_wardrobe/view_pieces never populate toolContext.retrievedPieceIds here. To still
// exercise the REAL recentlyDiscussedPieceIdsFromAnswer code path (cited ids intersected with
// verifiedPieceIdSets) rather than stubbing it out, these tests supply pieceIds in the request body
// — which routes/ai.js folds into toolContext.knownOutfitPieceIds, one of the two legitimate
// sources verifiedPieceIdSets already treats identically to a retrieved id (tools.js's `known` set).
// This exercises the real persistence/read/clear code faithfully; it does not (and cannot, without
// a live model) prove a real model chooses to call view_pieces on its own.
//
// Scenario 2 (unrelated pivot -> bounded_multi) turned out not to need a manual composer mock at
// all: with a minimal 2-piece wardrobe, generate_outfits reaches toolContext.atomicMultiLookCompleted
// through its own local/fallback path even under the generic catch-all mock text, so the test
// asserts directly on the real turn's debug.executionProfile and the real post-turn persisted state.
import test, { after, before, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'closet-bounded-multi-e2e-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { app, db, userUploadsDir } = await import('../server.js')
const { getStylistConversationState, saveStylistConversationState } = await import('../styling-engine/conversationState.js')

let server, baseUrl

before(async () => {
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise(resolve => server.close(resolve))
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

let topId, shoeId
const SESSION_ID = 'bounded-multi-continuity-e2e'

beforeEach(async () => {
  db.exec('DELETE FROM pieces; DELETE FROM stylist_conversation_state; DELETE FROM freeform_generation_runs;')
  if (!fs.existsSync(userUploadsDir())) fs.mkdirSync(userUploadsDir(), { recursive: true })
  const topPhoto = 'top.png'
  await sharp({ create: { width: 120, height: 160, channels: 3, background: '#222222' } }).png().toFile(path.join(userUploadsDir(), topPhoto))
  topId = insertPiece({ name: 'olive gold silk blouse', category: 'top', photo: topPhoto })
  shoeId = insertPiece({ name: 'black wedge heels', category: 'shoes', photo: topPhoto })
})

afterEach(() => {
  delete globalThis.__WARDROBE_AI_TEST_HANDLER__
})

function insertPiece({ name, category, photo, wornPhoto = null }) {
  return db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status,
      fit_confidence, role_permission, occasion_permissions, engine_notes, photo, worn_photo,
      pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category,
      fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES (@name, @category, '[]', '["city"]', 'year-round', '', 'active', 'trusted', 'high',
      'auto', '[]', '', @photo, @wornPhoto, 'solid', 'none', 'solid', '', '', '', '', '[]', 'everyday', '', '{}')
  `).run({ name, category, photo, wornPhoto }).lastInsertRowid
}

const ROUTER_MARKER = 'Classify one wardrobe-stylist request'
// thread_1789536455443 (2026-09-16): compactFreeformAnswerSystem's opening now leads with the
// shared STYLIST_COMPETENCE_CONTRACT (styling-engine/prompts.js); matching a substring from it
// rather than the old literal sentence, since the exact opening changed.
const COMPACT_MARKER = "You are a professional personal stylist with practical expertise in clothing comfort physiology"

function installMock({ routerProfile, fullStylistAnswer, compactAnswer }) {
  const routerCalls = []
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    const sys = String(system || '')
    if (sys.includes(ROUTER_MARKER)) {
      const latest = Array.isArray(messages) ? messages.at(-1) : null
      const text = Array.isArray(latest?.content)
        ? latest.content.map(p => p?.text || '').join('\n')
        : String(latest?.content || '')
      routerCalls.push(text)
      return {
        profile: routerProfile, occasion: 'city', activity: 'none', season: 'current season',
        mood: '', mission: 'mix', limit: routerProfile === 'bounded_multi' ? 2 : 0,
        location: '', date: '', subject: '',
        // askStylistStructuredWithUsage's test shortcut does normalizeAiUsage(testResponse?.usage
        // || null), and recordToolLoopUsage(toolContext, routed.usage) is called unconditionally —
        // an omitted/null usage crashes with "Cannot read properties of null (reading
        // 'inputTokens')", which silently falls back to full_stylist and defeats routerProfile.
        usage: {}
      }
    }
    // Same normalizeAiUsage(null) crash risk as above (recordToolLoopUsage(toolContext,
    // answerCall.usage) is unconditional) — but askStylistWithUsage's shortcut only fills `.usage`
    // when the mock response is a non-string object, which JSON-stringifies as the answer text
    // instead of returning it plainly. Not asserted on here, so that's an acceptable trade for a
    // non-crashing usage object.
    if (sys.startsWith(COMPACT_MARKER)) return { text: compactAnswer || 'A general styling answer.', usage: {} }
    return fullStylistAnswer || 'A friendly reply with no citations.'
  }
  return routerCalls
}

async function postJson(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json()
  assert.equal(response.status, 200, `${pathname} failed: ${JSON.stringify(json)}`)
  return json
}

// ── Scenario 1: direct continuation ─────────────────────────────────────────────────────────────
test('scenario 1 (continuation): a discovery answer\'s pieces persist, and the next turn\'s router hint reflects them', async () => {
  const routerCalls = installMock({
    routerProfile: 'full_stylist',
    fullStylistAnswer: `The olive-gold silk blouse (ID ${topId}) pairs well with the black wedge heels (ID ${shoeId}).`
  })

  await postJson('/api/ai/ask', {
    question: 'Do I have anything appropriate for a chilly work dinner tonight?',
    sessionId: SESSION_ID,
    conversationMode: 'new_request',
    pieceIds: [topId, shoeId], // stands in for verified-this-turn evidence — see file header
  })

  const afterTurnOne = getStylistConversationState(SESSION_ID)
  assert.deepEqual(afterTurnOne.recently_discussed_piece_ids?.piece_ids?.sort(), [topId, shoeId].sort(),
    'turn 1 must persist exactly the cited-and-verified pieces')

  await postJson('/api/ai/ask', {
    question: 'yes, put together three complete outfits',
    sessionId: SESSION_ID,
    conversationMode: 'new_request', // the exact mislabel the original incident produced
  })

  assert.equal(routerCalls.length, 2, 'the router must still run on turn 2 (never skipped by a hard veto)')
  assert.match(routerCalls[1], /previous answer discussed 2 specific verified wardrobe piece/,
    'turn 2\'s router call must truthfully state the prior turn discussed 2 pieces')
})

// ── Scenario 2: direct pivot ────────────────────────────────────────────────────────────────────
test('scenario 2 (pivot): bounded_multi stays reachable after a discovery turn, and its own writer clears the field', async () => {
  // A fresh, fully-specified top/bottom/shoes trio (real style_profile_json coverage/bareness,
  // fabric_weight, fiber_content), so the wardrobe has actual structural coverage this turn can
  // compose from — the shared beforeEach wardrobe (insertPiece's own style_profile_json is empty
  // `{}`) has nothing the coverage pipeline can place, which was bailing out to a
  // structureShortfall response BEFORE the composer was ever called; that response also has zero
  // aiReturnedCount, so it too (owner review, thread_1789546295700) now correctly reports as a
  // technical failure rather than fabricating "Successfully generated 0 outfits" — this test needs
  // the REAL composer path reached, not an unrelated coverage bailout, to test what it says it tests.
  const composableTopId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, fabric_weight, fiber_content, style_profile_json, formality)
    VALUES (?, 'top', 'active', ?, ?, ?, ?, ?, ?, 'everyday')
  `).run('grey cotton crewneck top', JSON.stringify(['grey']), 'top.png', 'quiet dark neutral top', 'light', '["cotton"]', '{"coverage":"normal","bareness":"normal"}').lastInsertRowid
  const bottomId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, fabric_weight, fiber_content, style_profile_json, formality)
    VALUES (?, 'bottom', 'active', ?, ?, ?, ?, ?, ?, 'everyday')
  `).run('black wide leg trousers', JSON.stringify(['black']), 'top.png', 'classic wide-leg trousers', 'medium', '["cotton"]', '{"coverage":"normal","bareness":"normal"}').lastInsertRowid
  const composableShoeId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, walk_support, heel_height, formality)
    VALUES (?, 'shoes', 'active', ?, ?, ?, ?, ?, 'everyday')
  `).run('black leather derby shoes', JSON.stringify(['black']), 'top.png', 'supportive leather derbies', 'medium', 'flat').lastInsertRowid
  installMock({
    routerProfile: 'full_stylist',
    fullStylistAnswer: `The olive-gold silk blouse (ID ${topId}) works for the dinner.`
  })
  await postJson('/api/ai/ask', {
    question: 'Do I have anything appropriate for a chilly work dinner tonight?',
    sessionId: SESSION_ID,
    conversationMode: 'new_request',
    pieceIds: [topId],
  })
  assert.ok(getStylistConversationState(SESSION_ID).recently_discussed_piece_ids?.piece_ids?.length,
    'precondition: turn 1 left discussed pieces persisted')

  // 2026-09-16 (owner review, thread_1789546295700): a plain string here used to reach
  // atomicMultiLookCompleted only by accident — askStylistStructuredWithUsage's test-mode shortcut
  // tried to JSON-parse the string as the composer's structured response, failed, and the resulting
  // composerError produced zero AI-returned outfits that local-fill then quietly filled in. That is
  // exactly the "provider returned nothing, reported as success" pattern generate_outfits no longer
  // allows (a zero-model-card result now returns status:"error", not success), so this turn needs a
  // genuine (if structurally incomplete — missing a bottom, which is fine for this test's purpose)
  // model-shaped response: aiReturnedCount only needs to be non-zero, not valid.
  const routerCalls = installMock({
    routerProfile: 'bounded_multi',
    fullStylistAnswer: {
      outfits: [{
        id: 'look_1', label: 'Trail Ready Layer', strength: 'strong',
        dominantDirection: 'utilitarian', silhouette: 'relaxed', bestFor: 'hiking',
        base_top_id: composableTopId, bottom_id: bottomId, dress_id: null,
        middle_layer_id: null, outer_layer_id: null, shoes_id: composableShoeId,
      }]
    }
  })
  const turnTwo = await postJson('/api/ai/ask', {
    question: 'Actually, give me three outfits for a walk downtown',
    sessionId: SESSION_ID,
    conversationMode: 'new_request',
  })
  assert.equal(routerCalls.length, 1, 'the router must run and be free to choose bounded_multi')
  assert.equal(turnTwo.debug?.executionProfile, 'bounded_multi',
    'the turn must actually take the bounded_multi path, not silently fall back to full_stylist')

  // bounded_multi's own writer (boundedConversationStateFromToolContext) never carries
  // recently_discussed_piece_ids forward — it builds the persisted state fresh from toolContext,
  // which does not know about this field, so a successful bounded_multi turn implicitly clears it.
  const afterBoundedMulti = getStylistConversationState(SESSION_ID)
  assert.equal(afterBoundedMulti.recently_discussed_piece_ids, undefined,
    'a successful bounded_multi write must not carry the prior discussion forward — it is a replacement, not a merge')
})

// ── Scenario 3: intervening non-piece turn ──────────────────────────────────────────────────────
test('scenario 3 (intervening non-piece turn): a compact general_advice turn clears the field, so the next hint is not stale/false', async () => {
  installMock({
    routerProfile: 'full_stylist',
    fullStylistAnswer: `The olive-gold silk blouse (ID ${topId}) pairs well with the black wedge heels (ID ${shoeId}).`
  })
  await postJson('/api/ai/ask', {
    question: 'Do I have anything appropriate for a chilly work dinner tonight?',
    sessionId: SESSION_ID,
    conversationMode: 'new_request',
    pieceIds: [topId, shoeId],
  })
  assert.equal(getStylistConversationState(SESSION_ID).recently_discussed_piece_ids?.piece_ids?.length, 2,
    'precondition: turn 1 left 2 discussed pieces persisted')

  installMock({
    routerProfile: 'general_advice',
    compactAnswer: 'Business casual means polished separates with tailored, not overly casual, pieces.'
  })
  await postJson('/api/ai/ask', {
    question: 'What exactly does business casual mean?',
    sessionId: SESSION_ID,
    conversationMode: 'new_request',
  })

  const afterCompactTurn = getStylistConversationState(SESSION_ID)
  assert.deepEqual(afterCompactTurn.recently_discussed_piece_ids, { piece_ids: [], turn_token: '' },
    'a wardrobe-independent compact turn must clear the field, not leave the work-dinner pieces standing')

  const routerCalls = installMock({ routerProfile: 'full_stylist', fullStylistAnswer: 'A fresh answer.' })
  await postJson('/api/ai/ask', {
    question: 'yes, put those together',
    sessionId: SESSION_ID,
    conversationMode: 'new_request',
  })
  assert.match(routerCalls[0], /no recently discussed wardrobe pieces/,
    'turn 3\'s router call must not claim the previous answer discussed pieces — the previous answer was the business-casual explanation, not the discovery turn')
})

// ── thread_1789536455443 (2026-09-16): production-path proof the outerwear's photo actually
// reaches existing_card_explanation, through the real HTTP route and the real image-allocation
// fix — not just a unit test of compactGarmentVisualEvidence in isolation.
test('PRODUCTION PATH: a weather-suitability question about a 4-piece card sends the outerwear\'s own photo, not just the first two pieces\'', async () => {
  const photoFile = name => `${name}.png`
  const makePhoto = async name => {
    await sharp({ create: { width: 60, height: 90, channels: 3, background: '#333333' } })
      .png()
      .toFile(path.join(userUploadsDir(), photoFile(name)))
  }
  for (const name of ['shirt', 'trousers', 'boots', 'trench']) await makePhoto(name)
  const shirtId = insertPiece({ name: 'navy cream striped button-up shirt', category: 'top', photo: photoFile('shirt'), wornPhoto: photoFile('shirt') })
  const trousersId = insertPiece({ name: 'black solid wide leg pants', category: 'bottom', photo: photoFile('trousers'), wornPhoto: photoFile('trousers') })
  const bootsId = insertPiece({ name: 'black leather ankle boots', category: 'shoes', photo: photoFile('boots'), wornPhoto: photoFile('boots') })
  const trenchId = insertPiece({ name: 'cream trench coat with belt', category: 'outerwear', photo: photoFile('trench'), wornPhoto: photoFile('trench') })

  saveStylistConversationState({
    current_outfit_set: [{
      index: 1, label: 'Outfit', occasion: 'city', activity: 'walking',
      reason: 'A polished, elevated city look that balances comfortable movement with weather-ready layers for a 50°F-to-40°F afternoon walk.',
      weather_used: '50°F high / 40°F low — you said so',
      piece_ids: [shirtId, trousersId, bootsId, trenchId],
      pieces: ['navy cream striped button-up shirt', 'black solid wide leg pants', 'black leather ankle boots', 'cream trench coat with belt'],
    }],
  }, SESSION_ID)

  const compactCalls = []
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    const sys = String(system || '')
    if (sys.includes(ROUTER_MARKER)) {
      return {
        profile: 'existing_card_explanation', occasion: 'city', activity: 'walking', season: 'fall',
        mood: '', mission: 'mix', limit: 0, location: '', date: '', subject: '', usage: {},
      }
    }
    if (sys.startsWith(COMPACT_MARKER)) {
      compactCalls.push({ system: sys, messages })
      return { text: 'This system works to about 55°F, not for a 50-to-40°F outdoor walk.', usage: {} }
    }
    return 'unexpected call'
  }

  await postJson('/api/ai/ask', {
    question: 'what weather does the outfit work for?',
    sessionId: SESSION_ID,
    conversationMode: 'followup',
  })

  assert.equal(compactCalls.length, 1, 'exactly one compact existing_card_explanation call was made')
  const content = compactCalls[0].messages[0].content
  assert.ok(Array.isArray(content), 'photos are attached, so content is a parts array, not a bare string')
  const imageLabels = content.filter(part => part.type === 'text' && /^Saved .* photo for/.test(part.text)).map(part => part.text)
  // The whole point of the fix: the trench (the piece a weather-suitability question is actually
  // about) has visual evidence, not just whichever pieces happened to be listed first.
  assert.ok(imageLabels.some(label => label.includes('cream trench coat with belt')),
    `the outerwear's own photo must reach the model: ${JSON.stringify(imageLabels)}`)
  // And it is not the ONLY one starved — every piece in the 4-piece outfit gets at least one image
  // within the 4-image budget (one pass-1 image each, exactly filling the bound).
  for (const name of ['navy cream striped button-up shirt', 'black solid wide leg pants', 'black leather ankle boots', 'cream trench coat with belt']) {
    assert.ok(imageLabels.some(label => label.includes(name)), `${name} has no visual evidence: ${JSON.stringify(imageLabels)}`)
  }
  // 2026-09-16 (owner review, second pass): the card projection is sanitized UNCONDITIONALLY now —
  // no local keyword classifier decides this per-question — so the stored reason and weatherUsed
  // must be absent from the production payload on this ordinary weather-worded question too.
  const questionBlock = content.find(part => part.type === 'text' && part.text.startsWith('Question:'))
  assert.ok(questionBlock, 'the text block carrying the question and card JSON must be present')
  assert.doesNotMatch(questionBlock.text, /weather-ready layers for a 50°F-to-40°F afternoon walk/,
    'the stored reason must never reach the model through this profile')
  assert.doesNotMatch(questionBlock.text, /50°F high \/ 40°F low/, 'weather_used must never reach the model through this profile')
})

// ── thread_1789536455443 (2026-09-16, owner review, second pass): the previous fix still hard-
// capped the image budget at 4, so a valid 5-piece card (base + middle layer + outer layer, the
// outfit role invariant's own maximum) could still lose a garment — typically whichever of the two
// layers sorted last. This proves the real structural ceiling, not an arbitrary observed one.
test('PRODUCTION PATH: a 5-piece card (base, middle layer, outer layer) sends a photo for every garment, including both layers', async () => {
  const photoFile = name => `${name}.png`
  const makePhoto = async name => {
    await sharp({ create: { width: 60, height: 90, channels: 3, background: '#333333' } })
      .png()
      .toFile(path.join(userUploadsDir(), photoFile(name)))
  }
  for (const name of ['top', 'bottom', 'shoes', 'cardigan', 'coat']) await makePhoto(name)
  const topId = insertPiece({ name: 'ivory ribbed knit top', category: 'top', photo: photoFile('top'), wornPhoto: photoFile('top') })
  const bottomId = insertPiece({ name: 'charcoal wool trousers', category: 'bottom', photo: photoFile('bottom'), wornPhoto: photoFile('bottom') })
  const shoesId = insertPiece({ name: 'black leather chelsea boots', category: 'shoes', photo: photoFile('shoes'), wornPhoto: photoFile('shoes') })
  const cardiganId = insertPiece({ name: 'camel wool cardigan', category: 'outerwear', photo: photoFile('cardigan'), wornPhoto: photoFile('cardigan') })
  const coatId = insertPiece({ name: 'navy wool overcoat', category: 'outerwear', photo: photoFile('coat'), wornPhoto: photoFile('coat') })

  saveStylistConversationState({
    current_outfit_set: [{
      index: 1, label: 'Layered Outfit', occasion: 'city', activity: 'walking',
      reason: 'A layered cold-weather system with a cardigan under a wool overcoat.',
      weather_used: '38°F high / 28°F low — you said so',
      piece_ids: [topId, bottomId, shoesId, cardiganId, coatId],
      pieces: ['ivory ribbed knit top', 'charcoal wool trousers', 'black leather chelsea boots', 'camel wool cardigan', 'navy wool overcoat'],
    }],
  }, SESSION_ID)

  const compactCalls = []
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    const sys = String(system || '')
    if (sys.includes(ROUTER_MARKER)) {
      return {
        profile: 'existing_card_explanation', occasion: 'city', activity: 'walking', season: 'winter',
        mood: '', mission: 'mix', limit: 0, location: '', date: '', subject: '', usage: {},
      }
    }
    if (sys.startsWith(COMPACT_MARKER)) {
      compactCalls.push({ system: sys, messages })
      return { text: 'This layered system reads adequate down to about 30°F.', usage: {} }
    }
    return 'unexpected call'
  }

  await postJson('/api/ai/ask', {
    question: 'is this warm enough for a cold walk?',
    sessionId: SESSION_ID,
    conversationMode: 'followup',
  })

  assert.equal(compactCalls.length, 1, 'exactly one compact existing_card_explanation call was made')
  const content = compactCalls[0].messages[0].content
  assert.ok(Array.isArray(content), 'photos are attached, so content is a parts array, not a bare string')
  const imageLabels = content.filter(part => part.type === 'text' && /^Saved .* photo for/.test(part.text)).map(part => part.text)
  // Every one of the five structurally-valid pieces gets at least one image — most importantly
  // both outerwear layers, the ones a previous 4-image ceiling would have to choose between.
  for (const name of ['ivory ribbed knit top', 'charcoal wool trousers', 'black leather chelsea boots', 'camel wool cardigan', 'navy wool overcoat']) {
    assert.ok(imageLabels.some(label => label.includes(name)), `${name} has no visual evidence: ${JSON.stringify(imageLabels)}`)
  }
  assert.equal(imageLabels.length, 5, 'pass one exactly fills the five-piece structural budget with one image per garment')
})

// ── thread_1789543565383 / owner review (2026-09-16, continuation-preservation correction) ────────
// Three-turn production-path proof: (1) an outfit exists for a stated 50°F->40°F, 1-6pm, walking
// outing; (2) an existing_card_explanation follow-up must not erase established state — it may only
// touch recently_discussed_piece_ids; (3) "give me three more outfits for the same outing" must
// leave existing_card_explanation, reach the real composer, and carry the SAME temperature range
// forward even though turn 3's own text never restates it.
//
// Test-harness note (same limitation the file header documents): turn 3 uses conversationMode
// 'new_request' so the router's bounded_multi shortcut (routes/ai.js) actually executes
// generate_outfits through its real local/fallback path, per scenario 2 above — the alternative,
// conversationMode 'followup', falls through to askStylistWithTools's test-mode shortcut, which
// returns a canned answer and never executes a real tool at all, so it could not prove anything
// about weather continuity into a real composition call.
test('PRODUCTION PATH: an existing_card_explanation turn preserves established state untouched, and "three more for the same outing" reaches the composer with the same temperature range', async () => {
  const shirtId = insertPiece({ name: 'black turtleneck', category: 'top', photo: 'top.png' })
  const trousersId = insertPiece({ name: 'black wide leg trousers', category: 'bottom', photo: 'top.png' })
  const trenchId = insertPiece({ name: 'cream trench coat with belt', category: 'outerwear', photo: 'top.png' })
  // A fully-specified top/bottom/shoes trio (real style_profile_json coverage/bareness,
  // fabric_weight, fiber_content) so turn 3's composer call has actual structural coverage to
  // resolve from — insertPiece's own style_profile_json is empty `{}` and this wardrobe has no
  // shoes at all, either of which would bail out to a structureShortfall response BEFORE the
  // composer is ever called, which (owner review, thread_1789546295700) is now correctly reported
  // as a technical failure rather than "Successfully generated 0 outfits" — this test needs the
  // real composer call to actually resolve weather, not an unrelated coverage bailout.
  const composableTopId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, fabric_weight, fiber_content, style_profile_json, formality)
    VALUES (?, 'top', 'active', ?, ?, ?, ?, ?, ?, 'everyday')
  `).run('grey cotton crewneck top', JSON.stringify(['grey']), 'top.png', 'quiet dark neutral top', 'light', '["cotton"]', '{"coverage":"normal","bareness":"normal"}').lastInsertRowid
  const composableBottomId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, fabric_weight, fiber_content, style_profile_json, formality)
    VALUES (?, 'bottom', 'active', ?, ?, ?, ?, ?, ?, 'everyday')
  `).run('black straight trousers', JSON.stringify(['black']), 'top.png', 'classic black trousers', 'medium', '["cotton"]', '{"coverage":"normal","bareness":"normal"}').lastInsertRowid
  const composableShoeId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, walk_support, heel_height, formality)
    VALUES (?, 'shoes', 'active', ?, ?, ?, ?, ?, 'everyday')
  `).run('black leather derby shoes', JSON.stringify(['black']), 'top.png', 'supportive leather derbies', 'medium', 'flat').lastInsertRowid

  const turn1Request = "I'll be walking around the city outdoors from 1-6 p.m. It will be about 50°F when I start and around 40°F by the time I return. I want a polished, slightly elevated look."
  const turn1Reply = 'A sleek black turtleneck under a cream trench coat gives clean lines and wind protection for the walk from 50°F down to 40°F.'

  const seededState = {
    established: { occasion: 'city', activity: 'walking', mood: 'polished', mission: 'mix', season: 'fall' },
    weather_profile: { source: 'stated', high_f: 50, low_f: 40, is_hot: false, is_cold: false, is_extreme_heat: false },
    current_outfit_set: [{
      index: 1, label: 'Polished Urban Walk at 50° to 40°F', occasion: 'city', activity: 'walking',
      reason: turn1Reply,
      weather_used: '50°F high / 40°F low — you said so',
      piece_ids: [shirtId, trenchId],
      pieces: ['black turtleneck', 'cream trench coat with belt'],
    }],
  }
  saveStylistConversationState(seededState, SESSION_ID)
  const beforeTurn2 = getStylistConversationState(SESSION_ID)

  // Turn 2: an ordinary follow-up question about the existing card.
  installMock({
    routerProfile: 'existing_card_explanation',
    compactAnswer: 'This system reads adequate down to about 45°F, not quite the full 50-to-40°F range.'
  })
  await postJson('/api/ai/ask', {
    question: 'What temperature range does this actually suit?',
    sessionId: SESSION_ID,
    conversationMode: 'followup',
    history: [
      { role: 'user', content: turn1Request },
      { role: 'assistant', content: turn1Reply },
    ],
  })

  const afterTurn2 = getStylistConversationState(SESSION_ID)
  assert.deepEqual(afterTurn2.established, beforeTurn2.established,
    'an explanation turn must not touch established occasion/activity/mood/season')
  assert.deepEqual(afterTurn2.weather_profile, beforeTurn2.weather_profile,
    'an explanation turn must not touch the persisted temperature range')
  assert.deepEqual(afterTurn2.current_outfit_set, beforeTurn2.current_outfit_set,
    'an explanation turn must not touch the persisted current outfit set')
  assert.deepEqual(afterTurn2.recently_discussed_piece_ids, { piece_ids: [], turn_token: '' },
    'the only field an existing_card_explanation turn may change is recently_discussed_piece_ids')

  // Turn 3: "three more for the same outing" — must leave existing_card_explanation and reach the
  // composer, carrying the same 50/40°F range forward into the REAL generate_outfits tool call even
  // though this turn's own words never restate it. Tool-call args are logged in production
  // (styling-engine/tools.js's executeTool) before the nested composer's own model call runs, so
  // spying on that log line proves the exact args the tool received — independent of whether this
  // test's deliberately minimal wardrobe can also satisfy full card validation downstream (it need
  // not: scenario 2 above accepts the same "reached the tool, may not produce a card" bound, since
  // the nested composer's own provider call is not meaningfully mockable through this harness's
  // generic text handler).
  const toolCallLogs = []
  const originalConsoleLog = console.log
  console.log = (...args) => {
    const line = args.join(' ')
    if (line.includes('[Agent Tool Call] generate_outfits')) toolCallLogs.push(line)
    originalConsoleLog(...args)
  }
  const routerCalls = installMock({
    routerProfile: 'bounded_multi',
    fullStylistAnswer: {
      outfits: [{
        id: 'look_1', label: 'City Walk Layer', strength: 'strong',
        dominantDirection: 'polished', silhouette: 'column', bestFor: 'city walk',
        base_top_id: composableTopId, bottom_id: composableBottomId, dress_id: null,
        middle_layer_id: null, outer_layer_id: null, shoes_id: composableShoeId,
      }]
    }
  })
  let turn3
  try {
    turn3 = await postJson('/api/ai/ask', {
      question: 'Give me three more outfits for the same outing',
      sessionId: SESSION_ID,
      conversationMode: 'new_request',
      history: [
        { role: 'user', content: turn1Request },
        { role: 'assistant', content: turn1Reply },
        { role: 'user', content: 'What temperature range does this actually suit?' },
        { role: 'assistant', content: 'This system reads adequate down to about 45°F, not quite the full 50-to-40°F range.' },
      ],
    })
  } finally {
    console.log = originalConsoleLog
  }
  assert.equal(routerCalls.length, 1, 'the router must run for turn 3')
  assert.equal(turn3.debug?.executionProfile, 'bounded_multi',
    'turn 3 must leave existing_card_explanation and reach the multi-outfit composer')
  assert.equal(toolCallLogs.length, 1, 'generate_outfits must actually run')
  // 2026-09-16 (owner review, second pass): only the literal fields extractStructuredUserWeather/the
  // persisted weather_profile actually carry are passed through — no `scope` or any other field is
  // manufactured for either source.
  assert.match(toolCallLogs[0], /"user_weather":\{"high_f":50,"low_f":40\}/,
    'the real tool call must carry the established 50/40°F range forward, not silently drop it because turn 3 never restated it')

  const afterTurn3 = getStylistConversationState(SESSION_ID)
  assert.equal(afterTurn3.weather_profile?.high_f, 50,
    'the composer resolved and persisted the same 50°F endpoint, confirming the carried-forward arg actually won weather resolution')
  assert.equal(afterTurn3.weather_profile?.low_f, 40,
    'the composer resolved and persisted the same 40°F endpoint, confirming the carried-forward arg actually won weather resolution')
})

// ── thread_1789546295700 (2026-09-16, owner review): the bounded_multi shortcut's first
// generate_outfits attempt carried no weather at all, was rejected (weather_context_required), and
// only succeeded after a second, model-issued call restated a temperature the user had already
// given. Confirmed via /tmp/wardrobe-dev-unified.log, not a captured provider call — the rejected
// attempt is the application's OWN shortcut call, made before any model turn. These four tests prove
// the fix directly against the real shortcut: extractStructuredUserWeather(currentQuestion) is
// consulted first; the persisted weather_profile is a continuation fallback only, used exclusively
// when the current turn states nothing; and a fresh turn with nothing stated and nothing persisted
// sends no user_weather at all rather than manufacturing one.
function captureGenerateOutfitsArgs(fn) {
  const calls = []
  const originalConsoleLog = console.log
  console.log = (...args) => {
    const line = args.join(' ')
    const match = line.match(/\[Agent Tool Call\] generate_outfits \((\{.*\})\)/)
    if (match) { try { calls.push(JSON.parse(match[1])) } catch {} }
    originalConsoleLog(...args)
  }
  return fn().finally(() => { console.log = originalConsoleLog }).then(result => ({ result, calls }))
}

test('PRODUCTION PATH: fresh stated weather reaches the shortcut\'s generate_outfits call directly', async () => {
  installMock({ routerProfile: 'bounded_multi', fullStylistAnswer: 'unused' })
  const { calls } = await captureGenerateOutfitsArgs(() => postJson('/api/ai/ask', {
    question: 'Give me three outfits for a city walk, about 78°F when I start and 59°F by evening.',
    sessionId: SESSION_ID,
    conversationMode: 'new_request',
  }))
  assert.equal(calls.length, 1, 'exactly one generate_outfits call must fire')
  assert.deepEqual(calls[0].user_weather, { high_f: 78, low_f: 59 },
    `the shortcut must pass the current turn's own stated weather: ${JSON.stringify(calls[0])}`)
})

test('PRODUCTION PATH: continuation weather falls back to the persisted range only when nothing is stated this turn', async () => {
  saveStylistConversationState({
    established: { occasion: 'city', activity: 'walking' },
    weather_profile: { source: 'stated', high_f: 78, low_f: 59, is_hot: false, is_cold: false, is_extreme_heat: false },
    current_outfit_set: [{ index: 1, label: 'Existing Look', piece_ids: [topId, shoeId], pieces: ['olive gold silk blouse', 'black wedge heels'] }],
  }, SESSION_ID)
  installMock({ routerProfile: 'bounded_multi', fullStylistAnswer: 'unused' })
  const { calls } = await captureGenerateOutfitsArgs(() => postJson('/api/ai/ask', {
    question: 'Give me three more outfits for the same outing',
    sessionId: SESSION_ID,
    conversationMode: 'new_request',
    history: [
      { role: 'user', content: "I'll be walking around the city, about 78°F when I start and 59°F by evening." },
      { role: 'assistant', content: 'A polished city look.' },
    ],
  }))
  assert.equal(calls.length, 1, 'exactly one generate_outfits call must fire')
  assert.deepEqual(calls[0].user_weather, { high_f: 78, low_f: 59 },
    `the shortcut must fall back to the persisted range when this turn states nothing new: ${JSON.stringify(calls[0])}`)
})

test('PRODUCTION PATH: a fresh weather pivot this turn wins over a stale persisted range', async () => {
  saveStylistConversationState({
    established: { occasion: 'city', activity: 'walking' },
    weather_profile: { source: 'stated', high_f: 78, low_f: 59, is_hot: false, is_cold: false, is_extreme_heat: false },
    current_outfit_set: [{ index: 1, label: 'Existing Look', piece_ids: [topId, shoeId], pieces: ['olive gold silk blouse', 'black wedge heels'] }],
  }, SESSION_ID)
  installMock({ routerProfile: 'bounded_multi', fullStylistAnswer: 'unused' })
  const { calls } = await captureGenerateOutfitsArgs(() => postJson('/api/ai/ask', {
    question: 'Actually, the forecast changed — give me three outfits for 50°F down to 35°F instead.',
    sessionId: SESSION_ID,
    conversationMode: 'new_request',
    history: [
      { role: 'user', content: "I'll be walking around the city, about 78°F when I start and 59°F by evening." },
      { role: 'assistant', content: 'A polished city look.' },
    ],
  }))
  assert.equal(calls.length, 1, 'exactly one generate_outfits call must fire')
  assert.deepEqual(calls[0].user_weather, { high_f: 50, low_f: 35 },
    `the current turn's own restated weather must win over the stale persisted 78/59 range: ${JSON.stringify(calls[0])}`)
})

test('PRODUCTION PATH: a fresh turn with no stated weather and nothing persisted sends no user_weather at all', async () => {
  installMock({ routerProfile: 'bounded_multi', fullStylistAnswer: 'unused' })
  const { calls } = await captureGenerateOutfitsArgs(() => postJson('/api/ai/ask', {
    question: 'Give me three outfits for a walk downtown.',
    sessionId: SESSION_ID,
    conversationMode: 'new_request',
  }))
  assert.equal(calls.length, 1, 'exactly one generate_outfits call must fire')
  assert.ok(!('user_weather' in calls[0]), `no user_weather must be manufactured when nothing is stated or persisted: ${JSON.stringify(calls[0])}`)
})
