// Spec 32: DB-backed live bindings for the personalized prompts.
// prompts.js stays pure (templates + generic defaults); this module binds the templates
// to the instance's stored profile + constitution and exposes the same export names the
// old constants had, so consumers only change their import path. ESM live bindings mean
// refreshPrompts() (called after any profile/constitution write) propagates to every
// importer without restarts. Global, non-personalized constants are re-exported untouched.
import { db, safeJsonParse } from '../db.js'
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

export function loadUserProfile() {
  const row = key => db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key)?.value
  const displayName = row('profile_display_name')
  const pronouns = safeJsonParse(row('profile_pronouns'), null)
  return {
    displayName: displayName || DEFAULT_PROFILE.displayName,
    pronouns: pronouns || DEFAULT_PROFILE.pronouns
  }
}

export function loadConstitution() {
  const rows = db.prepare("SELECT layer, body, updated_at FROM style_constitution").all()
  const constitution = {}
  for (const row of rows) {
    if (CONSTITUTION_LAYER_KEYS.includes(row.layer)) constitution[row.layer] = row.body
  }
  return constitution
}

export let STYLIST_SYSTEM
export let STYLE_SELECTED_ITEM_SYSTEM
export let COMPARE_OUTFITS_SYSTEM
export let GENERATE_OUTFIT_IDEAS_SYSTEM
export let OUTFIT_COMPOSER_SYSTEM
export let OUTFIT_EVALUATOR_GATE_SYSTEM
export let WHOLE_WARDROBE_EVALUATOR_SYSTEM
export let OUTFIT_BOARD_PLANNER_SYSTEM
export let EDITORIAL_NEW_PIECES_SYSTEM
export let WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM
export let VISUAL_SUPPORT_CRITIC_SYSTEM
export let VISUAL_WARDROBE_CRITIC_SYSTEM
export let TAG_PIECE_PROMPT
export let EDITORIAL_IMAGE_SUBJECT_PROMPT
export let EDITORIAL_IMAGE_SHOES_RULE
export let BODY_CONTRACT
export let PROVEN_FORMULAS
export let AESTHETIC_GRAVITY
export let LANE_NEUTRALITY
export let WORKING_STYLE

// The active profile display name, for runtime strings composed outside prompts.js
// (inline critic systems in core.js, correction messages in provider.js/tools.js,
// exclusion notes in crud.js).
export let PROFILE_NAME
// Conjugated pronoun forms for runtime strings: { subject, object, possessive, is, has, does, owns }.
export let PROFILE_PRONOUNS

export function refreshPrompts() {
  const profile = loadUserProfile()
  const built = buildPrompts({ profile, constitution: loadConstitution() })
  PROFILE_NAME = profile.displayName
  const plural = Boolean(profile.pronouns?.plural)
  PROFILE_PRONOUNS = {
    subject: profile.pronouns?.subject || 'they',
    object: profile.pronouns?.object || 'them',
    possessive: profile.pronouns?.possessive || 'their',
    is: plural ? 'are' : 'is',
    has: plural ? 'have' : 'has',
    does: plural ? 'do' : 'does',
    owns: plural ? 'own' : 'owns'
  }
  STYLIST_SYSTEM = built.STYLIST_SYSTEM
  STYLE_SELECTED_ITEM_SYSTEM = built.STYLE_SELECTED_ITEM_SYSTEM
  COMPARE_OUTFITS_SYSTEM = built.COMPARE_OUTFITS_SYSTEM
  GENERATE_OUTFIT_IDEAS_SYSTEM = built.GENERATE_OUTFIT_IDEAS_SYSTEM
  OUTFIT_COMPOSER_SYSTEM = built.OUTFIT_COMPOSER_SYSTEM
  OUTFIT_EVALUATOR_GATE_SYSTEM = built.OUTFIT_EVALUATOR_GATE_SYSTEM
  WHOLE_WARDROBE_EVALUATOR_SYSTEM = built.WHOLE_WARDROBE_EVALUATOR_SYSTEM
  OUTFIT_BOARD_PLANNER_SYSTEM = built.OUTFIT_BOARD_PLANNER_SYSTEM
  EDITORIAL_NEW_PIECES_SYSTEM = built.EDITORIAL_NEW_PIECES_SYSTEM
  WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM = built.WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM
  VISUAL_SUPPORT_CRITIC_SYSTEM = built.VISUAL_SUPPORT_CRITIC_SYSTEM
  VISUAL_WARDROBE_CRITIC_SYSTEM = built.VISUAL_WARDROBE_CRITIC_SYSTEM
  TAG_PIECE_PROMPT = built.TAG_PIECE_PROMPT
  EDITORIAL_IMAGE_SUBJECT_PROMPT = built.EDITORIAL_IMAGE_SUBJECT_PROMPT
  EDITORIAL_IMAGE_SHOES_RULE = built.EDITORIAL_IMAGE_SHOES_RULE
  BODY_CONTRACT = built.BODY_CONTRACT
  PROVEN_FORMULAS = built.PROVEN_FORMULAS
  AESTHETIC_GRAVITY = built.AESTHETIC_GRAVITY
  LANE_NEUTRALITY = built.LANE_NEUTRALITY
  WORKING_STYLE = built.WORKING_STYLE
}

refreshPrompts()
