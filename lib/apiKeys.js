// Spec 33 Part 4 — BYOK key resolution. A user's own key (stored in their own wardrobe.db
// app_meta — "their file IS their private store") overrides the operator's env key for
// their requests. No spend ceiling (owner ruling 2026-07-20): anyone bringing their own
// key pays their own bill directly, so there's nothing left for a ceiling to protect.
//
// Owner ruling 2026-07-20 (follow-up): falling back to the operator's key is NOT the
// default for an invited user — they don't "ride on" the operator's key until the
// operator explicitly approves them (system.db's operator_key_approved flag). The
// operator (DEFAULT_USER_ID) is exempt from this check — it's their own key.
import { getDbForUser } from '../db.js'
import { getCurrentUserId, DEFAULT_USER_ID } from './requestContext.js'
import { isApprovedForOperatorKey } from './systemDb.js'

const KEYS = {
  anthropic: { metaKey: 'byok_anthropic_key', envVar: 'ANTHROPIC_API_KEY' },
  openai: { metaKey: 'byok_openai_key', envVar: 'OPENAI_API_KEY' },
  // Gemini evaluation slice (plan: quizzical-foraging-boot, Stage D): real per-user key resolution
  // for the experimental providerOverride path — not wired into any default-provider selection or
  // real user traffic yet.
  gemini: { metaKey: 'byok_gemini_key', envVar: 'GEMINI_API_KEY' }
}

function ownKey(provider, userId = getCurrentUserId()) {
  const conn = getDbForUser(userId)
  const value = conn.prepare('SELECT value FROM app_meta WHERE key = ?').get(KEYS[provider].metaKey)?.value
  return value || null
}

export const hasOperatorKeyAccess = (userId = getCurrentUserId()) =>
  userId === DEFAULT_USER_ID || isApprovedForOperatorKey(userId)

function resolveKey(provider, userId = getCurrentUserId()) {
  const own = ownKey(provider, userId)
  if (own) return own
  if (!hasOperatorKeyAccess(userId)) return null
  return process.env[KEYS[provider].envVar] || null
}

export const resolveAnthropicKey = (userId = getCurrentUserId()) => resolveKey('anthropic', userId)
export const resolveOpenAiKey = (userId = getCurrentUserId()) => resolveKey('openai', userId)
export const resolveGeminiKey = (userId = getCurrentUserId()) => resolveKey('gemini', userId)

export const hasAnthropicKey = (userId = getCurrentUserId()) => Boolean(resolveAnthropicKey(userId))
export const hasOpenAiKey = (userId = getCurrentUserId()) => Boolean(resolveOpenAiKey(userId))
export const hasGeminiKey = (userId = getCurrentUserId()) => Boolean(resolveGeminiKey(userId))

export function ownKeyStatus(userId = getCurrentUserId()) {
  return {
    hasOwnAnthropicKey: Boolean(ownKey('anthropic', userId)),
    hasOwnOpenAiKey: Boolean(ownKey('openai', userId)),
    hasOwnGeminiKey: Boolean(ownKey('gemini', userId)),
    hasOperatorKeyAccess: hasOperatorKeyAccess(userId)
  }
}

const PROVIDER_LABEL = { anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Gemini' }

// Distinguishes WHY no key resolved, so the error the user sees actually matches their
// situation instead of a generic "ask the operator" that's wrong when the real reason is
// "you haven't been approved yet."
export function noKeyErrorMessage(provider, userId = getCurrentUserId()) {
  const label = PROVIDER_LABEL[provider]
  if (!hasOperatorKeyAccess(userId)) {
    return `You don't have access to the operator's ${label} key yet. Add your own ${label} API key in Settings, or ask the operator to approve your account.`
  }
  return `No ${label} API key available — add your own in Settings, or ask the operator to configure one.`
}

// value === '' clears the stored key (falls back to the operator's, if approved).
export function setOwnKey(provider, value, userId = getCurrentUserId()) {
  const conn = getDbForUser(userId)
  const metaKey = KEYS[provider].metaKey
  if (value) {
    conn.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(metaKey, value)
  } else {
    conn.prepare('DELETE FROM app_meta WHERE key = ?').run(metaKey)
  }
}
