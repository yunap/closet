// The /ask tool schemas and their executors — search_wardrobe's roster and gating included.
// DOCUMENTED IN: docs/freeform-rearchitecture-handoff.md (what has already been tried, and why)
// and docs/engine-behaviour-map.md. A tool schema change must amend the handoff in the same
// commit: the schema text is what the model actually reads. See AGENTS.md.
import path from 'path'
import fs from 'fs'
import { db, userUploadsDir, safeJsonParse } from '../db.js'
import { parsePiece, buildPieceText, pieceOccasionCompatible, weatherFitForPiece, getMergedProfileRules, profileRuleFit, resolveRegisterCeiling, getOwnerRuleNotes, getProvisionalWrongChoiceMemory } from './rules.js'
import { evaluateAutomaticUsePiecePool } from './eligibility.js'
import { prepareImageForClaude, prepareWardrobeThumb } from './provider.js'
import { resolveOccasionProfile } from './occasions.js'
import { bottomKind, pieceRequiresBaseLayer, wardrobeCategoryGroup } from './attributes.js'
import { evaluateWearableOutfit, layerConstructionPromptRule, layerDirectionPromptRule, OUTFIT_ROLES, projectOutfitValidationFindings, roleOutfitStructurePromptRule } from './outfitValidation.js'
import { validatedSubstitute } from './recovery.js'
import { normalizeOutfitResult } from './outfitResult.js'
import { resolveActivityProfile } from './footwear-comfort.js'
import { createStylingContextResolver, projectStylingApplicabilityContext, resolveStylingContext } from './stylingContext.js'
import { updateAiTelemetryContext } from '../lib/aiCallTelemetry.js'
import { extractSeasonRequest } from '../lib/seasonContext.js'
import {
  resolveWeatherForRequest, validateUserWeather, validateWeatherEstimate,
  serializeResolvedWeatherContext, TEMPERATURE_BAND_VALUES, PRECIPITATION_VALUES, WIND_VALUES,
} from './weather.js'
import {
  normalizePlanSlots,
  planTotalOutfitCapForBudget,
  capsuleTotalOutfitCap,
  buildPlanSlotWorkbench,
  resolveSlotWeather,
  validateSubmittedPlanOutfits,
  assembleSubmittedPlanOutfits,
  buildRejectedCapsuleCards,
  describeCapsuleSupplyGap,
  mergePendingPlanForReplan,
  reasonRevisesMidSentence,
  describeCapsuleCompositionShortfall,
  describeCapsulePaletteCohesion,
  describeCapsuleAutoCompletions,
  describeCapsuleRosterUtilization,
  describeCapsuleUndemonstratedJobs,
  completeSubmittedPlanOutfits,
  REASON_REVISION_MESSAGE,
  printPairingSightIssue,
  MIN_ENFORCED_CAPSULE_BUDGET
} from './outfitSetPlanner.js'
import { OCCASION_VALUES, ACTIVITY_VALUES, MISSION_VALUES } from './stylingIntent.js'
import { buildWardrobeManifestLine } from '../src/utils/wardrobeAiContext.js'
import { getStylistConversationState } from './conversationState.js'
import { validateOwnerConstraintInput } from '../lib/ownerConstraints.js'
import { extractOwnerGuidanceApplicability, validateOwnerGuidanceApplicability } from '../lib/ownerGuidance.js'

export const CAPSULE_PLAN_EVIDENCE_BOUNDARY = ` Capsule evidence boundary: a requested colour may serve any visual role and never has to be a hero piece. A roster piece absent from the representative cards means only "not demonstrated" — never rejected, bad, or previously flagged. State a requested-colour shortage or wardrobe gap only when a plan_line explicitly reports insufficient eligible supply; absence from the roster or cards is not supply evidence.`

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
// docs/search-wardrobe-visual-budget-spec.md — the per-category cap alone let a batched call's
// total grow linearly with category count (measured: 4 categories, 64 images, before a ~103k-token
// turn). These bound the call as a whole without reopening the per-category design: no category is
// ever pushed to a token-gesture image count just because the call also asked about others.
const SEARCH_WARDROBE_VISUAL_TOTAL_CAP = 40
const SEARCH_WARDROBE_VISUAL_FLOOR = 8

// Relaxation ladder for automatic broadening. Deliberately boring: code owns retrieval completeness,
// not styling judgment, so the order is fixed and each rung is reported back rather than applied
// silently. A model that broadens by hand spends a provider round-trip per attempt; the gallery run
// (thread_1787128902650) burned iterations doing exactly that after a narrow anchor found nothing.
//
// Never relaxed, at any rung: category, active status, and the gates that hide pieces the owner
// excluded or that the request itself rules out. Those are truth, not preference — relaxing them
// would let code quietly overrule the owner to avoid returning an empty list.
const SEARCH_RELAXATION_LADDER = [
  // Free text first: a name or phrase that matched nothing is the likeliest thing to be too narrow.
  ['query'],
  // Then soft descriptive preferences — how a piece looks, not what it is or whether it is allowed.
  ['color', 'pattern_type', 'silhouette', 'fabric_weight', 'fabric_category', 'neckline'],
  // Occasion last, and only as tag confidence: pieceOccasionCompatible already falls back to
  // flexible pieces, and owner/request exclusions are enforced separately and stay enforced.
  ['occasion'],
]
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
// The full stable-truth row a retrieval tool hands back. Extracted so `search_wardrobe` and
// `wardrobe_coverage` return garments under ONE contract: a coverage answer that judged a piece from
// a different field set than a search would have is a second truth surface, and this codebase has
// paid for those before. Judgment fields (weatherFit/ruleFit) are per-request and stay with search.
export function wardrobeTruthRow(p = {}) {
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
    shoe_type: p.shoe_type,
    toe_shape: p.toe_shape,
    walk_support: p.walk_support,
    heel_height: p.heel_height,
    fabric_category: p.fabric_category,
    fabric_weight: p.fabric_weight,
    visual_weight: p.visual_weight,
    opacity: p.opacity,
    needs_base: p.needs_base,
    neckline: p.neckline,
    sleeve_length: p.sleeve_length,
    sleeve_shape: p.sleeve_shape,
    length_hits_at: p.length_hits_at,
    hem_finish: p.hem_finish,
    tuck_behavior: p.tuck_behavior,
    formality: p.formality,
    notes: p.notes ? p.notes.slice(0, 120) : '',
  }
}

export function bumpFreeformDiagnostic(toolContext, field, amount = 1) {
  if (!toolContext) return
  if (!toolContext.freeformDiagnostics) {
    toolContext.freeformDiagnostics = {
      searchCalls: 0,
      searchVisualImagesAttached: 0,
      searchVisualMaxCategoryCount: 0,
      gateExcludedTotal: 0,
      proposeCalls: 0,
      proposeValidationFails: 0,
      planOutfitSetCalls: 0,
      outfitProseWithoutToolCall: 0,
      zeroResultContradictionBlocks: 0,
      cardProseInconsistentBlocks: 0,
      atomicMultiLookCalls: 0,
      executionRouterCalls: 0,
      closingProseWithheld: 0,
      unresolvedCheckDisclosures: 0,
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
      capsuleRosterFailureCodes: '',
      capsuleCompositionFailureCode: '',
      toolSequence: '',
      providerIterations: 0,
      providerInputTokens: 0,
      providerOutputTokens: 0,
      providerCacheReadInputTokens: 0,
      providerCacheCreationInputTokens: 0,
      // Cache attribution (docs/deferred-conversational-cache-spec.md) — subsets of the two totals
      // above, broken out by which cache_control breakpoint actually produced them. Exact on the
      // write side (Anthropic tags cache-creation tokens by TTL bucket); the tool-loop read total
      // stays combined because Anthropic reports one read number for however much of the whole
      // prefix matched, with no per-breakpoint split.
      providerImageManifestCacheReadTokens: 0,
      providerImageManifestCacheCreationTokens: 0,
      providerFullStylistSystemCacheCreationTokens: 0,
      providerMovingMessageCacheCreationTokens: 0,
      providerToolLoopCacheReadTokens: 0,
      weatherSource: ''
    }
  }
  toolContext.freeformDiagnostics[field] = (toolContext.freeformDiagnostics[field] || 0) + amount
}

export function declareBoundedMultiLookIntent(toolContext = {}, { limit, pieceId } = {}) {
  const requestedCount = Math.max(1, Math.min(5, Number(limit) || 2))
  const eligible = toolContext.turnMode === 'new_request' && !pieceId && requestedCount >= 2 &&
    !toolContext.declaredIntent
  if (!eligible) return false
  toolContext.declaredIntent = {
    want: 'cards',
    outfitCount: requestedCount,
    turnMode: 'new_request'
  }
  return true
}

// Nested bounded composers make a real provider call outside askStylistWithTools. Before this
// helper, generate_outfits returned that usage in its own debug payload but the parent freeform row
// omitted it — making the proposed cost path look cheaper by exactly its largest call.
//
// It also used to be invisible in tool_sequence specifically (recordFreeformToolIteration is only
// ever called from inside askStylistWithTools's own loop and the router/compact call sites in
// routes/ai.js — never from here) even though it counted toward provider_iterations: a turn could
// read "4 iterations" with only 3 named in the sequence. Folding the recordFreeformToolIteration
// call in here, at the one place all nested composer usage already flows through, closes that gap
// for every caller rather than requiring each call site to remember it separately.
export function recordNestedFreeformUsage(toolContext, usage = null) {
  if (!toolContext || !usage) return
  recordFreeformToolIteration(toolContext, ['nested_composer'])
  bumpFreeformDiagnostic(toolContext, 'providerIterations')
  bumpFreeformDiagnostic(toolContext, 'providerInputTokens', Number(usage.inputTokens) || 0)
  bumpFreeformDiagnostic(toolContext, 'providerOutputTokens', Number(usage.outputTokens) || 0)
  bumpFreeformDiagnostic(toolContext, 'providerCacheReadInputTokens', Number(usage.cacheReadInputTokens) || 0)
  bumpFreeformDiagnostic(toolContext, 'providerCacheCreationInputTokens', Number(usage.cacheCreationInputTokens) || 0)
  // Cache attribution (docs/deferred-conversational-cache-spec.md): only the whole_wardrobe branch
  // (generateWholeWardrobeOutfitsVisualInternal) carries a cache_control at all — the candidate
  // image-manifest breakpoint at routes/ai.js's "Attach cache_control to the last candidate
  // thumbnail" comment. generateOutfitsForPieceInternal (source 'selected_piece') has no breakpoint,
  // so gating on source here (rather than assuming any nonzero usage means this cache) keeps the
  // attribution correct if that ever changes. This call is always a fresh, one-off `messages`
  // array with a system prompt carrying no breakpoint of its own, so 100% of whatever cache
  // activity shows up is this one breakpoint — no TTL split needed, unlike the tool loop.
  if (toolContext.source === 'whole_wardrobe') {
    bumpFreeformDiagnostic(toolContext, 'providerImageManifestCacheReadTokens', Number(usage.cacheReadInputTokens) || 0)
    bumpFreeformDiagnostic(toolContext, 'providerImageManifestCacheCreationTokens', Number(usage.cacheCreationInputTokens) || 0)
  }
}

// Sequential call number within a freeform turn, for ai_call_log.iteration_index — covers every
// provider call the turn makes (router, each tool-loop iteration, a nested composer call), not just
// the tool-loop's own iterations. Kept directly on toolContext rather than inside freeformDiagnostics:
// it is pure call-sequencing state for the telemetry ledger, not a turn-summary count that belongs
// in the freeform_generation_runs row.
export function nextFreeformCallIndex(toolContext) {
  if (!toolContext) return 1
  toolContext._freeformCallIndex = (toolContext._freeformCallIndex || 0) + 1
  return toolContext._freeformCallIndex
}

// Spec 4: records whether weather resolved live or fell back to the text heuristic, for spec 3's
// per-turn observability (freeform_generation_runs.weather_source).
// docs/activity-and-roster-spec.md §9 / the iteration question. The run row records that a turn
// took 6 provider iterations and made 7 tool calls, and never which call happened in which — so the
// shape of a turn had to be inferred from the model's own prose. That is the same provenance gap
// that hid a composer regression from 1,192 tests. One compact string, iterations separated by ';'
// and the calls within an iteration by ',', turns "roughly this shape" into a query.
export function recordFreeformToolIteration(toolContext, toolNames = []) {
  if (!toolContext) return
  bumpFreeformDiagnostic(toolContext, 'searchCalls', 0)
  const names = (Array.isArray(toolNames) ? toolNames : []).filter(Boolean)
  if (!names.length) return
  const existing = toolContext.freeformDiagnostics.toolSequence || ''
  toolContext.freeformDiagnostics.toolSequence = existing ? `${existing};${names.join(',')}` : names.join(',')
}

export function setFreeformWeatherSource(toolContext, source) {
  if (!toolContext) return
  bumpFreeformDiagnostic(toolContext, 'searchCalls', 0)
  toolContext.freeformDiagnostics.weatherSource = source
}

// Same string-diagnostic shape as the weather source above. Records WHICH
// roster guarantees the model's selection missed — without it, a fallback is
// only a number and the next step is another paid run rather than a query
// (live thread_1785451253837).
export function setFreeformCapsuleRosterFailureCodes(toolContext, codes = []) {
  if (!toolContext) return
  const list = (Array.isArray(codes) ? codes : []).filter(Boolean)
  if (!list.length) return
  bumpFreeformDiagnostic(toolContext, 'searchCalls', 0)
  toolContext.freeformDiagnostics.capsuleRosterFailureCodes = list.join(',')
}

// One stage later than the roster pick above: distinguishes a genuine model
// refusal from a token-cap truncation on the atomic composition call, so a
// "please retry" message is never shown for a failure retrying won't fix.
export function setFreeformCapsuleCompositionFailureCode(toolContext, code = '') {
  if (!toolContext || !code) return
  bumpFreeformDiagnostic(toolContext, 'searchCalls', 0)
  toolContext.freeformDiagnostics.capsuleCompositionFailureCode = code
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
export async function resolveToolStylingContext({
  explicitRequest = {},
  actionArtifact = {},
  toolContext = {},
  inferred = {},
  policy = {},
  weatherResolver = null,
} = {}) {
  const safeExplicitLocation = looksLikeTimezoneIdentifier(explicitRequest.location)
    ? ''
    : (explicitRequest.location || '')
  const establishedState = {
    occasion: toolContext.occasion,
    activity: toolContext.activity,
    season: toolContext.season,
    statedWeather: toolContext.weather,
    weatherProfile: toolContext.weatherProfile,
    mission: toolContext.mission,
    mood: toolContext.mood,
    requestText: toolContext.request || toolContext.question,
    location: toolContext.location,
    date: toolContext.currentDate,
  }
  const resolver = weatherResolver
    ? createStylingContextResolver({ weatherResolver })
    : resolveStylingContext
  const context = await resolver({
    explicitRequest: { ...explicitRequest, location: safeExplicitLocation },
    actionArtifact,
    establishedState,
    inferred,
    policy,
  })
  toolContext.occasion = context.occasion
  toolContext.activity = context.activity
  toolContext.season = context.season
  toolContext.calendarSeason = context.calendarSeason
  toolContext.applicabilityContext = context.applicabilityContext
  toolContext.mission = context.mission
  toolContext.mood = context.mood
  toolContext.weatherProfile = context.weatherProfile
  toolContext.stylingContext = context.debug
  if (String(explicitRequest.statedWeather || '').trim()) {
    toolContext.weather = String(explicitRequest.statedWeather).trim()
  }
  setFreeformWeatherSource(toolContext, context.weatherProfile?.weatherSource || context.provenanceByField.weatherProfile?.source)
  return context
}

function automaticUseContextFromStylingContext(stylingContext = {}, extras = {}) {
  const applicability = projectStylingApplicabilityContext(stylingContext, {
    weatherText: extras.weatherText,
    requestText: extras.request || extras.question || stylingContext.requestText || '',
  })
  return {
    ...extras,
    occasion: stylingContext.occasion,
    activity: stylingContext.activity,
    season: stylingContext.season,
    calendarSeason: applicability.calendarSeason,
    currentDate: applicability.currentDate,
    weatherProfile: stylingContext.weatherProfile,
  }
}

// Slice 1 (2026-08-25): resolveStatedOrLiveWeather was retired after freeform consumers moved to
// resolveToolStylingContext/resolveStylingContext. The named tombstone keeps historical docs
// readable without leaving an executable precedence branch.

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

function freeformOutfitDebugTrace({ resolvedOccasion = '', resolvedActivity = '', requestText = '', mood = '', stylingContext = null } = {}) {
  const occasionProfile = stylingContext?.occasionProfile || resolveOccasionProfile(resolvedOccasion, '')
  const activityProfile = stylingContext?.activityProfile || resolveActivityProfile({
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
    resolvedActivity: stylingContext?.resolvedActivity || activityProfile?.id || resolvedActivity || 'none',
    activitySource: stylingContext?.activitySource || (resolvedActivity ? 'tool_context' : (activityProfile?.id ? 'request' : 'none')),
    walkable: activityProfile?.id === 'walking' || activityProfile?.id === 'hiking',
    registerCeiling: registerCeiling?.ceiling || registerCeiling || 'none',
    ...(stylingContext?.debug ? { stylingContext: stylingContext.debug } : {}),
  }
}

function roleForPieceCategory(piece = {}) {
  const category = String(piece?.category || '').toLowerCase().trim()
  if (category === 'top') return 'primary_top'
  if (category === 'bottom') return 'primary_bottom'
  if (category === 'dress') return 'dress'
  if (category === 'shoes') return 'shoes'
  if (category === 'outerwear') return 'outerwear'
  if (category === 'accessory') return 'accessory'
  return ''
}

function categoryForSlotRole(role = '') {
  return {
    primary_top: 'top',
    primary_bottom: 'bottom',
    dress: 'dress',
    shoes: 'shoes',
    outerwear: 'outerwear',
  }[String(role || '').trim()] || ''
}

function outfitPieceIds(outfit = {}) {
  return (Array.isArray(outfit?.pieceIds) && outfit.pieceIds.length
    ? outfit.pieceIds
    : (Array.isArray(outfit?.piece_ids) && outfit.piece_ids.length
      ? outfit.piece_ids
      : (Array.isArray(outfit?.pieces) ? outfit.pieces.map(piece => piece?.id) : []))
  ).map(Number).filter(Number.isFinite)
}

function resolveCurrentOutfitForSwap(toolContext = {}, { outfitIndex, outfitLabel } = {}) {
  const generated = Array.isArray(toolContext.generatedOutfits) ? toolContext.generatedOutfits : []
  const current = Array.isArray(toolContext.currentOutfitSet) ? toolContext.currentOutfitSet : []
  const cards = [...generated, ...current].filter(outfit => outfit && outfitPieceIds(outfit).length)
  if (!cards.length) return null

  const index = Number(outfitIndex)
  if (Number.isInteger(index) && index >= 1) return cards[index - 1] || null

  const label = normalizePieceLookupName(outfitLabel)
  if (label) {
    return cards.find(outfit => normalizePieceLookupName(outfit.label || outfit.title || outfit.name || '').includes(label)) || null
  }
  return cards[0] || null
}

function resolvePiecesByIds(ids = []) {
  const pieces = []
  for (const rawId of ids) {
    const id = Number(rawId)
    if (!Number.isFinite(id)) continue
    const row = db.prepare("SELECT * FROM pieces WHERE id = ? AND status = 'active'").get(id)
    if (row) pieces.push(parsePiece(row))
  }
  return pieces
}

function slotSwapWhy({ replacement = {}, removed = {}, basePieces = [], slotRole = '', request = '' } = {}) {
  const stablePieces = basePieces
    .filter(piece => Number(piece?.id) !== Number(removed?.id))
    .filter(piece => String(piece?.category || '') !== 'accessory')
    .map(piece => piece.name)
    .filter(Boolean)
    .slice(0, 3)
  const withText = stablePieces.length ? ` with ${stablePieces.join(' + ')}` : ''
  const roleText = slotRole === 'shoes' ? 'changes the grounding' : slotRole === 'outerwear' ? 'changes the layer' : 'changes the balance'
  const requestText = request ? ` for ${request}` : ''
  return `${replacement.name} ${roleText}${withText}${requestText}.`
}

function userAskedForMultipleSlotSwapOptions(text = '', slotRole = '') {
  const normalized = String(text || '').toLowerCase()
  if (/\b(?:two|three|2|3)\b/.test(normalized)) return true
  if (/\b(?:a\s+few|several|couple\s+of)\b/.test(normalized)) return true
  if (slotRole === 'primary_top' && /\b(?:other|different|more|alternate|alternative)\s+tops\b/.test(normalized)) return true
  if (slotRole === 'primary_bottom' && /\b(?:other|different|more|alternate|alternative)\s+bottoms\b/.test(normalized)) return true
  if (slotRole === 'dress' && /\b(?:other|different|more|alternate|alternative)\s+dresses\b/.test(normalized)) return true
  if (slotRole === 'outerwear' && /\b(?:other|different|more|alternate|alternative)\s+(?:jackets|coats|layers|outerwear)\b/.test(normalized)) return true
  return false
}

function slotSwapQueryScore(piece = {}, query = '') {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(token => token.trim())
    .filter(token => token.length >= 4)
    .filter(token => !['other', 'different', 'alternate', 'alternative', 'options', 'option', 'comfortable'].includes(token))
  if (!tokens.length) return 0
  const text = [
    piece.name,
    piece.reads_as,
    piece.notes,
    piece.formality,
    piece.fabric_weight,
    piece.visual_weight,
    piece.fabric_category,
    ...(Array.isArray(piece.colors) ? piece.colors : []),
    ...(Array.isArray(piece.occasions) ? piece.occasions : []),
  ].filter(Boolean).join(' ').toLowerCase()
  return tokens.reduce((score, token) => score + (new RegExp(`\\b${token}\\b`).test(text) ? 4 : 0), 0) // ratchet-allow: user-query relevance ranking, not garment classification
}

const SLOT_SWAP_STATED_COLOR_BONUS = 14

function pieceHasStructuredColor(piece = {}, requestedColor = '') {
  const color = String(requestedColor || '').toLowerCase().trim()
  if (!color) return false
  const colorPattern = new RegExp(`(^|[^a-z0-9])${color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`)
  return (Array.isArray(piece.colors) ? piece.colors : [])
    .some(value => colorPattern.test(String(value || '').toLowerCase().trim()))
}

// Spec docs/future-trip-weather-estimate-spec.md §4.1: shared, provider-portable
// weather schemas reused verbatim across every composition tool (plan_outfit_set,
// search_wardrobe, propose_outfit, generate_outfits). The model translates
// language into these typed fields; the executor never parses prose into
// physical weather (styling-engine/weather.js owns that validation/resolution).
const USER_WEATHER_SCHEMA = {
  type: "object",
  description: "Structured translation of weather the CURRENT user message explicitly stated — include it ONLY when the user actually said it this turn, never your own seasonal knowledge (use weather_estimate for that instead). Carries a numeric range OR a qualitative band, never both. Convert a user-stated Celsius value to Fahrenheit yourself before setting high_f/low_f — never pass Celsius through.",
  properties: {
    high_f: { type: "number", description: "The user's stated high, Fahrenheit. For a single stated temperature, set high_f and low_f to the same value." },
    low_f: { type: "number", description: "The user's stated low, Fahrenheit." },
    temperature_band: { type: "string", enum: TEMPERATURE_BAND_VALUES, description: "A qualitative statement ('it's cold there', 'expect it hot') when the user gave no number. Never set this alongside high_f/low_f." },
    precipitation: { type: "string", enum: PRECIPITATION_VALUES, description: "Only when the user stated it this turn." },
    wind: { type: "string", enum: WIND_VALUES, description: "Only when the user stated it this turn." }
  }
}
const WEATHER_ESTIMATE_SCHEMA = {
  type: "object",
  description: "Your own conservative seasonal estimate for this location and date range, used ONLY as a fallback when the live forecast does not cover these dates (e.g. a trip more than ~2 weeks out). The executor always tries live weather first and ignores this estimate whenever live weather succeeds. Provide it on every future named-destination call so composition is not blocked. Never call it a forecast or imply the user stated it — it is your own seasonal judgment, numeric only (no qualitative band).",
  properties: {
    high_f: { type: "number", description: "Typical daily high, Fahrenheit." },
    low_f: { type: "number", description: "Typical daily low, Fahrenheit — use the cooler end for evening/early-morning transit." },
    precipitation: { type: "string", enum: PRECIPITATION_VALUES },
    wind: { type: "string", enum: WIND_VALUES }
  },
  required: ["high_f", "low_f"]
}

export const STYLIST_TOOLS = [
  {
    name: "declare_intent",
    description: "Declare what this turn should produce, when a later operation needs that contract. Required before propose_outfit, generate_outfits or render_preview, which are blocked until the turn declares want:'cards' or want:'image'. NOT required to answer in prose: an explanation, comparison, critique, garment question or recalled detail needs no declaration, and declaring want:'text' merely to answer costs a whole extra model round-trip for nothing. Re-call to update if the goal changes mid-turn. The declaration is consumed mechanically: it sets the turn's output contract (e.g. how many cards are owed) instead of keyword-guessing from the user's phrasing.",
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
    description: "Search the wardrobe database for matching active garments. Returns a list of pieces with their ID, name, category, reads_as, visual parameters (pattern, silhouette, fabric, neckline, sleeves, length, hem), and simple notes. BATCH IT: `category` accepts an array, so retrieve every category the outfit needs in ONE call (e.g. category:['top','bottom','shoes','outerwear']) rather than one call per category — the image budget is per category, so batching costs you no photographs. If a filter matches nothing, the search broadens itself along a fixed ladder (free text, then descriptive filters, then occasion tags) and returns the closest active pieces with a `retrieval` entry stating what it relaxed; do not re-search to work around an empty result. That entry also names any category that is genuinely empty after broadening — a real wardrobe shortfall, which you may report as a gap. Category, active status and owner exclusions are never relaxed. Each result carries a weatherFit and a ruleFit tier: honour them. Use weatherFit to keep heavy fabrics off hot daytime looks and reserve heavier pieces for cool-evening layers.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query matching against name or notes" },
        category: { oneOf: [{ type: "string", enum: ["top", "bottom", "dress", "shoes", "outerwear", "accessory"] }, { type: "array", items: { type: "string", enum: ["top", "bottom", "dress", "shoes", "outerwear", "accessory"] } }], description: "Filter by category, or by SEVERAL AT ONCE — pass an array like ['top','bottom','shoes'] to cover a whole outfit in ONE call instead of one call per category. Every separate call is another round-trip that re-sends the whole conversation, so batch categories that share the same occasion/activity/weather. Use the exact singular values shown (the manifest's group headers are plural display labels; the data values are these)." },
        color: { type: "string", description: "Filter by color description or reads_as tag" },
        occasion: { type: "string", description: "Filter by occasion (e.g. city, casual, evening)" },
        pattern_type: { type: "string", description: "Filter by pattern type, e.g. solid, floral, stripe, botanical, geometric, abstract, animal, graphic, plaid, other" },
        silhouette: { type: "string", description: "Filter by silhouette type, e.g. fitted, slim, relaxed, boxy, A-line, drop-shoulder, oversized" },
        fabric_weight: { type: "string", description: "Filter by fabric weight, e.g. ultralight, light, medium, heavy" },
        fabric_category: { type: "string", description: "Filter by fabric category, e.g. jersey, knit, linen, silk, satin, cotton, wool, cashmere, viscose, denim, twill, canvas, corduroy, tweed, velvet, leather, suede, ponte, synthetic, fleece, other" },
        neckline: { type: "string", description: "Filter by neckline style, e.g. V, scoop, crew, boat, mock, cowl, off-shoulder, square, wrap, other, none" },
        weather: { type: "string", description: "Established conditions (e.g. hot, highs 80-90F, cold). Ranks and flags results by weather fit; pass it whenever conditions are known." },
        location: { type: "string", description: "City/place if a real destination is known (e.g. a trip). When set, weather is resolved from a live forecast for that place instead of the text-heuristic fallback — pass it whenever a concrete location is established in the conversation." },
        activity: { type: "string", enum: ACTIVITY_VALUES, description: "Physical demand of the outing. 'hiking' = trails, nature walks, woods, uneven or unpaved ground — a nature walk IS hiking even when it is gentle. 'walking' = pavement: city days, sightseeing, all-day errands on foot. 'none' = no sustained walking. With occasion, flags pieces by profile-rule fit; pass it whenever known." },
        visual: { type: "boolean", description: "When true, attach low-detail thumbnails for the top ranked matches so you can judge color, texture, print, and proportion by sight. Use before proposing or refining outfits; leave false for quick text lookups." },
        intent: { type: "string", enum: ["compose", "explain"], description: "Default 'compose': pieces that are prohibited for the given occasion/activity are filtered OUT of results, so you compose only from wearable pieces (no need to self-reject anything). Set 'explain' ONLY when the user is asking ABOUT a constraint rather than for outfit material (e.g. 'why can't I wear heels hiking', 'what's wrong with these shoes here') — then prohibited pieces ARE returned, each with its ruleFitLabel, so you can show and explain them." }
      }
    }
  },
  {
    name: "view_pieces",
    description: "Look at specific wardrobe pieces by ID: returns each piece's photo thumbnail plus a compact truth line. This is the cheap, preferred way to satisfy the verification contract — it verifies (and visually verifies) the exact IDs you intend to recommend, including layer/base pieces. A photo may establish visible drape, bulk, texture and whether a configuration is physically possible; it cannot establish exact fiber composition when the truth line is silent. Possibility does not prove that the shown styling looks good, and an unseen alternative cannot be ranked. Use search_wardrobe when you don't know which IDs you want yet; use get_garment_details only when you need deep styling rules and fit-caution text.",
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
    name: "suggest_slot_swaps",
    description: "For a follow-up that asks for alternatives to ONE slot in an existing outfit card (e.g. 'other tops for Coast Floral', 'same outfit, different shoes', 'swap the skirt'), generate 1-3 complete variant cards in one local tool call. Resolve against THREAD STATE's current_outfit_set by outfit_index or outfit_label. Use this instead of calling propose_outfit once per alternative. Do not use for fresh outfits, multi-slot plans, or changing the whole outfit.",
    input_schema: {
      type: "object",
      properties: {
        outfit_index: { type: "integer", description: "Optional 1-based current outfit index. Defaults to the first current outfit when omitted." },
        outfit_label: { type: "string", description: "Optional label substring for the outfit to revise, e.g. 'Coast Floral'." },
        slot_role: { type: "string", enum: ["primary_top", "primary_bottom", "dress", "shoes", "outerwear"], description: "The single outfit slot to replace." },
        category: { type: "string", enum: ["top", "bottom", "dress", "shoes", "outerwear"], description: "Optional category filter; inferred from slot_role when omitted." },
        target_piece_id: { type: "integer", description: "Optional exact piece ID to replace when the outfit has more than one plausible target." },
        replacement_ids: { type: "array", items: { type: "integer" }, description: "Optional specific replacement candidate IDs. When omitted, the tool searches active wardrobe pieces in the requested category." },
        query: { type: "string", description: "Optional text filter for replacements, such as color/register/style words." },
        color: { type: "string", description: "Optional preferred color for replacements. This boosts exact structured color-tag matches without excluding other workable pieces." },
        occasion: { type: "string", enum: OCCASION_VALUES, description: "Optional occasion override. Defaults to the current outfit/thread occasion." },
        season: { type: "string", description: "Optional season/weather override. Defaults to thread weather/season." },
        activity: { type: "string", enum: ACTIVITY_VALUES, description: "Optional activity override. Defaults to thread activity." },
        limit: { type: "integer", minimum: 1, maximum: 3, description: "Number of variant cards to return. Default to 1 best swap. Use 2-3 only when the user explicitly asks for a number or says a few/several/couple." }
      },
      required: ["slot_role"]
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
    description: "Coverage and gap questions ('do I have enough dressy flats I can walk in?', 'how many dressy shoes do I own?'). Returns exact counts over the active wardrobe grouped by an attribute. When you pass `category`, it ALSO returns `candidates`: the complete active census for that category as full truth rows — every piece, not a sample or a ranking — so you can judge coverage from this one result. Do not follow it with search_wardrobe or view_pieces to find or inspect the same pieces; the rows are already here. Call view_pieces only when seeing a specific garment would actually change your answer. A piece with no photograph is still a candidate, and a differing label is not by itself a disqualification — contextual judgment is yours, physical facts are the saved values",
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
    description: "Store a DURABLE taste preference or correction the user themselves stated. Use piece_id when the statement is about one exact garment; it is verified against garments established in this conversation and saved to that garment rather than globally. For wardrobe guidance, provide guidance_applicability from explicit user language so it reaches styling only when its garment and/or situation match. The server also recovers narrow unambiguous terms locally. Use universal only when the owner explicitly says the instruction applies generally. When the user's own words state a firm, context-specific exclusion that fits the supported schema, also provide firm_rule_proposal; this only creates a proposal for later owner confirmation and never activates a gate. NEVER store situational or trip facts — those live in THREAD STATE.",
    input_schema: {
      type: "object",
      properties: {
        note: { type: "string", description: "The user preference or correction text." },
        context_type: { type: "string", description: "Context type: 'outfit' or 'general'" },
        context_id: { type: "integer", description: "Optional outfit ID if context is outfit" },
        piece_id: { type: "integer", description: "Exact garment ID when this correction applies only to one garment. Use only an ID retrieved or established in the current conversation." },
        guidance_applicability: {
          type: "object",
          description: "When this wardrobe-wide guidance is relevant. Use only terms explicitly stated by the owner; omit uncertain fields rather than guessing.",
          properties: {
            reach: { type: "string", enum: ["universal", "garment", "context", "garment_context"] },
            garment: {
              type: "object",
              properties: {
                categories: { type: "array", items: { type: "string", enum: ["top", "bottom", "dress", "shoes", "outerwear", "accessory"] } },
                footwear: { type: "array", items: { type: "string", enum: ["boots", "sandals", "sneakers", "flats", "heels", "loafers", "mules", "clogs"] } },
                materials: { type: "array", items: { type: "string", enum: ["canvas", "leather"] } }
              }
            },
            context: {
              type: "object",
              properties: {
                occasions: { type: "array", items: { type: "string" } },
                activities: { type: "array", items: { type: "string" } },
                seasons: { type: "array", items: { type: "string" } },
                weather: { type: "array", items: { type: "string" } },
                situations: { type: "array", items: { type: "string", enum: ["office", "client"] } }
              }
            }
          },
          required: ["reach"]
        },
        firm_rule_proposal: {
          type: "object",
          description: "Optional structured proposal for a firm exclusion explicitly stated by the owner. Omit unless both the clothing selector and context are unambiguous. This is reviewed by the owner before it can affect selection.",
          properties: {
            selector_type: { type: "string", enum: ["category", "material", "footwear"] },
            selector_values: { type: "array", minItems: 1, items: { type: "string" } },
            context_dimension: { type: "string", enum: ["occasion", "season", "activity", "weather"] },
            context_values: { type: "array", minItems: 1, items: { type: "string" } },
            reason: { type: "string", description: "Plain-language consequence faithful to the user's statement." }
          },
          required: ["selector_type", "selector_values", "context_dimension", "context_values", "reason"]
        }
      },
      required: ["note"]
    }
  },
  {
    name: "generate_outfits",
    description: "Compose fresh visual outfit card options from the saved wardrobe. Use only when the user asks to be styled with fresh cards, not for ordinary text advice or to show an outfit already discussed. An ordinary new 'what should I wear?' request defaults to 2 options; explicit 'one/best/pick one' or a stated count overrides that default.",
    input_schema: {
      type: "object",
      properties: {
        occasion: { type: "string", enum: OCCASION_VALUES, description: "The occasion. Pick the closest allowed value; do not invent. casual/gallery/concert/travel are intentionally permissive." },
        activity: { type: "string", enum: ACTIVITY_VALUES, description: "Physical-demand axis, orthogonal to occasion. Set ONLY when the user changed the physical demand THIS turn. NEVER pass 'none' explicitly to a conversation that established walking/hiking — omit the field and the established activity (see THREAD STATE) carries forward, keeping footwear walkable." },
        season: { type: "string", description: "Season/weather context (e.g. warm, cool, year-round). Infer from the date when not stated." },
        location: { type: "string", description: "Real place named by the user, when weather affects the request. Pass it so the bounded composer uses live weather rather than a seasonal guess." },
        date: { type: "string", description: "Resolved requested date in YYYY-MM-DD when the user names a day or relative date. Use CURRENT DATE / SEASON to resolve it." },
        mood: { type: "string", description: "Optional vibe/aesthetic direction only (e.g. artistic minimal, earthy structure). Do NOT put activity here; use the activity parameter." },
        mission: { type: "string", enum: MISSION_VALUES, description: "Styling mission. Default 'mix'." },
        limit: { type: "integer", description: "Number of outfits to generate (1 to 5). Default to 2 for an ordinary new 'what should I wear?' request. Honor an explicit count; use 1 when the user asks for one best look or says to pick one." },
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
              environment: { type: "string", enum: ["indoor", "outdoor", "beach_coastal"], description: "The slot's physical setting — the ONLY field for indoor/outdoor/beach_coastal (never weather text). Use 'beach_coastal' for beach, pool, seaside, or coastal-outing slots; it drives sand/water/wind handling. Use 'indoor' for climate-controlled slots (offices, restaurants, galleries) — the outside temperature still governs transit and cold-weather coverage, while the indoor base may stay light. Omit when unsure; outdoor is the default." },
              count: { type: "integer", minimum: 1, maximum: 3, description: "Distinct outfits to compose for this slot. Default 1." },
              user_weather: USER_WEATHER_SCHEMA,
              weather_estimate: WEATHER_ESTIMATE_SCHEMA,
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
            no_repeat: { type: "array", items: { type: "string" }, description: "Category groups whose pieces must NOT repeat across the set — e.g. ['tops'] for a work week so no shirt is worn twice. Groups: tops, bottoms, dresses, outerwear (or 'layers'), shoes, accessories. Do not set this for a seasonal capsule: recombination is the point of a capsule, so it is discarded there unless the person explicitly asked for no repeats." },
            allow_repeat: { type: "array", items: { type: "string" }, description: "Category groups explicitly allowed to repeat even when diversifying — e.g. ['shoes'] since the same shoes across a week is normal. Overrides no_repeat for that group." },
            shared_anchor_ids: { type: "array", items: { type: "integer" }, description: "Wardrobe piece IDs to pin across the set — e.g. styling several outfits around one new piece. Anchors recur in every slot they fit and are exempt from no_repeat." },
            piece_budget: { type: "integer", minimum: 1, description: "Max distinct pieces the whole set may draw on — the headline for a capsule ('10-piece capsule'). The plan report then leads with the piece roster and how many outfits it yields, and flags if the set went over budget." }
          }
        },
        user_weather: { ...USER_WEATHER_SCHEMA, description: `${USER_WEATHER_SCHEMA.description} Applies to every slot sharing the plan's own location/date_range; a slot at a different location or a date outside date_range needs its own user_weather.` },
        weather_estimate: { ...WEATHER_ESTIMATE_SCHEMA, description: `${WEATHER_ESTIMATE_SCHEMA.description} Applies to every slot sharing the plan's own location/date_range; a slot at a different location or a date outside date_range needs its own weather_estimate.` },
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
              reason: { type: "string", description: "Optional one-sentence styling rationale." },
              styling_instructions: { type: "string", description: "How the pieces physically relate to each other when worn, when that relationship isn't obvious from the pieces alone: layering order, where a belt or tie lands and which layer it cinches, tuck/drape behavior between two specific garments. Concrete and actionable, not a restatement of `reason` — write it the way you would explain it to the person putting the outfit on. Omit for a simple outfit with no layering or positioning decision." }
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
    description: `Propose (or show/render) ONE complete, coherent outfit from verified wardrobe pieces, rendered as a card. Call 'search_wardrobe' first to get real piece IDs, then pass those IDs here — never names, never prose outfit sections. Call once per outfit; write conversational prose (intro, transitions, follow-up questions) around the call, but put the outfit's actual pieces in this tool, not in text. This is ONE wearable outfit — at most one primary_top (or one dress), one primary_bottom, and one shoes. NEVER pass multiple pieces of the same role to show a group of options or a capsule roster (e.g. five shoes, or seven tops, all in one call): that is not an outfit, it will be rejected. To present alternatives or a roster, describe them in prose, or re-run the set tool ('plan_outfit_set') — do not pile same-role pieces into one card. FOOTWEAR IS REQUIRED: every outfit needs a shoes-role piece, so never finalize one without it. If the wardrobe holds no suitable shoe for this occasion, say so plainly as a wardrobe gap instead of proposing an incomplete outfit with missing_gaps standing in for footwear. When a named top is locked as layer_top, choose a base to go underneath it — a fitted or smooth primary_top, or a simple dress — unless that garment's own notes say it works over something bulkier.\n${layerConstructionPromptRule()}\n${layerDirectionPromptRule()}`,
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
              role: { type: "string", enum: OUTFIT_ROLES, description: roleOutfitStructurePromptRule() },
              anchor: { type: "boolean", description: "Set true ONLY when the user explicitly asked to style/wear THIS piece this turn. An anchor is the outfit's premise: it bypasses auto-use trust/weather/register gating (the user's request overrides suitability rules). Supporting pieces stay fully gated. Never mark a piece the user did not ask about." }
            },
            required: ["id", "role"]
          }
        },
        label: { type: "string", description: "Creative outfit title." },
        occasion_context: { type: "string", description: "The occasion / vibe / style lane this outfit is for." },
        why_it_works: { type: "string", description: "Brief styling rationale — the concept, not the mechanics." },
        styling_instructions: { type: "string", description: "How the pieces physically relate to each other when worn, when that relationship isn't obvious from the pieces alone: layering order (what goes over/under what), where a belt or tie lands and which layer it cinches, tuck/drape behavior between two specific garments, sleeve/hem interaction between layers. Concrete and actionable, not a restatement of why_it_works — write it the way you would explain it to the person putting the outfit on. Omit for a simple outfit with no layering or positioning decision (e.g. a plain top + bottom + shoes)." },
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

// docs/search-payload-spec.md §7 lever 2. Three searches that differ only by category cost three
// full provider round-trips, and each round-trip re-reads the whole conversation AND the cached
// prefix — the A/B on thread_1786994644421 showed prefix size is multiplied by iteration count. So
// the fix is structural rather than a prompt asking the model to batch: accept the categories it
// wants in one call. Prompt-only guidance has failed every time it has been tried here.
export function normalizeCategoryFilters(value) {
  const raw = Array.isArray(value) ? value : (value === undefined || value === null || value === '' ? [] : [value])
  const categories = []
  const unknown = []
  for (const entry of raw) {
    const { category, unknown: isUnknown } = normalizeCategoryFilter(entry)
    if (!category) continue
    if (isUnknown) { unknown.push(String(entry)); continue }
    if (!categories.includes(category)) categories.push(category)
  }
  return { categories, unknown }
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
          const boundedBatchContract = (turnMode === 'new_request' || (!turnMode && toolContext.turnMode === 'new_request')) &&
            outfitCount >= 2
            ? `For 2–5 fresh outfits sharing one occasion, activity, and weather context, call generate_outfits exactly once with limit:${outfitCount}; its returned cards are complete and must not be rebuilt with search_wardrobe or propose_outfit. `
            : ''
          return {
            status: "success",
            message: `Intent recorded: cards${outfitCount ? ` (${outfitCount} outfits owed)` : ''}. ${seededCount ? `NOTE: ${seededCount} verified card${seededCount === 1 ? ' is' : 's are'} ALREADY composed for this turn — present those as the answer and propose additional cards ONLY for a need the user asked for that they do not cover. ` : ''}${boundedBatchContract}Contract: for a SINGLE outfit, every card goes through propose_outfit with piece IDs verified this turn (view_pieces / search_wardrobe / get_garment_details); layer pieces must have been SEEN (photo attached — view_pieces is the cheap way). When the bounded multi-look contract above is absent, a small fixed set follows that same serial contract. Exception: if this is a follow-up asking for alternatives to ONE slot in an existing card ("other tops", "different shoes", "swap the skirt"), call suggest_slot_swaps ONCE; its returned cards are complete and must be presented directly, not recreated with propose_outfit. For a multi-slot plan (a trip, capsule, work week, or any request spanning several use cases), call plan_outfit_set ONCE instead — its cards already satisfy this contract; do NOT also call propose_outfit to rebuild or top up that same set, even if its total is less than what you'd otherwise deliver via propose_outfit (a shortfall there means a real cap or wardrobe gap, which plan_outfit_set's own plan_lines already disclose — do not paper over it with hand-composed cards). A plan_outfit_set success response, even one whose plan_lines list gap/trim disclosures, is a COMPLETE answer: you MUST present its cards plus those plan_lines verbatim — never discard the cards and fall back to a text-only explanation instead (a partial set with honest disclosed gaps is the correct outcome, not a failure to talk your way around). Only skip cards entirely if plan_outfit_set itself returned status:"error" (zero outfits composed). ${outfitCount ? `Do not finish with fewer than ${outfitCount} complete cards without explaining the wardrobe gap.` : ''}`
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
        // Broadening re-enters this case with fewer filters. The pass counter keeps that internal:
        // one model-visible search stays one searchCalls bump however many rungs code climbed.
        const relaxationPass = Number(args.__relaxationPass) || 0
        const relaxedSoFar = Array.isArray(args.__relaxedFilters) ? args.__relaxedFilters : []
        const { query, color, occasion, pattern_type, silhouette, fabric_weight, fabric_category, neckline, weather: weatherText, activity, visual, intent, location } = args
        const requestText = [
          toolContext.request,
          toolContext.question,
          toolContext.mission,
          query,
          toolContext.mood
        ].filter(Boolean).join(' ')
        const stylingContext = await resolveToolStylingContext({
          explicitRequest: {
            occasion,
            activity,
            season: extractSeasonRequest(args?.season),
            statedWeather: weatherText,
            location,
            requestText,
          },
          toolContext,
          inferred: { requestText },
          policy: { requireOccasion: false },
        })
        const resolvedOccasion = stylingContext.occasion
        const resolvedActivity = stylingContext.activity
        const resolvedWeather = stylingContext.weatherProfile
        const { categories, unknown: unknownCategories } = normalizeCategoryFilters(args.category)
        if (unknownCategories.length) {
          return [{ note: `Unknown category "${unknownCategories.join('", "')}" — no filter applied would lie about the wardrobe. Valid categories: top, bottom, dress, shoes, outerwear, accessory. Re-run the search with one of these.` }]
        }
        let sql = "SELECT * FROM pieces WHERE status = 'active'"
        const params = []
        if (categories.length === 1) {
          sql += " AND category = ?"
          params.push(categories[0])
        } else if (categories.length > 1) {
          sql += ` AND category IN (${categories.map(() => '?').join(',')})`
          params.push(...categories)
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
          filtered = filtered.filter(piece => pieceHasStructuredColor(piece, color))
        }
        let fallbackNote = ''
        let gateSupplyFallbackNote = ''
        if (occasion) {
          const beforeOccasionFilter = filtered
          const searchEligibility = evaluateAutomaticUsePiecePool({
            pieces: filtered,
            context: automaticUseContextFromStylingContext(stylingContext),
          })
          const occasionFiltered = filtered.filter(p => {
            if (!pieceOccasionCompatible(p, occasion)) return false
            // docs/activity-and-roster-spec.md §5.4. This passed `occasion` alone, so an
            // owner_constraints row scoped to an activity, season or weather could never apply to
            // the roster the model composes from — only to the proposal afterwards. Both stored
            // constraints in the development wardrobe are activity- or season-scoped.
            const decision = searchEligibility.decisionsById.get(Number(p.id))
            if (decision?.underlyingAllowed) return true
            // Reject HERE only for the owner's own standing decisions. Passing activity/season above
            // also makes this call evaluate the full profile gate, and letting that reject at this
            // stage would move profile exclusions ahead of the ruleFit pass that counts them, annotates
            // them, and hands them back under intent:'explain' — the piece would vanish with no
            // number, no label and no way to ask why. Profile fit is judged once, below.
            return !decision?.findings.some(finding => finding.authority === 'owner')
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
              p.name.toLowerCase().includes(qLower) || // ratchet-allow: explicit free-text wardrobe search over the user-visible piece name
              (p.notes && p.notes.toLowerCase().includes(qLower)) // ratchet-allow: explicit free-text wardrobe search over user-authored notes
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
        // One shared resolver owns stated/live/saved/heuristic weather precedence and records
        // provenance. Search remains retrieval policy; it does not gain a complete-outfit gate.
        if (resolvedWeather.isHot || resolvedWeather.isCold) {
          results = results
            .map(p => {
              const fit = weatherFitForPiece(p, resolvedWeather)
              return { ...p, weatherFit: fit.label, weatherFitScore: fit.score }
            })
            .sort((a, b) => (b.weatherFitScore || 0) - (a.weatherFitScore || 0))
        }

        if (requestText) {
          const beforeRequestExclusions = results.length
          results = results.filter(p => requestExclusionReasonsForPiece(p, requestText).length === 0)
          requestExcludedCount = beforeRequestExclusions - results.length
        }
        const occasionProfile = stylingContext.occasionProfile
        const activityProfile = stylingContext.activityProfile
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
          // Within a tier the order used to fall back to id, so nine shoes tied at `preferred`
          // arrived in an order carrying no information — ballet flats indistinguishable from
          // trail sneakers. When an activity is set, rank its own axis first: more support is
          // better for walking and hiking. This reorders; it never removes.
          const supportRank = { high: 0, medium: 1, low: 2 }
          const activityFitness = piece => {
            if (!activityProfile || wardrobeCategoryGroup(piece) !== 'shoes') return 1
            const support = String(piece?.walk_support || '').toLowerCase()
            return supportRank[support] ?? 1.5
          }
          results = results
            .map(p => {
              const fit = profileRuleFit(p, mergedRules, { weatherProfile: resolvedWeather, occasionProfile, activityProfile, registerCeiling })
              return { ...p, ruleFit: fit.tier, ruleFitLabel: fit.label }
            })
            .sort((a, b) =>
              ((tierRank[a.ruleFit] ?? 1) - (tierRank[b.ruleFit] ?? 1)) ||
              (activityFitness(a) - activityFitness(b)))

          // Compose mode (default): exclude prohibited-tier pieces entirely so the model composes
          // only from wearable pieces (matching the composer roster's discipline). Explain mode keeps
          // them, annotated, because showing-and-explaining the constraint is the point of that query.
          // discouraged/unknown stay in both modes — legitimate judgment calls, not hard exclusions.
          if (intent !== 'explain') {
            const beforeGate = results.length
            const kept = results.filter(p => p.ruleFit !== 'prohibited')
            // docs/activity-and-roster-spec.md §5.4(2) + §5.0. Enforcement must not assume a
            // well-tagged wardrobe: this app has per-user databases, and an instance where no
            // garment carries an `outdoor` tag would otherwise get an empty roster and no
            // explanation. Same shape as the occasion-filter fallback above, and as capsule's
            // supply-gap disclosure — degrade to annotated guidance, and say why.
            // Count what the gate found either way: the diagnostic is about what the gate judged,
            // not about what survived, and a fallback that silently reports zero exclusions would
            // hide exactly the case worth knowing about.
            gateExcludedCount = beforeGate - kept.length
            if (!kept.length && beforeGate > 0) {
              gateSupplyFallbackNote = `No active pieces fully satisfy ${activityProfile?.label || 'this activity'}${occasion ? ` for ${occasion}` : ''}; showing the closest available pieces instead, annotated with ruleFit so you can judge and say what is missing.`
            } else {
              results = kept
            }
          }
        }
        
        // Trim only when the manifest is genuinely in the prompt to join against. Above the piece
        // cap it is omitted and the full rows are the model's only view of a garment.
        const trimToJudgment = toolContext?.wardrobeManifestIncluded === true
        console.log(`🔍 [Agent Tool Call] search_wardrobe returned ${results.length} items.`)
        // Rank within each category so the per-category image budget is independent.
        const visualRankByPiece = new Map()
        const seenPerCategory = new Map()
        for (const p of results) {
          const key = wardrobeCategoryGroup(p) || p.category || 'other'
          const rank = seenPerCategory.get(key) ?? 0
          visualRankByPiece.set(p.id, rank)
          seenPerCategory.set(key, rank + 1)
        }
        // docs/search-wardrobe-visual-budget-spec.md. A single category still gets the full
        // per-category ceiling; a batch spanning several divides a call-level total instead of
        // multiplying the ceiling by category count, floored so no category is starved to a
        // token-gesture count by division alone.
        const visualCategoryCount = seenPerCategory.size
        const perCategoryVisualCap = visualCategoryCount <= 1
          ? SEARCH_WARDROBE_VISUAL_CAP
          : Math.min(
              SEARCH_WARDROBE_VISUAL_CAP,
              Math.max(SEARCH_WARDROBE_VISUAL_FLOOR, Math.floor(SEARCH_WARDROBE_VISUAL_TOTAL_CAP / visualCategoryCount))
            )
        if (visual) {
          bumpFreeformDiagnostic(toolContext, 'searchVisualMaxCategoryCount', 0)
          if (toolContext?.freeformDiagnostics) {
            toolContext.freeformDiagnostics.searchVisualMaxCategoryCount =
              Math.max(toolContext.freeformDiagnostics.searchVisualMaxCategoryCount || 0, visualCategoryCount)
          }
        }
        const resultList = await Promise.all(results.map(async (p, index) => {
          let image = null
          // The cap is per CATEGORY, not per call: batching three category searches into one must
          // not hand the model a third of the photos it used to get. Visual grounding is a founding
          // principle of this app, and quietly starving it to save a round-trip would be the wrong
          // trade. It is bounded across categories too — see perCategoryVisualCap above.
          const visualRank = visualRankByPiece.get(p.id) ?? index
          if (visual && visualRank < perCategoryVisualCap) {
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
          // docs/search-payload-spec.md option B. The wardrobe manifest is in the cached stable
          // prefix and already carries this garment's stable truth — name, colours, fabric,
          // silhouette, length, neckline, sleeve, hem, pattern, formality, occasions, shoe type,
          // toe, heel, support, opacity, needs-base, season and trust flags. Re-sending all of it
          // per search cost more per call than the entire 251-piece manifest (~13.8k vs ~12.5k
          // tokens) and, unlike the manifest, was written to cache at 1.25x input every time.
          //
          // What a search is actually FOR is the part that cannot be cached: which pieces passed,
          // and how they were judged for THIS occasion/activity/weather. That is what comes back.
          // `id` is the join key into the manifest the model is already reading.
          if (trimToJudgment) {
            return {
              id: p.id,
              name: p.name,          // kept: the model cites pieces by name in its prose
              category: p.category,  // kept: cheap, and searches are often cross-category
              weatherFit: p.weatherFit,
              ruleFit: p.ruleFit,
              ruleFitLabel: p.ruleFitLabel,
              notes: p.notes ? p.notes.slice(0, 120) : '',
              ...(image ? { image } : {})
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
            shoe_type: p.shoe_type,
            toe_shape: p.toe_shape,
            // docs/activity-and-roster-spec.md Part 2. footwearComfortVerdict reads these to
            // exclude pieces and they appeared in no result row, so the model could not tell a
            // high-support trail shoe from a medium-support ballet flat and inferred grip from
            // garment names — exactly what structured tags exist to prevent.
            walk_support: p.walk_support,
            heel_height: p.heel_height,
            fabric_category: p.fabric_category,
            fabric_weight: p.fabric_weight,
            visual_weight: p.visual_weight,
            opacity: p.opacity,
            needs_base: p.needs_base,
            neckline: p.neckline,
            sleeve_length: p.sleeve_length,
            sleeve_shape: p.sleeve_shape,
            length_hits_at: p.length_hits_at,
            hem_finish: p.hem_finish,
            tuck_behavior: p.tuck_behavior,
            weatherFit: p.weatherFit,
            ruleFit: p.ruleFit,
            ruleFitLabel: p.ruleFitLabel,
            notes: p.notes ? p.notes.slice(0, 120) : '',
            ...(image ? { image } : {})
          }
        }))

        if (visual) {
          bumpFreeformDiagnostic(toolContext, 'searchVisualImagesAttached', resultList.filter(r => r.image).length)
        }

        if (fallbackNote) {
          resultList.push({ note: fallbackNote })
        }
        if (gateSupplyFallbackNote) {
          resultList.push({ note: gateSupplyFallbackNote })
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

        if (!relaxationPass) bumpFreeformDiagnostic(toolContext, 'searchCalls')
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

        // Which requested categories came back with nothing. With no category asked for, the whole
        // result set is the unit. This is the only thing that triggers broadening: a request that
        // found something is never second-guessed, because "enough" is the stylist's judgment.
        const returnedByCategory = {}
        for (const piece of resultList) {
          if (!piece?.id) continue
          const key = wardrobeCategoryGroup(piece) || piece.category || 'other'
          returnedByCategory[key] = (returnedByCategory[key] || 0) + 1
        }
        const shortfalls = categories.length
          ? categories.filter(category => !returnedByCategory[category])
          : (resultList.some(item => item.id) ? [] : ['(any)'])

        const nextRung = SEARCH_RELAXATION_LADDER[relaxationPass]
        const relaxable = nextRung ? nextRung.filter(name => args[name]) : []
        if (shortfalls.length && nextRung) {
          // Climb a rung. If this rung has nothing to drop, keep climbing — an empty rung must not
          // silently end broadening while filters remain that could still be relaxed.
          const relaxedArgs = { ...args, __relaxationPass: relaxationPass + 1, __relaxedFilters: [...relaxedSoFar, ...relaxable] }
          for (const name of relaxable) delete relaxedArgs[name]
          return executeToolInternal('search_wardrobe', relaxedArgs, toolContext)
        }

        // Report the compromise, and only the compromise: with nothing relaxed and nothing missing
        // the result is exactly what it always was, so 37 existing callers see no shape change.
        if (relaxedSoFar.length || shortfalls.length) {
          resultList.push({
            retrieval: {
              requestedCategories: categories.length ? categories : ['(any)'],
              returnedByCategory,
              shortfalls,
              broadened: relaxedSoFar.length > 0,
              relaxedFilters: relaxedSoFar,
              note: shortfalls.length
                ? `No active pieces remain for ${shortfalls.join(', ')} after broadening — this is a real wardrobe shortfall, not a narrow search.`
                : `No exact match for the original filters; relaxed ${relaxedSoFar.join(', ')} and returned the closest active pieces.`
            }
          })
        }

        return resultList
      }
      case 'propose_outfit': {
        const { pieces = [], label = '', occasion_context = '', why_it_works = '', styling_instructions = '', missing_gaps = [], occasion, season, activity } = args
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
        if (toolContext.source === 'slot_swap' && toolContext.sourceLocked &&
            Array.isArray(toolContext.generatedOutfits) &&
            toolContext.generatedOutfits.some(o => o?.source === 'slot_swap')) {
          bumpFreeformDiagnostic(toolContext, 'proposeAfterSlotSwapBlocked')
          contractIssues.push("suggest_slot_swaps already composed this turn's variant card(s) — do not call propose_outfit to recreate or duplicate them; present the existing slot_swap cards as the answer instead.")
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
        const wearableValidation = evaluateWearableOutfit(resolved, {
          roleAware: true,
          includeLayerDirections: true,
          seenPieceIds: seenIdsThisTurn,
        })
        if (wearableValidation.hardValid && wearableValidation.reviewRequired) {
          const idsToSee = wearableValidation.unresolvedSightPieceIds
          bumpFreeformDiagnostic(toolContext, 'proposeUnknownLayerDirectionBlocks')
          const hasUnknownRequiredBase = wearableValidation.unresolvedSightPairs
            .some(pair => pair.kind === 'required_base')
          const unknownRelationship = hasUnknownRequiredBase
            ? 'required base-layer compatibility is unknown'
            : 'layer direction is unknown'
          contractIssues.push(`${unknownRelationship} from the saved garment facts: call view_pieces (size:'large') for [${idsToSee.join(', ')}], resolve the visual relationship, and only keep the pairing if it works`)
        } else if (wearableValidation.unresolvedPairs.length) {
          // Deliberately provisional: this records a one-turn visual judgment, not a reusable
          // garment fact. If live results are poor, this single allowance can be retired.
          bumpFreeformDiagnostic(toolContext, 'proposeVisualLayerDirectionAllows')
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

        const requestTextForProposal = [
          toolContext.request,
          toolContext.question,
          occasion_context
        ].filter(Boolean).join(' ')
        const stylingContext = await resolveToolStylingContext({
          explicitRequest: {
            occasion,
            activity,
            season: extractSeasonRequest(season),
            statedWeather: extractSeasonRequest(season) ? '' : season,
            requestText: requestTextForProposal,
          },
          toolContext,
          inferred: { requestText: requestTextForProposal },
          policy: { mode: 'freeform_action' },
        })
        const resolvedOccasion = stylingContext.occasion
        const resolvedSeason = stylingContext.season
        const resolvedActivity = stylingContext.activity
        const outfitDebug = freeformOutfitDebugTrace({
          resolvedOccasion,
          resolvedActivity,
          requestText: requestTextForProposal,
          mood: stylingContext.mood,
          stylingContext,
        })

        // Validate role/slot structure (mechanically enforced — replaces the prompt's layering rules).
        const hardFindings = wearableValidation.hardFindings
        const issues = hardFindings.map(finding => finding.message)
        if (issues.length) {
          // Spec 3 Part 1: a failed validation must be visible, not silently dropped/retried — push a
          // broken diagnostic card (same "needs review" treatment as the composer's rejected proposals)
          // so the attempt is inspectable in chat, alongside returning the error to the model to retry.
          const brokenOutfit = normalizeOutfitResult({
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
            stylingInstructions: styling_instructions || '',
            source: 'proposed',
            activity: resolvedActivity,
            debug: outfitDebug,
            previewOnly: true
          }, {
            disposition: 'repairable',
            findings: hardFindings,
            repair: { operation: 'complete', action: 'propose_outfit_retry' },
            provenance: { flow: 'freeform_propose_outfit', source: 'proposed', composedBy: 'model', stage: 'role_validation' },
          })
          const existingBroken = Array.isArray(toolContext.generatedOutfits) ? toolContext.generatedOutfits : []
          toolContext.generatedOutfits = [...existingBroken, brokenOutfit]
          bumpFreeformDiagnostic(toolContext, 'proposeValidationFails')
          return {
            status: "validation_error",
            message: `The proposed outfit has an unresolved structure. ${projectOutfitValidationFindings(hardFindings)} ${roleOutfitStructurePromptRule()} COMPLETE the outfit instead of resending it: keep the pieces you chose, add the missing slots (search or view candidates if needed), then call propose_outfit again. If the user's question was really about a pairing or slot (e.g. what goes under X), you may answer that part in prose citing verified IDs — but any CARD must be a complete outfit.`,
            issues
          }
        }

        const resolvedWeather = stylingContext.weatherProfile
        const proposalEligibility = evaluateAutomaticUsePiecePool({
          pieces: resolved,
          context: automaticUseContextFromStylingContext(stylingContext, {
            mood: toolContext.mood || occasion_context || '',
            request: toolContext.request || toolContext.question || occasion_context || '',
            question: toolContext.question || '',
          }),
          policy: { anchorPieceIds: resolved.filter(piece => piece.anchor).map(piece => Number(piece.id)) }
        })
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
          const decision = proposalEligibility.decisionsById.get(Number(piece.id))
          return decision.allowed ? [] : [`${piece.name}: ${decision.reasons.join(', ')}`]
        })
        if (hardGateIssues.length) {
          const brokenOutfit = normalizeOutfitResult({
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
            stylingInstructions: styling_instructions || '',
            source: 'proposed',
            activity: resolvedActivity,
            debug: outfitDebug,
            previewOnly: true
          }, {
            disposition: 'repairable',
            findings: hardGateIssues.map((message, index) => ({ code: `eligibility_${index + 1}`, message, kind: 'eligibility' })),
            repair: { operation: 'substitute', action: 'propose_outfit_retry' },
            provenance: { flow: 'freeform_propose_outfit', source: 'proposed', composedBy: 'model', stage: 'eligibility_gate' },
          })
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
        const removedForRecovery = supersededBroken
          ? (supersededBroken.pieces || []).find(piece => !proposedPieceIdSet.has(Number(piece?.id)))
          : null
        const proposedOutfit = normalizeOutfitResult({
          label: label || 'Outfit',
          ...(anchorPieceIds.length ? { anchorPieceIds } : {}),
          occasion: resolvedOccasion,
          season: resolvedSeason,
          occasionContext: occasion_context || '',
          why: why_it_works || '',
          reason: why_it_works || '',
          stylingInstructions: styling_instructions || '',
          pieceIds: proposedPieceIds,
          pieces: resolved,
          missingPieces: Array.isArray(missing_gaps) ? missing_gaps.filter(Boolean).map(String) : [],
          source: 'proposed',
          activity: resolvedActivity,
          debug: outfitDebug,
          previewOnly: true,
          ...(supersededEngineNote ? { engineNote: supersededEngineNote } : {})
        }, {
          disposition: supersededEngineNote ? 'annotated' : 'accepted',
          annotations: supersededEngineNote ? [{ type: 'validated_recovery', message: supersededEngineNote }] : [],
          provenance: {
            flow: 'freeform_propose_outfit',
            source: 'proposed',
            composedBy: 'model',
            stage: 'proposal_validation',
            ...(supersededBroken ? { recovery: { operation: removedForRecovery ? 'substitute' : 'exception' } } : {}),
          },
        })
        const correctionRecovery = removedForRecovery
          ? validatedSubstitute({
              subject: supersededBroken,
              target: removedForRecovery,
              candidates: [proposedOutfit],
              // The model has already supplied the complete corrected card. Treat that exact card
              // as the substitution result; do not reconstruct it and risk losing roles or text.
              mutate: (_broken, corrected) => corrected,
              validate: corrected => evaluateWearableOutfit(corrected.pieces, { roleAware: true, includeLayerDirections: true }),
              context: { flow: 'freeform_propose_outfit', supersededLabel: supersededBroken.label || '' },
            })
          : null
        if (correctionRecovery && correctionRecovery.status !== 'recovered') {
          bumpFreeformDiagnostic(toolContext, 'proposeValidationFails')
          return {
            status: 'validation_error',
            message: 'The corrected outfit still fails the same hard outfit validator after substitution. Search for another replacement and re-propose the complete card.',
          }
        }
        toolContext.generatedOutfits = [
          ...existingOutfits.filter(outfit => outfit !== supersededBroken),
          correctionRecovery?.value || proposedOutfit
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
            evidence_note: 'Photos support visible drape, bulk, texture and behavior—not exact fiber composition. A shown configuration proves feasibility only; judge its visible result separately and do not rank an unseen alternative.',
            ...(image ? { image } : { note: 'no photo on file — tags are the only truth for this piece' })
          })
        }
        recordRetrievedPieces(toolContext, viewed.filter(item => item.name).map(item => item.id))
        recordRetrievedPieces(toolContext, viewed.filter(item => item.image).map(item => item.id), { seen: true })
        bumpFreeformDiagnostic(toolContext, 'viewCalls')
        return viewed
      }
      case 'suggest_slot_swaps': {
        if (toolContext.declaredIntent?.want !== 'cards') {
          return {
            status: "validation_error",
            message: "suggest_slot_swaps produces outfit cards, so call declare_intent({ want: 'cards', turn_mode: 'followup' }) first."
          }
        }
        const slotRole = String(args?.slot_role || '').trim()
        const inferredCategory = categoryForSlotRole(slotRole)
        const { category, unknown: unknownCategory } = normalizeCategoryFilter(args?.category || inferredCategory)
        if (!slotRole || !inferredCategory || unknownCategory || category !== inferredCategory) {
          return {
            status: "validation_error",
            message: "suggest_slot_swaps needs one slot_role matching its category: primary_top/top, primary_bottom/bottom, dress/dress, shoes/shoes, or outerwear/outerwear."
          }
        }

        const outfit = resolveCurrentOutfitForSwap(toolContext, {
          outfitIndex: args?.outfit_index,
          outfitLabel: args?.outfit_label
        })
        if (!outfit) {
          return {
            status: "validation_error",
            message: "No current outfit card is available to revise. Use this only for follow-ups against THREAD STATE's current_outfit_set or a card already produced this turn."
          }
        }

        const baseIds = outfitPieceIds(outfit)
        const basePieces = resolvePiecesByIds(baseIds)
        const targetId = Number(args?.target_piece_id)
        const removed = Number.isFinite(targetId)
          ? basePieces.find(piece => Number(piece.id) === targetId)
          : basePieces.find(piece => String(piece.category || '') === category)
        if (!removed || String(removed.category || '') !== category) {
          return {
            status: "validation_error",
            message: `The selected outfit does not have a ${category} piece to replace. Pick another outfit or slot.`
          }
        }

        const requestText = [
          toolContext.request,
          toolContext.question,
          args?.query
        ].filter(Boolean).join(' ')
        const rawLimit = Number(args?.limit) || 0
        const multipleRequested = userAskedForMultipleSlotSwapOptions(requestText, slotRole)
        const limit = multipleRequested
          ? Math.max(1, Math.min(3, rawLimit || 3))
          : 1
        const stylingContext = await resolveToolStylingContext({
          explicitRequest: {
            occasion: args?.occasion,
            activity: args?.activity,
            season: extractSeasonRequest(args?.season),
            statedWeather: extractSeasonRequest(args?.season) ? '' : args?.season,
            requestText,
          },
          actionArtifact: {
            occasion: outfit.occasion,
            activity: outfit.activity,
            season: outfit.season,
            weatherProfile: outfit.weatherProfile,
          },
          toolContext,
          inferred: { requestText },
          policy: { mode: 'freeform_action' },
        })
        const resolvedOccasion = stylingContext.occasion
        const resolvedSeason = stylingContext.season
        const resolvedActivity = stylingContext.activity
        const resolvedWeather = stylingContext.weatherProfile

        const replacementIds = Array.isArray(args?.replacement_ids)
          ? args.replacement_ids.map(Number).filter(Number.isFinite)
          : []
        const currentIdSet = new Set(baseIds.map(Number))
        let candidates = replacementIds.length
          ? resolvePiecesByIds(replacementIds).filter(piece => String(piece.category || '') === category)
          : db.prepare("SELECT * FROM pieces WHERE status = 'active' AND category = ? ORDER BY id").all(category).map(parsePiece)
        candidates = candidates.filter(piece => Number(piece.id) !== Number(removed.id))
        if (slotRole === 'primary_top' || slotRole === 'dress') {
          candidates = candidates.filter(piece => !pieceRequiresBaseLayer(piece))
        }
        const query = String(args?.query || '').toLowerCase().trim()
        const color = String(args?.color || '').toLowerCase().trim()

        const occasionProfile = stylingContext.occasionProfile
        const activityProfile = stylingContext.activityProfile
        const mergedRules = getMergedProfileRules(occasionProfile, activityProfile)
        const registerCeiling = resolveRegisterCeiling({
          occasion: resolvedOccasion,
          activity: resolvedActivity,
          mood: toolContext.mood || '',
          request: toolContext.request || toolContext.question || '',
          question: args?.query || toolContext.question || '',
          occasionProfile,
          activityProfile
        })
        const tierRank = { preferred: 0, neutral: 1, discouraged: 2, prohibited: 3 }
        const swapEligibility = evaluateAutomaticUsePiecePool({
          pieces: candidates,
          context: automaticUseContextFromStylingContext(stylingContext, {
            mood: toolContext.mood || '',
            request: requestText,
            question: toolContext.question || '',
          })
        })
        const scoredCandidates = candidates
          .map(piece => {
            const trust = swapEligibility.decisionsById.get(Number(piece.id))
            const ruleFit = (occasionProfile || activityProfile)
              ? profileRuleFit(piece, mergedRules, { weatherProfile: resolvedWeather, occasionProfile, activityProfile, registerCeiling })
              : { tier: 'neutral', label: '' }
            const weatherFit = weatherFitForPiece(piece, resolvedWeather)
            const occasionScore = pieceOccasionCompatible(piece, resolvedOccasion) ? 12 : 0
            const newnessScore = currentIdSet.has(Number(piece.id)) ? -20 : 0
            const queryScore = slotSwapQueryScore(piece, query)
            const colorScore = pieceHasStructuredColor(piece, color) ? SLOT_SWAP_STATED_COLOR_BONUS : 0
            return {
              piece,
              trust,
              ruleFit,
              weatherFit,
              colorScore,
              score: newnessScore + occasionScore + queryScore + colorScore + (weatherFit.score || 0) - ((tierRank[ruleFit.tier] ?? 1) * 8)
            }
          })
          .filter(candidate => candidate.trust.allowed && candidate.ruleFit.tier !== 'prohibited')
          .sort((a, b) => b.score - a.score || Number(a.piece.id) - Number(b.piece.id))

        const variants = []
        const failures = []
        for (const candidate of scoredCandidates) {
          if (variants.length >= limit) break
          const replacement = candidate.piece
          const resolved = basePieces
            .filter(piece => Number(piece.id) !== Number(removed.id))
            .map(piece => ({ ...piece, role: roleForPieceCategory(piece) }))
          resolved.push({ ...replacement, role: slotRole })
          resolved.sort((a, b) => OUTFIT_ROLES.indexOf(a.role) - OUTFIT_ROLES.indexOf(b.role))
          const wearableValidation = evaluateWearableOutfit(resolved, {
            roleAware: true,
            includeLayerDirections: true,
            seenPieceIds: toolContext.visuallySeenPieceIds,
          })
          const roleIssues = wearableValidation.hardFindings.map(finding => finding.message)
          if (wearableValidation.hardValid && wearableValidation.reviewRequired) {
            roleIssues.push(`outfit compatibility is unknown from the saved garment facts; view pieces [${wearableValidation.unresolvedSightPieceIds.join(', ')}] before making this swap`)
          }
          const hardGateIssues = candidate.trust.allowed
            ? []
            : [`${replacement.name}: ${candidate.trust.reasons.join(', ')}`]
          if (roleIssues.length || hardGateIssues.length) {
            failures.push({ id: replacement.id, name: replacement.name, issues: [...roleIssues, ...hardGateIssues] })
            continue
          }
          const label = `${outfit.label || outfit.title || 'Current outfit'} — ${replacement.name}`
          const why = slotSwapWhy({ replacement, removed, basePieces, slotRole, request: args?.query || '' })
          variants.push({
            label,
            occasion: resolvedOccasion,
            season: resolvedSeason,
            occasionContext: outfit.occasionContext || outfit.occasion_context || resolvedOccasion,
            why,
            reason: why,
            // Carried forward, not recomputed: a slot swap only replaces one role (usually
            // shoes/outerwear), so a prior layering/positioning instruction about the untouched
            // pieces (e.g. a belt over a cardigan) is still accurate. If the swapped role was
            // itself the subject of the instruction, this can go stale — no cheap way to detect
            // that here, so it's a known tradeoff rather than a bug.
            stylingInstructions: outfit.stylingInstructions || '',
            pieceIds: resolved.map(piece => Number(piece.id)),
            pieces: resolved,
            missingPieces: [],
            source: 'slot_swap',
            activity: resolvedActivity,
            debug: {
              mode: 'suggest_slot_swaps',
              swappedOut: { id: Number(removed.id), name: removed.name },
              swappedIn: { id: Number(replacement.id), name: replacement.name },
              colorPreference: color ? { requested: color, matched: candidate.colorScore > 0, score: candidate.colorScore } : null,
              ruleFit: candidate.ruleFit.label || candidate.ruleFit.tier,
              weatherFit: candidate.weatherFit.label
            },
            engineNote: `Slot-swap variant: replaced ${removed.name} with ${replacement.name}.`,
            previewOnly: true
          })
        }

        if (!variants.length) {
          return {
            status: "error",
            message: `No valid ${category} swaps were found for "${outfit.label || outfit.title || 'the selected outfit'}" under the current occasion/weather gates.`,
            rejected: failures.slice(0, 8)
          }
        }

        toolContext.generatedOutfits = [
          ...(Array.isArray(toolContext.generatedOutfits) ? toolContext.generatedOutfits : []),
          ...variants
        ]
        if (!toolContext.sourceLocked) toolContext.source = 'slot_swap'
        toolContext.sourceLocked = true
        toolContext.slotSwapCompleted = true
        if (toolContext.declaredIntent?.want === 'cards') {
          toolContext.declaredIntent.outfitCount = variants.length
        }
        toolContext.occasion = resolvedOccasion
        toolContext.season = resolvedSeason
        toolContext.activity = resolvedActivity
        recordRetrievedPieces(toolContext, [
          ...basePieces.map(piece => piece.id),
          ...variants.flatMap(outfit => outfit.pieceIds)
        ])
        bumpFreeformDiagnostic(toolContext, 'slotSwapCalls')
        return {
          status: "success",
          message: `Created ${variants.length} ${category} swap option${variants.length === 1 ? '' : 's'} for "${outfit.label || outfit.title || 'the selected outfit'}". Present these cards; do not call propose_outfit to recreate them.`,
          swappedOut: { id: Number(removed.id), name: removed.name },
          options: variants.map(outfit => ({
            label: outfit.label,
            pieceIds: outfit.pieceIds,
            replacement: outfit.debug.swappedIn,
            why: outfit.why
          })),
          ...(failures.length ? { rejected: failures.slice(0, 5) } : {})
        }
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

        // Counts alone told the model HOW MANY and never WHICH, so a coverage question cost three
        // retrieval steps: wardrobe_coverage, then search_wardrobe to find candidates, then
        // view_pieces for the truth to judge them (measured: thread_1787188412205, 4 iterations,
        // $0.2138, against $0.0708-$0.1012 for the profile this replaced). Coverage is already the
        // intent-specific primitive, so it should carry the evidence to answer from one result.
        //
        // The census is COMPLETE for the scoped category — never sampled, never ranked, never
        // capped. Sampling is exactly how the coverage arc failed twice: pieces that were never
        // shown could not be judged, and unpictured candidates went invisible. Whether 33 shoes are
        // "enough" is the stylist's judgment; code's job is to make sure it saw all 33.
        //
        // Candidates ride only on a category-scoped call. Unscoped coverage spans the whole active
        // wardrobe, where the manifest already carries identity and a full dump would be the
        // prompt over again.
        if (!coverageCategory) {
          return { group_by: groupField, total_pieces: scoped.length, counts }
        }
        // Same rule search_wardrobe uses, and for the same measured reason: when the manifest is in
        // the prompt the model ALREADY holds every stable field for every piece — walk_support,
        // formality, heel_height, the lot. Re-sending them here would duplicate the manifest one
        // category at a time (measured: 88 tops = 65,196 chars ≈ 16.3k tokens of pure repetition).
        // What coverage uniquely adds is the CLOSED SET: exactly which pieces are in scope, so the
        // model knows it has seen all of them. Above the manifest cap there is no manifest to read
        // from, so the full truth row travels with the candidate instead.
        const manifestCarriesTruth = toolContext?.wardrobeManifestIncluded === true
        return {
          group_by: groupField,
          total_pieces: scoped.length,
          counts,
          candidates: manifestCarriesTruth
            ? scoped.map(piece => ({ id: piece.id, name: piece.name }))
            : scoped.map(wardrobeTruthRow),
          candidates_note: manifestCarriesTruth
            ? `Complete active ${coverageCategory} census (${scoped.length} pieces), not a sample — this is every one, so judge them all. Their stable truth is already in the wardrobe manifest above; read it there rather than searching again. Call view_pieces only if seeing a garment would change your answer; a piece with no photograph is still a candidate.`
            : `Complete active ${coverageCategory} census (${scoped.length} pieces) with full truth, not a sample — judge every row. Call view_pieces only if seeing a garment would change your answer; a piece with no photograph is still a candidate.`
        }
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
          const provisionalCorrection = getProvisionalWrongChoiceMemory([parsed.id], 2)
          
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
            text: [buildPieceText(parsed), provisionalCorrection ? `PROVISIONAL OWNER CORRECTION:\n${provisionalCorrection}` : ''].filter(Boolean).join('\n'),
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
        const { note, context_type, context_id, piece_id, firm_rule_proposal, guidance_applicability } = args
        if (piece_id !== undefined && piece_id !== null) {
          const pieceId = Number(piece_id)
          const { retrieved, known } = verifiedPieceIdSets(toolContext)
          const activePieceId = toolContext?.activeContext?.type === 'piece'
            ? Number(toolContext.activeContext.id)
            : null
          const verified = retrieved.has(pieceId) || known.has(pieceId) || activePieceId === pieceId
          if (!verified) {
            return {
              status: 'validation_error',
              message: `Piece ${pieceId} is not verified in the current conversation. Retrieve or establish the exact garment before saving a garment-specific correction. Nothing was stored.`,
            }
          }
        }
        return storeUserCorrection(note, context_type || 'general', context_id, {
          pieceId: piece_id,
          firmRuleProposal: firm_rule_proposal,
          guidanceApplicability: guidance_applicability,
        })
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
        // Spec future-trip-weather-estimate-spec.md §3.1: the free-text `weather`
        // field is removed from this schema entirely — a non-conforming caller's
        // args.weather is never read here, for gating or anything else.
        // toolContext.weather (established display/season text, not physical
        // weather) still seeds the heuristic no-location fallback below.
        const planWeather = toolContext.weather || ''
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
          fallbackWeather: planWeather,
          fallbackOccasion: toolContext.occasion || 'city',
          fallbackActivity: toolContext.activity || 'none',
          fallbackLocation,
          fallbackUserWeather: args?.user_weather || null,
          fallbackWeatherEstimate: args?.weather_estimate || null,
          dateRange: planDateRange,
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
        const weatherFetchImpl = typeof toolContext.weatherFetchImpl === 'function' ? toolContext.weatherFetchImpl : undefined
        // Spec §6.1/§6.2: resolve weather for every slot through the ONE
        // structured contract BEFORE any roster, pendingPlan, or workbench is
        // built. A named destination/date slot with no resolved temperature
        // (no live coverage, no user_weather, no weather_estimate) stops the
        // whole call here — checked via each slot's actual
        // resolvedWeatherContext.status, not string-matching a display label,
        // and via .some() so a mixed plan (one resolved slot, one not) still
        // stops rather than proceeding partially gated.
        const weatherPreCheckSlots = await Promise.all(planSlots.map(async slot => {
          const { profile } = await resolveSlotWeather(slot, {
            mood: toolContext.mood || '',
            question: toolContext.planQuestion || toolContext.question || '',
            dateRange: planDateRange,
            location: toolContext.location || '',
            fetchImpl: weatherFetchImpl,
            seasonIsCalendarOnly: planKind === 'seasonal_capsule',
          })
          return { label: slot.label, status: profile?.resolvedWeatherContext?.status || 'unavailable' }
        }))
        const unresolvedSlot = weatherPreCheckSlots.find(slot => slot.status === 'unavailable')
        if (unresolvedSlot) {
          bumpFreeformDiagnostic(toolContext, 'planWeatherContextRequired')
          return {
            status: "weather_context_required",
            location: fallbackLocation,
            date_range: planDateRange,
            missing: ["temperature"],
            message: `Live weather does not cover these dates for "${unresolvedSlot.label}". Re-call this tool with weather_estimate.high_f and weather_estimate.low_f (on the plan or on each affected slot) before selecting garments.`
          }
        }
        const planPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
        bumpFreeformDiagnostic(toolContext, 'planOutfitSetCalls', 0)
        // Spec 25 Part 2: fetch here, render in buildPlanSlotWorkbench — the
        // plan workbench is where every instruction the model demonstrably
        // obeys lives, ~40k tokens closer than the system-prompt tail where a
        // stored owner rule previously sat unread among reaction crumbs.
        const ownerRules = getOwnerRuleNotes(8, {
          requestContexts: planSlots.map(slot => ({
            occasion: slot.occasion,
            activity: slot.activity,
            season: slot.season || planConstraints.season || '',
            weather: slot.season || planWeather || '',
            weatherText: slot.season || planWeather || '',
            requestText: [slot.label, slot.occasion, slot.activity].filter(Boolean).join(' '),
          })),
          // Before the plan roster exists, only context/universal guidance can enter roster
          // selection. Garment-scoped guidance is selected again inside the bounded compose pool.
          pieces: [],
        })
        const workbench = await buildPlanSlotWorkbench(planSlots, {
          constraints: planConstraints,
          allPieces: planPieces,
          dateRange: planDateRange,
          mood: toolContext.mood || '',
          question: toolContext.planQuestion || toolContext.question || '',
          location: toolContext.location || '',
          // Test-only injection point (mirrors the fetchImpl convention already
          // used throughout weather.js/outfitSetPlanner.js) — absent in
          // production, so plan_outfit_set always resolves real live weather.
          ...(weatherFetchImpl ? { fetchImpl: weatherFetchImpl } : {}),
          ownerRules,
          planKind,
          // Injected only when the route wired one (flag on). Absent, the
          // roster is chosen deterministically exactly as before.
          chooseCapsuleRoster: typeof toolContext.chooseCapsuleRoster === 'function'
            ? toolContext.chooseCapsuleRoster
            : null,
          onDiagnostic: field => bumpFreeformDiagnostic(toolContext, field)
        })
        setFreeformCapsuleRosterFailureCodes(toolContext, workbench?.pendingPlan?.capsuleRosterFailureCodes)
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
          let submittedOutfits = []
          let compositionError = null
          try {
            submittedOutfits = await toolContext.composeCapsulePlanOnce({
              status: workbench.status,
              instructions: workbench.instructions,
              piece_catalog: workbench.piece_catalog,
              slots: workbench.slots,
              constraints: workbench.constraints
            })
          } catch (err) {
            compositionError = err
          }
          bumpFreeformDiagnostic(toolContext, 'submitPlanCalls')
          if (compositionError || !Array.isArray(submittedOutfits) || submittedOutfits.length === 0) {
            bumpFreeformDiagnostic(toolContext, 'submitPlanValidationFails')
            toolContext.generatedOutfits = []
            toolContext.source = 'plan_outfit_set'
            toolContext.sourceLocked = true
            toolContext.pendingPlan = null
            toolContext.capsuleAtomicCompleted = true
            // A token-cap truncation is a deterministic failure — the exact same
            // request will hit the same ceiling again, so telling the user to
            // just retry is misleading (thread_1787717774384: a 24-piece/10-look
            // capsule silently returned zero outfits at the old, too-tight ceiling).
            // Distinguish it in diagnostics from a genuine model refusal.
            if (compositionError?.isTruncation) {
              setFreeformCapsuleCompositionFailureCode(toolContext, 'truncated_max_tokens')
              return {
                status: 'error',
                bounded_composition: true,
                message: 'The bounded capsule composer ran out of output budget composing this many looks and returned an incomplete result. Do not build the capsule manually or call other styling tools in this turn; explain that this specific capsule size hit a system limit during composition, and suggest asking for fewer looks or a smaller capsule instead of an identical retry.'
              }
            }
            setFreeformCapsuleCompositionFailureCode(toolContext, compositionError ? 'provider_error' : 'empty_result')
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
          const { accepted, failures, completions, shortfall: recoveryShortfall } = completeSubmittedPlanOutfits(pendingPlan, submittedOutfits, {
            visuallySeenPieceIds: seenForValidation
          })
          for (const completion of completions) {
            bumpFreeformDiagnostic(toolContext, 'capsuleLooksAutoCompleted')
            console.log('[Atomic Capsule Completion]', `${completion.title || completion.slotId}: added ${completion.group} ${completion.addedPieceName} (${completion.addedPieceId})`)
          }
          const completionLine = describeCapsuleAutoCompletions(completions)
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
          const paletteLine = describeCapsulePaletteCohesion(
            pendingPlan.capsuleRoster || [],
            displayedForUtilization
          )
          // Step 5 criterion 4: utilization above counts IDs, and on the live
          // run its 92% headline hid that the two unused pieces were the
          // capsule's ONLY layer and a shoe that earned no formula. This names
          // the undemonstrated JOB and restates the percentage alongside it, so
          // a high raw number cannot read as success on its own.
          const jobsLine = describeCapsuleUndemonstratedJobs(
            pendingPlan.capsuleRoster || [],
            displayedForUtilization
          )
          if (jobsLine) {
            pendingPlan.coverageGaps = [...(pendingPlan.coverageGaps || []), jobsLine]
          }
          if (paletteLine) {
            pendingPlan.coverageGaps = [...(pendingPlan.coverageGaps || []), paletteLine]
          }
          // Only when the jobs line did NOT fire. The jobs line already states
          // the utilization percentage inside itself, deliberately, because the
          // failure mode being closed is a high raw number reading as success on
          // its own — and this line was being appended AFTER it, so the bare
          // count was the last word on the very screen that was supposed to
          // qualify it. They are not fully redundant, though: a rotation can
          // demonstrate every job and still leave pieces unused, and that case
          // has no other reporter, so the line stays for it.
          if (utilizationLine && !jobsLine) {
            pendingPlan.coverageGaps = [...(pendingPlan.coverageGaps || []), utilizationLine]
          }
          // The engine changed a look the model submitted; say so on a surface
          // the person can actually see.
          if (completionLine) {
            pendingPlan.coverageGaps = [...(pendingPlan.coverageGaps || []), completionLine]
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
            // This success message must instruct plan_lines presentation the same way its
            // sibling non-atomic success messages below do (search "Present these cards and
            // the plan_lines" / "include the plan_lines"). It didn't: a roster-selection
            // fallback disclosure (e.g. "[capsule fallback: ...]") reaches plan_lines via
            // pendingPlan.coverageGaps same as any other plan_outfit_set path, but with no
            // instruction to relay it the model silently dropped it (thread_1787725557304 —
            // the user got the deterministic roster with no indication the model's pick failed).
            message: `${accepted.length} representative capsule outfit${accepted.length === 1 ? '' : 's'} accepted. These cards are already displayed. Present the accepted rotation and the plan_lines verbatim, then finish; no additional actions are available for this turn.${shortfallLine ? ` ${accepted.length} of ${plannedTotal} planned looks passed validation.${rejectionSummary ? ` The reason each one was held back, which you may state plainly and must NOT guess at or replace with your own theory: ${rejectionSummary}. Those looks are already shown as needs-review cards the user can repair, so do not offer to re-style them yourself.` : ''} Do not describe the shortfall as an engine or card ceiling, and do not supply the missing looks yourself in prose.` : ''}${CAPSULE_PLAN_EVIDENCE_BOUNDARY}`,
            plan_lines: planLinesForResponse,
            recovery_shortfall: recoveryShortfall,
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
            message: `Accepted ${planOutfits.length} valid plan outfit card${planOutfits.length === 1 ? '' : 's'} after repeated validation failures. Present these cards and the plan_lines honestly; do not invent missing cards. Unfilled slots are disclosed in the plan lines. Last failures: ${failureText} These cards are already displayed to the user — do NOT call propose_outfit or render them again; write your final answer presenting them. To fill the disclosed gaps, call plan_outfit_set again with JUST the unfilled slot(s) — accepted cards carry forward automatically.${CAPSULE_PLAN_EVIDENCE_BOUNDARY}`,
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
          message: `Accepted ${planOutfits.length} model-composed plan outfit card${planOutfits.length === 1 ? '' : 's'} across ${pendingPlan.slots.length} slots. Present THIS set slot by slot and include the plan_lines; do not call propose_outfit to rebuild it. These cards are already displayed to the user — do NOT call propose_outfit or render them again; write your final answer presenting them.${CAPSULE_PLAN_EVIDENCE_BOUNDARY}`,
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
        const { occasion, season, mood, mission, limit, piece_id, activity, location, date } = args
        const boundedDefaultCount = toolContext.turnMode === 'new_request' && !piece_id ? 2 : 5
        const requestedFromCall = Math.max(1, Math.min(5, Number(limit) || boundedDefaultCount))
        // Calling the narrowly-scoped bounded tool is itself an unambiguous cards declaration. This
        // removes a paid declare_intent round trip while leaving the general composing contract intact.
        declareBoundedMultiLookIntent(toolContext, { limit: requestedFromCall, pieceId: piece_id })
        // Declared-intent gate (step 4): same contract as propose_outfit outside the bounded path.
        if (toolContext.declaredIntent?.want !== 'cards') {
          bumpFreeformDiagnostic(toolContext, 'composeWithoutDeclaredIntent')
          return {
            status: "validation_error",
            message: "No cards intent declared for this turn. Call declare_intent({ want: 'cards', outfit_count: <n if the user asked for a number> }) first, then call generate_outfits again."
          }
        }
        const declaredCount = Number(toolContext.declaredIntent?.outfitCount) || 0
        const requestedCount = Math.max(1, Math.min(5, Number(limit) || declaredCount || 5))
        const boundedMultiLook = (toolContext.declaredIntent?.turnMode === 'new_request' ||
            (!toolContext.declaredIntent?.turnMode && toolContext.turnMode === 'new_request')) &&
          !piece_id && requestedCount >= 2 &&
          !(Array.isArray(toolContext.generatedOutfits) && toolContext.generatedOutfits.some(outfit => !outfit?.broken))
        const { generateOutfitsForPieceInternal, generateWholeWardrobeOutfitsVisualInternal } = await import('../routes/ai.js')
        const stylingContext = await resolveToolStylingContext({
          explicitRequest: {
            occasion,
            activity,
            season: extractSeasonRequest(season),
            mission,
            mood,
            statedWeather: toolContext.weather || (extractSeasonRequest(season) ? '' : season),
            location,
            date: date || toolContext.currentDate || new Date(),
            requestText: toolContext.question || '',
          },
          toolContext,
          inferred: { requestText: toolContext.question || '' },
          policy: { mode: 'freeform_action', allowLiveWeather: boundedMultiLook },
        })
        const resolvedActivity = stylingContext.activity
        let resolvedSeason = stylingContext.season
        if (boundedMultiLook) {
          const resolvedWeather = stylingContext.weatherProfile
          const forecastTemperature = Number.isFinite(Number(resolvedWeather.highF))
            ? `forecast high ${Math.round(Number(resolvedWeather.highF))}°F${Number.isFinite(Number(resolvedWeather.lowF)) ? `, low ${Math.round(Number(resolvedWeather.lowF))}°F` : ''}`
            : ''
          // Cold gets the same 3-tier treatment as heat (isExtremeHeat) rather than
          // collapsing "chilly" and "freezing" into one "cold weather" label that
          // primes the model toward the heaviest owned piece — see
          // docs/cold-severity-spec.md.
          const physicalWeather = resolvedWeather.isExtremeHeat
            ? 'extreme hot weather'
            : (resolvedWeather.isHot ? 'hot weather'
              : (resolvedWeather.isColdSevere ? 'cold weather'
                : (resolvedWeather.isCold ? 'cool weather' : 'mild weather')))
          resolvedSeason = resolvedWeather.weatherSource === 'unavailable'
            ? 'forecast unavailable; temperature unknown; do not infer hot or cold weather from the calendar season'
            : `${stylingContext.season}; ${physicalWeather}${forecastTemperature ? `; ${forecastTemperature}` : ''}`
          toolContext.boundedWeatherSummary = Number.isFinite(Number(resolvedWeather.highF))
            ? `a forecast high of ${Math.round(Number(resolvedWeather.highF))}°F${Number.isFinite(Number(resolvedWeather.lowF)) ? ` and low of ${Math.round(Number(resolvedWeather.lowF))}°F` : ''}`
            : ''
          toolContext.boundedLocation = stylingContext.location
          toolContext.boundedWeatherUnavailable = resolvedWeather.weatherSource === 'unavailable'
        }

        // generateOutfitsForPieceInternal / generateWholeWardrobeOutfitsVisualInternal each make a
        // real provider call of their own (recordNestedFreeformUsage above covers that once this
        // returns). Stage the attribution on the shared telemetry context immediately before firing
        // it, same as every other freeform provider-call site — only when this tool is actually
        // running inside an /ask turn (freeformTurnToken is set there and nowhere else this tool is
        // reachable from), so an unrelated caller of this same tool case is never mistagged.
        if (toolContext.freeformTurnToken) {
          updateAiTelemetryContext({
            freeformTurnToken: toolContext.freeformTurnToken,
            subflow: 'nested_composer',
            iterationIndex: nextFreeformCallIndex(toolContext),
            isRetry: false,
            retryReason: '',
            isNested: true,
          })
        }

        let result
        if (piece_id) {
          toolContext.source = 'selected_piece'
          result = await generateOutfitsForPieceInternal({
            pieceId: Number(piece_id),
            occasion: stylingContext.occasion,
            season: resolvedSeason,
            mission: stylingContext.mission,
            mood: stylingContext.mood,
            includeMissingPieces: false,
            idealOnly: false,
            question: toolContext.question || '',
            activity: resolvedActivity,
            currentDate: stylingContext.date,
            // Found live: this nested composer call ran on Anthropic even under
            // STYLIST_PROVIDER_OVERRIDE=gemini, since neither this call site nor the function
            // itself forwarded any provider override — a real gap, not deliberate pinning.
            providerOverride: toolContext.providerOverride || null,
          })
        } else {
          toolContext.source = 'whole_wardrobe'
          result = await generateWholeWardrobeOutfitsVisualInternal({
            occasion: stylingContext.occasion,
            season: resolvedSeason,
            mood: stylingContext.mood,
            mission: stylingContext.mission,
            limit: requestedCount,
            explorationMode: 'moderate',
            question: toolContext.question || '',
            activity: resolvedActivity,
            resolvedWeatherProfile: boundedMultiLook ? toolContext.weatherProfile : null,
            currentDate: stylingContext.date,
            adaptiveVisualDetail: boundedMultiLook,
            // Same reasoning as the selected-piece branch above — this is the exact call site
            // implicated in the live $0.122-inside-a-"Gemini"-turn finding.
            providerOverride: toolContext.providerOverride || null,
          })
        }
        
        if (result && result.structuredOutfits) {
          recordNestedFreeformUsage(toolContext, result?.debug?.composerUsage)
          toolContext.generatedOutfits = result.structuredOutfits
          if (boundedMultiLook) {
            toolContext.atomicMultiLookCompleted = true
            toolContext.atomicMultiLookRequestedCount = requestedCount
            toolContext.source = 'atomic_multi_look'
            toolContext.sourceLocked = true
            bumpFreeformDiagnostic(toolContext, 'atomicMultiLookCalls')
          }
          return {
            status: "success",
            message: `Successfully generated ${result.structuredOutfits.length} outfits.${boundedMultiLook ? ' This bounded batch is the complete card result for the turn; present it and do not search, regenerate, or call propose_outfit.' : ''}`,
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

function validatedFirmRuleProposal(rawProposal) {
  if (!rawProposal || typeof rawProposal !== 'object') return null
  const checked = validateOwnerConstraintInput({
    confirmOwnerConstraint: true,
    selectorType: rawProposal.selector_type,
    selectorValues: rawProposal.selector_values,
    contextDimension: rawProposal.context_dimension,
    contextValues: rawProposal.context_values,
    reason: rawProposal.reason,
  })
  if (checked.error || checked.value.selectorType === 'piece_ids') return null
  return {
    version: 1,
    selectorType: checked.value.selectorType,
    selectorValues: checked.value.selectorValues,
    contextDimension: checked.value.contextDimension,
    contextValues: checked.value.contextValues,
    reason: checked.value.reason,
  }
}

export function storeUserCorrection(note, contextType = 'general', contextId = null, { pieceId = null, firmRuleProposal = null, guidanceApplicability = null } = {}) {
  try {
    const trimmed = String(note || '').trim()
    if (!trimmed) return { status: 'validation_error', message: 'Correction text is required. Nothing was stored.' }
    const scopedPieceId = Number(pieceId) || null
    if (scopedPieceId) {
      const piece = db.prepare('SELECT id, name, styling_rules_learned FROM pieces WHERE id = ?').get(scopedPieceId)
      if (!piece) return { status: 'validation_error', message: `Piece ${scopedPieceId} does not exist. Nothing was stored.` }
      const rules = safeJsonParse(piece.styling_rules_learned, []) || []
      if (rules.some(rule => String(rule).trim() === trimmed)) {
        return { status: 'success', scope: 'piece', piece_id: scopedPieceId, piece_name: piece.name, message: 'This garment rule was already stored.' }
      }
      const savePieceRule = db.transaction(() => {
        db.prepare('UPDATE pieces SET styling_rules_learned = ? WHERE id = ?')
          .run(JSON.stringify([...rules, trimmed]), scopedPieceId)
        db.prepare(`
          INSERT INTO stylist_feedback
          (feedback_type, target_type, context_type, context_id, context_name, note, payload)
          VALUES ('piece_rule_receipt', 'piece', 'piece', ?, ?, ?, ?)
        `).run(scopedPieceId, piece.name, trimmed, JSON.stringify({ pieceId: scopedPieceId, canonicalStore: 'pieces.styling_rules_learned' }))
      })
      savePieceRule()
      return { status: 'success', scope: 'piece', piece_id: scopedPieceId, piece_name: piece.name, message: `Correction stored for ${piece.name}.` }
    }
    // Dedupe: an identical live note must not stack — repeated turns were
    // multiplying the same text into the high-authority memory section.
    const proposal = validatedFirmRuleProposal(firmRuleProposal)
    const applicability = validateOwnerGuidanceApplicability(guidanceApplicability) || extractOwnerGuidanceApplicability(trimmed, { firmRuleProposal: proposal })
    const existing = db.prepare(`
      SELECT id, payload FROM stylist_feedback
      WHERE note = ? AND feedback_type = 'owner_rule' AND COALESCE(archived, 0) = 0
      LIMIT 1
    `).get(trimmed)
    if (existing) {
      if (proposal || applicability) {
        const payload = safeJsonParse(existing.payload, {}) || {}
        db.prepare('UPDATE stylist_feedback SET payload = ? WHERE id = ?')
          .run(JSON.stringify({
            ...payload,
            ...(proposal ? { ownerConstraintProposal: proposal } : {}),
            ...(applicability ? { ownerGuidanceApplicability: applicability } : {}),
          }), existing.id)
      }
      return {
        status: 'success',
        scope: applicability?.reach || 'unresolved',
        firm_rule_proposed: Boolean(proposal),
        message: 'This global correction was already stored.',
      }
    }
    // Spec 25 Part 2: 'owner_rule' going forward (previously
    // 'preference_reaction'/'message') — legacy rows keep matching via
    // isOwnerRuleRow's OR clause, no migration needed.
    db.prepare(`
      INSERT INTO stylist_feedback (feedback_type, target_type, context_type, context_id, note, payload)
      VALUES ('owner_rule', 'message', ?, ?, ?, ?)
    `).run(contextType, contextId, trimmed, JSON.stringify({
      ...(proposal ? { ownerConstraintProposal: proposal } : {}),
      ...(applicability ? { ownerGuidanceApplicability: applicability } : {}),
    }))
    return {
      status: 'success',
      scope: applicability?.reach || 'unresolved',
      firm_rule_proposed: Boolean(proposal),
      message: proposal
        ? 'Guidance stored with context-aware delivery and a firm-rule proposal for owner review.'
        : applicability?.reach === 'unresolved'
          ? 'Guidance stored for review, but its applicability could not be resolved safely.'
          : 'Guidance stored with context-aware delivery.',
    }
  } catch (err) {
    console.error('storeUserCorrection error:', err)
    return { status: 'error', message: 'Correction could not be stored.' }
  }
}
