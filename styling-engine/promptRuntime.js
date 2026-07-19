// Spec 32: DB-backed personalized prompts. Spec 33 Part 1: per-user resolved, not
// process-global — with two users in one process, process-global live bindings meant
// user B would get user A's constitution. prompts.js stays pure (templates + generic
// defaults); this module binds the templates to the CURRENT REQUEST's stored profile +
// constitution, cached per user and invalidated by refreshPrompts() on any write.
import { getDbForUser, safeJsonParse } from '../db.js'
import { getCurrentUserId } from '../lib/requestContext.js'
import { buildPrompts, DEFAULT_PROFILE, CONSTITUTION_LAYER_KEYS } from './prompts.js'

export {
  EXPRESSIVE_HIERARCHY_RULES,
  TAG_PIECE_SYSTEM,
  EXTRACT_PIECES_SYSTEM,
  EDITORIAL_IMAGE_BASE_PROMPT,
  EDITORIAL_IMAGE_REALISM_RULE,
  STYLE_SELECTED_ITEM_FEW_SHOTS,
  WHOLE_WARDROBE_OUTFIT_ARCHETYPES,
  OUTFIT_MISSIONS
} from './prompts.js'

export function loadUserProfile(userId = getCurrentUserId()) {
  const conn = getDbForUser(userId)
  const row = key => conn.prepare("SELECT value FROM app_meta WHERE key = ?").get(key)?.value
  const displayName = row('profile_display_name')
  const pronouns = safeJsonParse(row('profile_pronouns'), null)
  return {
    displayName: displayName || DEFAULT_PROFILE.displayName,
    pronouns: pronouns || DEFAULT_PROFILE.pronouns
  }
}

export function loadConstitution(userId = getCurrentUserId()) {
  const conn = getDbForUser(userId)
  const rows = conn.prepare("SELECT layer, body, updated_at FROM style_constitution").all()
  const constitution = {}
  for (const row of rows) {
    if (CONSTITUTION_LAYER_KEYS.includes(row.layer)) constitution[row.layer] = row.body
  }
  return constitution
}

function conjugatePronouns(profile) {
  const plural = Boolean(profile.pronouns?.plural)
  return {
    subject: profile.pronouns?.subject || 'they',
    object: profile.pronouns?.object || 'them',
    possessive: profile.pronouns?.possessive || 'their',
    is: plural ? 'are' : 'is',
    has: plural ? 'have' : 'has',
    does: plural ? 'do' : 'does',
    owns: plural ? 'own' : 'owns'
  }
}

function buildForUser(userId) {
  const profile = loadUserProfile(userId)
  const built = buildPrompts({ profile, constitution: loadConstitution(userId) })
  return { ...built, PROFILE_NAME: profile.displayName, PROFILE_PRONOUNS: conjugatePronouns(profile) }
}

// Per-user cache. A user's prompts are rebuilt on first access after startup or after
// any profile/constitution write (refreshPrompts) — everything else is a cache hit.
const promptsByUser = new Map()

function getUserPrompts(userId) {
  let built = promptsByUser.get(userId)
  if (!built) {
    built = buildForUser(userId)
    promptsByUser.set(userId, built)
  }
  return built
}

export function refreshPrompts(userId = getCurrentUserId()) {
  promptsByUser.set(userId, buildForUser(userId))
}

// The single access point for every personalized prompt/string in the app. Consumers
// read `prompts.STYLIST_SYSTEM`, `prompts.PROFILE_NAME`, etc. — each access resolves
// against the CURRENT request's user, so two concurrent requests for two different
// users never see each other's constitution.
export const prompts = new Proxy({}, {
  get(_target, prop) {
    return getUserPrompts(getCurrentUserId())[prop]
  }
})
