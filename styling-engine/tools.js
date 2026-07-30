import path from 'path'
import fs from 'fs'
import { db, userUploadsDir, safeJsonParse } from '../db.js'
import { parsePiece, buildPieceText, pieceOccasionCompatible, wholeWardrobePieceTrustDecision, weatherFitForPiece, getMergedProfileRules, profileRuleFit, resolveRegisterCeiling, weatherProfileFromContext, getOwnerRuleNotes } from './rules.js'
import { prepareImageForClaude, prepareWardrobeThumb } from './provider.js'
import { resolveOccasionProfile } from './occasions.js'
import { resolveActivityProfile } from './footwear-comfort.js'
import { getCurrentWeatherProfile } from './weather.js'
import {
  normalizePlanSlots,
  planTotalOutfitCapForBudget,
  capsuleTotalOutfitCap,
  buildPlanSlotWorkbench,
  validateSubmittedPlanOutfits,
  assembleSubmittedPlanOutfits,
  buildRejectedCapsuleCards,
  describeCapsuleSupplyGap,
  mergePendingPlanForReplan,
  reasonRevisesMidSentence,
  describeCapsuleCompositionShortfall,
  describeCapsuleRosterUtilization,
  completeSubmittedPlanOutfits,
  REASON_REVISION_MESSAGE,
  printPairingSightIssue,
  MIN_ENFORCED_CAPSULE_BUDGET
} from './outfitSetPlanner.js'
import { OCCASION_VALUES, ACTIVITY_VALUES, MISSION_VALUES, normalizeStylingIntent, normalizeActivity, normalizeOccasion } from './stylingIntent.js'
import { bottomKind } from './attributes.js'
import { buildWardrobeManifestLine } from '../src/utils/wardrobeAiContext.js'

// 2026-07-10: mechanical backstop, not just a prompt fix — confirmed live that the model kept passing
// the app's hardcoded "Time zone: America/Los_Angeles" context string as search_wardrobe's `location`
// arg even after STYLIST_SYSTEM was told explicitly not to, and because an explicit tool argument
// always wins over toolContext's server-injected home location, this actively overrode the correct
// value once one was configured. IANA timezone identifiers have a distinctive, mechanically-checkable
// shape (Continent/City_With_Underscores) that no real place name a user or model would supply looks
// like — same "don't trust the model's self-report, verify mechanically" lesson as specs 3/7/11.
export function looksLikeTimezoneIdentifier(value = '') {
  return /^[A-Za-z]+\/[A-Za-z_]+$/.test(String(value || '').trim())
}

export function userExplicitlyRequestedNoRepeat(value = '') {
  const text = String(value || '')
  if (!text.trim()) return false
  return /\b(no[-\s]?repeat|no repeated|not repeat|do not repeat|don't repeat|without repeating)\b/i.test(text) || // ratchet-allow: user constraint text, not garment matching
    /\b(no|don't|do not|without|avoid)\s+(?:any\s+)?(?:repeating|repeated|reusing|reuse|same)\b/i.test(text) // ratchet-allow: user constraint text, not garment matching
}

export function sanitizePlanConstraintsForQuestion(rawConstraints = {}, question = '') {
  const constraints = { ...(rawConstraints || {}) }
  const pieceBudget = Number(constraints.piece_budget) || 0
  const reuseMode = String(constraints.reuse || '').trim().toLowerCase()
  if (pieceBudget > 0 && reuseMode === 'maximize' &&
      Array.isArray(constraints.no_repeat) && constraints.no_repeat.length &&
      !userExplicitlyRequestedNoRepeat(question)) {
    delete constraints.no_repeat
  }
  return constraints
}

export const DEFAULT_SEASONAL_CAPSULE_BUDGET = 24
export const PLAN_KINDS = new Set(['trip', 'seasonal_capsule', 'coordinated_plan'])

export function resolvePlanKind(rawKind = '', question = '') {
  const explicit = String(rawKind || '').trim().toLowerCase()
  if (PLAN_KINDS.has(explicit)) return explicit
  // Intent fallback only. The model-facing schema owns the normal path, but
  // this keeps older clients and malformed tool calls from turning a plainly
  // named capsule into a trip merely because plan_kind was omitted.
  if (/\bcapsule\b/i.test(String(question || ''))) return 'seasonal_capsule' // ratchet-allow: user plan intent, not garment matching
  return 'coordinated_plan'
}

const SEARCH_WARDROBE_VISUAL_CAP = 16
const OCCASION_VALUE_SET = new Set(OCCASION_VALUES)
const SEARCH_QUERY_OCCASION_SYNONYMS = new Map([
  ['dinner', 'evening'],
  ['dining', 'evening'],
  ['restaurant', 'evening'],
  ['wine bar', 'evening'],
  ['theater', 'evening'],
  ['night', 'evening'],
  ['night out', 'evening'],
  ['wedding', 'evening'],
  ['brunch', 'city'],
  ['museum', 'city'],
  ['shopping', 'city'],
  ['office', 'city'],
  ['work', 'city'],
  ['everyday', 'city'],
  ['gallery', 'gallery / art event'],
  ['art event', 'gallery / art event'],
  ['gallery event', 'gallery / art event'],
  ['gallery opening', 'gallery / art event'],
  ['outdoor daytime social', 'outdoor_daytime_social'],
  ['outdoor daytime', 'outdoor_daytime_social'],
  ['daytime social', 'outdoor_daytime_social'],
  ['wine festival', 'outdoor_daytime_social'],
  ['outdoor cafe', 'outdoor_daytime_social'],
  ['picnic', 'outdoor_daytime_social']
])
const PROFILE_TO_CANONICAL_OCCASION = new Map([
  ['city_smart_casual', 'city'],
  ['evening_social', 'evening'],
  ['outdoor_daytime_social', 'outdoor_daytime_social'],
  ['home_loungewear', 'casual']
])

function normalizePieceLookupName(name = '') {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function resolveActivePieceByName(name = '') {
  const exact = db.prepare("SELECT * FROM pieces WHERE status='active' AND name = ?").get(name)
  if (exact) return exact

  const caseInsensitive = db.prepare("SELECT * FROM pieces WHERE status='active' AND lower(name) = lower(?)").get(name)
  if (caseInsensitive) return caseInsensitive

  const normalizedName = normalizePieceLookupName(name)
  if (!normalizedName) return null
  const activePieces = db.prepare("SELECT * FROM pieces WHERE status='active'").all()
  return activePieces.find(piece => normalizePieceLookupName(piece.name) === normalizedName) || null
}

function canonicalOccasionFromQuery(query = '') {
  const raw = String(query || '').toLowerCase().trim()
  if (!raw) return ''
  if (OCCASION_VALUE_SET.has(raw)) return raw
  const synonymOccasion = SEARCH_QUERY_OCCASION_SYNONYMS.get(raw)
  if (synonymOccasion) return synonymOccasion
  const profile = resolveOccasionProfile(raw, '')
  return PROFILE_TO_CANONICAL_OCCASION.get(profile?.id) || ''
}

function isOccasionOnlySearchQuery(query = '') {
  return Boolean(canonicalOccasionFromQuery(query))
}

function shouldBroadenSparseOccasionSearch(occasion = '') {
  const profile = resolveOccasionProfile(occasion, '')
  if (!profile) return true
  const rules = profile.rules || {}
  const hardLists = [
    rules.prohibited_materials,
    rules.prohibited_materials_warm,
    rules.prohibited_footwear,
    rules.prohibited_footwear_summer,
    rules.prohibited_pieces,
    rules.discouraged_pieces
  ]
  return !hardLists.some(list => Array.isArray(list) && list.length > 0)
}

// Spec 3 (freeform observability): per-turn counters accumulated on toolContext across every tool
// call in a chat turn, surfaced by routes/ai.js in the /ask response and logged to
// freeform_generation_runs — the freeform-chat equivalent of the composer's roster debug/excludedCounts.
export function bumpFreeformDiagnostic(toolContext, field, amount = 1) {
  if (!toolContext) return
  if (!toolContext.freeformDiagnostics) {
    toolContext.freeformDiagnostics = {
      searchCalls: 0,
      gateExcludedTotal: 0,
      proposeCalls: 0,
      proposeValidationFails: 0,
      planOutfitSetCalls: 0,
      outfitProseWithoutToolCall: 0,
      zeroResultContradictionBlocks: 0,
      destinationClarificationRetries: 0,
      planSlotEnvironmentInferred: 0,
      planSlotActivityInferred: 0,
      submitPlanCalls: 0,
      submitPlanValidationFails: 0,
      submitPlanResubmits: 0,
      submitPlanPartialAccepts: 0,
      capsuleFinalFallbacks: 0,
      capsuleSupplyGaps: 0,
      capsuleLooksAutoCompleted: 0,
      capsuleRosterModelCalls: 0,
      capsuleRosterModelRepairs: 0,
      capsuleRosterModelFallbacks: 0,
      providerIterations: 0,
      providerInputTokens: 0,
      providerOutputTokens: 0,
      providerCacheReadInputTokens: 0,
      providerCacheCreationInputTokens: 0,
      weatherSource: ''
    }
  }
  toolContext.freeformDiagnostics[field] = (toolContext.freeformDiagnostics[field] || 0) + amount
}

// Spec 4: records whether weather resolved live or fell back to the text heuristic, for spec 3's
// per-turn observability (freeform_generation_runs.weather_source).
export function setFreeformWeatherSource(toolContext, source) {
  if (!toolContext) return
  bumpFreeformDiagnostic(toolContext, 'searchCalls', 0)
  toolContext.freeformDiagnostics.weatherSource = source
}

// Stated weather (this tool call's own weather/season text) wins outright over a
// live location lookup — mirrors outfitSetPlanner.js's resolveSlotWeather
// precedent ("user-stated per-slot weather wins outright... otherwise the
// slot's own live forecast"). Without this, a followup that states NEW weather
// ("add a rainy-day option") on a thread whose home location resolves to
// different live conditions gets silently overridden: live-tested 2026-07-14 —
// search_wardrobe's own weather:"rainy weather" arg was discarded because
// toolContext.location resolved live to sunny/hot LA, and the resulting cached
// profile then made propose_outfit reject the correct rainy-day pieces as "hot
// weather: insulating piece".
export async function resolveStatedOrLiveWeather({ statedWeather = '', date = new Date(), location = '', mood = '', fallbackSeason = '', fetchImpl } = {}) {
  if (statedWeather) {
    // Short-circuits before any geocode/forecast attempt — a stated override must never be
    // silently outvoted by a live lookup for the (possibly unrelated) established location.
    return { ...weatherProfileFromContext({ mood, season: statedWeather }), weatherSource: 'stated' }
  }
  return getCurrentWeatherProfile({ date, location, mood, season: fallbackSeason, ...(fetchImpl ? { fetchImpl } : {}) })
}

export const OUTFIT_ROLES = ['primary_top', 'layer_top', 'primary_bottom', 'layer_bottom', 'dress', 'shoes', 'outerwear', 'accessory']

function requestExclusionReasonsForPiece(piece = {}, requestText = '') {
  const text = String(requestText || '').toLowerCase()
  const reasons = []
  const saysNoShorts = /\b(?:no|without|avoid|skip|exclude)\s+(?:any\s+)?(?:shorts?|skorts?)\b/.test(text) || // ratchet-allow: user request exclusion parsing, not garment matching
    /\b(?:do\s+not|don't)\s+(?:use|include|suggest|show|give me)\s+(?:any\s+)?(?:shorts?|skorts?)\b/.test(text) || // ratchet-allow: user request exclusion parsing, not garment matching
    /\b(?:shorts?|skorts?)\s+(?:are|is)\s+(?:out|off[- ]?limits|not ok|not okay)\b/.test(text) // ratchet-allow: user request exclusion parsing, not garment matching
  if (saysNoShorts && bottomKind(piece) === 'shorts') {
    reasons.push('user request excludes shorts')
  }
  return reasons
}

function freeformOutfitDebugTrace({ resolvedOccasion = '', resolvedActivity = '', requestText = '', mood = '' } = {}) {
  const occasionProfile = resolveOccasionProfile(resolvedOccasion, '')
  const activityProfile = resolveActivityProfile({
    activity: resolvedActivity,
    occasion: resolvedOccasion,
    mood,
    request: requestText
  })
  const registerCeiling = resolveRegisterCeiling({
    occasion: resolvedOccasion,
    activity: resolvedActivity,
    mood,
    request: requestText,
    question: requestText,
    occasionProfile,
    activityProfile
  })
  return {
    resolvedActivity: activityProfile?.id || resolvedActivity || 'none',
    activitySource: resolvedActivity ? 'tool_context' : (activityProfile?.id ? 'request' : 'none'),
    walkable: activityProfile?.id === 'walking' || activityProfile?.id === 'hiking',
    registerCeiling: registerCeiling?.ceiling || registerCeiling || 'none'
  }
}

function layerIntentText(piece = {}) {
  const styleProfile = piece.style_profile_json && typeof piece.style_profile_json === 'object'
    ? JSON.stringify(piece.style_profile_json)
    : piece.style_profile_json
  return [
    piece.name,
    piece.category,
    piece.reads_as,
    piece.garment_type,
    piece.silhouette,
    piece.notes,
    piece.engine_notes,
    styleProfile
  ].filter(Boolean).join(' ').toLowerCase()
}

function hasExplicitTopLayerEvidence(text) {
  return /\b(cardigan|jacket|overshirt|button[- ]?(up|down)|shirt[- ]?jacket|vest|kimono|wrap|coat|blazer)\b/.test(text) || // ratchet-allow: role-intent evidence for layer validation, not garment recommendation matching
    /\b(layering|layer|top layer|overlayer|overlay|over-piece|over piece)\b/.test(text) || // ratchet-allow: role-intent evidence for layer validation, not garment recommendation matching
    /\b(worn|wear)\s+(open|over)\b/.test(text) || // ratchet-allow: role-intent evidence for layer validation, not garment recommendation matching
    /\b(over|on top of)\s+(a\s+)?(tee|t-shirt|t shirt|tank|camisole|base)\b/.test(text) // ratchet-allow: role-intent evidence for layer validation, not garment recommendation matching
}

function isStandaloneBaseTopAsLayer(piece) {
  if (piece.role !== 'layer_top') return false
  const text = layerIntentText(piece)
  const readsLikeBaseTop = /\b(tee|t-shirt|t shirt|crew tee|graphic tee|tank|camisole|cami|shell)\b/.test(text) // ratchet-allow: role-structure validation for tops assigned as layers, not garment recommendation matching
  return readsLikeBaseTop && !hasExplicitTopLayerEvidence(text)
}

function roleCategoryIssue(piece = {}) {
  const role = String(piece.role || '').trim()
  const category = String(piece.category || '').toLowerCase().trim()
  if (!role || !category) return ''
  const expected = {
    primary_top: ['top'],
    layer_top: ['top', 'outerwear'],
    primary_bottom: ['bottom'],
    layer_bottom: ['bottom'],
    dress: ['dress'],
    shoes: ['shoes'],
    outerwear: ['outerwear'],
    accessory: ['accessory']
  }[role]
  if (!expected || expected.includes(category)) return ''
  return `${piece.name || `piece ${piece.id}`} is category "${piece.category}" but was assigned role "${role}"`
}

// Validate an outfit's role structure (roles only, no layerOf). Returns a list of human-readable
// issues; empty means valid. Represents intentional layering as valid (primary_top + layer_top) while
// catching unresolved slot collisions (two primary_top) — the malformed-vs-intentional distinction.
export function validateOutfitRoles(pieces = [], missingGaps = []) {
  const issues = []
  const counts = Object.fromEntries(OUTFIT_ROLES.map(r => [r, 0]))
  for (const p of pieces) {
    if (!OUTFIT_ROLES.includes(p.role)) issues.push(`piece ${p.id} has an invalid or missing role`)
    else counts[p.role] += 1
  }
  if (issues.length) return issues

  // Single-occupancy core slots — a second one is an unresolved collision, not a style choice.
  if (counts.primary_top > 1) issues.push('two primary_top pieces — unresolved top slot (use layer_top for intentional layering)')
  if (counts.primary_bottom > 1) issues.push('two primary_bottom pieces — unresolved bottom slot (use layer_bottom for intentional layering)')
  if (counts.dress > 1) issues.push('two dress pieces — unresolved dress slot')
  if (counts.shoes > 1) issues.push('more than one shoes — unresolved shoes slot')
  // 2026-07-10: this was the one structural gap the whole-wardrobe visual composer's prompt already
  // closed ("EXACTLY one pair of shoes... never omit the slot silently") but freeform chat's
  // propose_outfit never mechanically enforced at all — a zero-shoes outfit passed validation cleanly
  // and rendered as a normal, unflagged card. A missing_gaps note may explain the wardrobe gap, but it
  // must not make an incomplete outfit render as a finished outfit card.
  if (counts.shoes < 1) {
    issues.push('outfit is missing shoes — every proposed outfit card needs actual footwear; missing_gaps may explain the wardrobe gap but cannot satisfy the shoes slot')
  }

  // Core coverage: separates (top+bottom) OR a single dress, and the two are mutually exclusive.
  const hasSeparatesCore = counts.primary_top >= 1 && counts.primary_bottom >= 1
  const hasDressCore = counts.dress === 1
  if (!hasSeparatesCore && !hasDressCore) issues.push('outfit needs a primary_top plus primary_bottom, or a single dress')
  if (counts.dress >= 1 && (counts.primary_top >= 1 || counts.primary_bottom >= 1)) {
    issues.push('a dress cannot be combined with a primary_top/primary_bottom — choose separates or a dress')
  }
  // A layer must have a primary (or dress) to layer with — distinguishes intentional layering from a stray second piece.
  if (counts.layer_top >= 1 && counts.primary_top < 1 && counts.dress < 1) issues.push('layer_top has no primary_top or dress to layer with')
  if (counts.layer_bottom >= 1 && counts.primary_bottom < 1 && counts.dress < 1) issues.push('layer_bottom has no primary_bottom or dress to layer with')
  for (const p of pieces) {
    const categoryIssue = roleCategoryIssue(p)
    if (categoryIssue) issues.push(categoryIssue)
    if (isStandaloneBaseTopAsLayer(p)) {
      issues.push(`${p.name || `piece ${p.id}`} is assigned as layer_top but reads as a standalone top, not a layer`)
    }
  }
  return issues
}

export const STYLIST_TOOLS = [
  {
    name: "declare_intent",
    description: "Declare what this turn should produce, BEFORE composing or answering substantively. Call it first each turn (re-call to update if the goal changes mid-turn). propose_outfit and generate_outfits are blocked until the turn's intent is declared as want:'cards'. The declaration is consumed mechanically: it sets the turn's output contract (e.g. how many cards are owed) instead of keyword-guessing from the user's phrasing.",
    input_schema: {
      type: "object",
      properties: {
        want: { type: "string", enum: ["text", "cards", "image"], description: "What the user's message asks this turn to produce: 'text' = advice/answers/critique in prose; 'cards' = composed outfit cards (via propose_outfit / generate_outfits); 'image' = a rendered outfit image (not available in chat — declare it anyway so the gap is handled honestly)." },
        outfit_count: { type: "integer", minimum: 1, maximum: 5, description: "When want='cards' and the user asked for a specific number of outfits/looks/ideas, that number. Omit if unspecified." },
        turn_mode: { type: "string", enum: ["new_request", "followup", "correction", "explanation", "preference_reaction"], description: "Optional: your read of the conversational turn type, recorded for diagnostics." }
      },
      required: ["want"]
    }
  },
  {
    name: "search_wardrobe",
    description: "Search the wardrobe database for matching active garments. Returns a list of pieces with their ID, name, category, reads_as, visual parameters (pattern, silhouette, fabric, neckline, sleeves, length, hem), and simple notes.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query matching against name or notes" },
        category: { type: "string", enum: ["top", "bottom", "dress", "shoes", "outerwear", "accessory"], description: "Filter by category. Use the exact singular values shown (the manifest's group headers are plural display labels; the data values are these)." },
        color: { type: "string", description: "Filter by color description or reads_as tag" },
        occasion: { type: "string", description: "Filter by occasion (e.g. city, casual, evening)" },
        pattern_type: { type: "string", description: "Filter by pattern type, e.g. solid, floral, stripe, botanical, geometric, abstract, animal, graphic, plaid, other" },
        silhouette: { type: "string", description: "Filter by silhouette type, e.g. fitted, slim, relaxed, boxy, A-line, drop-shoulder, oversized" },
        fabric_weight: { type: "string", description: "Filter by fabric weight, e.g. ultralight, light, medium, heavy" },
        fabric_category: { type: "string", description: "Filter by fabric category, e.g. jersey, knit, linen, silk, satin, cotton, wool, cashmere, viscose, denim, twill, canvas, corduroy, tweed, velvet, leather, suede, ponte, synthetic, fleece, other" },
        neckline: { type: "string", description: "Filter by neckline style, e.g. V, scoop, crew, boat, mock, cowl, off-shoulder, square, wrap, other, none" },
        weather: { type: "string", description: "Established conditions (e.g. hot, highs 80-90F, cold). Ranks and flags results by weather fit; pass it whenever conditions are known." },
        location: { type: "string", description: "City/place if a real destination is known (e.g. a trip). When set, weather is resolved from a live forecast for that place instead of the text-heuristic fallback — pass it whenever a concrete location is established in the conversation." },
        activity: { type: "string", enum: ACTIVITY_VALUES, description: "Established activity (walking/hiking). With occasion, flags pieces by profile-rule fit; pass it whenever known." },
        visual: { type: "boolean", description: "When true, attach low-detail thumbnails for the top ranked matches so you can judge color, texture, print, and proportion by sight. Use before proposing or refining outfits; leave false for quick text lookups." },
        intent: { type: "string", enum: ["compose", "explain"], description: "Default 'compose': pieces that are prohibited for the given occasion/activity are filtered OUT of results, so you compose only from wearable pieces (no need to self-reject anything). Set 'explain' ONLY when the user is asking ABOUT a constraint rather than for outfit material (e.g. 'why can't I wear heels hiking', 'what's wrong with these shoes here') — then prohibited pieces ARE returned, each with its ruleFitLabel, so you can show and explain them." }
      }
    }
  },
  {
    name: "view_pieces",
    description: "Look at specific wardrobe pieces by ID: returns each piece's photo thumbnail plus a compact truth line. This is the cheap, preferred way to satisfy the verification contract — it verifies (and visually verifies) the exact IDs you intend to recommend, including layer/base pieces. Use search_wardrobe when you don't know which IDs you want yet; use get_garment_details only when you need deep styling rules and fit-caution text.",
    input_schema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "integer" }, description: "Wardrobe piece IDs to view (max 12 per call)." },
        size: { type: "string", enum: ["thumb", "large"], description: "thumb (default): quick fit/color/texture read. large: construction detail — weave, lining, sheerness — for layer/base decisions." }
      },
      required: ["ids"]
    }
  },
  {
    name: "render_preview",
    description: "Render an outfit image in the chat (a rough visual preview). Renders a card produced this turn by index, or explicit piece_ids taken from a verified card (e.g. THREAD STATE's current outfit set). Rendering is slow (up to a minute) — settle the outfit first and call this at most once or twice per turn.",
    input_schema: {
      type: "object",
      properties: {
        outfit_index: { type: "integer", description: "1-based index into the outfit cards produced this turn." },
        piece_ids: { type: "array", items: { type: "integer" }, description: "Alternative to outfit_index: explicit wardrobe piece IDs (must be verified this turn or belong to a verified card)." },
        label: { type: "string", description: "Optional title for the rendered image." }
      }
    }
  },
  {
    name: "wardrobe_coverage",
    description: "Exact counts over the active wardrobe grouped by an attribute — for coverage and gap questions ('how many dressy shoes do I own?'). The manifest lists every piece; this gives exact numbers instead of hand-counting.",
    input_schema: {
      type: "object",
      properties: {
        group_by: { type: "string", enum: ["category", "formality", "fabric_weight", "fabric_category", "silhouette", "season", "occasions", "opacity"], description: "Attribute to group counts by. Default: category." },
        category: { type: "string", description: "Optional: restrict counts to one category (e.g. shoes)." }
      }
    }
  },
  {
    name: "get_garment_details",
    description: "Retrieve full detailed styling rules, fit cautions, and AI garment intelligence for specific garment IDs.",
    input_schema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "integer" },
          description: "List of garment IDs to retrieve details for."
        }
      },
      required: ["ids"]
    }
  },
  {
    name: "get_last_outfit_evaluation",
    description: "Retrieve the most recent outfit critique/evaluation notes from database for an outfit ID.",
    input_schema: {
      type: "object",
      properties: {
        outfit_id: { type: "integer", description: "The ID of the outfit." }
      },
      required: ["outfit_id"]
    }
  },
  {
    name: "get_current_image_inventory",
    description: "Retrieve description of currently visible/attached images in the current chat state.",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "store_user_correction",
    description: "Store a DURABLE taste preference or correction the user themselves stated (e.g., 'I do not wear flats'). NEVER store situational or trip facts (this week's weather, a destination, what today's request needs) — those live in THREAD STATE and would wrongly bias every future conversation. If the user didn't say it as a lasting preference, don't store it.",
    input_schema: {
      type: "object",
      properties: {
        note: { type: "string", description: "The user preference or correction text." },
        context_type: { type: "string", description: "Context type: 'outfit' or 'general'" },
        context_id: { type: "integer", description: "Optional outfit ID if context is outfit" }
      },
      required: ["note"]
    }
  },
  {
    name: "generate_outfits",
    description: "Compose fresh visual outfit card options from the saved wardrobe. Use only when the user explicitly asks the system to generate/compose fresh cards from scratch, not for ordinary text styling advice or to show an outfit already discussed.",
    input_schema: {
      type: "object",
      properties: {
        occasion: { type: "string", enum: OCCASION_VALUES, description: "The occasion. Pick the closest allowed value; do not invent. casual/gallery/concert/travel are intentionally permissive." },
        activity: { type: "string", enum: ACTIVITY_VALUES, description: "Physical-demand axis, orthogonal to occasion. Set ONLY when the user changed the physical demand THIS turn. NEVER pass 'none' explicitly to a conversation that established walking/hiking — omit the field and the established activity (see THREAD STATE) carries forward, keeping footwear walkable." },
        season: { type: "string", description: "Season/weather context (e.g. warm, cool, year-round). Infer from the date when not stated." },
        mood: { type: "string", description: "Optional vibe/aesthetic direction only (e.g. artistic minimal, earthy structure). Do NOT put activity here; use the activity parameter." },
        mission: { type: "string", enum: MISSION_VALUES, description: "Styling mission. Default 'mix'." },
        limit: { type: "integer", description: "Maximum number of outfits to generate (1 to 5, default 5)." },
        piece_id: { type: "integer", description: "Optional database ID of a specific garment if styling outfits around that piece. If omitted, generates outfits from the whole wardrobe." }
      },
      required: ["occasion", "season"]
    }
  },
  {
    name: "plan_outfit_set",
    description: "Compose a coordinated SET of outfits across multiple use-case slots under shared constraints — capsules, trip packing, multi-day plans, event weekends. YOU decompose the request into slots (that's judgment: 'mainly wineries, hiking, maybe the coast' → winery days + dinner + hike + optional coast day). Enforced capsules are composed atomically inside this tool from their fixed roster and return finished cards plus any honest gaps; do not call submit_plan_outfits afterward. Other plans return slot rosters for YOU to compose and submit once with submit_plan_outfits. Requires declare_intent want:'cards' first. Use this for multi-slot planning turns; use propose_outfit for one specific outfit and generate_outfits for a single-context batch.",
    input_schema: {
      type: "object",
      properties: {
        plan_kind: {
          type: "string",
          enum: ["trip", "seasonal_capsule", "coordinated_plan"],
          description: "The objective, inferred from ordinary user language. Use 'seasonal_capsule' for a season-long wardrobe core, including a simple request such as 'I want a summer capsule'; use 'trip' for destination packing even when the trip has a piece limit; use 'coordinated_plan' for work weeks, event weekends, and other multi-outfit sets."
        },
        slots: {
          type: "array",
          description: "The plan's use-case slots, in wearing order. Estimate recurring instances (e.g. 3 winery days) and set count so a few distinct looks rotate through recombination; one-off use cases usually get count 1. A capsule shows a representative rotation, never every possible combination: the total card cap is min(piece_budget, 12). Keep compact/travel capsules around 6-8 cards and larger seasonal capsules around 8-12 cards.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Short user-facing slot label (e.g. 'Winery Days', 'Dinner Out', 'Coastal Day')." },
              // Owner ruling 2026-07-30: evening is dressier than a restaurant. An
              // ordinary restaurant dinner reads smart casual, or maybe city. This
              // description previously said to map dinner and evening-restaurant use
              // cases to 'evening', which contradicted the engine's own occasion
              // profiles — `city_smart_casual` lists `dinner` and `museum` among its
              // keywords (ceiling elevated), while `evening_social` lists `dinner date,
              // wine bar, theater, night out` (ceiling dressy). Following the old
              // wording pushed a restaurant slot to a dressy ceiling the owner does not
              // want. Unratified scaffolding from PR #58, not a ruling.
              occasion: { type: "string", enum: OCCASION_VALUES, description: "This slot's occasion. An ordinary restaurant dinner or a night out that is not dressy is 'smart casual' (or 'city'); reserve 'evening' for genuinely dressier night-out use cases — a dinner date, wine bar, theater, cocktails." },
              activity: { type: "string", enum: ACTIVITY_VALUES, description: "Physical-demand axis for this slot — drives footwear rules. Use 'walking' for all-day city/sightseeing slots; 'none' for dinners unless the user says otherwise." },
              environment: { type: "string", enum: ["indoor", "outdoor", "beach_coastal"], description: "The slot's physical setting. Use 'beach_coastal' for beach, pool, seaside, or coastal-outing slots; it drives sand/water/wind handling and overrides contradictory weather:'indoor'. Use 'indoor' for climate-controlled slots (offices, restaurants, galleries). Omit when unsure; outdoor is the default." },
              count: { type: "integer", minimum: 1, maximum: 3, description: "Distinct outfits to compose for this slot. Default 1." },
              weather: { type: "string", description: "This slot's known weather/context when it should override the outdoor forecast. Use `indoor` for climate-controlled slots such as office/work days, client meetings, indoor events, and restaurants, so outdoor heat/cold does not drive the outfit. For a slot at a different outdoor place — a cooler coastal day — set `location` instead and let the live forecast catch it. Omit to use the forecast." },
              location: { type: "string", description: "This slot's location if it differs from the plan location (e.g. 'drive to the coast' → 'Cambria, CA'). Free text, geocoded for a live per-slot forecast — this is how microclimates get caught. Omit to inherit the plan location." },
              date: { type: "string", description: "This slot's specific date as YYYY-MM-DD, when it maps to one day (e.g. the Thursday of a work week), so its own forecast is used rather than the range average. Omit to inherit the plan date_range." },
              // Live thread_1785380251549: the plan's lifestyle answer listed
              // three distinct contexts — days at home, errands, weekends out —
              // and the model gave all three `occasion: casual`, so a going-out
              // slot inherited a stay-at-home register. The old wording is why:
              // it framed this field as an event-weekend escalation tool
              // ("rehearsal dinner", "wedding ceremony") and then said to omit
              // it for ordinary slots, so the model never reached for it.
              //
              // The asymmetry that makes 'elevated' safe to encourage is real
              // and was verified in the code: the per-look register FLOOR only
              // applies at `dressy` or above (validateSlotOutfitConstraints
              // checks `floorRank >= formalityRank('dressy')`). So 'elevated'
              // raises the ceiling and demands nothing — permission, not
              // obligation — while 'dressy'/'formal' additionally require a
              // dressy-or-better main piece in every look of that slot.
              register: { type: "string", enum: ["everyday", "elevated", "dressy", "formal"], description: "How dressed-up this slot should read, when that differs from what its occasion implies. Set it whenever one slot in the plan reads dressier than its neighbours — a going-out version of an otherwise casual week ('elevated'), or escalation across an event weekend so the marquee slot is dressiest (rehearsal dinner 'dressy', wedding ceremony 'formal'). 'elevated' only widens what the slot may use and requires nothing; 'dressy'/'formal' additionally require every look in the slot to carry a dressy-or-better main piece, and push away denim, casual jackets, tees and sneakers toward tailored separates or a dress with heels. Omit only when the slot's occasion already describes how dressed-up it is." },
              best_for: { type: "string", description: "The specific use case this slot covers (defaults to the label)." },
              plan_note: { type: "string", description: "Optional one-sentence composer guidance for this slot." }
            },
            required: ["label", "occasion", "activity"]
          }
        },
        constraints: {
          type: "object",
          description: "Shared rules across the whole set. Set these from the objective: packing wants reuse maximized; an at-home work week wants looks diversified (repeats are the failure there, not the win).",
          properties: {
            reuse: { type: "string", enum: ["maximize", "diversify", "none"], description: "The reuse dial. 'maximize' for packing (recombine a few pieces — fewer to carry). 'diversify' for at-home multi-day plans (fresh looks each day). 'none' or omit for no cross-slot preference." },
            no_repeat: { type: "array", items: { type: "string" }, description: "Category groups whose pieces must NOT repeat across the set — e.g. ['tops'] for a work week so no shirt is worn twice. Groups: tops, bottoms, dresses, outerwear (or 'layers'), shoes, accessories." },
            allow_repeat: { type: "array", items: { type: "string" }, description: "Category groups explicitly allowed to repeat even when diversifying — e.g. ['shoes'] since the same shoes across a week is normal. Overrides no_repeat for that group." },
            shared_anchor_ids: { type: "array", items: { type: "integer" }, description: "Wardrobe piece IDs to pin across the set — e.g. styling several outfits around one new piece. Anchors recur in every slot they fit and are exempt from no_repeat." },
            piece_budget: { type: "integer", minimum: 1, description: "Max distinct pieces the whole set may draw on — the headline for a capsule ('10-piece capsule'). The plan report then leads with the piece roster and how many outfits it yields, and flags if the set went over budget." }
          }
        },
        weather: { type: "string", description: "Plan-level known weather/context used as the fallback for slots that omit their own weather. Use this for user-stated conditions such as 'warm summer weather'. Slot-level weather still wins for indoor or special-case slots." },
        location: { type: "string", description: "The plan's overall location/destination (e.g. 'Paso Robles, CA'), geocoded for the per-slot live forecast. Slots inherit it unless they set their own `location`. Omit for at-home plans with no travel." },
        date_range: {
          type: "object",
          description: "The plan's date window, so each slot's forecast is fetched for the right days. Provide when the dates are known (a trip, a specific work week).",
          properties: {
            start: { type: "string", description: "First day, YYYY-MM-DD." },
            end: { type: "string", description: "Last day, YYYY-MM-DD (defaults to start for a single day)." }
          }
        },
        duration_text: { type: "string", description: "Stated or inferred plan duration (e.g. '5 days'), when known — shown as the plan's duration line." },
        day_breakdown: { type: "string", description: "Short natural breakdown of recurring day/evening needs — shown as the plan's 'Coverage' line." }
      },
      required: ["plan_kind", "slots"]
    }
  },
  {
    name: "submit_plan_outfits",
    description: "Submit the outfits you composed for this turn's plan_outfit_set slot rosters. ONE call carrying every slot that still needs an outfit. Each outfit must use piece IDs only from that slot's allowed roster.",
    input_schema: {
      type: "object",
      properties: {
        outfits: {
          type: "array",
          description: "Outfits composed from the pending plan_outfit_set slot rosters. Submit all slots in the first call; after a validation_error, resubmit only failed slots.",
          items: {
            type: "object",
            properties: {
              slot_id: { type: "string", description: "The slot id returned by plan_outfit_set." },
              piece_ids: { type: "array", items: { type: "integer" }, description: "Wardrobe piece IDs chosen only from that slot's allowed piece list." },
              title: { type: "string", description: "Optional short card title." },
              reason: { type: "string", description: "Optional one-sentence styling rationale." }
            },
            required: ["slot_id", "piece_ids"]
          }
        }
      },
      required: ["outfits"]
    }
  },
  {
    name: "propose_outfit",
    description: "Propose (or show/render) ONE complete, coherent outfit from verified wardrobe pieces, rendered as a card. Call 'search_wardrobe' first to get real piece IDs, then pass those IDs here — never names, never prose outfit sections. Call once per outfit; write conversational prose (intro, transitions, follow-up questions) around the call, but put the outfit's actual pieces in this tool, not in text. This is ONE wearable outfit — at most one primary_top (or one dress), one primary_bottom, and one shoes. NEVER pass multiple pieces of the same role to show a group of options or a capsule roster (e.g. five shoes, or seven tops, all in one call): that is not an outfit, it will be rejected. To present alternatives or a roster, describe them in prose, or re-run the set tool ('plan_outfit_set') — do not pile same-role pieces into one card.",
    input_schema: {
      type: "object",
      properties: {
        pieces: {
          type: "array",
          description: "The outfit's pieces, each a verified wardrobe piece ID plus its structural role.",
          items: {
            type: "object",
            properties: {
              id: { type: "integer", description: "Wardrobe piece ID from search_wardrobe." },
              role: { type: "string", enum: OUTFIT_ROLES, description: "Structural role. Core = primary_top + primary_bottom, OR a single dress. Use layer_top/layer_bottom for INTENTIONAL layering (e.g. a base layer under a sheer top, shorts under a skirt) — not a second competing top/bottom. outerwear/accessory are add-ons. Exactly one shoes, at most one of each primary slot." },
              anchor: { type: "boolean", description: "Set true ONLY when the user explicitly asked to style/wear THIS piece this turn. An anchor is the outfit's premise: it bypasses auto-use trust/weather/register gating (the user's request overrides suitability rules). Supporting pieces stay fully gated. Never mark a piece the user did not ask about." }
            },
            required: ["id", "role"]
          }
        },
        label: { type: "string", description: "Creative outfit title." },
        occasion_context: { type: "string", description: "The occasion / vibe / style lane this outfit is for." },
        why_it_works: { type: "string", description: "Brief styling rationale." },
        missing_gaps: { type: "array", items: { type: "string" }, description: "Slots the wardrobe can't fill (e.g. 'lightweight rain shell'). List the gap here instead of inventing a piece." },
        occasion: { type: "string", enum: OCCASION_VALUES, description: "Occasion for card context. Optional." },
        season: { type: "string", description: "Season/weather context. Optional. For indoor occasions (office, restaurant, meeting, gallery), pass season:'indoor' — the live forecast applies only to time spent outdoors." },
        activity: { type: "string", enum: ACTIVITY_VALUES, description: "Physical-demand axis for card context. Optional; omit to carry forward the established activity." }
      },
      required: ["pieces"]
    }
  }
]

// Category values in the db are singular ('top', not 'tops'). Models naturally
// write plurals; an exact-match SQL filter then silently returns zero rows and
// the model reports a fake wardrobe gap (live-tested 2026-07-12: category
// "tops" → 0 items while "top" → 45). Normalize the common shapes.
const CATEGORY_ALIASES = {
  top: 'top', tops: 'top',
  bottom: 'bottom', bottoms: 'bottom', pants: 'bottom',
  dress: 'dress', dresses: 'dress',
  shoes: 'shoes', shoe: 'shoes',
  outerwear: 'outerwear', jackets: 'outerwear', jacket: 'outerwear',
  accessory: 'accessory', accessories: 'accessory',
}

export function normalizeCategoryFilter(value) {
  const key = String(value || '').toLowerCase().trim()
  if (!key) return { category: null, unknown: false }
  const canonical = CATEGORY_ALIASES[key]
  return canonical ? { category: canonical, unknown: false } : { category: key, unknown: true }
}

// Per-turn retrieval tracking (step 3 of the freeform "router → stylist" migration):
// tools record which piece ids the model has retrieved this turn, and which of
// those it has actually SEEN (photo attached). propose_outfit and the prose
// citation check enforce against these sets — the wardrobe manifest is an index,
// not garment truth.
export function recordRetrievedPieces(toolContext = {}, ids = [], { seen = false } = {}) {
  if (!toolContext || typeof toolContext !== 'object') return
  if (!(toolContext.retrievedPieceIds instanceof Set)) toolContext.retrievedPieceIds = new Set()
  if (!(toolContext.visuallySeenPieceIds instanceof Set)) toolContext.visuallySeenPieceIds = new Set()
  for (const raw of ids) {
    const id = Number(raw)
    if (!Number.isFinite(id) || id <= 0) continue
    toolContext.retrievedPieceIds.add(id)
    if (seen) toolContext.visuallySeenPieceIds.add(id)
  }
}

export function verifiedPieceIdSets(toolContext = {}) {
  const retrieved = toolContext?.retrievedPieceIds instanceof Set ? toolContext.retrievedPieceIds : new Set()
  const seen = toolContext?.visuallySeenPieceIds instanceof Set ? toolContext.visuallySeenPieceIds : new Set()
  const known = new Set([
    ...(Array.isArray(toolContext?.generatedOutfits) ? toolContext.generatedOutfits : [])
      .flatMap(outfit => Array.isArray(outfit?.pieceIds) ? outfit.pieceIds : []),
    ...(Array.isArray(toolContext?.knownOutfitPieceIds) ? toolContext.knownOutfitPieceIds : []),
  ].map(Number).filter(Number.isFinite))
  return { retrieved, seen, known }
}

// Part 3 (spec 18): the model has been observed sending plan_outfit_set's
// `slots` as a JSON-encoded STRING with the sibling plan fields flattened
// into that same string — e.g. `slots: "[ {...}, {...} ],\n\"location\":
// \"Paso Robles, CA\", ..."` (the whole remaining args object, minus its own
// key, dumped after the array). Recovers the array (and any flattened
// sibling keys) before falling through to the "needs at least one slot"
// rejection. Returns null when neither shape parses.
export function coercePlanOutfitSetSlotsArg(rawSlots) {
  if (typeof rawSlots !== 'string') return null
  try {
    const parsed = JSON.parse(rawSlots)
    if (Array.isArray(parsed)) return { slots: parsed, extra: {} }
  } catch { /* fall through to the flattened-siblings recovery below */ }
  try {
    const wrapped = JSON.parse(`{"slots":${rawSlots}}`)
    if (wrapped && Array.isArray(wrapped.slots)) {
      const { slots, ...extra } = wrapped
      return { slots, extra }
    }
  } catch { /* unrecoverable — caller keeps the existing validation error */ }
  return null
}

export function coerceSubmitPlanOutfitsArg(rawOutfits) {
  if (Array.isArray(rawOutfits)) return rawOutfits
  if (typeof rawOutfits !== 'string') return null
  try {
    const parsed = JSON.parse(rawOutfits)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function logAgentToolResult(name, result) {
  if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'production') return
  const summary = { status: result?.status, message: result?.message }
  if (result?.failures) summary.failures = result.failures
  if (result?.error) summary.error = result.error
  console.log(`[Agent Tool Result] ${name}`, JSON.stringify(summary, null, 2))
}

export async function executeTool(name, args, toolContext = {}) {
  console.log(`\n🤖 [Agent Tool Call] ${name} (${JSON.stringify(args)})`)
  try {
    const result = await executeToolInternal(name, args, toolContext)
    logAgentToolResult(name, result)
    return result
  } catch (err) {
    console.error(`Error executing tool ${name}:`, err)
    const result = { error: err.message }
    logAgentToolResult(name, result)
    return result
  }
}

async function executeToolInternal(name, args, toolContext = {}) {
  switch (name) {
      case 'declare_intent': {
        // Step 4 (model-declared intent): the model states what this turn should
        // produce; guards and composing tools consume this instead of keyword-
        // guessing from the user's phrasing. Executed locally — no model cost.
        // Re-declaring mid-turn is allowed; the last declaration wins.
        const want = ['text', 'cards', 'image'].includes(args?.want) ? args.want : null
        if (!want) {
          return { status: "validation_error", message: "declare_intent needs want: 'text', 'cards', or 'image'." }
        }
        const rawCount = Number(args?.outfit_count)
        const outfitCount = Number.isInteger(rawCount) && rawCount >= 1 && rawCount <= 5 ? rawCount : null
        const turnMode = ['new_request', 'followup', 'correction', 'explanation', 'preference_reaction'].includes(args?.turn_mode)
          ? args.turn_mode
          : null
        toolContext.declaredIntent = { want, outfitCount, turnMode }
        bumpFreeformDiagnostic(toolContext, 'intentDeclared')
        if (want === 'cards') {
          const seededCount = Array.isArray(toolContext.generatedOutfits) ? toolContext.generatedOutfits.filter(o => !o?.broken).length : 0
          return {
            status: "success",
            message: `Intent recorded: cards${outfitCount ? ` (${outfitCount} outfits owed)` : ''}. ${seededCount ? `NOTE: ${seededCount} verified card${seededCount === 1 ? ' is' : 's are'} ALREADY composed for this turn — present those as the answer and propose additional cards ONLY for a need the user asked for that they do not cover. ` : ''}Contract: for a SINGLE outfit or a small fixed set, every card goes through propose_outfit with piece IDs verified this turn (view_pieces / search_wardrobe / get_garment_details); layer pieces must have been SEEN (photo attached — view_pieces is the cheap way). For a multi-slot plan (a trip, capsule, work week, or any request spanning several use cases), call plan_outfit_set ONCE instead — its cards already satisfy this contract; do NOT also call propose_outfit to rebuild or top up that same set, even if its total is less than what you'd otherwise deliver via propose_outfit (a shortfall there means a real cap or wardrobe gap, which plan_outfit_set's own plan_lines already disclose — do not paper over it with hand-composed cards). A plan_outfit_set success response, even one whose plan_lines list gap/trim disclosures, is a COMPLETE answer: you MUST present its cards plus those plan_lines verbatim — never discard the cards and fall back to a text-only explanation instead (a partial set with honest disclosed gaps is the correct outcome, not a failure to talk your way around). Only skip cards entirely if plan_outfit_set itself returned status:"error" (zero outfits composed). ${outfitCount ? `Do not finish with fewer than ${outfitCount} complete cards without explaining the wardrobe gap.` : ''}`
          }
        }
        if (want === 'image') {
          return {
            status: "success",
            message: "Intent recorded: image. Call render_preview({ outfit_index }) for a card produced this turn, or render_preview({ piece_ids }) with IDs from a verified card (e.g. THREAD STATE's current outfit set). Settle which outfit to render first; rendering is slow, so call it once."
          }
        }
        return { status: "success", message: "Intent recorded: text. Answer conversationally; cite any wardrobe pieces as (ID <n>) and verify them this turn before recommending." }
      }
      case 'search_wardrobe': {
        const { query, color, occasion, pattern_type, silhouette, fabric_weight, fabric_category, neckline, weather: weatherText, activity, visual, intent, location } = args
        const { category, unknown: unknownCategory } = normalizeCategoryFilter(args.category)
        if (unknownCategory) {
          return [{ note: `Unknown category "${args.category}" — no filter applied would lie about the wardrobe. Valid categories: top, bottom, dress, shoes, outerwear, accessory. Re-run the search with one of these.` }]
        }
        let sql = "SELECT * FROM pieces WHERE status = 'active'"
        const params = []
        if (category) {
          sql += " AND category = ?"
          params.push(category)
        }
        if (pattern_type) {
          sql += " AND pattern_type = ?"
          params.push(pattern_type)
        }
        if (silhouette) {
          sql += " AND silhouette = ?"
          params.push(silhouette)
        }
        if (fabric_weight) {
          sql += " AND fabric_weight = ?"
          params.push(fabric_weight)
        }
        if (fabric_category) {
          sql += " AND fabric_category = ?"
          params.push(fabric_category)
        }
        if (neckline) {
          sql += " AND neckline = ?"
          params.push(neckline)
        }
        const rows = db.prepare(sql).all(...params).map(parsePiece)
        
        let filtered = rows
        if (color) {
          const cLower = color.toLowerCase()
          filtered = filtered.filter(p => 
            (p.reads_as && p.reads_as.toLowerCase().includes(cLower)) || 
            p.colors.some(c => c.toLowerCase().includes(cLower))
          )
        }
        let fallbackNote = ''
        if (occasion) {
          const beforeOccasionFilter = filtered
          const occasionFiltered = filtered.filter(p => {
            if (!pieceOccasionCompatible(p, occasion)) return false
            const trust = wholeWardrobePieceTrustDecision(p, { occasion })
            return trust.allowed
          })
          if (occasionFiltered.length) {
            filtered = occasionFiltered
          } else {
            filtered = beforeOccasionFilter
            fallbackNote = `No active pieces are explicitly tagged for "${occasion}"; showing flexible active wardrobe pieces instead, with ruleFit/weatherFit annotations for the requested context.`
          }
        }
        if (query) {
          const qLower = query.toLowerCase()
          const queryOccasion = isOccasionOnlySearchQuery(query) ? canonicalOccasionFromQuery(query) : ''
          if (queryOccasion) {
            const beforeOccasionQueryFilter = filtered
            const occasionQueryFiltered = filtered.filter(p => pieceOccasionCompatible(p, queryOccasion))
            if (occasionQueryFiltered.length || !shouldBroadenSparseOccasionSearch(queryOccasion)) {
              filtered = occasionQueryFiltered
            } else {
              filtered = beforeOccasionQueryFilter
              fallbackNote = `No active pieces are explicitly tagged for "${queryOccasion}"; showing flexible active wardrobe pieces instead, with ruleFit/weatherFit annotations for the requested context.`
            }
          } else {
            filtered = filtered.filter(p => 
              p.name.toLowerCase().includes(qLower) || 
              (p.notes && p.notes.toLowerCase().includes(qLower))
            )
          }
        }

        let excludedCount = 0
        let gateExcludedCount = 0
        let requestExcludedCount = 0
        if (toolContext && toolContext.allowedPieceIds) {
          const allowedSet = toolContext.allowedPieceIds instanceof Set 
            ? toolContext.allowedPieceIds 
            : new Set(Array.isArray(toolContext.allowedPieceIds) ? toolContext.allowedPieceIds.map(Number) : [])
          
          const beforeFilterLength = filtered.length
          filtered = filtered.filter(p => allowedSet.has(Number(p.id)))
          excludedCount = beforeFilterLength - filtered.length
        }
        
        let results = filtered
        // Spec 4: THIS call's own `weather` arg is a stated override and wins outright (see
        // resolveStatedOrLiveWeather above); otherwise live weather when a real location is known
        // (this call's arg or carried over on toolContext from earlier in the turn), with a
        // resilient fallback to the text heuristic — profileRuleFit/weatherFitForPiece consume the
        // same {isHot, isCold} shape either way. The model's own `location` arg is discarded if
        // it's timezone-shaped rather than a real place — see looksLikeTimezoneIdentifier above —
        // falling back to the server-injected home location (toolContext.location) instead, which
        // is never timezone-shaped itself.
        const safeModelLocation = looksLikeTimezoneIdentifier(location) ? '' : (location || '')
        const resolvedWeather = await resolveStatedOrLiveWeather({
          statedWeather: weatherText || '',
          date: toolContext.currentDate ? new Date(toolContext.currentDate) : new Date(),
          location: safeModelLocation || toolContext.location || '',
          mood: toolContext.mood || '',
          fallbackSeason: toolContext.weather || toolContext.season || ''
        })
        if (toolContext) {
          toolContext.weatherProfile = resolvedWeather
          if (weatherText) {
            toolContext.weather = String(weatherText)
          }
        }
        setFreeformWeatherSource(toolContext, resolvedWeather.weatherSource)
        if (resolvedWeather.isHot || resolvedWeather.isCold) {
          results = results
            .map(p => {
              const fit = weatherFitForPiece(p, resolvedWeather)
              return { ...p, weatherFit: fit.label, weatherFitScore: fit.score }
            })
            .sort((a, b) => (b.weatherFitScore || 0) - (a.weatherFitScore || 0))
        }

        const resolvedOccasion = occasion || toolContext.occasion || ''
        const resolvedActivity = activity !== undefined && activity !== null && activity !== ''
          ? normalizeActivity(activity)
          : (toolContext.activity || '')
        if (toolContext) {
          if (resolvedOccasion) toolContext.occasion = resolvedOccasion
          if (resolvedActivity) toolContext.activity = resolvedActivity
        }
        const requestText = [
          toolContext.request,
          toolContext.question,
          toolContext.mission,
          query,
          toolContext.mood
        ].filter(Boolean).join(' ')
        if (requestText) {
          const beforeRequestExclusions = results.length
          results = results.filter(p => requestExclusionReasonsForPiece(p, requestText).length === 0)
          requestExcludedCount = beforeRequestExclusions - results.length
        }
        const occasionProfile = resolveOccasionProfile(resolvedOccasion, '')
        const activityProfile = resolveActivityProfile({ activity: resolvedActivity })
        if (occasionProfile || activityProfile) {
          const mergedRules = getMergedProfileRules(occasionProfile, activityProfile)
          // Resolve the register ceiling once per call (matching the composer), then let profileRuleFit
          // apply the footwear-enum + register gates per piece. Passing activityProfile/registerCeiling
          // switches profileRuleFit into enum-gate mode for this consumer.
          const registerCeiling = resolveRegisterCeiling({
            occasion: resolvedOccasion,
            activity: resolvedActivity,
            mood: toolContext.mood || '',
            request: toolContext.request || toolContext.question || toolContext.mission || '',
            question: query || toolContext.question || '',
            occasionProfile,
            activityProfile
          })
          const tierRank = { preferred: 0, neutral: 1, discouraged: 2, prohibited: 3 }
          results = results
            .map(p => {
              const fit = profileRuleFit(p, mergedRules, { weatherProfile: resolvedWeather, occasionProfile, activityProfile, registerCeiling })
              return { ...p, ruleFit: fit.tier, ruleFitLabel: fit.label }
            })
            .sort((a, b) => (tierRank[a.ruleFit] ?? 1) - (tierRank[b.ruleFit] ?? 1))

          // Compose mode (default): exclude prohibited-tier pieces entirely so the model composes
          // only from wearable pieces (matching the composer roster's discipline). Explain mode keeps
          // them, annotated, because showing-and-explaining the constraint is the point of that query.
          // discouraged/unknown stay in both modes — legitimate judgment calls, not hard exclusions.
          if (intent !== 'explain') {
            const beforeGate = results.length
            results = results.filter(p => p.ruleFit !== 'prohibited')
            gateExcludedCount = beforeGate - results.length
          }
        }
        
        console.log(`🔍 [Agent Tool Call] search_wardrobe returned ${results.length} items.`)
        const resultList = await Promise.all(results.map(async (p, index) => {
          let image = null
          if (visual && index < SEARCH_WARDROBE_VISUAL_CAP) {
            const photoFile = p.worn_photo || p.photo || ''
            if (photoFile) {
              const filePath = path.join(userUploadsDir(), photoFile)
              if (fs.existsSync(filePath)) {
                try {
                  const thumb = await prepareWardrobeThumb(filePath, `${p.id}:${photoFile}`)
                  image = {
                    mime: thumb.media_type,
                    base64: thumb.data
                  }
                } catch (err) {
                  console.error(`Error loading thumbnail for piece ${p.id}:`, err)
                }
              }
            }
          }
          return {
            id: p.id,
            name: p.name,
            category: p.category,
            reads_as: p.reads_as,
            colors: p.colors,
            occasions: p.occasions,
            pattern_type: p.pattern_type,
            pattern_scale: p.pattern_scale,
            pattern_complexity: p.pattern_complexity,
            silhouette: p.silhouette,
            fabric_category: p.fabric_category,
            fabric_weight: p.fabric_weight,
            opacity: p.opacity,
            needs_base: p.needs_base,
            neckline: p.neckline,
            sleeve_type: p.sleeve_type,
            length_hits_at: p.length_hits_at,
            hem_finish: p.hem_finish,
            weatherFit: p.weatherFit,
            ruleFit: p.ruleFit,
            ruleFitLabel: p.ruleFitLabel,
            notes: p.notes ? p.notes.slice(0, 120) : '',
            ...(image ? { image } : {})
          }
        }))

        if (fallbackNote) {
          resultList.push({ note: fallbackNote })
        }

        if (excludedCount > 0) {
          resultList.push({
            note: `(${excludedCount} pieces hidden: unavailable for this occasion/weather)`
          })
        }

        if (gateExcludedCount > 0) {
          resultList.push({
            note: `(${gateExcludedCount} piece(s) filtered out as prohibited for this occasion/activity; re-query with intent:'explain' to see and discuss them)`
          })
        }

        if (requestExcludedCount > 0) {
          resultList.push({
            note: `(${requestExcludedCount} piece(s) hidden because they conflict with the user's stated request)`
          })
        }

        bumpFreeformDiagnostic(toolContext, 'searchCalls')
        if (gateExcludedCount > 0) bumpFreeformDiagnostic(toolContext, 'gateExcludedTotal', gateExcludedCount)
        if (requestExcludedCount > 0) bumpFreeformDiagnostic(toolContext, 'gateExcludedTotal', requestExcludedCount)

        recordRetrievedPieces(toolContext, resultList.filter(item => item.id).map(item => item.id))
        recordRetrievedPieces(toolContext, resultList.filter(item => item.image).map(item => item.id), { seen: true })

        // Spec 3 Part 0b: a free-text named-garment query that returned nothing is a known-false claim
        // waiting to happen — track it so the final answer can be checked for describing it as real.
        if (query && !results.length && toolContext) {
          if (!Array.isArray(toolContext.zeroResultQueries)) toolContext.zeroResultQueries = []
          toolContext.zeroResultQueries.push(String(query))
        }

        return resultList
      }
      case 'propose_outfit': {
        const { pieces = [], label = '', occasion_context = '', why_it_works = '', missing_gaps = [], occasion, season, activity } = args
        const rawPieces = Array.isArray(pieces) ? pieces : []
        if (!rawPieces.length) {
          return { status: "validation_error", message: "propose_outfit needs at least one piece, each with an id and a role.", issues: ["no pieces provided"] }
        }

        // Resolve each {id, role} to a verified active wardrobe piece (IDs, not names — the model has
        // real IDs from search_wardrobe, so there is no name-matching seam to fall into).
        const resolved = []
        const unresolvedIds = []
        for (const entry of rawPieces) {
          const id = Number(entry?.id)
          const role = String(entry?.role || '').trim()
          if (!Number.isFinite(id)) { unresolvedIds.push(entry?.id ?? null); continue }
          const row = db.prepare("SELECT * FROM pieces WHERE id = ? AND status = 'active'").get(id)
          if (!row) { unresolvedIds.push(id); continue }
          resolved.push({ ...parsePiece(row), role, anchor: entry?.anchor === true })
        }
        if (unresolvedIds.length) {
          return {
            status: "error",
            message: "One or more piece IDs did not resolve to an active wardrobe item. Re-check via search_wardrobe before proposing.",
            unresolvedIds
          }
        }

        // Contract gates (steps 3+4), checked TOGETHER so the model learns every
        // blocker in ONE bounce — live-tested 2026-07-12: sequential early returns
        // burned three loop iterations (intent, then retrieval, then gate) and the
        // turn died at the iteration cap with zero cards.
        const contractIssues = []
        if (toolContext.declaredIntent?.want !== 'cards') {
          bumpFreeformDiagnostic(toolContext, 'composeWithoutDeclaredIntent')
          contractIssues.push("declare intent first: call declare_intent({ want: 'cards', outfit_count: <n if the user asked for a number> })")
        }
        // Mechanical gate (2026-07-14): prompt wording alone (declare_intent's and
        // plan_outfit_set's own contract text) did not reliably stop the model from
        // calling plan_outfit_set once and then hand-composing every card anyway via
        // propose_outfit — live-tested three times same day, reproduced twice even
        // after two rounds of stronger wording. This turn already has plan_outfit_set
        // cards locked in as the source; block propose_outfit from duplicating them,
        // the same way unverified pieces or missing declared intent are blocked
        // mechanically rather than left to prompt compliance.
        if (toolContext.source === 'plan_outfit_set' && toolContext.sourceLocked &&
            Array.isArray(toolContext.generatedOutfits) &&
            toolContext.generatedOutfits.some(o => o?.source === 'plan_outfit_set')) {
          bumpFreeformDiagnostic(toolContext, 'proposeAfterPlanOutfitSetBlocked')
          contractIssues.push("plan_outfit_set already composed this turn's cards — do not call propose_outfit to rebuild, top up, or replace them; present the existing cards plus their plan_lines as the answer instead. If a genuinely new use case is needed beyond the composed slots, call plan_outfit_set again with just that additional slot rather than hand-composing it here.")
        }
        if (toolContext.pendingPlan?.mode === 'model') {
          bumpFreeformDiagnostic(toolContext, 'proposeAfterPlanOutfitSetBlocked')
          contractIssues.push("plan_outfit_set returned slot rosters for model-composition mode — do not call propose_outfit. Submit the plan cards with submit_plan_outfits, using only piece IDs from each slot roster.")
        }
        const { retrieved: retrievedIdsThisTurn, seen: seenIdsThisTurn, known: knownCardIds } = verifiedPieceIdSets(toolContext)
        const unverifiedPieces = resolved.filter(p =>
          !retrievedIdsThisTurn.has(Number(p.id)) && !knownCardIds.has(Number(p.id)))
        if (unverifiedPieces.length) {
          bumpFreeformDiagnostic(toolContext, 'proposeUnverifiedPieceBlocks')
          contractIssues.push(`verify these pieces (the manifest is an index, not garment truth): call view_pieces with ids [${unverifiedPieces.map(p => Number(p.id)).join(', ')}]`)
        }
        // Layered/base pieces carry construction risks the tags cannot capture
        // (lining, sheerness, true texture) — the model must have SEEN the photo
        // this turn. Pieces with no photo at all are exempt.
        const unseenLayerPieces = resolved.filter(p =>
          (p.role === 'layer_top' || p.role === 'layer_bottom') &&
          (p.photo || p.worn_photo) &&
          !seenIdsThisTurn.has(Number(p.id)) &&
          !unverifiedPieces.some(u => Number(u.id) === Number(p.id)))
        if (unseenLayerPieces.length) {
          bumpFreeformDiagnostic(toolContext, 'proposeUnseenLayerBlocks')
          contractIssues.push(`layer pieces must be visually verified this turn: call view_pieces (size:'large') for [${unseenLayerPieces.map(p => Number(p.id)).join(', ')}] and confirm each works as a layer`)
        }
        // Spec 27 Part 1: print-pairing sight gate, parallel to the layer-sight
        // rule above — parity with validateSubmittedPlanOutfits's plan-path check.
        const printIssue = printPairingSightIssue(resolved, seenIdsThisTurn)
        if (printIssue) {
          bumpFreeformDiagnostic(toolContext, 'proposeUnseenPrintPairingBlocks')
          contractIssues.push(printIssue)
        }
        // Spec 26 Part 1: same mid-revision reason check as
        // validateSubmittedPlanOutfits — a proposed outfit's why_it_works
        // revising itself mid-sentence while `pieces` stays the un-revised
        // set is the same truthfulness failure on this composition path.
        if (why_it_works && reasonRevisesMidSentence(why_it_works)) {
          bumpFreeformDiagnostic(toolContext, 'proposeReasonRevisionBlocks')
          contractIssues.push(REASON_REVISION_MESSAGE)
        }
        if (contractIssues.length) {
          return {
            status: "validation_error",
            message: `Before this outfit can render, fix ALL of the following in one pass, then call propose_outfit again with the same pieces: ${contractIssues.map((issue, i) => `(${i + 1}) ${issue}`).join('; ')}. Reminder: if the user explicitly asked to style/wear a piece, set anchor:true on it.`,
            ...(unverifiedPieces.length ? { unverifiedIds: unverifiedPieces.map(p => Number(p.id)) } : {}),
            ...(unseenLayerPieces.length ? { unseenLayerIds: unseenLayerPieces.map(p => Number(p.id)) } : {})
          }
        }

        const statedOccasion = occasion ? normalizeOccasion(occasion) : ''
        const contextOccasion = toolContext.occasion || ''
        const resolvedOccasion = statedOccasion || contextOccasion || 'casual'
        const resolvedSeason = season || toolContext.weather || toolContext.season || 'current season'
        // Inherit toolContext.activity only when this call doesn't contradict
        // the context it came from. A proposal that states an occasion and
        // omits activity otherwise inherits whatever activity a PRIOR turn
        // set (e.g. "hiking" from an earlier capsule plan) — dragging that
        // turn's register ceiling down even though this call is a dinner, not
        // a hike. Same-occasion or occasion-less follow-ups still inherit
        // exactly as before (cross-turn state, e.g. "swap the shoes on #2").
        const occasionSwitched = Boolean(statedOccasion) && Boolean(contextOccasion) && statedOccasion !== contextOccasion
        const resolvedActivity = activity !== undefined && activity !== null && activity !== ''
          ? normalizeActivity(activity)
          : (occasionSwitched ? '' : (toolContext.activity || ''))
        const requestTextForProposal = [
          toolContext.request,
          toolContext.question,
          occasion_context
        ].filter(Boolean).join(' ')
        const outfitDebug = freeformOutfitDebugTrace({
          resolvedOccasion,
          resolvedActivity,
          requestText: requestTextForProposal,
          mood: toolContext.mood || occasion_context || ''
        })

        // Validate role/slot structure (mechanically enforced — replaces the prompt's layering rules).
        const issues = validateOutfitRoles(resolved, missing_gaps)
        if (issues.length) {
          // Spec 3 Part 1: a failed validation must be visible, not silently dropped/retried — push a
          // broken diagnostic card (same "needs review" treatment as the composer's rejected proposals)
          // so the attempt is inspectable in chat, alongside returning the error to the model to retry.
          const brokenOutfit = {
            label: label || 'Outfit',
            broken: true,
            retryPending: true,
            rejectionReason: issues.join('; '),
            pieceIds: resolved.map(p => Number(p.id)),
            pieces: resolved,
            occasion: resolvedOccasion,
            season: resolvedSeason,
            occasionContext: occasion_context || '',
            why: why_it_works || '',
            reason: why_it_works || '',
            source: 'proposed',
            activity: resolvedActivity,
            debug: outfitDebug,
            previewOnly: true
          }
          const existingBroken = Array.isArray(toolContext.generatedOutfits) ? toolContext.generatedOutfits : []
          toolContext.generatedOutfits = [...existingBroken, brokenOutfit]
          bumpFreeformDiagnostic(toolContext, 'proposeValidationFails')
          return {
            status: "validation_error",
            message: `The proposed outfit has an unresolved structure: ${issues.join('; ')}. COMPLETE the outfit instead of resending it: every card needs shoes plus a primary_top + primary_bottom (or a dress); a layer_top needs its base garment included too. Keep the pieces you chose, add the missing slots (search or view candidates if needed), then call propose_outfit again. If the user's question was really about a pairing or slot (e.g. what goes under X), you may answer that part in prose citing verified IDs — but any CARD must be a complete outfit.`,
            issues
          }
        }

        // THIS call's own `season` arg is a stated override and wins outright — even over a
        // toolContext.weatherProfile cached from an earlier tool call this turn (2026-07-14 live
        // bug: a followup re-proposing for stated new weather still inherited a stale cached
        // profile and got rejected for pieces that were correct for the weather it just stated).
        // Only when this call carries no season of its own do we fall back to the turn's cache,
        // then live/heuristic resolution.
        const resolvedWeather = season
          ? await resolveStatedOrLiveWeather({ statedWeather: season, mood: toolContext.mood || '' })
          : (toolContext.weatherProfile || await resolveStatedOrLiveWeather({
              date: toolContext.currentDate ? new Date(toolContext.currentDate) : new Date(),
              location: toolContext.location || '',
              mood: toolContext.mood || '',
              fallbackSeason: toolContext.weather || resolvedSeason || ''
            }))
        const hardGateIssues = resolved.flatMap(piece => {
          // A user-requested anchor is the outfit's premise (same rule as the
          // composers' selected-piece bypass): the user asking to wear it
          // overrides auto-use suitability gates. Verification (retrieval +
          // layer photos) still applies above.
          if (piece.anchor) return []
          const requestIssues = requestExclusionReasonsForPiece(piece, [
            toolContext.request,
            toolContext.question,
            occasion_context
          ].filter(Boolean).join(' '))
          if (requestIssues.length) return [`${piece.name}: ${requestIssues.join(', ')}`]
          const decision = wholeWardrobePieceTrustDecision(piece, {
            occasion: resolvedOccasion,
            mood: toolContext.mood || occasion_context || '',
            activity: resolvedActivity,
            request: toolContext.request || toolContext.question || occasion_context || '',
            question: toolContext.question || '',
            weatherProfile: resolvedWeather
          })
          return decision.allowed ? [] : [`${piece.name}: ${decision.reasons.join(', ')}`]
        })
        if (hardGateIssues.length) {
          const brokenOutfit = {
            label: label || 'Outfit',
            broken: true,
            retryPending: true,
            rejectionReason: hardGateIssues.join('; '),
            pieceIds: resolved.map(p => Number(p.id)),
            pieces: resolved,
            occasion: resolvedOccasion,
            season: resolvedSeason,
            occasionContext: occasion_context || '',
            why: why_it_works || '',
            reason: why_it_works || '',
            source: 'proposed',
            activity: resolvedActivity,
            debug: outfitDebug,
            previewOnly: true
          }
          const existingBroken = Array.isArray(toolContext.generatedOutfits) ? toolContext.generatedOutfits : []
          toolContext.generatedOutfits = [...existingBroken, brokenOutfit]
          bumpFreeformDiagnostic(toolContext, 'proposeValidationFails')
          return {
            status: "validation_error",
            message: `The proposed outfit includes piece(s) that fail the current occasion/activity/weather gates: ${hardGateIssues.join('; ')}. Search again with the same occasion, activity, and weather, then call propose_outfit with replacements. If the user explicitly asked to style/wear one of the rejected pieces, re-propose with anchor:true on that piece instead — the user's request overrides suitability gating.`,
            issues: hardGateIssues
          }
        }
        if (!toolContext.sourceLocked) toolContext.source = 'proposed_outfit'
        toolContext.occasion = resolvedOccasion
        toolContext.season = resolvedSeason
        toolContext.activity = resolvedActivity
        const anchorPieceIds = resolved.filter(p => p.anchor).map(p => Number(p.id))
        const proposedPieceIds = resolved.map(p => Number(p.id))
        const proposedPieceKey = proposedPieceIds.slice().sort((a, b) => a - b).join('|')
        const proposedPieceIdSet = new Set(proposedPieceIds)
        const proposedLabelKey = String(label || 'Outfit').trim().toLowerCase()
        const existingOutfits = Array.isArray(toolContext.generatedOutfits) ? toolContext.generatedOutfits : []
        // A retry that corrects an earlier rejected attempt is a duplicate of that attempt, not
        // a competing direction — don't render both as separate "Direction" cards. Two ways a
        // correction shows up:
        //  1. Same label, exact same pieces (e.g. re-proposing with anchor:true).
        //  2. All but one piece is the same and this turn's immediately retryable rejection is
        //     being corrected (or the label stayed the same for a legacy diagnostic). Models
        //     routinely rename a direction after swapping the rejected piece; title equality is
        //     presentation, not retry identity.
        // Either way, drop the superseded broken card and carry its rejection forward as an
        // honest note on the surviving card instead of silently discarding it.
        const supersededBroken = existingOutfits.find(outfit => {
          if (!outfit?.broken || !Array.isArray(outfit.pieceIds)) return false
          const brokenPieceKey = outfit.pieceIds.slice().sort((a, b) => a - b).join('|')
          if (brokenPieceKey === proposedPieceKey) return true
          const brokenLabelKey = String(outfit.label || 'Outfit').trim().toLowerCase()
          if (!outfit.retryPending && brokenLabelKey !== proposedLabelKey) return false
          const brokenIdSet = new Set(outfit.pieceIds.map(Number))
          const overlap = proposedPieceIds.filter(id => brokenIdSet.has(Number(id))).length
          const maxLen = Math.max(outfit.pieceIds.length, proposedPieceIds.length)
          return maxLen > 0 && (maxLen - overlap) <= 1
        })
        const supersededEngineNote = (() => {
          if (!supersededBroken) return null
          const removedPieces = (Array.isArray(supersededBroken.pieces) ? supersededBroken.pieces : [])
            .filter(p => p?.id && !proposedPieceIdSet.has(Number(p.id)))
          const addedPieces = resolved.filter(p => p?.id && !new Set((supersededBroken.pieceIds || []).map(Number)).has(Number(p.id)))
          if (!removedPieces.length && !addedPieces.length) {
            // Exact same pieces — a plain re-approval (e.g. anchor:true), nothing swapped.
            return `Approved with an exception: ${supersededBroken.rejectionReason}`
          }
          const swapSummary = removedPieces.length === 1 && addedPieces.length === 1
            ? ` Swapped in ${addedPieces[0].name} to replace it.`
            : addedPieces.length
              ? ` Swapped in ${addedPieces.map(p => p.name).join(', ')}.`
              : ''
          return `Approved after a substitution: ${supersededBroken.rejectionReason}.${swapSummary}`
        })()
        const proposedOutfit = {
          label: label || 'Outfit',
          ...(anchorPieceIds.length ? { anchorPieceIds } : {}),
          occasion: resolvedOccasion,
          season: resolvedSeason,
          occasionContext: occasion_context || '',
          why: why_it_works || '',
          reason: why_it_works || '',
          pieceIds: proposedPieceIds,
          pieces: resolved,
          missingPieces: Array.isArray(missing_gaps) ? missing_gaps.filter(Boolean).map(String) : [],
          source: 'proposed',
          activity: resolvedActivity,
          debug: outfitDebug,
          previewOnly: true,
          ...(supersededEngineNote ? { engineNote: supersededEngineNote } : {})
        }
        toolContext.generatedOutfits = [
          ...existingOutfits.filter(outfit => outfit !== supersededBroken),
          proposedOutfit
        ]
        bumpFreeformDiagnostic(toolContext, 'proposeCalls')
        return {
          status: "success",
          message: `Proposed "${label || 'Outfit'}" as a card with ${resolved.length} pieces${proposedOutfit.missingPieces.length ? ` and ${proposedOutfit.missingPieces.length} wardrobe gap(s)` : ''}.`,
          pieceNames: resolved.map(p => p.name)
        }
      }
      case 'view_pieces': {
        const ids = (Array.isArray(args?.ids) ? args.ids : []).map(Number).filter(Number.isFinite).slice(0, 12)
        if (!ids.length) {
          return { status: "validation_error", message: "view_pieces needs ids: [<wardrobe piece ids>]." }
        }
        const maxPx = args?.size === 'large' ? 896 : 448
        const allowedSet = toolContext && toolContext.allowedPieceIds
          ? (toolContext.allowedPieceIds instanceof Set
            ? toolContext.allowedPieceIds
            : new Set(Array.isArray(toolContext.allowedPieceIds) ? toolContext.allowedPieceIds.map(Number) : []))
          : null
        const viewed = []
        for (const id of ids) {
          if (allowedSet && !allowedSet.has(id)) {
            viewed.push({ id, note: `piece ${id} is not available for the current request` })
            continue
          }
          const row = db.prepare("SELECT * FROM pieces WHERE id = ? AND status = 'active'").get(id)
          if (!row) {
            viewed.push({ id, note: `no active piece with id ${id}` })
            continue
          }
          const parsed = parsePiece(row)
          let image = null
          const photoFile = parsed.worn_photo || parsed.photo || ''
          if (photoFile) {
            const filePath = path.join(userUploadsDir(), photoFile)
            if (fs.existsSync(filePath)) {
              try {
                const thumb = await prepareWardrobeThumb(filePath, `${parsed.id}:${photoFile}`, { maxPx })
                image = { mime: thumb.media_type, base64: thumb.data }
              } catch (err) {
                console.error(`Error loading view_pieces thumbnail for piece ${parsed.id}:`, err)
              }
            }
          }
          viewed.push({
            id: parsed.id,
            name: parsed.name,
            truth: buildWardrobeManifestLine(parsed),
            ...(image ? { image } : { note: 'no photo on file — tags are the only truth for this piece' })
          })
        }
        recordRetrievedPieces(toolContext, viewed.filter(item => item.name).map(item => item.id))
        recordRetrievedPieces(toolContext, viewed.filter(item => item.image).map(item => item.id), { seen: true })
        bumpFreeformDiagnostic(toolContext, 'viewCalls')
        return viewed
      }
      case 'render_preview': {
        if (toolContext.declaredIntent?.want !== 'image') {
          return {
            status: "validation_error",
            message: "render_preview is only allowed after declare_intent({ want: 'image' }). The current turn is not an image request; present the existing cards instead."
          }
        }
        // "The second one" means what the USER sees: this turn's cards first, then
        // the thread's current outfit set (live-tested 2026-07-12: a render ask on a
        // fresh turn found toolContext.generatedOutfits empty and errored, and the
        // model bailed to prose instead of rendering).
        const cards = Array.isArray(toolContext.generatedOutfits) ? toolContext.generatedOutfits : []
        const threadSet = Array.isArray(toolContext.currentOutfitSet) ? toolContext.currentOutfitSet : []
        const index = Number(args?.outfit_index)
        let label = String(args?.label || '').trim()
        let renderPieceIds = []
        const indexTarget = Number.isInteger(index) && index >= 1
          ? (index <= cards.length ? cards[index - 1] : (index <= threadSet.length ? threadSet[index - 1] : null))
          : null
        if (indexTarget) {
          const target = indexTarget
          renderPieceIds = (Array.isArray(target?.pieceIds) && target.pieceIds.length
            ? target.pieceIds
            : (Array.isArray(target?.piece_ids) && target.piece_ids.length
              ? target.piece_ids
              : (Array.isArray(target?.pieces) ? target.pieces.map(piece => piece?.id) : []))
          ).map(Number).filter(Boolean)
          label = label || target?.label || `Outfit ${index}`
        } else if (Array.isArray(args?.piece_ids) && args.piece_ids.length) {
          renderPieceIds = args.piece_ids.map(Number).filter(Number.isFinite)
          const { retrieved: renderRetrieved, known: renderKnown } = verifiedPieceIdSets(toolContext)
          const unverifiedRender = renderPieceIds.filter(id => !renderRetrieved.has(id) && !renderKnown.has(id))
          if (unverifiedRender.length) {
            return {
              status: "validation_error",
              message: `render_preview piece_ids must be verified this turn or belong to a verified card. Unverified: ${unverifiedRender.join(', ')}. Call view_pieces for them first.`
            }
          }
          label = label || 'Outfit preview'
        } else {
          return { status: "validation_error", message: "render_preview needs outfit_index (a card produced this turn) or piece_ids (from a verified card, e.g. THREAD STATE's current outfit set)." }
        }
        const renderRows = renderPieceIds
          .map(id => db.prepare("SELECT * FROM pieces WHERE id = ? AND status = 'active'").get(id))
          .filter(Boolean)
          .map(parsePiece)
          .slice(0, 6)
        if (renderRows.length < 2) {
          return { status: "validation_error", message: "render_preview needs at least two active wardrobe pieces." }
        }
        const { createWholeWardrobeOutfitImage } = await import('./core.js')
        const rendered = await createWholeWardrobeOutfitImage({
          outfit: { label },
          pieces: renderRows,
          occasion: toolContext.occasion || 'casual',
          season: toolContext.season || 'current season',
          index: 1
        })
        const renderedBoard = {
          label,
          reason: 'Rendered in chat via render_preview.',
          pieces: renderRows.map(piece => ({ id: piece.id, name: piece.name, category: piece.category })),
          imageUrl: rendered.imageUrl,
          debug: { renderer: rendered.renderer, timings: rendered.timings }
        }
        toolContext.renderedBoards = [...(Array.isArray(toolContext.renderedBoards) ? toolContext.renderedBoards : []), renderedBoard]
        bumpFreeformDiagnostic(toolContext, 'renderCalls')
        return { status: "success", message: `Rendered "${label}" (${rendered.renderer}). The image will appear in the chat with your answer.`, imageUrl: rendered.imageUrl }
      }
      case 'wardrobe_coverage': {
        const groupOptions = ['category', 'formality', 'fabric_weight', 'fabric_category', 'silhouette', 'season', 'occasions', 'opacity']
        const groupField = groupOptions.indexOf(String(args?.group_by || '')) !== -1 ? String(args.group_by) : 'category'
        const activeRows = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
        const { category: coverageCategory } = normalizeCategoryFilter(args?.category)
        const scoped = coverageCategory
          ? activeRows.filter(piece => String(piece.category || '') === coverageCategory)
          : activeRows
        const counts = {}
        for (const piece of scoped) {
          const values = groupField === 'occasions'
            ? (Array.isArray(piece.occasions) && piece.occasions.length ? piece.occasions : ['untagged'])
            : [piece[groupField] || 'untagged']
          for (const value of values) counts[value] = (counts[value] || 0) + 1
        }
        bumpFreeformDiagnostic(toolContext, 'coverageCalls')
        return { group_by: groupField, total_pieces: scoped.length, counts }
      }
      case 'get_garment_details': {
        const { ids } = args
        if (!Array.isArray(ids) || !ids.length) return []
        
        const details = []
        for (const id of ids) {
          const numId = Number(id)
          let allowed = true
          if (toolContext && toolContext.allowedPieceIds) {
            const allowedSet = toolContext.allowedPieceIds instanceof Set 
              ? toolContext.allowedPieceIds 
              : new Set(Array.isArray(toolContext.allowedPieceIds) ? toolContext.allowedPieceIds.map(Number) : [])
            allowed = allowedSet.has(numId)
          }

          if (!allowed) {
            details.push({
              id: numId,
              text: `piece ${numId} is not available for this request`
            })
            continue
          }

          const p = db.prepare(`SELECT * FROM pieces WHERE id = ?`).get(numId)
          if (!p) {
            continue
          }
          const parsed = parsePiece(p)
          
          let imageData = null
          const photoFile = parsed.worn_photo || parsed.photo || ''
          if (photoFile) {
            const filePath = path.join(userUploadsDir(), photoFile)
            if (fs.existsSync(filePath)) {
              try {
                console.log(`📸 [Agent Vision] Resizing reference photo for piece ${parsed.id} (${photoFile})`)
                imageData = await prepareImageForClaude(filePath)
              } catch (err) {
                console.error(`Error loading photo for piece ${parsed.id}:`, err)
              }
            }
          }
          details.push({
            id: parsed.id,
            name: parsed.name,
            text: buildPieceText(parsed),
            image: imageData
          })
        }
        recordRetrievedPieces(toolContext, details.filter(d => d.name).map(d => d.id))
        recordRetrievedPieces(toolContext, details.filter(d => d.image).map(d => d.id), { seen: true })
        return details
      }
      case 'get_last_outfit_evaluation': {
        const { outfit_id } = args
        return getLastOutfitEvaluation(outfit_id) || { note: "No evaluation found." }
      }
      case 'get_current_image_inventory': {
        const state = getStylistConversationState('default')
        return getCurrentImageInventory(state)
      }
      case 'store_user_correction': {
        const { note, context_type, context_id } = args
        storeUserCorrection(note, context_type || 'general', context_id)
        return { status: "success", message: "Correction stored successfully." }
      }
      case 'plan_outfit_set': {
        // Same declared-intent contract as the other composing tools (step 4).
        if (toolContext.declaredIntent?.want !== 'cards') {
          bumpFreeformDiagnostic(toolContext, 'composeWithoutDeclaredIntent')
          return {
            status: "validation_error",
            message: "No cards intent declared for this turn. Call declare_intent({ want: 'cards' }) first, then call plan_outfit_set again."
          }
        }
        bumpFreeformDiagnostic(toolContext, 'planOutfitSetCalls')
        if (toolContext.capsuleAtomicAttempted) {
          return {
            status: "validation_error",
            message: "This turn already used its one bounded capsule-composition attempt. Present the accepted cards and disclosed gaps; do not re-plan or retry the capsule in this turn."
          }
        }
        // Spec 23 Part 1: detect a partial re-plan BEFORE anything below
        // mutates toolContext.pendingPlan — a plan already in progress this
        // turn (held outfits still pending submit, and/or cards from an
        // earlier fully-succeeded submit_plan_outfits round) means this call
        // must merge into that plan rather than replace it.
        const priorPendingPlan = (toolContext.pendingPlan && toolContext.pendingPlan.mode === 'model') ? toolContext.pendingPlan : null
        const priorAssembledOutfits = (!priorPendingPlan && Array.isArray(toolContext.generatedOutfits))
          ? toolContext.generatedOutfits.filter(outfit => outfit?.source === 'plan_outfit_set')
          : []
        const isPartialReplan = Boolean(priorPendingPlan?.heldOutfits?.length) || Boolean(priorAssembledOutfits.length)
        if (typeof args?.slots === 'string') {
          const recovered = coercePlanOutfitSetSlotsArg(args.slots)
          // Recovered sibling keys (e.g. a `location` that was flattened into
          // the same string) fill gaps only — an explicitly-passed arg wins.
          if (recovered) args = { ...recovered.extra, ...args, slots: recovered.slots }
        }
        const tripSummary = (args?.duration_text || args?.day_breakdown)
          ? {
              durationText: String(args?.duration_text || '').trim(),
              dayBreakdown: String(args?.day_breakdown || '').trim()
            }
          : null
        const planDateRange = {
          start: String(args?.date_range?.start || '').trim(),
          end: String(args?.date_range?.end || '').trim()
        }
        // Reject a timezone identifier passed as a location (the model reads
        // "Time zone: America/Los_Angeles" from context and sometimes hands it in
        // as the plan/slot location — it's not a place, so geocoding fails and
        // live weather silently falls back to the heuristic). Same guard
        // search_wardrobe already applies.
        const rawPlanLocation = String(args?.location || toolContext.location || '').trim()
        const fallbackLocation = looksLikeTimezoneIdentifier(rawPlanLocation) ? '' : rawPlanLocation
        const sanitizedSlots = (Array.isArray(args?.slots) ? args.slots : []).map(slot =>
          slot && looksLikeTimezoneIdentifier(String(slot?.location || '')) ? { ...slot, location: '' } : slot
        )
        const planWeather = String(args?.weather || '').trim()
        const planKind = resolvePlanKind(args?.plan_kind, toolContext.question || '')
        // Capsule safety net: "N-piece capsule" states an explicit budget. The
        // model routinely forgets to set piece_budget (live: a "14-piece capsule"
        // came through with none, so the roster never enforced and 5 of 14 were
        // one-piece dresses). Infer it from the question so the curation still
        // fires; the model's own value always wins when present.
        const explicitConstraintsProvided = Boolean(args?.constraints && typeof args.constraints === 'object' && Object.keys(args.constraints).length > 0)
        let planConstraints = { ...(args?.constraints || {}) }
        if (planKind === 'seasonal_capsule' && !(Number(planConstraints.piece_budget) > 0)) {
          const capsuleBudget = String(toolContext.question || '').match(/\b(\d{1,2})[-\s]?piece\b/i) // ratchet-allow: capsule budget extraction, not garment matching
          planConstraints.piece_budget = capsuleBudget
            ? Number(capsuleBudget[1])
            : DEFAULT_SEASONAL_CAPSULE_BUDGET
        }
        if (planKind === 'seasonal_capsule' && !String(planConstraints.reuse || '').trim()) planConstraints.reuse = 'maximize'
        planConstraints = sanitizePlanConstraintsForQuestion(planConstraints, toolContext.question || '')
        // A capsule's cap is combinatorial (min(budget, 12)); every other plan
        // keeps the day-shaped curve, where a larger packing budget genuinely
        // means more distinct days to dress. Passing 0 here would have pinned
        // every trip at 8 regardless of its budget.
        const planTotalOutfitCap = planKind === 'seasonal_capsule'
          ? capsuleTotalOutfitCap(planConstraints.piece_budget)
          : planTotalOutfitCapForBudget(planConstraints.piece_budget)
        const planSlots = normalizePlanSlots(sanitizedSlots, {
          fallbackWeather: planWeather || toolContext.weather || '',
          fallbackOccasion: toolContext.occasion || 'city',
          fallbackActivity: toolContext.activity || 'none',
          fallbackLocation,
          maxSlots: planTotalOutfitCap,
          maxTotalOutfits: planTotalOutfitCap,
          tripSummary,
          onDiagnostic: field => bumpFreeformDiagnostic(toolContext, field)
        })
        if (!planSlots.length) {
          return {
            status: "validation_error",
            message: "plan_outfit_set needs at least one slot with a label. Decompose the request into use-case slots (label + occasion + activity + count) and call again."
          }
        }
        const planPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
        bumpFreeformDiagnostic(toolContext, 'planOutfitSetCalls', 0)
        // Spec 25 Part 2: fetch here, render in buildPlanSlotWorkbench — the
        // plan workbench is where every instruction the model demonstrably
        // obeys lives, ~40k tokens closer than the system-prompt tail where a
        // stored owner rule previously sat unread among reaction crumbs.
        const ownerRules = getOwnerRuleNotes(8)
        const workbench = await buildPlanSlotWorkbench(planSlots, {
          constraints: planConstraints,
          allPieces: planPieces,
          dateRange: planDateRange,
          mood: toolContext.mood || '',
          question: toolContext.question || '',
          ownerRules,
          planKind,
          // Injected only when the route wired one (flag on). Absent, the
          // roster is chosen deterministically exactly as before.
          chooseCapsuleRoster: typeof toolContext.chooseCapsuleRoster === 'function'
            ? toolContext.chooseCapsuleRoster
            : null,
          onDiagnostic: field => bumpFreeformDiagnostic(toolContext, field)
        })
        const useAtomicCapsuleComposition =
          planKind === 'seasonal_capsule' &&
          Number(planConstraints.piece_budget) >= MIN_ENFORCED_CAPSULE_BUDGET &&
          typeof toolContext.composeCapsulePlanOnce === 'function' &&
          !isPartialReplan
        if (useAtomicCapsuleComposition) {
          // Check supply BEFORE spending the composition call. A wardrobe that
          // cannot sustain the requested capsule produces a one-card "capsule"
          // that reads as broken; the honest answer is to say what is missing
          // and ask for more of the closet to be added. Doing it here also
          // means the unusable request costs nothing.
          const supplyGap = describeCapsuleSupplyGap(workbench.pendingPlan)
          if (supplyGap) {
            toolContext.generatedOutfits = []
            toolContext.pendingPlan = null
            bumpFreeformDiagnostic(toolContext, 'capsuleSupplyGaps')
            const uncoveredText = supplyGap.uncovered
              .map(entry => `${entry.label}${entry.missing.length ? ` (no ${entry.missing.join(' or ')} that suits it)` : ''}`)
              .join('; ')
            return {
              status: 'insufficient_wardrobe',
              message: `This wardrobe has ${supplyGap.rosterSize} usable piece${supplyGap.rosterSize === 1 ? '' : 's'} for the requested capsule and supports ${supplyGap.totalCapacity} distinct outfit${supplyGap.totalCapacity === 1 ? '' : 's'} across ${supplyGap.covered.length} of ${supplyGap.covered.length + supplyGap.uncovered.length} use cases — not enough for a rotation worth calling a capsule. Do not compose one, and do not call other styling tools this turn. Tell the user plainly: the app can only see the pieces they have added so far, so the limit is what has been photographed, not what they own. Ask them to add more of their existing wardrobe — NEVER suggest buying anything. Name what would unlock the most: ${uncoveredText || 'the uncovered use cases'}. Offer what IS possible now: ${supplyGap.covered.join(', ') || 'no complete use case yet'}.`,
              covered_use_cases: supplyGap.covered,
              uncovered_use_cases: supplyGap.uncovered
            }
          }
          toolContext.capsuleAtomicAttempted = true
          const pendingPlan = {
            ...workbench.pendingPlan,
            mode: 'model',
            // The user did not request the model's internal per-slot target
            // counts, so the raw per-slot coverage-gap internals stay out of
            // production notes; the honest total shortfall is disclosed below
            // in its own line instead.
            suppressModelCoverageGaps: true,
            // One composition call, one validation pass, no repair round —
            // set-level rules must not drop an otherwise valid card here.
            boundedComposition: true
          }
          const submittedOutfits = await toolContext.composeCapsulePlanOnce({
            status: workbench.status,
            instructions: workbench.instructions,
            piece_catalog: workbench.piece_catalog,
            slots: workbench.slots,
            constraints: workbench.constraints
          })
          bumpFreeformDiagnostic(toolContext, 'submitPlanCalls')
          if (!Array.isArray(submittedOutfits) || submittedOutfits.length === 0) {
            bumpFreeformDiagnostic(toolContext, 'submitPlanValidationFails')
            toolContext.generatedOutfits = []
            toolContext.source = 'plan_outfit_set'
            toolContext.sourceLocked = true
            toolContext.pendingPlan = null
            toolContext.capsuleAtomicCompleted = true
            return {
              status: 'error',
              bounded_composition: true,
              message: 'The bounded capsule composer returned no outfits even though the deterministic roster has valid capacity. Do not build the capsule manually or call other styling tools in this turn; explain that composition failed and ask the user to retry after the engine issue is corrected.'
            }
          }
          // Complete before judging. A look the composer submitted without shoes
          // is an omission the engine can fill from that slot's own roster for
          // free — shipping it as a needs-review card makes the person do by
          // hand what the repair endpoint would have done in one click.
          const seenForValidation = toolContext.visuallySeenPieceIds instanceof Set ? toolContext.visuallySeenPieceIds : new Set()
          const { accepted, failures, completions } = completeSubmittedPlanOutfits(pendingPlan, submittedOutfits, {
            visuallySeenPieceIds: seenForValidation
          })
          for (const completion of completions) {
            bumpFreeformDiagnostic(toolContext, 'capsuleLooksAutoCompleted')
            console.log('[Atomic Capsule Completion]', `${completion.title || completion.slotId}: added ${completion.group} ${completion.addedPieceName} (${completion.addedPieceId})`)
          }
          const acceptedCounts = new Map()
          for (const outfit of accepted) {
            const slotId = outfit?._slotId || outfit?.slot_id
            if (slotId) acceptedCounts.set(slotId, (acceptedCounts.get(slotId) || 0) + 1)
          }
          const shortfalls = []
          let plannedTotal = 0
          for (const slot of pendingPlan.slots || []) {
            const target = Math.max(0, Number(slot.targetOutfits) || 0)
            plannedTotal += target
            const missing = target - (acceptedCounts.get(slot.id) || 0)
            if (missing > 0) {
              shortfalls.push({ label: slot.label, missing })
              failures.push({
                slot_id: slot.id,
                label: slot.label,
                reasons: [`bounded composition left ${missing} of ${target} requested look${missing === 1 ? '' : 's'} unfilled; no automatic retry was made`]
              })
            }
          }
          if (failures.length) {
            bumpFreeformDiagnostic(toolContext, 'submitPlanValidationFails')
            bumpFreeformDiagnostic(toolContext, 'submitPlanPartialAccepts')
            console.log('[Atomic Capsule Validation]', failures)
          }
          // Raw validator reasons stay in the log; the shortfall itself is the
          // user's to know. Without this, the turn renders fewer cards than it
          // planned while every other surface asserts completeness.
          const shortfallLine = describeCapsuleCompositionShortfall(shortfalls, {
            plannedTotal,
            acceptedTotal: accepted.length
          })
          // Live: the closing model said a card was flagged because the formula
          // "runs warm for summer evenings" and offered a lighter swap. It was
          // actually flagged for having no shoes. It had the COUNT but never the
          // REASON, so it invented a plausible one — the same confabulation the
          // final-answer guard exists to catch, arriving through a gap the guard
          // cannot see. Hand it the real reasons.
          const rejectionSummary = failures
            .filter(failure => Array.isArray(failure.reasons) && failure.reasons.length && failure.outfit)
            .map(failure => `"${failure.label}" — ${failure.reasons[0]}`)
            .join('; ')
          // Roster utilization, disclosed alongside the shortfall. Counted over
          // every card the person will see — accepted plus the needs-review
          // ones — because a piece sitting in a repairable card has a job
          // waiting, and calling it unused would be wrong.
          const displayedForUtilization = [
            ...accepted,
            ...failures.map(failure => failure.outfit).filter(Boolean)
          ]
          const utilizationLine = describeCapsuleRosterUtilization(
            pendingPlan.capsuleRoster || [],
            displayedForUtilization
          )
          if (utilizationLine) {
            pendingPlan.coverageGaps = [...(pendingPlan.coverageGaps || []), utilizationLine]
          }
          if (shortfallLine) {
            pendingPlan.coverageGaps = [...(pendingPlan.coverageGaps || []), shortfallLine]
            toolContext.capsuleShortfall = {
              missing: shortfalls.reduce((sum, entry) => sum + entry.missing, 0),
              planned: plannedTotal,
              accepted: accepted.length
            }
          }
          // Rejected looks are shown, not deleted (owner ruling 2026-07-28).
          // They ride alongside the accepted cards as "needs review" so the
          // person can see what was attempted and repair it in place.
          const acceptedCards = assembleSubmittedPlanOutfits(pendingPlan, accepted)
          // capsulePlanContext is attached during assembly, which only accepted
          // cards go through — but the repair action reads it off the card it
          // is repairing, so a rejected card without it renders no Fix action
          // at all. Carry it across.
          const planContext = acceptedCards.find(outfit => outfit?.capsulePlanContext)?.capsulePlanContext || null
          const rejectedCards = buildRejectedCapsuleCards(failures, pendingPlan)
            .map(card => (planContext ? { ...card, capsulePlanContext: planContext } : card))
          // Place each rejected card with its own slot rather than appending
          // them all at the end. Grouping is by slot label, so a needs-review
          // card that lands after every other slot reads as unrelated to the
          // use case it belongs to — and it is the card the person is meant to
          // act on.
          const slotOrder = new Map((pendingPlan.slots || []).map((slot, index) => [slot.label, index]))
          const orderOf = card => {
            const position = slotOrder.get(card?.label)
            return Number.isInteger(position) ? position : slotOrder.size
          }
          const planOutfits = [...acceptedCards, ...rejectedCards]
            .map((card, index) => ({ card, index }))
            .sort((a, b) => orderOf(a.card) - orderOf(b.card) || a.index - b.index)
            .map(entry => entry.card)
          toolContext.generatedOutfits = planOutfits
          toolContext.source = 'plan_outfit_set'
          toolContext.sourceLocked = true
          toolContext.pendingPlan = null
          toolContext.capsuleAtomicCompleted = true
          const planLinesForResponse = Array.isArray(planOutfits[0]?.tripPlanLines) ? planOutfits[0].tripPlanLines : []
          return {
            status: "success",
            bounded_composition: true,
            message: `${accepted.length} representative capsule outfit${accepted.length === 1 ? '' : 's'} accepted. These cards are already displayed. Present only the accepted rotation naturally and finish; no additional actions are available for this turn.${shortfallLine ? ` ${accepted.length} of ${plannedTotal} planned looks passed validation.${rejectionSummary ? ` The reason each one was held back, which you may state plainly and must NOT guess at or replace with your own theory: ${rejectionSummary}. Those looks are already shown as needs-review cards the user can repair, so do not offer to re-style them yourself.` : ''} Do not describe the shortfall as an engine or card ceiling, and do not supply the missing looks yourself in prose.` : ''}`,
            plan_lines: planLinesForResponse,
            outfit_summaries: planOutfits.map(outfit => ({
              slot: outfit.label,
              coverage: outfit.coveragePosition,
              weather: outfit.slotWeather || '',
              pieceNames: (outfit.pieces || []).map(piece => piece.name)
            }))
          }
        }
        if (isPartialReplan) {
          const merged = mergePendingPlanForReplan(priorPendingPlan, workbench.pendingPlan, {
            explicitConstraintsProvided,
            priorAssembledOutfits
          })
          toolContext.pendingPlan = { ...merged, mode: 'model' }
          if (priorAssembledOutfits.length) {
            // Folded into the merged plan's heldOutfits above — the final
            // submit_plan_outfits success will re-assemble the full union, so
            // this turn's generatedOutfits shouldn't also carry the old,
            // now-superseded assembled copies.
            toolContext.generatedOutfits = (toolContext.generatedOutfits || []).filter(outfit => outfit?.source !== 'plan_outfit_set')
          }
        } else {
          toolContext.pendingPlan = {
            ...workbench.pendingPlan,
            mode: 'model'
          }
        }
        const { pendingPlan, ...result } = workbench
        const heldCount = toolContext.pendingPlan.heldOutfits?.length || 0
        return {
          ...result,
          message: isPartialReplan
            ? `Slot rosters are ready for the re-planned slot(s). ${heldCount} previously accepted outfit${heldCount === 1 ? '' : 's'} from earlier in this plan carr${heldCount === 1 ? 'ies' : 'y'} forward automatically — compose only the slot(s) in this call, then call submit_plan_outfits once with just them; the eventual success response will include the full merged set.`
            : "Slot rosters are ready. Compose the plan yourself and call submit_plan_outfits once with every slot's outfits; use only each slot's allowed piece IDs."
        }
      }
      case 'submit_plan_outfits': {
        bumpFreeformDiagnostic(toolContext, 'submitPlanCalls')
        if (!toolContext.pendingPlan || toolContext.pendingPlan.mode !== 'model') {
          bumpFreeformDiagnostic(toolContext, 'submitPlanValidationFails')
          return {
            status: "validation_error",
            message: "No pending plan rosters exist. Call plan_outfit_set first, then compose from its slot rosters and call submit_plan_outfits."
          }
        }
        const pendingPlan = toolContext.pendingPlan
        const submittedOutfits = coerceSubmitPlanOutfitsArg(args?.outfits) || []
        const { accepted, failures } = validateSubmittedPlanOutfits(pendingPlan, submittedOutfits, {
          visuallySeenPieceIds: toolContext.visuallySeenPieceIds instanceof Set ? toolContext.visuallySeenPieceIds : new Set()
        })
        const alreadyHeld = Array.isArray(pendingPlan.heldOutfits) ? pendingPlan.heldOutfits : []
        const heldPlusAccepted = [...alreadyHeld, ...accepted]
        const countsBySlot = new Map()
        for (const outfit of heldPlusAccepted) {
          const slotId = outfit?._slotId || outfit?.slot_id || outfit?.tripSlot
          if (!slotId) continue
          countsBySlot.set(slotId, (countsBySlot.get(slotId) || 0) + 1)
        }
        const missingSlots = (pendingPlan.slots || []).filter(slot =>
          (countsBySlot.get(slot.id) || 0) < Math.min(3, Math.max(0, Number(slot.targetOutfits) || 0))
        )
        if (missingSlots.length) {
          failures.push({
            slot_id: '',
            label: 'Missing slots',
            reasons: missingSlots.map(slot => `${slot.label} still needs ${Math.min(3, Math.max(0, Number(slot.targetOutfits) || 0)) - (countsBySlot.get(slot.id) || 0)} outfit${Math.min(3, Math.max(0, Number(slot.targetOutfits) || 0)) - (countsBySlot.get(slot.id) || 0) === 1 ? '' : 's'}`)
          })
        }
        pendingPlan.heldOutfits = heldPlusAccepted
        if (failures.length) {
          bumpFreeformDiagnostic(toolContext, 'submitPlanValidationFails')
          pendingPlan.resubmits = Number(pendingPlan.resubmits || 0) + 1
          bumpFreeformDiagnostic(toolContext, 'submitPlanResubmits')
          const failureText = failures
            .map(failure => `${failure.label}: ${failure.reasons.join('; ')}`)
            .join(' | ')
          if (pendingPlan.resubmits <= 2 || !pendingPlan.heldOutfits.length) {
            return {
              status: "validation_error",
              message: `${accepted.length} outfit${accepted.length === 1 ? '' : 's'} accepted and held. Fix these plan outfit issues in ONE submit_plan_outfits call, resubmitting ONLY the failed/missing slots: ${failureText}`,
              accepted_count: accepted.length,
              held_count: pendingPlan.heldOutfits.length,
              failures
            }
          }
          bumpFreeformDiagnostic(toolContext, 'submitPlanPartialAccepts')
          const planOutfits = assembleSubmittedPlanOutfits(pendingPlan, pendingPlan.heldOutfits)
          toolContext.generatedOutfits = planOutfits
          toolContext.source = 'plan_outfit_set'
          toolContext.sourceLocked = true
          // Keep the accepted ledger available for the gap-fill path named in
          // the response below. A subsequent plan_outfit_set call for the
          // missing count must add to these cards, not replace them.
          pendingPlan.partialDelivered = true
          toolContext.pendingPlan = pendingPlan
          const planLinesForResponse = Array.isArray(planOutfits[0]?.tripPlanLines) ? planOutfits[0].tripPlanLines : []
          return {
            status: "success",
            partial: true,
            message: `Accepted ${planOutfits.length} valid plan outfit card${planOutfits.length === 1 ? '' : 's'} after repeated validation failures. Present these cards and the plan_lines honestly; do not invent missing cards. Unfilled slots are disclosed in the plan lines. Last failures: ${failureText} These cards are already displayed to the user — do NOT call propose_outfit or render them again; write your final answer presenting them. To fill the disclosed gaps, call plan_outfit_set again with JUST the unfilled slot(s) — accepted cards carry forward automatically.`,
            plan_lines: planLinesForResponse,
            outfit_summaries: planOutfits.map(outfit => ({
              slot: outfit.label,
              coverage: outfit.coveragePosition,
              weather: outfit.slotWeather || '',
              pieceNames: (outfit.pieces || []).map(piece => piece.name)
            }))
          }
        }
        const planOutfits = assembleSubmittedPlanOutfits(pendingPlan, pendingPlan.heldOutfits)
        if (!planOutfits.length) {
          bumpFreeformDiagnostic(toolContext, 'submitPlanValidationFails')
          return {
            status: "validation_error",
            message: "No valid plan outfits were submitted. Pick complete outfits from the slot rosters and call submit_plan_outfits again."
          }
        }
        toolContext.generatedOutfits = planOutfits
        toolContext.source = 'plan_outfit_set'
        toolContext.sourceLocked = true
        toolContext.pendingPlan = null
        const planLinesForResponse = Array.isArray(planOutfits[0]?.tripPlanLines) ? planOutfits[0].tripPlanLines : []
        return {
          status: "success",
          message: `Accepted ${planOutfits.length} model-composed plan outfit card${planOutfits.length === 1 ? '' : 's'} across ${pendingPlan.slots.length} slots. Present THIS set slot by slot and include the plan_lines; do not call propose_outfit to rebuild it. These cards are already displayed to the user — do NOT call propose_outfit or render them again; write your final answer presenting them.`,
          plan_lines: planLinesForResponse,
          outfit_summaries: planOutfits.map(outfit => ({
            slot: outfit.label,
            coverage: outfit.coveragePosition,
            weather: outfit.slotWeather || '',
            pieceNames: (outfit.pieces || []).map(piece => piece.name)
          }))
        }
      }
      case 'generate_outfits': {
        // Declared-intent gate (step 4): same contract as propose_outfit.
        if (toolContext.declaredIntent?.want !== 'cards') {
          bumpFreeformDiagnostic(toolContext, 'composeWithoutDeclaredIntent')
          return {
            status: "validation_error",
            message: "No cards intent declared for this turn. Call declare_intent({ want: 'cards', outfit_count: <n if the user asked for a number> }) first, then call generate_outfits again."
          }
        }
        const { occasion, season, mood, mission, limit, piece_id, activity } = args
        const { generateOutfitsForPieceInternal, generateWholeWardrobeOutfitsVisualInternal } = await import('../routes/ai.js')
        const intent = normalizeStylingIntent({ occasion, season, mood, mission })
        const resolvedActivity = (activity !== undefined && activity !== null && activity !== '')
          ? normalizeActivity(activity)
          : (toolContext.activity || 'none')
        const resolvedSeason = toolContext.weather ? `${intent.season}; ${toolContext.weather}` : intent.season
        
        toolContext.occasion = intent.occasion
        toolContext.season = resolvedSeason
        toolContext.mood = intent.mood
        toolContext.mission = intent.mission
        toolContext.activity = resolvedActivity

        let result
        if (piece_id) {
          toolContext.source = 'selected_piece'
          result = await generateOutfitsForPieceInternal({
            pieceId: Number(piece_id),
            occasion: intent.occasion,
            season: resolvedSeason,
            mission: intent.mission,
            mood: intent.mood,
            includeMissingPieces: false,
            idealOnly: false,
            question: toolContext.question || '',
            activity: resolvedActivity
          })
        } else {
          toolContext.source = 'whole_wardrobe'
          result = await generateWholeWardrobeOutfitsVisualInternal({
            occasion: intent.occasion,
            season: resolvedSeason,
            mood: intent.mood,
            mission: intent.mission,
            limit: limit || 5,
            explorationMode: 'moderate',
            question: toolContext.question || '',
            activity: resolvedActivity
          })
        }
        
        if (result && result.structuredOutfits) {
          toolContext.generatedOutfits = result.structuredOutfits
          return {
            status: "success",
            message: `Successfully generated ${result.structuredOutfits.length} outfits.`,
            outfit_summaries: result.structuredOutfits.map(o => ({
              label: o.label,
              dominantDirection: o.dominantDirection,
              pieceNames: (o.pieces || []).map(p => p.name)
            }))
          }
        } else {
          return {
            status: "error",
            message: "No outfits were generated or failed to invoke generation pipeline."
          }
        }
      }
      default:
        throw new Error(`Unknown tool: ${name}`)
    }
}

export function getLastOutfitEvaluation(outfitId) {
  if (!outfitId) return null
  try {
    const row = db.prepare(`
      SELECT note, payload FROM stylist_feedback 
      WHERE COALESCE(archived, 0) = 0 AND context_type = 'outfit' AND context_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(Number(outfitId))
    if (!row) return null
    return {
      note: row.note,
      evaluation: safeJsonParse(row.payload, null)
    }
  } catch (err) {
    console.error('getLastOutfitEvaluation error:', err)
    return null
  }
}

export function getCurrentImageInventory(state) {
  if (!state || !state.visible_image_inventory) return []
  return state.visible_image_inventory
}

export function storeUserCorrection(note, contextType = 'general', contextId = null) {
  try {
    const trimmed = String(note || '').trim()
    if (!trimmed) return
    // Dedupe: an identical live note must not stack — repeated turns were
    // multiplying the same text into the high-authority memory section.
    const existing = db.prepare(`
      SELECT id FROM stylist_feedback
      WHERE note = ? AND COALESCE(archived, 0) = 0
      LIMIT 1
    `).get(trimmed)
    if (existing) return
    // Spec 25 Part 2: 'owner_rule' going forward (previously
    // 'preference_reaction'/'message') — legacy rows keep matching via
    // isOwnerRuleRow's OR clause, no migration needed.
    db.prepare(`
      INSERT INTO stylist_feedback (feedback_type, target_type, context_type, context_id, note)
      VALUES ('owner_rule', 'message', ?, ?, ?)
    `).run(contextType, contextId, trimmed)
  } catch (err) {
    console.error('storeUserCorrection error:', err)
  }
}

export function getStylistConversationState(sessionId = 'default') {
  try {
    const row = db.prepare('SELECT state_json FROM stylist_conversation_state WHERE session_id = ?').get(sessionId)
    if (!row) return {}
    return JSON.parse(row.state_json || '{}')
  } catch (err) {
    console.error('getStylistConversationState error:', err)
    return {}
  }
}

export function saveStylistConversationState(state, sessionId = 'default') {
  try {
    const stateJson = JSON.stringify(state || {})
    db.prepare(`
      INSERT INTO stylist_conversation_state (session_id, state_json, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = datetime('now')
    `).run(sessionId, stateJson)
  } catch (err) {
    console.error('saveStylistConversationState error:', err)
  }
}
