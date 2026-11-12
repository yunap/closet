// Continuity across separate Stylist threads (docs/cross-thread-continuity.md).
//
// A thread is the user's own unit of topic, and search depends on it, so threads stay separate.
// Two things reach across them, and both carry only what the USER authored or decided:
//
//   1. search_past_conversations — a tool the stylist calls when the user refers back to an earlier
//      conversation. It returns the user's own words, the cards shown (title + pieces) and the
//      user's verdicts on them. Never the assistant's prose or a card's reasons: assistant text is
//      not user evidence (owner ruling, 2026-10).
//   2. Open plans — one line per dated plan in another thread whose dates have not passed, so a
//      trip planned last week is not unknown in this week's thread. Kind, place, dates, thread
//      title. No weather: a stored forecast describes the day it was fetched.
//
// Neither is preference memory. Their authority is "history / context", recorded in
// docs/feedback-and-memory-map.md §7.

import { db, safeJsonParse } from '../db.js'

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'with', 'what', 'that', 'this', 'from', 'about', 'was', 'were',
  'did', 'had', 'have', 'has', 'are', 'but', 'not', 'can', 'could', 'would', 'should', 'when', 'where',
  'which', 'who', 'how', 'any', 'all', 'our', 'out', 'last', 'time', 'earlier', 'before', 'previous',
  'conversation', 'chat', 'thread', 'talked', 'suggested', 'said', 'told', 'outfit', 'outfits', 'like',
  'one', 'ones', 'some', 'again', 'there', 'then', 'them', 'they', 'wear', 'wore', 'wearing', 'week',
])

const MAX_USER_MESSAGES = 6
const MAX_USER_MESSAGE_CHARS = 400
const MAX_CARDS = 6
const DEFAULT_RESULT_LIMIT = 3
const MAX_RESULT_LIMIT = 5

export function searchWords(text = '') {
  return [...new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 3 && !STOP_WORDS.has(word)))]
}

function wordSet(text = '') {
  return new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
}

function clip(text = '', max = MAX_USER_MESSAGE_CHARS) {
  const value = String(text || '').trim()
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function dayOf(value = '') {
  return String(value || '').slice(0, 10)
}

// The plan a turn produced, as plain facts. Read from the plan tool's own resolved values, never
// from the reply text. Only a dated plan is an "open plan"; an undated capsule is not.
export function planSummaryFromToolContext(toolContext = {}) {
  const diagnostics = toolContext?.freeformDiagnostics || {}
  if (!Number(diagnostics.planOutfitSetCalls)) return null
  const range = String(diagnostics.resolvedDateRange || '')
  const [start, end] = range.split('..')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '')) return null
  const kind = String(diagnostics.planKindResolved || '')
  return {
    kind: kind || 'plan',
    location: kind === 'trip' ? String(diagnostics.resolvedLocation || '') : '',
    start,
    end: /^\d{4}-\d{2}-\d{2}$/.test(end || '') ? end : start,
    date_source: String(diagnostics.dateRangeSource || ''),
  }
}

export function localIsoDate(date = new Date(), timezone = 'America/Los_Angeles') {
  try {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone || 'America/Los_Angeles' }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

function threadRows() {
  return db.prepare(`
    SELECT t.id, t.title, t.created_at, t.updated_at, t.payload, s.state_json
    FROM chat_threads t
    LEFT JOIN stylist_conversation_state s ON s.session_id = t.id
    WHERE COALESCE(t.archived, 0) = 0
    ORDER BY t.updated_at DESC
  `).all()
}

export function openPlansFromOtherThreads({ currentSessionId = '', today = '' } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return []
  const rows = db.prepare(`
    SELECT s.session_id, s.state_json, t.title, t.created_at
    FROM stylist_conversation_state s
    JOIN chat_threads t ON t.id = s.session_id
    WHERE COALESCE(t.archived, 0) = 0 AND s.session_id != ?
  `).all(String(currentSessionId || ''))
  return rows
    .map(row => ({ row, plan: safeJsonParse(row.state_json, {})?.plan }))
    .filter(({ plan }) => plan?.start && (plan.end || plan.start) >= today)
    .map(({ row, plan }) => ({
      thread_id: row.session_id,
      thread_title: String(row.title || ''),
      planned_on: dayOf(row.created_at),
      kind: plan.kind,
      location: plan.location || '',
      start: plan.start,
      end: plan.end || plan.start,
    }))
    .sort((a, b) => a.start.localeCompare(b.start))
}

function planLabel(plan = {}) {
  if (plan.kind === 'trip') return plan.location ? `Trip to ${plan.location}` : 'Trip'
  if (plan.kind === 'coordinated_plan') return 'Plan at home'
  if (plan.kind === 'seasonal_capsule') return 'Capsule'
  return 'Plan'
}

// The router's compact context gets the same facts in one clause, so a request about a trip planned
// in another thread ("for my Portland trip…", a day inside it) reaches the full stylist, which can
// look the plan up. Router check 2026-11-11: without it, case B went to single_outfit.
export function openPlansRouterContext(plans = []) {
  if (!plans.length) return ''
  return `open plans in other conversations: ${plans.map(plan => `${planLabel(plan)} ${plan.start === plan.end ? plan.start : `${plan.start} to ${plan.end}`}`).join('; ')}`
}

export function openPlansPromptText(plans = []) {
  if (!plans.length) return ''
  return [
    'OPEN PLANS IN OTHER CONVERSATIONS (context only):',
    ...plans.map(plan => `- ${planLabel(plan)}, ${plan.start === plan.end ? plan.start : `${plan.start} to ${plan.end}`} — conversation "${plan.thread_title}", planned ${plan.planned_on}.`),
    'These are plans the user made with you in other conversations whose dates have not passed. Use one only when this request falls on its dates or concerns the same trip or event — for example, an outfit for a day the user will be away — and then say which plan you took it from. Do not bring them up otherwise. search_past_conversations returns a plan\'s looks and what the user said about them.',
  ].join('\n')
}

function cardsFromMessages(messages = [], activeIds = new Set()) {
  const cards = []
  messages.forEach(message => {
    if (message?.role !== 'assistant' || !Array.isArray(message.structuredOutfits)) return
    message.structuredOutfits.forEach(outfit => {
      if (!outfit || outfit.broken || outfit.diagnosticOnly) return
      const pieces = (Array.isArray(outfit.pieces) ? outfit.pieces : [])
        .filter(piece => piece && Number(piece.id))
        .map(piece => ({ id: Number(piece.id), name: String(piece.name || ''), category: String(piece.category || ''), still_in_wardrobe: activeIds.has(Number(piece.id)) }))
      if (pieces.length) cards.push({ card_title: String(outfit.label || outfit.title || ''), pieces })
    })
  })
  return cards.slice(-MAX_CARDS)
}

function verdictsByThread() {
  const rows = db.prepare(`
    SELECT feedback_type, label, note, payload, created_at
    FROM stylist_feedback
    WHERE COALESCE(archived, 0) = 0 AND payload LIKE '%"threadId"%'
    ORDER BY id ASC
  `).all()
  const byThread = new Map()
  for (const row of rows) {
    const payload = safeJsonParse(row.payload, {})
    const threadId = String(payload?.threadId || '')
    if (!threadId) continue
    const about = String(row.label || payload?.outfit?.title || payload?.board?.label || '').trim()
    const entry = { verdict: String(row.feedback_type || ''), ...(about ? { about } : {}), ...(String(row.note || '').trim() ? { user_note: clip(row.note, 300) } : {}), on: dayOf(row.created_at) }
    if (!byThread.has(threadId)) byThread.set(threadId, [])
    byThread.get(threadId).push(entry)
  }
  return byThread
}

function activePieceIds() {
  return new Set(db.prepare("SELECT id FROM pieces WHERE COALESCE(status, 'active') = 'active'").all().map(row => Number(row.id)))
}

function userMessagesOf(messages = []) {
  return messages
    .filter(message => message?.role === 'user' && String(message.text || '').trim())
    .map(message => String(message.text))
}

export function searchPastConversations({ query = '', currentSessionId = '', limit = DEFAULT_RESULT_LIMIT } = {}) {
  const cap = Math.min(Math.max(Number(limit) || DEFAULT_RESULT_LIMIT, 1), MAX_RESULT_LIMIT)
  const words = searchWords(query)
  const threads = threadRows().filter(row => row.id !== String(currentSessionId || ''))
  const parsed = threads.map(row => {
    const payload = safeJsonParse(row.payload, {})
    const messages = Array.isArray(payload?.messages) ? payload.messages : []
    return { row, messages, userMessages: userMessagesOf(messages) }
  }).filter(entry => entry.userMessages.length)

  if (!words.length) {
    return {
      query: String(query || ''),
      note: 'No search words given, so these are the most recent other conversations. Call again with words from the user\'s message to see one in detail.',
      conversations: parsed.slice(0, 5).map(({ row, userMessages }) => ({
        title: String(row.title || ''),
        started: dayOf(row.created_at),
        last_active: dayOf(row.updated_at),
        first_user_message: clip(userMessages[0], 200),
      })),
    }
  }

  const scored = parsed.map(entry => {
    const cardNames = entry.messages.flatMap(message => (message?.role === 'assistant' && Array.isArray(message.structuredOutfits))
      ? message.structuredOutfits.flatMap(outfit => [outfit?.label, ...(Array.isArray(outfit?.pieces) ? outfit.pieces.map(piece => piece?.name) : [])])
      : [])
    const userHaystack = wordSet([entry.row.title, ...entry.userMessages].join(' '))
    const cardHaystack = wordSet(cardNames.join(' '))
    const matched = words.filter(word => userHaystack.has(word) || cardHaystack.has(word))
    const matchedInUserWords = words.filter(word => userHaystack.has(word))
    return { ...entry, matched, matchedInUserWords }
  })
  // Ranking: threads that share the query's DISTINCTIVE words (found in few threads, like a place or
  // an event), newest first. A common word ("pack", "dinner") must not outrank recency: on the real
  // wardrobe, "what did you pack for Portland" ranked three older Portland threads that said "pack"
  // above this week's, which said "carry-on". Only when no query word is distinctive does the count
  // of matched words decide.
  const documentFrequency = new Map(words.map(word => [word, scored.filter(entry => entry.matched.includes(word)).length]))
  const distinctiveLimit = Math.max(2, Math.ceil(parsed.length * 0.1))
  const distinctive = new Set(words.filter(word => documentFrequency.get(word) > 0 && documentFrequency.get(word) <= distinctiveLimit))
  // How rare a word is in what users SAID, measured on their words alone: "sneakers" is in hundreds of
  // cards' garment names but in few objections.
  const userFrequency = new Map(words.map(word => [word, scored.filter(entry => entry.matchedInUserWords.includes(word)).length]))
  const distinctiveInUserWords = new Set(words.filter(word => userFrequency.get(word) > 0 && userFrequency.get(word) <= distinctiveLimit))
  // The user's own words outrank a garment name on a card (live check 2026-11-11, case F: "sneakers" was
  // in the user's objection in one thread and only in card garment names in the newer ones).
  const ranked = scored
    .filter(entry => entry.matched.length)
    .map(entry => ({
      ...entry,
      userDistinctiveCount: entry.matchedInUserWords.filter(word => distinctiveInUserWords.has(word)).length,
      distinctiveCount: entry.matched.filter(word => distinctive.has(word)).length,
    }))
    .sort((a, b) => b.userDistinctiveCount - a.userDistinctiveCount
      || b.distinctiveCount - a.distinctiveCount
      || (a.distinctiveCount ? 0 : b.matched.length - a.matched.length)
      || String(b.row.updated_at).localeCompare(String(a.row.updated_at)))
    .slice(0, cap)

  if (!ranked.length) {
    return { query: String(query || ''), conversations: [], note: 'No earlier conversation matches these words. Say so plainly if the user asked about one; do not guess what was said.' }
  }

  const activeIds = activePieceIds()
  const verdicts = verdictsByThread()
  return {
    query: String(query || ''),
    conversations: ranked.map(({ row, messages, userMessages, matched }) => {
      // Every user message when they fit; a long thread keeps its first message, the ones that
      // match, and its latest ones (where objections and decisions usually are), in order.
      const keep = new Set(userMessages.length <= MAX_USER_MESSAGES
        ? userMessages.map((_, index) => index)
        : [0, ...userMessages.map((text, index) => (words.some(word => wordSet(text).has(word)) ? index : -1)).filter(index => index > 0)])
      for (let index = userMessages.length - 1; index >= 0 && keep.size < MAX_USER_MESSAGES; index -= 1) keep.add(index)
      const shown = [...keep].sort((a, b) => a - b).slice(0, MAX_USER_MESSAGES).map(index => userMessages[index])
      const state = safeJsonParse(row.state_json, {})
      const plan = state?.plan
      // What the plan packed — the suitcase, which the cards alone do not show (a card's assigned
      // layer is not one of its pieces). Live check 2026-11-11, case B: an unpacked jacket was added
      // to the Saturday dinner look with nothing saying it was not in the suitcase.
      const packed = (Array.isArray(state?.packing_roster?.roster_pieces) ? state.packing_roster.roster_pieces : [])
        .filter(piece => piece && Number(piece.id))
        .map(piece => ({ id: Number(piece.id), name: String(piece.name || ''), category: String(piece.category || ''), still_in_wardrobe: activeIds.has(Number(piece.id)) }))
      return {
        title: String(row.title || ''),
        started: dayOf(row.created_at),
        last_active: dayOf(row.updated_at),
        matched_words: matched,
        user_said: shown.map(text => clip(text)),
        ...(plan?.start ? { plan: { kind: plan.kind, location: plan.location || '', start: plan.start, end: plan.end || plan.start, ...(packed.length ? { packed } : {}) } } : {}),
        cards_shown: cardsFromMessages(messages, activeIds),
        user_verdicts: verdicts.get(row.id) || [],
      }
    }),
  }
}
