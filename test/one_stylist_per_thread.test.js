import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// docs/one-stylist-per-thread.md. Isolated DB: the env vars must land before db.js evaluates.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-one-stylist-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const {
  stylistContinuationDecision, stablePromptFingerprint, volatilePromptTail, withTurnContext,
  PROMPT_CACHE_BREAKPOINT, STYLIST_CONTINUATION_MAX_INPUT_TOKENS, TURN_CONTEXT_HEADER,
} = await import('../styling-engine/provider.js')
const { persistFullStylistTurnState, clearStylistContinuation } = await import('../routes/ai.js')
const { getStylistConversationState, saveStylistConversationState } = await import('../styling-engine/conversationState.js')
const { buildStylistConversationPayload } = await import('../styling-engine/core.js')

const system = `STABLE: constitution and manifest\n${PROMPT_CACHE_BREAKPOINT}\nCURRENT DATE: Wednesday\nTHREAD STATE: {}`
const now = Date.parse('2026-11-11T20:00:00Z')
const saved = {
  provider: 'gemini', model: 'gemini-3.5-flash-lite', interaction_id: 'int_1',
  fingerprint: stablePromptFingerprint(system, 'gemini-3.5-flash-lite'),
  last_turn_at: '2026-11-11T19:00:00Z', last_input_tokens: 40000,
}
const target = { provider: 'gemini', model: 'gemini-3.5-flash-lite', fingerprint: saved.fingerprint, now }

test('a stored conversation is continued only when nothing it was built on has changed', () => {
  assert.deepEqual(stylistContinuationDecision(saved, target), { continue: true, reason: 'continued' })
  assert.equal(stylistContinuationDecision(null, target).reason, 'no_stored_conversation')
  assert.equal(stylistContinuationDecision(saved, { ...target, provider: 'anthropic' }).reason, 'provider_without_server_conversation')
  assert.equal(stylistContinuationDecision(saved, { ...target, model: 'gemini-3.7-flash' }).reason, 'model_changed')
  assert.equal(stylistContinuationDecision(saved, { ...target, fingerprint: 'other' }).reason, 'stable_prompt_changed')
  // Decision 4: more than 7 days since the last turn is a rebuild from stored memory.
  assert.equal(stylistContinuationDecision({ ...saved, last_turn_at: '2026-11-03T19:00:00Z' }, target).reason, 'idle_over_7_days')
  assert.equal(stylistContinuationDecision({ ...saved, last_turn_at: '2026-11-05T19:00:00Z' }, target).reason, 'continued')
  // Decision 3: past the size limit, rebuilt.
  assert.equal(stylistContinuationDecision({ ...saved, last_input_tokens: STYLIST_CONTINUATION_MAX_INPUT_TOKENS }, target).reason, 'size_limit')
})

test('the fingerprint covers the stable prompt only, and the turn context rides in the user message', () => {
  const sameStable = `STABLE: constitution and manifest\n${PROMPT_CACHE_BREAKPOINT}\nCURRENT DATE: Thursday\nTHREAD STATE: {"x":1}`
  assert.equal(stablePromptFingerprint(sameStable, 'gemini-3.5-flash-lite'), saved.fingerprint, 'a new date or thread state does not end the conversation')
  assert.notEqual(stablePromptFingerprint(`STABLE: a garment was edited\n${PROMPT_CACHE_BREAKPOINT}\nCURRENT DATE: Wednesday`, 'gemini-3.5-flash-lite'), saved.fingerprint)
  assert.equal(volatilePromptTail(system), 'CURRENT DATE: Wednesday\nTHREAD STATE: {}')
  const text = withTurnContext('What about shoes?', volatilePromptTail(system))
  assert.ok(text.startsWith(TURN_CONTEXT_HEADER))
  assert.match(text, /CURRENT DATE: Wednesday[\s\S]*The user's message:\nWhat about shoes\?$/)
  const parts = withTurnContext([{ type: 'image', source: {} }, { type: 'text', text: 'this one?' }], 'CTX')
  assert.equal(parts[0].type, 'text')
  assert.match(parts[0].text, /CTX/)
  assert.equal(parts.length, 3)
  assert.equal(withTurnContext('unchanged', ''), 'unchanged')
})

// Live check 2026-11-11: every follow-up rebuilt with stable_prompt_changed. The loop fingerprinted the
// prompt after systemToPlainText had removed the breakpoint marker, so the "stable" hash covered the date
// and thread state too. The captures showed the stable halves byte-identical between turns.
test('the loop fingerprints the prompt with its breakpoint marker, so a new turn\'s context does not end the conversation', async () => {
  const { systemToPlainText } = await import('../styling-engine/provider.js')
  const nextTurn = `STABLE: constitution and manifest\n${PROMPT_CACHE_BREAKPOINT}\nCURRENT DATE: Thursday`
  assert.notEqual(stablePromptFingerprint(systemToPlainText(system), 'm'), stablePromptFingerprint(systemToPlainText(nextTurn), 'm'), 'stripped text cannot tell the halves apart')
  assert.equal(stablePromptFingerprint(system, 'm'), stablePromptFingerprint(nextTurn, 'm'))
  const provider = fs.readFileSync(new URL('../styling-engine/provider.js', import.meta.url), 'utf8')
  assert.match(provider, /stablePromptFingerprint\(system, target\.model\)/)
  assert.doesNotMatch(provider, /stablePromptFingerprint\(plainSystem/)
})

test('a turn saves the conversation the next turn continues; a failed turn or another provider ends it', () => {
  const sessionId = 'thread_one_stylist'
  saveStylistConversationState({ established: { occasion: 'city' } }, sessionId)
  const toolContext = {
    continueThread: true, generatedOutfits: [],
    stylistContinuationState: { provider: 'gemini', model: 'gemini-3.5-flash-lite', fingerprint: 'fp', interaction_id: 'int_2', last_input_tokens: 52000 },
  }
  persistFullStylistTurnState({ toolContext, answer: 'Here you go.', freeformTurnToken: 't1', sessionId })
  const stored = getStylistConversationState(sessionId)
  assert.equal(stored.stylist_continuation.interaction_id, 'int_2')
  assert.equal(stored.stylist_continuation.last_input_tokens, 52000)
  assert.ok(Date.parse(stored.stylist_continuation.last_turn_at) > 0)
  assert.equal(stored.established.occasion, 'city', 'the rest of the thread state is kept')

  // "Retry with Sonnet" (Anthropic keeps no conversation): the stored one ends rather than go stale.
  persistFullStylistTurnState({ toolContext: { continueThread: true, generatedOutfits: [] }, answer: 'ok', freeformTurnToken: 't2', sessionId })
  assert.equal(getStylistConversationState(sessionId).stylist_continuation, undefined)

  persistFullStylistTurnState({ toolContext, answer: 'again', freeformTurnToken: 't3', sessionId })
  clearStylistContinuation(sessionId)
  assert.equal(getStylistConversationState(sessionId).stylist_continuation, undefined)
  assert.equal(getStylistConversationState(sessionId).established.occasion, 'city')
})

test('the full stylist\'s own per-turn state write keeps the stored conversation', async () => {
  const sessionId = 'thread_one_stylist_payload'
  saveStylistConversationState({ stylist_continuation: { ...saved } }, sessionId)
  await buildStylistConversationPayload({ question: 'And shoes?', history: [], pieces: [], sessionId, currentDate: '2026-11-11T12:00:00-08:00' })
  assert.equal(getStylistConversationState(sessionId).stylist_continuation?.interaction_id, 'int_1')
})


test('/ask opts every typed turn into continuation and the reading requirement', () => {
  const route = fs.readFileSync(new URL('../routes/ai.js', import.meta.url), 'utf8')
  const ask = route.slice(route.indexOf("router.post('/ask'"))
  assert.match(ask, /toolContext\.requireDeclaredReading = true/)
  assert.match(ask, /toolContext\.continueThread = true/)
  assert.match(ask, /toolContext\.savedStylistContinuation = compactState\.stylist_continuation \|\| null/)
  assert.match(ask, /catch \(err\) \{[\s\S]*clearStylistContinuation\(req\.body\.sessionId \|\| 'default'\)/)
  // The execution router is gone from the code, not only from this route.
  const provider = fs.readFileSync(new URL('../styling-engine/provider.js', import.meta.url), 'utf8')
  assert.doesNotMatch(provider + route, /export async function routeFreeform|FREEFORM_EXECUTION_ROUTE_SCHEMA = /)
})

// Live check 2026-11-11: trip follow-ups always rebuilt. Their lean prompt left the wardrobe list out, so
// the stable half never matched the trip's first turn. The list is kept; the trip guidance is per-turn.
test('a trip follow-up keeps the first turn\'s stable prompt, so the trip conversation can continue', async () => {
  const { db } = await import('../db.js')
  db.prepare("INSERT INTO pieces (name, category, status) VALUES ('navy wool coat', 'outerwear', 'active')").run()
  const coat = Number(db.prepare("SELECT id FROM pieces WHERE name = 'navy wool coat'").get().id)
  const sessionId = 'thread_trip_continuation'
  const base = { pieces: [], sessionId, currentDate: '2026-11-11T12:00:00-08:00', timezone: 'America/Los_Angeles' }
  const first = await buildStylistConversationPayload({ ...base, question: 'Plan my Portland trip.', history: [], conversationMode: 'new_request' })
  saveStylistConversationState({
    ...getStylistConversationState(sessionId),
    packing_roster: { roster_ids: [coat], roster_pieces: [{ id: coat, name: 'navy wool coat' }], slots: [{ label: 'City walking' }] },
    current_outfit_set: [{ index: 1, label: 'City walking', in_plan: true, piece_ids: [coat] }],
  }, sessionId)
  const followUp = await buildStylistConversationPayload({
    ...base, question: 'What if Saturday turns cold?', conversationMode: 'followup', tripFollowupEligible: true,
    history: [{ role: 'user', content: 'Plan my Portland trip.' }, { role: 'assistant', content: 'Here is your plan.' }, { role: 'user', content: 'What if Saturday turns cold?' }],
  })
  assert.equal(followUp.tripFollowupTurn, true)
  assert.equal(followUp.wardrobeManifestIncluded, true, 'the wardrobe list is kept on a trip follow-up')
  assert.equal(stablePromptFingerprint(followUp.system, 'm'), stablePromptFingerprint(first.system, 'm'))
  assert.match(volatilePromptTail(followUp.system), /TRIP FOLLOW-UP: This thread holds a trip plan/)
  assert.doesNotMatch(volatilePromptTail(first.system), /TRIP FOLLOW-UP/)
})

// Live check 2026-11-11: the override planned 19–22 November but the reply said "November 12 through 15".
test('a planner result states the dates it planned for, and names the range the user\'s words replaced', async () => {
  const { withPlannedDates } = await import('../styling-engine/tools.js')
  const corrected = withPlannedDates('plan_outfit_set', { status: 'success', plan_lines: [] }, {
    plannedDatesForReply: { start: '2026-11-19', end: '2026-11-22', replaced: { start: '2026-11-12', end: '2026-11-15' } },
  })
  assert.equal(corrected.planned_dates, "The plan is for 2026-11-19 to 2026-11-22, from the user's own words. The dates you passed (2026-11-12 to 2026-11-15) were wrong and were replaced; state 2026-11-19 to 2026-11-22 in your reply.")
  assert.equal(Object.keys(corrected)[0], 'planned_dates', 'first, so it is read before the cards')
  assert.equal(withPlannedDates('plan_outfit_set', { status: 'success' }, { plannedDatesForReply: { start: '2026-11-19', end: '2026-11-19', replaced: null } }).planned_dates, 'The plan is for 2026-11-19.')
  assert.deepEqual(withPlannedDates('search_wardrobe', [{ id: 1 }], { plannedDatesForReply: { start: '2026-11-19', end: '2026-11-22' } }), [{ id: 1 }])
  assert.deepEqual(withPlannedDates('plan_outfit_set', { status: 'success' }, {}), { status: 'success' })
})

// 2026-11-11: low thinking for the chat on 3.7 Flash; medium stays for Flash-Lite (where low meant no reasoning)
// and for every caller of the loop that is not /ask.
test('the chat stylist thinks at low on 3.7 Flash only', async () => {
  const { chatThinkingLevelFor, CHAT_STYLIST_THINKING_LEVEL } = await import('../styling-engine/provider.js')
  assert.equal(CHAT_STYLIST_THINKING_LEVEL, process.env.CHAT_STYLIST_THINKING_LEVEL || 'low')
  assert.equal(chatThinkingLevelFor({ continueThread: true }, { provider: 'gemini', model: 'gemini-3.7-flash' }), CHAT_STYLIST_THINKING_LEVEL)
  assert.equal(chatThinkingLevelFor({ continueThread: true }, { provider: 'gemini', model: 'gemini-3.5-flash-lite' }), '', 'Flash-Lite keeps the loop default')
  assert.equal(chatThinkingLevelFor({}, { provider: 'gemini', model: 'gemini-3.7-flash' }), '', 'callers other than /ask keep the loop default')
  assert.equal(chatThinkingLevelFor({ continueThread: true }, { provider: 'anthropic', model: 'claude-sonnet-4-6' }), '')
})

// Owner, 2026-11-11: the Stylist chat runs on 3.7 Flash; every other feature keeps its own model.
test('the chat stylist has its own model, 3.7 Flash by default on Gemini, and only /ask uses it', async () => {
  const { CHAT_STYLIST_MODEL } = await import('../styling-engine/provider.js')
  assert.equal(CHAT_STYLIST_MODEL, process.env.CHAT_STYLIST_MODEL_OVERRIDE || 'gemini-3.7-flash')
  const provider = fs.readFileSync(new URL('../styling-engine/provider.js', import.meta.url), 'utf8')
  assert.match(provider, /export const chatStylistProviderOverride = stylistProviderOverride\?\.provider === 'gemini'\n\s+\? \{ provider: 'gemini', model: CHAT_STYLIST_MODEL \}\n\s+: stylistProviderOverride/)
  const route = fs.readFileSync(new URL('../routes/ai.js', import.meta.url), 'utf8')
  assert.equal(route.split('chatStylistProviderOverride').length - 1, 2, 'imported once, used once: /ask')
  assert.match(route, /providerOverride: req\.body\.provider === 'sonnet' \? \{ provider: 'anthropic' \} : chatStylistProviderOverride/)
})
