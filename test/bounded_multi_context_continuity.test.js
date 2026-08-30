// docs/bounded-multi-context-continuity-spec.md. Unit coverage for the two new pieces of logic:
// which piece IDs get persisted as "recently discussed" (§5.1/§4), and how buildStylistConversationPayload
// surfaces them to the next turn regardless of the client's (possibly wrong) conversationMode label
// (§5.2 — the read must not be gated the same way current_outfit_set restoration is, since a
// misclassified 'new_request' turn is exactly the incident this spec exists to fix).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'closet-bounded-multi-continuity-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { db } = await import('../db.js')
const { recentlyDiscussedPieceIdsFromAnswer, clearRecentlyDiscussedPieceIds } = await import('../routes/ai.js')
const { saveStylistConversationState, getStylistConversationState } = await import('../styling-engine/conversationState.js')
const { buildStylistConversationPayload } = await import('../styling-engine/core.js')

test.after(() => {
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

test('recentlyDiscussedPieceIdsFromAnswer keeps only cited-and-verified pieces, not every retrieved candidate', () => {
  const toolContext = {
    retrievedPieceIds: new Set([10, 11, 12, 13, 14]), // a search returned 5 candidates
    visuallySeenPieceIds: new Set(),
    generatedOutfits: []
  }
  // The answer's prose only actually names two of them, plus an ID the search never retrieved at all.
  const answer = 'The olive blouse (ID 10) pairs well with the black trouser (ID 11). ID 999 is not real.'
  const result = recentlyDiscussedPieceIdsFromAnswer(answer, toolContext)
  assert.deepEqual(result, [10, 11], 'only cited ids that were also verified this turn should survive')
})

test('recentlyDiscussedPieceIdsFromAnswer also honours known (card) pieces, not just retrieved', () => {
  const toolContext = {
    retrievedPieceIds: new Set(),
    visuallySeenPieceIds: new Set(),
    generatedOutfits: [{ pieceIds: [42] }]
  }
  const answer = 'Piece ID 42 anchors the look.'
  assert.deepEqual(recentlyDiscussedPieceIdsFromAnswer(answer, toolContext), [42])
})

test('recentlyDiscussedPieceIdsFromAnswer respects its cap', () => {
  const ids = Array.from({ length: 20 }, (_, i) => i + 1)
  const toolContext = { retrievedPieceIds: new Set(ids), visuallySeenPieceIds: new Set(), generatedOutfits: [] }
  const answer = ids.map(id => `ID ${id}`).join(', ')
  const result = recentlyDiscussedPieceIdsFromAnswer(answer, toolContext, { cap: 5 })
  assert.equal(result.length, 5)
})

test('recentlyDiscussedPieceIdsFromAnswer returns empty for an answer that cites nothing', () => {
  const toolContext = { retrievedPieceIds: new Set([1, 2]), visuallySeenPieceIds: new Set(), generatedOutfits: [] }
  assert.deepEqual(recentlyDiscussedPieceIdsFromAnswer('A friendly clarifying question with no garments named.', toolContext), [])
})

test('buildStylistConversationPayload surfaces recently_discussed_pieces even when conversationMode is new_request', async () => {
  saveStylistConversationState({
    established: { occasion: 'work dinner' },
    recently_discussed_piece_ids: { piece_ids: [501, 502], turn_token: 'prior-turn' }
  }, 'continuity-new-request')

  const payload = await buildStylistConversationPayload({
    question: 'yes, put together three complete outfits',
    sessionId: 'continuity-new-request',
    conversationMode: 'new_request', // the exact (mis)classification the incident produced
    currentDate: '2026-08-29',
    history: []
  })

  assert.deepEqual(payload.threadState.recently_discussed_pieces, { piece_ids: [501, 502] },
    'the continuation-context block must reach threadState regardless of the client-supplied conversationMode label')
  assert.match(payload.system, /RECENTLY DISCUSSED PIECES/,
    'the prompt must instruct the model to view_pieces before using them')
  assert.match(payload.system, /view_pieces/i)
})

test('buildStylistConversationPayload still does not restore established/current_outfit_set on a new_request turn (regression guard)', async () => {
  saveStylistConversationState({
    established: { occasion: 'a stale earlier occasion that must not leak' },
    current_outfit_set: [{ index: 1, label: 'Stale Look', piece_ids: [1] }],
    recently_discussed_piece_ids: { piece_ids: [777], turn_token: 'prior-turn' }
  }, 'continuity-regression-guard')

  const payload = await buildStylistConversationPayload({
    question: 'Something entirely new',
    sessionId: 'continuity-regression-guard',
    conversationMode: 'new_request',
    currentDate: '2026-08-29',
    history: []
  })

  assert.equal(payload.threadState.current_outfit_set, undefined,
    'a new_request turn must not inherit a stale current_outfit_set just because recently_discussed_piece_ids is now read unconditionally')
  assert.ok(!String(payload.system).includes('a stale earlier occasion that must not leak'),
    'established context restoration must stay gated on conversationMode exactly as before this change')
  // The new field is unaffected by that same gate — it has its own, deliberately ungated read.
  assert.deepEqual(payload.threadState.recently_discussed_pieces, { piece_ids: [777] })
})

test('buildStylistConversationPayload omits the continuation-context block when nothing was recently discussed', async () => {
  const payload = await buildStylistConversationPayload({
    question: 'What should I wear today?',
    sessionId: 'continuity-empty',
    conversationMode: 'new_request',
    currentDate: '2026-08-29',
    history: []
  })
  assert.equal(payload.threadState.recently_discussed_pieces, undefined)
  assert.ok(!String(payload.system).includes('RECENTLY DISCUSSED PIECES'))
})

test('clearRecentlyDiscussedPieceIds empties the field without touching other persisted state (Option A: last-assistant-turn continuity)', () => {
  saveStylistConversationState({
    established: { occasion: 'work dinner' },
    current_outfit_set: [{ index: 1, label: 'Keep Me', piece_ids: [1] }],
    recently_discussed_piece_ids: { piece_ids: [501, 502], turn_token: 'discovery-turn' }
  }, 'continuity-clear')

  clearRecentlyDiscussedPieceIds('continuity-clear')

  const state = getStylistConversationState('continuity-clear')
  assert.deepEqual(state.recently_discussed_piece_ids, { piece_ids: [], turn_token: '' })
  assert.deepEqual(state.established, { occasion: 'work dinner' },
    'clearing the piece-continuity field must not disturb established/current_outfit_set')
  assert.deepEqual(state.current_outfit_set, [{ index: 1, label: 'Keep Me', piece_ids: [1] }])
})
