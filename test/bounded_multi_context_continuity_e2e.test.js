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
const { getStylistConversationState } = await import('../styling-engine/conversationState.js')

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

function insertPiece({ name, category, photo }) {
  return db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, recommendation_status,
      fit_confidence, role_permission, occasion_permissions, engine_notes, photo, worn_photo,
      pattern_type, pattern_scale, pattern_complexity, reads_as, silhouette, fabric_category,
      fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES (@name, @category, '[]', '["city"]', 'year-round', '', 'active', 'trusted', 'high',
      'auto', '[]', '', @photo, NULL, 'solid', 'none', 'solid', '', '', '', '', '[]', 'everyday', '', '{}')
  `).run({ name, category, photo }).lastInsertRowid
}

const ROUTER_MARKER = 'Classify one wardrobe-stylist request'
const COMPACT_MARKER = 'You are a concise personal stylist answering one bounded text question.'

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

  const routerCalls = installMock({ routerProfile: 'bounded_multi', fullStylistAnswer: 'unused' })
  const turnTwo = await postJson('/api/ai/ask', {
    question: 'Actually, give me three hiking outfits tomorrow',
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
