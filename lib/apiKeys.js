// Spec 33 Part 4 — BYOK key resolution. A user's own key (stored in their own wardrobe.db
// app_meta — "their file IS their private store") overrides the operator's env key for
// their requests. No spend ceiling (owner ruling 2026-07-20): anyone bringing their own
// key pays their own bill directly, so there's nothing left for a ceiling to protect.
import { getDbForUser } from '../db.js'
import { getCurrentUserId } from './requestContext.js'

const KEYS = {
  anthropic: { metaKey: 'byok_anthropic_key', envVar: 'ANTHROPIC_API_KEY' },
  openai: { metaKey: 'byok_openai_key', envVar: 'OPENAI_API_KEY' }
}

function ownKey(provider, userId = getCurrentUserId()) {
  const conn = getDbForUser(userId)
  const value = conn.prepare('SELECT value FROM app_meta WHERE key = ?').get(KEYS[provider].metaKey)?.value
  return value || null
}

function resolveKey(provider, userId = getCurrentUserId()) {
  return ownKey(provider, userId) || process.env[KEYS[provider].envVar] || null
}

export const resolveAnthropicKey = (userId = getCurrentUserId()) => resolveKey('anthropic', userId)
export const resolveOpenAiKey = (userId = getCurrentUserId()) => resolveKey('openai', userId)

export const hasAnthropicKey = (userId = getCurrentUserId()) => Boolean(resolveAnthropicKey(userId))
export const hasOpenAiKey = (userId = getCurrentUserId()) => Boolean(resolveOpenAiKey(userId))

export function ownKeyStatus(userId = getCurrentUserId()) {
  return {
    hasOwnAnthropicKey: Boolean(ownKey('anthropic', userId)),
    hasOwnOpenAiKey: Boolean(ownKey('openai', userId))
  }
}

// value === '' clears the stored key (falls back to the operator's).
export function setOwnKey(provider, value, userId = getCurrentUserId()) {
  const conn = getDbForUser(userId)
  const metaKey = KEYS[provider].metaKey
  if (value) {
    conn.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(metaKey, value)
  } else {
    conn.prepare('DELETE FROM app_meta WHERE key = ?').run(metaKey)
  }
}
