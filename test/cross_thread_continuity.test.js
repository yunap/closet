import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// docs/cross-thread-continuity.md. Isolated DB: the env vars must land before db.js evaluates.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-cross-thread-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { db } = await import('../db.js')
const { searchPastConversations, planSummaryFromToolContext, openPlansFromOtherThreads, openPlansPromptText, localIsoDate } = await import('../styling-engine/pastConversations.js')
const { executeTool, STYLIST_TOOLS } = await import('../styling-engine/tools.js')
const { persistFullStylistTurnState } = await import('../routes/ai.js')
const { getStylistConversationState, saveStylistConversationState } = await import('../styling-engine/conversationState.js')
const { buildStylistConversationPayload } = await import('../styling-engine/core.js')

function addPiece(name, category, status = 'active') {
  return Number(db.prepare('INSERT INTO pieces (name, category, status) VALUES (?, ?, ?)').run(name, category, status).lastInsertRowid)
}

function addThread(id, { title, messages, archived = 0, createdAt = '2026-11-01 10:00:00', updatedAt = '2026-11-01 11:00:00' }) {
  db.prepare('INSERT INTO chat_threads (id, title, payload, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, title, JSON.stringify({ messages }), archived, createdAt, updatedAt)
}

const dress = addPiece('green silk slip dress', 'dress')
const sandals = addPiece('tan strappy sandals', 'shoes')
const goneBlazer = addPiece('old navy blazer', 'outerwear', 'archived')

addThread('thread_wedding', {
  title: 'Outfit for my cousin\'s wedding',
  updatedAt: '2026-10-20 12:00:00',
  messages: [
    { role: 'assistant', text: 'Hi! I am your stylist.' },
    { role: 'user', text: 'I need an outfit for my cousin\'s garden wedding in June.' },
    {
      role: 'assistant',
      text: 'The silk slip dress is perfect because it is breezy.',
      structuredOutfits: [
        { label: 'Garden wedding slip', reason: 'ASSISTANT REASONING MUST NOT LEAK', pieces: [{ id: dress, name: 'green silk slip dress', category: 'dress' }, { id: sandals, name: 'tan strappy sandals', category: 'shoes' }] },
        { label: 'Broken card', broken: true, pieces: [{ id: goneBlazer, name: 'old navy blazer', category: 'outerwear' }] },
      ],
    },
    { role: 'user', text: 'Love the slip dress, but no heels please.' },
  ],
})
addThread('thread_errands', {
  title: 'Saturday errands',
  updatedAt: '2026-10-25 12:00:00',
  messages: [
    { role: 'user', text: 'Something easy for errands.' },
    { role: 'assistant', text: 'Try the blazer.', structuredOutfits: [{ label: 'Errand blazer', pieces: [{ id: goneBlazer, name: 'old navy blazer', category: 'outerwear' }] }] },
  ],
})
addThread('thread_archived_wedding', { title: 'Wedding ideas', archived: 1, messages: [{ role: 'user', text: 'Another wedding question.' }] })
addThread('thread_current', { title: 'Now', messages: [{ role: 'user', text: 'What did you suggest for the wedding?' }] })

db.prepare("INSERT INTO stylist_feedback (feedback_type, target_type, label, note, payload) VALUES ('works', 'whole_wardrobe_outfit', 'Garden wedding slip', 'Perfect for June', ?)")
  .run(JSON.stringify({ threadId: 'thread_wedding', messageIndex: 2 }))

test('search finds the earlier conversation by the user\'s own words and leaves out this thread and archived ones', () => {
  const result = searchPastConversations({ query: 'what did you suggest for the wedding', currentSessionId: 'thread_current' })
  assert.deepEqual(result.conversations.map(c => c.title), ['Outfit for my cousin\'s wedding'])
  const [wedding] = result.conversations
  assert.ok(wedding.user_said.some(text => text.includes('garden wedding')))
  assert.deepEqual(wedding.matched_words, ['wedding'])
})

test('a result carries the user\'s words, the cards and their verdicts, never the assistant\'s prose or reasons', () => {
  const [wedding] = searchPastConversations({ query: 'wedding', currentSessionId: 'thread_current' }).conversations
  const serialized = JSON.stringify(wedding)
  assert.ok(!serialized.includes('ASSISTANT REASONING MUST NOT LEAK'))
  assert.ok(!serialized.includes('perfect because it is breezy'))
  assert.deepEqual(wedding.cards_shown, [{
    card_title: 'Garden wedding slip',
    pieces: [
      { id: dress, name: 'green silk slip dress', category: 'dress', still_in_wardrobe: true },
      { id: sandals, name: 'tan strappy sandals', category: 'shoes', still_in_wardrobe: true },
    ],
  }])
  assert.deepEqual(wedding.user_verdicts.map(v => [v.verdict, v.about, v.user_note]), [['works', 'Garden wedding slip', 'Perfect for June']])
  assert.ok(wedding.user_said.includes('Love the slip dress, but no heels please.'))
})

test('a long thread keeps its first message, the matching ones and the latest ones', () => {
  const said = ['Dinner at my sister\'s house on Sunday.', ...Array.from({ length: 8 }, (_, i) => `Filler message ${i}.`), 'The sister dinner moved to Saturday.', 'Actually make it cooler.', 'And flat shoes.']
  addThread('thread_long', { title: 'Long one', messages: said.map(text => ({ role: 'user', text })) })
  const [long] = searchPastConversations({ query: 'sister', currentSessionId: 'thread_current' }).conversations
  assert.deepEqual(long.user_said, [said[0], 'Filler message 6.', 'Filler message 7.', said[9], said[10], said[11]])
  db.prepare("DELETE FROM chat_threads WHERE id = 'thread_long'").run()
})

test('a distinctive word ranks newest first; a common word does not outrank recency', () => {
  // Ten filler threads make "pack" and "dinner" common; "lisbon" stays distinctive.
  for (let i = 0; i < 10; i += 1) addThread(`thread_filler_${i}`, { title: `Filler ${i}`, updatedAt: '2026-09-01 10:00:00', messages: [{ role: 'user', text: 'Pack for dinner with friends.' }] })
  addThread('thread_lisbon_old', { title: 'Old Lisbon', updatedAt: '2026-08-01 10:00:00', messages: [{ role: 'user', text: 'Pack for Lisbon, dinner out every night.' }] })
  addThread('thread_lisbon_new', { title: 'New Lisbon', updatedAt: '2026-11-05 10:00:00', messages: [{ role: 'user', text: 'Lisbon next week, carry-on only.' }] })
  const result = searchPastConversations({ query: 'what did you pack for the Lisbon dinner', currentSessionId: 'thread_current' })
  assert.deepEqual(result.conversations.slice(0, 2).map(c => c.title), ['New Lisbon', 'Old Lisbon'])
  db.prepare("DELETE FROM chat_threads WHERE id LIKE 'thread_filler_%' OR id LIKE 'thread_lisbon_%'").run()
})

test('a word the user said outranks the same word only in a card\'s garment names', () => {
  addThread('thread_objection', { title: 'Party at home', updatedAt: '2026-10-02 10:00:00', messages: [{ role: 'user', text: 'Party at home tonight.' }, { role: 'user', text: 'I am not a fan of those trainers.' }] })
  addThread('thread_card_only', { title: 'Coffee run', updatedAt: '2026-11-08 10:00:00', messages: [{ role: 'user', text: 'Coffee run.' }, { role: 'assistant', text: '', structuredOutfits: [{ label: 'Easy', pieces: [{ id: sandals, name: 'white trainers' }] }] }] })
  const [first] = searchPastConversations({ query: 'trainers', currentSessionId: 'thread_current' }).conversations
  assert.equal(first.title, 'Party at home')
  db.prepare("DELETE FROM chat_threads WHERE id IN ('thread_objection', 'thread_card_only')").run()
})

test('a plan in a result lists what was packed', () => {
  addThread('thread_packed', { title: 'Seattle weekend', messages: [{ role: 'user', text: 'Seattle this weekend.' }] })
  saveStylistConversationState({ plan: { kind: 'trip', location: 'Seattle, WA', start: '2026-11-20', end: '2026-11-22' }, packing_roster: { roster_ids: [dress, goneBlazer], roster_pieces: [{ id: dress, name: 'green silk slip dress', category: 'dress' }, { id: goneBlazer, name: 'old navy blazer', category: 'outerwear' }] } }, 'thread_packed')
  const [seattle] = searchPastConversations({ query: 'Seattle', currentSessionId: 'thread_current' }).conversations
  assert.deepEqual(seattle.plan.packed.map(p => [p.id, p.still_in_wardrobe]), [[dress, true], [goneBlazer, false]])
  db.prepare("DELETE FROM chat_threads WHERE id = 'thread_packed'").run()
  db.prepare("DELETE FROM stylist_conversation_state WHERE session_id = 'thread_packed'").run()
})

test('a piece no longer active is marked, and garment names in cards are searchable', () => {
  const [errands] = searchPastConversations({ query: 'the navy blazer', currentSessionId: 'thread_current' }).conversations
  assert.equal(errands.title, 'Saturday errands')
  assert.equal(errands.cards_shown[0].pieces[0].still_in_wardrobe, false)
})

test('no match says so; an empty query lists recent conversations', () => {
  const none = searchPastConversations({ query: 'ski trip', currentSessionId: 'thread_current' })
  assert.deepEqual(none.conversations, [])
  assert.match(none.note, /No earlier conversation matches/)
  const recent = searchPastConversations({ query: '', currentSessionId: 'thread_current' })
  assert.deepEqual(recent.conversations.map(c => c.title), ['Saturday errands', 'Outfit for my cousin\'s wedding'])
})

test('the tool is offered and searches the user\'s other threads', async () => {
  assert.ok(STYLIST_TOOLS.some(tool => tool.name === 'search_past_conversations'))
  const result = await executeTool('search_past_conversations', { query: 'errands' }, { sessionId: 'thread_errands' })
  assert.deepEqual(result.conversations, [])
})

test('a plan summary comes only from a dated plan the plan tool built', () => {
  const diagnostics = { planOutfitSetCalls: 1, resolvedDateRange: '2026-11-12..2026-11-15', planKindResolved: 'trip', resolvedLocation: 'Portland, OR', dateRangeSource: 'user_stated' }
  assert.deepEqual(planSummaryFromToolContext({ freeformDiagnostics: diagnostics }), { kind: 'trip', location: 'Portland, OR', start: '2026-11-12', end: '2026-11-15', date_source: 'user_stated' })
  assert.equal(planSummaryFromToolContext({ freeformDiagnostics: { ...diagnostics, resolvedDateRange: '' } }), null)
  assert.equal(planSummaryFromToolContext({ freeformDiagnostics: { ...diagnostics, planOutfitSetCalls: 0 } }), null)
  // A plan at home names no place: resolvedLocation then holds the home fallback, not a destination.
  assert.equal(planSummaryFromToolContext({ freeformDiagnostics: { ...diagnostics, planKindResolved: 'coordinated_plan', resolvedDateRange: '2026-11-20' } }).location, '')
})

test('persisting a plan turn stores the plan, and a follow-up keeps it', () => {
  addThread('thread_portland', { title: 'Portland trip', createdAt: '2026-11-10 09:00:00', messages: [{ role: 'user', text: 'Going to Portland next Thursday.' }] })
  const toolContext = {
    generatedOutfits: [{ label: 'City walking', pieceIds: [dress, sandals], pieces: [{ id: dress }, { id: sandals }] }],
    freeformDiagnostics: { planOutfitSetCalls: 1, resolvedDateRange: '2026-11-12..2026-11-15', planKindResolved: 'trip', resolvedLocation: 'Portland, OR', dateRangeSource: 'user_stated' },
  }
  persistFullStylistTurnState({ toolContext, answer: 'Here is your plan.', freeformTurnToken: 't1', sessionId: 'thread_portland' })
  assert.equal(getStylistConversationState('thread_portland').plan.location, 'Portland, OR')
  persistFullStylistTurnState({ toolContext: { generatedOutfits: [], freeformDiagnostics: {} }, answer: 'Sure.', freeformTurnToken: 't2', sessionId: 'thread_portland' })
  assert.equal(getStylistConversationState('thread_portland').plan.start, '2026-11-12')
})

test('open plans list other threads\' plans whose dates have not passed', () => {
  addThread('thread_past_trip', { title: 'Old trip', messages: [{ role: 'user', text: 'Trip.' }] })
  saveStylistConversationState({ plan: { kind: 'trip', location: 'Austin, TX', start: '2026-10-01', end: '2026-10-04' } }, 'thread_past_trip')
  const plans = openPlansFromOtherThreads({ currentSessionId: 'thread_current', today: '2026-11-11' })
  assert.deepEqual(plans.map(p => [p.thread_title, p.location, p.start, p.end, p.planned_on]), [['Portland trip', 'Portland, OR', '2026-11-12', '2026-11-15', '2026-11-10']])
  assert.match(openPlansPromptText(plans), /Trip to Portland, OR, 2026-11-12 to 2026-11-15 — conversation "Portland trip", planned 2026-11-10\./)
  assert.deepEqual(openPlansFromOtherThreads({ currentSessionId: 'thread_portland', today: '2026-11-11' }), [])
  assert.deepEqual(openPlansFromOtherThreads({ currentSessionId: 'thread_current', today: '2026-11-16' }), [])
  assert.equal(openPlansPromptText([]), '')
})

test('the full stylist sees another thread\'s open plan, and nothing when there is none', async () => {
  const body = { question: 'What should I wear on Friday?', history: [], pieces: [], currentDate: '2026-11-11T12:00:00-08:00', timezone: 'America/Los_Angeles' }
  const withPlan = await buildStylistConversationPayload({ ...body, sessionId: 'thread_current' })
  assert.match(JSON.stringify(withPlan.system), /OPEN PLANS IN OTHER CONVERSATIONS/)
  const inPlanThread = await buildStylistConversationPayload({ ...body, sessionId: 'thread_portland' })
  assert.doesNotMatch(JSON.stringify(inPlanThread.system), /OPEN PLANS IN OTHER CONVERSATIONS/)
  // That follow-up turn in the plan's own thread rewrote its state; the plan must survive it.
  assert.equal(getStylistConversationState('thread_portland').plan?.location, 'Portland, OR')
})

test('the router\'s compact context names other threads\' open plans, and nothing when there are none', async () => {
  const { routerOpenPlansContext } = await import('../routes/ai.js')
  assert.equal(
    routerOpenPlansContext({ sessionId: 'thread_current', currentDate: '2026-11-11T12:00:00-08:00', timezone: 'America/Los_Angeles' }),
    'open plans in other conversations: Trip to Portland, OR 2026-11-12 to 2026-11-15'
  )
  assert.equal(routerOpenPlansContext({ sessionId: 'thread_portland', currentDate: '2026-11-11T12:00:00-08:00' }), '')
  assert.equal(routerOpenPlansContext({ sessionId: 'thread_current', currentDate: '2026-11-20T12:00:00-08:00' }), '')
  const route = fs.readFileSync(new URL('../routes/ai.js', import.meta.url), 'utf8')
  assert.match(route, /'no usual packing approach on record',\s*routerOpenPlansContext\(req\.body\),\s*\]\.filter\(Boolean\)\.join\('; '\)/)
})

test('finding an open plan puts its suitcase in force for the turn, and only for the turn', async () => {
  const { boundedConversationStateFromToolContext } = await import('../routes/ai.js')
  addThread('thread_rome', { title: 'Rome trip', messages: [{ role: 'user', text: 'Rome next week.' }] })
  const roster = { roster_ids: [dress, sandals], roster_pieces: [{ id: dress, name: 'green silk slip dress', category: 'dress' }, { id: sandals, name: 'tan strappy sandals', category: 'shoes' }], slots: [{ id: 'day', label: 'Days' }] }
  saveStylistConversationState({ plan: { kind: 'trip', location: 'Rome, Italy', start: '2026-11-18', end: '2026-11-21' }, packing_roster: roster }, 'thread_rome')

  const toolContext = { sessionId: 'thread_current', currentDate: '2026-11-11T12:00:00-08:00', timezone: 'America/Los_Angeles' }
  const result = await executeTool('search_past_conversations', { query: 'Rome' }, toolContext)
  assert.match(result.suitcase_in_force, /packed pieces of the plan in "Rome trip" are this turn's suitcase/)
  assert.deepEqual([...toolContext.packingRosterIds], [dress, sandals])
  assert.deepEqual(toolContext.packingRosterSlots, roster.slots)
  assert.equal(toolContext.adoptedPackingRosterFrom, 'thread_rome')

  // An addition on a card (propose_outfit's pendingRosterChange) is not written into this thread.
  toolContext.generatedOutfits = [{ label: 'Rome dinner', pieceIds: [dress, goneBlazer], pieces: [{ id: dress }, { id: goneBlazer }] }]
  toolContext.pendingRosterChange = { addedIds: [goneBlazer], addedPieces: [{ id: goneBlazer, name: 'old navy blazer' }], removedIds: [] }
  assert.equal(boundedConversationStateFromToolContext(toolContext).packing_roster, undefined)

  // A plan that has ended is not adopted, and a turn's own roster is never replaced.
  const later = { sessionId: 'thread_current', currentDate: '2026-11-25T12:00:00-08:00' }
  assert.equal((await executeTool('search_past_conversations', { query: 'Rome' }, later)).suitcase_in_force, undefined)
  assert.equal(later.packingRosterIds, undefined)
  const own = { sessionId: 'thread_current', currentDate: '2026-11-11T12:00:00-08:00', packingRosterIds: new Set([goneBlazer]) }
  await executeTool('search_past_conversations', { query: 'Rome' }, own)
  assert.deepEqual([...own.packingRosterIds], [goneBlazer])

  db.prepare("DELETE FROM chat_threads WHERE id = 'thread_rome'").run()
  db.prepare("DELETE FROM stylist_conversation_state WHERE session_id = 'thread_rome'").run()
})

test('localIsoDate uses the user\'s time zone', () => {
  assert.equal(localIsoDate(new Date('2026-11-12T03:00:00Z'), 'America/Los_Angeles'), '2026-11-11')
})
