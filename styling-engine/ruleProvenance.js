// STORED GARMENT RULES FOR MODEL INPUT (docs/garment-evidence-parity-2026-09-15.md §2a). Every model-facing reader of a garment's
// `styling_rules_learned` goes through storedGarmentRules, so no path decides this on its own. Stored data is never modified.
//
// The stored rules are the owner's historical rule record and keep their authority (`RULES (authoritative)`). The empty
// piece_rule_receipt ledger is NOT evidence that a rule was not the owner's: receipts were introduced after most rules were saved.
// Only three narrow kinds of entry are not garment rules, each identified by the source that wrote it:
//   - generated occasion receipts (stylingRulesForPrompt; display-only provenance, feedback-routing phase 0);
//   - retired outfit-reaction copies, `[feedback:<type>] …` (owner ruling 2026-08-08: a reaction to a combination is not a
//     garment rule; the writer that produced them is removed);
//   - saved chat replies: an entry identical to a chat message the retired "Save" button marked in that thread's
//     `savedIndices` (the button and its append-note endpoint were removed 2026-08-09; the thread marker is its source record).
import { db } from '../db.js'
import { stylingRulesForPrompt, isRetiredOutfitReactionCopy } from '../src/utils/wardrobeAiContext.js'

const savedChatReplyCache = new Map()

// The retired Save button can no longer mark messages, so the set is fixed per database file for the process lifetime.
export function savedChatReplyTexts() {
  const key = String(db?.name || '')
  if (savedChatReplyCache.has(key)) return savedChatReplyCache.get(key)
  const texts = new Set()
  try {
    for (const row of db.prepare(`SELECT payload FROM chat_threads WHERE payload LIKE '%"savedIndices":[%'`).all()) {
      let payload
      try { payload = JSON.parse(row.payload || '{}') } catch { continue }
      const messages = Array.isArray(payload?.messages) ? payload.messages : []
      for (const index of Array.isArray(payload?.savedIndices) ? payload.savedIndices : []) {
        const message = messages[Number(index)]
        for (const field of ['text', 'content']) {
          if (typeof message?.[field] === 'string' && message[field].trim()) texts.add(message[field].trim())
        }
      }
    }
  } catch {
    return texts
  }
  savedChatReplyCache.set(key, texts)
  return texts
}

export function _clearRuleProvenanceCacheForTests() {
  savedChatReplyCache.clear()
}

const storedList = value => {
  if (Array.isArray(value)) return value
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
}

export function storedGarmentRules(piece = {}) {
  const candidates = stylingRulesForPrompt(storedList(piece?.styling_rules_learned))
    .filter(rule => String(rule ?? '').trim() && !isRetiredOutfitReactionCopy(rule))
  if (!candidates.length) return []
  const saved = savedChatReplyTexts()
  return candidates.filter(rule => !saved.has(String(rule).trim()))
}
